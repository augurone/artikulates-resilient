import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import plugin from 'eslint-plugin-resilient/eslint';

import { ESLint, auditSource, manifest } from '../config/eslint-host.js';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const eslint = new ESLint({ cwd, overrideConfigFile: fileURLToPath(new URL('../eslint.config.js', import.meta.url)) });
const { ordinary = {}, node = {} } = JSON.parse(readFileSync(new URL('./fixtures/development-policy.json', import.meta.url), 'utf8'));
const { cases: exceptionCases = [] } = JSON.parse(readFileSync(new URL('./fixtures/exception-policy.json', import.meta.url), 'utf8'));
const messagesFor = async (source = '') => {
    const [{ messages = [] } = {}] = await eslint.lintText(source, { filePath: 'tests/eslint-probe.js' });

    return messages;
};

test('ESM lint globals reject CommonJS wrapper bindings', async () => {
    const messages = await messagesFor('require("node:fs"); module.exports = exports; __dirname; __filename;');

    strictEqual(messages.filter(({ ruleId = '' } = {}) => ruleId === 'no-undef').length, 5);
});

test('every authored area retains the full Resilient repository rule configuration', async () => {
    const files = [['analysis/agreement/index.js', ordinary], ['tests/source-ownership.test.js', ordinary], ['scripts/lint.js', ordinary], ['config/eslint-host.js', ordinary],
        ['tests/support/work.js', ordinary], ['analysis/analyzer/index.js', ordinary], ['eslint.config.js', node], ['index.js', node]];

    await Promise.all(files.map(async ([file = '', expected = {}] = []) => {
        const { rules = {}, settings = {}, languageOptions: { globals = {}, parserOptions = {} } = {}, linterOptions = {}, plugins = {} } = await eslint.calculateConfigForFile(file);
        const { rules: expectedRules = {}, settings: expectedSettings = {}, languageOptions: { globals: expectedGlobals = {}, parserOptions: expectedParserOptions = {} } = {} } = expected;
        const { reportUnusedDisableDirectives = 0, reportUnusedInlineConfigs = 0 } = linterOptions;
        const { resilient = {} } = plugins;

        deepStrictEqual(rules, expectedRules, `No dialect rule may be weakened for ${file}`);
        deepStrictEqual(settings, expectedSettings);
        deepStrictEqual(globals, expectedGlobals);
        deepStrictEqual(parserOptions, expectedParserOptions);
        strictEqual(resilient, plugin);
        strictEqual(reportUnusedDisableDirectives, 2);
        strictEqual(reportUnusedInlineConfigs, 2);
    }));
});

[
    ['recommended', 'export const choose = value => { if (value) return 1; else return 0; };\n', 'resilient/no-else', 2],
    ['product analyzer rule', 'const source = []; const { item } = source;\n', 'resilient/signature-contract-destructuring', 2],
    ['contracts at calls', "export const trim = ({ value = '' } = {}) => value.trim();\ntrim({ value: 1 });\n", 'resilient/signature-contract-call-site', 2],
    ['contracts at operations', 'export const trim = ({ value = [] } = {}) => value.trim();\n', 'resilient/signature-contract-operation', 2],
    ['safety', 'export const update = (values = []) => { values.push(1); return values; };\n', 'resilient/prefer-safe-transformations', 2],
    ['async preference', "export const later = () => Promise.resolve('').then(value => value.trim());\n", 'resilient/prefer-async-await', 1]
].forEach(([name = '', source = '', expected = '', expectedSeverity = 0] = []) => {
    test(`${name} produces its actual configured diagnostic`, async () => {
        const messages = await messagesFor(source);

        ok(messages.some(({ ruleId = '', severity = 0 } = {}) => ruleId === expected && severity === expectedSeverity));
    });
});

test('valid declared contracts and unknown external receivers are accepted', async () => {
    const results = await Promise.all([
        messagesFor("export const read = ({ label = '' } = {}) => label;\n"),
        messagesFor('export const trim = value => value.trim();\n')
    ]);

    deepStrictEqual(results, [[], []]);
});

test('an unused local exception is an error', async () => {
    const messages = await messagesFor('// eslint-disable-next-line no-console -- This operation writes a CLI report.\nexport const label = \'\';\n');

    ok(messages.some(({ severity = 0, message = '' } = {}) => severity === 2 && message.startsWith('Unused eslint-disable directive')));
});

test('the local exception auditor rejects broad, unexplained, inline-policy and multi-statement exceptions', () => {
    const invalid = [
        '/* eslint-disable */\nexport const label = \'\';\n',
        '// eslint-disable-next-line no-console\nconsole.log(1);\n',
        '/* eslint-disable no-console -- These calls write reports. */\nconsole.log(1);\nconsole.log(2);\n/* eslint-enable */\n',
        '/* eslint resilient/no-else: "off" */\nconst choose=value=>{if(value)return 1;else return 0;};',
        '/* eslint no-console: "warn" */\nconsole.log(1);',
        '/* eslint audit/capture-source-code: "off" */\nconst value = 1;',
        '/* eslint-disable-next-line no-console -- The wrong comment form. */\nconsole.log(1);',
        'const = ;'
    ];

    invalid.forEach(source => ok(auditSource(source).length));
    deepStrictEqual(auditSource('// eslint-disable-next-line no-console -- This CLI operation writes its report.\nconsole.log(1);\n'), []);
    deepStrictEqual(auditSource('/* eslint-disable no-console -- This CLI operation writes one report. */\nconsole.log(1);\n/* eslint-enable no-console */'), []);
});

exceptionCases.forEach(({ source = '', problems = [] } = {}, index) => {
    test(`retained exception-policy outcome ${index + 1}`, () => {
        deepStrictEqual(auditSource(source), problems);
    });
});

test('verification uses the local product and declared tools without an independent checker', () => {
    const { kind = '', root = '', customRuleOwner = '' } = manifest;

    deepStrictEqual([kind, root, customRuleOwner], ['local-product-verification', '.', 'eslint-plugin-resilient/eslint']);
    const { toolVersions: { eslint: version = '' } = {} } = manifest;

    strictEqual(version, ESLint.version);
});

test('authored code is included while installed dependencies and generated reports are excluded', async () => {
    const files = ['analysis/agreement/index.js', 'tests/source-ownership.test.js', 'scripts/lint.js', 'config/eslint-host.js',
        'tests/support/work.js', 'analysis/analyzer/index.js'];
    const authored = await Promise.all(files.map(file => eslint.isPathIgnored(file)));
    const generated = await Promise.all(['node_modules/espree/espree.js', '.artifacts/generated.js']
        .map(file => eslint.isPathIgnored(file)));

    deepStrictEqual(authored, [false, false, false, false, false, false]);
    deepStrictEqual(generated, [true, true]);
});

test('the bad.js canary exposes every public rule through normal file linting', async () => {
    const file = 'tests/fixtures/bad.js';

    strictEqual(await eslint.isPathIgnored(file), false);
    const [{ messages = [], fatalErrorCount = 0, suppressedMessages = [] } = {}] = await eslint.lintFiles([file]);
    const findings = new Set(messages.map(({ ruleId = '' } = {}) => ruleId));

    strictEqual(fatalErrorCount, 0);
    deepStrictEqual(suppressedMessages, []);
    Object.keys(plugin.rules).forEach(rule => ok(findings.has(`resilient/${rule}`), `Missing normal lint finding for ${rule}`));
});

test('the lint command forwards concurrency and preserves complete findings through its real CLI', () => {
    const script = fileURLToPath(new URL('../scripts/lint.js', import.meta.url));
    const reportFile = new URL('../.artifacts/lint-results.json', import.meta.url);
    const previousReport = existsSync(reportFile) ? readFileSync(reportFile) : false;
    const files = ['analysis/host/function.js', 'analysis/host/array.js', 'analysis/host/object.js', 'analysis/collections.js'];
    const missing = '.artifacts/nonexistent-lint-command-input.js';
    const { execPath = '' } = process;
    const run = args => spawnSync(execPath, [script, ...args], { cwd, encoding: 'utf8', timeout: 30000 });
    const readReport = () => JSON.parse(readFileSync(reportFile, 'utf8'));
    const findings = ({ runtime = '', manifest = {}, sourceHashes = {}, summary = {}, exceptions = [], results = [] } = {}) => ({
        runtime, manifest, sourceHashes, summary, exceptions,
        results: results.map(({ filePath = '', messages = [], suppressedMessages = [] } = {}) => ({ filePath, messages, suppressedMessages }))
    });

    try {
        const parallel = spawnSync('npm', ['run', 'lint', '--', '--concurrency=3', '--report', '--stats', ...files], { cwd, encoding: 'utf8', timeout: 30000 });
        const { status: parallelStatus = -1, stderr: parallelError = '' } = parallel;

        strictEqual(parallelStatus, 0, parallelError);
        const parallelReport = readReport();
        const { execution = {}, measurements: { lintMilliseconds = -1, auditMilliseconds = -1, totalMilliseconds = -1,
            cpu: { user = -1, system = -1 } = {}, maxRSSKiB = -1 } = {}, sourceHashes = {}, manifest: reportedManifest = {} } = parallelReport;

        deepStrictEqual(execution, { concurrency: 3, stats: true, patterns: files });
        deepStrictEqual(reportedManifest, manifest);
        deepStrictEqual(Object.keys(sourceHashes).toSorted(), files.toSorted());
        [lintMilliseconds, auditMilliseconds, totalMilliseconds, user, system].forEach(value => ok(Number.isFinite(value) && value >= 0));
        ok(totalMilliseconds >= lintMilliseconds && totalMilliseconds >= auditMilliseconds);
        ok(Number.isFinite(maxRSSKiB) && maxRSSKiB > 0);
        const { status: serialStatus = -1, stderr: serialError = '' } = run(['--concurrency', 'off', '--report', ...files]);

        strictEqual(serialStatus, 0, serialError);
        const serialReport = readReport();
        const { execution: serialExecution = {} } = serialReport;

        deepStrictEqual(serialExecution, { concurrency: 'off', stats: false, patterns: files });
        deepStrictEqual(findings(serialReport), findings(parallelReport));
        const { status: autoStatus = -1, stderr: autoError = '' } = run(['--concurrency', 'auto', '--report', ...files]);

        strictEqual(autoStatus, 0, autoError);
        const autoReport = readReport();
        const { execution: autoExecution = {} } = autoReport;

        deepStrictEqual(autoExecution, { concurrency: 'auto', stats: false, patterns: files });
        deepStrictEqual(findings(autoReport), findings(parallelReport));
        const completedReport = readFileSync(reportFile);
        const { status: helpStatus = -1, stdout: helpOutput = '', stderr: helpError = '' } = run(['--help', missing]);

        strictEqual(helpStatus, 0, helpError);
        ok(helpOutput.includes('--concurrency') && helpOutput.includes('--report'));
        deepStrictEqual(readFileSync(reportFile), completedReport);
        const invalid = [
            ['--unknown', missing], ['--concurrency'], ['--concurrency', '0', missing], ['--concurrency', '-1', missing],
            ['--concurrency', '1.5', missing], ['--concurrency', '3x', missing]
        ];

        invalid.forEach((args) => {
            const { status = -1, stderr = '' } = run(args);

            strictEqual(status, 1, stderr);
            ok(stderr.includes(args.at(0)));
            strictEqual(stderr.includes('No files matching'), false);
            deepStrictEqual(readFileSync(reportFile), completedReport);
        });
        const { status: missingStatus = -1, stderr: missingError = '' } = run(['--concurrency', 'off', missing]);

        strictEqual(missingStatus, 1, missingError);
        ok(missingError.includes('No files matching'));
        deepStrictEqual(readFileSync(reportFile), completedReport);
        const { status: canaryStatus = -1, stdout: canaryOutput = '', stderr: canaryError = '' } = run(['--concurrency', 'off', 'tests/fixtures/bad.js']);

        strictEqual(canaryStatus, 1, canaryError);
        Object.keys(plugin.rules).forEach(rule => ok(canaryOutput.includes(`resilient/${rule}`), `CLI missing ${rule}`));
        strictEqual(canaryOutput.includes('File ignored'), false);
        deepStrictEqual(readFileSync(reportFile), completedReport);
    } finally {
        if (previousReport) writeFileSync(reportFile, previousReport);

        if (!previousReport) rmSync(reportFile, { force: true });
    }
});
