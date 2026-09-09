import { getMemberAlias } from './member-access.js';
import { getObject } from '../../../rules/support/object.js';

const createMutableSelectedLoop = ({
    typescript = {}, loop = {}, exit = {}, contract = {}, occupied = new Set(), context = {}
} = {}) => {
    const { factory = {}, NodeFlags: { Const: ConstKind = 0 } = {}, SyntaxKind = {} } = typescript;
    const { ExclamationEqualsEqualsToken = -1 } = SyntaxKind;
    const { statement: body = {}, expression: condition = {} } = getObject(loop);
    const { statements = [] } = getObject(body);
    const [first = {}, second = {}, third = {}] = statements;
    const { receiverName = '', leftRange = '', rightRange = '' } = getObject(contract);
    const { getOriginalNode = false } = typescript;
    const tagAlias = getMemberAlias({ objectName: receiverName, propertyName: '_tag', occupied });
    const leftAlias = getMemberAlias({ objectName: receiverName, propertyName: 'left',
        occupied: new Set([...occupied, tagAlias]) });
    const rightAlias = getMemberAlias({ objectName: receiverName, propertyName: 'right',
        occupied: new Set([...occupied, tagAlias, leftAlias]) });
    const replace = (node = {}, range = '', alias = '') => {
        const visit = (child = {}) => {
            const original = typeof getOriginalNode === 'function' ? getOriginalNode(child) : child;
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
    const tagBinding = binding('_tag', tagAlias);
    const leftBinding = binding('left', leftAlias);
    const rightBinding = binding('right', rightAlias);
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
