import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { createTypeScriptAnalysis } from 'eslint-plugin-resilient/analyzer/typescript';

import { createSourceCensus } from '../transforms/typescript/understand/source-census.js';
import { collectSourceEvidence } from '../transforms/typescript/understand/source-report.js';
import { fixture } from './support/compiler-source.js';

const source = 'declare function use(cb:(pair:[number])=>string):void;use(([value])=>"actual");';
const prepare = () => {
    const input = fixture(source);
    const { program = {} } = input;

    return { ...input, checker: program.getTypeChecker(), sourceAnalysis: createTypeScriptAnalysis(input) };
};

test('compiler report: contextual requirements reject equal-span foreign trees before reading the checker', () => {
    const input = prepare();
    const { sourceFile = {} } = fixture(source);
    const failure = new Error('checker should not run');
    const checker = { getTypeAtLocation() { throw failure; }, isTupleType: () => true };

    throws(() => collectSourceEvidence({ ...input, sourceFile, checker }), /source identity mismatch/u);
    collectSourceEvidence(input);
    throws(() => collectSourceEvidence({ ...input, sourceFile, checker }), /source identity mismatch/u);
});

test('compiler report: requirement failures remain operational and a retry uses the original source', () => {
    const input = prepare();
    const failure = new Error('checker failure');
    const checker = { getTypeAtLocation() { throw failure; }, isTupleType: () => true };

    throws(() => collectSourceEvidence({ ...input, checker }), error => error === failure);
    const report = collectSourceEvidence(input);
    const { source: reportSource = false } = report;
    const { sourceAnalysis: { source: owned = false } = {} } = input;

    deepStrictEqual(collectSourceEvidence(input), report);
    strictEqual(reportSource, owned);
});

test('compiler acquisition: a supplied census must belong to the original tree', () => {
    const input = fixture(source);
    const foreign = fixture(source);
    const census = createSourceCensus(foreign);

    throws(() => createTypeScriptAnalysis({ ...input, census }), /census source identity mismatch/u);
    const owned = createTypeScriptAnalysis({ ...input, census: createSourceCensus(input) });
    const independent = createTypeScriptAnalysis(input);
    const { functions: ownedFunctions = [] } = owned;
    const { functions: independentFunctions = [] } = independent;

    deepStrictEqual(ownedFunctions, independentFunctions);
    deepStrictEqual(owned.checkFunction({ index: 1 }), independent.checkFunction({ index: 1 }));
});
