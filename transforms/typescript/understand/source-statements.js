import { sequenceFlow } from '../../../analysis/analyzer/flow.js';
import { unknownOwner } from '../../../analysis/analyzer/uncertainty.js';
import { put } from '../../../analysis/collections.js';
import { traverse } from '../../../analysis/traversal.js';

// The shared lifetime operation observes already reached completion. Discarded
// statement/test results cannot themselves escape a value to another owner.
export const sourceLifetime = ({ own, call = false, prior = false } = {}) => {
    if (typeof own !== 'function') throw new TypeError('Expected compiler lifetime storage');

    return call ? own({ kind: 'lifetime', call, prior, ordered: true, discardResult: true }) : prior;
};

// Compiler statement edges and source order become owned completion templates.
// No branch, call, initializer, failure or lifetime is evaluated here.
export const acquireStatementFlow = ({ typescript = {}, statements = [], initialization = [], own, expressionFor, location, absence = false } = {}) => {
    if (typeof own !== 'function' || typeof expressionFor !== 'function' || typeof location !== 'function') throw new TypeError('Expected compiler statement acquisition capabilities');

    const { SyntaxKind: { Block = -1, IfStatement = -1, FunctionDeclaration = -1, VariableStatement = -1, ReturnStatement = -1,
        ThrowStatement = -1, ExpressionStatement = -1, EmptyStatement = -1, ExportDeclaration = -1, Identifier = -1 } = {} } = typescript;
    const empty = own({ kind: 'continue' });
    const combine = entries => sequenceFlow(entries.filter(entry => entry !== empty), own, empty);
    const root = Symbol('statement sequence');
    const sequences = new Map([[root, combine(initialization)]]);
    const contexts = new WeakMap();
    const flows = new WeakMap();
    const read = node => node ? flows.get(node) : empty;
    const lifetimeFor = (group, prior) => sourceLifetime({ own, call: sequences.get(group) || false, prior });
    const effect = (node, lifetime) => own({ kind: 'effect', argument: expressionFor(node, lifetime), location: location(node) });
    const compile = (node = {}) => {
        const { lifetime = false, test = false } = contexts.get(node) ?? {};
        const { kind = -2, expression = false, thenStatement = false, elseStatement = false,
            declarationList: { declarations = [] } = {}, moduleSpecifier = false } = node;

        if ([FunctionDeclaration, EmptyStatement].includes(kind) || (kind === ExportDeclaration && !moduleSpecifier)) return empty;

        if (kind === Block) return sequences.get(node) || empty;

        if (kind === IfStatement) return own({ kind: 'branch', test, yes: read(thenStatement), no: read(elseStatement), location: location(node) });

        if ([ReturnStatement, ThrowStatement].includes(kind)) return own({ kind: kind === ReturnStatement ? 'return' : 'throw',
            argument: expression ? expressionFor(expression, lifetime) : absence, location: location(expression || node) });

        if (kind === ExpressionStatement) return effect(expression, lifetime);

        if (kind === VariableStatement) return declarations.reduce((prior, { initializer = false, name: { kind = -2 } = {} } = {}) => {
            if (kind !== Identifier) return own({ kind: 'unsupported', location: location(node), owner: unknownOwner({ code: 'unsupported-statement', location: location(node) }) });

            if (!initializer) return prior;

            return combine([prior, effect(initializer, sourceLifetime({ own, call: prior === empty ? false : prior, prior: lifetime }))]);
        }, empty);

        return own({ kind: 'unsupported', location: location(node), owner: unknownOwner({ code: 'unsupported-statement', location: location(node) }) });
    };

    statements.forEach(node => traverse({ node, group: root, prior: false }, { enter: ({ node = {}, group = root, prior = false } = {}) => {
        const lifetime = lifetimeFor(group, prior);
        const { kind = -2, statements = [], expression = {}, thenStatement = false, elseStatement = false } = node;
        const test = kind === IfStatement ? expressionFor(expression, lifetime) : false;

        put(contexts, node, { group, lifetime, test });

        if (kind === Block) return statements.map(child => ({ node: child, group: node, prior: lifetime }));

        const branchLifetime = sourceLifetime({ own, call: test, prior: lifetime });

        return kind === IfStatement ? [thenStatement, elseStatement].filter(Boolean).map(node => ({ node, group: Symbol('branch'), prior: branchLifetime })) : [];
    }, leave: ({ node = {}, group = root } = {}) => {
        const flow = compile(node);

        put(flows, node, flow);
        put(sequences, group, combine([sequences.get(group) || empty, flow]));
    } }));

    return sequences.get(root);
};
