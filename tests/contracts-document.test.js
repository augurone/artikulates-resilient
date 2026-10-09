import assert from 'node:assert/strict';

import { ESLint } from 'eslint';

import resilient from 'eslint-plugin-resilient';
import {
    createContractDocument,
    createContractGraph
} from 'eslint-plugin-resilient/contracts';

import { captureProgram } from '../rules/support/eslint-program.js';

const getProgram = async code => captureProgram(code, { fileName: 'contract-document.js' });
const code = 'const getTitle = ({ title = "" } = {}) => title; getTitle({ title: 42 });';
const program = await getProgram(code);
const document = createContractDocument(program, { fileName: 'contract-document.js' });

const titleOffset = code.indexOf('title =');
const titleResult = document.getContractAtOffset(titleOffset);
assert.equal(titleResult.contract.kind, 'string');

const signatureOffset = code.indexOf('title =');
const signatureResult = document.getSignatureAtOffset(signatureOffset);
assert.equal(signatureResult.name, 'getTitle');
assert.equal(signatureResult.signature.contract.kind, 'object');
assert.equal(signatureResult.signature.contract.properties.title.kind, 'string');

const valueOffset = code.indexOf('42');
const valueResult = document.getContractAtOffset(valueOffset);
assert.equal(valueResult.contract.kind, 'number');

const stackResult = document.getStackAtOffset(titleOffset);
assert.equal(stackResult.fileName, 'contract-document.js');
assert.deepEqual(stackResult.frames.map(({ kind = '' } = {}) => kind), [
    'file',
    'function',
    'expression'
]);
assert.equal(stackResult.frames[1].name, 'getTitle');
assert.equal(stackResult.frames[2].contract.kind, 'string');

const fileStackResult = document.getStackAtOffset(valueOffset);
assert.deepEqual(fileStackResult.frames.map(({ kind = '' } = {}) => kind), [
    'file',
    'expression'
]);
assert.equal(fileStackResult.frames[1].contract.kind, 'number');

const diagnostics = document.getDiagnostics();
assert.equal(diagnostics.length, 1);
assert.equal(diagnostics[0].ruleId, 'signature-contract-call-site');
assert.equal(diagnostics[0].data.path, 'title');
assert.equal(diagnostics[0].data.actual, 'number-like');
assert.equal(document.getDiagnosticsAtOffset(valueOffset).length, 1);

const arityCode = 'function choose(a, b) { switch (arguments.length) { case 1: return a; case 2: return b(a); default: throw Error("count"); } } choose(1); choose();';
const arityProgram = await getProgram(arityCode);
const arityDocument = createContractDocument(arityProgram, { fileName: 'arity.js' });
const arityFindings = arityDocument.getDiagnostics().filter(({ ruleId = '' } = {}) => ruleId === 'signature-contract-call-site');
assert.equal(arityFindings.length, 1);
assert.equal(arityFindings[0].messageId, 'arity');

const nestedCode = 'const outer = value => { const inner = (item = "") => item.trim(); return inner(value); };';
const nestedProgram = await getProgram(nestedCode);
const nestedDocument = createContractDocument(nestedProgram, { fileName: 'nested.js' });
const nestedStack = nestedDocument.getStackAtOffset(nestedCode.indexOf('item.trim'));
assert.deepEqual(nestedStack.frames.map(({ kind = '' } = {}) => kind), [
    'file',
    'function',
    'function',
    'expression'
]);
assert.deepEqual(nestedStack.frames.slice(1, 3).map(({ name = '' } = {}) => name), [
    'outer',
    'inner'
]);
assert.equal(nestedStack.frames[3].contract.kind, 'string');

const returnedFunctionCode = 'const makeHandler = () => value => value.trim(); const handler = makeHandler(); handler("value");';
const returnedFunctionProgram = await getProgram(returnedFunctionCode);
const returnedFunctionDocument = createContractDocument(returnedFunctionProgram, { fileName: 'returned-function.js' });
const returnedFunctionResult = returnedFunctionDocument.getContractAtOffset(returnedFunctionCode.indexOf('handler("value")'));
assert.equal(returnedFunctionResult.contract.kind, 'string');

const operationCode = 'const inspect = ({ items = [] } = {}) => items.toUpperCase();';
const operationProgram = await getProgram(operationCode);
const operationDocument = createContractDocument(operationProgram, { fileName: 'operation.js' });
const operationDiagnostics = operationDocument.getDiagnostics();
assert.equal(operationDiagnostics.length, 1);
assert.equal(operationDiagnostics[0].ruleId, 'signature-contract-operation');
assert.equal(operationDiagnostics[0].data.actual, 'array-like');
assert.equal(operationDiagnostics[0].data.expected, 'string-like');

const destructuringCode = 'const getValue = ({ value = [] } = {}) => { if (!Array.isArray(value)) return {}; const { attr = "" } = value; return attr; };';
const destructuringProgram = await getProgram(destructuringCode);
const destructuringDocument = createContractDocument(destructuringProgram, { fileName: 'destructuring.js' });
const destructuringDiagnostics = destructuringDocument.getDiagnostics();
assert.equal(destructuringDiagnostics.length, 1);
assert.equal(destructuringDiagnostics[0].ruleId, 'signature-contract-destructuring');
assert.equal(destructuringDiagnostics[0].data.actual, 'array-like');
assert.equal(destructuringDiagnostics[0].data.expected, 'object-like');

const nestedDestructuringCode = 'const getValue = () => { const { data: { items = [] } = {} } = { data: 42 }; return items; };';
const nestedDestructuringProgram = await getProgram(nestedDestructuringCode);
const nestedDestructuringDocument = createContractDocument(nestedDestructuringProgram, { fileName: 'nested-destructuring.js' });
const nestedDestructuringDiagnostics = nestedDestructuringDocument.getDiagnostics();
assert.equal(nestedDestructuringDiagnostics.length, 1);
assert.equal(nestedDestructuringDiagnostics[0].ruleId, 'signature-contract-destructuring');
assert.equal(nestedDestructuringDiagnostics[0].data.actual, 'number-like');
assert.equal(nestedDestructuringDiagnostics[0].data.expected, 'object-like');

const nestedArrayDestructuringCode = 'const getValue = () => { const [{ attr = "" } = {}] = [42]; return attr; };';
const nestedArrayDestructuringProgram = await getProgram(nestedArrayDestructuringCode);
const nestedArrayDestructuringDocument = createContractDocument(nestedArrayDestructuringProgram, { fileName: 'nested-array-destructuring.js' });
const nestedArrayDestructuringDiagnostics = nestedArrayDestructuringDocument.getDiagnostics();
assert.equal(nestedArrayDestructuringDiagnostics.length, 1);
assert.equal(nestedArrayDestructuringDiagnostics[0].data.actual, 'number-like');
assert.equal(nestedArrayDestructuringDiagnostics[0].data.expected, 'object-like');

const forwardCallCode = 'const first = () => second(); const second = () => ({ items: [] }); first().items.toUpperCase();';
const forwardCallProgram = await getProgram(forwardCallCode);
const forwardCallDocument = createContractDocument(forwardCallProgram, { fileName: 'forward-call.js' });
const forwardCallDiagnostics = forwardCallDocument.getDiagnostics();
assert.equal(forwardCallDiagnostics.length, 1);
assert.equal(forwardCallDiagnostics[0].ruleId, 'signature-contract-operation');
assert.equal(forwardCallDiagnostics[0].data.receiver, 'first().items');
assert.equal(forwardCallDiagnostics[0].data.actual, 'array-like');
assert.equal(forwardCallDiagnostics[0].data.expected, 'string-like');

const computedDestructuringCode = 'const getValue = (items = []) => { const { [0]: value = {} } = items; return value; };';
const computedDestructuringProgram = await getProgram(computedDestructuringCode);
const computedDestructuringDocument = createContractDocument(computedDestructuringProgram);
assert.equal(computedDestructuringDocument.getDiagnostics().length, 0);
const destructuredValueOffset = destructuringCode.indexOf('value;');
assert.deepEqual(destructuringDiagnostics[0].range, [
    destructuredValueOffset,
    destructuredValueOffset + 'value'.length
]);
assert.equal(destructuringDocument.getDiagnosticsAtOffset(destructuredValueOffset).length, 1);

const providerCode = 'export const render = ({ title = "" } = {}) => title.trim();';
const consumerCode = 'import { render } from "./provider.js"; render({ title: 42 });';
const providerProgram = await getProgram(providerCode);
const consumerProgram = await getProgram(consumerCode);
const graph = createContractGraph({
    programs: {
        'provider.js': providerProgram,
        'consumer.js': consumerProgram
    }
});
const graphDiagnostics = graph.getDiagnostics();
assert.equal(graphDiagnostics.length, 1);
assert.equal(graphDiagnostics[0].fileName, 'consumer.js');
assert.equal(graphDiagnostics[0].ruleId, 'signature-contract-call-site');
assert.equal(graph.getDocument('consumer.js').getDiagnostics().length, 1);

const returnedProviderCode = 'export const getItems = ({ items = [] } = {}) => items;';
const returnedConsumerCode = 'import { getItems } from "./provider-items.js"; getItems({}).toUpperCase();';
const returnedProviderProgram = await getProgram(returnedProviderCode);
const returnedConsumerProgram = await getProgram(returnedConsumerCode);
const returnedGraph = createContractGraph({
    programs: {
        'provider-items.js': returnedProviderProgram,
        'consumer-items.js': returnedConsumerProgram
    }
});
const returnedDiagnostics = returnedGraph.getDiagnostics();
assert.equal(returnedDiagnostics.length, 1);
assert.equal(returnedDiagnostics[0].fileName, 'consumer-items.js');
assert.equal(returnedDiagnostics[0].ruleId, 'signature-contract-operation');
assert.equal(returnedDiagnostics[0].data.receiver, 'getItems()');
assert.equal(returnedDiagnostics[0].data.actual, 'array-like');
assert.equal(returnedDiagnostics[0].data.expected, 'string-like');
const returnedStack = returnedGraph.getDocument('consumer-items.js')
    .getStackAtOffset(returnedConsumerCode.indexOf('getItems({})'));
assert.equal(returnedStack.frames.at(-1).kind, 'expression');
assert.equal(returnedStack.frames.at(-1).contract.kind, 'array');

const propertyProviderCode = 'export const getConfig = () => ({ items: [] });';
const propertyConsumerCode = 'import { getConfig } from "./provider-config.js"; getConfig().items.toUpperCase();';
const propertyProviderProgram = await getProgram(propertyProviderCode);
const propertyConsumerProgram = await getProgram(propertyConsumerCode);
const propertyGraph = createContractGraph({
    programs: {
        'provider-config.js': propertyProviderProgram,
        'consumer-config.js': propertyConsumerProgram
    }
});
const propertyDiagnostics = propertyGraph.getDiagnostics();
assert.equal(propertyDiagnostics.length, 1);
assert.equal(propertyDiagnostics[0].fileName, 'consumer-config.js');
assert.equal(propertyDiagnostics[0].ruleId, 'signature-contract-operation');
assert.equal(propertyDiagnostics[0].data.receiver, 'getConfig().items');
assert.equal(propertyDiagnostics[0].data.actual, 'array-like');

const missingProviderProgram = await getProgram('export const present = ({ title = "" } = {}) => title;');
const missingConsumerProgram = await getProgram('import { missing } from "./provider-missing.js"; missing({ title: 42 });');
const missingGraph = createContractGraph({
    programs: {
        'provider-missing.js': missingProviderProgram,
        'consumer-missing.js': missingConsumerProgram
    }
});
const { moduleExports: missingModuleExports = {} } = missingGraph;
const { ['provider-missing.js']: missingProviderExports = {} } = missingModuleExports;
const { missing: foundMissing = false } = missingProviderExports;
assert.equal(!!foundMissing, false);
assert.equal(missingGraph.getDocument('consumer-missing.js').definitions.missing, undefined);
assert.equal(missingGraph.getDocument('consumer-missing.js').getDiagnostics().length, 0);

// Analyzer facts follow lexical bindings, so renaming an unrelated shadow does
// not change the outer operation and block-local declarations cannot replace it.
const getOperationMessages = async (source = '') => {
    const sourceDocument = createContractDocument(await getProgram(source));

    return sourceDocument.getDiagnostics()
        .filter(({ ruleId = '' } = {}) => ruleId === 'signature-contract-operation')
        .map(({ message = '' } = {}) => message);
};
const outerString = "const value = 'ok'; { const value = []; } value.trim();";
const renamedShadow = "const value = 'ok'; { const inner = []; } value.trim();";
assert.deepEqual(await getOperationMessages(outerString), []);
assert.deepEqual(await getOperationMessages(renamedShadow), []);
assert.deepEqual(await getOperationMessages(
    "const value = 'ok'; { const value = []; } value.map(Boolean);"
), ['value is string-like, but .map() requires a array-like.']);

const shadowedFunction = 'const read = () => "ok"; const wrap = () => { const read = () => []; return read(); }; const consume = () => read().trim();';
const renamedFunctionShadow = 'const read = () => "ok"; const wrap = () => { const localRead = () => []; return localRead(); }; const consume = () => read().trim();';
assert.deepEqual(await getOperationMessages(shadowedFunction), []);
assert.deepEqual(await getOperationMessages(renamedFunctionShadow), []);

const namespaceShadow = "import * as api from 'external'; const inspect = (api = 'ok') => api.map(Boolean);";
assert.deepEqual(await getOperationMessages(namespaceShadow), [
    'api is string-like, but .map() requires a array-like.'
]);

// Writes to an outer identity survive block exit even though declarations in
// that block disappear from the public name-oriented view.
assert.deepEqual(await getOperationMessages(
    "let value = 'ok'; { value = []; const local = 1; } value.trim();"
), ['value is array-like, but .trim() requires a string-like.']);

const catchShadow = "const error = 'ok'; try { throw []; } catch (error) { error.map(Boolean); } error.map(Boolean);";
assert.deepEqual(await getOperationMessages(catchShadow), [
    'error is string-like, but .map() requires a array-like.'
]);

// Function frames and signatures are selected by function-node identity, not
// by the spelling shared with another lexical definition.
const identityFrameCode = 'const read = () => "outer"; const wrap = () => { const read = () => []; return read(); };';
const identityFrameDocument = createContractDocument(await getProgram(identityFrameCode));
const innerReadOffset = identityFrameCode.indexOf('() => []') + 6;
const innerSignature = identityFrameDocument.getSignatureAtOffset(innerReadOffset);
assert.equal(innerSignature.name, 'read');
assert.equal(innerSignature.returnContract.kind, 'array');

// All five public contract families share the portable diagnostic readers.
// Source ordering makes the document, graph and ESLint presentation order
// directly comparable as well as proving their locations agree.
const familyCode = [
    'const takes = ({ title = "" } = {}) => title;',
    'takes({ title: 42 });',
    '[].toUpperCase();',
    'const { missing } = { present: "" };',
    '({ present: "" }).missing;',
    'const choose = flag => { if (flag) return []; return "ok"; };'
].join('\n');
const familyProgram = await getProgram(familyCode);
const familyDocument = createContractDocument(familyProgram, { fileName: 'families.js' });
const familyGraph = createContractGraph({ programs: { 'families.js': familyProgram } });
const summarizePortable = (records = []) => records.map(({
    ruleId = '',
    loc: { start: { line = 0, column = -1 } = {} } = {}
} = {}) => ({ ruleId, line, column: column + 1 }));
const familyDiagnostics = familyDocument.getDiagnostics();
const documentSummary = summarizePortable(familyDiagnostics);
const graphSummary = summarizePortable(familyGraph.getDiagnostics());
const contractEslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{
        ...resilient.configs.contracts,
        settings: { resilient: { evidenceMessages: false } }
    }]
});
const [familyLint = {}] = await contractEslint.lintText(familyCode, { filePath: 'families.js' });
const eslintSummary = familyLint.messages.map(({
    ruleId = '',
    line = 0,
    column = 0
} = {}) => ({
    ruleId: ruleId.replace('resilient/', ''),
    line,
    column
}));
const expectedFamilyOrder = [
    'signature-contract-call-site',
    'signature-contract-operation',
    'signature-contract-destructuring',
    'signature-contract-property',
    'signature-contract-return-consistency',
    'signature-contract-return-consistency'
];
assert.deepEqual(documentSummary.map(({ ruleId = '' } = {}) => ruleId), expectedFamilyOrder);
assert.deepEqual(graphSummary, documentSummary);
assert.deepEqual(eslintSummary, documentSummary);
assert.deepEqual(
    familyDiagnostics.slice(-2).map(({ data = {} } = {}) => data),
    [
        { actual: 'array', expected: 'string' },
        { actual: 'string', expected: 'array' }
    ]
);
assert.equal(
    familyDocument.getDiagnosticsAtOffset(familyCode.indexOf('return []') + 'return '.length)[0].ruleId,
    'signature-contract-return-consistency'
);
