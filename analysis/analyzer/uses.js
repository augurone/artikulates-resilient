import { append, put, retain } from '../collections.js';
import { propertyName } from '../estree-properties.js';
import { traverse } from '../traversal.js';
import { acquireArgumentPositions, applyOperand, choicesOf } from './argument-positions.js';
import { acquireArrayReceiver, acquireArrayResults, acquireArrayTransfers, arrayCallbacks } from './array-transfers.js';
import { acquireForwardingTargets } from './forwarding-targets.js';
import { arrayDataMethods } from './native-members.js';
import { acquireScalarUses, unresolvedArgument } from './scalar-uses.js';
import { acquireUseSelections } from './use-selections.js';

// Use roles are acquired from the existing lexical index. Rules do not rescan
// bodies, and a forwarded argument links to a formal rather than redefining it.
export const acquireUses = (promiseAt, { index = {}, capabilities = {}, callables = new Map(), namespaces = new Map(), nativeArrays = true, receiverFor,
    ownedMethodFor = () => false, arrayMethodFor = () => ({}), positionsSafe } = {}) => {
    const { references = [], invocations = [], sourceCalls = [], sourceArrays = [], bindings = [], identities = new WeakMap(), parents = new WeakMap(), operators = new WeakMap(),
        writes = new Set(), executionOf = new WeakMap(), dynamicExecutions = new Set(), callableResolutions = new WeakMap() } = index;
    const indexedInvocations = new Set(invocations.map(({ node = {} } = {}) => node));
    const byCall = new WeakMap();
    const bySubject = new Map();

    if (typeof positionsSafe !== 'function') throw new TypeError('Expected acquired array position evidence');

    const presenceBySubject = new Map();
    const presenceContexts = new Map();
    const conditions = new Map();
    const roots = new WeakMap();
    const containers = new WeakMap();
    const observedNodes = new Set();
    const testContexts = new WeakMap();
    const absenceContexts = new WeakMap();
    const resultUses = new WeakMap();
    const objectSpread = (node = {}) => {
        const { type = '' } = node;
        const { type: container = '' } = parents.get(node) ?? {};

        return type === 'JSXSpreadAttribute' || (type === 'SpreadElement' && container === 'ObjectExpression');
    };
    const resultParent = (node) => {
        const parent = parents.get(node) ?? {};
        const { type = '', test = false, expressions = [] } = parent;

        return ['LogicalExpression', 'ChainExpression'].includes(type) || (type === 'ConditionalExpression' && test !== node) ||
            (type === 'SequenceExpression' && expressions.at(-1) === node) ? [parent] : [];
    };
    const resultUseFor = (node) => {
        traverse(node, { enter: current => resultUses.has(current) ? [] : resultParent(current), leave: (current) => {
            if (resultUses.has(current)) return;

            const parent = parents.get(current) ?? {};
            const { type = '', left = false } = parent;
            const upstream = resultParent(current).length ? resultUses.get(parent) : {};
            const { consumer = parent, value = current, truthy = true, falsy = true, nullish = true } = upstream ?? {};
            const operator = type === 'LogicalExpression' && left === current && operators.get(parent);

            // A left operand reaches the consumer only on the paths that
            // select its value. Compose that constraint through each parent.
            put(resultUses, current, { consumer, value, truthy: truthy && operator !== '&&',
                falsy: falsy && operator !== '||', nullish: nullish && !['||', '??'].includes(operator) });
        } });

        return resultUses.get(node);
    };
    const testedOrDiscarded = (node) => {
        traverse(node, { enter: current => testContexts.has(current) ? [] : resultParent(current), leave: (current) => {
            if (testContexts.has(current)) return;

            const parent = parents.get(current) ?? {};
            const { type = '', test = false, expressions = [] } = parent;
            const tested = ['IfStatement', 'ConditionalExpression'].includes(type) && test === current;
            const discarded = type === 'ExpressionStatement' || (type === 'UnaryExpression' && ['!', 'typeof', 'void'].includes(operators.get(parent))) ||
                (type === 'SequenceExpression' && expressions.at(-1) !== current);

            put(testContexts, current, tested || discarded || (Boolean(resultParent(current).length) && testContexts.get(parent)));
        } });

        return testContexts.get(node);
    };
    const returnUses = new WeakMap();
    const returnContainer = (node) => {
        const { consumer = {}, value = node } = resultUseFor(node) ?? {};
        const { type = '', value: field = false, kind = '', argument = false, body = false } = consumer;

        if ((type === 'ReturnStatement' && argument === value) || (type === 'ArrowFunctionExpression' && body === value)) return true;

        if (type === 'ArrayExpression') return consumer;

        return type === 'Property' && field === value && kind === 'init' && parents.get(consumer);
    };
    const returnsDirectly = (node) => {
        const { consumer = {}, value = node } = resultUseFor(node) ?? {};
        const { type = '', argument = false, body = false } = consumer;

        return (type === 'ReturnStatement' && argument === value) || (type === 'ArrowFunctionExpression' && body === value);
    };
    const returnsValue = (node) => {
        traverse(node, { enter: (current) => {
            if (returnUses.has(current)) return [];

            const outer = returnContainer(current);

            return outer && outer !== true ? [outer] : [];
        }, leave: (current) => {
            if (returnUses.has(current)) return;

            const outer = returnContainer(current);

            put(returnUses, current, outer === true || returnUses.get(outer) === true);
        } });

        return returnUses.get(node);
    };
    const invokesValue = ({ type = '', callee = false, tag = false } = {}, value) => (
        (['CallExpression', 'NewExpression'].includes(type) && callee === value) || (type === 'TaggedTemplateExpression' && tag === value)
    );
    // A logical operand can also be the expression's result. Follow selected
    // values until absence is consumed, rather than treating selection as use.
    const consumesAbsence = (node) => {
        traverse(node, { enter: current => absenceContexts.has(current) ? [] : resultParent(current), leave: (current) => {
            if (absenceContexts.has(current)) return;

            const parent = parents.get(current) ?? {};
            const { type = '', test = false, left = false } = parent;
            const fallback = type === 'LogicalExpression' && left === current && ['||', '??'].includes(operators.get(parent));
            const tested = ['WhileStatement', 'DoWhileStatement', 'ForStatement'].includes(type) && test === current;

            put(absenceContexts, current, fallback || objectSpread(parent) || tested || testedOrDiscarded(current) ||
                (Boolean(resultParent(current).length) && absenceContexts.get(parent)));
        } });

        return absenceContexts.get(node);
    };
    const boundary = ({ type = '' } = {}) => type.endsWith('Statement') || ['VariableDeclarator', 'ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(type);
    const rootFor = (node) => {
        traverse(node, { enter: current => roots.has(current) || boundary(parents.get(current)) ? [] : [parents.get(current)].filter(Boolean), leave: (current) => {
            if (!roots.has(current)) put(roots, current, roots.get(parents.get(current)) || current);
        } });

        return roots.get(node);
    };
    const observeUse = (use = {}) => {
        const { node = false } = use;

        if (!node) return use;

        const root = rootFor(node);

        if (root !== node && !observedNodes.has(node)) {
            const entries = containers.get(root) || put(containers, root, []);

            append(entries, node);
        }

        retain(observedNodes, node);
        const calls = byCall.get(node) || put(byCall, node, []);

        append(calls, use);

        return use;
    };
    const { select: selectSubjectFor, sourceFor: selectionSourceFor, complete: completeSelections } = acquireUseSelections(bySubject, observeUse);

    if (typeof selectSubjectFor !== 'function' || typeof selectionSourceFor !== 'function' || typeof completeSelections !== 'function') {
        throw new TypeError('Expected use selection acquisition');
    }

    const arrayResults = acquireArrayResults(bySubject, selectSubjectFor, selectionSourceFor);
    const { positionRelay } = arrayResults;

    if (typeof positionRelay !== 'function') throw new TypeError('Expected array position relay');

    // Check the required acquisition functions before capture so defaults cannot manufacture evidence.
    const { subjectFor, testFor } = capabilities;

    if (typeof subjectFor !== 'function' || typeof testFor !== 'function' ||
        typeof promiseAt !== 'function' || typeof receiverFor !== 'function' || typeof positionsSafe !== 'function') {
        throw new TypeError('Expected lexical capability acquisition');
    }

    const protocols = new WeakMap();
    const protocolFor = node => protocols.get(node) || put(protocols, node, receiverFor(node));
    const invokesReceiver = (member, value) => {
        const { type = '', object = false } = member;
        const { type: use = '', callee = false } = parents.get(member) ?? {};

        if (type !== 'MemberExpression' || object !== value || use !== 'CallExpression' || callee !== member) return false;

        const { method = '', replacement = false } = protocolFor(member);

        return method && !replacement;
    };
    const resultRoles = new WeakMap();
    const classifyResult = (node) => {
        const { consumer = {}, value = node } = resultUseFor(node) ?? {};
        const { type = '', test = false } = consumer;

        if (invokesValue(consumer, value) || invokesReceiver(consumer, value)) return 'invoke';

        if (testedOrDiscarded(node) || (['WhileStatement', 'DoWhileStatement', 'ForStatement'].includes(type) && test === value)) return 'discard';

        return returnsValue(node) ? 'return' : 'observe';
    };
    const { argumentFor, argumentsFor, elementFor, widthFor } = acquireArgumentPositions(parents, resultUseFor, nativeArrays, protocolFor);

    if (typeof widthFor !== 'function') throw new TypeError('Expected acquired array width evidence');

    if (typeof argumentsFor !== 'function') throw new TypeError('Expected acquired argument layouts');

    if (typeof argumentFor !== 'function' || typeof elementFor !== 'function') throw new TypeError('Expected argument position acquisition');

    // Presence is separate from callable evidence. Only stable lexical values
    // may carry a short-circuit test into a selected branch.
    const conditionFor = (node, capability) => {
        const acquired = conditions.get(capability) || put(conditions, capability, new WeakMap());

        traverse(node, { enter: (current = {}) => {
            const { type = '', argument = false, left = false, right = false } = current;
            const operator = operators.get(current) || '';

            if (acquired.has(current)) return [];

            if (type === 'UnaryExpression' && operator === '!') return [argument];

            return type === 'LogicalExpression' && ['&&', '||'].includes(operator) ? [left, right] : [];
        }, leave: (current = {}) => {
            if (acquired.has(current)) return;

            const { type = '', argument = false, left = false, right = false } = current;
            const operator = operators.get(current) || '';
            const { truthy = false, falsey = false } = acquired.get(argument) ?? {};
            const { truthy: leftTrue = false, falsey: leftFalse = false } = acquired.get(left) ?? {};
            const { truthy: rightTrue = false, falsey: rightFalse = false } = acquired.get(right) ?? {};

            if (type === 'UnaryExpression' && operator === '!') {
                put(acquired, current, { truthy: falsey, falsey: truthy });

                return;
            }

            if (type === 'LogicalExpression' && ['&&', '||'].includes(operator)) {
                put(acquired, current, operator === '&&' ? { truthy: leftTrue || rightTrue, falsey: leftFalse && (leftTrue || rightFalse) }
                    : { truthy: leftTrue && (leftFalse || rightTrue), falsey: leftFalse || rightFalse });

                return;
            }

            const { capability: tested = false, positive = false, syntaxOnly = false, unsupported = false } = testFor(current);
            const proved = tested === capability && !syntaxOnly && !unsupported;

            put(acquired, current, { truthy: subjectFor(current) === capability || (proved && positive), falsey: proved && !positive });
        } });

        return acquired.get(node);
    };
    const presentAt = (node, capability) => {
        const contexts = presenceContexts.get(capability) || put(presenceContexts, capability, new WeakMap());

        traverse(node, { enter: current => contexts.has(current) ? [] : [parents.get(current)].filter(Boolean), leave: (current) => {
            if (contexts.has(current)) return;

            const parent = parents.get(current) ?? {};
            const { type = '', test = false, left = false, right = false, consequent = false, alternate = false, body = false, update = false } = parent;
            const boundary = ['Program', 'ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(type);
            const logical = type === 'LogicalExpression' && right === current;
            const branch = ['IfStatement', 'ConditionalExpression'].includes(type) && (current === consequent || current === alternate);
            const loop = (type === 'WhileStatement' && current === body) || (type === 'ForStatement' && (current === body || current === update));
            const operator = operators.get(parent) || '';
            const condition = logical ? left : (branch || loop) && test;
            const { truthy = false, falsey = false } = condition ? conditionFor(condition, capability) : {};
            const selected = (logical && ((operator === '&&' && truthy) || (operator === '||' && falsey))) ||
                (branch && (current === consequent ? truthy : falsey)) || (loop && truthy);

            put(contexts, current, !boundary && (selected || contexts.get(parent) === true));
        } });

        return contexts.get(node);
    };

    const packedSubjects = new Map();
    const packedSubjectFor = (subject, slot = 0, depth = 1) => {
        const subjects = packedSubjects.get(subject) || put(packedSubjects, subject, new Map());
        const key = `${depth}:${slot}`;

        return subjects.get(key) || put(subjects, key, Object.freeze({}));
    };
    const selectedSubjects = new WeakMap();
    const subjectsFor = (node) => {
        if (selectedSubjects.has(node)) return selectedSubjects.get(node);

        const selected = [];

        traverse(node, { enter: (current) => {
            const subject = subjectFor(current);

            if (subject) append(selected, subject);

            return subject ? [] : choicesOf(current);
        } });

        return put(selectedSubjects, node, selected);
    };
    const insertedValues = new Set([...sourceArrays.flatMap(({ elements = [] } = {}) => elements.filter(Boolean).flatMap(subjectsFor)),
        ...sourceCalls.flatMap(({ node = {} } = {}) => {
            const { callee: { type = '', computed = false, property: key = {} } = {} } = node;
            const { name = '' } = propertyName({ computed, key });

            return type === 'MemberExpression' && ['with', 'fill', 'toSpliced', 'concat'].includes(name) ? argumentsFor(node).flatMap(subjectsFor) : [];
        })]);
    const formalAt = acquireForwardingTargets({ index, callables, namespaces, subjectFor, packedSubjectFor, bySubject, promiseAt, selectSubjectFor, insertedValues });
    const methodFor = ({ type = '', computed = false, property: key = {} } = {}) => {
        const { name = '' } = propertyName({ computed, key });

        return type === 'MemberExpression' ? name : '';
    };
    const collectionFor = (node) => {
        const { type = '', computed = false, object = {}, property: key = {} } = node;
        const name = methodFor(node);
        const { known = false } = propertyName({ computed, key });

        if (arrayCallbacks.has(name)) return true;

        const { init = object } = identities.get(object) ?? {};
        const { type: receiver = '' } = init ? init : object;

        return type === 'MemberExpression' && computed && !known && receiver === 'ArrayExpression';
    };
    const callTarget = (node) => {
        const method = ownedMethodFor(node);
        const { type = '', computed = false, property: key = {} } = node;
        const { known = false } = propertyName({ computed, key });
        const unresolvedKey = type === 'MemberExpression' && computed && !known;
        const { nonArray = false } = arrayDataMethods.has(methodFor(node)) ? arrayMethodFor(node) : {};
        const unresolvedMember = unresolvedKey || (nonArray && !method);

        if (!collectionFor(node)) return { callee: method || node, collection: false, unresolvedMember };

        const { object = {} } = node;
        const { defined = false } = !method && namespaces.has(callableResolutions.get(object)) ? formalAt(node, 0) : {};

        return { callee: method || node, collection: !method && !defined, collectionFallback: Boolean(method || defined) };
    };
    const effectiveArgument = (value, spreading = false, placement = {}) => {
        const use = Object.hasOwn(placement, 'minimum') ? placement : argumentFor(value);
        const { call = false, minimum = Infinity, maximum: limit = Infinity, apply = false } = use ? use : {};
        const maximum = spreading ? Infinity : limit;
        const { type = '', tag = {}, callee = tag } = call ? call : {};
        const { method = '', replacement = false, uncertain = false, chained = false } = type === 'CallExpression' ? protocolFor(callee) : {};
        const { object = {} } = callee;
        const receiver = !replacement && !uncertain && (method === 'call' || apply);
        const shift = receiver && method === 'call' && maximum > 0;
        const first = shift ? Math.max(0, minimum - 1) : minimum;
        const last = shift ? maximum - 1 : maximum;
        const selected = replacement || (receiver ? object : callee);
        const unresolved = !replacement && (uncertain || chained);
        const available = replacement || unresolved || ((method !== 'apply' || apply) && (method !== 'call' || maximum > 0));
        const target = type === 'CallExpression' && available && !replacement ? callTarget(selected) : { callee: selected, collection: false };
        const { collection = false, collectionFallback = false, unresolvedMember = false } = target;

        return { ...use, ...target, receiver, replacement: Boolean(replacement), unresolved, construct: type === 'NewExpression',
            minimum: available ? first : Infinity, maximum: available ? last : Infinity,
            collection: first === 0 && collection, collectionFallback, unresolvedMember: first === 0 && unresolvedMember };
    };
    const carriers = [new WeakMap(), new WeakMap(), new WeakMap()];
    const returnedCarriers = [new WeakMap(), new WeakMap(), new WeakMap()];
    const carrierFor = (node, depth, returned = false) => {
        const store = (returned ? returnedCarriers : carriers).at(depth - 1);

        if (store.has(node)) return store.get(node);

        const subject = Object.freeze({});

        put(bySubject, subject, []);

        return put(store, node, subject);
    };
    const usesFor = subject => bySubject.get(subject) || put(bySubject, subject, []);
    const retainUse = (capability, node, description, subject = capability) => {
        append(usesFor(subject), observeUse(Object.freeze({ capability, node, ...description })));
    };
    const visitedCarriers = [new WeakSet(), new WeakSet(), new WeakSet()];
    const positionedCarriers = [new WeakSet(), new WeakSet(), new WeakSet()];
    const visitedReturns = [new WeakSet(), new WeakSet(), new WeakSet()];
    const traceCarrier = (node, depth, use, positioned = true, returned = false) => {
        append(bySubject.get(carrierFor(node, depth, returned)), use);
        const linkCarrier = (current, depth, target, offset = {}, enclosed = false, uncertainPositions = false) => {
            append(bySubject.get(carrierFor(current, depth, returned)), { kind: 'forward', target, offset, enclosed, uncertainPositions });

            return { current, depth };
        };
        traverse({ current: node, depth }, { enter: ({ current = {}, depth = 1 } = {}) => {
            const directVisits = positioned ? positionedCarriers : visitedCarriers;
            const visits = returned ? visitedReturns : directVisits;
            const visited = visits.at(depth - 1);

            if (visited.has(current)) return [];

            retain(visited, current);
            const { type = '', elements = [] } = current;
            const { init = false, parameterPattern = false, pattern: { type: pattern = '' } = {} } = identities.get(current) ?? {};
            const target = carrierFor(current, depth, returned);
            const subject = type === 'Identifier' && parameterPattern && subjectFor(current);
            const rest = pattern === 'RestElement';
            const uncertainPositions = type === 'Identifier' && !positionsSafe(current);
            const transport = subject && (rest || depth < 3);
            const slots = rest && depth > 1 ? [0, 1, 2] : [0];
            const positionedSlots = positioned && rest && depth > 1 ? [-1] : slots;
            const selectedSlots = returned ? [0] : positionedSlots;
            const carrierDepth = rest ? depth - 1 : depth;
            const selectedDepth = returned ? -depth : carrierDepth;

            if (transport) selectedSlots.forEach(slot => append(usesFor(packedSubjectFor(subject, slot, selectedDepth)),
                { kind: 'forward', target, uncertainPositions }));

            if (type === 'Identifier' && init) return [linkCarrier(init, depth, target, {}, false, uncertainPositions)];

            if (type !== 'ArrayExpression') return choicesOf(current).map(choice => linkCarrier(choice, depth, target));

            return elements.filter(Boolean).flatMap((element) => {
                const { type = '', argument = false } = element;

                if (type === 'SpreadElement') return [linkCarrier(argument, depth, target, elementFor(element))];

                return depth > 1 ? [linkCarrier(element, depth - 1, target, {}, elementFor(element))] : [];
            });
        } });
    };
    const elementTarget = (node, subject) => {
        const { minimum = 0, maximum = Infinity } = elementFor(node);

        return selectSubjectFor(subject, minimum, maximum);
    };
    const localResult = ({ type = '', id = false, init = false } = {}, value) => type === 'VariableDeclarator' && init === value && subjectFor(id);
    // Returned values have their own consumers. An await forwards fulfillment;
    // a stable local binding forwards to its acquired uses. Neither operation
    // turns the producer's unrelated effects into a result requirement.
    const resultBoundary = (node) => {
        const { consumer = {}, value = node } = resultUseFor(node) ?? {};
        const { type = '', object = false, computed = false, property: key = {} } = consumer;
        const { name = '', known = false } = computed ? propertyName({ computed, key }) : {};
        const indexed = type === 'MemberExpression' && object === value && computed && (!known || /^(0|[1-9]\d*)$/u.test(name));
        const selection = indexed && (known ? { minimum: Number(name), maximum: Number(name) } : { minimum: 0, maximum: Infinity });
        const carrier = type === 'ArrayExpression' && carriers.at(0).get(consumer);
        const binding = localResult(consumer, value);
        const alias = binding || (carrier && elementTarget(value, carrier));
        const argument = effectiveArgument(type === 'SpreadElement' ? consumer : value, type === 'SpreadElement');
        const { call = false } = argument;

        return { consumer, binding, alias, argument, selection, next: type === 'AwaitExpression' || indexed ? consumer : call };
    };
    const transferFor = acquireArrayTransfers({ methodFor, arrayMethodFor, argumentsFor, widthFor: node => widthFor(node), selectionSourceFor,
        operators, identities, positionsSafe: (node, site) => positionsSafe(node, site), nativeArrays });
    const forwardingFor = ({ call = {}, callee = {}, minimum = Infinity, maximum = minimum, construct = false, receiver = false, replacement = false } = {}, result = {}) => {
        const formal = formalAt(callee, minimum, construct, maximum);
        const { defined: authored = false } = formal;
        const transfer = authored || receiver || replacement ? {} : transferFor(call);
        const { name = '', args = [], minimum: size = 0, maximum: limit = Infinity, start = Infinity, end = Infinity,
            insertionStart = start, fixed = false, offsets = [], inputs = new Map() } = transfer;
        const reduce = name === 'reduce' || name === 'reduceRight';
        const relevant = ((reduce || name === 'with') && minimum <= 1 && maximum >= 1) ||
            (name === 'fill' && minimum === 0) || (name === 'toSpliced' && maximum >= 2) || name === 'concat';

        if (!name || !relevant || !Number.isFinite(minimum)) return formal;

        const key = `${minimum}:${maximum}`;

        if (inputs.has(key)) return inputs.get(key);

        const target = Object.freeze({});

        if (reduce) {
            const [callback = {}] = args;
            const { target: accumulator = false, localProofOnly = false, defined = false, available = false, ...packed } = formalAt(callback, 0);
            const effect = !defined || (available && !accumulator) ? { kind: 'argument' }
                : { kind: 'forward', target: accumulator, localProofOnly, absenceSafe: true, unresolvedRequiresCallable: true };
            const effects = limit === 0 ? [] : [effect];

            const entries = size === 0 ? [...effects, { kind: 'result' }] : effects;

            put(bySubject, target, entries);

            const seed = args.at(1);
            const retained = size === 0 && seed ? [1, 2] : [];

            retained.forEach(depth => traceCarrier(seed, depth,
                { kind: 'forward', target: carrierFor(call, depth, true) }, true, true));

            const contents = ['packedTarget', 'nestedPackedTarget'].map((field, depth) => {
                const { [field]: effect = false } = packed;
                const { packedResultTarget = false, nestedResultTarget = false } = result;
                const consumer = depth ? nestedResultTarget : packedResultTarget;
                const joined = Object.freeze({});
                const entries = [limit > 0 && effect && { kind: 'forward', target: effect },
                    size === 0 && consumer && { kind: 'forward', target: consumer }].filter(Boolean);

                put(bySubject, joined, entries);

                return joined;
            });
            const [packedTarget = false, nestedPackedTarget = false] = contents;

            return put(inputs, key, { ...packed, defined: true, available: true, target, packedTarget, nestedPackedTarget });
        }

        const { packedResultTarget = false, nestedResultTarget = false, resultRole = '' } = result;
        const insertedOffset = name === 'toSpliced' ? minimum - 2 : 0;
        const position = fixed && minimum === maximum ? start + insertedOffset : Infinity;
        const concatenated = minimum === maximum ? offsets.at(minimum) : Infinity;
        const first = name === 'concat' ? concatenated : position;
        const last = name === 'fill' ? end - 1 : first;
        const earliest = name === 'toSpliced' ? insertionStart + insertedOffset : first;
        const lower = Number.isFinite(first) ? Math.max(0, earliest) : 0;
        const upper = Number.isFinite(first) && !Number.isNaN(last) ? last : Infinity;
        const empty = upper < lower;
        const output = !empty && packedResultTarget && selectSubjectFor(packedResultTarget, lower, upper);
        const kind = !empty && resultRole === 'return' ? 'result' : 'data';
        const use = output ? { kind: 'forward', target: output } : { kind, absenceSafe: true };

        put(bySubject, target, [use]);

        const value = args.at(minimum);

        if (!empty && value && minimum === maximum) {
            subjectsFor(value).forEach(subject => retainUse(subject, value, { kind: 'forward', execution: executionOf.get(value),
                target: carrierFor(call, 1, true), offset: { minimum: lower, maximum: upper } }, packedSubjectFor(subject, 0, -3)));
            [1, 2].filter(depth => name === 'concat' || depth === 1).forEach((depth) => {
                traceCarrier(value, depth, { kind: 'forward', target: carrierFor(call, name === 'concat' ? depth : depth + 1, true),
                    ...(name === 'concat' ? { offset: { minimum: lower, maximum: upper } } : { enclosed: { minimum: lower, maximum: upper } }) }, true, true);
                traceCarrier(value, depth, { kind: 'data', absenceSafe: true });
            });
        }

        if (resultRole === 'return') traceCarrier(call, 1, { kind: 'result' }, true, true);

        const range = { minimum: lower, maximum: upper };
        const concatenating = name === 'concat';
        const placement = concatenating ? { offset: range, uncertainPositions: !Number.isFinite(first) } : { enclosed: range };
        const packedTarget = !empty && positionRelay(concatenating ? packedResultTarget : nestedResultTarget, placement);
        const nestedPackedTarget = !empty && concatenating && positionRelay(nestedResultTarget, placement);

        return put(inputs, key, { defined: true, available: true, target, packedTarget, nestedPackedTarget, consumesResult: true });
    };
    const returnedPackedElements = ({ restReturnTarget = false, restPackedReturnTarget = false, returnMinimum = 0, returnMaximum = Infinity,
        target = false, localProofOnly = false, consumesResult = false } = {}, result = {}, contents = []) => {
        if (consumesResult) return { resultRole: 'discard' };

        const { packedResultTarget = false, nestedResultTarget = false } = result;
        const [inner = false] = contents;
        const returned = inner ? restPackedReturnTarget : restReturnTarget;
        const consumer = inner ? nestedResultTarget : packedResultTarget;

        if (!returned || !consumer || contents.length > 1) return result;

        const joined = Object.freeze({});
        const returnedContents = Object.freeze({});
        const resultUse = { kind: 'forward', target: returned, localProofOnly, resultRole: 'consumer',
            resultTarget: consumer, nestedResultTarget: inner ? false : nestedResultTarget, resultDepth: inner ? 2 : 1, selectResult: true };

        put(bySubject, returnedContents, [resultUse]);

        if (inner) {
            const enclosed = Object.freeze({});
            const { minimum = 0, maximum = Infinity } = inner;

            put(bySubject, enclosed, [{ kind: 'forward', target: returnedContents, enclosed: { minimum: returnMinimum, maximum: returnMaximum } }]);
            put(bySubject, joined, [{ kind: 'forward', target, localProofOnly, ...result },
                { kind: 'forward', target: selectSubjectFor(enclosed, minimum, maximum) }]);

            return { target: joined, resultRole: 'discard', resultTarget: false };
        }

        put(bySubject, joined, [
            { kind: 'forward', target, localProofOnly, ...result },
            { kind: 'forward', target: selectSubjectFor(returnedContents, returnMinimum, returnMaximum) }
        ]);

        return { target: joined, resultRole: 'discard', resultTarget: false };
    };
    const returnedElements = ({ valueReturnTarget = false, target: original = false, localProofOnly = false, ...formal } = {},
        { packedResultTarget = false, nestedResultTarget = false, ...result } = {}, contents = []) => {
        const packed = returnedPackedElements({ target: original, localProofOnly, ...formal }, { packedResultTarget, nestedResultTarget, ...result }, contents);
        const { target = original } = packed;

        if (valueReturnTarget && packedResultTarget && !contents.length) {
            const continuation = Object.freeze({});
            const joined = Object.freeze({});

            put(bySubject, continuation, [{ kind: 'forward', target: valueReturnTarget, selectResult: true,
                resultRole: 'consumer', resultTarget: packedResultTarget, nestedResultTarget }]);
            put(bySubject, joined, [{ kind: 'forward', target, localProofOnly, ...packed },
                { kind: 'forward', target: selectSubjectFor(continuation, 0, 0) }]);

            return { target: joined, resultRole: '', resultTarget: false };
        }

        return packed;
    };
    const spreadTargetFor = raw => selectionSourceFor((path) => {
        const [{ minimum: lower = 0, maximum: upper = Infinity } = {}] = path;
        const { minimum: first = 0, maximum: last = Infinity } = raw ?? {};
        const placement = effectiveArgument(false, false, { ...raw, minimum: first + lower, maximum: last + upper });
        const { call = false, minimum = Infinity, maximum = Infinity, collection = false, unresolvedMember = false } = placement;
        const selected = forwardingFor(placement, resultRoles.get(call));
        const { target = false, packedTarget = false, nestedPackedTarget = false, defined = false, available = false, localProofOnly = false } = selected;
        const reached = [target, packedTarget, nestedPackedTarget].at(path.length - 1);
        const callback = collection || unresolvedArgument(placement, selected);

        return [{ ...(callback ? { kind: 'argument' } : { kind: 'forward', target: reached, localProofOnly,
            absenceSafe: true, unresolvedRequiresCallable: minimum !== maximum || unresolvedMember, unresolvedValue: !target && (!defined || available),
            ...returnedElements({ ...selected, target: reached }, resultRoles.get(call), path.slice(1)) }),
        selected: { minimum: 0, maximum: Infinity }, unnest: true }];
    });
    const resultFor = (node) => {
        traverse(node, { enter: current => resultRoles.has(current) ? [] : [resultBoundary(current).next].filter(Boolean), leave: (current) => {
            if (resultRoles.has(current)) return;

            const { consumer = {}, binding = false, alias = false, argument = {}, selection = false, next = false } = resultBoundary(current);
            const { type = '' } = consumer;

            if (type === 'AwaitExpression') {
                put(resultRoles, current, resultRoles.get(next) || { resultRole: 'observe' });

                return;
            }

            if (selection) {
                const { resultRole = '', resultTarget = false, packedResultTarget: contents = false } = resultRoles.get(next) ?? {};
                const packedResultTarget = Object.freeze({});
                const nestedResultTarget = Object.freeze({});
                const kind = [resultRole === 'invoke' && 'argument', resultRole === 'return' && 'result'].find(Boolean);
                const forwarding = resultTarget ? [{ kind: 'forward', target: resultTarget, selected: selection }] : [];

                put(bySubject, packedResultTarget, kind ? [{ kind, selected: selection }] : forwarding);
                put(bySubject, nestedResultTarget, contents ? [{ kind: 'forward', target: contents, selected: selection, unnest: true }] : []);
                put(resultRoles, current, { resultRole: 'observe', packedResultTarget, nestedResultTarget });

                return;
            }

            const { value = current } = resultUseFor(current) ?? {};
            const { type: receiverType = '', object = false } = consumer;

            if (receiverType === 'MemberExpression' && object === value && !invokesReceiver(consumer, value)) {
                put(resultRoles, current, { resultRole: 'observe', packedResultTarget: carrierFor(current, 1), nestedResultTarget: carrierFor(current, 2) });

                return;
            }

            if (alias) {
                put(resultRoles, current, { resultRole: 'consumer', resultTarget: alias,
                    ...(binding ? { packedResultTarget: carrierFor(current, 1), nestedResultTarget: carrierFor(current, 2) } : {}) });

                return;
            }

            const { call = false, minimum = Infinity, maximum = Infinity, collection = false, collectionFallback = false, unresolvedMember = false } = argument;

            if (!call) {
                put(resultRoles, current, { resultRole: classifyResult(current) });

                return;
            }

            const formal = forwardingFor(argument, resultRoles.get(call));
            const { target = false, packedTarget = false, nestedPackedTarget = false, defined = false, available = false, localProofOnly = false } = formal;
            const ambiguous = minimum !== maximum;
            const uncertain = unresolvedArgument(argument, formal);
            const resultTarget = Object.freeze({});
            const entries = collection || uncertain ? [{ kind: 'argument' }] : [{ kind: 'forward', target, localProofOnly,
                absenceSafe: true, unresolvedRequiresCallable: ambiguous || collectionFallback || unresolvedMember,
                unresolvedValue: !target && (!defined || available), ...returnedElements(formal, resultRoles.get(call)) }];

            put(bySubject, resultTarget, entries);

            if (type === 'SpreadElement') {
                const packedResultTarget = spreadTargetFor(argumentFor(consumer));

                put(resultRoles, current, { resultRole: 'observe', packedResultTarget });

                return;
            }

            put(resultRoles, current, { resultRole: 'consumer', resultTarget, packedResultTarget: packedTarget, nestedResultTarget: nestedPackedTarget });
        } });

        return resultRoles.get(node);
    };
    const contentResult = (node, depth) => {
        const { resultRole = '', packedResultTarget = false, nestedResultTarget = false } = resultFor(node);
        const target = depth === 1 ? packedResultTarget : nestedResultTarget;

        return target ? { resultRole: 'consumer', resultTarget: target, nestedResultTarget: depth === 1 && nestedResultTarget, resultDepth: depth,
            selectResult: true } : { resultRole: resultRole === 'return' ? 'return' : 'discard' };
    };
    const carrierUses = new WeakSet();
    const packedArguments = new WeakSet();
    const restReads = new Map();

    references.forEach(({ node = {} } = {}) => {
        const binding = identities.get(node);
        const { parameterPattern = false, pattern: { type = '' } = {}, declaration: { node: declared = false } = {} } = binding ?? {};

        if (node !== declared && parameterPattern && type === 'RestElement') put(restReads, binding, (restReads.get(binding) || 0) + 1);
    });
    const tracePackedArgument = (node) => {
        if (packedArguments.has(node)) return;

        retain(packedArguments, node);
        const { truthy = false, value = node } = resultUseFor(node) ?? {};

        if (!truthy) return;

        const placement = effectiveArgument(value);
        const { call = false, unresolved = false } = placement;

        if (!call) return;

        if (unresolved) {
            [1, 2].forEach(depth => traceCarrier(node, depth, { kind: 'argument' }));

            return;
        }

        const { packedTarget = false, nestedPackedTarget = false, packedReturnTarget = false, nestedReturnTarget = false,
            restPackedReturnTarget = false, returnMinimum = 0, returnMaximum = Infinity, consumesResult = false } = forwardingFor(placement, resultFor(call));

        [packedTarget, nestedPackedTarget].forEach((target, index) => {
            if (target) traceCarrier(node, index + 1, { kind: 'forward', target,
                unresolvedRequiresCallable: true, ...consumesResult ? { resultRole: 'discard' } : resultFor(call) });
        });
        [packedReturnTarget, nestedReturnTarget].forEach((target, index) => {
            if (!target) return;

            const result = contentResult(call, index + 1);
            const { resultRole = '' } = result;
            const use = { kind: 'forward', target, ...result };

            traceCarrier(node, index + 1, use, true, resultRole === 'return');
        });

        if (restPackedReturnTarget) {
            const target = Object.freeze({});
            const result = contentResult(call, 2);
            const { resultRole = '' } = result;
            const use = { kind: 'forward', target, enclosed: { minimum: returnMinimum, maximum: returnMaximum } };

            put(bySubject, target, [{ kind: 'forward', target: restPackedReturnTarget, ...result }]);
            traceCarrier(node, 1, use, true, resultRole === 'return');
        }
    };
    const traceReceiver = acquireArrayReceiver({
        resultUseFor, resultFor, positionsSafe, traceCarrier, argumentsFor, arrayMethodFor, nativeArrays, subjectFor,
        transferFor, formalAt, callables, callableResolutions, capabilities, carrierFor, ...arrayResults
    });

    const traceReturnedCarrier = (node) => {
        if (returnsDirectly(node)) [1, 2].forEach(depth => traceCarrier(node, depth, { kind: 'result', returnNode: node }, true, true));
    };

    sourceArrays.forEach(tracePackedArgument);
    sourceArrays.forEach(traceReceiver);
    sourceCalls.forEach(({ node = {} } = {}) => {
        traceReceiver(node);
        traceReturnedCarrier(node);
    });
    references.forEach(({ node = {} } = {}) => {
        const binding = identities.get(node);

        if (!binding) return;

        traceReceiver(node);

        const { result: returnedBinding = false } = subjectFor(node) ?? {};

        if (returnedBinding && returnsDirectly(node)) [1, 2].forEach(depth => traceCarrier(node, depth, { kind: 'result', returnNode: node }, true, true));

        const { consumer = {}, value = node, truthy = false } = resultUseFor(node) ?? {};
        const { type = '' } = consumer;

        if (!truthy) return;

        const spread = type === 'SpreadElement';
        const raw = argumentFor(spread ? consumer : value);
        const placement = raw ? raw : {};
        const applying = applyOperand(spread ? { ...placement, maximum: Infinity } : placement, protocolFor);

        if (!spread && !applying) {
            tracePackedArgument(node);

            return;
        }

        const { call: receiverCall = {} } = placement;
        const { callee: receiverCallee = {} } = receiverCall;
        const { object = {} } = receiverCallee;
        const { uncertain: receiverChanged = false, chained = false } = applying ? protocolFor(receiverCallee) : {};
        const { callee = {}, collection = false, collectionFallback = false, minimum = Infinity, construct = false, unresolved = false } = applying
            ? { ...callTarget(object), minimum: 0,
                unresolved: receiverChanged || chained } : effectiveArgument(consumer, true);
        const { defined = false, available = false, unknown = false, target = false, packedTarget = false, nestedPackedTarget = false } = collection ? {}
            : formalAt(callee, minimum, construct, Infinity);
        const required = collection || unresolved || (Number.isFinite(minimum) && (unknown || !defined || (collectionFallback && available && !target)));

        if (!required && !target && !packedTarget && !nestedPackedTarget) return;

        if ((!applying && !unresolved) || (applying && !spread && !receiverChanged && !chained)) {
            const raw = applying ? { ...placement, minimum: 0, maximum: 0, apply: true } : placement;
            resultFor(receiverCall);

            const target = spreadTargetFor(raw);

            retain(carrierUses, node);
            [1, 2, 3].forEach(depth => traceCarrier(node, depth, { kind: 'forward', target }));

            return;
        }

        const depths = spread && applying ? [2] : [1];
        const { call: actualCall = false } = placement;
        const result = actualCall ? resultFor(actualCall) : { resultRole: 'observe' };
        const use = required ? { kind: 'argument' } : { kind: 'forward', target, unresolvedRequiresCallable: true, ...result };

        if (spread && applying && receiverChanged) append(depths, 1);

        if (applying && chained) append(depths, spread ? 3 : 2);

        if (spread && !applying && unresolved) [2, 3].forEach(depth => append(depths, depth));

        retain(carrierUses, node);

        const rest = nativeArrays && restReads.get(binding) === 1 && !writes.has(binding) &&
            !dynamicExecutions.has(executionOf.get(node)) && subjectFor(node);
        const { minimum: earliest = Infinity, maximum: latest = Infinity } = placement;

        if (required || target) depths.forEach((depth) => {
            if (depth !== 2 || !applying || !rest) {
                traceCarrier(node, depth, use, false);

                return;
            }

            // The native apply operand is argument one. A direct rest spread
            // can contribute that operand from only its first two slots.
            [0, 1].filter(slot => earliest + slot <= 1 && latest + slot >= 1)
                .forEach(slot => append(usesFor(packedSubjectFor(rest, slot)), use));
        });

        if (spread && !applying) [packedTarget, nestedPackedTarget].forEach((target, index) => {
            if (target) traceCarrier(node, index + 2, { kind: 'forward', target, unresolvedRequiresCallable: true, ...result });
        });
    });
    sourceArrays.forEach(traceReturnedCarrier);
    acquireScalarUses({
        references, identities, parents, operators, bindings, indexedInvocations, presenceBySubject, subjectFor, testFor,
        retainUse, testedOrDiscarded, presentAt, resultUseFor, invokesValue, effectiveArgument, forwardingFor, resultFor, carrierFor,
        packedSubjectFor, carriers, returnedCarriers, elementFor, elementTarget, localResult, consumesAbsence, invokesReceiver,
        returnedElements, carrierUses, index, objectSpread, returnsValue, usesFor, positionsSafe
    });

    completeSelections();

    return { bySubject, presenceBySubject, observedNodes, forCall: node => byCall.get(node) || [], forContainer: node => containers.get(node) || [] };
};
