import { RuleTester } from 'eslint';

import rule from '../rules/signature-contract-property.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('signature-contract-property', rule, {
    valid: [
        { code: 'const user = { name: "A" }; user.name;' },
        { code: 'const read = value => value.missing;' },
        { code: 'const read = (source = {}) => source.missing;' },
        { code: 'const read = ({ name = "", ...rest } = {}) => rest.missing;' },
        { code: 'const user = { name: "A" }; user.toString();' },
        { code: 'const isSlug = value => /^[a-z0-9/-]+$/.test(value);' },
        { code: 'const pattern = /^[a-z]+$/; pattern.test(value);' },
        { code: 'const read = ({ variables: { ...variables } = {} } = {}) => variables.test;' }
    ],
    invalid: [
        {
            code: 'const user = { name: "A" }; user.nmae;',
            errors: [{
                messageId: 'missingProperty',
                data: { property: 'nmae' }
            }]
        },
        {
            code: 'const getUser = () => ({ name: "A" }); getUser().nmae;',
            errors: [{
                messageId: 'missingProperty',
                data: { property: 'nmae' }
            }]
        },
        {
            code: 'const getUser = () => ({ name: "A" }); const user = getUser(); user.nmae;',
            errors: [{
                messageId: 'missingProperty',
                data: { property: 'nmae' }
            }]
        }
    ]
});
