import { getObject } from '../../../rules/support/object.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';

// The source comparison owns the nullish operation. Annotate only the
// statement recorded by Understand; generated syntax does not classify it.
const annotateRetainedNullishEquality = ({
    typescript = {}, sourceFile = {}, destructuringAgreements = {}, context = {}
} = {}) => {
    const { SyntaxKind: { VariableStatement = -1, ReturnStatement = -1,
        IfStatement = -1, ExpressionStatement = -1,
        SingleLineCommentTrivia = -1 } = {}, addSyntheticLeadingComment = false } = typescript;

    if (typeof addSyntheticLeadingComment !== 'function') return sourceFile;

    const ownerKinds = [VariableStatement, ReturnStatement, IfStatement, ExpressionStatement];
    const visit = (node = {}) => {
        const visited = typescript.visitEachChild(node, visit, context);
        const { kind = 0 } = getObject(visited);

        if (!ownerKinds.includes(kind)) return visited;

        const { agreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node: visited,
            destructuringAgreements,
            kinds: ['nullish-abstract-equality']
        });

        return getObject(agreement).action === 'retain-nullish-abstract-equality'
            ? addSyntheticLeadingComment(
                visited,
                SingleLineCommentTrivia,
                ' eslint-disable-next-line eqeqeq -- Source nullish equality tests null and undefined in one operation.',
                true
            )
            : visited;
    };

    return typescript.visitNode(sourceFile, visit);
};

export { annotateRetainedNullishEquality };
