import { put, append, frameAt, takeFrom } from './collections.js';
import { cachedFact, directData, mergeValues, unknownData, makeFact, factData, establish } from './knowledge.js';
import { plan } from './source-owners.js';

// Traverse source dependencies and publish complete strongly connected components.
const enter = ({ owner = false, facet = {}, visited = new Map(), pending = [] } = {}) => {
    const { size: index = 0 } = visited;
    const record = { ...plan({ owner, facet }), index, low: index, position: pending.length, onStack: true };

    put(visited, owner, record);
    append(pending, owner);
};

const componentData = ({ cyclic = false, dependencies = [], source: { evidence = false } = {}, facet = {}, externalData = [], observation = {} } = {}) => {
    if (cyclic) return mergeValues({ facet, data: [...externalData, unknownData(facet, 'Unresolved source cycle')] });

    if (dependencies.length) return mergeValues({ facet, data: externalData });

    return directData({ evidence, facet, observation });
};

const completeComponent = ({ record = {}, visited = new Map(), pending = [], facet = {}, observation = {} } = {}) => {
    const { low = 0, index = 0, position = 0, owner = false, source: { version = false } = {}, dependencies = [] } = record;

    if (low !== index) return;

    const members = takeFrom(pending, position).map(member => visited.get(member));
    const memberOwners = new Set(members.map(({ owner: member = false } = {}) => member));
    const external = [...new Set(members.flatMap(({ dependencies: inputs = [] } = {}) => inputs)
        .filter(({ owner: input = false } = {}) => !memberOwners.has(input)).map(dependency => cachedFact({ ...dependency, observation })))];
    const cyclic = members.length > 1 || dependencies.some(({ owner: input = false } = {}) => input === owner);
    const data = componentData({ ...record, cyclic, facet, externalData: external.map(factData), observation });

    if (!cyclic) {
        establish({ ...record, data, premises: external, observation });
        put(visited, owner, { ...record, onStack: false });

        return;
    }

    // One certificate shares all version anchors and external facts. Anchors
    // have no premises, so both retained provenance and validation stay acyclic.
    const anchors = members.map(({ owner: member = false, source: { version: premise = false } = {} } = {}) => {
        return makeFact({ owner: member, version: premise, facet, data: unknownData(facet, 'Cycle premise') });
    });
    const certificate = makeFact({ owner, version, facet, data, premises: [...external, ...anchors] });
    const sharedData = factData(certificate);

    members.forEach((member) => {
        const { owner: memberOwner = false } = member;

        establish({ ...member, data: sharedData, premises: [certificate], observation });
        put(visited, memberOwner, { ...member, onStack: false });
    });
};

const advance = ({ record = {}, dependency = {}, visited = new Map(), pending = [], frames = [], cursor = 0, observation = {} } = {}) => {
    if (cachedFact({ ...dependency, observation })) return cursor;

    const { owner = false, low = 0 } = record;
    const { owner: dependencyOwner = false } = dependency;
    const seen = visited.get(dependencyOwner);
    const { onStack = false, index = 0 } = seen ?? {};

    if (onStack) put(visited, owner, { ...record, low: Math.min(low, index) });

    if (seen) return cursor;

    enter({ ...dependency, visited, pending });
    frameAt(frames, cursor + 1, { owner: dependencyOwner, next: 0 });

    return cursor + 1;
};

export const solve = ({ owner = false, facet = {}, observation = {} } = {}) => {
    const retained = cachedFact({ owner, facet, observation });

    if (retained) return retained;

    const visited = new Map();
    const pending = [];
    const frames = [{ owner, next: 0 }];

    enter({ owner, facet, visited, pending });

    // eslint-disable-next-line resilient/prefer-prototype-methods -- Iterative Tarjan traversal avoids stack overflow and publishes complete cycles independently of request order.
    for (let cursor = 0; cursor >= 0;) {
        const { [cursor]: frame = {} } = frames;
        const { owner: frameOwner = false, next = 0 } = frame;
        const record = visited.get(frameOwner);
        const { dependencies = [], low = 0 } = record;

        if (next < dependencies.length) {
            const { [next]: dependency = {} } = dependencies;

            frameAt(frames, cursor, { ...frame, next: next + 1 });

            cursor = advance({ record, dependency, visited, pending, frames, cursor, observation });
            continue;
        }

        completeComponent({ record, visited, pending, facet, observation });
        cursor -= 1;

        if (cursor < 0) return cachedFact({ owner, facet, observation });

        const { [cursor]: { owner: parentOwner = false } = {} } = frames;
        const parent = visited.get(parentOwner);
        const { low: parentLow = 0 } = parent;

        put(visited, parentOwner, { ...parent, low: Math.min(parentLow, low) });
    }

    throw new Error('Fact traversal did not complete');
};
