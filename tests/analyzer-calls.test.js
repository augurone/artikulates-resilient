import { deepStrictEqual, strictEqual, ok, throws, rejects } from 'node:assert/strict';
import test from 'node:test';

import { ESLint } from 'eslint';
import { parse } from 'espree';

import { isCurrent } from 'eslint-plugin-resilient/agreement';
import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

const selected = ({ calls = [] } = {}, name = 'label') => calls.filter(({ callee = '' } = {}) => callee === name);
const answers = (source, name = 'label') => {
    const analysis = createAnalysis({ source });

    return selected(analysis, name).map(({ index = -1 } = {}) => analysis.checkCall({ index }).status);
};
const signature = 'const label = ({ title = "" } = {}) => title;';

[
    ['authored defaults and known values', `${signature} label({ title: "Ready" }); label({ title: 42 }); label(external); label({}); label();`,
        ['agreement', 'contradiction', 'unknown', 'agreement', 'agreement']],
    ['null contradicts while intrinsic undefined selects the root default', `${signature} label(null); label({ title: null }); label(undefined); label({ title: undefined });`,
        ['contradiction', 'contradiction', 'agreement', 'agreement']],
    ['independent fields retain a contradiction', 'const label = ({ title = "", count = 0 } = {}) => title; label({ title: external, count: "wrong" });', ['contradiction']],
    ['independent parameters retain a contradiction', 'const label = (title = "", count = 0) => title; label(external, "wrong"); label(42, external);', ['contradiction', 'contradiction']],
    ['ordinary function expression', 'const label = function (title = "") { return title; }; label(42);', ['contradiction']],
    ['primitive alias and multiple arguments', 'const label = (title = "", count = 0) => title; const text = "ready"; const alias = text; label(alias, 0); label(alias, "wrong");',
        ['agreement', 'contradiction']],
    ['bound records retain fields until exposure', `${signature} const value = { title: 42 }; const alias = value; label(alias);`, ['contradiction']],
    ['writers preserve value uncertainty', `${signature} label({ title: 42, ...external }); label({ ...external, title: 42 }); label({ title: 42, title: "ready" });`,
        ['unknown', 'contradiction', 'agreement']],
    ['known computed writer', `${signature} label({ ["title"]: 42 }); label({ [key]: 42 });`, ['contradiction', 'unknown']],
    ['accessors and prototypes supply no property proof', `${signature} label({ get title() { return 42; } }); label({ __proto__: external, title: 42 });`, ['unknown', 'unknown']],
    ['canonical aggregate defaults', 'const label = (items = [], data = {}) => items; label([], {}); label({}, []);', ['agreement', 'contradiction']],
    ['omitted authored default can contradict a pattern', 'const label = ({ title = "" } = []) => title; label(); label({});', ['contradiction', 'agreement']],
    ['untyped optional properties do not fabricate a family', 'const label = ({ onDone } = {}) => onDone; label({}); label({ onDone: external });', ['agreement', 'agreement']],
    ['missing and extra positions contradict the authored arity', 'const label = (title, count = 0) => title; label(); label("ready", 0, true); label("ready", "wrong", true);',
        ['contradiction', 'contradiction', 'contradiction']],
    ['zero parameters', 'const label = () => ""; label(); label(external);', ['agreement', 'contradiction']],
    ['later shadows and mutable bindings do not borrow signatures', `${signature} { label(42); const label = (title = "") => title; } { let label = (title = "") => title; label(42); }`,
        ['unknown', 'unknown']],
    ['initialized immutable callable captures retain signature identity', `${signature} const later = () => label({ title: 42 });`, ['contradiction']],
    ['stable local callable inside a function', 'const outer = () => { const label = (title = "") => title; label(42); };', ['contradiction']],
    ['read before initialization', 'label(42); const label = (title = "") => title;', ['unknown']],
    ['declarations own their authored signature', 'function label(title = "") { return title; } label(42);', ['contradiction']],
    ['async signature does not require executing the body', 'const label = async (title = "") => title; label(42);', ['contradiction']],
    ['spreads and conditional calls', `${signature} label(...external); label?.({ title: 42 });`, ['unknown', 'unknown']],
    ['nested patterns retain known obligations', 'const label = ({ config: { title = "" } = {} } = {}) => title; label({ config: { title: 42 } });', ['contradiction']],
    ['computed patterns supply no static field identity', 'const label = ({ [key]: title = "" } = {}) => title; label({ title: 42 });', ['unknown']],
    ['rest preserves fixed parameter obligations', 'const label = (title = "", ...rest) => title; label(42);', ['contradiction']],
    ['nonliteral defaults are not executed or treated as contracts', 'const label = (title = explode()) => title; label(42);', ['unknown']],
    ['unsupported root default does not erase supplied fields', 'const label = ({ title = "" } = { title: "ready" }) => title; label({ title: 42 });', ['contradiction']],
    ['returned functions retain their authored signature', 'const make = () => (title = "") => title; const label = make(); label(42);', ['contradiction']]
].forEach(([name = '', source = '', expected = []] = []) => test(`call agreement: ${name}`, () => deepStrictEqual(answers(source), expected)));

test('callable aliases share one acquired signature across many calls and repeated demand', () => {
    const size = 2000;
    const source = ['const f0 = (value = "") => value;', ...Array.from({ length: size }, (_, index) => `const f${index + 1} = f${index};`),
        ...Array.from({ length: 100 }, () => `f${size}(42);`)].join('\n');
    const analysis = createAnalysis({ source });
    const { calls = [], callSignatures = [], counts: { signatures = 0, signatureParameters = 0 } = {} } = analysis;
    const work = counter();
    const first = analysis.checkCall({ index: 0, onWork: event => work.onWork(event) });
    const repeated = analysis.checkCall({ index: 0, onWork: event => work.onWork(event) });
    const { status = '' } = first;

    strictEqual(signatures, 1);
    strictEqual(signatureParameters, 1);
    strictEqual(callSignatures.length, 1);
    calls.forEach(({ signature: index = -1 } = {}) => strictEqual(index, 0));
    strictEqual(status, 'contradiction');
    strictEqual(first.obligations.at(0).facts.at(0), repeated.obligations.at(0).facts.at(0));
    strictEqual(work.get('establishment'), 1);
});

test('wide call fields use one writer index and reuse facts without copying signature requirements per call', () => {
    const size = 1000;
    const pattern = Array.from({ length: size }, (_, index) => `p${index} = ""`).join(',');
    const value = Array.from({ length: size }, (_, index) => `p${index}: "ready"`).join(',');
    const analysis = createAnalysis({ source: `const label = ({ ${pattern} } = {}) => ""; label({ ${value} });` });
    const work = counter();
    const first = analysis.checkCall({ index: 0, onWork: event => work.onWork(event) });
    const established = work.get('establishment');
    const repeated = analysis.checkCall({ index: 0, onWork: event => work.onWork(event) });
    const { status = '' } = first;

    strictEqual(status, 'agreement');
    strictEqual(first.obligations.length, size + 1);
    strictEqual(established, size * 2 + 1);
    strictEqual(work.get('field-index-entry'), 0, 'Evaluated records already own their writer index; queries do not rescan source syntax');
    strictEqual(work.get('establishment'), established);
    strictEqual(first.obligations.at(1).facts.at(-1), repeated.obligations.at(1).facts.at(-1));
});

test('call signatures, arguments and locations are owned before return and expose no registered handles', () => {
    const source = `${signature}\nlabel({ title: 42 });`;
    const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
    const pristine = structuredClone(program);
    const analysis = createProgramAnalysis({ program });
    const { body = [] } = program;
    const { declarations: [{ init = {} } = {}] = [] } = body.at(0);
    const { expression: { arguments: [argument = {}] = [] } = {} } = body.at(1);
    const { properties: [{ value = {} } = {}] = [] } = argument;

    deepStrictEqual(structuredClone(program), pristine);
    Object.defineProperty(init, 'params', { value: [] });
    Object.defineProperty(value, 'value', { value: 'changed' });
    const first = analysis.checkCall({ index: 0 });
    const { obligations = [], status = '' } = first;
    const { calls = [], callSignatures = [] } = analysis;

    strictEqual(status, 'contradiction');
    strictEqual(createProgramAnalysis({ program }).checkCall({ index: 0 }).obligations.at(0).kind, 'arity');
    strictEqual(isCurrent(first), false);
    [calls, calls.at(0), callSignatures, callSignatures.at(0), first, obligations, ...obligations].forEach(value => ok(Object.isFrozen(value)));
    obligations.flatMap(({ facts = [] } = {}) => facts).forEach((fact) => {
        ok(Object.isFrozen(fact));
        ok(!Object.hasOwn(fact, 'owner'));
        ok(!Object.hasOwn(fact, 'premises'));
    });
    [-1, 1, '0', NaN].forEach(index => throws(() => analysis.checkCall({ index }), RangeError));
    const failure = new Error('call observer failed');

    throws(() => analysis.checkCall({ index: 0, onWork: () => { throw failure; } }), error => error === failure);
});

const lint = new ESLint({ overrideConfigFile: true, overrideConfig: [{
    plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' }
}] });

test('call-site lint preserves the established wording and exact supplied-value spans', async () => {
    const source = `${signature}\nlabel({ title: 42 });\nlabel(null);\nlabel(external);`;
    const [{ messages = [] } = {}] = await lint.lintText(source);

    deepStrictEqual(messages.map(({ ruleId = '', messageId = '', message = '', line = 0, column = 0, endColumn = 0 } = {}) => ({
        ruleId, messageId, message, line, column, endColumn
    })), [
        { ruleId: 'resilient/signature-contract-call-site', messageId: 'mismatch', message: 'title expects string-like, but this call supplies number-like.', line: 2, column: 16, endColumn: 18 },
        { ruleId: 'resilient/signature-contract-call-site', messageId: 'mismatch', message: 'argument expects object-like, but this call supplies null.', line: 3, column: 7, endColumn: 11 }
    ]);
});

test('call-site lint consumes the exact host AST and source acquisition failures propagate', async () => {
    const engine = new ESLint({ overrideConfigFile: true, overrideConfig: [{
        plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' },
        languageOptions: { parser: { parseForESLint(source, options) { return { ast: parse(source.replace('xx', '42'), options) }; } } }
    }] });
    const [{ messages = [] } = {}] = await engine.lintText('const label = (title = "") => title; label(xx);');

    strictEqual(messages.length, 1);
    strictEqual(messages.at(0).message, 'argument expects string-like, but this call supplies number-like.');
    const failure = new Error('call source failed');
    const injector = { rules: { fail: { create() { return { 'Program:exit'({ body = [] } = {}) {
        const { expression: { arguments: [argument = {}] = [] } = {} } = body.at(1);

        Object.defineProperty(argument, 'properties', { get() { throw failure; } });
    } }; } } } };
    const failing = new ESLint({ overrideConfigFile: true, overrideConfig: [{
        plugins: { injector, resilient: plugin }, rules: { 'injector/fail': 'error', 'resilient/signature-contract-call-site': 'error' }
    }] });

    await rejects(failing.lintText(`${signature} label({ title: 42 });`), error => error === failure);
});
