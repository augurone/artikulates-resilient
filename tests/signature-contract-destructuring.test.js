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
        { code: 'const getValue = ({ value = [] } = {}) => { const [first = {}] = value; return first; };' },
        { code: 'const getValue = () => { const [{ attr = "" } = {}] = []; return attr; };' },
        { code: 'const getValue = (items = []) => { const { [0]: value = {} } = items; return value; };' },
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
        }
    ]
});
