import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds, updateFunction } from '../../utils/ast-boundary.js';
import { createIndexedLocalSelection } from '../grammar/indexed-local-selection.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';
import { getBindingNames } from '../understand/imports.js';

const lowerIndexedLocalSelection = ({
    typescript = {}, node = {}, destructuringAgreements = {}
} = {}) => {
    const { Block = -1, ForStatement = -1 } = getSyntaxKinds(typescript);
    const { body = {}, parameters = [] } = getObject(node);
    const { kind: bodyKind = 0, statements = [] } = getObject(body);

    if (bodyKind !== Block) return node;

    const occupied = new Set(getBindingNames({ typescript, node }));
    let changed = false;
    const nextStatements = statements.map((statement = {}) => {
        const { agreement = {}, contract = {} } = getDestructuringDecisionForNode({
            typescript,
            node: statement,
            destructuringAgreements,
            kinds: ['indexed-local-staged-selection']
        });

        if (getObject(statement).kind !== ForStatement ||
            getObject(agreement).action !== 'indexed-local-staged-selection') return statement;

        const replacement = createIndexedLocalSelection({ typescript, node: statement, contract, occupied });

        changed = changed || replacement !== statement;

        return replacement;
    });

    return changed ? updateFunction({
        typescript,
        node,
        parameters,
        body: typescript.factory.updateBlock(body, nextStatements)
    }) : node;
};

export { lowerIndexedLocalSelection };
