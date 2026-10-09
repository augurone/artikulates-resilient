import { deepStrictEqual, match, ok, rejects, strictEqual, throws } from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { measureProject, saveMeasurement } from '../integrations/measurement.js';

const hash = value => createHash('sha256').update(value).digest('hex');

test('measurement captures configured source, findings and exception boundaries in one lint', async (context) => {
    mkdirSync(resolve('.artifacts'), { recursive: true });
    const directory = mkdtempSync(resolve('.artifacts/measurement-'));
    const write = (name, source) => {
        const file = join(directory, name);

        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, source);

        return file;
    };
    const configSource = [
        "import resilient from 'eslint-plugin-resilient';",
        'export default [',
        '    { ignores: ["**/ignored.js"] },',
        '    resilient.configs.contracts,',
        `    resilient.imports({ cwd: ${JSON.stringify(directory)}, aliases: { "@": "src" } }),`,
        '    { rules: { "no-console": "error", "resilient/signature-contract-operation": "warn" },',
        '      linterOptions: { reportUnusedDisableDirectives: "off" } }',
        '];'
    ].join('\n');
    const config = write('eslint.config.js', configSource);
    const provider = write('src/provider.js', 'export const load = () => [];\n');
    const barrel = write('src/barrel.js', 'export { load as read } from "./provider.js";\n');
    const pageSource = '\uFEFF' + [
        'import { read } from "@/barrel.js";',
        'const values = read();',
        'values.trim();',
        'console.log("active");',
        '// eslint-disable-next-line no-console -- This fixture preserves a requested report call.',
        'console.log("suppressed");'
    ].join('\r\n');
    const page = write('src/page.js', pageSource);
    const unused = write('src/unused.js', '// eslint-disable-next-line no-console -- The former report call is now absent.\nexport const value = 1;\n');
    const scoped = write('src/scoped.js', [
        '/* eslint-disable no-console -- This fixture preserves one scoped report call. */',
        'console.log("scoped");',
        '/* eslint-enable no-console */'
    ].join('\n'));
    const files = [config, provider, barrel, page, unused, scoped];
    const before = files.map(file => hash(readFileSync(file)));
    const patterns = ['src/page.js', 'src/unused.js', 'src/scoped.js'];
    const measure = (options = {}) => measureProject({ directory, patterns, ...options });

    context.after(() => rmSync(directory, { recursive: true, force: true }));

    await context.test('aliases, severities, physical hashes and suppressions retain their actual identities', async () => {
        const report = await measure({ configFile: config });
        const { schemaVersion = 0, complete = false, identity: { configuration = {}, tool = {} } = {}, active = [], suppressed = [], exceptions = [], directives = [] } = report;
        const { file: configFile = '', sha256: configHash = '' } = configuration;
        const { sha256: toolHash = '', files: toolFiles = [], eslintPackageSha256 = '' } = tool;

        strictEqual(schemaVersion, 3);
        strictEqual(complete, true);
        strictEqual(configFile, config);
        strictEqual(configHash, hash(configSource));
        match(toolHash, /^[a-f\d]{64}$/u);
        match(eslintPackageSha256, /^[a-f\d]{64}$/u);
        ok(toolFiles.some(({ file = '', sha256 = '' } = {}) => file === 'integrations/measurement.js' && /^[a-f\d]{64}$/u.test(sha256)));
        ok(active.some(({ ruleId = '', severity = 0 } = {}) => ruleId === 'resilient/signature-contract-operation' && severity === 1));
        ok(active.some(({ ruleId = '', severity = 0 } = {}) => ruleId === 'no-console' && severity === 2));
        ok(suppressed.some(({ file = '', ruleId = '', suppressions = [], offset = -1 } = {}) => file === 'src/page.js' && ruleId === 'no-console' &&
            suppressions.length && offset === pageSource.indexOf('console.log("suppressed")') - 1));
        ok(directives.some(({ text = '' } = {}) => text === 'eslint-enable no-console'));
        ok(exceptions.some(({ file = '', form = '', enclosedAst = '', operation = '', suppressedRules = [] } = {}) => file === 'src/scoped.js' &&
            form === 'scoped-disable' && enclosedAst === 'ExpressionStatement' && operation === 'console.log("scoped");' && suppressedRules.includes('no-console')));
        ok(exceptions.some(({ file = '', unusedStatus = '' } = {}) => file === 'src/unused.js' && unusedStatus === 'unavailable'));
        strictEqual(active.some(({ message = '' } = {}) => message.startsWith('Unused eslint-disable')), false);
        const destination = join(directory, 'measurement.json');

        saveMeasurement({ directory, file: destination, report });
        deepStrictEqual(JSON.parse(readFileSync(destination, 'utf8')), report);
        const unsafe = join(directory, 'unsafe.json');

        symlinkSync(page, unsafe);
        throws(() => saveMeasurement({ directory, file: unsafe, report }), /distinct from source/u);
        deepStrictEqual(files.map(file => hash(readFileSync(file))), before);
    });

    await context.test('unused and no-inline profiles remain isolated across successive measurements', async () => {
        const { complete = false, identity: { profile = '' } = {}, exceptions = [], directives = [] } = await measure({ unused: true });

        strictEqual(complete, true);
        strictEqual(profile, 'unused-directives');
        ok(exceptions.some(({ file = '', unusedRules = [] } = {}) => file === 'src/unused.js' && unusedRules.includes('no-console')));
        ok(directives.some(({ file = '' } = {}) => file === 'src/scoped.js'));
        write('noinline.config.js', 'import configured from "./eslint.config.js";\nexport default [...configured, {linterOptions:{noInlineConfig:true}}];\n');
        const { suppressed = [], active = [], exceptions: ignored = [] } = await measure({ configFile: 'noinline.config.js', patterns: ['src/page.js'] });

        deepStrictEqual(suppressed, []);
        ok(active.some(({ ruleId = '', line = 0 } = {}) => ruleId === 'no-console' && line === 6));
        ok(ignored.some(({ unusedStatus = '' } = {}) => unusedStatus === 'ignored'));
        const { identity: { profile: restored = '' } = {}, suppressed: restoredSuppressions = [], exceptions: restoredExceptions = [] } = await measure();

        strictEqual(restored, 'configured');
        strictEqual(restoredSuppressions.length, 2);
        ok(restoredExceptions.some(({ file = '', unusedStatus = '' } = {}) => file === 'src/unused.js' && unusedStatus === 'unavailable'));
    });

    await context.test('nested discovery records physical configuration without a project-root config', async () => {
        const nested = join(directory, 'nested-project');
        const nestedConfigSource = 'export default [{rules:{"no-console":"warn"}}];\n';
        const nestedConfig = write('nested-project/src/eslint.config.js', nestedConfigSource);
        const nestedSource = write('nested-project/src/value.js', 'console.log("nested");\n');
        const { complete = false, identity: { configurations = [] } = {}, files: measured = [], active = [] }
            = await measureProject({ directory: nested, patterns: ['src/value.js'] });

        strictEqual(complete, true);
        deepStrictEqual(configurations, [{ file: nestedConfig, sha256: hash(nestedConfigSource) }]);
        ok(measured.some(({ configuration: { file = '', sha256 = '' } = {} } = {}) => file === nestedConfig && sha256 === hash(nestedConfigSource)));
        ok(active.some(({ ruleId = '', severity = 0 } = {}) => ruleId === 'no-console' && severity === 1));
        strictEqual(readFileSync(nestedSource, 'utf8'), 'console.log("nested");\n');
        strictEqual(readFileSync(nestedConfig, 'utf8'), nestedConfigSource);
    });

    await context.test('audit problems remain data while incomplete source and operational failures cannot pass', async () => {
        write('src/unclosed.js', '/* eslint-disable no-console -- This missing closing boundary must remain visible. */\nconsole.log("unclosed");\n');
        const { complete = false, directives = [], auditProblems = [] } = await measure({ patterns: ['src/unclosed.js'] });

        strictEqual(complete, true);
        ok(directives.some(({ text = '' } = {}) => text.includes('missing closing boundary')));
        ok(auditProblems.some(({ message = '' } = {}) => message.includes('must close')));
        const incomplete = [
            ['syntax.js', 'const = ;'],
            ['ignored.js', 'export const ignored = true;'],
            ['capture.js', '/* eslint resilient-measure/capture: "off" */\nexport const hidden = true;']
        ];

        await Promise.all(incomplete.map(async ([name = '', source = ''] = []) => {
            write(`src/${name}`, source);
            const { complete: captured = true, files: measured = [] } = await measure({ patterns: [`src/${name}`] });

            strictEqual(captured, false);
            ok(measured.some(({ complete: completed = true, problems = [] } = {}) => !completed && problems.length));
        }));
        const outside = write('../measurement-outside.js', 'export const outside = true;\n');

        try {
            await rejects(() => measure({ configFile: config, patterns: [outside] }), /outside the project/u);
        } finally {
            rmSync(outside);
        }

        write('broken.config.js', 'throw new Error("measurement configuration sentinel");\n');
        await rejects(() => measure({ configFile: 'broken.config.js' }), /measurement configuration sentinel/u);
        await rejects(() => measure({ patterns: ['src/absent.js'] }), /No files matching/u);
        deepStrictEqual(files.map(file => hash(readFileSync(file))), before);
    });
});

test('measurement identity follows installed dependency versions and lockfiles without changing finding counts', async (context) => {
    const directory = mkdtempSync(resolve('.artifacts/measurement-identity-'));
    const write = (name, source) => {
        const file = join(directory, name);

        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, source);

        return file;
    };
    const manifest = write('package.json', JSON.stringify({ name: 'measurement-consumer', type: 'module', devDependencies: { 'identity-parent': '1.0.0' } }));
    const lock = write('package-lock.json', JSON.stringify({ name: 'measurement-consumer', lockfileVersion: 3, packages: {} }));
    write('node_modules/identity-parent/package.json', JSON.stringify({ name: 'identity-parent', version: '1.0.0', type: 'module', exports: './index.js',
        dependencies: { 'identity-leaf': '^1.0.0' } }));
    write('node_modules/identity-parent/index.js', 'export {default} from "identity-leaf";\n');
    const dependency = write('node_modules/identity-leaf/package.json', JSON.stringify({ name: 'identity-leaf', version: '1.0.0', type: 'module', exports: './index.js' }));
    write('node_modules/identity-leaf/index.js', [
        'import {writeFileSync} from "node:fs";',
        'export default {rules:{report:{meta:{schema:[]},create(context){return {Program(node){',
        '    context.report({node,message:"Observed dependency rule"});',
        '    if(context.settings.changeLock) writeFileSync(context.settings.changeLock,"changed during lint");',
        '}};}}}};'
    ].join('\n'));
    const config = write('eslint.config.js', 'import plugin from "identity-parent";\nexport default [{plugins:{identity:plugin},rules:{"identity/report":"warn"}}];\n');
    write('page.js', 'export const value = 1;\n');
    const measure = (options = {}) => measureProject({ directory, configFile: config, patterns: ['page.js'], ...options });

    context.after(() => rmSync(directory, { recursive: true, force: true }));

    const first = await measure();
    const { complete = false, summary: firstSummary = {}, identity: { environmentSha256: initial = '',
        projectInputs: { lockfiles = [], dependencies: initialDependencies = {} } = {}, tool = {} } = {} } = first;
    const { dependencies: { packages: toolPackages = [] } = {} } = tool;
    const { sha256: firstDependencies = '' } = initialDependencies;

    strictEqual(complete, true);
    deepStrictEqual(lockfiles, [{ file: lock, sha256: hash(readFileSync(lock)) }]);
    ok(toolPackages.some(({ name = '', version = '', file = '', sha256 = '' } = {}) => name === 'eslint-plugin-import-x' && version && sha256 === hash(readFileSync(file))));
    writeFileSync(dependency, JSON.stringify({ name: 'identity-leaf', version: '1.0.1', type: 'module', exports: './index.js' }));
    const second = await measure();
    const { summary: secondSummary = {}, identity: { environmentSha256: updated = '', projectInputs: { dependencies: { packages = [], sha256: secondDependencies = '' } = {} } = {} } = {} } = second;

    deepStrictEqual(secondSummary, firstSummary);
    strictEqual(initial === updated, false);
    strictEqual(firstDependencies === secondDependencies, false);
    ok(packages.some(({ name = '', version = '' } = {}) => name === 'identity-leaf' && version === '1.0.1'));
    writeFileSync(lock, JSON.stringify({ name: 'measurement-consumer', lockfileVersion: 3, packages: {}, requires: true }));
    const third = await measure();
    const { summary: thirdSummary = {}, identity: { environmentSha256: locked = '', projectInputs: { dependencies: { sha256: thirdDependencies = '' } = {} } = {} } = {} } = third;

    deepStrictEqual(thirdSummary, secondSummary);
    strictEqual(secondDependencies, thirdDependencies);
    strictEqual(updated === locked, false);
    [manifest, lock, dependency].forEach(file => throws(() => saveMeasurement({ directory, file, report: third }), /distinct from source/u));
    const changing = write('changing.config.js', 'import configured from "./eslint.config.js";\n'
        + `export default [...configured,{settings:{changeLock:${JSON.stringify(lock)}}}];\n`);
    const { complete: stable = true, problems = [] } = await measure({ configFile: changing });

    strictEqual(stable, false);
    ok(problems.some(message => message.includes('Identity input changed')));
});
