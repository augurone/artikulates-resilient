import { isFunction } from '../../../analysis/host/function.js';
import { getObject } from '../../../analysis/host/object.js';
import {
    getSourceRange,
    getSyntaxKinds,
    markGuardedNode,
    updateBindingInitializer,
    updateFunction
} from '../../utils/ast-boundary.js';
import {
    getBindingAgreement,
    annotateAgreementException,
    getBindingDecision,
    emitBindingAgreement,
    getBindingInitializer,
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
    getConsumerContractKey
} from '../understand/type-evidence.js';
import { createCollectionAccumulatorRebind } from './algebra.js';
import {
    getBindingAgreementReason,
    getBindingElementCanonical,
    getBindingPropertyName,
    getBindingRuntimeGuardKind
} from './resolvers.js';

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
            CallExpression: CallExpressionKind3 = -1
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
        DeleteExpression = -1,
        PrefixUnaryExpression = -1,
        PostfixUnaryExpression = -1,
        TypeOfExpression = -1,
        EqualsEqualsToken = -1,
        VoidExpression = -1
    } = getSyntaxKinds(typescript);
    const { factory = {}, addSyntheticLeadingComment,
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
    const { collectionMutations = new Map(), collectionUpdates = new Map() } = destructuringAgreements;
    const getCollectionMutation = (statement = {}) => {
        const { expression = {} } = getObject(statement);
        const { getOriginalNode } = typescript;
        const original = isFunction(getOriginalNode) ? getOriginalNode(expression) : expression;
        const originalKey = getConsumerContractKey(original);
        const directKey = getConsumerContractKey(expression);

        return (collectionMutations.has(originalKey)
            ? collectionMutations.get(originalKey) : collectionMutations.get(directKey)) ||
            (collectionUpdates.has(originalKey)
                ? collectionUpdates.get(originalKey) : collectionUpdates.get(directKey)) || {};
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
    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- These kind-specific compiler fields retain absence for node identity comparison; no substitute node is valid.
    const isWriteAccess = (node, { left, operatorToken = {}, expression, operand, kind: parentKind = 0 } = {}) => {
        const { kind: opTokenKind = 0 } = getObject(operatorToken);

        return parentKind === BinaryExpression &&
        isSameNode(left, node) &&
        assignmentOperators.has(opTokenKind) ||
        parentKind === DeleteExpression &&
        isSameNode(expression, node) ||
        [PrefixUnaryExpression, PostfixUnaryExpression].includes(parentKind) &&
        isSameNode(operand, node);
    };
    const getIndexedAssignment = ({ operatorToken = {}, left = false, kind: nodeKind = 0 } = {}) => {
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

        const { agreement: selectedReadAgreement = {} } = getDestructuringDecisionForNode({
            typescript, node, destructuringAgreements, kinds: ['selected-model-read']
        });

        // Completed selection retention owns the exact native indexed Get;
        // the erased scalar family cannot supply a positional default here.
        if (getObject(selectedReadAgreement).action === 'retain-source-phase-read') return false;

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
                    initializer: elemInit
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
    const updateFinalBindingPattern = (pattern, source) => {
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
        const allowOpaque = getSourceAgreementReason(source).startsWith('union branch');

        const elements = patternElements.map((element, index) => {
            const {
                kind: elemKind = 0,
                dotDotDotToken: elemDotDotDot = false,
                initializer: elemInit,
                __resilientGuarded = false
            } = getObject(element);

            if (!element || elemKind !== BindingElement || elemDotDotDot) return element;

            const { propertyName: elementPropertyName = false, name: elementName = {} } = getObject(element);
            const { agreement: structural = {} } = getDestructuringDecisionForNode({
                typescript, node: element, destructuringAgreements, kinds: ['closed-structural-model']
            });

            if (!elemInit && getObject(structural).action === 'exact-structural-field' &&
                ['undefined', 'void 0'].includes(getObject(structural).canonical)) return factory.updateBindingElement(
                element, elemDotDotDot, elementPropertyName, elementName,
                factory.createVoidExpression(factory.createNumericLiteral(0))
            );

            const runtimeGuardKind = getBindingRuntimeGuardKind({ typescript, element, placement });
            const canonical = getBindingElementCanonical({ typescript, element, placement });
            const guardedKind = !canonical ? runtimeGuardKind : '';
            const bindingCanonical = canonical;
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
            const initializer = getBindingInitializer(emitBindingAgreement({
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
            }));

            return initializer ? updateBindingInitializer({ factory, element, initializer }) : element;
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
            kind: expressionKind = 0,
            expression: callTarget = {}, arguments: args = []
        } = getObject(expression);

        const { kind: callTargetKind = 0, expression: receiverExpr = {}, name: method = {} } = getObject(callTarget);
        const { kind: receiverExprKind = 0, text: receiverExprText = '' } = getObject(receiverExpr);
        const { text: methodText = '' } = getObject(method);
        const receiverRecord = accumulatorKinds.get(receiverExprText);
        const { action: mutationAction = '', type: mutationType = '' } = getCollectionMutation(statement);
        const receiverKindType = mutationType ? mutationType.toLowerCase() : getObject(receiverRecord).kind || receiverRecord;
        const sourceOwnedCollection = mutationType.toLowerCase() === receiverKindType;
        const isOwnedMethodCall = expressionKind === CallExpressionKind3 &&
            callTargetKind === PropertyAccessExpression && receiverExprKind === Identifier &&
            Boolean(receiverKindType);
        const retainOperationalMutation = () => {
            const {
                addSyntheticLeadingComment,
                SyntaxKind: { SingleLineCommentTrivia = -1 } = {}
            } = typescript;

            if (!isFunction(addSyntheticLeadingComment)) return statement;

            return addSyntheticLeadingComment(
                statement,
                SingleLineCommentTrivia,
                ' eslint-disable-next-line resilient/prefer-safe-transformations -- Owned Map/Set builder preserves source iterator staging and transfers only at return.',
                true
            );
        };

        if (mutationAction === 'retain-collection-boundary') return statement;

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

        return statement;
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
            const { name: declName = {} } = getObject(declaration);
            const { contract: collectionOwner = {}, agreement: collectionDecision = {} } = getDestructuringDecisionForNode({
                typescript, node: declaration, destructuringAgreements, kinds: ['collection-reconstruction']
            });
            const { type: collectionType = '' } = getObject(getObject(collectionOwner).collection);
            const { action = '' } = collectionDecision;
            const kind = ['single-collection-update', 'fresh-copy-reconstruction', 'fresh-collection-rebind',
                'materialized-collection-reduce', 'operational-collection-builder'].includes(action)
                ? { Set: 'set', Map: 'map' }[collectionType] || '' : '';

            if (!kind) return;

            getBindingNames({ typescript, node: declName }).forEach((name) => {
                localAccumulators = new Map([...localAccumulators, [name, kind]]);
            });
        });
        const accumulatorKinds = new Map([...inheritedAccumulators, ...localAccumulators]);
        const guardedSources = new Set(inheritedGuards);
        const statements = blockStatements.flatMap((statement) => {
            // Consume the completed source collection mutation before placement.
            const ownedAssignment = getAccumulatorAssignment(statement, accumulatorKinds);
            // eslint-disable-next-line no-use-before-define -- Visitor receives the active traversal state.
            const visited = visit(ownedAssignment, block, accumulatorKinds, guardedSources);

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
                const { kind: statementKind = 0, declarationList = {}, modifiers } = getObject(statement);

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
    const lowerVisitedVariableDeclaration = (visited, node) => {
        const {
            initializer: visitedInit = {},
            name: visitedName = {},
            exclamationToken: visitedExclamation,
            type: visitedType
        } = getObject(visited);
        const { kind: nameKind = 0, text: nameText = '' } = getObject(visitedName);
        const { kind: initKind = 0, expression: initReceiver = {}, name: initProp = {} } = getObject(visitedInit);
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
            const emitted = shouldRetain
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
            const defaultInit = getBindingInitializer(emitted);
            const { record = {} } = emitted;
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

        const pattern = updateFinalBindingPattern(
            visitedName,
            visitedInit
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

            const retainedCallbackAlias = callbackOwnedAlias && isFunction(addSyntheticLeadingComment)
                ? addSyntheticLeadingComment(
                    visited,
                    SingleLineCommentTrivia,
                    ' eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Provider-owned field has no source fallback; absence must remain undefined.',
                    true
                )
                : false;

            return retainedCallbackAlias || (retainedCardinality && isFunction(addSyntheticLeadingComment)
                ? addSyntheticLeadingComment(visited, SingleLineCommentTrivia,
                    ' eslint-disable-next-line prefer-destructuring -- standard array cardinality retains its native length Get.', true)
                : visited);
        }

        if (nodeKind === VariableDeclaration) {
            const visited = visitChildren(node, accumulatorKinds, guardedSources, canReturn);

            return lowerVisitedVariableDeclaration(visited, node);
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

            return visited;
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
        ForOfStatement = -1,
        ForStatement = -1,
        Identifier = -1,
        IfStatement = -1,
        ObjectBindingPattern = -1,
        Parameter = -1,
        ReturnStatement = -1,
        VariableStatement = -1,
        SingleLineCommentTrivia = -1
    } = getSyntaxKinds(typescript);
    const {
        factory = {},
        addSyntheticLeadingComment,
        getSyntheticLeadingComments
    } = typescript;
    const functionKinds = [ArrowFunction, FunctionDeclaration, FunctionExpression];
    const add = (node, rules = '', reason = '') => {
        if (!node || !rules || !reason || !isFunction(addSyntheticLeadingComment)) return node;

        const comments = isFunction(getSyntheticLeadingComments)
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
    const hasMissingBindingDefault = (pattern = {}) => {
        const { elements = [] } = getObject(pattern);

        return elements.some((element = {}) => {
            const { name = {}, initializer = false, dotDotDotToken = false, kind = 0 } = getObject(element);

            return kind !== getSyntaxKinds(typescript).OmittedExpression &&
                ((!initializer && !dotDotDotToken) || hasMissingBindingDefault(name));
        });
    };
    const getRequiredTupleReason = (node = {}) => {
        const { agreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node,
            destructuringAgreements,
            kinds: ['required-tuple-binding', 'consumer-callback', 'consumer']
        });
        const { action = '' } = agreement;
        const tupleActions = ['retain-required-tuple-binding', 'retain-required-tuple-container', 'preserve-native-tuple'];

        if (!tupleActions.includes(action)) return '';

        const original = typescript.getOriginalNode(node);
        const { declarationList = {}, parameters = [], initializer = {} } = getObject(original);
        const { declarations = [] } = getObject(declarationList);
        const { declarations: headerDeclarations = [] } = getObject(initializer);
        const bindings = [...declarations, ...headerDeclarations, ...parameters].map(({ name = {} } = {}) => name);
        const complete = bindings.every((binding) => {
            if (!hasMissingBindingDefault(binding)) return true;

            const { agreement: bindingAgreement = {} } = getDestructuringDecisionForNode({
                typescript, node: binding, destructuringAgreements, kinds: ['required-tuple-binding']
            });

            return tupleActions.includes(getObject(bindingAgreement).action) ||
                action === 'preserve-native-tuple' && getObject(binding).kind === ArrayBindingPattern;
        });

        return complete
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

        return declarations.length === 1 && declNameKind === ObjectBindingPattern && declInitKind === Identifier
            ? declInitText
            : '';
    };
    const { byKind = new Map() } = getObject(destructuringAgreements);
    const getSelectionDecision = (statement = {}) => byKind.has('selected-model-read')
        ? getDestructuringDecisionForNode({
            typescript, node: statement, destructuringAgreements, kinds: ['selected-model-read']
        }) : {};
    const getDiscriminantBinding = (statement = {}) => {
        const { contract = {}, agreement = {} } = getSelectionDecision(statement);
        const { operationRole = '', source = {} } = contract;
        const { provider = '' } = source;
        const { declarationList: { declarations = [] } = {} } = getObject(statement);
        const [{ name: { elements = [] } = {} } = {}] = declarations;
        const [{ name: { text: tag = '' } = {} } = {}] = elements;

        return ['selected-model-read', 'retain-source-phase-read'].includes(getObject(agreement).action) && operationRole === 'discriminator-read'
            ? { source: provider, tag } : {};
    };
    const getSelectedPayloadSource = (statement = {}) => {
        const { contract = {}, agreement = {} } = getSelectionDecision(statement);
        const { operationRole = '', source: { provider = '' } = {} } = contract;
        const { action = '' } = agreement;

        if (action === 'exact-source-binding' && operationRole === 'source-field-binding') return provider;

        if (action === 'selected-model-read' && operationRole === 'selected-field-read') return provider;

        const { declarationList: { declarations: originalDeclarations = [] } = {} } = getObject(typescript.getOriginalNode(statement));
        const [{ name: originalPattern = {}, initializer: originalRead = {} } = {}] = originalDeclarations;
        const { agreement: readAgreement = {}, contract: readContract = {} } = getSelectionDecision(originalRead);

        if (originalDeclarations.length === 1 && getObject(originalPattern).kind === ArrayBindingPattern &&
            ['selected-model-read', 'retain-source-phase-read'].includes(getObject(readAgreement).action) &&
            getObject(readContract).operationRole === 'selected-field-read') return getObject(getObject(readContract).source).provider || '';

        const { declarationList: { declarations = [] } = {} } = getObject(statement);
        const [{ name: { elements = [] } = {} } = {}] = declarations;
        const bindings = elements.map(element => getSelectionDecision(element));
        const exactBindings = bindings.filter(({ agreement: bindingAgreement = {}, contract: bindingContract = {} } = {}) => {
            const { action: bindingAction = '' } = bindingAgreement;
            const { operationRole: bindingRole = '' } = bindingContract;

            return bindingAction === 'exact-source-binding' ||
                (['selected-model-read', 'retain-source-phase-read'].includes(bindingAction) &&
                    ['selected-field-read', 'conditional-source-read'].includes(bindingRole));
        });
        const providers = exactBindings.map(({ contract: { source: { provider: bindingProvider = '' } = {} } = {} } = {}) => bindingProvider);
        const [bindingSource = ''] = providers;

        if (bindings.length && exactBindings.length === bindings.length && providers.every(value => value === bindingSource)) return bindingSource;

        if (!byKind.has('curried-selected-tuple-binding')) return '';

        const { contract: tuple = {}, agreement: tupleAgreement = {} } = getDestructuringDecisionForNode({
            typescript, node: statement, destructuringAgreements, kinds: ['curried-selected-tuple-binding']
        });

        return getObject(tupleAgreement).action === 'curried-selected-tuple-binding' ? getObject(tuple).receiverName || '' : '';
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

            if (child !== statement && childKind23 === Block) return;

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
        const { __resilientExactTuplePosition = false, __resilientNativeTuple = false, elements = [] } = getObject(pattern);
        const nativePositionReason = __resilientNativeTuple
            ? 'Materialized entry keeps native iteration, absence and failure.'
            : '';
        const exactPositionReason = nativePositionReason || (__resilientExactTuplePosition
            ? 'checker-proven static tuple position preserves the source undefined result without normalizing its container'
            : '');

        return elements.reduce((found, element = {}) => {
            const { __resilientAgreement = '', name: elementName = {}, initializer = false } = getObject(element);
            const { agreement: absence = {} } = getDestructuringDecisionForNode({
                typescript, node: element, destructuringAgreements, kinds: ['exact-provider-forward', 'closed-structural-model']
            });
            const absenceReason = !initializer && getObject(absence).canonical === 'undefined'
                ? 'Source field retains its natural absence.' : '';

            const { agreement = {} } = byKind.has('curried-selected-tuple-binding')
                ? getDestructuringDecisionForNode({
                    typescript, node: element, destructuringAgreements, kinds: ['curried-selected-tuple-binding']
                }) : {};
            const tupleReason = getObject(agreement).action === 'curried-selected-tuple-binding'
                ? 'curried callee call precedes selected tuple Get; container retains native failure' : '';

            return found || __resilientAgreement || absenceReason || tupleReason || getPatternAgreementReason(elementName);
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
    const nestedBindingReason = 'authored required nested binding retains native Get, iteration and undefined';
    // Only this statement's own patterns; a nested function owns its own line.
    const getRetainedAgreementReason = (statement) => {
        const {
            kind: statementKind = 0,
            declarationList = {},
            parameters: declaredParameters = []
        } = getObject(statement);
        const { declarations = [] } = getObject(declarationList);
        const [{ name: { elements: sourceElements = [] } = {} } = {}] = declarations;
        const sourceBindings = declarations.length === 1 ? sourceElements.map(getSelectionDecision) : [];
        const completeSourceBindings = !!sourceBindings.length && sourceBindings.every(({
            agreement: { action = '' } = {}, contract: { requiredPattern: { complete = false } = {} } = {}
        } = {}) => action === 'exact-source-binding' && complete);

        if (completeSourceBindings) return nestedBindingReason;

        const patterns = statementKind === VariableStatement
            ? declarations.flatMap((declaration = {}) => {
                const { name = {}, initializer = {} } = getObject(declaration);
                const { parameters = [] } = getObject(initializer);

                // Preserve the original compiler property read even though its value is discarded.
                void parameters;

                return [name];
            })
            : declaredParameters.map((parameter = {}) => getObject(parameter).name);

        return patterns.reduce((found, pattern) => found || getPatternAgreementReason(pattern), '');
    };
    const getSourceBindingPhase = (declaration) => {
        const { contract = {}, agreement = {} } = getDestructuringDecisionForNode({
            typescript, node: declaration, destructuringAgreements, kinds: ['repeated-parameter-read']
        });

        return getObject(agreement).action === 'retain-source-phase-read' &&
            getObject(contract).operationRole === 'source-binding-phase' ? contract : {};
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
        const samePhaseBinding = statementKind === VariableStatement && declarations.length === 1 && byKind.has('same-phase-selected-binding') &&
            declarations.some((declaration) => {
                const { contract = {}, agreement = {} } = getDestructuringDecisionForNode({
                    typescript, node: declaration, destructuringAgreements, kinds: ['same-phase-selected-binding']
                });

                return getObject(agreement).action === 'bind-at-source-phase' &&
                    getObject(contract).operationRole === 'same-phase-selected-binding';
            });
        const sourceBindingPhase = statementKind === VariableStatement && declarations.length === 1 && byKind.has('repeated-parameter-read') &&
            declarations.some(declaration => Object.keys(getSourceBindingPhase(declaration)).length);

        const bindingReason = sourceBindingPhase ? 'authored object binding retains key, default, copy and failure order' : '';

        return patterns.reduce((found, pattern) => found || getPatternTimingReason(pattern),
            bindingReason || (samePhaseBinding ? 'completed static field binding retains its source Get phase' : ''));
    };
    const hasLaterWholeObjectRead = (statements = [], sourceSymbol = false) => {
        if (!sourceSymbol) return false;

        const { PropertyAccessExpression = -1, ElementAccessExpression = -1, StringLiteral = -1, NumericLiteral = -1,
            ParenthesizedExpression = -1, AsExpression = -1, TypeAssertionExpression = -1,
            NonNullExpression = -1, SatisfiesExpression = -1 } = getSyntaxKinds(typescript);
        const transparent = new Set([ParenthesizedExpression, AsExpression, TypeAssertionExpression, NonNullExpression, SatisfiesExpression]);
        const visitReference = (node = {}, parent = {}) => {
            if (typescript.isTypeNode(node)) return false;

            const { kind = 0 } = getObject(node);
            const { kind: parentKind = 0, expression = {}, name = {}, argumentExpression = {} } = getObject(parent);
            const symbol = kind === Identifier ? getPlacementSymbol({ typescript, node, placement }) : false;
            const staticMember = parentKind === PropertyAccessExpression || parentKind === ElementAccessExpression &&
                [StringLiteral, NumericLiteral].includes(getObject(argumentExpression).kind);
            const staticReceiver = staticMember && (expression === node || transparent.has(getObject(expression).kind));
            const bindingSource = parentKind === getSyntaxKinds(typescript).VariableDeclaration &&
                getObject(name).kind === ObjectBindingPattern && getObject(parent).initializer === node;
            const bindingName = [Parameter, getSyntaxKinds(typescript).VariableDeclaration, getSyntaxKinds(typescript).BindingElement]
                .includes(parentKind) && name === node;

            if (symbol === sourceSymbol && !staticReceiver && !bindingSource && !bindingName) return true;

            return Boolean(typescript.forEachChild(node, child => visitReference(child, transparent.has(kind) ? parent : node)));
        };

        return statements.some(statement => visitReference(statement));
    };
    const hasStatementMissingDefault = (statement = {}) => {
        const { declarationList = {}, parameters = [], initializer = {} } = getObject(statement);
        const { declarations = [] } = getObject(declarationList);
        const { declarations: headerDeclarations = [] } = getObject(initializer);
        const patterns = [...declarations, ...headerDeclarations].flatMap(({ name = {}, initializer = {} } = {}) => [
            name,
            ...(getObject(initializer).parameters || []).map(({ name: parameterName = {} } = {}) => parameterName)])
            .concat(parameters.map(({ name = {} } = {}) => name));

        return patterns.some(hasMissingBindingDefault);
    };
    const visit = (node, ifDepth = 0, parameterNames = new Set(), deferredNames = new Set(),
        parameterSymbols = new Set(), outerFollowing = [], parameterRanges = new Map()) => {
        if (!node) return node;

        const { kind: nodeKind = 0 } = node;
        const continuation = typescript.isFunctionLike(node) ? [] : outerFollowing;

        if (nodeKind === Parameter) return node;

        if (nodeKind === Block) {
            const { statements: blockStatements = [] } = getObject(node);
            const statements = blockStatements.map((child, statementIndex) => {
                const source = getBindingSource(child);
                const { source: modelSource = '', tag: modelTag = '' } = getDiscriminantBinding(child);
                const followingStatements = blockStatements.slice(statementIndex + 1);
                const selectedModelBinding = modelSource && modelTag &&
                    followingStatements.some(candidate => contains(candidate, modelTag)) &&
                    followingStatements.some(candidate => contains(candidate, modelSource));
                let next = visit(child, ifDepth, parameterNames, deferredNames, parameterSymbols, [...followingStatements, ...continuation], parameterRanges);
                const selectedPayloadSource = getSelectedPayloadSource(next);
                const collectionTimingReason = getStatementTimingReason(next);
                let signatureReason = '';

                if (selectedPayloadSource) {
                    signatureReason = 'selected field Get retains its source phase';
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

                const requiredTupleReason = getRequiredTupleReason(next);
                const safeDefaultReason = requiredTupleReason ||
                    retainedAgreementReason;
                const [sourceDeclaration = {}] = getObject(getObject(child).declarationList).declarations || [];
                const sourceSymbol = getPlacementSymbol({ typescript, node: getObject(sourceDeclaration).initializer, placement });
                const { parameterRange = '', aliasSignature = false } = getSourceBindingPhase(sourceDeclaration);
                const phaseSymbol = aliasSignature ? parameterRanges.get(parameterRange) : false;
                const signatureSymbol = phaseSymbol || sourceSymbol;

                // Signature placement belongs to this function's parameter binding;
                // a same-spelled local cannot borrow its source symbol.
                if (signatureReason && (ifDepth > 0 || !phaseSymbol && !parameterNames.has(source) ||
                    signatureSymbol && !parameterSymbols.has(signatureSymbol) ||
                    hasLaterWholeObjectRead([...followingStatements, ...continuation], signatureSymbol))) signatureReason = '';

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

                if (signatureReason && safeDefaultReason === nestedBindingReason) {
                    directReasons = ['source phase keeps nested Gets, iteration and undefined'];
                }

                if (signatureReason && safeDefaultReason.includes('curried callee call precedes selected tuple Get')) {
                    directReasons = ['curried callee precedes exact tuple Get; native container failure'];
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
            const ranges = new Map(parameters.map(parameter => [getConsumerContractKey(parameter),
                getPlacementSymbol({ typescript, node: getObject(parameter).name, placement })]));
            const visited = typescript.visitEachChild(
                node,
                child => visit(child, 0, names, deferred, symbols, [], ranges),
                context
            );
            const { body = {}, parameters: visitedParameters = [] } = getObject(visited);
            const innerComments = getObject(body).kind === ArrowFunction && isFunction(getSyntheticLeadingComments)
                ? getSyntheticLeadingComments(body) || [] : [];
            const visitedFunction = nodeKind === ArrowFunction && innerComments.length
                ? updateFunction({ typescript, node: visited, parameters: visitedParameters, body: factory.createParenthesizedExpression(body) })
                : visited;
            /* eslint-disable resilient/signature-contract-operation -- Compiler patterns require element arrays; malformed nodes retain their native .some() failure. */
            const hasRequiredPosition = (pattern = {}) => getObject(pattern).elements.some((element = {}) => {
                const { name = {}, initializer = false, dotDotDotToken = false } = getObject(element);

                return !initializer && !dotDotDotToken ||
                    getObject(name).kind === ArrayBindingPattern && hasRequiredPosition(name);
            });
            /* eslint-enable resilient/signature-contract-operation */
            const hasRequiredPattern = getObject(visitedFunction).parameters.some((parameter = {}) => {
                const { name = {} } = getObject(parameter);

                return getObject(name).kind === ArrayBindingPattern && hasRequiredPosition(name);
            });

            const requiredTupleReason = hasRequiredPattern ? getRequiredTupleReason(visitedFunction) : '';
            const nativeAbsenceReason = getRetainedAgreementReason(visitedFunction);

            return requiredTupleReason || nativeAbsenceReason
                ? add(
                    visitedFunction,
                    'resilient/prefer-safe-destructuring-defaults',
                    requiredTupleReason || nativeAbsenceReason
                )
                : visitedFunction;
        }

        const { kind: currentKind = 0 } = getObject(node);
        let visited = typescript.visitEachChild(
            node,
            (child) => {
                return visit(child, currentKind === IfStatement ? ifDepth + 1 : ifDepth, parameterNames,
                    deferredNames, parameterSymbols, continuation, parameterRanges);
            },
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
            const thenComments = isFunction(getSyntheticLeadingComments)
                ? getSyntheticLeadingComments(visitedThen) || []
                : [];
            const hasDirective = thenComments.some(({ text = '' } = {}) => text.includes(directive));
            const { addSyntheticTrailingComment: addTrailing } = getObject(typescript);
            const thenStatement = !hasDirective &&
                isFunction(addTrailing)
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
        const tupleHeaderReason = [ForOfStatement, ForStatement].includes(visitedKind) ? getRequiredTupleReason(visited) : '';
        const retainedReason = visitedKind === VariableStatement && visitedParentKind !== Block
            ? getRequiredTupleReason(visited) || getRetainedAgreementReason(visited)
            : tupleHeaderReason;

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
