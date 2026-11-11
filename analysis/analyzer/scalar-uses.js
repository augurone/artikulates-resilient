import { append, put } from '../collections.js';
import { locationOf } from './locations.js';

export const unresolvedArgument = ({ minimum = Infinity, maximum = Infinity, collectionFallback = false, replacement = false, unresolved = false } = {},
    { target = false, defined = false, available = false, unknown = false } = {}) => {
    const ambiguous = minimum !== maximum;

    return unresolved || (Number.isFinite(minimum) && (unknown || ((ambiguous || collectionFallback) && available && !target) ||
        (!defined && (ambiguous || replacement || collectionFallback))));
};

// Scalar and presence roles share the same lexical reference pass.
export const acquireScalarUses = ({
    references = [], identities = new WeakMap(), parents = new WeakMap(), operators = new WeakMap(), bindings = [], indexedInvocations = new Set(),
    presenceBySubject = new Map(), carriers = [], returnedCarriers = [], carrierUses = new WeakSet(),
    subjectFor, testFor, retainUse, testedOrDiscarded, presentAt, resultUseFor, invokesValue, effectiveArgument, forwardingFor, resultFor, carrierFor,
    packedSubjectFor, elementFor, elementTarget, localResult, consumesAbsence, invokesReceiver, returnedElements, index = {},
    objectSpread, returnsValue, usesFor, positionsSafe
} = {}) => {
    const { contextFor } = index;

    if (typeof subjectFor !== 'function' || typeof testFor !== 'function' || typeof retainUse !== 'function') throw new TypeError('Expected acquired scalar use dependencies');

    if (typeof testedOrDiscarded !== 'function' || typeof presentAt !== 'function' || typeof resultUseFor !== 'function') throw new TypeError('Expected acquired scalar use dependencies');

    if (typeof invokesValue !== 'function' || typeof effectiveArgument !== 'function' || typeof forwardingFor !== 'function') throw new TypeError('Expected acquired scalar use dependencies');

    if (typeof resultFor !== 'function' || typeof carrierFor !== 'function' || typeof packedSubjectFor !== 'function') throw new TypeError('Expected acquired scalar use dependencies');

    if (typeof elementFor !== 'function' || typeof elementTarget !== 'function' || typeof localResult !== 'function') throw new TypeError('Expected acquired scalar use dependencies');

    if (typeof consumesAbsence !== 'function' || typeof invokesReceiver !== 'function' || typeof returnedElements !== 'function') throw new TypeError('Expected acquired scalar use dependencies');

    if (typeof contextFor !== 'function' || typeof objectSpread !== 'function' || typeof returnsValue !== 'function') throw new TypeError('Expected acquired scalar use dependencies');

    if (typeof usesFor !== 'function' || typeof positionsSafe !== 'function') throw new TypeError('Expected acquired scalar use dependencies');

    const retainPresence = (capability, node, kind) => {
        const presence = presenceBySubject.get(capability) || put(presenceBySubject, capability, []);

        append(presence, Object.freeze({ kind, location: locationOf(node) }));
    };
    const retainExport = (capability, node, execution) => {
        retainPresence(capability, node, 'escape');
        retainUse(capability, false, { kind: 'escape', execution, location: locationOf(node) });
    };
    const localExport = (node, parent, { pattern = {}, declaration: { node: declared = {} } = {} } = {}) => {
        const { type = '', local = false } = parent;

        if (type === 'ExportSpecifier') {
            const { source = false } = parents.get(parent) ?? {};

            return local === node && !source;
        }

        if (node !== declared) return false;

        const declaration = parents.get(parents.get(pattern)) ?? {};
        const { type: enclosing = '', declaration: exported = false } = parents.get(declaration) ?? {};

        return enclosing === 'ExportNamedDeclaration' && exported === declaration;
    };
    references.forEach(({ node = {}, parent = {}, execution = false } = {}) => {
        const capability = subjectFor(node);

        if (!capability) return;

        const binding = identities.get(node);
        const { declaration: { node: declared = {} } = {} } = binding ?? {};
        const { index: origin = -1 } = capability;
        const { parameterPattern = false, pattern: { type: shape = '' } = {} } = bindings.at(origin) ?? {};
        const { type = '', argument = false, init = false, id = false, test = false, left = false } = parent;

        if (localExport(node, parent, binding)) retainExport(capability, node, execution);

        if (node === declared || ['ImportSpecifier', 'ImportDefaultSpecifier', 'ExportSpecifier'].includes(type)) return;

        const operator = type === 'UnaryExpression' && argument === node ? operators.get(parent) : '';

        const predicate = operator === 'typeof' ? parents.get(parent) : parent;
        const guard = testFor(predicate);
        const { capability: guarded = false, unsupported: unresolved = false } = guard;
        const alias = type === 'VariableDeclarator' && init === node && subjectFor(id) === capability;
        const tested = ['typeof', '!', 'void'].includes(operator) ||
            ((type === 'IfStatement' || type === 'ConditionalExpression') && test === node) || testedOrDiscarded(node);
        const { mutable = false, optionalCallback = false } = capability;
        const restArray = !mutable && parameterPattern && shape === 'RestElement';
        const present = !mutable && presentAt(node, capability);
        const { consumer = {}, value = node, truthy = false, falsy = false, nullish = false } = resultUseFor(node) ?? {};
        const transfers = truthy || (!present && (falsy || nullish));
        const { type: consumerType = '', object = false } = consumer;
        const invoking = transfers && invokesValue(consumer, value);
        const placement = transfers ? effectiveArgument(value) : {};
        const { call = false, minimum = Infinity, maximum = Infinity, spread = false, collection = false, collectionFallback = false, unresolvedMember = false,
            unresolved: protocolUnknown = false } = placement;
        const forwarding = call && !collection && !protocolUnknown
            ? forwardingFor(placement, resultFor(call)) : {};
        const { target: formal = false, defined = false, available = false, localProofOnly = false, valueReturnTarget = false } = forwarding;

        if (valueReturnTarget && call) retainUse(capability, node, { kind: 'forward', execution, target: valueReturnTarget,
            selectResult: true, resultRole: 'consumer', resultTarget: carrierFor(call, 1, true), nestedResultTarget: carrierFor(call, 2, true) }, packedSubjectFor(capability, 0, -3));

        const ambiguous = minimum !== maximum;
        const carrier = transfers && carriers.at(0).get(consumer);
        const { type: carrierType = '' } = consumer;
        const returnedCarrier = carrierType === 'ArrayExpression' && returnedCarriers.at(0).get(consumer);

        if (returnedCarrier && transfers) retainUse(capability, node, { kind: 'forward', execution, target: returnedCarrier,
            offset: elementFor(value) }, packedSubjectFor(capability, 0, -3));

        const packed = carrierType === 'ArrayExpression' && carrier && elementTarget(value, carrier);
        const target = formal || packed || (transfers && localResult(consumer, value));
        const uncertain = unresolvedArgument(placement, forwarding);
        const { type: callType = '' } = call ? call : {};
        const argumentNode = call && value === node && !spread && callType !== 'TaggedTemplateExpression' ? call : node;

        const kind = [(uncertain || unresolvedMember) && 'escape', !mutable && (tested || (guarded === capability && !unresolved)) && 'presence-test',
            !mutable && consumesAbsence(node) && 'absence-consumer', !mutable && alias && 'alias',
            !invoking && present && 'guarded-value', 'escape'].find(Boolean);

        retainPresence(capability, node, kind);

        if (guarded === capability && !unresolved) {
            retainUse(capability, false, { kind: 'guard', execution, guard, location: locationOf(predicate) });

            return;
        }

        if (['typeof', '!', 'void'].includes(operator)) return;

        if ((type === 'IfStatement' || type === 'ConditionalExpression') && test === node) return;

        if (!invoking && !collection && !uncertain && !target && type === 'LogicalExpression' && left === node && testedOrDiscarded(parent)) return;

        if (type === 'VariableDeclarator' && init === node && subjectFor(id) === capability) return;

        if (invoking) {
            const direct = value === node;

            retainUse(capability, direct ? consumer : node, { kind: 'invocation', execution,
                optionalDirect: direct && optionalCallback && indexedInvocations.has(consumer) && consumerType === 'CallExpression' });

            return;
        }

        if (collection) {
            retainUse(capability, argumentNode, { kind: 'collection', execution });

            return;
        }

        if (transfers && invokesReceiver(consumer, value)) {
            retainUse(capability, value === node ? parents.get(consumer) : node, { kind: 'invocation', execution });

            return;
        }

        if (uncertain) {
            retainUse(capability, argumentNode, { kind: 'argument', execution });

            return;
        }

        if (target || (call && value === node)) {
            retainUse(capability, argumentNode, { kind: 'forward', execution, target,
                localProofOnly, absenceSafe: kind !== 'escape' || restArray,
                unresolvedRequiresCallable: ambiguous || Boolean(packed) || collectionFallback || unresolvedMember,
                unresolvedValue: !target && (!defined || available) && !carrierUses.has(node), ...(call ? returnedElements(forwarding, resultFor(call)) : {}) });

            return;
        }

        const member = consumerType === 'MemberExpression' && object === value;
        const { receiver: invoked = false, mutation = false } = member ? contextFor(consumer) : {};

        const { operator: operation = '' } = consumer;
        const scalar = (consumerType === 'BinaryExpression' && operation !== 'instanceof') ||
            (consumerType === 'UnaryExpression' && ['+', '-', '~'].includes(operation));
        const data = (member && (!invoked || restArray) && !mutation) || objectSpread(consumer) || carrierUses.has(node) ||
            !transfers || tested || scalar;

        const returned = !data && returnsValue(node);

        const role = [data && 'data', returned && 'result', 'escape'].find(Boolean);

        if (parameterPattern && returned && ['ReturnStatement', 'ArrowFunctionExpression'].includes(consumerType)) {
            [1, 2].forEach(depth => append(usesFor(packedSubjectFor(capability, 0, -depth)), { kind: 'result', uncertainPositions: !positionsSafe(node) }));
        }

        retainUse(capability, node, { kind: role, execution, absenceSafe: kind !== 'escape' || restArray || (carrierUses.has(node) && shape === 'RestElement') });
    });
};
