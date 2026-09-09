const routes = [
    ['consumerContracts', 'consumer'], ['directCapabilityContracts', 'direct-capability'],
    ['callableOperationContracts', 'callable-operation-placement'], ['sortCapabilityContracts', 'sort-capability'],
    ['providerForwards', 'provider-forward'], ['providerEdges', 'provider-edge'],
    ['closedProviderModels', 'closed-provider-model'], ['closedStructuralModels', 'closed-structural-model'],
    ['exactProjections', 'exact-callback-projection'], ['exactProviderForwards', 'exact-provider-forward'],
    ['factoryBindingContracts', 'factory-required-binding'], ['selectedModelContracts', 'selected-model-read'],
    ['collectionReconstructionContracts', 'collection-reconstruction'], ['consoleEffectContracts', 'console-effect'],
    ['aritySignatureContracts', 'arity-signature-lowering'],
    ['arityReturnContracts', 'arity-return-partition'], ['switchReturnContracts', 'switch-no-value-exit'],
    ['nullishEqualityContracts', 'nullish-abstract-equality'], ['operationalObjectBuilderContracts', 'operational-object-builder'],
    ['arrayCardinalityContracts', 'array-cardinality'], ['requiredTupleBindingContracts', 'required-tuple-binding'],
    ['restArraySelectionContracts', 'rest-array-fixed-selection'], ['liveIteratorPayloadContracts', 'iterator-payload-local-binding'],
    ['deferredSelectedPayloadContracts', 'deferred-selected-payload-binding'], ['deferredOpaqueFieldContracts', 'deferred-opaque-field-binding'],
    ['curriedSelectedTupleContracts', 'curried-selected-tuple-binding'], ['receiverOrderedProjectionContracts', 'receiver-ordered-projection'],
    ['shortCircuitTupleArgumentContracts', 'short-circuit-tuple-argument'], ['orderedNestedTupleReadContracts', 'ordered-nested-tuple-read'],
    ['indexedOperationContracts', 'indexed-operation'], ['mutableSelectedLoopContracts', 'mutable-selected-loop-binding'],
    ['indexedLocalSelectionContracts', 'indexed-local-staged-selection'], ['unusedBindingContracts', 'unused-binding'],
    ['typedIgnoredArgumentCallContracts', 'typed-ignored-argument-call'], ['resolvedSourceCallContracts', 'resolved-source-call'],
    ['declaredNullishResultContracts', 'declared-nullish-result'], ['detachedPromiseForwardContracts', 'detached-promise-forward'],
    ['callableProviderDispatchContracts', 'callable-provider-dispatch'], ['samePhaseSelectedBindingContracts', 'same-phase-selected-binding'],
    ['deferredSignatureSelectionContracts', 'deferred-signature-selection'], ['nativeClassBoundaryContracts', 'native-class-boundary'],
    ['orderedDecisionContracts', 'ordered-decision'], ['repeatedParameterReadContracts', 'repeated-parameter-read'],
    ['declarationLifetimeContracts', 'declaration-lifetime'],
    ['nativeFunctionContracts', 'native-function-capability'],
    ['hoistedFunctionContracts', 'hoisted-function-cycle'], ['liveOwnKeyEnumerationContracts', 'live-own-key-enumeration'],
    ['liveArrayVisitationContracts', 'live-array-visitation'], ['loopCarriedRecurrenceContracts', 'loop-carried-recurrence'],
    ['numericRangeBuilderContracts', 'numeric-range-builder']
];
const groups = Object.fromEntries(routes.map(([slot = '', kind = ''] = []) => [slot, new Map([[kind, {
    key: kind, callbackKey: 'callback', selectorTestRange: 'selector', exitRange: 'exit', evidence: [kind]
}]])]));
const {
    callableOperationContracts = new Map(),
    declarationLifetimeContracts = new Map(),
    hoistedFunctionContracts = new Map(),
    nativeFunctionContracts = new Map()
} = groups;
const completeGroups = {
    ...groups,
    callableOperationContracts: new Map([...callableOperationContracts, ['call', { sourceRange: 'call' }]]),
    declarationLifetimeContracts: new Map([...declarationLifetimeContracts, ['lifetime-reference', {
        operationRole: 'declaration-lifetime-reference'
    }]]),
    hoistedFunctionContracts: new Map([...hoistedFunctionContracts, ['reference', { operationRole: 'hoisted-function-reference' }]]),
    nativeFunctionContracts: new Map([...nativeFunctionContracts, ['native-reference', {
        operationRole: 'native-function-reference'
    }]])
};

export { routes, completeGroups };
