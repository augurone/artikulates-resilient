import { mergeCauses } from './causes.js';
import { append, empty, forget, freezeItems, put, retain, takeLast } from './collections.js';
import { nodeFamily, nodeContent, nodeField } from './estree-evidence.js';
import { literalValue, retainsFacet } from './estree.js';
import { completeFields, fieldEvidence, joinFields, projectFields, selectPresence } from './field-evidence.js';
import { work } from './observation.js';
import { sourceOf, evidenceOf, ownNode, publishFact, createOwner, reference, unresolved } from './source-owners.js';
import { current, track } from './validity.js';

// Own producer facts and their validity. Consumer obligations never write here.
const factRecords = new WeakMap();
export const familyFacet = Object.freeze({ kind: 'family', key: 'family' });

export const factData = fact => factRecords.get(fact);

export const unknownData = ({ kind = '' } = {}, reason = 'Unresolved evidence') => {
    if (kind === 'family') return { families: empty, incomplete: true, reason };

    if (kind === 'content') return { observations: empty, incomplete: true, reason };

    return fieldEvidence({ cases: [{ state: 'unknown', reason }], reason });
};

const inferFamily = ({ node = {}, observation = {} } = {}) => {
    const { type = '' } = node;

    if (type === 'Literal') work(observation, 'literal-classification');

    return nodeFamily(node);
};

const emptyCopySource = ({ kind = '', node = {}, family = '', observation = {} } = {}) => {
    const { families = [], incomplete = true } = kind === 'estree' ? inferFamily({ node, observation })
        : { families: kind === 'absence' ? ['nullish'] : [family], incomplete: kind !== 'family' && kind !== 'absence' };
    const { type = '' } = node;
    const empty = !incomplete && families.every(name => ['number', 'boolean', 'nullish'].includes(name));
    const emptyString = kind === 'estree' && type === 'Literal' && literalValue(node) === '';

    return empty || emptyString;
};

export const directData = ({ evidence = false, facet = {}, observation = {} } = {}) => {
    const { kind = '', node = {}, context = false, reason = '', causes = empty, projection = 'complete', fields = new Map(), open = false,
        source = false, base = false, excluded = new Set(), name: family = '' } = evidenceOf(evidence);
    const { kind: facetKind = '', name = '', copy = false } = facet;

    if (copy && facetKind === 'field' && emptyCopySource({ kind, node, family, observation })) return fieldEvidence({ cases: [{ state: 'absent' }] });

    if (kind === 'absence' && facetKind === 'family') return { families: ['nullish'], incomplete: false, reason: 'Normal completion without a value' };

    if (kind === 'family' && facetKind === 'family') return { families: [family], incomplete: false };

    if (kind === 'record' && facetKind === 'family') return { families: ['object'], incomplete: false };

    if (kind === 'record' && facetKind === 'content') return {
        observations: fields.size || (!open && !source && !base) ? [{ family: 'object', nonempty: Boolean(fields.size) }] : [],
        incomplete: !fields.size && Boolean(open || source || base)
    };

    if (kind === 'record') {
        work(observation, 'field-lookup');

        return fieldEvidence({ cases: [fields.has(name) ? { state: 'present', owner: fields.get(name) } : { state: open && !excluded.has(name) ? 'unknown' : 'absent' }] });
    }

    if (kind !== 'estree') return { ...unknownData(facet, reason || 'No producer evidence'), causes };

    if (!retainsFacet({ projection, kind: facetKind })) return unknownData(facet, 'Requested facet was not retained by the source projection');

    if (facetKind === 'family') return inferFamily({ node, observation });

    if (facetKind === 'content') {
        work(observation, 'content-inspection');

        return nodeContent(node);
    }

    work(observation, 'field-lookup');

    const { cases = [] } = nodeField({ node, name, observation });

    return fieldEvidence({ cases: cases.map(({ state = '', node: child = false, reason: fieldReason = '' } = {}) => {
        if (state !== 'present') return { state, reason: fieldReason };

        return { state, owner: ownNode({ node: child, context, reason: fieldReason }) };
    }) });
};

const copiedFamilies = new WeakMap();
const unknownCopiedOwner = createOwner({ evidence: unresolved({ reason: 'Unresolved copied property writer' }) });
const copiedOwner = owner => copiedFamilies.get(owner) || put(copiedFamilies, owner,
    createOwner({ evidence: reference({ owner, projection: 'family' }) }));
const retiredFields = new WeakMap();
const presentFields = new WeakMap();
const openFields = new WeakMap();
const retireCase = (entry) => {
    const { state = '', owner = false, source = owner, projection = '' } = entry;

    return state === 'present' && owner && projection !== 'family' ? { ...entry, owner: copiedOwner(owner), source, projection: 'family' } : entry;
};
const retireFields = (data, observation) => projectFields({ data, observation, cache: retiredFields, retire: true, select: retireCase });
const presentData = (data, observation) => projectFields({ data, observation, cache: presentFields, mask: 2, select: entry => entry });

// A copy's last present writer wins. An unknown writer can replace a value,
// but cannot remove a previously established own property. Absent writers
// share the prior contribution rather than expanding its history.
export const composeRecord = ({ evidence = false, facet: { kind = '' } = {}, data = [], observation = {} } = {}) => {
    const { kind: sourceKind = '', source = false, base = false, retire = false, open = false } = evidenceOf(evidence);

    if (sourceKind !== 'record' || kind !== 'field') return false;

    const preserveOpen = (input) => {
        const { presenceMask = 0 } = input;

        if (!open || !(presenceMask & 1)) return input;

        return projectFields({ data: input, observation, cache: openFields, open: true, select: (entry) => {
            const { state = '' } = entry;

            return state === 'absent' ? { state: 'unknown' } : entry;
        } });
    };
    const copied = source && data.at(0);
    const { presenceMask: copiedMask = 0 } = source ? copied : {};

    // An unconditional final writer makes the base irrelevant, including its
    // dependencies. Do not demand or invent an unused base fact.
    if (copiedMask === 2) return retire ? retireFields(copied, observation) : copied;

    const previous = base ? data.at(source && source !== base ? 1 : 0) : fieldEvidence({ cases: [{ state: 'absent' }] });

    if (!source) return preserveOpen(previous);

    const { presenceMask = 0 } = previous;

    if (presenceMask === 1) return preserveOpen(retire ? retireFields(copied, observation) : copied);

    const retained = presenceMask === 2;
    const selected = [
        ...(copiedMask & 2 ? [presentData(retire ? retireFields(copied, observation) : copied, observation)] : []),
        ...(copiedMask & 1 ? [previous] : []),
        ...(copiedMask & 4 ? [fieldEvidence({ cases: [{ state: retained ? 'present' : 'unknown',
            ...(retained ? { owner: unknownCopiedOwner } : {}), reason: 'Unresolved copied property writer' }] })] : [])
    ];

    return preserveOpen(joinFields(selected));
};

// Cyclic field equations keep alternatives and ordered writers separate. Only
// the three presence bits need a fixed point; present values remain shared
// graph edges. A member can gain each bit once, so propagation is O(V + E).
export const cyclicRecordData = ({ members = [], nodeFor, dataFor, observation = {} } = {}) => {
    if (typeof nodeFor !== 'function' || typeof dataFor !== 'function') throw new TypeError('Expected dependency identity and external field acquisition');

    const nodes = new Set(members.map(({ node = false } = {}) => node));
    const parents = new Map();
    const channels = new Map(members.map(({ node = false } = {}) => [node, [{}, {}]]));
    const plans = new Map(members.map(({ node = false, source: { evidence = false } = {}, dependencies = [] } = {}) => {
        const inputs = dependencies.map((dependency) => {
            const target = nodeFor(dependency);

            work(observation, 'cyclic-field-input');

            if (!nodes.has(target)) return { data: dataFor(dependency) };

            append(parents.get(target) || put(parents, target, []), node);

            return { node: target };
        });
        const { kind = '', source = false, base = false, retire = false, open = false } = evidenceOf(evidence);

        return [node, { inputs, kind, source, base, retire, open }];
    }));
    // Presence can be grounded even while the final writer's value is cyclic.
    // A copy retains presence from either input; a producer needs every input.
    // Each input edge reports a newly grounded premise at most once.
    const present = new Set();
    const remaining = new Map();
    const grounded = [];

    plans.forEach(({ inputs = [], kind = '' } = {}, node) => {
        const supplied = inputs.reduce((count, { data: { presenceMask = 0 } = {} } = {}) => count + Number(presenceMask === 2), 0);

        put(remaining, node, inputs.length - supplied);

        if (kind === 'record' ? supplied > 0 : !!inputs.length && supplied === inputs.length) {
            retain(present, node);
            append(grounded, node);
        }
    });

    // Cycles without an external presence anchor remain unresolved.
    // eslint-disable-next-line resilient/prefer-prototype-methods -- Each newly grounded member notifies its immediate dependency edges once.
    while (grounded.length) {
        const node = takeLast(grounded);

        (parents.get(node) || []).forEach((parent) => {
            work(observation, 'cyclic-field-input');

            if (present.has(parent)) return;

            const { kind = '' } = plans.get(parent);
            const count = remaining.get(parent) - 1;

            put(remaining, parent, count);

            if (kind !== 'record' && count > 0) return;

            retain(present, parent);
            append(grounded, parent);
        });
    }

    const masks = new Map(members.map(({ node = false } = {}) => [node, present.has(node) ? 2 : 4]));
    const maskOf = ({ node = false, data: { presenceMask = 0 } = {} } = {}) => node ? masks.get(node) : presenceMask;
    const layout = ({ inputs = [], source = false, base = false } = {}) => ({
        copied: source ? inputs.at(0) : {},
        previous: base ? inputs.at(source && source !== base ? 1 : 0) : {}
    });
    const unions = new Map([...plans].filter(([, { kind = '' } = {}] = []) => kind !== 'record')
        .map(([node = false, { inputs = [] } = {}] = []) => [node, inputs.reduce((mask, input) => mask | maskOf(input), 0)]));
    const pending = [...nodes];
    const queued = new Set(nodes);

    // eslint-disable-next-line resilient/prefer-prototype-methods -- This bounded presence worklist revisits dependents only when one of three field-state bits is established.
    while (pending.length) {
        const node = takeLast(pending);
        const plan = plans.get(node);
        const { kind = '', source = false, base = false, open = false } = plan;
        const { copied = {}, previous = {} } = layout(plan);
        const prior = base ? maskOf(previous) : 1;
        const supplied = source ? maskOf(copied) : 0;
        const unresolved = prior === 2 ? 2 : 4;
        const selected = source ? (supplied & 2) | (supplied & 1 ? prior : 0) | (supplied & 4 ? unresolved : 0) : prior;
        const opened = open && (selected & 1) ? (selected & 6) | 4 : selected;
        const actual = kind === 'record' ? opened : unions.get(node);
        const mask = present.has(node) ? 2 : masks.get(node) | actual;

        forget(queued, node);

        if (mask === masks.get(node)) continue;

        put(masks, node, mask);
        work(observation, 'cyclic-field-state');
        (parents.get(node) || []).forEach((parent) => {
            work(observation, 'cyclic-field-input');

            if (unions.has(parent)) put(unions, parent, unions.get(parent) | mask);

            if (queued.has(parent)) return;

            retain(queued, parent);
            append(pending, parent);
        });
    }

    const channel = ({ node = false, data = false } = {}, retired = false) => {
        if (node) return channels.get(node).at(Number(retired));

        return presentData(retired ? retireFields(data, observation) : data, observation);
    };

    plans.forEach((plan, node) => {
        const { kind = '', inputs = [], source = false, base = false, retire = false } = plan;
        const { copied = {}, previous = {} } = layout(plan);
        const supplied = source ? maskOf(copied) : 0;
        const prior = base ? maskOf(previous) : 1;

        [false, true].forEach((retired) => {
            const alternatives = kind === 'record' ? [
                ...(source && (supplied & 2) ? [channel(copied, retired || retire)] : []),
                ...(base && (!source || (supplied & 1)) ? [channel(previous, retired)] : [])
            ] : inputs.filter(input => maskOf(input) & 2).map(input => channel(input, retired));
            const unknownWriter = present.has(node) || (kind === 'record' && source && (supplied & 4) && prior === 2);
            const entry = { state: 'present', owner: unknownCopiedOwner, reason: 'Unresolved copied property writer' };
            const data = fieldEvidence({ cases: unknownWriter ? [retired ? retireCase(entry) : entry] : [] });

            completeFields(channels.get(node).at(Number(retired)), { ...data, inputs: freezeItems(alternatives), retired, presenceMask: masks.get(node) & 2 });
        });
    });

    const results = new Map();

    nodes.forEach((node) => {
        const presenceMask = masks.get(node);
        const data = fieldEvidence({ cases: [...(presenceMask & 1 ? [{ state: 'absent' }] : []),
            ...(presenceMask & 4 ? [{ state: 'unknown', reason: 'Unresolved source cycle' }] : [])] });
        const [complete = {}, retired = {}] = channels.get(node).map((input, index) => Object.freeze({ ...data,
            inputs: presenceMask & 2 ? Object.freeze([input]) : empty, retired: index === 1, presenceMask }));

        put(retiredFields, complete, retired);
        put(retiredFields, retired, retired);
        put(results, node, complete);
    });

    return results;
};

export const mergeValues = ({ facet = {}, data = [] } = {}) => {
    const { kind = '' } = facet;
    const [first = {}] = data;

    if (!data.length) return unknownData(facet, 'No producer evidence');

    if (data.length === 1) return first;

    if (kind === 'family') return {
        ...mergeCauses(data),
        families: [...new Set(data.flatMap(({ families = [] } = {}) => families))],
        incomplete: data.some(({ incomplete = false } = {}) => incomplete),
        // A lexical minimum composes across shared/cyclic joins without keeping
        // every reason or depending on which source was demanded first.
        reason: data.reduce((selected, { incomplete = false, reason = '' } = {}) => (
            incomplete && reason && (!selected || reason < selected) ? reason : selected
        ), '')
    };

    if (kind === 'content') return {
        ...mergeCauses(data),
        observations: [...new Map(data.flatMap(({ observations = [] } = {}) => observations)
            .map((observation) => {
                const { family = '', nonempty = false } = observation;

                return [`${family}:${nonempty}`, observation];
            })).values()],
        incomplete: data.some(({ incomplete = false } = {}) => incomplete)
    };

    return { ...joinFields(data), ...mergeCauses(data) };
};

const evidenceState = ({ families = [], state = '', incomplete = false } = {}) => {
    if (state) return state;

    if (families.length > 1) return 'contradictory';

    if (incomplete) return 'unknown';

    return 'known';
};

export const makeFact = ({ owner = false, version = false, facet: { kind = '', key = '' } = {}, data = {}, premises = empty } = {}) => {
    const { families = [], observations = [], incomplete = false, reason = '', causes = empty, causesTruncated = false } = data;
    const state = evidenceState(data);
    const frozenData = Object.isFrozen(data) ? data : Object.freeze({
        ...data,
        families: freezeItems([...families]),
        ...(kind === 'content' ? { observations: freezeItems(observations.map(value => Object.freeze({ ...value }))) } : {})
    });
    const { families: frozenFamilies = empty, observations: frozenObservations = empty } = frozenData;
    const [family = ''] = families;
    const fact = Object.freeze({
        owner, version, facet: key, state, reason,
        ...(causes.length || causesTruncated ? { causes, causesTruncated } : {}),
        families: frozenFamilies,
        ...(families.length === 1 ? { family } : {}),
        incomplete,
        observations: frozenObservations,
        // Only an explicit presence read materializes this historical output.
        // Aliases share its identity while a consumer holds the array.
        get presence() {
            return kind === 'field' ? selectPresence(frozenData) : empty;
        },
        premises: freezeItems([...premises])
    });

    put(factRecords, fact, frozenData);

    if (premises.length) track({ fact, owner, premises });

    return fact;
};

export const fresh = (fact) => {
    if (!factRecords.has(fact)) return false;

    const { owner = false, version = false, premises = empty } = fact;
    const { version: sourceVersion = false } = sourceOf(owner);

    return sourceVersion === version && (!premises.length || current(fact));
};

export const cachedFact = ({ owner = false, facet: { kind = '', key = '' } = {}, observation = {} } = {}) => {
    const { facts = false, familyFact = false } = sourceOf(owner);
    const fact = kind === 'family' ? familyFact : facts && facts.get(key);

    if (!fact) return false;

    const { premises = empty } = fact;

    if (premises.length) work(observation, 'validity-check');

    return fresh(fact) ? fact : false;
};

export const establish = ({ owner = false, source = {}, facet = {}, data = {}, premises = empty, observation = {} } = {}) => {
    const latest = sourceOf(owner);
    const { version: latestVersion = false } = latest;
    const { version = false } = source;

    if (latestVersion !== version) throw new Error('Source changed during establishment');

    const fact = makeFact({ owner, version, facet, data, premises });

    publishFact({ owner, source: latest, facet, fact });

    work(observation, 'establishment');

    return fact;
};
