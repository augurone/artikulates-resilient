import { deepStrictEqual, match, notStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';

import { jobSources, observeJobApplication } from '../support/job-application.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('installed lowering publishes complete fluency observations and preserves failed publication', async (context) => {
    const directory = mkdtempSync(resolve('lowering-'));
    const sourceDirectory = join(directory, 'src');
    const output = join(directory, 'output');
    const report = join(directory, 'fluency.json');
    const manifest = join(directory, 'manifest.json');
    const config = join(directory, 'eslint.config.js');
    const file = join(output, 'main.js');
    const { execPath = '' } = process;
    const loader = resolve('isolation-loader.js');
    const binary = resolve('node_modules/.bin/resilient-lower');
    const run = args => spawnSync(execPath, ['--experimental-loader', loader, ...args], { encoding: 'utf8' });
    const lower = (flags = []) => {
        const { status = -1, stdout = '', stderr = '' } = run([
            binary, '--project', directory, '--outDir', output, '--eslint-config', config, ...flags
        ]);

        return { status, stdout, stderr };
    };
    const sources = {
        'value.ts': 'export const value = 41;\n',
        'main.ts': [
            'import { value } from "@/value";',
            'export const answer = value + 1;',
            'export const greeting: string = "hello";',
            'export const attempt = (work: () => void) => { try { work(); } catch {} };',
            '// eslint-disable-next-line quotes -- Retain this authored quote choice.',
            'export const retained: string = "kept";',
            ''
        ].join('\n')
    };
    const configuration = JSON.stringify({ compilerOptions: {
        target: 'ES2020', module: 'ESNext', moduleResolution: 'Bundler', rootDir: 'src', paths: { '@/*': ['./src/*'] }
    }, include: ['src/**/*.ts'] });
    const profile = [
        "import resilient from 'eslint-plugin-resilient';",
        "export default [{ files: ['**/*.js'], plugins: { resilient },",
        "rules: { quotes: ['error', 'single'], 'resilient/no-silent-catch': 'error' } }];",
        ''
    ].join('\n');
    const observeRuntime = () => {
        const { status = -1, stderr = '' } = run(['--input-type=module', '-e', [
            "import assert from 'node:assert/strict';",
            'const {answer, greeting, retained, attempt} = await import(process.argv[1]);',
            "assert.deepEqual([answer, greeting, retained], [42, 'hello', 'kept']);",
            'let calls = 0; attempt(() => { calls += 1; throw new Error("native failure"); });',
            'assert.equal(calls, 1);'
        ].join('\n'), pathToFileURL(file).href]);

        strictEqual(status, 0, stderr);
    };
    const published = () => [file, join(output, 'value.js'), report, manifest].map(name => hash(readFileSync(name)));

    mkdirSync(sourceDirectory);
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}\n');
    writeFileSync(join(directory, 'tsconfig.json'), configuration);
    Object.entries(sources).forEach(([name = '', source = ''] = []) => writeFileSync(join(sourceDirectory, name), source));
    writeFileSync(config, profile);

    await context.test('inspection selects source dependencies without publishing', () => {
        const { status = -1, stdout = '', stderr = '' } = lower(['--inspect']);
        const { selectedSources = [], runtimeRoutes = [] } = JSON.parse(stdout);

        strictEqual(status, 0, stderr);
        deepStrictEqual(selectedSources.toSorted(), Object.keys(sources).map(name => join(sourceDirectory, name)).toSorted());
        ok(runtimeRoutes.some(({ specifier = '', runtimeSpecifier = '' } = {}) => specifier === '@/value' && runtimeSpecifier === './value.js'));
        [output, report, manifest].forEach(name => strictEqual(existsSync(name), false));
    });

    await context.test('report-only keeps raw output, active findings, suppressions and identities', () => {
        const { status = -1, stderr = '' } = lower(['--report', report, '--manifest', manifest]);
        const { complete = false, clean = true, fixApplied = true, postFix = {}, raw = {}, published: summary = {}, coverage = {}, files = [] }
            = JSON.parse(readFileSync(report, 'utf8'));
        const row = files.find(({ filePath = '' } = {}) => filePath === file);
        const { raw: result = {}, profile: identity = {}, rawSha256 = '', publishedSha256 = '' } = row;
        const { messages = [], suppressedMessages = [] } = result;
        const { configFile = '', configSha256 = '' } = identity;

        strictEqual(status, 0, stderr);
        strictEqual(complete, true);
        strictEqual(clean, false);
        strictEqual(fixApplied, false);
        strictEqual(postFix, null);
        deepStrictEqual(raw, summary);
        deepStrictEqual(coverage, { expected: 2, measured: 2 });
        strictEqual(rawSha256, hash(readFileSync(file)));
        strictEqual(publishedSha256, rawSha256);
        strictEqual(configFile, config);
        strictEqual(configSha256, hash(profile));
        ok(messages.some(({ ruleId = '' } = {}) => ruleId === 'resilient/no-silent-catch'));
        strictEqual(suppressedMessages.filter(({ ruleId = '' } = {}) => ruleId === 'quotes').length, 1);
        match(readFileSync(file, 'utf8'), /"hello"/u);
        observeRuntime();
    });

    await context.test('fix and report distinguish raw, fixed and published observations', () => {
        const { status = -1, stderr = '' } = lower(['--fix', '--report', report, '--manifest', manifest]);
        const { complete = false, clean = true, fixApplied = false, changedFiles = 0, raw = {}, postFix = {}, published: summary = {}, files = [] }
            = JSON.parse(readFileSync(report, 'utf8'));
        const row = files.find(({ filePath = '' } = {}) => filePath === file);
        const { rawSha256 = '', publishedSha256 = '' } = row;
        const { errors: rawErrors = -1 } = raw;
        const { errors: fixedErrors = -1 } = postFix;

        strictEqual(status, 0, stderr);
        strictEqual(complete, true);
        strictEqual(clean, false);
        strictEqual(fixApplied, true);
        strictEqual(changedFiles, 1);
        ok(rawErrors > fixedErrors);
        strictEqual(fixedErrors, 1);
        deepStrictEqual(postFix, summary);
        notStrictEqual(rawSha256, publishedSha256);
        strictEqual(publishedSha256, hash(readFileSync(file)));
        match(readFileSync(file, 'utf8'), /'hello'/u);
        observeRuntime();
    });

    await context.test('configuration failure returns nonzero and retains prior artifacts', () => {
        const before = published();

        writeFileSync(config, 'throw new Error("installed fluency failure");\n');
        const { status = -1, stderr = '' } = lower(['--fix', '--report', report, '--manifest', manifest]);

        strictEqual(status, 1);
        match(stderr, /installed fluency failure/u);
        deepStrictEqual(published(), before);
    });

    Object.entries(sources).forEach(([name = '', source = ''] = []) => strictEqual(readFileSync(join(sourceDirectory, name), 'utf8'), source));
    strictEqual(readFileSync(join(directory, 'tsconfig.json'), 'utf8'), configuration);
});

test('installed project jobs preserve native effects, identity and failures through raw and fixed JavaScript', async (context) => {
    const directory = mkdtempSync(resolve('job-application-'));
    const sourceDirectory = join(directory, 'src');
    const output = join(directory, 'output');
    const nativeDirectory = join(directory, 'native');
    const report = join(directory, 'fluency.json');
    const manifest = join(directory, 'manifest.json');
    const config = join(directory, 'eslint.config.js');
    const profile = "import production from 'eslint-plugin-resilient/production';\n"
        + `export default production({ cwd: ${JSON.stringify(directory)} });\n`;
    const configuration = JSON.stringify({ compilerOptions: {
        target: 'ESNext', module: 'ESNext', moduleResolution: 'Bundler', rootDir: 'src', strict: true, skipLibCheck: true
    }, include: ['src/**/*.ts'] });
    const packageSource = '{"private":true,"type":"module","dependencies":{"eslint-plugin-resilient":"*"}}\n';
    const { execPath = '' } = process;

    context.after(() => rmSync(directory, { recursive: true, force: true }));
    mkdirSync(sourceDirectory);
    mkdirSync(nativeDirectory);
    writeFileSync(join(directory, 'package.json'), packageSource);
    writeFileSync(join(directory, 'tsconfig.json'), configuration);
    writeFileSync(config, profile);
    Object.entries(jobSources).forEach(([name = '', source = ''] = []) => {
        writeFileSync(join(sourceDirectory, name), source);
        const { outputText = '', diagnostics = [] } = typescript.transpileModule(source, { fileName: name, reportDiagnostics: true,
            compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext } });

        deepStrictEqual(diagnostics, []);
        writeFileSync(join(nativeDirectory, name.replace(/\.ts$/u, '.js')), outputText);
    });
    const { fileNames = [], options = {}, errors = [] } = typescript.parseJsonConfigFileContent(JSON.parse(configuration), typescript.sys, directory);
    const program = typescript.createProgram(fileNames, options);

    deepStrictEqual(errors, []);
    deepStrictEqual(fileNames.toSorted(), Object.keys(jobSources).map(name => join(sourceDirectory, name)).toSorted());
    deepStrictEqual(typescript.getPreEmitDiagnostics(program), []);
    const native = await observeJobApplication(nativeDirectory);
    const { status = -1, stderr = '' } = spawnSync(execPath, ['--experimental-loader', resolve('isolation-loader.js'),
        resolve('node_modules/.bin/resilient-lower'), '--project', directory, '--outDir', output,
        '--eslint-config', config, '--fix', '--report', report, '--manifest', manifest], { encoding: 'utf8' });

    strictEqual(status, 0, stderr);
    const { configuration: { artifactRoot = '' } = {}, artifacts = [], selectedSources = [], publishedVariant = '' }
        = JSON.parse(readFileSync(manifest, 'utf8'));
    const expectedFiles = Object.keys(jobSources).map(name => name.replace(/\.ts$/u, '.js')).toSorted();

    strictEqual(publishedVariant, 'fixed');
    deepStrictEqual(artifacts.map(({ output: file = '' } = {}) => file).toSorted(), expectedFiles);
    deepStrictEqual(readdirSync(output).toSorted(), expectedFiles);
    deepStrictEqual(selectedSources.map(({ path: file = '' } = {}) => file).toSorted(), Object.keys(jobSources).map(name => join(sourceDirectory, name)).toSorted());
    selectedSources.forEach(({ path: file = '', sha256 = '' } = {}) => strictEqual(sha256, hash(readFileSync(file))));
    artifacts.forEach(({ source: { path: source = '', sha256: sourceHash = '' } = {}, output: file = '',
        variants = {}, diagnostics = [] } = {}) => {
        const { fixed: { sha256: fixedHash = '' } = {} } = variants;

        deepStrictEqual(diagnostics, []);
        strictEqual(sourceHash, hash(readFileSync(source)));
        Object.values(variants).forEach(({ path: relative = '', sha256 = '' } = {}) => strictEqual(sha256, hash(readFileSync(join(artifactRoot, relative)))));
        strictEqual(fixedHash, hash(readFileSync(join(output, file))));
    });
    deepStrictEqual(await observeJobApplication(join(artifactRoot, 'raw')), native);
    deepStrictEqual(await observeJobApplication(output), native);
    const { complete = false, clean = false, fixApplied = false, coverage = {}, files = [], raw: rawSummary = {}, published = {}, postFix: fixedSummary = {} }
        = JSON.parse(readFileSync(report, 'utf8'));

    strictEqual(complete, true);
    strictEqual(clean, true);
    strictEqual(fixApplied, true);
    deepStrictEqual(coverage, { expected: 4, measured: 4 });
    deepStrictEqual(files.map(({ filePath = '' } = {}) => filePath).toSorted(), expectedFiles.map(file => join(output, file)));
    deepStrictEqual(published, fixedSummary);
    [rawSummary, published].forEach(({ errors: errorCount = -1, warnings = -1 } = {}) => {
        strictEqual(errorCount, 0);
        strictEqual(warnings, 0);
    });
    const allowedRules = new Map([
        [join(sourceDirectory, 'input.ts'), ['resilient/prefer-signature-destructuring', 'resilient/prefer-destructured-member-access']],
        [join(sourceDirectory, 'provider.ts'), ['func-style']],
        [join(sourceDirectory, 'task.ts'), ['func-style', 'resilient/prefer-safe-destructuring-defaults']],
        [join(sourceDirectory, 'main.ts'), []]
    ]);
    const reasons = new Map([
        ['resilient/prefer-signature-destructuring', /binding.*copy.*failure.*order/u],
        ['resilient/prefer-destructured-member-access', /Get.*count.*order.*phase/u],
        ['func-style', /declaration.*hoisting.*callable capabilities/u],
        ['resilient/prefer-safe-destructuring-defaults', /tuple.*native.*failure/u]
    ]);
    files.forEach(({ source = '', filePath = '', rawSha256 = '', publishedSha256 = '',
        profile: { configFile = '', configSha256 = '', rules = {} } = {}, raw = {}, postFix = {} } = {}) => {
        const artifact = artifacts.find(({ source: { path: input = '' } = {} } = {}) => input === source);

        ok(artifact);
        const { output: relative = '', variants: { raw: { path: rawPath = '', sha256: rawHash = '' } = {}, fixed: { sha256: fixedHash = '' } = {} } = {} } = artifact;

        strictEqual(filePath, join(output, relative));
        strictEqual(rawSha256, rawHash);
        strictEqual(publishedSha256, fixedHash);
        strictEqual(configFile, config);
        strictEqual(configSha256, hash(profile));
        Object.keys(resilient.rules).forEach(name => ok(Object.hasOwn(rules, `resilient/${name}`)));
        [raw, postFix].forEach((result, index) => {
            const { fatalErrorCount = -1, errorCount = -1, warningCount = -1 } = result;
            const messages = Reflect.get(result, 'messages');
            const suppressed = Reflect.get(result, 'suppressedMessages');
            const code = readFileSync(index ? filePath : join(artifactRoot, rawPath), 'utf8');
            const syntax = typescript.createSourceFile(filePath, code, typescript.ScriptTarget.ESNext, true);
            const expected = allowedRules.get(source) || [];

            strictEqual(fatalErrorCount, 0);
            strictEqual(errorCount, 0);
            strictEqual(warningCount, 0);
            ok(Array.isArray(messages));
            ok(Array.isArray(suppressed));
            deepStrictEqual(messages, []);
            suppressed.forEach(({ ruleId = '', line = 0, column = 0, endLine = 0, endColumn = 0, suppressions = [] } = {}) => {
                ok(expected.includes(ruleId));
                ok(suppressions.length);
                const boundary = code.slice(syntax.getPositionOfLineAndCharacter(line - 1, column - 1),
                    syntax.getPositionOfLineAndCharacter(endLine - 1, endColumn - 1));

                if (ruleId === 'resilient/prefer-signature-destructuring') match(boundary, /\bvalue\b[\s\S]*\.\.\.rest/u);

                if (ruleId === 'resilient/prefer-destructured-member-access') match(boundary, /\binput\.value\b/u);

                if (ruleId === 'func-style') match(boundary, /function (?:readProvider|runTask)\b/u);

                if (ruleId === 'resilient/prefer-safe-destructuring-defaults') match(boundary, /\b(?:callback|value)\b/u);

                suppressions.forEach(({ kind = '', justification = '' } = {}) => {
                    strictEqual(kind, 'directive');
                    match(justification, reasons.get(ruleId));
                });
            });
        });
    });
    Object.entries(jobSources).forEach(([name = '', source = ''] = []) => strictEqual(readFileSync(join(sourceDirectory, name), 'utf8'), source));
    [[config, profile], [join(directory, 'tsconfig.json'), configuration], [join(directory, 'package.json'), packageSource]]
        .forEach(([file = '', source = ''] = []) => strictEqual(readFileSync(file, 'utf8'), source));
});
