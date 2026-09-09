import assert from 'node:assert/strict';

import { getEvidenceTrail } from '../rules/contracts/evidence-trail.js';
import { extendTraversalPath, someTraversalChild } from '../rules/support/ast-traversal.js';
import { hasAwaitExpression, hasLoopControl } from '../rules/support/loop-analysis.js';
import { getObject } from '../rules/support/object.js';

// Exact prior collector is a behavioral oracle, not a second production route.
const referenceTrail = ({ id = '', recordsById = new Map(), visited = new Set() } = {}) => {
    if (!id || visited.has(id)) return [];

    const nextVisited = new Set([...visited, id]);
    const record = recordsById.get(id);
    const { derivesFrom = [] } = getObject(record);

    return [
        ...(record ? [record] : []),
        ...derivesFrom.flatMap(parent => referenceTrail({ id: parent, recordsById, visited: nextVisited }))
    ];
};

const records = new Map([
    ['root', Object.freeze({ id: 'root', derivesFrom: Object.freeze(['left', 'right', 'missing', '']) })],
    ['left', Object.freeze({ id: 'left', derivesFrom: Object.freeze(['shared', 'root']) })],
    ['right', Object.freeze({ id: 'right', derivesFrom: Object.freeze(['shared']) })],
    ['shared', Object.freeze({ id: 'shared', derivesFrom: Object.freeze([]) })]
]);
const seed = new Set(['preexisting']);
const expected = ['root', 'left', 'shared', 'right', 'shared'].map(id => records.get(id));
assert.deepEqual(getEvidenceTrail({ id: 'root', recordsById: records, visited: seed }), expected);
assert.deepEqual(referenceTrail({ id: 'root', recordsById: records, visited: seed }), expected);
assert.deepEqual([...seed], ['preexisting']);
assert.deepEqual(getEvidenceTrail({ id: 'root', recordsById: records, visited: new Set(['root']) }), []);
assert.deepEqual(getEvidenceTrail({ id: 'missing', recordsById: records }), []);
assert.deepEqual(getEvidenceTrail(), []);

const frozenLeaf = Object.freeze({ id: 'leaf' });
const observedRun = (collect) => {
    let events = [];
    const note = (event) => { events = [...events, event]; };
    const observedSeed = {
        has: (id) => { note(`has:${id}`);

            return false; },
        [Symbol.iterator]: () => { note('seed:iterate');

            return seed[Symbol.iterator](); }
    };
    const dependencies = ['leaf', 'leaf'];
    Object.defineProperty(dependencies, '0', { get: () => { note('edge:0');

        return 'leaf'; } });
    const rootRecord = {};
    Object.defineProperty(rootRecord, 'derivesFrom', { get: () => { note('root:dependencies');

        return dependencies; } });
    const lookup = { get: (id) => { note(`get:${id}`);

        return id === 'root' ? rootRecord : frozenLeaf; } };
    const result = collect({ id: 'root', recordsById: lookup, visited: observedSeed });

    return { result: result.map(record => record === rootRecord ? 'root' : 'leaf'), events };
};
assert.deepEqual(observedRun(getEvidenceTrail), observedRun(referenceTrail));
assert.deepEqual(observedRun(getEvidenceTrail).events, [
    'has:root', 'seed:iterate', 'get:root', 'root:dependencies', 'edge:0', 'get:leaf', 'get:leaf'
]);
const seedFailure = new Error('seed iteration');
const lookupFailure = new Error('record lookup');
[referenceTrail, getEvidenceTrail].forEach((collect) => {
    assert.throws(() => collect({ id: 'root', visited: {
        has: () => false,
        [Symbol.iterator]: () => { throw seedFailure; }
    }, recordsById: { get: () => { throw lookupFailure; } } }), error => error === seedFailure);
    assert.throws(() => collect({ id: 'root', recordsById: { get: () => { throw lookupFailure; } } }), error => error === lookupFailure);
    const failingRecord = {};
    Object.defineProperty(failingRecord, 'derivesFrom', { get: () => { throw lookupFailure; } });
    assert.throws(() => collect({ id: 'root', recordsById: new Map([['root', failingRecord]]) }), error => error === lookupFailure);
    assert.throws(() => collect({ id: 'root', recordsById: new Map([['root', { derivesFrom: null }]]) }), { name: 'TypeError' });
});
const lateFailure = new Error('late edge read');
const edges = ['shared'];
Object.defineProperty(edges, '1', { get: () => { throw lateFailure; } });
const hostileRecords = new Map([...records, ['hostile', { derivesFrom: edges }]]);
[referenceTrail, getEvidenceTrail].forEach((collect) => {
    assert.throws(() => collect({ id: 'hostile', recordsById: hostileRecords }), error => error === lateFailure);
});
// A diamond is not a cycle: each path retains the same shared record identity.
assert.equal(getEvidenceTrail({ id: 'root', recordsById: records })[2], getEvidenceTrail({ id: 'root', recordsById: records })[4]);
// eslint-disable-next-line no-sparse-arrays -- Evidence dependency arrays must skip absent slots without deduplicating repeated record identities.
const sparseEdges = ['shared', , 'shared'];
const sparseRecords = new Map([...records, ['sparse', { derivesFrom: sparseEdges }]]);
assert.deepEqual(getEvidenceTrail({ id: 'sparse', recordsById: sparseRecords }), referenceTrail({ id: 'sparse', recordsById: sparseRecords }));
assert.equal(getEvidenceTrail({ id: 'sparse', recordsById: sparseRecords }).length, 3);

const extended = extendTraversalPath(seed, 'root');
assert.deepEqual([...extended], ['preexisting', 'root']);
assert.notEqual(extended, seed);
assert.deepEqual([...seed], ['preexisting']);
assert.deepEqual([...extendTraversalPath(extended, 'root')], ['preexisting', 'root']);
assert.throws(() => extendTraversalPath({ [Symbol.iterator]: () => { throw seedFailure; } }, 'root'), error => error === seedFailure);

const first = Object.freeze({ type: 'Identifier', name: 'first' });
const awaited = Object.freeze({ type: 'AwaitExpression', argument: first });
const returned = Object.freeze({ type: 'ReturnStatement', argument: first });
let childEvents = [];
const queried = { first, children: [first, awaited, returned] };
assert.equal(someTraversalChild(queried, (child) => {
    childEvents = [...childEvents, child];

    return child === awaited;
}), true);
assert.deepEqual(childEvents, [first, first, awaited]);
let arities = [];
assert.equal(someTraversalChild({ one: first, many: [first] }, (...values) => {
    arities = [...arities, values.length];

    return false;
}), false);
assert.deepEqual(arities, [1, 1]);
const eagerFailure = new Error('entry discovery remains eager');
const eager = { first: awaited };
Object.defineProperty(eager, 'later', { enumerable: true, get: () => { throw eagerFailure; } });
assert.throws(() => someTraversalChild(eager, child => child === awaited), error => error === eagerFailure);
const branchFailure = new Error('later child must remain unvisited');
const later = {};
Object.defineProperty(later, 'type', { enumerable: true, get: () => { throw branchFailure; } });
assert.equal(hasAwaitExpression({ type: 'Program', body: [awaited, later] }), true);
assert.equal(hasLoopControl({ type: 'Program', body: [returned, later] }), true);
assert.equal(hasAwaitExpression({ type: 'Program', body: [{ type: 'ArrowFunctionExpression', body: awaited }] }), false);
assert.equal(hasLoopControl({ type: 'Program', body: [{ type: 'ForStatement', body: returned }] }), false);
const cyclic = { type: 'Program', body: [] };
Object.defineProperty(cyclic, 'self', { enumerable: true, value: cyclic });
assert.equal(hasAwaitExpression(cyclic), false);
assert.equal(hasLoopControl(cyclic), false);
assert.equal(hasAwaitExpression(awaited, new Set([awaited])), false);
assert.equal(hasLoopControl(returned, new Set([returned])), false);
assert.equal(hasLoopControl({ type: 'SwitchStatement', cases: [{ type: 'SwitchCase', consequent: [{ type: 'BreakStatement' }] }] }), false);
assert.equal(hasLoopControl({ type: 'SwitchStatement', cases: [{ type: 'SwitchCase', consequent: [returned] }] }), true);

export { referenceTrail };
