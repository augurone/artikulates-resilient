import assert from 'node:assert/strict';

import {
    getObject,
    hasContent,
    hasObjectValue,
    isObject,
    modelCheck
} from '../rules/support/object.js';

assert.equal(isObject(undefined), false);
assert.equal(isObject(null), false);
assert.equal(isObject([]), false);
assert.equal(isObject({}), true);
assert.deepEqual(getObject(undefined), {});
assert.deepEqual(getObject(null), {});
assert.deepEqual(getObject({ value: true }), { value: true });
assert.equal(hasContent(undefined), false);
assert.equal(hasContent({}), false);
assert.equal(hasContent({ value: true }), true);
assert.equal(hasObjectValue(undefined), false);
assert.equal(hasObjectValue({}), false);
assert.equal(hasObjectValue({ value: true }), true);
assert.equal(modelCheck('', { value: true }), false);
assert.equal(modelCheck('value', undefined), false);
assert.equal(modelCheck('value', {}), false);
assert.equal(modelCheck('value', { value: false }), true);
assert.equal(modelCheck('value', { value: 0 }), true);
