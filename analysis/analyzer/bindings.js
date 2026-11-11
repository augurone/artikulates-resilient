import { append, forget, put, retain } from '../collections.js';
import { acquireInitializers } from './initializers.js';
import { validRange } from './locations.js';
import { childrenOf, patternChildren, patternNames, patternDeclarations, traverse } from './traversal.js';
import { acquireUseContexts } from './use-contexts.js';

const functions = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'];
const loops = ['ForStatement', 'ForInStatement', 'ForOfStatement'];
const destructured = ({ type = '' } = {}) => ['ObjectPattern', 'ArrayPattern'].includes(type);
const opaquePatterns = (params, observe) => {
    const opaque = new Set();
    const names = new Set();

    params.forEach(pattern => patternNames(pattern).forEach((name) => {
        if (names.has(name)) retain(opaque, pattern);

        retain(names, name);
    }));

    params.forEach(pattern => traverse(pattern, { enter: (node = {}) => {
        const { type = '', right = {}, key = {}, computed = false } = node;
        const computedKey = type === 'Property' && computed;

        if (type === 'AssignmentPattern' && typeof observe === 'function') observe(right);

        if (computedKey) retain(opaque, node);

        if (computedKey && typeof observe === 'function') observe(key);

        return patternChildren(node);
    } }));

    return Boolean(opaque.size);
};
const initializedBefore = ({ init: { range: initialized = [] } = {}, node: { range: read = [] } = {} } = {}) => {
    return validRange(initialized) && validRange(read) && initialized.at(1) <= read.at(0);
};

// Both syntax acquisitions resolve completed scopes here. Each declaration is
// installed once and restored once; later shadows cannot borrow an outer value.
export const resolveScopes = (root, observe) => {
    if (typeof observe !== 'function') throw new TypeError('Expected lexical scope observation');

    const active = new Map();
    const restored = new WeakMap();

    traverse(root, { enter: (scope = {}) => {
        const { names = new Map(), children = [] } = scope;
        const previous = [...names].map(([name = '', binding = {}] = []) => {
            const prior = active.get(name);

            put(active, name, binding);

            return { name, prior };
        });

        put(restored, scope, previous);
        observe(scope, active);

        return children;
    }, leave: (scope) => {
        restored.get(scope).forEach(({ name = '', prior = false } = {}) => put(active, name, prior));
    } });
};

// Declaration identity and name resolution belong here. No contract inference.
// Separate scope collection from resolution so a later shadow never borrows
// evidence from an outer binding, including before its initialization.
export const indexBindings = ({ program = {}, operations = new Map(), registry = {}, bindingOffset = 0, functionOffset = 0 } = {}) => {
    const bindings = [];
    const candidates = [];
    const destructurings = [];
    const calls = [];
    const selectedCalls = [];
    const functionEntries = [];
    const declarationsList = [];
    const invocations = [];
    const firstWrites = new Map();
    const { identities = new WeakMap(), callableResolutions = new WeakMap(), executionOf = new WeakMap(), parents = new WeakMap(),
        writes = new Set(), opaqueExecutions = new Set(), opaqueCapabilities = new Set(), executionParents = new Map(),
        previousStatements = new WeakMap(), nextStatements = new WeakMap(), operators = new WeakMap(), dynamicExecutions = new Set(),
        effects = new Map(), argumentOwners = new Map(), controlExecutions = new Set(), initializerFacts = new WeakMap() } = registry;
    const references = [];
    const contextFor = acquireUseContexts({ parents, operators });
    const memberAccesses = [];
    const expressionStatements = [];
    const initializers = [];
    const initializerNames = new Map();
    const counts = new Map([['nodes', 0], ['scopes', 0], ['reads', 0]]);
    const createScope = ({ parent = false, execution = Symbol('execution boundary') } = {}) => {
        const scope = { names: new Map(), children: [], identifiers: [], writes: [], execution };

        put(counts, 'scopes', counts.get('scopes') + 1);

        if (parent) {
            const { children = [] } = parent;

            append(children, scope);
        }

        return scope;
    };
    const root = createScope();
    const patternEntries = (pattern, execution) => patternDeclarations(pattern, ({ node = {}, parent = false } = {}) => {
        if (parent) put(parents, node, parent);

        put(executionOf, node, execution);
    });
    const declare = ({ scope = {}, pattern = {}, init = false, stable = false, immutable = false, imported = false,
        parameter = {}, parameterPattern = false, functionSource = false } = {}) => {
        const { names = new Map(), execution = false } = scope;

        const entries = patternEntries(pattern, execution);

        entries.forEach((declaration) => {
            const { node = {}, destructured = false, objectProperty = false, defaulted = false, rest = false } = declaration;
            const { type = '', name = '' } = node;

            if (type !== 'Identifier') {
                append(declarationsList, { ...declaration, execution, parameterPattern, init, pattern });

                return;
            }

            const previous = names.get(name);
            const { functionSource: priorFunction = false } = previous ?? {};

            if (previous && (functionSource || priorFunction)) retain(writes, previous);

            if (previous && init) {
                const { range: [start = -1] = [] } = node;

                retain(writes, previous);
                put(firstWrites, previous, Math.min(firstWrites.get(previous) ?? Infinity, start));
            }

            if (previous) return;

            const binding = { name, execution, init, stable, immutable: immutable || parameterPattern, imported,
                optionalCallback: parameterPattern && objectProperty && !defaulted && !rest,
                parameter: destructured ? {} : parameter, parameterSource: parameter, pattern, functionSource, declaration, parameterPattern,
                index: bindingOffset + bindings.length, available: true };

            put(names, name, binding);
            put(identities, node, binding);
            append(bindings, binding);

            if (destructured) append(declarationsList, { ...declaration, execution, parameterPattern, binding, init, pattern });
        });

        return entries;
    };
    const countRead = ({ type = '' } = {}) => {
        if (type === 'Identifier') put(counts, 'reads', counts.get('reads') + 1);
    };
    const collectDestructuring = ({ pattern = {}, node = false, scope = {}, entries = [] } = {}) => {
        const { type = '', properties = [] } = pattern;

        if (!node || !['ObjectPattern', 'ArrayPattern'].includes(type)) return;

        // Computed object keys can consume arrays without a record-family
        // obligation. Nested values/defaults need their own source evidence.
        if (properties.some(({ computed = false } = {}) => computed)) return;

        const { execution = false } = scope;

        append(destructurings, { node, pattern, entries: entries.length ? entries : patternEntries(pattern, execution), expected: type === 'ArrayPattern' ? 'array' : 'object' });
        countRead(node);
    };
    const declarations = ({ node: { kind = '', declarations: entries = [] } = {}, scope = {}, variable = {} } = {}) => {
        entries.forEach(({ id = {}, init = false } = {}) => {
            const { type = '' } = id;
            const stable = kind === 'const' && type === 'Identifier' && Boolean(init);

            const entries = declare({ scope: kind === 'var' ? variable : scope, pattern: id, init, stable, immutable: kind === 'const' });

            if (stable) countRead(init);

            collectDestructuring({ pattern: id, node: init, scope, entries });
        });
    };
    const collectCall = ({ node = {}, chain = false } = {}) => {
        const { callee = {}, optional = false, arguments: argumentsList = [] } = node;
        const { type = '', computed = false, optional: optionalMember = false, object = {}, property: { name = '' } = {} } = callee;

        if (type === 'Identifier' || (type === 'MemberExpression' && !computed && ['call', 'apply'].includes(name))) append(invocations, { node, subject: type === 'Identifier' ? callee : object });

        if (['Identifier', 'MemberExpression', 'CallExpression', 'ArrowFunctionExpression', 'FunctionExpression', 'ConditionalExpression', 'AwaitExpression'].includes(type)) {
            append(type === 'Identifier' ? calls : selectedCalls, { node, callee, argumentsList, conditional: chain || optional || optionalMember });
            countRead(callee);
            argumentsList.forEach(countRead);
        }

        if (type !== 'MemberExpression' || computed || !operations.has(name)) return;

        append(candidates, { node: object, operation: name, conditional: chain || optional || optionalMember });
        countRead(object);
    };
    const observeDynamic = ({ type = '', callee: { type: calleeType = '', name = '' } = {} } = {}, execution) => {
        if (type !== 'WithStatement' && !(type === 'CallExpression' && calleeType === 'Identifier' && name === 'eval')) return;

        retain(dynamicExecutions, execution);
        retain(opaqueExecutions, execution);
    };
    const observeEffect = (node = {}, execution) => {
        const { type = '', computed = false, key = {}, range: [start = -1, end = -1] = [] } = node;
        const operator = operators.get(node) || '';
        const effect = ['CallExpression', 'NewExpression', 'MemberExpression', 'AssignmentExpression', 'UpdateExpression', 'SpreadElement',
            'AwaitExpression', 'YieldExpression', 'TaggedTemplateExpression', 'ClassDeclaration', 'ClassExpression', 'WithStatement', 'TemplateLiteral'].includes(type) ||
            (type === 'UnaryExpression' && !['!', 'typeof', 'void'].includes(operator)) ||
            (type === 'BinaryExpression' && !['===', '!=='].includes(operator)) || (type === 'Property' && computed);

        if (!effect) return;

        const { range: [, keyEnd = -1] = [] } = key;
        const before = ['ClassDeclaration', 'ClassExpression', 'WithStatement', 'TemplateLiteral'].includes(type);
        const after = type === 'Property' ? keyEnd : end;
        const position = before ? start : after;

        append(effects.get(execution) || put(effects, execution, []), { node, position });
    };
    const observeInitializer = (node, scope = {}, nested = []) => {
        const { execution = false, identifiers = [], writes: assigned = [] } = scope;
        append(initializers, { node, execution });
        const names = initializerNames.get(execution) || put(initializerNames, execution, new Set());
        // Acquisition resolves inert reads and records hidden dynamic lookup.
        // Nested function bodies own separate executions; opaque expressions
        // are recorded here without interpreting their values or effects.
        traverse(node, { enter: (current = {}) => {
            const { type = '', operator = '', name = '', left = false, argument = false } = current;

            if (['AssignmentExpression', 'UpdateExpression'].includes(type)) {
                patternNames(left || argument).forEach(name => append(assigned, name));
            }

            if (type === 'Identifier') {
                append(identifiers, current);
                retain(names, name);
            }

            put(executionOf, current, execution);
            observeDynamic(current, execution);

            if (operator) put(operators, current, operator);

            observeEffect(current, execution);

            if (functions.includes(type)) append(nested, { node: current, scope, variable: scope });

            return functions.includes(type) ? [] : childrenOf(current);
        } });
    };
    const enterFunction = ({ node = {}, scope = {} } = {}) => {
        const { type = '', id = false, params = [], body = {} } = node;
        const named = createScope({ parent: scope });
        const { execution = false } = named;
        const own = type === 'FunctionExpression' && id ? createScope({ parent: named, execution }) : named;
        const { execution: parentExecution = false } = scope;
        const nested = [];

        put(executionParents, execution, parentExecution);
        put(argumentOwners, execution, type === 'ArrowFunctionExpression' ? argumentOwners.get(parentExecution) : execution);

        if (opaquePatterns(params, node => observeInitializer(node, own, nested))) retain(opaqueExecutions, execution);

        append(functionEntries, { node, params, body, execution, index: functionOffset + functionEntries.length });

        if (type === 'FunctionExpression' && id) declare({ scope: named, pattern: id, functionSource: node });

        params.forEach((pattern, index) => {
            put(parents, pattern, node);
            const { type: parameterType = '', left = {}, right = false } = pattern;
            const selected = parameterType === 'AssignmentPattern' ? left : pattern;

            declare({ scope: own, pattern, parameterPattern: true, parameter: { index, fallback: right, origin: selected } });
        });

        // Default closures belong to the parameter environment, outside body
        // declarations. Their bodies enter the same function acquisition path.
        return [...nested, { node: body, parent: node, scope: own, variable: own, functionBody: true }];
    };
    const enterCatch = ({ node = {}, scope = {}, variable = {}, chain = false } = {}) => {
        const { param = false, body = {} } = node;
        const { execution = false } = scope;
        const own = createScope({ parent: scope, execution });

        // Binding a caught pattern can throw or run defaults/getters before the
        // handler body. Its effects are not owned by this completion slice.
        if (param) declare({ scope: own, pattern: param });

        if (param && (opaquePatterns([param], node => observeInitializer(node, own)) || destructured(param))) retain(opaqueExecutions, execution);

        return [{ node: body, parent: node, scope: own, variable, chain }];
    };
    const collectIdentity = ({ node = {}, parent = {}, scope: { identifiers = [] } = {}, execution = false } = {}) => {
        const { type = '' } = node;

        if (!['Identifier', 'JSXIdentifier'].includes(type)) return;

        const { type: parentType = '', computed = false, key = false, value = false, property = false, object = false, name: tag = false } = parent;
        const { type: namespaceOwner = '' } = parentType === 'JSXNamespacedName' ? parents.get(parent) ?? {} : {};
        // JSX lowering belongs to the host. Tag roots may consume a lexical
        // binding; attribute names and member suffixes do not identify that root.
        const unsupported = type === 'JSXIdentifier' && ((['JSXOpeningElement', 'JSXClosingElement'].includes(parentType) && tag === node) ||
            (parentType === 'JSXMemberExpression' && object === node) ||
            (parentType === 'JSXNamespacedName' && ['JSXOpeningElement', 'JSXClosingElement'].includes(namespaceOwner)));

        if (type !== 'Identifier' && !unsupported) return;

        if (['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(parentType)) return;

        if (!computed && ((parentType === 'Property' && key === node && value !== node) || (parentType === 'MemberExpression' && property === node))) return;

        append(identifiers, node);
        append(references, { node, parent, execution, unsupported });
    };
    const enter = ({ node = {}, parent = false, scope = root, variable = root, functionBody = false, chain = false } = {}) => {
        const { type = '', id = false, discriminant = false, cases = [] } = node;
        const { execution = false } = scope;
        const childScope = () => createScope({ parent: scope, execution });

        put(counts, 'nodes', counts.get('nodes') + 1);
        put(executionOf, node, execution);

        if (['UnaryExpression', 'BinaryExpression', 'LogicalExpression', 'AssignmentExpression'].includes(type)) {
            const { operator = '' } = node;

            put(operators, node, operator);
        }

        if (parent) put(parents, node, parent);

        collectIdentity({ node, parent, scope, execution });

        observeDynamic(node, execution);
        observeEffect(node, execution);

        if (['AssignmentExpression', 'UpdateExpression', 'ForInStatement', 'ForOfStatement'].includes(type)) {
            const { left = false, argument = false } = node;
            const { writes: assigned = [] } = scope;

            patternNames(left || argument).forEach(name => append(assigned, name));
        }

        if (['FunctionDeclaration', 'ClassDeclaration'].includes(type) && id) declare({ scope, pattern: id, functionSource: type === 'FunctionDeclaration' && node });

        if (['IfStatement', 'DoWhileStatement'].includes(type)) retain(controlExecutions, execution);

        if (functions.includes(type)) return enterFunction({ node, scope });

        if (['ClassDeclaration', 'ClassExpression'].includes(type)) {
            retain(opaqueExecutions, execution);

            return [];
        }

        // Dynamic lookup cannot use a lexical name as evidence.
        if (type === 'WithStatement') return [];

        if (type === 'BlockStatement') {
            const own = childScope();
            const entries = childrenOf(node);

            return entries.map((child, position) => {
                if (position) put(previousStatements, child, entries.at(position - 1));

                if (position + 1 < entries.length) put(nextStatements, child, entries.at(position + 1));

                return { node: child, parent: node, scope: own, variable: functionBody ? own : variable, chain };
            });
        }

        if (type === 'CatchClause') return enterCatch({ node, scope, variable, chain });

        if (loops.includes(type)) {
            const own = childScope();

            return childrenOf(node).map(child => ({ node: child, parent: node, scope: own, variable, chain }));
        }

        if (type === 'SwitchStatement') {
            const own = childScope();

            // The discriminant runs outside the lexical case-block environment.
            return [{ node: discriminant, parent: node, scope, variable, chain }, ...cases.map(child => ({ node: child, parent: node, scope: own, variable, chain }))];
        }

        if (type === 'VariableDeclaration') declarations({ node, scope, variable });

        if (type === 'AssignmentExpression') {
            const { left = {}, right = {} } = node;

            // A valid parser pattern on an assignment consumes its RHS. This
            // records that requirement, never a declaration or a new value for
            // the destination. Mutable bindings retain unknown source evidence.
            collectDestructuring({ pattern: left, node: right, scope });
        }

        if (type === 'ImportDeclaration') {
            const { specifiers = [] } = node;

            specifiers.forEach(({ local = {} } = {}) => declare({ scope, pattern: local, imported: true, immutable: true }));
        }

        if (type === 'CallExpression') collectCall({ node, chain });

        if (type === 'MemberExpression') append(memberAccesses, { node, parent, execution, conditional: chain });

        if (type === 'ExpressionStatement') append(expressionStatements, node);

        return childrenOf(node).map(child => ({ node: child, parent: node, scope, variable, chain: chain || type === 'ChainExpression' }));
    };

    traverse({ node: program }, { enter });

    resolveScopes(root, ({ identifiers = [], writes: assigned = [] } = {}, active) => {
        assigned.forEach((name) => {
            const binding = active.get(name);

            if (binding) retain(writes, binding);
        });
        identifiers.forEach((node) => {
            const { name = '' } = node;
            const binding = active.get(name);

            if (!binding) return;

            put(identities, node, binding);
            const { stable = false, init = {}, imported = false, functionSource = false } = binding;

            if (imported || functionSource || (stable && initializedBefore({ init, node }))) put(callableResolutions, node, binding);
        });
    });

    references.forEach(({ node = {}, execution = false } = {}) => {
        const binding = identities.get(node);
        const { mutation = false } = contextFor(node);

        // An unresolved read may invoke a global accessor before a later
        // declaration lookup. Lexical reads do not execute the callee's body.
        if (!binding) {
            const { range: [, end = -1] = [] } = node;

            append(effects.get(execution) || put(effects, execution, []), { node, position: end });
        }

        if (!binding || !mutation || !writes.has(binding)) return;

        const { execution: owner = false } = binding;
        const { range: [start = -1] = [] } = node;

        put(firstWrites, binding, Math.min(firstWrites.get(binding) ?? Infinity, owner === execution ? start : -Infinity));
    });
    references.forEach(({ node = {}, execution = false } = {}) => {
        const binding = identities.get(node);
        const { init = false, immutable = false, execution: owner = false } = binding ?? {};
        const { repeated = false } = contextFor(node);
        const { range: [start = -1] = [] } = node;
        const { execution: moduleExecution = false } = root;

        // A local mutable binding still holds its initializer before its first
        // write. Captured writes and repeated reads cannot use text order as proof.
        if (!binding || immutable || !init || owner !== execution || owner === moduleExecution || repeated ||
            start < 0 || start >= (firstWrites.get(binding) ?? Infinity) || !initializedBefore({ init, node })) return;

        put(callableResolutions, node, binding);
    });

    references.forEach(({ node = {}, parent = {}, execution = false } = {}) => {
        const { name = '' } = node;

        if (name !== 'arguments' || identities.has(node)) return;

        const { type = '', object = false, computed = false, property: { name: property = '' } = {} } = parent;
        const { receiver = false, mutation = false } = contextFor(node);
        const lengthRead = argumentOwners.has(execution) && argumentOwners.get(execution) && type === 'MemberExpression' && object === node &&
            !computed && property === 'length' && !receiver && !mutation;

        if (!lengthRead) retain(opaqueExecutions, execution);
    });

    acquireInitializers({ initializers, identities, inert: initializerFacts });

    // Unknown parameter effects do not erase stable bindings after entry.
    // Dynamic lookup, argument aliases and opaque lexical constructs still do.
    [executionOf.get(program), ...functionEntries.map(({ execution = false } = {}) => execution)]
        .filter(execution => opaqueExecutions.has(execution)).forEach(execution => retain(opaqueCapabilities, execution));

    initializers.forEach(({ node = {}, execution = false } = {}) => {
        if (!initializerFacts.get(node)) retain(opaqueExecutions, execution);
    });

    // Dynamic lookup can introduce an enclosing binding that static lexical
    // resolution cannot see. Descendants cannot borrow an intrinsic or guard
    // through that environment. Ordinary opaque effects do not spread sideways.
    functionEntries.forEach(({ execution = false } = {}) => {
        if (!dynamicExecutions.has(executionParents.get(execution))) return;

        retain(dynamicExecutions, execution);
        retain(opaqueExecutions, execution);
        retain(opaqueCapabilities, execution);
    });

    // Unowned dynamic effects in a nested execution may write an enclosing
    // parameter. Classify defaults after lexical resolution, then propagate once.
    functionEntries.toReversed().forEach(({ execution = false } = {}) => {
        if (opaqueExecutions.has(execution)) retain(opaqueExecutions, executionParents.get(execution));

        if (opaqueCapabilities.has(execution)) retain(opaqueCapabilities, executionParents.get(execution));
    });

    [executionOf.get(program), ...functionEntries.map(({ execution = false } = {}) => execution)].forEach((execution) => {
        const entries = effects.get(execution);

        if (entries) put(effects, execution, entries.toSorted(({ position: a = -1 } = {}, { position: b = -1 } = {}) => a - b));
    });

    references.forEach(({ node = {}, execution = false } = {}) => {
        const binding = identities.get(node);
        const { execution: owner = false, functionSource: { type = '' } = {} } = binding ?? {};

        if (type !== 'FunctionDeclaration' || !opaqueExecutions.has(owner)) return;

        const { repeated = false } = contextFor(node);
        const { range: [start = -1] = [] } = node;
        const [{ position: firstEffect = Infinity } = {}] = effects.get(execution) || [];
        const initial = owner === execution && !repeated && start >= 0 && start < firstEffect;

        if (!initial) forget(callableResolutions, node);
    });

    const { execution: rootExecution = false, names: rootBindings = new Map() } = root;

    return { bindings, declarations: declarationsList, invocations, candidates, destructurings, calls: [...calls, ...selectedCalls], identities, callableResolutions, executionOf, parents,
        references, memberAccesses, expressionStatements, contextFor, effects, argumentOwners, controlExecutions,
        rootExecution, rootBindings, previousStatements, nextStatements, operators, initializerNames, initializerFacts, dynamicExecutions,
        functionEntries, executionParents, writes, opaqueExecutions, opaqueCapabilities, counts: { ...Object.fromEntries(counts), bindings: bindings.length } };
};
