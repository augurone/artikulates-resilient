import { RuleTester } from 'eslint';

import rule from '../rules/no-undefined-assignment.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('no-undefined-assignment', rule, {
    valid: [
        { code: 'const hasValue = value => value === undefined;' }
    ],
    invalid: [
        {
            code: 'const value = undefined;',
            errors: [{ messageId: 'undefinedAssignment' }]
        },
        {
            code: 'value = undefined;',
            errors: [{ messageId: 'undefinedAssignment' }]
        }
    ]
});
