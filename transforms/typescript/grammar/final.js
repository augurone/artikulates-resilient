import { createCollectionAccumulatorRebind } from './algebra.js';
import {
    getBindingAgreementReason,
    getBindingElementCanonical,
    getBindingPropertyName,
    getBindingRuntimeGuardKind
} from './resolvers.js';
import { getObject } from '../../../rules/support/object.js';
import {
    getSourceRange,
    getSyntaxKinds,
    markGuardedNode,
    updateBindingInitializer
} from '../../utils/ast-boundary.js';
import {
    getBindingAgreement,
    annotateAgreementException,
    getBindingDecision,
    emitBindingAgreement,
    getDefaultInitializer
} from '../policy/defaults.js';
import {
    getDestructuringDecision,
    getDestructuringDecisionForNode,
    hasCompletedDestructuringAgreement,
    isCompletedLiveCollectionLoop
} from '../policy/destructuring-agreements.js';
import { getPlacementContract, getPlacementReason, getPlacementBindingDecision, getExactUndefinedReason, getPlacementSymbol } from '../policy/placement.js';
import { getBindingNames } from '../understand/imports.js';
import {
    getCallExpressionName,
    getCallIdentifierArgument,
    getConsumerContractKey
} from '../understand/type-evidence.js';

const lowerFinalGrammar = ({
    typescript = {},
    sourceFile = {},
    destructuringAgreements = {},

    placement = {},
    standard = {},
    context = {},
    agreements = new Set()
} = {}) => {
    const {
        SyntaxKind: {
            PlusEqualsToken: PlusEqualsTokenKind2 = -1,
            MinusEqualsToken: MinusEqualsTokenKind2 = -1,
            AsteriskEqualsToken: AsteriskEqualsTokenKind2 = -1,
            AsteriskAsteriskEqualsToken: AsteriskAsteriskEqualsTokenKind2 = -1,
            SlashEqualsToken: SlashEqualsTokenKind2 = -1,
            PercentEqualsToken: PercentEqualsTokenKind2 = -1,
            AmpersandEqualsToken: AmpersandEqualsTokenKind2 = -1,
            BarEqualsToken: BarEqualsTokenKind2 = -1,
            CaretEqualsToken: CaretEqualsTokenKind2 = -1,
            LessThanLessThanEqualsToken: LessThanLessThanEqualsTokenKind2 = -1,
            GreaterThanGreaterThanEqualsToken: GreaterThanGreaterThanEqualsTokenKind2 = -1,
            GreaterThanGreaterThanGreaterThanEqualsToken: GreaterThanGreaterThanGreaterThanEqualsTokenKind2 = -1,
            AmpersandAmpersandEqualsToken: AmpersandAmpersandEqualsTokenKind2 = -1,
            BarBarEqualsToken: BarBarEqualsTokenKind2 = -1,
            QuestionQuestionEqualsToken: QuestionQuestionEqualsTokenKind2 = -1,
            EqualsGreaterThanToken: EqualsGreaterThanTokenKind7 = -1,
            BarBarToken: BarBarTokenKind3 = -1,
            CallExpression: CallExpressionKind3 = -1,
            ArrayLiteralExpression: ArrayLiteralExpressionKind2 = -1,
            ObjectLiteralExpression: ObjectLiteralExpressionKind2 = -1
        } = {},
        NodeFlags: {
            Let: LetKind2 = 0
        } = {}
    } = typescript;

    const {
        BinaryExpression = -1,
        PropertyAccessExpression = -1,
        ElementAccessExpression = -1,
        Identifier = -1,
        NumericLiteral = -1,
        ObjectBindingPattern = -1,
        ArrayBindingPattern = -1,
        BindingElement = -1,
        VariableDeclaration = -1,
        VariableStatement = -1,
        Parameter = -1,
        CallExpression = -1,
        ConditionalExpression = -1,
        IfStatement = -1,
        Block = -1,
        ExpressionStatement = -1,
        EqualsToken = -1,
        EqualsEqualsEqualsToken = -1,
        ExclamationEqualsToken = -1,
        ExclamationEqualsEqualsToken = -1,
        GreaterThanToken = -1,
        LessThanToken = -1,
        ExclamationToken = -1,
        AmpersandAmpersandToken = -1,
        ArrowFunction = -1,
        FunctionDeclaration = -1,
        FunctionExpression = -1,
        ReturnStatement = -1,
        StringLiteral = -1,
        FalseKeyword = -1,
        DeleteExpression = -1,
        PrefixUnaryExpression = -1,
        PostfixUnaryExpression = -1,
        NewExpression = -1,
        TypeOfExpression = -1,
        EqualsEqualsToken = -1,
        VoidExpression = -1
    } = getSyntaxKinds(typescript);
    const { factory = {}, addSyntheticLeadingComment = false,
        SingleLineCommentTrivia = -1 } = typescript;
    const {
        object: objectStandard = '',
        array: arrayStandard = '',
        function: functionStandard = ''
    } = standard;
    const getClosedProviderModel = (node = {}) => {
        const { agreement = {}, contract = {} } = getDestructuringDecision({
            destructuringAgreements,
            key: getConsumerContractKey(node),
            kinds: ['closed-provider-model']
        });

        return getObject(agreement).action === 'guarded-closed-provider-model' ? contract : {};
    };
    const { collectionMutations = new Map() } = destructuringAgreements;
    const getCollectionMutation = (statement = {}) => {
        const { expression = {} } = getObject(statement);
        const { getOriginalNode = false } = typescript;
        const original = typeof getOriginalNode === 'function' ? getOriginalNode(expression) : expression;
        const originalKey = getConsumerContractKey(original);
        const directKey = getConsumerContractKey(expression);

        return (collectionMutations.has(originalKey)
            ? collectionMutations.get(originalKey) : collectionMutations.get(directKey)) || {};
    };
    const getFactoryBindingDecision = (source = {}) => {
        const { agreement = {} } = getDestructuringDecisionForNode({
            typescript, node: source, destructuringAgreements, kinds: ['factory-required-binding']
        });

        return agreement;
    };
    const isRequiredFactoryProperty = ({ action = '', requiredProperties = [] } = {}, propertyName = '') => (
        action === 'preserve-required-factory-binding' && requiredProperties.includes(propertyName)
    );
    const generatedOpaqueSource = (source) => {
        const { kind = 0, text = '' } = getObject(source);

        return source &&
            kind === Identifier &&
            /^_resilient(?:Tuple|Args)(?:_|$)/.test(text);
    };
    // Resolver staging has already made the outer receiver an object.  An
    // `undefined` element initializer therefore records the source's exact
    // absent-field result; it is not an object fallback and cannot normalize
    // a missing container.  Keep this finite to the generated
    // `isObject(input) ? input : {}` form.
    const isStagedObjectSource = (source = {}) => {
        const {
            kind = 0,
            condition = {},
            whenTrue = {},
            whenFalse = {}
        } = getObject(source);
        const {
            kind: conditionKind = 0,
            expression = {},
            arguments: args = []
        } = getObject(condition);
        const { kind: expressionKind = 0, text = '' } = getObject(expression);
        const { kind: whenTrueKind = 0 } = getObject(whenTrue);
        const { kind: whenFalseKind = 0, properties = [] } = getObject(whenFalse);

        return kind === ConditionalExpression && conditionKind === CallExpression &&
            expressionKind === Identifier && text === 'isObject' && args.length === 1 &&
            whenTrueKind === Identifier && whenFalseKind === ObjectLiteralExpressionKind2 && !properties.length;
    };
    const functionKinds = [FunctionDeclaration, FunctionExpression, ArrowFunction];
    const assignmentOperators = new Set([
        EqualsToken,
        PlusEqualsTokenKind2,
        MinusEqualsTokenKind2,
        AsteriskEqualsTokenKind2,
        AsteriskAsteriskEqualsTokenKind2,
        SlashEqualsTokenKind2,
        PercentEqualsTokenKind2,
        AmpersandEqualsTokenKind2,
        BarEqualsTokenKind2,
        CaretEqualsTokenKind2,
        LessThanLessThanEqualsTokenKind2,
        GreaterThanGreaterThanEqualsTokenKind2,
        GreaterThanGreaterThanGreaterThanEqualsTokenKind2,
        AmpersandAmpersandEqualsTokenKind2,
        BarBarEqualsTokenKind2,
        QuestionQuestionEqualsTokenKind2
    ]);
    const isSameNode = (left = {}, right = {}) => {
        const { pos: leftPos = -1, end: leftEnd = -1 } = getObject(left);
        const { pos: rightPos = -1, end: rightEnd = -1 } = getObject(right);

        return left === right ||
            (leftPos >= 0 &&
                rightPos >= 0 &&
                leftEnd === rightEnd &&
                leftPos === rightPos);
    };
    const isWriteAccess = (node, { left = undefined, operatorToken = {}, expression = undefined, operand = undefined, kind: parentKind = 0 } = {}) => {
        const { kind: opTokenKind = 0 } = getObject(operatorToken);

        return parentKind === BinaryExpression &&
        isSameNode(left, node) &&
        assignmentOperators.has(opTokenKind) ||
        parentKind === DeleteExpression &&
        isSameNode(expression, node) ||
        [PrefixUnaryExpression, PostfixUnaryExpression].includes(parentKind) &&
        isSameNode(operand, node);
    };
    const getIndexedAssignment = ({ operatorToken = {}, left = undefined, kind: nodeKind = 0 } = {}) => {
        const { kind: opTokenKind = 0 } = getObject(operatorToken);
        const { kind: leftKind = 0, expression: leftExpr = {} } = getObject(left);
        const { kind: leftExprKind = 0 } = getObject(leftExpr);

        if (nodeKind !== BinaryExpression ||
            opTokenKind !== EqualsToken ||
            !left ||
            leftKind !== ElementAccessExpression ||
            !leftExpr ||
            leftExprKind !== Identifier) return false;

        // Preserve indexed assignments so they can be handled by accumulator
        // reconstruction or annotated by annotateRetainedDynamicMemberAccess.
        return false;
    };
    const getIndexedRead = (node, parent = {}) => {
        const { contract: callbackOwner = {} } = getDestructuringDecisionForNode({
            typescript,
            node,
            destructuringAgreements,
            kinds: ['collection-reconstruction']
        });
        const { collection: callbackCollection = {} } = getObject(callbackOwner);
        const { callbackParameterOwned = false, selectionRanges = [] } = getObject(callbackCollection);

        // A completed operational callback owns this static receiver read at
        // its original update phase; numeric binding would acquire an iterator.
        if (callbackParameterOwned && selectionRanges.includes(getConsumerContractKey(node))) {
            return false;
        }

        const { agreement: restArrayAgreement = {}, contract: restArrayContract = {} } = getDestructuringDecisionForNode({
            typescript,
            node,
            destructuringAgreements,
            kinds: ['rest-array-fixed-selection']
        });
        const { action: restArrayAction = '' } = restArrayAgreement;
        const { captured: capturedRestRead = false } = getObject(restArrayContract);

        // A completed rest-array outcome owns this exact read. The direct-call
        // grammar binds it at the return; a retained closure keeps its later
        // read instead of acquiring an iterator or inventing an IIFE/default.
        if (restArrayAction === 'rest-array-fixed-selection' ||
            ['rest-array-staged-selection', 'rest-array-retained-index',
                'rest-array-retained-effect-order'].includes(restArrayAction) && capturedRestRead) {
            return false;
        }

        const {
            kind: nodeKind = 0,
            expression: nodeExpr = {},
            argumentExpression: nodeArg = {}
        } = getObject(node);
        const { kind: exprKind = 0 } = getObject(nodeExpr);
        const { kind: argumentKind = 0 } = getObject(nodeArg);

        if (nodeKind !== ElementAccessExpression ||
            !nodeExpr ||
            exprKind !== Identifier ||
            !nodeArg ||
            // A runtime key is a dynamic boundary.  Its read stays explicit so
            // getter timing, holes, out-of-range reads, and native failures
            // remain owned by the original expression.
            ![NumericLiteral, StringLiteral].includes(argumentKind) ||
            isWriteAccess(node, parent)) return false;

        const source = nodeExpr;
        const argument = nodeArg;
        const alias = factory.createUniqueName('_resilientIndex');
        const info = getPlacementContract({ typescript, node, placement });
        const { canonical: infoCanonical = '' } = info;
        const defaultInitializer = getDefaultInitializer({
            factory,
            canonical: infoCanonical
        });

        // No canonical family means this static index has no lawful binding
        // default. Preserve the source read rather than fabricating a throw.
        if (!defaultInitializer) return false;

        const binding = factory.createBindingElement(
            undefined,
            factory.createComputedPropertyName(argument),
            alias,
            defaultInitializer
        );
        const parameter = factory.createParameterDeclaration(
            undefined,
            undefined,
            factory.createObjectBindingPattern([binding]),
            undefined,
            undefined,
            // The source read throws on an absent receiver; a `{}` default would not.
            undefined
        );
        const arrow = factory.createArrowFunction(
            undefined,
            undefined,
            [parameter],
            undefined,
            factory.createToken(EqualsGreaterThanTokenKind7),
            alias
        );

        return factory.createCallExpression(
            factory.createParenthesizedExpression(arrow),
            undefined,
            [source]
        );
    };
    const getSourceAgreementReason = (source) => {
        const sourceInfo = getPlacementContract({ typescript, node: source, placement });
        const { kind: sourceInfoKind = '' } = sourceInfo;

        return getPlacementReason({ typescript, placement, node: source, kind: sourceInfoKind });
    };
    const getRuntimeGuardExpression = (kind, name) => {
        const value = factory.createIdentifier(name);

        if (kind === 'string') return factory.createBinaryExpression(
            factory.createTypeOfExpression(value),
            factory.createToken(ExclamationEqualsEqualsToken),
            factory.createStringLiteral('string', true)
        );

        if (kind === 'number') return factory.createBinaryExpression(
            factory.createTypeOfExpression(value),
            factory.createToken(ExclamationEqualsEqualsToken),
            factory.createStringLiteral('number', true)
        );

        if (kind === 'boolean') return factory.createBinaryExpression(
            factory.createTypeOfExpression(value),
            factory.createToken(ExclamationEqualsEqualsToken),
            factory.createStringLiteral('boolean', true)
        );

        if (kind === 'bigint') return factory.createBinaryExpression(
            factory.createTypeOfExpression(value),
            factory.createToken(ExclamationEqualsEqualsToken),
            factory.createStringLiteral('bigint', true)
        );

        if (kind === 'array') return factory.createPrefixUnaryExpression(
            ExclamationToken,
            arrayStandard
                ? factory.createCallExpression(factory.createIdentifier('isArray'), undefined, [value])
                : factory.createCallExpression(
                    factory.createPropertyAccessExpression(
                        factory.createIdentifier('Array'),
                        factory.createIdentifier('isArray')
                    ),
                    undefined,
                    [value]
                )
        );

        if (kind === 'object') {
            const typeMismatch = factory.createBinaryExpression(
                factory.createTypeOfExpression(value),
                factory.createToken(ExclamationEqualsEqualsToken),
                factory.createStringLiteral('object', true)
            );
            const nullValue = factory.createBinaryExpression(
                value,
                factory.createToken(ExclamationEqualsEqualsToken),
                factory.createNull()
            );
            const arrayValue = factory.createCallExpression(
                factory.createPropertyAccessExpression(
                    factory.createIdentifier('Array'),
                    factory.createIdentifier('isArray')
                ),
                undefined,
                [value]
            );
            const check = objectStandard
                ? factory.createCallExpression(factory.createIdentifier('isObject'), undefined, [value])
                : factory.createBinaryExpression(
                    factory.createBinaryExpression(typeMismatch, factory.createToken(BarBarTokenKind3), nullValue),
                    factory.createToken(BarBarTokenKind3),
                    arrayValue
                );

            return factory.createPrefixUnaryExpression(ExclamationToken, check);
        }

        if (kind === 'function') return factory.createPrefixUnaryExpression(
            ExclamationToken,
            functionStandard
                ? factory.createCallExpression(factory.createIdentifier('isFunction'), undefined, [value])
                : factory.createBinaryExpression(
                    factory.createTypeOfExpression(value),
                    factory.createToken(EqualsEqualsEqualsToken),
                    factory.createStringLiteral('function', true)
                )
        );

        return false;
    };
    const getRuntimeGuardStatements = (statement, canReturn = false) => {
        const { kind: statementKind = 0, declarationList = {} } = getObject(statement);

        if (!canReturn || statementKind !== VariableStatement) return [];

        const { declarations: declarationsInStatement = [] } = getObject(declarationList);

        return declarationsInStatement.flatMap((declaration = {}) => {
            const { name: pattern = {}, initializer: source = {} } = getObject(declaration);
            const factoryDecision = getFactoryBindingDecision(source);
            const {
                kind: patternKind = 0,
                elements = [],
                __resilientGuarded = false
            } = getObject(pattern);

            if (![ObjectBindingPattern, ArrayBindingPattern].includes(patternKind) || __resilientGuarded) return [];

            return elements.flatMap((element) => {
                const {
                    kind: elemKind = 0,
                    dotDotDotToken: elemDotDotDot = false,
                    name: elemName = {},
                    initializer: elemInit = undefined
                } = getObject(element);
                const { kind: elemNameKind = 0, text: elemNameText = '' } = getObject(elemName);

                if (!element ||
                    elemKind !== BindingElement ||
                    elemDotDotDot ||
                    !elemName ||
                    elemNameKind !== Identifier ||
                    elemInit) return [];

                if (patternKind === ObjectBindingPattern && isRequiredFactoryProperty(factoryDecision,
                    getBindingPropertyName({ typescript, node: element }))) return [];

                const kind = getBindingRuntimeGuardKind({ typescript, element, placement });
                const expression = getRuntimeGuardExpression(kind, elemNameText);

                if (!expression) return [];

                return [factory.createIfStatement(
                    expression,
                    factory.createReturnStatement(),
                    undefined
                )];
            });
        });
    };
    const getClosedProviderModelGuardStatements = (statement, canReturn = false) => {
        const { kind: statementKind = 0, declarationList = {} } = getObject(statement);
        const { declarations: declarationsInStatement = [] } = getObject(declarationList);
        const [declaration = {}] = declarationsInStatement;
        const {
            payload = {},
            collection = {},
            capability = '',
            evidence = []
        } = getClosedProviderModel(declaration);
        const { property: payloadProperty = '', alias: payloadAlias = '' } = getObject(payload);
        const { property: collectionProperty = '' } = getObject(collection);

        if (!canReturn || statementKind !== VariableStatement || !payloadProperty || !payloadAlias ||
            !collectionProperty || !capability) return [];

        const [reason = ''] = evidence;
        const fallback = factory.createObjectLiteralExpression([
            factory.createPropertyAssignment(
                factory.createIdentifier(payloadProperty),
                factory.createIdentifier(payloadAlias)
            ),
            factory.createPropertyAssignment(
                factory.createIdentifier(collectionProperty),
                factory.createArrayLiteralExpression([], false)
            )
        ], true);

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Shared Set publishes before guard construction; copying loses caller-visible records.
        agreements.add({
            action: 'guarded-closed-provider-model',
            state: 'resolved',
            owner: 'closed-model-producer',
            name: capability,
            site: 'final-closed-provider-consumer',
            sourceRange: getSourceRange({ typescript, node: declaration }),
            canonical: `{ ${payloadProperty}, ${collectionProperty}: [] }`,
            evidence: [reason]
        });

        return [factory.createIfStatement(
            getRuntimeGuardExpression('function', capability),
            factory.createReturnStatement(fallback),
            undefined
        )];
    };
    const isZero = (node) => {
        const { kind = 0, text = '' } = getObject(node);

        return node && kind === NumericLiteral && Number(text) === 0;
    };
    const isLength = (node) => {
        const { kind = 0, name = {} } = getObject(node);
        const { text = '' } = getObject(name);

        return node && kind === PropertyAccessExpression && ['length', 'size'].includes(text);
    };
    const getLength = (node) => {
        const { left = {}, right = {} } = getObject(node);

        return isLength(left) ? left : right;
    };
    const isLengthComparison = ({ left = {}, right = {}, kind: nodeKind = 0 } = {}) => {
        return nodeKind === BinaryExpression &&
        isLength(left) && isZero(right) ||
        nodeKind === BinaryExpression &&
        isZero(left) && isLength(right);
    };
    const isNonZeroLengthComparison = (node) => {
        const { operatorToken = {}, left = {} } = getObject(node);
        const { kind: operator = 0 } = getObject(operatorToken);

        return [ExclamationEqualsToken, ExclamationEqualsEqualsToken, GreaterThanToken].includes(operator) ||
            (operator === LessThanToken && isZero(left));
    };
    const isUndefinedIdentifier = (node) => {
        const { kind = 0, text = '' } = getObject(node);

        return kind === Identifier && text === 'undefined';
    };
    const isUndefinedLiteral = (node) => {
        const { kind = 0, text = '' } = getObject(node);

        return kind === StringLiteral && text === 'undefined';
    };
    const isUndefinedTypeof = (node) => {
        const { kind = 0 } = getObject(node);

        return kind === TypeOfExpression;
    };
    const isUndefinedTypeofTest = (left, right) => (
        (isUndefinedTypeof(left) && isUndefinedLiteral(right)) ||
        (isUndefinedTypeof(right) && isUndefinedLiteral(left))
    );
    const isUndefinedComparison = (node) => {
        const { kind = 0, left = {}, right = {}, operatorToken = {} } = getObject(node);
        const { kind: opKind = 0 } = getObject(operatorToken);
        const isEquality = [
            EqualsEqualsEqualsToken, ExclamationEqualsEqualsToken,
            EqualsEqualsToken, ExclamationEqualsToken
        ].includes(opKind);

        if (kind !== BinaryExpression || !isEquality) return false;

        return isUndefinedIdentifier(left) ||
            isUndefinedIdentifier(right) ||
            isUndefinedTypeofTest(left, right);
    };
    const retainsExactUndefinedSelector = (node = {}) => {
        const { agreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node,
            destructuringAgreements,
            kinds: ['arity-return-selector']
        });

        return getObject(agreement).action === 'retain-exact-undefined-selector' ||
            Boolean(getExactUndefinedReason({ typescript, node, placement }));
    };
    const isPositiveUndefinedComparison = (node) => {
        const { operatorToken = {} } = getObject(node);
        const { kind: opKind = 0 } = getObject(operatorToken);

        return [EqualsEqualsEqualsToken, EqualsEqualsToken].includes(opKind);
    };
    const getUndefinedTarget = (node) => {
        const { left = {}, right = {} } = getObject(node);
        const targetNode = isUndefinedIdentifier(left) || isUndefinedLiteral(left)
            ? right
            : left;
        const { expression = targetNode } = getObject(targetNode);

        return expression;
    };
    const lowerLengthComparison = (node) => {
        if (!isLengthComparison(node)) return false;

        const length = getLength(node);

        return isNonZeroLengthComparison(node)
            ? factory.createPrefixUnaryExpression(
                ExclamationToken,
                factory.createPrefixUnaryExpression(ExclamationToken, length)
            )
            : factory.createPrefixUnaryExpression(ExclamationToken, length);
    };
    const lowerUndefinedComparison = (node) => {
        if (!isUndefinedComparison(node) || retainsExactUndefinedSelector(node)) return false;

        const target = getUndefinedTarget(node);

        return isPositiveUndefinedComparison(node)
            ? factory.createPrefixUnaryExpression(ExclamationToken, target)
            : factory.createPrefixUnaryExpression(
                ExclamationToken,
                factory.createPrefixUnaryExpression(ExclamationToken, target)
            );
    };
    const hasNestedConditional = (node) => {
        let nested = false;
        const visit = (child) => {
            const { kind: childKind21 = 0 } = getObject(child);

            if (nested || !child) return;

            if (child !== node && childKind21 === ConditionalExpression) {
                nested = true;

                return;
            }

            typescript.forEachChild(child, visit);
        };

        visit(node);

        return nested;
    };
    const lowerConditional = (node) => {
        if (!hasNestedConditional(node)) return node;

        const { condition = {}, whenTrue = {}, whenFalse = {} } = getObject(node);
        const body = factory.createBlock([
            factory.createIfStatement(
                condition,
                factory.createReturnStatement(whenTrue)
            ),
            factory.createReturnStatement(whenFalse)
        ], true);
        const arrow = factory.createArrowFunction(
            undefined,
            undefined,
            [],
            undefined,
            factory.createToken(EqualsGreaterThanTokenKind7),
            body
        );

        return factory.createCallExpression(
            factory.createParenthesizedExpression(arrow),
            undefined,
            []
        );
    };
    const updateFinalBindingPattern = (pattern, source, guardedSource = false) => {
        const {
            kind: patternKind = 0,
            elements: patternElements = [],
            __resilientGuarded = false
        } = getObject(pattern);

        if (![ObjectBindingPattern, ArrayBindingPattern].includes(patternKind)) return pattern;

        // Earlier placement has already consumed this exact static read.  The
        // final binding pass may add family defaults to unresolved bindings,
        // but it must never re-decide a completed consumer/provider agreement.
        if (hasCompletedDestructuringAgreement({ typescript, node: source, destructuringAgreements })) return pattern;

        // Identity-only provider forwarding is a complete grammar agreement.
        // The callback parameter is an extraction mechanism, not a new
        // destructuring boundary with a default to decide.
        if (getObject(pattern).__resilientProviderForward) return pattern;

        if (patternKind === ArrayBindingPattern && __resilientGuarded) return pattern;

        const factoryDecision = getFactoryBindingDecision(source);
        const { evidence: factoryEvidence = [] } = factoryDecision;
        const allowOpaque = guardedSource ||
            generatedOpaqueSource(source) ||
            getSourceAgreementReason(source).startsWith('union branch');

        // A preceding tuple guard proves only container presence and arity.
        // It must not manufacture position defaults: present `undefined` is
        // still an exact tuple value owned by the callback contract.
        if (patternKind === ArrayBindingPattern && guardedSource) return pattern;

        const elements = patternElements.map((element, index) => {
            const {
                kind: elemKind = 0,
                dotDotDotToken: elemDotDotDot = false,
                initializer: elemInit = undefined,
                __resilientGuarded = false
            } = getObject(element);

            if (!element || elemKind !== BindingElement || elemDotDotDot) return element;

            const runtimeGuardKind = getBindingRuntimeGuardKind({ typescript, element, placement });
            const canonical = getBindingElementCanonical({ typescript, element, placement });
            const guardedKind = !canonical ? runtimeGuardKind : '';
            const bindingCanonical = patternKind === ObjectBindingPattern && !canonical && !guardedKind &&
                isStagedObjectSource(source) ? 'undefined' : canonical;
            const elementAllowsOpaque = allowOpaque || Boolean(__resilientGuarded);

            // A source initializer belongs to its own member and cannot be
            // replaced by later container, guard, or factory evidence.
            if (elemInit) return element;

            const propertyName = patternKind === ObjectBindingPattern
                ? getBindingPropertyName({ typescript, node: element })
                : String(index);
            const factoryAgreement = patternKind === ObjectBindingPattern &&
                isRequiredFactoryProperty(factoryDecision, propertyName);
            const agreementReason = !bindingCanonical
                ? getBindingAgreementReason({ typescript, element, placement })
                : '';
            const requiredAgreementReason = factoryAgreement ? factoryEvidence.join('; ') : agreementReason;
            const agreementName = patternKind === ObjectBindingPattern ? propertyName : `index ${index}`;
            const { initializer = undefined } = emitBindingAgreement({
                typescript,
                factory,
                decision: getBindingDecision({ agreement: getBindingAgreement({
                    canonical: bindingCanonical,
                    guarded: elementAllowsOpaque || Boolean(guardedKind),
                    required: patternKind === ObjectBindingPattern && factoryAgreement,
                    owner: patternKind === ObjectBindingPattern && factoryAgreement ? 'typeclass-factory' : 'caller',
                    evidence: requiredAgreementReason ? [requiredAgreementReason] : []
                }) }),
                // A generic tuple position may intentionally carry `undefined`
                // (for example State<S, A>'s S); its agreement stays caller-owned.
                name: agreementName,
                propertyName,
                agreements,
                site: patternKind === ObjectBindingPattern ? 'final-object-binding' : 'final-array-binding',
                sourceNode: element
            });

            return updateBindingInitializer({ factory, element, initializer });
        });

        return patternKind === ObjectBindingPattern
            ? factory.updateObjectBindingPattern(pattern, elements)
            : factory.updateArrayBindingPattern(pattern, elements);
    };
    const isSingleNestedIf = ({ elseStatement = false, thenStatement = {}, kind: nodeKind = 0 } = {}) => {
        const { kind: thenKind = 0, statements: thenStatements = [] } = getObject(thenStatement);
        const [firstStatement = {}] = thenStatements;
        const { kind: firstKind = 0, elseStatement: firstElse = false } = getObject(firstStatement);

        return nodeKind === IfStatement &&
        !elseStatement &&
        Boolean(thenStatement) &&
        thenKind === Block &&
        thenStatements.length === 1 &&
        firstKind === IfStatement &&
        !firstElse;
    };
    const lowerNestedIf = (node) => {
        if (!isSingleNestedIf(node)) return node;

        const { thenStatement = {}, expression: nodeExpr = {} } = getObject(node);
        const { statements: thenStatements = [] } = getObject(thenStatement);
        const [nested = {}] = thenStatements;
        const { expression: nestedExpr = {}, thenStatement: nestedThen = {} } = getObject(nested);
        const condition = factory.createBinaryExpression(
            nodeExpr,
            factory.createToken(AmpersandAmpersandToken),
            nestedExpr
        );

        return factory.updateIfStatement(
            node,
            condition,
            nestedThen,
            undefined
        );
    };
    const getAccumulatorAssignment = (statement, accumulatorKinds = new Map()) => {
        const { kind: statementKind = 0, expression = {} } = getObject(statement);

        if (statementKind !== ExpressionStatement) return statement;

        const {
            kind: expressionKind = 0, left = {}, operatorToken = {}, right = {},
            expression: callTarget = {}, arguments: args = []
        } = getObject(expression);
        const { kind: opTokenKind = 0 } = getObject(operatorToken);

        const { kind: callTargetKind = 0, expression: receiverExpr = {}, name: method = {} } = getObject(callTarget);
        const { kind: receiverExprKind = 0, text: receiverExprText = '' } = getObject(receiverExpr);
        const { text: methodText = '' } = getObject(method);
        const receiverRecord = accumulatorKinds.get(receiverExprText);
        const receiverKindType = getObject(receiverRecord).kind || receiverRecord;
        const { action: mutationAction = '', type: mutationType = '' } = getCollectionMutation(statement);
        const sourceOwnedCollection = mutationType.toLowerCase() === receiverKindType;
        const isOwnedMethodCall = expressionKind === CallExpressionKind3 &&
            callTargetKind === PropertyAccessExpression && receiverExprKind === Identifier &&
            Boolean(receiverKindType);
        const retainOperationalMutation = () => {
            const {
                addSyntheticLeadingComment = false,
                SyntaxKind: { SingleLineCommentTrivia = -1 } = {}
            } = typescript;

            if (typeof addSyntheticLeadingComment !== 'function') return statement;

            return addSyntheticLeadingComment(
                statement,
                SingleLineCommentTrivia,
                ' eslint-disable-next-line resilient/prefer-safe-transformations -- Owned Map/Set builder preserves source iterator staging and transfers only at return.',
                true
            );
        };

        if (isOwnedMethodCall && receiverKindType === 'array' && methodText === 'push') {
            const next = factory.createBinaryExpression(
                receiverExpr,
                factory.createToken(EqualsToken),
                factory.createArrayLiteralExpression([
                    factory.createSpreadElement(receiverExpr),
                    ...args
                ], true)
            );

            return factory.createExpressionStatement(next);
        }

        if (isOwnedMethodCall && receiverKindType === 'array' && methodText === 'splice') {
            const next = factory.createBinaryExpression(
                receiverExpr,
                factory.createToken(EqualsToken),
                factory.createCallExpression(
                    factory.createPropertyAccessExpression(receiverExpr, factory.createIdentifier('toSpliced')),
                    undefined,
                    args
                )
            );

            return factory.createExpressionStatement(next);
        }

        if (isOwnedMethodCall && receiverKindType === 'array' && methodText === 'sort') {
            const next = factory.createBinaryExpression(
                receiverExpr,
                factory.createToken(EqualsToken),
                factory.createCallExpression(
                    factory.createPropertyAccessExpression(receiverExpr, factory.createIdentifier('toSorted')),
                    undefined,
                    args
                )
            );

            return factory.createExpressionStatement(next);
        }

        const isOperationalCollectionBuilder = sourceOwnedCollection &&
            mutationAction === 'operational-collection-builder';
        const reconstructibleCollection = sourceOwnedCollection && [
            'single-collection-update',
            'fresh-copy-reconstruction',
            'fresh-collection-rebind',
            'materialized-collection-reduce'
        ].includes(mutationAction);

        if (isOwnedMethodCall && receiverKindType === 'set' && methodText === 'add' &&
            isOperationalCollectionBuilder) return retainOperationalMutation();

        if (isOwnedMethodCall && receiverKindType === 'set' && methodText === 'add' &&
            reconstructibleCollection) {
            return createCollectionAccumulatorRebind({
                typescript,
                collection: 'Set',
                receiver: receiverExpr,
                arguments: args
            }) || statement;
        }

        if (isOwnedMethodCall && receiverKindType === 'map' && methodText === 'set' &&
            isOperationalCollectionBuilder) return retainOperationalMutation();

        if (isOwnedMethodCall && receiverKindType === 'map' && methodText === 'set' &&
            reconstructibleCollection) {
            return createCollectionAccumulatorRebind({
                typescript,
                collection: 'Map',
                receiver: receiverExpr,
                arguments: args
            }) || statement;
        }

        if (expressionKind !== BinaryExpression ||
            !left ||
            opTokenKind !== EqualsToken) return statement;

        const target = left;
        const {
            expression: receiver = {},
            kind: targetKind = 0,
            name: targetName = {},
            argumentExpression: targetArg = {}
        } = getObject(target);
        const { kind: receiverKind = 0, text: receiverText = '' } = getObject(receiver);
        const { text: targetNameText = '' } = getObject(targetName);
        const isProperty = targetKind === PropertyAccessExpression;
        const isElement = targetKind === ElementAccessExpression;
        const targetReceiverRecord = accumulatorKinds.get(receiverText);
        const targetReceiverKind = getObject(targetReceiverRecord).kind || targetReceiverRecord;

        if (receiverKind !== Identifier || targetReceiverKind !== 'object' || (!isProperty && !isElement)) return statement;

        const propertyName = isProperty
            ? factory.createIdentifier(targetNameText)
            : factory.createComputedPropertyName(targetArg);
        const next = factory.createBinaryExpression(
            receiver,
            factory.createToken(EqualsToken),
            factory.createObjectLiteralExpression([
                factory.createSpreadAssignment(receiver),
                factory.createPropertyAssignment(propertyName, right)
            ], true)
        );

        return factory.createExpressionStatement(next);
    };
    const getEarlyReturnGuardSource = ({ elseStatement = false, expression = {}, thenStatement = {}, kind: statementKind = 0 } = {}) => {
        if (statementKind !== IfStatement || elseStatement) return '';

        const condition = expression || {};
        const { kind: conditionKind = 0 } = getObject(condition);

        if (conditionKind !== CallExpressionKind3) return '';

        const guardName = getCallExpressionName({ typescript, node: condition });

        if (!/^(?:_?[Ii]s[A-Z]|_?[Hh]as[A-Z]|is_)/.test(guardName)) return '';

        const body = thenStatement && getObject(thenStatement).kind === Block
            ? thenStatement
            : {};
        const { statements: bodyStatements = [] } = getObject(body);
        const returns = bodyStatements.some(({ kind = -1 } = {}) => kind === ReturnStatement);

        return returns ? getCallIdentifierArgument({ typescript, node: condition }) : '';
    };
    const getOwningVariableStatement = (candidate) => {
        const { kind = 0, parent = undefined } = getObject(candidate);

        if (!candidate || kind === VariableStatement) return candidate;

        return getOwningVariableStatement(parent);
    };
    const hasPriorEarlyReturnGuard = (node, sourceName) => {
        const statement = getOwningVariableStatement(node);

        const { parent: block = {} } = getObject(statement);
        const { kind: blockKind = 0, statements: blockStatements = [] } = getObject(block);
        const statements = blockKind === Block ? blockStatements : [];
        const statementIndex = statements.indexOf(statement);

        return statementIndex >= 0 && statements
            .slice(0, statementIndex)
            .some(candidate => getEarlyReturnGuardSource(candidate) === sourceName);
    };
    const hasPriorTupleGuard = (node, sourceName) => {
        const isIdentifier = (candidate = {}) => {
            const { kind = 0, text = '' } = getObject(candidate);

            return kind === Identifier && text === sourceName;
        };
        const isNotCall = (candidate = {}, name = '') => {
            const { kind = 0, operator = {}, operand = {} } = getObject(candidate);
            const { kind: operatorKind = 0 } = getObject(operator);
            const { kind: operandKind = 0, expression = {}, arguments: args = [] } = getObject(operand);
            const { kind: expressionKind = 0, text = '' } = getObject(expression);
            const [argument = {}] = args;

            return kind === PrefixUnaryExpression && operatorKind === ExclamationToken &&
                operandKind === CallExpression && expressionKind === Identifier && text === name && isIdentifier(argument);
        };
        const isShort = (candidate = {}) => {
            const { kind = 0, operatorToken = {}, left = {}, right = {} } = getObject(candidate);
            const { kind: operatorKind = 0 } = getObject(operatorToken);
            const { kind: leftKind = 0, expression = {}, name = {} } = getObject(left);
            const { text: receiver = '' } = getObject(expression);
            const { text: property = '' } = getObject(name);
            const { kind: rightKind = 0, text = '' } = getObject(right);

            return kind === BinaryExpression && operatorKind === LessThanToken &&
                leftKind === PropertyAccessExpression && receiver === sourceName && property === 'length' &&
                rightKind === NumericLiteral && Number(text) > 1;
        };
        const isCanonicalReturn = (candidate = {}) => {
            const { kind = 0, expression = {} } = getObject(candidate);
            const { kind: expressionKind = 0, elements = [], properties = [], text = '' } = getObject(expression);

            return kind === ReturnStatement && (
                expressionKind === ArrayLiteralExpressionKind2 && !elements.length ||
                expressionKind === ObjectLiteralExpressionKind2 && !properties.length ||
                expressionKind === StringLiteral && text === '' ||
                expressionKind === NumericLiteral && Number(text) === 0 ||
                expressionKind === FalseKeyword
            );
        };
        const isTupleGuard = (candidate = {}) => {
            const { kind = 0, expression = {}, thenStatement = {} } = getObject(candidate);
            const { kind: expressionKind = 0, operatorToken = {}, left = {}, right = {} } = getObject(expression);
            const { kind: operatorKind = 0 } = getObject(operatorToken);
            const { kind: bodyKind = 0, statements = [] } = getObject(thenStatement);
            const [returned = {}] = statements;
            const content = isNotCall(expression, 'hasArrayContent');
            const arity = expressionKind === BinaryExpression && operatorKind === BarBarTokenKind3 &&
                ((isNotCall(left, 'isArray') && isShort(right)) || (isNotCall(right, 'isArray') && isShort(left)));

            return kind === IfStatement && (content || arity) && bodyKind === Block &&
                statements.length === 1 && isCanonicalReturn(returned);
        };
        const statement = getOwningVariableStatement(node);
        const { parent: block = {} } = getObject(statement);
        const { kind: blockKind = 0, statements = [] } = getObject(block);
        const index = statements.indexOf(statement);
        const [previous = {}] = statements.slice(index - 1, index);

        return blockKind === Block && index > 0 && isTupleGuard(previous);
    };
    const lowerAccumulatorBlock = (
        block, inheritedAccumulators = new Map(), canReturn = false, inheritedGuards = new Set()
    ) => {
        const { statements: blockStatements = [] } = getObject(block);
        let localAccumulators = new Map();
        blockStatements.forEach(({ declarationList = {}, kind: statementKind = 0 } = {}) => {
            const { declarations: decls = [] } = getObject(declarationList);

            if (statementKind !== VariableStatement ||
                !declarationList ||
                decls.length !== 1) return;

            const [declaration = {}] = decls;
            const { initializer = {}, name: declName = {} } = getObject(declaration);
            const { kind: initKind = 0, expression: initExpr = {}, arguments: initArgs = [] } = getObject(initializer);
            const { kind: initExprKind = 0, text: initExprText = '', name: initExprName = {}, expression: initExprRec = {} } = getObject(initExpr);
            const { text: initExprNameText = '' } = getObject(initExprName);
            const { text: initExprRecText = '' } = getObject(initExprRec);
            const isObjectLiteral = initKind === ObjectLiteralExpressionKind2;
            const isArrayLiteral = initKind === ArrayLiteralExpressionKind2 ||
                (initKind === CallExpressionKind3 && (
                    ['fromReadonlyNonEmptyArray', 'fromArray', 'copy', 'Array'].includes(initExprText) ||
                    ['fromReadonlyNonEmptyArray', 'fromArray', 'copy', 'Array', 'slice'].includes(initExprNameText) ||
                    (initExprKind === PropertyAccessExpression && initExprRecText === 'Array' && initExprNameText === 'from')
                ));
            const isSet = initKind === NewExpression && initExprKind === Identifier && initExprText === 'Set' && !initArgs.length;
            const isMap = initKind === NewExpression && initExprKind === Identifier && initExprText === 'Map' && !initArgs.length;
            const getAccumulatorKind = () => {
                if (isObjectLiteral) return 'object';

                if (isArrayLiteral) return 'array';

                if (isSet) return 'set';

                if (isMap) return 'map';

                return '';
            };
            const kind = getAccumulatorKind();

            if (!kind) return;

            getBindingNames({ typescript, node: declName }).forEach((name) => {
                localAccumulators = new Map([...localAccumulators, [name, kind]]);
            });
        });
        const accumulatorKinds = new Map([...inheritedAccumulators, ...localAccumulators]);
        const guardedSources = new Set(inheritedGuards);
        const sourceAliases = new Map();
        const addGuardedSource = (source) => {
            if (!source) return;

            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private guard Set carries earlier sibling facts into later visits.
            guardedSources.add(source);
            sourceAliases.forEach((root, alias) => {
                // eslint-disable-next-line resilient/prefer-safe-transformations -- Private guard Set publishes matching aliases in insertion order.
                if (root === source) guardedSources.add(alias);
            });
        };
        const recordSourceAliases = ({ declarationList = {}, kind: statementKind = 0 } = {}) => {
            if (statementKind !== VariableStatement) return;

            const { declarations: decls = [] } = getObject(declarationList);
            const [declaration = {}] = decls;
            const { name: pattern = {}, initializer: source = {} } = getObject(declaration);
            const { kind: patternKind = 0, elements = [] } = getObject(pattern);
            const { kind: sourceKind = 0, text: sourceText = '' } = getObject(source);

            if (patternKind !== ObjectBindingPattern || sourceKind !== Identifier) return;

            elements.forEach((element) => {
                const { dotDotDotToken = false, name: elemName = {} } = getObject(element);
                const { kind: elemNameKind = 0, text: elemNameText = '' } = getObject(elemName);

                if (!element || dotDotDotToken) return;

                const alias = elemNameKind === Identifier
                    ? elemNameText
                    : '';

                // eslint-disable-next-line resilient/prefer-safe-transformations -- Private alias Map keeps last-write values and first-insertion order.
                if (alias) sourceAliases.set(alias, sourceText);
            });
        };
        const statements = blockStatements.flatMap((statement) => {
            // Resolve an owned object builder before visiting its indexed write.
            // Otherwise the indexed-write fallback turns it into Object.assign
            // and erases the functional reconstruction shape.
            const ownedAssignment = getAccumulatorAssignment(statement, accumulatorKinds);
            // eslint-disable-next-line no-use-before-define -- Visitor receives the active traversal state.
            const visited = visit(ownedAssignment, block, accumulatorKinds, guardedSources);
            const source = getEarlyReturnGuardSource(statement);

            recordSourceAliases(visited);
            addGuardedSource(source);

            return [
                visited,
                ...getClosedProviderModelGuardStatements(statement, canReturn),
                ...getRuntimeGuardStatements(visited, canReturn)
            ];
        });
        const lowered = statements;
        // A name matching an accumulator's initial shape does not mean it is
        // still mutated after collections.js's own passes may have already
        // replaced the loop with a pure expression; only an actual `name = ...`
        // reassignment left in the block justifies keeping the binding `let`.
        const isAccumulatorReassignment = (candidate, name) => {
            const { kind: candidateKind = 0, operatorToken: { kind: operatorKind = 0 } = {}, left = {} } = getObject(candidate);
            const { kind: leftKind = 0, text: leftText = '' } = getObject(left);
            const isDirectReassignment = candidateKind === BinaryExpression &&
                operatorKind === EqualsToken &&
                leftKind === Identifier &&
                leftText === name;

            if (isDirectReassignment) return true;

            let foundInChildren = false;

            typescript.forEachChild(candidate, (child) => {
                foundInChildren = foundInChildren || isAccumulatorReassignment(child, name);
            });

            return foundInChildren;
        };
        const mutatedAccumulatorNames = new Set([...localAccumulators.keys()].filter(name => (
            lowered.some(statement => isAccumulatorReassignment(statement, name))
        )));
        const reassigned = mutatedAccumulatorNames.size
            ? lowered.map((statement) => {
                const { kind: statementKind = 0, declarationList = {}, modifiers = undefined } = getObject(statement);

                if (statementKind !== VariableStatement) return statement;

                const { declarations = [] } = getObject(declarationList);
                const [firstDecl = {}] = declarations;
                const { name: firstDeclName = {} } = getObject(firstDecl);
                const declarationNames = getBindingNames({
                    typescript,
                    node: firstDeclName
                });
                const hasAccumulator = declarationNames.some(name => mutatedAccumulatorNames.has(name));

                if (!hasAccumulator) return statement;

                const list = factory.createVariableDeclarationList(
                    declarations,
                    LetKind2
                );

                return factory.updateVariableStatement(statement, modifiers, list);
            })
            : lowered;

        return factory.updateBlock(block, reassigned);
    };
    const lowerVisitedVariableDeclaration = (visited, node, guardedSources) => {
        const {
            initializer: visitedInit = {},
            name: visitedName = {},
            exclamationToken: visitedExclamation = undefined,
            type: visitedType = undefined
        } = getObject(visited);
        const { kind: nameKind = 0, text: nameText = '' } = getObject(visitedName);
        const { kind: initKind = 0, text: initText = '', expression: initReceiver = {}, name: initProp = {} } = getObject(visitedInit);
        const { kind: initReceiverKind = 0, text: initReceiverText = '' } = getObject(initReceiver);
        const { kind: initPropKind = 0, text: initPropText = '' } = getObject(initProp);

        const { agreement: providerAgreement = {}, contract: providerEdge = {} } = getDestructuringDecision({
            destructuringAgreements,
            key: getConsumerContractKey(node),
            kinds: ['provider-edge']
        });
        const { action: providerAction = '' } = providerAgreement;
        const {
            factory: recordedFactory = '',
            member: providerMember = '',
            typeText: providerType = '',
            evidence: providerEvidence = []
        } = providerEdge;
        const [providerReason = ''] = providerEvidence;
        const {
            member: closedProviderMember = '',
            capability: closedProviderCapability = '',
            action: closedProviderAction = ''
        } = getClosedProviderModel(node);

        if (closedProviderAction === 'guarded-closed-provider-model' && closedProviderMember && closedProviderCapability) {
            const binding = factory.createBindingElement(
                undefined,
                closedProviderMember === closedProviderCapability
                    ? undefined
                    : factory.createIdentifier(closedProviderMember),
                factory.createIdentifier(closedProviderCapability),
                undefined
            );
            const pattern = markGuardedNode(factory.createObjectBindingPattern([binding]));

            return factory.updateVariableDeclaration(
                visited,
                pattern,
                visitedExclamation,
                visitedType,
                initReceiver
            );
        }

        if (providerAction === 'slang-required-function-provider-edge' && recordedFactory && providerMember) {
            const binding = factory.createBindingElement(
                undefined,
                providerMember === nameText ? undefined : factory.createIdentifier(providerMember),
                factory.createIdentifier(nameText),
                undefined
            );
            const declaration = factory.updateVariableDeclaration(
                visited,
                factory.createObjectBindingPattern([binding]),
                visitedExclamation,
                visitedType,
                initReceiver
            );

            // eslint-disable-next-line resilient/prefer-safe-transformations -- Shared Set publishes before annotation; copying loses caller-visible records.
            agreements.add({
                action: 'slang-required-function-provider-edge',
                state: 'preserve',
                owner: 'provider-caller',
                name: providerMember,
                site: 'final-provider-edge',
                sourceRange: getSourceRange({ typescript, node: visited }),
                factory: recordedFactory,
                typeText: providerType,
                evidence: [providerReason],
                next: 'resolve callability at the actual consumer'
            });

            return annotateAgreementException({
                typescript,
                node: declaration,
                reason: providerReason
            });
        }

        const { agreement: cardinalityAgreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node: visitedInit,
            destructuringAgreements,
            kinds: ['array-cardinality']
        });

        if (getObject(cardinalityAgreement).action === 'retain-array-cardinality-read') return visited;

        const { contract: callbackOwner = {} } = getDestructuringDecisionForNode({
            typescript,
            node: visitedInit,
            destructuringAgreements,
            kinds: ['collection-reconstruction']
        });
        const { collection: callbackCollection = {} } = getObject(callbackOwner);
        const { callbackParameterOwned = false, aliasReadRange = '' } = getObject(callbackCollection);

        // The completed operational agreement owns this source-time alias
        // read. A same-statement binding preserves the Get, but the callback
        // provider has not established a fallback value for this field.
        if (callbackParameterOwned && aliasReadRange === getConsumerContractKey(visitedInit) &&
            nameKind === Identifier && initKind === PropertyAccessExpression &&
            initReceiverKind === Identifier && initPropKind === Identifier) {
            const binding = factory.createBindingElement(
                undefined,
                initPropText === nameText ? undefined : factory.createIdentifier(initPropText),
                factory.createIdentifier(nameText),
                undefined
            );

            return factory.updateVariableDeclaration(
                visited,
                factory.createObjectBindingPattern([binding]),
                visitedExclamation,
                visitedType,
                initReceiver
            );
        }

        if (nameKind === Identifier &&
            initKind === PropertyAccessExpression &&
            initReceiverKind === Identifier &&
            initPropKind === Identifier &&
            !['arguments', 'window', 'globalThis', 'process', 'console'].includes(initReceiverText)) {
            const propertyName = initPropText;
            const alias = nameText;
            const agreement = getPlacementBindingDecision({ typescript, node: visitedInit, placement });
            const { state: agreementState = 'unknown' } = agreement;
            const shouldRetain = ['unknown', 'contradictory'].includes(agreementState);

            // An unresolved member is not a destructuring contract. Retain it
            // so the rule remains visible instead of disguising uncertainty.
            const { initializer: defaultInit = undefined, record = {} } = shouldRetain
                ? {}
                : emitBindingAgreement({
                    typescript,
                    factory,
                    decision: agreement,
                    name: propertyName,
                    sourceName: initReceiverText,
                    propertyName,
                    agreements,
                    site: 'final-static-member',
                    sourceNode: visited
                });
            const bindingElement = propertyName === alias
                ? factory.createBindingElement(undefined, undefined, factory.createIdentifier(alias), defaultInit)
                : factory.createBindingElement(undefined, factory.createIdentifier(propertyName), factory.createIdentifier(alias), defaultInit);
            const pattern = factory.createObjectBindingPattern([bindingElement]);
            const declaration = factory.updateVariableDeclaration(
                visited,
                pattern,
                visitedExclamation,
                visitedType,
                initReceiver
            );
            const { action = '', evidence = [] } = record;
            const [reason = ''] = evidence;

            const annotated = action === 'preserve'
                ? annotateAgreementException({ typescript, node: declaration, reason })
                : declaration;

            return shouldRetain ? visited : annotated;
        }

        const sourceName = initKind === Identifier ? initText : '';
        const tupleGuarded = hasPriorTupleGuard(node, sourceName);
        const pattern = updateFinalBindingPattern(
            visitedName,
            visitedInit,
            tupleGuarded || guardedSources.has(sourceName) || hasPriorEarlyReturnGuard(node, sourceName)
        );

        return pattern === visitedName
            ? visited
            : factory.updateVariableDeclaration(
                visited,
                pattern,
                visitedExclamation,
                visitedType,
                visitedInit
            );
    };
    const lowerVisitedCallExpression = (visited) => {
        const { expression: callTarget = {}, arguments: callArgs = [] } = getObject(visited);
        const { kind: targetKind = 0, expression: receiver = {}, name: method = {} } = getObject(callTarget);
        const { text: methodName = '' } = getObject(method);
        const { contract: collectionContract = {} } = getDestructuringDecisionForNode({
            typescript,
            node: visited,
            destructuringAgreements,
            kinds: ['collection-reconstruction']
        });

        if (getObject(collectionContract).operationRole === 'set-visitation-sort') return visited;

        if (targetKind === PropertyAccessExpression && methodName === 'sort') {
            return factory.createCallExpression(
                factory.createPropertyAccessExpression(receiver, factory.createIdentifier('toSorted')),
                undefined,
                callArgs
            );
        }

        if (targetKind === PropertyAccessExpression && methodName === 'splice') {
            return factory.createCallExpression(
                factory.createPropertyAccessExpression(receiver, factory.createIdentifier('toSpliced')),
                undefined,
                callArgs
            );
        }

        return visited;
    };
    const lowerVisitedReturnStatement = (visited) => {
        const { expression: returnExpr = {} } = getObject(visited);
        const { kind: returnExprKind = 0, text: returnExprText = '' } = getObject(returnExpr);

        if ((returnExprKind === Identifier && returnExprText === 'undefined') || returnExprKind === VoidExpression) {
            return factory.createReturnStatement(undefined);
        }

        return visited;
    };
    const visitChildren = (node, accumulatorKinds, guardedSources, canReturn) => typescript.visitEachChild(
        node,
        // eslint-disable-next-line no-use-before-define -- The deferred recursive callback forwards exact traversal state after visit is initialized.
        child => visit(child, node, accumulatorKinds, guardedSources, canReturn),
        context
    );
    const visit = (node, parent = {}, accumulatorKinds = new Map(), guardedSources = new Set(), ...visitOptions) => {
        const [canReturn = false] = visitOptions;

        if (!node) return node;

        const { kind: nodeKind = 0 } = node;

        if (nodeKind === Parameter) return node;

        if (isCompletedLiveCollectionLoop({ typescript, node, destructuringAgreements })) return node;

        if (nodeKind === Block) {
            return lowerAccumulatorBlock(
                node,
                accumulatorKinds,
                canReturn,
                guardedSources
            );
        }

        if (functionKinds.includes(nodeKind)) return visitChildren(
            node, accumulatorKinds, guardedSources, true
        );

        if (nodeKind === VariableStatement) {
            const { declarationList = {} } = getObject(node);
            const { declarations = [] } = getObject(declarationList);
            const callbackOwnedAlias = declarations.some(({ initializer = {} } = {}) => {
                const { contract = {} } = getDestructuringDecisionForNode({
                    typescript,
                    node: initializer,
                    destructuringAgreements,
                    kinds: ['collection-reconstruction']
                });
                const { collection = {} } = getObject(contract);
                const { callbackParameterOwned = false, aliasReadRange = '' } = getObject(collection);

                return callbackParameterOwned && aliasReadRange === getConsumerContractKey(initializer);
            });
            const retainedCardinality = declarations.some(({ initializer = {} } = {}) => {
                const { agreement = {} } = getDestructuringDecisionForNode({
                    typescript,
                    node: initializer,
                    destructuringAgreements,
                    kinds: ['array-cardinality']
                });

                return getObject(agreement).action === 'retain-array-cardinality-read';
            });
            const visited = visitChildren(node, accumulatorKinds, guardedSources, canReturn);

            const retainedCallbackAlias = callbackOwnedAlias && typeof addSyntheticLeadingComment === 'function'
                ? addSyntheticLeadingComment(
                    visited,
                    SingleLineCommentTrivia,
                    ' eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Provider-owned field has no source fallback; absence must remain undefined.',
                    true
                )
                : false;

            return retainedCallbackAlias || (retainedCardinality && typeof addSyntheticLeadingComment === 'function'
                ? addSyntheticLeadingComment(visited, SingleLineCommentTrivia,
                    ' eslint-disable-next-line prefer-destructuring -- standard array cardinality retains its native length Get.', true)
                : visited);
        }

        if (nodeKind === VariableDeclaration) {
            const visited = visitChildren(node, accumulatorKinds, guardedSources, canReturn);

            return lowerVisitedVariableDeclaration(visited, node, guardedSources);
        }

        if (nodeKind === ElementAccessExpression) {
            const visited = visitChildren(node, accumulatorKinds, guardedSources, canReturn);
            const indexedRead = getIndexedRead(visited, parent);

            return indexedRead || visited;
        }

        if (nodeKind === BinaryExpression) {
            const visited = visitChildren(node, accumulatorKinds, guardedSources, canReturn);

            const indexedAssignment = getIndexedAssignment(node);

            return lowerLengthComparison(visited) ||
                lowerUndefinedComparison(visited) ||
                indexedAssignment ||
                visited;
        }

        if (nodeKind === DeleteExpression) {
            const visited = visitChildren(node, accumulatorKinds, guardedSources, canReturn);
            const lowerDelete = () => {
                const { expression: nodeExpr = {} } = getObject(node);
                const {
                    kind: targetKind = 0,
                    expression: targetExpr = {},
                    argumentExpression: targetArg = {}
                } = getObject(nodeExpr);
                const { kind: targetExprKind = 0 } = getObject(targetExpr);

                if (targetKind !== ElementAccessExpression ||
                    !targetExpr ||
                    targetExprKind !== Identifier) return visited;

                return factory.createCallExpression(
                    factory.createPropertyAccessExpression(
                        factory.createIdentifier('Reflect'),
                        factory.createIdentifier('deleteProperty')
                    ),
                    undefined,
                    [targetExpr, targetArg]
                );
            };

            return lowerDelete();
        }

        if (nodeKind === CallExpression) {
            const visited = visitChildren(node, accumulatorKinds, guardedSources, canReturn);

            return lowerVisitedCallExpression(visited);
        }

        if (nodeKind === ConditionalExpression) {
            const visited = visitChildren(node, accumulatorKinds, guardedSources, canReturn);

            return lowerConditional(visited);
        }

        if (isLengthComparison(node)) {
            const visited = visitChildren(node, accumulatorKinds, guardedSources, canReturn);
            const length = getLength(visited);

            return isNonZeroLengthComparison(visited)
                ? factory.createPrefixUnaryExpression(
                    ExclamationToken,
                    factory.createPrefixUnaryExpression(ExclamationToken, length)
                )
                : factory.createPrefixUnaryExpression(ExclamationToken, length);
        }

        if (isUndefinedComparison(node)) {
            const visited = visitChildren(node, accumulatorKinds, guardedSources, canReturn);

            return lowerUndefinedComparison(visited) || visited;
        }

        const { agreement: terminalReturnAgreement = {} } = nodeKind === ReturnStatement
            ? getDestructuringDecisionForNode({
                typescript,
                node,
                destructuringAgreements,
                kinds: ['switch-terminal-bare-return']
            }) : {};

        if (getObject(terminalReturnAgreement).action === 'normalize-terminal-bare-return') {
            // eslint-disable-next-line resilient/prefer-falsey-returns -- AST visitor omits only the proved terminal bare return.
            return undefined;
        }

        if (nodeKind === ReturnStatement) {
            const { expression: declaredExpression = {} } = getObject(node);
            const { agreement: declaredResultAgreement = {} } = getDestructuringDecisionForNode({
                typescript,
                node: declaredExpression,
                destructuringAgreements,
                kinds: ['declared-nullish-result']
            });
            const visited = visitChildren(node, accumulatorKinds, guardedSources, canReturn);

            return getObject(declaredResultAgreement).action === 'retain-declared-undefined-result'
                ? visited : lowerVisitedReturnStatement(visited);
        }

        if (nodeKind === IfStatement) {
            const visited = visitChildren(node, accumulatorKinds, guardedSources, canReturn);

            return lowerNestedIf(visited);
        }

        return visitChildren(node, accumulatorKinds, guardedSources, canReturn);
    };

    return typescript.visitNode(sourceFile, visit);
};

const annotateFinalExceptions = ({
    typescript = {},
    sourceFile = {},
    destructuringAgreements = {},
    placement = {},
    context = {}
} = {}) => {
    const {
        ArrayBindingPattern = -1,
        ArrowFunction = -1,
        Block = -1,
        CallExpression = -1,
        FunctionDeclaration = -1,
        FunctionExpression = -1,
        Identifier = -1,
        IfStatement = -1,
        ObjectBindingPattern = -1,
        Parameter = -1,
        PrefixUnaryExpression = -1,
        ReturnStatement = -1,
        VariableStatement = -1,
        SingleLineCommentTrivia = -1
    } = getSyntaxKinds(typescript);
    const {
        factory = {},
        addSyntheticLeadingComment = false,
        getSyntheticLeadingComments = false
    } = typescript;
    const functionKinds = [ArrowFunction, FunctionDeclaration, FunctionExpression];
    const add = (node, rules = '', reason = '') => {
        if (!node || !rules || !reason || typeof addSyntheticLeadingComment !== 'function') return node;

        const comments = typeof getSyntheticLeadingComments === 'function'
            ? getSyntheticLeadingComments(node) || []
            : [];
        const directive = `eslint-disable-next-line ${rules}`;
        const exists = comments.some(({ text = '' } = {}) => text.includes(directive));

        return exists
            ? node
            : addSyntheticLeadingComment(
                node,
                SingleLineCommentTrivia,
                ` ${directive} -- ${reason}`,
                true
            );
    };
    const getRequiredTupleReason = (node = {}) => {
        const { agreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node,
            destructuringAgreements,
            kinds: ['required-tuple-binding']
        });
        const { action = '' } = agreement;

        return action === 'retain-required-tuple-binding'
            ? 'required tuple retains native missing-value failure'
            : '';
    };
    const contains = (node, name = '') => {
        let found = false;
        const visit = (child) => {
            if (found || !child) return;

            const { kind: childKind = 0, text: childText = '' } = getObject(child);

            if (childKind === Identifier && childText === name) {
                found = true;

                return;
            }

            typescript.forEachChild(child, visit);
        };

        visit(node);

        return found;
    };
    const getBindingSource = ({ declarationList = {}, kind: statementKind = 0 } = {}) => {
        if (statementKind !== VariableStatement) return '';

        const { declarations = [] } = getObject(declarationList);
        const [declaration = {}] = declarations;
        const { name: declName = {}, initializer: declInit = {} } = getObject(declaration);
        const { kind: declNameKind = 0 } = getObject(declName);
        const { kind: declInitKind = 0, text: declInitText = '' } = getObject(declInit);

        return declNameKind === ObjectBindingPattern && declInitKind === Identifier
            ? declInitText
            : '';
    };
    const getDiscriminantBinding = ({ declarationList = {}, kind: statementKind = 0 } = {}) => {
        if (statementKind !== VariableStatement) return {};

        const { declarations = [] } = getObject(declarationList);
        const [declaration = {}] = declarations;
        const { name: pattern = {}, initializer = {} } = getObject(declaration);
        const { kind: patternKind = 0, elements = [] } = getObject(pattern);
        const { kind: initializerKind = 0, text: source = '' } = getObject(initializer);

        if (patternKind !== ObjectBindingPattern || initializerKind !== Identifier || !source) return {};

        const element = elements.find((candidate = {}) => {
            const { propertyName = {}, name = {} } = getObject(candidate);
            const { text: property = '' } = getObject(propertyName);
            const { text: binding = '' } = getObject(name);

            return ['_tag', 'tag'].includes(property || binding);
        }) || {};
        const { name = {} } = getObject(element);
        const { text: tag = '' } = getObject(name);

        return tag ? { source, tag } : {};
    };
    const getSelectedPayloadSource = (statement = {}, selectedSources = new Set()) => {
        const { kind: statementKind = 0, declarationList = {} } = getObject(statement);
        const { declarations = [] } = getObject(declarationList);

        if (statementKind !== VariableStatement) return '';

        return declarations.reduce((found, declaration = {}) => {
            if (found) return found;

            const { name: pattern = {}, initializer = {} } = getObject(declaration);
            const { kind: patternKind = 0, elements = [] } = getObject(pattern);
            const { kind: initializerKind = 0, text: source = '' } = getObject(initializer);
            const hasPayload = elements.some((element = {}) => {
                const { propertyName = {}, name = {} } = getObject(element);
                const { text: property = '' } = getObject(propertyName);
                const { text: binding = '' } = getObject(name);

                return ['value', 'left', 'right'].includes(property || binding);
            });

            return patternKind === ObjectBindingPattern && initializerKind === Identifier &&
                selectedSources.has(source) && hasPayload ? source : '';
        }, '');
    };
    const getTerminatingSelectedSource = (statement = {}, tags = new Map()) => {
        const { kind: statementKind = 0, expression = {}, thenStatement = {} } = getObject(statement);
        const { kind: thenKind = 0, statements = [] } = getObject(thenStatement);
        const [first = {}] = statements;
        const directReturn = getObject(thenStatement).kind === ReturnStatement;
        const terminates = directReturn || (thenKind === Block && getObject(first).kind === ReturnStatement);

        if (statementKind !== IfStatement || !terminates) return '';

        return [...tags.entries()].reduce((found, [tag = '', source = ''] = []) => (
            found || (tag && contains(expression, tag) ? source : '')
        ), '');
    };
    const getGuardNames = ({ expression = {}, kind: statementKind = 0 } = {}, sources = new Map()) => {
        if (statementKind !== IfStatement) return [];

        const names = new Set();
        const { kind: expressionKind = 0, operand = {} } = getObject(expression);
        const guardExpression = expressionKind === PrefixUnaryExpression ? operand : expression;

        const name = getCallIdentifierArgument({
            typescript,
            node: guardExpression
        });

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private name Set records the direct name before alias scans and deduplicates it.
        if (name) names.add(name);

        sources.forEach((source, binding) => {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private name Set records matching aliases in live Map visitation order.
            if (contains(expression, binding)) names.add(source);
        });

        return [...names];
    };
    const getCallReason = (statement) => {
        let reason = '';
        const visit = (child) => {
            const { kind: childKind23 = 0 } = getObject(child);
            const { kind: stmtKind = 0 } = getObject(statement);

            if (reason || !child) return;

            if (child !== statement &&
                functionKinds.includes(childKind23) &&
                stmtKind !== VariableStatement) return;

            if (stmtKind === VariableStatement && childKind23 === Block) return;

            if (childKind23 !== CallExpression) {
                typescript.forEachChild(child, visit);

                return;
            }

            const { agreement: typedCall = {} } = getDestructuringDecisionForNode({
                typescript,
                node: child,
                destructuringAgreements,
                kinds: ['typed-ignored-argument-call']
            });

            if (getObject(typedCall).action === 'retain-typed-ignored-argument-call') {
                reason = 'checker-declared parameters are ignored by the zero-parameter source implementation';

                return;
            }

            if (getObject(typedCall).action === 'retain-typed-extra-argument-call') {
                reason = 'checker-resolved authored callable accepts arguments beyond the source implementation formals';

                return;
            }

            typescript.forEachChild(child, visit);
        };

        visit(statement);

        return reason;
    };
    const getPatternAgreementReason = (pattern) => {
        const { __resilientExactTuplePosition = false, elements = [] } = getObject(pattern);
        const exactPositionReason = __resilientExactTuplePosition
            ? 'checker-proven static tuple position preserves the source undefined result without normalizing its container'
            : '';

        return elements.reduce((found, element = {}) => {
            const { __resilientAgreement = '', name: elementName = {} } = getObject(element);

            return found || __resilientAgreement || getPatternAgreementReason(elementName);
        }, exactPositionReason);
    };
    const getPatternTimingReason = (pattern) => {
        const {
            __resilientCollectionTimingBoundary = false,
            elements = []
        } = getObject(pattern);

        if (__resilientCollectionTimingBoundary) {
            return 'source-time tuple read follows its owning collection copy';
        }

        return elements.reduce((found, element = {}) => {
            const { name: elementName = {} } = getObject(element);

            return found || getPatternTimingReason(elementName);
        }, '');
    };
    // Only this statement's own patterns; a nested function owns its own line.
    const getRetainedAgreementReason = (statement) => {
        const {
            kind: statementKind = 0,
            declarationList = {},
            parameters: declaredParameters = []
        } = getObject(statement);
        const { declarations = [] } = getObject(declarationList);
        const patterns = statementKind === VariableStatement
            ? declarations.flatMap((declaration = {}) => {
                const { name = {}, initializer = {} } = getObject(declaration);
                const { parameters = [] } = getObject(initializer);

                return [name, ...parameters.map((parameter = {}) => getObject(parameter).name)];
            })
            : declaredParameters.map((parameter = {}) => getObject(parameter).name);

        return patterns.reduce((found, pattern) => found || getPatternAgreementReason(pattern), '');
    };
    const getStatementTimingReason = (statement) => {
        const {
            kind: statementKind = 0,
            declarationList = {},
            parameters: declaredParameters = []
        } = getObject(statement);
        const { declarations = [] } = getObject(declarationList);
        const patterns = statementKind === VariableStatement
            ? declarations.map(({ name = {} } = {}) => name)
            : declaredParameters.map((parameter = {}) => getObject(parameter).name);

        return patterns.reduce((found, pattern) => found || getPatternTimingReason(pattern), '');
    };
    const hasLaterWholeObjectRead = (statements = [], sourceSymbol = false) => {
        if (!sourceSymbol) return false;

        const visitReference = (node = {}, parent = {}) => {
            if (typescript.isTypeNode(node)) return false;

            const { kind = 0 } = getObject(node);
            const { kind: parentKind = 0, expression = {}, name = {} } = getObject(parent);
            const symbol = kind === Identifier ? getPlacementSymbol({ typescript, node, placement }) : false;
            const staticReceiver = parentKind === getSyntaxKinds(typescript).PropertyAccessExpression && expression === node;
            const bindingSource = parentKind === getSyntaxKinds(typescript).VariableDeclaration &&
                getObject(name).kind === ObjectBindingPattern && getObject(parent).initializer === node;
            const bindingName = [Parameter, getSyntaxKinds(typescript).VariableDeclaration, getSyntaxKinds(typescript).BindingElement]
                .includes(parentKind) && name === node;

            if (symbol === sourceSymbol && !staticReceiver && !bindingSource && !bindingName) return true;

            return Boolean(typescript.forEachChild(node, child => visitReference(child, node)));
        };

        return statements.some(statement => visitReference(statement));
    };
    const hasMissingBindingDefault = (pattern = {}) => {
        const { elements = [] } = getObject(pattern);

        return elements.some((element = {}) => {
            const { name = {}, initializer = false, dotDotDotToken = false, kind = 0 } = getObject(element);

            return kind !== getSyntaxKinds(typescript).OmittedExpression &&
                ((!initializer && !dotDotDotToken) || hasMissingBindingDefault(name));
        });
    };
    const isCompletedTupleCarrier = ({ name = {}, initializer = {} } = {}) => {
        const { kind = 0, elements = [] } = getObject(name);
        const [element = {}] = elements;
        const { propertyName = {}, name: tuple = {} } = getObject(element);
        const { kind: sourceKind = 0, properties = [] } = getObject(initializer);
        const [property = {}] = properties;
        const { name: sourceName = {}, kind: propertyKind = 0 } = getObject(property);

        // The completed carrier proves the values field and owns its exact
        // tuple positions; it is already a dialect destructuring agreement.
        return kind === ObjectBindingPattern && elements.length === 1 &&
            getObject(propertyName).kind === Identifier && getObject(propertyName).text === 'values' &&
            getObject(tuple).kind === ArrayBindingPattern &&
            sourceKind === getSyntaxKinds(typescript).ObjectLiteralExpression && properties.length === 1 &&
            propertyKind === getSyntaxKinds(typescript).PropertyAssignment &&
            getObject(sourceName).kind === Identifier && getObject(sourceName).text === 'values';
    };
    const hasStatementMissingDefault = (statement = {}) => {
        const { declarationList = {}, parameters = [] } = getObject(statement);
        const { declarations = [] } = getObject(declarationList);
        const patterns = [...declarations.flatMap(({ name = {}, initializer = {} } = {}) => [
            ...(isCompletedTupleCarrier({ name, initializer })
                ? getObject(getObject((getObject(name).elements || [])[0]).name).elements.map(element => getObject(element).name)
                : [name]),
            ...(getObject(initializer).parameters || []).map(({ name: parameterName = {} } = {}) => parameterName)]),
        ...parameters.map(({ name = {} } = {}) => name)];

        return patterns.some(hasMissingBindingDefault);
    };
    const visit = (node, ifDepth = 0, parameterNames = new Set(), deferredNames = new Set(), parameterSymbols = new Set(), outerFollowing = []) => {
        if (!node) return node;

        const { kind: nodeKind = 0 } = node;
        const continuation = typescript.isFunctionLike(node) ? [] : outerFollowing;

        if (nodeKind === Parameter) return node;

        if (nodeKind === Block) {
            const guardedNames = new Set();
            const sources = new Map();
            let discriminantSources = new Map();
            let selectedModelSources = new Set();
            const { statements: blockStatements = [] } = getObject(node);
            const statements = blockStatements.map((child, statementIndex) => {
                const source = getBindingSource(child);
                const { source: modelSource = '', tag: modelTag = '' } = getDiscriminantBinding(child);
                const followingStatements = blockStatements.slice(statementIndex + 1);
                const selectedModelBinding = modelSource && modelTag &&
                    followingStatements.some(candidate => contains(candidate, modelTag)) &&
                    followingStatements.some(candidate => contains(candidate, modelSource));
                const guarded = source &&
                    parameterNames.has(source) &&
                    (ifDepth > 0 || guardedNames.has(source));
                let next = visit(child, ifDepth, parameterNames, deferredNames, parameterSymbols, [...followingStatements, ...continuation]);
                const selectedPayloadSource = getSelectedPayloadSource(next, selectedModelSources);
                const collectionTimingReason = getStatementTimingReason(next);
                let signatureReason = '';

                if (guarded) {
                    signatureReason = 'branch guard establishes variant before extraction';
                }

                if (!signatureReason && selectedModelBinding) {
                    signatureReason = 'tag Get precedes branch-local payload extraction';
                }

                if (!signatureReason && source && deferredNames.has(source)) {
                    signatureReason = 'earlier identity and predicate probes precede this parameter tag Get';
                }

                if (!signatureReason && collectionTimingReason) signatureReason = collectionTimingReason;

                // Read the binding agreement before adding a synthetic comment.
                // TypeScript may clone a statement while attaching that comment,
                // and cloned binding elements do not retain non-enumerable
                // agreement markers.
                // A retained binding after a terminating guard still owns the
                // native required-field boundary. Keep that safe-default fact
                // independent from signature placement, and de-duplicate the
                // shared explanation when both directives apply.
                const retainedAgreementReason = getRetainedAgreementReason(next);
                const [selectedDeclaration = {}] = getObject(getObject(next).declarationList).declarations || [];
                const { agreement: selectedAgreement = {} } = getDestructuringDecisionForNode({
                    typescript, node: selectedDeclaration, destructuringAgreements,
                    kinds: ['same-phase-selected-binding']
                });
                const guardedSafeDefaultReason = !selectedPayloadSource && guarded &&
                    getObject(selectedAgreement).action !== 'bind-at-source-phase'
                    ? 'branch guard establishes variant before extraction'
                    : '';
                const requiredTupleReason = getRequiredTupleReason(next);
                const safeDefaultReason = requiredTupleReason ||
                    retainedAgreementReason || guardedSafeDefaultReason;
                const [sourceDeclaration = {}] = getObject(getObject(child).declarationList).declarations || [];
                const sourceSymbol = getPlacementSymbol({ typescript, node: getObject(sourceDeclaration).initializer, placement });

                // Signature placement belongs to this function's parameter binding;
                // a same-spelled local cannot borrow its source symbol.
                if (signatureReason && (!parameterNames.has(source) ||
                    sourceSymbol && !parameterSymbols.has(sourceSymbol) ||
                    hasLaterWholeObjectRead([...followingStatements, ...continuation], sourceSymbol))) signatureReason = '';

                const directRules = [
                    signatureReason ? 'resilient/prefer-signature-destructuring' : '',
                    safeDefaultReason && hasStatementMissingDefault(next) ? 'resilient/prefer-safe-destructuring-defaults' : ''
                ].filter(Boolean);
                let directReasons = [...new Set([signatureReason, safeDefaultReason].filter(Boolean))];

                if (signatureReason && safeDefaultReason.includes('static tuple position')) {
                    directReasons = ['selected branch has a checker-proven exact tuple position'];
                }

                if (signatureReason && requiredTupleReason) {
                    directReasons = ['branch guard retains native tuple failure'];
                }

                if (signatureReason === 'tag Get precedes branch-local payload extraction' &&
                    safeDefaultReason === 'required typed field keeps its native Get and failure') {
                    directReasons = ['tag Get precedes payload; required fields keep native failure'];
                }

                if (directRules.length) next = add(
                    next,
                    directRules.join(', '),
                    directReasons.join('; ')
                );

                // Variable/return statements already consumed this decision
                // in visit. Other block statements still need their block owner.
                const callReason = [VariableStatement, ReturnStatement].includes(getObject(next).kind)
                    ? '' : getCallReason(next);

                if (callReason) next = add(
                    next,
                    'resilient/signature-contract-call-site',
                    callReason
                );

                if (modelSource && modelTag) {
                    discriminantSources = new Map([...discriminantSources, [modelTag, modelSource]]);
                }

                const terminatedSource = getTerminatingSelectedSource(next, discriminantSources);

                if (terminatedSource) {
                    selectedModelSources = new Set([...selectedModelSources, terminatedSource]);
                }

                const { kind: childKind = 0, declarationList = {} } = getObject(child);
                const { declarations = [] } = getObject(declarationList);
                const [firstDecl = {}] = declarations;
                const { name: firstDeclName = {} } = getObject(firstDecl);

                // eslint-disable-next-line resilient/prefer-safe-transformations -- Private block guard Set publishes names before later sibling visits.
                if (childKind === IfStatement) getGuardNames(child, sources).forEach(name => guardedNames.add(name));

                if (source) getBindingNames({
                    typescript,
                    node: firstDeclName
                }).forEach((binding) => {
                    // eslint-disable-next-line resilient/prefer-safe-transformations -- Private block source Map preserves overwrite order for later guards.
                    sources.set(binding, source);
                });

                return next;
            });

            return factory.updateBlock(node, statements);
        }

        if (functionKinds.includes(nodeKind)) {
            const { parameters = [] } = getObject(node);
            const { agreement: deferredAgreement = {}, contract: deferredContract = {} } = getDestructuringDecisionForNode({
                typescript, node, destructuringAgreements,
                kinds: ['deferred-signature-selection']
            });
            const deferred = getObject(deferredAgreement).action === 'retain-deferred-signature-selection'
                ? new Set([getObject(deferredContract).parameter].filter(Boolean)) : new Set();
            const names = new Set(parameters.flatMap((parameter) => {
                const { name: paramName = {}, dotDotDotToken = false } = getObject(parameter);

                if (dotDotDotToken) return [];

                return getBindingNames({
                    typescript,
                    node: paramName
                });
            }));
            const symbols = new Set(parameters.map(({ name = {} } = {}) => getPlacementSymbol({ typescript, node: name, placement })).filter(Boolean));
            const visitedFunction = typescript.visitEachChild(
                node,
                child => visit(child, 0, names, deferred, symbols),
                context
            );
            const hasRequiredPosition = (pattern = {}) => getObject(pattern).elements.some((element = {}) => {
                const { name = {}, initializer = false, dotDotDotToken = false } = getObject(element);

                return !initializer && !dotDotDotToken ||
                    getObject(name).kind === ArrayBindingPattern && hasRequiredPosition(name);
            });
            const hasRequiredPattern = getObject(visitedFunction).parameters.some((parameter = {}) => {
                const { name = {} } = getObject(parameter);

                return getObject(name).kind === ArrayBindingPattern && hasRequiredPosition(name);
            });

            const requiredTupleReason = hasRequiredPattern ? getRequiredTupleReason(visitedFunction) : '';

            return requiredTupleReason
                ? add(
                    visitedFunction,
                    'resilient/prefer-safe-destructuring-defaults',
                    requiredTupleReason
                )
                : visitedFunction;
        }

        const { kind: currentKind = 0 } = getObject(node);
        let visited = typescript.visitEachChild(
            node,
            child => visit(child, currentKind === IfStatement ? ifDepth + 1 : ifDepth, parameterNames, deferredNames, parameterSymbols, continuation),
            context
        );

        const {
            kind: visitedKind = 0,
            elseStatement: visitedElse = false,
            thenStatement: visitedThen = {},
            expression: visitedExpr = {}
        } = getObject(visited);

        if (visitedKind === IfStatement && visitedElse) {
            const reason = 'discriminated branch retains mutually exclusive variant-local bindings required by the downstream branch expression';
            const directive = 'eslint-disable-next-line resilient/no-else';
            const thenComments = typeof getSyntheticLeadingComments === 'function'
                ? getSyntheticLeadingComments(visitedThen) || []
                : [];
            const hasDirective = thenComments.some(({ text = '' } = {}) => text.includes(directive));
            const { addSyntheticTrailingComment: addTrailing = false } = getObject(typescript);
            const thenStatement = !hasDirective &&
                typeof addTrailing === 'function'
                ? addTrailing(
                    visitedThen,
                    SingleLineCommentTrivia,
                    ` ${directive} -- ${reason}`,
                    true
                )
                : visitedThen;

            visited = factory.updateIfStatement(
                visited,
                visitedExpr,
                thenStatement,
                visitedElse
            );
        }

        if (visitedKind === IfStatement && ifDepth > 0) visited = add(
            visited,
            'resilient/no-nested-if',
            'nested branch retains a variant-local guard and scope'
        );

        const callReason = [VariableStatement, ReturnStatement].includes(visitedKind)
            ? getCallReason(visited)
            : '';

        if (callReason) visited = add(
            visited,
            'resilient/signature-contract-call-site',
            callReason
        );

        // A direct block statement is annotated by its block owner, which has
        // all of the independent signature and retained-binding facts before
        // synthetic comments clone the statement.
        const { parent: visitedParent = {} } = getObject(node);
        const { kind: visitedParentKind = 0 } = getObject(visitedParent);
        const retainedReason = visitedKind === VariableStatement && visitedParentKind !== Block
            ? getRequiredTupleReason(visited) || getRetainedAgreementReason(visited)
            : '';

        if (retainedReason && hasStatementMissingDefault(visited)) visited = add(
            visited,
            'resilient/prefer-safe-destructuring-defaults',
            retainedReason
        );

        return visited;
    };

    return typescript.visitNode(sourceFile, visit);
};

export {
    annotateFinalExceptions,
    lowerFinalGrammar
};
