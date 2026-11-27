import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { createOwner, unresolved } from '../analysis/agreement/source-owners.js';
import { createDecisions } from '../analysis/analyzer/decisions.js';
import { createValues, normalValue } from '../analysis/analyzer/values.js';
import { append, put } from './support/collections.js';

const setup = (limit = Infinity) => {
    const owner = createOwner({ evidence: unresolved() });
    const decisions = createDecisions();
    const model = createValues({ unknown: { owner }, decisions, limit }, gate => gate, (entry, gate) => gate);
    const leaf = (callable = {}, identityContext = {}) => normalValue({ owner, callable, identityContext,

        // eslint-disable-next-line resilient/signature-contract-call-site -- Internal identity accepts a capability record; false denotes its absence rather than a Boolean contract.
        identity: { capability: { absenceQuestion: true } } });

    return { model, leaf, decisions };
};
const graphSize = (root) => {
    const seen = new Map();
    const counts = new Map([['edges', 0]]);
    const visit = (entry = {}) => {
        if (seen.has(entry)) return;

        put(seen, entry, true);

        const { inputs = [] } = entry;

        ok(Object.isFrozen(entry));
        ok(!Object.hasOwn(entry, 'identityCases') && !Object.hasOwn(entry, 'callableCases'));
        put(counts, 'edges', counts.get('edges') + inputs.length);
        inputs.forEach(visit);
    };

    visit(root);

    return { nodes: seen.size, edges: counts.get('edges') };
};

test('condition projection preserves external choices, source identity and ownership', () => {
    const { model = {}, leaf, decisions = {} } = setup();

    if (typeof leaf !== 'function') throw new TypeError('Expected the value fixture builder');

    const external = decisions.variable('external');
    const internal = decisions.variable('internal');

    // eslint-disable-next-line resilient/signature-contract-call-site -- These private value-graph fixtures deliberately supply record identities and false sentinel alternatives to normalValue.
    const first = leaf();

    // eslint-disable-next-line resilient/signature-contract-call-site -- These private value-graph fixtures deliberately supply record identities and false sentinel alternatives to normalValue.
    const second = leaf();

    // eslint-disable-next-line resilient/signature-contract-call-site -- These private value-graph fixtures deliberately supply record identities and false sentinel alternatives to normalValue.
    const unknown = leaf(false);
    const root = model.joined([model.restrict(first, decisions.and(external, internal)),
        model.restrict(second, decisions.and(decisions.not(external), internal)), model.restrict(unknown, decisions.not(internal))]);
    const project = gate => decisions.project(gate, key => key === 0, { key: 'external-only' });
    const projected = model.projectConditions(root, project, 'external-only');
    const cases = model.casesFor(projected, 'origin');

    deepStrictEqual(cases.map(({ origin = false } = {}) => origin), [first, second, unknown]);
    [false, true].forEach(value => deepStrictEqual(cases.map(({ gate = 0 } = {}) => decisions.possible(gate, new Map([[0, value]]))), [value, !value, true]));
    strictEqual(model.projectConditions(root, project, 'external-only'), projected);
    const retired = model.projectConditions(model.retire(model.restrict(first, internal)), project, 'retired');
    const { unowned = false, identity = false } = retired;
    const { identity: expected = false } = first;

    strictEqual(unowned, true);
    strictEqual(identity, expected);
    const repeated = Array.from({ length: 128 }).reduce((value, unused, index) => (
        model.projectConditions(model.restrict(value, internal), project, `projection:${index}`)
    ), first);

    strictEqual(repeated, first, 'Projected guard-only layers must not accumulate or change source identity');
});

['successive', 'wide'].forEach(shape => test(`guarded case links retain linear storage for ${shape} joins`, () => {
    [32, 128].forEach((size) => {
        const { model = {}, leaf } = setup();

        if (typeof leaf !== 'function') throw new TypeError('Expected the value fixture builder');

        const leaves = Array.from({ length: size }, () => leaf());
        const prefixes = [];
        const root = shape === 'wide' ? model.joined(leaves) : leaves.reduce((prior, value) => {
            const next = model.joined([prior, value]);

            append(prefixes, next);

            return next;
        }, false);
        const evidence = model.evidenceFor(root);
        const { contributions = {} } = evidence;
        const { nodes = 0, edges = 0 } = graphSize(contributions);

        ok(nodes <= 2 * size);
        ok(edges <= 2 * size);
        const { nodes: retainedNodes = 0, edges: retainedEdges = 0 } = graphSize(Object.freeze({ inputs: Object.freeze(prefixes.map(value => model.evidenceFor(value).contributions)) }));

        ok(retainedNodes <= 2 * size);
        ok(retainedEdges <= 3 * size, 'All cached prefixes together retain linear links, not a flat list at each prefix');
        strictEqual(model.evidenceFor(root), evidence);
        ['origin', 'callable'].forEach((name) => {
            const visits = [];
            const cases = model.casesFor(root, name, () => append(visits, true));

            strictEqual(visits.length, nodes, 'A warm consumer visits each retained node once');
            strictEqual(cases.length, size);
            deepStrictEqual(cases.map(entry => Reflect.get(entry, name)), name === 'origin' ? leaves : leaves.map(({ callable = false } = {}) => callable));
            ok(cases.every(({ gate = 0 } = {}) => gate === 1));
            deepStrictEqual(graphSize(contributions), { nodes, edges }, 'Demanded flat answers are not attached to prefixes');
        });
    });
}));

test('shared diamonds enumerate contributions once rather than enumerating paths', () => {
    const { model = {}, leaf } = setup();

    if (typeof leaf !== 'function') throw new TypeError('Expected the value fixture builder');

    // eslint-disable-next-line resilient/signature-contract-call-site -- These private value-graph fixtures deliberately supply record identities and false sentinel alternatives to normalValue.
    const first = leaf();
    const depth = 64;
    const root = Array.from({ length: depth }).reduce(prior => model.joined([
        model.joined([prior, leaf()]), model.joined([prior, leaf()])
    ]), first);
    const { contributions = {} } = model.evidenceFor(root);
    const { nodes = 0, edges = 0 } = graphSize(contributions);

    strictEqual(nodes, 5 * depth + 1);
    strictEqual(edges, 6 * depth);
    ['origin', 'callable'].forEach((name) => {
        const visits = [];
        const cases = model.casesFor(root, name, () => append(visits, true));

        strictEqual(visits.length, nodes);
        strictEqual(cases.length, 2 * depth + 1);
    });
});

test('case enumeration preserves ordered identities, contexts, unknowns and duplicate-origin guards', () => {
    const { model = {}, leaf, decisions = {} } = setup();

    if (typeof leaf !== 'function') throw new TypeError('Expected the value fixture builder');

    const a = decisions.variable('a');
    const b = decisions.variable('b');
    const shared = {};

    // eslint-disable-next-line resilient/signature-contract-call-site -- These private value-graph fixtures deliberately supply record identities and false sentinel alternatives to normalValue.
    const first = leaf(shared);

    // eslint-disable-next-line resilient/signature-contract-call-site -- These private value-graph fixtures deliberately supply record identities and false sentinel alternatives to normalValue.
    const second = leaf(shared);

    // eslint-disable-next-line resilient/signature-contract-call-site -- These private value-graph fixtures deliberately supply record identities and false sentinel alternatives to normalValue.
    const unknown = leaf(false);
    const root = model.joined([model.restrict(first, a), model.restrict(first, b),
        model.restrict(second, decisions.and(decisions.not(a), decisions.not(b))), model.restrict(unknown, decisions.not(a))]);
    const identities = model.casesFor(root, 'origin');
    const callables = model.casesFor(root, 'callable');

    deepStrictEqual(identities.map(({ origin = false } = {}) => origin), [first, second, unknown]);
    deepStrictEqual(callables.map(({ callable = false } = {}) => callable), [shared, false]);
    strictEqual(identities.at(0).gate, decisions.or(a, b));
    strictEqual(callables.at(0).gate, 1);
    [false, true].forEach(left => [false, true].forEach((right) => {
        const environment = new Map([[0, left], [1, right]]);

        deepStrictEqual(identities.map(({ gate = 0 } = {}) => decisions.possible(gate, environment)), [left || right, !left && !right, !left]);
        deepStrictEqual(callables.map(({ gate = 0 } = {}) => decisions.possible(gate, environment)), [true, !left]);
    }));
    [model.retire(root), model.borrow(root)].forEach((value) => {
        deepStrictEqual(model.casesFor(value, 'origin'), identities);
        deepStrictEqual(model.casesFor(value, 'callable'), callables);
    });
    deepStrictEqual(model.casesFor(false, 'origin'), []);
    deepStrictEqual(model.casesFor(false, 'callable'), [{ callable: false, gate: 1 }]);
    deepStrictEqual(model.casesFor(model.joined([model.restrict(first, 0), second]), 'origin'), [{ origin: second, gate: 1 }]);
});

test('interrupted case queries cannot publish partial results and traversal obeys its work limit', () => {
    const { model = {}, leaf } = setup();

    if (typeof leaf !== 'function') throw new TypeError('Expected the value fixture builder');

    const root = model.joined(Array.from({ length: 8 }, () => leaf()));

    model.evidenceFor(root);
    ['origin', 'callable'].forEach((name) => {
        const expected = model.casesFor(root, name);

        [1, 4, 9].forEach((checkpoint) => {
            const visits = [];
            const failure = new Error('interrupted case traversal');

            throws(() => model.casesFor(root, name, () => {
                append(visits, true);

                if (visits.length === checkpoint) throw failure;
            }), error => error === failure);
            deepStrictEqual(model.casesFor(root, name), expected);
        });
    });
    const { model: limited = {}, leaf: boundedLeaf } = setup(8);

    if (typeof boundedLeaf !== 'function') throw new TypeError('Expected the value fixture builder');

    const wide = Array.from({ length: 16 }).reduce((prior) => {
        const next = limited.joined([prior, boundedLeaf()]);

        limited.evidenceFor(next);

        return next;
    }, false);

    throws(() => limited.casesFor(wide, 'origin'), /value case limit/u);
    throws(() => limited.casesFor(wide, 'callable'), /value case limit/u);
});

test('case answers and discarded caller graphs collect while a shared producer and another caller remain live', () => {
    const { execPath = '' } = process;
    const source = `
        import {setImmediate} from 'node:timers/promises';
        import {createOwner,unresolved,readFamily} from './analysis/agreement/index.js';
        import {createDecisions} from './analysis/analyzer/decisions.js';
        import {createValues,normalValue} from './analysis/analyzer/values.js';
        const owner=createOwner({evidence:unresolved()});
        const acquire=()=>{
            const model=createValues({unknown:{owner},decisions:createDecisions()},gate=>gate,(_entry,gate)=>gate);
            const context={};
            const leaves=Array.from({length:16},()=>normalValue({owner,callable:{},identityContext:context,identity:{capability:{absenceQuestion:true}}}));
            const root=leaves.reduce((prior,value)=>model.joined([prior,value]),false);
            const identity=model.casesFor(root,'origin');
            const callable=model.casesFor(root,'callable');
            return {model,root,context,answers:[new WeakRef(identity),new WeakRef(callable)]};
        };
        const discard=()=>{const {model,root,context}=acquire();return [model,root,context].map(value=>new WeakRef(value));};
        const live=acquire();
        const discarded=discard();
        for(let turn=0;turn<5;turn+=1){await setImmediate();globalThis.gc();}
        console.log(JSON.stringify({discarded:discarded.map(ref=>!!ref.deref()),answers:live.answers.map(ref=>!!ref.deref()),
            live:live.model.casesFor(live.root,'origin').length,producer:readFamily({owner}).incomplete}));
    `;
    const output = execFileSync(execPath, ['--expose-gc', '--input-type=module', '-e', source], { encoding: 'utf8', timeout: 30000 });

    deepStrictEqual(JSON.parse(output), { discarded: [false, false, false], answers: [false, false], live: 16, producer: true });
});
