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
            errors: [{
                messageId: 'preferSignature',
                suggestions: [{
                    messageId: 'moveToSignature',
                    output: 'const processUser = ({ name, age } = {}) => {  return `${name} (${age})`; };'
                }]
            }]
        },
        {
            code: 'const getTitle = (article = {}) => { const { title } = article; return title; };',
            errors: [{
                messageId: 'preferSignature',
                suggestions: [{
                    messageId: 'moveToSignature',
                    output: 'const getTitle = ({ title } = {}) => {  return title; };'
                }]
            }]
        },
        {
            code: 'function getMode(settings) { const { mode = "" } = settings; return mode; }',
            errors: [{
                messageId: 'preferSignature',
                suggestions: [{
                    messageId: 'moveToSignature',
                    output: 'function getMode({ mode = "" } = {}) {  return mode; }'
                }]
            }]
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
        },
        {
            code: 'const getName = (user) => { const { name = "" } = user; return `${user.id}:${name}`; };',
            errors: [{
                messageId: 'preferSignature',
                suggestions: [{
                    messageId: 'moveToSignature',
                    output: 'const getName = ({ id, name = "" } = {}) => {  return `${id}:${name}`; };'
                }]
            }]
        },
        {
            code: 'const getName = (user) => { const { name = "" } = user; return () => user.id + name; };',
            errors: [{
                messageId: 'preferSignature',
                suggestions: [{
                    messageId: 'moveToSignature',
                    output: 'const getName = ({ id, name = "" } = {}) => {  return () => id + name; };'
                }]
            }]
        },
        {
            code: 'const getName = (user) => { log("inspect"); const { name = "" } = user; return name; };',
            errors: [{ messageId: 'preferSignature' }]
        },
        {
            code: 'const getName = (user, id) => { const { name = "" } = user; return `${user.id}:${name}:${id}`; };',
            errors: [{ messageId: 'preferSignature' }]
        },
        {
            code: 'const getName = (user) => { const { name = "" } = user; const id = "local"; return `${user.id}:${name}:${id}`; };',
            errors: [{ messageId: 'preferSignature' }]
        },
        {
            code: 'const getName = (user) => { const { name = "" } = user; function id() { return "local"; } return `${user.id}:${name}`; };',
            errors: [{ messageId: 'preferSignature' }]
        }
    ]
});
