import assert from 'node:assert/strict';

import { getChildren, walk } from '../rules/contracts/infer.js';
import { getTraversalEntries, isTraversalMetadataKey } from '../rules/support/ast-traversal.js';
import { hasAwaitExpression, hasLoopControl } from '../rules/support/loop-analysis.js';
import { getStaticMemberProperties } from '../rules/support/signature-analysis.js';

const metadata = ['parent', 'loc', 'range', 'tokens', 'comments'];
metadata.forEach(key => assert.equal(isTraversalMetadataKey(key), true));
['type', 'body', 'expression', '', 'constructor'].forEach(key => assert.equal(isTraversalMetadataKey(key), false));

const first = { type: 'Identifier', name: 'first' };
const second = { type: 'Identifier', name: 'second' };
// eslint-disable-next-line no-sparse-arrays -- This hostile child array proves parser traversal skips holes while retaining repeated child identity and order.
const sparse = [first, , false, second, first];
const source = {
    type: 'Program', body: sparse, parent: first, loc: second,
    range: first, tokens: [second], comments: [first], final: second,
    unknown: { payload: first }, absent: false
};
Object.freeze(sparse);
Object.freeze(source);
assert.deepEqual(getTraversalEntries(source).map(([key = ''] = []) => key), ['type', 'body', 'final', 'unknown', 'absent']);
assert.equal(getTraversalEntries(source)[1][1], sparse);
assert.deepEqual(getChildren(source), [first, second, first, second]);
assert.deepEqual(getTraversalEntries(), []);
// eslint-disable-next-line resilient/signature-contract-call-site -- The unguarded entry selector must retain native TypeError on null rather than normalize it into an empty AST.
assert.throws(() => getTraversalEntries(null), { name: 'TypeError' });
/* eslint-disable resilient/signature-contract-call-site -- These guarded analyzer consumers must reject null and primitive AST inputs with their established empty or false results. */
assert.deepEqual([getChildren(null), getChildren(false),
    hasAwaitExpression(null), hasLoopControl(null)], [[], [], false, false]);
/* eslint-enable */

let reads = [];
const observed = { type: 'Program' };
Object.defineProperties(observed, {
    parent: { enumerable: true, get: () => {
        reads = [...reads, 'parent'];

        return first;
    } },
    child: { enumerable: true, get: () => {
        reads = [...reads, 'child'];

        return second;
    } }
});
assert.deepEqual(getChildren(observed), [second]);
assert.deepEqual(reads, ['child']);
reads = [];
assert.deepEqual(getTraversalEntries(observed).map(([key = ''] = []) => key), ['type', 'child']);
assert.deepEqual(reads, ['parent', 'child']);
reads = [];
assert.equal(hasAwaitExpression(observed), false);
assert.deepEqual(reads, ['parent', 'child']);
reads = [];
assert.equal(hasLoopControl(observed), false);
assert.deepEqual(reads, ['parent', 'child']);
reads = [];
assert.deepEqual(getStaticMemberProperties({ node: observed, name: 'second' }).wholeObjectNodes, [second]);
assert.deepEqual(reads, ['parent', 'child']);

const failure = new Error('native metadata read failure');
const hostileMetadata = { type: 'Program', body: [first] };
Object.defineProperty(hostileMetadata, 'parent', { enumerable: true, get: () => {
    throw failure;
} });
assert.deepEqual(getChildren(hostileMetadata), [first]);
assert.throws(() => getTraversalEntries(hostileMetadata), error => error === failure);
assert.throws(() => getStaticMemberProperties({ node: hostileMetadata, name: 'first' }), error => error === failure);
assert.throws(() => hasAwaitExpression(hostileMetadata), error => error === failure);
assert.throws(() => hasLoopControl(hostileMetadata), error => error === failure);

const root = { type: 'BlockStatement', body: [first, first] };
Object.defineProperty(root, 'cycle', { enumerable: true, value: root });
let visited = [];
walk(root, (node) => {
    visited = [...visited, node];
});
assert.deepEqual(visited, [root, first, first]);
assert.equal(hasAwaitExpression(root), false);
assert.equal(hasLoopControl(root), false);
assert.deepEqual(getChildren(root), [first, first, root]);

const awaited = { type: 'AwaitExpression', argument: first };
const returned = { type: 'ReturnStatement', argument: first };
const callback = { type: 'ArrowFunctionExpression', body: { type: 'BlockStatement', body: [awaited, returned] } };
const nestedLoop = { type: 'ForStatement', body: returned };
const switched = { type: 'SwitchStatement', cases: [{ type: 'SwitchCase', consequent: [{ type: 'BreakStatement' }] }] };
assert.equal(hasAwaitExpression({ type: 'BlockStatement', body: [callback] }), false);
assert.equal(hasAwaitExpression(callback), true);
assert.equal(hasLoopControl({ type: 'BlockStatement', body: [callback, nestedLoop, switched] }), false);
assert.equal(hasLoopControl(nestedLoop), true);
assert.equal(hasLoopControl({ type: 'BlockStatement', body: [{ type: 'BreakStatement' }] }), true);
assert.equal(hasAwaitExpression({ type: 'BlockStatement', body: sparse.map(child => child === first ? awaited : child) }), true);
assert.equal(hasLoopControl({ type: 'BlockStatement', body: sparse.map(child => child === first ? returned : child) }), true);
visited = [];
walk(callback, (node) => {
    visited = [...visited, node];
}, { skipFunctions: true });
assert.deepEqual(visited, [callback]);

const carrier = { type: 'Identifier', name: 'input' };
const read = { type: 'MemberExpression', object: carrier, property: { type: 'Identifier', name: 'value' }, computed: false };
Object.defineProperty(carrier, 'parent', { value: read });
const write = { type: 'MemberExpression', object: carrier, property: { type: 'Identifier', name: 'changed' }, computed: false };
const assignment = { type: 'AssignmentExpression', left: write, right: first, operator: '=' };
Object.defineProperty(write, 'parent', { value: assignment });
const dynamic = { type: 'MemberExpression', object: carrier, property: first, computed: true };
const untyped = { nested: { type: 'Identifier', name: 'input' } };
const signatureRoot = { type: 'BlockStatement', body: [read, read, assignment, dynamic, untyped] };
const result = getStaticMemberProperties({ node: signatureRoot, name: 'input' });
assert.deepEqual(result.properties, ['value']);
assert.deepEqual(result.memberNodes, [read, read]);
assert.deepEqual(result.wholeObjectNodes, [dynamic, untyped.nested]);
assert.equal(result.hasUnsafeReference, true);
assert.deepEqual(getStaticMemberProperties({ node: signatureRoot, name: 'input', excludedNodes: [read, assignment, dynamic, untyped] }), {
    properties: [], memberNodes: [], wholeObjectNodes: [], hasUnsafeReference: false
});
assert.deepEqual(getChildren(untyped), [untyped.nested]);
assert.deepEqual(getChildren({ type: 'BlockStatement', payload: untyped }), []);

const terminal = { type: 'Program', first, later: {} };
Object.defineProperty(terminal.later, 'child', { enumerable: true, get: () => {
    throw new Error('short-circuited branch must not be visited');
} });
assert.equal(hasAwaitExpression({ type: 'BlockStatement', first: awaited, later: terminal.later }), true);
assert.equal(hasLoopControl({ type: 'BlockStatement', first: returned, later: terminal.later }), true);
