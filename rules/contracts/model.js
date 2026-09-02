const KINDS = Object.freeze([
    'unknown',
    'undefined',
    'null',
    'string',
    'number',
    'boolean',
    'regexp',
    'array',
    'promise',
    'object',
    'function'
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
    signature = null,
    properties = {},
    branches = [],
    state = '',
    conflicts = [],
    elements = [],
    residual = null
} = {}) => ({
    kind: KINDS.includes(kind) ? kind : 'unknown',
    state: state || (KINDS.includes(kind) && kind !== 'unknown' ? 'known' : 'unknown'),
    sourceNode,
    optional,
    ...(state === 'contradictory' && { conflicts: [...new Set(conflicts)] }),
    ...(kind === 'array' && { element, ...(elements.length && { elements }) }),
    ...(kind === 'promise' && { element }),
    ...(kind === 'function' && signature && { signature }),
    ...(kind === 'object' && {
        properties,
        branches,
        ...(residual && { residual })
    })
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
    signature = null,
    properties = {},
    residual = null
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
    ...(kind === 'function' && signature && {
        signature: {
            parameters: (signature.parameters || []).map(getContractShape),
            restIndex: signature.restIndex ?? -1,
            returnContract: getContractShape(signature.returnContract || unknown())
        }
    }),
    ...(kind === 'object' && {
        properties: Object.fromEntries(Object.entries(properties)
            .sort(([left = ''], [right = '']) => left.localeCompare(right))
            .map(([name = '', property = {}] = []) => [name, getContractShape(property)])),
        ...(residual && {
            residual: {
                kind: residual.kind || 'object',
                state: residual.state || 'unknown',
                open: Boolean(residual.open),
                excluded: [...new Set(residual.excluded || [])].sort(),
                properties: Object.fromEntries(Object.entries(residual.properties || {})
                    .sort(([left = ''], [right = '']) => left.localeCompare(right))
                    .map(([name = '', property = {}] = []) => [name, getContractShape(property)]))
            }
        })
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

const mergeFunctionContracts = (knownValues = []) => {
    const [first = {}] = knownValues;
    const { signature: firstShape = null } = getContractShape(first);
    const sameSignature = knownValues.every(value => (
        JSON.stringify(getContractShape(value).signature) === JSON.stringify(firstShape)
    ));
    return contract({
        kind: 'function',
        signature: sameSignature ? first.signature : null,
        sourceNode: first.sourceNode
    });
};

const mergeObjectContracts = (knownValues = [], options = {}) => {
    const propertyNames = [...new Set(knownValues.flatMap(({ properties = {} } = {}) => Object.keys(properties)))];
    const properties = Object.fromEntries(propertyNames.map((name = '') => [
        name,
        mergeContracts(knownValues.map(({ properties: sourceProperties = {} } = {}) => (
            sourceProperties[name] || unknown()
        )), options)
    ]));

    const residualValues = knownValues
        .map(({ residual: value = null } = {}) => value)
        .filter(Boolean);
    const residualNames = [...new Set(residualValues
        .flatMap(({ properties: sourceProperties = {} } = {}) => Object.keys(sourceProperties)))];
    const residualProperties = Object.fromEntries(residualNames.map((name = '') => [
        name,
        mergeContracts(residualValues.map(({ properties: sourceProperties = {} } = {}) => (
            sourceProperties[name] || unknown()
        )), options)
    ]));
    const residual = residualValues.length
        ? {
            kind: 'object',
            state: 'unknown',
            open: residualValues.some(({ open = false } = {}) => open),
            excluded: [...new Set(residualValues.flatMap(({ excluded = [] } = {}) => excluded))],
            properties: residualProperties
        }
        : null;
    return contract({ kind: 'object', properties, ...(residual && { residual }) });
};

const mergeSameKind = ({ kind = 'unknown', knownValues = [], options = {} } = {}) => {
    if (kind === 'array') return mergeArrayContracts(knownValues, options);
    if (kind === 'promise') return mergePromiseContracts(knownValues, options);
    if (kind === 'function') return mergeFunctionContracts(knownValues, options);
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

    if (expected.kind === 'function') return true;

    if (expected.kind !== 'object') return true;

    const getActualProperty = (name = '') => {
        const { properties: actualProperties = {}, residual = null } = actual;
        if (Object.hasOwn(actualProperties, name)) return actualProperties[name];
        if (residual && Object.hasOwn(residual.properties || {}, name)) {
            return residual.properties[name];
        }
        return unknown();
    };
    return Object.entries(expected.properties || {}).every(([name = '', property = {}] = []) => {
        const actualProperty = getActualProperty(name);
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
    regexp: 'regexp-like',
    array: 'array-like',
    promise: 'promise-like',
    object: 'object-like',
    function: 'function-like'
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
