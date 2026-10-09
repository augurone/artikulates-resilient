import assert from 'node:assert/strict';
import fs from 'node:fs';

import typescript from 'typescript';

import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { createShapeProvider } from '../transforms/typescript/understand/shape.js';
import { createSourceCensus, collectBindingReferences } from '../transforms/typescript/understand/source-census.js';
import * as evidence from '../transforms/typescript/understand/type-evidence.js';
import { getTypeInfo } from '../transforms/typescript/understand/type-resolution.js';

const missing = () => { throw new Error('Missing census proof capability'); };
const fileName = 'census.ts';
const parse = (code = '') => typescript.createSourceFile(fileName, code, typescript.ScriptTarget.ESNext, true);
const createProgram = (code = '') => {
    const sourceFile = parse(code);
    const options = { strict: true, target: typescript.ScriptTarget.ESNext };
    const host = typescript.createCompilerHost(options);
    const program = typescript.createProgram([fileName], options, {
        ...host, getSourceFile: (name, version) => name === fileName ? sourceFile : host.getSourceFile(name, version)
    });

    return { program, sourceFile, checker: program.getTypeChecker() };
};
const code = [
    'type Alias = { value: number };',
    'export function read(value: Alias) { return value.value; }',
    'export function collect(values: number[]) { const result: number[] = []; for (const value of values) result.push(value); return result; }',
    'export function forward({ run }: { run: () => number }) { return { run }; }',
    'export const tuple = (pairs: [number, number][]) => pairs.map(([a, b]) => [a, b]);',
    'export function shadow(value: number) { return (value: string) => value; }'
].join('\n');
const source = createProgram(code);
const { program = {}, sourceFile = {} } = source;
let roots = 0;
const compiler = { ...typescript, forEachChild: (node, visit) => {
    if (node === sourceFile) roots += 1;

    return typescript.forEachChild(node, visit);
} };
const census = createSourceCensus({ typescript: compiler, sourceFile });
assert.equal(roots, 1);
const { SyntaxKind: { Identifier = -1, CallExpression = -1, FunctionDeclaration = -1 } = {} } = typescript;
const candidates = census.select(CallExpression, FunctionDeclaration);
assert.ok(candidates.length > 3);
assert.ok(candidates.every(({ pos = 0 } = {}, index) => {
    const [{ pos: previousPosition = 0 } = {}] = candidates.slice(Math.max(0, index - 1), index);

    return !index || pos >= previousPosition;
}));
const [first = {}] = candidates;
assert.equal(census.ancestors(first).at(-1), sourceFile);
const references = collectBindingReferences({ typescript: compiler, ...source, census });
assert.ok(references.size > 0);
const collectors = Object.entries(evidence).filter(([name = '']) => /^collect.*Contracts$/u.test(name));
assert.ok(collectors.length >= 45);
collectors.forEach(([, collect = missing]) => {
    collect({ typescript: compiler, ...source, census, bindingReferences: references });
});
assert.equal(roots, 1, 'Domain admission can walk local syntax, but cannot restart source discovery.');
const publicTransformer = createTypeScriptTransformer({ typescript: compiler, program });
const { transform = missing } = publicTransformer;
roots = 0;
const output = transform({ code: 'ignored because the Program owns this file', fileName });
assert.equal(roots, 1, 'One semantic census owns the entire public transform.');
assert.match(output.code, /export function read/u);
assert.doesNotMatch(output.code, /ignored because/u);

const censusFailure = new Error('census construction');
const failingCompiler = { ...typescript,
    forEachChild: (node, visit) => {
        if (node !== sourceFile) throw censusFailure;

        return typescript.forEachChild(node, visit);
    } };
assert.throws(() => createSourceCensus({ sourceFile, typescript: failingCompiler }), error => error === censusFailure);
const retried = createSourceCensus({ typescript, sourceFile });
assert.deepEqual(retried.select(CallExpression), census.select(CallExpression));

// Identical filenames do not share either candidates or symbol identity.
const other = createProgram('export const read = (value: string) => value;');
const otherCensus = createSourceCensus({ typescript, sourceFile: other.sourceFile });
const otherReferences = collectBindingReferences({ typescript, ...other, census: otherCensus });
assert.notEqual(census.sourceFile, otherCensus.sourceFile);
assert.ok([...references.keys()].filter(Boolean).every(symbol => !otherReferences.has(symbol)));
const { analyze: analyzeOther = missing } = createTypeScriptTransformer({ typescript, program: other.program });
assert.equal(analyzeOther({ code, fileName }).contracts[0].kind, 'string');
assert.ok(census.select(Identifier).every(node => node.getSourceFile() === sourceFile));

// All semantic parameter owners are retained. Buffering ordinary AST nodes as
// functions previously happened because the shape default was always an array.
const parameterSource = parse([
    'function declaration(a: string) {}',
    'const expression = function(b: string) {};',
    'const arrow = (c: string) => c;',
    'class C { constructor(d: string) {} method(e: string) {} set value(f: string) {} get value(): string { return ""; } }',
    'interface I { method(g: string): void; (h: string): void; new (i: string): C; }',
    'type F = (j: string) => void;',
    'type K = new (k: string) => C;',
    'interface Indexed { [l: string]: number; }'
].join('\n'));
const shapeCapabilities = {
    getProgramDeclarationMap: () => ({}), getDeclarationMap: () => ({}),
    getUnsupportedTypeDiagnostics: () => [], getRuntimeReferences: () => new Set(),
    getRuntimeNames: () => new Set(), getRuntimeGuardKinds: () => new Set(),
    getTypeInfo: () => ({}), getTypeText: () => '', hasRuntimeDeclaration: () => false
};
assert.throws(() => createShapeProvider({ typescript }), /Missing TypeScript compiler agreement/u);
const { createAnalysis = missing } = createShapeProvider({
    ...shapeCapabilities,
    typescript, program: { getSourceFile: () => parameterSource },
    getTypeInfo: () => ({ kind: 'string' }), getTypeText: ({ node = {} } = {}) => node.getText(parameterSource)
});
assert.deepEqual(createAnalysis().contracts.map(({ parameter = '' } = {}) => parameter), 'abcdefghijkl'.split(''));

// Private recursion survives reentry, frozen declaration views, and failure then
// success. The old hidden key is neither consulted nor installed.
const declarations = Object.freeze({});
const reference = { kind: typescript.SyntaxKind.TypeReference,
    typeName: { kind: Identifier, text: 'Active' }, getText: () => 'Active' };
const failure = new Error('checker failure');
let fail = true;
let queries = 0;
const recursiveChecker = { getTypeAtLocation: () => {
    queries += 1;
    assert.equal(getTypeInfo({ typescript, node: { ...reference }, checker: recursiveChecker, declarations }).kind, 'unknown');

    if (fail) throw failure;

    return { flags: typescript.TypeFlags.String };
} };
assert.throws(() => getTypeInfo({ typescript, node: reference, checker: recursiveChecker, declarations }), error => error === failure);
fail = false;
assert.equal(getTypeInfo({ typescript, node: reference, checker: recursiveChecker, declarations }).kind, 'string');
assert.equal(queries, 2);
assert.deepEqual(Reflect.ownKeys(declarations), []);
const poisoned = Object.freeze({ get __resolutionKeys() { throw failure; } });
assert.equal(getTypeInfo({ typescript, node: reference, declarations: poisoned,
    checker: { getTypeAtLocation: () => ({ flags: typescript.TypeFlags.Number }) } }).kind, 'number');

// Unsupported diagnostics retain later construction failure ownership. An early
// diagnostic return would swallow this exact compiler failure.
const factoryFailure = new Error('resolver factory after diagnostic');
const unsupported = 'type External = import("missing").Value; function choose(value: string | number) { return value; }';
const diagnosticCompiler = { ...typescript, factory: { ...typescript.factory,
    createParameterDeclaration: () => { throw factoryFailure; } } };
const { analyze: diagnose = missing, transform: failTransform = missing } = createTypeScriptTransformer({ typescript: diagnosticCompiler });
assert.ok(diagnose({ code: unsupported, fileName }).diagnostics.length);
assert.throws(() => failTransform({ code: unsupported, fileName }), error => error === factoryFailure);

const authored = fs.readFileSync(new URL('../transforms/typescript/understand/type-evidence.js', import.meta.url), 'utf8');
assert.doesNotMatch(authored, /(?:visit|gather|collectReference|collectBindings)\(sourceFile\)/u);
