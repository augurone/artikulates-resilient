import { getObject } from '../../../rules/support/object.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';

// Void marks the already-discarded chain result. The fulfillment resolver,
// rejection behavior, scheduling, and outer Promise settlement stay authored.
const lowerDetachedPromiseWork = ({
    typescript = {}, sourceFile = {}, destructuringAgreements = {}, context = {}
} = {}) => {
    const { SyntaxKind: { ExpressionStatement = -1, SingleLineCommentTrivia = -1 } = {},
        factory = {}, addSyntheticLeadingComment = false } = typescript;
    const { byKind = new Map() } = destructuringAgreements;
    const hasFact = byKind.has('detached-promise-forward');

    if (!hasFact) return sourceFile;

    const visit = (node = {}) => {
        const { kind = 0 } = getObject(node);
        const { agreement = {} } = kind === ExpressionStatement
            ? getDestructuringDecisionForNode({
                typescript,
                node,
                destructuringAgreements,
                kinds: ['detached-promise-forward']
            }) : {};
        const visited = typescript.visitEachChild(node, visit, context);

        if (getObject(agreement).action !== 'explicit-detached-promise-forwarding') return visited;

        const { expression = {} } = getObject(visited);

        const detached = factory.updateExpressionStatement(visited, factory.createVoidExpression(expression));

        return addSyntheticLeadingComment(detached, SingleLineCommentTrivia,
            ' eslint-disable-next-line resilient/prefer-async-await -- Source forwards fulfillment only; await changes rejection ownership.',
            true);
    };

    return typescript.visitNode(sourceFile, visit);
};

export { lowerDetachedPromiseWork };
