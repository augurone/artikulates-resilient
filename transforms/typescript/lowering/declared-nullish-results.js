import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds, updateFunction } from '../../utils/ast-boundary.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';

// The source declaration owns the result. A direct undefined return has the
// same normal value as a bare return, so construct that grammar. A declared
// null result must retain its value and receives an exact final boundary.
const annotateDeclaredNullishResults = ({
    typescript = {}, sourceFile = {}, destructuringAgreements = {},
    context = {}, annotationsOnly = false
} = {}) => {
    const { ArrowFunction = -1, Block = -1, ReturnStatement = -1,
        SingleLineCommentTrivia = -1 } = getSyntaxKinds(typescript);
    const { factory = {}, addSyntheticLeadingComment = false,
        getSyntheticLeadingComments = false } = typescript;
    const { byKind = new Map() } = destructuringAgreements;
    const hasDeclaredResult = byKind.has('declared-nullish-result');

    if (!hasDeclaredResult) return sourceFile;

    const getDecision = (expression = {}) => {
        const { agreement = {} } = getDestructuringDecisionForNode({
            typescript, node: expression, destructuringAgreements,
            kinds: ['declared-nullish-result']
        });
        const { action = '' } = getObject(agreement);

        return action;
    };

    if (!annotationsOnly) {
        const visit = (node = {}) => {
            const { kind = 0, body = {}, expression = {} } = getObject(node);
            const arrowAction = kind === ArrowFunction && getObject(body).kind !== Block
                ? getDecision(body) : '';
            const returnAction = kind === ReturnStatement ? getDecision(expression) : '';
            const visited = typescript.visitEachChild(node, visit, context);

            if (returnAction === 'normalize-empty-result') {
                // eslint-disable-next-line resilient/prefer-falsey-returns -- Undefined removes the proved sole terminal return from the AST.
                return undefined;
            }

            if (!arrowAction) return visited;

            const { body: visitedBody = {}, parameters = [] } = getObject(visited);
            const statements = arrowAction === 'normalize-empty-result' ? []
                : [factory.createReturnStatement(visitedBody)];

            return updateFunction({ typescript, node: visited, parameters,
                body: factory.createBlock(statements, Boolean(statements.length)) });
        };

        return typescript.visitNode(sourceFile, visit);
    }

    if (typeof addSyntheticLeadingComment !== 'function') return sourceFile;

    const visit = (node = {}) => {
        const { kind = 0, expression = {} } = getObject(node);
        const action = kind === ReturnStatement ? getDecision(expression) : '';
        const comments = typeof getSyntheticLeadingComments === 'function'
            ? getSyntheticLeadingComments(node) || [] : [];
        const alreadyAnnotated = comments.some(({ text = '' } = {}) => (
            text.includes('eslint-disable-next-line resilient/prefer-falsey-returns')
        ));

        if (['retain-declared-null-result', 'retain-declared-undefined-result'].includes(action) &&
            !alreadyAnnotated) addSyntheticLeadingComment(
            node,
            SingleLineCommentTrivia,
            ` eslint-disable-next-line resilient/prefer-falsey-returns -- Checker-declared result preserves authored ${
                action === 'retain-declared-null-result' ? 'null' : 'undefined'
            }.`,
            true
        );

        typescript.forEachChild(node, visit);
    };

    visit(sourceFile);

    return sourceFile;
};

export { annotateDeclaredNullishResults };
