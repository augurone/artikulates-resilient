import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import {
    all, createContext, createOwner, family, field, fromESTree, isCurrent,
    producer, reference, replaceAll, replaceEvidence, request, unresolved
} from 'eslint-plugin-resilient/agreement';

const own = node => createOwner({ evidence: fromESTree(node) });

test('missing or forged handles cannot become evidence through defaults', () => {
    [undefined, false, null, {}, []].forEach((value) => {
        throws(() => createOwner({ evidence: value }), TypeError);
        throws(() => reference({ owner: value }), TypeError);
        throws(() => request({ owner: value, required: 'string' }), TypeError);
        strictEqual(isCurrent(value), false);
    });
    throws(() => family(), TypeError);
    throws(() => field({ required: 'string' }), TypeError);
    throws(() => field({ name: '' }), TypeError);
});

test('an empty field name remains valid while a missing field name is rejected', () => {
    const owner = own({ type: 'ObjectExpression', properties: [{
        type: 'Property', computed: false, kind: 'init', method: false,
        key: { type: 'Literal', value: '' }, value: { type: 'Literal', value: 'present' }
    }] });
    const { status = '' } = request({ owner, required: field({ name: '', required: 'string' }) });

    strictEqual(status, 'agreement');
});

test('absent ESTree literal payloads stay unknown instead of acquiring a default family', () => {
    const absent = own({ type: 'Literal' });
    const nullish = own({ type: 'Literal', value: null });
    const { status: missingStatus = '', fact: { families = [], state = '' } = {} } = request({ owner: absent, required: 'boolean' });
    const { status: nullishStatus = '' } = request({ owner: nullish, required: 'nullish' });

    strictEqual(missingStatus, 'unknown');
    strictEqual(state, 'unknown');
    deepStrictEqual(families, []);
    strictEqual(nullishStatus, 'agreement');
});

test('failed defaulted updates remain atomic and context failures create no source evidence', () => {
    const owner = own({ type: 'Literal', value: 'before' });
    const first = request({ owner, required: 'string' });
    const replacement = fromESTree({ type: 'Literal', value: 42 });
    const context = createContext();

    throws(() => replaceEvidence({ owner }), TypeError);
    throws(() => replaceAll({ updates: [{ owner, evidence: replacement }, {}] }), TypeError);
    throws(() => context.define({ name: 'missing' }), TypeError);
    strictEqual(isCurrent(first), true);

    const { status = '' } = request({ owner: context.source({ name: 'missing' }), required: 'string' });

    strictEqual(status, 'unknown');
});

test('observers receive one frozen event argument and noncallable observers stay absent', (context) => {
    const owner = createOwner({ evidence: unresolved() });
    const onWork = context.mock.fn();

    request({ owner, required: 'string', onWork });

    const { mock: { calls = [] } = {} } = onWork;

    strictEqual(calls.length, 2);
    calls.forEach(({ arguments: args = [] } = {}) => {
        const [event = false] = args;

        strictEqual(args.length, 1);
        strictEqual(Object.isFrozen(event), true);
    });
    [undefined, false, null, 0, '', {}].forEach((observer) => {
        const { status = '' } = request({ owner, required: 'string', onWork: observer });

        strictEqual(status, 'unknown');
    });
});

test('an empty conjunction exposes no fabricated first fact', () => {
    const owner = createOwner({ evidence: unresolved() });
    const judgment = request({ owner, required: all() });
    const { status = '', facts = [] } = judgment;

    strictEqual(status, 'agreement');
    deepStrictEqual(facts, []);
    strictEqual(typeof Reflect.get(judgment, 'fact'), 'undefined');
});

test('sparse requirement and producer lists reject missing contributions at construction', () => {
    const owner = own({ type: 'Literal', value: 'known' });
    const lists = value => [Array(1), Array(1).concat([value]), [value].concat(Array(1)), [value].concat(Array(1), [value])];

    lists('string').forEach(requirements => throws(() => all({ requirements }), TypeError));
    lists(owner).forEach(owners => throws(() => producer({ owners }), TypeError));
});

test('sparse revision batches fail before any valid update is committed', () => {
    const owner = own({ type: 'Literal', value: 'before' });
    const other = own({ type: 'Literal', value: 'also before' });
    const boundary = createOwner({ evidence: producer({ owners: [owner, other] }) });
    const first = request({ owner: boundary, required: 'string' });
    const evidence = fromESTree({ type: 'Literal', value: 42 });
    const update = { owner, evidence };
    const batches = [Array(1), Array(1).concat([update]), [update].concat(Array(1)), [update].concat(Array(1), [{ owner: other, evidence }])];

    batches.forEach((updates) => {
        throws(() => replaceAll({ updates }), TypeError);
        strictEqual(isCurrent(first), true);

        const { status = '', fact = false } = first;

        strictEqual(status, 'agreement');
        strictEqual(request({ owner: boundary, required: 'string' }).fact, fact);
    });
});

test('empty contribution and revision lists preserve their declared meanings', () => {
    const owner = createOwner({ evidence: producer() });
    const first = request({ owner, required: 'string' });
    const updated = replaceAll();
    const { status = '', fact = false } = first;

    strictEqual(status, 'unknown');
    deepStrictEqual(updated, []);
    strictEqual(Object.isFrozen(updated), true);
    strictEqual(isCurrent(first), true);
    strictEqual(request({ owner, required: 'string' }).fact, fact);
});
