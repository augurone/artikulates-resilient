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
        { code: 'const run = ({ onDone } = {}) => onDone; run({});' },
        { code: 'const getConfig = ({ config: { name = "" } = {} } = {}) => name; getConfig({ config: { name: nullValue } });' },
        { code: 'const getTitle = (title = "") => title; getTitle(value);' },
        { code: 'const getTitle = ({ title = "" } = {}) => title; getTitle({ ...value });' },
        { code: 'const getTitle = ({ title, ...rest } = {}) => title; getTitle({ ...value });' },
        { code: 'const getRest = ({ title = "", ...rest } = {}) => rest; getRest({ title: "", extra: 42 });' },
        { code: 'const api = { collect: (title = "", ...rest) => title }; api.collect("A", 1, 2);' },
        { code: 'const requestGraphQL = ({ variables: { ...variables } = {} } = {}) => variables; requestGraphQL({ variables: { slugs: [], locale: "en-US" } });' },
        { code: 'const toEntry = ({ context: { projectId = "", dataset = "", ...context } = {} } = {}) => context; toEntry({ context: { resolveLinks: false } });' },
        { code: 'const run = callback => callback("ready", true); run((value, ...rest) => value);' }
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
        },
        {
            code: 'const getTitle = ({ title = "" } = {}) => title; getTitle({ title: "A", extra: true });',
            errors: [{
                messageId: 'excessProperty',
                data: { path: 'extra' }
            }]
        },
        {
            code: 'const getTitle = (title) => title; getTitle();',
            errors: [{
                messageId: 'arity',
                data: { message: 'Expected at least 1 argument, but got 0.' }
            }]
        },
        {
            code: 'const getTitle = (title = "") => title; getTitle("A", "B");',
            errors: [{
                messageId: 'arity',
                data: { message: 'Expected at most 1 argument, but got 2.' }
            }]
        },
        {
            code: 'const makeHandler = () => (value = "") => value.trim(); const handler = makeHandler(); handler(42);',
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
            code: 'const api = { read: (title = "") => title }; api.read(42);',
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
            code: 'const run = callback => callback(); const read = value => value; run(read);',
            errors: [{
                messageId: 'arity',
                data: { message: 'Expected at least 1 argument, but got 0.' }
            }]
        },
        {
            code: 'const run = callback => callback("ready", true); const read = value => value; run(read);',
            errors: [{
                messageId: 'arity',
                data: { message: 'Expected at most 1 argument, but got 2.' }
            }]
        },
        {
            code: 'const run = callback => callback(); run(value => value);',
            errors: [{
                messageId: 'arity',
                data: { message: 'Expected at least 1 argument, but got 0.' }
            }]
        },
        {
            code: 'const api = { read: value => value }; const run = callback => callback(); run(api.read);',
            errors: [{
                messageId: 'arity',
                data: { message: 'Expected at least 1 argument, but got 0.' }
            }]
        }
    ]
});
