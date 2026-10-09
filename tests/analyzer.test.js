import { deepStrictEqual, strictEqual, throws, ok } from 'node:assert/strict';
import test from 'node:test';

import { parse } from 'espree';

import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';

import { counter } from './support/work.js';

const outcomes = (source, options = {}) => {
    const analysis = createAnalysis({ ...options, source });
    const { receivers = [] } = analysis;

    return receivers.map(({ index = -1 } = {}) => {
        const { status = '' } = analysis.check({ index });

        return status;
    });
};

[
    ['const families and aliases', 'const a = []; const b = a; b.trim(); a.map(Boolean); const text = ""; text.trim();', ['contradiction', 'agreement', 'agreement']],
    ['block shadows and restored siblings', 'const x = []; { const x = ""; x.trim(); } { x.trim(); } x.map(Boolean);', ['agreement', 'contradiction', 'agreement']],
    ['later shadow blocks outer evidence', 'const x = []; { x.trim(); const x = ""; x.trim(); }', ['unknown', 'agreement']],
    ['initialization order within one declaration', 'const a = b, b = []; a.trim(); b.trim();', ['unknown', 'contradiction']],
    ['self reference does not fabricate initialization', 'const a = a; a.trim();', ['unknown']],
    ['same-list earlier initializer', 'const a = [], b = a, c = b; c.trim();', ['contradiction']],
    ['changing bindings', 'let x = []; x.trim(); x = ""; x.trim(); var y = []; y.trim();', ['unknown', 'unknown', 'unknown']],
    ['destructured defaults are not runtime validation', 'const {x = []} = external; x.trim(); const [y = ""] = external; y.map(Boolean);', ['unknown', 'unknown']],
    ['imports remain unknown', 'import {x} from "external"; const y = x; y.trim();', ['unknown']],
    ['function-local ownership and captured uncertainty',
        'const x = []; const f = (x = []) => { x.trim(); const y = []; y.trim(); }; const g = () => x.trim();', ['unknown', 'contradiction', 'unknown']],
    ['pattern parameters shadow all their bound names', 'const x = []; const f = ({a: x = "", ...rest}, [y]) => { x.trim(); rest.map(Boolean); y.trim(); };', ['unknown', 'unknown', 'unknown']],
    ['named functions own their names', 'const x = []; const f = function x() { x.trim(); };', ['contradiction']],
    ['function and class declarations block outer evidence', 'const x = []; { x.trim(); function x() {} } { x.trim(); class x {} }', ['contradiction', 'unknown']],
    ['catch parameter and outer scope', 'const x = []; try { x.trim(); } catch (x) { x.trim(); } x.trim();', ['contradiction', 'unknown', 'contradiction']],
    ['catch patterns bind aliases and rest', 'const x = []; try {} catch ({message: x, ...rest}) { x.trim(); rest.map(Boolean); }', ['unknown', 'unknown']],
    ['for-of right-hand side owns its TDZ', 'const x = []; for (const x of x.trim()) { x.trim(); } x.trim();', ['unknown', 'unknown', 'contradiction']],
    ['for initializer and loop scope', 'const x = []; for (const x = ""; enabled;) { x.trim(); } x.trim();', ['agreement', 'contradiction']],
    ['switch discriminant has outer ownership', 'const x = []; switch (x.trim()) { case 0: const x = ""; x.trim(); }', ['contradiction', 'agreement']],
    ['switch cases share declarations', 'const x = []; switch (kind) { case 0: x.trim(); break; case 1: const x = ""; x.trim(); }', ['unknown', 'agreement']],
    ['unknown expressions do not borrow requirements',
        'external.trim(); getValue().trim(); (enabled ? [] : external).trim(); const x = getValue(); x.trim();', ['unknown', 'unknown', 'contradiction', 'unknown']],
    ['literal native families', '"".trim(); [].map(Boolean); /x/.test(""); (() => 1).call(); null.trim(); (false).map(Boolean);',
        ['agreement', 'agreement', 'agreement', 'agreement', 'contradiction', 'contradiction']]
].forEach(([name = '', source = '', expected = []] = []) => {
    test(`source ownership: ${name}`, () => deepStrictEqual(outcomes(source), expected));
});

test('only static named receivers are indexed, with optional execution made explicit', () => {
    const source = 'const x = []; x?.trim(); x.trim?.(); x["trim"](); x[method](); x.custom();';
    const analysis = createAnalysis({ source });
    const { receivers = [] } = analysis;

    strictEqual(receivers.length, 2);
    receivers.forEach(({ index = -1, conditional = false, location: { range = [] } = {} } = {}) => {
        const [start = 0, end = 0] = range;

        strictEqual(conditional, true);
        strictEqual(source.slice(start, end), 'x');
        strictEqual(analysis.check({ index }).status, 'contradiction');
    });
});

test('native-family questions do not claim authored method identity or emit diagnostics', () => {
    const analysis = createAnalysis({ source: 'const api = {trim: () => ""}; api.trim();' });
    const { status = '', consumer = '' } = analysis.check({ index: 0 });

    strictEqual(status, 'contradiction');
    ok(consumer.includes('assuming native trim'));
    strictEqual(Object.hasOwn(analysis, 'diagnostics'), false);
});

test('opaque syntax cannot leak its names or speculative checks', () => {
    deepStrictEqual(outcomes('const x = []; with (external) { x.trim(); } x.trim();', { sourceType: 'script' }), ['contradiction']);
    deepStrictEqual(outcomes('const f = (x = [].trim()) => { const y = []; y.trim(); }; class C { method() { [].trim(); } }'), ['contradiction']);
});

test('repeated consumers share facts and unused bindings stay uninferred', () => {
    const analysis = createAnalysis({ source: 'const x = []; const alias = x; const unused = {}; alias.trim(); alias.map(Boolean);' });
    const first = counter();
    const second = counter();
    const { status: a = '', fact: aFact = false } = analysis.check({ index: 0, onWork: event => first.onWork(event) });
    const { status: b = '', fact: bFact = false } = analysis.check({ index: 1, onWork: event => second.onWork(event) });

    strictEqual(a, 'contradiction');
    strictEqual(b, 'agreement');
    strictEqual(aFact, bFact);
    strictEqual(first.get('establishment'), 1);
    strictEqual(second.get('establishment'), 0);
    strictEqual(analysis.check({ index: 0 }).fact, aFact);
});

test('sessions and public descriptors are isolated, immutable source snapshots', () => {
    const before = createAnalysis({ source: 'const x = []; x.trim();' });
    const after = createAnalysis({ source: 'const x = ""; x.trim();' });
    const prior = before.check({ index: 0 });
    const { receivers = [], counts = {} } = before;
    const [{ location = {} } = {}] = receivers;
    const { range = [] } = location;

    [before, receivers, receivers.at(0), counts, location, range].forEach(value => ok(Object.isFrozen(value)));
    strictEqual(after.check({ index: 0 }).status, 'agreement');
    const { status = '' } = prior;

    strictEqual(status, 'contradiction');
    strictEqual(before.check({ index: 0 }).status, 'contradiction');
});

test('family-only views cannot expose registered owners or broader projected evidence', () => {
    const analysis = createAnalysis({ source: 'const x = []; const alias = x; alias.trim();' });
    const result = analysis.check({ index: 0 });
    const { fact = {}, status = '' } = result;
    const { families = [] } = fact;

    deepStrictEqual(Object.keys(result), ['status', 'consumer', 'fact']);
    deepStrictEqual(Object.keys(fact), ['facet', 'state', 'reason', 'families', 'incomplete', 'causes', 'causesTruncated']);
    [result, fact, families].forEach(value => ok(Object.isFrozen(value)));
    strictEqual(status, 'contradiction');
    strictEqual(analysis.check({ index: 0 }).fact, fact);
});

test('syntax errors, invalid queries, and observer failures remain operational failures', () => {
    throws(() => createAnalysis({ source: 'const =' }), SyntaxError);
    throws(() => createAnalysis({ source: 42 }), /source text/);
    throws(() => createAnalysis({ sourceType: 'guess' }), /module or script/);
    throws(() => createAnalysis().check({ index: 0 }), RangeError);

    const analysis = createAnalysis({ source: '[].trim();' });

    [-1, 1, 0.5, NaN, '0'].forEach(index => throws(() => analysis.check({ index }), RangeError));
    throws(() => analysis.check(), RangeError);
    throws(() => analysis.check({ index: 0, onWork: () => { throw new Error('observer failed'); } }), /observer failed/);
    strictEqual(analysis.check({ index: 0 }).status, 'contradiction');
});

test('source analysis never executes imports, getters, calls, or default expressions', () => {
    const source = 'import x from "does-not-exist"; const y = runSideEffect(); const z = {get trim() { throw new Error(); }}; x.trim(); y.trim(); z.trim();';

    deepStrictEqual(outcomes(source), ['unknown', 'unknown', 'contradiction']);
});

test('an existing parser tree feeds the same analyzer without being retained as mutable evidence', () => {
    const program = parse('const x = ""; x.trim();', { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
    const pristine = structuredClone(program);
    const analysis = createProgramAnalysis({ program });
    const { body: [{ declarations: [{ init = {} } = {}] = [] } = {}] = [] } = program;

    deepStrictEqual(structuredClone(program), pristine, 'Analysis must not mutate the parser tree');
    Object.defineProperty(init, 'value', { value: 42 });
    strictEqual(analysis.check({ index: 0 }).status, 'agreement');
    strictEqual(createProgramAnalysis({ program }).check({ index: 0 }).status, 'contradiction');
});

test('missing source positions cannot invent initialization order', () => {
    const program = parse('const x = []; x.trim(); [].trim();', { ecmaVersion: 'latest', sourceType: 'module' });
    const analysis = createProgramAnalysis({ program });
    const { receivers: [{ location = {} } = {}] = [] } = analysis;

    strictEqual(analysis.check({ index: 0 }).status, 'unknown');
    strictEqual(analysis.check({ index: 1 }).status, 'contradiction');
    deepStrictEqual(location, { range: [], line: 0, column: 0 });
});

test('host-owned parent metadata does not become syntax traversal or retained evidence', () => {
    const program = parse('const x = []; x.trim();', { ecmaVersion: 'latest', sourceType: 'module', range: true });
    const { body: [declaration = {}] = [] } = program;
    const { declarations: [binding = {}] = [] } = declaration;
    const { init = {} } = binding;

    Object.defineProperty(init, 'parent', { value: binding, enumerable: true });
    Object.defineProperty(binding, 'parent', { value: declaration, enumerable: true });
    Object.defineProperty(declaration, 'parent', { value: program, enumerable: true });
    strictEqual(createProgramAnalysis({ program }).check({ index: 0 }).status, 'contradiction');
});

test('parsed-program entry rejects missing and non-program roots', () => {
    throws(() => createProgramAnalysis(), /ESTree Program/);
    [false, 1, [], {}, { type: 'Program' }, { type: 'Literal', value: 1 }].forEach((program) => {
        throws(() => createProgramAnalysis({ program }), /ESTree Program/);
    });
});

test('long aliases retain linear establishment and warm reuse', () => {
    const size = 10000;
    const source = ['const x0 = [];', ...Array.from({ length: size }, (_, index) => `const x${index + 1} = x${index};`), `x${size}.trim();`].join('\n');
    const analysis = createAnalysis({ source });
    const { counts: { bindings = 0, reads = 0 } = {} } = analysis;
    const work = counter();
    const { status = '', fact = false } = analysis.check({ index: 0, onWork: event => work.onWork(event) });

    strictEqual(status, 'contradiction');
    strictEqual(bindings, size + 1);
    strictEqual(reads, size + 1);
    strictEqual(work.get('establishment'), 1);
    const demanded = work.get('value-demand');

    strictEqual(demanded, 0, 'Immutable aliases share the acquired source owner without repeated value evaluation');
    strictEqual(analysis.check({ index: 0, onWork: event => work.onWork(event) }).fact, fact);
    strictEqual(work.get('establishment'), 1);
    strictEqual(work.get('value-demand'), demanded);
});

test('nested scopes restore one shared outer binding without depth-dependent name search', () => {
    const depth = 400;
    const source = `const x = []; ${'{ x.trim();'.repeat(depth)} ${'}'.repeat(depth)} x.trim();`;
    const analysis = createAnalysis({ source });
    const { receivers = [], counts: { scopes = 0, reads = 0 } = {} } = analysis;
    const work = counter();

    strictEqual(scopes, depth + 1);
    strictEqual(reads, depth + 1);
    receivers.forEach(({ index = -1 } = {}) => strictEqual(analysis.check({ index, onWork: event => work.onWork(event) }).status, 'contradiction'));
    strictEqual(work.get('establishment'), 1);
});

test('destructuring and receiver questions share one private family fact', () => {
    const analysis = createAnalysis({ source: 'const value = []; const alias = value; const { item } = alias; alias.trim();' });
    const work = counter();
    const first = analysis.checkDestructuring({ index: 0, onWork: event => work.onWork(event) });
    const second = analysis.check({ index: 0, onWork: event => work.onWork(event) });
    const { destructurings = [] } = analysis;
    const { status = '', fact = {} } = first;
    const { fact: receiverFact = {} } = second;

    strictEqual(status, 'contradiction');
    strictEqual(fact, receiverFact);
    strictEqual(work.get('establishment'), 1);
    strictEqual(analysis.checkDestructuring({ index: 0 }).fact, fact);
    [destructurings, destructurings.at(0)].forEach(value => ok(Object.isFrozen(value)));
    deepStrictEqual(Object.keys(fact), ['facet', 'state', 'reason', 'families', 'incomplete', 'causes', 'causesTruncated']);
    [-1, 1, NaN, '0'].forEach(index => throws(() => analysis.checkDestructuring({ index }), RangeError));
    throws(() => analysis.checkDestructuring({ index: 0, onWork: () => { throw new Error('observer failed'); } }), /observer failed/);
});

test('declarations, assignments and receivers reuse one source-owned alias fact', () => {
    const source = 'const value = []; const alias = value; const [declared] = alias; let assigned; ({ item: assigned } = alias); [assigned] = alias; alias.trim();';
    const analysis = createAnalysis({ source });
    const { destructurings = [], counts: { bindings = 0 } = {} } = analysis;
    const work = counter();
    const judgments = destructurings.map(({ index = -1 } = {}) => analysis.checkDestructuring({ index, onWork: event => work.onWork(event) }));
    const { fact = false } = analysis.check({ index: 0, onWork: event => work.onWork(event) });

    deepStrictEqual(judgments.map(({ status = '' } = {}) => status), ['agreement', 'contradiction', 'agreement']);
    judgments.forEach(({ fact: current = false } = {}) => strictEqual(current, fact));
    strictEqual(bindings, 4, 'Assignment targets must not create declarations');
    strictEqual(work.get('establishment'), 1);
    destructurings.forEach(({ index = -1 } = {}) => strictEqual(analysis.checkDestructuring({ index, onWork: event => work.onWork(event) }).fact, fact));
    strictEqual(work.get('establishment'), 1);
});

test('assignment keys and targets cannot shadow the source binding or establish its destination', () => {
    const source = 'const value = []; let assigned; ({ value: assigned } = external); const { item } = value; assigned.trim();';
    const analysis = createAnalysis({ source });
    const { destructurings = [], counts: { bindings = 0 } = {} } = analysis;

    deepStrictEqual(destructurings.map(({ index = -1 } = {}) => analysis.checkDestructuring({ index }).status), ['unknown', 'contradiction']);
    strictEqual(bindings, 3);
    strictEqual(analysis.check({ index: 0 }).status, 'unknown');
});

test('assignment source snapshots retain their own evidence and exact multiline locations', () => {
    const source = 'let item;\n({ item } =\n []);';
    const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
    const pristine = structuredClone(program);
    const analysis = createProgramAnalysis({ program });
    const { destructurings: [{ location = {} } = {}] = [] } = analysis;
    const { body: [ , { expression: { right = {} } = {} } = {}] = [] } = program;
    const start = source.indexOf('[]');

    deepStrictEqual(structuredClone(program), pristine);
    deepStrictEqual(location, { range: [start, start + 2], line: 3, column: 2 });
    Object.defineProperties(right, { type: { value: 'ObjectExpression' }, properties: { value: [] } });
    strictEqual(analysis.checkDestructuring({ index: 0 }).status, 'contradiction');
    strictEqual(createProgramAnalysis({ program }).checkDestructuring({ index: 0 }).status, 'agreement');
});

test('assignment selection preserves excluded execution boundaries and ignores ordinary writes', () => {
    const source = 'let item; item = []; item ||= {}; const read = (value = ({ item } = [])) => item; class Model { read() { ({ item } = []); } }';
    const { destructurings = [] } = createAnalysis({ source });

    deepStrictEqual(destructurings, []);
    deepStrictEqual(createAnalysis({ source: 'with (external) { ({ item } = []); }', sourceType: 'script' }).destructurings, []);
});
