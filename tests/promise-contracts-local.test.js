import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { readFamily } from '../analysis/agreement/facts.js';
import { createOwner, unresolved, familyEvidence, record } from '../analysis/agreement/source-owners.js';
import { createDecisions } from '../analysis/analyzer/decisions.js';
import { createOutcomes } from '../analysis/analyzer/outcomes.js';
import { createSettlements } from '../analysis/analyzer/settlements.js';
import { createValues, normalValue, valueInputs } from '../analysis/analyzer/values.js';
import { append, put } from './support/collections.js';

// Promise identity, adoption, settlement and selected-protocol lifetime compose. Preserve independent native Get/rejection observations, cleanup, unknown protocols and shared graph bounds.

{
    const setup = () => {
        const decisions = createDecisions();
        const owner = createOwner({ evidence: unresolved() });
        const value = normalValue({ owner });
        const values = createValues({ unknown: { owner }, decisions }, gate => gate, (entry, gate) => gate);
        const outcomes = createOutcomes({ decisions, values });
        const failure = source => outcomes.outcome({ thrown: 1, error: value, rejections: Object.freeze({ source, gate: 1 }) });

        return { decisions, outcomes, failure };
    };

    test('rejection contribution gates preserve conditional sources and unknown failures', () => {
        const { decisions = {}, outcomes = {}, failure } = setup();
        const { continuation = {} } = outcomes;
        const a = decisions.variable('a');
        const b = decisions.variable('b');
        const first = failure('first');
        const second = failure('second');
        const selected = outcomes.join(outcomes.restrict(first, a), outcomes.restrict(second, decisions.not(a)));
        const forwarded = outcomes.join(outcomes.restrict(selected, b), outcomes.restrict(first, decisions.not(b)));
        const replaced = outcomes.finalized(selected, outcomes.join(outcomes.restrict(continuation, b),
            outcomes.restrict(failure('cleanup'), decisions.not(b))));
        const sources = (entry, left, right) => outcomes.rejectionCases([entry]).filter(({ gate = 0 } = {}) => (
            decisions.possible(gate, new Map([[0, left], [1, right]]))
        )).map(({ source = '' } = {}) => source).toSorted();

        [false, true].forEach(left => [false, true].forEach((right) => {
            const chosen = left ? 'first' : 'second';

            deepStrictEqual(sources(selected, left, right), [left ? 'first' : 'second']);
            deepStrictEqual(sources(forwarded, left, right), [right && !left ? 'second' : 'first']);
            deepStrictEqual(sources(replaced, left, right), [right ? chosen : 'cleanup']);
            deepStrictEqual(sources(outcomes.caught(selected, continuation), left, right), []);
            deepStrictEqual(sources(outcomes.invoked(selected), left, right), [left ? 'first' : 'second']);
        }));
        const unknown = outcomes.join(outcomes.restrict(first, a), outcomes.outcome({ thrown: decisions.not(a) }));
        const cases = outcomes.rejectionCases([unknown]);

        strictEqual(cases.length, 2, 'An untracked failure must retain independent identity');
        strictEqual(cases.filter(({ source = '' } = {}) => source === 'first').length, 1);
        strictEqual(cases.filter(({ gate = 0 } = {}) => decisions.possible(gate, new Map([[0, false]]))).length, 1);
    });

    test('rejection contribution diamonds retain linear storage and project each edge once', () => {
        [[8, 8], [16, 64], [64, 16], [64, 64]].forEach(([width = 0, depth = 0] = []) => {
            const { decisions = {}, outcomes = {}, failure } = setup();
            const { join, empty = {} } = outcomes;

            if (typeof join !== 'function') throw new TypeError('Expected completion composition');

            const gate = decisions.variable('choice');
            const sources = Array.from({ length: width }, (unused, index) => `source:${index}`);
            const joined = sources.map(failure).reduce(join, empty);
            const prefixes = [joined];
            const last = Array.from({ length: depth }).reduce((prior) => {
                const next = outcomes.join(outcomes.restrict(prior, gate), outcomes.restrict(prior, decisions.not(gate)));

                append(prefixes, next);

                return next;
            }, joined);
            const retained = new Map();
            const inspect = (node) => {
                if (!node || retained.has(node)) return;

                put(retained, node, true);
                const { input = false, inputs = [] } = node;

                if (input) inspect(input);

                inputs.forEach(inspect);
            };

            prefixes.forEach(({ rejections = false } = {}) => inspect(rejections));
            ok(retained.size <= 4 * (width + depth), `${width}/${depth}: ${retained.size}`);
            const visits = [];
            const result = outcomes.rejectionCases([last], () => append(visits, true));

            deepStrictEqual(result.map(({ source = '' } = {}) => source).toSorted(), sources.toSorted());
            ok(result.every(({ gate = 0 } = {}) => gate === 1));
            ok(visits.length <= 2 * retained.size + 4, `${width}/${depth}: ${visits.length} visits for ${retained.size} nodes`);
            deepStrictEqual(outcomes.rejectionCases([last]), result);
            const interrupted = [];
            const error = new Error('interrupted rejection projection');

            throws(() => outcomes.rejectionCases([last], () => {
                append(interrupted, true);

                if (interrupted.length === 5) throw error;
            }), failure => failure === error);
            deepStrictEqual(outcomes.rejectionCases([last]), result);
        });
    });
}

{
    const setup = () => {
        const decisions = createDecisions();
        const owner = createOwner({ evidence: unresolved() });
        const values = createValues({ unknown: { owner }, decisions }, gate => gate, (entry, gate) => gate);
        const outcomes = createOutcomes({ decisions, values });
        const settlements = createSettlements({ decisions, values, outcomes });
        const known = name => normalValue({ owner: createOwner({ evidence: familyEvidence({ name }) }), promise: 'none', standardPrototype: true });
        const uncertain = () => outcomes.outcome({ normal: 1, thrown: 1, effects: 1, value: normalValue({ owner }) });
        const promise = completion => normalValue({ owner: createOwner({ evidence: familyEvidence({ name: 'object' }) }),
            promise: 'known', settlement: completion });

        return { decisions, values, outcomes, settlements, known, uncertain, promise };
    };

    test('payload retirement preserves native settlement identity while retiring both member snapshots', () => {
        const { values = {}, outcomes = {}, settlements = {}, known, uncertain, promise } = setup();
        const value = normalValue({ owner: createOwner({ evidence: record({ fields: [{ name: 'name', owner: createOwner({ evidence: familyEvidence({ name: 'number' }) }) }] }) }), promise: 'none' });
        const pending = promise(outcomes.outcome({ normal: 1, thrown: 1, value, error: value, rejections: { source: 'one', gate: 1 } }));
        const retired = values.retire(pending);
        const selected = settlements.resolve(retired, 'payload', uncertain);
        const { value: fulfilled = {}, error = {}, rejections = false } = selected;
        const { unowned: valueRetired = false } = fulfilled;
        const { unowned: errorRetired = false } = error;

        strictEqual(valueRetired, true);
        strictEqual(errorRetired, true);
        deepStrictEqual(rejections, { source: 'one', gate: 1 });
        strictEqual(values.retire(retired), retired);
        const exposed = values.retire(retired, { protocol: true });

        strictEqual(values.retire(exposed, { protocol: true }), exposed);
        const { value: unknown = {}, rejections: discarded = false } = settlements.resolve(exposed, 'payload', uncertain);
        const { owner = false } = values.evidenceFor(unknown);

        strictEqual(readFamily({ owner }).incomplete, true);
        strictEqual(discarded, false);
        const scalar = values.retire(known('number'), { protocol: true });
        const { thrown = 0, value: preserved = false } = settlements.resolve(scalar, 'scalar', uncertain);
        const { owner: number = false } = values.evidenceFor(preserved);

        strictEqual(thrown, 0);
        deepStrictEqual(readFamily({ owner: number }).families, ['number']);
    });

    test('protocol projection shares diamonds across width depth and ownership states', () => {
        [[8, 8], [16, 64], [64, 16], [64, 64]].forEach(([width = 0, depth = 0] = []) => {
            const { decisions = {}, values = {}, outcomes = {}, settlements = {}, known, uncertain, promise } = setup();
            const gate = decisions.variable('choice');
            const leaves = Array.from({ length: width }, () => promise(outcomes.complete(known('number'))));
            const initial = values.joined(leaves);
            const root = Array.from({ length: depth }).reduce(prior => values.joined([
                values.restrict(prior, gate), values.restrict(prior, decisions.not(gate))
            ]), initial);
            const joined = values.joined([root, values.retire(root, { protocol: true })]);
            const retained = new Map();
            const edges = [];
            const inspect = (entry) => {
                if (!entry || retained.has(entry)) return;

                put(retained, entry, true);
                valueInputs(entry).forEach((child) => {
                    append(edges, true);
                    inspect(child);
                });
            };

            inspect(joined);
            ok(retained.size <= width + depth * 3 + 3);
            const visits = [];
            const observation = { onWork: ({ kind = '' } = {}) => {
                if (kind === 'settlement-projection') append(visits, true);
            } };
            const result = settlements.resolve(joined, 'shared', uncertain, observation);
            const { value = false, thrown = 0 } = result;
            const { owner = false } = values.evidenceFor(value);

            deepStrictEqual(readFamily({ owner }).families, ['number']);
            strictEqual(readFamily({ owner }).incomplete, true);
            strictEqual(thrown, 1);
            ok(!!visits.length);
            ok(visits.length <= 2 * (retained.size + edges.length), `${width}/${depth}: ${visits.length}/${retained.size}`);
            const count = () => visits.length;
            const before = count();

            strictEqual(settlements.resolve(joined, 'shared', uncertain, observation), result);
            strictEqual(visits.length, before);
            const interrupted = [];
            const failure = new Error('interrupted protocol projection');

            throws(() => settlements.resolve(joined, 'retry', uncertain, { onWork: () => {
                append(interrupted, true);

                if (interrupted.length === 5) throw failure;
            } }), error => error === failure);
            const { value: retried = false } = settlements.resolve(joined, 'retry', uncertain);
            const { owner: source = false } = values.evidenceFor(retried);

            deepStrictEqual(readFamily({ owner: source }).families, ['number']);
            strictEqual(readFamily({ owner: source }).incomplete, true);
        });
    });

    test('protocol lifetime selection retains guarded evidence with bounded shared projection', () => {
        [[8, 8], [16, 64], [64, 16], [64, 64]].forEach(([width = 0, depth = 0] = []) => {
            const { decisions = {}, values = {}, outcomes = {}, known, promise } = setup();
            const gate = decisions.variable('lifetime');
            const input = values.joined(Array.from({ length: width }, () => promise(outcomes.complete(known('number')))));
            const root = Array.from({ length: depth }).reduce(prior => values.joined([
                values.restrict(prior, gate), values.restrict(prior, decisions.not(gate))
            ]), input);
            const source = values.joined([values.restrict(root, gate), values.restrict(values.retire(root, { protocol: true }), decisions.not(gate))]);
            const bound = 2 * (width + 3 * depth + 6);
            const visits = [];
            const visit = () => {
                append(visits, true);
                ok(visits.length <= bound, `${width}/${depth}: lifetime selection must share contributions`);
            };
            const result = values.typeGate(source, '', 0, visit, 'protocol');

            strictEqual(result, gate);
            strictEqual(values.typeGate(source, 'unsafe', 0, () => false, 'protocol'), decisions.not(gate));
            const count = () => visits.length;
            const before = count();

            strictEqual(values.typeGate(source, '', 0, visit, 'protocol'), result);
            strictEqual(visits.length, before);
            const ambiguous = values.joined([root, values.retire(root, { protocol: true })]);

            strictEqual(values.typeGate(ambiguous, 'unsafe', 0, () => false, 'protocol'), 1);
            const primitive = values.joined([known('number'), known('object')]);

            strictEqual(values.typeGate(primitive, 'unsafe', 0, () => false, 'primitive'), 1);
            const owned = normalValue({ ...known('array'), slots: Object.freeze([root]) });
            const fresh = normalValue({ ...known('array'), slots: Object.freeze([owned, promise(outcomes.complete(known('number')))]) });
            const contentsVisits = [];
            const contentsVisit = () => append(contentsVisits, true);

            strictEqual(values.typeGate(owned, 'known', 0, () => false, 'contents'), 1);
            Array.from({ length: width }, (_, index) => ({ key: `discarded:${index}`, accepts: (origin, value) => value !== owned })).forEach((scope) => {
                strictEqual(values.typeGate(fresh, 'known', 0, contentsVisit, 'contents', scope), 1);
                strictEqual(values.typeGate(owned, 'known', 0, contentsVisit, 'contents', scope), 0);
                const { length: before = 0 } = contentsVisits;

                strictEqual(values.typeGate(fresh, 'known', 0, contentsVisit, 'contents', scope), 1);
                strictEqual(contentsVisits.length, before);
            });
            ok(contentsVisits.length <= width * 3, 'Each discarded use stops at the owned carrier instead of rewalking its shared contents');
            strictEqual(values.typeGate(owned, 'known', 0, () => false, 'contents'), 1, 'Discharging work does not erase known promise evidence');
            const failure = new Error('interrupted lifetime selection');
            const scratch = [];

            throws(() => values.typeGate(source, 'retry', 0, () => {
                append(scratch, true);

                if (scratch.length === 5) throw failure;
            }, 'protocol'), error => error === failure);
            strictEqual(values.typeGate(source, 'retry', 0, () => false, 'protocol'), gate);
        });
    });

    test('native observers do not replay effects already published by envelope creation', () => {
        const { outcomes = {}, settlements = {}, known, uncertain, promise } = setup();
        const creation = outcomes.outcome({ normal: 1, effects: 1, value: known('number') });
        const envelope = promise(creation);
        const first = settlements.resolve(envelope, 'first', uncertain);
        const second = settlements.resolve(envelope, 'second', uncertain);

        const { effects: created = 0, value: payload = false } = creation;
        const { effects: firstEffects = 0, value: firstValue = false } = first;
        const { effects: secondEffects = 0, value: secondValue = false } = second;

        strictEqual(created, 1);
        strictEqual(firstEffects, 0);
        strictEqual(secondEffects, 0);
        strictEqual(firstValue, payload);
        strictEqual(secondValue, payload);
        strictEqual(settlements.resolve(envelope, 'first', uncertain), first);
    });
}
