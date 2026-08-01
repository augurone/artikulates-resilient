import { RuleTester } from 'eslint';

import rule from '../rules/no-else.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('no-else', rule, {
    valid: [
        { code: 'const getValue = (value) => { if (!value) return ""; return value; };' }
    ],
    invalid: [
        {
            code: 'const getValue = (value) => { if (!value) return ""; else if (value) return value; return ""; };',
            errors: [{ messageId: 'noElse' }]
        }
    ]
});
