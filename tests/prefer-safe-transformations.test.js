import { RuleTester } from 'eslint';

import rule from '../rules/prefer-safe-transformations.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('prefer-safe-transformations', rule, {
    valid: [
        { code: 'const update = ({ count = 0, ...state } = {}, { value = "" } = {}) => ({ ...state, count: count + 1, value });' },
        { code: 'const update = (state) => { state = { ...state }; return state; };' },
        { code: 'const update = (draft) => { draft.count += 1; return draft; };', options: [{ ignoredParameters: ['draft'] }] },
        { code: 'const update = (ref) => { ref.current = true; };', options: [{ ignoredProperties: ['current'] }] },
        { code: 'const cache = {}; const update = () => { cache.value = true; };', options: [{ ignoredBindings: ['cache'] }] },
        { code: 'const collect = items => items.filter(item => item.enabled);' },
        { code: 'for (const item of items) result.push(item);' },
        { code: 'for (const item of items) { switch (item.kind) { case "done": break; default: result.push(item); } }' },
        { code: 'const update = async (resp) => { const response = await resp.json(); return { ...response, fields: { ...response.fields, red: true } }; };' }
    ],
    invalid: [
        {
            code: `const updateInput = (value) => {
    value.enabled = true;
    value.items.push(true);

    return value;
};`,
            errors: [
                { messageId: 'mutation', data: { name: 'value' } },
                { messageId: 'mutation', data: { name: 'value' } }
            ]
        },
        {
            code: `const moduleCache = {};
moduleCache.value = true;`,
            errors: [{ messageId: 'mutation', data: { name: 'moduleCache' } }]
        },
        {
            code: `const updateReducer = (
    { count = 0, ...state } = {},
    { value = '' } = {}
) => {
    const next = { ...state };
    next.count += 1;
    next.value = value;

    return next;
};`,
            errors: [
                { messageId: 'mutation', data: { name: 'next' } },
                { messageId: 'mutation', data: { name: 'next' } }
            ]
        },
        {
            code: `const collect = (items = []) => {
    const result = [];

    items.forEach(({ enabled = false } = {}) => {
        if (enabled) result.push(true);
    });

    return result;
};`,
            errors: [{ messageId: 'mutation', data: { name: 'result' } }]
        },
        {
            code: `const updateResponse = async (resp) => {
    const response = await resp.json();
    response.fields.red = 'blue';

    return response;
};`,
            errors: [{ messageId: 'mutation', data: { name: 'response' } }]
        },
        {
            code: 'const cache = {}; const update = () => { cache.value = true; };',
            errors: [{ messageId: 'mutation', data: { name: 'cache' } }]
        },
        {
            code: 'const update = (state) => { Object.assign(state, { count: 1 }); };',
            errors: [{ messageId: 'mutation', data: { name: 'state' } }]
        },
        {
            code: 'const collect = (items) => { const result = []; items.forEach(item => result.push(item)); return result; };',
            errors: [{ messageId: 'mutation', data: { name: 'result' } }]
        },
        {
            code: 'import { cache } from "./cache.js"; cache.value = true;',
            errors: [{ messageId: 'mutation', data: { name: 'cache' } }]
        },
        {
            code: 'const send = async items => { for (const item of items) { await sendItem(item); items.push(item); } };',
            errors: [{ messageId: 'mutation', data: { name: 'items' } }]
        }
    ]
});
