import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ESLint, Linter } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import product from 'eslint-plugin-resilient/eslint';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { lowerFinalGrammar } from '../transforms/typescript/grammar/final.js';
import { lowerCollectionAgreementPlacements } from '../transforms/typescript/lowering/collection-reconstruction.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { getDestructuringAgreement } from '../transforms/typescript/policy/defaults.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import { collectPlacementEvidence } from '../transforms/typescript/understand/placement-evidence.js';
import {
    getConsumerContractKey, collectArrayCardinalityContracts, collectCollectionReconstructionContracts, collectIndexedOperationContracts, collectRepeatedParameterReadContracts,
    collectSortCapabilityContracts, getConsumerBindingContract, isStandardArrayType, collectClosedStructuralModelContracts, collectExactProviderForwardContracts,
    collectLiveArrayVisitationContracts, collectLiveOwnKeyEnumerationContracts, collectLiveSetVisitationContracts, collectLiveWorkQueueContracts, collectLoopCarriedRecurrenceContracts,
    collectNativeClassBoundaryContracts, collectNumericRangeBuilderContracts, collectObservableSetUnionContracts, collectCallableProviderDispatchContracts
} from '../transforms/typescript/understand/type-evidence.js';
import { emissionSyntax } from './support/emission-syntax.js';
import { collectCollectionDecisions } from './typescript-collection-proof.js';

// Native raw/fixed collection and iterator observations establish order, identity, sparse/live visitation, mutation and failures; admission rejections and resource
// bounds remain, strategy labels do not.
const loadShared = async code => import(`data:text/javascript,${encodeURIComponent(code)}`);
const importCodeShared = text => import(`data:text/javascript,${encodeURIComponent(text)}`);

{
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
    const load = loadShared;
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
    const { generated: admittedOutput = '' } = compile({
        fileName: 'standard-collection.ts', code: standard
    });

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
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-collection-observables-'));
    const fileName = path.join(directory, 'collections.ts');
    const source = [
        'export const remove = (source: Map<number, string>, getKey: () => number) => {',
        '    const output = new Map(source);',
        '    output.delete(getKey());',
        '    return output;',
        '};',
        'export const removeNamed = (source: Map<number, string>, entryKey: number) => {',
        '    const output = new Map(source);',
        '    output.delete(entryKey);',
        '    return output;',
        '};',
        'export const buildSet = (values: number[], visit: (value: number) => number) => {',
        '    const output = new Set<number>();',
        '    for (const value of values) output.add(visit(value));',
        '    return output;',
        '};',
        'export const buildMap = (entries: [number, number][], visit: (value: number) => number) => {',
        '    const output = new Map<number, number>();',
        '    for (const [key, value] of entries) {',
        '        if (visit(value) > 0) output.set(key, visit(value));',
        '    }',
        '    return output;',
        '};',
        'export const materialized = (source: Set<number>, outputValues: number) => {',
        '    const output = new Set<number>();',
        '    for (const value of [...source]) output.add(value + outputValues);',
        '    return output;',
        '};',
        ''
    ].join('\n');

    try {
        await writeFile(fileName, source);
        const program = typescript.createProgram([fileName], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
            code: source, fileName
        });
        const { outputText: reference = '' } = typescript.transpileModule(source, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const load = async text => import(`data:text/javascript,${encodeURIComponent(text)}`);
        const baseline = await load(reference);
        const lowered = await load(code);
        const observeDelete = (remove, entries, key) => {
            let events = [];
            const input = Object.defineProperty(new Map(entries), Symbol.iterator, {
                *value() {
                    events = [...events, 'copy'];
                    yield* Map.prototype[Symbol.iterator].call(this);
                }
            });
            const output = remove(input, () => {
                events = [...events, 'key'];

                return key;
            });

            return { entries: [...output], input: [...Map.prototype.entries.call(input)], events };
        };
        const observeSet = (buildSet) => {
            const values = [1, 2];
            let visits = [];
            const output = buildSet(values, (value) => {
                visits = [...visits, value];

                if (value === 1) {
                    // eslint-disable-next-line resilient/prefer-safe-transformations -- The regression observes the source array iterator visiting a callback append.
                    values.push(3);
                }

                return value * 2;
            });

            return { entries: [...output], visits };
        };
        const observeMap = (buildMap) => {
            const entries = [[1, 1], [2, 2]];
            let visits = [];
            const output = buildMap(entries, (value) => {
                visits = [...visits, value];

                if (visits.length === 1) {
                    // eslint-disable-next-line resilient/prefer-safe-transformations -- The guarded Map regression requires an append to the traversed source array.
                    entries.push([3, 3]);
                }

                return value;
            });

            return { entries: [...output], visits };
        };
        const prove = ({ remove, removeNamed, buildSet,
            buildMap, materialized } = {}) => {
            if (typeof remove !== 'function' ||
                typeof removeNamed !== 'function' ||
                typeof buildSet !== 'function' ||
                typeof buildMap !== 'function' ||
                typeof materialized !== 'function') throw new TypeError('Expected compiled callable exports');

            [[], [[1, 'one']], [[1, 'one'], [2, 'two']], [[Number.NaN, 'nan'], [0, 'zero']]]
                .forEach((entries) => {
                    [1, Number.NaN, -0].forEach((key) => {
                        assert.deepEqual(observeDelete(remove, entries, key),
                            observeDelete(baseline.remove, entries, key));
                        assert.deepEqual([...removeNamed(new Map(entries), key)],
                            [...baseline.removeNamed(new Map(entries), key)]);
                    });
                });
            const failure = new Error('key failure');

            assert.throws(() => remove(new Map(), () => { throw failure; }), error => error === failure);
            assert.deepEqual(observeSet(buildSet), observeSet(baseline.buildSet));
            assert.deepEqual(observeMap(buildMap), observeMap(baseline.buildMap));
            assert.deepEqual([...materialized(new Set([1, 2]), 10)], [11, 12]);
            let events = [];
            const values = Object.defineProperty([1, 2], Symbol.iterator, {
                *value() {
                    try {
                        events = [...events, 'next'];
                        yield 1;
                        events = [...events, 'unreachable'];
                        yield 2;
                    } finally {
                        events = [...events, 'close'];
                    }
                }
            });

            assert.throws(() => buildSet(values, () => {
                events = [...events, 'visit'];
                throw failure;
            }), error => error === failure);
            assert.deepEqual(events, ['next', 'visit', 'close']);
        };

        assert.deepEqual(diagnostics, []);
        prove(lowered);
        assert.match(code, /output\.delete\(getKey\(\)\)/);
        assert.match(code, /for \(const value of values\)/);
        assert.doesNotMatch(code, /Array\.from\(values\)|Array\.from\(entries\)/);
        const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
        const [raw = {}] = await new ESLint({ overrideConfigFile: true,
            overrideConfig: config }).lintText(code, { filePath: 'collection-observables-generated.js' });
        const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
            overrideConfig: config }).lintText(code, { filePath: 'collection-observables-generated.js' });

        assert.equal(raw.errorCount, 0, JSON.stringify(raw.messages));
        assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));
        prove(await load(fixed.output || code));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-general-array-tree-'));
    const source = [
        'type Hierarchy<A> = { value: A; forest: readonly Hierarchy<A>[] };',
        'const pipe = <A, B>(input: A, stage: (input: A) => B): B => stage(input);',
        'export const reduce = <A>(seed: number, combine: (seed: number, value: A) => number) => (node: Hierarchy<A>): number => {',
        '    let result = combine(seed, node.value);',
        '    const bound = node.forest.length;',
        '    for (let index = 0; index < bound; index++) {',
        '        result = pipe(node.forest[index], reduce(result, combine));',
        '    }',
        '    return result;',
        '};',
        'export const reduceOutbound = <A>(seed: number, combine: (value: A, seed: number) => number) => (node: Hierarchy<A>): number => {',
        '    let result = seed;',
        '    const bound = node.forest.length;',
        '    for (let index = bound - 1; index >= 0; index--) {',
        '        result = pipe(node.forest[index], reduceOutbound(result, combine));',
        '    }',
        '    return combine(node.value, result);',
        '};'
    ].join('\n');
    const rename = { Hierarchy: 'Hierarchy', pipe: 'applyStage', reduce: 'foldForward', reduceOutbound: 'foldBackward',
        node: 'input', value: 'datum', forest: 'branches', index: 'position', bound: 'limit', result: 'state' };
    // Coordinated AST renames change program data and helper bindings together.
    const neutralTree = typescript.transform(typescript.createSourceFile('rename.ts', source, typescript.ScriptTarget.Latest, true), [context => (file) => {
        const visit = (node) => {
            const { text = '' } = node;
            const { [text]: replacement = '' } = rename;

            if (typescript.isIdentifier(node) && replacement) return typescript.factory.createIdentifier(replacement);

            return typescript.visitEachChild(node, visit, context);
        };

        return typescript.visitNode(file, visit);
    }]);
    const neutral = typescript.createPrinter().printFile(neutralTree.transformed[0]);
    neutralTree.dispose();
    const collision = [
        'const pipe = (value: number, stage: (value: number) => number): number => stage(value);',
        'const reduce = (seed: number, combine: (seed: number, value: number) => number) => (value: number): number => combine(seed, value);',
        'export const probe = (values: readonly number[], combine: (seed: number, value: number) => number): number => {',
        '    let result = 0;',
        '    const len = 1;',
        '    for (let i = 0; i < len; i++) { result = pipe(values[i], reduce(result, combine)); }',
        '    return result;',
        '};'
    ].join('\n');
    const cases = { tree: source, neutral, collision, alias: collision.replaceAll('pipe', 'applyStage'),
        factory: 'export const probe = (copy: () => number[], value: number): number[] => { const output = copy(); output.push(value); return output; };',
        factoryNeutral: 'export const probe = (produce: () => number[], value: number): number[] => { const output = produce(); output.push(value); return output; };',
        splice: 'export const probe = (produce: () => number[], value: number): number[] => { const output = produce(); output.splice(0, 1, value); return output; };',
        sort: 'export const probe = (produce: () => number[], compare: (a: number, b: number) => number): number[] => { const output = produce(); output.sort(compare); return output; };',
        collectionArgument:
                'export const probe = (input: { items: number[] }, receiver: { baseValue: (items: number[]) => boolean }): number => receiver.baseValue(input.items) ? 0 : input.items.length;' };
    const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
    const rawLint = new ESLint({ overrideConfigFile: true, overrideConfig: config });
    const fixedLint = new ESLint({ fix: true, overrideConfigFile: true, overrideConfig: config });
    const importCode = importCodeShared;
    const factsFor = (program, fileName) => {
        const options = { typescript, checker: program.getTypeChecker(), sourceFile: program.getSourceFile(fileName) };
        const cardinality = collectArrayCardinalityContracts(options);
        const repeated = collectRepeatedParameterReadContracts(options);
        const indexed = collectIndexedOperationContracts(options);
        const decisions = compileDestructuringDecisions(collectDestructuringAgreements({ arrayCardinalityContracts: cardinality,
            repeatedParameterReadContracts: repeated, indexedOperationContracts: indexed }));

        return { cardinality, repeated, indexed, decisions };
    };
    // Ranges, source spellings and generated aliases are representation data.
    const normalized = ({ cardinality = new Map(), repeated = new Map(), indexed = new Map(), decisions = {} } = {}) => ({
        cardinality: [...cardinality.values()].map(({ action = '', readPhase = '', absence = '', failureOwner = '' }) => ({ action, readPhase, absence, failureOwner })),
        repeated: [...repeated.values()].map(({ action = '', valueFamily = '', readRanges = [], absence = '', failureOwner = '' }) => ({
            action, valueFamily, reads: readRanges.length, absence, failureOwner
        })),
        indexed: [...indexed.values()].map(({ action = '', operationRole = '' }) => ({ action, operationRole })),
        decisions: [...decisions.byKey.values()].flat().map(({ agreement: { action = '', state = '' } = {} }) => ({ action, state }))
    });

    try {
        await Promise.all(Object.entries(cases).map(([name = '', text = '']) => writeFile(path.join(directory, `${name}.ts`), text)));
        const files = Object.keys(cases).map(name => path.join(directory, `${name}.ts`));
        const program = typescript.createProgram(files, { strict: true, module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext });

        assert.deepEqual(program.getSemanticDiagnostics(), []);
        assert.deepEqual(normalized(factsFor(program, files[0])), normalized(factsFor(program, files[1])));
        assert.deepEqual(normalized(factsFor(program, files[2])), normalized(factsFor(program, files[3])));
        const treeFacts = factsFor(program, files[0]);

        assert.equal(treeFacts.cardinality.size, 2);
        assert.equal(treeFacts.repeated.size, 4);
        assert.equal([...treeFacts.indexed.values()].filter(({ action = '' }) => action === 'retain-indexed-array-traversal').length, 2);
        const transformed = new Map();
        // eslint-disable-next-line resilient/prefer-prototype-methods -- Sequential transforms share one Program and compare three executable versions per source.
        for (const [name = '', text = ''] of Object.entries(cases)) {
            const fileName = path.join(directory, `${name}.ts`);
            const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({ code: text, fileName });
            const [raw = {}] = await rawLint.lintText(code, { filePath: `${name}-generated.js` });
            const [fixed = {}] = await fixedLint.lintText(code, { filePath: `${name}-generated.js` });
            const { outputText: native = '' } = typescript.transpileModule(text, {
                compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
            });
            const modules = await Promise.all([native, code, fixed.output || code].map(importCode));

            assert.deepEqual(diagnostics, []);
            assert.doesNotMatch(code, /\.(?:reduce|reduceOutbound)\(/);

            assert.equal(raw.errorCount, 0, JSON.stringify(raw.messages));
            assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));

            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private proof results preserve the three executable modules for each source case.
            transformed.set(name, { modules, raw, fixed, code });
        }

        const observeTree = (module, neutralNames = false, mode = 'changing', backward = false) => {
            const field = neutralNames ? 'branches' : 'forest';
            const data = neutralNames ? 'datum' : 'value';
            const names = neutralNames ? ['foldForward', 'foldBackward'] : ['reduce', 'reduceOutbound'];
            const { [Number(backward)]: fold = '' } = names;
            const failure = new Error('later collection Get');
            let trace = [];
            let reads = 0;
            const leaf = value => ({ [data]: value, [field]: [] });
            const first = [leaf(2), leaf(3)];
            const second = [leaf(5), leaf(7)];
            // The iterator and prototype reduction must remain unobserved.
            Object.defineProperty(first, Symbol.iterator, { get() { throw new Error('iterator acquired'); } });
            Object.defineProperty(first, 'reduce', { get() { throw new Error('native reduce acquired'); } });
            Object.defineProperty(first, 'reduceOutbound', { get() { throw new Error('native reduceOutbound acquired'); } });
            const input = { [data]: 1 };
            /* eslint-disable resilient/signature-contract-return-consistency -- The native getter fixture deliberately returns arrays, null and undefined to compare consuming failures. */
            Object.defineProperty(input, field, { get() {
                reads += 1;
                trace = [...trace, `get:${reads}`, this === input ? 'receiver' : 'wrong receiver'];

                if (mode === 'throw' && reads === 3) throw failure;

                // eslint-disable-next-line resilient/prefer-falsey-returns -- Missing collection must preserve the original consuming length failure.
                if (mode === 'missing') return undefined;

                // eslint-disable-next-line resilient/prefer-falsey-returns -- Null collection must preserve the original consuming length failure.
                if (mode === 'null') return null;

                if (mode === 'sparse') return Array(2);

                return reads === 1 ? first : second;
            } });
            /* eslint-enable resilient/signature-contract-return-consistency */
            let result;
            let error = {};
            const combine = (a, b) => {
                trace = [...trace, `combine:${a}:${b}`];

                return a + b;
            };

            try { result = module[fold](0, combine)(input); } catch (caught) { error = caught; }

            const { name: errorName = '' } = error;

            return { result, trace, reads, errorName, sameFailure: error === failure };
        };

        ['tree', 'neutral'].forEach((name) => {
            const { modules = [] } = transformed.get(name);
            const [original = {}] = modules;

            ['changing', 'throw', 'missing', 'null', 'sparse'].forEach(mode => [false, true].forEach((backward) => {
                const expected = observeTree(original, name === 'neutral', mode, backward);

                modules.slice(1).forEach(module => assert.deepEqual(observeTree(module, name === 'neutral', mode, backward), expected));
            }));
        });
        ['collision', 'alias'].forEach((name) => {
            const { modules = [] } = transformed.get(name);

            modules.forEach(({ probe }) => {
                if (typeof probe !== 'function') throw new TypeError('Expected compiled callable exports');

                let calls = [];
                const combine = (seed, value) => {
                    calls = [...calls, value];

                    return seed + value;
                };

                assert.equal(probe([1, 2, 3], combine), 1, 'An unrelated helper cannot replace the authored bound.');
                assert.deepEqual(calls, [1]);
            });
        });
        const { modules: argumentModules = [], code: argumentCode = '' } = transformed.get('collectionArgument');
        const observeArgument = ({ probe } = {}, throwing = false) => {
            if (typeof probe !== 'function') throw new TypeError('Expected compiled callable exports');

            let trace = [];
            let reads = 0;
            const marker = new Error('second argument collection Get');
            const input = {};
            Object.defineProperty(input, 'items', { get() {
                reads += 1;
                trace = [...trace, `get ${reads}`, this === input ? 'receiver' : 'wrong receiver'];

                if (throwing && reads === 2) throw marker;

                return reads === 1 ? [1] : [2, 3];
            } });
            const receiver = { baseValue(items) {
                trace = [...trace, `baseValue ${items.length}`, this === receiver ? 'call receiver' : 'wrong call receiver'];

                return false;
            } };
            let result;
            let error;

            try { result = probe(input, receiver); } catch (caught) { error = caught; }

            return { result, reads, trace, sameFailure: error === marker };
        };
        const [argumentOriginal = {}] = argumentModules;

        assert.doesNotMatch(argumentCode, /Argument Get keeps source timing and failure/);
        [false, true].forEach((throwing) => {
            const expected = observeArgument(argumentOriginal, throwing);

            argumentModules.slice(1).forEach(module => assert.deepEqual(observeArgument(module, throwing), expected));
        });
        const factoryFacts = name => [...collectCollectionReconstructionContracts({
            typescript, checker: program.getTypeChecker(), sourceFile: program.getSourceFile(path.join(directory, `${name}.ts`))
        }).values()].map(({ action = '', theorem = '', collection: { type = '', freshness = '', updates = 0, returns = 0 } = {} }) => ({ action, theorem, type, freshness, updates, returns }));

        assert.deepEqual(factoryFacts('factory'), factoryFacts('factoryNeutral'));
        assert.deepEqual(factoryFacts('factory'), [{ action: 'retain-collection-boundary', theorem: 'source-array-result-identity',
            type: 'Array', freshness: 'unknown', updates: 1, returns: 1 }]);
        const observeFactory = ({ probe } = {}) => {
            if (typeof probe !== 'function') throw new TypeError('Expected compiled callable exports');

            const input = [1];
            let trace = [];
            Object.defineProperty(input, 'push', { get() {
                trace = [...trace, 'get push'];

                // eslint-disable-next-line no-restricted-syntax -- The retained push oracle must observe the collection receiver after property acquisition.
                return function push(value) {
                    trace = [...trace, this === input ? 'receiver' : 'wrong receiver', value];

                    return 100;
                };
            } });
            const result = probe(() => input, 3);

            return { same: result === input, values: Array.from(result), trace };
        };
        const factory = transformed.get('factory');
        const factoryNeutral = transformed.get('factoryNeutral');

        assert.deepEqual(factory.raw.messages.map(({ ruleId = '', messageId = '' }) => ({ ruleId, messageId })),
            factoryNeutral.raw.messages.map(({ ruleId = '', messageId = '' }) => ({ ruleId, messageId })));
        [factory, factoryNeutral].forEach(({ modules = [] }) => {
            const [original = {}] = modules;
            const expected = observeFactory(original);

            modules.slice(1).forEach(module => assert.deepEqual(observeFactory(module), expected));
            const { same = false } = expected;

            assert.equal(same, true);
        });
        ['splice', 'sort'].forEach((name) => {
            const { modules = [], code = '' } = transformed.get(name);
            const observe = ({ probe } = {}, overridden = false) => {
                if (typeof probe !== 'function') throw new TypeError('Expected compiled callable exports');

                const input = [3, 1, 2];
                let trace = [];
                const failure = new Error('mutation lookup');

                if (overridden) Object.defineProperty(input, name, { get() {
                    trace = [...trace, `get ${name}`, this === input ? 'get receiver' : 'wrong get receiver'];

                    // eslint-disable-next-line no-restricted-syntax -- The throwing operation oracle verifies the retained method receives the original input receiver.
                    return function retained(...args) {
                        trace = [...trace, this === input ? 'call receiver' : 'wrong call receiver', args.length];

                        throw failure;
                    };
                } });

                const compare = (inbound, outbound) => {
                    trace = [...trace, `compare ${inbound}:${outbound}`];

                    return inbound - outbound;
                };
                let result;
                let error;

                try { result = probe(() => input, name === 'sort' ? compare : 9); } catch (caught) { error = caught; }

                return { same: result === input, values: Array.from(input), trace, sameFailure: error === failure };
            };
            const [original = {}] = modules;

            assert.doesNotMatch(code, /\.(?:toSpliced|toSorted)\(/);
            assert.deepEqual(factoryFacts(name), factoryFacts('factory'));
            [false, true].forEach((overridden) => {
                const expected = observe(original, overridden);
                const { values = [], sameFailure = false, same = false } = expected;
                const mutationValues = name === 'sort' ? [1, 2, 3] : [9, 1, 2];

                modules.slice(1).forEach(module => assert.deepEqual(observe(module, overridden), expected));
                assert.deepEqual(values, overridden ? [3, 1, 2] : mutationValues);
                assert.equal(overridden ? sameFailure : same, true);
            });
        });

        const arrayCases = {
            inherited: 'interface Sequence<A> extends Array<A> { 0: A }',
            intersection: 'type Sequence<A> = readonly A[] & { readonly 0: A };',
            tuple: 'type Sequence<A> = readonly [A, ...A[]];',
            alias: 'type Sequence<A> = readonly A[];',
            collision: 'interface RequiredSequence<A> { length: number; 0: A; [index: number]: A; map: (f: (x: A) => A) => A[]; toSorted: (f: (a: A, b: A) => number) => A[] }',
            custom: 'interface Bag<A> { length: number; 0: A; [index: number]: A; map: (f: (x: A) => A) => A[]; toSorted: (f: (a: A, b: A) => number) => A[] }'
        };
        const arrayFiles = Object.entries(arrayCases).map(([name = '', definition = '']) => {
            const { [name]: family = 'Sequence' } = { collision: 'RequiredSequence', custom: 'Bag' };
            const parameters = `items: ${family}<number>, provider: { compare: (a: number, b: number) => number }`;

            return { name, file: path.join(directory, `array-${name}.ts`), text: [definition,
                `export const size = (${parameters}) => { const len = items.length; return items.map(provider.compare); };`,
                `export const sorted = (${parameters}) => items.toSorted(provider.compare);`
            ].join('\n') };
        });
        await Promise.all(arrayFiles.map(({ file = '', text = '' }) => writeFile(file, text)));
        const arrayProgram = typescript.createProgram(arrayFiles.map(({ file = '' }) => file), {
            strict: true, module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext
        });
        arrayFiles.forEach(({ name = '', file = '' }) => {
            const options = { typescript, checker: arrayProgram.getTypeChecker(), sourceFile: arrayProgram.getSourceFile(file) };
            const evidence = collectPlacementEvidence(options);
            const { facts = new Map() } = evidence;
            const members = [...facts].filter(([node = {}]) => {
                const { text = '' } = node;

                return typescript.isIdentifier(node) && text === 'items';
            });
            const expected = !['collision', 'custom'].includes(name);
            const cardinality = collectArrayCardinalityContracts(options);
            const sort = collectSortCapabilityContracts(options);
            let consumers = [];
            const visit = (node) => {
                if (typescript.isCallExpression(node)) {
                    const { arguments: [argument = {}] = [] } = node;
                    consumers = [...consumers, getConsumerBindingContract({ ...options, call: node, argument })];
                }

                typescript.forEachChild(node, visit);
            };
            const { sourceFile = {} } = options;
            visit(sourceFile);

            assert.ok(members.length > 1);
            assert.ok(members.every(([, { arrayLike = false } = {}]) => arrayLike === expected));
            assert.equal(cardinality.size > 0, expected);
            assert.equal(sort.size > 0, expected);
            assert.equal(consumers.some(fact => Object.keys(fact).length), expected);
        });
        const lookalikeLibrary = path.join(directory, 'lib.lookalike.d.ts');
        const lookalikeConsumer = path.join(directory, 'lookalike.ts');
        await writeFile(lookalikeLibrary, ['Array', 'ReadonlyArray', 'Bag'].map(name => `export interface ${name}<A> { length: number; 0: A }`).join('\n'));
        await writeFile(lookalikeConsumer, [
            'import type { Array, ReadonlyArray, Bag } from "./lib.lookalike";',
            ...['Array', 'ReadonlyArray', 'Bag'].map(name => `export const size${name} = (items: ${name}<number>) => { const len = items.length; return len; };`)
        ].join('\n'));
        const lookalikeProgram = typescript.createProgram([lookalikeLibrary, lookalikeConsumer], {
            strict: true, module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext
        });
        const lookalikeOptions = { typescript, checker: lookalikeProgram.getTypeChecker(),
            sourceFile: lookalikeProgram.getSourceFile(lookalikeConsumer) };
        const { sourceFile: lookalikeSource = {} } = lookalikeOptions;
        let lookalikeParameters = [];
        const findLookalikes = (node) => {
            if (typescript.isParameter(node)) lookalikeParameters = [...lookalikeParameters, node];

            typescript.forEachChild(node, findLookalikes);
        };
        findLookalikes(lookalikeSource);

        assert.deepEqual(lookalikeProgram.getSemanticDiagnostics(), []);
        assert.equal(lookalikeParameters.length, 3);
        lookalikeParameters.forEach(({ name = {} }) => assert.equal(isStandardArrayType({ ...lookalikeOptions, candidate: name }), false));
        assert.equal(collectArrayCardinalityContracts(lookalikeOptions).size, 0);
        const keyCases = {
            native: 'export const sorted = (provider: { compare: (a: string, b: string) => number }, input: object) => Object.keys(input).sort(provider.compare);',
            shadow: ['type Bag = { sort: (compare: (a: string, b: string) => number) => string[] };',
                'export const sorted = (Object: { keys: (input: object) => Bag }, provider: { compare: (a: string, b: string) => number }, input: object) =>',
                '    Object.keys(input).sort(provider.compare);'
            ].join('\n')
        };
        await Promise.all(Object.entries(keyCases).map(([name = '', text = '']) => writeFile(path.join(directory, `keys-${name}.ts`), text)));
        const keysProgram = typescript.createProgram(Object.keys(keyCases).map(name => path.join(directory, `keys-${name}.ts`)), {
            strict: true, module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext
        });
        Object.keys(keyCases).forEach((name) => {
            const contracts = collectSortCapabilityContracts({ typescript, checker: keysProgram.getTypeChecker(),
                sourceFile: keysProgram.getSourceFile(path.join(directory, `keys-${name}.ts`)) });

            assert.equal(contracts.size, name === 'native' ? 1 : 0);
        });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

{
    const { rules: { 'prefer-safe-transformations': mutations = {}, 'prefer-signature-destructuring': signature = {} } = {} } = product;

    const compile = (code = '', extra = {}) => {
        const fileName = '/virtual/deletion.ts';
        const sourceFile = typescript.createSourceFile(fileName, code, typescript.ScriptTarget.ESNext, true);
        const options = { strict: true, skipLibCheck: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext };
        const host = typescript.createCompilerHost(options);
        const sources = { [fileName]: sourceFile, ...extra };
        const virtualFile = (name = '') => {
            const { [name]: file = false } = sources;

            return file;
        };
        const program = typescript.createProgram([...Object.keys(sources), typescript.getDefaultLibFilePath(options)], options, {
            ...host,
            directoryExists: name => name === '/virtual' || host.directoryExists(name),
            fileExists: name => Boolean(virtualFile(name)) || host.fileExists(name),
            readFile: (name) => {
                const { text = '' } = virtualFile(name);

                return text || host.readFile(name);
            },
            getSourceFile: (name, version) => virtualFile(name) || host.getSourceFile(name, version)
        });
        const compilerMessages = typescript.getPreEmitDiagnostics(program).map(({ messageText = '' } = {}) => typescript.flattenDiagnosticMessageText(messageText, '\n'));
        assert.deepEqual(compilerMessages, [], 'The checker fixture must resolve without errors.');
        const checker = program.getTypeChecker();
        const collection = collectCollectionReconstructionContracts({ typescript, sourceFile, checker });
        const structural = collectClosedStructuralModelContracts({ typescript, sourceFile, checker });
        const decisions = compileDestructuringDecisions(collectDestructuringAgreements({ typescript,
            collectionReconstructionContracts: collection, closedStructuralModels: structural }));
        const result = createTypeScriptTransformer({ typescript, program }).transform({ code, fileName });
        const { diagnostics = [] } = result;
        assert.deepEqual(diagnostics, []);

        return { ...result, collection, structural, decisions };
    };
    const source = family => `export const run = (invoke: (callback: (item: ${family}<string, number>) => void) => void) => invoke(item => { item.set('k', 1); });`;
    ['Map', 'Bag'].forEach((name) => {
        const { collection = new Map(), decisions = {} } = compile(`export interface ${name}<K, V> { set(key: K, value: V): void } ${source(name)}`);
        assert.equal(collection.size, 0, name);
        assert.equal(decisions.byKind.has('collection-reconstruction'), false);
    });
    const counterfeit = '/virtual/lib.lookalike.d.ts';
    const { collection: counterfeitFacts = new Map() } = compile(`import { Map } from './lib.lookalike'; ${source('Map')}`, {
        [counterfeit]: typescript.createSourceFile(counterfeit, 'export interface Map<K, V> { set(key: K, value: V): void }', typescript.ScriptTarget.ESNext, true)
    });
    assert.equal(counterfeitFacts.size, 0);
    ['Map', 'ReadonlyMap'].forEach((family) => {
        const method = family === 'Map' ? 'set' : 'get';
        const { collection = new Map() } = compile(source(family).replace("item.set('k', 1)", `item.${method}('k'${method === 'set' ? ', 1' : ''})`));
        assert.equal([...collection.values()].some(({ collection: { type = '' } = {} } = {}) => type === 'Map'), family === 'Map');
    });
    ['type Neutral<K, V> = Map<K, V>', 'interface Neutral<K, V> extends Map<K, V> {}', 'type Neutral<K, V> = Map<K, V> & { marker: true }'].forEach((declaration) => {
        const { collection = new Map() } = compile(`${declaration}; ${source('Neutral')}`);
        assert.ok([...collection.values()].some(({ collection: { type = '' } = {} } = {}) => type === 'Map'));
    });
    const linter = new Linter();
    const find = code => linter.verify(code, [{ plugins: { resilient }, rules: { 'resilient/prefer-safe-destructuring-defaults': 'error' } }]);
    const nominal = 'const read = (opaque, A, isFunction) => { const { value, forest = [] } = opaque(); const { concat } = A.getIdentityProvider(); if '
        + '(!isFunction(concat)) return { value, forest: [] }; return opaque(); };';
    const renamed = nominal.replaceAll('value', 'datum').replaceAll('forest', 'branches').replaceAll('concat', 'combine')
        .replaceAll('getIdentityProvider', 'provide').replaceAll('A', 'Provider').replaceAll('isFunction', 'callable');
    [nominal, renamed].forEach((code) => {
        const messages = find(code);
        assert.ok(messages.some(({ messageId = '', column = 0 } = {}) => messageId === 'safeDefault' && column === code.indexOf(code === nominal ? 'value,' : 'datum,') + 1));
    });
    [
        'const read = input => { const isObject = () => true; const source = isObject(input) ? input : {}; if ((isObject(input) && '
            + 'Reflect.has(input, "value")) === false) {} const { value } = source; return value; };',
        'const read = input => { const isObject = () => true; const { value } = isObject(input) ? input : {}; if (!value) return { value }; return value; };'
    ].forEach(code => assert.ok(find(code).some(({ messageId = '' } = {}) => messageId === 'safeDefault')));
    const behaviorSource = 'export const edit = (items: number[], offset: () => number, count: () => number) => { return items.splice(offset(), count()); }; export '
        + 'const order = (items: number[], compare: (a: number, b: number) => number) => { return items.sort(compare); };';
    const { code: raw = '', collection: facts = new Map(), decisions = {} } = compile(behaviorSource);
    assert.doesNotMatch(raw, /toSpliced|toSorted/u);
    assert.ok([...facts.values()].every(({ theorem = '' } = {}) => theorem === 'source-collection-operation'));
    assert.ok(decisions.byKind.get('collection-reconstruction').every(({ agreement: { action = '' } = {} } = {}) => action === 'retain-collection-boundary'));
    const { outputText: original = '' } = typescript.transpileModule(behaviorSource,
        { compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext } });
    const fixedResult = linter.verifyAndFix(raw, [{ plugins: { resilient: { rules: { 'prefer-safe-transformations': mutations } } }, rules: { 'resilient/prefer-safe-transformations': 'error' } }]);
    const load = importCodeShared;
    const { output: fixed = '', messages: fixedMessages = [] } = fixedResult;
    assert.deepEqual(fixedMessages, []);
    const modules = await Promise.all([original, raw, fixed].map(load));
    const observe = ({ edit, order } = {}, mode = '') => {
        if (typeof edit !== 'function' || typeof order !== 'function') throw new TypeError('Expected compiled callable exports');

        let events = [];
        const marker = new Error('exact thrown marker');
        const items = [3, 1, 2];
        const { splice: originalSplice = false } = Object(items);
        Object.defineProperty(items, 'splice', { get() {
            events = [...events, 'method'];

            if (mode === 'method-throw') throw marker;

            // eslint-disable-next-line no-restricted-syntax -- Native splice forwarding must preserve the acquired method receiver and arguments.
            return function splice(...args) {
                events = [...events, this === items ? 'receiver' : 'wrong-receiver'];

                if (mode === 'call-throw') throw marker;

                return originalSplice.apply(this, args);
            };
        } });
        const offset = () => {
            events = [...events, 'offset'];

            if (mode === 'argument-throw') throw marker;

            return 1;
        };
        const count = () => {
            events = [...events, 'count'];

            return 1;
        };
        try {
            const removed = edit(items, offset, count);
            const sorted = order(items, (a, b) => a - b);

            return { items, removed, sameReceiver: sorted === items, events };
        } catch (error) {
            return { events, exactMarker: error === marker };
        }
    };
    ['normal', 'method-throw', 'argument-throw', 'call-throw'].forEach((mode) => {
        const expected = observe(modules[0], mode);
        const { events: observedEvents = [], exactMarker = false } = expected;
        assert.deepEqual(observedEvents, { normal: ['method', 'offset', 'count', 'receiver'], 'method-throw': ['method'],
            'argument-throw': ['method', 'offset'], 'call-throw': ['method', 'offset', 'count', 'receiver'] }[mode]);

        if (mode === 'normal') assert.deepEqual(expected, { items: [2, 3], removed: [1], sameReceiver: true, events: ['method', 'offset', 'count', 'receiver'] });

        if (mode !== 'normal') assert.equal(exactMarker, true);

        modules.slice(1).forEach(module => assert.deepEqual(observe(module, mode), expected));
    });
    const resultModel = 'type Model<A> = { datum: A; children: A[] }; export const read = <A>(produce: () => Model<A>) => { const { datum, children = [] } = produce(); return { datum, children }; };';
    const { code: modelCode = '', structural = new Map() } = compile(resultModel);
    assert.ok([...structural.values()].some(({ property = '' } = {}) => property === 'datum'));
    assert.match(emissionSyntax(modelCode), /datum = void 0/u);
    const { code: authoredCode = '' } = compile(resultModel.replace('datum, children', 'datum = undefined, children'));
    assert.match(authoredCode, /datum = undefined/u);
    const reconstruct = 'type Model<A> = { peek: A; pos: number }; export const read = <A>(owner: Model<A>) => ({ peek: owner.peek, pos: owner.pos });';
    const named = compile(reconstruct);
    const neutralSource = reconstruct.replaceAll('peek', 'data').replaceAll('pos', 'loc').replaceAll('owner', 'input').replaceAll('Model', 'Thing');
    const neutral = compile(neutralSource);
    const serialize = value => JSON.stringify(value, (key, item) => {
        if (item instanceof Map || item instanceof Set) return [...item];

        return item;
    });
    const rename = value => serialize(value).replaceAll('peek', 'data').replaceAll('pos', 'loc');
    const { structural: namedFacts = new Map(), decisions: namedDecisions = {}, code: namedCode = '' } = named;
    const { structural: neutralFacts = new Map(), decisions: neutralDecisions = {}, code: neutralCode = '' } = neutral;
    assert.ok(namedFacts.size > 0);
    assert.equal(rename(namedFacts), serialize(neutralFacts), 'Equal-width coordinated names preserve complete source ranges and facts.');
    assert.equal(rename(namedDecisions), serialize(neutralDecisions), 'Complete decisions preserve the same source ownership.');
    const modelModes = await Promise.all([reconstruct, neutralSource].map(async (code, index) => {
        const emitted = index ? neutralCode : namedCode;
        const { output = '', messages = [] } = linter.verifyAndFix(emitted,
            [{ plugins: { resilient }, rules: { 'resilient/prefer-safe-destructuring-defaults': 'error' } }]);
        assert.deepEqual(messages, []);
        const { outputText = '' } = typescript.transpileModule(code,
            { compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext } });

        return Promise.all([outputText, emitted, output].map(load));
    }));
    modelModes.forEach((variants, index) => {
        const fields = index ? ['data', 'loc'] : ['peek', 'pos'];
        const observeModel = ({ read } = {}, throwing = false) => {
            if (typeof read !== 'function') throw new TypeError('Expected compiled callable exports');

            let events = [];
            const marker = new Error('field marker');
            const input = Object.fromEntries(fields.map(field => [field, 1]));
            fields.forEach(field => Object.defineProperty(input, field, { get() {
                events = [...events, field];

                if (throwing) throw marker;

                return 1;
            } }));
            try { return { result: read(input), events }; } catch (error) { return { events, exactMarker: error === marker }; }
        };
        [false, true].forEach((throwing) => {
            const [sourceModule = {}] = variants;
            const expected = observeModel(sourceModule, throwing);
            const { events = [], exactMarker = false } = expected;
            const [first = ''] = fields;
            assert.deepEqual(events, throwing ? [first] : fields);

            if (throwing) assert.equal(exactMarker, true);

            variants.slice(1).forEach(variant => assert.deepEqual(observeModel(variant, throwing), expected));
        });
    });

    const nativeLibrary = typescript.getDefaultLibFilePath({}).replace(/[^/]+$/u, '') + 'lib.authored.d.ts';
    const { collection: authoredNativeFacts = new Map() } = compile(`import { Map } from '${nativeLibrary.replace(/\.d\.ts$/u, '')}'; ${source('Map')}`, {
        [nativeLibrary]: typescript.createSourceFile(nativeLibrary,
            '/// <reference no-default-lib="true"/>\nexport interface Map<K,V>{set(key:K,value:V):void}', typescript.ScriptTarget.ESNext, true)
    });
    assert.equal(authoredNativeFacts.size, 0);
    [
        'first: effect() + input.first, second: input.second',
        'first: input.first + effect(), second: input.second',
        'first: () => input.first, second: () => input.second',
        'first: ((input: { first: number }) => input.first)({first: 1}), second: input.second',
        'second: input.second, first: input.first'
    ].forEach((members) => {
        const { structural: rejected = new Map() } = compile('declare const effect: () => number; '
            + `export const read = (input: { first: number; second: number }) => ({ ${members} });`);
        assert.equal(rejected.size, 0, members);
    });
    [
        '{ datum: A; children: A[]; extra?: number }',
        '{ datum: A; children: A[] } | { datum: A; children: A[]; extra: number }',
        '{ datum: A; children: A[]; [key: string]: unknown }',
        '{ datum?: A; children: A[] }'
    ].forEach((model) => {
        const { structural: rejected = new Map() } = compile(resultModel.replace('{ datum: A; children: A[] }', model));
        assert.equal(rejected.size, 0, model);
    });
    const siblingSource = 'export const edit=(items: number[], other: {splice:()=>number})=>{return [items.splice(0,1),other.splice()];};';
    const { code: siblingRaw = '' } = compile(siblingSource);
    const siblingMessages = linter.verify(siblingRaw, [{ plugins: { resilient: { rules: { 'prefer-safe-transformations': mutations } } },
        rules: { 'resilient/prefer-safe-transformations': 'error' } }]);
    assert.equal(siblingMessages.length, 2, 'Retaining one call must not suppress a sibling operation.');

    const collisionSource = 'export const edit=(item: {splice:()=>unknown;sort:()=>unknown})=>{item.splice();return item.sort();};';
    const { code: collisionRaw = '', collection: collisionFacts = new Map() } = compile(collisionSource);
    assert.equal(collisionFacts.size, 0);
    assert.doesNotMatch(collisionRaw, /toSpliced|toSorted/u);
    const { outputText: collisionOriginal = '' } = typescript.transpileModule(collisionSource,
        { compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext } });
    const collisionModules = await Promise.all([collisionOriginal, collisionRaw].map(load));
    collisionModules.forEach(({ edit } = {}) => {
        if (typeof edit !== 'function') throw new TypeError('Expected compiled callable exports');

        let events = [];
        const marker = {};
        const item = { splice() { events = [...events, this === item ? 'splice' : 'wrong']; },
            sort() {
                events = [...events, this === item ? 'sort' : 'wrong'];

                return marker;
            } };
        assert.equal(edit(item), marker);
        assert.deepEqual(events, ['splice', 'sort']);
    });
    const collisionMessages = linter.verify(collisionRaw, [{ plugins: { resilient: { rules: { 'prefer-safe-transformations': mutations } } },
        rules: { 'resilient/prefer-safe-transformations': 'error' } }]);
    assert.equal(collisionMessages.length, 2, 'Opaque collisions remain visible; no native collection fact authorizes an exemption.');

    const nestedSource = 'export const edit=(items: Map<number,unknown>, other: {splice:()=>number})=>{return items.set(0,other.splice());};';
    const { code: nestedRaw = '' } = compile(nestedSource);
    const nestedMessages = linter.verify(nestedRaw, [{ plugins: { resilient: { rules: { 'prefer-safe-transformations': mutations } } },
        rules: { 'resilient/prefer-safe-transformations': 'error' } }]);
    assert.deepEqual(nestedMessages.map(({ ruleId = '', severity = 0, messageId = '', line = 0, column = 0, endColumn = 0 } = {}) => [
        ruleId, severity, messageId, nestedRaw.split('\n')[line - 1].slice(column - 1, endColumn - 1)
    ]), [['resilient/prefer-safe-transformations', 2, 'mutation', 'other.splice()']],
    'A retained native callee cannot suppress the exact unknown mutation in its argument.');
    const nestedSuppressed = linter.getSuppressedMessages();
    assert.equal(nestedSuppressed.length, 1, 'Only the checker-owned native callee is retained.');
    assert.match(nestedSuppressed[0].message, /"items"/u);
    assert.equal(nestedSuppressed[0].suppressions[0].justification, 'Source call retains receiver identity and native mutation.');
    const callableModel = 'type Model<A>={peek:()=>A;pos:A}; export const read=<A>(input:Model<A>)=>({peek:input.peek,pos:input.pos});';
    const { structural: callableFacts = new Map(), decisions: callableDecisions = {} } = compile(callableModel);
    const { structural: renamedCallableFacts = new Map(), decisions: renamedCallableDecisions = {} }
        = compile(callableModel.replaceAll('peek', 'data').replaceAll('pos', 'loc').replaceAll('input', 'owner').replaceAll('Model', 'Thing'));
    assert.equal(rename(callableFacts), serialize(renamedCallableFacts));
    assert.equal(rename(callableDecisions), serialize(renamedCallableDecisions));
    [
        'owner.pos=value',
        'owner.peek=owner.peek',
        '(owner.peek)()',
        'owner.peek`text`',
        'new owner.peek()'
    ].forEach((operation) => {
        const { structural: rejected = new Map() } = compile('type Model<A>={pos:A;peek:{():A;new():object;(strings:TemplateStringsArray):A}}; '
            + `export const read=<A>(owner:Model<A>,value:A)=>${operation};`);
        assert.equal(rejected.size, 0, 'A write or invocation is not a forwarded field value Get: ' + operation);
    });

    const deferredReceiverSource = 'type Cell<A>={read:(key:A)=>number;point:A}; '
        + 'export const preserve=<A>(owner:Cell<A>)=>({read:(key:A)=>owner.read(key),point:owner.point});';
    const { code: deferredReceiverRaw = '' } = compile(deferredReceiverSource);
    const { output: deferredReceiverFixed = '', messages: deferredReceiverMessages = [] } = linter.verifyAndFix(deferredReceiverRaw,
        [{ plugins: { resilient }, rules: { 'resilient/prefer-safe-destructuring-defaults': 'error', 'resilient/prefer-signature-destructuring': 'error' } }]);
    assert.deepEqual(deferredReceiverMessages, []);
    const { outputText: deferredReceiverOriginal = '' } = typescript.transpileModule(deferredReceiverSource,
        { compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext } });
    const deferredReceiverModules = await Promise.all([deferredReceiverOriginal, deferredReceiverRaw, deferredReceiverFixed].map(load));
    deferredReceiverModules.forEach(({ preserve } = {}) => {
        if (typeof preserve !== 'function') throw new TypeError('Expected compiled callable exports');

        ['normal', 'point-throw', 'read-throw'].forEach((mode) => {
            let events = [];
            const marker = new Error('deferred receiver marker');
            const owner = { get point() {
                events = [...events, 'point'];

                if (mode === 'point-throw') throw marker;

                return 1;
            }, get read() {
                events = [...events, 'read'];

                if (mode === 'read-throw') throw marker;

                // eslint-disable-next-line no-restricted-syntax -- The provider oracle checks that lookup followed by invocation preserves its owner receiver.
                return function read(key) {
                    assert.equal(this, owner);
                    events = [...events, 'receiver'];

                    return key + 1;
                };
            } };

            if (mode === 'point-throw') {
                assert.throws(() => preserve(owner), error => error === marker);
                assert.deepEqual(events, ['point']);

                return;
            }

            const result = preserve(owner);
            const { point = 0 } = result;
            assert.equal(point, 1);
            assert.deepEqual(events, ['point'], 'The callable Get remains deferred until invocation.');

            if (mode === 'read-throw') assert.throws(() => result.read(2), error => error === marker);

            if (mode === 'normal') assert.equal(result.read(2), 3);

            assert.deepEqual(events, mode === 'read-throw' ? ['point', 'read'] : ['point', 'read', 'receiver']);
        });
    });

    const repeatedDeferredSource = 'type Cell<A>={read:()=>A;point:A}; '
        + 'export const preserve=<A>(owner:Cell<A>)=>({read:()=>owner.point,point:owner.point});';
    const { code: repeatedDeferredRaw = '' } = compile(repeatedDeferredSource);
    const { output: repeatedDeferredFixed = '', messages: repeatedDeferredMessages = [] } = linter.verifyAndFix(repeatedDeferredRaw,
        [{ plugins: { resilient }, rules: { 'resilient/prefer-safe-destructuring-defaults': 'error', 'resilient/prefer-signature-destructuring': 'error' } }]);
    assert.deepEqual(repeatedDeferredMessages, []);
    const { outputText: repeatedDeferredOriginal = '' } = typescript.transpileModule(repeatedDeferredSource,
        { compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext } });
    const repeatedDeferredModules = await Promise.all([repeatedDeferredOriginal, repeatedDeferredRaw, repeatedDeferredFixed].map(load));
    repeatedDeferredModules.forEach(({ preserve } = {}) => {
        if (typeof preserve !== 'function') throw new TypeError('Expected compiled callable exports');

        let events = [];
        const first = {};
        const second = {};
        const marker = new Error('repeated deferred marker');
        const owner = { get point() {
            events = [...events, 'point'];

            if (events.length === 3) throw marker;

            return events.length === 1 ? first : second;
        }, read() {} };
        const { point = false, read } = preserve(owner);

        if (typeof read !== 'function') throw new TypeError('Expected the deferred reader');

        assert.equal(point, first);
        assert.deepEqual(events, ['point']);
        assert.equal(read(), second);
        assert.deepEqual(events, ['point', 'point']);
        assert.throws(read, error => error === marker);
        assert.deepEqual(events, ['point', 'point', 'point']);
    });

    const templateSource = 'export const label = (items: number[], compare: (a:number,b:number)=>number, separator:()=>string) => '
        + '{ return `prefix:${items.sort(compare).join(separator())}:suffix`; };';
    const { code: templateRaw = '', collection: templateFacts = new Map(), decisions: templateDecisions = {} } = compile(templateSource);
    const renamedTemplateSource = templateSource.replaceAll('items', 'stock').replaceAll('label', 'stamp');
    const { collection: renamedTemplateFacts = new Map(), decisions: renamedTemplateDecisions = {} } = compile(renamedTemplateSource);
    assert.equal(serialize(templateFacts).replaceAll('items', 'stock').replaceAll('label', 'stamp'), serialize(renamedTemplateFacts));
    assert.equal(serialize(templateDecisions).replaceAll('items', 'stock').replaceAll('label', 'stamp'), serialize(renamedTemplateDecisions));
    assert.ok([...templateFacts.values()].some(({ collection: { expressionBoundary = false } = {} } = {}) => expressionBoundary));
    const mutationProfile = [{ plugins: { resilient: { rules: { 'prefer-safe-transformations': mutations } } },
        rules: { 'resilient/prefer-safe-transformations': 'error' } }];
    const { output: templateFixed = '', messages: templateMessages = [] } = linter.verifyAndFix(templateRaw, mutationProfile);
    assert.deepEqual(templateMessages, []);
    assert.doesNotMatch(templateRaw, /toSorted/u);
    const { outputText: templateOriginal = '' } = typescript.transpileModule(templateSource,
        { compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext } });
    const templateModules = await Promise.all([templateOriginal, templateRaw, templateFixed].map(load));
    let templateObservations = [];
    templateModules.forEach(({ label } = {}) => {
        if (typeof label !== 'function') throw new TypeError('Expected compiled callable exports');

        let observations = [];
        ['normal', 'sort-get', 'sort-call', 'index-get', 'compare', 'join-get', 'separator', 'join-call'].forEach((mode) => {
            let events = [];
            const marker = new Error('template exact marker');
            const items = [3, 1, 2];
            const result = [9];
            const step = (name) => {
                events = [...events, name];

                if (name === mode) throw marker;
            };

            if (mode === 'index-get') Object.defineProperty(items, '0', { get() { step('index-get');

                return 0; } });

            Object.defineProperty(items, 'sort', { get() {
                step('sort-get');

                // eslint-disable-next-line no-restricted-syntax -- Sorting must invoke the acquired method with the input receiver before forwarding its result.
                return function sort(compare) {
                    assert.equal(this, items);
                    step('sort-call');
                    Array.prototype.sort.call(this, compare);

                    return result;
                };
            } });
            Object.defineProperty(result, 'join', { get() {
                step('join-get');

                // eslint-disable-next-line no-restricted-syntax -- Joining must invoke the acquired method with the sort result receiver.
                return function join(separator) {
                    assert.equal(this, result);
                    assert.equal(separator, ', ');
                    step('join-call');

                    return 'joined';
                };
            } });
            const compare = (inbound, outbound) => {
                step('compare');

                return inbound - outbound;
            };
            const separator = () => {
                step('separator');

                return ', ';
            };

            if (mode === 'normal') {
                assert.equal(label(items, compare, separator), 'prefix:joined:suffix');
                assert.deepEqual(items, [1, 2, 3]);
            }

            if (mode !== 'normal') assert.throws(() => label(items, compare, separator), error => error === marker);

            const prefix = ['sort-get', 'sort-call', mode === 'index-get' ? 'index-get' : 'compare'];
            const expected = [...prefix, 'compare', 'compare', 'compare', 'join-get', 'separator', 'join-call'];
            // Exact complete traces are also compared across the three forms.
            assert.deepEqual(events.slice(0, Math.min(events.length, prefix.length)), prefix.slice(0, Math.min(events.length, prefix.length)));

            if (mode === 'normal') assert.deepEqual(events.filter(event => event !== 'compare'), expected.filter(event => event !== 'compare'));

            if (mode !== 'normal') assert.equal(events.at(-1), mode);

            observations = [...observations, { mode, events }];
        });
        templateObservations = [...templateObservations, observations];
    });
    assert.deepEqual(templateObservations[1], templateObservations[0]);
    assert.deepEqual(templateObservations[2], templateObservations[0]);
    const neighborSource = 'export const label=(items:number[],other:{sort:()=>string})=>`'
        + '${items.sort().join(",")}:${other.sort()}`;';
    const { code: neighborRaw = '' } = compile(neighborSource);
    const neighborMessages = linter.verify(neighborRaw, mutationProfile);
    assert.equal(neighborMessages.length, 1);
    assert.equal(neighborMessages[0].messageId, 'mutation');
    assert.equal(neighborRaw.slice(neighborRaw.indexOf('other.sort'), neighborRaw.indexOf('other.sort') + 12), 'other.sort()');
    assert.deepEqual(linter.getSuppressedMessages().map(({ messageId = '' } = {}) => messageId), ['mutation']);
    assert.equal(linter.verify('const retain = input => { const { point = undefined } = input; return key => input.read(key); };',
        [{ plugins: { probe: { rules: { signature } } }, rules: { 'probe/signature': 'error' } }]).length, 0);

    [
        '/* eslint-disable resilient/prefer-safe-transformations -- authored owner */ export const label=(items:number[],other:number[])=>'
            + '`' + '${items.sort().join(",")}:${other.splice(0,1)}`; /* eslint-enable resilient/prefer-safe-transformations */',
        'export const label=(items:number[])=>{\n// eslint-disable-next-line resilient/prefer-safe-transformations -- authored owner\n'
            + 'return `' + '${items.sort().join(",")}`;}',
        'export const label=(items:number[])=>{\nreturn `' + '${items.sort().join(",")}`; // eslint-disable-line resilient/prefer-safe-transformations -- authored owner\n}'
    ].flatMap(source => [source, source.replaceAll('resilient/prefer-safe-transformations -- authored owner',
        '"resilient/prefer-safe-transformations" --- authored owner'),
    source.replaceAll('resilient/prefer-safe-transformations -- authored owner', ', , -- authored owner')]).forEach((source) => {
        const { code: retained = '' } = compile(source);
        const messages = linter.verify(retained, mutationProfile);
        assert.deepEqual(messages, [], 'An authored boundary retains its targets without a redundant generated scope.');
    });

    // A slice spelling is not freshness evidence. The public entry retains only
    // checked array operations, and the exception owns that call rather than peers.
    const sliceForms = [
        { parameter: 'values: number[]', body: 'values.slice().reverse()', native: true },
        { parameter: 'custom: { slice(): { reverse(): unknown } }', body: 'custom.slice().reverse()', native: false },
        { parameter: 'custom: any', body: 'custom.slice().reverse()', native: false }
    ];
    // eslint-disable-next-line resilient/prefer-prototype-methods -- Await each module before observing the shared linter's next source form.
    for (const form of sliceForms) {
        const { parameter = '', body = '', native = false } = form;
        const source = `export const run = (${parameter}) => ${body};`;
        const { code: emitted = '', collection = new Map() } = compile(source);
        assert.doesNotMatch(emitted, /fresh slice/u);
        assert.equal(collection.size, Number(native));
        assert.ok([...collection.values()].every(({ collection: { freshness = '' } = {} } = {}) => freshness === 'unknown'));
        const active = linter.verify(emitted, mutationProfile);
        assert.equal(active.length, Number(!native));
        assert.equal(linter.getSuppressedMessages().length, Number(native));
        const { output: fixed = '', messages = [] } = linter.verifyAndFix(emitted, mutationProfile);
        assert.equal(messages.length, Number(!native));
        const { outputText: original = '' } = typescript.transpileModule(source,
            { compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext } });
        const variants = await Promise.all([original, emitted, fixed].map(load));
        ['normal', 'slice-get', 'slice-call', 'reverse-get', 'reverse-call'].forEach((mode) => {
            const observe = ({ run } = {}) => {
                if (typeof run !== 'function') throw new TypeError('Expected compiled callable exports');

                let events = [];
                const marker = new Error(mode);
                const values = [3, 1, 2];
                const input = native ? values : { values };
                // Even a checked array can have a slice override returning itself.
                Object.defineProperty(input, 'slice', { get() {
                    events = [...events, 'slice-get'];

                    if (mode === 'slice-get') throw marker;

                    // eslint-disable-next-line no-restricted-syntax -- The slice override oracle checks receiver identity before returning the original input.
                    return function slice() {
                        events = [...events, this === input ? 'slice-call' : 'wrong-receiver'];

                        if (mode === 'slice-call') throw marker;

                        return input;
                    };
                } });
                Object.defineProperty(input, 'reverse', { get() {
                    events = [...events, 'reverse-get'];

                    if (mode === 'reverse-get') throw marker;

                    // eslint-disable-next-line no-restricted-syntax -- The reverse override oracle must observe and return its actual invocation receiver.
                    return function reverse() {
                        events = [...events, this === input ? 'reverse-call' : 'wrong-receiver'];

                        if (mode === 'reverse-call') throw marker;

                        Array.prototype.reverse.call(values);

                        return this;
                    };
                } });
                try { return { same: run(input) === input, values: [...values], events }; }
                catch (error) { return { exactMarker: error === marker, values: [...values], events }; }
            };
            const [reference = {}] = variants;
            const expected = observe(reference);
            const { events: expectedEvents = [], same = false, exactMarker = false } = expected;
            assert.deepEqual(expectedEvents, ['slice-get', 'slice-call', 'reverse-get', 'reverse-call'].slice(0,
                mode === 'normal' ? 4 : ['slice-get', 'slice-call', 'reverse-get', 'reverse-call'].indexOf(mode) + 1));
            assert.equal(mode === 'normal' ? same : exactMarker, true);
            variants.slice(1).forEach(variant => assert.deepEqual(observe(variant), expected));
        });
        variants.forEach(({ run } = {}) => {
            if (typeof run !== 'function') throw new TypeError('Expected compiled callable exports');

            const values = Object.defineProperty([3, 1], 'length', { value: 3 });
            const result = run(values);
            assert.notEqual(result, values);
            // eslint-disable-next-line resilient/no-undefined-assignment -- The deletion oracle preserves holes as native undefined values during array iteration and reversal.
            assert.deepEqual([...values], [3, 1, undefined]);
            // eslint-disable-next-line resilient/no-undefined-assignment -- The deletion oracle preserves holes as native undefined values during array iteration and reversal.
            assert.deepEqual([...result], [undefined, 1, 3]);
            assert.deepEqual(Object.keys(values), ['0', '1']);
            assert.deepEqual(Object.keys(result), ['1', '2']);

            if (native) {
                let constructions = [];
                const input = [3, 1, 2];
                // eslint-disable-next-line no-restricted-syntax -- Native slice invokes Symbol.species as a constructor; arrows and object methods are not constructible.
                Object.defineProperty(input, 'constructor', { value: { [Symbol.species]: function Species(length) {
                    constructions = [...constructions, length];

                    return input;
                } } });
                assert.equal(run(input), input, 'Native slice species can return an existing array.');
                assert.deepEqual(input, [2, 1, 3]);
                assert.deepEqual(constructions, [3]);
            }
        });
    }
    // eslint-disable-next-line resilient/prefer-prototype-methods -- Await each emitted module after inspecting its shared-linter suppression targets.
    for (const body of ['{ return values.slice().reverse(); }', '{ const result = values.slice().reverse(); return result; }',
        '{ values.slice().reverse(); }']) {
        const { code = '' } = compile(`export const run = (values: number[]) => ${body};`);
        assert.deepEqual(linter.verify(code, mutationProfile), []);
        assert.equal(linter.getSuppressedMessages().length, 1);
        const { run = false } = await load(code);
        assert.deepEqual(run([3, 1, 2]), body.includes('return') ? [2, 1, 3] : undefined);
    }
    const { code: siblingSlice = '' } = compile('export const run = (values: number[], other: any) => [values.slice().reverse(), other.reverse()];');
    assert.equal(linter.verify(siblingSlice, mutationProfile).length, 1);
    assert.equal(linter.getSuppressedMessages().length, 1);
    const { code: nestedSlice = '' } = compile('export const run = (values: number[], other: any) => values.slice(other.reverse()).reverse();');
    assert.equal(linter.verify(nestedSlice, mutationProfile).length, 2);
    assert.equal(linter.getSuppressedMessages().length, 0);
    // eslint-disable-next-line resilient/prefer-prototype-methods -- Await each native negative-end module before inspecting the next shared-linter target.
    for (const body of ['values.slice(0, -1).reverse()', '[...values.slice(0, -1).reverse()]',
        'values.length === 1 ? values : [...values.slice(0, -1).reverse()]']) {
        const { code = '' } = compile(`export const run = (values: readonly number[]) => ${body};`);
        assert.deepEqual(linter.verify(code, [...mutationProfile, { rules: { 'max-len': ['error', { code: 200 }] } }]), []);
        assert.equal(linter.getSuppressedMessages().length, 1);
        const { run = false } = await load(code);
        assert.deepEqual(run([1, 2, 3]), [2, 1]);
        const single = [1];
        assert.deepEqual(run(single), body.includes('length') ? single : []);
    }
    const { collection: updateSliceFacts = new Map() } = compile(
        'export const run = (values: number[], start: number) => values.slice(++start).reverse();'
    );

    assert.ok([...updateSliceFacts.values()].every(({ collection: { annotationOwned = true } = {} } = {}) => !annotationOwned));
    const { code: optionalSlice = '', collection: optionalSliceFacts = new Map() } = compile(
        'export const run = (values: number[] | undefined) => values?.slice().reverse();'
    );
    assert.equal(optionalSliceFacts.size, 0);
    assert.equal(linter.verify(optionalSlice, mutationProfile).length, 1);
    const { code: uncheckedSlice = '' } = createTypeScriptTransformer({ typescript }).transform({
        code: 'export const run = (values: number[]) => values.slice().reverse();'
    });
    assert.equal(linter.verify(uncheckedSlice, mutationProfile).length, 1, 'Unchecked syntax cannot borrow array evidence.');
    const recipeSource = 'export const run = (values: Map<string, number>) => { const result = new Map(values); result.set("x", 1); return result; };';
    const { code: recipe = '', collection: recipeFacts = new Map() } = compile(recipeSource);
    assert.ok([...recipeFacts.values()].some(({ collection: { freshness = '' } = {} } = {}) => freshness === 'copy'));
    assert.deepEqual(linter.verify(recipe, mutationProfile), []);
    const { output: recipeFixed = '' } = linter.verifyAndFix(recipe, mutationProfile);
    const { outputText: recipeOriginal = '' } = typescript.transpileModule(recipeSource,
        { compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext } });
    // eslint-disable-next-line resilient/prefer-prototype-methods -- Await each source/raw/fixed module before checking its fresh result identity.
    for (const code of [recipeOriginal, recipe, recipeFixed]) {
        const { run = false } = await load(code);
        const input = new Map([['a', 2]]);
        const result = run(input);
        assert.notEqual(result, input);
        assert.deepEqual([...input], [['a', 2]]);
        assert.deepEqual([...result], [['a', 2], ['x', 1]]);
    }
}

{
    const cases = [
        ['named', 'function combineAll(M:{baseValue:number},isMissing:()=>boolean){return isMissing()?M.baseValue:2;}', 1],
        ['neutral', 'function resolve(provider:{identity:number},choose:()=>boolean){return choose()?provider.identity:2;}', 1],
        ['local', 'function read(flag:boolean){const p={unit:1};return flag?p.unit:2;}', 1],
        ['arrow', 'const read=(p:{unit:number},flag:boolean)=>flag?p.unit:2;', 1],
        ['parenthesized', 'function read(p:{unit:number},flag:boolean){return (flag?p.unit:2);}', 1],
        ['generic', 'function read<T>(p:{unit:T},next:()=>T,flag:boolean){return flag?p.unit:next();}', 1],
        ['getter', 'function read(p:{readonly unit:number},flag:boolean){return flag?p.unit:2;}', 1],
        ['union', 'function read(p:{kind:"a";unit:number}|{kind:"b";unit:number},flag:boolean){return flag?p.unit:2;}', 1],
        ['optional', 'function read(p:{unit?:number},flag:boolean){return flag?p.unit:2;}', 0],
        ['missing', 'function read(p:{},flag:boolean){return flag?p.unit:2;}', 0],
        ['any', 'function read(p:any,flag:boolean){return flag?p.unit:2;}', 0],
        ['unknown-field', 'function read(p:{unit:unknown},flag:boolean){return flag?p.unit:2;}', 0],
        ['any-field', 'function read(p:{unit:any},flag:boolean){return flag?p.unit:2;}', 0],
        ['any-sibling', 'function read(p:{unit:number},next:any,flag:boolean){return flag?p.unit:next;}', 0],
        ['unknown-sibling', 'function read(p:{unit:number},next:unknown,flag:boolean){return flag?p.unit:next;}', 0],
        ['never-sibling', 'function read(p:{unit:number},next:()=>never,flag:boolean){return flag?p.unit:next();}', 0],
        ['incompatible', 'function read(p:{unit:number},flag:boolean){return flag?p.unit:"bad";}', 0],
        ['mixed-sibling', 'function read(p:{unit:number},next:number|string,flag:boolean){return flag?p.unit:next;}', 0],
        ['open', 'function read(p:{unit:number}|{kind:"other"},flag:boolean){return flag?p.unit:2;}', 0],
        ['index-only', 'function read(p:{[key:string]:number},flag:boolean){return flag?p.unit:2;}', 0],
        ['operand', 'function read(p:{unit:number},flag:boolean){return 1+(flag?p.unit:2);}', 0],
        ['argument', 'function read(p:{unit:number},f:(n:number)=>number,flag:boolean){return f(flag?p.unit:2);}', 0],
        ['declaration', 'function read(p:{unit:number},flag:boolean){const result=flag?p.unit:2;return result;}', 0],
        ['shadow-absence', 'function read(p:{unit:number},flag:boolean,undefined:number){return flag?p.unit:2;}', 0],
        ['optional-chain', 'function read(p:{unit:number},flag:boolean){return flag?p?.unit:2;}', 0],
        ['misleading', 'function combineAll(M:{baseValue?:number},isInbound:()=>boolean){return isInbound()?M.baseValue:2;}', 0]
    ];
    const sources = new Map(cases.map(([name = '', code = ''] = []) => [name + '.ts', typescript.createSourceFile(name + '.ts', 'export {};\n' + code, typescript.ScriptTarget.ESNext, true)]));
    const options = { strict: true, target: typescript.ScriptTarget.ESNext };
    const host = typescript.createCompilerHost(options);
    const program = typescript.createProgram([...sources.keys()], options, {
        ...host, getSourceFile: (name, version) => sources.get(name) || host.getSourceFile(name, version)
    });
    const checker = program.getTypeChecker();
    const facts = cases.map(([name = '', , count = 0] = []) => {
        const sourceFile = sources.get(name + '.ts');
        const contracts = collectExactProviderForwardContracts({ typescript, sourceFile, checker });
        const terminal = [...contracts.values()].filter(({ placement = '' } = {}) => placement === 'terminal-field');
        assert.equal(terminal.length, count, name);
        const decisions = compileDestructuringDecisions(collectDestructuringAgreements({ exactProviderForwards: contracts }));
        terminal.forEach(({ key = '', member = '', readPhase = '', siblingRange = '', terminalRange = '' } = {}) => {
            assert.ok(member && siblingRange && terminalRange, name);
            assert.equal(readPhase, 'source-member');
            const indexedDecisions = decisions.byKey.get(key) || [];
            const [decision = {}] = indexedDecisions;
            const { agreement: { action = '', canonical = '' } = {} } = decision;
            assert.equal(action, 'exact-provider-forward');
            assert.equal(canonical, 'undefined');
        });

        return { terminal, completed: terminal.flatMap(({ key = '' } = {}) => (decisions.byKey.get(key) || []).map(({ agreement = {} } = {}) => agreement)) };
    });
    const normalize = values => values.map(({ action = '', placement = '', consumer = [], canonical = '', readPhase = '', evidence = [] } = {}) => (
        { action, placement, consumer, canonical, readPhase, evidence }
    ));
    const [{ terminal: named = [], completed: namedDecisions = [] } = {}, { terminal: neutral = [], completed: neutralDecisions = [] } = {}] = facts;
    assert.deepEqual(normalize(named), normalize(neutral), 'Coordinated names preserve source facts.');
    const normalizeDecisions = values => values.map(({ sourceRange = '', relatedRanges = [], ...decision } = {}) => ({
        ...decision, sourceRange: sourceRange ? 'source-member' : '', relatedRanges: relatedRanges.map(() => 'source-member')
    }));
    assert.deepEqual(normalizeDecisions(namedDecisions), normalizeDecisions(neutralDecisions), 'Coordinated names preserve completed decisions.');

    const linter = new Linter();
    const config = [{ plugins: { resilient }, rules: {
        'resilient/prefer-destructured-member-access': 'error', 'resilient/prefer-safe-destructuring-defaults': 'error'
    } }];
    const observe = async (text = '') => {
        const resolved = ['object', 'array', 'function'].reduce((result, module) => result.replaceAll(
            `eslint-plugin-resilient/standard/${module}`, import.meta.resolve(`eslint-plugin-resilient/standard/${module}`)
        ), text);
        const { default: observation = '' } = await import(`data:text/javascript,${encodeURIComponent(resolved)}`);

        return observation;
    };
    const modes = ['present', 'missing', 'undefined', 'null', 'getter-throw', 'predicate-throw', 'argument-throw', 'sibling-throw', 'skipped', 'deferred'];
    await Promise.all(['baseValue', 'identity'].flatMap(member => modes.map(async (mode) => {
        const source = [
            'const events:string[]=[];const marker={};const token={};',
            `function read<T>(provider:{${member}:T},gate:{choose:(a:number,b:number)=>boolean},first:()=>number,second:()=>number,next:()=>T){`,
            `return gate.choose(first(),second())?provider.${member}:next();}`,
            `const mode=${JSON.stringify(mode)};let count=0;`,
            `const provider=mode==='null'?null:mode==='missing'?{}:{get ${member}(){events.push('get');count++;if(mode==='getter-throw')throw marker;`,
            "return mode==='undefined'||mode==='deferred'&&count>1?undefined:token;}};",
            "const first=()=>{events.push('argument1');return 1;};const second=()=>{events.push('argument2');if(mode==='argument-throw')throw marker;return 2;};",
            "const gate={choose(a,b){events.push(this===gate&&a===1&&b===2?'predicate':'bad receiver/args');if(mode==='predicate-throw')throw marker;",
            "return !['skipped','sibling-throw'].includes(mode);}};",
            "const next=()=>{events.push('sibling');if(mode==='sibling-throw')throw marker;return token;};",
            'let result;let error;try{',
            "if(mode==='deferred'){const later=()=>read(provider,gate,first,second,next);events.push('created');result=later();later();}else result=read(provider,gate,first,second,next);",
            '}catch(failure){error=failure;}',
            "export default JSON.stringify({events,count,identity:result===token,missing:result===undefined,marker:error===marker,errorName:error?.name});"
        ].join('\n');
        const { outputText: native = '' } = typescript.transpileModule(source, { compilerOptions: options });
        const fileName = member + '-' + mode + '.ts';
        const sourceFile = typescript.createSourceFile(fileName, source, typescript.ScriptTarget.ESNext, true);
        const runtimeProgram = typescript.createProgram([fileName], options, {
            ...host, getSourceFile: (name, version) => name === fileName ? sourceFile : host.getSourceFile(name, version)
        });
        const transformer = createTypeScriptTransformer({ typescript, program: runtimeProgram });
        const { code = '', diagnostics = [], agreements = [] } = transformer.transform({ code: source, fileName: member + '-' + mode + '.ts' });
        assert.deepEqual(diagnostics, [], mode);
        assert.ok(agreements.some(({ action = '' } = {}) => action === 'exact-provider-forwarded'), mode);
        const { output: fixed = code, messages = [] } = linter.verifyAndFix(code, config);
        assert.deepEqual(messages, [], mode);
        const expected = await observe(native);
        const { events = [], count = 0, marker = false, errorName = '', identity = false, missing = false } = JSON.parse(expected);
        const prefix = ['argument1', 'argument2'];
        const called = mode === 'argument-throw' ? prefix : [...prefix, 'predicate'];
        const expectedEvents = ['argument-throw', 'predicate-throw', 'null', 'missing'].includes(mode) ? called
            : [...called, ['skipped', 'sibling-throw'].includes(mode) ? 'sibling' : 'get'];
        assert.deepEqual(events, mode === 'deferred' ? ['created', ...expectedEvents, ...expectedEvents] : expectedEvents);
        assert.equal(count, events.filter(event => event === 'get').length);
        assert.equal(marker, mode.endsWith('throw'));
        assert.equal(errorName, mode === 'null' ? 'TypeError' : '');
        assert.equal(identity, ['present', 'skipped', 'deferred'].includes(mode));
        assert.equal(missing, !identity);
        assert.equal(await observe(code), expected, member + ':' + mode + ':raw');
        assert.equal(await observe(fixed), expected, member + ':' + mode + ':fixed');
    })));
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-indexed-array-loop-'));
    const fileName = path.join(directory, 'indexed-array.ts');
    const source = [
        'export const firstIndex = (values: ReadonlyArray<number>, predicate: (value: number) => boolean) => {',
        '    for (let i = 0; i < values.length; i += 1) {',
        '        if (predicate(values[i])) return i;',
        '    }',
        '    return -1;',
        '};',
        ''
    ].join('\n');

    try {
        await writeFile(fileName, source);
        const program = typescript.createProgram([fileName], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const facts = collectIndexedOperationContracts({
            typescript, sourceFile: program.getSourceFile(fileName), checker: program.getTypeChecker()
        });
        const [loopFact = {}] = [...facts.values()].filter(({ operationRole = '' } = {}) => (
            operationRole === 'indexed-array-traversal'
        ));

        assert.ok(loopFact.loopRange);

        const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
            code: source, fileName
        });

        assert.deepEqual(diagnostics, []);
        assert.match(code, /for \(let i = 0; i < values\.length; i \+= 1\)/);
        assert.match(code, /eslint-disable-next-line resilient\/prefer-prototype-methods -- Indexed array Gets/);
        assert.doesNotMatch(code, /Array\.from\(values\)|values\.(?:some|find|reduce|forEach)\(/);

        const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
        const [raw = {}] = await new ESLint({ overrideConfigFile: true,
            overrideConfig: config }).lintText(code, { filePath: 'indexed-array-generated.js' });
        const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
            overrideConfig: config }).lintText(code, { filePath: 'indexed-array-generated.js' });

        assert.equal(raw.errorCount, 0, JSON.stringify(raw.messages));
        assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));

        const { outputText: referenceCode = '' } = typescript.transpileModule(source, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const { firstIndex: sourceFirst = false } = await import(
            `data:text/javascript,${encodeURIComponent(referenceCode)}`
        );
        const { firstIndex: loweredFirst = false } = await import(
            `data:text/javascript,${encodeURIComponent(code)}`
        );
        const observe = (consumer) => {
            let visits = [];
            const values = Object.defineProperties(Array(3), {
                1: { value: 0 }, 2: { value: 4 }
            });
            const result = consumer(values, (value) => {
                visits = [...visits, value];

                return value === 4;
            });

            return { result, visits };
        };

        assert.deepEqual(observe(loweredFirst), observe(sourceFirst));
        // eslint-disable-next-line resilient/no-undefined-assignment -- The traversal oracle records native undefined for a visited sparse position.
        assert.deepEqual(observe(loweredFirst), { result: 2, visits: [undefined, 0, 4] });

        const tupleSource = source.replace('ReadonlyArray<number>', 'readonly [number, ...number[]]');
        const tupleFile = path.join(directory, 'tuple.ts');
        await writeFile(tupleFile, tupleSource);
        const tupleProgram = typescript.createProgram([tupleFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const tupleFacts = collectIndexedOperationContracts({
            typescript, sourceFile: tupleProgram.getSourceFile(tupleFile),
            checker: tupleProgram.getTypeChecker()
        });

        assert.equal([...tupleFacts.values()].filter(({ operationRole = '' } = {}) => (
            operationRole === 'indexed-array-traversal'
        )).length, 1);
        const refinedSource = source.replace('ReadonlyArray<number>',
            'ReadonlyArray<number> & { readonly 0: number }');
        const refinedFile = path.join(directory, 'refined.ts');
        await writeFile(refinedFile, refinedSource);
        const refinedProgram = typescript.createProgram([refinedFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const refinedFacts = collectIndexedOperationContracts({
            typescript, sourceFile: refinedProgram.getSourceFile(refinedFile),
            checker: refinedProgram.getTypeChecker()
        });

        assert.equal([...refinedFacts.values()].filter(({ operationRole = '' } = {}) => (
            operationRole === 'indexed-array-traversal'
        )).length, 1);
        const inheritedSource = `interface NumberList<A> extends Array<A> { readonly 0: A; }\n${source.replace(
            'ReadonlyArray<number>', 'NumberList<number>'
        )}`;
        const inheritedFile = path.join(directory, 'inherited.ts');
        await writeFile(inheritedFile, inheritedSource);
        const inheritedProgram = typescript.createProgram([inheritedFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const inheritedFacts = collectIndexedOperationContracts({
            typescript, sourceFile: inheritedProgram.getSourceFile(inheritedFile),
            checker: inheritedProgram.getTypeChecker()
        });

        assert.equal([...inheritedFacts.values()].filter(({ operationRole = '' } = {}) => (
            operationRole === 'indexed-array-traversal'
        )).length, 1);
        const mappedSource = source.replace('export const firstIndex =',
            'export const firstIndex = <A extends ReadonlyArray<number>>').replace(
            'ReadonlyArray<number>, predicate', '{ [K in keyof A]: number }, predicate'
        );
        const mappedFile = path.join(directory, 'mapped.ts');
        await writeFile(mappedFile, mappedSource);
        const mappedProgram = typescript.createProgram([mappedFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const mappedFacts = collectIndexedOperationContracts({
            typescript, sourceFile: mappedProgram.getSourceFile(mappedFile),
            checker: mappedProgram.getTypeChecker()
        });

        assert.equal([...mappedFacts.values()].filter(({ operationRole = '' } = {}) => (
            operationRole === 'indexed-array-traversal'
        )).length, 1);

        const reject = async (name, rejectedSource) => {
            const rejectedFile = path.join(directory, `${name}.ts`);
            await writeFile(rejectedFile, rejectedSource);
            const rejectedProgram = typescript.createProgram([rejectedFile], {
                module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
            });
            const rejectedFacts = collectIndexedOperationContracts({
                typescript, sourceFile: rejectedProgram.getSourceFile(rejectedFile),
                checker: rejectedProgram.getTypeChecker()
            });

            assert.equal([...rejectedFacts.values()].filter(({ operationRole = '' } = {}) => (
                operationRole === 'indexed-array-traversal'
            )).length, 0);
        };

        await reject('custom', source.replace('ReadonlyArray<number>',
            '{ length: number; [index: number]: number }'));
        await reject('computed', source.replace('values[i]', 'values[i + 0]'));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-array-visitation-'));
    const fileName = path.join(directory, 'visitation.ts');
    const source = [
        'export const countUntil = (values: ReadonlyArray<number>, stop: (value: number) => boolean) => {',
        '    let count = 0;',
        '    for (const value of values) {',
        '        count += 1;',
        '        if (stop(value)) break;',
        '    }',
        '    return count;',
        '};',
        ''
    ].join('\n');

    try {
        await writeFile(fileName, source);
        const program = typescript.createProgram([fileName], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });

        const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
            code: source, fileName
        });

        assert.deepEqual(diagnostics, []);
        assert.match(code, /for \(const value of values\)/);
        assert.match(code, /eslint-disable-next-line resilient\/prefer-prototype-methods -- Array for-of/);
        assert.doesNotMatch(code, /Array\.from\(values\)|values\.(?:forEach|some|reduce)\(/);

        const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
        const [raw = {}] = await new ESLint({ overrideConfigFile: true,
            overrideConfig: config }).lintText(code, { filePath: 'array-visitation-generated.js' });
        const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
            overrideConfig: config }).lintText(code, { filePath: 'array-visitation-generated.js' });

        assert.equal(raw.errorCount, 0, JSON.stringify(raw.messages));
        assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));

        const { outputText: referenceCode = '' } = typescript.transpileModule(source, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const { countUntil: sourceCount = false } = await import(
            `data:text/javascript,${encodeURIComponent(referenceCode)}`
        );
        const { countUntil: loweredCount = false } = await import(
            `data:text/javascript,${encodeURIComponent(code)}`
        );
        const observe = (consumer) => {
            let visits = [];
            const values = Object.defineProperties(Array(3), {
                1: { value: 0 }, 2: { value: 2 }
            });
            const count = consumer(values, (value) => {
                visits = [...visits, value];

                return value === 0;
            });

            return { count, visits };
        };

        assert.deepEqual(observe(loweredCount), observe(sourceCount));
        // eslint-disable-next-line resilient/no-undefined-assignment -- Sparse visitation fixtures retain actual undefined slots and their native callback failure behavior.
        assert.deepEqual(observe(loweredCount), { count: 2, visits: [undefined, 0] });

        const sideEffectSource = [
            'export const notify = (values: number[], visit: (value: number) => void) => {',
            '    for (const value of values) visit(value);',
            '};',
            'export const notifyEntries = (record: Record<string, number>,',
            '    visit: (key: string, value: number) => void) => {',
            '    for (const [key, value] of Object.entries(record)) visit(key, value);',
            '};',
            'export const notifyPairs = (pairs: Array<[string, number]>,',
            '    visit: (key: string, value: number) => void) => {',
            '    for (const [key, value] of pairs) visit(key, value);',
            '};',
            ''
        ].join('\n');
        const sideEffectFile = path.join(directory, 'side-effects.ts');

        await writeFile(sideEffectFile, sideEffectSource);
        const sideEffectProgram = typescript.createProgram([sideEffectFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });

        const sideEffectResult = createTypeScriptTransformer({
            typescript, program: sideEffectProgram
        }).transform({ code: sideEffectSource, fileName: sideEffectFile });

        assert.deepEqual(sideEffectResult.diagnostics, []);
        assert.match(sideEffectResult.code, /for \(const value of values\)/);
        assert.match(sideEffectResult.code, /for \(const \[key, value\] of Object\.entries\(record\)\)/);
        assert.doesNotMatch(sideEffectResult.code, /\.forEach\(|\[key =/);
        const [sideEffectRaw = {}] = await new ESLint({ overrideConfigFile: true,
            overrideConfig: config }).lintText(sideEffectResult.code, { filePath: 'side-effects-generated.js' });
        const [sideEffectFixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
            overrideConfig: config }).lintText(sideEffectResult.code, { filePath: 'side-effects-generated.js' });

        assert.equal(sideEffectRaw.errorCount, 0, JSON.stringify(sideEffectRaw.messages));
        assert.equal(sideEffectFixed.errorCount, 0, JSON.stringify(sideEffectFixed.messages));
        const { outputText: sideEffectReference = '' } = typescript.transpileModule(sideEffectSource, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const baselineSideEffects = await import(`data:text/javascript,${encodeURIComponent(sideEffectReference)}`);
        const loweredSideEffects = await import(`data:text/javascript,${encodeURIComponent(sideEffectResult.code)}`);
        const observeSideEffects = (notify) => {
            const values = Object.defineProperties([1, 2], {
                forEach: { value: () => { throw new Error('forEach is not the iterator'); } },
                [Symbol.iterator]: { *value() { yield 0; yield 3; } }
            });
            let visits = [];

            notify(values, (value) => { visits = [...visits, value]; });

            return visits;
        };

        assert.deepEqual(observeSideEffects(loweredSideEffects.notify),
            observeSideEffects(baselineSideEffects.notify));
        const observeEntries = (notifyEntries) => {
            let seen = [];

            notifyEntries({ zero: 0, falsey: false }, (key, value) => {
                seen = [...seen, [key, value]];
            });

            return seen;
        };

        assert.deepEqual(observeEntries(loweredSideEffects.notifyEntries),
            observeEntries(baselineSideEffects.notifyEntries));
        const visit = () => { throw new Error('callback must not run'); };

        // eslint-disable-next-line resilient/no-undefined-assignment -- Sparse visitation fixtures retain actual undefined slots and their native callback failure behavior.
        assert.throws(() => baselineSideEffects.notifyPairs([undefined], visit), TypeError);
        // eslint-disable-next-line resilient/no-undefined-assignment -- Sparse visitation fixtures retain actual undefined slots and their native callback failure behavior.
        assert.throws(() => loweredSideEffects.notifyPairs([undefined], visit), TypeError);

        const accumulatorSource = [
            'export const select = (values: number[], record: (event: string) => boolean) => {',
            '    const output: number[] = [];',
            '    for (const value of values) {',
            '        if (record(`guard:${value}`) || value > 0) {',
            '            output.push((record(`value:${value}`), value * 2));',
            '        }',
            '    }',
            '    return output;',
            '};',
            'export const group = (values: string[]) => {',
            '    const output: Record<string, string[]> = {};',
            '    for (const value of values) {',
            '        const key = String(value.length);',
            '        if (output[key]) {',
            '            output[key].push(value);',
            '        } else {',
            '            output[key] = [value];',
            '        }',
            '    }',
            '    return output;',
            '};',
            ''
        ].join('\n');
        const accumulatorFile = path.join(directory, 'accumulator.ts');

        await writeFile(accumulatorFile, accumulatorSource);
        const accumulatorProgram = typescript.createProgram([accumulatorFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const accumulatorFacts = collectLiveArrayVisitationContracts({
            typescript,
            sourceFile: accumulatorProgram.getSourceFile(accumulatorFile),
            checker: accumulatorProgram.getTypeChecker()
        });

        assert.ok([...accumulatorFacts.values()].every(({ mutationBoundary = false } = {}) => mutationBoundary));
        const accumulatorResult = createTypeScriptTransformer({
            typescript, program: accumulatorProgram
        }).transform({ code: accumulatorSource, fileName: accumulatorFile });

        assert.deepEqual(accumulatorResult.diagnostics, []);
        assert.match(accumulatorResult.code, /for \(const value of values\)/);
        assert.match(accumulatorResult.code,
            /eslint-disable resilient\/prefer-safe-transformations -- Fresh accumulator identity remains source-owned\./);
        assert.match(accumulatorResult.code, /eslint-enable resilient\/prefer-safe-transformations/);
        assert.doesNotMatch(accumulatorResult.code, /Array\.from\(values\)|\.filter\(|\.map\(/);
        const [accumulatorRaw = {}] = await new ESLint({ overrideConfigFile: true,
            overrideConfig: config }).lintText(accumulatorResult.code, { filePath: 'accumulator-generated.js' });
        const [accumulatorFixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
            overrideConfig: config }).lintText(accumulatorResult.code, { filePath: 'accumulator-generated.js' });

        assert.equal(accumulatorRaw.errorCount, 0, JSON.stringify(accumulatorRaw.messages));
        assert.equal(accumulatorFixed.errorCount, 0, JSON.stringify(accumulatorFixed.messages));
        const { outputText: accumulatorReference = '' } = typescript.transpileModule(accumulatorSource, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const baselineAccumulator = await import(`data:text/javascript,${encodeURIComponent(accumulatorReference)}`);
        const loweredAccumulator = await import(`data:text/javascript,${encodeURIComponent(accumulatorResult.code)}`);
        const observeAccumulator = (select) => {
            let events = [];
            const values = Object.defineProperty([1, 2], Symbol.iterator, {
                *value() { yield 2; yield 1; }
            });
            const output = select(values, (event) => {
                events = [...events, event];

                return false;
            });

            return { events, output };
        };

        assert.deepEqual(observeAccumulator(loweredAccumulator.select),
            observeAccumulator(baselineAccumulator.select));
        assert.deepEqual(loweredAccumulator.group(['a', 'b', 'ab']),
            baselineAccumulator.group(['a', 'b', 'ab']));

        const rejectedMutationSource = [
            'export const mutateInput = (values: number[]) => {',
            '    for (const value of values) values.push(value);',
            '};',
            'export const mutateNested = (values: number[]) => {',
            '    const output: number[] = [];',
            '    for (const value of values) (() => output.push(value))();',
            '    return output;',
            '};',
            ''
        ].join('\n');
        const rejectedMutationFile = path.join(directory, 'rejected-mutation.ts');

        await writeFile(rejectedMutationFile, rejectedMutationSource);
        const rejectedMutationProgram = typescript.createProgram([rejectedMutationFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const rejectedMutationFacts = collectLiveArrayVisitationContracts({
            typescript,
            sourceFile: rejectedMutationProgram.getSourceFile(rejectedMutationFile),
            checker: rejectedMutationProgram.getTypeChecker()
        });

        assert.ok([...rejectedMutationFacts.values()].every(({ mutationBoundary = true } = {}) => !mutationBoundary));
        const rejectedMutationResult = createTypeScriptTransformer({
            typescript, program: rejectedMutationProgram
        }).transform({ code: rejectedMutationSource, fileName: rejectedMutationFile });

        assert.doesNotMatch(rejectedMutationResult.code, /eslint-disable resilient\/prefer-safe-transformations/);
        const [rejectedMutationLint = {}] = await new ESLint({ overrideConfigFile: true,
            overrideConfig: config }).lintText(rejectedMutationResult.code, { filePath: 'rejected-mutation-generated.js' });
        const rejectedSafety = rejectedMutationLint.messages.filter(({ ruleId = '' } = {}) => (
            ruleId === 'resilient/prefer-safe-transformations'
        ));

        assert.equal(rejectedSafety.length, 1, JSON.stringify(rejectedMutationLint.messages));
        const [{ messageId: rejectedId = '', message: rejectedMessage = '' } = {}] = rejectedSafety;
        assert.equal(rejectedId, 'mutation');
        assert.match(rejectedMessage, /output/u, 'The nested fresh-array mutation remains unsupported.');
        const retainedSourceUpdates = rejectedMutationLint.suppressedMessages.filter(({ ruleId = '', message = '' } = {}) => (
            ruleId === 'resilient/prefer-safe-transformations' && message.includes('values')
        ));
        assert.equal(retainedSourceUpdates.length, 1, 'The borrowed input native push retains source identity and live visitation without an immutable reconstruction.');

        const reject = async (name, rejectedSource) => {
            const rejectedFile = path.join(directory, `${name}.ts`);
            await writeFile(rejectedFile, rejectedSource);
            const rejectedProgram = typescript.createProgram([rejectedFile], {
                module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
            });

            assert.equal(collectLiveArrayVisitationContracts({
                typescript, sourceFile: rejectedProgram.getSourceFile(rejectedFile),
                checker: rejectedProgram.getTypeChecker()
            }).size, 0);
        };

        await reject('custom', source.replace('ReadonlyArray<number>', 'Iterable<number>'));
        await reject('async', source.replace('for (const value of values)', 'for await (const value of values)'));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-own-key-'));
    const fileName = path.join(directory, 'own-key.ts');
    const source = [
        'export const copyOwn = (source: Record<string, number>) => {',
        '    const output: Record<string, number> = {};',
        '    for (const key in source) {',
        '        if (Object.prototype.hasOwnProperty.call(source, key)) {',
        '            output[key] = source[key];',
        '        }',
        '    }',
        '    return output;',
        '};',
        ''
    ].join('\n');

    try {
        await writeFile(fileName, source);
        const program = typescript.createProgram([fileName], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        });

        const rejectedSource = 'export const keys = (value: any) => { for (const key in value) { void key; } };';
        const rejectedFile = path.join(directory, 'rejected.ts');

        await writeFile(rejectedFile, rejectedSource);
        const rejectedProgram = typescript.createProgram([rejectedFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        });

        assert.equal(collectLiveOwnKeyEnumerationContracts({
            typescript,
            sourceFile: rejectedProgram.getSourceFile(rejectedFile),
            checker: rejectedProgram.getTypeChecker()
        }).size, 0);

        const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
            code: source, fileName
        });

        assert.deepEqual(diagnostics, []);
        assert.match(code, /for \(const key in source\)/);
        assert.match(code, /eslint-disable-next-line resilient\/prefer-prototype-methods -- Live own-key enumeration/);
        assert.equal((code.match(/eslint-disable-next-line resilient\/prefer-prototype-methods/g) || []).length, 1);
        assert.doesNotMatch(code, /Source loop has unproven callback safety or sequential effects/);
        assert.doesNotMatch(code, /Object\.keys\(source\)|Object\.entries\(source\)/);

        const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
        const options = { overrideConfigFile: true, overrideConfig: config };
        const [raw = {}] = await new ESLint(options).lintText(code, { filePath: 'own-key-generated.js' });
        const [fixed = {}] = await new ESLint({ ...options, fix: true }).lintText(code, {
            filePath: 'own-key-generated.js'
        });

        assert.equal(raw.errorCount, 0, JSON.stringify({ messages: raw.messages, code }));
        assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));

        const { outputText: sourceJavaScript = '' } = typescript.transpileModule(source, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const load = async text => import(`data:text/javascript,${encodeURIComponent(text)}`);
        const baseline = await load(sourceJavaScript);
        const lowered = await load(code);
        const observe = (module) => {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- This proof builds an object with inherited data and own keys on the same identity.
            const input = Object.assign(Object.create({ inherited: 9 }), { a: 0, b: 2 });
            const result = module.copyOwn(input);

            return { entries: Object.entries(result), inherited: Object.hasOwn(result, 'inherited') };
        };

        assert.deepEqual(observe(lowered), observe(baseline));

        const inheritedSource = [
            'export const firstKey = (source: Record<string, number>) => {',
            '    for (const key in source) { return key; }',
            '    return "";',
            '};',
            ''
        ].join('\n');
        const inheritedFile = path.join(directory, 'inherited.ts');
        await writeFile(inheritedFile, inheritedSource);
        const inheritedProgram = typescript.createProgram([inheritedFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        });

        const inheritedResult = createTypeScriptTransformer({
            typescript, program: inheritedProgram
        }).transform({ code: inheritedSource, fileName: inheritedFile });

        assert.deepEqual(inheritedResult.diagnostics, []);
        assert.match(inheritedResult.code, /eslint-disable-next-line resilient\/prefer-prototype-methods -- Native for-in/);
        const [inheritedRaw = {}] = await new ESLint(options).lintText(inheritedResult.code, {
            filePath: 'inherited-generated.js'
        });
        const [inheritedFixed = {}] = await new ESLint({ ...options, fix: true }).lintText(
            inheritedResult.code, { filePath: 'inherited-generated.js' }
        );

        assert.equal(inheritedRaw.errorCount, 0, JSON.stringify(inheritedRaw.messages));
        assert.equal(inheritedFixed.errorCount, 0, JSON.stringify(inheritedFixed.messages));
        const { outputText: inheritedReference = '' } = typescript.transpileModule(inheritedSource, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const inheritedInput = Object.create({ inherited: 9 });

        assert.equal((await load(inheritedResult.code)).firstKey(inheritedInput),
            (await load(inheritedReference)).firstKey(inheritedInput));

        const genericSource = [
            'export const ownKeys = <A>(source: A) => {',
            '    for (const key in source) {',
            '        if (Object.prototype.hasOwnProperty.call(source, key)) return key;',
            '    }',
            '    return "";',
            '};',
            ''
        ].join('\n');
        const genericFile = path.join(directory, 'generic.ts');

        await writeFile(genericFile, genericSource);
        const genericProgram = typescript.createProgram([genericFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const genericFacts = collectLiveOwnKeyEnumerationContracts({
            typescript,
            sourceFile: genericProgram.getSourceFile(genericFile),
            checker: genericProgram.getTypeChecker()
        });
        const [genericFact = {}] = [...genericFacts.values()];

        assert.match(genericFact.evidence[0], /Generic for-in/);
        const genericResult = createTypeScriptTransformer({ typescript, program: genericProgram }).transform({
            code: genericSource, fileName: genericFile
        });

        assert.deepEqual(genericResult.diagnostics, []);
        assert.match(genericResult.code, /eslint-disable-next-line resilient\/prefer-prototype-methods --/);
        const [genericRaw = {}] = await new ESLint(options).lintText(genericResult.code, {
            filePath: 'generic-own-keys.js'
        });
        const [genericFixed = {}] = await new ESLint({ ...options, fix: true }).lintText(
            genericResult.code, { filePath: 'generic-own-keys.js' }
        );

        assert.equal(genericRaw.errorCount, 0, JSON.stringify(genericRaw.messages));
        assert.equal(genericFixed.errorCount, 0, JSON.stringify(genericFixed.messages));
        const { outputText: genericReference = '' } = typescript.transpileModule(genericSource, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        // eslint-disable-next-line resilient/prefer-safe-transformations -- This proof builds an object with inherited data and own keys on the same identity.
        const ownInput = Object.assign(Object.create({ inherited: 1 }), { first: 0, second: false });

        assert.deepEqual((await load(genericResult.code)).ownKeys(ownInput),
            (await load(genericReference)).ownKeys(ownInput));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-live-set-visitation-'));
    const fileName = path.join(directory, 'visitation.ts');
    const source = [
        'export const values = (set: ReadonlySet<number>, compare: (a: number, b: number) => number) => {',
        '    const output: number[] = [];',
        '    set.forEach(value => output.push(value));',
        '    return output.sort(compare);',
        '};',
        'export const positive = (set: Set<number>, compare: (a: number, b: number) => number) => {',
        '    const output: number[] = [];',
        '    set.forEach(value => { if (value > 0) output.push(value); });',
        '    return output.sort(compare);',
        '};',
        ''
    ].join('\n');

    try {
        await writeFile(fileName, source);
        const program = typescript.createProgram([fileName], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        });
        const contracts = collectLiveSetVisitationContracts({
            typescript, sourceFile: program.getSourceFile(fileName), checker: program.getTypeChecker()
        });

        assert.equal([...contracts.values()].filter(({ operationRole = '' } = {}) => (
            operationRole === 'set-visitation-sort'
        )).length, 2);

        const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
            code: source, fileName
        });

        assert.deepEqual(diagnostics, []);
        assert.match(code, /set\.forEach/);
        assert.match(code, /output\.push\(value\)/);
        assert.match(code, /output\.sort\(compare\)/);
        assert.doesNotMatch(code, /Array\.from\(set\)|\.\.\.set|set\.values\(/);

        const eslintConfig = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
        const [raw = {}] = await new ESLint({ overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(code, { filePath: 'visitation-generated.js' });
        const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(code, { filePath: 'visitation-generated.js' });

        assert.equal(raw.messages.filter(({ ruleId = '' } = {}) => (
            ruleId !== 'padding-line-between-statements'
        )).length, 0, JSON.stringify(raw.messages));
        assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));

        const { outputText: sourceJavaScript = '' } = typescript.transpileModule(source, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const importCode = async text => import(`data:text/javascript,${encodeURIComponent(text)}`);
        const sourceModule = await importCode(sourceJavaScript);
        const generatedModule = await importCode(code);
        const observe = (module, method = 'values') => {
            let events = [];
            const set = new Set();

            Object.defineProperties(set, {
                forEach: {
                    value(callback, thisArg) {
                        events = [...events, 'forEach'];

                        return Set.prototype.forEach.call(this, (value, key, receiver) => {
                            callback.call(thisArg, value, key, receiver);

                            // eslint-disable-next-line resilient/prefer-safe-transformations -- The native Set proof appends during live visitation on its own receiver.
                            if (value === 1 && !this.has(3)) this.add(3);
                        });
                    }
                },
                [Symbol.iterator]: {
                    value() {
                        throw new Error('iterator must not be acquired');
                    }
                }
            });

            Set.prototype.add.call(set, 1);
            Set.prototype.add.call(set, 0);
            const result = module[method](set, (left, right) => {
                events = [...events, ['compare', left, right]];

                return left - right;
            });

            return { result, events };
        };

        assert.deepEqual(observe(generatedModule), observe(sourceModule));
        assert.deepEqual(observe(generatedModule, 'positive'), observe(sourceModule, 'positive'));

        const customFile = path.join(directory, 'custom.ts');
        const customSource = [
            'type Custom = { forEach: (f: (n: number) => void) => void };',
            'export const values = (set: Custom) => {',
            '    const output: number[] = [];',
            '    set.forEach(value => output.push(value));',
            '    return output.sort((a, b) => a - b);',
            '};',
            ''
        ].join('\n');

        await writeFile(customFile, customSource);
        const customProgram = typescript.createProgram([customFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext
        });

        assert.equal(collectLiveSetVisitationContracts({
            typescript, sourceFile: customProgram.getSourceFile(customFile),
            checker: customProgram.getTypeChecker()
        }).size, 0);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-live-work-queue-'));
    const fileName = path.join(directory, 'queue.ts');
    const source = [
        'export const depth = (input: number[]) => {',
        '    const todo = [...input];',
        '    const output: number[] = [];',
        '    while (todo.length > 0) {',
        '        const item = todo.shift()!;',
        '        if (item < 0) {',
        '            todo.unshift(-item);',
        '',
        '            continue;',
        '        }',
        '',
        '        output.push(item);',
        '    }',
        '    return output;',
        '};',
        'export const breadth = (input: number[]) => {',
        '    const todo: number[] = [];',
        '    const output: number[] = [];',
        '    function visit(item: number): void {',
        '        if (item < 0) {',
        '            [-item].forEach(value => todo.push(value));',
        '',
        '            return;',
        '        }',
        '',
        '        output.push(item);',
        '    }',
        '    for (const item of input) visit(item);',
        '    while (todo.length > 0) visit(todo.shift()!);',
        '    return output;',
        '};',
        ''
    ].join('\n');

    try {
        await writeFile(fileName, source);
        const program = typescript.createProgram([fileName], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        });
        const contracts = collectLiveWorkQueueContracts({
            typescript, sourceFile: program.getSourceFile(fileName), checker: program.getTypeChecker()
        });

        assert.deepEqual([...contracts.values()].map(({ method = '' } = {}) => method), [
            'shift', 'unshift', 'push', 'shift'
        ]);

        const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
            code: source, fileName
        });

        assert.deepEqual(diagnostics, []);
        assert.match(code, /todo\.shift\(\)/);
        assert.match(code, /todo\.unshift\(-item\)/);
        assert.match(code, /todo\.push\(value\)/);
        assert.doesNotMatch(code, /Array\.from\(todo\)|\n\s*todo\s*=|todo\.reduce\(/);

        const eslintConfig = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
        const [raw = {}] = await new ESLint({ overrideConfigFile: true, overrideConfig: eslintConfig })
            .lintText(code, { filePath: 'queue-generated.js' });
        const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(code, { filePath: 'queue-generated.js' });

        assert.equal(raw.messages.filter(({ ruleId = '' } = {}) => (
            ruleId !== 'padding-line-between-statements'
        )).length, 0, JSON.stringify(raw.messages));
        assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));

        const { outputText: sourceJavaScript = '' } = typescript.transpileModule(source, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const importCode = async text => import(`data:text/javascript,${encodeURIComponent(text)}`);
        const sourceModule = await importCode(sourceJavaScript);
        const generatedModule = await importCode(code);
        const cases = [[], [0], [-2, 0, 3], [1, -2, -3, 0]];

        cases.forEach((input) => {
            assert.deepEqual(generatedModule.depth(input), sourceModule.depth(input));
            assert.deepEqual(generatedModule.breadth(input), sourceModule.breadth(input));
        });

        const customFile = path.join(directory, 'custom.ts');
        const customSource = [
            'type Queue = { length: number; shift: () => number; push: (n: number) => void };',
            'export const use = (todo: Queue) => {',
            '    while (todo.length > 0) todo.push(todo.shift());',
            '    return todo;',
            '};',
            ''
        ].join('\n');

        await writeFile(customFile, customSource);
        const customProgram = typescript.createProgram([customFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext
        });

        assert.equal(collectLiveWorkQueueContracts({
            typescript, sourceFile: customProgram.getSourceFile(customFile),
            checker: customProgram.getTypeChecker()
        }).size, 0);
        const capturedFile = path.join(directory, 'captured.ts');
        const capturedSource = [
            'export const capture = (input: number[]) => {',
            '    const todo = [...input];',
            '    while (todo.length > 0) todo.shift();',
            '    return () => todo.push(1);',
            '};',
            ''
        ].join('\n');

        await writeFile(capturedFile, capturedSource);
        const capturedProgram = typescript.createProgram([capturedFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext
        });

        assert.equal(collectLiveWorkQueueContracts({
            typescript, sourceFile: capturedProgram.getSourceFile(capturedFile),
            checker: capturedProgram.getTypeChecker()
        }).size, 0);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-recurrence-'));
    const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
    const prove = async (name, source, exportName, observe) => {
        const fileName = path.join(directory, `${name}.ts`);
        await writeFile(fileName, source);
        const program = typescript.createProgram([fileName], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const facts = collectLoopCarriedRecurrenceContracts({
            typescript, sourceFile: program.getSourceFile(fileName), checker: program.getTypeChecker()
        });
        const [fact = {}] = [...facts.values()];
        const { loopRange = '', updateRange = '' } = fact;
        const recurrenceEntries = collectDestructuringAgreements({
            loopCarriedRecurrenceContracts: facts
        }).get(loopRange) || [];
        const [entry = {}] = recurrenceEntries;

        assert.ok(updateRange);
        const { action = '' } = getDestructuringAgreement({ entry });

        assert.equal(action, 'retain-loop-carried-recurrence');

        const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
            code: source, fileName
        });

        assert.deepEqual(diagnostics, []);
        assert.match(code, /eslint-disable-next-line resilient\/prefer-prototype-methods -- Loop-carried state/);
        assert.doesNotMatch(code, /\.reduce\(|Array\.from\(/);
        const [raw = {}] = await new ESLint({ overrideConfigFile: true,
            overrideConfig: config }).lintText(code, { filePath: `${name}-generated.js` });
        const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
            overrideConfig: config }).lintText(code, { filePath: `${name}-generated.js` });
        const { errorCount: rawErrors = 0, messages: rawMessages = [] } = raw;
        const { errorCount: fixedErrors = 0, messages: fixedMessages = [] } = fixed;

        assert.equal(rawErrors, 0, JSON.stringify(rawMessages));
        assert.equal(fixedErrors, 0, JSON.stringify(fixedMessages));

        const { outputText: referenceCode = '' } = typescript.transpileModule(source, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const baseline = await import(`data:text/javascript,${encodeURIComponent(referenceCode)}`);
        const lowered = await import(`data:text/javascript,${encodeURIComponent(code)}`);
        const { [exportName]: baselineConsumer = false } = baseline;
        const { [exportName]: loweredConsumer = false } = lowered;

        assert.deepEqual(observe(loweredConsumer), observe(baselineConsumer));
    };

    try {
        await prove('open', [
            'export const chase = (start: number, step: (value: number) => number) => {',
            '    let state = start;',
            '    let calls = 0;',
            '    while (true) {',
            '        state = step(state);',
            '        calls += 1;',
            '        if (state < 0) break;',
            '    }',
            '    return [state, calls];',
            '};',
            ''
        ].join('\n'), 'chase', (chase) => {
            let calls = 0;
            const result = chase(1, (value) => {
                calls += 1;

                return value < 3 ? value + 1 : -1;
            });

            return { result, calls };
        });
        await prove('guarded', [
            'export const sum = (start: number, accept: (value: number) => boolean,',
            '    advance: (value: number) => number) => {',
            '    let next = start;',
            '    let total = 0;',
            '    while (accept(next)) {',
            '        total += next;',
            '        next = advance(next);',
            '    }',
            '    return total;',
            '};',
            ''
        ].join('\n'), 'sum', sum => sum(1, value => value < 4, value => value + 1));
        await prove('tagged', [
            'type Step = { category: "Inbound"; inbound: number } | { category: "Outbound"; outbound: number };',
            'export const tail = (start: number, f: (value: number) => Step) => {',
            '    let result = f(start);',
            '    while (result.category === "Inbound") {',
            '        result = f(result.inbound);',
            '    }',
            '    return result.outbound;',
            '};',
            ''
        ].join('\n'), 'tail', tail => tail(1, value => value < 3
            ? { category: 'Inbound', inbound: value + 1 }
            : { category: 'Outbound', outbound: value }));

        const rejectedFile = path.join(directory, 'rejected.ts');
        await writeFile(rejectedFile,
            'export const spin = (stop: () => boolean) => { while (true) { if (stop()) break; } };');
        const rejectedProgram = typescript.createProgram([rejectedFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });

        assert.equal(collectLoopCarriedRecurrenceContracts({
            typescript, sourceFile: rejectedProgram.getSourceFile(rejectedFile),
            checker: rejectedProgram.getTypeChecker()
        }).size, 0);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-materialized-collection-'));
    const fileName = path.join(directory, 'collections.ts');
    const source = [
        'export const mapAll = (source: ReadonlyMap<object, number>, keyOf: (key: object) => object, visit: (value: number) => number) => {',
        '    const output = new Map<object, number>();',
        '    for (const [key, value] of Array.from(source.entries())) output.set(keyOf(key), visit(value));',
        '    return output;',
        '};',
        'export const mapSelected = (source: ReadonlyMap<object, number>, admit: (value: number) => boolean, visit: (value: number) => number) => {',
        '    const output = new Map<object, number>();',
        '    for (const [key, value] of [...source]) if (admit(value)) output.set(key, visit(value));',
        '    return output;',
        '};',
        'export const setAll = (source: ReadonlySet<number>, visit: (value: number) => number) => {',
        '    const output = new Set<number>();',
        '    for (const value of [...source]) output.add(visit(value));',
        '    return output;',
        '};',
        'export const setSelected = (source: ReadonlySet<number>, admit: (value: number) => boolean, visit: (value: number) => number) => {',
        '    const output = new Set<number>();',
        '    for (const value of Array.from(source.values())) if (admit(value)) output.add(visit(value));',
        '    return output;',
        '};',
        'export const setArrays = (source: ReadonlySet<number[]>) => {',
        '    const output = new Set<number[]>();',
        '    for (const value of [...source]) output.add(value);',
        '    return output;',
        '};',
        ''
    ].join('\n');
    const load = loadShared;

    try {
        await writeFile(fileName, source);
        const program = typescript.createProgram([fileName], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({ code: source, fileName });
        const { outputText: reference = '' } = typescript.transpileModule(source, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const baseline = await load(reference);
        const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
        const [raw = {}] = await new ESLint({ overrideConfigFile: true, overrideConfig: config })
            .lintText(code, { filePath: 'materialized-collection-generated.js' });
        const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true, overrideConfig: config })
            .lintText(code, { filePath: 'materialized-collection-generated.js' });
        const lowered = await load(code);
        const fixedModule = await load(fixed.output || code);
        const keys = [{}, {}, {}];
        const observe = (module, method, values, selected = true, failureAt = '') => {
            let events = [];
            const failure = new Error('callback failure');
            const input = method.startsWith('map')
                ? new Map(values.map((value, index) => [keys[index], value])) : new Set(values);
            const admit = (value) => {
                events = [...events, ['guard', value]];

                if (failureAt === 'guard') throw failure;

                return selected && value >= 0;
            };
            const visit = (value) => {
                events = [...events, ['value', value]];

                // Source callbacks can change the original input after its snapshot.
                // eslint-disable-next-line resilient/prefer-safe-transformations -- The snapshot regression observes a callback appending to the original Set after materialization.
                if (input instanceof Set) input.add(99);

                if (failureAt === 'value') throw failure;

                return value % 2;
            };
            const keyOf = (key) => {
                events = [...events, ['key', keys.indexOf(key)]];

                return keys[0];
            };
            const invoke = () => {
                if (method === 'mapAll') return module[method](input, keyOf, visit);

                if (method === 'setAll') return module[method](input, visit);

                return module[method](input, admit, visit);
            };

            try {
                const result = invoke();

                return { entries: [...result], events };
            } catch (error) {
                assert.equal(error, failure);

                return { failed: true, events };
            }
        };
        const instrumentArrayReads = async (text) => {
            const file = typescript.createSourceFile('array-work.js', text, typescript.ScriptTarget.ESNext, true, typescript.ScriptKind.JS);
            const transformed = typescript.transform(file, [(context) => {
                const visit = (node) => {
                    const visited = typescript.visitEachChild(node, visit, context);

                    if (!typescript.isArrayLiteralExpression(visited)) return visited;

                    return typescript.factory.createCallExpression(typescript.factory.createIdentifier('__resilientTrackArray'), undefined, [visited]);
                };

                return node => typescript.visitNode(node, visit);
            }]);
            const { transformed: instrumentedFiles = [] } = transformed;
            const { length = 0 } = instrumentedFiles;

            assert.equal(length, 1, 'Expected one source file for array-work instrumentation.');
            const instrumented = typescript.createPrinter().printFile(instrumentedFiles.at(0));
            transformed.dispose();

            return load(`
                let __resilientArrayReads = 0;
                const __resilientTrackArray = values => new Proxy(values, {
                    get(target, key, receiver) {
                        if (typeof key === 'string' && /^(?:0|[1-9][0-9]*)$/.test(key)) __resilientArrayReads += 1;
                        return Reflect.get(target, key, receiver);
                    }
                });
                export const __resilientGetArrayReads = () => __resilientArrayReads;
                ${instrumented}
            `);
        };
        const workModules = await Promise.all([
            instrumentArrayReads(code),
            instrumentArrayReads(fixed.output || code),
            instrumentArrayReads('export const setAll = (source, visit) => new Set([...source].reduce((values, value) => [...values, visit(value)], []));')
        ]);
        const countArrayVisits = (module, count) => {
            const values = new Set(Array.from({ length: count }, (_, index) => index));
            const before = module.__resilientGetArrayReads();
            const result = module.setAll(values, value => value);
            const { size = 0 } = result;
            assert.equal(size, count);

            return module.__resilientGetArrayReads() - before;
        };

        assert.deepEqual(program.getSemanticDiagnostics(), []);
        assert.deepEqual(diagnostics, []);

        assert.equal(raw.errorCount, 0, JSON.stringify({ messages: raw.messages, code }));
        assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));
        [lowered, fixedModule].forEach((module, index) => {
            ['mapAll', 'mapSelected', 'setAll', 'setSelected'].forEach((method) => {
                [[], [-1, 0, 2], [1, 2, 3], [Number.NaN, -0, 0]].forEach((values) => {
                    [true, false].forEach(selected => ['', 'guard', 'value'].forEach((failureAt) => {
                        assert.deepEqual(observe(module, method, values, selected, failureAt),
                            observe(baseline, method, values, selected, failureAt));
                    }));
                });
            });
            const nested = [[], [1, 2], [1, 2]];
            const { setArrays = false } = module;
            const arrays = [...setArrays(new Set(nested))];
            assert.deepEqual(arrays, nested);
            nested.forEach(value => assert.ok(arrays.includes(value), 'Flatten only the singleton wrapper, preserving array values.'));
            [100, 1000, 6000].forEach((count) => {
                assert.ok(countArrayVisits(workModules.at(index), count) <= count * 2, 'Array visits must stay linear in input size.');
            });
        });
        assert.ok(countArrayVisits(workModules.at(2), 100) > 200, 'The work probe detects repeated prefix copying.');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-native-class-'));
    const fileName = path.join(directory, 'cell.ts');
    const source = [
        'export class Cell {',
        '    private value: number;',
        '    constructor(value: number) {',
        '        // eslint-disable-next-line resilient/prefer-safe-transformations -- The instance owns its class state.',
        '        this.value = value;',
        '        // eslint-disable-next-line resilient/prefer-safe-transformations -- Bound method identity is part of the instance protocol.',
        '        this.read = this.read.bind(this);',
        '    }',
        '    read(): number { return this.value; }',
        '    write(value: number): void {',
        '        // eslint-disable-next-line resilient/prefer-safe-transformations -- The instance owns its class state.',
        '        this.value = value;',
        '    }',
        '}',
        'export const create = (value: number) => new Cell(value);',
        ''
    ].join('\n');

    try {
        await writeFile(fileName, source);
        const program = typescript.createProgram([fileName], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const contracts = collectNativeClassBoundaryContracts({
            typescript, sourceFile: program.getSourceFile(fileName), checker: program.getTypeChecker()
        });
        const [fact = {}] = [...contracts.values()];

        assert.equal(fact.boundMethods.length, 1);

        const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
            code: source, fileName
        });

        assert.deepEqual(diagnostics, []);
        assert.match(code, /export class Cell/);
        assert.match(code, /no-restricted-syntax -- Native new, prototype, and bound-method identity/);
        assert.match(code, /this\.read = this\.read\.bind\(this\)/);
        assert.doesNotMatch(code, /Object\.create|\.prototype\s*=/);

        const eslintConfig = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
        const [raw = {}] = await new ESLint({ overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(code, { filePath: 'cell-generated.js' });
        const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(code, { filePath: 'cell-generated.js' });

        assert.equal(raw.messages.filter(({ ruleId = '' } = {}) => (
            ruleId !== 'padding-line-between-statements'
        )).filter(({ severity = 0 } = {}) => severity === 2).length,
        0, JSON.stringify({ messages: raw.messages, code }));
        assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));

        const { outputText: sourceJavaScript = '' } = typescript.transpileModule(source, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const importCode = async text => import(`data:text/javascript,${encodeURIComponent(text)}`);
        const sourceModule = await importCode(sourceJavaScript);
        const generatedModule = await importCode(code);
        const observe = (module) => {
            const Cell = Reflect.get(module, 'Cell');
            const create = Reflect.get(module, 'create');
            const instance = Reflect.apply(create, null, [3]);
            const read = Reflect.get(instance, 'read');
            const write = Reflect.get(instance, 'write');
            const prototypeRead = Reflect.get(Reflect.get(Cell, 'prototype'), 'read');
            const before = Reflect.apply(read, null, []);

            Reflect.apply(write, instance, [8]);
            let callableWithoutNew = true;

            try {
                Reflect.apply(Cell, null, [0]);
            } catch (error) {
                callableWithoutNew = !(error instanceof TypeError);
            }

            return {
                before,
                after: Reflect.apply(read, null, []),
                instance: instance instanceof Cell,
                ownBoundMethod: Object.hasOwn(instance, 'read'),
                prototypeMethod: prototypeRead !== read,
                constructor: Reflect.get(instance, 'constructor') === Cell,
                callableWithoutNew
            };
        };

        assert.deepEqual(observe(generatedModule), observe(sourceModule));

        const importFile = path.join(directory, 'with-import.ts');
        const supportFile = path.join(directory, 'marker.ts');
        const importSource = `import { marker } from './marker';\n${source}\nexport const seen = marker;`;

        await writeFile(supportFile, 'export const marker = 1;');
        await writeFile(importFile, importSource);
        const importProgram = typescript.createProgram([importFile, supportFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const { code: importedCode = '' } = createTypeScriptTransformer({
            typescript, program: importProgram
        }).transform({ code: importSource, fileName: importFile });

        assert.match(importedCode, /no-restricted-syntax -- Native new, prototype, and bound-method identity/);

        const rejectedFile = path.join(directory, 'simple.ts');
        const rejectedSource = 'export class Simple { constructor(readonly value: number) {} }';

        await writeFile(rejectedFile, rejectedSource);
        const rejectedProgram = typescript.createProgram([rejectedFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext
        });

        assert.equal(collectNativeClassBoundaryContracts({
            typescript, sourceFile: rejectedProgram.getSourceFile(rejectedFile),
            checker: rejectedProgram.getTypeChecker()
        }).size, 0);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-numeric-range-'));
    const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
    const source = [
        'export const generate = <A>(f: (index: number) => A) => (n: number): A[] => {',
        '    const limit = Math.max(0, Math.floor(n));',
        '    const output: A[] = [f(0)];',
        '    for (let index = 1; index < limit; index++) {',
        '        output.push(f(index));',
        '    }',
        '    return output;',
        '};',
        ''
    ].join('\n');

    try {
        const fileName = path.join(directory, 'range.ts');

        await writeFile(fileName, source);
        const program = typescript.createProgram([fileName], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });

        const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
            code: source, fileName
        });

        assert.deepEqual(diagnostics, []);
        assert.match(code, /eslint-disable-next-line resilient\/prefer-prototype-methods -- Numeric range/);
        assert.match(code, /for \(let index = 1; index < limit; index\+\+\)/);
        assert.doesNotMatch(code, /Array\.from\(|\.reduce\(/);
        const options = { overrideConfigFile: true, overrideConfig: config };
        const [raw = {}] = await new ESLint(options).lintText(code, { filePath: 'range-generated.js' });
        const [fixed = {}] = await new ESLint({ ...options, fix: true }).lintText(code, {
            filePath: 'range-generated.js'
        });

        assert.equal(raw.errorCount, 0, JSON.stringify(raw.messages));
        assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));
        const { outputText: referenceCode = '' } = typescript.transpileModule(source, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const baseline = await import(`data:text/javascript,${encodeURIComponent(referenceCode)}`);
        const lowered = await import(`data:text/javascript,${encodeURIComponent(code)}`);
        const observe = (generate) => {
            let calls = 0;
            const values = [0, 1, 2.9, 4].map(n => generate((index) => {
                calls += 1;

                return index === 2 ? false : index;
            })(n));

            return { calls, values };
        };

        assert.deepEqual(observe(lowered.generate), observe(baseline.generate));

        const rejectedFile = path.join(directory, 'rejected.ts');

        await writeFile(rejectedFile, [
            'export const copy = (source: number[]) => {',
            '    const output = [source[0]];',
            '    for (let index = 1; index < source.length; index++) output.push(source[index]);',
            '    return output;',
            '};'
        ].join('\n'));
        const rejectedProgram = typescript.createProgram([rejectedFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });

        assert.equal(collectNumericRangeBuilderContracts({
            typescript,
            sourceFile: rejectedProgram.getSourceFile(rejectedFile),
            checker: rejectedProgram.getTypeChecker()
        }).size, 0);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-observable-set-union-'));
    const fileName = path.join(directory, 'union.ts');
    const source = [
        'export const union = (left: ReadonlySet<number>, right: ReadonlySet<number>,',
        '    member: (value: number, result: Set<number>) => boolean) => {',
        '    const result = new Set(left);',
        '    right.forEach(value => {',
        '        if (!member(value, result)) result.add(value);',
        '    });',
        '    return result;',
        '};',
        ''
    ].join('\n');

    try {
        await writeFile(fileName, source);
        const program = typescript.createProgram([fileName], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        });

        const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
            code: source, fileName
        });

        assert.deepEqual(diagnostics, []);
        assert.match(code, /new Set\(left\)/);
        assert.match(code, /right\.forEach/);
        assert.match(code, /member\(value, result\)/);
        assert.match(code, /result\.add\(value\)/);
        assert.doesNotMatch(code, /\n\s*result\s*=|Array\.from\(right\)|\.\.\.right/);

        const eslintConfig = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
        const [raw = {}] = await new ESLint({ overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(code, { filePath: 'union-generated.js' });
        const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(code, { filePath: 'union-generated.js' });

        assert.equal(raw.messages.filter(({ ruleId = '' } = {}) => (
            ruleId !== 'padding-line-between-statements'
        )).length, 0, JSON.stringify(raw.messages));
        assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));

        const { outputText: sourceJavaScript = '' } = typescript.transpileModule(source, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const importCode = async text => import(`data:text/javascript,${encodeURIComponent(text)}`);
        const sourceModule = await importCode(sourceJavaScript);
        const generatedModule = await importCode(code);
        const observe = (module) => {
            let events = [];
            let observed = true;
            let firstWorking = false;
            const left = new Set([0, 1]);
            const right = new Set([0, 2]);

            Object.defineProperty(left, Symbol.iterator, {
                value() {
                    events = [...events, 'copy-iterator'];

                    return Set.prototype.values.call(this);
                }
            });
            Object.defineProperty(right, 'forEach', {
                value(callback, thisArg) {
                    events = [...events, 'forEach'];

                    return Set.prototype.forEach.call(this, (value, key, receiver) => {
                        callback.call(thisArg, value, key, receiver);

                        // eslint-disable-next-line resilient/prefer-safe-transformations -- The native Set proof appends during live visitation on its own receiver.
                        if (value === 0 && !this.has(3)) this.add(3);
                    });
                }
            });
            const result = module.union(left, right, (value, working) => {
                firstWorking = firstWorking || working;
                observed = observed && working instanceof Set && working === firstWorking;
                events = [...events, ['member', value, [...working]]];

                return working.has(value);
            });

            return { values: [...result], events, observed };
        };

        assert.deepEqual(observe(generatedModule), observe(sourceModule));

        const malformed = new Set();

        Object.defineProperty(malformed, Symbol.iterator, {
            value() {
                throw new Error('copy failed');
            }
        });
        const attempt = module => module.union(malformed, new Set([1]), () => false);

        assert.throws(() => attempt(sourceModule), /copy failed/);
        assert.throws(() => attempt(generatedModule), /copy failed/);

        const rejectedFile = path.join(directory, 'rejected.ts');
        const rejectedSource = [
            'export const aliased = (left: Set<number>, right: Set<number>) => {',
            '    const result = new Set(left);',
            '    const alias = result;',
            '    right.forEach(value => { if (!alias.has(value)) result.add(value); });',
            '    return result;',
            '};',
            ''
        ].join('\n');

        await writeFile(rejectedFile, rejectedSource);
        const rejectedProgram = typescript.createProgram([rejectedFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext
        });

        assert.equal(collectObservableSetUnionContracts({
            typescript, sourceFile: rejectedProgram.getSourceFile(rejectedFile),
            checker: rejectedProgram.getTypeChecker()
        }).size, 0);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-provider-dispatch-'));
    const sourceFileName = path.join(directory, 'provider.ts');
    const source = [
        'type Provider = { add: (left: number, right: number) => number };',
        'export const apply = (provider: Provider, left: number, right: number) =>',
        '    [left].map(value => provider.add(value, right))[0];',
        'export const guarded = (provider: Provider, enabled: boolean) =>',
        '    enabled ? provider.add(1, 2) : 0;',
        'export const project = (provider: Provider) => ({ next: provider.add(1, 2) });',
        ''
    ].join('\n');

    try {
        await writeFile(sourceFileName, source);
        const program = typescript.createProgram([sourceFileName], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        });
        const sourceFile = program.getSourceFile(sourceFileName);
        const contracts = collectCallableProviderDispatchContracts({
            typescript, sourceFile, checker: program.getTypeChecker()
        });
        const [fact = {}] = [...contracts.values()];

        assert.equal(fact.member, 'add');

        const nativeFileName = path.join(directory, 'native.ts');

        await writeFile(nativeFileName, 'export const native = (values: number[]) => values.reverse();\n');
        const nativeProgram = typescript.createProgram([nativeFileName], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        });

        assert.equal(collectCallableProviderDispatchContracts({
            typescript,
            sourceFile: nativeProgram.getSourceFile(nativeFileName),
            checker: nativeProgram.getTypeChecker()
        }).size, 0);
        const moduleFileName = path.join(directory, 'operations.ts');
        const namespaceFileName = path.join(directory, 'namespace.ts');

        await writeFile(moduleFileName, 'export const reverse = (value: number) => -value;\n');
        await writeFile(namespaceFileName, [
            "import * as operations from './operations.js';",
            'export const run = (value: number) => operations.reverse(value);',
            ''
        ].join('\n'));

        const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
            code: source, fileName: sourceFileName
        });

        assert.deepEqual(diagnostics, []);
        assert.match(code, /provider\.add\(value, right\)/);
        assert.match(code, /eslint-disable-next-line resilient\/prefer-safe-transformations/);
        assert.doesNotMatch(code, /provider\s*=|Array\.from\(/);

        const eslint = new ESLint({
            overrideConfigFile: true,
            overrideConfig: [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety]
        });
        const [raw = {}] = await eslint.lintText(code, { filePath: 'provider-generated.js' });

        assert.equal(raw.errorCount, 0, JSON.stringify(raw.messages));

        const fixedEslint = new ESLint({
            fix: true,
            overrideConfigFile: true,
            overrideConfig: [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety]
        });
        const [fixed = {}] = await fixedEslint.lintText(code, { filePath: 'provider-generated.js' });

        assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));

        const { outputText: sourceJavaScript = '' } = typescript.transpileModule(source, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const importCode = async text => import(`data:text/javascript,${encodeURIComponent(text)}`);
        const sourceModule = await importCode(sourceJavaScript);
        const generatedModule = await importCode(code);
        const observe = (module) => {
            let events = [];
            const provider = {
                get add() {
                    events = [...events, 'get'];

                    // eslint-disable-next-line no-restricted-syntax -- Exact provider dispatch must preserve the provider receiver and both supplied arguments.
                    return function add(left, right) {
                        events = [...events, ['call', this === provider, left, right]];

                        return left + right;
                    };
                }
            };

            return {
                value: module.apply(provider, 2, 3),
                skipped: module.guarded(provider, false),
                selected: module.guarded(provider, true),
                projected: module.project(provider).next,
                events
            };
        };

        assert.deepEqual(observe(generatedModule), observe(sourceModule));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}
