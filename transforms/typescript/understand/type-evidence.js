import { createSourceCensus, collectBindingReferences } from './source-census.js';
import {
    requireCompilerMember,
    isUnionType,
    primitiveKinds,
    getTypeText,
    getCanonical,
    getRuntimeKind,
    getAgreementReason,
    getFamilyCheck,
    getConstructorContract,
    getCheckerContract,
    getCheckerTypeNode,
    getLiteralCheck,
    getLiteralRuntimeKind,
    getName,
    getQualifiedName,
    getIdentifierName,
    getCallExpressionName,
    getCallIdentifierArgument,
    getDeclarationEntries,
    getDeclarationMap,
    getDeclarationEntry,
    getDeclaration,
    getProgramDeclarationMap,
    getDeclarationType,
    getLiteralNames,
    getTypeParameterBindings,
    applyTypeBindingsToMembers,
    setMemberOptionality,
    getTypeMembers,
    getMembers,
    getIndexedAccessMemberTypes,
    getObjectDiscriminator,
    getObjectPropertyNames,
    getObjectShapeCheck,
    isSyntheticObjectPart,
    getUnionParts,
    isNullType,
    isNaNType,
    isNeverType,
    isAbsenceType,
    expandUnionParts,
    getTypeParts,
    getResolverName,
    getAvailableResolverName,
    getEnclosingTypeParameter,
    getRuntimeName,
    resolveTypeInfo,
    getTypeInfo,
    getPropertySource,
    getPredicate,
    getUnionResolverSource
} from './type-resolution.js';
import { getOperationExpectation } from '../../../rules/contracts/infer.js';
import { contract, unknown } from '../../../rules/contracts/model.js';
import { resolveTupleCallbackReturn } from '../../../rules/contracts/tuple-return.js';
import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';
import { getChildren } from '../../utils/ast-traversal.js';
import { hasTypeChecker, isArrayLikeExpression } from '../../utils/compiler-shape.js';

const getConsumerContractKey = (node = {}) => {
    const { pos = -1, end = -1 } = getObject(node);

    return `${pos}:${end}`;
};

// Record lexical targets before rewriting. A local parameter with a matching
// spelling is not a forward reference to a later module binding. Missing
// checker evidence stays absent so programless placement remains conservative.
const collectRuntimeBindingReferenceFacts = ({ typescript = {}, sourceFile = {}, checker = {},
    runtimeBindingTargets = false,
    bindingReferences = collectBindingReferences({ typescript, sourceFile, checker }) } = {}) => {
    if (!hasTypeChecker(checker) || !(runtimeBindingTargets instanceof Map)) return new Map();

    return new Map([...bindingReferences].filter(([symbol = false] = []) => symbol).flatMap(([symbol = false, references = []] = []) => (
        references.map(reference => [getConsumerContractKey(reference), runtimeBindingTargets.get(symbol) || ''])
    )));
};

// Direct capability calls have a smaller agreement than callback forwarding:
// the provider owns the callable field, while the enclosing function owns the
// natural undefined exit when it is not callable.  Keep this collector narrow
// until a later grammar can represent side-effecting arguments and receiver
// protocols without changing their evaluation semantics.
const collectDirectCapabilityContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        SyntaxKind: {
            CallExpression = -1,
            PropertyAccessExpression = -1,
            Identifier = -1,
            ReturnStatement = -1,
            ExpressionStatement = -1,
            ArrowFunction = -1,
            FunctionExpression = -1,
            FunctionDeclaration = -1,
            StringLiteral = -1,
            NumericLiteral = -1,
            TrueKeyword = -1,
            FalseKeyword = -1,
            NullKeyword = -1,
            SpreadElement = -1,
            PropertySignature = -1,
            PropertyDeclaration = -1
        } = {}
    } = typescript;
    const { getResolvedSignature = false } = getObject(checker);
    const functionKinds = [ArrowFunction, FunctionExpression, FunctionDeclaration];
    const inertArgumentKinds = new Set([
        Identifier,
        StringLiteral,
        NumericLiteral,
        TrueKeyword,
        FalseKeyword,
        NullKeyword
    ]);
    let candidates = [];
    let unplacedCalls = new Set();
    const getEnclosingFunction = (node = {}) => {
        const { parent: nodeParent = {} } = getObject(node);
        let current = nodeParent;
        let depth = 0;

        // Compiler roots may retain a parent cycle. A function ancestor is
        // necessarily close in a source AST, so a fixed bound is both the
        // correct grammar boundary and prevents analysis from escaping the
        // local source tree.
        // eslint-disable-next-line resilient/prefer-prototype-methods -- Bounded ancestor traversal skips terminal parent Get and stops parent cycles at 64.
        while (current && depth < 64) {
            if (functionKinds.includes(getObject(current).kind)) return current;

            const { parent: currentParent = {} } = getObject(current);

            current = currentParent;
            depth += 1;
        }

        return {};
    };
    const hasProviderParameter = ({ functionNode = {}, receiver = {} } = {}) => {
        const { parameters = [] } = getObject(functionNode);
        const { text: receiverName = '' } = getObject(receiver);

        return parameters.some(({ name = {}, type = {} } = {}) => {
            const { kind = 0, text = '' } = getObject(name);
            const { kind: typeKind = 0 } = getObject(type);

            // This prefilter is intentionally lexical. A same-scope parameter
            // cannot be shadowed without a nested function, and nested calls
            // are rejected by getEnclosingFunction. Requiring a written type
            // keeps ordinary inferred callback receivers (for example Date
            // methods inside a comparator) out of this provider-only path.
            // The checker remains authority for the callable contract below.
            return kind === Identifier && text === receiverName && !!typeKind;
        });
    };
    const isObjectReceiver = (receiver = {}) => {
        const { getTypeAtLocation = false, isArrayType = false, isTupleType = false } = getObject(checker);
        const { TypeFlags: { Object: ObjectFlags = 0, Undefined = 0, Null = 0 } = {} } = typescript;

        if (typeof getTypeAtLocation !== 'function') return false;

        const type = getTypeAtLocation.call(checker, receiver);
        const { types = [] } = getObject(type);
        const parts = Array.isArray(types) && types.length ? types : [type];
        const defined = parts.filter(({ flags: partFlags = 0 } = {}) => !(partFlags & (Undefined | Null)));

        return !!defined.length && defined.every((part = {}) => {
            const { flags: partFlags = 0 } = getObject(part);
            const array = typeof isArrayType === 'function' && isArrayType.call(checker, part);
            const tuple = typeof isTupleType === 'function' && isTupleType.call(checker, part);

            return !!(partFlags & ObjectFlags) && !array && !tuple;
        });
    };
    const visit = (node = {}) => {
        const { kind = 0, expression: callee = {}, arguments: args = {}, parent = {}, questionDotToken: optionalCall = false } = getObject(node);
        const { kind: calleeKind = 0, expression: receiver = {}, name = {}, questionDotToken: optionalRead = false } = getObject(callee);
        const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);
        const { text: member = '' } = getObject(name);

        if (kind !== CallExpression || calleeKind !== PropertyAccessExpression || receiverKind !== Identifier ||
            optionalCall || optionalRead ||
            !receiverName || !member) {
            return;
        }

        const { kind: parentKind = 0 } = getObject(parent);
        const functionNode = getEnclosingFunction(node);
        const directHost = parentKind === ReturnStatement || parentKind === ExpressionStatement ||
            (getObject(functionNode).body === node && getObject(functionNode).kind === ArrowFunction);
        const argumentsList = Array.isArray(args) ? args : [];
        const argumentsAreInert = argumentsList.every((argument = {}) => {
            const { kind: argumentKind = 0 } = getObject(argument);

            return argumentKind !== SpreadElement && inertArgumentKinds.has(argumentKind);
        });

        if (!directHost || !argumentsAreInert || !hasProviderParameter({ functionNode, receiver })) {
            return;
        }

        if (!isObjectReceiver(receiver)) {
            return;
        }

        const signature = kind === CallExpression && typeof getResolvedSignature === 'function'
            ? getObject(getResolvedSignature.call(checker, node))
            : {};
        const { thisParameter = false, declaration: signatureDeclaration = {} } = signature;
        const { kind: declarationKind = 0 } = getObject(signatureDeclaration);
        const { parent: signatureParent = {} } = getObject(signatureDeclaration);
        const { kind: signatureParentKind = 0 } = getObject(signatureParent);
        const providerProperty = [PropertySignature, PropertyDeclaration].includes(declarationKind) ||
            [PropertySignature, PropertyDeclaration].includes(signatureParentKind);

        if (!providerProperty) {
            return;
        }

        const callable = getCheckerContract({ typescript, node: callee, checker });
        const { kind: callableKind = '', optional = false } = callable;

        if (!thisParameter && callableKind === 'function' && !optional) {
            // The consumer replaces only direct block siblings or an arrow's
            // expression body. Count other candidates for the one-call law,
            // but do not publish a guard decision that no grammar path owns.
            const { body: functionBody = {} } = getObject(functionNode);
            const { parent: statementParent = {} } = getObject(parent);
            const grammarOwned = functionBody === node || statementParent === functionBody;

            unplacedCalls = grammarOwned ? unplacedCalls : new Set([...unplacedCalls, getConsumerContractKey(node)]);

            candidates = [...candidates, {
                key: getConsumerContractKey(callee),
                functionKey: getConsumerContractKey(functionNode),
                callKey: getConsumerContractKey(node),
                receiver: receiverName,
                member,
                action: 'guard-function-undefined',
                guard: 'function',
                evidence: [
                    'checker proves a required callable provider field',
                    'resolved call signature has no receiver parameter',
                    'direct call has inert arguments and owns a natural undefined exit'
                ]
            }];
        }
    };

    census.select(CallExpression).forEach(visit);
    const counts = candidates.reduce((result = new Map(), { functionKey = '' } = {}) => (
        new Map([...result, [functionKey, (result.get(functionKey) || 0) + 1]])
    ), new Map());

    return new Map(candidates
        .filter(({ functionKey = '', callKey = '' } = {}) => counts.get(functionKey) === 1 && !unplacedCalls.has(callKey))
        .map(({ key = '', ...contractRecord } = {}) => [key, contractRecord]));
};

// Native-shaped names do not make an object field a native array operation.
// Retain its actual call, rather than moving a getter or replacing `.call`'s
// own observable property lookup. The source unit also owns collision safety:
// a local directive cannot hide an unproved operation on that same unit.
const collectCallableOperationContracts = ({
    typescript = {}, sourceFile = {}, checker = {}, directCapabilityContracts = new Map(), closedStructuralModels = new Map(), census = createSourceCensus({ typescript, sourceFile })
} = {}) => {
    const { getSymbolAtLocation = false } = checker;

    if (!hasTypeChecker(checker) || typeof getSymbolAtLocation !== 'function') return new Map();

    const { PropertyAccessExpression = -1, ElementAccessExpression = -1, Identifier = -1, CallExpression = -1,
        ReturnStatement = -1, ExpressionStatement = -1, VariableStatement = -1, IfStatement = -1,
        ArrowFunction = -1, FunctionExpression = -1, FunctionDeclaration = -1,
        Block = -1, Parameter = -1, VariableDeclaration = -1, NamespaceImport = -1 } = getSyntaxKinds(typescript);
    const functionKinds = [ArrowFunction, FunctionExpression, FunctionDeclaration];
    const statementKinds = [ReturnStatement, ExpressionStatement, VariableStatement, IfStatement];
    let candidates = [];
    let blockedUnits = new Set();
    const getProtectedBindings = (node = {}, localScopes = []) => {
        const { kind = 0, pos = -1, end = -1 } = getObject(node);
        const scopes = functionKinds.includes(kind) ? [...localScopes, { pos, end }] : localScopes;

        const symbol = kind === Identifier ? checker.getSymbolAtLocation(node) : {};
        const { declarations = [] } = getObject(symbol);
        const ownBindings = declarations.filter((declaration) => {
            const { kind: declarationKind = 0, pos: declarationPos = -1, end: declarationEnd = -1 } = getObject(declaration);
            const local = scopes.some(({ pos: scopePos = -1, end: scopeEnd = -1 } = {}) => (
                declarationPos >= scopePos && declarationEnd <= scopeEnd
            ));

            return [Parameter, VariableDeclaration].includes(declarationKind) && declaration.getSourceFile() === sourceFile && !local;
        });
        let nested = [];
        typescript.forEachChild(node, (child) => { nested = [...nested, ...getProtectedBindings(child, scopes)]; });

        return [...ownBindings, ...nested];
    };
    const getArgumentReads = (node = {}) => {
        const { kind = 0, parent = {} } = getObject(node);

        const { kind: parentKind = 0, expression: callee = {} } = getObject(parent);
        const member = [PropertyAccessExpression, ElementAccessExpression].includes(kind);

        const ownReads = member && !(parentKind === CallExpression && callee === node) ? [node] : [];
        let nested = [];
        typescript.forEachChild(node, (child) => { nested = [...nested, ...getArgumentReads(child)]; });

        return [...ownReads, ...nested];
    };
    const visitOperation = (node = {}, owner = {}, enclosingUnits = [], phaseOwner = {}) => {
        const { kind = 0, body = {}, expression = {}, name = {}, parent = {}, questionDotToken = false } = getObject(node);

        if (kind === Parameter) return;

        const functionOwner = kind === ArrowFunction && getObject(body).kind !== Block ? body : {};
        const currentOwner = statementKinds.includes(kind) ? node : owner;
        const unit = functionKinds.includes(kind) ? functionOwner : currentOwner;
        const currentPhase = functionKinds.includes(kind) ? node : phaseOwner;
        const { kind: receiverKind = 0, text: receiver = '' } = getObject(expression);
        const { text: member = '' } = getObject(name);
        const placementRange = getConsumerContractKey(unit);
        const boundaryUnits = !placementRange || enclosingUnits.includes(placementRange)
            ? enclosingUnits : [...enclosingUnits, placementRange];
        const expectation = kind === PropertyAccessExpression ? getOperationExpectation({ method: member }) : '';

        if (!expectation || !placementRange) {
            return;
        }

        const { kind: receiverFamily = '', optional: receiverOptional = false } = getCheckerContract({
            typescript, node: expression, checker
        });
        const { kind: memberFamily = '' } = getCheckerContract({ typescript, node, checker });
        const { declarations: receiverDeclarations = [] } = getObject(
            receiverKind === Identifier ? checker.getSymbolAtLocation(expression) : {}
        );
        const namespaceReceiver = receiverDeclarations.some(declaration => getObject(declaration).kind === NamespaceImport);
        const { kind: parentKind = 0, expression: parentExpression = {}, questionDotToken: optionalCall = false,
            arguments: argumentsList = [] } = getObject(parent);
        const callableMember = !namespaceReceiver && receiverKind === Identifier && !['', 'array', 'required', 'unknown'].includes(receiverFamily) && !receiverOptional &&
            memberFamily === 'function' && ['map', 'reduce', 'filter'].includes(member) &&
            parentKind === CallExpression && parentExpression === node && !questionDotToken && !optionalCall;
        const sourceRange = getConsumerContractKey(node);
        const { kind: unitKind = 0, pos: placementStart = -1, end: placementEnd = -1 } = getObject(unit);
        const unsupportedPlacement = unitKind === IfStatement;
        const argumentReads = callableMember ? argumentsList.flatMap(getArgumentReads) : [];
        const modelReads = argumentReads.filter(read => closedStructuralModels.has(getConsumerContractKey(read)));
        const protectArguments = !modelReads.length;
        const mixedOwners = modelReads.length && modelReads.length !== argumentReads.length;
        const argumentBindings = callableMember && protectArguments ? argumentsList.flatMap(argument => getProtectedBindings(argument)) : [];
        const foreignArgumentBinding = argumentBindings.some((binding) => {
            const { kind: bindingKind = 0, parent: bindingOwner = {} } = getObject(binding);

            return bindingKind === Parameter && bindingOwner !== currentPhase;
        });

        if (callableMember && !unsupportedPlacement && !mixedOwners && !foreignArgumentBinding && !directCapabilityContracts.has(sourceRange)) candidates = [...candidates, {
            sourceRange, placementRange, placementStart, placementEnd, callKey: getConsumerContractKey(parent), receiver, member,
            action: 'retain-callable-operation',
            protectArguments,
            argumentRead: protectArguments && Boolean(argumentReads.length),
            protectedBindings: [...new Set([...getProtectedBindings(expression), ...argumentBindings].map(getConsumerContractKey))],
            evidence: ['declared callable retains Get, receiver, argument order and native failure']
        }];

        // A printer can leave a deferred arrow on its enclosing call's line.
        // Do not let that call's directive hide a nested unproved operation.
        if (!namespaceReceiver && receiverFamily !== expectation && (!callableMember || unsupportedPlacement || mixedOwners || foreignArgumentBinding)) {
            blockedUnits = new Set([...blockedUnits, ...boundaryUnits]);
        }
    };
    census.select(PropertyAccessExpression).forEach((node) => {
        const ancestors = census.ancestors(node);

        if (ancestors.some(ancestor => getObject(ancestor).kind === Parameter)) return;

        const context = ancestors.toReversed().reduce(({ owner = {}, enclosingUnits = [], phaseOwner = {} } = {}, ancestor = {}) => {
            const { kind = 0, body = {} } = getObject(ancestor);
            const functionOwner = kind === ArrowFunction && getObject(body).kind !== Block ? body : {};
            const currentOwner = statementKinds.includes(kind) ? ancestor : owner;
            const unit = functionKinds.includes(kind) ? functionOwner : currentOwner;
            const range = getConsumerContractKey(unit);

            return {
                owner: unit,
                enclosingUnits: !range || enclosingUnits.includes(range) ? enclosingUnits : [...enclosingUnits, range],
                phaseOwner: functionKinds.includes(kind) ? ancestor : phaseOwner
            };
        }, {});
        const { owner = {}, enclosingUnits = [], phaseOwner = {} } = context;
        visitOperation(node, owner, enclosingUnits, phaseOwner);
    });
    const scopedCandidates = candidates.filter(({ argumentRead = false } = {}) => argumentRead);
    const nestedScopes = new Set(scopedCandidates.filter(({
        placementRange = '', placementStart = -1, placementEnd = -1
    } = {}) => scopedCandidates.some(({
        placementRange: otherRange = '', placementStart: otherStart = -1, placementEnd: otherEnd = -1
    } = {}) => otherRange !== placementRange && placementStart < otherEnd && otherStart < placementEnd))
        .map(({ placementRange = '' } = {}) => placementRange));

    return new Map(candidates.filter(({ placementRange = '' } = {}) => !blockedUnits.has(placementRange) && !nestedScopes.has(placementRange))
        .flatMap(record => [getObject(record).sourceRange, getObject(record).callKey, getObject(record).placementRange,
            ...getObject(record).protectedBindings].map(key => [key, record])));
};

// A callable provider field is not a defaulting decision at its binding. Its
// contract becomes executable at the first static consumer that actually
// needs callability. This collector owns the narrow collection-ordering form
// and keeps the binding symbol/range stable across later AST reconstruction.
const collectSortCapabilityContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        SyntaxKind: {
            ArrowFunction = -1,
            Block = -1,
            CallExpression = -1,
            FunctionDeclaration = -1,
            FunctionExpression = -1,
            Identifier = -1,
            ObjectBindingPattern = -1,
            PropertyAccessExpression = -1,
            ReturnStatement = -1,
            ConditionalExpression = -1,
            AsExpression = -1,
            ParenthesizedExpression = -1,
            NonNullExpression = -1
        } = {},
        TypeFlags: { Undefined = 0, Null = 0 } = {}
    } = typescript;
    const {
        getSymbolAtLocation = false,
        getTypeAtLocation = false,
        typeToString = false,
        isArrayType = false,
        isTupleType = false
    } = getObject(checker);
    const functionKinds = [ArrowFunction, FunctionDeclaration, FunctionExpression];
    let bindingEntries = [];
    let candidateEntries = [];
    let useEntries = [];
    let bindings = new Map();
    const getEnclosingFunction = (node = {}) => {
        const { functionNode = {} } = Array.from({ length: 64 }).reduce(({
            current = {}, found = false, functionNode: previous = {}
        } = {}) => {
            const { parent = {} } = getObject(current);
            const { kind = 0 } = getObject(parent);
            const nextFound = found || functionKinds.includes(kind);

            return {
                current: parent,
                found: nextFound,
                functionNode: nextFound && !found ? parent : previous
            };
        }, { current: node, found: false, functionNode: {} });

        return functionNode;
    };
    const getTransparentExpression = (node = {}) => {
        const { kind = 0, expression = {} } = getObject(node);

        return [AsExpression, ParenthesizedExpression, NonNullExpression].includes(kind)
            ? getTransparentExpression(expression)
            : node;
    };
    const getTransparentParent = (node = {}) => {
        const { parent = {} } = getObject(node);
        const { kind = 0 } = getObject(parent);

        return [AsExpression, ParenthesizedExpression, NonNullExpression].includes(kind)
            ? getTransparentParent(parent)
            : parent;
    };
    const isStaticKeysReceiver = (node = {}) => {
        const candidate = getTransparentExpression(node);
        const { kind = 0, expression = {}, arguments: args = [] } = getObject(candidate);
        const { kind: expressionKind = 0, expression: owner = {}, name = {} } = getObject(expression);
        const { kind: ownerKind = 0, text: ownerName = '' } = getObject(owner);
        const { text: member = '' } = getObject(name);

        return kind === CallExpression && expressionKind === PropertyAccessExpression &&
            ownerKind === Identifier && ownerName === 'Object' && member === 'keys' && args.length === 1;
    };
    const isArrayReceiver = (node = {}) => {
        if (isStaticKeysReceiver(node)) return true;

        if (typeof getTypeAtLocation !== 'function') return false;

        const type = getTypeAtLocation.call(checker, getTransparentExpression(node));
        const { types = [] } = getObject(type);
        const parts = Array.isArray(types) && types.length ? types : [type];
        const defined = parts.filter(({ flags = 0 } = {}) => !(flags & (Undefined | Null)));
        const typeText = typeof typeToString === 'function' ? typeToString.call(checker, type) : '';
        const isKnownNonEmptyArray = /^(?:Readonly)?NonEmptyArray(?:<|$)/.test(typeText);

        return isKnownNonEmptyArray || !!defined.length && defined.every(part => (
            typeof isArrayType === 'function' && isArrayType.call(checker, part) ||
            typeof isTupleType === 'function' && isTupleType.call(checker, part)
        ));
    };
    const getPlacement = ({ call = {}, functionNode = {} } = {}) => {
        const parent = getTransparentParent(call);
        const { kind: parentKind = 0, whenTrue = {}, whenFalse = {} } = getObject(parent);
        const { body = {} } = getObject(functionNode);
        const bodyExpression = getTransparentExpression(body);

        if (bodyExpression === call) return 'expression';

        const branch = body === parent && parentKind === ConditionalExpression
            ? [{ node: whenTrue, placement: 'conditional-true' }, { node: whenFalse, placement: 'conditional-false' }]
                .find(({ node: branchNode = {} } = {}) => getTransparentExpression(branchNode) === call) || {}
            : {};
        const { placement = '' } = branch;

        if (placement) return placement;

        return parentKind === ReturnStatement && getObject(body).kind === Block &&
            getObject(parent).parent === body ? 'return' : '';
    };
    const collectBindings = (node = {}) => {
        const { kind = 0, parameters = [] } = getObject(node);

        if (functionKinds.includes(kind)) parameters.forEach(({ name = {} } = {}) => {
            const { kind: nameKind = 0, elements = [] } = getObject(name);

            // fp-ts normally writes the capability at its provider boundary
            // (`O.compare`), then parameter lowering owns the later
            // `{ compare: OCompare }` spelling.  Keep the source provider
            // symbol here; placement resolves the post-lowering alias from
            // the original call node.
            const providerSymbol = nameKind === Identifier && typeof getSymbolAtLocation === 'function'
                ? getSymbolAtLocation.call(checker, name)
                : false;

            if (providerSymbol) {
                bindingEntries = [...bindingEntries, [providerSymbol, {
                    provider: true,
                    bindingNode: name,
                    sourceRange: getConsumerContractKey(name)
                }]];

                return;
            }

            if (nameKind !== ObjectBindingPattern) return;

            elements.forEach((element = {}) => {
                const { name: aliasNode = {}, propertyName = {} } = getObject(element);
                const { kind: aliasKind = 0, text: alias = '' } = getObject(aliasNode);
                const { text: property = '' } = getObject(propertyName);
                const symbol = typeof getSymbolAtLocation === 'function'
                    ? getSymbolAtLocation.call(checker, aliasNode)
                    : false;
                const callable = getCheckerContract({ typescript, node: aliasNode, checker });
                const { kind: callableKind = '', optional = false } = callable;

                if (aliasKind === Identifier && alias && symbol && callableKind === 'function' && !optional) {
                    bindingEntries = [...bindingEntries, [symbol, {
                        alias,
                        bindingNode: aliasNode,
                        member: property || alias,
                        sourceRange: getConsumerContractKey(aliasNode)
                    }]];
                }
            });
        });
    };
    const collectCandidates = (node = {}) => {
        const { kind = 0, expression: callee = {}, arguments: args = [], questionDotToken: optionalCall = false } = getObject(node);
        const { kind: calleeKind = 0, expression: receiver = {}, name = {}, questionDotToken: optionalConsumer = false } = getObject(callee);
        const [argument = {}] = args;
        const {
            kind: argumentKind = 0,
            text: alias = '',
            expression: argumentReceiver = {},
            name: argumentName = {},
            questionDotToken: optionalCapability = false
        } = getObject(argument);
        const { kind: argumentReceiverKind = 0, text: provider = '' } = getObject(argumentReceiver);
        const { text: providerMember = '' } = getObject(argumentName);
        const { text: member = '' } = getObject(name);
        let symbol = false;

        if (argumentKind === Identifier && typeof getSymbolAtLocation === 'function') {
            symbol = getSymbolAtLocation.call(checker, argument);
        }

        if (argumentKind === PropertyAccessExpression && argumentReceiverKind === Identifier &&
            typeof getSymbolAtLocation === 'function') {
            symbol = getSymbolAtLocation.call(checker, argumentReceiver);
        }

        const binding = bindings.get(symbol);
        const { provider: isProvider = false } = getObject(binding);
        const callable = getCheckerContract({ typescript, node: argument, checker });
        const { kind: callableKind = '', optional = false } = callable;

        const functionNode = getEnclosingFunction(node);
        const placement = getPlacement({ call: node, functionNode });
        const isBoundAlias = argumentKind === Identifier && binding && !isProvider;
        const isProviderField = argumentKind === PropertyAccessExpression && !optionalCapability && binding && isProvider &&
            provider && providerMember;
        const candidate = kind === CallExpression && calleeKind === PropertyAccessExpression &&
            !optionalCall && !optionalConsumer &&
            ['sort', 'toSorted', 'reduce'].includes(member) && args.length === 1 && (isBoundAlias || isProviderField) &&
            callableKind === 'function' && !optional && isArrayReceiver(receiver) && placement
            ? {
                binding,
                call: node,
                callKey: getConsumerContractKey(node),
                functionKey: getConsumerContractKey(functionNode),
                placement,
                alias,
                provider,
                providerMember,
                memberRange: getConsumerContractKey(argument)
            }
            : false;

        if (candidate) candidateEntries = [...candidateEntries, candidate];
    };
    const collectUses = (node = {}) => {
        const { kind = 0 } = getObject(node);
        const symbol = kind === Identifier && typeof getSymbolAtLocation === 'function'
            ? getSymbolAtLocation.call(checker, node)
            : false;

        if (bindings.has(symbol)) useEntries = [...useEntries, [symbol, node]];
    };

    if (typeof getSymbolAtLocation !== 'function') return new Map();

    census.select(...functionKinds).forEach(collectBindings);
    bindings = new Map(bindingEntries);
    census.select(CallExpression).forEach(collectCandidates);
    census.select(Identifier).forEach(collectUses);
    const uses = new Map([...bindings.keys()].map(symbol => [
        symbol,
        useEntries.filter(([candidateSymbol = false] = []) => candidateSymbol === symbol)
            .map(([, node = {}] = []) => node)
    ]));

    return new Map(candidateEntries.filter(({ binding = {}, call = {} } = {}) => {
        const { bindingNode = {} } = binding;
        const symbol = getSymbolAtLocation.call(checker, bindingNode);
        const knownUses = uses.get(symbol) || [];
        const { arguments: callArguments = [] } = getObject(call);
        const [argument = {}] = callArguments;

        const { provider: isProvider = false } = getObject(binding);

        if (!isProvider) return knownUses.every(use => use === bindingNode || use === argument);

        return knownUses.every((use = {}) => use === bindingNode ||
            getObject(use).parent === argument && getObject(argument).expression === use);
    }).map(({ binding = {}, callKey = '', functionKey = '', placement = '', alias = '', provider = '', providerMember = '', memberRange = '' } = {}) => {
        const { sourceRange = '', member = '' } = binding;
        const resolvedMember = member || providerMember;

        return [callKey, {
            key: callKey,
            callKey,
            source: {
                range: sourceRange,
                shape: 'required-callable-provider-field',
                provider,
                member: resolvedMember,
                memberRange
            },
            consumer: {
                kind: 'collection-callable',
                range: callKey,
                prerequisites: ['evaluate-sort-receiver-once-before-callability-guard']
            },
            dialectAnswer: { predicate: 'function', response: 'undefined', owner: 'consumer' },
            translationLaw: 'static-collection-capability',
            grammarPlacement: placement,
            functionKey,
            alias,
            action: 'guard-sort-capability',
            guard: 'function',
            evidence: [
                'checker proves a required callable provider field',
                'checker proves a static array callback consumer',
                'the bound capability has one static consumer and natural undefined disagreement ownership'
            ]
        }];
    }));
};

const getCheckerValueContract = ({ typescript = {}, node = {}, checker = {} } = {}) => {
    const existing = getCheckerContract({ typescript, node, checker });
    const { canonical = '' } = existing;

    if (canonical) return existing;

    const { getTypeAtLocation = false } = getObject(checker);
    const { TypeFlags = {} } = typescript;
    const { StringLike = 0, NumberLike = 0, BooleanLike = 0, BigIntLike = 0 } = TypeFlags;

    if (typeof getTypeAtLocation !== 'function') return {};

    const type = getTypeAtLocation.call(checker, node);
    const { flags = 0 } = getObject(type);
    const families = [
        { mask: StringLike, kind: 'string' },
        { mask: NumberLike, kind: 'number' },
        { mask: BooleanLike, kind: 'boolean' },
        { mask: BigIntLike, kind: 'bigint' }
    ];
    const matchingFamily = families.find(({ mask = 0 } = {}) => Boolean(mask) && Boolean(flags & mask));
    const { kind = '' } = getObject(matchingFamily);

    return kind ? { kind, canonical: getCanonical(kind) } : {};
};

const getTupleReturnCheckerContract = ({ typescript = {}, node = {}, checker = {} } = {}) => {
    const direct = getCheckerValueContract({ typescript, node, checker });
    const { kind = '' } = direct;

    if (kind) return contract({ kind });

    const { getTypeAtLocation = false, isArrayType = false, isTupleType = false } = getObject(checker);

    if (typeof getTypeAtLocation !== 'function') return unknown();

    const type = getTypeAtLocation.call(checker, node);
    const { getCallSignatures = false } = getObject(type);
    const isArray = (typeof isArrayType === 'function' && isArrayType.call(checker, type)) ||
        (typeof isTupleType === 'function' && isTupleType.call(checker, type));

    if (isArray) return contract({ kind: 'array' });

    if (typeof getCallSignatures === 'function' && getCallSignatures.call(type).length) return contract({ kind: 'function' });

    return unknown();
};

// An effect can own a malformed required-tuple response only when the checker
// proves the callback result is that outer effect around a tuple and its
// receiver supplies `of`. Merely knowing that a callback returns M<A> says
// nothing about D(A), even when its body happens to contain a call.
const getLiftedTupleEffectResolver = ({ typescript = {}, call = {}, callbackSignature = {}, checker = {} } = {}) => {
    const {
        SyntaxKind: {
            PropertyAccessExpression = -1,
            Identifier = -1
        } = {}
    } = typescript;
    const {
        getTypeAtLocation = false,
        getPropertyOfType = false,
        getTypeOfSymbolAtLocation = false,
        typeToString = false
    } = getObject(checker);
    const { expression: callee = {} } = getObject(call);
    const { kind: calleeKind = 0, expression: receiver = {}, name: member = {} } = getObject(callee);
    const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);
    const { text: memberName = '' } = getObject(member);
    const { getReturnType = false } = getObject(callbackSignature);

    if (calleeKind !== PropertyAccessExpression || receiverKind !== Identifier || memberName !== 'chain' ||
        !receiverName || typeof getTypeAtLocation !== 'function' ||
        typeof getPropertyOfType !== 'function' || typeof getTypeOfSymbolAtLocation !== 'function' ||
        typeof getReturnType !== 'function') return {};

    const receiverType = getTypeAtLocation.call(checker, receiver);
    const ofSymbol = getPropertyOfType.call(checker, receiverType, 'of');

    if (!ofSymbol) return {};

    const ofType = getTypeOfSymbolAtLocation.call(checker, ofSymbol, receiver);
    const { getCallSignatures = false } = getObject(ofType);
    const hasOf = typeof getCallSignatures === 'function' && !!getCallSignatures.call(ofType).length;
    const expectedType = getReturnType.call(callbackSignature);
    const expectedText = typeof typeToString === 'function'
        ? typeToString.call(checker, expectedType, call)
        : '';

    // The tuple must be proven in the callback's promised outer result. This
    // accepts a checked M<[A, W]> returned through M.map, while excluding an
    // opaque M<A> whose inner value has no falsifier law.
    if (!hasOf || !/\[[^\]]+\]/.test(expectedText)) return {};

    return {
        action: 'effect-result',
        canonical: '',
        innerCanonical: '[]',
        constructor: `${receiverName}.of`,
        expression: `${receiverName}.of([])`,
        state: 'resolved',
        evidence: [
            'checker-proven chain callback returns the receiver effect around a required tuple',
            'checker proves the effect inner result is tuple-shaped; lifting [] is therefore lawful'
        ]
    };
};

const getBindingElementName = ({ typescript = {}, node = {} } = {}) => {
    const { Identifier = -1 } = getSyntaxKinds(typescript);
    const { name = {} } = getObject(node);
    const { kind = 0, text = '' } = getObject(name);

    return kind === Identifier ? text : '';
};

const getTupleBindingShape = ({ typescript = {}, pattern = {}, checker = {}, path = [] } = {}) => {
    const { ArrayBindingPattern = -1 } = getSyntaxKinds(typescript);
    const { elements = [] } = getObject(pattern);
    const parts = elements.map((element = {}, index = 0) => {
        const { name = {}, dotDotDotToken = false } = getObject(element);
        const { kind = 0 } = getObject(name);
        const nextPath = [...path, index];

        if (dotDotDotToken) return { containers: [], positions: [] };

        if (kind === ArrayBindingPattern) {
            const nested = getTupleBindingShape({ typescript, pattern: name, checker, path: nextPath });

            return nested;
        }

        const evidence = getCheckerContract({ typescript, node: name, checker });
        const { kind: positionKind = 'generic' } = evidence;

        return {
            containers: [],
            positions: [{
                path: nextPath,
                name: getBindingElementName({ typescript, node: element }),
                contract: positionKind === 'generic' ? unknown() : contract({ kind: positionKind })
            }]
        };
    });

    return {
        containers: [{ path, arity: elements.length }, ...parts.flatMap(({ containers = [] } = {}) => containers)],
        positions: parts.flatMap(({ positions = [] } = {}) => positions)
    };
};

// A declared tuple is not a runtime validator. Keep each required position's
// caller/producer obligation attached to the original binding and its owner.
const collectRequiredTupleBindingContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        ArrayBindingPattern = -1, VariableDeclaration = -1,
        VariableStatement = -1, Parameter = -1,
        ForOfStatement = -1, ForStatement = -1, WhileStatement = -1, DoStatement = -1
    } = getSyntaxKinds(typescript);
    const { getTypeAtLocation = false, isTupleType = false } = getObject(checker);
    let contracts = new Map();

    if (typeof getTypeAtLocation !== 'function' || typeof isTupleType !== 'function') return contracts;

    const hasRequiredPosition = (pattern = {}) => getObject(pattern).elements.some((element = {}) => {
        const { name = {}, initializer = false, dotDotDotToken = false } = getObject(element);

        if (dotDotDotToken) return false;

        return getObject(name).kind === ArrayBindingPattern
            ? hasRequiredPosition(name)
            : !initializer;
    });
    const hasLiveLoopOwner = (node = {}) => {
        let { parent: current = false } = getObject(node);

        // eslint-disable-next-line resilient/prefer-prototype-methods -- Owner discovery reads loop parent before return; prewalking reads later ancestors too soon.
        while (current) {
            const { kind = 0, parent = false } = getObject(current);

            if ([ForOfStatement, ForStatement, WhileStatement, DoStatement].includes(kind)) return true;

            current = parent;
        }

        return false;
    };
    const visit = (node = {}) => {
        const { kind = 0, parent = {} } = getObject(node);
        const { kind: parentKind = 0 } = getObject(parent);
        const isBindingOwner = [VariableDeclaration, Parameter].includes(parentKind) &&
            getObject(parent).name === node;
        const tupleType = kind === ArrayBindingPattern && isBindingOwner
            ? getTypeAtLocation.call(checker, node)
            : {};
        const isTuple = tupleType && isTupleType.call(checker, tupleType);
        const owner = parentKind === VariableDeclaration
            ? getObject(parent).parent && getObject(getObject(parent).parent).parent
            : getObject(parent).parent;
        const supportedOwner = (parentKind === Parameter || getObject(owner).kind === VariableStatement) &&
            !hasLiveLoopOwner(node);
        const sourceRange = isTuple && supportedOwner && hasRequiredPosition(node)
            ? getConsumerContractKey(owner)
            : '';

        const shape = sourceRange ? getTupleBindingShape({ typescript, pattern: node, checker }) : {};
        const { positions = [] } = getObject(shape);
        const hasOpaquePosition = positions.some((position = {}) => {
            const { kind: positionKind = '' } = getObject(getObject(position).contract);

            return positionKind === 'function' ||
                parentKind === VariableDeclaration && positionKind === 'unknown';
        });

        if (sourceRange && hasOpaquePosition) contracts = new Map([...contracts, [sourceRange, {
            sourceRange,
            bindingRange: getConsumerContractKey(node),
            action: 'retain-required-tuple-binding',
            shape,
            evidence: [
                'checker proves a declared tuple, not runtime presence of every position',
                'required positions retain native iteration, undefined, and consumer failure timing'
            ]
        }]]);
    };

    census.select(ArrayBindingPattern).forEach(visit);

    return contracts;
};

const getInvokedTupleBindings = ({ typescript = {}, callback = {}, names = new Set() } = {}) => {
    const {
        ArrowFunction = -1,
        CallExpression = -1,
        FunctionExpression = -1,
        Identifier = -1
    } = getSyntaxKinds(typescript);
    const { body = {} } = getObject(callback);
    const invoked = new Set();
    const visit = (node = {}) => {
        const { kind = 0, expression = {} } = getObject(node);
        const { kind: expressionKind = 0, text: expressionName = '' } = getObject(expression);

        if (node !== callback && [ArrowFunction, FunctionExpression].includes(kind)) return;

        if (kind === CallExpression && expressionKind === Identifier && names.has(expressionName)) {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private capability Set deduplicates source names outside nested callbacks.
            invoked.add(expressionName);
        }

        typescript.forEachChild(node, visit);
    };

    visit(body);

    return invoked;
};

const getTypeScriptFunctionMap = ({ typescript = {}, sourceFile = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        FunctionDeclaration = -1,
        FunctionExpression = -1,
        ArrowFunction = -1,
        VariableDeclaration = -1,
        Identifier = -1
    } = getSyntaxKinds(typescript);
    let entries = [];
    const visit = (node = {}) => {
        const { kind = 0, name = {}, initializer = {} } = getObject(node);
        const { kind: nameKind = 0, text = '' } = getObject(name);
        const { kind: initializerKind = 0 } = getObject(initializer);

        if (kind === FunctionDeclaration && nameKind === Identifier && text) entries = [...entries, [text, node]];

        if (kind === VariableDeclaration && nameKind === Identifier &&
            [FunctionExpression, ArrowFunction].includes(initializerKind)) entries = [...entries, [text, initializer]];
    };

    census.select(FunctionDeclaration, VariableDeclaration).forEach(visit);

    return Object.fromEntries(entries);
};

const createTypeScriptTupleSyntax = ({ typescript = {}, checker = {} } = {}) => {
    const {
        Identifier = -1,
        CallExpression = -1,
        ConditionalExpression = -1,
        ArrayLiteralExpression = -1,
        ObjectLiteralExpression = -1,
        ArrowFunction = -1,
        FunctionExpression = -1,
        FunctionDeclaration = -1,
        MethodDeclaration = -1,
        GetAccessor = -1,
        SetAccessor = -1,
        Constructor = -1,
        ReturnStatement = -1,
        VariableDeclaration = -1,
        PropertyAccessExpression = -1
    } = getSyntaxKinds(typescript);
    const { SyntaxKind = {} } = typescript;
    const { Block = -1 } = getObject(SyntaxKind);
    const functionKinds = [ArrowFunction, FunctionExpression, FunctionDeclaration,
        MethodDeclaration, GetAccessor, SetAccessor, Constructor];
    const getReturnExpressions = ({ body = {} } = {}) => {
        const { kind: bodyKind = 0 } = getObject(body);

        if (bodyKind !== Block) return [body];

        let returns = [];
        const visit = (node = {}) => {
            const { kind = 0, expression = {} } = getObject(node);

            if (functionKinds.includes(kind)) return;

            if (kind === ReturnStatement && expression) returns = [...returns, expression];

            typescript.forEachChild(node, visit);
        };

        visit(body);

        return returns;
    };

    return {
        getType: ({ kind = 0 } = {}) => ({
            [Identifier]: 'identifier',
            [CallExpression]: 'call',
            [ConditionalExpression]: 'conditional'
        }[kind] || 'direct'),
        getName: ({ text = '' } = {}) => text,
        getRange: ({ pos = -1, end = -1 } = {}) => pos >= 0 && end >= pos ? `${pos}:${end}` : '',
        getConditional: ({ whenTrue = {}, whenFalse = {} } = {}) => ({
            consequent: whenTrue,
            alternate: whenFalse
        }),
        getCall: (node = {}) => {
            const { expression = {}, arguments: args = [] } = getObject(node);
            const { kind = 0, text = '', name = {} } = getObject(expression);
            const { text: property = '' } = getObject(name);
            const { expression: innerCallee = {} } = getObject(expression);
            const { kind: curriedKind = 0, text: localCallee = '' } = getObject(innerCallee);
            const checkedResult = getTupleReturnCheckerContract({
                typescript,
                node,
                checker
            });

            if (kind === Identifier) return { name: text, dynamic: false, arguments: args };

            if (kind === PropertyAccessExpression && property) return {
                unsupported: true,
                target: 'static-member',
                result: checkedResult,
                arguments: args
            };

            if (kind === CallExpression && curriedKind === Identifier && localCallee) return {
                dynamic: true,
                target: 'local-curried',
                localCallee,
                result: checkedResult,
                arguments: args
            };

            return { dynamic: true, arguments: args };
        },
        getParameterNames: ({ parameters = [] } = {}) => parameters.map((parameter = {}) => {
            const { name = {} } = getObject(parameter);
            const { kind = 0, text = '' } = getObject(name);

            return kind === Identifier ? text : '';
        }),
        getDirectContract: (node = {}) => {
            const { kind = 0 } = getObject(node);

            if (kind === ArrayLiteralExpression) return contract({ kind: 'array' });

            if (kind === ObjectLiteralExpression) return contract({ kind: 'object' });

            if ([ArrowFunction, FunctionExpression].includes(kind)) return contract({ kind: 'function' });

            return getTupleReturnCheckerContract({ typescript, node, checker });
        },
        getAliases: ({ body = {} } = {}) => {
            let entries = [];
            const visit = (node = {}) => {
                const { kind = 0, name = {}, initializer = {} } = getObject(node);
                const { kind: nameKind = 0, text = '' } = getObject(name);

                if (functionKinds.includes(kind)) return;

                if (kind === VariableDeclaration && nameKind === Identifier && initializer) entries = [...entries, [text, initializer]];

                typescript.forEachChild(node, visit);
            };

            visit(body);

            return Object.fromEntries(entries);
        },
        getReturnExpressions
    };
};

const getEnclosingFunction = ({ typescript = {}, node = {} } = {}) => {
    const {
        ArrowFunction = -1,
        FunctionDeclaration = -1,
        FunctionExpression = -1
    } = getSyntaxKinds(typescript);
    const kinds = [ArrowFunction, FunctionDeclaration, FunctionExpression];
    let { parent: current = {} } = getObject(node);

    // eslint-disable-next-line resilient/prefer-prototype-methods -- Function-owner lookup is unbounded and skips terminal parent Get; bounded scans change results.
    while (current) {
        const { kind = 0 } = getObject(current);

        if (kinds.includes(kind)) return current;

        const { parent = {} } = getObject(current);

        current = parent;
    }

    return {};
};

const getConsumerBindingContract = ({ typescript = {}, call = {}, argument = {}, checker = {} } = {}) => {
    const { SyntaxKind: { PropertyAccessExpression = -1 } = {} } = typescript;
    const {
        getResolvedSignature = false,
        getTypeOfSymbolAtLocation = false,
        getTypeAtLocation = false,
        typeToString = false,
        isArrayType = false,
        isTupleType = false
    } = getObject(checker);
    const { kind: argumentKind = 0 } = getObject(argument);

    if (argumentKind !== PropertyAccessExpression ||
        typeof getResolvedSignature !== 'function' ||
        typeof getTypeOfSymbolAtLocation !== 'function') return {};

    const { expression: callee = {} } = getObject(call);
    const { expression: receiver = {} } = getObject(callee);
    const receiverContract = getCheckerContract({ typescript, node: receiver, checker });
    const { kind: receiverKind = '' } = receiverContract;
    const receiverType = typeof getTypeAtLocation === 'function'
        ? getTypeAtLocation.call(checker, receiver)
        : {};
    const receiverText = typeof typeToString === 'function'
        ? typeToString.call(checker, receiverType)
        : '';
    const isReadonlyArrayLike = /^(?:Readonly)?(?:Array|NonEmptyArray)(?:<|$)/.test(receiverText);
    const isCheckedArray = typeof isArrayType === 'function' && isArrayType.call(checker, receiverType);
    const isCheckedTuple = typeof isTupleType === 'function' && isTupleType.call(checker, receiverType);

    if (receiverKind !== 'array' && !isReadonlyArrayLike && !isCheckedArray && !isCheckedTuple) return {};

    // Most static member arguments in a collection-heavy module are data,
    // not callbacks.  Prove the only admitted value family before asking the
    // checker to resolve the enclosing higher-order call.
    const actual = getCheckerContract({ typescript, node: argument, checker });
    const { kind = '' } = actual;

    if (kind !== 'function') return {};

    const { arguments: argumentsList = [] } = getObject(call);
    const index = argumentsList.indexOf(argument);
    const signature = getObject(getResolvedSignature.call(checker, call));
    const { parameters = [] } = signature;
    const [parameter = {}] = parameters.slice(index, index + 1);
    const expected = getTypeOfSymbolAtLocation.call(checker, parameter, call);
    const { getCallSignatures = false } = getObject(expected);
    const required = typeof getCallSignatures === 'function' && !!getCallSignatures.call(expected).length;
    const { expression: memberSource = {}, name: memberName = {} } = getObject(argument);
    const { text: source = '' } = getObject(memberSource);
    const { text: property = '' } = getObject(memberName);
    const functionNode = getEnclosingFunction({ typescript, node: call });
    const { body = {} } = getObject(functionNode);
    const result = getCheckerValueContract({ typescript, node: body, checker });
    const { canonical = '' } = result;

    if (!required) return {};

    return {
        key: getConsumerContractKey(argument),
        consumer: 'callback',
        binding: { kind: 'function', required: true },
        member: { source, property },
        result: { canonical },
        guard: canonical ? 'function' : '',
        action: canonical ? 'guard' : 'preserve',
        evidence: ['resolved callback parameter requires a function', canonical
            ? 'enclosing callback has a canonical return agreement'
            : 'enclosing callback return remains generic or unknown']
    };
};

// Consumer evidence is not a source-wide type-analysis pass.  Only the one
// grammar form currently owned by residual lowering reaches the checker:
// `values.map(S.show)`.  Everything else retains its existing boundary.
const getStaticCollectionCallbackArgument = ({ typescript = {}, node = {} } = {}) => {
    const {
        SyntaxKind: {
            CallExpression = -1,
            PropertyAccessExpression = -1,
            Identifier = -1
        } = {}
    } = typescript;
    const { kind = 0, expression: callee = {}, arguments: argumentsList = [],
        questionDotToken: optionalCall = false } = getObject(node);
    const {
        kind: calleeKind = 0,
        expression: receiver = {},
        name: method = {},
        questionDotToken: optionalConsumer = false
    } = getObject(callee);
    const { kind: receiverKind = 0 } = getObject(receiver);
    const { text: methodName = '' } = getObject(method);
    const [argument = {}] = argumentsList;
    const { kind: argumentKind = 0, questionDotToken: optionalCallback = false } = getObject(argument);
    const collectionMethods = new Set(['map', 'filter', 'some', 'find', 'forEach', 'reduce']);

    if (kind !== CallExpression || optionalCall || optionalConsumer || optionalCallback ||
        calleeKind !== PropertyAccessExpression ||
        receiverKind !== Identifier ||
        !collectionMethods.has(methodName) ||
        argumentKind !== PropertyAccessExpression) return {};

    return argument;
};

// Tuple consumers are determined by the resolved call signature, not by a
// method-name allowlist. The callback may be supplied to a typeclass method;
// the signature remains the agreement that owns its tuple input.
const getTupleConsumerContract = ({ typescript = {}, call = {}, argument = {}, checker = {}, sourceFile = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        SyntaxKind: {
            ArrowFunction = -1,
            FunctionExpression = -1,
            ArrayBindingPattern = -1,
            Identifier = -1
        } = {}
    } = typescript;
    const { kind: argumentKind = 0, parameters = [], body = {} } = getObject(argument);
    const tupleParameterIndex = parameters.findIndex(({ name = {} } = {}) => getObject(name).kind === ArrayBindingPattern);
    const [parameter = {}] = tupleParameterIndex >= 0 ? parameters.slice(tupleParameterIndex, tupleParameterIndex + 1) : [];
    const { name: pattern = {} } = getObject(parameter);
    const { kind: patternKind = 0, elements = [] } = getObject(pattern);
    const { getResolvedSignature = false, getTypeOfSymbolAtLocation = false } = getObject(checker);

    if (![ArrowFunction, FunctionExpression].includes(argumentKind) ||
        patternKind !== ArrayBindingPattern || !elements.length ||
        typeof getResolvedSignature !== 'function' ||
        typeof getTypeOfSymbolAtLocation !== 'function') return {};

    const { arguments: args = [] } = getObject(call);
    const index = args.indexOf(argument);
    const signature = getObject(getResolvedSignature.call(checker, call));
    const { parameters: callParameters = [] } = signature;
    const [callbackParameter = {}] = callParameters.slice(index, index + 1);
    const callbackType = getTypeOfSymbolAtLocation.call(checker, callbackParameter, call);
    const { getCallSignatures = false } = getObject(callbackType);
    const [callbackSignature = {}] = typeof getCallSignatures === 'function'
        ? getCallSignatures.call(callbackType)
        : [];
    const { parameters: callbackParameters = [] } = getObject(callbackSignature);
    const [tupleParameter = {}] = tupleParameterIndex >= 0
        ? callbackParameters.slice(tupleParameterIndex, tupleParameterIndex + 1)
        : [];
    const tupleType = getTypeOfSymbolAtLocation.call(checker, tupleParameter, argument);
    const { typeToString = false, isTupleType = false } = getObject(checker);
    const tupleText = typeof typeToString === 'function' ? typeToString.call(checker, tupleType) : '';
    const isResolvedTuple = typeof isTupleType === 'function' && isTupleType.call(checker, tupleType);
    const expectedResult = getTupleReturnCheckerContract({ typescript, node: body, checker });
    const shape = getTupleBindingShape({ typescript, pattern, checker });
    const { positions: shapePositions = [], containers: shapeContainers = [] } = shape;
    const names = new Set(shapePositions.map(({ name = '' } = {}) => name).filter(Boolean));
    const invoked = getInvokedTupleBindings({ typescript, callback: argument, names });
    const tuple = {
        required: true,
        arity: elements.length,
        paths: shapePositions.map(({ path = [] } = {}) => path),
        containers: shapeContainers,
        positions: shapePositions.map(({ name = '', ...position } = {}) => ({
            ...position,
            name,
            invoked: invoked.has(name)
        }))
    };
    const [accumulatorParameter = {}] = parameters;
    const { name: accumulatorName = {} } = getObject(accumulatorParameter);
    const { kind: accumulatorNameKind = 0, text: accumulatorText = '' } = getObject(accumulatorName);
    const isReducerCallback = tupleParameterIndex > 0 && accumulatorNameKind === Identifier;
    const resolution = resolveTupleCallbackReturn({
        syntax: createTypeScriptTupleSyntax({ typescript, checker }),
        callback: argument,
        tuple,
        expectedResult,
        functions: getTypeScriptFunctionMap({ typescript, sourceFile, census }),
        context: isReducerCallback ? { accumulator: { name: accumulatorText } } : {}
    });
    const { state = '', resolver = {}, reason = '', evidence: resolutionEvidence = [] } = resolution;
    const liftedResolver = state === 'unresolved' && reason === 'unsupported-member'
        ? getLiftedTupleEffectResolver({ typescript, call, callbackSignature, checker })
        : {};
    const activeResolver = getObject(liftedResolver).action ? liftedResolver : resolver;
    const activeState = getObject(liftedResolver).state || state;
    const activeReason = getObject(liftedResolver).action ? '' : reason;
    const { action: resolverAction = 'none', canonical = '' } = activeResolver;
    const { paths: tuplePaths = [], containers: tupleContainers = [], positions: tuplePositions = [] } = tuple;
    const isFlatStaticTuple = tupleContainers.length === 1 && tuplePaths.length === elements.length &&
        elements.every(({ initializer = false, dotDotDotToken = false } = {}) => !initializer && !dotDotDotToken) &&
        tuplePaths.every((path = []) => Array.isArray(path) && path.length === 1) &&
        !tuplePositions.some(({ invoked = false } = {}) => invoked);

    if (!isResolvedTuple && !/^\s*(readonly\s*)?\[/.test(tupleText)) return {};

    return {
        key: getConsumerContractKey(pattern),
        callbackKey: getConsumerContractKey(argument),
        consumer: 'tuple-callback',
        tuple: {
            required: true,
            arity: elements.length,
            paths: tuplePaths,
            containers: tupleContainers
        },
        positions: tuplePositions.map(({ path = [], name = '', contract: position = {}, invoked: invokedPosition = false } = {}) => {
            const { kind = '' } = getObject(position);

            return {
                path,
                name,
                kind: kind || 'generic',
                invoked: invokedPosition
            };
        }),
        consumerResult: {},
        callbackResult: expectedResult,
        resolver: {
            ...activeResolver,
            action: resolverAction,
            state: activeState,
            reason: activeReason
        },
        flatStaticTuple: isFlatStaticTuple,
        accumulator: isReducerCallback ? { name: accumulatorText } : {},
        guard: canonical ? 'array' : '',
        action: activeState === 'resolved' && canonical ? 'guard' : 'preserve',
        evidence: [
            'resolved callback signature requires tuple input',
            ...resolutionEvidence.map(({ label = '' } = {}) => label).filter(Boolean),
            ...(getObject(liftedResolver).evidence || []),
            activeReason || (canonical ? 'callback return resolved through contract flow' : 'callback return requires contract-flow resolution')
        ]
    };
};

// A tuple-typed function parameter is itself a consumer boundary.  Unlike a
// collection callback, it has no call-site signature to inspect, so project
// only the facts the checker can prove at the parameter and let the existing
// return-flow resolver determine whether the function owns a response.
const getTupleParameterContract = ({ typescript = {}, node = {}, checker = {}, sourceFile = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        SyntaxKind: {
            ArrowFunction = -1,
            FunctionExpression = -1,
            FunctionDeclaration = -1,
            ArrayBindingPattern = -1
        } = {}
    } = typescript;
    const { kind = 0, parameters = [], body = {} } = getObject(node);
    const tupleParameterIndex = parameters.findIndex(({ name = {} } = {}) => getObject(name).kind === ArrayBindingPattern);
    const [parameter = {}] = tupleParameterIndex >= 0 ? parameters.slice(tupleParameterIndex, tupleParameterIndex + 1) : [];
    const { name: pattern = {} } = getObject(parameter);
    const { kind: patternKind = 0, elements = [] } = getObject(pattern);
    const { getTypeAtLocation = false, isTupleType = false, typeToString = false } = getObject(checker);

    if (![ArrowFunction, FunctionExpression, FunctionDeclaration].includes(kind) || tupleParameterIndex !== 0 ||
        patternKind !== ArrayBindingPattern || !elements.length || typeof getTypeAtLocation !== 'function') return {};

    const tupleType = getTypeAtLocation.call(checker, parameter);
    const tupleText = typeof typeToString === 'function' ? typeToString.call(checker, tupleType) : '';
    const isResolvedTuple = typeof isTupleType === 'function' && isTupleType.call(checker, tupleType);

    if (!isResolvedTuple && !/^\s*(readonly\s*)?\[/.test(tupleText)) return {};

    const expectedResult = getTupleReturnCheckerContract({ typescript, node: body, checker });
    const shape = getTupleBindingShape({ typescript, pattern, checker });
    const { positions: shapePositions = [], containers: shapeContainers = [] } = shape;
    const names = new Set(shapePositions.map(({ name = '' } = {}) => name).filter(Boolean));
    const invoked = getInvokedTupleBindings({ typescript, callback: node, names });
    const tuple = {
        required: true,
        arity: elements.length,
        paths: shapePositions.map(({ path = [] } = {}) => path),
        containers: shapeContainers,
        positions: shapePositions.map(({ name = '', ...position } = {}) => ({
            ...position,
            name,
            invoked: invoked.has(name)
        }))
    };
    const resolution = resolveTupleCallbackReturn({
        syntax: createTypeScriptTupleSyntax({ typescript, checker }),
        callback: node,
        tuple,
        expectedResult,
        functions: getTypeScriptFunctionMap({ typescript, sourceFile, census })
    });
    const { state = '', resolver = {}, reason = '', evidence: resolutionEvidence = [] } = resolution;
    const { action = 'none', canonical = '' } = resolver;
    const { paths = [], containers = [] } = tuple;
    const isFlatStaticTuple = containers.length === 1 && paths.length === elements.length &&
        elements.every(({ initializer = false, dotDotDotToken = false } = {}) => !initializer && !dotDotDotToken) &&
        paths.every((path = []) => Array.isArray(path) && path.length === 1) &&
        !tuple.positions.some(({ invoked = false } = {}) => invoked);

    return {
        key: getConsumerContractKey(node),
        callbackKey: getConsumerContractKey(node),
        consumer: 'tuple-function',
        tuple: {
            required: true,
            arity: elements.length,
            paths,
            containers
        },
        positions: tuple.positions.map(({ path = [], name = '', contract: position = {}, invoked: invokedPosition = false } = {}) => ({
            path,
            name,
            kind: getObject(position).kind || 'generic',
            invoked: invokedPosition
        })),
        callbackResult: expectedResult,
        resolver: { ...resolver, action, canonical, state, reason },
        // A standalone, checker-proven flat tuple parameter can make its
        // position-level undefined result explicit without normalizing the
        // container.  Inline callbacks retain their call-site result law.
        flatStaticTuple: isFlatStaticTuple,
        evidence: [
            'checker proves a required tuple function parameter',
            ...resolutionEvidence.map(({ label = '' } = {}) => label).filter(Boolean),
            reason || (canonical ? 'function return resolved through contract flow' : 'function return remains generic')
        ]
    };
};

const collectConsumerBindingContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const { SyntaxKind: { CallExpression = -1, ArrowFunction = -1, FunctionExpression = -1, FunctionDeclaration = -1 } = {} } = typescript;
    let contracts = new Map();
    const visit = (node) => {
        const { kind = 0 } = getObject(node);
        const argument = kind === CallExpression
            ? getStaticCollectionCallbackArgument({ typescript, node })
            : {};
        const contract = kind === CallExpression
            ? getConsumerBindingContract({ typescript, call: node, argument, checker })
            : {};
        const { arguments: argumentsList = [] } = getObject(node);
        const tupleContracts = kind === CallExpression
            ? argumentsList.map(argument => getTupleConsumerContract({ typescript, call: node, argument, checker, sourceFile, census }))
            : [];
        const { key = '' } = contract;

        if (key) contracts = new Map([...contracts, [key, contract]]);

        tupleContracts.forEach((tupleContract = {}) => {
            const { key: tupleKey = '' } = tupleContract;

            if (tupleKey) contracts = new Map([...contracts, [tupleKey, tupleContract]]);
        });

        const tupleParameterContract = [ArrowFunction, FunctionExpression, FunctionDeclaration].includes(kind)
            ? getTupleParameterContract({ typescript, node, checker, sourceFile, census })
            : {};
        const { key: tupleParameterKey = '' } = tupleParameterContract;

        // Inline callbacks already have a consumer contract keyed to this
        // function.  Keep that call-site agreement: a standalone parameter
        // contract supplements only functions with no enclosing consumer.
        if (tupleParameterKey && !contracts.has(tupleParameterKey)) {
            contracts = new Map([...contracts, [tupleParameterKey, tupleParameterContract]]);
        }
    };

    census.select(CallExpression, ArrowFunction, FunctionExpression, FunctionDeclaration).forEach(visit);

    return contracts;
};

const getProviderForwardKey = ({ node = {} } = {}) => {
    const { pos = -1, end = -1 } = getObject(node);

    return Number.isInteger(pos) && Number.isInteger(end) && pos >= 0 && end >= pos
        ? `${pos}:${end}`
        : '';
};

// A provider-forward agreement is intentionally narrower than a provider
// edge. It is a required callable member read as the value of an immediate
// returned record property. The resulting grammar keeps the read at that
// property position instead of hoisting it into a declaration.
const collectProviderForwardContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        ReturnStatement = -1,
        ObjectLiteralExpression = -1,
        ParenthesizedExpression = -1,
        PropertyAssignment = -1,
        PropertyAccessExpression = -1,
        Identifier = -1
    } = getSyntaxKinds(typescript);
    let contracts = new Map();

    if (!hasTypeChecker(checker)) return contracts;

    const getText = (node = {}) => getObject(node).text || '';
    const getReturnedObject = (node = {}) => {
        const { kind = 0, expression = {} } = getObject(node);

        if (kind === ParenthesizedExpression) return getReturnedObject(expression);

        return node;
    };
    const visit = (node = {}) => {
        const { kind = 0, expression = {} } = getObject(node);
        const returned = getReturnedObject(expression);
        const { kind: expressionKind = 0, properties = [] } = getObject(returned);

        if (kind === ReturnStatement && expressionKind === ObjectLiteralExpression) {
            properties.forEach((property = {}) => {
                const { kind: propertyKind = 0, initializer = {}, name = {} } = getObject(property);
                const {
                    kind: initializerKind = 0,
                    expression: receiver = {},
                    name: memberNode = {},
                    questionDotToken: optionalMember = false
                } = getObject(initializer);
                const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);
                const { kind: memberKind = 0, text: member = '' } = getObject(memberNode);
                const key = getProviderForwardKey({ node: initializer });
                const checkerContract = getCheckerContract({ typescript, node: initializer, checker });
                const { kind: contractKind = '', optional = false, typeText = '' } = checkerContract;
                const propertyName = getText(name);

                if (propertyKind !== PropertyAssignment || initializerKind !== PropertyAccessExpression || optionalMember ||
                    receiverKind !== Identifier || memberKind !== Identifier || !receiverName || !member ||
                    !propertyName || !key || contractKind !== 'function' || optional) return;

                contracts = new Map([...contracts, [key, {
                    key,
                    sourceRange: key,
                    theorem: 'identity-forward',
                    action: 'provider-forward',
                    receiver: receiverName,
                    member,
                    property: propertyName,
                    typeText,
                    evidence: [
                        'checker-proven required callable member is forwarded directly from an immediate returned record',
                        'source-time extraction preserves one field read, identity, and native receiver failure ownership'
                    ]
                }]]);
            });
        }
    };

    census.select(ReturnStatement).forEach(visit);

    return contracts;
};

// A `ReadonlyArray<A>.map(item => item.field)` projection reads one required
// field at the callback's source-time return point.  It is neither a provider
// capability nor a default: the callback forwards the exact field value.
const collectExactProjectionContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const { SymbolFlags: { Optional: OptionalFlag = 0 } = {} } = typescript;
    const {
        CallExpression = -1,
        ArrowFunction = -1,
        Identifier = -1,
        PropertyAccessExpression = -1
    } = getSyntaxKinds(typescript);
    const {
        getTypeAtLocation = false,
        getSymbolAtLocation = false,
        isArrayType = false,
        isTupleType = false
    } = getObject(checker);
    let contracts = new Map();

    if (!hasTypeChecker(checker) || typeof getTypeAtLocation !== 'function') return contracts;

    const isRestParameterArray = (node = {}) => {
        if (typeof getSymbolAtLocation !== 'function') return false;

        const symbol = getSymbolAtLocation.call(checker, node);
        const { valueDeclaration = {} } = getObject(symbol);
        const { dotDotDotToken = false } = getObject(valueDeclaration);

        return Boolean(dotDotDotToken);
    };
    const isArray = (node = {}) => {
        if (isRestParameterArray(node)) return true;

        const type = getTypeAtLocation.call(checker, node);
        const { types = [] } = getObject(type);
        const parts = Array.isArray(types) && types.length ? types : [type];

        return Boolean(parts.length && parts.every(part => (
            typeof isArrayType === 'function' && isArrayType.call(checker, part) ||
            typeof isTupleType === 'function' && isTupleType.call(checker, part)
        )));
    };
    const visit = (node = {}) => {
        const { kind = 0, expression: callee = {}, arguments: args = [], questionDotToken: optionalCall = false } = getObject(node);
        const {
            kind: calleeKind = 0,
            expression: collection = {},
            name: method = {},
            questionDotToken: optionalMethod = false
        } = getObject(callee);
        const [callback = {}] = args;
        const { kind: callbackKind = 0, parameters = [], body = {} } = getObject(callback);
        const [parameter = {}] = parameters;
        const { name: parameterName = {} } = getObject(parameter);
        const { kind: parameterKind = 0, text: parameterText = '' } = getObject(parameterName);
        const {
            kind: bodyKind = 0,
            expression: receiver = {},
            name: memberNode = {},
            questionDotToken: optionalProjection = false
        } = getObject(body);
        const { kind: receiverKind = 0, text: receiverText = '' } = getObject(receiver);
        const { kind: memberKind = 0, text: member = '' } = getObject(memberNode);
        const key = getConsumerContractKey(body);

        const hasProjectionShape = kind === CallExpression && !optionalCall &&
            calleeKind === PropertyAccessExpression && !optionalMethod &&
            getObject(method).text === 'map' && args.length === 1 && isArray(collection) &&
            callbackKind === ArrowFunction && parameters.length === 1 && parameterKind === Identifier && parameterText &&
            bodyKind === PropertyAccessExpression && !optionalProjection &&
            receiverKind === Identifier && receiverText === parameterText &&
            memberKind === Identifier && member && key;
        const memberSymbol = hasProjectionShape && typeof getSymbolAtLocation === 'function'
            ? getSymbolAtLocation.call(checker, memberNode)
            : {};
        const { flags: memberFlags = 0 } = getObject(memberSymbol);

        if (hasProjectionShape && !(memberFlags & OptionalFlag)) contracts = new Map([...contracts, [key, {
            key,
            action: 'exact-callback-projection',
            receiver: receiverText,
            member,
            sourceRange: key,
            theorem: 'exact-callback-projection',
            evidence: [
                'checker-proven array callback forwards one required static member',
                'callback-local extraction preserves source-time field read and exact identity'
            ]
        }]]);
    };

    census.select(CallExpression).forEach(visit);

    return contracts;
};

// A resolved source call can own a required callable field. Neither the
// callee spelling nor a generated binding is evidence of that obligation.
const collectFactoryBindingContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const { CallExpression = -1, VariableDeclaration = -1, ObjectBindingPattern = -1 } = getSyntaxKinds(typescript);
    const { SymbolFlags: { Optional = 0 } = {}, SignatureKind: { Call = 0 } = {},
        TypeFlags: { Object: ObjectFlag = 0 } = {} } = typescript;
    const { getResolvedSignature = false, getReturnTypeOfSignature = false,
        getPropertiesOfType = false, getTypeOfSymbolAtLocation = false,
        getSignaturesOfType = false } = getObject(checker);
    let contracts = new Map();

    if (![getResolvedSignature, getReturnTypeOfSignature, getPropertiesOfType,
        getTypeOfSymbolAtLocation, getSignaturesOfType].every(method => typeof method === 'function')) return contracts;

    const collect = (node = {}) => {
        const { parent = {} } = getObject(node);
        const { kind: parentKind = 0, name = {}, initializer = {} } = getObject(parent);
        const boundResult = parentKind === VariableDeclaration && initializer === node &&
            getObject(name).kind === ObjectBindingPattern;

        // Direct factory member projections already belong to provider-edge.
        if (getObject(node).kind !== CallExpression || !boundResult) return;

        const signature = getResolvedSignature.call(checker, node);
        const { declaration = false } = getObject(signature);
        const result = declaration ? getReturnTypeOfSignature.call(checker, signature) : {};
        const { flags = 0 } = getObject(result);
        const properties = flags & ObjectFlag ? getPropertiesOfType.call(checker, result) : [];
        const requiredProperties = properties.filter((symbol = {}) => {
            const { flags: symbolFlags = 0, declarations = [] } = getObject(symbol);
            const type = getTypeOfSymbolAtLocation.call(checker, symbol, node);

            return !(symbolFlags & Optional) && declarations.length &&
                getSignaturesOfType.call(checker, type, Call).length;
        }).map(symbol => symbol.getName());
        const key = getConsumerContractKey(node);

        if (key && requiredProperties.length) contracts = new Map([...contracts, [key, {
            key, requiredProperties,
            evidence: ['resolved source factory result declares a required callable property']
        }]]);
    };
    const visit = (node = {}) => {
        collect(node);
    };

    census.select(CallExpression).forEach(visit);

    return contracts;
};

// A required provider field can be forwarded without becoming a callable
// consumer.  Its only member-level disagreement value is the value JavaScript
// already produces for an absent property: undefined.  This collector records
// that finite source shape so final binding lowering does not invent a guard
// or a callback before the field reaches its actual owner.
const collectExactProviderForwardContracts = ({ typescript = {}, sourceFile = {}, checker = {}, deferredOpaqueFieldContracts = new Map(),
    census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const { TypeFlags: { TypeParameter: TypeParameterFlag = 0 } = {},
        SymbolFlags: { Optional: OptionalFlag = 0, Value: ValueFlag = 0 } = {} } = typescript;
    const {
        BindingElement = -1,
        ObjectBindingPattern = -1,
        VariableDeclaration = -1,
        Parameter = -1,
        Identifier = -1,
        PropertyAccessExpression = -1,
        PropertyAssignment = -1,
        ShorthandPropertyAssignment = -1,
        ObjectLiteralExpression = -1,
        ReturnStatement = -1,
        CallExpression = -1,
        ConditionalExpression = -1,
        ArrowFunction = -1
    } = getSyntaxKinds(typescript);
    const {
        getSymbolAtLocation = false,
        getShorthandAssignmentValueSymbol = false,
        getTypeAtLocation = false,
        resolveName = false,
        isTypeAssignableTo = false
    } = getObject(checker);
    let contracts = new Map();

    if (!hasTypeChecker(checker) || typeof getSymbolAtLocation !== 'function') return contracts;

    const getName = (node = {}) => getObject(node).text || '';
    const getKey = (node = {}) => getConsumerContractKey(node);
    const getPropertyName = (element = {}) => {
        const { propertyName = {}, name = {} } = getObject(element);

        return getName(propertyName) || getName(name);
    };
    const getBindingPlacement = (element = {}) => {
        const { parent: pattern = {} } = getObject(element);
        const { parent = {}, kind: patternKind = 0 } = getObject(pattern);
        const { kind: parentKind = 0, initializer = {} } = getObject(parent);

        if (patternKind !== ObjectBindingPattern) return '';

        if (parentKind === Parameter) return 'parameter';

        if (parentKind === VariableDeclaration && getObject(initializer).kind === CallExpression) return 'factory-binding';

        return '';
    };
    const isImmediateReturnProperty = (candidate = {}) => {
        const { parent: property = {} } = getObject(candidate);
        const { kind: propertyKind = 0, initializer = {}, parent: object = {} } = getObject(property);
        const { kind: objectKind = 0, parent: returned = {} } = getObject(object);

        return [PropertyAssignment, ShorthandPropertyAssignment].includes(propertyKind) &&
            (initializer === candidate || getObject(property).name === candidate) &&
            objectKind === ObjectLiteralExpression && getObject(returned).kind === ReturnStatement;
    };
    const getUseSymbol = (candidate = {}) => {
        const { parent = {} } = getObject(candidate);

        return getObject(parent).kind === ShorthandPropertyAssignment &&
            typeof getShorthandAssignmentValueSymbol === 'function'
            ? getShorthandAssignmentValueSymbol.call(checker, parent)
            : getSymbolAtLocation.call(checker, candidate);
    };
    const getEnclosingFunction = (node = {}) => {
        const { FunctionDeclaration = -1, FunctionExpression = -1, ArrowFunction = -1 } = getSyntaxKinds(typescript);
        const { kind = 0, parent = {} } = getObject(node);

        if (!node || !Object.keys(getObject(node)).length) return {};

        return [FunctionDeclaration, FunctionExpression, ArrowFunction].includes(kind)
            ? node
            : getEnclosingFunction(parent);
    };
    const getLocalForwardUses = ({ symbol = {}, declarationName = {}, element = {} } = {}) => {
        const root = getEnclosingFunction(element);
        const collect = (candidate = {}) => {
            if (candidate === declarationName) return { uses: [], invalid: false };

            const sameSymbol = getObject(candidate).kind === Identifier && getUseSymbol(candidate) === symbol;

            if (sameSymbol) {
                return isImmediateReturnProperty(candidate)
                    ? { uses: ['return-record'], invalid: false }
                    : { uses: [], invalid: true };
            }

            const { getChildren = false } = getObject(candidate);
            const children = typeof getChildren === 'function' ? getChildren.call(candidate, sourceFile) : [];
            const results = children.map(child => collect(child));

            return {
                uses: results.flatMap(({ uses = [] } = {}) => uses),
                invalid: results.some(({ invalid = false } = {}) => invalid)
            };
        };
        const { uses = [], invalid = false } = collect(root);

        return invalid || !uses.length ? [] : [...new Set(uses)];
    };
    const addBinding = (element = {}) => {
        const { kind = 0, name = {} } = getObject(element);
        const { kind: nameKind = 0, initializer = false } = getObject(name);
        const placement = getBindingPlacement(element);
        const property = getPropertyName(element);
        const alias = getName(name);
        const symbol = getSymbolAtLocation.call(checker, name);
        const contract = getCheckerContract({ typescript, node: name, checker });
        const { kind: contractKind = '', optional = false } = contract;
        const uses = symbol ? getLocalForwardUses({ symbol, declarationName: name, element }) : [];
        const key = getKey(element);

        if (kind !== BindingElement || nameKind !== Identifier || initializer || !placement || !property || !alias ||
            !key || contractKind !== 'function' || optional || !uses.length) return;

        contracts = new Map([...contracts, [key, {
            key,
            action: 'exact-provider-forward',
            placement,
            consumer: uses,
            member: property,
            alias,
            canonical: 'undefined',
            evidence: [
                'checker-proven required callable is forwarded without invocation',
                'missing field preserves exact undefined while receiver failure remains native'
            ]
        }]]);
    };
    const addParameterProperty = (node = {}) => {
        const { kind = 0, expression: receiver = {}, name = {}, questionDotToken = false } = getObject(node);
        const { kind: receiverKind = 0 } = getObject(receiver);
        const { parent = {} } = getObject(node);
        const { kind: parentKind = 0, expression: callee = {}, arguments: args = [], body = {} } = getObject(parent);
        const contract = getCheckerContract({ typescript, node, checker });
        const { kind: contractKind = '', optional = false } = contract;
        const { flags: valueFlags = 0 } = getObject(getTypeAtLocation.call(checker, node));
        const { flags: memberFlags = 0 } = getObject(getSymbolAtLocation.call(checker, name));
        const receiverSymbol = typeof getSymbolAtLocation === 'function'
            ? getSymbolAtLocation.call(checker, receiver)
            : {};
        const { valueDeclaration: receiverDeclaration = {} } = getObject(receiverSymbol);
        const { kind: declarationKind = 0 } = getObject(receiverDeclaration);
        const nativeAbsence = typeof resolveName === 'function' &&
            !(getObject(resolveName.call(checker, 'undefined', node, ValueFlag, false)).declarations || []).length;
        const genericValue = Boolean(valueFlags & TypeParameterFlag) && !(memberFlags & OptionalFlag) &&
            declarationKind === Parameter &&
            !isUnionType(getTypeAtLocation.call(checker, receiverDeclaration)) &&
            !deferredOpaqueFieldContracts.has(getKey(node));
        const getConsumer = () => {
            if (!nativeAbsence) return '';

            if (parentKind === ReturnStatement && callee === node ||
                parentKind === ArrowFunction && body === node) return 'identity-return';

            return parentKind === CallExpression && args.includes(node) &&
                [PropertyAccessExpression, Identifier].includes(getObject(callee).kind)
                ? 'static-consumer'
                : '';
        };
        const consumer = getConsumer();
        const key = getKey(node);

        if (kind !== PropertyAccessExpression || questionDotToken || receiverKind !== Identifier || declarationKind !== Parameter ||
            !getName(name) || !(contractKind === 'function' || genericValue) || optional || !consumer || !key) return;

        contracts = new Map([...contracts, [key, {
            key,
            action: 'exact-provider-forward',
            placement: 'parameter',
            consumer: [consumer],
            receiver: getName(receiver),
            member: getName(name),
            alias: '',
            canonical: 'undefined',
            evidence: [
                contractKind === 'function'
                    ? 'checker-proven required provider capability is forwarded without invocation'
                    : 'checker-proven required generic provider value is forwarded without normalization',
                'missing field preserves exact undefined while receiver failure remains native'
            ]
        }]]);
    };
    const addMonoidIdentity = (node = {}) => {
        const { kind = 0, expression: receiver = {}, name = {}, questionDotToken = false } = getObject(node);
        const { kind: receiverKind = 0 } = getObject(receiver);
        const { optional = false } = getCheckerContract({ typescript, node, checker });
        const { parent = {} } = getObject(node);
        const { kind: parentKind = 0, whenTrue = {}, whenFalse = {} } = getObject(parent);
        const selectedTerminal = parentKind === ConditionalExpression && [whenTrue, whenFalse].includes(node);
        const key = getKey(node);

        if (kind !== PropertyAccessExpression || questionDotToken || receiverKind !== Identifier || getName(name) !== 'empty' ||
            optional || !selectedTerminal || !key || typeof getTypeAtLocation !== 'function' ||
            typeof isTypeAssignableTo !== 'function') return;

        const sibling = whenTrue === node ? whenFalse : whenTrue;
        const memberType = getTypeAtLocation.call(checker, node);
        const siblingType = getTypeAtLocation.call(checker, sibling);
        const sameResult = memberType && siblingType && isTypeAssignableTo.call(checker, siblingType, memberType);

        if (!sameResult) return;

        contracts = new Map([...contracts, [key, {
            key,
            action: 'exact-provider-forward',
            placement: 'monoid-binding',
            consumer: ['selected-terminal'],
            receiver: getName(receiver),
            member: 'empty',
            alias: '',
            canonical: 'undefined',
            evidence: [
                'checker-proven required empty identity agrees with its selected branch result',
                'missing identity preserves exact undefined while receiver failure remains native'
            ]
        }]]);
    };
    const visit = (node = {}) => {
        const { kind = 0 } = getObject(node);

        if (kind === BindingElement) addBinding(node);

        if (kind === PropertyAccessExpression) addParameterProperty(node);

        if (kind === PropertyAccessExpression) addMonoidIdentity(node);
    };

    census.select(BindingElement, PropertyAccessExpression).forEach(visit);

    return contracts;
};

const collectProviderEdgeContracts = ({ typescript = {}, sourceFile = {}, checker = {},
    census = createSourceCensus({ typescript, sourceFile }), bindingReferences = collectBindingReferences({ typescript, sourceFile, checker, census }) } = {}) => {
    const {
        VariableDeclaration = -1,
        VariableDeclarationList = -1,
        PropertyAccessExpression = -1,
        CallExpression = -1,
        Identifier = -1
    } = getSyntaxKinds(typescript);
    const { NodeFlags: { Const = 0 } = {} } = typescript;
    const { getSymbolAtLocation = false } = getObject(checker);
    let contracts = new Map();

    if (!hasTypeChecker(checker) || typeof getSymbolAtLocation !== 'function') return contracts;

    const isConsumedAtCallSite = (name = {}) => {
        const symbol = getSymbolAtLocation.call(checker, name);

        return Boolean(symbol) && (bindingReferences.get(symbol) || []).some((candidate = {}) => {
            const { parent = {} } = getObject(candidate);
            const { kind = 0, expression = {}, arguments: args = [] } = getObject(parent);

            return candidate !== name && kind === CallExpression &&
                (expression === candidate || args.includes(candidate));
        });
    };
    const visit = (node = {}) => {
        const { kind = 0, name = {}, initializer = {}, parent = {} } = getObject(node);
        const { kind: nameKind = 0, text: nameText = '' } = getObject(name);
        const { kind: initializerKind = 0, expression: receiver = {}, name: property = {},
            questionDotToken: optionalMember = false } = getObject(initializer);
        const { kind: receiverKind = 0, questionDotToken: optionalCall = false } = getObject(receiver);
        const { expression: factoryCallee = {} } = getObject(receiver);
        const { kind: propertyKind = 0, text: member = '' } = getObject(property);
        const { kind: parentKind = 0, flags: parentFlags = 0 } = getObject(parent);
        const factory = getObject(factoryCallee).text || getObject(getObject(factoryCallee).name).text || 'factory';
        const checkerContract = getCheckerContract({ typescript, node: initializer, checker });
        const { kind: contractKind = '', optional = false, typeText = '' } = checkerContract;

        if (kind === VariableDeclaration && nameKind === Identifier &&
            initializerKind === PropertyAccessExpression && receiverKind === CallExpression &&
            !optionalMember && !optionalCall && !getObject(factoryCallee).questionDotToken &&
            propertyKind === Identifier && parentKind === VariableDeclarationList &&
            parentFlags & Const &&
            contractKind === 'function' && !optional && !isConsumedAtCallSite(name)) {
            const key = getConsumerContractKey(node);

            contracts = new Map([...contracts, [key, {
                key,
                factory,
                member,
                name: nameText,
                typeText,
                action: 'slang-required-function-provider-edge',
                owner: 'provider-caller',
                evidence: ['checker-proven required factory function field; absence remains undefined until its caller establishes callability'],
                next: 'resolve callability at the actual consumer'
            }]]);
        }
    };

    census.select(VariableDeclaration).forEach(visit);

    return contracts;
};

// This is deliberately narrower than provider-edge slang. A closed result
// model owns a structural falsifier when its generic field is forwarded while
// its required array field has the established array result. It authorizes a
// callability guard only at the factory-member consumer that constructs that
// same closed result.
const collectClosedProviderModelContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        VariableDeclaration = -1,
        VariableStatement = -1,
        Block = -1,
        ObjectBindingPattern = -1,
        BindingElement = -1,
        PropertyAccessExpression = -1,
        CallExpression = -1,
        Identifier = -1,
        ReturnStatement = -1,
        ObjectLiteralExpression = -1,
        PropertyAssignment = -1,
        ShorthandPropertyAssignment = -1
    } = getSyntaxKinds(typescript);
    let contracts = new Map();

    if (!hasTypeChecker(checker)) return contracts;

    const getText = (node = {}) => {
        const { text = '' } = getObject(node);

        return text;
    };
    const getElementName = (element = {}) => {
        const { name = {} } = getObject(element);

        return getText(name);
    };
    const getPropertyName = (element = {}) => {
        const { propertyName = {}, name = {} } = getObject(element);

        return getText(propertyName) || getText(name);
    };
    const getClosedModelBinding = (statement = {}) => {
        const { kind = 0, declarationList = {} } = getObject(statement);
        const { declarations = [] } = getObject(declarationList);
        const [declaration = {}] = declarations;
        const { name = {}, initializer = {} } = getObject(declaration);
        const { kind: nameKind = 0, elements = [] } = getObject(name);
        const bindings = elements
            .filter((element = {}) => getObject(element).kind === BindingElement)
            .map((element = {}) => {
                const property = getPropertyName(element);
                const alias = getElementName(element);
                const { kind: fieldKind = '', optional = false } = getCheckerContract({
                    typescript,
                    node: getObject(element).name,
                    checker
                });

                return { property, alias, array: fieldKind === 'array', optional };
            })
            .filter(({ property = '', alias = '', optional = false } = {}) => property && alias && !optional);
        const arrays = bindings.filter(({ array = false } = {}) => array);
        const payloads = bindings.filter(({ array = false } = {}) => !array);
        const [payload = {}] = payloads;
        const [collection = {}] = arrays;

        return kind === VariableStatement && nameKind === ObjectBindingPattern && initializer &&
            arrays.length === 1 && payloads.length === 1
            ? { payload, collection }
            : {};
    };
    const isClosedModelReturn = ({ statement = {}, payload = {}, collection = {}, capability = '' } = {}) => {
        const { kind = 0, expression = {} } = getObject(statement);
        const { kind: expressionKind = 0, properties = [] } = getObject(expression);
        const [payloadProperty = {}] = properties.filter(({ name = {} } = {}) => getText(name) === getObject(payload).property);
        const [collectionProperty = {}] = properties.filter(({ name = {} } = {}) => getText(name) === getObject(collection).property);
        const { kind: payloadKind = 0, name: payloadName = {}, initializer: payloadValue = {} } = getObject(payloadProperty);
        const { kind: collectionKind = 0, initializer: collectionValue = {} } = getObject(collectionProperty);
        const { kind: valueKind = 0, expression: callee = {}, arguments: args = [], questionDotToken = false } = getObject(collectionValue);
        const forwardedPayload = payloadKind === ShorthandPropertyAssignment
            ? getText(payloadName) === getObject(payload).alias
            : payloadKind === PropertyAssignment && getObject(payloadValue).kind === Identifier &&
                getText(payloadValue) === getObject(payload).alias;

        return kind === ReturnStatement && expressionKind === ObjectLiteralExpression && properties.length === 2 &&
            forwardedPayload && collectionKind === PropertyAssignment && valueKind === CallExpression &&
            !questionDotToken && getObject(callee).kind === Identifier && getText(callee) === capability &&
            args.some(argument => getObject(argument).kind === Identifier &&
                getText(argument) === getObject(collection).alias);
    };
    const collectDeclaration = ({ node = {}, previous = {}, next = {} } = {}) => {
        const { kind = 0, name = {}, initializer = {} } = getObject(node);
        const { kind: nameKind = 0, text: nameText = '' } = getObject(name);
        const { kind: initKind = 0, expression: receiver = {}, name: member = {},
            questionDotToken: optionalMember = false } = getObject(initializer);
        const { kind: receiverKind = 0, expression: callee = {}, questionDotToken: optionalCall = false } = getObject(receiver);
        const { kind: calleeKind = 0 } = getObject(callee);
        const { kind: memberKind = 0, text: memberText = '' } = getObject(member);
        const model = getClosedModelBinding(previous);
        const { payload = {}, collection = {} } = model;
        const { kind: contractKind = '', optional = false } = getCheckerContract({ typescript, node: initializer, checker });

        if (kind === VariableDeclaration && nameKind === Identifier && initKind === PropertyAccessExpression &&
            !optionalMember && !optionalCall && !getObject(callee).questionDotToken &&
            receiverKind === CallExpression && calleeKind && memberKind === Identifier && memberText &&
            contractKind === 'function' && !optional && getObject(payload).alias && getObject(collection).alias &&
            isClosedModelReturn({ statement: next, payload, collection, capability: nameText })) {
            const key = getConsumerContractKey(node);

            contracts = new Map([...contracts, [key, {
                key,
                payload,
                collection,
                member: memberText,
                capability: nameText,
                action: 'guarded-closed-provider-model',
                canonical: '{ value, forest: [] }',
                evidence: ['checker-proven closed result forwards its generic field and falsifies its required array field as []'],
                next: 'guard required capability at the closed result consumer'
            }]]);
        }
    };
    const visit = (node = {}) => {
        const { kind = 0, statements = [] } = getObject(node);

        if (kind === Block) statements.forEach((statement = {}, index) => {
            const { declarationList = {} } = getObject(statement);
            const { declarations = [] } = getObject(declarationList);
            const {
                [index - 1]: previous = {},
                [index + 1]: next = {}
            } = statements;

            declarations.forEach(declaration => collectDeclaration({ node: declaration, previous, next }));
        });
    };

    census.select(Block).forEach(visit);

    return contracts;
};

// A checker-proven type predicate is a model selector, not an arbitrary
// callback. Keep the proof here so collection and placement do not disagree
// about whether the payload is protected by a terminating branch.
const getSelectedModelPredicateFact = ({ typescript = {}, checker = {}, expression = {} } = {}) => {
    const {
        CallExpression = -1,
        PropertyAccessExpression = -1,
        Identifier = -1
    } = getSyntaxKinds(typescript);
    const {
        getResolvedSignature = false,
        getTypePredicateOfSignature = false,
        getTypeAtLocation = false,
        getTypeOfSymbolAtLocation = false
    } = getObject(checker);
    const originalExpression = expression;
    const { kind = 0, expression: callee = {}, arguments: args = [] } = getObject(originalExpression);
    const { kind: calleeKind = 0 } = getObject(callee);
    const [receiver = {}] = args;
    const { kind: receiverKind = 0 } = getObject(receiver);

    if (kind !== CallExpression || ![PropertyAccessExpression, Identifier].includes(calleeKind) ||
        ![Identifier, PropertyAccessExpression].includes(receiverKind) || typeof getResolvedSignature !== 'function' ||
        typeof getTypePredicateOfSignature !== 'function' || typeof getTypeAtLocation !== 'function' ||
        typeof getTypeOfSymbolAtLocation !== 'function') return {};

    const receiverType = getTypeAtLocation.call(checker, receiver);
    const { types = [] } = getObject(receiverType);
    const signature = getResolvedSignature.call(checker, originalExpression);
    const predicate = getTypePredicateOfSignature.call(checker, signature);
    const { parameterIndex = -1, type: narrowed = {} } = getObject(predicate);
    const { getProperties = false } = getObject(narrowed);
    const tagSymbol = typeof getProperties === 'function'
        ? getProperties.call(narrowed).find((property = {}) => {
            const { getName = false } = getObject(property);
            const propertyName = typeof getName === 'function' ? getName.call(property) : '';
            const propertyType = typeof getTypeOfSymbolAtLocation === 'function'
                ? getTypeOfSymbolAtLocation.call(checker, property, originalExpression)
                : {};

            return Boolean(propertyName) && typeof getObject(propertyType).value === 'string';
        })
        : false;
    const tagType = tagSymbol ? getTypeOfSymbolAtLocation.call(checker, tagSymbol, originalExpression) : false;
    const { value: tag = '' } = getObject(tagType);
    const { getName: getTagName = false } = getObject(tagSymbol);
    const tagName = typeof getTagName === 'function' ? getTagName.call(tagSymbol) : '';
    const discriminated = Array.isArray(types) && types.length > 1 && tagName && types.every((part = {}) => {
        const { getProperty = false } = getObject(part);

        return typeof getProperty === 'function' && Boolean(getProperty.call(part, tagName));
    });

    return discriminated && parameterIndex === 0 && typeof tag === 'string' && tag
        ? { property: tagName, tag, predicate: true } : {};
};

const getSelectedModelPredicate = ({ typescript = {}, checker = {}, expression = {} } = {}) => {
    const { getOriginalNode = false } = typescript;
    const originalExpression = typeof getOriginalNode === 'function'
        ? getOriginalNode(expression) || expression : expression;
    const { arguments: args = [] } = getObject(originalExpression);
    const { arguments: currentArgs = [] } = getObject(expression);
    const [originalReceiver = {}] = args;
    const [receiver = originalReceiver] = currentArgs;
    const { kind = 0, text: receiverName = '' } = getObject(receiver);
    const { Identifier = -1 } = getSyntaxKinds(typescript);

    if (kind !== Identifier || !receiverName) return {};

    const fact = getSelectedModelPredicateFact({ typescript, checker, expression: originalExpression });
    const { predicate = false } = fact;

    return predicate ? { ...fact, receiver, receiverName, expression } : {};
};

// Direct tag comparisons and source-owned terminating predicates select one
// union branch before a generic payload is read. Loops remain a distinct
// iterator protocol law because their `done` result owns a different shape.
const collectSelectedModelContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        IfStatement = -1,
        BinaryExpression = -1,
        PropertyAccessExpression = -1,
        ReturnStatement = -1,
        Block = -1,
        SwitchStatement = -1,
        CaseClause = -1,
        CallExpression = -1,
        PrefixUnaryExpression = -1,
        ExclamationToken = -1,
        Parameter = -1,
        FunctionDeclaration = -1,
        VariableDeclaration = -1,
        Identifier = -1,
        StringLiteral = -1,
        EqualsEqualsToken = -1,
        EqualsEqualsEqualsToken = -1
    } = getSyntaxKinds(typescript);
    const { getTypeAtLocation = false, getSymbolAtLocation = false } = getObject(checker);
    const { NodeFlags: { Const: ConstFlag = 0 } = {} } = getObject(typescript);
    let contracts = new Map();
    const isDiscriminatedUnion = ({ receiver = {}, property = '' } = {}) => {
        if (typeof getTypeAtLocation !== 'function') return false;

        const type = getTypeAtLocation.call(checker, receiver);
        const { types = [] } = getObject(type);

        return Array.isArray(types) && types.length > 1 && Boolean(property) && types.every((part = {}) => {
            const { getProperty = false } = getObject(part);

            return typeof getProperty === 'function' && Boolean(getProperty.call(part, property));
        });
    };
    const getSelection = (statement = {}) => {
        const { kind = 0, expression = {} } = getObject(statement);
        const { kind: expressionKind = 0, left = {}, right = {}, operatorToken = {} } = getObject(expression);
        const { kind: operatorKind = 0 } = getObject(operatorToken);
        const candidates = [[left, right], [right, left]];
        const [member = {}] = candidates.find(([candidate = {}, literal = {}] = []) => {
            const { kind: candidateKind = 0, expression: receiver = {}, name = {} } = getObject(candidate);
            const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);
            const { text: propertyName = '' } = getObject(name);
            const { kind: literalKind = 0, text: literalText = '' } = getObject(literal);

            return candidateKind === PropertyAccessExpression && receiverKind === Identifier && receiverName &&
                propertyName && literalKind === StringLiteral && literalText &&
                isDiscriminatedUnion({ receiver, property: propertyName });
        }) || [];
        const { expression: receiver = {}, name = {} } = getObject(member);
        const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);
        const { text: discriminator = '' } = getObject(name);

        return kind === IfStatement && expressionKind === BinaryExpression &&
            [EqualsEqualsToken, EqualsEqualsEqualsToken].includes(operatorKind) && receiverKind === Identifier && receiverName && discriminator
            ? { receiver, discriminator }
            : {};
    };
    const getDirectReturn = (statement = {}) => {
        const { kind = 0, statements = [] } = getObject(statement);
        const [onlyStatement = {}] = statements;

        if (kind === ReturnStatement) return statement;

        return kind === Block && statements.length === 1 ? onlyStatement : {};
    };
    const getPayload = ({ statement = {}, discriminator = '' } = {}) => {
        const directReturn = getDirectReturn(statement);
        const { expression = {} } = getObject(directReturn);
        const { kind: expressionKind = 0, expression: payloadReceiver = {}, name = {} } = getObject(expression);
        const { kind: receiverKind = 0, text: receiverName = '' } = getObject(payloadReceiver);
        const { text: propertyName = '' } = getObject(name);

        return expressionKind === PropertyAccessExpression && receiverKind === Identifier && propertyName &&
            propertyName !== discriminator
            ? { expression, receiverName, propertyName }
            : {};
    };
    const record = ({ selection = {}, payload = {}, evidence = [], signatureBoundary = false } = {}) => {
        const { receiver = {}, discriminator = '' } = getObject(selection);
        const { kind: selectedReceiverKind = 0, text: selectedReceiverName = '' } = getObject(receiver);
        const { expression = {}, receiverName = '', propertyName = '' } = getObject(payload);
        const key = getConsumerContractKey(expression);

        if (selectedReceiverKind !== Identifier || receiverName !== selectedReceiverName || !discriminator || !key) return;

        contracts = new Map([...contracts, [key, {
            key,
            action: 'selected-model-read',
            source: { provider: receiverName, member: propertyName, memberRange: key },
            evidence,
            signatureBoundary,
            theorem: 'selected-model'
        }]]);
    };
    const collectSwitchCalls = (node = {}) => {
        const { kind = 0, expression = {}, caseBlock = {} } = getObject(node);
        const { kind: expressionKind = 0, expression: receiver = {}, name = {} } = getObject(expression);
        const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);
        const { text: discriminator = '' } = getObject(name);
        const { clauses = [] } = getObject(caseBlock);

        if (kind !== SwitchStatement || expressionKind !== PropertyAccessExpression ||
            receiverKind !== Identifier || !receiverName ||
            !isDiscriminatedUnion({ receiver, property: discriminator })) return;

        clauses.forEach((clause = {}) => {
            const { kind: clauseKind = 0, expression: label = {}, statements = [] } = getObject(clause);
            const [first = {}] = statements;
            const { kind: firstKind = 0, expression: firstExpression = {} } = getObject(first);
            const { kind: testKind = 0, operand = {}, operator = 0 } = getObject(firstExpression);
            let candidate = {};

            if (firstKind === ReturnStatement) candidate = firstExpression;

            if (firstKind === IfStatement) candidate = firstExpression;

            if (firstKind === IfStatement && testKind === PrefixUnaryExpression &&
                operator === ExclamationToken) candidate = operand;

            const { kind: callKind = 0, expression: callee = {}, arguments: args = [] } = getObject(candidate);

            const symbol = typeof getSymbolAtLocation === 'function' &&
                getObject(callee).kind === Identifier
                ? getSymbolAtLocation.call(checker, callee)
                : {};
            const { declarations: calleeDeclarations = [] } = getObject(symbol);
            const stableCallee = calleeDeclarations.some((declaration = {}) => {
                const { kind: declarationKind = 0, initializer = {}, parent = {}, end = -1 } = getObject(declaration);
                const { flags = 0 } = getObject(parent);

                return declarationKind === Parameter || declarationKind === FunctionDeclaration ||
                    declarationKind === VariableDeclaration && initializer &&
                    Boolean(flags & ConstFlag) && end < getObject(node).pos;
            });

            if (clauseKind !== CaseClause || getObject(label).kind !== StringLiteral ||
                callKind !== CallExpression || !stableCallee) return;

            args.forEach((argument = {}) => {
                const { kind: argumentKind = 0, expression: payloadReceiver = {}, name: payloadName = {} } = getObject(argument);
                const { kind: payloadReceiverKind = 0, text: payloadReceiverName = '' } = getObject(payloadReceiver);
                const { text: propertyName = '' } = getObject(payloadName);

                if (argumentKind !== PropertyAccessExpression || payloadReceiverKind !== Identifier ||
                    payloadReceiverName !== receiverName || !propertyName || propertyName === discriminator) return;

                record({
                    selection: { receiver, discriminator },
                    payload: { expression: argument, receiverName, propertyName },
                    evidence: ['checker-proven switch branch selects payload before a stable local call'],
                    signatureBoundary: true
                });
            });
        });
    };
    const collect = (node = {}) => {
        const { kind = 0, thenStatement = {} } = getObject(node);
        collectSwitchCalls(node);
        const selection = kind === IfStatement ? getSelection(node) : {};
        record({
            selection,
            payload: getPayload({ statement: thenStatement, discriminator: getObject(selection).discriminator }),
            evidence: ['checker-proven discriminant selects this branch before its generic payload read']
        });

        const { statements = [] } = getObject(node);

        if (kind === Block) statements.forEach((statement = {}, index) => {
            const { [index + 1]: nextStatement = {} } = statements;
            const { kind: statementKind = 0, thenStatement: predicateBranch = {} } = getObject(statement);
            const predicate = statementKind === IfStatement
                ? getSelectedModelPredicate({ typescript, checker, expression: getObject(statement).expression })
                : {};
            const { receiver = {}, property: discriminator = '' } = getObject(predicate);
            const payload = getPayload({ statement: nextStatement, discriminator });
            const { kind: branchKind = 0, statements: branchStatements = [] } = getObject(predicateBranch);
            const [first = {}] = branchStatements;
            const terminating = branchKind === ReturnStatement || branchKind === Block && getObject(first).kind === ReturnStatement;

            if (terminating) record({
                selection: { receiver, discriminator },
                payload,
                evidence: ['checker-proven source-owned predicate terminates before this generic payload read']
            });
        });
    };

    census.select(IfStatement, Block, SwitchStatement).forEach(collect);

    return contracts;
};

// A closed structural model is not an arbitrary object binding.  The checker
// proves every field in the model, and the source either declares all of those
// fields at its callback boundary or immediately reconstructs that same model.
// Generic fields still have no family default; `undefined` is emitted only as
// the exact result of that static member read.  This keeps the container's
// native failure ownership while making the closed model agreement visible to
// the target grammar.
const collectClosedStructuralModelContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        ArrowFunction = -1,
        CallExpression = -1,
        Identifier = -1,
        ObjectBindingPattern = -1,
        ObjectLiteralExpression = -1,
        ParenthesizedExpression = -1,
        Parameter = -1,
        PropertyAccessExpression = -1,
        PropertyAssignment = -1
    } = getSyntaxKinds(typescript);
    const { getTypeAtLocation = false } = getObject(checker);
    let contracts = new Map();

    if (!hasTypeChecker(checker) || typeof getTypeAtLocation !== 'function') return contracts;

    const getName = (node = {}) => {
        const { text = '' } = getObject(node);

        return text;
    };
    const getPropertyNames = (node = {}) => {
        const type = getTypeAtLocation.call(checker, node);
        const { getProperties = false, getStringIndexType = false, getNumberIndexType = false } = getObject(type);

        if (typeof getProperties !== 'function' ||
            typeof getStringIndexType === 'function' && getStringIndexType.call(type) ||
            typeof getNumberIndexType === 'function' && getNumberIndexType.call(type)) return [];

        return getProperties.call(type).map((property = {}) => {
            const { getName: getPropertyName = false, flags = 0 } = getObject(property);
            const { SymbolFlags: { Optional = 0 } = {} } = typescript;

            return {
                name: typeof getPropertyName === 'function' ? getPropertyName.call(property) : '',
                optional: Boolean(Optional && flags & Optional)
            };
        }).filter(({ name = '', optional = false } = {}) => name && !optional);
    };
    const add = ({ node = {}, property = '', canonical = 'undefined', evidence = [] } = {}) => {
        const key = getConsumerContractKey(node);

        if (!key || !property) return;

        contracts = new Map([...contracts, [key, {
            key,
            action: 'exact-structural-field',
            canonical,
            property,
            theorem: 'closed-structural-model',
            evidence
        }]]);
    };
    const getFieldCanonical = (node = {}) => {
        const { canonical = '' } = getCheckerContract({ typescript, node, checker });

        return canonical || 'undefined';
    };
    const isClosedGenericArrayModel = (node = {}) => {
        const type = getTypeAtLocation.call(checker, node);
        const fields = getPropertyNames(node);
        const {
            getTypeOfPropertyOfType = false,
            isArrayType = false,
            isTupleType = false
        } = checker;
        const { TypeFlags: { TypeParameter = 0, Any = 0, Unknown = 0 } = {} } = typescript;

        if (!type || fields.length !== 2 || typeof getTypeOfPropertyOfType !== 'function') return false;

        const facts = fields.map(({ name = '' } = {}) => {
            const fieldType = getTypeOfPropertyOfType.call(checker, type, name);
            const { flags = 0 } = getObject(fieldType);
            const array = Boolean(fieldType) && (typeof isArrayType === 'function' && isArrayType.call(checker, fieldType) ||
                typeof isTupleType === 'function' && isTupleType.call(checker, fieldType));

            return { array, generic: Boolean((TypeParameter | Any | Unknown) & flags) };
        });

        return facts.filter(({ array = false } = {}) => array).length === 1 &&
            facts.filter(({ generic = false } = {}) => generic).length === 1;
    };
    const isExactGeneric = (node = {}) => {
        const { TypeFlags: { TypeParameter = 0, Any = 0, Unknown = 0 } = {} } = typescript;
        const { flags = 0 } = getObject(getTypeAtLocation.call(checker, node));

        return Boolean((TypeParameter | Any | Unknown) & flags);
    };
    const isClosedBindingModel = (parameter = {}) => {
        const { kind = 0, name = {} } = getObject(parameter);
        const { kind: nameKind = 0, elements = [] } = getObject(name);

        if (kind !== Parameter || nameKind !== ObjectBindingPattern || elements.length < 2) return false;

        const declaredFields = getPropertyNames(parameter);
        const boundFields = elements.map((element = {}) => {
            const { propertyName = {}, name: elementName = {} } = getObject(element);

            return getName(propertyName) || getName(elementName);
        }).filter(Boolean);
        const declaredNames = declaredFields.map(({ name = '' } = {}) => name);

        if (declaredNames.length !== boundFields.length ||
            !declaredNames.every(name => boundFields.includes(name))) return false;

        const contractsByField = elements.map((element = {}) => {
            const { name: elementName = {} } = getObject(element);

            return getCheckerContract({ typescript, node: elementName, checker });
        });
        const hasCanonicalField = contractsByField.some(({ canonical = '' } = {}) => canonical);
        const hasExactGenericField = contractsByField.some(({ kind = '' } = {}) => kind === 'required') ||
            elements.some(({ name: elementName = {} } = {}) => isExactGeneric(elementName));

        return hasCanonicalField && hasExactGenericField;
    };
    const collectBindingModel = (parameter = {}) => {
        if (!isClosedBindingModel(parameter)) return;

        const { name = {} } = getObject(parameter);
        const { elements = [] } = getObject(name);

        elements.forEach((element = {}) => {
            const { propertyName = {}, name: elementName = {} } = getObject(element);
            const property = getName(propertyName) || getName(elementName);

            add({
                node: element,
                property,
                canonical: getFieldCanonical(elementName),
                evidence: ['checker-proven closed structural parameter preserves exact generic fields']
            });
        });
    };
    const collectImmediateModelReturn = (node = {}) => {
        const { kind = 0, parameters = [], body = {} } = getObject(node);
        const [parameter = {}] = parameters;
        const { name = {} } = getObject(parameter);
        const { kind: parameterKind = 0, text: parameterName = '' } = getObject(name);
        const { kind: bodyKind = 0, expression: parenthesized = {} } = getObject(body);
        const modelBody = bodyKind === ParenthesizedExpression ? parenthesized : body;
        const { kind: modelBodyKind = 0, properties: modelProperties = [] } = getObject(modelBody);

        if (kind !== ArrowFunction || parameterKind !== Identifier || modelBodyKind !== ObjectLiteralExpression) return;

        const fields = getPropertyNames(parameter);
        const fieldNames = fields.map(({ name = '' } = {}) => name);

        // The Store pattern is a closed two-field model reconstructed by the
        // source itself. Requiring both output fields makes this a model law,
        // not a general member-access rewrite.
        if (fieldNames.length !== 2 || !fieldNames.includes('peek') || !fieldNames.includes('pos')) return;

        const outputNames = modelProperties
            .filter(({ kind: propertyKind = 0 } = {}) => propertyKind === PropertyAssignment)
            .map(({ name: propertyName = {} } = {}) => getName(propertyName));

        if (!fieldNames.every(field => outputNames.includes(field))) return;

        let hasReceiverInvocation = false;
        const inspectReceiverInvocation = (candidate = {}) => {
            const { expression = {}, kind: candidateKind = 0 } = getObject(candidate);
            const { kind: expressionKind = 0, expression: receiver = {} } = getObject(expression);
            const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);

            if (candidateKind === CallExpression &&
                expressionKind === PropertyAccessExpression && receiverKind === Identifier && receiverName === parameterName) {
                hasReceiverInvocation = true;
            }

            typescript.forEachChild(candidate, inspectReceiverInvocation);
        };

        inspectReceiverInvocation(modelBody);

        // A method call still owns its receiver. It must retain the model
        // parameter rather than turning a receiver protocol into a detached
        // callable binding.
        if (hasReceiverInvocation) return;

        const collectFieldRead = (candidate = {}) => {
            const { kind: candidateKind = 0, expression = {}, name: member = {} } = getObject(candidate);
            const { kind: receiverKind = 0, text: receiverName = '' } = getObject(expression);
            const memberName = getName(member);

            if (candidateKind === PropertyAccessExpression && receiverKind === Identifier &&
                receiverName === parameterName && fieldNames.includes(memberName)) add({
                node: candidate,
                property: memberName,
                evidence: ['checker-proven closed Store reconstruction preserves the source member value']
            });

            typescript.forEachChild(candidate, collectFieldRead);
        };

        modelProperties.forEach(({ initializer = {} } = {}) => collectFieldRead(initializer));
    };
    const visit = (node = {}) => {
        const { kind = 0, expression = {}, name = {} } = getObject(node);
        const { kind: expressionKind = 0 } = getObject(expression);
        const { text: property = '' } = getObject(name);

        if (kind === Parameter) collectBindingModel(node);

        if (kind === ArrowFunction) collectImmediateModelReturn(node);

        if (kind === PropertyAccessExpression && expressionKind === Identifier && property &&
            isClosedGenericArrayModel(expression)) add({
            node,
            property,
            canonical: getFieldCanonical(node),
            evidence: ['checker-proven closed generic-and-array model preserves exact static field values']
        });
    };

    census.select(Parameter, ArrowFunction, PropertyAccessExpression).forEach(visit);

    return contracts;
};

const isStandardLibrarySymbol = (symbol = {}) => {
    const { declarations = [] } = getObject(symbol);

    return declarations.some((declaration = {}) => {
        const { getSourceFile = false } = getObject(declaration);
        const source = typeof getSourceFile === 'function' ? getSourceFile.call(declaration) : {};

        return /(?:^|\/)lib\.[^/]+\.d\.ts$/.test(getObject(source).fileName);
    });
};

const isStandardArrayType = ({ typescript = {}, checker = {}, candidate = {} } = {}) => {
    const { getTypeAtLocation = false, isTupleType = false, getBaseTypes = false,
        getApparentType = false } = getObject(checker);

    if (typeof getTypeAtLocation !== 'function') return false;

    const type = getTypeAtLocation.call(checker, candidate);
    const hasArrayPart = (part = {}) => {
        if (typeof isTupleType === 'function' && isTupleType.call(checker, part)) return true;

        const { symbol: directSymbol = {}, target = {} } = getObject(part);
        const symbol = getObject(directSymbol).getName ? directSymbol : getObject(target).symbol;
        const { getName = false } = getObject(symbol);
        const name = typeof getName === 'function' ? getName.call(symbol) : '';

        return ['Array', 'ReadonlyArray'].includes(name) && isStandardLibrarySymbol(symbol);
    };
    const { TypeFlags: { Intersection: IntersectionFlag = 0 } = {},
        ObjectFlags: { Class: ClassFlag = 0, Interface: InterfaceFlag = 0,
            Reference: ReferenceFlag = 0, Mapped: MappedFlag = 0 } = {} } = typescript;
    let seen = new Set();
    const hasArrayEvidence = (part = {}) => {
        if (seen.has(part)) return false;

        seen = new Set([...seen, part]);

        if (hasArrayPart(part)) return true;

        const { flags = 0, types = [], objectFlags = 0 } = getObject(part);

        if (IntersectionFlag && flags & IntersectionFlag &&
            Array.isArray(types) && types.some(hasArrayEvidence)) return true;

        if (MappedFlag && objectFlags & MappedFlag &&
            typeof getApparentType === 'function' &&
            hasArrayEvidence(getApparentType.call(checker, part))) return true;

        const baseTypes = typeof getBaseTypes === 'function' &&
            objectFlags & (ClassFlag | InterfaceFlag | ReferenceFlag)
            ? getBaseTypes.call(checker, part) : [];

        return Array.isArray(baseTypes) && baseTypes.some(hasArrayEvidence);
    };

    return hasArrayEvidence(type);
};

const getStandardCollectionFamily = ({ typescript = {}, checker = {}, candidate = {} } = {}) => {
    const { getTypeAtLocation = false, typeToString = false } = getObject(checker);

    if (typeof getTypeAtLocation !== 'function') return '';

    const { getOriginalNode = false } = typescript;
    const original = typeof getOriginalNode === 'function' ? getOriginalNode(candidate) : candidate;
    const checkerNode = getObject(original).parent ? original : candidate;

    if (!getObject(checkerNode).parent) return '';

    const type = getTypeAtLocation.call(checker, checkerNode);
    const { symbol = {} } = getObject(type);
    const { getName = false } = getObject(symbol);
    const symbolName = typeof getName === 'function' ? getName.call(symbol) : '';
    const typeName = typeof typeToString === 'function' ? typeToString.call(checker, type) : '';
    const [typeMatch = ''] = typeName.match(/^(Readonly)?(Map|Set)(?:<|$)/) || [];
    const name = ['Map', 'ReadonlyMap', 'Set', 'ReadonlySet'].includes(symbolName)
        ? symbolName
        : typeMatch;

    return ['Map', 'ReadonlyMap', 'Set', 'ReadonlySet'].includes(name) &&
        (isStandardLibrarySymbol(symbol) || /^(Readonly)?(Map|Set)(?:<|$)/.test(typeName))
        ? name.replace('Readonly', '')
        : '';
};

const collectCollectionReconstructionContracts = ({
    typescript = {}, sourceFile = {}, checker = {},
    census = createSourceCensus({ typescript, sourceFile }),
    bindingReferences = collectBindingReferences({ typescript, sourceFile, checker, census })
} = {}) => {
    const {
        Block = -1,
        VariableStatement = -1,
        VariableDeclaration = -1,
        Identifier = -1,
        NewExpression = -1,
        PropertyAccessExpression = -1,
        CallExpression = -1,
        ReturnStatement = -1,
        ArrayLiteralExpression = -1,
        PropertySignature = -1,
        ElementAccessExpression = -1,
        NumericLiteral = -1,
        FunctionDeclaration = -1,
        FunctionExpression = -1,
        ArrowFunction = -1,
        WhileStatement = -1,
        DoStatement = -1,
        ForStatement = -1,
        ForInStatement = -1,
        ForOfStatement = -1,
        AwaitExpression = -1,
        AsyncKeyword = -1,
        BreakStatement = -1,
        ContinueStatement = -1,
        ArrayBindingPattern = -1,
        ObjectBindingPattern = -1,
        SpreadElement = -1,
        IfStatement = -1,
        ExpressionStatement = -1,
        BinaryExpression = -1,
        PrefixUnaryExpression = -1,
        ParenthesizedExpression = -1,
        YieldExpression = -1,
        FirstAssignment = -1,
        LastAssignment = -1
    } = getSyntaxKinds(typescript);
    const {
        getTypeAtLocation = false,
        getTypeOfSymbolAtLocation = false,
        getSymbolAtLocation = false,
        getBaseTypes = false,
        isTupleType = false,
        isArrayType = false
    } = getObject(checker);
    let contracts = new Map();

    const isNestedFunction = (node = {}) => [FunctionDeclaration, FunctionExpression, ArrowFunction]
        .includes(getObject(node).kind);
    const getFunctionOwnerName = (node = {}) => {
        let current = node;

        // eslint-disable-next-line resilient/prefer-prototype-methods -- Declaration-owner lookup matches initializer identity, then stops self-parent or missing kind.
        while (current) {
            const { parent = {} } = getObject(current);
            const { kind = 0, name = {}, initializer = {} } = getObject(parent);
            const { kind: nameKind = 0, text = '' } = getObject(name);

            if (kind === VariableDeclaration && initializer === current && nameKind === Identifier && text) return text;

            if (!getObject(parent).kind || parent === current) return '';

            current = parent;
        }

        return '';
    };
    const isStandardForEachCallback = ({ node = {}, parent = {} } = {}) => {
        const { modifiers = [], asteriskToken = false } = getObject(node);

        if (asteriskToken || modifiers.some(({ kind = 0 } = {}) => kind === AsyncKeyword)) return false;

        const { kind: parentKind = 0, expression: callee = {}, arguments: args = [] } = getObject(parent);
        const [callback = {}] = args;
        const { kind: calleeKind = 0, expression: receiver = {}, name: method = {} } = getObject(callee);
        const { text: methodName = '' } = getObject(method);

        if (parentKind !== CallExpression || calleeKind !== PropertyAccessExpression || methodName !== 'forEach' ||
            args.length !== 1 || callback !== node || typeof getTypeAtLocation !== 'function') return false;

        const type = getTypeAtLocation.call(checker, receiver);
        const { symbol = {} } = getObject(type);
        const { declarations = [], getName = false } = getObject(symbol);
        const name = typeof getName === 'function' ? getName.call(symbol) : '';

        return ['Set', 'ReadonlySet'].includes(name) && declarations.some((declaration = {}) => {
            const { getSourceFile = false } = getObject(declaration);
            const source = typeof getSourceFile === 'function' ? getSourceFile.call(declaration) : {};

            return /(?:^|\/)lib\.[^/]+\.d\.ts$/.test(getObject(source).fileName);
        });
    };
    const isLoop = (node = {}) => [WhileStatement, DoStatement, ForStatement, ForInStatement, ForOfStatement]
        .includes(getObject(node).kind);
    const getIteratorResultBinding = (statement = {}) => {
        const { kind = 0, expression = {}, statement: body = {} } = getObject(statement);
        const { kind: expressionKind = 0, operator = 0, operand = {} } = getObject(expression);
        const { kind: operandKind = 0, expression: parenthesized = {}, name: done = {} } = getObject(operand);
        const { kind: parenthesizedKind = 0, expression: assignment = {} } = getObject(parenthesized);
        const { kind: assignmentKind = 0, left = {}, right = {} } = getObject(assignment);
        const { kind: stateKind = 0, text: stateName = '' } = getObject(left);
        const { kind: nextKind = 0, expression: nextCallee = {} } = getObject(right);
        const { kind: nextCalleeKind = 0, name: next = {} } = getObject(nextCallee);
        const { text: doneName = '' } = getObject(done);
        const { text: nextName = '' } = getObject(next);
        const { kind: bodyKind = 0, statements: bodyStatements = [] } = getObject(body);
        const [bindingStatement = {}] = bodyStatements;
        const { kind: bindingStatementKind = 0, declarationList = {} } = getObject(bindingStatement);
        const { declarations = [] } = getObject(declarationList);
        const [binding = {}] = declarations;
        const { kind: bindingKind = 0, name: alias = {}, initializer = {} } = getObject(binding);
        const { kind: aliasKind = 0, text: aliasName = '' } = getObject(alias);
        const { kind: valueKind = 0, expression: receiver = {}, name: value = {} } = getObject(initializer);
        const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);
        const { text: valueName = '' } = getObject(value);
        const { SyntaxKind = {}, TypeFlags = {}, getOriginalNode = false } = getObject(typescript);
        const { ExclamationToken = -1 } = getObject(SyntaxKind);
        const { BooleanLiteral = 0 } = getObject(TypeFlags);
        const { parent = false } = getObject(left);
        const original = typeof getOriginalNode === 'function'
            ? getOriginalNode(left)
            : left;
        const type = typeof getTypeAtLocation === 'function' && parent
            ? getTypeAtLocation.call(checker, original)
            : {};
        const { getProperty = false } = getObject(type);
        const doneProperty = typeof getProperty === 'function' ? getProperty.call(type, 'done') : false;
        const valueProperty = typeof getProperty === 'function' ? getProperty.call(type, 'value') : false;
        const doneType = doneProperty && typeof getTypeOfSymbolAtLocation === 'function'
            ? getTypeOfSymbolAtLocation.call(checker, doneProperty, right)
            : {};
        const { isUnion = false, types: unionParts = [], flags: doneFlags = 0 } = getObject(doneType);
        const doneParts = typeof isUnion === 'function' && isUnion.call(doneType)
            ? unionParts
            : [doneType];
        const checkerProvesIteratorResult = Boolean(doneProperty && valueProperty) &&
            doneParts.some(({ flags = 0 } = {}) => Boolean(flags & BooleanLiteral || doneFlags & BooleanLiteral));
        const key = getConsumerContractKey(initializer);

        return kind === WhileStatement && expressionKind === PrefixUnaryExpression && operator === ExclamationToken &&
            operandKind === PropertyAccessExpression && doneName === 'done' &&
            parenthesizedKind === ParenthesizedExpression && assignmentKind === BinaryExpression &&
            stateKind === Identifier && stateName && nextKind === CallExpression &&
            nextCalleeKind === PropertyAccessExpression && nextName === 'next' &&
            bodyKind === Block && bindingStatementKind === VariableStatement && declarations.length === 1 &&
            bindingKind === VariableDeclaration && aliasKind === Identifier && aliasName &&
            valueKind === PropertyAccessExpression && receiverKind === Identifier && receiverName === stateName &&
            valueName === 'value' && checkerProvesIteratorResult && key
            ? { key, stateName, aliasName }
            : {};
    };
    // A collection reconstructed across one of these loop boundaries would
    // change observable staging or termination. Those loops remain a source
    // boundary until their entire control-flow agreement is understood.
    const hasObservableLoopBoundary = (node = {}) => {
        const { kind: loopKind = 0, awaitModifier = false } = getObject(node);

        if (loopKind === ForOfStatement && awaitModifier) return true;

        let found = false;
        const visitLoop = (candidate = {}) => {
            if (found || isNestedFunction(candidate)) return;

            const { kind: candidateKind = 0 } = getObject(candidate);

            if ([AwaitExpression, BreakStatement, ContinueStatement, ReturnStatement].includes(candidateKind)) {
                found = true;

                return;
            }

            typescript.forEachChild(candidate, visitLoop);
        };

        typescript.forEachChild(node, visitLoop);

        return found;
    };
    const isStandardCollection = (initializer = {}) => {
        const { kind = 0, expression = {}, arguments: args = [] } = getObject(initializer);
        const { kind: expressionKind = 0, text = '' } = getObject(expression);

        if (kind !== NewExpression || expressionKind !== Identifier || !['Map', 'Set'].includes(text) || args.length > 1) {
            return '';
        }

        // The type check rejects a locally declared look-alike constructor.
        // It is intentionally structural rather than package/name based.
        if (typeof getTypeAtLocation !== 'function') return '';

        const type = getTypeAtLocation.call(checker, initializer);
        const { symbol = {} } = getObject(type);
        const { getName = false } = getObject(symbol);
        const typeName = typeof getName === 'function' ? getName.call(symbol) : '';
        const constructorSymbol = typeof getSymbolAtLocation === 'function'
            ? getSymbolAtLocation.call(checker, expression)
            : {};
        const { declarations = [] } = getObject(constructorSymbol);
        const isStandardLibraryConstructor = declarations.some((declaration = {}) => {
            const { getSourceFile = false } = getObject(declaration);
            const source = typeof getSourceFile === 'function' ? getSourceFile.call(declaration) : {};
            const { fileName = '' } = getObject(source);

            return /(?:^|\/)lib\.[^/]+\.d\.ts$/.test(fileName);
        });

        // Some compiler hosts expose the global constructor only through its
        // instance type. In that case the checked `Map`/`Set` instance name is
        // the available standard-library fact; an explicitly declared local
        // constructor is rejected by its non-lib declaration below.
        const isImplicitGlobal = !constructorSymbol || !declarations.length;

        return typeName === text && (isImplicitGlobal || isStandardLibraryConstructor) ? text : '';
    };
    const collectionFamily = (candidate = {}) => getStandardCollectionFamily({
        typescript, checker, candidate
    });
    const getDirectMaterialization = (loopSource = {}) => {
        const { kind = 0, elements = [], expression: callee = {}, arguments: args = [] } = getObject(loopSource);
        const { kind: calleeKind = 0, expression: calleeReceiver = {}, name: calleeName = {} } = getObject(callee);
        const { kind: calleeReceiverKind = 0, text: calleeReceiverName = '' } = getObject(calleeReceiver);
        const { text: calleeMemberName = '' } = getObject(calleeName);
        const [spread = {}] = elements;
        const { kind: spreadKind = 0, expression: spreadSource = {} } = getObject(spread);
        const [arrayFromSource = {}] = args;
        const { kind: arrayFromSourceKind = 0, expression: methodCallee = {} } = getObject(arrayFromSource);
        const { kind: methodCalleeKind = 0, expression: methodReceiver = {}, name: methodName = {} } = getObject(methodCallee);
        const { kind: methodReceiverKind = 0 } = getObject(methodReceiver);
        const { text: methodText = '' } = getObject(methodName);
        const isArrayFromSyntax = kind === CallExpression && calleeKind === PropertyAccessExpression &&
            calleeReceiverKind === Identifier && calleeReceiverName === 'Array' && calleeMemberName === 'from' &&
            args.length === 1;
        const isSpread = kind === ArrayLiteralExpression && elements.length === 1 && spreadKind === SpreadElement;
        const directSource = isSpread ? spreadSource : arrayFromSource;
        const directFamily = isSpread || isArrayFromSyntax ? collectionFamily(directSource) : '';
        const methodFamily = isArrayFromSyntax && arrayFromSourceKind === CallExpression &&
            methodCalleeKind === PropertyAccessExpression && methodReceiverKind === Identifier
            ? collectionFamily(methodReceiver)
            : '';
        const methodAllowed = methodFamily === 'Map' && methodText === 'entries' ||
            methodFamily === 'Set' && methodText === 'values';
        const family = directFamily || (methodAllowed ? methodFamily : '');

        return (isSpread && directFamily || isArrayFromSyntax && family)
            ? { family, form: isSpread ? 'spread' : 'array-from', sourceRange: getConsumerContractKey(loopSource) }
            : {};
    };
    const getFreshDeclaration = (statement = {}) => {
        const { kind = 0, declarationList = {} } = getObject(statement);
        const { declarations = [] } = getObject(declarationList);
        const [declaration = {}] = declarations;
        const { kind: declarationKind = 0, name: binding = {}, initializer = {} } = getObject(declaration);
        const { kind: nameKind = 0, text: name = '' } = getObject(binding);
        const type = kind === VariableStatement && declarations.length === 1 && declarationKind === VariableDeclaration &&
            nameKind === Identifier && name ? isStandardCollection(initializer) : '';
        const { arguments: args = [] } = getObject(initializer);
        const [source = {}] = args;

        return type ? {
            declaration,
            name,
            type,
            freshness: args.length ? 'copy' : 'empty',
            sourceRange: args.length ? getConsumerContractKey(source) : ''
        } : {};
    };
    const getOwnedUse = ({ node = {}, parent = {}, grandparent = {}, name = '', type = '' } = {}) => {
        const { kind = 0, text = '' } = getObject(node);

        if (kind !== Identifier || text !== name) return '';

        const { kind: parentKind = 0, expression = {}, name: property = {} } = getObject(parent);
        const { kind: receiverKind = 0, text: receiver = '' } = getObject(expression);
        const { text: method = '' } = getObject(property);
        const isUpdate = parentKind === PropertyAccessExpression && receiverKind === Identifier && receiver === name &&
            ((type === 'Map' && ['set', 'delete'].includes(method)) || (type === 'Set' && method === 'add'));

        if (isUpdate) return 'update';

        // A computed receiver/member cannot be the finite Map#set or Set#add
        // grammar, even if its runtime spelling happens to match one. Keep
        // that operation explicit rather than calling it an escaped value.
        if (parentKind === ElementAccessExpression) return 'computed-update';

        const { kind: grandparentKind = 0 } = getObject(grandparent);
        // A direct return owns every argument of its call.  A fresh local
        // accumulator passed to `return pair(left, right)` cannot be
        // observed before the handoff, just as one passed to
        // `return finish(result)` cannot.  Arity is not an escape fact.
        const isReturnedArgument = parentKind === CallExpression && grandparentKind === ReturnStatement;
        const isReturnedArrayElement = parentKind === ArrayLiteralExpression && grandparentKind === ReturnStatement;

        return parentKind === ReturnStatement || isReturnedArgument || isReturnedArrayElement ? 'return' : 'escape';
    };
    const inspectBlock = (block = {}, functionRange = '', ownerName = '') => {
        const { kind = 0, statements = [] } = getObject(block);

        if (kind !== Block) return;

        statements.forEach((statement = {}, declarationIndex = 0) => {
            const {
                declaration = {}, name = '', type = '', freshness = '', sourceRange = ''
            } = getFreshDeclaration(statement);

            if (!name) return;

            let valid = true;
            let boundaryReason = '';
            let updates = 0;
            let returns = 0;
            let mutationSites = [];
            const collectTuplePositions = (candidate = {}) => {
                const { kind: candidateKind = 0, expression: container = {}, argumentExpression = {} } = getObject(candidate);
                const { kind: containerKind = 0 } = getObject(container);
                const { kind: indexKind = 0, text: indexText = '' } = getObject(argumentExpression);
                const index = Number(indexText);
                const position = candidateKind === ElementAccessExpression && containerKind === PropertyAccessExpression &&
                    indexKind === NumericLiteral && Number.isInteger(index) && index >= 0 &&
                    typeof getTypeAtLocation === 'function' && typeof isTupleType === 'function' &&
                    isTupleType.call(checker, getTypeAtLocation.call(checker, container))
                    ? [{
                        key: getConsumerContractKey(candidate),
                        index,
                        sourceRange: getConsumerContractKey(container)
                    }]
                    : [];
                let nestedPositions = [];

                typescript.forEachChild(candidate, (child) => {
                    nestedPositions = [...nestedPositions, ...collectTuplePositions(child)];
                });

                return [...position, ...nestedPositions];
            };
            const inspect = (node = {}, parent = {}, grandparent = {}, isRoot = false) => {
                if (!valid) return;

                if (!isRoot && isNestedFunction(node) && !isStandardForEachCallback({ node, parent })) {
                    let captured = false;
                    const findCapture = (candidate = {}) => {
                        const { kind: candidateKind = 0, text: candidateText = '' } = getObject(candidate);

                        if (candidateKind === Identifier && candidateText === name) captured = true;

                        if (!captured) typescript.forEachChild(candidate, findCapture);
                    };

                    typescript.forEachChild(node, findCapture);

                    valid = captured ? false : valid;
                    boundaryReason = captured ? boundaryReason || 'external-or-escaped' : boundaryReason;

                    return;
                }

                if (isLoop(node) && hasObservableLoopBoundary(node)) {
                    valid = false;
                    boundaryReason = boundaryReason || 'observable-loop';

                    return;
                }

                const use = getOwnedUse({ node, parent, grandparent, name, type });

                if (use === 'escape') {
                    valid = false;
                    boundaryReason = boundaryReason || 'external-or-escaped';
                }

                if (use === 'computed-update') {
                    valid = false;
                    boundaryReason = boundaryReason || 'computed-update';
                }

                if (use === 'update') updates += 1;

                if (use === 'return') returns += 1;

                typescript.forEachChild(node, child => inspect(child, node, parent));
            };

            statements.forEach((candidate = {}) => {
                if (candidate !== statement) inspect(candidate, {}, {}, true);
            });

            const collectUpdates = (candidate = {}) => {
                if (isNestedFunction(candidate)) return;

                const { kind: candidateKind = 0, expression = {}, arguments: args = [] } = getObject(candidate);
                const { kind: calleeKind = 0, expression: receiver = {}, name: method = {} } = getObject(expression);
                const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);
                const { text: methodName = '' } = getObject(method);
                const isUpdate = candidateKind === CallExpression && calleeKind === PropertyAccessExpression && receiverKind === Identifier &&
                    receiverName === name && ((type === 'Map' && ['set', 'delete'].includes(methodName)) || (type === 'Set' && methodName === 'add'));

                if (isUpdate) {
                    mutationSites = [...mutationSites, {
                        key: getConsumerContractKey(candidate),
                        method: methodName,
                        positions: args.flatMap((argument = {}) => {
                            return collectTuplePositions(argument).map(position => ({
                                ...position,
                                argumentRange: getConsumerContractKey(argument)
                            }));
                        })
                    }];
                }

                typescript.forEachChild(candidate, collectUpdates);
            };

            statements.forEach((candidate) => {
                if (candidate !== statement) collectUpdates(candidate);
            });
            const precedingTuplePositions = statements.slice(0, declarationIndex).flatMap((candidate = {}) => (
                collectTuplePositions(candidate).map((position = {}) => ({
                    ...position,
                    statementRange: getConsumerContractKey(candidate)
                }))
            ));

            const getMaterializedAccumulatorOperation = () => {
                const [loop = {}, returned = {}] = statements.slice(declarationIndex + 1, declarationIndex + 3);
                const {
                    kind: loopKind = 0, initializer: declarationList = {}, expression: loopSource = {}, statement: loopBody = {}
                } = getObject(loop);
                const { declarations = [] } = getObject(declarationList);
                const [loopDeclaration = {}] = declarations;
                const { name: item = {} } = getObject(loopDeclaration);
                const { kind: itemKind = 0, elements: itemElements = [] } = getObject(item);
                const { kind: returnKind = 0, expression: returnValue = {} } = getObject(returned);
                const { kind: returnValueKind = 0, text: returnName = '' } = getObject(returnValue);
                const getSingleLoopStatement = (candidate = {}) => {
                    const { kind: candidateKind = 0, statements: loopStatements = [] } = getObject(candidate);
                    const [statement = candidate] = loopStatements;

                    return candidateKind === Block && loopStatements.length === 1 ? statement : candidate;
                };
                const isStaticUpdate = (candidate = {}) => {
                    const { kind: candidateKind = 0, expression = {} } = getObject(candidate);
                    const { kind: expressionKind = 0, expression: callee = {} } = getObject(expression);
                    const { kind: calleeKind = 0, expression: receiver = {}, name: method = {} } = getObject(callee);
                    const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);
                    const { text: methodName = '' } = getObject(method);
                    const expectedMethod = type === 'Map' ? 'set' : 'add';

                    return candidateKind === ExpressionStatement && expressionKind === CallExpression &&
                        calleeKind === PropertyAccessExpression && receiverKind === Identifier && receiverName === name &&
                        methodName === expectedMethod;
                };
                const body = getSingleLoopStatement(loopBody);
                const { kind: bodyKind = 0, elseStatement = false, thenStatement = {} } = getObject(body);
                const guarded = bodyKind === IfStatement && !elseStatement;
                const updateStatement = guarded ? getSingleLoopStatement(thenStatement) : body;
                const hasSupportedUpdate = isStaticUpdate(updateStatement);
                const { expression: updateCall = {} } = getObject(updateStatement);
                const { arguments: updateArguments = [] } = getObject(updateCall);
                const { expression: condition = {} } = getObject(body);
                const hasSupportedMapItem = type === 'Map' && itemKind === ArrayBindingPattern &&
                    itemElements.length === 2 && itemElements.every((element = {}) => {
                    const { name: binding = {} } = getObject(element);

                    return getObject(binding).kind === Identifier;
                });
                const hasSupportedSetItem = type === 'Set' && [Identifier, ArrayBindingPattern, ObjectBindingPattern]
                    .includes(itemKind);
                const materialization = getDirectMaterialization(loopSource);
                const { family: materializedFamily = '' } = getObject(materialization);
                const materializationMatchesOutput = !materializedFamily || materializedFamily === type;
                const directLiveCollection = Boolean(collectionFamily(loopSource)) && !materializedFamily;
                const hasUnsafeReductionPart = (candidate = {}) => {
                    let unsafe = false;
                    const visitPart = (part = {}) => {
                        const { kind: partKind = 0, text = '', operatorToken = {} } = getObject(part);
                        const { kind: operatorKind = 0 } = getObject(operatorToken);

                        if (partKind === AwaitExpression || partKind === YieldExpression ||
                            partKind === BinaryExpression && operatorKind >= FirstAssignment &&
                            operatorKind <= LastAssignment || partKind === Identifier && text === name) {
                            unsafe = true;

                            return;
                        }

                        typescript.forEachChild(part, visitPart);
                    };

                    visitPart(candidate);

                    return unsafe;
                };
                const validArguments = type === 'Map' ? updateArguments.length === 2 : updateArguments.length === 1;
                const safeArguments = updateArguments.every(arg => !hasUnsafeReductionPart(arg));
                const safeCondition = !guarded || !hasUnsafeReductionPart(condition);

                if (!['Map', 'Set'].includes(type) || freshness !== 'empty' || loopKind !== ForOfStatement ||
                    declarations.length !== 1 || returnKind !== ReturnStatement ||
                    returnValueKind !== Identifier || returnName !== name ||
                    mutationSites.length !== 1 || !hasSupportedUpdate ||
                    !(hasSupportedMapItem || hasSupportedSetItem) ||
                    !materializationMatchesOutput) return {};

                if (directLiveCollection) return { materialization, directLiveCollection, loopRange: getConsumerContractKey(loop) };

                return isArrayLikeExpression({ checker, node: loopSource }) && validArguments &&
                    safeArguments && safeCondition
                    ? {
                        operation: `${type.toLowerCase()}-accumulator`,
                        materialization,
                        reduction: {
                            source: loopSource,
                            item,
                            values: updateArguments,
                            condition: guarded ? condition : false,
                            operation: guarded ? 'filter-map' : 'map',
                            loopRange: getConsumerContractKey(loop),
                            returnRange: getConsumerContractKey(returned)
                        }
                    }
                    : {};
            };
            const {
                operation = '', materialization = {}, directLiveCollection = false, loopRange = '', reduction = {}
            } = getMaterializedAccumulatorOperation();
            const iteratorResultBindings = statements
                .slice(declarationIndex + 1)
                .map(getIteratorResultBinding)
                .filter(({ key = '' } = {}) => key);
            const hasOwnedSynchronousLoop = statements.slice(declarationIndex + 1).some((candidate = {}) => {
                const { pos = -1, end = -1 } = getObject(candidate);
                const containsUpdate = mutationSites.some(({ key: updateRange = '' } = {}) => {
                    const [start = -1, finish = -1] = updateRange.split(':').map(Number);

                    return start >= pos && finish <= end;
                });

                return isLoop(candidate) && !hasObservableLoopBoundary(candidate) &&
                    (freshness === 'empty' || containsUpdate);
            });

            const key = getConsumerContractKey(declaration);
            const methods = mutationSites.map(({ method = '' } = {}) => method);
            const hasOnlyStaticUpdates = methods.every(method => (
                (type === 'Map' && ['set', 'delete'].includes(method)) || (type === 'Set' && method === 'add')
            ));
            const getSymbolOwnedMutationSites = () => {
                if (typeof getSymbolAtLocation !== 'function') return [];

                const ownerSymbol = getSymbolAtLocation.call(checker, getObject(declaration).name);
                const recorded = new Set(mutationSites.map(({ key = '' } = {}) => key));

                return (bindingReferences.get(ownerSymbol) || []).flatMap((receiver = {}) => {
                    const { parent: callee = {}, text: receiverName = '', pos = -1, end = -1 } = getObject(receiver);
                    const { parent: candidate = {}, kind: calleeKind = 0, expression = {}, name: member = {} } = getObject(callee);
                    const { kind: candidateKind = 0, expression: callTarget = {} } = getObject(candidate);
                    const { text: method = '' } = getObject(member);
                    const key = getConsumerContractKey(candidate);
                    const inSiblingStatement = statements.some(sourceStatement => sourceStatement !== statement &&
                        pos >= getObject(sourceStatement).pos && end <= getObject(sourceStatement).end);
                    const mutation = ownerSymbol && receiverName === name && expression === receiver &&
                        candidateKind === CallExpression && callTarget === callee &&
                        calleeKind === PropertyAccessExpression && inSiblingStatement &&
                        ((type === 'Map' && ['set', 'delete'].includes(method)) || (type === 'Set' && method === 'add'));

                    return mutation && !recorded.has(key) ? [{ key, method, positions: [] }] : [];
                });
            };
            const publishedMutationSites = [...mutationSites, ...getSymbolOwnedMutationSites()];

            contracts = new Map([...contracts, [key, {
                key,
                sourceRange: key,
                collection: {
                    name,
                    type,
                    freshness,
                    functionRange,
                    ownerName,
                    scopeRange: getConsumerContractKey(block),
                    sourceRange,
                    updates,
                    returns,
                    operation,
                    materialization,
                    reduction,
                    directLiveCollection,
                    loopRange,
                    mutationSites: publishedMutationSites,
                    probeKeys: [],
                    tuplePositions: mutationSites.flatMap(({ positions = [] } = {}) => positions),
                    precedingTuplePositions,
                    iteratorResultBindings
                },
                ownership: { valid, boundaryReason, staticUpdates: hasOnlyStaticUpdates, synchronousLoop: hasOwnedSynchronousLoop },
                theorem: 'fresh collection state is unescaped and returned by its owning block',
                evidence: [
                    'checker-proven standard collection construction',
                    'all collection references are direct owned updates or returns',
                    'no nested callback can observe collection identity',
                    ...(operation ? [`checker-proven materialized ${type} traversal has one direct return`] : [])
                ]
            }]]);
        });

        statements.forEach(statement => typescript.forEachChild(
            statement,
            child => inspectBlock(child, functionRange, ownerName)
        ));
    };

    // An opaque provider receives both a fresh seed and a callback. It may
    // retain the seed or compare it with each callback result, so a direct
    // callback update cannot be replaced by a newly allocated accumulator.
    const inspectProviderAccumulator = (call = {}) => {
        const { kind = 0, expression: callee = {}, arguments: args = [] } = getObject(call);
        const { kind: calleeKind = 0, name: method = {}, questionDotToken = false } = getObject(callee);
        const [input = {}, seed = {}, callback = {}] = args;
        const { kind: seedKind = 0, elements: seedElements = [], arguments: seedArgs = [] } = getObject(seed);
        const { kind: callbackKind = 0, parameters = [], body = {} } = getObject(callback);
        const [firstParameter = {}] = parameters;
        const { name: accumulator = {} } = getObject(firstParameter);
        const { kind: bodyKind = 0, statements = [] } = getObject(body);
        const [lastStatement = {}] = statements.slice(-1);
        const { expression: returned = {} } = getObject(lastStatement);

        if (kind !== CallExpression || calleeKind !== PropertyAccessExpression || questionDotToken ||
            getObject(method).text !== 'reduce' || args.length !== 3 || !getObject(input).kind ||
            ![ArrowFunction, FunctionExpression].includes(callbackKind) || parameters.length < 1 ||
            getObject(accumulator).kind !== Identifier || bodyKind !== Block ||
            getObject(lastStatement).kind !== ReturnStatement) return;

        const getSymbol = (candidate = {}) => typeof getSymbolAtLocation === 'function'
            ? getSymbolAtLocation.call(checker, candidate)
            : false;
        const accumulatorSymbol = getSymbol(accumulator);
        const isAccumulator = (candidate = {}) => getObject(candidate).kind === Identifier &&
            accumulatorSymbol && getSymbol(candidate) === accumulatorSymbol;
        const methodSymbol = getSymbol(method);
        const { declarations: methodDeclarations = [] } = getObject(methodSymbol);
        const opaqueProvider = methodDeclarations.some(({ kind: declarationKind = 0 } = {}) => (
            declarationKind === PropertySignature
        ));
        let seedFamily = '';

        if (seedKind === ArrayLiteralExpression && !seedElements.length) seedFamily = 'Array';

        if (seedKind === NewExpression && !seedArgs.length) seedFamily = isStandardCollection(seed);

        const parameterType = typeof getTypeAtLocation === 'function' && accumulatorSymbol
            ? getTypeAtLocation.call(checker, accumulator)
            : {};
        const parameterFamily = typeof isArrayType === 'function' && isArrayType.call(checker, parameterType)
            ? 'Array'
            : collectionFamily(accumulator);

        if (!opaqueProvider || !seedFamily || seedFamily !== parameterFamily ||
            !isAccumulator(returned)) return;

        let rejected = false;
        let mutationSites = [];
        const inspectCallback = (candidate = {}) => {
            if (rejected) return;

            const { kind: candidateKind = 0, expression = {}, initializer = {} } = getObject(candidate);

            if (candidate !== callback && isNestedFunction(candidate)) {
                rejected = true;

                return;
            }

            if (candidateKind === VariableDeclaration && isAccumulator(initializer)) rejected = true;

            if (candidateKind === ElementAccessExpression && isAccumulator(expression)) rejected = true;

            const { kind: expressionKind = 0, expression: invoked = {}, arguments: updateArgs = [] } = getObject(expression);
            const { kind: invokedKind = 0, expression: receiver = {}, name: updateName = {} } = getObject(invoked);
            const methodName = getObject(updateName).text || '';
            const validUpdate = seedFamily === 'Array' && methodName === 'push' && updateArgs.length === 1 ||
                seedFamily === 'Map' && methodName === 'set' && updateArgs.length === 2;

            if (candidateKind === ExpressionStatement && expressionKind === CallExpression &&
                invokedKind === PropertyAccessExpression && isAccumulator(receiver) && validUpdate) {
                mutationSites = [...mutationSites, {
                    key: getConsumerContractKey(expression),
                    statementRange: getConsumerContractKey(candidate),
                    memberRange: getConsumerContractKey(invoked)
                }];
            }

            typescript.forEachChild(candidate, inspectCallback);
        };

        inspectCallback(body);

        if (rejected || !mutationSites.length) return;

        const callRange = getConsumerContractKey(call);
        const callbackRange = getConsumerContractKey(callback);
        const contract = {
            key: callRange,
            sourceRange: callRange,
            action: 'operational-collection-builder',
            theorem: 'provider-retains-accumulator-identity',
            collection: {
                type: seedFamily,
                callbackOwned: true,
                callbackRange,
                seedRange: getConsumerContractKey(seed),
                mutationSites
            },
            evidence: [
                'checker-proven fresh accumulator seed and same-family callback parameter',
                'opaque provider receives the seed and callback and can observe accumulator identity',
                'direct static callback update and direct accumulator return retain source effects'
            ]
        };

        contracts = new Map([...contracts, [callRange, contract], [callbackRange, contract],
            ...mutationSites.flatMap(({ statementRange = '', memberRange = '' } = {}) => (
                [[statementRange, contract], [memberRange, contract]]
            ))]);
    };

    // A callback parameter is owned by its provider, even when a local
    // binding selects a collection from it. The provider can retain that
    // parameter or hand the same value to another callback before this update.
    const inspectCallbackParameterUpdate = (call = {}) => {
        const { kind = 0, expression: member = {}, arguments: updateArgs = [] } = getObject(call);
        const { kind: memberKind = 0, expression: receiver = {}, name: updateName = {} } = getObject(member);
        const { text: methodName = '' } = getObject(updateName);
        const callRange = getConsumerContractKey(call);
        const { parent: statement = {} } = getObject(call);
        const statementRange = getObject(statement).kind === ExpressionStatement
            ? getConsumerContractKey(statement)
            : '';

        if (kind !== CallExpression || memberKind !== PropertyAccessExpression || contracts.has(callRange) ||
            contracts.has(getConsumerContractKey(member)) ||
            statementRange && contracts.has(statementRange)) return;

        const receiverType = typeof getTypeAtLocation === 'function'
            ? getTypeAtLocation.call(checker, receiver)
            : {};
        const hasStandardArrayBase = (type = {}) => {
            if (typeof isArrayType === 'function' && isArrayType.call(checker, type)) return true;

            const { symbol = {} } = getObject(type);
            const { declarations = [] } = getObject(symbol);
            const { InterfaceDeclaration = -1, ClassDeclaration = -1 } = getSyntaxKinds(typescript);
            const hasBaseDeclaration = declarations.some(({ kind = 0 } = {}) => (
                kind === InterfaceDeclaration || kind === ClassDeclaration
            ));
            const bases = typeof getBaseTypes === 'function' && hasBaseDeclaration
                ? getBaseTypes.call(checker, type) || []
                : [];

            return bases.some(hasStandardArrayBase);
        };
        const family = hasStandardArrayBase(receiverType)
            ? 'Array'
            : collectionFamily(receiver);
        const directUpdate = family === 'Array' && methodName === 'push' && updateArgs.length === 1 ||
            family === 'Map' && methodName === 'set' && updateArgs.length === 2;

        if (!directUpdate) return;

        const getRootIdentifier = (candidate = {}) => {
            const { kind: candidateKind = 0, expression = {}, argumentExpression = {} } = getObject(candidate);

            if (candidateKind === PropertyAccessExpression) return getRootIdentifier(expression);

            if (candidateKind === ElementAccessExpression &&
                getObject(argumentExpression).kind === NumericLiteral) return getRootIdentifier(expression);

            return candidateKind === Identifier ? candidate : {};
        };
        const getStaticSelectionRanges = (candidate = {}) => {
            const { kind: candidateKind = 0, expression = {}, argumentExpression = {} } = getObject(candidate);
            const isStaticSelection = candidateKind === PropertyAccessExpression ||
                candidateKind === ElementAccessExpression && getObject(argumentExpression).kind === NumericLiteral;

            return isStaticSelection
                ? [getConsumerContractKey(candidate), ...getStaticSelectionRanges(expression)]
                : [];
        };
        const getSymbol = (candidate = {}) => getObject(candidate).kind === Identifier &&
            typeof getSymbolAtLocation === 'function'
            ? getSymbolAtLocation.call(checker, candidate)
            : false;
        let root = getRootIdentifier(receiver);
        let rootSymbol = getSymbol(root);
        let aliasReadRange = '';
        const selectionRanges = getStaticSelectionRanges(receiver);
        const { declarations: rootDeclarations = [] } = getObject(rootSymbol);
        const [declaration = {}] = rootDeclarations;
        const { kind: declarationKind = 0, initializer = {} } = getObject(declaration);

        if (declarationKind === VariableDeclaration && getObject(initializer).kind !== PropertyAccessExpression) return;

        const aliasRoot = getRootIdentifier(initializer);
        const aliasSymbol = getSymbol(aliasRoot);

        if (declarationKind === VariableDeclaration && !aliasSymbol) return;

        if (declarationKind === VariableDeclaration) {
            root = aliasRoot;
            rootSymbol = aliasSymbol;
            aliasReadRange = getConsumerContractKey(initializer);
        }

        if (!rootSymbol) return;

        const findCallbackOwner = (current = {}) => {
            const { kind: currentKind = 0, parameters: callbackParameters = [], parent = {} } = getObject(current);
            const ownsRoot = [ArrowFunction, FunctionExpression].includes(currentKind) &&
                callbackParameters.some(({ name = {} } = {}) => getSymbol(name) === rootSymbol);
            const { kind: parentKind = 0, arguments: providerArgs = [] } = getObject(parent);

            if (ownsRoot && parentKind === CallExpression && providerArgs.includes(current)) {
                return { callback: current, providerCall: parent };
            }

            return parentKind ? findCallbackOwner(parent) : {};
        };
        const { callback = {}, providerCall = {} } = findCallbackOwner(getObject(call).parent);

        if (!getObject(callback).kind) return;

        const { expression: providerMember = {} } = getObject(providerCall);
        const { name: providerMethod = {} } = getObject(providerMember);

        if (getObject(providerMethod).text === 'reduce') return;

        const contract = {
            key: callRange,
            sourceRange: callRange,
            action: 'operational-collection-builder',
            theorem: 'provider-visible-callback-parameter',
            collection: {
                type: family,
                callbackOwned: true,
                callbackParameterOwned: true,
                callbackRange: getConsumerContractKey(callback),
                providerRange: getConsumerContractKey(providerCall),
                ownerRange: getConsumerContractKey(root),
                aliasReadRange,
                selectionRanges,
                mutationSites: [{ key: callRange, statementRange, memberRange: getConsumerContractKey(member) }]
            },
            evidence: [
                'checker-proven standard mutable collection is selected from a provider callback parameter',
                'provider may observe callback parameter identity before or after the static update'
            ]
        };

        contracts = new Map([...contracts, [callRange, contract], [getConsumerContractKey(member), contract],
            ...(aliasReadRange ? [[aliasReadRange, contract]] : []),
            ...selectionRanges.map(range => [range, contract]),
            ...(statementRange ? [[statementRange, contract]] : [])]);
    };

    const visit = ({ node = {}, state = {} } = {}) => {
        const { functionRange: inheritedFunctionRange = '', ownerName: inheritedOwnerName = '' } = getObject(state);
        const functionRange = isNestedFunction(node)
            ? getConsumerContractKey(node)
            : inheritedFunctionRange;
        const ownerName = isNestedFunction(node)
            ? getFunctionOwnerName(node) || inheritedOwnerName
            : inheritedOwnerName;

        if (getObject(node).kind === Block) inspectBlock(node, functionRange, ownerName);

        if (getObject(node).kind === CallExpression) {
            inspectProviderAccumulator(node);
            inspectCallbackParameterUpdate(node);
        }
    };

    census.select(Block, CallExpression).forEach((node) => {
        const owners = census.ancestors(node).filter(isNestedFunction);
        const [owner = {}] = owners;
        const ownerName = owners.map(getFunctionOwnerName).find(Boolean) || '';
        visit({ node, state: { functionRange: getObject(owner).kind ? getConsumerContractKey(owner) : '', ownerName } });
    });

    return contracts;
};

// A destructuring decision belongs to the original TypeScript binding and its
// actual consumer together.  The individual collectors remain responsible for
// their checker queries; this adapter only gives later lowering passes one
// stable place to look up an already-proven agreement.  It deliberately does
// not infer a default, a guard response, or a new source fact.
// A rest parameter is a fresh source-owned array, but its indexed reads may
// occur well after invocation.  Only a direct return call whose callee is a
// same-signature parameter gives grammar a local, source-time binding point.
// The recorded positions retain argument order, including omitted positions.
const collectRestArraySelectionContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        ArrowFunction = -1,
        FunctionDeclaration = -1,
        FunctionExpression = -1,
        Identifier = -1,
        Parameter = -1,
        ReturnStatement = -1,
        CallExpression = -1,
        ElementAccessExpression = -1,
        NumericLiteral = -1
    } = getSyntaxKinds(typescript);
    const { getSymbolAtLocation = false } = getObject(checker);
    const functionKinds = [ArrowFunction, FunctionDeclaration, FunctionExpression];
    let contracts = new Map();

    if (typeof getSymbolAtLocation !== 'function') return contracts;

    const collectFunction = (functionNode = {}) => {
        const { parameters = [], body = {} } = getObject(functionNode);
        const restParameters = parameters.filter(({ dotDotDotToken = false, name = {} } = {}) => {
            return dotDotDotToken && getObject(name).kind === Identifier;
        });
        const [restParameter = {}] = restParameters;
        const { name: restNameNode = {} } = getObject(restParameter);
        const { text: restName = '' } = getObject(restNameNode);
        const restSymbol = restName && getSymbolAtLocation.call(checker, restNameNode);

        if (!restSymbol) return;

        const collectReturn = (node = {}) => {
            const { kind = 0, expression: call = {} } = getObject(node);

            if (functionKinds.includes(kind)) return;

            const { kind: callKind = 0, expression: callee = {}, arguments: args = [] } = getObject(call);
            const eligibleCall = kind === ReturnStatement && callKind === CallExpression &&
                getObject(callee).kind === Identifier && Array.isArray(args) && args.length;

            if (!eligibleCall) {
                typescript.forEachChild(node, collectReturn);

                return;
            }

            const calleeSymbol = getSymbolAtLocation.call(checker, callee);
            const { valueDeclaration: calleeDeclaration = {} } = getObject(calleeSymbol);
            const calleeIsParameter = getObject(calleeDeclaration).kind === Parameter &&
                calleeSymbol !== restSymbol;
            const positions = Array.isArray(args) ? args.map((argument = {}) => {
                const {
                    kind: argumentKind = 0,
                    expression: receiver = {},
                    argumentExpression: indexNode = {},
                    questionDotToken = false
                } = getObject(argument);
                const { kind: receiverKind = 0 } = getObject(receiver);
                const { kind: indexKind = 0, text: indexText = '' } = getObject(indexNode);
                const index = Number(indexText);
                const receiverSymbol = receiverKind === Identifier
                    ? getSymbolAtLocation.call(checker, receiver)
                    : false;

                return argumentKind === ElementAccessExpression && receiverKind === Identifier &&
                    indexKind === NumericLiteral && !questionDotToken && receiverSymbol === restSymbol &&
                    Number.isInteger(index) && index >= 0 && index < 32
                    ? { index, sourceRange: getConsumerContractKey(argument) }
                    : {};
            }) : [];

            if (calleeIsParameter &&
                positions.length && positions.every(({ sourceRange = '' } = {}) => sourceRange)) {
                const returnRange = getConsumerContractKey(node);
                const contract = {
                    action: 'rest-array-fixed-selection',
                    returnRange,
                    restName,
                    parameterRange: getConsumerContractKey(restParameter),
                    positions,
                    evidence: ['checker-proven fresh rest parameter and source-time fixed argument selection']
                };
                const keys = [returnRange, ...positions.map(({ sourceRange = '' } = {}) => sourceRange)];

                contracts = new Map([...contracts, ...keys.map(key => [key, contract])]);
            }

            typescript.forEachChild(node, collectReturn);
        };

        collectReturn(body);
        const collectRetainedReads = (node = {}, captured = false) => {
            const {
                kind = 0,
                expression: receiver = {},
                argumentExpression: indexNode = {},
                questionDotToken = false
            } = getObject(node);
            const { kind: indexKind = 0, text: indexText = '' } = getObject(indexNode);
            const key = getConsumerContractKey(node);
            const restRead = kind === ElementAccessExpression &&
                getObject(receiver).kind === Identifier &&
                indexKind === NumericLiteral && Number.isInteger(Number(indexText)) &&
                getSymbolAtLocation.call(checker, receiver) === restSymbol;
            const { parent: call = {} } = getObject(node);
            const { expression: precedingCall = {}, arguments: callArguments = [] } = getObject(call);
            const [firstArgument = {}] = callArguments;
            const { expression: precedingCallee = {}, arguments: precedingArguments = [] } = getObject(precedingCall);
            const precedingSymbol = getObject(precedingCallee).kind === Identifier
                ? getSymbolAtLocation.call(checker, precedingCallee)
                : false;
            const orderedCall = getObject(call).kind === CallExpression &&
                callArguments.length === 1 && firstArgument === node &&
                getObject(precedingCall).kind === CallExpression &&
                precedingArguments.length === 1 &&
                getObject(getObject(precedingSymbol).valueDeclaration).kind === Parameter;
            const { parent: callback = {} } = getObject(call);
            const stagedSelection = restRead && captured && orderedCall && !questionDotToken &&
                Number(indexText) >= 0 && Number(indexText) < 32 &&
                getObject(callback).kind === ArrowFunction && getObject(callback).body === call;

            if (restRead && captured && !contracts.has(key)) {
                const retainedAction = orderedCall ? 'rest-array-retained-effect-order' : 'rest-array-retained-index';
                const action = stagedSelection ? 'rest-array-staged-selection' : retainedAction;
                const retainedEvidence = orderedCall
                    ? 'checker-proven preceding call completes before captured rest-array indexed read'
                    : 'checker-proven rest array read retains its original source-time position';
                const evidence = stagedSelection
                    ? 'checker-proven preceding call is staged before the captured fixed numeric rest read'
                    : retainedEvidence;
                const callbackRange = stagedSelection ? getConsumerContractKey(callback) : '';
                const contract = {
                    action,
                    restName,
                    parameterRange: getConsumerContractKey(restParameter),
                    captured,
                    sourceRange: key,
                    callbackRange,
                    index: Number(indexText),
                    evidence: [evidence]
                };

                contracts = new Map([...contracts, [key, contract],
                    ...(callbackRange ? [[callbackRange, contract]] : [])]);
            }

            const descendantCaptured = captured || functionKinds.includes(kind);

            typescript.forEachChild(node, child => collectRetainedReads(child, descendantCaptured));
        };

        collectRetainedReads(body);
    };
    const visit = (node = {}) => {
        if (functionKinds.includes(getObject(node).kind)) collectFunction(node);
    };

    census.select(...functionKinds).forEach(visit);

    return contracts;
};

// The live traversal itself remains operational. A first body statement may
// select the current payload only after the same iterator result's `.done`
// property has admitted that iteration; the checker identifies that result.
const collectLiveIteratorPayloadContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        WhileStatement = -1, Block = -1, PropertyAccessExpression = -1,
        ParenthesizedExpression = -1, PrefixUnaryExpression = -1,
        ExclamationToken = -1, BinaryExpression = -1, EqualsToken = -1,
        Identifier = -1, CallExpression = -1, ExpressionStatement = -1,
        VariableStatement = -1
    } = getSyntaxKinds(typescript);
    const { getSymbolAtLocation = false, getTypeAtLocation = false } = getObject(checker);
    let contracts = new Map();

    if (typeof getSymbolAtLocation !== 'function' || typeof getTypeAtLocation !== 'function') return contracts;

    const unwrap = (node = {}) => getObject(node).kind === ParenthesizedExpression
        ? unwrap(getObject(node).expression)
        : node;
    const getDoneAssignment = (condition = {}) => {
        let matches = [];
        const visitCondition = (node = {}) => {
            const { kind = 0, name = {}, expression = {}, parent = {} } = getObject(node);
            const { kind: parentKind = 0, operator = 0, operand = {} } = getObject(parent);
            const assignment = unwrap(expression);
            const {
                kind: assignmentKind = 0, left = {}, right = {}, operatorToken = {}
            } = getObject(assignment);
            const { kind: rightKind = 0, expression: nextCallee = {}, arguments: nextArgs = [] } = getObject(right);
            const { kind: nextCalleeKind = 0, expression: iterator = {}, name: nextName = {} } = getObject(nextCallee);
            const matched = kind === PropertyAccessExpression && getObject(name).text === 'done' &&
                parentKind === PrefixUnaryExpression && operator === ExclamationToken && operand === node &&
                assignmentKind === BinaryExpression && getObject(operatorToken).kind === EqualsToken &&
                getObject(left).kind === Identifier && rightKind === CallExpression &&
                nextCalleeKind === PropertyAccessExpression && getObject(nextName).text === 'next' &&
                getObject(iterator).kind === Identifier && !nextArgs.length;

            if (matched) matches = [...matches, { result: left, nextCall: right }];

            typescript.forEachChild(node, visitCondition);
        };

        visitCondition(condition);

        const [match = {}] = matches;

        return matches.length === 1 ? match : {};
    };
    const getFirstCall = (statement = {}) => {
        const { kind = 0, expression = {}, declarationList = {} } = getObject(statement);
        const { declarations = [] } = getObject(declarationList);
        const [declaration = {}] = declarations;
        const initializer = kind === VariableStatement ? getObject(declaration).initializer : expression;
        const { kind: initializerKind = 0, operatorToken = {}, left = {}, right = {} } = getObject(initializer);
        const assignmentCall = kind === ExpressionStatement && initializerKind === BinaryExpression &&
            getObject(operatorToken).kind === EqualsToken && getObject(left).kind === Identifier
            ? right
            : {};

        return kind === VariableStatement && declarations.length === 1
            ? initializer
            : assignmentCall;
    };
    const inspectIteratorPayload = (node = {}) => {
        const { kind = 0, expression: condition = {}, statement: body = {} } = getObject(node);
        const { kind: bodyKind = 0, statements = [] } = getObject(body);
        const [first = {}] = statements;
        const { result = {}, nextCall = {} } = kind === WhileStatement ? getDoneAssignment(condition) : {};
        const { expression: nextMember = {} } = getObject(nextCall);
        const { name: nextName = {} } = getObject(nextMember);
        const standardNext = getObject(nextCall).kind === CallExpression && isStandardLibrarySymbol(
            getSymbolAtLocation.call(checker, nextName)
        );
        const loopRange = standardNext ? getConsumerContractKey(node) : '';

        if (loopRange) contracts = new Map([...contracts, [loopRange, {
            action: 'retain-live-iterator-traversal',
            loopRange,
            evidence: ['Direct next/done traversal preserves live advances and early-exit timing']
        }]]);

        const call = bodyKind === Block && result && nextCall ? getFirstCall(first) : {};
        const { kind: callKind = 0, expression: callee = {}, arguments: args = [] } = getObject(call);
        const { kind: firstKind = 0, declarationList = {} } = getObject(first);
        const { declarations = [] } = getObject(declarationList);
        const [declaration = {}] = declarations;
        const { name: bindingName = {}, initializer: bindingRead = {} } = getObject(declaration);
        const directLocal = firstKind === VariableStatement && declarations.length === 1 &&
            getObject(bindingName).kind === Identifier &&
            getObject(bindingRead).kind === PropertyAccessExpression;
        const [callPayload = {}] = args;
        const payload = directLocal ? bindingRead : callPayload;
        const { kind: payloadKind = 0, expression: payloadOwner = {}, name: payloadName = {} } = getObject(payload);
        const resultSymbol = getObject(result).kind === Identifier
            ? getSymbolAtLocation.call(checker, result)
            : false;
        const payloadSymbol = getObject(payloadOwner).kind === Identifier
            ? getSymbolAtLocation.call(checker, payloadOwner)
            : false;
        const nextType = nextCall && getObject(nextCall).kind === CallExpression
            ? getTypeAtLocation.call(checker, nextCall)
            : {};
        const { getProperties = false } = getObject(nextType);
        const propertyNames = typeof getProperties === 'function'
            ? getProperties.call(nextType).map((property = {}) => {
                const { getName = false } = getObject(property);

                return typeof getName === 'function' ? getName.call(property) : '';
            })
            : [];
        const directCall = callKind === CallExpression && getObject(callee).kind === Identifier && args.length === 1;
        const eligible = kind === WhileStatement && bodyKind === Block &&
            (directCall || directLocal) &&
            payloadKind === PropertyAccessExpression && getObject(payloadName).text === 'value' &&
            resultSymbol && payloadSymbol === resultSymbol &&
            propertyNames.includes('done') && propertyNames.includes('value');

        if (eligible) {
            const readRange = getConsumerContractKey(payload);
            const { text: resultName = '' } = getObject(result);
            const contract = {
                action: directLocal ? 'iterator-payload-local-declaration' : 'iterator-payload-local-binding',
                loopRange, readRange, resultName,
                evidence: ['checker-proven next result passes its done check before one body-local payload read']
            };

            contracts = new Map([...contracts, [loopRange, contract], [readRange, contract]]);
        }
    };

    census.select(WhileStatement).forEach(inspectIteratorPayload);

    return contracts;
};

// A selected union payload read inside a deferred callback belongs to that
// callback invocation, not the enclosing branch. The checker proves the
// source union and its narrowed payload; grammar may bind at the callback's
// first argument only when the callee lookup itself is a stable parameter.
const collectDeferredSelectedPayloadContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        ArrowFunction = -1, CallExpression = -1, PropertyAccessExpression = -1,
        Identifier = -1, Parameter = -1, FunctionDeclaration = -1
    } = getSyntaxKinds(typescript);
    const { getSymbolAtLocation = false, getTypeAtLocation = false, getPropertyOfType = false } = getObject(checker);
    let contracts = new Map();

    if ([getSymbolAtLocation, getTypeAtLocation, getPropertyOfType].some(method => typeof method !== 'function')) {
        return contracts;
    }

    const visit = (node = {}) => {
        const { kind = 0, body = {} } = getObject(node);
        const { kind: bodyKind = 0, expression: callee = {}, arguments: args = [] } = getObject(body);
        const [read = {}] = args;
        const { kind: readKind = 0, expression: receiver = {}, name = {} } = getObject(read);
        const { text: receiverName = '', kind: receiverKind = 0 } = getObject(receiver);
        const { text: propertyName = '' } = getObject(name);
        const calleeSymbol = getObject(callee).kind === Identifier
            ? getSymbolAtLocation.call(checker, callee)
            : false;
        const receiverSymbol = receiverKind === Identifier
            ? getSymbolAtLocation.call(checker, receiver)
            : false;
        const { valueDeclaration: receiverDeclaration = {} } = getObject(receiverSymbol);
        const { name: declarationName = {} } = getObject(receiverDeclaration);
        const declaredType = receiverSymbol && getObject(receiverDeclaration).kind === Parameter
            ? getTypeAtLocation.call(checker, declarationName)
            : {};
        const { types: unionParts = [] } = getObject(declaredType);
        const narrowedType = receiverSymbol ? getTypeAtLocation.call(checker, receiver) : {};
        const selected = Array.isArray(unionParts) && unionParts.length > 1 &&
            unionParts.every(part => getPropertyOfType.call(checker, part, '_tag')) &&
            unionParts.some(part => !getPropertyOfType.call(checker, part, propertyName)) &&
            Boolean(getPropertyOfType.call(checker, narrowedType, propertyName));
        const { valueDeclaration: calleeDeclaration = {} } = getObject(calleeSymbol);
        const stableCallee = [Parameter, FunctionDeclaration].includes(getObject(calleeDeclaration).kind);
        const eligible = kind === ArrowFunction && bodyKind === CallExpression && Boolean(args.length) &&
            readKind === PropertyAccessExpression && receiverKind === Identifier &&
            receiverName && propertyName && selected && stableCallee;

        if (eligible) {
            const callbackRange = getConsumerContractKey(node);
            const readRange = getConsumerContractKey(read);
            const contract = {
                action: 'deferred-selected-payload-binding', callbackRange, readRange,
                receiverName, propertyName,
                evidence: ['checker-proven tagged union is narrowed at a deferred callback payload read']
            };

            contracts = new Map([...contracts, [callbackRange, contract], [readRange, contract]]);
        }
    };

    census.select(ArrowFunction).forEach(visit);

    return contracts;
};

// A required generic field captured from an outer parameter remains a Get at
// callback invocation, even when its value family is opaque to the checker.
const collectDeferredOpaqueFieldContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        ArrowFunction = -1, CallExpression = -1, PropertyAccessExpression = -1,
        Identifier = -1, Parameter = -1
    } = getSyntaxKinds(typescript);
    const { TypeFlags: { TypeParameter: TypeParameterFlag = 0 } = {} } = typescript;
    const { getSymbolAtLocation = false, getTypeAtLocation = false, getPropertyOfType = false } = getObject(checker);
    let contracts = new Map();

    if ([getSymbolAtLocation, getTypeAtLocation, getPropertyOfType].some(method => typeof method !== 'function')) {
        return contracts;
    }

    const visit = (node = {}) => {
        const { kind = 0, body = {} } = getObject(node);
        const { kind: bodyKind = 0, expression: callee = {}, arguments: args = [] } = getObject(body);
        const [firstArgument = {}] = args;
        let nestedReads = [];
        const collectRead = (candidate = {}) => {
            const { kind: candidateKind = 0 } = getObject(candidate);

            if (candidateKind === ArrowFunction && candidate !== node) return;

            if (candidateKind === PropertyAccessExpression) nestedReads = [...nestedReads, candidate];

            typescript.forEachChild(candidate, collectRead);
        };

        if (kind === ArrowFunction && bodyKind === CallExpression) collectRead(body);

        const directRead = getObject(firstArgument).kind === PropertyAccessExpression;
        const [nestedRead = {}] = nestedReads;
        const exactNestedRead = nestedReads.length === 1 ? nestedRead : {};
        const read = directRead ? firstArgument : exactNestedRead;
        const { kind: readKind = 0, expression: receiver = {}, name = {} } = getObject(read);
        const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);
        const { text: propertyName = '' } = getObject(name);
        const receiverSymbol = receiverKind === Identifier
            ? getSymbolAtLocation.call(checker, receiver)
            : false;
        const { valueDeclaration: declaration = {} } = getObject(receiverSymbol);
        const { parent: owner = {} } = getObject(declaration);
        const receiverType = receiverSymbol ? getTypeAtLocation.call(checker, receiver) : {};
        const field = receiverSymbol && propertyName
            ? getPropertyOfType.call(checker, receiverType, propertyName)
            : false;
        const { flags: fieldFlags = 0 } = getObject(field);
        const { SymbolFlags: { Optional: OptionalFlag = 0 } = {} } = typescript;
        const valueType = field ? getTypeAtLocation.call(checker, read) : {};
        const { flags: valueFlags = 0 } = getObject(valueType);
        const calleeSymbol = getObject(callee).kind === Identifier
            ? getSymbolAtLocation.call(checker, callee)
            : false;
        const { valueDeclaration: calleeDeclaration = {} } = getObject(calleeSymbol);
        const eligible = kind === ArrowFunction && bodyKind === CallExpression && Boolean(args.length) &&
            readKind === PropertyAccessExpression && receiverKind === Identifier &&
            getObject(declaration).kind === Parameter && owner !== node &&
            Boolean(field) && !(fieldFlags & OptionalFlag) &&
            Boolean(valueFlags & TypeParameterFlag) &&
            getObject(calleeDeclaration).kind === Parameter;

        if (eligible) {
            const callbackRange = getConsumerContractKey(node);
            const readRange = getConsumerContractKey(read);
            const contract = {
                action: directRead ? 'deferred-opaque-field-binding' : 'retain-deferred-opaque-field-read',
                callbackRange, readRange,
                receiverName, propertyName,
                evidence: ['required generic field is read only when the captured callback executes']
            };

            contracts = new Map([...contracts, [callbackRange, contract], [readRange, contract]]);
        }
    };

    census.select(ArrowFunction).forEach(visit);

    return contracts;
};

// A selected tuple position used as the sole argument of a curried call is
// read only after the preceding call has produced its callee. The fact owns
// that call and the read, so grammar can stage them in the same order.
const collectCurriedSelectedTupleContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        CallExpression = -1, ElementAccessExpression = -1, PropertyAccessExpression = -1,
        Identifier = -1, NumericLiteral = -1, Parameter = -1,
        ConditionalExpression = -1, ReturnStatement = -1
    } = getSyntaxKinds(typescript);
    const { getSymbolAtLocation = false, getTypeAtLocation = false, getPropertyOfType = false,
        isTupleType = false } = getObject(checker);
    let contracts = new Map();

    if ([getSymbolAtLocation, getTypeAtLocation, getPropertyOfType, isTupleType]
        .some(method => typeof method !== 'function')) return contracts;

    const ownsEvaluationSpine = (call = {}) => {
        let current = call;

        // eslint-disable-next-line resilient/prefer-prototype-methods -- Return-spine discovery follows callee/receiver edges; argument and true-arm paths stop.
        while (current) {
            const { parent = {} } = getObject(current);
            const { kind = 0, expression = {}, whenFalse = {} } = getObject(parent);

            if (kind === ReturnStatement && expression === current ||
                kind === ConditionalExpression && whenFalse === current) return true;

            if (![CallExpression, PropertyAccessExpression].includes(kind) || expression !== current) return false;

            current = parent;
        }

        return false;
    };

    const visit = (node = {}) => {
        const { kind = 0, expression: precedingCall = {}, arguments: args = [] } = getObject(node);
        const [read = {}] = args;
        const { expression: propertyRead = {}, argumentExpression: indexNode = {} } = getObject(read);
        const { expression: receiver = {}, name = {} } = getObject(propertyRead);
        const { text: receiverName = '' } = getObject(receiver);
        const { text: propertyName = '' } = getObject(name);
        const { text: indexText = '' } = getObject(indexNode);
        const index = Number(indexText);
        const receiverSymbol = getObject(receiver).kind === Identifier
            ? getSymbolAtLocation.call(checker, receiver)
            : false;
        const { valueDeclaration: declaration = {} } = getObject(receiverSymbol);
        const declared = getObject(declaration).kind === Parameter
            ? getTypeAtLocation.call(checker, getObject(declaration).name)
            : {};
        const { types: unionParts = [] } = getObject(declared);
        const narrowed = receiverSymbol ? getTypeAtLocation.call(checker, receiver) : {};
        const selected = Array.isArray(unionParts) && unionParts.length > 1 &&
            unionParts.every(part => getPropertyOfType.call(checker, part, '_tag')) &&
            unionParts.some(part => !getPropertyOfType.call(checker, part, propertyName)) &&
            Boolean(getPropertyOfType.call(checker, narrowed, propertyName));
        const eligible = kind === CallExpression && args.length === 1 &&
            getObject(precedingCall).kind === CallExpression &&
            getObject(read).kind === ElementAccessExpression &&
            getObject(propertyRead).kind === PropertyAccessExpression &&
            getObject(receiver).kind === Identifier && getObject(indexNode).kind === NumericLiteral &&
            Number.isInteger(index) && index >= 0 && index < 32 && receiverName && propertyName &&
            selected && isTupleType.call(checker, getTypeAtLocation.call(checker, propertyRead)) &&
            ownsEvaluationSpine(node);

        if (eligible) {
            const callRange = getConsumerContractKey(node);
            const readRange = getConsumerContractKey(read);

            contracts = new Map([...contracts, [readRange, {
                action: 'curried-selected-tuple-binding', callRange, readRange,
                receiverName, propertyName, index,
                evidence: ['checker-narrowed selected tuple position follows a source curried callee call']
            }]]);
        }
    };

    census.select(CallExpression).forEach(visit);

    return contracts;
};

// A method passed as an argument to a receiver method is looked up only after
// the receiver method has been evaluated. A statement binding would reverse
// those two observable Gets, so this source range retains its original read.
const collectReceiverOrderedProjectionContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const { CallExpression = -1, PropertyAccessExpression = -1, ElementAccessExpression = -1,
        StringLiteral = -1, Identifier = -1 } = getSyntaxKinds(typescript);
    const { IndexKind: { Number: NumberIndex = -1 } = {} } = getObject(typescript);
    const { getTypeAtLocation = false, getPropertyOfType = false,
        getIndexTypeOfType = false, getSignaturesOfType = false } = getObject(checker);
    let contracts = new Map();

    if ([getTypeAtLocation, getPropertyOfType, getIndexTypeOfType, getSignaturesOfType]
        .some(method => typeof method !== 'function')) return contracts;

    const visit = (node = {}) => {
        const { kind = 0, expression: callee = {}, arguments: args = [], questionDotToken: optionalCall = false } = getObject(node);
        const [projection = {}] = args;
        const { kind: calleeKind = 0, expression: receiver = {}, name: methodName = {},
            argumentExpression: computedMethod = {}, questionDotToken: optionalConsumer = false } = getObject(callee);
        const { kind: projectionKind = 0, expression: provider = {}, name: projectedName = {},
            argumentExpression: projectedArgument = {}, questionDotToken: optionalProjection = false } = getObject(projection);
        const projectedMember = projectionKind === ElementAccessExpression && getObject(projectedArgument).kind === StringLiteral
            ? getObject(projectedArgument).text || '' : getObject(projectedName).text || '';
        const { text: providerName = '' } = getObject(provider);
        const { text: receiverName = '' } = getObject(receiver);
        const { text: writtenMethod = '' } = getObject(methodName);
        const receiverMethod = calleeKind === ElementAccessExpression && getObject(computedMethod).kind === StringLiteral
            ? getObject(computedMethod).text || '' : writtenMethod;
        const admittedMethod = calleeKind === PropertyAccessExpression && receiverMethod === 'reduce' ||
            calleeKind === ElementAccessExpression && receiverMethod === 'map' ||
            calleeKind === PropertyAccessExpression && receiverMethod === 'map' && projectionKind === ElementAccessExpression;
        const candidate = kind === CallExpression && !optionalCall && !optionalConsumer && args.length === 1 &&
            admittedMethod && !optionalProjection &&
            [PropertyAccessExpression, ElementAccessExpression].includes(projectionKind) &&
            getObject(provider).kind === Identifier && Boolean(projectedMember);

        if (candidate) {
            const providerType = getTypeAtLocation.call(checker, provider);
            const projectedSymbol = getPropertyOfType.call(checker, providerType, projectedMember);
            const projectedType = projectedSymbol && getTypeAtLocation.call(checker, projection);
            const receiverType = getTypeAtLocation.call(checker, receiver);
            const eligible = Boolean(projectedSymbol) &&
                Boolean(getSignaturesOfType.call(checker, projectedType, 0).length) &&
                Boolean(getIndexTypeOfType.call(checker, receiverType, NumberIndex)) &&
                Boolean(getPropertyOfType.call(checker, receiverType, 'length')) &&
                Boolean(getPropertyOfType.call(checker, receiverType, receiverMethod));
            const sourceRange = getConsumerContractKey(projection);

            contracts = eligible
                ? new Map([...contracts, [sourceRange, {
                    action: 'retain-receiver-ordered-projection', sourceRange,
                    providerName, receiverName, projectedMember, receiverMethod,
                    evidence: ['receiver method lookup precedes the projected argument getter']
                }]])
                : contracts;
        }
    };

    census.select(CallExpression).forEach(visit);

    return contracts;
};

// A numeric tuple read in a receiver-method argument occurs after the method
// lookup and after any preceding short-circuit branch. A binding statement
// cannot be inserted between that lookup and argument evaluation while
// preserving the receiver call, so the exact source read remains operational.
const collectShortCircuitTupleArgumentContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        ElementAccessExpression = -1, PropertyAccessExpression = -1, CallExpression = -1,
        Identifier = -1, NumericLiteral = -1, PrefixUnaryExpression = -1,
        ExclamationToken = -1, BinaryExpression = -1, BarBarToken = -1,
        IfStatement = -1
    } = getSyntaxKinds(typescript);
    const { getTypeAtLocation = false, isTupleType = false } = getObject(checker);
    let contracts = new Map();

    if (typeof getTypeAtLocation !== 'function' || typeof isTupleType !== 'function') return contracts;

    const getOwningIf = (call = {}) => {
        const { parent: prefix = {} } = getObject(call);
        const { kind: prefixKind = 0, operator = -1 } = getObject(prefix);

        if (prefixKind !== PrefixUnaryExpression || operator !== ExclamationToken) return {};

        const findIf = (current = {}) => {
            const { parent = {} } = getObject(current);
            const { kind = 0, operatorToken = {}, expression = {} } = getObject(parent);
            const { kind: operatorKind = 0 } = getObject(operatorToken);

            if (kind === BinaryExpression && operatorKind === BarBarToken) return findIf(parent);

            return kind === IfStatement && expression === current ? parent : {};
        };

        return findIf(prefix);
    };
    const visit = (node = {}) => {
        const { kind = 0, expression: tupleRead = {}, argumentExpression: indexNode = {}, parent: call = {} } = getObject(node);
        const { expression: selected = {}, name: tupleProperty = {} } = getObject(tupleRead);
        const { expression: methodRead = {}, arguments: args = [] } = getObject(call);
        const { expression: methodReceiver = {}, name: methodName = {} } = getObject(methodRead);
        const { text: tupleOwnerName = '' } = getObject(selected);
        const { text: tuplePropertyName = '' } = getObject(tupleProperty);
        const { text: methodReceiverName = '' } = getObject(methodReceiver);
        const { text: methodPropertyName = '' } = getObject(methodName);
        const { text: indexText = '' } = getObject(indexNode);
        const index = Number(indexText);
        const owningIf = getOwningIf(call);
        const candidate = kind === ElementAccessExpression &&
            getObject(tupleRead).kind === PropertyAccessExpression &&
            getObject(selected).kind === Identifier && getObject(indexNode).kind === NumericLiteral &&
            getObject(call).kind === CallExpression && args.includes(node) &&
            getObject(methodRead).kind === PropertyAccessExpression &&
            getObject(methodReceiver).kind === Identifier &&
            Number.isInteger(index) && index >= 0 && index < 32 &&
            tupleOwnerName && tuplePropertyName && methodReceiverName && methodPropertyName &&
            getObject(owningIf).kind === IfStatement;

        if (candidate && isTupleType.call(checker, getTypeAtLocation.call(checker, tupleRead))) {
            const sourceRange = getConsumerContractKey(node);

            contracts = new Map([...contracts, [sourceRange, {
                action: 'retain-receiver-ordered-tuple-argument', sourceRange,
                ifRange: getConsumerContractKey(owningIf), tupleOwnerName, tuplePropertyName,
                methodReceiverName, methodPropertyName, index,
                evidence: ['short-circuit and receiver method lookup precede this static tuple argument']
            }]]);
        }
    };

    census.select(ElementAccessExpression).forEach(visit);

    return contracts;
};

// Repeated numeric Gets from a tuple-valued member in separate call
// arguments cannot be replaced by one eager binding: the receiver method
// lookup and intervening argument work separate the original read phases.
const collectOrderedNestedTupleReadContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        CallExpression = -1, PropertyAccessExpression = -1,
        ElementAccessExpression = -1, NumericLiteral = -1,
        Identifier = -1, SpreadElement = -1,
        ArrowFunction = -1, FunctionExpression = -1,
        ReturnStatement = -1, ExpressionStatement = -1,
        VariableStatement = -1
    } = getSyntaxKinds(typescript);
    const { getTypeAtLocation = false, isTupleType = false } = getObject(checker);
    let contracts = new Map();

    if (typeof getTypeAtLocation !== 'function' || typeof isTupleType !== 'function') return contracts;

    const getRead = (node = {}) => {
        const { kind = 0, expression: member = {}, argumentExpression: position = {} } = getObject(node);
        const { expression: receiver = {}, name: property = {} } = getObject(member);
        const { text: receiverName = '' } = getObject(receiver);
        const { text: propertyName = '' } = getObject(property);
        const { text: indexText = '' } = getObject(position);
        const index = Number(indexText);

        return kind === ElementAccessExpression && getObject(member).kind === PropertyAccessExpression &&
            getObject(receiver).kind === Identifier && getObject(position).kind === NumericLiteral &&
            receiverName && propertyName && Number.isInteger(index) && index >= 0 &&
            isTupleType.call(checker, getTypeAtLocation.call(checker, member))
            ? { range: getConsumerContractKey(node), receiverName, propertyName, index }
            : {};
    };
    const collectReads = (node = {}) => {
        const { kind = 0 } = getObject(node);

        if ([ArrowFunction, FunctionExpression, SpreadElement].includes(kind)) return [];

        const read = getRead(node);
        let children = [];

        typescript.forEachChild(node, (child) => { children = [...children, ...collectReads(child)]; });

        return Object.keys(read).length ? [read, ...children] : children;
    };
    const visit = ({ node = {}, statement = {} } = {}) => {
        const { kind = 0, expression: callee = {}, arguments: args = [] } = getObject(node);
        const owner = [ReturnStatement, ExpressionStatement, VariableStatement].includes(kind) ? node : statement;
        const [firstArgument = {}, ...laterArguments] = args;
        const first = getRead(firstArgument);
        const { range: firstRange = '', receiverName: firstReceiver = '',
            propertyName: firstProperty = '', index: firstIndex = -1 } = first;
        const later = laterArguments.flatMap(collectReads);
        const selected = later.filter(({ receiverName = '', propertyName = '', index = -1 } = {}) => {
            return receiverName === firstReceiver && propertyName === firstProperty && index !== firstIndex;
        });
        const statementRange = getConsumerContractKey(owner);
        const callRange = getConsumerContractKey(node);

        if (kind === CallExpression && getObject(callee).kind === PropertyAccessExpression &&
            firstRange && selected.length && statementRange && callRange) {
            const readRanges = [first, ...selected].map(({ range = '' } = {}) => range);

            contracts = new Map([...contracts, [callRange, {
                action: 'retain-ordered-nested-tuple-read', sourceRange: callRange,
                statementRange, readRanges,
                evidence: ['checker-proven tuple numeric Gets remain separated by call argument evaluation']
            }]]);
        }
    };

    census.select(CallExpression).forEach((node) => {
        const statement = census.ancestors(node).find(ancestor => (
            [ReturnStatement, ExpressionStatement, VariableStatement].includes(getObject(ancestor).kind)
        )) || {};
        visit({ node, statement });
    });

    return contracts;
};

// Preserve the source operation before later passes can rebuild its syntax.
// Unknown checker evidence permits retention, never a new extraction or
// default: the program-less adapter still has the original AST operation.
const collectIndexedOperationContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        ElementAccessExpression = -1, NumericLiteral = -1, StringLiteral = -1,
        Identifier = -1,
        BinaryExpression = -1, DeleteExpression = -1,
        PrefixUnaryExpression = -1, PostfixUnaryExpression = -1,
        PlusPlusToken = -1, MinusMinusToken = -1,
        FirstAssignment = -1, LastAssignment = -1,
        VariableDeclaration = -1, Parameter = -1, CallExpression = -1, PropertyAccessExpression = -1,
        ParenthesizedExpression = -1, AsExpression = -1, TypeAssertionExpression = -1, NonNullExpression = -1, SatisfiesExpression = -1,
        ExpressionStatement = -1, ForStatement = -1
    } = getSyntaxKinds(typescript);
    const { getTypeAtLocation = false } = getObject(checker);
    let contracts = new Map();
    const { text: authoredText = '' } = getObject(sourceFile);
    const commentRanges = new Map();
    const syntaxKinds = [...new Set(Object.values(getObject(typescript).SyntaxKind).filter(kind => typeof kind === 'number'))];

    // Reuse the one semantic census for original comment provenance; placement
    // must not discover the source tree again or reinterpret comment payloads.
    census.select(...syntaxKinds).forEach((node) => {
        const { pos = -1, end = -1 } = getObject(node);

        [...typescript.getLeadingCommentRanges(authoredText, pos) || [],
            ...typescript.getTrailingCommentRanges(authoredText, end) || []].forEach((range) => {
            const { pos: start = -1 } = range;

            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private comment index deduplicates census trivia without mutating source records.
            commentRanges.set(start, range);
        });
    });
    const authoredComments = [...commentRanges.values()].toSorted(({ pos: left = 0 } = {}, { pos: right = 0 } = {}) => left - right);
    const hasChecker = typeof getTypeAtLocation === 'function';
    const chainKinds = new Set([ElementAccessExpression, PropertyAccessExpression, ParenthesizedExpression,
        AsExpression, TypeAssertionExpression, NonNullExpression, SatisfiesExpression]);
    const rootReceiver = (candidate = {}) => chainKinds.has(getObject(candidate).kind)
        ? rootReceiver(getObject(candidate).expression) : candidate;

    const visit = ({ node = {}, parent = {}, statement = {}, loop = {} } = {}) => {
        const { kind = 0, expression: receiver = {}, argumentExpression: key = {} } = getObject(node);
        const { kind: parentKind = 0, left = {}, right = {}, operatorToken = {},
            expression = {}, operand = {}, operator = -1 } = getObject(parent);
        const { kind: tokenKind = 0 } = getObject(operatorToken);
        const update = parentKind === BinaryExpression && left === node &&
            tokenKind >= FirstAssignment && tokenKind <= LastAssignment ||
            parentKind === DeleteExpression && expression === node ||
            [PrefixUnaryExpression, PostfixUnaryExpression].includes(parentKind) &&
            operand === node && [PlusPlusToken, MinusMinusToken].includes(operator);
        const { kind: leftKind = 0 } = getObject(left);
        let operation = 'read';

        if (parentKind === BinaryExpression && left === node && update) operation = 'assignment';

        if (parentKind === DeleteExpression && expression === node) operation = 'delete';

        if (update && !['assignment', 'delete'].includes(operation)) operation = 'increment';

        if (parentKind === BinaryExpression && right === node &&
            leftKind === ElementAccessExpression &&
            tokenKind >= FirstAssignment && tokenKind <= LastAssignment) operation = 'assignment-value';

        const { kind: keyKind = 0 } = getObject(key);
        const dynamic = ![NumericLiteral, StringLiteral].includes(keyKind);
        const receiverType = hasChecker && kind === ElementAccessExpression
            ? getTypeAtLocation.call(checker, receiver) : {};
        const receiverSymbol = hasChecker && kind === ElementAccessExpression
            ? checker.getSymbolAtLocation(receiver) : {};
        const { declarations: receiverDeclarations = [] } = getObject(receiverSymbol);
        const dynamicArguments = getObject(receiver).kind === Identifier &&
            getObject(receiver).text === 'arguments' &&
            getObject(getObject(receiverType).symbol).name === 'IArguments' &&
            !receiverDeclarations.length;
        const staticBinaryRead = !dynamic && parentKind === BinaryExpression && left === node &&
            Boolean(tokenKind) && !update;
        const sourceRange = getConsumerContractKey(node);
        let action = update ? 'retain-indexed-update' : 'retain-indexed-read';

        if (dynamicArguments) action = 'retain-dynamic-arguments-read';

        if (kind === ElementAccessExpression && sourceRange &&
            (dynamic || update || staticBinaryRead || dynamicArguments)) {
            const checkerObserved = hasChecker && Boolean(getTypeAtLocation.call(checker, receiver)) &&
                Boolean(getTypeAtLocation.call(checker, key));
            const sourceOperation = staticBinaryRead ? 'binary-read' : operation;
            const chain = census.ancestors(node).reduce((outer, candidate) => (
                chainKinds.has(getObject(candidate).kind) && getObject(candidate).expression === outer ? candidate : outer
            ), node);
            const [consumer = {}] = census.ancestors(chain);
            const root = rootReceiver(receiver);
            const rootSymbol = hasChecker && getObject(root).kind === Identifier ? checker.getSymbolAtLocation(root) : {};
            const { declarations: rootDeclarations = [] } = getObject(rootSymbol);
            const { kind: consumerKind = 0, expression: consumerExpression = {} } = getObject(consumer);
            const calledReceiver = consumerKind === CallExpression && consumerExpression === chain;
            const cardinalityReceiver = [node, ...census.ancestors(node)].some(candidate => (
                chainKinds.has(getObject(candidate).kind) &&
                ['length', 'size'].includes(getObject(getObject(candidate).name).text) &&
                getObject(candidate).pos >= getObject(chain).pos && getObject(candidate).end <= getObject(chain).end
            ));

            const parameter = rootDeclarations.find(declaration => getObject(declaration).kind === Parameter);
            const parameterOwner = parameter ? census.ancestors(parameter).find(ancestor => typescript.isFunctionLike(ancestor)) : {};
            const { parameters: ownerParameters = [] } = getObject(parameterOwner);
            const [firstParameter = {}] = ownerParameters;
            const callback = census.ancestors(parameterOwner).reduce((outer, candidate) => (
                [ParenthesizedExpression, AsExpression, TypeAssertionExpression, NonNullExpression, SatisfiesExpression].includes(getObject(candidate).kind) &&
                getObject(candidate).expression === outer ? candidate : outer
            ), parameterOwner);
            const [parameterConsumer = {}] = census.ancestors(callback);
            const readOwner = census.ancestors(node).find(ancestor => typescript.isFunctionLike(ancestor));
            const { expression: parameterCallee = {}, arguments: parameterArguments = [] } = getObject(parameterConsumer);
            const [firstArgument = {}] = parameterArguments;
            const reducerAccumulator = parameter === firstParameter && readOwner === parameterOwner && firstArgument === callback &&
                getObject(parameterCallee).kind === PropertyAccessExpression &&
                getObject(getObject(parameterCallee).name).text === 'reduce';

            contracts = new Map([...contracts, [sourceRange, {
                sourceRange,
                action,
                operation: dynamicArguments ? 'dynamic-arguments-read' : sourceOperation,
                operationRole: dynamicArguments ? 'dynamic-arguments-read' : 'indexed-operation',
                authoredComments,
                memberBoundary: hasChecker && getObject(root).kind === Identifier && rootDeclarations.some(declaration => (
                    getObject(declaration).kind === Parameter ||
                    getObject(declaration).kind === VariableDeclaration && census.ancestors(declaration).some(ancestor => typescript.isFunctionLike(ancestor))
                )) && !reducerAccumulator && !calledReceiver && !cardinalityReceiver,
                staticPosition: dynamicArguments && keyKind === NumericLiteral,
                statementRange: operation === 'assignment' && getObject(statement).kind === ExpressionStatement
                    ? getConsumerContractKey(statement) : '',
                evidence: [checkerObserved ? 'checker observed source receiver and key types'
                    : 'source indexed operation remains unresolved and is retained',
                update ? 'indexed update retains key and mutation phase'
                    : 'indexed read retains source operand phase']
            }]]);
        }

        const loopRange = kind === ElementAccessExpression && dynamicArguments &&
            getObject(loop).kind === ForStatement ? getConsumerContractKey(loop) : '';

        if (loopRange && !contracts.has(loopRange)) contracts = new Map([...contracts, [loopRange, {
            sourceRange: loopRange,
            loopRange,
            action: 'retain-dynamic-arguments-loop',
            operationRole: 'dynamic-arguments-loop',
            evidence: ['Live arguments indexing preserves aliasing, iterator avoidance, and call order']
        }]]);

        const { incrementor = {} } = getObject(loop);
        const counter = getObject(incrementor).operand || getObject(incrementor).left || {};
        const keySymbol = hasChecker && keyKind === Identifier
            ? checker.getSymbolAtLocation(key) : false;
        const counterSymbol = hasChecker && getObject(counter).kind === Identifier
            ? checker.getSymbolAtLocation(counter) : false;
        const indexedArrayLoopRange = kind === ElementAccessExpression &&
            getObject(loop).kind === ForStatement &&
            isStandardArrayType({ typescript, checker, candidate: receiver }) && keySymbol &&
            keySymbol === counterSymbol ? getConsumerContractKey(loop) : '';

        if (indexedArrayLoopRange && !contracts.has(indexedArrayLoopRange)) {
            contracts = new Map([...contracts, [indexedArrayLoopRange, {
                sourceRange: indexedArrayLoopRange,
                loopRange: indexedArrayLoopRange,
                action: 'retain-indexed-array-traversal',
                operationRole: 'indexed-array-traversal',
                evidence: ['Indexed array Gets visit sparse positions at the source counter and read phase']
            }]]);
        }
    };

    census.select(ElementAccessExpression).forEach((node) => {
        const ancestors = census.ancestors(node);
        const [parent = {}] = ancestors;
        const statement = ancestors.find(ancestor => getObject(ancestor).kind === ExpressionStatement) || {};
        const loop = ancestors.find(ancestor => getObject(ancestor).kind === ForStatement) || {};
        visit({ node, parent, statement, loop });
    });

    return contracts;
};

// A binding is discardable only when the checker symbol has no source use.
// The three syntax roles have different grammar: catch omission, iterator
// elision, and an arity-preserving parameter read in the original body.
const collectUnusedBindingContracts = ({ typescript = {}, sourceFile = {}, checker = {},
    census = createSourceCensus({ typescript, sourceFile }), bindingReferences = collectBindingReferences({ typescript, sourceFile, checker, census }) } = {}) => {
    const {
        Identifier = -1, CatchClause = -1, BindingElement = -1,
        ArrayBindingPattern = -1, Parameter = -1,
        TypePredicate = -1
    } = getSyntaxKinds(typescript);
    const { getSymbolAtLocation = false } = getObject(checker);
    let contracts = new Map();

    if (typeof getSymbolAtLocation !== 'function') return contracts;

    const hasUse = (name = {}) => {
        const symbol = getSymbolAtLocation.call(checker, name);

        return !symbol || (bindingReferences.get(symbol) || []).some((node = {}) => (
            node !== name && getObject(getObject(node).parent).kind !== TypePredicate
        ));
    };
    const visit = (node = {}) => {
        const { kind = 0, variableDeclaration = {}, name = {}, parent = {},
            initializer = false, dotDotDotToken = false } = getObject(node);
        const catchName = getObject(variableDeclaration).name || {};
        const functionBody = getObject(parent).body || {};
        let action = '';
        let binding = name;

        if (kind === CatchClause && getObject(catchName).kind === Identifier) {
            action = 'omit-unused-catch';
            binding = catchName;
        }

        if (!action && kind === BindingElement && getObject(parent).kind === ArrayBindingPattern &&
            getObject(name).kind === Identifier && !initializer && !dotDotDotToken) {
            action = 'elide-unused-tuple-slot';
        }

        if (!action && kind === Parameter && getObject(name).kind === Identifier &&
            getObject(functionBody).kind && !initializer) {
            action = 'retain-arity-discard-parameter';
        }

        const sourceRange = action ? getConsumerContractKey(node) : '';

        if (sourceRange && !hasUse(binding)) {
            contracts = new Map([...contracts, [sourceRange, {
                sourceRange, action, bindingName: getObject(binding).text || '',
                evidence: ['checker symbol has no source reference',
                    action === 'elide-unused-tuple-slot'
                        ? 'plain tuple slot has no default or rest effect'
                        : 'original binding position remains source-owned']
            }]]);
        }
    };

    census.select(CatchClause, BindingElement, Parameter).forEach(visit);

    return contracts;
};

// A checker-declared callable may expose parameters even when its source
// implementation declares fewer formal parameters. JavaScript still evaluates
// and passes every argument. Keep that call and its type-declared contract
// without inventing wrapper parameters or changing observable function arity.
const collectTypedIgnoredArgumentCallContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const { CallExpression = -1, Identifier = -1, VariableDeclaration = -1,
        ArrowFunction = -1, FunctionExpression = -1,
        PropertyAccessExpression = -1, SpreadElement = -1 } = getSyntaxKinds(typescript);
    const { getSymbolAtLocation = false, getTypeAtLocation = false,
        getAliasedSymbol = false, getResolvedSignature = false,
        getTypeOfSymbolAtLocation = false, isTypeAssignableTo = false } = getObject(checker);
    const { SymbolFlags: { Alias: AliasFlag = 0 } = {} } = typescript;
    let contracts = new Map();

    if (typeof getSymbolAtLocation !== 'function' || typeof getTypeAtLocation !== 'function') return contracts;

    const getImplementation = (candidate = false, seen = new Set()) => {
        if (!candidate || seen.has(candidate)) return false;

        const nextSeen = new Set([...seen, candidate]);
        const { flags = 0, declarations = [] } = getObject(candidate);
        const alias = flags & AliasFlag && typeof getAliasedSymbol === 'function'
            ? getAliasedSymbol.call(checker, candidate)
            : false;

        if (alias && alias !== candidate) return getImplementation(alias, nextSeen);

        return declarations.reduce((found, declaration = {}) => {
            if (found) return found;

            const { kind: declarationKind = 0, type = false, initializer = {} } = getObject(declaration);
            const { kind: implementationKind = 0 } = getObject(initializer);

            if (declarationKind !== VariableDeclaration || !type) return false;

            if ([ArrowFunction, FunctionExpression].includes(implementationKind)) return initializer;

            return [Identifier, PropertyAccessExpression].includes(implementationKind) &&
                getImplementation(getSymbolAtLocation.call(checker, initializer), nextSeen);
        }, false);
    };

    const visit = (node = {}) => {
        const { kind = 0, expression = {}, arguments: args = [], questionDotToken = false } = getObject(node);
        const { kind: expressionKind = 0 } = getObject(expression);

        if (kind === CallExpression && expressionKind === Identifier && args.length &&
            !questionDotToken && !args.some(argument => getObject(argument).kind === SpreadElement)) {
            const symbol = getSymbolAtLocation.call(checker, expression);
            const implementation = getImplementation(symbol);
            const { parameters: implementationParameters = [] } = getObject(implementation);
            const excess = implementation && args.length > implementationParameters.length &&
                !implementationParameters.some(parameter => Boolean(getObject(parameter).dotDotDotToken));
            const type = excess && getTypeAtLocation.call(checker, expression);
            const { getCallSignatures = false } = getObject(type);
            const signatures = typeof getCallSignatures === 'function' ? getCallSignatures.call(type) : [];
            const acceptsArguments = signatures.some((signature = {}) => {
                const { parameters = [], minArgumentCount = 0 } = getObject(signature);

                return parameters.length >= args.length && minArgumentCount <= args.length;
            });
            const zeroParameters = !implementationParameters.length;
            const signature = excess && !zeroParameters && typeof getResolvedSignature === 'function'
                ? getResolvedSignature.call(checker, node) : false;
            const { parameters: selectedParameters = [], minArgumentCount = 0 } = getObject(signature);
            const acceptsSelectedArguments = signature && selectedParameters.length >= args.length &&
                minArgumentCount <= args.length &&
                typeof getTypeOfSymbolAtLocation === 'function' && typeof isTypeAssignableTo === 'function' &&
                args.every((argument, index) => {
                    const { [index]: parameter = {} } = selectedParameters;

                    return isTypeAssignableTo.call(checker,
                        getTypeAtLocation.call(checker, argument),
                        getTypeOfSymbolAtLocation.call(checker, parameter, node)
                    );
                });
            const sourceRange = acceptsArguments && (zeroParameters || acceptsSelectedArguments)
                ? getConsumerContractKey(node) : '';

            contracts = sourceRange
                ? new Map([...contracts, [sourceRange, {
                    sourceRange, action: zeroParameters ? 'retain-typed-ignored-argument-call'
                        : 'retain-typed-extra-argument-call',
                    evidence: ['checker signature accepts source arguments',
                        zeroParameters ? 'source implementation has zero parameters and ignores passed values'
                            : 'resolved authored callable accepts arguments beyond the source implementation formals']
                }]])
                : contracts;
        }
    };

    census.select(CallExpression).forEach(visit);

    return contracts;
};

// A source call may select an overload that returns a function, although the
// emitted implementation declares an optional later parameter. Likewise, a
// nested declaration may shadow a different same-named function. Neither is
// a missing-argument call: the checker resolves the exact source declaration.
const collectResolvedSourceCallContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const { CallExpression = -1, Identifier = -1, FunctionDeclaration = -1,
        VariableDeclaration = -1, ArrowFunction = -1, FunctionExpression = -1,
        Block = -1 } = getSyntaxKinds(typescript);
    const { getSymbolAtLocation = false, getResolvedSignature = false,
        getReturnTypeOfSignature = false } = getObject(checker);
    let contracts = new Map();

    if (typeof getSymbolAtLocation !== 'function' ||
        typeof getResolvedSignature !== 'function') return contracts;

    let declarationsByName = new Map();
    const gather = (node = {}) => {
        const { kind = 0, name = {}, initializer = {} } = getObject(node);
        const { kind: nameKind = 0, text: nameText = '' } = getObject(name);
        const { kind: initializerKind = 0 } = getObject(initializer);
        const isFunctionBinding = kind === FunctionDeclaration ||
            kind === VariableDeclaration && [ArrowFunction, FunctionExpression].includes(initializerKind);

        if (!isFunctionBinding || nameKind !== Identifier) {
            return;
        }

        const symbol = getSymbolAtLocation.call(checker, name);
        const current = declarationsByName.get(nameText) || [];

        declarationsByName = symbol
            ? new Map([...declarationsByName, [nameText, [...current, { symbol, node }]]])
            : declarationsByName;
    };

    census.select(FunctionDeclaration, VariableDeclaration).forEach(gather);

    const visit = (node = {}) => {
        const { kind = 0, expression = {}, arguments: args = [] } = getObject(node);

        if (kind === CallExpression && getObject(expression).kind === Identifier && args.length) {
            const { text: expressionName = '' } = getObject(expression);
            const symbol = getSymbolAtLocation.call(checker, expression);
            const signature = getResolvedSignature.call(checker, node);
            const { declaration = {}, parameters = [] } = getObject(signature);
            const { kind: declarationKind = 0, body = false, parent = {} } = getObject(declaration);
            const { kind: parentKind = 0, parent: parentOwner = {} } = getObject(parent);
            const { parent: parentStatement = {} } = getObject(parentOwner);
            const { parent: declaringBlock = {} } = getObject(parentStatement);
            const declarations = getObject(symbol).declarations || [];
            const resultType = typeof getReturnTypeOfSignature === 'function'
                ? getObject(getReturnTypeOfSignature.call(checker, signature)) : {};
            const { getCallSignatures = false } = resultType;
            const callableResult = typeof getCallSignatures === 'function' &&
                Boolean(getCallSignatures.call(resultType).length);
            const selectedPartial = declarationKind === FunctionDeclaration && !body &&
                parameters.length === args.length &&
                declarations.some((candidate = {}) => {
                    const { kind: candidateKind = 0, body: implementation = false,
                        parameters: implementationParameters = [] } = getObject(candidate);

                    return candidateKind === FunctionDeclaration && implementation &&
                        implementationParameters.length > args.length &&
                        implementationParameters.slice(args.length).every((parameter = {}) => (
                            Boolean(getObject(parameter).questionToken || getObject(parameter).initializer)
                        ));
                }) && callableResult;
            const localFunction = declarationKind === FunctionDeclaration && body && parentKind === Block ||
                [ArrowFunction, FunctionExpression].includes(declarationKind) && body &&
                parentKind === VariableDeclaration && getObject(declaringBlock).kind === Block;
            const localShadow = localFunction && parameters.length === args.length &&
                (declarationsByName.get(expressionName) || []).some(({ symbol: other = false,
                    node: otherNode = {} } = {}) => {
                    const { initializer: otherInitializer = {} } = getObject(otherNode);
                    const { parameters: otherParameters = [] } = getObject(otherNode).kind === VariableDeclaration
                        ? getObject(otherInitializer) : getObject(otherNode);

                    return other !== symbol && otherParameters.length !== parameters.length;
                });
            const action = [selectedPartial && 'retain-overloaded-partial-call',
                localShadow && 'retain-resolved-local-call'].find(Boolean) || '';
            const sourceRange = action ? getConsumerContractKey(node) : '';

            contracts = sourceRange ? new Map([...contracts, [sourceRange, {
                sourceRange,
                action,
                evidence: selectedPartial
                    ? ['checker selects a callable-result overload at this argument count',
                        'source implementation has only optional later parameters']
                    : ['checker resolves this call to the nested local declaration',
                        'a distinct same-named function declaration has a different symbol']
            }]]) : contracts;
        }
    };

    census.select(CallExpression).forEach(visit);

    return contracts;
};

// A dropped chain that forwards fulfillment to the enclosing native Promise
// resolver is detached work. Void makes its existing rejection ownership
// explicit without adding a catch or settling the outer Promise differently.
const collectDetachedPromiseForwardContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const { ExpressionStatement = -1, CallExpression = -1, PropertyAccessExpression = -1,
        Identifier = -1, NewExpression = -1, ArrowFunction = -1,
        FunctionExpression = -1, VariableDeclaration = -1 } = getSyntaxKinds(typescript);
    const { getSymbolAtLocation = false, getTypeAtLocation = false,
        getPromisedTypeOfPromise = false } = getObject(checker);
    let contracts = new Map();

    if ([getSymbolAtLocation, getTypeAtLocation, getPromisedTypeOfPromise]
        .some(method => typeof method !== 'function')) return contracts;

    const nativePromise = (candidate = {}) => {
        const { kind = 0, expression = {}, arguments: args = [] } = getObject(candidate);
        const { kind: expressionKind = 0, text = '' } = getObject(expression);
        const [executor = {}] = args;
        const { kind: executorKind = 0, parameters = [] } = getObject(executor);
        const symbol = kind === NewExpression && expressionKind === Identifier && text === 'Promise'
            ? getSymbolAtLocation.call(checker, expression) : false;
        const declarations = getObject(symbol).declarations || [];

        return [ArrowFunction, FunctionExpression].includes(executorKind) && Boolean(parameters.length) &&
            declarations.some((declaration = {}) => (
                getObject(declaration).kind === VariableDeclaration &&
                Boolean(declaration.getSourceFile().hasNoDefaultLib)
            )) ? executor : false;
    };
    const ownsResolver = (statement = {}, resolver = {}) => {
        const resolverSymbol = getSymbolAtLocation.call(checker, resolver);
        let { parent: ancestor = false } = getObject(statement);

        // eslint-disable-next-line resilient/prefer-prototype-methods -- Promise-owner lookup preserves symbol query order and skips the matched executor parent Get.
        while (ancestor) {
            const executor = nativePromise(ancestor);
            const [parameter = {}] = getObject(executor).parameters || [];
            const { name = {} } = getObject(parameter);

            if (executor && resolverSymbol && getSymbolAtLocation.call(checker, name) === resolverSymbol) {
                return getConsumerContractKey(ancestor);
            }

            const { parent: nextAncestor = false } = getObject(ancestor);

            ancestor = nextAncestor;
        }

        return '';
    };
    const visit = (node = {}) => {
        const { kind = 0, expression = {} } = getObject(node);
        const { kind: callKind = 0, expression: callee = {}, arguments: args = [] } = getObject(expression);
        const { kind: calleeKind = 0, name = {} } = getObject(callee);
        const [resolver = {}] = args;
        const staticThen = kind === ExpressionStatement && callKind === CallExpression &&
            calleeKind === PropertyAccessExpression && getObject(name).text === 'then' &&
            args.length === 1 && getObject(resolver).kind === Identifier;

        if (!staticThen) {
            return;
        }

        const promiseType = getTypeAtLocation.call(checker, expression);
        const promised = getPromisedTypeOfPromise.call(checker, promiseType);
        const ownerRange = promised ? ownsResolver(node, resolver) : '';
        const sourceRange = ownerRange ? getConsumerContractKey(node) : '';

        if (sourceRange) contracts = new Map([...contracts, [sourceRange, {
            sourceRange,
            chainRange: getConsumerContractKey(expression),
            ownerRange,
            action: 'explicit-detached-promise-forwarding',
            evidence: ['checker resolves a promise-valued static then chain',
                'terminal callback is the enclosing native Promise fulfillment resolver',
                'rejection remains detached from the outer Promise']
        }]]);
    };

    census.select(ExpressionStatement).forEach(visit);

    return contracts;
};

// Explicitly declared void or nullish result channels retain authored
// undefined/null. Inference from the return expression alone is not evidence
// of a producer agreement, and a value-family default would change behavior.
const collectDeclaredNullishResultContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const { ArrowFunction = -1, FunctionExpression = -1, FunctionDeclaration = -1,
        Block = -1, ReturnStatement = -1, Identifier = -1, NullKeyword = -1 } = getSyntaxKinds(typescript);
    const { TypeFlags: { Void = 0, Undefined = 0, Null = 0,
        Any = 0, Unknown = 0 } = {} } = typescript;
    const { getContextualType = false, getSignatureFromDeclaration = false,
        getReturnTypeOfSignature = false, getTypeAtLocation = false } = getObject(checker);
    let contracts = new Map();

    if (typeof getSignatureFromDeclaration !== 'function' ||
        typeof getReturnTypeOfSignature !== 'function' ||
        typeof getTypeAtLocation !== 'function') return contracts;

    const hasMember = (type = {}, flag = 0) => {
        const { flags = 0, types = [] } = getObject(type);

        return Boolean(flags & flag) || types.some((part = {}) => Boolean(getObject(part).flags & flag));
    };
    const collectReturns = (body = {}) => {
        const { kind = 0 } = getObject(body);

        if (kind !== Block) return [body];

        const visit = (node = {}) => {
            const { kind: nodeKind = 0, expression = {} } = getObject(node);

            if ([ArrowFunction, FunctionExpression, FunctionDeclaration].includes(nodeKind)) return [];

            if (nodeKind === ReturnStatement) return [expression];

            let returns = [];

            typescript.forEachChild(node, (child) => { returns = [...returns, ...visit(child)]; });

            return returns;
        };

        return visit(body);
    };
    const collectFunctionResults = ({ node = {}, body = {}, resultType = {} } = {}) => {
        const { flags: resultFlags = 0 } = getObject(resultType);

        if (resultFlags & (Any | Unknown)) return;

        collectReturns(body).forEach((expression = {}) => {
            const { kind: expressionKind = 0, text = '' } = getObject(expression);
            const isUndefined = expressionKind === Identifier && text === 'undefined' &&
                hasMember(getTypeAtLocation.call(checker, expression), Undefined);
            const isNull = expressionKind === NullKeyword;
            const admitted = isUndefined && (hasMember(resultType, Void) ||
                hasMember(resultType, Undefined)) || isNull && hasMember(resultType, Null);
            const sourceRange = admitted ? getConsumerContractKey(expression) : '';
            const { statements = [] } = getObject(body);
            const [onlyStatement = {}] = statements;
            const emptyResult = isUndefined && (getObject(body).kind !== Block ||
                (statements.length === 1 && getObject(onlyStatement).kind === ReturnStatement &&
                    getObject(onlyStatement).expression === expression));
            let action = 'retain-declared-undefined-result';

            if (isNull) action = 'retain-declared-null-result';

            if (emptyResult) action = 'normalize-empty-result';

            if (!sourceRange) return;

            contracts = new Map([...contracts, [sourceRange, {
                sourceRange,
                functionRange: getConsumerContractKey(node),
                action,
                result: isNull ? 'null' : 'undefined',
                evidence: ['checker-declared normal result includes this nullish value',
                    'authored return expression supplies that value directly']
            }]]);
        });
    };
    const visit = (node = {}) => {
        const { kind = 0, type = false, body = {} } = getObject(node);

        if ([ArrowFunction, FunctionExpression, FunctionDeclaration].includes(kind)) {
            const contextual = typeof getContextualType === 'function'
                ? getObject(getContextualType.call(checker, node)) : {};
            const { getCallSignatures = false } = contextual;
            const [contextualSignature = false] = typeof getCallSignatures === 'function'
                ? getCallSignatures.call(contextual) : [];
            const signature = type
                ? getSignatureFromDeclaration.call(checker, node) : contextualSignature;
            const resultType = signature ? getReturnTypeOfSignature.call(checker, signature) : {};
            collectFunctionResults({ node, body, resultType });
        }
    };

    census.select(ArrowFunction, FunctionExpression, FunctionDeclaration).forEach(visit);

    return contracts;
};

// A mutable tagged result is selected anew at every loop admission. A binding
// before the loop would freeze the first tag; this fact owns the loop plus its
// direct exit return so grammar can place each selected read at its source
// phase without introducing another traversal or callback.
const collectMutableSelectedLoopContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        Block = -1, WhileStatement = -1, BinaryExpression = -1,
        PropertyAccessExpression = -1, Identifier = -1, StringLiteral = -1,
        EqualsEqualsEqualsToken = -1, EqualsToken = -1, ExpressionStatement = -1,
        CallExpression = -1, ReturnStatement = -1, ArrayLiteralExpression = -1,
        VariableDeclaration = -1, Parameter = -1
    } = getSyntaxKinds(typescript);
    const { NodeFlags: { Let: LetFlag = 0 } = {} } = typescript;
    const { getSymbolAtLocation = false, getTypeAtLocation = false, getPropertyOfType = false } = getObject(checker);
    let contracts = new Map();

    if ([getSymbolAtLocation, getTypeAtLocation, getPropertyOfType].some(method => typeof method !== 'function')) {
        return contracts;
    }

    const sameReceiver = (read = {}, symbol = false, property = '') => {
        const { kind = 0, expression = {}, name = {} } = getObject(read);

        return kind === PropertyAccessExpression && getObject(expression).kind === Identifier &&
            getObject(name).text === property &&
            getSymbolAtLocation.call(checker, expression) === symbol;
    };
    const isAssignment = (statement = {}) => {
        const { kind = 0, expression = {} } = getObject(statement);
        const { operatorToken = {}, left = {}, right = {} } = getObject(expression);

        return kind === ExpressionStatement && getObject(expression).kind === BinaryExpression &&
            getObject(operatorToken).kind === EqualsToken && getObject(left).kind === Identifier
            ? { left, right }
            : {};
    };
    const inspectMutableSelectedBlock = (block = {}) => {
        const { kind = 0, statements = [] } = getObject(block);

        if (kind !== Block) return;

        statements.forEach((loop = {}, index) => {
            const { [index + 1]: exit = {} } = statements;
            const { kind: loopKind = 0, expression: condition = {}, statement: body = {} } = getObject(loop);
            const { kind: conditionKind = 0, left: tag = {}, right: literal = {}, operatorToken = {} } = getObject(condition);
            const { statements: bodyStatements = [], kind: bodyKind = 0 } = getObject(body);
            const [first = {}, second = {}, third = {}] = bodyStatements;
            const { left: resultName = {}, right: invocation = {} } = isAssignment(second);
            const { left: updatedName = {} } = isAssignment(third);
            const { expression: callee = {}, arguments: args = [] } = getObject(invocation);
            const [leftRead = {}] = args;
            const { expression: returned = {} } = getObject(exit);
            const { elements = [] } = getObject(returned);
            const [rightRead = {}] = elements;
            const { expression: receiver = {} } = getObject(tag);

            // This collector owns one finite loop shape. Admit that syntax before
            // consulting checker facts: unrelated blocks can contain intrinsic
            // symbols (such as `arguments`) with no value declaration.
            const admittedShape = loopKind === WhileStatement && conditionKind === BinaryExpression &&
                getObject(operatorToken).kind === EqualsEqualsEqualsToken &&
                getObject(literal).kind === StringLiteral && getObject(literal).text === 'Left' &&
                bodyKind === Block && bodyStatements.length === 3 && Boolean(getObject(first).kind) &&
                getObject(invocation).kind === CallExpression && args.length === 1 &&
                getObject(resultName).kind === Identifier && getObject(updatedName).kind === Identifier &&
                getObject(exit).kind === ReturnStatement &&
                getObject(returned).kind === ArrayLiteralExpression && Boolean(elements.length) &&
                getObject(tag).kind === PropertyAccessExpression &&
                getObject(receiver).kind === Identifier && getObject(getObject(tag).name).text === '_tag' &&
                getObject(leftRead).kind === PropertyAccessExpression &&
                getObject(getObject(leftRead).expression).kind === Identifier &&
                getObject(getObject(leftRead).name).text === 'left' &&
                getObject(rightRead).kind === PropertyAccessExpression &&
                getObject(getObject(rightRead).expression).kind === Identifier &&
                getObject(getObject(rightRead).name).text === 'right' &&
                getObject(callee).kind === Identifier;

            if (!admittedShape) return;

            const symbol = getObject(receiver).kind === Identifier
                ? getSymbolAtLocation.call(checker, receiver)
                : false;
            const { valueDeclaration: declaration = {} } = getObject(symbol);
            const { name: declarationName = {}, parent: declarationList = {} } = getObject(declaration);
            const hasCheckerQueryNode = getObject(declaration).kind === VariableDeclaration &&
                getObject(declarationName).kind === Identifier;

            if (!hasCheckerQueryNode) return;

            const { types: variants = [] } = getObject(getTypeAtLocation.call(checker, declarationName));
            const taggedPair = Array.isArray(variants) && variants.length === 2 &&
                variants.every(part => getPropertyOfType.call(checker, part, '_tag')) &&
                variants.some(part => getPropertyOfType.call(checker, part, 'left')) &&
                variants.some(part => getPropertyOfType.call(checker, part, 'right'));
            const calleeSymbol = getObject(callee).kind === Identifier
                ? getSymbolAtLocation.call(checker, callee)
                : false;
            const eligible = getObject(updatedName).kind === Identifier &&
                getSymbolAtLocation.call(checker, updatedName) === symbol &&
                getObject(getObject(calleeSymbol).valueDeclaration).kind === Parameter &&
                Boolean(getObject(declarationList).flags & LetFlag) && taggedPair &&
                sameReceiver(tag, symbol, '_tag') &&
                sameReceiver(leftRead, symbol, 'left') &&
                sameReceiver(rightRead, symbol, 'right');

            if (!eligible) return;

            const loopRange = getConsumerContractKey(loop);
            const returnRange = getConsumerContractKey(exit);
            const contract = {
                action: 'mutable-selected-loop-binding', loopRange, returnRange,
                tagRange: getConsumerContractKey(tag), leftRange: getConsumerContractKey(leftRead),
                rightRange: getConsumerContractKey(rightRead),
                receiverName: getObject(receiver).text,
                evidence: ['checker-proven mutable tagged union is selected on each loop admission and direct exit']
            };

            const { tagRange = '', leftRange = '', rightRange = '' } = contract;

            contracts = new Map([...contracts, [loopRange, contract], [returnRange, contract],
                [tagRange, contract], [leftRange, contract], [rightRange, contract]]);
        });
    };
    const visit = (node = {}) => {
        inspectMutableSelectedBlock(node);
    };

    census.select(Block).forEach(visit);

    return contracts;
};

// An indexed local may be selected twice in one live iteration. Each field
// read belongs after its own preceding expression work, not at loop entry.
const collectIndexedLocalSelectionContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        ForStatement = -1, Block = -1, ExpressionStatement = -1,
        VariableStatement = -1, BinaryExpression = -1, CallExpression = -1,
        ElementAccessExpression = -1, PropertyAccessExpression = -1,
        Identifier = -1, VariableDeclaration = -1,
        EqualsToken = -1, PlusEqualsToken = -1, PlusToken = -1
    } = getSyntaxKinds(typescript);
    const { NodeFlags: { Let: LetFlag = 0 } = {} } = typescript;
    const { getSymbolAtLocation = false, getTypeAtLocation = false, getPropertyOfType = false } = getObject(checker);
    let contracts = new Map();

    if ([getSymbolAtLocation, getTypeAtLocation, getPropertyOfType].some(method => typeof method !== 'function')) {
        return contracts;
    }

    const getAssignment = (statement = {}, operator = -1) => {
        const { kind = 0, expression = {} } = getObject(statement);
        const { kind: expressionKind = 0, operatorToken = {} } = getObject(expression);

        return kind === ExpressionStatement && expressionKind === BinaryExpression &&
            getObject(operatorToken).kind === operator
            ? expression
            : {};
    };
    const inspectIndexedLoop = (loop = {}) => {
        const { kind = 0, statement: body = {}, initializer = {} } = getObject(loop);
        const { kind: bodyKind = 0, statements = [] } = getObject(body);

        if (kind !== ForStatement || bodyKind !== Block || statements.length !== 4) return;

        const [selected = {}, interim = {}, firstWrite = {}, secondWrite = {}] = statements;
        const { left: selection = {}, right: indexed = {} } = getAssignment(selected, EqualsToken);
        const { expression: collection = {}, argumentExpression: index = {} } = getObject(indexed);
        const { declarations: [indexDeclaration = {}] = [] } = getObject(initializer);
        const { name: indexName = {} } = getObject(indexDeclaration);
        const { left: firstAccumulator = {}, right: firstSum = {} } = getAssignment(firstWrite, PlusEqualsToken);
        const { left: secondAccumulator = {}, right: secondCall = {} } = getAssignment(secondWrite, PlusEqualsToken);
        const { left: firstPrefix = {}, right: firstRead = {}, operatorToken: firstOperator = {} } = getObject(firstSum);
        const { expression: callee = {}, arguments: callArguments = [] } = getObject(secondCall);
        const [secondPrefix = {}, secondRead = {}] = callArguments;
        const { expression: firstReceiver = {}, name: firstName = {}, questionDotToken: firstOptional = false } = getObject(firstRead);
        const { expression: secondReceiver = {}, name: secondName = {}, questionDotToken: secondOptional = false } = getObject(secondRead);
        const selectionSymbol = getObject(selection).kind === Identifier
            ? getSymbolAtLocation.call(checker, selection)
            : false;
        const accumulatorSymbol = getObject(firstAccumulator).kind === Identifier
            ? getSymbolAtLocation.call(checker, firstAccumulator)
            : false;
        const { valueDeclaration: selectedDeclaration = {} } = getObject(selectionSymbol);
        const { valueDeclaration: accumulatorDeclaration = {} } = getObject(accumulatorSymbol);
        const { parent: selectedList = {} } = getObject(selectedDeclaration);
        const { parent: accumulatorList = {} } = getObject(accumulatorDeclaration);
        const selectedType = selectionSymbol && getTypeAtLocation.call(checker, firstReceiver);
        const firstProperty = getObject(firstName).text || '';
        const secondProperty = getObject(secondName).text || '';
        const eligible = getObject(interim).kind === VariableStatement &&
            getObject(indexed).kind === ElementAccessExpression &&
            getObject(collection).kind === Identifier && isArrayLikeExpression({ checker, node: collection }) &&
            getObject(index).kind === Identifier && getObject(indexName).kind === Identifier &&
            getSymbolAtLocation.call(checker, index) === getSymbolAtLocation.call(checker, indexName) &&
            getObject(firstSum).kind === BinaryExpression &&
            getObject(firstOperator).kind === PlusToken && Boolean(getObject(firstPrefix).kind) &&
            getObject(firstRead).kind === PropertyAccessExpression && !firstOptional &&
            getObject(secondCall).kind === CallExpression && getObject(callee).kind === Identifier &&
            callArguments.length === 2 && Boolean(getObject(secondPrefix).kind) &&
            getObject(secondRead).kind === PropertyAccessExpression && !secondOptional &&
            getObject(firstReceiver).kind === Identifier && getObject(secondReceiver).kind === Identifier &&
            selectionSymbol && accumulatorSymbol && selectionSymbol !== accumulatorSymbol &&
            getSymbolAtLocation.call(checker, firstReceiver) === selectionSymbol &&
            getSymbolAtLocation.call(checker, secondReceiver) === selectionSymbol &&
            getSymbolAtLocation.call(checker, secondAccumulator) === accumulatorSymbol &&
            getObject(selectedDeclaration).kind === VariableDeclaration &&
            getObject(accumulatorDeclaration).kind === VariableDeclaration &&
            Boolean(getObject(selectedList).flags & LetFlag) &&
            Boolean(getObject(accumulatorList).flags & LetFlag) &&
            firstProperty && secondProperty &&
            getPropertyOfType.call(checker, selectedType, firstProperty) &&
            getPropertyOfType.call(checker, selectedType, secondProperty);

        if (!eligible) return;

        const loopRange = getConsumerContractKey(loop);
        const firstReadRange = getConsumerContractKey(firstRead);
        const secondReadRange = getConsumerContractKey(secondRead);
        const contract = {
            action: 'indexed-local-staged-selection', loopRange, firstReadRange, secondReadRange,
            selectionName: getObject(selection).text,
            accumulatorName: getObject(firstAccumulator).text,
            firstProperty, secondProperty,
            evidence: ['checker-proven indexed local fields selected after their distinct per-iteration effects']
        };

        contracts = new Map([...contracts, [loopRange, contract], [firstReadRange, contract], [secondReadRange, contract]]);
    };
    const visit = (node = {}) => {
        inspectIndexedLoop(node);
    };

    census.select(ForStatement).forEach(visit);

    return contracts;
};

// A direct-live tuple traversal that writes through a fresh record owns the
// original property-reference evaluation. Object spread cannot stand in for
// assignment: key coercion and inherited setters are observable.
const collectOperationalObjectBuilderContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        Block = -1, VariableStatement = -1, VariableDeclaration = -1,
        Identifier = -1, ObjectLiteralExpression = -1, ForOfStatement = -1,
        ExpressionStatement = -1, BinaryExpression = -1, ElementAccessExpression = -1,
        NumericLiteral = -1, ReturnStatement = -1, EqualsToken = -1,
        ArrayBindingPattern = -1
    } = getSyntaxKinds(typescript);
    const { IndexKind: { String: StringIndex = -1 } = {} } = getObject(typescript);
    const { getTypeAtLocation = false, getIndexTypeOfType = false,
        isArrayType = false, isTupleType = false, typeToString = false } = getObject(checker);
    let contracts = new Map();

    if ([getTypeAtLocation, getIndexTypeOfType, isArrayType, isTupleType, typeToString]
        .some(method => typeof method !== 'function')) return contracts;

    const getPosition = (node = {}, itemName = '', index = -1) => {
        const { kind = 0, expression = {}, argumentExpression = {} } = getObject(node);

        return kind === ElementAccessExpression && getObject(expression).kind === Identifier &&
            getObject(expression).text === itemName && getObject(argumentExpression).kind === NumericLiteral &&
            Number(getObject(argumentExpression).text) === index;
    };
    const inspectUnit = (statements = []) => {
        const [declarationStatement = {}, loop = {}, returned = {}] = statements;
        const { declarationList = {} } = getObject(declarationStatement);
        const { declarations = [] } = getObject(declarationList);
        const [declaration = {}] = declarations;
        const { name: output = {}, initializer = {} } = getObject(declaration);
        const { properties: initializerProperties = [] } = getObject(initializer);
        const { initializer: loopDeclarationList = {}, expression: loopSource = {},
            statement: loopStatement = {}, awaitModifier = false } = getObject(loop);
        const { declarations: loopDeclarations = [] } = getObject(loopDeclarationList);
        const [loopDeclaration = {}] = loopDeclarations;
        const { name: item = {} } = getObject(loopDeclaration);
        const { elements: itemElements = [] } = getObject(item);
        const [{ name: keyBinding = {} } = {}, { name: valueBinding = {} } = {}] = itemElements;
        const { statements: loopStatements = [] } = getObject(loopStatement);
        const [body = {}] = getObject(loopStatement).kind === Block ? loopStatements : [loopStatement];
        const { expression: assignment = {} } = getObject(body);
        const { left = {}, right = {}, operatorToken = {} } = getObject(assignment);
        const { expression: target = {}, argumentExpression: keyRead = {} } = getObject(left);
        const { expression: returnValue = {} } = getObject(returned);
        const outputName = getObject(output).text || '';
        const itemName = getObject(item).text || '';
        const sharedShape = getObject(declarationStatement).kind === VariableStatement && declarations.length === 1 &&
            getObject(declaration).kind === VariableDeclaration && getObject(output).kind === Identifier &&
            getObject(initializer).kind === ObjectLiteralExpression && !initializerProperties.length &&
            getObject(loop).kind === ForOfStatement && !awaitModifier && loopDeclarations.length === 1 &&
            (getObject(loopStatement).kind !== Block || loopStatements.length === 1) &&
            getObject(body).kind === ExpressionStatement && getObject(assignment).kind === BinaryExpression &&
            getObject(operatorToken).kind === EqualsToken && getObject(left).kind === ElementAccessExpression &&
            getObject(target).kind === Identifier && getObject(target).text === outputName &&
            getObject(returned).kind === ReturnStatement && getObject(returnValue).kind === Identifier &&
            getObject(returnValue).text === outputName;
        const arraySource = sharedShape && (isArrayType.call(checker, getTypeAtLocation.call(checker, loopSource)) ||
            isTupleType.call(checker, getTypeAtLocation.call(checker, loopSource)));
        const indexedShape = arraySource && getObject(item).kind === Identifier &&
            getObject(loopSource).kind === Identifier && getObject(loopSource).text !== outputName &&
            getPosition(keyRead, itemName, 0) && getPosition(right, itemName, 1) &&
            isTupleType.call(checker, getTypeAtLocation.call(checker, item)) &&
            Boolean(getIndexTypeOfType.call(checker, getTypeAtLocation.call(checker, output), StringIndex));
        const { kind: keyKind = 0, text: keyName = '' } = getObject(keyBinding);
        const { kind: valueKind = 0, text: valueName = '' } = getObject(valueBinding);
        const { kind: keyReadKind = 0, text: keyReadName = '' } = getObject(keyRead);
        const { kind: rightKind = 0, text: rightName = '' } = getObject(right);
        const destructuredShape = arraySource && getObject(item).kind === ArrayBindingPattern &&
            itemElements.length === 2 && keyKind === Identifier && valueKind === Identifier &&
            keyReadKind === Identifier && keyReadName === keyName &&
            rightKind === Identifier && rightName === valueName &&
            typeToString.call(checker, getTypeAtLocation.call(checker, keyBinding)) === 'string';

        if (indexedShape || destructuredShape) {
            const loopRange = getConsumerContractKey(loop);

            contracts = new Map([...contracts, [loopRange, {
                action: 'operational-object-builder', loopRange,
                bindingShape: destructuredShape ? 'destructured-entry' : 'indexed-entry',
                statementRange: getConsumerContractKey(body),
                keyRange: indexedShape ? getConsumerContractKey(keyRead) : '',
                valueRange: indexedShape ? getConsumerContractKey(right) : '',
                outputName, itemName,
                evidence: indexedShape
                    ? ['checker-proven live tuple traversal writes one fresh returned record',
                        'assignment key coercion, indexed value read, and inherited setters stay source-owned']
                    : ['checker-proven live entry traversal writes one fresh returned object',
                        'entry iteration, native failure, assignment setter and __proto__ behavior stay source-owned']
            }]]);
        }
    };
    const visit = (node = {}) => {
        const { kind = 0, statements = [] } = getObject(node);

        if (kind === Block) {
            statements.forEach((_, index) => {
                if (index + 2 < statements.length) inspectUnit(statements.slice(index, index + 3));
            });
        }
    };

    census.select(Block).forEach(visit);

    return contracts;
};

// Standard array cardinality is a native property Get, not an object-shape
// declaration. Keep the read at its original declaration phase.
const collectArrayCardinalityContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const { VariableDeclaration = -1, Identifier = -1,
        PropertyAccessExpression = -1 } = getSyntaxKinds(typescript);
    const { getTypeAtLocation = false, isArrayType = false, isTupleType = false } = getObject(checker);
    let contracts = new Map();

    if ([getTypeAtLocation, isArrayType, isTupleType].some(method => typeof method !== 'function')) {
        return contracts;
    }

    const visit = (node = {}) => {
        const { kind = 0, name: binding = {}, initializer = {} } = getObject(node);
        const { kind: initializerKind = 0, expression: receiver = {},
            name: member = {}, questionDotToken = false } = getObject(initializer);
        const receiverType = kind === VariableDeclaration && initializerKind === PropertyAccessExpression &&
            getObject(receiver).kind === Identifier && !questionDotToken &&
            getObject(member).text === 'length'
            ? getTypeAtLocation.call(checker, receiver)
            : {};
        const standardArray = receiverType && (isArrayType.call(checker, receiverType) ||
            isTupleType.call(checker, receiverType));
        const sourceRange = standardArray && getObject(binding).kind === Identifier
            ? getConsumerContractKey(initializer)
            : '';

        if (sourceRange) contracts = new Map([...contracts, [sourceRange, {
            sourceRange,
            action: 'retain-array-cardinality-read',
            evidence: ['checker-proven standard array length retains its native property Get',
                'object destructuring would claim an object-like contract for an array-like value']
        }]]);
    };

    census.select(VariableDeclaration).forEach(visit);

    return contracts;
};

const collectConsoleEffectContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const { CallExpression = -1, PropertyAccessExpression = -1, Identifier = -1 } = getSyntaxKinds(typescript);
    const { getSymbolAtLocation = false } = getObject(checker);
    let contracts = new Map();

    const visit = (node = {}) => {
        const { kind = 0, expression: callee = {}, questionDotToken = false } = getObject(node);
        const { kind: calleeKind = 0, expression: receiver = {}, questionDotToken: optionalMember = false } = getObject(callee);
        const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);

        if (kind !== CallExpression || calleeKind !== PropertyAccessExpression ||
            receiverKind !== Identifier || receiverName !== 'console' || questionDotToken || optionalMember) {
            return;
        }

        const symbol = typeof getSymbolAtLocation === 'function'
            ? getSymbolAtLocation.call(checker, receiver)
            : {};
        const { declarations = [] } = getObject(symbol);
        const standardGlobal = declarations.some((declaration = {}) => {
            const { getSourceFile = false } = getObject(declaration);
            const source = typeof getSourceFile === 'function' ? getSourceFile.call(declaration) : {};

            return /(?:^|\/)lib\.[^/]+\.d\.ts$/.test(getObject(source).fileName);
        });

        if (standardGlobal) {
            const sourceRange = getConsumerContractKey(node);
            const contract = {
                key: sourceRange,
                sourceRange,
                action: 'retain-console-effect',
                owner: 'authored-io',
                evidence: ['checker-proven global console call owns its observable I/O at invocation']
            };

            contracts = new Map([...contracts, [sourceRange, contract]]);
        }
    };

    census.select(CallExpression).forEach(visit);

    return contracts;
};

// Abstract equality with null is an authored null-or-undefined test. The
// checker records its operand and the nearest owning statement; placement
// retains the operation instead of splitting or re-evaluating that operand.
const collectNullishEqualityContracts = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const { SyntaxKind: {
        BinaryExpression = -1, NullKeyword = -1,
        EqualsEqualsToken = -1, ExclamationEqualsToken = -1,
        VariableStatement = -1, ReturnStatement = -1, IfStatement = -1,
        ExpressionStatement = -1
    } = {} } = typescript;
    const { getTypeAtLocation = false } = getObject(checker);

    if (typeof getTypeAtLocation !== 'function') return new Map();

    const ownerKinds = [VariableStatement, ReturnStatement, IfStatement, ExpressionStatement];
    const contracts = new Map();
    const getOwner = (node = {}) => {
        const { kind = 0, parent = {} } = getObject(node);

        if (!kind || ownerKinds.includes(kind)) return node;

        return getOwner(parent);
    };
    const getContract = (node = {}) => {
        const { kind = 0, left = {}, right = {}, operatorToken = {} } = getObject(node);
        const { kind: operator = 0 } = getObject(operatorToken);
        const leftNull = getObject(left).kind === NullKeyword;
        const rightNull = getObject(right).kind === NullKeyword;

        if (kind !== BinaryExpression || ![EqualsEqualsToken, ExclamationEqualsToken].includes(operator) ||
            leftNull === rightNull) return {};

        const operand = leftNull ? right : left;
        const { flags = 0 } = getObject(getTypeAtLocation(operand));
        const owner = getOwner(getObject(node).parent);
        const key = getConsumerContractKey(owner);

        if (!flags || !ownerKinds.includes(getObject(owner).kind) || !key) return {};

        return {
            key,
            sourceRange: key,
            comparisonRange: getConsumerContractKey(node),
            action: 'retain-nullish-abstract-equality',
            evidence: ['checker identifies the compared operand',
                'source abstract equality with null tests null and undefined once']
        };
    };
    const visit = (node = {}) => {
        const contract = getContract(node);
        const { key = '' } = getObject(contract);

        if (key) {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private fact Map overwrites an owner range without moving its insertion position.
            contracts.set(key, contract);
        }
    };

    census.select(BinaryExpression).forEach(visit);

    return contracts;
};

// A finite switch may return values for admitted cases while preserving an
// authored no-value exit. Checker exhaustiveness or a source bare return owns
// that exit; generated switch syntax alone cannot establish the agreement.
const collectSwitchReturnContracts = ({ typescript = {}, sourceFile = {}, checker = {} } = {}) => {
    const { SyntaxKind: {
        FunctionDeclaration = -1, VariableStatement = -1, ArrowFunction = -1,
        Block = -1, SwitchStatement = -1, CaseClause = -1,
        ReturnStatement = -1, StringLiteral = -1, NumericLiteral = -1
    } = {}, TypeFlags: { Any = 0, Unknown = 0, StringLiteral: StringType = 0,
        NumberLiteral: NumberType = 0 } = {} } = typescript;
    const { getTypeAtLocation = false } = getObject(checker);

    if (typeof getTypeAtLocation !== 'function') return new Map();

    const getCaseValue = (expression = {}) => {
        const { kind = 0, text = '' } = getObject(expression);

        return [StringLiteral, NumericLiteral].includes(kind) ? String(text) : '';
    };
    const getFinalArrow = (functionNode = {}) => {
        const { body = {} } = getObject(functionNode);

        return getObject(body).kind === ArrowFunction ? getFinalArrow(body) : functionNode;
    };
    const getOwner = (statement = {}) => {
        const { kind = 0, name = {}, body = {}, declarationList = {} } = getObject(statement);

        if (kind === FunctionDeclaration) return { sourceName: getObject(name).text || '', body };

        if (kind !== VariableStatement) return {};

        const { declarations = [] } = getObject(declarationList);
        const [declaration = {}] = declarations;
        const { initializer: functionNode = {}, name: declarationName = {} } = getObject(declaration);

        if (declarations.length !== 1 || getObject(functionNode).kind !== ArrowFunction) return {};

        const { body: functionBody = {} } = getObject(getFinalArrow(functionNode));

        return {
            sourceName: getObject(declarationName).text || '',
            body: functionBody
        };
    };
    const { statements: sourceStatements = [] } = getObject(sourceFile);
    const entries = sourceStatements.flatMap((statement = {}) => {
        const { sourceName = '', body = {} } = getOwner(statement);
        const { statements = [] } = getObject(body);
        const [switchNode = {}, exitNode = {}] = statements;
        const { expression = {}, caseBlock = {} } = getObject(switchNode);
        const { clauses = [] } = getObject(caseBlock);

        if (!sourceName || getObject(body).kind !== Block ||
            getObject(switchNode).kind !== SwitchStatement ||
            ![1, 2].includes(statements.length) || clauses.length < 2) return [];

        const caseValues = clauses.map((clause = {}) => {
            const { kind = 0, expression: caseExpression = {}, statements: caseStatements = [] } = getObject(clause);
            const [caseReturn = {}] = caseStatements;

            return kind === CaseClause && caseStatements.length === 1 &&
                getObject(caseReturn).kind === ReturnStatement &&
                getObject(getObject(caseReturn).expression).kind
                ? getCaseValue(caseExpression) : '';
        });

        if (caseValues.some(value => !value)) return [];

        const explicitExit = statements.length === 2 && getObject(exitNode).kind === ReturnStatement &&
            !getObject(getObject(exitNode).expression).kind;
        const switchType = getTypeAtLocation(expression);
        const { flags = 0, types = [] } = getObject(switchType);

        if (flags & (Any | Unknown)) return [];

        const literalTypes = types.length ? types : [switchType];
        const exhaustive = statements.length === 1 &&
            literalTypes.every((part = {}) => {
                const { flags: partFlags = 0, value = '' } = getObject(part);

                return !!(partFlags & (StringType | NumberType)) && caseValues.includes(String(value));
            });

        if (!explicitExit && !exhaustive) return [];

        const key = getConsumerContractKey(statement);

        return [[key, {
            key,
            sourceRange: key,
            sourceName,
            switchRange: getConsumerContractKey(switchNode),
            exitRange: explicitExit ? getConsumerContractKey(exitNode) : '',
            exitKind: explicitExit ? 'explicit-bare-return' : 'checker-exhaustive-fallthrough',
            action: 'retain-switch-no-value-exit',
            evidence: [
                'checker-proven switch discriminant excludes unknown and any',
                explicitExit
                    ? 'source bare return owns unsupported selector values'
                    : 'case literals cover every checker-proven discriminant literal'
            ]
        }]];
    });

    return new Map(entries);
};

// Arity grammar may replace optional callable formals with one rest carrier
// only when source identity proves the native capabilities it consumes. The
// record also owns parameter writes before the original formal nodes disappear.
const collectAritySignatureContracts = ({ typescript = {}, sourceFile = {}, checker = {},
    census = createSourceCensus({ typescript, sourceFile }),
    bindingReferences = collectBindingReferences({ typescript, sourceFile, checker, census }) } = {}) => {
    if (!hasTypeChecker(checker)) return new Map();

    const {
        BinaryExpression = -1,
        CallExpression = -1,
        CaseClause = -1,
        FirstAssignment = -1,
        ForInStatement = -1,
        ForOfStatement = -1,
        FunctionDeclaration = -1,
        FunctionExpression = -1,
        Identifier = -1,
        LastAssignment = -1,
        MinusMinusToken = -1,
        NumericLiteral = -1,
        Parameter = -1,
        PlusPlusToken = -1,
        PostfixUnaryExpression = -1,
        PrefixUnaryExpression = -1,
        PropertyAccessExpression = -1,
        StringLiteral = -1,
        SwitchStatement = -1,
        TypeReference = -1,
        VariableDeclaration = -1,
        VariableStatement = -1
    } = getSyntaxKinds(typescript);
    const { NodeFlags: { Const = 0 } = {}, SymbolFlags: { Alias = 0 } = {}, isExternalModule = false } = typescript;
    const { getSymbolAtLocation = false } = getObject(checker);

    if (typeof getSymbolAtLocation !== 'function' ||
        typeof isExternalModule !== 'function') return new Map();

    const functionKinds = [FunctionDeclaration, FunctionExpression];
    const identifiers = census.select(Identifier);
    const referencesOf = (symbol = false) => symbol ? bindingReferences.get(symbol) || [] : [];
    const transparent = new Set(['ParenthesizedExpression', 'AsExpression', 'TypeAssertionExpression',
        'NonNullExpression', 'SatisfiesExpression'].map(kind => getSyntaxKinds(typescript)[kind]));
    const unwrapCallee = (node = {}) => transparent.has(getObject(node).kind)
        ? unwrapCallee(getObject(node).expression) : node;
    const directEvalExposure = census.select(CallExpression).some(({ expression = {} } = {}) => {
        const callee = unwrapCallee(expression);

        return getObject(callee).kind === Identifier && getObject(callee).text === 'eval';
    });
    const isWithin = (node, ancestor) => node === ancestor || Boolean(node && isWithin(getObject(node).parent, ancestor));
    const isDirectCall = (identifier = {}) => {
        const { parent = {} } = getObject(identifier);

        return getObject(parent).kind === CallExpression && getObject(parent).expression === identifier;
    };
    const isPrivateBinding = (node = {}, sourceName = '') => {
        const { kind = 0, name = {}, parent = {} } = getObject(node);
        const declaration = kind === FunctionDeclaration ? node : parent;
        const bindingName = kind === FunctionDeclaration ? name : getObject(declaration).name;
        const symbol = getSymbolAtLocation.call(checker, bindingName);
        const outerReferences = referencesOf(symbol).filter(identifier => identifier !== bindingName);
        const innerSymbol = kind === FunctionExpression && getObject(name).kind === Identifier
            ? getSymbolAtLocation.call(checker, name) : false;
        const innerReferences = innerSymbol ? referencesOf(innerSymbol).filter(identifier => identifier !== name) : [];
        const { parent: statement = {} } = getObject(getObject(declaration).parent);
        const modifiers = getObject(kind === FunctionDeclaration ? node : statement).modifiers || [];
        const exportVisible = modifiers.some(({ kind: modifierKind = 0 } = {}) => [
            getSyntaxKinds(typescript).ExportKeyword, getSyntaxKinds(typescript).DefaultKeyword
        ].includes(modifierKind));
        const lexicalBinding = kind === FunctionDeclaration || Boolean(getObject(getObject(declaration).parent).flags & Const);
        const expectedDeclarations = kind === FunctionDeclaration ? [node] : [declaration];
        const complete = symbol && referencesOf(symbol).includes(bindingName) &&
            (getObject(symbol).declarations || []).every(item => expectedDeclarations.includes(item)) &&
            (getObject(symbol).declarations || []).length === 1;
        const allReferences = [...outerReferences, ...innerReferences];
        const afterInitialization = outerReferences.every(({ pos = -1 } = {}) => pos >= getObject(declaration).end);
        const directOnly = Boolean(allReferences.length) && allReferences.every(isDirectCall) &&
            outerReferences.every(identifier => census.ancestors(identifier)
                .every(ancestor => !typescript.isFunctionLike(ancestor)));
        const aliasExport = census.select(getSyntaxKinds(typescript).ExportSpecifier).some((specifier = {}) => (
            getSymbolAtLocation.call(checker, getObject(specifier).propertyName || getObject(specifier).name) === symbol
        ));

        const completeOuterNames = identifiers.filter(({ text = '' } = {}) => text === sourceName)
            .every(identifier => Boolean(getSymbolAtLocation.call(checker, identifier)));

        return Boolean(sourceName && lexicalBinding && complete && completeOuterNames &&
            !exportVisible && !aliasExport && !directEvalExposure &&
            afterInitialization && directOnly && (!innerSymbol ||
                (getObject(innerSymbol).declarations || []).length === 1));
    };
    const isNativeGlobalSymbol = (symbol = {}, expected = '') => {
        const { declarations = [], flags = 0, name = '' } = getObject(symbol);

        return name === expected && !(flags & Alias) && Boolean(declarations.length) &&
            declarations.every((declaration = {}) => Boolean(getObject(declaration.getSourceFile()).hasNoDefaultLib));
    };
    const hasNativeFunctionType = (parameter = {}) => {
        const { type = {} } = getObject(parameter);
        const { typeName = {} } = getObject(type);

        return getObject(type).kind === TypeReference && getObject(typeName).kind === Identifier &&
            getObject(typeName).text === 'Function' &&
            isNativeGlobalSymbol(getSymbolAtLocation.call(checker, typeName), 'Function');
    };
    const isWriteReference = (node = {}) => {
        const mutation = census.ancestors(node).find((ancestor = {}) => [
            BinaryExpression,
            PrefixUnaryExpression,
            PostfixUnaryExpression,
            ForInStatement,
            ForOfStatement
        ].includes(getObject(ancestor).kind));
        const { kind = 0, left = {}, operand = {}, initializer = {}, operatorToken = {}, operator = -1 } = getObject(mutation);
        const { kind: operatorKind = -1 } = getObject(operatorToken);

        return kind === BinaryExpression && isWithin(node, left) &&
            operatorKind >= FirstAssignment && operatorKind <= LastAssignment ||
            [PrefixUnaryExpression, PostfixUnaryExpression].includes(kind) && operand === node &&
            [PlusPlusToken, MinusMinusToken].includes(operator) ||
            [ForInStatement, ForOfStatement].includes(kind) && isWithin(node, initializer);
    };
    const isArgumentsLength = (node = {}) => {
        const { expression = {}, name = {} } = getObject(node);
        const symbol = getObject(expression).kind === Identifier
            ? getSymbolAtLocation.call(checker, expression)
            : false;

        return getObject(node).kind === PropertyAccessExpression &&
            getObject(expression).text === 'arguments' && getObject(name).text === 'length' &&
            getObject(symbol).name === 'arguments' && !(getObject(symbol).declarations || []).length;
    };
    const getSourceBinding = (node = {}) => {
        const { kind = 0, name = {}, parent = {} } = getObject(node);

        if (kind === FunctionDeclaration && getObject(parent).kind === getObject(sourceFile).kind) {
            return getObject(name).kind === Identifier ? getObject(name).text || '' : '';
        }

        const { kind: parentKind = 0, name: binding = {}, initializer = {} } = getObject(parent);
        const { parent: declarationList = {} } = getObject(parent);
        const { parent: statement = {} } = getObject(declarationList);
        const { parent: statementParent = {} } = getObject(statement);

        return kind === FunctionExpression && parentKind === VariableDeclaration && initializer === node &&
            getObject(binding).kind === Identifier && getObject(statement).kind === VariableStatement &&
            statementParent === sourceFile ? getObject(binding).text || '' : '';
    };

    return new Map(census.select(...functionKinds).flatMap((node = {}) => {
        const { body = {}, parameters = [] } = getObject(node);
        const sourceName = getSourceBinding(node);
        const firstOptional = parameters.findIndex(({ questionToken = false } = {}) => Boolean(questionToken));
        const tail = firstOptional < 0 ? [] : parameters.slice(firstOptional);
        const syntacticCandidate = sourceName && getObject(body).kind === getSyntaxKinds(typescript).Block &&
            firstOptional > 0 && parameters.every(({ kind = 0, name = {}, initializer = false,
            dotDotDotToken = false } = {}) => kind === Parameter && getObject(name).kind === Identifier &&
                !initializer && !dotDotDotToken) &&
            tail.every(({ questionToken = false, type = {} } = {}) => Boolean(questionToken) &&
                getObject(type).kind === TypeReference && getObject(getObject(type).typeName).kind === Identifier &&
                getObject(getObject(type).typeName).text === 'Function');

        if (!syntacticCandidate) return [];

        const parameterFacts = tail.map((parameter = {}, restIndex) => {
            const { name = {} } = getObject(parameter);
            const symbol = getSymbolAtLocation.call(checker, name);
            const references = referencesOf(symbol).filter(identifier => identifier !== name && isWithin(identifier, body));
            const writes = references.filter(isWriteReference);

            return {
                name: getObject(name).text || '',
                sourceIndex: firstOptional + restIndex,
                restIndex,
                mutable: Boolean(writes.length),
                readRanges: references.filter(reference => !writes.includes(reference)).map(getConsumerContractKey),
                writeRanges: writes.map(getConsumerContractKey)
            };
        });
        const { statements = [] } = getObject(body);
        const directSwitches = statements.filter(({ kind = 0, expression = {} } = {}) => (
            kind === SwitchStatement && isArgumentsLength(expression)
        ));
        const parameterPositions = new Map(tail.map((parameter = {}, restIndex) => [
            getSymbolAtLocation.call(checker, getObject(parameter).name), firstOptional + restIndex
        ]).filter(([symbol = false] = []) => Boolean(symbol)));
        const protectedUse = (candidate = {}, count = 0, dispatch = false) => {
            const { kind = 0, caseBlock = {} } = getObject(candidate);

            if (!dispatch && directSwitches.includes(candidate)) {
                const { clauses = [] } = getObject(caseBlock);

                return clauses.every((clause = {}) => {
                    const { kind: clauseKind = 0, expression: label = {}, statements: clauseStatements = [] } = getObject(clause);
                    const arity = clauseKind === CaseClause && getObject(label).kind === NumericLiteral
                        ? Number(getObject(label).text) : 0;

                    return clauseStatements.every(statement => protectedUse(statement, arity, true));
                });
            }

            if (kind !== Identifier) return getChildren({ typescript, node: candidate })
                .every(child => protectedUse(child, count, dispatch));

            const symbol = getSymbolAtLocation.call(checker, candidate);

            if (parameterPositions.has(symbol)) return count > parameterPositions.get(symbol);

            return getChildren({ typescript, node: candidate })
                .every(child => protectedUse(child, count, dispatch));
        };
        const directiveCount = statements.findIndex(({ expression = {} } = {}) => getObject(expression).kind !== StringLiteral);
        const directives = statements.slice(0, directiveCount < 0 ? statements.length : directiveCount);
        const explicitStrict = directives.some(({ expression = {} } = {}) => getObject(expression).text === 'use strict');
        const directEval = census.select(CallExpression).some((call = {}) => {
            const { expression = {} } = getObject(call);

            return isWithin(call, body) && getObject(expression).kind === Identifier && getObject(expression).text === 'eval';
        });
        const completeParameters = tail.every((parameter = {}) => {
            const { name = {} } = getObject(parameter);
            const symbol = getSymbolAtLocation.call(checker, name);

            return symbol && referencesOf(symbol).includes(name) &&
                (getObject(symbol).declarations || []).length === 1 &&
                getObject(symbol).declarations[0] === parameter &&
                referencesOf(symbol).every(identifier => identifier === name || isWithin(identifier, body));
        });
        const uniqueParameters = new Set(parameters.map(parameter => getObject(getObject(parameter).name).text)).size === parameters.length;
        const sourceRange = getConsumerContractKey(node);

        return [[sourceRange, {
            sourceRange,
            functionKey: sourceRange,
            sourceName,
            sourceLength: parameters.length,
            firstOptional,
            parameters: parameterFacts,
            nativeCallableParameters: tail.every(hasNativeFunctionType),
            privateFunction: isPrivateBinding(node, sourceName),
            completeParameters: Boolean(completeParameters && uniqueParameters),
            strictParameterSemantics: Boolean(isExternalModule(sourceFile)) && !explicitStrict,
            directArgumentsDispatch: directSwitches.length === 1,
            dispatchRange: directSwitches.length === 1 ? getConsumerContractKey(directSwitches.at(0)) : '',
            protectedParameterUses: directSwitches.length === 1 && protectedUse(body),
            directEval,
            theorem: 'checker-backed-arity-signature',
            evidence: [
                'checker resolves optional callable formals before signature rewriting',
                'checker identity records every optional parameter write',
                'native arguments count owns omitted and explicitly supplied positions'
            ]
        }]];
    }));
};

// A declared overload can promise different result families by invocation
// arity. Record that source partition only when the checker and the explicit
// undefined selector agree; a generated return syntax cannot establish it.
const collectArityReturnContracts = ({ typescript = {}, sourceFile = {}, checker = {} } = {}) => {
    const { SyntaxKind: {
        FunctionDeclaration = -1, ArrowFunction = -1, FunctionExpression = -1,
        ReturnStatement = -1, IfStatement = -1, Block = -1,
        BinaryExpression = -1, ConditionalExpression = -1,
        Identifier = -1, EqualsEqualsEqualsToken = -1
    } = {}, TypeFlags: { Any = 0, Unknown = 0 } = {} } = typescript;
    const { getSymbolAtLocation = false, getTypeAtLocation = false } = getObject(checker);

    if (typeof getSymbolAtLocation !== 'function' || typeof getTypeAtLocation !== 'function') return new Map();

    const functionKinds = [ArrowFunction, FunctionExpression];
    const getReturns = (owner = {}) => {
        const found = [];
        const visit = (node = {}) => {
            const { kind = 0 } = getObject(node);

            if (node !== owner && functionKinds.includes(kind)) return;

            if (kind === ReturnStatement) {
                // eslint-disable-next-line resilient/prefer-safe-transformations -- Private return buffer preserves node identity and order outside nested callbacks.
                found.push(node);
            }

            typescript.forEachChild(node, visit);
        };

        visit(getObject(owner).body);

        return found;
    };
    const isUndefinedSelector = (test = {}, parameterName = '') => {
        const { kind = 0, left = {}, right = {}, operatorToken = {} } = getObject(test);
        const { kind: leftKind = 0, text: leftText = '' } = getObject(left);
        const { kind: rightKind = 0, text: rightText = '' } = getObject(right);

        return kind === BinaryExpression && getObject(operatorToken).kind === EqualsEqualsEqualsToken &&
            leftKind === Identifier && rightKind === Identifier &&
            ((leftText === parameterName && rightText === 'undefined') ||
                (rightText === parameterName && leftText === 'undefined'));
    };
    const isKnownFamily = (expression = {}, callable = false) => {
        const type = getTypeAtLocation(expression);
        const { flags = 0, getCallSignatures = false } = getObject(type);
        const hasCalls = typeof getCallSignatures === 'function' && !!type.getCallSignatures().length;

        return !(flags & (Any | Unknown)) && hasCalls === callable;
    };
    const { statements: sourceStatements = [] } = getObject(sourceFile);
    const entries = sourceStatements.flatMap((statement = {}) => {
        const { kind = 0, name = {}, body = {} } = getObject(statement);
        const { text: sourceName = '' } = getObject(name);

        if (kind !== FunctionDeclaration || !sourceName || getObject(body).kind !== Block) return [];

        const symbol = getSymbolAtLocation(name);
        const { declarations = [] } = getObject(symbol);
        const hasDeclaredOverload = declarations.some((declaration = {}) => {
            const { kind: declarationKind = 0, body: declarationBody = false } = getObject(declaration);

            return declarationKind === FunctionDeclaration && !declarationBody;
        });

        if (!hasDeclaredOverload) return [];

        const { statements = [] } = getObject(body);
        const [returnedSelector = {}] = statements.filter(({ kind: partKind = 0 } = {}) => partKind === ReturnStatement);
        const { expression: returnedExpression = {} } = getObject(returnedSelector);
        const selector = functionKinds.includes(getObject(returnedExpression).kind) ? returnedExpression : statement;
        const { parameters = [], body: selectorBody = {} } = getObject(selector);
        const [last = {}] = parameters.slice(-1);
        const { name: lastName = {}, questionToken = false } = getObject(last);
        const { kind: lastKind = 0, text: parameterName = '' } = getObject(lastName);
        const optionalType = lastKind === Identifier && questionToken ? getTypeAtLocation(lastName) : {};
        const { flags: optionalFlags = 0 } = getObject(optionalType);

        if (!parameterName || !questionToken || !optionalFlags || optionalFlags & (Any | Unknown) ||
            getObject(selectorBody).kind !== Block) return [];

        const selectorReturns = getReturns(selector);
        const [partialSelector = {}] = getObject(selectorBody).statements.filter((part = {}) => {
            const { kind: partKind = 0, expression: test = {}, thenStatement = {} } = getObject(part);
            const { statements: thenStatements = [] } = getObject(thenStatement);
            const partialReturn = getObject(thenStatement).kind === Block
                ? thenStatements.find(({ kind: returnKind = 0 } = {}) => returnKind === ReturnStatement)
                : thenStatement;
            const { expression: partialExpression = {} } = getObject(partialReturn);

            return partKind === IfStatement && isUndefinedSelector(test, parameterName) &&
                getObject(partialReturn).kind === ReturnStatement && isKnownFamily(partialExpression, true);
        });
        const [conditionalSelector = {}] = getObject(selectorBody).statements.filter((part = {}) => {
            const { kind: partKind = 0, expression: conditional = {} } = getObject(part);
            const { kind: conditionalKind = 0, condition = {}, consequent = {}, whenTrue = {},
                alternate = {}, whenFalse = {} } = getObject(conditional);
            const { test = condition } = getObject(conditional);
            const partial = getObject(whenTrue).kind ? whenTrue : consequent;
            const complete = getObject(whenFalse).kind ? whenFalse : alternate;

            return partKind === ReturnStatement && conditionalKind === ConditionalExpression &&
                isUndefinedSelector(test, parameterName) &&
                isKnownFamily(partial, true) && isKnownFamily(complete, false);
        });
        const valueReturns = selectorReturns.filter(({ expression = {} } = {}) => getObject(expression).kind &&
            isKnownFamily(expression, false));

        if ((!getObject(partialSelector).kind || !valueReturns.length) && !getObject(conditionalSelector).kind) return [];

        const key = getConsumerContractKey(statement);
        const { expression: conditional = {} } = getObject(conditionalSelector);
        const { condition = {}, test = condition } = getObject(conditional);
        const selectorTest = getObject(partialSelector).kind ? getObject(partialSelector).expression : test;
        const selectorTestRange = getConsumerContractKey(selectorTest);

        return [[key, {
            key,
            sourceRange: key,
            sourceName,
            selectorRange: getConsumerContractKey(selector),
            selectorTestRange,
            action: 'retain-arity-return-partition',
            evidence: [
                'checker overload declarations distinguish partial and complete invocation',
                'optional final argument has an explicit undefined selector',
                'partial return is callable and complete returns are known non-callable values'
            ]
        }]];
    });

    return new Map(entries);
};

// A mutator-shaped spelling is not proof of mutation. The checker resolves
// whether the called property is a module export or a typed callable field;
// standard prototype methods and unknown calls never enter this agreement.
const collectCallableProviderDispatchContracts = ({ typescript = {}, sourceFile = {}, checker = {},
    census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    if (!hasTypeChecker(checker)) return new Map();

    const { CallExpression = -1, PropertyAccessExpression = -1,
        NamespaceImport = -1, PropertySignature = -1 } = getSyntaxKinds(typescript);
    // Only the current callable-provider operation family is admitted.
    // Other mutator-shaped calls may already belong to collection agreements.
    const candidateNames = new Set(['add', 'reverse']);
    let entries = [];
    const visit = (node = {}) => {
        const { kind = 0, expression = {}, questionDotToken = false } = getObject(node);
        const { kind: expressionKind = 0, expression: receiver = {}, name = {} } = getObject(expression);
        const { text: member = '' } = getObject(name);

        if (kind === CallExpression && expressionKind === PropertyAccessExpression &&
            !questionDotToken && !getObject(expression).questionDotToken && candidateNames.has(member)) {
            const symbol = checker.getSymbolAtLocation(name);
            const receiverSymbol = checker.getSymbolAtLocation(receiver);
            const declarations = getObject(symbol).declarations || [];
            const receiverDeclarations = getObject(receiverSymbol).declarations || [];
            const declarationKinds = declarations.map(({ kind: declarationKind = 0 } = {}) => declarationKind);
            const namespaceExport = receiverDeclarations.some(({ kind: declarationKind = 0 } = {}) => (
                declarationKind === NamespaceImport
            ));
            const typedCallableField = declarationKinds.includes(PropertySignature);
            const callable = !!checker.getTypeAtLocation(expression).getCallSignatures().length;
            const callRange = getConsumerContractKey(node);

            const admitted = callRange && callable && (namespaceExport || typedCallableField);

            entries = admitted ? [...entries, [callRange, {
                action: 'retain-provider-dispatch',
                operationRole: 'provider-dispatch',
                sourceRange: callRange,
                receiverRange: getConsumerContractKey(receiver),
                memberRange: getConsumerContractKey(expression),
                receiverKind: namespaceExport ? 'module-namespace' : 'typed-callable-field',
                declarationKinds,
                member,
                evidence: [
                    'checker resolves the call to a module export or typed callable property',
                    'a mutator-shaped member name does not establish standard collection mutation'
                ]
            }]] : entries;
        }
    };

    census.select(CallExpression).forEach(visit);

    return new Map(entries);
};

// The queue is a live local state machine, not an array-to-array map. Keep
// its original method calls and only record arrays whose queue identity does
// not leave the owning function through a value use.
const collectLiveWorkQueueContracts = ({ typescript = {}, sourceFile = {}, checker = {},
    census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    if (!hasTypeChecker(checker)) return new Map();

    const { ArrowFunction = -1, FunctionDeclaration = -1, FunctionExpression = -1,
        Block = -1, VariableStatement = -1, Identifier = -1,
        ArrayLiteralExpression = -1, WhileStatement = -1,
        BinaryExpression = -1, GreaterThanToken = -1,
        PropertyAccessExpression = -1, CallExpression = -1,
        NumericLiteral = -1 } = getSyntaxKinds(typescript);
    const functionKinds = [ArrowFunction, FunctionDeclaration, FunctionExpression];
    const methods = new Set(['shift', 'unshift', 'push']);
    const sameSymbol = (node = {}, symbol = {}) => (
        getObject(node).kind === Identifier && checker.getSymbolAtLocation(node) === symbol
    );
    const isQueueProperty = (node = {}, symbol = {}, names = []) => {
        const { kind = 0, expression = {}, name = {} } = getObject(node);

        return kind === PropertyAccessExpression && sameSymbol(expression, symbol) &&
            names.includes(getObject(name).text);
    };
    const isQueueCall = (node = {}, symbol = {}, names = []) => {
        const { kind = 0, expression = {}, questionDotToken = false } = getObject(node);

        return kind === CallExpression && !questionDotToken &&
            isQueueProperty(expression, symbol, names);
    };
    const hasShift = (node = {}, symbol = {}) => {
        let found = isQueueCall(node, symbol, ['shift']);

        typescript.forEachChild(node, (child) => {
            if (!found) found = hasShift(child, symbol);
        });

        return found;
    };
    let entries = [];
    const inspectFunction = (functionNode = {}) => {
        const { body = {}, modifiers = [] } = getObject(functionNode);
        const { kind: bodyKind = 0, statements = [] } = getObject(body);
        const { AsyncKeyword = -1 } = getSyntaxKinds(typescript);

        if (bodyKind !== Block || modifiers.some(({ kind = 0 } = {}) => kind === AsyncKeyword)) return;

        statements.forEach((statement = {}) => {
            const { kind = 0, declarationList = {} } = getObject(statement);
            const { declarations = [] } = getObject(declarationList);

            if (kind !== VariableStatement || declarations.length !== 1) return;

            const [declaration = {}] = declarations;
            const { name = {}, initializer = {} } = getObject(declaration);
            const { kind: nameKind = 0 } = getObject(name);
            const type = checker.getTypeAtLocation(name);
            const { isArrayType = undefined } = checker;
            const standardArray = typeof isArrayType === 'function' && isArrayType.call(checker, type);

            if (nameKind !== Identifier || getObject(initializer).kind !== ArrayLiteralExpression ||
                !standardArray) return;

            const symbol = checker.getSymbolAtLocation(name);
            const queueLoops = statements.filter((candidate = {}) => {
                const { kind: loopKind = 0, expression = {}, statement: loopBody = {} } = getObject(candidate);
                const { kind: conditionKind = 0, left = {}, right = {}, operatorToken = {} } = getObject(expression);
                const directLength = isQueueProperty(expression, symbol, ['length']);
                const positiveLength = conditionKind === BinaryExpression &&
                    getObject(operatorToken).kind === GreaterThanToken &&
                    isQueueProperty(left, symbol, ['length']) &&
                    getObject(right).kind === NumericLiteral && getObject(right).text === '0';

                return loopKind === WhileStatement && (directLength || positiveLength) &&
                    hasShift(loopBody, symbol);
            });

            if (!queueLoops.length) return;

            let escaped = false;
            let updates = [];
            const inspectUse = (node = {}) => {
                const { parent = {} } = getObject(node);
                const allowedProperty = getObject(parent).kind === PropertyAccessExpression &&
                    getObject(parent).expression === node &&
                    ['length', ...methods].includes(getObject(getObject(parent).name).text);

                escaped = escaped || (sameSymbol(node, symbol) && node !== name && !allowedProperty);
                updates = isQueueCall(node, symbol, [...methods]) ? [...updates, node] : updates;

                typescript.forEachChild(node, inspectUse);
            };

            inspectUse(body);

            if (escaped || !updates.some(call => isQueueCall(call, symbol, ['shift']))) return;

            const directLocalCallsOnly = (nested = {}) => {
                const { name: nestedName = {} } = getObject(nested);
                const nestedSymbol = checker.getSymbolAtLocation(nestedName);

                if (!nestedSymbol) return false;

                let directOnly = true;
                const inspectReference = (candidate = {}) => {
                    const { parent = {} } = getObject(candidate);

                    if (candidate !== nestedName && sameSymbol(candidate, nestedSymbol)) {
                        const directCall = getObject(parent).kind === CallExpression &&
                            getObject(parent).expression === candidate;

                        directOnly = directOnly && directCall;
                    }

                    typescript.forEachChild(candidate, inspectReference);
                };

                inspectReference(body);

                return directOnly;
            };
            const nativeArrayCallback = (nested = {}) => {
                const { parent = {} } = getObject(nested);
                const { kind: parentKind = 0, expression: callee = {}, arguments: args = [] } = getObject(parent);
                const { kind: calleeKind = 0, expression: receiver = {}, name: member = {} } = getObject(callee);

                if (parentKind !== CallExpression || !args.includes(nested) ||
                    calleeKind !== PropertyAccessExpression || getObject(member).text !== 'forEach' ||
                    typeof isArrayType !== 'function') return false;

                return isArrayType.call(checker, checker.getTypeAtLocation(receiver));
            };
            const hasSafeOwner = (call = {}) => {
                const verify = (current = {}) => {
                    if (!current || current === functionNode) return true;

                    const { kind: currentKind = 0, modifiers: currentModifiers = [],
                        parent = false } = getObject(current);
                    const asyncNested = currentModifiers.some(({ kind = 0 } = {}) => kind === AsyncKeyword);
                    const supported = !functionKinds.includes(currentKind) ||
                        currentKind === FunctionDeclaration && directLocalCallsOnly(current) ||
                        currentKind === ArrowFunction && nativeArrayCallback(current);

                    return !asyncNested && supported && verify(parent);
                };
                const { parent = false } = getObject(call);

                return verify(parent);
            };

            if (!updates.every(hasSafeOwner)) return;

            const [loop = {}] = queueLoops;
            const loopRange = getConsumerContractKey(loop);
            const bindingRange = getConsumerContractKey(declaration);

            entries = [...entries, ...updates.map((call = {}) => {
                const sourceRange = getConsumerContractKey(call);
                const { expression: member = {} } = getObject(call);
                const { name: method = {} } = getObject(member);

                return [sourceRange, {
                    action: 'operational-work-queue',
                    operationRole: 'live-work-queue',
                    sourceRange,
                    loopRange,
                    bindingRange,
                    method: getObject(method).text || '',
                    evidence: [
                        'checker proves a fresh local standard array with a live length-and-shift loop',
                        'queue identity does not escape as a value; updates remain source-ordered'
                    ]
                }];
            })];
        });
    };
    const visit = (node = {}) => {
        if (functionKinds.includes(getObject(node).kind)) inspectFunction(node);
    };

    census.select(...functionKinds).forEach(visit);

    return new Map(entries);
};

const collectLiveSetVisitationContracts = ({ typescript = {}, sourceFile = {}, checker = {},
    census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    if (!hasTypeChecker(checker)) return new Map();

    const { ArrowFunction = -1, FunctionDeclaration = -1, FunctionExpression = -1,
        Block = -1, VariableStatement = -1, Identifier = -1,
        ArrayLiteralExpression = -1, ExpressionStatement = -1,
        PropertyAccessExpression = -1, CallExpression = -1,
        ReturnStatement = -1, AsyncKeyword = -1 } = getSyntaxKinds(typescript);
    const functionKinds = [ArrowFunction, FunctionDeclaration, FunctionExpression];
    let entries = [];
    const visit = (node = {}) => {
        const { kind = 0, body = {}, modifiers = [] } = getObject(node);
        const { kind: bodyKind = 0, statements = [] } = getObject(body);

        if (functionKinds.includes(kind) && bodyKind === Block &&
            !modifiers.some(({ kind: modifierKind = 0 } = {}) => modifierKind === AsyncKeyword)) {
            statements.forEach((statement = {}, index = -1) => {
                const { kind: statementKind = 0, declarationList = {} } = getObject(statement);
                const { declarations = [] } = getObject(declarationList);
                const [declaration = {}] = declarations;
                const { name = {}, initializer = {} } = getObject(declaration);
                const { elements = [] } = getObject(initializer);

                if (statementKind !== VariableStatement || declarations.length !== 1 ||
                    getObject(name).kind !== Identifier ||
                    getObject(initializer).kind !== ArrayLiteralExpression ||
                    elements.length) return;

                const { isArrayType = undefined } = checker;
                const arrayOutput = typeof isArrayType === 'function' &&
                    isArrayType.call(checker, checker.getTypeAtLocation(name));

                if (!arrayOutput) return;

                const outputSymbol = checker.getSymbolAtLocation(name);
                const [visitation = {}, returned = {}] = statements.slice(index + 1, index + 3);
                const { kind: visitKind = 0, expression: visitCall = {} } = getObject(visitation);
                const { kind: callKind = 0, expression: visitMember = {}, arguments: args = [] } = getObject(visitCall);
                const { kind: memberKind = 0, expression: set = {}, name: method = {} } = getObject(visitMember);
                const [callback = {}] = args;
                const { kind: callbackKind = 0 } = getObject(callback);
                const { kind: returnKind = 0, expression: returnCall = {} } = getObject(returned);
                const { kind: returnCallKind = 0, expression: returnMember = {} } = getObject(returnCall);
                const { kind: returnMemberKind = 0, expression: sortReceiver = {},
                    name: sortMethod = {} } = getObject(returnMember);
                const standardSet = memberKind === PropertyAccessExpression &&
                    getStandardCollectionFamily({ typescript, checker, candidate: set }) === 'Set';
                const sortedDirectReturn = returnKind === ReturnStatement &&
                    returnCallKind === CallExpression && returnMemberKind === PropertyAccessExpression &&
                    getObject(sortMethod).text === 'sort' &&
                    checker.getSymbolAtLocation(sortReceiver) === outputSymbol;

                if (visitKind !== ExpressionStatement || callKind !== CallExpression ||
                    !standardSet || getObject(method).text !== 'forEach' || args.length !== 1 ||
                    ![ArrowFunction, FunctionExpression].includes(callbackKind) || !sortedDirectReturn) return;

                let pushes = [];
                let escaped = false;
                const visitOutputUse = (child = {}) => {
                    const { kind: childKind = 0, expression = {}, parent = {} } = getObject(child);
                    const { kind: expressionKind = 0, expression: receiver = {},
                        name: childMethod = {} } = getObject(expression);
                    const isOutput = childKind === Identifier &&
                        checker.getSymbolAtLocation(child) === outputSymbol;
                    const allowed = getObject(parent).kind === PropertyAccessExpression &&
                        getObject(parent).expression === child &&
                        ['push', 'sort'].includes(getObject(getObject(parent).name).text);
                    const push = childKind === CallExpression &&
                        expressionKind === PropertyAccessExpression &&
                        getObject(childMethod).text === 'push' &&
                        checker.getSymbolAtLocation(receiver) === outputSymbol;

                    escaped = escaped || (isOutput && child !== name && !allowed);
                    pushes = push ? [...pushes, child] : pushes;
                    typescript.forEachChild(child, visitOutputUse);
                };

                visitOutputUse(body);

                if (escaped || pushes.length !== 1 || !getObject(callback).body) return;

                const [push = {}] = pushes;
                const sourceRange = getConsumerContractKey(push);

                entries = [...entries, [sourceRange, {
                    action: 'operational-collection-builder',
                    operationRole: 'set-visitation',
                    sourceRange,
                    visitRange: getConsumerContractKey(visitation),
                    returnRange: getConsumerContractKey(returned),
                    outputRange: getConsumerContractKey(declaration),
                    evidence: [
                        'checker proves direct standard Set or ReadonlySet forEach visitation',
                        'fresh array is updated in the callback and returned through native sort'
                    ]
                }], [getConsumerContractKey(returnCall), {
                    action: 'operational-collection-builder',
                    operationRole: 'set-visitation-sort',
                    sourceRange: getConsumerContractKey(returnCall),
                    visitRange: getConsumerContractKey(visitation),
                    returnRange: getConsumerContractKey(returned),
                    outputRange: getConsumerContractKey(declaration),
                    evidence: [
                        'native sort returns the same array populated during live Set forEach visitation'
                    ]
                }]];
            });
        }
    };

    census.select(...functionKinds).forEach(visit);

    return new Map(entries);
};

const collectObservableSetUnionContracts = ({ typescript = {}, sourceFile = {}, checker = {},
    census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    if (!hasTypeChecker(checker)) return new Map();

    const { ArrowFunction = -1, FunctionDeclaration = -1, FunctionExpression = -1,
        Block = -1, VariableStatement = -1, Identifier = -1,
        NewExpression = -1, ExpressionStatement = -1,
        PropertyAccessExpression = -1, CallExpression = -1,
        ReturnStatement = -1, IfStatement = -1,
        PrefixUnaryExpression = -1, ExclamationToken = -1,
        AsyncKeyword = -1 } = getSyntaxKinds(typescript);
    const functionKinds = [ArrowFunction, FunctionDeclaration, FunctionExpression];
    let entries = [];
    const visit = (node = {}) => {
        const { kind = 0, body = {}, modifiers = [] } = getObject(node);
        const { kind: bodyKind = 0, statements = [] } = getObject(body);

        if (functionKinds.includes(kind) && bodyKind === Block &&
            !modifiers.some(({ kind: modifierKind = 0 } = {}) => modifierKind === AsyncKeyword)) {
            statements.forEach((statement = {}, index = -1) => {
                const { kind: statementKind = 0, declarationList = {} } = getObject(statement);
                const { declarations = [] } = getObject(declarationList);
                const [declaration = {}] = declarations;
                const { name = {}, initializer = {} } = getObject(declaration);
                const { kind: initKind = 0, expression: constructor = {},
                    arguments: copyArguments = [] } = getObject(initializer);

                if (statementKind !== VariableStatement || declarations.length !== 1 ||
                    getObject(name).kind !== Identifier || initKind !== NewExpression ||
                    getObject(constructor).text !== 'Set' || copyArguments.length !== 1 ||
                    getStandardCollectionFamily({ typescript, checker, candidate: name }) !== 'Set' ||
                    !isStandardLibrarySymbol(checker.getSymbolAtLocation(constructor))) return;

                const resultSymbol = checker.getSymbolAtLocation(name);
                const [visitation = {}, returned = {}] = statements.slice(index + 1, index + 3);
                const { kind: visitKind = 0, expression: visitCall = {} } = getObject(visitation);
                const { kind: visitCallKind = 0, expression: visitMember = {},
                    arguments: visitArguments = [] } = getObject(visitCall);
                const { kind: memberKind = 0, expression: right = {},
                    name: visitMethod = {} } = getObject(visitMember);
                const [callback = {}] = visitArguments;
                const { kind: callbackKind = 0, body: callbackBody = {},
                    modifiers: callbackModifiers = [] } = getObject(callback);
                const { kind: callbackBodyKind = 0, statements: callbackStatements = [] } = getObject(callbackBody);
                const [guard = {}] = callbackStatements;
                const { kind: guardKind = 0, expression: condition = {},
                    thenStatement = {}, elseStatement = false } = getObject(guard);
                const { kind: conditionKind = 0, operator = 0,
                    operand: membershipCall = {} } = getObject(condition);
                const { kind: membershipKind = 0, arguments: membershipArguments = [] } = getObject(membershipCall);
                const [, membershipResult = {}] = membershipArguments;
                const { kind: thenKind = 0, statements: thenStatements = [] } = getObject(thenStatement);
                const [update = thenStatement] = thenStatements;
                const { kind: updateKind = 0, expression: addCall = {} } = getObject(update);
                const { kind: addKind = 0, expression: addMember = {} } = getObject(addCall);
                const { kind: addMemberKind = 0, expression: addReceiver = {},
                    name: addMethod = {} } = getObject(addMember);
                const { kind: returnKind = 0, expression: returnValue = {} } = getObject(returned);
                const standardRight = getStandardCollectionFamily({
                    typescript, checker, candidate: right
                }) === 'Set';
                const sameResult = (candidate = {}) => checker.getSymbolAtLocation(candidate) === resultSymbol;

                if (visitKind !== ExpressionStatement || visitCallKind !== CallExpression ||
                    memberKind !== PropertyAccessExpression || getObject(visitMethod).text !== 'forEach' ||
                    !standardRight || visitArguments.length !== 1 ||
                    ![ArrowFunction, FunctionExpression].includes(callbackKind) ||
                    callbackModifiers.some(({ kind: modifierKind = 0 } = {}) => modifierKind === AsyncKeyword) ||
                    callbackBodyKind !== Block || callbackStatements.length !== 1 ||
                    guardKind !== IfStatement || elseStatement || conditionKind !== PrefixUnaryExpression ||
                    operator !== ExclamationToken || membershipKind !== CallExpression ||
                    membershipArguments.length !== 2 || !sameResult(membershipResult) ||
                    (thenKind === Block && thenStatements.length !== 1) ||
                    updateKind !== ExpressionStatement || addKind !== CallExpression ||
                    addMemberKind !== PropertyAccessExpression || !sameResult(addReceiver) ||
                    getObject(addMethod).text !== 'add' ||
                    returnKind !== ReturnStatement || !sameResult(returnValue)) return;

                let escaped = false;
                const inspectResultUse = (child = {}) => {
                    const { kind: childKind = 0 } = getObject(child);
                    const resultUse = childKind === Identifier && sameResult(child) && child !== name;
                    const allowed = child === membershipResult || child === addReceiver || child === returnValue;

                    escaped = escaped || (resultUse && !allowed);
                    typescript.forEachChild(child, inspectResultUse);
                };

                inspectResultUse(body);

                if (escaped) return;

                const sourceRange = getConsumerContractKey(addCall);

                entries = [...entries, [sourceRange, {
                    action: 'operational-collection-builder',
                    operationRole: 'observable-set-union',
                    sourceRange,
                    copyRange: getConsumerContractKey(declaration),
                    visitRange: getConsumerContractKey(visitation),
                    membershipRange: getConsumerContractKey(membershipCall),
                    returnRange: getConsumerContractKey(returned),
                    evidence: [
                        'checker proves standard copied Set and live Set forEach visitation',
                        'membership call observes the same Set before its static add update'
                    ]
                }]];
            });
        }
    };

    census.select(...functionKinds).forEach(visit);

    return new Map(entries);
};

const collectSamePhaseSelectedBindingContracts = ({ typescript = {}, sourceFile = {}, checker = {},
    census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    if (!hasTypeChecker(checker)) return new Map();

    const { VariableStatement = -1, Identifier = -1, Parameter = -1,
        PropertyAccessExpression = -1 } = getSyntaxKinds(typescript);
    const { TypeFlags: { Any = 0, Unknown = 0 } = {} } = typescript;
    let entries = [];
    const visit = (node = {}) => {
        const { kind = 0, declarationList = {} } = getObject(node);
        const { declarations = [], flags = 0 } = getObject(declarationList);
        const [declaration = {}] = declarations;
        const { name = {}, initializer = {} } = getObject(declaration);
        const { kind: initKind = 0,
            name: property = {}, questionDotToken = false } = getObject(initializer);

        if (kind !== VariableStatement || declarations.length !== 1 ||
            getObject(name).kind !== Identifier || initKind !== PropertyAccessExpression ||
            questionDotToken) {
            return;
        }

        let root = initializer;
        let path = [];

        // eslint-disable-next-line resilient/prefer-prototype-methods -- Static member-path discovery queries leaf to root; unknown declarations clear the path and stop.
        while (getObject(root).kind === PropertyAccessExpression &&
            !getObject(root).questionDotToken) {
            const { name: step = {}, expression: parent = {} } = getObject(root);
            const symbol = checker.getSymbolAtLocation(step);
            const { declarations: symbolDeclarations = [] } = getObject(symbol);

            if (!symbolDeclarations.length) {
                path = [];
                break;
            }

            path = [getObject(step).text || '', ...path];
            root = parent;
        }

        if (getObject(root).kind !== Identifier || !path.length) {
            return;
        }

        const memberSymbol = checker.getSymbolAtLocation(property);
        const { declarations: memberDeclarations = [] } = getObject(memberSymbol);
        const receiverType = checker.getTypeAtLocation(root);
        const { flags: typeFlags = 0 } = getObject(receiverType);
        const rootSymbol = checker.getSymbolAtLocation(root);
        const { declarations: rootDeclarations = [] } = getObject(rootSymbol);
        const signatureOwnedRoot = path.length > 1 &&
            rootDeclarations.some(({ kind: declarationKind = 0 } = {}) => declarationKind === Parameter);
        const sourceRange = getConsumerContractKey(declaration);
        const { isArrayType = undefined, isTupleType = undefined } = checker;
        const arrayCardinality = getObject(property).text === 'length' &&
            (typeof isArrayType === 'function' && isArrayType.call(checker, receiverType) ||
                typeof isTupleType === 'function' && isTupleType.call(checker, receiverType));
        const aliasesSelection = getObject(name).text !== getObject(property).text;

        if (sourceRange && memberDeclarations.length && !(typeFlags & (Any | Unknown)) &&
            aliasesSelection && !arrayCardinality && !signatureOwnedRoot && path.length &&
            path.at(-1) === getObject(property).text) {
            entries = [...entries, [sourceRange, {
                action: 'bind-at-source-phase',
                operationRole: 'same-phase-selected-binding',
                sourceRange,
                statementRange: getConsumerContractKey(node),
                receiverRange: getConsumerContractKey(root),
                propertyPath: path,
                property: getObject(property).text || '',
                binding: getObject(name).text || '',
                declarationFlags: flags,
                memberDeclarationKinds: memberDeclarations.map(({ kind: memberKind = 0 } = {}) => memberKind),
                evidence: [
                    'checker resolves one static property at a direct declaration initializer',
                    'binding is placed at that same Get phase and retains undefined on absence'
                ]
            }]];
        }
    };

    census.select(VariableStatement).forEach(visit);

    return new Map(entries);
};

const collectDeferredSignatureSelectionContracts = ({ typescript = {}, sourceFile = {}, checker = {},
    census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    if (!hasTypeChecker(checker)) return new Map();

    const { ArrowFunction = -1, Identifier = -1, ConditionalExpression = -1,
        ParenthesizedExpression = -1,
        CallExpression = -1, BinaryExpression = -1, EqualsEqualsEqualsToken = -1 } = getSyntaxKinds(typescript);
    let entries = [];
    const unwrap = (candidate = {}) => {
        const { kind = 0, expression = {} } = getObject(candidate);

        return kind === ParenthesizedExpression ? unwrap(expression) : candidate;
    };
    const predicateArgument = (candidate = {}, expected = {}) => {
        const { kind = 0, arguments: args = [] } = getObject(candidate);
        const [argument = {}] = args;
        const signature = kind === CallExpression ? checker.getResolvedSignature(candidate) : {};
        const predicate = signature && checker.getTypePredicateOfSignature(signature);

        return kind === CallExpression && args.length === 1 &&
            checker.getSymbolAtLocation(argument) === checker.getSymbolAtLocation(expected) &&
            Boolean(predicate) ? candidate : {};
    };
    const visit = (node = {}) => {
        const { kind = 0, parameters = [], body = {} } = getObject(node);
        const [first = {}, second = {}] = parameters;
        const { name: firstName = {} } = getObject(first);
        const { name: secondName = {} } = getObject(second);
        const { kind: bodyKind = 0, condition: identity = {}, whenFalse: afterIdentity = {} } = getObject(unwrap(body));
        const { kind: identityKind = 0, left = {}, right = {}, operatorToken = {} } = getObject(identity);
        const { kind: afterKind = 0, condition: firstProbe = {},
            whenTrue = {}, whenFalse = {} } = getObject(unwrap(afterIdentity));
        const { kind: trueKind = 0, condition: trueProbe = {} } = getObject(unwrap(whenTrue));
        const { kind: falseKind = 0, condition: falseProbe = {} } = getObject(unwrap(whenFalse));
        const firstSymbol = getObject(firstName).kind === Identifier
            ? checker.getSymbolAtLocation(firstName) : {};
        const secondSymbol = getObject(secondName).kind === Identifier
            ? checker.getSymbolAtLocation(secondName) : {};
        const identityUsesBoth = identityKind === BinaryExpression &&
            getObject(operatorToken).kind === EqualsEqualsEqualsToken &&
            checker.getSymbolAtLocation(left) === firstSymbol &&
            checker.getSymbolAtLocation(right) === secondSymbol;
        const prior = predicateArgument(firstProbe, firstName);
        const deferredTrue = predicateArgument(trueProbe, secondName);
        const deferredFalse = predicateArgument(falseProbe, secondName);
        const sourceRange = getConsumerContractKey(node);

        if (kind === ArrowFunction && parameters.length === 2 && firstSymbol && secondSymbol &&
            bodyKind === ConditionalExpression && identityUsesBoth && afterKind === ConditionalExpression &&
            trueKind === ConditionalExpression && falseKind === ConditionalExpression &&
            getObject(prior).kind === CallExpression &&
            getObject(deferredTrue).kind === CallExpression &&
            getObject(deferredFalse).kind === CallExpression && sourceRange) {
            entries = [...entries, [sourceRange, {
                action: 'retain-deferred-signature-selection',
                operationRole: 'deferred-signature-selection',
                sourceRange,
                parameter: getObject(secondName).text || '',
                priorRanges: [getConsumerContractKey(identity), getConsumerContractKey(prior)],
                readRanges: [getConsumerContractKey(deferredTrue), getConsumerContractKey(deferredFalse)],
                evidence: ['checker-resolved predicates read the second parameter only after identity and first-parameter probes']
            }]];
        }
    };

    census.select(ArrowFunction).forEach(visit);

    return new Map(entries);
};

const collectNativeClassBoundaryContracts = ({ typescript = {}, sourceFile = {}, checker = {},
    census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    if (!hasTypeChecker(checker)) return new Map();

    const { ClassDeclaration = -1, Constructor = -1, MethodDeclaration = -1,
        NewExpression = -1, CallExpression = -1, PropertyAccessExpression = -1,
        ThisKeyword = -1, Identifier = -1 } = getSyntaxKinds(typescript);
    let entries = [];
    const findConstruction = (symbol = {}) => {
        const { range = '' } = census.select(NewExpression).reduce(({
            range = '', reachable = new Set()
        } = {}, node = {}) => {
            const { parent = {}, expression = {} } = getObject(node);

            if (range && !reachable.has(parent)) return { range, reachable };

            if (checker.getSymbolAtLocation(expression) !== symbol) return { range, reachable };

            return {
                range: getConsumerContractKey(node),
                reachable: range ? reachable : new Set(census.ancestors(node))
            };
        }, {});

        return range;
    };
    const getBoundMethods = (constructorNode = {}, methods = new Set()) => {
        let bindings = [];
        const visit = (node = {}) => {
            const { kind = 0, expression: callTarget = {}, arguments: args = [] } = getObject(node);
            const [receiver = {}] = args;
            const { kind: callKind = 0, expression: methodRead = {}, name: callName = {} } = getObject(callTarget);
            const { kind: readKind = 0, expression: owner = {}, name: methodName = {} } = getObject(methodRead);

            if (kind === CallExpression && callKind === PropertyAccessExpression &&
                getObject(callName).text === 'bind' && readKind === PropertyAccessExpression &&
                getObject(owner).kind === ThisKeyword && getObject(receiver).kind === ThisKeyword &&
                methods.has(getObject(methodName).text)) {
                bindings = [...bindings, {
                    method: getObject(methodName).text,
                    range: getConsumerContractKey(node)
                }];
            }

            typescript.forEachChild(node, visit);
        };

        visit(constructorNode);

        return bindings;
    };
    const visit = (node = {}) => {
        const { kind = 0, name = {}, members = [], heritageClauses = [] } = getObject(node);

        if (kind !== ClassDeclaration || getObject(name).kind !== Identifier || heritageClauses.length) {
            return;
        }

        const symbol = checker.getSymbolAtLocation(name);
        const [constructorNode = {}] = members.filter(({ kind: memberKind = 0 } = {}) => memberKind === Constructor);
        const methods = members.filter(({ kind: memberKind = 0 } = {}) => memberKind === MethodDeclaration);
        const methodNames = new Set(methods.map(({ name: methodName = {} } = {}) => getObject(methodName).text).filter(Boolean));
        const boundMethods = getBoundMethods(constructorNode, methodNames);
        const constructionRange = symbol ? findConstruction(symbol) : '';
        const sourceRange = getConsumerContractKey(node);

        if (sourceRange && getObject(constructorNode).kind === Constructor &&
            methodNames.size && boundMethods.length && constructionRange) {
            entries = [...entries, [sourceRange, {
                action: 'retain-native-class-boundary',
                operationRole: 'class-protocol',
                sourceRange,
                constructorRange: getConsumerContractKey(constructorNode),
                constructionRange,
                methodNames: [...methodNames],
                boundMethods,
                evidence: [
                    'checker resolves construction of this class',
                    'constructor binds prototype methods to each instance; replacing the class changes new and prototype identity'
                ]
            }]];
        }
    };

    census.select(ClassDeclaration).forEach(visit);

    return new Map(entries);
};

const collectOrderedDecisionContracts = ({ typescript = {}, sourceFile = {}, checker = {},
    census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    if (!hasTypeChecker(checker)) return new Map();

    const { IfStatement = -1, Block = -1, ReturnStatement = -1,
        ThrowStatement = -1, ConditionalExpression = -1,
        CallExpression = -1, Identifier = -1 } = getSyntaxKinds(typescript);
    const { TypeFlags: { Any = 0, Unknown = 0 } = {} } = typescript;
    let entries = [];
    const terminates = (statement = {}) => {
        const { kind = 0, statements = [] } = getObject(statement);
        const terminal = kind === Block ? statements.at(-1) || {} : statement;

        return [ReturnStatement, ThrowStatement].includes(getObject(terminal).kind);
    };
    const visit = (node = {}) => {
        const { kind = 0, expression = {}, condition = {}, thenStatement = {},
            elseStatement = {}, parent = {} } = getObject(node);
        const sourceRange = getConsumerContractKey(node);
        const conditionType = [IfStatement, ConditionalExpression].includes(kind)
            ? checker.getTypeAtLocation(kind === IfStatement ? expression : condition) : {};
        const { flags = 0 } = getObject(conditionType);
        const hasKnownCondition = !(flags & (Any | Unknown));

        if (kind === IfStatement && getObject(elseStatement).kind === IfStatement &&
            terminates(thenStatement) && hasKnownCondition && sourceRange) {
            entries = [...entries, [sourceRange, {
                action: 'flatten-terminal-guards',
                operationRole: 'ordered-decision',
                sourceRange,
                guardRange: getConsumerContractKey(expression),
                terminalRange: getConsumerContractKey(thenStatement),
                continuationRange: getConsumerContractKey(elseStatement),
                evidence: ['checker resolves the first condition; its arm terminates before the alternate guard']
            }]];
        }

        const { kind: parentKind = 0, statements: parentStatements = [],
            whenTrue: parentTrue = {}, whenFalse: parentFalse = {} } = getObject(parent);
        const siblingIndex = parentKind === Block ? parentStatements.indexOf(node) : -1;
        const suffix = siblingIndex >= 0 ? parentStatements.slice(siblingIndex + 1) : [];
        let nestedConditional = false;
        const findConditional = (child = {}) => {
            if (nestedConditional) return;

            if (child !== thenStatement && getObject(child).kind === ConditionalExpression) {
                nestedConditional = true;

                return;
            }

            typescript.forEachChild(child, findConditional);
        };

        if (kind === IfStatement) findConditional(thenStatement);

        const { kind: guardKind = 0, arguments: guardArguments = [] } = getObject(expression);
        const [guardedArgument = {}] = guardArguments;
        const guardedSource = guardKind === CallExpression && guardArguments.length === 1 &&
            getObject(guardedArgument).kind === Identifier &&
            checker.getSymbolAtLocation(guardedArgument)
            ? getObject(guardedArgument).text || '' : '';

        if (kind === IfStatement && !getObject(elseStatement).kind && nestedConditional &&
            terminates(thenStatement) && suffix.length && terminates(suffix.at(-1)) &&
            !suffix.some(({ kind: siblingKind = 0 } = {}) => siblingKind === IfStatement) &&
            guardedSource && hasKnownCondition && sourceRange) {
            entries = [...entries, [sourceRange, {
                action: 'flatten-terminated-nested-decision',
                operationRole: 'ordered-decision',
                sourceRange,
                guardRange: getConsumerContractKey(expression),
                terminalRange: getConsumerContractKey(thenStatement),
                continuationRange: getConsumerContractKey(suffix.at(-1)),
                guardedSource,
                evidence: ['checker resolves the guarded source; both paths terminate and the alternate suffix has no nested decision']
            }]];
        }

        if (kind === ConditionalExpression && parentKind === ConditionalExpression &&
            parentTrue === node && getObject(parentFalse).kind === ConditionalExpression &&
            hasKnownCondition && sourceRange) {
            entries = [...entries, [sourceRange, {
                action: 'retain-ordered-decision',
                operationRole: 'ordered-decision',
                sourceRange,
                guardRange: getConsumerContractKey(condition),
                evidence: ['both alternate variant paths remain nested and read payloads only after their own guards']
            }]];
        }
    };

    census.select(IfStatement, ConditionalExpression).forEach(visit);

    return new Map(entries);
};

const collectRepeatedParameterReadContracts = ({ typescript = {}, sourceFile = {}, checker = {},
    census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    if (!hasTypeChecker(checker)) return new Map();

    const {
        ArrowFunction = -1, FunctionDeclaration = -1, FunctionExpression = -1,
        Identifier = -1, PropertyAccessExpression = -1
    } = getSyntaxKinds(typescript);
    const { TypeFlags: {
        StringLike = 0, NumberLike = 0, BooleanLike = 0, BigIntLike = 0
    } = {} } = typescript;
    const scalarFlags = StringLike | NumberLike | BooleanLike | BigIntLike;
    const isScalarType = (type = {}) => {
        const { flags = 0, types = [] } = getObject(type);

        return Boolean(flags & scalarFlags) || Array.isArray(types) && Boolean(types.length) &&
            types.every(part => Boolean(getObject(part).flags & scalarFlags));
    };
    const functionKinds = [ArrowFunction, FunctionDeclaration, FunctionExpression];
    let entries = [];
    const visit = (node = {}) => {
        const { kind = 0, parameters = [], body = {} } = getObject(node);

        if (functionKinds.includes(kind)) {
            const parameterSymbols = new Set(parameters
                .filter(({ name = {} } = {}) => getObject(name).kind === Identifier)
                .map(({ name = {} } = {}) => checker.getSymbolAtLocation(name))
                .filter(Boolean));
            let groups = new Map();
            const collect = (child = {}) => {
                const { kind: childKind = 0, expression = {}, name = {}, questionDotToken = false } = getObject(child);

                if (functionKinds.includes(childKind)) return;

                const directRead = childKind === PropertyAccessExpression && !questionDotToken &&
                    getObject(expression).kind === Identifier;
                const parameterSymbol = directRead ? checker.getSymbolAtLocation(expression) : false;
                const propertySymbol = directRead ? checker.getSymbolAtLocation(name) : false;
                const valueType = directRead ? checker.getTypeAtLocation(child) : {};

                if (parameterSymbol && propertySymbol && parameterSymbols.has(parameterSymbol) &&
                    isScalarType(valueType)) {
                    const current = groups.get(parameterSymbol) || new Map();

                    groups = new Map([...groups, [parameterSymbol, new Map([
                        ...current, [propertySymbol, [...(current.get(propertySymbol) || []), child]]
                    ])]]);
                }

                typescript.forEachChild(child, collect);
            };

            collect(body);
            groups.forEach(properties => properties.forEach((reads) => {
                if (reads.length < 2) return;

                const readRanges = reads.map(getConsumerContractKey);

                reads.forEach((read) => {
                    const sourceRange = getConsumerContractKey(read);

                    entries = [...entries, [sourceRange, {
                        action: 'retain-source-phase-read',
                        operationRole: 'repeated-parameter-read',
                        sourceRange,
                        functionRange: getConsumerContractKey(node),
                        receiverName: getObject(getObject(read).expression).text || '',
                        propertyName: getObject(getObject(read).name).text || '',
                        valueFamily: 'checker-proven-scalar',
                        readRanges,
                        evidence: [
                            'checker resolves repeated Gets of the same parameter property',
                            'a shared binding would merge observable getter calls'
                        ]
                    }]];
                });
            }));
        }
    };

    census.select(...functionKinds).forEach(visit);

    return new Map(entries);
};

const getDeclarationReferenceFacts = ({ typescript = {}, sourceFile = {}, checker = {}, census = {},
    bindingReferences = new Map() } = {}) => {
    const {
        BinaryExpression = -1, PrefixUnaryExpression = -1, PostfixUnaryExpression = -1,
        FirstAssignment = -1, LastAssignment = -1, PlusPlusToken = -1, MinusMinusToken = -1,
        ForInStatement = -1, ForOfStatement = -1, PropertyAccessExpression = -1,
        ElementAccessExpression = -1, ComputedPropertyName = -1, SourceFile = -1,
        CallExpression = -1, Identifier = -1, ParenthesizedExpression = -1,
        AsExpression = -1, TypeAssertionExpression = -1, NonNullExpression = -1,
        SatisfiesExpression = -1
    } = getSyntaxKinds(typescript);
    const transparent = new Set([ParenthesizedExpression, AsExpression, TypeAssertionExpression,
        NonNullExpression, SatisfiesExpression]);
    const ownerOf = node => census.ancestors(node).find(ancestor => getObject(ancestor).kind === SourceFile || typescript.isFunctionLike(ancestor)) || sourceFile;
    const isWithin = (node, ancestor) => node === ancestor || Boolean(
        node && ancestor && isWithin(getObject(node).parent, ancestor)
    );
    const isWrite = (identifier) => {
        let child = identifier;

        // eslint-disable-next-line resilient/prefer-prototype-methods -- The first enclosing assignment/target decides the reference role; later ancestors must not override it.
        for (const parent of census.ancestors(identifier)) {
            const { kind = 0, left = {}, operand = {}, initializer = {},
                operatorToken = {}, operator = -1, expression = {}, argumentExpression = {} } = getObject(parent);

            if (kind === PropertyAccessExpression && expression === child ||
                kind === ElementAccessExpression && (expression === child || argumentExpression === child) ||
                kind === ComputedPropertyName) return false;

            if (kind === BinaryExpression && left !== child) return false;

            const { kind: operatorKind = -1 } = getObject(operatorToken);

            if (kind === BinaryExpression && left === child &&
                operatorKind >= FirstAssignment && operatorKind <= LastAssignment) return true;

            if ([PrefixUnaryExpression, PostfixUnaryExpression].includes(kind) && operand === child &&
                [PlusPlusToken, MinusMinusToken].includes(operator)) return true;

            if ([ForInStatement, ForOfStatement].includes(kind) && initializer === child) return true;

            child = parent;
        }

        return false;
    };
    const hasEval = owner => census.select(CallExpression).some((call) => {
        if (!isWithin(call, owner)) return false;

        const { expression: sourceCallee = {} } = getObject(call);
        let callee = sourceCallee;

        // eslint-disable-next-line resilient/prefer-prototype-methods, prefer-destructuring -- Transparent wrappers must be unwrapped in order before testing direct eval identity.
        while (transparent.has(getObject(callee).kind)) callee = getObject(callee).expression;

        const { kind: calleeKind = 0, text: calleeText = '' } = getObject(callee);

        return calleeKind === Identifier && calleeText === 'eval';
    });
    const referencesOf = symbol => bindingReferences.get(symbol) || [];
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    const { getExportsOfModule = false, getAliasedSymbol = false } = getObject(checker);
    const { SymbolFlags: { Alias = 0 } = {} } = typescript;
    const exportedSymbols = new Set(moduleSymbol && typeof getExportsOfModule === 'function'
        ? getExportsOfModule.call(checker, moduleSymbol).map((symbol) => {
            const { flags: symbolFlags = 0 } = getObject(symbol);

            return symbolFlags & Alias && typeof getAliasedSymbol === 'function'
                ? getAliasedSymbol.call(checker, symbol) : symbol;
        }) : []);

    return { ownerOf, isWithin, isWrite, hasEval, referencesOf, exportedSymbols };
};

const collectDeclarationLifetimeContracts = ({ typescript = {}, sourceFile = {}, checker = {},
    census = createSourceCensus({ typescript, sourceFile }),
    bindingReferences = collectBindingReferences({ typescript, sourceFile, checker, census }) } = {}) => {
    if (!hasTypeChecker(checker)) return new Map();

    const {
        Block = -1,
        ExportKeyword = -1,
        DefaultKeyword = -1,
        ExportSpecifier = -1,
        Identifier = -1,
        Parameter = -1,
        SourceFile = -1,
        VariableDeclaration = -1,
        VariableDeclarationList = -1,
        VariableStatement = -1
    } = getSyntaxKinds(typescript);
    const { NodeFlags: { Const = 0, Let = 0 } = {}, isExternalModule: getIsExternalModule = false } = typescript;
    const { getSymbolAtLocation = false } = getObject(checker);

    if (typeof getSymbolAtLocation !== 'function') return new Map();

    const { ownerOf = () => sourceFile, isWrite = () => false, hasEval = () => false,
        referencesOf = () => [], exportedSymbols = new Set() } = getDeclarationReferenceFacts({
        typescript, sourceFile, checker, census, bindingReferences
    });
    const isExternalModule = typeof getIsExternalModule === 'function' &&
        getIsExternalModule.call(typescript, sourceFile);

    return new Map(census.select(VariableDeclarationList).flatMap((node = {}) => {
        const { declarations = [], flags = 0 } = getObject(node);

        if (flags & (Let | Const)) return [];

        const names = declarations.map(declaration => getObject(declaration).name);
        const simple = names.every(name => getObject(name).kind === Identifier);
        const symbols = names.map(name => simple ? getSymbolAtLocation.call(checker, name) : false);
        const complete = simple && symbols.every(Boolean);
        const owner = ownerOf(node);
        const { parent = {} } = getObject(node);
        const { parent: statementParent = {} } = getObject(parent);
        const ownerBody = getObject(owner).kind === SourceFile ? owner : getObject(owner).body;
        const directOwnerStatement = getObject(parent).kind === VariableStatement && statementParent === ownerBody;
        const references = symbols.flatMap(symbol => symbol ? referencesOf(symbol).filter(identifier => !(getObject(getObject(identifier).parent).kind === VariableDeclaration &&
                getObject(getObject(identifier).parent).name === identifier) &&
            !(getObject(getObject(identifier).parent).kind === Parameter &&
                getObject(getObject(identifier).parent).name === identifier)) : []);
        const writeReferences = references.filter(isWrite);
        const readReferences = references.filter(reference => !isWrite(reference));
        const earlyReferences = references.filter((reference) => {
            const bindingIndex = symbols.findIndex(symbol => symbol && referencesOf(symbol).includes(reference));
            const { pos = -1 } = getObject(reference);
            const { [bindingIndex]: declaration = {} } = declarations;
            const { end = -1 } = getObject(declaration);

            return bindingIndex >= 0 && pos < end;
        });
        const priorObservations = references.filter(({ pos = -1 } = {}) => pos < getObject(node).pos);
        const capturedReferences = references.filter(reference => ownerOf(reference) !== owner);
        const symbolDeclarations = symbols.flatMap(symbol => getObject(symbol).declarations || []);
        const redeclared = symbolDeclarations.some(declaration => !declarations.includes(declaration));
        const conflicting = symbolDeclarations.some(declaration => ![VariableDeclaration, Parameter]
            .includes(getObject(declaration).kind));
        const parameters = symbolDeclarations.filter(declaration => getObject(declaration).kind === Parameter);
        const simpleParameters = getObject(owner).kind === SourceFile || (getObject(owner).parameters || [])
            .every(parameter => getObject(getObject(parameter).name).kind === Identifier &&
                !getObject(parameter).initializer && !getObject(parameter).dotDotDotToken);
        const exported = (getObject(parent).modifiers || []).some(modifier => [ExportKeyword, DefaultKeyword].includes(getObject(modifier).kind)) ||
            symbols.some(symbol => exportedSymbols.has(symbol)) ||
            references.some(reference => getObject(getObject(reference).parent).kind === ExportSpecifier);
        const allInitialized = declarations.every(({ initializer = false } = {}) => Boolean(initializer));
        const scriptGlobal = getObject(owner).kind === SourceFile && !isExternalModule;
        const directEvalPresent = hasEval(ownerBody);
        const moduleOwned = getObject(owner).kind === SourceFile;
        const common = complete && !scriptGlobal && !directEvalPresent && !exported && !conflicting &&
            !symbols.some(symbol => getObject(symbol).name === 'arguments');
        const routeAEligible = common && directOwnerStatement && allInitialized && !earlyReferences.length &&
            !capturedReferences.length && !redeclared && !parameters.length;
        const routeBEligible = common && (!moduleOwned || !capturedReferences.length) &&
            simpleParameters && symbolDeclarations.every(declaration => getObject(declaration).kind !== Parameter || ownerOf(declaration) === owner) &&
            (getObject(owner).kind === SourceFile || getObject(ownerBody).kind === Block);
        const getUnsupportedReason = () => {
            if (!complete) return 'missing simple checker binding evidence';

            if (scriptGlobal) return 'script global var binding requires native global semantics';

            if (directEvalPresent) return 'direct eval can observe the native var environment';

            if (exported) return 'module export may observe var during cyclic instantiation';

            if (conflicting) return 'binding conflicts with a non-var declaration';

            if (!simpleParameters) return 'non-simple parameter environment is unproved';

            if (moduleOwned && capturedReferences.length)
                return 'captured module binding may be observed before module evaluation';

            return 'scope-entry lexical binding equivalence is unproved';
        };
        const unsupportedReason = getUnsupportedReason();
        const evidence = () => {
            if (routeAEligible) return [
                'checker identity confines every binding use to one initialized owner-body declaration',
                writeReferences.length
                    ? 'checker-resolved writes require a mutable lexical binding'
                    : 'no checker-resolved writes require mutable binding syntax'
            ];

            if (routeBEligible) return [
                'checker identity admits one scope-entry lexical binding with source-position writes'
            ];

            return [unsupportedReason];
        };

        const sourceRange = getConsumerContractKey(node);

        const declarationContract = [sourceRange, {
            operationRole: 'declaration-lifetime',
            sourceRange,
            owningScopeRange: getConsumerContractKey(owner),
            entryAnchorRange: getConsumerContractKey(ownerBody),
            bindingNames: names.map(({ text = '' } = {}) => text),
            bindingSymbols: symbols,
            parameterSymbols: parameters.map(parameter => getSymbolAtLocation.call(checker, getObject(parameter).name)),
            routeAEligible,
            routeBEligible,
            hasWrites: Boolean(writeReferences.length),
            unsupportedReason,
            declarationRanges: declarations.map(getConsumerContractKey),
            readRanges: readReferences.map(getConsumerContractKey),
            writeRanges: writeReferences.map(getConsumerContractKey),
            earlyReferenceRanges: earlyReferences.map(getConsumerContractKey),
            hasPriorObservation: Boolean(priorObservations.length),
            capturedReferenceRanges: capturedReferences.map(getConsumerContractKey),
            initializationPhase: 'scope-entry-undefined-then-declaration-assignment',
            evidence: evidence()
        }];
        const referenceContracts = (routeBEligible ? [] : earlyReferences).map(reference => [getConsumerContractKey(reference), {
            action: 'retain-function-scoped-var-reference',
            operationRole: 'declaration-lifetime-reference',
            sourceRange: getConsumerContractKey(reference),
            declarationRange: sourceRange,
            evidence: ['checker-resolved read precedes var declaration assignment but follows scope-entry initialization']
        }]);

        return [declarationContract, ...referenceContracts];
    }));
};

const collectNativeFunctionContracts = ({ typescript = {}, sourceFile = {}, checker = {},
    census = createSourceCensus({ typescript, sourceFile }),
    bindingReferences = collectBindingReferences({ typescript, sourceFile, checker, census }) } = {}) => {
    if (!hasTypeChecker(checker)) return new Map();

    const {
        ArrowFunction = -1,
        AsyncKeyword = -1,
        CallExpression = -1,
        DefaultKeyword = -1,
        ExportAssignment = -1,
        ExportKeyword = -1,
        ExportSpecifier = -1,
        SourceFile = -1,
        FunctionDeclaration = -1,
        Identifier = -1,
        MetaProperty = -1,
        NewKeyword = -1,
        ThisKeyword = -1
    } = getSyntaxKinds(typescript);
    const declarations = census.select(FunctionDeclaration).filter(({ body = false } = {}) => Boolean(body));
    const { ownerOf = () => sourceFile, isWithin = () => false, isWrite = () => false,
        hasEval = () => false, referencesOf = () => [], exportedSymbols = new Set() } = getDeclarationReferenceFacts({
        typescript, sourceFile, checker, census, bindingReferences
    });
    const isExportReference = (node = {}) => {
        const { parent = {} } = getObject(node);
        const { kind = 0 } = getObject(parent);

        return kind === ExportSpecifier || kind === ExportAssignment;
    };
    const getLexicalCapabilities = (declaration = {}) => {
        const { asteriskToken = false, modifiers = [] } = getObject(declaration);
        const asyncFunction = modifiers.some(({ kind = -1 } = {}) => kind === AsyncKeyword);
        let capabilities = asyncFunction ? [] : ['construct', 'prototype'];

        if (asteriskToken) capabilities = ['prototype'];

        const addCapability = (capability) => {
            capabilities = [...new Set([...capabilities, capability])];
        };
        const visit = (node = {}) => {
            const { kind = 0, keywordToken = -1, text = '' } = getObject(node);

            if (kind !== ArrowFunction && typescript.isFunctionLike(node)) return;

            if (kind === ThisKeyword) addCapability('dynamic-this');

            if (kind === Identifier && text === 'arguments') addCapability('arguments');

            if (kind === MetaProperty && keywordToken === NewKeyword) addCapability('new-target');

            typescript.forEachChild(node, child => visit(child));
        };

        visit(getObject(declaration).body);

        return capabilities;
    };

    return new Map(declarations.flatMap((node = {}) => {
        const { asteriskToken = false, modifiers = [], name = {} } = getObject(node);
        const symbol = getObject(name).kind === Identifier ? checker.getSymbolAtLocation(name) : false;

        if (!symbol) return [];

        const references = referencesOf(symbol).filter((identifier = {}) => {
            const { parent = {} } = getObject(identifier);
            const declarationName = getObject(parent).kind === FunctionDeclaration &&
                getObject(parent).name === identifier;

            return identifier !== name && !declarationName;
        });
        const directCallReferences = references.filter((identifier = {}) => {
            const { parent = {} } = getObject(identifier);

            return getObject(parent).kind === CallExpression && getObject(parent).expression === identifier;
        });
        const exported = modifiers.some(({ kind = -1 } = {}) => (
            kind === ExportKeyword || kind === DefaultKeyword
        )) || exportedSymbols.has(symbol) || references.some(isExportReference);
        const owner = ownerOf(node);
        const ownerBody = getObject(owner).kind === SourceFile ? owner : getObject(owner).body;
        const directPlacement = getObject(node).parent === ownerBody;
        const directEvalPresent = hasEval(ownerBody);
        const writeReferences = references.filter(isWrite);
        const readReferences = references.filter(reference => !writeReferences.includes(reference));
        const earlyReferences = references.filter(({ pos = -1 } = {}) => pos < getObject(node).end);
        const capturedReferences = references.filter(reference => ownerOf(reference) !== owner);
        const selfReferences = references.filter(reference => isWithin(reference, node));
        const { declarations: symbolDeclarations = [] } = getObject(symbol);
        const runtimeDeclarations = symbolDeclarations.filter(declaration => getObject(declaration).kind === FunctionDeclaration && getObject(declaration).body);
        const [runtimeDeclaration = false] = runtimeDeclarations;
        const oneRuntimeDeclaration = runtimeDeclarations.length === 1 && runtimeDeclaration === node &&
            symbolDeclarations.length === 1;
        const { isExternalModule = false } = typescript;
        const externalModule = typeof isExternalModule === 'function' &&
            isExternalModule.call(typescript, sourceFile);
        const lifetimeEquivalent = externalModule && directPlacement && oneRuntimeDeclaration &&
            !exported && !directEvalPresent && !earlyReferences.length && !capturedReferences.length &&
            !selfReferences.length && !writeReferences.length;
        const capabilities = getLexicalCapabilities(node);
        const lexicalCapabilityUse = capabilities.some(capability => !['construct', 'prototype'].includes(capability));
        const simpleParameters = (getObject(node).parameters || []).every(parameter => getObject(getObject(parameter).name).kind === Identifier &&
            getObject(getObject(parameter).name).text !== 'this' &&
            !getObject(parameter).initializer && !getObject(parameter).dotDotDotToken);
        const arrowEquivalent = lifetimeEquivalent && simpleParameters && !asteriskToken &&
            references.some(() => true) && references.every(reference => directCallReferences.includes(reference)) &&
            !lexicalCapabilityUse;
        const sourceRange = getConsumerContractKey(node);
        const preservationReason = () => {
            if (exported) return 'exported binding exposes native callable capabilities';

            if (earlyReferences.length || capturedReferences.length || selfReferences.length || directEvalPresent)
                return 'source observation can precede declaration initialization';

            return 'equivalence to arrow syntax is not proved';
        };

        const declarationContract = [sourceRange, {
            operationRole: 'native-function-capability',
            sourceRange,
            arrowEquivalent,
            lifetimeEquivalent,
            hoistingRequired: !lifetimeEquivalent,
            evalObservedName: directEvalPresent && !references.length,
            exported,
            directPlacement,
            oneRuntimeDeclaration,
            simpleParameters,
            capturedReferenceRanges: capturedReferences.map(getConsumerContractKey),
            selfReferenceRanges: selfReferences.map(getConsumerContractKey),
            owningScopeRange: getConsumerContractKey(owner),
            initializationPhase: 'scope-instantiation',
            capabilities,
            referenceRanges: references.map(getConsumerContractKey),
            readRanges: readReferences.map(getConsumerContractKey),
            writeRanges: writeReferences.map(getConsumerContractKey),
            mutableBinding: Boolean(writeReferences.length),
            directCallRanges: directCallReferences.map(getConsumerContractKey),
            evidence: arrowEquivalent ? [
                'checker resolves every use to a direct ordinary call after declaration initialization',
                'lexical body has no dynamic receiver, arguments, or new.target capability'
            ] : [
                'ordinary function kind owns construction and prototype capabilities',
                preservationReason()
            ]
        }];
        const referenceContracts = earlyReferences.filter(({ pos = -1 } = {}) => pos < getObject(node).pos)
            .map(reference => [getConsumerContractKey(reference), {
                operationRole: 'native-function-reference',
                sourceRange: getConsumerContractKey(reference),
                declarationRange: sourceRange,
                evidence: ['checker-resolved source reference precedes native function declaration initialization']
            }]);

        return [declarationContract, ...referenceContracts];
    }));
};

const collectHoistedFunctionContracts = ({ typescript = {}, sourceFile = {}, checker = {},
    census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    if (!hasTypeChecker(checker)) return new Map();

    const { FunctionDeclaration = -1, Identifier = -1 } = getSyntaxKinds(typescript);
    const { statements = [] } = getObject(sourceFile);
    const declarations = statements.filter(({ kind = 0, body = false, name = {} } = {}) => (
        kind === FunctionDeclaration && body && getObject(name).kind === Identifier
    ));
    const bySymbol = new Map(declarations.map((node = {}) => [
        checker.getSymbolAtLocation(getObject(node).name), node
    ]).filter(([symbol = false] = []) => Boolean(symbol)));
    const dependencies = new Map([...bySymbol].map(([symbol = false, node = {}] = []) => {
        let targets = new Set();
        const visit = (child = {}) => {
            const { kind = 0 } = getObject(child);
            const target = kind === Identifier ? checker.getSymbolAtLocation(child) : false;

            if (target && target !== symbol && bySymbol.has(target)) targets = new Set([...targets, target]);

            typescript.forEachChild(child, visit);
        };

        visit(getObject(node).body);

        return [symbol, targets];
    }));
    const reaches = (current, target, seen = new Set()) => {
        if (current === target) return true;

        if (seen.has(current)) return false;

        const nextSeen = new Set([...seen, current]);

        return [...(dependencies.get(current) || [])].some(next => reaches(next, target, nextSeen));
    };

    const cycleDeclarations = [...bySymbol].flatMap(([symbol = false, node = {}] = []) => {
        const peers = [...(dependencies.get(symbol) || [])].filter(peer => reaches(peer, symbol));

        if (!peers.length) return [];

        const sourceRange = getConsumerContractKey(node);
        const forwardPeers = new Set(peers.filter(peer => getObject(bySymbol.get(peer)).pos > getObject(node).pos));
        const containsForwardPeer = (candidate = {}) => {
            const { kind = 0 } = getObject(candidate);
            const resolved = kind === Identifier ? checker.getSymbolAtLocation(candidate) : false;

            if (forwardPeers.has(resolved)) return true;

            let found = false;

            typescript.forEachChild(candidate, (child) => {
                if (containsForwardPeer(child)) found = true;
            });

            return found;
        };
        const { ReturnStatement = -1 } = getSyntaxKinds(typescript);
        const forwardReturnRanges = (getObject(getObject(node).body).statements || [])
            .filter(statement => getObject(statement).kind === ReturnStatement && containsForwardPeer(statement))
            .map(getConsumerContractKey);

        return [[sourceRange, {
            action: 'retain-hoisted-function',
            operationRole: 'hoisted-function-cycle',
            sourceRange,
            dependencyRanges: peers.map(peer => getConsumerContractKey(bySymbol.get(peer))),
            forwardReturnRanges,
            evidence: ['checker-resolved mutual declaration cycle requires native function hoisting']
        }]];
    });
    const cycleSymbols = new Set(cycleDeclarations.map(([, contract = {}]) => {
        const { sourceRange = '' } = getObject(contract);
        const node = declarations.find(candidate => getConsumerContractKey(candidate) === sourceRange);

        return node ? checker.getSymbolAtLocation(getObject(node).name) : false;
    }).filter(Boolean));
    const declarationNames = new Set(declarations.map(node => getObject(node).name));
    let references = [];
    const collectReference = (node = {}) => {
        const { kind = 0 } = getObject(node);
        const symbol = kind === Identifier ? checker.getSymbolAtLocation(node) : false;
        const target = symbol ? bySymbol.get(symbol) : false;

        if (target && cycleSymbols.has(symbol) && !declarationNames.has(node) &&
            getConsumerContractKey(node)) {
            const sourceRange = getConsumerContractKey(node);

            references = [...references, [sourceRange, {
                action: 'retain-hoisted-reference',
                operationRole: 'hoisted-function-reference',
                sourceRange,
                declarationRange: getConsumerContractKey(getObject(target)),
                evidence: ['forward reference resolves to a checker-proven native declaration cycle']
            }]];
        }
    };

    census.select(Identifier).forEach(collectReference);

    return new Map([...cycleDeclarations, ...references]);
};

const collectLiveOwnKeyEnumerationContracts = ({ typescript = {}, sourceFile = {}, checker = {},
    census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    if (!hasTypeChecker(checker)) return new Map();

    const {
        ForInStatement = -1, Identifier = -1, Block = -1,
        IfStatement = -1, BinaryExpression = -1, ElementAccessExpression = -1,
        EqualsToken = -1
    } = getSyntaxKinds(typescript);
    const { TypeFlags: { Object: ObjectFlag = -1, TypeParameter: TypeParameterFlag = -1 } = {} } = typescript;
    let contracts = new Map();
    const inspectLiveOwnKeyUnit = (node = {}) => {
        const { kind = 0, initializer = {}, expression = {}, statement = {} } = getObject(node);
        const [declaration = {}] = getObject(initializer).declarations || [];
        const keyBinding = getObject(declaration).name || initializer;

        if (kind !== ForInStatement || getObject(keyBinding).kind !== Identifier) return;

        const key = getObject(keyBinding).text || '';
        const sourceType = checker.getTypeAtLocation(expression);
        const { flags: sourceFlags = 0 } = getObject(sourceType);

        if (!(sourceFlags & (ObjectFlag | TypeParameterFlag))) return;

        const genericSource = Boolean(sourceFlags & TypeParameterFlag);

        const sourceRange = getConsumerContractKey(node);

        contracts = new Map([...contracts, [sourceRange, {
            action: 'retain-live-object-enumeration',
            operationRole: 'live-object-enumeration',
            sourceRange,
            sourceExpressionRange: getConsumerContractKey(expression),
            evidence: [genericSource
                ? 'Generic for-in retains native key enumeration without assuming a runtime object family'
                : 'Native for-in preserves inherited enumerable keys and source enumeration order']
        }]]);

        const { statements = [] } = getObject(statement);
        const [guard = {}] = statements;

        if (getObject(statement).kind !== Block || getObject(guard).kind !== IfStatement) return;

        let indexedWrite = false;
        const findWrite = (candidate = {}) => {
            const { kind: candidateKind = 0, left = {}, operatorToken = {} } = getObject(candidate);
            const { argumentExpression = {} } = getObject(left);

            if (candidateKind === BinaryExpression && getObject(operatorToken).kind === EqualsToken &&
                getObject(left).kind === ElementAccessExpression &&
                getObject(argumentExpression).text === key) indexedWrite = true;

            typescript.forEachChild(candidate, findWrite);
        };

        findWrite(getObject(guard).thenStatement);

        if (!indexedWrite) return;

        contracts = new Map([...contracts, [sourceRange, {
            action: 'retain-live-own-key-enumeration',
            operationRole: 'live-own-key-enumeration',
            sourceRange,
            guardRange: getConsumerContractKey(guard),
            sourceExpressionRange: getConsumerContractKey(expression),
            evidence: ['Live own-key enumeration preserves guarded write timing']
        }]]);
    };
    const visit = (node = {}) => {
        inspectLiveOwnKeyUnit(node);
    };

    census.select(ForInStatement).forEach(visit);

    return contracts;
};

const collectLiveArrayVisitationContracts = ({ typescript = {}, sourceFile = {}, checker = {},
    census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        ForOfStatement = -1,
        ArrayBindingPattern = -1,
        BindingElement = -1,
        CallExpression = -1,
        PropertyAccessExpression = -1,
        ElementAccessExpression = -1,
        Identifier = -1,
        VariableDeclaration = -1,
        ArrayLiteralExpression = -1,
        ObjectLiteralExpression = -1,
        BinaryExpression = -1,
        PrefixUnaryExpression = -1,
        PostfixUnaryExpression = -1,
        DeleteExpression = -1,
        EqualsToken = -1,
        FirstAssignment = -1,
        LastAssignment = -1,
        ArrowFunction = -1,
        FunctionDeclaration = -1,
        FunctionExpression = -1
    } = getSyntaxKinds(typescript);
    const { getSymbolAtLocation = false } = getObject(checker);
    const functionKinds = [ArrowFunction, FunctionDeclaration, FunctionExpression];
    const mutatingMethods = new Set([
        'add', 'clear', 'copyWithin', 'delete', 'fill', 'pop', 'push',
        'reverse', 'set', 'shift', 'sort', 'splice', 'unshift'
    ]);
    let contracts = new Map();
    const getRootIdentifier = (candidate = {}) => {
        const { kind = 0, expression = {} } = getObject(candidate);

        if ([PropertyAccessExpression, ElementAccessExpression].includes(kind)) {
            return getRootIdentifier(expression);
        }

        return kind === Identifier ? candidate : {};
    };
    const getMutation = (candidate = {}) => {
        const { kind = 0, expression = {}, left = {}, operand = {}, operatorToken = {} } = getObject(candidate);
        const { kind: calleeKind = 0, expression: receiver = {}, name: member = {} } = getObject(expression);
        const { kind: receiverKind = 0, text: receiverName = '' } = getObject(receiver);
        const { text: method = '' } = getObject(member);
        const nativeAssign = kind === CallExpression && calleeKind === PropertyAccessExpression &&
            receiverKind === Identifier && receiverName === 'Object' && method === 'assign';
        const methodMutation = kind === CallExpression && calleeKind === PropertyAccessExpression &&
            mutatingMethods.has(method);

        if (nativeAssign || methodMutation) return { candidate, method, receiver, target: receiver, nativeAssign };

        const assignment = kind === BinaryExpression && getObject(operatorToken).kind >= FirstAssignment &&
            getObject(operatorToken).kind <= LastAssignment &&
            [PropertyAccessExpression, ElementAccessExpression].includes(getObject(left).kind);
        const update = [PrefixUnaryExpression, PostfixUnaryExpression].includes(kind) &&
            [PropertyAccessExpression, ElementAccessExpression].includes(getObject(operand).kind);
        const deletion = kind === DeleteExpression &&
            [PropertyAccessExpression, ElementAccessExpression].includes(getObject(expression).kind);

        return assignment || update || deletion ? {
            candidate,
            method: '',
            receiver: {},
            target: assignment ? left : operand,
            nativeAssign: false,
            simpleAssignment: assignment && getObject(operatorToken).kind === EqualsToken
        } : {};
    };
    const getLoopMutations = (loop = {}) => {
        const { statement: body = {} } = getObject(loop);
        let mutations = [];
        const inspect = (candidate = {}) => {
            if (candidate !== body && functionKinds.includes(getObject(candidate).kind)) return;

            const mutation = getMutation(candidate);

            if (getObject(mutation).candidate) mutations = [...mutations, mutation];

            typescript.forEachChild(candidate, inspect);
        };

        inspect(body);

        return mutations;
    };
    const isOwnedFreshAccumulator = ({ loop = {}, target = {} } = {}) => {
        if (typeof getSymbolAtLocation !== 'function') return false;

        const root = getRootIdentifier(target);
        const symbol = getSymbolAtLocation.call(checker, root);
        const { valueDeclaration = {}, declarations = [] } = getObject(symbol);
        const [firstDeclaration = {}] = declarations;
        const declaration = getObject(valueDeclaration).kind ? valueDeclaration : firstDeclaration;
        const { kind: declarationKind = 0, initializer = {} } = getObject(declaration);
        const fresh = [ArrayLiteralExpression, ObjectLiteralExpression].includes(getObject(initializer).kind);
        const loopOwner = getEnclosingFunction({ typescript, node: loop });
        const declarationOwner = getEnclosingFunction({ typescript, node: declaration });

        return declarationKind === VariableDeclaration && fresh && getObject(loopOwner).kind &&
            loopOwner === declarationOwner;
    };
    const isOwnedAccumulatorMutation = ({ loop = {}, mutation = {} } = {}) => {
        const { method = '', receiver = {}, target = {}, nativeAssign = false,
            simpleAssignment = false } = getObject(mutation);

        if (nativeAssign || !isOwnedFreshAccumulator({ loop, target })) return false;

        if (simpleAssignment) return true;

        return method === 'push' && isStandardArrayType({ typescript, checker, candidate: receiver });
    };
    const visit = (node = {}) => {
        const { kind = 0, expression = {}, awaitModifier = false,
            initializer = {} } = getObject(node);

        if (kind === ForOfStatement && !awaitModifier &&
            isStandardArrayType({ typescript, checker, candidate: expression })) {
            const loopRange = getConsumerContractKey(node);
            const [declaration = {}] = getObject(initializer).declarations || [];
            const { name: binding = {} } = getObject(declaration);
            const nativeEntryBinding = getObject(binding).kind === ArrayBindingPattern &&
                (getObject(binding).elements || []).some((element = {}) => (
                    getObject(element).kind === BindingElement && !getObject(element).initializer
                ));
            const mutations = getLoopMutations(node);
            const mutationBoundary = Boolean(mutations.length) && mutations.every(mutation => (
                isOwnedAccumulatorMutation({ loop: node, mutation })
            ));
            const visitationEvidence = 'Array for-of acquires its iterator and visits sparse slots unlike prototype callbacks';
            const mutationEvidence = 'fresh local accumulator writes preserve source identity during native array visitation';

            contracts = new Map([...contracts, [loopRange, {
                action: 'retain-live-array-visitation',
                operationRole: 'live-array-visitation',
                loopRange,
                sourceRange: loopRange,
                nativeEntryBinding,
                bindingRange: nativeEntryBinding ? getConsumerContractKey(binding) : '',
                mutationBoundary,
                mutationRanges: mutationBoundary
                    ? mutations.map(({ candidate = {} } = {}) => getConsumerContractKey(candidate))
                    : [],
                evidence: [visitationEvidence, ...(mutationBoundary ? [mutationEvidence] : [])]
            }]]);
        }
    };

    census.select(ForOfStatement).forEach(visit);

    return contracts;
};

const collectLoopCarriedRecurrenceContracts = ({ typescript = {}, sourceFile = {}, checker = {},
    census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        WhileStatement = -1, ForStatement = -1, Block = -1,
        TrueKeyword = -1, BreakStatement = -1, BinaryExpression = -1,
        EqualsToken = -1, Identifier = -1, VariableDeclaration = -1,
        CallExpression = -1, FunctionDeclaration = -1,
        FunctionExpression = -1, ArrowFunction = -1
    } = getSyntaxKinds(typescript);
    const { NodeFlags: { Let: LetFlag = 0 } = {} } = typescript;
    const { TypeFlags: { Any: AnyFlag = 0, Unknown: UnknownFlag = 0 } = {} } = typescript;
    const { getSymbolAtLocation = false, getTypeAtLocation = false } = getObject(checker);
    let contracts = new Map();

    if (typeof getSymbolAtLocation !== 'function' || typeof getTypeAtLocation !== 'function') {
        return contracts;
    }

    const inspectRecurrence = (node = {}) => {
        const { kind = 0, statement: body = {}, expression: condition = {} } = getObject(node);
        const { statements = [], kind: bodyKind = 0 } = getObject(body);

        if (![WhileStatement, ForStatement].includes(kind) || bodyKind !== Block || !statements.length) return;

        const openEnded = kind === WhileStatement && getObject(condition).kind === TrueKeyword ||
            kind === ForStatement && !getObject(node).condition &&
            !getObject(node).initializer && !getObject(node).incrementor;
        let assignments = [];
        let calls = [];
        let hasBreak = false;
        const inspectRecurrenceNode = (current = {}) => {
            const { kind: currentKind = 0, left = {}, operatorToken = {},
                expression: callee = {}, arguments: args = [] } = getObject(current);

            if ([FunctionDeclaration, FunctionExpression, ArrowFunction].includes(currentKind) ||
                current !== body && [WhileStatement, ForStatement].includes(currentKind)) return;

            if (currentKind === BinaryExpression && getObject(operatorToken).kind === EqualsToken &&
                getObject(left).kind === Identifier) assignments = [...assignments, current];

            if (currentKind === CallExpression) calls = [...calls, { call: current, callee, args }];

            if (currentKind === BreakStatement) hasBreak = true;

            typescript.forEachChild(current, inspectRecurrenceNode);
        };

        inspectRecurrenceNode(body);
        inspectRecurrenceNode(openEnded ? {} : condition);

        const hasSymbol = (current = {}, symbol = false) => {
            if ([FunctionDeclaration, FunctionExpression, ArrowFunction].includes(getObject(current).kind)) {
                return false;
            }

            if (getObject(current).kind === Identifier &&
                getSymbolAtLocation.call(checker, current) === symbol) return true;

            let found = false;

            typescript.forEachChild(current, (child) => {
                if (hasSymbol(child, symbol)) found = true;
            });

            return found;
        };
        const [feedback = {}] = assignments.filter((assignment = {}) => {
            const { left = {}, right = {}, pos = -1 } = getObject(assignment);
            const symbol = getSymbolAtLocation.call(checker, left);
            const { valueDeclaration: declaration = {} } = getObject(symbol);
            const { parent: declarationList = {} } = getObject(declaration);
            const carrierType = getTypeAtLocation.call(checker, left);
            const knownType = getObject(declaration).kind === VariableDeclaration &&
                !(getObject(carrierType).flags & (AnyFlag | UnknownFlag));
            const participates = calls.some(({ call = {}, args = [] } = {}) => {
                const { pos: callStart = -1, end: callEnd = -1 } = getObject(call);
                const { pos: rightStart = -1, end: rightEnd = -1 } = getObject(right);
                const beforeUpdate = callStart < pos ||
                    callStart >= rightStart && callEnd <= rightEnd;

                return beforeUpdate && args.some(argument => hasSymbol(argument, symbol));
            });

            return (kind === WhileStatement || openEnded) && knownType &&
                Boolean(getObject(declarationList).flags & LetFlag) &&
                (!openEnded || hasBreak) && participates;
        });

        if (!getObject(feedback).kind) return;

        const { left = {} } = getObject(feedback);
        const loopRange = getConsumerContractKey(node);

        contracts = new Map([...contracts, [loopRange, {
            action: 'retain-loop-carried-recurrence',
            operationRole: 'loop-carried-recurrence',
            loopRange,
            updateRange: getConsumerContractKey(feedback),
            carrierRange: getConsumerContractKey(left),
            evidence: ['Loop-carried state feeds a call before its next assignment and preserves termination timing']
        }]]);
    };
    const visit = (node = {}) => {
        inspectRecurrence(node);
    };

    census.select(WhileStatement, ForStatement).forEach(visit);

    return contracts;
};

const collectNumericRangeBuilderContracts = ({ typescript = {}, sourceFile = {}, checker = {},
    census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    if (!hasTypeChecker(checker)) return new Map();

    const {
        ForStatement = -1, VariableDeclarationList = -1, NumericLiteral = -1,
        BinaryExpression = -1, LessThanToken = -1, PostfixUnaryExpression = -1,
        PlusPlusToken = -1, Identifier = -1, Block = -1, ExpressionStatement = -1,
        CallExpression = -1, PropertyAccessExpression = -1, ArrayLiteralExpression = -1,
        ReturnStatement = -1
    } = getSyntaxKinds(typescript);
    const { NodeFlags: { Let: LetFlag = 0 } = {},
        TypeFlags: { NumberLike: NumberLikeFlag = 0 } = {} } = typescript;
    let contracts = new Map();
    const getSymbol = node => checker.getSymbolAtLocation(node);
    const isNumber = node => Boolean(getObject(checker.getTypeAtLocation(node)).flags & NumberLikeFlag);
    const visit = (node = {}) => {
        const { kind = 0, initializer = {}, condition = {}, incrementor = {}, statement = {} } = getObject(node);
        const { declarations = [], flags: declarationFlags = 0 } = getObject(initializer);
        const [counterDeclaration = {}] = declarations;
        const { name: counter = {}, initializer: start = {} } = getObject(counterDeclaration);
        const { left = {}, right: bound = {}, operatorToken = {} } = getObject(condition);
        const { operand = {}, operator = -1 } = getObject(incrementor);
        const counterSymbol = getObject(counter).kind === Identifier ? getSymbol(counter) : false;
        const induction = kind === ForStatement &&
            getObject(initializer).kind === VariableDeclarationList &&
            Boolean(declarationFlags & LetFlag) && declarations.length === 1 &&
            getObject(start).kind === NumericLiteral && getObject(start).text === '1' &&
            getObject(condition).kind === BinaryExpression &&
            getObject(operatorToken).kind === LessThanToken &&
            getObject(incrementor).kind === PostfixUnaryExpression && operator === PlusPlusToken &&
            counterSymbol && getSymbol(left) === counterSymbol && getSymbol(operand) === counterSymbol &&
            isNumber(counter) && isNumber(bound);

        if (!induction || getObject(statement).kind !== Block) {
            return;
        }

        const [update = {}] = getObject(statement).statements || [];
        const { expression: pushCall = {} } = getObject(update);
        const { expression: member = {}, arguments: pushArguments = [] } = getObject(pushCall);
        const { expression: output = {}, name: method = {} } = getObject(member);
        const [produced = {}] = pushArguments;
        const [argument = {}] = getObject(produced).arguments || [];
        const outputSymbol = getObject(output).kind === Identifier ? getSymbol(output) : false;
        const outputDeclaration = getObject(outputSymbol).valueDeclaration || {};
        const { statements: surrounding = [] } = getObject(getObject(node).parent);
        const directlyReturned = surrounding.some((candidate = {}) => (
            getObject(candidate).kind === ReturnStatement &&
            getSymbol(getObject(candidate).expression) === outputSymbol
        ));

        if (getObject(update).kind === ExpressionStatement &&
            getObject(pushCall).kind === CallExpression &&
            getObject(member).kind === PropertyAccessExpression &&
            getObject(method).text === 'push' && pushArguments.length === 1 &&
            getObject(produced).kind === CallExpression &&
            getObject(argument).kind === Identifier && getSymbol(argument) === counterSymbol &&
            getObject(getObject(outputDeclaration).initializer).kind === ArrayLiteralExpression &&
            isStandardArrayType({ typescript, checker, candidate: output }) && directlyReturned) {
            const loopRange = getConsumerContractKey(node);

            contracts = new Map([...contracts, [loopRange, {
                action: 'retain-numeric-range-builder',
                operationRole: 'numeric-range-builder',
                loopRange,
                sourceRange: loopRange,
                counterRange: getConsumerContractKey(counter),
                updateRange: getConsumerContractKey(update),
                evidence: ['Numeric range builds callback results without a source collection to prototype-transform']
            }]]);
        }
    };

    census.select(ForStatement).forEach(visit);

    return contracts;
};

export {
    collectBindingReferences,
    collectRuntimeBindingReferenceFacts,
    applyTypeBindingsToMembers,
    expandUnionParts,
    getAgreementReason,
    getAvailableResolverName,
    getCallExpressionName,
    getCallIdentifierArgument,
    getCanonical,
    getPredicate,
    getCheckerContract,
    createTypeScriptTupleSyntax,
    getConsumerBindingContract,
    getTupleConsumerContract,
    getTupleParameterContract,
    getConsumerContractKey,
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
    collectMutableSelectedLoopContracts,
    collectIndexedLocalSelectionContracts,
    collectUnusedBindingContracts,
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
    collectLiveArrayVisitationContracts,
    collectLoopCarriedRecurrenceContracts,
    collectNumericRangeBuilderContracts,
    getSelectedModelPredicate,
    getSelectedModelPredicateFact,
    collectSelectedModelContracts,
    getProviderForwardKey,
    getCheckerTypeNode,
    getConstructorContract,
    getDeclaration,
    getDeclarationEntries,
    getDeclarationEntry,
    getDeclarationMap,
    getDeclarationType,
    getEnclosingTypeParameter,
    getFamilyCheck,
    getIdentifierName,
    getIndexedAccessMemberTypes,
    getLiteralCheck,
    getLiteralNames,
    getLiteralRuntimeKind,
    getMembers,
    getName,
    getObjectDiscriminator,
    getObjectPropertyNames,
    getObjectShapeCheck,
    getProgramDeclarationMap,
    getPropertySource,
    getQualifiedName,
    getResolverName,
    getRuntimeKind,
    getRuntimeName,
    getTypeInfo,
    getTypeMembers,
    getTypeParameterBindings,
    getTypeParts,
    getTypeText,
    getUnionParts,
    getUnionResolverSource,
    isAbsenceType,
    isNaNType,
    isNeverType,
    isNullType,
    isSyntheticObjectPart,
    isUnionType,
    primitiveKinds,
    requireCompilerMember,
    resolveTypeInfo,
    setMemberOptionality
};
