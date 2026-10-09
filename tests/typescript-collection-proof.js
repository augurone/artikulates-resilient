import { getCollectionReconstructionAgreement } from '../transforms/typescript/policy/collection.js';
import { collectCollectionReconstructionContracts } from '../transforms/typescript/understand/type-evidence.js';

// Existing collection proofs assert both checker evidence and the resulting
// Policy outcome. Compose once per fact identity: multiple source ranges can
// deliberately refer to the same callback-owned collection fact.
const collectCollectionDecisions = (options = {}) => {
    const facts = collectCollectionReconstructionContracts(options);
    const completed = new Map([...new Set(facts.values())].map((contract = {}) => {
        const { action = '', boundaryReason = '' } = getCollectionReconstructionAgreement(contract);

        return [contract, { ...contract, action, outcome: action, boundaryReason }];
    }));

    return new Map([...facts].map(([key = '', contract = {}] = []) => [key, completed.get(contract)]));
};

export { collectCollectionDecisions };
