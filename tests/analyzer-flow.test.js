import { deepStrictEqual, strictEqual, throws, ok } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { ESLint } from 'eslint';
import { parse } from 'espree';

import { absent, createOwner, request } from 'eslint-plugin-resilient/agreement';
import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

const results = ({ source = '', required = 'string', name = 'read' } = {}) => {
    const analysis = createAnalysis({ source });
    const { calls = [] } = analysis;

    return calls.filter(({ callee = '' } = {}) => callee === name).map(({ index = -1 } = {}) => analysis.checkCallResult({ index, required }));
};
const families = options => results(options).map(({ fact: { families: selected = [] } = {} } = {}) => selected);

[
    ['concise body', '() => "ready"', ['string']],
    ['empty completion', '() => {}', ['nullish']],
    ['bare return', '() => { return; }', ['nullish']],
    ['unreachable return', '() => { return "ready"; return []; }', ['string']],
    ['unreachable unsupported loop', '() => { return "ready"; while (external) {} }', ['string']],
    ['literal branch', '() => { if (false) return []; return "ready"; }', ['string']],
    ['truthy aggregate branch', '() => { if ([]) return "ready"; return []; }', ['string']],
    ['fallthrough participates', '(flag) => { if (flag) return "ready"; }', ['nullish', 'string']],
    ['normal finalizer preserves captured return', '() => { try { return []; } finally { const local = "ready"; } }', ['array']],
    ['final return replaces pending return', '() => { try { return []; } finally { return "ready"; } }', ['string']],
    ['final return replaces explicit throw', '() => { try { throw 1; } finally { return "ready"; } }', ['string']],
    ['explicit catch', '() => { try { throw 1; } catch (error) { return "ready"; } }', ['string']],
    ['unreachable catch', '() => { try { return "ready"; } catch (error) { return []; } }', ['string']],
    ['catch then final replacement', '() => { try { throw 1; } catch (error) { return []; } finally { return "ready"; } }', ['string']],
    ['nested function returns stay owned', '() => { const nested = () => []; return "ready"; }', ['string']],
    ['known return after unsupported loop', '() => { while (external) {} return "ready"; }', ['string']],
    ['unsupported switch', '() => { switch (external) { default: return "ready"; } }', []],
    ['implicit throw does not fabricate a catch value', '() => { try { external(); return "ready"; } catch (error) { return []; } }', []],
    ['implicit test throw does not fabricate a catch value', '() => { try { if (external) return "ready"; } catch (error) { return []; } }', []],
    ['unknown returned property', '(value) => value.field', []],
    ['destructured expectations are not result evidence', '({ value = "ready" } = {}) => value', []],
    ['async body owns fulfillment evidence', 'async () => "ready"', ['string']],
    ['generator is not normal sync completion', 'function* () { return "ready"; }', []]
].forEach(([name = '', fn = '', expected = []] = []) => {
    test(`function completion: ${name}`, () => {
        const analysis = createAnalysis({ source: `const read = ${fn};` });
        const { fact: { families: actual = [] } = {} } = analysis.checkFunction({ index: 0 });

        deepStrictEqual(actual.toSorted(), expected);
    });
});

[
    ['unknown continuation is not proven fallthrough', 'while(external){}', [], true],
    ['known return survives unknown control', 'while(external){}return "ready";', ['string'], true],
    ['authored bare return retains absence', 'while(external){}return;', ['nullish'], true],
    ['finally replacement remains known', 'try{while(external){}}finally{return 42;}', ['number'], false],
    ['definite return excludes unsupported control', 'return "ready";while(external){}', ['string'], false]
].forEach(([name = '', body = '', expected = [], incomplete = true] = []) => test(`partial completion: ${name}`, () => {
    const analysis = createAnalysis({ source: `const inspect=()=>{${body}};` });
    const { fact: { families = [], incomplete: actual = false } = {} } = analysis.checkFunction({ index: 0 });

    deepStrictEqual(families, expected);
    strictEqual(actual, incomplete);
}));

[
    ['later call retains contradiction', 'for(const item of external){if(item)external(item);}read(42);', 1],
    ['dead conditional remains dead', 'for(const item of external){if(item)external(item);}if(false)read(42);', 0],
    ['return still terminates continuation', 'for(const item of external){if(item)external(item);}return;read(42);', 0],
    ['throw still terminates continuation', 'for(const item of external){if(item)external(item);}throw 0;read(42);', 0],
    ['unreachable loop never revives later call', 'if(false){while(external){}}return;read(42);', 0]
].forEach(([name = '', body = '', count = 0] = []) => test(`unsupported control and call policy: ${name}`, async () => {
    const source = `const read=(value="")=>value;const inspect=()=>{${body}};`;
    const analysis = createAnalysis({ source });
    const { calls = [] } = analysis;
    const { index = -1 } = calls.find(({ callee = '' } = {}) => callee === 'read') ?? {};

    strictEqual(analysis.checkCall({ index }).status === 'contradiction', Boolean(count));
    const engine = new ESLint({ overrideConfigFile: true, overrideConfig: {
        plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' }
    } });
    const [{ messages = [] } = {}] = await engine.lintText(source);

    strictEqual(messages.length, count);
}));

test('the function, call, alias and consumer chain uses actual arguments', () => {
    const source = `const read = (value = "ready") => value; const a = read([]); const b = a; b.trim(); const [item] = b;
        const accept = (value = "") => value; accept(b); read(42); read("ok"); read(); read(null); read(external);`;
    const analysis = createAnalysis({ source });
    const { calls = [] } = analysis;
    const { index = -1 } = calls.find(({ callee = '' } = {}) => callee === 'accept');

    strictEqual(analysis.check({ index: 0 }).status, 'contradiction');
    strictEqual(analysis.checkDestructuring({ index: 0 }).status, 'agreement');
    strictEqual(analysis.checkCall({ index }).status, 'contradiction');
    deepStrictEqual(families({ source }), [['array'], ['number'], ['string'], ['string'], ['nullish'], []]);
    strictEqual(analysis.checkFunction({ index: 0 }).status, 'unknown', 'Expected defaults never validate generic inputs');
});

test('known undefined completion selects a default and null does not', () => {
    const source = 'const empty = () => {}; const read = (value = "ready") => value; read(empty()); read(null); read(external);';

    deepStrictEqual(families({ source }), [['string'], ['nullish'], []]);
    const analysis = createAnalysis({ source });
    const { calls = [] } = analysis;

    deepStrictEqual(calls.filter(({ callee = '' } = {}) => callee === 'read').map(({ index = -1 } = {}) => analysis.checkCall({ index }).status),
        ['agreement', 'contradiction', 'unknown']);
});

test('stable repeated tests exclude impossible results while distinct opaque tests remain distinct', () => {
    const stable = createAnalysis({ source: 'const read = (flag) => { if (flag) return "yes"; return flag ? [] : "no"; };' });
    const opaque = createAnalysis({ source: 'const read = () => { if (first()) return "yes"; return second() ? [] : "no"; };' });
    const immutable = createAnalysis({ source: 'const read = (input) => { const flag = input; if (flag) return "yes"; return !flag ? "no" : []; };' });

    strictEqual(stable.checkFunction({ index: 0 }).status, 'agreement');
    strictEqual(immutable.checkFunction({ index: 0 }).status, 'agreement');
    const alias = createAnalysis({ source: 'const read = (flag) => { const a = flag; const b = a; if (b) return "yes"; return flag ? [] : "no"; };' });

    strictEqual(alias.checkFunction({ index: 0 }).status, 'agreement');
    strictEqual(opaque.checkFunction({ index: 0 }).status, 'contradiction');
    deepStrictEqual(families({ source: 'const read = (flag) => flag ? [] : "ready"; read(true); read(false);' }), [['array'], ['string']]);
});

test('mutations and dynamic parameter access cannot preserve an earlier argument fact', () => {
    [
        '(value) => { value = []; return value; }',
        '(value) => { value++; return value; }',
        '(value) => { ({ value } = external); return value; }',
        '(value) => { const write = () => { value = []; }; write(); return value; }',
        'function(value) { arguments[0] = []; return value; }',
        '(value) => { eval("value = []"); return value; }',
        'function(value) { const mutate = () => { arguments[0] = []; }; mutate(); return value; }',
        '(value) => { const mutate = () => { eval("value = []"); }; mutate(); return value; }',
        '(value, mutate = () => { value = []; }) => { mutate(); return value; }',
        '(value, mutate = eval("value = []")) => value',
        '(value, { mutate = eval("value = []") } = {}) => value',
        '(value) => { const C = class { mutate() { value = []; } }; new C().mutate(); return value; }',
        '(value) => { const mutate = () => { for (value of [[]]) {} }; mutate(); return value; }'
    ].forEach(fn => deepStrictEqual(families({ source: `const read = ${fn}; read("ready");` }), [[]], fn));
});

test('sloppy-script duplicate parameters and skipped dynamic lookup cannot establish the wrong argument', () => {
    [
        'const read = function(value, value) { return value; }; read("ready", []);',
        'const read = (value) => { const mutate = () => { with ({}) { value = []; } }; mutate(); return value; }; read("ready");'
    ].forEach((source) => {
        const analysis = createAnalysis({ source, sourceType: 'script' });
        const { calls = [] } = analysis;
        const { index = -1 } = calls.at(-1);

        strictEqual(analysis.checkCallResult({ index, required: 'string' }).status, 'unknown');
    });
});

test('normal-value logic follows JavaScript operand selection, including falsey present values', () => {
    const definitions = ['value && "right"', 'value || "right"', 'value ?? "right"', '!value', 'typeof value'];
    const inputs = ['false', '0', '""', 'null', '[]', '{}', '"left"'];
    const tags = new Map([['[object String]', 'string'], ['[object Number]', 'number'], ['[object Boolean]', 'boolean'],
        ['[object Null]', 'nullish'], ['[object Undefined]', 'nullish'], ['[object Array]', 'array'], ['[object Object]', 'object']]);

    definitions.forEach((expression) => {
        inputs.forEach((input) => {
            const source = `const read = (value) => ${expression}; read(${input});`;
            const actual = runInNewContext(`${source.slice(0, source.lastIndexOf('read('))}Object.prototype.toString.call(read(${input}));`);

            deepStrictEqual(families({ source }), [[tags.get(actual)]], source);
        });
    });
});

test('closed completion fixtures agree with an independent execution oracle for every Boolean input', () => {
    const bodies = [
        'if (a) return "a"; if (b) return []; return 42;',
        'try { if (a) return "a"; throw 1; } catch (error) { return []; }',
        'try { if (a) return "a"; throw 1; } finally { if (b) return []; }',
        'try { return a ? "a" : []; } finally { if (b) throw 1; }',
        'if (a) return "a"; return a ? [] : "b";',
        'try { try { throw 1; } finally { if (a) return "a"; } } catch (error) { if (b) return []; }',
        'if (a && b) return "a"; return a && b ? [] : 42;',
        'if (a || b) return "a"; return !a && !b ? 42 : [];'
    ];
    const tags = new Map([['[object String]', 'string'], ['[object Number]', 'number'], ['[object Array]', 'array'], ['[object Undefined]', 'nullish']]);

    bodies.forEach((body) => {
        [false, true].forEach((a) => {
            [false, true].forEach((b) => {
                const source = `const read = (a, b) => { ${body} }; read(${a}, ${b});`;
                const actual = runInNewContext(`const read = (a, b) => { ${body} }; try { Object.prototype.toString.call(read(${a}, ${b})); } catch (error) { "thrown"; }`);
                const expected = actual === 'thrown' ? [] : [tags.get(actual)];

                deepStrictEqual(families({ source }), [expected], source);
            });
        });
    });
});

test('a known incompatible return survives beside an unknown return', () => {
    const analysis = createAnalysis({ source: 'const read = (flag) => flag ? [] : external; const value = read(external); value.trim();' });
    const { status = '', fact: { families: actual = [], incomplete = false } = {} } = analysis.check({ index: 0 });

    strictEqual(status, 'contradiction');
    deepStrictEqual(actual, ['array']);
    strictEqual(incomplete, true);
    strictEqual(analysis.checkFunction({ index: 0 }).status, 'unknown');
});

test('captured immutable callables share bodies; arbitrary captures and mutable callables remain unknown', () => {
    const source = 'const base = () => []; const alias = base; const read = () => alias(); read();';

    deepStrictEqual(families({ source }), [['array']]);
    deepStrictEqual(families({ source: 'const value = []; const read = () => value; read();' }), [[]]);
    deepStrictEqual(families({ source: 'let base = () => []; const read = () => base(); read();' }), [[]]);
    deepStrictEqual(families({ source: 'const read = () => later(); const later = () => []; read();' }), [[]]);
});

test('recursive correspondence terminates as unknown without hiding a separate known result', () => {
    const source = 'const read = (flag) => { const recurse = () => read(flag); return flag ? [] : recurse(); }; read(external);';
    const result = results({ source }).at(-1);
    const { status = '', fact: { families: actual = [], incomplete = false } = {} } = result;

    strictEqual(status, 'contradiction');
    deepStrictEqual(actual, ['array']);
    strictEqual(incomplete, true);
});

test('source snapshots own function bodies, parameters and query provenance before returning', () => {
    const source = 'const read = (value = "ready") => { return value; }; read();';
    const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
    const pristine = structuredClone(program);
    const before = createProgramAnalysis({ program });
    const { body: [{ declarations: [{ init: { params: [{ right = {} } = {}] = [], body = {} } = {} } = {}] = [] } = {}] = [] } = program;

    deepStrictEqual(structuredClone(program), pristine);
    Object.defineProperty(right, 'value', { value: 42 });
    Object.defineProperty(body, 'body', { value: [] });
    strictEqual(before.checkCallResult({ index: 0, required: 'string' }).status, 'agreement');
    strictEqual(createProgramAnalysis({ program }).checkCallResult({ index: 0, required: 'string' }).status, 'contradiction');
    const summary = before.checkFunction({ index: 0 });
    const { functions = [] } = before;
    const { returns = [], fact = {} } = summary;

    [functions, functions.at(0), summary, returns, returns.at(0), fact].forEach(value => ok(Object.isFrozen(value)));
    strictEqual(Object.hasOwn(fact, 'owner'), false);
});

test('limits and observer failures remain failures, and an interrupted demand can be retried', () => {
    const source = 'const read = (flag) => { if (flag) return []; return "ready"; }; read(true);';

    [0, -1, 1.5, Infinity].forEach(limit => throws(() => createAnalysis({ source, limits: { demand: limit } }), RangeError));
    [0, -1, 1.5, Infinity].forEach(limit => throws(() => createAnalysis({ source, limits: Object.create({ demand: limit }) }), RangeError));
    throws(() => createAnalysis({ source, limits: { decisions: 1 } }).checkFunction({ index: 0 }), /decision limit/);
    const bounded = createAnalysis({ source, limits: { demand: 1 } });

    throws(() => bounded.checkCallResult({ index: 0, required: 'array' }), /demand limit/);
    const analysis = createAnalysis({ source });

    throws(() => analysis.checkCallResult({ index: 0, required: 'array', onWork: ({ kind = '' } = {}) => {
        if (kind === 'flow-contribution') throw new Error('observation interrupted');
    } }), /observation interrupted/);
    strictEqual(analysis.checkCallResult({ index: 0, required: 'array' }).status, 'agreement');
    [-1, 1.5, 99].forEach((index) => {
        throws(() => analysis.checkFunction({ index }), RangeError);
        throws(() => analysis.checkCallResult({ index, required: 'array' }), RangeError);
    });
});

test('one owned function body serves many isolated contexts and warm queries reuse demand', () => {
    const size = 200;
    const source = `const read = (value) => value; ${Array.from({ length: size }, (_, index) => `read(${index % 2 ? '[]' : '"ready"'});`).join('\n')}`;
    const analysis = createAnalysis({ source });
    const { calls = [], counts: { functions = 0, expressions = 0 } = {} } = analysis;
    const work = counter();

    strictEqual(functions, 1);
    ok(expressions < size * 3 + 10);
    calls.forEach(({ index = -1 } = {}) => strictEqual(analysis.checkCallResult({ index, required: index % 2 ? 'array' : 'string', onWork: event => work.onWork(event) }).status, 'agreement'));
    strictEqual(work.get('function-context'), size);
    const demands = work.get('value-demand');

    ok(demands < size * 20);
    calls.forEach(({ index = -1 } = {}) => analysis.checkCallResult({ index, required: 'object', onWork: event => work.onWork(event) }));
    strictEqual(work.get('function-context'), size);
    strictEqual(work.get('value-demand'), demands);
});

test('deep local invocation chains use a bounded JavaScript stack', () => {
    const size = 1200;
    const source = ['const f0 = () => [];', ...Array.from({ length: size }, (_, index) => `const f${index + 1} = () => f${index}();`), `const value = f${size}(); value.trim();`].join('\n');
    const analysis = createAnalysis({ source });
    const work = counter();

    strictEqual(analysis.check({ index: 0, onWork: event => work.onWork(event) }).status, 'contradiction');
    strictEqual(work.get('function-context'), size + 1);
    ok(work.get('value-demand') < size * 10);
});

test('normal absence is owned source evidence, independent of any expected default', () => {
    const owner = createOwner({ evidence: absent() });
    const { fact = {} } = request({ owner, required: 'nullish' });
    const { families: actual = [], incomplete = true } = fact;

    deepStrictEqual(actual, ['nullish']);
    strictEqual(incomplete, false);
    strictEqual(request({ owner, required: 'string' }).status, 'contradiction');
});

test('sequential guards retain shared contributions and counted decision work rather than complete path lists', () => {
    const samples = [80, 160, 320].map((size) => {
        const params = Array.from({ length: size }, (_, index) => `p${index}`);
        const source = `const read = (${params.join(',')}) => { ${params.map(name => `if (${name}) return "ready";`).join(' ')} return "ready"; };`;
        const analysis = createAnalysis({ source });
        const { counts: { completionContributions = 0, expressions = 0 } = {} } = analysis;
        const work = counter();

        strictEqual(analysis.checkFunction({ index: 0, onWork: event => work.onWork(event) }).status, 'agreement');
        const { counts = {} } = analysis;

        ok(completionContributions <= size * 4 + 2);
        // Each guard owns a use occurrence as well as its shared formal and result.
        strictEqual(expressions, size * 3 + 4);
        ok(work.get('flow-contribution') <= completionContributions * 4);
        const { 'flow-contribution': contributions = 0 } = work.read();

        strictEqual(analysis.checkFunction({ index: 0, onWork: event => work.onWork(event) }).status, 'agreement');
        strictEqual(work.get('flow-contribution'), contributions);
        const { counts: repeated = {} } = analysis;

        deepStrictEqual(repeated, counts);

        return counts;
    });

    samples.slice(1).forEach(({ decisionWork = 0, values = 0 } = {}, index) => {
        const { decisionWork: previous = 0, values: previousValues = 0 } = samples.at(index);

        ok(decisionWork <= 4 * previous, 'Independent guard prefixes retain at most quadratic decision work on this family');
        ok(values <= 2 * previousValues, 'Completed use storage remains linear');
    });
});

test('throw-only completion remains distinct from a completed absent value', () => {
    const analysis = createAnalysis({ source: 'const read = () => { try { return []; } finally { throw 1; } }; read();' });
    const { status = '', normal = true, thrown = false, returns = [], fact: { incomplete = false } = {} } = analysis.checkFunction({ index: 0 });

    strictEqual(status, 'agreement');
    strictEqual(normal, false);
    strictEqual(thrown, true);
    strictEqual(incomplete, true);
    deepStrictEqual(returns, []);
    strictEqual(analysis.checkCallResult({ index: 0, required: 'nullish' }).status, 'unknown');
});

test('normal comparison results retain the operator family without pretending to know its truth', () => {
    ['===', '!==', '==', '!=', '<', '>', '<=', '>=', 'in', 'instanceof'].forEach((operator) => {
        deepStrictEqual(families({ source: `const read = (left, right) => left ${operator} right; read(external, external);` }), [['boolean']]);
    });
    const analysis = createAnalysis({ source: 'const read = (left, right) => left === right ? [] : "ready";' });

    strictEqual(analysis.checkFunction({ index: 0 }).status, 'contradiction');
});

test('function source acquisition failures propagate before a session is published', () => {
    const program = parse('const read = () => "ready";', { ecmaVersion: 'latest', sourceType: 'module', range: true });
    const { body: [{ declarations: [{ init: { body = {} } = {} } = {}] = [] } = {}] = [] } = program;

    Object.defineProperty(body, 'value', { get() { throw new Error('host payload failed'); } });
    throws(() => createProgramAnalysis({ program }), /host payload failed/);
});

test('existing lint consumers report returned evidence and identify absent completion accurately', async () => {
    const source = `const empty = () => {}; const array = () => []; const accept = ({ value }) => value;
accept(empty()); const text = (value = "") => value; text(array()); const { field } = array();`;
    const engine = new ESLint({ overrideConfigFile: true, overrideConfig: [{ plugins: { resilient: plugin }, rules: {
        'resilient/signature-contract-call-site': 'error', 'resilient/signature-contract-destructuring': 'error'
    } }] });
    const [{ messages = [] } = {}] = await engine.lintText(source);

    strictEqual(messages.length, 3);
    ok(messages.some(({ message = '' } = {}) => message === 'argument expects object-like, but this call supplies undefined.'));
    ok(messages.some(({ message = '' } = {}) => message === 'argument expects string-like, but this call supplies array-like.'));
});
