import { getSyntaxKinds } from '../../utils/ast-boundary.js';

const hasEmptyArrayGuardAfter = ({ typescript = {}, node = {}, sourceName = '' } = {}) => {
    const {
        VariableStatement = -1, VariableDeclaration = -1, IfStatement = -1,
        BinaryExpression = -1, EqualsEqualsToken = -1,
        EqualsEqualsEqualsToken = -1, Identifier = -1, NumericLiteral = -1,
        PropertyAccessExpression = -1, Block = -1
    } = getSyntaxKinds(typescript);
    const statement = Array.from({ length: 100 }, () => 0).reduce((candidate = {}) => {
        const { kind = 0, parent = {} } = candidate;

        if (kind === VariableStatement) return candidate;

        return parent;
    }, node);
    const { parent: block = {} } = statement;
    const { kind: blockKind = 0, statements = [] } = block;
    const statementIndex = statements.indexOf(statement);

    if (!sourceName || blockKind !== Block || statementIndex < 0) return false;

    let lengthNames = new Set([sourceName]);
    statements.slice(0, statementIndex).forEach(({ declarationList = {}, kind: candidateKind = 0 } = {}) => {
        if (candidateKind !== VariableStatement) return;

        const { declarations = [] } = declarationList;
        declarations.forEach(({ initializer = {}, ...declaration } = {}) => {
            const { kind: declarationKind = 0 } = declaration;
            const { kind: initializerKind = 0 } = initializer;

            if (declarationKind !== VariableDeclaration || initializerKind !== PropertyAccessExpression) return;

            const { expression = {}, name: propertyName = {} } = initializer;
            const { name = {} } = declaration;
            const { text = '' } = name;
            const { text: expressionText = '' } = expression;
            const { kind: propertyKind = 0, text: propertyText = '' } = propertyName;

            if (expressionText === sourceName && propertyKind === Identifier && propertyText === 'length') {
                lengthNames = new Set([...lengthNames, text]);
            }
        });
    });

    return statements.some(({ expression = {}, kind: candidateKind = 0 } = {}) => {
        const { kind: expressionKind = 0 } = expression;

        if (candidateKind !== IfStatement || expressionKind !== BinaryExpression) return false;

        const { operatorToken = {}, left = {}, right = {} } = expression;

        const { kind: operatorKind = 0 } = operatorToken;

        if (![EqualsEqualsToken, EqualsEqualsEqualsToken].includes(operatorKind)) return false;

        return [[left, right], [right, left]].some(([
            { kind: operandKind = 0, text: operandText = '' } = {},
            { kind: otherKind = 0, text: otherText = '' } = {}
        ] = []) => {
            return operandKind === Identifier && lengthNames.has(operandText) && otherKind === NumericLiteral && Number(otherText) === 0;
        });
    });
};

const hasArrayLengthDecision = ({ typescript = {}, node = {}, sourceName = '' } = {}) => {
    const {
        Block = -1,
        IfStatement = -1,
        BinaryExpression = -1,
        PropertyAccessExpression = -1,
        Identifier = -1,
        NumericLiteral = -1,
        GreaterThanToken = -1,
        GreaterThanEqualsToken = -1,
        LessThanToken = -1,
        LessThanEqualsToken = -1
    } = getSyntaxKinds(typescript);

    if (!sourceName) return false;

    let current = node;
    // eslint-disable-next-line resilient/prefer-prototype-methods -- Guard discovery scans outward blocks after parent Get; prewalking changes failure timing.
    while (current) {
        const { kind: currentKind = 0, statements = [], parent = false } = current;

        if (currentKind !== Block) {
            current = parent;
            continue;
        }

        const found = statements.some(({ expression = {}, kind: candidateKind = 0 } = {}) => {
            const { kind: conditionKind = 0, operatorToken = {}, left = {}, right = {} } = expression;
            const { kind: operatorKind = 0 } = operatorToken;

            if (candidateKind !== IfStatement || conditionKind !== BinaryExpression) return false;

            if (![GreaterThanToken, GreaterThanEqualsToken, LessThanToken, LessThanEqualsToken].includes(operatorKind)) return false;

            return [[left, right], [right, left]].some(([
                { kind: operandKind = 0, expression: operandExpression = {}, name: operandName = {} } = {},
                { kind: otherKind = 0 } = {}
            ] = []) => {
                const { kind: expressionKind = 0, text: expressionText = '' } = operandExpression;
                const { text: nameText = '' } = operandName;

                return operandKind === PropertyAccessExpression && expressionKind === Identifier && expressionText === sourceName && nameText === 'length' && otherKind === NumericLiteral;
            });
        });

        if (found) return true;

        current = parent;
    }

    return false;
};

export { hasArrayLengthDecision, hasEmptyArrayGuardAfter };
