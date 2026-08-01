import { RuleTester } from 'eslint';

import rule from '../rules/no-destructuring-fallback.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('no-destructuring-fallback', rule, {
    valid: [
        { code: 'const process = ({ data: { items = [] } = {} } = {}) => items;' }
    ],
    invalid: [
        {
            code: 'const { items = [] } = data || {};',
            errors: [{ messageId: 'destructuringFallback' }]
        }
    ]
});
