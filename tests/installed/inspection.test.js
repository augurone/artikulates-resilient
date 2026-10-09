import { deepStrictEqual, match, ok, strictEqual } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

test('installed inspection selects configured or standalone evidence and reports CLI failures', (context) => {
    const directory = mkdtempSync(resolve('inspection-cli-'));
    const binary = resolve('node_modules/.bin/resilient-inspect');
    const loader = resolve('isolation-loader.js');
    const write = (name, source) => {
        const file = join(directory, name);

        writeFileSync(file, source);

        return file;
    };
    const run = args => spawnSync(process.execPath, ['--experimental-loader', loader, binary, ...args], { encoding: 'utf8', timeout: 30000 });
    const source = 'import {read} from "./barrel.js";\nread(42);\n';
    const provider = write('provider.js', 'export const consume=(value="")=>value;\n');
    const barrel = write('barrel.js', 'export {consume as read} from "./provider.js";\n');
    const file = write('page.js', source);
    const configuration = 'import resilient from "eslint-plugin-resilient";\nexport default [resilient.configs.contracts];\n';
    const config = write('eslint.config.js', configuration);
    const { status = -1, stdout = '', stderr = '' } = run([file, '--config', config, '--find', '42']);

    context.after(() => rmSync(directory, { recursive: true, force: true }));
    strictEqual(status, 0, stderr);
    const finding = JSON.parse(stdout);
    const { findings: configuredFindings = {}, observations: configuredObservations = [], activeFiles = [], configuration: { fileName = '' } = {} } = finding;
    const { messages = [] } = configuredFindings;

    strictEqual(fileName, config);
    deepStrictEqual(messages.map(({ ruleId = '' } = {}) => ruleId), ['resilient/signature-contract-call-site']);
    deepStrictEqual(activeFiles.toSorted(), [file, barrel, provider].toSorted());
    const { status: offsetStatus = -1, stdout: offsetOutput = '', stderr: offsetError = '' } = run([file, '--offset', String(source.indexOf('42'))]);

    strictEqual(offsetStatus, 0, offsetError);
    const { findings: offsetFindings = {}, observations: offsetObservations = [] } = JSON.parse(offsetOutput);

    deepStrictEqual(offsetFindings, configuredFindings);
    deepStrictEqual(offsetObservations, configuredObservations);
    writeFileSync(config, 'throw new Error("AUTHORED CONFIGURATION FAILURE");\n');
    const { status: standaloneStatus = -1, stdout: standaloneOutput = '', stderr: standaloneError = '' } = run([file, '--standalone', '--find', '42']);
    const { mode = '', configuration: { profile = '', identity = '', fileName: selected = '' } = {}, findings = {} } = JSON.parse(standaloneOutput);

    strictEqual(standaloneStatus, 0, standaloneError);
    strictEqual(mode, 'standalone');
    strictEqual(profile, 'resilient/contracts');
    strictEqual(identity, 'built-in-contract-rules-and-effective-severities');
    strictEqual(selected, '');
    deepStrictEqual(findings, configuredFindings);
    [
        { args: [file, '--standalone', '--config', config, '--find', '42'], reason: /cannot combine/u },
        { args: [file, '--config', config, '--find', '42'], reason: /AUTHORED CONFIGURATION FAILURE/u },
        { args: [file, '--offset=-1'], reason: /nonnegative integer/u },
        { args: [file, '--unknown'], reason: /Unknown option/u }
    ].forEach(({ args = [], reason = /$^/u } = {}) => {
        const { status: failed = -1, stderr: failure = '' } = run(args);

        strictEqual(failed, 1);
        match(failure, reason);
    });
    const { status: helpStatus = -1, stdout: help = '' } = run(['--help', 'absent.js']);

    strictEqual(helpStatus, 0);
    ok(help.includes('--find') && help.includes('--offset') && help.includes('--standalone'));
    strictEqual(readFileSync(file, 'utf8'), source);
    strictEqual(readFileSync(provider, 'utf8'), 'export const consume=(value="")=>value;\n');
    strictEqual(readFileSync(barrel, 'utf8'), 'export {consume as read} from "./provider.js";\n');
});
