import { getMemberAlias } from './member-access.js';
import { getObject } from '../../../rules/support/object.js';

const createDeferredSelectedPayloadBinding = ({
    typescript = {}, node = {}, contract = {}, occupied = new Set(), context = {}
} = {}) => {
    const { factory = {}, NodeFlags: { Const: ConstKind = 0 } = {} } = typescript;
    const { callbackRange = '', readRange = '', receiverName = '', propertyName = '' } = getObject(contract);
    const { body = {}, parameters = [], modifiers = [], typeParameters = [], type = undefined } = getObject(node);
    const { getOriginalNode = false } = typescript;
    const original = typeof getOriginalNode === 'function' ? getOriginalNode(node) : node;
    const { pos = -1, end = -1 } = getObject(original);
    let replaced = false;
    const alias = getMemberAlias({ objectName: receiverName, propertyName, occupied });
    const replace = (child = {}) => {
        const source = typeof getOriginalNode === 'function' ? getOriginalNode(child) : child;
        const { pos: readPos = -1, end: readEnd = -1 } = getObject(source);

        if (`${readPos}:${readEnd}` === readRange) {
            replaced = true;

            return factory.createIdentifier(alias);
        }

        return typescript.visitEachChild(child, replace, context);
    };

    if (`${pos}:${end}` !== callbackRange || !receiverName || !propertyName || !readRange) return node;

    const nextBody = replace(body);

    if (!replaced) return node;

    const binding = factory.createVariableStatement(undefined, factory.createVariableDeclarationList([
        factory.createVariableDeclaration(factory.createObjectBindingPattern([
            factory.createBindingElement(
                undefined,
                factory.createIdentifier(propertyName),
                factory.createIdentifier(alias),
                factory.createVoidExpression(factory.createNumericLiteral(0))
            )
        ]), undefined, undefined, factory.createIdentifier(receiverName))
    ], ConstKind));

    return factory.updateArrowFunction(
        node,
        modifiers,
        typeParameters,
        parameters,
        type,
        getObject(node).equalsGreaterThanToken,
        factory.createBlock([binding, factory.createReturnStatement(nextBody)], true)
    );
};

export { createDeferredSelectedPayloadBinding };
