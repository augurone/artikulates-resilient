import { deepStrictEqual, match, strictEqual } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

const cases = ['forwarding-audit', 'fluency-audit'].flatMap(name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')));
const engine = new ESLint();
const { execPath = '' } = process;

cases.forEach(({ name = '', invalid = '', valid = '', expected = {} } = {}) => test(`ESM forwarding agrees with configured dialect: ${name}`, async () => {
    const results = await Promise.all([invalid, valid].map(async (source) => {
        const { status = -1, stderr = '' } = spawnSync(execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 5000 });
        const [{ messages = [] } = {}] = await engine.lintText(source, { filePath: 'tests/fixtures/forwarding-audit-case.js' });

        return { status, stderr, messages: messages.map(({ ruleId = '', line = 0, column = 0 } = {}) => ({ ruleId, line, column })) };
    }));
    const [failure = {}, success = {}] = results;
    const { status: failed = 0, stderr = '', messages: invalidMessages = [] } = failure;
    const { status: completed = -1, messages: validMessages = [] } = success;

    strictEqual(failed, 1);
    match(stderr, /TypeError/u);
    strictEqual(completed, 0);
    deepStrictEqual(invalidMessages, Array.isArray(expected) ? expected : [expected]);
    deepStrictEqual(validMessages, []);
}));

test('ESM cycle mutation retains the callback requirement and accepts a real guard', async () => {
    const results = await Promise.all(['invalid', 'valid'].map(async (variant) => {
        const entry = fileURLToPath(new URL(`./fixtures/forwarding-cycle/${variant}/entry.js`, import.meta.url));
        const peer = fileURLToPath(new URL(`./fixtures/forwarding-cycle/${variant}/peer.js`, import.meta.url));
        const { status = -1, stderr = '' } = spawnSync(execPath, [entry], { encoding: 'utf8', timeout: 5000 });
        const linted = await engine.lintFiles([entry, peer]);
        const messages = linted.flatMap(({ messages = [] } = {}) => messages.map(({ ruleId = '', line = 0, column = 0 } = {}) => ({ ruleId, line, column })));

        return { status, stderr, messages };
    }));
    const [{ status: failed = 0, stderr = '', messages = [] } = {}, { status: completed = -1, messages: valid = [] } = {}] = results;

    strictEqual(failed, 1);
    match(stderr, /TypeError: cb is not a function/u);
    deepStrictEqual(messages, [{ ruleId: 'resilient/prefer-safe-destructuring-defaults', line: 8, column: 16 }]);
    strictEqual(completed, 0);
    deepStrictEqual(valid, []);
});
