import {
    contract,
    getKind,
    isEqual,
    mergeContracts,
    unknown,
    withOptional
} from './model.js';
import {
    getObject,
    hasObjectValue,
    isObject
} from '../support/object.js';

const FUNCTION_TYPES = ['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression'];
const NON_CHILD_KEYS = new Set(['parent', 'loc', 'range', 'tokens', 'comments']);
let expressionHandlers = {};

const isFunction = (node = {}) => {
    const { type = '' } = getObject(node);

    return FUNCTION_TYPES.includes(type);
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
        if (NON_CHILD_KEYS.has(key)) return;

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
    const { bindings = {}, functions = {} } = getObject(context);
    const { [name]: boundValue = {} } = getObject(bindings);
    const { kind: boundKind = '' } = getObject(boundValue);
    const sourceNode = { type, name, right, ...rest };

    if (type === 'Identifier') {
        const { [name]: functionValue = {} } = functions;

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

const getFunctionAlias = ({ init = {}, functions = {} } = {}) => {
    const safeInit = getObject(init);
    const { type = '', name = '' } = safeInit;

    if (type !== 'Identifier') return {};

    const { [name]: functionDefinition = {} } = getObject(functions);
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
    const { kind: awaitedKind = '' } = getObject(awaited);

    return awaitedKind === 'promise'
        ? { ...getResolvedContract(awaited), sourceNode }
        : awaited;
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

const getInferredReturnContract = ({ node = {}, context = {} } = {}) => {
    const { async = false } = getObject(node);
    const values = getReturnNodes(node)
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

const inferPattern = ({
    type = '',
    left = {},
    right = {},
    argument = {},
    properties: sourceProperties = [],
    elements = [],
    ...node
} = {}, { type: defaultType = '', ...defaultNode } = {}, context = {}) => {
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
            .filter(Boolean)
            .map(element => inferPattern(element, {}, context));
        const elementKinds = [...new Set(elementContracts
            .filter(({ kind = 'unknown' } = {}) => kind !== 'unknown')
            .map(({ kind = 'unknown' } = {}) => kind))];

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

    const defaultValue = inferExpression({ type: defaultType, ...defaultNode }, context);
    const { properties: defaultProperties = [] } = defaultNode;
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

const getEnclosingFunction = ({ parent = {} } = {}) => {
    // eslint-disable-next-line resilient/signature-contract-return-consistency -- AST traversal uses an empty object sentinel when no function encloses the node.
    if (!isObject(parent)) return {};

    const { type = '' } = parent;

    // eslint-disable-next-line resilient/signature-contract-return-consistency -- AST traversal uses an empty object sentinel when no function encloses the node.
    if (!type) return {};

    // eslint-disable-next-line resilient/signature-contract-return-consistency -- A function AST node is the required identity-preserving result for callers.
    if (isFunction(parent)) return parent;

    // eslint-disable-next-line resilient/signature-contract-return-consistency -- Recursive AST traversal preserves the function-node or empty-sentinel contract.
    return getEnclosingFunction(parent);
};

const getSignature = ({ params = [] } = {}) => {
    const parameters = params.map(parameter => inferPattern(parameter));
    const [rootContract = unknown()] = parameters;
    const restIndex = params.findIndex(({ type = '' } = {}) => type === 'RestElement');
    let bindings = {};
    params.forEach((parameter = {}, index = 0) => {
        const { [index]: parameterContract = unknown() } = parameters;
        bindings = bindPattern(
            parameter,
            parameterContract,
            bindings
        );
    });

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

const getFunctionContext = ({ body = {}, ...node } = {}, functions = {}, {
    callStack = [],
    evaluateCalls = true,
    evaluationDepth = 0,
    initialBindings = {}
} = {}) => {
    const sourceNode = { body, ...node };
    const signature = getSignature(sourceNode);
    const { bindings: signatureBindings = {} } = getObject(signature);
    let context = {
        bindings: { ...signatureBindings, ...initialBindings },
        functions,
        callStack,
        evaluateCalls,
        evaluationDepth
    };
    walk(body, ({ type = '', id = {}, init = {} } = {}) => {
        const { type: idType = '', name = '' } = getObject(id);

        if (type !== 'VariableDeclarator') return;

        const value = inferExpression(init, context);
        const {
            bindings: currentBindings = {},
            functions: currentFunctions = {}
        } = getObject(context);

        if (idType !== 'Identifier') {
            context = {
                ...context,
                bindings: bindPattern(id, value, currentBindings)
            };

            return;
        }

        const functionAlias = getFunctionAlias({ init, functions: currentFunctions });
        const { signature: functionSignature = {} } = getObject(functionAlias);

        if (hasObjectValue(functionSignature)) {
            context = {
                ...context,
                functions: {
                    ...currentFunctions,
                    [name]: functionAlias
                }
            };
        }

        context = {
            ...context,
            bindings: {
                ...currentBindings,
                [name]: value
            }
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
    evaluationDepth = 0
} = {}) => {
    const { node: functionNode = {} } = getObject(definition);
    const { params = [] } = getObject(functionNode);
    const { parameters = [] } = getSignature(functionNode);
    const safeArgumentContracts = Array.isArray(argumentContracts)
        ? argumentContracts
        : [];
    let initialBindings = {};
    let initialFunctions = { ...functions };
    params.forEach((parameter = {}, index = 0) => {
        const { type: parameterType = '', name: parameterName = '' } = getObject(parameter);
        const { [index]: argument = {} } = args;
        const { type: argumentType = '', name: argumentName = '' } = getObject(argument);
        const { [index]: suppliedContract = false } = safeArgumentContracts;
        const { [index]: parameterContract = unknown() } = parameters;

        if ((!argumentType && !suppliedContract) || argumentType === 'SpreadElement') return;

        const actual = suppliedContract || mergeArgumentDefaults({
            expected: parameterContract,
            actual: inferExpression(argument, argumentContext)
        });
        initialBindings = bindPattern(parameter, actual, initialBindings);

        if (parameterType !== 'Identifier') return;

        const { [argumentName]: knownFunction = {} } = functions;
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

        if (hasObjectValue(functionDefinitionSignature)) initialFunctions = {
            ...initialFunctions,
            [parameterName]: functionDefinition
        };
    });
    const context = getFunctionContext(functionNode, initialFunctions, {
        callStack,
        evaluateCalls,
        evaluationDepth,
        initialBindings
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

    const { parameters = [] } = getSignature(node);
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
    const functionContext = getFunctionContext(node, functions, {
        callStack: [...contextCallStack, '<inline-callback>'],
        evaluateCalls: contextEvaluateCalls !== false,
        evaluationDepth: contextEvaluationDepth + 1,
        initialBindings
    });
    const inferredReturn = getInferredReturnContract({ node, context: functionContext });
    const { async = false } = getObject(node);

    if (!async) return inferredReturn;

    return getAsyncReturnContract({ value: inferredReturn, sourceNode: node });
};

const getFunctionValueContract = ({ node = {}, context = {} } = {}) => {
    const signature = getSignature(node);
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

    const functionContext = getFunctionContext(node, functions, {
        callStack: [...contextCallStack, '<function-value>'],
        evaluateCalls: contextEvaluateCalls !== false,
        evaluationDepth: contextEvaluationDepth + 1
    });
    const inferredReturn = getInferredReturnContract({
        node,
        context: functionContext
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
    name = '',
    sourceNode = {},
    arguments: args = [],
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
    const hasReturnContract = hasObjectValue(functionReturnContract);
    const returnContract = hasReturnContract ? functionReturnContract : unknown(sourceNode);
    const { async = false } = getObject(functionNode);

    if (!hasReturnContract) return unknown(sourceNode);

    if (!evaluateCalls || !callStack.length || evaluationDepth >= 8) {
        return returnContract;
    }

    if (callStack.includes(name) || callStack.length >= 16 || !hasObjectValue(functionNode)) {
        return returnContract;
    }

    const nextCallStack = [...callStack, name];
    const nextEvaluationDepth = evaluationDepth + 1;
    const context = getFunctionCallContext({
        definition: functionContract,
        functions,
        arguments: args,
        argumentContext,
        callStack: nextCallStack,
        evaluateCalls,
        evaluationDepth: nextEvaluationDepth
    });
    const inferredReturn = getInferredReturnContract({
        node: functionNode,
        context
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
    const { params = [] } = getObject(callback);

    if (isFunction(callback)) return {
        node: callback,
        signature: getSignature({ params })
    };

    const { type = '', name = '' } = getObject(callback);

    if (type !== 'Identifier') return {};

    const { functions = {} } = getObject(context);
    const { [name]: definition = {} } = getObject(functions);

    return definition;
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

    if (getKind(collection) !== 'array') return unknown(sourceNode);

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
    const receiver = inferExpression(object, context);
    const { type: objectType = '', name: objectName = '' } = getObject(object);

    if (objectType === 'Identifier' && objectName === 'Object' && ['entries', 'keys', 'values'].includes(method)) {
        return contract({ kind: 'array', sourceNode });
    }

    if (objectType === 'Identifier' && objectName === 'Promise' && method === 'resolve') {
        const [value = {}] = args;

        return contract({
            kind: 'promise',
            element: inferExpression(value, context),
            sourceNode
        });
    }

    if (objectType === 'Identifier' && objectName === 'Promise' && method === 'all') {
        return inferPromiseAll({ args, context, sourceNode });
    }

    if (getKind(receiver) === 'array' && ['map', 'filter', 'some', 'forEach', 'reduce'].includes(method)) {
        return inferArrayMethod({ method, receiver, args, context, sourceNode });
    }

    if (getKind(receiver) === 'regexp' && method === 'test') {
        return contract({ kind: 'boolean', sourceNode });
    }

    const { properties = {} } = getObject(receiver);
    const { [method]: member = {} } = getObject(properties);
    const { kind: memberKind = '', returnContract = {} } = getObject(member);
    const hasMemberReturn = hasObjectValue(returnContract);

    if (memberKind === 'function') return getFunctionReturnContract({
        functionValue: member,
        sourceNode,
        arguments: args,
        argumentContext: context,
        evaluateCalls: evaluateCalls !== false,
        callStack,
        evaluationDepth
    });

    if (hasMemberReturn) return returnContract;

    if (method === 'some') return contract({ kind: 'boolean', sourceNode });

    if (['trim', 'toLowerCase', 'toUpperCase', 'replaceAll'].includes(method)) {
        return contract({ kind: 'string', sourceNode });
    }

    return unknown(sourceNode);
};

const getBuiltinCallContract = ({ name = '', sourceNode = {} } = {}) => {
    const kinds = {
        Boolean: 'boolean',
        Number: 'number',
        String: 'string'
    };
    const { [name]: builtinKind = '' } = kinds;

    return builtinKind ? contract({ kind: builtinKind, sourceNode }) : unknown(sourceNode);
};

const inferCallExpression = ({ callee = {}, ...node } = {}, context = {}) => {
    const {
        functions = {},
        bindings = {},
        callStack = [],
        evaluateCalls = true,
        evaluationDepth = 0
    } = context;
    const safeCallee = getObject(callee);
    const { type = '', name = '' } = safeCallee;
    const sourceNode = { callee, ...node };
    const { [name]: boundFunction = false } = getObject(bindings);
    const { [name]: knownFunction = {} } = getObject(functions);
    const { kind: boundKind = '' } = getObject(boundFunction);
    const { signature: knownSignature = {} } = getObject(knownFunction);
    const { arguments: callArguments = [] } = getObject(node);

    if (type === 'Identifier' && !hasObjectValue(knownSignature) && boundKind !== 'function' &&
        !boundFunction) {
        return getBuiltinCallContract({ name, sourceNode });
    }

    if (type === 'Identifier') {
        return getFunctionReturnContract({
            functions,
            functionValue: boundKind === 'function' ? boundFunction : knownFunction,
            name,
            sourceNode,
            arguments: callArguments,
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
    externalDefinitions = {}
} = {}) => {
    const { node = {} } = definition;
    const matchingDefinitions = Object.entries(definitions)
        .filter(([, candidate = {}] = []) => {
            const { node: candidateNode = {} } = getObject(candidate);

            return candidateNode === node;
        })
        .map(([name = ''] = []) => name);
    const [definitionName = ''] = matchingDefinitions;
    const context = getFunctionContext(node, {
        ...externalDefinitions,
        ...definitions
    }, {
        callStack: definitionName ? [definitionName] : [],
        evaluateCalls: false
    });
    const inferredReturn = getInferredReturnContract({ node, context });
    const { async = false } = getObject(node);
    const returnContract = async
        ? getAsyncReturnContract({ value: inferredReturn, sourceNode: node })
        : inferredReturn;

    return { ...definition, context, returnContract };
};

const resolveDefinitions = ({
    definitions = {},
    externalDefinitions = {},
    remaining = 0
} = {}) => {
    if (!remaining) return definitions;

    const nextDefinitions = Object.fromEntries(Object.entries(definitions)
        .map(([name = '', definition = {}] = []) => [
            name,
            getDefinition({ definition, definitions, externalDefinitions })
        ]));
    const changed = Object.entries(nextDefinitions)
        .some(([name = '', definition = {}] = []) => {
            const { [name]: previousDefinition = {} } = getObject(definitions);
            const { returnContract: previousReturn = false } = getObject(previousDefinition);
            const { returnContract = false } = getObject(definition);

            return !isEqual(
                previousReturn,
                returnContract
            );
        });

    return changed
        ? resolveDefinitions({
            definitions: nextDefinitions,
            externalDefinitions,
            remaining: remaining - 1
        })
        : nextDefinitions;
};

const getDefinitions = (program = {}, externalDefinitions = {}) => {
    let definitions = {};
    getFunctionNodes(program)
        .map(node => ({ node, name: getFunctionName(node) }))
        .filter(({ name = '' } = {}) => Boolean(name))
        .forEach(({ node = {}, name = '' } = {}) => {
            definitions = {
                ...definitions,
                [name]: {
                    node,
                    signature: getSignature(node),
                    returnContract: unknown()
                }
            };
        });

    return resolveDefinitions({
        definitions,
        externalDefinitions,
        remaining: Object.keys(definitions).length + 1
    });
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
    getChildren,
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
