import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds, updateFunction } from '../../utils/ast-boundary.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';

// An authored global-console call is an observable I/O boundary. Placement
// consumes its source fact; it never decides from generated `console` syntax.
const annotateConsoleEffects = ({
    typescript = {}, sourceFile = {}, destructuringAgreements = {}, context = {}
} = {}) => {
    const { ArrowFunction = -1, CallExpression = -1, ReturnStatement = -1, ExpressionStatement = -1,
        SingleLineCommentTrivia = -1 } = getSyntaxKinds(typescript);
    const { factory = {}, addSyntheticLeadingComment = false, getSyntheticLeadingComments = false } = typescript;
    const { byKind = new Map() } = destructuringAgreements;
    const hasConsoleFact = byKind.has('console-effect');

    if (!hasConsoleFact || typeof addSyntheticLeadingComment !== 'function') return sourceFile;

    const ownsCall = (call = {}) => {
        const { agreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node: call,
            destructuringAgreements,
            kinds: ['console-effect']
        });

        return getObject(agreement).action === 'retain-console-effect';
    };
    const annotate = (statement = {}) => {
        const comments = typeof getSyntheticLeadingComments === 'function'
            ? getSyntheticLeadingComments(statement) || []
            : [];

        return comments.some(({ text = '' } = {}) => text.includes('eslint-disable-next-line no-console'))
            ? statement
            : addSyntheticLeadingComment(
                statement,
                SingleLineCommentTrivia,
                ' eslint-disable-next-line no-console -- Authored console call owns observable I/O at invocation.',
                true
            );
    };
    const visit = (node = {}) => {
        const visited = typescript.visitEachChild(node, visit, context);
        const { kind = 0, body = {}, expression = {} } = getObject(visited);

        if (kind === ArrowFunction && getObject(body).kind === CallExpression && ownsCall(body)) {
            const returned = annotate(factory.createReturnStatement(body));
            const block = factory.createBlock([returned], true);
            const { parameters = [] } = getObject(visited);

            return updateFunction({ typescript, node: visited, parameters, body: block });
        }

        return [ReturnStatement, ExpressionStatement].includes(kind) && ownsCall(expression)
            ? annotate(visited)
            : visited;
    };

    return typescript.visitNode(sourceFile, visit);
};

export { annotateConsoleEffects };
