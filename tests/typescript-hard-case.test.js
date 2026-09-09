import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import typescript from 'typescript';

import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

const fixtureFile = path.join(process.cwd(), 'tests/fixtures/typescript-hard-case.ts');
const source = await readFile(fixtureFile, 'utf8');
// eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Factory result preserves native container failure; absent methods must fail at their original invocation.
const { transform } = createTypeScriptTransformer({
    typescript,
    standard: { object: '../rules/support/object.js' }
});
const result = transform({ code: source, fileName: fixtureFile });

assert.deepEqual(result.diagnostics, []);
assert.doesNotMatch(result.code, /export const RenderProps =/);
assert.doesNotMatch(result.code, /export const RendererConfig =/);
assert.match(result.code, /mode = (?:''|"")/);
assert.match(result.code, /cache = false/);
assert.match(result.code, /retries = 0/);
assert.match(result.code, /children = \[\]/);
assert.match(result.code, /component = Button/);
assert.match(result.code, /export const resolveSanitySpan =/);
assert.match(result.code, /export function Renderer/);
assert.doesNotMatch(result.code, /Missing required agreement for value/);
assert.doesNotMatch(result.code, /component = \{\}/);
assert.match(result.code, /if \(!hasContent\(options\)\)/);
assert.match(result.code, /typeof component !== ["']function["']/);
assert.doesNotMatch(result.code, /namespace Sanity/);
assert.doesNotMatch(result.code, /var Sanity/);

const modernEcmaResult = transform({
    code: 'var legacy = 1; namespace Runtime { export const value = legacy; } export const read = () => Runtime.value;',
    fileName: 'modern-ecma.ts'
});

assert.equal(modernEcmaResult.diagnostics.some(({ kind = '' } = {}) => kind === 'UnsupportedDeclaration'), true);
assert.equal(modernEcmaResult.code, '');
[typescript.ScriptTarget.ESNext, typescript.ScriptTarget.ES2016].forEach((target) => {
    const { code: compilerOwnedCode = '', diagnostics: compilerOwnedDiagnostics = [] } = createTypeScriptTransformer({
        typescript, target
    }).transform({
        code: 'enum Choice { One = 1 } export const value = Choice.One;',
        fileName: 'compiler-owned-enum.ts'
    });

    assert.equal(compilerOwnedCode, '', `Compiler-created var must not succeed at target ${target}.`);
    assert.equal(compilerOwnedDiagnostics.some(({ kind = '' } = {}) => kind === 'UnsupportedDeclaration'), true);
});
assert.doesNotMatch(result.code, /interface Span/);
assert.doesNotMatch(result.code, /type Renderable/);

const tupleCarrierResult = transform({
    code: [
        'declare const tuple: [string | undefined];',
        'const [value] = tuple;',
        'export { value };',
        ''
    ].join('\n'),
    fileName: 'tuple-carrier.ts'
});

assert.deepEqual(tupleCarrierResult.diagnostics, []);
assert.match(tupleCarrierResult.code, /const \{ values: \[value/);
assert.match(tupleCarrierResult.code, /\} = \{ values: tuple \};/);

const arityCarrierSource = [
    'export function flow(first: Function, second?: Function) {',
    '    switch (arguments.length) {',
    '        case 2: return second(first);',
    '        default: return first;',
    '    }',
    '}',
    ''
].join('\n');
const arityCarrierFile = 'arity-carrier.ts';
const arityCarrierSourceFile = typescript.createSourceFile(
    arityCarrierFile, arityCarrierSource, typescript.ScriptTarget.ESNext, true
);
const arityCarrierOptions = { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true };
const arityCarrierHost = typescript.createCompilerHost(arityCarrierOptions);
const arityCarrierProgram = typescript.createProgram([arityCarrierFile], arityCarrierOptions, {
    ...arityCarrierHost,
    getSourceFile: (file, version, ...rest) => file === arityCarrierFile
        ? arityCarrierSourceFile
        : arityCarrierHost.getSourceFile(file, version, ...rest)
});
const arityCarrierResult = createTypeScriptTransformer({ typescript, program: arityCarrierProgram }).transform({
    code: arityCarrierSource,
    fileName: arityCarrierFile
});

assert.deepEqual(arityCarrierResult.diagnostics, []);
assert.match(arityCarrierResult.code, /export function flow\(first, second\)/);
assert.doesNotMatch(arityCarrierResult.code, /_resilientArgs|Object\.defineProperty\(flow/);

const residualHostResult = transform({
    code: [
        'type Payload = { value: string };',
        'declare const consume: (value: string) => string;',
        'export const render = (payload: Payload) => consume(payload.value);',
        ''
    ].join('\n'),
    fileName: 'residual-host.ts'
});

assert.deepEqual(residualHostResult.diagnostics, []);

const agreementResult = transform({
    code: 'export const read = value => { const { payload } = value; return payload; };',
    fileName: 'agreement.ts'
});
const { agreements = [] } = agreementResult;
const [payloadAgreement = {}] = agreements;

assert.deepEqual(agreementResult.diagnostics, []);
assert.deepEqual(payloadAgreement, {
    state: 'caller-owned',
    owner: 'caller',
    evidence: ['generic payload remains opaque; caller owns agreement'],
    canonical: '',
    name: 'payload',
    site: 'final-object-binding',
    sourceRange: '38:46',
    action: 'preserve'
});
assert.match(residualHostResult.code, /return consume\(payloadValue\);/);
assert.doesNotMatch(residualHostResult.code, /\(\(\{ value \}/);
