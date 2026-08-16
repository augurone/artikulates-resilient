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
        { code: 'const getValue = (value) => { if (value) return []; return unknownValue; };' }
    ],
    invalid: [
        {
            code: 'const getValue = (enabled) => { if (enabled) return []; return ""; };',
            errors: [
                { messageId: 'inconsistent' },
                { messageId: 'inconsistent' }
            ]
        }
    ]
});
