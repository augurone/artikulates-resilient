import { RuleTester } from 'eslint';

import rule from '../rules/signature-contract-operation.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
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
        { code: 'const mapWithCondition = ({ value = {}, enabled = false } = {}) => { if (Array.isArray(value) && enabled) return value.map(Boolean); return []; };' },
        { code: 'const mapAfterNegativeGuard = ({ value = {} } = {}) => { if (!Array.isArray(value)) return []; return value.map(Boolean); };' },
        { code: 'const trimValue = ({ value = {} } = {}) => { if (typeof value === "string") return value.trim(); return ""; };' },
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
        }
    ]
});
