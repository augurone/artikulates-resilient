import {
    contract,
    getKind,
    isEqual,
    mergeContracts,
    unknown,
    withOptional
} from './model.js';

const FUNCTION_TYPES = ['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression'];
let expressionHandlers = {};

const isFunction = ({ type = '' } = {}) => FUNCTION_TYPES.includes(type);

const getObject = value => value && typeof value === 'object' ? value : {};

const isAstNode = ({ value = {} } = {}) => {
    if (!value || typeof value !== 'object') return false;
    const { type = '' } = value;
    return Boolean(type);
};

const getChildren = (node = {}) => Object.entries(node)
    .filter(([key = '']) => !['parent', 'loc', 'range', 'tokens', 'comments'].includes(key))
    .flatMap(([, value = {}] = []) => (
        Array.isArray(value) ? value : [value]
    ))
    .filter(value => isAstNode({ value }));

const walk = (
    node = {},
    visitor = () => {},
    { skipFunctions = false, visited = new Set() } = {}
) => {
    if (!isAstNode({ value: node })) return;
    if (visited.has(node)) return;
    const nextVisited = new Set([...visited, node]);
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

const inferExpression = (node = {}, context = {}) => {
    const source = getObject(node);
    const { type = '', name = '', right = {}, ...rest } = source;
    const { bindings = {}, functions = {} } = context;
    const sourceNode = { type, name, right, ...rest };

    if (type === 'Identifier') {
        const { [name]: functionValue = {} } = functions;
        return bindings[name] || (functionValue.kind === 'object' ? functionValue : unknown(sourceNode));
    }
    if (type === 'AssignmentPattern') return inferExpression(right, context);
    if (type === 'Literal') return expressionHandlers.Literal(sourceNode, context);
    if (type === 'TemplateLiteral') return contract({ kind: 'string', sourceNode });

    const { [type]: handler = {} } = expressionHandlers;
    if (typeof handler === 'function') return handler(sourceNode, context);
    return unknown(sourceNode);
};

const inferLiteral = ({ value = '', ...node } = {}) => {
    const sourceNode = { value, ...node };
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
    const name = getPropertyName({ key, computed });
    if (!name) return properties;
    return { ...properties, [name]: inferExpression(value, context) };
};

const addObjectSpread = ({ property = {}, context = {}, properties = {}, branches = [] } = {}) => {
    const { argument = {} } = property;
    const { type = '', operator = '', left = {}, right = {} } = argument;
    if (type === 'LogicalExpression' && operator === '&&') {
        return {
            properties,
            branches: [...branches, {
                condition: left,
                shape: inferExpression(right, context)
            }]
        };
    }

    const spread = inferExpression(argument, context);
    return {
        properties: { ...properties, ...(spread.properties || {}) },
        branches
    };
};

const inferObjectExpression = ({ properties: sourceProperties = [], ...node } = {}, context = {}) => {
    const sourceNode = { properties: sourceProperties, ...node };
    const { properties = {}, branches = [] } = sourceProperties.reduce((state, property = {}) => {
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
            branches: state.branches
        });
        return state;
    }, { properties: {}, branches: [] });

    return contract({
        kind: 'object',
        sourceNode,
        properties,
        branches
    });
};

const mergeArgumentDefaults = ({ expected = unknown(), actual = unknown() } = {}) => {
    if (expected.kind !== 'object' || actual.kind !== 'object') return actual;
    const properties = Object.fromEntries(Object.entries(expected.properties || {}).map(([
        name = '',
        expectedProperty = unknown()
    ] = []) => [
        name,
        actual.properties[name]
            ? mergeArgumentDefaults({ expected: expectedProperty, actual: actual.properties[name] })
            : expectedProperty
    ]));
    return contract({
        kind: 'object',
        properties: {
            ...properties,
            ...actual.properties
        },
        sourceNode: actual.sourceNode
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
    const propertyName = computed ? '' : getStaticName(getObject(property));

    if (!propertyName) return unknown(sourceNode);
    if (propertyName === 'length' && ['array', 'string'].includes(getKind(receiver))) {
        return contract({ kind: 'number', sourceNode });
    }
    if (getKind(receiver) !== 'object') return unknown(sourceNode);
    return receiver.properties[propertyName] || unknown(sourceNode);
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
        return contract({ kind: 'object', sourceNode, properties });
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
} = {}, valueContract = unknown(), bindings = {}) => {
    const {
        element: valueElement = unknown(),
        elements: valueElements = [],
        properties: valueProperties = {}
    } = valueContract;
    if (type === 'AssignmentPattern') {
        return bindPattern(left, valueContract, bindings);
    }
    if (type === 'Identifier') {
        return { ...bindings, [name]: valueContract };
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
    return properties
        .filter(({ type: propertyType = '' } = {}) => propertyType === 'Property')
        .reduce((currentBindings, { key = {}, computed = false, value = {} } = {}) => {
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

const getEnclosingFunction = ({ parent = {} } = {}) => {
    if (!parent || typeof parent !== 'object') return {};
    const { type = '' } = parent;
    if (!type) return {};
    if (isFunction(parent)) return parent;
    return getEnclosingFunction(parent);
};

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
        const { type: argumentType = '', name: argumentName = '' } = argument;
        if (!argument || argumentType === 'SpreadElement') return;
        const actual = argumentContracts[index] || mergeArgumentDefaults({
            expected: parameters[index] || unknown(),
            actual: inferExpression(argument, argumentContext)
        });
        initialBindings = bindPattern(parameter, actual, initialBindings);
        if (parameterType !== 'Identifier' || argumentType !== 'Identifier') return;
        const functionDefinition = functions[argumentName] || {};
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

const getFunctionReturnContract = ({
    functions = {},
    name = '',
    sourceNode = {},
    arguments: args = [],
    callStack = [],
    argumentContext = {},
    evaluateCalls = true,
    evaluationDepth = 0
} = {}) => {
    const { [name]: functionContract = {} } = functions;
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
    const member = getKind(receiver) === 'object'
        ? receiver.properties[method]
        : {};
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
    if (type === 'Identifier' && !functions[name] && !Object.prototype.hasOwnProperty.call(bindings, name)) {
        return getBuiltinCallContract({ name, sourceNode });
    }
    if (type === 'Identifier') {
        return getFunctionReturnContract({
            functions,
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
    BinaryExpression: inferBinaryExpression,
    CallExpression: inferCallExpression,
    ConditionalExpression: inferConditionalExpression,
    LogicalExpression: inferLogicalExpression,
    Literal: inferLiteral,
    MemberExpression: inferMemberExpression,
    ObjectExpression: inferObjectExpression,
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
