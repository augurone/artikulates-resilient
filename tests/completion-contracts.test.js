import { deepStrictEqual, strictEqual, throws, ok, rejects } from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { ESLint, Linter } from 'eslint';
import { parse } from 'espree';

import { absent, createOwner, request } from 'eslint-plugin-resilient/agreement';
import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { append } from './support/collections.js';
import { counter } from './support/work.js';

// Normal/abrupt completion, guarded contributions, catch/finalizer replacement and consumer obligations share one outcome contract, checked by native/composed oracles and operational controls.
const readCallShared = ({ calls = [] } = {}) => calls.findLast(({ callee = '' } = {}) => callee === 'read');
const familiesOfShared = ({ fact: { families = [] } = {} } = {}) => families.toSorted();

{
    const results = ({ source = '', required = 'string', name = 'read' } = {}) => {
        const analysis = createAnalysis({ source });
        const { calls = [] } = analysis;

        return calls.filter(({ callee = '' } = {}) => callee === name).map(({ index = -1 } = {}) => analysis.checkCallResult({ index, required }));
    };
    const families = options => results(options).map(({ fact: { families: selected = [] } = {} } = {}) => selected);

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
            '(value) => { eval("value = []"); return value; }',
            '(value) => { const mutate = () => { eval("value = []"); }; mutate(); return value; }',
            '(value, mutate = () => { value = []; }) => { mutate(); return value; }',
            '(value, mutate = eval("value = []")) => value',
            '(value, { mutate = eval("value = []") } = {}) => value',
            '(value) => { const C = class { mutate() { value = []; } }; new C().mutate(); return value; }',
            '(value) => { const mutate = () => { for (value of [[]]) {} }; mutate(); return value; }'
        ].forEach(fn => deepStrictEqual(families({ source: `const read = ${fn}; read("ready");` }), [[]], fn));
    });

    test('arguments aliases retire own parameters, arrow captures and exposed records with native controls', () => {
        [
            ['function(value){arguments[0]=[];return value;}', '"ready"', true],
            ['function(value){const mutate=()=>{arguments[0]=[];};mutate();return value;}', '"ready"', true],
            ['function(value){arguments[0].item="ready";return value.item;}', '{item:[]}', false]
        ].forEach(([fn = '', input = '', fails = false] = []) => {
            const source = `const read=${fn};const result=read(${input});result.trim();`;

            if (fails) throws(() => runInNewContext(source), ({ name = '' } = {}) => name === 'TypeError');

            if (!fails) strictEqual(runInNewContext(source), 'ready');

            const analysis = createAnalysis({ source, sourceType: 'script' });

            strictEqual(analysis.check({ index: 0 }).status, 'unknown', 'No initial parameter or record field may survive unsupported argument aliasing');
        });
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
}

{
    const callNamed = ({ analysis = {}, name = 'read' } = {}) => {
        const { calls = [] } = analysis;

        return calls.findLast(({ callee = '' } = {}) => callee === name);
    };
    const resultFor = ({ source = '', required = 'string', ...options } = {}) => {
        const analysis = createAnalysis({ source, ...options });
        const { index = -1 } = callNamed({ analysis });

        return analysis.checkCallResult({ index, required });
    };
    const tags = new Map([
        ['[object String]', 'string'], ['[object Number]', 'number'], ['[object Boolean]', 'boolean'],
        ['[object Array]', 'array'], ['[object Object]', 'object'], ['[object Null]', 'nullish'], ['[object Undefined]', 'nullish']
    ]);
    const runtimeFamilies = definition => [...new Set([false, true].map(flag => tags.get(runInNewContext(
        `${definition} Object.prototype.toString.call(read(${flag}));`
    ))))].toSorted();
    const leafExpressions = ['null', '""', '"ready"', '0', 'false', '[]', '{}', 'empty()'];

    test('joined short-circuit results match closed JavaScript execution through direct and forwarded values', () => {
        leafExpressions.forEach((left) => {
            leafExpressions.forEach((right) => {
                ['&&', '||', '??'].forEach((operator) => {
                    ['"fallback"', '[]', 'false'].forEach((fallback) => {
                        [
                            `const empty = () => {}; const read = flag => (flag ? ${left} : ${right}) ${operator} ${fallback};`,
                            `const empty = () => {}; const select = value => value ${operator} ${fallback}; const read = flag => select(flag ? ${left} : ${right});`
                        ].forEach((definition) => {
                            const expected = runtimeFamilies(definition);
                            const { fact: { families = [], incomplete = true } = {} } = resultFor({ source: `${definition} read(external);` });

                            deepStrictEqual(families.toSorted(), expected, definition);
                            strictEqual(incomplete, false, definition);
                        });
                    });
                });
            });
        });
    });

    test('defaults replace only established undefined alternatives in body results and call obligations', () => {
        leafExpressions.forEach((left) => {
            leafExpressions.forEach((right) => {
                ['"fallback"', '[]'].forEach((fallback) => {
                    const definition = `const empty = () => {}; const select = (value = ${fallback}) => value; const read = flag => select(flag ? ${left} : ${right});`;
                    const expected = runtimeFamilies(definition);
                    const analysis = createAnalysis({ source: `${definition} read(external);` });
                    const { index = -1 } = callNamed({ analysis });
                    const { fact: { families = [], incomplete = true } = {} } = analysis.checkCallResult({ index, required: 'string' });
                    const { index: selected = -1 } = callNamed({ analysis, name: 'select' });
                    const family = fallback === '[]' ? 'array' : 'string';

                    deepStrictEqual(families.toSorted(), expected, definition);
                    strictEqual(incomplete, false, definition);
                    strictEqual(analysis.checkCall({ index: selected }).status, expected.every(item => item === family) ? 'agreement' : 'contradiction', definition);
                });
            });
        });
    });

    test('unknown supplied values acquire no default evidence and cannot erase a surviving known contradiction', () => {
        const definition = 'const empty = () => {}; const select = (value = "fallback") => value;';
        const cases = [
            ['external', [], true],
            ['flag ? null : external', ['nullish'], true],
            ['flag ? [] : external', ['array'], true],
            ['flag ? empty() : external', ['string'], true],
            ['flag ? empty() : null', ['nullish', 'string'], false]
        ];

        cases.forEach(([input = '', expected = [], partial = false] = []) => {
            const { fact: { families = [], incomplete = false } = {} } = resultFor({ source: `${definition} const read = flag => select(${input}); read(external);` });

            deepStrictEqual(families.toSorted(), expected, input);
            strictEqual(incomplete, partial, input);
        });
    });

    test('successive short-circuit consumers preserve selected alternatives across both call boundaries', () => {
        leafExpressions.forEach((left) => {
            leafExpressions.forEach((right) => {
                ['&&', '||', '??'].forEach((first) => {
                    ['&&', '||', '??'].forEach((second) => {
                        [['""', '[]'], ['[]', '"ready"']].forEach(([a = '', b = ''] = []) => {
                            const definition = `const empty = () => {}; const first = value => value ${first} ${a}; const second = value => value ${second} ${b};
                            const read = flag => second(first(flag ? ${left} : ${right}));`;
                            const { fact: { families = [], incomplete = true } = {} } = resultFor({ source: `${definition} read(external);` });

                            deepStrictEqual(families.toSorted(), runtimeFamilies(definition), definition);
                            strictEqual(incomplete, false, definition);
                        });
                    });
                });
            });
        });
    });

    test('null, false, zero and record defaults retain their actual truth and absence in a subsequent operation', () => {
        leafExpressions.forEach((left) => {
            leafExpressions.forEach((right) => {
                ['null', 'false', '0', '{}'].forEach((fallback) => {
                    ['&&', '||', '??'].forEach((operator) => {
                        const definition = `const empty = () => {}; const select = (value = ${fallback}) => value;
                        const read = flag => select(flag ? ${left} : ${right}) ${operator} "ready";`;
                        const { fact: { families = [], incomplete = true } = {} } = resultFor({ source: `${definition} read(external);` });

                        deepStrictEqual(families.toSorted(), runtimeFamilies(definition), definition);
                        strictEqual(incomplete, false, definition);
                    });
                });
            });
        });
    });

    test('destructured catch binding effects cannot preserve an invalidated outer argument', () => {
        const bodies = [
            'try { throw {}; } catch ({ x = eval("value = []") }) {} return value;',
            'try { throw {}; } catch ({ x = () => { value = []; } }) { x(); } return value;',
            'const mutate = () => { try { throw {}; } catch ({ x = eval("value = []") }) {} }; mutate(); return value;',
            'try { throw null; } catch ({ x }) { return "wrong"; }',
            'try { throw {}; } catch ([x]) { return "wrong"; }',
            'try { throw {}; } catch ({ [(() => { value = []; })()]: x }) {} return value;'
        ];

        bodies.forEach(body => strictEqual(resultFor({ source: `const read = value => { ${body} }; read("ready");` }).status, 'unknown', body));
    });

    test('destructuring declarations retain their implicit failure boundary inside a protected body', () => {
        ['const { x } = null;', 'const [x] = {};', 'const { x = external() } = {};', 'const [x] = external;'].forEach((declaration) => {
            const source = `const read = () => { try { ${declaration} return "wrong"; } catch (error) { return []; } }; read();`;

            const result = resultFor({ source });
            const { status = '', fact: { families = [], incomplete = false } = {} } = result;

            strictEqual(status, 'contradiction', 'The known array conflicts with the requested string requirement');
            deepStrictEqual(families, ['array'], 'Catch evidence survives without admitting the unproved string return');
            strictEqual(incomplete, true, source);
            const { status: consistency = '', diagnostics = [] } = createAnalysis({ source }).checkFunction({ index: 0 });

            strictEqual(consistency, 'unknown', 'An unknown try contribution beside one known return family is not inconsistent');
            deepStrictEqual(diagnostics, []);
            strictEqual(runInNewContext(`const external = () => { throw 1; }; ${source} Object.prototype.toString.call(read());`), '[object Array]');
        });
        const supported = 'const read = () => { try { const value = "ready"; return value; } catch (error) { return []; } }; read();';

        strictEqual(resultFor({ source: supported }).status, 'agreement');
    });

    test('conditional truth provenance composes with aliases, negation and subsequent guards', () => {
        const expressions = ['flag ? [] : ""', 'flag ? "ready" : null', '!flag ? false : {}', 'flag ? true : 0'];

        expressions.forEach((expression) => {
            const definition = `const read = flag => { const value = ${expression}; const alias = value; if (alias) return "yes"; return flag ? [] : "no"; };`;
            const analysis = createAnalysis({ source: definition });
            const { status = '', fact: { families = [] } = {} } = analysis.checkFunction({ index: 0 });

            strictEqual(status, 'agreement', definition);
            deepStrictEqual(families, ['string']);
            deepStrictEqual(runtimeFamilies(definition), ['string']);
        });
    });

    test('parameters shadow named function-expression bindings in a separate lexical environment', () => {
        ['function value(value) { return value; }', 'function value(value = "ready") { return value; }'].forEach((fn) => {
            strictEqual(resultFor({ source: `const read = ${fn}; read("ready");` }).status, 'agreement', fn);
            strictEqual(resultFor({ source: `const read = ${fn}; read([]);` }).status, 'contradiction', fn);
        });
        strictEqual(resultFor({ source: 'const read = function inner(value) { return inner; }; read("ready");' }).status, 'contradiction');
    });

    test('identical branch results share demand through a thousand successive diamonds', () => {
        const samples = [250, 500, 1000].map((size) => {
            const source = ['const x0 = external ? null : "";',
                ...Array.from({ length: size }, (_, index) => `const x${index + 1} = choose() ? x${index} : x${index};`), `const out = x${size} ?? ""; out.trim();`].join('\n');
            const analysis = createAnalysis({ source });
            const work = counter();

            strictEqual(analysis.check({ index: 0, onWork: event => work.onWork(event) }).status, 'agreement');
            const demands = work.get('value-demand');
            const selections = work.get('value-selection');

            analysis.check({ index: 0, onWork: event => work.onWork(event) });
            strictEqual(work.get('value-demand'), demands);
            strictEqual(work.get('value-selection'), selections);

            return { demands, selections };
        });

        ['demands', 'selections'].forEach((kind) => {
            const [first = 0, second = 0, third = 0] = samples.map(sample => Reflect.get(sample, kind));

            ok(third - second <= 2 * (second - first), `${kind} must grow affinely across successive diamonds`);
        });
    });

    test('successive default selections retain homogeneous subgraphs and warm call queries reuse selected facts', () => {
        const samples = [50, 100, 200].map((size) => {
            const source = ['const empty = () => {}; const select = (value = "") => value; const x0 = "ready";',
                ...Array.from({ length: size }, (_, index) => `const x${index + 1} = select(external ? x${index} : empty());`), `const out = x${size}; out.trim();`].join('\n');
            const analysis = createAnalysis({ source });
            const { calls = [] } = analysis;
            const work = counter();

            strictEqual(analysis.check({ index: 0, onWork: event => work.onWork(event) }).status, 'agreement');
            calls.filter(({ callee = '' } = {}) => callee === 'select').forEach(({ index = -1 } = {}) => {
                strictEqual(analysis.checkCall({ index, onWork: event => work.onWork(event) }).status, 'agreement');
            });
            const selections = work.get('value-selection');
            const establishments = work.get('establishment');

            calls.filter(({ callee = '' } = {}) => callee === 'select').forEach(({ index = -1 } = {}) => analysis.checkCall({ index, onWork: event => work.onWork(event) }));
            strictEqual(work.get('value-selection'), selections);
            strictEqual(work.get('establishment'), establishments);

            return selections;
        });
        const [first = 0, second = 0, third = 0] = samples;

        strictEqual(third - second, 2 * (second - first));
    });

    test('selection observer failure does not publish partial values and query order does not change evidence', () => {
        const source = 'const empty = () => {}; const select = (value = "") => value; const read = flag => select(flag ? empty() : "ready"); read(external);';
        const first = createAnalysis({ source });
        const { index = -1 } = callNamed({ analysis: first });

        throws(() => first.checkCallResult({ index, required: 'string', onWork: ({ kind = '' } = {}) => {
            if (kind === 'value-selection') throw new Error('selection observer failed');
        } }), /selection observer failed/);
        const recovered = first.checkCallResult({ index, required: 'string' });
        const second = createAnalysis({ source });
        const { calls = [], functions = [] } = second;

        functions.toReversed().forEach(({ index: selected = -1 } = {}) => second.checkFunction({ index: selected }));
        calls.toReversed().forEach(({ index: selected = -1 } = {}) => second.checkCall({ index: selected }));
        deepStrictEqual(second.checkCallResult({ index, required: 'string' }), recovered);
        const { status = '' } = recovered;

        strictEqual(status, 'agreement');
    });

    test('operator headers are acquired once and cannot disagree between truth and family evidence', () => {
        const program = parse('const read = value => typeof value; read(42);', { ecmaVersion: 'latest', sourceType: 'module', range: true });
        const { body: [{ declarations: [{ init: { body = {} } = {} } = {}] = [] } = {}] = [] } = program;
        const reads = counter();

        Object.defineProperty(body, 'operator', { get() {
            reads.increment('operator');

            if (reads.get('operator') > 1) throw new Error('operator reread');

            return 'typeof';
        } });
        const analysis = createProgramAnalysis({ program });

        strictEqual(reads.get('operator'), 1);
        strictEqual(analysis.checkCallResult({ index: 0, required: 'string' }).status, 'agreement');
    });

    [
        ['!', '!value', 'boolean'], ['void', 'void value', 'nullish'],
        ['===', 'value===42', 'boolean'], ['!==', 'value!==42', 'boolean']
    ].forEach(([operator = '', expression = '', required = ''] = []) => {
        test(`capture observation uses the acquired ${operator} header`, () => {
            const program = parse(`const read=value=>${expression};read(42);`, { ecmaVersion: 'latest', sourceType: 'module', range: true });
            const { body: [{ declarations: [{ init: { body = {} } = {} } = {}] = [] } = {}] = [] } = program;
            const reads = counter();

            Object.defineProperty(body, 'operator', { get() {
                reads.increment('operator');

                if (reads.get('operator') > 1) throw new Error('operator reread');

                return operator;
            } });
            const analysis = createProgramAnalysis({ program });

            strictEqual(reads.get('operator'), 1);
            strictEqual(analysis.checkCallResult({ index: 0, required }).status, 'agreement');
            analysis.functions.forEach(entry => analysis.checkFunction(entry));
            analysis.declarations.forEach(entry => analysis.checkDeclaration(entry));
            strictEqual(analysis.checkCallResult({ index: 0, required }).status, 'agreement');
            strictEqual(reads.get('operator'), 1);
        });
    });

    test('nested completion and finalizer replacement match all concrete executions of 625 closed bodies', () => {
        const actions = ['return "ready";', 'return [];', 'return;', 'throw 1;', ';'];
        const inputs = [false, true].flatMap(a => [false, true].flatMap(b => [false, true].map(c => [a, b, c])));

        actions.forEach((first) => {
            actions.forEach((second) => {
                actions.forEach((caught) => {
                    actions.forEach((finalized) => {
                        const definition = `const read = (a, b, c) => { try { if (a) { ${first} } ${second} } catch (error) { if (b) { ${caught} } } finally { if (c) { ${finalized} } } };`;
                        const actual = runInNewContext(`${definition} ${JSON.stringify(inputs)}.map(([a,b,c]) => {
                        try { return Object.prototype.toString.call(read(a,b,c)); } catch(error) { return "thrown"; }
                    });`);
                        const analysis = createAnalysis({ source: `${definition} ${inputs.map(input => `read(${input.join(',')});`).join(' ')}` });
                        const { calls = [] } = analysis;

                        calls.forEach(({ index = -1 } = {}) => {
                            const expected = actual.at(index) === 'thrown' ? [] : [tags.get(actual.at(index))];
                            const { fact: { families = [] } = {} } = analysis.checkCallResult({ index, required: 'string' });

                            deepStrictEqual(families.toSorted(), expected, `${definition} ${inputs.at(index)}`);
                        });
                        const expected = [...new Set(Array.from(actual).filter(value => value !== 'thrown').map(value => tags.get(value)))].toSorted();
                        const { normal = false, thrown = false, fact: { families = [] } = {} } = analysis.checkFunction({ index: 0 });

                        deepStrictEqual(families.toSorted(), expected, definition);
                        strictEqual(normal, Boolean(expected.length), definition);
                        strictEqual(thrown, actual.includes('thrown'), definition);
                    });
                });
            });
        });
    });

    test('every observed demand stage can fail without corrupting a subsequent query', () => {
        const source = 'const empty = () => {}; const accept = (value = "") => value; const read = flag => accept(flag ? empty() : "ready"); const value = read(external); value.trim();';
        const reference = createAnalysis({ source });
        const work = counter();
        const expected = reference.check({ index: 0, onWork: event => work.onWork(event) });

        Object.keys(work.read()).forEach((stage) => {
            const analysis = createAnalysis({ source });

            throws(() => analysis.check({ index: 0, onWork: ({ kind = '' } = {}) => {
                if (kind === stage) throw new Error(`interrupt ${stage}`);
            } }), new RegExp(`interrupt ${stage}`, 'u'));
            deepStrictEqual(analysis.check({ index: 0 }), expected, stage);
        });
    });

    test('reentrant observation sees the same owned result without changing the outer query', () => {
        const source = 'const read = flag => (flag ? null : "ready") ?? "fallback"; read(external);';
        const analysis = createAnalysis({ source });
        const visits = counter();
        const outer = analysis.checkCallResult({ index: 0, required: 'string', onWork: () => {
            if (visits.get('reentered')) return;

            visits.increment('reentered');
            strictEqual(analysis.checkCallResult({ index: 0, required: 'string' }).status, 'agreement');
        } });
        const { status = '' } = outer;

        strictEqual(status, 'agreement');
        strictEqual(visits.get('reentered'), 1);
        deepStrictEqual(analysis.checkCallResult({ index: 0, required: 'string' }), outer);
    });
}

{
    const tags = new Map([['[object String]', 'string'], ['[object Number]', 'number'], ['[object Array]', 'array'], ['[object Undefined]', 'nullish']]);
    const readCall = readCallShared;
    const observed = (source) => {
        const actual = runInNewContext(`${source} (() => { try { return Object.prototype.toString.call(read()); } catch (error) { return "thrown"; } })();`);

        return actual === 'thrown' ? { normal: false, thrown: true, families: [] } : { normal: true, thrown: false, families: [tags.get(actual)] };
    };
    const selected = ({ normal = false, thrown = false, fact: { families = [] } = {} } = {}) => ({ normal, thrown, families: families.toSorted() });
    const callResult = (source, observation = {}) => {
        const analysis = createAnalysis({ source: `${source} read();` });
        const { index = -1 } = readCall(analysis);

        return analysis.checkCallResult({ index, required: 'string', ...observation });
    };

    test('extraction into a local call preserves completion through sequencing, catch and finally', () => {
        const actions = ['return "ready";', 'return [];', 'return;', 'throw 1;'];
        const cleanup = [';', 'return 42;', 'throw 2;'];
        const inputs = [false, true];

        actions.forEach((first) => {
            actions.forEach((second) => {
                cleanup.forEach((finalized) => {
                    inputs.forEach((flag) => {
                        const body = `if (flag) { ${first} } ${second}`;
                        const direct = `const read = () => { const flag = ${flag}; try { ${body} } catch (error) { return "caught"; } finally { ${finalized} } };`;
                        const extracted = `const work = flag => { ${body} }; const read = () => { try { return work(${flag}); } catch (error) { return "caught"; } finally { ${finalized} } };`;
                        const expected = observed(direct);

                        deepStrictEqual(observed(extracted), expected, extracted);
                        [direct, extracted].forEach(source => deepStrictEqual(selected(callResult(source)), expected, source));
                    });
                });
            });
        });
    });

    test('known failure stops sequencing and argument evaluation before the next function is demanded', () => {
        const setup = 'const stop = () => { throw 1; }; const later = () => { while (external) {} }; const accept = (a, b) => b;';
        const bodies = ['stop(); return later();', 'return accept(stop(), later());', 'return stop() === later();', 'return stop() ? later() : [];'];

        bodies.forEach((body) => {
            const work = counter();
            const result = callResult(`${setup} const read = () => { ${body} };`, { onWork: event => work.onWork(event) });

            deepStrictEqual(selected(result), { normal: false, thrown: true, families: [] }, body);
            strictEqual(work.get('function-context'), 2, 'Only read and stop are executed');
        });
    });

    test('short-circuit selection excludes unexecuted failure from catch reachability', () => {
        const expressions = ['false && external()', 'true || stop()', '"ready" ?? stop()', 'false ? stop() : []', '(() => external())'];

        expressions.forEach((expression) => {
            const source = `const stop = () => { throw 1; }; const read = () => { try { ${expression}; return []; } catch (error) { return "wrong"; } };`;
            const work = counter();

            deepStrictEqual(selected(callResult(source, { onWork: event => work.onWork(event) })), observed(source), expression);
            strictEqual(work.get('function-context'), 1);
        });
    });

    test('conditional completion keeps the caller guard through forwarding, aliases and defaults', () => {
        const definitions = [
            'const work = flag => { if (flag) throw 1; }; const read = flag => { work(flag); return flag ? [] : "ready"; };',
            'const work = flag => { if (flag) throw 1; return "ready"; }; const read = flag => { const alias = flag; const value = work(alias); return flag ? [] : value; };',
            'const stop = () => { throw 1; }; const read = flag => { const value = (flag ? null : "ready") ?? stop(); return flag ? [] : value; };',
            'const stop = () => { throw 1; }; const read = flag => { const value = (flag ? [] : "") && stop(); return flag ? [] : "ready"; };'
        ];

        definitions.forEach((source) => {
            const analysis = createAnalysis({ source: `${source} read(false); read(true);` });
            const { functions = [], calls = [] } = analysis;
            const { index = -1 } = functions.at(-1);

            deepStrictEqual(selected(analysis.checkFunction({ index })), { normal: true, thrown: true, families: ['string'] }, source);
            calls.filter(({ callee = '' } = {}) => callee === 'read').forEach(({ index: call = -1 } = {}, position) => {
                const expected = position ? { normal: false, thrown: true, families: [] } : { normal: true, thrown: false, families: ['string'] };

                deepStrictEqual(selected(analysis.checkCallResult({ index: call, required: 'string' })), expected, source);
            });
        });
    });

    test('a finalizer call preserves or replaces the pending completion using the same rules as inline code', () => {
        const initial = ['return [];', 'throw 1;', ';'];
        const cleanup = ['return "ignored";', 'throw 2;'];

        initial.forEach((pending) => {
            cleanup.forEach((finalized) => {
                const source = `const cleanup = () => { ${finalized} }; const read = () => { try { ${pending} } finally { cleanup(); } };`;

                deepStrictEqual(selected(callResult(source)), observed(source), source);
            });
        });
        const unknown = 'const read = () => { try { external(); } finally { return []; } };';

        deepStrictEqual(selected(callResult(unknown)), { normal: true, thrown: false, families: ['array'] });
    });

    test('no normal outcome, a normal unknown value and normal absence remain distinct', () => {
        const failed = callResult('const read = () => { throw 1; };');
        const unknown = callResult('const read = () => external;');
        const absent = callResult('const read = () => {};');

        deepStrictEqual(selected(failed), { normal: false, thrown: true, families: [] });
        deepStrictEqual(selected(unknown), { normal: true, thrown: true, families: [] });
        deepStrictEqual(selected(absent), { normal: true, thrown: false, families: ['nullish'] });
        const { status: failedStatus = '' } = failed;
        const { status: unknownStatus = '' } = unknown;
        const { status: absentStatus = '' } = absent;

        strictEqual(failedStatus, 'unknown');
        strictEqual(unknownStatus, 'unknown');
        strictEqual(absentStatus, 'contradiction');
    });

    test('guarded sharing and ordered wide arguments pay for distinct relationships and reuse warm outcomes', () => {
        [100, 400].forEach((size) => {
            const parameters = Array.from({ length: size }, (_, index) => `p${index}`);
            const source = `const accept = (${parameters.join(',')}) => p${size - 1}; const read = () => accept(${parameters.map(() => '"ready"').join(',')}); read();`;
            const analysis = createAnalysis({ source });
            const { index = -1 } = readCall(analysis);
            const work = counter();
            const expected = analysis.checkCallResult({ index, required: 'string', onWork: event => work.onWork(event) });
            const { 'value-demand': demands = 0, 'value-ownership': ownership = 0 } = work.read();
            const { status = '' } = expected;

            strictEqual(status, 'agreement');
            strictEqual(work.get('function-context'), 2);
            ok(work.get('value-demand') < size * 4 + 30);
            deepStrictEqual(analysis.checkCallResult({ index, required: 'string', onWork: event => work.onWork(event) }), expected);
            strictEqual(work.get('value-demand'), demands);
            strictEqual(work.get('value-ownership'), ownership);
        });
    });

    test('composed expression outcomes match closed execution before and after extraction in every Boolean context', () => {
        const expressions = [
            'flag ? stop() : "ready"', 'flag ? "ready" : stop()',
            '(flag ? null : "ready") ?? stop()', '(flag ? [] : "") && stop()',
            '(flag ? "" : []) || stop()', '!(flag ? stop() : "ready")',
            'typeof (flag ? stop() : [])', 'pass(flag ? stop() : "ready")',
            '(flag ? null : "ready") ?? (other ? stop() : [])',
            'pass(flag ? [] : "ready", other ? stop() : 0)',
            '(flag ? [] : "") && (other ? stop() : "ready")',
            '(flag ? [] : "") || (other ? stop() : "ready")'
        ];
        const bodies = expression => [
            `return ${expression};`, `${expression}; return "after";`,
            `try { return ${expression}; } catch (error) { return []; }`,
            `try { return ${expression}; } finally { if (other) stop(); }`,
            `const value = ${expression}; if (flag) return []; return value;`,
            `try { ${expression}; return "after"; } catch (error) { return []; } finally { if (other) return 42; }`
        ];
        const inputs = [false, true].flatMap(flag => [false, true].map(other => [flag, other]));
        const setup = 'const stop = () => { throw 1; }; const pass = (value) => value;';
        const familiesOf = new Map([...tags, ['[object Boolean]', 'boolean']]);

        expressions.forEach((expression) => {
            [false, true].forEach((extract) => {
                const helper = extract ? `const helper = (flag, other) => ${expression};` : '';

                bodies(extract ? 'helper(flag, other)' : expression).forEach((body) => {
                    const definition = `${setup} ${helper} const read = (flag, other) => { ${body} };`;
                    const actual = Array.from(runInNewContext(`${definition} ${JSON.stringify(inputs)}.map(([flag, other]) => {
                    try { return Object.prototype.toString.call(read(flag, other)); } catch (error) { return "thrown"; }
                });`));
                    const analysis = createAnalysis({ source: `${definition} ${inputs.map(input => `read(${input.join(',')});`).join(' ')}` });
                    const { calls = [], functions = [] } = analysis;
                    const completed = actual.filter(value => value !== 'thrown');
                    const families = [...new Set(completed.map(value => familiesOf.get(value)))].toSorted();
                    const { index = -1 } = functions.at(-1);

                    deepStrictEqual(selected(analysis.checkFunction({ index })), {
                        normal: Boolean(completed.length), thrown: actual.includes('thrown'), families
                    }, definition);
                    calls.filter(({ callee = '' } = {}) => callee === 'read').forEach(({ index: call = -1 } = {}, position) => {
                        const failure = actual.at(position) === 'thrown';
                        const expected = { normal: !failure, thrown: failure, families: failure ? [] : [familiesOf.get(actual.at(position))] };

                        deepStrictEqual(selected(analysis.checkCallResult({ index: call, required: 'string' })), expected, `${definition} ${inputs.at(position)}`);
                    });
                });
            });
        });
    });
}

{
    const familiesOf = familiesOfShared;
    const readCall = readCallShared;

    test('opaque failure cannot erase independent known returns inside the same protected body', () => {
        const bodies = [
            'if (a) return []; if (b) return 42; return external();',
            'if (a) return []; if (b) return 42; external(); return "dependent";',
            'return a ? [] : b ? 42 : external();',
            'const first = a; const second = b; if (first) return []; if (second) return 42; external();'
        ];

        bodies.forEach((body) => {
            [false, true].forEach((extracted) => {
                const helper = extracted ? `const work = (a, b) => { ${body} };` : '';
                const protectedBody = extracted ? 'return work(a, b);' : body;
                const source = `${helper} const read = (a, b) => { try { ${protectedBody} } catch (error) { return "unestablished"; } };`;
                const analysis = createAnalysis({ source: `${source} read(externalA, externalB); read(true, false); read(false, true);` });
                const { functions = [], calls = [] } = analysis;
                const { index = -1 } = functions.at(-1);
                const summary = analysis.checkFunction({ index });
                const { status = '', fact: { incomplete = false } = {}, returns = [] } = summary;

                strictEqual(status, 'contradiction', source);
                strictEqual(incomplete, true, source);
                deepStrictEqual(familiesOf(summary), ['array', 'number', 'string'], source);
                const { index: general = -1 } = calls.find(({ callee = '' } = {}) => callee === 'read');

                strictEqual(analysis.checkCallResult({ index: general, required: 'string' }).status, 'contradiction', source);
                deepStrictEqual([...new Set(returns.flatMap(familiesOf))].toSorted(), ['array', 'number', 'string'], source);
                calls.filter(({ callee = '' } = {}) => callee === 'read').slice(1).forEach(({ index: call = -1 } = {}, position) => {
                    const result = analysis.checkCallResult({ index: call, required: 'string' });
                    const { normal = false, thrown = true, fact: { incomplete: partial = true } = {} } = result;

                    deepStrictEqual(familiesOf(result), [position ? 'number' : 'array'], source);
                    strictEqual(normal, true);
                    strictEqual(thrown, false);
                    strictEqual(partial, false);
                });
                ['() => "external"', '() => { throw 1; }'].forEach((external) => {
                    deepStrictEqual(Array.from(runInNewContext(`const external = ${external}; ${source}
                    [read(true, false), read(false, true)].map(value => Object.prototype.toString.call(value));`)), ['[object Array]', '[object Number]']);
                });
            });
        });
    });

    test('explicit catch evidence and finalizer replacement remain separate from opaque failure conditions', () => {
        const variants = [
            ['if (a) throw 1; external();', 'return [];', '', ['array']],
            ['if (a) throw 1; if (b) return 42; external();', 'return [];', '', ['array', 'number']],
            ['if (a) throw 1; external();', 'return [];', 'finally { if (a) return 42; }', ['array', 'number']],
            ['if (a) return []; external();', 'return "unestablished";', 'finally { if (!a) return 42; }', ['array', 'number']],
            ['if (a) return []; external();', 'return "unestablished";', 'finally { return 42; }', ['number']]
        ];

        variants.forEach(([body = '', handler = '', cleanup = '', expected = []] = []) => {
            const source = `const read = (a, b) => { try { ${body} } catch (error) { ${handler} } ${cleanup} };`;
            const analysis = createAnalysis({ source });
            const summary = analysis.checkFunction({ index: 0 });

            deepStrictEqual(familiesOf(summary), expected, source);
        });
        const uncertain = createAnalysis({ source: 'const read = () => { try { external(); return 42; } catch (error) { return []; } };' });
        const { fact: { incomplete = false } = {} } = uncertain.checkFunction({ index: 0 });

        strictEqual(incomplete, true);
        deepStrictEqual(familiesOf(uncertain.checkFunction({ index: 0 })), ['array']);
    });

    test('caught payloads retain only their own failure evidence through actual calls and source replacement', () => {
        const source = 'const read = flag => { try { if (flag) throw 1; return external(); } catch (error) { return error; } }; read(true); read(false);';
        const observations = ['() => "ready"', '() => { throw []; }'].map(external => Array.from(runInNewContext(
            `const external = ${external}; ${source} [read(true), read(false)].map(value => Object.prototype.toString.call(value));`
        )));

        deepStrictEqual(observations, [['[object Number]', '[object String]'], ['[object Number]', '[object Array]']]);
        const analysis = createAnalysis({ source });
        const { calls = [] } = analysis;
        const reads = calls.filter(({ callee = '' } = {}) => callee === 'read');
        const unknownCall = reads.at(1);
        const knownCall = reads.at(0);
        const unknown = analysis.checkCallResult({ ...unknownCall, required: 'number' });
        const known = analysis.checkCallResult({ ...knownCall, required: 'string' });
        const { fact: { incomplete: unresolved = false } = {} } = unknown;
        const { status = '', fact: { incomplete: partial = true } = {} } = known;

        deepStrictEqual(familiesOf(unknown), [], 'An opaque failure cannot acquire Error or a numeric payload from another call');
        strictEqual(unresolved, true);
        strictEqual(status, 'contradiction');
        deepStrictEqual(familiesOf(known), ['number']);
        strictEqual(partial, false);
        const summary = analysis.checkFunction({ index: 0 });
        const { fact: { incomplete = false } = {} } = summary;

        deepStrictEqual(familiesOf(summary), ['number']);
        strictEqual(incomplete, true);
        deepStrictEqual(analysis.checkCallResult({ ...unknownCall, required: 'number' }), unknown);
        const replacement = createAnalysis({ source: source.replace('throw 1', 'throw "changed"') });

        deepStrictEqual(familiesOf(replacement.checkFunction({ index: 0 })), ['string']);
        strictEqual(replacement.checkCallResult({ ...knownCall, required: 'string' }).status, 'agreement');
        deepStrictEqual(analysis.checkCallResult({ ...knownCall, required: 'string' }), known, 'The original acquired evidence stays historical');
    });

    test('await catches rejection in its own scope while returning a promise preserves rejection ownership', async () => {
        await [false, true].reduce(async (prior, awaited) => {
            await prior;
            const source = `const fail = async () => { throw 42; }; const read = async () => { try { return ${awaited ? 'await ' : ''}fail(); } catch (error) { return error; } };`;
            const { kind = '', value = 0 } = await runInNewContext(`${source} read().then(value => ({ kind: 'fulfilled', value }), value => ({ kind: 'rejected', value }));`);

            strictEqual(kind, awaited ? 'fulfilled' : 'rejected');
            strictEqual(value, 42);
            const analysis = createAnalysis({ source });
            const { functions = [] } = analysis;
            const summary = analysis.checkFunction(functions.at(-1));
            const { normal = 'unknown', thrown = 'unknown' } = summary;

            deepStrictEqual(familiesOf(summary), awaited ? ['number'] : []);
            strictEqual(normal, awaited);
            strictEqual(thrown, !awaited);
        }, Promise.resolve());
        const source = 'const read = async fetcher => { try { return await fetcher(); } catch (error) { return 42; } };';
        const actual = await runInNewContext(`${source} Promise.all([read(async () => 'ready'), read(async () => { throw []; })]);`);

        deepStrictEqual(Array.from(actual), ['ready', 42]);
        const summary = createAnalysis({ source }).checkFunction({ index: 0 });
        const { fact: { incomplete = false } = {} } = summary;

        deepStrictEqual(familiesOf(summary), ['number']);
        strictEqual(incomplete, true, 'Unknown fulfillment stays beside the known handler return');
    });

    test('protected failure width and successive calls retain shared work across contrary warm requirements', () => {
        ['wide', 'successive'].forEach((shape) => {
            const samples = [8, 16, 32].map((size) => {
                const step = 'const step = () => { try { return external(); } catch { return 42; } };';
                const helpers = Array.from({ length: size }, (unused, index) => {
                    const previous = index ? `f${index - 1}` : 'step';

                    return `const f${index} = () => { try { return external(${previous}()); } catch { return 42; } };`;
                }).join(' ');
                const source = shape === 'wide'
                    ? `${step} const read = () => [${Array.from({ length: size }, () => 'step()').join(',')}]; read();`
                    : `${step} ${helpers} const read = () => f${size - 1}(); read();`;
                const analysis = createAnalysis({ source });
                const call = readCall(analysis);
                const work = counter();
                const result = analysis.checkCallResult({ ...call, required: shape === 'wide' ? 'array' : 'string', onWork: event => work.onWork(event) });
                const { status = '', fact: { incomplete = false } = {} } = result;

                deepStrictEqual(familiesOf(result), shape === 'wide' ? ['array'] : ['number']);
                strictEqual(status, shape === 'wide' ? 'agreement' : 'contradiction');
                strictEqual(incomplete, shape !== 'wide');
                ok(work.get('function-context') <= size + 2, 'Each occurrence needs at most its own context, never alias-driven replay');
                const { counts = {} } = analysis;
                const observed = work.read();

                strictEqual(analysis.checkCallResult({ ...call, required: 'number', onWork: event => work.onWork(event) }).status,
                    shape === 'wide' ? 'contradiction' : 'unknown');
                deepStrictEqual(analysis.checkCallResult({ ...call, required: shape === 'wide' ? 'array' : 'string', onWork: event => work.onWork(event) }), result);
                const { counts: repeated = {} } = analysis;

                deepStrictEqual(repeated, counts);
                ['value-demand', 'function-context', 'flow-contribution', 'flow-projection', 'value-selection', 'value-ownership', 'establishment']
                    .forEach(kind => strictEqual(work.get(kind), Reflect.get(observed, kind) || 0, 'Contrary consumers reuse completed source evidence'));

                return counts;
            });

            ['values', 'decisions', 'decisionWork'].forEach((kind) => {
                const [first = {}, second = {}, third = {}] = samples;

                ok(Reflect.get(third, kind) - Reflect.get(second, kind) <= 2 * (Reflect.get(second, kind) - Reflect.get(first, kind)),
                    `${shape}: ${kind} grows affinely under the independently varied composition`);
            });
        });
    });

    test('mixed known and opaque catch evidence survives every observer interruption and query order', () => {
        const source = 'const read = (a, b) => { try { if (a) throw 1; if (b) return 42; external(); } catch (error) { return error ? [] : ""; } }; read(externalA, externalB); read(true, false);';
        const reference = createAnalysis({ source });
        const { index = -1 } = reference.calls.find(({ callee = '' } = {}) => callee === 'read') ?? {};
        const work = counter();
        const expected = reference.checkCallResult({ index, required: 'string', onWork: event => work.onWork(event) });

        deepStrictEqual(familiesOf(expected), ['array', 'number', 'string']);
        const knownCall = readCall(reference);
        const closed = reference.checkCallResult({ ...knownCall, required: 'string' });
        const { fact: { incomplete = true } = {} } = closed;

        deepStrictEqual(familiesOf(closed), ['array']);
        strictEqual(incomplete, false);
        Object.keys(work.read()).forEach((stage) => {
            const analysis = createAnalysis({ source });

            throws(() => analysis.checkCallResult({ index, required: 'string', onWork: ({ kind = '' } = {}) => {
                if (kind === stage) throw new Error(`interrupt ${stage}`);
            } }), new RegExp(`interrupt ${stage}`, 'u'));
            deepStrictEqual(analysis.checkCallResult({ ...knownCall, required: 'string' }), closed, stage);
            analysis.checkFunction({ index: 0 });
            deepStrictEqual(analysis.checkCallResult({ index, required: 'string' }), expected, stage);
        });
        const reordered = createAnalysis({ source });

        reordered.checkFunction({ index: 0 });
        reordered.calls.toReversed().forEach(({ index: call = -1 } = {}) => reordered.checkCall({ index: call }));
        deepStrictEqual(reordered.checkCallResult({ index, required: 'string' }), expected);
        const warm = work.read();

        deepStrictEqual(reference.checkCallResult({ index, required: 'string', onWork: event => work.onWork(event) }), expected);
        ['value-demand', 'function-context', 'flow-contribution', 'flow-projection', 'value-selection', 'value-ownership'].forEach(kind => strictEqual(work.get(kind), Reflect.get(warm, kind) || 0));
    });
}

{
    const familiesOf = familiesOfShared;

    test('template coercion completion stays independent of value conditions and shares sequence work', () => {
        const samples = [16, 32, 64].map((size) => {
            const source = `const run=input=>{${'`${input}`;'.repeat(size)}return [];};`;
            const analysis = createAnalysis({ source });
            const work = counter();
            const result = analysis.checkFunction({ index: 0, onWork: event => work.onWork(event) });
            const { thrown = false } = result;

            deepStrictEqual(familiesOf(result), ['array']);
            strictEqual(thrown, true, 'Each coercion can fail without changing the normal result family');
            const { counts = {} } = analysis;
            const observed = work.read();

            deepStrictEqual(analysis.checkFunction({ index: 0, onWork: event => work.onWork(event) }), result);
            const { counts: repeated = {} } = analysis;

            deepStrictEqual(repeated, counts);
            ['value-demand', 'function-context', 'flow-contribution', 'flow-projection', 'flow-result'].forEach((kind) => {
                strictEqual(work.get(kind), Reflect.get(observed, kind));
            });

            return counts;
        });

        ['decisionWork', 'decisions', 'values'].forEach(kind => samples.slice(1).forEach((sample, index) => {
            ok(Reflect.get(sample, kind) <= 2 * Reflect.get(samples.at(index), kind) + 1, `${kind} must grow at most affinely for repeated discarded coercions`);
        }));
    });

    test('immutable captured guards use creation prefixes independently of later closure bodies', () => {
        const samples = [16, 32, 64].map((size) => {
            const source = 'const run=({cb}={})=>{if(typeof cb!=="function")return;const first=()=>{const second=()=>{cb();'
                + `${'`${external}`;'.repeat(size)}};return second;};return first;};`;
            const analysis = createAnalysis({ source });
            const { declarations = [] } = analysis;
            const { index = -1 } = declarations.find(({ name = '' } = {}) => name === 'cb');

            strictEqual(analysis.checkDeclaration({ index }).required, false);
            const { counts: { decisionWork = 0 } = {} } = analysis;

            return decisionWork;
        });

        ok(samples.at(0) > 0);
        samples.forEach(count => strictEqual(count, samples.at(0), 'Unexecuted closure tails add no work to an immutable capture proof'));
    });

    test('ordinary analysis has no implicit work cutoff while explicit limits remain enforceable', () => {
        const source = `const run = () => { ${'external();'.repeat(5000)} return []; };`;
        const analysis = createAnalysis({ source });

        deepStrictEqual(familiesOf(analysis.checkFunction({ index: 0 })), ['array']);
        const bounded = createAnalysis({ source, limits: { decisions: 1 } });

        throws(() => bounded.checkFunction({ index: 0 }), /decision limit/u);
    });

    test('successive opaque calls share completion history without an implicit analysis cutoff', () => {
        const samples = [100, 200, 400, 800].map((size) => {
            const source = `const make = ({ onDone } = {}) => { if (typeof onDone !== 'function') return; return () => { ${'onDone();'.repeat(size)} }; };`;
            const analysis = createAnalysis({ source });
            const { functions = [], invocations = [], counts: initial = {} } = analysis;
            const work = counter();
            const inspect = () => {
                const summaries = functions.map(({ index = -1 } = {}) => analysis.checkFunction({ index, onWork: event => work.onWork(event) }));

                invocations.forEach(({ index = -1 } = {}) => strictEqual(analysis.checkInvocation({ index, onWork: event => work.onWork(event) }).status, 'agreement'));

                return summaries;
            };
            const summaries = inspect();
            const { counts = {} } = analysis;
            const { decisionWork = 0, decisions = 0, values = 0 } = counts;
            const { decisionWork: initialWork = 0 } = initial;
            const observed = work.read();

            strictEqual(initialWork, 0, 'Acquisition snapshots do not change after demand');
            ok(Object.isFrozen(counts));
            ok(decisionWork > 0, 'The count must include demand, not the pre-demand zero');
            ok(decisions > 0 && values > 0, 'Storage counters include callee lookup and completed value uses');
            strictEqual(work.get('capability-use'), size);
            deepStrictEqual(familiesOf(summaries.at(1)), ['nullish'], 'Effect-only completion remains valid');
            strictEqual(summaries.at(1).thrown, true, 'Opaque failures remain possible');
            strictEqual(summaries.at(1).status, 'agreement');
            deepStrictEqual(inspect(), summaries);
            const { counts: repeated = {} } = analysis;

            deepStrictEqual(repeated, counts);
            ['value-demand', 'function-context', 'flow-contribution', 'flow-projection', 'flow-result',
                'value-selection', 'value-ownership', 'capability-use', 'capture-proof'].forEach(kind => strictEqual(work.get(kind), Reflect.get(observed, kind) || 0));

            return { decisionWork, decisions, values, projections: work.get('flow-projection') };
        });

        ['decisionWork', 'decisions', 'values', 'projections'].forEach(kind => samples.slice(2).forEach((sample, index) => {
            const previous = Reflect.get(samples.at(index + 1), kind);
            const before = Reflect.get(samples.at(index), kind);

            ok(Reflect.get(sample, kind) - previous <= 2 * (previous - before), `${kind} must grow affinely on a straight sequence`);
        }));
    });

    test('long opaque prefixes preserve selected returns, explicit failure and guard ownership', () => {
        const prefix = 'external();'.repeat(200);
        const cases = [
            [`${prefix} return flag ? [] : 42;`, ['array', 'number'], 'contradiction', true],
            [`if (flag) throw 1; ${prefix} return flag ? [] : 'ready';`, ['string'], 'agreement', true],
            [`try { if (flag) return []; ${prefix} return 'dependent'; } catch (error) { return 42; }`, ['array', 'number'], 'contradiction', 'unknown'],
            [`try { if (flag) return []; ${prefix} } finally { if (!flag) return 42; }`, ['array', 'number'], 'contradiction', false],
            [`try { ${prefix} return []; } finally { throw 1; }`, [], 'agreement', true]
        ];

        cases.forEach(([body = '', families = [], status = '', thrown = false] = []) => {
            const analysis = createAnalysis({ source: `const read = flag => { ${body} };` });
            const summary = analysis.checkFunction({ index: 0 });
            const { status: actualStatus = '', thrown: actualThrown = false } = summary;

            deepStrictEqual(familiesOf(summary), families, body);
            strictEqual(actualStatus, status, body);
            strictEqual(actualThrown, thrown, body);
        });
        ['before', 'after', 'sibling'].forEach((placement) => {
            const guard = `if (typeof ${placement === 'sibling' ? 'other' : 'onDone'} !== 'function') return;`;
            const body = placement === 'after' ? `${prefix} onDone(); ${guard}` : `${guard} ${prefix} onDone();`;
            const analysis = createAnalysis({ source: `const run = ({ onDone, other } = {}) => { ${body} };` });
            const { invocations = [] } = analysis;
            const invocation = invocations.find(({ optionalCallback = false } = {}) => optionalCallback);

            strictEqual(analysis.checkInvocation(invocation).status, placement === 'before' ? 'agreement' : 'contradiction');
        });
    });

    test('completion projection retries after observer failure without publishing incomplete results', () => {
        const source = `const read = flag => { if (flag) return []; ${'external();'.repeat(200)} return 42; }; read(true); read(false);`;
        const expected = createAnalysis({ source });
        const analysis = createAnalysis({ source });

        throws(() => analysis.checkFunction({ index: 0, onWork: ({ kind = '' } = {}) => {
            if (kind === 'flow-projection') throw new Error('interrupted projection');
        } }), /interrupted projection/u);
        const { calls = [] } = analysis;

        calls.filter(({ callee = '' } = {}) => callee === 'read').toReversed().forEach(({ index = -1 } = {}) => {
            deepStrictEqual(analysis.checkCallResult({ index, required: 'array' }), expected.checkCallResult({ index, required: 'array' }));
        });
        deepStrictEqual(analysis.checkFunction({ index: 0 }), expected.checkFunction({ index: 0 }));
    });
}

{
    const lint = (source, rule, { filename = '' } = {}) => new Linter({ cwd: filename ? dirname(filename) : process.cwd() }).verify(source, {
        plugins: { resilient: plugin }, rules: { [`resilient/${rule}`]: 'error' }
    }, { ...(filename ? { filename } : {}) });
    const operations = analysis => analysis.memberAccesses.map(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }));
    const warm = (analysis) => {
        analysis.functions.toReversed().forEach(({ index = -1 } = {}) => analysis.checkFunction({ index }));
        analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
        analysis.memberAccesses.toReversed().forEach(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }));
    };

    test('native length results preserve numeric agreement through calls, joins and source revision', () => {
        const source = [
            'const size=items=>items.length;',
            'const count=size(flag?[]:"ready");const alias=count;',
            'const items=flag?[]:external;observe(items);const selected=items.length;',
            'const mixed=flag=>flag?size("ready"):"";',
            'const safe=()=>{try{return [].length?false:"".length;}catch{return false;}};',
            'alias.trim();selected.trim();'
        ].join('');
        const analysis = createAnalysis({ source });
        const results = analysis.receivers.map(({ index = -1 } = {}) => analysis.check({ index }));
        const [complete = {}, joined = {}] = results;
        const { fact: { families: completeFamilies = [], incomplete: completeUnknown = true } = {} } = complete;
        const { fact: { families: joinedFamilies = [], incomplete: joinedUnknown = false } = {} } = joined;

        deepStrictEqual(completeFamilies, ['number']);
        strictEqual(completeUnknown, false);
        deepStrictEqual(joinedFamilies, ['number']);
        strictEqual(joinedUnknown, true, 'A possible external length result cannot erase the known numeric contribution');
        strictEqual(lint(source, 'signature-contract-operation').length, 2);
        strictEqual(lint(source, 'signature-contract-return-consistency').length, 2);
        strictEqual(analysis.checkFunction({ index: 2 }).status, 'agreement', 'A native length read does not invent a failure path to the catch');
        const reversed = createAnalysis({ source });

        warm(reversed);
        deepStrictEqual(reversed.receivers.map(({ index = -1 } = {}) => reversed.check({ index })), results);
        const interrupted = createAnalysis({ source });
        const failure = new Error('length selection interruption');

        throws(() => interrupted.check({ index: 1, onWork: ({ kind = '' } = {}) => {
            if (kind === 'value-selection') throw failure;
        } }), error => error === failure);
        deepStrictEqual(interrupted.receivers.map(({ index = -1 } = {}) => interrupted.check({ index })), results);
        const grown = 'const items=[];items[2]=42;const read=()=>items.length?42:"ready";read().trim();';

        strictEqual(runInNewContext(grown.replace('read().trim()', 'read()')), 42);
        const changed = createAnalysis({ source: `${grown}items.length.trim();` });

        ok(changed.check({ index: 0 }).fact.families.includes('number'), 'Mutation cannot retain an obsolete zero length and erase the real numeric result');
        deepStrictEqual(changed.check({ index: 1 }).fact.families, ['number'], 'Retiring array contents cannot erase the intrinsic length type');
        const revised = createAnalysis({ source: source.replace('alias=count', 'alias="ready"') });

        strictEqual(revised.check({ index: 0 }).status, 'agreement');
        deepStrictEqual(analysis.receivers.map(({ index = -1 } = {}) => analysis.check({ index })), results, 'The prior source snapshot stays historical');
    });

    // Invalid programs below challenge evidence; they are not approved dialect examples.
    [
        ['stored object transfer', 'const make=({items=[]}={})=>({items});make({}).items.toUpperCase();', 1],
        ['renamed object transfer', 'const make=({rows=[]}={})=>({value:rows});make({}).value.toUpperCase();', 1],
        ['alias before transfer', 'const make=()=>{const items=[];const alias=items;return {alias};};make().alias.toUpperCase();', 1],
        ['supplied value is not validated', 'const make=({items=[]}={})=>({items});make({items:""}).items.toUpperCase();', 0],
        ['nested object transfer', 'const make=({items=[]}={})=>({data:{items}});make({}).data.items.toUpperCase();', 1],
        ['transfer then original alias mutation', 'const make=()=>{const items=[];const result={items};items.toUpperCase=()=>"";return result;};make().items.toUpperCase();', 0],
        ['two outgoing aggregate aliases', 'const make=()=>{const items=[];const other={items};const result={items};external(other);return result;};make().items.toUpperCase();', 0],
        ['aggregate mutation', 'const make=()=>{const items=[];const result={items};result.items="";return result;};make().items.toUpperCase();', 0],
        ['aggregate escape', 'const make=()=>{const items=[];const result={items};external(result);return result;};make().items.toUpperCase();', 0],
        ['captured transfer source', 'const make=()=>{const items=[];const change=()=>external(items);return {items};};make().items.toUpperCase();', 0],
        ['callback stored by caller can mutate supplied value', 'const items=[];const make=value=>({value});const result=make(items);external(items);result.value.toUpperCase();', 0],
        ['selected borrowed field cannot escape with stale structure',
            'const items=[];const input={items};const make=({items}={})=>({items});const result=make(input);external(input);result.items.toUpperCase();', 0],
        ['direct borrowed return cannot retain caller structure', 'const items=[];const identity=value=>value;const result=identity(items);external(items);result.toUpperCase();', 0],
        ['fresh returned argument retains sole ownership', 'const identity=value=>value;const result=identity({value:42});result.value.trim();', 1],
        ['unknown alternative retains known conflict', 'const make=flag=>flag?{items:[]}:external;make(flag).items.toUpperCase();', 1]
    ].forEach(([name = '', source = '', expected = 0] = []) => test(`boundary completion: ${name}`, () => {
        strictEqual(lint(source, 'signature-contract-operation').length, expected);
        const first = createAnalysis({ source });
        const second = createAnalysis({ source });
        const before = operations(first);

        strictEqual(before.filter(({ conflicts = [] } = {}) => conflicts.length).length, expected);
        warm(second);
        deepStrictEqual(operations(second), before);
        deepStrictEqual(operations(first), before);
    }));

    [
        ['authored array absence', 'const f=({items=[]}={})=>{const {length}=items;return length;};', 1],
        ['renamed array absence', 'const f=({rows:list=[]}={})=>{const {length}=list;return length;};', 1],
        ['empty value-field default leaves undeclared fields open', 'const f=({items={}}={})=>{const {length}=items;return length;};', 0],
        ['supplied closed record still has a missing required field', 'const f=({items={}}={})=>{const {length}=items;return length;};f({items:{}});', 1],
        ['authored record field absence is owned', 'const f=({items={}}={})=>{const {length=0}=items;return length;};', 0],
        ['supplied array', 'const f=items=>{const {length}=items;return length;};f([]);', 1],
        ['supplied record', 'const f=items=>{const {length}=items;return length;};f({length:1});', 0],
        ['unknown supplied value', 'const f=items=>{const {length}=items;return length;};f(external);', 0],
        ['member result is not its cached receiver', 'const rows=[];const {value}=rows.unknown;rows.trim();', 0],
        ['guarded unreachable pattern', 'const f=({items=[]}={})=>{if(false){const {length}=items;return length;}};', 0]
    ].forEach(([name = '', source = '', expected = 0] = []) => test(`source-use pattern: ${name}`, () => {
        strictEqual(lint(source, 'signature-contract-destructuring').length, expected);
    }));

    [
        ['unguarded captured callback', 'const f=({onItem}={})=>[1].forEach(item=>onItem(item));', 1],
        ['guard before creation', 'const f=({onItem}={})=>{if(typeof onItem!=="function")return;return [1].forEach(item=>onItem(item));};', 0],
        ['guard after creation', 'const f=({onItem}={})=>{const later=()=>onItem();if(typeof onItem!=="function")return;return later;};', 1],
        ['shadowed callback', 'const f=({onItem}={})=>{if(typeof onItem!=="function")return;return ({onItem}={})=>onItem();};', 1],
        ['callee guard independent of supplied callback', 'const f=({onItem}={})=>()=>onItem();f({onItem:()=>1});', 1],
        ['guarded nested creation', 'const f=({onItem}={})=>{if(typeof onItem!=="function")return;return ()=>()=>onItem();};', 0]
    ].forEach(([name = '', source = '', expected = 0] = []) => test(`closure obligation: ${name}`, () => {
        strictEqual(lint(source, 'no-unguarded-callback-invocation').length, expected);
    }));

    [
        ['first body is guaranteed', 'do{take(1);}while(false);', 1],
        ['first body before unknown test', 'do{take(1);}while(flag);', 1],
        ['break skips later body', 'do{break;take(1);}while(false);', 0],
        ['continue skips later body', 'do{continue;take(1);}while(false);', 0],
        ['test follows continue', 'do{continue;}while(take(1));', 1],
        ['break skips test', 'do{break;}while(take(1));', 0],
        ['finally executes before break', 'do{try{break;}finally{take(1);}}while(false);', 1],
        ['finally break replaces continue', 'do{try{continue;}finally{break;}}while(take(1));', 0],
        ['nested do owns break', 'do{do{break;}while(false);take(1);}while(false);', 1],
        ['body throw skips test', 'do{throw 1;}while(take(1));', 0]
    ].forEach(([name = '', body = '', expected = 0] = []) => test(`do completion: ${name}`, () => {
        const source = `const take=()=>0;const run=()=>{${body}};`;

        strictEqual(lint(source, 'signature-contract-call-site').length, expected);
    }));

    const imported = (provider, source = 'import {read} from "provider";read({}).toUpperCase();', additions = {}) => createAnalysis({
        source, filename: 'consumer', resolveModule: ({ source: name = '' } = {}) => ({ filename: name, source: name === 'provider' ? provider : Reflect.get(additions, name) || '' })
    });
    [
        ['default array producer', 'export const read=({items=[]}={})=>items;', 1],
        ['number producer', 'export const read=()=>0;', 1],
        ['string producer', 'export const read=()=>"";', 0],
        ['mixed known and unknown', 'export const read=()=>flag?[]:external;', 1],
        ['incompatible known returns', 'export const read=()=>flag?[]:0;', 1],
        ['mutable export identity', 'export let read=()=>[];read=external;', 0],
        ['initialization throws', 'throw 1;export const read=()=>[];', 0],
        ['initialization is unsupported', 'while(flag)external();export const read=()=>[];', 0],
        ['receiver-sensitive method', 'export const read=function(){return this.items;};', 0],
        ['opaque provider execution', 'export const read=()=>{eval("anything");return [];};', 0]
    ].forEach(([name = '', provider = '', expected = 0] = []) => test(`imported completion: ${name}`, () => {
        const first = imported(provider);
        const second = imported(provider);
        const before = operations(first);

        strictEqual(before.filter(({ conflicts = [] } = {}) => conflicts.length).length, expected);
        warm(second);
        deepStrictEqual(operations(second), before);
    }));

    test('namespace aliases and named namespace barrels share immutable callable identity', () => {
        const provider = 'export const read=()=>[];';
        const sources = [
            'import * as api from "provider";api.read().toUpperCase();',
            'import * as api from "provider";const alias=api;alias.read().toUpperCase();',
            'import {api} from "barrel";api.read().toUpperCase();',
            'import {api} from "barrel";const f=()=>api.read().toUpperCase();'
        ];

        sources.forEach(source => strictEqual(operations(imported(provider, source, { barrel: 'export * as api from "provider";' }))
            .filter(({ conflicts = [] } = {}) => conflicts.length).length, 1));
        strictEqual(operations(imported('export let read=()=>[];read=external;', sources.at(0))).filter(({ conflicts = [] } = {}) => conflicts.length).length, 0);
    });

    test('namespace stars remain open when their export set is unresolved', () => {
        const analysis = imported('export * from "external";', 'import * as api from "provider";api.read();');

        strictEqual(operations(analysis).some(({ missing = false } = {}) => missing), false);
    });

    test('module cycles cannot manufacture a completed initialization', () => {
        const analysis = imported('import "cycle";export const read=()=>[];', 'import {read} from "provider";read().toUpperCase();', { cycle: 'import "provider";' });

        strictEqual(operations(analysis).some(({ conflicts = [] } = {}) => conflicts.length), false);
    });

    test('foreign producer provenance survives aliases, field transfer and returned callables', () => {
        const source = 'import {make as factory} from "barrel";const read=factory();read({}).items.toUpperCase();';
        const provider = 'export const make=()=>\n({items=[]}={})=>({items});';
        const analysis = imported(provider, source, { barrel: 'export {make} from "provider";' });
        const [{ producers = [] } = {}] = operations(analysis).filter(({ conflicts = [] } = {}) => conflicts.length);

        deepStrictEqual(producers.map(({ module = '', location: { line = 0 } = {} } = {}) => [module, line]), [['provider', 2]]);
        const revised = imported(provider.replace('items=[]', 'items=""'), source, { barrel: 'export {make} from "provider";' });

        strictEqual(operations(revised).some(({ conflicts = [] } = {}) => conflicts.length), false);
        deepStrictEqual(operations(analysis).filter(({ conflicts = [] } = {}) => conflicts.length).at(0).producers, producers);
    });

    test('module snapshots and operational failures remain distinct', () => {
        const source = 'import {read} from "provider";read().toUpperCase();';
        const failure = new Error('source acquisition failed');

        strictEqual(operations(createAnalysis({ source, resolveModule: () => false })).some(({ conflicts = [] } = {}) => conflicts.length), false);
        throws(() => createAnalysis({ source, resolveModule: () => { throw failure; } }), error => error === failure);
        throws(() => createAnalysis({ source, resolveModule: () => ({ filename: 'provider', source: false }) }), TypeError);
    });

    test('every observed boundary proof interruption preserves the published result', () => {
        const source = 'import {read} from "provider";const idle=()=>external(Boolean);void idle;read({}).items.toUpperCase();false.map(Boolean);';
        const provider = 'export const read=({items=[]}={})=>({items});';
        const baseline = imported(provider, source);
        const work = [];
        const expected = baseline.memberAccesses.map(({ index = -1 } = {}) => baseline.checkMemberAccess({ index, onWork: event => append(work, event) }));

        work.forEach((_, stop) => {
            const analysis = imported(provider, source);
            const failure = new Error(`interrupted boundary proof ${stop}`);
            const visits = [];

            throws(() => analysis.memberAccesses.forEach(({ index = -1 } = {}) => analysis.checkMemberAccess({ index, onWork(event) {
                append(visits, event);

                if (visits.length === stop + 1) throw failure;
            } })), error => error === failure);
            deepStrictEqual(operations(analysis), expected);
        });
    });

    test('product operations follow module revision and deletion without borrowing prior evidence', (context) => {
        const directory = mkdtempSync(join(tmpdir(), 'resilient-boundary-'));

        context.after(() => rmSync(directory, { recursive: true, force: true }));
        const provider = join(directory, 'provider.js');
        const filename = join(directory, 'consumer.js');
        const source = 'import {read as get} from "./provider.js";get({}).items.toUpperCase();';

        writeFileSync(provider, 'export const read=({items=[]}={})=>({items});');
        const first = lint(source, 'signature-contract-operation', { filename });

        strictEqual(first.length, 1);
        strictEqual(first.at(0).message.includes(`${provider} at line 1`), true);
        writeFileSync(provider, 'export const read=({items=""}={})=>({items});');
        deepStrictEqual(lint(source, 'signature-contract-operation', { filename }), []);
        rmSync(provider);
        deepStrictEqual(lint(source, 'signature-contract-operation', { filename }), []);
    });
}

{
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
}

{
    const rule = 'resilient/signature-contract-return-consistency';
    const engine = selected => new ESLint({ overrideConfigFile: true, overrideConfig: [{
        plugins: { resilient: selected }, rules: { [rule]: 'error' }, languageOptions: { ecmaVersion: 'latest', sourceType: 'module' }
    }] });
    const product = engine(plugin);
    const { cases: preservedFindings = [] } = JSON.parse(readFileSync(new URL('./fixtures/return-findings.json', import.meta.url), 'utf8'));
    const findings = async (source, lint = product) => {
        const [{ messages = [], fatalErrorCount = 0 } = {}] = await lint.lintText(source);

        strictEqual(fatalErrorCount, 0);

        return messages;
    };

    // These are single-rule fixtures, including deliberate violations. Silence from
    // this rule does not approve their signatures, guards, or other dialect policy.
    [
        ['conditional', 'const read = (flag = false) => flag ? [] : "";', 2],
        ['statement returns', 'const read = (flag = false) => { if(flag) return []; return ""; };', 2],
        ['returned alias', 'const read = (flag = false) => { const value = flag ? [] : ""; return value; };', 1],
        ['forwarded call', 'const select = (flag = false) => flag ? [] : ""; const read = (flag = false) => select(flag);', 3],
        ['independent unknown', 'const read = (flag = false, other = false) => { if(flag) return []; if(other) return external; return ""; };', 2],
        ['fallthrough', 'const read = (flag = false) => { if(flag) return []; };', 2],
        ['bare return', 'const read = (flag = false) => { if(flag) return; return []; };', 2],
        ['null', 'const read = (flag = false) => flag ? null : [];', 2],
        ['null versus fallthrough', 'const read = (flag = false) => { if(flag) return null; };', 2],
        ['normal finally', 'const read = (flag = false) => { try { return flag ? [] : ""; } finally { const local = ""; } };', 2],
        ['return finally', 'const read = (flag = false) => { try { return flag ? [] : ""; } finally { return 42; } };', 0],
        ['throw finally', 'const read = (flag = false) => { try { return flag ? [] : ""; } finally { throw 42; } };', 0],
        ['conditional finally', 'const read = (flag = false, replace = false) => { try { return flag ? [] : ""; } finally { if(replace) return 42; } };', 3],
        ['explicit catch', 'const read = (flag = false) => { try { if(flag) return []; throw 42; } catch(error) { return ""; } };', 2],
        ['nested function', 'const read = (flag = false) => { const nested = (other = false) => other ? [] : ""; return flag ? 0 : 1; };', 2],
        ['stable condition', 'const read = (flag = false) => { if(flag) return "yes"; return flag ? [] : "no"; };', 0],
        ['three families', 'const read = (a = false, b = false) => a ? [] : b ? "" : 42;', 3],
        ['effect only', 'const read = (flag = false) => { if(flag) return; external(); };', 0],
        ['defaults do not validate input', 'const read = (value = "") => value; read([]); read("hello");', 0],
        ['identical branches retain both sites', 'const read = (flag = false, other = false) => { const value = flag ? [] : ""; return other ? value : value; };', 2]
    ].forEach(([name = '', source = '', count = 0] = []) => {
        test(`return rule preserves reviewed wording and locations: ${name}`, async () => {
            const actual = await findings(source);
            const { source: expectedSource = '', messages = [] } = preservedFindings.find(({ name: candidate = '' } = {}) => candidate === name);

            strictEqual(actual.length, count);
            strictEqual(source, expectedSource);
            deepStrictEqual(actual, messages);
        });
    });

    test('a selected call cannot repair a producer contract or validate another call', () => {
        const source = 'const read = (flag = false) => flag ? [] : ""; read(true); read(false); read("wrong");';
        const original = createAnalysis({ source }).checkFunction({ index: 0 });
        const { status = '', diagnostics = [] } = original;

        strictEqual(status, 'contradiction');
        strictEqual(diagnostics.length, 2);
        [[0, 1, 2], [2, 1, 0]].forEach((order) => {
            const analysis = createAnalysis({ source });

            order.forEach((index) => {
                strictEqual(analysis.checkCallResult({ index, required: index === 1 ? 'string' : 'array' }).status, 'agreement');
                strictEqual(analysis.checkCall({ index }).status, index === 2 ? 'contradiction' : 'agreement');
                deepStrictEqual(analysis.checkFunction({ index: 0 }), original);
            });
        });
    });

    test('return findings retain known contradictions beside an independent unknown result', () => {
        const source = 'const read = (a = false, b = false) => { if(a) return []; if(b) return external; return ""; };';
        const { status = '', fact: { incomplete = false } = {}, diagnostics = [] } = createAnalysis({ source }).checkFunction({ index: 0 });

        strictEqual(status, 'contradiction');
        strictEqual(incomplete, true);
        deepStrictEqual(diagnostics.map(({ location: { range: [start = 0, end = 0] = [] } = {} } = {}) => source.slice(start, end)), ['[]', '""']);
    });

    test('aliasing or forwarding an incomplete value cannot hide its known contradictory alternatives', async () => {
        const expressions = [
            'const read = (a = false, b = false) => a ? [] : b ? "" : external;',
            'const read = (a = false, b = false) => { const value = a ? [] : b ? "" : external; return value; };',
            'const select = (a = false, b = false) => a ? [] : b ? "" : external; const read = (a = false, b = false) => select(a, b);'
        ];

        await Promise.all(expressions.map(async (source) => {
            const analysis = createAnalysis({ source });
            const { functions = [] } = analysis;
            const { index = -1 } = functions.at(-1);
            const { status = '', diagnostics = [] } = analysis.checkFunction({ index });

            strictEqual(status, 'contradiction');
            ok(diagnostics.length);
            diagnostics.forEach(({ data: { actual = '', expected = '' } = {} } = {}) => deepStrictEqual([actual, expected].toSorted(), ['array', 'string']));
            ok((await findings(source)).length);
        }));
        // Known alternatives must survive the opaque alias; the old checker erased them.
        ok((await findings(expressions.at(1))).length);
    });

    test('unknown nullish possibility never becomes an established null return', () => {
        const source = 'const empty = () => {}; const read = (a = false, b = false) => { const value = a ? empty() : external; if(b) return value; return ""; };';
        const { diagnostics = [] } = createAnalysis({ source }).checkFunction({ index: 1 });

        deepStrictEqual(diagnostics.map(({ data = {} } = {}) => data), [
            { actual: 'undefined', expected: 'string' }, { actual: 'string', expected: 'undefined' }
        ]);
    });

    test('logical results report the operands that can actually survive selection', async () => {
        const source = 'const read = (flag = false) => { const value = flag ? [] : ""; return value || 42; };';
        const [{ message = '', messageId = '', column = 0, endColumn = 0 } = {}] = await findings(source);

        strictEqual(message, 'This || expression returns its array operand, but another return path produces number.');
        strictEqual(messageId, 'inconsistentOperand');
        strictEqual(column, source.indexOf('value ||') + 1);
        strictEqual(endColumn, source.indexOf('value ||') + 'value || 42'.length + 1);
        deepStrictEqual([true, false].map(flag => runInNewContext(`${source} typeof read(${flag});`)), ['object', 'number']);
    });

    test('absence identity survives a returned alias and a forwarding call', () => {
        const source = 'const empty = () => {}; const read = (flag = false) => { const value = flag ? null : empty(); return value; };';
        const { status = '', diagnostics = [] } = createAnalysis({ source }).checkFunction({ index: 1 });

        strictEqual(status, 'contradiction');
        strictEqual(diagnostics.length, 1);
        deepStrictEqual(diagnostics.at(0).data, { actual: 'null', expected: 'undefined' });
        strictEqual(diagnostics.at(0).messageId, 'inconsistentValue');
    });

    test('unsupported execution remains unknown and produces no fabricated return finding', async () => {
        const definitions = [
            'function* (flag = false) { return flag ? [] : ""; }',
            '() => { while(external) {} return []; }',
            '() => { let value = []; value = ""; return value; }',
            '() => { try { external(); return []; } catch(error) { return ""; } }'
        ];

        await Promise.all(definitions.map(async (definition) => {
            const source = `const read = ${definition};`;
            const { status = '', diagnostics = [] } = createAnalysis({ source }).checkFunction({ index: 0 });

            strictEqual(status, 'unknown');
            deepStrictEqual(diagnostics, []);
            deepStrictEqual(await findings(source), []);
        }));
    });

    test('return evidence is immutable and belongs to the acquired host snapshot', () => {
        const source = 'const read = (flag = false) => flag ? [] : "";';
        const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
        const analysis = createProgramAnalysis({ program });
        const { body: [{ declarations: [{ init: { body = {} } = {} } = {}] = [] } = {}] = [] } = program;
        const { consequent = {} } = body;
        const original = analysis.checkFunction({ index: 0 });

        Object.defineProperty(body, 'alternate', { value: consequent });
        deepStrictEqual(analysis.checkFunction({ index: 0 }), original);
        strictEqual(createProgramAnalysis({ program }).checkFunction({ index: 0 }).status, 'agreement');
        const { diagnostics = [] } = original;

        [original, diagnostics, ...diagnostics,
            ...diagnostics.flatMap(({ data = {}, location = {} } = {}) => [data, location]),
            ...diagnostics.map(({ location: { range = [] } = {} } = {}) => range)
        ].forEach(value => ok(Object.isFrozen(value)));
    });

    test('return observation failure propagates and retry preserves all findings', () => {
        const source = 'const read = (flag = false) => flag ? [] : "";';
        const analysis = createAnalysis({ source });
        const failure = new Error('return observation failed');

        throws(() => analysis.checkFunction({ index: 0, onWork: ({ kind = '' } = {}) => {
            if (kind === 'flow-result') throw failure;
        } }), error => error === failure);
        deepStrictEqual(analysis.checkFunction({ index: 0 }), createAnalysis({ source }).checkFunction({ index: 0 }));
        throws(() => createAnalysis({ source, limits: { demand: 1 } }).checkFunction({ index: 0 }), /demand limit/);
    });

    test('return rule failures propagate through the host', async () => {
        const failure = new Error('return source failed');
        const injector = { rules: { fail: { create() {
            return { 'Program:exit'({ body: [{ declarations: [{ init: { body = {} } = {} } = {}] = [] } = {}] = [] } = {}) {
                Object.defineProperty(body, 'consequent', { get() { throw failure; } });
            } };
        } } } };
        const lint = new ESLint({ overrideConfigFile: true, overrideConfig: [{ plugins: { injector, resilient: plugin },
            rules: { 'injector/fail': 'error', [rule]: 'error' } }] });

        await rejects(() => lint.lintText('const read = flag => flag ? [] : "";'), error => error === failure);
    });
}

{
    const cases = JSON.parse(readFileSync(new URL('./fixtures/calls-completions.json', import.meta.url), 'utf8'));
    const callRule = 'signature-contract-call-site';
    const returnRule = 'signature-contract-return-consistency';
    const guardRule = 'no-unguarded-callback-invocation';
    const names = [callRule, returnRule, guardRule];
    const rulesFor = selected => Object.fromEntries(selected.map(name => [`resilient/${name}`, 'error']));
    const lint = (source, selected = names, options = {}) => new Linter().verify(source, {
        plugins: { resilient: plugin }, rules: rulesFor(selected), ...options
    });
    const spans = (source, findings) => findings.map(({ column = 0, endColumn = 0 } = {}) => source.slice(column - 1, endColumn - 1));

    cases.forEach(({ rule = '', source = '', languageOptions = {}, expected = [] } = {}) => test(`${rule} source contract: ${source}`, () => {
        deepStrictEqual(lint(source, [rule], { languageOptions }), expected);
    }));

    [
        [callRule, 'const read=(value="")=>value;read(42);', 1],
        [returnRule, 'const read=flag=>flag?[]:"";', 2],
        [guardRule, 'const run=({done}={})=>done();', 1]
    ].forEach(([name = '', source = '', count = 0] = []) => {
        test(`public configuration, documentation and unchanged source: ${name}`, () => {
            const rule = `resilient/${name}`;
            const { rules = {}, configs: { contracts = {}, safety = {} } = {} } = plugin;
            const { meta: { docs: { url = '' } = {}, fixable = false, hasSuggestions = false } = {} } = Reflect.get(rules, name);

            strictEqual(url, `https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/${name}.md`);
            strictEqual(fixable, false);
            strictEqual(hasSuggestions, false);
            deepStrictEqual(lint(source, [name], { rules: { [rule]: 'off' } }), []);
            const warnings = lint(source, [name], { rules: { [rule]: 'warn' } });

            strictEqual(warnings.length, count);
            ok(warnings.every(({ severity = 0 } = {}) => severity === 1));
            strictEqual(lint(source, [name]).length, count);
            strictEqual(new Linter().verify(source, name === guardRule ? safety : contracts).filter(({ ruleId = '' } = {}) => ruleId === rule).length, count);
            const { output = '', fixed = false } = new Linter().verifyAndFix(source, { plugins: { resilient: plugin }, rules: rulesFor([name]) });

            strictEqual(output, source);
            strictEqual(fixed, false);
        });

        test(`exact local exception remains rule-owned: ${name}`, () => {
            const engine = new Linter();
            const findings = engine.verify(`// eslint-disable-next-line resilient/${name} -- Deliberate negative fixture.\n${source}`,
                { plugins: { resilient: plugin }, rules: rulesFor([name]) });

            deepStrictEqual(findings, []);
            strictEqual(engine.getSuppressedMessages().length, count);
        });
    });

    [
        ['flag?42:"ok"', 'number-like'],
        ['flag?null:void 0', 'null or undefined'],
        ['flag?null:"ok"', 'null or undefined'],
        ['flag?42:void 0', 'number-like'],
        ['flag?null:other?42:void 0', 'null or undefined or number-like'],
        ['flag?42:external', 'number-like'],
        ['flag?"ok":other?42:external', 'number-like'],
        ['flag?[]:"ok"', 'array-like']
    ].forEach(([value = '', actual = ''] = []) => {
        [false, true].forEach(nested => test(`contradiction wording excludes compatible alternatives: ${nested ? 'field' : 'formal'} ${value}`, () => {
            const source = nested ? `const read=({name=""}={})=>name;read({name:${value}});` : `const read=(name="")=>name;read(${value});`;
            const findings = lint(source, [callRule]);

            strictEqual(findings.length, 1);
            strictEqual(findings.at(0).message, `${nested ? 'name' : 'argument'} expects string-like, but this call supplies ${actual}.`);
            deepStrictEqual(spans(source, findings), [value]);
            const analysis = createAnalysis({ source });
            const calls = analysis.calls.filter(({ callee = '' } = {}) => callee === 'read');

            strictEqual(calls.length, 1);
            strictEqual(analysis.checkCall({ index: calls.at(0).index }).status, 'contradiction');
        }));
    });

    test('wording preserves complete normalized public evidence and native default behavior', () => {
        const source = 'const read=(value="")=>value;read(flag?null:void 0);';
        const analysis = createAnalysis({ source });
        const { obligations = [] } = analysis.checkCall({ index: 0 });
        const { facts = [], absence = '' } = obligations.at(0);
        const families = facts.filter(({ facet = '' } = {}) => facet === 'family').flatMap(({ families = [] } = {}) => families);

        deepStrictEqual(families.toSorted(), ['nullish', 'string']);
        strictEqual(absence, 'unknown');
        strictEqual(runInNewContext('const read=(value="")=>value;JSON.stringify([read(null),read(void 0)]);'), '[null,""]');
        deepStrictEqual(lint('const read=(value="")=>value;read();read(void 0);read("ok");', [callRule]), []);
    });

    [
        ['const read=(value="")=>value;const apply=value=>read(value);apply(42);apply(42);', ['apply(42)', 'apply(42)']],
        ['const read=(value="")=>value;const apply=()=>read(42);apply();apply();', ['42']],
        ['const read=(value="")=>value;const apply=(cb,value)=>cb(value);const relay=(cb,value)=>apply(cb,value);relay(read,42);', ['relay(read,42)']],
        ['const read=(value="")=>value;const apply=value=>{try{return read(value);}finally{return [];}};apply(42);', ['apply(42)']],
        ['const read=(value="")=>value;const apply=value=>{try{throw 0;}finally{return read(value);}};apply(42);', ['apply(42)']],
        ['const read=(value="")=>value;const apply=value=>{throw 0;read(value);};apply(42);', []],
        ['const read=(value="")=>value;const apply=value=>read(value);apply(flag?42:"ok");', ['apply(flag?42:"ok")']]
    ].forEach(([source = '', expected = []] = []) => test(`completed obligations retain forwarding location and avoid duplicate direct findings: ${source}`, () => {
        const findings = lint(source, [callRule]);

        deepStrictEqual(spans(source, findings), expected);
        findings.forEach(({ message = '' } = {}) => strictEqual(message, 'argument expects string-like, but this call supplies number-like.'));
    }));

    [
        ['const read=cb=>{if(cb())return "a";return cb()?1:"b";};', 3],
        ['const shape=x=>Array.isArray(x)?[]:{};const copy=read=>shape(read());', 3],
        ['const isFunction=value=>typeof value==="function";const read=value=>isFunction(value)?value:"";', 2],
        ['const read=value=>isFunction(value)?value:"";', 0],
        ['const read=({name=""}={})=>name&&name!=="a";', 0],
        ['const read=({name=""}={})=>{if(typeof name==="string")return name&&name!=="a";return false;};', 2],
        ['const run=({done}={})=>{if(typeof done!=="function")return;return done;};', 2],
        ['const run=({done}={})=>{if(typeof done!=="function")return;done();};', 0],
        ['const read=flag=>{try{return flag?[]:"";}finally{return 42;}};', 0],
        ['const read=flag=>{try{return flag?[]:"";}finally{if(other)throw 42;}};', 2],
        ['const read=async flag=>{if(flag)return [];throw "failure";};', 0],
        ['const read=async flag=>{if(flag)return [];return "";};', 2]
    ].forEach(([source = '', count = 0] = []) => test(`producer evidence owns returns independently of invocation guards: ${source}`, () => {
        strictEqual(lint(source, [returnRule]).length, count);
    }));

    test('unknown default execution preserves independent authored return contradictions', () => {
        const analysis = createAnalysis({ source: 'const read=(callback=external())=>{if(flag)return [];return "";};' });
        const { status = '', fact: { families = [] } = {} } = analysis.checkFunction({ index: 0 });

        strictEqual(status, 'contradiction');
        deepStrictEqual(families.toSorted(), ['array', 'string']);
    });

    [
        ['const run=({done}={})=>done();', 1],
        ['const run=({done}={})=>{if(typeof done==="function")done();};', 0],
        ['const run=({done}={})=>isFunction(done)&&done();', 0],
        ['const isFunction=value=>true;const run=({done}={})=>isFunction(done)&&done();', 1],
        ['const check=value=>typeof value==="function";const run=({done}={})=>check(done)&&done();', 0],
        ['const run=({done}={})=>{const alias=done;if(typeof alias==="function")done();};', 0],
        ['const run=({done}={})=>{if(typeof done==="function")return ()=>done();};', 0],
        ['const run=({done}={})=>{const invoke=()=>done();if(typeof done==="function")return invoke;};', 1],
        ['const run=({done}={})=>{if(typeof done!=="function")return;external();done();};', 0],
        ['const run=({done}={})=>send(done);', 0],
        ['const run=({done=actualContract}={})=>done();', 0]
    ].forEach(([source = '', count = 0] = []) => test(`callback capability follows binding, guard and closure lifetime: ${source}`, () => {
        strictEqual(lint(source, [guardRule]).length, count);
    }));

    [
        'const run=({done}={})=>{if(typeof done==="function"){done=external;done();}};',
        'const run=({done}={})=>{if(typeof done==="function"){const invoke=()=>done();done=external;return invoke;}};',
        'const isFunction=()=>true;const run=({done}={})=>isFunction(done)&&done();'
    ].forEach(source => test(`mutable bindings and constant helpers retain their findings: ${source}`, () => {
        const analysis = createAnalysis({ source });
        const invocations = analysis.invocations.filter(({ optionalCallback = false } = {}) => optionalCallback);

        strictEqual(invocations.length, 1);
        strictEqual(analysis.checkInvocation({ index: invocations.at(0).index }).status, 'contradiction');
        strictEqual(lint(source, [guardRule]).length, 1);
    }));

    test('producer, call and guard queries are isolated across order and revisions', () => {
        const source = 'const read=flag=>flag?[]:"";read(true);read(false);const run=({done}={})=>done();';
        const inspect = (analysis, reverse = false) => {
            const queries = [
                ...analysis.calls.map(({ index = -1 } = {}) => () => analysis.checkCall({ index })),
                ...analysis.calls.map(({ index = -1 } = {}) => () => analysis.checkCallResult({ index, required: 'array' })),
                ...analysis.functions.map(({ index = -1 } = {}) => () => analysis.checkFunction({ index })),
                ...analysis.invocations.map(({ index = -1 } = {}) => () => analysis.checkInvocation({ index }))
            ];

            ok(analysis.calls.length && analysis.functions.length && analysis.invocations.length);

            if (reverse) queries.toReversed().forEach(query => query());

            return queries.map(query => query());
        };
        const first = createAnalysis({ source });
        const expected = inspect(first);

        deepStrictEqual(inspect(createAnalysis({ source }), true), expected);
        const revised = source.replace('=>done()', '=>{if(typeof done==="function")done();}');

        deepStrictEqual(lint(revised, [guardRule]), []);
        strictEqual(lint(source, [guardRule]).length, 1);
        deepStrictEqual(inspect(first, true), expected);
        const findings = lint(source);
        // Equal-location diagnostics follow rule registration order in the host.
        // Compare every complete finding while normalizing only presentation order.
        const ordered = (messages = []) => messages.toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

        strictEqual(findings.length, 4);
        names.forEach((name, index) => {
            const order = [...names.slice(index), ...names.slice(0, index)];

            strictEqual(order.at(0), name);
            deepStrictEqual(ordered(lint(source, order)), ordered(findings));
            deepStrictEqual(ordered(lint(source, order.toReversed())), ordered(findings));
        });
    });
}
