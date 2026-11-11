import { strictEqual, deepStrictEqual, notStrictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { parse } from 'espree';

import {
    createOwner, fromESTree, unresolved, request, replaceEvidence, replaceAll,
    createContext, reference, producer, isCurrent, inspect, family, content, field, all, receiver
} from 'eslint-plugin-resilient/agreement';

const evidence = (text, options = {}) => {
    const { body: [{ expression = false } = {}] = [] } = parse(`(${text})`, { ecmaVersion: 'latest', sourceType: 'module' });

    return fromESTree(expression, options);
};
const own = text => createOwner({ evidence: evidence(text) });
const answer = (owner, required) => request({ owner, required }).status;
const kinds = ({ mock: { calls = [] } = {} } = {}) => calls.map(({ arguments: [{ kind = '' } = {}] = [] } = {}) => kind);
const count = (observer, kind) => kinds(observer).filter(value => value === kind).length;

test('content falsification preserves producer family and operational receiver agreement', () => {
    [
        { source: '""', name: 'string', operation: 'trim', nonempty: false },
        { source: '" "', name: 'string', operation: 'trim', nonempty: true },
        { source: '[]', name: 'array', operation: 'map', nonempty: false },
        { source: '[,,]', name: 'array', operation: 'map', nonempty: true },
        { source: '{}', name: 'object', nonempty: false },
        { source: '{ name: "" }', name: 'object', nonempty: true }
    ].forEach(({ source = '', name = '', operation = '', nonempty = false } = {}) => {
        const owner = own(source);

        strictEqual(answer(owner, family({ name })), 'agreement');
        strictEqual(answer(owner, content({ family: name })), nonempty ? 'agreement' : 'contradiction');
        strictEqual(answer(owner, family({ name })), 'agreement');

        if (operation) strictEqual(answer(owner, receiver({ operation })), 'agreement');
    });

    strictEqual(answer(own('0'), 'number'), 'agreement');
    strictEqual(answer(own('false'), 'boolean'), 'agreement');
    strictEqual(answer(own('() => external'), receiver({ operation: 'call' })), 'agreement');
    strictEqual(answer(own('[]'), receiver({ operation: 'trim' })), 'contradiction');
    throws(() => content({ family: 'number' }), TypeError);
    throws(() => content({ family: 'boolean' }), TypeError);
});

test('all 27 three-part outcome combinations preserve false beside unknown, in every ordering', () => {
    const parts = [
        { source: '"known"', outcome: 'agreement' },
        { source: '42', outcome: 'contradiction' },
        { source: 'external', outcome: 'unknown' }
    ];
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

    parts.forEach(first => parts.forEach(second => parts.forEach(({ source: c = '', ...third } = {}) => {
        const entries = [first, second, { ...third, source: c }];
        const { source: a = '' } = first;
        const { source: b = '' } = second;
        const owner = own(`({a: ${a}, b: ${b}, c: ${c}})`);
        const outcomes = entries.map(({ outcome = '' } = {}) => outcome);
        const withoutConflict = outcomes.includes('unknown') ? 'unknown' : 'agreement';
        const expected = outcomes.includes('contradiction') ? 'contradiction' : withoutConflict;
        const requirements = ['a', 'b', 'c'].map(name => field({ name, required: 'string' }));

        orders.forEach((order) => {
            strictEqual(answer(owner, all({ requirements: order.map((index) => {
                const { [index]: required = false } = requirements;

                return required;
            }) })), expected);
        });
    })));
});

test('known producer conflicts and partial known families survive unresolved contributions', () => {
    const text = own('"known"');
    const number = own('1');
    const pending = createOwner({ evidence: unresolved() });
    const boundary = createOwner({ evidence: producer({ owners: [text, pending] }) });
    const first = request({ owner: boundary, required: 'string' });

    const { status: firstStatus = '', fact: { families: firstFamilies = [] } = {} } = first;

    strictEqual(firstStatus, 'unknown');
    deepStrictEqual(firstFamilies, ['string']);
    strictEqual(answer(boundary, 'number'), 'contradiction');
    replaceEvidence({ owner: boundary, evidence: producer({ owners: [text, number, pending] }) });

    const conflict = request({ owner: boundary, required: 'string' });

    const { status = '', fact: { state = '', families = [], incomplete = false } = {} } = conflict;

    strictEqual(status, 'contradiction');
    strictEqual(state, 'contradictory');
    deepStrictEqual(new Set(families), new Set(['string', 'number']));
    strictEqual(incomplete, true);
    replaceAll({ updates: [{ owner: number, evidence: evidence('"same"') }, { owner: pending, evidence: evidence('"resolved"') }] });
    strictEqual(isCurrent(conflict), false);
    strictEqual(answer(boundary, 'string'), 'agreement');

    const empty = own('""');
    const mixed = createOwner({ evidence: producer({ owners: [empty, createOwner({ evidence: unresolved() })] }) });

    strictEqual(answer(mixed, 'string'), 'unknown');
    strictEqual(answer(mixed, content({ family: 'string' })), 'contradiction');
});

test('own-field evidence respects writers and does not evaluate unknown values or accessors', () => {
    const text = field({ name: 'name', required: 'string' });
    const presence = field({ name: 'name', required: all() });
    const cases = [
        ['({ name: "known", unrelated: unknown })', 'agreement'],
        ['({ name: unknown, unrelated: 1 })', 'unknown'],
        ['({ name: 1, unrelated: unknown })', 'contradiction'],
        ['({})', 'contradiction'],
        ['({ name: 1, name: "last" })', 'agreement'],
        ['({ name: "first", name: 1 })', 'contradiction'],
        ['({ name: "first", ...unknown })', 'unknown'],
        ['({ ...unknown, name: "last" })', 'agreement'],
        ['({ [unknown]: 1, name: "last" })', 'agreement'],
        ['({ name: "first", [unknown]: 1 })', 'unknown'],
        ['({ get name() { throw new Error("never execute"); } })', 'unknown'],
        ['({ __proto__: unknown })', 'unknown']
    ];

    cases.forEach(([source = '', expected = ''] = []) => strictEqual(answer(own(source), text), expected));
    strictEqual(answer(own('({get name(){ throw 1; }})'), presence), 'agreement');
    strictEqual(answer(own('({name: ""})'), content({ family: 'object' })), 'agreement');
    strictEqual(answer(own('({name: ""})'), field({ name: 'name', required: content({ family: 'string' }) })), 'contradiction');
});

test('many field demands share one layout without classifying unused values', (context) => {
    const names = Array.from({ length: 1000 }, (_, index) => `f${index}`);
    const owner = own(`{ ${names.map(name => `${name}: external`).join(',')} }`);
    const onWork = context.mock.fn();
    const queries = names.map(name => field({ name, required: all() }));

    queries.forEach(required => strictEqual(request({ owner, required, onWork }).status, 'agreement'));
    queries.toReversed().forEach(required => strictEqual(request({ owner, required, onWork }).status, 'agreement'));
    strictEqual(count(onWork, 'field-index-entry'), 1000);
    strictEqual(count(onWork, 'field-lookup'), 1000);
    strictEqual(count(onWork, 'establishment'), 1001);
    strictEqual(count(onWork, 'literal-classification'), 0);
});

test('a shared field layout preserves writer barriers independently of demand order', () => {
    const source = '{ a: 1, ...external, b: 2, [key]: 3, c: 4, c: "last", get d() { throw 1; }, 12: false }';
    const names = ['a', 'b', 'c', 'd', '12', 'missing'];
    const expected = new Map([['a', 'unknown'], ['b', 'unknown'], ['c', 'agreement'], ['d', 'unknown'], ['12', 'contradiction'], ['missing', 'unknown']]);

    [names, names.toReversed()].forEach((order) => {
        const owner = own(source);

        order.forEach(name => strictEqual(answer(owner, field({ name, required: 'string' })), expected.get(name)));
    });
});

test('source replacement invalidates field facts and builds a new owned layout', (context) => {
    const owner = own('{ a: "first", b: 2 }');
    const required = field({ name: 'a', required: 'string' });
    const onWork = context.mock.fn();
    const first = request({ owner, required, onWork });
    const { status = '' } = first;

    strictEqual(status, 'agreement');
    strictEqual(count(onWork, 'field-index-entry'), 2);
    replaceEvidence({ owner, evidence: evidence('{ b: 3 }') });
    strictEqual(isCurrent(first), false);
    strictEqual(request({ owner, required, onWork }).status, 'contradiction');
    strictEqual(count(onWork, 'field-index-entry'), 3);
    replaceEvidence({ owner, evidence: evidence('{ ...external, a: "again" }') });
    strictEqual(request({ owner, required, onWork }).status, 'agreement');
    strictEqual(count(onWork, 'field-index-entry'), 5);
});

test('scope-owned identity includes missing bindings and recovers when the binding appears', (context) => {
    const scope = createContext();
    const elsewhere = createContext();
    const a = scope.source({ name: 'value' });
    const b = createOwner({ evidence: evidence('value', { context: scope }) });
    const c = createOwner({ evidence: evidence('value', { context: elsewhere }) });
    const onWork = context.mock.fn();
    const first = request({ owner: b, required: 'string', onWork });

    strictEqual(a, scope.source({ name: 'value' }));
    notStrictEqual(a, elsewhere.source({ name: 'value' }));
    const { status: firstStatus = '', fact: firstFact = false } = first;

    strictEqual(firstStatus, 'unknown');
    strictEqual(request({ owner: b, required: 'number', onWork }).status, 'unknown');
    strictEqual(count(onWork, 'establishment'), 2);
    scope.define({ name: 'unrelated', evidence: evidence('false') });
    strictEqual(request({ owner: b, required: 'string', onWork }).fact, firstFact);
    strictEqual(count(onWork, 'establishment'), 2);
    strictEqual(scope.define({ name: 'value', evidence: evidence('"established"') }), a);
    strictEqual(isCurrent(first), false);
    strictEqual(request({ owner: b, required: 'string', onWork }).status, 'agreement');
    strictEqual(count(onWork, 'establishment'), 4);
    strictEqual(answer(c, 'string'), 'unknown');
});

test('demand selects a field and keeps unrelated bindings and content facts dormant', (context) => {
    const scope = createContext();
    const root = createOwner({ evidence: evidence('({ wanted: needed, ignored: unused })', { context: scope }) });
    const onWork = context.mock.fn();

    scope.define({ name: 'needed', evidence: evidence('"yes"') });
    scope.define({ name: 'unused', evidence: evidence('123') });
    strictEqual(request({ owner: root, required: field({ name: 'wanted', required: 'string' }), onWork }).status, 'agreement');
    strictEqual(count(onWork, 'establishment'), 4);
    strictEqual(count(onWork, 'field-lookup'), 1);
    strictEqual(count(onWork, 'literal-classification'), 1);
    strictEqual(count(onWork, 'content-inspection'), 0);

    const firstCount = count(onWork, 'establishment');

    scope.define({ name: 'unused', evidence: evidence('false') });
    strictEqual(request({ owner: root, required: field({ name: 'wanted', required: 'string' }), onWork }).status, 'agreement');
    strictEqual(count(onWork, 'establishment'), firstCount);
});

test('shared premises are established once and changing an upstream source invalidates both consumers', (context) => {
    const a = own('"shared"');
    const left = createOwner({ evidence: reference({ owner: a }) });
    const right = createOwner({ evidence: reference({ owner: a }) });
    const joined = createOwner({ evidence: producer({ owners: [left, right] }) });
    const onWork = context.mock.fn();
    const first = request({ owner: joined, required: 'string', consumer: 'one', onWork });
    const second = request({ owner: joined, required: 'number', consumer: 'two', onWork });

    const { status: firstStatus = '', fact: firstFact = false } = first;
    const { status: secondStatus = '', fact: secondFact = false } = second;

    strictEqual(firstStatus, 'agreement');
    strictEqual(secondStatus, 'contradiction');
    strictEqual(firstFact, secondFact);
    strictEqual(count(onWork, 'establishment'), 4);
    strictEqual(count(onWork, 'literal-classification'), 1);
    replaceEvidence({ owner: a, evidence: evidence('7') });
    strictEqual(isCurrent(first), false);
    throws(() => {
        const { status = '' } = first;

        return status;
    }, /Stale judgment/);
    strictEqual(inspect(first).historicalOutcome, 'agreement');
    strictEqual(inspect(first).current, false);
    strictEqual(request({ owner: joined, required: 'string', onWork }).status, 'contradiction');
    strictEqual(count(onWork, 'establishment'), 8);
    strictEqual(count(onWork, 'literal-classification'), 2);
});

test('cyclic unresolved premises stabilize, preserve independent contradiction, and recover', (context) => {
    const a = createOwner({ evidence: unresolved() });
    const b = createOwner({ evidence: reference({ owner: a }) });

    replaceEvidence({ owner: a, evidence: reference({ owner: b }) });

    const onWork = context.mock.fn();
    const first = request({ owner: a, required: 'string', onWork });

    const { status: firstStatus = '', fact: firstFact = false } = first;

    strictEqual(firstStatus, 'unknown');
    strictEqual(request({ owner: a, required: 'number', onWork }).fact, firstFact);
    strictEqual(count(onWork, 'establishment'), 2);

    const boundary = createOwner({ evidence: producer({ owners: [a, own('42')] }) });

    strictEqual(answer(boundary, 'string'), 'contradiction');
    replaceEvidence({ owner: b, evidence: evidence('"break cycle"') });
    strictEqual(isCurrent(first), false);
    strictEqual(answer(a, 'string'), 'agreement');
    strictEqual(answer(boundary, 'string'), 'contradiction');
});

test('batch updates validate fully before commit and expire dependent judgments together', () => {
    const a = own('"one"');
    const b = own('"two"');
    const boundary = createOwner({ evidence: producer({ owners: [a, b] }) });
    const first = request({ owner: boundary, required: 'string' });

    throws(() => replaceAll({ updates: [{ owner: a, evidence: evidence('1') }, { owner: b, evidence: Object.freeze({ kind: 'estree' }) }] }), TypeError);
    strictEqual(isCurrent(first), true);
    strictEqual(answer(boundary, 'string'), 'agreement');
    throws(() => replaceAll({ updates: [{ owner: a, evidence: evidence('1') }, { owner: a, evidence: evidence('2') }] }), TypeError);
    strictEqual(isCurrent(first), true);
    replaceAll({ updates: [{ owner: a, evidence: evidence('1') }, { owner: b, evidence: evidence('2') }] });
    strictEqual(isCurrent(first), false);
    strictEqual(answer(boundary, 'number'), 'agreement');
});

test('empty obligations require no source inference; unsupported requests fail explicitly', (context) => {
    const owner = createOwner({ evidence: unresolved() });
    const onWork = context.mock.fn();

    strictEqual(request({ owner, required: all(), onWork }).status, 'agreement');
    strictEqual(count(onWork, 'establishment'), 0);
    throws(() => request({ owner, required: Object.freeze({ kind: 'family', name: 'string' }) }), TypeError);
    throws(() => receiver({ operation: 'invented' }), TypeError);
    throws(() => createOwner({ evidence: Object.freeze({ kind: 'unresolved' }) }), TypeError);
});

test('deep references and nested obligations use explicit traversal frames', () => {
    const root = own('"deep"');
    const chain = Array.from({ length: 10000 }).reduce(owner => createOwner({ evidence: reference({ owner }) }), root);
    const requirement = Array.from({ length: 10000 }).reduce(required => all({ requirements: [required] }), family({ name: 'string' }));
    const first = request({ owner: chain, required: requirement });

    const { status = '' } = first;

    strictEqual(status, 'agreement');
    replaceEvidence({ owner: root, evidence: evidence('42') });
    strictEqual(isCurrent(first), false);
    strictEqual(answer(chain, requirement), 'contradiction');
});

test('an observer changing a transitive premise cannot expose a current stale result', () => {
    const a = own('"before"');
    const b = createOwner({ evidence: reference({ owner: a }) });
    const onWork = ({ kind = '' } = {}) => {
        if (kind !== 'judgment') return;

        replaceEvidence({ owner: a, evidence: evidence('42') });
    };

    throws(() => request({ owner: b, required: 'string', onWork }), /Source changed during request/);
    strictEqual(answer(b, 'number'), 'agreement');
});

test('cyclic producers preserve reachable known evidence independent of request order', () => {
    [0, 1].forEach((first) => {
        const a = createOwner({ evidence: unresolved() });
        const b = createOwner({ evidence: reference({ owner: a }) });
        const known = own('"known"');
        const owners = [a, b];
        const { [first]: selected = false, [1 - first]: other = false } = owners;

        replaceEvidence({ owner: a, evidence: producer({ owners: [b, known] }) });
        strictEqual(answer(selected, 'string'), 'unknown');
        strictEqual(answer(other, 'number'), 'contradiction');
        strictEqual(answer(selected, 'number'), 'contradiction');
        replaceEvidence({ owner: known, evidence: evidence('42') });
        strictEqual(answer(a, 'string'), 'contradiction');
        strictEqual(answer(b, 'string'), 'contradiction');
        replaceEvidence({ owner: b, evidence: evidence('42') });
        strictEqual(answer(a, 'number'), 'agreement');
        strictEqual(answer(b, 'number'), 'agreement');
    });
});
