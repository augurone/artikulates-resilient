import { getMemberAlias } from './member-access.js';
import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';

const createIndexedLocalSelection = ({ typescript = {}, node = {}, contract = {}, occupied = new Set() } = {}) => {
    const { factory = {}, NodeFlags: { Const: ConstKind = 0 } = {} } = typescript;
    const { Block = -1, EqualsToken = -1, PlusToken = -1 } = getSyntaxKinds(typescript);
    const { statement: body = {}, initializer = {}, condition = {}, incrementor = {} } = getObject(node);
    const { kind: bodyKind = 0, statements = [] } = getObject(body);
    const [selected = {}, interim = {}, firstWrite = {}, secondWrite = {}] = statements;
    const { expression: firstAssignment = {} } = getObject(firstWrite);
    const { left: firstAccumulator = {}, right: firstSum = {} } = getObject(firstAssignment);
    const { left: firstPrefix = {}, right: firstRead = {} } = getObject(firstSum);
    const { expression: secondAssignment = {} } = getObject(secondWrite);
    const { left: secondAccumulator = {}, right: secondCall = {} } = getObject(secondAssignment);
    const { expression: callee = {}, arguments: [secondPrefix = {}, secondRead = {}] = [],
        typeArguments = undefined } = getObject(secondCall);
    const {
        loopRange = '', firstReadRange = '', secondReadRange = '',
        selectionName = '', accumulatorName = '', firstProperty = '', secondProperty = ''
    } = getObject(contract);
    const { getOriginalNode = false } = typescript;
    const range = (value = {}) => {
        const original = typeof getOriginalNode === 'function' ? getOriginalNode(value) : value;
        const { pos = -1, end = -1 } = getObject(original);

        return `${pos}:${end}`;
    };

    if (bodyKind !== Block || statements.length !== 4 || range(node) !== loopRange ||
        range(firstRead) !== firstReadRange || range(secondRead) !== secondReadRange ||
        !selectionName || !accumulatorName || !firstProperty || !secondProperty ||
        getObject(firstAccumulator).text !== accumulatorName ||
        getObject(secondAccumulator).text !== accumulatorName) return node;

    let used = new Set(occupied);
    const fresh = (objectName = '', propertyName = '') => {
        const name = getMemberAlias({ objectName, propertyName, occupied: used });

        used = new Set([...used, name]);

        return name;
    };
    const firstPriorName = fresh(accumulatorName, 'prior');
    const firstPrefixName = fresh(accumulatorName, 'prefix');
    const firstValueName = fresh(selectionName, firstProperty);
    const secondPriorName = fresh(accumulatorName, 'prior2');
    const calleeName = fresh(getObject(callee).text || 'callee', 'call');
    const secondPrefixName = fresh(accumulatorName, 'argument');
    const secondValueName = fresh(selectionName, secondProperty);
    const declaration = (name = {}, expression = {}) => factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
            factory.createVariableDeclaration(name, undefined, undefined, expression)
        ], ConstKind)
    );
    const named = (name = '', expression = {}) => declaration(factory.createIdentifier(name), expression);
    const field = (property = '', alias = '', receiver = {}) => declaration(factory.createObjectBindingPattern([
        factory.createBindingElement(
            undefined,
            factory.createIdentifier(property),
            factory.createIdentifier(alias),
            factory.createVoidExpression(factory.createNumericLiteral(0))
        )
    ]), receiver);
    const nextFirstSum = factory.createBinaryExpression(
        factory.createIdentifier(firstPrefixName),
        PlusToken,
        factory.createIdentifier(firstValueName)
    );
    const nextFirstAssignment = factory.updateBinaryExpression(firstAssignment, firstAccumulator,
        factory.createToken(EqualsToken),
        factory.createBinaryExpression(factory.createIdentifier(firstPriorName), PlusToken, nextFirstSum));
    const nextSecondCall = factory.updateCallExpression(secondCall, factory.createIdentifier(calleeName),
        typeArguments, [factory.createIdentifier(secondPrefixName), factory.createIdentifier(secondValueName)]);
    const nextSecondAssignment = factory.updateBinaryExpression(secondAssignment, secondAccumulator,
        factory.createToken(EqualsToken),
        factory.createBinaryExpression(factory.createIdentifier(secondPriorName), PlusToken, nextSecondCall));
    const nextBody = factory.updateBlock(body, [
        selected,
        interim,
        named(firstPriorName, firstAccumulator),
        named(firstPrefixName, firstPrefix),
        field(firstProperty, firstValueName, getObject(firstRead).expression),
        factory.updateExpressionStatement(firstWrite, nextFirstAssignment),
        named(secondPriorName, secondAccumulator),
        named(calleeName, callee),
        named(secondPrefixName, secondPrefix),
        field(secondProperty, secondValueName, getObject(secondRead).expression),
        factory.updateExpressionStatement(secondWrite, nextSecondAssignment)
    ]);

    return factory.updateForStatement(node, initializer, condition, incrementor, nextBody);
};

export { createIndexedLocalSelection };
