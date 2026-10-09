import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';
import { createRestArrayFixedSelection, createRestArrayStagedSelection } from '../grammar/rest-array.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';
import { getBindingNames } from '../understand/imports.js';

const lowerRestArrayFixedSelections = ({
    typescript = {}, node = {}, destructuringAgreements = {}, context = {}
} = {}) => {
    const { ArrowFunction = -1, ReturnStatement = -1 } = getSyntaxKinds(typescript);
    const occupied = new Set(getBindingNames({ typescript, node }));
    const visit = (child = {}) => {
        const { kind = 0 } = getObject(child);
        const { contract = {}, agreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node: child,
            destructuringAgreements,
            kinds: ['rest-array-fixed-selection']
        });
        const { action = '' } = agreement;
        const { returnRange = '' } = getObject(contract);

        if (kind === ReturnStatement && action === 'rest-array-fixed-selection' && returnRange) {
            return createRestArrayFixedSelection({ typescript, node: child, contract, occupied });
        }

        if (kind === ArrowFunction && action === 'rest-array-staged-selection') {
            return createRestArrayStagedSelection({ typescript, node: child, contract, occupied });
        }

        return typescript.visitEachChild(child, visit, context);
    };

    return visit(node);
};

export { lowerRestArrayFixedSelections };
