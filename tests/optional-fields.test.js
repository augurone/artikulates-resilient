import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { parse } from 'espree';

import { all, createOwner, field, fromESTree, inspect, isCurrent, producer, reference, replaceEvidence, request, unresolved } from 'eslint-plugin-resilient/agreement';

import { counter } from './support/work.js';

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
