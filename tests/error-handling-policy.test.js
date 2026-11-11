import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Linter } from 'eslint';

import plugin from 'eslint-plugin-resilient/eslint';

const rule = 'resilient/no-silent-catch';
const config = { plugins: { resilient: plugin }, rules: { [rule]: 'error' } };
const cases = JSON.parse(readFileSync(new URL('./fixtures/error-handling-policy.json', import.meta.url), 'utf8'));

cases.forEach(({ source = '', options = [], findings = [] } = {}) => test(`error handling: ${source}`, () => {
    deepStrictEqual(new Linter().verify(source, { plugins: { resilient: plugin }, rules: { [rule]: ['error', ...options] } }), findings);
}));

[
    ['', 1], ['/* explained but unhandled */', 1], [';', 1], ['{;}', 1], ['{{;}{}}', 1], ['label: {;}', 1], ['a: b: ;', 1],
    ['throw error;', 0], ['{throw error;}', 0], ['label: {break label;}', 0], ['{log(error);}', 0], ['return;', 0],
    ['{{return fallback;}}', 0], ['const reason=error;', 0], ['function deferred(){throw error;}', 0], ['if (flag) {}', 0]
].forEach(([body = '', expected = 0] = []) => test(`catch handling boundary: ${body}`, () => {
    const source = `const run=()=>{try {work();} catch(error) {${body}}};`;
    const messages = new Linter().verify(source, config);

    strictEqual(messages.length, expected);
    messages.forEach(({ ruleId = '', messageId = '', column = 0, endColumn = 0 } = {}) => {
        strictEqual(ruleId, 'resilient/no-silent-catch');
        strictEqual(messageId, 'silentCatch');
        strictEqual(source.slice(column - 1, endColumn - 1), `{${body}}`);
    });
}));

test('catch handling is an explicit source obligation without an automatic rewrite', () => {
    const source = 'try { work(); } catch { label: {{;}} }';
    const expected = new Linter().verify(source, config);
    const { output = '', fixed = true, messages = [] } = new Linter().verifyAndFix(source, config);

    strictEqual(output, source);
    strictEqual(fixed, false);
    deepStrictEqual(messages, expected);
});

test('catch reporting failures remain operational through the lint host', () => {
    const failure = new Error('catch report failed');
    const implementation = Reflect.get(plugin.rules, 'no-silent-catch');
    const broken = { ...implementation, create() {
        return implementation.create({ report() { throw failure; } });
    } };

    throws(() => new Linter().verify('try { work(); } catch {}', {
        plugins: { probe: { rules: { handling: broken } } }, rules: { 'probe/handling': 'error' }
    }), error => error === failure);
});
