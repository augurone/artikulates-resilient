import { deepStrictEqual, strictEqual, ok, throws } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { parse } from 'espree';

import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';

import { counter } from './support/work.js';

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

        strictEqual(resultFor({ source }).status, 'unknown', source);
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
