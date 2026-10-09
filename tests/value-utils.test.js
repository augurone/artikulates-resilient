import assert from 'node:assert/strict';

import { isEmpty } from './support/value.js';

assert.equal(isEmpty(undefined), true);
assert.equal(isEmpty(null), true);
assert.equal(isEmpty(''), true);
assert.equal(isEmpty(0), true);
assert.equal(isEmpty(0n), true);
assert.equal(isEmpty(false), true);
assert.equal(isEmpty({}), true);
assert.equal(isEmpty([]), true);
assert.equal(isEmpty({ value: false }), false);
assert.equal(isEmpty([undefined]), false);
assert.equal(isEmpty('value'), false);
assert.equal(isEmpty(1), false);
assert.equal(isEmpty(true), false);
assert.equal(isEmpty(() => {}), false);
