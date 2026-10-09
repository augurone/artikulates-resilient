import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runInNewContext } from 'node:vm';

import { ESLint, Linter } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';

import { loadInternalModule } from './internal-module.js';
import { getExceptionInventory } from '../scripts/audit-eslint-exceptions.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { annotateRetainedStaticMemberAccess } from '../transforms/typescript/policy/exceptions.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import { createShapeProvider } from '../transforms/typescript/understand/shape.js';
import { collectNullishEqualityContracts, getConsumerContractKey, getTypeInfo } from '../transforms/typescript/understand/type-evidence.js';

const parse = (code = '') => typescript.createSourceFile('state.ts', code, typescript.ScriptTarget.ESNext, true);
const missing = (...args) => { throw new Error(`Missing private-state proof capability: ${args.length}`); };
const getModuleURL = ({ source = '', file = '', exports: names = [] } = {}) => {
    const url = new URL(`../${file}`, import.meta.url);
    const rebased = source.replace(/from '([^']+)'/gu, (match, relative) => (
        `from ${JSON.stringify(new URL(relative, url).href)}`
    ));

    return `data:text/javascript;base64,${Buffer.from(`${rebased}\nexport { ${names.join(', ')} };`).toString('base64')}`;
};
const loadSource = (options = {}) => import(getModuleURL(options));
const shapeCapabilities = {
    getProgramDeclarationMap: () => ({}), getDeclarationMap: () => ({}),
    getUnsupportedTypeDiagnostics: () => [], getRuntimeReferences: () => new Set(),
    getRuntimeNames: () => new Set(), getRuntimeGuardKinds: () => new Set(),
    getTypeInfo: () => ({}), getTypeText: () => '', hasRuntimeDeclaration: () => false
};
const shapeFile = 'transforms/typescript/understand/shape.js';
const shapeSource = fs.readFileSync(new URL(`../${shapeFile}`, import.meta.url), 'utf8');
const shapeTree = parse(shapeSource);
let collector;
const getName = (node = {}) => {
    const { text = '' } = node;

    return typescript.isIdentifier(node) ? text : '';
};
const findCollector = (node = {}) => {
    const { declarationList = {} } = node;
    const { declarations = [] } = typescript.isVariableStatement(node) ? declarationList : {};
    const [declaration = {}] = declarations;
    const { name = {} } = declaration;

    if (getName(name) === 'collect') collector = node;

    typescript.forEachChild(node, findCollector);
};
findCollector(shapeTree);
const collectorText = collector.getText(shapeTree);
const { end: collectorEnd = 0 } = collector;
const previousShape = `${shapeSource.slice(0, collector.getStart(shapeTree))}${shapeSource.slice(collectorEnd)}`
    .replace('            const functions = collect(statement);', `${collectorText}\n            const functions = collect(statement);`);
const { createShapeProvider: previousProvider = missing } = await loadSource({ source: previousShape, file: shapeFile });
const shapeRoot = parse('function first(a: string | number, b: string | boolean) {} function second(c: string) {}');
const { statements: shapeStatements = [] } = shapeRoot;
const [firstFunction = {}, secondFunction = {}] = shapeStatements;
const { parameters: [firstParameter = {}, secondParameter = {}] = [] } = firstFunction;
const { parameters: [lastParameter = {}] = [] } = secondFunction;
const { type: firstType = {} } = firstParameter;
const { type: secondType = {} } = secondParameter;
const { type: lastType = {} } = lastParameter;
const { types: firstParts = [] } = firstType;
const { types: secondParts = [] } = secondType;
const infos = new Map([[firstType, { kind: 'union', resolver: 'same', parts: firstParts }],
    [secondType, { kind: 'union', resolver: 'same', parts: secondParts }], [lastType, { kind: 'string', canonical: "''" }]]);
const observeShape = ({ provider = missing, failureStage = '' } = {}) => {
    let events = [];
    const failure = new Error(failureStage);
    const record = (stage = '', { pos = 0 } = {}) => {
        events = [...events, `${stage}:${pos}`];

        if (stage === failureStage) throw failure;
    };
    const checker = {};
    const sourceDeclarations = { seed: {} };
    const reservedNames = new Set(['reserved']);
    const diagnostics = [];
    const guards = new Set(['guard']);
    const runtimeSeed = new Set(['seed']);
    const compiler = { ...typescript, forEachChild: (node, callback) => {
        record('walk', node);

        return typescript.forEachChild(node, callback);
    } };
    const { createAnalysis = missing } = provider({
        ...shapeCapabilities,
        typescript: compiler,
        program: { getSourceFile: () => shapeRoot, getTypeChecker: () => checker },
        getDeclarationMap: () => sourceDeclarations,
        getUnsupportedTypeDiagnostics: () => diagnostics,
        getRuntimeReferences: () => runtimeSeed,
        getRuntimeNames: () => reservedNames,
        getRuntimeGuardKinds: () => { record('guards');

            return guards; },
        getTypeInfo: ({ node = {}, declarations = {}, reservedNames: names = {} } = {}) => {
            record('info', node);
            assert.equal(names, reservedNames);
            const { __checker: capturedChecker = false } = declarations;
            assert.equal(capturedChecker, checker);

            return infos.get(node) || { kind: 'resolved', resolver: 'object' };
        },
        getTypeText: ({ node = {} } = {}) => { record('text', node);

            return node.getText(shapeRoot); },
        hasRuntimeDeclaration: () => { record('runtime');

            return true; }
    });
    try {
        const result = createAnalysis({ fileName: 'state.ts' });
        const { contracts = [], declarations = {}, usedObjects = new Set(), usedUnions = new Map(),
            sourceFile = {}, checker: resultChecker = false, diagnostics: resultDiagnostics = [],
            reservedNames: resultNames = {}, runtimeGuardKinds = {} } = result;
        const { seed: declarationSeed = {} } = declarations;
        const { seed: sourceSeed = {} } = sourceDeclarations;

        assert.equal(sourceFile, shapeRoot);
        assert.equal(resultChecker, checker);
        assert.equal(resultDiagnostics, diagnostics);
        assert.equal(resultNames, reservedNames);
        assert.equal(runtimeGuardKinds, guards);
        assert.equal(declarationSeed, sourceSeed);
        assert.notEqual(declarations, sourceDeclarations);
        assert.deepEqual(Object.keys(declarations), ['seed']);
        assert.equal(usedUnions.get('same'), infos.get(secondType), 'Last collision wins with the exact supplied info.');
        assert.deepEqual([...usedUnions.keys()], ['same']);
        assert.deepEqual([...usedObjects], ['seed', 'object']);
        assert.deepEqual([...runtimeSeed], ['seed'], 'Private construction does not mutate its provider input.');
        assert.deepEqual(contracts.map(({ parameter = '' } = {}) => parameter), ['a', 'b', 'c']);

        return { events, contracts, objects: [...usedObjects], unionKeys: [...usedUnions.keys()] };
    } catch (error) {
        assert.equal(error, failure);

        return { events, failed: failureStage };
    }
};
['', 'walk', 'info', 'text', 'runtime', 'guards'].forEach((failureStage) => {
    assert.deepEqual(observeShape({ provider: createShapeProvider, failureStage }),
        observeShape({ provider: previousProvider, failureStage }));
});

// Count actual collector construction, not benchmark noise. Move the unchanged
// initializer back to its old scope for the oracle; no owner body is substituted.
const countSource = (source = '') => {
    const tree = parse(source);
    let initializer;
    const visit = (node = {}) => {
        const { name = {}, initializer: candidate = false } = node;

        if (typescript.isVariableDeclaration(node) && getName(name) === 'collect') initializer = candidate;

        typescript.forEachChild(node, visit);
    };
    visit(tree);
    const { end = 0 } = initializer;

    return `let constructions = 0;\n${source.slice(0, initializer.getStart(tree))}`
        + `(constructions += 1, ${initializer.getText(tree)})${source.slice(end)}\n`
        + 'const getConstructions = () => constructions;';
};
const countModules = await Promise.all([previousShape, shapeSource].map(source => loadSource({
    source: countSource(source), file: shapeFile, exports: ['getConstructions']
})));
const counts = countModules.map(({ createShapeProvider: provider = missing, getConstructions = missing } = {}) => {
    const before = getConstructions();
    const { createAnalysis = missing } = provider({ ...shapeCapabilities, typescript,
        program: { getSourceFile: () => shapeRoot } });
    createAnalysis();
    createAnalysis();

    return getConstructions() - before;
});
assert.deepEqual(counts, [4, 1], 'One provider-local collector replaces per-statement construction across analyses.');

const resolutionFile = 'transforms/typescript/understand/type-resolution.js';
const resolutionSource = fs.readFileSync(new URL(`../${resolutionFile}`, import.meta.url), 'utf8');
const { createTypeResolutionContext = missing } = await loadSource({
    source: resolutionSource.replace('return { resolve };', 'return { resolve, activeResolutions };'), file: resolutionFile
});

// The active frame is shared by recursive checker calls, not cached completion.
const reference = (name = '') => ({ kind: typescript.SyntaxKind.TypeReference,
    typeName: { kind: typescript.SyntaxKind.Identifier, text: name }, getText: () => name });
['normal', 'checker-failure', 'cleanup-failure', 'getter-failure', 'masked-failure'].forEach((mode) => {
    const node = reference('Active');
    const declarations = {};
    const { resolve: resolveType = missing, activeResolutions: active = new Set() } = createTypeResolutionContext();
    const failure = new Error(mode);
    const beforeCleanupFailure = new Error('checker before failing cleanup');
    let events = [];
    let calls = 0;
    const key = `${typescript.SyntaxKind.TypeReference}:Active:Active`;

    Object.defineProperty(active, 'delete', { get() {
        events = [...events, 'Get.delete'];

        if (mode === 'getter-failure') throw failure;

        return function(value) {
            events = [...events, 'Call.delete'];
            assert.equal(this, active);
            assert.equal(value, key);

            if (['cleanup-failure', 'masked-failure'].includes(mode)) throw failure;

            return Reflect.apply(Set.prototype.delete, this, [value]);
        };
    } });
    const checker = { getTypeAtLocation: () => {
        calls += 1;
        assert.ok(active.has(key));
        assert.equal(resolveType({ typescript, node: reference('Active'), checker, declarations }).kind, 'unknown',
            'Distinct source objects with the same semantic key re-enter as unknown before checker work.');

        if (mode === 'checker-failure') throw failure;

        if (mode === 'masked-failure') throw beforeCleanupFailure;

        return { flags: typescript.TypeFlags.String };
    } };
    const resolve = () => resolveType({ typescript, node, checker, declarations });

    if (mode === 'normal') assert.equal(resolve().kind, 'string');

    if (mode !== 'normal') assert.throws(resolve, error => error === failure);

    assert.equal(calls, 1);
    assert.deepEqual(events, mode === 'getter-failure' ? ['Get.delete'] : ['Get.delete', 'Call.delete']);
    assert.deepEqual([...active], ['normal', 'checker-failure'].includes(mode) ? [] : [key]);
    assert.deepEqual(Object.keys(declarations), []);

    if (mode === 'normal') assert.equal(resolve().kind, 'string');

    if (mode === 'checker-failure') assert.throws(resolve, error => error === failure);

    if (['normal', 'checker-failure'].includes(mode)) assert.equal(calls, 2,
        'Normal and abrupt completion release the key before retry; neither is cached.');
});
const failingDeclarations = {};
const badText = new Error('before frame entry');
assert.throws(() => getTypeInfo({ typescript, declarations: failingDeclarations,
    node: { kind: typescript.SyntaxKind.TypeReference, getText: () => { throw badText; } } }), error => error === badText);
assert.equal(Object.hasOwn(failingDeclarations, '__resolutionKeys'), false);
const convertedDeclarations = {};
const conversionChecker = { getTypeAtLocation: () => ({ flags: typescript.TypeFlags.String }),
    typeToTypeNode: () => ({ kind: typescript.SyntaxKind.StringKeyword, getText: () => 'string' }) };
assert.equal(getTypeInfo({ typescript, checker: conversionChecker, declarations: convertedDeclarations,
    node: { kind: typescript.SyntaxKind.IndexedAccessType, getText: () => 'T[K]' } }).kind, 'string');
assert.equal(Object.hasOwn(convertedDeclarations, '__resolutionKeys'), false);
assert.deepEqual(Object.keys(convertedDeclarations), []);
const addFailure = new Error('frame entry');
const { resolve: resolveEntry = missing, activeResolutions: unentered = new Set() } = createTypeResolutionContext();
let enteredChecker = false;
let attemptedCleanup = false;
Object.defineProperty(unentered, 'add', { get() { throw addFailure; } });
Object.defineProperty(unentered, 'delete', { get() { attemptedCleanup = true;

    return missing; } });
assert.throws(() => resolveEntry({ typescript, node: reference('Entry'), declarations: {},
    checker: { getTypeAtLocation: () => { enteredChecker = true;

        return {}; } } }), error => error === addFailure);
assert.equal(enteredChecker, false);
assert.equal(attemptedCleanup, false, 'A failing entry is outside the resolver try/finally; do not invent cleanup.');

const nullishRoot = parse('function run(a, b) { return a == null || b != null; } a == null;');
const nullishFacts = collectNullishEqualityContracts({ typescript, sourceFile: nullishRoot,
    checker: { getTypeAtLocation: () => ({ flags: typescript.TypeFlags.String }) } });
const { statements: [nullishFunction = {}, nullishStatement = {}] = [] } = nullishRoot;
const { body: { statements: [nullishReturn = {}] = [] } = {} } = nullishFunction;
const { expression: { right: lastComparison = {} } = {} } = nullishReturn;
assert.deepEqual([...nullishFacts.keys()], [getConsumerContractKey(nullishReturn), getConsumerContractKey(nullishStatement)]);
assert.equal(nullishFacts.get(getConsumerContractKey(nullishReturn)).comparisonRange, getConsumerContractKey(lastComparison),
    'Two comparisons sharing an owner overwrite its value without changing insertion position.');
assert.equal(collectNullishEqualityContracts({ typescript, sourceFile: nullishRoot,
    checker: { getTypeAtLocation: () => ({ flags: 0 }) } }).size, 0);

const typeFile = 'transforms/typescript/understand/type-evidence.js';
const typeSource = fs.readFileSync(new URL(`../${typeFile}`, import.meta.url), 'utf8');
const typeRoot = parse(typeSource);
let arityOwner;
const findArityOwner = (node = {}) => {
    const { declarationList = {} } = node;
    const { declarations: [declaration = {}] = [] } = typescript.isVariableStatement(node) ? declarationList : {};
    const { name = {} } = declaration;

    if (getName(name) === 'collectArityReturnContracts') arityOwner = node;

    typescript.forEachChild(node, findArityOwner);
};
findArityOwner(typeRoot);
const arityText = arityOwner.getText(typeRoot);
const arityProbe = arityText.replace('    const { statements: sourceStatements = [] } = getObject(sourceFile);',
    '    return { getReturns };\n    const { statements: sourceStatements = [] } = getObject(sourceFile);');
assert.notEqual(arityProbe, arityText);
const arityModule = await loadSource({ source: typeSource.replace(arityText, arityProbe), file: typeFile });
const { getReturns = missing } = arityModule.collectArityReturnContracts({ typescript,
    checker: { getSymbolAtLocation: () => ({}), getTypeAtLocation: () => ({}) } });
const returnsRoot = parse('function owner(a) { return function() { return 7; }; const arrow = () => 9; if (a) return a; return; function nested() { return 4; } }');
const { statements: [returnsOwner = {}] = [] } = returnsRoot;
const returns = getReturns(returnsOwner);
assert.equal(returns.length, 4);
assert.deepEqual(returns.map(node => node.getText(returnsRoot)),
    ['return function() { return 7; };', 'return a;', 'return;', 'return 4;']);
const { body: { statements: [firstReturn = {}] = [] } = {} } = returnsOwner;
assert.equal(returns[0], firstReturn);
assert.ok(returns.every(({ pos = 0 } = {}, index) => {
    const { [index - 1]: { pos: previousPosition = 0 } = {} } = returns;

    return !index || pos > previousPosition;
}));
assert.equal(getReturns({}).length, 0);

const evidence = await loadInternalModule({ file: 'transforms/typescript/understand/type-evidence.js',
    exports: ['getInvokedTupleBindings'] });
const callbackRoot = parse('const run = (first, second) => { first(); first(); (() => second())(); second(); };');
const { statements: [{ declarationList: { declarations: [{ initializer: callback = {} } = {}] = [] } = {} } = {}] = [] } = callbackRoot;
assert.deepEqual([...evidence.getInvokedTupleBindings({ typescript, callback, names: new Set(['first', 'second']) })],
    ['first', 'second']);
const nestedRoot = parse('const run = (first) => { (() => first())(); };');
const { statements: [{ declarationList: { declarations: [{ initializer: nested = {} } = {}] = [] } = {} } = {}] = [] } = nestedRoot;
assert.equal(evidence.getInvokedTupleBindings({ typescript, callback: nested, names: new Set(['first']) }).size, 0);

// Access the actual private guard owners at their return boundaries. Keep all
// imports, guards and bodies; only expose capabilities from the proof module.
const finalFile = 'transforms/typescript/grammar/final.js';
const finalSource = fs.readFileSync(new URL(`../${finalFile}`, import.meta.url), 'utf8');
const resultMarker = 'return typescript.visitNode(sourceFile, visit);';
const lastResult = finalSource.lastIndexOf(resultMarker);
const guardSource = finalSource.slice(0, lastResult) + 'return { getGuardNames };' + finalSource.slice(lastResult + resultMarker.length);
const guardModule = await loadSource({ source: guardSource, file: finalFile });
const { getGuardNames = missing } = guardModule.annotateFinalExceptions({ typescript });
const guardRoot = parse('if (isObject(value)) {}');
const { statements: [guard = {}] = [] } = guardRoot;
assert.deepEqual(getGuardNames(guard, new Map([['value', 'root'], ['missing', 'other']])), ['value', 'root']);
assert.deepEqual(getGuardNames({}, new Map([['value', 'root']])), []);
assert.deepEqual(getGuardNames(guard, new Map([['value', 'value']])), ['value']);
const aliasFailure = new Error('alias scan');
const hostileAliases = new Map();
Object.defineProperty(hostileAliases, 'forEach', { get() { throw aliasFailure; } });
assert.throws(() => getGuardNames(guard, hostileAliases), error => error === aliasFailure);
const liveGuardRoot = parse('if (isObject(value)) {}');
const { statements: [liveGuard = {}] = [] } = liveGuardRoot;
const { expression: { arguments: [valueArgument = {}] = [] } = {} } = liveGuard;
const liveSources = new Map([['value', 'root']]);
let valueReads = 0;
Object.defineProperty(valueArgument, 'text', { get() {
    valueReads += 1;

    if (valueReads === 2) Reflect.apply(Map.prototype.set, liveSources, ['isObject', 'later']);

    return 'value';
} });
assert.deepEqual(getGuardNames(liveGuard, liveSources), ['value', 'root', 'later'],
    'Metadata effects can add a later alias during native Map visitation; a snapshot is not equivalent.');

const blockMarker = '        const statements = blockStatements.flatMap((statement) => {';
const blockProbeSource = finalSource.replace(blockMarker,
    '        return { addGuardedSource, recordSourceAliases, guardedSources, sourceAliases };\n' + blockMarker)
    .replace(resultMarker, 'return { lowerAccumulatorBlock };');
const blockModule = await loadSource({ source: blockProbeSource, file: finalFile });
const { lowerAccumulatorBlock = missing } = blockModule.lowerFinalGrammar({ typescript });
const blockState = lowerAccumulatorBlock({ statements: [] }, new Map(), false, new Set(['seed']));
const { addGuardedSource = missing, recordSourceAliases = missing, guardedSources = new Set(), sourceAliases = new Map() } = blockState;
const aliases = (code = '') => {
    const { statements: [statement = {}] = [] } = parse(code);

    return statement;
};
recordSourceAliases(aliases('const { first, second, ...rest } = root;'));
recordSourceAliases(aliases('const { first } = newer;'));
assert.deepEqual([...sourceAliases], [['first', 'newer'], ['second', 'root']]);
addGuardedSource('root');
addGuardedSource('newer');
addGuardedSource('root');
assert.deepEqual([...guardedSources], ['seed', 'root', 'second', 'newer', 'first']);
assert.equal(blockState.sourceAliases, sourceAliases);
assert.equal(blockState.guardedSources, guardedSources);
recordSourceAliases({});
addGuardedSource('');
assert.deepEqual([...sourceAliases], [['first', 'newer'], ['second', 'root']]);
Object.defineProperty(sourceAliases, 'forEach', { get() { throw aliasFailure; } });
assert.throws(() => addGuardedSource('partial'), error => error === aliasFailure);
assert.ok(guardedSources.has('partial'), 'The root is published before an alias scan can fail.');

// Exact private publication units prove identity, order and partial failure;
// enclosing source admission remains covered by the existing transformer suites.
const { entries: finalEntries = [] } = getExceptionInventory({ source: finalSource });
const operations = finalEntries.filter(({ operation = '' } = {}) => (
    /^(?:guardedSources\.add|if \((?:root === source|alias|childKind === IfStatement)|sources\.set)/u.test(operation)
)).map(({ operation = '' } = {}) => operation);
assert.equal(operations.length, 5);
operations.forEach((operation = '') => {
    const environment = { source: 'root', root: 'root', alias: 'alias', sourceText: 'root', binding: 'binding',
        childKind: 1, IfStatement: 1, child: {}, getGuardNames: () => ['root', 'alias', 'root'],
        guardedSources: new Set(), sourceAliases: new Map(), guardedNames: new Set(), sources: new Map() };
    const before = { ...environment };
    runInNewContext(operation, environment);
    runInNewContext(operation, environment);
    const { guardedSources: guards = new Set(), sourceAliases: aliasMap = new Map(), sources = new Map(),
        guardedNames = new Set() } = environment;
    const { guardedSources: beforeGuards = new Set(), sourceAliases: beforeAliases = new Map(), sources: beforeSources = new Map() } = before;
    assert.equal(guards, beforeGuards);
    assert.equal(aliasMap, beforeAliases);
    assert.equal(sources, beforeSources);
    assert.deepEqual([...guards], operation.includes('guardedSources') ? [operation.includes('alias') ? 'alias' : 'root'] : []);
    assert.deepEqual([...guardedNames], operation.includes('guardedNames') ? ['root', 'alias'] : []);
    const later = { ...environment, source: 'later', sourceText: 'later' };
    runInNewContext(operation, later);

    if (operation.includes('sourceAliases.set')) assert.deepEqual([...aliasMap], [['alias', 'later']]);

    if (operation.includes('sources.set')) assert.deepEqual([...sources], [['binding', 'later']]);
});

const localLinter = new Linter({ configType: 'flat' });
const privateSources = [
    { file: shapeFile, source: shapeSource, accepts: () => true },
    { file: finalFile, source: finalSource, accepts: (operation = '') => (
        /^(?:guardedSources\.add|if \((?:root === source|alias|name|contains\(expression, binding\)|childKind === IfStatement)|sources\.set)/u
            .test(operation)
    ) },
    { file: resolutionFile, source: resolutionSource, accepts: (operation = '') => operation.startsWith('if (resolutionKey)') },
    { file: typeFile, source: typeSource, accepts: (operation = '') => (
        /^(?:invoked\.add|contracts\.set\(key|found\.push|if \(resolutionKey\) activeResolutions\.(?:add|delete))/u.test(operation)
    ) }
];
const checkedUnits = privateSources.flatMap(({ file = '', source = '', accepts = () => false } = {}) => {
    const { entries = [] } = getExceptionInventory({ file, source });
    const selected = entries.filter(({ rules = [], operation = '' } = {}) => (
        rules.includes('resilient/prefer-safe-transformations') && accepts(operation)
    ));
    const raw = selected.toReversed().reduce((code = '', { range: [start = 0, end = 0] = [] } = {}) => (
        code.slice(0, start) + code.slice(start, end).replace(/[^\r\n]/gu, ' ') + code.slice(end)
    ), source);
    const messages = localLinter.verify(raw, [{ plugins: { resilient },
        rules: { 'resilient/prefer-safe-transformations': 'error' } }], { filename: file });
    selected.forEach(({ location: { line = 0 } = {} } = {}) => {
        assert.ok(messages.some(({ ruleId = '', line: findingLine = 0 } = {}) => (
            ruleId === 'resilient/prefer-safe-transformations' && findingLine === line + 1
        )), `${file}:${line}: check the actual owning rule before retaining a private exception.`);
    });

    return selected;
});
assert.equal(checkedUnits.length, 16);

const pipelineFile = 'transforms/typescript/index.js';
const pipelineSource = fs.readFileSync(new URL(`../${pipelineFile}`, import.meta.url), 'utf8');
const previousPipeline = pipelineSource.replace("'./understand/shape.js'", JSON.stringify(getModuleURL({ source: previousShape, file: shapeFile })));
assert.notEqual(previousPipeline, pipelineSource);
const pipelines = await Promise.all([previousPipeline, pipelineSource].map(source => loadSource({ source, file: pipelineFile })));
const publicFixtures = [
    { code: 'function run({ value }: { value: number }) { return value; }', probe: 'run({ value: 3 })' },
    { code: 'function run(value: string | number) { return typeof value === "string" ? value : String(value); }', probe: 'run(3)' },
    { code: 'function run<T>(value: T) { return value; }', probe: 'run("opaque")' },
    { code: 'function run(value: string) { return () => value; }', probe: 'run("deferred")()' }
];
const rawLinter = new ESLint();
const fixedLinter = new ESLint({ fix: true });
const execute = (code = '', probe = '') => {
    const { outputText = '' } = typescript.transpileModule(code, {
        compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.CommonJS }
    });

    return runInNewContext(`${outputText}\n${probe}`, { exports: {} });
};
await Promise.all(publicFixtures.map(async ({ code = '', probe = '' } = {}) => {
    const results = pipelines.map(({ createTypeScriptTransformer = missing } = {}) => {
        const { transform = missing } = createTypeScriptTransformer({ typescript });

        return transform({ code, fileName: 'private-state.ts' });
    });
    const [beforeResult = {}, afterResult = {}] = results;
    assert.deepEqual(beforeResult, afterResult);
    const [{ code: generated = '' } = {}] = results;
    assert.equal(execute(generated, probe), execute(code, probe));
    await Promise.all([rawLinter, fixedLinter].map(async (linter) => {
        const [[before = {}] = [], [after = {}] = []] = await Promise.all(results.map(({ code: output = '' } = {}) => (
            linter.lintText(output, { filePath: 'private-state-proof.js' })
        )));
        const { messages: beforeMessages = [], output: beforeOutput = '' } = before;
        const { messages: afterMessages = [], output: afterOutput = '' } = after;
        assert.deepEqual(beforeMessages, afterMessages);
        assert.equal(beforeOutput, afterOutput);
        assert.equal(execute(afterOutput || generated, probe), execute(code, probe));
    }));
}));

// Retained placement is transform-owned state. It must not add a Resilient
// descriptor to input nodes, including when one Program is transformed again
// or when the final tree uses generated shells with original-node provenance.
const retainedSource = [
    'function first(as, S) { return as.reduce(S.concat); }',
    'function second(as, S) { return as.reduce(S.concat); }'
].join('\n');
const collectNodes = (root = {}) => {
    const nodes = [];
    const visit = (node = {}) => {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- This proof retains each caller-owned node identity for descriptor comparison.
        nodes.push(node);
        typescript.forEachChild(node, visit);
    };

    visit(root);

    return nodes;
};
const descriptorShape = (node = {}) => Reflect.ownKeys(node).map((key) => {
    const { enumerable = false, configurable = false, writable = false,
        get: getter = false, set: setter = false } = Object.getOwnPropertyDescriptor(node, key);

    return [typeof key === 'symbol' ? key.toString() : key, Boolean(enumerable),
        Boolean(configurable), Boolean(writable), typeof getter, typeof setter];
});
const retainedAgreements = (root = {}) => {
    const reads = collectNodes(root).filter(({ kind = -1, name: { text = '' } = {} } = {}) => (
        kind === typescript.SyntaxKind.PropertyAccessExpression && text === 'concat'
    ));
    const contracts = new Map(reads.map((read = {}) => {
        const sourceRange = getConsumerContractKey(read);

        return [sourceRange, {
            action: 'retain-receiver-ordered-projection', sourceRange,
            providerName: 'S', receiverName: 'as', projectedMember: 'concat', receiverMethod: 'reduce'
        }];
    }));

    return compileDestructuringDecisions(collectDestructuringAgreements({
        receiverOrderedProjectionContracts: contracts
    }));
};
const placeRetainedReads = ({ sourceFile = {}, cloneReturns = false } = {}) => {
    const destructuringAgreements = retainedAgreements(sourceFile);
    const { transformed: [placed = sourceFile] = [], dispose = () => {} } = typescript.transform(sourceFile, [context => ((root) => {
        const cloneReturn = (node = {}) => {
            const visited = typescript.visitEachChild(node, cloneReturn, context);

            if (!cloneReturns || !typescript.isReturnStatement(node)) return visited;

            return typescript.setOriginalNode(typescript.factory.cloneNode(visited), node);
        };

        return annotateRetainedStaticMemberAccess({ typescript,
            sourceFile: typescript.visitNode(root, cloneReturn), destructuringAgreements, context });
    })]);
    const output = typescript.createPrinter().printFile(placed);

    dispose();

    return output;
};
const retainedProgram = parse(retainedSource);
const retainedNodes = collectNodes(retainedProgram);
const retainedDescriptors = retainedNodes.map(descriptorShape);
const retainedText = retainedProgram.getFullText();
const retainedReturns = retainedNodes.filter(node => typescript.isReturnStatement(node));
const firstRetainedOutput = placeRetainedReads({ sourceFile: retainedProgram });
const secondRetainedOutput = placeRetainedReads({ sourceFile: retainedProgram });
const clonedRetainedOutput = placeRetainedReads({ sourceFile: retainedProgram, cloneReturns: true });

assert.equal(firstRetainedOutput, secondRetainedOutput, 'A repeated transform cannot retain state on its input Program.');
assert.equal(firstRetainedOutput, clonedRetainedOutput,
    'Original-node provenance carries the same retained reason to a generated statement shell.');
assert.equal(firstRetainedOutput.split('projected method getter follows receiver method lookup').length - 1, 2);
assert.equal(retainedProgram.getFullText(), retainedText);
assert.deepEqual(collectNodes(retainedProgram).filter(node => typescript.isReturnStatement(node)), retainedReturns);
assert.deepEqual(retainedNodes.map(descriptorShape), retainedDescriptors,
    'Final placement does not add or alter descriptors on caller-owned nodes.');
retainedNodes.forEach((node = {}) => {
    assert.equal(Reflect.ownKeys(node).some(key => String(key).startsWith('__resilient')), false);
});

const baselineProgram = parse(retainedSource);
const { dispose: releaseBaseline = () => {} } = typescript.transform(baselineProgram, [() => root => root]);
releaseBaseline();
assert.deepEqual(collectNodes(retainedProgram).map(descriptorShape), collectNodes(baselineProgram).map(descriptorShape),
    'Compiler-owned node metadata remains identical to the TypeScript-only baseline.');

const distinctProgram = parse(retainedSource);
assert.equal(placeRetainedReads({ sourceFile: distinctProgram }), firstRetainedOutput,
    'Distinct Programs receive equivalent placement without sharing transform state.');
const retainedRule = 'resilient/prefer-destructured-member-access';
const retainedConfig = [{ plugins: { resilient }, rules: { [retainedRule]: 'error' } }];
const retainedReports = output => new Linter({ configType: 'flat' }).verify(output, retainedConfig)
    .map(({ ruleId = '', line = 0, message = '' } = {}) => ({ ruleId, line, message }));
assert.deepEqual(retainedReports(firstRetainedOutput), retainedReports(clonedRetainedOutput));
