import { deepStrictEqual, match, strictEqual } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

const cases = JSON.parse(readFileSync(new URL('./fixtures/semantic-obligations.json', import.meta.url), 'utf8'));
const engine = new ESLint();
const { execPath = '' } = process;
const cwd = fileURLToPath(new URL('./fixtures/', import.meta.url));

cases.forEach(({ name = '', invalid = '', valid = '', expected = {} } = {}) => test(`semantic obligation: ${name}`, async () => {
    const results = await Promise.all([invalid, valid].map(async (source) => {
        const { status = -1, stderr = '' } = spawnSync(execPath, ['--input-type=module', '-e', source], { cwd, encoding: 'utf8', timeout: 5000 });
        const [{ messages = [] } = {}] = await engine.lintText(source, { filePath: 'tests/fixtures/semantic-obligations-case.js' });

        return { status, stderr, messages: messages.map(({ ruleId = '', line = 0, column = 0 } = {}) => ({ ruleId, line, column })) };
    }));
    const [{ status: failed = 0, stderr = '', messages = [] } = {}, { status: completed = -1, messages: accepted = [] } = {}] = results;

    strictEqual(failed, 1);
    match(stderr, /TypeError/u);
    strictEqual(completed, 0);
    deepStrictEqual(messages, Array.isArray(expected) ? expected : [expected]);
    deepStrictEqual(accepted, []);
}));
