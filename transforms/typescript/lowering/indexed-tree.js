import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds, updateVariableInitializer } from '../../utils/ast-boundary.js';
import { getSingleStatement } from '../../utils/compiler-shape.js';

const lowerIndexedTreeReducer = ({ typescript = {}, node = {} } = {}) => {
    const { statements = [] } = node;
    const { factory = {}, NodeFlags: { Const: constFlag = 0 } = {} } = typescript;
    const {
        VariableStatement = -1, VariableDeclarationList = -1, VariableDeclaration = -1,
        ForStatement = -1, ExpressionStatement = -1, BinaryExpression = -1,
        EqualsToken = -1, MinusToken = -1, GreaterThanEqualsToken = -1,
        PostfixUnaryExpression = -1, PlusPlusToken = -1, MinusMinusToken = -1,
        Identifier = -1, CallExpression = -1, ElementAccessExpression = -1,
        NumericLiteral = -1, LessThanToken = -1, EqualsGreaterThanToken = -1
    } = getSyntaxKinds(typescript);
    const isIdentifier = (value, expectedName = '') => {
        const { kind = 0, text = '' } = getObject(value);

        return kind === Identifier && (!expectedName || text === expectedName);
    };
    const getIndexAccess = ({ kind = 0, expression: collection = false, argumentExpression: index = false } = {}) => {
        return kind === ElementAccessExpression && isIdentifier(index) ? { collection, index } : {};
    };
    const getAssignment = ({ kind = 0, expression = {} } = {}) => {
        const { kind: expressionKind = 0, operatorToken: { kind: operatorKind = 0 } = {} } = expression;

        return kind === ExpressionStatement && expressionKind === BinaryExpression && operatorKind === EqualsToken
            ? expression
            : {};
    };
    const getReducer = ({ assignment = {}, accumulator = {}, direction = 'reduce' } = {}) => {
        const { right: pipeCall = {}, left = {} } = assignment;
        const { kind: pipeKind = 0, arguments: [child = {}, reducerCall = {}] = [], expression: pipeName = {} } = pipeCall;
        const { kind: reducerKind = 0, arguments: [previous = {}, reducer = {}] = [], expression: reducerName = {} } = reducerCall;
        const { text: accumulatorName = '' } = accumulator;
        const { collection = false, index = false } = getIndexAccess(child);
        const reducerFunction = direction === 'reduceRight' ? 'reduceRight' : 'reduce';

        if (pipeKind !== CallExpression || !isIdentifier(pipeName, 'pipe') || reducerKind !== CallExpression ||
            !isIdentifier(reducerName, reducerFunction) || !isIdentifier(left, accumulatorName) ||
            !isIdentifier(previous, accumulatorName) || !isIdentifier(reducer) || !collection || !index) return {};

        return { collection, index, reducer };
    };
    const getLoop = ({ loop = {}, accumulator = {}, direction = 'reduce' } = {}) => {
        const { kind: loopKind = 0, initializer = {}, condition = {}, statement = {}, incrementor = {} } = loop;
        const { kind: initializerKind = 0, declarations = [] } = initializer;
        const [{ name: indexBinding = {}, initializer: initialValue = {} } = {}] = declarations;
        const { text: indexName = '' } = indexBinding;
        const body = getSingleStatement({ typescript, node: statement });
        const assignment = getAssignment(body);
        const reduction = getReducer({ assignment, accumulator, direction });
        const { collection = false, reducer = false } = reduction;
        const { kind: incrementKind = 0, operator = 0, operand: { text: incrementName = '' } = {} } = incrementor;
        const {
            kind: conditionKind = 0, left: { text: conditionLeft = '' } = {},
            right: { kind: conditionRightKind = 0, text: conditionRight = '' } = {},
            operatorToken: { kind: conditionOperator = 0 } = {}
        } = condition;
        const {
            kind: initialKind = 0, text: initialText = '', left: { text: initialLeft = '' } = {},
            right: { kind: initialRightKind = 0, text: initialRight = '' } = {},
            operatorToken: { kind: initialOperator = 0 } = {}
        } = initialValue;
        const isRight = direction === 'reduceRight';
        const rightInitial = initialKind === BinaryExpression && initialOperator === MinusToken &&
            initialRightKind === NumericLiteral && initialRight === '1';
        const rightCondition = conditionOperator === GreaterThanEqualsToken &&
            conditionRightKind === NumericLiteral && conditionRight === '0';

        if (loopKind !== ForStatement || initializerKind !== VariableDeclarationList || declarations.length !== 1 ||
            !isIdentifier(indexBinding) || (!isRight && (initialKind !== NumericLiteral || initialText !== '0')) ||
            (isRight && !rightInitial) || conditionKind !== BinaryExpression ||
            (!isRight && conditionOperator !== LessThanToken) || conditionLeft !== indexName ||
            (isRight && !rightCondition) || incrementKind !== PostfixUnaryExpression ||
            operator !== (isRight ? MinusMinusToken : PlusPlusToken) || incrementName !== indexName ||
            !collection || !reducer) return {};

        return { ...reduction, indexName, lengthName: isRight ? initialLeft : conditionRight };
    };
    const getArrayReducer = ({ accumulator = {}, loop = {}, initializer = {}, direction = 'reduce' } = {}) => {
        const { collection = false, reducer = false } = getLoop({ loop, accumulator, direction });

        if (!collection || !reducer) return {};

        const { initializer: initial = {}, name = {} } = accumulator;
        const { text: accumulatorName = '' } = name;
        const { declarationList = {} } = initializer;
        const arrayReducer = factory.createPropertyAccessExpression(collection, factory.createIdentifier(direction));
        const callback = factory.createArrowFunction(
            undefined, undefined,
            [
                factory.createParameterDeclaration(undefined, undefined, name, undefined, undefined, undefined),
                factory.createParameterDeclaration(undefined, undefined, factory.createIdentifier('child'), undefined, undefined, undefined)
            ],
            undefined, factory.createToken(EqualsGreaterThanToken),
            factory.createCallExpression(factory.createIdentifier('pipe'), undefined, [
                factory.createIdentifier('child'),
                factory.createCallExpression(factory.createIdentifier(direction), undefined, [
                    factory.createIdentifier(accumulatorName), reducer
                ])
            ])
        );
        const nextInitializer = factory.createCallExpression(arrayReducer, undefined, [callback, initial]);

        return updateVariableInitializer({
            factory,
            collection: { statement: initializer, declarationList, declaration: accumulator },
            initializer: nextInitializer,
            flags: constFlag
        });
    };
    const findCandidate = (direction = 'reduce') => {
        const matchesReturn = ({ returnExpression = {}, accumulator: { name: { text: accumulatorName = '' } = {} } = {}, reduction = {} } = {}) => {
            if (direction === 'reduce') return isIdentifier(returnExpression, accumulatorName);

            const { reducer = false } = reduction;
            const { text: reducerName = '' } = getObject(reducer);
            const { expression = {}, arguments: [, previous = {}] = [] } = returnExpression;

            return reducer && isIdentifier(expression, reducerName) && isIdentifier(previous, accumulatorName);
        };
        const getCandidate = (index = -1) => {
            const [initializer = {}, lengthStatement = {}, loop = {}, returnStatement = {}] = statements.slice(index, index + 4);
            const { kind: initializerKind = 0, declarationList = {} } = initializer;
            const { kind: declarationListKind = 0, declarations = [], flags = 0 } = declarationList;
            const [accumulator = {}] = declarations;
            const { kind: accumulatorKind = 0, name: accumulatorName = {} } = accumulator;
            const {
                kind: lengthStatementKind = 0,
                declarationList: { declarations: [{ name: lengthBinding = {} } = {}] = [] } = {}
            } = lengthStatement;
            const { text: lengthBindingName = '' } = lengthBinding;
            const reduction = getLoop({ loop, accumulator, direction });
            const { lengthName = '', collection = false } = reduction;
            const { expression: returnExpression = {} } = returnStatement;

            if (initializerKind !== VariableStatement || declarationListKind !== VariableDeclarationList ||
                flags & constFlag || declarations.length !== 1 || accumulatorKind !== VariableDeclaration ||
                !isIdentifier(accumulatorName) || lengthStatementKind !== VariableStatement || !isIdentifier(lengthBinding) ||
                !matchesReturn({ returnExpression, accumulator, reduction }) || lengthName !== lengthBindingName || !collection) return {};

            return { index, replacement: getArrayReducer({ accumulator, loop, initializer, direction }), direction };
        };
        const candidate = statements.map((_, index) => index)
            .filter(index => index < statements.length - 2)
            .map(getCandidate)
            .find(({ replacement: { kind = 0 } = {} } = {}) => kind);

        return candidate || {};
    };
    const reduceCandidate = findCandidate('reduce');
    const { replacement: reduceReplacement = false } = reduceCandidate;
    const { replacement = false, index = -1 } = reduceReplacement ? reduceCandidate : findCandidate('reduceRight');

    if (!replacement) return node;

    const [returnStatement = {}] = statements.slice(index + 3, index + 4);

    return factory.updateBlock(node, [
        ...statements.slice(0, index), replacement, returnStatement, ...statements.slice(index + 4)
    ]);
};

export { lowerIndexedTreeReducer };
