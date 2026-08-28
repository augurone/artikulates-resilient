const KINDS = Object.freeze([
    'unknown',
    'undefined',
    'null',
    'string',
    'number',
    'boolean',
    'array',
    'promise',
    'object'
]);

const unknown = (sourceNode = {}) => ({
    kind: 'unknown',
    state: 'unknown',
    sourceNode
});

const contradictory = ({ conflicts = [], sourceNode = {} } = {}) => ({
    kind: 'unknown',
    state: 'contradictory',
    conflicts: [...new Set(conflicts)],
    sourceNode
});

const contract = ({
    kind = 'unknown',
    sourceNode = {},
    optional = false,
    element = unknown(),
    properties = {},
    branches = [],
    state = '',
    conflicts = [],
    elements = []
} = {}) => ({
    kind: KINDS.includes(kind) ? kind : 'unknown',
    state: state || (KINDS.includes(kind) && kind !== 'unknown' ? 'known' : 'unknown'),
    sourceNode,
    optional,
    ...(state === 'contradictory' && { conflicts: [...new Set(conflicts)] }),
    ...(kind === 'array' && { element, ...(elements.length && { elements }) }),
    ...(kind === 'promise' && { element }),
    ...(kind === 'object' && { properties, branches })
});

const withOptional = (value = unknown(), optional = false) => ({
    ...value,
    optional: Boolean(optional)
});

const getKind = ({ kind = 'unknown' } = {}) => kind;

const isKnown = ({ kind = 'unknown' } = {}) => kind !== 'unknown';

const isContradictory = ({ state = '' } = {}) => state === 'contradictory';

const getContractVariants = (value = unknown()) => {
    const {
        state = '',
        conflicts = [],
        sourceNode = {}
    } = value;
    if (state !== 'contradictory') return isKnown(value) ? [value] : [];
    return conflicts.map(kind => contract({
        kind,
        sourceNode
    }));
};

const getContractShape = ({
    kind = 'unknown',
    state = 'unknown',
    conflicts = [],
    optional = false,
    element = {},
    elements = [],
    properties = {}
} = {}) => ({
    kind,
    state,
    ...(state === 'contradictory' && { conflicts: [...new Set(conflicts)] }),
    optional,
    ...(kind === 'array' && {
        element: getContractShape(element),
        ...(elements.length && { elements: elements.map(getContractShape) })
    }),
    ...(kind === 'promise' && { element: getContractShape(element) }),
    ...(kind === 'object' && {
        properties: Object.fromEntries(Object.entries(properties)
            .sort(([left = ''], [right = '']) => left.localeCompare(right))
            .map(([name = '', property = {}] = []) => [name, getContractShape(property)]))
    })
});

const isEqual = (left = unknown(), right = unknown()) => (
    JSON.stringify(getContractShape(left)) === JSON.stringify(getContractShape(right))
);

let mergeContracts = () => unknown();

const mergeArrayContracts = (knownValues = [], options = {}) => contract({
    kind: 'array',
    element: mergeContracts(knownValues.map(({ element = {} } = {}) => element), options)
});

const mergePromiseContracts = (knownValues = [], options = {}) => contract({
    kind: 'promise',
    element: mergeContracts(knownValues.map(({ element = {} } = {}) => element), options)
});

const mergeObjectContracts = (knownValues = [], options = {}) => {
    const propertyNames = [...new Set(knownValues.flatMap(({ properties = {} } = {}) => Object.keys(properties)))];
    const properties = Object.fromEntries(propertyNames.map((name = '') => [
        name,
        mergeContracts(knownValues.map(({ properties: sourceProperties = {} } = {}) => (
            sourceProperties[name] || unknown()
        )), options)
    ]));

    return contract({ kind: 'object', properties });
};

const mergeSameKind = ({ kind = 'unknown', knownValues = [], options = {} } = {}) => {
    if (kind === 'array') return mergeArrayContracts(knownValues, options);
    if (kind === 'promise') return mergePromiseContracts(knownValues, options);
    if (kind === 'object') return mergeObjectContracts(knownValues, options);
    return contract({ kind });
};

mergeContracts = (values = [], { preserveContradictions = true } = {}) => {
    const options = { preserveContradictions };
    const contradictoryValues = values.filter(isContradictory);
    const knownValues = values.filter(isKnown);
    if (preserveContradictions && contradictoryValues.length) return contradictory({
        conflicts: [
            ...contradictoryValues.flatMap(({ conflicts: sourceConflicts = [] } = {}) => sourceConflicts),
            ...knownValues.map(getKind)
        ],
        sourceNode: contradictoryValues[0].sourceNode
    });
    if (!knownValues.length) return unknown();

    const kinds = [...new Set(knownValues.map(getKind))];
    if (kinds.length !== 1 && preserveContradictions) return contradictory({
        conflicts: kinds,
        sourceNode: knownValues[0].sourceNode
    });
    if (kinds.length !== 1) return unknown();
    const [kind = 'unknown'] = kinds;
    return mergeSameKind({ kind, knownValues, options });
};

const isCompatible = ({ expected = unknown(), actual = unknown() } = {}) => {
    if (isContradictory(expected) || isContradictory(actual)) return false;
    if (!isKnown(expected) || !isKnown(actual)) return true;
    if (expected.kind !== actual.kind) return false;

    if (['array', 'promise'].includes(expected.kind)) {
        return isCompatible({ expected: expected.element, actual: actual.element });
    }

    if (expected.kind !== 'object') return true;

    return Object.entries(expected.properties || {}).every(([name = '', property = {}] = []) => {
        const { properties: actualProperties = {} } = actual;
        const actualProperty = actualProperties[name] || unknown();
        return isCompatible({ expected: property, actual: actualProperty });
    });
};

const describe = ({ kind = 'unknown' } = {}) => ({
    unknown: 'unknown',
    undefined: 'undefined',
    null: 'null',
    string: 'string-like',
    number: 'number-like',
    boolean: 'boolean-like',
    array: 'array-like',
    promise: 'promise-like',
    object: 'object-like'
}[kind] || 'unknown');

export {
    contract,
    describe,
    getKind,
    isEqual,
    isCompatible,
    isContradictory,
    isKnown,
    mergeContracts,
    getContractVariants,
    contradictory,
    unknown,
    withOptional
};
