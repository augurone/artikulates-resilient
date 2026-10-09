import { strictEqual, deepStrictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { createOwner, fromESTree, reference, producer, request, replaceEvidence, replaceAll, isCurrent, inspect } from 'eslint-plugin-resilient/agreement';

import { counter } from './support/work.js';

const text = fromESTree({ type: 'Literal', value: 'text' });
const number = fromESTree({ type: 'Literal', value: 42 });
const alias = owner => createOwner({ evidence: reference({ owner }) });

test('unrelated updates leave deep cached dependencies untouched', () => {
    const root = createOwner({ evidence: text });
    const other = createOwner({ evidence: text });
    const tip = Array.from({ length: 1000 }).reduce(alias, root);
    const first = request({ owner: tip, required: 'string' });
    const { fact = false } = first;
    const updates = counter();
    const reads = counter();

    Array.from({ length: 10 }).forEach(() => {
        replaceEvidence({ owner: other, evidence: number, onWork: event => updates.onWork(event) });
        strictEqual(request({ owner: tip, required: 'string', onWork: event => reads.onWork(event) }).fact, fact);
    });
    strictEqual(isCurrent(first), true);
    strictEqual(updates.get('invalidation'), 0);
    strictEqual(updates.get('invalidation-edge'), 0);
    strictEqual(reads.get('dependency-validation'), 0);
    strictEqual(reads.get('validity-check'), 10);
    strictEqual(reads.get('establishment'), 0);
});

test('a changed branch invalidates its descendants while a shared-root sibling stays cached', () => {
    const root = createOwner({ evidence: text });
    const left = alias(root);
    const leftTip = alias(left);
    const right = alias(root);
    const oldLeft = request({ owner: leftTip, required: 'string' });
    const oldRight = request({ owner: right, required: 'string' });
    const { fact: rightFact = false } = oldRight;
    const updates = counter();
    const reads = counter();

    replaceEvidence({ owner: left, evidence: number, onWork: event => updates.onWork(event) });
    strictEqual(updates.get('invalidation'), 2);
    strictEqual(isCurrent(oldLeft), false);
    strictEqual(isCurrent(oldRight), true);
    strictEqual(request({ owner: right, required: 'string', onWork: event => reads.onWork(event) }).fact, rightFact);
    strictEqual(reads.get('dependency-validation'), 0);
    strictEqual(request({ owner: leftTip, required: 'number' }).status, 'agreement');
});

test('batch invalidation visits each live diamond fact once before delivering observers', () => {
    const a = createOwner({ evidence: text });
    const b = createOwner({ evidence: text });
    const shared = createOwner({ evidence: producer({ owners: [a, b] }) });
    const left = alias(shared);
    const right = alias(shared);
    const tip = createOwner({ evidence: producer({ owners: [left, right] }) });
    const first = request({ owner: tip, required: 'string' });
    const updates = counter();

    replaceAll({ updates: [{ owner: a, evidence: number }, { owner: b, evidence: number }], onWork: (event) => {
        updates.onWork(event);
        strictEqual(isCurrent(first), false);
        strictEqual(request({ owner: tip, required: 'number' }).status, 'agreement');
    } });
    strictEqual(updates.get('invalidation'), 4);
    // Invalidating the tip detaches its other diamond edge before it is queued.
    strictEqual(updates.get('invalidation-edge'), 5);
    throws(() => Reflect.get(first, 'status'), /Stale judgment/);
    strictEqual(inspect(first).historicalOutcome, 'agreement');
});

test('dirty dependencies detach so repeated writes do not traverse them again', () => {
    const root = createOwner({ evidence: text });
    const tip = alias(alias(root));
    const first = request({ owner: tip, required: 'string' });

    replaceEvidence({ owner: root, evidence: number });

    const updates = counter();

    Array.from({ length: 100 }).forEach(() => replaceEvidence({ owner: root, evidence: text, onWork: event => updates.onWork(event) }));
    deepStrictEqual(updates.read(), {});
    strictEqual(isCurrent(first), false);
    strictEqual(request({ owner: tip, required: 'string' }).status, 'agreement');
    strictEqual(isCurrent(first), false);
});

test('rewiring a source detaches former dependencies without reviving historical facts', () => {
    const oldRoot = createOwner({ evidence: text });
    const newRoot = createOwner({ evidence: number });
    const middle = alias(oldRoot);
    const tip = alias(middle);
    const old = request({ owner: tip, required: 'string' });

    replaceEvidence({ owner: middle, evidence: reference({ owner: newRoot }) });

    const current = request({ owner: tip, required: 'number' });
    const { fact = false } = current;
    const obsolete = counter();

    replaceEvidence({ owner: oldRoot, evidence: number, onWork: event => obsolete.onWork(event) });
    strictEqual(obsolete.get('invalidation'), 0);
    strictEqual(isCurrent(current), true);
    strictEqual(isCurrent(old), false);
    strictEqual(request({ owner: tip, required: 'number' }).fact, fact);

    const active = counter();

    replaceEvidence({ owner: newRoot, evidence: text, onWork: event => active.onWork(event) });
    strictEqual(active.get('invalidation'), 2);
    strictEqual(isCurrent(current), false);
});

test('every cycle anchor invalidates the shared certificate and retained member judgments', () => {
    const a = createOwner({ evidence: text });
    const b = alias(a);

    replaceEvidence({ owner: a, evidence: reference({ owner: b }) });

    const first = request({ owner: a, required: 'string' });
    const second = request({ owner: b, required: 'string' });
    const updates = counter();

    replaceEvidence({ owner: b, evidence: number, onWork: event => updates.onWork(event) });
    strictEqual(updates.get('invalidation'), 3);
    strictEqual(isCurrent(first), false);
    strictEqual(isCurrent(second), false);
    strictEqual(request({ owner: a, required: 'number' }).status, 'agreement');
});

test('failed and empty batches leave cached validity and observer delivery untouched', () => {
    const root = createOwner({ evidence: text });
    const tip = alias(root);
    const first = request({ owner: tip, required: 'string' });
    const updates = counter();
    const onWork = event => updates.onWork(event);

    throws(() => replaceAll({ updates: [{ owner: root, evidence: number }, {}], onWork }), TypeError);
    throws(() => replaceAll({ updates: [{ owner: root, evidence: number }, { owner: root, evidence: text }], onWork }), TypeError);
    deepStrictEqual(replaceAll({ onWork }), []);
    strictEqual(isCurrent(first), true);
    deepStrictEqual(updates.read(), {});
});

test('an update observer failure propagates after the atomic revision has committed', () => {
    const root = createOwner({ evidence: text });
    const tip = alias(root);
    const old = request({ owner: tip, required: 'string' });
    const failure = new Error('update observer failed');

    throws(() => replaceEvidence({ owner: root, evidence: number, onWork: () => { throw failure; } }), error => error === failure);
    strictEqual(isCurrent(old), false);
    strictEqual(request({ owner: tip, required: 'number' }).status, 'agreement');
});
