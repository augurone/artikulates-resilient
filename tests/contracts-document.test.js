import assert from 'node:assert/strict';

import { ESLint } from 'eslint';
import {
    createContractDocument,
    createContractGraph
} from 'eslint-plugin-resilient/contracts';

const getProgram = async (code) => {
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
            plugins: { capture },
            rules: { 'capture/program': 'error' }
        }]
    });

    await eslint.lintText(code, { filePath: 'contract-document.js' });
    return program;
};

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
assert.equal(Object.hasOwn(missingGraph.moduleExports['provider-missing.js'], 'missing'), false);
assert.equal(missingGraph.getDocument('consumer-missing.js').definitions.missing, undefined);
assert.equal(missingGraph.getDocument('consumer-missing.js').getDiagnostics().length, 0);
