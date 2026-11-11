import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { parse } from 'espree';

import { createExportResolver } from '../analysis/analyzer/export-resolutions.js';
import { indexModules } from '../analysis/analyzer/modules.js';
import { append, put } from './support/collections.js';
import { counter } from './support/work.js';

const first = Object.freeze({ binding: 'first' });
const second = Object.freeze({ binding: 'second' });
const summarize = ({ target = false, ambiguous = false, unresolved = false } = {}) => ({ target: ambiguous ? false : target, ambiguous, unresolved });
const acquire = (graph, observation = {}, reverse = false) => {
    const nodes = graph.map((unused, id) => ({ id }));
    const cache = new Map();
    const definitions = new Map();
    const work = counter();
    const resolve = createExportResolver({ cache, keyFor: ({ id = -1 } = {}) => id,
        observation: { onWork: event => work.onWork(event), ...observation },
        definition: ({ id = -1 } = {}) => {
            const { inputs = [], target = false, unresolved = false } = graph.at(id);

            put(definitions, id, (definitions.get(id) || 0) + 1);
            const routes = [...inputs.map(index => ({ entry: nodes.at(index) })), { target, unresolved }];

            return reverse ? routes.toReversed() : routes;
        } });

    return { cache, definitions, work, resolve: index => resolve(nodes.at(index)) };
};

// Independent reachability closure: no DFS completion order or component cache.
const oracle = (graph) => {
    const reach = new Map(graph.map(({ inputs = [] } = {}, index) => [index, new Set([index, ...inputs])]));

    graph.forEach((unused, through) => graph.forEach((unused, from) => {
        const row = reach.get(from);

        if (!row.has(through)) return;

        put(reach, from, new Set([...row, ...reach.get(through)]));
    }));

    return graph.map((unused, index) => {
        const records = [...reach.get(index)].map(index => graph.at(index));
        const targets = new Set(records.map(({ target = false } = {}) => target).filter(Boolean));
        const ambiguous = targets.size > 1;

        return { target: targets.size === 1 ? [...targets].at(0) : false, ambiguous,
            unresolved: records.some(({ unresolved = false } = {}) => unresolved) };
    });
};
const compare = (graph) => {
    const expected = oracle(graph);

    [false, true].forEach((reverse) => {
        const scope = acquire(graph, {}, reverse);
        const indexes = graph.map((unused, index) => index);

        (reverse ? indexes.toReversed() : indexes).forEach(index => deepStrictEqual(summarize(scope.resolve(index)), expected.at(index)));
        indexes.forEach(index => deepStrictEqual(summarize(scope.resolve(index)), expected.at(index)));
        scope.cache.forEach((summary, index) => {
            deepStrictEqual(summarize(summary), expected.at(index));
            strictEqual(Object.isFrozen(summary), true);
            deepStrictEqual(Object.keys(summary).toSorted(), ['ambiguous', 'target', 'unresolved']);
        });
    });
};

test('cached routes retain absent ambiguous and unresolved contributions', () => {
    [
        [{ inputs: [1, 2] }, {}, { target: first }],
        [{ inputs: [1, 2] }, { unresolved: true }, { target: first }],
        [{ inputs: [1, 2] }, { target: first }, { target: second }],
        [{ inputs: [1, 2] }, { target: first }, { target: first }],
        [{ inputs: [1, 2] }, { inputs: [2], unresolved: true }, { target: first }],
        [{ inputs: [1, 2] }, { inputs: [2], target: second }, { target: first }]
    ].forEach(compare);
});

test('cyclic export summaries complete every member before reuse', () => {
    [
        [{ inputs: [1] }, { inputs: [0, 2] }, { target: first }],
        [{ inputs: [1], target: first }, { inputs: [0], target: second }],
        [{ inputs: [1], target: first }, { inputs: [0], unresolved: true }],
        [{ inputs: [1] }, { inputs: [0] }],
        [{ inputs: [1, 2] }, { inputs: [0] }, { inputs: [2], target: first }],
        [{ inputs: [1, 2] }, { inputs: [0] }, { inputs: [3] }, { inputs: [2], unresolved: true }]
    ].forEach(compare);
    const scope = acquire([{ inputs: [1] }, { inputs: [0], target: first }]);

    strictEqual(scope.resolve(0), scope.resolve(1));
});

test('all three-node export graphs preserve independent reachability across query orders', () => {
    const states = [{}, { target: first }, { target: second }, { unresolved: true }];

    Array.from({ length: 512 }, (unused, mask) => mask).forEach(mask => Array.from({ length: 64 }, (unused, values) => values).forEach((values) => {
        const graph = Array.from({ length: 3 }, (unused, index) => ({
            ...states.at(Math.floor(values / (4 ** index)) % 4),
            inputs: [0, 1, 2].filter(target => Math.floor(mask / (2 ** (3 * index + target))) % 2)
        }));

        compare(graph);
    }));
});

const bounded = (graph) => {
    [false, true].forEach((reverse) => {
        const scope = acquire(graph, {}, reverse);
        const { work = {}, cache = new Map(), definitions = new Map() } = scope;
        const indexes = graph.map((unused, index) => index);
        const queries = reverse ? indexes.toReversed() : indexes;
        const edges = graph.reduce((total, { inputs = [] } = {}) => total + inputs.length, 0);

        queries.forEach(index => strictEqual(scope.resolve(index).target, first));
        ok(work.get('export-resolution') <= 6 * graph.length + 5 * edges);
        strictEqual(cache.size, graph.length);
        definitions.forEach(count => strictEqual(count, 1));
        const before = work.get('export-resolution');

        queries.toReversed().forEach(index => strictEqual(scope.resolve(index), cache.get(index)));
        strictEqual(work.get('export-resolution') - before, graph.length);
    });
};

test('overlapping export chains reuse completed routes with linear work and retained summaries', () => {
    [64, 128, 256, 512, 1024].forEach(size => bounded(Array.from({ length: size }, (unused, index) => (
        index === size - 1 ? { target: first } : { inputs: [index + 1] }
    ))));
});

test('shared diamonds and cyclic export routes stay bounded across independent width and depth', () => {
    [[8, 8], [8, 64], [64, 8], [64, 64]].forEach(([width = 0, depth = 0] = []) => {
        const graph = Array.from({ length: width }, () => ({ target: first }));

        append(graph, { inputs: Array.from({ length: width }, (unused, index) => index) });
        Array.from({ length: depth }).forEach(() => {
            const before = graph.length - 1;

            append(graph, { inputs: [before] }, { inputs: [before] }, { inputs: [before + 1, before + 2] });
        });
        bounded(graph);
        bounded(Array.from({ length: width + depth }, (unused, index) => ({ inputs: [(index + 1) % (width + depth)], target: index ? false : first })));
    });
    bounded(Array.from({ length: 12000 }, (unused, index) => index === 11999 ? { target: first } : { inputs: [index + 1] }));
});

test('interrupted export resolution retains only completed answers and retries cleanly', () => {
    const graph = [{ inputs: [1, 3] }, { inputs: [2], target: first }, { inputs: [1], unresolved: true }, { target: second }];
    const expected = oracle(graph);
    const baseline = acquire(graph);

    baseline.resolve(0);
    const limit = baseline.work.get('export-resolution');

    Array.from({ length: limit }, (unused, index) => index + 1).forEach((stop) => {
        const work = counter();
        const failure = new Error('interrupted export acquisition');
        const scope = acquire(graph, { onWork: (event) => {
            work.onWork(event);

            if (work.get('export-resolution') === stop) throw failure;
        } });

        throws(() => scope.resolve(0), error => error === failure);
        scope.cache.forEach((summary, index) => deepStrictEqual(summarize(summary), expected.at(index)));
        graph.forEach((unused, index) => deepStrictEqual(summarize(scope.resolve(index)), expected.at(index)));
    });
});

test('overlapping module re-exports share completed routes during acquisition', () => {
    [32, 64, 128, 256, 512].forEach(size => [false, true].forEach(star => [false, true].forEach((reverse) => {
        const modules = new Map(Array.from({ length: size }, (unused, index) => [`m${index}`, index === size - 1
            ? 'export const value=42;' : `export ${star ? '*' : '{value}'} from "m${index + 1}";`]));
        const imports = Array.from({ length: size }, (unused, index) => `import {value as v${index}} from "m${index}";`);
        const source = (reverse ? imports.toReversed() : imports).join('');
        const work = counter();
        const { importTargets = new Map() } = indexModules({
            program: parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true }), filename: 'main',
            resolveModule: ({ source = '' } = {}) => ({ filename: source, source: modules.get(source) }),
            observation: { onWork: event => work.onWork(event) }
        });

        strictEqual(importTargets.size, size);
        strictEqual(new Set(importTargets.values()).size, 1);
        ok(work.get('export-resolution') >= size);
        ok(work.get('export-resolution') <= 11 * size);
    })));
});

test('default binding identities share barrel routes with bounded acquisition work and storage', () => {
    [[8, 8], [8, 64], [64, 8], [64, 64]].forEach(([width = 0, depth = 0] = []) => [false, true].forEach((reverse) => {
        const positions = Array.from({ length: width }, (unused, index) => index);
        const layers = Array.from({ length: depth }, (unused, index) => index);
        const modules = new Map([
            ['leaf', 'export const read=(value="")=>value;'],
            ...positions.map(index => [`s${index}`, 'import {read} from "leaf";export default read;']),
            ...layers.map(index => [`m${index}`, index ? `export * from "m${index - 1}";`
                : positions.map(index => `export {default as v${index}} from "s${index}";`).join('')])
        ]);
        const imports = layers.flatMap(layer => positions.map(index => `import {v${index} as v${layer}_${index}} from "m${layer}";`));
        const source = (reverse ? imports.toReversed() : imports).join('');
        const work = counter();
        const { importTargets = new Map(), rootBindings = new Map() } = indexModules({
            program: parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true }), filename: 'main',
            resolveModule: ({ source = '' } = {}) => ({ filename: source, source: modules.get(source) }),
            observation: { onWork: event => work.onWork(event) }
        });
        const targets = positions.map(index => importTargets.get(rootBindings.get(`v0_${index}`)));

        strictEqual(new Set(targets).size, width);
        targets.forEach((target, index) => {
            deepStrictEqual(Object.keys(target).toSorted(), ['immutable', 'init', 'stable']);
            const { init: { type = '', name = '' } = {} } = target;

            strictEqual(type, 'Identifier');
            strictEqual(name, 'read');
            layers.forEach(layer => strictEqual(importTargets.get(rootBindings.get(`v${layer}_${index}`)), target));
        });
        strictEqual(importTargets.size, width * (depth + 1));
        ok(work.get('export-resolution') >= width * depth);
        ok(work.get('export-resolution') <= 20 * width * (depth + 1));
    }));
});
