import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { parse } from 'espree';

import { readFamily } from '../analysis/agreement/facts.js';
import { createOwner, familyEvidence, record, unresolved } from '../analysis/agreement/source-owners.js';
import { createDecisions } from '../analysis/analyzer/decisions.js';
import { acquireMemberCopies } from '../analysis/analyzer/member-copies.js';
import { indexModules } from '../analysis/analyzer/modules.js';
import { acquirePatterns } from '../analysis/analyzer/patterns.js';
import { createCopyRetirement, createRecordFields } from '../analysis/analyzer/record-fields.js';
import { createValues, normalValue, valueInputs } from '../analysis/analyzer/values.js';
import { append, put } from './support/collections.js';

const setup = () => {
    const decisions = createDecisions();
    const owner = createOwner({ evidence: unresolved() });
    const unknown = normalValue({ owner });
    const values = createValues({ unknown, decisions }, gate => gate, (entry, gate) => gate);
    const layers = new WeakMap();
    const sources = new WeakMap();
    const known = (name) => {
        const owner = createOwner({ evidence: familyEvidence({ name }) });
        const value = normalValue({ owner, promise: 'none', standardPrototype: true });

        put(sources, owner, value);

        return value;
    };
    const object = (fields) => {
        const owner = createOwner({ evidence: record({ fields: fields.map(([name = '', { owner = false } = {}] = []) => ({ name, owner })) }) });
        const value = normalValue({ owner, plain: true, standardPrototype: true, nativeTag: 'Object', promise: 'none' });

        put(sources, owner, value);

        return value;
    };
    const fields = createRecordFields({ valueModel: values, decisions, recordLayers: layers, unknown, absentValue: known('nullish') },
        () => unknown, ({ owner = false, source = owner } = {}) => sources.get(source) || sources.get(owner), () => decisions.variable('unknown field'), () => {});
    const read = (value, name) => fields.fieldFrom(value, { name }, {}).value;

    return { decisions, values, layers, known, object, read };
};

test('copy retirement preserves containing fields and retires child payload and protocol evidence', () => {
    const scope = setup();
    const { values = {}, layers = {} } = scope;
    const number = scope.known('number');
    const child = scope.object([['name', number]]);
    const original = scope.object([['name', number], ['child', child]]);
    const retire = createCopyRetirement({ valueModel: values, recordLayers: layers }, () => {});
    const selected = retire(original);
    const scalar = scope.read(selected, 'name');
    const { owner = false } = values.evidenceFor(scalar);

    deepStrictEqual(readFamily({ owner }).families, ['number']);
    strictEqual(scope.read(selected, 'child').unowned, true);
    strictEqual(scope.read(original, 'child'), child);
    strictEqual(retire(selected), selected);
    strictEqual(retire(original), selected);
    const promise = normalValue({ ...scope.known('object'), promise: 'known', promiseIdentity: 'one' });
    const array = normalValue({ ...scope.known('array'), slots: Object.freeze([number, promise]), standardPrototype: true });
    const { slots = [] } = retire(array);

    strictEqual(values.typeGate(slots.at(1), '', 0, false, 'protocol'), 0);
    strictEqual(values.typeGate(promise, '', 0, false, 'protocol'), 1);
    strictEqual(values.typeGate(slots.at(0), 'number', 0), 1);
});

test('copy retirement shares projected alternatives across independent width and depth', () => {
    [[8, 8], [8, 64], [64, 8], [64, 64]].forEach(([width = 0, depth = 0] = []) => {
        const scope = setup();
        const { decisions = {}, values = {}, layers = {} } = scope;
        const gate = decisions.variable('copy');
        const leaf = scope.known('number');
        const base = values.joined(Array.from({ length: width }, () => scope.object([['name', leaf]])));
        const root = Array.from({ length: depth }).reduce(prior => values.joined([
            values.restrict(prior, gate), values.restrict(prior, decisions.not(gate))
        ]), base);
        const visits = [];
        const retire = createCopyRetirement({ valueModel: values, recordLayers: layers }, () => {
            append(visits, true);
            ok(visits.length <= width + 3 * depth + 1);
        });
        const selected = retire(root);
        const retained = new Map();
        const inspect = (entry) => {
            if (retained.has(entry)) return;

            put(retained, entry, true);
            valueInputs(entry).forEach(inspect);
        };

        inspect(selected);
        ok(retained.size <= width + 3 * depth + 1);
        const count = () => visits.length;
        const before = count();

        strictEqual(retire(root), selected);
        strictEqual(retire(selected), selected);
        strictEqual(count(), before);
    });
});

test('interrupted copy retirement retries while unknown alternatives retain their own identity', () => {
    const scope = setup();
    const { decisions = {}, values = {}, layers = {} } = scope;
    const original = scope.object([['name', scope.known('number')]]);
    const gate = decisions.variable('copy');
    const root = values.joined([values.restrict(original, gate), values.restrict(values.retire(original), decisions.not(gate))]);
    const visits = [];
    const failure = new Error('interrupted copy retirement');
    const retire = createCopyRetirement({ valueModel: values, recordLayers: layers }, () => {
        append(visits, true);

        if (visits.length === 3) throw failure;
    });

    throws(() => retire(root), error => error === failure);
    const selected = retire(root);
    const opaque = values.retire(original);

    strictEqual(retire(opaque), opaque);
    strictEqual(retire(root), selected);
    strictEqual(retire(selected), selected);
    strictEqual(values.typeGate(selected, 'object', 0), 1);
});

test('copy read safety keeps known alternatives separate from overlapping opaque evidence', () => {
    const scope = setup();
    const { decisions = {}, values = {} } = scope;
    const gate = decisions.variable('copy reads');
    const known = scope.object([['name', scope.known('number')]]);
    const { unknownValue = false } = values;
    const safe = value => decisions.and(values.typeGate(value, '', 0, false, 'copy-inert'),
        decisions.not(values.typeGate(value, 'unsafe', 0, false, 'copy-inert')));

    strictEqual(safe(known), 1);
    strictEqual(safe(normalValue({ ...known, nativeTag: '' })), 1);
    strictEqual(safe(values.retire(known)), 0);
    strictEqual(safe(unknownValue), 0);
    strictEqual(safe(values.joined([values.restrict(known, gate), values.restrict(unknownValue, decisions.not(gate))])), gate);
    strictEqual(safe(values.joined([known, unknownValue])), 0);
});

test('descendant copy publications share bounded lifetime records across alias width and copy depth', () => {
    [[8, 8], [8, 64], [64, 8], [64, 64]].forEach(([width = 0, depth = 0] = []) => {
        const source = 'const run=()=>{const box={item:{child:{name:42}}};'
            + Array.from({ length: width }, (unused, index) => `const alias${index}=box.item.child;`).join('')
            + Array.from({ length: depth }, (unused, index) => `const copy${index}={...box.item};`).join('')
            + Array.from({ length: width }, (unused, index) => `observe(alias${index}.name);`).join('') + '};';
        const index = indexModules({ program: parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true }) });
        const { contextFor = false, references = [], sourceMembers = [], sourcePatterns = [], parents = new WeakMap() } = index;

        strictEqual(typeof contextFor, 'function');
        const patterns = acquirePatterns({ ...index, destructurings: sourcePatterns });
        const copies = acquireMemberCopies({ ...index, memberAccesses: sourceMembers, selectionFor: binding => patterns.forBinding(binding) }, contextFor);

        sourceMembers.forEach(({ node = {}, parent: { type = '' } = {} } = {}) => {
            if (type === 'SpreadElement') copies.register(node, parents.get(parents.get(node)));
        });
        copies.finish();
        const proofs = references.flatMap(({ node = {} } = {}) => copies.forNode(node));
        const retained = new Map();
        const inspect = (proof) => {
            if (!proof || retained.has(proof)) return;

            const { prior = false } = proof;

            put(retained, proof, true);
            inspect(prior);
        };
        const bound = 2 * Math.ceil(Math.log2(width + depth + 8));

        proofs.forEach(({ lifetime = false } = {}) => inspect(lifetime));
        ok(proofs.some(({ deep = false } = {}) => deep));
        ok(retained.size <= depth * bound);
        references.forEach(({ node = {} } = {}) => ok(copies.forNode(node).length <= bound + 1));
    });
});
