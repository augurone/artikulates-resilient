import { RuleTester } from 'eslint';

import rule from '../rules/no-unhandled-promise-chain.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('no-unhandled-promise-chain', rule, {
    valid: [
        { code: 'request().then(handle).catch(report);' },
        { code: 'request().catch(report).then(handle);' },
        { code: 'const result = request().then(handle);' },
        { code: 'const run = async () => { await request().then(handle); };' },
        { code: 'const run = () => request().then(handle);' },
        { code: 'void request().then(handle);' }
    ],
    invalid: [
        {
            code: 'request().then(handle);',
            errors: [{ messageId: 'unhandled' }]
        },
        {
            code: 'request().then(handle).finally(cleanup);',
            errors: [{ messageId: 'unhandled' }]
        }
    ]
});
