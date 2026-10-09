import { getNodeParents } from '../support/ast-parents.js';
import { isTraversalMetadataKey } from '../support/ast-traversal.js';
import { getObject, hasObjectValue } from '../support/object.js';

const isAstNode = (value = {}) => {
    const { type = '' } = getObject(value);

    return Boolean(type);
};

const getAstChildren = (node = {}) => Object.keys(getObject(node))
    .filter(key => !isTraversalMetadataKey(key) && !['start', 'end'].includes(key))
    .flatMap((key = '') => {
        const { [key]: value = {} } = node;

        if (Array.isArray(value)) return value.filter(isAstNode);

        return isAstNode(value) ? [value] : [];
    });

const getPatternIdentifiers = (pattern = {}) => {
    const source = getObject(pattern);
    const {
        type = '',
        left = {},
        argument = {},
        properties = [],
        elements = []
    } = source;

    if (type === 'Identifier') return [source];

    if (type === 'AssignmentPattern') return getPatternIdentifiers(left);

    if (type === 'RestElement') return getPatternIdentifiers(argument);

    if (type === 'ArrayPattern') return elements.filter(Boolean).flatMap(getPatternIdentifiers);

    if (type !== 'ObjectPattern') return [];

    return properties.flatMap((property = {}) => {
        const { type: propertyType = '', argument: rest = {}, value = {} } = getObject(property);

        return propertyType === 'RestElement'
            ? getPatternIdentifiers(rest)
            : getPatternIdentifiers(value);
    });
};

const isFunctionNode = ({ type = '' } = {}) => [
    'ArrowFunctionExpression',
    'FunctionDeclaration',
    'FunctionExpression'
].includes(type);

const isReferenceIdentifier = ({ node = {}, parent = {} } = {}) => {
    const sourceParent = getObject(parent);
    const {
        type = '',
        computed = false,
        property = {},
        key = {},
        shorthand = false,
        value = {},
        label = {},
        imported = {},
        exported = {},
        local = {}
    } = sourceParent;

    if (type === 'MemberExpression' && property === node && !computed) return false;

    if (['Property', 'MethodDefinition', 'PropertyDefinition'].includes(type) && key === node && !computed) {
        return type === 'Property' && shorthand === true && value === node;
    }

    if (['BreakStatement', 'ContinueStatement', 'LabeledStatement'].includes(type) && label === node) return false;

    if (type === 'MetaProperty') return false;

    if (type.startsWith('Import') && imported === node) return false;

    if (type === 'ExportSpecifier' && exported === node && local !== node) return false;

    return true;
};

// A lexical index belongs to one analysis session. Scope and binding records are
// parser-neutral and use AST identity; names are labels, never lookup keys.
const createBindingIndex = (program = {}) => {
    let nextScopeId = 0;
    let nextBindingId = 0;
    const bindingsByNode = new WeakMap();
    const scopesByNode = new WeakMap();
    const parentsByNode = new WeakMap();
    const scopeBindings = new WeakMap();
    const bindingRecords = [];
    const scopeRecords = [];
    const createScope = ({ type = 'block', node = {}, parent = {} } = {}) => {
        const scope = Object.freeze({
            id: `scope-${nextScopeId += 1}`,
            type,
            node,
            parent
        });

        // eslint-disable-next-line resilient/prefer-safe-transformations -- This session-private builder publishes frozen scope records only after the complete lexical walk.
        scopeRecords.push(scope);
        // eslint-disable-next-line resilient/prefer-safe-transformations -- This session-private scope table is unreachable outside the completed lexical index.
        scopeBindings.set(scope, new Map());

        return scope;
    };
    const rootScope = createScope({ type: 'program', node: program });
    const getVariableScope = (scope = rootScope) => {
        const { type = '', parent = {} } = scope;

        return ['function', 'program'].includes(type)
            ? scope
            : getVariableScope(parent || rootScope);
    };
    const declare = ({ identifier = {}, kind = 'lexical', scope = rootScope } = {}) => {
        const { name = '' } = getObject(identifier);

        if (!name) return {};

        const bindings = scopeBindings.get(scope) || new Map();
        const existing = bindings.get(name);

        if (existing) {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- This session-private identity table records one completed declaration occurrence without mutating parser-owned nodes.
            bindingsByNode.set(identifier, existing);

            return existing;
        }

        const record = Object.freeze({
            id: `binding-${nextBindingId += 1}`,
            name,
            kind,
            declaration: identifier,
            scope
        });
        // eslint-disable-next-line resilient/prefer-safe-transformations -- The lexical builder owns this scope map until the completed index is published.
        bindings.set(name, record);
        // eslint-disable-next-line resilient/prefer-safe-transformations -- This session-private identity table records a declaration without mutating parser-owned nodes.
        bindingsByNode.set(identifier, record);
        // eslint-disable-next-line resilient/prefer-safe-transformations -- The private ordered buffer preserves declaration discovery order until frozen publication.
        bindingRecords.push(record);

        return record;
    };
    const declarePattern = ({ pattern = {}, kind = 'lexical', scope = rootScope } = {}) => {
        getPatternIdentifiers(pattern).forEach(identifier => declare({ identifier, kind, scope }));
    };
    const collect = (node = {}, scope = rootScope, parent = {}, visited = new Set()) => {
        if (!isAstNode(node) || visited.has(node)) return;

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Parent identity is analyzer-owned session state and the parser AST remains untouched.
        parentsByNode.set(node, parent);
        const nextVisited = new Set([...visited, node]);
        const source = getObject(node);
        const {
            type = '',
            id = {},
            params = [],
            param = {},
            kind = '',
            declarations = [],
            specifiers = []
        } = source;
        const createsBlock = type === 'BlockStatement' ||
            type === 'SwitchStatement' ||
            ['ForStatement', 'ForInStatement', 'ForOfStatement'].includes(type);
        const explicitScopeTypes = {
            CatchClause: 'catch',
            ClassExpression: 'class'
        };
        const { [type]: explicitScopeType = '' } = explicitScopeTypes;
        const getScopeType = () => {
            if (isFunctionNode(source)) return 'function';

            return createsBlock ? 'block' : explicitScopeType;
        };
        const scopeType = getScopeType();
        const nodeScope = scopeType ? createScope({ type: scopeType, node: source, parent: scope }) : scope;

        if (type === 'FunctionDeclaration') declare({ identifier: id, kind: 'function', scope });

        if (type === 'ClassDeclaration') declare({ identifier: id, kind: 'class', scope });

        if (type === 'FunctionExpression') declare({ identifier: id, kind: 'function-name', scope: nodeScope });

        if (isFunctionNode(source)) params.forEach(pattern => declarePattern({ pattern, kind: 'parameter', scope: nodeScope }));

        if (type === 'CatchClause') declarePattern({ pattern: param, kind: 'catch', scope: nodeScope });

        if (type === 'ClassExpression') declare({ identifier: id, kind: 'class-name', scope: nodeScope });

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Scope identity is completed in this private session table before any consumer receives the index.
        scopesByNode.set(source, nodeScope);

        if (type === 'VariableDeclaration') {
            const declarationScope = kind === 'var' ? getVariableScope(nodeScope) : nodeScope;

            declarations.forEach(({ id: declarationId = {} } = {}) => declarePattern({
                pattern: declarationId,
                kind: kind || 'lexical',
                scope: declarationScope
            }));
        }

        if (type === 'ImportDeclaration') specifiers.forEach((specifier = {}) => {
            const { type: specifierType = '', local = {} } = getObject(specifier);

            declare({
                identifier: local,
                kind: specifierType === 'ImportNamespaceSpecifier' ? 'import-namespace' : 'import',
                scope: nodeScope
            });
        });

        getAstChildren(source).forEach(child => collect(child, nodeScope, source, nextVisited));
    };
    const resolve = (scope = {}, name = '') => {
        if (!hasObjectValue(scope) || !name) return {};

        const { parent = {} } = scope;
        const bindings = scopeBindings.get(scope) || new Map();

        return bindings.get(name) || resolve(parent, name);
    };
    const resolveReferences = (node = {}, visited = new Set()) => {
        if (!isAstNode(node) || visited.has(node)) return;

        const source = getObject(node);
        const nextVisited = new Set([...visited, node]);
        const { type = '', name = '' } = source;

        if (type !== 'Identifier' || !name || bindingsByNode.has(source)) {
            getAstChildren(source).forEach(child => resolveReferences(child, nextVisited));

            return;
        }

        const parent = parentsByNode.get(source) || {};

        if (!isReferenceIdentifier({ node: source, parent })) {
            getAstChildren(source).forEach(child => resolveReferences(child, nextVisited));

            return;
        }

        const binding = resolve(scopesByNode.get(source), name);

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Reference resolution completes this private identity table without changing caller-owned AST nodes.
        if (hasObjectValue(binding)) bindingsByNode.set(source, binding);

        getAstChildren(source).forEach(child => resolveReferences(child, nextVisited));
    };

    collect(program, rootScope);
    resolveReferences(program);

    return Object.freeze({
        bindings: Object.freeze([...bindingRecords]),
        getBinding: (node = {}) => bindingsByNode.get(node) || {},
        getParent: (node = {}) => parentsByNode.get(node) || {},
        getScope: (node = {}) => scopesByNode.get(node) || {},
        getScopeBindings: (scope = {}) => [...(scopeBindings.get(scope) || new Map()).values()],
        rootScope,
        scopes: Object.freeze([...scopeRecords])
    });
};

// Lexical resolution belongs to ESLint. Imported programs retain the completed
// scope evidence as the current source; no name census substitutes for it.
let programSources = new WeakMap();
const registerBindingSource = (sourceCode = {}, context = undefined) => {
    const { ast = false } = sourceCode;

    if (!ast) return;

    const { context: previousContext = false } = programSources.get(ast) ?? {};

    // eslint-disable-next-line resilient/prefer-safe-transformations -- Retain completed parser scope by AST identity without mutating either parser-owned object.
    programSources.set(ast, { sourceCode, context: context || previousContext });
};
const clearBindingSources = () => {
    programSources = new WeakMap();
};
const getBindingRecord = (node = {}) => {
    const program = getNodeParents({ node }).find(({ type = '' } = {}) => type === 'Program') || node;

    return programSources.get(program) || {};
};
const getBindingSource = (node = {}) => {
    const { sourceCode = {} } = getBindingRecord(node);

    return sourceCode;
};
const getBindingContext = (node = {}) => {
    const { context = false } = getBindingRecord(node);

    return context;
};
const getBinding = (node = {}) => {
    const { type = '', name = '' } = getObject(node);
    const sourceCode = getBindingSource(node);
    const { getScope = false } = sourceCode;

    if (type !== 'Identifier' || !name || typeof getScope !== 'function') return false;

    const find = (scope = {}) => {
        const { set = new Map(), upper = false } = getObject(scope);

        return set.get(name) || (upper && find(upper));
    };

    return find(getScope.call(sourceCode, node));
};
const getBindingDefinition = (binding) => {
    const { defs = [] } = getObject(binding);
    const [definition = {}] = defs;

    return defs.length === 1 ? definition : {};
};
const isStableReference = (reference = {}) => {
    // eslint-disable-next-line resilient/prefer-signature-destructuring -- ESLint references inherit isWrite; preserve its receiver and its lazy read after init.
    const { init = false } = reference;

    return init || !reference.isWrite();
};
const isStableBinding = (binding) => {
    const { references = [] } = getObject(binding);

    return !!binding && references.every(isStableReference);
};
const getBindingOrigin = (binding, seen = []) => {
    if (!binding || seen.includes(binding) || !isStableBinding(binding)) return binding;

    const { type = '', node = {}, parent = {} } = getBindingDefinition(binding);
    const { id = {}, init = {} } = getObject(node);
    const { type: idType = '' } = getObject(id);
    const { type: initType = '' } = getObject(init);
    const { kind = '' } = getObject(parent);

    if (type !== 'Variable' || kind !== 'const' || idType !== 'Identifier' || initType !== 'Identifier') return binding;

    return getBindingOrigin(getBinding(init), [...seen, binding]);
};
const isSameBinding = (left = {}, right = {}) => {
    const binding = getBinding(left);
    const other = getBinding(right);

    if (binding && binding === other) return true;

    const origin = getBindingOrigin(binding);

    return isStableBinding(origin) && origin === getBindingOrigin(other);
};

export {
    clearBindingSources,
    createBindingIndex,
    getBinding,
    getBindingDefinition,
    getBindingContext,
    getBindingOrigin,
    getBindingSource,
    isSameBinding,
    isStableBinding,
    isStableReference,
    registerBindingSource
};
