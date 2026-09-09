import { getObject } from '../../../rules/support/object.js';
import { createProviderForwardExpression } from '../grammar/algebra.js';
import { getDestructuringDecision } from '../policy/destructuring-agreements.js';
import { getConsumerContractKey } from '../understand/type-evidence.js';

// This pass places an already-proven projection agreement before generic
// member lowering can hoist it into a callback parameter binding.
const lowerExactCallbackProjections = ({
    typescript = {},
    node = {},
    destructuringAgreements = {},
    agreements = new Set(),
    context = {}
} = {}) => {
    const { SyntaxKind: { PropertyAccessExpression = -1 } = {} } = typescript;

    const { size: hasAgreementProjection = 0 } = getObject(destructuringAgreements);

    if (!hasAgreementProjection) return node;

    const visit = (candidate = {}) => {
        const key = getConsumerContractKey(candidate);
        const { contract: recorded = {}, agreement: decision = {} } = getDestructuringDecision({
            destructuringAgreements,
            key,
            kinds: ['exact-callback-projection']
        });
        const agreement = recorded;
        const { kind = 0, expression: receiver = {}, name = {} } = getObject(candidate);
        const { action = '', receiver: expectedReceiver = '', member = '' } = {
            ...agreement,
            ...decision
        };
        const { text: actualReceiver = '' } = getObject(receiver);
        const { text: actualMember = '' } = getObject(name);

        if (kind !== PropertyAccessExpression || action !== 'exact-callback-projection' ||
            actualReceiver !== expectedReceiver || actualMember !== member) {
            return typescript.visitEachChild(candidate, visit, context);
        }

        const alias = `${expectedReceiver}${member.charAt(0).toUpperCase()}${member.slice(1)}`;
        const projection = createProviderForwardExpression({
            typescript,
            receiver,
            member,
            alias
        });

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Shared Set reports the built projection; copying loses publication and changes native add timing.
        if (agreements instanceof Set) agreements.add({
            ...agreement,
            action: 'exact-callback-projected',
            alias,
            site: 'exact-callback-projection'
        });

        return projection;
    };

    return typescript.visitEachChild(node, visit, context);
};

export { lowerExactCallbackProjections };
