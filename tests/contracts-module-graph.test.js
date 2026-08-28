import assert from 'node:assert/strict';

import { ESLint } from 'eslint';
import { createContractGraph } from 'eslint-plugin-resilient/contracts';

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

    await eslint.lintText(code, { filePath: 'contract-graph.js' });
    return program;
};

const createGraph = async (sources = {}) => createContractGraph({
    programs: Object.fromEntries(await Promise.all(Object.entries(sources)
        .map(async ([fileName = '', code = ''] = []) => [fileName, await getProgram(code)])))
});

const reexportGraph = await createGraph({
    'base.js': 'export const getItems = ({ items = [] } = {}) => items;',
    'barrel.js': 'export { getItems } from "./base.js";',
    'consumer.js': 'import { getItems } from "./barrel.js"; getItems({}).toUpperCase();'
});
assert.equal(Object.hasOwn(reexportGraph.moduleExports['barrel.js'], 'getItems'), true);
assert.equal(reexportGraph.getDiagnostics().length, 1);
assert.equal(reexportGraph.getDiagnostics()[0].fileName, 'consumer.js');
assert.equal(reexportGraph.getDiagnostics()[0].ruleId, 'signature-contract-operation');

const exportAllGraph = await createGraph({
    'base.js': 'export const getItems = ({ items = [] } = {}) => items;',
    'barrel.js': 'export * from "./base.js";',
    'consumer.js': 'import { getItems } from "./barrel.js"; getItems({}).toUpperCase();'
});
assert.equal(Object.hasOwn(exportAllGraph.moduleExports['barrel.js'], 'getItems'), true);
assert.equal(exportAllGraph.getDocument('consumer.js').getDiagnostics().length, 1);

const namespaceGraph = await createGraph({
    'base.js': 'export const getItems = ({ items = [] } = {}) => items;',
    'barrel.js': 'export * as api from "./base.js";',
    'consumer.js': 'import { api } from "./barrel.js"; api.getItems({}).toUpperCase();'
});
assert.equal(namespaceGraph.moduleExports['barrel.js'].api.kind, 'object');
assert.equal(namespaceGraph.getDiagnostics().length, 1);
assert.equal(namespaceGraph.getDiagnostics()[0].ruleId, 'signature-contract-operation');
assert.equal(namespaceGraph.getAgreements().every(({ kind = '' } = {}) => kind === 'resolved'), true);

const namespaceImportGraph = await createGraph({
    'base.js': 'export const getItems = ({ items = [] } = {}) => items;',
    'consumer.js': 'import * as api from "./base.js"; api.getItems({}).toUpperCase();'
});
assert.equal(namespaceImportGraph.getDiagnostics().length, 1);
assert.equal(namespaceImportGraph.getAgreements()[0].kind, 'resolved');

const defaultGraph = await createGraph({
    'provider.js': 'export default ({ title = "" } = {}) => title;',
    'consumer.js': 'import render from "./provider.js"; render({ title: 42 });'
});
assert.equal(Object.hasOwn(defaultGraph.moduleExports['provider.js'], 'default'), true);
assert.equal(defaultGraph.getDiagnostics().length, 1);
assert.equal(defaultGraph.getDiagnostics()[0].ruleId, 'signature-contract-call-site');
assert.equal(defaultGraph.getDiagnostics()[0].data.path, 'title');

const wrapperGraph = await createGraph({
    'provider.js': 'export const getItems = ({ items = [] } = {}) => items;',
    'wrapper.js': [
        'import { getItems } from "./provider.js";',
        'export const load = () => { const readItems = getItems; return readItems({}); };'
    ].join('\n'),
    'consumer.js': 'import { load } from "./wrapper.js"; load().toUpperCase();'
});
assert.equal(wrapperGraph.moduleExports['wrapper.js'].load.returnContract.kind, 'array');
assert.equal(wrapperGraph.getDiagnostics().length, 1);
assert.equal(wrapperGraph.getDiagnostics()[0].fileName, 'consumer.js');
assert.equal(wrapperGraph.getDiagnostics()[0].ruleId, 'signature-contract-operation');

const aliasGraph = await createGraph({
    'provider.js': 'export const getItems = ({ items = [] } = {}) => items;',
    'consumer.js': [
        'import { getItems } from "./provider.js";',
        'const readItems = getItems;',
        'readItems({}).toUpperCase();'
    ].join('\n')
});
assert.equal(aliasGraph.getDiagnostics().length, 1);
assert.equal(aliasGraph.getDiagnostics()[0].ruleId, 'signature-contract-operation');

const asyncGraph = await createGraph({
    'provider.js': 'export const getItems = async ({ items = [] } = {}) => items;',
    'consumer.js': [
        'import { getItems } from "./provider.js";',
        'export const inspect = async () => {',
        '    const values = await getItems({});',
        '    return values.toUpperCase();',
        '};'
    ].join('\n')
});
assert.equal(asyncGraph.moduleExports['provider.js'].getItems.returnContract.kind, 'promise');
assert.equal(asyncGraph.getDiagnostics().length, 1);
assert.equal(asyncGraph.getDiagnostics()[0].ruleId, 'signature-contract-operation');

const contradictoryReturnGraph = await createGraph({
    'provider.js': 'export const getValue = ({ enabled = false } = {}) => enabled ? "" : null;',
    'consumer.js': [
        'import { getValue } from "./provider.js";',
        'getValue({ enabled: 42 });',
        'getValue({}).toUpperCase();'
    ].join('\n')
});
const contradictoryDiagnostics = contradictoryReturnGraph.getDiagnostics();
assert.equal(contradictoryDiagnostics.length, 1);
assert.equal(contradictoryDiagnostics[0].ruleId, 'signature-contract-call-site');
assert.equal(contradictoryDiagnostics[0].data.path, 'enabled');
assert.equal(
    contradictoryReturnGraph.moduleExports['provider.js'].getValue.returnContract.kind,
    'unknown'
);

const callbackGraph = await createGraph({
    'provider.js': 'export const getTitle = ({ title = "" } = {}) => title;',
    'consumer.js': [
        'import { getTitle } from "./provider.js";',
        'const apply = (callback, value) => callback(value);',
        'apply(getTitle, { title: 42 });'
    ].join('\n')
});
assert.equal(callbackGraph.getDiagnostics().length, 1);
assert.equal(callbackGraph.getDiagnostics()[0].ruleId, 'signature-contract-call-site');

const cycleGraph = await createGraph({
    'a.js': [
        'export const getItems = ({ items = [] } = {}) => items;',
        'export { other } from "./b.js";'
    ].join('\n'),
    'b.js': 'export { getItems as other } from "./a.js";',
    'consumer.js': 'import { other } from "./b.js"; other({}).toUpperCase();'
});
assert.equal(cycleGraph.moduleExports['b.js'].other.returnContract.kind, 'array');
assert.equal(cycleGraph.getDiagnostics().length, 1);
assert.equal(cycleGraph.getDiagnostics()[0].fileName, 'consumer.js');

const conflictGraph = await createGraph({
    'first.js': 'export const getItems = ({ items = [] } = {}) => items;',
    'second.js': 'export const getItems = ({ title = "" } = {}) => title;',
    'barrel.js': [
        'export * from "./first.js";',
        'export * from "./second.js";'
    ].join('\n'),
    'consumer.js': 'import { getItems } from "./barrel.js"; getItems({}).toUpperCase();'
});
assert.equal(Object.hasOwn(conflictGraph.moduleExports['barrel.js'], 'getItems'), false);
assert.equal(conflictGraph.getAgreements().find(({ fileName = '' } = {}) => fileName === 'consumer.js').kind, 'ambiguous');
assert.equal(conflictGraph.getDiagnostics().length, 0);

const unknownCycleGraph = await createGraph({
    'a.js': 'export { value } from "./b.js";',
    'b.js': 'export { value } from "./a.js";',
    'consumer.js': 'import { value } from "./a.js"; value.toUpperCase();'
});
assert.equal(Object.hasOwn(unknownCycleGraph.moduleExports['a.js'], 'value'), false);
assert.equal(unknownCycleGraph.getDiagnostics().length, 0);

const missingAgreementGraph = await createGraph({
    'provider.js': 'export const present = ({ title = "" } = {}) => title;',
    'consumer.js': [
        'import { missing } from "./provider.js";',
        'import external from "external-package";'
    ].join('\n')
});
const missingAgreement = missingAgreementGraph.getAgreements()
    .find(({ importedName = '' } = {}) => importedName === 'missing');
const unknownAgreement = missingAgreementGraph.getAgreements()
    .find(({ importedName = '' } = {}) => importedName === 'default');
assert.equal(missingAgreement.kind, 'missing');
assert.equal(unknownAgreement.kind, 'unknown');
