import { RuleTester } from 'eslint';

import rule from '../rules/signature-contract-destructuring.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('signature-contract-destructuring', rule, {
    valid: [
        { code: 'const getValue = ({ value = {} } = {}) => { const { attr = "" } = value; return attr; };' },
        { code: 'const getValue = () => ({ name: "A" }); const { missing = "" } = getValue();' },
        { code: 'const getValue = () => ({ name: "A" }); const { name, ...rest } = getValue();' },
        { code: 'const getValue = value => { const { name, ...rest } = value; return rest; };' },
        { code: 'const getValue = ({ value = [] } = {}) => { const [first = {}] = value; return first; };' },
        { code: 'const getValue = () => { const [{ attr = "" } = {}] = []; return attr; };' },
        { code: 'const getValue = (items = []) => { const { [0]: value = {} } = items; return value; };' },
        { code: 'const user = { name: "A" }; const propertyName = "name"; const { [propertyName]: name = "" } = user;' },
        { code: 'const getValue = (value) => { const { attr = "" } = value; return attr; };' },
        { code: 'const getValue = ({ value = {} } = {}) => { if (Array.isArray(value)) return value.map(Boolean); return []; };' }
    ],
    invalid: [
        {
            code: 'const getValue = ({ value = [] } = {}) => { if (!Array.isArray(value)) return {}; const { attr = "" } = value; return attr; };',
            errors: [{
                messageId: 'mismatch',
                data: {
                    actual: 'array-like',
                    expected: 'object-like'
                }
            }]
        },
        {
            code: 'const getValue = () => ({ name: "A" }); const { nmae } = getValue();',
            errors: [{
                messageId: 'missingProperty',
                data: { property: 'nmae' }
            }]
        },
        {
            code: 'const getValue = () => ({ profile: { name: "A" } }); const { profile: { nmae } } = getValue();',
            errors: [{
                messageId: 'missingProperty',
                data: { property: 'profile.nmae' }
            }]
        },
        {
            code: 'const getValue = () => ({ profile: { name: "A" } }); const source = getValue(); const { profile: { nmae } } = source;',
            errors: [{
                messageId: 'missingProperty',
                data: { property: 'profile.nmae' }
            }]
        }
    ]
});
