import { deepStrictEqual, strictEqual, ok, throws } from 'node:assert/strict';
import test from 'node:test';

import { createOwner, fromESTree, unresolved, producer, reference, readFamily, request, replaceEvidence, isCurrent, inspect } from 'eslint-plugin-resilient/agreement';

import { counter } from './support/work.js';

const literal = value => fromESTree({ type: 'Literal', value });

test('a neutral family read shares producer facts without a consumer judgment', () => {
    const owner = createOwner({ evidence: literal('ready') });
    const work = counter();
    const fact = readFamily({ owner, onWork: event => work.onWork(event) });
    const { families = [], state = '' } = fact;

    deepStrictEqual(families, ['string']);
    strictEqual(state, 'known');
    ok(Object.isFrozen(fact));
    ok(Object.isFrozen(families));
    strictEqual(work.get('establishment'), 1);
    strictEqual(work.get('family-read'), 1);
    strictEqual(work.get('judgment'), 0);
    strictEqual(isCurrent(fact), false, 'A producer fact is not a registered consumer judgment');
    throws(() => inspect(fact), /registered judgment/);

    ['array', 'string', 'object'].forEach((required) => {
        const judgment = request({ owner, required });
        const { status = '', fact: observed = {} } = judgment;

        strictEqual(observed, fact);
        strictEqual(status, required === 'string' ? 'agreement' : 'contradiction');
        strictEqual(readFamily({ owner, onWork: event => work.onWork(event) }), fact);
    });
    strictEqual(work.get('establishment'), 1);
    strictEqual(work.get('judgment'), 0);
});

test('family reads preserve contradictions beside unknown and historical facts across change', () => {
    const text = createOwner({ evidence: literal('ready') });
    const number = createOwner({ evidence: literal(42) });
    const unknown = createOwner({ evidence: unresolved() });
    const owner = createOwner({ evidence: producer({ owners: [text, number, unknown] }) });
    const alias = createOwner({ evidence: reference({ owner }) });
    const first = readFamily({ owner: alias });
    const { state = '', families = [], incomplete = false } = first;

    strictEqual(state, 'contradictory');
    deepStrictEqual(families, ['string', 'number']);
    strictEqual(incomplete, true);
    replaceEvidence({ owner: number, evidence: literal('changed') });
    const { state: nextState = '', families: nextFamilies = [] } = readFamily({ owner: alias });

    strictEqual(nextState, 'unknown');
    deepStrictEqual(nextFamilies, ['string']);
    deepStrictEqual(families, ['string', 'number']);
    strictEqual(state, 'contradictory');
});

test('family reads use the existing cycle and revision mechanism', () => {
    const first = createOwner({ evidence: unresolved() });
    const second = createOwner({ evidence: reference({ owner: first }) });
    const text = createOwner({ evidence: literal('ready') });

    replaceEvidence({ owner: first, evidence: producer({ owners: [second, text] }) });
    const { state: cyclicState = '', families: cyclicFamilies = [] } = readFamily({ owner: second });

    strictEqual(cyclicState, 'unknown');
    deepStrictEqual(cyclicFamilies, ['string']);
    replaceEvidence({ owner: first, evidence: literal(42) });
    const { state: repairedState = '', families: repairedFamilies = [] } = readFamily({ owner: second });

    strictEqual(repairedState, 'known');
    deepStrictEqual(repairedFamilies, ['number']);
    strictEqual(cyclicState, 'unknown');
});

test('family-read observers cannot turn failure or stale evidence into a successful read', () => {
    const owner = createOwner({ evidence: literal('ready') });
    const failure = new Error('observation failed');

    throws(() => readFamily({ owner, onWork: () => { throw failure; } }), error => error === failure);
    deepStrictEqual(readFamily({ owner }).families, ['string']);
    throws(() => readFamily({ owner, onWork: ({ kind = '' } = {}) => {
        if (kind === 'family-read') replaceEvidence({ owner, evidence: literal(42) });
    } }), /Source changed during family read/);
    const current = readFamily({ owner });
    const { families = [] } = current;

    deepStrictEqual(families, ['number']);
    strictEqual(readFamily({ owner, onWork: () => strictEqual(readFamily({ owner }), current) }), current);
    throws(() => readFamily(), /registered source owner/);
    throws(() => readFamily({ owner: {} }), /registered source owner/);
});
