import assert from 'node:assert/strict';

import typescript from 'typescript';

import { contract, unknown } from '../rules/contracts/model.js';
import {
    createEstreeTupleSyntax,
    resolveTupleCallbackReturn
} from '../rules/contracts/tuple-return.js';
import { getTupleConsumerAgreement } from '../transforms/typescript/policy/defaults.js';
import { createTypeScriptTupleSyntax } from '../transforms/typescript/understand/type-evidence.js';

const identifier = (name = '') => ({ type: 'Identifier', name, range: [0, 1] });
const array = () => ({ type: 'ArrayExpression', range: [2, 4] });
const call = (name = '') => ({ type: 'CallExpression', callee: identifier(name), range: [5, 9] });
const getEstreeCallbacks = ({ expression = call('next'), nextExpression = array() } = {}) => ({
    callback: { type: 'ArrowFunctionExpression', body: expression, range: [10, 20] },
    functions: {
        next: { type: 'ArrowFunctionExpression', body: nextExpression, range: [21, 30] }
    }
});

const getTypeScriptCallbacks = (source = '') => {
    const sourceFile = typescript.createSourceFile('tuple.ts', source, typescript.ScriptTarget.ESNext, true);
    const { statements = [] } = sourceFile;
    const [nextStatement = {}, runStatement = {}] = statements;
    const { declarationList: nextList = {} } = nextStatement;
    const { declarationList: runList = {} } = runStatement;
    const { declarations: nextDeclarations = [] } = nextList;
    const { declarations: runDeclarations = [] } = runList;
    const [nextDeclaration = {}] = nextDeclarations;
    const [runDeclaration = {}] = runDeclarations;
    const { initializer: next = {} } = nextDeclaration;
    const { initializer: run = {} } = runDeclaration;
    const { body: call = {} } = run;
    const { arguments: args = [] } = call;
    const [callback = {}] = args.slice(-1);

    return { callback, functions: { next } };
};

const tuple = {
    positions: [
        { name: 'a', contract: unknown() },
        { name: 'state', contract: unknown() }
    ]
};
const source = 'const next = (a, state) => [a, state]; const run = value => F.map(value, ([a, state]) => next(a, state));';
const estree = getEstreeCallbacks();
const typeScript = getTypeScriptCallbacks(source);
const estreeResult = resolveTupleCallbackReturn({
    syntax: createEstreeTupleSyntax(),
    callback: estree.callback,
    tuple,
    functions: estree.functions
});
const typeScriptResult = resolveTupleCallbackReturn({
    syntax: createTypeScriptTupleSyntax({ typescript }),
    callback: typeScript.callback,
    tuple,
    functions: typeScript.functions
});

assert.deepEqual(
    {
        state: typeScriptResult.state,
        action: typeScriptResult.resolver.action,
        canonical: typeScriptResult.resolver.canonical,
        reason: typeScriptResult.reason
    },
    {
        state: estreeResult.state,
        action: estreeResult.resolver.action,
        canonical: estreeResult.resolver.canonical,
        reason: estreeResult.reason
    }
);
assert.equal(estreeResult.state, 'resolved');
assert.equal(estreeResult.resolver.canonical, '[]');
assert.ok(estreeResult.evidence.length);
assert.ok(typeScriptResult.evidence.length);

const direct = resolveTupleCallbackReturn({
    syntax: createEstreeTupleSyntax(),
    callback: getEstreeCallbacks({ expression: array() }).callback,
    tuple,
    expectedResult: contract({ kind: 'array' })
});

assert.equal(direct.state, 'resolved');
assert.equal(direct.resolver.action, 'direct');

const accumulator = resolveTupleCallbackReturn({
    syntax: createEstreeTupleSyntax(),
    callback: getEstreeCallbacks({ expression: identifier('b') }).callback,
    tuple,
    context: { accumulator: { name: 'b', contract: contract({ kind: 'array' }) } }
});

assert.equal(accumulator.resolver.action, 'accumulator');

const contradiction = resolveTupleCallbackReturn({
    syntax: createEstreeTupleSyntax(),
    callback: getEstreeCallbacks({
        expression: {
            type: 'ConditionalExpression',
            consequent: array(),
            alternate: { type: 'Literal', value: '', range: [31, 33] },
            range: [34, 40]
        }
    }).callback,
    tuple
});

assert.equal(contradiction.state, 'contradictory');
assert.equal(contradiction.reason, 'incompatible-paths');

const external = resolveTupleCallbackReturn({
    syntax: createEstreeTupleSyntax(),
    callback: getEstreeCallbacks({ expression: call('external') }).callback,
    tuple
});

assert.equal(external.state, 'unresolved');
assert.equal(external.reason, 'external-call');

const recursive = getEstreeCallbacks({ nextExpression: call('next') });
const recursiveResult = resolveTupleCallbackReturn({
    syntax: createEstreeTupleSyntax(), callback: recursive.callback,
    tuple, functions: recursive.functions
});
assert.equal(recursiveResult.state, 'unresolved');
assert.equal(recursiveResult.reason, 'recursion-limit');
const aliasSyntax = {
    ...createEstreeTupleSyntax(),
    getAliases: () => ({ first: identifier('second'), second: identifier('first') })
};
const aliasCycle = resolveTupleCallbackReturn({
    syntax: aliasSyntax,
    callback: getEstreeCallbacks({ expression: identifier('first') }).callback,
    tuple
});
assert.equal(aliasCycle.state, 'unresolved');
assert.equal(aliasCycle.reason, 'recursion-limit');
const resolverFailure = new Error('syntax adapter failure');
assert.throws(() => resolveTupleCallbackReturn({
    syntax: { ...createEstreeTupleSyntax(), getAliases: () => { throw resolverFailure; } },
    callback: recursive.callback, tuple
}), error => error === resolverFailure);

const unsupportedMember = resolveTupleCallbackReturn({
    syntax: createEstreeTupleSyntax(),
    callback: getEstreeCallbacks({
        expression: {
            type: 'CallExpression',
            callee: {
                type: 'MemberExpression',
                computed: false,
                property: identifier('next'),
                range: [41, 46]
            },
            range: [47, 53]
        }
    }).callback,
    tuple
});

assert.equal(unsupportedMember.state, 'unresolved');
assert.equal(unsupportedMember.reason, 'unsupported-member');

const model = resolveTupleCallbackReturn({
    syntax: createEstreeTupleSyntax(),
    callback: getEstreeCallbacks({
        expression: { type: 'ObjectExpression', range: [54, 56] }
    }).callback,
    tuple,
    context: { structuralModel: true }
});

assert.equal(model.state, 'resolved');
assert.equal(model.resolver.action, 'model');

const staticCall = {
    type: 'CallExpression',
    callee: {
        type: 'MemberExpression',
        computed: false,
        object: identifier('provider'),
        property: identifier('map')
    },
    arguments: [],
    range: [57, 65]
};
const staticSyntax = {
    ...createEstreeTupleSyntax(),
    getCall: (node = {}) => node === staticCall
        ? { target: 'static-member', result: contract({ kind: 'array' }), arguments: [] }
        : createEstreeTupleSyntax().getCall(node)
};
const staticResult = resolveTupleCallbackReturn({
    syntax: staticSyntax,
    callback: getEstreeCallbacks({ expression: staticCall }).callback,
    tuple
});

assert.equal(staticResult.state, 'resolved');
assert.equal(staticResult.resolver.canonical, '[]');
assert.equal(staticResult.resolver.emission, 'deferred');
assert.equal(staticResult.evidence[0].label, 'checker-proven static call result');

const curriedCall = {
    type: 'CallExpression',
    callee: call('next'),
    arguments: [identifier('state')],
    range: [66, 78]
};
const curriedSyntax = {
    ...createEstreeTupleSyntax(),
    getCall: (node = {}) => node === curriedCall
        ? {
            dynamic: true,
            target: 'local-curried',
            localCallee: 'next',
            result: contract({ kind: 'array' }),
            arguments: [identifier('state')]
        }
        : createEstreeTupleSyntax().getCall(node)
};
const curriedResult = resolveTupleCallbackReturn({
    syntax: curriedSyntax,
    callback: getEstreeCallbacks({ expression: curriedCall }).callback,
    tuple,
    functions: { next: { type: 'ArrowFunctionExpression', body: array() } }
});

assert.equal(curriedResult.state, 'resolved');
assert.equal(curriedResult.resolver.canonical, '[]');
assert.equal(curriedResult.resolver.emission, 'deferred');

const externalCurriedResult = resolveTupleCallbackReturn({
    syntax: curriedSyntax,
    callback: getEstreeCallbacks({ expression: curriedCall }).callback,
    tuple
});

assert.equal(externalCurriedResult.state, 'unresolved');
assert.equal(externalCurriedResult.reason, 'dynamic-call');

const checkerWithArrayResult = {
    getTypeAtLocation: () => ({ getCallSignatures: () => [] }),
    isArrayType: () => true,
    isTupleType: () => false
};
const staticTypeScript = getTypeScriptCallbacks(
    'const next = { map: (a, state) => [a, state] }; const run = value => F.map(value, ([a, state]) => next.map(a, state));'
);
const staticTypeScriptResult = resolveTupleCallbackReturn({
    syntax: createTypeScriptTupleSyntax({ typescript, checker: checkerWithArrayResult }),
    callback: staticTypeScript.callback,
    tuple,
    functions: staticTypeScript.functions
});

assert.equal(staticTypeScriptResult.state, 'resolved');
assert.equal(staticTypeScriptResult.resolver.canonical, '[]');
assert.equal(staticTypeScriptResult.resolver.emission, 'deferred');
assert.ok(staticTypeScriptResult.evidence[0].range);

const curriedTypeScript = getTypeScriptCallbacks(
    'const next = a => state => [a, state]; const run = value => F.map(value, ([a, state]) => next(a)(state));'
);
const curriedTypeScriptResult = resolveTupleCallbackReturn({
    syntax: createTypeScriptTupleSyntax({ typescript, checker: checkerWithArrayResult }),
    callback: curriedTypeScript.callback,
    tuple,
    functions: curriedTypeScript.functions
});

assert.equal(curriedTypeScriptResult.state, 'resolved');
assert.equal(curriedTypeScriptResult.resolver.canonical, '[]');
assert.equal(curriedTypeScriptResult.resolver.emission, 'deferred');

const deferredAgreement = getTupleConsumerAgreement({
    consumer: {
        consumer: 'tuple-callback',
        tuple: { required: true, arity: 2, containers: [{ arity: 2 }] },
        resolver: staticTypeScriptResult.resolver
    }
});

assert.equal(deferredAgreement.action, 'retain-unresolved-tuple');
