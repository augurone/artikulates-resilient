import { deepStrictEqual, strictEqual, ok } from 'node:assert/strict';
import test from 'node:test';

import { createOwner, fromESTree, unresolved, producer, reference, readFamily, replaceEvidence } from 'eslint-plugin-resilient/agreement';
import { createAnalysis } from 'eslint-plugin-resilient/analyzer';

test('bounded unknown causes survive aliases, contradictions and source revisions', () => {
    const inputs = Array.from({ length: 40 }, (_, index) => createOwner({ evidence: unresolved({
        code: 'external-input', reason: index ? 'A external input' : 'Z external input', location: { range: [index, index + 1] }
    }) }));
    const duplicate = createOwner({ evidence: unresolved({ code: 'external-input', reason: 'A external input', location: { range: [0, 1] } }) });
    const known = ['text', 42].map(value => createOwner({ evidence: fromESTree({ type: 'Literal', value }) }));
    const joined = [...inputs, duplicate].reduce((owner, next) => createOwner({ evidence: producer({ owners: [owner, next] }) }), known.at(0));
    const owner = createOwner({ evidence: producer({ owners: [joined, ...known] }) });
    const alias = createOwner({ evidence: reference({ owner }) });
    const first = readFamily({ owner: alias });
    const { state = '', reason = '', causes = [], causesTruncated = false } = first;

    strictEqual(state, 'contradictory');
    strictEqual(reason, 'A external input');
    strictEqual(causes.length, 8);
    strictEqual(causesTruncated, true);
    ok(causes.every((cause) => {
        const { reason = '', location: { range = [] } = {} } = cause;

        return reason === 'A external input' && Object.isFrozen(cause) && Object.isFrozen(range);
    }));
    const cycle = (reverse = false) => {
        const left = createOwner({ evidence: unresolved() });
        const right = createOwner({ evidence: unresolved() });

        replaceEvidence({ owner: left, evidence: producer({ owners: [right, ...inputs.slice(0, 20), ...known] }) });
        replaceEvidence({ owner: right, evidence: producer({ owners: [left, ...inputs.slice(20).toReversed(), duplicate] }) });

        return readFamily({ owner: reverse ? right : left });
    };
    [cycle(), cycle(true)].forEach(({ state = '', reason = '', families = [], incomplete = false, causes: selected = [], causesTruncated = false } = {}) => {
        strictEqual(state, 'contradictory');
        strictEqual(reason, 'A external input');
        deepStrictEqual(families, ['string', 'number']);
        strictEqual(incomplete, true);
        deepStrictEqual(selected, causes);
        strictEqual(causesTruncated, true);
    });
    replaceEvidence({ owner: joined, evidence: fromESTree({ type: 'Literal', value: 'ready' }) });
    const next = readFamily({ owner: alias });
    const { state: nextState = '', reason: nextReason = '', incomplete = false, causes: remaining = [], causesTruncated: truncated = false } = next;

    strictEqual(nextState, 'contradictory');
    strictEqual(nextReason, '');
    strictEqual(incomplete, false);
    deepStrictEqual(remaining, []);
    strictEqual(truncated, false);
    strictEqual(causes.length, 8, 'Retained historical evidence stays intact');
});

test('analyzer retains the originating cause and omits alternatives excluded by completion', () => {
    const source = 'const read = (choose) => choose ? missing() : 42; const finish = () => { try { return missing(); } finally { return "ready"; } };';
    const analysis = createAnalysis({ source });
    const { fact = {} } = analysis.checkFunction({ index: 0 });
    const { causes = [], families = [] } = fact;
    const [{ code = '', location: { range: [start = 0, end = 0] = [] } = {} } = {}] = causes;

    strictEqual(code, 'unresolved-call');
    strictEqual(source.slice(start, end), 'missing()');
    deepStrictEqual(families, ['number']);
    deepStrictEqual(analysis.checkFunction({ index: 1 }).fact.causes, []);
});

test('generic inputs, captures, opaque expressions and unsupported functions have distinct causes', () => {
    [
        ['const read = value => value;', 'parameter-input'],
        ['const value = 1; const read = () => value;', 'captured-value'],
        ['const read = () => external.field;', 'unsupported-expression'],
        ['const read = async () => await external;', 'unresolved-settlement'],
        ['const read = function* () { return 1; };', 'generator-function']
    ].forEach(([source = '', expected = ''] = []) => {
        const analysis = createAnalysis({ source });
        const { fact: { causes = [] } = {} } = analysis.checkFunction({ index: 0 });

        deepStrictEqual(causes.map(({ code = '' } = {}) => code), [expected]);
    });
});
