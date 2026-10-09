import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { Linter } from 'eslint';

import { getEnclosingFunction, isFunction } from '../rules/contracts/infer.js';
import noNestedIf from '../rules/no-nested-if.js';
import noUnguarded from '../rules/no-unguarded-callback-invocation.js';
import noUnhandled from '../rules/no-unhandled-promise-chain.js';
import preferAsync from '../rules/prefer-async-await.js';
import preferTransformations from '../rules/prefer-safe-transformations.js';
import { isFunctionType } from '../rules/support/ast-function.js';
import { getNodeParents } from '../rules/support/ast-parents.js';
import { getChainMethods, getStaticPropertyName } from '../rules/support/member-chain.js';

const functionTypes = ['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression'];

functionTypes.forEach(type => assert.equal(isFunctionType(type), true));
['', 'Program', 'ClassDeclaration', 'CustomFunctionExpression', 'function', false, null, 0, {}, []]
    .forEach(type => assert.equal(isFunctionType(type), false));
assert.equal(isFunctionType(), false);

const root = Object.freeze({ type: 'Program', parent: null });
const owner = Object.freeze({ type: 'FunctionExpression', parent: root });
const wrapper = Object.freeze({ type: 'BlockStatement', parent: owner });
const leaf = Object.freeze({ type: 'Identifier', parent: wrapper });
const seed = Object.freeze([root]);
const parents = getNodeParents({ node: leaf, parents: seed });

assert.deepEqual(parents, [root, wrapper, owner, root]);
assert.equal(parents[1], wrapper);
assert.equal(parents[2], owner);
assert.notEqual(parents, seed);
assert.equal(getNodeParents({ node: root, parents: seed }), seed);
assert.deepEqual(getNodeParents(), []);
assert.deepEqual(getNodeParents({ node: { parent: {} } }), []);
assert.deepEqual(getNodeParents({ node: { parent: [] } }), []);
assert.deepEqual(getNodeParents({ node: { parent: false } }), []);
assert.deepEqual(seed, [root]);
const observedSeed = [root];
let seedIterations = 0;
let seedEvents = [];

Object.defineProperty(observedSeed, Symbol.iterator, { value() {
    seedIterations = seedIterations + 1;
    seedEvents = [...seedEvents, 'seed:iterator'];

    return [root][Symbol.iterator]();
} });
Object.freeze(observedSeed);
assert.deepEqual(getNodeParents({ node: leaf, parents: observedSeed }), [root, wrapper, owner, root]);
assert.equal(seedIterations, 1);
const seededTail = { type: 'BlockStatement' };
const seededLeaf = {};

Object.defineProperty(seededTail, 'parent', { enumerable: true, get: () => {
    seedEvents = [...seedEvents, 'tail:parent'];

    return root;
} });
Object.defineProperty(seededLeaf, 'parent', { get: () => {
    seedEvents = [...seedEvents, 'leaf:parent'];

    return seededTail;
} });
seedEvents = [];
assert.deepEqual(getNodeParents({ node: seededLeaf, parents: observedSeed }), [root, seededTail, root]);
assert.deepEqual(seedEvents, ['leaf:parent', 'seed:iterator', 'tail:parent']);
assert.equal(getNodeParents({ node: root, parents: observedSeed }), observedSeed);
assert.equal(seedIterations, 2);
assert.equal(getEnclosingFunction(leaf), owner);
assert.deepEqual(getEnclosingFunction(owner), {});
assert.deepEqual(getEnclosingFunction(), {});
assert.deepEqual(getEnclosingFunction({ parent: { parent: owner } }), {});
assert.deepEqual(getNodeParents({ node: { parent: { parent: owner } } }), [{ parent: owner }, owner, root]);

let reads = [];
const terminal = { type: 'Program' };
const observedParent = {};
const observedLeaf = {};

Object.defineProperties(terminal, {
    [Symbol.toStringTag]: { get: () => {
        reads = [...reads, 'root:tag'];

        return 'Object';
    } },
    parent: { enumerable: true, get: () => {
        reads = [...reads, 'root:parent'];

        // eslint-disable-next-line resilient/prefer-falsey-returns -- A parser root's null parent is the observed terminal value, not a fabricated empty object.
        return null;
    } }
});
Object.defineProperties(observedParent, {
    [Symbol.toStringTag]: { get: () => {
        reads = [...reads, 'parent:tag'];

        return 'Object';
    } },
    type: { enumerable: true, get: () => {
        reads = [...reads, 'parent:type'];

        return 'FunctionExpression';
    } },
    parent: { enumerable: true, get: () => {
        reads = [...reads, 'parent:parent'];

        return terminal;
    } }
});
Object.defineProperties(observedLeaf, {
    [Symbol.toStringTag]: { get: () => {
        reads = [...reads, 'leaf:tag'];

        return 'Object';
    } },
    parent: { enumerable: true, get: () => {
        reads = [...reads, 'leaf:parent'];

        return observedParent;
    } }
});
assert.deepEqual(getNodeParents({ node: observedLeaf }), [observedParent, terminal]);
assert.deepEqual(reads, ['leaf:tag', 'leaf:parent', 'parent:tag', 'parent:tag', 'parent:parent',
    'root:tag', 'root:tag', 'root:parent']);
reads = [];
assert.equal(getEnclosingFunction(observedLeaf), observedParent);
assert.deepEqual(reads, ['leaf:tag', 'leaf:parent', 'parent:tag', 'parent:type', 'parent:tag', 'parent:type']);
const changingType = { parent: root };
let typeReads = 0;

Object.defineProperty(changingType, 'type', { enumerable: true, get: () => {
    typeReads = typeReads + 1;

    return typeReads === 1 ? 'BlockStatement' : 'FunctionExpression';
} });
assert.equal(getEnclosingFunction({ parent: changingType }), changingType);
assert.equal(typeReads, 2);

const failure = new Error('parent boundary failed');
const hostileOwner = { type: 'FunctionDeclaration' };

Object.defineProperty(hostileOwner, 'parent', { enumerable: true, get: () => {
    throw failure;
} });
assert.equal(getEnclosingFunction({ parent: hostileOwner }), hostileOwner);
assert.throws(() => getNodeParents({ node: { parent: hostileOwner } }), error => error === failure);
assert.throws(() => getEnclosingFunction(hostileOwner), error => error === failure);
const hostileSeed = [];
const seedFailure = new Error('seed iteration fails before deeper parent access');

Object.defineProperty(hostileSeed, Symbol.iterator, { get: () => {
    throw seedFailure;
} });
assert.equal(getNodeParents({ node: root, parents: hostileSeed }), hostileSeed);
assert.throws(() => getNodeParents({ node: { parent: hostileOwner }, parents: hostileSeed }), error => error === seedFailure);

let cycleReads = 0;
const cycle = { type: 'BlockStatement' };

Object.defineProperty(cycle, 'parent', { enumerable: true, get: () => {
    cycleReads = cycleReads + 1;

    if (cycleReads === 4) throw failure;

    return cycle;
} });
assert.throws(() => getNodeParents({ node: cycle }), error => error === failure);
assert.equal(cycleReads, 4);
const plainCycle = { type: 'BlockStatement' };

Object.defineProperty(plainCycle, 'parent', { enumerable: true, value: plainCycle });
Object.freeze(plainCycle);
assert.throws(() => getNodeParents({ node: plainCycle }), { name: 'RangeError' });
assert.throws(() => getEnclosingFunction(plainCycle), { name: 'RangeError' });
cycleReads = 0;
assert.throws(() => getEnclosingFunction(cycle), error => error === failure);
assert.equal(cycleReads, 4);

const call = ({ name = '', object = {}, computed = false } = {}) => Object.freeze({
    type: 'CallExpression',
    callee: Object.freeze({
        type: 'MemberExpression', computed, object,
        property: Object.freeze({ type: 'Identifier', name })
    })
});
const request = Object.freeze({ type: 'CallExpression', callee: Object.freeze({ type: 'Identifier', name: 'request' }) });
const chain = call({ name: 'catch', object: call({ name: 'then', object: call({ name: 'then', object: request }) }) });

assert.deepEqual(getChainMethods(chain), ['catch', 'then', 'then']);
assert.deepEqual(getChainMethods(call({ name: 'finally', object: chain, computed: true })), ['catch', 'then', 'then']);
assert.deepEqual(getChainMethods(), []);
assert.equal(getStaticPropertyName({ type: 'MemberExpression', property: { type: 'Identifier', name: 'push' } }), 'push');
assert.equal(getStaticPropertyName({ type: 'MemberExpression', computed: true, property: { type: 'Identifier', name: 'push' } }), '');
/* eslint-disable resilient/signature-contract-call-site -- Deliberate non-call containers and literal member keys prove rejection rather than inventing static member facts. */
assert.deepEqual([
    getChainMethods({ type: 'MemberExpression', object: chain }),
    getStaticPropertyName({ type: 'MemberExpression', property: { type: 'Literal', value: 'push' } })
], [[], '']);
/* eslint-enable */
assert.equal(getStaticPropertyName({ type: 'Identifier', property: { type: 'Identifier', name: 'push' } }), '');
assert.equal(getStaticPropertyName(), '');

const observedProperty = {};
const observedMember = {};

Object.defineProperties(observedProperty, {
    type: { get: () => {
        reads = [...reads, 'property:type'];

        return 'Identifier';
    } },
    name: { get: () => {
        reads = [...reads, 'property:name'];

        return 'then';
    } }
});
Object.defineProperties(observedMember, {
    type: { get: () => {
        reads = [...reads, 'member:type'];

        return 'MemberExpression';
    } },
    computed: { get: () => {
        reads = [...reads, 'member:computed'];

        return false;
    } },
    property: { get: () => {
        reads = [...reads, 'member:property'];

        return observedProperty;
    } },
    object: { get: () => {
        reads = [...reads, 'member:object'];

        return request;
    } }
});
reads = [];
assert.deepEqual(getChainMethods({ type: 'CallExpression', callee: observedMember }), ['then']);
assert.deepEqual(reads, ['member:type', 'member:computed', 'member:property', 'property:type', 'property:name', 'member:object']);
const hostileMember = { type: 'MemberExpression' };

Object.defineProperty(hostileMember, 'property', { get: () => {
    throw failure;
} });
assert.throws(() => getStaticPropertyName(hostileMember), error => error === failure);
assert.throws(() => getChainMethods({ type: 'CallExpression', callee: hostileMember }), error => error === failure);
// eslint-disable-next-line resilient/signature-contract-call-site -- Deliberately pass a null property to prove native destructuring failure rather than a fabricated empty member record.
assert.throws(() => getStaticPropertyName({ type: 'MemberExpression', property: null }), { name: 'TypeError' });
// eslint-disable-next-line resilient/signature-contract-call-site -- A null callee must fail at the existing member boundary; this negative test must not normalize it into a call-shaped node.
assert.throws(() => getChainMethods({ type: 'CallExpression', callee: null }), { name: 'TypeError' });

const cyclicChain = { type: 'CallExpression' };
const cyclicMember = { type: 'MemberExpression', property: { type: 'Identifier', name: 'then' } };
let chainReads = 0;

Object.defineProperty(cyclicChain, 'callee', { value: cyclicMember });
Object.defineProperty(cyclicMember, 'object', { get: () => {
    chainReads = chainReads + 1;

    if (chainReads === 4) throw failure;

    return cyclicChain;
} });
assert.throws(() => getChainMethods(cyclicChain), error => error === failure);
assert.equal(chainReads, 4);

const linter = new Linter({ configType: 'flat' });
const rules = {
    nested: noNestedIf, unguarded: noUnguarded, unhandled: noUnhandled,
    async: preferAsync, mutation: preferTransformations
};
const cases = [
    { source: 'const run = ({ done } = {}) => done();', expected: ['unguarded'] },
    { source: 'const run = ({ done } = {}) => () => done();', expected: ['unguarded'] },
    { source: 'const run = ({ done } = {}) => { if (!isFunction(done)) return; done(); };', expected: [] },
    { source: 'if (ready) { if (value) use(value); }', expected: ['nested'] },
    { source: 'if (ready) { use(() => { if (value) use(value); }); }', expected: [] },
    { source: 'request().then(handle).catch(report);', expected: ['async'] },
    { source: 'request().then(handle).finally(cleanup);', expected: ['unhandled'] },
    { source: 'void request().then(handle);', expected: ['async'] },
    { source: 'const values = []; values.push(1);', expected: ['mutation'] }
];

cases.forEach(({ source = '', expected = [] } = {}) => {
    const messages = linter.verify(source, [{
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        plugins: { proof: { rules } },
        rules: Object.fromEntries(Object.keys(rules).map(name => [`proof/${name}`, 'error']))
    }]);

    assert.deepEqual(messages.map(({ ruleId = '' } = {}) => ruleId.replace('proof/', '')), expected, source);
});

const { href: publicFunctionUrl = '' } = new URL('../rules/support/function.js', import.meta.url);
const { href: privateFunctionUrl = '' } = new URL('../rules/support/ast-function.js', import.meta.url);
const { href: inferUrl = '' } = new URL('../rules/contracts/infer.js', import.meta.url);
const registryProof = spawnSync(process.execPath, ['--input-type=module', '-e', `
const { FUNCTION_TYPES, isFunctionNode } = await import(${JSON.stringify(publicFunctionUrl)});
const { isFunctionType } = await import(${JSON.stringify(privateFunctionUrl)});
const { isFunction } = await import(${JSON.stringify(inferUrl)});
FUNCTION_TYPES.delete('FunctionDeclaration');
FUNCTION_TYPES.add('InventedFunction');
console.log(JSON.stringify([
    isFunctionNode({type:'FunctionDeclaration'}), isFunctionNode({type:'InventedFunction'}),
    isFunctionType('FunctionDeclaration'), isFunctionType('InventedFunction'),
    isFunction({type:'FunctionDeclaration'}), isFunction({type:'InventedFunction'})
]));
`], { encoding: 'utf8' });

assert.equal(registryProof.status, 0, registryProof.stderr);
assert.deepEqual(JSON.parse(registryProof.stdout), [false, true, true, false, true, false]);
assert.equal(isFunction({ type: 'FunctionDeclaration' }), true);
