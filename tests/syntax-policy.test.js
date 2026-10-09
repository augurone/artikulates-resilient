import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Linter } from 'eslint';

import plugin from 'eslint-plugin-resilient/eslint';

const cases = JSON.parse(readFileSync(new URL('./fixtures/syntax-policy.json', import.meta.url), 'utf8'));

cases.forEach((record) => {
    const { rule = '', pluginName = 'resilient', source = '', options = [], languageOptions = {}, expected = [], output: expectedOutput = '' } = record;

    test(`${rule} ${expected.length ? 'reports' : 'accepts'}: ${source}`, () => {
        const configuration = { languageOptions, plugins: { [pluginName]: plugin }, rules: { [`${pluginName}/${rule}`]: ['error', ...options] } };
        const linter = new Linter();
        const messages = linter.verify(source, configuration);

        deepStrictEqual(messages.map(({ messageId = '' } = {}) => messageId), expected.map(({ messageId = '' } = {}) => messageId));

        if (Object.hasOwn(record, 'output')) {
            const { output = '' } = linter.verifyAndFix(source, configuration);

            strictEqual(output, expectedOutput);
        }
    });
});

test('operator placement preserves host options outside initializer comments', () => {
    const source = 'const value =\n    initialize();';
    const linter = new Linter();
    const check = (rule, options) => {
        const { messages = [], ...result } = linter.verifyAndFix(source, {
            plugins: { resilient: plugin }, rules: { [rule]: ['error', ...options] }
        });

        return { ...result, messages: messages.map(({ ruleId = '', ...message } = {}) => ({ ...message, ruleId: ruleId.replace('resilient/', '') })) };
    };

    [[], ['after'], ['none'], ['before', { overrides: { '=': 'after' } }],
        ['before', { overrides: { '=': 'none' } }], ['before', { overrides: { '=': 'ignore' } }]]
        .forEach(options => deepStrictEqual(check('resilient/operator-linebreak', options), check('operator-linebreak', options)));
});

test('initializer comments retain authored diagnostic suppression boundaries when fixing', () => {
    const sources = [
        'const value =\n    // eslint-disable-next-line no-undef -- Host initializer.\n    host();\nneighbor();',
        '/* eslint-disable no-undef -- Host initializer. */\nconst value =\n    // authored comment\n    host();\n/* eslint-enable no-undef */\nneighbor();',
        '/* eslint-disable no-undef -- Exact endpoint. */\nconst value =\n    /* eslint-enable no-undef */\n    // authored comment\n    host();\nneighbor();',
        'const value =\n    /* eslint-disable no-undef -- Host initializer. */\n    host();\n/* eslint-enable no-undef */\nneighbor();'
    ];
    const linter = new Linter();
    const configuration = { plugins: { resilient: plugin }, linterOptions: { reportUnusedDisableDirectives: false }, rules: {
        'resilient/operator-linebreak': ['error', 'before', { overrides: { '&&': 'after', '||': 'after' } }], 'no-undef': 'error'
    } };

    sources.forEach((source) => {
        const visible = linter.verify(source, configuration);
        const suppressed = linter.getSuppressedMessages();
        const { output = '', fixed = true, messages = [] } = linter.verifyAndFix(source, configuration);

        strictEqual(output, source);
        strictEqual(fixed, false);
        deepStrictEqual(messages, visible);
        linter.verify(output, configuration);
        deepStrictEqual(linter.getSuppressedMessages(), suppressed);
    });
});
