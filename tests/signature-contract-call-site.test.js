import { RuleTester } from 'eslint';

import rule from '../rules/signature-contract-call-site.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('signature-contract-call-site', rule, {
    valid: [
        { code: 'const getTitle = ({ title = "" } = {}) => title; getTitle({ title: value });' },
        { code: 'const getTitle = ({ title = "" } = {}) => title; getTitle({});' },
        { code: 'const getConfig = ({ config: { name = "" } = {} } = {}) => name; getConfig({ config: { name: nullValue } });' }
    ],
    invalid: [
        {
            code: 'const getTitle = ({ title = "" } = {}) => title; getTitle({ title: 42 });',
            errors: [{
                messageId: 'mismatch',
                data: {
                    path: 'title',
                    expected: 'string-like',
                    actual: 'number-like'
                }
            }]
        },
        {
            code: 'const getConfig = ({ config: { name = "" } = {} } = {}) => name; getConfig({ config: { name: null } });',
            errors: [{
                messageId: 'mismatch',
                data: {
                    path: 'config.name',
                    expected: 'string-like',
                    actual: 'null'
                }
            }]
        }
    ]
});
