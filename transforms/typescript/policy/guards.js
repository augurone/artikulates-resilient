import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';
import { getTypeText } from '../understand/type-evidence.js';

const hasGuardFor = ({ typescript = {}, node = {}, sourceFile = {}, name = '' } = {}) => {
    let guarded = false;
    const { BinaryExpression: BinaryExpressionKind2 = -1 } = getSyntaxKinds(typescript);

    const visit = (child) => {
        if (guarded || !child) return;

        const { kind: childKind = 0 } = getObject(child);

        const text = getTypeText({ node: child, sourceFile });

        guarded = guarded || childKind === BinaryExpressionKind2 && (
            text.includes(`typeof ${name}`) ||
            text.includes(`Array.isArray(${name})`) ||
            text.includes(`isFunction(${name})`) ||
            text.includes(`${name} &&`)
        );

        typescript.forEachChild(child, visit);
    };

    visit(node);

    return guarded;
};

const hasObservedAbsenceFor = ({ typescript = {}, node = {}, parameter = {}, checker = {} } = {}) => {
    const {
        Identifier: IdentifierKind2 = -1,
        CallExpression: CallExpressionKind2 = -1,
        NewExpression: NewExpressionKind2 = -1,
        IfStatement: IfStatementKind2 = -1,
        ConditionalExpression: ConditionalExpressionKind2 = -1,
        PrefixUnaryExpression: PrefixUnaryExpressionKind2 = -1,
        ExclamationToken: ExclamationTokenKind2 = -1,
        BinaryExpression: BinaryExpressionKind3 = -1,
        NullKeyword: NullKeywordKind3 = -1,
        VoidExpression: VoidExpressionKind2 = -1,
        EqualsEqualsToken: EqualsEqualsTokenKind2 = -1,
        EqualsEqualsEqualsToken: EqualsEqualsEqualsTokenKind2 = -1,
        ExclamationEqualsToken: ExclamationEqualsTokenKind2 = -1,
        ExclamationEqualsEqualsToken: ExclamationEqualsEqualsTokenKind2 = -1,
        AmpersandAmpersandToken: AmpersandAmpersandTokenKind2 = -1,
        BarBarToken: BarBarTokenKind2 = -1,
        QuestionQuestionToken: QuestionQuestionTokenKind2 = -1
    } = getSyntaxKinds(typescript);
    const { name: parameterName = {} } = getObject(parameter);
    const { text: paramText = '' } = getObject(parameterName);
    const { getSymbolAtLocation = false, getResolvedSignature = false } = getObject(checker);
    const symbol = typeof getSymbolAtLocation === 'function' ? getSymbolAtLocation.call(checker, parameterName) : false;
    const isParameter = (value) => {
        const { kind = 0, text = '' } = getObject(value);

        return kind === IdentifierKind2 &&
            text === paramText &&
            (!symbol || (typeof getSymbolAtLocation === 'function' && getSymbolAtLocation.call(checker, value) === symbol));
    };
    const observes = (child) => {
        const {
            kind: childKind18 = 0,
            arguments: childArgs = [],
            expression: childExpr = false,
            condition: childCond = false,
            operator: childOperator = 0,
            operand: childOperand = false,
            operatorToken: { kind: operator = 0 } = {},
            left: childLeft = false,
            right: childRight = false
        } = getObject(child);

        // Preserve optional arguments delegated to a declared external API:
        // its default may differ from the dialect's canonical empty value.
        const resolved = [CallExpressionKind2, NewExpressionKind2].includes(childKind18) &&
            childArgs.some(isParameter) &&
            getResolvedSignature
            ? getObject(getResolvedSignature(child))
            : {};
        {
            const { declaration = {} } = resolved;
            const { getSourceFile = false, parameters = [] } = getObject(declaration);
            const declarationSource = typeof getSourceFile === 'function'
                ? getSourceFile.call(declaration)
                : {};
            const { isDeclarationFile: external = false } = getObject(declarationSource);
            const index = childArgs.findIndex(isParameter);
            const [matchedParam = {}] = parameters.slice(index, index + 1);
            const { questionToken = false, initializer = false } = getObject(matchedParam);

            if (external && (questionToken || initializer)) return true;
        }

        if ([IfStatementKind2, ConditionalExpressionKind2].includes(childKind18) &&
            isParameter(childExpr || childCond)) return true;

        if (childKind18 === PrefixUnaryExpressionKind2 &&
            childOperator === ExclamationTokenKind2 &&
            isParameter(childOperand)) return true;

        if (childKind18 !== BinaryExpressionKind3) return false;

        const absence = (value) => {
            const { kind = 0, text = '' } = getObject(value);

            return (kind === IdentifierKind2 && text === 'undefined') ||
                kind === NullKeywordKind3 ||
                kind === VoidExpressionKind2;
        };
        const comparison = [
            EqualsEqualsTokenKind2, EqualsEqualsEqualsTokenKind2,
            ExclamationEqualsTokenKind2, ExclamationEqualsEqualsTokenKind2
        ].includes(operator);

        if (comparison) return (isParameter(childLeft) && absence(childRight)) ||
            (isParameter(childRight) && absence(childLeft));

        return [AmpersandAmpersandTokenKind2, BarBarTokenKind2, QuestionQuestionTokenKind2]
            .includes(operator) && isParameter(childLeft);
    };
    const visit = child => observes(child) || !!typescript.forEachChild(child, visit);

    return !!node && !!visit(node);
};

const hasOptionalFallbackFor = ({ typescript = {}, node = {}, sourceFile = {}, name = '' } = {}) => {
    let optional = false;
    const { IfStatement = -1 } = getSyntaxKinds(typescript);

    const visit = (child) => {
        if (optional || !child) return;

        const {
            kind: childKind = 0,
            expression: childExpr = {},
            thenStatement: childThen = {}
        } = getObject(child);

        const condition = getTypeText({ node: childExpr, sourceFile });
        const consequent = getTypeText({ node: childThen, sourceFile });

        optional = childKind === IfStatement &&
            condition.includes(`!hasContent(${name})`) &&
            consequent.includes('return {}');

        typescript.forEachChild(child, visit);
    };

    visit(node);

    return optional;
};

export {
    hasGuardFor,
    hasObservedAbsenceFor,
    hasOptionalFallbackFor
};
