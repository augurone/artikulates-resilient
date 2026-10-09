import { createDeferredSelectedPayloadBinding } from './grammar/deferred-selected-payload.js';
import { placeEmissionBoundaries, placeInlineEmissionBoundaries } from './grammar/emission-layout.js';
import {
    annotateFinalExceptions,
    lowerFinalGrammar
} from './grammar/final.js';
import { updateTypeOnlyImport } from './grammar/imports.js';
import { renderResolverPredicate } from './grammar/resolver-predicates.js';
import {
    formatResilientOutput,
    getObjectResolverDeclaration,
    getObjectResolverGuardKinds,
    getStandardImportDeclaration,
    getUnionResolverDeclaration
} from './grammar/resolvers.js';
import { lowerSamePhaseSelectedBindings } from './grammar/same-phase-selected-binding.js';
import {
    createTupleCarrier,
    createTupleCarrierExpression,
    createTupleCarrierPattern
} from './grammar/tuple-carrier.js';
import { lowerUnusedBindings } from './grammar/unused-bindings.js';
import { annotateCompletedReturnBoundaries } from './lowering/arity-returns.js';
import { lowerAritySignatures } from './lowering/arity.js';
import { placeCallableProviderDispatch } from './lowering/callable-provider-dispatch.js';
import { lowerCollectionAgreementPlacements } from './lowering/collection-reconstruction.js';
import { annotateConsoleEffects } from './lowering/console-effects.js';
import { lowerScopeEntryVarDeclarations } from './lowering/declarations.js';
import { annotateDeclaredNullishResults } from './lowering/declared-nullish-results.js';
import { lowerDetachedPromiseWork } from './lowering/detached-promise-work.js';
import { annotateNativeFunctionDeclarationBoundaries, lowerFunctionDeclaration } from './lowering/functions.js';
import { lowerGuardedBindingExtraction } from './lowering/guarded-bindings.js';
import { lowerGuardedConditionalReturns } from './lowering/guarded-returns.js';
import { lowerIndexedTreeReducer } from './lowering/indexed-tree.js';
import { annotateRetainedMutationBoundaries } from './lowering/mutation-boundaries.js';
import { annotateNativeClassBoundaries } from './lowering/native-class-boundary.js';
import { annotateRetainedNullishEquality } from './lowering/nullish-equality.js';
import {
    annotateOrderedDecisionBoundaries,
    lowerOrderedDecisions
} from './lowering/ordered-decisions.js';
import { annotateResolvedSourceCalls } from './lowering/resolved-source-calls.js';
import {
    lowerDirectCapabilityConsumers,
    lowerSortCapabilityConsumer
} from './members/capability-consumers.js';
import { lowerCurriedSelectedTuple } from './members/curried-selected-tuple.js';
import { lowerExactCallbackProjections } from './members/exact-projections.js';
import { lowerExactProviderForwarding } from './members/exact-provider-forwarding.js';
import { lowerGenericMemberAccess } from './members/generic.js';
import {
    lowerDiscriminatedSwitchAccess,
    lowerDynamicArrayDestructuring,
    lowerLocalMemberAccess,
    lowerParameterMemberAccess,
    lowerTupleDestructuring,
    updateBindingPattern
// eslint-disable-next-line import/no-useless-path-segments -- Node ESM requires the member grammar entry file; a directory import is unsupported.
} from './members/index.js';
import { lowerIndexedLocalSelection } from './members/indexed-local-selection.js';
import { lowerLiveIteratorPayloadSelection } from './members/iterator-payload.js';
import { lowerMutableSelectedLoop } from './members/mutable-selected-loop.js';
import { lowerImportedNamespaceMemberAccess } from './members/namespace.js';
import { lowerProviderForwarding } from './members/provider-forwarding.js';
import { lowerResidualMemberAccess } from './members/residual.js';
import { lowerRestArrayFixedSelections } from './members/rest-array.js';
import { lowerSelectedModelDiscriminators } from './members/selected-models.js';
import { lowerTupleConsumerBindings } from './members/tuple-consumers.js';
import { compileDestructuringDecisions } from './policy/decision-store.js';
import { getDefaultInitializer } from './policy/defaults.js';
import { getRuntimeBindingIdentities, placeGeneratedRuntimeStatements } from './policy/dependencies.js';
import {
    getDestructuringDecision,
    getDestructuringDecisionForNode,
    getDestructuringGuardKinds,
    isCompletedLiveCollectionLoop
} from './policy/destructuring-agreements.js';
import {
    annotateCyclicRuntimeBindingReferences,
    annotateCompletedLoopBoundaries,
    annotateRetainedDynamicMemberAccess,
    annotateRetainedStaticMemberAccess,
    annotateRestArraySelectionBoundaries,
    groupNextLineExceptions
} from './policy/exceptions.js';
import {
    hasGuardFor,
    hasOptionalFallbackFor
} from './policy/guards.js';
import { compilePlacementDecisions, getPlacementTypeInfo, hasPlacementAbsence } from './policy/placement.js';
import { collectDestructuringAgreements } from './policy/source-agreements.js';
import { getRuntimeGuardKinds } from './understand/binding-evidence.js';
import {
    getBindingNames,
    getRuntimeNames,
    getRuntimeReferences,
    getUnsupportedTypeDiagnostics,
    isTypeOnlyNamespace
} from './understand/imports.js';
import { collectPlacementEvidence } from './understand/placement-evidence.js';
import { createShapeProvider } from './understand/shape.js';
import {
    getDeclarationMap,
    requireCompilerMember,
    collectConsumerBindingContracts,
    collectAritySignatureContracts,
    collectArityReturnContracts,
    collectSwitchReturnContracts,
    collectNullishEqualityContracts,
    collectDirectCapabilityContracts,
    collectCallableOperationContracts,
    collectSortCapabilityContracts,
    collectProviderForwardContracts,
    collectExactProjectionContracts,
    collectExactProviderForwardContracts,
    collectFactoryBindingContracts,
    collectProviderEdgeContracts,
    collectSelectedModelContracts,
    collectClosedProviderModelContracts,
    collectClosedStructuralModelContracts,
    collectCollectionReconstructionContracts,
    collectConsoleEffectContracts,
    collectOperationalObjectBuilderContracts,
    collectArrayCardinalityContracts,
    collectRequiredTupleBindingContracts,
    collectRestArraySelectionContracts,
    collectLiveIteratorPayloadContracts,
    collectDeferredSelectedPayloadContracts,
    collectDeferredOpaqueFieldContracts,
    collectCurriedSelectedTupleContracts,
    collectReceiverOrderedProjectionContracts,
    collectShortCircuitTupleArgumentContracts,
    collectOrderedNestedTupleReadContracts,
    collectIndexedOperationContracts,
    collectLiveArrayVisitationContracts,
    collectLoopCarriedRecurrenceContracts,
    collectNumericRangeBuilderContracts,
    collectMutableSelectedLoopContracts,
    collectIndexedLocalSelectionContracts,
    collectUnusedBindingContracts,
    collectBindingReferences,
    collectRuntimeBindingReferenceFacts,
    collectTypedIgnoredArgumentCallContracts,
    collectResolvedSourceCallContracts,
    collectDeclaredNullishResultContracts,
    collectDetachedPromiseForwardContracts,
    collectCallableProviderDispatchContracts,
    collectLiveWorkQueueContracts,
    collectLiveSetVisitationContracts,
    collectObservableSetUnionContracts,
    collectSamePhaseSelectedBindingContracts,
    collectDeferredSignatureSelectionContracts,
    collectNativeClassBoundaryContracts,
    collectOrderedDecisionContracts,
    collectRepeatedParameterReadContracts,
    collectDeclarationLifetimeContracts,
    collectNativeFunctionContracts,
    collectHoistedFunctionContracts,
    collectLiveOwnKeyEnumerationContracts,
    getConsumerContractKey,
    getProgramDeclarationMap,
    getMembers,
    getPropertySource,
    getRuntimeName,
    getTypeInfo,
    getTypeText,
    getUnionResolverSource
} from './understand/type-evidence.js';
import { getObject, isObject } from '../../rules/support/object.js';
import {
    updateFunction,
    updateVariableDeclarationFields
} from '../utils/ast-boundary.js';

const hasRuntimeDeclaration = ({ declarations = {}, name = '' } = {}) => Object.keys(declarations)
    .some(declarationName => getRuntimeName(declarationName) === name);

const createTypeScriptTransformer = ({
    typescript = {},
    program = {},
    resolvers = {},
    standard = {},
    target = undefined
} = {}) => {
    const {
        SyntaxKind: {
            ImportDeclaration: ImportDeclarationKind2 = -1,
            ModuleDeclaration: ModuleDeclarationKind2 = -1,
            VariableDeclarationList: VariableDeclarationListKind2 = -1,
            ArrayBindingPattern: ArrayBindingPatternKind2 = -1,
            Identifier: IdentifierKind5 = -1,
            PropertyAccessExpression: PropertyAccessExpressionKind2 = -1,
            ElementAccessExpression: ElementAccessExpressionKind2 = -1,
            FunctionDeclaration: FunctionDeclarationKind3 = -1,
            FunctionExpression: FunctionExpressionKind2 = -1,
            ArrowFunction: ArrowFunctionKind2 = -1,
            Block: BlockKind2 = -1,
            SourceFile: SourceFileKind4 = -1,
            ExportDeclaration: ExportDeclarationKind2 = -1
        } = {},
        NodeFlags: {
            Let: LetKind4 = 0,
            Const: ConstKind16 = 0
        } = {},
        ScriptTarget: {
            ES2016: minimumTarget = 3,
            ESNext: defaultTarget = 99
        } = {},
        factory = {}
    } = typescript;

    if (!isObject(typescript)) throw new TypeError('A TypeScript compiler implementation is required.');

    const { getCompilerOptions = false } = getObject(program);
    const programTarget = typeof getCompilerOptions === 'function'
        ? program.getCompilerOptions().target
        : undefined;
    const targetScript = target ?? programTarget ?? defaultTarget;

    if (targetScript < minimumTarget) throw new RangeError(
        'The Resilient target requires ECMAScript 2016 or newer.'
    );

    const shapeProvider = createShapeProvider({
        typescript,
        program,
        resolvers,
        targetScript,
        getProgramDeclarationMap,
        getRuntimeGuardKinds,
        getDeclarationMap,
        getUnsupportedTypeDiagnostics,
        getRuntimeReferences,
        getRuntimeNames,
        getTypeInfo,
        getTypeText,
        hasRuntimeDeclaration
    });
    const { createAnalysis = requireCompilerMember('Shape.createAnalysis') } = getObject(shapeProvider);

    const analyze = (options = {}) => {
        const {
            contracts = [],
            diagnostics = []
        } = getObject(createAnalysis(options));

        return { contracts, diagnostics };
    };

    const transform = ({ code = '', fileName = 'input.ts' } = {}) => {
        const agreements = new Set();
        const {
            ModuleKind: {
                ESNext: esNextModule = 99
            } = {},
            transform: applyTransform = () => ({}),
            visitEachChild = () => ({}),
            visitNode = () => ({}),
            transpileModule = () => ({}),
            JsxEmit: {
                Preserve: jsxPreserve = 1
            } = {}
        } = typescript;
        const {
            census = {},
            declarations = {},
            diagnostics: sourceDiagnostics = [],
            reservedNames = new Set(),
            sourceFile = {},
            checker = {},
            usedObjects = new Set(),
            usedUnions = new Map(),
            runtimeGuardKinds = new Set()
        } = createAnalysis({ code, fileName });
        let diagnostics = sourceDiagnostics;
        const bindingReferences = collectBindingReferences({ typescript, sourceFile, census, checker });
        const { statements: runtimeBindingStatements = [] } = getObject(sourceFile);
        const runtimeBindingTargets = new Map(runtimeBindingStatements.flatMap(node => [...getRuntimeBindingIdentities({
            typescript, statements: [node], checker
        })].map(([symbol = false] = []) => [symbol, getConsumerContractKey(node)])));
        const runtimeBindingReferences = collectRuntimeBindingReferenceFacts({
            typescript, sourceFile, checker, bindingReferences, runtimeBindingTargets
        });
        const consumerContracts = collectConsumerBindingContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const unusedBindingContracts = collectUnusedBindingContracts({
            typescript,
            sourceFile, census,
            checker,
            bindingReferences
        });
        const typedIgnoredArgumentCallContracts = collectTypedIgnoredArgumentCallContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const resolvedSourceCallContracts = collectResolvedSourceCallContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const declaredNullishResultContracts = collectDeclaredNullishResultContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const detachedPromiseForwardContracts = collectDetachedPromiseForwardContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const directCapabilityContracts = collectDirectCapabilityContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const sortCapabilityContracts = collectSortCapabilityContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const providerEdges = collectProviderEdgeContracts({
            typescript,
            sourceFile, census,
            checker,
            bindingReferences
        });
        const providerForwards = collectProviderForwardContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const exactProjections = collectExactProjectionContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const closedProviderModels = collectClosedProviderModelContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const closedStructuralModels = collectClosedStructuralModelContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const callableOperationContracts = collectCallableOperationContracts({
            typescript, sourceFile, census, checker, directCapabilityContracts, closedStructuralModels
        });
        const selectedModelContracts = collectSelectedModelContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const reconstructionContracts = collectCollectionReconstructionContracts({
            typescript,
            sourceFile, census,
            checker,
            bindingReferences
        });
        const liveWorkQueueContracts = collectLiveWorkQueueContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const liveSetVisitationContracts = collectLiveSetVisitationContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const observableSetUnionContracts = collectObservableSetUnionContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const collectionReconstructionContracts = new Map([
            ...reconstructionContracts,
            ...liveWorkQueueContracts,
            ...liveSetVisitationContracts,
            ...observableSetUnionContracts
        ]);
        const consoleEffectContracts = collectConsoleEffectContracts({ typescript, sourceFile, census, checker });
        const aritySignatureContracts = collectAritySignatureContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const arityReturnContracts = collectArityReturnContracts({ typescript, sourceFile, checker });
        const switchReturnContracts = collectSwitchReturnContracts({ typescript, sourceFile, checker });
        const nullishEqualityContracts = collectNullishEqualityContracts({ typescript, sourceFile, census, checker });
        const operationalObjectBuilderContracts = collectOperationalObjectBuilderContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const arrayCardinalityContracts = collectArrayCardinalityContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const requiredTupleBindingContracts = collectRequiredTupleBindingContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const restArraySelectionContracts = collectRestArraySelectionContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const liveIteratorPayloadContracts = collectLiveIteratorPayloadContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const deferredSelectedPayloadContracts = collectDeferredSelectedPayloadContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const deferredOpaqueFieldContracts = collectDeferredOpaqueFieldContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const factoryBindingContracts = collectFactoryBindingContracts({ typescript, sourceFile, census, checker });
        const exactProviderForwards = collectExactProviderForwardContracts({
            typescript, sourceFile, census, checker, deferredOpaqueFieldContracts
        });
        const curriedSelectedTupleContracts = collectCurriedSelectedTupleContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const receiverOrderedProjectionContracts = collectReceiverOrderedProjectionContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const shortCircuitTupleArgumentContracts = collectShortCircuitTupleArgumentContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const orderedNestedTupleReadContracts = collectOrderedNestedTupleReadContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const indexedOperationContracts = collectIndexedOperationContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const liveArrayVisitationContracts = collectLiveArrayVisitationContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const loopCarriedRecurrenceContracts = collectLoopCarriedRecurrenceContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const numericRangeBuilderContracts = collectNumericRangeBuilderContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const mutableSelectedLoopContracts = collectMutableSelectedLoopContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const indexedLocalSelectionContracts = collectIndexedLocalSelectionContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const callableProviderDispatchContracts = collectCallableProviderDispatchContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const samePhaseSelectedBindingContracts = collectSamePhaseSelectedBindingContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const deferredSignatureSelectionContracts = collectDeferredSignatureSelectionContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const nativeClassBoundaryContracts = collectNativeClassBoundaryContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const orderedDecisionContracts = collectOrderedDecisionContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const repeatedParameterReadContracts = collectRepeatedParameterReadContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const declarationLifetimeContracts = collectDeclarationLifetimeContracts({
            typescript,
            sourceFile, census,
            checker,
            bindingReferences
        });
        const nativeFunctionContracts = collectNativeFunctionContracts({
            typescript,
            sourceFile, census,
            checker,
            bindingReferences
        });
        const hoistedFunctionContracts = collectHoistedFunctionContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const liveOwnKeyEnumerationContracts = collectLiveOwnKeyEnumerationContracts({
            typescript,
            sourceFile, census,
            checker
        });
        const destructuringAgreements = compileDestructuringDecisions(collectDestructuringAgreements({
            typescript,
            consumerContracts,
            directCapabilityContracts,
            callableOperationContracts,
            sortCapabilityContracts,
            providerForwards,
            providerEdges,
            closedProviderModels,
            closedStructuralModels,
            exactProjections,
            exactProviderForwards,
            factoryBindingContracts,
            selectedModelContracts,
            collectionReconstructionContracts,
            consoleEffectContracts,
            aritySignatureContracts,
            arityReturnContracts,
            switchReturnContracts,
            nullishEqualityContracts,
            operationalObjectBuilderContracts,
            arrayCardinalityContracts,
            requiredTupleBindingContracts,
            restArraySelectionContracts,
            liveIteratorPayloadContracts,
            deferredSelectedPayloadContracts,
            deferredOpaqueFieldContracts,
            curriedSelectedTupleContracts,
            receiverOrderedProjectionContracts,
            shortCircuitTupleArgumentContracts,
            orderedNestedTupleReadContracts,
            indexedOperationContracts,
            liveArrayVisitationContracts,
            loopCarriedRecurrenceContracts,
            numericRangeBuilderContracts,
            mutableSelectedLoopContracts,
            indexedLocalSelectionContracts,
            unusedBindingContracts,
            typedIgnoredArgumentCallContracts,
            resolvedSourceCallContracts,
            declaredNullishResultContracts,
            detachedPromiseForwardContracts,
            callableProviderDispatchContracts,
            samePhaseSelectedBindingContracts,
            deferredSignatureSelectionContracts,
            nativeClassBoundaryContracts,
            orderedDecisionContracts,
            repeatedParameterReadContracts,
            declarationLifetimeContracts,
            nativeFunctionContracts,
            hoistedFunctionContracts,
            liveOwnKeyEnumerationContracts
        }));
        diagnostics = [...diagnostics, ...(destructuringAgreements.byKind.get('declaration-lifetime') || [])
            .filter(({ agreement: { action = '' } = {} } = {}) => action === 'unsupported-function-scoped-var')
            .map(({ contract = {} } = {}) => ({
                fileName,
                kind: 'UnsupportedDeclaration',
                text: getObject(contract).unsupportedReason || 'var binding equivalence is unproved'
            }))];
        const agreementGuardKinds = getDestructuringGuardKinds({ destructuringAgreements });
        const tupleGuardKinds = new Set([...agreementGuardKinds]
            .filter(kind => ['array', 'array-content', 'function'].includes(kind)));

        const placement = compilePlacementDecisions({ typescript, evidence: collectPlacementEvidence({
            typescript, sourceFile, census, checker, declarations, resolvers, reservedNames
        }) });
        const unionResolverSources = [...usedUnions.entries()]
            .map(([name = '', info = {}]) => {
                const { parts = [] } = getObject(info);

                return getUnionResolverSource({
                    typescript,
                    parts,
                    sourceFile,
                    declarations,
                    resolvers,
                    name
                });
            });
        const { object: objectStandard = '', array: arrayStandard = '', function: functionStandard = '' } = standard;
        const { fileName: sourceFileName = '' } = getObject(sourceFile);
        const objectResolverEntries = Object.entries(declarations)
            .filter(([name = '', declaration = {}]) => {
                const runtimeName = getRuntimeName(name);
                const { getSourceFile = false } = getObject(declaration);
                const declarationSource = typeof getSourceFile === 'function'
                    ? declaration.getSourceFile()
                    : undefined;
                const { fileName: declFileName = '' } = getObject(declarationSource);
                const isLocalDeclaration = !declarationSource || declFileName === sourceFileName;

                return (isLocalDeclaration || !reservedNames.has(runtimeName)) && usedObjects.has(runtimeName);
            });
        const objectResolverProperties = new Map(objectResolverEntries.map(([name = '', declaration = {}]) => [name,
            getMembers({ typescript, declaration, declarations })
                .map(member => getPropertySource({ typescript, member, sourceFile, declarations, resolvers }))
                .filter(({ propertyName = '' } = {}) => propertyName)
        ]));
        const objectResolverGuardKinds = new Set(objectResolverEntries.flatMap(([name = '']) => (
            [...getObjectResolverGuardKinds({ properties: objectResolverProperties.get(name) })]
        )));
        const resolverRequirements = new Set(unionResolverSources.flatMap(({ branches = [] } = {}) => (
            branches.flatMap(({ requirements = [] } = {}) => requirements)
        )));
        const needsArrayFamilyStandard = arrayStandard &&
            (tupleGuardKinds.has('array') || runtimeGuardKinds.has('array') || objectResolverGuardKinds.has('array'));
        const needsArrayContentStandard = arrayStandard &&
            (tupleGuardKinds.has('array-content') || resolverRequirements.has('array-content'));
        const needsArrayStandard = needsArrayFamilyStandard || needsArrayContentStandard;
        const needsFunctionGuard = tupleGuardKinds.has('function') ||
            runtimeGuardKinds.has('function') || objectResolverGuardKinds.has('function');
        const needsFunctionStandard = functionStandard && (needsFunctionGuard || resolverRequirements.has('function'));
        const needsModelCheck = objectStandard && resolverRequirements.has('model');
        const needsObjectContentStandard = objectStandard &&
            (runtimeGuardKinds.has('object') || objectResolverGuardKinds.has('object') || resolverRequirements.has('object-content'));
        const unionResolverStatements = unionResolverSources.map(({ name = '', branches = [], fallback = {} } = {}) => {
            const normalizedBranches = branches.map((branch = {}) => {
                const { predicate = {} } = branch;

                return { ...branch, check: renderResolverPredicate({
                    predicate,
                    standard: { array: needsArrayContentStandard, function: needsFunctionStandard, object: needsModelCheck },
                    bindMembers: Boolean(needsModelCheck)
                }) };
            });
            const inputMembers = [...new Set(branches.flatMap(({ predicate = {} } = {}) => {
                const { kind = '', property = '' } = predicate;

                return kind === 'discriminant' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(property) ? [property] : [];
            }))];

            return getUnionResolverDeclaration({
                typescript,
                name,
                branches: normalizedBranches,
                fallback,
                inputMembers,
                useObjectStandard: needsModelCheck,
                fileName: `${fileName}.resilient.union.ts`,
                targetScript
            });
        });
        // Configured helpers may have module effects or dependencies. Keep their
        // established evaluation order; spelling cannot establish commutativity.
        const standardImports = [
            objectStandard && getStandardImportDeclaration({
                typescript,
                moduleName: objectStandard,
                names: [
                    'isObject',
                    ...(needsObjectContentStandard ? ['hasContent'] : []),
                    ...(needsModelCheck ? ['modelCheck'] : [])
                ]
            }),
            needsArrayStandard && getStandardImportDeclaration({
                typescript,
                moduleName: arrayStandard,
                names: [
                    ...(needsArrayFamilyStandard ? ['isArray'] : []),
                    ...(needsArrayContentStandard ? ['hasArrayContent'] : [])
                ]
            }),
            needsFunctionStandard && getStandardImportDeclaration({
                typescript,
                moduleName: functionStandard,
                names: ['isFunction']
            })
        ].filter(Boolean);
        const objectResolverStatements = objectResolverEntries
            .map(([name = '']) => getObjectResolverDeclaration({
                typescript,
                properties: objectResolverProperties.get(name),
                name: getRuntimeName(name)
            }))
            .filter(Boolean);
        const generatedStatements = [
            ...standardImports,
            ...objectResolverStatements,
            ...unionResolverStatements
        ];
        // Phase 1: rewrite authored source from completed source decisions.
        // Unused-binding cleanup precedes member extraction; guarded returns
        // expose statement owners before selected/call/collection placement.
        // Generated resolver declarations never enter this phase.
        const bindingSource = diagnostics.length
            ? sourceFile
            : applyTransform(sourceFile, [context => root => lowerUnusedBindings({
                typescript,
                sourceFile: root,
                destructuringAgreements,
                context
            })]).transformed[0];
        const guardedSource = diagnostics.length
            ? bindingSource
            : applyTransform(bindingSource, [context => root => lowerGuardedConditionalReturns({ typescript, sourceFile: root, placement, destructuringAgreements, context })]).transformed[0];
        const nullishResultSource = diagnostics.length
            ? guardedSource
            : applyTransform(guardedSource, [context => root => annotateDeclaredNullishResults({
                typescript,
                sourceFile: root,
                destructuringAgreements,
                context
            })]).transformed[0];
        const detachedPromiseSource = diagnostics.length
            ? guardedSource
            : applyTransform(nullishResultSource, [context => root => lowerDetachedPromiseWork({
                typescript,
                sourceFile: root,
                destructuringAgreements,
                context
            })]).transformed[0];
        const resolvedCallSource = diagnostics.length
            ? guardedSource
            : applyTransform(detachedPromiseSource, [context => root => annotateResolvedSourceCalls({
                typescript,
                sourceFile: root,
                destructuringAgreements,
                context
            })]).transformed[0];
        const providerDispatchSource = diagnostics.length
            ? guardedSource
            : applyTransform(resolvedCallSource, [context => root => placeCallableProviderDispatch({
                typescript,
                sourceFile: root,
                destructuringAgreements,
                context
            })]).transformed[0];
        const selectedBindingSource = diagnostics.length
            ? guardedSource
            : applyTransform(providerDispatchSource, [context => root => lowerSamePhaseSelectedBindings({
                typescript,
                sourceFile: root,
                destructuringAgreements,
                context
            })]).transformed[0];
        const sortFunctionKeys = new Set([...sortCapabilityContracts.values()]
            .map(({ functionKey = '' } = {}) => functionKey).filter(Boolean));
        const { typeOnlyImports = new Set() } = placement;
        const transformedSource = diagnostics.length
            ? guardedSource
            : applyTransform(selectedBindingSource, [context => (root) => {
                const moduleSource = lowerImportedNamespaceMemberAccess({
                    typescript,
                    sourceFile: root,
                    context
                });
                const visit = (node) => {
                    const { kind: nodeKind = 0 } = node;

                    if (isCompletedLiveCollectionLoop({ typescript, node, destructuringAgreements })) return node;

                    if (nodeKind === ImportDeclarationKind2) return updateTypeOnlyImport({
                        typescript,
                        typeOnlyImports,
                        node
                    });

                    if (nodeKind === ModuleDeclarationKind2 &&
                        // eslint-disable-next-line resilient/prefer-falsey-returns -- undefined removes a type-only namespace declaration
                        isTypeOnlyNamespace({ typescript, node })) return undefined;

                    if (nodeKind === VariableDeclarationListKind2) {
                        const { agreement: requiredTupleAgreement = {} } = getDestructuringDecisionForNode({
                            typescript,
                            node: getObject(node).parent,
                            destructuringAgreements,
                            kinds: ['required-tuple-binding']
                        });
                        const { action: requiredTupleAction = '' } = requiredTupleAgreement;
                        const { agreement: lifetimeAgreement = {} } = getDestructuringDecisionForNode({
                            typescript,
                            node,
                            destructuringAgreements,
                            kinds: ['declaration-lifetime']
                        });
                        const { action: lifetimeAction = 'retain-function-scoped-var' } = lifetimeAgreement;
                        const visitedList = visitEachChild(node, visit, context);
                        const { flags: nodeFlags = 0 } = getObject(node);
                        const { declarations: visitedDeclarations = [] } = getObject(visitedList);
                        const sourceVar = !(nodeFlags & (LetKind4 | ConstKind16));
                        const { [lifetimeAction]: normalizedFlags = 0 } = {
                            'normalize-function-var-const': ConstKind16,
                            'normalize-function-var-let': LetKind4
                        };
                        const normalizedList = sourceVar && normalizedFlags
                            ? factory.createVariableDeclarationList(visitedDeclarations, normalizedFlags)
                            : visitedList;
                        const { declarations: normalizedDeclarations = [] } = getObject(normalizedList);
                        let hasLegacyRequiredTupleSelection = false;
                        const defaultedDeclarations = normalizedDeclarations.flatMap((declaration = {}) => {
                            const {
                                name: declName = {},
                                // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- An omitted initializer must remain absent in the declaration factory update.
                                initializer: declInitializer
                            } = getObject(declaration);
                            const { kind: declNameKind = 0 } = getObject(declName);
                            const { kind: declInitKind = 0 } = getObject(declInitializer);
                            const isArrayBinding = declNameKind === ArrayBindingPatternKind2;
                            const { elements: guardedElements = [] } = getObject(declName);
                            const isGuardedTupleBinding = isArrayBinding && guardedElements.length &&
                                guardedElements.every(({ __resilientGuarded = false } = {}) => __resilientGuarded);
                            const { agreement: tupleAgreement = {} } = getDestructuringDecision({
                                destructuringAgreements,
                                key: getConsumerContractKey(declName),
                                kinds: ['consumer', 'consumer-callback']
                            });
                            const { action: tupleAction = '' } = tupleAgreement;

                            if (isGuardedTupleBinding || isArrayBinding &&
                                ['guard-tuple-content', 'guard-tuple-arity'].includes(tupleAction)) return [declaration];

                            const reusableSourceKinds = [
                                IdentifierKind5,
                                PropertyAccessExpressionKind2,
                                ElementAccessExpressionKind2
                            ];
                            const sourceNode = isArrayBinding && declInitializer &&
                                reusableSourceKinds.includes(declInitKind)
                                ? declInitializer
                                : undefined;
                            const {
                                expression: tupleReceiver = {},
                                name: tupleProperty = {}
                            } = getObject(declInitializer);
                            const isDirectStaticTupleMember = isArrayBinding &&
                                declInitKind === PropertyAccessExpressionKind2 &&
                                tupleReceiver &&
                                getObject(tupleProperty).kind === IdentifierKind5;

                            const pattern = isDirectStaticTupleMember || requiredTupleAction === 'retain-required-tuple-binding'
                                ? declName
                                : updateBindingPattern({
                                    typescript,
                                    pattern: declName,
                                    sourceFile,
                                    declarations,
                                    placement,
                                    destructuringAgreements
                                });

                            const isTupleCarrier = Boolean(isArrayBinding && declInitializer);

                            if (pattern === declName && !isTupleCarrier) return [declaration];

                            hasLegacyRequiredTupleSelection = hasLegacyRequiredTupleSelection ||
                                isDirectStaticTupleMember && requiredTupleAction !== 'retain-required-tuple-binding';
                            const nextInitializer = isDirectStaticTupleMember
                                ? tupleReceiver
                                : sourceNode || declInitializer;
                            const { elements: tupleElements = [] } = getObject(pattern);
                            const tupleCarrier = createTupleCarrier({
                                source: declInitializer,
                                containerAgreement: { state: 'known', owner: 'typed-producer' },
                                owner: 'typed-producer',
                                placement: 'statement',
                                positions: tupleElements.map((element = {}, index) => {
                                    // An emitted initializer is the position's proven family; without
                                    // one the caller still owns the position's agreement.
                                    const { initializer: positionInitializer = undefined } = getObject(element);

                                    return {
                                        index,
                                        agreement: {
                                            state: positionInitializer ? 'known' : 'caller-owned',
                                            owner: 'typed-producer'
                                        },
                                        consumer: 'binding',
                                        suppliedBy: element
                                    };
                                })
                            });
                            let tuplePattern = isTupleCarrier
                                ? createTupleCarrierPattern({ factory, elements: tupleElements })
                                : pattern;

                            if (isDirectStaticTupleMember) {
                                tuplePattern = factory.createObjectBindingPattern([
                                    factory.createBindingElement(
                                        undefined,
                                        tupleProperty,
                                        pattern,
                                        undefined
                                    )
                                ]);
                            }

                            const nextDeclaration = updateVariableDeclarationFields({
                                factory, declaration, name: tuplePattern, initializer: nextInitializer
                            });

                            const tupleDeclaration = isTupleCarrier && !isDirectStaticTupleMember
                                ? updateVariableDeclarationFields({
                                    factory,
                                    declaration: nextDeclaration,
                                    name: tuplePattern,
                                    initializer: createTupleCarrierExpression({
                                        factory,
                                        carrier: tupleCarrier
                                    })
                                })
                                : nextDeclaration;

                            return [tupleDeclaration];
                        });
                        const defaultedList = factory.updateVariableDeclarationList(
                            normalizedList,
                            defaultedDeclarations
                        );
                        const { parent: declarationStatement = {} } = getObject(node);
                        const {
                            addSyntheticLeadingComment = false,
                            SingleLineCommentTrivia = -1
                        } = typescript;

                        hasLegacyRequiredTupleSelection && typeof addSyntheticLeadingComment === 'function' &&
                            addSyntheticLeadingComment(
                                declarationStatement,
                                SingleLineCommentTrivia,
                                ' eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Required tuple preserves source failure.',
                                true
                            );

                        return lowerTupleDestructuring({ typescript, node: defaultedList, placement });
                    }

                    const functionKinds = [
                        FunctionDeclarationKind3,
                        FunctionExpressionKind2,
                        ArrowFunctionKind2
                    ];

                    if (!functionKinds.includes(nodeKind)) {
                        const visitedNode = visitEachChild(node, visit, context);
                        const loweredIndexed = lowerIndexedTreeReducer({
                            typescript,
                            node: visitedNode
                        });

                        return loweredIndexed;
                    }

                    // Collection reconstruction consumes source-range checker
                    // facts. It must run before recursive member/default
                    // lowering can split a selected tuple read from its fresh
                    // collection update.
                    const collectionPlacedNode = lowerCollectionAgreementPlacements({
                        typescript,
                        node,
                        destructuringAgreements,
                        context
                    });
                    const tupleGuardedNode = lowerTupleConsumerBindings({
                        typescript,
                        node: collectionPlacedNode,
                        destructuringAgreements,
                        reservedNames,
                        agreements
                    });
                    const providerForwardedNode = lowerProviderForwarding({
                        typescript,
                        node: tupleGuardedNode,
                        destructuringAgreements,
                        agreements,
                        context
                    });
                    const exactProviderForwardedNode = lowerExactProviderForwarding({
                        typescript,
                        node: providerForwardedNode,
                        destructuringAgreements,
                        agreements,
                        context
                    });
                    const exactProjectedNode = lowerExactCallbackProjections({
                        typescript,
                        node: exactProviderForwardedNode,
                        destructuringAgreements,
                        agreements,
                        context
                    });
                    const capabilityGuardedNode = lowerDirectCapabilityConsumers({
                        typescript,
                        node: exactProjectedNode,
                        destructuringAgreements,
                        agreements,
                        standard,
                        context
                    });
                    const visited = visitEachChild(capabilityGuardedNode, visit, context);
                    const { parameters: visitedParameters = [], body: visitedBody = {} } = getObject(visited);
                    const { kind: visitedBodyKind = 0, statements: visitedBodyStatements = [] } = getObject(visitedBody);

                    // A declaration-only overload carries type shape but has no
                    // runtime body to lower. Preserve its compiler absence.
                    if (!visitedBodyKind) return visited;

                    const { parameters: originalParameters = [] } = getObject(node);
                    const { agreement: requiredTupleAgreement = {} } = getDestructuringDecisionForNode({
                        typescript,
                        node,
                        destructuringAgreements,
                        kinds: ['required-tuple-binding']
                    });
                    const { action: requiredTupleAction = '' } = requiredTupleAgreement;
                    const parameterResults = visitedParameters.map((parameter, parameterIndex) => {
                        const {
                            // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- An omitted parameter annotation must remain absent for the TypeScript factory.
                            type: paramType,
                            // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- An omitted parameter initializer must remain absent in the factory update.
                            initializer: paramInitializer,
                            // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- An omitted optionality token must remain absent in the factory update.
                            questionToken: paramQuestionToken,
                            name: paramName = {},
                            // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- An omitted parameter modifier list must remain absent in the factory update.
                            modifiers: paramModifiers,
                            // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- An omitted rest token must remain absent in the factory update.
                            dotDotDotToken: paramDotDotDotToken
                        } = getObject(parameter);
                        const { kind: paramNameKind = 0, text: paramNameText = '' } = getObject(paramName);
                        const isArrayBinding = paramNameKind === ArrayBindingPatternKind2;
                        const arraySourceNode = isArrayBinding
                            ? factory.createUniqueName('_resilientArgs')
                            : undefined;
                        const normalizedName = requiredTupleAction === 'retain-required-tuple-binding' && isArrayBinding
                            ? paramName
                            : updateBindingPattern({
                                typescript,
                                pattern: paramName,
                                typeNode: paramType,
                                body: visitedBody,
                                sourceFile,
                                declarations,
                                placement,
                                destructuringAgreements
                            });
                        const { kind: typeKind = 0 } = getObject(paramType);
                        const info = typeKind
                            ? getPlacementTypeInfo({ typescript, node: paramType, placement })
                            : {};
                        const {
                            optional: infoOptional = false,
                            requiresGuard: infoRequiresGuard = false,
                            canonical: infoCanonical = '',
                            kind: infoKind = ''
                        } = getObject(info);
                        const hasOptionalSignature = !!paramQuestionToken || !!infoOptional;
                        const optionalByFallback = hasOptionalFallbackFor({
                            typescript,
                            node: visitedBody,
                            sourceFile,
                            name: paramNameText
                        });
                        const guarded = infoRequiresGuard && hasGuardFor({
                            typescript,
                            node: visitedBody,
                            sourceFile,
                            name: paramNameText
                        });
                        const [originalParam = {}] = originalParameters.slice(parameterIndex, parameterIndex + 1);
                        const preservesUndefined = hasPlacementAbsence({ typescript, parameter: originalParam, placement });
                        const canonical = infoCanonical || (
                            ['function', 'invalid', 'union', 'unknown', 'required'].includes(infoKind)
                                ? ''
                                : '{}'
                        );
                        const fallbackCanonical = optionalByFallback && infoKind === 'required'
                            ? '{}'
                            : canonical;
                        const defaultInitializer = !paramInitializer && (hasOptionalSignature || optionalByFallback) &&
                            !preservesUndefined &&
                            (infoKind !== 'required' || guarded || optionalByFallback)
                            ? getDefaultInitializer({
                                factory,
                                canonical: fallbackCanonical
                            })
                            : undefined;

                        const nextInitializer = defaultInitializer || paramInitializer;
                        const hasArrayBinding = isArrayBinding && normalizedName !== paramName;
                        const parameterName = hasArrayBinding ? arraySourceNode : normalizedName;
                        const hasNameChange = parameterName !== paramName;

                        const { elements: parameterElements = [] } = getObject(normalizedName);
                        const parameterCarrier = createTupleCarrier({
                            source: arraySourceNode,
                            containerAgreement: { state: 'known', owner: 'rest-caller' },
                            owner: 'rest-caller',
                            placement: 'signature',
                            positions: parameterElements.map((element = {}, index) => ({
                                index,
                                agreement: { state: 'caller-owned', owner: 'rest-caller' },
                                consumer: 'signature',
                                suppliedBy: element
                            }))
                        });
                        const binding = hasArrayBinding
                            ? factory.createVariableStatement(
                                undefined,
                                factory.createVariableDeclarationList([
                                    factory.createVariableDeclaration(
                                        createTupleCarrierPattern({
                                            factory,
                                            elements: parameterElements
                                        }),
                                        undefined,
                                        undefined,
                                        createTupleCarrierExpression({ factory, carrier: parameterCarrier })
                                    )
                                ], ConstKind16)
                            )
                            : {};

                        const nextParameter = defaultInitializer || hasNameChange
                            ? factory.updateParameterDeclaration(
                                parameter,
                                paramModifiers,
                                paramDotDotDotToken,
                                parameterName,
                                undefined,
                                paramType,
                                nextInitializer
                            )
                            : parameter;

                        return { parameter: nextParameter, binding };
                    });

                    const parameters = parameterResults.map(({ parameter = {} } = {}) => parameter);
                    const parameterBindings = parameterResults
                        .map(({ binding = {} } = {}) => binding)
                        .filter(({ kind = 0 } = {}) => kind);
                    let parameterBody = visitedBody;

                    if (parameterBindings.length && visitedBodyKind === BlockKind2) {
                        parameterBody = factory.updateBlock(
                            visitedBody,
                            [...parameterBindings, ...visitedBodyStatements]
                        );
                    }

                    if (parameterBindings.length && visitedBodyKind !== BlockKind2) {
                        parameterBody = factory.createBlock([
                            ...parameterBindings,
                            factory.createReturnStatement(visitedBody)
                        ], true);
                    }

                    const normalizedFunction = updateFunction({
                        typescript,
                        node: visited,
                        parameters,
                        body: parameterBody
                    });
                    const switchLoweredFunction = lowerDiscriminatedSwitchAccess({
                        typescript,
                        node: normalizedFunction,
                        reservedNames,
                        placement,
                        destructuringAgreements,
                        context
                    });
                    const selectedModelFunction = lowerSelectedModelDiscriminators({
                        typescript,
                        node: switchLoweredFunction,
                        placement,
                        destructuringAgreements,
                        context
                    });
                    const updatedFunction = lowerParameterMemberAccess({ typescript, node: selectedModelFunction, declarations, placement, destructuringAgreements, context });
                    const loweredFunction = lowerLocalMemberAccess({
                        typescript,
                        node: updatedFunction,
                        placement,
                        destructuringAgreements,
                        context
                    });
                    const genericFunction = lowerGenericMemberAccess({ typescript, node: loweredFunction, placement, destructuringAgreements, context });
                    const restArrayFunction = lowerRestArrayFixedSelections({
                        typescript,
                        node: genericFunction,
                        destructuringAgreements,
                        context
                    });
                    const iteratorPayloadFunction = lowerLiveIteratorPayloadSelection({
                        typescript,
                        node: restArrayFunction,
                        destructuringAgreements,
                        context
                    });
                    const { agreement: deferredAgreement = {}, contract: deferredContract = {} } = getDestructuringDecisionForNode({
                        typescript, node: iteratorPayloadFunction, destructuringAgreements,
                        kinds: ['deferred-selected-payload-binding', 'deferred-opaque-field-binding']
                    });
                    const deferredPayloadFunction = getObject(iteratorPayloadFunction).kind === ArrowFunctionKind2 &&
                        ['deferred-selected-payload-binding', 'deferred-opaque-field-binding'].includes(getObject(deferredAgreement).action)
                        ? createDeferredSelectedPayloadBinding({
                            typescript, node: iteratorPayloadFunction, contract: deferredContract,
                            occupied: new Set(getBindingNames({ typescript, node: iteratorPayloadFunction })), context
                        }) : iteratorPayloadFunction;
                    const curriedTupleFunction = lowerCurriedSelectedTuple({
                        typescript,
                        node: deferredPayloadFunction,
                        destructuringAgreements,
                        context
                    });
                    const mutableLoopFunction = lowerMutableSelectedLoop({
                        typescript,
                        node: curriedTupleFunction,
                        destructuringAgreements,
                        context
                    });
                    const indexedLocalFunction = lowerIndexedLocalSelection({
                        typescript,
                        node: mutableLoopFunction,
                        destructuringAgreements
                    });
                    const { getOriginalNode = false } = typescript;
                    const originalFunction = typeof getOriginalNode === 'function' ? getOriginalNode(node) : node;
                    const sortOwner = sortFunctionKeys.has(getConsumerContractKey(originalFunction));
                    const { parent: nodeParent = {} } = getObject(sortOwner ? originalFunction : node);
                    const { kind: parentKind = 0 } = getObject(nodeParent);
                    const isTopLevelFunction = parentKind === SourceFileKind4;

                    if (isTopLevelFunction) return indexedLocalFunction;

                    return lowerFunctionDeclaration({
                        typescript,
                        node: indexedLocalFunction,
                        destructuringAgreements
                    });
                };

                return visitNode(moduleSource, visit);
            }]).transformed[0];
        // Source guards run before dynamic binding construction. Even an
        // unchanged printed block owns compiler update/Get failures here.
        const guardedBindingSource = diagnostics.length
            ? transformedSource
            : applyTransform(transformedSource, [context => root => lowerGuardedBindingExtraction({
                typescript, sourceFile: root, context
            })]).transformed[0];
        const keyedSource = diagnostics.length
            ? guardedBindingSource
            : applyTransform(guardedBindingSource, [context => (root) => {
                const functionKinds = [
                    FunctionDeclarationKind3,
                    FunctionExpressionKind2,
                    ArrowFunctionKind2
                ];
                const visit = (node) => {
                    if (!node) return node;

                    const { kind: nodeKind = 0, body: nodeBody = false, parameters: nodeParams = [] } = getObject(node);

                    const lowerFunction = () => {
                        if (!nodeBody) return node;

                        return updateFunction({
                            typescript,
                            node,
                            parameters: nodeParams,
                            body: visitEachChild(nodeBody, visit, context)
                        });
                    };

                    if (functionKinds.includes(nodeKind)) return lowerFunction();

                    const visited = visitEachChild(node, visit, context);

                    const { kind: visitedKind = 0 } = visited;

                    return visitedKind === VariableDeclarationListKind2
                        ? lowerDynamicArrayDestructuring({ typescript, node: visited, placement })
                        : visited;
                };

                return visitNode(root, visit);
            }]).transformed[0];
        const residualSource = diagnostics.length
            ? keyedSource
            : applyTransform(keyedSource, [context => root => lowerResidualMemberAccess({
                typescript, sourceFile: root, placement, destructuringAgreements, standard, agreements, context
            })]).transformed[0];
        // Residual construction can introduce new patterns. The same guard
        // utility places those after construction without moving the earlier
        // source guard phase or its compiler failures.
        const guardedResidualSource = diagnostics.length
            ? residualSource
            : applyTransform(residualSource, [context => root => lowerGuardedBindingExtraction({
                typescript,
                sourceFile: root,
                context
            })]).transformed[0];
        // Residual lowering can introduce a bounded `const { member } = NS`
        // alias after the first module pass. Re-run the same structural module
        // conversion here so a resolved local namespace export becomes a named
        // import instead of an unguarded object binding.
        const importedNamespaceSource = diagnostics.length
            ? guardedResidualSource
            : applyTransform(guardedResidualSource, [context => root => lowerImportedNamespaceMemberAccess({
                typescript,
                sourceFile: root,
                context
            })]).transformed[0];
        // Static ordering consumers are deliberately placed after all member
        // rewrites.  Earlier passes can turn `O.compare` into an alias, but
        // the source contract still names `O`; this last grammar placement
        // reconstructs the scoped extraction immediately before consumption.
        // No later member pass may hoist or discard that binding.
        const rewrittenSource = diagnostics.length || !sortCapabilityContracts.size
            ? importedNamespaceSource
            : applyTransform(importedNamespaceSource, [context => (root) => {
                const functionKinds = [
                    FunctionDeclarationKind3,
                    FunctionExpressionKind2,
                    ArrowFunctionKind2
                ];
                const visit = (node) => {
                    if (!node) return node;

                    const visited = visitEachChild(node, visit, context);
                    const { kind: visitedKind = 0 } = getObject(visited);

                    if (!functionKinds.includes(visitedKind)) return visited;

                    return lowerSortCapabilityConsumer({
                        typescript,
                        node: visited,
                        destructuringAgreements,
                        agreements,
                        standard
                    });
                };

                return visitNode(root, visit);
            }]).transformed[0];
        // Phase 2: assemble declarations after source rewrites have finished.
        // Arity lowering and declaration ordering share the final source list;
        // generated contracts join only after authored member placement.
        const declarationSource = diagnostics.length ? rewrittenSource
            : applyTransform(rewrittenSource, [context => root => lowerScopeEntryVarDeclarations({
                typescript, sourceFile: root, destructuringAgreements, context
            })]).transformed[0];
        const { statements: rewrittenStatements = [] } = getObject(declarationSource);
        const arityLowering = lowerAritySignatures({
            typescript,
            statements: rewrittenStatements,
            destructuringAgreements
        });
        const { statements: arityStatements = [] } = getObject(arityLowering);
        const loweredStatements = arityStatements.map(statement => lowerFunctionDeclaration({
            typescript,
            node: statement,
            destructuringAgreements
        }));
        const sourceImports = loweredStatements.filter(({ kind: statementKind = 0 } = {}) => {
            return (
                statementKind === ImportDeclarationKind2
            );
        });
        const runtimeStatements = loweredStatements.filter(({ kind: statementKind = 0 } = {}) => {
            return (
                statementKind !== ImportDeclarationKind2
            );
        });
        const generatedRuntimeStatements = generatedStatements.filter(({ kind: statementKind = 0 } = {}) => {
            return (
                statementKind !== ImportDeclarationKind2
            );
        });
        const generatedImports = generatedStatements.filter(({ kind: statementKind = 0 } = {}) => {
            return (
                statementKind === ImportDeclarationKind2
            );
        });
        const orderedRuntimeStatements = placeGeneratedRuntimeStatements({
            typescript,
            authoredStatements: runtimeStatements,
            generatedStatements: generatedRuntimeStatements
        });
        const exportStatements = orderedRuntimeStatements.filter(({ kind: statementKind = 0 } = {}) => {
            return (
                statementKind === ExportDeclarationKind2
            );
        });
        const executableRuntimeStatements = orderedRuntimeStatements.filter(({ kind: statementKind = 0 } = {}) => {
            return (
                statementKind !== ExportDeclarationKind2
            );
        });
        const assembledSource = factory.updateSourceFile(transformedSource, [
            ...generatedImports,
            ...sourceImports,
            ...executableRuntimeStatements,
            ...exportStatements
        ]);
        // The authored source has already passed the member-access lowering above.
        // Re-running that pass over the assembled model/resolver AST loses the
        // original checker context and turns valid indexed reads back into
        // residual IIFE extractions. Generated contract code must not feed back
        // through authored-source lowering.
        // Phase 3: finish assembled grammar, then attach retained boundaries.
        // Structural reconstruction precedes comment placement. Each final
        // annotation consumes completed evidence and cannot reopen the checker.
        const loweredGrammarSource = diagnostics.length
            ? assembledSource
            : applyTransform(assembledSource, [context => root => lowerFinalGrammar({
                typescript, sourceFile: root, destructuringAgreements, placement, standard, context, agreements
            })]).transformed[0];
        const orderedDecisionSource = diagnostics.length
            ? loweredGrammarSource
            : applyTransform(loweredGrammarSource, [context => root => lowerOrderedDecisions({
                typescript,
                sourceFile: root,
                destructuringAgreements,
                context
            })]).transformed[0];
        const finalSource = diagnostics.length
            ? orderedDecisionSource
            : applyTransform(orderedDecisionSource, [context => root => annotateFinalExceptions({
                typescript,
                sourceFile: root,
                destructuringAgreements,
                placement,
                context
            })]).transformed[0];
        // The first lifetime traversal carries prior final-exception trivia
        // through native annotation. A second idempotent traversal restores
        // early-reference boundaries on reconstructed nested declarations.
        const recursiveExceptionSource = diagnostics.length
            ? finalSource
            : applyTransform(finalSource, [context => root => annotateCyclicRuntimeBindingReferences({
                typescript,
                sourceFile: root,
                destructuringAgreements,
                runtimeBindingReferences,
                context
            })]).transformed[0];
        const placedSource = diagnostics.length
            ? recursiveExceptionSource
            : applyTransform(recursiveExceptionSource, [context => (root) => {
                const collectionAnnotated = lowerCollectionAgreementPlacements({
                    typescript,
                    node: root,
                    destructuringAgreements,
                    context,
                    annotationsOnly: true
                });

                const dynamicAnnotated = annotateRetainedDynamicMemberAccess({
                    typescript,
                    sourceFile: collectionAnnotated,
                    destructuringAgreements,
                    context
                });

                const staticAnnotated = annotateRetainedStaticMemberAccess({
                    typescript,
                    sourceFile: dynamicAnnotated,
                    destructuringAgreements,
                    context
                });

                const restAnnotated = annotateRestArraySelectionBoundaries({
                    typescript,
                    sourceFile: staticAnnotated,
                    destructuringAgreements,
                    context
                });

                const consoleAnnotated = annotateConsoleEffects({
                    typescript,
                    sourceFile: restAnnotated,
                    destructuringAgreements,
                    context
                });

                const returned = annotateCompletedReturnBoundaries({
                    typescript,
                    sourceFile: consoleAnnotated,
                    destructuringAgreements,
                    placement,
                    context
                });

                const equalityAnnotated = annotateRetainedNullishEquality({
                    typescript,
                    sourceFile: returned,
                    destructuringAgreements,
                    context
                });

                const resolvedCalls = !resolvedSourceCallContracts.size ? equalityAnnotated : annotateResolvedSourceCalls({
                    typescript,
                    sourceFile: equalityAnnotated,
                    destructuringAgreements,
                    context,
                    annotationsOnly: true
                });

                const declaredResults = !declaredNullishResultContracts.size ? resolvedCalls : annotateDeclaredNullishResults({
                    typescript,
                    sourceFile: resolvedCalls,
                    destructuringAgreements,
                    context,
                    annotationsOnly: true
                });

                const providerAnnotated = !callableProviderDispatchContracts.size && !collectionReconstructionContracts.size
                    ? declaredResults : placeCallableProviderDispatch({
                        typescript,
                        sourceFile: declaredResults,
                        destructuringAgreements,
                        context,
                        annotationsOnly: true
                    });

                const classAnnotated = annotateNativeClassBoundaries({
                    typescript,
                    sourceFile: providerAnnotated,
                    destructuringAgreements
                });

                const orderedAnnotated = annotateOrderedDecisionBoundaries({
                    typescript,
                    sourceFile: classAnnotated,
                    destructuringAgreements
                });

                const loopAnnotated = annotateCompletedLoopBoundaries({
                    typescript,
                    sourceFile: orderedAnnotated,
                    destructuringAgreements,
                    context
                });

                const nativeAnnotated = annotateNativeFunctionDeclarationBoundaries({
                    typescript,
                    sourceFile: loopAnnotated,
                    context,
                    destructuringAgreements
                });

                const cyclicAnnotated = annotateCyclicRuntimeBindingReferences({
                    typescript,
                    sourceFile: nativeAnnotated,
                    destructuringAgreements,
                    runtimeBindingReferences,
                    context
                });

                const indexedAnnotated = annotateRetainedDynamicMemberAccess({
                    typescript,
                    sourceFile: cyclicAnnotated,
                    destructuringAgreements,
                    context,
                    annotationsOnly: true
                });
                const mutationAnnotated = annotateRetainedMutationBoundaries({ typescript, sourceFile: indexedAnnotated });

                return groupNextLineExceptions({ typescript, sourceFile: mutationAnnotated, context });
            }]).transformed[0];
        const input = placeEmissionBoundaries(typescript.createPrinter().printFile(placedSource), typescript, placedSource);
        const transpiled = diagnostics.length
            ? { outputText: '' }
            : transpileModule(input, {
                fileName,
                compilerOptions: {
                    target: targetScript,
                    module: esNextModule,
                    jsx: jsxPreserve
                }
            });
        const { outputText = '' } = getObject(transpiled);
        const emittedSource = typescript.createSourceFile(fileName, outputText, targetScript, true,
            getObject(sourceFile).scriptKind);
        let residualVar = false;
        const validateDeclarationKinds = (node) => {
            const { kind = 0, flags = 0 } = getObject(node);

            if (kind === VariableDeclarationListKind2 && !(flags & (LetKind4 | ConstKind16)))
                residualVar = true;

            typescript.forEachChild(node, validateDeclarationKinds);
        };

        validateDeclarationKinds(emittedSource);

        if (residualVar) diagnostics = [...diagnostics, {
            fileName, kind: 'UnsupportedDeclaration',
            text: 'emitted var declaration has no proved lexical lowering'
        }];

        return {
            code: diagnostics.length ? '' : formatResilientOutput(placeInlineEmissionBoundaries(outputText, typescript, placedSource), typescript),
            diagnostics,
            agreements: [...agreements]
        };
    };

    return { analyze, transform };
};

// This is intentionally a Program-level companion to the text convenience
// API above.  TypeScript owns project resolution and final emit; Resilient
// owns the completed source decision for each configured input file.
const createTypeScriptEmitTransformer = ({
    typescript = {},
    program = {},
    resolvers = {},
    standard = {},
    target = undefined
} = {}) => {
    const transformer = createTypeScriptTransformer({ typescript, program, resolvers, standard, target });
    const prepared = new Map();
    const {
        ScriptKind: { JS: javascript = 1 } = {},
        ScriptTarget: { ESNext: defaultTarget = 99 } = {}
    } = typescript;
    const { getCompilerOptions = () => ({}) } = program;
    const { target: programTarget = defaultTarget } = getCompilerOptions();
    const targetScript = target ?? programTarget;
    const prepare = ({ fileNames = [] } = {}) => {
        const results = fileNames.map((fileName) => {
            const sourceFile = typeof getObject(program).getSourceFile === 'function' ? program.getSourceFile(fileName) : undefined;
            const { text = '' } = getObject(sourceFile);
            const result = transformer.transform({ code: text, fileName });
            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private Program cache retains each prepared result for the corresponding compiler callback.
            prepared.set(fileName, result);

            return { fileName, ...result };
        });

        return {
            diagnostics: results.flatMap(({ diagnostics = [] } = {}) => diagnostics),
            results
        };
    };
    const before = () => (sourceFile) => {
        const { fileName = '', text = '' } = sourceFile;
        const result = prepared.get(fileName) || transformer.transform({ code: text, fileName });

        const { diagnostics = [], code = '' } = result;

        if (diagnostics.length) return sourceFile;

        return typescript.createSourceFile(fileName, code, targetScript, true, javascript);
    };

    return { before, prepare };
};

export {
    createTypeScriptEmitTransformer,
    createTypeScriptTransformer
};
