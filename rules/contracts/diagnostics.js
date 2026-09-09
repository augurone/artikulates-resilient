import {
    createFunctionFlow,
    createFunctionFlows,
    getFlowContext,
    narrowContext
} from './flow.js';
import {
    copyDefinitionMetadata,
    getChildren,
    getDefinitions,
    getDefinitionForReference,
    getDefinitionMetadata,
    getFunctionCallContext,
    getOperationExpectation,
    getPropertyName,
    getSignature,
    inferExpression,
    inferPattern,
    isFunction,
    walk
} from './infer.js';
import { getCallableEvidence } from './member-evidence.js';
import {
    contract,
    describe,
    getContractVariants,
    getKind,
    isCompatible,
    isKnown,
    unknown
} from './model.js';
import { hasAnalysisAccessors } from './reference-variants.js';
import { getObject, hasObjectValue } from '../support/object.js';

const getMethodName = ({ property = {}, computed = false } = {}) => {
    const { type = '', name = '' } = getObject(property);

    return !computed && type === 'Identifier' ? name : '';
};

const getNamespaceImportNames = (program = {}, visit = walk) => {
    let names = [];

    visit(program, ({ type = '', specifiers = [] } = {}) => {
        if (type !== 'ImportDeclaration') return;

        const namespaceNames = specifiers.flatMap(({ type: specifierType = '', local = {} } = {}) => {
            const { name = '' } = getObject(local);

            return specifierType === 'ImportNamespaceSpecifier' && name ? [name] : [];
        });

        names = [...names, ...namespaceNames];
    });

    return new Set(names);
};

const isNamespaceReceiver = ({ node = {}, namespaceNames = new Set(), bindingIndex = {} } = {}) => {
    const { type = '', name = '' } = getObject(node);

    if (type !== 'Identifier') return false;

    const { getBinding = false } = getObject(bindingIndex);
    const binding = typeof getBinding === 'function'
        ? getBinding(node)
        : {};

    const { kind = '' } = getObject(binding);

    return hasObjectValue(binding) ? kind === 'import-namespace' : namespaceNames.has(name);
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

const getCalleeLabel = ({ callee = {} } = {}) => {
    const label = getReceiverName({ object: callee });

    return label === 'value' ? '' : label;
};

const getParameterName = (node = {}) => {
    const {
        type = '',
        name = '',
        left = {}
    } = getObject(node);

    if (type === 'Identifier') return name;

    if (type === 'AssignmentPattern') return getParameterName(left);

    return '';
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

// A native signature can keep observable length while handling shorter calls
// explicitly. Only a first, side-effect-free arguments.length dispatch can
// establish that the particular supplied count has its own normal exit.
const handlesArgumentCount = ({ definition = {}, count = 0 } = {}) => {
    const { node = {} } = getObject(definition);
    const { type: functionType = '', id: functionName = {}, params = [], body = {} } = getObject(node);
    const { type: bodyType = '', body: statements = [] } = getObject(body);

    if (!['FunctionDeclaration', 'FunctionExpression'].includes(functionType) ||
        bodyType !== 'BlockStatement' || !Array.isArray(params) || !Array.isArray(statements)) return false;

    const names = params.map(({ type = '', name = '' } = {}) => type === 'Identifier' ? name : '');

    if (getObject(functionName).name === 'arguments' ||
        names.some(name => !name || name === 'arguments') || new Set(names).size !== names.length) return false;

    let shadowsArguments = false;
    walk(body, ({ type = '', id = {} } = {}) => {
        if (!['VariableDeclarator', 'FunctionDeclaration', 'ClassDeclaration'].includes(type)) return;

        walk(id, ({ type: bindingType = '', name = '' } = {}) => {
            if (bindingType === 'Identifier' && name === 'arguments') shadowsArguments = true;
        });
    }, { skipFunctions: true });

    if (shadowsArguments) return false;

    const [dispatch = {}] = statements.filter(({ directive = '' } = {}) => !directive);
    const { type = '', discriminant = {}, cases = [] } = getObject(dispatch);
    const { type: selectorType = '', object = {}, property = {}, computed = false } = getObject(discriminant);
    const { type: objectType = '', name: objectName = '' } = getObject(object);
    const { type: propertyType = '', name: propertyName = '' } = getObject(property);

    if (type !== 'SwitchStatement' || selectorType !== 'MemberExpression' || computed ||
        objectType !== 'Identifier' || objectName !== 'arguments' ||
        propertyType !== 'Identifier' || propertyName !== 'length' || !Array.isArray(cases)) return false;

    const explicitCases = cases.filter(({ test = null } = {}) => Boolean(test));
    const hasOnlyNumericCases = explicitCases.every(({ test = {} } = {}) => {
        const { type: testType = '', value = -1 } = getObject(test);

        return testType === 'Literal' && Number.isSafeInteger(value) && value >= 0;
    });

    if (!hasOnlyNumericCases) return false;

    const matching = explicitCases.filter(({ test = {} } = {}) => getObject(test).value === count);

    if (matching.length !== 1) return false;

    const [matchedCase = {}] = matching;
    const { consequent = [] } = getObject(matchedCase);
    const [exit = {}] = consequent;

    if (!Array.isArray(consequent) || consequent.length !== 1 || getObject(exit).type !== 'ReturnStatement') return false;

    const absentNames = new Set(names.slice(count));
    const readsMissingInput = (value = {}, ownsArguments = true) => {
        const { type: nodeType = '', name = '', callee = {} } = getObject(value);

        if (nodeType === 'Identifier' && (absentNames.has(name) || ownsArguments && name === 'arguments')) return true;

        if (nodeType === 'CallExpression' && getObject(callee).name === 'eval') return true;

        const nestedOwnsArguments = ownsArguments && !['FunctionDeclaration', 'FunctionExpression'].includes(nodeType);

        return getChildren(value).some(child => readsMissingInput(child, nestedOwnsArguments));
    };

    return !readsMissingInput(exit);
};

const getArityDiagnostics = ({ node = {}, definition = {} } = {}) => {
    const { signature = {} } = getObject(definition);
    const { parameters: sourceParameters = [], restIndex = -1 } = getObject(signature);
    const { arguments: sourceArguments = [], callee = {} } = getObject(node);
    const parameters = Array.isArray(sourceParameters) ? sourceParameters : [];
    const args = Array.isArray(sourceArguments) ? sourceArguments : [];

    if (args.some(({ type = '' } = {}) => type === 'SpreadElement')) return [];

    const requiredIndexes = parameters
        .map(({ optional = false } = {}, index = 0) => index !== restIndex && !optional ? index : -1)
        .filter(index => index >= 0);
    const requiredCount = requiredIndexes.length ? Math.max(...requiredIndexes) + 1 : 0;
    const maximumCount = restIndex === -1 ? parameters.length : Number.MAX_SAFE_INTEGER;
    const calleeLabel = getCalleeLabel({ callee });
    const missingIndex = requiredIndexes.find(index => index >= args.length);
    const { [missingIndex]: missingParameter = {} } = parameters;
    const parameterName = getParameterName(getObject(missingParameter).sourceNode);
    const functionLabel = calleeLabel || 'This function';
    const signatureLabel = calleeLabel ? `the ${calleeLabel} signature` : 'its signature';

    if (args.length < requiredCount && !handlesArgumentCount({ definition, count: args.length })) return [{
        kind: 'arity',
        node,
        message: parameterName
            ? `${functionLabel} requires ${parameterName}; provide the argument or add a default to ${signatureLabel}.`
            : `${functionLabel} requires at least ${requiredCount} argument${requiredCount === 1 ? '' : 's'}, `
                + `but got ${args.length}; provide the missing argument or add a default to ${signatureLabel}.`
    }];

    if (args.length > maximumCount) return [{
        kind: 'arity',
        node,
        message: `${functionLabel} accepts at most ${maximumCount} argument${maximumCount === 1 ? '' : 's'}, but got ${args.length}.`
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

const getDefinitionsForProgram = ({ program = {}, definitions = {} } = {}) => {
    if (Object.keys(definitions).length) return definitions;

    const metadata = getDefinitionMetadata(definitions);

    const { bindingIndex = {} } = metadata;

    return Object.hasOwn(metadata, 'bindingIndex') && bindingIndex === false
        ? getDefinitions(program, {}, { bindingIndex: false })
        : getDefinitions(program);
};

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

const getTopLevelFunctionAliases = ({ program = {}, definitions = {}, visit = walk } = {}) => {
    let aliases = copyDefinitionMetadata({ source: definitions, target: { ...definitions } });
    visit(program, ({ type = '', id = {}, init = {} } = {}) => {
        const safeId = getObject(id);
        const safeInit = getObject(init);
        const { type: idType = '', name = '' } = safeId;
        const { type: initType = '', name: initName = '' } = safeInit;

        if (type !== 'VariableDeclarator' || idType !== 'Identifier') return;

        const { [initName]: functionDefinition = {} } = aliases;
        const { signature = {} } = getObject(functionDefinition);

        if (initType === 'Identifier' && hasObjectValue(signature)) {
            aliases = copyDefinitionMetadata({
                source: aliases,
                target: { ...aliases, [name]: functionDefinition }
            });
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
    // eslint-disable-next-line resilient/signature-contract-call-site -- callback is an AST node at this analysis boundary.
    if (isFunction(callback)) return { node: callback, signature: getSignature(callback, context) };

    const { type = '' } = getObject(callback);

    if (type !== 'Identifier') return {};

    const { functions = {} } = getObject(context);

    return getDefinitionForReference({ definitions: functions, node: callback, context });
};

const getArrayCallbackOperationContexts = ({
    program = {},
    definitions = {},
    flows = new Map(),
    visit = walk
} = {}) => {
    const contexts = new Map();
    visit(program, (node = {}) => {
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

        if (getKind(getObject(receiver)) !== 'array') return;

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

    if (getKind(getObject(receiver)) !== 'array') return [];

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

// One diagnostic query owns aliases and fallback flows. Direct document queries
// remain live over public definitions; the ESLint index owns its completed snapshot.
const createDiagnosticAnalysis = ({ program = {}, definitions = {}, flows = new Map(), visit = walk, completeDefinitions = false } = {}) => {
    const sourceDefinitions = getTopLevelFunctionAliases({
        program,
        definitions: completeDefinitions ? definitions : getDefinitionsForProgram({ program, definitions }),
        visit
    });
    const { bindingIndex = {} } = getDefinitionMetadata(sourceDefinitions);
    let completedFlows;
    let namespaceNames;
    const getFlows = () => {
        if (completedFlows) return completedFlows;

        const { size = 0 } = flows;
        const result = size ? flows : createFunctionFlows({ program, definitions: sourceDefinitions });
        completedFlows = result;

        return result;
    };
    const getNamespaceNames = () => {
        if (namespaceNames) return namespaceNames;

        const result = getNamespaceImportNames(program, visit);
        namespaceNames = result;

        return result;
    };

    return { bindingIndex, definitions: sourceDefinitions, getFlows, getNamespaceNames };
};

const getCallSiteDiagnostics = ({
    program = {}, definitions = {}, flows = new Map(), visit = walk,
    analysis = createDiagnosticAnalysis({ program, definitions, flows, visit })
} = {}) => {
    const { definitions: sourceDefinitions = {} } = analysis;
    let diagnostics = [];
    visit(program, (node = {}) => {
        const { type = '', callee = {}, arguments: sourceArguments = [] } = getObject(node);
        const args = Array.isArray(sourceArguments) ? sourceArguments : [];
        const { type: calleeType = '' } = getObject(callee);

        if (type !== 'CallExpression') return;

        const context = getFlowContext({ node, definitions: sourceDefinitions, flows });

        if (calleeType === 'MemberExpression') {
            diagnostics = [...diagnostics, ...getArrayCallbackDiagnostics({ node, context })];
        }

        const { functions: contextFunctions = {} } = getObject(context);
        const callableDefinitions = hasObjectValue(contextFunctions)
            ? contextFunctions
            : sourceDefinitions;
        const callableDefinition = getDefinitionForReference({
            definitions: callableDefinitions,
            node: callee,
            context
        });
        let definition = getMemberFunctionDefinition({ callee, context });

        if (calleeType === 'Identifier') {
            definition = hasObjectValue(callableDefinition)
                ? callableDefinition
                : getFunctionDefinition({ value: getObject(inferExpression(callee, context)) });
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

const getPropertyDiagnostics = ({
    program = {}, definitions = {}, flows = new Map(), visit = walk,
    analysis = createDiagnosticAnalysis({ program, definitions, flows, visit })
} = {}) => {
    const {
        bindingIndex = {},
        definitions: sourceDefinitions = {},
        getFlows = undefined,
        getNamespaceNames = undefined
    } = analysis;
    const sourceFlows = getFlows();
    const namespaceNames = getNamespaceNames();
    let diagnostics = [];
    visit(program, (node = {}) => {
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

        if (isNamespaceReceiver({ node: sourceObject, namespaceNames, bindingIndex })) return;

        const context = getFlowContext({ node, definitions: sourceDefinitions, flows: sourceFlows });
        const receiver = inferExpression(sourceObject, context);
        const safeReceiver = getObject(receiver);
        const { kind: receiverKind = '' } = safeReceiver;

        if (receiverKind !== 'object' || hasOpenResidual(safeReceiver)) return;

        const expectedKind = getOperationExpectation({
            kind: receiverKind,
            method: propertyName
        });

        if (expectedKind && expectedKind !== receiverKind) return;

        if (hasProperty({ value: safeReceiver, name: propertyName })) return;

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
const getOperationDiagnostics = ({
    program = {}, definitions = {}, flows = new Map(), visit = walk,
    analysis = createDiagnosticAnalysis({ program, definitions, flows, visit })
} = {}) => {
    const {
        bindingIndex = {},
        definitions: sourceDefinitions = {},
        getFlows = undefined,
        getNamespaceNames = undefined
    } = analysis;
    const sourceFlows = getFlows();
    const callbackContexts = getArrayCallbackOperationContexts({
        program,
        definitions: sourceDefinitions,
        flows: sourceFlows,
        visit
    });
    const namespaceNames = getNamespaceNames();
    let diagnostics = [];

    visit(program, (node = {}) => {
        const { type = '' } = node;

        if (type !== 'MemberExpression') return;

        const { object = {} } = node;
        const method = getMethodName(node);

        if (!method) return;

        if (isNamespaceReceiver({ node: object, namespaceNames, bindingIndex })) return;

        const contexts = callbackContexts.get(node) || [];
        const analysisContexts = contexts.length
            ? contexts
            : [getFlowContext({ node, definitions: sourceDefinitions, flows: sourceFlows })];

        analysisContexts.forEach((context = {}) => getExpressionContracts({ node: object, context })
            .flatMap(getContractVariants)
            .filter(isKnown)
            .forEach((receiver = {}) => {
                const {
                    status = 'unknown',
                    expectedKind: expected = '',
                    receiverKind = ''
                } = getCallableEvidence({ callee: node, receiver, context });

                if (status !== 'justified-native' || !expected || expected === receiverKind) return;

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

const getDestructuringDiagnostics = ({
    program = {}, definitions = {}, flows = new Map(), visit = walk,
    analysis = createDiagnosticAnalysis({ program, definitions, flows, visit })
} = {}) => {
    const {
        bindingIndex = {},
        definitions: sourceDefinitions = {},
        getFlows = undefined,
        getNamespaceNames = undefined
    } = analysis;
    const sourceFlows = getFlows();
    const namespaceNames = getNamespaceNames();
    let diagnostics = [];

    visit(program, (node = {}) => {
        const { type = '', id = {}, init = {} } = getObject(node);

        if (type !== 'VariableDeclarator') return;

        if (isNamespaceReceiver({ node: init, namespaceNames, bindingIndex })) return;

        const expected = inferPattern(id);
        const { kind: expectedKind = 'unknown' } = getObject(expected);

        if (!['array', 'object'].includes(expectedKind)) return;

        if (hasComputedProperty(id)) return;

        const context = getFlowContext({ node: init, definitions: sourceDefinitions, flows: sourceFlows });
        const actual = inferExpression(init, context);
        const safeActual = getObject(actual);

        if (!isKnown(safeActual)) return;

        getMismatches({ expected, actual: safeActual, node: init }).forEach(({
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

const getComparableReturnContract = ({ functionNode = {}, contract: returnContract = {} } = {}) => {
    const { async = false } = functionNode;

    if (!async) return returnContract;

    const { kind = '', element = {} } = getObject(returnContract);

    return kind === 'promise' ? element : returnContract;
};

const getInconsistentReturnBranches = ({ functionNode = {}, flows = new Map() } = {}) => {
    const flow = getObject(flows.get(functionNode));
    const { completions = [] } = flow;
    const { body = {} } = getObject(functionNode);
    const branches = completions.flatMap((completion = {}) => {
        const {
            kind = '', argument = {}, value = unknown(argument),
            node: returnNode = {}, resultBranches = []
        } = getObject(completion);
        const { type: argumentType = '' } = getObject(argument);

        if (kind !== 'return' && kind !== 'normal') return [];

        let captured = resultBranches.length
            ? resultBranches
            : [{ node: argumentType ? argument : returnNode, contract: value }];

        if (kind === 'normal') {
            captured = [{ node: body, contract: contract({ kind: 'undefined', sourceNode: body }) }];
        }

        return captured.flatMap(({ node = {}, contract: branchContract = unknown(node) } = {}) => (
            getContractVariants(getComparableReturnContract({ functionNode, contract: branchContract }))
                .map(variant => ({ node, contract: variant }))));
    }).filter(({ contract: branchContract = {} } = {}) => isKnown(branchContract))
        .toSorted((left = {}, right = {}) => {
            const { node: leftNode = {} } = getObject(left);
            const { node: rightNode = {} } = getObject(right);
            const { range: leftRange = [] } = getObject(leftNode);
            const { range: rightRange = [] } = getObject(rightNode);
            const { 0: leftStart = Infinity } = leftRange;
            const { 0: rightStart = Infinity } = rightRange;

            return (leftNode === body ? Infinity : leftStart) - (rightNode === body ? Infinity : rightStart);
        });
    const kinds = [...new Set(branches.map(({ contract: branchContract = {} } = {}) => getKind(branchContract)))];

    if (kinds.length < 2) return [];

    const uniqueBranches = branches.reduce((unique = [], branch = {}) => {
        const { node = {} } = getObject(branch);

        return unique.some(({ node: existingNode = {} } = {}) => existingNode === node)
            ? unique
            : [...unique, branch];
    }, []);

    return uniqueBranches.map(({ node = {}, contract: branchContract = {} } = {}) => ({
        node,
        actual: getKind(branchContract),
        expected: kinds.find(kind => kind !== getKind(branchContract))
    }));
};

const getReturnDiagnostics = ({
    program = {}, definitions = {}, flows = new Map(), functions = [], visit = walk,
    analysis = createDiagnosticAnalysis({ program, definitions, flows, visit })
} = {}) => {
    const { getFlows = undefined } = analysis;
    const sourceFlows = getFlows();
    let diagnostics = [];
    const readFunction = (node = {}) => {
        if (!isFunction(node)) return;

        const inconsistent = getInconsistentReturnBranches({
            // eslint-disable-next-line resilient/signature-contract-call-site -- node is an AST function boundary selected by isFunction.
            functionNode: node,
            flows: sourceFlows
        }).map(({ node: reportNode = {}, actual = '', expected = '' } = {}) => ({
            ruleId: 'signature-contract-return-consistency',
            messageId: 'inconsistent',
            message: `This function returns ${actual}, but another return path produces ${expected}.`,
            data: { actual, expected },
            node: reportNode
        }));

        diagnostics = [...diagnostics, ...inconsistent];
    };

    if (Array.isArray(functions) && functions.length) {
        functions.forEach(readFunction);

        return diagnostics;
    }

    visit(program, readFunction);

    return diagnostics;
};

const getContractDiagnostics = ({
    program = {}, definitions = {}, flows = new Map(), visit = walk,
    includeReturnDiagnostics = true, reuse = false
} = {}) => {
    const readers = [
        getCallSiteDiagnostics,
        getOperationDiagnostics,
        getDestructuringDiagnostics,
        getPropertyDiagnostics,
        ...(includeReturnDiagnostics ? [getReturnDiagnostics] : [])
    ];
    const input = { program, definitions, flows, visit };

    // Standalone calls and accessor-backed environments retain each family's
    // native read/failure phase. A completed plain session shares private setup.
    if (!reuse || hasAnalysisAccessors(definitions)) return readers.flatMap(read => read(input));

    const analysis = createDiagnosticAnalysis({ ...input, completeDefinitions: true });

    return readers.flatMap(read => read({ ...input, analysis }));
};

export {
    getCallSiteDiagnostics,
    getContractDiagnostics,
    getDestructuringDiagnostics,
    getArityDiagnostics,
    getOperationDiagnostics,
    getMismatches,
    getPropertyDiagnostics,
    getReturnDiagnostics,
    getShapeMismatches,
    hasComputedProperty
};
