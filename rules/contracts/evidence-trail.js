import { extendTraversalPath } from '../support/ast-traversal.js';
import { getObject } from '../support/object.js';

// Contract documents own native derivesFrom arrays; records and input paths stay read-only.
const getEvidenceTrail = ({ id = '', recordsById = new Map(), visited = new Set() } = {}) => {
    const trail = [];
    const visit = (currentId = '', path = visited) => {
        if (!currentId || path.has(currentId)) return;

        const nextPath = extendTraversalPath(path, currentId);
        const record = recordsById.get(currentId);
        const { derivesFrom = [] } = getObject(record);

        if (record) {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- The private buffer keeps repeated record identities in path order without descendant copying or document mutation.
            trail.push(record);
        }

        derivesFrom.forEach(parent => visit(parent, nextPath));
    };
    visit(id);

    return trail;
};

export { getEvidenceTrail };
