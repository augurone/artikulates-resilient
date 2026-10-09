import { deepStrictEqual, notStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import {
    all, createContext, createOwner, field, fromESTree, inspect, isCurrent,
    producer, reference, replaceAll, replaceEvidence, request, unresolved
} from 'eslint-plugin-resilient/agreement';

import { counter } from './support/work.js';

const statusOf = ({ status = '' } = {}) => status;
const factsOf = ({ facts = [] } = {}) => facts;
const factOf = ({ fact = false } = {}) => fact;
const expectedOutcome = (entries) => {
    if (entries.some(({ status = '' } = {}) => status === 'contradiction')) return 'contradiction';

    return entries.some(({ status = '' } = {}) => status === 'unknown') ? 'unknown' : 'agreement';
};

const text = fromESTree({ type: 'Literal', value: 'text' });
const number = fromESTree({ type: 'Literal', value: 42 });
const own = evidence => createOwner({ evidence });
const join = requirements => all({ requirements });
const diamond = (required, depth) => Array.from({ length: depth }).reduce(prior => join([prior, prior]), required);
const record = (count) => {
    const context = createContext();
    const leaves = Array.from({ length: count }, (_, index) => context.define({ name: `v${index}`, evidence: text }));
    const properties = leaves.map((_, index) => ({ type: 'Property', computed: false, method: false, kind: 'init',
        key: { type: 'Identifier', name: `p${index}` }, value: { type: 'Identifier', name: `v${index}` } }));
    const owner = own(fromESTree({ type: 'ObjectExpression', properties }, { context }));
    const requirements = leaves.map((_, index) => field({ name: `p${index}`, required: 'string' }));

    return { owner, leaves, requirements };
};

test('shared obligations deduplicate within each request and retain consumer-owned facts', () => {
    const owner = own(text);
    const required = diamond('string', 128);
    const cold = counter();
    const first = request({ owner, required, consumer: 'first', onWork: event => cold.onWork(event) });
    const warm = counter();
    const second = request({ owner, required, consumer: 'second', onWork: event => warm.onWork(event) });
    const extension = counter();
    const next = request({ owner, required: join([required, required]), onWork: event => extension.onWork(event) });

    strictEqual(statusOf(first), 'agreement');
    strictEqual(statusOf(next), 'agreement');
    strictEqual(cold.get('requirement-expansion'), 128);
    strictEqual(extension.get('requirement-expansion'), 129);
    strictEqual(extension.get('establishment'), 0);
    deepStrictEqual(warm.read(), { 'requirement-expansion': 128, judgment: 1 });
    notStrictEqual(first, second);
    const { consumer: firstConsumer = '', required: firstRequired = false } = first;
    const { consumer: secondConsumer = '' } = second;

    strictEqual(firstConsumer, 'first');
    strictEqual(secondConsumer, 'second');
    strictEqual(firstRequired, required);
    strictEqual(factOf(first), factOf(second));
    notStrictEqual(factsOf(first), factsOf(second));
    deepStrictEqual(factsOf(first), factsOf(second));
});

test('wide and successive obligations reuse producer facts and preserve ordered history', () => {
    const { owner = false, leaves = [], requirements = [] } = record(64);
    const wide = join(requirements);
    const successive = requirements.slice(1).reduce((prior, next) => join([prior, next]), requirements.at(0));
    const cold = counter();
    const first = request({ owner, required: wide, onWork: event => cold.onWork(event) });
    const extension = counter();
    const second = request({ owner, required: successive, onWork: event => extension.onWork(event) });
    const parts = requirements.map(required => request({ owner, required }));
    const expected = [...new Set(parts.flatMap(({ facts = [] } = {}) => facts))];

    strictEqual(cold.get('requirement-expansion'), 1);
    strictEqual(extension.get('requirement-expansion'), 63);
    strictEqual(extension.get('establishment'), 0);
    strictEqual(factOf(first), expected.at(0));

    replaceEvidence({ owner: leaves.at(32), evidence: number });
    strictEqual(isCurrent(first), false);
    strictEqual(isCurrent(second), false);
    deepStrictEqual(factsOf(first), expected);
    deepStrictEqual(factsOf(second), expected);
    ok(Object.isFrozen(factsOf(first)));
    strictEqual(inspect(first).historicalOutcome, 'agreement');
    throws(() => Reflect.get(first, 'status'), /Stale judgment/);

    const rebuilt = counter();

    strictEqual(request({ owner, required: wide, onWork: event => rebuilt.onWork(event) }).status, 'contradiction');
    strictEqual(rebuilt.get('requirement-expansion'), 1);
    strictEqual(request({ owner, required: successive }).status, 'contradiction');
    parts.forEach((part, index) => strictEqual(isCurrent(part), index !== 32));
});

test('a shared child requirement keeps each owner mandatory beside unknown and conflict', () => {
    const child = diamond('string', 12);
    const fixtures = [
        { evidence: text, status: 'agreement' }, { evidence: number, status: 'contradiction' }, { evidence: unresolved(), status: 'unknown' }
    ];

    fixtures.forEach(a => fixtures.forEach(b => fixtures.forEach((c) => {
        const entries = [a, b, c];
        const owners = entries.map(({ evidence = false } = {}) => own(evidence));
        const expected = expectedOutcome(entries);
        const combined = own(producer({ owners }));
        const first = request({ owner: combined, required: child });

        owners.forEach((owner, index) => strictEqual(request({ owner, required: child }).status, entries.at(index).status));
        strictEqual(statusOf(first), expected);
        replaceAll({ updates: owners.map(owner => ({ owner, evidence: text })) });
        strictEqual(isCurrent(first), false);
        strictEqual(request({ owner: combined, required: child }).status, 'agreement');
        strictEqual(inspect(first).historicalOutcome, expected);
    })));
});

test('empty conjunctions stay current without source evidence or fabricated first facts', () => {
    const owner = own(unresolved());
    const required = diamond(all(), 32);
    const first = request({ owner, required });
    const updates = counter();

    replaceEvidence({ owner, evidence: number, onWork: event => updates.onWork(event) });
    strictEqual(statusOf(first), 'agreement');
    strictEqual(isCurrent(first), true);
    deepStrictEqual(factsOf(first), []);
    strictEqual(typeof Reflect.get(first, 'fact'), 'undefined');
    deepStrictEqual(updates.read(), {});
});

test('root family revisions change demanded children without retaining the old contradiction', () => {
    const owner = own(number);
    const required = diamond(field({ name: 'x', required: 'string' }), 16);
    const first = request({ owner, required });

    strictEqual(statusOf(first), 'contradiction');
    replaceEvidence({ owner, evidence: fromESTree({ type: 'ObjectExpression', properties: [] }) });

    const absent = request({ owner, required });

    strictEqual(statusOf(absent), 'contradiction');
    strictEqual(factsOf(absent).length, 2);
    replaceEvidence({ owner, evidence: unresolved() });
    strictEqual(request({ owner, required }).status, 'unknown');
    strictEqual(isCurrent(first), false);
    strictEqual(isCurrent(absent), false);
    strictEqual(factsOf(first).length, 1);
});

test('rewired obligation dependencies detach and retained history never revives', () => {
    const oldSource = own(text);
    const newSource = own(number);
    const owner = own(reference({ owner: oldSource }));
    const required = diamond('string', 32);
    const first = request({ owner, required });

    replaceEvidence({ owner, evidence: reference({ owner: newSource }) });

    const next = request({ owner, required });
    const unrelated = counter();

    replaceEvidence({ owner: oldSource, evidence: number, onWork: event => unrelated.onWork(event) });
    deepStrictEqual(unrelated.read(), {});
    strictEqual(statusOf(next), 'contradiction');
    strictEqual(isCurrent(first), false);
    replaceEvidence({ owner: newSource, evidence: text });
    strictEqual(isCurrent(next), false);
    strictEqual(request({ owner, required }).status, 'agreement');
    strictEqual(isCurrent(first), false);
});

test('each delivered work event may fail without poisoning producer evidence or retry', () => {
    const required = diamond('string', 8);
    const sample = counter();

    request({ owner: own(text), required, onWork: () => sample.increment('event') });
    Array.from({ length: sample.get('event') }, (_, stop) => stop).forEach((stop) => {
        const owner = own(text);
        const visits = counter();
        const failure = new Error(`observer ${stop}`);
        const retry = counter();

        throws(() => request({ owner, required, onWork: () => {
            const position = visits.get('event');

            visits.increment('event');

            if (position === stop) throw failure;
        } }), error => error === failure);
        strictEqual(request({ owner, required, onWork: event => retry.onWork(event) }).status, 'agreement');
        deepStrictEqual(retry.read(), { 'requirement-expansion': 8, judgment: 1 });
    });
});

test('reentrant requests reuse publication and revisions during delivery reject stale returns', () => {
    const owner = own(text);
    const required = diamond('string', 16);
    const observed = counter();
    const first = request({ owner, required, onWork: () => {
        strictEqual(request({ owner, required, onWork: event => observed.onWork(event) }).status, 'agreement');
    } });

    strictEqual(observed.get('establishment'), 0);
    ok(observed.get('requirement-expansion') > 0);
    throws(() => request({ owner, required, onWork: () => replaceEvidence({ owner, evidence: number }) }), /Source changed during request/);
    strictEqual(isCurrent(first), false);
    strictEqual(request({ owner, required }).status, 'contradiction');

    const dirty = counter();

    replaceEvidence({ owner, evidence: text });
    replaceEvidence({ owner, evidence: number, onWork: event => dirty.onWork(event) });
    deepStrictEqual(dirty.read(), {});
});
