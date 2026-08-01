import { RuleTester } from 'eslint';

import rule from '../rules/prefer-signature-destructuring.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('prefer-signature-destructuring', rule, {
    valid: [
        {
            code: 'const inspect = (node) => { const { type = "" } = node; sendNode(node); return type; };'
        },
        {
            code: 'const inspect = (node) => { const { type = "" } = node; sendNode({ node }); return type; };'
        },
        {
            code: 'const inspect = (node) => { const inspectType = () => { const { type = "" } = node; return type; }; return inspectType; };'
        }

    ],
    invalid: [
        {
            code: 'const processUser = (user) => { const { name, age } = user; return `${name} (${age})`; };',
            errors: [{ messageId: 'preferSignature' }]
        },
        {
            code: 'const getTitle = (article = {}) => { const { title } = article; return title; };',
            errors: [{ messageId: 'preferSignature' }]
        },
        {
            code: 'function getMode(settings) { const { mode = "" } = settings; return mode; }',
            errors: [{ messageId: 'preferSignature' }]
        },
        {
            code: 'const getName = (user) => { sendUser(user); const { name = "" } = user; return name; };',
            errors: [{ messageId: 'preferSignature' }]
        },
        {
            code: 'const getSettings = (config) => { const { theme = "" } = config; const { mode = "" } = config; return `${theme}:${mode}`; };',
            errors: [
                { messageId: 'preferSignature' },
                { messageId: 'preferSignature' }
            ]
        }
    ]
});
