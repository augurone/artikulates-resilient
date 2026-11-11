import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

import typescript from 'typescript';

import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { renderResolverPredicate } from '../transforms/typescript/grammar/resolver-predicates.js';
import { createResolverPolicy } from '../transforms/typescript/policy/resolvers.js';
import { getObjectDiscriminator, getObjectShapeCheck, getTypeInfo, getRuntimeKind,
    getDeclarationMap } from '../transforms/typescript/understand/type-resolution.js';
import { loadModule } from './support/module.js';

const missing = () => { throw new Error('Missing resolver proof capability'); };
const nativeSource = 'export const read = (input: Date | number) => input;';
const nativeFile = typescript.createSourceFile('native-constructor.ts', nativeSource, typescript.ScriptTarget.ESNext, true);
const nativeOptions = { target: typescript.ScriptTarget.ESNext, strict: true };
const nativeHost = typescript.createCompilerHost(nativeOptions);
const nativeProgram = typescript.createProgram([nativeFile.fileName], nativeOptions, {
    ...nativeHost, getSourceFile: (name, version) => name === nativeFile.fileName ? nativeFile : nativeHost.getSourceFile(name, version)
});
const { code: nativeEmitted = '' } = createTypeScriptTransformer({ typescript, program: nativeProgram })
    .transform({ fileName: nativeFile.fileName, code: nativeSource });
const { outputText: nativeRuntime = '' } = typescript.transpileModule(nativeEmitted, {
    compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
});
const nativePublished = await loadModule(nativeRuntime);
const nativeValue = new Date(0);
const { resolveDateNumber = missing } = nativePublished;
assert.equal(resolveDateNumber(nativeValue).value, nativeValue);
assert.equal(resolveDateNumber(nativeValue).kind, 'object');
assert.equal(resolveDateNumber({ getTime: () => 0 }).kind, 'any', 'An authored look-alike cannot borrow constructor identity.');

const sourceFile = typescript.createSourceFile('predicates.ts', [
    'type BaseValue = { tag: ""; payload: number };',
    'type Zero = { tag: 0; payload: number };',
    'type False = { tag: false; payload: number };',
    'type Inbound = { inbound: number };',
    'type Outbound = { outbound: number };'
].join('\n'), typescript.ScriptTarget.ESNext, true);
const declarations = getDeclarationMap({ typescript, sourceFile });
const { getUnionResolverSource: resolve = missing } = createResolverPolicy({
    getTypeInfo, getRuntimeKind, getObjectDiscriminator, getObjectShapeCheck
});
const parts = sourceFile.statements.map(({ type = {} } = {}) => type);
const union = resolve({ typescript, sourceFile, declarations, parts });
assert.equal(union.branches.length, 2, 'A partial literal property does not partition the complete five-arm union.');
const partition = resolve({ typescript, sourceFile, declarations, parts: parts.slice(0, 3) });
assert.equal(partition.branches.length, 3);
// eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Literal payloads must distinguish false, zero, empty text and missing values.
assert.deepEqual(partition.branches.map(({ predicate: { value } = {} } = {}) => value), ['', 0, false]);
const isObject = value => Object.prototype.toString.call(value) === '[object Object]';
const modelCheck = (property, input) => isObject(input) && property in input;
const evaluate = (predicate = {}, input = {}) => runInNewContext(renderResolverPredicate({ predicate, standard: { object: true } }), {
    input, isObject, modelCheck
});
partition.branches.forEach(({ predicate = {} } = {}, index) => {
    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- The resolver receives the exact literal payload, including all falsey values.
    const { value } = predicate;
    assert.equal(evaluate(predicate, { tag: value }), true);
    assert.equal(evaluate(predicate, { tag: 'different' }), false);
    assert.equal(evaluate(predicate, {}), false);
    assert.equal(partition.branches[index].presence, 'discriminated');
});
const { branches: [{ predicate: inbound = {} } = {}] = [] } = union;
[false, 0, '', undefined].forEach(value => assert.equal(evaluate(inbound, { inbound: value }), true));
assert.equal(evaluate(inbound, {}), false);
assert.deepEqual(union.fallback, { kind: 'any', value: 'input', action: 'preserve', presence: 'unmatched', content: 'not-applicable' });

// Execute the public emitted resolver, including preserved unmatched identity.
const { transform = missing } = createTypeScriptTransformer({ typescript });
const { code: emitted = '' } = transform({ fileName: 'falsey.ts', code: [
    'type Off = { tag: false; value: number };',
    'type On = { tag: true; value: string };',
    'export const read = (input: Off | On) => input;'
].join('\n') });
const { outputText = '' } = typescript.transpileModule(emitted, {
    compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
});
const published = await loadModule(`const isObject = ${isObject};\n${outputText}`);
const { resolveOffOn = missing } = published;
assert.equal(resolveOffOn({ tag: false, value: 0 }).value.tag, false);
assert.equal(resolveOffOn({ tag: true, value: '' }).value.tag, true);
const unmatched = { tag: 'unknown' };
assert.equal(resolveOffOn(unmatched).value, unmatched);

const getAliasInfo = ({ code = '', name = '' } = {}) => {
    const file = typescript.createSourceFile('shortcuts.ts', code, typescript.ScriptTarget.ESNext, true);
    const declarations = getDeclarationMap({ typescript, sourceFile: file });
    const declaration = file.statements.find(({ name: { text = '' } = {} } = {}) => text === name) || {};
    const { type = {} } = declaration;

    return getTypeInfo({ typescript, node: type, sourceFile: file, declarations });
};

const declaredNaN = getAliasInfo({
    code: 'type NaN = undefined; type Missing = NaN; type Count = number | Missing;',
    name: 'Count'
});
assert.deepEqual(declaredNaN, {
    kind: 'number', family: 'number', canonical: '0', check: "typeof VALUE === 'number'", optional: true
});
const shadowedNaN = getAliasInfo({
    code: 'type NaN = string; type Count = number | NaN;',
    name: 'Count'
});
assert.equal(shadowedNaN.kind, 'union');
assert.equal(shadowedNaN.optional, false);
const unknownNaN = getAliasInfo({ code: 'type Count = number | NaN;', name: 'Count' });
assert.equal(unknownNaN.kind, 'union');
assert.equal(unknownNaN.optional, false);
assert.equal(unknownNaN.canonical, '');

const stringKey = getAliasInfo({ code: 'type Shape = { title: string }; type Key = keyof Shape;', name: 'Key' });
const numericKey = getAliasInfo({ code: 'type Shape = { 0: string }; type Key = keyof Shape;', name: 'Key' });
const symbolKey = getAliasInfo({ code: 'type Shape = { [key: symbol]: string }; type Key = keyof Shape;', name: 'Key' });
const mixedKey = getAliasInfo({ code: 'type Shape = { [key: string]: string }; type Key = keyof Shape;', name: 'Key' });
assert.deepEqual([stringKey.family, stringKey.canonical], ['string', "''"]);
assert.deepEqual([numericKey.family, numericKey.canonical], ['number', '0']);
assert.deepEqual([symbolKey.family, symbolKey.canonical, symbolKey.check], ['symbol', '', "typeof VALUE === 'symbol'"]);
assert.equal(mixedKey.kind, 'union');
assert.equal(renderResolverPredicate({ predicate: { kind: 'family', family: 'symbol' } }), "typeof input === 'symbol'");
