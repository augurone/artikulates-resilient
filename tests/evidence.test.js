import { strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { parse } from 'espree';

import { all, content, createContext, createOwner, field, fromESTree, inspect, isCurrent, producer, reference, replaceEvidence, request, unresolved } from 'eslint-plugin-resilient/agreement';

import { counter } from './support/work.js';

const expression = source => parse(`(${source})`, { ecmaVersion: 'latest' }).body.at(0).expression;
const own = (node, options = {}) => createOwner({ evidence: fromESTree(node, options) });
const answer = (owner, required) => request({ owner, required }).status;
const nonempty = content({ family: 'array' });

test('omitted collection structure supplies no evidence of emptiness or field absence', () => {
    const array = own({ type: 'ArrayExpression' });
    const object = own({ type: 'ObjectExpression' });

    strictEqual(answer(array, 'array'), 'agreement');
    strictEqual(answer(array, nonempty), 'unknown');
    strictEqual(answer(object, 'object'), 'agreement');
    strictEqual(answer(object, content({ family: 'object' })), 'unknown');
    strictEqual(answer(object, field({ name: 'missing', required: all() })), 'unknown');
});

test('family projection reads no collection structure and cannot answer content or fields', () => {
    const node = expression('[]');

    Object.defineProperty(node, 'elements', { get() { throw new Error('Family does not need elements'); } });

    const owner = own(node, { projection: 'family' });
    const object = own(expression('{}'), { projection: 'family' });
    const text = own(expression('"known"'), { projection: 'family' });

    strictEqual(answer(owner, 'array'), 'agreement');
    strictEqual(answer(owner, nonempty), 'unknown');
    strictEqual(answer(text, content({ family: 'string' })), 'unknown');
    strictEqual(answer(object, field({ name: 'missing', required: all() })), 'unknown');
});

test('content projection preserves empty, hole, value and unresolved spread evidence', () => {
    [
        ['[]', 'contradiction'], ['[1]', 'agreement'], ['[,]', 'agreement'],
        ['[...external]', 'unknown'], ['[,...external]', 'agreement']
    ].forEach(([source = '', expected = ''] = []) => {
        const owner = own(expression(source), { projection: 'content' });

        strictEqual(answer(owner, 'array'), 'agreement');
        strictEqual(answer(owner, nonempty), expected);
    });
});

test('content snapshots read element headers once without reading values or retaining caller structure', (context) => {
    const node = expression('[1]');
    const element = node.elements.at(0);
    const readType = context.mock.fn(() => 'Literal');
    const readValue = context.mock.fn(() => { throw new Error('Content does not need values'); });

    Object.defineProperty(element, 'type', { get: readType });
    Object.defineProperty(element, 'value', { get: readValue });
    Object.defineProperty(node, 'elements', { value: Array.from({ length: 1000 }, () => element) });

    const owner = own(node, { projection: 'content' });

    Object.defineProperty(node, 'elements', { value: [] });
    strictEqual(answer(owner, nonempty), 'agreement');
    strictEqual(answer(owner, nonempty), 'agreement');
    strictEqual(readType.mock.callCount(), 1000);
    strictEqual(readValue.mock.callCount(), 0);
});

test('presence projection owns keys and writer order without retaining value evidence', () => {
    const node = expression('{ title: "known" }');
    const property = node.properties.at(0);
    const { key = {} } = property;

    Object.defineProperty(property, 'value', { get() { throw new Error('Presence does not need the value'); } });

    const owner = own(node, { projection: 'presence' });

    Object.defineProperty(key, 'name', { value: 'changed' });
    strictEqual(answer(owner, field({ name: 'title', required: all() })), 'agreement');
    strictEqual(answer(owner, field({ name: 'title', required: 'string' })), 'unknown');
    strictEqual(answer(owner, field({ name: 'missing', required: all() })), 'contradiction');
    strictEqual(answer(owner, content({ family: 'object' })), 'unknown');
});

test('content projection retains object headers but does not supply field evidence', () => {
    const owner = own(expression('{ title: "known" }'), { projection: 'content' });

    strictEqual(answer(owner, content({ family: 'object' })), 'agreement');
    strictEqual(answer(owner, field({ name: 'title', required: all() })), 'unknown');
});

test('projected identifier dependencies cannot widen the retained facets', () => {
    const context = createContext();

    context.define({ name: 'items', evidence: fromESTree(expression('[1]')) });

    const owner = own(expression('items'), { context, projection: 'family' });

    strictEqual(answer(owner, 'array'), 'agreement');
    strictEqual(answer(owner, nonempty), 'unknown');

    context.define({ name: 'record', evidence: fromESTree(expression('{ title: "known" }')) });

    const presence = own(expression('record'), { context, projection: 'presence' });

    strictEqual(answer(presence, 'object'), 'agreement');
    strictEqual(answer(presence, field({ name: 'title', required: 'string' })), 'unknown');
});

test('projected facts share ownership, remain stable across unrelated changes and invalidate on replacement', () => {
    const root = own(expression('[]'), { projection: 'content' });
    const alias = createOwner({ evidence: reference({ owner: root }) });
    const other = own(expression('[]'));
    const work = counter();
    const onWork = event => work.onWork(event);
    const first = request({ owner: alias, required: nonempty, onWork });
    const family = request({ owner: alias, required: 'array', onWork });
    const { status: firstStatus = '', fact = false } = first;
    const { status: familyStatus = '' } = family;
    const established = work.get('establishment');

    strictEqual(firstStatus, 'contradiction');
    strictEqual(familyStatus, 'agreement');
    replaceEvidence({ owner: other, evidence: fromESTree(expression('[2]')) });

    const { fact: repeated = false } = request({ owner: alias, required: nonempty, onWork });

    strictEqual(repeated, fact);
    strictEqual(work.get('establishment'), established);
    replaceEvidence({ owner: root, evidence: fromESTree(expression('[1]'), { projection: 'content' }) });
    strictEqual(isCurrent(first), false);
    strictEqual(isCurrent(family), false);
    strictEqual(answer(alias, nonempty), 'agreement');
});

test('unsupported projection selections fail before publishing evidence', () => {
    ['unknown', '', false, {}, []].forEach(projection => throws(() => fromESTree(expression('[]'), { projection }), TypeError));
});

test('property projections distinguish shorthand from prototype setters without borrowing values', () => {
    ['complete', 'content', 'presence'].forEach((projection) => {
        const owner = own(expression('{ __proto__ }'), { projection });
        const setter = own(expression('{ __proto__: external }'), { projection });

        if (projection !== 'presence') strictEqual(answer(owner, content({ family: 'object' })), 'agreement');

        if (projection === 'content') return;

        strictEqual(answer(owner, field({ name: '__proto__', required: all() })), 'agreement');
        strictEqual(answer(owner, field({ name: 'missing', required: all() })), 'contradiction');
        strictEqual(answer(owner, field({ name: '__proto__', required: 'number' })), 'unknown');
        strictEqual(answer(setter, field({ name: '__proto__', required: all() })), 'unknown');
    });
});

test('unresolved writers preserve established presence without claiming an overwritten value', () => {
    ['complete', 'presence'].forEach((projection) => {
        ['...external', '[key]: 0', '__proto__: external'].forEach((writer) => {
            const owner = own(expression(`{ before: "known", ${writer}, after: "known" }`), { projection });
            const work = counter();
            const onWork = event => work.onWork(event);
            const before = request({ owner, required: field({ name: 'before', required: all() }), onWork });
            const { status = '' } = before;

            strictEqual(status, 'agreement', `${projection}: ${writer}`);
            strictEqual(work.get('literal-classification'), 0);
            strictEqual(answer(owner, field({ name: 'before', required: 'string' })), 'unknown');
            strictEqual(answer(owner, field({ name: 'after', required: all() })), 'agreement');
            strictEqual(answer(owner, field({ name: 'after', required: 'string' })), projection === 'complete' ? 'agreement' : 'unknown');
            strictEqual(answer(owner, field({ name: 'missing', required: all() })), 'unknown');
            request({ owner, required: field({ name: 'after', required: all() }), onWork });
            strictEqual(work.get('field-index-entry'), 3, 'All field demands share one header index');
            replaceEvidence({ owner, evidence: fromESTree(expression('{}'), { projection }) });
            strictEqual(isCurrent(before), false);
            strictEqual(answer(owner, field({ name: 'before', required: all() })), 'contradiction');
        });
    });
});

test('nested context revisions invalidate value obligations while preserving independent presence and unused names', () => {
    const context = createContext();
    const record = fromESTree(expression('{ text: leaf }'), { context });
    const shared = context.define({ name: 'shared', evidence: record });
    const owner = own(expression('{ left: shared, right: shared, ignored: dormant }'), { context });
    const nested = field({ name: 'text', required: 'string' });
    const required = all({ requirements: ['left', 'right'].map(name => field({ name, required: nested })) });
    const presence = request({ owner, required: field({ name: 'left', required: all() }) });
    const missing = request({ owner, required });
    const { status: presenceStatus = '' } = presence;
    const { status: missingStatus = '' } = missing;

    strictEqual(presenceStatus, 'agreement');
    strictEqual(missingStatus, 'unknown');
    context.define({ name: 'leaf', evidence: fromESTree(expression('42')) });
    strictEqual(isCurrent(missing), false);
    strictEqual(isCurrent(presence), true);

    const wrong = request({ owner, required });
    const concrete = createOwner({ evidence: record });
    const unknown = createOwner({ evidence: unresolved() });
    const { status: wrongStatus = '' } = wrong;

    strictEqual(wrongStatus, 'contradiction');
    replaceEvidence({ owner: shared, evidence: producer({ owners: [concrete, unknown] }) });

    const mixed = request({ owner, required });
    const { status: mixedStatus = '' } = mixed;

    strictEqual(isCurrent(wrong), false);
    strictEqual(mixedStatus, 'contradiction', 'A new unresolved contribution must not conceal the known wrong nested family');
    context.define({ name: 'leaf', evidence: fromESTree(expression('"resolved"')) });
    strictEqual(isCurrent(mixed), false);
    strictEqual(answer(owner, required), 'unknown');
    replaceEvidence({ owner: shared, evidence: record });

    const resolved = request({ owner, required });
    const { status: resolvedStatus = '' } = resolved;

    strictEqual(resolvedStatus, 'agreement');
    context.define({ name: 'dormant', evidence: fromESTree(expression('false')) });
    strictEqual(isCurrent(resolved), true);
    strictEqual(isCurrent(presence), true);
    strictEqual(inspect(missing).historicalOutcome, 'unknown');
    strictEqual(inspect(wrong).historicalOutcome, 'contradiction');
    strictEqual(isCurrent(missing), false);
});

test('projection limits survive joins, aliasing, demand order and later resolution', () => {
    const node = expression('{ title: "known" }');
    const required = field({ name: 'title', required: 'string' });

    ['family', 'content', 'presence'].forEach((projection) => {
        const limited = own(node, { projection });
        const complete = own(node);
        const merged = createOwner({ evidence: producer({ owners: [limited, complete] }) });
        const alias = createOwner({ evidence: reference({ owner: merged }) });
        const first = request({ owner: alias, required });
        const { status = '' } = first;

        strictEqual(status, 'unknown', projection);
        strictEqual(answer(complete, required), 'agreement');
        strictEqual(answer(alias, required), 'unknown');
        replaceEvidence({ owner: limited, evidence: fromESTree(node) });
        strictEqual(isCurrent(first), false);
        strictEqual(answer(alias, required), 'agreement');
        strictEqual(inspect(first).historicalOutcome, 'unknown');
    });
});

test('observer reentry cannot revive a judgment by changing a nested premise away and back', () => {
    const context = createContext();
    const original = fromESTree(expression('"same"'));
    const leaf = context.define({ name: 'leaf', evidence: original });
    const owner = own(expression('{ value: leaf }'), { context });
    const required = field({ name: 'value', required: 'string' });
    const onWork = ({ kind = '' } = {}) => {
        if (kind !== 'judgment') return;

        replaceEvidence({ owner: leaf, evidence: fromESTree(expression('42')) });
        strictEqual(answer(owner, required), 'contradiction');
        replaceEvidence({ owner: leaf, evidence: original });
        strictEqual(answer(owner, required), 'agreement');
    };

    throws(() => request({ owner, required, onWork }), /Source changed during request/);
    strictEqual(answer(owner, required), 'agreement');
});
