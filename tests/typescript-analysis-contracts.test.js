import assert, { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter, ESLint } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptAnalysis } from 'eslint-plugin-resilient/analyzer/typescript';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { getContractRelation, getRelationState, relateContracts } from '../transforms/policy/contract.js';
import { lowerFinalGrammar } from '../transforms/typescript/grammar/final.js';
import { lowerTupleConsumerBindings } from '../transforms/typescript/members/tuple-consumers.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { getDestructuringAgreement } from '../transforms/typescript/policy/defaults.js';
import { hasGuardFor } from '../transforms/typescript/policy/guards.js';
import { compilePlacementDecisions } from '../transforms/typescript/policy/placement.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import { collectPlacementEvidence } from '../transforms/typescript/understand/placement-evidence.js';
import { createShapeProvider } from '../transforms/typescript/understand/shape.js';
import { createSourceCensus, collectBindingReferences as collectBindingReferences2 } from '../transforms/typescript/understand/source-census.js';
import { collectSourceEvidence } from '../transforms/typescript/understand/source-report.js';
import * as evidence from '../transforms/typescript/understand/type-evidence.js';
import { collectConsumerBindingContracts, getTupleParameterContract, collectBindingReferences, collectExactProviderForwardContracts, collectProviderEdgeContracts,
    collectUnusedBindingContracts, getConsumerContractKey, collectCollectionReconstructionContracts, collectIndexedOperationContracts } from '../transforms/typescript/understand/type-evidence.js';
import { getDeclarationMap, getTypeInfo, collectTypeDeclarationBindings, getNativeUtilityName, getTypeMembers } from '../transforms/typescript/understand/type-resolution.js';
import { fixture } from './support/compiler-source.js';
import { collectCollectionDecisions } from './typescript-collection-proof.js';

// One source/Program census and completed policy own compiler identities. Keep actual symbol/AST identity, single discovery, stale/foreign rejection and reader/observer failure.

{
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
}

{
    const code = [
        'declare function make(): { run: () => number };',
        'declare function consume(value: unknown): void;',
        'export function unused(unread: number) { return 1; }',
        'export function shorthand(kept: number) { return { kept }; }',
        'export function shadow(unread: number) { return (unread: number) => unread; }',
        'export function captured(kept: number) { return () => kept; }',
        'export function predicate(unread: unknown): unread is number { return false; }',
        'export function typeQuery(kept: number) { const value: typeof kept = 1; return value; }',
        'export function catches() { try { consume(1); } catch (unread) { return 1; } }',
        'export function usedCatch() { try { consume(1); } catch (kept) { return kept; } }',
        'export function tuple(pair: [number, number]) { const [unread, kept] = pair; return kept; }',
        'export function guarded(pair: [number?]) { const [kept = 1] = pair; return kept; }',
        'export function returned() { const run = make().run; return run; }',
        'export function invoked() { const run = make().run; return run(); }',
        'export function passed() { const run = make().run; consume(run); }',
        'export function callShadow() { const run = make().run; consume((run: () => number) => run()); return run; }',
        'export function nestedCall() { const run = make().run; return () => run(); }',
        'export function memberCall() { const run = make().run; return run.call(null); }',
        'export function forward({ run }: { run: () => number }) { return { run }; }',
        'export function identity({ run }: { run: () => number }) { return run; }',
        'export function staticUse({ run }: { run: () => number }, sink: { take: (f: unknown) => unknown }) { return sink.take(run); }',
        'export function documented({ run }: { run: () => number }) {\n/** {@link run} */ const marker = 1; return { run }; }',
        'export function asyncBuilder(input: Set<number>) { const result = new Set<number>(); input.forEach(async value => { await 0; result.add(value); }); return result; }',
        'export function initializerCapture() { const result = new Set<number>((() => { result.add(1); return []; })()); return result; }',
        'export function collectionShadow(input: Set<number>) { const result = new Set<number>();',
        'input.forEach(value => { const other = (result: Set<number>) => result.add(value); consume(other); result.add(value); }); return result; }'
    ].join('\n');
    const fileName = 'binding-references.ts';
    const sourceFile = typescript.createSourceFile(fileName, code, typescript.ScriptTarget.ESNext, true);
    const options = { strict: true, target: typescript.ScriptTarget.ESNext };
    const host = typescript.createCompilerHost(options);
    const program = typescript.createProgram([fileName], options, {
        ...host, getSourceFile: (name, version) => name === fileName ? sourceFile : host.getSourceFile(name, version)
    });
    const checker = program.getTypeChecker();
    const source = { typescript, sourceFile, checker };
    const bindingReferences = collectBindingReferences(source);
    const indexed = { ...source, bindingReferences };
    const unusedBindingContracts = collectUnusedBindingContracts(indexed);
    const providerEdges = collectProviderEdgeContracts(indexed);
    const collectionReconstructionContracts = collectCollectionDecisions(indexed);
    const exactProviderForwards = collectExactProviderForwardContracts(source);
    const entries = [...collectDestructuringAgreements({
        unusedBindingContracts, providerEdges, collectionReconstructionContracts, exactProviderForwards
    }).values()].flat();
    assert.ok(entries.length);
    entries.forEach(entry => assert.ok(getDestructuringAgreement({ entry }).action));
    const nodes = (node = sourceFile) => {
        let children = [];
        typescript.forEachChild(node, (child) => { children = [...children, ...nodes(child)]; });

        return [node, ...children];
    };
    const allNodes = nodes();
    const fn = name => sourceFile.statements.find((node) => {
        const { name: { text = '' } = {} } = node;

        return typescript.isFunctionDeclaration(node) && text === name;
    });
    const parameter = name => fn(name).parameters[0];
    const hasUnused = node => unusedBindingContracts.has(getConsumerContractKey(node));
    ['unused', 'shadow', 'predicate'].forEach(name => assert.equal(hasUnused(parameter(name)), true, name));
    ['shorthand', 'captured', 'typeQuery'].forEach(name => assert.equal(hasUnused(parameter(name)), false, name));
    ['catches', 'usedCatch'].forEach((name) => {
        const clause = nodes(fn(name)).find(typescript.isCatchClause);
        assert.equal(hasUnused(clause), name === 'catches', name);
    });
    const tupleSlots = nodes(fn('tuple')).filter(typescript.isBindingElement);
    assert.deepEqual(tupleSlots.map(hasUnused), [true, false]);
    assert.equal(nodes(fn('guarded')).filter(typescript.isBindingElement).some(hasUnused), false);
    ['returned', 'invoked', 'passed', 'callShadow', 'nestedCall', 'memberCall'].forEach((name) => {
        const declaration = nodes(fn(name)).find(typescript.isVariableDeclaration);
        assert.equal(providerEdges.has(getConsumerContractKey(declaration)),
            ['returned', 'callShadow', 'memberCall'].includes(name), name);
    });
    ['forward', 'identity', 'staticUse', 'documented'].forEach((name) => {
        const binding = nodes(fn(name)).find(typescript.isBindingElement);
        assert.equal(exactProviderForwards.has(getConsumerContractKey(binding)), name === 'forward', name);
    });
    ['asyncBuilder', 'collectionShadow'].forEach((name) => {
        const declaration = nodes(fn(name)).find(typescript.isVariableDeclaration);
        const fact = collectionReconstructionContracts.get(getConsumerContractKey(declaration)) || {};
        const { collection: { mutationSites = [] } = {} } = fact;
        assert.equal(mutationSites.length, 1, name);
        const [{ key = '' } = {}] = mutationSites;
        const { name: bindingName = {} } = declaration;
        const call = allNodes.find(node => typescript.isCallExpression(node) && getConsumerContractKey(node) === key);
        const { expression: { expression: receiver = {} } = {} } = call;
        assert.equal(checker.getSymbolAtLocation(receiver), checker.getSymbolAtLocation(bindingName), name);
    });

    const initializerDeclaration = nodes(fn('initializerCapture')).find(typescript.isVariableDeclaration);
    const initializerFact = collectionReconstructionContracts.get(getConsumerContractKey(initializerDeclaration)) || {};
    const { collection: { mutationSites: initializerSites = [] } = {} } = initializerFact;
    assert.deepEqual(initializerSites, [], 'Initializer references do not belong to sibling statements.');

    assert.deepEqual(collectUnusedBindingContracts(source), unusedBindingContracts);
    assert.deepEqual(collectProviderEdgeContracts(source), providerEdges);
    assert.deepEqual(collectCollectionDecisions(source), collectionReconstructionContracts);
    assert.equal(collectBindingReferences({ typescript, sourceFile }).size, 0);
    assert.equal(collectUnusedBindingContracts({ typescript, sourceFile }).size, 0);
    assert.equal(collectProviderEdgeContracts({ typescript, sourceFile }).size, 0);
    assert.equal(collectUnusedBindingContracts({ ...source, checker: { getSymbolAtLocation: () => false } }).size, 0);
}

{
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
    assert.deepEqual(candidates.map(node => node.getText(sourceFile)), [
        'export function read(value: Alias) { return value.value; }',
        'export function collect(values: number[]) { const result: number[] = []; for (const value of values) result.push(value); return result; }',
        'result.push(value)',
        'export function forward({ run }: { run: () => number }) { return { run }; }',
        'pairs.map(([a, b]) => [a, b])',
        'export function shadow(value: number) { return (value: string) => value; }'
    ]);
    assert.ok(candidates.every(({ pos = 0 } = {}, index) => {
        const [{ pos: previousPosition = 0 } = {}] = candidates.slice(Math.max(0, index - 1), index);

        return !index || pos >= previousPosition;
    }));
    const [first = {}] = candidates;
    assert.equal(census.ancestors(first).at(-1), sourceFile);
    const references = collectBindingReferences2({ typescript: compiler, ...source, census });
    const { parameters: [{ name: values = {} } = {}] = [],
        body: { statements: [, { expression: valuesRead = {} } = {}] = [] } = {} }
        = candidates.find(({ name: { text = '' } = {} } = {}) => text === 'collect');
    const { checker = {} } = source;
    const symbol = checker.getSymbolAtLocation(values);
    assert.deepEqual(references.get(symbol), [values, valuesRead]);
    const collectors = Object.entries(evidence).filter(([name = '']) => /^collect.*Contracts$/u.test(name));
    collectors.forEach(([, collect = missing]) => {
        collect({ typescript: compiler, ...source, census, bindingReferences: references });
    });
    assert.equal(roots, 1, 'Domain admission can walk local syntax, but cannot restart source discovery.');
    const publicTransformer = createTypeScriptTransformer({ typescript: compiler, program });
    const { transform = missing } = publicTransformer;
    assert.throws(() => transform({ code: 'conflicts with the owning Program', fileName }), /source identity mismatch/u);
    roots = 0;
    const output = transform({ fileName });
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
    const otherReferences = collectBindingReferences2({ typescript, ...other, census: otherCensus });
    assert.notEqual(census.sourceFile, otherCensus.sourceFile);
    assert.equal(otherReferences.has(symbol), false);
    assert.ok([...references.keys()].filter(Boolean).every(reference => !otherReferences.has(reference)));
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
}

{
    const source = 'declare function use(cb:(pair:[number])=>string):void;use(([value])=>"actual");';
    const prepare = () => {
        const input = fixture(source);
        const { program = {} } = input;

        return { ...input, checker: program.getTypeChecker(), sourceAnalysis: createTypeScriptAnalysis(input) };
    };

    test('compiler report: contextual requirements reject equal-span foreign trees before reading the checker', () => {
        const input = prepare();
        const { sourceFile = {} } = fixture(source);
        const failure = new Error('checker should not run');
        const checker = { getTypeAtLocation() { throw failure; }, isTupleType: () => true };

        throws(() => collectSourceEvidence({ ...input, sourceFile, checker }), /source identity mismatch/u);
        collectSourceEvidence(input);
        throws(() => collectSourceEvidence({ ...input, sourceFile, checker }), /source identity mismatch/u);
    });

    test('compiler report: requirement failures remain operational and a retry uses the original source', () => {
        const input = prepare();
        const failure = new Error('checker failure');
        const checker = { getTypeAtLocation() { throw failure; }, isTupleType: () => true };

        throws(() => collectSourceEvidence({ ...input, checker }), error => error === failure);
        const report = collectSourceEvidence(input);
        const { source: reportSource = false } = report;
        const { sourceAnalysis: { source: owned = false } = {} } = input;

        deepStrictEqual(collectSourceEvidence(input), report);
        strictEqual(reportSource, owned);
    });

    test('compiler acquisition: a supplied census must belong to the original tree', () => {
        const input = fixture(source);
        const foreign = fixture(source);
        const census = createSourceCensus(foreign);

        throws(() => createTypeScriptAnalysis({ ...input, census }), /census source identity mismatch/u);
        const owned = createTypeScriptAnalysis({ ...input, census: createSourceCensus(input) });
        const independent = createTypeScriptAnalysis(input);
        const { functions: ownedFunctions = [] } = owned;
        const { functions: independentFunctions = [] } = independent;

        deepStrictEqual(ownedFunctions, independentFunctions);
        deepStrictEqual(owned.checkFunction({ index: 1 }), independent.checkFunction({ index: 1 }));
    });
}

{
    const sourceText = 'function outer([value]: [number]) { return [value]; }';
    const prepare = ({ filename = '/placement.ts', revision = '1', programRevision = '1', compilerOptionsIdentity = '{}' } = {}) => {
        const sourceFile = typescript.createSourceFile(filename, sourceText, 99, true);
        const analysis = createTypeScriptAnalysis({ typescript, sourceFile, sourceText, filename, revision, programRevision, compilerOptionsIdentity });
        const contracts = collectConsumerBindingContracts({ typescript, sourceFile, sourceAnalysis: analysis });
        const facts = new Map([...contracts].map(([key = '', contract = {}] = []) => [key, [{ kind: 'consumer', contract }]]));
        const { statements: [node = {}] = [] } = sourceFile;
        const { source = {} } = analysis;

        return { node, source, destructuringAgreements: compileDestructuringDecisions(facts) };
    };

    test('compiler placement: completed policy is consumed once without rewriting native syntax', () => {
        const input = prepare();
        const agreements = new Set();
        const { node = {} } = input;
        const result = lowerTupleConsumerBindings({ ...input, typescript, agreements });
        const [{ action = '', runtimeEvidence: { status = '' } = {} } = {}] = [...agreements];

        strictEqual(result, node);
        strictEqual(action, 'preserve-native-tuple');
        strictEqual(status, 'unknown');
    });

    [
        { filename: '/other.ts' },
        { revision: '2' },
        { programRevision: '2' },
        { compilerOptionsIdentity: '{"strict":true}' }
    ].forEach((revision, index) => test(`compiler placement: reject stale identity dimension ${index}`, () => {
        const old = prepare();
        const current = prepare(revision);
        const { source = {} } = current;
        const agreements = new Set();

        throws(() => lowerTupleConsumerBindings({ ...old, typescript, source, agreements }), /Stale compiler tuple placement/u);
        deepStrictEqual([...agreements], []);
    }));

    test('compiler placement: equal spans in a new AST cannot borrow the old decision', () => {
        const old = prepare();
        const { node = {} } = prepare();

        throws(() => lowerTupleConsumerBindings({ ...old, typescript, node }), /Stale compiler tuple placement/u);
    });

    test('compiler collection: foreign roots cannot lend equal-span proofs before or after demand', () => {
        const filename = '/original.ts';
        const sourceFile = typescript.createSourceFile(filename, sourceText, 99, true);
        const analysis = createTypeScriptAnalysis({ typescript, sourceFile, sourceText, filename,
            revision: '1', programRevision: '1', compilerOptionsIdentity: '{}' });
        const reject = () => ['/original.ts', '/foreign.ts'].forEach((name) => {
            const foreign = typescript.createSourceFile(name, sourceText, 99, true);

            throws(() => collectConsumerBindingContracts({ typescript, sourceFile: foreign, sourceAnalysis: analysis }), /source identity mismatch/u);
        });

        reject();
        analysis.checkTuple({ index: 0 });
        reject();
        strictEqual(collectConsumerBindingContracts({ typescript, sourceFile, sourceAnalysis: analysis }).size, 1);
    });

    test('compiler placement: a compiler clone with the original identity retains the decision', () => {
        const input = prepare();
        const { node = {} } = input;
        const clone = typescript.factory.updateFunctionDeclaration(node, typescript.factory.createNodeArray(),
            Reflect.get(node, 'asteriskToken'), Reflect.get(node, 'name'), Reflect.get(node, 'typeParameters'),
            Reflect.get(node, 'parameters'), Reflect.get(node, 'type'), Reflect.get(node, 'body'));
        const agreements = new Set();

        strictEqual(typescript.getOriginalNode(clone), node);
        strictEqual(lowerTupleConsumerBindings({ ...input, typescript, node: clone, agreements }), clone);
        strictEqual(agreements.size, 1);
    });

    ['number', 'string'].forEach(family => test(`compiler pair placement: ${family} second requirement reaches completed native-preservation policy`, () => {
        const filename = '/pair-placement.ts';
        const sourceText = `function outer([left, right]: [number, ${family}]) { return [left, right]; } outer([3]);`;
        const sourceFile = typescript.createSourceFile(filename, sourceText, 99, true);
        const analysis = createTypeScriptAnalysis({ typescript, sourceFile, sourceText, filename,
            revision: '1', programRevision: '1', compilerOptionsIdentity: '{}' });
        const contracts = collectConsumerBindingContracts({ typescript, sourceFile, sourceAnalysis: analysis });
        const [{ tuple: { arity = 0, containers = [] } = {}, positions = [] } = {}] = [...contracts.values()];

        strictEqual(arity, 2);
        deepStrictEqual(containers, [{ path: [], arity: 2 }]);
        deepStrictEqual(positions.map(({ path = [], name = '', kind = '' } = {}) => ({ path, name, kind })),
            [{ path: [0], name: 'left', kind: 'number' }, { path: [1], name: 'right', kind: family }]);
        const facts = new Map([...contracts].map(([key = '', contract = {}] = []) => [key, [{ kind: 'consumer', contract }]]));
        const destructuringAgreements = compileDestructuringDecisions(facts);
        const { statements: [node = {}] = [] } = sourceFile;
        const { source = {} } = analysis;
        const agreements = new Set();

        strictEqual(lowerTupleConsumerBindings({ typescript, node, source, destructuringAgreements, agreements }), node);
        const [{ runtimeEvidence: { calls: [{ slots = [] } = {}] = [] } = {} } = {}] = [...agreements];

        deepStrictEqual(slots.map(({ result: { status = '' } = {} } = {}) => status), ['agreement', 'contradiction']);
    }));

    [
        'function inner(input: number) { return [input]; } return inner(value);',
        'const result = [value]; function inner() { const result = 1; return result; } return result;',
        'const unrelated = () => 1; return [value];',
        'const unrelated = function () { return 1; }; return [value];',
        'if (value) { function unrelated() { return 1; } } return [value];'
    ].forEach((body, index) => test(`compiler forwarding placement ${index}: consume the completed shared result without a checker`, () => {
        const filename = '/forwarding-placement.ts';
        const sourceText = `export function outer([value]: [number]) { ${body} } outer(['wrong']); outer(external);`;
        const sourceFile = typescript.createSourceFile(filename, sourceText, 99, true);
        const analysis = createTypeScriptAnalysis({ typescript, sourceFile, sourceText, filename,
            revision: '1', programRevision: '1', compilerOptionsIdentity: '{}' });
        const contracts = collectConsumerBindingContracts({ typescript, sourceFile, sourceAnalysis: analysis });
        const facts = new Map([...contracts].map(([key = '', contract = {}] = []) => [key, [{ kind: 'consumer', contract }]]));
        const destructuringAgreements = compileDestructuringDecisions(facts);
        const { statements: [node = {}] = [] } = sourceFile;
        const { source = {} } = analysis;
        const agreements = new Set();

        strictEqual(lowerTupleConsumerBindings({ typescript, node, source, destructuringAgreements, agreements }), node);
        const [{ runtimeEvidence = {} } = {}] = [...agreements];

        strictEqual(runtimeEvidence, analysis.checkTuple({ index: 0 }));
        deepStrictEqual(runtimeEvidence.calls.map(({ status = '' } = {}) => status), ['contradiction', 'unknown']);
    }));
}

{
    const source = [
        'type Reducer = { concat: (left: number, right: number) => number };',
        'export const fold = (make: (option: number) => Reducer, option: number) => {',
        '    const provider = make(option);',
        '    return (values: number[]) => values.reduce(provider.concat);',
        '};'
    ].join('\n');
    const createProgram = () => {
        const fileName = 'private-state.ts';
        const options = { strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext };
        const sourceFile = typescript.createSourceFile(fileName, source, typescript.ScriptTarget.ESNext, true);
        const host = typescript.createCompilerHost(options);
        const program = typescript.createProgram([fileName], options, {
            ...host,
            getSourceFile: (name, version, ...rest) => name === fileName ? sourceFile : host.getSourceFile(name, version, ...rest)
        });

        // Bind the real Program before observing transform-owned changes.
        program.getTypeChecker();
        assert.deepEqual(program.getSemanticDiagnostics(), []);

        return { fileName, sourceFile, program };
    };
    const nodesIn = (root) => {
        let nodes = [];
        const visit = (node) => {
            nodes = [...nodes, node];
            typescript.forEachChild(node, visit);
        };

        visit(root);

        return nodes;
    };
    const descriptorsOf = nodes => nodes.map(node => Reflect.ownKeys(node).map((key) => {
        const { configurable = false, enumerable = false, writable = false, get: getter = false, set: setter = false } = Object.getOwnPropertyDescriptor(node, key);

        return { key, configurable, enumerable, writable, getter, setter };
    }));
    const syntaxOf = nodes => nodes.map(({ kind = 0, pos = 0, end = 0, parent = false } = {}) => ({ kind, pos, end, parent }));
    const transform = ({ fileName = '', program = {} } = {}) => createTypeScriptTransformer({
        typescript, program,
        standard: { object: import.meta.resolve('eslint-plugin-resilient/standard/object') }
    }).transform({ code: source, fileName });

    test('public compiler reuse leaves caller-owned Program syntax and placement independent', () => {
        const original = createProgram();
        const { sourceFile = {} } = original;
        const nodes = nodesIn(sourceFile);
        const syntax = syntaxOf(nodes);
        const descriptors = descriptorsOf(nodes);
        const first = transform(original);
        const second = transform(original);
        const distinct = transform(createProgram());
        const { code = '', diagnostics = [] } = first;

        assert.deepEqual(diagnostics, []);
        [second, distinct].forEach(({ code: nextCode = '', diagnostics: nextDiagnostics = [] } = {}) => {
            assert.equal(nextCode, code);
            assert.deepEqual(nextDiagnostics, diagnostics);
        });
        assert.equal(sourceFile.getFullText(), source);
        const after = nodesIn(sourceFile);
        assert.equal(after.length, nodes.length);
        after.forEach((node, index) => assert.equal(node, Reflect.get(nodes, index)));
        assert.deepEqual(syntaxOf(after), syntax);
        assert.deepEqual(descriptorsOf(after), descriptors);
        assert.deepEqual(after.flatMap(node => Reflect.ownKeys(node).filter(key => String(key).startsWith('__resilient'))), []);
        const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
        const linter = new Linter();
        assert.deepEqual(linter.verify(code, config), []);
        const { messages = [] } = linter.verifyAndFix(code, config);
        assert.deepEqual(messages, []);
    });
}

{
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
    // eslint-disable-next-line resilient/no-null-assignment, resilient/no-undefined-assignment -- Public relation-state validation must classify supplied null and undefined as unknown without inferring source evidence.
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
    // sparse positions, native methods, receiver and alias.
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
}
