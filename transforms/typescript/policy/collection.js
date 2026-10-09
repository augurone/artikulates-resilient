import { getObject } from '../../../rules/support/object.js';

const getCollectionReconstructionAgreement = ({ ownership = false, collection = {}, action = 'retain-collection-boundary', boundaryReason = '', evidence = [] } = {}) => {
    // Other collection roles have separately admitted operational recipes.
    if (!ownership) return { action, boundaryReason, evidence };

    const { valid = false, boundaryReason: ownershipReason = '', staticUpdates = false, synchronousLoop = false } = getObject(ownership);
    const { updates = 0, returns = 0, operation = '', type = '', freshness = '', mutationSites = [] } = collection;
    const [mutation = {}] = mutationSites;
    const { method = '', positions = [] } = getObject(mutation);
    const [{ index: first = -1 } = {}, { index: second = -1 } = {}] = positions;
    const orderedTupleUpdate = type === 'Map' && freshness === 'copy' && updates === 1 && returns === 1 &&
        method === 'set' && positions.length === 2 && first === 0 && second === 1;
    const retained = (reason = '') => ({ action: 'retain-collection-boundary', boundaryReason: reason, evidence });

    if (!valid) return retained(ownershipReason);

    if (!updates || !returns) return retained('unknown-protocol');

    if (!staticUpdates) return retained('mixed-mutators');

    if (operation) return { action: 'materialized-collection-reduce', boundaryReason: '', evidence };

    // A copied builder still owns native identity under a live loop. Ordered
    // tuple reads also straddle method/key/value evaluation and cannot move.
    if (synchronousLoop || orderedTupleUpdate) return {
        action: 'operational-collection-builder', boundaryReason: '',
        evidence: [...evidence, 'checker-proven fresh collection is an owned operational iterator builder']
    };

    if (updates === 1 && returns === 1) return {
        action: freshness === 'copy' ? 'fresh-copy-reconstruction' : 'single-collection-update', boundaryReason: '', evidence
    };

    return { action: 'fresh-collection-rebind', boundaryReason: '', evidence };
};

export { getCollectionReconstructionAgreement };
