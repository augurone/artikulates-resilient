import assert from 'node:assert/strict';

import { createProjectTree } from 'eslint-plugin-resilient/contracts';

const uniqueSorted = (values = []) => [...new Set(values)].toSorted((left = '', right = '') => left.localeCompare(right));
const referenceInvalidation = ({ tree = {}, changedFiles = [], roots = [], identityChanged = false }) => {
    const activeTree = tree.activate({ roots });
    const { indexedFiles = {}, reverseDependents = {} } = tree;
    const { activeFiles = [], inactiveFiles = [] } = activeTree;
    const fileNames = Object.keys(indexedFiles);
    const changed = uniqueSorted(changedFiles);
    const direct = fileNames.filter(fileName => changed.includes(fileName));
    const expand = (current = []) => {
        const next = uniqueSorted([...current, ...current.flatMap((fileName) => {
            const { [fileName]: dependents = [] } = reverseDependents;

            return dependents;
        })]);

        return next.length === current.length ? next : expand(next);
    };
    const invalidatedFiles = uniqueSorted(identityChanged ? activeFiles : expand(direct));

    return {
        changedFiles: changed, invalidatedFiles,
        activeInvalidatedFiles: invalidatedFiles.filter(fileName => activeFiles.includes(fileName)),
        inactiveChangedFiles: changed.filter(fileName => inactiveFiles.includes(fileName)),
        identityChanged
    };
};

const names = ['a.js', 'b.js', 'c.js', 'inactive.js'];
const programs = Object.freeze(Object.fromEntries(names.map(fileName => [
    fileName, Object.freeze({ type: 'Program', body: Object.freeze([]) })
])));
const edges = Object.freeze({
    'a.js': Object.freeze([{ kind: 'static', source: 'b.js' }]),
    'b.js': Object.freeze([{ kind: 'static', source: 'c.js' }]),
    'c.js': Object.freeze([{ kind: 'static', source: 'a.js' }]),
    'inactive.js': Object.freeze([])
});
const resolve = ({ source = '' } = {}) => source;
const tree = createProjectTree({ programs, edges, resolve });
const changes = [[], ['a.js'], ['c.js', 'c.js', 'missing.js'], ['inactive.js'], names, ['missing.js']];
[[], ['a.js'], names, ['missing.js']].forEach((roots) => {
    changes.forEach((changedFiles) => {
        const actual = tree.getInvalidatedFiles({ roots, changedFiles });
        assert.deepEqual(actual, referenceInvalidation({ tree, roots, changedFiles }));
        const identity = tree.getInvalidatedFiles({ roots, changedFiles, nextParserIdentity: 'changed' });
        assert.deepEqual(identity, referenceInvalidation({ tree, roots, changedFiles, identityChanged: true }));
    });
});
assert.deepEqual(tree.getInvalidatedFiles({ roots: ['a.js'], changedFiles: ['./c.js', 'directory/../c.js'] }),
    referenceInvalidation({ tree, roots: ['a.js'], changedFiles: ['c.js'] }));

// Public index edits between queries remain visible; there is no membership cache.
const beforeEdit = tree.getInvalidatedFiles({ changedFiles: ['inactive.js'] });
Object.defineProperty(tree.reverseDependents, 'inactive.js', { value: ['a.js'], configurable: true });
const afterEdit = tree.getInvalidatedFiles({ changedFiles: ['inactive.js'] });
assert.deepEqual(beforeEdit.invalidatedFiles, ['inactive.js']);
assert.deepEqual(afterEdit.invalidatedFiles, names);
assert.deepEqual(afterEdit, referenceInvalidation({ tree, changedFiles: ['inactive.js'] }));

const originalTree = createProjectTree({ programs, edges, resolve, roots: ['a.js'] });
const previous = originalTree.analyze();
const nextTree = createProjectTree({ programs, edges, resolve, roots: ['a.js'] });
const next = nextTree.analyze({ previousSnapshot: previous });
assert.deepEqual(next.reuse.reusedFiles, ['a.js', 'b.js', 'c.js']);
assert.equal(next.graph, previous.graph);
['a.js', 'b.js', 'c.js'].forEach(fileName => assert.equal(next.getDocument(fileName), previous.getDocument(fileName)));
const changedPrograms = { ...programs, 'c.js': { type: 'Program', body: [] } };
const changedTree = createProjectTree({ programs: changedPrograms, edges, resolve, roots: ['a.js'] });
const changed = changedTree.analyze({ previousSnapshot: previous });
assert.deepEqual(changed.reuse.invalidatedFiles, ['a.js', 'b.js', 'c.js']);
assert.deepEqual(changed.reuse.reusedFiles, []);
assert.notEqual(changed.graph, previous.graph);

let reads = [];
const observedPrograms = Object.fromEntries(Object.entries(previous.programs).map(([fileName = '', program = {}]) => [fileName, program]));
Object.defineProperty(observedPrograms, 'a.js', { get: () => {
    reads = [...reads, 'previous:a'];

    return previous.programs['a.js'];
} });
const observedDocuments = { ...previous.graph.documents };
Object.defineProperty(observedDocuments, 'a.js', { get: () => {
    reads = [...reads, 'document:a'];

    return previous.graph.documents['a.js'];
} });
const observedPrevious = { ...previous, programs: observedPrograms, graph: { ...previous.graph, documents: observedDocuments } };
createProjectTree({ programs, edges, resolve, roots: ['a.js'], configIdentity: 'different' }).analyze({ previousSnapshot: observedPrevious });
assert.deepEqual(reads.slice(0, 2), ['previous:a', 'document:a']);
assert.equal(reads.slice(2).every(read => read === 'document:a'), true);
const failure = new Error('previous program read must not be skipped by identity rejection');
Object.defineProperty(observedPrograms, 'a.js', { get: () => { throw failure; } });
assert.throws(() => createProjectTree({ programs, edges, resolve, roots: ['a.js'], configIdentity: 'different' })
    .analyze({ previousSnapshot: observedPrevious }), error => error === failure);

// Repeated activation is not a redundant read law when exposed edges have getters.
const exposed = createProjectTree({ programs, edges, resolve, roots: ['a.js'] });
let statusReads = 0;
Object.defineProperty(exposed.indexedFiles['a.js'].edges[0], 'status', { get: () => {
    statusReads = statusReads + 1;

    return 'resolved';
} });
exposed.analyze();
assert.equal(statusReads, 4);

export { referenceInvalidation };
