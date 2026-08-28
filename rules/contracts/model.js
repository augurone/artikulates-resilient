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
    sourceNode
});

const contract = ({
    kind = 'unknown',
    sourceNode = {},
    optional = false,
    element = unknown(),
    properties = {},
    branches = []
} = {}) => ({
    kind: KINDS.includes(kind) ? kind : 'unknown',
    sourceNode,
    optional,
    ...(['array', 'promise'].includes(kind) && { element }),
    ...(kind === 'object' && { properties, branches })
});

const withOptional = (value = unknown(), optional = false) => ({
    ...value,
    optional: Boolean(optional)
});

const getKind = ({ kind = 'unknown' } = {}) => kind;

const isKnown = ({ kind = 'unknown' } = {}) => kind !== 'unknown';

const getContractShape = ({
    kind = 'unknown',
    optional = false,
    element = {},
    properties = {}
} = {}) => ({
    kind,
    optional,
    ...(['array', 'promise'].includes(kind) && { element: getContractShape(element) }),
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

const mergeArrayContracts = (knownValues = []) => contract({
    kind: 'array',
    element: mergeContracts(knownValues.map(({ element = {} } = {}) => element))
});

const mergePromiseContracts = (knownValues = []) => contract({
    kind: 'promise',
    element: mergeContracts(knownValues.map(({ element = {} } = {}) => element))
});

const mergeObjectContracts = (knownValues = []) => {
    const propertyNames = [...new Set(knownValues.flatMap(({ properties = {} } = {}) => Object.keys(properties)))];
    const properties = Object.fromEntries(propertyNames.map((name = '') => [
        name,
        mergeContracts(knownValues.map(({ properties: sourceProperties = {} } = {}) => (
            sourceProperties[name] || unknown()
        )))
    ]));

    return contract({ kind: 'object', properties });
};

const mergeSameKind = ({ kind = 'unknown', knownValues = [] } = {}) => {
    if (kind === 'array') return mergeArrayContracts(knownValues);
    if (kind === 'promise') return mergePromiseContracts(knownValues);
    if (kind === 'object') return mergeObjectContracts(knownValues);
    return contract({ kind });
};

mergeContracts = (values = []) => {
    const knownValues = values.filter(isKnown);
    if (!knownValues.length) return unknown();

    const kinds = [...new Set(knownValues.map(getKind))];
    if (kinds.length !== 1) return unknown();
    const [kind = 'unknown'] = kinds;
    return mergeSameKind({ kind, knownValues });
};

const isCompatible = ({ expected = unknown(), actual = unknown() } = {}) => {
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
    isKnown,
    mergeContracts,
    unknown,
    withOptional
};
