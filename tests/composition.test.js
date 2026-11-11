import { deepStrictEqual, notStrictEqual, ok, strictEqual } from 'node:assert/strict';
import test from 'node:test';

import { parse } from 'espree';

import { all, createOwner, field, fromESTree, isCurrent, producer, reference, replaceEvidence, request } from 'eslint-plugin-resilient/agreement';

import { counter } from './support/work.js';

const evidence = source => fromESTree(parse(`(${source})`, { ecmaVersion: 'latest' }).body.at(0).expression);
const own = source => createOwner({ evidence: evidence(source) });
const alias = owner => createOwner({ evidence: reference({ owner }) });
const joined = owners => createOwner({ evidence: producer({ owners }) });
const presence = field({ name: 'x', required: all() });
const selectedField = ({ facts = [] } = {}) => facts.find(({ facet = '' } = {}) => facet === 'field:x');

test('request-local field sharing keeps child requirements and absence policies distinct', () => {
    const owner = joined([own('{ x: "value" }'), own('{}')]);
    const optional = field({ name: 'x', required: 'string', optional: true });
    const duplicate = field({ name: 'x', required: 'string', optional: true });
    const mandatory = field({ name: 'x', required: 'string' });
    const wrongValue = field({ name: 'x', required: 'number', optional: true });
    const work = counter();

    strictEqual(request({ owner, required: all({ requirements: [optional, duplicate] }), onWork: event => work.onWork(event) }).status, 'agreement');
    strictEqual(work.get('field-contribution'), 3);
    strictEqual(work.get('field-case'), 2);
    [mandatory, wrongValue].forEach((other) => {
        [[optional, other], [other, optional]].forEach(requirements => strictEqual(request({ owner, required: all({ requirements }) }).status, 'contradiction'));
    });
});

test('shared requirements are evaluated once per owner and requirement within a request', () => {
    const root = own('"value"');
    const owner = alias(root);
    const required = Array.from({ length: 12 }).reduce(child => all({ requirements: [child, child] }), 'string');
    const work = counter();

    request({ owner, required: 'string' });

    const first = request({ owner, required, onWork: event => work.onWork(event) });
    const { status = '', facts = [] } = first;

    strictEqual(status, 'agreement');
    strictEqual(facts.length, 1);
    strictEqual(work.get('validity-check'), 1);
    strictEqual(work.get('requirement-expansion'), 12);
    strictEqual(work.get('establishment'), 0);
    replaceEvidence({ owner: root, evidence: evidence('42') });
    strictEqual(isCurrent(first), false);
    strictEqual(request({ owner, required }).status, 'contradiction');
});

test('the same child requirement on different owners preserves contradiction beside unknown', () => {
    const required = field({ name: 'x', required: 'string' });
    const parts = [own('{ x: "value" }'), own('{ x: external }'), own('{ x: 42 }')];

    [parts, parts.toReversed()].forEach((owners) => {
        strictEqual(request({ owner: joined(owners), required: all({ requirements: [required, required] }) }).status, 'contradiction');
    });
});

test('wide field evidence shares its immutable summary through aliases and retains separate premises', () => {
    const leaves = Array.from({ length: 64 }, () => own('{ x: 1 }'));
    const root = joined(leaves);
    const owners = Array.from({ length: 64 }).reduce(chain => [...chain, alias(chain.at(-1))], [root]);
    const tip = owners.at(-1);
    const work = counter();
    const first = request({ owner: tip, required: presence, onWork: event => work.onWork(event) });
    const { presence: summary = [] } = selectedField(first);
    const { status = '' } = first;
    const judgments = owners.map(owner => request({ owner, required: presence, onWork: event => work.onWork(event) }));

    strictEqual(status, 'agreement');
    strictEqual(summary.length, 64);
    ok(Object.isFrozen(summary));
    judgments.forEach(judgment => strictEqual(selectedField(judgment).presence, summary));
    notStrictEqual(selectedField(judgments.at(0)), selectedField(first));
    strictEqual(work.get('field-contribution'), 65 * (owners.length + 1));
    strictEqual(work.get('field-case'), 64 * (owners.length + 1));

    const untouched = request({ owner: leaves.at(1), required: presence });

    replaceEvidence({ owner: leaves.at(0), evidence: evidence('{}') });
    judgments.forEach(judgment => strictEqual(isCurrent(judgment), false));
    strictEqual(isCurrent(untouched), true);
    strictEqual(summary.length, 64);
    strictEqual(request({ owner: tip, required: presence }).status, 'contradiction');
});

test('successive field joins visit contributions once without flattening intermediate facts', () => {
    const leaves = Array.from({ length: 64 }, () => own('{ x: 1 }'));
    const owner = leaves.slice(1).reduce((prior, next) => joined([prior, next]), leaves.at(0));
    const required = field({ name: 'x', required: 'number' });
    const work = counter();
    const first = request({ owner, required, onWork: event => work.onWork(event) });
    const { status = '' } = first;
    const before = work.get('field-contribution');

    strictEqual(status, 'agreement');
    strictEqual(before, 127);
    strictEqual(work.get('field-case'), 64);
    strictEqual(selectedField(first).presence.length, 64);
    strictEqual(request({ owner, required, onWork: event => work.onWork(event) }).status, 'agreement');
    strictEqual(work.get('field-contribution'), before * 2);
    strictEqual(work.get('field-case'), 128);
});

test('field diamonds and cycles preserve unique sources, unknowns, absence and historical evidence', () => {
    const leaf = own('{ x: 1 }');
    const shared = Array.from({ length: 12 }).reduce(prior => joined([alias(prior), alias(prior)]), leaf);
    const first = request({ owner: shared, required: presence });

    deepStrictEqual(selectedField(first).presence, ['present']);

    const cycle = alias(shared);

    replaceEvidence({ owner: cycle, evidence: producer({ owners: [cycle, shared, own('{}')] }) });

    const mixed = request({ owner: cycle, required: presence });
    const { status = '' } = mixed;

    strictEqual(status, 'contradiction');
    deepStrictEqual(new Set(selectedField(mixed).presence), new Set(['present', 'absent', 'unknown']));
    replaceEvidence({ owner: cycle, evidence: reference({ owner: shared }) });
    strictEqual(isCurrent(mixed), false);
    strictEqual(isCurrent(first), true);
    strictEqual(request({ owner: cycle, required: presence }).status, 'agreement');
});

test('an undemanded intermediate summary remains historical when first read after replacement', () => {
    const absent = own('{}');
    const middle = joined([absent, own('{ x: 1 }')]);
    const tip = joined([middle, own('{ x: 2 }')]);
    const first = request({ owner: tip, required: presence });
    const { premises = [] } = selectedField(first);
    const historical = premises.find(({ owner = false } = {}) => owner === middle);

    replaceEvidence({ owner: absent, evidence: evidence('{ x: 3 }') });

    const { presence: prior = [] } = historical;
    const { presence: current = [] } = selectedField(request({ owner: middle, required: presence }));

    strictEqual(isCurrent(first), false);
    deepStrictEqual(prior, ['absent', 'present']);
    deepStrictEqual(current, ['present', 'present']);
    ok(Object.isFrozen(prior));
    notStrictEqual(prior, current);
});

test('shared producer composition preserves every combination of known, missing and unresolved field evidence', () => {
    const fixtures = [
        { source: '{ x: "value" }', present: 'agreement', text: 'agreement' },
        { source: '{}', present: 'contradiction', text: 'contradiction' },
        { source: '{ x: 42 }', present: 'agreement', text: 'contradiction' },
        { source: '{ x: external }', present: 'agreement', text: 'unknown' },
        { source: 'external', present: 'unknown', text: 'unknown' }
    ];
    const text = field({ name: 'x', required: 'string' });
    const expected = (outcomes) => {
        if (outcomes.includes('contradiction')) return 'contradiction';

        return outcomes.includes('unknown') ? 'unknown' : 'agreement';
    };

    fixtures.forEach(a => fixtures.forEach(b => fixtures.forEach((c) => {
        const entries = [a, b, c];
        const [first = false, second = false, third = false] = entries.map(({ source = '' } = {}) => own(source));
        const root = joined([joined([first, second]), joined([alias(second), third]), alias(first)]);

        strictEqual(request({ owner: root, required: presence }).status, expected(entries.map(({ present = '' } = {}) => present)));
        strictEqual(request({ owner: root, required: text }).status, expected(entries.map(({ text: outcome = '' } = {}) => outcome)));
    })));
});
