import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';

// The agreement owns the source binding, not a generated name. Placement
// preserves the catch phase, iterator advancement, and parameter arity.
const lowerUnusedBindings = ({ typescript = {}, sourceFile = {},
    destructuringAgreements = {}, context = {} } = {}) => {
    const { factory = {} } = typescript;
    const { visitNode = false, visitEachChild = false } = typescript;
    const {
        CatchClause = -1, ArrowFunction = -1, FunctionDeclaration = -1,
        ExpressionStatement = -1, StringLiteral = -1
    } = getSyntaxKinds(typescript);
    const outcome = node => getDestructuringDecisionForNode({
        typescript, node, destructuringAgreements, kinds: ['unused-binding']
    }).agreement.action || '';
    const discard = name => factory.createExpressionStatement(factory.createVoidExpression(
        factory.createIdentifier(name)
    ));
    const visit = (node = {}) => {
        if (!node) return node;

        const { kind = 0 } = getObject(node);

        if (kind === CatchClause && outcome(node) === 'omit-unused-catch') {
            const { block: catchBlock = {} } = getObject(node);

            return factory.updateCatchClause(node, undefined,
                visitNode(catchBlock, visit));
        }

        const visited = visitEachChild(node, visit, context);

        if (![ArrowFunction, FunctionDeclaration].includes(kind)) return visited;

        const parameters = getObject(node).parameters || [];
        const names = parameters.filter(parameter => outcome(parameter) === 'retain-arity-discard-parameter')
            .map(({ name = {} } = {}) => getObject(name).text || '')
            .filter(Boolean);

        if (!names.length) return visited;

        const { body = {} } = getObject(visited);
        const { statements = false } = getObject(body);
        const block = Array.isArray(statements)
            ? body
            : factory.createBlock([factory.createReturnStatement(body)], true);
        const bodyStatements = getObject(block).statements || [];
        const directiveCount = bodyStatements.findIndex((statement) => {
            const { kind: statementKind = 0, expression = {} } = getObject(statement);

            return statementKind !== ExpressionStatement || getObject(expression).kind !== StringLiteral;
        });
        const insertion = directiveCount < 0 ? bodyStatements.length : directiveCount;
        const updatedBody = factory.updateBlock(block, [
            ...bodyStatements.slice(0, insertion),
            ...names.map(discard),
            ...bodyStatements.slice(insertion)
        ]);

        const { modifiers = undefined, typeParameters = undefined, parameters: visitedParameters = [],
            type = undefined, equalsGreaterThanToken = undefined } = getObject(visited);

        if (kind === ArrowFunction) return factory.updateArrowFunction(visited, modifiers, typeParameters,
            visitedParameters, type, equalsGreaterThanToken, updatedBody);

        const { asteriskToken = undefined, name = undefined } = getObject(visited);

        return factory.updateFunctionDeclaration(visited, modifiers, asteriskToken, name,
            typeParameters, visitedParameters, type, updatedBody);
    };

    return visitNode(sourceFile, visit);
};

export { lowerUnusedBindings };
