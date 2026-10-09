import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ESLint } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import { collectPlacementEvidence } from '../transforms/typescript/understand/placement-evidence.js';
import {
    collectArrayCardinalityContracts,
    collectCollectionReconstructionContracts,
    collectIndexedOperationContracts,
    collectRepeatedParameterReadContracts,
    collectSortCapabilityContracts,
    getConsumerBindingContract,
    isStandardArrayType
} from '../transforms/typescript/understand/type-evidence.js';

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
const importCode = text => import(`data:text/javascript,${encodeURIComponent(text)}`);
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

        modules.forEach(({ probe = false }) => {
            if (typeof probe !== 'function') assert.fail('Expected the emitted probe export.');

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
    const observeArgument = ({ probe = false } = {}, throwing = false) => {
        if (typeof probe !== 'function') assert.fail('Expected the repeated collection argument consumer.');

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
    const observeFactory = ({ probe = false } = {}) => {
        if (typeof probe !== 'function') assert.fail('Expected the emitted factory consumer.');

        const input = [1];
        let trace = [];
        Object.defineProperty(input, 'push', { get() {
            trace = [...trace, 'get push'];

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
        const observe = ({ probe = false } = {}, overridden = false) => {
            if (typeof probe !== 'function') assert.fail('Expected the retained mutation consumer.');

            const input = [3, 1, 2];
            let trace = [];
            const failure = new Error('mutation lookup');

            if (overridden) Object.defineProperty(input, name, { get() {
                trace = [...trace, `get ${name}`, this === input ? 'get receiver' : 'wrong get receiver'];

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
