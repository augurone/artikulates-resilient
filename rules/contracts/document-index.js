import { getObject } from '../support/object.js';

const createDocumentIndexReader = (createIndex) => {
    const indexes = new WeakMap();

    return (document = {}) => {
        const existing = indexes.get(document);

        if (existing) return existing;

        const index = createIndex(document);
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private WeakMap publication preserves document identity; failed builds are not cached and source records stay untouched.
        indexes.set(document, index);

        return index;
    };
};

const createEvidenceIndex = (document = {}) => {
    const { getEvidence: readEvidence = () => [] } = getObject(document);
    const records = readEvidence();

    return {
        records,
        byId: new Map(records.map((record = {}) => {
            const { id = '' } = record;

            return [id, record];
        }))
    };
};

const createDiagnosticIndex = (document = {}) => {
    const sourceDocument = getObject(document);
    const readerName = Object.hasOwn(sourceDocument, 'getDiagnosticsForIndex')
        ? 'getDiagnosticsForIndex'
        : 'getDiagnostics';
    const { [readerName]: readDiagnostics = () => [] } = sourceDocument;
    const diagnostics = readDiagnostics();
    const byRule = {};

    diagnostics.forEach((diagnostic = {}) => {
        const { ruleId = '' } = diagnostic;
        const { [ruleId]: current = [] } = byRule;

        // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- An inherited non-callable value must retain the existing native failure.
        const { push } = current;

        push.call(current, diagnostic);
        // eslint-disable-next-line resilient/prefer-safe-transformations, resilient/prefer-destructured-member-access -- Private index publishes a completed rule-local buffer.
        byRule[ruleId] = current;
    });

    return { diagnostics, byRule };
};

const getEvidenceIndex = createDocumentIndexReader(createEvidenceIndex);
const getDiagnosticIndex = createDocumentIndexReader(createDiagnosticIndex);

export { getDiagnosticIndex, getEvidenceIndex };
