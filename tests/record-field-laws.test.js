import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import test from 'node:test';

import { all, createOwner, familyEvidence, field, producer, readFamily, readField, record, reference, replaceEvidence, request, unresolved } from 'eslint-plugin-resilient/agreement';

import { factData } from '../analysis/agreement/knowledge.js';
import { sourceOf } from '../analysis/agreement/source-owners.js';
import { append, put } from './support/collections.js';
import { counter } from './support/work.js';

const own = evidence => createOwner({ evidence });
const normalize = (values) => {
    const result = [...new Set(values.flat())];

    // An unresolved field already includes an unresolved present value. Keep
    // every independently known family and absence beside that uncertainty.
    return result.filter(value => value !== 'present' || !result.includes('unknown')).toSorted();
};
const overlay = ({ source = [], base = [], open = false } = {}) => normalize(source.flatMap((value) => {
    if (value === 'absent') return base;

    if (value === 'unknown') return [base.every(item => !['absent', 'unknown'].includes(item)) ? 'present' : 'unknown'];

    return [value];
}).map(value => value === 'absent' && open ? 'unknown' : value));

// A small flat model deliberately trades efficiency for independence. It has no
// source facets, contribution graph, SCC traversal, cache or presence bitmask.
const expectedFields = (plans, revision) => {
    const initial = plans.map(() => ['unknown']);
    const step = answers => plans.map(({ kind = '', inputs = [], source = '', base = '', open = false, explicit = false, excluded = false } = {}) => {
        const read = input => typeof input === 'number' ? answers.at(input) : [revision && input === 'number' ? 'string' : input];

        if (kind === 'producer') return normalize(inputs.map(read));

        if (kind === 'reference') return read(source);

        if (explicit) return ['string'];

        return excluded ? ['absent'] : overlay({ source: read(source), base: read(base), open });
    });
    const result = Array.from({ length: plans.length * 8 }).reduce(step, initial);

    deepStrictEqual(step(result), result, 'The finite reference model must reach a fixed point');

    return result;
};
const word = (seed) => {
    const mixed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
    const repeated = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);

    return (repeated ^ (repeated >>> 16)) >>> 0;
};
const plansFor = seed => Array.from({ length: 3 }, (_, position) => {
    const options = ['absent', 'unknown', 'number', 'string', 0, 1, 2];
    const select = offset => options.at(word(seed * 17 + position * 5 + offset) % options.length);

    return word(seed * 13 + position) % 2 ? { kind: 'producer', inputs: [select(1), select(2)] }
        : { kind: 'record', source: select(1), base: select(2), open: word(seed * 19 + position) % 3 === 0 };
});
const expectation = (values, required) => {
    if (values.includes('absent') || values.some(value => ['number', 'string'].includes(value) && required !== 'presence' && value !== required)) return 'contradiction';

    return values.includes('unknown') || (required !== 'presence' && values.includes('present')) ? 'unknown' : 'agreement';
};

const verifyPlans = (plans, expanded = false) => {
    const expected = [false, true].map(revision => expectedFields(plans, revision));

    [false, true].forEach((reverse) => {
        const number = own(familyEvidence({ name: 'number' }));
        const string = own(familyEvidence({ name: 'string' }));
        const supplied = own(record({ fields: [{ name: 'value', owner: number }] }));
        const constants = new Map([['absent', own(record())], ['unknown', own(unresolved())],
            ['number', supplied], ['string', own(record({ fields: [{ name: 'value', owner: string }] }))]]);
        const owners = plans.map(() => own(unresolved()));
        const sourceFor = input => typeof input === 'number' ? owners.at(input) : constants.get(input);

        plans.forEach(({ kind = '', inputs = [], source = '', base = '', open = false, explicit = false, excluded = false, retire = false } = {}, index) => {
            const evidence = () => {
                if (kind === 'producer') return producer({ owners: inputs.map(sourceFor) });

                if (kind === 'reference') return reference({ owner: sourceFor(source) });

                return record({ source: sourceFor(source), base: sourceFor(base), open, retire,
                    fields: explicit ? [{ name: 'value', owner: string }] : [], excluded: excluded ? ['value'] : [] });
            };

            replaceEvidence({ owner: owners.at(index), evidence: evidence() });
        });
        const indices = plans.map((unused, index) => index);
        const order = reverse ? indices.toReversed() : indices;

        [false, true].forEach((revision) => {
            if (revision) replaceEvidence({ owner: supplied, evidence: record({ fields: [{ name: 'value', owner: string }] }) });

            order.forEach((index) => {
                const owner = owners.at(index);
                const values = expected.at(Number(revision)).at(index);
                const message = JSON.stringify({ plans, index, reverse, revision });
                const { cases = [] } = readField({ owner, name: 'value' });
                const observed = normalize(cases.map(({ state = '', owner = false } = {}) => {
                    if (state !== 'present') return state;

                    const { families = [] } = readFamily({ owner });

                    return families.at(0) || 'present';
                }));

                // Known absence plus unknown present already spans unresolved
                // presence. Keep the independently grounded absence and families.
                const canonical = values => normalize(values.map(value => expanded && value === 'present' && values.includes('absent') ? 'unknown' : value));

                deepStrictEqual(canonical(observed), canonical(values), message);
                ['presence', 'number', 'string'].forEach((kind) => {
                    const required = field({ name: 'value', required: kind === 'presence' ? all() : kind });

                    strictEqual(request({ owner, required }).status, expectation(values, kind), message);
                });
                deepStrictEqual(readField({ owner, name: 'value' }).cases, cases, message);
            });
        });
    });
};

test('3000 finite record graphs preserve flat field laws across query order and revisions', () => {
    Array.from({ length: 3000 }, (_, seed) => plansFor(seed)).forEach(plans => verifyPlans(plans));
});

[4, 6, 8].forEach(width => test(`4000 composed record graphs retain field laws with ${width} members`, () => {
    Array.from({ length: 4000 }, (unused, seed) => seed).forEach((seed) => {
        const options = ['absent', 'unknown', 'number', 'string', ...Array.from({ length: width }, (unused, index) => index)];
        const plans = Array.from({ length: width }, (unused, position) => {
            const select = offset => options.at(word(seed * 31 + position * 11 + offset) % options.length);
            const kind = word(seed * 13 + position * 7) % 4;

            if (kind === 0) return { kind: 'producer', inputs: Array.from({ length: 1 + word(seed + position) % 4 }, (unused, index) => select(index + 1)) };

            if (kind === 1) return { kind: 'reference', source: select(1) };

            return { kind: 'record', source: select(1), base: select(2), open: word(seed * 19 + position) % 3 === 0,
                explicit: word(seed * 23 + position) % 6 === 0, excluded: word(seed * 29 + position) % 6 === 0, retire: word(seed * 37 + position) % 2 === 0 };
        });

        verifyPlans(plans, true);
    });
}));

test('open retired field graphs retain linear storage across independent width and depth', () => {
    [[32, 32], [32, 128], [128, 32], [128, 128]].forEach(([width = 0, depth = 0] = []) => {
        const number = own(familyEvidence({ name: 'number' }));
        const absent = own(record());
        const alternatives = Array.from({ length: width }, () => own(record({ fields: [{ name: 'value', owner: number }] })));
        const joined = own(producer({ owners: [...alternatives, absent, own(unresolved())] }));
        const owners = [joined];
        const last = Array.from({ length: depth }).reduce((source) => {
            const choice = own(producer({ owners: [source, absent] }));
            const copied = own(record({ source: choice, open: true, retire: true }));

            append(owners, choice, copied);

            return copied;
        }, joined);
        const work = counter();
        const { onWork } = work;

        strictEqual(request({ owner: last, required: field({ name: 'value', required: 'string' }), onWork }).status, 'contradiction');
        const retained = new Map();
        const cases = new Map();
        const visit = (data) => {
            if (retained.has(data)) return;

            put(retained, data, true);
            const { cases: entries = [], inputs = [] } = data;

            entries.forEach(entry => put(cases, entry, true));
            inputs.forEach(visit);
        };

        owners.forEach((owner) => {
            const { facts = new Map() } = sourceOf(owner);

            facts.forEach(fact => visit(factData(fact)));
        });
        ok(retained.size < (width + depth) * 12, `${width}/${depth}: ${retained.size} retained contributions`);
        ok(cases.size < (width + depth) * 4, `${width}/${depth}: ${cases.size} retained cases`);
        ok(work.get('field-case') < (width + depth) * 12, JSON.stringify(work.read()));
    });
});
