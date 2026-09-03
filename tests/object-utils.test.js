import assert from 'node:assert/strict';

import {
    getObject,
    hasObjectValue,
    isObject
} from '../rules/support/object.js';

assert.equal(isObject(undefined), false);
assert.equal(isObject(null), false);
assert.equal(isObject([]), false);
assert.equal(isObject({}), true);
assert.deepEqual(getObject(undefined), {});
assert.deepEqual(getObject(null), {});
assert.deepEqual(getObject({ value: true }), { value: true });
assert.equal(hasObjectValue(undefined), false);
assert.equal(hasObjectValue({}), false);
assert.equal(hasObjectValue({ value: true }), true);
