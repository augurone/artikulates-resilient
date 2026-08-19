import {
    createFunctionFlows,
    getFlowContext
} from './flow.js';
import {
    getDefinitions,
    getOperationExpectation,
    getPropertyName,
    inferExpression,
    inferPattern,
    walk
} from './infer.js';
import {
    describe,
    getKind,
    isCompatible,
    isKnown,
    unknown
} from './model.js';

const getMethodName = ({ property = {}, computed = false } = {}) => (
    !computed && property.type === 'Identifier' ? property.name : ''
);

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

const getMismatches = ({ expected = unknown(), actual = unknown(), node = {}, path = [] } = {}) => {
    if (expected.kind === 'unknown' || actual.kind === 'unknown') return [];
    if (expected.kind !== actual.kind) return [{ expected, actual, node, path }];
    if (expected.kind === 'array') return getMismatches({
        expected: expected.element,
        actual: actual.element,
        node,
        path: [...path, '[]']
    });
    if (expected.kind !== 'object') return [];

    return Object.entries(expected.properties || {}).flatMap(([name = '', property = {}] = []) => {
        const { properties: actualProperties = {} } = actual;
        const { properties: sourceProperties = [] } = node;
        const actualProperty = actualProperties[name] || unknown();
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

const hasComputedProperty = ({ properties = [] } = {}) => properties
    .some(({ computed = false } = {}) => computed);

const getDefinitionsForProgram = ({ program = {}, definitions = {} } = {}) => (
    Object.keys(definitions).length ? definitions : getDefinitions(program)
);

const getCallSiteDiagnostics = ({ program = {}, definitions = {} } = {}) => {
    const sourceDefinitions = getDefinitionsForProgram({ program, definitions });
    const diagnostics = [];
    walk(program, (node = {}) => {
        const { type = '' } = node;
        if (type !== 'CallExpression') return;
        const { callee = {}, arguments: args = [] } = node;
        if (callee.type !== 'Identifier') return;
        const definition = sourceDefinitions[callee.name] || {};
        const [argument = {}] = args;
        if (!definition.signature || argument.type !== 'ObjectExpression') return;

        const { signature: { contract: expected = unknown() } = {} } = definition;
        const actual = inferExpression(argument, { functions: sourceDefinitions });
        if (isCompatible({ expected, actual })) return;

        getMismatches({ expected, actual, node: argument }).forEach(({
            expected: expectedContract = unknown(),
            actual: actualContract = unknown(),
            node: reportNode = {},
            path = []
        } = {}) => {
            diagnostics.push({
                ruleId: 'signature-contract-call-site',
                messageId: 'mismatch',
                message: `${path.join('.') || 'argument'} expects ${describe(expectedContract)}, but this call supplies ${describe(actualContract)}.`,
                data: {
                    path: path.join('.') || 'argument',
                    expected: describe(expectedContract),
                    actual: describe(actualContract)
                },
                node: reportNode
            });
        });
    });
    return diagnostics;
};

const getOperationDiagnostics = ({ program = {}, definitions = {}, flows = new Map() } = {}) => {
    const sourceDefinitions = getDefinitionsForProgram({ program, definitions });
    const sourceFlows = flows.size
        ? flows
        : createFunctionFlows({ program, definitions: sourceDefinitions });
    const diagnostics = [];
    walk(program, (node = {}) => {
        const { type = '' } = node;
        if (type !== 'MemberExpression') return;
        const { object = {} } = node;
        const method = getMethodName(node);
        if (!method) return;
        const context = getFlowContext({ node, definitions: sourceDefinitions, flows: sourceFlows });
        const receiver = inferExpression(object, context);
        if (!isKnown(receiver)) return;

        const expected = getOperationExpectation({
            kind: getKind(receiver),
            method
        });
        if (!expected || expected === getKind(receiver)) return;

        diagnostics.push({
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
        });
    });
    return diagnostics;
};

const getDestructuringDiagnostics = ({ program = {}, definitions = {}, flows = new Map() } = {}) => {
    const sourceDefinitions = getDefinitionsForProgram({ program, definitions });
    const sourceFlows = flows.size
        ? flows
        : createFunctionFlows({ program, definitions: sourceDefinitions });
    const diagnostics = [];
    walk(program, (node = {}) => {
        const { type = '', id = {}, init = {} } = node;
        if (type !== 'VariableDeclarator') return;
        const expected = inferPattern(id);
        if (!['array', 'object'].includes(expected.kind)) return;
        if (expected.kind === 'object' && hasComputedProperty(id)) return;
        const context = getFlowContext({ node: init, definitions: sourceDefinitions, flows: sourceFlows });
        const actual = inferExpression(init, context);
        if (!isKnown(actual) || actual.kind === expected.kind) return;

        diagnostics.push({
            ruleId: 'signature-contract-destructuring',
            messageId: 'mismatch',
            message: `This ${describe(actual)} value is destructured as ${describe(expected)}.`,
            data: {
                actual: describe(actual),
                expected: describe(expected)
            },
            node: init
        });
    });
    return diagnostics;
};

const getContractDiagnostics = ({ program = {}, definitions = {}, flows = new Map() } = {}) => [
    ...getCallSiteDiagnostics({ program, definitions }),
    ...getOperationDiagnostics({ program, definitions, flows }),
    ...getDestructuringDiagnostics({ program, definitions, flows })
];

export {
    getCallSiteDiagnostics,
    getContractDiagnostics,
    getDestructuringDiagnostics,
    getOperationDiagnostics,
    getMismatches
};
