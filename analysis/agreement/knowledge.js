import { mergeCauses } from './causes.js';
import { empty, freezeItems, put } from './collections.js';
import { nodeFamily, nodeContent, nodeField } from './estree-evidence.js';
import { retainsFacet } from './estree.js';
import { fieldEvidence, joinFields, selectPresence } from './field-evidence.js';
import { work } from './observation.js';
import { sourceOf, evidenceOf, ownNode, publishFact } from './source-owners.js';
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

export const directData = ({ evidence = false, facet = {}, observation = {} } = {}) => {
    const { kind = '', node = {}, context = false, reason = '', causes = empty, projection = 'complete', fields = new Map(), open = false, name: family = '' } = evidenceOf(evidence);
    const { kind: facetKind = '', name = '' } = facet;

    if (kind === 'absence' && facetKind === 'family') return { families: ['nullish'], incomplete: false, reason: 'Normal completion without a value' };

    if (kind === 'family' && facetKind === 'family') return { families: [family], incomplete: false };

    if (kind === 'record' && facetKind === 'family') return { families: ['object'], incomplete: false };

    if (kind === 'record' && facetKind === 'content') return {
        observations: fields.size || !open ? [{ family: 'object', nonempty: Boolean(fields.size) }] : [], incomplete: open && !fields.size
    };

    if (kind === 'record') {
        work(observation, 'field-lookup');

        return fieldEvidence({ cases: [fields.has(name) ? { state: 'present', owner: fields.get(name) } : { state: open ? 'unknown' : 'absent' }] });
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

export const mergeValues = ({ facet = {}, data = [] } = {}) => {
    const { kind = '' } = facet;
    const [first = {}] = data;

    if (!data.length) return unknownData(facet, 'No producer evidence');

    if (data.length === 1) return first;

    if (kind === 'family') return {
        ...mergeCauses(data),
        families: [...new Set(data.flatMap(({ families = [] } = {}) => families))],
        incomplete: data.some(({ incomplete = false } = {}) => incomplete),
        reason: data.filter(({ incomplete = false } = {}) => incomplete).map(({ reason = '' } = {}) => reason).find(Boolean) || ''
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
