import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';
import { createCurriedSelectedTupleBinding } from '../grammar/curried-selected-tuple.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';
import { getBindingNames } from '../understand/imports.js';

const lowerCurriedSelectedTuple = ({
    typescript = {}, node = {}, destructuringAgreements = {}, context = {}
} = {}) => {
    const { ReturnStatement = -1, Block = -1 } = getSyntaxKinds(typescript);
    const occupied = new Set(getBindingNames({ typescript, node }));
    const visit = (child = {}) => {
        const visited = typescript.visitEachChild(child, visit, context);

        if (getObject(visited).kind === Block) {
            const { statements = [] } = getObject(visited);
            const flattened = statements.flatMap((statement = {}) => getObject(statement).__resilientCurriedStage
                ? getObject(statement).statements || []
                : [statement]);

            return flattened.length === statements.length
                ? visited
                : typescript.factory.updateBlock(visited, flattened);
        }

        if (getObject(visited).kind !== ReturnStatement) return visited;

        let selected = false;
        const inspect = (candidate = {}) => {
            const decision = getDestructuringDecisionForNode({
                typescript, node: candidate, destructuringAgreements,
                kinds: ['curried-selected-tuple-binding']
            });

            const { agreement = {} } = decision;

            if (getObject(agreement).action === 'curried-selected-tuple-binding') selected = decision;

            typescript.forEachChild(candidate, inspect);
        };

        inspect(getObject(visited).expression);

        const { contract = {} } = getObject(selected);

        return selected
            ? createCurriedSelectedTupleBinding({
                typescript, node: visited, contract, occupied, context
            }) : visited;
    };

    return visit(node);
};

export { lowerCurriedSelectedTuple };
