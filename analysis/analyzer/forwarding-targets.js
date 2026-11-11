import { append, put, retain } from '../collections.js';
import { propertyName } from '../estree-properties.js';
import { traverse } from '../traversal.js';
import { choicesOf } from './argument-positions.js';
import { locationOf } from './locations.js';

const unresolved = Object.freeze({ defined: false });
const unused = Object.freeze({ defined: true });

// Resolve a formal at a position through source selections. A shared join
// owns forwarding edges to its alternatives without expanding callee paths.
export const acquireForwardingTargets = ({ index = {}, callables = new Map(), namespaces = new Map(), subjectFor, packedSubjectFor, promiseAt, selectSubjectFor,
    bySubject = new Map(), insertedValues = new Set() } = {}) => {
    const { functionEntries = [], sourceCalls = [], executionOf = new WeakMap(), callableResolutions = new WeakMap(), writes = new Set() } = index;
    const parameters = new WeakMap();
    const owners = new WeakMap();
    const insertedExecutions = new Set([...insertedValues].map(({ execution = false } = {}) => execution));
    const definitions = new WeakMap();
    const groups = new WeakMap();
    const positions = new WeakMap();
    const constructionPositions = new WeakMap();
    const executor = Object.freeze({});
    const executorFormal = Object.freeze({ defined: true, available: true, target: executor, localProofOnly: true });

    if (typeof subjectFor !== 'function' || typeof packedSubjectFor !== 'function' || typeof promiseAt !== 'function' || typeof selectSubjectFor !== 'function') {
        throw new TypeError('Expected callable target acquisition');
    }

    put(bySubject, executor, [{ kind: 'argument' }]);

    const restContent = (container, slot, depth, minimum, maximum) => {
        const target = Object.freeze({});

        put(bySubject, target, [
            { kind: 'forward', target: packedSubjectFor(container, slot, depth) },
            { kind: 'forward', target: packedSubjectFor(container, -1, depth), enclosed: { minimum, maximum } }
        ]);

        return target;
    };
    const restTarget = (container, elements, minimum, maximum) => {
        const target = Object.freeze({});

        put(bySubject, target, [{ kind: 'forward', target: container, consumed: false, resultRole: 'discard' },
            { kind: 'forward', target: selectSubjectFor(elements, minimum, maximum) }]);

        return target;
    };

    functionEntries.forEach(({ node = {}, params = [], execution = false } = {}) => {
        const { generator = false } = node;

        const formals = put(parameters, node, params.flatMap((parameter = {}, position) => {
            const { type = '', left = parameter, argument = parameter } = parameter;
            const rest = type === 'RestElement';
            const binding = rest ? argument : left;
            const { type: shape = '' } = binding ? binding : {};
            const target = shape === 'Identifier' && subjectFor(binding);
            const elements = rest && target && packedSubjectFor(target, 0, 0);

            const slots = rest ? [0, 1, 2] : [0];

            return slots.map(slot => ({
                defined: true, available: true, target: elements ? restTarget(target, elements, slot, slot) : target,
                packedTarget: target && (rest ? restContent(target, slot, 1, slot, slot) : packedSubjectFor(target, slot)),
                nestedPackedTarget: target && (rest ? restContent(target, slot, 2, slot, slot) : packedSubjectFor(target, slot, 2)),
                get valueReturnTarget() { return !rest && insertedExecutions.has(execution) && target && packedSubjectFor(target, slot, -3); },
                packedReturnTarget: !rest && target && packedSubjectFor(target, slot, -1),
                nestedReturnTarget: !rest && target && packedSubjectFor(target, slot, -2),
                restReturnTarget: rest && target && packedSubjectFor(target, 0, -1),
                restPackedReturnTarget: rest && target && packedSubjectFor(target, 0, -2),
                returnMinimum: slot, returnMaximum: slot,
                elements, container: target, start: position,
                rest: rest && slot === 2, unknown: shape === 'Identifier' && !target,
                localProofOnly: generator || type === 'AssignmentPattern'
            }));
        }));
        put(owners, formals, execution);
    });
    const definitionFor = (node) => {
        if (definitions.has(node)) return definitions.get(node);

        const binding = callableResolutions.get(node);
        const { type = '', object = {}, computed = false, property = {} } = node;
        const { fields = new Map() } = type === 'MemberExpression' ? namespaces.get(callableResolutions.get(object)) ?? {} : {};
        const { known = false, name = '' } = propertyName({ computed, key: property });
        const exported = known && fields.get(name);
        const formals = parameters.get(node) || parameters.get(callables.get(binding)) || parameters.get(callables.get(exported) || exported);
        const { init = false, stable = false } = binding ?? {};
        const choices = stable && init && !writes.has(binding) ? [init] : choicesOf(node);

        return put(definitions, node, { formals, choices: formals ? [] : choices, promise: promiseAt(node) });
    };
    // Allocation follows source call/selection edges; it does not establish a
    // return contract. The actual returned-carrier edges retain that proof.
    const callers = new Map();
    const visited = new Set();
    const connect = (source, caller) => append(callers.get(source) || put(callers, source, []), caller);
    const candidates = insertedValues.size ? sourceCalls : [];

    candidates.forEach(({ node = {}, callee = {} } = {}) => {
        connect(callee, executionOf.get(node));
        traverse(callee, { enter: (current = {}) => {
            if (visited.has(current)) return [];

            retain(visited, current);
            const { formals = false, choices = [] } = definitionFor(current);
            const { type = '', object = {}, computed = false, property: key = {} } = current;
            const { name = '' } = propertyName({ computed, key });
            const protocols = type === 'MemberExpression' && ['call', 'apply'].includes(name) ? [object] : [];
            const sources = [...choices, ...protocols];

            if (formals) connect(owners.get(formals), current);

            sources.forEach(source => connect(source, current));

            return sources;
        } });
    });
    const propagated = new Set();

    [...insertedExecutions].forEach(execution => traverse(execution, { enter: (current) => {
        if (propagated.has(current)) return [];

        retain(propagated, current);
        retain(insertedExecutions, current);

        return callers.get(current) || [];
    } }));
    const joinTarget = (node, alternatives, field) => {
        const entries = alternatives.flatMap((alternative = {}) => {
            const { [field]: selected = false, localProofOnly = false, defined = false, available = false } = alternative;

            if (selected) return [{ kind: 'forward', target: selected, localProofOnly }];

            return !defined || (field === 'target' && available) ? [{ kind: 'escape' }] : [];
        });
        const target = entries.some(({ kind = '' } = {}) => kind === 'forward') && Object.freeze({ location: locationOf(node) });

        if (target) put(bySubject, target, entries);

        return target;
    };
    const join = (node, alternatives) => {
        const available = alternatives.some(({ available = false } = {}) => available);
        const unknown = alternatives.some(({ unknown = false } = {}) => unknown);

        return { defined: alternatives.every(({ defined = false } = {}) => defined), available, unknown,
            target: !unknown && joinTarget(node, alternatives, 'target'), valueReturnTarget: joinTarget(node, alternatives, 'valueReturnTarget'),
            packedTarget: joinTarget(node, alternatives, 'packedTarget'),
            nestedPackedTarget: joinTarget(node, alternatives, 'nestedPackedTarget'), packedReturnTarget: joinTarget(node, alternatives, 'packedReturnTarget'),
            nestedReturnTarget: joinTarget(node, alternatives, 'nestedReturnTarget'), restReturnTarget: joinTarget(node, alternatives, 'restReturnTarget'),
            restPackedReturnTarget: joinTarget(node, alternatives, 'restPackedReturnTarget'),
            returnMinimum: Math.min(...alternatives.filter(({ restReturnTarget = false } = {}) => restReturnTarget).map(({ returnMinimum = 0 } = {}) => returnMinimum)),
            returnMaximum: Math.max(...alternatives.filter(({ restReturnTarget = false } = {}) => restReturnTarget).map(({ returnMaximum = Infinity } = {}) => returnMaximum)) };
    };
    const formalAt = (formals, position, maximum = position) => {
        const selected = formals.at(position);
        const candidate = selected || formals.at(-1);
        const { elements = false, container = false, start = 0 } = candidate ?? {};

        if (elements) return { ...candidate, target: restTarget(container, elements, position - start, maximum - start),
            returnMinimum: position - start, returnMaximum: maximum - start,
            packedTarget: restContent(container, Math.min(position - start, 2), 1, position - start, maximum - start),
            nestedPackedTarget: restContent(container, Math.min(position - start, 2), 2, position - start, maximum - start) };

        if (selected) return selected;

        const last = formals.at(-1);
        const { rest = false } = last ?? {};

        return rest ? last : unused;
    };
    const groupsFor = (formals, node) => {
        if (groups.has(formals)) return groups.get(formals);

        const levels = [formals];
        const depth = Math.ceil(Math.log2(formals.length));

        Array.from({ length: depth }).reduce((level) => {
            const next = level.filter((entry, index) => index % 2 === 0).map((left, index) => {
                const right = level.at(index * 2 + 1);

                return right ? join(node, [left, right]) : left;
            });

            append(levels, next);

            return next;
        }, formals);

        return put(groups, formals, levels);
    };
    const rangeFor = (formals, node, minimum, maximum) => {
        const { rest = false } = formals.at(-1) ?? {};
        const tail = rest && maximum >= formals.length - 1;
        const last = Math.min(formals.length - 1 - Number(tail), maximum);
        const remainder = tail ? formalAt(formals, Math.max(minimum, formals.length - 1), maximum) : false;

        if (minimum > last && remainder) return remainder;

        if (minimum >= last) {
            const selected = formalAt(formals, minimum);

            return remainder ? join(node, [selected, remainder]) : selected;
        }

        const levels = groupsFor(formals, node);
        const selected = [];

        traverse({ level: levels.length - 1, offset: 0 }, { enter: ({ level = 0, offset = 0 } = {}) => {
            const entry = levels.at(level).at(offset);
            const width = 2 ** level;
            const start = offset * width;
            const end = Math.min(formals.length - 1, start + width - 1);

            if (!entry || end < minimum || start > last) return [];

            if (start >= minimum && end <= last) {
                append(selected, entry);

                return [];
            }

            return [{ level: level - 1, offset: offset * 2 }, { level: level - 1, offset: offset * 2 + 1 }];
        } });

        return join(node, remainder ? [...selected, remainder] : selected);
    };

    return (node, position, construct = false, maximum = position) => {
        if (!node || !Number.isFinite(position) || position < 0) return unresolved;

        const layouts = construct ? constructionPositions : positions;
        const slotFor = current => layouts.get(current) || put(layouts, current, new Map());
        const key = position === maximum ? position : `${position}:${maximum}`;

        traverse(node, { enter: current => slotFor(current).has(key) ? [] : definitionFor(current).choices, leave: (current) => {
            const slots = slotFor(current);

            if (slots.has(key)) return;

            const { formals = false, choices = [], promise = false } = definitionFor(current);
            const alternatives = choices.map(choice => slotFor(choice).get(key) || unresolved);
            const [single = unresolved] = alternatives;

            if (formals) {
                put(slots, key, rangeFor(formals, current, position, maximum));

                return;
            }

            if (construct && promise === true) {
                put(slots, key, position === 0 ? executorFormal : unused);

                return;
            }

            const replacement = construct && promise && parameters.get(promise);

            if (replacement) {
                put(slots, key, rangeFor(replacement, current, position, maximum));

                return;
            }

            put(slots, key, alternatives.length > 1 ? join(current, alternatives) : single);
        } });

        return slotFor(node).get(key);
    };
};
