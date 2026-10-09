import { isFunction } from '../../../analysis/host/function.js';
import { getObject } from '../../../analysis/host/object.js';
import { getMemberAlias } from './member-access.js';

const createMutableSelectedLoop = ({
    typescript = {}, loop = {}, exit = {}, contract = {}, occupied = new Set(), context = {}
} = {}) => {
    const { factory = {}, NodeFlags: { Const: ConstKind = 0 } = {}, SyntaxKind = {} } = typescript;
    const { ExclamationEqualsEqualsToken = -1 } = SyntaxKind;
    const { statement: body = {}, expression: condition = {} } = getObject(loop);
    const { statements = [] } = getObject(body);
    const [first = {}, second = {}, third = {}] = statements;
    const { receiverName = '', leftRange = '', rightRange = '', discriminator = '', bodyField = '', exitField = '' } = getObject(contract);
    const { getOriginalNode } = typescript;
    const tagAlias = getMemberAlias({ objectName: receiverName, propertyName: discriminator, occupied });
    const leftAlias = getMemberAlias({ objectName: receiverName, propertyName: bodyField,
        occupied: new Set([...occupied, tagAlias]) });
    const rightAlias = getMemberAlias({ objectName: receiverName, propertyName: exitField,
        occupied: new Set([...occupied, tagAlias, leftAlias]) });
    const replace = (node = {}, range = '', alias = '') => {
        const visit = (child = {}) => {
            const original = isFunction(getOriginalNode) ? getOriginalNode(child) : child;
            const { pos = -1, end = -1 } = getObject(original);

            return `${pos}:${end}` === range
                ? factory.createIdentifier(alias)
                : typescript.visitEachChild(child, visit, context);
        };

        return visit(node);
    };
    const binding = (property = '', alias = '') => factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
            factory.createVariableDeclaration(factory.createObjectBindingPattern([
                factory.createBindingElement(
                    undefined,
                    factory.createIdentifier(property),
                    factory.createIdentifier(alias),
                    factory.createVoidExpression(factory.createNumericLiteral(0))
                )
            ]), undefined, undefined, factory.createIdentifier(receiverName))
        ], ConstKind)
    );
    const tagBinding = binding(discriminator, tagAlias);
    const leftBinding = binding(bodyField, leftAlias);
    const rightBinding = binding(exitField, rightAlias);
    const guard = factory.createIfStatement(
        factory.createBinaryExpression(
            factory.createIdentifier(tagAlias),
            ExclamationEqualsEqualsToken,
            getObject(condition).right
        ),
        factory.createBlock([factory.createBreakStatement()], true),
        undefined
    );
    const nextBody = factory.updateBlock(body, [
        tagBinding,
        guard,
        first,
        leftBinding,
        replace(second, leftRange, leftAlias),
        third
    ]);
    const nextLoop = factory.updateWhileStatement(loop, factory.createTrue(), nextBody);
    const nextExit = replace(exit, rightRange, rightAlias);

    return [nextLoop, rightBinding, nextExit];
};

export { createMutableSelectedLoop };
