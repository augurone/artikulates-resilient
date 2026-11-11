import { put, append, frameAt, takeFrom } from './collections.js';
import { cachedFact, directData, composeRecord, cyclicRecordData, mergeValues, unknownData, makeFact, factData, establish } from './knowledge.js';
import { evidenceOf, plan } from './source-owners.js';

// Traverse source dependencies and publish complete strongly connected components.
const enter = ({ node = {}, visited = new Map(), pending = [] } = {}) => {
    const { owner = false, facet = {} } = node;
    const { size: index = 0 } = visited;
    const record = { ...plan({ owner, facet }), node, index, low: index, position: pending.length, onStack: true };

    put(visited, node, record);
    append(pending, node);
};

const componentData = ({ cyclic = false, dependencies = [], source: { evidence = false } = {}, facet = {}, externalData = [], observation = {} } = {}) => {
    if (cyclic) return mergeValues({ facet, data: [...externalData, unknownData(facet, 'Unresolved source cycle')] });

    if (dependencies.length) return composeRecord({ evidence, facet, data: externalData, observation }) || mergeValues({ facet, data: externalData });

    return directData({ evidence, facet, observation });
};

const selectedDependencies = (record, observation) => {
    const { source: { evidence = false } = {}, facet: { kind: facetKind = '' } = {}, dependencies = [] } = record;
    const { kind = '', source = false, base = false } = evidenceOf(evidence);

    if (kind !== 'record' || facetKind !== 'field' || !source || !base || dependencies.length < 2) return record;

    const selected = cachedFact({ ...dependencies.at(0), observation });
    const { presenceMask = 0 } = selected ? factData(selected) : {};

    return presenceMask === 2 ? { ...record, dependencies: dependencies.slice(0, 1) } : record;
};

const completeComponent = ({ record = {}, visited = new Map(), pending = [], observation = {}, nodeFor } = {}) => {
    const { low = 0, index = 0, position = 0, node = false, owner = false, facet = {}, source: { version = false } = {}, dependencies = [] } = record;

    if (typeof nodeFor !== 'function') throw new TypeError('Expected dependency identity acquisition');

    if (low !== index) return;

    const members = takeFrom(pending, position).map(member => visited.get(member));
    const memberNodes = new Set(members.map(({ node = false } = {}) => node));
    const external = [...new Set(members.flatMap(({ dependencies: inputs = [] } = {}) => inputs)
        .filter(dependency => !memberNodes.has(nodeFor(dependency))).map(dependency => cachedFact({ ...dependency, observation })))];
    const cyclic = members.length > 1 || dependencies.some(dependency => nodeFor(dependency) === node);
    const copiedCycle = cyclic && members.some(({ source: { evidence = false } = {} } = {}) => evidenceOf(evidence).kind === 'record');
    // Copy members need their own ordered result. The shared certificate below
    // owns validity, not a union of every field found anywhere in the cycle.
    const copied = copiedCycle && cyclicRecordData({ members, nodeFor, observation,
        dataFor: dependency => factData(cachedFact({ ...dependency, observation })) });
    const data = copied ? copied.get(node)
        : componentData({ ...record, cyclic, facet, externalData: external.map(factData), observation });

    if (!cyclic) {
        establish({ ...record, data, premises: external, observation });
        put(visited, node, { ...record, onStack: false });

        return;
    }

    // One certificate shares all version anchors and external facts. Anchors
    // have no premises, so fact certificates and validation stay acyclic.
    const anchors = members.map(({ owner: member = false, facet: selected = {}, source: { version: premise = false } = {} } = {}) => {
        return makeFact({ owner: member, version: premise, facet: selected, data: unknownData(selected, 'Cycle premise') });
    });
    const certificate = makeFact({ owner, version, facet, data, premises: [...external, ...anchors] });
    const sharedData = factData(certificate);

    members.forEach((member) => {
        const { node = false } = member;

        establish({ ...member, data: copied ? copied.get(node) : sharedData, premises: [certificate], observation });
        put(visited, node, { ...member, onStack: false });
    });
};

const advance = ({ record = {}, dependency = {}, visited = new Map(), pending = [], frames = [], cursor = 0, observation = {}, nodeFor } = {}) => {
    if (typeof nodeFor !== 'function') throw new TypeError('Expected dependency identity acquisition');

    if (cachedFact({ ...dependency, observation })) return cursor;

    const { node = false, low = 0 } = record;
    const target = nodeFor(dependency);
    const seen = visited.get(target);
    const { onStack = false, index = 0 } = seen ?? {};

    if (onStack) put(visited, node, { ...record, low: Math.min(low, index) });

    if (seen) return cursor;

    enter({ node: target, visited, pending });
    frameAt(frames, cursor + 1, { node: target, next: 0 });

    return cursor + 1;
};

export const solve = ({ owner = false, facet = {}, observation = {} } = {}) => {
    const retained = cachedFact({ owner, facet, observation });

    if (retained) return retained;

    const visited = new Map();
    const pending = [];
    const nodes = new Map();
    // Copy dependencies can request a different field view of the same
    // owner. Identity is the demanded owner/facet pair, never the owner alone.
    const nodeFor = ({ owner = false, facet = {} } = {}) => {
        const { key = '' } = facet;
        const facets = nodes.get(owner) || put(nodes, owner, new Map());

        return facets.get(key) || put(facets, key, { owner, facet });
    };
    const node = nodeFor({ owner, facet });
    const frames = [{ node, next: 0 }];

    enter({ node, visited, pending });

    // eslint-disable-next-line resilient/prefer-prototype-methods -- Iterative Tarjan traversal avoids stack overflow and publishes complete cycles independently of request order.
    for (let cursor = 0; cursor >= 0;) {
        const { [cursor]: frame = {} } = frames;
        const { node = false, next = 0 } = frame;
        const prior = visited.get(node);
        const record = selectedDependencies(prior, observation);
        const { dependencies = [], low = 0 } = record;

        if (record !== prior) put(visited, node, record);

        if (next < dependencies.length) {
            const { [next]: dependency = {} } = dependencies;

            frameAt(frames, cursor, { ...frame, next: next + 1 });

            cursor = advance({ record, dependency, visited, pending, frames, cursor, observation, nodeFor });
            continue;
        }

        completeComponent({ record, visited, pending, observation, nodeFor });
        cursor -= 1;

        if (cursor < 0) return cachedFact({ owner, facet, observation });

        const { [cursor]: { node: parentNode = false } = {} } = frames;
        const parent = visited.get(parentNode);
        const { low: parentLow = 0 } = parent;

        put(visited, parentNode, { ...parent, low: Math.min(parentLow, low) });
    }

    throw new Error('Fact traversal did not complete');
};
