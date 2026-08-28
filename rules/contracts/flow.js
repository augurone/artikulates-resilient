import {
    getChildren,
    getEnclosingFunction,
    getFunctionAlias,
    getFunctionNodes,
    getPropertyName,
    getSignature,
    inferExpression,
    isFunction
} from './infer.js';
import {
    contract,
    getKind,
    mergeContracts,
    unknown
} from './model.js';

const getObject = value => value && typeof value === 'object' ? value : {};

const copyAliases = (aliases = {}) => Object.fromEntries(Object.entries(aliases).map(([name = '', related = []] = []) => [
    name,
    [...related]
]));

const copyContext = ({
    bindings = {},
    functions = {},
    aliases = {},
    callStack = [],
    evaluateCalls = true,
    evaluationDepth = 0
} = {}) => ({
    bindings: { ...bindings },
    functions,
    aliases: copyAliases(aliases),
    callStack: [...callStack],
    evaluateCalls,
    evaluationDepth
});

const getPredicate = ({
    type = '',
    callee = {},
    arguments: args = [],
    operator = '',
    left = {},
    right = {}
} = {}) => {
    const {
        type: calleeType = '',
        object = {},
        property = {},
        computed = false
    } = callee;
    const [{ type: argumentType = '', name: argumentName = '' } = {}] = args;
    const { type: objectType = '', name: objectName = '' } = object;
    const { type: propertyType = '', name: propertyName = '' } = property;

    if (
        type === 'CallExpression' &&
        calleeType === 'MemberExpression' &&
        objectType === 'Identifier' &&
        objectName === 'Array' &&
        propertyType === 'Identifier' &&
        propertyName === 'isArray' &&
        !computed &&
        argumentType === 'Identifier'
    ) {
        return { kind: 'array', name: argumentName };
    }

    const binaryType = type;
    const {
        type: leftType = '',
        operator: leftOperator = '',
        argument: leftArgument = {}
    } = left;
    const { type: rightType = '', value: rightValue = '' } = right;
    const isTypeofPredicate = (
        binaryType === 'BinaryExpression' &&
        ['===', '=='].includes(operator) &&
        leftType === 'UnaryExpression' &&
        leftOperator === 'typeof' &&
        leftArgument.type === 'Identifier' &&
        rightType === 'Literal' &&
        ['string', 'number', 'boolean', 'undefined', 'object'].includes(rightValue)
    );
    if (isTypeofPredicate) return {
        kind: rightValue === 'undefined' ? 'undefined' : rightValue,
        name: leftArgument.name
    };

    const isLiteralPredicate = (
        binaryType === 'BinaryExpression' &&
        ['===', '=='].includes(operator) &&
        leftType === 'Identifier' &&
        rightType === 'Literal'
    );
    if (isLiteralPredicate) return {
        kind: rightValue === null ? 'null' : typeof rightValue,
        name: left.name
    };

    return {};
};

const setBinding = ({ context = {}, name = '', value = unknown() } = {}) => {
    const next = copyContext(context);
    const names = [name, ...(next.aliases[name] || [])];
    return {
        ...next,
        bindings: {
            ...next.bindings,
            ...Object.fromEntries(names.map(currentName => [currentName, value]))
        }
    };
};

const narrowContext = ({
    context = {},
    truthy = true,
    type = '',
    operator = '',
    argument = {},
    left = {},
    right = {},
    ...rest
} = {}) => {
    const test = { ...rest, type, operator, argument, left, right };
    if (type === 'UnaryExpression' && operator === '!') {
        return narrowContext({ context, ...argument, truthy: !truthy });
    }

    if (type === 'LogicalExpression' && operator === '&&' && truthy) {
        const leftContext = narrowContext({ context, ...left, truthy });
        return narrowContext({ context: leftContext, ...right, truthy });
    }

    if (type === 'LogicalExpression') return copyContext(context);

    const { kind = '', name = '' } = getPredicate(test);
    if (!kind || !name) return copyContext(context);

    const current = context.bindings[name] || unknown();
    const currentKind = getKind(current);
    if (truthy) {
        return setBinding({
            context,
            name,
            value: contract({ kind, sourceNode: test })
        });
    }

    return currentKind === kind
        ? setBinding({
            context,
            name,
            value: unknown(current.sourceNode)
        })
        : copyContext(context);
};

const mergeFlowContracts = (values = []) => {
    if (values.some(value => getKind(value) === 'unknown')) return unknown();
    return mergeContracts(values);
};

const mergeContexts = (contexts = []) => {
    const names = [...new Set(contexts.flatMap(({ bindings = {} } = {}) => Object.keys(bindings)))];
    const [first = {}] = contexts;
    const functions = first.functions || {};
    const aliases = Object.fromEntries(Object.entries(first.aliases || {})
        .map(([name = '', related = []] = []) => [
            name,
            related.filter(alias => contexts.every(({ aliases: sourceAliases = {} } = {}) => (
                (sourceAliases[name] || []).includes(alias)
            )))
        ])
        .filter(([, related = []] = []) => related.length));
    const bindings = Object.fromEntries(names.map(name => [
        name,
        mergeFlowContracts(contexts.map(({ bindings: sourceBindings = {} } = {}) => (
            sourceBindings[name] || unknown()
        )))
    ]));
    return {
        aliases,
        bindings,
        functions,
        callStack: [...(first.callStack || [])],
        evaluateCalls: first.evaluateCalls !== false,
        evaluationDepth: first.evaluationDepth || 0
    };
};

const bindPattern = ({ context = {}, pattern = {}, value = unknown() } = {}) => {
    const { type = '', name = '' } = pattern;
    if (type === 'Identifier') {
        const next = copyContext(context);
        return {
            ...next,
            bindings: { ...next.bindings, [name]: value }
        };
    }
    if (type === 'AssignmentPattern') return bindPattern({
        context,
        pattern: pattern.left,
        value
    });
    if (type !== 'ObjectPattern') return copyContext(context);

    const { properties: valueProperties = {} } = value;
    return pattern.properties
        .filter(({ type: propertyType = '' } = {}) => propertyType === 'Property')
        .reduce((current, { key = {}, value: propertyValue = {} } = {}) => {
            const propertyName = key.name || key.value;
            if (!propertyName) return current;
            return bindPattern({
                context: current,
                pattern: propertyValue,
                value: valueProperties[propertyName] || unknown(propertyValue)
            });
        }, copyContext(context));
};

const removeAliases = ({ context = {}, name = '' } = {}) => {
    const next = copyContext(context);
    const names = [name, ...(next.aliases[name] || [])];
    const aliases = Object.fromEntries(Object.entries(next.aliases)
        .filter(([currentName = '']) => !names.includes(currentName))
        .map(([currentName = '', related = []] = []) => [
            currentName,
            related.filter(alias => !names.includes(alias))
        ]));
    return { ...next, aliases };
};

const addAliases = ({ context = {}, name = '', target = '' } = {}) => {
    const next = copyContext(context);
    const group = [...new Set([
        name,
        target,
        ...(next.aliases[name] || []),
        ...(next.aliases[target] || [])
    ])];
    return {
        ...next,
        aliases: {
            ...next.aliases,
            ...Object.fromEntries(group.map(currentName => [
                currentName,
                group.filter(alias => alias !== currentName)
            ]))
        }
    };
};

const bindDeclaration = ({ context = {}, pattern = {}, value = unknown(), init = {} } = {}) => {
    const { type: patternType = '', name = '' } = pattern;
    const unlinked = patternType === 'Identifier'
        ? removeAliases({ context, name })
        : context;
    const bound = bindPattern({ context: unlinked, pattern, value });
    if (patternType !== 'Identifier' || init.type !== 'Identifier') return bound;
    const aliased = addAliases({ context: bound, name, target: init.name });
    const functionAlias = getFunctionAlias({ init, functions: aliased.functions });
    if (!functionAlias.signature) return aliased;
    return {
        ...aliased,
        functions: {
            ...aliased.functions,
            [name]: functionAlias
        }
    };
};

const getMemberPath = ({ type = '', name = '', object = {}, property = {}, computed = false } = {}) => {
    if (type === 'Identifier') return [name];
    if (type !== 'MemberExpression') return [];
    const propertyName = getPropertyName({ key: property, computed });
    if (!propertyName) return [];
    const path = getMemberPath(object);
    return path.length ? [...path, propertyName] : [];
};

const updateContractPath = ({ value = unknown(), path = [], nextValue = unknown(), sourceNode = {} } = {}) => {
    const [name = '', ...rest] = path;
    if (getKind(value) !== 'object' || !name) return value;
    const properties = { ...(value.properties || {}) };
    const current = properties[name] || unknown();
    const updated = rest.length
        ? updateContractPath({ value: current, path: rest, nextValue, sourceNode })
        : nextValue;
    return contract({
        kind: 'object',
        properties: { ...properties, [name]: updated },
        branches: value.branches || [],
        sourceNode: sourceNode || value.sourceNode
    });
};

const assignExpression = ({ context = {}, left = {}, value = unknown() } = {}) => {
    const { type = '' } = left;
    if (type === 'Identifier') return bindDeclaration({ context, pattern: left, value });
    if (type !== 'MemberExpression') return context;
    const path = getMemberPath(left);
    const [rootName = '', ...propertyPath] = path;
    if (!rootName || !propertyPath.length) return context;
    const current = context.bindings[rootName] || unknown();
    const updated = updateContractPath({
        value: current,
        path: propertyPath,
        nextValue: value,
        sourceNode: left
    });
    if (updated === current) return context;
    return setBinding({ context, name: rootName, value: updated });
};

const setExpressionContext = ({ state = {}, node = {}, context = {} } = {}) => {
    // The WeakMap is an internal memoization boundary for AST identity.
    // Its write cannot be expressed as a value transformation without losing identity lookup.
    // eslint-disable-next-line resilient/prefer-safe-transformations
    if (node && typeof node === 'object') state.contexts.set(node, context);
};

const analyzeExpression = ({ state = {}, node = {}, context = {} } = {}) => {
    const source = getObject(node);
    const { type = '' } = source;
    if (!type || isFunction(source)) return context;
    setExpressionContext({ state, node: source, context });

    if (type === 'AssignmentExpression') {
        const rightContext = analyzeExpression({ state, node: source.right, context });
        const value = inferExpression(source.right, rightContext);
        return assignExpression({ context: rightContext, left: source.left, value });
    }

    if (type === 'LogicalExpression' && source.operator === '&&') {
        const leftContext = analyzeExpression({ state, node: source.left, context });
        const rightContext = narrowContext({
            ...source.left,
            context: leftContext,
            truthy: true
        });
        analyzeExpression({ state, node: source.right, context: rightContext });
        return context;
    }

    if (type === 'ConditionalExpression') {
        const testContext = analyzeExpression({ state, node: source.test, context });
        const consequentContext = narrowContext({
            ...source.test,
            context: testContext,
            truthy: true
        });
        const alternateContext = narrowContext({
            ...source.test,
            context: testContext,
            truthy: false
        });
        analyzeExpression({ state, node: source.consequent, context: consequentContext });
        analyzeExpression({ state, node: source.alternate, context: alternateContext });
        return mergeContexts([consequentContext, alternateContext]);
    }

    return getChildren(source)
        .filter(child => !isFunction(child))
        .reduce((current, child) => analyzeExpression({
            state,
            node: child,
            context: current
        }), context);
};

const getLoopElement = ({ type = '', right = {}, context = {} } = {}) => {
    if (type === 'ForInStatement') return contract({ kind: 'string', sourceNode: right });
    if (type !== 'ForOfStatement') return unknown();
    const source = inferExpression(right, context);
    return getKind(source) === 'array' ? source.element : unknown();
};

const analyzer = {
    statement: ({ state = {}, node = {}, context = {} } = {}) => {
        const source = getObject(node);
        const {
            type = '',
            argument = {},
            test = {},
            consequent = {},
            alternate = {},
            declarations = [],
            expression = {},
            body = []
        } = source;
        setExpressionContext({ state, node: source, context });

        if (type === 'BlockStatement') return analyzer.statements({
            state,
            statements: body,
            context
        });

        if (type === 'ReturnStatement') {
            const returnContext = analyzeExpression({
                state,
                node: argument,
                context
            });
            // Return collection is analyzer-owned evidence accumulated across paths.
            // eslint-disable-next-line resilient/prefer-safe-transformations
            state.returns = [...state.returns, {
                argument,
                contract: inferExpression(argument, returnContext),
                node: source
            }];
            return { context: returnContext, reachable: false };
        }

        if (type === 'ThrowStatement') {
            const throwContext = analyzeExpression({ state, node: argument, context });
            return { context: throwContext, reachable: false };
        }

        if (type === 'IfStatement') {
            const testContext = analyzeExpression({ state, node: test, context });
            const consequentFlow = analyzer.statement({
                state,
                node: consequent,
                context: narrowContext({ ...test, context: testContext, truthy: true })
            });
            const alternateFlow = alternate
                ? analyzer.statement({
                    state,
                    node: alternate,
                    context: narrowContext({ ...test, context: testContext, truthy: false })
                })
                : {
                    context: narrowContext({ ...test, context: testContext, truthy: false }),
                    reachable: true
                };
            const reachableContexts = [consequentFlow, alternateFlow]
                .filter(({ reachable = false } = {}) => reachable)
                .map(({ context: branchContext = {} } = {}) => branchContext);
            return {
                context: reachableContexts.length ? mergeContexts(reachableContexts) : testContext,
                reachable: consequentFlow.reachable || alternateFlow.reachable
            };
        }

        if (['ForInStatement', 'ForOfStatement', 'ForStatement', 'WhileStatement', 'DoWhileStatement'].includes(type)) {
            return analyzer.loop({ state, node: source, context });
        }

        if (type === 'TryStatement') return analyzer.try({ state, node: source, context });

        if (type === 'VariableDeclaration') {
            return {
                context: declarations.reduce((current, { id = {}, init = {} } = {}) => {
                    const valueContext = analyzeExpression({
                        state,
                        node: init,
                        context: current
                    });
                    const value = inferExpression(init, valueContext);
                    return bindDeclaration({
                        context: valueContext,
                        init,
                        pattern: id,
                        value
                    });
                }, context),
                reachable: true
            };
        }

        if (type === 'ExpressionStatement') return {
            context: analyzeExpression({ state, node: expression, context }),
            reachable: true
        };

        return {
            context: getChildren(source)
                .filter(child => !isFunction(child))
                .reduce((current, child) => analyzeExpression({
                    state,
                    node: child,
                    context: current
                }), context),
            reachable: true
        };
    },

    statements: ({ state = {}, statements = [], context = {} } = {}) => statements.reduce(
        (current, statement = {}) => {
            const { context: currentContext = {}, reachable = false } = current;
            if (!reachable) return current;
            return analyzer.statement({ state, node: statement, context: currentContext });
        },
        { context, reachable: true }
    ),

    loop: ({ state = {}, node = {}, context = {} } = {}) => {
        const {
            type = '',
            init = {},
            test = {},
            update = {},
            left = {},
            right = {},
            body = {}
        } = node;
        const { declarations = [] } = left;
        const [{ id: loopPattern = {} } = {}] = declarations;
        const initResult = init.type === 'VariableDeclaration'
            ? analyzer.statement({ state, node: init, context })
            : {
                context: analyzeExpression({ state, node: init, context }),
                reachable: true
            };
        const entryContext = initResult.context || context;
        const testContext = test.type
            ? analyzeExpression({ state, node: test, context: entryContext })
            : entryContext;
        const element = getLoopElement({ type, right, context: testContext });
        const loopContext = type === 'ForOfStatement' || type === 'ForInStatement'
            ? bindDeclaration({
                context: testContext,
                pattern: loopPattern.type ? loopPattern : left,
                value: element,
                init: {}
            })
            : narrowContext({ ...test, context: testContext, truthy: true });
        const bodyFlow = analyzer.statement({ state, node: body, context: loopContext });
        const updateContext = update.type && bodyFlow.reachable
            ? analyzeExpression({ state, node: update, context: bodyFlow.context })
            : bodyFlow.context;
        const afterIteration = bodyFlow.reachable ? updateContext : bodyFlow.context;
        const contexts = type === 'DoWhileStatement'
            ? [afterIteration]
            : [testContext, afterIteration];
        return {
            context: mergeContexts(contexts),
            reachable: true
        };
    },

    try: ({ state = {}, node = {}, context = {} } = {}) => {
        const { block = {}, handler = {}, finalizer = {} } = node;
        const safeHandler = getObject(handler);
        const safeFinalizer = getObject(finalizer);
        const { param = {}, body: handlerBody = {} } = safeHandler;
        const safeParam = getObject(param);
        const tryFlow = analyzer.statement({ state, node: block, context });
        const catchContext = safeParam.type
            ? bindDeclaration({
                context,
                pattern: safeParam,
                value: unknown(safeParam),
                init: {}
            })
            : context;
        const catchFlow = safeHandler.type
            ? analyzer.statement({ state, node: handlerBody, context: catchContext })
            : { context, reachable: false };
        const paths = [tryFlow, catchFlow]
            .filter(({ reachable = false } = {}) => reachable)
            .map(({ context: pathContext = {} } = {}) => pathContext);
        const joinedContext = paths.length ? mergeContexts(paths) : context;
        if (!safeFinalizer.type) return {
            context: joinedContext,
            reachable: paths.length > 0
        };
        return analyzer.statement({ state, node: safeFinalizer, context: joinedContext });
    }
};

const createFunctionFlow = ({ functionNode = {}, definitions = {} } = {}) => {
    const signature = getSignature(functionNode);
    const matchingDefinitions = Object.entries(definitions)
        .filter(([, definition = {}] = []) => definition.node === functionNode)
        .map(([name = ''] = []) => name);
    const [functionName = ''] = matchingDefinitions;
    const state = {
        contexts: new Map(),
        returns: []
    };
    const context = {
        bindings: { ...signature.bindings },
        functions: definitions,
        callStack: functionName ? [functionName] : [],
        evaluateCalls: true,
        evaluationDepth: 0
    };
    const { body = {} } = functionNode;
    const result = body.type === 'BlockStatement'
        ? analyzer.statement({ state, node: body, context })
        : analyzeExpression({ state, node: body, context });
    // Return collection is analyzer-owned evidence accumulated across paths.
    // eslint-disable-next-line resilient/prefer-safe-transformations
    if (body.type !== 'BlockStatement') state.returns.push({
        argument: body,
        contract: inferExpression(body, result),
        node: body
    });
    return {
        contexts: state.contexts,
        finalContext: result.context || result,
        returns: state.returns
    };
};

const createProgramFlow = ({ program = {}, definitions = {} } = {}) => {
    const state = {
        contexts: new Map(),
        returns: []
    };
    const context = {
        bindings: {},
        functions: definitions,
        callStack: [],
        evaluateCalls: true,
        evaluationDepth: 0
    };
    const result = analyzer.statements({
        state,
        statements: program.body || [],
        context
    });
    return {
        contexts: state.contexts,
        finalContext: result.context || context,
        returns: state.returns
    };
};

const createFunctionFlows = ({ program = {}, definitions = {} } = {}) => new Map(
    [
        [program, createProgramFlow({ program, definitions })],
        ...getFunctionNodes(program).map(functionNode => [
            functionNode,
            createFunctionFlow({ functionNode, definitions })
        ])
    ]
);

const getEnclosingProgram = (node = {}) => {
    const source = getObject(node);
    if (source.type === 'Program') return source;
    return source.parent ? getEnclosingProgram(source.parent) : {};
};

const getFlowContext = ({ node = {}, definitions = {}, flows = new Map() } = {}) => {
    const functionNode = getEnclosingFunction(node);
    const programNode = getEnclosingProgram(node);
    const flow = flows.get(functionNode) || flows.get(programNode) || {};
    const contexts = flow.contexts || new Map();
    return contexts.get(node) || flow.finalContext || { functions: definitions };
};

export {
    createFunctionFlow,
    createFunctionFlows,
    getFlowContext,
    narrowContext
};
