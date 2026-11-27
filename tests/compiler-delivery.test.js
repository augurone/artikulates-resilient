import assert, { deepStrictEqual, match, ok, strictEqual, throws, doesNotMatch } from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { Linter } from 'eslint';
import typescript from 'typescript';

import plugin from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { fixture } from './support/compiler-source.js';

// Real emitted raw/fixed code and completed public reports must preserve native values, arity, iteration and exact failure. Repeated private label fields are not an additional validation.

{
    const declaration = 'export function outer([value]: [number]) { const inner = (input: number) => [input]; const alias = inner; return alias(value); }';
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
            // eslint-disable-next-line resilient/no-undefined-assignment -- The native alias oracle retains the undefined element produced by empty tuple destructuring.
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
}

{
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
            // eslint-disable-next-line resilient/no-undefined-assignment -- The reported callable must preserve the native undefined tuple element in installed output.
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
}

{
    const objectStandard = import.meta.resolve('eslint-plugin-resilient/standard/object');

    const createProgram = (code, fileName) => {
        const compilerOptions = { strict: true, allowJs: true, maxNodeModuleJsDepth: 1, target: typescript.ScriptTarget.ESNext,
            module: typescript.ModuleKind.ESNext, moduleResolution: typescript.ModuleResolutionKind.Bundler };
        const sourceFile = typescript.createSourceFile(fileName, code, typescript.ScriptTarget.ESNext, true);
        const host = typescript.createCompilerHost(compilerOptions);
        const program = typescript.createProgram([fileName], compilerOptions, {
            ...host,
            getSourceFile: (name, version, ...rest) => name === fileName ? sourceFile : host.getSourceFile(name, version, ...rest)
        });
        const semanticDiagnostics = program.getSemanticDiagnostics().map(({ code = 0, messageText = '' } = {}) => ({
            code, message: typescript.flattenDiagnosticMessageText(messageText, '\n')
        }));
        assert.deepEqual(semanticDiagnostics, []);

        return program;
    };

    const rendererSource = [
        'import { hasContent } from "eslint-plugin-resilient/standard/object";',
        'type Config = { mode?: string; cache?: boolean; retries?: number; options?: { value: string } };',
        'type Props = Config & { value?: string; component?: (props: Record<string, unknown>) => unknown; children?: string[] };',
        'const Button = (props: Record<string, unknown>) => ({ component: "Button", ...props });',
        'export function Renderer({ value, mode, cache, retries, options, component = Button, children, ...rest }: Props = {}) {',
        '    if (!hasContent(options)) return {};',
        '    if (typeof component !== "function") return {};',
        '    return component({ ...rest, value, mode, cache, retries, options, children });',
        '}'
    ].join('\n');

    test('public compiler output: Renderer normalizes optional values without changing guards or component invocation', async () => {
        const { pathname: fileName = '' } = new URL('compiler-renderer.ts', import.meta.url);
        const program = createProgram(rendererSource, fileName);
        const { code = '', diagnostics = [] } = createTypeScriptTransformer({
            typescript, program, standard: { object: objectStandard }
        }).transform({ code: rendererSource, fileName });
        assert.deepEqual(diagnostics, []);
        const config = [plugin.configs.recommended, plugin.configs.contracts, plugin.configs.safety];
        const linter = new Linter();
        assert.deepEqual(linter.verify(code, config), []);
        const { output: fixed = '', messages = [] } = linter.verifyAndFix(code, config);
        assert.deepEqual(messages, []);
        const { outputText: native = '' } = typescript.transpileModule(rendererSource, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const artifactDirectory = new URL('../.artifacts/', import.meta.url);
        await mkdir(artifactDirectory, { recursive: true });
        const directory = await mkdtemp(new URL('compiler-output-', artifactDirectory));

        try {
            const modules = await Promise.all([native, code, fixed].map(async (code, index) => {
                const file = path.join(directory, `${index}.js`);
                await writeFile(file, code);

                return import(pathToFileURL(file).href);
            }));
            const [reference = {}] = modules;
            const options = { value: 'provided' };
            const children = ['child'];
            const failure = new Error('component failure');
            const run = ({ Renderer } = {}, supplied = {}) => {
                if (typeof Renderer !== 'function') throw new TypeError('Expected compiled callable exports');

                let calls = [];
                // eslint-disable-next-line no-restricted-syntax -- The component oracle records the actual invocation receiver; an arrow would capture the test receiver.
                const component = function render(props) {
                    calls = [...calls, { receiver: this, props }];

                    return props;
                };
                const result = Renderer({ value: 'ready', options, component, ...supplied });

                return { result, calls };
            };
            const supplied = { mode: 'published', cache: true, retries: 4, children, extra: 'forwarded' };
            const expected = run(reference, supplied);

            modules.forEach(({ Renderer } = {}) => {
                if (typeof Renderer !== 'function') throw new TypeError('Expected compiled callable exports');

                assert.deepEqual(run({ Renderer }, supplied), expected);
                const { result: { options: forwardedOptions = {}, children: forwardedChildren = [] } = {} } = run({ Renderer }, supplied);
                assert.equal(forwardedOptions, options);
                assert.equal(forwardedChildren, children);
                assert.deepEqual(Renderer(), {});
                assert.deepEqual(Renderer({ component: () => { throw failure; }, options: {} }), {});
                assert.deepEqual(Renderer({ value: 'ready', options, component: false }), {});
                assert.throws(() => Renderer({ value: 'ready', options, component: () => { throw failure; } }), error => error === failure);
                assert.deepEqual(Renderer({ value: 'ready', options, mode: 'preview', cache: false, retries: 0, children }), {
                    component: 'Button', value: 'ready', options, mode: 'preview', cache: false, retries: 0, children
                });
            });
            // Type-based defaults are intentional normalization, distinct from native
            // equivalence for fully supplied properties and invocation failure above.
            modules.slice(1).forEach((module) => {
                const { result = {}, calls = [] } = run(module);
                assert.deepEqual(result, { value: 'ready', mode: '', cache: false, retries: 0, options, children: [] });
                assert.equal(Reflect.get(calls.at(0), 'receiver'), undefined);
            });
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    test('public compiler output: unsupported runtime declarations fail closed at modern and downlevel targets', () => {
        const sources = [
            'var legacy = 1; namespace Runtime { export const value = legacy; } export const read = () => Runtime.value;',
            'enum Choice { One = 1 } export const value = Choice.One;'
        ];
        sources.forEach(code => [typescript.ScriptTarget.ESNext, typescript.ScriptTarget.ES2016].forEach((target) => {
            const { code: output = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, target }).transform({ code, fileName: 'unsupported.ts' });
            assert.equal(output, '');
            assert.ok(diagnostics.some(({ kind = '' } = {}) => kind === 'UnsupportedDeclaration'));
        }));
    });

    test('public compiler output: namespace union branches invoke their bound model dependencies', async () => {
        const source = [
            'namespace Sanity {',
            '    export interface Span { _type: "span"; text?: string; marks?: string[]; }',
            '    export type Image = { _type: "image"; asset: { _ref: string }; crop?: { top?: number } };',
            '    export type Block = Span | Image | { _type: "break" };',
            '}',
            'namespace Other { export interface Span { alternate?: number; } }',
            'type Renderable = Sanity.Block | Other.Span | string;',
            'export const renderValue = (value: Renderable) => value;'
        ].join('\n');
        const { pathname: fileName = '' } = new URL('compiler-namespace.ts', import.meta.url);
        createProgram(source, fileName);
        // Standalone source acquisition emits named models; the checker-backed
        // adapter may instead establish an object family and preserve its payload.
        const { code = '', diagnostics = [] } = createTypeScriptTransformer({
            typescript, standard: { object: objectStandard }
        }).transform({ code: source, fileName });
        assert.deepEqual(diagnostics, []);
        const config = [plugin.configs.recommended, plugin.configs.contracts, plugin.configs.safety];
        const linter = new Linter();
        assert.deepEqual(linter.verify(code, config), []);
        const { output: fixed = '', messages = [] } = linter.verifyAndFix(code, config);
        assert.deepEqual(messages, []);
        const { outputText: native = '' } = typescript.transpileModule(source, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const modules = await Promise.all([native, code, fixed].map(code => import(`data:text/javascript,${encodeURIComponent(code)}`)));
        const extra = { owner: 'caller' };
        const span = { _type: 'span', text: '', extra };
        const asset = { _ref: 'asset' };
        const image = { _type: 'image', asset, extra };
        const alternate = { alternate: 0, extra };
        modules.forEach(({ renderValue } = {}) => {
            if (typeof renderValue !== 'function') throw new TypeError('Expected compiled callable exports');

            return [span, image, alternate].forEach(value => assert.equal(renderValue(value), value));
        });
        // Only the explicit resolver normalizes models; plain authored functions
        // retain native identity. Falsey selected fields still prove membership.
        modules.slice(1).forEach(({ resolveRenderable } = {}) => {
            if (typeof resolveRenderable !== 'function') throw new TypeError('Expected compiled callable exports');

            assert.deepEqual(resolveRenderable(span), { kind: 'object', value: { ...span, marks: [] } });
            const { value: { asset: forwardedAsset = {}, extra: forwardedExtra = {} } = {} } = resolveRenderable(image);
            assert.equal(forwardedAsset, asset);
            assert.equal(forwardedExtra, extra);
            assert.deepEqual(resolveRenderable(image), { kind: 'object', value: { ...image, crop: {} } });
            assert.deepEqual(resolveRenderable(alternate), { kind: 'object', value: alternate });
            assert.deepEqual(resolveRenderable(''), { kind: 'string', value: '' });
            const unmatched = {};
            const { kind = '', value = false } = resolveRenderable(unmatched);
            assert.equal(kind, 'any');
            assert.equal(value, unmatched);
        });
    });
}
