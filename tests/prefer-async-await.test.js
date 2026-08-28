import { RuleTester } from 'eslint';

import rule from '../rules/prefer-async-await.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('prefer-async-await', rule, {
    valid: [
        { code: 'const run = async () => { await request(); };' },
        { code: 'request().catch(report);' },
        { code: 'request().finally(cleanup);' },
        { code: 'request().then(handle);' },
        { code: 'request().then(handle).finally(cleanup);' },
        { code: '// resilient-allow-promise-chain: third-party API\nrequest().then(handle);' }
    ],
    invalid: [
        {
            code: 'request().then(handle).catch(report);',
            errors: [{ messageId: 'asyncAwait' }]
        },
        {
            code: '// resilient-allow-promise-chain\nrequest().then(handle).catch(report);',
            errors: [{ messageId: 'asyncAwait' }]
        }
    ]
});
