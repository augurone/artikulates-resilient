import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';
import { createIteratorPayloadBinding } from '../grammar/iterator-payload.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';
import { getBindingNames } from '../understand/imports.js';

const lowerLiveIteratorPayloadSelection = ({
    typescript = {}, node = {}, destructuringAgreements = {}, context = {}
} = {}) => {
    const { WhileStatement = -1 } = getSyntaxKinds(typescript);
    const occupied = new Set(getBindingNames({ typescript, node }));
    const visitPayload = (child = {}) => {
        const visited = typescript.visitEachChild(child, visitPayload, context);
        const { agreement = {}, contract = {} } = getDestructuringDecisionForNode({
            typescript,
            node: visited,
            destructuringAgreements,
            kinds: ['iterator-payload-local-binding']
        });

        return getObject(visited).kind === WhileStatement &&
            ['iterator-payload-local-binding', 'iterator-payload-local-declaration']
                .includes(getObject(agreement).action)
            ? createIteratorPayloadBinding({ typescript, node: visited, contract, agreement, occupied, context })
            : visited;
    };

    return visitPayload(node);
};

export { lowerLiveIteratorPayloadSelection };
