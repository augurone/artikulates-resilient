import { getSourceRange } from '../../utils/ast-boundary.js';
import { getDestructuringDecision } from '../policy/destructuring-agreements.js';
import { getConsumerContractKey } from '../understand/type-evidence.js';

const validateTuplePlacement = ({ typescript = {}, node = {}, source = false, runtimeEvidence = false, sourceOrigins = false } = {}) => {
    if (!runtimeEvidence) return;

    const { getOriginalNode } = typescript;
    const { source: acquired = false } = runtimeEvidence;

    if (typeof getOriginalNode !== 'function' || acquired !== source || !sourceOrigins || !sourceOrigins.has(getOriginalNode(node))) {
        throw new Error('Stale compiler tuple placement decision');
    }
};

// Placement records the completed decision without replacing the parameter,
// iterator protocol, body or failure phase. Return-family evidence cannot
// justify synthesizing a fallback for missing tuple input.
const lowerTupleConsumerBindings = ({ typescript = {}, node = {}, destructuringAgreements = {}, source = false, agreements = new Set() } = {}) => {
    const { agreement: { action = '', evidence = [], runtimeEvidence = false, sourceOrigins = false } = {} } = getDestructuringDecision({
        destructuringAgreements, key: getConsumerContractKey(node), kinds: ['consumer-callback', 'consumer']
    });

    validateTuplePlacement({ typescript, node, source, runtimeEvidence, sourceOrigins });

    // eslint-disable-next-line resilient/prefer-safe-transformations -- The emission owner collects the completed source decision in its shared report Set.
    if (action === 'preserve-native-tuple') agreements.add({ action, sourceRange: getSourceRange({ typescript, node }), evidence,
        ...(runtimeEvidence ? { runtimeEvidence } : {}) });

    return node;
};

export { lowerTupleConsumerBindings };
