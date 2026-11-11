import { deepStrictEqual, strictEqual, ok, throws } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { createOwner, familyEvidence, record, readField, readFamily, producer, reference, replaceEvidence, unresolved, isCurrent, request, field } from 'eslint-plugin-resilient/agreement';

const owned = name => createOwner({ evidence: familyEvidence({ name }) });

test('evaluated records own immutable field headers and share selected value identities', () => {
    const text = owned('string');
    const entries = [{ name: 'title', owner: text }];
    const evidence = record({ fields: entries });
    const source = createOwner({ evidence });

    // Deliberate host mutation challenges snapshot ownership, not dialect style.
    runInNewContext('entries.splice(0, 1)', { entries });
    const result = readField({ owner: source, name: 'title' });

    strictEqual(result.cases.at(0).owner, text);
    deepStrictEqual(readFamily({ owner: source }).families, ['object']);
    strictEqual(readField({ owner: source, name: 'missing' }).cases.at(0).state, 'absent');
    strictEqual(readField({ owner: source, name: 'title' }), result);
    const { cases = [] } = result;

    [result, cases, cases.at(0)].forEach(value => ok(Object.isFrozen(value)));
});

test('record openness, duplicate writers and unknown alternatives remain distinct', () => {
    const first = owned('number');
    const last = owned('string');
    const source = createOwner({ evidence: record({ open: true, fields: [{ name: 'title', owner: first }, { name: 'title', owner: last }] }) });

    strictEqual(readField({ owner: source, name: 'title' }).cases.at(0).owner, last);
    strictEqual(readField({ owner: source, name: 'missing' }).cases.at(0).state, 'unknown');
    const closed = createOwner({ evidence: record() });
    const unknown = createOwner({ evidence: unresolved() });
    const joined = createOwner({ evidence: producer({ owners: [closed, unknown] }) });

    deepStrictEqual(readField({ owner: joined, name: 'missing' }).cases.map(({ state = '' } = {}) => state).toSorted(), ['absent', 'unknown']);
    strictEqual(request({ owner: joined, required: field({ name: 'missing', required: 'string' }) }).status, 'contradiction');
});

test('field presence and value revisions invalidate their own dependants', () => {
    const text = owned('string');
    const source = createOwner({ evidence: record({ fields: [{ name: 'title', owner: text }] }) });
    const alias = createOwner({ evidence: reference({ owner: source }) });
    const old = readField({ owner: alias, name: 'title' });
    const judgment = request({ owner: alias, required: field({ name: 'title', required: 'string' }) });

    replaceEvidence({ owner: text, evidence: familyEvidence({ name: 'number' }) });
    strictEqual(isCurrent(judgment), false);
    strictEqual(readField({ owner: alias, name: 'title' }), old);
    strictEqual(request({ owner: alias, required: field({ name: 'title', required: 'string' }) }).status, 'contradiction');
    replaceEvidence({ owner: source, evidence: record() });
    strictEqual(readField({ owner: alias, name: 'title' }).cases.at(0).state, 'absent');
    strictEqual(old.cases.at(0).state, 'present');
});

test('family projections retire structural evidence without hiding a known family', () => {
    const source = createOwner({ evidence: record() });
    const alias = createOwner({ evidence: reference({ owner: source, projection: 'family' }) });

    deepStrictEqual(readFamily({ owner: alias }).families, ['object']);
    strictEqual(readField({ owner: alias, name: 'missing' }).cases.at(0).state, 'unknown');
    replaceEvidence({ owner: source, evidence: familyEvidence({ name: 'array' }) });
    deepStrictEqual(readFamily({ owner: alias }).families, ['array']);
});

test('field observers and validation failures are operational failures, never unknown evidence', () => {
    const owner = createOwner({ evidence: record() });

    throws(() => readField({ owner, name: 0 }), TypeError);
    throws(() => record({ fields: [false] }), TypeError);
    throws(() => record({ fields: new Array(1) }), TypeError);
    throws(() => record({ open: 'yes' }), TypeError);
    throws(() => familyEvidence({ name: 'guessed' }), TypeError);
    throws(() => reference({ owner, projection: 'fields' }), TypeError);
    throws(() => readField({ owner, name: 'x', onWork: () => { throw new Error('observer'); } }), /observer/);
    throws(() => readField({ owner, name: 'x', onWork: () => replaceEvidence({ owner, evidence: record() }) }), /Source changed/);
    strictEqual(readField({ owner, name: 'x' }).cases.at(0).state, 'absent');
});
