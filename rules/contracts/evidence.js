import { getFlowContext } from './flow.js';
import {
    getChildren,
    getEnclosingFunction,
    getFunctionName,
    getReturnNodes,
    inferExpression,
    isFunction,
    walk
} from './infer.js';
import {
    contract,
    getContractShape,
    isContradictory,
    isKnown,
    unknown
} from './model.js';
import { getObject, hasObjectValue } from '../support/object.js';

const EXPRESSION_OPERATIONS = new Set([
    'AwaitExpression',
    'CallExpression',
    'MemberExpression'
]);

const getRange = ({ range = [], ...source } = {}) => {
    if (Array.isArray(range) && range.length === 2) return range;

    const { start = -1, end = -1 } = source;

    return start >= 0 && end >= start ? [start, end] : [];
};

const getNodeKey = (node = {}) => {
    const source = getObject(node);
    const { type = '' } = source;
    const [start = -1, end = -1] = getRange(source);

    return `${type}:${start}-${end}`;
};

const getLocation = ({ fileName = '', node = {} } = {}) => {
    const { loc = {} } = getObject(node);
    const {
        start: locStart = {},
        end: locEnd = {}
    } = getObject(loc);
    const {
        line: startLine = -1,
        column: startColumn = -1
    } = getObject(locStart);
    const {
        line: endLine = -1,
        column: endColumn = -1
    } = getObject(locEnd);
    const range = getRange(node);

    return {
        fileName,
        range,
        ...(hasObjectValue(loc) && {
            loc: {
                ...(hasObjectValue(locStart) && {
                    start: {
                        line: startLine,
                        column: startColumn
                    }
                }),
                ...(hasObjectValue(locEnd) && {
                    end: {
                        line: endLine,
                        column: endColumn
                    }
                })
            }
        })
    };
};

const getSourceKey = ({ fileName = '', node = {} } = {}) => {
    const { type = '' } = getObject(node);
    const range = getRange(node);

    return `${fileName}:${type}:${range.join('-')}`;
};

const getSubject = ({ fileName = '', node = {}, name = '' } = {}) => {
    const { type = '' } = getObject(node);
    const range = getRange(node);
    const label = name || type || 'value';

    return `${label}@${fileName}:${range.join('-')}`;
};

const getScope = ({ fileName = '', node = {} } = {}) => {
    const functionNode = isFunction(node) ? node : getEnclosingFunction(node);
    const functionName = isFunction(functionNode) ? getFunctionName(functionNode) : '';

    return {
        fileName,
        functionName,
        path: 'normal'
    };
};

const getEvidenceKind = (node = {}) => {
    const { type = '' } = getObject(node);

    return EXPRESSION_OPERATIONS.has(type) ? 'propagation' : 'syntax';
};

const isContractEvidence = (value = unknown()) => (
    isKnown(value) || isContradictory(value)
);

const getNodeByRange = ({ entries = [], entryIndex = new Map(), node = {} } = {}) => {
    if (entryIndex.size) return entryIndex.get(getNodeKey(node)) || {};

    const source = getObject(node);
    const { type = '' } = source;
    const range = getRange(source);

    return entries.find(({ node: candidate = {} } = {}) => {
        const { type: candidateType = '' } = getObject(candidate);

        return candidateType === type &&
            JSON.stringify(getRange(candidate)) === JSON.stringify(range);
    }) || {};
};

const getGuard = ({ node = {} } = {}) => {
    const {
        type = '',
        callee = {},
        arguments: sourceArguments = []
    } = getObject(node);
    const args = Array.isArray(sourceArguments) ? sourceArguments : [];
    const {
        type: calleeType = '',
        object = {},
        property = {},
        computed = false
    } = getObject(callee);
    const {
        type: objectType = '',
        name: objectName = ''
    } = getObject(object);
    const {
        type: propertyType = '',
        name: propertyName = ''
    } = getObject(property);
    const [argument = {}] = args;
    const {
        type: argumentType = '',
        name: argumentName = ''
    } = getObject(argument);

    if (
        type !== 'CallExpression' ||
        calleeType !== 'MemberExpression' ||
        objectType !== 'Identifier' ||
        objectName !== 'Array' ||
        propertyType !== 'Identifier' ||
        propertyName !== 'isArray' ||
        computed ||
        argumentType !== 'Identifier'
    ) return {};

    return {
        subject: getSubject({ node: argument, name: argumentName }),
        contract: { kind: 'array', state: 'known' }
    };
};

const getDirectDependencyKeys = ({
    fileName = '',
    node = {},
    entries = [],
    entryIndex = new Map(),
    functionKeys = {},
    bindingDependencies = {}
} = {}) => {
    const dependencies = getChildren(node).flatMap((child) => {
        const entry = getNodeByRange({ entries, entryIndex, node: child });
        const { key = '' } = entry;

        return [
            ...(key ? [key] : []),
            ...getDirectDependencyKeys({
                fileName,
                node: child,
                entries,
                entryIndex,
                functionKeys,
                bindingDependencies
            })
        ];
    });
    const {
        type = '',
        name = '',
        callee = {},
        parent = {}
    } = getObject(node);
    const {
        type: calleeType = '',
        name: calleeName = ''
    } = getObject(callee);
    const { [calleeName]: functionKey = '' } = functionKeys;
    const scopeNode = isFunction(node) ? node : getEnclosingFunction(node);
    const scopeKey = getSourceKey({ fileName, node: scopeNode });
    const { [scopeKey]: scopedBindings = {} } = bindingDependencies;
    const { [name]: bindingKeys = [] } = scopedBindings;
    const { type: parentType = '' } = getObject(parent);
    const isBindingIdentifier = parentType === 'AssignmentPattern';

    return [...new Set([
        ...dependencies,
        ...(!isBindingIdentifier && Array.isArray(bindingKeys) ? bindingKeys : []),
        ...(type === 'CallExpression' && calleeType === 'Identifier' && functionKey
            ? [functionKey]
            : [])
    ])];
};

const getFunctionReturnDependencyKeys = ({
    node = {},
    entries = [],
    entryIndex = new Map()
} = {}) => getReturnNodes(node)
    .map(({ argument = {} } = {}) => getNodeByRange({ entries, entryIndex, node: argument }))
    .map(({ key = '' } = {}) => key)
    .filter(Boolean);

const getBindingDependencies = ({ fileName = '', program = {} } = {}) => {
    let dependencies = {};
    walk(program, (node = {}) => {
        const { type = '', left = {} } = getObject(node);
        const { type: leftType = '', name = '' } = getObject(left);

        if (type !== 'AssignmentPattern' || leftType !== 'Identifier' || !name) return;

        const scopeNode = getEnclosingFunction(node);
        const scopeKey = getSourceKey({ fileName, node: scopeNode });
        const { [scopeKey]: scopeBindings = {} } = dependencies;
        const { [name]: nameDependencies = [] } = scopeBindings;

        dependencies = {
            ...dependencies,
            [scopeKey]: {
                ...scopeBindings,
                [name]: [...new Set([
                    ...(Array.isArray(nameDependencies) ? nameDependencies : []),
                    getSourceKey({ fileName, node })
                ])]
            }
        };
    });

    return dependencies;
};

const getRecordKey = ({
    kind = '',
    origin = '',
    fact = {},
    source = {},
    scope = {},
    status = ''
} = {}) => JSON.stringify({ kind, origin, fact, source, scope, status });

const getPublicCandidate = (candidate = {}) => Object.fromEntries(Object.entries(candidate)
    .filter(([name = ''] = []) => name !== 'anchorKey'));

const getPublicRecord = ({
    fact = {},
    source = {},
    scope = {},
    derivesFrom = [],
    ...rest
} = {}) => ({
    ...rest,
    fact: { ...fact },
    source: { ...source },
    scope: { ...scope },
    derivesFrom: [...derivesFrom]
});

const getRecordRangeKey = ({ source = {} } = {}) => getRange(source).join('-');

const createEvidenceRegistry = ({
    fileName = '',
    program = {},
    expressions = [],
    functions = [],
    definitions = {},
    flows = new Map()
} = {}) => {
    const expressionEntries = expressions.map((node = {}) => {
        const context = getFlowContext({ node, definitions, flows });

        return {
            node,
            context,
            value: inferExpression(node, context),
            key: getSourceKey({ fileName, node })
        };
    });
    const expressionIndex = new Map(expressionEntries.map((entry = {}) => {
        const { node = {} } = entry;

        return [getNodeKey(node), entry];
    }));
    const functionKeys = Object.fromEntries(functions
        .map(node => [getFunctionName(node), getSourceKey({ fileName, node })])
        .filter(([name = ''] = []) => Boolean(name)));
    const bindingDependencies = getBindingDependencies({ fileName, program });
    let candidates = [];
    const addCandidate = ({
        kind = '',
        origin = '',
        subject = '',
        value = unknown(),
        node = {},
        derivesFrom = [],
        status = 'active',
        boundaryOwner = ''
    } = {}) => {
        const source = getLocation({ fileName, node });
        const scope = getScope({ fileName, node });
        const fact = {
            subject,
            contract: getContractShape(value)
        };
        const candidate = {
            kind,
            ...(origin && { origin }),
            fact,
            source,
            scope,
            derivesFrom,
            status,
            ...(boundaryOwner && { boundaryOwner })
        };
        const key = getRecordKey(candidate);

        if (!candidates.some(({ key: currentKey = '' } = {}) => currentKey === key)) {
            candidates = [...candidates, {
                ...candidate,
                key,
                anchorKey: getSourceKey({ fileName, node })
            }];
        }

        return key;
    };

    expressionEntries.forEach(({ node = {}, value = unknown(), key = '' } = {}) => {
        if (isContractEvidence(value)) addCandidate({
            kind: getEvidenceKind(node),
            subject: getSubject({ fileName, node }),
            value,
            node,
            derivesFrom: getDirectDependencyKeys({
                fileName,
                node,
                entries: expressionEntries,
                entryIndex: expressionIndex,
                functionKeys,
                bindingDependencies
            })
                .filter(dependency => dependency !== key)
        });

        const guard = getGuard({ node });

        const { subject: guardSubject = '', contract: guardContract = {} } = guard;

        if (hasObjectValue(guard)) addCandidate({
            kind: 'guard',
            subject: guardSubject,
            value: contract(guardContract),
            node,
            derivesFrom: getDirectDependencyKeys({
                fileName,
                node,
                entries: expressionEntries,
                entryIndex: expressionIndex,
                functionKeys,
                bindingDependencies
            })
        });

        const { type = '' } = getObject(node);

        if (type !== 'CallExpression' || isContractEvidence(value)) return;

        addCandidate({
            kind: 'boundary',
            origin: 'external-data',
            subject: getSubject({ fileName, node }),
            value,
            node,
            status: 'unknown',
            boundaryOwner: 'external-data'
        });
    });

    walk(program, (node = {}) => {
        const { type = '', id = {}, init = {} } = getObject(node);

        if (type !== 'VariableDeclarator') return;

        const { type: idType = '', name = '' } = getObject(id);
        const entry = getNodeByRange({
            entries: expressionEntries,
            entryIndex: expressionIndex,
            node: init
        });
        const { value = unknown(), key = '' } = entry;

        if (!name || !isContractEvidence(value)) return;

        addCandidate({
            kind: 'syntax',
            subject: getSubject({ fileName, node: id, name: `binding:${name}` }),
            value,
            node: idType === 'Identifier' ? id : node,
            derivesFrom: key ? [key] : []
        });
    });

    functions.forEach((node = {}) => {
        const name = getFunctionName(node);
        const { [name]: definition = {} } = getObject(definitions);
        const { returnContract = unknown() } = getObject(definition);

        if (!name || !isContractEvidence(returnContract)) return;

        addCandidate({
            kind: 'propagation',
            subject: getSubject({ fileName, node, name: `return:${name}` }),
            value: returnContract,
            node,
            derivesFrom: getFunctionReturnDependencyKeys({
                node,
                entries: expressionEntries,
                entryIndex: expressionIndex
            })
        });
    });

    const candidateKeys = (dependencies = []) => dependencies.map((dependency) => {
        const candidate = candidates.find(({ anchorKey = '', kind = '' } = {}) => (
            anchorKey === dependency && kind !== 'boundary'
        ));
        const { key = '' } = getObject(candidate);

        return key;
    }).filter(Boolean);
    const sorted = [...candidates].sort(({ key: left = '' } = {}, { key: right = '' } = {}) => (
        left.localeCompare(right)
    ));
    const ids = new Map(sorted.map(({ key = '' } = {}, index = 0) => [key, `evidence-${index + 1}`]));
    const records = sorted.map(({
        key = '',
        derivesFrom = [],
        ...candidate
    } = {}) => ({
        id: ids.get(key),
        ...getPublicCandidate(candidate),
        derivesFrom: candidateKeys(derivesFrom).map(dependency => ids.get(dependency)).filter(Boolean)
    }));
    const recordsByRange = new Map();
    records.forEach((record = {}) => {
        const rangeKey = getRecordRangeKey(record);
        const existing = recordsByRange.get(rangeKey) || [];

        // eslint-disable-next-line resilient/prefer-safe-transformations -- This index is private construction state and never mutates a record.
        recordsByRange.set(rangeKey, [...existing, record]);
    });
    const getEvidence = () => records.map(getPublicRecord);
    const getEvidenceAtOffset = (offset = -1) => records.filter(({ source = {} } = {}) => {
        const [start = -1, end = -1] = getRange(source);

        return start >= 0 && end >= start && offset >= start && offset <= end;
    }).map(getPublicRecord);
    const getEvidenceIdsForNode = (node = {}) => {
        const range = getRange(node);

        if (range.length !== 2) return [];

        const matchingRecords = recordsByRange.get(range.join('-')) || [];

        return matchingRecords.map(({ id = '' } = {}) => id);
    };
    const getEvidenceForContract = (value = unknown()) => {
        const shape = getContractShape(value);
        const { sourceNode = {} } = getObject(value);
        const sourceRange = getRange(sourceNode);
        const matching = records.filter(({ fact = {} } = {}) => {
            const { contract: factContract = {} } = fact;

            return JSON.stringify(factContract) === JSON.stringify(shape);
        });

        if (!sourceRange.length) return matching.map(getPublicRecord);

        return matching.filter(({ source = {} } = {}) => (
            JSON.stringify(getRange(source)) === JSON.stringify(sourceRange)
        )).map(getPublicRecord);
    };

    return {
        getEvidence,
        getEvidenceAtOffset,
        getEvidenceForContract,
        getEvidenceIdsForNode
    };
};

export {
    createEvidenceRegistry
};
