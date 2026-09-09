import assert from 'node:assert/strict';

import { Linter, RuleTester } from 'eslint';

import resilient from 'eslint-plugin-resilient';

import rule from '../rules/operator-linebreak.js';

const options = ['before', { overrides: { '&&': 'after', '||': 'after' } }];
const preferred = [
    'export const empty =\n    // authored comment\n    new Map();',
    'const value =\n    /* authored comment */ initialize();',
    'let value =\n    /* first\n       second */\n    initialize();',
    'var value =\n    // first\n    /* second */\n    initialize();',
    'const { value } =\n    // authored comment\n    initialize();',
    'const [value] =\n    // authored comment\n    initialize();',
    'const first = 1, second =\n    // authored comment\n    initialize();',
    'const run = () => {\n    const value =\n        // authored comment\n        initialize();\n    return value;\n};',
    'for (let value =\n    // authored comment\n    initialize(); value; ) break;',
    'const value = // authored comment\n    initialize();',
    'const value =\n    // authored comment\n    (initialize());',
    'const value =\r\n    // authored comment\r\n    initialize();',
    'const value =\u2028    // authored comment\u2028    initialize();'
];
const ordinary = [
    'const value =\n    initialize();',
    'const value\n    = initialize();',
    'const value = initialize();',
    'let value;',
    'const value\n    // binding comment\n    = initialize();',
    'const value = (\n    // inside parentheses\n    initialize());',
    'const value\n    =\n    // lone operator\n    initialize();',
    'value =\n    // assignment comment\n    initialize();',
    'class Example { value =\n    // field comment\n    initialize(); }',
    'const value = first +\n    // operand comment\n    second;',
    'const value = first\n    && second;',
    'const value = first\n    || second;',
    'const value = flag ?\n    first :\n    second;',
    'const { value =\n    // default comment\n    initialize() } = source;',
    'const value /* binding */ =\n    initialize();'
];
new RuleTester().run('operator-linebreak', rule, {
    valid: preferred.map(code => ({ code, options })),
    invalid: [{
        code: 'const value =\n    initialize();',
        options,
        output: 'const value\n    = initialize();',
        errors: [{ messageId: 'operatorAtBeginning' }]
    }]
});
const linter = new Linter();
const config = (custom = true, selected = options) => ({
    plugins: { resilient },
    linterOptions: { reportUnusedDisableDirectives: false },
    rules: { [custom ? 'resilient/operator-linebreak' : 'operator-linebreak']: ['error', ...selected] }
});
const normalize = ({ ruleId = '', ...message } = {}) => ({
    ...message, ruleId: ruleId.replace('resilient/', '')
});
const parity = (code = '', selected = options) => {
    const { output: oldOutput = '', fixed: oldFixed = false, messages: oldMessages = [] } = linter.verifyAndFix(code, config(false, selected));
    const { output = '', fixed = false, messages = [] } = linter.verifyAndFix(code, config(true, selected));

    assert.equal(output, oldOutput, code);
    assert.equal(fixed, oldFixed, code);
    assert.deepEqual(messages.map(normalize), oldMessages.map(normalize), code);
};
ordinary.forEach(code => parity(code));
[[], ['after'], ['none'], ['before', { overrides: { '=': 'after' } }],
    ['before', { overrides: { '=': 'none' } }], ['before', { overrides: { '=': 'ignore' } }]]
    .forEach(selected => [...preferred, ...ordinary].forEach(code => parity(code, selected)));

const directives = [
    'const value =\n    // eslint-disable-next-line no-undef -- Host initializer.\n    host();\nneighbor();',
    'const value =\n    host(); // eslint-disable-line no-undef -- Host initializer.\nneighbor();',
    '/* eslint-disable no-undef -- Host initializer. */\nconst value =\n    // authored comment\n    host();\n/* eslint-enable no-undef */\nneighbor();',
    '/* eslint-disable no-undef -- Exact endpoint. */\nconst value =\n    /* eslint-enable no-undef */\n    // authored comment\n    host();\nneighbor();',
    'const value =\n    /* eslint-disable no-undef -- Host initializer. */\n    host();\n/* eslint-enable no-undef */\nneighbor();'
];
[...preferred, ...directives.filter((code = '') => code.includes('const value =\n    host();') === false)]
    .forEach((code = '') => {
        const policy = config();
        const { rules = {} } = policy;
        const checked = { ...policy, rules: { ...rules, 'no-undef': 'error' } };
        const visible = linter.verify(code, checked);
        const suppressed = linter.getSuppressedMessages();
        const { output = '', fixed = false, messages = [] } = linter.verifyAndFix(code, checked);

        assert.equal(output, code);
        assert.equal(fixed, false);
        assert.deepEqual(messages, visible);
        linter.verify(output, checked);
        assert.deepEqual(linter.getSuppressedMessages(), suppressed);
    });
// A trailing directive without an initializer-leading comment remains ordinary.
parity(directives[1]);
const { configs: { recommended = {} } = {} } = resilient;
assert.equal(recommended.rules['operator-linebreak'], 'off');
assert.deepEqual(recommended.rules['resilient/operator-linebreak'], ['error', ...options]);
const preferredModule = `${preferred[0]}\n`;
const full = linter.verifyAndFix(preferredModule, {
    ...recommended,
    languageOptions: { globals: { Map: 'readonly' } }
});
assert.equal(full.output, preferredModule);
assert.deepEqual(full.messages, []);
