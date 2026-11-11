import { isFunction } from '../../../analysis/host/function.js';
import { getObject } from '../../../analysis/host/object.js';
import { getSourceRange, getSyntaxKinds } from '../../utils/ast-boundary.js';
import { getCollectionReconstructionAgreement } from './collection.js';

const getNativeFunctionAction = ({ arrowEquivalent = false, lifetimeEquivalent = false } = {}) => {
    if (!lifetimeEquivalent) return 'retain-native-function-declaration';

    if (arrowEquivalent) return 'lower-equivalent-arrow';

    return 'lower-native-function-expression';
};

const getDeclarationLifetimeAction = ({ routeAEligible = false, routeBEligible = false,
    hasWrites = false } = {}) => {
    if (routeAEligible) return hasWrites ? 'normalize-function-var-let' : 'normalize-function-var-const';

    if (routeBEligible) return 'lower-scope-entry-var-let';

    return 'unsupported-function-scoped-var';
};

// A binding default is a contract decision, never a formatter choice. Keep
// the evidence in one record so every lowering path makes the same decision.
const getBindingAgreement = ({
    state = '',
    canonical = '',
    kind = '',
    guarded = false,
    required = false,
    contradictory = false,
    owner = 'caller',
    evidence = []
} = {}) => {
    const normalizedEvidence = Array.isArray(evidence) ? evidence.filter(Boolean) : [];

    if (state === 'unknown' || state === 'contradictory') return {
        state, owner, evidence: normalizedEvidence, canonical: ''
    };

    if (state === 'preserve') return {
        state: kind === 'required' ? 'required' : 'caller-owned', owner, evidence: normalizedEvidence, canonical: ''
    };

    if (contradictory) return { state: 'contradictory', owner, evidence: normalizedEvidence, canonical: '' };

    if (canonical) return { state: 'known', owner, evidence: normalizedEvidence, canonical };

    // S-11: an unguarded any/unknown boundary stays required even though its
    // evidence reads as caller-owned.
    if (required || kind === 'required') return { state: 'required', owner, evidence: normalizedEvidence, canonical: '' };

    if (guarded || kind === 'union') return { state: 'guarded', owner, evidence: normalizedEvidence, canonical: '' };

    return { state: 'caller-owned', owner, evidence: normalizedEvidence, canonical: '' };
};

// Every member-lowering path reaches this translator before it can choose a
// default or an exception. Unknown evidence intentionally remains unknown:
// it is not a convenient object, array, or preservation certificate.
const getBindingContract = ({
    checkerContract = {},
    resolverBranch = {},
    declarationMember = {},
    guardEvidence = ''
} = {}) => {
    const {
        canonical: checkerCanonical = '', kind: checkerKind = '', optional: checkerOptional = false
    } = checkerContract;
    const {
        kind: resolverKind = '', action: resolverAction = '', presence: resolverPresence = ''
    } = resolverBranch;
    const { questionToken = false } = declarationMember;
    const optional = Boolean(checkerOptional || questionToken);
    const kind = resolverAction === 'preserve' && resolverKind === 'any'
        ? 'any'
        : checkerKind || resolverKind;
    const presence = resolverPresence || (guardEvidence ? 'discriminated' : 'unknown');

    if (kind === 'any') return {
        state: 'preserve', kind, owner: 'caller',
        evidence: ['unmatched resolver input preserves original value']
    };

    if (['string', 'number', 'boolean', 'bigint', 'array', 'object'].includes(kind) && optional && checkerCanonical) {
        return { state: 'known', canonical: checkerCanonical, kind, owner: 'typed-producer', evidence: [guardEvidence].filter(Boolean) };
    }

    if (presence === 'discriminated' && !checkerCanonical) return {
        state: 'preserve', kind: kind || 'generic', owner: 'model-producer',
        evidence: ['discriminant proves field presence; payload remains caller-owned']
    };

    if (kind === 'function' || kind === 'required') return {
        state: 'preserve', kind: 'required', owner: 'typeclass-factory',
        evidence: ['required factory field preserves source missing-container failure']
    };

    if (kind === 'generic') return {
        state: 'preserve', kind, owner: 'caller', evidence: ['generic payload preserves exact source value']
    };

    if (kind) return {
        state: 'preserve', kind: 'required', owner: 'typed-producer',
        evidence: ['required typed field keeps its native Get and failure']
    };

    return { state: 'unknown', kind: 'unknown', owner: 'caller', evidence: [] };
};

// A callback consumer can establish the operation it needs without turning a
// function field into an invented implementation. The enclosing return still
// owns the falsifiable response when the capability is absent.
const getConsumerBindingAgreement = ({
    binding = {},
    result = {}
} = {}) => {
    const { kind = '', required = false } = binding;
    const { canonical = '' } = result;

    if (kind === 'function' && required && canonical) return {
        action: 'guard-function',
        canonical,
        evidence: ['resolved callback consumer requires a callable argument']
    };

    if (kind === 'function' && required) return {
        action: 'preserved-function',
        canonical: '',
        evidence: ['callback consumer is known but enclosing return has no falsifiable agreement']
    };

    return { action: 'retain', canonical: '', evidence: [] };
};

// A direct provider capability call has a complete local response even when
// its returned value has no canonical family: the function itself owns a bare
// return on callability disagreement.  This is deliberately distinct from a
// forwarded callback, whose enclosing consumer must provide D(result).
const getDirectCapabilityAgreement = ({ capability = {} } = {}) => {
    const {
        action = '', guard = '', receiver = '', member = '', evidence = []
    } = capability;

    if (action !== 'guard-function-undefined' || guard !== 'function' || !receiver || !member) return {
        action: 'retain', evidence: []
    };

    return {
        action,
        guard,
        fallback: 'undefined',
        evidence
    };
};

// Returning a canonical value for malformed tuple input changes observable
// execution. Neither a declared tuple nor a return family proves that rewrite.
const getTupleConsumerAgreement = ({ consumer: { evidence = false, runtimeEvidence = false, sourceOrigins = false } = {} } = {}) => ({
    action: 'preserve-native-tuple',
    canonical: '',
    guard: '',
    evidence: evidence || ['tuple iteration and parameter initialization remain native'],
    ...(runtimeEvidence ? { runtimeEvidence, sourceOrigins } : {})
});

// Policy consumes the normalized transformer evidence rather than asking each
// lowering pass to reinterpret a checker record.  This is intentionally a
// translator: collection happens in Understand, while Grammar decides how an
// accepted result is emitted at its source-time consumer.
const getDestructuringAgreement = ({ entry = {} } = {}) => {
    const {
        kind = '', contract = {}, owner = 'boundary', grammar = 'retain-named-boundary',
        theorem = 'named-boundary', sourceRange = '', relatedRanges = []
    } = entry;
    const complete = (decision = {}) => ({
        ...decision,
        owner,
        grammar,
        theorem,
        sourceRange,
        relatedRanges: Array.isArray(relatedRanges) ? relatedRanges : []
    });

    if (['consumer', 'consumer-callback'].includes(kind)) {
        const { consumer = '' } = contract;
        const { callbackResult = {}, result: directResult = {} } = contract;
        const result = Object.keys(directResult).length ? directResult : callbackResult;

        return complete(['tuple-callback', 'tuple-function'].includes(consumer)
            ? getTupleConsumerAgreement({ consumer: contract })
            : getConsumerBindingAgreement({ binding: getObject(contract).binding, result }));
    }

    if (kind === 'direct-capability') return complete(getDirectCapabilityAgreement({ capability: contract }));

    if (['callable-operation', 'callable-operation-placement'].includes(kind)) return complete({
        action: getObject(contract).action === 'retain-callable-operation' ? 'retain-callable-operation' : 'retain',
        rules: (getObject(contract).argumentReadRanges || []).length ? ['resilient/prefer-destructured-member-access'] : [],
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'sort-capability') return complete({
        action: getObject(contract).action || 'retain',
        guard: getObject(contract).guard || '',
        fallback: getObject(getObject(contract).dialectAnswer).response || '',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'provider-forward') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'provider-edge') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'closed-provider-model') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'closed-structural-model') return complete({
        action: getObject(contract).action || 'retain',
        canonical: getObject(contract).canonical || '',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'exact-callback-projection') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'factory-required-binding') return complete({
        action: 'preserve-required-factory-binding',
        requiredProperties: getObject(contract).requiredProperties || [],
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'exact-provider-forward') return complete({
        action: getObject(contract).action || 'retain',
        canonical: getObject(contract).canonical || 'undefined',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'selected-model-read') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'collection-reconstruction') return complete(getCollectionReconstructionAgreement(contract));

    if (kind === 'callable-provider-dispatch') return complete({
        action: getObject(contract).action || 'retain-provider-dispatch',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'same-phase-selected-binding') return complete({
        action: getObject(contract).action || 'bind-at-source-phase',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'deferred-signature-selection') return complete({
        action: getObject(contract).action || 'retain-deferred-signature-selection',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'native-class-boundary') return complete({
        action: getObject(contract).action || 'retain-native-class-boundary',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'ordered-decision') return complete({
        action: getObject(contract).action || 'retain-ordered-decision',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'repeated-parameter-read') return complete({
        action: 'retain-source-phase-read',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'declaration-lifetime') {
        const { evidence = [] } = getObject(contract);
        const action = getDeclarationLifetimeAction(getObject(contract));

        return complete({ action, evidence });
    }

    if (kind === 'declaration-lifetime-reference') return complete({
        action: 'retain-function-scoped-var-reference',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'native-function-capability') {
        const { capabilities = [], evidence = [] } = getObject(contract);
        const action = getNativeFunctionAction(getObject(contract));

        return complete({ action, capabilities, evidence });
    }

    if (kind === 'native-function-reference') return complete({
        action: 'retain-native-function-reference',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'hoisted-function-cycle') return complete({
        action: 'retain-hoisted-function',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'hoisted-function-reference') return complete({
        action: 'retain-hoisted-reference',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'console-effect') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'arity-signature-lowering') {
        const {
            directArgumentsDispatch = false,
            directEval = false,
            nativeCallableParameters = false,
            privateFunction = false,
            completeParameters = false,
            functionKindAction = '',
            protectedParameterUses = false,
            strictParameterSemantics = false,
            evidence = []
        } = getObject(contract);
        const admitted = directArgumentsDispatch && !directEval && nativeCallableParameters &&
            privateFunction && completeParameters &&
            ['already-expression', 'lower-native-function-expression'].includes(functionKindAction) &&
            protectedParameterUses && strictParameterSemantics;

        return complete({
            action: admitted ? 'lower-arity-from-source-facts' : 'retain-source-arity',
            evidence
        });
    }

    if (kind === 'arity-return-partition') return complete({
        action: getObject(contract).action || 'retain',
        rules: getObject(contract).rules || [],
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'arity-return-selector') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'switch-no-value-exit') return complete({
        action: getObject(contract).action || 'retain',
        rules: getObject(contract).rules || [],
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'switch-terminal-bare-return') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'nullish-abstract-equality') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'operational-object-builder') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'live-own-key-enumeration') return complete({
        action: getObject(contract).action || 'retain-live-own-key-enumeration',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'live-array-visitation') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'loop-carried-recurrence') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'numeric-range-builder') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'array-cardinality') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'required-tuple-binding') return complete({
        action: getObject(contract).action || 'retain',
        shape: getObject(contract).shape || {},
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'rest-array-fixed-selection') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'iterator-payload-local-binding') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'deferred-selected-payload-binding') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'deferred-opaque-field-binding') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'curried-selected-tuple-binding') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'receiver-ordered-projection') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'short-circuit-tuple-argument') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'ordered-nested-tuple-read') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'indexed-operation') return complete({
        action: getObject(contract).action || 'retain',
        operation: getObject(contract).operation || '',
        memberBoundary: getObject(contract).memberBoundary !== false,
        staticPosition: getObject(contract).staticPosition || false,
        statementRange: getObject(contract).statementRange || '',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'mutable-selected-loop-binding') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'indexed-local-staged-selection') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'unused-binding') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'typed-ignored-argument-call') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'resolved-source-call') return complete({
        action: getObject(contract).action || 'retain',
        rules: getObject(contract).rules || [],
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'declared-nullish-result') return complete({
        action: getObject(contract).action || 'retain',
        result: getObject(contract).result || '',
        evidence: getObject(contract).evidence || []
    });

    if (kind === 'detached-promise-forward') return complete({
        action: getObject(contract).action || 'retain',
        evidence: getObject(contract).evidence || []
    });

    return complete({ action: 'retain', evidence: [] });
};

// A lowering pass is allowed to consume a completed agreement, never to
// replace it with an unrelated binding decision.  The predicate is kept in
// Policy so member/final passes share the same boundary rather than growing
// their own lists of special cases.
const ownsStaticRead = ({ agreement = {} } = {}) => {
    const { action = '', grammar = '' } = agreement;

    return [
        'provider-forward',
        'exact-callback-projection',
        'guard-function-undefined',
        'guard-sort-capability',
        'preserve-native-tuple',
        'exact-structural-field',
        'exact-provider-forward',
        'selected-model-read',
        'single-collection-update',
        'fresh-copy-reconstruction',
        'fresh-collection-rebind',
        'materialized-collection-reduce',
        'operational-collection-builder',
        'operational-object-builder',
        'reducer-accumulator-rebind',
        'iterator-accumulator-rebind',
        'iterator-selected-tuple',
        'rest-array-fixed-selection',
        'rest-array-staged-selection',
        'rest-array-retained-index',
        'rest-array-retained-effect-order',
        'iterator-payload-local-binding',
        'iterator-payload-local-declaration',
        'deferred-opaque-field-binding',
        'retain-deferred-opaque-field-read',
        'mutable-selected-loop-binding',
        'indexed-local-staged-selection',
        'curried-selected-tuple-binding',
        'retain-receiver-ordered-projection',
        'retain-receiver-ordered-tuple-argument',
        'retain-ordered-nested-tuple-read',
        'retain-source-phase-read',
        'retain-callable-operation'
    ].includes(action) || [
        'identity-provider-forward',
        'exact-projection',
        'guarded-callable-consumer',
        'guarded-required-tuple',
        'closed-structural-model',
        'selected-model-binding',
        'collection-reconstruction'
    ].includes(grammar);
};

const getDefaultInitializer = ({ factory = {}, canonical = '', singleQuote = false } = {}) => {
    if (canonical === '{}') return factory.createObjectLiteralExpression([], false);

    if (canonical === "''") return factory.createStringLiteral('', singleQuote);

    if (canonical === '0') return factory.createNumericLiteral('0');

    if (canonical === 'false') return factory.createFalse();

    if (canonical === '0n') return factory.createBigIntLiteral('0');

    if (canonical === '[]') return factory.createArrayLiteralExpression([], false);

    if (canonical === 'void 0') return factory.createVoidExpression(factory.createNumericLiteral(0));

    // eslint-disable-next-line resilient/prefer-falsey-returns -- Unknown canonical form omits the compiler initializer; false changes omitted-field identity.
    return undefined;
};

const getMemberParameterDefault = ({ factory = {}, initializer = false, members = [] } = {}) => {
    if (initializer) return initializer;

    if (!members.length || !members.every(({ canonical = '', kind = '', guarded = false } = {}) => (
        ["''", '0', 'false', '0n'].includes(canonical) && kind !== 'array' && !guarded
    ))) {
        // eslint-disable-next-line resilient/prefer-falsey-returns -- Rejected aggregate default enters the parameter initializer slot as true compiler omission.
        return undefined;
    }

    return factory.createObjectLiteralExpression([], false);
};

const getRequiredDefaultInitializer = ({ typescript = {}, factory = {}, name = '' } = {}) => {
    const { EqualsGreaterThanToken = -1 } = getSyntaxKinds(typescript);
    const label = typeof name === 'string' ? name : 'dynamic member';
    const error = factory.createNewExpression(
        factory.createIdentifier('TypeError'),
        undefined,
        [factory.createStringLiteral(`Missing required agreement for ${label}`, true)]
    );
    const resolver = factory.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        factory.createToken(EqualsGreaterThanToken),
        factory.createBlock([factory.createThrowStatement(error)], true)
    );

    return factory.createCallExpression(factory.createParenthesizedExpression(resolver), undefined, []);
};

const getBindingDecision = ({ agreement = {} } = {}) => {
    const { state = 'contradictory' } = agreement;

    // Complete Policy before Grammar allocates nodes or publishes reports.
    // Preserve caller field Get order and explicit action overrides.
    return { state, action: state === 'known' ? 'default' : 'preserve', ...agreement };
};

const emitBindingAgreement = ({
    typescript = {}, factory = {}, decision = {}, name = '', sourceName = '', propertyName = '', singleQuote = false,
    agreements = new Set(), site = '', sourceNode = {}
} = {}) => {
    const { action = '', state = 'contradictory', owner = 'caller', evidence = [], canonical = '' } = decision;
    const record = {
        state,
        owner,
        evidence,
        canonical,
        name: name || sourceName || propertyName || 'source member',
        site,
        sourceRange: getSourceRange({ typescript, node: sourceNode }),
        action
    };
    const { name: recordName = '' } = record;
    let initializer;

    if (action === 'default') initializer = getDefaultInitializer({ factory, canonical, singleQuote });

    if (action === 'required') initializer = getRequiredDefaultInitializer({
        typescript,
        factory,
        name: recordName
    });

    // eslint-disable-next-line resilient/prefer-safe-transformations -- Shared Set publishes the exact returned record; copying loses caller-visible identity and order.
    if (action === 'preserve' && agreements instanceof Set) agreements.add(record);

    return { initializer, record };
};

// eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- An omitted emitted initializer stays undefined at the compiler factory boundary.
const getBindingInitializer = ({ initializer } = {}) => initializer;

const getAgreementDefaultInitializer = ({
    typescript = {}, factory = {}, decision = {}, name = '', sourceName = '', propertyName = '', singleQuote = false
} = {}) => {
    const emitted = emitBindingAgreement({
        typescript,
        factory,
        decision,
        name,
        sourceName,
        propertyName,
        singleQuote
    });

    return getBindingInitializer(emitted);
};

const annotateAgreementException = ({ typescript = {}, node = {}, reason = '' } = {}) => {
    const { SingleLineCommentTrivia = -1 } = getSyntaxKinds(typescript);
    const { addSyntheticLeadingComment } = typescript;

    if (!reason || !isFunction(addSyntheticLeadingComment)) return node;

    return typescript.addSyntheticLeadingComment(
        node,
        SingleLineCommentTrivia,
        ` eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- ${reason}`,
        true
    );
};

export {
    annotateAgreementException,
    emitBindingAgreement,
    getBindingInitializer,
    getBindingAgreement,
    getBindingContract,
    getDestructuringAgreement,
    getNativeFunctionAction,
    ownsStaticRead,
    getTupleConsumerAgreement,
    getBindingDecision,
    getAgreementDefaultInitializer,
    getDefaultInitializer,
    getMemberParameterDefault
};
