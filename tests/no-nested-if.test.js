import { RuleTester } from 'eslint';

import rule from '../rules/no-nested-if.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('no-nested-if', rule, {
    valid: [
        { code: 'const outer = (value) => { if (!value) return () => { if (value) return true; return false; }; return () => false; };' }
    ],
    invalid: [
        {
            code: 'const getValue = (value) => { if (value) { if (value) return true; } return false; };',
            errors: [{ messageId: 'nestedIf' }]
        }
    ]
});
