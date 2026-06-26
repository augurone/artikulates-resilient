import { RuleTester } from 'eslint';

import rule from '../rules/prefer-signature-destructuring.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('prefer-signature-destructuring', rule, {
    valid: [
        {
            code: 'const processUser = ({ name = "", age = 0 } = {}) => `${name} (${age})`;'
        },
        {
            code: 'const passThrough = (user) => user;'
        },
        {
            code: 'const handler = ({ data = {} } = {}) => { const { items = [] } = data; return items; };'
        }
    ],
    invalid: [
        {
            code: 'const processUser = (user) => { const { name, age } = user; return `${name} (${age})`; };',
            errors: [
                {
                    messageId: 'preferSignature'
                }
            ]
        },
        {
            code: 'function getItems(response) { if (!response) return []; const { data: { items = [] } = {} } = response; return items; }',
            errors: [
                {
                    messageId: 'preferSignature'
                }
            ]
        }
    ]
});
