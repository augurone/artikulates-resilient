import { RuleTester } from 'eslint';

import rule from '../rules/signature-contract-operation.js';

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

ruleTester.run('signature-contract-operation', rule, {
    valid: [
        { code: 'const normalize = ({ title = "" } = {}) => title.trim();' },
        { code: 'const getItems = ({ items = [] } = {}) => items; const mapItems = () => getItems({}).map(Boolean);' },
        { code: 'const value = source.toUpperCase();' },
        { code: 'const mapValue = ({ value = {} } = {}) => { if (Array.isArray(value)) return value.map(Boolean); return []; };' },
        { code: 'const mapValue = ({ value = {} } = {}) => { if (Array.isArray(value)) { return value.map(Boolean); } return []; };' },
        { code: 'const mapAlias = ({ value = {} } = {}) => { const items = value; if (Array.isArray(value)) return items.map(Boolean); return []; };' },
        { code: 'const getItems = ({ items = [] } = {}) => items; const readItems = getItems; readItems({}).map(Boolean);' },
        { code: 'const getItems = async ({ items = [] } = {}) => items; const inspect = async () => (await getItems({})).map(Boolean);' },
        { code: 'const getItems = async ({ items = [] } = {}) => items; const inspect = async () => (await Promise.all([getItems({})])).map(Boolean);' },
        { code: [
            'const fetchItems = async ({ items = [] } = {}) => items.length',
            '? items : fetchItems({ items: [""] });',
            'const inspect = async () => { const items = await fetchItems();',
            'return items.map(Boolean); };'
        ].join(' ') },
        { code: 'const inspect = async () => { return; };' },
        { code: 'const request = async () => ({ items: [] }); const load = async () => { const data = await request(); return data.items.map(Boolean); };' },
        { code: 'const inspect = () => { const items = ["a"]; return items.map(item => item.toUpperCase()).map(Boolean); };' },
        { code: 'const makeHandler = () => (value = "") => value.trim(); const handler = makeHandler(); handler("value").toUpperCase();' },
        { code: 'const api = { read: () => "value" }; api.read().toUpperCase();' },
        { code: 'const inspect = () => { const items = ["a"]; return items.filter(item => item).map(Boolean); };' },
        { code: 'const inspect = () => { const items = [1]; const total = items.reduce((sum, item) => sum, 0); return total.toFixed(); };' },
        { code: 'const inspect = () => [1].reduce((sum, item) => sum.toUpperCase(), "");' },
        { code: 'const inspect = () => ["ready", 42].map(item => String(item).toUpperCase());' },
        { code: 'const inspect = () => Object.entries({ title: "ready" }).map(entry => entry);' },
        { code: 'const inspect = () => [1].map(item => { if (typeof item === "string") return item.toUpperCase(); return ""; });' },
        { code: 'const inspect = () => { const items = ["a"]; return items.find(item => item).toUpperCase(); };' },
        { code: 'const mapWithCondition = ({ value = {}, enabled = false } = {}) => { if (Array.isArray(value) && enabled) return value.map(Boolean); return []; };' },
        { code: 'const mapAfterNegativeGuard = ({ value = {} } = {}) => { if (!Array.isArray(value)) return []; return value.map(Boolean); };' },
        { code: 'const trimValue = ({ value = {} } = {}) => { if (typeof value === "string") return value.trim(); return ""; };' },
        { code: 'const trimValue = (value = null) => { if (value !== null) return value.toUpperCase(); return ""; };' },
        { code: 'const trimValue = (value = {}) => { if (typeof value !== "object") return value.toUpperCase(); return ""; };' },
        { code: 'const trimValue = (value = null) => { if (!(value === null)) return value.toUpperCase(); return ""; };' },
        { code: 'const trimValue = (value = null) => { if (null !== value) return value.toUpperCase(); return ""; };' },
        { code: 'const trimValue = (value = undefined) => { if (value != null) return value.toUpperCase(); return ""; };' },
        { code: 'const trimValue = (value = "") => { if ("string" !== typeof value) return value.map(Boolean); return ""; };' },
        { code: 'const mapAssigned = ({ value = {} } = {}) => { value = []; return value.map(Boolean); };' },
        { code: 'const mapInLoop = ({ value = {} } = {}) => { while (Array.isArray(value)) return value.map(Boolean); return []; };' },
        { code: 'const mapInTry = ({ value = {} } = {}) => { try { if (typeof value === "string") return value.trim(); } catch (error) { return ""; } return ""; };' },
        { code: 'const mapProperty = ({ config = {} } = {}) => { config.items = []; return config.items.map(Boolean); };' },
        { code: 'const reduceValue = ({ value = {} } = {}) => Object.entries(value).reduce((items, entry) => [...items, entry], []);' },
        { code: 'const inspect = value => value.toUpperCase();' }
    ],
    invalid: [
        {
            code: 'const inspect = ({ items = [] } = {}) => items.toUpperCase();',
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'items',
                    actual: 'array-like',
                    method: 'toUpperCase',
                    expected: 'string-like'
                }
            }]
        },
        {
            code: 'const inspect = ({ title = "" } = {}) => title.map(Boolean);',
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'title',
                    actual: 'string-like',
                    method: 'map',
                    expected: 'array-like'
                }
            }]
        },
        {
            code: 'const getItems = (page = { items: [] }) => { const { items = [] } = page; return items; }; getItems({}).toUpperCase();',
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'getItems()',
                    actual: 'array-like',
                    method: 'toUpperCase',
                    expected: 'string-like'
                }
            }]
        },
        {
            code: 'const inspect = (enabled = false) => (enabled ? [] : "").toUpperCase();',
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'value',
                    actual: 'array-like',
                    method: 'toUpperCase',
                    expected: 'string-like'
                }
            }]
        },
        {
            code: 'const inspect = (enabled = false) => (enabled && []).map(Boolean);',
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'value',
                    actual: 'boolean-like',
                    method: 'map',
                    expected: 'array-like'
                }
            }]
        },
        {
            code: 'const inspect = ({ value = {} } = {}) => { if (Array.isArray(value)) return []; return value.map(Boolean); };',
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'value',
                    actual: 'object-like',
                    method: 'map',
                    expected: 'array-like'
                }
            }]
        },
        {
            code: 'const inspect = ({ config = {} } = {}) => { config.items = ""; return config.items.map(Boolean); };',
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'config.items',
                    actual: 'string-like',
                    method: 'map',
                    expected: 'array-like'
                }
            }]
        },
        {
            code: 'const getItems = ({ items = [] } = {}) => items; const readItems = getItems; readItems({}).toUpperCase();',
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'readItems()',
                    actual: 'array-like',
                    method: 'toUpperCase',
                    expected: 'string-like'
                }
            }]
        },
        {
            code: 'const getItems = async ({ items = [] } = {}) => items; const inspect = async () => { const values = await getItems({}); return values.toUpperCase(); };',
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'values',
                    actual: 'array-like',
                    method: 'toUpperCase',
                    expected: 'string-like'
                }
            }]
        },
        {
            code: [
                'const request = async () => { const load = async () => ({ items: [] }); return load(); };',
                'const inspect = async () => { const data = await request(); return data.items.toUpperCase(); };'
            ].join(' '),
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'data.items',
                    actual: 'array-like',
                    method: 'toUpperCase',
                    expected: 'string-like'
                }
            }]
        },
        {
            code: [
                'const apply = (callback, value) => callback(value);',
                'const getItems = ({ items = [] } = {}) => items;',
                'const inspect = () => { const result = apply(getItems, { items: "" });',
                'return result.map(Boolean); };'
            ].join(' '),
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'result',
                    actual: 'string-like',
                    method: 'map',
                    expected: 'array-like'
                }
            }]
        },
        {
            code: 'const getItems = async ({ items = [] } = {}) => items; const inspect = async () => { const values = await Promise.all([getItems({ items: "" })]); return values.toUpperCase(); };',
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'values',
                    actual: 'array-like',
                    method: 'toUpperCase',
                    expected: 'string-like'
                }
            }]
        },
        {
            code: 'const inspect = () => { const items = ["a"]; return items.map(item => item.toUpperCase()).toUpperCase(); };',
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'items.map()',
                    actual: 'array-like',
                    method: 'toUpperCase',
                    expected: 'string-like'
                }
            }]
        },
        {
            code: 'const api = { read: () => "value" }; api.read().map(Boolean);',
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'api.read()',
                    actual: 'string-like',
                    method: 'map',
                    expected: 'array-like'
                }
            }]
        },
        {
            code: 'const inspect = () => { const items = ["a"]; return items.filter(item => item).toUpperCase(); };',
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'items.filter()',
                    actual: 'array-like',
                    method: 'toUpperCase',
                    expected: 'string-like'
                }
            }]
        },
        {
            code: 'const inspect = () => { const items = [1]; const total = items.reduce((sum, item) => sum, 0); return total.toUpperCase(); };',
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'total',
                    actual: 'number-like',
                    method: 'toUpperCase',
                    expected: 'string-like'
                }
            }]
        },
        {
            code: 'const inspect = () => { const items = [1]; const result = items.forEach(item => item); return result.map(Boolean); };',
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'result',
                    actual: 'undefined',
                    method: 'map',
                    expected: 'array-like'
                }
            }]
        },
        {
            code: 'const inspect = () => ["a", 1].map(item => item.toUpperCase());',
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'item',
                    actual: 'number-like',
                    method: 'toUpperCase',
                    expected: 'string-like'
                }
            }]
        },
        {
            code: 'const inspect = () => [1].reduce((sum, item) => item.toUpperCase(), "");',
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'item',
                    actual: 'number-like',
                    method: 'toUpperCase',
                    expected: 'string-like'
                }
            }]
        },
        {
            code: 'const inspect = () => ["ready", 42].map(item => String(item).map(Boolean));',
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'String()',
                    actual: 'string-like',
                    method: 'map',
                    expected: 'array-like'
                }
            }]
        },
        {
            code: 'const inspect = () => Object.entries({}).trim();',
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'Object.entries()',
                    actual: 'array-like',
                    method: 'trim',
                    expected: 'string-like'
                }
            }]
        },
        {
            code: 'const getPage = () => ({ title: "ready" }); getPage().title.map(Boolean);',
            errors: [{
                messageId: 'mismatch',
                data: {
                    receiver: 'getPage().title',
                    actual: 'string-like',
                    method: 'map',
                    expected: 'array-like'
                }
            }]
        }
    ]
});
