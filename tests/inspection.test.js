import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { inspectJavaScript } from '../integrations/inspection.js';

test('inspection explains configured findings through the actual source session', async (context) => {
    const directory = mkdtempSync(resolve('inspection-'));
    const write = (name, source) => {
        const file = join(directory, name);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, source);

        return file;
    };
    const provider = write('src/provider.js', 'export const load = () => [];\n');
    const barrel = write('src/barrel.js', 'export { load as read } from "./provider.js";\n');
    const root = write('src/setup.js', 'export const setup = true;\n');
    const inactive = write('src/inactive.js', 'export const inactive = true;\n');
    const source = 'import { read } from "@/barrel.js";\nconst values = read();\nvalues.trim();\n';
    const file = write('src/page.js', source);
    const valid = write('src/valid.js', 'import { read } from "@/barrel.js";\nread().map(value => value);\n');
    const suppressed = write('src/suppressed.js', source.replace('values.trim();', [
        '// eslint-disable-next-line resilient/signature-contract-operation -- The test retains a contradiction to inspect its exact suppression.',
        'values.trim();'
    ].join('\n')));
    const configuration = [
        "import resilient from 'eslint-plugin-resilient';",
        'export default [',
        '    { ignores: ["**/ignored.js"] },',
        '    resilient.configs.contracts,',
        `    resilient.imports({ cwd: ${JSON.stringify(directory)}, aliases: { "@": "src" } }),`,
        `    { settings: { resilient: { roots: [${JSON.stringify(root)}] } }, rules: { "resilient/signature-contract-operation": "warn" } }`,
        '];'
    ].join('\n');
    const config = write('eslint.config.js', configuration);
    const unchanged = [provider, barrel, root, inactive, file, valid, suppressed, config].map(file => ({ file, source: readFileSync(file, 'utf8') }));

    context.after(() => rmSync(directory, { recursive: true, force: true }));

    await context.test('aliases and barrels retain producer identity, scope, severity and cursor equivalence', async () => {
        const finding = await inspectJavaScript({ fileName: file, config, find: 'values.trim()' });
        const byOffset = await inspectJavaScript({ fileName: file, offset: source.indexOf('values.trim()') });
        const { findings = {}, observations = [], activeFiles = [], configuration: { fileName: configFile = '', sha256 = '' } = {}, sourceSha256 = '' } = finding;
        const { messages = [] } = findings;
        const { findings: offsetFindings = {}, observations: offsetObservations = [] } = byOffset;

        ok(messages.some(({ ruleId = '', severity = 0 } = {}) => ruleId === 'resilient/signature-contract-operation' && severity === 1));
        ok(observations.some(({ query = '', result: { conflicts = [], producers = [] } = {} } = {}) => query === 'checkMemberAccess' &&
            conflicts.includes('array') && producers.some(({ module = '' } = {}) => module === provider)));
        deepStrictEqual(activeFiles.toSorted(), [file, barrel, provider, root].toSorted());
        strictEqual(activeFiles.includes(inactive), false);
        strictEqual(configFile, config);
        strictEqual(sha256, createHash('sha256').update(configuration).digest('hex'));
        strictEqual(sourceSha256, createHash('sha256').update(source).digest('hex'));
        deepStrictEqual(offsetFindings, findings);
        deepStrictEqual(offsetObservations, observations);
        const { findings: { messages: validMessages = [] } = {} } = await inspectJavaScript({ fileName: valid, config, find: 'read().map' });

        deepStrictEqual(validMessages, []);
    });

    await context.test('suppression and rule disabling preserve findings without inventing a diagnostic', async () => {
        const { findings: { messages = [], suppressedMessages = [] } = {} } = await inspectJavaScript({ fileName: suppressed, config, find: 'values.trim()' });

        deepStrictEqual(messages, []);
        ok(suppressedMessages.some(({ ruleId = '', severity = 0, suppressions = [] } = {}) => (
            ruleId === 'resilient/signature-contract-operation' && severity === 1 && suppressions.length
        )));
        const disabled = write('disabled.config.js', configuration.replace('"warn"', '"off"'));
        const { findings = {}, observations = [] } = await inspectJavaScript({ fileName: file, config: disabled, find: 'values.trim()' });

        deepStrictEqual(findings, { messages: [], suppressedMessages: [] });
        ok(observations.some(({ query = '', result: { conflicts = [] } = {} } = {}) => query === 'checkMemberAccess' && conflicts.includes('array')));
    });

    await context.test('the configured parser supplies the observed root evidence', async () => {
        const parsedSource = '\uFEFFconst [value] = xx;\n';
        const parsed = write('src/parsed.js', parsedSource);
        const parserConfig = write('parser.config.js', [
            "import resilient from 'eslint-plugin-resilient';",
            "import { parse } from 'espree';",
            'export default [{ plugins: { resilient }, languageOptions: { parser: { parseForESLint(source, options) {',
            '    return { ast: parse(source.replace("xx", "42"), options) };',
            '} } }, rules: { "resilient/signature-contract-destructuring": "error" } }];'
        ].join('\n'));
        const result = await inspectJavaScript({ fileName: parsed, config: parserConfig, find: 'xx' });
        const { sourceHasBOM = false, cursor: { offset = -1 } = {} } = result;

        strictEqual(sourceHasBOM, true);
        strictEqual(offset, parsedSource.indexOf('xx'));
        ok(result.findings.messages.some(({ message = '' } = {}) => message.includes('number-like')));
        ok(result.observations.some(({ query = '', result: { status = '' } = {} } = {}) => query === 'checkDestructuring' && status === 'contradiction'));
    });

    await context.test('Unicode line separators preserve physical cursor and diagnostic locations', async () => {
        const text = '\uFEFFconst values=[];\u2028const other=[];\u2029values.trim();\r\nother.trim();';
        const selected = write('src/line-separators.js', text);
        const { cursor = {}, findings: { messages = [] } = {}, lint: { warningCount = 0 } = {} }
            = await inspectJavaScript({ fileName: selected, config, find: 'values.trim()' });

        deepStrictEqual(cursor, { offset: text.indexOf('values.trim()'), range: [text.indexOf('values.trim()'), text.indexOf('values.trim()') + 13], line: 3, column: 1 });
        strictEqual(warningCount, 2);
        deepStrictEqual(messages.map(({ ruleId = '', line = 0, column = 0 } = {}) => ({ ruleId, line, column })), [
            { ruleId: 'resilient/signature-contract-operation', line: 3, column: 1 }
        ]);
    });

    await context.test('ignored, processed and malformed sources and invalid selections fail clearly', async () => {
        const ignored = write('src/ignored.js', source);
        const broken = write('src/broken.js', 'const = ;\n');
        const processor = write('processor.config.js', 'export default [{ processor: { preprocess() { throw Error("must not run"); }, postprocess(messages) { return messages.flat(); } } }];\n');

        await Promise.all([
            { options: { fileName: ignored, config, find: 'values.trim()' }, reason: /ignored/u },
            { options: { fileName: broken, config, offset: 0 }, reason: /parsed/u },
            { options: { fileName: file, config: processor, offset: 0 }, reason: /Processor-backed/u },
            { options: { fileName: file, config, find: 'values' }, reason: /exactly once/u },
            { options: { fileName: file, offset: source.length + 1 }, reason: /outside/u },
            { options: { fileName: file, find: 'values.trim()', offset: 0 }, reason: /exactly one/u }
        ].map(({ options = {}, reason = /$^/u } = {}) => rejects(() => inspectJavaScript(options), reason)));
    });

    unchanged.forEach(({ file = '', source = '' } = {}) => strictEqual(readFileSync(file, 'utf8'), source));
});

test('standalone inspection uses explicit built-in contracts outside a configured project', async (context) => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'resilient-standalone-inspection-')));
    const configuredDirectory = mkdtempSync(resolve('standalone-configuration-'));
    const write = (name, source) => {
        const file = join(directory, name);

        writeFileSync(file, source);

        return file;
    };
    const provider = write('provider.js', 'export const consume=(value="")=>value;\n');
    const barrel = write('barrel.js', 'export {consume as read} from "./provider.js";\n');
    const invalid = write('invalid.js', 'import {read} from "./barrel.js";read(42);\n');
    const valid = write('valid.js', 'import {read} from "./barrel.js";read("valid");\n');
    const ignoredConfig = write('eslint.config.js', 'throw new Error("AUTHORED CONFIGURATION FAILURE");\n');
    const config = join(configuredDirectory, 'eslint.config.js');

    writeFileSync(config, readFileSync(ignoredConfig));
    const before = [provider, barrel, invalid, valid, config, ignoredConfig].map(file => ({ file, source: readFileSync(file, 'utf8') }));

    context.after(() => rmSync(directory, { recursive: true, force: true }));
    context.after(() => rmSync(configuredDirectory, { recursive: true, force: true }));

    await Promise.all([
        { file: invalid, find: '42', expected: ['resilient/signature-contract-call-site'] },
        { file: valid, find: '"valid"', expected: [] }
    ].map(async ({ file = '', find = '', expected = [] } = {}) => {
        const { mode = '', configuration = {}, findings: { messages = [] } = {}, activeFiles = [], observations = [] }
            = await inspectJavaScript({ fileName: file, standalone: true, find });
        const { profile = '', fileName = '', sha256 = '', identity = '', parser: { name = '' } = {} } = configuration;

        strictEqual(mode, 'standalone');
        strictEqual(profile, 'resilient/contracts');
        strictEqual(fileName, '');
        strictEqual(sha256, '');
        strictEqual(identity, 'built-in-contract-rules-and-effective-severities');
        strictEqual(name, 'espree');
        deepStrictEqual(messages.map(({ ruleId = '' } = {}) => ruleId), expected);
        deepStrictEqual(activeFiles.toSorted(), [file, barrel, provider].toSorted());
        ok(observations.some(({ query = '' } = {}) => query === 'checkCall'));
    }));
    before.forEach(({ file = '', source = '' } = {}) => strictEqual(readFileSync(file, 'utf8'), source));
    await rejects(() => inspectJavaScript({ fileName: invalid, standalone: true, config, find: '42' }), /cannot combine/u);
    await rejects(() => inspectJavaScript({ fileName: invalid, config, find: '42' }), /AUTHORED CONFIGURATION FAILURE/u);
    writeFileSync(provider, 'export const = ;\n');
    await rejects(() => inspectJavaScript({ fileName: invalid, standalone: true, find: '42' }), /Unexpected token/u);
});
