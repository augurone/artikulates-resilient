import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import test from 'node:test';

import { parse } from 'espree';

import { all, content, createOwner, field, fromESTree, inspect, isCurrent, producer, replaceAll, request, unresolved } from 'eslint-plugin-resilient/agreement';

const fixtures = [
    { source: '{ x: "text" }', family: 'object', outcomes: ['agreement', 'agreement', 'agreement', 'agreement'] },
    { source: '{}', family: 'object', outcomes: ['agreement', 'contradiction', 'contradiction', 'contradiction'] },
    { source: '{ x: external }', family: 'object', outcomes: ['agreement', 'agreement', 'agreement', 'unknown'] },
    { source: '42', family: 'number', outcomes: ['contradiction', 'contradiction', 'contradiction', 'contradiction'] },
    { source: 'external', family: '', outcomes: ['unknown', 'unknown', 'unknown', 'unknown'] }
];
const evidence = source => fromESTree(parse(`(${source})`, { ecmaVersion: 'latest' }).body.at(0).expression);
const required = ['object', content({ family: 'object' }), field({ name: 'x', required: all() }), field({ name: 'x', required: 'string' })];
const hash = (trial, index, salt = 0) => (Math.imul(trial + 1, 1103515245) ^ Math.imul(index + 7, 2654435761) ^ Math.imul(salt + 3, 2246822519)) >>> 0;
const shape = (trial, size) => Array.from({ length: size }, (_, index) => {
    const value = hash(trial, index);

    if (value % 3 === 0) return { fixture: value % fixtures.length, dependencies: [] };

    return { fixture: -1, dependencies: Array.from({ length: value % 5 }, (_, edge) => hash(trial, index, edge + 10) % size) };
});

// This oracle uses transitive closure, not the product's SCC algorithm, caches,
// certificates or invalidation subscriptions. Small graphs keep it independent.
const model = (graph) => {
    const initial = graph.map(({ dependencies = [] } = {}) => graph.map((_, index) => dependencies.includes(index)));
    const closure = graph.reduce((matrix, _, intermediate) => matrix.map((row, source) => row.map((connected, target) => (
        connected || (matrix.at(source).at(intermediate) && matrix.at(intermediate).at(target))
    ))), initial);

    return graph.map((_, root) => {
        const reachable = graph.map((entry, index) => ({ ...entry, index })).filter(({ index = -1 } = {}) => index === root || closure.at(root).at(index));
        const selected = reachable.filter(({ fixture = -1 } = {}) => fixture >= 0).map(({ fixture = -1 } = {}) => fixtures.at(fixture));
        const cyclicOrEmpty = reachable.some(({ index = -1, fixture = -1, dependencies = [] } = {}) => (
            closure.at(index).at(index) || (fixture < 0 && !dependencies.length)
        ));
        const families = [...new Set(selected.map(({ family = '' } = {}) => family).filter(Boolean))].toSorted();
        const incomplete = cyclicOrEmpty || selected.some(({ family = '' } = {}) => !family);
        const outcomes = required.map((_, index) => {
            const values = selected.map(({ outcomes: answers = [] } = {}) => answers.at(index));

            if (values.includes('contradiction')) return 'contradiction';

            return cyclicOrEmpty || values.includes('unknown') ? 'unknown' : 'agreement';
        });

        return { reachable: reachable.map(({ index = -1 } = {}) => index), families, incomplete, outcomes };
    });
};
const install = ({ fixture = -1, dependencies = [] } = {}, owners) => {
    if (fixture < 0) return producer({ owners: dependencies.map(index => owners.at(index)) });

    const { source = '' } = fixtures.at(fixture);

    return evidence(source);
};
const check = (owners, graph, order) => {
    const expected = model(graph);

    return order.map((index) => {
        const owner = owners.at(index);
        const { families = [], incomplete = false, outcomes = [] } = expected.at(index);
        const judgments = required.map((requirement, query) => {
            const judgment = request({ owner, required: requirement });
            const { status = '', fact = {} } = judgment;
            const { families: actual = [], incomplete: partial = false } = fact;

            strictEqual(status, outcomes.at(query));
            deepStrictEqual(actual.toSorted(), families);
            strictEqual(partial, incomplete);
            strictEqual(request({ owner, required: requirement }).fact, fact);

            return judgment;
        });

        return { ...expected.at(index), judgments };
    });
};

test('distinct three-owner graph topologies agree with the independent model in every demand order', () => {
    const positions = [0, 1, 2];
    const alternatives = [
        ...fixtures.map((_, fixture) => ({ fixture, dependencies: [] })),
        ...Array.from({ length: 8 }, (_, mask) => ({ fixture: -1, dependencies: positions.filter(index => mask & (1 << index)) }))
    ];
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    const key = graph => JSON.stringify(graph.map(({ fixture = -1, dependencies = [] } = {}) => [fixture, dependencies]));
    const relabel = (graph, order) => order.map((index) => {
        const { fixture = -1, dependencies = [] } = graph.at(index);

        return { fixture, dependencies: dependencies.map(dependency => order.indexOf(dependency)).toSorted() };
    });
    const graphs = Array.from({ length: alternatives.length ** positions.length }, (_, code) => (
        positions.map(index => alternatives.at(Math.floor(code / (alternatives.length ** index)) % alternatives.length))
    ));

    // Owner numbers carry no evidence. Keep one representative of each graph
    // under renaming, preserving fixture identity and every dependency edge.
    // Every representative still runs all six demand orders; the generated
    // revision tests below retain different allocation and topology histories.
    graphs.filter(graph => orders.every(order => key(graph) <= key(relabel(graph, order)))).forEach((graph) => {
        orders.forEach((order) => {
            const owners = positions.map(() => createOwner({ evidence: unresolved() }));

            replaceAll({ updates: owners.map((owner, index) => ({ owner, evidence: install(graph.at(index), owners) })) });
            check(owners, graph, order);
        });
    });
});

test('generated source graphs match independent family, content, field and revision models in both demand orders', () => {
    Array.from({ length: 250 }, (_, trial) => trial).forEach((trial) => {
        const graph = shape(trial, 6);
        const forward = graph.map((_, index) => index);

        [forward, forward.toReversed()].forEach((order) => {
            const owners = graph.map(() => createOwner({ evidence: unresolved() }));

            replaceAll({ updates: owners.map((owner, index) => ({ owner, evidence: install(graph.at(index), owners) })) });

            const prior = check(owners, graph, order);
            const changed = [trial % owners.length, (trial + 1) % owners.length];
            const next = graph.map((entry, index) => changed.includes(index) ? { fixture: (trial + index) % fixtures.length, dependencies: [] } : entry);

            replaceAll({ updates: changed.map(index => ({ owner: owners.at(index), evidence: install(next.at(index), owners) })) });
            prior.forEach(({ reachable = [], judgments = [] } = {}) => judgments.forEach(judgment => (
                strictEqual(isCurrent(judgment), !changed.some(index => reachable.includes(index)))
            )));
            check(owners, next, order.toReversed());
        });
    });
});

test('partial demands and repeated topology changes preserve every historical judgment against the independent model', () => {
    Array.from({ length: 32 }, (_, trial) => trial).forEach((trial) => {
        const initial = shape(trial, 8);
        const owners = initial.map(() => createOwner({ evidence: unresolved() }));

        replaceAll({ updates: owners.map((owner, index) => ({ owner, evidence: install(initial.at(index), owners) })) });

        Array.from({ length: 32 }, (_, revision) => revision).reduce(({ graph = [], retained = [] } = {}, revision) => {
            const order = graph.map((_, index) => index).filter(index => hash(trial, index, revision) % 3 === 0);
            const demanded = check(owners, graph, revision % 2 ? order : order.toReversed());
            const history = [...retained, ...demanded.map(entry => ({ ...entry, current: true }))];
            const replacement = shape(trial * 32 + revision + 251, owners.length);
            const changed = [...new Set([hash(trial, revision, 90) % owners.length, hash(trial, revision, 91) % owners.length])];
            const next = graph.map((entry, index) => changed.includes(index) ? replacement.at(index) : entry);

            replaceAll({ updates: changed.map(index => ({ owner: owners.at(index), evidence: install(next.at(index), owners) })) });

            const surviving = history.map(({ reachable = [], judgments = [], outcomes = [], current = false, ...entry } = {}) => {
                const valid = current && !changed.some(index => reachable.includes(index));

                judgments.forEach((judgment, query) => {
                    strictEqual(isCurrent(judgment), valid, `trial ${trial}, revision ${revision}, query ${query}`);
                    strictEqual(inspect(judgment).historicalOutcome, outcomes.at(query));
                });

                return { ...entry, reachable, judgments, outcomes, current: valid };
            });

            return { graph: next, retained: surviving };
        }, { graph: initial, retained: [] });
    });
});
