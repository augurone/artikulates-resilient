import {
    createFunctionFlow,
    createFunctionFlows,
    getFlowContext,
    narrowContext
} from './flow.js';
import {
    getDefinitions,
    getFunctionCallContext,
    getOperationExpectation,
    getPropertyName,
    getSignature,
    inferExpression,
    inferPattern,
    isFunction,
    walk
} from './infer.js';
import {
    contract,
    describe,
    getContractVariants,
    getKind,
    isCompatible,
    isKnown,
    unknown
} from './model.js';
import { getObject, hasObjectValue } from '../support/object.js';

const getMethodName = ({ property = {}, computed = false } = {}) => {
    const { type = '', name = '' } = getObject(property);

    return !computed && type === 'Identifier' ? name : '';
};

const getNodeType = (node = {}) => {
    const { type = '' } = getObject(node);

    return type;
};

const getReceiverName = ({ object = {} } = {}) => {
    const source = getObject(object);
    const {
        type = '',
        name = '',
        callee = {},
        object: sourceObject = {},
        property = {},
        computed = false
    } = source;

    if (type === 'Identifier') return name;

    if (type === 'CallExpression') {
        const calleeName = getReceiverName({ object: callee });

        return calleeName ? `${calleeName}()` : 'value';
    }

    if (type !== 'MemberExpression') return 'value';

    const objectName = getReceiverName({ object: sourceObject });
    const propertyName = getPropertyName({ key: property, computed });

    return objectName && propertyName ? `${objectName}.${propertyName}` : 'value';
};

const getArrayMismatches = ({
    expected = {},
    actual = {},
    node = {},
    path = [],
    mismatch
} = {}) => {
    if (typeof mismatch !== 'function') return [];

    const { element: expectedElement = unknown(), elements: expectedElements = [] } = getObject(expected);
    const { element: actualElement = unknown(), elements: actualElements = [] } = getObject(actual);
    const safeExpectedElements = Array.isArray(expectedElements) ? expectedElements : [];
    const safeActualElements = Array.isArray(actualElements) ? actualElements : [];

    if (!safeExpectedElements.length || !safeActualElements.length) return mismatch({
        expected: expectedElement,
        actual: actualElement,
        node,
        path: [...path, '[]']
    });

    return safeExpectedElements.flatMap((expectedValue = unknown(), index = 0) => {
        const { [index]: actualValue = unknown() } = safeActualElements;

        return mismatch({
            expected: expectedValue,
            actual: actualValue,
            node,
            path: [...path, `[${index}]`]
        });
    });
};

const getMismatches = ({ expected = unknown(), actual = unknown(), node = {}, path = [] } = {}) => {
    const { state: expectedState = '', kind: expectedKind = 'unknown', properties: expectedProperties = {} } = getObject(expected);
    const { state: actualState = '', kind: actualKind = 'unknown', properties: actualProperties = {}, residual: actualResidual = {} } = getObject(actual);

    if (expectedState === 'contradictory') return getContractVariants(expected).flatMap(expectedVariant => (
        getMismatches({ expected: expectedVariant, actual, node, path })
    ));

    if (actualState === 'contradictory') return getContractVariants(actual).flatMap(actualVariant => (
        getMismatches({ expected, actual: actualVariant, node, path })
    ));

    if (expectedKind === 'unknown' || actualKind === 'unknown') return [];

    if (expectedKind !== actualKind) return [{ expected, actual, node, path }];

    if (expectedKind === 'array') return getArrayMismatches({
        expected,
        actual,
        node,
        path,
        mismatch: getMismatches
    });

    if (expectedKind !== 'object') return [];

    const { properties: sourceProperties = [] } = getObject(node);
    const { properties: actualResidualProperties = {} } = getObject(actualResidual);
    const safeActualProperties = getObject(actualProperties);
    const safeResidualProperties = getObject(actualResidualProperties);

    return Object.entries(getObject(expectedProperties)).flatMap(([name = '', property = {}] = []) => {
        const { [name]: knownProperty = false } = safeActualProperties;
        const { [name]: residualProperty = false } = safeResidualProperties;
        const actualProperty = knownProperty || residualProperty;
        const propertyNode = sourceProperties.find(candidate => getPropertyName(candidate) === name);
        const { value: propertyValue = node } = getObject(propertyNode);

        return getMismatches({
            expected: property,
            actual: actualProperty,
            node: propertyValue,
            path: [...path, name]
        });
    });
};

const hasProperty = ({ value = {}, name = '' } = {}) => {
    const { properties = {}, residual = {} } = getObject(value);
    const { properties: residualProperties = {} } = getObject(residual);

    const { [name]: foundProperty = false } = getObject(properties);
    const { [name]: foundResidualProperty = false } = getObject(residualProperties);

    return !!(foundProperty || foundResidualProperty);
};

const hasOpenResidual = ({ residual = {} } = {}) => {
    const { open = false } = getObject(residual);

    return open === true;
};

const getShapeMismatches = ({ expected = unknown(), actual = unknown(), node = {}, path = [] } = {}) => {
    const { state: expectedState = '', kind: expectedKind = 'unknown', properties: expectedProperties = {}, residual: expectedResidual = {} } = getObject(expected);
    const { state: actualState = '', kind: actualKind = 'unknown', properties: actualProperties = {}, residual: actualResidual = {} } = getObject(actual);
    const safeExpectedProperties = getObject(expectedProperties);
    const safeActualProperties = getObject(actualProperties);
    const { properties: actualResidualProperties = {} } = getObject(actualResidual);

    if (expectedState === 'contradictory') return getContractVariants(expected).flatMap(expectedVariant => (
        getShapeMismatches({ expected: expectedVariant, actual, node, path })
    ));

    if (actualState === 'contradictory') return getContractVariants(actual).flatMap(actualVariant => (
        getShapeMismatches({ expected, actual: actualVariant, node, path })
    ));

    if (expectedKind !== 'object' || actualKind !== 'object') return [];

    const nested = Object.entries(safeExpectedProperties).flatMap(([name = '', property = {}] = []) => {
        const { [name]: knownProperty = unknown() } = safeActualProperties;
        const { [name]: residualProperty = unknown() } = getObject(actualResidualProperties);
        const actualProperty = knownProperty || residualProperty;

        return getShapeMismatches({
            expected: property,
            actual: actualProperty,
            node,
            path: [...path, name]
        });
    });

    const { type: nodeType = '', properties: nodeProperties = [] } = getObject(node);
    const safeNodeProperties = Array.isArray(nodeProperties) ? nodeProperties : [];
    const exactLiteral = nodeType === 'ObjectExpression' && !safeNodeProperties.some(({ type = '' } = {}) => type === 'SpreadElement');
    const excess = !hasObjectValue(expectedResidual) && exactLiteral
        ? Object.keys(safeActualProperties)
            .filter((name) => {
                const { [name]: foundProperty = false } = safeExpectedProperties;

                return !foundProperty;
            })
            .map(propertyName => ({
                kind: 'excess-property',
                propertyName,
                node,
                path: [...path, propertyName]
            }))
        : [];

    return [...nested, ...excess];
};

const getMissingDestructuredProperties = ({ pattern = {}, actual = unknown(), path = [] } = {}) => {
    const source = getObject(pattern);
    const { type: sourceType = '', left = {} } = source;
    const sourcePattern = sourceType === 'AssignmentPattern' ? getObject(left) : source;
    const { kind: actualKind = 'unknown', properties: actualProperties = {}, residual = {} } = getObject(actual);
    const { type: patternType = '', properties: sourceProperties = [] } = sourcePattern;

    if (patternType !== 'ObjectPattern' || actualKind !== 'object') return [];

    const safeActualProperties = getObject(actualProperties);
    const { properties: residualProperties = {} } = getObject(residual);
    const safeResidualProperties = getObject(residualProperties);
    const openResidual = hasOpenResidual(actual);
    const patternProperties = Array.isArray(sourceProperties) ? sourceProperties : [];

    return patternProperties.flatMap(({
        type = '',
        key = {},
        computed = false,
        value = {}
    } = {}) => {
        if (type === 'RestElement' || computed) return [];

        const name = getPropertyName({ key, computed });

        if (!name) return [];

        const { [name]: knownProperty = false } = safeActualProperties;
        const { [name]: residualProperty = false } = safeResidualProperties;
        const hasKnownProperty = !!(knownProperty || residualProperty);
        const { type: valueType = '' } = getObject(value);
        const hasDefault = valueType === 'AssignmentPattern';

        if (!hasKnownProperty && (hasDefault || openResidual)) return [];

        if (!hasKnownProperty) return [{
            kind: 'missing-property',
            propertyName: name,
            node: key,
            path: [...path, name]
        }];

        const actualProperty = knownProperty || residualProperty;

        return getMissingDestructuredProperties({
            pattern: value,
            actual: actualProperty,
            path: [...path, name]
        });
    });
};

const getArityDiagnostics = ({ node = {}, definition = {} } = {}) => {
    const { signature = {} } = getObject(definition);
    const { parameters: sourceParameters = [], restIndex = -1 } = getObject(signature);
    const { arguments: sourceArguments = [] } = getObject(node);
    const parameters = Array.isArray(sourceParameters) ? sourceParameters : [];
    const args = Array.isArray(sourceArguments) ? sourceArguments : [];

    if (args.some(({ type = '' } = {}) => type === 'SpreadElement')) return [];

    const requiredIndexes = parameters
        .map(({ optional = false } = {}, index = 0) => index !== restIndex && !optional ? index : -1)
        .filter(index => index >= 0);
    const requiredCount = requiredIndexes.length ? Math.max(...requiredIndexes) + 1 : 0;
    const maximumCount = restIndex === -1 ? parameters.length : Number.MAX_SAFE_INTEGER;

    if (args.length < requiredCount) return [{
        kind: 'arity',
        node,
        message: `Expected at least ${requiredCount} argument${requiredCount === 1 ? '' : 's'}, but got ${args.length}.`
    }];

    if (args.length > maximumCount) return [{
        kind: 'arity',
        node,
        message: `Expected at most ${maximumCount} argument${maximumCount === 1 ? '' : 's'}, but got ${args.length}.`
    }];

    return [];
};
const getList = value => (
    Array.isArray(value) ? value : []
);

const hasComputedProperty = (node = {}) => {
    const {
        type = '',
        computed = false,
        left = {},
        argument = {},
        properties = [],
        elements = []
    } = getObject(node);
    const safeLeft = getObject(left);
    const safeArgument = getObject(argument);
    const { type: leftType = '' } = safeLeft;
    const { type: argumentType = '' } = safeArgument;

    return (
        (type === 'Property' && computed) ||
        (leftType && hasComputedProperty(safeLeft)) ||
        (argumentType && hasComputedProperty(safeArgument)) ||
        getList(properties).some(property => hasComputedProperty(property)) ||
        getList(elements).some(element => hasComputedProperty(element))
    );
};

const getSignatureParameters = ({
    signature: {
        parameters = [],
        contract = unknown(),
        restIndex = -1
    } = {}
} = {}) => {
    if (restIndex === 0) return [];

    if (restIndex > 0) return parameters.slice(0, restIndex);

    return parameters.length ? parameters : [contract];
};

const getDefinitionsForProgram = ({ program = {}, definitions = {} } = {}) => (
    Object.keys(definitions).length ? definitions : getDefinitions(program)
);

const getFunctionDefinition = ({ value = {} } = {}) => {
    const {
        kind = 'unknown',
        sourceNode = {},
        signature = {}
    } = getObject(value);
    const { returnContract = unknown() } = getObject(signature);

    if (kind !== 'function' || !hasObjectValue(signature)) return {};

    return {
        node: sourceNode,
        signature,
        returnContract
    };
};

const getMemberFunctionDefinition = ({
    callee: {
        object = {},
        property = {},
        computed = false
    } = {},
    context = {}
} = {}) => {
    const method = getPropertyName({ key: property, computed });

    if (!method) return {};

    const {
        properties: {
            [method]: ogMethod = {}
        } = {},
        residual: {
            properties: {
                [method]: residualMethod = {}
            } = {}
        } = {}
    } = getObject(inferExpression(object, context));

    const propertyDefinition = getFunctionDefinition({ value: ogMethod });

    return hasObjectValue(propertyDefinition)
        ? propertyDefinition
        : getFunctionDefinition({ value: residualMethod });
};

const getTopLevelFunctionAliases = ({ program = {}, definitions = {} } = {}) => {
    let aliases = { ...definitions };
    walk(program, ({ type = '', id = {}, init = {} } = {}) => {
        const safeId = getObject(id);
        const safeInit = getObject(init);
        const { type: idType = '', name = '' } = safeId;
        const { type: initType = '', name: initName = '' } = safeInit;

        if (type !== 'VariableDeclarator' || idType !== 'Identifier') return;

        const { [initName]: functionDefinition = {} } = aliases;
        const { signature = {} } = getObject(functionDefinition);

        if (initType === 'Identifier' && hasObjectValue(signature)) {
            aliases = { ...aliases, [name]: functionDefinition };
        }
    }, { skipFunctions: true });

    return aliases;
};

const getCallbackCalls = ({ node = {}, callbackNames = [] } = {}) => {
    let calls = [];
    const { body = {} } = getObject(node);
    walk(body, (current = {}) => {
        const {
            type = '',
            callee = {},
            arguments: args = []
        } = current;
        const { type: calleeType = '', name: calleeName = '' } = getObject(callee);

        if (type !== 'CallExpression' || calleeType !== 'Identifier') return;

        if (callbackNames.includes(calleeName)) calls = [...calls, { callee, args, node: current }];
    }, { skipFunctions: true });

    return calls;
};

const getArrayCallbackDefinition = ({ callback = {}, context = {} } = {}) => {
    if (isFunction(callback)) return { node: callback, signature: getSignature(callback) };

    const { type = '', name = '' } = getObject(callback);

    if (type !== 'Identifier') return {};

    const { functions = {} } = getObject(context);
    const { [name]: definition = {} } = getObject(functions);

    return definition;
};

const getArrayCallbackOperationContexts = ({
    program = {},
    definitions = {},
    flows = new Map()
} = {}) => {
    const contexts = new Map();
    walk(program, (node = {}) => {
        const { type = '', callee = {}, arguments: sourceArguments = [] } = getObject(node);
        const args = Array.isArray(sourceArguments) ? sourceArguments : [];
        const { type: calleeType = '', object = {}, property = {}, computed = false } = getObject(callee);
        const { type: propertyType = '', name: propertyName = '' } = getObject(property);

        if (type !== 'CallExpression' || calleeType !== 'MemberExpression') return;

        const method = !computed && propertyType === 'Identifier' ? propertyName : '';

        if (!['map', 'filter', 'some', 'find', 'forEach', 'reduce'].includes(method)) return;

        const callContext = getFlowContext({ node, definitions, flows });
        const receiver = inferExpression(object, callContext);
        const {
            functions: contextFunctions = {},
            callStack = [],
            evaluateCalls = true,
            evaluationDepth = 0
        } = getObject(callContext);
        const { element: receiverElement = unknown() } = getObject(receiver);
        const [, reduceInitial = {}] = args;

        if (getKind(receiver) !== 'array') return;

        const [callback = {}] = args;
        const definition = getArrayCallbackDefinition({ callback, context: callContext });
        const { node: definitionNode = {} } = definition;
        const { type: definitionType = '' } = getObject(definitionNode);

        if (!definitionType) return;

        const callbackContext = getFunctionCallContext({
            definition,
            functions: hasObjectValue(contextFunctions) ? contextFunctions : definitions,
            argumentContracts: method === 'reduce'
                ? [
                    inferExpression(reduceInitial, callContext),
                    receiverElement,
                    contract({ kind: 'number' }),
                    receiver
                ]
                : [
                    receiverElement,
                    contract({ kind: 'number' }),
                    receiver
                ],
            callStack,
            evaluateCalls: evaluateCalls !== false,
            evaluationDepth
        });
        const { bindings: callbackBindings = {} } = getObject(callbackContext);
        const callbackFlow = createFunctionFlow({
            functionNode: definitionNode,
            definitions: hasObjectValue(contextFunctions) ? contextFunctions : definitions,
            initialBindings: callbackBindings
        });
        const { body: definitionBody = {} } = getObject(definitionNode);
        const { contexts: callbackContexts = new Map(), finalContext = {} } = getObject(callbackFlow);
        walk(definitionBody, (callbackNode = {}) => {
            const callbackType = getNodeType(callbackNode);

            if (callbackType !== 'MemberExpression') return;

            const callbackContext = callbackContexts.get(callbackNode) || finalContext;
            const nodeContexts = contexts.get(callbackNode);

            if (nodeContexts) {
                // eslint-disable-next-line resilient/prefer-safe-transformations -- Private AST-node index appends callback context for O(1) lookup.
                nodeContexts.push(callbackContext);

                return;
            }

            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private AST-node index creates the first callback-context bucket.
            contexts.set(callbackNode, [callbackContext]);
        }, { skipFunctions: true });
    });

    return contexts;
};

const getArrayCallbackDiagnostics = ({ node = {}, context = {} } = {}) => {
    const { callee = {}, arguments: sourceArguments = [] } = getObject(node);
    const args = Array.isArray(sourceArguments) ? sourceArguments : [];
    const { object = {}, property = {}, computed = false } = getObject(callee);
    const { type: propertyType = '', name: propertyName = '' } = getObject(property);
    const method = !computed && propertyType === 'Identifier' ? propertyName : '';

    if (!['map', 'filter', 'some', 'find', 'forEach', 'reduce'].includes(method)) return [];

    const receiver = inferExpression(object, context);
    const { element: receiverElement = unknown() } = getObject(receiver);

    if (getKind(receiver) !== 'array') return [];

    const [callback = {}] = args;
    const definition = getArrayCallbackDefinition({ callback, context });
    const { signature = {} } = definition;
    const { parameters = [] } = signature;
    const parameterIndex = method === 'reduce' ? 1 : 0;
    const { [parameterIndex]: expected = unknown() } = parameters;

    if (!isKnown(expected)) return [];

    return getMismatches({
        expected,
        actual: receiverElement,
        node: callback,
        path: [method, 'callback']
    }).map(({
        expected: expectedContract = unknown(),
        actual: actualContract = unknown(),
        node: reportNode = callback,
        path = []
    } = {}) => ({
        ruleId: 'signature-contract-call-site',
        messageId: 'mismatch',
        message: `${path.join('.')} expects ${describe(expectedContract)}, but this call supplies ${describe(actualContract)}.`,
        data: {
            path: path.join('.'),
            expected: describe(expectedContract),
            actual: describe(actualContract)
        },
        node: reportNode
    }));
};

const getHigherOrderCallDiagnostics = ({
    node: {
        arguments: nodeArguments = []
    } = {},
    definition: {
        node: functionNode = {},
        ...definitionRest
    } = {},
    context: {
        functions: contextFunctions = {},
        arguments: contextArguments = [],
        callStack = [],
        ...contextRest
    } = {}
} = {}) => {
    const { params = [] } = getObject(functionNode);
    const callbackParameters = params
        .map((parameter, index = 0) => ({ parameter, index }))
        .filter(({ parameter = {} } = {}) => {
            const { type: parameterType = '' } = getObject(parameter);

            return parameterType === 'Identifier';
        })
        .map(({ parameter = {}, index = 0 } = {}) => {
            const { name = '' } = getObject(parameter);

            return { name, index };
        });
    const callbackNames = callbackParameters.map(({ name = '' } = {}) => name);

    if (!callbackNames.length) return [];

    const definition = { node: functionNode, ...definitionRest };
    const context = {
        functions: contextFunctions,
        arguments: contextArguments,
        callStack,
        ...contextRest
    };
    const callArguments = contextArguments.length || !nodeArguments.length
        ? contextArguments
        : nodeArguments;
    const callbackContext = getFunctionCallContext({
        definition,
        functions: contextFunctions,
        arguments: callArguments,
        argumentContext: context,
        callStack,
        evaluateCalls: false
    });

    return getCallbackCalls({ node: functionNode, callbackNames }).flatMap(({
        callee = {},
        args = [],
        node: callbackCall = {}
    } = {}) => {
        const { name: calleeName = '' } = getObject(callee);
        const { functions = {} } = getObject(callbackContext);
        const { [calleeName]: callbackDefinition = {} } = getObject(functions);
        const { signature = {} } = getObject(callbackDefinition);

        if (!hasObjectValue(signature)) return [];

        const callbackParameter = callbackParameters
            .find(({ name = '' } = {}) => name === calleeName) || {};
        const { index: callbackIndex = 0 } = callbackParameter;
        const arityDiagnostics = getArityDiagnostics({
            node: callbackCall,
            definition: callbackDefinition
        }).map(({ message = '' } = {}) => ({
            ruleId: 'signature-contract-call-site',
            messageId: 'arity',
            message,
            data: { message },
            node: callbackCall
        }));
        const shapeDiagnostics = getSignatureParameters(callbackDefinition).flatMap((expected = unknown(), index = 0) => {
            const { [index]: argument = {} } = args;
            const { type: argumentType = '' } = getObject(argument);

            if (!argument || argumentType === 'SpreadElement') return [];

            const actual = inferExpression(argument, callbackContext);
            const callbackPath = [calleeName, ...(index ? [`argument[${index}]`] : [])];
            const { [callbackIndex]: callbackArgument = argument } = nodeArguments;

            return getMismatches({
                expected,
                actual,
                node: callbackArgument,
                path: callbackPath
            }).map(({
                expected: expectedContract = unknown(),
                actual: actualContract = unknown(),
                node: reportNode = {},
                path = []
            } = {}) => {
                const mismatchPath = path.join('.') || callbackPath.join('.');

                return {
                    ruleId: 'signature-contract-call-site',
                    messageId: 'mismatch',
                    message: `${mismatchPath} expects ${describe(expectedContract)}, but this call supplies ${describe(actualContract)}.`,
                    data: {
                        path: mismatchPath,
                        expected: describe(expectedContract),
                        actual: describe(actualContract)
                    },
                    node: reportNode
                };
            });
        });

        return [...arityDiagnostics, ...shapeDiagnostics];
    });
};

const getExpressionContracts = ({ node = {}, context = {} } = {}) => {
    const source = getObject(node);
    const {
        type = '',
        operator = '',
        left = {},
        right = {},
        test = {},
        consequent = {},
        alternate = {}
    } = source;

    if (type === 'ConditionalExpression') return [
        ...getExpressionContracts({
            node: consequent,
            context: narrowContext({ ...test, context, truthy: true })
        }),
        ...getExpressionContracts({
            node: alternate,
            context: narrowContext({ ...test, context, truthy: false })
        })
    ];

    if (type === 'LogicalExpression') return [
        ...getExpressionContracts({ node: left, context }),
        ...getExpressionContracts({
            node: right,
            context: narrowContext({
                ...left,
                context,
                truthy: operator === '&&'
            })
        })
    ];

    return [inferExpression(source, context)];
};

const getCallSiteDiagnostics = ({ program = {}, definitions = {}, flows = new Map() } = {}) => {
    const sourceDefinitions = getTopLevelFunctionAliases({
        program,
        definitions: getDefinitionsForProgram({ program, definitions })
    });
    let diagnostics = [];
    walk(program, (node = {}) => {
        const { type = '', callee = {}, arguments: sourceArguments = [] } = getObject(node);
        const args = Array.isArray(sourceArguments) ? sourceArguments : [];
        const { type: calleeType = '', name: calleeName = '' } = getObject(callee);

        if (type !== 'CallExpression') return;

        const context = getFlowContext({ node, definitions: sourceDefinitions, flows });

        if (calleeType === 'MemberExpression') {
            diagnostics = [...diagnostics, ...getArrayCallbackDiagnostics({ node, context })];
        }

        const { functions: contextFunctions = {} } = getObject(context);
        const callableDefinitions = hasObjectValue(contextFunctions)
            ? contextFunctions
            : sourceDefinitions;
        const { [calleeName]: callableDefinition = {} } = getObject(callableDefinitions);
        let definition = getMemberFunctionDefinition({ callee, context });

        if (calleeType === 'Identifier') {
            definition = hasObjectValue(callableDefinition)
                ? callableDefinition
                : getFunctionDefinition({ value: inferExpression(callee, context) });
        }

        const { signature = {} } = getObject(definition);

        if (!hasObjectValue(signature)) return;

        getArityDiagnostics({ node, definition }).forEach(({ message = '', node: reportNode = node } = {}) => {
            diagnostics = [...diagnostics, {
                ruleId: 'signature-contract-call-site',
                messageId: 'arity',
                message,
                data: { message },
                node: reportNode
            }];
        });

        diagnostics = [...diagnostics, ...getHigherOrderCallDiagnostics({
            node,
            definition,
            context
        })];

        getSignatureParameters(definition).forEach((expected = unknown(), index = 0) => {
            const { [index]: argument = {} } = args;
            const { type: argumentType = '' } = getObject(argument);

            if (!argument || argumentType === 'SpreadElement') return;

            const actual = inferExpression(argument, context);

            getShapeMismatches({ expected, actual, node: argument }).forEach(({
                kind = '',
                propertyName = '',
                node: reportNode = argument,
                path = []
            } = {}) => {
                if (kind !== 'excess-property') return;

                const mismatchPath = path.join('.') || propertyName;

                diagnostics = [...diagnostics, {
                    ruleId: 'signature-contract-call-site',
                    messageId: 'excessProperty',
                    message: `This call supplies excess property ${mismatchPath}.`,
                    data: { path: mismatchPath },
                    node: reportNode
                }];
            });

            if (isCompatible({ expected, actual })) return;

            getMismatches({
                expected,
                actual,
                node: argument,
                path: index ? [`argument[${index}]`] : []
            }).forEach(({
                expected: expectedContract = unknown(),
                actual: actualContract = unknown(),
                node: reportNode = {},
                path = []
            } = {}) => {
                diagnostics = [...diagnostics, {
                    ruleId: 'signature-contract-call-site',
                    messageId: 'mismatch',
                    message: `${path.join('.') || 'argument'} expects ${describe(expectedContract)}, but this call supplies ${describe(actualContract)}.`,
                    data: {
                        path: path.join('.') || 'argument',
                        expected: describe(expectedContract),
                        actual: describe(actualContract)
                    },
                    node: reportNode
                }];
            });
        });
    });

    return diagnostics;
};

const OBJECT_PROPERTIES = new Set([
    '__proto__',
    'constructor',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'toLocaleString',
    'toString',
    'valueOf'
]);

const getPropertyDiagnostics = ({ program = {}, definitions = {}, flows = new Map() } = {}) => {
    const sourceDefinitions = getTopLevelFunctionAliases({
        program,
        definitions: getDefinitionsForProgram({ program, definitions })
    });
    const { size: flowSize = 0 } = flows;
    const sourceFlows = flowSize
        ? flows
        : createFunctionFlows({ program, definitions: sourceDefinitions });
    let diagnostics = [];
    walk(program, (node = {}) => {
        const {
            type = '',
            computed = false,
            property = {},
            object: sourceObject = {}
        } = node;
        const {
            type: propertyType = '',
            name: propertyName = ''
        } = getObject(property);

        if (type !== 'MemberExpression' || computed || propertyType !== 'Identifier') return;

        if (OBJECT_PROPERTIES.has(propertyName)) return;

        const context = getFlowContext({ node, definitions: sourceDefinitions, flows: sourceFlows });
        const receiver = inferExpression(sourceObject, context);
        const { kind: receiverKind = '' } = receiver;

        if (receiverKind !== 'object' || hasOpenResidual(receiver)) return;

        const expectedKind = getOperationExpectation({
            kind: receiverKind,
            method: propertyName
        });

        if (expectedKind && expectedKind !== getKind(receiver)) return;

        if (hasProperty({ value: receiver, name: propertyName })) return;

        diagnostics = [...diagnostics, {
            ruleId: 'signature-contract-property',
            messageId: 'missingProperty',
            message: `Property ${propertyName} does not exist on this known object contract.`,
            data: { property: propertyName },
            node
        }];
    });

    return diagnostics;
};
const getOperationDiagnostics = ({ program = {}, definitions = {}, flows = new Map() } = {}) => {
    const sourceDefinitions = getTopLevelFunctionAliases({
        program,
        definitions: getDefinitionsForProgram({ program, definitions })
    });
    const { size: flowSize = 0 } = flows;
    const sourceFlows = flowSize
        ? flows
        : createFunctionFlows({ program, definitions: sourceDefinitions });
    const callbackContexts = getArrayCallbackOperationContexts({
        program,
        definitions: sourceDefinitions,
        flows: sourceFlows
    });
    let diagnostics = [];

    walk(program, (node = {}) => {
        const { type = '' } = node;

        if (type !== 'MemberExpression') return;

        const { object = {} } = node;
        const method = getMethodName(node);

        if (!method) return;

        const contexts = callbackContexts.get(node) || [];
        const analysisContexts = contexts.length
            ? contexts
            : [getFlowContext({ node, definitions: sourceDefinitions, flows: sourceFlows })];

        analysisContexts.forEach((context = {}) => getExpressionContracts({ node: object, context })
            .flatMap(getContractVariants)
            .filter(isKnown)
            .forEach((receiver = {}) => {
                const expected = getOperationExpectation({
                    kind: getKind(receiver),
                    method
                });

                if (!expected || expected === getKind(receiver)) return;

                diagnostics = [...diagnostics, {
                    ruleId: 'signature-contract-operation',
                    messageId: 'mismatch',
                    message: `${getReceiverName({ object })} is ${describe(receiver)}, but .${method}() requires a ${describe({ kind: expected })}.`,
                    data: {
                        receiver: getReceiverName({ object }),
                        actual: describe(receiver),
                        method,
                        expected: describe({ kind: expected })
                    },
                    node
                }];
            }));
    });

    return diagnostics;
};

const getDestructuringDiagnostics = ({ program = {}, definitions = {}, flows = new Map() } = {}) => {
    const sourceDefinitions = getTopLevelFunctionAliases({
        program,
        definitions: getDefinitionsForProgram({ program, definitions })
    });
    const { size: flowSize = 0 } = flows;
    const sourceFlows = flowSize
        ? flows
        : createFunctionFlows({ program, definitions: sourceDefinitions });
    let diagnostics = [];

    walk(program, (node = {}) => {
        const { type = '', id = {}, init = {} } = getObject(node);

        if (type !== 'VariableDeclarator') return;

        const expected = inferPattern(id);
        const { kind: expectedKind = 'unknown' } = getObject(expected);

        if (!['array', 'object'].includes(expectedKind)) return;

        if (hasComputedProperty(id)) return;

        const context = getFlowContext({ node: init, definitions: sourceDefinitions, flows: sourceFlows });
        const actual = inferExpression(init, context);

        if (!isKnown(actual)) return;

        getMismatches({ expected, actual, node: init }).forEach(({
            expected: expectedContract = unknown(),
            actual: actualContract = unknown(),
            node: reportNode = init
        } = {}) => {
            diagnostics = [...diagnostics, {
                ruleId: 'signature-contract-destructuring',
                messageId: 'mismatch',
                message: `This ${describe(actualContract)} value is destructured as ${describe(expectedContract)}.`,
                data: {
                    actual: describe(actualContract),
                    expected: describe(expectedContract)
                },
                node: reportNode
            }];
        });

        getMissingDestructuredProperties({ pattern: id, actual })
            .forEach(({ propertyName = '', path = [], node: reportNode = init } = {}) => {
                const propertyPath = path.join('.') || propertyName;
                diagnostics = [...diagnostics, {
                    ruleId: 'signature-contract-destructuring',
                    messageId: 'missingProperty',
                    message: `Property ${propertyPath} does not exist on this known object contract.`,
                    data: { property: propertyPath },
                    node: reportNode
                }];
            });
    });

    return diagnostics;
};

const getContractDiagnostics = ({ program = {}, definitions = {}, flows = new Map() } = {}) => [
    ...getCallSiteDiagnostics({ program, definitions, flows }),
    ...getOperationDiagnostics({ program, definitions, flows }),
    ...getDestructuringDiagnostics({ program, definitions, flows }),
    ...getPropertyDiagnostics({ program, definitions, flows })
];

export {
    getCallSiteDiagnostics,
    getContractDiagnostics,
    getDestructuringDiagnostics,
    getArityDiagnostics,
    getOperationDiagnostics,
    getMismatches,
    getPropertyDiagnostics,
    getShapeMismatches,
    hasComputedProperty
};
