import assert from 'node:assert/strict';

import typescript from 'typescript';

import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { createShapeProvider } from '../transforms/typescript/understand/shape.js';
import { createSourceCensus } from '../transforms/typescript/understand/source-census.js';
import {
    collectConsumerBindingContracts, getTupleParameterContract
} from '../transforms/typescript/understand/type-evidence.js';
import { getDeclarationMap } from '../transforms/typescript/understand/type-resolution.js';

const parse = (fileName = 'input.ts', code = '') => typescript.createSourceFile(fileName, code, typescript.ScriptTarget.ESNext, true);
const files = Array.from({ length: 32 }, (_, index) => parse(`index-${index}.ts`,
    `type Value = ${index % 2 ? 'string' : 'number'}; export function read(value: Value) { return value; }`));
let enumerations = 0;
const program = {
    getSourceFiles: () => {
        enumerations += 1;

        return files;
    },
    getSourceFile: name => files.find(({ fileName = '' } = {}) => fileName === name)
};
const transformer = createTypeScriptTransformer({ typescript, program });
assert.equal(enumerations, 0, 'Construction preserves lazy Program enumeration.');
files.forEach(({ fileName = '' } = {}, index) => {
    const analysis = transformer.analyze({ fileName });

    const { contracts: [{ kind = '' } = {}] = [] } = analysis;

    assert.equal(kind, index % 2 ? 'string' : 'number', 'Each file retains its local overlay.');
});
const [{ fileName: firstFileName = '' } = {}] = files;
const transformed = transformer.transform({ fileName: firstFileName });
assert.equal(enumerations, 1, '32 analyses and one transformation share one Program index.');
assert.deepEqual(transformed, createTypeScriptTransformer({ typescript, program }).transform({ fileName: firstFileName }));
assert.equal(enumerations, 2, 'A separate transformer owns a separate index even for the same Program.');
const otherFile = parse(firstFileName, 'type Value = boolean; export function read(value: Value) { return value; }');
const other = createTypeScriptTransformer({ typescript, program: { getSourceFiles: () => [otherFile], getSourceFile: () => otherFile } });
assert.equal(other.analyze({ fileName: firstFileName }).contracts[0].kind, 'boolean');
const standalone = createTypeScriptTransformer({ typescript });
assert.equal(standalone.analyze({ code: 'function read(value: number) {}' }).contracts[0].kind, 'number');
assert.equal(standalone.analyze({ code: 'function read(value: string) {}' }).contracts[0].kind, 'string');

// Failure leaves the lazy index uninitialized; successful analyses publish a
// fresh overlay rather than exposing or annotating the shared Program map.
const failure = new Error('Program declaration construction');
const programMap = Object.freeze(getDeclarationMap({ typescript, sourceFile: files.at(-1) }));
let attempts = 0;
const missing = () => { throw new Error('Missing analysis index proof capability'); };
const checkerMarker = {};
const { createAnalysis = missing } = createShapeProvider({
    typescript, program: { ...program, getTypeChecker: () => checkerMarker },
    getProgramDeclarationMap: () => {
        attempts += 1;

        if (attempts === 1) throw failure;

        return programMap;
    },
    getDeclarationMap,
    getUnsupportedTypeDiagnostics: () => [], getRuntimeReferences: () => new Set(),
    getRuntimeNames: () => new Set(), getRuntimeGuardKinds: () => new Set(),
    getTypeInfo: () => ({}), getTypeText: () => '', hasRuntimeDeclaration: () => false
});
assert.throws(() => createAnalysis({ fileName: firstFileName }), error => error === failure);
const first = createAnalysis({ fileName: firstFileName });
const second = createAnalysis({ fileName: firstFileName });
assert.equal(attempts, 2);
assert.notEqual(first.declarations, second.declarations);
assert.equal(first.declarations.Value, getDeclarationMap({ typescript, sourceFile: files[0] }).Value);
assert.notEqual(first.declarations.Value, programMap.Value);
assert.equal(first.declarations.__checker, checkerMarker);
assert.deepEqual(Reflect.ownKeys(programMap), ['Value']);

const code = [
    'declare function map(callback: (value: [number]) => number[]): number[][];',
    'function declared(value: number) { return [value]; }',
    'const arrow = (value: number) => [value];',
    'const expression = function(value: number) { return [value]; };',
    ...Array.from({ length: 50 }, (_, index) => (
        `export const mapped${index} = map(([value]) => ${['declared', 'arrow', 'expression'][index % 3]}(value));`
    ))
].join('\n');
const sourceFile = parse('tuples.ts', code);
const options = { noLib: true, strict: true, target: typescript.ScriptTarget.ESNext };
const host = typescript.createCompilerHost(options);
const tupleProgram = typescript.createProgram([sourceFile.fileName], options, {
    ...host, getSourceFile: (name, version) => name === sourceFile.fileName ? sourceFile : host.getSourceFile(name, version)
});
const checker = tupleProgram.getTypeChecker();
const census = createSourceCensus({ typescript, sourceFile });
const input = { typescript, sourceFile, checker, census };
const collected = collectConsumerBindingContracts(input);
assert.equal(collected.size, 50, 'Each tuple callback owns one native preservation decision.');
const callbacks = census.select(typescript.SyntaxKind.ArrowFunction).filter(({ parameters = [] } = {}) => (
    parameters.some(({ name: { kind = 0 } = {} } = {}) => kind === typescript.SyntaxKind.ArrayBindingPattern)
));
const individual = new Map(callbacks.map((node) => {
    const contract = getTupleParameterContract({ ...input, node });
    const { action = '', key = '' } = contract;

    assert.equal(action, 'preserve-native-tuple');
    assert.equal(Object.hasOwn(contract, 'resolver'), false);

    return [key, contract];
}));
assert.deepEqual(collected, individual);
assert.deepEqual(collectConsumerBindingContracts(input), collected);
const failureChecker = { ...checker, getTypeAtLocation() { throw failure; } };
assert.throws(() => collectConsumerBindingContracts({ ...input, checker: failureChecker }), error => error === failure);
assert.deepEqual(collectConsumerBindingContracts(input), collected);
