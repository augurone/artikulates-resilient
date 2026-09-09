import assert from 'node:assert/strict';

import typescript from 'typescript';

import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { collectCollectionDecisions } from './typescript-collection-proof.js';
import { lowerFinalGrammar } from '../transforms/typescript/grammar/final.js';
import { lowerCollectionAgreementPlacements } from '../transforms/typescript/lowering/collection-reconstruction.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import {
    getConsumerContractKey
} from '../transforms/typescript/understand/type-evidence.js';

const compile = ({ fileName = '', code = '' } = {}) => {
    const sourceFile = typescript.createSourceFile(fileName, code, typescript.ScriptTarget.ESNext, true);
    const options = { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext, strict: true };
    const host = typescript.createCompilerHost(options);
    const program = typescript.createProgram([fileName], options, {
        ...host,
        getSourceFile: (name, version, ...rest) => name === fileName
            ? sourceFile
            : host.getSourceFile(name, version, ...rest)
    });
    const checker = program.getTypeChecker();
    const contracts = collectCollectionDecisions({ typescript, sourceFile, checker });
    const { code: generated = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program })
        .transform({ code, fileName });

    assert.deepEqual(program.getSemanticDiagnostics(), []);
    assert.deepEqual(diagnostics, []);

    return { contracts, generated };
};
const load = async code => import(`data:text/javascript,${encodeURIComponent(code)}`);
const shadowed = [
    'class Set {',
    '    values: number[] = [];',
    '    add(value: number) { this.values.push(value); return this; }',
    '}',
    'class Map {',
    '    entries: number[] = [];',
    '    set(key: number, value: number) { this.entries.push(key, value); return this; }',
    '}',
    'export const buildSet = (observe: (value: Set) => void) => {',
    '    const result = new Set();',
    '    observe(result);',
    '    result.add(1);',
    '    return result;',
    '};',
    'export const buildMap = (observe: (value: Map) => void) => {',
    '    const result = new Map();',
    '    observe(result);',
    '    result.set(1, 2);',
    '    return result;',
    '};'
].join('\n');
const { contracts: rejectedFacts = new Map(), generated: rejectedOutput = '' } = compile({
    fileName: 'shadowed-collections.ts', code: shadowed
});

assert.equal(rejectedFacts.size, 0, 'A same-named local constructor has no standard collection agreement.');
assert.match(rejectedOutput, /result\.add\(1\)/u);
assert.match(rejectedOutput, /result\.set\(1, 2\)/u);
assert.doesNotMatch(rejectedOutput, /\n\s*result\s*=\s*new (?:Set|Map)/u);

const { outputText: sourceJavaScript = '' } = typescript.transpileModule(shadowed, {
    compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
});
const sourceModule = await load(sourceJavaScript);
const generatedModule = await load(rejectedOutput);
const observe = (module, method = '') => {
    let first;
    const result = module[method]((value) => { first = value; });
    const { values = [], entries = [] } = result;

    return { same: first === result, values: values.length ? values : entries };
};

assert.deepEqual(observe(sourceModule, 'buildSet'), observe(generatedModule, 'buildSet'));
assert.deepEqual(observe(sourceModule, 'buildMap'), observe(generatedModule, 'buildMap'));

const standard = 'export const build = (value: number) => { const result = new Set<number>(); result.add(value); return result; };';
const { contracts: admittedFacts = new Map(), generated: admittedOutput = '' } = compile({
    fileName: 'standard-collection.ts', code: standard
});
const [admitted = {}] = [...admittedFacts.values()];

assert.equal(admittedFacts.size, 1);
assert.equal(admitted.action, 'single-collection-update');
assert.deepEqual([...((await load(admittedOutput)).build(2))], [...((await load(typescript.transpileModule(standard, {
    compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
}).outputText)).build(2))]);

const factorySource = 'function build() { const result = new Set(); result.add(1); return result; }';
const factoryFile = typescript.createSourceFile('collection-factory.ts', factorySource, typescript.ScriptTarget.ESNext, true);
const { statements: [factoryOwner = {}] = [] } = factoryFile;
const { body: factoryBody = {} } = factoryOwner;
const { statements: [factoryBuilder = {}, factoryUpdate = {}] = [] } = factoryBody;
const { declarationList: factoryDeclarationList = {} } = factoryBuilder;
const { declarations: [factoryDeclaration = {}] = [] } = factoryDeclarationList;
const factoryUpdateKey = getConsumerContractKey(factoryUpdate.expression);
const factoryBuilderKey = getConsumerContractKey(factoryDeclaration);
let factoryDescriptors = [];
const tracingFactory = new Proxy(typescript.factory, {
    get(target, property, receiver) {
        const member = Reflect.get(target, property, receiver);

        if (property !== 'createReturnStatement' || typeof member !== 'function') return member;

        return (...args) => new Proxy(member.apply(target, args), {
            defineProperty(candidate, key, descriptor) {
                factoryDescriptors = [...factoryDescriptors, { key, descriptor }];

                return Reflect.defineProperty(candidate, key, descriptor);
            }
        });
    }
});
const tracingTypeScript = Object.create(typescript, { factory: { value: tracingFactory } });
const factoryAgreements = collectDestructuringAgreements({
    collectionReconstructionContracts: new Map([[factoryBuilderKey, {
        action: 'single-collection-update',
        collection: { name: 'result', type: 'Set', mutationSites: [{ key: factoryUpdateKey, method: 'add' }] }
    }]])
});
const { transformed: [factoryPlaced = factoryFile] = [], dispose: disposeFactoryPlacement = false } = typescript.transform(factoryFile, [
    context => node => lowerCollectionAgreementPlacements({
        typescript: tracingTypeScript,
        node,
        destructuringAgreements: compileDestructuringDecisions(factoryAgreements),
        context
    })
]);
const factoryOutput = typescript.createPrinter().printFile(factoryPlaced);

if (typeof disposeFactoryPlacement === 'function') disposeFactoryPlacement();

assert.match(factoryOutput, /return new Set\(\[\.\.\.\[\], 1\]\);/u);
assert.deepEqual(factoryDescriptors, [],
    'Collection placement must not attach internal descriptors to custom compiler-factory results.');

const retained = [
    'export const build = (observe: (value: Set<number>) => void) => {',
    '    const result = new Set<number>();',
    '    observe(result);',
    '    result.add(1);',
    '    return result;',
    '};'
].join('\n');
const { contracts: retainedFacts = new Map(), generated: retainedOutput = '' } = compile({
    fileName: 'retained-collection.ts', code: retained
});
const [retainedFact = {}] = [...retainedFacts.values()];

assert.equal(retainedFact.action, 'retain-collection-boundary');
assert.equal(retainedFact.boundaryReason, 'external-or-escaped');
assert.match(retainedOutput, /eslint-disable-next-line resilient\/prefer-safe-transformations -- Collection identity is observable outside this update/u);
assert.match(retainedOutput, /result\.add\(1\)/u);
assert.doesNotMatch(retainedOutput, /\n\s*result\s*=\s*new Set/u);

const retainedSource = await load(typescript.transpileModule(retained, {
    compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
}).outputText);
const retainedGenerated = await load(retainedOutput);
const observeRetained = (module) => {
    let observed;
    const result = module.build((value) => { observed = value; });

    return { same: result === observed, values: [...observed] };
};

assert.deepEqual(observeRetained(retainedSource), observeRetained(retainedGenerated));

const nested = [
    'export const build = (values: number[]) => {',
    '    const result = new Set<number>();',
    '    values.forEach((value) => { result.add(value); });',
    '    return result;',
    '};'
].join('\n');
const { contracts: nestedFacts = new Map(), generated: nestedOutput = '' } = compile({
    fileName: 'nested-collection.ts', code: nested
});
const [nestedFact = {}] = [...nestedFacts.values()];

assert.equal(nestedFact.action, 'retain-collection-boundary');
assert.equal(nestedFact.collection.mutationSites.length, 1);
assert.match(nestedOutput, /eslint-disable-next-line resilient\/prefer-safe-transformations -- Collection identity is observable outside this update/u);
assert.match(nestedOutput, /result\.add\(value\)/u);
assert.deepEqual([...((await load(nestedOutput)).build([1, 2, 1]))], [1, 2]);

const shadowedNested = [
    'export const build = (values: Set<number>[]) => {',
    '    const result = new Set<number>();',
    '    values.forEach((result) => { result.add(1); });',
    '    return result;',
    '};'
].join('\n');
const { contracts: shadowedNestedFacts = new Map() } = compile({
    fileName: 'shadowed-nested-collection.ts', code: shadowedNested
});
const [outerFact = {}] = [...shadowedNestedFacts.values()];

assert.deepEqual(outerFact.collection.mutationSites, [], 'A same-spelled callback parameter is not the builder symbol.');

const nestedReconstruction = [
    'export const build = (me: ReadonlySet<number>, that: ReadonlySet<number>) => {',
    '    const result = new Set<number>();',
    '    me.forEach((value) => { if (that.has(value)) { result.add(value); } });',
    '    return result;',
    '};'
].join('\n');
const { contracts: nestedReconstructionFacts = new Map(), generated: nestedReconstructionOutput = '' } = compile({
    fileName: 'nested-reconstruction.ts', code: nestedReconstruction
});
const [nestedReconstructionFact = {}] = [...nestedReconstructionFacts.values()];

assert.equal(nestedReconstructionFact.action, 'single-collection-update');
assert.equal(nestedReconstructionFact.collection.mutationSites.length, 1);
assert.match(nestedReconstructionOutput, /result\s*=\s*new Set\(/u);
assert.doesNotMatch(nestedReconstructionOutput, /result\.add\(value\)/u);

const reconstructSource = await load(typescript.transpileModule(nestedReconstruction, {
    compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
}).outputText);
const reconstructGenerated = await load(nestedReconstructionOutput);
const runReconstruction = module => [...module.build(new Set([1, 2, 3]), new Set([2, 3]))];

assert.deepEqual(runReconstruction(reconstructSource), runReconstruction(reconstructGenerated));

const collisionSource = 'function build() { const result = new Set(); result.add(1); return result; }';
const collisionAst = typescript.createSourceFile('collision.ts', collisionSource, typescript.ScriptTarget.ESNext, true);
const { statements: [owner = {}] = [] } = collisionAst;
const { body = {} } = owner;
const { statements: [, update = {}] = [] } = body;
const updateRange = getConsumerContractKey(update.expression);
const claim = key => ({ key, action: 'single-collection-update', collection: {
    name: 'result', type: 'Set', mutationSites: [{ key: updateRange, method: 'add' }]
} });
const agreements = collectDestructuringAgreements({
    collectionReconstructionContracts: new Map([['first', claim('first')], ['second', claim('second')]])
});
const { transformed: [placed = collisionAst] = [], dispose = false } = typescript.transform(collisionAst, [context => node => (
    lowerFinalGrammar({ typescript, sourceFile: node, destructuringAgreements: compileDestructuringDecisions(agreements), context })
)]);
const collisionOutput = typescript.createPrinter().printFile(placed);

if (typeof dispose === 'function') dispose();

assert.match(collisionOutput, /result\.add\(1\)/u, 'Two claims cannot authorize one update.');
assert.doesNotMatch(collisionOutput, /\n\s*result\s*=\s*new Set/u);

const deferredCollection = [
    'export const build = (values: ReadonlySet<number>, pause: () => Promise<void>) => {',
    '    const result = new Set<number>();',
    '    values.forEach(async (value) => { await pause(); result.add(value); });',
    '    return result;',
    '};'
].join('\n');
const { contracts: deferredFacts = new Map(), generated: deferredOutput = '' } = compile({
    fileName: 'deferred-collection.ts', code: deferredCollection
});
const [deferredFact = {}] = [...deferredFacts.values()];
assert.equal(deferredFact.action, 'retain-collection-boundary');
assert.equal(deferredFact.boundaryReason, 'external-or-escaped');
assert.equal(deferredFact.collection.mutationSites.length, 1);
assert.match(deferredOutput, /result\.add\(value\)/u);
assert.doesNotMatch(deferredOutput, /result\s*=\s*new Set\(\[/u);
const deferredSource = await load(typescript.transpileModule(deferredCollection, {
    compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
}).outputText);
const deferredGenerated = await load(deferredOutput);
const observeDeferred = async (module, reject = false) => {
    const values = new Set([0, 2]);
    const failure = new Error('callback rejection');
    let pending = [];
    Object.defineProperty(values, 'forEach', { value: (callback) => {
        Set.prototype.forEach.call(values, (value, key, receiver) => {
            pending = [...pending, callback(value, key, receiver)];
        });
    } });
    const returned = module.build(values, async () => {
        if (reject) throw failure;
    });
    const before = [...returned];
    const outcomes = await Promise.allSettled(pending);

    return { before, after: [...returned], outcomes: outcomes.map(({ status = '', reason = false } = {}) => ({
        status, sameFailure: reason === failure
    })) };
};
const deferredResults = await Promise.all([observeDeferred(deferredSource), observeDeferred(deferredGenerated)]);
assert.deepEqual(deferredResults[0], deferredResults[1]);
assert.deepEqual(deferredResults[1].before, []);
assert.deepEqual(deferredResults[1].after, [0, 2], 'The returned instance receives the updates after microtasks.');
const rejectedDeferred = await Promise.all([observeDeferred(deferredSource, true), observeDeferred(deferredGenerated, true)]);
assert.deepEqual(rejectedDeferred[0], rejectedDeferred[1]);
assert.deepEqual(rejectedDeferred[1].after, []);
assert.ok(rejectedDeferred[1].outcomes.every(({ status = '', sameFailure = false } = {}) => status === 'rejected' && sameFailure));

[
    deferredCollection.replace('async (value) =>', 'async function (value)'),
    deferredCollection.replace('async (value) => { await pause();', 'function* (value) { yield value;')
].forEach((code, index) => {
    const { contracts = new Map(), generated = '' } = compile({ fileName: `non-synchronous-${index}.ts`, code });
    const [{ action = '' } = {}] = [...contracts.values()];
    assert.equal(action, 'retain-collection-boundary');
    assert.match(generated, /result\.add\(value\)/u);
});
