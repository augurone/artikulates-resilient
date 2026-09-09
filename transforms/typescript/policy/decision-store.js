import { getDestructuringAgreement } from './defaults.js';
import { getObject } from '../../../rules/support/object.js';

// Different placement consumers admit different claim sets. Within each set,
// two claims for one source operation reject ownership rather than overwrite it.
const uniqueClaims = (collision, entries = []) => new Map(
    [...Map.groupBy(entries, ([key = ''] = []) => key)].map(([key = '', claims = []] = []) => {
        const [[, value = collision] = []] = claims;

        return [key, claims.length === 1 ? value : collision];
    })
);

// Compile once at the source boundary. Placement receives completed decisions
// and indexes, never the mutable input map or an interpreter callback.
const compileDestructuringDecisions = (facts = new Map()) => {
    const decisions = [...facts.entries()].flatMap(([lookupKey = '', entries = []] = []) => (
        entries.map((entry = {}) => ({
            lookupKey,
            entry,
            contract: getObject(entry).contract || {},
            agreement: getDestructuringAgreement({ entry })
        }))
    )).map((decision = {}, order = 0) => ({ ...decision, order }));
    const byKey = Map.groupBy(decisions, ({ lookupKey = '' } = {}) => lookupKey);
    const byKind = Map.groupBy(decisions, ({ entry: { kind = '' } = {} } = {}) => kind);
    const byFunction = Map.groupBy(decisions.filter(({ contract = {} } = {}) => getObject(contract).functionKey),
        ({ contract: { functionKey = '' } = {} } = {}) => functionKey);
    const byMember = Map.groupBy(decisions.flatMap((decision = {}) => {
        const { entry: { kind = '', key = '' } = {}, contract: { source = {} } = {} } = decision;
        const memberKey = kind === 'direct-capability' ? key : getObject(source).memberRange;

        return memberKey ? [{ ...decision, memberKey }] : [];
    }), ({ memberKey = '' } = {}) => memberKey);
    const byLoop = Map.groupBy(decisions.filter(({ contract = {} } = {}) => getObject(contract).loopRange),
        ({ contract: { loopRange = '' } = {} } = {}) => loopRange);
    const collections = byKind.get('collection-reconstruction') || [];
    const builders = byKind.get('operational-object-builder') || [];
    const indexed = byKind.get('indexed-operation') || [];
    const orderedReads = byKind.get('ordered-nested-tuple-read') || [];
    const completedLiveLoops = new Set([
        ...collections.flatMap(({ agreement: { action = '' } = {}, contract: { collection = {} } = {} } = {}) => {
            const { directLiveCollection = false, loopRange = '' } = collection;

            return action === 'operational-collection-builder' && directLiveCollection ? [loopRange] : [];
        }),
        ...builders.filter(({ agreement: { action = '' } = {} } = {}) => action === 'operational-object-builder')
            .map(({ contract: { loopRange = '' } = {} } = {}) => loopRange),
        ...(byKind.get('live-array-visitation') || [])
            .filter(({ agreement: { action = '' } = {} } = {}) => action === 'retain-live-array-visitation')
            .map(({ contract: { loopRange = '' } = {} } = {}) => loopRange)
    ]);
    const guardKinds = new Set(decisions.flatMap(({ agreement = {}, contract = {} } = {}) => {
        const { action = '', guard = '', guards = [] } = agreement;
        const { guard: contractGuard = '', guards: contractGuards = [] } = contract;

        return [guard, ...guards, contractGuard, ...contractGuards,
            ['guard-function', 'guard-function-undefined', 'guard-sort-capability', 'guarded-closed-provider-model']
                .includes(action) ? 'function' : ''];
    }).filter(Boolean));
    const collectionMutations = uniqueClaims(false, collections.flatMap(({ agreement: { action = '' } = {}, contract: { collection = {} } = {} } = {}) => {
        const { callbackOwned = false, mutationSites = [], type = '' } = collection;

        return !callbackOwned && ['Map', 'Set'].includes(type)
            ? mutationSites.map(({ key = '' } = {}) => [key, { action, type }]).filter(([key = ''] = []) => key)
            : [];
    }));
    const collectionUpdates = uniqueClaims(false, collections.flatMap(({ agreement: { action = '', boundaryReason = '' } = {}, contract = {} } = {}) => {
        const { collection: { callbackOwned = false, directLiveCollection = false, mutationSites = [] } = {} } = contract;

        return ['operational-collection-builder', 'retain-collection-boundary'].includes(action) && !callbackOwned
            ? mutationSites.map(({ key = '' } = {}) => [key, { action, directLiveCollection, boundaryReason }])
                .filter(([key = ''] = []) => key) : [];
    }));
    const directLiveLoops = uniqueClaims('', collections.flatMap(({ agreement: { action = '' } = {}, contract: { collection = {} } = {} } = {}) => {
        const { directLiveCollection = false, loopRange = '', type = '' } = collection;

        return action === 'operational-collection-builder' && directLiveCollection && loopRange ? [[loopRange, type]] : [];
    }));
    const collectionTuplePositions = new Set(collections.flatMap(({ contract: { collection: { mutationSites = [] } = {} } = {} } = {}) => (
        mutationSites.flatMap(({ positions = [] } = {}) => positions.map(({ key = '' } = {}) => key))
    )).filter(Boolean));
    const operationalTupleReads = new Set([
        ...orderedReads.filter(({ agreement: { action = '' } = {} } = {}) => action === 'retain-ordered-nested-tuple-read')
            .flatMap(({ contract: { readRanges = [] } = {} } = {}) => readRanges),
        ...collections.flatMap(({ agreement: { action = '' } = {}, contract: { collection = {} } = {} } = {}) => {
            const { mutationSites = [], callbackParameterOwned = false, aliasReadRange = '', selectionRanges = [] } = collection;

            return action === 'operational-collection-builder' ? [
                ...mutationSites.flatMap(({ positions = [] } = {}) => positions.map(({ key = '' } = {}) => key)),
                ...(callbackParameterOwned && aliasReadRange ? [aliasReadRange] : []),
                ...(callbackParameterOwned ? selectionRanges : [])
            ] : [];
        })
    ].filter(Boolean));
    const operationalBuilders = builders.filter(({ agreement: { action = '' } = {} } = {}) => action === 'operational-object-builder')
        .map(({ contract = {} } = {}) => contract);
    const operationalStatements = new Map(operationalBuilders
        .map(({ statementRange = '', bindingShape = 'indexed-entry' } = {}) => [statementRange, bindingShape]));
    const operationalLoops = new Set(operationalBuilders.filter(({ bindingShape = '' } = {}) => bindingShape === 'destructured-entry')
        .map(({ loopRange = '' } = {}) => loopRange));
    const indexedAssignmentStatements = new Set(indexed
        .filter(({ agreement: { action = '', operation = '' } = {} } = {}) => action === 'retain-indexed-update' && operation === 'assignment')
        .map(({ contract: { statementRange = '' } = {} } = {}) => statementRange).filter(Boolean));
    const tupleArgumentFacts = (byKind.get('short-circuit-tuple-argument') || [])
        .filter(({ agreement: { action = '' } = {} } = {}) => action === 'retain-receiver-ordered-tuple-argument')
        .map(({ contract = {} } = {}) => contract);
    const orderedReadStatements = new Set(orderedReads
        .filter(({ agreement: { action = '' } = {} } = {}) => action === 'retain-ordered-nested-tuple-read')
        .map(({ contract: { statementRange = '' } = {} } = {}) => statementRange).filter(Boolean));
    const operationalUpdateKeys = new Set(collections.flatMap(({ agreement: { action = '' } = {}, contract: { collection = {} } = {} } = {}) => {
        const { callbackOwned = false, mutationSites = [] } = collection;

        return action === 'operational-collection-builder'
            ? mutationSites.filter(({ positions = [] } = {}) => callbackOwned || positions.length === 2)
                .map(({ key = '' } = {}) => key) : [];
    }).filter(Boolean));
    const iteratorResultBindings = collections
        .filter(({ agreement: { action = '' } = {} } = {}) => action === 'operational-collection-builder')
        .flatMap(({ contract: { collection: { iteratorResultBindings: bindings = [] } = {} } = {} } = {}) => bindings);
    const capturedRestParameters = new Set((byKind.get('rest-array-fixed-selection') || [])
        .filter(({ agreement: { action = '' } = {}, contract: { captured = false } = {} } = {}) => (
            captured && ['rest-array-staged-selection', 'rest-array-retained-index', 'rest-array-retained-effect-order'].includes(action)
        )).map(({ contract: { parameterRange = '' } = {} } = {}) => parameterRange));
    const aritySignatureGroups = Map.groupBy((byKind.get('arity-signature-lowering') || [])
        .filter(({ contract: { sourceName = '' } = {} } = {}) => sourceName),
    ({ contract: { sourceName = '' } = {} } = {}) => sourceName);
    const aritySignatures = new Map([...aritySignatureGroups]
        .filter(([, decisions = []] = []) => decisions.length === 1)
        .map(([sourceName = '', [decision = {}] = []] = []) => [sourceName, decision]));
    const partitions = new Map((byKind.get('arity-return-partition') || [])
        .filter(({ contract: { sourceName = '' } = {} } = {}) => sourceName)
        .map(({ agreement = {}, contract: { sourceName = '' } = {} } = {}) => [sourceName, agreement]));
    const switchReturns = new Map((byKind.get('switch-no-value-exit') || [])
        .filter(({ contract: { sourceName = '' } = {} } = {}) => sourceName)
        .map(({ agreement = {}, contract: { sourceName = '', exitKind = '' } = {} } = {}) => [sourceName, { agreement, exitKind }]));

    return {
        size: decisions.length, byKey, byKind, byFunction, byMember, byLoop, completedLiveLoops, guardKinds,
        collectionMutations, collectionUpdates, directLiveLoops, collectionTuplePositions, operationalTupleReads,
        operationalStatements, operationalLoops, indexedAssignmentStatements, tupleArgumentFacts, orderedReadStatements,
        operationalUpdateKeys, aritySignatures, partitions, switchReturns, iteratorResultBindings, capturedRestParameters,
        hasCollectionAnnotationAgreement: collections.some(({ agreement: { action = '' } = {} } = {}) => (
            ['operational-collection-builder', 'retain-collection-boundary'].includes(action)
        )),
        hasCallbackOwnedAgreement: collections.some(({ agreement: { action = '' } = {}, contract: { collection = {} } = {} } = {}) => (
            action === 'operational-collection-builder' && getObject(collection).callbackOwned
        )),
        hasCallableOperations: byKind.has('callable-operation') || byKind.has('callable-operation-placement')
    };
};

export { compileDestructuringDecisions };
