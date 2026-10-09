import { getObject } from '../../../analysis/host/object.js';
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
    const tupleDiscards = (pattern = {}) => {
        const { elements = [] } = getObject(pattern);

        return elements.flatMap((element) => {
            const { name = {} } = getObject(element);

            if (outcome(element) !== 'retain-tuple-slot-discard-binding') return tupleDiscards(name);

            const { text = '' } = getObject(name);

            return [text].filter(Boolean);
        });
    };
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
        const names = parameters.flatMap((parameter) => {
            const { name = {} } = getObject(parameter);

            return outcome(parameter) === 'retain-arity-discard-parameter'
                ? [getObject(name).text].filter(Boolean) : tupleDiscards(name);
        });

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

        const { modifiers, typeParameters, parameters: visitedParameters = [],
            type, equalsGreaterThanToken } = getObject(visited);

        if (kind === ArrowFunction) return factory.updateArrowFunction(visited, modifiers, typeParameters,
            visitedParameters, type, equalsGreaterThanToken, updatedBody);

        const { asteriskToken, name } = getObject(visited);

        return factory.updateFunctionDeclaration(visited, modifiers, asteriskToken, name,
            typeParameters, visitedParameters, type, updatedBody);
    };

    return visitNode(sourceFile, visit);
};

export { lowerUnusedBindings };
