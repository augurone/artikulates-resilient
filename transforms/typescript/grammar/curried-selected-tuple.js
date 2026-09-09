import { getMemberAlias } from './member-access.js';
import { getObject } from '../../../rules/support/object.js';

const createCurriedSelectedTupleBinding = ({
    typescript = {}, node = {}, contract = {}, occupied = new Set(), context = {}
} = {}) => {
    const { factory = {}, NodeFlags: { Const: ConstKind = 0 } = {}, getOriginalNode = false } = typescript;
    const { callRange = '', readRange = '', receiverName = '', propertyName = '', index = -1 } = getObject(contract);
    const originalRange = (candidate = {}) => {
        const original = typeof getOriginalNode === 'function' ? getOriginalNode(candidate) : candidate;
        const { pos = -1, end = -1 } = getObject(original);

        return `${pos}:${end}`;
    };
    let target = {};
    const find = (child = {}) => {
        const { expression: precedingCall = {}, arguments: args = [] } = getObject(child);
        const [read = {}] = args;

        if (originalRange(child) === callRange && originalRange(read) === readRange) target = {
            call: child,
            precedingCall
        };

        typescript.forEachChild(child, find);
    };

    find(getObject(node).expression);

    const { precedingCall: targetCallee = false } = getObject(target);

    if (!targetCallee || !receiverName || !propertyName || index < 0) return node;

    const calleeName = getMemberAlias({ objectName: receiverName, propertyName: 'callee', occupied });
    const valueName = getMemberAlias({ objectName: receiverName, propertyName: String(index),
        occupied: new Set([...occupied, calleeName]) });
    const declaration = (name = {}, initializer = {}) => factory.createVariableStatement(undefined,
        factory.createVariableDeclarationList([
            factory.createVariableDeclaration(name, undefined, undefined, initializer)
        ], ConstKind));
    const stageCallee = declaration(factory.createIdentifier(calleeName), targetCallee);
    const selectValue = declaration(factory.createObjectBindingPattern([
        factory.createBindingElement(undefined, factory.createIdentifier(propertyName),
            factory.createObjectBindingPattern([
                factory.createBindingElement(undefined, factory.createNumericLiteral(index),
                    factory.createIdentifier(valueName), factory.createVoidExpression(factory.createNumericLiteral(0)))
            ]), undefined)
    ]), factory.createIdentifier(receiverName));
    const replace = (child = {}) => {
        if (originalRange(child) === callRange) {
            const { typeArguments = undefined } = getObject(child);

            return factory.updateCallExpression(child, factory.createIdentifier(calleeName),
                typeArguments, [factory.createIdentifier(valueName)]);
        }

        return typescript.visitEachChild(child, replace, context);
    };
    const nextExpression = replace(getObject(node).expression);

    const completed = factory.createBlock([stageCallee, selectValue,
        factory.updateReturnStatement(node, nextExpression)], true);

    Object.defineProperty(completed, '__resilientCurriedStage', {
        configurable: true,
        enumerable: false,
        value: true
    });

    return completed;
};

export { createCurriedSelectedTupleBinding };
