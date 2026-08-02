import { RuleTester } from 'eslint';

import rule from '../rules/no-undefined-comparison.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('no-undefined-comparison', rule, {
    valid: [
        { code: 'const isMissing = value => !value;' },
        { code: 'const isPresent = value => !!value;' }
    ],
    invalid: [
        {
            code: 'const isMissing = value => value === undefined;',
            errors: [{ messageId: 'undefinedComparison' }]
        },
        {
            code: 'const isPresent = value => typeof value === "undefined";',
            errors: [{ messageId: 'undefinedComparison' }]
        }
    ]
});
