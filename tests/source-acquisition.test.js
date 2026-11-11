import { deepStrictEqual, strictEqual, throws, ok } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter, ESLint } from 'eslint';
import { parse } from 'espree';

import { all, createOwner, field, fromESTree, isCurrent, receiver, replaceEvidence, request, unresolved } from 'eslint-plugin-resilient/agreement';
import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

// Snapshot acquisition, source identity, linear shared headers and bounded traversal form one public acquisition boundary.

{
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
        ['pattern parameters shadow all their bound names', 'const x = []; const f = ({a: x = "", ...rest}, [y]) => { x.trim(); rest.map(Boolean); y.trim(); };',
            ['unknown', 'contradiction', 'unknown']],
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

    test('opaque syntax stays isolated while admitted scalar defaults retain their own checks', () => {
        deepStrictEqual(outcomes('const x = []; with (external) { x.trim(); } x.trim();', { sourceType: 'script' }), ['contradiction']);
        deepStrictEqual(outcomes('const f = (x = [].trim()) => { const y = []; y.trim(); }; class C { method() { [].trim(); } }'), ['contradiction', 'contradiction']);
        deepStrictEqual(outcomes('class C { method() { [].trim(); } }'), []);
    });

    test('local catch-pattern uncertainty preserves independent returns across query order, interruption and source replacement', () => {
        const source = 'const read=(flag,other)=>{if(flag)return [];if(other)return 42;try{return external();}catch({message=""}){return message;}};'
            + 'const total=42;total.trim();read(external,external);read(true,false);';
        const reference = createAnalysis({ source });
        const { calls = [] } = reference;
        const reads = calls.filter(({ callee = '' } = {}) => callee === 'read');
        const general = reads.at(0);
        const closed = reads.at(1);
        const work = counter();
        const expected = reference.checkCallResult({ ...general, required: 'string', onWork: event => work.onWork(event) });
        const { status = '', fact: { families = [], incomplete = false } = {} } = expected;

        strictEqual(status, 'contradiction');
        deepStrictEqual(families.toSorted(), ['array', 'number']);
        strictEqual(incomplete, true, 'Unsupported catch entry supplies no guessed leaf/default family');
        strictEqual(reference.check({ index: 0 }).status, 'contradiction');
        const actual = reference.checkCallResult({ ...closed, required: 'string' });
        const { fact: { families: selected = [], incomplete: partial = true } = {} } = actual;

        deepStrictEqual(selected, ['array']);
        strictEqual(partial, false, 'An unreached catch cannot make an independent actual return unknown');
        const stages = work.read();

        Object.keys(stages).forEach((stage) => {
            const analysis = createAnalysis({ source });

            throws(() => analysis.checkCallResult({ ...general, required: 'string', onWork: ({ kind = '' } = {}) => {
                if (kind === stage) throw new Error(`interrupt ${stage}`);
            } }), new RegExp(`interrupt ${stage}`, 'u'));
            deepStrictEqual(analysis.checkCallResult({ ...closed, required: 'string' }), actual, stage);
            analysis.checkFunction({ index: 0 });
            deepStrictEqual(analysis.checkCallResult({ ...general, required: 'string' }), expected, stage);
        });
        const reordered = createAnalysis({ source });

        reordered.checkFunction({ index: 0 });
        reordered.check({ index: 0 });
        deepStrictEqual(reordered.checkCallResult({ ...general, required: 'string' }), expected);
        const observed = work.read();

        strictEqual(reference.checkCallResult({ ...general, required: 'array', onWork: event => work.onWork(event) }).status, 'contradiction');
        deepStrictEqual(reference.checkCallResult({ ...general, required: 'string', onWork: event => work.onWork(event) }), expected);
        ['value-demand', 'function-context', 'flow-contribution', 'flow-projection', 'value-selection', 'value-ownership', 'establishment']
            .forEach(kind => strictEqual(work.get(kind), Reflect.get(observed, kind) || 0));
        const replacement = createAnalysis({ source: source.replace('total=42', 'total=""') });

        strictEqual(replacement.check({ index: 0 }).status, 'agreement');
        strictEqual(reference.check({ index: 0 }).status, 'contradiction', 'The original snapshot remains historical');
    });

    test('local argument ownership survives query order, interruption and source revision', () => {
        const source = 'const read=()=>{const own=function(value){return arguments[0];};return external?own(42):42;};read().trim();';
        const reference = createAnalysis({ source });
        const work = counter();
        const expected = reference.check({ index: 0, onWork: event => work.onWork(event) });
        const { status = '', fact: { families = [], incomplete = false } = {} } = expected;

        strictEqual(status, 'contradiction');
        deepStrictEqual(families, ['number']);
        strictEqual(incomplete, true, 'The unknown argument result cannot validate or erase the independent numeric alternative');
        const observed = work.read();

        Object.keys(observed).forEach((stage) => {
            const analysis = createAnalysis({ source });

            throws(() => analysis.check({ index: 0, onWork: ({ kind = '' } = {}) => {
                if (kind === stage) throw new Error(`interrupt ${stage}`);
            } }), new RegExp(`interrupt ${stage}`, 'u'));
            analysis.functions.forEach(({ index = -1 } = {}) => analysis.checkFunction({ index }));
            deepStrictEqual(analysis.check({ index: 0 }), expected, stage);
        });
        deepStrictEqual(reference.check({ index: 0, onWork: event => work.onWork(event) }), expected);
        ['value-demand', 'function-context', 'flow-contribution', 'flow-projection', 'value-selection', 'value-ownership', 'establishment']
            .forEach(kind => strictEqual(work.get(kind), Reflect.get(observed, kind) || 0));
        const revised = createAnalysis({ source: source.replace(':42;', ':"ready";') });

        strictEqual(revised.check({ index: 0 }).status, 'unknown', 'Only the unresolved argument result remains beside a compatible string');
        deepStrictEqual(reference.check({ index: 0 }), expected, 'The original snapshot remains historical');
    });

    test('deferred local opacity keeps acquisition bounded and independent facts reusable', () => {
        [
            ['catch patterns', '()=>', 'try{return external();}catch({value=()=>1}){return value;}'],
            ['own arguments', 'function()', 'return arguments[0];']
        ].flatMap(([name = '', syntax = '', leaf = ''] = []) => ['wide', 'deep'].map(shape => ({ name, syntax, leaf, shape })))
            .forEach(({ name = '', syntax = '', leaf = '', shape = '' } = {}) => {
                const samples = [8, 16, 32].map((size) => {
                    const functions = shape === 'wide'
                        ? Array.from({ length: size }, (unused, index) => `const f${index}=${syntax}{${leaf}};`).join('')
                        : Array.from({ length: size }).reduce((body, unused, index) => `const f${index}=${syntax}{${body}return f${index ? index - 1 : 0};};`, leaf);
                    const analysis = createAnalysis({ source: `const count=42;${functions}count.trim();` });
                    const work = counter();
                    const result = analysis.check({ index: 0, onWork: event => work.onWork(event) });

                    const { status = '' } = result;

                    strictEqual(status, 'contradiction', 'Uncalled locally opaque scopes cannot withdraw this independent numeric source');
                    ok(work.get('function-context') <= 1, 'Reading the independent source cannot invoke deferred defaults or readers');
                    const { counts = {} } = analysis;
                    const observed = work.read();

                    deepStrictEqual(analysis.check({ index: 0, onWork: event => work.onWork(event) }), result);
                    const { counts: repeated = {} } = analysis;

                    deepStrictEqual(repeated, counts);
                    ['value-demand', 'function-context', 'flow-contribution', 'flow-projection', 'value-selection', 'value-ownership', 'establishment']
                        .forEach(kind => strictEqual(work.get(kind), Reflect.get(observed, kind) || 0));

                    return counts;
                });

                ['nodes', 'scopes', 'bindings', 'completionContributions'].forEach((kind) => {
                    const [first = {}, second = {}, third = {}] = samples;

                    ok(Reflect.get(third, kind) - Reflect.get(second, kind) <= 2 * (Reflect.get(second, kind) - Reflect.get(first, kind)),
                        `${name}, ${shape}: ${kind} must grow affinely with the source-owned scopes`);
                });
            });
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
}

{
    const linter = new Linter();
    const findings = source => linter.verify(source, {
        plugins: { resilient: plugin },
        rules: { 'resilient/signature-contract-property': 'error', 'resilient/signature-contract-operation': 'error' }
    });
    const fallback = 'const external=()=>({missing:1});';

    [
        ['ordinary selection', '{value=external()}', 'value'],
        ['renamed selection', '{value:chosen=external()}', 'chosen'],
        ['static computed selection', '{["value"]:chosen=external()}', 'chosen'],
        ['nested selection', '{nested:{chosen=external()}={}}', 'chosen']
    ].forEach(([name = '', pattern = '', binding = ''] = []) => test(`a captured ${name} cannot borrow its carrier's closed shape`, () => {
        const source = `${fallback}const ${pattern}={};const read=()=>${binding}.missing;read();`;

        strictEqual(runInNewContext(source), 1);
        deepStrictEqual(findings(source), []);
        const first = createAnalysis({ source });
        const second = createAnalysis({ source });
        const inspect = analysis => analysis.memberAccesses.map(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }));

        second.functions.toReversed().forEach(({ index = -1 } = {}) => second.checkFunction({ index }));
        second.calls.toReversed().forEach(({ index = -1 } = {}) => second.checkCall({ index }));
        const before = inspect(first);
        const [{ missing = false, incomplete = false, evidence = [] } = {}] = before;

        strictEqual(missing, false);
        strictEqual(incomplete, true);
        deepStrictEqual(evidence.map(({ state = '' } = {}) => state), ['unknown']);
        deepStrictEqual(inspect(second), before);
        deepStrictEqual(inspect(first), before);
    }));

    test('supported destructured primitive capture preserves its own selected family', () => {
        const source = 'const {value}={value:42};const read=()=>typeof value==="number"?[]:"";';
        const analysis = createAnalysis({ source });
        const { functions = [] } = analysis;
        const [{ index = -1 } = {}] = functions;
        const { status = '', fact: { families = [] } = {} } = analysis.checkFunction({ index });

        strictEqual(status, 'agreement');
        deepStrictEqual(families, ['array']);
    });

    [
        ['direct record', 'const checks={present:value=>!!value};', 'checks', 1],
        ['whole-record alias', 'const checks={present:value=>!!value};const alias=checks;', 'alias', 1],
        ['whole-record alias chain', 'const checks={present:value=>!!value};const alias=checks;const alias2=alias;', 'alias2', 1],
        ['member-selected primitive', 'const checks={present:value=>!!value,selected:0};const alias=checks.selected;', 'alias', 0],
        ['member-selected arrow', 'const checks={present:value=>!!value};const alias=checks.present;', 'alias', 0],
        ['destructured arrow', 'const checks={present:value=>!!value};const {present:alias}=checks;', 'alias', 0],
        ['selected alias chain', 'const checks={present:value=>!!value};const selected=checks.present;const alias=selected;', 'alias', 0],
        ['escaped record', 'const checks={present:value=>!!value};external(checks);', 'checks', 0],
        ['exported record', 'export const checks={present:value=>!!value};', 'checks', 0],
        ['written record', 'const checks={present:value=>!!value};checks.present=external;', 'checks', 0],
        ['receiver-dependent method', 'const checks={present(value){return !!value;}};', 'checks', 0],
        ['late record initialization', '', 'checks', 0]
    ].forEach(([name = '', declaration = '', receiver = '', expected = 0] = []) => test(`closed record capture retains ${name} ownership`, () => {
        const inspect = `const inspect=(value={})=>${receiver}.present(value)?value.map(Boolean):[];`;
        const source = declaration ? declaration + inspect : inspect + 'const checks={present:value=>!!value};';

        strictEqual(findings(source).length, expected);
    }));

    test('a supplied unknown value never acquires its declaration fallback', () => {
        const source = `${fallback}const {value=external()}={value:input};const read=()=>value.missing;`;

        deepStrictEqual(findings(source), []);
    });

    test('record eligibility retains duplicate-writer, accessor and prototype distinctions', () => {
        const cases = [
            ['const checks={present:0,present:value=>!!value};', 1],
            ['const checks={present:value=>!!value,present:0};', 0],
            ['const checks={present:value=>!!value,present:external};', 0],
            ['const checks={get present(){return value=>!!value;}};', 0],
            ['const checks={__proto__:external,present:value=>!!value};', 0]
        ];

        cases.forEach(([declaration = '', expected = 0] = []) => {
            const source = `${declaration}const inspect=(value={})=>checks.present(value)?value.map(Boolean):[];`;

            strictEqual(findings(source).length, expected, declaration);
        });
    });

    const countHeaders = (context, source, declarationIndex) => {
        const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
        const { body = [] } = program;
        const { declarations: [{ init: { properties = [] } = {} } = {}] = [] } = body.at(declarationIndex);
        const readKind = context.mock.fn(() => 'init');

        properties.forEach(property => Object.defineProperty(property, 'kind', { get: readKind }));
        const analysis = createProgramAnalysis({ program });
        const { destructuringFields = [] } = analysis;

        destructuringFields.forEach(({ index = -1 } = {}) => strictEqual(analysis.checkDestructuringField({ index }).status, 'agreement'));

        return readKind.mock.callCount();
    };

    [100, 200].forEach(bindings => test(`shared carrier headers are not rescanned for ${bindings} selected bindings`, (context) => {
        const properties = 128;
        const fields = Array.from({ length: properties }, (_, index) => `f${index}:${index}`).join(',');
        const pattern = Array.from({ length: bindings }, (_, index) => `f0:value${index}`).join(',');
        const reads = countHeaders(context, `const {${pattern}}={${fields}};`, 0);

        context.diagnostic(`${reads} property-kind reads`);
        ok(reads <= 32 * (properties + bindings), `${reads} property-kind reads exceeded a broad linear header/binding allowance`);
    }));

    [100, 200].forEach(properties => test(`aggregate headers are not rescanned for ${properties} stored references`, (context) => {
        const fields = Array.from({ length: properties }, (_, index) => `f${index}:shared`).join(',');
        const reads = countHeaders(context, `const shared={};const aggregate={${fields}};`, 1);

        context.diagnostic(`${reads} property-kind reads`);
        ok(reads <= 32 * properties, `${reads} property-kind reads exceeded a broad linear aggregate allowance`);
    }));
}

{
    const expression = source => parse(`(${source})`, { ecmaVersion: 'latest' }).body.at(0).expression;

    test('complete evidence acquisition and nested demand have bounded call-stack use', () => {
        const depth = 10000;
        const node = Array.from({ length: depth }).reduce(value => ({
            type: 'ObjectExpression', properties: [{
                type: 'Property', kind: 'init', computed: false, method: false, shorthand: false,
                key: { type: 'Identifier', name: 'next' }, value
            }]
        }), expression('"leaf"'));
        const required = Array.from({ length: depth }).reduce(child => field({ name: 'next', required: child }), 'string');
        const owner = createOwner({ evidence: fromESTree(node) });
        const first = request({ owner, required });
        const { status = '' } = first;

        strictEqual(status, 'agreement');
        replaceEvidence({ owner, evidence: fromESTree(expression('{}')) });
        strictEqual(isCurrent(first), false);
        strictEqual(request({ owner, required }).status, 'contradiction');
    });

    test('complete acquisition owns supported syntax without reading host metadata or unused bodies', () => {
        const node = expression('{ value: { text: "before" }, run() { return 1; } }');
        const { properties = [] } = node;
        const { value: nested = {} } = properties.at(0);
        const { value: method = {} } = properties.at(1);

        Object.defineProperty(node, 'parent', { enumerable: true, get() { throw new Error('Host metadata is not evidence'); } });
        Object.defineProperty(method, 'body', { enumerable: true, get() { throw new Error('Function bodies are not supported evidence'); } });

        const owner = createOwner({ evidence: fromESTree(node) });
        const text = field({ name: 'value', required: field({ name: 'text', required: 'string' }) });

        Object.defineProperty(nested, 'properties', { value: [] });
        strictEqual(request({ owner, required: text }).status, 'agreement');
        strictEqual(request({ owner, required: field({ name: 'run', required: 'function' }) }).status, 'agreement');
        strictEqual(request({ owner, required: field({ name: 'missing', required: all() }) }).status, 'contradiction');
    });

    test('acquisition failures in required syntax still propagate without publishing evidence', () => {
        const node = expression('{ value: 1 }');
        const failure = new Error('Required source read failed');

        Object.defineProperty(node, 'properties', { get() { throw failure; } });
        throws(() => fromESTree(node), error => error === failure);
    });

    test('public metadata cannot retain mutable caller data or coerce an operation name into evidence', () => {
        const owner = createOwner({ evidence: unresolved() });

        // eslint-disable-next-line resilient/no-null-assignment -- Malformed public metadata includes null to verify that caller data cannot manufacture an operation contract.
        [[], {}, 1, false, null].forEach((value) => {
            throws(() => unresolved({ reason: value }), TypeError);
            throws(() => request({ owner, required: 'string', consumer: value }), TypeError);
        });
        [['map'], { toString: () => 'trim' }].forEach(operation => throws(() => receiver({ operation }), TypeError));
        strictEqual(request({ owner, required: 'string', consumer: 'label' }).consumer, 'label');
    });

    test('complete acquisition reads each shared value once and preserves distinct field premises', (context) => {
        const leaf = expression('"shared"');
        const readType = context.mock.fn(() => 'Literal');
        const node = expression('{ first: 1, second: 2 }');
        const { properties = [] } = node;

        Object.defineProperty(leaf, 'type', { get: readType });
        properties.forEach(property => Object.defineProperty(property, 'value', { value: leaf }));

        const owner = createOwner({ evidence: fromESTree(node) });
        const first = field({ name: 'first', required: 'string' });
        const second = field({ name: 'second', required: 'string' });
        const judgment = request({ owner, required: all({ requirements: [first, second] }) });
        const { facts = [], status = '' } = judgment;

        strictEqual(status, 'agreement');
        strictEqual(readType.mock.callCount(), 2, 'The snapshot header and literal payload inspect one unique node');
        strictEqual(facts.filter(({ facet = '' } = {}) => facet === 'family').length, 2, 'The shared field value has one owner');
        strictEqual(facts.filter(({ facet = '' } = {}) => facet.startsWith('field:')).length, 2, 'Each named field keeps its own presence premise');
    });

    const lint = new ESLint({ overrideConfigFile: true, overrideConfig: [{
        plugins: { resilient: plugin }, rules: { 'resilient/prefer-falsey-returns': 'error' }
    }] });

    [
        ['null || "safe"', []], ['undefined ?? "safe"', []], ['void run() || "safe"', []],
        ['(ready ? null : external) ?? "safe"', []], ['value += null', []],
        ['value = null', ['null']], ['value && null', ['null']], ['value || null', ['null']],
        ['value ?? undefined', ['undefined']], ['null && value', ['null']],
        ['(ready ? null : value) || undefined', ['undefined']]
    ].forEach(([value = '', expected = []] = []) => test(`return selection preserves the operator contract: ${value}`, async () => {
        const source = `const read = () => ${value};`;
        const [{ messages = [], fatalErrorCount = 0 } = {}] = await lint.lintText(source);

        strictEqual(fatalErrorCount, 0);
        deepStrictEqual(messages.map(({ column = 0, endColumn = 0, messageId = '' } = {}) => {
            strictEqual(messageId, 'falseyReturn');

            return source.slice(column - 1, endColumn - 1);
        }), expected);
    }));

    test('explicit undefined defaults are assignments while shadowed undefined stays an ordinary binding', async () => {
        const engine = new ESLint({ overrideConfigFile: true, overrideConfig: [{
            plugins: { resilient: plugin }, rules: { 'resilient/no-undefined-assignment': 'error' }
        }] });
        const sources = [
            ['const read = (value = undefined) => value;', 1],
            ['const { value = undefined } = external;', 1],
            ['let value; [value = undefined] = external;', 1],
            ['const read = (undefined, value = undefined) => value;', 0],
            ['const undefined = "ordinary"; const { value = undefined } = external;', 0]
        ];

        await Promise.all(sources.map(async ([source = '', count = 0] = []) => {
            const [{ messages = [], fatalErrorCount = 0 } = {}] = await engine.lintText(source);

            strictEqual(fatalErrorCount, 0);
            strictEqual(messages.length, count);
            messages.forEach(({ messageId = '' } = {}) => strictEqual(messageId, 'undefinedAssignment'));
        }));
    });
}
