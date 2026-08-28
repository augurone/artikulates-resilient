import assert from 'node:assert/strict';

import { hasComputedProperty } from '../rules/contracts/diagnostics.js';

const nullNode = JSON.parse('null');
assert.equal(hasComputedProperty(nullNode), false);
assert.equal(hasComputedProperty({
    left: null,
    argument: null,
    properties: [null],
    elements: [null]
}), false);
assert.equal(hasComputedProperty({
    properties: [{
        type: 'Property',
        computed: true
    }]
}), true);
