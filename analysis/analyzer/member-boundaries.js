import { append, put, retain } from '../collections.js';
import { sourcePropertyName as propertyName } from '../estree-properties.js';
import { traverse } from '../traversal.js';
import { choicesOf } from './argument-positions.js';
import { acquireLocalReaders } from './capture-boundaries.js';
import { acquireMemberCopies } from './member-copies.js';
import { acquireNativeBoundaries } from './native-boundaries.js';
import { acquireRecordSources } from './records.js';

const sourceStart = ({ range: [start = -1] = [] } = {}) => start;
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
    const priorArrayWrites = new WeakMap();
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
        const { known = false, name = '' } = propertyName({ computed, key: property });
        const { known: knownRead = false, name: selectedName = '' } = propertyName({ computed: dynamic, key: selectedProperty });
        const { repeated = false } = contextFor(node);
        const written = previous && statementFor(previous);
        const read = statementFor(node);
        const { expression = false } = written ?? {};

        const assignment = type === 'AssignmentExpression' && operators.get(previous) === '=' && targetType === 'MemberExpression' && readType === 'MemberExpression' &&
            receiverType === 'Identifier' && selectedType === 'Identifier' && binding && binding === selected.get(identities.get(receiver)) &&
            known && knownRead && name === selectedName && !repeated && written && read && written !== read && expression === previous;

        if (!assignment) return;

        const container = parents.get(written);
        const readOwner = parents.get(read);

        if (!computed && !dynamic && container === readOwner) put(priorWrites, node, previous);

        const { type: branchType = '' } = readOwner ?? {};
        const branch = branchType === 'IfStatement' && parents.get(readOwner) === container;

        if (container === readOwner || branch) put(priorArrayWrites, node, previous);
    });

    return { writeFor: node => priorWrites.get(node), arrayWriteFor: node => priorArrayWrites.get(node) };
};

// Structural evidence belongs to a lexical lifetime. Aliases share the first
// unsupported use; a later query cannot recover an earlier object snapshot.
export const acquireMemberBoundaries = ({ bindings = [], references = [], memberAccesses = [], identities = new WeakMap(), callableResolutions = new WeakMap(),
    parents = new WeakMap(), writes = new Set(), opaqueExecutions = new Set(), executionOf = new WeakMap(), operators = new WeakMap(),
    effects = new Map(), executionParents = new Map(), functionEntries = [], nextStatements = new WeakMap(), observesReceiver = () => false,
    observesFunction = () => false, observesArrayElements = observesFunction, callableSources = new Map(), selectionFor = () => false } = {}, contextFor) => {
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
    const copies = acquireMemberCopies({ references, memberAccesses, identities, writes, executionOf, selectionFor }, contextFor);
    // Aliasing a selected value shares its lifetime even when it has no
    // statically resolved callable. Identity does not establish its shape.
    const aliasSource = (node) => {
        const resolved = callableResolutions.get(node);

        if (resolved) return resolved;

        const binding = identities.get(node);
        const { immutable = false, parameterPattern = false, init = false, execution = false } = binding ?? {};
        const { range: [, initialized = Infinity] = [] } = init ? init : {};
        const read = sourceStart(node);

        return immutable && !writes.has(binding) && !opaqueExecutions.has(execution) &&
            (parameterPattern || (read >= 0 && initialized <= read)) ? binding : false;
    };
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
        const source = origin && aliasSource(origin);

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
    const hazard = (binding, node = {}, transfer = false, arrayRead = false, subject = false, { range: [, end = -1] = [] } = node) => {
        const root = selected.get(binding) || binding;
        const { range: [start = -1] = [] } = node;
        const entries = hazards.get(root) || put(hazards, root, []);
        const position = transfer ? start : end;

        append(entries, { source: node, position, transfer, arrayRead, subject });
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
    const native = acquireNativeBoundaries({ bindings, identities, callableResolutions, writes });
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

        if (!['keys', 'assign'].includes(name) || native.intrinsicAt(object) !== 'Object') return '';

        if (name === 'keys' && args.length === 1 && (record || ordinaryFunctionAt(receiver))) return name;

        // Object.assign returns its target. Retaining that result can expose the
        // receiver even when every copied property is harmless.
        return name === 'assign' && discardsReceiver(call) &&
            ordinaryFunctionAt(receiver) && args.slice(1).every(metadataRecord) ? name : '';
    };
    const readsArray = (binding, { object = false, computed = false, property: key = {} } = {}, { arguments: args = [] } = {}) => {
        const { name = '' } = propertyName({ computed, key });
        const [callback = {}] = args;
        const helper = callableSources.get(callableResolutions.get(callback)) || callback;
        const primitiveIndexes = args.every(({ type = '', value = false } = {}) => (
            type === 'Literal' && (value === null || ['string', 'number', 'boolean'].includes(typeof value))
        ));
        const copy = (!args.length && ['toSpliced', 'toReversed', 'concat'].includes(name)) ||
            (['slice', 'at'].includes(name) && primitiveIndexes);

        return identities.get(object) === binding &&
            (copy || (['map', 'forEach', 'every', 'some', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flatMap', 'reduce', 'reduceRight'].includes(name) &&
                observesArrayElements(helper)));
    };
    const writesMetadata = (receiver, { object = false, computed = false, property: key = {} } = {}) => {
        if (object !== receiver) return false;

        return metadata(propertyName({ computed, key })) && ordinaryFunctionAt(receiver);
    };
    const invokesOwnedMethod = ({ callee = {}, arguments: [target = false] = [] } = {}, node, container, binding) => {
        if (!wholeRecords.has(binding)) return false;

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

        if (type === 'VariableDeclarator' && init === node && ['ObjectPattern', 'ArrayPattern'].includes(pattern)) return;

        const memberContainer = containerFor(node);
        const { valueUse = { node: parent, value: node }, mutation = false } = contextFor(node);
        const { valueUse: selectedUse = { node: parents.get(memberContainer), value: memberContainer } } = contextFor(memberContainer);
        const { node: enclosing = {}, value: container = node } = memberContainer === node ? valueUse : selectedUse;
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
            Number.isInteger(index) && index >= 0);
        const { object: receiver = false, computed: computedMethod = false, property: methodKey = {} } = container;
        const { name: methodName = '' } = propertyName({ computed: computedMethod, key: methodKey });
        const arrayOperation = arrayRead || (invoked && receiver === node && ['reverse', 'toReversed', 'pop', 'shift'].includes(methodName));

        if (nativeOperation === 'keys') return;

        if ((calling || constructing) && passesReceiver && !protocol && !nativeOperation) escapeReceiver(root, enclosing, execution, arrayRead, arrayOperation);

        if (calling || constructing) {
            hazard(binding, enclosing, false, arrayRead, node);

            return;
        }

        if (use === 'AwaitExpression') {
            hazard(binding, enclosing, false, false, node);

            return;
        }

        const { test: selectedTest = false, init: selectedInit = false, id: selectedId = {}, body: selectedBody = false,
            value: propertyValue = false, kind: propertyKind = 'init' } = enclosing;
        const { type: selectedPattern = '' } = selectedId ?? {};
        const memberAlias = use === 'VariableDeclarator' && selectedInit === container &&
            (selected.get(identities.get(selectedId)) === root || ['ObjectPattern', 'ArrayPattern'].includes(selectedPattern));
        const returnedMember = use === 'ReturnStatement' || (use === 'ArrowFunctionExpression' && selectedBody === container);
        const observesMember = use === 'ExpressionStatement' || (['IfStatement', 'ConditionalExpression'].includes(use) && selectedTest === container) ||
            (use === 'UnaryExpression' && ['!', 'typeof', 'void'].includes(operators.get(enclosing))) ||
            (use === 'BinaryExpression' && ['===', '!=='].includes(operators.get(enclosing)));
        const propertyCarrier = use === 'Property' && propertyValue === container && propertyKind === 'init' && parents.get(enclosing);
        const carrier = use === 'ArrayExpression' ? enclosing : propertyCarrier;
        const copiedInto = parents.get(enclosing);
        const { type: copyKind = '' } = copiedInto ? copiedInto : {};

        if (use === 'SpreadElement' && ['ObjectExpression', 'ArrayExpression'].includes(copyKind) && copies.register(memberContainer, copiedInto)) {
            hazard(binding, copiedInto);

            return;
        }

        // Selected values remain owned while their literal carrier is built.
        // Publication retires the source snapshot; coercion can act immediately
        // after the read. Primitive results cannot publish a mutable field alias.
        // Returned values use the return's ownership boundary; an extra lexical
        // store here would erase a closed capture before its own field read.
        if (memberContainer !== node && !observesMember && !memberAlias && !returnedMember) hazard(binding, memberContainer, false, false, false, carrier || memberContainer);

        if (memberContainer !== node) return;

        const { body = false, test = false } = enclosing;

        if (use === 'ReturnStatement' || (use === 'ArrowFunctionExpression' && body === container) || use.startsWith('Export')) retain(exposedRecords, root);

        if (use.startsWith('Export')) escapeReceiver(root);

        if (use === 'ReturnStatement' || (use === 'ArrowFunctionExpression' && body === container)) escapeReceiver(root, node, execution);

        if (['ReturnStatement', 'IfStatement'].includes(use) || (use === 'ArrowFunctionExpression' && body === container)) return;

        // Boolean selection observes the value without passing or storing it.
        // Logical operands forward this same test use through valueUse.
        if (use === 'ConditionalExpression' && test === container) return;

        if (use === 'UnaryExpression' && ['!', 'typeof', 'void'].includes(operators.get(enclosing))) return;

        if (use === 'BinaryExpression' && ['===', '!=='].includes(operators.get(enclosing))) return;

        if (['ImportSpecifier', 'ImportDefaultSpecifier', 'ExportSpecifier'].includes(use)) return;

        const { id: destination = {}, init: initializer = false } = enclosing;
        const alias = use === 'VariableDeclarator' && initializer === container ? identities.get(destination) : {};
        const { stable = false } = alias ?? {};
        const selectsReceiver = stable && Boolean(aliasSource(node));
        const { left: formal = false, right: fallback = false } = enclosing;
        const target = use === 'AssignmentPattern' && fallback === node ? identities.get(formal) : {};
        const { parameter: { index: from = -1 } = {} } = binding;
        const { parameter: { index: to = -1 } = {}, execution: targetExecution = false } = target ?? {};
        const formalTransfer = from >= 0 && to > from && owner === execution && targetExecution === execution;

        if (selectsReceiver) retain(aliasSources.get(alias) || put(aliasSources, alias, new Set()), root);

        // A stable local callable selection transfers identity without publishing
        // its receiver. The alias edge above still carries later invalidation.
        if (selectsReceiver && ordinaryFunctionAt(node)) return;

        if (!selectsReceiver && use !== 'ExpressionStatement') escapeReceiver(root, node, execution);

        // A stored value can outlive this read. Retire its member snapshot at
        // the transfer itself; later writes through another alias cannot revive it.
        const { range: [start = -1] = [] } = node;
        const { value = false, kind = 'init', computed: dynamic = false } = enclosing;
        const source = use === 'Property' && value === container && kind === 'init' && !dynamic && recordSource(parents.get(enclosing));
        const { type: aggregateType = '' } = parents.get(enclosing) ?? {};
        let aggregate = use === 'ArrayExpression' || (use === 'SpreadElement' && aggregateType === 'ArrayExpression');

        if (source) {
            const { ownsFields = false } = source;

            aggregate = ownsFields;
        }

        hazard(binding, aggregate || formalTransfer || use === 'SpreadElement' ? node : { range: [start, start] }, aggregate || formalTransfer);
    });
    copies.finish();
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
    // A sole outgoing transfer into an owned aggregate or later formal has no
    // second source use that can mutate the snapshot. The destination owns later invalidation.
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
        const operation = ['CallExpression', 'AwaitExpression', 'MemberExpression', 'ObjectExpression', 'ArrayExpression'].includes(type);
        const call = position >= 0 && operation && execution === executionOf.get(source) ? source : false;

        put(latestLifetime, binding, { lifetime: true, call, prior, ordered: Boolean(call && contextFor(call).ordered),
            discardResult: copies.consumer(source) || (type === 'AwaitExpression' && discardsReceiver(source)) });
    });
    // An immediate native adoption consumes a promise without publishing its
    // envelope. Storing it elsewhere still ends the protocol proof: a carrier
    // can expose the envelope through a different alias.
    const protocolUses = new WeakMap();
    const protocolParent = (node) => {
        const parent = parents.get(node);
        const { type = '', test = false, argument = false, callee = {}, arguments: args = [] } = parent ?? {};
        const { type: member = '', object = {}, computed = false, property: { name = '' } = {} } = callee;
        const nativePromise = member === 'MemberExpression' && !computed && native.intrinsicAt(object) === 'Promise';

        if (type === 'AwaitExpression' && argument === node) return { mode: 1, boundary: parent };

        if (type === 'CallExpression' && args.at(0) === node && nativePromise && ['all', 'allSettled'].includes(name)) return { mode: 2, boundary: parent };

        if ((type === 'ConditionalExpression' && test !== node) || type === 'LogicalExpression') return { next: parent, relation: 'same' };

        if (type === 'ArrayExpression') return { next: parent, relation: 'element' };

        if (type === 'CallExpression' && args.at(0) === node && nativePromise && name === 'resolve') return { next: parent, relation: 'resolve' };

        return {};
    };
    const protocolUse = (node) => {
        traverse(node, { enter: (current) => {
            if (protocolUses.has(current)) return [];

            const { next = false } = protocolParent(current);

            return next ? [next] : [];
        }, leave: (current) => {
            if (protocolUses.has(current)) return;

            const { next = false, relation = '', ...direct } = protocolParent(current);
            const { mode = 0, boundary = false } = next ? protocolUses.get(next) : direct;
            const forwarded = relation === 'resolve' ? Number(mode === 1) : mode;
            const selected = relation === 'element' ? Number(mode === 2) : forwarded;

            put(protocolUses, current, { mode: selected, boundary });
        } });

        return protocolUses.get(node);
    };
    const adoptedImmediately = node => protocolUse(node).mode === 1;
    const protocolLifetimes = new WeakMap();
    const latestProtocol = new Map();
    const closedProtocolCarriers = new WeakMap();
    const protocolTransfers = new WeakMap();
    const closedCarrier = (binding) => {
        if (closedProtocolCarriers.has(binding)) return closedProtocolCarriers.get(binding);

        const root = selected.get(binding) || binding;
        const { immutable = false, execution = false } = binding;
        const entries = hazards.get(root) || [];
        const closed = immutable && !writes.has(root) && !captured.has(root) && !exposedRecords.has(root) &&
            !opaqueExecutions.has(execution) && Boolean(entries.length) && entries.every(({ source = {} } = {}) => {
            const { type = '', callee: { type: member = '', object = {}, computed = false, property: { name = '' } = {} } = {} } = source;

            return type === 'CallExpression' && member === 'MemberExpression' && !computed && native.intrinsicAt(object) === 'Promise' &&
                    ['all', 'allSettled'].includes(name);
        });

        return put(closedProtocolCarriers, binding, closed);
    };
    const transferredProtocol = (node) => {
        const binding = identities.get(node);
        const root = selected.get(binding) || binding;

        if (!root) return false;

        if (protocolTransfers.has(root)) return protocolTransfers.get(root);

        const entries = hazards.get(root) || [];
        const closed = Boolean(entries.length) && entries.every(({ source = {}, transfer = false } = {}) => {
            if (!transfer) return false;

            if (adoptedImmediately(source)) return true;

            const array = parents.get(source);
            const { type = '' } = array ?? {};
            const { type: declaration = '', init = false, id = {} } = parents.get(array) ?? {};
            const carrier = identities.get(id);

            return type === 'ArrayExpression' && declaration === 'VariableDeclarator' && init === array && carrier && closedCarrier(carrier);
        });

        return put(protocolTransfers, root, closed);
    };

    lifetimeEvents.flatMap((entry) => {
        const { reading = false, source = {}, position = -1 } = entry;
        const { type = '', range: [, end = -1] = [] } = source;
        const current = { ...entry, position: reading || end < 0 ? position : Math.max(position, end) };
        const { mode = 0, boundary: { range: [, expires = -1] = [] } = {} } = !reading && type === 'CallExpression' ? protocolUse(source) : {};

        return mode === 1 && expires >= end ? [current, { ...entry, position: expires, published: true }] : [current];
    }).toSorted(({ position: a = -1 } = {}, { position: b = -1 } = {}) => a - b)
        .forEach(({ binding = false, source = {}, reading = false, transfer = false, position = -1, published = false, subject = false } = {}) => {
            if (!binding || (reading && position < 0)) return;

            const prior = latestProtocol.get(binding) || false;

            if (reading && prior) put(protocolLifetimes, source, prior);

            if (reading) return;

            const { call: recoverable = false, adopted: consumed = false } = prior ? prior : {};

            if (prior && !recoverable && !consumed) return;

            const { type = '' } = source;
            const transferred = transfer && (adoptedImmediately(source) || transferredProtocol(source)) && source;
            const awaited = type === 'AwaitExpression';
            const discarded = awaited && discardsReceiver(source);
            const adopted = awaited && !discarded ? subject : transferred;
            const { execution = false } = binding;
            const operation = ['CallExpression', 'AwaitExpression', 'MemberExpression', 'ObjectExpression', 'ArrayExpression'].includes(type);
            const call = position >= 0 && operation && execution === executionOf.get(source) ? source : false;

            put(latestProtocol, binding, { lifetime: true, call, prior, adopted, subject: published && subject,
                ordered: Boolean(call && contextFor(call).ordered),
                discardResult: Boolean(copies.consumer(source) || discarded || (call && type === 'CallExpression' && !published && adoptedImmediately(call))) });
        });
    // A sole transfer can keep an owned payload across suspension. Every
    // other alias, write or opaque consumer retires that proof at acquisition.
    const suspensionSafe = (node) => {
        const binding = identities.get(node);
        const root = selected.get(binding) || binding;
        const { immutable = false, execution = false } = binding ?? {};
        const entries = hazards.get(root) || [];

        if (!immutable || writes.has(root) || exposedRecords.has(root) || opaqueExecutions.has(execution) || entries.length !== 1) return false;

        const [{ source = {} } = {}] = entries;
        const parent = parents.get(source);
        const { type = '' } = parent ?? {};
        const { type: sourceType = '', callee: { object = {}, computed = false, property: { name = '' } = {} } = {} } = source;

        return (source === node && type === 'ArrayExpression') ||
            (sourceType === 'CallExpression' && !computed && ['resolve', 'reject', 'all', 'allSettled'].includes(name) && native.intrinsicAt(object) === 'Promise');
    };
    const captureValue = (node) => {
        const binding = identities.get(rootFor(node));
        const root = selected.get(binding) || binding;
        const { immutable = false, init = false, naturalAbsence = false, parameterPattern = false, execution = false,
            declaration: { destructured = false, node: declared = {} } = {} } = root ?? {};
        const { type = '', range: [, initialized = Infinity] = [] } = init ? init : {};
        const { range: [created = -1] = [] } = functionsByExecution.get(executionOf.get(node)) ?? {};
        const { range: [read = -1] = [] } = node;
        const boundary = execution === executionOf.get(node) ? read : created;
        const methods = closedMethodsFor(root);
        const { init: alias = false } = binding ? binding : {};
        const { range: [, aliased = Infinity] = [] } = alias ? alias : {};
        const ready = root === binding || aliased <= boundary;
        const { range: [, absenceReady = Infinity] = [] } = declared;

        return ready && (immutable || naturalAbsence) && !writes.has(binding) && !writes.has(root) && !opaqueExecutions.has(execution) && !(methods && methods.size) &&
            (parameterPattern || (naturalAbsence && absenceReady <= boundary) ||
                (!destructured && ['Literal', 'ObjectExpression', 'ArrayExpression'].includes(type) && initialized <= boundary));
    };
    const captureTransfer = (node, call) => {
        const binding = identities.get(node);
        const root = selected.get(binding) || binding;
        const { immutable = false, execution = false } = binding ?? {};
        const [{ source = false } = {}, ...other] = hazards.get(root) ?? [];

        return immutable && source === call && !other.length && !writes.has(root) && !exposedRecords.has(root) && !opaqueExecutions.has(execution);
    };
    // A synchronous local reader may return its enclosing invocation's payload.
    // Every callable alias must stay in that invocation; every payload alias
    // still contributes writes and escapes to the shared hazard index.
    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- This acquisition factory always returns both completed private maps; a fallback would hide a broken owner contract.
    const { localReaders, payloadCaptures } = acquireLocalReaders({
        bindings, references, functionEntries, callableSources, identities, selected, executionParents, writes, exposedRecords, parents
    }, rootFor, exported);
    const localPayload = (node) => {
        const binding = identities.get(rootFor(node));
        const root = selected.get(binding) || binding;

        return captureValue(node) && payloadCaptures.get(root) && !writes.has(root) && !hazards.has(root) && !exported(root, parents);
    };
    const { writeFor, arrayWriteFor } = acquireMemberWrites({ effects, memberAccesses, executionOf, parents, identities, operators }, selected, contextFor);

    if (typeof writeFor !== 'function' || typeof arrayWriteFor !== 'function') throw new TypeError('Expected acquired member writes');

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

        if (!methods.length || native.intrinsicAt(rootFor(object))) return;

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

                if (writes.has(binding) && !callableResolutions.has(root)) retain(unresolvedWrites, method);

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
    // Closed source callables can retain native method lookup across capture.
    // Invocation observes that method; publication and writes remain hazards.
    const capturedProtocols = new WeakMap();
    const capturedProtocol = (node) => {
        const binding = identities.get(rootFor(node));
        const root = selected.get(binding) || binding;

        if (!root) return false;

        const { execution = false, init = false, functionSource = false } = root;
        const source = init || functionSource;

        if (!capturedProtocols.has(root)) {
            const closed = source && ordinaryFunctionAt(source) && !writes.has(root) && !exposedRecords.has(root) &&
                (hazards.get(root) || []).every(({ source: { type = '', callee = {} } = {} } = {}) => {
                    const { type: form = '', object = {}, computed = false, property: key = {} } = callee;
                    const { name = '' } = propertyName({ computed, key });
                    const receiver = form === 'Identifier' ? callee : object;
                    const target = identities.get(receiver);

                    return type === 'CallExpression' && (selected.get(target) || target) === root &&
                        (form === 'Identifier' || (form === 'MemberExpression' && ['call', 'apply'].includes(name)));
                });

            put(capturedProtocols, root, Boolean(closed));
        }

        const { chained = false, escape = false, written = new Map(), own = new Set() } = evidenceForReceiver(node);
        const { range: [, initialized = Infinity] = [] } = source ? source : {};
        const { init: alias = false } = binding;
        const { range: [, aliased = initialized] = [] } = alias ? alias : {};
        const { range: [created = -1] = [] } = functionsByExecution.get(executionOf.get(node)) ?? {};

        return capturedProtocols.get(root) && !chained && !escape && !written.size && !own.size && !opaqueExecutions.has(execution) &&
            (execution === executionOf.get(node) || ((functionSource || initialized <= created) && (root === binding || aliased <= created)));
    };
    const captureSafe = (node) => {
        const binding = identities.get(rootFor(node));
        const root = selected.get(binding) || binding;

        if (localPayload(node)) return true;

        if (exposedRecords.has(root) || writes.has(root)) return false;

        if (capturedProtocol(node)) return true;

        const copyOnly = (hazards.get(root) ?? []).every(({ source = {} } = {}) => {
            const parent = parents.get(source);
            const { type = '' } = parent ?? {};
            const { type: container = '' } = parents.get(parent) ?? {};

            return (type === 'SpreadElement' && container === 'ObjectExpression') || copies.consumer(source);
        });

        if (captureValue(node) && copyOnly) return true;

        if (hazards.has(root)) return false;

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
        const member = containerFor(node);
        const { type: use = '', callee = false, optional = false } = parents.get(member) ?? {};

        // Closed callable protocol reads retain their receiver across their own
        // native calls. A foreign call is still not parent lifetime evidence.
        if (!positions && use === 'CallExpression' && !optional && callee === member &&
            protocolOn(node, member) && capturedProtocol(node)) return true;

        const bindingHazards = (positions ? positionHazards : hazards).get(selectedBinding) || [];
        const [{ position: hazard = Infinity } = {}] = bindingHazards;
        const { type: parentType = '', argument = false, body = false } = parents.get(node) ?? {};
        const returned = (parentType === 'ReturnStatement' && argument === node) || (parentType === 'ArrowFunctionExpression' && body === node);

        return !writes.has(binding) && (!captured.has(selectedBinding) || captureSafe(node)) && !opaqueExecutions.has(execution) &&
            start >= 0 && (transfers.has(node) || (end >= 0 ? end <= hazard : start < hazard)) && (!returned || hazard === Infinity) && type !== 'AssignmentExpression';
    };
    const protocolFor = (node) => {
        const binding = identities.get(rootFor(node));
        const root = selected.get(binding) || binding;
        const { execution = false } = binding ?? {};
        const safe = Boolean(binding && !writes.has(binding) && (!captured.has(root) || captureSafe(node) ||
            (captureValue(node) && !hazards.has(root))) && !opaqueExecutions.has(execution));

        return { protocolSafe: safe, protocolLifetime: safe && protocolLifetimes.get(node) };
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
        const uncertain = !replacement && (unresolvedOwn || escapedBefore(node, priorEscape, repeatedLoop) || unresolvedWrites.has(name) ||
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
    const recordAlternatives = new WeakMap();
    const mayBeRecord = (node) => {
        traverse(node, { enter: current => recordAlternatives.has(current) ? [] : receiverChoices(current), leave: (current) => {
            if (recordAlternatives.has(current)) return;

            const { type = '' } = current;
            const record = type === 'ObjectExpression' || wholeRecords.has(identities.get(current)) ||
                receiverChoices(current).some(choice => recordAlternatives.get(choice));

            put(recordAlternatives, current, record);
        } });

        return recordAlternatives.get(node);
    };
    const observingChoices = new Map();
    const observesChoice = (node, name) => {
        const observations = observingChoices.get(name) || put(observingChoices, name, new WeakMap());

        traverse(node, { enter: current => observations.has(current) ? [] : choicesOf(current), leave: (current) => {
            if (observations.has(current)) return;

            const { type = '' } = current;
            const { method = false } = fieldsForReceiver(current).get(name) ?? {};
            const choices = choicesOf(current);
            const observes = (type === 'ObjectExpression' && method && observesFunction(method)) ||
                type === 'ArrayExpression' ||
                (choices.length && choices.every(choice => observations.get(choice)));

            put(observations, current, observes);
        } });

        return observations.get(node);
    };
    const arrayMethodFor = (node = {}, dataName = '') => {
        const { object = {} } = node;
        const binding = identities.get(rootFor(object));
        const root = selected.get(binding) || binding;
        const nonArray = mayBeRecord(object);
        const escape = arrayMethodEscapes.get(root);
        const write = arrayWriteFor(node);
        const { right: replacement = false } = write ?? {};
        // The first escape can be the assignment itself. Its receiver lookup
        // precedes that write, so only earlier escapes undermine replacement.
        const { left = {} } = write ?? {};
        const replaced = replacement && !escapedBefore(left, escape) && replacement;
        const stable = !writes.has(binding) && !opaqueExecutions.has(executionOf.get(node)) &&
            !escapedBefore(node, escape, outermostReuse(object, node));

        const { init = object } = callableResolutions.get(object) ?? {};
        const observesData = dataName && stable && nonArray && stableReceiver(object, node) && observesChoice(init, dataName);

        return { replacement: replaced || ownedMethodFor(node), stable: stable && !nonArray, nonArray, ownedArray: wholeArrays.has(binding), observesData };
    };
    const reductionChanges = new WeakMap(functionEntries.map(({ node = {}, params = [], execution = false } = {}) => {
        const fourth = params.at(3);
        const { type = '', left = {} } = fourth ?? {};
        const binding = identities.get(type === 'AssignmentPattern' ? left : fourth);
        const root = selected.get(binding) || binding;
        const observes = !params.slice(0, 4).some(({ type = '' } = {}) => type === 'RestElement') &&
            (!fourth || (binding && !positionHazards.has(root) && !arrayEscapes.has(root) && !captured.has(root)));

        return [node, !observes || opaqueExecutions.has(execution)];
    }));

    const localReader = (execution) => {
        const { closed = false, sites = new Set() } = localReaders.get(execution) ?? {};

        return closed ? sites.size : 0;
    };

    return { ...native, safe, captureSafe, captureValue, captureCallable: capturedProtocol, captureTransfer, suspensionSafe, localReader,
        reductionChanges: node => reductionChanges.get(node) !== false,
        positionsSafe: (node, site = node) => stableReceiver(node, site, true),
        lifetimeFor: node => lifetimes.get(node), copyLifetimeFor: node => copies.forNode(node), protocolFor, writeFor, receiverFor, ownedMethodFor, arrayMethodFor };
};
