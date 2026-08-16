const KINDS = Object.freeze([
    'unknown',
    'undefined',
    'null',
    'string',
    'number',
    'boolean',
    'array',
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
    ...(kind === 'array' && { element }),
    ...(kind === 'object' && { properties, branches })
});

const withOptional = (value = unknown(), optional = false) => ({
    ...value,
    optional: Boolean(optional)
});

const getKind = ({ kind = 'unknown' } = {}) => kind;

const isKnown = ({ kind = 'unknown' } = {}) => kind !== 'unknown';
const mergeState = { mergeContracts: () => unknown() };

const mergeArrayContracts = (knownValues = []) => contract({
    kind: 'array',
    element: mergeState.mergeContracts(knownValues.map(({ element = {} } = {}) => element))
});

const mergeObjectContracts = (knownValues = []) => {
    const propertyNames = [...new Set(knownValues.flatMap(({ properties = {} } = {}) => Object.keys(properties)))];
    const properties = Object.fromEntries(propertyNames.map((name = '') => [
        name,
        mergeState.mergeContracts(knownValues.map(({ properties: sourceProperties = {} } = {}) => (
            sourceProperties[name] || unknown()
        )))
    ]));

    return contract({ kind: 'object', properties });
};

const mergeSameKind = ({ kind = 'unknown', knownValues = [] } = {}) => {
    if (kind === 'array') return mergeArrayContracts(knownValues);
    if (kind === 'object') return mergeObjectContracts(knownValues);
    return contract({ kind });
};

const mergeContracts = (values = []) => {
    const knownValues = values.filter(isKnown);
    if (!knownValues.length) return unknown();

    const kinds = [...new Set(knownValues.map(getKind))];
    if (kinds.length !== 1) return unknown();
    const [kind = 'unknown'] = kinds;
    return mergeSameKind({ kind, knownValues });
};

mergeState.mergeContracts = mergeContracts;

const isCompatible = ({ expected = unknown(), actual = unknown() } = {}) => {
    if (!isKnown(expected) || !isKnown(actual)) return true;
    if (expected.kind !== actual.kind) return false;

    if (expected.kind === 'array') {
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
    object: 'object-like'
}[kind] || 'unknown');

export {
    contract,
    describe,
    getKind,
    isCompatible,
    isKnown,
    mergeContracts,
    unknown,
    withOptional
};
