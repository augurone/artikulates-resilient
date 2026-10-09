import { walk } from './infer.js';
import {
    contract,
    isEqual,
    getKind,
    isCompatible,
    isContradictory,
    isKnown,
    mergeContracts,
    unknown
} from './model.js';

const getCanonical = (kind = '') => ({
    string: "''",
    number: '0',
    boolean: 'false',
    array: '[]',
    object: '{}'
}[kind] || '');

const getRange = ({
    getRange = ({ range = [] } = {}) => Array.isArray(range) ? range.join(':') : ''
} = {}, node = {}) => getRange(node);

const getEvidence = ({ syntax = {}, node = {}, label = '' } = {}) => {
    const range = getRange(syntax, node);

    return range ? [{ range, label }] : [];
};

const getDirectResolver = (value = unknown()) => {
    const kind = getKind(value);
    const canonical = getCanonical(kind);

    return canonical
        ? { action: 'direct', canonical, constructor: '', expression: '' }
        : { action: 'none', canonical: '', constructor: '', expression: '' };
};

const getResolvedResolver = ({ resolver = {}, value = unknown() } = {}) => {
    const { action = '' } = resolver;

    if (action) return resolver;

    return getDirectResolver(value);
};

const getResult = ({
    state = 'unresolved',
    value = unknown(),
    paths = [],
    evidence = [],
    reason = '',
    resolver = {},
    emission = ''
} = {}) => ({
    state,
    contract: value,
    resolver: state === 'resolved' ? {
        ...getResolvedResolver({ resolver, value }),
        ...(emission && { emission })
    } : {
        action: 'none', canonical: '', constructor: '', expression: ''
    },
    paths,
    evidence,
    reason
});

const getIdentifierContract = ({
    name = '',
    bindings = {},
    aliases = {},
    syntax = {},
    depth = 0,
    seen = []
} = {}) => {
    const { [name]: bound = false } = bindings;

    if (bound) return getResult({ state: 'resolved', value: bound });

    const { [name]: alias = false } = aliases;

    if (!alias) return getResult({ reason: 'unbounded-producer' });

    if (seen.includes(name)) return getResult({ reason: 'recursion-limit' });

    // eslint-disable-next-line no-use-before-define -- Identifier aliases recurse through the same bounded expression resolver.
    return getExpressionResult({
        node: alias,
        syntax,
        bindings,
        aliases,
        depth,
        seen: [...seen, name]
    });
};

const getCallResult = ({
    node = {},
    syntax = {},
    bindings = {},
    aliases = {},
    functions = {},
    depth = 0,
    seen = []
} = {}) => {
    if (depth >= 8) return getResult({ reason: 'recursion-limit' });

    const call = syntax.getCall(node);
    const {
        name = '',
        dynamic = false,
        unsupported = false,
        target = '',
        localCallee = '',
        result: checkedResult = unknown(),
        arguments: args = []
    } = call;
    const { [localCallee]: localCurriedDefinition = false } = functions;

    // The adapters may establish the result of a static protocol call without
    // pretending that its receiver is a locally resolvable function.  A
    // curried result is admitted only when its first local callee is known;
    // otherwise a checker result would hide an external producer boundary.
    const hasLocalCurriedCallee = target !== 'local-curried' || !!localCurriedDefinition;

    if (isKnown(checkedResult) && hasLocalCurriedCallee) return getResult({
        state: 'resolved',
        value: checkedResult,
        resolver: getDirectResolver(checkedResult),
        emission: 'deferred',
        paths: [getRange(syntax, node)],
        evidence: getEvidence({
            syntax,
            node,
            label: target === 'local-curried'
                ? 'checker-proven local curried call result'
                : 'checker-proven static call result'
        })
    });

    if (dynamic) return getResult({ reason: 'dynamic-call' });

    if (unsupported) return getResult({ reason: 'unsupported-member' });

    const { [name]: definition = false } = functions;

    if (!definition) return getResult({ reason: name ? 'external-call' : 'unsupported-member' });

    const names = syntax.getParameterNames(definition);
    // eslint-disable-next-line no-use-before-define -- Call arguments use the same bounded resolver as return expressions.
    const values = args.map(argument => getExpressionResult({
        node: argument,
        syntax,
        bindings,
        aliases,
        functions,
        depth,
        seen
    }));
    const callBindings = Object.fromEntries(names.map((parameter = '', index = 0) => {
        const { [index]: result = getResult() } = values;
        const { contract: value = unknown() } = result;

        return [parameter, value];
    }));

    // eslint-disable-next-line no-use-before-define -- Local calls recurse through the same bounded callback resolver.
    return getCallbackResult({
        callback: definition,
        syntax,
        bindings: { ...bindings, ...callBindings },
        functions,
        depth: depth + 1,
        seen
    });
};

const getExpressionResult = ({
    node = {},
    syntax = {},
    bindings = {},
    aliases = {},
    functions = {},
    depth = 0,
    seen = []
} = {}) => {
    const type = syntax.getType(node);

    if (type === 'conditional') {
        const { consequent = {}, alternate = {} } = syntax.getConditional(node);
        const branches = [consequent, alternate].map(branch => getExpressionResult({
            node: branch,
            syntax,
            bindings,
            aliases,
            functions,
            depth,
            seen
        }));

        // eslint-disable-next-line no-use-before-define -- Branch paths merge through the shared result resolver declared below.
        return mergeResults(branches);
    }

    if (type === 'identifier') return getIdentifierContract({
        name: syntax.getName(node),
        bindings,
        aliases,
        syntax,
        depth,
        seen
    });

    if (type === 'call') return getCallResult({
        node,
        syntax,
        bindings,
        functions,
        depth,
        seen
    });

    const value = syntax.getDirectContract(node);

    if (isKnown(value)) return getResult({
        state: 'resolved',
        value,
        paths: [getRange(syntax, node)],
        evidence: getEvidence({ syntax, node, label: 'direct return family' })
    });

    return getResult({ reason: 'unbounded-producer' });
};

const mergeResults = (results = []) => {
    const unresolved = results.find(({ state = '' } = {}) => state === 'unresolved');

    if (unresolved) return unresolved;

    const values = results.map(({ contract: value = unknown() } = {}) => value);
    const value = mergeContracts(values, { preserveContradictions: true });
    const evidence = results.flatMap(({ evidence: entries = [] } = {}) => entries);
    const paths = results.flatMap(({ paths: entries = [] } = {}) => entries);
    const deferredEmission = results.some(({ resolver = {} } = {}) => {
        const { emission = '' } = resolver;

        return emission === 'deferred';
    });

    if (isContradictory(value)) return getResult({
        state: 'contradictory',
        value,
        paths,
        evidence,
        reason: 'incompatible-paths'
    });

    return getResult({
        state: 'resolved',
        value,
        paths,
        evidence,
        emission: deferredEmission ? 'deferred' : ''
    });
};

const getCallbackResult = ({
    callback = {},
    syntax = {},
    bindings = {},
    functions = {},
    depth = 0,
    seen = []
} = {}) => {
    const aliases = syntax.getAliases(callback);
    const paths = syntax.getReturnExpressions(callback);

    if (!paths.length) return getResult({ reason: 'unbounded-producer' });

    return mergeResults(paths.map(path => getExpressionResult({
        node: path,
        syntax,
        bindings,
        aliases,
        functions,
        depth,
        seen
    })));
};

const resolveTupleCallbackReturn = ({
    syntax = {},
    callback = {},
    tuple = {},
    expectedResult = unknown(),
    functions = {},
    context = {}
} = {}) => {
    const { positions = [] } = tuple;
    const { accumulator = {} } = context;
    const { name: accumulatorName = '', contract: accumulatorContract = unknown() } = accumulator;
    const bindings = {
        ...Object.fromEntries(positions.map(({ name = '', contract: value = unknown() } = {}) => [name, value])),
        ...(accumulatorName && { [accumulatorName]: accumulatorContract })
    };
    const result = getCallbackResult({ callback, syntax, bindings, functions, ...context });
    const { state = '', contract: actual = unknown() } = result;

    if (state !== 'resolved') return result;

    // A reducer's accumulator is the source-owned falsifiable result for a
    // malformed consumed value. This is not an array default: each normal
    // callback path must explicitly return the accumulator parameter.
    const returnPaths = syntax.getReturnExpressions(callback);
    const returnsAccumulator = accumulatorName && returnPaths.length && returnPaths.every((path = {}) => (
        syntax.getType(path) === 'identifier' && syntax.getName(path) === accumulatorName
    ));

    if (returnsAccumulator) return {
        ...result,
        resolver: { action: 'accumulator', canonical: '', constructor: '', expression: accumulatorName }
    };

    if (isKnown(expectedResult) && !isCompatible({ expected: expectedResult, actual })) {
        const { paths = [], evidence = [] } = result;

        return getResult({
            state: 'contradictory',
            value: actual,
            paths,
            evidence,
            reason: 'incompatible-paths'
        });
    }

    const { structuralModel = false } = context;

    if (isKnown(accumulatorContract) && isEqual(actual, accumulatorContract)) return {
        ...result,
        resolver: { action: 'accumulator', canonical: '', constructor: '', expression: '' }
    };

    if (structuralModel && getKind(actual) === 'object') return {
        ...result,
        resolver: { action: 'model', canonical: '{}', constructor: '', expression: '' }
    };

    return result;
};

const getEstreeDirectContract = (node = {}) => {
    const { type = '', value = false } = node;

    if (type === 'ArrayExpression') return contract({ kind: 'array', sourceNode: node });

    if (type === 'ObjectExpression') return contract({ kind: 'object', sourceNode: node });

    if (['ArrowFunctionExpression', 'FunctionExpression'].includes(type)) return contract({ kind: 'function', sourceNode: node });

    if (type !== 'Literal') return unknown(node);

    return contract({ kind: typeof value, sourceNode: node });
};

const createEstreeTupleSyntax = () => ({
    getType: ({ type = '' } = {}) => ({
        Identifier: 'identifier',
        CallExpression: 'call',
        ConditionalExpression: 'conditional'
    }[type] || 'direct'),
    getName: ({ name = '' } = {}) => name,
    getRange: ({ range = [] } = {}) => Array.isArray(range) ? range.join(':') : '',
    getConditional: ({ consequent = {}, alternate = {} } = {}) => ({ consequent, alternate }),
    getCall: ({ callee = {}, arguments: args = [] } = {}) => {
        const { type = '', name = '', property = {}, computed = false } = callee;
        const { name: propertyName = '' } = property;

        if (type === 'Identifier') return { name, dynamic: false, arguments: args };

        if (type === 'MemberExpression' && !computed && propertyName) return { unsupported: true, arguments: args };

        return { dynamic: true, arguments: args };
    },
    getParameterNames: ({ params = [] } = {}) => params.map(({ type = '', name = '' } = {}) => (
        type === 'Identifier' ? name : ''
    )),
    getDirectContract: getEstreeDirectContract,
    getAliases: ({ body = {} } = {}) => {
        let entries = [];
        walk(body, ({ type = '', id = {}, init = {} } = {}) => {
            const { type: identifierType = '', name = '' } = id;

            if (type === 'VariableDeclarator' && identifierType === 'Identifier') entries = [...entries, [name, init]];
        });

        return Object.fromEntries(entries);
    },
    getReturnExpressions: ({ body = {} } = {}) => {
        const { type = '' } = body;

        if (type !== 'BlockStatement') return [body];

        let paths = [];
        walk(body, ({ type = '', argument = {} } = {}) => {
            if (type === 'ReturnStatement' && argument) paths = [...paths, argument];
        }, { skipFunctions: true });

        return paths;
    }
});

export {
    createEstreeTupleSyntax,
    resolveTupleCallbackReturn
};
