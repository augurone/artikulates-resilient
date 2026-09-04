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
import { getObject, hasObjectValue, isObject } from '../support/object.js';

const COMPARISON_OPERATORS = ['===', '!==', '==', '!='];

const copyAliases = (aliases = {}) => Object.fromEntries(Object.entries(getObject(aliases)).map(([name = '', related = []] = []) => [
    name,
    Array.isArray(related) ? [...related] : []
]));

const copyContext = (source = {}) => {
    const {
        bindings = {},
        functions = {},
        aliases = {},
        callStack = [],
        evaluateCalls = true,
        evaluationDepth = 0
    } = getObject(source);

    return {
        bindings: { ...getObject(bindings) },
        functions: getObject(functions),
        aliases: copyAliases(getObject(aliases)),
        callStack: Array.isArray(callStack) ? [...callStack] : [],
        evaluateCalls,
        evaluationDepth
    };
};

const getPredicate = ({
    type = '',
    callee = {},
    arguments: args = [],
    operator = '',
    left = {},
    right = {}
} = {}) => {
    const safeCallee = getObject(callee);
    const {
        type: calleeType = '',
        name: calleeName = '',
        object = {},
        property = {},
        computed = false
    } = safeCallee;
    const [firstArgument = {}] = Array.isArray(args) ? args : [];
    const { type: argumentType = '', name: argumentName = '' } = getObject(firstArgument);
    const { type: objectType = '', name: objectName = '' } = getObject(object);
    const { type: propertyType = '', name: propertyName = '' } = getObject(property);

    if (
        type === 'CallExpression' &&
        calleeType === 'Identifier' &&
        calleeName === 'isFunction' &&
        argumentType === 'Identifier'
    ) {
        return { kind: 'function', name: argumentName };
    }

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
        argument: leftArgument = {},
        name: leftName = '',
        value: leftValue = ''
    } = getObject(left);
    const {
        type: rightType = '',
        value: rightValue = '',
        name: rightName = '',
        argument: rightArgument = {},
        operator: rightOperator = ''
    } = getObject(right);
    const { type: leftArgumentType = '', name: leftArgumentName = '' } = getObject(leftArgument);
    const { type: rightArgumentType = '', name: rightArgumentName = '' } = getObject(rightArgument);
    const leftTypeof = (
        leftType === 'UnaryExpression' &&
        leftOperator === 'typeof' &&
        leftArgumentType === 'Identifier' &&
        rightType === 'Literal' &&
        ['string', 'number', 'boolean', 'undefined', 'object', 'function'].includes(rightValue)
    );
    const rightTypeof = (
        rightType === 'UnaryExpression' &&
        rightOperator === 'typeof' &&
        rightArgumentType === 'Identifier' &&
        leftType === 'Literal' &&
        ['string', 'number', 'boolean', 'undefined', 'object', 'function'].includes(leftValue)
    );
    const isTypeofPredicate = (
        binaryType === 'BinaryExpression' &&
        COMPARISON_OPERATORS.includes(operator) &&
        (leftTypeof || rightTypeof)
    );

    if (isTypeofPredicate) {
        const kindValue = leftTypeof ? rightValue : leftValue;

        return {
            kind: kindValue === 'undefined' ? 'undefined' : kindValue,
            name: leftTypeof ? leftArgumentName : rightArgumentName,
            negated: ['!==', '!='].includes(operator)
        };
    }

    const isLeftLiteralPredicate = (
        binaryType === 'BinaryExpression' &&
        COMPARISON_OPERATORS.includes(operator) &&
        leftType === 'Identifier' &&
        rightType === 'Literal'
    );
    const isRightLiteralPredicate = (
        binaryType === 'BinaryExpression' &&
        COMPARISON_OPERATORS.includes(operator) &&
        rightType === 'Identifier' &&
        leftType === 'Literal'
    );

    if (isLeftLiteralPredicate || isRightLiteralPredicate) {
        const literalValue = isLeftLiteralPredicate ? rightValue : leftValue;
        const kind = literalValue === null ? 'null' : typeof literalValue;
        const looseNullish = kind === 'null' && ['==', '!='].includes(operator);

        return {
            kind,
            kinds: looseNullish ? ['null', 'undefined'] : [kind],
            name: isLeftLiteralPredicate ? leftName : rightName,
            negated: ['!==', '!='].includes(operator)
        };
    }

    return {};
};

const setBinding = ({ context = {}, name = '', value = unknown() } = {}) => {
    const next = copyContext(context);
    const { aliases = {}, bindings = {} } = next;
    const { [name]: related = [] } = aliases;
    const names = [name, ...(Array.isArray(related) ? related : [])];

    return {
        ...next,
        bindings: {
            ...bindings,
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

    const {
        kind = '',
        kinds = [kind],
        name = '',
        negated = false
    } = getPredicate(test);

    if (!kind || !name) return copyContext(context);

    const predicateTruthy = negated ? !truthy : truthy;

    const { bindings = {} } = copyContext(context);
    const { [name]: boundValue = unknown() } = bindings;
    const current = boundValue;
    const currentKind = getKind(current);
    const { sourceNode = {} } = getObject(current);
    const matchesPredicate = kinds.includes(currentKind);

    if (predicateTruthy && negated && matchesPredicate) return setBinding({
        context,
        name,
        value: unknown(sourceNode)
    });

    if (predicateTruthy) {
        return setBinding({
            context,
            name,
            value: contract({ kind, sourceNode: test })
        });
    }

    return matchesPredicate
        ? setBinding({
            context,
            name,
            value: unknown(sourceNode)
        })
        : copyContext(context);
};

const mergeFlowContracts = (values = []) => {
    if (values.some(value => getKind(value) === 'unknown')) return unknown();

    return mergeContracts(values, { preserveContradictions: false });
};

const mergeContexts = (contexts = []) => {
    const sourceContexts = Array.isArray(contexts) ? contexts : [];
    const names = [...new Set(sourceContexts.flatMap((value) => {
        const { bindings = {} } = getObject(value);

        return Object.keys(getObject(bindings));
    }))];
    const [first = {}] = sourceContexts;
    const {
        functions = {},
        aliases: firstAliases = {},
        callStack = [],
        evaluateCalls = true,
        evaluationDepth = 0
    } = getObject(first);
    const aliases = Object.fromEntries(Object.entries(getObject(firstAliases))
        .map(([name = '', related = []] = []) => [
            name,
            (Array.isArray(related) ? related : []).filter(alias => sourceContexts.every((value) => {
                const { aliases: sourceAliases = {} } = getObject(value);
                const { [name]: sourceRelated = [] } = getObject(sourceAliases);

                return Array.isArray(sourceRelated) && sourceRelated.includes(alias);
            }))
        ])
        .filter(([, related = []] = []) => related.length));
    const bindings = Object.fromEntries(names.map(name => [
        name,
        mergeFlowContracts(sourceContexts.map((value) => {
            const { bindings: sourceBindings = {} } = getObject(value);
            const { [name]: sourceValue = unknown() } = getObject(sourceBindings);

            return sourceValue;
        }))
    ]));

    return {
        aliases,
        bindings,
        functions,
        callStack: Array.isArray(callStack) ? [...callStack] : [],
        evaluateCalls: evaluateCalls !== false,
        evaluationDepth: evaluationDepth || 0
    };
};

const bindPattern = ({ context = {}, pattern = {}, value = unknown() } = {}) => {
    const { type = '', name = '' } = getObject(pattern);

    if (type === 'Identifier') {
        const next = copyContext(context);
        const { bindings: nextBindings = {} } = next;

        return {
            ...next,
            bindings: { ...nextBindings, [name]: value }
        };
    }

    if (type === 'AssignmentPattern') {
        const { left = {} } = getObject(pattern);

        return bindPattern({ context, pattern: left, value });
    }

    if (type !== 'ObjectPattern') return copyContext(context);

    const {
        kind: valueKind = 'unknown',
        properties: valueProperties = {},
        residual: valueResidual = {}
    } = getObject(value);
    const { properties: patternProperties = [] } = getObject(pattern);
    const safePatternProperties = Array.isArray(patternProperties) ? patternProperties : [];
    const safeValueProperties = getObject(valueProperties);
    const safeValueResidual = getObject(valueResidual);
    const excluded = safePatternProperties
        .filter(({ type: propertyType = '' } = {}) => propertyType === 'Property')
        .map(({ key = {}, computed = false } = {}) => getPropertyName({ key, computed }))
        .filter(Boolean);

    return safePatternProperties
        .filter(({ type: propertyType = '' } = {}) => ['Property', 'RestElement'].includes(propertyType))
        .reduce((current, { type: propertyType = '', key = {}, value: propertyValue = {}, argument = {} } = {}) => {
            if (propertyType === 'RestElement') {
                const { properties: residualProperties = {}, open = false, excluded: residualExcluded = [] } = safeValueResidual;
                const remainingProperties = Object.fromEntries(Object.entries(safeValueProperties)
                    .filter(([propertyName = ''] = []) => !excluded.includes(propertyName)));

                return bindPattern({
                    context: current,
                    pattern: argument,
                    value: contract({
                        kind: 'object',
                        state: 'unknown',
                        properties: {
                            ...getObject(residualProperties),
                            ...remainingProperties
                        },
                        residual: {
                            kind: 'object',
                            state: 'unknown',
                            open: open === true || valueKind === 'object',
                            excluded: [...new Set([
                                ...(Array.isArray(residualExcluded) ? residualExcluded : []),
                                ...excluded
                            ])],
                            properties: {}
                        }
                    })
                });
            }

            const { name: keyName = '', value: keyValue = '' } = getObject(key);
            const propertyName = keyName || keyValue;

            if (!propertyName) return current;

            const { [propertyName]: knownProperty = unknown(propertyValue) } = safeValueProperties;

            return bindPattern({
                context: current,
                pattern: propertyValue,
                value: knownProperty
            });
        }, copyContext(context));
};

const removeAliases = ({ context = {}, name = '' } = {}) => {
    const next = copyContext(context);
    const { aliases: nextAliases = {} } = next;
    const { [name]: related = [] } = nextAliases;
    const names = [name, ...(Array.isArray(related) ? related : [])];
    const aliases = Object.fromEntries(Object.entries(nextAliases)
        .filter(([currentName = '']) => !names.includes(currentName))
        .map(([currentName = '', related = []] = []) => [
            currentName,
            related.filter(alias => !names.includes(alias))
        ]));

    return { ...next, aliases };
};

const addAliases = ({ context = {}, name = '', target = '' } = {}) => {
    const next = copyContext(context);
    const { aliases: nextAliases = {} } = next;
    const { [name]: nameAliases = [], [target]: targetAliases = [] } = nextAliases;
    const group = [...new Set([
        name,
        target,
        ...(Array.isArray(nameAliases) ? nameAliases : []),
        ...(Array.isArray(targetAliases) ? targetAliases : [])
    ])];

    return {
        ...next,
        aliases: {
            ...nextAliases,
            ...Object.fromEntries(group.map(currentName => [
                currentName,
                group.filter(alias => alias !== currentName)
            ]))
        }
    };
};

const bindDeclaration = ({ context = {}, pattern = {}, value = unknown(), init = {} } = {}) => {
    const { type: patternType = '', name = '' } = pattern;
    const { type: initType = '', name: initName = '' } = getObject(init);
    const unlinked = patternType === 'Identifier'
        ? removeAliases({ context, name })
        : context;
    const bound = bindPattern({ context: unlinked, pattern, value });

    if (patternType !== 'Identifier' || initType !== 'Identifier') return bound;

    const aliased = addAliases({ context: bound, name, target: initName });
    const { functions: aliasedFunctions = {} } = aliased;
    const functionAlias = getFunctionAlias({ init, functions: aliasedFunctions });
    const { signature = {} } = getObject(functionAlias);

    if (!hasObjectValue(signature)) return aliased;

    return {
        ...aliased,
        functions: {
            ...aliasedFunctions,
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

    const { properties: sourceProperties = {}, branches = [], sourceNode: currentSourceNode = {} } = getObject(value);
    const properties = { ...getObject(sourceProperties) };
    const { [name]: current = unknown() } = properties;
    const updated = rest.length
        ? updateContractPath({ value: current, path: rest, nextValue, sourceNode })
        : nextValue;

    return contract({
        kind: 'object',
        properties: { ...properties, [name]: updated },
        branches,
        sourceNode: sourceNode || currentSourceNode
    });
};

const assignExpression = ({ context = {}, left = {}, value = unknown() } = {}) => {
    const { type = '' } = left;

    if (type === 'Identifier') return bindDeclaration({ context, pattern: left, value });

    if (type !== 'MemberExpression') return context;

    const path = getMemberPath(left);
    const [rootName = '', ...propertyPath] = path;

    if (!rootName || !propertyPath.length) return context;

    const { bindings: contextBindings = {} } = context;
    const { [rootName]: current = unknown() } = contextBindings;
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
    // eslint-disable-next-line resilient/prefer-safe-transformations -- WeakMap identity indexing is an internal analyzer boundary.
    if (isObject(node)) state.contexts.set(node, context);
};

const analyzeExpression = ({ state = {}, node = {}, context = {} } = {}) => {
    const source = getObject(node);
    const { type = '' } = source;

    if (!type || isFunction(source)) return context;

    setExpressionContext({ state, node: source, context });

    if (type === 'AssignmentExpression') {
        const { right = {}, left = {} } = source;
        const rightContext = analyzeExpression({ state, node: right, context });
        const value = inferExpression(right, rightContext);

        return assignExpression({ context: rightContext, left, value });
    }

    const {
        operator = '',
        left = {},
        right = {},
        test = {},
        consequent = {},
        alternate = {}
    } = source;

    if (type === 'LogicalExpression' && operator === '&&') {
        const leftContext = analyzeExpression({ state, node: left, context });
        const rightContext = narrowContext({
            ...left,
            context: leftContext,
            truthy: true
        });
        analyzeExpression({ state, node: right, context: rightContext });

        return context;
    }

    if (type === 'ConditionalExpression') {
        const testContext = analyzeExpression({ state, node: test, context });
        const consequentContext = narrowContext({
            ...test,
            context: testContext,
            truthy: true
        });
        const alternateContext = narrowContext({
            ...test,
            context: testContext,
            truthy: false
        });
        analyzeExpression({ state, node: consequent, context: consequentContext });
        analyzeExpression({ state, node: alternate, context: alternateContext });

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
    const { element = unknown() } = getObject(source);

    return getKind(source) === 'array' ? element : unknown();
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
            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private return evidence is appended in traversal order.
            state.returns.push({
                argument,
                contract: inferExpression(argument, returnContext),
                node: source
            });

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
            const { reachable: consequentReachable = false } = getObject(consequentFlow);
            const { reachable: alternateReachable = false } = getObject(alternateFlow);

            return {
                context: reachableContexts.length ? mergeContexts(reachableContexts) : testContext,
                reachable: consequentReachable || alternateReachable
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
        const { type: initType = '' } = getObject(init);
        const initResult = initType === 'VariableDeclaration'
            ? analyzer.statement({ state, node: init, context })
            : {
                context: analyzeExpression({ state, node: init, context }),
                reachable: true
            };
        const { context: entryContext = context } = getObject(initResult);
        const { type: testType = '' } = getObject(test);
        const testContext = testType
            ? analyzeExpression({ state, node: test, context: entryContext })
            : entryContext;
        const element = getLoopElement({ type, right, context: testContext });
        const { type: loopPatternType = '' } = getObject(loopPattern);
        const loopContext = type === 'ForOfStatement' || type === 'ForInStatement'
            ? bindDeclaration({
                context: testContext,
                pattern: loopPatternType ? loopPattern : left,
                value: element,
                init: {}
            })
            : narrowContext({ ...test, context: testContext, truthy: true });
        const bodyFlow = analyzer.statement({ state, node: body, context: loopContext });
        const {
            context: bodyContext = loopContext,
            reachable: bodyReachable = false
        } = getObject(bodyFlow);
        const { type: updateType = '' } = getObject(update);
        const updateContext = updateType && bodyReachable
            ? analyzeExpression({ state, node: update, context: bodyContext })
            : bodyContext;
        const afterIteration = bodyReachable ? updateContext : bodyContext;
        const contexts = type === 'DoWhileStatement'
            ? [afterIteration]
            : [testContext, afterIteration];

        return {
            context: mergeContexts(contexts),
            reachable: true
        };
    },

    try: ({ state = {}, node = {}, context = {} } = {}) => {
        const { block = {}, handler = {}, finalizer = {} } = getObject(node);
        const safeHandler = getObject(handler);
        const safeFinalizer = getObject(finalizer);
        const { param = {}, body: handlerBody = {} } = safeHandler;
        const safeParam = getObject(param);
        const tryFlow = analyzer.statement({ state, node: block, context });
        const { type: paramType = '' } = safeParam;
        const { type: handlerType = '' } = safeHandler;
        const { type: finalizerType = '' } = safeFinalizer;
        const catchContext = paramType
            ? bindDeclaration({
                context,
                pattern: safeParam,
                value: unknown(safeParam),
                init: {}
            })
            : context;
        const catchFlow = handlerType
            ? analyzer.statement({ state, node: handlerBody, context: catchContext })
            : { context, reachable: false };
        const paths = [tryFlow, catchFlow]
            .filter(({ reachable = false } = {}) => reachable)
            .map(({ context: pathContext = {} } = {}) => pathContext);
        const joinedContext = paths.length ? mergeContexts(paths) : context;

        if (!finalizerType) return {
            context: joinedContext,
            reachable: !!paths.length
        };

        return analyzer.statement({ state, node: safeFinalizer, context: joinedContext });
    }
};

const createFunctionFlow = ({
    functionNode = {},
    definitions = {},
    initialBindings = {}
} = {}) => {
    const signature = getSignature(functionNode);
    const matchingDefinitions = Object.entries(definitions)
        .filter(([, definition = {}] = []) => {
            const { node: definitionNode = {} } = getObject(definition);

            return definitionNode === functionNode;
        })
        .map(([name = ''] = []) => name);
    const [functionName = ''] = matchingDefinitions;
    const state = {
        contexts: new Map(),
        returns: []
    };
    const { contexts = new Map(), returns = [] } = state;
    const { bindings: signatureBindings = {} } = getObject(signature);
    const context = {
        bindings: { ...signatureBindings, ...initialBindings },
        functions: definitions,
        callStack: functionName ? [functionName] : [],
        evaluateCalls: true,
        evaluationDepth: 0
    };
    const { body = {} } = getObject(functionNode);
    const { type: bodyType = '' } = getObject(body);
    const result = bodyType === 'BlockStatement'
        ? analyzer.statement({ state, node: body, context })
        : analyzeExpression({ state, node: body, context });
    const { context: resultContext = result } = getObject(result);

    // Return collection is analyzer-owned evidence accumulated across paths.
    // eslint-disable-next-line resilient/prefer-safe-transformations -- Expression-bodied return evidence is appended to the flow result.
    if (bodyType !== 'BlockStatement') returns.push({
        argument: body,
        contract: inferExpression(body, result),
        node: body
    });

    return {
        contexts,
        finalContext: resultContext,
        returns
    };
};

const createProgramFlow = ({ program = {}, definitions = {} } = {}) => {
    const state = {
        contexts: new Map(),
        returns: []
    };
    const { contexts = new Map(), returns = [] } = state;
    const context = {
        bindings: {},
        functions: definitions,
        callStack: [],
        evaluateCalls: true,
        evaluationDepth: 0
    };
    const { body: programStatements = [] } = getObject(program);
    const result = analyzer.statements({
        state,
        statements: programStatements,
        context
    });
    const { context: resultContext = context } = getObject(result);

    return {
        contexts,
        finalContext: resultContext,
        returns
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
    const { type = '', parent = {} } = source;

    if (type === 'Program') return source;

    return hasObjectValue(parent) ? getEnclosingProgram(parent) : {};
};

const getFlowContext = ({ node = {}, definitions = {}, flows = new Map() } = {}) => {
    const functionNode = getEnclosingFunction(node);
    const programNode = getEnclosingProgram(node);
    const flow = flows.get(functionNode) || flows.get(programNode) || {};
    const { contexts = new Map(), finalContext = {} } = getObject(flow);

    return contexts.get(node) || finalContext || { functions: definitions };
};

export {
    createFunctionFlow,
    createFunctionFlows,
    getFlowContext,
    narrowContext
};
