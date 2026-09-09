import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { createProjectTree } from 'eslint-plugin-resilient/contracts';

import { getReverseDependents } from '../rules/contracts/reverse-dependents.js';
import { getObject } from '../rules/support/object.js';

const referenceIndex = ({ fileNames = [], indexedFiles = {} } = {}) => Object.fromEntries(fileNames.map(fileName => [
    fileName,
    fileNames.filter((candidate = '') => {
        const { [candidate]: candidateEntry = {} } = indexedFiles;
        const { edges = [] } = getObject(candidateEntry);

        return edges.some(({ targetFile = '' } = {}) => targetFile === fileName);
    })
]));

const fileNames = Object.freeze(['', '__proto__', 'a.js', 'b.js', 'constructor', 'empty.js', 'z.js']);
const hostileTarget = Object.freeze({ toString: () => { throw new Error('Targets must not be coerced'); } });
const indexedFiles = Object.fromEntries(fileNames.map(fileName => [fileName, Object.freeze({
    edges: Object.freeze([
        Object.freeze({ targetFile: 'a.js', status: 'resolved' }),
        Object.freeze({ targetFile: 'a.js', status: 'unknown' }),
        Object.freeze({ targetFile: '__proto__', status: 'unknown' }),
        Object.freeze({ targetFile: hostileTarget }),
        Object.freeze({ targetFile: 'outside.js' }),
        Object.freeze({ targetFile: 42 }),
        Object.freeze({}),
        Object.freeze({ targetFile: fileName })
    ])
})]));
Object.freeze(indexedFiles);
assert.deepEqual(getReverseDependents({ fileNames, indexedFiles }), referenceIndex({ fileNames, indexedFiles }));
assert.deepEqual(getReverseDependents(), {});
assert.deepEqual(getReverseDependents({ fileNames: ['empty.js'] }), { 'empty.js': [] });
const laterFailure = new Error('Single-target lookup must stop at its first match');
const shortCircuitEdge = {};
Object.defineProperty(shortCircuitEdge, 'targetFile', { get: () => { throw laterFailure; } });
const singleton = { fileNames: ['one.js'], indexedFiles: { 'one.js': { edges: [{ targetFile: 'one.js' }, shortCircuitEdge] } } };
assert.deepEqual(getReverseDependents(singleton), referenceIndex(singleton));
assert.deepEqual(getReverseDependents({ fileNames: ['__proto__'], indexedFiles: { ['__proto__']: { edges: [{ targetFile: '__proto__' }] } } }),
    { ['__proto__']: ['__proto__'] });
assert.equal(Object.getPrototypeOf(getReverseDependents({ fileNames, indexedFiles })), Object.prototype);
assert.deepEqual(getReverseDependents({ fileNames, indexedFiles })['a.js'], fileNames);
// eslint-disable-next-line no-sparse-arrays -- Sparse precomputed edges must retain native hole skipping and one dependent entry per file, despite repeated targets.
const sparse = [{ targetFile: 'b.js' }, , { targetFile: 'b.js' }];
assert.deepEqual(getReverseDependents({ fileNames: ['a.js', 'b.js'], indexedFiles: {
    'a.js': { edges: sparse }
} }), { 'a.js': [], 'b.js': ['a.js'] });

const emptyProgram = Object.freeze({ type: 'Program', body: Object.freeze([]) });
const programs = Object.freeze({ 'a.js': emptyProgram, 'b.js': emptyProgram, 'c.js': emptyProgram, 'inactive.js': emptyProgram });
const sourceEdges = Object.freeze({
    'a.js': Object.freeze([{ kind: 'static', source: 'b.js' }, { kind: 'static', source: 'b.js' }]),
    'b.js': Object.freeze([{ kind: 'static', source: 'a.js' }]),
    'c.js': Object.freeze([{ kind: 'dynamic', source: '', targetFile: 'b.js' }, { kind: 'static', source: 'missing.js' }]),
    'inactive.js': Object.freeze([])
});
const tree = createProjectTree({ programs, edges: sourceEdges, roots: ['a.js'], resolve: ({ source = '' } = {}) => source });
assert.deepEqual(tree.reverseDependents, referenceIndex({ fileNames: Object.keys(programs), indexedFiles: tree.indexedFiles }));
assert.deepEqual(tree.reverseDependents['b.js'], ['a.js', 'c.js']);
assert.deepEqual(tree.activate().activeFiles, ['a.js', 'b.js']);
assert.deepEqual(tree.getInvalidatedFiles({ changedFiles: ['b.js', 'b.js'] }).invalidatedFiles, ['a.js', 'b.js', 'c.js']);
assert.deepEqual(tree.getInvalidatedFiles({ changedFiles: ['b.js'] }).activeInvalidatedFiles, ['a.js', 'b.js']);
assert.deepEqual(tree.getInvalidatedFiles({ changedFiles: ['missing.js'] }).invalidatedFiles, []);
assert.deepEqual(tree.getInvalidatedFiles({ changedFiles: ['inactive.js'] }).inactiveChangedFiles, ['inactive.js']);
assert.deepEqual(tree.getInvalidatedFiles({ nextConfigIdentity: 'new' }).invalidatedFiles, ['a.js', 'b.js']);
assert.equal(tree.indexedFiles['a.js'].program, emptyProgram);
assert.equal(tree.getProjectSnapshot().files[0].edges, tree.indexedFiles['a.js'].edges);
assert.equal(tree.getProjectSnapshot().files[2].edges[0].status, 'unknown');

let events = [];
const observe = (event) => { events = [...events, event]; };
const observedEdge = {};
Object.defineProperties(observedEdge, {
    source: { enumerable: true, get: () => { observe('source');

        return 'b.js'; } },
    kind: { enumerable: true, get: () => { observe('kind');

        return 'static'; } },
    targetFile: { enumerable: true, get: () => { observe('target');

        return 'unindexed.js'; } }
});
const observedTree = createProjectTree({ programs, edges: { 'a.js': [observedEdge] }, resolve: ({ source = '' } = {}) => {
    observe(`resolve:${source}`);

    return source;
} });
assert.deepEqual(events, ['source', 'kind', 'resolve:b.js', 'source', 'kind', 'target']);
assert.deepEqual(observedTree.reverseDependents['b.js'], ['a.js']);
const resolverFailure = new Error('resolver failure');
const failedTree = createProjectTree({ programs, edges: { 'a.js': [{ kind: 'static', source: 'b.js', targetFile: 'c.js' }] }, resolve: () => {
    throw resolverFailure;
} });
assert.deepEqual(failedTree.reverseDependents['c.js'], ['a.js']);
assert.equal(failedTree.indexedFiles['a.js'].edges[0].status, 'unknown');
const getterFailure = new Error('edge getter failure');
const hostileEdge = {};
Object.defineProperty(hostileEdge, 'source', { get: () => { throw getterFailure; } });
assert.throws(() => createProjectTree({ programs, edges: { 'a.js': [hostileEdge] } }), error => error === getterFailure);

// A child process gives the module-lifetime registry a clean first-seen domain.
const { href: treeUrl = '' } = new URL('../rules/contracts/project-tree.js', import.meta.url);
const identityProof = `
import { createProjectTree } from ${JSON.stringify(treeUrl)};
const first = () => '';
const second = () => '';
const snapshot = value => createProjectTree({ resolverIdentity: value }).getProjectSnapshot().resolverIdentity;
console.log(JSON.stringify([snapshot('configured'), snapshot(first), snapshot(first), snapshot(second), snapshot(first)]));
`;
assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', identityProof], { encoding: 'utf8' })),
    ['configured', 'function:1', 'function:1', 'function:2', 'function:1']);

export { referenceIndex };
