import { deepStrictEqual, doesNotMatch, match, ok, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';

import plugin from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { fixture } from './support/compiler-source.js';

const compile = (code, withProgram = true) => {
    const { typescript = {}, program = {}, filename = '' } = fixture(code);

    return createTypeScriptTransformer({ typescript, ...(withProgram ? { program } : {}) }).transform({ code, fileName: filename });
};
const entries = ({ sourceEvidence: { functions = [] } = {} } = {}) => functions;
const first = result => entries(result).at(0) ?? {};
const families = ({ result: { fact: { families = [] } = {} } = {} } = {}) => families;
const kinds = ({ requirements: { positions = [] } = {} } = {}) => positions.map(({ kind = '' } = {}) => kind);
const sources = [
    'export const read=([value]:[number])=>[value];',
    'export const read=function([value]:[number]){return [value];};',
    'export function read([value]:[number]){return [value];}'
];

[false, true].forEach(withProgram => sources.forEach((code, index) => test(`compiler report: callable ${index}, Program ${withProgram}`, async () => {
    const transformed = compile(code, withProgram);
    const { code: output = '', diagnostics = [], agreements = [], sourceEvidence = {} } = transformed;
    const entry = first(transformed);
    const { source = {}, functions = [] } = sourceEvidence;
    const { descriptor: { location: { source: owned = false } = {} } = {}, requirements = {}, runtimeEvidence: { source: runtimeSource = false } = {} } = entry;
    const { source: requiredSource = false, positions = [] } = requirements;

    strictEqual(functions.length, 1);
    strictEqual(source, owned);
    strictEqual(source, requiredSource);
    deepStrictEqual(kinds(entry), ['number']);
    deepStrictEqual(families(entry), ['array']);
    deepStrictEqual(diagnostics, []);
    strictEqual(agreements.length, withProgram || index === 2 ? 1 : 0);
    strictEqual(Object.hasOwn(entry, 'action'), false);
    ok(Object.isFrozen(sourceEvidence));
    ok(Object.isFrozen(functions));
    ok(Object.isFrozen(requirements));
    ok(Object.isFrozen(positions));
    strictEqual(runtimeSource, source);

    if (!withProgram && index < 2) doesNotMatch(output, /eslint-disable-next-line/u);

    if (withProgram || index === 2) match(output, /required tuple retains native missing-value failure/u);

    const { typescript = {}, program = {} } = fixture(code);
    const { outputText: raw = '' } = typescript.transpileModule(code, { compilerOptions: program.getCompilerOptions() });
    const { output: fixed = '' } = new Linter().verifyAndFix(output, [plugin.configs.recommended, plugin.configs.contracts, plugin.configs.safety]);
    const versions = await Promise.all([raw, output, fixed].map(source => import(`data:text/javascript,${encodeURIComponent(source)}`)));

    versions.forEach(({ read = false } = {}) => {
        if (typeof read !== 'function') throw new TypeError('Expected read export');

        deepStrictEqual(read([3]), [3]);
        deepStrictEqual(read([]), [undefined]);
        throws(() => read(), TypeError);
        throws(() => read(null), TypeError);
        const failure = new Error('iterator failure');

        throws(() => read({ get [Symbol.iterator]() { throw failure; } }), error => error === failure);
    });
})));

[false, true].forEach(withProgram => test(`compiler report: unrelated declarations do not activate evidence, Program ${withProgram}`, () => {
    const source = sources.at(0);
    const before = first(compile(source, withProgram));
    const after = first(compile(`${source}function unrelated([other]:[string]){return [other];}`, withProgram));
    const { result: { status: initialStatus = '' } = {} } = before;
    const { result: { status: finalStatus = '' } = {} } = after;

    deepStrictEqual(kinds(before), kinds(after));
    deepStrictEqual(families(before), families(after));
    strictEqual(initialStatus, finalStatus);
}));

[
    '([value])=>"actual"',
    'function([value]){return "actual";}'
].forEach((callback, index) => test(`compiler report: contextual callable ${index} keeps requirements separate from its result`, () => {
    const source = `declare function use(callback:(pair:[number])=>string):void;use(${callback});`;
    const entry = first(compile(source));
    const { requirements: { provenance = '', parameterIndex = -1 } = {} } = entry;

    strictEqual(provenance, 'contextual-signature');
    strictEqual(parameterIndex, 0);
    deepStrictEqual(kinds(entry), ['number']);
    deepStrictEqual(families(entry), ['string']);
    const standalone = first(compile(source, false));
    const { requirements: { state = '' } = {} } = standalone;

    strictEqual(state, 'unknown');
    deepStrictEqual(kinds(standalone), []);
    deepStrictEqual(families(standalone), ['string']);
}));

test('compiler report: contextual values do not initialize generic tuple input', () => {
    const source = 'declare function use(callback:(pair:[number])=>number):void;use(([value])=>value);';
    const entry = first(compile(source));
    const { result: { status = '' } = {} } = entry;

    deepStrictEqual(kinds(entry), ['number']);
    strictEqual(status, 'unknown');
    deepStrictEqual(families(entry), []);
});

test('compiler report: lexical callback identity separates identical binding names', () => {
    const source = 'declare function num(cb:(pair:[number])=>unknown):void;declare function text(cb:(pair:[string])=>unknown):void;'
        + 'num(([value])=>3);text(([value])=>"text");';
    const functions = entries(compile(source));

    deepStrictEqual(functions.map(kinds), [['number'], ['string']]);
    deepStrictEqual(functions.map(families), [['number'], ['string']]);
    const [{ descriptor: { index: first = -1 } = {} } = {}, { descriptor: { index: second = -1 } = {} } = {}] = functions;

    ok(first !== second);
});

test('compiler report: contextual reducer identity stays distinct from result families', () => {
    const source = 'declare function fold(cb:(acc:object,pair:[number])=>object):void;fold((acc,[value])=>acc);';
    const entry = first(compile(source));
    const { requirements: { parameterIndex = -1 } = {}, result: { returnedParameter: { index = -1 } = {} } = {} } = entry;
    const { result: { returnedParameter = true } = {} } = first(compile(source.replace('=>acc);', '=>({}));')));

    strictEqual(parameterIndex, 1);
    deepStrictEqual(kinds(entry), ['number']);
    strictEqual(index, 0);
    strictEqual(returnedParameter, false);
});

test('compiler report: known conflicts survive an unknown return', () => {
    const source = 'declare function use(cb:(pair:[boolean])=>unknown):void;use(([value])=>value?3:other?"text":external);';
    const entry = first(compile(source));
    const { result: { status = '', fact: { incomplete = false } = {} } = {} } = entry;

    strictEqual(status, 'contradiction');
    deepStrictEqual(families(entry), ['number', 'string']);
    strictEqual(incomplete, true);
});

test('compiler report: direct invocation reports survive without policy actions', () => {
    const result = compile('const read=([value]:[number])=>[value];const alias=read;alias(["wrong"]);alias(external);', false);
    const { agreements = [] } = result;
    const { runtimeEvidence: { status = '', calls = [] } = {} } = first(result);

    deepStrictEqual(agreements, []);
    strictEqual(status, 'contradiction');
    deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['contradiction', 'unknown']);
});

test('compiler report: unsupported execution does not remove contextual requirements', () => {
    const source = 'declare function use(cb:(pair:[number])=>number):void;use(([value]=[0])=>value);';
    const entry = first(compile(source));
    const { result: { status = '' } = {}, descriptor: { supported = true } = {} } = entry;

    deepStrictEqual(kinds(entry), ['number']);
    strictEqual(status, 'unknown');
    strictEqual(supported, false);
});

test('compiler report: changed requirements retain their own source revision', () => {
    const source = 'declare function use(cb:(pair:[number])=>string):void;use(([value])=>"actual");';
    const firstResult = compile(source);
    const revised = compile(source.replace('[number]', '[string]'));
    const before = first(firstResult);
    const after = first(revised);
    const { sourceEvidence: { source: originalSource = {} } = {} } = firstResult;
    const { sourceEvidence: { source: { digest: revisedDigest = '' } = {} } = {} } = revised;
    const { digest = '' } = originalSource;
    const { requirements: { source: requiredSource = false } = {} } = before;

    deepStrictEqual(kinds(before), ['number']);
    deepStrictEqual(kinds(after), ['string']);
    deepStrictEqual(families(before), families(after));
    ok(digest !== revisedDigest);
    strictEqual(requiredSource, originalSource);
});
