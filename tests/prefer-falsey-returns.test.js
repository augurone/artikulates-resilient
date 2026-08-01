import { RuleTester } from 'eslint';

import rule from '../rules/prefer-falsey-returns.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('prefer-falsey-returns', rule, {
    valid: [
        { code: 'const performSideEffect = () => { doSomething(); return; };' }
    ],
    invalid: [
        {
            code: 'const getValue = (value) => value ? value : null;',
            errors: [{ messageId: 'falseyReturn' }]
        },
        {
            code: 'const getValue = () => null;',
            errors: [{ messageId: 'falseyReturn' }]
        },
        {
            code: 'const getValue = () => undefined;',
            errors: [{ messageId: 'falseyReturn' }]
        }
    ]
});
