import { sourceCause } from './causes.js';
import { empty, forget, put } from './collections.js';
import { retainsFacet, snapshotESTree } from './estree.js';
import { families } from './families.js';
import { deliver } from './observation.js';
import { invalidate, retireOnInvalidation } from './validity.js';

// Own source identities, evidence snapshots, context slots, and revision commits.
// No source-store object is exported; readers receive immutable source records.
const sources = new WeakMap();
const evidenceRecords = new WeakMap();
const contexts = new WeakMap();
const nodeOwners = new WeakMap();

export const sourceOf = (owner) => {
    const source = sources.get(owner);

    if (!source) throw new TypeError('Expected a registered source owner');

    return source;
};

export const evidenceOf = (evidence) => {
    const record = evidenceRecords.get(evidence);

    if (!record) throw new TypeError('Expected registered source evidence');

    return record;
};

const evidenceFor = (record) => {
    const evidence = Object.freeze({});

    put(evidenceRecords, evidence, Object.freeze(record));

    return evidence;
};

export const fromESTree = (node, { context = false, projection = 'complete' } = {}) => {
    if (!node || typeof node !== 'object') throw new TypeError('Expected an ESTree node');

    const { type = false } = node;

    if (typeof type !== 'string') throw new TypeError('Expected an ESTree node');

    if (context && !contexts.has(context)) throw new TypeError('Expected a registered source context');

    return evidenceFor({ kind: 'estree', node: snapshotESTree({ node, projection }), context, projection });
};

export const unresolved = ({ reason = 'Explicitly unresolved source', code = '', location = {} } = {}) => {
    if (typeof reason !== 'string') throw new TypeError('Expected an unresolved-source reason string');

    return evidenceFor({ kind: 'unresolved', reason, causes: sourceCause({ code, reason, location }) });
};

// A producer adapter may establish a result family without fabricating syntax.
export const familyEvidence = ({ name = '' } = {}) => {
    if (!families.includes(name)) throw new TypeError('Unsupported source family');

    return evidenceFor({ kind: 'family', name });
};

// The adapter establishes normal completion without a value, never a consumer fallback.
export const absent = () => evidenceFor({ kind: 'absence' });

export const createOwner = ({ evidence = false } = {}) => {
    evidenceOf(evidence);

    const owner = Object.freeze({});

    put(sources, owner, Object.freeze({ version: Symbol('source premise'), evidence }));

    return owner;
};

export const reference = ({ owner = false, projection = 'complete' } = {}) => {
    sourceOf(owner);

    if (!['complete', 'family'].includes(projection)) throw new TypeError('Unsupported reference projection');

    return evidenceFor({ kind: 'reference', owner, projection });
};

// An adapter owns these evaluated field sources. Their identities are shared,
// not encoded as invented syntax or expanded into copied descendant records.
export const record = ({ fields = [], open = false } = {}) => {
    if (!Array.isArray(fields) || typeof open !== 'boolean') throw new TypeError('Expected record fields and an explicit openness flag');

    const entries = Array.from(fields, ({ name = false, owner = false } = {}) => {
        if (typeof name !== 'string') throw new TypeError('Expected a record field name');

        sourceOf(owner);

        return [name, owner];
    });

    return evidenceFor({ kind: 'record', fields: new Map(entries), open });
};

// These are source results belonging to one producer agreement, not a permissive
// union. The adapter owns the evidence that these results belong at that boundary.
export const producer = ({ owners = [] } = {}) => {
    if (!Array.isArray(owners)) throw new TypeError('Expected producer source owners');

    // Snapshot before validation so every retained contribution is checked.
    const contributions = Array.from(owners);

    contributions.forEach(sourceOf);

    return evidenceFor({ kind: 'producer', owners: Object.freeze(contributions) });
};

export const replaceAll = ({ updates = [], onWork } = {}) => {
    if (!Array.isArray(updates)) throw new TypeError('Expected source updates');

    // Array.from visits sparse slots; no missing update may bypass validation.
    const prepared = Array.from(updates, ({ owner = false, evidence = false } = {}) => {
        sourceOf(owner);
        evidenceOf(evidence);

        return { owner, source: Object.freeze({ version: Symbol('source premise'), evidence }) };
    });

    if (new Set(prepared.map(({ owner = false } = {}) => owner)).size !== prepared.length) throw new TypeError('A source may appear only once in an update');

    if (!prepared.length) return empty;

    const owners = Object.freeze(prepared.map(({ owner = false } = {}) => owner));
    const observation = typeof onWork === 'function' ? { events: [] } : {};

    // No user callbacks occur inside this synchronous commit. Validation above
    // completes before any source changes; readers see one completed batch.
    prepared.forEach(({ owner = false, source = {} } = {}) => put(sources, owner, source));
    invalidate({ owners, observation });

    const { events = [] } = observation;

    events.forEach(event => deliver(onWork, event));

    return owners;
};

export const replaceEvidence = ({ owner = false, evidence = false, ...observation } = {}) => {
    replaceAll({ ...observation, updates: [{ owner, evidence }] });

    return owner;
};

export const createContext = () => {
    const names = new Map();
    const source = ({ name = '' } = {}) => {
        if (typeof name !== 'string' || !name) throw new TypeError('Expected a source name in this context');

        if (names.has(name)) return names.get(name);

        return put(names, name, createOwner({ evidence: unresolved({ reason: 'Unresolved binding in this context' }) }));
    };
    const define = ({ name = '', evidence = false } = {}) => {
        evidenceOf(evidence);

        return replaceEvidence({ owner: source({ name }), evidence });
    };
    const context = Object.freeze({ source, define });

    put(contexts, context, names);

    return context;
};

export const ownNode = ({ node = false, context = false, reason = 'Unresolved field value' } = {}) => {
    if (!node) return createOwner({ evidence: unresolved({ reason }) });

    if (nodeOwners.has(node)) return nodeOwners.get(node);

    return put(nodeOwners, node, createOwner({ evidence: evidenceFor({ kind: 'estree', node, context }) }));
};

export const plan = ({ owner = false, facet = {} } = {}) => {
    const { kind: facetKind = '' } = facet;
    const source = sourceOf(owner);
    const { evidence = false } = source;
    const { kind = '', owner: target = false, owners = [], node = {}, context = false, projection = 'complete' } = evidenceOf(evidence);
    const { type = '' } = node;
    const references = kind === 'reference' && (projection !== 'family' || facetKind === 'family') ? [target] : owners;
    const dependencies = references.map(dependency => ({ owner: dependency, facet }));

    // A context can supply missing source facts, never widen a projection's
    // declared evidence boundary through an identifier dependency.
    if (kind === 'estree' && !retainsFacet({ projection, kind: facetKind })) return { owner, facet, source, dependencies: empty };

    // Presence snapshots own local property headers, not a referenced value's
    // fields. Following that field dependency would expose its retained values.
    if (kind === 'estree' && projection === 'presence' && facetKind === 'field') return { owner, facet, source, dependencies: empty };

    if (kind === 'estree' && type === 'Identifier' && context) {
        const { name = '' } = node;

        return { owner, facet, source, dependencies: [{ owner: context.source({ name }), facet }] };
    }

    return { owner, facet, source, dependencies };
};

const retireFact = ({ owner = false, kind = '', key = '', fact = false } = {}) => {
    const { version = false, evidence = false, familyFact = false, facts = false } = sourceOf(owner);

    if (kind === 'family' && familyFact === fact) {
        put(sources, owner, Object.freeze({ version, evidence, ...(facts ? { facts } : {}) }));

        return;
    }

    if (kind !== 'family' && facts && facts.get(key) === fact) forget(facts, key);
};

export const publishFact = ({ owner = false, source = {}, facet: { kind = '', key = '' } = {}, fact = {} } = {}) => {
    const { premises = empty } = fact;

    if (premises.length) retireOnInvalidation(fact, () => retireFact({ owner, kind, key, fact }));

    if (kind === 'family') {
        put(sources, owner, Object.freeze({ ...source, familyFact: fact }));

        return;
    }

    const { facts = new Map() } = source;

    put(facts, key, fact);
    put(sources, owner, Object.freeze({ ...source, facts }));
};
