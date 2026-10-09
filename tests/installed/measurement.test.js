import { deepStrictEqual, match, ok, strictEqual } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { checkFiles } from 'eslint-plugin-resilient/check';

test('installed measurement and audit commands preserve report, inventory and exit contracts', async (context) => {
    const directory = mkdtempSync(resolve('measurement-cli-'));
    const binary = resolve('node_modules/.bin/resilient-measure');
    const auditor = resolve('node_modules/.bin/resilient-audit');
    const loader = resolve('isolation-loader.js');
    const write = (name, source) => {
        const file = join(directory, name);

        writeFileSync(file, source);

        return file;
    };
    const run = (args, executable = binary) => spawnSync(process.execPath, ['--experimental-loader', loader, executable, '--project', directory, ...args], {
        encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024
    });
    const config = write('eslint.config.js', 'export default [{rules:{"no-console":"error"},linterOptions:{reportUnusedDisableDirectives:"off"}}];\n');
    const source = [
        'console.log("active");',
        '// eslint-disable-next-line no-console -- This fixture retains a requested report.',
        'console.log("suppressed");',
        '// eslint-disable-next-line no-console -- The former report is now absent.',
        'export const value = 1;'
    ].join('\n');
    const file = write('page.js', source);
    const destination = join(directory, 'report.json');
    const { status = -1, stdout = '', stderr = '' } = run(['--config', config, '--report', destination, 'page.js']);

    context.after(() => rmSync(directory, { recursive: true, force: true }));
    strictEqual(status, 0, stderr);
    const measured = JSON.parse(stdout);
    const { complete = false, active = [], suppressed = [] } = measured;

    strictEqual(complete, true);
    deepStrictEqual(active.map(({ ruleId = '', severity = 0 } = {}) => [ruleId, severity]), [['no-console', 2]]);
    deepStrictEqual(suppressed.map(({ ruleId = '' } = {}) => ruleId), ['no-console']);
    deepStrictEqual(JSON.parse(readFileSync(destination, 'utf8')), measured);
    const { exitCode = 0, results: [{ messages = [] } = {}] = [] } = await checkFiles({ cwd: directory, files: ['page.js'] });

    strictEqual(exitCode, 1);
    ok(messages.some(({ ruleId = '', severity = 0 } = {}) => ruleId === 'no-console' && severity === 2));
    const { status: inventoryStatus = -1, stdout: inventory = '', stderr: inventoryError = '' } = run(['--inventory', 'page.js'], auditor);

    strictEqual(inventoryStatus, 0, inventoryError);
    deepStrictEqual(JSON.parse(inventory), measured);
    const { status: unusedStatus = -1, stdout: unused = '', stderr: unusedError = '' } = run(['--inventory', '--unused', 'page.js'], auditor);
    const { identity: { profile = '' } = {}, exceptions = [] } = JSON.parse(unused);

    strictEqual(unusedStatus, 0, unusedError);
    strictEqual(profile, 'unused-directives');
    deepStrictEqual(exceptions.map(({ unusedRules = [] } = {}) => unusedRules), [['no-console']]);
    write('unclosed.js', '/* eslint-disable no-console -- This missing closing boundary must fail enforcement. */\nconsole.log("unclosed");\n');
    const { status: auditStatus = -1, stdout: audited = '' } = run(['unclosed.js'], auditor);
    const { complete: auditComplete = false, auditProblems = [] } = JSON.parse(audited);

    strictEqual(auditStatus, 1);
    strictEqual(auditComplete, true);
    ok(auditProblems.some(({ message = '' } = {}) => message.includes('must close')));
    write('syntax.js', 'const = ;');
    const { status: parseStatus = -1, stdout: parsed = '' } = run(['syntax.js']);

    strictEqual(parseStatus, 1);
    strictEqual(JSON.parse(parsed).complete, false);
    write('broken.config.js', 'throw new Error("measurement configuration sentinel");\n');
    const { status: brokenStatus = -1, stderr: brokenError = '' } = run(['--config', 'broken.config.js', 'page.js']);

    strictEqual(brokenStatus, 1);
    match(brokenError, /measurement configuration sentinel/u);
    const { status: invalidStatus = -1, stderr: invalidError = '' } = run(['--unused', 'page.js']);

    strictEqual(invalidStatus, 1);
    match(invalidError, /--unused requires --inventory/u);
    strictEqual(readFileSync(file, 'utf8'), source);
});
