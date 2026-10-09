import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

import typescript from 'typescript';

import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { renderResolverPredicate } from '../transforms/typescript/grammar/resolver-predicates.js';
import { createResolverPolicy, getResolverRequirements } from '../transforms/typescript/policy/resolvers.js';
import { getObjectDiscriminator, getObjectShapeCheck, getTypeInfo, getRuntimeKind,
    getDeclarationMap } from '../transforms/typescript/understand/type-resolution.js';

const missing = () => { throw new Error('Missing resolver proof capability'); };
const { getUnionResolverSource = missing } = createResolverPolicy({
    getTypeInfo: ({ node = {} } = {}) => node, getRuntimeKind,
    getObjectDiscriminator: () => ({}), getObjectShapeCheck: () => ({})
});
const primitive = formatting => ({ kind: 'array', check: formatting });
const repeated = getUnionResolverSource({ parts: [primitive('Array.isArray(VALUE)'), primitive('Array . isArray ( VALUE )')] });
assert.equal(repeated.branches.length, 0, 'Equivalent semantic predicates cannot be distinguished by formatting.');
assert.equal(repeated.fallback.value, 'input');
const single = getUnionResolverSource({ parts: [primitive('this text is never inspected'), { kind: 'function', check: 'unrelated' }] });
assert.deepEqual(single.branches.map(({ predicate = {} } = {}) => getResolverRequirements(predicate)), [['array-content'], ['function']]);
assert.equal(renderResolverPredicate({ predicate: single.branches[0].predicate }), 'Array.isArray(input) && input.length');
assert.equal(renderResolverPredicate({ predicate: single.branches[0].predicate, standard: { array: true } }), 'hasArrayContent(input)');
assert.equal(renderResolverPredicate({ predicate: single.branches[1].predicate, standard: { function: true } }), 'isFunction(input)');
assert.throws(() => createResolverPolicy({}), /Missing resolver capability/u);

const sourceFile = typescript.createSourceFile('predicates.ts', [
    'type Empty = { tag: ""; payload: number };',
    'type Zero = { tag: 0; payload: number };',
    'type False = { tag: false; payload: number };',
    'type Left = { left: number };',
    'type Right = { right: number };'
].join('\n'), typescript.ScriptTarget.ESNext, true);
const declarations = getDeclarationMap({ typescript, sourceFile });
const { getUnionResolverSource: resolve = missing } = createResolverPolicy({
    getTypeInfo, getRuntimeKind, getObjectDiscriminator, getObjectShapeCheck
});
const parts = sourceFile.statements.map(({ type = {} } = {}) => type);
const union = resolve({ typescript, sourceFile, declarations, parts });
assert.equal(union.branches.length, 5);
assert.deepEqual(union.branches.slice(0, 3).map(({ predicate: { value = undefined } = {} } = {}) => value), ['', 0, false]);
const isObject = value => Object.prototype.toString.call(value) === '[object Object]';
const modelCheck = (property, input) => isObject(input) && property in input;
const evaluate = (predicate = {}, input = {}) => runInNewContext(renderResolverPredicate({ predicate, standard: { object: true } }), {
    input, isObject, modelCheck
});
union.branches.slice(0, 3).forEach(({ predicate = {} } = {}, index) => {
    const { value = undefined } = predicate;
    assert.equal(evaluate(predicate, { tag: value }), true);
    assert.equal(evaluate(predicate, { tag: 'different' }), false);
    assert.equal(evaluate(predicate, {}), false);
    assert.equal(union.branches[index].presence, 'discriminated');
});
const { branches: [, , , { predicate: left = {} } = {}] = [] } = union;
[false, 0, '', undefined].forEach(value => assert.equal(evaluate(left, { left: value }), true));
assert.equal(evaluate(left, {}), false);
assert.deepEqual(union.fallback, { kind: 'any', value: 'input', action: 'preserve', presence: 'unmatched', content: 'not-applicable' });

// Execute the public emitted resolver, including preserved unmatched identity.
const { transform = missing } = createTypeScriptTransformer({ typescript });
const { code: emitted = '' } = transform({ fileName: 'falsey.ts', code: [
    'type Off = { tag: false; value: number };',
    'type On = { tag: true; value: string };',
    'export const read = (input: Off | On) => input;'
].join('\n') });
const { outputText = '' } = typescript.transpileModule(emitted, {
    compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.CommonJS }
});
const published = {};
runInNewContext(outputText, { exports: published, isObject });
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
