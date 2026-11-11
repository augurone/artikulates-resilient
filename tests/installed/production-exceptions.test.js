import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { auditSource } from 'eslint-plugin-resilient/audit';
import { checkFiles } from 'eslint-plugin-resilient/check';

const directory = mkdtempSync(resolve('exceptions-'));

writeFileSync(join(directory, 'eslint.config.js'), "import production from 'eslint-plugin-resilient/production';\nexport default production();\n");

const { cases = [] } = JSON.parse(readFileSync(new URL('../fixtures/exception-policy.json', import.meta.url), 'utf8'));
const verify = async (name, source, fix = false) => {
    const file = join(directory, `${name}.js`);

    writeFileSync(file, source);

    return checkFiles({ cwd: directory, files: [file], fix });
};

cases.forEach(({ source = '', problems = [] } = {}, index) => {
    test(`installed auditor preserves frozen policy outcome ${index + 1}`, () => deepStrictEqual(auditSource(source), problems));
});

[
    ['severity', '/* eslint no-console: "off" */\nconsole.log(1);\n'],
    ['warning', '/* eslint no-console: "warn" */\nconsole.log(1);\n'],
    ['blanket', '/* eslint-disable */\nconsole.log(1);\n'],
    ['auditor', '/* eslint audit/capture-source-code: "off" */\nexport const value = 1;\n'],
    ['unexplained', '// eslint-disable-next-line no-console\nconsole.log(1);\n'],
    ['wide', '/* eslint-disable no-console -- Report two calls. */\nconsole.log(1);\nconsole.log(2);\n/* eslint-enable */\n']
].forEach(([name = '', source = ''] = []) => {
    test(`mandatory check rejects ${name} and does not fix forbidden source`, async () => {
        const { exitCode = 0, exceptions = [] } = await verify(name, source, true);

        strictEqual(exitCode, 1);
        ok(exceptions.length);
        strictEqual(readFileSync(join(directory, `${name}.js`), 'utf8'), source);
    });
});

test('justified next-line and one-statement scoped exceptions preserve suppressed findings', async () => {
    const sources = [
        '// eslint-disable-next-line no-console -- This CLI writes its requested report.\nconsole.log(1);\n',
        '/* eslint-disable no-console -- This CLI writes its requested report. */\nconsole.log(1);\n/* eslint-enable no-console */\n'
    ];

    await Promise.all(sources.map(async (source, index) => {
        const { exitCode = 1, exceptions = [], results: [{ suppressedMessages = [] } = {}] = [] } = await verify(`valid-${index}`, source);

        strictEqual(exitCode, 0);
        deepStrictEqual(exceptions, []);
        deepStrictEqual(suppressedMessages.map(({ ruleId = '', severity = 0, line = 0, column = 0 } = {}) => ({ ruleId, severity, line, column })),
            [{ ruleId: 'no-console', severity: 2, line: 2, column: 1 }]);
    }));
});

test('unused exceptions fail even when host config requests no unused-directive reporting', async () => {
    const config = join(directory, 'lenient.config.js');

    writeFileSync(config, "import production from 'eslint-plugin-resilient/production';\nexport default [...production(), {linterOptions:{reportUnusedDisableDirectives:'off'}}];\n");
    const file = join(directory, 'unused.js');

    writeFileSync(file, '// eslint-disable-next-line no-console -- This report once used console output.\nexport const value = 1;\n');

    const { exitCode = 0, results: [{ messages = [] } = {}] = [] } = await checkFiles({ cwd: directory, files: [file], overrideConfigFile: config });

    strictEqual(exitCode, 1);
    ok(messages.some(({ severity = 0, message = '' } = {}) => severity === 2 && message.startsWith('Unused eslint-disable')));
});

test('external import ordering and configured fixes produce the exact expected source', async () => {
    const source = 'import { join } from "node:path";\nimport { readFileSync } from "node:fs";\n\nexport { join, readFileSync };\n';
    const { exitCode: before = 0, results: [{ messages = [] } = {}] = [] } = await verify('ordering', source);

    strictEqual(before, 1);
    ok(messages.some(({ ruleId = '', fix = {} } = {}) => ruleId === 'import/order' && Object.hasOwn(fix, 'text')));
    const { exitCode: after = 1 } = await verify('ordering', source, true);

    strictEqual(after, 0);
    strictEqual(readFileSync(join(directory, 'ordering.js'), 'utf8'),
        'import { readFileSync } from "node:fs";\nimport { join } from "node:path";\n\nexport { join, readFileSync };\n');
});

test('parser and configuration failures fail the check', async () => {
    const { exitCode = 0, results: [{ fatalErrorCount = 0 } = {}] = [] } = await verify('syntax', 'const = ;');

    strictEqual(exitCode, 1);
    strictEqual(fatalErrorCount, 1);
    const config = join(directory, 'broken.config.js');

    writeFileSync(config, 'throw new Error("configuration failure sentinel");');
    await rejects(() => checkFiles({ cwd: directory, files: ['syntax.js'], overrideConfigFile: config }), /configuration failure sentinel/u);
    await rejects(() => checkFiles({ cwd: directory, files: ['absent.js'] }), /No files matching/u);
});

test('installed npm check and fix use the executable enforcement path', () => {
    const bin = resolve('node_modules/.bin/resilient-check');
    const { execPath = '' } = process;
    const help = spawnSync(execPath, [bin, '--help'], { encoding: 'utf8' });
    const { status: helpStatus = -1, stdout: helpOutput = '' } = help;

    strictEqual(helpStatus, 0);
    ok(helpOutput.includes('resilient-check'));
    const source = '/* eslint no-console: "off" */\nconsole.log(1);\n';
    const file = join(directory, 'cli.js');

    writeFileSync(file, source);
    ['check', 'fix'].forEach((command) => {
        const result = spawnSync('npm', ['run', command, '--', file], { encoding: 'utf8' });
        const { status: resultStatus = -1, stdout: resultOutput = '', stderr: resultError = '' } = result;

        strictEqual(resultStatus, 1, resultError);
        ok(resultOutput.includes('Only // eslint-disable-next-line'));
        strictEqual(readFileSync(file, 'utf8'), source);
    });
    writeFileSync(file, 'export const value=1\n');

    const fixed = spawnSync('npm', ['run', 'fix', '--', file], { encoding: 'utf8' });
    const { status: fixedStatus = -1, stdout: fixedOutput = '', stderr: fixedError = '' } = fixed;

    strictEqual(fixedStatus, 0, fixedOutput + fixedError);
    strictEqual(readFileSync(file, 'utf8'), 'export const value=1;\n');
    const checked = spawnSync('npm', ['run', 'check', '--', file], { encoding: 'utf8' });
    const { status: checkedStatus = -1, stdout: checkedOutput = '', stderr: checkedError = '' } = checked;

    strictEqual(checkedStatus, 0, checkedOutput + checkedError);
    writeFileSync(file, 'export const value=1\n');
    const natural = spawnSync(execPath, [bin, file], { encoding: 'utf8' });
    const { status: naturalStatus = -1, stdout: naturalOutput = '' } = natural;

    strictEqual(naturalStatus, 1);
    ok(naturalOutput.includes('Missing semicolon'));
    ok(!naturalOutput.trimStart().startsWith('{'));
    const detailed = spawnSync(execPath, [bin, '--json', file], { encoding: 'utf8' });
    const { status: detailedStatus = -1, stdout: detailedOutput = '' } = detailed;
    const { exitCode: detailedExit = 0, results: detailedResults = [] } = JSON.parse(detailedOutput);

    strictEqual(detailedStatus, 1);
    strictEqual(detailedExit, 1);
    strictEqual(detailedResults.length, 1);
    const unknown = spawnSync(execPath, [bin, '--no-audit'], { encoding: 'utf8' });
    const { status: unknownStatus = -1, stderr: unknownError = '' } = unknown;

    strictEqual(unknownStatus, 1);
    ok(unknownError.includes('Unknown option'));
});
