import assert from 'node:assert/strict';

import { Linter } from 'eslint';

import resilient from 'eslint-plugin-resilient';

import { createAnalysisSession, getLocalAnalysisSession } from '../rules/contracts/analysis-session.js';
import { getDiagnosticIndex } from '../rules/contracts/document-index.js';
import { createContractDocument } from '../rules/contracts/document.js';
import { clearContractCaches, clearProjectGraphCache } from '../rules/contracts/eslint-graph.js';
import { getDefinitions, getFunctionNodes, walk } from '../rules/contracts/infer.js';
import { contract } from '../rules/contracts/model.js';
import { createContractGraph } from '../rules/contracts/module-graph.js';
import { captureProgram } from '../rules/support/eslint-program.js';

const parse = source => captureProgram(source, { fileName: 'session.js' });
const code = 'const read = ({ value = "" } = {}) => value; read({ value: 1 });';
const program = await parse(code);
const session = getLocalAnalysisSession(program);
assert.equal(getLocalAnalysisSession(program), session);
assert.deepEqual(session.definitions, getDefinitions(program));
assert.deepEqual(session.getFunctions(), getFunctionNodes(program));
assert.equal(session.getFlows(), session.getFlows());
let readIdentifiers = [];
walk(program, (node = {}) => {
    const { type = '', name = '' } = node;

    if (type === 'Identifier' && name === 'read') readIdentifiers = [...readIdentifiers, node];
});
const [readDeclaration = {}, readReference = {}] = readIdentifiers;
assert.equal(session.bindingIndex.getBinding(readDeclaration), session.bindingIndex.getBinding(readReference));
assert.equal(session.bindingIndex.getBinding(readDeclaration).name, 'read');
assert.equal(Object.isFrozen(session.bindingIndex.getBinding(readDeclaration)), true);
const twin = await parse(code);
assert.notEqual(getLocalAnalysisSession(twin), session);
clearProjectGraphCache();
assert.equal(getLocalAnalysisSession(program), session);
clearContractCaches();
const replacementSession = getLocalAnalysisSession(program);
assert.notEqual(replacementSession, session);
assert.notEqual(replacementSession.bindingIndex, session.bindingIndex);

// The lexical index is parser-neutral: a plain ESTree tree without ESLint
// parent or scope metadata produces the same shadowing diagnostic.
const portableSource = "const value = 'ok'; { const value = []; } value.map(Boolean);";
const parsedPortable = await parse(portableSource);
const portableProgram = JSON.parse(JSON.stringify(parsedPortable, (key = '', value = false) => (
    key === 'parent' ? false : value
)));
const portableDiagnostics = createContractDocument(portableProgram).getDiagnostics();
assert.deepEqual(portableDiagnostics.map(({ message = '' } = {}) => message), [
    'value is string-like, but .map() requires a array-like.'
]);

// The two rule visitors consume one completed local definition environment.
let reports = [];
const context = { report: (report) => { reports = [...reports, report]; } };
const { rules = {} } = resilient;
const { 'signature-contract-return-consistency': returns = {}, 'no-unhandled-promise-chain': promises = {} } = rules;
const localCode = 'const choose = flag => { if (flag) return []; return ""; }; const task = async () => 1; task();';
const localProgram = await parse(localCode);
const returnVisitor = returns.create(context);
const promiseVisitor = promises.create(context);
returnVisitor.Program(localProgram);
const completed = getLocalAnalysisSession(localProgram);
promiseVisitor.Program(localProgram);
walk(localProgram, (node = {}) => {
    const { type = '' } = node;

    if (type === 'ExpressionStatement') promiseVisitor.ExpressionStatement(node);
});
assert.equal(getLocalAnalysisSession(localProgram), completed);
assert.deepEqual(reports.map(({ messageId = '' } = {}) => messageId), ['inconsistent', 'inconsistent', 'unhandled']);
const linter = new Linter();
const messages = linter.verify(localCode, [{ plugins: { resilient }, rules: {
    'resilient/signature-contract-return-consistency': 'error',
    'resilient/no-unhandled-promise-chain': 'error'
} }]);
assert.equal(messages.length, 3);

// Local consumers must not acquire project-expanded promise evidence.
const consumer = await parse('import { task } from "./provider.js"; task();');
const provider = await parse('export const task = async () => 1;');
const local = getLocalAnalysisSession(consumer);
const graph = createContractGraph({ programs: { 'consumer.js': consumer, 'provider.js': provider } });
assert.equal(Object.hasOwn(local.definitions, 'task'), false);
assert.equal(graph.getDocument('consumer.js').definitions.task.returnContract.kind, 'promise');
assert.equal(getLocalAnalysisSession(consumer), local);
assert.equal(linter.verify('import { task } from "./provider.js"; task();', [{ plugins: { resilient }, rules: {
    'resilient/no-unhandled-promise-chain': 'error'
} }]).length, 0);

// Census occurrences and stopping rules are the analyzer walk's laws, including
// path-local cycles and repeated shared nodes. A global visited set is wrong.
const shared = { type: 'Identifier', name: 'shared' };
const tree = { type: 'Program', body: [shared, shared] };
Object.defineProperty(tree, 'cycle', { enumerable: true, value: tree });
const census = createAnalysisSession(tree);
let occurrences = [];
census.visit(tree, (node) => { occurrences = [...occurrences, node]; });
assert.deepEqual(occurrences, [tree, shared, shared]);
let skipped = [];
let expected = [];
session.visit(program, (node) => { skipped = [...skipped, node]; }, { skipFunctions: true });
walk(program, (node) => { expected = [...expected, node]; }, { skipFunctions: true });
assert.deepEqual(skipped, expected);

// Accessor-backed syntax cannot lend a captured census to a later phase.
let accessorTrace = [];
const observedProgram = { get type() {
    accessorTrace = [...accessorTrace, 'type'];

    return 'Program';
}, get body() {
    accessorTrace = [...accessorTrace, 'body'];

    return [];
} };
const observedDocument = createContractDocument(observedProgram);
observedDocument.getDiagnostics();
observedDocument.getDiagnostics();
// Five portable diagnostic readers inspect this source 187 times. Reusing a census
// here suppresses observable Gets, including later getter failures.
assert.equal(accessorTrace.length, 187);
assert.equal(accessorTrace.filter(read => read === 'body').length, 45);

let inheritedReads = 0;
// eslint-disable-next-line resilient/prefer-safe-transformations -- This proof needs the original object with an inherited type getter and own body property.
const inheritedProgram = Object.assign(Object.create({ get type() {
    inheritedReads += 1;

    return 'Program';
} }), { body: [] });
createContractDocument(inheritedProgram).getDiagnostics();
assert.equal(inheritedReads, 55);

let definitionReads = 0;
const liveDocument = createContractDocument({ type: 'Program', body: [] });
Object.defineProperty(liveDocument.definitions, 'external', { enumerable: true, get: () => {
    definitionReads += 1;

    return { version: definitionReads };
} });
liveDocument.getDiagnostics();
assert.equal(definitionReads, 5);
liveDocument.getDiagnostics();
assert.equal(definitionReads, 10);

const failure = new Error('analysis construction');
let fail = true;
let reads = 0;
const retryProgram = { get type() {
    reads += 1;

    if (fail) throw failure;

    return 'Program';
}, body: [] };
assert.throws(() => getLocalAnalysisSession(retryProgram), error => error === failure);
assert.throws(() => getLocalAnalysisSession(retryProgram), error => error === failure);
assert.equal(reads, 2);
fail = false;
const recovered = getLocalAnalysisSession(retryProgram);
const finishedReads = reads;
assert.notEqual(getLocalAnalysisSession(retryProgram), recovered);
assert.ok(reads > finishedReads);

let entered = false;
let nested = {};
const reentrant = { get type() {
    if (!entered) {
        entered = true;
        nested = getLocalAnalysisSession(reentrant);
    }

    return 'Program';
}, body: [] };
const outer = getLocalAnalysisSession(reentrant);
assert.notEqual(nested, outer);
assert.notEqual(getLocalAnalysisSession(reentrant), outer);
let clearing = true;
const clearingProgram = { get type() {
    if (clearing) {
        clearing = false;
        clearContractCaches();
    }

    return 'Program';
}, body: [] };
const clearingSession = getLocalAnalysisSession(clearingProgram);
assert.notEqual(getLocalAnalysisSession(clearingProgram), clearingSession);

let failFlows = false;
const flowProgram = { type: 'Program', get body() {
    if (failFlows) throw failure;

    return [];
} };
const flowSession = createAnalysisSession(flowProgram);
failFlows = true;
assert.throws(() => flowSession.getFlows(), error => error === failure);
assert.throws(() => flowSession.getFlows(), error => error === failure);
failFlows = false;
assert.equal(flowSession.getFlows(), flowSession.getFlows());

// Direct diagnostic queries allocate new results; an ESLint index is a snapshot.
const document = createContractDocument(program, { fileName: 'query.js' });
const first = document.getDiagnostics();
const pristine = document.getDiagnostics();
assert.notEqual(first, pristine);
assert.notEqual(first[0], pristine[0]);
assert.notEqual(first[0].data, pristine[0].data);
assert.equal(first[0].node, pristine[0].node);
// eslint-disable-next-line resilient/prefer-safe-transformations -- Changing a returned diagnostic must not mutate a later diagnostic record.
Object.assign(first[0], { message: 'changed' });
// eslint-disable-next-line resilient/prefer-safe-transformations -- Changing returned diagnostic data tests the independent per-query payload.
Object.assign(first[0].data, { actual: 'changed' });
// eslint-disable-next-line resilient/prefer-safe-transformations -- Changing diagnostic evidence IDs must not change later query IDs.
first[0].evidenceIds.push('changed');
// eslint-disable-next-line resilient/prefer-safe-transformations -- Removing returned stack frames tests query-owned stack allocation.
first[0].stack.frames.splice(0);
// eslint-disable-next-line resilient/prefer-safe-transformations -- Appending a caller-owned finding must not change later diagnostic results.
first.push({ message: 'extra' });
assert.deepEqual(document.getDiagnostics(), pristine);
const records = document.getEvidence();
const originalRecords = document.getEvidence();
assert.notEqual(records[0], originalRecords[0]);
assert.notEqual(records[0].fact, originalRecords[0].fact);
assert.equal(records[0].fact.contract, originalRecords[0].fact.contract);
assert.equal(records[0].source.range, originalRecords[0].source.range);
// eslint-disable-next-line resilient/prefer-safe-transformations -- Changing returned evidence fields must not alter registry records.
Object.assign(records[0], { id: 'changed' });
// eslint-disable-next-line resilient/prefer-safe-transformations -- Mutating returned evidence edges must not alter registry dependencies.
records[0].derivesFrom.push('changed');
// eslint-disable-next-line resilient/prefer-safe-transformations -- Removing caller-visible evidence records must not shrink the registry.
records.splice(1);
assert.deepEqual(document.getEvidence(), originalRecords);

const supplied = { signature: { parameters: [] }, returnContract: contract({ kind: 'array' }) };
const externalProgram = await parse('import { read } from "./provider.js"; read().trim();');
const externalDocument = createContractDocument(externalProgram, { externalDefinitions: { read: supplied } });
assert.equal(externalDocument.getDiagnostics().length, 1);
const indexed = getDiagnosticIndex(externalDocument);
// eslint-disable-next-line resilient/prefer-safe-transformations -- A live external return contract changes the next direct diagnostic query; a cached result would be stale.
Object.assign(supplied, { returnContract: contract({ kind: 'string' }) });
assert.deepEqual(externalDocument.getDiagnostics(), []);
assert.equal(getDiagnosticIndex(externalDocument), indexed);
assert.equal(indexed.diagnostics.length, 1);
Object.defineProperty(externalDocument.definitions, 'read', { configurable: true, get: () => { throw failure; } });
assert.throws(() => externalDocument.getDiagnostics(), error => error === failure);
Object.defineProperty(externalDocument.definitions, 'read', { value: supplied });
assert.deepEqual(externalDocument.getDiagnostics(), []);
clearContractCaches();
assert.equal(getDiagnosticIndex(externalDocument), indexed);

// Graph inference and public documents intentionally retain independent records.
const { definitions: { 'provider.js': definitions = {} } = {} } = graph;
const providerDocument = graph.getDocument('provider.js');
assert.notEqual(providerDocument.definitions.task, definitions.task);
// eslint-disable-next-line resilient/prefer-safe-transformations -- Mutating graph inference must not mutate the independently published document definition.
Object.assign(definitions.task, { returnContract: contract({ kind: 'string' }) });
assert.equal(providerDocument.definitions.task.returnContract.kind, 'promise');
clearContractCaches();
