import { getMemberAlias } from './member-access.js';
import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';

const createIteratorPayloadBinding = ({
    typescript = {}, node = {}, contract = {}, agreement = {}, occupied = new Set(), context = {}
} = {}) => {
    const { factory = {}, NodeFlags: { Const: ConstKind = 0 } = {} } = typescript;
    const { Block = -1, VariableStatement = -1 } = getSyntaxKinds(typescript);
    const { statement: body = {}, expression: condition = {} } = getObject(node);
    const { kind: bodyKind = 0, statements = [] } = getObject(body);
    const { resultName = '', readRange = '' } = getObject(contract);
    const { action = '' } = agreement;
    const [first = {}] = statements;
    const { getOriginalNode = false } = typescript;
    const { kind: firstKind = 0, declarationList = {}, modifiers = [] } = getObject(first);
    const { declarations = [] } = getObject(declarationList);
    const [declaration = {}] = declarations;
    const { name: localName = {}, initializer: localRead = {} } = getObject(declaration);
    const originalLocalRead = typeof getOriginalNode === 'function'
        ? getOriginalNode(localRead)
        : localRead;
    const { pos: localPos = -1, end: localEnd = -1 } = getObject(originalLocalRead);

    if (action === 'iterator-payload-local-declaration' && firstKind === VariableStatement &&
        `${localPos}:${localEnd}` === readRange) {
        const pattern = factory.createObjectBindingPattern([
            factory.createBindingElement(
                undefined,
                factory.createIdentifier('value'),
                localName,
                factory.createVoidExpression(factory.createNumericLiteral(0))
            )
        ]);
        const nextDeclaration = factory.updateVariableDeclaration(
            declaration, pattern, undefined, undefined, factory.createIdentifier(resultName)
        );
        const nextList = factory.updateVariableDeclarationList(declarationList, [nextDeclaration]);
        const nextFirst = factory.updateVariableStatement(first, modifiers, nextList);
        const nextBody = factory.updateBlock(body, [nextFirst, ...statements.slice(1)]);

        return factory.updateWhileStatement(node, condition, nextBody);
    }

    let replaced = false;
    const alias = getMemberAlias({ objectName: resultName, propertyName: 'value', occupied });
    const replace = (child = {}) => {
        const original = typeof getOriginalNode === 'function' ? getOriginalNode(child) : child;
        const { pos = -1, end = -1 } = getObject(original);

        if (`${pos}:${end}` === readRange) {
            replaced = true;

            return factory.createIdentifier(alias);
        }

        return typescript.visitEachChild(child, replace, context);
    };

    if (bodyKind !== Block || !resultName || !readRange || !statements.length) return node;

    const nextFirst = replace(first);

    if (!replaced) return node;

    const pattern = factory.createObjectBindingPattern([
        factory.createBindingElement(
            undefined,
            factory.createIdentifier('value'),
            factory.createIdentifier(alias),
            factory.createVoidExpression(factory.createNumericLiteral(0))
        )
    ]);
    const binding = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
            factory.createVariableDeclaration(pattern, undefined, undefined, factory.createIdentifier(resultName))
        ], ConstKind)
    );
    const nextBody = factory.updateBlock(body, [binding, nextFirst, ...statements.slice(1)]);

    return factory.updateWhileStatement(node, condition, nextBody);
};

export { createIteratorPayloadBinding };
