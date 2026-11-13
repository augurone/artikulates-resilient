import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import test from 'node:test';

import { acquireUseSelections } from '../analysis/analyzer/use-selections.js';
import { put, retain } from '../analysis/collections.js';
import { traverse } from '../analysis/traversal.js';
import { counter } from './support/work.js';

const requirements = (uses, root) => {
    const seen = new Set();
    const found = new Set();

    traverse(root, { enter: (subject) => {
        if (seen.has(subject)) return [];

        retain(seen, subject);
        const entries = uses.get(subject) || [];

        entries.filter(({ kind = '' } = {}) => ['argument', 'escape'].includes(kind))
            .forEach(({ kind = '', label = '' } = {}) => retain(found, `${kind}:${label}`));

        return entries.map(({ target = false } = {}) => target).filter(Boolean);
    } });

    return [...found].toSorted();
};

test('selected array positions retain their own consumers and unknown ranges retain every possible consumer', () => {
    const source = {};
    const uses = new Map([[source, [
        { kind: 'argument', label: 'first', selected: { minimum: 0, maximum: 0 } },
        { kind: 'escape', label: 'third', selected: { minimum: 2, maximum: 2 } }
    ]]]);
    const selections = acquireUseSelections(uses);
    const first = selections.select(source, 0, 0);
    const second = selections.select(source, 1, 1);
    const unknown = selections.select(source);

    selections.complete();
    deepStrictEqual(requirements(uses, first), ['argument:first']);
    deepStrictEqual(requirements(uses, second), []);
    deepStrictEqual(requirements(uses, unknown), ['argument:first', 'escape:third']);
    const { size: count = 0 } = uses;

    strictEqual(selections.select(source, 0, 0), first);
    selections.complete();
    strictEqual(uses.size, count);
});

test('nested array slots and spread prefixes preserve both addresses', () => {
    const element = {};
    const packed = {};
    const shifted = {};
    const consumer = {};
    const uses = new Map([
        [element, [{ kind: 'forward', target: packed, enclosed: { minimum: 1, maximum: 1 } }]],
        [packed, [{ kind: 'forward', target: shifted, offset: { minimum: 2, maximum: 2 } }]],
        [shifted, [{ kind: 'forward', target: consumer, selected: { minimum: 3, maximum: 3 }, unnest: true }]],
        [consumer, [{ kind: 'argument', label: 'callback', selected: { minimum: 0, maximum: 0 } }]]
    ]);
    const selections = acquireUseSelections(uses);
    const invoked = selections.select(element, 0, 0);
    const unrelated = selections.select(element, 1, 1);

    selections.complete();
    deepStrictEqual(requirements(uses, invoked), ['argument:callback']);
    deepStrictEqual(requirements(uses, unrelated), []);
});

test('changing positions around an unresolved cycle remain unresolved without unbounded acquisition', () => {
    const source = {};
    const uses = new Map([[source, [{ kind: 'forward', target: source, offset: { minimum: 1, maximum: 1 } }, { kind: 'escape', label: 'cycle' }]]]);
    const selections = acquireUseSelections(uses);
    const selected = selections.select(source, 0, 0);

    selections.complete();
    deepStrictEqual(requirements(uses, selected), ['escape:cycle']);
    ok(uses.size <= 3);
});

test('a changed carrier retains possible consumers instead of trusting the original slot', () => {
    const source = {};
    const consumer = {};
    const uses = new Map([
        [source, [{ kind: 'forward', target: consumer, uncertainPositions: true }]],
        [consumer, [{ kind: 'argument', label: 'moved callback', selected: { minimum: 1, maximum: 1 } }]]
    ]);
    const selections = acquireUseSelections(uses);
    const original = selections.select(source, 0, 0);

    selections.complete();
    deepStrictEqual(requirements(uses, original), ['argument:moved callback']);
});

test('successive shared joins acquire subject positions without expanding the number of paths', () => {
    [2, 8, 32].forEach((depth) => {
        const leaf = {};
        const uses = new Map([[leaf, [{ kind: 'argument', label: 'callback', selected: { minimum: 1, maximum: 1 } }]]]);
        const root = Array.from({ length: depth }).reduce((target) => {
            const subject = {};

            put(uses, subject, [{ kind: 'forward', target }, { kind: 'forward', target }]);

            return subject;
        }, leaf);
        const selections = acquireUseSelections(uses);
        const invoked = selections.select(root, 1, 1);
        const unrelated = selections.select(root, 0, 0);

        selections.complete();
        deepStrictEqual(requirements(uses, invoked), ['argument:callback']);
        deepStrictEqual(requirements(uses, unrelated), []);
        ok(uses.size <= 3 * (depth + 1), `${depth} joins share the same two position queries`);
    });
});

test('returned positions widen through shared joins without borrowing discarded producer effects', () => {
    [false, true].forEach(changed => [2, 8, 32].forEach((depth) => {
        const reads = counter();
        const leaf = {};
        const effect = {};
        const consumer = {};
        const source = {};
        const result = { kind: 'result', get uncertainPositions() {
            reads.increment('positions');

            return changed;
        } };
        const uses = new Map([
            [leaf, [result, { kind: 'forward', target: effect, resultRole: 'discard' }]],
            [effect, [{ kind: 'result', uncertainPositions: true }]],
            [consumer, [{ kind: 'argument', label: 'callback', selected: { minimum: 1, maximum: 1 } }]]
        ]);
        const root = Array.from({ length: depth }).reduce((target) => {
            const subject = {};

            put(uses, subject, [{ kind: 'forward', target }, { kind: 'forward', target }]);

            return subject;
        }, leaf);

        put(uses, source, [{ kind: 'forward', target: root, resultRole: 'consumer', resultTarget: consumer, selectResult: true }]);
        const selections = acquireUseSelections(uses);
        const original = selections.select(source, 0, 0);

        selections.complete();
        deepStrictEqual(requirements(uses, original), changed ? ['argument:callback'] : []);
        ok(reads.get('positions') <= 4, `${depth} joins reuse return-position evidence`);
        ok(uses.size <= 3 * (depth + 5));
        const counts = reads.get('positions');

        selections.complete();
        strictEqual(reads.get('positions'), counts);
    }));
});

test('a returned position cycle keeps every possible consumer without expanding paths', () => {
    const cycle = {};
    const source = {};
    const consumer = {};
    const uses = new Map([
        [cycle, [{ kind: 'forward', target: cycle, resultRole: 'return' }]],
        [source, [{ kind: 'forward', target: cycle, resultRole: 'consumer', resultTarget: consumer, selectResult: true }]],
        [consumer, [{ kind: 'argument', label: 'unknown slot', selected: { minimum: 1, maximum: 1 } }]]
    ]);
    const selections = acquireUseSelections(uses);
    const original = selections.select(source, 0, 0);

    selections.complete();
    deepStrictEqual(requirements(uses, original), ['argument:unknown slot', 'escape:']);
    ok(uses.size <= 6);
});

test('composed return consumers share equivalent continuations through successive joins', () => {
    [2, 8, 32].forEach((depth) => {
        const leaf = {};
        const consumer = {};
        const source = {};
        const uses = new Map([
            [leaf, [{ kind: 'result' }]],
            [consumer, [{ kind: 'argument', label: 'callback', selected: { minimum: 1, maximum: 1 } }]]
        ]);
        const target = Array.from({ length: depth }).reduce((target) => {
            const resume = {};
            const joined = {};

            put(uses, resume, [{ kind: 'result' }]);
            put(uses, joined, [0, 1].map(() => ({ kind: 'forward', target, selectResult: true, resultTarget: resume })));

            return joined;
        }, leaf);

        put(uses, source, [{ kind: 'forward', target, selectResult: true, resultTarget: consumer }]);
        const selections = acquireUseSelections(uses);
        const invoked = selections.select(source, 1, 1);
        const unrelated = selections.select(source, 0, 0);

        selections.complete();
        deepStrictEqual(requirements(uses, invoked), ['argument:callback']);
        deepStrictEqual(requirements(uses, unrelated), []);
        ok(uses.size <= 6 * depth + 9, `${depth} nested return joins share consumer state`);
        const { size = 0 } = uses;

        strictEqual(selections.select(source, 1, 1), invoked);
        selections.complete();
        strictEqual(uses.size, size);
    });
});

test('returned guard sites keep independent capabilities through shared position queries', () => {
    [2, 8, 32].forEach((depth) => {
        const leaf = {};
        const consumer = {};
        const source = {};
        const returnNode = {};
        const capabilities = [{}, {}];
        const observed = new Map();
        const uses = new Map([
            [leaf, [{ kind: 'result', returnNode }]],
            [consumer, [{ kind: 'argument', label: 'callback', selected: { minimum: 0, maximum: 0 } }]]
        ]);
        const target = Array.from({ length: depth }).reduce((target) => {
            const joined = {};

            put(uses, joined, [0, 1].map(() => ({ kind: 'forward', target })));

            return joined;
        }, leaf);

        put(uses, source, capabilities.map(capability => ({ kind: 'forward', capability, target, selectResult: true, resultTarget: consumer })));
        const selections = acquireUseSelections(uses, (use = {}) => {
            const { capability = false, node = false } = use;

            put(observed, capability, node);

            return use;
        });
        const invoked = selections.select(source, 0, 0);

        selections.complete();
        deepStrictEqual(requirements(uses, invoked), ['argument:callback']);
        strictEqual(observed.size, 2);
        capabilities.forEach(capability => strictEqual(observed.get(capability), returnNode));
        ok(uses.size <= 4 * depth + 16, `${depth} shared joins retain two distinct proof origins`);
        const { size = 0 } = uses;

        selections.complete();
        strictEqual(uses.size, size);
    });
});
