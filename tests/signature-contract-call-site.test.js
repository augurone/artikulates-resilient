import { RuleTester } from 'eslint';

import rule from '../rules/signature-contract-call-site.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    },
    settings: {
        resilient: {
            evidenceMessages: false
        }
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
        { code: 'const passthrough = (value = {}) => value; passthrough({ extra: true });' },
        { code: 'const setEntry = ({ cacheKey = "", entry = {} } = {}) => entry; setEntry({ cacheKey: "current", entry: {} });' },
        { code: 'const getTitle = ({ title, ...rest } = {}) => title; getTitle({ ...value });' },
        { code: 'const getRest = ({ title = "", ...rest } = {}) => rest; getRest({ title: "", extra: 42 });' },
        { code: 'const api = { collect: (title = "", ...rest) => title }; api.collect("A", 1, 2);' },
        { code: 'const requestGraphQL = ({ variables: { ...variables } = {} } = {}) => variables; requestGraphQL({ variables: { slugs: [], locale: "en-US" } });' },
        { code: 'const toEntry = ({ context: { projectId = "", dataset = "", ...context } = {} } = {}) => context; toEntry({ context: { resolveLinks: false } });' },
        { code: 'const run = callback => callback("ready", true); run((value, ...rest) => value);' },
        { code: 'function choose(a, b) { switch (arguments.length) { case 1: return a; case 2: return b(a); default: throw Error("count"); } } choose(1);' },
        { code: 'function choose(a, b, c) { switch (arguments.length) { case 1: return a; case 2: return b(a); case 3: return c(b(a)); } } choose(1, fn);' },
        { code: 'function choose(a, b, c) { switch (arguments.length) { case 1: return a; case 2: return function () { return b(arguments[0]); }; case 3: return c(b(a)); } } choose(1, fn);' }
    ],
    invalid: [
        {
            code: 'function choose(a, b) { switch (arguments.length) { case 1: return b; case 2: return b(a); } } choose(1);',
            errors: [{ messageId: 'arity' }]
        },
        {
            code: 'function choose(a, b) { b; switch (arguments.length) { case 1: return a; case 2: return b(a); } } choose(1);',
            errors: [{ messageId: 'arity' }]
        },
        {
            code: 'function choose(a, b) { switch (arguments.length) { case b: return a; case 1: return a; } } choose(1);',
            errors: [{ messageId: 'arity' }]
        },
        {
            code: 'function choose(a, b) { switch (arguments.length) { case 1: return eval("b"); case 2: return b(a); } } choose(1);',
            errors: [{ messageId: 'arity' }]
        },
        {
            code: 'function choose(a, b) { switch (arguments.length) { case 2: return b(a); } } choose(1);',
            errors: [{ messageId: 'arity' }]
        },
        {
            code: 'function choose(a, b) { switch (arguments.length) { case 1: return arguments[1].value; case 2: return b(a); } } choose(1);',
            errors: [{ messageId: 'arity' }]
        },
        {
            code: 'function choose(a, b) { switch (arguments.length) { case 1: return () => arguments[1].value; case 2: return b(a); } } choose(1);',
            errors: [{ messageId: 'arity' }]
        },
        {
            code: 'const choose = (a, b) => { switch (arguments.length) { case 1: return a; case 2: return b(a); } }; choose(1);',
            errors: [{ messageId: 'arity' }]
        },
        {
            code: 'function choose(a, b) { switch (arguments.length) { case 1: return a; case 2: return b(a); } var arguments = { length: 2 }; } choose(1);',
            languageOptions: { ecmaVersion: 'latest', sourceType: 'script' },
            errors: [{ messageId: 'arity' }]
        },
        {
            code: 'function choose(a, b) { switch (arguments.length) { case 1: return a; case 2: return b(a); } var { arguments } = source; } choose(1);',
            languageOptions: { ecmaVersion: 'latest', sourceType: 'script' },
            errors: [{ messageId: 'arity' }]
        },
        {
            code: 'function arguments(a, b) { switch (arguments.length) { case 1: return a; case 2: return b(a); } } arguments(1);',
            languageOptions: { ecmaVersion: 'latest', sourceType: 'script' },
            errors: [{ messageId: 'arity' }]
        },
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
                data: { message: 'getTitle requires title; provide the argument or add a default to the getTitle signature.' }
            }]
        },
        {
            code: 'const getTitle = (title = "") => title; getTitle("A", "B");',
            errors: [{
                messageId: 'arity',
                data: { message: 'getTitle accepts at most 1 argument, but got 2.' }
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
                data: { message: 'callback requires value; provide the argument or add a default to the callback signature.' }
            }]
        },
        {
            code: 'const run = callback => callback("ready", true); const read = value => value; run(read);',
            errors: [{
                messageId: 'arity',
                data: { message: 'callback accepts at most 1 argument, but got 2.' }
            }]
        },
        {
            code: 'const run = callback => callback(); run(value => value);',
            errors: [{
                messageId: 'arity',
                data: { message: 'callback requires value; provide the argument or add a default to the callback signature.' }
            }]
        },
        {
            code: 'const api = { read: value => value }; const run = callback => callback(); run(api.read);',
            errors: [{
                messageId: 'arity',
                data: { message: 'callback requires value; provide the argument or add a default to the callback signature.' }
            }]
        },
        {
            code: 'const getTitle = ({ title = "" } = {}) => title; const alias = getTitle; alias({ title: false });',
            errors: [{
                messageId: 'mismatch',
                data: {
                    path: 'title',
                    expected: 'string-like',
                    actual: 'boolean-like'
                }
            }]
        },
        {
            code: 'const getTitle = (title = "") => title; getTitle("A", 42);',
            errors: [{
                messageId: 'arity',
                data: { message: 'getTitle accepts at most 1 argument, but got 2.' }
            }]
        }
    ]
});
