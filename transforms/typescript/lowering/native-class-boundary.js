import { isFunction } from '../../../analysis/host/function.js';
import { getObject } from '../../../analysis/host/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';

const annotateNativeClassBoundaries = ({
    typescript = {}, sourceFile = {}, destructuringAgreements = {}
} = {}) => {
    const { ClassDeclaration = -1, SingleLineCommentTrivia = -1 } = getSyntaxKinds(typescript);
    const { addSyntheticLeadingComment } = typescript;

    if (!isFunction(addSyntheticLeadingComment)) return sourceFile;

    const visit = (node = {}) => {
        const { kind = 0 } = getObject(node);
        const { agreement = {} } = kind === ClassDeclaration
            ? getDestructuringDecisionForNode({
                typescript, node, destructuringAgreements,
                kinds: ['native-class-boundary']
            }) : {};

        if (getObject(agreement).action === 'retain-native-class-boundary') {
            addSyntheticLeadingComment(
                node,
                SingleLineCommentTrivia,
                ' eslint-disable-next-line no-restricted-syntax -- Native new, prototype, and bound-method identity remain owned by this class boundary.',
                true
            );
        }

        typescript.forEachChild(node, visit);
    };

    visit(sourceFile);

    return sourceFile;
};

export { annotateNativeClassBoundaries };
