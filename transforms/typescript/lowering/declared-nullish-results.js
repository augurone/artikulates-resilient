import { put } from '../../../analysis/collections.js';
import { isFunction } from '../../../analysis/host/function.js';
import { getObject } from '../../../analysis/host/object.js';
import { getSyntaxKinds, updateFunction } from '../../utils/ast-boundary.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';

// The source declaration owns the result. A direct undefined return has the
// same normal value as a bare return, so construct that grammar. A declared
// null result must retain its value and receives an exact final boundary.
const annotateDeclaredNullishResults = ({
    typescript = {}, sourceFile = {}, destructuringAgreements = {},
    context = {}, annotationsOnly = false
} = {}) => {
    const { ArrowFunction = -1, FunctionExpression = -1, FunctionDeclaration = -1, SourceFile = -1, Block = -1, ReturnStatement = -1,
        SingleLineCommentTrivia = -1 } = getSyntaxKinds(typescript);
    const { factory = {}, addSyntheticLeadingComment, NodeFlags: { Let = 0 } = {},
        getSyntheticLeadingComments } = typescript;
    const { byKind = new Map() } = destructuringAgreements;
    const hasDeclaredResult = byKind.has('declared-nullish-result');

    if (!hasDeclaredResult) return sourceFile;

    const getDecision = (expression = {}) => {
        const { entry: { kind = '' } = {}, agreement = {} } = getDestructuringDecisionForNode({
            typescript, node: expression, destructuringAgreements,
            kinds: ['declared-nullish-result']
        });
        const { action = '' } = getObject(agreement);

        return kind === 'declared-nullish-result' ? action : '';
    };

    if (!annotationsOnly) {
        const scopes = new Set([SourceFile, Block, ArrowFunction, FunctionExpression, FunctionDeclaration]);
        const names = new WeakMap();
        const prependAbsence = (statements = [], name) => {
            const first = statements.findIndex((statement = {}) => {
                const { expression = {} } = statement;

                return !typescript.isExpressionStatement(statement) || !typescript.isStringLiteral(expression);
            });
            const position = first < 0 ? statements.length : first;
            const declaration = factory.createVariableStatement(undefined, factory.createVariableDeclarationList([
                factory.createVariableDeclaration(name, undefined, undefined, undefined)
            ], Let));

            return [...statements.slice(0, position), declaration, ...statements.slice(position)];
        };
        const insertAbsence = (node = {}, absent) => {
            const { kind = 0, statements = [], body = {}, parameters = [] } = getObject(node);

            if (kind === SourceFile) return factory.updateSourceFile(node, prependAbsence(statements, absent));

            if (kind === Block) return factory.updateBlock(node, prependAbsence(statements, absent));

            const { kind: bodyKind = 0, statements: bodyStatements = [] } = body;

            return updateFunction({ typescript, node, parameters,
                body: factory.createBlock(prependAbsence(bodyKind === Block ? bodyStatements : [factory.createReturnStatement(body)], absent), true) });
        };
        const visit = (node = {}, enclosing = sourceFile) => {
            const { kind = 0, body = {}, expression = {} } = getObject(node);
            const scope = scopes.has(kind) ? node : enclosing;

            if (getDecision(node) === 'normalize-created-absence-slot') {
                return names.get(scope) || put(names, scope, factory.createUniqueName('__resilient_absent'));
            }

            const arrowAction = kind === ArrowFunction && getObject(body).kind !== Block
                ? getDecision(body) : '';
            const returnAction = kind === ReturnStatement ? getDecision(expression) : '';
            const visited = typescript.visitEachChild(node, child => visit(child, scope), context);
            const absent = names.get(node);

            if (absent) return insertAbsence(visited, absent);

            if (returnAction === 'normalize-empty-result') {
                // eslint-disable-next-line resilient/prefer-falsey-returns -- Undefined removes the proved sole terminal return from the AST.
                return undefined;
            }

            if (!['normalize-empty-result', 'retain-declared-null-result', 'retain-declared-undefined-result'].includes(arrowAction)) return visited;

            const { body: visitedBody = {}, parameters = [] } = getObject(visited);
            const statements = arrowAction === 'normalize-empty-result' ? []
                : [factory.createReturnStatement(visitedBody)];

            return updateFunction({ typescript, node: visited, parameters,
                body: factory.createBlock(statements, Boolean(statements.length)) });
        };

        return typescript.visitNode(sourceFile, node => visit(node));
    }

    if (!isFunction(addSyntheticLeadingComment)) return sourceFile;

    const visit = (node = {}) => {
        const { kind = 0, expression = {} } = getObject(node);
        const visited = typescript.visitEachChild(node, visit, context);
        const action = kind === ReturnStatement ? getDecision(expression) : '';
        const comments = isFunction(getSyntheticLeadingComments)
            ? getSyntheticLeadingComments(visited) || [] : [];
        const alreadyAnnotated = comments.some(({ text = '' } = {}) => (
            text.includes('eslint-disable-next-line resilient/prefer-falsey-returns')
        ));

        if (['retain-declared-null-result', 'retain-declared-undefined-result'].includes(action) &&
            !alreadyAnnotated) addSyntheticLeadingComment(
            visited,
            SingleLineCommentTrivia,
            ` eslint-disable-next-line resilient/prefer-falsey-returns -- Checker-declared result preserves authored ${
                action === 'retain-declared-null-result' ? 'null' : 'undefined'
            }.`,
            true
        );

        return visited;
    };

    return typescript.visitNode(sourceFile, visit);
};

export { annotateDeclaredNullishResults };
