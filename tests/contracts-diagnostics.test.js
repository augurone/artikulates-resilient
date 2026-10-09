import assert from 'node:assert/strict';

import { ESLint } from 'eslint';

import resilient from 'eslint-plugin-resilient';

import { loadInternalModule } from './internal-module.js';
import {
    getReturnDiagnostics,
    hasComputedProperty
} from '../rules/contracts/diagnostics.js';
import { createContractDocument } from '../rules/contracts/document.js';
import { createFunctionFlows } from '../rules/contracts/flow.js';
import { getChildren, getDefinitions } from '../rules/contracts/infer.js';
import { getKind } from '../rules/contracts/model.js';
import { createContractGraph } from '../rules/contracts/module-graph.js';
import { captureProgram } from '../rules/support/eslint-program.js';

const nullNode = JSON.parse('null');
assert.equal(hasComputedProperty(nullNode), false);
assert.equal(hasComputedProperty({
    left: null,
    argument: null,
    properties: [null],
    elements: [null]
}), false);
assert.equal(hasComputedProperty({
    properties: [{
        type: 'Property',
        computed: true
    }]
}), true);

const { getArrayCallbackOperationContexts = undefined, getArrayCallbackDefinition = undefined } = await loadInternalModule({
    file: 'rules/contracts/diagnostics.js',
    exports: ['getArrayCallbackOperationContexts', 'getArrayCallbackDefinition']
});
const program = await captureProgram(
    'const read = value => value.length; ["a"].map(read); [[1]].map(read);',
    { fileName: 'callback-store-proof.js' }
);
const definitions = getDefinitions(program);
const flows = createFunctionFlows({ program, definitions });
const contexts = getArrayCallbackOperationContexts({ program, definitions, flows });
const { read: definition = {} } = definitions;
const { node: callback = {} } = definition;
const { body: member = {} } = callback;
const bucket = contexts.get(member);
assert.equal(contexts.size, 1);
assert.equal(bucket.length, 2);
assert.deepEqual(bucket.map(({ bindings: { value = {} } = {} } = {}) => getKind(value)), ['string', 'array']);
assert.notEqual(bucket[0], bucket[1]);
assert.equal(contexts.get(member), bucket);
assert.equal(contexts.has({ ...member }), false);
const repeated = getArrayCallbackOperationContexts({ program, definitions, flows });
const repeatedBucket = repeated.get(member);
assert.notEqual(repeated, contexts);
assert.notEqual(repeatedBucket, bucket);
assert.equal(repeatedBucket.length, bucket.length);
// Fresh flow graphs contain cycles back to their callback contexts. Compare
// context facts and verify those graph links by identity instead of deep equality.
repeatedBucket.forEach((context, index) => {
    const { [index]: original = {} } = bucket;
    const { flows: repeatedFlows = new Map(), ...facts } = context;
    const { flows: originalFlows = new Map(), ...originalFacts } = original;
    assert.notEqual(context, original);
    assert.deepEqual(facts, originalFacts);
    assert.notEqual(repeatedFlows, originalFlows);
    assert.deepEqual([...repeatedFlows.keys()], [...originalFlows.keys()]);
    const repeatedFlow = repeatedFlows.get(callback);
    const originalFlow = originalFlows.get(callback);
    const { contexts: repeatedContexts = new Map(), finalContext: repeatedFinal = {} } = repeatedFlow;
    const { contexts: originalContexts = new Map(), finalContext: originalFinal = {} } = originalFlow;
    const { flows: repeatedFinalFlows = new Map(), bindings: repeatedBindings = {} } = repeatedFinal;
    const { bindings: originalBindings = {} } = originalFinal;
    assert.notEqual(repeatedFlow, originalFlow);
    assert.deepEqual([...repeatedContexts.keys()], [...originalContexts.keys()]);
    assert.equal(repeatedContexts.get(member), context);
    assert.equal(originalContexts.get(member), original);
    assert.equal(repeatedFinalFlows, repeatedFlows);
    assert.deepEqual(repeatedBindings, originalBindings);
});
assert.deepEqual([...getArrayCallbackOperationContexts()], []);
assert.deepEqual(getArrayCallbackDefinition({ callback: { type: 'Literal', value: 1 } }), {});
assert.deepEqual(getArrayCallbackDefinition({ callback: { type: 'Identifier', name: 'missing' } }), {});
assert.equal(getArrayCallbackDefinition({ callback: { type: 'Identifier', name: 'read' }, context: { functions: definitions } }), definition);
assert.equal(getArrayCallbackDefinition({ callback }).node, callback);

const returnCode = 'const choose = (flag = false) => { if (flag) return []; return "ok"; };';
const returnProgram = await captureProgram(returnCode, { fileName: 'portable-return-diagnostics.js' });
const returnDiagnostics = getReturnDiagnostics({ program: returnProgram });
assert.deepEqual(returnDiagnostics.map(({
    ruleId = '',
    messageId = '',
    data = {},
    node: { range = [] } = {}
} = {}) => ({ ruleId, messageId, data, range })), [
    {
        ruleId: 'signature-contract-return-consistency',
        messageId: 'inconsistent',
        data: { actual: 'array', expected: 'string' },
        range: [returnCode.indexOf('[]'), returnCode.indexOf('[]') + 2]
    },
    {
        ruleId: 'signature-contract-return-consistency',
        messageId: 'inconsistent',
        data: { actual: 'string', expected: 'array' },
        range: [returnCode.indexOf('"ok"'), returnCode.indexOf('"ok"') + 4]
    }
]);
assert.deepEqual(getReturnDiagnostics(), []);

const falsePositive = 'const read = flag => { let value = ""; if (flag) return ""; try { return value; } finally { value = []; } };';
const falseNegative = 'const read = flag => { let value = ""; if (flag) return 1; try { return value; } finally { value = 1; } };';
const guardedNoop = 'const read = cb => { if (typeof cb !== "function") return [].forEach(() => {}); return ""; };';
const guardedCallable = 'const read = cb => { if (typeof cb !== "function") return; return cb; };';
const implicitAbsence = 'const read = flag => { if (flag) return ""; };';
const summarizeReturns = diagnostics => diagnostics.map(({ data = {}, node: { range = [] } = {} } = {}) => ({ data, range }));
const containsIdentity = (root = {}, target = {}) => root === target ||
    getChildren(root).some(child => containsIdentity(child, target));
const freezeNodes = (node = {}) => {
    if (!node || typeof node !== 'object' || Object.isFrozen(node)) return;

    Object.values(node).forEach(freezeNodes);
    Object.freeze(node);
};
const lint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{
        plugins: { resilient },
        rules: { 'resilient/signature-contract-return-consistency': 'error' }
    }]
});
// eslint-disable-next-line resilient/prefer-prototype-methods -- Each captured ESLint session is awaited before the next parser representation is inspected.
for (const [code = '', expected = []] of [
    [falsePositive, []],
    [falseNegative, [
        { actual: 'number', expected: 'string' },
        { actual: 'string', expected: 'number' }
    ]],
    [guardedNoop, [
        { actual: 'undefined', expected: 'string' },
        { actual: 'string', expected: 'undefined' }
    ]],
    [guardedCallable, [
        { actual: 'undefined', expected: 'function' },
        { actual: 'function', expected: 'undefined' }
    ]],
    [implicitAbsence, [
        { actual: 'string', expected: 'undefined' },
        { actual: 'undefined', expected: 'string' }
    ]]
]) {
    const parented = await captureProgram(code, { fileName: 'r6.js' });
    // eslint-disable-next-line resilient/prefer-falsey-returns -- JSON replacer must omit parent links to create a genuinely parentless AST.
    const parentless = JSON.parse(JSON.stringify(parented, (key, value) => key === 'parent' ? undefined : value));

    freezeNodes(parentless);
    const [parentedResults = [], parentlessResults = []] = [parented, parentless]
        .map(programNode => getReturnDiagnostics({ program: programNode }));
    assert.deepEqual(parentedResults.map(({ data = {} } = {}) => data), expected);
    assert.deepEqual(summarizeReturns(parentlessResults), summarizeReturns(parentedResults));
    assert.equal(parentlessResults.every(({ node = {} } = {}) => containsIdentity(parentless, node)), true);
    assert.equal(parentedResults.every(({ node = {} } = {}) => containsIdentity(parented, node)), true);
    assert.equal(Object.isFrozen(parentless), true);
    const repeated = getReturnDiagnostics({ program: parentless });
    assert.notEqual(repeated, parentlessResults);
    const [firstRepeated = {}] = repeated;
    const [firstParentless = {}] = parentlessResults;

    if (repeated.length) assert.notEqual(firstRepeated, firstParentless);

    assert.deepEqual(summarizeReturns(repeated), summarizeReturns(parentlessResults));
    const document = createContractDocument(parentless, { fileName: 'r6.js' });
    const graph = createContractGraph({ programs: { 'r6.js': parentless } });
    const [lintResult = {}] = await lint.lintText(code, { filePath: 'r6.js' });
    const compact = diagnostics => diagnostics
        .filter(({ ruleId = '' } = {}) => ruleId.endsWith('signature-contract-return-consistency'))
        .map(({ message = '', node: { range = [] } = {} } = {}) => ({ message, range }));
    const direct = compact(parentlessResults);
    assert.deepEqual(compact(document.getDiagnostics()), direct);
    assert.deepEqual(compact(graph.getDiagnostics()), direct);
    assert.deepEqual((lintResult.messages || [])
        .filter(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-return-consistency')
        .map(({ message = '', line = 0, column = 0 } = {}) => ({ message, line, column })),
    parentlessResults.map(({ message = '', node: { loc: { start: { line = 0, column = 0 } = {} } = {} } = {} } = {}) => ({
        message, line, column: column + 1
    })).toSorted(({ line: leftLine = 0, column: leftColumn = 0 } = {}, {
        line: rightLine = 0, column: rightColumn = 0
    } = {}) => leftLine - rightLine || leftColumn - rightColumn));
}

const flowCases = [
    {
        code: 'const read = flag => { try { return flag ? "" : []; } finally { flag = false; } };',
        families: ['string', 'array'],
        sites: ['""', '[]']
    },
    {
        code: 'const read = flag => (1, flag ? "" : []);',
        families: ['string', 'array'],
        sites: ['""', '[]']
    },
    {
        code: 'const read = async flag => { if (flag) return ""; return []; };',
        families: ['string', 'array'],
        sites: ['""', '[]']
    },
    {
        code: 'const read = flag => { if (flag) return ""; return unknownValue; };',
        families: [],
        sites: []
    },
    {
        code: 'const read = flag => { if (flag) return ""; if (!flag) return []; return unknownValue; };',
        families: ['string', 'array'],
        sites: ['""', '[]']
    },
    {
        code: 'const read = flag => { try { return flag ? "" : []; } finally { return 1; } };',
        families: [],
        sites: []
    },
    {
        code: 'const read = flag => { if (flag) throw Error(); };',
        families: [],
        sites: []
    },
    {
        code: 'const read = flag => { if (flag) return ""; };',
        families: ['string', 'undefined'],
        sites: ['""', '{ if (flag) return ""; }']
    },
    {
        code: 'const read = flag => { if (flag) return; return ""; };',
        families: ['undefined', 'string'],
        sites: ['return;', '""']
    },
    {
        code: 'const read = flag => { if (flag) return; };',
        families: [],
        sites: []
    }
];
// eslint-disable-next-line resilient/prefer-prototype-methods -- Parser captures are sequential to keep each flow probe isolated.
for (const flowCase of flowCases) {
    const { code = '', families = [], sites = [] } = flowCase;
    const source = await captureProgram(code, { fileName: 'r6-flow.js' });
    const diagnostics = getReturnDiagnostics({ program: source });
    assert.deepEqual(diagnostics.map(({ data: { actual = '' } = {} } = {}) => actual), families);
    assert.deepEqual(diagnostics.map(({ node: { range: [start = -1, end = -1] = [] } = {} } = {}) => (
        code.slice(start, end))), sites);
}

const capturedProgram = await captureProgram(falsePositive, { fileName: 'r6-captured.js' });
const capturedFlows = createFunctionFlows({ program: capturedProgram, definitions: getDefinitions(capturedProgram) });
const { body: [firstStatement = {}] = [] } = capturedProgram;
const { declarations: [firstDeclaration = {}] = [] } = firstStatement;
const { init: capturedFunction = {} } = firstDeclaration;
const capturedFlow = capturedFlows.get(capturedFunction);
assert.equal(Array.isArray(capturedFlow.completions), true);
assert.deepEqual(capturedFlow.returns.map(({ contract: value = {} } = {}) => getKind(value)), ['string', 'string']);
assert.deepEqual(capturedFlow.completions
    .filter(({ kind = '' } = {}) => kind === 'return')
    .flatMap(({ resultBranches = [] } = {}) => resultBranches)
    .map(({ contract: value = {} } = {}) => getKind(value)), ['string', 'string']);
