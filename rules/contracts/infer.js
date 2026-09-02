import {
    contract,
    getKind,
    isEqual,
    mergeContracts,
    unknown,
    withOptional
} from './model.js';

const FUNCTION_TYPES = ['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression'];
const NON_CHILD_KEYS = new Set(['parent', 'loc', 'range', 'tokens', 'comments']);
let expressionHandlers = {};

const isFunction = ({ type = '' } = {}) => FUNCTION_TYPES.includes(type);

const getObject = value => value && typeof value === 'object' ? value : {};

const isAstNode = ({ value = {} } = {}) => {
    if (!value || typeof value !== 'object') return false;
    const { type = '' } = value;
    return Boolean(type);
};

const getChildren = (node = {}) => {
    const children = [];
    const addChild = (value = {}) => {
        if (!isAstNode({ value })) return;
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private traversal accumulator avoids repeated AST-array allocations.
        children.push(value);
    };
    Object.keys(node).forEach((key = '') => {
        if (NON_CHILD_KEYS.has(key)) return;
        const { [key]: value = {} } = node;
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
    visitor = () => {},
    { skipFunctions = false, visited = new Set() } = {}
) => {
    if (!isAstNode({ value: node })) return;
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

const getStaticName = ({ type = '', name = '' } = {}) => (
    type === 'Identifier' ? name : ''
);

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
    const { bindings = {} } = context;
    const binding = bindings[name] || {};
    const bindingSource = binding.sourceNode || {};
    return type === 'Identifier' && isStaticPropertyValue(bindingSource.value)
        ? String(bindingSource.value)
        : '';
};

const getCallableContract = ({ definition = {}, sourceNode = {} } = {}) => {
    if (['function', 'object'].includes(definition.kind)) return definition;
    if (!definition.signature) return unknown(sourceNode);
    return contract({
        kind: 'function',
        sourceNode: definition.node || sourceNode,
        signature: {
            parameters: definition.signature.parameters || [],
            restIndex: definition.signature.restIndex ?? -1,
            returnContract: definition.returnContract || unknown(sourceNode)
        }
    });
};

const inferExpression = (node = {}, context = {}) => {
    const source = getObject(node);
    const { type = '', name = '', right = {}, ...rest } = source;
    const { bindings = {}, functions = {} } = context;
    const sourceNode = { type, name, right, ...rest };

    if (type === 'Identifier') {
        const { [name]: functionValue = {} } = functions;
        return bindings[name] || getCallableContract({
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
    const elementContracts = elements.map((element = {}) => inferExpression(element, context));
    return contract({
        kind: 'array',
        sourceNode,
        element: mergeContracts(elementContracts),
        elements: elementContracts
    });
};

const addObjectProperty = ({ property = {}, context = {}, properties = {} } = {}) => {
    const { key = {}, value = {}, computed = false } = property;
    const name = getExpressionPropertyName({ key, computed, context });
    if (!name) return properties;
    return { ...properties, [name]: inferExpression(value, context) };
};

const mergeResidualContracts = ({ left = null, right = null } = {}) => {
    const leftValue = left || {};
    const rightValue = right || {};
    return {
        kind: 'object',
        state: 'unknown',
        open: Boolean(leftValue.open || rightValue.open),
        excluded: [...new Set([...(leftValue.excluded || []), ...(rightValue.excluded || [])])],
        properties: {
            ...(leftValue.properties || {}),
            ...(rightValue.properties || {})
        }
    };
};

const addObjectSpread = ({ property = {}, context = {}, properties = {}, branches = [], residual = null } = {}) => {
    const { argument = {} } = property;
    const { type = '', operator = '', left = {}, right = {} } = argument;
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
    const nextResidual = mergeResidualContracts({ left: residual, right: spread.residual });
    const hasResidual = Boolean(residual || spread.residual);
    return {
        properties: { ...properties, ...(spread.properties || {}) },
        branches,
        ...(hasResidual && { residual: nextResidual })
    };
};

const inferObjectExpression = ({ properties: sourceProperties = [], ...node } = {}, context = {}) => {
    const sourceNode = { properties: sourceProperties, ...node };
    const { properties = {}, branches = [], residual = null } = sourceProperties.reduce((state, property = {}) => {
        const { type = '' } = property;
        if (type === 'Property') {
            return {
                ...state,
                properties: addObjectProperty({
                    property,
                    context,
                    properties: state.properties
                })
            };
        }
        if (type === 'SpreadElement') return addObjectSpread({
            property,
            context,
            properties: state.properties,
            branches: state.branches,
            residual: state.residual
        });
        return state;
    }, { properties: {}, branches: [], residual: null });

    return contract({
        kind: 'object',
        sourceNode,
        properties,
        branches,
        ...(residual && { residual })
    });
};

const mergeArgumentDefaults = ({ expected = unknown(), actual = unknown() } = {}) => {
    const {
        kind: expectedKind = '',
        residual: expectedResidual = null,
        properties: expectedProperties = {}
    } = expected;
    const {
        kind: actualKind = '',
        residual: actualResidual = null,
        properties: actualProperties = {},
        sourceNode = {}
    } = actual;
    if (expectedKind !== 'object' || actualKind !== 'object') return actual;
    const properties = Object.fromEntries(Object.entries(expectedProperties).map(([
        name = '',
        expectedProperty = unknown()
    ] = []) => [
        name,
        actualProperties[name]
            ? mergeArgumentDefaults({ expected: expectedProperty, actual: actualProperties[name] })
            : expectedProperty
    ]));
    return contract({
        kind: 'object',
        properties: {
            ...properties,
            ...actualProperties
        },
        sourceNode,
        residual: actualResidual || expectedResidual || null
    });
};

const getFunctionAlias = ({ init = {}, functions = {} } = {}) => {
    const safeInit = getObject(init);
    if (safeInit.type !== 'Identifier') return {};
    const functionDefinition = functions[safeInit.name] || {};
    return functionDefinition.signature ? functionDefinition : {};
};

const getResolvedContract = (value = unknown()) => {
    const { kind = '', element = unknown() } = value;
    return kind === 'promise' ? getResolvedContract(element) : value;
};

const inferAwaitExpression = ({ argument = {}, ...node } = {}, context = {}) => {
    const sourceNode = { argument, ...node };
    const awaited = inferExpression(argument, context);
    return awaited.kind === 'promise'
        ? { ...getResolvedContract(awaited), sourceNode }
        : awaited;
};

const getAsyncReturnContract = ({ value = unknown(), sourceNode = {} } = {}) => contract({
    kind: 'promise',
    element: getResolvedContract(value),
    sourceNode
});

const getReturnNodes = ({ body = {} } = {}) => {
    if (body.type !== 'BlockStatement') return [{ argument: body }];
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
    const values = getReturnNodes(node)
        .flatMap(({ argument = {} } = {}) => node.async
            ? getReturnPathExpressions(argument).map(path => inferExpression(path, context))
            : [inferExpression(argument, context)]);
    return mergeContracts(node.async ? values.map(getResolvedContract) : values);
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
    const residual = receiver.residual || {};
    const residualProperties = residual.properties || {};
    return receiver.properties[propertyName] || residualProperties[propertyName] || unknown(sourceNode);
};

const inferConditionalExpression = ({ consequent = {}, alternate = {} } = {}, context = {}) => {
    return mergeContracts([
        inferExpression(consequent, context),
        inferExpression(alternate, context)
    ]);
};

const inferLogicalExpression = ({ operator = '', right = {}, ...node } = {}, context = {}) => {
    const sourceNode = { operator, right, ...node };
    if (!['&&', '||', '??'].includes(operator)) return unknown(sourceNode);
    return mergeContracts([
        inferExpression(node.left, context),
        inferExpression(right, context)
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
                return Boolean(name);
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
            : null;
        return contract({ kind: 'object', sourceNode, properties, ...(residual && { residual }) });
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
    if (defaultType) return inferExpression({ type: defaultType, ...defaultNode }, context);
    return unknown(sourceNode);
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
    residual: valueResidual = null,
    ...valueContract
} = unknown(), bindings = {}) => {
    const value = {
        ...valueContract,
        kind: valueKind,
        element: valueElement,
        elements: valueElements,
        properties: valueProperties,
        residual: valueResidual
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
            .reduce((current, pattern, index = 0) => bindPattern(
                pattern,
                valueElements[index] || valueElement,
                current
            ), bindings);
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
                const residual = valueResidual || {};
                const { properties: residualSourceProperties = {} } = residual;
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
                        open: Boolean(residual.open || valueKind === 'object'),
                        excluded: [...new Set([...(residual.excluded || []), ...excluded])],
                        properties: {}
                    }
                }, currentBindings);
            }
            const name = getPropertyName({ key, computed });
            if (!name) return currentBindings;
            const propertyContract = valueProperties[name] || unknown(value);
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

/* eslint-disable resilient/signature-contract-return-consistency -- AST traversal returns either a function node or the empty-node sentinel. */
const getEnclosingFunction = ({ parent = {} } = {}) => {
    if (!parent || typeof parent !== 'object') return {};
    const { type = '' } = parent;
    if (!type) return {};
    if (isFunction(parent)) return parent;
    return getEnclosingFunction(parent);
};
/* eslint-enable resilient/signature-contract-return-consistency */

const getSignature = ({ params = [] } = {}) => {
    const parameters = params.map(parameter => inferPattern(parameter));
    const [rootContract = unknown()] = parameters;
    const restIndex = params.findIndex(({ type = '' } = {}) => type === 'RestElement');
    let bindings = {};
    params.forEach((parameter = {}, index = 0) => {
        bindings = bindPattern(
            parameter,
            parameters[index] || unknown(),
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
    let context = {
        bindings: { ...signature.bindings, ...initialBindings },
        functions,
        callStack,
        evaluateCalls,
        evaluationDepth
    };
    walk(body, ({ type = '', id = {}, init = {} } = {}) => {
        const { type: idType = '', name = '' } = getObject(id);
        if (type !== 'VariableDeclarator') return;
        const value = inferExpression(init, context);
        if (idType !== 'Identifier') {
            context = {
                ...context,
                bindings: bindPattern(id, value, context.bindings)
            };
            return;
        }
        const functionAlias = getFunctionAlias({ init, functions: context.functions });
        if (functionAlias.signature) {
            context = {
                ...context,
                functions: {
                    ...context.functions,
                    [name]: functionAlias
                }
            };
        }
        context = {
            ...context,
            bindings: {
                ...context.bindings,
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
    const { node = {} } = definition;
    const { parameters = [] } = getSignature(node);
    let initialBindings = {};
    let initialFunctions = { ...functions };
    (node.params || []).forEach((parameter = {}, index = 0) => {
        const { type: parameterType = '', name: parameterName = '' } = parameter;
        const { [index]: argument = {} } = args;
        const {
            type: argumentType = '',
            name: argumentName = ''
        } = argument;
        if ((!argument.type && !argumentContracts[index]) || argumentType === 'SpreadElement') return;
        const actual = argumentContracts[index] || mergeArgumentDefaults({
            expected: parameters[index] || unknown(),
            actual: inferExpression(argument, argumentContext)
        });
        initialBindings = bindPattern(parameter, actual, initialBindings);
        if (parameterType !== 'Identifier') return;
        const functionDefinition = functions[argumentName] || (() => {
            const functionValue = inferExpression(argument, argumentContext);
            if (functionValue.kind !== 'function' || !functionValue.signature) return {};
            return {
                node: functionValue.sourceNode,
                signature: functionValue.signature,
                returnContract: functionValue.signature.returnContract || unknown()
            };
        })();
        if (functionDefinition.signature) initialFunctions = {
            ...initialFunctions,
            [parameterName]: functionDefinition
        };
    });
    const context = getFunctionContext(node, initialFunctions, {
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
    if ((context.evaluationDepth || 0) >= 8) return unknown(node);
    const { parameters = [] } = getSignature(node);
    let initialBindings = {};
    (node.params || []).forEach((parameter = {}, index = 0) => {
        const actual = mergeArgumentDefaults({
            expected: parameters[index] || unknown(),
            actual: argumentContracts[index] || unknown()
        });
        initialBindings = bindPattern(parameter, actual, initialBindings);
    });
    const functionContext = getFunctionContext(node, functions, {
        callStack: [...(context.callStack || []), '<inline-callback>'],
        evaluateCalls: context.evaluateCalls !== false,
        evaluationDepth: (context.evaluationDepth || 0) + 1,
        initialBindings
    });
    const inferredReturn = getInferredReturnContract({ node, context: functionContext });
    if (!node.async) return inferredReturn;
    return getAsyncReturnContract({ value: inferredReturn, sourceNode: node });
};

const getFunctionValueContract = ({ node = {}, context = {} } = {}) => {
    const signature = getSignature(node);
    if ((context.evaluationDepth || 0) >= 8) return contract({
        kind: 'function',
        sourceNode: node,
        signature: {
            parameters: signature.parameters,
            restIndex: signature.restIndex,
            returnContract: unknown(node)
        }
    });
    const functionContext = getFunctionContext(node, context.functions || {}, {
        callStack: [...(context.callStack || []), '<function-value>'],
        evaluateCalls: context.evaluateCalls !== false,
        evaluationDepth: (context.evaluationDepth || 0) + 1
    });
    const inferredReturn = getInferredReturnContract({
        node,
        context: functionContext
    });
    const returnContract = node.async
        ? getAsyncReturnContract({ value: inferredReturn, sourceNode: node })
        : inferredReturn;
    return contract({
        kind: 'function',
        sourceNode: node,
        signature: {
            parameters: signature.parameters,
            restIndex: signature.restIndex,
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
    const functionContract = functionValue.kind === 'function'
        ? {
            node: functionValue.sourceNode,
            signature: functionValue.signature,
            returnContract: functionValue.signature && functionValue.signature.returnContract
        }
        : functions[name] || {};
    if (!functionContract.returnContract) return unknown(sourceNode);
    if (!evaluateCalls || !callStack.length || evaluationDepth >= 8) {
        return functionContract.returnContract;
    }
    if (callStack.includes(name) || callStack.length >= 16 || !functionContract.node) {
        return functionContract.returnContract;
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
        node: functionContract.node,
        context
    });
    if (inferredReturn.kind === 'unknown' && functionContract.returnContract.kind !== 'unknown') {
        return functionContract.returnContract;
    }
    if (functionContract.node.async) return getAsyncReturnContract({
        value: inferredReturn,
        sourceNode
    });
    return inferredReturn;
};

const getCallbackDefinition = ({ callback = {}, context = {} } = {}) => {
    if (isFunction(callback)) return {
        node: callback,
        signature: getSignature(callback)
    };
    const { type = '', name = '' } = callback;
    if (type !== 'Identifier') return {};
    return context.functions[name] || {};
};

const getCallbackReturnContract = ({
    callback = {},
    arguments: argumentContracts = [],
    context = {}
} = {}) => {
    const definition = getCallbackDefinition({ callback, context });
    if (!definition.node) return unknown(callback);
    return getFunctionReturnFromContracts({
        node: definition.node,
        functions: context.functions || {},
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
    const { type: initialType = '' } = initial;
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
    const { element = unknown() } = collection;
    const resolvedElement = element.kind === 'promise' ? element.element : element;
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
    const { element = unknown() } = receiver;
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
    const { object = {}, property = {}, computed = false } = callee;
    const { arguments: args = [] } = node;
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
    const member = getKind(receiver) === 'object'
        ? receiver.properties[method] || {}
        : {};
    if (member.kind === 'function') return getFunctionReturnContract({
        functionValue: member,
        sourceNode,
        arguments: args,
        argumentContext: context,
        evaluateCalls: evaluateCalls !== false,
        callStack,
        evaluationDepth
    });
    if (member && member.returnContract) return member.returnContract;
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
    return kinds[name] ? contract({ kind: kinds[name], sourceNode }) : unknown(sourceNode);
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
    const boundFunction = bindings[name] || {};
    const knownFunction = functions[name] || {};
    if (type === 'Identifier' && !knownFunction.signature && boundFunction.kind !== 'function' &&
        !Object.prototype.hasOwnProperty.call(bindings, name)) {
        return getBuiltinCallContract({ name, sourceNode });
    }
    if (type === 'Identifier') {
        return getFunctionReturnContract({
            functions,
            functionValue: boundFunction.kind === 'function' ? boundFunction : knownFunction,
            name,
            sourceNode,
            arguments: node.arguments || [],
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
        .filter(([, candidate = {}] = []) => candidate.node === node)
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
    const returnContract = node.async
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
        .some(([name = '', definition = {}] = []) => !isEqual(
            definitions[name] && definitions[name].returnContract,
            definition.returnContract
        ));
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
