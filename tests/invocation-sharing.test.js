import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

const composition = (size, input, body = 'value') => [`const f0=value=>${body};`,
    ...Array.from({ length: size }, (unused, index) => `const f${index + 1}=value=>{f${index}(value);return f${index}(value);};`), `f${size}(${input});`].join('');

[
    ['42', 'number', 'agreement', 'value'], ['external', 'number', 'unknown', 'value'],
    ['external?{}:[]', 'object', 'contradiction', 'value']
].forEach(([input = '', required = '', status = '', body = ''] = []) => test(`repeated pure calls share owned evidence for ${body} with ${input}`, () => {
    const samples = [50, 100, 200].map((size) => {
        const analysis = createAnalysis({ source: composition(size, input, body) });
        const { calls = [] } = analysis;
        const { index = -1 } = calls.findLast(({ callee = '' } = {}) => callee === `f${size}`) ?? {};
        const work = counter();
        const result = analysis.checkCallResult({ index, required, onWork: event => work.onWork(event) });
        const { status: actual = '' } = result;
        const before = work.read();

        strictEqual(actual, status);
        deepStrictEqual(analysis.checkCallResult({ index, required, onWork: event => work.onWork(event) }), result);
        const after = work.read();

        ['function-context', 'value-demand', 'flow-contribution'].forEach(kind => strictEqual(Reflect.get(after, kind), Reflect.get(before, kind)));
        const { counts = {} } = analysis;

        return { ...before, ...counts };
    });

    ['function-context', 'value-demand', 'contexts', 'values'].forEach((kind) => {
        const [first = 0, second = 0, third = 0] = samples.map(sample => Reflect.get(sample, kind));

        strictEqual(third - second, 2 * (second - first));
    });
}));

test('shared bodies retain contract findings at both actual caller uses', () => {
    const source = 'const wrong=42;const read=(value="")=>value;read(wrong);read(wrong);';
    const findings = new Linter().verify(source, { plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' } });

    strictEqual(findings.length, 2);
    const [{ column: first = 0 } = {}, { column: second = 0 } = {}] = findings;

    strictEqual(first < second, true);
});

test('caller values cannot replace generic or earlier evidence', () => {
    const source = 'const read=(value="")=>value;const number=42;read(number);read(number);read("");';
    const first = createAnalysis({ source });
    const second = createAnalysis({ source });
    const { calls = [] } = second;
    const before = first.checkFunction({ index: 0 });

    calls.toReversed().forEach(({ index = -1 } = {}) => second.checkCallResult({ index, required: 'number' }));
    deepStrictEqual(second.checkFunction({ index: 0 }), before);
    deepStrictEqual(first.checkFunction({ index: 0 }), before);
    const revision = createAnalysis({ source: source.replace('number=42', 'number=""') });

    strictEqual(revision.checkCallResult({ index: 0, required: 'number' }).status, 'contradiction');
    strictEqual(first.checkCallResult({ index: 0, required: 'number' }).status, 'agreement');
});

test('nested shared obligations remain at both caller boundaries', () => {
    const source = 'const read=(value="")=>value;const repeat=value=>{read(value);return read(value);};const wrong=42;repeat(wrong);repeat(wrong);';
    const analysis = createAnalysis({ source });
    const { calls = [] } = analysis;
    const uses = calls.filter(({ callee = '' } = {}) => callee === 'repeat');
    const expected = uses.map(({ index = -1 } = {}) => analysis.checkCall({ index }));
    const reversed = createAnalysis({ source });

    deepStrictEqual(uses.toReversed().map(({ index = -1 } = {}) => reversed.checkCall({ index })).toReversed(), expected);
    expected.forEach(({ status = '', obligations = [] } = {}) => {
        strictEqual(status, 'contradiction');
        strictEqual(obligations.filter(({ status = '' } = {}) => status === 'contradiction').length, 2);
    });
    const findings = new Linter().verify(source, { plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' } });

    strictEqual(findings.length, 4);
    strictEqual(new Set(findings.map(({ column = 0 } = {}) => column)).size, 2);
});

[
    ['external(record);', 1], ['record.value="";', 1], ['const alias=record;external(alias);', 1],
    ['const observe=()=>record;external(observe);', 0]
].forEach(([effect = '', count = 0] = []) => test(`a shared return never revives retired fields after ${effect}`, () => {
    const source = `const read=value=>value;const record={value:42};read(record).value.trim();${effect}read(record).value.trim();`;
    const forward = createAnalysis({ source });
    const reversed = createAnalysis({ source });
    const { memberAccesses = [] } = forward;
    const expected = memberAccesses.map(({ index = -1 } = {}) => forward.checkMemberAccess({ index }));

    deepStrictEqual(memberAccesses.toReversed().map(({ index = -1 } = {}) => reversed.checkMemberAccess({ index })).toReversed(), expected);
    const findings = new Linter().verify(source, { plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-operation': 'error' } });

    // Captured records have no local structural lifetime proof at either use.
    strictEqual(findings.length, count);
    const [{ column = 0 } = {}] = findings;

    strictEqual(column < source.indexOf(effect), true);
}));

test('same-spelled callees and distinct argument tuples own distinct results', () => {
    const source = 'const read=value=>value;const count=42;read(count);{const read=value=>"";read(count);}read("");read(count);';
    const analysis = createAnalysis({ source });
    const { calls = [] } = analysis;
    const statuses = calls.map(({ index = -1 } = {}) => analysis.checkCallResult({ index, required: 'number' }).status);

    deepStrictEqual(statuses, ['agreement', 'contradiction', 'contradiction', 'agreement']);
});

test('interrupted sharing proofs publish only completed callee evidence', () => {
    const source = composition(4, '42');
    const first = createAnalysis({ source });
    const { calls = [] } = first;
    const { index = -1 } = calls.findLast(({ callee = '' } = {}) => callee === 'f4') ?? {};
    const work = counter();
    const expected = first.checkCallResult({ index, required: 'number', onWork: event => work.onWork(event) });

    Object.keys(work.read()).forEach((interrupted) => {
        const analysis = createAnalysis({ source });
        const failure = new Error(interrupted);

        throws(() => analysis.checkCallResult({ index, required: 'number', onWork: ({ kind = '' } = {}) => {
            if (kind === interrupted) throw failure;
        } }), error => error === failure);
        deepStrictEqual(analysis.checkCallResult({ index, required: 'number' }), expected);
    });
});
