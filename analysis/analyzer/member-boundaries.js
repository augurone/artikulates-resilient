import { append, put, retain } from '../collections.js';
import { propertyName } from '../estree-properties.js';
import { traverse } from '../traversal.js';
import { choicesOf } from './argument-positions.js';
import { intrinsicFamilies, nativeFunctions, nativePaths, prototypeAccessMembers, reflectiveMembers } from './native-members.js';
import { acquireRecordSources } from './records.js';

const exported = ({ declaration: { node = {} } = {}, functionSource = false } = {}, parents) => {
    const owner = functionSource || parents.get(node);
    const { type = '' } = owner ?? {};
    const declaration = type === 'VariableDeclarator' ? parents.get(owner) : owner;
    const { type: container = '' } = parents.get(declaration) ?? {};

    return ['ExportNamedDeclaration', 'ExportDefaultDeclaration'].includes(container);
};
const protocolOn = (receiver, { type = '', object = false, computed = false, property: key = {} } = {}) => {
    const { name = '' } = propertyName({ computed, key });

    return type === 'MemberExpression' && object === receiver && ['call', 'apply'].includes(name);
};

// Native identity and exposure own no record alias, capture or lifetime state.
const acquireNativeBoundaries = ({ bindings = [], references = [], memberAccesses = [], identities = new WeakMap(), callableResolutions = new WeakMap(),
    parents = new WeakMap(), operators = new WeakMap(), writes = new Set(), opaqueExecutions = new Set(),
    executionOf = new WeakMap(), executionParents = new Map(), functionEntries = [] } = {}, contextFor, containerFor) => {
    const intrinsics = new Set(['Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Object', 'Function', 'RegExp', 'Reflect', 'Promise']);
    const ambient = new Set(['globalThis', 'window', 'global']);
    const nativeAliases = new WeakMap();
    const promiseCaptures = new WeakMap();
    const nativeSelections = new WeakMap();
    const exposedIntrinsics = new Map();
    const exposedArguments = new WeakMap();
    const promiseRebindings = new Map();
    const promiseWrites = [];
    let promiseExposed = false;
    const expose = (name, call = false, argument = false, rebinding = false) => {
        const family = intrinsicFamilies.get(name.split('.').at(0)) || 'all';
        const uses = exposedIntrinsics.get(family) || put(exposedIntrinsics, family, new Set());

        retain(uses, call);

        if (family === 'promise' && !rebinding) promiseExposed = true;

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

        if (intrinsic === 'Promise' && !receiverBound) put(promiseCaptures, binding, promiseCaptures.get(identities.get(init)) || init);

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

        const memberContainer = containerFor(node);
        const { mutation = false, valueUse = { node: parent, value: node } } = contextFor(node);
        const { node: enclosing = {}, value: container = node } = memberContainer === node
            ? valueUse : { node: parents.get(memberContainer), value: memberContainer };
        const { type: use = '', callee = false, init: initializer = false } = enclosing;

        const invoking = ['CallExpression', 'NewExpression'].includes(use);

        if (type === 'MemberExpression' && known && nativePaths.has(`${intrinsic}.${selectedName}`) && use === 'VariableDeclarator' && initializer === container) return;

        const { left = false } = parent;
        const rebinding = intrinsic === 'Promise' && !identities.has(node) && mutation && left === node && operators.get(parent) === '=';

        if (intrinsic === 'Promise' && !identities.has(node) && mutation && memberContainer === node) append(promiseWrites, parent);

        if (rebinding) {
            const execution = executionOf.get(node);
            const { range: [position = -Infinity] = [] } = node;

            put(promiseRebindings, execution, Math.min(promiseRebindings.get(execution) ?? Infinity, position));
        }

        if (mutation || !invoking || callee !== container) expose(intrinsic, invoking && callee !== container ? enclosing : false, container, rebinding);
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
        const capture = promiseCaptures.get(identities.get(node));
        const { range: [, captured = Infinity] = [] } = capture ?? {};
        const execution = capture && executionOf.get(capture);
        const { type: owner = '' } = parents.get(parents.get(parents.get(capture))) ?? {};
        const retainedPromise = !promiseExposed && promiseRebindings.size === 1 && owner === 'Program' &&
            captured < (promiseRebindings.get(execution) ?? -Infinity);

        // A callee lookup precedes its own arguments. Other exposures retain
        // their affected family; reflection retires the shared prototype premise.
        return Object.freeze([...exposedIntrinsics.keys()].filter((family) => {
            const uses = exposedIntrinsics.get(family);

            if (family === 'promise' && retainedPromise) return false;

            return !call || uses.size !== 1 || !uses.has(call);
        }));
    };

    const intrinsicAt = node => identities.has(node) && !callableResolutions.has(node) ? '' : intrinsicFor(node);
    const outerFunctions = new Map();

    functionEntries.forEach(({ node = {}, execution = false } = {}) => {
        const parent = executionParents.get(execution);

        put(outerFunctions, execution, outerFunctions.get(parent) || node);
    });
    const [assignment = {}] = promiseWrites;
    const statement = parents.get(assignment);
    const { expression = false } = statement ?? {};
    const { type: statementOwner = '' } = parents.get(statement) ?? {};
    const { type: assignmentType = '', right: replacement = false, range: [, written = Infinity] = [] } = assignment;
    const { type: replacementType = '', async = false, generator = false } = replacement ?? {};
    const execution = executionOf.get(assignment);
    const provedReplacement = promiseWrites.length === 1 && assignmentType === 'AssignmentExpression' && operators.get(assignment) === '=' &&
        expression === assignment && statementOwner === 'Program' && replacementType === 'FunctionExpression' && !async && !generator &&
        !opaqueExecutions.has(execution) && !exposedIntrinsics.has('all');
    // Exposure can retire a native result proof while leaving the executor
    // requirement possible. Only an ordered replacement excludes that target.
    const promiseTargetFor = (node) => {
        if (intrinsicAt(node) !== 'Promise') return false;

        const capture = promiseCaptures.get(identities.get(node)) || node;
        const outer = outerFunctions.get(executionOf.get(capture));
        const lookup = outer || capture;
        const { type = '', range: [start = -1] = [] } = lookup;

        return provedReplacement && executionOf.get(lookup) === execution && start > written &&
            (!outer || ['FunctionExpression', 'ArrowFunctionExpression'].includes(type)) ? replacement : true;
    };

    return { observesArgument, intrinsicAt, invalidFamiliesFor, exposedIntrinsics, exposedArguments, promiseTargetFor,
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
    effects = new Map(), executionParents = new Map(), functionEntries = [], nextStatements = new WeakMap(), observesReceiver = () => false,
    observesFunction = () => false, observesArrayElements = observesFunction, callableSources = new Map() } = {}, contextFor) => {
    if (typeof contextFor !== 'function') throw new TypeError('Expected shared lexical use contexts');

    const roots = new WeakMap();
    const selected = new WeakMap();
    const wholeRecords = new WeakSet();
    const wholeArrays = new WeakSet();
    const recordSource = acquireRecordSources(observesFunction);
    const hazards = new Map();
    const positionHazards = new Map();
    const recurringHazards = new Map();
    const recurringPositionHazards = new Map();
    const receiverEscapes = new Map();
    const arrayEscapes = new Map();
    const arrayMethodEscapes = new Map();
    const aliasSources = new Map();
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
        const { init = false, immutable = false, parameterPattern = false, pattern: { type: pattern = '' } = {}, declaration: { destructured = false } = {} } = binding;
        const origin = init && rootFor(init);
        const source = origin && callableResolutions.get(origin);

        put(selected, binding, immutable && source ? selected.get(source) || source : binding);

        if (immutable && parameterPattern && pattern === 'RestElement') retain(wholeArrays, binding);

        if (!immutable || destructured || !init) return;

        const { type = '' } = init;

        if (type === 'ObjectExpression' || (type === 'Identifier' && wholeRecords.has(source))) retain(wholeRecords, binding);

        if (type === 'ArrayExpression' || (type === 'Identifier' && wholeArrays.has(source))) retain(wholeArrays, binding);
    });
    const exposedRecords = new Set();
    const functionsByExecution = new Map(functionEntries.map(({ execution = false, node = {} } = {}) => [execution, node]));
    const exits = new WeakMap();
    const exitAfter = (node) => {
        const { loop = false, inTry = false } = contextFor(node);

        if (!loop || inTry) return false;

        const following = (current) => {
            const { type = '' } = current;
            const parent = parents.get(current);
            const { type: enclosing = '', consequent = false, alternate = false } = parent ?? {};
            const next = nextStatements.get(current);
            const { type: nextType = '' } = next ?? {};

            if (['BreakStatement', 'ContinueStatement', 'ReturnStatement', 'ThrowStatement'].includes(type)) return false;

            // Straight-line evaluation can fail, but cannot skip a later exit
            // and begin another iteration. Branches and nested loops can.
            if (next) return ['BreakStatement', 'ReturnStatement', 'ExpressionStatement', 'VariableDeclaration', 'EmptyStatement'].includes(nextType) && next;

            const expression = type.endsWith('Expression') || ['Identifier', 'Property', 'SpreadElement', 'VariableDeclarator', 'TemplateLiteral'].includes(type);
            const container = enclosing.endsWith('Expression') || ['Property', 'SpreadElement', 'VariableDeclarator', 'TemplateLiteral',
                'ExpressionStatement', 'VariableDeclaration', 'ReturnStatement'].includes(enclosing);

            if (expression && container) return parent;

            return (enclosing === 'BlockStatement' || (enclosing === 'IfStatement' && (current === consequent || current === alternate))) && parent;
        };
        traverse(node, { enter: (current) => {
            if (exits.has(current)) return [];

            const next = following(current);

            return next ? [next] : [];
        }, leave: (current) => {
            if (exits.has(current)) return;

            const { type = '', label = false } = current;
            const { loop = false, breakTarget = false } = contextFor(current);
            const breaksLoop = type === 'BreakStatement' && !label && loop && loop === breakTarget;

            put(exits, current, type === 'ReturnStatement' || (breaksLoop && loop) || exits.get(following(current)) || false);
        } });

        return exits.get(node);
    };
    const recurrenceAt = (node, position) => {
        const exit = exitAfter(node);

        if (exit === true) return { position: Infinity, after: -1 };

        if (!exit) return { position, after: Infinity };

        const { range: [start = -1, end = Infinity] = [] } = exit;

        // Nested unbraced loops can share an end offset. The start offset
        // distinguishes an enclosing loop from the loop that was exited.
        return { position: end, after: start };
    };
    const earlierRecurrence = (first, next) => {
        if (!first || !next) return first || next;

        const { position: earlier = Infinity, after: firstExit = -1 } = first;
        const { position: later = Infinity, after: nextExit = -1 } = next;

        return later < earlier || (later === earlier && nextExit > firstExit) ? next : first;
    };
    const recursIn = (event, loop) => {
        if (!event || !loop) return false;

        const { position = Infinity, after = -1 } = event;
        const { range: [start = -1, end = -1] = [] } = loop;

        return position < end || (position === end && after > start);
    };
    const mergeEscape = (first, next) => {
        if (!first || !next) return first || next;

        const { position: earlier = -1, repeatAt: firstRepeat = false, execution = false, shared: firstShared = false } = first;
        const { position: later = -1, repeatAt: nextRepeat = false, execution: nextExecution = false, shared: nextShared = false } = next;

        return { position: Math.min(earlier, later), repeatAt: earlierRecurrence(firstRepeat, nextRepeat), execution,
            shared: firstShared || nextShared || execution !== nextExecution };
    };
    const escapeReceiver = (root, node = {}, execution = false, arrayRead = false, arrayOperation = arrayRead) => {
        const { execution: owner = false } = root;
        const { range: [, position = -1] = [] } = node;
        const repeatAt = recurrenceAt(node, position);

        put(receiverEscapes, root, mergeEscape(receiverEscapes.get(root), { position, repeatAt, execution, shared: owner !== execution }));

        if (!arrayRead) put(arrayEscapes, root, mergeEscape(arrayEscapes.get(root), { position, repeatAt, execution, shared: owner !== execution }));

        if (!arrayOperation) put(arrayMethodEscapes, root, mergeEscape(arrayMethodEscapes.get(root), { position, repeatAt, execution, shared: owner !== execution }));
    };

    bindings.forEach((binding) => {
        const root = selected.get(binding) || binding;

        if (!exported(binding, parents)) return;

        retain(exposedRecords, root);
        escapeReceiver(root);
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

        if (type !== 'MemberExpression' || objectType !== 'Identifier' || !wholeRecords.has(binding)) return false;

        const methods = closedMethodsFor(selected.get(binding) || binding);
        const { known = false, name = '' } = propertyName({ computed, key: property });

        return Boolean(known && methods && methods.has(name));
    };
    const hazard = (binding, node = {}, transfer = false, arrayRead = false) => {
        const root = selected.get(binding) || binding;
        const { range: [start = -1, end = -1] = [] } = node;
        const entries = hazards.get(root) || put(hazards, root, []);
        const position = transfer ? start : end;

        append(entries, { source: node, position, transfer, arrayRead });
        put(recurringHazards, root, earlierRecurrence(recurringHazards.get(root), recurrenceAt(node, position)));

        if (!arrayRead) put(recurringPositionHazards, root, earlierRecurrence(recurringPositionHazards.get(root), recurrenceAt(node, position)));
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
    const native = acquireNativeBoundaries({
        bindings, references, memberAccesses, identities, callableResolutions, parents, operators, writes, opaqueExecutions,
        executionOf, executionParents, functionEntries
    }, contextFor, containerFor);
    const { exposedIntrinsics = new Map() } = native;
    const stablePrototype = !exposedIntrinsics.has('all') && !exposedIntrinsics.has('function');
    const ordinaryFunctions = new WeakMap();
    const functionAlternatives = (node) => {
        const binding = callableResolutions.get(node);
        const { init = false, stable = false } = binding ?? {};

        return stable && init && !writes.has(binding) ? [init] : choicesOf(node);
    };
    const ordinaryFunctionAt = (node) => {
        traverse(node, { enter: current => ordinaryFunctions.has(current) ? [] : functionAlternatives(current), leave: (current) => {
            if (ordinaryFunctions.has(current)) return;

            const { type = '' } = current;
            const binding = callableResolutions.get(current);
            const { imported = false } = (selected.get(binding) || binding) ?? {};
            const alternatives = functionAlternatives(current);
            const own = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(type) ||
                (!imported && callableSources.has(binding));

            put(ordinaryFunctions, current, own || (Boolean(alternatives.length) && alternatives.every(choice => ordinaryFunctions.get(choice))));
        } });

        return ordinaryFunctions.get(node);
    };
    const metadata = ({ name = '', known = false } = {}) => known && !['call', 'apply', '__proto__'].includes(name);
    const metadataRecord = ({ type = '', properties = [] } = {}) => type === 'ObjectExpression' && properties.every(
        ({ type = '', kind = '', computed = false, key = {} } = {}) => type === 'Property' && kind === 'init' && !computed && metadata(propertyName({ key }))
    );
    const discardsReceiver = (call) => {
        const { valueUse: { node: consumer = {}, value = call } = {} } = contextFor(call);
        const { type = '', test = false, expressions = [] } = consumer;
        const tested = ['IfStatement', 'ConditionalExpression', 'WhileStatement', 'DoWhileStatement', 'ForStatement'].includes(type) && test === value;
        const unary = type === 'UnaryExpression' && ['!', 'typeof', 'void'].includes(operators.get(consumer));

        return type === 'ExpressionStatement' || tested || unary || (type === 'SequenceExpression' && expressions.at(-1) !== value);
    };
    const nativeReceiverOperation = (call, receiver, record) => {
        const { callee = {}, arguments: args = [] } = call;
        const { type = '', object = {}, computed = false, property: key = {} } = callee;

        if (type !== 'MemberExpression' || args.at(0) !== receiver) return '';

        const { name = '' } = propertyName({ computed, key });

        if (!['keys', 'assign'].includes(name) || native.intrinsicAt(object) !== 'Object' ||
            !native.supportsLookup(callee) || native.invalidFamiliesFor(callee).includes('all')) return '';

        if (name === 'keys' && args.length === 1 && (record || ordinaryFunctionAt(receiver))) return name;

        // Object.assign returns its target. Retaining that result can expose the
        // receiver even when every copied property is harmless.
        return name === 'assign' && stablePrototype && discardsReceiver(call) &&
            ordinaryFunctionAt(receiver) && args.slice(1).every(metadataRecord) ? name : '';
    };
    const readsArray = (binding, member = {}, { arguments: [callback = {}] = [] } = {}) => {
        const { object = false, computed = false, property: key = {} } = member;
        const { name = '' } = propertyName({ computed, key });
        const helper = callableSources.get(callableResolutions.get(callback)) || callback;

        return identities.get(object) === binding &&
            !exposedIntrinsics.has('all') && !exposedIntrinsics.has('array') && native.supportsLookup(member) &&
            ['map', 'forEach', 'every', 'some', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flatMap', 'reduce', 'reduceRight'].includes(name) &&
            observesArrayElements(helper);
    };
    const writesMetadata = (receiver, { object = false, computed = false, property: key = {} } = {}) => {
        if (!stablePrototype || object !== receiver || !native.supportsLookup(receiver)) return false;

        return metadata(propertyName({ computed, key })) && ordinaryFunctionAt(receiver);
    };
    const invokesOwnedMethod = ({ callee = {}, arguments: [target = false] = [] } = {}, node, container, binding) => {
        if (!stablePrototype || !wholeRecords.has(binding)) return false;

        const { object: member = {} } = callee;
        const { object = {} } = member;
        const owner = identities.get(object);
        const sameReceiver = owner && selected.get(owner) === selected.get(binding);

        return sameReceiver && protocolOn(member, callee) && lexicalMethod(binding, member) &&
            (container === callee || (container === node && target === node));
    };

    references.forEach(({ node = {}, parent = {}, execution = false, unsupported = false } = {}) => {
        const binding = identities.get(node);

        if (!binding) return;

        const { execution: owner = false, declaration: { node: declared = false } = {} } = binding;
        const root = selected.get(binding) || binding;

        if (node === declared) return;

        if (execution !== owner || unsupported) retain(captured, root);

        if (unsupported) {
            retain(exposedRecords, root);
            escapeReceiver(root);
        }

        const { type = '', init = false, id = {} } = parent;
        const { type: pattern = '' } = id ?? {};

        if (type === 'VariableDeclarator' && init === node && selected.get(identities.get(id)) === root) return;

        if (type === 'VariableDeclarator' && init === node && pattern === 'ObjectPattern') return;

        const memberContainer = containerFor(node);
        const { valueUse = { node: parent, value: node }, mutation = false } = contextFor(node);
        const { node: enclosing = {}, value: container = node } = memberContainer === node
            ? valueUse : { node: parents.get(memberContainer), value: memberContainer };
        const { type: use = '', callee = false } = enclosing;

        if (mutation && memberContainer !== node && !protocolOn(node, memberContainer) && !writesMetadata(node, memberContainer)) {
            escapeReceiver(root, node, execution);
        }

        if (mutation) {
            hazard(binding, node);

            return;
        }

        const calling = use === 'CallExpression';
        const constructing = use === 'NewExpression';
        const invoked = callee === container;

        if (calling && invoked && lexicalMethod(binding, container)) return;

        if (calling && invokesOwnedMethod(enclosing, node, container, binding)) return;

        const arrayObservation = calling && invoked && readsArray(binding, container, enclosing);

        if (arrayObservation && wholeArrays.has(root) && !hazards.has(root) && !writes.has(root)) return;

        if (calling && !invoked && (native.observesArgument(callee) || observesReceiver(enclosing))) return;

        const protocol = calling && invoked && protocolOn(node, container);
        const passesReceiver = invoked ? memberContainer !== node || constructing : memberContainer === node || lexicalMethod(binding, memberContainer);
        const nativeOperation = calling && !invoked && memberContainer === node ? nativeReceiverOperation(enclosing, node,
            wholeRecords.has(binding) || wholeArrays.has(binding)) : '';
        const { object = false, computed = false, property: { type: keyType = '', value: index = -1 } = {} } = memberContainer;
        // Array-position queries already describe an array carrier. Reading a
        // data slot does not pass that carrier as the called function's receiver.
        // Generic receiver proofs must still retain these same call hazards.
        const arrayRead = arrayObservation || (!invoked && object === node && computed && keyType === 'Literal' &&
            Number.isInteger(index) && index >= 0 && !exposedIntrinsics.has('all') && !exposedIntrinsics.has('array'));
        const { object: receiver = false, computed: computedMethod = false, property: methodKey = {} } = container;
        const { name: methodName = '' } = propertyName({ computed: computedMethod, key: methodKey });
        const arrayOperation = arrayRead || (invoked && receiver === node && ['reverse', 'toReversed', 'pop', 'shift'].includes(methodName));

        if (nativeOperation === 'keys') return;

        if ((calling || constructing) && passesReceiver && !protocol && !nativeOperation) escapeReceiver(root, enclosing, execution, arrayRead, arrayOperation);

        if (calling || constructing) {
            hazard(binding, enclosing, false, arrayRead);

            return;
        }

        if (memberContainer !== node) return;

        const { body = false } = enclosing;

        if (use === 'ReturnStatement' || (use === 'ArrowFunctionExpression' && body === container) || use.startsWith('Export')) retain(exposedRecords, root);

        if (use.startsWith('Export')) escapeReceiver(root);

        if (use === 'ReturnStatement' || (use === 'ArrowFunctionExpression' && body === container)) escapeReceiver(root, node, execution);

        if (['ReturnStatement', 'IfStatement'].includes(use) || (use === 'ArrowFunctionExpression' && body === container)) return;

        if (use === 'UnaryExpression' && ['!', 'typeof', 'void'].includes(operators.get(enclosing))) return;

        if (use === 'AwaitExpression') return;

        if (use === 'BinaryExpression' && ['===', '!=='].includes(operators.get(enclosing))) return;

        if (['ImportSpecifier', 'ImportDefaultSpecifier', 'ExportSpecifier'].includes(use)) return;

        const { id: destination = {}, init: initializer = false } = enclosing;
        const alias = use === 'VariableDeclarator' && initializer === container ? identities.get(destination) : {};
        const { stable = false } = alias ?? {};
        const selectsReceiver = stable && callableResolutions.has(node);

        if (selectsReceiver) retain(aliasSources.get(alias) || put(aliasSources, alias, new Set()), root);

        if (!selectsReceiver && use !== 'ExpressionStatement') escapeReceiver(root, node, execution);

        // A stored value can outlive this read. Retire its member snapshot at
        // the transfer itself; later writes through another alias cannot revive it.
        const { range: [start = -1] = [] } = node;
        const { value = false, kind = 'init', computed: dynamic = false } = enclosing;
        const source = use === 'Property' && value === container && kind === 'init' && !dynamic && recordSource(parents.get(enclosing));
        let aggregate = use === 'ArrayExpression';

        if (source) {
            const { ownsFields = false } = source;

            aggregate = ownsFields;
        }

        hazard(binding, aggregate || use === 'SpreadElement' ? node : { range: [start, start] }, aggregate);
    });
    const escapedAliases = [];
    const visitedAliases = new Set();
    const completedAliases = new Set();

    const visitAliases = binding => traverse(binding, { enter: (alias) => {
        if (visitedAliases.has(alias)) return [];

        retain(visitedAliases, alias);

        return [...aliasSources.get(alias) || []];
    }, leave: (alias) => {
        if (completedAliases.has(alias)) return;

        retain(completedAliases, alias);
        append(escapedAliases, alias);
    } });

    aliasSources.forEach((sources, binding) => {
        if (receiverEscapes.has(binding)) visitAliases(binding);
    });
    escapedAliases.toReversed().forEach(alias => [receiverEscapes, arrayEscapes, arrayMethodEscapes].forEach((escapes) => {
        const escape = escapes.get(alias);

        if (!escape) return;

        const { execution = false, shared = false } = escape;

        (aliasSources.get(alias) || []).forEach((source) => {
            const { execution: owner = false } = source;

            put(escapes, source, mergeEscape(escapes.get(source), { ...escape, shared: shared || owner !== execution }));
        });
    }));
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
        put(positionHazards, binding, ordered.filter(({ arrayRead = false } = {}) => !arrayRead));

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
    const safe = (node, { range: [, end = -1] = [] } = {}, positions = false) => {
        const root = rootFor(node);
        const { type = '', range: [start = -1] = [] } = node;
        const binding = identities.get(root);

        if (!binding) return !opaqueExecutions.has(executionOf.get(node));

        const { execution = false } = binding;
        const selectedBinding = selected.get(binding) || binding;
        const [{ position: hazard = Infinity } = {}] = (positions ? positionHazards : hazards).get(selectedBinding) || [];
        const { type: parentType = '', argument = false, body = false } = parents.get(node) ?? {};
        const returned = (parentType === 'ReturnStatement' && argument === node) || (parentType === 'ArrowFunctionExpression' && body === node);

        return !writes.has(binding) && (!captured.has(selectedBinding) || captureSafe(node)) && !opaqueExecutions.has(execution) &&
            start >= 0 && (transfers.has(node) || (end >= 0 ? end <= hazard : start < hazard)) && (!returned || hazard === Infinity) && type !== 'AssignmentExpression';
    };

    const writeFor = acquireMemberWrites({ effects, memberAccesses, executionOf, parents, identities, operators }, selected, contextFor);
    const receiverWrites = new Map();
    const unresolvedWrites = new Set();
    const writtenReceivers = new Map([['call', new WeakSet()], ['apply', new WeakSet()]]);
    const receiverWriteEvents = new Map([['call', new WeakMap()], ['apply', new WeakMap()]]);
    const completedReceiverWrites = new Map([['call', new WeakSet()], ['apply', new WeakSet()]]);
    const receiverWriteOrder = [];
    const receiverAliases = new WeakMap();

    bindings.forEach((binding) => {
        const { init = false, immutable = false, declaration: { destructured = false } = {} } = binding;
        const { type = '' } = init ?? {};
        const source = immutable && !destructured && type === 'Identifier' && callableResolutions.get(init);

        if (source) put(receiverAliases, binding, receiverAliases.get(source) || source);
    });
    const receiverChoices = (node) => {
        const binding = callableResolutions.get(node);
        const { init = false } = binding ?? {};

        return init ? [init] : choicesOf(node);
    };
    const receiverKey = (object) => {
        const root = rootFor(object);
        const binding = identities.get(root);

        return receiverAliases.get(binding) || binding || native.intrinsicAt(root);
    };

    const registerReceiverWrite = (object, { name = '', known = false } = {}, operation) => {
        const methods = known ? [name].filter(method => ['call', 'apply'].includes(method)) : ['call', 'apply'];

        if (!methods.length) return;

        methods.forEach((method) => {
            const visited = writtenReceivers.get(method);
            const events = receiverWriteEvents.get(method);
            const { range: [, position = -1] = [] } = operation;
            const event = { execution: executionOf.get(operation), position, repeatAt: recurrenceAt(operation, position) };

            put(events, object, mergeEscape(events.get(object), event));

            traverse(object, { enter: (current) => {
                if (visited.has(current)) return [];

                retain(visited, current);
                const root = rootFor(current);
                const binding = identities.get(root);
                const { type = '', computed = false, property = {} } = current;
                const { name: member = '' } = propertyName({ computed, key: property });

                if ((type === 'MemberExpression' && member === 'prototype' && native.intrinsicAt(root) === 'Function') ||
                    (writes.has(binding) && !callableResolutions.has(root))) retain(unresolvedWrites, method);

                return receiverChoices(current);
            }, leave: (current) => {
                const completed = completedReceiverWrites.get(method);

                if (completed.has(current)) return;

                retain(completed, current);
                append(receiverWriteOrder, { current, method });
            } });
        });
    };
    const reflectiveWrites = new Set(['Object.defineProperty', 'Reflect.defineProperty', 'Reflect.set', 'Reflect.deleteProperty']);

    memberAccesses.forEach(({ node = {}, parent = {} } = {}) => {
        const { object = {}, computed = false, property: key = {} } = node;
        const property = propertyName({ computed, key });

        if (contextFor(node).mutation) registerReceiverWrite(object, property, parent);

        const { name = '' } = property;
        const { type = '', callee = false, arguments: [receiver = false, member = {}] = [] } = parent;

        if (type === 'CallExpression' && callee === node && receiver && reflectiveWrites.has(`${native.intrinsicAt(object)}.${name}`)) {
            registerReceiverWrite(receiver, propertyName({ computed: true, key: member }), parent);
        }
    });
    receiverWriteOrder.toReversed().forEach(({ current = {}, method = '' } = {}) => {
        const events = receiverWriteEvents.get(method);
        const event = events.get(current);

        if (!event) return;

        const receiver = receiverKey(current);
        const { execution = false } = identities.get(rootFor(current)) ?? {};
        const { execution: written = false, shared = false } = event;

        if (receiver) {
            const methods = receiverWrites.get(receiver) || put(receiverWrites, receiver, new Map());

            put(methods, method, mergeEscape(methods.get(method), { ...event, shared: shared || execution !== written }));
        }

        receiverChoices(current).forEach(choice => put(events, choice, mergeEscape(events.get(choice), event)));
    });
    const receiverFields = new WeakMap();
    const noReceiverFields = new Map();
    const fieldsForReceiver = (object) => {
        const binding = identities.get(object);
        const { init = object } = selected.get(binding) ?? {};
        const { type = '', properties = [] } = init ?? {};

        if (type !== 'ObjectExpression' || (binding && !wholeRecords.has(binding))) return noReceiverFields;

        const { methods = false, closed = false } = recordSource(init);
        const fields = receiverFields.get(init) || put(receiverFields, init, new Map(properties.flatMap(({ type = '', computed = false, key = {}, value = {} } = {}) => {
            const { name = '', known = false } = propertyName({ computed, key });

            return type === 'Property' && known
                ? [[name, { method: methods && methods.has(name) && value, writable: closed }]] : [];
        })));

        return fields;
    };
    const evidenceByReceiver = new WeakMap();
    const evidenceForReceiver = (object) => {
        traverse(object, { enter: current => evidenceByReceiver.has(current) ? [] : receiverChoices(current), leave: (current) => {
            const inherited = receiverChoices(current).map(choice => evidenceByReceiver.get(choice) ?? {});
            const writes = receiverWrites.get(receiverKey(current));
            const binding = identities.get(rootFor(current));
            const escape = inherited.reduce((earliest, { escape = false } = {}) => mergeEscape(earliest, escape),
                receiverEscapes.get(selected.get(binding) || binding));
            const { type = '', computed = false, property: key = {} } = current;
            const { name = '' } = propertyName({ computed, key });
            const chained = (type === 'MemberExpression' && ['call', 'apply'].includes(name)) ||
                inherited.some(({ chained = false } = {}) => chained);

            const written = new Map(writes);

            inherited.forEach(({ written: changes = new Map() } = {}) => changes.forEach((event, name) => put(written, name, mergeEscape(written.get(name), event))));
            put(evidenceByReceiver, current, { chained, escape, written,
                own: new Set([...['call', 'apply'].filter(name => fieldsForReceiver(current).has(name)), ...inherited.flatMap(({ own = [] } = {}) => [...own])]) });
        } });

        return evidenceByReceiver.get(object);
    };
    const escapedBefore = (node, escape, repeatedLoop = false) => {
        if (!escape) return false;

        const { execution = false, position = -1, repeatAt = false, shared = false } = escape;
        const { range: [lookup = -1] = [] } = node;

        return shared || execution !== executionOf.get(node) || lookup < 0 || position <= lookup || recursIn(repeatAt, repeatedLoop);
    };
    const repetition = new WeakMap();
    const unknownAllocation = Object.freeze({});
    const outermostReuse = (object, node) => {
        const { loop = false } = contextFor(node);

        if (!loop) return false;

        const binding = identities.get(object);
        const root = receiverAliases.get(binding) || binding;
        const { init = object, declaration: { destructured = false } = {} } = root ?? {};
        const { type = '' } = init ?? {};
        const fresh = ['ObjectExpression', 'ArrayExpression', 'ArrowFunctionExpression', 'FunctionExpression'].includes(type);
        const allocation = fresh && !destructured && !writes.has(binding) && !writes.has(root) ? init : unknownAllocation;
        const { range: [start = -1, end = Infinity] = [] } = allocation;
        const ends = repetition.get(allocation) || put(repetition, allocation, new WeakMap());
        const allocationRepeats = ({ body: { range: [begin = Infinity, finish = -1] = [] } = {} } = {}) => start >= begin && end <= finish;
        // The same allocation can survive an inner loop but be recreated by
        // an outer one. Stop at the first loop that creates a new receiver.
        traverse(loop, { enter: (current) => {
            const { loop: outer = false } = contextFor(current);

            return outer && !ends.has(current) && !allocationRepeats(current) ? [outer] : [];
        }, leave: (current) => {
            if (ends.has(current)) return;

            const { loop: outer = false } = contextFor(current);

            put(ends, current, !allocationRepeats(current) && (ends.get(outer) || current));
        } });

        return ends.get(loop);
    };
    const stableReceiver = (object, node, positions = false) => {
        if (!safe(object, node, positions)) return false;

        const binding = identities.get(object);

        if (!binding) return true;

        const root = selected.get(binding) || binding;
        const escape = (positions ? arrayEscapes : receiverEscapes).get(root);
        const repeatedLoop = outermostReuse(object, node);

        return !escapedBefore(node, escape, repeatedLoop) && !recursIn((positions ? recurringPositionHazards : recurringHazards).get(root), repeatedLoop);
    };
    const receiverFor = (node = {}) => {
        const { type = '', object = {}, computed = false, property: key = {} } = node;
        const { name = '' } = propertyName({ computed, key });

        if (type !== 'MemberExpression' || !['call', 'apply'].includes(name)) return {};

        const write = writeFor(node);
        const { left: { object: written = false } = {}, right: value = false } = write ?? {};
        const fields = fieldsForReceiver(object);
        const { method = false, writable = false } = fields.get(name) ?? {};
        const available = method && stableReceiver(object, node);
        const { chained = false, written: changed = new Map(), own = new Set(), escape: priorEscape = false } = evidenceForReceiver(object) ?? {};
        const binding = identities.get(object);
        const { init = object } = selected.get(binding) ?? {};
        const { type: receiverType = '' } = init ?? {};
        const { closed = false } = receiverType === 'ObjectExpression' ? recordSource(init) : {};
        const unresolvedOwn = receiverType === 'ObjectExpression' && !closed && !available;
        const repeatedLoop = (priorEscape || changed.has(name)) && outermostReuse(object, node);
        // A receiver can acquire a setter during an escape. Source order
        // alone cannot establish what a later assignment installed.
        const replacement = written && receiverKey(written) === receiverKey(object) && !escapedBefore(write, priorEscape, repeatedLoop) &&
            !unresolvedWrites.has(name) && (!own.has(name) || writable) && value;
        const uncertain = !replacement && (unresolvedOwn || (!stablePrototype && !available) || escapedBefore(node, priorEscape, repeatedLoop) || unresolvedWrites.has(name) ||
            escapedBefore(node, changed.get(name), repeatedLoop) || (own.has(name) && !available));

        return { method: name, replacement: replacement || (!uncertain && available && method), uncertain, chained };
    };
    const ownedMethodFor = (node = {}) => {
        const { type = '', object = {}, computed = false, property: key = {} } = node;

        if (type !== 'MemberExpression') return false;

        const { known = false, name = '' } = propertyName({ computed, key });

        if (!known) return false;

        const { method = false } = fieldsForReceiver(object).get(name) ?? {};

        return method && stableReceiver(object, node) && method;
    };
    const arrayMethodFor = (node = {}) => {
        const { object = {} } = node;
        const binding = identities.get(rootFor(object));
        const root = selected.get(binding) || binding;
        const { type = '' } = object;
        const nonArray = type === 'ObjectExpression' || (type === 'Identifier' && wholeRecords.has(binding));
        const escape = arrayMethodEscapes.get(root);
        const write = writeFor(node);
        const { right: replacement = false } = write ?? {};
        const replaced = replacement && !escapedBefore(write, escape) && replacement;
        const stable = !writes.has(binding) && !opaqueExecutions.has(executionOf.get(node)) &&
            !escapedBefore(node, escape, outermostReuse(object, node));

        return { replacement: replaced || ownedMethodFor(node), stable: stable && !nonArray, nonArray };
    };

    return { ...native, safe, captureSafe, positionsSafe: (node, site = node) => stableReceiver(node, site, true),
        lifetimeFor: node => lifetimes.get(node), writeFor, receiverFor, ownedMethodFor, arrayMethodFor };
};
