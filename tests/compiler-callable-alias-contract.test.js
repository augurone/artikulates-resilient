import { deepStrictEqual, match, ok, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';

import plugin from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { fixture } from './support/compiler-source.js';

const declaration = 'export function outer([value]: [number]) { function inner(input: number) { return [input]; } const alias = inner; return alias(value); }';
const config = [plugin.configs.recommended, plugin.configs.contracts, plugin.configs.safety];

[true, false].forEach(withProgram => test(`compiler callable alias: existing report receives completed shared evidence, Program ${withProgram}`, () => {
    const source = `${declaration} outer(['wrong']); outer(external);`;
    const { typescript = {}, program = {}, filename = '' } = fixture(source);
    const { code = '', diagnostics = [], agreements = [] } = createTypeScriptTransformer({ typescript, ...(withProgram ? { program } : {}) })
        .transform({ code: source, fileName: filename });
    const { runtimeEvidence = {} } = agreements.find(({ action = '' } = {}) => action === 'preserve-native-tuple') ?? {};
    const { status = '', result: { fact: { families = [] } = {} } = {}, calls = [], descriptor: { requirement: { family = '', provenance = '' } = {} } = {} } = runtimeEvidence;

    deepStrictEqual(diagnostics, []);
    strictEqual(status, 'contradiction');
    strictEqual(family, 'number');
    strictEqual(provenance, 'tuple-annotation');
    deepStrictEqual(families, ['array']);
    deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['contradiction', 'unknown']);
    ok(Object.isFrozen(runtimeEvidence));
    match(code, /const alias = inner;/u);
    match(code, /return alias\(value\)/u);
}));

test('compiler callable alias: raw, existing output and fixed output preserve native values, iteration and failure', async () => {
    const { typescript = {}, program = {}, filename = '' } = fixture(declaration);
    const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({ code: declaration, fileName: filename });
    const { outputText: raw = '' } = typescript.transpileModule(declaration, { compilerOptions: { target: 99, module: 99 } });
    const { output: fixed = '', messages = [] } = new Linter().verifyAndFix(code, config);

    deepStrictEqual(diagnostics, []);
    deepStrictEqual(messages, []);
    const versions = await Promise.all([raw, code, fixed].map(code => import(`data:text/javascript,${encodeURIComponent(code)}`)));

    versions.forEach(({ outer = false } = {}) => {
        if (typeof outer !== 'function') throw new TypeError('Missing outer export');

        strictEqual(outer.length, 1);
        strictEqual(Object.hasOwn(outer, 'prototype'), true);
        deepStrictEqual(outer([3]), [3]);
        deepStrictEqual(outer([0]), [0]);
        deepStrictEqual(outer([]), [undefined]);
        strictEqual(Object.hasOwn(outer([]), 0), true);
        throws(() => outer(), TypeError);
        throws(() => outer(undefined), TypeError);
        throws(() => outer(null), TypeError);
        const identity = {};

        strictEqual(outer([identity]).at(0), identity);
        let events = [];
        const iterator = {
            next() {
                events = [...events, ['next', this === iterator]];

                return { value: 7, done: false };
            },
            return() {
                events = [...events, ['close', this === iterator]];

                return { done: true };
            }
        };
        const iterable = { [Symbol.iterator]() {
            events = [...events, ['iterator', this === iterable]];

            return iterator;
        } };

        deepStrictEqual(outer(iterable), [7]);
        deepStrictEqual(events, [['iterator', true], ['next', true], ['close', true]]);
        const failure = new Error('iterator getter failed');
        const throwing = { get [Symbol.iterator]() { throw failure; } };

        throws(() => outer(throwing), error => error === failure);
    });
});

test('compiler callable alias: an opaque earlier operation still blocks later invocation evidence', () => {
    const source = `${declaration} outer(['wrong']); outer(external); outer([3]);`;
    const { typescript = {}, program = {}, filename = '' } = fixture(source);
    const { agreements = [] } = createTypeScriptTransformer({ typescript, program }).transform({ code: source, fileName: filename });
    const { runtimeEvidence: { calls = [] } = {} } = agreements.find(({ action = '' } = {}) => action === 'preserve-native-tuple') ?? {};

    deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['contradiction', 'unknown', 'unknown']);
});
