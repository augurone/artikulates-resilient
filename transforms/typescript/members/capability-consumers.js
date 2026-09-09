import { getObject } from '../../../rules/support/object.js';
import { updateFunction } from '../../utils/ast-boundary.js';
import {
    createCallableCapabilityGuard,
    createDirectCapabilityStatements
} from '../grammar/algebra.js';
import { getFunctionDestructuringDecision } from '../policy/destructuring-agreements.js';
import { getBindingNames } from '../understand/imports.js';
import { getConsumerContractKey } from '../understand/type-evidence.js';

// Core consistent-return establishes its expectation at the first own return,
// including unreachable returns. Only a later return of the other form needs
// this capability boundary; nested functions establish their own expectation.
const completeCapabilityReturnBoundaries = ({ typescript = {}, body = {} } = {}) => {
    const { SyntaxKind: { ReturnStatement = -1, FunctionDeclaration = -1,
        FunctionExpression = -1, ArrowFunction = -1, MethodDeclaration = -1,
        GetAccessor = -1, SetAccessor = -1, Constructor = -1 } = {},
    getSyntheticLeadingComments = false, setSyntheticLeadingComments = false } = typescript;

    if (typeof getSyntheticLeadingComments !== 'function' || typeof setSyntheticLeadingComments !== 'function') return body;

    const functions = [FunctionDeclaration, FunctionExpression, ArrowFunction,
        MethodDeclaration, GetAccessor, SetAccessor, Constructor];
    let firstReturn = false;
    let hasReturn = false;
    const visit = (node = {}) => {
        const { kind = 0, expression = false } = getObject(node);

        if (functions.includes(kind)) return;

        if (kind !== ReturnStatement) {
            typescript.forEachChild(node, visit);

            return;
        }

        const hasValue = Boolean(expression);
        const needed = hasReturn && firstReturn !== hasValue;
        const comments = getSyntheticLeadingComments(node) || [];

        firstReturn = hasReturn ? firstReturn : hasValue;
        hasReturn = true;

        if (!needed && comments.length) setSyntheticLeadingComments(node, comments.filter(({ text = '' } = {}) => (
            text !== " eslint-disable-next-line consistent-return -- Checked capability disagreement owns this function's natural undefined response."
        )));

        typescript.forEachChild(node, visit);
    };

    visit(body);

    return body;
};

const getCapabilityAlias = ({ receiver = '', member = '', occupied = new Set() } = {}) => {
    const stem = `${receiver}${member.charAt(0).toUpperCase()}${member.slice(1)}`;
    const candidates = [stem, `${stem}Capability`, `${stem}2`];

    return candidates.find(candidate => !occupied.has(candidate)) || `${stem}Capability`;
};

const getNodeKey = ({ typescript = {}, node = {} } = {}) => {
    const { getOriginalNode = false } = typescript;
    const original = typeof getOriginalNode === 'function' ? getOriginalNode(node) : node;

    return getConsumerContractKey(original);
};

const getSortReceiverAlias = ({ occupied = new Set() } = {}) => {
    const candidates = ['_resilientSorted', '_resilientSortReceiver', '_resilientSortedValue'];

    return candidates.find(candidate => !occupied.has(candidate)) || '_resilientSortedValue';
};

// The receiver of `toSorted` is evaluated before its comparator argument in
// source. Stage only a non-identifier receiver so graceful capability
// disagreement never skips Array.from(), slice(), or another source-owned
// prerequisite expression.
const createSortConsumerStatements = ({
    typescript = {},
    call = {},
    alias = '',
    sourceProviderName = '',
    memberName = '',
    occupied = new Set(),
    useFunctionStandard = false,
    sameFunctionProvider = false
} = {}) => {
    const {
        SyntaxKind: { Identifier = -1, SingleLineCommentTrivia = -1 } = {},
        NodeFlags: { Const = 0 } = {},
        factory = {},
        addSyntheticLeadingComment = false
    } = typescript;
    const { expression: callee = {}, arguments: args = [], typeArguments = undefined } = getObject(call);
    const [callback = {}] = args;
    const {
        kind: callbackKind = 0,
        text: callbackName = '',
        expression: provider = {},
        name: providerMember = {}
    } = getObject(callback);
    const { kind: providerKind = 0, text: providerName = '' } = getObject(provider);
    const { text: providerMemberName = '' } = getObject(providerMember);
    const { expression: receiver = {}, name = {} } = getObject(callee);
    const { kind: receiverKind = 0 } = getObject(receiver);
    const receiverName = receiverKind === Identifier ? '' : getSortReceiverAlias({ occupied });
    const receiverReference = receiverName ? factory.createIdentifier(receiverName) : receiver;
    const stagedReceiver = receiverName
        ? factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList([
                factory.createVariableDeclaration(receiverReference, undefined, undefined, receiver)
            ], Const)
        )
        : undefined;
    const directAlias = callbackKind === Identifier ? callbackName : '';
    const sourceProvider = sourceProviderName || (providerKind === Identifier ? providerName : '');
    const sourceMember = memberName || providerMemberName;
    const providerAlias = sourceProvider && sourceMember
        ? callbackName || getCapabilityAlias({ receiver: sourceProvider, member: sourceMember, occupied })
        : '';
    const capabilityAlias = providerAlias || directAlias;

    if (!capabilityAlias) return { statements: [], receiverName: '' };

    // Preserve the source evaluation order for `receiver.sort(O.compare)`:
    // evaluate the receiver, then read the provider field, then decide
    // whether that field is callable.  This deliberately stays in the
    // consumer scope instead of letting parameter lowering hoist the getter.
    const capabilityBinding = sourceProvider && sourceMember
        ? factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList([
                factory.createVariableDeclaration(
                    factory.createObjectBindingPattern([
                        factory.createBindingElement(
                            undefined,
                            factory.createIdentifier(sourceMember),
                            factory.createIdentifier(providerAlias),
                            undefined
                        )
                    ]),
                    undefined,
                    undefined,
                    factory.createIdentifier(sourceProvider)
                )
            ], Const)
        )
        : undefined;
    const orderedBinding = capabilityBinding && sameFunctionProvider && typeof addSyntheticLeadingComment === 'function'
        ? addSyntheticLeadingComment(
            capabilityBinding,
            SingleLineCommentTrivia,
            ' eslint-disable-next-line resilient/prefer-signature-destructuring -- The receiver must be evaluated before reading this provider getter in the consumer function.',
            true
        )
        : capabilityBinding;

    const guarded = createCallableCapabilityGuard({
        typescript,
        alias: capabilityAlias || alias,
        useFunctionStandard
    });
    const replacementCallee = factory.updatePropertyAccessExpression(callee, receiverReference, name);
    const replacement = factory.updateCallExpression(
        call,
        replacementCallee,
        typeArguments,
        [factory.createIdentifier(capabilityAlias)]
    );

    const normalReturn = factory.createReturnStatement(replacement);
    const annotatedReturn = typeof addSyntheticLeadingComment === 'function'
        ? addSyntheticLeadingComment(
            normalReturn,
            SingleLineCommentTrivia,
            ' eslint-disable-next-line consistent-return -- Checked capability disagreement owns this function\'s natural undefined response.',
            true
        )
        : normalReturn;

    return {
        statements: [stagedReceiver, orderedBinding, guarded, annotatedReturn].filter(Boolean),
        receiverName
    };
};

const lowerSortCapabilityConsumer = ({
    typescript = {},
    node = {},
    destructuringAgreements = {},
    agreements = new Set(),
    standard = {}
} = {}) => {
    const {
        SyntaxKind: {
            Block = -1,
            ConditionalExpression = -1,
            ExclamationToken = -1,
            ReturnStatement = -1,
            AsExpression = -1,
            ParenthesizedExpression = -1,
            NonNullExpression = -1
        } = {},
        factory = {}
    } = typescript;
    const { body = {}, parameters = [] } = getObject(node);
    const functionKey = getNodeKey({ typescript, node });
    const { contract: recorded = {}, agreement: decision = {} } = getFunctionDestructuringDecision({
        destructuringAgreements,
        functionKey, kind: 'sort-capability'
    });
    const contract = {
        ...recorded,
        ...decision
    };
    const { kind: bodyKind = 0, whenTrue = {}, whenFalse = {}, condition = {}, statements = [] } = getObject(body);
    const {
        action = '', callKey = '', grammarPlacement = '', evidence = [], source = {}
    } = contract;
    const { provider: sourceProvider = '', member: sourceMember = '' } = getObject(source);

    if (action !== 'guard-sort-capability' || !callKey || !grammarPlacement) return node;

    const occupied = new Set([
        ...parameters.map(({ name = {} } = {}) => getObject(name).text).filter(Boolean),
        ...getBindingNames({ typescript, node: body })
    ]);
    const useFunctionStandard = Boolean(getObject(standard).function);
    const isProviderParameter = ({ name: parameterName = {} } = {}) => getObject(parameterName).text === sourceProvider;
    const sameFunctionProvider = parameters.some(isProviderParameter);
    const build = call => createSortConsumerStatements({
        typescript,
        call,
        occupied,
        sourceProviderName: sourceProvider,
        memberName: sourceMember,
        useFunctionStandard,
        sameFunctionProvider
    });
    let nextBody = body;
    let receiverName = '';

    const getTransparentExpression = (candidate = {}) => {
        const { kind: candidateKind = 0, expression = {} } = getObject(candidate);

        return [AsExpression, ParenthesizedExpression, NonNullExpression].includes(candidateKind)
            ? getTransparentExpression(expression)
            : candidate;
    };
    const expressionTarget = getTransparentExpression(body);
    const isExpressionPlacement = grammarPlacement === 'expression' &&
        getNodeKey({ typescript, node: expressionTarget }) === callKey;
    const expressionConsumer = isExpressionPlacement ? build(expressionTarget) : {};
    const {
        receiverName: expressionReceiverName = '',
        statements: expressionStatements = []
    } = expressionConsumer;

    if (isExpressionPlacement && !expressionStatements.length) return node;

    if (isExpressionPlacement) {
        receiverName = expressionReceiverName;
        nextBody = factory.createBlock(expressionStatements, true);
    }

    const conditionalTarget = grammarPlacement === 'conditional-true' ? whenTrue : whenFalse;
    const conditionalExpressionTarget = getTransparentExpression(conditionalTarget);
    const isGuardedConditional = bodyKind === ConditionalExpression &&
        ['conditional-true', 'conditional-false'].includes(grammarPlacement) &&
        getNodeKey({ typescript, node: conditionalExpressionTarget }) === callKey;

    const conditionalConsumer = isGuardedConditional ? build(conditionalExpressionTarget) : {};
    const {
        receiverName: conditionalReceiverName = '',
        statements: conditionalStatements = []
    } = conditionalConsumer;

    if (isGuardedConditional && !conditionalStatements.length) return node;

    if (isGuardedConditional) {
        const opposite = grammarPlacement === 'conditional-true' ? whenFalse : whenTrue;
        const branchCondition = grammarPlacement === 'conditional-true'
            ? factory.createPrefixUnaryExpression(ExclamationToken, condition)
            : condition;
        const priorReturn = factory.createIfStatement(
            branchCondition,
            factory.createBlock([factory.createReturnStatement(opposite)], true)
        );

        receiverName = conditionalReceiverName;
        nextBody = factory.createBlock([priorReturn, ...conditionalStatements], true);
    }

    const isReturnPlacement = bodyKind === Block && grammarPlacement === 'return';
    const replacement = isReturnPlacement ? statements.flatMap((statement) => {
        const { kind = 0, expression = {} } = getObject(statement);

        if (kind !== ReturnStatement || getNodeKey({ typescript, node: expression }) !== callKey) return [statement];

        const { receiverName: nextReceiverName = '', statements: consumerStatements = [] } = build(expression);

        if (!consumerStatements.length) return [statement];

        receiverName = nextReceiverName;

        return consumerStatements;
    }) : statements;

    if (isReturnPlacement && replacement.length !== statements.length) {
        nextBody = factory.updateBlock(body, replacement);
    }

    if (nextBody === body) return node;

    // eslint-disable-next-line resilient/prefer-safe-transformations -- Shared Set publishes before function update; copying loses caller-visible records.
    if (agreements instanceof Set) agreements.add({
        ...contract,
        action: 'guarded-sort-capability',
        receiverName,
        site: 'static-sort-capability-consumer',
        evidence
    });

    return updateFunction({ typescript, node, parameters,
        body: completeCapabilityReturnBoundaries({ typescript, body: nextBody }) });
};

// Placement consumes only a completed direct-call agreement. It does not try
// to discover capability semantics: Understand has already proven one static,
// receiver-free, inert-argument call in this function.
const lowerDirectCapabilityConsumers = ({
    typescript = {},
    node = {},
    destructuringAgreements = {},
    agreements = new Set(),
    standard = {},
    context = {}
} = {}) => {
    const {
        SyntaxKind: {
            ArrowFunction = -1,
            FunctionExpression = -1,
            FunctionDeclaration = -1,
            Block = -1,
            CallExpression = -1,
            PropertyAccessExpression = -1,
            ReturnStatement = -1,
            ExpressionStatement = -1,
            SingleLineCommentTrivia = -1
        } = {},
        factory = {},
        addSyntheticLeadingComment = false
    } = typescript;
    const { kind = 0, body = {}, parameters = [] } = getObject(node);
    const functionKinds = [ArrowFunction, FunctionExpression, FunctionDeclaration];
    const functionKey = getNodeKey({ typescript, node });
    const { contract: recordedCapability = {}, agreement: recordedAgreement = {} } = getFunctionDestructuringDecision({
        destructuringAgreements,
        functionKey, kind: 'direct-capability'
    });
    const capability = recordedCapability;
    const agreement = recordedAgreement;
    const { action = '', receiver = '', member = '', callKey = '', evidence = [] } = {
        ...capability,
        ...agreement
    };
    const { kind: bodyKind = 0, statements = [] } = getObject(body);

    if (!functionKinds.includes(kind) || action !== 'guard-function-undefined' || !receiver || !member || !callKey) return node;

    const occupied = new Set([
        ...parameters.map(({ name = {} } = {}) => getObject(name).text).filter(Boolean),
        ...getBindingNames({ typescript, node: body })
    ]);
    const alias = getCapabilityAlias({ receiver, member, occupied });
    const replaceCall = (candidate = {}) => {
        const { kind: candidateKind = 0, expression: callee = {}, arguments: args = [], typeArguments = undefined } = getObject(candidate);
        const { kind: calleeKind = 0, expression: calleeReceiver = {}, name = {} } = getObject(callee);
        const { text: receiverText = '' } = getObject(calleeReceiver);
        const { text: memberText = '' } = getObject(name);

        if (candidateKind === CallExpression && calleeKind === PropertyAccessExpression &&
            receiverText === receiver && memberText === member && getNodeKey({ typescript, node: candidate }) === callKey) {
            // The source member call supplies `receiver` as `this` even when
            // TypeScript's callable signature has no explicit `this`
            // parameter. The guarded alias must retain that ECMAScript
            // receiver contract.
            return factory.createCallExpression(
                factory.createPropertyAccessExpression(factory.createIdentifier(alias), 'call'),
                typeArguments,
                [factory.createIdentifier(receiver), ...args]
            );
        }

        return typescript.visitEachChild(candidate, replaceCall, context);
    };
    const capabilityStatements = createDirectCapabilityStatements({
        typescript,
        receiver,
        member,
        alias,
        useFunctionStandard: Boolean(getObject(standard).function)
    });
    const makeReplacement = (statement = {}) => {
        const { kind: statementKind = 0, expression = {} } = getObject(statement);

        if ([ReturnStatement, ExpressionStatement].includes(statementKind) && getNodeKey({ typescript, node: expression }) === callKey) {
            const replacement = statementKind === ReturnStatement
                ? factory.createReturnStatement(replaceCall(expression))
                : factory.createExpressionStatement(replaceCall(expression));
            const annotated = statementKind === ReturnStatement && typeof addSyntheticLeadingComment === 'function'
                ? addSyntheticLeadingComment(
                    replacement,
                    SingleLineCommentTrivia,
                    ' eslint-disable-next-line consistent-return -- Checked capability disagreement owns this function\'s natural undefined response.',
                    true
                )
                : replacement;

            return [...capabilityStatements, annotated];
        }

        return [statement];
    };
    let nextBody = body;

    if (bodyKind === Block) nextBody = factory.updateBlock(body, statements.flatMap(makeReplacement));

    if (bodyKind !== Block && getNodeKey({ typescript, node: body }) === callKey) {
        const returned = factory.createReturnStatement(replaceCall(body));
        const annotated = typeof addSyntheticLeadingComment === 'function'
            ? addSyntheticLeadingComment(
                returned,
                SingleLineCommentTrivia,
                ' eslint-disable-next-line consistent-return -- Checked capability disagreement owns this function\'s natural undefined response.',
                true
            )
            : returned;

        nextBody = factory.createBlock([...capabilityStatements, annotated], true);
    }

    if (nextBody === body) return node;

    // eslint-disable-next-line resilient/prefer-safe-transformations -- Shared Set publishes before function update; copying loses caller-visible records.
    if (agreements instanceof Set) agreements.add({
        ...capability,
        action: 'guarded-direct-capability',
        alias,
        site: 'direct-capability-consumer',
        evidence
    });

    return updateFunction({ typescript, node, parameters,
        body: completeCapabilityReturnBoundaries({ typescript, body: nextBody }) });
};

export { lowerDirectCapabilityConsumers, lowerSortCapabilityConsumer };
