import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds, wrapExpressionArrowBody } from '../../utils/ast-boundary.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';

// One completed call fact has two placement phases. Source time gives an
// expression arrow a statement owner; the last annotation pass attaches the
// exact boundary after other passes have finished reconstructing statements.
const annotateResolvedSourceCalls = ({
    typescript = {}, sourceFile = {}, destructuringAgreements = {},
    context = {}, annotationsOnly = false
} = {}) => {
    const { ArrowFunction = -1, FunctionDeclaration = -1, FunctionExpression = -1,
        Block = -1, CallExpression = -1, ReturnStatement = -1,
        ExpressionStatement = -1, VariableStatement = -1,
        SingleLineCommentTrivia = -1 } = getSyntaxKinds(typescript);
    const { addSyntheticLeadingComment = false,
        getSyntheticLeadingComments = false } = typescript;
    const functions = [ArrowFunction, FunctionDeclaration, FunctionExpression];
    const statements = [ReturnStatement, ExpressionStatement, VariableStatement];

    const reasonFor = (node = {}) => {
        const { kind = 0 } = getObject(node);

        if (functions.includes(kind) || kind === Block) return '';

        const { agreement = {} } = kind === CallExpression
            ? getDestructuringDecisionForNode({
                typescript, node, destructuringAgreements, kinds: ['resolved-source-call']
            }) : {};
        const { action = '' } = getObject(agreement);

        if (action === 'retain-overloaded-partial-call') {
            return 'checker-selected overload returns a callable with the supplied arguments';
        }

        if (action === 'retain-resolved-local-call' && !annotationsOnly) {
            return 'checker resolves the lexical declaration despite a distinct same-named function';
        }

        let reason = '';

        typescript.forEachChild(node, (child) => {
            if (!reason) reason = reasonFor(child);
        });

        return reason;
    };

    if (!annotationsOnly) {
        const visit = (node = {}) => {
            const { kind = 0, body = {} } = getObject(node);
            const arrowReason = kind === ArrowFunction && getObject(body).kind !== Block
                ? reasonFor(body) : '';
            const visited = typescript.visitEachChild(node, visit, context);

            if (!arrowReason) return visited;

            return wrapExpressionArrowBody({ typescript, node: visited });
        };

        return typescript.visitNode(sourceFile, visit);
    }

    if (typeof addSyntheticLeadingComment !== 'function') return sourceFile;

    const visit = (node = {}) => {
        const { kind = 0, expression = {} } = getObject(node);
        const reason = statements.includes(kind)
            ? reasonFor(kind === VariableStatement ? node : expression) : '';
        const comments = typeof getSyntheticLeadingComments === 'function'
            ? getSyntheticLeadingComments(node) || [] : [];
        const alreadyAnnotated = comments.some(({ text = '' } = {}) => (
            text.includes('eslint-disable-next-line resilient/signature-contract-call-site')
        ));

        if (reason && !alreadyAnnotated) addSyntheticLeadingComment(
            node,
            SingleLineCommentTrivia,
            ` eslint-disable-next-line resilient/signature-contract-call-site -- ${reason}`,
            true
        );

        typescript.forEachChild(node, visit);
    };

    visit(sourceFile);

    return sourceFile;
};

export { annotateResolvedSourceCalls };
