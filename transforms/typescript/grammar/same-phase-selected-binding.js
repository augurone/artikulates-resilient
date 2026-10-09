import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';

const lowerSamePhaseSelectedBindings = ({
    typescript = {}, sourceFile = {}, destructuringAgreements = {}, context = {}
} = {}) => {
    const { VariableDeclaration = -1, VariableStatement = -1,
        PropertyAccessExpression = -1, SingleLineCommentTrivia = -1,
        Identifier = -1 } = getSyntaxKinds(typescript);
    const { factory = {}, addSyntheticLeadingComment = false } = typescript;
    const getRoot = (candidate = {}) => {
        const { kind = 0, expression = {} } = getObject(candidate);

        return kind === PropertyAccessExpression ? getRoot(expression) : candidate;
    };
    const visit = (node = {}) => {
        const { kind = 0, name = {}, initializer = {} } = getObject(node);

        if (kind === VariableStatement) {
            const { declarations = [] } = getObject(getObject(node).declarationList);
            const [declaration = {}] = declarations;
            const { contract = {}, agreement: statementAgreement = {} } = getDestructuringDecisionForNode({
                typescript, node: declaration, destructuringAgreements,
                kinds: ['same-phase-selected-binding']
            });
            const transformed = typescript.visitEachChild(node, visit, context);
            const { propertyPath = [] } = getObject(contract);

            return getObject(statementAgreement).action === 'bind-at-source-phase' &&
                propertyPath.length > 1 &&
                typeof addSyntheticLeadingComment === 'function'
                ? addSyntheticLeadingComment(transformed, SingleLineCommentTrivia,
                    ' eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- An intermediate static Get must retain its native missing-receiver throw.', true)
                : transformed;
        }

        const { agreement = {}, contract = {} } = kind === VariableDeclaration
            ? getDestructuringDecisionForNode({
                typescript, node, destructuringAgreements,
                kinds: ['same-phase-selected-binding']
            }) : {};
        const { propertyPath = [] } = getObject(contract);

        if (getObject(agreement).action === 'bind-at-source-phase' &&
            getObject(name).kind === Identifier &&
            getObject(initializer).kind === PropertyAccessExpression && propertyPath.length) {
            const root = getRoot(initializer);
            const binding = [...propertyPath].toReversed().reduce((selected, property, index) => (
                factory.createObjectBindingPattern([
                    factory.createBindingElement(
                        undefined,
                        factory.createIdentifier(property),
                        selected,
                        index === 0 ? factory.createVoidExpression(factory.createNumericLiteral(0)) : undefined
                    )
                ])
            ), name);
            const { exclamationToken = undefined, type = undefined } = getObject(node);

            return factory.updateVariableDeclaration(node, binding, exclamationToken, type,
                typescript.visitNode(root, visit));
        }

        return typescript.visitEachChild(node, visit, context);
    };

    return typescript.visitNode(sourceFile, visit);
};

export { lowerSamePhaseSelectedBindings };
