import { createBindingIndex } from './binding-evidence.js';
import { getCallableEvidence } from './member-evidence.js';
import {
    contract,
    getKind,
    isEqual,
    mergeContracts,
    unknown,
    withOptional
} from './model.js';
import { isFunctionType } from '../support/ast-function.js';
import { isTraversalMetadataKey } from '../support/ast-traversal.js';
import {
    getObject,
    hasObjectValue,
    isObject
} from '../support/object.js';

let expressionHandlers = {};
const definitionMetadata = new WeakMap();
const definitionOwnerMetadata = new WeakMap();

const getDefinitionMetadata = (definitions = {}) => {
    if (!isObject(definitions)) return {};

    return definitionMetadata.get(definitions) || {};
};
const setDefinitionMetadata = (definitions = {}, metadata = {}) => {
    if (!isObject(definitions)) return definitions;

    // eslint-disable-next-line resilient/prefer-safe-transformations -- Session-private metadata follows its definitions owner without retaining or mutating the public object.
    definitionMetadata.set(definitions, metadata);

    return definitions;
};
const copyDefinitionMetadata = ({ source = {}, target = {} } = {}) => {
    const metadata = getDefinitionMetadata(source);

    return hasObjectValue(metadata) ? setDefinitionMetadata(target, metadata) : target;
};
const getDefinitionOwnerMetadata = (definition = {}) => (
    isObject(definition) ? definitionOwnerMetadata.get(definition) || {} : {}
);
const setDefinitionOwnerMetadata = (definition = {}, metadata = {}) => {
    if (!isObject(definition)) return definition;

    // eslint-disable-next-line resilient/prefer-safe-transformations -- Private owner evidence follows a published definition without exposing analyzer identity through its public shape.
    definitionOwnerMetadata.set(definition, metadata);

    return definition;
};

const getLexicalBinding = ({ node = {}, context = {} } = {}) => {
    const { bindingIndex = {} } = getObject(context);
    const { getBinding = false } = getObject(bindingIndex);

    return typeof getBinding === 'function'
        ? getBinding(node)
        : {};
};

const getBoundValue = ({ node = {}, context = {} } = {}) => {
    const { name = '' } = getObject(node);
    const { bindings = {}, bindingValues = new Map() } = getObject(context);
    const binding = getLexicalBinding({ node, context });

    if (hasObjectValue(binding)) return bindingValues.get(binding) || false;

    const { [name]: value = false } = getObject(bindings);

    return value;
};

const getBoundFunction = ({ node = {}, context = {} } = {}) => {
    const { name = '' } = getObject(node);
    const { functions = {}, functionBindings = new Map() } = getObject(context);
    const binding = getLexicalBinding({ node, context });

    if (!hasObjectValue(binding)) {
        const { [name]: definition = {} } = getObject(functions);

        return definition;
    }

    const definition = functionBindings.get(binding);

    if (definition) return definition;

    const { kind = '' } = binding;
    const { [name]: importedDefinition = {} } = getObject(functions);

    return ['import', 'import-namespace'].includes(kind) ? importedDefinition : {};
};

const isFunction = (node = {}) => {
    const { type = '' } = getObject(node);

    return isFunctionType(type);
};

const isEmptyObjectExpression = (node = {}) => {
    const { type = '', properties = [] } = getObject(node);

    return type === 'ObjectExpression' && Array.isArray(properties) && !properties.length;
};

const getOpenObjectContract = (sourceNode = {}) => contract({
    kind: 'object',
    sourceNode,
    residual: {
        kind: 'object',
        state: 'unknown',
        open: true,
        excluded: [],
        properties: {}
    }
});

const isAstNode = ({ value = {} } = {}) => {
    if (!isObject(value)) return false;

    const { type = '' } = value;

    return type !== '';
};

const getChildren = (node = {}) => {
    const source = getObject(node);
    const children = [];
    const addChild = (value = {}) => {
        if (!isAstNode({ value })) return;

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private traversal accumulator avoids repeated AST-array allocations.
        children.push(value);
    };
    Object.keys(source).forEach((key = '') => {
        if (isTraversalMetadataKey(key)) return;

        const { [key]: value = {} } = source;

        if (Array.isArray(value)) {
            value.forEach(addChild);

            return;
        }

        addChild(value);
    });

    return children;
};

const walk = (
    node = {},
    visitor,
    { skipFunctions = false, visited = new Set() } = {}
) => {
    if (!isAstNode({ value: node })) return;

    if (typeof visitor !== 'function') return;

    if (visited.has(node)) return;

    const nextVisited = new Set(visited);

    // eslint-disable-next-line resilient/prefer-safe-transformations -- Private traversal state avoids an intermediate array copy.
    nextVisited.add(node);

    visitor(node);

    const stopAtFunction = skipFunctions && isFunction(node);

    if (stopAtFunction) return;

    getChildren(node).forEach(child => walk(child, visitor, {
        skipFunctions,
        visited: nextVisited
    }));
};

const getStaticName = (node = {}) => {
    const { type = '', name = '' } = getObject(node);

    return type === 'Identifier' ? name : '';
};

const getPropertyName = ({ key = {}, computed = false } = {}) => {
    if (computed) return '';

    const { type = '', name = '', value = '' } = getObject(key);

    if (type === 'Identifier') return name;

    if (type === 'Literal') return String(value);

    return '';
};

const isStaticPropertyValue = value => (
    value === null ||
    ['string', 'number', 'boolean', 'bigint'].includes(typeof value)
);

const getExpressionPropertyName = ({ key = {}, computed = false, context = {} } = {}) => {
    const directName = getPropertyName({ key, computed });

    if (directName) return directName;

    if (!computed) return '';

    const { type = '', name = '', value = '' } = getObject(key);

    if (type === 'Literal' && isStaticPropertyValue(value)) return String(value);

    const { bindings = {} } = getObject(context);
    const { [name]: binding = {} } = getObject(bindings);
    const { sourceNode = {} } = getObject(binding);
    const { value: bindingValue = {} } = getObject(sourceNode);

    return type === 'Identifier' && isStaticPropertyValue(bindingValue)
        ? String(bindingValue)
        : '';
};

const getCallableContract = ({ definition = {}, sourceNode = {} } = {}) => {
    const safeDefinition = getObject(definition);
    const { kind = 'unknown', signature = {}, node = sourceNode, returnContract = unknown(sourceNode) } = safeDefinition;

    if (['function', 'object'].includes(kind)) return safeDefinition;

    if (!hasObjectValue(signature)) return unknown(sourceNode);

    const { parameters: sourceParameters = [], restIndex = -1 } = getObject(signature);

    return contract({
        kind: 'function',
        sourceNode: node || sourceNode,
        signature: {
            parameters: Array.isArray(sourceParameters) ? sourceParameters : [],
            restIndex,
            returnContract
        }
    });
};

const inferExpression = (node = {}, context = {}) => {
    const source = getObject(node);
    const { type = '', name = '', right = {}, ...rest } = source;
    const boundValue = getBoundValue({ node: source, context });
    const { kind: boundKind = '' } = getObject(boundValue);
    const sourceNode = { type, name, right, ...rest };

    if (type === 'Identifier') {
        const functionValue = getBoundFunction({ node: source, context });

        return boundKind ? boundValue : getCallableContract({
            definition: functionValue,
            sourceNode
        });
    }

    if (type === 'AssignmentPattern') return inferExpression(right, context);

    if (type === 'Literal') return expressionHandlers.Literal(sourceNode, context);

    if (type === 'TemplateLiteral') return contract({ kind: 'string', sourceNode });

    const { [type]: handler = {} } = expressionHandlers;

    if (typeof handler === 'function') return handler(sourceNode, context);

    return unknown(sourceNode);
};

const inferLiteral = ({ value = '', regex = null, ...node } = {}) => {
    const sourceNode = { value, regex, ...node };

    if (regex) return contract({ kind: 'regexp', sourceNode });

    if (value === null) return contract({ kind: 'null', sourceNode });

    return contract({ kind: typeof value, sourceNode });
};

const inferArrayExpression = ({ elements = [], ...node } = {}, context = {}) => {
    const sourceNode = { elements, ...node };
    const safeElements = Array.isArray(elements) ? elements : [];
    const elementContracts = safeElements.map((element = {}) => inferExpression(element, context));

    return contract({
        kind: 'array',
        sourceNode,
        element: mergeContracts(elementContracts),
        elements: elementContracts
    });
};

const addObjectProperty = ({ property = {}, context = {}, properties = {} } = {}) => {
    const { key = {}, value = {}, computed = false } = getObject(property);
    const name = getExpressionPropertyName({ key, computed, context });

    if (!name) return properties;

    return { ...properties, [name]: inferExpression(value, context) };
};

const mergeResidualContracts = ({ left = {}, right = {} } = {}) => {
    const leftValue = getObject(left);
    const rightValue = getObject(right);
    const { open: leftOpen = false, excluded: leftExcluded = [], properties: leftProperties = {} } = leftValue;
    const { open: rightOpen = false, excluded: rightExcluded = [], properties: rightProperties = {} } = rightValue;

    return {
        kind: 'object',
        state: 'unknown',
        open: leftOpen === true || rightOpen === true,
        excluded: [...new Set([
            ...(Array.isArray(leftExcluded) ? leftExcluded : []),
            ...(Array.isArray(rightExcluded) ? rightExcluded : [])
        ])],
        properties: {
            ...getObject(leftProperties),
            ...getObject(rightProperties)
        }
    };
};

const addObjectSpread = ({ property = {}, context = {}, properties = {}, branches = [], residual = {} } = {}) => {
    const { argument = {} } = getObject(property);
    const { type = '', operator = '', left = {}, right = {} } = getObject(argument);

    if (type === 'LogicalExpression' && operator === '&&') {
        return {
            properties,
            branches: [...branches, {
                condition: left,
                shape: inferExpression(right, context)
            }],
            residual
        };
    }

    const spread = inferExpression(argument, context);
    const { properties: spreadProperties = {}, residual: spreadResidual = {} } = getObject(spread);
    const nextResidual = mergeResidualContracts({ left: residual, right: spreadResidual });
    const hasResidual = hasObjectValue(residual) || hasObjectValue(spreadResidual);

    return {
        properties: { ...properties, ...getObject(spreadProperties) },
        branches,
        ...(hasResidual && { residual: nextResidual })
    };
};

const inferObjectExpression = ({ properties: sourceProperties = [], ...node } = {}, context = {}) => {
    const sourceNode = { properties: sourceProperties, ...node };
    const safeProperties = Array.isArray(sourceProperties) ? sourceProperties : [];
    const { properties = {}, branches = [], residual = {} } = safeProperties.reduce((state, property = {}) => {
        const { type = '' } = getObject(property);
        const {
            properties: stateProperties = {},
            branches: stateBranches = [],
            residual: stateResidual = {}
        } = getObject(state);

        if (type === 'Property') {
            return {
                ...state,
                properties: addObjectProperty({
                    property,
                    context,
                    properties: stateProperties
                })
            };
        }

        if (type === 'SpreadElement') return addObjectSpread({
            property,
            context,
            properties: stateProperties,
            branches: stateBranches,
            residual: stateResidual
        });

        return state;
    }, { properties: {}, branches: [], residual: {} });

    return contract({
        kind: 'object',
        sourceNode,
        properties,
        branches,
        ...(hasObjectValue(residual) && { residual })
    });
};

const mergeArgumentDefaults = ({ expected = unknown(), actual = unknown() } = {}) => {
    const {
        kind: expectedKind = '',
        residual: expectedResidual = {},
        properties: expectedProperties = {}
    } = getObject(expected);
    const {
        kind: actualKind = '',
        residual: actualResidual = {},
        properties: actualProperties = {},
        sourceNode = {}
    } = getObject(actual);
    const safeExpectedProperties = getObject(expectedProperties);
    const safeActualProperties = getObject(actualProperties);

    if (expectedKind !== 'object' || actualKind !== 'object') return actual;

    const properties = Object.fromEntries(Object.entries(safeExpectedProperties).map(([
        name = '',
        expectedProperty = unknown()
    ] = []) => {
        const { [name]: actualProperty = false } = safeActualProperties;

        return [
            name,
            actualProperty
                ? mergeArgumentDefaults({ expected: expectedProperty, actual: actualProperty })
                : expectedProperty
        ];
    }));
    const getResidual = () => {
        if (hasObjectValue(actualResidual)) return actualResidual;

        if (hasObjectValue(expectedResidual)) return expectedResidual;

        return {};
    };

    return contract({
        kind: 'object',
        properties: {
            ...properties,
            ...safeActualProperties
        },
        sourceNode,
        residual: getResidual()
    });
};

const getFunctionAlias = ({ init = {}, functions = {}, context = {} } = {}) => {
    const safeInit = getObject(init);
    const { type = '', name = '' } = safeInit;

    if (type !== 'Identifier') return {};

    const functionDefinition = hasObjectValue(context)
        ? getBoundFunction({ node: safeInit, context })
        : getObject(functions)[name] || {};
    const { signature = {} } = getObject(functionDefinition);

    return hasObjectValue(signature) ? functionDefinition : {};
};

const getResolvedContract = (value = unknown()) => {
    const { kind = '', element = unknown() } = getObject(value);

    return kind === 'promise' ? getResolvedContract(element) : value;
};

const inferAwaitExpression = ({ argument = {}, ...node } = {}, context = {}) => {
    const sourceNode = { argument, ...node };
    const awaited = inferExpression(argument, context);
    const safeAwaited = getObject(awaited);
    const { kind: awaitedKind = '' } = safeAwaited;

    return awaitedKind === 'promise'
        ? { ...getResolvedContract(safeAwaited), sourceNode }
        : safeAwaited;
};

const getAsyncReturnContract = ({ value = unknown(), sourceNode = {} } = {}) => contract({
    kind: 'promise',
    element: getResolvedContract(value),
    sourceNode
});

const getReturnNodes = ({ body = {} } = {}) => {
    const { type = '' } = getObject(body);

    if (type !== 'BlockStatement') return [{ argument: body }];

    let returns = [];
    walk(body, ({ type = '', ...current } = {}) => {
        if (type === 'ReturnStatement') returns = [...returns, { type, ...current }];
    }, { skipFunctions: true });

    return returns;
};

const getSurvivingReturnRecords = ({ node = {}, flows = new Map() } = {}) => {
    if (!flows.has(node)) return false;

    const { returns = [] } = getObject(flows.get(node));
    const structuralArguments = getReturnNodes(node)
        .map(({ argument = {} } = {}) => argument);
    const survivingArguments = returns
        .map(({ argument = {} } = {}) => argument);
    const unchanged = structuralArguments.length === survivingArguments.length &&
        structuralArguments.every(argument => survivingArguments.includes(argument));

    return unchanged ? false : returns;
};

const getReturnPathExpressions = (node = {}) => {
    const source = getObject(node);
    const {
        type = '',
        consequent = {},
        alternate = {},
        left = {},
        right = {}
    } = source;

    if (type === 'ConditionalExpression') return [
        ...getReturnPathExpressions(consequent),
        ...getReturnPathExpressions(alternate)
    ];

    if (type === 'LogicalExpression') return [
        ...getReturnPathExpressions(left),
        ...getReturnPathExpressions(right)
    ];

    return [source];
};

const getInferredReturnContract = ({ node = {}, context = {}, returns = [], useReturns = false } = {}) => {
    const { async = false } = getObject(node);
    const returnRecords = useReturns ? returns : getReturnNodes(node);
    const values = returnRecords
        .flatMap(({ argument = {} } = {}) => async
            ? getReturnPathExpressions(argument).map(path => inferExpression(path, context))
            : [inferExpression(argument, context)]);

    return mergeContracts(async ? values.map(getResolvedContract) : values);
};

const inferMemberExpression = ({ object = {}, property = {}, computed = false, ...node } = {}, context = {}) => {
    const sourceNode = { object, property, computed, ...node };
    const receiver = inferExpression(object, context);
    const propertyName = computed
        ? getExpressionPropertyName({ key: property, computed, context })
        : getStaticName(getObject(property));

    if (!propertyName) return unknown(sourceNode);

    if (propertyName === 'length' && ['array', 'string'].includes(getKind(receiver))) {
        return contract({ kind: 'number', sourceNode });
    }

    if (getKind(receiver) !== 'object') return unknown(sourceNode);

    const { properties = {}, residual = {} } = getObject(receiver);
    const { [propertyName]: propertyValue = {} } = getObject(properties);
    const { properties: residualProperties = {} } = getObject(residual);
    const { [propertyName]: residualValue = {} } = getObject(residualProperties);

    if (getKind(propertyValue) !== 'unknown') return propertyValue;

    if (getKind(residualValue) !== 'unknown') return residualValue;

    return unknown(sourceNode);
};

const inferConditionalExpression = ({ consequent = {}, alternate = {} } = {}, context = {}) => {
    const inferBranch = branch => isEmptyObjectExpression(branch)
        ? getOpenObjectContract(branch)
        : inferExpression(branch, context);

    return mergeContracts([
        inferBranch(consequent),
        inferBranch(alternate)
    ]);
};

const inferLogicalExpression = ({ operator = '', left = {}, right = {}, ...node } = {}, context = {}) => {
    const sourceNode = { operator, left, right, ...node };

    if (!['&&', '||', '??'].includes(operator)) return unknown(sourceNode);

    const rightContract = isEmptyObjectExpression(right)
        ? getOpenObjectContract(right)
        : inferExpression(right, context);

    return mergeContracts([
        inferExpression(left, context),
        rightContract
    ]);
};

const inferUnaryExpression = ({ operator = '', ...node } = {}) => {
    const sourceNode = { operator, ...node };

    if (operator === 'typeof') return contract({ kind: 'string', sourceNode });

    return unknown(sourceNode);
};

const inferBinaryExpression = ({ operator = '', ...node } = {}) => {
    const sourceNode = { operator, ...node };

    if (!['+', '-', '*', '/', '%'].includes(operator)) {
        return contract({ kind: 'boolean', sourceNode });
    }

    if (operator === '+') return unknown(sourceNode);

    return contract({ kind: 'number', sourceNode });
};

const inferPattern = (pattern = {}, defaultNode = {}, context = {}) => {
    const {
        type = '',
        left = {},
        right = {},
        argument = {},
        properties: sourceProperties = [],
        elements = [],
        ...node
    } = getObject(pattern);
    const { type: defaultType = '', properties: defaultProperties = [] } = getObject(defaultNode);
    const sourceNode = {
        type,
        left,
        right,
        argument,
        properties: sourceProperties,
        elements,
        ...node
    };

    if (type === 'AssignmentPattern') return withOptional(
        inferPattern(left, right, context),
        true
    );

    if (type === 'ObjectPattern') {
        const excluded = sourceProperties
            .filter(({ type: propertyType = '' } = {}) => propertyType === 'Property')
            .map(property => getPropertyName(property))
            .filter(Boolean);
        const properties = Object.fromEntries(sourceProperties
            .filter(({ type: propertyType = '' } = {}) => propertyType === 'Property')
            .map(({ value = {}, ...property } = {}) => [
                getPropertyName(property),
                inferPattern(value, {}, context)
            ])
            .filter((entry) => {
                const [name = ''] = entry;

                return name !== '';
            }));
        const hasRest = sourceProperties.some(({ type: propertyType = '' } = {}) => propertyType === 'RestElement');
        const residual = hasRest
            ? {
                kind: 'object',
                state: 'unknown',
                open: true,
                excluded,
                properties: {}
            }
            : {};

        return contract({ kind: 'object', sourceNode, properties, residual });
    }

    if (type === 'ArrayPattern') {
        const elementContracts = elements
            .filter(element => !!element)
            .map(element => inferPattern(element, {}, context));
        const collectKinds = ([element = {}, ...remaining] = [], kinds = []) => {
            if (!elementContracts.length || !hasObjectValue(element)) return kinds;

            const { kind = 'unknown' } = element;
            const nextKinds = kind === 'unknown' ? kinds : [...kinds, kind];

            return collectKinds(remaining, nextKinds);
        };
        const elementKinds = [...new Set(collectKinds(elementContracts))];

        return contract({
            kind: 'array',
            sourceNode,
            elements: elementContracts,
            // Array patterns describe positions, not alternative values. A tuple
            // such as [name, related] must not become a false homogeneous union.
            element: elementKinds.length > 1
                ? unknown(sourceNode)
                : mergeContracts(elementContracts)
        });
    }

    if (type === 'RestElement') return contract({
        kind: 'array',
        sourceNode
    });

    if (!defaultType) return unknown(sourceNode);

    const defaultValue = inferExpression(defaultNode, context);
    const isEmptyObjectDefault = type === 'Identifier' &&
        defaultType === 'ObjectExpression' &&
        !defaultProperties.length;

    if (!isEmptyObjectDefault) return defaultValue;

    return withOptional(getOpenObjectContract(sourceNode), true);
};

const bindPattern = ({
    type = '',
    left = {},
    argument = {},
    name = '',
    properties = [],
    elements = []
} = {}, {
    kind: valueKind = 'unknown',
    element: valueElement = unknown(),
    elements: valueElements = [],
    properties: valueProperties = {},
    residual: valueResidual = {},
    ...valueContract
} = unknown(), bindings = {}) => {
    const value = {
        ...valueContract,
        kind: valueKind,
        element: valueElement,
        elements: valueElements,
        properties: valueProperties,
        residual: hasObjectValue(valueResidual) ? valueResidual : {}
    };

    if (type === 'AssignmentPattern') {
        return bindPattern(left, value, bindings);
    }

    if (type === 'Identifier') {
        return { ...bindings, [name]: value };
    }

    if (type === 'RestElement') {
        return bindPattern(argument, contract({
            kind: 'array',
            element: valueElement
        }), bindings);
    }

    if (type === 'ArrayPattern') {
        return elements.filter(Boolean)
            .reduce((current, pattern, index = 0) => {
                const { [index]: elementValue = valueElement } = valueElements;

                return bindPattern(pattern, elementValue, current);
            }, bindings);
    }

    if (type !== 'ObjectPattern') return bindings;

    const excluded = properties
        .filter(({ type: propertyType = '' } = {}) => propertyType === 'Property')
        .map(property => getPropertyName(property))
        .filter(Boolean);

    return properties
        .filter(({ type: propertyType = '' } = {}) => ['Property', 'RestElement'].includes(propertyType))
        .reduce((currentBindings, { type: propertyType = '', key = {}, computed = false, value = {}, argument = {} } = {}) => {
            if (propertyType === 'RestElement') {
                const residual = getObject(valueResidual);
                const {
                    open: residualOpen = false,
                    excluded: residualExcluded = [],
                    properties: residualSourceProperties = {}
                } = residual;
                const residualProperties = Object.fromEntries(Object.entries(valueProperties)
                    .filter(([name = ''] = []) => !excluded.includes(name)));

                return bindPattern(argument, {
                    kind: 'object',
                    state: 'unknown',
                    properties: {
                        ...residualSourceProperties,
                        ...residualProperties
                    },
                    residual: {
                        kind: 'object',
                        state: 'unknown',
                        open: residualOpen === true || valueKind === 'object',
                        excluded: [...new Set([...(Array.isArray(residualExcluded) ? residualExcluded : []), ...excluded])],
                        properties: {}
                    }
                }, currentBindings);
            }

            const name = getPropertyName({ key, computed });

            if (!name) return currentBindings;

            const { [name]: propertyContract = unknown(value) } = getObject(valueProperties);

            return bindPattern(value, propertyContract, currentBindings);
        }, bindings);
};

const bindPatternIdentities = ({
    pattern = {},
    value = unknown(),
    bindingIndex = {},
    bindingValues = new Map()
} = {}) => {
    const { getBinding = false } = getObject(bindingIndex);

    if (typeof getBinding !== 'function') return bindingValues;

    const namedValues = bindPattern(pattern, value, {});
    let next = new Map(bindingValues);
    walk(pattern, (node = {}) => {
        const { type = '', name = '' } = getObject(node);
        const binding = type === 'Identifier' ? getBinding(node) : {};
        const { declaration = {} } = getObject(binding);

        if (!hasObjectValue(binding) || declaration !== node) return;

        const { [name]: boundValue = unknown(node) } = namedValues;
        next = new Map([...next, [binding, boundValue]]);
    });

    return next;
};

const getFunctionName = ({ id = {}, parent = {} } = {}) => {
    const { type = '', name = '' } = getObject(id);

    if (type === 'Identifier') return name;

    const safeParent = getObject(parent);
    const { type: parentType = '', id: parentId = {} } = safeParent;
    const { type: parentIdType = '', name: parentIdName = '' } = getObject(parentId);

    if (parentType === 'ExportDefaultDeclaration') return 'default';

    if (parentType !== 'VariableDeclarator' || parentIdType !== 'Identifier') return '';

    return parentIdName;
};

const getEnclosingFunction = (node = {}) => {
    const { parent = {} } = getObject(node);

    if (!isObject(parent)) return {};

    const { type = '' } = parent;

    if (!type) return {};

    if (isFunction(parent)) return parent;

    return getEnclosingFunction(parent);
};

const getParameterBindingIndex = ({ functionNode = {}, bindingIndex = {} } = {}) => {
    const {
        getBinding = false,
        getScope = false,
        getScopeBindings = false
    } = getObject(bindingIndex);
    const functionScope = typeof getScope === 'function' ? getScope(functionNode) : {};

    if (typeof getBinding !== 'function' || typeof getScopeBindings !== 'function' ||
        getObject(functionScope).node !== functionNode) return bindingIndex;

    const resolveOuter = (scope = {}, name = '') => {
        const { parent = {} } = getObject(scope);

        if (!hasObjectValue(scope)) return {};

        const match = getScopeBindings(scope).find(({ name: bindingName = '' } = {}) => bindingName === name);

        return match || resolveOuter(parent, name);
    };

    return {
        ...bindingIndex,
        getBinding: (node = {}) => {
            const binding = getBinding(node);
            const { scope = {}, kind = '' } = getObject(binding);
            const { name = '' } = getObject(node);

            // Body var/function declarations share the function scope in the
            // lexical index, but are absent from the parameter environment.
            return scope === functionScope && !['parameter', 'function-name'].includes(kind)
                ? resolveOuter(getObject(functionScope).parent, name)
                : binding;
        }
    };
};

const getSignature = (functionNode = {}, context = {}) => {
    const { params = [] } = getObject(functionNode);
    const { bindingIndex = {} } = getObject(context);
    const parameterIndex = getParameterBindingIndex({ functionNode, bindingIndex });
    let parameterContext = { ...context, bindingIndex: parameterIndex };
    const parameters = params.map((parameter = {}) => {
        const value = inferPattern(parameter, {}, parameterContext);
        const { bindings = {}, bindingValues = new Map() } = parameterContext;

        parameterContext = {
            ...parameterContext,
            bindings: bindPattern(parameter, getObject(value), bindings),
            bindingValues: bindPatternIdentities({
                pattern: parameter,
                value,
                bindingIndex: parameterIndex,
                bindingValues
            })
        };

        return value;
    });
    const [rootContract = unknown()] = parameters;
    const restIndex = params.findIndex(({ type = '' } = {}) => type === 'RestElement');
    const { bindings = {} } = parameterContext;

    return {
        contract: rootContract,
        parameters,
        restIndex,
        bindings
    };
};

const getFunctionNodes = (program = {}) => {
    let functions = [];
    walk(program, (node) => {
        if (isFunction(node)) functions = [...functions, node];
    });

    return functions;
};

const getFunctionContext = (functionNode = {}, functions = {}, {
    callStack = [],
    evaluateCalls = true,
    evaluationDepth = 0,
    initialBindings = {},
    bindingIndex = {},
    functionBindings = new Map(),
    flows = new Map()
} = {}) => {
    const { body = {}, ...node } = getObject(functionNode);
    const sourceNode = { body, ...node };
    const signature = getSignature(functionNode, { bindingIndex, functions, functionBindings });
    const { bindings: signatureBindings = {} } = getObject(signature);
    const { params = [] } = sourceNode;
    let bindingValues = new Map();
    params.forEach((parameter = {}, index = 0) => {
        const { parameters = [] } = signature;
        const { [index]: parameterValue = unknown(parameter) } = parameters;
        const { name = '' } = getObject(parameter);
        const { [name]: initialValue = parameterValue } = initialBindings;

        bindingValues = bindPatternIdentities({
            pattern: parameter,
            value: initialValue,
            bindingIndex,
            bindingValues
        });
    });
    bindingValues = new Map([...bindingValues].map(([binding = {}, boundValue = unknown()] = []) => {
        const { name = '' } = binding;
        const { [name]: initialValue = boundValue } = initialBindings;

        return [binding, Object.hasOwn(initialBindings, name) ? initialValue : boundValue];
    }));
    let context = {
        bindings: { ...signatureBindings, ...initialBindings },
        functions,
        bindingIndex,
        bindingValues,
        functionBindings,
        flows,
        callStack,
        evaluateCalls,
        evaluationDepth
    };
    walk(body, ({ type = '', id = {}, init = {} } = {}) => {
        const { type: idType = '', name = '' } = getObject(id);
        const safeId = getObject(id);

        if (type !== 'VariableDeclarator') return;

        const value = inferExpression(init, context);
        const {
            bindings: currentBindings = {},
            bindingValues: currentBindingValues = new Map(),
            functions: currentFunctions = {},
            functionBindings: currentFunctionBindings = new Map()
        } = getObject(context);

        if (idType !== 'Identifier') {
            context = {
                ...context,
                bindings: bindPattern(safeId, getObject(value), currentBindings),
                bindingValues: bindPatternIdentities({
                    pattern: safeId,
                    value,
                    bindingIndex,
                    bindingValues: currentBindingValues
                })
            };

            return;
        }

        const functionAlias = getFunctionAlias({ init, functions: currentFunctions, context });
        const { signature: functionSignature = {} } = getObject(functionAlias);
        const { getBinding = false } = getObject(bindingIndex);
        const binding = typeof getBinding === 'function'
            ? getBinding(safeId)
            : {};

        if (hasObjectValue(functionSignature)) {
            const nextFunctionBindings = new Map(currentFunctionBindings);

            const completedFunctionBindings = hasObjectValue(binding)
                ? new Map([...nextFunctionBindings, [binding, functionAlias]])
                : nextFunctionBindings;

            context = {
                ...context,
                functions: {
                    ...currentFunctions,
                    [name]: functionAlias
                },
                functionBindings: completedFunctionBindings
            };
        }

        const nextBindingValues = bindPatternIdentities({
            pattern: safeId,
            value,
            bindingIndex,
            bindingValues: currentBindingValues
        });
        context = {
            ...context,
            bindings: {
                ...currentBindings,
                [name]: value
            },
            bindingValues: nextBindingValues
        };
    }, { skipFunctions: true });

    return context;
};

const getFunctionCallContext = ({
    definition = {},
    functions = {},
    arguments: args = [],
    argumentContracts = [],
    argumentContext = {},
    callStack = [],
    evaluateCalls = true,
    evaluationDepth = 0,
    bindingIndex = {},
    functionBindings = new Map()
} = {}) => {
    const {
        bindingIndex: argumentBindingIndex = {},
        functionBindings: argumentFunctionBindings = new Map(),
        flows = new Map()
    } = getObject(argumentContext);
    const sourceBindingIndex = hasObjectValue(bindingIndex) ? bindingIndex : argumentBindingIndex;
    const sourceFunctionBindings = functionBindings.size ? functionBindings : argumentFunctionBindings;
    const { node: functionNode = {} } = getObject(definition);
    const { params = [] } = getObject(functionNode);
    const { parameters = [] } = getSignature(functionNode, {
        bindingIndex: sourceBindingIndex,
        functions,
        functionBindings: sourceFunctionBindings
    });
    const safeArgumentContracts = Array.isArray(argumentContracts)
        ? argumentContracts
        : [];
    let initialBindings = {};
    let initialFunctions = { ...functions };
    let initialFunctionBindings = new Map(sourceFunctionBindings);
    params.forEach((parameter = {}, index = 0) => {
        const { type: parameterType = '', name: parameterName = '' } = getObject(parameter);
        const { [index]: argument = {} } = args;
        const { type: argumentType = '' } = getObject(argument);
        const { [index]: suppliedContract = false } = safeArgumentContracts;
        const { [index]: parameterContract = unknown() } = parameters;

        if ((!argumentType && !suppliedContract) || argumentType === 'SpreadElement') return;

        const actual = suppliedContract || mergeArgumentDefaults({
            expected: parameterContract,
            actual: inferExpression(argument, argumentContext)
        });
        initialBindings = bindPattern(parameter, actual, initialBindings);

        if (parameterType !== 'Identifier') return;

        const knownFunction = getBoundFunction({ node: argument, context: argumentContext });
        const functionDefinition = hasObjectValue(knownFunction) ? knownFunction : (() => {
            const functionValue = inferExpression(argument, argumentContext);
            const {
                kind: functionKind = '',
                sourceNode: functionSourceNode = {},
                signature: functionSignature = {}
            } = getObject(functionValue);
            const { returnContract = unknown() } = getObject(functionSignature);

            if (functionKind !== 'function' || !hasObjectValue(functionSignature)) return {};

            return {
                node: functionSourceNode,
                signature: functionSignature,
                returnContract
            };
        })();
        const { signature: functionDefinitionSignature = {} } = getObject(functionDefinition);

        if (hasObjectValue(functionDefinitionSignature)) {
            initialFunctions = {
                ...initialFunctions,
                [parameterName]: functionDefinition
            };
            const { getBinding = false } = getObject(sourceBindingIndex);
            const parameterBinding = typeof getBinding === 'function'
                ? getBinding(parameter)
                : {};

            initialFunctionBindings = hasObjectValue(parameterBinding)
                ? new Map([
                    ...initialFunctionBindings,
                    [parameterBinding, functionDefinition]
                ])
                : initialFunctionBindings;
        }
    });
    const context = getFunctionContext(functionNode, initialFunctions, {
        callStack,
        evaluateCalls,
        evaluationDepth,
        initialBindings,
        bindingIndex: sourceBindingIndex,
        functionBindings: initialFunctionBindings,
        flows
    });

    return context;
};

const getFunctionReturnFromContracts = ({
    node = {},
    functions = {},
    arguments: argumentContracts = [],
    context = {}
} = {}) => {
    const {
        evaluationDepth: contextEvaluationDepth = 0,
        callStack: contextCallStack = [],
        evaluateCalls: contextEvaluateCalls = true
    } = getObject(context);
    const { params = [] } = getObject(node);

    if (contextEvaluationDepth >= 8) return unknown(node);

    const { parameters = [] } = getSignature(node, context);
    const safeArgumentContracts = Array.isArray(argumentContracts)
        ? argumentContracts
        : [];
    let initialBindings = {};
    params.forEach((parameter = {}, index = 0) => {
        const { [index]: expectedParameter = unknown() } = parameters;
        const { [index]: actualArgument = unknown() } = safeArgumentContracts;
        const actual = mergeArgumentDefaults({
            expected: expectedParameter,
            actual: actualArgument
        });
        initialBindings = bindPattern(parameter, actual, initialBindings);
    });
    const {
        bindingIndex = {},
        functionBindings = new Map(),
        flows = new Map()
    } = getObject(context);
    const functionContext = getFunctionContext(node, functions, {
        callStack: [...contextCallStack, '<inline-callback>'],
        evaluateCalls: contextEvaluateCalls !== false,
        evaluationDepth: contextEvaluationDepth + 1,
        initialBindings,
        bindingIndex,
        functionBindings,
        flows
    });
    const survivingReturns = getSurvivingReturnRecords({ node, flows });
    const useReturns = Array.isArray(survivingReturns);
    const returns = Array.isArray(survivingReturns) ? survivingReturns : [];
    const inferredReturn = getInferredReturnContract({
        node,
        context: functionContext,
        returns,
        useReturns
    });
    const { async = false } = getObject(node);

    if (!async) return inferredReturn;

    return getAsyncReturnContract({ value: inferredReturn, sourceNode: node });
};

const getFunctionValueContract = ({ node = {}, context = {} } = {}) => {
    const signature = getSignature(node, context);
    const {
        evaluationDepth: contextEvaluationDepth = 0,
        functions = {},
        callStack: contextCallStack = [],
        evaluateCalls: contextEvaluateCalls = true
    } = getObject(context);
    const {
        parameters: signatureParameters = [],
        restIndex: signatureRestIndex = -1
    } = getObject(signature);

    if (contextEvaluationDepth >= 8) return contract({
        kind: 'function',
        sourceNode: node,
        signature: {
            parameters: signatureParameters,
            restIndex: signatureRestIndex,
            returnContract: unknown(node)
        }
    });

    const {
        bindingIndex = {},
        functionBindings = new Map(),
        flows = new Map()
    } = getObject(context);
    const functionContext = getFunctionContext(node, functions, {
        callStack: [...contextCallStack, '<function-value>'],
        evaluateCalls: contextEvaluateCalls !== false,
        evaluationDepth: contextEvaluationDepth + 1,
        bindingIndex,
        functionBindings,
        flows
    });
    const survivingReturns = getSurvivingReturnRecords({ node, flows });
    const useReturns = Array.isArray(survivingReturns);
    const returns = Array.isArray(survivingReturns) ? survivingReturns : [];
    const inferredReturn = getInferredReturnContract({
        node,
        context: functionContext,
        returns,
        useReturns
    });
    const { async = false } = getObject(node);
    const returnContract = async
        ? getAsyncReturnContract({ value: inferredReturn, sourceNode: node })
        : inferredReturn;

    return contract({
        kind: 'function',
        sourceNode: node,
        signature: {
            parameters: signatureParameters,
            restIndex: signatureRestIndex,
            returnContract
        }
    });
};

const inferFunctionExpression = (node = {}, context = {}) => (
    getFunctionValueContract({ node, context })
);

const getFunctionReturnContract = ({
    functions = {},
    functionValue = {},
    flowNode = {},
    name = '',
    identity = name,
    sourceNode = {},
    arguments: args = [],
    argumentContracts = [],
    callStack = [],
    argumentContext = {},
    evaluateCalls = true,
    evaluationDepth = 0
} = {}) => {
    const {
        kind: functionKind = 'unknown',
        sourceNode: functionSourceNode = {},
        signature: functionSignature = {}
    } = getObject(functionValue);
    const {
        returnContract: knownReturnContract = false
    } = getObject(functionSignature);
    const { [name]: namedFunction = {} } = getObject(functions);
    const functionContract = functionKind === 'function'
        ? {
            node: functionSourceNode,
            signature: functionSignature,
            returnContract: knownReturnContract || unknown(sourceNode)
        }
        : namedFunction;
    const {
        node: functionNode = {},
        returnContract: functionReturnContract = {}
    } = getObject(functionContract);
    const {
        bindingIndex: functionBindingIndex = {},
        functionBindings = new Map()
    } = getDefinitionOwnerMetadata(functionContract);
    const hasReturnContract = hasObjectValue(functionReturnContract);
    const { async = false } = getObject(functionNode);
    const { flows = new Map() } = getObject(argumentContext);
    const completedNode = hasObjectValue(flowNode) ? flowNode : functionNode;
    const survivingReturns = getSurvivingReturnRecords({ node: completedNode, flows });
    const hasCompletedFlow = Array.isArray(survivingReturns);
    const returns = Array.isArray(survivingReturns) ? survivingReturns : [];
    const completedValues = returns.map(({ contract: value = unknown() } = {}) => value);
    const completedValue = mergeContracts(async ? completedValues.map(getResolvedContract) : completedValues);
    const completedReturn = async
        ? getAsyncReturnContract({ value: completedValue, sourceNode })
        : completedValue;
    let returnContract = hasReturnContract ? functionReturnContract : unknown(sourceNode);

    if (hasCompletedFlow) returnContract = completedReturn;

    if (!hasReturnContract && !hasCompletedFlow) return unknown(sourceNode);

    const shouldEvaluate = callStack.length || (
        functionKind === 'function' && getKind(returnContract) === 'unknown' && args.length
    );

    if (!evaluateCalls || !shouldEvaluate || evaluationDepth >= 8) {
        return returnContract;
    }

    if (callStack.includes(identity) || callStack.length >= 16 || !hasObjectValue(functionNode)) {
        return returnContract;
    }

    const nextCallStack = [...callStack, identity];
    const nextEvaluationDepth = evaluationDepth + 1;
    const context = getFunctionCallContext({
        definition: functionContract,
        functions,
        arguments: args,
        argumentContracts,
        argumentContext,
        callStack: nextCallStack,
        evaluateCalls,
        evaluationDepth: nextEvaluationDepth,
        bindingIndex: functionBindingIndex,
        functionBindings
    });
    const inferredReturn = getInferredReturnContract({
        node: functionNode,
        context,
        returns,
        useReturns: hasCompletedFlow
    });
    const { kind: inferredKind = 'unknown' } = getObject(inferredReturn);
    const { kind: fallbackKind = 'unknown' } = getObject(returnContract);

    if (inferredKind === 'unknown' && fallbackKind !== 'unknown') {
        return returnContract;
    }

    if (async) return getAsyncReturnContract({
        value: inferredReturn,
        sourceNode
    });

    return inferredReturn;
};

const getCallbackDefinition = ({ callback = {}, context = {} } = {}) => {
    if (isFunction(callback)) return {
        node: callback,
        signature: getSignature(callback, context)
    };

    const { type = '' } = getObject(callback);

    if (type !== 'Identifier') return {};

    return getBoundFunction({ node: callback, context });
};

const getCallbackReturnContract = ({
    callback = {},
    arguments: argumentContracts = [],
    context = {}
} = {}) => {
    const definition = getCallbackDefinition({ callback, context });
    const { node: definitionNode = {} } = getObject(definition);

    if (!hasObjectValue(definitionNode)) return unknown(callback);

    const { functions: contextFunctions = {} } = getObject(context);

    return getFunctionReturnFromContracts({
        node: definitionNode,
        functions: contextFunctions,
        arguments: argumentContracts,
        context
    });
};

const inferReduceMethod = ({
    callback = {},
    initial = {},
    element = unknown(),
    receiver = unknown(),
    context = {},
    sourceNode = {}
} = {}) => {
    const { type: initialType = '' } = getObject(initial);

    if (!initialType) return unknown(sourceNode);

    const initialContract = inferExpression(initial, context);
    const callbackReturn = getCallbackReturnContract({
        callback,
        arguments: [initialContract, element, contract({ kind: 'number' }), receiver],
        context
    });

    return mergeContracts([initialContract, callbackReturn]);
};

const inferPromiseAll = ({ args = [], context = {}, sourceNode = {} } = {}) => {
    const [values = {}] = args;
    const collection = inferExpression(values, context);

    if (getKind(getObject(collection)) !== 'array') return unknown(sourceNode);

    const { element = unknown() } = getObject(collection);
    const { kind: elementKind = '', element: resolvedValue = element } = getObject(element);
    const resolvedElement = elementKind === 'promise' ? resolvedValue : element;

    return contract({
        kind: 'promise',
        element: contract({ kind: 'array', element: resolvedElement }),
        sourceNode
    });
};

const inferArrayMethod = ({
    method = '',
    receiver = unknown(),
    args = [],
    context = {},
    sourceNode = {}
} = {}) => {
    const { element = unknown() } = getObject(receiver);
    const [callback = {}, initial = {}] = args;

    if (method === 'map') return contract({
        kind: 'array',
        element: getCallbackReturnContract({
            callback,
            arguments: [element, contract({ kind: 'number' }), receiver],
            context
        }),
        sourceNode
    });

    if (method === 'filter') return contract({ kind: 'array', element, sourceNode });

    if (method === 'some') return contract({ kind: 'boolean', sourceNode });

    if (method === 'forEach') return contract({ kind: 'undefined', sourceNode });

    if (method === 'reduce') return inferReduceMethod({
        callback,
        initial,
        element,
        receiver,
        context,
        sourceNode
    });

    return unknown(sourceNode);
};

const inferMemberCall = ({ callee = {}, ...node } = {}, context = {}) => {
    const sourceNode = { callee, ...node };
    const {
        evaluateCalls = true,
        callStack = [],
        evaluationDepth = 0
    } = context;
    const { object = {}, property = {}, computed = false } = getObject(callee);
    const { arguments: args = [] } = getObject(node);
    const method = computed ? '' : getStaticName(property);
    const { receiverContract = false, argumentContracts = [] } = getObject(context);
    const receiver = receiverContract || inferExpression(object, context);
    const callable = getCallableEvidence({ callee, receiver, context });
    const {
        status = 'unknown',
        member = {},
        nativeIdentity = '',
        expectedKind = '',
        receiverKind = ''
    } = callable;
    const { kind: memberKind = '', returnContract: memberReturnContract = {} } = getObject(member);

    if (status === 'known-authored' && memberKind !== 'function' && hasObjectValue(memberReturnContract)) {
        return memberReturnContract;
    }

    if (status === 'known-authored') {
        return getFunctionReturnContract({
            functionValue: member,
            sourceNode,
            arguments: args,
            argumentContracts,
            argumentContext: context,
            evaluateCalls: evaluateCalls !== false,
            callStack,
            evaluationDepth
        });
    }

    if (status !== 'justified-native') return unknown(sourceNode);

    if (nativeIdentity === 'Object') {
        return contract({ kind: 'array', sourceNode });
    }

    if (nativeIdentity === 'Promise' && method === 'resolve') {
        const [value = {}] = args;

        return contract({
            kind: 'promise',
            element: inferExpression(value, context),
            sourceNode
        });
    }

    if (nativeIdentity === 'Promise' && method === 'all') {
        return inferPromiseAll({ args, context, sourceNode });
    }

    if (expectedKind === 'array' && receiverKind === 'array') {
        return inferArrayMethod({ method, receiver, args, context, sourceNode });
    }

    if (expectedKind === 'regexp' && receiverKind === 'regexp' && method === 'test') {
        return contract({ kind: 'boolean', sourceNode });
    }

    if (expectedKind === 'string' && receiverKind === 'string') {
        return contract({ kind: 'string', sourceNode });
    }

    return unknown(sourceNode);
};

const inferCallExpression = ({ callee = {}, ...node } = {}, context = {}) => {
    const {
        functions = {},
        callStack = [],
        evaluateCalls = true,
        evaluationDepth = 0
    } = context;
    const safeCallee = getObject(callee);
    const { type = '', name = '' } = safeCallee;
    const sourceNode = { callee, ...node };
    const boundFunction = getBoundValue({ node: safeCallee, context });
    const knownFunction = getBoundFunction({ node: safeCallee, context });
    const binding = getLexicalBinding({ node: safeCallee, context });
    const { id: bindingId = '' } = getObject(binding);
    const { kind: boundKind = '' } = getObject(boundFunction);
    const { signature: knownSignature = {} } = getObject(knownFunction);
    const { arguments: callArguments = [] } = getObject(node);
    const { argumentContracts = [] } = getObject(context);
    const {
        status: callableStatus = 'unknown',
        returnKind = ''
    } = getCallableEvidence({ callee: safeCallee, context });

    if (type === 'Identifier' && !hasObjectValue(knownSignature) && callableStatus === 'justified-native') {
        return contract({ kind: returnKind, sourceNode });
    }

    if (type === 'Identifier' && !hasObjectValue(knownSignature) && boundKind !== 'function' &&
        !hasObjectValue(boundFunction)) {
        return unknown(sourceNode);
    }

    if (type === 'Identifier') {
        return getFunctionReturnContract({
            functions,
            functionValue: getObject(boundKind === 'function' ? boundFunction : knownFunction),
            flowNode: getObject(knownFunction).node,
            name,
            identity: bindingId || name,
            sourceNode,
            arguments: callArguments,
            argumentContracts,
            callStack,
            argumentContext: context,
            evaluateCalls,
            evaluationDepth
        });
    }

    if (type === 'MemberExpression') return inferMemberCall(sourceNode, context);

    return unknown(sourceNode);
};

expressionHandlers = {
    ArrayExpression: inferArrayExpression,
    AwaitExpression: inferAwaitExpression,
    ArrowFunctionExpression: inferFunctionExpression,
    BinaryExpression: inferBinaryExpression,
    CallExpression: inferCallExpression,
    ConditionalExpression: inferConditionalExpression,
    LogicalExpression: inferLogicalExpression,
    Literal: inferLiteral,
    MemberExpression: inferMemberExpression,
    ObjectExpression: inferObjectExpression,
    FunctionDeclaration: inferFunctionExpression,
    FunctionExpression: inferFunctionExpression,
    UnaryExpression: inferUnaryExpression
};

const getDefinition = ({
    definition = {},
    definitions = {},
    bindingIndex = {},
    functionBindings = new Map()
} = {}) => {
    const { node = {}, binding = {}, name = '' } = definition;
    const { id: bindingId = '' } = getObject(binding);
    const identity = bindingId || name;
    const context = getFunctionContext(node, definitions, {
        callStack: identity ? [identity] : [],
        evaluateCalls: false,
        bindingIndex,
        functionBindings
    });
    const inferredReturn = getInferredReturnContract({ node, context });
    const { async = false } = getObject(node);
    const returnContract = async
        ? getAsyncReturnContract({ value: inferredReturn, sourceNode: node })
        : inferredReturn;

    return { ...definition, context, returnContract };
};

const publishDefinition = (source = {}) => {
    const { node = {}, signature = {}, returnContract = unknown(), context = {} } = getObject(source);
    const {
        bindings = {},
        functions: contextFunctions = {},
        callStack = [],
        evaluateCalls = true,
        evaluationDepth = 0
    } = getObject(context);
    const functions = Object.fromEntries(Object.entries(getObject(contextFunctions))
        .map(([functionName = '', definition = {}] = []) => {
            const {
                node: functionNode = {},
                signature: functionSignature = {},
                returnContract: functionReturn = unknown()
            } = getObject(definition);

            return [functionName, {
                node: functionNode,
                signature: functionSignature,
                returnContract: functionReturn
            }];
        }));

    return {
        node,
        signature,
        returnContract,
        context: { bindings, functions, callStack, evaluateCalls, evaluationDepth }
    };
};

const resolveDefinitions = ({
    entries = [],
    externalDefinitions = {},
    bindingIndex = {},
    remaining = 0
} = {}) => {
    if (!remaining || !entries.length) return entries;

    const functionBindings = new Map(entries
        .filter(({ binding = {} } = {}) => hasObjectValue(binding))
        .map((definition = {}) => {
            const { binding = {} } = definition;

            return [binding, definition];
        }));
    const { rootScope = {} } = getObject(bindingIndex);
    const isPublished = ({ name = '', binding = {} } = {}) => {
        const { scope = {} } = getObject(binding);

        return Boolean(name) && (!hasObjectValue(bindingIndex) || !hasObjectValue(binding) || scope === rootScope);
    };
    const localDefinitions = Object.fromEntries(entries
        .filter(isPublished)
        .map((definition = {}) => {
            const { name = '' } = definition;

            return [name, definition];
        }));
    const definitions = { ...localDefinitions, ...externalDefinitions };
    const nextEntries = entries.map(definition => getDefinition({
        definition,
        definitions,
        bindingIndex,
        functionBindings
    }));
    const changed = nextEntries
        .some((definition = {}, index = 0) => {
            const { [index]: previousDefinition = {} } = entries;
            const { returnContract: previousReturn = false } = getObject(previousDefinition);
            const { returnContract = false } = getObject(definition);

            return !isEqual(
                previousReturn,
                returnContract
            );
        });

    return changed
        ? resolveDefinitions({
            entries: nextEntries,
            externalDefinitions,
            bindingIndex,
            remaining: remaining - 1
        })
        : nextEntries;
};

const getFunctionBinding = ({ node = {}, bindingIndex = {} } = {}) => {
    const { getBinding = false, getParent = false } = getObject(bindingIndex);

    if (typeof getBinding !== 'function') return {};

    const { id = {} } = getObject(node);
    const direct = getBinding(id);

    if (hasObjectValue(direct)) return direct;

    const parent = typeof getParent === 'function' ? getParent(node) : {};
    const { type = '', id: parentId = {} } = getObject(parent);

    return type === 'VariableDeclarator' ? getBinding(parentId) : {};
};

const getDefinitionForNode = ({ definitions = {}, node = {} } = {}) => {
    const { byNode = new Map() } = getDefinitionMetadata(definitions);

    if (byNode.has(node)) return byNode.get(node);

    const name = getFunctionName(node);
    const { [name]: definition = {} } = getObject(definitions);

    return definition;
};

const getDefinitionNameForNode = ({ definitions = {}, node = {} } = {}) => {
    const { namesByNode = new Map() } = getDefinitionMetadata(definitions);

    return namesByNode.get(node) || getFunctionName(node);
};

const getDefinitionForReference = ({ definitions = {}, node = {}, context = {} } = {}) => {
    const { bindingIndex: storedBindingIndex = {}, byBinding = new Map() } = getDefinitionMetadata(definitions);
    const {
        bindingIndex = storedBindingIndex,
        functionBindings = byBinding
    } = getObject(context);
    const { getBinding = false } = getObject(bindingIndex);
    const binding = typeof getBinding === 'function' ? getBinding(node) : {};

    if (!hasObjectValue(binding)) {
        const { name = '' } = getObject(node);
        const { [name]: definition = {} } = getObject(definitions);

        return definition;
    }

    const definition = functionBindings.get(binding) || byBinding.get(binding);

    if (definition) return definition;

    const { kind = '', name: bindingName = '' } = binding;
    const { [bindingName]: importedDefinition = {} } = getObject(definitions);

    return ['import', 'import-namespace'].includes(kind) ? importedDefinition : {};
};

const getDefinitions = (program = {}, externalDefinitions = {}, {
    functions = getFunctionNodes(program),
    bindingIndex = createBindingIndex(program)
} = {}) => {
    const entries = functions
        .map((node = {}) => {
            const binding = getFunctionBinding({ node, bindingIndex });
            const { name: bindingName = '' } = getObject(binding);
            const name = bindingName || getFunctionName(node);

            return { node, name, binding };
        })
        .filter(({ name = '' } = {}) => Boolean(name))
        .map(({ node = {}, name = '', binding = {} } = {}) => ({
            binding,
            name,
            node,
            signature: getSignature(node, { bindingIndex }),
            returnContract: unknown()
        }));
    const resolved = resolveDefinitions({
        entries,
        externalDefinitions,
        bindingIndex,
        remaining: entries.length + 1
    });
    const { rootScope = {} } = getObject(bindingIndex);
    const isPublished = ({ name = '', binding = {} } = {}) => {
        const { scope = {} } = getObject(binding);

        return Boolean(name) && (!hasObjectValue(bindingIndex) || !hasObjectValue(binding) || scope === rootScope);
    };
    const published = new Map(resolved.map((definition = {}) => [definition, publishDefinition(definition)]));
    const localDefinitions = Object.fromEntries(resolved
        .filter(isPublished)
        .map((definition = {}) => {
            const { name = '' } = definition;

            return [name, published.get(definition)];
        }));
    const definitions = localDefinitions;
    const byBinding = new Map(resolved
        .filter(({ binding = {} } = {}) => hasObjectValue(binding))
        .map((definition = {}) => {
            const { binding = {} } = definition;

            return [binding, published.get(definition)];
        }));
    const byNode = new Map(resolved.map((definition = {}) => {
        const { node = {} } = definition;

        return [node, published.get(definition)];
    }));
    const namesByNode = new Map(resolved.map(({ node = {}, name = '' } = {}) => [node, name]));

    published.forEach(definition => setDefinitionOwnerMetadata(definition, {
        bindingIndex,
        functionBindings: byBinding
    }));

    return setDefinitionMetadata(definitions, { bindingIndex, byBinding, byNode, namesByNode });
};

const getOperationExpectation = ({ kind = 'unknown', method = '' } = {}) => {
    const expectations = {
        string: ['trim', 'toLowerCase', 'toUpperCase', 'replaceAll'],
        array: ['map', 'filter', 'some', 'find', 'reduce', 'forEach']
    };
    const matchingKind = Object.entries(expectations)
        .find(([, methods = []] = []) => methods.includes(method));

    if (!matchingKind) return '';

    const [expectedKind = 'unknown'] = matchingKind;

    return expectedKind === kind ? kind : expectedKind;
};

export {
    copyDefinitionMetadata,
    getChildren,
    getDefinitionForNode,
    getDefinitionNameForNode,
    getDefinitionForReference,
    getDefinitionMetadata,
    getDefinitions,
    getEnclosingFunction,
    getFunctionContext,
    getFunctionAlias,
    getFunctionCallContext,
    getFunctionName,
    getFunctionNodes,
    getOperationExpectation,
    getPropertyName,
    getReturnNodes,
    getSignature,
    inferExpression,
    inferObjectExpression,
    inferPattern,
    isFunction,
    walk
};
