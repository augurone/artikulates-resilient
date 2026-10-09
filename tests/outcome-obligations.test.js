import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

const read = 'const read=({items=[]}={})=>items;';
const cases = [
    ['forwarding', 'const forward=value=>read(value);forward({items:""});', 'contradiction', ['items']],
    ['later throw', 'const forward=value=>{read(value);throw 1;};forward({items:""});', 'contradiction', ['items']],
    ['finalizer replaces return', 'const forward=value=>{try{return read(value);}finally{return 0;}};forward({items:""});', 'contradiction', ['items']],
    ['finalizer replaces throw', 'const forward=value=>{try{read(value);throw 1;}finally{return 0;}};forward({items:""});', 'contradiction', ['items']],
    ['catch retains reached call', 'const forward=value=>{try{read(value);throw 1;}catch(error){return 0;}};forward({items:""});', 'contradiction', ['items']],
    ['earlier throw', 'const forward=value=>{throw 1;read(value);};forward({items:""});', 'agreement', []],
    ['unselected branch', 'const forward=value=>false?read(value):0;forward({items:""});', 'agreement', []],
    ['unknown branch', 'const forward=value=>flag?read(value):0;forward({items:""});', 'contradiction', ['items']],
    ['authored absence', 'const forward=value=>read(value);forward({});', 'agreement', []],
    ['unknown input', 'const forward=value=>read(value);forward({items:external});', 'unknown', []],
    ['unresolved descendant', 'const forward=value=>{external();return value;};forward({items:""});', 'agreement', []]
];

cases.forEach(([name = '', tail = '', expected = '', paths = []] = []) => {
    test(`outcome obligation: ${name}`, () => {
        const source = read + tail;
        const analysis = createAnalysis({ source });
        const { index = -1 } = analysis.calls.findLast(({ callee = '' } = {}) => callee === 'forward') ?? {};
        const result = analysis.checkCall({ index });
        const { status = '', obligations = [] } = result;
        const conflicts = obligations.filter(({ status = '' } = {}) => status === 'contradiction');

        strictEqual(status, expected);
        deepStrictEqual(conflicts.map(({ path = '' } = {}) => path), paths);
        conflicts.forEach(({ location: { range = [] } = {}, origin: { range: origin = [] } = {} } = {}) => {
            strictEqual(source.slice(...range), 'forward({items:""})');
            strictEqual(source.slice(...origin), 'value');
        });
        const reversed = createAnalysis({ source });
        const generic = reversed.functions.map(({ index = -1 } = {}) => reversed.checkFunction({ index }));

        reversed.calls.toReversed().forEach(({ index = -1 } = {}) => reversed.checkCallResult({ index, required: 'array' }));
        reversed.calls.toReversed().forEach(({ index = -1 } = {}) => reversed.checkCall({ index }));
        deepStrictEqual(reversed.checkCall({ index }), result);
        deepStrictEqual(reversed.functions.map(({ index = -1 } = {}) => reversed.checkFunction({ index })), generic);
        const messages = new Linter().verify(source, {
            plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' }
        });

        strictEqual(messages.length, paths.length);
    });
});

test('callee and argument calls keep their own boundaries outside the receiving invocation', () => {
    const source = 'const read=(value="")=>value;const make=value=>value;const accept=value=>value;accept(make(read(42)));';
    const analysis = createAnalysis({ source });
    const statuses = analysis.calls.map(({ index = -1, callee = '' } = {}) => [callee, analysis.checkCall({ index }).status]);

    deepStrictEqual(statuses, [['accept', 'agreement'], ['make', 'agreement'], ['read', 'contradiction']]);
});

test('an argument failure prevents admission without turning execution failure into agreement', () => {
    const source = `${read}const fail=()=>{throw 1;};read({items:fail()});`;
    const analysis = createAnalysis({ source });
    const { index = -1 } = analysis.calls.find(({ callee = '' } = {}) => callee === 'read') ?? {};
    const { normal = true, thrown = false } = analysis.checkCallResult({ index, required: 'array' });

    deepStrictEqual(analysis.checkCall({ index }), { status: 'unknown', obligations: [] });
    deepStrictEqual([normal, thrown], [false, true]);
});

test('finalizer replacement changes the runtime result while preserving the reached source obligation', () => {
    const source = `${read}const forward=value=>{try{return read(value);}finally{return 0;}};forward({items:""});`;

    strictEqual(runInNewContext(source), 0);
    const analysis = createAnalysis({ source });
    const { index = -1 } = analysis.calls.find(({ callee = '' } = {}) => callee === 'forward') ?? {};
    const { status = '', normal = false, thrown = true } = analysis.checkCallResult({ index, required: 'number' });

    deepStrictEqual([status, normal, thrown], ['agreement', true, false]);
    strictEqual(analysis.checkCall({ index }).status, 'contradiction');
});

test('observer interruption cannot publish partial obligation histories or alter retry results', () => {
    const source = `${read}const forward=value=>{try{return [value].map(item=>read(item));}finally{return 0;}};forward({items:""});`;
    const baseline = createAnalysis({ source });
    const { index = -1 } = baseline.calls.find(({ callee = '' } = {}) => callee === 'forward') ?? {};
    const work = counter();
    const expected = baseline.checkCall({ index, onWork: event => work.onWork(event) });

    Object.keys(work.read()).forEach((interrupted) => {
        const analysis = createAnalysis({ source });
        const failure = new Error(interrupted);

        throws(() => analysis.checkCall({ index, onWork: ({ kind = '' } = {}) => {
            if (kind === interrupted) throw failure;
        } }), error => error === failure);
        deepStrictEqual(analysis.checkCall({ index }), expected, interrupted);
    });
});

test('short-circuit value selection does not manufacture additional call occurrences', () => {
    const source = `${read}const forward=value=>read(value)&&read(value);forward({items:external});`;
    const analysis = createAnalysis({ source });
    const { index = -1 } = analysis.calls.find(({ callee = '' } = {}) => callee === 'forward') ?? {};
    const result = analysis.checkCall({ index });
    const { obligations = [] } = result;
    const fields = obligations.filter(({ path = '' } = {}) => path === 'items');

    strictEqual(fields.length, 2, 'Each of the two authored calls contributes once');
    deepStrictEqual(fields.map(({ status = '' } = {}) => status), ['unknown', 'unknown']);
    analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCallResult({ index, required: 'array' }));
    deepStrictEqual(analysis.checkCall({ index }), result);
});

test('callback descendants precede finalizer obligations and retain both origins', () => {
    const source = `${read}const forward=value=>{try{return [value].map(item=>read(item));}finally{read(value);}};forward({items:""});`;
    const analysis = createAnalysis({ source });
    const { index = -1 } = analysis.calls.find(({ callee = '' } = {}) => callee === 'forward') ?? {};
    const { obligations = [] } = analysis.checkCall({ index });

    deepStrictEqual(obligations.filter(({ path = '' } = {}) => path === 'items')
        .map(({ origin: { range = [] } = {} } = {}) => source.slice(...range)), ['item', 'value']);
});

test('retained judgments and source revisions do not share replaceable obligation state', () => {
    const source = `${read}const forward=value=>read(value);forward({items:""});`;
    const first = createAnalysis({ source });
    const { index = -1 } = first.calls.find(({ callee = '' } = {}) => callee === 'forward') ?? {};
    const retained = first.checkCall({ index });
    const revised = createAnalysis({ source: source.replace('items:""', 'items:[]') });

    strictEqual(revised.checkCall({ index }).status, 'agreement');
    strictEqual(first.checkCall({ index }).status, 'contradiction');
    deepStrictEqual(first.checkCall({ index }), retained);
});
