import { RuleTester } from 'eslint';

import rule from '../rules/signature-contract-return-consistency.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('signature-contract-return-consistency', rule, {
    valid: [
        { code: 'const getItems = (enabled) => { if (!enabled) return []; return []; };' },
        { code: 'const passthrough = value => value;' },
        { code: 'const getValue = (value) => { if (!value) return value; return unknownValue; };' },
        { code: 'const getValue = (value) => { if (value) return []; return unknownValue; };' },
        { code: 'const getValue = (value = {}) => { if (typeof value === "string") return value; return ""; };' },
        {
            code: [
                'const getItems = async () => [];',
                'const getValue = async (enabled = false) => {',
                '    if (enabled) return [];',
                '    return getItems();',
                '};'
            ].join(' ')
        }
    ],
    invalid: [
        {
            code: 'const getValue = (enabled) => { if (enabled) return []; return ""; };',
            errors: [
                { messageId: 'inconsistent' },
                { messageId: 'inconsistent' }
            ]
        },
        {
            code: "const getValue = (enabled = false) => enabled ? '' : null;",
            errors: [
                { messageId: 'inconsistent' },
                { messageId: 'inconsistent' }
            ]
        },
        {
            code: "const getValue = (enabled = false) => { return enabled ? '' : null; };",
            errors: [
                { messageId: 'inconsistent' },
                { messageId: 'inconsistent' }
            ]
        },
        {
            code: 'const getValue = async (enabled = false) => { if (enabled) return []; return ""; };',
            errors: [
                { messageId: 'inconsistent' },
                { messageId: 'inconsistent' }
            ]
        }
    ]
});
