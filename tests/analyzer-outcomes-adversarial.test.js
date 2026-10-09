import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';

import { counter } from './support/work.js';

const familiesOf = ({ fact: { families = [] } = {} } = {}) => families.toSorted();
const readCall = ({ calls = [] } = {}) => calls.findLast(({ callee = '' } = {}) => callee === 'read');

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
            deepStrictEqual(familiesOf(summary), ['array', 'number'], source);
            const { index: general = -1 } = calls.find(({ callee = '' } = {}) => callee === 'read');

            strictEqual(analysis.checkCallResult({ index: general, required: 'string' }).status, 'contradiction', source);
            deepStrictEqual([...new Set(returns.flatMap(familiesOf))].toSorted(), ['array', 'number'], source);
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
        ['if (a) throw 1; external();', 'return [];', 'finally { if (a) return 42; }', ['number']],
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
    deepStrictEqual(familiesOf(uncertain.checkFunction({ index: 0 })), []);
});

test('mixed known and opaque catch evidence survives every observer interruption and query order', () => {
    const source = 'const read = (a, b) => { try { if (a) throw 1; if (b) return 42; external(); } catch (error) { return []; } }; read(externalA, externalB);';
    const reference = createAnalysis({ source });
    const { index = -1 } = readCall(reference);
    const work = counter();
    const expected = reference.checkCallResult({ index, required: 'string', onWork: event => work.onWork(event) });

    deepStrictEqual(familiesOf(expected), ['array', 'number']);
    Object.keys(work.read()).forEach((stage) => {
        const analysis = createAnalysis({ source });

        throws(() => analysis.checkCallResult({ index, required: 'string', onWork: ({ kind = '' } = {}) => {
            if (kind === stage) throw new Error(`interrupt ${stage}`);
        } }), new RegExp(`interrupt ${stage}`, 'u'));
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
