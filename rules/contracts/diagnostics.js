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

const getMethodName = ({ property = {}, computed = false } = {}) => (
    !computed && property.type === 'Identifier' ? property.name : ''
);

const getNodeType = ({ type = '' } = {}) => type;

const getReceiverName = ({ object = {} } = {}) => {
    const {
        type = '',
        name = '',
        callee = {},
        object: sourceObject = {},
        property = {},
        computed = false
    } = object;
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
    mismatch = () => []
} = {}) => {
    const expectedElements = expected.elements || [];
    const actualElements = actual.elements || [];
    if (!expectedElements.length || !actualElements.length) return mismatch({
        expected: expected.element,
        actual: actual.element,
        node,
        path: [...path, '[]']
    });
    return expectedElements.flatMap((expectedElement = unknown(), index = 0) => mismatch({
        expected: expectedElement,
        actual: actualElements[index] || unknown(),
        node,
        path: [...path, `[${index}]`]
    }));
};

const getMismatches = ({ expected = unknown(), actual = unknown(), node = {}, path = [] } = {}) => {
    if (expected.state === 'contradictory') return getContractVariants(expected).flatMap(expectedVariant => (
        getMismatches({ expected: expectedVariant, actual, node, path })
    ));
    if (actual.state === 'contradictory') return getContractVariants(actual).flatMap(actualVariant => (
        getMismatches({ expected, actual: actualVariant, node, path })
    ));
    if (expected.kind === 'unknown' || actual.kind === 'unknown') return [];
    if (expected.kind !== actual.kind) return [{ expected, actual, node, path }];
    if (expected.kind === 'array') return getArrayMismatches({
        expected,
        actual,
        node,
        path,
        mismatch: getMismatches
    });
    if (expected.kind !== 'object') return [];

    return Object.entries(expected.properties || {}).flatMap(([name = '', property = {}] = []) => {
        const { properties: actualProperties = {} } = actual;
        const residualProperties = actual.residual && actual.residual.properties || {};
        const { properties: sourceProperties = [] } = node;
        const actualProperty = Object.hasOwn(actualProperties, name)
            ? actualProperties[name]
            : residualProperties[name] || unknown();
        const propertyNode = sourceProperties
            .find(candidate => getPropertyName(candidate) === name);
        return getMismatches({
            expected: property,
            actual: actualProperty,
            node: propertyNode ? propertyNode.value : node,
            path: [...path, name]
        });
    });
};

/* eslint-disable resilient/prefer-destructured-member-access -- Contract diagnostics inspect ESTree nodes and inferred contract records by design. */
const hasProperty = ({ value = {}, name = '' } = {}) => (
    Object.hasOwn(value.properties || {}, name) ||
    Object.hasOwn(value.residual && value.residual.properties || {}, name)
);

const hasOpenResidual = (value = {}) => Boolean(value.residual && value.residual.open);

const getShapeMismatches = ({ expected = unknown(), actual = unknown(), node = {}, path = [] } = {}) => {
    if (expected.state === 'contradictory') return getContractVariants(expected).flatMap(expectedVariant => (
        getShapeMismatches({ expected: expectedVariant, actual, node, path })
    ));
    if (actual.state === 'contradictory') return getContractVariants(actual).flatMap(actualVariant => (
        getShapeMismatches({ expected, actual: actualVariant, node, path })
    ));
    if (expected.kind !== 'object' || actual.kind !== 'object') return [];

    const expectedProperties = expected.properties || {};
    const actualProperties = actual.properties || {};

    const nested = Object.entries(expectedProperties).flatMap(([name = '', property = {}] = []) => {
        const actualProperty = actualProperties[name] || (
            actual.residual && actual.residual.properties || {}
        )[name] || unknown();
        return getShapeMismatches({
            expected: property,
            actual: actualProperty,
            node,
            path: [...path, name]
        });
    });

    const exactLiteral = node.type === 'ObjectExpression' &&
        !(node.properties || []).some(({ type = '' } = {}) => type === 'SpreadElement');
    const excess = !expected.residual && exactLiteral
        ? Object.keys(actualProperties)
            .filter(name => !Object.hasOwn(expectedProperties, name))
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
    const sourcePattern = pattern.type === 'AssignmentPattern'
        ? pattern.left || {}
        : pattern;
    if (sourcePattern.type !== 'ObjectPattern' || actual.kind !== 'object') return [];

    const actualProperties = actual.properties || {};
    const residualProperties = actual.residual && actual.residual.properties || {};
    const openResidual = hasOpenResidual(actual);

    return (sourcePattern.properties || []).flatMap(({
        type = '',
        key = {},
        computed = false,
        value = {}
    } = {}) => {
        if (type === 'RestElement' || computed) return [];

        const name = getPropertyName({ key, computed });
        if (!name) return [];

        const hasKnownProperty = Object.hasOwn(actualProperties, name) ||
            Object.hasOwn(residualProperties, name);
        const hasDefault = value.type === 'AssignmentPattern';
        if (!hasKnownProperty && (hasDefault || openResidual)) return [];
        if (!hasKnownProperty) return [{
            kind: 'missing-property',
            propertyName: name,
            node: key,
            path: [...path, name]
        }];

        const actualProperty = Object.hasOwn(actualProperties, name)
            ? actualProperties[name]
            : residualProperties[name];
        return getMissingDestructuredProperties({
            pattern: value,
            actual: actualProperty,
            path: [...path, name]
        });
    });
};

const getArityDiagnostics = ({ node = {}, definition = {} } = {}) => {
    const { signature = {} } = definition;
    const { parameters = [], restIndex = -1 } = signature;
    const args = node.arguments || [];
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
/* eslint-enable resilient/prefer-destructured-member-access */

const getObject = value => (
    value && typeof value === 'object' ? value : {}
);

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
    return (
        (type === 'Property' && computed) ||
        (safeLeft.type && hasComputedProperty(safeLeft)) ||
        (safeArgument.type && hasComputedProperty(safeArgument)) ||
        getList(properties).some(property => hasComputedProperty(property)) ||
        getList(elements).some(element => hasComputedProperty(element))
    );
};

const getSignatureParameters = ({ signature = {} } = {}) => {
    const { parameters = [], contract = unknown(), restIndex = -1 } = signature;
    if (restIndex === 0) return [];
    if (restIndex > 0) return parameters.slice(0, restIndex);
    return parameters.length ? parameters : [contract];
};

const getDefinitionsForProgram = ({ program = {}, definitions = {} } = {}) => (
    Object.keys(definitions).length ? definitions : getDefinitions(program)
);

const getFunctionDefinition = ({ value = {} } = {}) => {
    if (value.kind !== 'function' || !value.signature) return {};
    return {
        node: value.sourceNode,
        signature: value.signature,
        returnContract: value.signature.returnContract || unknown()
    };
};

const getMemberFunctionDefinition = ({ callee = {}, context = {} } = {}) => {
    const { object = {}, property = {}, computed = false } = callee;
    const method = getPropertyName({ key: property, computed });
    if (!method) return {};
    const receiver = inferExpression(object, context);
    const { properties = {}, residual = null } = receiver;
    const residualProperties = residual && residual.properties || {};
    return getFunctionDefinition({
        value: properties[method] || residualProperties[method] || {}
    });
};


const getTopLevelFunctionAliases = ({ program = {}, definitions = {} } = {}) => {
    let aliases = { ...definitions };
    walk(program, ({ type = '', id = {}, init = {} } = {}) => {
        const safeId = id || {};
        const safeInit = init || {};
        const { type: idType = '', name = '' } = safeId;
        if (type !== 'VariableDeclarator' || idType !== 'Identifier') return;
        const functionDefinition = aliases[safeInit.name] || {};
        if (safeInit.type === 'Identifier' && functionDefinition.signature) {
            aliases = { ...aliases, [name]: functionDefinition };
        }
    }, { skipFunctions: true });
    return aliases;
};

const getCallbackCalls = ({ node = {}, callbackNames = [] } = {}) => {
    let calls = [];
    walk(node.body, (current = {}) => {
        const {
            type = '',
            callee = {},
            arguments: args = []
        } = current;
        if (type !== 'CallExpression' || callee.type !== 'Identifier') return;
        if (callbackNames.includes(callee.name)) calls = [...calls, { callee, args, node: current }];
    }, { skipFunctions: true });
    return calls;
};

const getArrayCallbackDefinition = ({ callback = {}, context = {} } = {}) => {
    if (isFunction(callback)) return { node: callback, signature: getSignature(callback) };
    const { type = '', name = '' } = callback;
    if (type !== 'Identifier') return {};
    return context.functions[name] || {};
};

const getArrayCallbackOperationContexts = ({
    program = {},
    definitions = {},
    flows = new Map()
} = {}) => {
    const contexts = new Map();
    walk(program, (node = {}) => {
        const { type = '', callee = {}, arguments: args = [] } = node;
        if (type !== 'CallExpression' || callee.type !== 'MemberExpression') return;
        const { object = {}, property = {}, computed = false } = callee;
        const method = !computed && property.type === 'Identifier' ? property.name : '';
        if (!['map', 'filter', 'some', 'find', 'forEach', 'reduce'].includes(method)) return;
        const callContext = getFlowContext({ node, definitions, flows });
        const receiver = inferExpression(object, callContext);
        if (getKind(receiver) !== 'array') return;
        const callback = args[0] || {};
        const definition = getArrayCallbackDefinition({ callback, context: callContext });
        const { node: definitionNode = {} } = definition;
        if (!definitionNode.type) return;
        const callbackContext = getFunctionCallContext({
            definition,
            functions: callContext.functions || definitions,
            argumentContracts: method === 'reduce'
                ? [
                    inferExpression(args[1] || {}, callContext),
                    receiver.element,
                    contract({ kind: 'number' }),
                    receiver
                ]
                : [
                    receiver.element,
                    contract({ kind: 'number' }),
                    receiver
                ],
            callStack: callContext.callStack || [],
            evaluateCalls: callContext.evaluateCalls !== false,
            evaluationDepth: callContext.evaluationDepth || 0
        });
        const callbackFlow = createFunctionFlow({
            functionNode: definitionNode,
            definitions: callContext.functions || definitions,
            initialBindings: callbackContext.bindings
        });
        walk(definitionNode.body, (callbackNode = {}) => {
            const callbackType = getNodeType(callbackNode);
            if (callbackType !== 'MemberExpression') return;
            const callbackContext = callbackFlow.contexts.get(callbackNode) || callbackFlow.finalContext;
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
    const { callee = {}, arguments: args = [] } = node;
    const { object = {}, property = {}, computed = false } = callee;
    const method = !computed && property.type === 'Identifier' ? property.name : '';
    if (!['map', 'filter', 'some', 'find', 'forEach', 'reduce'].includes(method)) return [];
    const receiver = inferExpression(object, context);
    if (getKind(receiver) !== 'array') return [];
    const callback = args[0] || {};
    const definition = getArrayCallbackDefinition({ callback, context });
    const { signature = {} } = definition;
    const { parameters = [] } = signature;
    const parameterIndex = method === 'reduce' ? 1 : 0;
    const expected = parameters[parameterIndex] || unknown();
    if (!isKnown(expected)) return [];
    return getMismatches({
        expected,
        actual: receiver.element,
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
    node = {},
    definition = {},
    context = {}
} = {}) => {
    const { node: functionNode = {} } = definition;
    const callbackParameters = (functionNode.params || [])
        .map((parameter, index = 0) => ({ parameter, index }))
        .filter(({ parameter = {} } = {}) => parameter.type === 'Identifier')
        .map(({ parameter = {}, index = 0 } = {}) => ({ name: parameter.name, index }));
    const callbackNames = callbackParameters.map(({ name = '' } = {}) => name);
    if (!callbackNames.length) return [];

    const callbackContext = getFunctionCallContext({
        definition,
        functions: context.functions || {},
        arguments: node.arguments || [],
        argumentContext: context,
        callStack: context.callStack || [],
        evaluateCalls: false
    });
    return getCallbackCalls({ node: functionNode, callbackNames }).flatMap(({
        callee = {},
        args = [],
        node: callbackCall = {}
    } = {}) => {
        const callbackDefinition = callbackContext.functions[callee.name] || {};
        if (!callbackDefinition.signature) return [];
        const callbackParameter = callbackParameters
            .find(({ name = '' } = {}) => name === callee.name) || {};
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
            if (!argument || argument.type === 'SpreadElement') return [];
            const actual = inferExpression(argument, callbackContext);
            const callbackPath = [callee.name, ...(index ? [`argument[${index}]`] : [])];
            return getMismatches({
                expected,
                actual,
                node: node.arguments[callbackIndex] || argument,
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
        const { type = '' } = node;
        if (type !== 'CallExpression') return;
        const { callee = {}, arguments: args = [] } = node;
        const context = getFlowContext({ node, definitions: sourceDefinitions, flows });
        if (callee.type === 'MemberExpression') {
            diagnostics = [...diagnostics, ...getArrayCallbackDiagnostics({ node, context })];
        }
        const callableDefinitions = context.functions || sourceDefinitions;
        const definition = callee.type === 'Identifier'
            ? callableDefinitions[callee.name] || getFunctionDefinition({
                value: inferExpression(callee, context)
            })
            : getMemberFunctionDefinition({ callee, context });
        if (!definition.signature) return;

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
            if (!argument || argument.type === 'SpreadElement') return;

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

/* eslint-disable resilient/prefer-destructured-member-access -- This rule's implementation must inspect the object contract it enforces. */
const getPropertyDiagnostics = ({ program = {}, definitions = {}, flows = new Map() } = {}) => {
    const sourceDefinitions = getTopLevelFunctionAliases({
        program,
        definitions: getDefinitionsForProgram({ program, definitions })
    });
    const sourceFlows = flows.size
        ? flows
        : createFunctionFlows({ program, definitions: sourceDefinitions });
    let diagnostics = [];
    walk(program, (node = {}) => {
        if (node.type !== 'MemberExpression' || node.computed || node.property.type !== 'Identifier') return;
        const propertyName = node.property.name || '';
        if (OBJECT_PROPERTIES.has(propertyName)) return;
        const context = getFlowContext({ node, definitions: sourceDefinitions, flows: sourceFlows });
        const receiver = inferExpression(node.object, context);
        if (receiver.kind !== 'object' || hasOpenResidual(receiver)) return;
        const expectedKind = getOperationExpectation({
            kind: receiver.kind,
            method: propertyName
        });
        if (expectedKind && expectedKind !== receiver.kind) return;
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
/* eslint-enable resilient/prefer-destructured-member-access */

const getOperationDiagnostics = ({ program = {}, definitions = {}, flows = new Map() } = {}) => {
    const sourceDefinitions = getTopLevelFunctionAliases({
        program,
        definitions: getDefinitionsForProgram({ program, definitions })
    });
    const sourceFlows = flows.size
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
    const sourceFlows = flows.size
        ? flows
        : createFunctionFlows({ program, definitions: sourceDefinitions });
    let diagnostics = [];
    walk(program, (node = {}) => {
        const { type = '', id = {}, init = {} } = node;
        if (type !== 'VariableDeclarator') return;
        const expected = inferPattern(id);
        if (!['array', 'object'].includes(expected.kind)) return;
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
