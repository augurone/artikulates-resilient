import { getObject } from '../../../rules/support/object.js';
import { createProviderForwardExpression } from '../grammar/algebra.js';
import {
    getDestructuringDecision
} from '../policy/destructuring-agreements.js';
import { getProviderForwardKey } from '../understand/type-evidence.js';

// Placement owns evaluation order. The agreement is complete before this pass:
// it merely replaces the exact source member expression named by Understand.
const lowerProviderForwarding = ({
    typescript = {},
    node = {},
    destructuringAgreements = {},
    agreements = new Set(),
    context = {}
} = {}) => {
    const { SyntaxKind: { PropertyAccessExpression = -1 } = {} } = typescript;

    const { size: hasAgreementForward = 0 } = getObject(destructuringAgreements);

    if (!hasAgreementForward) return node;

    const visit = (candidate = {}) => {
        const { kind = 0, expression: receiver = {}, name = {} } = getObject(candidate);
        const { text: actualReceiver = '' } = getObject(receiver);
        const { text: actualMember = '' } = getObject(name);
        const key = getProviderForwardKey({ node: candidate });
        const { contract: recorded = {}, agreement: decision = {} } = getDestructuringDecision({
            destructuringAgreements,
            key,
            kinds: ['provider-forward']
        });
        const agreement = recorded;
        const { action = '', receiver: receiverName = '', member = '' } = {
            ...agreement,
            ...decision
        };

        if (kind !== PropertyAccessExpression || action !== 'provider-forward' ||
            actualReceiver !== receiverName || actualMember !== member) {
            return typescript.visitEachChild(candidate, visit, context);
        }

        const alias = `${receiverName}${member.charAt(0).toUpperCase()}${member.slice(1)}`;
        const forwarded = createProviderForwardExpression({
            typescript,
            receiver,
            member,
            alias
        });

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Shared Set reports the built expression; copying loses publication and changes native add timing.
        if (agreements instanceof Set) agreements.add({
            ...agreement,
            action: 'provider-forwarded',
            alias,
            site: 'provider-forwarding'
        });

        return forwarded;
    };

    return typescript.visitEachChild(node, visit, context);
};

export { lowerProviderForwarding };
