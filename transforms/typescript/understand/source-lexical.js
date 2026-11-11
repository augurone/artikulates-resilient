import { resolveScopes } from '../../../analysis/analyzer/bindings.js';
import { append, put, retain } from '../../../analysis/collections.js';
import { getObject } from '../../../analysis/host/object.js';
import { traverse } from '../../../analysis/traversal.js';
import { callableCreation } from './source-callables.js';

// Scope acquisition copies lexical identities, never checker families. Unknown
// declarations still shadow supported ones. Resolution is shared with ESTree.
export const indexSource = ({ typescript = {}, sourceFile = {}, census = false } = {}) => {
    const { forEachChild = false, isFunctionLike = false, isTypeNode = false, SyntaxKind: {
        BindingElement = -1, ArrayBindingPattern = -1, ObjectBindingPattern = -1, Identifier = -1, FunctionDeclaration = -1, FunctionExpression = -1,
        VariableDeclaration = -1, ClassDeclaration = -1, ImportClause = -1, ImportSpecifier = -1, NamespaceImport = -1, CallExpression = -1, Block = -1,
        SourceFile = -1, ModuleBlock = -1, CaseBlock = -1, CatchClause = -1, ForStatement = -1, ForInStatement = -1, ForOfStatement = -1
    } = {}, NodeFlags: { Const = 0, Let = 0 } = {} } = typescript;

    if ([forEachChild, isFunctionLike, isTypeNode].some(value => typeof value !== 'function')) throw new TypeError('Expected compiler syntax readers');

    const { sourceFile: censusSource = false, children: readChildren = false } = getObject(census);

    if (census && (censusSource !== sourceFile || typeof readChildren !== 'function')) throw new Error('Compiler census source identity mismatch');

    const childrenOf = census ? readChildren : (node) => {
        const children = [];

        forEachChild(node, (child) => { append(children, child); });

        return children;
    };

    const makeScope = (execution = Symbol('compiler execution')) => ({ names: new Map(), children: [], identifiers: [], execution });
    const root = makeScope();
    const scopes = new WeakMap();
    const identities = new WeakMap();
    const functions = [];
    const calls = [];
    const nodes = [];
    const parents = new WeakMap();
    const bodyNodes = new WeakSet();
    const { execution: rootExecution = false } = root;
    const executionScopes = new Map([[rootExecution, root]]);
    const writes = new Set();
    const invalidExecutions = new Set();
    const annexExecutions = new Set();
    const declare = (name, scope, description = {}) => {
        const { kind = -1, text = '', name: target = {}, elements = [] } = getObject(name);
        const { names = new Map(), execution = false } = scope;

        if (kind === BindingElement) {
            declare(target, scope, description);

            return;
        }

        if ([ArrayBindingPattern, ObjectBindingPattern].includes(kind)) {
            elements.forEach(element => declare(element, scope, description));

            return;
        }

        if (kind !== Identifier) return;

        const previous = names.get(text);

        if (previous) retain(writes, previous);

        const binding = { ...description, name: text, execution, locationNode: name, ambiguous: names.has(text) };

        put(names, text, binding);
        put(identities, name, binding);
    };

    const scoped = new Set([Block, ModuleBlock, CaseBlock, CatchClause, ForStatement, ForInStatement, ForOfStatement]);

    traverse({ node: sourceFile, scope: root }, { enter: ({ node = {}, scope = root, parentKind = -1, parentFlags = 0, parent = false } = {}) => {
        append(nodes, node);
        put(scopes, node, scope);

        if (parent) put(parents, node, parent);

        if (isTypeNode(node)) return [];

        const { kind = -1, name = {}, body = false, parameters = [], text = '', initializer = false, flags = 0 } = node;
        const callable = isFunctionLike(node);
        const { execution = false, children: scopeChildren = [], identifiers: scopeIdentifiers = [] } = scope;

        // Only declarations in an acquired statement list can lend a callable
        // binding. Unsupported Annex B branch declarations retain uncertainty.
        if (kind === FunctionDeclaration) declare(name, scope, { callable: [SourceFile, Block].includes(parentKind) ? node : false });

        if (kind === VariableDeclaration) declare(name, (parentFlags & (Const | Let)) || parentKind === CatchClause ? scope : executionScopes.get(execution),
            { initializer, stable: Boolean(parentFlags & Const) });

        if ([ClassDeclaration, ImportClause, ImportSpecifier, NamespaceImport].includes(kind)) declare(name, scope);

        if (kind === Identifier) append(scopeIdentifiers, { node, name: text });

        if (kind === CallExpression) append(calls, node);

        const blockScope = scoped.has(kind) ? makeScope(execution) : scope;
        const own = callable ? makeScope() : blockScope;

        if (own !== scope) append(scopeChildren, own);

        // A named expression's self-binding exists only in its own lexical
        // environment. It cannot borrow or overwrite an enclosing name.
        if (callable && kind === FunctionExpression) declare(name, own, { callable: node });

        const { execution: ownExecution = false } = own;

        if (callable && body) retain(bodyNodes, body);

        if (callable) {
            put(executionScopes, ownExecution, own);

            append(functions, { node, scope: own, parentExecution: execution });
            parameters.forEach(({ name = {} } = {}, position) => {
                declare(name, own, { parameter: position });
            });
        }

        return childrenOf(node).map(child => ({ node: child, scope: own, parent: node, parentKind: kind, parentFlags: flags }));
    } });
    resolveScopes(root, ({ identifiers = [] } = {}, active) => identifiers.forEach(({ node = {}, name = '' } = {}) => {
        const binding = active.get(name);

        if (binding) put(identities, node, binding);
    }));

    const { SyntaxKind: { BinaryExpression = -1, FirstAssignment = -1, LastAssignment = -1, PrefixUnaryExpression = -1,
        PostfixUnaryExpression = -1, PlusPlusToken = -1, MinusMinusToken = -1, WithStatement = -1 } = {} } = typescript;

    const uses = new Map();

    nodes.forEach((node) => {
        const binding = identities.get(node);

        const { locationNode = false } = binding ?? {};

        if (binding && node !== locationNode) put(uses, binding, (uses.get(binding) || 0) + 1);
    });
    const inert = new Set(functions.filter(({ node = {}, parentExecution = false } = {}) => {
        const { kind = -2, name = {} } = node;
        const { kind: parentKind = -2, name: parentName = {} } = parents.get(node) ?? {};
        const binding = identities.get(kind === FunctionDeclaration ? name : parentName);

        return parentExecution !== rootExecution && (kind === FunctionDeclaration || parentKind === VariableDeclaration) && binding && !uses.has(binding);
    }).map(({ scope: { execution = false } = {} } = {}) => execution));
    const { externalModuleIndicator = false } = sourceFile;

    nodes.forEach((node = {}) => {
        const { kind = -2, operatorToken: { kind: operator = -2 } = {}, operator: unary = -2, left = {}, operand = {} } = node;
        const assignment = kind === BinaryExpression && operator >= FirstAssignment && operator <= LastAssignment;
        const update = [PrefixUnaryExpression, PostfixUnaryExpression].includes(kind) && [PlusPlusToken, MinusMinusToken].includes(unary);
        const { execution = false } = scopes.get(node) ?? {};
        const target = assignment ? left : operand;
        const binding = identities.get(target);

        if (assignment || update || kind === WithStatement) retain(invalidExecutions, execution);

        if ((assignment || update) && binding && !inert.has(execution)) retain(writes, binding);

        const parent = parents.get(node);
        const { kind: parentKind = -2 } = parent ?? {};

        const annex = kind === FunctionDeclaration && !externalModuleIndicator && parentKind === Block && !bodyNodes.has(parent);

        if (annex) retain(annexExecutions, execution);

        if (annex || (kind === FunctionDeclaration && ![SourceFile, Block].includes(parentKind))) retain(invalidExecutions, execution);
    });

    const dynamic = nodes.some(({ kind = -2, expression = {} } = {}) => {
        const { kind: calleeKind = -2, text = '' } = expression;

        return kind === WithStatement || (kind === CallExpression && calleeKind === Identifier && text === 'eval' && !identities.has(expression));
    });

    return { root, scopes, identities, functions, calls, writes, invalidExecutions, annexExecutions, dynamic, nodes: nodes.length };
};

// A local alias must already be initialized in this execution. Its initializer
// becomes an ordinary shared link; this test supplies no value or return proof.
export const localAlias = (node, identities, scopes) => {
    const { stable = false, ambiguous = false, initializer = false, execution = false } = identities.get(node) ?? {};
    const { execution: current = false } = scopes.get(node) ?? {};
    const { end = Infinity } = getObject(initializer);
    const { pos = -1 } = getObject(node);

    return stable && !ambiguous && execution === current && end <= pos ? initializer : false;
};

// Follow only initialized local aliases to an existing callable binding. This
// copies lexical identity; body admission and invocation remain caller-owned.
export const createCallableReferences = ({ typescript = {},
    identities = new WeakMap(), scopes = new WeakMap() } = {}) => {
    const { SyntaxKind: { Identifier = -1, ParenthesizedExpression = -1, AsExpression = -1, NonNullExpression = -1, SatisfiesExpression = -1 } = {} } = typescript;
    const transparent = new Set([ParenthesizedExpression, AsExpression, NonNullExpression, SatisfiesExpression]);
    const references = new WeakMap();
    const dependency = (node = {}) => {
        const { kind = -2, expression = false } = node;

        if (transparent.has(kind)) return expression;

        const { callable = false, ambiguous = false } = identities.get(node) ?? {};

        return kind === Identifier && !callable && !ambiguous ? localAlias(node, identities, scopes) : false;
    };

    return (node) => {
        traverse(node, { enter: current => references.has(current) ? [] : [dependency(current)].filter(Boolean), leave: (current = {}) => {
            if (references.has(current)) return;

            const { kind = -2 } = current;
            const binding = identities.get(current);
            const { callable = false, ambiguous = false } = binding ?? {};
            const reference = callableCreation({ typescript, node: current }) ? { callable: current }
                : ((kind === Identifier && !ambiguous) || transparent.has(kind)) && (callable ? binding : references.get(dependency(current)));

            put(references, current, reference || false);
        } });

        return references.get(node) || false;
    };
};
