import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const { source: composedSource = '', querySource = '' } = JSON.parse(readFileSync(new URL('./fixtures/source-query-composition.json', import.meta.url), 'utf8'));
const selectedPattern = (analysis, source, selected) => analysis.destructurings.find(({ location: { range = [] } = {} } = {}) => source.slice(...range) === selected);

test('a source agreement does not combine independent invocation flow gates', () => {
    const analysis = createAnalysis({ source: composedSource, limits: { decisions: 2_000_000 } });
    const { index = -1 } = selectedPattern(analysis, composedSource, querySource);
    const result = analysis.checkDestructuring({ index });
    const { counts = {} } = analysis;
    const { status = '', fact: { incomplete = false } = {} } = result;

    // The resolved predicate now proves this normalizer's object container;
    // the calls still retain independent invocation flow gates.
    strictEqual(status, 'agreement');
    strictEqual(incomplete, false);
    deepStrictEqual(analysis.checkDestructuring({ index }), result);
    const { counts: repeatedCounts = {} } = analysis;

    deepStrictEqual(repeatedCounts, counts);
});

[
    ['known conflict beside unknown', 'const take=input=>{const [item]=input;return item;};take("");take(external);', 'contradiction'],
    ['unknown input', 'const take=input=>{const [item]=input;return item;};take(external);', 'unknown'],
    ['authored default does not validate a supplied string', 'const take=(input=[])=>{const [item]=input;return item;};take("");take();', 'contradiction'],
    ['guarded alternatives preserve a known conflict', 'const take=input=>{const [item]=input;return item;};take(flag?[]:"");', 'contradiction']
].forEach(([name = '', source = '', expected = ''] = []) => {
    test(`source-owner composition: ${name}`, () => {
        const analysis = createAnalysis({ source });
        const { index = -1 } = selectedPattern(analysis, source, 'input');
        const result = analysis.checkDestructuring({ index });
        const { status = '' } = result;

        strictEqual(status, expected);
        analysis.functions.forEach(({ index: functionIndex = -1 } = {}) => analysis.checkFunction({ index: functionIndex }));
        deepStrictEqual(analysis.checkDestructuring({ index }), result);
        deepStrictEqual(createAnalysis({ source }).checkDestructuring({ index }), result);
    });
});

test('producer-owned fields retain absence beside unknown across invocations', () => {
    const source = 'const take=input=>{const {required}=input;return required;};take({});take(external);';
    const analysis = createAnalysis({ source });
    const { destructuringFields: [{ index = -1 } = {}] = [] } = analysis;
    const result = analysis.checkDestructuringField({ index });
    const { status = '', fact: { presence = [] } = {} } = result;

    strictEqual(status, 'contradiction');
    ok(presence.includes('absent'));
    deepStrictEqual(analysis.checkDestructuringField({ index }), result);
});

test('source-owner extraction propagates observer failure and permits retry', () => {
    const source = 'const take=input=>{const [item]=input;return item;};take("");';
    const analysis = createAnalysis({ source });
    const { index = -1 } = selectedPattern(analysis, source, 'input');
    const failure = new Error('query observer failed');

    throws(() => analysis.checkDestructuring({ index, onWork: () => { throw failure; } }), error => error === failure);
    deepStrictEqual(analysis.checkDestructuring({ index }), createAnalysis({ source }).checkDestructuring({ index }));
});

test('source revisions retain their own facts and the product reports the contradiction', () => {
    const source = 'const take=input=>{const [item]=input;return item;};take("");';
    const before = createAnalysis({ source });
    const after = createAnalysis({ source: source.replace('take("")', 'take([])') });
    const { index = -1 } = selectedPattern(before, source, 'input');

    strictEqual(before.checkDestructuring({ index }).status, 'contradiction');
    strictEqual(after.checkDestructuring({ index }).status, 'unknown');
    strictEqual(before.checkDestructuring({ index }).status, 'contradiction');
    const findings = new Linter().verify(source, { plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-destructuring': 'error' } });
    const [{ messageId = '' } = {}] = findings;

    strictEqual(findings.length, 1);
    strictEqual(messageId, 'mismatch');
});
