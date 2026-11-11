import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';

import { all, createOwner, field, fromESTree, inspect, isCurrent, producer, reference, replaceEvidence, request } from 'eslint-plugin-resilient/agreement';

import { append } from './collections.js';

const statusOf = ({ status = '' } = {}) => status;
const factsOf = ({ facts = [] } = {}) => facts;
const presenceOf = ({ presence = [] } = {}) => presence;
const text = fromESTree({ type: 'Literal', value: 'text' });
const number = fromESTree({ type: 'Literal', value: 42 });
const collect = () => {
    if (typeof globalThis.gc !== 'function') throw new Error('Run with --expose-gc');

    globalThis.gc();
};
const collectAcrossTurns = async () => {
    await setImmediate();
    collect();
    await setImmediate();
    collect();
    await setImmediate();
    collect();
    await setImmediate();
    collect();
    await setImmediate();
    collect();
};
const weakRequest = (owner, required) => {
    const judgment = request({ owner, required });

    strictEqual(statusOf(judgment), 'agreement');

    return { judgment: new WeakRef(judgment), facts: new WeakRef(factsOf(judgment)) };
};
const live = ({ judgment = false, facts = false } = {}) => ({ judgment: Boolean(judgment.deref()), facts: Boolean(facts.deref()) });
const lifecycle = async () => {
    const owner = createOwner({ evidence: text });
    const required = all({ requirements: ['string', 'string'] });
    const refs = weakRequest(owner, required);

    await collectAcrossTurns();

    const afterRelease = live(refs);

    replaceEvidence({ owner, evidence: number });
    await collectAcrossTurns();

    const afterRevision = live(refs);

    strictEqual(statusOf(request({ owner, required })), 'contradiction');
    await collectAcrossTurns();

    const afterRequery = live(refs);

    // Keep both cache keys observably live through the last collection.
    strictEqual(statusOf(request({ owner, required })), 'contradiction');

    return { afterRelease, afterRevision, afterRequery };
};
const retained = (references) => {
    const arrays = references.map(reference => reference.deref()).filter(Boolean);

    return { liveArrays: arrays.length, liveEntries: arrays.reduce((sum, { length = 0 } = {}) => sum + length, 0) };
};
const property = name => ({ type: 'Property', computed: false, method: false, kind: 'init',
    key: { type: 'Identifier', name }, value: { type: 'Literal', value: 'text' } });
const requirementPrefixes = async (count, keep = false) => {
    const properties = Array.from({ length: count }, (_, index) => property(`p${index}`));
    const owner = createOwner({ evidence: fromESTree({ type: 'ObjectExpression', properties }) });
    const references = [];
    const held = [];
    const required = properties.reduce((prior, _, index) => {
        const next = all({ requirements: [prior, field({ name: `p${index}`, required: 'string' })] });
        const { facts = [] } = request({ owner, required: next });

        strictEqual(facts.length, 2 * (index + 1) + 1);
        append(references, new WeakRef(facts));

        if (keep) append(held, facts);

        return next;
    }, all());

    await collectAcrossTurns();

    const result = { count, ...retained(references) };

    held.forEach(facts => ok(Object.isFrozen(facts)));

    // Client retains only the final requirement and source, not intermediate outputs.
    strictEqual(statusOf(request({ owner, required })), 'agreement');

    return result;
};
const producerPrefixes = async (count, keep = false) => {
    const required = field({ name: 'x', required: all() });
    const leaf = () => createOwner({ evidence: fromESTree({ type: 'ObjectExpression', properties: [property('x')] }) });
    const references = [];
    const held = [];
    const owner = Array.from({ length: count }).reduce((prior, _, index) => {
        const next = createOwner({ evidence: producer({ owners: [prior, leaf()] }) });
        const { status = '', facts: [, fact = false] = [] } = request({ owner: next, required });
        const presence = presenceOf(fact);

        strictEqual(status, 'agreement');
        strictEqual(presence.length, index + 2);
        append(references, new WeakRef(presence));

        if (keep) append(held, { owner: next, presence });

        return next;
    }, leaf());

    await collectAcrossTurns();

    const result = { count, ...retained(references) };

    held.forEach(({ owner: source = false, presence = [] } = {}) => {
        const { facts: [, fact = false] = [] } = request({ owner: source, required });

        strictEqual(presenceOf(fact), presence);
    });
    strictEqual(statusOf(request({ owner, required })), 'agreement');

    return result;
};

const record = () => createOwner({ evidence: fromESTree({ type: 'ObjectExpression', properties: [property('x')] }) });
const alias = owner => createOwner({ evidence: reference({ owner }) });
const weakFacts = (owner, required, expected) => {
    const judgment = request({ owner, required });

    strictEqual(statusOf(judgment), expected);

    return factsOf(judgment).map(fact => new WeakRef(fact));
};
const staleMemo = async (cyclic) => {
    const source = record();
    const linked = alias(source);

    if (cyclic) replaceEvidence({ owner: linked, evidence: producer({ owners: [linked, source] }) });

    const owner = alias(linked);
    const required = field({ name: 'x', required: 'string' });
    const references = weakFacts(owner, required, cyclic ? 'unknown' : 'agreement');

    replaceEvidence({ owner: source, evidence: number });
    await collectAcrossTurns();

    const { length: liveFacts = 0 } = references.filter(item => item.deref());

    // No requery before sampling: invalidation itself must retire stale caches.
    strictEqual(statusOf(request({ owner, required })), 'contradiction');

    return { cyclic, sampledFacts: references.length, liveFacts };
};
const historical = async () => {
    const source = record();
    const owner = alias(source);
    const required = field({ name: 'x', required: 'string' });
    const judgment = request({ owner, required });
    const { facts: [, fact = false] = [] } = judgment;
    const presence = presenceOf(fact);

    await collectAcrossTurns();

    const { facts: [, other = false] = [] } = request({ owner: alias(owner), required });

    strictEqual(presenceOf(other), presence);
    replaceEvidence({ owner: source, evidence: number });
    await collectAcrossTurns();
    strictEqual(isCurrent(judgment), false);
    strictEqual(inspect(judgment).historicalOutcome, 'agreement');
    throws(() => statusOf(judgment), /Stale judgment/);
    strictEqual(presenceOf(fact), presence);
    deepStrictEqual(presence, ['present']);
    strictEqual(statusOf(request({ owner, required })), 'contradiction');

    return { identityWhileHeld: true, historicalAfterRevision: true };
};

// Run fixtures sequentially so their live roots and explicit collection windows
// do not overlap. Counts describe observable retained arrays, not timed throughput.
const output = {
    question: 'Do discarded consumer projections collect while source and requirement roots remain live?',
    lifecycle: await lifecycle(),
    requirementPrefixes: [await requirementPrefixes(32)],
    producerPrefixes: [await producerPrefixes(32)],
    heldRequirementOutput: await requirementPrefixes(32, true), heldProducerOutput: await producerPrefixes(32, true),
    staleMemo: [await staleMemo(false), await staleMemo(true)], historical: await historical(),
    limitations: ['Explicit GC observations are not a production finalization schedule.',
        'Entries count array slots, not bytes or whole-lint throughput.',
        'The probes report lifetime behavior without declaring the measured design accepted.']
};

const { lifecycle: stages = {}, requirementPrefixes: requirements = [], producerPrefixes: producers = [], staleMemo: stale = [],
    heldRequirementOutput: { liveArrays: heldFacts = 0 } = {}, heldProducerOutput: { liveArrays: heldPresence = 0 } = {} } = output;

Object.values(stages).forEach(stage => deepStrictEqual(stage, { judgment: false, facts: false }));
[...requirements, ...producers].forEach(({ liveArrays = 0, liveEntries = 0 } = {}) => deepStrictEqual([liveArrays, liveEntries], [0, 0]));
stale.forEach(({ liveFacts = 0 } = {}) => strictEqual(liveFacts, 0));
deepStrictEqual([heldFacts, heldPresence], [32, 32]);

process.stdout.write(JSON.stringify(output));
