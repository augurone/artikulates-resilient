import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { createDecisions } from '../analysis/analyzer/decisions.js';

const counts = decisions => ({ nodes: decisions.count(), work: decisions.work() });
const threeVariables = () => {
    const decisions = createDecisions();
    const variables = Array.from({ length: 3 }, (_, index) => decisions.variable(`flag:${index}`));
    const assignments = Array.from({ length: 8 }, (_, bits) => variables.map((_, index) => Boolean(bits & (1 << index))));
    const minterms = assignments.map(values => values.reduce((root, value, index) => (
        decisions.and(root, value ? variables.at(index) : decisions.not(variables.at(index)))
    ), 1));
    const formulas = Array.from({ length: 256 }, (_, mask) => minterms.reduce((root, node, index) => (
        mask & (1 << index) ? decisions.or(root, node) : root
    ), 0));

    return { decisions, assignments, formulas };
};
const environment = values => new Map(values.map((value, index) => [index, value]));

test('constant Boolean answers retain no decision or memo state', () => {
    const decisions = createDecisions({ limit: 1 });

    [0, 1].forEach(left => [0, 1].forEach((right) => {
        strictEqual(decisions.and(left, right), Number(Boolean(left && right)));
        strictEqual(decisions.or(left, right), Number(Boolean(left || right)));
    }));
    strictEqual(decisions.not(0), 1);
    strictEqual(decisions.not(1), 0);
    [0, 1].forEach((root) => {
        strictEqual(decisions.project(root, () => true, { key: Symbol('unread terminal key'), onVisit: () => {
            throw new Error('Terminal projection must not visit a node');
        } }), root);
        throws(() => decisions.project(root, false), /Expected a decision projection predicate/u);
    });
    deepStrictEqual(counts(decisions), { nodes: 0, work: 0 });
});

test('distinct terminal identity requests return existing operands without retaining answers', () => {
    const decisions = createDecisions();
    const variables = Array.from({ length: 1000 }, (_, index) => decisions.variable(`flag:${index}`));
    const before = counts(decisions);

    variables.forEach((node) => {
        [decisions.and(node, 1), decisions.and(1, node), decisions.or(node, 0), decisions.or(0, node),
            decisions.and(node, node), decisions.or(node, node)].forEach(result => strictEqual(result, node));
        [decisions.and(node, 0), decisions.and(0, node)].forEach(result => strictEqual(result, 0));
        [decisions.or(node, 1), decisions.or(1, node)].forEach(result => strictEqual(result, 1));
    });
    deepStrictEqual(counts(decisions), before);
});

test('all 256 three-variable functions retain their full truth tables and complements', () => {
    const { decisions = {}, assignments = [], formulas = [] } = threeVariables();

    formulas.forEach((node, mask) => {
        const inverse = decisions.not(node);

        assignments.forEach((values, index) => {
            strictEqual(decisions.possible(node, environment(values)), Boolean(mask & (1 << index)));
            strictEqual(decisions.possible(inverse, environment(values)), !(mask & (1 << index)));
        });
        strictEqual(decisions.and(node, inverse), 0);
        strictEqual(decisions.or(node, inverse), 1);
        strictEqual(decisions.not(inverse), node);
    });
});

test('shared composition and projection preserve every selected and removed alternative', () => {
    const { decisions = {}, assignments = [], formulas = [] } = threeVariables();

    formulas.forEach((node, mask) => {
        const projected = decisions.project(node, variable => variable !== 2, { key: 'omit-third' });
        const prior = formulas.at(Math.max(0, mask - 1));
        const combined = decisions.or(node, prior);

        assignments.forEach((values, index) => {
            const withoutThird = index & 3;
            const expected = Boolean(mask & (1 << withoutThird)) || Boolean(mask & (1 << (withoutThird | 4)));

            strictEqual(decisions.possible(projected, environment(values)), expected);
            strictEqual(decisions.possible(combined, environment(values)), Boolean((mask | Math.max(0, mask - 1)) & (1 << index)));
        });
        const before = counts(decisions);

        strictEqual(decisions.project(node, variable => variable !== 2, { key: 'omit-third' }), projected);
        strictEqual(decisions.or(node, prior), combined);
        deepStrictEqual(counts(decisions), before);
    });

    const first = decisions.variable('flag:0');
    const second = decisions.variable('flag:1');
    const source = decisions.and(first, second);
    const omitFirst = variable => variable !== 0;
    const omitSecond = variable => variable !== 1;

    strictEqual(decisions.project(source, omitFirst, { key: '' }), second);
    strictEqual(decisions.project(source, omitSecond, { key: ':' }), first);
    strictEqual(decisions.project(source, omitFirst, { key: 17 }), second);
    const objectKey = { toString: () => 'owner:0' };

    strictEqual(decisions.project(source, omitSecond, { key: objectKey }), first);
    const before = counts(decisions);
    const unexpectedVisit = () => { throw new Error('Equivalent namespace must reuse the completed projection'); };

    strictEqual(decisions.project(source, omitFirst, { key: '17', onVisit: unexpectedVisit }), second);
    strictEqual(decisions.project(source, omitSecond, { key: 'owner:0', onVisit: unexpectedVisit }), first);
    throws(() => decisions.project(source, omitFirst, { key: Symbol('invalid namespace') }), TypeError);
    throws(() => decisions.project(source, false, { key: '17' }), /Expected a decision projection predicate/u);
    deepStrictEqual(counts(decisions), before);
});

test('allocation-free identities succeed at capacity while new work still fails', () => {
    const decisions = createDecisions({ limit: 2 });
    const left = decisions.variable('left');
    const right = decisions.variable('right');
    const before = counts(decisions);

    strictEqual(decisions.and(left, 1), left);
    strictEqual(decisions.or(0, right), right);
    strictEqual(decisions.not(0), 1);
    throws(() => decisions.and(left, right), /Analysis decision limit exceeded/u);
    throws(() => decisions.not(left), /Analysis decision limit exceeded/u);
    strictEqual(decisions.and(left, 0), 0);
    strictEqual(decisions.or(right, 1), 1);
    deepStrictEqual(counts(decisions), before);

    const partial = createDecisions({ limit: 3 });
    const a = partial.variable('a');
    const b = partial.variable('b');
    const { work: priorWork = 0 } = counts(partial);

    throws(() => partial.and(a, b), /Analysis decision limit exceeded/u);
    strictEqual(partial.work() > priorWork, true, 'Completed children remain available after their parent exhausts capacity');
    throws(() => partial.and(b, a), /Analysis decision limit exceeded/u);
    [false, true].forEach(first => [false, true].forEach((second) => {
        strictEqual(partial.possible(a, environment([first, second])), first);
        strictEqual(partial.possible(b, environment([first, second])), second);
    }));

    const zero = createDecisions({ limit: 7 });
    const value = zero.variable('value');
    const inverse = zero.not(value);

    strictEqual(zero.and(value, inverse), 0);
    const full = counts(zero);

    strictEqual(zero.and(value, inverse), 0);
    strictEqual(zero.and(inverse, value), 0);
    deepStrictEqual(counts(zero), full);

    const mixed = createDecisions({ limit: 7 });
    const first = mixed.variable('first');
    const second = mixed.variable('second');
    const source = mixed.and(first, second);
    const { work: priorMixedWork = 0 } = counts(mixed);
    const keep = () => true;

    throws(() => mixed.project(source, keep, { key: 'mixed' }), /Analysis decision limit exceeded/u);
    strictEqual(mixed.work() > priorMixedWork, true, 'Projection entries consume the same budget as operation entries');
    const exhausted = counts(mixed);

    strictEqual(mixed.project(first, keep, { key: 'mixed', onVisit: () => { throw new Error('Completed child must remain cached'); } }), first);
    strictEqual(mixed.and(first, second), source);
    throws(() => mixed.not(first), /Analysis decision limit exceeded/u);
    throws(() => mixed.variable('third'), /Analysis decision limit exceeded/u);
    throws(() => mixed.project(first, keep, { key: 'another namespace' }), /Analysis decision limit exceeded/u);
    deepStrictEqual(counts(mixed), exhausted);
});

test('projection observer failures propagate and retry preserves shared results', () => {
    const decisions = createDecisions();
    const left = decisions.variable('left');
    const right = decisions.variable('right');
    const last = decisions.variable('last');
    const firstBranch = decisions.and(left, right);
    const source = decisions.or(firstBranch, decisions.and(decisions.not(left), last));
    const expected = decisions.or(right, last);
    const failure = new Error('projection observer failure');
    let completed = false;
    const keep = (variable) => {
        completed = true;

        return variable !== 0;
    };

    throws(() => decisions.project(source, keep, { key: 'keep-first-two', onVisit: () => { throw failure; } }), error => error === failure);
    throws(() => decisions.project(source, keep, { key: 'keep-first-two', onVisit: () => {
        if (completed) throw failure;
    } }), error => error === failure);
    strictEqual(decisions.project(firstBranch, keep, { key: 'keep-first-two', onVisit: () => { throw failure; } }), right);
    strictEqual(decisions.project(source, keep, { key: 'keep-first-two' }), expected);
    Array.from({ length: 8 }, (_, bits) => [0, 1, 2].map(index => Boolean(bits & (1 << index)))).forEach((values) => {
        strictEqual(decisions.possible(expected, environment(values)), values.at(1) || values.at(2));
    });
    const before = counts(decisions);

    strictEqual(decisions.project(source, keep, { key: 'keep-first-two', onVisit: () => { throw failure; } }), expected);
    deepStrictEqual(counts(decisions), before);

    const reentrant = createDecisions();
    const a = reentrant.variable('a');
    const b = reentrant.variable('b');
    const shared = reentrant.and(a, b);
    const omitFirst = variable => variable !== 0;
    let observations = [];
    const result = reentrant.project(shared, omitFirst, { key: 17, onVisit: () => {
        if (observations.length) return;

        const value = reentrant.project(shared, omitFirst, { key: '17' });

        observations = [{ value, snapshot: counts(reentrant) }];
    } });

    strictEqual(result, b);
    strictEqual(observations.length, 1);
    observations.forEach(({ value = 0, snapshot = {} } = {}) => {
        strictEqual(value, b);
        deepStrictEqual(counts(reentrant), snapshot);
    });
});
