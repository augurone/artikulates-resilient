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
        { code: 'const hasOne = (items) => items.length === 1;' },
        { code: 'const hasMany = (items) => items.length > 1;' },
        { code: 'const hasInvalidLength = (items) => items.length < 0;' },
        { code: 'const hasInvalidLength = (items) => 0 > items.length;' },
        { code: 'const hasItems = (items) => items.length;' },
        { code: 'const hasItems = (items) => !!items.length;' },
        { code: 'const hasNoItems = (items) => !items.length;' }
    ],
    invalid: [
        {
            code: 'const hasNoItems = (items) => items.length === 0;',
            errors: [{
                messageId: 'lengthComparison',
                suggestions: [{
                    messageId: 'replaceWithFalseyCheck',
                    output: 'const hasNoItems = (items) => !items.length;'
                }]
            }]
        },
        {
            code: 'const hasNoValues = (values) => 0 === values.length;',
            errors: [{
                messageId: 'lengthComparison',
                suggestions: [{
                    messageId: 'replaceWithFalseyCheck',
                    output: 'const hasNoValues = (values) => !values.length;'
                }]
            }]
        },
        {
            code: 'const hasValues = (values) => values.length !== 0;',
            errors: [{
                messageId: 'lengthComparison',
                suggestions: [{
                    messageId: 'replaceWithLength',
                    output: 'const hasValues = (values) => values.length;'
                }]
            }]
        },
        {
            code: 'const hasValues = (values) => 0 !== values.length;',
            errors: [{
                messageId: 'lengthComparison',
                suggestions: [{
                    messageId: 'replaceWithLength',
                    output: 'const hasValues = (values) => values.length;'
                }]
            }]
        },
        {
            code: 'const hasValues = (values) => values.length > 0;',
            errors: [{
                messageId: 'lengthComparison',
                suggestions: [{
                    messageId: 'replaceWithLength',
                    output: 'const hasValues = (values) => values.length;'
                }]
            }]
        },
        {
            code: 'const hasValues = (values) => 0 < values.length;',
            errors: [{
                messageId: 'lengthComparison',
                suggestions: [{
                    messageId: 'replaceWithLength',
                    output: 'const hasValues = (values) => values.length;'
                }]
            }]
        }
    ]
});
