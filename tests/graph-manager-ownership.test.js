import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadInternalModule } from './internal-module.js';
import { putSingleEvictionCacheEntry } from '../rules/contracts/bounded-cache.js';

const owner = await loadInternalModule({
    file: 'rules/contracts/eslint-graph.js', exports: ['areFileStatesCurrent'],
    returnProbe: { fields: 'reset, getGraph, getStats, recordHit', names: ['setBoundedMapEntry', 'getCoveredGraph'] }
});
const { createProjectGraphManager = undefined, areFileStatesCurrent = undefined } = owner;
const manager = createProjectGraphManager();
const { setBoundedMapEntry = undefined, getCoveredGraph = undefined } = manager;
const first = Object.freeze({ id: 'first' });
const last = Object.freeze({ id: 'last' });
const map = new Map([['a', first], ['b', first], ['c', first]]);
assert.equal(setBoundedMapEntry({ map, key: 'd', entry: last, limit: 1 }), map);
assert.deepEqual([...map], [['d', last]]);
const single = new Map([['a', first], ['b', first], ['c', first]]);
putSingleEvictionCacheEntry({ map: single, key: 'd', entry: last, limit: 1 });
assert.deepEqual([...single.keys()], ['b', 'c', 'd']);
setBoundedMapEntry({ map, key: 'a', entry: first, limit: 2 });
setBoundedMapEntry({ map, key: 'd', entry: last, limit: 2 });
assert.deepEqual([...map.keys()], ['a', 'd']);
[0, -1, 0.5].forEach((limit) => {
    const bounded = new Map();
    setBoundedMapEntry({ map: bounded, key: 'entry', entry: first, limit });
    assert.equal(bounded.size, 1);
});
['', 0, false, null, undefined].forEach((key) => {
    const blocked = new Map([[key, first], ['a', first]]);
    setBoundedMapEntry({ map: blocked, key: 'b', entry: last, limit: 1 });
    assert.deepEqual([...blocked.keys()], [key, 'a', 'b']);
});
const nanLimit = new Map([['a', first], ['b', first]]);
setBoundedMapEntry({ map: nanLimit, key: 'c', entry: last, limit: NaN });
assert.equal(nanLimit.size, 3);
const failure = new Error('native graph-manager failure');
let order = [];
const failingMap = Object.freeze({
    delete: (key) => { order = [...order, ['delete', key]]; },
    set: (key, entry) => {
        order = [...order, ['set', key, entry]];

        throw failure;
    }
});
const limit = Object.freeze({ valueOf: () => {
    order = [...order, 'limit'];

    return 1;
} });
assert.throws(() => setBoundedMapEntry({ map: failingMap, key: 'entry', entry: first, limit }), error => error === failure);
assert.deepEqual(order, ['limit', ['delete', 'entry'], ['set', 'entry', first]]);

const root = 'root.js';
const source = 'export const value = 1;';
const coverage = {
    roots: [root], normalizedFileName: root, fileName: root,
    context: { sourceCode: { text: source } }, program: { type: 'Program' }
};
const makeEntry = (id = '') => Object.freeze({ id, roots: [root], activeFiles: [root], states: { [root]: source } });
const valid = makeEntry('valid');
const second = makeEntry('second');
assert.equal(getCoveredGraph({ ...coverage, activeGraphs: new Map([['first', valid], ['second', second]]) }), valid);
const poison = Object.freeze({ get roots() { throw failure; } });
assert.equal(getCoveredGraph({ ...coverage, activeGraphs: new Map([['first', valid], ['poison', poison]]) }), valid);
assert.throws(() => getCoveredGraph({ ...coverage, activeGraphs: new Map([['poison', poison], ['first', valid]]) }), error => error === failure);
assert.equal(getCoveredGraph({ ...coverage, candidateGraph: second, activeGraphs: new Map([['poison', poison]]) }), second);
const stale = Object.freeze({ roots: ['different.js'] });
assert.deepEqual(getCoveredGraph({ ...coverage, candidateGraph: stale, activeGraphs: new Map([['valid', valid]]) }), {});
assert.deepEqual(getCoveredGraph({ ...coverage, activeGraphs: new Map() }), {});

const live = new Map();
const insertion = Object.freeze({ get roots() {
    // eslint-disable-next-line resilient/prefer-safe-transformations -- Deliberately append during coverage traversal to prove native Map iterator liveness rather than an eager snapshot.
    live.set('late', valid);

    return ['different.js'];
} });
putSingleEvictionCacheEntry({ map: live, key: 'insert', entry: insertion, limit: 10 });
assert.equal(getCoveredGraph({ ...coverage, activeGraphs: live }), valid);

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'resilient-graph-ownership-'));
const missing = path.join(directory, 'missing.js');
try {
    const states = { [missing]: {} };
    const currentStates = new Map();
    assert.equal(areFileStatesCurrent({ fileNames: [missing, missing], states, currentStates }), true);
    assert.equal(currentStates.size, 1);
    const cachedState = currentStates.get(missing);
    fs.writeFileSync(missing, source);
    assert.equal(areFileStatesCurrent({ fileNames: [missing], states, currentStates }), true);
    assert.equal(currentStates.get(missing), cachedState);
    assert.equal(areFileStatesCurrent({ fileNames: [missing], states }), false);
    const shortCircuit = new Map();
    assert.equal(areFileStatesCurrent({ fileNames: [missing, root], states, currentStates: shortCircuit }), false);
    assert.deepEqual([...shortCircuit.keys()], [missing]);
} finally {
    fs.rmSync(directory, { recursive: true, force: true });
}
