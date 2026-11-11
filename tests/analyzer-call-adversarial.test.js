import { deepStrictEqual, strictEqual, ok } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { ESLint, Linter, SourceCode } from 'eslint';
import { parse } from 'espree';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

const callsNamed = ({ analysis = {}, name = 'label' } = {}) => {
    const { calls = [] } = analysis;

    return calls.filter(({ callee = '' } = {}) => callee === name).map(({ index = -1 } = {}) => analysis.checkCall({ index }));
};
const statuses = source => callsNamed({ analysis: createAnalysis({ source }) }).map(({ status = '' } = {}) => status);
const defaults = [
    { expression: '""', tag: '[object String]' },
    { expression: '0', tag: '[object Number]' },
    { expression: 'false', tag: '[object Boolean]' },
    { expression: '[]', tag: '[object Array]' },
    { expression: '{}', tag: '[object Object]' },
    { expression: '/value/u', tag: '[object RegExp]' },
    { expression: 'null', tag: '[object Null]' }
];

test('supported call defaults match an independent JavaScript execution oracle', () => {
    const values = [...defaults.map(({ expression = '' } = {}) => expression), '() => 0'];
    const supplied = values.map(expression => ({ direct: expression, record: `{ value: ${expression} }` }));
    const inputs = [...supplied, { direct: '', record: '{}' }];

    defaults.forEach(({ expression: fallback = '', tag = '' } = {}) => {
        inputs.forEach(({ direct = '', record = '' } = {}) => {
            [
                { parameters: `value = ${fallback}`, argument: direct },
                { parameters: `{ value = ${fallback} } = {}`, argument: record }
            ].forEach(({ parameters = '', argument = '' } = {}) => {
                // Execute only these generated, closed fixtures. JavaScript selects
                // the actual default/value; the analyzer never executes the body.
                const source = `const label = (${parameters}) => Object.prototype.toString.call(value); label(${argument});`;
                const actual = runInNewContext(source);
                const expected = actual === tag ? 'agreement' : 'contradiction';

                deepStrictEqual(statuses(source), [expected], source);
            });
        });
        const omitted = `const label = ({ value = ${fallback} } = {}) => Object.prototype.toString.call(value); label();`;

        strictEqual(runInNewContext(omitted), tag);
        deepStrictEqual(statuses(omitted), ['agreement'], omitted);
    });
});

test('unknown values cannot select a default, while independent contradictions survive in every argument position', () => {
    const variants = ['external', '0n', 'getValue()', '(0, "ready")'];

    variants.forEach((value) => {
        const source = `const label = (first = "", second = "", third = "") => first;
            label(${value}); label(${value}, 42); label(42, ${value}); label("ready", ${value}, 42);
            label("ready", 42, ${value}); label(${value}, "ready", 42); label(42, "ready", ${value});`;

        deepStrictEqual(statuses(source), ['unknown', ...Array.from({ length: 6 }, () => 'contradiction')], value);
        deepStrictEqual(statuses(`const label = ({ value = "", count = 0 } = {}) => value;
            label({ value: ${value} }); label({ value: ${value}, count: "wrong" });`), ['unknown', 'contradiction'], value);
    });
});

test('fresh record writer order and unusual static keys preserve values and diagnostic spans', async () => {
    const source = `const label = ({ "": empty = "", 0: zero = "", "__proto__": proto = "" } = {}) => empty;
label({ "": 1, 0: 2, ["__proto__"]: 3 });
label({ "": 1, ...external, 0: 2, ["__proto__"]: "ok" });
label({ ...external, "": "ok", 0: "ok", ["__proto__"]: 3 });
label({ "": 1, "": "ok", 0: 2, 0: "ok", ["__proto__"]: 3, ["__proto__"]: "ok" });`;
    const analysis = createAnalysis({ source });
    const results = callsNamed({ analysis });
    const expected = [['1', '2', '3'], ['2'], ['3'], []];

    deepStrictEqual(results.map(({ status = '' } = {}) => status), ['contradiction', 'contradiction', 'contradiction', 'agreement']);
    results.forEach(({ obligations = [] } = {}, index) => deepStrictEqual(obligations.filter(({ status = '' } = {}) => status === 'contradiction')
        .map(({ location: { range: [start = 0, end = 0] = [] } = {} } = {}) => source.slice(start, end)), expected.at(index)));
    const engine = new ESLint({ overrideConfigFile: true, overrideConfig: [{
        plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' }
    }] });
    const [{ messages = [] } = {}] = await engine.lintText(source);
    const lines = source.split('\n');

    deepStrictEqual(messages.map(({ line = 0, column = 0, endColumn = 0 } = {}) => lines.at(line - 1).slice(column - 1, endColumn - 1)), expected.flat());
});

test('callable correspondence respects nested scopes, switch ownership and capture boundaries', () => {
    const source = `const label = (value = "") => value;
{ const outer = label; const label = (value = 0) => value; outer(42); label(42); }
{ const alias = label; { const label = (value = 0) => value; alias(42); label(42); } }
switch (label(42)) { default: const label = (value = 0) => value; label(42); }
try {} catch (label) { label(42); }
const later = () => { const alias = label; alias(42); };
const local = () => { const value = (item = "") => item, alias = value; alias(42); };
label(42);`;
    const analysis = createAnalysis({ source });
    const { calls = [], callSignatures = [] } = analysis;

    deepStrictEqual(calls.map(({ index = -1 } = {}) => analysis.checkCall({ index }).status), [
        'unknown', 'agreement', 'contradiction', 'agreement', 'contradiction', 'agreement',
        'unknown', 'contradiction', 'contradiction', 'contradiction'
    ]);
    strictEqual(callSignatures.length, 7, 'Each source function owns one signature, including functions reached through values');
});

test('omitted defaults share evidence across calls and result production cannot corrupt retained judgments', () => {
    const count = 128;
    const source = `const label = ({ value = "" } = {}) => value;
        ${Array.from({ length: count }, () => 'label();').join('\n')}`;
    const analysis = createAnalysis({ source });
    const work = counter();
    const first = analysis.checkCall({ index: 0, onWork: event => work.onWork(event) });
    const established = work.get('establishment');
    const { calls = [], callSignatures = [] } = analysis;

    strictEqual(callSignatures.length, 1);
    strictEqual(established, 3, 'The shared absent field and the demanded body record family/field are cold');
    calls.forEach(({ index = -1 } = {}) => {
        const result = analysis.checkCall({ index, onWork: event => work.onWork(event) });
        const { status = '' } = result;

        strictEqual(status, 'agreement');
        strictEqual(result.obligations.at(1).facts.at(0), first.obligations.at(1).facts.at(0));
        ok(Object.isFrozen(result.obligations.at(1).facts.at(0).presence));
    });
    strictEqual(work.get('establishment'), established + 2 * (count - 1), 'Each actual call owns its evaluated default record; the signature default remains shared');
    deepStrictEqual(first.obligations.at(1).facts.at(0).presence, ['absent']);
});

test('reusing the same ESLint SourceCode resets shared evidence in either consumer order', () => {
    const source = 'const label = ({ value = "" } = {}) => value; label({ value: 42 });';
    const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true, tokens: true, comment: true });
    const sourceCode = new SourceCode(source, program);
    const engine = new Linter();
    const { body = [] } = program;
    const { expression: { arguments: [{ properties: [{ value = {} } = {}] = [] } = {}] = [] } = {} } = body.at(1);
    const names = ['signature-contract-call-site', 'signature-contract-destructuring'];

    [names, names.toReversed()].forEach((order) => {
        const config = { plugins: { resilient: plugin }, rules: Object.fromEntries(order.map(name => [`resilient/${name}`, 'error'])) };

        Object.defineProperty(value, 'value', { value: 42 });
        strictEqual(engine.verify(sourceCode, config).length, 1);
        Object.defineProperty(value, 'value', { value: 'changed' });
        deepStrictEqual(engine.verify(sourceCode, config), []);
    });
});

test('intrinsic undefined and inert void select authored defaults without validating other supplied values', () => {
    ['undefined', 'void 0'].forEach((value) => {
        deepStrictEqual(statuses(`const label = (value = "") => value; label(${value}); label(external); label(42);`), ['agreement', 'unknown', 'contradiction']);
        deepStrictEqual(statuses(`const label = (value = "") => value; const use = undefined => label(undefined);`), ['unknown']);
        // The same owned argument evaluation recognizes intrinsic undefined inside a record.
        deepStrictEqual(statuses(`const label = ({ value = "" } = {}) => value; label({ value: ${value} });`), ['agreement']);
    });
});
