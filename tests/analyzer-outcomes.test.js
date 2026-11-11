import { deepStrictEqual, strictEqual, ok } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';

import { counter } from './support/work.js';

const tags = new Map([['[object String]', 'string'], ['[object Number]', 'number'], ['[object Array]', 'array'], ['[object Undefined]', 'nullish']]);
const readCall = ({ calls = [] } = {}) => calls.findLast(({ callee = '' } = {}) => callee === 'read');
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
    const expressions = ['false && stop()', 'true || stop()', '"ready" ?? stop()', 'false ? stop() : []'];

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
