import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds, updateFunction } from '../../utils/ast-boundary.js';
import { createMutableSelectedLoop } from '../grammar/mutable-selected-loop.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';
import { getBindingNames } from '../understand/imports.js';

const lowerMutableSelectedLoop = ({
    typescript = {}, node = {}, destructuringAgreements = {}, context = {}
} = {}) => {
    const { Block = -1, WhileStatement = -1 } = getSyntaxKinds(typescript);
    const { body = {}, parameters = [] } = getObject(node);
    const { kind: bodyKind = 0, statements = [] } = getObject(body);
    const occupied = new Set(getBindingNames({ typescript, node }));

    if (bodyKind !== Block) return node;

    let changed = false;
    const nextStatements = statements.flatMap((statement = {}, index) => {
        const { [index - 1]: previous = {} } = statements;
        const { agreement = {}, contract = {} } = getDestructuringDecisionForNode({
            typescript,
            node: statement,
            destructuringAgreements,
            kinds: ['mutable-selected-loop-binding']
        });
        const { action = '' } = getObject(agreement);

        if (getObject(statement).kind === WhileStatement && action === 'mutable-selected-loop-binding') {
            const { [index + 1]: exit = {} } = statements;

            changed = true;

            return createMutableSelectedLoop({ typescript, loop: statement, exit, contract, occupied, context });
        }

        return getObject(previous).kind === WhileStatement && action === 'mutable-selected-loop-binding'
            ? []
            : [statement];
    });

    return changed ? updateFunction({
        typescript,
        node,
        parameters,
        body: typescript.factory.updateBlock(body, nextStatements)
    }) : node;
};

export { lowerMutableSelectedLoop };
