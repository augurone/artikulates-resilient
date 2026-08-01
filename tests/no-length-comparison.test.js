import { RuleTester } from 'eslint';

import rule from '../rules/no-length-comparison.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('no-length-comparison', rule, {
    valid: [
        { code: 'const hasOne = (items) => items.length === 1;' }
    ],
    invalid: [
        {
            code: 'const hasNoItems = (items) => items.length === 0;',
            errors: [{ messageId: 'lengthComparison' }]
        },
        {
            code: 'const hasNoValues = (values) => 0 === values.length;',
            errors: [{ messageId: 'lengthComparison' }]
        }
    ]
});
