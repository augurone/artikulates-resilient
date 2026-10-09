import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { Linter } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

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
    const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
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
        const run = ({ Renderer = false } = {}, supplied = {}) => {
            let calls = [];
            const component = function render(props) {
                calls = [...calls, { receiver: this, props }];

                return props;
            };
            const result = Renderer({ value: 'ready', options, component, ...supplied });

            return { result, calls };
        };
        const supplied = { mode: 'published', cache: true, retries: 4, children, extra: 'forwarded' };
        const expected = run(reference, supplied);

        modules.forEach(({ Renderer = false } = {}) => {
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
    const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
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
    modules.forEach(({ renderValue = false } = {}) => [span, image, alternate].forEach(value => assert.equal(renderValue(value), value)));
    // Only the explicit resolver normalizes models; plain authored functions
    // retain native identity. Falsey selected fields still prove membership.
    modules.slice(1).forEach(({ resolveRenderable = false } = {}) => {
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
