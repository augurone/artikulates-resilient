import { deepStrictEqual, strictEqual, ok, throws } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { parse } from 'espree';

import { createOwner, familyEvidence, record, readField, readFamily, producer, reference, replaceEvidence, unresolved, isCurrent, request, field, fromESTree,
    inspect, all } from 'eslint-plugin-resilient/agreement';

import { counter } from './support/work.js';

// Family, presence and optional-field judgments share immutable producer projections, revisions and independent consumer requirements.

{
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
}

{
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
}

{
    const evidence = source => fromESTree(parse(`(${source})`, { ecmaVersion: 'latest' }).body.at(0).expression);
    const own = source => createOwner({ evidence: evidence(source) });
    const optional = field({ name: 'title', required: 'string', optional: true });
    const required = field({ name: 'title', required: 'string' });

    test('optional presence changes the obligation without creating producer evidence', () => {
        const owner = own('{}');
        const absent = request({ owner, required: optional });
        const mandatory = request({ owner, required });
        const { status: absentStatus = '' } = absent;
        const { status: mandatoryStatus = '' } = mandatory;

        strictEqual(absentStatus, 'agreement');
        strictEqual(mandatoryStatus, 'contradiction');
        strictEqual(absent.facts.at(1), mandatory.facts.at(1));
        deepStrictEqual(absent.facts.at(1).presence, ['absent']);
        strictEqual(absent.facts.length, 2);
        strictEqual(request({ owner: own('{ title: null }'), required: optional }).status, 'contradiction');
        strictEqual(request({ owner: own('{ title: external }'), required: optional }).status, 'unknown');
        strictEqual(request({ owner: own('{ ...external }'), required: optional }).status, 'unknown');
        strictEqual(request({ owner: own('[]'), required: optional }).status, 'contradiction');
        // eslint-disable-next-line resilient/no-null-assignment -- The option validator must reject supplied null rather than coerce it into an optional-presence flag.
        [0, '', 'true', {}, null].forEach(value => throws(() => field({ name: 'title', required: 'string', optional: value }), /boolean/));
    });

    test('optional fields preserve known contradiction beside unknown through shared requirements and cycles', () => {
        const good = own('{}');
        const bad = own('{ title: 42 }');
        const unknown = createOwner({ evidence: unresolved() });
        const cycle = createOwner({ evidence: reference({ owner: good }) });

        replaceEvidence({ owner: cycle, evidence: producer({ owners: [cycle, good, bad, unknown] }) });
        const repeated = Array.from({ length: 12 }).reduce(child => all({ requirements: [child, child] }), optional);
        const work = counter();
        const judgment = request({ owner: cycle, required: repeated, onWork: event => work.onWork(event) });
        const { status = '' } = judgment;

        strictEqual(status, 'contradiction');
        strictEqual(work.get('requirement-expansion'), 12);
        replaceEvidence({ owner: bad, evidence: evidence('{ title: "ready" }') });
        strictEqual(isCurrent(judgment), false);
        strictEqual(request({ owner: cycle, required: repeated }).status, 'unknown');
        strictEqual(inspect(judgment).historicalOutcome, 'contradiction');
    });

    test('optional absence retains revisions and historical selection while unrelated facts stay current', () => {
        const root = own('{}');
        const alias = createOwner({ evidence: reference({ owner: root }) });
        const unrelated = own('{ title: "other" }');
        const first = request({ owner: alias, required: optional });
        const other = request({ owner: unrelated, required: optional });
        const historical = first.facts.at(1);

        replaceEvidence({ owner: root, evidence: evidence('{ title: 42 }') });
        strictEqual(isCurrent(first), false);
        strictEqual(isCurrent(other), true);
        const { presence = [] } = historical;

        deepStrictEqual(presence, ['absent']);
        strictEqual(request({ owner: alias, required: optional }).status, 'contradiction');
        replaceEvidence({ owner: root, evidence: evidence('{}') });
        strictEqual(isCurrent(first), false);
        strictEqual(request({ owner: alias, required: optional }).status, 'agreement');
    });

    test('optional fields preserve every mandatory contribution across all small shared joins, cycles and revisions', () => {
        const states = [
            { source: '{}', optional: 'agreement', required: 'contradiction' },
            { source: '{ title: "ready" }', optional: 'agreement', required: 'agreement' },
            { source: '{ title: 42 }', optional: 'contradiction', required: 'contradiction' },
            { source: '{ ...external }', optional: 'unknown', required: 'unknown' },
            { source: '[]', optional: 'contradiction', required: 'contradiction' }
        ];
        const combined = (statuses) => {
            if (statuses.includes('contradiction')) return 'contradiction';

            return statuses.includes('unknown') ? 'unknown' : 'agreement';
        };

        states.forEach(first => states.forEach(second => states.forEach((third) => {
            const entries = [first, second, third];
            const owners = entries.map(({ source = '' } = {}) => own(source));
            const shared = createOwner({ evidence: producer({ owners: owners.slice(0, 2) }) });
            const roots = [
                createOwner({ evidence: producer({ owners: [shared, owners.at(2), shared] }) }),
                createOwner({ evidence: producer({ owners: [owners.at(2), shared, shared] }) })
            ];
            const cycle = createOwner({ evidence: unresolved() });

            replaceEvidence({ owner: cycle, evidence: producer({ owners: [cycle, ...roots] }) });
            const questions = [
                ...roots.flatMap(owner => [{ owner, required: optional, key: 'optional' }, { owner, required, key: 'required' }]),
                { owner: cycle, required: optional, key: 'optional', cyclic: true }
            ];
            const judgments = questions.map(({ owner = false, required: requirement = false, key = '', cyclic = false } = {}) => {
                const expected = combined([...entries.map(({ [key]: status = '' } = {}) => status), ...(cyclic ? ['unknown'] : [])]);
                const judgment = request({ owner, required: requirement });
                const { status = '' } = judgment;

                strictEqual(status, expected);
                strictEqual(request({ owner, required: requirement }).status, expected);

                return { judgment, expected };
            });

            replaceEvidence({ owner: owners.at(0), evidence: evidence('{}') });
            questions.forEach(({ owner = false, required: requirement = false, key = '', cyclic = false } = {}, index) => {
                const { judgment: prior = false, expected: historical = '' } = judgments.at(index);
                const expected = combined([... [states.at(0), second, third].map(({ [key]: status = '' } = {}) => status), ...(cyclic ? ['unknown'] : [])]);

                strictEqual(isCurrent(prior), false);
                strictEqual(inspect(prior).historicalOutcome, historical);
                strictEqual(request({ owner, required: requirement }).status, expected);
            });
        })));
    });
}
