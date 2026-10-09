import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

import { ESLint } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { getContractRelation, getRelationState, relateContracts } from '../transforms/policy/contract.js';
import { lowerFinalGrammar } from '../transforms/typescript/grammar/final.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { hasGuardFor } from '../transforms/typescript/policy/guards.js';
import { compilePlacementDecisions } from '../transforms/typescript/policy/placement.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import { collectPlacementEvidence } from '../transforms/typescript/understand/placement-evidence.js';
import { collectCollectionReconstructionContracts, collectIndexedOperationContracts } from '../transforms/typescript/understand/type-evidence.js';
import { collectTypeDeclarationBindings, getDeclarationMap, getNativeUtilityName, getTypeInfo, getTypeMembers } from '../transforms/typescript/understand/type-resolution.js';

const parse = code => typescript.createSourceFile('independence.ts', code, typescript.ScriptTarget.ESNext, true);

[
    [{ source: { kind: 'unknown' }, target: { kind: 'string' } }, 'unknown'],
    [{ source: { kind: 'number' }, target: { kind: 'string' } }, 'contradiction'],
    [{ source: { kind: 'string' }, target: { kind: 'string' } }, 'agreement'],
    [{ source: { kind: 'object' }, target: { kind: 'object' }, sourceKeys: ['x'], targetKeys: ['y'] }, 'contradiction']
].forEach(([options = {}, state = ''] = []) => {
    assert.equal(getContractRelation(options), state);
    assert.equal(relateContracts(options), state === 'unknown' ? undefined : state === 'agreement');
});
[undefined, null, 0, 1, '', 'unknown', {}, []].forEach(value => assert.equal(getRelationState(value), 'unknown'));
assert.equal(getRelationState(true), 'agreement');
assert.equal(getRelationState(false), 'contradiction');
const analyze = (code) => {
    const sourceFile = parse(code);
    const { fileName = '' } = sourceFile;
    const options = { strict: true, target: typescript.ScriptTarget.ESNext };
    const host = typescript.createCompilerHost(options);
    const program = typescript.createProgram([fileName], options, {
        ...host, getSourceFile: (name, version) => name === fileName ? sourceFile : host.getSourceFile(name, version)
    });
    const checker = program.getTypeChecker();
    const declarations = getDeclarationMap({ typescript, sourceFile });
    Object.defineProperty(declarations, '__checker', { value: checker });
    collectTypeDeclarationBindings({ typescript, sourceFile, declarations, checker });

    return { sourceFile, checker, program, declarations };
};
const typeNodes = sourceFile => sourceFile.statements.filter(typescript.isTypeAliasDeclaration).map(({ type = {} } = {}) => type);
const native = analyze('type Source={datum:number}; type Selected=Partial<Source>; type Filtered=Extract<string|number,string>;');
const [, selected = {}, filtered = {}] = typeNodes(native.sourceFile);
assert.equal(getNativeUtilityName({ typescript, ...native, node: selected }), 'Partial');
assert.equal(getNativeUtilityName({ typescript, ...native, node: filtered }), 'Extract');
assert.equal(getTypeInfo({ typescript, ...native, node: filtered }).kind, 'string');
const synthetic = typescript.factory.createTypeReferenceNode('Partial', [typescript.factory.createKeywordTypeNode(typescript.SyntaxKind.StringKeyword)]);
assert.equal(getNativeUtilityName({ typescript, node: synthetic }), '', 'Generated spelling has no native binding.');

const names = ['Partial', 'Readonly', 'Required', 'Pick', 'Omit', 'Record', 'Exclude', 'Extract', 'NonNullable', 'Function'];
names.forEach((name) => {
    const sourceFile = parse(`type ${name}<T,K=never> = number; type Selected=${name}<string>;`);
    const declarations = getDeclarationMap({ typescript, sourceFile });
    const [, node = {}] = typeNodes(sourceFile);

    assert.equal(getNativeUtilityName({ typescript, node, declarations }), '', name);
    assert.equal(getTypeInfo({ typescript, sourceFile, node, declarations }).kind, 'number', name);
});
const imported = parse('import type { Partial } from "./authored.js"; type Selected=Partial<string>;');
const [importedType = {}] = typeNodes(imported);
assert.equal(getNativeUtilityName({ typescript, node: importedType }), '', 'Unresolved imports cannot bind native utilities.');
const parameterShadow = parse('type Wrapper<Partial> = Partial;');
const [parameterType = {}] = typeNodes(parameterShadow);
assert.equal(getNativeUtilityName({ typescript, node: parameterType }), '', 'Type parameters shadow native utilities.');
const local = analyze('export {}; type Partial<T>={marker:boolean}; type Selected=Partial<{datum:number}>;');
const [, localSelected = {}] = typeNodes(local.sourceFile);
assert.equal(getNativeUtilityName({ typescript, ...local, node: localSelected }), '');
assert.deepEqual(getTypeMembers({ typescript, ...local, node: localSelected }).map(({ name: { text = '' } = {} } = {}) => text), ['marker']);
const scopes = analyze('export {}; type Pick<T,K> = string; function read() { type Pick<T,K> = number; type Selected=Pick<string,never>; return 1; }');
const { sourceFile: scopesSource = {} } = scopes;
const { statements: [, , { body: { statements: [, { type: scoped = {} } = {}] = [] } = {} } = {}] = [] } = scopesSource;
assert.equal(getTypeInfo({ typescript, ...scopes, node: scoped }).kind, 'number', 'Checker identity separates identical spellings.');
const uncertain = parse('type Choice=Extract<{datum:number}|{note:string},{datum:number}>;');
const [uncertainType = {}] = typeNodes(uncertain);
assert.equal(getTypeInfo({ typescript, sourceFile: uncertain, node: uncertainType }).kind, 'unknown',
    'Unchecked object families do not prove structural subtype relations.');

const genericRelation = analyze('type Filter<T>=Extract<{datum:T},{datum:string}>;');
const { sourceFile: genericSource = {} } = genericRelation;
const [genericType = {}] = typeNodes(genericSource);
assert.equal(getTypeInfo({ typescript, ...genericRelation, node: genericType }).kind, 'unknown',
    'An unresolved checker conditional is not a disproved structural relation.');

const presence = analyze('function read(value:unknown) { if(typeof value==="function") return value; return 0; }');
const shadow = analyze('function read(value:unknown) { const nested=(value:unknown)=>typeof value==="function"; return nested(0); }');
[presence, shadow].forEach((input, index) => {
    const { sourceFile: { statements: [owner = {}] = [] } = {}, checker = {} } = input;
    const { parameters: [{ name: binding = {} } = {}] = [], body = {} } = owner;
    const facts = collectPlacementEvidence({ typescript, ...input });
    const decisions = compilePlacementDecisions({ typescript, evidence: facts });

    assert.equal(hasGuardFor({ typescript, node: body, binding, checker }), index === 0);
    assert.equal(decisions.observedBindings.has(binding), index === 0);
});
const unknownHelpers = ['accept', 'inspect'];
unknownHelpers.forEach((helper) => {
    const source = `const read=(value:any)=>{if(!${helper}(value))return {};return value;};`;
    const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript }).transform({ code: source });
    const failure = new Error('predicate failure');
    const execute = (text, fail = false) => runInNewContext(`${text}\nread();`, {
        [helper]: (value) => {
            assert.equal(value, undefined, 'Unresolved helper names cannot fabricate a source argument.');

            if (fail) throw failure;

            return true;
        }
    });

    assert.deepEqual(diagnostics, []);
    assert.equal(execute(code), execute(typescript.transpileModule(source, {}).outputText));
    assert.throws(() => execute(code, true), error => error === failure);
});

const optionalSource = 'const read=(value?:any)=>{const later=()=>typeof value==="object";return value;};';
const { code: optionalCode = '' } = createTypeScriptTransformer({ typescript }).transform({ code: optionalSource });
assert.equal(runInNewContext(`${optionalCode} read();`), undefined,
    'A presence observation cannot grant a default to an optional unknown parameter.');

// Literal shape supplies no immutable-builder privilege. Keep the source seed,
// sparse positions, native methods, receiver, alias and iterator failure phase.
const source = 'const build=(value:number)=>{const result=[,1];const alias=result;result.push(value);return {same:alias===result,result};};';
const literal = analyze(source);
const { program: literalProgram = {} } = literal;
const renamedLiteral = analyze(source.replaceAll('result', 'basket').replaceAll('alias', 'other'));
const literalFacts = collectCollectionReconstructionContracts({ typescript, ...literal });
assert.ok(literalFacts.size > 0, 'Native literal operations are recorded at their original source calls.');
const renamedLiteralFacts = collectCollectionReconstructionContracts({ typescript, ...renamedLiteral });
const snapshot = value => JSON.stringify(value, (key, item) => item instanceof Map || item instanceof Set ? [...item] : item);
assert.equal(snapshot(literalFacts), snapshot(renamedLiteralFacts), 'Equal-width builder/alias renames preserve all source operation facts.');
assert.equal(snapshot(compileDestructuringDecisions(collectDestructuringAgreements({ collectionReconstructionContracts: literalFacts }))),
    snapshot(compileDestructuringDecisions(collectDestructuringAgreements({ collectionReconstructionContracts: renamedLiteralFacts }))),
    'Completed decisions preserve the same source ownership under renames.');
const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program: literalProgram })
    .transform({ code: source, fileName: 'independence.ts' });
assert.deepEqual(diagnostics, []);
assert.match(code, /result\.push\(value\)/);
const lint = new ESLint({ overrideConfigFile: true, fix: true, overrideConfig: [resilient.configs.recommended] });
const [fixed = {}] = await lint.lintText(code, { filePath: 'literal-generated.js' });
const observe = text => runInNewContext(`${text}\n
    Object.defineProperty(Array.prototype, Symbol.iterator, {get(){throw new Error('iterator acquired');}});
    const output=build(2);
    JSON.stringify({same:output.same,length:output.result.length,hole:0 in output.result,one:output.result[1],two:output.result[2]});`);
const { outputText: nativeCode = '' } = typescript.transpileModule(source, { compilerOptions: { target: typescript.ScriptTarget.ESNext } });
assert.equal(observe(code), observe(nativeCode));
assert.equal(observe(fixed.output || code), observe(nativeCode));

const mutationLint = new ESLint({ overrideConfigFile: true, fix: true, overrideConfig: [{
    plugins: { resilient }, rules: { 'resilient/prefer-safe-transformations': 'error' }
}] });
const memberSource = [
    'declare function compute():number; const fill=()=>{const result:{datum?:number;marker?:number}={};',
    'const alias=result;result.datum=compute();result.marker=1;return [alias===result,Object.hasOwn(result,"datum")];};'
].join('');
const memberInput = analyze(memberSource);
const memberFacts = collectIndexedOperationContracts({ typescript, ...memberInput });
assert.ok([...memberFacts.values()].some(({ action = '' } = {}) => action === 'retain-indexed-update'),
    'Literal member writes remain original source operations.');
const renamedMember = analyze(memberSource.replaceAll('result', 'basket').replaceAll('datum', 'entry').replaceAll('marker', 'signal'));
assert.equal(snapshot(memberFacts), snapshot(collectIndexedOperationContracts({ typescript, ...renamedMember })),
    'Equal-width literal receiver and property renames preserve the complete source operation facts.');
const { code: memberCode = '' } = createTypeScriptTransformer({ typescript, program: memberInput.program })
    .transform({ code: memberSource, fileName: 'independence.ts' });
const [memberFixed = {}] = await mutationLint.lintText(memberCode, { filePath: 'member-generated.js' });
assert.equal(memberFixed.errorCount, 0, 'Each retained literal property write has an exact mutation boundary.');
const observeMember = text => runInNewContext(`${text}\n
    const trace=[];
    const compute=()=>{trace.push('rhs');return 2;};
    Object.defineProperty(Object.prototype,'datum',{set(value){trace.push(['setter',value]);}});
    JSON.stringify([fill(),trace]);`);
const { outputText: memberNative = '' } = typescript.transpileModule(memberSource, {
    compilerOptions: { target: typescript.ScriptTarget.ESNext }
});
assert.equal(observeMember(memberCode), observeMember(memberNative));
assert.equal(observeMember(memberFixed.output || memberCode), observeMember(memberNative));

const nestedSource = 'declare const actions:{reverse(input:number[]):number}; const build=()=>{const values:number[]=[];values.push(actions.reverse([]));return values;};';
const nestedInput = analyze(nestedSource);
const { code: nestedCode = '' } = createTypeScriptTransformer({ typescript, program: nestedInput.program })
    .transform({ code: nestedSource, fileName: 'independence.ts' });
const [nestedLint = {}] = await mutationLint.lintText(nestedCode, { filePath: 'nested-generated.js' });
assert.equal(nestedLint.errorCount, 1, 'An outer native mutation boundary cannot suppress an unowned argument mutation.');
assert.equal(nestedLint.messages[0].ruleId, 'resilient/prefer-safe-transformations');
assert.match(nestedLint.messages[0].message, /actions/u);

const returnedSource = 'const edit=(items:Map<number,unknown>,other:{splice:()=>number})=>{return items.set(0,other.splice());};';
const returnedInput = analyze(returnedSource);
const { code: returnedCode = '' } = createTypeScriptTransformer({ typescript, program: returnedInput.program })
    .transform({ code: returnedSource, fileName: 'independence.ts' });
const [returnedLint = {}] = await mutationLint.lintText(returnedCode, { filePath: 'returned-generated.js' });
assert.equal(returnedLint.errorCount, 1);
assert.match(returnedLint.messages[0].message, /other/u);
const { outputText: returnedNative = '' } = typescript.transpileModule(returnedSource, {
    compilerOptions: { target: typescript.ScriptTarget.ESNext }
});
const observeReturned = (text, phase) => runInNewContext(`${text}\n
    const trace=[];
    const failure={};
    const items=new Map();
    const other={get splice(){
        trace.push('argument-get');
        if(phase==='argument-get') throw failure;
        return function(){trace.push(['argument-call',this===other]);
            if(phase==='argument-call') throw failure;return 7;};
    }};
    Object.defineProperty(items,'set',{get(){
        trace.push('set-get');
        if(phase==='set-get') throw failure;
        if(phase==='noncallable') return 0;
        return function(key,value){trace.push(['set-call',this===items,key,value]);
            if(phase==='set-call') throw failure;return Map.prototype.set.call(this,key,value);};
    }});
    let output,caught;
    try{output=edit(items,other);}catch(error){caught=error;}
    JSON.stringify({trace,same:output===items,value:Map.prototype.get.call(items,0),
        exactFailure:caught===failure,errorName:caught && caught.name});`, { phase });
['success', 'set-get', 'argument-get', 'argument-call', 'set-call', 'noncallable'].forEach((phase) => {
    const expected = observeReturned(returnedNative, phase);
    assert.equal(observeReturned(returnedCode, phase), expected, phase);
    assert.equal(observeReturned(returnedLint.output || returnedCode, phase), expected, phase);
});
assert.deepEqual(JSON.parse(observeReturned(returnedNative, 'success')), {
    trace: ['set-get', 'argument-get', ['argument-call', true], ['set-call', true, 0, 7]],
    same: true, value: 7, exactFailure: false
});

const rhsSource = 'declare const actions:{reverse(input:number[]):number}; const build=()=>{const result:{datum?:number}={};result.datum=actions.reverse([]);return result;};';
const rhsInput = analyze(rhsSource);
const { code: rhsCode = '' } = createTypeScriptTransformer({ typescript, program: rhsInput.program })
    .transform({ code: rhsSource, fileName: 'independence.ts' });
const [rhsLint = {}] = await mutationLint.lintText(rhsCode, { filePath: 'rhs-generated.js' });
assert.equal(rhsLint.errorCount, 1, 'A property-write boundary ends before an unowned RHS mutation.');
assert.match(rhsLint.messages[0].message, /actions/u);

const tuple = parse('function read(input) { if(!isArray(input)||input.length<2){return [];} const [value]=input; return value; }');
const print = root => typescript.createPrinter().printFile(root);
const lower = (root) => {
    const { transformed: [output = root] = [], dispose = () => {} } = typescript.transform(root,
        [context => file => lowerFinalGrammar({ typescript, sourceFile: file, context })]);
    const result = print(output);
    dispose();

    return result;
};
assert.match(lower(tuple), /const \[value\] = input/, 'Unknown tuple facts remain unknown.');
assert.equal(lower(tuple).replaceAll('isArray', 'accept').replace(/\s+/gu, ''),
    lower(parse(print(tuple).replaceAll('isArray', 'accept'))).replace(/\s+/gu, ''));
