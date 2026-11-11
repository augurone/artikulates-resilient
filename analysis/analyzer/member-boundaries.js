import { append, put, retain } from '../collections.js';
import { propertyName } from '../estree-properties.js';
import { traverse } from '../traversal.js';
import { intrinsicFamilies, nativeFunctions, nativePaths, prototypeAccessMembers, reflectiveMembers } from './native-members.js';
import { acquireRecordSources } from './records.js';

const exported = ({ declaration: { node = {} } = {} } = {}, parents) => {
    const declaration = parents.get(parents.get(node));
    const { type = '' } = parents.get(declaration) ?? {};

    return type === 'ExportNamedDeclaration';
};

// Native identity and exposure own no record alias, capture or lifetime state.
const acquireNativeBoundaries = ({ bindings = [], references = [], memberAccesses = [], identities = new WeakMap(), callableResolutions = new WeakMap(),
    parents = new WeakMap(), writes = new Set(), opaqueExecutions = new Set(), executionOf = new WeakMap() } = {}, contextFor, containerFor) => {
    const intrinsics = new Set(['Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Object', 'Function', 'RegExp', 'Reflect', 'Promise']);
    const ambient = new Set(['globalThis', 'window', 'global']);
    const nativeAliases = new WeakMap();
    const nativeSelections = new WeakMap();
    const exposedIntrinsics = new Map();
    const exposedArguments = new WeakMap();
    const expose = (name, call = false, argument = false) => {
        const family = intrinsicFamilies.get(name.split('.').at(0)) || 'all';
        const uses = exposedIntrinsics.get(family) || put(exposedIntrinsics, family, new Set());

        retain(uses, call);

        if (call) {
            const { arguments: inputs = [] } = call;

            retain(exposedArguments.get(call) || put(exposedArguments, call, new Set()), inputs.indexOf(argument));
        }
    };
    memberAccesses.forEach(({ node: { computed = false, property = {} } = {} } = {}) => {
        const { name = '' } = propertyName({ computed, key: property });

        if (prototypeAccessMembers.has(name)) expose(name);
    });
    const intrinsicName = (node = {}) => {
        if (!node) return '';

        const { type = '', name = '' } = node;
        const binding = identities.get(node);

        return type === 'Identifier' && !binding && intrinsics.has(name) ? name : nativeAliases.get(binding) || '';
    };
    const intrinsicFor = (node = {}) => {
        if (!node) return '';

        traverse(node, { enter: (current = {}) => {
            const { type = '', computed = false, object = {} } = current;

            return nativeSelections.has(current) || type !== 'MemberExpression' || computed ? [] : [object];
        }, leave: (current = {}) => {
            if (nativeSelections.has(current)) return;

            const { type = '', computed = false, object = {}, property: { name = '' } = {} } = current;
            const path = `${nativeSelections.get(object) || ''}.${name}`;
            const selected = type === 'MemberExpression' && !computed ? nativePaths.has(path) && path : intrinsicName(current);

            put(nativeSelections, current, selected || '');
        } });

        return nativeSelections.get(node);
    };
    bindings.forEach((binding) => {
        const { init = {}, immutable = false, declaration: { destructured = false } = {} } = binding;
        const intrinsic = init && immutable && !destructured && !writes.has(binding) && intrinsicFor(init);

        const { receiverBound = false } = nativeFunctions.get(intrinsic) ?? {};

        if (intrinsic && !receiverBound) put(nativeAliases, binding, intrinsic);

        if (intrinsic && exported(binding, parents)) expose(intrinsic);
    });
    references.forEach(({ node = {}, parent = {} } = {}) => {
        const { name = '' } = node;
        const intrinsic = intrinsicFor(node);
        const { declaration: { node: declared = false } = {} } = identities.get(node) ?? {};

        if (declared === node) return;

        if (ambient.has(name) && !identities.has(node)) expose(name);

        if (!intrinsic) return;

        const { type = '', id = {}, init = false, computed = false, property = {} } = parent;
        const { known = false, name: selectedName = '' } = propertyName({ computed, key: property });
        const reflective = reflectiveMembers.get(intrinsic);

        if (type === 'MemberExpression' && reflective && (!known || reflective.has(selectedName))) expose(intrinsic);

        if (type === 'VariableDeclarator' && init === node && nativeAliases.get(identities.get(id)) === intrinsic) return;

        const container = containerFor(node);
        const { type: use = '', callee = false, init: initializer = false } = parents.get(container) ?? {};
        const { mutation = false } = contextFor(node);

        const invoking = ['CallExpression', 'NewExpression'].includes(use);

        if (type === 'MemberExpression' && known && nativePaths.has(`${intrinsic}.${selectedName}`) && use === 'VariableDeclarator' && initializer === container) return;

        if (mutation || !invoking || callee !== container) expose(intrinsic, invoking && callee !== container ? parents.get(container) : false, container);
    });
    const observesArgument = (callee) => {
        if (!callee) return false;

        const intrinsic = intrinsicFor(callee);
        const { observes = false } = nativeFunctions.get(intrinsic) ?? {};
        const family = intrinsicFamilies.get(intrinsic.split('.').at(0)) || 'all';

        return observes && !opaqueExecutions.has(executionOf.get(callee)) && !exposedIntrinsics.has('all') && !exposedIntrinsics.has(family);
    };
    const invalidFamiliesFor = (node) => {
        const parent = parents.get(node) ?? {};
        const { type = '', callee = false } = parent;
        const call = ['CallExpression', 'NewExpression'].includes(type) && callee === node && parent;

        // A callee lookup precedes its own arguments. Other exposures retain
        // their affected family; reflection retires the shared prototype premise.
        return Object.freeze([...exposedIntrinsics.keys()].filter((family) => {
            const uses = exposedIntrinsics.get(family);

            return !call || uses.size !== 1 || !uses.has(call);
        }));
    };

    const intrinsicAt = node => identities.has(node) && !callableResolutions.has(node) ? '' : intrinsicFor(node);

    return { observesArgument, intrinsicAt, invalidFamiliesFor, exposedIntrinsics, exposedArguments,
        supportsLookup: node => !opaqueExecutions.has(executionOf.get(node)) };
};

// Prior writes depend on completed aliases and lexical ordering, not on native
// exposure or record retirement. Statement/effect scratch belongs to this pass.
const acquireMemberWrites = ({ effects = new Map(), memberAccesses = [], executionOf = new WeakMap(), parents = new WeakMap(),
    identities = new WeakMap(), operators = new WeakMap() } = {}, selected, contextFor) => {
    const statementOwners = new WeakMap();
    const statementFor = (node) => {
        traverse(node, { enter: (current) => {
            const { type = '' } = current;

            return statementOwners.has(current) || type.endsWith('Statement') || type === 'VariableDeclaration' ? [] : [parents.get(current)].filter(Boolean);
        }, leave: (current) => {
            const { type = '' } = current;

            if (!statementOwners.has(current)) put(statementOwners, current,
                type.endsWith('Statement') || type === 'VariableDeclaration' ? current : statementOwners.get(parents.get(current)));
        } });

        return statementOwners.get(node);
    };
    const priorWrites = new WeakMap();
    const latestEffect = new Map();
    const unpositioned = new Set();
    const ordered = [...effects].flatMap(([execution = false, entries = []] = []) => entries.map(entry => ({ ...entry, execution }))).concat(
        memberAccesses.map(({ node = {} } = {}) => {
            const { range: [position = -1] = [] } = node;

            return { node, execution: executionOf.get(node), position, reading: true };
        })
    ).toSorted(({ position: a = -1, reading: first = false } = {}, { position: b = -1, reading: second = false } = {}) => a - b || Number(first) - Number(second));

    ordered.forEach(({ node = {}, execution = false, reading = false, position = -1 } = {}) => {
        if (!reading && position < 0) retain(unpositioned, execution);

        if (position < 0 || unpositioned.has(execution)) return;

        if (!reading) {
            put(latestEffect, execution, node);

            return;
        }

        const previous = latestEffect.get(execution);
        const { type = '', left = {} } = previous ?? {};
        const { type: targetType = '', object = {}, computed = false, property = {} } = left;
        const { type: readType = '', object: receiver = {}, computed: dynamic = false, property: selectedProperty = {} } = node;
        const { type: receiverType = '' } = object;
        const { type: selectedType = '' } = receiver;
        const binding = selected.get(identities.get(object));
        const { name = '' } = property;
        const { name: selectedName = '' } = selectedProperty;
        const { repeated = false } = contextFor(node);
        const written = previous && statementFor(previous);
        const read = statementFor(node);
        const { expression = false } = written ?? {};

        if (type === 'AssignmentExpression' && operators.get(previous) === '=' && targetType === 'MemberExpression' && readType === 'MemberExpression' &&
            !computed && !dynamic && receiverType === 'Identifier' && selectedType === 'Identifier' && binding && binding === selected.get(identities.get(receiver)) &&
            name === selectedName && !repeated && written && read && written !== read && expression === previous && parents.get(written) === parents.get(read)) {
            put(priorWrites, node, previous);
        }
    });

    return node => priorWrites.get(node);
};

// Structural evidence belongs to a lexical lifetime. Aliases share the first
// unsupported use; a later query cannot recover an earlier object snapshot.
export const acquireMemberBoundaries = ({ bindings = [], references = [], memberAccesses = [], identities = new WeakMap(), callableResolutions = new WeakMap(),
    parents = new WeakMap(), writes = new Set(), opaqueExecutions = new Set(), executionOf = new WeakMap(), operators = new WeakMap(),
    effects = new Map(), functionEntries = [] } = {}, contextFor) => {
    if (typeof contextFor !== 'function') throw new TypeError('Expected shared lexical use contexts');

    const roots = new WeakMap();
    const selected = new WeakMap();
    const wholeRecords = new WeakSet();
    const recordSource = acquireRecordSources();
    const hazards = new Map();
    const captured = new Set();
    const rootFor = (node) => {
        traverse(node, { enter: (current = {}) => {
            const { type = '', object = false, expression = false } = current;

            if (roots.has(current)) return [];

            if (type === 'MemberExpression') return [object];

            return type === 'ChainExpression' ? [expression] : [];
        }, leave: (current = {}) => {
            const { type = '', object = false, expression = false } = current;

            put(roots, current, roots.get(type === 'MemberExpression' ? object : expression) || current);
        } });

        return roots.get(node);
    };
    bindings.forEach((binding) => {
        const { init = false, immutable = false, declaration: { destructured = false } = {} } = binding;
        const origin = init && rootFor(init);
        const source = origin && callableResolutions.get(origin);

        put(selected, binding, immutable && source ? selected.get(source) || source : binding);

        if (!immutable || destructured || !init) return;

        const { type = '' } = init;

        if (type === 'ObjectExpression' || (type === 'Identifier' && wholeRecords.has(source))) retain(wholeRecords, binding);
    });
    const exposedRecords = new Set();
    const functionsByExecution = new Map(functionEntries.map(({ execution = false, node = {} } = {}) => [execution, node]));

    bindings.forEach((binding) => {
        const root = selected.get(binding) || binding;

        if (exported(binding, parents)) retain(exposedRecords, root);
    });
    const closedMethodsFor = ({ init = false, immutable = false } = {}) => {
        if (!init || !immutable) return false;

        const source = recordSource(init);

        if (!source) return false;

        const { methods = false } = source;

        return methods;
    };
    const lexicalMethod = (binding, { type = '', object = {}, computed = false, property = {} } = {}) => {
        const { type: objectType = '' } = object;

        if (type !== 'MemberExpression' || objectType !== 'Identifier' || computed || !wholeRecords.has(binding)) return false;

        const methods = closedMethodsFor(selected.get(binding) || binding);
        const { name = '' } = propertyName({ computed, key: property });

        return Boolean(methods && methods.has(name));
    };
    const hazard = (binding, node = {}, transfer = false) => {
        const root = selected.get(binding) || binding;
        const { range: [start = -1, end = -1] = [] } = node;
        const entries = hazards.get(root) || put(hazards, root, []);

        append(entries, { source: node, position: transfer ? start : end, transfer });
    };
    const containers = new WeakMap();
    const containerFor = (node) => {
        traverse(node, { enter: (current) => {
            if (containers.has(current)) return [];

            const parent = parents.get(current) ?? {};
            const { type = '', object = false, expression = false } = parent;

            return (type === 'MemberExpression' && object === current) || (type === 'ChainExpression' && expression === current) ? [parent] : [];
        }, leave: current => put(containers, current, containers.get(parents.get(current)) || current) });

        return containers.get(node);
    };
    const native = acquireNativeBoundaries({ bindings, references, memberAccesses, identities, callableResolutions, parents, writes, opaqueExecutions, executionOf },
        contextFor, containerFor);

    references.forEach(({ node = {}, parent = {}, execution = false, unsupported = false } = {}) => {
        const binding = identities.get(node);

        if (!binding) return;

        const { execution: owner = false, declaration: { node: declared = false } = {} } = binding;
        const root = selected.get(binding) || binding;

        if (node === declared) return;

        if (execution !== owner || unsupported) retain(captured, root);

        if (unsupported) retain(exposedRecords, root);

        const { type = '', init = false, id = {} } = parent;
        const { type: pattern = '' } = id ?? {};

        if (type === 'VariableDeclarator' && init === node && selected.get(identities.get(id)) === root) return;

        if (type === 'VariableDeclarator' && init === node && pattern === 'ObjectPattern') return;

        const memberContainer = containerFor(node);
        const { valueUse = { node: parent, value: node }, mutation = false } = contextFor(node);
        const { node: enclosing = {}, value: container = node } = memberContainer === node
            ? valueUse : { node: parents.get(memberContainer), value: memberContainer };
        const { type: use = '', callee = false } = enclosing;

        if (mutation) {
            hazard(binding, node);

            return;
        }

        if (use === 'CallExpression' && callee === container && lexicalMethod(binding, container)) return;

        if (use === 'CallExpression' && callee === container) {
            hazard(binding, enclosing);

            return;
        }

        if (use === 'CallExpression' && native.observesArgument(callee)) return;

        if (['CallExpression', 'NewExpression'].includes(use)) {
            hazard(binding, enclosing);

            return;
        }

        if (memberContainer !== node) return;

        const { body = false } = enclosing;

        if (use === 'ReturnStatement' || (use === 'ArrowFunctionExpression' && body === container) || use.startsWith('Export')) retain(exposedRecords, root);

        if (['ReturnStatement', 'IfStatement'].includes(use) || (use === 'ArrowFunctionExpression' && body === container)) return;

        if (use === 'UnaryExpression' && ['!', 'typeof', 'void'].includes(operators.get(enclosing))) return;

        if (use === 'AwaitExpression') return;

        if (use === 'BinaryExpression' && ['===', '!=='].includes(operators.get(enclosing))) return;

        if (['ImportSpecifier', 'ImportDefaultSpecifier', 'ExportSpecifier'].includes(use)) return;

        // A stored value can outlive this read. Retire its member snapshot at
        // the transfer itself; later writes through another alias cannot revive it.
        const { range: [start = -1] = [] } = node;
        const { value = false, kind = 'init', computed = false } = enclosing;
        const source = use === 'Property' && value === container && kind === 'init' && !computed && recordSource(parents.get(enclosing));
        let aggregate = use === 'ArrayExpression';

        if (source) {
            const { ownsFields = false } = source;

            aggregate = ownsFields;
        }

        hazard(binding, aggregate ? node : { range: [start, start] }, aggregate);
    });
    // A sole outgoing transfer into an owned aggregate has no second source
    // alias that can mutate the snapshot. The aggregate owns later invalidation.
    const transfers = new WeakSet();

    hazards.forEach((entries, binding) => {
        const [{ source = {}, transfer = false } = {}] = entries;

        if (entries.length === 1 && transfer && !captured.has(binding) && !exposedRecords.has(binding) && !writes.has(binding)) retain(transfers, source);
    });
    const lifetimes = new WeakMap();
    const latestLifetime = new Map();
    const lifetimeEvents = [...hazards].flatMap(([binding = false, entries = []] = []) => {
        const ordered = entries.toSorted(({ position: a = -1 } = {}, { position: b = -1 } = {}) => a - b);

        put(hazards, binding, ordered);

        return ordered.map(entry => ({ ...entry, binding }));
    }).concat(references.map(({ node = {} } = {}) => {
        const { range: [position = -1] = [] } = node;

        return { source: node, position, reading: true, binding: selected.get(identities.get(node)) || identities.get(node) };
    })).toSorted(({ position: a = -1, reading: first = false } = {}, { position: b = -1, reading: second = false } = {}) => a - b || Number(first) - Number(second));
    lifetimeEvents.forEach(({ binding = false, source = {}, reading = false, position = -1 } = {}) => {
        if (!binding || (reading && position < 0)) return;

        const prior = latestLifetime.get(binding) || false;

        if (reading && prior) put(lifetimes, source, prior);

        if (reading) return;

        const { call: recoverable = false } = prior ? prior : {};

        if (prior && !recoverable) return;

        const { type = '' } = source;
        const { execution = false } = binding;
        const call = position >= 0 && type === 'CallExpression' && execution === executionOf.get(source) ? source : false;

        put(latestLifetime, binding, { lifetime: true, call, prior, ordered: Boolean(call && contextFor(call).ordered) });
    });
    const captureSafe = (node) => {
        const binding = identities.get(rootFor(node));
        const root = selected.get(binding) || binding;

        if (exposedRecords.has(root) || hazards.has(root) || writes.has(root)) return false;

        if (!closedMethodsFor(root)) return false;

        const { init = {}, execution = false } = root ?? {};
        const { init: initializer = {} } = binding ?? {};
        const { range: [, aliased = Infinity] = [] } = initializer ? initializer : {};
        const { range: [, initialized = Infinity] = [] } = init;
        const { type = '', range: [created = -1] = [] } = functionsByExecution.get(executionOf.get(node)) ?? {};

        return !opaqueExecutions.has(execution) && (execution === executionOf.get(node) ||
                (['ArrowFunctionExpression', 'FunctionExpression'].includes(type) && Math.max(initialized, aliased) <= created));
    };
    const safe = (node, { range: [, end = -1] = [] } = {}) => {
        const root = rootFor(node);
        const { type = '', range: [start = -1] = [] } = node;
        const binding = identities.get(root);

        if (!binding) return !opaqueExecutions.has(executionOf.get(node));

        const { execution = false } = binding;
        const selectedBinding = selected.get(binding) || binding;
        const [{ position: hazard = Infinity } = {}] = hazards.get(selectedBinding) || [];
        const { type: parentType = '', argument = false, body = false } = parents.get(node) ?? {};
        const returned = (parentType === 'ReturnStatement' && argument === node) || (parentType === 'ArrowFunctionExpression' && body === node);

        return !writes.has(binding) && (!captured.has(selectedBinding) || captureSafe(node)) && !opaqueExecutions.has(execution) &&
            start >= 0 && (transfers.has(node) || (end >= 0 ? end <= hazard : start < hazard)) && (!returned || hazard === Infinity) && type !== 'AssignmentExpression';
    };

    const writeFor = acquireMemberWrites({ effects, memberAccesses, executionOf, parents, identities, operators }, selected, contextFor);

    return { ...native, safe, captureSafe, lifetimeFor: node => lifetimes.get(node), writeFor };
};
