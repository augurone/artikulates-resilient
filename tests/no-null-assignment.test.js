import { RuleTester } from 'eslint';

import rule from '../rules/no-null-assignment.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('no-null-assignment', rule, {
    valid: [
        { code: 'const value = undefined;' },
        { code: 'const hasValue = value => !!value;' }
    ],
    invalid: [
        {
            code: 'const value = null;',
            errors: [{ messageId: 'nullAssignment' }]
        },
        {
            code: 'value = null;',
            errors: [{ messageId: 'nullAssignment' }]
        },
        {
            code: 'const value = enabled ? "ready" : null;',
            errors: [{ messageId: 'nullAssignment' }]
        }
    ]
});
