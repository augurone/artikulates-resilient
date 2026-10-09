import assert from 'node:assert/strict';

import {
    lookupMember,
    normalizeContract,
    projectMembers,
    relateContracts
} from '../transforms/policy/contract.js';

const members = [
    { name: { text: 'id' } },
    { name: { text: 'label' } },
    { name: { text: 'ignored' } }
];

assert.deepEqual(normalizeContract({ kind: 'literal', check: 'VALUE' }), {
    kind: 'literal',
    check: 'VALUE',
    family: 'string'
});
assert.equal(lookupMember({ members, name: 'label' }), members[1]);
assert.deepEqual(projectMembers({ members, keys: ['id', 'label'] }), members.slice(0, 2));
assert.deepEqual(projectMembers({ members, keys: ['ignored'], mode: 'omit' }), members.slice(0, 2));

assert.equal(relateContracts({
    source: { kind: 'string' },
    target: { kind: 'literal' }
}), true);
assert.equal(relateContracts({
    source: { kind: 'number' },
    target: { kind: 'string' }
}), false);
assert.equal(relateContracts({
    source: { kind: 'required' },
    target: { kind: 'string' }
}), undefined);
['unknown', 'required'].forEach((kind) => {
    assert.equal(relateContracts({ source: { kind }, target: { kind: 'string' } }), undefined);
    assert.equal(relateContracts({ source: { kind: 'string' }, target: { kind } }), undefined);
});
assert.equal(relateContracts({
    source: { kind: 'object' },
    target: { kind: 'object' },
    sourceKeys: ['id', 'label'],
    targetKeys: ['id']
}), true);
