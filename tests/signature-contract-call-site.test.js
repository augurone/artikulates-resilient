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
        { code: 'const getConfig = ({ config: { name = "" } = {} } = {}) => name; getConfig({ config: { name: nullValue } });' },
        { code: 'const getTitle = (title = "") => title; getTitle(value);' }
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
        },
        {
            code: 'const getTitle = (title = "") => title; getTitle(42);',
            errors: [{
                messageId: 'mismatch',
                data: {
                    path: 'argument',
                    expected: 'string-like',
                    actual: 'number-like'
                }
            }]
        },
        {
            code: 'const getValue = (title = "", count = 0) => count; getValue("title", "count");',
            errors: [{
                messageId: 'mismatch',
                data: {
                    path: 'argument[1]',
                    expected: 'number-like',
                    actual: 'string-like'
                }
            }]
        },
        {
            code: 'const getTitle = ({ title = "" } = {}) => title; const readTitle = getTitle; readTitle({ title: 42 });',
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
            code: 'const apply = (callback, value) => callback(value); const getTitle = ({ title = "" } = {}) => title; apply(getTitle, { title: 42 });',
            errors: [{
                messageId: 'mismatch',
                data: {
                    path: 'callback.title',
                    expected: 'string-like',
                    actual: 'number-like'
                }
            }]
        },
        {
            code: 'const inspect = () => { const items = [{ title: 42 }]; return items.map(({ title = "" } = {}) => title.trim()); };',
            errors: [{
                messageId: 'mismatch',
                data: {
                    path: 'map.callback.title',
                    expected: 'string-like',
                    actual: 'number-like'
                }
            }]
        }
    ]
});
