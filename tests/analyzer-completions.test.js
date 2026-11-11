import { deepStrictEqual, strictEqual, ok, throws } from 'node:assert/strict';
import test from 'node:test';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';

import { counter } from './support/work.js';

const familiesOf = ({ fact: { families = [] } = {} } = {}) => families.toSorted();

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
        [`try { if (flag) return []; ${prefix} return 'dependent'; } catch (error) { return 42; }`, ['array'], 'unknown', 'unknown'],
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
