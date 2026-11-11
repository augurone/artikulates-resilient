import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { ESLint } from 'eslint';
import { parse } from 'espree';

import { all, createOwner, field, fromESTree, isCurrent, receiver, replaceEvidence, request, unresolved } from 'eslint-plugin-resilient/agreement';
import plugin from 'eslint-plugin-resilient/eslint';

const expression = source => parse(`(${source})`, { ecmaVersion: 'latest' }).body.at(0).expression;

test('complete evidence acquisition and nested demand have bounded call-stack use', () => {
    const depth = 10000;
    const node = Array.from({ length: depth }).reduce(value => ({
        type: 'ObjectExpression', properties: [{
            type: 'Property', kind: 'init', computed: false, method: false, shorthand: false,
            key: { type: 'Identifier', name: 'next' }, value
        }]
    }), expression('"leaf"'));
    const required = Array.from({ length: depth }).reduce(child => field({ name: 'next', required: child }), 'string');
    const owner = createOwner({ evidence: fromESTree(node) });
    const first = request({ owner, required });
    const { status = '' } = first;

    strictEqual(status, 'agreement');
    replaceEvidence({ owner, evidence: fromESTree(expression('{}')) });
    strictEqual(isCurrent(first), false);
    strictEqual(request({ owner, required }).status, 'contradiction');
});

test('complete acquisition owns supported syntax without reading host metadata or unused bodies', () => {
    const node = expression('{ value: { text: "before" }, run() { return 1; } }');
    const { properties = [] } = node;
    const { value: nested = {} } = properties.at(0);
    const { value: method = {} } = properties.at(1);

    Object.defineProperty(node, 'parent', { enumerable: true, get() { throw new Error('Host metadata is not evidence'); } });
    Object.defineProperty(method, 'body', { enumerable: true, get() { throw new Error('Function bodies are not supported evidence'); } });

    const owner = createOwner({ evidence: fromESTree(node) });
    const text = field({ name: 'value', required: field({ name: 'text', required: 'string' }) });

    Object.defineProperty(nested, 'properties', { value: [] });
    strictEqual(request({ owner, required: text }).status, 'agreement');
    strictEqual(request({ owner, required: field({ name: 'run', required: 'function' }) }).status, 'agreement');
    strictEqual(request({ owner, required: field({ name: 'missing', required: all() }) }).status, 'contradiction');
});

test('acquisition failures in required syntax still propagate without publishing evidence', () => {
    const node = expression('{ value: 1 }');
    const failure = new Error('Required source read failed');

    Object.defineProperty(node, 'properties', { get() { throw failure; } });
    throws(() => fromESTree(node), error => error === failure);
});

test('public metadata cannot retain mutable caller data or coerce an operation name into evidence', () => {
    const owner = createOwner({ evidence: unresolved() });

    [[], {}, 1, false, null].forEach((value) => {
        throws(() => unresolved({ reason: value }), TypeError);
        throws(() => request({ owner, required: 'string', consumer: value }), TypeError);
    });
    [['map'], { toString: () => 'trim' }].forEach(operation => throws(() => receiver({ operation }), TypeError));
    strictEqual(request({ owner, required: 'string', consumer: 'label' }).consumer, 'label');
});

test('complete acquisition reads each shared value once and preserves distinct field premises', (context) => {
    const leaf = expression('"shared"');
    const readType = context.mock.fn(() => 'Literal');
    const node = expression('{ first: 1, second: 2 }');
    const { properties = [] } = node;

    Object.defineProperty(leaf, 'type', { get: readType });
    properties.forEach(property => Object.defineProperty(property, 'value', { value: leaf }));

    const owner = createOwner({ evidence: fromESTree(node) });
    const first = field({ name: 'first', required: 'string' });
    const second = field({ name: 'second', required: 'string' });
    const judgment = request({ owner, required: all({ requirements: [first, second] }) });
    const { facts = [], status = '' } = judgment;

    strictEqual(status, 'agreement');
    strictEqual(readType.mock.callCount(), 2, 'The snapshot header and literal payload inspect one unique node');
    strictEqual(facts.filter(({ facet = '' } = {}) => facet === 'family').length, 2, 'The shared field value has one owner');
    strictEqual(facts.filter(({ facet = '' } = {}) => facet.startsWith('field:')).length, 2, 'Each named field keeps its own presence premise');
});

const lint = new ESLint({ overrideConfigFile: true, overrideConfig: [{
    plugins: { resilient: plugin }, rules: { 'resilient/prefer-falsey-returns': 'error' }
}] });

[
    ['null || "safe"', []], ['undefined ?? "safe"', []], ['void run() || "safe"', []],
    ['(ready ? null : external) ?? "safe"', []], ['value += null', []],
    ['value = null', ['null']], ['value && null', ['null']], ['value || null', ['null']],
    ['value ?? undefined', ['undefined']], ['null && value', ['null']],
    ['(ready ? null : value) || undefined', ['undefined']]
].forEach(([value = '', expected = []] = []) => test(`return selection preserves the operator contract: ${value}`, async () => {
    const source = `const read = () => ${value};`;
    const [{ messages = [], fatalErrorCount = 0 } = {}] = await lint.lintText(source);

    strictEqual(fatalErrorCount, 0);
    deepStrictEqual(messages.map(({ column = 0, endColumn = 0, messageId = '' } = {}) => {
        strictEqual(messageId, 'falseyReturn');

        return source.slice(column - 1, endColumn - 1);
    }), expected);
}));

test('explicit undefined defaults are assignments while shadowed undefined stays an ordinary binding', async () => {
    const engine = new ESLint({ overrideConfigFile: true, overrideConfig: [{
        plugins: { resilient: plugin }, rules: { 'resilient/no-undefined-assignment': 'error' }
    }] });
    const sources = [
        ['const read = (value = undefined) => value;', 1],
        ['const { value = undefined } = external;', 1],
        ['let value; [value = undefined] = external;', 1],
        ['const read = (undefined, value = undefined) => value;', 0],
        ['const undefined = "ordinary"; const { value = undefined } = external;', 0]
    ];

    await Promise.all(sources.map(async ([source = '', count = 0] = []) => {
        const [{ messages = [], fatalErrorCount = 0 } = {}] = await engine.lintText(source);

        strictEqual(fatalErrorCount, 0);
        strictEqual(messages.length, count);
        messages.forEach(({ messageId = '' } = {}) => strictEqual(messageId, 'undefinedAssignment'));
    }));
});
