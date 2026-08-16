import { RuleTester } from 'eslint';

import rule from '../rules/prefer-destructured-member-access.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('prefer-destructured-member-access', rule, {
    valid: [
        { code: 'const read = ({ id = "" } = {}) => id;' },
        { code: 'const read = (user = {}) => { const { id = "" } = user; return id; };' },
        { code: 'const count = items => items.length;' },
        { code: 'const count = document => !document.content.length;' },
        { code: 'const size = collection => collection.items.size;' },
        { code: 'const map = items => items.map(transform);' },
        { code: 'const read = request => request.headers.get("origin");' },
        { code: 'const split = value => value.split("/").filter(Boolean);' },
        { code: 'const read = (user) => user["id"];' },
        { code: 'const merge = values => values.reduce((acc, value) => { acc.value = value; return acc; }, {});' }
    ],
    invalid: [
        {
            code: 'const read = (user) => user.id;',
            errors: [{ messageId: 'staticMember' }]
        },
        {
            code: 'const read = (user) => `${user.id}:${user.name}`;',
            errors: [
                { messageId: 'staticMember' },
                { messageId: 'staticMember' }
            ]
        },
        {
            code: 'const headers = request => request.headers;',
            errors: [{ messageId: 'staticMember' }]
        }
    ]
});
