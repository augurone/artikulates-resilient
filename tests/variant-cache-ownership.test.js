import assert from 'node:assert/strict';

import { loadInternalModule } from './internal-module.js';
import { areReferenceMapsEqual } from '../rules/contracts/reference-variants.js';

const owner = await loadInternalModule({ file: 'rules/contracts/module-graph.js', exports: [
    'getCachedDefinitions', 'getCachedRuleDefinitions', 'getCachedDocument', 'getCachedModuleExportEntries'
] });
const {
    clearContractGraphCaches = undefined,
    getCachedDefinitions = undefined,
    getCachedRuleDefinitions = undefined,
    getCachedDocument = undefined,
    getCachedModuleExportEntries = undefined
} = owner;
const first = Object.freeze({ id: 'first' });
const second = Object.freeze({ id: 'second' });
assert.equal(areReferenceMapsEqual({ value: first }, { value: first }), true);
assert.equal(areReferenceMapsEqual({ value: first }, { value: second }), false);
assert.equal(areReferenceMapsEqual({ value: NaN }, { value: NaN }), true);
assert.equal(areReferenceMapsEqual({ value: -0 }, { value: 0 }), false);
assert.equal(areReferenceMapsEqual({ a: undefined }, { b: undefined }), true);
assert.equal(areReferenceMapsEqual({ [Symbol('first')]: first }, { [Symbol('second')]: second }), true);
assert.equal(areReferenceMapsEqual({ value: first }, Object.create({ value: first })), false);
let comparisonReads = [];
assert.equal(areReferenceMapsEqual({ get value() {
    comparisonReads = [...comparisonReads, 'left'];

    return first;
} }, { get value() {
    comparisonReads = [...comparisonReads, 'right'];

    return first;
} }), true);
assert.deepEqual(comparisonReads, ['left', 'right']);

const variants = [
    { name: 'definitions', read: getCachedDefinitions },
    { name: 'definitions', read: getCachedRuleDefinitions },
    { name: 'documents', read: getCachedDocument }
];
variants.forEach(({ read = undefined, name = '' } = {}) => {
    if (typeof read !== 'function') throw new TypeError('Variant proof requires its actual cache reader.');

    clearContractGraphCaches();
    const program = Object.freeze({ type: 'Program', body: Object.freeze([]) });
    let active = first;
    const mutableReferenceMap = Object.freeze({ get value() { return active; } });
    const initial = read({ program, fileName: 'same.js', externalDefinitions: mutableReferenceMap });
    assert.equal(read({ program, fileName: 'same.js', externalDefinitions: { value: first } }), initial, name);
    active = second;
    assert.equal(read({ program, fileName: 'same.js', externalDefinitions: { value: second } }), initial, name);
    const later = read({ program, fileName: 'same.js', externalDefinitions: { value: first } });
    assert.notEqual(later, initial, name);
    active = first;
    assert.equal(read({ program, fileName: 'same.js', externalDefinitions: { value: first } }), initial, name);
    const otherFile = read({ program, fileName: 'other.js', externalDefinitions: { value: first } });
    assert.equal(otherFile === initial, name === 'definitions');
    clearContractGraphCaches();
    assert.notEqual(read({ program, fileName: 'same.js', externalDefinitions: { value: first } }), initial, name);
    [null, false, 0, [], () => ({})].forEach((invalidProgram) => {
        assert.notEqual(read({ program: invalidProgram }), read({ program: invalidProgram }));
    });

    const failure = new Error(`${name} build failure`);
    let throwing = true;
    let typeReads = 0;
    const failingProgram = Object.freeze({
        get type() {
            typeReads += 1;

            if (throwing) throw failure;

            return 'Program';
        },
        body: Object.freeze([])
    });
    assert.throws(() => read({ program: failingProgram }), error => error === failure);
    assert.throws(() => read({ program: failingProgram }), error => error === failure);
    assert.equal(typeReads, 2);
    throwing = false;
    const recovered = read({ program: failingProgram });
    const completedReads = typeReads;
    assert.equal(read({ program: failingProgram }), recovered);
    assert.equal(typeReads, completedReads);

    clearContractGraphCaches();
    const queryProgram = Object.freeze({ type: 'Program', body: Object.freeze([]) });
    const cached = read({ program: queryProgram, fileName: 'same.js', externalDefinitions: { value: first } });
    let queryReads = 0;
    const throwingQuery = Object.freeze({ get value() {
        queryReads += 1;

        throw failure;
    } });
    assert.throws(() => read({ program: queryProgram, fileName: 'same.js', externalDefinitions: throwingQuery }), error => error === failure);
    assert.equal(queryReads, 1);
    assert.equal(read({ program: queryProgram, fileName: 'same.js', externalDefinitions: { value: first } }), cached);

    clearContractGraphCaches();
    let entered = false;
    let nested = {};
    const outerQuery = Object.freeze({ value: first });
    const innerQuery = Object.freeze({ value: second });
    const reentrantProgram = Object.freeze({
        get type() {
            if (!entered) {
                entered = true;
                nested = read({ program: reentrantProgram, externalDefinitions: innerQuery });
            }

            return 'Program';
        },
        body: Object.freeze([])
    });
    const outer = read({ program: reentrantProgram, externalDefinitions: outerQuery });
    assert.equal(read({ program: reentrantProgram, externalDefinitions: outerQuery }), outer);
    assert.notEqual(read({ program: reentrantProgram, externalDefinitions: innerQuery }), nested);

    clearContractGraphCaches();
    let clearDuringRead = false;
    const clearingProgram = Object.freeze({
        get type() {
            if (clearDuringRead) {
                clearDuringRead = false;
                clearContractGraphCaches();
            }

            return 'Program';
        },
        body: Object.freeze([])
    });
    const prior = read({ program: clearingProgram, externalDefinitions: outerQuery });
    clearDuringRead = true;
    const afterClear = read({ program: clearingProgram, externalDefinitions: innerQuery });
    assert.equal(read({ program: clearingProgram, externalDefinitions: innerQuery }), afterClear);
    assert.equal(read({ program: clearingProgram, externalDefinitions: outerQuery }), prior);
});

// Retained passive ASTs must not keep every historical ESLint environment.
// Whole-project API variants preserve their existing independent lifecycle.
const boundedProgram = Object.freeze({ type: 'Program', body: Object.freeze([]) });
const environments = Array.from({ length: 8 }, (_, id) => Object.freeze({ value: Object.freeze({ id }) }));
const publicVariants = environments.map(externalDefinitions => getCachedDefinitions({ program: boundedProgram, externalDefinitions }));
const ruleVariants = environments.map(externalDefinitions => getCachedRuleDefinitions({ program: boundedProgram, externalDefinitions }));
assert.equal(getCachedDefinitions({ program: boundedProgram, externalDefinitions: environments[0] }), publicVariants[0]);
assert.notEqual(getCachedRuleDefinitions({ program: boundedProgram, externalDefinitions: environments[0] }), ruleVariants[0]);
assert.equal(getCachedRuleDefinitions({ program: boundedProgram, externalDefinitions: environments[6] }), ruleVariants[6]);

clearContractGraphCaches();
const fileProgram = Object.freeze({ type: 'Program', body: Object.freeze([]) });
const firstFileDocument = getCachedDocument({ program: fileProgram, fileName: 'first.js', externalDefinitions: { value: first } });
let wrongFileQueryReads = 0;
const wrongFileQuery = Object.freeze({ get value() {
    wrongFileQueryReads += 1;

    return first;
} });
const otherFileDocument = getCachedDocument({ program: fileProgram, fileName: 'other.js', externalDefinitions: wrongFileQuery });
assert.notEqual(otherFileDocument, firstFileDocument);
// The mismatched filename skips comparison; the subsequent build reads once.
assert.equal(wrongFileQueryReads, 1);

const definitions = Object.freeze({});
const otherDefinitions = Object.freeze({});
clearContractGraphCaches();
const exportProgram = Object.freeze({ type: 'Program', body: Object.freeze([]) });
const exportEntries = getCachedModuleExportEntries({ program: exportProgram, definitions });
assert.equal(getCachedModuleExportEntries({ program: exportProgram, definitions }), exportEntries);
assert.notEqual(getCachedModuleExportEntries({ program: exportProgram, definitions: otherDefinitions }), exportEntries);
[null, [], () => ({})].forEach((invalidDefinitions) => {
    assert.notEqual(
        getCachedModuleExportEntries({ program: exportProgram, definitions: invalidDefinitions }),
        getCachedModuleExportEntries({ program: exportProgram, definitions: invalidDefinitions })
    );
});
clearContractGraphCaches();
assert.notEqual(getCachedModuleExportEntries({ program: exportProgram, definitions }), exportEntries);

let exportEntered = false;
let nestedExport = {};
const reentrantExportProgram = Object.freeze({
    get type() {
        if (!exportEntered) {
            exportEntered = true;
            nestedExport = getCachedModuleExportEntries({ program: reentrantExportProgram, definitions: otherDefinitions });
        }

        return 'Program';
    },
    body: Object.freeze([])
});
const outerExport = getCachedModuleExportEntries({ program: reentrantExportProgram, definitions });
assert.equal(getCachedModuleExportEntries({ program: reentrantExportProgram, definitions }), outerExport);
assert.notEqual(getCachedModuleExportEntries({ program: reentrantExportProgram, definitions: otherDefinitions }), nestedExport);

clearContractGraphCaches();
const anchorDefinitions = Object.freeze({});
let nestedPhase = '';
let existingNested = {};
const existingExportProgram = Object.freeze({
    get type() {
        if (nestedPhase === 'nested') {
            nestedPhase = '';
            existingNested = getCachedModuleExportEntries({ program: existingExportProgram, definitions: otherDefinitions });
        }

        if (nestedPhase === 'clear') {
            nestedPhase = '';
            clearContractGraphCaches();
        }

        return 'Program';
    },
    body: Object.freeze([])
});
const anchorExport = getCachedModuleExportEntries({ program: existingExportProgram, definitions: anchorDefinitions });
nestedPhase = 'nested';
getCachedModuleExportEntries({ program: existingExportProgram, definitions });
assert.equal(getCachedModuleExportEntries({ program: existingExportProgram, definitions: otherDefinitions }), existingNested);
nestedPhase = 'clear';
getCachedModuleExportEntries({ program: existingExportProgram, definitions: Object.freeze({}) });
assert.equal(getCachedModuleExportEntries({ program: existingExportProgram, definitions: anchorDefinitions }), anchorExport);

const exportFailure = new Error('export build failure');
let exportThrowing = true;
let exportReads = 0;
const failingExportProgram = Object.freeze({
    get type() {
        exportReads += 1;

        if (exportThrowing) throw exportFailure;

        return 'Program';
    },
    body: Object.freeze([])
});
assert.throws(() => getCachedModuleExportEntries({ program: failingExportProgram, definitions }), error => error === exportFailure);
assert.throws(() => getCachedModuleExportEntries({ program: failingExportProgram, definitions }), error => error === exportFailure);
assert.equal(exportReads, 2);
exportThrowing = false;
const recoveredExport = getCachedModuleExportEntries({ program: failingExportProgram, definitions });
const completedExportReads = exportReads;
assert.equal(getCachedModuleExportEntries({ program: failingExportProgram, definitions }), recoveredExport);
assert.equal(exportReads, completedExportReads);
clearContractGraphCaches();
