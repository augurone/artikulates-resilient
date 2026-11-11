import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';

import { queriesFor, queryAnalysis } from './support/analysis-queries.js';
import { counter } from './support/work.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/analysis-compositions.json', import.meta.url), 'utf8'));
const runtimeRoot = fileURLToPath(new URL('../.artifacts/analysis-runtime/', import.meta.url));
const retryCases = new Set(['record discrimination', 'distinct captures', 'map and flatMap', 'catch and finalizer',
    'guarded callable and alias', 'allSettled correlation', 'computed keys', 'nested signature and default']);
const argumentsList = [[false, false], [false, true], [true, false], [true, true]];
const nativeKind = (value) => {
    if (value === null) return 'null';

    return Array.isArray(value) ? 'array' : typeof value;
};
const family = kind => ['null', 'undefined'].includes(kind) ? 'nullish' : kind;
const observe = async (invoke) => {
    try {
        return { kind: nativeKind(await invoke()) };
    } catch {
        return { thrown: true };
    }
};
const programFor = ({ body = '', async: asynchronous = false } = {}, transport) => {
    const keyword = asynchronous ? 'async ' : '';
    const wait = asynchronous ? 'await ' : '';
    const arrow = `${keyword}(left=false,right=false)=>{${body}}`;
    const relay = `${keyword}(left=false,right=false)=>${wait}produce(left,right)`;
    const definitions = new Map([
        ['direct', `const read=${arrow};`],
        ['forwarded', `const produce=${arrow};const read=${relay};`],
        ['captured', `const read=${keyword}(left=false,right=false)=>{const produce=${keyword}()=>{${body}};return ${wait}produce();};`],
        ['imported', `import {produce} from './worker.js';const read=${relay};`],
        ['barrel', `import {forward as produce} from './barrel.js';const read=${relay};`]
    ]);
    const definition = definitions.get(transport);
    const modules = new Map([['./worker.js', `export const produce=${arrow};`], ['./barrel.js', "export {produce as forward} from './worker.js';"]]);
    const source = definition + argumentsList.map(args => `read(${args.join(',')});`).join('');

    return { definition, source, modules };
};

cases.forEach((entry = {}) => ['direct', 'forwarded', 'captured', 'imported', 'barrel'].forEach((transport) => {
    const { name = '', async: asynchronous = false } = entry;

    test(`analysis composition agrees with execution: ${name}, ${transport}`, async (context) => {
        const { definition = '', source = '', modules = new Map() } = programFor(entry, transport);
        const module = ['imported', 'barrel'].includes(transport);

        if (module) mkdirSync(runtimeRoot, { recursive: true });

        const directory = module ? mkdtempSync(join(runtimeRoot, 'composition-')) : '';

        if (module) {
            context.after(() => rmSync(directory, { recursive: true, force: true }));
            modules.forEach((text, filename) => writeFileSync(join(directory, filename), text));
            writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
            writeFileSync(join(directory, 'main.js'), definition + 'export {read};');
        }

        const imported = module ? await import(pathToFileURL(join(directory, 'main.js')).href) : false;
        const read = imported && Reflect.get(imported, 'read');

        if (module && typeof read !== 'function') throw new TypeError('Expected the authored runtime entry');

        const actual = await Promise.all(argumentsList.map(args => observe(() => {
            if (typeof read !== 'function') return runInNewContext(`${definition}read(${args.join(',')});`);

            return read(...args);
        })));
        const kinds = [...new Set(actual.flatMap(({ kind = '' } = {}) => kind ? [kind] : []))].toSorted();
        const expected = [...new Set(kinds.map(family))].toSorted();
        const acquire = () => createAnalysis({ source, filename: 'main.js', resolveModule: ({ source: filename = '' } = {}) => ({
            filename, source: modules.get(filename)
        }) });
        const first = acquire();
        const start = source.indexOf('const read=') + 'const read='.length;
        const { index = -1 } = first.functions.find(({ location: { range: [offset = -1] = [] } = {} } = {}) => offset === start);
        const summary = first.checkFunction({ index });
        const { fact: { families = [], incomplete = false } = {}, diagnostics = [], status = '', normal = false } = summary;

        deepStrictEqual(families.toSorted(), expected, source);
        strictEqual(incomplete, !expected.length, source);
        strictEqual(normal, Boolean(expected.length), source);
        strictEqual(status, kinds.length > 1 ? 'contradiction' : 'agreement', source);
        strictEqual(Boolean(diagnostics.length), kinds.length > 1, source);
        diagnostics.forEach(({ data: { actual: observed = '', expected: other = '' } = {} } = {}) => {
            ok(kinds.includes(observed) && kinds.includes(other) && observed !== other, source);
        });

        // Each supplied call has an independent runtime observation. Generic
        // agreement and query-order agreement alone cannot establish its value.
        const supplied = first.calls.filter(({ callee = '', location: { range: [offset = -1] = [] } = {} } = {}) => (
            callee === 'read' && offset >= definition.length
        ));

        strictEqual(supplied.length, actual.length);
        const observations = new Map(supplied.map(({ index = -1 } = {}, position) => [index, actual.at(position)]));
        const queries = queriesFor(first);
        const baseline = queries.map(query => queryAnalysis(first, query));

        baseline.forEach(({ fact: { families = [], incomplete = true } = {}, normal = false, thrown: mayThrow = false, status = '' } = {}, position) => {
            const { method = '', index = -1, required = '' } = queries.at(position) ?? {};

            if (method !== 'checkCallResult' || !observations.has(index)) return;

            const { kind = '', thrown = false } = observations.get(index) ?? {};

            // An async invocation returns normally before adoption. Its awaited
            // payload belongs to the async function summary checked above.
            if (asynchronous) {
                strictEqual(normal, true, source);
                strictEqual(mayThrow, false, source);

                return;
            }

            const agreement = family(kind) === required ? 'agreement' : 'contradiction';

            deepStrictEqual(families, kind ? [family(kind)] : [], source);
            strictEqual(incomplete, !kind, source);
            strictEqual(normal, Boolean(kind), source);
            strictEqual(status, kind ? agreement : 'unknown', source);

            if (thrown) strictEqual(mayThrow, true, source);
        });

        const reversed = acquire();

        deepStrictEqual(queries.toReversed().map(query => queryAnalysis(reversed, query)).toReversed(), baseline, source);
        deepStrictEqual(queries.map(query => queryAnalysis(first, query)), baseline, source);
        deepStrictEqual(first.checkFunction({ index }), summary, source);

        if (transport !== 'direct' || !retryCases.has(name)) return;

        const { index: target = -1 } = supplied.at(-1) ?? {};
        const observed = counter();
        const { onWork } = observed;
        const cold = acquire();
        const retryExpected = cold.checkCallResult({ index: target, required: 'string', onWork });
        const checkpoints = ['function-context', 'flow-contribution', 'establishment', 'settlement-aggregate']
            .map(kind => ({ kind, stop: observed.get(kind) })).filter(({ stop = 0 } = {}) => stop > 0);

        ok(checkpoints.length, name);
        context.diagnostic(`Retry stages for ${name}: ${checkpoints.map(({ kind = '' } = {}) => kind).join(', ')}`);
        checkpoints.forEach(({ kind = '', stop = 0 } = {}) => {
            const interrupted = acquire();
            const failure = new Error(`Interrupted ${name}: ${kind}`);
            const visits = counter();

            throws(() => interrupted.checkCallResult({ index: target, required: 'string', onWork: ({ kind: current = '' } = {}) => {
                visits.increment(current);
                const count = visits.get(current);

                if (current === kind && count === stop) throw failure;
            } }), error => error === failure);
            // A different consumer gets the partial session before the original
            // request retries. Neither may publish unfinished or borrowed work.
            interrupted.checkCallResult({ index: target, required: 'number' });
            deepStrictEqual(interrupted.checkFunction({ index }), summary, source);
            deepStrictEqual(interrupted.checkCallResult({ index: target, required: 'string' }), retryExpected, source);
            deepStrictEqual(queries.toReversed().map(query => queryAnalysis(interrupted, query)).toReversed(), baseline, source);
        });
    });
}));
