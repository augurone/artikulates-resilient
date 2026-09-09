import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds, wrapExpressionArrowBody } from '../../utils/ast-boundary.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';
import { getExactUndefinedReason } from '../policy/placement.js';

// The source overload owns an arity-indexed return contract. Keep the one
// authored declaration intact and explain the exact analyzer boundary there.
const annotateCompletedReturnBoundaries = ({
    typescript = {}, sourceFile = {}, destructuringAgreements = {}, placement = {}, context = {}
} = {}) => {
    const { VariableStatement = -1, FunctionDeclaration = -1, IfStatement = -1,
        ReturnStatement = -1, ConditionalExpression = -1, ArrowFunction = -1,
        MultiLineCommentTrivia = -1, SingleLineCommentTrivia = -1 } = getSyntaxKinds(typescript);
    const { addSyntheticLeadingComment = false, addSyntheticTrailingComment = false } = typescript;
    const { partitions = new Map(), switchReturns = new Map() } = destructuringAgreements;
    const { exactUndefined = new Set() } = placement;

    if ((!partitions.size && !switchReturns.size && !exactUndefined.size) || typeof addSyntheticLeadingComment !== 'function' ||
        typeof addSyntheticTrailingComment !== 'function') return sourceFile;

    const getSelectorAgreement = (test = {}) => {
        const { agreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node: test,
            destructuringAgreements,
            kinds: ['arity-return-selector']
        });

        return getObject(agreement).action === 'retain-exact-undefined-selector'
            ? 'Only undefined selects partial application.'
            : getExactUndefinedReason({ typescript, node: test, placement });
    };
    const visit = (node = {}) => {
        const { kind: sourceKind = 0, body = {} } = getObject(node);
        const { kind: bodyKind = 0, condition: bodyCondition = {} } = getObject(body);
        const arrowSelector = bodyKind === ConditionalExpression ? bodyCondition : body;
        const prepared = sourceKind === ArrowFunction && getSelectorAgreement(arrowSelector)
            ? wrapExpressionArrowBody({ typescript, node }) : node;
        const visited = typescript.visitEachChild(prepared, visit, context);
        const { kind = 0, name = {}, declarationList = {} } = getObject(visited);
        const annotateSelector = (statement = {}, reason = '') => addSyntheticLeadingComment(
            statement,
            SingleLineCommentTrivia,
            ` eslint-disable-next-line resilient/no-undefined-comparison -- ${reason}`,
            true
        );

        if (kind === IfStatement) {
            const reason = getSelectorAgreement(getObject(visited).expression);

            return reason ? annotateSelector(visited, reason) : visited;
        }

        const { expression: returnedExpression = {} } = getObject(visited);
        const { kind: returnedKind = 0, condition = {} } = getObject(returnedExpression);

        const returnedReason = kind === ReturnStatement
            ? getSelectorAgreement(returnedKind === ConditionalExpression ? condition : returnedExpression) : '';

        if (returnedReason) {
            return annotateSelector(visited, returnedReason);
        }

        const { declarations = [] } = getObject(declarationList);
        const [declaration = {}] = declarations;
        const declarationName = kind === FunctionDeclaration
            ? getObject(name).text || ''
            : getObject(getObject(declaration).name).text || '';
        const agreement = partitions.get(declarationName) || {};
        const { agreement: switchAgreement = {}, exitKind = '' } = getObject(switchReturns.get(declarationName));

        if (![VariableStatement, FunctionDeclaration].includes(kind) || declarations.length > 1) return visited;

        const isArity = getObject(agreement).action === 'retain-arity-return-partition';
        const isSwitch = getObject(switchAgreement).action === 'retain-switch-no-value-exit';

        if (!isArity && !isSwitch) return visited;

        const rule = isArity
            ? 'resilient/signature-contract-return-consistency'
            : 'consistent-return, resilient/signature-contract-return-consistency';
        let reason = 'Arity selects callable or value.';

        if (isSwitch && exitKind === 'explicit-bare-return') {
            reason = 'Unsupported selector retains the source no-value exit.';
        }

        if (isSwitch && exitKind !== 'explicit-bare-return') {
            reason = 'Unrecognized tag retains native fallthrough.';
        }

        const withDisable = addSyntheticLeadingComment(
            visited,
            MultiLineCommentTrivia,
            ` eslint-disable ${rule} -- ${reason} `,
            true
        );

        return addSyntheticTrailingComment(
            withDisable,
            MultiLineCommentTrivia,
            ` eslint-enable ${rule} `,
            true
        );
    };

    return typescript.visitNode(sourceFile, visit);
};

export { annotateCompletedReturnBoundaries };
