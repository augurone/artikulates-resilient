import { put, retain } from '../collections.js';

// Complete source references own local-reader admission. Runtime query order
// cannot turn a partial set of observed calls into a closed invocation lifetime.
export const acquireLocalReaders = ({ bindings = [], references = [], functionEntries = [], callableSources = new WeakMap(), identities = new WeakMap(),
    selected = new Map(), executionParents = new Map(), writes = new Set(), exposedRecords = new Set(), parents = new WeakMap() } = {}, rootFor, exported) => {
    if (typeof rootFor !== 'function' || typeof exported !== 'function') throw new TypeError('Expected acquired root and export queries');

    const localReaders = new Map();
    const executionsByFunction = new Map(functionEntries.map(({ node = {}, execution = false } = {}) => [node, execution]));
    bindings.forEach((binding) => {
        const source = callableSources.get(binding);
        const execution = source && executionsByFunction.get(source);
        const { async = false, generator = false } = source ? source : {};

        if (!execution) return;

        const parent = executionParents.get(execution);
        const previous = localReaders.get(execution);
        const { closed: previouslyClosed = false } = previous ?? {};
        const closed = !async && !generator && !writes.has(binding) && !exported(binding, parents) && !exposedRecords.has(selected.get(binding) || binding);

        put(localReaders, execution, { closed: closed && (!previous || previouslyClosed), parent, sites: new Set() });
    });
    references.forEach(({ node = {}, execution = false } = {}) => {
        const binding = identities.get(node);

        const { declaration: { node: declared = false } = {} } = binding ? binding : {};

        if (declared === node) return;

        const source = callableSources.get(binding);
        const reader = source && executionsByFunction.get(source);
        const entry = reader && localReaders.get(reader);

        const { closed = false, parent: owner = false, sites = new Set() } = entry ? entry : {};

        if (!closed) return;

        const parent = parents.get(node) || {};
        const { type = '', callee = false, init = false, id = {} } = parent;
        const alias = type === 'VariableDeclarator' && init === node && callableSources.get(identities.get(id)) === source;
        const called = type === 'CallExpression' && callee === node;

        if (called) retain(sites, parent);

        if (execution !== owner || (!alias && !called)) put(localReaders, reader, { ...entry, closed: false });
    });
    const payloadCaptures = new Map();
    references.forEach(({ node = {}, execution = false } = {}) => {
        const binding = identities.get(rootFor(node));
        const root = selected.get(binding) || binding;
        const { execution: owner = false } = root ? root : {};

        if (!root || owner === execution) return;

        const { closed = false, parent = false } = localReaders.get(execution) ?? {};
        const prior = payloadCaptures.get(root);

        put(payloadCaptures, root, prior !== false && closed && parent === owner);
    });

    return { localReaders, payloadCaptures };
};
