import assert from 'node:assert/strict';

import { ESLint } from 'eslint';

import resilient from 'eslint-plugin-resilient';
import {
    createContractDocument,
    createContractGraph
} from 'eslint-plugin-resilient/contracts';

import { getLocalAnalysisSession } from '../rules/contracts/analysis-session.js';
import { createEvidenceRegistry } from '../rules/contracts/evidence.js';
import { getFlowContext } from '../rules/contracts/flow.js';
import { inferExpression, walk } from '../rules/contracts/infer.js';
import {
    getCallableEvidence,
    getPredicateEvidence
} from '../rules/contracts/member-evidence.js';
import { captureProgram } from '../rules/support/eslint-program.js';

// Distinct admitted AST units may share a parser range; range lookup retains both facts.
const sameRangeLiteral = Object.freeze({ type: 'Literal', value: 'x', range: [1, 2] });
const sameRangeArray = Object.freeze({ type: 'ArrayExpression', elements: [], range: [1, 2] });
const collisionRegistry = createEvidenceRegistry({
    fileName: 'collision.js', expressions: [sameRangeLiteral, sameRangeArray]
});
const collisionIds = collisionRegistry.getEvidence().map(({ id = '' } = {}) => id);
assert.equal(collisionIds.length, 2);
assert.deepEqual(collisionRegistry.getEvidenceIdsForNode(sameRangeLiteral), collisionIds);
assert.deepEqual(collisionRegistry.getEvidenceIdsForNode(sameRangeArray), collisionIds);
assert.deepEqual(collisionRegistry.getEvidenceIdsForNode({ range: [1, 3] }), []);
assert.deepEqual(collisionRegistry.getEvidenceIdsForNode({}), []);
assert.notEqual(collisionRegistry.getEvidenceIdsForNode(sameRangeLiteral), collisionRegistry.getEvidenceIdsForNode(sameRangeLiteral));

const getProgram = async (code, fileName = 'evidence.js') => captureProgram(code, { fileName });
const getCallQuery = async ({ code = '', match = () => false } = {}) => {
    const sourceProgram = await getProgram(code, 'callable-evidence.js');
    const session = getLocalAnalysisSession(sourceProgram);
    const flows = session.getFlows();
    let call = {};

    walk(sourceProgram, (node = {}) => {
        const { type: callType = '' } = call;
        const { type = '' } = node;

        if (!callType && type === 'CallExpression' && match(node)) call = node;
    });

    const { definitions = {} } = session;
    const context = getFlowContext({ node: call, definitions, flows });
    const { callee = {} } = call;
    const { object = {} } = callee;
    const receiver = inferExpression(object, context);

    return {
        callable: getCallableEvidence({ callee, receiver, context }),
        context,
        node: call
    };
};

const authoredCallable = await getCallQuery({
    code: 'const api = { map: () => "ok" }; api.map();',
    match: ({ callee = {} } = {}) => {
        const { property = {} } = callee;
        const { name = '' } = property;

        return name === 'map';
    }
});
const { callable: authoredEvidence = {} } = authoredCallable;
assert.equal(authoredEvidence.status, 'known-authored');

const nativeCallable = await getCallQuery({
    code: 'const NativeObject = Object; NativeObject.entries({});',
    match: ({ callee = {} } = {}) => {
        const { property = {} } = callee;
        const { name = '' } = property;

        return name === 'entries';
    }
});
assert.deepEqual(nativeCallable.callable, {
    status: 'justified-native',
    nativeIdentity: 'Object',
    method: 'entries'
});

const unknownCallable = await getCallQuery({
    code: 'const inspect = api => api.map(Boolean);',
    match: ({ callee = {} } = {}) => {
        const { property = {} } = callee;
        const { name = '' } = property;

        return name === 'map';
    }
});
assert.deepEqual(unknownCallable.callable, { status: 'unknown' });

const falsePredicate = await getCallQuery({
    code: 'const isFunction = value => !!value; const inspect = value => isFunction(value);',
    match: ({ callee = {} } = {}) => {
        const { name = '' } = callee;

        return name === 'isFunction';
    }
});
const { node: falsePredicateNode = {}, context: falsePredicateContext = {} } = falsePredicate;
assert.deepEqual(getPredicateEvidence({ node: falsePredicateNode, context: falsePredicateContext }), {
    status: 'known-authored',
    predicateKind: ''
});

const resolvedPredicate = await getCallQuery({
    code: 'const isFunction = value => typeof value === "function"; const inspect = value => isFunction(value);',
    match: ({ callee = {} } = {}) => {
        const { name = '' } = callee;

        return name === 'isFunction';
    }
});
const { node: resolvedPredicateNode = {}, context: resolvedPredicateContext = {} } = resolvedPredicate;
assert.deepEqual(getPredicateEvidence({ node: resolvedPredicateNode, context: resolvedPredicateContext }), {
    status: 'known-authored',
    predicateKind: 'function'
});
const reaches = ({ records = [], from = '', target = '', visited = new Set() } = {}) => {
    if (!from || visited.has(from)) return false;

    const nextVisited = new Set([...visited, from]);
    const record = records.find(({ id = '' } = {}) => id === from) || {};
    const { derivesFrom = [] } = record;

    return derivesFrom.includes(target) || derivesFrom.some(parent => reaches({
        records,
        from: parent,
        target,
        visited: nextVisited
    }));
};

const getRecordRange = ({ source = {} } = {}) => {
    const { range = [] } = source;

    return range;
};

const code = 'const getItems = ({ items = [] } = {}) => items.map(item => item); getItems({});';
const program = await getProgram(code);
const document = createContractDocument(program, { fileName: 'evidence.js' });
const records = document.getEvidence();
const operation = records.find((record = {}) => {
    const { kind = '' } = record;

    return kind === 'propagation' &&
        JSON.stringify(getRecordRange(record)) === JSON.stringify([
            code.indexOf('items.map'),
            code.indexOf('items.map') + 'items.map(item => item)'.length
        ]);
});
const defaultEvidence = records.find((record = {}) => {
    const { fact = {} } = record;
    const { contract = {} } = fact;
    const { kind = '' } = contract;

    return kind === 'array' &&
        JSON.stringify(getRecordRange(record)) === JSON.stringify([
            code.indexOf('items ='),
            code.indexOf('items =') + 'items = []'.length
        ]);
});
const returnEvidence = records.find(({ fact = {} } = {}) => (
    fact.subject.startsWith('return:getItems@')
));

assert.ok(operation);
assert.ok(defaultEvidence);
assert.ok(returnEvidence);
assert.equal(reaches({ records, from: operation.id, target: defaultEvidence.id }), true);
assert.equal(reaches({ records, from: returnEvidence.id, target: operation.id }), true);
assert.equal(records.every(record => !Object.prototype.hasOwnProperty.call(record, 'sourceNode')), true);
assert.equal(records.every(record => !Object.prototype.hasOwnProperty.call(record, 'anchorKey')), true);

const repeatedDocument = createContractDocument(program, { fileName: 'evidence.js' });
assert.deepEqual(repeatedDocument.getEvidence(), records);

const boundaryCode = 'const result = client.fetch(); result.toUpperCase();';
const boundaryProgram = await getProgram(boundaryCode, 'sdk-boundary.js');
const boundaryDocument = createContractDocument(boundaryProgram, { fileName: 'sdk-boundary.js' });
const boundary = boundaryDocument.getEvidence().find(({ kind = '', origin = '' } = {}) => (
    kind === 'boundary' && origin === 'external-data'
));

assert.ok(boundary);
assert.equal(boundary.status, 'unknown');
assert.equal(boundary.boundaryOwner, 'external-data');
assert.deepEqual(boundary.fact.contract, {
    kind: 'unknown',
    state: 'unknown',
    optional: false
});

const guardCode = 'const read = value => { if (Array.isArray(value)) return value; return []; };';
const guardProgram = await getProgram(guardCode, 'guard.js');
const guardDocument = createContractDocument(guardProgram, { fileName: 'guard.js' });
const guard = guardDocument.getEvidence().find(({ kind = '' } = {}) => kind === 'guard');

assert.ok(guard);
assert.equal(guard.fact.contract.kind, 'array');
assert.equal(guard.fact.contract.state, 'known');

const diagnosticCode = 'const inspect = ({ items = [] } = {}) => items.toUpperCase();';
const diagnosticProgram = await getProgram(diagnosticCode, 'diagnostic.js');
const diagnosticDocument = createContractDocument(diagnosticProgram, { fileName: 'diagnostic.js' });
const [diagnostic = {}] = diagnosticDocument.getDiagnostics();

assert.ok(diagnostic);
assert.ok(diagnostic.evidenceIds.length);

const providerProgram = await getProgram('export const getItems = ({ items = [] } = {}) => items;', 'provider.js');
const consumerProgram = await getProgram('import { getItems } from "./provider.js"; getItems({}).toUpperCase();', 'consumer.js');
const graph = createContractGraph({
    programs: {
        'provider.js': providerProgram,
        'consumer.js': consumerProgram
    }
});
const graphEvidence = graph.getEvidence();

assert.equal(graphEvidence.some(({ id = '' } = {}) => id.startsWith('consumer.js:')), true);
assert.equal(graphEvidence.every(({ id = '' } = {}) => !id.startsWith('evidence-')), true);

const automaticEslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [resilient.configs.contracts]
});
const [automaticResult = {}] = await automaticEslint.lintText(
    'const inspect = ({ items = [] } = {}) => items.toUpperCase();',
    { filePath: 'automatic-message.js' }
);
const { messages: automaticMessages = [] } = automaticResult;
const [automaticMessage = {}] = automaticMessages;

const { message: automaticText = '' } = automaticMessage;

assert.match(automaticText, /static evidence: default at line 1/);

const standaloneDefaultEslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{
        plugins: { resilient },
        rules: {
            'resilient/signature-contract-operation': 'error'
        }
    }]
});
const [standaloneDefaultResult = {}] = await standaloneDefaultEslint.lintText(
    diagnosticCode,
    { filePath: 'standalone-default-message.js' }
);
const { messages: standaloneDefaultMessages = [] } = standaloneDefaultResult;
const [standaloneDefaultMessage = {}] = standaloneDefaultMessages;

assert.match(standaloneDefaultMessage.message || '', /static evidence: default at line 1/);

const completionEslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{
        plugins: { resilient },
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        settings: { resilient: { evidenceMessages: false } },
        rules: {
            'resilient/signature-contract-operation': 'error',
            'resilient/signature-contract-return-consistency': 'error'
        }
    }]
});
const completionSources = [
    'const run = () => { try { return []; } finally { return "ok"; } }; run().trim();',
    'const run = () => { try { return []; } finally { const done = true; } }; run().map(Boolean);',
    'const run = () => { let value = "ok"; try { value = []; throw Error("stop"); } catch (error) { return value.map(Boolean); } };',
    'const run = () => { try { throw Error("stop"); } finally {} return []; }; run().trim();',
    'const run = () => { outer: for (;;) { break outer; } return "ok"; }; run().trim();',
    'const run = () => { while (true) { return []; } return "unreachable"; }; run().map(Boolean);'
];
const completionResults = await Promise.all(completionSources.map((source, index) => completionEslint.lintText(
    source,
    { filePath: `completion-${index}.js` }
)));
const completionMessages = completionResults.flatMap(([result = {}] = []) => {
    const { messages = [] } = result;

    return messages;
});
assert.deepEqual(completionMessages, []);

const [conservativeCatchResult = {}] = await completionEslint.lintText(
    'const run = flag => { let value = "ok"; try { if (flag) maybe(); value = []; maybe(); } catch (error) { return value.map(Boolean); } };',
    { filePath: 'completion-conservative-catch.js' }
);
assert.deepEqual(conservativeCatchResult.messages, []);
const conservativeCatchProgram = await getProgram(
    'const run = flag => { let value = "ok"; try { if (flag) maybe(); value = []; maybe(); } catch (error) { return value.map(Boolean); } };',
    'completion-conservative-catch.js'
);
const conservativeCatchSession = getLocalAnalysisSession(conservativeCatchProgram);
const conservativeCatchFlows = conservativeCatchSession.getFlows();
let conservativeReceiver = {};
walk(conservativeCatchProgram, ({ type = '', object = {}, property = {} } = {}) => {
    const { name = '' } = property;

    if (type === 'MemberExpression' && name === 'map') conservativeReceiver = object;
});
const conservativeContext = getFlowContext({
    node: conservativeReceiver,
    definitions: conservativeCatchSession.definitions,
    flows: conservativeCatchFlows
});
const conservativeContract = inferExpression({ ...conservativeReceiver }, conservativeContext);
const { kind: conservativeKind = '' } = conservativeContract;
assert.equal(conservativeKind, 'unknown');

const optOutEslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
        resilient.configs.contracts,
        {
            settings: {
                resilient: {
                    evidenceMessages: false
                }
            }
        }
    ]
});
const [optOutResult = {}] = await optOutEslint.lintText(
    'const inspect = ({ items = [] } = {}) => items.toUpperCase();',
    { filePath: 'opt-out-message.js' }
);
const { messages: optOutMessages = [] } = optOutResult;
const [optOutMessage = {}] = optOutMessages;

const { message: optOutText = '' } = optOutMessage;

assert.equal(optOutText, 'items is array-like, but .toUpperCase() requires a string-like.');
