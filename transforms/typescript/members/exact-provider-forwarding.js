import { isFunction } from '../../../analysis/host/function.js';
import { getObject } from '../../../analysis/host/object.js';
import { markGuardedNode } from '../../utils/ast-boundary.js';
import { createProviderForwardExpression } from '../grammar/algebra.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';

// A provider field that is merely forwarded has no callable consumer here.
// Make the source member result explicit on its existing binding; this keeps
// binding-time receiver failure, getter timing, and undefined intact while
// preventing final grammar from inserting an invocation guard.
const lowerExactProviderForwarding = ({
    typescript = {}, node = {}, destructuringAgreements = {}, agreements = new Set(), context = {}
} = {}) => {
    const {
        factory = {},
        SyntaxKind: { BindingElement = -1, PropertyAccessExpression = -1 } = {}
    } = typescript;

    if (!getObject(destructuringAgreements).size ||
        !isFunction(getObject(factory).updateBindingElement)) return node;

    const recordAgreement = (contract = {}) => {
        if (!(agreements instanceof Set)) return;

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Shared Set publishes before replacement construction; copying hides records on compiler failure.
        agreements.add({
            ...contract,
            action: 'exact-provider-forwarded',
            site: 'exact-provider-forwarding'
        });
    };
    const visit = (candidate = {}) => {
        const {
            kind = 0, initializer,
            name = {}, expression: receiver = {}, __resilientGuarded = false
        } = getObject(candidate);

        // Enclosing curried functions revisit this binding after its source
        // decision has already been emitted. Natural absence is not a sentinel
        // initializer; the completed binding itself owns that decision.
        if (kind === BindingElement && __resilientGuarded) return candidate;

        const { agreement = {}, contract = {} } = getDestructuringDecisionForNode({
            typescript,
            node: candidate,
            destructuringAgreements,
            kinds: ['exact-provider-forward']
        });
        const { agreement: directAgreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node: candidate,
            destructuringAgreements,
            kinds: ['direct-capability', 'sort-capability', 'consumer', 'consumer-callback', 'exact-callback-projection']
        });
        const directAction = getObject(directAgreement).action || '';
        const { action = '', canonical = '' } = agreement;

        if (['guard-function', 'guard-function-undefined', 'guard-sort-capability', 'exact-callback-projection'].includes(directAction)) {
            return typescript.visitEachChild(candidate, visit, context);
        }

        const isPropertyForward = kind === PropertyAccessExpression && action === 'exact-provider-forward' && canonical === 'undefined';
        const getPropertyForward = () => {
            if (!isPropertyForward) return false;

            const { receiver: contractReceiver = '', member = '' } = getObject(contract);
            const { text: receiverText = '' } = getObject(receiver);
            const { text: memberText = '' } = getObject(name);

            if (receiverText !== contractReceiver || memberText !== member) return false;

            recordAgreement(contract);

            return createProviderForwardExpression({
                typescript,
                receiver,
                member,
                alias: `${contractReceiver}${member.charAt(0).toUpperCase()}${member.slice(1)}`,
                canonical
            });
        };
        const propertyForward = getPropertyForward();

        if (propertyForward) return propertyForward;

        if (kind !== BindingElement || initializer || action !== 'exact-provider-forward' || canonical !== 'undefined') {
            return typescript.visitEachChild(candidate, visit, context);
        }

        recordAgreement(contract);

        const binding = factory.cloneNode(candidate);
        Object.defineProperty(binding, '__resilientAgreement', { configurable: true,
            value: 'Forwarded field retains its native absence.' });

        return markGuardedNode(binding);
    };

    return typescript.visitEachChild(node, visit, context);
};

export { lowerExactProviderForwarding };
