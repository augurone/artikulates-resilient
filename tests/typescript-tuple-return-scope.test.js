import assert from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';
import typescript from 'typescript';

import plugin from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

const standard = Object.fromEntries(['object', 'array', 'function'].map(name => (
    [name, import.meta.resolve(`eslint-plugin-resilient/standard/${name}`)]
)));
const compile = (code) => {
    const fileName = 'tuple-return-scope.ts';
    const options = { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext, strict: true };
    const sourceFile = typescript.createSourceFile(fileName, code, typescript.ScriptTarget.ESNext, true);
    const host = typescript.createCompilerHost(options);
    const program = typescript.createProgram([fileName], options, {
        ...host,
        getSourceFile: (name, version, ...rest) => name === fileName ? sourceFile : host.getSourceFile(name, version, ...rest)
    });
    const { code: output = '', diagnostics = [], agreements = [] } = createTypeScriptTransformer({ typescript, program, standard }).transform({ code, fileName });
    assert.deepEqual(program.getSemanticDiagnostics(), []);
    assert.deepEqual(diagnostics, []);
    const { outputText: raw = '' } = typescript.transpileModule(code, { compilerOptions: options });

    return { raw, output, agreements };
};
const linter = new Linter();
const fixed = code => linter.verifyAndFix(code, [plugin.configs.recommended, plugin.configs.contracts, plugin.configs.safety]).output;
const load = code => import(`data:text/javascript,${encodeURIComponent(code)}`);
const variants = [
    '',
    'function unrelated() { return 1; }',
    'const unrelated = () => 1;',
    'const unrelated = function () { return 1; };',
    'function unrelated() { function deeper() { return false; } return 1; }',
    'if (value) { function unrelated() { return 1; } }',
    'const unrelated = { read() { return 1; }, get result() { return false; }, set result(value: boolean) { return; } };',
    'class Unrelated { constructor() { return; } read() { return 1; } get result() { return false; } }'
];

const sources = [
    ...variants.map(nested => `export function outer([value]: [number]) { ${nested} return [value]; }`),
    'export function outer([value]: [number]) { function inner(input: number) { return [input]; } return inner(value); }',
    'export function outer([value]: [number]) { const result = [value]; function inner() { const result = 1; return result; } return result; }'
];
sources.forEach((code, index) => test(`tuple source ${index}: native values, absence and failure survive lowering`, async () => {
    const { raw = '', output = '', agreements = [] } = compile(code);
    assert.doesNotMatch(output, /hasArrayContent\(tuple\)/u);

    if ([2, 3, 5].includes(index) || index >= variants.length) {
        const { runtimeEvidence = {} } = agreements.find(({ action = '' } = {}) => action === 'preserve-native-tuple') ?? {};
        const { descriptor: { requirement: { family = '', provenance = '' } = {} } = {}, result: { fact: { families = [] } = {} } = {} } = runtimeEvidence;

        assert.equal(family, 'number');
        assert.equal(provenance, 'tuple-annotation');
        assert.deepEqual(families, ['array']);
        assert.match(output, /export function outer\(\[value\]\)/u);
        assert.deepEqual(linter.verify(fixed(output), [plugin.configs.recommended, plugin.configs.contracts, plugin.configs.safety])
            .map(({ ruleId = '' } = {}) => ruleId), index === variants.length ? [] : ['no-unused-vars']);
    }

    const versions = await Promise.all([raw, output, fixed(output)].map(load));
    versions.forEach(({ outer = false } = {}) => {
        if (typeof outer !== 'function') throw new TypeError('Missing transformed function export');

        assert.equal(outer.length, 1);
        assert.equal(Object.hasOwn(outer, 'prototype'), true);
        assert.deepEqual(outer([3]), [3]);
        assert.deepEqual(outer([]), [undefined]);
        assert.equal(Object.hasOwn(outer([]), 0), true);
        assert.throws(() => outer(), TypeError);
        assert.throws(() => outer(undefined), TypeError);
        assert.throws(() => outer(null), TypeError);
        let events = [];
        const iterable = {
            [Symbol.iterator]() {
                events = [...events, 'iterator'];

                return {
                    next() {
                        events = [...events, 'next'];

                        return { value: 7, done: false };
                    },
                    return() {
                        events = [...events, 'close'];

                        return { done: true };
                    }
                };
            }
        };
        assert.deepEqual(outer(iterable), [7]);
        assert.deepEqual(events, ['iterator', 'next', 'close']);
        const error = new Error('getter failed');
        const throwing = { get [Symbol.iterator]() { throw error; } };
        assert.throws(() => outer(throwing), candidate => candidate === error);
    });
}));

test('tuple parameter failure precedes the body', async () => {
    const { raw = '', output = '' } = compile('export function outer([value]: [number], effect: () => void) { effect(); return [value]; }');
    const versions = await Promise.all([raw, output, fixed(output)].map(load));
    versions.forEach(({ outer = false } = {}) => {
        if (typeof outer !== 'function') throw new TypeError('Missing transformed function export');

        let calls = 0;
        assert.throws(() => outer(null, () => { calls += 1; }), TypeError);
        assert.equal(calls, 0);
    });
});
