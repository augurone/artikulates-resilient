import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds, wrapExpressionArrowBody } from '../../utils/ast-boundary.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';

// Source-time placement gives an expression arrow a statement owner. The
// final pass only annotates that owner; it never classifies emitted calls.
const placeCallableProviderDispatch = ({
    typescript = {}, sourceFile = {}, destructuringAgreements = {},
    context = {}, annotationsOnly = false
} = {}) => {
    const { ArrowFunction = -1, Block = -1, CallExpression = -1,
        ReturnStatement = -1, ExpressionStatement = -1,
        VariableStatement = -1, PropertyAssignment = -1,
        SingleLineCommentTrivia = -1 } = getSyntaxKinds(typescript);
    const { addSyntheticLeadingComment = false,
        getSyntheticLeadingComments = false,
        setSyntheticLeadingComments = false } = typescript;
    const statementKinds = [ReturnStatement, ExpressionStatement, VariableStatement, PropertyAssignment];
    const actionFor = (node = {}) => {
        const { kind = 0 } = getObject(node);

        if (kind === Block || kind === ArrowFunction) return '';

        const { agreement = {}, contract = {} } = kind === CallExpression
            ? getDestructuringDecisionForNode({
                typescript, node, destructuringAgreements,
                kinds: ['callable-provider-dispatch', 'collection-reconstruction']
            }) : {};
        const { action = '' } = getObject(agreement);

        if (['retain-provider-dispatch', 'operational-work-queue'].includes(action)) return action;

        if (action === 'operational-collection-builder' &&
            getObject(contract).operationRole === 'set-visitation') return 'operational-set-visitation';

        if (action === 'operational-collection-builder' &&
            getObject(contract).operationRole === 'set-visitation-sort') return 'operational-set-sort';

        if (action === 'operational-collection-builder' &&
            getObject(contract).operationRole === 'observable-set-union') return 'operational-set-union';

        let found = '';

        typescript.forEachChild(node, (child) => {
            if (!found) found = actionFor(child);
        });

        return found;
    };
    const ownsCall = (node = {}) => !!actionFor(node);

    if (!annotationsOnly) {
        const visit = (node = {}) => {
            const { kind = 0, body = {} } = getObject(node);
            const needsOwner = kind === ArrowFunction && getObject(body).kind !== Block && ownsCall(body);
            const visited = typescript.visitEachChild(node, visit, context);

            if (!needsOwner) return visited;

            return wrapExpressionArrowBody({ typescript, node: visited });
        };

        return typescript.visitNode(sourceFile, visit);
    }

    if (typeof addSyntheticLeadingComment !== 'function') return sourceFile;

    const hasPropertyOwner = (node = {}) => {
        const { kind = 0 } = getObject(node);

        if (kind === PropertyAssignment && ownsCall(node)) return true;

        let found = false;

        typescript.forEachChild(node, (child) => {
            if (!found) found = hasPropertyOwner(child);
        });

        return found;
    };
    const visit = (node = {}) => {
        const { kind = 0 } = getObject(node);
        const comments = typeof getSyntheticLeadingComments === 'function'
            ? getSyntheticLeadingComments(node) || [] : [];
        const annotated = comments.some(({ text = '' } = {}) => (
            text.includes('eslint-disable-next-line resilient/prefer-safe-transformations')
        ));

        const propertyOwnsCall = kind !== PropertyAssignment && hasPropertyOwner(node);

        const action = statementKinds.includes(kind) && !propertyOwnsCall ? actionFor(node) : '';
        const reason = {
            'operational-work-queue': 'Live queue visitation observes shift, unshift, and push on the same array.',
            'operational-set-visitation': 'Set forEach visitation and callback output identity precede native sort.',
            'operational-set-sort': 'Native sort returns the same array populated by live Set visitation.',
            'operational-set-union': 'Membership observes the same copied Set before this live add.',
            'retain-provider-dispatch': 'Checker-resolved provider callable retains its receiver and source call order.'
        }[action] || '';

        const annotate = () => {
            if (!action || annotated) return;

            const existing = comments.findIndex(({ text = '' } = {}) => (
                text.includes('eslint-disable-next-line ') && text.includes(' -- ')
            ));

            if (existing >= 0 && typeof setSyntheticLeadingComments === 'function') {
                const merged = comments.map((comment = {}, index = -1) => {
                    if (index !== existing) return comment;

                    const { text = '' } = comment;
                    const separator = text.indexOf(' -- ');
                    const rules = text.slice(0, separator);
                    const combinedReason = rules.includes('signature-contract-call-site')
                        ? 'Checker-resolved call retains the live queue update as its original argument.'
                        : 'Completed call boundaries retain their shared source evaluation phase.';

                    return {
                        ...comment,
                        text: `${rules}, resilient/prefer-safe-transformations -- ${combinedReason}`
                    };
                });

                setSyntheticLeadingComments(node, merged);

                return;
            }

            addSyntheticLeadingComment(
                node,
                SingleLineCommentTrivia,
                ` eslint-disable-next-line resilient/prefer-safe-transformations -- ${reason}`,
                true
            );
        };

        annotate();

        typescript.forEachChild(node, visit);
    };

    visit(sourceFile);

    return sourceFile;
};

export { placeCallableProviderDispatch };
