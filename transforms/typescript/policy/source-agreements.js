import { getObject } from '../../../rules/support/object.js';

const getNativeFunctionActionForArity = (contract = false) => {
    if (!contract) return 'already-expression';

    const { lifetimeEquivalent = false, arrowEquivalent = false } = getObject(contract);

    if (!lifetimeEquivalent) return 'retain-native-function-declaration';

    return arrowEquivalent ? 'lower-equivalent-arrow' : 'lower-native-function-expression';
};

const collectDestructuringAgreements = ({
    typescript = {},
    consumerContracts = new Map(),
    directCapabilityContracts = new Map(),
    callableOperationContracts = new Map(),
    sortCapabilityContracts = new Map(),
    providerForwards = new Map(),
    providerEdges = new Map(),
    closedProviderModels = new Map(),
    closedStructuralModels = new Map(),
    exactProjections = new Map(),
    exactProviderForwards = new Map(),
    factoryBindingContracts = new Map(),
    selectedModelContracts = new Map(),
    collectionReconstructionContracts = new Map(),
    consoleEffectContracts = new Map(),
    aritySignatureContracts = new Map(),
    arityReturnContracts = new Map(),
    switchReturnContracts = new Map(),
    nullishEqualityContracts = new Map(),
    operationalObjectBuilderContracts = new Map(),
    arrayCardinalityContracts = new Map(),
    requiredTupleBindingContracts = new Map(),
    restArraySelectionContracts = new Map(),
    liveIteratorPayloadContracts = new Map(),
    deferredSelectedPayloadContracts = new Map(),
    deferredOpaqueFieldContracts = new Map(),
    curriedSelectedTupleContracts = new Map(),
    receiverOrderedProjectionContracts = new Map(),
    shortCircuitTupleArgumentContracts = new Map(),
    orderedNestedTupleReadContracts = new Map(),
    indexedOperationContracts = new Map(),
    mutableSelectedLoopContracts = new Map(),
    indexedLocalSelectionContracts = new Map(),
    unusedBindingContracts = new Map(),
    typedIgnoredArgumentCallContracts = new Map(),
    resolvedSourceCallContracts = new Map(),
    declaredNullishResultContracts = new Map(),
    detachedPromiseForwardContracts = new Map(),
    callableProviderDispatchContracts = new Map(),
    samePhaseSelectedBindingContracts = new Map(),
    deferredSignatureSelectionContracts = new Map(),
    nativeClassBoundaryContracts = new Map(),
    orderedDecisionContracts = new Map(),
    repeatedParameterReadContracts = new Map(),
    declarationLifetimeContracts = new Map(),
    nativeFunctionContracts = new Map(),
    hoistedFunctionContracts = new Map(),
    liveOwnKeyEnumerationContracts = new Map(),
    liveArrayVisitationContracts = new Map(),
    loopCarriedRecurrenceContracts = new Map(),
    numericRangeBuilderContracts = new Map()
} = {}) => {
    const getSourceRange = (node = {}) => {
        const { getOriginalNode = false } = typescript;
        const original = typeof getOriginalNode === 'function' ? getOriginalNode(node) : node;
        const { pos = -1, end = -1 } = getObject(original);

        return Number.isInteger(pos) && Number.isInteger(end) && pos >= 0 && end >= pos
            ? `${pos}:${end}`
            : '';
    };
    const getMetadata = ({ kind = '', contract = {}, mapKey = '' } = {}) => {
        const {
            sourceRange = '', key = '', source = {}, callbackKey = '', callKey = '',
            evidence = [], theorem = '', action = '', operationRole = ''
        } = getObject(contract);
        const { range = '', memberRange = '' } = getObject(source);
        const owner = {
            consumer: 'consumer',
            'consumer-callback': 'consumer',
            'direct-capability': 'capability',
            'callable-operation': 'source-call',
            'callable-operation-placement': 'source-call',
            'sort-capability': 'capability',
            'provider-forward': 'provider',
            'provider-edge': 'provider',
            'closed-provider-model': 'model',
            'closed-structural-model': 'model',
            'exact-callback-projection': 'projection',
            'exact-provider-forward': 'provider',
            'factory-required-binding': 'typeclass-factory',
            'selected-model-read': 'model',
            'collection-reconstruction': 'collection',
            'arity-signature-lowering': 'rest-caller',
            'arity-return-partition': 'producer',
            'arity-return-selector': 'producer',
            'switch-no-value-exit': 'producer',
            'switch-terminal-bare-return': 'producer',
            'nullish-abstract-equality': 'comparison',
            'operational-object-builder': 'collection',
            'live-own-key-enumeration': 'collection',
            'numeric-range-builder': 'collection',
            'array-cardinality': 'collection',
            'required-tuple-binding': 'tuple-caller',
            'rest-array-fixed-selection': 'rest-caller',
            'iterator-payload-local-binding': 'iterator-result',
            'deferred-selected-payload-binding': 'selected-model',
            'deferred-opaque-field-binding': 'opaque-field',
            'curried-selected-tuple-binding': 'selected-model',
            'receiver-ordered-projection': 'projection',
            'short-circuit-tuple-argument': 'selected-tuple',
            'ordered-nested-tuple-read': 'selected-tuple',
            'indexed-operation': 'indexed-source',
            'mutable-selected-loop-binding': 'selected-model',
            'indexed-local-staged-selection': 'indexed-local',
            'unused-binding': 'binding',
            'typed-ignored-argument-call': 'call',
            'resolved-source-call': 'call',
            'declared-nullish-result': 'producer',
            'callable-provider-dispatch': 'provider',
            'same-phase-selected-binding': 'selected-binding',
            'deferred-signature-selection': 'selected-binding',
            'native-class-boundary': 'class-protocol',
            'ordered-decision': 'control-flow',
            'repeated-parameter-read': 'selected-read',
            'declaration-lifetime': 'declaration',
            'declaration-lifetime-reference': 'declaration',
            'native-function-capability': 'declaration',
            'native-function-reference': 'declaration',
            'hoisted-function-cycle': 'declaration',
            'hoisted-function-reference': 'declaration'
        }[kind] || 'boundary';
        const collectionGrammar = {
            'operational-work-queue': 'retain-live-work-queue',
            'set-visitation': 'retain-live-set-visitation',
            'observable-set-union': 'retain-observable-set-union'
        }[action === 'operational-work-queue' ? action : operationRole] || 'collection-reconstruction';
        const grammar = {
            consumer: 'guarded-consumer',
            'consumer-callback': 'guarded-consumer',
            'direct-capability': 'guarded-callable-consumer',
            'callable-operation': 'retain-callable-operation',
            'callable-operation-placement': 'retain-callable-operation',
            'sort-capability': 'guarded-callable-consumer',
            'provider-forward': 'identity-provider-forward',
            'provider-edge': 'retain-named-boundary',
            'closed-provider-model': 'closed-structural-model',
            'closed-structural-model': 'closed-structural-model',
            'exact-callback-projection': 'exact-projection',
            'exact-provider-forward': 'identity-provider-forward',
            'factory-required-binding': 'native-required-factory-binding',
            'selected-model-read': 'selected-model-binding',
            'collection-reconstruction': collectionGrammar,
            'arity-signature-lowering': 'source-arity-rest-carrier',
            'arity-return-partition': 'retain-arity-partition',
            'arity-return-selector': 'retain-exact-undefined-selector',
            'switch-no-value-exit': 'retain-switch-no-value-exit',
            'switch-terminal-bare-return': 'normalize-terminal-bare-return',
            'nullish-abstract-equality': 'retain-nullish-abstract-equality',
            'operational-object-builder': 'retain-operational-builder',
            'live-own-key-enumeration': 'retain-live-own-key-enumeration',
            'numeric-range-builder': 'retain-numeric-range-builder',
            'array-cardinality': 'retain-cardinality-read',
            'required-tuple-binding': 'native-required-tuple',
            'rest-array-fixed-selection': action === 'rest-array-staged-selection'
                ? 'source-order-staged-selection'
                : 'source-time-fixed-selection',
            'iterator-payload-local-binding': 'body-local-payload-selection',
            'deferred-selected-payload-binding': 'callback-local-payload-selection',
            'deferred-opaque-field-binding': 'callback-local-field-selection',
            'curried-selected-tuple-binding': 'source-order-staged-selection',
            'receiver-ordered-projection': 'retain-source-time-projection',
            'short-circuit-tuple-argument': 'retain-source-time-tuple-argument',
            'ordered-nested-tuple-read': 'retain-source-time-tuple-reads',
            'indexed-operation': 'retain-source-indexed-operation',
            'mutable-selected-loop-binding': 'loop-local-model-selection',
            'indexed-local-staged-selection': 'loop-local-staged-selection',
            'unused-binding': 'source-position-discard',
            'typed-ignored-argument-call': 'source-call-typed-ignored-argument',
            'resolved-source-call': 'retain-source-call',
            'declared-nullish-result': 'retain-declared-result',
            'callable-provider-dispatch': 'retain-provider-dispatch',
            'same-phase-selected-binding': 'source-phase-static-binding',
            'deferred-signature-selection': 'retain-source-phase-selection',
            'native-class-boundary': 'retain-native-class-protocol',
            'ordered-decision': 'terminal-guard-sequence',
            'repeated-parameter-read': 'retain-source-phase-read',
            'declaration-lifetime': 'source-declaration-lifetime',
            'declaration-lifetime-reference': 'source-forward-reference',
            'native-function-capability': 'native-function-kind',
            'native-function-reference': 'native-forward-reference',
            'hoisted-function-cycle': 'native-function-declaration',
            'hoisted-function-reference': 'native-forward-reference'
        }[kind] || 'retain-named-boundary';

        return {
            sourceRange: sourceRange || range || memberRange || key || mapKey || getSourceRange(contract),
            relatedRanges: [mapKey, key, callbackKey, callKey, sourceRange, range, memberRange]
                .filter(Boolean),
            owner,
            grammar,
            theorem: theorem || action || 'named-boundary',
            evidence: Array.isArray(evidence) ? evidence.filter(Boolean) : []
        };
    };
    const withMetadata = ([key = '', entry = {}] = []) => {
        const { kind = '', contract = {} } = getObject(entry);

        return [key, {
            ...entry,
            ...getMetadata({ kind, contract, mapKey: key })
        }];
    };
    const entries = [
        ...Array.from(consumerContracts.entries()).flatMap(([key = '', contract = {}] = []) => {
            const { callbackKey = '' } = getObject(contract);

            return [[key, {
                key,
                kind: 'consumer',
                contract
            }], [callbackKey, {
                key: callbackKey,
                kind: 'consumer-callback',
                contract
            }]].filter(entry => Array.isArray(entry) && entry.some(value => typeof value === 'string' && Boolean(value)));
        }),
        ...Array.from(directCapabilityContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'direct-capability',
            contract
        }]),
        ...Array.from(callableOperationContracts.entries()).map(([key = '', contract = {}] = []) => {
            const { sourceRange = '', protectArguments = false, protectedBindings = [] } = getObject(contract);

            return [key, {
                key,
                kind: key === sourceRange || protectArguments || protectedBindings.includes(key)
                    ? 'callable-operation' : 'callable-operation-placement',
                contract
            }];
        }),
        ...Array.from(sortCapabilityContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'sort-capability',
            contract
        }]),
        ...Array.from(providerForwards.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'provider-forward',
            contract
        }]),
        ...Array.from(providerEdges.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'provider-edge',
            contract
        }]),
        ...Array.from(closedProviderModels.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'closed-provider-model',
            contract
        }]),
        ...Array.from(closedStructuralModels.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'closed-structural-model',
            contract
        }]),
        ...Array.from(exactProjections.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'exact-callback-projection',
            contract
        }]),
        ...Array.from(factoryBindingContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key, kind: 'factory-required-binding', contract
        }]),
        ...Array.from(exactProviderForwards.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'exact-provider-forward',
            contract
        }]),
        ...Array.from(selectedModelContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'selected-model-read',
            contract
        }]),
        ...Array.from(collectionReconstructionContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'collection-reconstruction',
            contract
        }]),
        ...Array.from(consoleEffectContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'console-effect',
            contract
        }]),
        ...Array.from(aritySignatureContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'arity-signature-lowering',
            contract: {
                ...contract,
                functionKindAction: getNativeFunctionActionForArity(nativeFunctionContracts.get(key))
            }
        }]),
        ...Array.from(arityReturnContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'arity-return-partition',
            contract
        }]),
        ...Array.from(arityReturnContracts.values()).map((contract = {}) => [getObject(contract).selectorTestRange || '', {
            key: getObject(contract).selectorTestRange || '',
            kind: 'arity-return-selector',
            contract: { ...contract, action: 'retain-exact-undefined-selector' }
        }]),
        ...Array.from(switchReturnContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'switch-no-value-exit',
            contract
        }]),
        ...Array.from(switchReturnContracts.values())
            .filter((contract = {}) => !!getObject(contract).exitRange)
            .map((contract = {}) => [getObject(contract).exitRange, {
                key: getObject(contract).exitRange,
                kind: 'switch-terminal-bare-return',
                contract: { ...contract, action: 'normalize-terminal-bare-return' }
            }]),
        ...Array.from(nullishEqualityContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'nullish-abstract-equality',
            contract
        }]),
        ...Array.from(operationalObjectBuilderContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'operational-object-builder',
            contract
        }]),
        ...Array.from(arrayCardinalityContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'array-cardinality',
            contract
        }]),
        ...Array.from(requiredTupleBindingContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'required-tuple-binding',
            contract
        }]),
        ...Array.from(restArraySelectionContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'rest-array-fixed-selection',
            contract
        }]),
        ...Array.from(liveIteratorPayloadContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'iterator-payload-local-binding',
            contract
        }]),
        ...Array.from(deferredSelectedPayloadContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'deferred-selected-payload-binding',
            contract
        }]),
        ...Array.from(deferredOpaqueFieldContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'deferred-opaque-field-binding',
            contract
        }]),
        ...Array.from(curriedSelectedTupleContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'curried-selected-tuple-binding',
            contract
        }]),
        ...Array.from(receiverOrderedProjectionContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'receiver-ordered-projection',
            contract
        }]),
        ...Array.from(shortCircuitTupleArgumentContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'short-circuit-tuple-argument',
            contract
        }]),
        ...Array.from(orderedNestedTupleReadContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'ordered-nested-tuple-read',
            contract
        }]),
        ...Array.from(indexedOperationContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'indexed-operation',
            contract
        }]),
        ...Array.from(mutableSelectedLoopContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'mutable-selected-loop-binding',
            contract
        }]),
        ...Array.from(indexedLocalSelectionContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'indexed-local-staged-selection',
            contract
        }]),
        ...Array.from(unusedBindingContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'unused-binding',
            contract
        }]),
        ...Array.from(typedIgnoredArgumentCallContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'typed-ignored-argument-call',
            contract
        }]),
        ...Array.from(resolvedSourceCallContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'resolved-source-call',
            contract
        }]),
        ...Array.from(declaredNullishResultContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'declared-nullish-result',
            contract
        }]),
        ...Array.from(detachedPromiseForwardContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'detached-promise-forward',
            contract
        }]),
        ...Array.from(callableProviderDispatchContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'callable-provider-dispatch',
            contract
        }]),
        ...Array.from(samePhaseSelectedBindingContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'same-phase-selected-binding',
            contract
        }]),
        ...Array.from(deferredSignatureSelectionContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'deferred-signature-selection',
            contract
        }]),
        ...Array.from(nativeClassBoundaryContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'native-class-boundary',
            contract
        }]),
        ...Array.from(orderedDecisionContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'ordered-decision',
            contract
        }]),
        ...Array.from(repeatedParameterReadContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'repeated-parameter-read',
            contract
        }]),
        ...Array.from(declarationLifetimeContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: getObject(contract).operationRole || 'declaration-lifetime',
            contract
        }]),
        ...Array.from(nativeFunctionContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: getObject(contract).operationRole || 'native-function-capability',
            contract
        }]),
        ...Array.from(hoistedFunctionContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: getObject(contract).operationRole || 'hoisted-function-cycle',
            contract
        }]),
        ...Array.from(liveOwnKeyEnumerationContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'live-own-key-enumeration',
            contract
        }]),
        ...Array.from(liveArrayVisitationContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'live-array-visitation',
            contract
        }]),
        ...Array.from(loopCarriedRecurrenceContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'loop-carried-recurrence',
            contract
        }]),
        ...Array.from(numericRangeBuilderContracts.entries()).map(([key = '', contract = {}] = []) => [key, {
            key,
            kind: 'numeric-range-builder',
            contract
        }])
    ].filter(([key = ''] = []) => key).map(withMetadata);

    // A checker range can legitimately be shared by a callback and its
    // pattern. Preserve both facts instead of letting traversal order choose
    // one. Consumers select the entry kind they understand.
    return Map.groupBy(entries.map(([, entry = {}] = []) => entry), ({ key = '' } = {}) => key);
};

export { collectDestructuringAgreements };
