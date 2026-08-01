import { RuleTester } from 'eslint';

import rule from '../rules/prefer-prototype-methods.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('prefer-prototype-methods', rule, {
    valid: [
        { code: 'const enabled = items.filter(item => item.enabled);' }
    ],
    invalid: [
        {
            code: 'for (const item of items) process(item);',
            errors: [{ messageId: 'prototypeMethod' }]
        },
        {
            code: 'for (let index = 0; index < items.length; index += 1) process(items[index]);',
            errors: [{ messageId: 'prototypeMethod' }]
        },
        {
            code: 'while (items.length) items.pop();',
            errors: [{ messageId: 'prototypeMethod' }]
        },
        {
            code: 'do { process(items.pop()); } while (items.length);',
            errors: [{ messageId: 'prototypeMethod' }]
        }
    ]
});
