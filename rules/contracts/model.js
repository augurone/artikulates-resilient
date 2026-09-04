import {
    getObject,
    hasObjectValue
} from '../support/object.js';

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

const contradictory = ({ conflicts: sourceConflicts = [], sourceNode = {} } = {}) => {
    const conflicts = Array.isArray(sourceConflicts) ? sourceConflicts : [];

    return {
        kind: 'unknown',
        state: 'contradictory',
        conflicts: [...new Set(conflicts)],
        sourceNode
    };
};

const contract = ({
    kind = 'unknown',
    sourceNode = {},
    optional = false,
    element = unknown(),
    signature = {},
    properties = {},
    branches = [],
    state = '',
    conflicts = [],
    elements = [],
    residual = {}
} = {}) => ({
    kind: KINDS.includes(kind) ? kind : 'unknown',
    state: state || (KINDS.includes(kind) && kind !== 'unknown' ? 'known' : 'unknown'),
    sourceNode,
    optional,
    ...(state === 'contradictory' && { conflicts: [...new Set(conflicts)] }),
    ...(kind === 'array' && { element, ...(elements.length && { elements }) }),
    ...(kind === 'promise' && { element }),
    ...(kind === 'function' && hasObjectValue(signature) && { signature }),
    ...(kind === 'object' && {
        properties,
        branches,
        ...(hasObjectValue(residual) && { residual })
    })
});

const withOptional = (value = unknown(), optional = false) => ({
    ...getObject(value),
    optional: optional === true
});

const getKind = (value = {}) => {
    const { kind = 'unknown' } = getObject(value);

    return kind;
};

const isKnown = (value = {}) => getKind(value) !== 'unknown';

const isContradictory = (value = {}) => {
    const { state = '' } = getObject(value);

    return state === 'contradictory';
};

const getContractVariants = (value = unknown()) => {
    const {
        state = '',
        conflicts: sourceConflicts = [],
        sourceNode = {}
    } = getObject(value);
    const conflicts = Array.isArray(sourceConflicts) ? sourceConflicts : [];

    if (state !== 'contradictory') return isKnown(value) ? [value] : [];

    return conflicts.map(kind => contract({
        kind,
        sourceNode
    }));
};

const getContractShape = function getContractShape(source = {}) {
    const {
        kind = 'unknown',
        state = 'unknown',
        conflicts: sourceConflicts = [],
        optional = false,
        element = {},
        elements: sourceElements = [],
        signature = {},
        properties = {},
        residual = {}
    } = getObject(source);
    const conflicts = Array.isArray(sourceConflicts) ? sourceConflicts : [];
    const elements = Array.isArray(sourceElements) ? sourceElements : [];
    const safeConflicts = Array.isArray(conflicts) ? conflicts : [];
    const getPropertyShapes = (sourceProperties = {}) => Object.fromEntries(
        Object.entries(getObject(sourceProperties))
            .sort(([left = ''], [right = '']) => left.localeCompare(right))
            .map(([name = '', property = {}] = []) => [
                name,
                getContractShape(getObject(property))
            ])
    );
    const getArrayShape = ({ element = {}, elements = [] } = {}) => {
        const safeElements = Array.isArray(elements) ? elements : [];
        const hasElements = safeElements.some(() => true);

        return {
            element: getContractShape(getObject(element)),
            ...(hasElements && {
                elements: safeElements.map(value => getContractShape(getObject(value)))
            })
        };
    };
    const getFunctionShape = (signature = {}) => {
        const safeSignature = getObject(signature);
        const {
            parameters: sourceParameters = [],
            restIndex = -1,
            returnContract = {}
        } = safeSignature;
        const parameters = Array.isArray(sourceParameters) ? sourceParameters : [];
        const safeParameters = Array.isArray(parameters) ? parameters : [];

        return {
            parameters: safeParameters.map(value => getContractShape(getObject(value))),
            restIndex,
            returnContract: getContractShape(getObject(returnContract))
        };
    };
    const getResidualShape = (residual = {}) => {
        const safeResidual = getObject(residual);
        const {
            kind: residualKind = 'object',
            state: residualState = 'unknown',
            open = false,
            excluded = [],
            properties: residualProperties = {}
        } = safeResidual;
        const safeExcluded = Array.isArray(excluded) ? excluded : [];

        return {
            kind: residualKind,
            state: residualState,
            open: open === true,
            excluded: [...new Set(safeExcluded)].sort(),
            properties: getPropertyShapes(residualProperties)
        };
    };
    const getObjectShape = ({
        properties: objectProperties = {},
        residual: objectResidual = {}
    } = {}) => ({
        properties: getPropertyShapes(objectProperties),
        ...(hasObjectValue(objectResidual) && {
            residual: getResidualShape(objectResidual)
        })
    });

    return {
        kind,
        state,
        ...(state === 'contradictory' && { conflicts: [...new Set(safeConflicts)] }),
        optional,
        ...(kind === 'array' && getArrayShape({ element, elements })),
        ...(kind === 'promise' && { element: getContractShape(getObject(element)) }),
        ...(kind === 'function' && hasObjectValue(signature) && {
            signature: getFunctionShape(signature)
        }),
        ...(kind === 'object' && getObjectShape({ properties, residual }))
    };
};

const isEqual = (left = unknown(), right = unknown()) => (
    JSON.stringify(getContractShape(left)) === JSON.stringify(getContractShape(right))
);

let mergeContracts = (...values) => {
    const [firstValue = unknown()] = values;

    return unknown(firstValue);
};

const mergeArrayContracts = (knownValues = [], options = {}) => contract({
    kind: 'array',
    element: mergeContracts(knownValues.map((value) => {
        const { element = {} } = getObject(value);

        return element;
    }), options)
});

const mergePromiseContracts = (knownValues = [], options = {}) => contract({
    kind: 'promise',
    element: mergeContracts(knownValues.map((value) => {
        const { element = {} } = getObject(value);

        return element;
    }), options)
});

const mergeFunctionContracts = (knownValues = []) => {
    const [first = {}] = knownValues;
    const { signature: firstSignature = {}, sourceNode = {} } = getObject(first);
    const { signature: firstShape = {} } = getContractShape(first);
    const sameSignature = knownValues.every((value) => {
        const { signature = {} } = getContractShape(value);

        return JSON.stringify(signature) === JSON.stringify(firstShape);
    });

    return contract({
        kind: 'function',
        signature: sameSignature ? firstSignature : {},
        sourceNode
    });
};

const mergeObjectContracts = (knownValues = [], options = {}) => {
    const propertyNames = [...new Set(knownValues.flatMap((value) => {
        const { properties = {} } = getObject(value);

        return Object.keys(getObject(properties));
    }))];
    const properties = Object.fromEntries(propertyNames.map((name = '') => [
        name,
        mergeContracts(knownValues.map((value) => {
            const { properties: sourceProperties = {} } = getObject(value);
            const { [name]: property = unknown() } = getObject(sourceProperties);

            return property;
        }), options)
    ]));

    const residualValues = knownValues
        .map((value) => {
            const { residual = {} } = getObject(value);

            return residual;
        })
        .filter(hasObjectValue);
    const residualNames = [...new Set(residualValues
        .flatMap((value) => {
            const { properties = {} } = getObject(value);

            return Object.keys(getObject(properties));
        }))];
    const residualProperties = Object.fromEntries(residualNames.map((name = '') => [
        name,
        mergeContracts(residualValues.map((value) => {
            const { properties: sourceProperties = {} } = getObject(value);
            const { [name]: property = unknown() } = getObject(sourceProperties);

            return property;
        }), options)
    ]));
    const residual = residualValues.length
        ? {
            kind: 'object',
            state: 'unknown',
            open: residualValues.some((value) => {
                const { open = false } = getObject(value);

                return open;
            }),
            excluded: [...new Set(residualValues.flatMap((value) => {
                const { excluded = [] } = getObject(value);

                return Array.isArray(excluded) ? excluded : [];
            }))],
            properties: residualProperties
        }
        : {};

    return contract({ kind: 'object', properties, residual });
};

const mergeSameKind = ({ kind = 'unknown', knownValues = [], options = {} } = {}) => {
    if (kind === 'array') return mergeArrayContracts(knownValues, options);

    if (kind === 'promise') return mergePromiseContracts(knownValues, options);

    if (kind === 'function') return mergeFunctionContracts(knownValues);

    if (kind === 'object') return mergeObjectContracts(knownValues, options);

    return contract({ kind });
};

mergeContracts = (values = [], { preserveContradictions = true } = {}) => {
    const sourceValues = Array.isArray(values) ? values : [];
    const options = { preserveContradictions };
    const contradictoryValues = sourceValues.filter(isContradictory);
    const knownValues = sourceValues.filter(isKnown);
    const [firstContradictory = {}] = contradictoryValues;
    const [firstKnown = {}] = knownValues;
    const { sourceNode: contradictorySourceNode = {} } = getObject(firstContradictory);
    const { sourceNode: knownSourceNode = {} } = getObject(firstKnown);

    if (preserveContradictions && contradictoryValues.length) return contradictory({
        conflicts: [
            ...contradictoryValues.flatMap((value) => {
                const { conflicts: sourceConflicts = [] } = getObject(value);

                return Array.isArray(sourceConflicts) ? sourceConflicts : [];
            }),
            ...knownValues.map(getKind)
        ],
        sourceNode: contradictorySourceNode
    });

    if (!knownValues.length) return unknown();

    const kinds = [...new Set(knownValues.map(getKind))];

    if (kinds.length !== 1 && preserveContradictions) return contradictory({
        conflicts: kinds,
        sourceNode: knownSourceNode
    });

    if (kinds.length !== 1) return unknown();

    const [kind = 'unknown'] = kinds;

    return mergeSameKind({ kind, knownValues, options });
};

const isCompatible = ({ expected = unknown(), actual = unknown() } = {}) => {
    if (isContradictory(expected) || isContradictory(actual)) return false;

    if (!isKnown(expected) || !isKnown(actual)) return true;

    const { kind: expectedKind = 'unknown' } = getObject(expected);
    const { kind: actualKind = 'unknown' } = getObject(actual);

    if (expectedKind !== actualKind) return false;

    if (['array', 'promise'].includes(expectedKind)) {
        const { element: expectedElement = unknown() } = getObject(expected);
        const { element: actualElement = unknown() } = getObject(actual);

        return isCompatible({ expected: expectedElement, actual: actualElement });
    }

    if (expectedKind === 'function') return true;

    if (expectedKind !== 'object') return true;

    const getActualProperty = (name = '') => {
        const { properties: actualProperties = {}, residual = {} } = getObject(actual);
        const { [name]: actualProperty = false } = getObject(actualProperties);

        if (actualProperty) return actualProperty;

        const { properties: residualProperties = {} } = getObject(residual);
        const { [name]: residualProperty = false } = getObject(residualProperties);

        if (residualProperty) {
            return residualProperty;
        }

        return unknown();
    };
    const { properties: expectedProperties = {} } = getObject(expected);

    return Object.entries(getObject(expectedProperties)).every(([name = '', property = {}] = []) => {
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
