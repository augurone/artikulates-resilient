import assert from 'node:assert/strict';

import { getDiagnosticIndex, getEvidenceIndex } from '../rules/contracts/document-index.js';
import { clearContractCaches, clearProjectGraphCache } from '../rules/contracts/eslint-graph.js';

const first = Object.freeze({ id: 'same', ruleId: 'first' });
const last = Object.freeze({ id: 'same', ruleId: 'second' });
const unique = Object.freeze({ id: 'unique', ruleId: 'first' });
const records = Object.freeze([first, unique, last]);
let evidenceReads = 0;
let diagnosticReads = 0;
const document = Object.freeze({
    getEvidence: () => {
        evidenceReads += 1;

        return records;
    },
    getDiagnostics: () => {
        diagnosticReads += 1;

        return records;
    }
});

const evidence = getEvidenceIndex(document);
const diagnostics = getDiagnosticIndex(document);
assert.equal(evidence.records, records);
assert.equal(diagnostics.diagnostics, records);
assert.equal(evidence.byId.get('same'), last);
assert.deepEqual([...evidence.byId.keys()], ['same', 'unique']);
assert.deepEqual(Object.keys(diagnostics.byRule), ['first', 'second']);
assert.deepEqual(diagnostics.byRule.first, [first, unique]);
assert.equal(diagnostics.byRule.first[0], first);
assert.equal(Object.getPrototypeOf(diagnostics.byRule), Object.prototype);
assert.equal(getEvidenceIndex(document), evidence);
assert.equal(getDiagnosticIndex(document), diagnostics);
assert.deepEqual([evidenceReads, diagnosticReads], [1, 1]);
assert.notEqual(evidence, diagnostics);
const otherDocument = Object.freeze({ getEvidence: () => records, getDiagnostics: () => records });
assert.notEqual(getEvidenceIndex(otherDocument), evidence);
assert.notEqual(getDiagnosticIndex(otherDocument), diagnostics);

const indexedRecords = Object.freeze([Object.freeze({ ruleId: 'indexed' })]);
let publicDiagnosticReads = 0;
let indexedDiagnosticReads = 0;
const indexedDocument = Object.freeze({
    getDiagnostics: () => {
        publicDiagnosticReads += 1;

        return records;
    },
    getDiagnosticsForIndex: () => {
        indexedDiagnosticReads += 1;

        return indexedRecords;
    }
});
assert.equal(getDiagnosticIndex(indexedDocument).diagnostics, indexedRecords);
assert.deepEqual([publicDiagnosticReads, indexedDiagnosticReads], [0, 1]);

clearProjectGraphCache();
assert.equal(getEvidenceIndex(document), evidence);
assert.equal(getDiagnosticIndex(document), diagnostics);
clearContractCaches();
assert.equal(getEvidenceIndex(document), evidence);
assert.equal(getDiagnosticIndex(document), diagnostics);
assert.deepEqual([evidenceReads, diagnosticReads], [1, 1]);

let order = [];
const detachedDocument = Object.freeze({
    get getEvidence() {
        order = [...order, 'get-evidence'];

        return function readEvidence() {
            assert.equal(this, undefined);
            order = [...order, 'call-evidence'];

            return records;
        };
    },
    get getDiagnostics() {
        order = [...order, 'get-diagnostics'];

        return function readDiagnostics() {
            assert.equal(this, undefined);
            order = [...order, 'call-diagnostics'];

            return records;
        };
    }
});
getEvidenceIndex(detachedDocument);
getDiagnosticIndex(detachedDocument);
getEvidenceIndex(detachedDocument);
getDiagnosticIndex(detachedDocument);
assert.deepEqual(order, ['get-evidence', 'call-evidence', 'get-diagnostics', 'call-diagnostics']);

const failure = new Error('reader failure');
let attempts = 0;
const retryDocument = {
    getEvidence: () => {
        attempts += 1;

        if (attempts === 1) throw failure;

        return records;
    }
};
assert.throws(() => getEvidenceIndex(retryDocument), error => error === failure);
assert.equal(getEvidenceIndex(retryDocument).records, records);
assert.equal(getEvidenceIndex(retryDocument).records, records);
assert.equal(attempts, 2);

let reentrantReads = 0;
let nestedIndex = {};
const reentrantDocument = { getEvidence: () => {
    reentrantReads += 1;

    if (reentrantReads === 1) nestedIndex = getEvidenceIndex(reentrantDocument);

    return records;
} };
const outerIndex = getEvidenceIndex(reentrantDocument);
assert.notEqual(outerIndex, nestedIndex);
assert.equal(getEvidenceIndex(reentrantDocument), outerIndex);
assert.equal(reentrantReads, 2);

let malformedAttempts = 0;
const malformedDocument = { getDiagnostics: () => {
    malformedAttempts += 1;

    return [null];
} };
assert.throws(() => getDiagnosticIndex(malformedDocument), TypeError);
assert.throws(() => getDiagnosticIndex(malformedDocument), TypeError);
assert.equal(malformedAttempts, 2);
assert.throws(() => getEvidenceIndex({ getEvidence: 1 }), TypeError);
assert.throws(() => getDiagnosticIndex({ getDiagnostics: 1 }), TypeError);
assert.throws(() => getEvidenceIndex('invalid weak key'), TypeError);
assert.throws(() => getDiagnosticIndex('invalid weak key'), TypeError);
assert.deepEqual(getEvidenceIndex({}).records, []);
assert.deepEqual(getDiagnosticIndex({}).diagnostics, []);
assert.notEqual(getEvidenceIndex(), getEvidenceIndex());
assert.notEqual(getDiagnosticIndex(), getDiagnosticIndex());

// eslint-disable-next-line no-sparse-arrays -- A hostile document reader returns a sparse array to prove evidence Map failure versus diagnostic hole skipping.
const sparse = Object.freeze([, first]);
assert.throws(() => getEvidenceIndex({ getEvidence: () => sparse }), TypeError);
assert.deepEqual(getDiagnosticIndex({ getDiagnostics: () => sparse }).byRule.first, [first]);
assert.throws(() => getDiagnosticIndex({ getDiagnostics: () => [{ ruleId: '__proto__' }] }), TypeError);
assert.throws(() => getDiagnosticIndex({ getDiagnostics: () => [{ ruleId: 'constructor' }] }), TypeError);

const symbol = Symbol('identity');
const symbolicRecord = Object.freeze({ id: symbol, ruleId: symbol });
const symbolicDocument = Object.freeze({ getEvidence: () => [symbolicRecord], getDiagnostics: () => [symbolicRecord] });
assert.equal(getEvidenceIndex(symbolicDocument).byId.get(symbol), symbolicRecord);
assert.deepEqual(getDiagnosticIndex(symbolicDocument).byRule[symbol], [symbolicRecord]);

let coercions = 0;
const key = { [Symbol.toPrimitive]: () => {
    coercions += 1;

    return 'coerced';
} };
const keyedDiagnostic = Object.freeze({ ruleId: key });
assert.deepEqual(getDiagnosticIndex({ getDiagnostics: () => [keyedDiagnostic] }).byRule.coerced, [keyedDiagnostic]);
assert.equal(coercions, 2);

[4000, 8000, 12000].forEach((count) => {
    const largeRecords = Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze({
        id: `large-${index}`,
        ruleId: index % 2 ? 'odd' : 'even'
    })));
    const largeDocument = Object.freeze({ getDiagnostics: () => largeRecords });
    const { diagnostics: indexed = [], byRule = {} } = getDiagnosticIndex(largeDocument);
    const { even = [], odd = [] } = byRule;
    const { 0: first = {}, 1: second = {}, [count - 2]: penultimate = {}, [count - 1]: last = {} } = largeRecords;
    const { 0: firstEven = {}, [even.length - 1]: lastEven = {} } = even;
    const { 0: firstOdd = {}, [odd.length - 1]: lastOdd = {} } = odd;

    assert.equal(indexed, largeRecords);
    assert.equal(even.length + odd.length, count);
    assert.equal(firstEven, first);
    assert.equal(firstOdd, second);
    assert.equal(lastEven, penultimate);
    assert.equal(lastOdd, last);
});

export { records };
