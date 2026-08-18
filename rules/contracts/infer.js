import {
    contract,
    getKind,
    mergeContracts,
    unknown,
    withOptional
} from './model.js';

const FUNCTION_TYPES = ['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression'];
const expressionHandlers = {};

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

const walk = (node = {}, visitor = () => {}, { skipFunctions = false } = {}) => {
    if (!isAstNode({ value: node })) return;
    visitor(node);
    const stopAtFunction = skipFunctions && isFunction(node);
    if (stopAtFunction) return;
    getChildren(node).forEach(child => walk(child, visitor, { skipFunctions }));
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
    const { bindings = {} } = context;
    const sourceNode = { type, name, right, ...rest };

    if (type === 'Identifier') return bindings[name] || unknown(sourceNode);
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
    return contract({
        kind: 'array',
        sourceNode,
        element: mergeContracts(elements.map((element = {}) => inferExpression(element, context)))
    });
};

const addObjectProperty = ({ property = {}, context = {}, properties = {} } = {}) => {
    const { key = {}, value = {}, computed = false } = property;
    const name = getPropertyName({ key, computed });
    if (!name) return;
    properties[name] = inferExpression(value, context);
};

const addObjectSpread = ({ property = {}, context = {}, properties = {}, branches = [] } = {}) => {
    const { argument = {} } = property;
    const { type = '', operator = '', left = {}, right = {} } = argument;
    if (type === 'LogicalExpression' && operator === '&&') {
        branches.push({
            condition: left,
            shape: inferExpression(right, context)
        });
        return;
    }

    const spread = inferExpression(argument, context);
    Object.assign(properties, spread.properties || {});
};

const inferObjectExpression = ({ properties: sourceProperties = [], ...node } = {}, context = {}) => {
    const sourceNode = { properties: sourceProperties, ...node };
    const properties = {};
    const branches = [];

    sourceProperties.forEach((property = {}) => {
        const { type = '' } = property;
        if (type === 'Property') {
            addObjectProperty({ property, context, properties });
            return;
        }
        if (type === 'SpreadElement') addObjectSpread({ property, context, properties, branches });
    });

    return contract({
        kind: 'object',
        sourceNode,
        properties,
        branches
    });
};

const getFunctionReturnContract = ({ functions = {}, name = '', sourceNode = {} } = {}) => {
    const { [name]: functionContract = {} } = functions;
    if (!functionContract.returnContract) return unknown(sourceNode);
    return functionContract.returnContract;
};

const inferMemberCall = ({ callee = {}, ...node } = {}, context = {}) => {
    const sourceNode = { callee, ...node };
    const { object = {}, property = {}, computed = false } = callee;
    const method = computed ? '' : getStaticName(property);
    const receiver = inferExpression(object, context);
    const { type: objectType = '', name: objectName = '' } = getObject(object);

    if (objectType === 'Identifier' && objectName === 'Object' && ['entries', 'keys', 'values'].includes(method)) {
        return contract({ kind: 'array', sourceNode });
    }

    if (['map', 'filter'].includes(method) && getKind(receiver) === 'array') {
        return contract({ kind: 'array', sourceNode });
    }
    if (method === 'some') return contract({ kind: 'boolean', sourceNode });
    if (['trim', 'toLowerCase', 'toUpperCase', 'replaceAll'].includes(method)) {
        return contract({ kind: 'string', sourceNode });
    }
    return unknown(sourceNode);
};

const inferCallExpression = ({ callee = {}, ...node } = {}, context = {}) => {
    const { functions = {} } = context;
    const safeCallee = getObject(callee);
    const { type = '', name = '' } = safeCallee;
    const sourceNode = { callee, ...node };
    if (type === 'Identifier') return getFunctionReturnContract({ functions, name, sourceNode });
    if (type === 'MemberExpression') return inferMemberCall(sourceNode, context);
    return unknown(sourceNode);
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
    if (operator === '&&') return inferExpression(right, context);
    return unknown({ operator, right, ...node });
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

Object.assign(expressionHandlers, {
    ArrayExpression: inferArrayExpression,
    BinaryExpression: inferBinaryExpression,
    CallExpression: inferCallExpression,
    ConditionalExpression: inferConditionalExpression,
    LogicalExpression: inferLogicalExpression,
    Literal: inferLiteral,
    MemberExpression: inferMemberExpression,
    ObjectExpression: inferObjectExpression,
    UnaryExpression: inferUnaryExpression
});

const inferPattern = ({ type = '', left = {}, right = {}, properties: sourceProperties = [], ...node } = {}, { type: defaultType = '', ...defaultNode } = {}, context = {}) => {
    const sourceNode = { type, left, right, properties: sourceProperties, ...node };
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
            .filter(([name = ''] = []) => Boolean(name)));
        return contract({ kind: 'object', sourceNode, properties });
    }
    if (type === 'ArrayPattern') return contract({ kind: 'array', sourceNode });
    if (defaultType) return inferExpression({ type: defaultType, ...defaultNode }, context);
    return unknown(sourceNode);
};

const bindPattern = ({ type = '', left = {}, name = '', properties = [] } = {}, valueContract = unknown(), bindings = {}) => {
    const { properties: valueProperties = {} } = valueContract;
    if (type === 'AssignmentPattern') {
        bindPattern(left, valueContract, bindings);
        return;
    }
    if (type === 'Identifier') {
        bindings[name] = valueContract;
        return;
    }
    if (type !== 'ObjectPattern') return;
    properties
        .filter(({ type: propertyType = '' } = {}) => propertyType === 'Property')
        .forEach(({ key = {}, computed = false, value = {} } = {}) => {
            const name = getPropertyName({ key, computed });
            if (!name) return;
            const propertyContract = valueProperties[name] || unknown(value);
            bindPattern(value, propertyContract, bindings);
        });
};

const getFunctionName = ({ id = {}, parent = {} } = {}) => {
    const { type = '', name = '' } = getObject(id);
    if (type === 'Identifier') return name;
    const safeParent = getObject(parent);
    const { type: parentType = '', id: parentId = {} } = safeParent;
    const { type: parentIdType = '', name: parentIdName = '' } = getObject(parentId);
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
    const [firstParam = {}] = params;
    const rootContract = inferPattern(firstParam);
    const bindings = {};
    bindPattern(firstParam, rootContract, bindings);
    return {
        contract: rootContract,
        bindings
    };
};

const getFunctionNodes = (program = {}) => {
    const functions = [];
    walk(program, (node) => {
        if (isFunction(node)) functions.push(node);
    });
    return functions;
};

const getReturnNodes = ({ body = {} } = {}) => {
    if (body.type !== 'BlockStatement') return [{ argument: body }];
    const returns = [];
    walk(body, ({ type = '', ...current } = {}) => {
        if (type === 'ReturnStatement') returns.push({ type, ...current });
    }, { skipFunctions: true });
    return returns;
};

const getFunctionContext = ({ body = {}, ...node } = {}, functions = {}) => {
    const sourceNode = { body, ...node };
    const signature = getSignature(sourceNode);
    const context = {
        bindings: { ...signature.bindings },
        functions
    };
    walk(body, ({ type = '', id = {}, init = {} } = {}) => {
        const { type: idType = '', name = '' } = getObject(id);
        if (type !== 'VariableDeclarator' || idType !== 'Identifier') return;
        context.bindings[name] = inferExpression(init, context);
    }, { skipFunctions: true });

    return context;
};

const getDefinitions = (program = {}) => {
    const definitions = {};
    getFunctionNodes(program)
        .map(node => ({ node, name: getFunctionName(node) }))
        .filter(({ name = '' } = {}) => Boolean(name))
        .forEach(({ node = {}, name = '' } = {}) => {
            definitions[name] = {
                node,
                signature: getSignature(node),
                returnContract: unknown()
            };
        });

    Object.entries(definitions).forEach(([name = '', definition = {}] = []) => {
        const { node = {} } = definition;
        const context = getFunctionContext(node, definitions);
        const returnContract = mergeContracts(getReturnNodes(node)
            .map(({ argument = {} } = {}) => inferExpression(argument, context)));
        definitions[name] = { ...definition, context, returnContract };
    });

    return definitions;
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
