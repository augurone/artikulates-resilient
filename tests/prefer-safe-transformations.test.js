import assert from 'node:assert/strict';

import { Linter, RuleTester } from 'eslint';

import prototypeRule from '../rules/prefer-prototype-methods.js';
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
        { code: 'getRef().current = true;', options: [{ ignoredProperties: ['current'] }] },
        { code: 'items.map(item => getRef(item).current++);', options: [{ ignoredProperties: ['current'] }] },
        { code: 'getCollection().add(value);', options: [{ ignoredProperties: ['add'] }] },
        { code: 'const bucket = map.get(key); bucket.add(value);', options: [{ ignoredBindings: ['bucket'] }] },
        { code: 'Object.assign(getTarget(), source);', options: [{ ignoredProperties: ['assign'] }] },
        { code: 'Object.assign({}, source); Object.assign([], source);' },
        { code: 'getCollection().custom(value); Object.defineProperty(getTarget(), "field", descriptor);' },
        { code: 'Object.assign(); add(value); getTarget().value;' },
        { code: 'const collect = items => items.filter(item => item.enabled);' },
        { code: 'for (const item of items) process(item);' },
        { code: 'for (const item of items) result.push(item);', options: [{ ignoredBindings: ['result'] }] },
        { code: 'const update = async (resp) => { const response = await resp.json(); return { ...response, fields: { ...response.fields, red: true } }; };' }
    ],
    invalid: [
        {
            code: 'map.get(key).add(value); const bucket = map.get(key); bucket.add(value);',
            errors: [
                { messageId: 'unnamedMutation' },
                { messageId: 'mutation', data: { name: 'bucket' } }
            ]
        },
        {
            code: 'getTarget().value = 1; getTarget().value++; delete getTarget().value; Object.assign(getTarget(), source);',
            errors: Array.from({ length: 4 }, () => ({ messageId: 'unnamedMutation' }))
        },
        {
            code: 'items.forEach(item => map.get(item).add(item));',
            errors: [{ messageId: 'unnamedMutation' }]
        },
        {
            code: 'getCollection().push(value); getCollection().set(key, value); getCollection().clear(); getCollection().splice(0, 1);',
            errors: Array.from({ length: 4 }, () => ({ messageId: 'unnamedMutation' }))
        },
        {
            code: 'getTarget().value = 1; getCollection().add(value);',
            options: [{ ignoredParameters: ['getTarget', 'getCollection', ''], ignoredBindings: ['getTarget', 'getCollection', ''] }],
            errors: Array.from({ length: 2 }, () => ({ messageId: 'unnamedMutation' }))
        },
        {
            code: 'getTarget().value = 1; getCollection().add(value);',
            options: [{ ignoredProperties: ['value'] }],
            errors: [{ messageId: 'unnamedMutation' }]
        },
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
        },
        {
            code: 'for (const item of items) output.push(item);',
            errors: [{ messageId: 'mutation', data: { name: 'output' } }]
        },
        {
            code: 'for (const item of items) Object.assign(output, item);',
            errors: [{ messageId: 'mutation', data: { name: 'output' } }]
        },
        {
            code: 'for (const item of items) output.item = item;',
            errors: [{ messageId: 'mutation', data: { name: 'output' } }]
        },
        {
            code: 'for (const item of items) { switch (item.kind) { case "done": break; default: output.push(item); } }',
            errors: [{ messageId: 'mutation', data: { name: 'output' } }]
        },
        {
            code: 'const collect = async items => { for await (const item of items) output.push(item); };',
            errors: [{ messageId: 'mutation', data: { name: 'output' } }]
        },
        {
            code: 'for (const item of items) (() => output.push(item))();',
            errors: [{ messageId: 'mutation', data: { name: 'output' } }]
        }
    ]
});

const linter = new Linter({ configType: 'flat' });
const plugin = { rules: {
    'prefer-prototype-methods': prototypeRule,
    'prefer-safe-transformations': rule
} };
const config = (rules = {}) => [{
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    plugins: { resilient: plugin },
    rules
}];
const retainedLoop = [
    '// eslint-disable-next-line resilient/prefer-prototype-methods -- Preserve live input iteration.',
    'for (const item of items) output.push(item);'
].join('\n');
const combinedMessages = linter.verify(retainedLoop, config({
    'resilient/prefer-prototype-methods': 'error',
    'resilient/prefer-safe-transformations': 'error'
}));

assert.deepEqual(combinedMessages.map(({ ruleId = '' } = {}) => ruleId), [
    'resilient/prefer-safe-transformations'
]);
const safetyOnlyMessages = linter.verify('for (const item of items) output.push(item);', config({
    'resilient/prefer-safe-transformations': 'error'
}));

assert.deepEqual(safetyOnlyMessages.map(({ ruleId = '' } = {}) => ruleId), [
    'resilient/prefer-safe-transformations'
]);

const unnamedLoop = [
    '// eslint-disable-next-line resilient/prefer-prototype-methods -- Preserve live input iteration.',
    'for (const item of items) map.get(item).add(item);'
].join('\n');
const unnamedCombinedMessages = linter.verify(unnamedLoop, config({
    'resilient/prefer-prototype-methods': 'error',
    'resilient/prefer-safe-transformations': 'error'
}));
const unnamedSafetyMessages = linter.verify('for (const item of items) map.get(item).add(item);', config({
    'resilient/prefer-safe-transformations': 'error'
}));

assert.deepEqual(unnamedCombinedMessages.map(({ ruleId = '' } = {}) => ruleId), [
    'resilient/prefer-safe-transformations'
]);
assert.deepEqual(unnamedSafetyMessages.map(({ ruleId = '' } = {}) => ruleId), [
    'resilient/prefer-safe-transformations'
]);
assert.match(unnamedSafetyMessages[0].message, /for this value/u);
