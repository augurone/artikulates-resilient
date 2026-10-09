import { ownsStaticRead } from './defaults.js';
import { getObject } from '../../../rules/support/object.js';
import { getConsumerContractKey } from '../understand/type-evidence.js';

const emptyDecision = () => ({
    entry: {}, contract: {}, agreement: {
        action: 'retain', evidence: [], owner: 'boundary', grammar: 'retain-named-boundary',
        theorem: 'named-boundary', sourceRange: '', relatedRanges: []
    }
});

// All interpretation happens in compileDestructuringDecisions. Queries select
// completed source claims without rebuilding Policy or placement indexes.
const getDestructuringDecision = ({ destructuringAgreements = {}, key = '', kinds = [] } = {}) => {
    const { byKey = new Map() } = getObject(destructuringAgreements);
    const acceptedKinds = Array.isArray(kinds) ? kinds.filter(Boolean) : [];

    return (byKey.get(key) || []).find(({ entry: { kind = '' } = {} } = {}) => (
        !acceptedKinds.length || acceptedKinds.includes(kind)
    )) || emptyDecision();
};

const getDestructuringDecisionForNode = ({ typescript = {}, node = {}, destructuringAgreements = {}, kinds = [] } = {}) => {
    const { getOriginalNode = false } = typescript;
    const original = typeof getOriginalNode === 'function' ? getOriginalNode(node) : node;
    const key = getConsumerContractKey(original);
    const directKey = getConsumerContractKey(node);
    const originalDecision = getDestructuringDecision({ destructuringAgreements, key, kinds });
    const { entry = {} } = originalDecision;

    // A reconstructed shell may lack an original span. An applicable original
    // claim still wins over the updated node's direct range.
    return getObject(entry).kind || !directKey || directKey === key
        ? originalDecision
        : getDestructuringDecision({ destructuringAgreements, key: directKey, kinds });
};

const isCompletedLiveCollectionLoop = ({ typescript = {}, node = {}, destructuringAgreements = {} } = {}) => {
    const { getOriginalNode = false, SyntaxKind: { ForOfStatement = -1 } = {} } = typescript;
    const original = typeof getOriginalNode === 'function' ? getOriginalNode(node) : node;
    const { completedLiveLoops = new Set() } = getObject(destructuringAgreements);

    return getObject(node).kind === ForOfStatement && completedLiveLoops.has(getConsumerContractKey(original));
};

const getDestructuringGuardKinds = ({ destructuringAgreements = {} } = {}) => {
    const { guardKinds = new Set() } = getObject(destructuringAgreements);

    return guardKinds;
};

const hasCompletedDestructuringAgreement = ({ typescript = {}, node = {}, destructuringAgreements = {}, kinds = [] } = {}) => {
    const { agreement = {} } = getDestructuringDecisionForNode({ typescript, node, destructuringAgreements, kinds });

    return ownsStaticRead({ agreement });
};

const getFunctionDestructuringDecision = ({ destructuringAgreements = {}, functionKey = '', kind = '' } = {}) => {
    const { byFunction = new Map() } = getObject(destructuringAgreements);

    return (byFunction.get(functionKey) || []).find(({ entry: { kind: candidateKind = '' } = {} } = {}) => candidateKind === kind) || emptyDecision();
};

// Direct capabilities are keyed by the read; sort capabilities by the call.
// When original and direct ranges both have claims, retain source-store order.
const findCapabilityConsumerDecision = ({ typescript = {}, node = {}, destructuringAgreements = {}, kinds = ['sort-capability'] } = {}) => {
    const { getOriginalNode = false } = typescript;
    const original = typeof getOriginalNode === 'function' ? getOriginalNode(node) : node;
    const { byMember = new Map() } = getObject(destructuringAgreements);
    const keys = [...new Set([getConsumerContractKey(original), getConsumerContractKey(node)].filter(Boolean))];
    const acceptedKinds = Array.isArray(kinds) ? kinds : [];

    return keys.flatMap(key => byMember.get(key) || []).toSorted(({ order: left = 0 } = {}, { order: right = 0 } = {}) => left - right)
        .find(({ entry: { kind = '' } = {} } = {}) => acceptedKinds.includes(kind)) || emptyDecision();
};

export {
    findCapabilityConsumerDecision,
    getFunctionDestructuringDecision,
    getDestructuringDecision,
    getDestructuringDecisionForNode,
    getDestructuringGuardKinds,
    hasCompletedDestructuringAgreement,
    isCompletedLiveCollectionLoop
};
