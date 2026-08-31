import assert from 'node:assert/strict';

import { ESLint } from 'eslint';
import {
    createContractDocument,
    createProjectTree,
    isKnown
} from 'eslint-plugin-resilient/contracts';

const getProgram = async (code = '', fileName = 'fixture.js') => {
    let program = {};
    const capture = {
        rules: {
            program: {
                create: () => ({
                    Program: (node) => {
                        program = node;
                    }
                })
            }
        }
    };
    const eslint = new ESLint({
        overrideConfigFile: true,
        overrideConfig: [{
            languageOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module'
            },
            plugins: { capture },
            rules: { 'capture/program': 'error' }
        }]
    });
    await eslint.lintText(code, { filePath: fileName });
    return program;
};

const provider = await getProgram(
    'export const getItems = ({ items = [], label = "" } = {}) => ({ items, label });',
    'providers/items.js'
);
const barrel = await getProgram(
    'export { getItems } from "./providers/items.js";',
    'provider-barrel.js'
);
const consumerA = await getProgram([
    'import { getItems } from "./provider-barrel.js";',
    'getItems({ items: "not-an-array", label: "" });'
].join('\n'), 'consumer-a.js');
const consumerB = await getProgram([
    'import { getItems } from "./provider-barrel.js";',
    'getItems({ items: [], label: 42 });'
].join('\n'), 'consumer-b.js');
const validConsumer = await getProgram([
    'import { getItems } from "./provider-barrel.js";',
    'getItems({ items: [], label: "" });'
].join('\n'), 'consumer-valid.js');
const stable = await getProgram('export const stable = "stable";', 'stable.js');

const sharedTree = createProjectTree({
    programs: {
        'consumer-a.js': consumerA,
        'consumer-b.js': consumerB,
        'consumer-valid.js': validConsumer,
        'provider-barrel.js': barrel,
        'providers/items.js': provider,
        'stable.js': stable
    },
    roots: ['consumer-a.js', 'consumer-b.js', 'consumer-valid.js', 'stable.js']
});
const sharedSnapshot = sharedTree.analyze();
const { diagnostics: sharedDiagnostics = [] } = sharedSnapshot;
assert.equal(sharedDiagnostics.length, 2);
assert.deepEqual(sharedDiagnostics.map(({ fileName = '' } = {}) => fileName), [
    'consumer-a.js',
    'consumer-b.js'
]);
assert.deepEqual(sharedDiagnostics.map(({ data = {} } = {}) => data.path), [
    'items',
    'label'
]);
assert.equal(sharedSnapshot.contracts['providers/items.js'].getItems.signature.contract.kind, 'object');
assert.equal(sharedTree.analyze(), sharedSnapshot);
assert.equal(sharedTree.getStats().hits, 1);

const changedProvider = await getProgram(
    'export const getItems = ({ items = [], label = 0 } = {}) => ({ items, label });',
    'providers/items.js'
);
const changedPrograms = {
    'consumer-a.js': consumerA,
    'consumer-b.js': consumerB,
    'consumer-valid.js': validConsumer,
    'provider-barrel.js': barrel,
    'providers/items.js': changedProvider,
    'stable.js': stable
};
const changedTree = createProjectTree({
    programs: changedPrograms,
    roots: ['consumer-a.js', 'consumer-b.js', 'consumer-valid.js', 'stable.js'],
    sourceStates: { 'providers/items.js': 'changed' }
});
const changedSnapshot = changedTree.analyze({ previousSnapshot: sharedSnapshot });
assert.deepEqual(changedSnapshot.reuse.changedFiles, ['providers/items.js']);
assert.ok(changedSnapshot.reuse.invalidatedFiles.includes('consumer-b.js'));
assert.deepEqual(changedSnapshot.reuse.reusedFiles, ['stable.js']);
assert.equal(changedSnapshot.reuse.graphReused, false);
assert.equal(changedSnapshot.graph.documents['stable.js'], sharedSnapshot.graph.documents['stable.js']);

const cleanChangedSnapshot = createProjectTree({
    programs: changedPrograms,
    roots: ['consumer-a.js', 'consumer-b.js', 'consumer-valid.js', 'stable.js'],
    sourceStates: { 'providers/items.js': 'changed' }
}).analyze();
const getDefinitionFacts = ({ definitions = {} } = {}) => Object.fromEntries(
    Object.entries(definitions).map(([name = '', definition = {}] = []) => [name, {
        signature: definition.signature,
        returnContract: definition.returnContract
    }])
);
const getSnapshotFacts = ({ snapshot = {} } = {}) => ({
    projectTree: snapshot.projectTree,
    activeTree: {
        ...snapshot.activeTree,
        programs: Object.keys(snapshot.activeTree.programs || {})
    },
    programs: Object.keys(snapshot.programs || {}),
    contracts: snapshot.contracts,
    agreements: snapshot.agreements,
    documents: Object.fromEntries(Object.entries(snapshot.graph.documents || {})
        .map(([fileName = '', document = {}] = []) => [fileName, getDefinitionFacts(document)])),
    diagnostics: snapshot.diagnostics.map((diagnostic = {}) => Object.fromEntries(
        Object.entries(diagnostic).filter(([name = '']) => !['node', 'stack'].includes(name))
    ))
});
assert.deepEqual(getSnapshotFacts({ snapshot: changedSnapshot }), getSnapshotFacts({
    snapshot: cleanChangedSnapshot
}));

const runtimeCode = [
    'const externalSource = async () => unknownSource;',
    'const normalize = raw => Array.isArray(raw) ? raw : [];',
    'const render = (items = []) => items.map(Boolean);',
    'const run = async () => {',
    '    const raw = await externalSource();',
    '    const normalized = normalize(raw);',
    '    return render(normalized);',
    '};',
    'run;'
].join('\n');
const runtimeProgram = await getProgram(runtimeCode, 'runtime-boundary.js');
const runtimeDocument = createContractDocument(runtimeProgram, { fileName: 'runtime-boundary.js' });
assert.equal(isKnown(runtimeDocument.definitions.normalize.returnContract), true);
assert.equal(runtimeDocument.definitions.normalize.returnContract.kind, 'array');
assert.equal(runtimeDocument.getDiagnostics().length, 0);
assert.equal(runtimeDocument.getContractAtOffset(runtimeCode.indexOf('unknownSource')).contract.kind, 'unknown');
