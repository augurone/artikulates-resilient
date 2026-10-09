import assert from 'node:assert/strict';

import { putSingleEvictionCacheEntry } from '../rules/contracts/bounded-cache.js';

const first = { id: 'first' };
const second = { id: 'second' };
const cyclic = { get self() { return this; } };
const map = new Map();

assert.equal(cyclic.self, cyclic);
assert.equal(putSingleEvictionCacheEntry({ map, key: 'first', entry: first, limit: 2 }), map);
putSingleEvictionCacheEntry({ map, key: 'second', entry: second, limit: 2 });
putSingleEvictionCacheEntry({ map, key: 'first', entry: first, limit: 2 });
assert.deepEqual([...map.keys()], ['second', 'first']);
putSingleEvictionCacheEntry({ map, key: 'cycle', entry: cyclic, limit: 2 });
assert.deepEqual([...map.keys()], ['first', 'cycle']);
assert.equal(map.get('first'), first);
assert.equal(map.get('cycle'), cyclic);

const zeroLimit = new Map();

putSingleEvictionCacheEntry({ map: zeroLimit, key: 'item', entry: first, limit: 0 });
assert.equal(zeroLimit.size, 0);

const oversized = new Map([['a', first], ['b', second], ['c', cyclic]]);

putSingleEvictionCacheEntry({ map: oversized, key: 'd', entry: first, limit: 1 });
assert.deepEqual([...oversized.keys()], ['b', 'c', 'd']);

const failure = new Error('cache store failed');
const failingStore = { delete: () => { throw failure; } };

assert.throws(() => putSingleEvictionCacheEntry({ map: failingStore, key: 'item', entry: first }), error => error === failure);
