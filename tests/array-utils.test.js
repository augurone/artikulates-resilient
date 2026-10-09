import assert from 'node:assert/strict';

import {
    getArray,
    hasArrayContent,
    hasArrayValue,
    isArray,
    validArray
} from '../rules/support/array.js';

const values = ['value'];

assert.equal(isArray(undefined), false);
assert.equal(isArray(null), false);
assert.equal(isArray({}), false);
assert.equal(isArray([]), true);
assert.equal(validArray(undefined).length, 0);
assert.equal(validArray(null).length, 0);
assert.equal(validArray({}).length, 0);
assert.equal(validArray([]).length, 0);
assert.equal(validArray(values), values);
assert.equal(getArray(values), values);
assert.equal(hasArrayContent(undefined), false);
assert.equal(hasArrayContent([]), false);
assert.equal(hasArrayContent(values), true);
assert.equal(hasArrayValue(values), true);
