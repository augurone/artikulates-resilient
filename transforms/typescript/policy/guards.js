import { isFunction } from '../../../analysis/host/function.js';
import { getObject } from '../../../analysis/host/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';
import { getSourceBinding } from '../understand/source-bindings.js';

// An authored presence observation retains the source binding. It supplies no
// callable/array admission and never inspects generated text or helper names.
const hasGuardFor = ({ typescript = {}, node = {}, binding = {}, checker = {} } = {}) => {
    const { Identifier = -1, TypeOfExpression = -1, BinaryExpression = -1,
        StringLiteral = -1, EqualsEqualsEqualsToken = -1, ExclamationEqualsEqualsToken = -1,
        AmpersandAmpersandToken = -1 } = getSyntaxKinds(typescript);
    const symbol = getSourceBinding({ typescript, node: binding, checker });

    if (!symbol) return false;

    const matches = candidate => getObject(candidate).kind === Identifier &&
        getSourceBinding({ typescript, node: candidate, checker }) === symbol;
    const observes = ({ kind = 0, left = {}, right = {}, operatorToken: { kind: operator = 0 } = {} } = {}) => {
        if (kind !== BinaryExpression) return false;

        if (operator === AmpersandAmpersandToken && matches(left)) return true;

        if (![EqualsEqualsEqualsToken, ExclamationEqualsEqualsToken].includes(operator)) return false;

        return [[left, right], [right, left]].some(([probe = {}, literal = {}] = []) =>(
            getObject(probe).kind === TypeOfExpression && matches(getObject(probe).expression) &&
            getObject(literal).kind === StringLiteral));
    };
    const visit = child => observes(child) || !!typescript.forEachChild(child, visit);

    return Boolean(node && visit(node));
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
    const { getResolvedSignature = false } = getObject(checker);
    const symbol = getSourceBinding({ typescript, node: parameterName, checker });
    const isParameter = (value) => {
        const { kind = 0, text = '' } = getObject(value);

        return kind === IdentifierKind2 &&
            text === paramText &&
            Boolean(symbol) && getSourceBinding({ typescript, node: value, checker }) === symbol;
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
            const { getSourceFile, parameters = [] } = getObject(declaration);
            const declarationSource = isFunction(getSourceFile)
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

            return (kind === IdentifierKind2 && text === 'undefined' &&
                !getSourceBinding({ typescript, node: value })) ||
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

export {
    hasGuardFor,
    hasObservedAbsenceFor
};
