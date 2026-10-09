import assert from 'node:assert/strict';

import { createContractGraph } from 'eslint-plugin-resilient/contracts';

import {
    clearContractGraphCaches,
    getImportBindings,
    getModuleSources
} from '../rules/contracts/module-graph.js';
import { createProgramMetadataCache } from '../rules/contracts/program-metadata-cache.js';
import { captureProgram } from '../rules/support/eslint-program.js';

let reads = 0;
let trace = [];
const metadata = Object.freeze(['module']);
const taggedProgram = Object.freeze({ get [Symbol.toStringTag]() {
    trace = [...trace, 'tag'];

    return 'Object';
} });
const cache = createProgramMetadataCache(function read(program) {
    assert.equal(this, undefined);
    assert.equal(program, taggedProgram);
    reads += 1;
    trace = [...trace, 'read'];

    return metadata;
});
const { clear: clearCache = undefined } = cache;
assert.equal(cache.get(taggedProgram), metadata);
assert.deepEqual(trace, ['tag', 'tag', 'read', 'tag']);
trace = [];
assert.equal(cache.get(taggedProgram), metadata);
assert.deepEqual(trace, ['tag', 'tag']);
clearCache();
trace = [];
assert.equal(cache.get(taggedProgram), metadata);
assert.deepEqual(trace, ['tag', 'tag', 'read', 'tag']);
assert.equal(reads, 2);

let invalidReads = 0;
const invalidCache = createProgramMetadataCache(() => {
    invalidReads += 1;

    return [];
});
[null, false, 0, '', Symbol('invalid'), [], () => ({}), new Date(0)].forEach((value) => {
    assert.notEqual(invalidCache.get(value), invalidCache.get(value));
});
assert.equal(invalidReads, 16);
assert.notEqual(invalidCache.get(), invalidCache.get());
assert.equal(invalidReads, 18);

const failure = new Error('metadata read failed');
let attempts = 0;
const retryCache = createProgramMetadataCache(() => {
    attempts += 1;

    if (attempts === 1) throw failure;

    return metadata;
});
const retryProgram = Object.freeze({});
assert.throws(() => retryCache.get(retryProgram), error => error === failure);
assert.equal(retryCache.get(retryProgram), metadata);
assert.equal(retryCache.get(retryProgram), metadata);
assert.equal(attempts, 2);

let malformedReads = 0;
const malformedCache = createProgramMetadataCache(() => {
    malformedReads += 1;

    return {};
});
assert.notEqual(malformedCache.get(retryProgram), malformedCache.get(retryProgram));
assert.equal(malformedReads, 2);

let nestedReads = 0;
let nestedResult = [];
const outerResult = Object.freeze(['outer']);
const innerResult = Object.freeze(['inner']);
const nestedCache = createProgramMetadataCache(() => {
    nestedReads += 1;

    if (nestedReads === 1) {
        nestedResult = nestedCache.get(retryProgram);

        return outerResult;
    }

    return innerResult;
});
assert.equal(nestedCache.get(retryProgram), outerResult);
assert.equal(nestedResult, innerResult);
assert.equal(nestedCache.get(retryProgram), outerResult);
assert.equal(nestedReads, 2);

let tagReads = 0;
let changingReads = 0;
const changingProgram = { get [Symbol.toStringTag]() {
    tagReads += 1;

    return tagReads % 3 === 0 ? 'Changed' : 'Object';
} };
const changingCache = createProgramMetadataCache(() => {
    changingReads += 1;

    return [];
});
assert.notEqual(changingCache.get(changingProgram), changingCache.get(changingProgram));
assert.deepEqual([tagReads, changingReads], [6, 2]);

const source = [
    'import defaultValue, { value as local } from "./first.js";',
    'import * as api from "./second.js";',
    'export { value } from "./first.js";',
    'export * from "./third.js";',
    'export const own = () => local;'
].join('\n');
const program = Object.freeze(await captureProgram(source, { fileName: 'metadata.js' }));
assert.equal(getModuleSources.name, 'getModuleSources');
assert.equal(getImportBindings.name, 'getImportBindings');
assert.equal(getModuleSources.length, 0);
assert.equal(getImportBindings.length, 0);
clearContractGraphCaches();
const sources = getModuleSources(program);
const bindings = getImportBindings(program);
Object.freeze(sources);
Object.freeze(bindings);
assert.deepEqual(sources, ['./first.js', './second.js', './third.js']);
assert.deepEqual(bindings, [
    { kind: 'named', localName: 'defaultValue', importedName: 'default', source: './first.js' },
    { kind: 'named', localName: 'local', importedName: 'value', source: './first.js' },
    { kind: 'namespace', localName: 'api', importedName: '*', source: './second.js' }
]);
assert.equal(getModuleSources(program), sources);
assert.equal(getImportBindings(program), bindings);
assert.notEqual(sources, bindings);
const twin = Object.freeze(await captureProgram(source, { fileName: 'metadata.js' }));
assert.notEqual(getModuleSources(twin), sources);
assert.notEqual(getImportBindings(twin), bindings);
clearContractGraphCaches();
assert.notEqual(getModuleSources(program), sources);
assert.notEqual(getImportBindings(program), bindings);
assert.deepEqual(getModuleSources(program), sources);
assert.deepEqual(getImportBindings(program), bindings);

let sourceReads = 0;
const hostileImport = Object.freeze({
    type: 'ImportDeclaration',
    get source() {
        sourceReads += 1;

        if (sourceReads === 1) throw failure;

        return { value: './retry.js' };
    },
    specifiers: []
});
const hostileProgram = Object.freeze({ type: 'Program', body: Object.freeze([hostileImport]) });
assert.throws(() => getModuleSources(hostileProgram), error => error === failure);
const recoveredSources = getModuleSources(hostileProgram);
assert.deepEqual(recoveredSources, ['./retry.js']);
const completedReads = sourceReads;
assert.equal(getModuleSources(hostileProgram), recoveredSources);
assert.equal(sourceReads, completedReads);
assert.deepEqual(getImportBindings(hostileProgram), []);
assert.ok(sourceReads > completedReads);

let clearingReads = 0;
const clearingProgram = Object.freeze({
    type: 'ImportDeclaration',
    get source() {
        clearingReads += 1;
        clearContractGraphCaches();

        return { value: './clear.js' };
    },
    specifiers: []
});
const clearedDuringRead = getModuleSources(clearingProgram);
const completedClearingReads = clearingReads;
assert.deepEqual(clearedDuringRead, ['./clear.js']);
assert.equal(getModuleSources(clearingProgram), clearedDuringRead);
assert.equal(clearingReads, completedClearingReads);

let specifierReads = 0;
const retryBindingsProgram = Object.freeze({
    type: 'ImportDeclaration',
    source: Object.freeze({ value: './retry.js' }),
    get specifiers() {
        specifierReads += 1;

        if (specifierReads === 1) throw failure;

        return Object.freeze([Object.freeze({
            type: 'ImportDefaultSpecifier', local: Object.freeze({ name: 'retry' })
        })]);
    }
});
assert.throws(() => getImportBindings(retryBindingsProgram), error => error === failure);
const recoveredBindings = getImportBindings(retryBindingsProgram);
assert.deepEqual(recoveredBindings, [
    { kind: 'named', localName: 'retry', importedName: 'default', source: './retry.js' }
]);
const completedSpecifierReads = specifierReads;
assert.equal(getImportBindings(retryBindingsProgram), recoveredBindings);
assert.equal(specifierReads, completedSpecifierReads);

const sharedProgram = Object.freeze(await captureProgram('export const value = "";', { fileName: 'shared.js' }));
const graph = createContractGraph({ programs: { 'first.js': sharedProgram, 'second.js': sharedProgram } });
assert.notEqual(graph.getDocument('first.js'), graph.getDocument('second.js'));
assert.equal(graph.definitions['first.js'], graph.definitions['second.js']);
const sameGraph = createContractGraph({ programs: { 'first.js': sharedProgram, 'second.js': sharedProgram } });
assert.equal(sameGraph.definitions['first.js'], graph.definitions['first.js']);
assert.equal(sameGraph.getDocument('first.js'), graph.getDocument('first.js'));
clearContractGraphCaches();
const freshGraph = createContractGraph({ programs: { 'first.js': sharedProgram, 'second.js': sharedProgram } });
assert.notEqual(freshGraph.definitions['first.js'], graph.definitions['first.js']);
assert.notEqual(freshGraph.getDocument('first.js'), graph.getDocument('first.js'));
assert.deepEqual(freshGraph.getDiagnostics(), graph.getDiagnostics());
assert.deepEqual(freshGraph.getEvidence(), graph.getEvidence());

const consumer = Object.freeze(await captureProgram(
    'import { read } from "./provider.js"; export const load = () => read({});',
    { fileName: 'consumer.js' }
));
const makeProvider = async (code = '') => Object.freeze(await captureProgram(code, { fileName: 'provider.js' }));
const stringProvider = await makeProvider('export const read = ({ title = "" } = {}) => title;');
const arrayProvider = await makeProvider('export const read = ({ items = [] } = {}) => items;');
const makeVariantGraph = provider => createContractGraph({
    programs: { 'provider.js': provider, 'consumer.js': consumer }
});
const stringGraph = makeVariantGraph(stringProvider);
const arrayGraph = makeVariantGraph(arrayProvider);
assert.notEqual(arrayGraph.definitions['consumer.js'], stringGraph.definitions['consumer.js']);
assert.notEqual(arrayGraph.getDocument('consumer.js'), stringGraph.getDocument('consumer.js'));
assert.notDeepEqual(arrayGraph.moduleExports['consumer.js'], stringGraph.moduleExports['consumer.js']);
const repeatedStringGraph = makeVariantGraph(stringProvider);
assert.equal(repeatedStringGraph.definitions['consumer.js'], stringGraph.definitions['consumer.js']);
assert.equal(repeatedStringGraph.getDocument('consumer.js'), stringGraph.getDocument('consumer.js'));
assert.deepEqual(repeatedStringGraph.moduleExports, stringGraph.moduleExports);

clearContractGraphCaches();
