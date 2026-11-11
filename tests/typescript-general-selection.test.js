import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ESLint } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { isFunction } from 'eslint-plugin-resilient/standard/function';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { getObjectResolverGuardKinds, getObjectResolverDeclaration } from '../transforms/typescript/grammar/resolvers.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { annotateRetainedStaticMemberAccess } from '../transforms/typescript/policy/exceptions.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import {
    collectSelectedModelContracts, collectDeferredSelectedPayloadContracts,
    collectMutableSelectedLoopContracts, collectRepeatedParameterReadContracts, getSelectedModelPredicateFact, getVariantPartitions
} from '../transforms/typescript/understand/type-evidence.js';

const directory = await mkdtemp(path.join(tmpdir(), 'resilient-general-selection-'));
await writeFile(path.join(directory, 'package.json'), '{"type":"module"}\n');
const source = [
    'type Variant<A> = { note: "fixed"; kind: "Inbound"; inbound: A } | { note: "fixed"; kind: "Outbound"; outbound: A } | { note: "fixed"; kind: "Combined"; outbound: A };',
    'export const isInbound = <A>(value: Variant<A>, effect: () => void): value is Extract<Variant<A>, {kind:"Inbound"}> => { effect(); return value.kind === "Inbound"; };',
    'export const read = <A>(value: Variant<A>, effect: () => void): A => { if (isInbound(value, effect)) return value.inbound; return value.outbound; };',
    'export const later = (value: Variant<number>, combine: (a: number, b: number) => number) => {',
    'if (value.kind === "Inbound") return (n: number) => n; return (n: number) => combine(value.outbound, n); };',
    'type Step = {kind:"Inbound";inbound:number}|{kind:"Outbound";outbound:number}|{kind:"Combined";outbound:number};',
    'export const recur = (step: (n: number) => Step, start: number, combine: (a: number, b: number) => number) => {',
    '    let result = step(start); let acc = 0; let s: Step = result;',
    '    while (s.kind === "Inbound") { acc = combine(acc, start); result = step(s.inbound); s = result; }',
    '    return [s.outbound, acc];',
    '};'
].join('\n');
const mapping = { Variant: 'Selection', Step: 'Transition', isInbound: 'choose', kind: 'status', inbound: 'input',
    outbound: 'output', note: 'metadata', Inbound: 'continue', Outbound: 'done', Combined: 'halt' };
const rename = (text) => {
    const result = typescript.transform(typescript.createSourceFile('rename.ts', text, typescript.ScriptTarget.Latest, true), [context => (file) => {
        const visit = (node) => {
            const { text = '' } = node;
            const { [text]: renamed = '' } = mapping;

            if (typescript.isIdentifier(node) && renamed) return typescript.factory.createIdentifier(renamed);

            if (typescript.isStringLiteral(node) && renamed) return typescript.factory.createStringLiteral(renamed);

            return typescript.visitEachChild(node, visit, context);
        };

        return typescript.visitNode(file, visit);
    }]);
    const { transformed: [transformed = {}] = [] } = result;
    const code = typescript.createPrinter().printFile(transformed);
    result.dispose();

    return code;
};
const restCardinality = [
    'export function read(...args: [number] | [number, number] | [number, number, number]) {',
    'if (args.length === 1) return args[0]; return args.length === 2 ? args[0] + args[1] : args[0] + args[1] + args[2]; }'
].join('');
const cases = { named: source, neutral: rename(source),
    restCardinality,
    restCardinalityNeutral: restCardinality.replaceAll('args', 'inputs'),
    tupleMetadata: 'type Q=([number]&{phase:"go"})|([number,number]&{phase:"stop"});export const read=(x:Q)=>{if(x.phase==="go")return x[0];return x[1];};',
    numericProperties: [
        'type V={0:"go";1:number}|{0:"stop";2:number}|{0:"hold";2:number};',
        'export const read=(x:V)=>{if(x[0]==="go")return x[1];return x[2];};'
    ].join(''),
    tupleMetadataMixed: 'type Q=([number]&{phase:"go"})|{phase:"stop";datum:number};export const read=(x:Q)=>{if(x.phase==="go")return x[0];return x.datum;};',
    tupleMetadataNeutral: 'type Carrier=([number]&{signal:"ready"})|([number,number]&{signal:"idle"});export const read=(value:Carrier)=>{if(value.signal==="ready")return value[0];return value[1];};',
    collision: 'export const read = (isInbound: (x: number) => boolean, value: number) => isInbound(value) ? value : 0;',
    collisionNeutral: 'export const read = (choose: (x: number) => boolean, value: number) => choose(value) ? value : 0;',
    nestedRequiredArray: 'type Q={kind:"go";payload:[number,number]}|{kind:"stop"};export const read=(input:Q)=>{if(input.kind==="stop")return [];const {payload:[a,b]}=input;return [a,b];};',
    nestedRequiredObject: 'type Q={kind:"go";payload:{a:number;b:number}}|{kind:"stop"};export const read=(input:Q)=>{if(input.kind==="stop")return [];const {payload:{a,b}}=input;return [a,b];};',
    reassigned: [
        'type V = {kind:"Inbound";inbound:number}|{kind:"Outbound";outbound:number};',
        'let isInbound = (x: V): x is Extract<V,{kind:"Inbound"}> => x.kind === "Inbound";',
        'isInbound = (x: V): x is Extract<V,{kind:"Inbound"}> => true; export const read = (x:V) => isInbound(x) ? x.inbound : x.outbound;'
    ].join(''),
    eagerIf: 'type V={kind:"go";datum:number}|{kind:"stop";datum:number};export const read=(x:V,isReady:(x:V)=>boolean)=>{const {datum}=x;if(isReady(x))return datum;return 0;};',
    eagerNeutral: 'type V={kind:"go";datum:number}|{kind:"stop";datum:number};export const read=(x:V,choose:(x:V)=>boolean)=>{const {datum}=x;if(choose(x))return datum;return 0;};',
    eagerConditional: [
        'type V={kind:"go";datum:number}|{kind:"stop";datum:number};',
        'const choose=(x:V):x is Extract<V,{kind:"go"}>=>x.kind==="go";',
        'export const read=(x:V)=>{const {datum}=x;return choose(x)?datum:0;};'
    ].join(''),
    resolverCollision: 'type V={category:(n:number)=>number};export const read=(x:V)=>x.category(1);',
    resolverNeutral: 'type V={choose:(n:number)=>number};export const read=(x:V)=>x.choose(1);',
    method: 'type V={kind:"go";run:()=>number}|{kind:"stop"};export const read=(x:V)=>{if(x.kind==="go")return x.run();return 0;};',
    switchDirect: 'type V={kind:"go";datum:number}|{kind:"stop"};export const read=(x:V)=>{switch(x.kind){case "go":return x.datum;case "stop":return 0;}};',
    switchArgs: [
        'type V={kind:"go";datum:number}|{kind:"stop"};',
        'export const read=(x:V,f:(a:number,b:number)=>number,effect:()=>number)=>{',
        'switch(x.kind){case "go":return f(effect(),x.datum);case "stop":return 0;}};'
    ].join(''),
    switchReceiver: [
        'type V={kind:"go";datum:number}|{kind:"stop"};',
        'export const read=(x:V,f:{run:(a:number,b:number)=>number},effect:()=>number)=>{',
        'switch(x.kind){case "go":return f.run(effect(),x.datum);case "stop":return 0;}};'
    ].join(''),
    binaryEffect: [
        'type V={kind:"go";datum:number}|{kind:"stop"};',
        'export const read=(x:V,effect:()=>number)=>{if(x.kind==="go")return effect()+x.datum;return 0;};'
    ].join(''),
    deferredOptional: [
        'type V={kind:"go";datum:number}|{kind:"stop"};',
        'export const read=(x:V,f?: (n:number)=>number)=>{if(x.kind==="stop")return ()=>0;return ()=>f?.(x.datum);};'
    ].join(''),
    curriedOptional: [
        'type V={kind:"go";datum:[number]}|{kind:"stop"};',
        'export const read=(x:V,f?: (a:number)=>(b:number)=>number)=>{if(x.kind==="stop")return 0;return f?.(10)(x.datum[0]);};'
    ].join(''),
    updaterOptional: [
        'type V={kind:"go";datum:number}|{kind:"stop"};',
        'export const read=(x:V,f:(n:number)=>V)=>{while(x.kind==="go"){x=f?.(x.datum);}return 0;};'
    ].join(''),
    updaterArgs: [
        'type V={kind:"go";datum:number}|{kind:"stop"};',
        'export const read=(x:V,effect:()=>number,next:(a:number,b:number)=>V)=>{',
        'while(x.kind==="go"){x=next(effect(),x.datum);}return 0;};'
    ].join(''),
    updaterMethod: [
        'type V={kind:"go";datum:number}|{kind:"stop"};',
        'export const read=(x:V,effect:()=>number,next:{run:(a:number)=>V})=>{',
        'while(x.kind==="go"){x=next.run(x.datum);}return 0;};'
    ].join(''),
    updaterDirect: [
        'type V={kind:"go";datum:number}|{kind:"stop"};',
        'export const read=(x:V,effect:()=>number,next:(a:number)=>V)=>{',
        'while(x.kind==="go"){x=next(x.datum);}return 0;};'
    ].join(''),
    repeated: 'type V={kind:"go";datum:number}|{kind:"stop"};export const read=(x:V)=>{if(x.kind==="go")return x.datum+x.datum;return 0;};',
    conditionalArgs: 'type V={kind:"go";datum:number}|{kind:"stop"};export const read=(x:V,f:(a:number,b:number)=>number,effect:()=>number)=>{return f(effect(),x.kind==="go"?x.datum:0);};',
    conditionalReceiver: [
        'type V={kind:"go";datum:number}|{kind:"stop"};',
        'export const read=(x:V,f:{run:(a:number,b:number)=>number},effect:()=>number)=>{return f.run(effect(),x.kind==="go"?x.datum:0);};'
    ].join(''),
    otherLocalPhase: [
        'type V={kind:"go";datum:number}|{kind:"stop"};',
        'export const read=(x:V,f:(a:number,b:number)=>number,effect:()=>number)=>{const box={get item(){return effect()+1}};return x.kind==="go"?x.datum:f(effect(),box.item);};'
    ].join(''),
    wrappedOr: 'type V={kind:"go";datum:number}|{kind:"stop"};export const read=(x:V,effect:()=>number)=>{return effect()||(x.kind==="go"?x.datum:0);};',
    wrappedAnd: 'type V={kind:"go";datum:number}|{kind:"stop"};export const read=(x:V,effect:()=>number)=>{return effect()&&(x.kind==="go"?x.datum:0);};',
    getterOr: 'type V={kind:"go";datum:number}|{kind:"stop"};export const read=(x:V,p:{gate:number})=>{return p.gate||(x.kind==="go"?x.datum:0);};',
    getterAnd: 'type V={kind:"go";datum:number}|{kind:"stop"};export const read=(x:V,p:{gate:number})=>{return p.gate&&(x.kind==="go"?x.datum:0);};',
    reassignedCallee: [
        'type V={kind:"go";datum:number}|{kind:"stop"};',
        'export const read=(x:V,f:(a:number)=>number)=>{const select=(value:V):value is Extract<V,{kind:"go"}>=>{f=()=>99;return value.kind==="go";};return f(select(x)?x.datum:0);};'
    ].join(''),
    mutableCallee: [
        'type V={kind:"go";datum:number}|{kind:"stop";out:number};',
        'export const read=(x:V,step:(n:number)=>V)=>{let s:V=x;let result:V=s;',
        'while(s.kind==="go"){Object.defineProperty(s,"datum",{configurable:true,get(){step=()=>({kind:"stop",out:222});return 1;}});result=step(s.datum);s=result;}return [s.out,0];};'
    ].join(''),
    singleCallee: [
        'type V={kind:"go";datum:number}|{kind:"stop";out:number};',
        'export const read=(x:V,step:(n:number)=>V)=>{Object.defineProperty(x,"datum",{configurable:true,get(){step=()=>({kind:"stop",out:222});return 1;}});',
        'while(x.kind==="go"){x=step(x.datum);}return x.out;};'
    ].join(''),
    computedSelection: [
        'type V={kind:"go";datum:number}|{kind:"stop"};',
        'export const read=(x:V,f:(a:number,b:number)=>number,effect:()=>number)=>{',
        'if(x["kind"]==="go")return f(effect(),x["datum"]);return 0;};'
    ].join(''),
    computedTag: [
        'type V={kind:"go";datum:number}|{kind:"stop"};',
        'export const read=(x:V,f:(a:number,b:number)=>number,effect:()=>number)=>{',
        'if(x["kind"]==="go")return f(effect(),x.datum);return 0;};'
    ].join(''),
    computedOpen: [
        'type V={kind:string;datum:number};',
        'export const read=(x:V,f:(a:number,b:number)=>number,effect:()=>number)=>{',
        'if(x["kind"]==="go")return f(effect(),x["datum"]);return 0;};'
    ].join(''),
    numeric: 'type V = {code:0;datum:number}|{code:1;problem:string}; export const read = (x:V) => {if(x.code===0)return x.datum;return x.problem;};',
    boolean: 'type V = {ready:true;datum:number}|{ready:false;problem:string}; export const read = (x:V) => {if(x.ready===true)return x.datum;return x.problem;};' };
const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
const lint = new ESLint({ overrideConfigFile: true, overrideConfig: config });
const fix = new ESLint({ fix: true, overrideConfigFile: true, overrideConfig: config });
let sequence = 0;
const imports = async (code) => {
    const file = path.join(directory, `run-${sequence += 1}.js`);
    await writeFile(file, code);

    const { href = '' } = new URL(`file://${file}`);

    return import(href);
};
let records = new Map();
const normalize = (value, sourceFile, neutral) => {
    const reverse = neutral ? Object.fromEntries(Object.entries(mapping).map(([name = '', renamed = ''] = []) => [renamed, name])) : {};
    const canonicalName = (text) => {
        const { [text]: original = text } = reverse;

        return original;
    };
    const syntax = (node) => {
        const scanner = typescript.createScanner(typescript.ScriptTarget.Latest, true);
        scanner.setText(node.getText(sourceFile));
        let tokens = [];
        let token = scanner.scan();
        // eslint-disable-next-line resilient/prefer-prototype-methods -- Scanner advances in native token order until its exact EOF sentinel.
        while (token !== typescript.SyntaxKind.EndOfFileToken) {
            tokens = [...tokens, [token, canonicalName(scanner.getTokenValue() || scanner.getTokenText())]];
            token = scanner.scan();
        }

        return tokens;
    };
    let occurrences = new Map();
    const visit = (node) => {
        const { pos = -1, end = -1 } = node;
        occurrences = new Map([...occurrences, [`${pos}:${end}`, syntax(node)]]);
        typescript.forEachChild(node, visit);
    };
    visit(sourceFile);
    // Canonical evidence preserves heterogeneous scalar, array and object source facts.
    const convert = (item) => {
        if (typeof item === 'string') return occurrences.get(item) || canonicalName(item);

        if (Array.isArray(item)) return item.map(convert);

        if (!item || typeof item !== 'object') return item;

        const { kind = -1, getText = false } = item;

        if (kind >= 0 && typeof getText === 'function') return { syntax: syntax(item) };

        return Object.fromEntries(Object.entries(item).map(([key = '', entry = false] = []) => [key, convert(entry)]));
    };

    return convert(value);
};
const assertComputedDecisions = (name, selectedModelContracts, decisions) => {
    if (!['computedSelection', 'computedTag', 'computedOpen'].includes(name)) return;

    const reads = [...selectedModelContracts.values()];
    assert.equal(reads.length, 2, name);
    assert.deepEqual(reads.map(({ source: { member = '' } = {} } = {}) => member).toSorted(), ['datum', 'kind']);
    assert.ok(reads.every(({ action = '' } = {}) => action === 'retain-source-phase-read'));
    assert.ok([...decisions.byKey.values()].flat().every(({ agreement: { action = '' } = {} } = {}) => action === 'retain-source-phase-read'));

    if (name === 'computedOpen') {
        assert.ok(reads.every(({ selection: { state = '' } = {} } = {}) => state === 'unknown'));

        return;
    }

    {
        assert.ok(reads.every(({ selection: { partitions = [] } = {} } = {}) => partitions.length === 1 && partitions.every(({ alternatives = [] } = {}) => alternatives.length === 2)));
        const [{ selection: { fieldAgreement = '' } = {} } = {}] = reads.filter(({ source: { member = '' } = {} } = {}) => member === 'datum');
        assert.equal(fieldAgreement, 'exact-source-read');
    }
};
try {
    await Promise.all(Object.entries(cases).map(([name = '', code = ''] = []) => writeFile(path.join(directory, `${name}.ts`), code)));
    const files = Object.keys(cases).map(name => path.join(directory, `${name}.ts`));
    const program = typescript.createProgram(files, { strict: true, module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext });
    assert.deepEqual(program.getSemanticDiagnostics(), []);
    // eslint-disable-next-line resilient/prefer-prototype-methods -- Source/raw/fixed executions and facts are checked in source-case order against one strict Program.
    for (const [name = '', code = ''] of Object.entries(cases)) {
        const fileName = path.join(directory, `${name}.ts`);
        const options = { typescript, checker: program.getTypeChecker(), sourceFile: program.getSourceFile(fileName) };
        const selectedModelContracts = collectSelectedModelContracts(options);
        const deferredSelectedPayloadContracts = collectDeferredSelectedPayloadContracts(options);
        const mutableSelectedLoopContracts = collectMutableSelectedLoopContracts(options);
        const decisions = compileDestructuringDecisions(collectDestructuringAgreements({ typescript, selectedModelContracts, deferredSelectedPayloadContracts, mutableSelectedLoopContracts }));

        assertComputedDecisions(name, selectedModelContracts, decisions);

        if (name === 'numericProperties') {
            const reads = [...selectedModelContracts.values()];
            assert.equal(reads.length, 3);
            assert.ok(reads.every(({ action = '' } = {}) => action === 'retain-source-phase-read'));
            const completed = [...decisions.byKey.values()].flat();
            assert.equal(completed.length, 3);
            assert.ok(completed.every(({ agreement: { action = '' } = {} } = {}) => action === 'retain-source-phase-read'));
            const [{ selection: { partitions = [] } = {} } = {}] = reads.filter(({ operationRole = '' } = {}) => operationRole === 'discriminator-read');
            assert.equal(partitions.length, 1);
            const [{ alternatives = [] } = {}] = partitions;
            assert.equal(alternatives.length, 3);
        }

        if (name.startsWith('tupleMetadata')) {
            const reads = [...selectedModelContracts.values()];
            assert.equal(reads.length, 3);
            assert.ok(reads.every(({ action = '' } = {}) => action === 'retain-source-phase-read'));
            const completed = [...decisions.byKey.values()].flat();
            assert.equal(completed.length, 3);
            assert.ok(completed.every(({ agreement: { action = '' } = {} } = {}) => action === 'retain-source-phase-read'));
            const [{ selection: { partitions = [] } = {} } = {}] = reads.filter(({ operationRole = '' } = {}) => operationRole === 'discriminator-read');
            assert.equal(partitions.length, name === 'tupleMetadataMixed' ? 1 : 2);
            assert.ok(partitions.every(({ alternatives = [] } = {}) => alternatives.length === 2));
        }

        if (name.startsWith('restCardinality')) {
            const cardinalities = [...selectedModelContracts.values()].filter(({ source: { member = '' } = {} } = {}) => member === 'length');
            assert.equal(cardinalities.length, 2);
            cardinalities.forEach(({ action = '', operationRole = '', selection: { partitions = [] } = {} } = {}) => {
                assert.equal(action, 'retain-source-phase-read');
                assert.equal(operationRole, 'discriminator-read');
                assert.equal(partitions.length, 1);
                const [{ alternatives = [] } = {}] = partitions;
                assert.equal(alternatives.length, 3);
            });
            const completedCardinalities = [...decisions.byKey.values()].flat().filter(({ contract: { source: { member = '' } = {} } = {} } = {}) => member === 'length');
            assert.equal(completedCardinalities.length, 2);
            assert.ok(completedCardinalities.every(({ agreement: { action = '' } = {} } = {}) => action === 'retain-source-phase-read'));
        }

        const facts = normalize({
            selected: [...selectedModelContracts.values()],
            deferred: [...deferredSelectedPayloadContracts.values()],
            mutable: [...mutableSelectedLoopContracts.values()],
            decisions: [...decisions.byKey.values()].flat()
        }, program.getSourceFile(fileName), name === 'neutral' || name === 'collisionNeutral');
        const output = createTypeScriptTransformer({ typescript, program, standard: { object: new URL('../analysis/host/object.js', import.meta.url).pathname } }).transform({ code, fileName });
        const { diagnostics = [], code: lowered = '' } = output;
        assert.deepEqual(diagnostics, [], name);
        const [raw = {}] = await lint.lintText(lowered, { filePath: `${name}-generated.js` });
        const [fixed = {}] = await fix.lintText(lowered, { filePath: `${name}-generated.js` });
        const { outputText: native = '' } = typescript.transpileModule(code, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const { output: fixedCode = '', errorCount: fixedErrors = 0, messages: fixedMessages = [] } = fixed;
        const { errorCount: rawErrors = 0, messages: rawMessages = [] } = raw;
        const modules = await Promise.all([native, lowered, fixedCode || lowered].map(imports));
        const expectedErrors = name.endsWith('Optional') ? ['no-restricted-syntax'] : [];
        assert.deepEqual(rawMessages.filter(({ severity = 0 } = {}) => severity === 2).map(({ ruleId = '' } = {}) => ruleId),
            expectedErrors, JSON.stringify({ name, lowered, rawMessages }));
        assert.deepEqual(fixedMessages.filter(({ severity = 0 } = {}) => severity === 2).map(({ ruleId = '' } = {}) => ruleId),
            expectedErrors, JSON.stringify({ name, lowered, fixedCode, fixedMessages }));
        assert.equal(rawErrors, expectedErrors.length);
        assert.equal(fixedErrors, expectedErrors.length);
        records = new Map([...records, [name, { facts, modules, code: lowered }]]);
    }
    const { modules: numericPropertyModules = [] } = records.get('numericProperties');
    const observeNumericProperties = ({ read = value => Boolean(value) } = {}, tag, mode) => {
        const marker = new Error('numeric property exact identity');
        let trace = [];
        const input = {};
        Object.defineProperty(input, Symbol.iterator, { get() { throw marker; } });
        Object.defineProperty(input, 0, { get() {
            trace = [...trace, 'tag'];

            if (mode === 'tagThrow') throw marker;

            return tag;
        } });
        [1, 2].forEach(index => Object.defineProperty(input, index, { get() {
            trace = [...trace, index];

            if (mode === 'fieldThrow') throw marker;

            // eslint-disable-next-line resilient/prefer-falsey-returns -- Numeric object property retains exact present undefined rather than a positional fallback.
            if (mode === 'undefined') return undefined;

            return index;
        } }));
        let result;
        let caught;
        try { result = read(input); } catch (error) { caught = error; }

        return { result, trace, identity: caught === marker };
    };
    const [numericPropertyNative = {}] = numericPropertyModules;
    ['go', 'stop', 'hold'].forEach(tag => ['normal', 'tagThrow', 'fieldThrow', 'undefined'].forEach((mode) => {
        const expected = observeNumericProperties(numericPropertyNative, tag, mode);
        numericPropertyModules.slice(1).forEach(module => assert.deepEqual(observeNumericProperties(module, tag, mode), expected));
    }));
    ['tupleMetadata', 'tupleMetadataNeutral', 'tupleMetadataMixed'].forEach((name) => {
        const { modules = [] } = records.get(name);
        const neutral = name === 'tupleMetadataNeutral';
        const observe = ({ read = value => Boolean(value) } = {}, mode) => {
            const marker = new Error('tuple exact identity');
            let trace = [];
            const mixed = name === 'tupleMetadataMixed' && mode !== 'go';
            const input = mixed ? {} : [1, 2];
            Object.defineProperty(input, Symbol.iterator, { get() { throw marker; } });
            Object.defineProperty(input, neutral ? 'signal' : 'phase', { get() {
                trace = [...trace, 'discriminator'];

                if (mode === 'tagThrow') throw marker;

                const continuing = neutral ? 'ready' : 'go';
                const terminating = neutral ? 'idle' : 'stop';

                return mode === 'go' ? continuing : terminating;
            } });
            /* eslint-disable resilient/signature-contract-return-consistency -- The tuple getter fixture deliberately returns numbers or undefined to verify exact native Get results. */
            [0, 1, 'datum'].forEach(index => Object.defineProperty(input, index, { get() {
                trace = [...trace, index];

                if (mode === 'fieldThrow') throw marker;

                // eslint-disable-next-line resilient/prefer-falsey-returns -- Exact native tuple Get preserves present undefined and must not fabricate a positional default.
                if (mode === 'undefined') return undefined;

                return index === 'datum' ? 2 : index + 1;
            } }));
            /* eslint-enable resilient/signature-contract-return-consistency */
            let result;
            let caught;
            try { result = read(input); } catch (error) { caught = error; }

            return { result, trace, identity: caught === marker };
        };
        const [native = {}] = modules;
        ['go', 'stop', 'tagThrow', 'fieldThrow', 'undefined'].forEach((mode) => {
            const expected = observe(native, mode);
            modules.slice(1).forEach(module => assert.deepEqual(observe(module, mode), expected));
        });
    });
    ['restCardinality', 'restCardinalityNeutral'].forEach((name) => {
        const { modules = [], code: lowered = '' } = records.get(name);
        assert.match(lowered, /(?:args|inputs)\.length/);
        modules.forEach(({ read = () => false } = {}) => {
            [[1], [1, 2], [1, 2, 3]].forEach(args => assert.equal(read(...args), args.reduce((sum, value) => sum + value, 0)));
        });
    });
    const { facts: namedFacts = {}, code: namedCode = '' } = records.get('named');
    const { facts: neutralFacts = {} } = records.get('neutral');
    const { facts: collisionFacts = {} } = records.get('collision');
    const { facts: neutralCollisionFacts = {} } = records.get('collisionNeutral');
    const { deferred = [], mutable = [] } = namedFacts;
    assert.deepEqual(namedFacts, neutralFacts);
    assert.deepEqual(collisionFacts, neutralCollisionFacts);
    assert.ok(deferred.length);
    assert.ok(mutable.length);
    assert.match(namedCode, /isInbound\(value, effect\)/);
    const namedFile = program.getSourceFile(files[0]);
    let predicates = [];
    const visit = (node) => {
        const { expression = {} } = node;

        if (typescript.isCallExpression(node) && expression.getText(namedFile) === 'isInbound') {
            predicates = [...predicates, getSelectedModelPredicateFact({ typescript, checker: program.getTypeChecker(), expression: node })];
        }

        typescript.forEachChild(node, visit);
    };
    visit(namedFile);
    assert.equal(predicates.length, 1);
    const [{ property = '', partitions: [{ alternatives = [] } = {}] = [] } = {}] = predicates;
    assert.equal(property, 'kind');
    assert.equal(alternatives.length, 3);
    const observe = (module, neutral = false, mode = 'normal') => {
        const kind = neutral ? 'status' : 'kind';
        const field = neutral ? 'output' : 'outbound';
        const tag = neutral ? 'done' : 'Outbound';
        const marker = new Error('exact getter');
        let trace = [];
        let count = 0;
        const input = {};
        Object.defineProperty(input, kind, { get() { trace = [...trace, this === input ? 'tag' : 'bad receiver'];

            return tag; } });
        Object.defineProperty(input, field, { get() {
            trace = [...trace, 'field']; count += 1;

            if (mode === 'throw') throw marker;

            // eslint-disable-next-line resilient/prefer-falsey-returns -- This source getter probe preserves exact present undefined.
            if (mode === 'absent') return undefined;

            return count;
        } });
        let result;
        let caught;
        try { result = module.read(input, () => { trace = [...trace, 'predicate']; }); } catch (error) { caught = error; }
        const callback = module.later(input, (a, b) => { trace = [...trace, 'combine'];

            return a + b; });
        trace = [...trace, 'created'];
        let later;
        try { later = callback(4); } catch (error) { caught = error; }

        const getErrorName = ({ name = '' } = {}) => name;
        const errorName = getErrorName(caught);

        return { result, later, trace, identity: caught === marker, error: errorName };
    };
    ['normal', 'throw', 'absent'].forEach((mode) => {
        ['named', 'neutral'].forEach((name) => {
            const { modules = [] } = records.get(name);
            const [native = {}] = modules;
            const expected = observe(native, name === 'neutral', mode);
            modules.slice(1).forEach(module => assert.deepEqual(observe(module, name === 'neutral', mode), expected));
        });
    });
    const loop = (module, neutral = false, stop = 'Outbound') => {
        const key = neutral ? 'status' : 'kind';
        const feed = neutral ? 'input' : 'inbound';
        const output = neutral ? 'output' : 'outbound';
        const marker = new Error('loop getter');
        let calls = 0;
        let trace = [];
        const step = (n) => {
            calls += 1;
            trace = [...trace, `step:${n}`];
            const input = {};
            Object.defineProperty(input, key, { get() { trace = [...trace, 'tag'];

                if (calls < 3) return neutral ? 'continue' : 'Inbound';

                if (!neutral) return stop;

                return stop === 'Outbound' ? 'done' : 'halt'; } });
            Object.defineProperty(input, feed, { get() { trace = [...trace, 'feed'];

                return n + 1; } });
            Object.defineProperty(input, output, { get() { trace = [...trace, 'exit'];

                if (stop === 'throw') throw marker;

                return n; } });

            return input;
        };
        let result;
        let caught;
        try { result = module.recur(step, 1, (a, b) => { trace = [...trace, 'combine'];

            return a + b; }); } catch (error) { caught = error; }

        return { result, trace, identity: caught === marker };
    };
    ['Outbound', 'Combined', 'throw'].forEach(stop => ['named', 'neutral'].forEach((name) => {
        const { modules = [] } = records.get(name);
        const [native = {}] = modules;
        const expected = loop(native, name === 'neutral', stop);
        modules.slice(1).forEach(module => assert.deepEqual(loop(module, name === 'neutral', stop), expected));
    }));
    ['collision', 'collisionNeutral'].forEach((name) => {
        const { modules = [] } = records.get(name);
        modules.forEach(({ read = value => Boolean(value) } = {}) => {
            const marker = new Error('predicate');
            assert.throws(() => read(() => { throw marker; }, 1), error => error === marker);
        });
    });
    const { modules: reassignedModules = [] } = records.get('reassigned');
    reassignedModules.forEach(({ read = value => Boolean(value) } = {}) => assert.equal(read({ kind:'Outbound',outbound:3 }), undefined));
    ['numeric', 'boolean'].forEach((name) => {
        const inputs = name === 'numeric' ? [{ code:0,datum:0 },{ code:1,problem:'' }] : [{ ready:true,datum:0 },{ ready:false,problem:'' }];
        const { modules = [] } = records.get(name);
        const [{ read: nativeRead = () => false } = {}] = modules;
        modules.forEach(({ read = () => false } = {}) => inputs.forEach(input => assert.equal(read(input), nativeRead(input))));
    });
    const observeOperation = ({ read = () => false } = {}, name, mode) => {
        const marker = new Error('source exception identity');
        let trace = [];
        let count = 0;
        const record = (event) => { trace = [...trace, event]; };
        const input = {};
        Object.defineProperty(input, 'kind', { get() {
            record(this === input ? 'tag' : 'bad receiver');

            if (mode === 'tagThrow') throw marker;

            return mode === 'stop' ? 'stop' : 'go';
        } });

        if (mode !== 'missing') Object.defineProperty(input, 'datum', { get() {
            record('datum'); count += 1;

            if (mode === 'fieldThrow') throw marker;

            // eslint-disable-next-line resilient/prefer-falsey-returns -- The authored source probe observes exact present undefined, without a fabricated replacement value.
            if (mode === 'undefined') return undefined;

            return count;
        } });

        Object.defineProperty(input, 'run', { get() {
            record('method');

            if (mode === 'fieldThrow') throw marker;

            return function () { record(this === input ? 'receiver' : 'bad receiver');

                return 1; };
        } });
        let effects = 0;
        const effect = () => { record('effect'); effects += 1;

            if (mode === 'effectThrow') throw marker;

            return name === 'wrappedAnd' && effects === 1 ? 0 : effects; };
        const call = (a, b = 0) => { record('call');

            return a - b; };
        const receiver = { get run() { record('callee');

            return function (a, b) { record(this === receiver ? 'receiver' : 'bad receiver');

                return a + b; }; } };
        // eslint-disable-next-line resilient/no-null-assignment -- Authored native-failure probe must supply the actual null receiver from the source contract boundary.
        const candidate = mode === 'null' ? null : input;
        let result;
        let caught;
        const invoke = () => {
            if (name === 'method' || name === 'switchDirect' || name === 'repeated') return read(candidate);

            if (['binaryEffect', 'wrappedOr', 'wrappedAnd'].includes(name)) return read(candidate, effect);

            if (['getterOr', 'getterAnd'].includes(name)) return read(candidate, { get gate() {
                record('gate'); effects += 1;

                return name === 'getterAnd' && effects === 1 ? 0 : effects;
            } });

            const callable = ['switchReceiver', 'conditionalReceiver'].includes(name) ? receiver : call;
            const missing = ['switchReceiver', 'conditionalReceiver'].includes(name) ? {} : false;

            return read(candidate, mode === 'noncallable' ? missing : callable, effect);
        };
        try { result = invoke(); } catch (error) { caught = error; }
        const getErrorName = ({ name = '' } = {}) => name;
        const errorName = getErrorName(caught);

        return { result, trace, identity: caught === marker, errorName };
    };
    ['method', 'switchDirect', 'switchArgs', 'switchReceiver', 'binaryEffect', 'repeated',
        'conditionalArgs', 'conditionalReceiver', 'otherLocalPhase', 'wrappedOr', 'wrappedAnd',
        'getterOr', 'getterAnd', 'reassignedCallee', 'computedSelection', 'computedTag', 'computedOpen'].forEach((name) => {
        const { modules = [] } = records.get(name);
        const [native = {}] = modules;
        ['normal', 'stop', 'tagThrow', 'fieldThrow', 'effectThrow', 'null', 'missing', 'undefined', 'noncallable'].forEach((mode) => {
            const expected = observeOperation(native, name, mode);

            if (name === 'otherLocalPhase' && mode === 'stop') {
                const { result: expectedResult = 0, trace: expectedTrace = [] } = expected;
                assert.equal(expectedResult, -2);
                assert.deepEqual(expectedTrace, ['tag', 'effect', 'effect', 'call']);
            }

            if (['wrappedOr', 'wrappedAnd', 'getterOr', 'getterAnd'].includes(name) && mode === 'normal')
                assert.equal(expected.trace.length, 1);

            modules.slice(1).forEach(module => assert.deepEqual(observeOperation(module, name, mode), expected, `${name}:${mode}`));
        });
    });
    ['mutableCallee', 'singleCallee'].forEach((name) => {
        const { modules = [] } = records.get(name);
        modules.forEach(({ read = (value, step) => Boolean(value && step) } = {}) => {
            const input = { kind: 'go', datum: 1 };
            const result = read(input, () => ({ kind: 'stop', out: 111 }));
            assert.deepEqual(result, name === 'mutableCallee' ? [111, 0] : 111);
        });
    });
    const observeUpdater = ({ read = () => false } = {}, name, throws) => {
        const marker = new Error('loop original exception');
        let trace = [];
        const record = (event) => { trace = [...trace, event]; };
        const input = { get kind() { record('tag');

            return 'go'; }, get datum() { record('datum');

            if (throws) throw marker;

            return 1; } };
        const stop = { get kind() { record('exit-tag');

            return 'stop'; } };
        const effect = () => { record('effect');

            return 10; };
        const next = () => { record('next');

            return stop; };
        const receiver = { get run() { record('callee');

            return function () { record(this === receiver ? 'receiver' : 'bad receiver');

                return next(); }; } };
        let result;
        let caught;
        try { result = read(input, effect, name === 'updaterMethod' ? receiver : next); } catch (error) { caught = error; }

        return { result, trace, identity: caught === marker };
    };
    ['updaterArgs', 'updaterMethod', 'updaterDirect'].forEach((name) => {
        const { modules = [] } = records.get(name);
        const [native = {}] = modules;
        [false, true].forEach((throws) => {
            const expected = observeUpdater(native, name, throws);
            modules.slice(1).forEach(module => assert.deepEqual(observeUpdater(module, name, throws), expected, `${name}:${throws}`));
        });
    });
    ['function', 'array', 'object'].forEach((kind) => {
        ['category', 'tag', 'choose'].forEach((propertyName) => {
            const properties = [{ propertyName, agreement: { kind } }];
            assert.deepEqual([...getObjectResolverGuardKinds({ properties })], [kind]);
            const declaration = getObjectResolverDeclaration({ typescript, properties, name: 'V' });
            const code = typescript.createPrinter().printNode(typescript.EmitHint.Unspecified, declaration,
                typescript.createSourceFile('resolver.ts', '', typescript.ScriptTarget.Latest));
            const { [kind]: capability = '' } = { function: 'isFunction', array: 'hasArrayContent', object: 'hasContent' };
            assert.ok(code.includes(`${capability}(${propertyName})`), code);
        });
    });
    ['resolverCollision', 'resolverNeutral'].forEach((name) => {
        const key = name === 'resolverCollision' ? 'category' : 'choose';
        const { modules = [] } = records.get(name);
        const [native = {}] = modules;
        const observe = ({ read } = {}) => {
            if (!isFunction(read)) throw new TypeError('The test module must export read.');

            let trace = [];
            const input = { get [key]() { trace = [...trace, 'lookup'];

                return function (value) { trace = [...trace, this === input ? 'receiver' : 'wrong-receiver'];

                    return value + 1; }; } };

            return { result: read(input), trace };
        };
        const expected = observe(native);
        modules.slice(1).forEach((module) => {
            assert.deepEqual(observe(module), expected);
        });
    });
    const observeEager = ({ read } = {}, name, mode) => {
        if (!isFunction(read)) throw new TypeError('The test module must export read.');

        const marker = new Error('eager source Get');
        let trace = [];
        const record = (event) => { trace = [...trace, event]; };
        const datum = mode === 'undefined' ? undefined : 3;
        const input = {
            get kind() { record('tag');

                return mode === 'false' ? 'stop' : 'go'; },
            get datum() { record('datum');

                if (mode === 'throw') throw marker;

                return datum; }
        };
        const inputValue = mode === 'missing' ? { kind: 'go' } : input;
        // eslint-disable-next-line resilient/no-null-assignment -- Authored native-failure proof requires the source null receiver.
        const value = mode === 'null' ? null : inputValue;
        const predicate = () => { record('predicate');

            return mode !== 'false'; };
        let result;
        let caught;
        try {
            result = name === 'eagerConditional' ? read(value) : read(value, predicate);
        } catch (error) { caught = error; }
        const { value: category = '' } = caught
            ? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(caught), 'name') || {} : {};

        return { result, trace, identity: caught === marker, category };
    };
    ['eagerIf', 'eagerNeutral', 'eagerConditional'].forEach((name) => {
        const { modules = [] } = records.get(name);
        const [native = {}] = modules;
        ['true', 'false', 'undefined', 'missing', 'null', 'throw'].forEach((mode) => {
            const expected = observeEager(native, name, mode);
            modules.slice(1).forEach(module => assert.deepEqual(observeEager(module, name, mode), expected, `${name}:${mode}`));
        });
    });
    const observeOptional = ({ read = () => false } = {}, name, absent) => {
        const marker = new Error('optional skipped payload');
        let trace = [];
        const record = (event) => { trace = [...trace, event]; };
        const datum = name === 'curriedOptional' ? [1] : 1;
        const input = { get kind() { record('tag');

            return 'go'; }, get datum() { record('datum');

            if (absent) throw marker;

            return datum; } };
        const suppliers = {
            updaterOptional: () => { record('callee');

                return { kind: 'stop' }; },
            deferredOptional: (value) => { record('callee');

                return value; },
            curriedOptional: (value) => { record('callee');

                return (argument) => { record('callback');

                    return argument + value; }; }
        };
        // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- The fixture intentionally supplies missing callbacks to compare native invocation behavior.
        const { [name]: supplied } = suppliers;
        let result;
        let caught;
        try {
            result = read(input, absent ? undefined : supplied);

            if (name === 'deferredOptional') { record('created'); result = result(); }
        } catch (error) { caught = error; }
        const errorName = (caught && Object.getOwnPropertyDescriptor(Object.getPrototypeOf(caught), 'name')) || {};
        const { value: category = '' } = errorName;

        return { result, trace, identity: caught === marker, category };
    };
    ['deferredOptional', 'curriedOptional', 'updaterOptional'].forEach((name) => {
        const { modules = [] } = records.get(name);
        const [native = {}] = modules;
        [false, true].forEach((absent) => {
            const expected = observeOptional(native, name, absent);
            modules.slice(1).forEach(module => assert.deepEqual(observeOptional(module, name, absent), expected, `${name}:${absent}`));
        });
    });
    ['nestedRequiredArray', 'nestedRequiredObject'].forEach((name) => {
        const { modules = [] } = records.get(name);
        const observe = ({ read = () => [] } = {}, mode) => {
            const marker = new Error('required nested binding identity');
            let trace = '';
            const array = name === 'nestedRequiredArray';
            const payload = array ? [] : {};
            Object.defineProperty(payload, array ? '0' : 'a', { get() {
                trace += 'a:';

                // eslint-disable-next-line resilient/prefer-falsey-returns -- Exact source undefined leaf is the native required nested binding counterexample.
                return undefined;
            } });
            Object.defineProperty(payload, array ? '1' : 'b', { get() {
                trace += 'b:';

                if (mode === 'throw') throw marker;

                return 2;
            } });
            const input = {
                get kind() {
                    trace += 'tag:';

                    return mode === 'stop' ? 'stop' : 'go';
                },
                get payload() {
                    trace += 'payload:';

                    // eslint-disable-next-line resilient/prefer-falsey-returns -- Missing source payload retains the native nested binding failure phase.
                    return mode === 'missing' ? undefined : payload;
                }
            };
            let result;
            let caught;
            try { result = read(input); } catch (error) { caught = error; }

            return { result, trace, identity: caught === marker, nativeFailure: caught instanceof TypeError };
        };
        ['present', 'missing', 'throw', 'stop'].forEach((mode) => {
            const [native = {}] = modules;
            const expected = observe(native, mode);
            modules.slice(1).forEach(module => assert.deepEqual(observe(module, mode), expected, `${name}:${mode}`));
        });
    });
    await Promise.all(Object.entries({
        optionalObject: '{a:number;b?:number}', optionalTuple: '[number,number?]', open: 'Record<string,number>'
    }).map(async ([name = '', payloadType = ''] = []) => {
        const pattern = name === 'optionalTuple' ? '[a,b]' : '{a,b}';
        const code = `type Q={kind:"go";payload:${payloadType}}|{kind:"stop"};export const read=(input:Q)=>{if(input.kind==="stop")return [];const {payload:${pattern}}=input;return [a,b];};`;
        const file = path.join(directory, `${name}.ts`);
        await writeFile(file, code);
        const program = typescript.createProgram([file], { strict: true });
        assert.deepEqual(program.getSemanticDiagnostics(), []);
        const facts = collectSelectedModelContracts({ typescript, sourceFile: program.getSourceFile(file), checker: program.getTypeChecker() });
        const requiredPatterns = [...facts.values()].filter(({ action = '' } = {}) => action === 'exact-source-binding');
        assert.equal(requiredPatterns.length, 1);
        assert.ok(requiredPatterns.every(({ requiredPattern: { complete = true } = {} } = {}) => !complete), name);
    }));
    const optionalFile = path.join(directory, 'optional.ts');
    const optionalSource = 'type V = {kind:"a";datum?:number}|{kind:"b";datum?:number}|{kind:"c"}; export const read = (x:V) => x.kind !== "c" ? x.datum : 0;';
    await writeFile(optionalFile, optionalSource);
    const optionalProgram = typescript.createProgram([optionalFile], { strict: true });
    const optionalFacts = collectSelectedModelContracts({ typescript, checker: optionalProgram.getTypeChecker(), sourceFile: optionalProgram.getSourceFile(optionalFile) });
    assert.ok([...optionalFacts.values()].every(({ operationRole = '', action = '' } = {}) => operationRole === 'discriminator-read' || action === 'retain-source-phase-read'));
    const optionalTree = optionalProgram.getSourceFile(optionalFile);
    const { statements: [{ type: unionType = {} } = {}] = [] } = optionalTree;
    const type = optionalProgram.getTypeChecker().getTypeAtLocation(unionType);
    const [{ alternatives: optionalAlternatives = [] } = {}] = getVariantPartitions({ typescript, checker: optionalProgram.getTypeChecker(), type, node: optionalTree });
    assert.equal(optionalAlternatives.length, 3);

    const collectionSource = [
        'type V={phase:"go";datum:number}|{phase:"stop"};',
        'export const selected=(values:V[],same:(v:number,out:Set<number>)=>boolean)=>{const out=new Set<number>();',
        'values.forEach(x=>{if(x.phase==="go"){if(!same(x.datum,out))out.add(x.datum);}});return out;};',
        'export const ordinary=(values:number[],same:(v:number,out:Set<number>)=>boolean)=>{const out=new Set<number>();',
        'values.forEach(x=>{if(!same(x,out))out.add(x);});return out;};'
    ].join('\n');
    const collectionFile = path.join(directory, 'collection-read-scope.ts');
    await writeFile(collectionFile, collectionSource);
    const collectionProgram = typescript.createProgram([collectionFile], {
        strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext
    });
    assert.deepEqual(collectionProgram.getSemanticDiagnostics(), []);
    const { code: collectionCode = '', diagnostics: collectionDiagnostics = [] } = createTypeScriptTransformer({
        typescript, program: collectionProgram
    }).transform({ code: collectionSource, fileName: collectionFile });
    assert.deepEqual(collectionDiagnostics, []);
    const fullReason = 'Collection identity is observable outside this update; copying changes the object seen by that observer.';
    const shortReason = 'Collection identity is observable outside this update; copying changes the observed object.';
    const collectionTree = typescript.createSourceFile('collection.js', collectionCode, typescript.ScriptTarget.Latest, true);
    const { statements: [selectedStatement = {}, ordinaryStatement = {}] = [] } = collectionTree;
    const selectedText = selectedStatement.getFullText(collectionTree);
    const ordinaryText = ordinaryStatement.getFullText(collectionTree);
    assert.ok(selectedText.includes(shortReason));
    assert.ok(!selectedText.includes(fullReason));
    assert.ok(ordinaryText.includes(fullReason));
    assert.ok(!ordinaryText.includes(shortReason));
    assert.ok(!ordinaryText.includes('eslint-disable resilient/prefer-destructured-member-access'));
    const [collectionRaw = {}] = await lint.lintText(collectionCode, { filePath: 'collection-read-scope-generated.js' });
    const [collectionFixed = {}] = await fix.lintText(collectionCode, { filePath: 'collection-read-scope-generated.js' });
    assert.equal(collectionRaw.errorCount, 0, JSON.stringify(collectionRaw.messages));
    assert.equal(collectionFixed.errorCount, 0, JSON.stringify(collectionFixed.messages));
    const { outputText: collectionNative = '' } = typescript.transpileModule(collectionSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const collectionModules = await Promise.all([collectionNative, collectionCode, collectionFixed.output || collectionCode].map(imports));
    const observeCollection = ({ selected = value => value, ordinary = value => value } = {}, mode = '') => {
        const marker = new Error('collection read identity');
        let events = [];
        let reads = 0;
        let observed = false;
        const value = { phase: mode === 'stop' ? 'stop' : 'go', get datum() {
            reads += 1;
            events = [...events, `get:${reads}`];

            if (mode === 'getter' && reads === 2) throw marker;

            return reads;
        } };
        const same = (datum, out) => {
            events = [...events, `same:${datum}`];
            observed = out;

            if (mode === 'predicate') throw marker;

            return false;
        };

        try {
            const out = selected([value], same);
            const plain = ordinary([3], () => false);

            return { events, result: [...out], sameIdentity: mode === 'stop' || out === observed, plain: [...plain] };
        } catch (error) {
            assert.equal(error, marker);

            return { events, failureIdentity: error === marker };
        }
    };
    ['read', 'stop', 'getter', 'predicate'].forEach((mode) => {
        const [nativeModule = {}] = collectionModules;
        const expected = observeCollection(nativeModule, mode);
        collectionModules.slice(1).forEach(module => assert.deepEqual(observeCollection(module, mode), expected));
    });
} finally { await rm(directory, { recursive: true, force: true }); }

{
    const scopeDirectory = await mkdtemp(path.join(tmpdir(), 'resilient-completed-conditional-scope-'));
    const scopeSource = [
        'export const known=(x:{kind:string})=>x.kind==="go"',
        '    ? (x.kind as string)==="stop"',
        '    : (x.kind as string)==="hold";',
        'export const uncompleted=(x:{kind:string},y:{other:number})=>x.kind==="go"',
        '    ? (x.kind as string)==="stop"',
        '    : y.other;',
        'export const outside=(x:{kind:string},y:{other:number})=>{',
        '    const selected=x.kind==="go"',
        '        ? (x.kind as string)==="stop"',
        '        : (x.kind as string)==="hold";',
        '    return [selected,y.other];',
        '};'
    ].join('\n');
    try {
        const scopeFile = path.join(scopeDirectory, 'scope.ts');
        await writeFile(scopeFile, scopeSource);
        const scopeProgram = typescript.createProgram([scopeFile], { strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext });
        assert.deepEqual(scopeProgram.getSemanticDiagnostics(), []);
        const scopeTree = scopeProgram.getSourceFile(scopeFile);
        const repeatedParameterReadContracts = collectRepeatedParameterReadContracts({ typescript, sourceFile: scopeTree, checker: scopeProgram.getTypeChecker() });
        const scopeDecisions = compileDestructuringDecisions(collectDestructuringAgreements({ repeatedParameterReadContracts }));
        const result = typescript.transform(scopeTree, [context => root => annotateRetainedStaticMemberAccess({ typescript, sourceFile: root, destructuringAgreements: scopeDecisions, context })]);
        const printed = typescript.createPrinter().printFile(result.transformed[0]);
        result.dispose();
        const { outputText: scopeJavaScript = '' } = typescript.transpileModule(printed, {
            compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
        });
        const { outputText: native = '' } = typescript.transpileModule(scopeSource, {
            compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext, removeComments: true }
        });
        const { outputText: withoutComments = '' } = typescript.transpileModule(printed, {
            compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext, removeComments: true }
        });
        const normalizedScope = typescript.transform(typescript.createSourceFile('scope.js', withoutComments,
            typescript.ScriptTarget.Latest, true), [context => (root) => {
            const visit = (node) => {
                const { expression = {} } = node;

                if (typescript.isParenthesizedExpression(node)) return visit(expression);

                const visited = typescript.visitEachChild(node, visit, context);
                // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- The compiler update must receive the original optional return type unchanged.
                const { body = {}, modifiers = [], typeParameters = [], parameters = [], type,
                    equalsGreaterThanToken = {} } = visited;
                const { statements = [] } = body;
                const [onlyReturn = {}] = statements;
                const { expression: result = {} } = onlyReturn;

                if (!typescript.isArrowFunction(visited) || !typescript.isBlock(body) ||
                    statements.length !== 1 || !typescript.isReturnStatement(onlyReturn)) return visited;

                return typescript.factory.updateArrowFunction(visited, modifiers, typeParameters,
                    parameters, type, equalsGreaterThanToken, result);
            };

            return typescript.visitNode(root, visit);
        }]);
        const normalizedCode = typescript.createPrinter({ removeComments: true }).printFile(normalizedScope.transformed[0]);
        normalizedScope.dispose();
        const tokens = (text) => {
            const scanner = typescript.createScanner(typescript.ScriptTarget.Latest, true, typescript.LanguageVariant.Standard, text);
            let result = [];

            // eslint-disable-next-line resilient/prefer-prototype-methods -- Token scanner advances to its native EOF sentinel in observable cursor order.
            while (scanner.scan() !== typescript.SyntaxKind.EndOfFileToken) result = [...result, [scanner.getToken(), scanner.getTokenText()]];

            return result;
        };
        assert.deepEqual(tokens(normalizedCode), tokens(native), 'Only value parentheses and a single native Return may change for completed read placement.');
        assert.equal((scopeJavaScript.match(/\/\* eslint-disable resilient\/prefer-destructured-member-access/gu) || []).length, 4);
        assert.equal((scopeJavaScript.match(/\/\* eslint-enable resilient\/prefer-destructured-member-access/gu) || []).length, 4);
        const scopeLint = new ESLint({ overrideConfigFile: true, overrideConfig: [{ plugins: { resilient },
            linterOptions: { reportUnusedDisableDirectives: 'error' }, rules: { 'resilient/prefer-destructured-member-access': 'error' } }] });
        const [scopeFindings = {}] = await scopeLint.lintText(scopeJavaScript, { filePath: 'scope-generated.js' });
        const { messages = [] } = scopeFindings;
        assert.equal(messages.filter(({ line = 0 } = {}) => scopeJavaScript.split('\n').at(line - 1).includes('y.other')).length, 2,
            'An uncompleted conditional member and a neighboring statement remain visible.');
        assert.ok(messages.every(({ ruleId = '' } = {}) => ruleId === 'resilient/prefer-destructured-member-access'));
    } finally {
        await rm(scopeDirectory, { recursive: true, force: true });
    }
}

{
    const boundaryDirectory = await mkdtemp(path.join(tmpdir(), 'resilient-tuple-read-boundary-'));
    const tails = { complete: 'return x[0]+x[1];', incomplete: 'return x[0]+x[1]+y.other;',
        outside: 'const result=x[0]+x[1];return result+y.other;', nested: 'return x[0]+(()=>y.other)();' };
    const sources = Object.fromEntries(Object.entries(tails).map(([name = '', tail = ''] = []) => [name, [
        'type Q=([number,number]&{phase:"go"})|([number,number,number]&{phase:"stop"});',
        `export const read=(x:Q,y:{other:number})=>{if(x.phase==="go"){${tail}}return 0;}`
    ].join('')]));
    try {
        await Promise.all(Object.entries(sources).map(([name = '', code = ''] = []) => writeFile(path.join(boundaryDirectory, `${name}.ts`), code)));
        const boundaryProgram = typescript.createProgram(Object.keys(sources).map(name => path.join(boundaryDirectory, `${name}.ts`)), {
            strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext
        });
        assert.deepEqual(boundaryProgram.getSemanticDiagnostics(), []);
        const boundaryLint = new ESLint({ overrideConfigFile: true, overrideConfig: [{ plugins: { resilient },
            linterOptions: { reportUnusedDisableDirectives: 'error' }, rules: { 'resilient/prefer-destructured-member-access': 'error' } }] });
        await Promise.all(Object.entries(sources).map(async ([name = '', code = ''] = []) => {
            const tree = boundaryProgram.getSourceFile(path.join(boundaryDirectory, `${name}.ts`));
            const all = collectSelectedModelContracts({ typescript, sourceFile: tree, checker: boundaryProgram.getTypeChecker() });
            const selectedModelContracts = new Map([...all].filter(([, { source: { provider = '' } = {} } = {}] = []) => provider === 'x'));
            const decisions = compileDestructuringDecisions(collectDestructuringAgreements({ selectedModelContracts }));
            const transformed = typescript.transform(tree, [context => root => annotateRetainedStaticMemberAccess({
                typescript, sourceFile: root, destructuringAgreements: decisions, context
            })]);
            const { transformed: [annotatedTree = {}] = [] } = transformed;
            const printed = typescript.createPrinter().printFile(annotatedTree);
            transformed.dispose();
            const transpile = (input, removeComments = false) => {
                const { outputText = '' } = typescript.transpileModule(input, {
                    compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext, removeComments }
                });

                return outputText;
            };
            const executable = (input) => {
                const parsed = typescript.createSourceFile('native.js', input, typescript.ScriptTarget.Latest, true);
                const { parseDiagnostics = [] } = parsed;
                assert.deepEqual(parseDiagnostics, []);
                const normalized = typescript.transform(parsed, [context => (root) => {
                    const visit = (node) => {
                        const { expression = {} } = node;

                        return typescript.isParenthesizedExpression(node) ? visit(expression) : typescript.visitEachChild(node, visit, context);
                    };

                    return typescript.visitNode(root, visit);
                }]);
                const { transformed: [normalizedTree = {}] = [] } = normalized;
                const printedExecutable = typescript.createPrinter({ removeComments: true }).printFile(normalizedTree);
                normalized.dispose();
                const comparable = typescript.createSourceFile('comparable.js', printedExecutable, typescript.ScriptTarget.Latest, true);

                return normalize(comparable, comparable, false);
            };
            assert.deepEqual(executable(transpile(printed, true)), executable(transpile(code, true)));
            const output = transpile(printed);
            const [findings = {}] = await boundaryLint.lintText(output, { filePath: `${name}-boundary.js` });
            const { messages = [] } = findings;

            if (name === 'complete') assert.deepEqual(messages, []);

            const unknownTargets = messages.filter(({ ruleId = '', line = 0, column = 0, endColumn = 0 } = {}) => (
                ruleId === 'resilient/prefer-destructured-member-access' &&
                output.split('\n').at(line - 1).slice(column - 1, endColumn - 1).includes('y.other')
            ));
            assert.equal(unknownTargets.length, name === 'complete' ? 0 : 1);

            assert.ok(messages.every(({ ruleId = '' } = {}) => ruleId === 'resilient/prefer-destructured-member-access'));
        }));
    } finally {
        await rm(boundaryDirectory, { recursive: true, force: true });
    }
}
