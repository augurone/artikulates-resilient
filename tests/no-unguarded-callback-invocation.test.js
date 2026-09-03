import { RuleTester } from 'eslint';

import rule from '../rules/no-unguarded-callback-invocation.js';

const listeners = rule.create({ report: () => {} });

listeners.CallExpression({
    type: 'CallExpression',
    callee: { type: 'Identifier', name: 'onDone' }
});

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('no-unguarded-callback-invocation', rule, {
    valid: [
        { code: 'const run = ({ onDone } = {}) => { if (isFunction(onDone)) onDone(); };' },
        { code: 'const run = ({ onDone } = {}) => { if (typeof onDone === "function") onDone(); };' },
        { code: 'const run = ({ onDone } = {}) => isFunction(onDone) && onDone();' },
        { code: 'const run = ({ onDone } = {}) => { if (!isFunction(onDone)) return; onDone(); };' },
        { code: 'const run = ({ onDone = noop } = {}) => onDone();' },
        { code: 'const run = ({ onDone } = {}) => send(onDone);' }
    ],
    invalid: [
        {
            code: 'const run = ({ onDone } = {}) => onDone();',
            errors: [{ messageId: 'unguarded', data: { name: 'onDone' } }]
        },
        {
            code: 'const run = ({ onDone } = {}) => { onDone(); };',
            errors: [{ messageId: 'unguarded', data: { name: 'onDone' } }]
        }
    ]
});
