import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

import { ESLint, Linter } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { isFunction } from 'eslint-plugin-resilient/standard/function';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { getObject } from '../analysis/host/object.js';
import { getExceptionInventory } from '../scripts/audit-eslint-exceptions.js';
import { annotateFinalExceptions } from '../transforms/typescript/grammar/final.js';
import { renderResolverPredicate } from '../transforms/typescript/grammar/resolver-predicates.js';
import { getObjectResolverGuardKinds, getObjectResolverDeclaration } from '../transforms/typescript/grammar/resolvers.js';
import { lowerGuardedConditionalReturns } from '../transforms/typescript/lowering/guarded-returns.js';
import { lowerExactProviderForwarding } from '../transforms/typescript/members/exact-provider-forwarding.js';
// eslint-disable-next-line import/no-useless-path-segments -- Node ESM requires the member grammar entry filename.
import { lowerDiscriminatedSwitchAccess } from '../transforms/typescript/members/index.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { getDestructuringAgreement } from '../transforms/typescript/policy/defaults.js';
import { getRuntimeBindingDependencies, getRuntimeBindingIdentities, getRuntimeBindingNames, getCyclicRuntimeBindingNames, orderRuntimeBindingStatements, placeGeneratedRuntimeStatements } from
    '../transforms/typescript/policy/dependencies.js';
import { getDestructuringDecisionForNode, findCapabilityConsumerDecision } from '../transforms/typescript/policy/destructuring-agreements.js';
import { annotateRetainedStaticMemberAccess } from '../transforms/typescript/policy/exceptions.js';
import { compilePlacementDecisions } from '../transforms/typescript/policy/placement.js';
import { createResolverPolicy } from '../transforms/typescript/policy/resolvers.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import { collectPlacementEvidence } from '../transforms/typescript/understand/placement-evidence.js';
import {
    collectDeferredSignatureSelectionContracts, collectDetachedPromiseForwardContracts, collectAritySignatureContracts, collectIndexedOperationContracts,
    collectNativeFunctionContracts, collectFactoryBindingContracts, collectTypedIgnoredArgumentCallContracts, getConsumerContractKey, collectRequiredTupleBindingContracts,
    collectDirectCapabilityContracts, collectCallableOperationContracts, collectClosedStructuralModelContracts, collectExactProjectionContracts, collectProviderForwardContracts,
    collectSelectedModelContracts, collectDeferredSelectedPayloadContracts, collectMutableSelectedLoopContracts, collectRepeatedParameterReadContracts, getSelectedModelPredicateFact,
    getVariantPartitions, collectDeclarationLifetimeContracts, collectHoistedFunctionContracts, collectDeclaredNullishResultContracts, collectOrderedDecisionContracts,
    collectDeferredOpaqueFieldContracts, collectExactProviderForwardContracts, collectSortCapabilityContracts, collectSamePhaseSelectedBindingContracts
} from '../transforms/typescript/understand/type-evidence.js';
import { getCheckerContract, getCheckerTypeNode, isUnionType, getObjectDiscriminator, getObjectShapeCheck, getTypeInfo, getRuntimeKind, getDeclarationMap } from
    '../transforms/typescript/understand/type-resolution.js';
import { emissionSyntax } from './support/emission-syntax.js';
import { observeModule, loadModule } from './support/module.js';

// Actual emitted value/receiver/arity/absence and failure behavior, full policy findings and rejected premise controls own lowering acceptance. Remove private strategy and spelling mirrors.
const nodesOfKindShared = ({ root = {}, kind = -1 } = {}) => {
    let nodes = [];
    const visit = (node = {}) => {
        const { kind: nodeKind = -1 } = node;

        if (nodeKind === kind) nodes = [...nodes, node];

        typescript.forEachChild(node, visit);
    };
    visit(root);

    return nodes;
};

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-deferred-signature-'));
    const fileName = path.join(directory, 'comparison.ts');
    const source = [
        "type Variant = { category: 'Present'; value: number } | { category: 'Missing' };",
        "export const isObject = (input: unknown): input is object => typeof input === 'object' && input !== null;",
        "export const isPresent = (value: Variant): value is Extract<Variant, { category: 'Present' }> => value.category === 'Present';",
        'export const compare = (x: Variant, y: Variant) =>',
        '    x === y ? 0 : isPresent(x) ? (isPresent(y) ? x.value - y.value : 1) : isPresent(y) ? -1 : 0;',
        ''
    ].join('\n');

    try {
        await writeFile(fileName, source);
        const program = typescript.createProgram([fileName], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const contracts = collectDeferredSignatureSelectionContracts({
            typescript, sourceFile: program.getSourceFile(fileName), checker: program.getTypeChecker()
        });
        const [fact = {}] = [...contracts.values()];

        assert.equal(fact.parameter, 'y');
        assert.equal(fact.readRanges.length, 2);

        const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
            code: source, fileName
        });

        assert.deepEqual(diagnostics, []);
        assert.doesNotMatch(code, /const \{ category: yTag/);
        assert.equal((code.match(/isPresent\(y\)/gu) || []).length, 2,
            'Completed deferred selection preserves both original predicate invocations.');
        assert.doesNotMatch(code, /\(\{[^)]*category[^)]*\},\s*\{/);

        const eslintConfig = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
        const [raw = {}] = await new ESLint({ overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(code, { filePath: 'comparison-generated.js' });
        const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(code, { filePath: 'comparison-generated.js' });

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
        const fixedModule = await importCode(fixed.output || code);
        const observe = (module) => {
            let traces = [];
            const input = (name, tag, value) => ({
                get category() {
                    traces = [...traces, name];

                    return tag;
                },
                value
            });
            const present = input('x', 'Present', 3);
            const other = input('y', 'Present', 5);
            const missing = input('m', 'Missing', 0);
            const same = module.compare(present, present);
            const before = [...traces];
            const different = module.compare(present, other);
            const inbound = module.compare(missing, present);

            return { same, before, different, inbound, traces };
        };

        assert.deepEqual(observe(generatedModule), observe(sourceModule));
        assert.deepEqual(observe(fixedModule), observe(sourceModule));

        const rejectedFile = path.join(directory, 'boolean-predicate.ts');
        const rejectedSource = source.replace(
            "value is Extract<Variant, { category: 'Present' }>", 'boolean'
        );

        await writeFile(rejectedFile, rejectedSource);
        const rejectedProgram = typescript.createProgram([rejectedFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });

        assert.equal(collectDeferredSignatureSelectionContracts({
            typescript, sourceFile: rejectedProgram.getSourceFile(rejectedFile),
            checker: rejectedProgram.getTypeChecker()
        }).size, 0);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-detached-promise-'));
    await writeFile(path.join(directory, 'package.json'), '{"type":"module"}\n');

    try {
        const fileName = path.join(directory, 'deferred.ts');
        const source = [
            'export const deferred = (work: () => Promise<number>, enabled: boolean) =>',
            '    new Promise<number>((resolve) => {',
            '        globalThis.setTimeout(() => {',
            '            if (enabled) {',
            '                Promise.resolve().then(work).then(resolve);',
            '            }',
            '        }, 0);',
            '    });',
            ''
        ].join('\n');

        await writeFile(fileName, source);
        const program = typescript.createProgram([fileName], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        });
        const facts = collectDetachedPromiseForwardContracts({
            typescript,
            sourceFile: program.getSourceFile(fileName),
            checker: program.getTypeChecker()
        });

        const [fact = {}] = facts.values();
        const { sourceRange = '', chainRange = '', ownerRange = '' } = fact;

        assert.ok(sourceRange);
        assert.ok(chainRange);
        assert.ok(ownerRange);
        const agreements = collectDestructuringAgreements({
            typescript,
            detachedPromiseForwardContracts: facts
        });
        const sourceEntries = agreements.get(sourceRange) || [];
        const [entry = {}] = sourceEntries;
        const { action = '', owner = '' } = getDestructuringAgreement({ entry });

        assert.equal(action, 'explicit-detached-promise-forwarding');
        assert.equal(owner, 'boundary');

        const generated = createTypeScriptTransformer({ typescript, program }).transform({
            code: source,
            fileName
        });

        assert.deepEqual(generated.diagnostics, []);
        assert.match(generated.code, /void Promise\.resolve\(\)\.then\(work\)\.then\(resolve\);/);
        assert.equal((generated.code.match(/eslint-disable-next-line resilient\/prefer-async-await/g) || []).length, 1);
        assert.doesNotMatch(generated.code, /\.catch\(|return Promise\.resolve|await Promise\.resolve/);
        const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
        const raw = new ESLint({ overrideConfigFile: true, overrideConfig: config });
        const fixed = new ESLint({ fix: true, overrideConfigFile: true, overrideConfig: config });
        const [rawResult = {}] = await raw.lintText(generated.code, { filePath: 'deferred.js' });
        const [fixedResult = {}] = await fixed.lintText(generated.code, { filePath: 'deferred.js' });

        [rawResult, fixedResult].forEach(({ errorCount = -1, warningCount = -1, messages = [] } = {}) => {
            assert.equal(errorCount, 0, `${JSON.stringify(messages)}\n${generated.code}`);
            assert.equal(warningCount, 0, `${JSON.stringify(messages)}\n${generated.code}`);
        });

        const rejectedFileName = path.join(directory, 'rejected.ts');
        const rejectedSource = [
            'export const unowned = (work: () => Promise<number>, onValue: (n: number) => void) => {',
            '    Promise.resolve().then(work).then(onValue);',
            '};',
            'export const computed = (work: () => Promise<number>) => new Promise<number>((resolve) => {',
            "    Promise.resolve().then(work)['then'](resolve);",
            '});',
            'export const other = (work: () => Promise<number>, onValue: (n: number) => void) =>',
            '    new Promise<number>((resolve) => {',
            '        Promise.resolve().then(work).then(onValue);',
            '    });',
            ''
        ].join('\n');

        await writeFile(rejectedFileName, rejectedSource);
        const rejectedProgram = typescript.createProgram([rejectedFileName], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        });

        assert.equal(collectDetachedPromiseForwardContracts({
            typescript,
            sourceFile: rejectedProgram.getSourceFile(rejectedFileName),
            checker: rejectedProgram.getTypeChecker()
        }).size, 0);

        const { outputText: referenceCode = '' } = typescript.transpileModule(source, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const referenceFile = path.join(directory, 'reference.js');
        const generatedFile = path.join(directory, 'generated.js');

        await writeFile(referenceFile, referenceCode);
        await writeFile(generatedFile, generated.code);
        const reference = await import(pathToFileURL(referenceFile).href);
        const output = await import(pathToFileURL(generatedFile).href);
        let referenceCalls = 0;
        let outputCalls = 0;

        assert.equal(await reference.deferred(() => {
            referenceCalls += 1;

            return Promise.resolve(9);
        }, true), 9);
        assert.equal(await output.deferred(() => {
            outputCalls += 1;

            return Promise.resolve(9);
        }, true), 9);
        assert.equal(referenceCalls, 1);
        assert.equal(outputCalls, 1);

        const untouched = async (deferred) => {
            let calls = 0;
            const pending = deferred(() => {
                calls += 1;

                return Promise.resolve(3);
            }, false);
            const settlement = await Promise.race([
                pending,
                new Promise((resolve) => { setTimeout(() => { resolve('pending'); }, 5); })
            ]);

            return { calls, settlement };
        };

        assert.deepEqual(await untouched(output.deferred), await untouched(reference.deferred));

        const observeRejected = async (deferred) => {
            let seen = [];
            const listener = ({ message = '' } = {}) => { seen = [...seen, message]; };

            process.on('unhandledRejection', listener);

            try {
                const pending = deferred(() => Promise.reject(new Error('failure')), true);

                await new Promise((resolve) => { setTimeout(resolve, 25); });
                const settlement = await Promise.race([
                    pending,
                    new Promise((resolve) => { setTimeout(() => { resolve('pending'); }, 5); })
                ]);

                return { seen, settlement };
            } finally {
                process.off('unhandledRejection', listener);
            }
        };

        assert.deepEqual(await observeRejected(output.deferred), await observeRejected(reference.deferred));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-dynamic-arguments-'));
    const fileName = path.join(directory, 'arguments.ts');
    const source = [
        'export const immediate = (function(){ return Array.isArray(arguments); })();',
        'export const native = function(this: unknown) {',
        '    const own = arguments;',
        '    return { receiver: this, own, copy: Array.from(own), captured: () => arguments };',
        '};',
        'export function fold(first: number, ...steps: Array<(value: number) => number>): number {',
        '    let result = arguments[0];',
        '    for (let i = 1; i < arguments.length; i += 1) result = arguments[i](result);',
        '    return steps.length ? result : first;',
        '}',
        'export function computed(outer: string) {',
        '    const own = arguments[0];',
        '    const keyed = (function(inner: string) {',
        '        void inner;',
        '',
        '        return { [arguments[0]]() { return 1; } };',
        '    })("inner");',
        '    return { own, keys: Object.keys(keyed) };',
        '}',
        'export const safe = (function() { type NativeArgs = typeof arguments; const object = { arguments: 42 }; return object.arguments; })();',
        ''
    ].join('\n');

    try {
        await writeFile(fileName, source);
        const program = typescript.createProgram([fileName], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const contracts = collectIndexedOperationContracts({
            typescript, sourceFile: program.getSourceFile(fileName), checker: program.getTypeChecker()
        });
        const [loopFact = {}] = [...contracts.values()].filter(({ operationRole = '' } = {}) => (
            operationRole === 'dynamic-arguments-loop'
        ));

        assert.ok(loopFact.loopRange);

        const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
            code: source, fileName
        });

        assert.deepEqual(diagnostics, []);
        assert.match(code, /arguments\[0\]/);
        assert.match(code, /arguments\[i\]/);
        assert.match(code, /eslint-disable-next-line resilient\/prefer-prototype-methods -- Live arguments indexing/);
        assert.doesNotMatch(code, /Array\.from\(arguments\)|\.\.\.arguments/);

        const eslintConfig = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
        const [raw = {}] = await new ESLint({ overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(code, { filePath: 'arguments-generated.js' });
        const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(code, { filePath: 'arguments-generated.js' });

        assert.equal(raw.errorCount, 0, JSON.stringify({ messages: raw.messages, code }));
        assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));
        const [safe = {}] = nodesOfKindShared({ root: typescript.createSourceFile('arguments-output.js', code, typescript.ScriptTarget.ESNext, true),
            kind: typescript.SyntaxKind.VariableDeclaration }).filter(({ name: { text = '' } = {} } = {}) => text === 'safe');
        const { initializer: { expression: safeCallee = {} } = {} } = safe;

        assert.ok(typescript.isArrowFunction(typescript.skipOuterExpressions(safeCallee)), 'Property and erased type names need no native-function exception');

        const { outputText: sourceJavaScript = '' } = typescript.transpileModule(source, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const importCode = async text => import(`data:text/javascript,${encodeURIComponent(text)}`);
        const sourceModule = await importCode(sourceJavaScript);
        const generatedModule = await importCode(code);
        const fixedModule = await importCode(fixed.output || code);
        const observe = (module) => {
            let calls = 0;
            const result = module.fold(2,
                (value) => {
                    calls += 1;

                    return value * 3;
                },
                (value) => {
                    calls += 1;

                    return value + 4;
                });

            return { result, calls, empty: module.fold(0) };
        };

        [sourceModule, generatedModule, fixedModule].forEach((module) => {
            assert.equal(Reflect.get(module, 'immediate'), false, 'Immediate native arguments retain their own object family');
            assert.deepEqual(module.computed('outer'), { own: 'outer', keys: ['inner'] }, 'Computed keys read the IIFE arguments, not the enclosing function arguments');
            assert.equal(Reflect.get(module, 'safe'), 42);
            const invoke = Reflect.get(module, 'native');
            const receiver = {};
            const item = {};
            const { receiver: actual = false, own = false, copy = [], captured = () => false } = Reflect.apply(invoke, receiver, [item, 42]);

            assert.equal(actual, receiver);
            assert.equal(Array.isArray(own), false, 'A native arguments object cannot be replaced by the rest array');
            assert.equal(Reflect.get(own, 'length'), 2);
            assert.equal(copy.at(0), item);
            assert.equal(captured(), own, 'The arrow retains its lexical arguments owner');
            assert.throws(() => Reflect.get(own, 'callee'), TypeError, 'Strict native arguments retain their poison accessor');
            assert.equal(Reflect.get(invoke, 'length'), 0);
            const { receiver: constructed = false } = Reflect.construct(invoke, [item]);

            assert.equal(Object.getPrototypeOf(constructed), Reflect.get(invoke, 'prototype'));
            assert.equal(Reflect.get(Reflect.get(Reflect.apply(invoke, receiver, []), 'own'), 'length'), 0);
        });

        assert.deepEqual(observe(generatedModule), observe(sourceModule));
        assert.deepEqual(observe(fixedModule), observe(sourceModule));

        const arityFile = path.join(directory, 'arity-source-facts.ts');
        const aritySource = [
            'export function mutate(first: Function, second?: Function) {',
            '    switch (arguments.length) {',
            '        case 2: second = first; return { same: second === first };',
            "        default: return { same: true, state: 'omitted' };",
            '    }',
            '}',
            'export function fall(first: Function, second?: Function, third?: Function) {',
            '    switch (arguments.length) {',
            '        case 2: second = first;',
            '        case 3: return { same: second === first, third };',
            "        default: return { same: true, state: 'omitted' };",
            '    }',
            '}',
            'export function explicit(first: Function, second?: Function) {',
            '    switch (arguments.length) {',
            "        case 2: return second === undefined ? 'explicit-undefined' : 'value';",
            "        default: return 'omitted';",
            '    }',
            '}',
            'export const lengths = { mutate: mutate.length, fall: fall.length, explicit: explicit.length };',
            ''
        ].join('\n');

        await writeFile(arityFile, aritySource);
        const arityProgram = typescript.createProgram([arityFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const aritySourceFile = arityProgram.getSourceFile(arityFile);
        const arityFacts = collectAritySignatureContracts({
            typescript, sourceFile: aritySourceFile, checker: arityProgram.getTypeChecker()
        });
        const mutateFact = [...arityFacts.values()].find(({ sourceName = '' } = {}) => sourceName === 'mutate');
        const { parameters: mutateParameters = [] } = mutateFact;
        const [mutateParameter = {}] = mutateParameters;

        assert.equal(mutateParameter.mutable, true, 'Understand records reassignment before the formal is replaced.');
        assert.ok(mutateParameter.writeRanges.length);

        const { code: arityCode = '', diagnostics: arityDiagnostics = [] } = createTypeScriptTransformer({
            typescript, program: arityProgram
        }).transform({ code: aritySource, fileName: arityFile });

        assert.deepEqual(arityDiagnostics, []);
        assert.doesNotMatch(arityCode, /_resilientArgs|Object\.defineProperty\(mutate|Object\.defineProperty\(fall/u);
        assert.match(arityCode, /function mutate\(first, second\)/u);
        const [arityRaw = {}] = await new ESLint({ overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(arityCode, { filePath: 'arity-source-facts-generated.js' });
        const [arityFixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(arityCode, { filePath: 'arity-source-facts-generated.js' });

        assert.equal(arityRaw.errorCount, 0, JSON.stringify(arityRaw.messages));
        assert.equal(arityFixed.errorCount, 0, JSON.stringify(arityFixed.messages));
        const executeArity = (text = '') => {
            const { outputText = '' } = typescript.transpileModule(text, {
                compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
            });

            return observeModule({ code: outputText, probe: `(namespace) => {
            const first = function first() {};
            return JSON.stringify({
                mutateOmitted: namespace.mutate(first),
                mutatePresent: namespace.mutate(first, function second() {}),
                fall: namespace.fall(first, function second() {}),
                omitted: namespace.explicit(first),
                explicit: namespace.explicit(first, undefined),
                lengths: namespace.lengths
            });
        }` });
        };

        assert.equal(executeArity(arityCode), executeArity(aritySource),
            'Source and lowered arity preserve writes, arguments count, fallthrough, absence, explicit undefined and length.');

        const privateFile = path.join(directory, 'private-arity.ts');
        const privateSource = [
            '// eslint-disable-next-line no-restricted-syntax -- Private arity dispatch requires the callable own arguments object, not lexical arrow arguments.',
            'const expression = function(first: Function, second?: Function, third?: Function) {',
            '    switch (arguments.length) {',
            '        case 2: second = first;',
            '        case 3: return [second === first, third];',
            '        default: return [first, first];',
            '    }',
            '};',
            '// eslint-disable-next-line no-restricted-syntax -- Native presence dispatch requires this named callable own arguments object.',
            'const declaration = function declaration(first: Function, second?: Function) {',
            '    switch (arguments.length) { case 2: return second; default: return first; }',
            '};',
            '// eslint-disable-next-line no-restricted-syntax -- The overwrite oracle mutates its own arguments length before dispatch.',
            'const overwritten = function overwritten(first: Function, second?: Function) {',
            '    arguments.length = 1;',
            '    switch (arguments.length) {',
            '        case 1:',
            '        case 2: return second;',
            '        default: return first;',
            '    }',
            '};',
            '// eslint-disable-next-line no-restricted-syntax -- The accessor oracle replaces its own arguments length with an observable getter.',
            'const accessor = function accessor(first: Function, second?: Function) {',
            '    let reads = 0;',
            '    Object.defineProperty(arguments, "length", { get() { reads += 1; return 2; } });',
            '    switch (arguments.length) { case 2: return [second, reads]; default: return [first, reads]; }',
            '};',
            'const first = () => {};',
            'const second = () => {};',
            'export const results = [',
            '    expression(first),',
            '    expression(first, undefined),',
            '    expression(first, second, undefined),',
            '    declaration(first, second),',
            '    overwritten(first, second),',
            '    accessor(first, second)',
            '];',
            ''
        ].join('\n');

        await writeFile(privateFile, privateSource);
        const privateProgram = typescript.createProgram([privateFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const privateFacts = collectAritySignatureContracts({
            typescript, sourceFile: privateProgram.getSourceFile(privateFile), checker: privateProgram.getTypeChecker()
        });

        const { code: privateCode = '', diagnostics: privateDiagnostics = [] } = createTypeScriptTransformer({
            typescript, program: privateProgram
        }).transform({ code: privateSource, fileName: privateFile });

        assert.deepEqual(privateDiagnostics, []);
        assert.equal([...privateFacts.values()].filter(({ privateFunction = false } = {}) => privateFunction).length, 4);

        assert.match(privateCode, /function \(first, \.\.\._resilientArgs\)/u);
        assert.match(privateCode, /function declaration\(first, \.\.\._resilientArgs\)/u);
        assert.doesNotMatch(privateCode, /Object\.defineProperty\((?:expression|declaration|overwritten|accessor)/u);
        assert.doesNotMatch(privateCode, /arguments\.length > /u);
        assert.match(privateCode, /_resilientArgs\.length/u);
        const observePrivate = (text = '') => {
            const { outputText = '' } = typescript.transpileModule(text, {
                compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
            });

            return observeModule({ code: outputText,
                probe: `(namespace) => JSON.stringify(namespace.results, (_key, value) => typeof value === 'function' ? value.name : value)` });
        };

        assert.equal(observePrivate(privateCode), observePrivate(privateSource));
        assert.equal(JSON.parse(observePrivate(privateCode))[5][1], 1,
            'The authored arguments length getter runs once at dispatch.');
        const [privateRawLint = {}] = await new ESLint({ overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(privateCode, { filePath: 'private-arity-generated.js' });
        const [privateFixedLint = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(privateCode, { filePath: 'private-arity-generated.js' });

        assert.deepEqual(privateRawLint.messages.map(({ ruleId = '' } = {}) => ruleId),
            ['resilient/prefer-safe-transformations']);
        assert.deepEqual(privateFixedLint.messages.map(({ ruleId = '' } = {}) => ruleId),
            ['resilient/prefer-safe-transformations']);
        assert.equal(observePrivate(privateFixedLint.output || privateCode), observePrivate(privateSource),
            'Native fixing must preserve private arity presence and dispatch behavior.');
        const { code: privateMinimumCode = '', diagnostics: privateMinimumDiagnostics = [] } = createTypeScriptTransformer({
            typescript, program: privateProgram, target: typescript.ScriptTarget.ES2016
        }).transform({ code: privateSource, fileName: privateFile });

        assert.deepEqual(privateMinimumDiagnostics, []);
        assert.equal(observePrivate(privateMinimumCode), observePrivate(privateSource));
        const throwingFile = path.join(directory, 'private-throwing-dispatch.ts');
        const throwingSource = [
            'export let reads = 0;',
            'const choose = function(first: Function, second?: Function) {',
            '    const failure = new Error("dispatch");',
            '    Object.defineProperty(arguments, "length", { get() { reads += 1; throw failure; } });',
            '    switch (arguments.length) { case 2: return second; default: return first; }',
            '};',
            'export let observed = "";',
            'try { choose(function first() {}, function second() {}); } catch (error) { observed = (error as Error).message; }',
            ''
        ].join('\n');

        await writeFile(throwingFile, throwingSource);
        const throwingProgram = typescript.createProgram([throwingFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const { code: throwingCode = '', diagnostics: throwingDiagnostics = [] } = createTypeScriptTransformer({
            typescript, program: throwingProgram
        }).transform({ code: throwingSource, fileName: throwingFile });
        const { outputText: throwingBaseline = '' } = typescript.transpileModule(throwingSource, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const [throwingFixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(throwingCode, { filePath: 'private-throwing-dispatch.js' });
        const observeThrowing = async (text) => {
            const { observed = '', reads = 0 } = await importCode(text);

            return { observed, reads };
        };

        assert.deepEqual(typescript.getPreEmitDiagnostics(throwingProgram), []);
        assert.deepEqual(throwingDiagnostics, []);
        assert.match(throwingCode, /_resilientArgs\.length/u);
        assert.equal(throwingFixed.fatalErrorCount, 0);
        assert.deepEqual(await observeThrowing(throwingCode), await observeThrowing(throwingBaseline));
        assert.deepEqual(await observeThrowing(throwingFixed.output || throwingCode), { observed: 'dispatch', reads: 1 });

        const privateRejections = [
            ['metadata', 'export const result = choose.length;'],
            ['alias', 'const saved = choose; export const result = saved(function first() {});'],
            ['capture', 'export const result = () => choose(function first() {});'],
            ['pre-dispatch', 'export const result = choose(function first() {});',
                'const before = second;'],
            ['eval', 'export const result = choose(function first() {});', 'eval("");'],
            ['strict-directive', 'export const result = choose(function first() {});', '"use strict";']
        ];

        await Promise.all(privateRejections.map(async ([name = '', suffix = '', prefix = ''] = []) => {
            const rejectionFile = path.join(directory, `private-${name}.ts`);
            const rejectionSource = [
                'const choose = function(first: Function, second?: Function) {',
                prefix,
                '    switch (arguments.length) { case 2: return second; default: return first; }',
                '};',
                suffix,
                ''
            ].join('\n');

            await writeFile(rejectionFile, rejectionSource);
            const rejectionProgram = typescript.createProgram([rejectionFile], {
                module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
            });
            const { code: rejectionCode = '' } = createTypeScriptTransformer({
                typescript, program: rejectionProgram
            }).transform({ code: rejectionSource, fileName: rejectionFile });

            assert.doesNotMatch(rejectionCode, /_resilientArgs/u, name);
            assert.match(rejectionCode, /function \(first, second\)/u, name);
            assert.doesNotMatch(rejectionCode, /Object\.defineProperty\(choose/u, name);
        }));

        const rejectedArities = [
            ['shadowed-function', [
                'type Function = () => unknown;',
                'export function flow(first: Function, second?: Function) {',
                '    switch (arguments.length) { case 2: return second(first); default: return first; }',
                '}'
            ].join('\n')],
            ['aliased-function', [
                'type Callable = Function;',
                'export function flow(first: Callable, second?: Callable) {',
                '    switch (arguments.length) { case 2: return second(first); default: return first; }',
                '}'
            ].join('\n')]
        ];

        await Promise.all(rejectedArities.map(async ([name = '', rejectedAritySource = ''] = []) => {
            const rejectedArityFile = path.join(directory, `${name}.ts`);

            await writeFile(rejectedArityFile, rejectedAritySource);
            const rejectedArityProgram = typescript.createProgram([rejectedArityFile], {
                module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
            });
            const rejectedArityFacts = collectAritySignatureContracts({
                typescript,
                sourceFile: rejectedArityProgram.getSourceFile(rejectedArityFile),
                checker: rejectedArityProgram.getTypeChecker()
            });
            const { code: rejectedArityCode = '' } = createTypeScriptTransformer({
                typescript, program: rejectedArityProgram
            }).transform({ code: rejectedAritySource, fileName: rejectedArityFile });

            if (name === 'shadowed-function') {
                const [fact = {}] = rejectedArityFacts.values();
                const { nativeCallableParameters = true } = fact;

                assert.equal(nativeCallableParameters, false);

                assert.doesNotMatch(rejectedArityCode, /_resilientArgs/u);

                return;
            }

            assert.equal(rejectedArityFacts.size, 0, 'A callable alias does not become native Function evidence.');
            assert.doesNotMatch(rejectedArityCode, /_resilientArgs/u);
        }));

        const rejectedFile = path.join(directory, 'array-index.ts');
        const rejectedSource = 'export const first = (values: number[]) => values[0];';

        await writeFile(rejectedFile, rejectedSource);
        const rejectedProgram = typescript.createProgram([rejectedFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext
        });

        assert.equal([...collectIndexedOperationContracts({
            typescript, sourceFile: rejectedProgram.getSourceFile(rejectedFile),
            checker: rejectedProgram.getTypeChecker()
        }).values()].filter(({ operationRole = '' } = {}) => operationRole === 'dynamic-arguments-read').length, 0);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }

    test('public overload returns retain arity, provided identities and owned exceptions across local function results', async () => {
        const code = [
            'type Provider<A> = { read: () => A };',
            'type Dense<A> = ReadonlyArray<A> & { readonly 0: A };',
            'const pair = <A>(left: Provider<A>, right: Provider<A>): Dense<A> =>',
            '    ((first: Provider<A>) => (second: Provider<A>) => [first.read(), second.read()] as const)(left)(right);',
            'export function combine<A>(left: Provider<A>): (right: Provider<A>) => Dense<A>;',
            'export function combine<A>(left: Provider<A>, right: Provider<A>): Dense<A>;',
            'export function combine<A>(left: Provider<A>, right?: Provider<A>): Dense<A> | ((right: Provider<A>) => Dense<A>) {',
            '    if (right === undefined) return next => pair(left, next);',
            '    return pair(left, right);',
            '}',
            'const record = <A>(left: Provider<A>, right: Provider<A>) =>',
            '    ((first: Provider<A>) => (second: Provider<A>) => ({ left: first.read(), right: second.read() }))(left)(right);',
            'export function packet<A>(left: Provider<A>): (right: Provider<A>) => { left: A; right: A };',
            'export function packet<A>(left: Provider<A>, right: Provider<A>): { left: A; right: A };',
            'export function packet<A>(left: Provider<A>, right?: Provider<A>): { left: A; right: A } | ((right: Provider<A>) => { left: A; right: A }) {',
            '    const combine = (enabled: boolean) => { if (enabled) return 1; return []; };',
            '    void combine;',
            '    return right === undefined ? next => record(left, next) : record(left, right);',
            '}',
            'export function choose(flag: boolean): (value: {kind: string}) => {kind: string};',
            'export function choose(flag: boolean, value: {kind: string}): {kind: string};',
            'export function choose(flag: boolean, value?: {kind: string}): {kind: string} | ((value: {kind: string}) => {kind: string}) {',
            '    return value === undefined ? next => choose(flag, next) : flag ? {kind: "empty"} : value;',
            '}',
            'const negate = (read: () => boolean) => () => !read();',
            'function checked(read: () => boolean): () => boolean;',
            'function checked(read: () => boolean) { return negate(read); }',
            'export function predicate(read: () => boolean): (value: boolean) => boolean;',
            'export function predicate(read: () => boolean, value: boolean): boolean;',
            'export function predicate(read: () => boolean, value?: boolean): boolean | ((value: boolean) => boolean) {',
            '    if (value === undefined) return next => predicate(read, next);',
            '    return checked(() => read() && value)();',
            '}',
            'export function irregular(left: number): () => number[];',
            'export function irregular(left: number, right: number): number[];',
            'export function irregular(left: number, right?: number): number[] | (() => number[]) {',
            '    if (right === undefined) return () => [left];',
            '    if (left > 0) return () => [right];',
            '    return [left, right];',
            '}',
            'export function conflicting(flag: boolean): () => number;',
            'export function conflicting(flag: boolean, value: number): number | number[];',
            'export function conflicting(flag: boolean, value?: number): number | number[] | (() => number) {',
            '    if (value === undefined) return () => 1;',
            '    if (flag) return 1;',
            '    return [];',
            '}',
            'export function nested(flag: boolean): () => number | number[];',
            'export function nested(flag: boolean, value: number): number;',
            'export function nested(flag: boolean, value?: number): number | (() => number | number[]) {',
            '    if (value === undefined) return (() => { if (flag) return 1; return []; });',
            '    return 0;',
            '}'
        ].join('\n');
        const name = 'arity-return-values.ts';
        const options = { strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext };
        const sourceFile = typescript.createSourceFile(name, code, typescript.ScriptTarget.ESNext, true);
        const host = typescript.createCompilerHost(options);
        const program = typescript.createProgram([name], options, {
            ...host, getSourceFile: (file, version, ...rest) => file === name ? sourceFile : host.getSourceFile(file, version, ...rest)
        });
        assert.deepEqual(typescript.getPreEmitDiagnostics(program).map(({ messageText = '' } = {}) => (
            typescript.flattenDiagnosticMessageText(messageText, '\n')
        )), []);
        const { code: output = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program,
            standard: { object: import.meta.resolve('eslint-plugin-resilient/standard/object') } }).transform({ code, fileName: name });
        assert.deepEqual(diagnostics, []);
        const profile = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
        const linter = new Linter();
        const messages = linter.verify(output, profile);
        const { output: fixed = '', messages: fixedMessages = [] } = linter.verifyAndFix(output, profile);
        const { outputText: native = '' } = typescript.transpileModule(code, { compilerOptions: options });
        const modules = await Promise.all([native, output, fixed].map(code => import(`data:text/javascript,${encodeURIComponent(code)}`)));
        modules.forEach((module) => {
            const choose = Reflect.get(module, 'choose');
            const value = { kind: 'provided' };

            assert.equal(choose(false)(value), value);
            assert.equal(choose(false, value), value);
            assert.equal(Reflect.get(choose(true)(value), 'kind'), 'empty');
            const predicate = Reflect.get(module, 'predicate');
            let reads = 0;
            const read = () => {
                reads += 1;

                return true;
            };
            const partialPredicate = predicate(read);
            const failure = new Error('predicate read');

            assert.equal(reads, 0);
            assert.equal(partialPredicate(true), false);
            assert.equal(predicate(read, false), true);
            assert.equal(reads, 2);
            assert.throws(() => predicate(() => { throw failure; }, true), error => error === failure);
            ['combine', 'packet'].forEach((name) => {
                let events = [];
                const first = { identity: 'first' };
                const second = { identity: 'second' };
                const failure = new Error('second provider Get');
                const provider = (value, label = '') => ({ get read() {
                    events = [...events, label];

                    return () => value;
                } });
                const left = provider(first, 'left');
                const right = provider(second, 'right');
                const invoke = Reflect.get(module, name);
                const partial = invoke(left);
                assert.deepEqual(events, []);
                const values = [partial(right), invoke(left, right), invoke(left, undefined)(right)];
                values.forEach((value) => {
                    const pair = name === 'combine' ? value : [Reflect.get(value, 'left'), Reflect.get(value, 'right')];
                    assert.equal(pair.at(0), first);
                    assert.equal(pair.at(1), second);
                });
                assert.deepEqual(events, ['left', 'right', 'left', 'right', 'left', 'right']);
                assert.throws(() => invoke(left, { get read() { throw failure; } }), error => error === failure);
                assert.deepEqual(events, ['left', 'right', 'left', 'right', 'left', 'right', 'left']);
            });
        });
        [messages, fixedMessages].forEach(messages => assert.deepEqual(messages.map(({ ruleId = '', message = '' } = {}) => ({ ruleId, message })), [
            { ruleId: 'resilient/signature-contract-return-consistency', message: 'This function returns number, but another return path produces array.' },
            { ruleId: 'resilient/signature-contract-return-consistency', message: 'This function returns array, but another return path produces number.' },
            { ruleId: 'resilient/signature-contract-return-consistency', message: 'This function returns function, but another return path produces array.' },
            { ruleId: 'resilient/signature-contract-return-consistency', message: 'This function returns function, but another return path produces array.' },
            { ruleId: 'resilient/signature-contract-return-consistency', message: 'This function returns array, but another return path produces function.' },
            { ruleId: 'resilient/signature-contract-return-consistency', message: 'This function returns function, but another return path produces number.' },
            { ruleId: 'resilient/signature-contract-return-consistency', message: 'This function returns number, but another return path produces function.' },
            { ruleId: 'resilient/signature-contract-return-consistency', message: 'This function returns array, but another return path produces function.' },
            { ruleId: 'resilient/signature-contract-return-consistency', message: 'This function returns number, but another return path produces array.' },
            { ruleId: 'resilient/signature-contract-return-consistency', message: 'This function returns array, but another return path produces number.' }
        ]));
    });
}

{
    const compile = (code = '') => {
        const fileName = 'factory-ownership.ts';
        const sourceFile = typescript.createSourceFile(fileName, code, typescript.ScriptTarget.ESNext, true);
        const options = { strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext };
        const host = typescript.createCompilerHost(options);
        const program = typescript.createProgram([fileName], options, {
            ...host, getSourceFile: (name, version) => name === fileName ? sourceFile : host.getSourceFile(name, version)
        });
        const contracts = collectFactoryBindingContracts({ typescript, sourceFile, checker: program.getTypeChecker() });
        const result = createTypeScriptTransformer({ typescript, program }).transform({ code, fileName });
        const { diagnostics = [] } = result;
        assert.deepEqual(diagnostics, []);

        return { ...result, contracts };
    };
    const source = (name = '', type = '{ operation: () => number }') => [
        `export function read(${name}: () => ${type}) {`,
        `    const { operation } = ${name}();`,
        '    return () => operation;',
        '}'
    ].join('\n');
    const names = ['ordinaryFactory', 'makePrimaryOperations', 'makeParallelOperations', 'composeOperations'];
    const records = names.map((name) => {
        const { agreements = [], contracts = new Map(), code = '' } = compile(source(name));
        const [record = {}] = agreements.filter(({ name: property = '' } = {}) => property === 'operation');
        const decisions = [...collectDestructuringAgreements({ factoryBindingContracts: contracts }).values()].flat()
            .map(entry => getDestructuringAgreement({ entry }));
        assert.ok(decisions.some(({ action = '', requiredProperties = [] } = {}) => action === 'preserve-required-factory-binding' && requiredProperties.includes('operation')));
        const { owner = '', state = '', action = '' } = record;
        assert.equal(owner, 'typeclass-factory');
        assert.equal(state, 'required');
        assert.equal(action, 'preserve');
        assert.doesNotMatch(code, /Missing required agreement|operation\s*=(?!=)/u);
        const { sourceRange = '', ...stable } = record;
        assert.ok(sourceRange);

        return stable;
    });
    assert.ok(records.every(record => JSON.stringify(record) === JSON.stringify(records[0])), 'Renaming preserves the published agreement.');

    ['{ operation: unknown }', '{ operation: any }', '{ operation?: () => number }', 'any', 'unknown'].forEach((type) => {
        const results = names.map((name) => {
            const { agreements = [], contracts = new Map() } = compile(source(name, type));
            assert.equal(contracts.size, 0, `${name}: ${type}`);
            const [record = {}] = agreements.filter(({ name: property = '' } = {}) => property === 'operation');
            const { owner = '' } = record;
            assert.notEqual(owner, 'typeclass-factory');
            const { sourceRange = '', ...stable } = record;
            assert.ok(sourceRange);

            return stable;
        });
        assert.ok(results.every(record => JSON.stringify(record) === JSON.stringify(results.at(0))));
    });

    const runtimeSource = source('ordinaryFactory').replace('return () => operation;', 'return () => operation();');
    const { code: generated = '' } = compile(runtimeSource);
    const load = async code => import(`data:text/javascript,${encodeURIComponent(code)}`);
    const original = await load(typescript.transpileModule(runtimeSource, {
        compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
    }).outputText);
    const transformed = await load(generated);
    const observe = (module, mode = '') => {
        let events = [];
        const failure = new Error('factory or getter');
        const operation = () => 7;
        const make = () => {
            events = [...events, 'call'];

            if (mode === 'factory-throw') throw failure;

            // eslint-disable-next-line resilient/no-falsifiable-property-key, resilient/no-null-assignment -- The phase key selects native null to verify a missing factory result.
            if (['null', 'missing'].includes(mode)) return Reflect.get({ null: null, missing: {} }, mode);

            return { get operation() {
                events = [...events, 'get'];

                if (mode === 'getter-throw') throw failure;

                return operation;
            } };
        };
        try {
            const later = module.read(make);
            const before = [...events];
            const value = later();

            return { before, events, value };
        } catch (error) {
            const { message = '' } = error;

            return { events, sameFailure: error === failure, nativeTypeError: error instanceof TypeError, message };
        }
    };
    ['normal', 'missing', 'null', 'factory-throw', 'getter-throw'].forEach((mode) => {
        assert.deepEqual(observe(transformed, mode), observe(original, mode), mode);
    });

    const mixed = compile([
        'export function read(make: () => { operation: () => number; payload: unknown; optional?: () => number }) {',
        '    const { operation, payload, optional } = make();',
        '    return () => [operation, payload, optional];',
        '}'
    ].join('\n'));
    const { agreements: mixedAgreements = [] } = mixed;
    const { owner: mixedOwner = '' } = mixedAgreements.find(({ name = '' } = {}) => name === 'operation');
    assert.equal(mixedOwner, 'typeclass-factory');
    ['payload', 'optional'].forEach((property) => {
        const { owner = '' } = mixedAgreements.find(({ name = '' } = {}) => name === property);
        assert.notEqual(owner, 'typeclass-factory',
            'A proved field cannot lend ownership to a sibling.');
    });
    const explicit = compile(source('makePrimaryOperations').replace('const { operation }', 'const { operation = () => 9 }'));
    const { code: explicitCode = '', agreements: explicitAgreements = [] } = explicit;
    assert.match(explicitCode, /operation = \(\) => 9/u);
    assert.ok(!explicitAgreements.some(({ name = '' } = {}) => name === 'operation'));
    assert.equal(collectFactoryBindingContracts({ typescript }).size, 0, 'No checker means no factory fact.');
    const selected = compile([
        'declare const renamed: () => { operation: () => number };',
        'const selected = renamed().operation;',
        'export const later = () => selected;'
    ].join('\n'));
    const { agreements: selectedAgreements = [], contracts: selectedContracts = new Map() } = selected;
    assert.equal(selectedContracts.size, 0, 'A direct projection keeps its existing provider-edge owner.');
    assert.ok(selectedAgreements.some(({ name = '', owner = '' } = {}) => name === 'operation' && owner === 'provider-caller'));
}

{
    const extraReason = 'checker-resolved authored callable accepts arguments beyond the source implementation formals';
    const binary = 'const apply: (first: number, second: number) => number = first => first;';
    const cases = [
        { name: 'nonzero', code: `${binary} const result = apply(1, 2);`, count: 1 },
        { name: 'zero', code: 'const apply: (value: number) => number = () => 7; const result = apply(1);', count: 1, zero: true },
        { name: 'renamed', code: 'const other: (first: number, second: number) => number = first => first; const result = other(1, 2);', count: 1 },
        { name: 'function-expression', code: 'const apply: (first: number, second: number) => number = function (first) { return first; }; const result = apply(1, 2);', count: 1 },
        { name: 'generic-curried', code: [
            'const convert: <A, B, C>(first: (value: A) => B, ignored: (value: C) => C) => (value: A) => B = first => value => first(value);',
            'const result = convert((value: number) => value + 1, (value: string) => value);'
        ].join('\n'), count: 1 },
        { name: 'local-forward', code: `${binary} const forwarded: (first: number, second: number) => number = apply; const result = forwarded(1, 2);`, count: 1 },
        { name: 'imported-forward', code: 'import { apply as renamed } from "./provider"; const result = renamed(1, 2);', count: 1 },
        { name: 'namespace-forward', code: [
            'import * as Provider from "./provider";',
            'const forwarded: (first: number, second: number) => number = Provider.apply; const result = forwarded(1, 2);'
        ].join('\n'), count: 1 },
        { name: 'ordinary-recursive', code: 'const go = (first: number, second: number): number => first ? go(first - 1, second) : second; const result = go(2, 3);' },
        { name: 'plain-wrong-arity', code: 'const bimap = (value: number) => value; const result = bimap(1, 2);' },
        { name: 'plain-missing-arity', code: 'const go = (first: number, second: number, third: number) => third; const result = go(1, 2);' },
        { name: 'wrong-value', code: `${binary} const result = apply("wrong", 2);` },
        { name: 'same-spelled-wrong-value', code: 'const bimap: (first: number, second: number) => number = first => first; const result = bimap("wrong", 2);' },
        { name: 'typed-too-many', code: `${binary} const result = apply(1, 2, 3);` },
        { name: 'typed-too-few', code: `${binary} const result = apply();` },
        { name: 'equal-implementation', code: 'const bimap: (first: number, second: number) => number = (first, second) => first + second; const result = bimap(1, 2);' },
        { name: 'spread', code: `${binary} const values: [number, number] = [1, 2]; const result = apply(...values);` },
        { name: 'optional-call', code: `${binary} const result = apply?.(1, 2);` },
        { name: 'member-call', code: 'const api = { bimap: (value: number) => value }; const result = api.bimap(1, 2);' },
        { name: 'unknown-implementation', code: 'declare const bimap: (first: number, second: number) => number; const result = bimap(1, 2);' },
        { name: 'unresolved', code: 'const result = go(1, 2);' },
        { name: 'rest-implementation', code: 'const apply: (first: number, second: number) => number = (...values) => values[0]; const result = apply(1, 2);' },
        { name: 'cyclic-forwarding', code: "const first: (left: number, right: number) => number = second; const second: (left: number, right: number) => "
            + "number = first; const result = first(1, 2);" },

        { name: 'shadowed-owner', code: `${binary} function read() { const apply = (first: number, second: number) => first + second; return apply(1, 2); }` }
    ];
    const traces = [
        { name: 'normal', declaration: binary, probe: 'apply(mark(1), mark(2))' },
        { name: 'argument-failure', declaration: binary, probe: 'apply(mark(1), mark(-1))' },
        { name: 'implementation-failure', declaration: 'const apply: (first: number, second: number) => number = first => { events = [...events, "call"]; throw failure; };',
            probe: 'apply(mark(1), mark(2))' },
        { name: 'identity', declaration: 'const apply: (first: object, second: number) => object = first => first; const token = {};',
            probe: 'apply(token, mark(2)) === token' },
        { name: 'arity', declaration: binary, probe: '[apply.length, apply(mark(1), mark(2)), apply.length]' },
        { name: 'returned-callable', declaration: 'const apply: (first: number, second: number) => (value: number) => number = first => value => first + value;',
            probe: '(() => { const later = apply(mark(1), mark(2)); return [later.length, later(mark(3))]; })()' },
        { name: 'guarded-skip', declaration: `${binary} const read = (ready: boolean) => ready ? apply(mark(1), mark(2)) : 0;`, probe: 'read(false)' },
        { name: 'guarded-selected', declaration: `${binary} const read = (ready: boolean) => ready ? apply(mark(1), mark(2)) : 0;`, probe: 'read(true)' },
        { name: 'deferred', declaration: `${binary} const read = () => () => apply(mark(1), mark(2));`,
            probe: '(() => { const later = read(); const before = events.length; return [before, later()]; })()' },
        { name: 'callee-before-arguments', declaration: [
            'let apply: (first: number, second: number) => number = first => first;',
            'const replace = () => { events = [...events, "replace"]; apply = (first, second) => second; return 1; };'
        ].join('\n'), probe: 'apply(replace(), mark(2))' },
        { name: 'native-call-failure', declaration: 'let apply: (first: number, second: number) => number = first => first; const clear = () => { apply = null as any; }; clear();',
            probe: 'apply(mark(1), mark(2))' },
        { name: 'ordinary-recursive', declaration: 'const go = (first: number, second: number): number => first ? go(first - 1, second) : second;',
            probe: 'go(mark(2), mark(3))' }
    ];
    const prefix = '/virtual/final-call/';
    const sources = new Map([
        ['provider', `export ${binary}`],
        ...cases.map(({ name = '', code = '' } = {}) => [name, `export {};\n${code}`]),
        ...traces.map(({ name = '', declaration = '', probe = '' } = {}) => [`trace-${name}`, [
            'export {}; let events: (number | string)[] = []; const failure = new Error("failure");',
            'const mark = (value: number) => { events = [...events, value]; if (value < 0) throw failure; return value; };',
            declaration,
            `export const exercise = () => (${probe});`
        ].join('\n')])
    ].map(([name = '', code = ''] = []) => [`${prefix}${name}.ts`, typescript.createSourceFile(`${prefix}${name}.ts`, code, typescript.ScriptTarget.ESNext, true)]));
    const compilerOptions = { strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext };
    const compilerHost = typescript.createCompilerHost(compilerOptions);
    const program = typescript.createProgram([...sources.keys()], compilerOptions, {
        ...compilerHost,
        directoryExists: directory => directory === prefix.slice(0, -1) || compilerHost.directoryExists(directory),
        fileExists: name => sources.has(name) || compilerHost.fileExists(name),
        getSourceFile: (name, version) => sources.get(name) || compilerHost.getSourceFile(name, version)
    });
    const checker = program.getTypeChecker();
    const factsFor = (sourceFile = {}) => collectTypedIgnoredArgumentCallContracts({ typescript, sourceFile, checker });
    cases.forEach(({ name = '', count = 0, zero = false } = {}) => {
        const sourceFile = sources.get(`${prefix}${name}.ts`);
        const contracts = factsFor(sourceFile);
        assert.equal(contracts.size, count, name);
        const agreements = collectDestructuringAgreements({ typedIgnoredArgumentCallContracts: contracts });
        const before = [...agreements];
        const visit = (node = {}) => {
            typescript.forEachChild(node, visit);

            if (!typescript.isCallExpression(node)) return;

            const { agreement: { action = '' } = {} } = getDestructuringDecisionForNode({
                typescript, node, destructuringAgreements: compileDestructuringDecisions(agreements), kinds: ['typed-ignored-argument-call']
            });
            const admitted = ['retain-typed-ignored-argument-call', 'retain-typed-extra-argument-call'].includes(action);
            assert.equal(admitted, contracts.has(getConsumerContractKey(node)), name);

            if (admitted) assert.equal(action, zero ? 'retain-typed-ignored-argument-call' : 'retain-typed-extra-argument-call');
        };
        visit(sourceFile);
        assert.deepEqual([...agreements], before);
    });
    assert.equal(collectTypedIgnoredArgumentCallContracts({ typescript, sourceFile: sources.get(`${prefix}nonzero.ts`) }).size, 0);

    const sourceFile = sources.get(`${prefix}nonzero.ts`);
    const facts = factsFor(sourceFile);
    const agreements = collectDestructuringAgreements({ typedIgnoredArgumentCallContracts: facts });
    let owned = false;
    const findCall = (node = {}) => {
        if (typescript.isCallExpression(node) && facts.has(getConsumerContractKey(node))) owned = node;

        typescript.forEachChild(node, findCall);
    };
    findCall(sourceFile);
    const place = (root = sourceFile, decisions = compileDestructuringDecisions(agreements)) => {
        const { transformed: [placed = root] = [], dispose = () => {} } = typescript.transform(root, [context => node => (
            annotateFinalExceptions({ typescript, sourceFile: node, destructuringAgreements: decisions, context })
        )]);
        const text = typescript.createPrinter().printFile(placed);
        dispose();

        return text;
    };
    assert.equal(place().split(extraReason).length - 1, 1);
    const { arguments: ownedArguments = [] } = getObject(owned);
    const cloned = typescript.transform(sourceFile, [context => (root) => {
        const visit = (node = {}) => {
            if (node !== owned) return typescript.visitEachChild(node, visit, context);

            return typescript.setOriginalNode(
                typescript.factory.createCallExpression(typescript.factory.createIdentifier('apply'), undefined, ownedArguments), owned
            );
        };

        return typescript.visitNode(root, visit);
    }]);
    const { transformed: [rebuilt = sourceFile] = [] } = cloned;
    assert.equal(place(rebuilt).split(extraReason).length - 1, 1, 'Original-node provenance survives a rangeless rebuilt call.');
    cloned.dispose();
    assert.doesNotMatch(place(sourceFile, compileDestructuringDecisions(new Map())), /signature-contract-call-site/, 'Absent facts are not repaired by spelling.');
    const failure = new Error('lookup');
    const hostile = compileDestructuringDecisions(agreements);
    Object.defineProperty(hostile.byKey, 'get', { value: () => { throw failure; } });
    assert.throws(() => place(sourceFile, hostile), error => error === failure);

    const linter = new Linter();
    const lintConfig = { plugins: { resilient }, rules: { 'resilient/signature-contract-call-site': 'error' } };
    const transformer = createTypeScriptTransformer({ typescript, program });
    const observe = async ({ text = '', probe = '' } = {}) => {
        const resolved = ['object', 'array', 'function'].reduce((result = '', module = '') => result.replaceAll(
            `eslint-plugin-resilient/standard/${module}`, import.meta.resolve(`eslint-plugin-resilient/standard/${module}`)
        ), text);
        const suffix = `let value; let failureName; let sameFailure = false;
        try { value = ${probe}; } catch (error) { failureName = error.name; sameFailure = error === failure; }
        export default JSON.stringify({ events, value, failureName, sameFailure });`;
        const { default: result = '' } = await import(`data:text/javascript,${encodeURIComponent(`${resolved}\n${suffix}`)}`);

        return result;
    };
    await Promise.all(traces.map(async ({ name = '' } = {}) => {
        const probe = 'exercise()';
        const fileName = `${prefix}trace-${name}.ts`;
        const source = sources.get(fileName).getFullText();
        const { code = '', diagnostics = [] } = transformer.transform({ code: source, fileName });
        assert.deepEqual(diagnostics, [], name);
        const { outputText: original = '' } = typescript.transpileModule(source, { compilerOptions });
        const expected = await observe({ text: original, probe });
        const { output: fixed = code, messages = [] } = linter.verifyAndFix(code, lintConfig);
        assert.deepEqual(messages.filter(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-call-site'), [], name);
        assert.equal(await observe({ text: code, probe }), expected, `${name}: transformed`);
        assert.equal(await observe({ text: fixed, probe }), expected, `${name}: targeted fixed`);
    }));

    ['plain-wrong-arity', 'plain-missing-arity', 'same-spelled-wrong-value', 'member-call'].forEach((name = '') => {
        const parsed = sources.get(`${prefix}${name}.ts`);
        const { outputText: output = '' } = typescript.transpileModule(place(parsed, new Map()), { compilerOptions });
        const messages = linter.verify(output, lintConfig);
        assert.ok(messages.some(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-call-site'),
            `${name}: same spelling must not suppress the known contradiction`);
        const { code = '', diagnostics = [] } = transformer.transform({ code: parsed.getFullText(), fileName: `${prefix}${name}.ts` });
        assert.deepEqual(diagnostics, [], name);
        assert.ok(linter.verify(code, lintConfig).some(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-call-site'),
            `${name}: the public pipeline also retains the contradiction`);
    });
    const { outputText: printed = '' } = typescript.transpileModule(place(), { compilerOptions });
    const unexplained = printed.replaceAll(`// eslint-disable-next-line resilient/signature-contract-call-site -- ${extraReason}`, '');
    assert.ok(linter.verify(unexplained, lintConfig).some(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-call-site'),
        'The owning rule reports the implementation arity without this exact source-fact boundary.');
}

{
    const source = [
        'const events: number[] = [];',
        'const mark = (value: number) => { events.push(value); if (value < 0) throw new Error("negative"); return value; };',
        'const ignored: (value: number) => number = () => 7;',
        'function read(value: number) { const result = ignored(mark(value)); return ignored(mark(result)); }',
        'function guarded(value: number) { if (value) { const result = ignored(mark(value)); return result; } return 0; }',
        'function expression(value: number) { ignored(mark(value)); }',
        'const arrow = (value: number) => ignored(mark(value));',
        'function tuple([callback]: [(value: number) => number]) { return ignored(callback(2)); }',
        'function nested(value: number) { return () => ignored(mark(value)); }',
        'const blockArrow = (value: number) => { const result = ignored(mark(value)); return result; };',
        'const parameterDefault = (value = ignored(mark(9))) => { return value; };',
        'const ordinary = (first: number, second: number) => first;',
        'function rejected(value: number) { return ordinary(value); }'
    ].join('\n');
    const fileName = 'final-decision.ts';
    const sourceFile = typescript.createSourceFile(fileName, source, typescript.ScriptTarget.ESNext, true);
    const compilerHost = typescript.createCompilerHost({ noLib: true });
    const host = {
        ...compilerHost,
        getSourceFile: (name, languageVersion) => name === fileName ? sourceFile : compilerHost.getSourceFile(name, languageVersion)
    };
    const program = typescript.createProgram([fileName], { noLib: true, strict: true }, host);
    const checker = program.getTypeChecker();
    const typedIgnoredArgumentCallContracts = collectTypedIgnoredArgumentCallContracts({ typescript, sourceFile, checker });
    const requiredTupleBindingContracts = collectRequiredTupleBindingContracts({ typescript, sourceFile, checker });
    const destructuringAgreements = collectDestructuringAgreements({
        typedIgnoredArgumentCallContracts, requiredTupleBindingContracts
    });
    const completedDecisions = compileDestructuringDecisions(destructuringAgreements);
    const before = [...destructuringAgreements];
    const { transformed: [placed = sourceFile] = [], dispose = () => {} } = typescript.transform(sourceFile, [context => root => (
        annotateFinalExceptions({ typescript, sourceFile: root, destructuringAgreements: completedDecisions, context })
    )]);
    const printed = typescript.createPrinter().printFile(placed);
    dispose();
    assert.deepEqual([...destructuringAgreements], before);

    const transpile = (text = '') => typescript.transpileModule(text, {
        compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
    }).outputText;
    const originalJS = transpile(source);
    const placedJS = transpile(printed);
    const probe = [
        'const results = [read(2), guarded(0), guarded(3), arrow(4), tuple([value => value]), nested(5)(), blockArrow(8), parameterDefault()];',
        'expression(6);',
        'try { read(-1); } catch (error) { results.push(error.message); }',
        'try { tuple(undefined); } catch (error) { results.push(error.name); }',
        'JSON.stringify({ results, events });'
    ].join('\n');
    assert.equal(runInNewContext(`${placedJS}\n${probe}`), runInNewContext(`${originalJS}\n${probe}`));
    const lint = new ESLint({ overrideConfigFile: true, overrideConfig: [{
        plugins: { resilient }, rules: { 'resilient/signature-contract-call-site': 'error' }
    }] });
    const [raw = {}] = await lint.lintText(placedJS, { filePath: 'final-decision.js' });
    const { messages = [] } = raw;
    // This isolated annotation phase does not lower expression arrows. Its nested
    // callback and the deliberate arity mismatch remain visible; do not broaden admission.
    const callMessages = messages.filter(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-call-site');
    assert.equal(callMessages.length, 2, JSON.stringify({ messages, placedJS }));
    assert.match(callMessages[0].message, /ignored accepts at most 0 arguments/);
    assert.match(callMessages[1].message, /ordinary requires second/);
    // Parameter default calls now have a finding, so their exact arity exception is used.
    assert.equal(raw.warningCount, 1, JSON.stringify({ messages, placedJS }));
    const fixedLint = new ESLint({ overrideConfigFile: true, fix: true, overrideConfig: [{
        plugins: { resilient }, rules: { 'resilient/signature-contract-call-site': 'error' }
    }] });
    const [fixed = {}] = await fixedLint.lintText(placedJS, { filePath: 'final-decision.js' });
    assert.deepEqual(fixed.messages.map(({ ruleId = '', message = '' } = {}) => ({ ruleId, message })),
        callMessages.map(({ ruleId = '', message = '' } = {}) => ({ ruleId, message })));
    assert.equal(runInNewContext(`${fixed.output || placedJS}\n${probe}`), runInNewContext(`${originalJS}\n${probe}`));
}

{
    const operationRule = 'resilient/signature-contract-operation';
    const propertyRule = 'resilient/signature-contract-property';
    const operationReason = 'generic typeclass dictionary is selected by a runtime capability guard';
    const propertyReason = 'generic typeclass member is supplied by the caller and remains opaque here';
    const parse = (code = '') => typescript.createSourceFile('property-owner.ts', code, typescript.ScriptTarget.ESNext, true);
    const nodesOfKind = nodesOfKindShared;
    const place = (sourceFile = {}) => {
        const { transformed: [placed = sourceFile] = [], dispose = () => {} } = typescript.transform(sourceFile, [
            context => root => annotateFinalExceptions({ typescript, sourceFile: root, context })
        ]);
        const code = typescript.createPrinter().printFile(placed);
        dispose();

        return code;
    };
    const linter = new Linter();
    const lintConfig = { plugins: { resilient }, rules: {
        [operationRule]: 'error', [propertyRule]: 'error'
    }, linterOptions: { reportUnusedDisableDirectives: 'error' } };
    const retainedLintConfig = { ...lintConfig, rules: {
        ...lintConfig.rules, 'resilient/prefer-destructured-member-access': 'error'
    } };
    const summarize = (messages = []) => messages.map(({ ruleId = '', message = '' } = {}) => ({ ruleId, message }));

    // No source agreement: a spelling must not approve a dictionary or hide errors.
    const placementCases = [
        { name: 'native array', code: 'function read() { const r = [1]; return r.map(value => value); }' },
        { name: 'known authored operation', code: 'function read() { const r = { map: value => value }; return r.map(1); }' },
        { name: 'unknown caller', code: 'function read(r) { return r.filter(1); }' },
        { name: 'known wrong receiver', code: 'function read() { const r = ""; return r.reduce(value => value); }',
            contradiction: 1 },
        { name: 'missing closed property', code: 'function read() { const S = { value: 1 }; return S.show; }',
            contradiction: 1 },
        { name: 'present closed property', code: 'function read() { const S = { show: 1 }; return S.show; }' },
        { name: 'native string concat', code: 'function read() { const S = ""; return S.concat("a"); }' },
        { name: 'different receiver spelling', code: 'function read(user) { return user.show; }' },
        { name: 'computed property', code: 'function read(S) { return S["show"]; }' },
        { name: 'computed operation', code: 'function read(r) { return r["map"](1); }' },
        { name: 'deferred expression arrow', code: 'function read(S) { return () => S.show; }' },
        { name: 'top-level expression arrow', code: 'const read = S => S.show;' },
        { name: 'deferred block owns placement', code: 'function read(S) { return () => { return S.show; }; }' },
        { name: 'guarded block has no spelling approval', code: 'function read(r) { if (r) { return r.map(1); } }' },
        { name: 'independent unproved families', code: 'function read(r, S) { return [S.show, r.map(1), S.concat, r.reduce(1), r.filter(1)]; }' }
    ];
    placementCases.forEach(({ name = '', code = '', contradiction = 0 } = {}) => {
        const output = place(parse(code));
        assert.equal(output.split(operationReason).length - 1, 0, name);
        assert.equal(output.split(propertyReason).length - 1, 0, name);
        const raw = linter.verify(code, lintConfig);
        const remaining = linter.verify(output, lintConfig);
        const suppressed = linter.getSuppressedMessages();

        assert.equal(remaining.filter(({ ruleId = '' } = {}) => !ruleId).length, 0, name);

        if (contradiction) {
            assert.equal(raw.length, contradiction, name);
            assert.equal(suppressed.length, 0, `${name}: unproved suppression cannot hide a contradiction`);
        }

        const { messages = [], output: fixed = output } = linter.verifyAndFix(output, lintConfig);
        assert.deepEqual(summarize(messages), summarize(remaining.filter(({ ruleId = '' } = {}) => ruleId)), name);
        assert.equal(linter.verify(fixed, lintConfig).filter(({ ruleId = '' } = {}) => !ruleId).length, 0,
            `${name}: fixing removes unused directives, not the uncovered semantic obligation`);
    });

    const mixed = place(parse('function read(r, S) { return [S.show, r.map(1), S.concat, r.reduce(1)]; }'));
    assert.doesNotMatch(mixed, /eslint-disable-next-line/, 'Unproved mixed families do not create an exception.');
    const collisionFile = parse('function read(r, S) { return [r.map(1), S.show]; }');
    const { transformed: [withPriorComment = collisionFile] = [], dispose: releaseCollision = () => {} } = typescript.transform(
        collisionFile, [context => (root) => {
            const visit = (node = {}) => {
                if (typescript.isReturnStatement(node)) return typescript.addSyntheticLeadingComment(
                    node, typescript.SyntaxKind.SingleLineCommentTrivia,
                    ` eslint-disable-next-line ${operationRule} -- source-owned prior reason`, true
                );

                return typescript.visitEachChild(node, visit, context);
            };

            return annotateFinalExceptions({ typescript, sourceFile: typescript.visitNode(root, visit), context });
        }]
    );
    const collisionOutput = typescript.createPrinter().printFile(withPriorComment);
    releaseCollision();
    assert.equal(collisionOutput.split(operationRule).length - 1, 1);
    assert.match(collisionOutput, /source-owned prior reason/);
    assert.doesNotMatch(collisionOutput, new RegExp(operationReason));
    assert.equal(collisionOutput.split(propertyReason).length - 1, 0);

    // Real checker admission is narrower than final placement. Rejections stay visible.
    const providerType = '{ map: (value: number) => number }';
    const factCases = [
        { name: 'required inert return', code: `function read(r: ${providerType}) { return r.map(1); }`, count: 1 },
        { name: 'different spelling admitted', code: `function read(provider: ${providerType}) { return provider.map(1); }`, count: 1 },
        { name: 'guarded inert return has no direct guard placement', code: `function read(r: ${providerType}) { if (r) return r.map(1); }` },
        { name: 'expression arrow', code: `const read = (r: ${providerType}) => r.map(1);`, count: 1 },
        { name: 'effectful argument rejected', code: `function read(r: ${providerType}) { return r.map(Number("1")); }` },
        { name: 'optional member rejected', code: 'function read(r: { map?: (value: number) => number }) { return r.map(1); }' },
        { name: 'explicit receiver rejected', code: 'function read(r: { map: (this: object, value: number) => number }) { return r.map(1); }' },
        { name: 'untyped receiver rejected', code: 'function read(r) { return r.map(1); }' },
        { name: 'native array rejected', code: 'function read(r: number[]) { return r.map(value => value); }' },
        { name: 'multiple candidates rejected', code: `function read(r: ${providerType}) { r.map(1); return r.map(2); }` },
        { name: 'nested captured receiver rejected', code: `function read(r: ${providerType}) { return () => r.map(1); }` },
        { name: 'general host rejected', code: `function read(r: ${providerType}) { return [r.map(1)]; }` }
    ];
    const retentionCases = [
        { name: 'effectful typed provider', code: `function read(r: ${providerType}) { return r.map(Number("1")); }`, count: 3 },
        { name: 'optional callable keeps failure', code: 'function read(r: { map?: (value: number) => number }) { return r.map(Number("1")); }', count: 3 },
        { name: 'explicit receiver keeps binding', code: 'function read(dict: { reduce: (this: object, value: number) => number }) { return dict.reduce(Number("1")); }', count: 3 },
        { name: 'renamed guarded provider', code: `function read(dict: ${providerType}) { if (dict) { return dict.map(Number("1")); } }`, count: 3 },
        { name: 'guarded inert native call is retained', code: `function read(dict: ${providerType}) { if (dict) { return dict.map(1); } }`, count: 3 },
        { name: 'deferred expression provider', code: `function read(dict: ${providerType}) { return () => dict.map(Number("1")); }`, count: 2 },
        { name: 'deferred block provider', code: `function read(dict: ${providerType}) { return () => { return dict.map(Number("1")); }; }`, count: 3 },
        { name: 'existing inert owner', code: `function read(dict: ${providerType}) { return dict.map(1); }` },
        { name: 'guarded sibling still rejects unique guard', code: `function read(dict: ${providerType}) { if (dict) dict.map(1); return dict.map(2); }`,
            count: 6, boundaries: 2 },
        { name: 'noncallable is not admitted', code: 'function read() { const r = { map: 1 }; return r.map(1); }' },
        { name: 'missing member is not admitted', code: 'function read() { const r = { value: 1 }; return r.map(1); }' },
        { name: 'unknown receiver is not admitted', code: 'function read(r) { return r.map(Number("1")); }' },
        { name: 'computed call is not admitted', code: `function read(dict: ${providerType}) { return dict["map"](Number("1")); }` },
        { name: 'same unit contradiction stays visible', code: 'function read() { const dict = { map: value => value }; return dict.map("".map(1)); }' },
        { name: 'same line deferred contradiction stays visible', code: 'function read() { const dict = { map: value => value }; return dict.map(() => "".map(1)); }' },
        { name: 'completed model and custom call have separate owners',
            code: 'function read<T>(dict: { map: (value: T, forest: number[]) => number }, arg: { value: T; forest: number[] }) { return dict.map(arg.value, arg.forest); }', count: 1 },
        { name: 'mixed argument owners are not admitted',
            code: "function read<T>(dict: { map: (...values: any[]) => number }, arg: { value: T; forest: number[] }, other: { "
                + "value: number }) { return dict.map(arg.value, arg.forest, other.value); }" },

        { name: 'another parameter phase is not acquired',
            code: `function factory(arg: { value: number }) { return (dict: ${providerType}) => dict.map(arg.value); }` },
        { name: 'conditional header does not own its branch region',
            code: 'function read(dict: { map: (value: number) => boolean }, arg: { value: number }) { if (dict.map(arg.value)) return arg.value; return 0; }' },
        { name: 'nested scoped placements are not admitted',
            code: 'const arg = { value: 1 }; const dict = { map: (value: any) => value }; function read() { const value = dict.map(() => dict.map(arg.value)); return value; }' }
    ];
    assert.equal(collectCallableOperationContracts({ typescript, sourceFile: parse('dict.map(1);') }).size, 0,
        'Missing checker evidence does not approve a call.');
    assert.equal(collectCallableOperationContracts({ typescript, sourceFile: parse('dict.map(1);'),
        checker: { getTypeAtLocation: () => ({}) } }).size, 0,
    'Missing symbol ownership does not approve a call.');
    const publicCases = [
        { name: 'native-array', code: 'function read() { const r = [1]; return r.map(value => value); }' },
        { name: 'callable-and-native', code: 'function read(dict: { map: (value: number) => number }) { const result = dict.map(Number("1")); return "".map(result); }', visible: 1 },
        { name: 'wrong-native', code: 'function read() { const r = ""; return r.map(value => value); }', visible: 1 },
        { name: 'missing-closed-member', code: 'function read() { const S = { value: 1 }; return S.show; }', propertyBoundary: 0 }
    ];
    const sources = new Map([...factCases, ...retentionCases, ...publicCases].map(({ name = '', code = '' } = {}) => [
        `${name}.ts`, typescript.createSourceFile(`${name}.ts`, `export {};\n${code}`, typescript.ScriptTarget.ESNext, true)
    ]));
    const compilerOptions = { strict: true, target: typescript.ScriptTarget.ESNext };
    const compilerHost = typescript.createCompilerHost(compilerOptions);
    const program = typescript.createProgram([...sources.keys()], compilerOptions, {
        ...compilerHost,
        getSourceFile: (name, version) => sources.get(name) || compilerHost.getSourceFile(name, version)
    });
    factCases.forEach(({ name = '', count = 0 } = {}) => {
        const sourceFile = sources.get(`${name}.ts`);
        const directCapabilityContracts = collectDirectCapabilityContracts({ typescript, sourceFile, checker: program.getTypeChecker() });
        assert.equal(directCapabilityContracts.size, count, name);

        if (!count) return;

        const agreements = collectDestructuringAgreements({ directCapabilityContracts });
        const before = [...agreements];
        const [member = {}] = nodesOfKind({ root: sourceFile, kind: typescript.SyntaxKind.PropertyAccessExpression });
        const [call = {}] = nodesOfKind({ root: sourceFile, kind: typescript.SyntaxKind.CallExpression });
        const { parent: callParent = {} } = call;
        const functionNode = typescript.isArrowFunction(callParent) ? callParent : sourceFile.statements.find(
            node => typescript.isFunctionDeclaration(node)
        );
        const { entry = {}, contract = {}, agreement = {} } = getDestructuringDecisionForNode({
            typescript, node: member, destructuringAgreements: compileDestructuringDecisions(agreements), kinds: ['direct-capability']
        });
        const { callKey = '', functionKey = '', action = '' } = contract;
        assert.equal(callKey, getConsumerContractKey(call));
        assert.equal(functionKey, getConsumerContractKey(functionNode));
        assert.equal(action, 'guard-function-undefined');
        const { action: policyAction = '' } = agreement;
        const { contract: entryContract = {} } = entry;
        assert.equal(policyAction, 'guard-function-undefined');
        assert.equal(entryContract, directCapabilityContracts.get(getConsumerContractKey(member)));

        const clone = typescript.factory.createPropertyAccessExpression(typescript.factory.createIdentifier('renamed'), 'map');
        typescript.setOriginalNode(clone, member);
        typescript.setTextRange(clone, { pos: 10000, end: 10020 });
        const directCollision = { kind: 'unrelated-direct-range', contract: {} };
        const originalFirst = new Map([...agreements, [getConsumerContractKey(clone), [directCollision]]]);
        assert.equal(getDestructuringDecisionForNode({ typescript, node: clone, destructuringAgreements: compileDestructuringDecisions(originalFirst) }).entry,
            entry, 'A direct-range collision must not override the completed original-source decision.');
        const originalDecision = getDestructuringDecisionForNode({ typescript, node: clone, destructuringAgreements: compileDestructuringDecisions(agreements) });
        const { entry: originalEntry = {} } = originalDecision;
        assert.equal(originalEntry, entry, 'Renaming a clone cannot change source ownership.');
        typescript.setOriginalNode(clone, typescript.factory.createIdentifier('rangeless'));
        typescript.setTextRange(clone, member);
        assert.equal(getDestructuringDecisionForNode({ typescript, node: clone, destructuringAgreements: compileDestructuringDecisions(agreements) }).entry, entry,
            'Direct range is used only when the original shell has no matching entry.');

        const collision = { kind: 'unrelated-owner', contract: { action: 'retain' } };
        const ordered = new Map([[getConsumerContractKey(member), [collision, entry]]]);
        assert.equal(getDestructuringDecisionForNode({ typescript, node: member, destructuringAgreements: compileDestructuringDecisions(ordered) }).entry, collision);
        assert.equal(getDestructuringDecisionForNode({ typescript, node: member, destructuringAgreements: compileDestructuringDecisions(ordered),
            kinds: ['direct-capability'] }).entry, entry, 'Kind filtering preserves first accepted entry identity.');
        assert.deepEqual([...agreements], before);
    });

    const placeCompleted = ({ sourceFile = {}, contracts = new Map(), clonePlacement = '' } = {}) => {
        const destructuringAgreements = collectDestructuringAgreements({ callableOperationContracts: contracts });
        const before = [...destructuringAgreements];
        const { transformed: [placed = sourceFile] = [], dispose = () => {} } = typescript.transform(sourceFile, [context => (root) => {
            const visit = (node) => {
                const visited = typescript.visitEachChild(node, visit, context);
                const key = getConsumerContractKey(node);
                const [contract = {}] = [contracts.get(key)];
                const { placementRange = '' } = contract;

                if (!clonePlacement || key !== placementRange) return visited;

                const clone = typescript.factory.cloneNode(visited);
                typescript.setTextRange(clone, node);
                typescript.setOriginalNode(clone, clonePlacement === 'original' ? node : typescript.factory.createIdentifier('rangeless'));

                return clone;
            };

            return annotateRetainedStaticMemberAccess({ typescript, sourceFile: typescript.visitNode(root, visit),
                destructuringAgreements: compileDestructuringDecisions(destructuringAgreements), context });
        }]);
        const code = typescript.createPrinter().printFile(placed);
        dispose();
        assert.deepEqual([...destructuringAgreements], before);

        return typescript.transpileModule(code, { compilerOptions: { target: typescript.ScriptTarget.ESNext } }).outputText;
    };
    retentionCases.forEach(({ name = '', count = 0, boundaries = 1 } = {}) => {
        const sourceFile = sources.get(`${name}.ts`);
        const checker = program.getTypeChecker();
        const directCapabilityContracts = collectDirectCapabilityContracts({ typescript, sourceFile, checker });
        const closedStructuralModels = collectClosedStructuralModelContracts({ typescript, sourceFile, checker });
        const contracts = collectCallableOperationContracts({ typescript, sourceFile, checker, directCapabilityContracts, closedStructuralModels });
        const records = [...new Set(contracts.values())];
        assert.equal(records.length, count ? boundaries : 0, name);
        const expectedKeys = new Set(records.flatMap(({ sourceRange = '', callKey = '', placementRange = '', protectedBindings = [] } = {}) => [
            sourceRange, callKey, placementRange, ...protectedBindings
        ]));
        assert.deepEqual([...contracts.keys()], [...expectedKeys], name);
        const output = placeCompleted({ sourceFile, contracts });
        assert.equal(output.split('declared callable retains').length - 1,
            records.some(({ argumentRead = false } = {}) => argumentRead) ? boundaries : 0, name);
        assert.doesNotMatch(output, /eslint-disable[^\n]*resilient\/signature-contract-operation/, name);
        const messages = linter.verify(output, retainedLintConfig);

        if (count) assert.equal(messages.filter(({ ruleId = '' } = {}) => ruleId === operationRule).length, 0, name);

        assert.equal(linter.getSuppressedMessages().filter(({ ruleId = '' } = {}) => ruleId === operationRule).length, 0, name);

        if (!count) return;

        const [[memberRange = '', contract = {}] = []] = [...contracts];
        const { sourceRange = '', placementRange = '', action = '' } = contract;
        assert.equal(memberRange, sourceRange);
        assert.equal(contracts.get(placementRange), contract, 'Member and placement share one original contract.');
        assert.equal(action, 'retain-callable-operation');
        assert.equal(placeCompleted({ sourceFile, contracts, clonePlacement: 'original' }), output,
            `${name}: original-range placement`);
        assert.equal(placeCompleted({ sourceFile, contracts, clonePlacement: 'direct' }), output,
            `${name}: rangeless-original direct placement fallback`);
        assert.equal(output.split(operationReason).length - 1, 0, name);
        assert.equal(output.split(propertyReason).length - 1, 0, name);
    });

    const throwingAgreements = compileDestructuringDecisions(new Map());
    const { byKey: throwingIndex = new Map() } = throwingAgreements;
    const queryFailure = new Error('agreement storage failed');
    Object.defineProperty(throwingIndex, 'get', { value: () => { throw queryFailure; } });
    assert.throws(() => getDestructuringDecisionForNode({ typescript, node: parse('r.map(1);'),
        destructuringAgreements: throwingAgreements }), error => error === queryFailure,
    'Lookup retains storage failure identity; absence is not a reason to swallow failure.');

    // Public routing is tested separately from the standalone placement owner.
    const publicTransformer = createTypeScriptTransformer({ typescript, program });
    publicCases.forEach(({ name = '', visible = 0, propertyBoundary = 0 } = {}) => {
        const sourceFile = sources.get(`${name}.ts`);
        const { code: output = '', agreements = [] } = publicTransformer.transform({
            code: sourceFile.getFullText(), fileName: `${name}.ts`
        });
        const messages = linter.verify(output, lintConfig);
        const suppressed = linter.getSuppressedMessages();
        assert.equal(output.split(propertyReason).length - 1, propertyBoundary, name);

        assert.equal(messages.filter(({ ruleId = '' } = {}) => ruleId === operationRule).length, visible, name);

        if (visible) {
            assert.equal(suppressed.filter(({ ruleId = '' } = {}) => ruleId === operationRule).length, 0, name);
            assert.equal(agreements.length, 0, 'A contradiction cannot acquire a completed dictionary agreement.');
        }
    });

    // Hostile fixtures name the observable, including work that never executes.
    const traceCases = [
        { name: 'getter argument callback receiver order', code: [
            'const r = { get map() { events.push("get");',
            'return function(value) { events.push(this === r ? "receiver" : "wrong receiver"); return value(); }; } };',
            'function read() { return r.map((events.push("argument"), () => { events.push("callback"); return 7; })); }'
        ].join('\n'), probe: 'read()', expected: '{"events":["get","argument","receiver","callback"],"value":7}' },
        { name: 'getter failure precedes argument', code: "const r = { get reduce() { events.push(\"get\"); throw new Error(\"getter\"); } }; function read() { return "
            + "r.reduce(events.push(\"argument\")); }",

        probe: 'read()', expected: '{"events":["get"],"failure":"Error:getter"}' },
        { name: 'argument failure precedes call', code: [
            'const r = { filter() { events.push("call"); } };',
            'function fail() { events.push("argument"); throw new Error("argument"); } function read() { return r.filter(fail()); }'
        ].join('\n'), probe: 'read()', expected: '{"events":["argument"],"failure":"Error:argument"}' },
        { name: 'false branch never reads member', code: 'const S = { get show() { events.push("get"); throw new Error("unreachable"); } }; function read() { if (false) return S.show; return 3; }',
            probe: 'read()', expected: '{"events":[],"value":3}' },
        { name: 'deferred expression phase', code: 'const S = { get concat() { events.push("get"); return 9; } }; function read() { return () => S.concat; }',
            probe: '(callback => { events.push("later"); return callback(); })(read())', expected: '{"events":["later","get"],"value":9}' },
        { name: 'property getter identity', code: 'const token = {}; const S = { get show() { events.push("get"); return token; } }; function read() { return S.show === token; }',
            probe: 'read()', expected: '{"events":["get"],"value":true}' },
        { name: 'callback failure remains callback owned', code: [
            'const r = { map(callback) { events.push("call"); return callback(); } };',
            'function read() { return r.map(() => { events.push("callback"); throw new Error("callback"); }); }'
        ].join('\n'), probe: 'read()', expected: '{"events":["call","callback"],"failure":"Error:callback"}' },
        { name: 'native noncallable failure follows argument work', code: [
            'const r = { get reduce() { events.push("get"); return 1; } };',
            'function read() { return r.reduce(events.push("argument")); }'
        ].join('\n'), probe: 'read()', expected: '{"events":["get","argument"],"failure":"TypeError:r.reduce is not a function"}' },
        { name: 'poisoned call property cannot replace native receiver call', code: [
            'function method(value) { events.push(this === dict ? "receiver" : "wrong receiver"); return value; }',
            'Object.defineProperty(method, "call", { get() { events.push("poisoned call"); throw new Error("call getter"); } });',
            'const dict = { map: method }; function read() { return dict.map(7); }'
        ].join('\n'), probe: 'read()', expected: '{"events":["receiver"],"value":7}' },
        { name: 'typed argument getter follows method getter', code: [
            'const dict = { get map() { events.push("method getter"); return value => { events.push("call"); return value; }; } };',
            'function read(arg) { return dict.map(arg.value); }'
        ].join('\n'), typedParameter: true,
        probe: 'read({ get value() { events.push("argument getter"); return 7; } })',
        expected: '{"events":["method getter","argument getter","call"],"value":7}' },
        { name: 'typed argument getter failure remains after method getter', code: [
            'const dict = { get map() { events.push("method getter"); return value => { events.push("call"); return value; }; } };',
            'function read(arg) { return dict.map(arg.value); }'
        ].join('\n'), typedParameter: true,
        probe: 'read({ get value() { events.push("argument getter"); throw new Error("argument getter"); } })',
        expected: '{"events":["method getter","argument getter"],"failure":"Error:argument getter"}' },
        { name: 'other argument field cannot trigger early object rest', code: [
            'const dict = { get map() { events.push("method getter"); return value => { events.push("call"); return value; }; } };',
            'function read(arg) { const value = dict.map(arg.value); return value + arg.extra; }'
        ].join('\n'), typedParameter: true,
        probe: 'read({ get value() { events.push("value getter"); return 7; }, get extra() { events.push("extra getter"); return 2; } })',
        expected: '{"events":["method getter","value getter","call","extra getter"],"value":9}' },
        { name: 'optional absent method fails after argument work', code: [
            'function mark() { events.push("argument"); return 1; }',
            'function read(dict) { return dict.map(mark()); }'
        ].join('\n'), typedOptionalProvider: true, probe: 'read({})',
        expected: '{"events":["argument"],"failure":"TypeError:dict.map is not a function"}' },
        { name: 'closed generic array model retains its completed defaults', code: [
            'const dict = { map(value, forest) { events.push("call"); return value + forest.length; } };',
            'function read(arg) { return dict.map(arg.value, arg.forest); }'
        ].join('\n'), typedModel: true, probe: 'read({ value: 2, forest: [3] })', expected: '{"events":["call"],"value":3}' },
        { name: 'deferred argument capture cannot trigger early object rest', code: [
            'const dict = { get map() { events.push("method getter"); return callback => { events.push("call"); return callback(); }; } };',
            'function read(arg) { const value = dict.map(() => arg.value); return value + arg.extra; }'
        ].join('\n'), typedParameter: true,
        probe: 'read({ get value() { events.push("value getter"); return 7; }, get extra() { events.push("extra getter"); return 2; } })',
        expected: '{"events":["method getter","call","value getter","extra getter"],"value":9}' },
        { name: 'multiline argument read keeps a complete local boundary', code: [
            'const dict = { get map() { events.push("method getter"); return (callback, value) => { events.push("call"); return value; }; } };',
            'function read(arg) { return dict.map(() => ({ marker: 1 }), arg.value); }'
        ].join('\n'), typedParameter: true, probe: 'read({ get value() { events.push("argument getter"); return 7; } })',
        expected: '{"events":["method getter","argument getter","call"],"value":7}' },
        { name: 'foreign parameter forwarding keeps its original binding', code: [
            'const dict = { map(value, callback) { events.push("map"); return callback(value); } };',
            'function build(token) { return { of: () => token.empty, apply: () => dict.map(1, value => token.concat(value, 2)) }; }',
            'function read() { const token = { empty: 0, concat(a, b) { events.push(this === token ? "receiver" : "wrong receiver"); return a + b; } };',
            'const built = build(token); return [built.of(), built.apply()]; }'
        ].join('\n'), typedForeignProvider: true, publicOnly: true, probe: 'read()',
        expected: '{"events":["map","receiver"],"value":[0,3]}' },
        { name: 'guarded inert native call does not read poisoned call', code: [
            'function method(value) { events.push(this === input ? "receiver" : "wrong receiver"); return value; }',
            'Object.defineProperty(method, "call", { get() { events.push("poisoned call"); throw new Error("call getter"); } });',
            'const input = { map: method }; function read(dict) { if (dict) { return dict.map(1); } return 0; }'
        ].join('\n'), typedProvider: true, probe: 'read(input)', expected: '{"events":["receiver"],"value":1}' }
    ];
    const traceSources = new Map(traceCases.map(({
        name = '', code = '', typedParameter = false, typedProvider = false, typedOptionalProvider = false, typedModel = false,
        typedForeignProvider = false
    } = {}) => {
        let typed = code;

        if (typedParameter) typed = typed.replace('read(arg)', 'read(arg: { value: number; extra: number })');

        if (typedProvider) typed = typed.replace('read(dict)', 'read(dict: { map: (value: number) => number })');

        if (typedOptionalProvider) typed = typed.replace('read(dict)', 'read(dict: { map?: (value: number) => number })');

        if (typedModel) typed = typed.replace('read(arg)', 'read(arg: { value: any; forest: number[] })');

        if (typedForeignProvider) typed = typed.replace('build(token)', 'build(token: { empty: number; concat: (a: number, b: number) => number })');

        return [`${name}.ts`, typescript.createSourceFile(`${name}.ts`, `export {};\nconst events = [];\n${typed}`,
            typescript.ScriptTarget.ESNext, true)];
    }));
    const traceProgram = typescript.createProgram([...traceSources.keys()], compilerOptions, {
        ...compilerHost,
        getSourceFile: (name, version) => traceSources.get(name) || compilerHost.getSourceFile(name, version)
    });
    traceCases.forEach(({ name = '', code = '', probe = '', expected = '' } = {}) => {
        const source = `const events = [];\n${code}`;
        const sourceFile = traceSources.get(`${name}.ts`);
        const checker = traceProgram.getTypeChecker();
        const closedStructuralModels = collectClosedStructuralModelContracts({ typescript, sourceFile, checker });
        const contracts = collectCallableOperationContracts({ typescript, sourceFile, checker, closedStructuralModels });
        const placed = placeCompleted({ sourceFile, contracts }).replace('export {};', '');
        const { problems = [], entries = [] } = getExceptionInventory({ file: `${name}.js`, source: placed });
        assert.deepEqual(problems, [], `${name}: emitted P-03 boundary\n${placed}`);
        assert.ok(entries.every(({ rules = [], reason = '' } = {}) => Boolean(rules.length) && Boolean(reason)), name);
        const { output: fixed = placed } = linter.verifyAndFix(placed, retainedLintConfig);
        const observe = (text = '') => runInNewContext(`${text}\nlet value; let failure;
        try { value = ${probe}; } catch (error) { failure = error.name + ":" + error.message; }
        JSON.stringify({ events, value, failure });`);
        assert.equal(observe(source), expected, name);
        assert.equal(observe(placed), expected, `${name}: actual final placement`);
        assert.equal(observe(fixed), expected, `${name}: targeted fixed lint`);
    });

    const traceTransformer = createTypeScriptTransformer({ typescript, program: traceProgram });
    await Promise.all(traceCases.map(async ({ name = '', probe = '', expected = '', typedModel = false, publicOnly = false } = {}) => {
        const sourceFile = traceSources.get(`${name}.ts`);
        const checker = traceProgram.getTypeChecker();
        const closedStructuralModels = collectClosedStructuralModelContracts({ typescript, sourceFile, checker });
        const contracts = collectCallableOperationContracts({ typescript, sourceFile, checker, closedStructuralModels });

        if (!contracts.size && !publicOnly) return;

        const { code = '', diagnostics = [] } = traceTransformer.transform({ code: sourceFile.getFullText(), fileName: `${name}.ts` });
        assert.deepEqual(diagnostics, [], name);
        const { entries: publicEntries = [] } = getExceptionInventory({ file: `${name}.js`, source: code });
        const retainedReason = 'declared callable retains Get, receiver, argument order and native failure';
        assert.equal(publicEntries.filter(({ reason = '' } = {}) => reason === retainedReason).length,
            code.split(retainedReason).length - 1, `${name}: every D-3 public boundary parses completely`);
        const { output: fixed = code } = linter.verifyAndFix(code, retainedLintConfig);
        const observePublic = async (text = '', expression = probe) => {
            const resolved = ['object', 'array', 'function'].reduce((result = '', module = '') => result.replaceAll(
                `eslint-plugin-resilient/standard/${module}`, import.meta.resolve(`eslint-plugin-resilient/standard/${module}`)
            ), text);
            const suffix = `let value; let failure;
            try { value = ${expression}; } catch (error) { failure = error.name + ":" + error.message; }
            export default JSON.stringify({ events, value, failure });`;
            const { default: observation = '' } = await import(`data:text/javascript,${encodeURIComponent(`${resolved}\n${suffix}`)}`);

            return observation;
        };
        assert.equal(await observePublic(code), expected, `${name}: public transformer`);
        assert.equal(await observePublic(fixed), expected, `${name}: fixed public transformer`);

        if (!typedModel) return;

        assert.ok([...contracts.values()].every(({ protectArguments = true } = {}) => !protectArguments),
            'A completed closed-model owner is not replaced by argument retention.');
        assert.equal(await observePublic(code, 'read({ value: 2 })'), '{"events":["call"],"value":2}',
            'Existing admitted model normalization supplies the absent array field.');
        assert.equal(await observePublic(fixed, 'read({ value: 2 })'), '{"events":["call"],"value":2}',
            'Fixed output preserves the completed model default.');
    }));
}

{
    // Each row crosses checker admission and the public placement path. The two
    // actions share a field-forwarding grammar constructor, not a source law.

    const cases = [
        { name: 'projection-array', projection: 1,
            code: 'export const use = (items: Array<{ value: number }>) => items.map(item => item.value);' },
        { name: 'projection-readonly', projection: 1,
            code: 'export const use = (items: ReadonlyArray<{ value: number }>) => items.map(item => item.value);' },
        { name: 'projection-tuple', projection: 1,
            code: 'export const use = (items: [{ value: number }]) => items.map(item => item.value);' },
        { name: 'projection-rest', projection: 1,
            code: 'export function use(...items: Array<{ value: number }>) { return items.map(item => item.value); }' },
        { name: 'projection-optional-type',
            code: 'export const use = (items: Array<{ value?: number }>) => items.map(item => item.value);' },
        { name: 'projection-optional-member',
            code: 'export const use = (items: Array<{ value: number }>) => items.map(item => item?.value);' },
        { name: 'projection-optional-receiver',
            code: 'export const use = (items: Array<{ value: number }>) => items?.map(item => item.value);' },
        { name: 'projection-optional-call',
            code: 'export const use = (items: Array<{ value: number }>) => items.map?.(item => item.value);' },
        { name: 'projection-custom-collection',
            code: 'export const use = (items: { map: (f: (item: { value: number }) => number) => number[] }) => items.map(item => item.value);' },
        { name: 'projection-unknown-collection',
            code: 'export const use = (items: any) => items.map((item: { value: number }) => item.value);' },
        { name: 'projection-other-method',
            code: 'export const use = (items: Array<{ value: number }>) => items.filter(item => item.value > 0);' },
        { name: 'projection-block-body',
            code: 'export const use = (items: Array<{ value: number }>) => items.map(item => { return item.value; });' },
        { name: 'projection-conditional-body',
            code: 'export const use = (items: Array<{ value: number }>) => items.map(item => item.value ? item.value : 0);' },
        { name: 'projection-extra-argument',
            code: 'export const use = (items: Array<{ value: number }>) => items.map(item => item.value, null);' },
        { name: 'projection-two-parameters',
            code: 'export const use = (items: Array<{ value: number }>) => items.map((item, index) => item.value);' },
        { name: 'projection-computed-field',
            code: 'export const use = (items: Array<{ value: number }>) => items.map(item => item["value"]);' },
        { name: 'projection-computed-method',
            code: 'export const use = (items: Array<{ value: number }>) => items["map"](item => item.value);' },
        { name: 'projection-function-callback',
            code: 'export const use = (items: Array<{ value: number }>) => items.map(function(item) { return item.value; });' },
        { name: 'projection-same-spelled-neighbor', projection: 1,
            code: 'export const use = (items: Array<{ value: number }>) => [items.map(item => item.value), items.map(item => { return item.value; })];' },
        { name: 'forward-direct', forwarded: 1,
            code: 'export function use(P: { call: (value: number) => number }) { return { call: P.call }; }' },
        { name: 'forward-parenthesized-record', forwarded: 1,
            code: 'export function use(P: { call: (value: number) => number }) { return ({ call: P.call }); }' },
        { name: 'forward-two-fields', forwarded: 2,
            code: 'export function use(P: { left: (value: number) => number; right: (value: number) => number }) { return { left: P.left, right: P.right }; }' },
        { name: 'forward-optional-syntax',
            code: 'export function use(P: { call: (value: number) => number }) { return { call: P?.call }; }' },
        { name: 'forward-optional-type',
            code: 'export function use(P: { call?: (value: number) => number }) { return { call: P.call }; }' },
        { name: 'forward-noncallable',
            code: 'export function use(P: { value: number }) { return { value: P.value }; }' },
        { name: 'forward-invoked',
            code: 'export function use(P: { call: (value: number) => number }) { return { call: P.call(1) }; }' },
        { name: 'forward-direct-return',
            code: 'export function use(P: { call: (value: number) => number }) { return P.call; }' },
        { name: 'forward-indirect-record',
            code: 'export function use(P: { call: (value: number) => number }) { const record = { call: P.call }; return record; }' },
        { name: 'forward-expression-arrow',
            code: 'export const use = (P: { call: (value: number) => number }) => ({ call: P.call });' },
        { name: 'forward-parenthesized-member',
            code: 'export function use(P: { call: (value: number) => number }) { return { call: (P.call) }; }' },
        { name: 'forward-computed-property',
            code: 'export function use(P: { call: (value: number) => number }) { return { ["call"]: P.call }; }' },
        { name: 'forward-computed-member',
            code: 'export function use(P: { call: (value: number) => number }) { return { call: P["call"] }; }' },
        { name: 'forward-same-spelled-neighbor', forwarded: 1,
            code: 'export function use(P: { call: (value: number) => number }) { const inner = { call: P.call }; return { call: P.call, inner }; }' }
    ];
    const sources = new Map(cases.map(({ name = '', code = '' } = {}) => [
        `${name}.ts`, typescript.createSourceFile(`${name}.ts`, code, typescript.ScriptTarget.ESNext, true)
    ]));
    const options = { strict: true, target: typescript.ScriptTarget.ESNext };
    const host = typescript.createCompilerHost(options);
    const program = typescript.createProgram([...sources.keys()], options, {
        ...host,
        getSourceFile: (name, version) => sources.get(name) || host.getSourceFile(name, version)
    });
    const checker = program.getTypeChecker();
    const { transform = false } = createTypeScriptTransformer({ typescript, program });

    cases.forEach(({ name = '', code = '', projection = 0, forwarded = 0 } = {}) => {
        const fileName = `${name}.ts`;
        const sourceFile = sources.get(fileName);
        const projectionFacts = collectExactProjectionContracts({ typescript, sourceFile, checker });
        const forwardFacts = collectProviderForwardContracts({ typescript, sourceFile, checker });
        const { diagnostics = [], agreements = [] } = transform({ code, fileName });
        const actions = agreements.map(({ action = '' } = {}) => action);

        assert.equal(projectionFacts.size, projection, `${name}: projection checker fact`);
        assert.equal(forwardFacts.size, forwarded, `${name}: forwarding checker fact`);
        assert.equal(collectExactProjectionContracts({ typescript, sourceFile }).size, 0,
            `${name}: projection requires a checker`);
        assert.equal(collectProviderForwardContracts({ typescript, sourceFile }).size, 0,
            `${name}: forwarding requires a checker`);
        assert.deepEqual(diagnostics, [], `${name}: compiler diagnostics`);
        assert.equal(actions.filter(action => action === 'exact-callback-projected').length,
            projection, `${name}: exact projection placement`);
        assert.equal(actions.filter(action => action === 'provider-forwarded').length,
            forwarded, `${name}: provider forwarding placement`);
    });

    const [{ code: twoFieldSource = '' } = {}] = cases.filter(({ name = '' } = {}) => name === 'forward-two-fields');
    const { code: twoFieldTarget = '' } = transform({ code: twoFieldSource, fileName: 'forward-two-fields.ts' });
    const execute = async (code = '') => {
        const { outputText = '' } = typescript.transpileModule(code, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const { use = false } = await loadModule(outputText);

        return use;
    };
    const observeForwarding = async (code = '') => {
        const use = await execute(code);
        const left = value => value;
        const right = value => value;
        const failure = new Error('second getter');
        let events = [];
        const present = use({
            get left() {
                events = [...events, 'left'];

                return left;
            },
            get right() {
                events = [...events, 'right'];

                return right;
            }
        });
        const { left: presentLeft = false, right: presentRight = false } = present;
        const absent = use({});
        const identity = presentLeft === left && presentRight === right;
        const missing = Object.is(Reflect.get(absent, 'left'), void 0) &&
            Object.is(Reflect.get(absent, 'right'), void 0);
        let abruptIdentity = false;

        try {
            use({ get left() {
                events = [...events, 'left'];

                return left;
            }, get right() {
                events = [...events, 'throw'];

                throw failure;
            } });
        } catch (error) {
            abruptIdentity = error === failure;
        }

        return { identity, missing, abruptIdentity, events };
    };

    assert.deepEqual(await observeForwarding(twoFieldSource), {
        identity: true,
        missing: true,
        abruptIdentity: true,
        events: ['left', 'right', 'left', 'throw']
    });
    assert.deepEqual(await observeForwarding(twoFieldTarget), await observeForwarding(twoFieldSource));
}

{
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
        tupleMetadataNeutral: "type Carrier=([number]&{signal:\"ready\"})|([number,number]&{signal:\"idle\"});export const "
            + "read=(value:Carrier)=>{if(value.signal===\"ready\")return value[0];return value[1];};",

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
                cardinalities.forEach(({ action = '', selection: { partitions = [] } = {} } = {}) => {
                    assert.equal(action, 'retain-source-phase-read');
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

                // eslint-disable-next-line no-restricted-syntax -- The optional operation oracle must observe the original input receiver after the field read.
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

                // eslint-disable-next-line no-restricted-syntax -- The acquired binary operation must observe its invocation receiver, not the getter receiver.
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

                // eslint-disable-next-line no-restricted-syntax -- The retained operation must preserve its receiver when invoked before advancing the continuation.
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

                    // eslint-disable-next-line no-restricted-syntax -- Computed method dispatch must preserve the input receiver after exactly one property lookup.
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
            // eslint-disable-next-line resilient/no-undefined-assignment -- The selected-getter fixture deliberately supplies undefined to compare exact absence and read order.
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
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-hoisted-functions-'));
    const fileName = path.join(directory, 'cycle.ts');
    const source = [
        'export const early = first(4);',
        'export function first(value: number): number {',
        '    return value ? second(value - 1) : 1;',
        '}',
        'export function second(value: number): number {',
        '    return value ? first(value - 1) : 2;',
        '}',
        'export function ordinary(value: number): number { return value + 1; }',
        ''
    ].join('\n');

    try {
        await writeFile(fileName, source);
        const program = typescript.createProgram([fileName], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        });
        const contracts = collectHoistedFunctionContracts({
            typescript, sourceFile: program.getSourceFile(fileName), checker: program.getTypeChecker()
        });
        const cycles = [...contracts.values()].filter(({ action = '' } = {}) => action === 'retain-hoisted-function');

        assert.equal(cycles[0].forwardReturnRanges.length, 1);
        assert.equal(cycles[1].forwardReturnRanges.length, 0);
        assert.equal([...contracts.values()].filter(({ action = '' } = {}) => action === 'retain-hoisted-reference').length >= 2, true);

        const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
            code: source, fileName
        });

        assert.deepEqual(diagnostics, []);
        assert.match(code, /export function first/);
        assert.match(code, /export function second/);
        assert.match(code, /export function ordinary/);
        assert.match(code, /eslint-disable-next-line func-style -- Native function declaration/);
        assert.doesNotMatch(code, /eslint-disable-next-line no-use-before-define -- Native mutual recursion/);

        const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
        const options = { overrideConfigFile: true, overrideConfig: config };
        const [raw = {}] = await new ESLint(options).lintText(code, { filePath: 'cycle-generated.js' });
        const [fixed = {}] = await new ESLint({ ...options, fix: true }).lintText(code, {
            filePath: 'cycle-generated.js'
        });

        assert.equal(raw.errorCount, 0, JSON.stringify({ messages: raw.messages, code }));
        assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));

        const { outputText: sourceJavaScript = '' } = typescript.transpileModule(source, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const load = async text => import(`data:text/javascript,${encodeURIComponent(text)}`);
        const baseline = await load(sourceJavaScript);
        const lowered = await load(code);

        assert.equal(lowered.early, baseline.early);
        assert.equal(lowered.first(7), baseline.first(7));
        assert.equal(lowered.second(7), baseline.second(7));

        const deferredFile = path.join(directory, 'deferred.ts');
        const deferredSource = [
            'export function tree(value: number): number {',
            '    const visit = forest();',
            '    return visit(value);',
            '}',
            'export function forest(): (value: number) => number {',
            '    return value => value ? tree(value - 1) : 1;',
            '}',
            ''
        ].join('\n');

        await writeFile(deferredFile, deferredSource);
        const deferredProgram = typescript.createProgram([deferredFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const { code: deferredCode = '', diagnostics: deferredDiagnostics = [] } = createTypeScriptTransformer({
            typescript, program: deferredProgram
        }).transform({ code: deferredSource, fileName: deferredFile });

        assert.deepEqual(deferredDiagnostics, []);
        assert.match(deferredCode, /eslint-disable no-use-before-define -- source lifetime[\s\S]*const visit = forest\(\);[\s\S]*eslint-enable no-use-before-define/);
        const [deferredLint = {}] = await new ESLint({ ...options, fix: true }).lintText(deferredCode, {
            filePath: 'deferred-generated.js'
        });

        assert.equal(deferredLint.errorCount, 0, JSON.stringify({ messages: deferredLint.messages, code: deferredCode }));
        const { outputText: deferredJavaScript = '' } = typescript.transpileModule(deferredSource, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const deferredBaseline = await load(deferredJavaScript);
        const deferredLowered = await load(deferredCode);

        assert.equal(deferredLowered.tree(4), deferredBaseline.tree(4));

        const capabilityFile = path.join(directory, 'capabilities.ts');
        const capabilitySource = [
            'export function Construct(value: number) {',
            '    // eslint-disable-next-line resilient/prefer-safe-transformations -- Constructor state belongs to the newly created instance.',
            '    this.value = value;',
            '    return new.target;',
            '}',
            'export function prototypeOwned() {',
            "    return Object.hasOwn(prototypeOwned, 'prototype');",
            '}',
            'export function receiver(this: { value: number }) {',
            '    return this.value;',
            '}',
            'export function firstArgument(value: number) {',
            '    return arguments[0];',
            '}',
            'export function target() {',
            '    return new.target;',
            '}',
            'export function nestedTarget() {',
            '    return () => new.target;',
            '}',
            'function escapes() {',
            '    return 7;',
            '}',
            'export const escaped = escapes;',
            'function ordinary(value: number) {',
            '    return value + 1;',
            '}',
            'export const ordinaryResult = ordinary(4);',
            'export const hoistedResult = hoisted();',
            'function hoisted() {',
            '    return 11;',
            '}',
            ''
        ].join('\n');

        await writeFile(capabilityFile, capabilitySource);
        const capabilityProgram = typescript.createProgram([capabilityFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const capabilitySourceFile = capabilityProgram.getSourceFile(capabilityFile);
        const nativeContracts = collectNativeFunctionContracts({
            typescript, sourceFile: capabilitySourceFile, checker: capabilityProgram.getTypeChecker()
        });
        const nativeEntries = [...nativeContracts.values()];
        const nativeDeclarations = nativeEntries.filter(({ operationRole = '' } = {}) => (
            operationRole === 'native-function-capability'
        ));

        assert.equal(nativeDeclarations.length, 9);
        assert.equal(nativeEntries.filter(({ operationRole = '' } = {}) => operationRole === 'native-function-reference').length, 1);
        assert.equal(nativeDeclarations.filter(({ arrowEquivalent = false } = {}) => arrowEquivalent).length, 1);
        assert.equal(nativeDeclarations.some(({ capabilities = [] } = {}) => capabilities.includes('dynamic-this')), true);
        assert.equal(nativeDeclarations.some(({ capabilities = [] } = {}) => capabilities.includes('arguments')), true);
        assert.equal(nativeDeclarations.filter(({ capabilities = [] } = {}) => capabilities.includes('new-target')).length, 3);
        nativeEntries.forEach(({ sourceRange = '' } = {}) => {
            const nativeAgreements = collectDestructuringAgreements({ nativeFunctionContracts: nativeContracts }).get(sourceRange) || [];
            const [entry = {}] = nativeAgreements;
            const { action = '' } = getDestructuringAgreement({ entry });

            assert.equal([
                'lower-equivalent-arrow', 'lower-native-function-expression', 'retain-native-function-declaration',
                'retain-native-function-reference'
            ].includes(action), true);
        });

        const { code: capabilityCode = '', diagnostics: capabilityDiagnostics = [] } = createTypeScriptTransformer({
            typescript, program: capabilityProgram
        }).transform({ code: capabilitySource, fileName: capabilityFile });

        assert.deepEqual(capabilityDiagnostics, []);
        assert.match(capabilityCode, /export function Construct/);
        assert.match(capabilityCode, /return new\.target/);
        assert.match(capabilityCode, /export function nestedTarget/);
        assert.match(capabilityCode, /const escapes = \/\* eslint-disable-line no-restricted-syntax -- Escaped function value keeps native construction\. \*\/ function escapes/u);
        assert.match(capabilityCode, /const ordinary = \(value\) =>/);
        assert.match(capabilityCode, /function hoisted\(\)/);
        const [capabilityRaw = {}] = await new ESLint(options).lintText(capabilityCode, {
            filePath: 'capabilities-generated.js'
        });
        const [capabilityFixed = {}] = await new ESLint({ ...options, fix: true }).lintText(capabilityCode, {
            filePath: 'capabilities-generated.js'
        });

        assert.equal(capabilityRaw.errorCount, 0, JSON.stringify({ messages: capabilityRaw.messages, code: capabilityCode }));
        assert.equal(capabilityFixed.errorCount, 0, JSON.stringify(capabilityFixed.messages));
        const { outputText: capabilityJavaScript = '' } = typescript.transpileModule(capabilitySource, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const capabilityBaseline = await load(capabilityJavaScript);
        const capabilityLowered = await load(capabilityCode);
        const capabilityFixedCode = capabilityFixed.output || capabilityCode;
        const capabilityLoweredFixed = await load(capabilityFixedCode);

        assert.equal(Reflect.construct(capabilityLowered.Construct, [3]), capabilityLowered.Construct);
        assert.equal(Object.hasOwn(capabilityLowered.Construct, 'prototype'), true);
        assert.equal(capabilityLowered.prototypeOwned(), capabilityBaseline.prototypeOwned());
        assert.equal(capabilityLowered.receiver.call({ value: 9 }), capabilityBaseline.receiver.call({ value: 9 }));
        assert.equal(capabilityLowered.firstArgument(5), capabilityBaseline.firstArgument(5));
        assert.equal(capabilityLowered.target(), capabilityBaseline.target());
        assert.equal(Reflect.construct(capabilityLowered.target, []), capabilityLowered.target);
        assert.equal(Reflect.construct(capabilityLowered.nestedTarget, [])(), capabilityLowered.nestedTarget);
        assert.equal(Object.hasOwn(capabilityLowered.escaped, 'prototype'), true);
        assert.equal(capabilityLowered.ordinaryResult, capabilityBaseline.ordinaryResult);
        assert.equal(capabilityLowered.hoistedResult, capabilityBaseline.hoistedResult);
        assert.equal(Reflect.construct(capabilityLoweredFixed.target, []), capabilityLoweredFixed.target);
        assert.equal(capabilityLoweredFixed.receiver.call({ value: 9 }), capabilityBaseline.receiver.call({ value: 9 }));
        assert.equal(capabilityLoweredFixed.ordinaryResult, capabilityBaseline.ordinaryResult);

        const lifetimeFile = path.join(directory, 'declaration-lifetime.ts');
        const lifetimeSource = [
            'export const nestedEarly = (() => {',
            '    const value = later();',
            '    function later() { return 1; }',
            '    return value;',
            '})();',
            'export const blockEscape = (() => {',
            '    if (true) { var value = 7; }',
            '    return value;',
            '})();',
            'export const earlyUndefined = (() => {',
            '    const before = value;',
            '    var value = 9;',
            '    return before;',
            '})();',
            'export const reassigned = (() => {',
            '    var value = 1;',
            '    value = 2;',
            '    return value;',
            '})();',
            'export const safe = (() => {',
            '    var value = 3;',
            '    return value;',
            '})();',
            'export const changedResult = (() => {',
            '    function changed() { return 1; }',
            '    changed = () => 2;',
            '    return changed();',
            '})();',
            'export const siblings = (flag: boolean) => {',
            '    const left = () => {',
            '        const value = one();',
            '        function one() { return 1; }',
            '        return value;',
            '    };',
            '    const right = () => {',
            '        const value = one();',
            '        function one() { return 2; }',
            '        return value;',
            '    };',
            '    return flag ? left() : right();',
            '};',
            'export const nestedCycle = (count: number): number => {',
            '    const value = first(count);',
            '    function first(current: number): number { return current ? second(current - 1) : 1; }',
            '    function second(current: number): number { return current ? first(current - 1) : 2; }',
            '    return value;',
            '};',
            'export const lexicalTdz = () => {',
            '    try {',
            '        // eslint-disable-next-line no-use-before-define -- Native TDZ failure is the source behavior under proof.',
            '        const before = value;',
            '        let value;',
            '        return before;',
            '    } catch (error) {',
            '        return error.name;',
            '    }',
            '};',
            'export function overloaded(value: string): string;',
            'export function overloaded(value: number): number;',
            'export function overloaded(value: string | number): string | number {',
            '    const callAgain = overloaded;',
            '    return typeof value === "string" ? callAgain(value) : value;',
            '}',
            'export function reorderedConsumer() { return reorderedProvider(); }',
            'export function reorderedProvider() { return 5; }',
            ''
        ].join('\n');

        await writeFile(lifetimeFile, lifetimeSource);
        const lifetimeProgram = typescript.createProgram([lifetimeFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const lifetimeSourceFile = lifetimeProgram.getSourceFile(lifetimeFile);
        const lifetimeChecker = lifetimeProgram.getTypeChecker();
        const lifetimeContracts = collectDeclarationLifetimeContracts({
            typescript, sourceFile: lifetimeSourceFile, checker: lifetimeChecker
        });
        const lifetimeAgreements = collectDestructuringAgreements({ declarationLifetimeContracts: lifetimeContracts });
        const lifetimeActions = [...lifetimeContracts.values()]
            .filter(({ operationRole = '' } = {}) => operationRole === 'declaration-lifetime')
            .map(({ sourceRange = '' } = {}) => getDestructuringAgreement({
                entry: (lifetimeAgreements.get(sourceRange) || [])[0]
            }).action);

        assert.deepEqual(lifetimeActions.toSorted(), [
            'lower-scope-entry-var-let',
            'lower-scope-entry-var-let',
            'normalize-function-var-const',
            'normalize-function-var-let'
        ]);
        [...lifetimeContracts.values()]
            .filter(({ operationRole = '' } = {}) => operationRole === 'declaration-lifetime')
            .forEach(({ owningScopeRange = '', initializationPhase = '' } = {}) => {
                assert.ok(owningScopeRange);
                assert.equal(initializationPhase, 'scope-entry-undefined-then-declaration-assignment');
            });
        const lifetimeNativeContracts = collectNativeFunctionContracts({
            typescript, sourceFile: lifetimeSourceFile, checker: lifetimeChecker
        });
        const mutableFunction = [...lifetimeNativeContracts.values()].find(({ mutableBinding = false } = {}) => mutableBinding);

        assert.equal(mutableFunction.writeRanges.length, 1);
        assert.ok(mutableFunction.owningScopeRange);
        assert.equal(mutableFunction.initializationPhase, 'scope-instantiation');

        const { code: lifetimeCode = '', diagnostics: lifetimeDiagnostics = [] } = createTypeScriptTransformer({
            typescript, program: lifetimeProgram
        }).transform({ code: lifetimeSource, fileName: lifetimeFile });

        assert.deepEqual(lifetimeDiagnostics, []);
        assert.match(lifetimeCode, /function later\(\)/);
        assert.match(lifetimeCode, /let value;[\s\S]*if \(true\) \{[\s\S]*value = 7;/);
        assert.match(lifetimeCode, /let value;[\s\S]*const before = value;[\s\S]*value = 9;/);
        assert.match(lifetimeCode, /let value = 1;\s+value = 2;/);
        assert.match(lifetimeCode, /const value = 3;/);
        assert.match(lifetimeCode, /function changed\(\)/);
        assert.equal((lifetimeCode.match(/function one\(\)/gu) || []).length, 2);
        assert.match(lifetimeCode, /function first\(current\)/);
        assert.match(lifetimeCode, /function second\(current\)/);
        assert.match(lifetimeCode, /const callAgain = overloaded;/);
        assert.doesNotMatch(lifetimeCode, /overloaded \/\* eslint-disable-line no-use-before-define/u);
        assert.ok(lifetimeCode.indexOf('reorderedConsumer') < lifetimeCode.indexOf('reorderedProvider'));
        assert.match(lifetimeCode, /eslint-disable no-use-before-define -- source lifetime[\s\S]*return reorderedProvider\(\);[\s\S]*eslint-enable no-use-before-define/u);
        assert.doesNotMatch(lifetimeCode, /__RESILIENT_PRESERVE_VAR__/u);
        const [lifetimeRaw = {}] = await new ESLint(options).lintText(lifetimeCode, {
            filePath: 'declaration-lifetime-generated.js'
        });
        const [lifetimeFixed = {}] = await new ESLint({ ...options, fix: true }).lintText(lifetimeCode, {
            filePath: 'declaration-lifetime-generated.js'
        });

        assert.equal(lifetimeRaw.errorCount, 0, JSON.stringify({ messages: lifetimeRaw.messages, code: lifetimeCode }));
        assert.equal(lifetimeFixed.errorCount, 0, JSON.stringify(lifetimeFixed.messages));
        assert.doesNotMatch(lifetimeFixed.output || lifetimeCode, /overloaded\s+;/u);
        const { outputText: lifetimeJavaScript = '' } = typescript.transpileModule(lifetimeSource, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const lifetimeBaseline = await load(lifetimeJavaScript);
        const lifetimeLowered = await load(lifetimeCode);
        const lifetimeLoweredFixed = await load(lifetimeFixed.output || lifetimeCode);
        const expectedLifetime = {
            nestedEarly: 1,
            blockEscape: 7,
            // eslint-disable-next-line resilient/no-undefined-assignment -- The hoisting oracle preserves early native undefined before initialization instead of normalizing the observed lifetime.
            earlyUndefined: undefined,
            reassigned: 2,
            safe: 3,
            changedResult: 2,
            siblingTrue: 1,
            siblingFalse: 2,
            cycle: 2,
            tdz: 'ReferenceError',
            reordered: 5
        };
        const lifetimeAbsence = Symbol('lifetime absence');
        const observeLifetime = ({
            nestedEarly = 0,
            blockEscape = 0,
            earlyUndefined = lifetimeAbsence,
            reassigned = 0,
            safe = 0,
            changedResult = 0,
            siblings: observeSiblings = (flag = false) => flag,
            nestedCycle: observeCycle = (count = 0) => count,
            lexicalTdz: observeTdz = () => false,
            reorderedConsumer: observeReordered = () => 0
        } = {}) => ({
            nestedEarly,
            blockEscape,
            // eslint-disable-next-line resilient/no-undefined-assignment -- The hoisting oracle preserves early native undefined before initialization instead of normalizing the observed lifetime.
            earlyUndefined: earlyUndefined === lifetimeAbsence ? void 0 : earlyUndefined,
            reassigned,
            safe,
            changedResult,
            siblingTrue: observeSiblings(true),
            siblingFalse: observeSiblings(false),
            cycle: observeCycle(3),
            tdz: observeTdz(),
            reordered: observeReordered()
        });

        assert.deepEqual(observeLifetime(lifetimeBaseline), expectedLifetime);
        assert.deepEqual(observeLifetime(lifetimeLowered), expectedLifetime);
        assert.deepEqual(observeLifetime(lifetimeLoweredFixed), expectedLifetime);

        const markerFile = path.join(directory, 'literal-marker.ts');
        const markerPayload = '/*__RESILIENT_PRESERVE_VAR__*/';
        const markerSource = [
            `export const stringPayload = ${JSON.stringify(markerPayload)};`,
            'export const templatePayload = `/*__RESILIENT_PRESERVE_VAR__*/`;',
            'export const patternPayload = /__RESILIENT_PRESERVE_VAR__/u;',
            'export const generatedNamePayload = "__RESILIENT_GENERATED_RETAINED_VAR_0__";',
            '/*__RESILIENT_PRESERVE_VAR__*/',
            'export const authoredCommentPayload = "kept";',
            '/*__RESILIENT_GENERATED_RETAINED_VAR_0__*/',
            'export const collisionCommentPayload = "also kept";',
            'export const retainedLifetime = (() => {',
            '    const before = value;',
            '    var value = 7;',
            '    return [before, value];',
            '})();',
            ''
        ].join('\n');

        await writeFile(markerFile, markerSource);
        const markerProgram = typescript.createProgram([markerFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const { code: markerCode = '', diagnostics: markerDiagnostics = [] } = createTypeScriptTransformer({
            typescript, program: markerProgram
        }).transform({ code: markerSource, fileName: markerFile });

        assert.deepEqual(markerDiagnostics, []);
        assert.match(markerCode, /stringPayload = "[/][*]__RESILIENT_PRESERVE_VAR__[*][/]"/u);
        assert.match(markerCode, /templatePayload = `[/][*]__RESILIENT_PRESERVE_VAR__[*][/]`/u);
        assert.match(markerCode, /patternPayload = \/__RESILIENT_PRESERVE_VAR__\/u/u);
        assert.match(markerCode, /generatedNamePayload = "__RESILIENT_GENERATED_RETAINED_VAR_0__"/u);
        assert.match(markerCode, /[/][*]__RESILIENT_PRESERVE_VAR__[*][/]\s+export const authoredCommentPayload/u);
        assert.match(markerCode, /[/][*]__RESILIENT_GENERATED_RETAINED_VAR_0__[*][/]\s+export const collisionCommentPayload/u);
        assert.match(markerCode, /let value;[\s\S]*const before = value;[\s\S]*value = 7;/u);
        assert.doesNotMatch(markerCode, /[/][*]__RESILIENT_GENERATED_RETAINED_VAR_1__[*][/]/u);
        const markerLowered = await load(markerCode);

        assert.equal(markerLowered.stringPayload, markerPayload);
        assert.equal(markerLowered.templatePayload, markerPayload);
        assert.equal(markerLowered.patternPayload.test(markerPayload), true);
        assert.equal(markerLowered.generatedNamePayload, '__RESILIENT_GENERATED_RETAINED_VAR_0__');
        assert.equal(markerLowered.authoredCommentPayload, 'kept');
        assert.equal(markerLowered.collisionCommentPayload, 'also kept');
        // eslint-disable-next-line resilient/no-undefined-assignment -- The hoisting oracle preserves early native undefined before initialization instead of normalizing the observed lifetime.
        assert.deepEqual(markerLowered.retainedLifetime, [undefined, 7]);
        const { code: minimumMarkerCode = '', diagnostics: minimumMarkerDiagnostics = [] } = createTypeScriptTransformer({
            typescript, program: markerProgram, target: typescript.ScriptTarget.ES2016
        }).transform({ code: markerSource, fileName: markerFile });

        assert.deepEqual(minimumMarkerDiagnostics, []);
        assert.match(minimumMarkerCode, /stringPayload = "[/][*]__RESILIENT_PRESERVE_VAR__[*][/]"/u);
        assert.match(minimumMarkerCode, /[/][*]__RESILIENT_GENERATED_RETAINED_VAR_0__[*][/]\s+export const collisionCommentPayload/u);
        const minimumMarkerLowered = await load(minimumMarkerCode);

        assert.equal(minimumMarkerLowered.stringPayload, markerPayload);
        assert.equal(minimumMarkerLowered.templatePayload, markerPayload);
        assert.equal(minimumMarkerLowered.patternPayload.test(markerPayload), true);
        assert.equal(minimumMarkerLowered.authoredCommentPayload, 'kept');
        assert.equal(minimumMarkerLowered.collisionCommentPayload, 'also kept');
        // eslint-disable-next-line resilient/no-undefined-assignment -- The hoisting oracle preserves early native undefined before initialization instead of normalizing the observed lifetime.
        assert.deepEqual(minimumMarkerLowered.retainedLifetime, [undefined, 7]);
        const [minimumMarkerRaw = {}] = await new ESLint(options).lintText(minimumMarkerCode, {
            filePath: 'minimum-marker-generated.js'
        });
        const [minimumMarkerFixed = {}] = await new ESLint({ ...options, fix: true }).lintText(minimumMarkerCode, {
            filePath: 'minimum-marker-generated.js'
        });
        const minimumMarkerFixedModule = await load(minimumMarkerFixed.output || minimumMarkerCode);

        assert.equal(minimumMarkerRaw.errorCount, 0, JSON.stringify(minimumMarkerRaw.messages));
        assert.equal(minimumMarkerFixed.errorCount, 0, JSON.stringify(minimumMarkerFixed.messages));
        assert.equal(minimumMarkerFixedModule.stringPayload, markerPayload);
        assert.equal(minimumMarkerFixedModule.templatePayload, markerPayload);
        assert.equal(minimumMarkerFixedModule.patternPayload.test(markerPayload), true);
        // eslint-disable-next-line resilient/no-undefined-assignment -- The hoisting oracle preserves early native undefined before initialization instead of normalizing the observed lifetime.
        assert.deepEqual(minimumMarkerFixedModule.retainedLifetime, [undefined, 7]);

        const declarationCases = [
            ['initializer-call', 'export const value = invoke(); function target() { return 7; } function invoke() { return target(); }'],
            ['self-read', 'export const value = (() => { var x: number | undefined = x; return x; })();'],
            ['forward-read', 'export const value = (() => { var x: number | undefined = y, y: number | undefined = 1; return x; })();'],
            ['redeclared', 'export const value = (() => { var x = 1; var x; return x; })();'],
            ['parameter', 'export const value = ((x: number) => { var x; return x; })(3);'],
            ['module-entry', 'export const value = x; var x: number | undefined = 1;'],
            ['directive', 'export const value = (() => { "use strict"; var x = 2; return x; })();'],
            ['function-eval', 'export const value = (() => { function inspect() { return (eval)("typeof target"); } const before = inspect(); function target() {} return before; })();'],
            ['arguments-eval', 'export const value = (function(){ return (eval)("arguments.length"); })();'],
            ['shared-loop', 'export const value = (() => { const reads: Array<() => number> = []; for (var i = 0; i < 3; i++) reads.push(() => i); return reads.map(read => read()); })();'],
            ['shared-for-of', 'export const value = (() => { const reads: Array<() => number> = []; for (var x of [1, 2]) reads.push(() => x); return reads.map(read => read()); })();'],
            ['shared-for-in', [
                'export const value = (() => {',
                '    const reads: Array<() => string> = [];',
                '    const entries = { first: 1, second: 2 };',
                '    for (var key in entries) reads.push(() => key);',
                '    return reads.map(read => read());',
                '})();'
            ].join('\n')],
            ['labeled-loop', 'export const value = (() => { const reads: number[] = []; outer: for (var i = 0; i < 3; i++) { if (i === 2) break outer; reads.push(i); } return reads; })();']
        ];

        // eslint-disable-next-line resilient/prefer-prototype-methods -- Each temporary program and its native-fixed result are checked sequentially.
        for (const [caseName = '', caseSource = ''] of declarationCases) {
            const caseFile = path.join(directory, `${caseName}.ts`);

            await writeFile(caseFile, caseSource);

            const caseProgram = typescript.createProgram([caseFile], {
                module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
            });
            const recoveredInput = ['self-read', 'forward-read', 'redeclared', 'parameter', 'module-entry'].includes(caseName);

            if (!recoveredInput) assert.equal(typescript.getPreEmitDiagnostics(caseProgram).length, 0, caseName);

            const { code: caseCode = '', diagnostics: caseDiagnostics = [] } = createTypeScriptTransformer({
                typescript, program: caseProgram
            }).transform({ code: caseSource, fileName: caseFile });

            assert.deepEqual(caseDiagnostics, [], caseName);

            const emittedTree = typescript.createSourceFile(caseFile, caseCode, typescript.ScriptTarget.ESNext, true);
            const visitDeclarations = (node) => {
                const { flags = 0 } = node;

                if (typescript.isVariableDeclarationList(node)) assert.ok(
                    flags & (typescript.NodeFlags.Let | typescript.NodeFlags.Const), caseName
                );

                typescript.forEachChild(node, visitDeclarations);
            };

            visitDeclarations(emittedTree);

            const { outputText: baselineCode = '' } = typescript.transpileModule(caseSource, {
                compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
            });
            const baselineModule = await load(baselineCode);
            const loweredModule = await load(caseCode);

            assert.deepEqual(loweredModule.value, baselineModule.value, caseName);

            const [caseRaw = {}] = await new ESLint(options).lintText(caseCode, {
                filePath: `${caseName}-generated.js`
            });
            const [caseFixed = {}] = await new ESLint({ ...options, fix: true }).lintText(caseCode, {
                filePath: `${caseName}-generated.js`
            });

            assert.equal(caseRaw.fatalErrorCount, 0, caseName);
            assert.equal(caseFixed.fatalErrorCount, 0, caseName);
            assert.deepEqual((await load(caseFixed.output || caseCode)).value, baselineModule.value, caseName);

            // The shared-loop probes contain authored push/label syntax and test
            // binding semantics; their independent policy findings are expected.
            if (!['shared-loop', 'shared-for-of', 'shared-for-in', 'labeled-loop'].includes(caseName)) {
                assert.equal(caseRaw.errorCount, 0, JSON.stringify({ caseName, messages: caseRaw.messages }));
                assert.equal(caseFixed.errorCount, 0, JSON.stringify({ caseName, messages: caseFixed.messages }));
            }
        }

        const unsupportedCases = [
            ['script', 'var x = 1;', 'script global'],
            ['export-alias', 'var x = 1; export { x };', 'module export'],
            ['captured-module', 'var x = 1; export function read() { return x; }', 'captured module'],
            ['nested-eval', 'export const value = (() => { function inspect() { return (eval)("typeof x"); } const before = inspect(); var x = 1; return before; })();', 'direct eval'],
            ['pattern', 'export const value = (() => { var { x } = { x: 1 }; return x; })();', 'checker binding'],
            ['non-simple-parameter', 'export const value = ((x = 1) => { var x; return x; })();', 'non-simple parameter']
        ];

        // eslint-disable-next-line resilient/prefer-prototype-methods -- Rejection controls use isolated checker programs in source order.
        for (const [caseName = '', caseSource = '', reason = ''] of unsupportedCases) {
            const caseFile = path.join(directory, `${caseName}.ts`);

            await writeFile(caseFile, caseSource);

            const caseProgram = typescript.createProgram([caseFile], {
                module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
            });
            const { code: caseCode = '', diagnostics: caseDiagnostics = [] } = createTypeScriptTransformer({
                typescript, program: caseProgram
            }).transform({ code: caseSource, fileName: caseFile });

            assert.equal(caseCode, '', caseName);
            assert.equal(caseDiagnostics.some(({ kind = '', text = '' } = {}) => kind === 'UnsupportedDeclaration' && text.includes(reason)), true, caseName);
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-nullish-result-'));
    await writeFile(path.join(directory, 'package.json'), '{"type":"module"}\n');

    try {
        const fileName = path.join(directory, 'declared-results.ts');
        const source = [
            'interface Channel<T> { apply: (value: T) => T; zero: T; }',
            'export const unit: Channel<void> = { apply: () => undefined, zero: undefined };',
            'export const explicit = (): void => { return undefined; };',
            'export const maybe = (enabled: boolean): number | undefined => {',
            '    if (enabled) return 7;',
            '    return undefined;',
            '};',
            'export const nullable = (): string | null => null;',
            ''
        ].join('\n');

        await writeFile(fileName, source);
        const program = typescript.createProgram([fileName], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        });
        const facts = collectDeclaredNullishResultContracts({
            typescript,
            sourceFile: program.getSourceFile(fileName),
            checker: program.getTypeChecker()
        });

        assert.deepEqual([...facts.values()].map(({ result = '' } = {}) => result).toSorted(),
            ['undefined', 'undefined', 'undefined', 'undefined', 'null'].toSorted());
        const agreements = collectDestructuringAgreements({
            typescript,
            declaredNullishResultContracts: facts
        });

        const actions = [...agreements.values()].flat().map((entry = {}) => {
            const { action = '', owner = '' } = getDestructuringAgreement({ entry });

            assert.equal(owner, 'producer');

            return action;
        });
        assert.deepEqual(actions.toSorted(), [
            'normalize-empty-result',
            'normalize-empty-result',
            'normalize-created-absence-slot',
            'retain-declared-undefined-result',
            'retain-declared-null-result'
        ].toSorted());
        const generated = createTypeScriptTransformer({ typescript, program }).transform({
            code: source,
            fileName
        });

        assert.deepEqual(generated.diagnostics, []);
        assert.equal((generated.code.match(/resilient\/prefer-falsey-returns/g) || []).length, 2);
        assert.match(generated.code, /return undefined;/);
        assert.match(generated.code, /return null;/);
        assert.doesNotMatch(generated.code, /return false;|return \{\};|return \[\];/);
        const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
        const raw = new ESLint({ overrideConfigFile: true, overrideConfig: config });
        const fixed = new ESLint({ fix: true, overrideConfigFile: true, overrideConfig: config });
        const [rawResult = {}] = await raw.lintText(generated.code, { filePath: 'declared-results.js' });
        const [fixedResult = {}] = await fixed.lintText(generated.code, { filePath: 'declared-results.js' });

        [rawResult, fixedResult].forEach(({ errorCount = -1, messages = [] } = {}) => {
            // P-04: a declared union retains its authored returns; it does not
            // discharge the shared producer rule's number/undefined conflict.
            assert.equal(errorCount, 2, `${JSON.stringify(messages)}\n${generated.code}`);
            assert.deepEqual(messages.filter(({ severity = 0 } = {}) => severity === 2).map(({ ruleId = '', message = '' } = {}) => ({ ruleId, message })), [
                { ruleId: 'resilient/signature-contract-return-consistency',
                    message: 'This function returns number, but another return path produces undefined.' },
                { ruleId: 'resilient/signature-contract-return-consistency',
                    message: 'This function returns undefined, but another return path produces number.' }
            ]);
        });

        const rejectedFileName = path.join(directory, 'rejected.ts');
        await writeFile(rejectedFileName, [
            'export const inferred = () => undefined;',
            'export const wrong = (): number => undefined;',
            'export const unknown = (): any => undefined;',
            'export const shadowed = (undefined: number): void => undefined;',
            ''
        ].join('\n'));
        const rejectedProgram = typescript.createProgram([rejectedFileName], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        });
        assert.equal(collectDeclaredNullishResultContracts({
            typescript,
            sourceFile: rejectedProgram.getSourceFile(rejectedFileName),
            checker: rejectedProgram.getTypeChecker()
        }).size, 0);
        const { outputText: referenceCode = '' } = typescript.transpileModule(source, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const referenceFile = path.join(directory, 'reference.js');
        const generatedFile = path.join(directory, 'generated.js');

        await writeFile(referenceFile, referenceCode);
        await writeFile(generatedFile, generated.code);
        const reference = await import(pathToFileURL(referenceFile).href);
        const output = await import(pathToFileURL(generatedFile).href);

        assert.equal(output.unit.apply(), reference.unit.apply());
        assert.equal(output.unit.apply.length, reference.unit.apply.length);
        assert.deepEqual(Object.getOwnPropertyDescriptor(output.unit, 'zero'), Object.getOwnPropertyDescriptor(reference.unit, 'zero'));
        assert.equal(output.explicit(), reference.explicit());
        assert.equal(output.maybe(true), reference.maybe(true));
        assert.equal(output.maybe(false), reference.maybe(false));
        assert.equal(output.nullable(), reference.nullable());
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

{
    const failure = new Error('owned capability failure');
    const capture = (invoke) => {
        try {
            return { result: invoke() };
        } catch (error) {
            return { error };
        }
    };
    // eslint-disable-next-line resilient/no-null-assignment, resilient/no-undefined-assignment -- Optional capability controls require actual null and undefined inputs and results to preserve native callability and absence.
    const noncallables = Object.freeze([undefined, null, false, 0, '', Symbol('missing capability'), {}, []]);

    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Optional fixture capabilities and results include real undefined to test native behavior.
    const observeUnion = ({ value, throwGet = false, throwCall = false, callResult } = {}) => {
        let events = [];
        const candidate = Object.freeze({ get isUnion() {
            events = [...events, 'method-get'];

            if (throwGet) throw failure;

            // eslint-disable-next-line no-restricted-syntax -- The capability oracle verifies the candidate receiver and the method's own zero-argument call.
            return value === 'callable' ? function capability() {
                assert.equal(this, candidate);
                assert.equal(arguments.length, 0);
                events = [...events, 'method-call'];

                if (throwCall) throw failure;

                return callResult;
            } : value;
        } });
        const outcome = capture(() => isUnionType(candidate));

        return { ...outcome, events };
    };

    test('optional union capability preserves absence, receivers, results and failures', () => {
        noncallables.forEach(value => assert.deepEqual(observeUnion({ value }), { result: false, events: ['method-get'] }));
        // eslint-disable-next-line resilient/no-null-assignment, resilient/no-undefined-assignment -- Optional capability controls require actual null and undefined inputs and results to preserve native callability and absence.
        [undefined, null, false, 0, '', {}, []].forEach((callResult) => {
            const observation = observeUnion({ value: 'callable', callResult });
            const { events = [] } = observation;

            assert.equal(Reflect.get(observation, 'result'), callResult);
            assert.deepEqual(events, ['method-get', 'method-call']);
        });
        [{ throwGet: true }, { value: 'callable', throwCall: true }].forEach((options) => {
            const { error = false } = observeUnion(options);

            assert.equal(error, failure);
        });
        noncallables.forEach(value => assert.equal(isUnionType(value), false));
        // eslint-disable-next-line resilient/signature-contract-call-site -- Omitted input is the optional capability absence boundary under test.
        assert.equal(isUnionType(), false);
    });

    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Fixture capabilities and returned values preserve actual undefined, false and zero.
    const observeContract = ({ firstValue, secondValue = 'callable', throwGetAt = 0, throwCall = false, callResult,
        shape = 'single', rejected = false, cached = false } = {}) => {
        let events = [];
        let reads = 0;
        const part = Object.freeze({ flags: 0, get getCallSignatures() {
            reads += 1;
            events = [...events, `method-get:${reads}`];

            if (reads === throwGetAt) throw failure;

            const value = reads === 1 ? firstValue : secondValue;

            // eslint-disable-next-line no-restricted-syntax -- Signature acquisition must preserve the part receiver and the method's own arguments object.
            return value === 'callable' ? function signatures() {
                assert.equal(this, part);
                assert.equal(arguments.length, 0);
                events = [...events, 'method-call'];

                if (throwCall) throw failure;

                return callResult;
            } : value;
        } });
        const { TypeFlags: { Undefined: absentFlags = 0, String: stringFlags = 0, Unknown: unknownFlags = 0 } = {} } = typescript;
        const parts = {
            single: [part], empty: [], many: [part, part],
            absent: [{ flags: absentFlags }], primitive: [{ flags: stringFlags }],
            unknown: [{ flags: unknownFlags }]
        };
        const { [shape]: selectedParts = [] } = parts;
        const type = Object.freeze({ isUnion: () => true, types: selectedParts });
        const inputNode = rejected ? typescript.factory.createNumericLiteral(1) : typescript.factory.createIdentifier('capability');
        const checker = Object.freeze({ getTypeAtLocation(node) {
            assert.equal(this, checker);
            assert.equal(node, inputNode);
            events = [...events, 'type-call'];

            return type;
        } });
        const outcome = capture(() => getCheckerContract({
            typescript, node: inputNode, checker: cached ? {} : checker,
            declarations: cached ? { __checker: checker } : {}, typeText: 'original annotation'
        }));

        return { ...outcome, events };
    };

    test('optional checker call signatures retain semantic states and native failures', () => {
        noncallables.forEach(firstValue => assert.deepEqual(observeContract({ firstValue }), {
            result: {}, events: ['type-call', 'method-get:1']
        }));
        [false, true].forEach((cached) => {
            const { result: { kind = '', optional = true } = {}, events = [] } = observeContract({ firstValue: 'callable', callResult: [{}], cached });

            assert.equal(kind, 'function');
            assert.equal(optional, false);
            assert.deepEqual(events, ['type-call', 'method-get:1', 'method-get:2', 'method-call']);
        });
        ['empty', 'absent'].forEach(shape => assert.deepEqual(observeContract({ shape }), { result: {}, events: ['type-call'] }));
        const { result: { kind: primitiveKind = '' } = {} } = observeContract({ shape: 'primitive' });
        const { result: { kind: unknownKind = '' } = {} } = observeContract({ shape: 'unknown' });

        assert.equal(primitiveKind, 'string');
        assert.equal(unknownKind, 'required');
        assert.deepEqual(observeContract({ firstValue: 'callable', shape: 'many' }).events, ['type-call', 'method-get:1']);
        assert.deepEqual(observeContract({ firstValue: 'callable', rejected: true }).events, []);
        [{ throwGetAt: 1 }, { firstValue: 'callable', throwGetAt: 2 }, { firstValue: 'callable', throwCall: true }].forEach((options) => {
            const { error = false } = observeContract(options);

            assert.equal(error, failure);
        });
        // eslint-disable-next-line resilient/no-null-assignment, resilient/no-undefined-assignment -- Optional capability controls require actual null and undefined inputs and results to preserve native callability and absence.
        [null, undefined].forEach((callResult) => {
            const { error = false } = observeContract({ firstValue: 'callable', callResult });

            assert.ok(error instanceof TypeError);
        });
        // eslint-disable-next-line resilient/signature-contract-call-site -- The second method read deliberately returns a non-callable to verify its native failure.
        [false].forEach((secondValue) => {
            const { error = false } = observeContract({ firstValue: 'callable', secondValue });

            assert.ok(error instanceof TypeError);
        });
        assert.deepEqual(getCheckerContract({ typescript }), {});
    });

    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Fixture compiler capabilities and returned values retain native absence without replacement nodes.
    const observeTypeNode = ({ firstValue, secondValue = 'callable', throwGetAt = 0, throwCall = false, throwType = false, callResult,
        rejected = false, sameKind = false, cached = false, missingChecker = false, importShape = false } = {}) => {
        let events = [];
        let reads = 0;
        const admittedNode = importShape ? Object.freeze({ kind: typescript.SyntaxKind.ImportType })
            : typescript.factory.createIndexedAccessTypeNode(
                typescript.factory.createTypeReferenceNode('Box'), typescript.factory.createKeywordTypeNode(typescript.SyntaxKind.StringKeyword)
            );
        const inputNode = rejected ? typescript.factory.createIdentifier('notIndexed') : admittedNode;
        const { kind: inputKind = 0 } = inputNode;
        const returned = Object.freeze({ kind: sameKind ? inputKind : typescript.SyntaxKind.StringKeyword });
        const type = Object.freeze({ token: 'original Type' });
        const checker = Object.freeze({
            // eslint-disable-next-line no-restricted-syntax -- The callable checker alternative must observe the checker receiver when resolving the original node.
            getTypeAtLocation: missingChecker ? false : function readType(node) {
                assert.equal(this, checker);
                assert.equal(node, inputNode);
                events = [...events, 'type-call'];

                if (throwType) throw failure;

                return type;
            },
            get typeToTypeNode() {
                reads += 1;
                events = [...events, `method-get:${reads}`];

                if (reads === throwGetAt) throw failure;

                const value = reads === 1 ? firstValue : secondValue;

                // eslint-disable-next-line no-restricted-syntax -- Type-node conversion must invoke the retained checker method with its original checker receiver.
                return value === 'callable' ? function convertAtReceiver(receivedType, receivedNode, flags) {
                    assert.equal(this, checker);
                    assert.equal(receivedType, type);
                    assert.equal(receivedNode, inputNode);
                    assert.equal(flags, typescript.NodeBuilderFlags.NoTruncation);
                    events = [...events, 'method-call'];

                    if (throwCall) throw failure;

                    return callResult === 'node' ? returned : callResult;
                } : value;
            }
        });
        const outcome = capture(() => getCheckerTypeNode({
            typescript, node: inputNode, checker: cached ? {} : checker,
            declarations: cached || missingChecker ? { __checker: checker } : {}
        }));
        const { result = false } = outcome;

        if (callResult === 'node' && !sameKind && result) assert.equal(result, returned);

        return { ...outcome, events };
    };

    test('optional checker conversion preserves node identity, call ownership and missing evidence', () => {
        noncallables.forEach(firstValue => assert.deepEqual(observeTypeNode({ firstValue }), { result: {}, events: ['method-get:1'] }));
        [{}, { cached: true }, { importShape: true }].forEach((options) => {
            const { result: { kind = 0 } = {}, events = [] } = observeTypeNode({ firstValue: 'callable', callResult: 'node', ...options });

            assert.equal(kind, typescript.SyntaxKind.StringKeyword);
            assert.deepEqual(events, ['method-get:1', 'type-call', 'method-get:2', 'method-call']);
        });
        // eslint-disable-next-line resilient/no-null-assignment, resilient/no-undefined-assignment -- Optional capability controls require actual null and undefined inputs and results to preserve native callability and absence.
        [null, undefined].forEach(callResult => assert.deepEqual(observeTypeNode({ firstValue: 'callable', callResult }), {
            result: {}, events: ['method-get:1', 'type-call', 'method-get:2', 'method-call']
        }));
        assert.deepEqual(Reflect.get(observeTypeNode({ firstValue: 'callable', callResult: 'node', sameKind: true }), 'result'), {});
        [{ rejected: true }, { missingChecker: true }].forEach((options) => {
            assert.deepEqual(observeTypeNode({ firstValue: 'callable', ...options }), { result: {}, events: ['method-get:1'] });
        });
        [{ throwGetAt: 1 }, { rejected: true, throwGetAt: 1 }, { firstValue: 'callable', throwGetAt: 2 },
            { firstValue: 'callable', throwCall: true }, { firstValue: 'callable', throwType: true }].forEach((options) => {
            const { error = false } = observeTypeNode(options);

            assert.equal(error, failure);
        });
        // eslint-disable-next-line resilient/signature-contract-call-site -- The second method read deliberately returns a non-callable to verify its native failure.
        [false].forEach((secondValue) => {
            const { error = false } = observeTypeNode({ firstValue: 'callable', secondValue });

            assert.ok(error instanceof TypeError);
        });
        assert.deepEqual(getCheckerTypeNode({ typescript }), {});
    });

    test('real compiler type conversion and signatures use the same capability owners', () => {
        const fileName = 'optional-capability.ts';
        const sourceFile = typescript.createSourceFile(fileName, [
            'type Box = { value: string };',
            'type Read = Box["value"];',
            'declare const value: string | number;',
            'declare const callable: (input: number) => string;',
            'declare const opaque: unknown;'
        ].join('\n'), typescript.ScriptTarget.ESNext, true);
        const compilerHost = typescript.createCompilerHost({ noLib: true });
        const program = typescript.createProgram([fileName], { noLib: true, strict: true }, {
            ...compilerHost,
            getSourceFile: (name, languageVersion) => name === fileName ? sourceFile : compilerHost.getSourceFile(name, languageVersion)
        });
        const checker = program.getTypeChecker();
        const { statements: [, alias = {}, ...declarations] = [] } = sourceFile;
        const { type: indexed = {} } = alias;
        const printer = typescript.createPrinter();
        const converted = getCheckerTypeNode({ typescript, checker, node: indexed });
        const { kind: convertedKind = 0 } = converted;
        assert.equal(convertedKind, typescript.SyntaxKind.StringKeyword);
        assert.equal(printer.printNode(typescript.EmitHint.Unspecified, converted, sourceFile), 'string');
        const convertedCached = getCheckerTypeNode({ typescript, declarations: { __checker: checker }, node: indexed });
        assert.equal(printer.printNode(typescript.EmitHint.Unspecified, convertedCached, sourceFile), 'string');
        declarations.forEach(({ declarationList: { declarations: [{ name = {} } = {}] = [] } = {} } = {}, index = 0) => {
            const evidence = getCheckerContract({ typescript, checker, node: name });
            const { kind = '' } = evidence;
            assert.equal(kind, ['', 'function', 'required'][index]);
            assert.equal(isUnionType(checker.getTypeAtLocation(name)), index === 0);
            assert.deepEqual(getCheckerContract({ typescript, declarations: { __checker: checker }, node: name }), evidence);
            assert.deepEqual(evidence, getCheckerContract({ typescript, checker, node: name }));
        });
    });
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-ordered-decision-'));
    const fileName = path.join(directory, 'decision.ts');
    const source = [
        'export const choose = (test: () => boolean, first: () => number,',
        '    second: () => boolean, last: () => number) => {',
        '    if (test()) { return first(); } else if (second()) { return last(); }',
        '    return -1;',
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
        assert.doesNotMatch(code, /\belse\b/);
        assert.match(code, /if \(test\(\)\)/);
        assert.match(code, /if \(second\(\)\)/);

        const eslintConfig = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
        const [raw = {}] = await new ESLint({ overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(code, { filePath: 'decision-generated.js' });
        const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(code, { filePath: 'decision-generated.js' });

        assert.equal(raw.messages.filter(({ ruleId = '' } = {}) => ruleId === 'resilient/no-else').length, 0);
        assert.equal(fixed.messages.filter(({ ruleId = '' } = {}) => ruleId === 'resilient/no-else').length, 0);
        assert.equal(raw.messages.filter(({ ruleId = '' } = {}) => (
            ruleId !== 'padding-line-between-statements'
        )).filter(({ severity = 0 } = {}) => severity === 2).length, 0, JSON.stringify(raw.messages));
        assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));

        const { outputText: sourceJavaScript = '' } = typescript.transpileModule(source, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const importCode = async text => import(`data:text/javascript,${encodeURIComponent(text)}`);
        const sourceModule = await importCode(sourceJavaScript);
        const generatedModule = await importCode(code);
        const observe = (module, firstValue, secondValue) => {
            let trace = '';
            const callbacks = [
                () => {
                    trace += 't';

                    return firstValue;
                },
                () => {
                    trace += 'f';

                    return 0;
                },
                () => {
                    trace += 's';

                    return secondValue;
                },
                () => {
                    trace += 'l';

                    return 2;
                }
            ];

            return { result: module.choose(...callbacks), trace };
        };

        [[true, true], [false, true], [false, false]].forEach((pair) => {
            assert.deepEqual(observe(generatedModule, ...pair), observe(sourceModule, ...pair));
        });

        const rejectedFile = path.join(directory, 'nonterminal.ts');
        const rejectedSource = 'export const f = (b: boolean) => { let x = 0; if (b) { x = 1; } else if (!b) { x = 2; } return x; };';

        await writeFile(rejectedFile, rejectedSource);
        const rejectedProgram = typescript.createProgram([rejectedFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext
        });

        assert.equal(collectOrderedDecisionContracts({
            typescript, sourceFile: rejectedProgram.getSourceFile(rejectedFile),
            checker: rejectedProgram.getTypeChecker()
        }).size, 0);

        const nestedFile = path.join(directory, 'nested.ts');
        const nestedSource = [
            'export const visit = (value: string, isSkip: (v: string) => boolean,',
            '    isWork: (v: string) => boolean, effect: () => void) => {',
            '    if (isSkip(value)) return 0;',
            '    if (isWork(value)) {',
            '        effect();',
            '        return isWork(value) ? 1 : 2;',
            '    }',
            '    effect();',
            '    return 3;',
            '};',
            'export const selected = (value: { category: string, inbound: number, outbound: number }) =>',
            '    value.category === "Inbound"',
            '        ? value.category === "Combined" ? value.inbound : value.outbound',
            '        : value.category === "Outbound" ? value.outbound : value.inbound;',
            ''
        ].join('\n');

        await writeFile(nestedFile, nestedSource);
        const nestedProgram = typescript.createProgram([nestedFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const nestedContracts = collectOrderedDecisionContracts({
            typescript, sourceFile: nestedProgram.getSourceFile(nestedFile),
            checker: nestedProgram.getTypeChecker()
        });
        const nestedActions = [...nestedContracts.values()].map(({ action = '' } = {}) => action);

        assert.ok(nestedActions.includes('flatten-terminated-nested-decision'));
        assert.ok(nestedActions.includes('retain-ordered-decision'));

        const { code: nestedCode = '', diagnostics: nestedDiagnostics = [] } = createTypeScriptTransformer({
            typescript, program: nestedProgram
        }).transform({ code: nestedSource, fileName: nestedFile });

        assert.deepEqual(nestedDiagnostics, []);
        assert.match(nestedCode, /if \(!\(isWork\(value\)\)\)/);
        assert.doesNotMatch(nestedCode, /Nested decision and repeated Get retain branch and getter timing/);
        assert.match(nestedCode, /prefer-destructured-member-access -- repeated parameter Get: count, order, phase/);
        assert.match(nestedCode, /value\.category === "Combined" \? value\.inbound : value\.outbound/);

        const [nestedRaw = {}] = await new ESLint({ overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(nestedCode, { filePath: 'nested-generated.js' });
        const [nestedFixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(nestedCode, { filePath: 'nested-generated.js' });

        assert.equal(nestedRaw.messages.filter(({ ruleId = '' } = {}) => (
            ['resilient/no-else', 'resilient/no-nested-if'].includes(ruleId)
        )).length, 0, JSON.stringify({ messages: nestedRaw.messages, code: nestedCode }));
        assert.equal(nestedFixed.messages.filter(({ ruleId = '' } = {}) => (
            ['resilient/no-else', 'resilient/no-nested-if'].includes(ruleId)
        )).length, 0, JSON.stringify({ messages: nestedFixed.messages, code: nestedCode }));
        assert.equal(nestedRaw.messages.filter(({ ruleId = '' } = {}) => (
            ruleId !== 'padding-line-between-statements'
        )).filter(({ severity = 0 } = {}) => severity === 2).length, 0, JSON.stringify(nestedRaw.messages));
        assert.equal(nestedFixed.errorCount, 0, JSON.stringify(nestedFixed.messages));

        const { outputText: nestedJavaScript = '' } = typescript.transpileModule(nestedSource, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const nestedSourceModule = await importCode(nestedJavaScript);
        const nestedGeneratedModule = await importCode(nestedCode);
        const nestedFixedModule = await importCode(nestedFixed.output || nestedCode);
        const observeNested = (module, tag, operation) => {
            let trace = '';
            const input = new Proxy({ category: tag, inbound: 0, outbound: 2 }, {
                get(target, key) {
                    trace += String(key);

                    return Reflect.get(target, key);
                }
            });
            const result = operation === 'visit'
                ? module.visit(tag,
                    (value) => {
                        trace += 'skip';

                        return value === 'Skip';
                    },
                    (value) => {
                        trace += 'work';

                        return value === 'Work';
                    },
                    () => { trace += 'effect'; })
                : module.selected(input);

            return { result, trace };
        };

        ['Skip', 'Work', 'Other'].forEach((tag) => {
            assert.deepEqual(observeNested(nestedGeneratedModule, tag, 'visit'),
                observeNested(nestedSourceModule, tag, 'visit'));
            assert.deepEqual(observeNested(nestedFixedModule, tag, 'visit'),
                observeNested(nestedSourceModule, tag, 'visit'));
        });
        ['Inbound', 'Outbound', 'Combined', 'Other'].forEach((tag) => {
            assert.deepEqual(observeNested(nestedGeneratedModule, tag, 'selected'),
                observeNested(nestedSourceModule, tag, 'selected'));
            assert.deepEqual(observeNested(nestedFixedModule, tag, 'selected'),
                observeNested(nestedSourceModule, tag, 'selected'));
        });

        const phaseFile = path.join(directory, 'evaluation-order.ts');
        const phaseSource = [
            'let events = "";',
            'const mark = (value: string) => (events += value, value);',
            'const first = (mark("first"), () => later);',
            'const second = mark("second");',
            'const later = mark("later");',
            'export const observation = { events, result: first(), second };',
            'let getterEvents = "";',
            'const fail = (): never => { throw new Error("failure"); };',
            'const record = { get value(): string { return (getterEvents += "getter", fail()); } };',
            'const beforeGetter = (getterEvents += "before", () => getterLater);',
            'const caught = (() => {',
            '    try { return record.value; } catch (error) { getterEvents += String(error); return "caught"; }',
            '})();',
            'const getterLater = (getterEvents += "later", "later");',
            'export const getterObservation = { events: getterEvents, result: beforeGetter(), caught };',
            'let shadowEvents = "";',
            'const shadowFirst = (shadowEvents += "first", () => outerLater);',
            'const local = (() => {',
            '    const outerLater = (shadowEvents += "inner", "inner");',
            '    return outerLater;',
            '})();',
            'const outerLater = (shadowEvents += "outer", "outer");',
            'export const shadowObservation = { events: shadowEvents, result: shadowFirst(), local };',
            ''
        ].join('\n');

        await writeFile(phaseFile, phaseSource);
        const phaseProgram = typescript.createProgram([phaseFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const phaseSourceFile = phaseProgram.getSourceFile(phaseFile);
        const phaseChecker = phaseProgram.getTypeChecker();
        const { statements: phaseStatements = [] } = phaseSourceFile;
        const phaseNames = new Set(phaseStatements.flatMap(statement => getRuntimeBindingNames({
            typescript,
            node: statement
        })));
        const phaseIdentities = getRuntimeBindingIdentities({
            typescript,
            statements: phaseStatements,
            checker: phaseChecker
        });
        const firstStatement = phaseStatements.find(statement => statement.getText(phaseSourceFile).startsWith('const first'));
        const localStatement = phaseStatements.find(statement => statement.getText(phaseSourceFile).startsWith('const local'));

        assert.deepEqual([...getRuntimeBindingDependencies({
            typescript,
            node: firstStatement,
            names: phaseNames,
            checker: phaseChecker,
            bindingIdentities: phaseIdentities,
            eagerOnly: true
        })], ['mark']);
        assert.deepEqual([...getRuntimeBindingDependencies({
            typescript,
            node: firstStatement,
            names: phaseNames,
            checker: phaseChecker,
            bindingIdentities: phaseIdentities
        })].toSorted(), ['later', 'mark']);
        assert.equal(getRuntimeBindingDependencies({
            typescript,
            node: localStatement,
            names: phaseNames,
            checker: phaseChecker,
            bindingIdentities: phaseIdentities
        }).has('outerLater'), false);

        const { code: phaseCode = '', diagnostics: phaseDiagnostics = [] } = createTypeScriptTransformer({
            typescript, program: phaseProgram
        }).transform({ code: phaseSource, fileName: phaseFile });

        assert.deepEqual(phaseDiagnostics, []);
        assert.ok(phaseCode.indexOf('const first =') < phaseCode.indexOf('const second ='));
        assert.ok(phaseCode.indexOf('const second =') < phaseCode.indexOf('const later ='));
        assert.ok(phaseCode.indexOf('const beforeGetter =') < phaseCode.indexOf('const caught ='));
        assert.ok(phaseCode.indexOf('const caught =') < phaseCode.indexOf('const getterLater ='));
        assert.ok(phaseCode.indexOf('const shadowFirst =') < phaseCode.indexOf('const local ='));
        assert.ok(phaseCode.indexOf('const local =') < phaseCode.indexOf('const outerLater ='));

        const [phaseRaw = {}] = await new ESLint({ overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(phaseCode, { filePath: 'evaluation-order-generated.js' });
        const [phaseFixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(phaseCode, { filePath: 'evaluation-order-generated.js' });

        assert.equal(phaseRaw.errorCount, 0, JSON.stringify({ messages: phaseRaw.messages, code: phaseCode }));
        assert.equal(phaseFixed.errorCount, 0, JSON.stringify(phaseFixed.messages));

        const { outputText: phaseJavaScript = '' } = typescript.transpileModule(phaseSource, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const phaseSourceModule = await importCode(phaseJavaScript);
        const phaseGeneratedModule = await importCode(phaseCode);
        const phaseFixedModule = await importCode(phaseFixed.output || phaseCode);
        const expectedPhase = {
            observation: { events: 'firstsecondlater', result: 'later', second: 'second' },
            getterObservation: {
                events: 'beforegetterError: failurelater', result: 'later', caught: 'caught'
            },
            shadowObservation: { events: 'firstinnerouter', result: 'outer', local: 'inner' }
        };
        const observePhases = ({ observation: observed = {}, getterObservation: getter = {},
            shadowObservation: shadow = {} } = {}) => ({
            observation: observed,
            getterObservation: getter,
            shadowObservation: shadow
        });

        assert.deepEqual(observePhases(phaseSourceModule), expectedPhase);
        assert.deepEqual(observePhases(phaseGeneratedModule), expectedPhase);
        assert.deepEqual(observePhases(phaseFixedModule), expectedPhase);

        const tdzFile = path.join(directory, 'evaluation-order-tdz.ts');
        const tdzSource = [
            'export const result = factory();',
            'const factory = () => true;',
            ''
        ].join('\n');

        await writeFile(tdzFile, tdzSource);
        const tdzProgram = typescript.createProgram([tdzFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const { code: tdzCode = '', diagnostics: tdzDiagnostics = [] } = createTypeScriptTransformer({
            typescript, program: tdzProgram
        }).transform({ code: tdzSource, fileName: tdzFile });

        assert.deepEqual(tdzDiagnostics, []);
        assert.ok(tdzCode.indexOf('const result =') < tdzCode.indexOf('const factory ='));
        const { outputText: tdzJavaScript = '' } = typescript.transpileModule(tdzSource, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const getImportFailure = async (text) => {
            try {
                await importCode(text);
            } catch (error) {
                return error.name;
            }

            return '';
        };

        assert.equal(await getImportFailure(tdzJavaScript), 'ReferenceError');
        assert.equal(await getImportFailure(tdzCode), 'ReferenceError');

        const overloadFile = path.join(directory, 'evaluation-order-overload.ts');
        const overloadSource = [
            'export function call(value: number): number;',
            'export function call(value: number, next?: Function): number;',
            'export function call(value: number, next?: Function): number {',
            '    switch (arguments.length) {',
            '        case 1: return value;',
            '        case 2: return next!(value);',
            '    }',
            '    return value;',
            '}',
            'export const observedLength = call.length;',
            ''
        ].join('\n');

        await writeFile(overloadFile, overloadSource);
        const overloadProgram = typescript.createProgram([overloadFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const { code: overloadCode = '', diagnostics: overloadDiagnostics = [] } = createTypeScriptTransformer({
            typescript, program: overloadProgram
        }).transform({ code: overloadSource, fileName: overloadFile });

        assert.deepEqual(overloadDiagnostics, []);
        assert.match(overloadCode, /function call\(value, next\)/u);
        assert.doesNotMatch(overloadCode, /Object\.defineProperty\(call/u);
        const overloadModule = await importCode(overloadCode);

        assert.equal(overloadModule.observedLength, 2);
        assert.equal(overloadModule.call(2, value => value + 1), 3);

        const getStatements = (count = 0) => {
            const { statements = [] } = typescript.createSourceFile('ordered.ts', Array.from({ length: count }, (_, index) => (
                `const entry${index} = () => ${index + 1 < count ? `entry${index + 1}()` : '0'};`
            )).join('\n'), typescript.ScriptTarget.ESNext, true);

            return statements;
        };
        [4000, 8000, 12000].forEach((count) => {
            const statements = getStatements(count);
            const runtimeOrdered = orderRuntimeBindingStatements({ typescript, statements });

            const { 0: sourceFirst = {}, [count - 1]: sourceLast = {} } = statements;
            const { 0: runtimeFirst = {}, [count - 1]: runtimeLast = {} } = runtimeOrdered;

            assert.equal(runtimeFirst, sourceLast);
            assert.equal(runtimeLast, sourceFirst);
        });
        const { statements: queueStatements = [] } = typescript.createSourceFile('ordered-queue.ts', [
            'const first = () => gate();',
            'void 0;',
            'const second = () => 0;',
            'const third = () => gate() + second() + gate();',
            'const gate = () => 0;',
            'const tail = () => 0;',
            'const cyclicFirst = () => cyclicSecond();',
            'const cyclicSecond = () => cyclicFirst();'
        ].join('\n'), typescript.ScriptTarget.ESNext, true);
        const queueOrdered = orderRuntimeBindingStatements({ typescript, statements: queueStatements });

        assert.equal(queueOrdered.length, queueStatements.length);
        [2, 1, 4, 0, 3, 5, 6, 7].forEach((sourceIndex, orderedIndex) => {
            assert.equal(queueOrdered[orderedIndex], queueStatements[sourceIndex]);
        });
        const { statements: generatedStatements = [] } = typescript.createSourceFile('generated-cycles.ts', [
            'const first = () => second();',
            'const second = () => first();',
            'const repeated = () => third() + third();',
            'const third = () => 0;'
        ].join('\n'), typescript.ScriptTarget.ESNext, true);
        const placedGenerated = placeGeneratedRuntimeStatements({
            typescript,
            generatedStatements
        });

        assert.equal(placedGenerated.length, generatedStatements.length);
        [3, 2, 0, 1].forEach((sourceIndex, placementIndex) => {
            assert.equal(placedGenerated[placementIndex], generatedStatements[sourceIndex]);
        });
        assert.deepEqual([...getCyclicRuntimeBindingNames({
            typescript,
            statements: generatedStatements
        })], ['first', 'second']);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

{
    const cases = [
        {
            name: 'provider-direct',
            code: 'export function forward(P: { call: (value: number) => number }) { return { call: P.call }; }',
            provider: 1
        },
        {
            name: 'provider-optional-read',
            code: 'export function forward(P: { call: (value: number) => number }) { return { call: P?.call }; }'
        },
        {
            name: 'projection-direct',
            code: 'export const project = (items: Array<{ value: number }>) => items.map(item => item.value);',
            projection: 1
        },
        {
            name: 'projection-missing-field-type',
            code: 'export const project = (items: Array<{ value?: number }>) => items.map(item => item.value);'
        },
        {
            name: 'projection-optional-field',
            code: 'export const project = (items: Array<{ value: number }>) => items.map(item => item?.value);'
        },
        {
            name: 'projection-optional-nested',
            code: 'export const project = (items: Array<{ value: { next: number } }>) => items.map(item => item?.value.next);'
        },
        {
            name: 'projection-optional-receiver',
            code: 'export const project = (items: Array<{ value: number }>) => items?.map(item => item.value);'
        },
        {
            name: 'projection-optional-call',
            code: 'export const project = (items: Array<{ value: number }>) => items.map?.(item => item.value);'
        }
    ];
    const sources = new Map(cases.map(({ name = '', code = '' } = {}) => [
        `${name}.ts`,
        typescript.createSourceFile(`${name}.ts`, code, typescript.ScriptTarget.ESNext, true)
    ]));
    const options = { strict: true, target: typescript.ScriptTarget.ESNext };
    const host = typescript.createCompilerHost(options);
    const program = typescript.createProgram([...sources.keys()], options, {
        ...host,
        getSourceFile: (name, version) => sources.get(name) || host.getSourceFile(name, version)
    });
    const checker = program.getTypeChecker();
    const execute = async (code = '') => {
        const { outputText = '' } = typescript.transpileModule(code, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });

        return loadModule(outputText);
    };

    await Promise.all(cases.map(async ({ name = '', code = '', provider = 0, projection = 0 } = {}) => {
        const fileName = `${name}.ts`;
        const sourceFile = sources.get(fileName);
        const providerFacts = collectProviderForwardContracts({ typescript, sourceFile, checker });
        const projectionFacts = collectExactProjectionContracts({ typescript, sourceFile, checker });
        const { transform = false } = createTypeScriptTransformer({ typescript, program });
        const { diagnostics = [], agreements = [], code: output = '' } = transform({ code, fileName });

        assert.equal(providerFacts.size, provider, `${name}: provider source admission`);
        assert.equal(projectionFacts.size, projection, `${name}: projection source admission`);
        assert.deepEqual(diagnostics, [], name);
        assert.equal(agreements.filter(({ action = '' } = {}) => action === 'provider-forwarded').length,
            provider, `${name}: provider report placement`);
        assert.equal(agreements.filter(({ action = '' } = {}) => action === 'exact-callback-projected').length,
            projection, `${name}: projection report placement`);

        if (name.includes('optional') && !name.includes('optional-call') && !name.includes('optional-receiver')) {
            assert.match(output, /\?\./u, `${name}: optional evaluation stays at source`);
        }

        const sourceRuntime = await execute(code);
        const targetRuntime = await execute(output);
        const observe = ({ forward, project } = {}) => {
            let events = [];
            const failure = new Error('field failure');
            const callable = value => value;
            const provider = name.startsWith('provider');

            if (provider && typeof forward !== 'function') throw new TypeError('Expected the compiled provider');

            if (provider) {
                const providerInput = { get call() {
                    events = [...events, 'call'];

                    return callable;
                } };
                const { call: presentCall = false } = forward(providerInput);
                const present = presentCall === callable;
                // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults, resilient/signature-contract-destructuring -- The fixture deliberately reads a missing call field to compare native absence.
                const { call: absent } = name.includes('optional') ? forward(null) : {};

                return { present, absent, events };
            }

            if (typeof project !== 'function') throw new TypeError('Expected the compiled projection');

            const observedValue = name === 'projection-optional-nested' ? { next: 7 } : 7;
            const value = { get value() {
                events = [...events, 'value'];

                return observedValue;
            } };
            const ordinary = Array.from(project([value]));
            const getOptional = () => {
                if (['projection-optional-field', 'projection-optional-nested'].includes(name)) {
                    // eslint-disable-next-line resilient/no-null-assignment, resilient/signature-contract-return-consistency -- Preserve the native null tuple and the oracle's array/false results when comparing lowered JavaScript.
                    return Array.from(project([null, value]));
                }

                if (name === 'projection-optional-receiver') return project(null);

                // eslint-disable-next-line resilient/no-undefined-assignment -- This native absent tuple input must retain its receiver failure after lowering.
                if (name === 'projection-optional-call') return project({ map: undefined });

                // eslint-disable-next-line resilient/signature-contract-return-consistency -- This oracle retains false for inapplicable projection cases beside the selected array results.
                return false;
            };
            const optional = name === 'projection-missing-field-type'
                // eslint-disable-next-line resilient/no-undefined-assignment -- This native absent tuple input must retain its receiver failure after lowering.
                ? Array.from(project([{}, { value: undefined }, value]))
                : getOptional();
            let abrupt = false;

            if (['projection-optional-field', 'projection-missing-field-type'].includes(name)) {
                try {
                    project([{ get value() {
                        events = [...events, 'throw'];

                        throw failure;
                    } }]);
                } catch (error) {
                    abrupt = error === failure;
                }
            }

            let missingReceiverFailure = false;

            if (name === 'projection-missing-field-type') {
                try {
                    // eslint-disable-next-line resilient/no-undefined-assignment -- This native absent tuple input must retain its receiver failure after lowering.
                    project([undefined]);
                } catch (error) {
                    missingReceiverFailure = error.name === 'TypeError';
                }
            }

            return { ordinary, optional, abrupt, missingReceiverFailure, events };
        };

        assert.deepEqual(observe(targetRuntime), observe(sourceRuntime), `${name}: source/target result and Get trace`);
    }));
}

{
    const nodesOfKind = nodesOfKindShared;
    const cases = [
        { name: 'identity', code: 'function read(P: { compact: (value: number) => number }) { return P.compact; }', count: 1 },
        { name: 'consumer', code: 'function read(P: { compact: (value: number) => number }, F: { map: (f: unknown) => unknown }) { return F.map(P.compact); }', count: 1 },
        { name: 'identifier-consumer', code: 'declare function accept(value: unknown): unknown; function read(P: { compact: () => number }) { return accept(P.compact); }', count: 1 },
        { name: 'aliased-consumer', code: 'declare function accept(value: unknown): unknown; const alias = accept; function read(P: { compact: () => number }) { return alias(P.compact); }',
            count: 1 },
        { name: 'parameter-consumer', code: 'function read(P: { compact: () => number }, accept: (value: unknown) => unknown) { return accept(P.compact); }', count: 1 },
        { name: 'arrow-identity', code: 'function read(P: { compact: () => number }) { return () => P.compact; }', count: 1 },
        { name: 'arrow-generic-identity', code: 'function read<T>(P: { value: T }) { return () => P.value; }', count: 1 },
        { name: 'shadowed-return-absence', code: 'function read(P: { compact: () => number }, undefined: number) { return P.compact; }' },
        { name: 'shadowed-arrow-absence', code: 'function read(P: { compact: () => number }, undefined: number) { return () => P.compact; }' },
        { name: 'optional-consumer', code: 'declare function accept(value: unknown): unknown; function read(P: { compact?: () => number }) { return accept(P.compact); }' },
        { name: 'unknown-consumer-field', code: 'declare function accept(value: unknown): unknown; function read(P: { compact: unknown }) { return accept(P.compact); }' },
        { name: 'any-consumer-field', code: 'declare function accept(value: unknown): unknown; function read(P: { compact: any }) { return accept(P.compact); }' },
        { name: 'computed-consumer', code: 'declare const F: { accept: (value: unknown) => unknown }; function read(P: { compact: () => number }) { return F["accept"](P.compact); }' },
        { name: 'shadowed-consumer-absence', code: 'declare function accept(value: unknown): unknown; function read(P: { compact: () => number }, undefined: number) { return accept(P.compact); }' },
        { name: 'factory', code: 'function read(make: () => { compact: (value: number) => number }) { const { compact } = make(); return { compact }; }', count: 1 },
        { name: 'selected', code: 'function read(M: { baseValue: string }, selected: boolean) { return selected ? M.baseValue : "value"; }', count: 1 },
        { name: 'renamed', code: 'function read(provider: { baseValue: string }, selected: boolean) { return selected ? provider.baseValue : "value"; }', count: 1 },
        { name: 'shadow',
            code: 'function read(M: { baseValue: string }, selected: boolean) { const other = (M: { baseValue: number }) => M.baseValue; return selected ? M.baseValue : "value"; }', count: 1 },
        { name: 'optional', code: 'function read(P: { compact?: (value: number) => number }) { return P.compact; }' },
        { name: 'optional-syntax', code: 'function read(P: { compact: (value: number) => number }) { return P?.compact; }' },
        { name: 'invoked', code: 'function read(P: { compact: (value: number) => number }) { return P.compact(1); }' },
        { name: 'wrong-result', code: 'function read(M: { baseValue: string }, selected: boolean) { return selected ? M.baseValue : 1; }' },
        { name: 'computed', code: 'function read(P: { compact: (value: number) => number }) { return P["compact"]; }' },
        { name: 'generic-return', code: 'function read<T>(P: { value: T }) { return P.value; }', count: 1 },
        { name: 'generic-constructor', code: 'const wrap = <T>(value: T) => ({ value }); function read<T>(P: { value: T }) { return wrap(P.value); }', count: 1 },
        { name: 'known-value-not-generic', code: 'function read(P: { value: number }) { return P.value; }' },
        { name: 'generic-optional', code: 'function read<T>(P: { value?: T }) { return P.value; }' },
        { name: 'any-value', code: 'function read(P: { value: any }) { return P.value; }' },
        { name: 'unknown-value', code: 'function read(P: { value: unknown }) { return P.value; }' },
        { name: 'generic-computed', code: 'function read<T>(P: { value: T }) { return P["value"]; }' },
        { name: 'deferred-owned', code: 'function read<T>(P: { value: T }, wrap: (value: T) => T) { return () => wrap(P.value); }' },
        { name: 'variant-owned', code: 'function read<T>(P: { tag: "inbound"; value: T } | { tag: "outbound"; value: T }) { return P.value; }' },
        { name: 'shadowed-absence', code: 'function read<T>(P: { value: T }, undefined: number) { return P.value; }' },
        { name: 'selected-generic', code: [
            'const isSelected = (input: { tag: boolean }) => input.tag;',
            'function read<T>(P: { baseValue: T }, wrap: () => T, input: { tag: boolean }) { return isSelected(input) ? P.baseValue : wrap(); }'
        ].join('\n'), count: 1 },
        { name: 'selected-optional-syntax', code: 'function read(M: { baseValue: string }, selected: boolean) { return selected ? M?.baseValue : "value"; }' },
        { name: 'contextual-curried-generic', code: [
            'const isSelected = (input: { tag: boolean }) => input.tag;',
            'const read: <T>(P: { baseValue: T }) => (wrap: () => T) => (input: { tag: boolean }) => T =',
            'P => wrap => input => isSelected(input) ? P.baseValue : wrap();'
        ].join('\n'), count: 1 }
    ];
    const composeSource = [
        'function compose(first: (value: number) => number, stage: (value: number) => number) {',
        '    return function (value: number) { return stage(first.call(this, value)); };',
        '}',
        'function read(P: { compact: (value: number) => number }, make: () => (value: number) => number) { return compose(make(), P.compact); }'
    ].join('\n');
    const firstStageSource = [
        'const receiver = {};',
        'const make = () => { events = [...events, "argument"]; return function (value: number) {',
        '    events = [...events, this === receiver ? "receiver" : "wrong receiver", "first"]; return value + 1;',
        '}; };'
    ].join('\n');
    const traces = [
        ...['normal', 'missing', 'false', 'null'].map(mode => ({
            name: `identifier-composition-${mode}`,
            declaration: composeSource,
            setup: [
                firstStageSource,
                `const mode = ${JSON.stringify(mode)};`,
                'const stage = function(value: number) { events = [...events, this === undefined ? "bare stage" : "bound stage"]; return value * 2; };',
                'const provider = mode === "null" ? null : { get compact() { events = [...events, "get"]; return mode === "normal" ? stage : mode === "false" ? false : undefined; } };'
            ].join('\n'),
            probe: '(() => { const later = read(provider, make); events = [...events, "created"]; return later.call(receiver, 2); })()'
        })),
        { name: 'identifier-getter-failure', declaration: composeSource,
            setup: `${firstStageSource}\nconst failure = {}; const provider = { get compact() { events = [...events, "get"]; throw failure; } };`,
            probe: '(() => { try { read(provider, make); } catch (error) { return error === failure; } })()' },
        { name: 'identifier-argument-failure', declaration: composeSource,
            setup: 'const failure = {}; const provider = { get compact() { events = [...events, "get"]; return value => value; } };',
            probe: '(() => { try { read(provider, () => { events = [...events, "argument"]; throw failure; }); } catch (error) { return error === failure; } })()' },
        { name: 'identifier-deferred-read', declaration: [
            'const accept = <T>(value: T) => value;',
            'function read(P: { compact: () => number }) { return () => accept(P.compact); }'
        ].join('\n'), setup: [
            'const first = () => 1; const second = () => 2; let current = first;',
            'const provider = { get compact() { events = [...events, "get"]; return current; } };'
        ].join('\n'), probe: '(() => { const later = read(provider); events = [...events, "created"]; const a = later(); current = second; return [a === first, later() === second]; })()' },
        { name: 'identifier-returned-record', declaration: [
            'const compose = (first: (value: number) => number, stage: (value: number) => number) => (value: number) => stage(first(value));',
            'function read(P: { compact: (value: number) => number }) {',
            '    return { ask: () => P.compact, asks: (first: (value: number) => number) => compose(first, P.compact), keep: P };',
            '}'
        ].join('\n'), setup: [
            'const first = (value: number) => value + 1; const second = (value: number) => value + 2; let current = first;',
            'const provider = { get compact() { events = [...events, "get"]; return current; } };'
        ].join('\n'), probe: [
            '(() => { const result = read(provider); events = [...events, "created"]; const a = result.ask(); current = second;',
            'return [a === first, result.ask() === second, result.asks(value => value)(3), result.keep === provider]; })()'
        ].join('\n') },
        { name: 'arrow-generic-deferred', declaration: 'function read<T>(P: { value: T }) { return () => P.value; }',
            setup: 'const first = {}; let current = first; const provider = { get value() { events = [...events, "get"]; return current; } };',
            probe: '(() => { const later = read(provider); events = [...events, "created"]; const a = later(); current = undefined; return [a === first, later() === undefined]; })()' },
        { name: 'identifier-guarded-skip', declaration: [
            'const accept = <T>(value: T) => value;',
            'function read(P: { compact: () => number }, selected: boolean) { return selected ? accept(P.compact) : false; }'
        ].join('\n'), setup: 'const provider = { get compact() { events = [...events, "get"]; throw new Error("unexpected Get"); } };', probe: 'read(provider, false)' },
        { name: 'optional-syntax-null', declaration: 'function read(P: { compact: (value: number) => number }) { return P?.compact; }',
            setup: 'const provider = null;', probe: 'read(provider) === undefined' },
        { name: 'optional-syntax-get', declaration: 'function read(P: { compact: (value: number) => number }) { return P?.compact; }',
            setup: 'const token = (value: number) => value; const provider = { get compact() { events = [...events, "get"]; return token; } };',
            probe: 'read(provider) === token' },
        { name: 'selected-optional-null', declaration: 'function read(M: { baseValue: string }, selected: boolean) { return selected ? M?.baseValue : "value"; }',
            setup: 'const provider = null;', probe: 'read(provider, true) === undefined' },
        { name: 'callable-identity', declaration: 'function read(P: { compact: (value: number) => number }) { return P.compact; }',
            setup: 'const token = (value: number) => value; const provider = { get compact() { events = [...events, "get"]; return token; } };',
            probe: 'read(provider) === token' },
        { name: 'missing-callable', declaration: 'function read(P: { compact: (value: number) => number }) { return P.compact; }',
            setup: 'const provider = {};', probe: 'read(provider) === undefined' },
        { name: 'receiver-failure', declaration: 'function read(P: { compact: (value: number) => number }) { return P.compact; }',
            setup: 'const provider = null;', probe: 'read(provider)' },
        { name: 'getter-failure', declaration: 'function read(P: { compact: (value: number) => number }) { return P.compact; }',
            setup: 'const failure = new Error("getter"); const provider = { get compact() { events = [...events, "get"]; throw failure; } };',
            probe: '(() => { try { read(provider); } catch (error) { return error === failure; } })()' },
        { name: 'factory-order', declaration: [
            'function read(make: () => { compact: (value: number) => number; separate: (value: number) => number }) {',
            'const { compact, separate } = make(); return { compact, separate }; }'
        ].join('\n'),
        setup: [
            'const token = (value: number) => value; const make = () => { events = [...events, "factory"]; return {',
            'get compact() { events = [...events, "compact"]; return token; },',
            'get separate() { events = [...events, "separate"]; return token; } }; };'
        ].join('\n'),
        probe: '(() => { const result = read(make); return result.compact === token && result.separate === token; })()' },
        { name: 'factory-failure', declaration: 'function read(make: () => { compact: (value: number) => number }) { const { compact } = make(); return { compact }; }',
            setup: 'const failure = new Error("factory"); const make = () => { events = [...events, "factory"]; throw failure; };',
            probe: '(() => { try { read(make); } catch (error) { return error === failure; } })()' },
        { name: 'selected-skipped', declaration: 'function read(M: { baseValue: string }, selected: boolean) { return selected ? M.baseValue : "value"; }',
            setup: 'const provider = { get baseValue() { events = [...events, "get"]; return "identity"; } };', probe: 'read(provider, false)' },
        { name: 'selected-missing', declaration: 'function read(M: { baseValue: string }, selected: boolean) { return selected ? M.baseValue : "value"; }',
            setup: 'const provider = {};', probe: 'read(provider, true) === undefined' },
        { name: 'selected-get', declaration: 'function read(M: { baseValue: string }, selected: boolean) { return selected ? M.baseValue : "value"; }',
            setup: 'const provider = { get baseValue() { events = [...events, "get"]; return "identity"; } };', probe: 'read(provider, true)' },
        { name: 'generic-value-identity', declaration: 'function read<T>(P: { value: T }) { return P.value; }',
            setup: 'const token = {}; const provider = { get value() { events = [...events, "get"]; return token; } };',
            probe: 'read(provider) === token' },
        { name: 'generic-value-missing', declaration: 'function read<T>(P: { value: T }) { return P.value; }',
            setup: 'const provider = {};', probe: 'read(provider) === undefined' },
        { name: 'generic-constructor-order', declaration: [
            'const wrap = <T>(value: T) => { events = [...events, "wrap"]; return { value }; };',
            'function read<T>(P: { value: T }) { return wrap(P.value); }'
        ].join('\n'), setup: 'const token = {}; const provider = { get value() { events = [...events, "get"]; return token; } };',
        probe: 'read(provider).value === token' },
        { name: 'generic-guarded-skip', declaration: 'function read<T>(P: { value: T }, selected: boolean) { if (selected) return P.value; return "skip"; }',
            setup: 'const provider = { get value() { events = [...events, "get"]; return {}; } };', probe: 'read(provider, false)' },
        { name: 'deferred-owner-phase', declaration: 'function read<T>(P: { value: T }, wrap: (value: T) => T) { return () => wrap(P.value); }',
            setup: 'const provider = { get value() { events = [...events, "get"]; return 0; } };',
            probe: '(() => { const later = read(provider, value => value); const before = events.length; return [before, later()]; })()' },
        { name: 'shadowed-absence-value', declaration: 'function read<T>(P: { value: T }, undefined: number) { return P.value; }',
            setup: 'const provider = {};', probe: 'read(provider, 7) === void 0' },
        ...[true, false].map(selected => ({
            name: `selected-generic-${selected}`,
            declaration: [
                'const isSelected = (input: { tag: boolean }) => input.tag;',
                'function read<T>(P: { baseValue: T }, wrap: () => T, input: { tag: boolean }) { return isSelected(input) ? P.baseValue : wrap(); }'
            ].join('\n'),
            setup: [
                'const token = {}; const provider = { get baseValue() { events = [...events, "baseValue"]; return token; } };',
                `const input = { get tag() { events = [...events, "tag"]; return ${selected}; } };`,
                'const wrap = () => { events = [...events, "wrap"]; return token; };'
            ].join('\n'), probe: 'read(provider, wrap, input) === token'
        })),
        { name: 'selected-generic-missing', declaration: [
            'const isSelected = (input: { tag: boolean }) => input.tag;',
            'function read<T>(P: { baseValue: T }, wrap: () => T, input: { tag: boolean }) { return isSelected(input) ? P.baseValue : wrap(); }'
        ].join('\n'), setup: 'const provider = {};', probe: 'read(provider, () => 7, { tag: true }) === void 0' },
        { name: 'contextual-curried-missing', declaration: [
            'const isSelected = (input: { tag: boolean }) => input.tag;',
            'const read: <T>(P: { baseValue: T }) => (wrap: () => T) => (input: { tag: boolean }) => T =',
            'P => wrap => input => isSelected(input) ? P.baseValue : wrap();'
        ].join('\n'), setup: 'const provider = {};', probe: 'read(provider)(() => 7)({ tag: true }) === void 0' }
    ];
    const sources = new Map([
        ...cases.map(({ name = '', code = '' } = {}) => [`${name}.ts`, `export {};\n${code}`]),
        ...traces.map(({ name = '', declaration = '', setup = '' } = {}) => [
            `${name}.ts`, `export {};\nlet events: string[] = [];\n${declaration}\n${setup}`
        ])
    ].map(([name = '', code = ''] = []) => [name, typescript.createSourceFile(name, code, typescript.ScriptTarget.ESNext, true)]));
    const compilerOptions = { strict: true, target: typescript.ScriptTarget.ESNext };
    const compilerHost = typescript.createCompilerHost(compilerOptions);
    const program = typescript.createProgram([...sources.keys()], compilerOptions, {
        ...compilerHost,
        getSourceFile: (name, version) => sources.get(name) || compilerHost.getSourceFile(name, version)
    });
    cases.forEach(({ name = '', count = 0 } = {}) => {
        const sourceFile = sources.get(`${name}.ts`);
        const checker = program.getTypeChecker();
        const deferredOpaqueFieldContracts = collectDeferredOpaqueFieldContracts({ typescript, sourceFile, checker });
        const contracts = collectExactProviderForwardContracts({ typescript, sourceFile, checker, deferredOpaqueFieldContracts });

        const agreements = collectDestructuringAgreements({ exactProviderForwards: contracts });
        assert.equal(contracts.size, count, name);
        const nodes = [
            ...nodesOfKind({ root: sourceFile, kind: typescript.SyntaxKind.BindingElement }),
            ...nodesOfKind({ root: sourceFile, kind: typescript.SyntaxKind.PropertyAccessExpression })
        ];
        nodes.forEach((node) => {
            const { agreement: { action = '' } = {} } = getDestructuringDecisionForNode({ typescript, node, destructuringAgreements: compileDestructuringDecisions(agreements),
                kinds: ['exact-provider-forward'] });
            assert.equal(action === 'exact-provider-forward', contracts.has(getConsumerContractKey(node)), name);
        });
    });

    const sourceFile = sources.get('selected.ts');
    const [owned = {}] = nodesOfKind({ root: sourceFile, kind: typescript.SyntaxKind.PropertyAccessExpression });
    const contracts = collectExactProviderForwardContracts({ typescript, sourceFile, checker: program.getTypeChecker() });
    const agreements = collectDestructuringAgreements({ exactProviderForwards: contracts });
    const [contract = {}] = contracts.values();
    const unrelated = typescript.createSourceFile('unrelated.ts', 'const { baseValue } = unrelated;', typescript.ScriptTarget.ESNext, true);
    const [unrelatedElement = {}] = nodesOfKind({ root: unrelated, kind: typescript.SyntaxKind.BindingElement });
    const place = (node = {}, map = compileDestructuringDecisions(agreements)) => {
        const pattern = typescript.factory.createObjectBindingPattern([node]);
        const { transformed: [result = pattern] = [], dispose = () => {} } = typescript.transform(pattern, [
            context => root => lowerExactProviderForwarding({ typescript, node: root, destructuringAgreements: map, context })
        ]);
        const { elements: [element = node] = [] } = result;
        dispose();

        return element;
    };
    assert.equal(place(unrelatedElement), unrelatedElement, 'A member-only match cannot acquire another receiver\'s decision.');
    const factoryBinding = typescript.factory.createBindingElement(undefined, undefined, 'baseValue', undefined);
    assert.equal(place(factoryBinding), factoryBinding, 'A rangeless factory binding has no source admission.');
    const ownedBinding = typescript.setOriginalNode(
        typescript.factory.createBindingElement(undefined, undefined, 'baseValue', undefined), owned
    );
    const placedBinding = place(ownedBinding);
    assert.equal(placedBinding.initializer, undefined, 'The completed source owner retains natural absence without a default.');
    assert.match(placedBinding.__resilientAgreement, /native absence/u);
    assert.equal(typescript.getOriginalNode(placedBinding), owned);
    assert.equal(getDestructuringDecisionForNode({ typescript, node: placedBinding, destructuringAgreements: compileDestructuringDecisions(agreements),
        kinds: ['exact-provider-forward'] }).contract, contract);

    // Original range wins; a rangeless original can use the existing direct range.
    const clone = typescript.setOriginalNode(typescript.factory.createPropertyAccessExpression('other', 'baseValue'), owned);
    typescript.setTextRange(clone, { pos: owned.pos + 1, end: owned.end });
    assert.equal(getDestructuringDecisionForNode({ typescript, node: clone, destructuringAgreements: compileDestructuringDecisions(agreements),
        kinds: ['exact-provider-forward'] }).contract, contract);
    const directRange = typescript.setOriginalNode(
        typescript.setTextRange(typescript.factory.createPropertyAccessExpression('M', 'baseValue'), owned),
        typescript.factory.createPropertyAccessExpression('other', 'baseValue')
    );
    assert.equal(getDestructuringDecisionForNode({ typescript, node: directRange, destructuringAgreements: compileDestructuringDecisions(agreements),
        kinds: ['exact-provider-forward'] }).contract, contract);
    const before = [...agreements];
    const collision = collectDestructuringAgreements({ sortCapabilityContracts: new Map([[getConsumerContractKey(owned), {
        action: 'guard-sort-capability', receiver: 'M', member: 'baseValue'
    }]]), exactProviderForwards: contracts });
    assert.ok(place(ownedBinding, compileDestructuringDecisions(collision)) === ownedBinding, 'Direct callable-consumer Policy keeps precedence over forwarding.');
    const projectionCollision = collectDestructuringAgreements({ exactProjections: new Map([[getConsumerContractKey(owned), {
        action: 'exact-callback-projection', receiver: 'M', member: 'baseValue'
    }]]), exactProviderForwards: contracts });
    assert.equal(place(ownedBinding, compileDestructuringDecisions(projectionCollision)), ownedBinding,
        'The completed callback projection retains its own placement and publication timing.');
    assert.deepEqual([...agreements], before, 'Placement does not publish a second source decision.');
    const failure = new Error('lookup');
    const failedLookup = compileDestructuringDecisions(agreements);
    Object.defineProperty(failedLookup.byKey, 'get', { value: () => { throw failure; } });
    assert.throws(() => place(ownedBinding, failedLookup), error => error === failure,
        'The selected exact lookup keeps native failure identity.');
    let unrelatedReads = 0;
    const unrelatedContract = { kind: 'exact-provider-forward', contract: {} };
    const isolated = compileDestructuringDecisions(new Map([...agreements, ['unrelated', [unrelatedContract]]]));
    Object.defineProperty(unrelatedContract, 'contract', { get: () => {
        unrelatedReads += 1;

        throw new Error('unrelated record');
    } });
    place(ownedBinding, isolated);
    assert.equal(unrelatedReads, 0, 'Exact lookup no longer executes an unrelated fallback classification scan.');

    const branchSource = sources.get('selected-generic.ts');
    const branchContracts = collectExactProviderForwardContracts({ typescript, sourceFile: branchSource, checker: program.getTypeChecker() });
    const branchAgreements = collectDestructuringAgreements({ exactProviderForwards: branchContracts });
    const branchPlacement = compilePlacementDecisions({ typescript, evidence: collectPlacementEvidence({
        typescript, sourceFile: branchSource, checker: program.getTypeChecker()
    }) });
    const { transformed: [branchResult = branchSource] = [], dispose: releaseBranch = () => {} } = typescript.transform(branchSource, [
        context => root => lowerGuardedConditionalReturns({
            typescript, sourceFile: root, placement: branchPlacement, destructuringAgreements: compileDestructuringDecisions(branchAgreements), context
        })
    ]);
    const ownedBranchBindings = nodesOfKind({ root: branchResult, kind: typescript.SyntaxKind.BindingElement }).filter((node) => {
        const { agreement: { action = '' } = {} } = getDestructuringDecisionForNode({
            typescript, node, destructuringAgreements: compileDestructuringDecisions(branchAgreements), kinds: ['exact-provider-forward']
        });

        return action === 'exact-provider-forward';
    });
    assert.equal(ownedBranchBindings.length, 1, 'Branch construction preserves the original provider read identity.');
    const [ownedBranchBinding = {}] = ownedBranchBindings;
    const { initializer: branchInitializer = false } = ownedBranchBinding;
    assert.equal(branchInitializer, false, 'Branch construction carries origin; existing provider placement owns the default and report publication.');
    const retainedBranch = place(ownedBranchBinding, compileDestructuringDecisions(branchAgreements));
    assert.equal(retainedBranch.initializer, undefined, 'Provider placement consumes the exact source decision without adding a default.');
    assert.match(retainedBranch.__resilientAgreement, /native absence/u);
    assert.ok(branchContracts.has(getConsumerContractKey(typescript.getOriginalNode(ownedBranchBinding))));
    releaseBranch();

    const capabilitySources = new Map([
        ['direct.ts', [
            'type Provider = { of: (value: string) => string };',
            'function lift(F: Provider, value: string) { return F.of(value); }',
            'function unrelated(F: Provider) { return F.of; }'
        ].join('\n')],
        ['sort.ts', [
            'type Ordering = { compare: (inbound: number, outbound: number) => number };',
            'function sort(O: Ordering, values: number[]) { return values.slice().sort(O.compare); }',
            'function unrelated(O: Ordering) { return O.compare; }'
        ].join('\n')]
    ].map(([name = '', code = ''] = []) => [name, typescript.createSourceFile(
        name, code, typescript.ScriptTarget.ESNext, true
    )]));
    const capabilityHost = typescript.createCompilerHost(compilerOptions);
    const capabilityProgram = typescript.createProgram([...capabilitySources.keys()], compilerOptions, {
        ...capabilityHost,
        getSourceFile: (name, version) => capabilitySources.get(name) || capabilityHost.getSourceFile(name, version)
    });
    const capabilityChecker = capabilityProgram.getTypeChecker();
    const directFile = capabilitySources.get('direct.ts');
    const sortFile = capabilitySources.get('sort.ts');
    const directContracts = collectDirectCapabilityContracts({ typescript, sourceFile: directFile, checker: capabilityChecker });
    const sortContracts = collectSortCapabilityContracts({ typescript, sourceFile: sortFile, checker: capabilityChecker });
    const capabilityAgreements = collectDestructuringAgreements({
        directCapabilityContracts: directContracts, sortCapabilityContracts: sortContracts
    });

    const capabilityReads = [
        ...nodesOfKind({ root: directFile, kind: typescript.SyntaxKind.PropertyAccessExpression }),
        ...nodesOfKind({ root: sortFile, kind: typescript.SyntaxKind.PropertyAccessExpression })
    ].filter(({ name: { text = '' } = {} } = {}) => ['of', 'compare'].includes(text));
    capabilityReads.forEach((node = {}) => {
        const { entry = {} } = findCapabilityConsumerDecision({
            typescript, node, destructuringAgreements: compileDestructuringDecisions(capabilityAgreements),
            kinds: ['direct-capability', 'sort-capability']
        });
        const { parent = {}, name: { text = '' } = {} } = node;
        const { kind: parentKind = 0, expression = {}, arguments: args = [] } = parent;
        const { kind: entryKind = '' } = entry;
        const admitted = parentKind === typescript.SyntaxKind.CallExpression &&
            (expression === node || args.includes(node));

        assert.equal(Boolean(entryKind), admitted, 'A same-spelled neighbor cannot borrow an admitted source decision.');

        if (!admitted) return;

        const clone = typescript.setOriginalNode(typescript.factory.createPropertyAccessExpression('other', text), node);
        assert.equal(findCapabilityConsumerDecision({ typescript, node: clone, destructuringAgreements: compileDestructuringDecisions(capabilityAgreements),
            kinds: ['direct-capability', 'sort-capability'] }).entry, entry,
        'A transformed read keeps its source decision through original-node provenance.');
    });

    const linter = new Linter();
    const lintConfig = { plugins: { resilient }, rules: {
        'resilient/prefer-safe-destructuring-defaults': 'error',
        'resilient/prefer-destructured-member-access': 'error'
    } };
    const transformer = createTypeScriptTransformer({ typescript, program });
    cases.forEach(({ name = '', count = 0 } = {}) => {
        const source = sources.get(`${name}.ts`).getFullText();
        const { diagnostics = [], agreements: published = [] } = transformer.transform({ code: source, fileName: `${name}.ts` });
        const reports = published.filter(({ action = '', site = '' } = {}) => action === 'exact-provider-forwarded' &&
            site === 'exact-provider-forwarding');

        assert.deepEqual(diagnostics, [], name);
        assert.equal(reports.length, count, `${name}: each admitted source fact has one public forwarding report`);
    });
    const observe = async ({ text = '', probe = '' } = {}) => {
        const resolved = ['object', 'array', 'function'].reduce((result = '', module = '') => result.replaceAll(
            `eslint-plugin-resilient/standard/${module}`, import.meta.resolve(`eslint-plugin-resilient/standard/${module}`)
        ), text);
        const suffix = `let value; let failureName;
        try { value = ${probe}; } catch (error) { failureName = error.name; }
        export default JSON.stringify({ events, value, failureName });`;
        const { default: observation = '' } = await import(`data:text/javascript,${encodeURIComponent(`${resolved}\n${suffix}`)}`);

        return observation;
    };
    await Promise.all(traces.map(async ({ name = '', probe = '' } = {}) => {
        const source = sources.get(`${name}.ts`).getFullText();
        const { code = '', diagnostics = [], agreements: published = [] } = transformer.transform({ code: source, fileName: `${name}.ts` });
        assert.deepEqual(diagnostics, [], name);

        if (name.startsWith('selected-generic') || name === 'contextual-curried-missing' || name.startsWith('identifier-')) assert.ok(
            published.some(({ action = '', site = '' } = {}) => action === 'exact-provider-forwarded' && site === 'exact-provider-forwarding'),
            `${name}: the existing placement owner still publishes its agreement`
        );

        const { outputText: original = '' } = typescript.transpileModule(source, { compilerOptions });
        const expected = await observe({ text: original, probe });
        const { output: fixed = code, messages = [] } = linter.verifyAndFix(code, lintConfig);
        const lintRules = messages.filter(({ ruleId = '' } = {}) => ruleId).map(({ ruleId = '' } = {}) => ruleId);
        const rejectedOptionalRead = name.startsWith('optional-syntax') || name === 'selected-optional-null';

        assert.deepEqual(lintRules, rejectedOptionalRead ? ['resilient/prefer-destructured-member-access'] : [], name);
        assert.equal(await observe({ text: code, probe }), expected, `${name}: public transform`);
        assert.equal(await observe({ text: fixed, probe }), expected, `${name}: targeted fixed output`);
    }));
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-repeated-read-'));
    const fileName = path.join(directory, 'repeated.ts');
    const source = [
        'export const ordered = (value: { x: number }, between: () => number) =>',
        '    value.x + between() + value.x;',
        'export const branch = (value: { x: number }, test: () => boolean) => {',
        '    if (test()) return value.x;',
        '    return value.x;',
        '};',
        'export const selected = (value: { category: string }) =>',
        '    value.category === "Inbound"',
        '        ? value.category === "Combined"',
        '        : value.category === "Outbound";',
        'export const single = (value: { x: number }) => value.x;',
        ''
    ].join('\n');

    try {
        await writeFile(fileName, source);
        const program = typescript.createProgram([fileName], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        });
        const contracts = collectRepeatedParameterReadContracts({
            typescript, sourceFile: program.getSourceFile(fileName), checker: program.getTypeChecker()
        });

        [...contracts].forEach(([range = '', fact = {}] = []) => {
            const { sourceRange = '', readRanges = [] } = fact;

            assert.equal(sourceRange, range);
            assert.ok([2, 3].includes(readRanges.length));
        });

        const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
            code: source, fileName
        });

        assert.deepEqual(diagnostics, []);
        assert.match(code, /value\.x \+ between\(\) \+ value\.x/);
        assert.match(code, /value\.category === "Inbound"/);
        assert.match(code, /if \(test\(\)\)/);
        assert.match(code, /return value\.x/);
        assert.doesNotMatch(code, /(?:ordered|branch) = \(\{/);
        assert.match(code, /repeated parameter Get: count, order, phase/);

        const eslintConfig = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
        const [raw = {}] = await new ESLint({ overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(code, { filePath: 'repeated-generated.js' });
        const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(code, { filePath: 'repeated-generated.js' });

        assert.equal(raw.messages.filter(({ severity = 0, ruleId = '' } = {}) => (
            severity === 2 && ruleId !== 'padding-line-between-statements'
        )).length, 0, JSON.stringify(raw.messages));
        assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));

        const { outputText: sourceJavaScript = '' } = typescript.transpileModule(source, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const importCode = async text => import(`data:text/javascript,${encodeURIComponent(text)}`);
        const sourceModule = await importCode(sourceJavaScript);
        const generatedModule = await importCode(code);
        const observe = (module, name, secondGetThrows = false) => {
            let trace = '';
            let reads = 0;
            const value = Object.defineProperty({}, 'x', { get() {
                reads += 1;
                trace += 'g';

                if (secondGetThrows && reads === 2) throw new Error('second Get');

                return reads;
            } });
            let result;

            try {
                result = name === 'ordered'
                    ? module.ordered(value, () => {
                        trace += 'b';

                        return 10;
                    })
                    : module.branch(value, () => {
                        trace += 't';

                        return secondGetThrows;
                    });
            } catch ({ message = '' }) {
                result = message;
            }

            return { result, trace, reads };
        };

        ['ordered', 'branch'].forEach(name => [false, true].forEach((throws) => {
            assert.deepEqual(observe(generatedModule, name, throws), observe(sourceModule, name, throws));
        }));

        const observeSelected = (module, tags) => {
            let reads = 0;
            const value = Object.defineProperty({}, 'category', { get() {
                const { [reads]: tag = 'Other' } = tags;

                reads += 1;

                return tag;
            } });

            return { result: module.selected(value), reads };
        };

        [['Inbound', 'Combined'], ['Inbound', 'Other'], ['Other', 'Outbound'], ['Other', 'Other']]
            .forEach((tags) => {
                assert.deepEqual(observeSelected(generatedModule, tags), observeSelected(sourceModule, tags));
            });

        const rejectedSource = [
            'export const once = (value: { x: number }) => value.x;',
            'export const collection = (value: { items: number[] }) =>',
            '    value.items.length + value.items.length;',
            'export const nested = (value: { x: number }) => {',
            '    const later = (value: { x: number }) => value.x;',
            '    return value.x + value.x + later({ x: 3 });',
            '};'
        ].join('\n');
        const rejectedFile = path.join(directory, 'single.ts');

        await writeFile(rejectedFile, rejectedSource);
        const rejectedProgram = typescript.createProgram([rejectedFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext
        });

        const rejectedFileSource = rejectedProgram.getSourceFile(rejectedFile);
        const nestedContracts = collectRepeatedParameterReadContracts({
            typescript, sourceFile: rejectedFileSource, checker: rejectedProgram.getTypeChecker()
        });
        const nestedAgreements = collectDestructuringAgreements({ repeatedParameterReadContracts: nestedContracts });
        let candidateReads = [];
        const collectCandidateReads = (node = {}) => {
            const { name: { text = '' } = {} } = node;

            if (typescript.isPropertyAccessExpression(node) && text === 'x') candidateReads = [...candidateReads, node];

            typescript.forEachChild(node, collectCandidateReads);
        };
        collectCandidateReads(rejectedFileSource);

        assert.deepEqual(candidateReads.map(node => nestedContracts.has(getConsumerContractKey(node))),
            [false, false, true, true], 'A once-read or shadowed same-name receiver cannot borrow the outer decision.');
        const [, shadowedRead = {}] = candidateReads;

        const shadowedClone = typescript.setOriginalNode(typescript.factory.createPropertyAccessExpression('other', 'x'), shadowedRead);
        const decisionFor = node => getDestructuringDecisionForNode({
            typescript, node, destructuringAgreements: compileDestructuringDecisions(nestedAgreements), kinds: ['repeated-parameter-read']
        });

        assert.deepEqual(decisionFor(shadowedClone).entry, {});
        const { code: nestedCode = '', diagnostics: nestedDiagnostics = [] } = createTypeScriptTransformer({
            typescript, program: rejectedProgram
        }).transform({ code: rejectedSource, fileName: rejectedFile });
        const { outputText: nestedSourceJavaScript = '' } = typescript.transpileModule(rejectedSource, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const [nestedRaw = {}] = await new ESLint({ overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(nestedCode, { filePath: 'nested-repeated-generated.js' });
        const [nestedFixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(nestedCode, { filePath: 'nested-repeated-generated.js' });
        const observeNested = ({ nested } = {}) => {
            if (typeof nested !== 'function') throw new TypeError('Expected compiled callable exports');

            let reads = 0;
            const value = Object.defineProperty({}, 'x', { get() {
                reads += 1;

                return reads;
            } });

            return { result: nested(value), reads };
        };

        assert.deepEqual(nestedDiagnostics, []);
        assert.equal(nestedRaw.errorCount, 0, JSON.stringify(nestedRaw.messages));
        assert.equal(nestedFixed.errorCount, 0, JSON.stringify(nestedFixed.messages));
        const expectedNested = observeNested(await importCode(nestedSourceJavaScript));

        assert.deepEqual(observeNested(await importCode(nestedCode)), expectedNested);
        assert.deepEqual(observeNested(await importCode(nestedFixed.output || nestedCode)), expectedNested);
        const cardinalityCases = {
            length: 'export function probe(a: { length: number }) { return a.length + a.length; }',
            size: 'export function probe(a: { size: number }) { return a.size + a.size; }',
            ordinary: 'export function probe(a: { value: number }) { return a.value + a.value; }',
            mixed: 'export function probe(a: { length: number; value: number }) { return a.length + a.value + a.length + a.value; }',
            array: 'export function probe(n: number, as: number[]) { return n >= as.length ? [] : as.slice(0, as.length - n); }',
            operation: 'export function probe(a: { length: number; map: (n: number) => number }) { return a.map(a.length + a.length); }',
            neighbor: 'export function probe(a: { length: number; value: number }) { const n = a.length + a.length; return n + a.value + a.value; }'
        };
        const cardinalityFiles = Object.keys(cardinalityCases).map(name => path.join(directory, `${name}.ts`));

        await Promise.all(Object.entries(cardinalityCases).map(([name = '', text = ''] = []) => (
            writeFile(path.join(directory, `${name}.ts`), text)
        )));
        const cardinalityProgram = typescript.createProgram(cardinalityFiles, {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const cardinalityTransformer = createTypeScriptTransformer({ typescript, program: cardinalityProgram });
        const cardinalityRawLinter = new ESLint({ overrideConfigFile: true, overrideConfig: eslintConfig });
        const cardinalityFixedLinter = new ESLint({ fix: true, overrideConfigFile: true, overrideConfig: eslintConfig });
        const observeCardinality = (module, name, secondGetThrows = false) => {
            let trace = [];
            let reads = 0;
            const value = {};

            ['length', 'size', 'value'].forEach(property => Object.defineProperty(value, property, { get() {
                reads += 1;
                trace = [...trace, property];

                if (secondGetThrows && reads === 2) throw new Error('second Get');

                return reads + 3;
            } }));
            Object.defineProperty(value, 'map', { get() {
                trace = [...trace, 'map'];

                // eslint-disable-next-line no-restricted-syntax -- The unary operation oracle checks that native forwarding preserves the selected value receiver.
                return function operation(input) {
                    trace = [...trace, this === value ? 'receiver' : 'wrong receiver'];

                    return input;
                };
            } });
            Object.defineProperty(value, 'slice', { get() {
                trace = [...trace, 'slice'];

                // eslint-disable-next-line no-restricted-syntax -- The range operation oracle checks receiver identity alongside both forwarded arguments.
                return function operation(start, end) {
                    trace = [...trace, this === value ? 'receiver' : 'wrong receiver', start, end];

                    return [start, end];
                };
            } });
            let result;
            let failure;

            try {
                result = name === 'array' ? module.probe(1, value) : module.probe(value);
            } catch ({ message = '' }) {
                result = message;
            }

            try {
                const invoke = input => name === 'array' ? module.probe(1, input) : module.probe(input);

                invoke(null);
            } catch ({ name: errorName = '' }) {
                failure = errorName;
            }

            return { trace, result, failure };
        };

        // eslint-disable-next-line resilient/prefer-prototype-methods -- Shared checker and lint instances are exercised sequentially for each proof.
        for (const [name = '', text = ''] of Object.entries(cardinalityCases)) {
            const cardinalityFile = path.join(directory, `${name}.ts`);
            const facts = collectRepeatedParameterReadContracts({
                typescript, sourceFile: cardinalityProgram.getSourceFile(cardinalityFile),
                checker: cardinalityProgram.getTypeChecker()
            });

            assert.ok(facts.size >= 2, `${name} retains its real checker agreement.`);
            assert.ok([...facts.values()].every(({ readRanges = [] }) => readRanges.length === 2));
            const { code: cardinalityCode = '', diagnostics: cardinalityDiagnostics = [] } = cardinalityTransformer.transform({
                code: text, fileName: cardinalityFile
            });

            assert.deepEqual(cardinalityDiagnostics, []);

            if (['length', 'size', 'array'].includes(name)) {
                assert.doesNotMatch(cardinalityCode, /repeated parameter Get/);
            }

            if (['ordinary', 'mixed', 'neighbor'].includes(name)) {
                assert.match(cardinalityCode, /repeated parameter Get/);
            }

            if (name === 'operation') assert.match(cardinalityCode, /declared callable retains/);

            const [cardinalityRaw = {}] = await cardinalityRawLinter.lintText(cardinalityCode, { filePath: 'cardinality-generated.js' });
            const [cardinalityFixed = {}] = await cardinalityFixedLinter.lintText(cardinalityCode, { filePath: 'cardinality-generated.js' });

            assert.equal(cardinalityRaw.errorCount, 0, JSON.stringify(cardinalityRaw.messages));
            assert.equal(cardinalityFixed.errorCount, 0, JSON.stringify(cardinalityFixed.messages));

            if (['ordinary', 'mixed', 'neighbor'].includes(name)) {
                assert.ok(cardinalityRaw.suppressedMessages.some(({ ruleId = '' }) => (
                    ruleId === 'resilient/prefer-destructured-member-access'
                )));
            }

            const { outputText: cardinalityNative = '' } = typescript.transpileModule(text, {
                compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
            });
            const nativeModule = await importCode(cardinalityNative);
            const rawModule = await importCode(cardinalityCode);
            const fixedModule = await importCode(cardinalityFixed.output || cardinalityCode);

            [false, true].forEach((throws) => {
                const expected = observeCardinality(nativeModule, name, throws);

                assert.deepEqual(observeCardinality(rawModule, name, throws), expected);
                assert.deepEqual(observeCardinality(fixedModule, name, throws), expected);
            });
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

{
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

    const partition = resolve({ typescript, sourceFile, declarations, parts: parts.slice(0, 3) });

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
    // eslint-disable-next-line resilient/no-undefined-assignment -- The resolver predicate oracle includes native undefined to verify exact inbound absence behavior.
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
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-same-phase-selection-'));
    const fileName = path.join(directory, 'selection.ts');
    const source = [
        'export const mutable = (source: { value?: number }) => {',
        '    const undefined = 99;',
        '    const holder = source;',
        '    let current = holder.value;',
        '    current = current === void 0 ? 0 : current + 1;',
        '    return [current, undefined];',
        '};',
        'export const guarded = (source: { right?: number }, enabled: boolean) => {',
        '    if (enabled) {',
        '        const chosen = source.right;',
        '        return chosen;',
        '    }',
        '    return 0;',
        '};',
        'export const nested = (source: { inner: { value: number } }) => {',
        '    const holder = source;',
        '    const selected = holder.inner.value;',
        '    return selected;',
        '};',
        'export const has = Object.prototype.hasOwnProperty;',
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
        assert.match(emissionSyntax(code), /\{ value: current = void 0 \} = holder/);
        assert.match(emissionSyntax(code), /\{ right: chosen = void 0 \} = source/);
        assert.match(emissionSyntax(code), /\{ inner: \{ value: selected = void 0 \} \} = holder/);
        assert.match(emissionSyntax(code), /\{ prototype: \{ hasOwnProperty: has = void 0 \} \} = Object/);
        assert.doesNotMatch(code, /source\.value|source\.right|Object\.prototype\.hasOwnProperty/);

        const eslintConfig = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
        const [raw = {}] = await new ESLint({ overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(code, { filePath: 'selection-generated.js' });
        const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
            overrideConfig: eslintConfig }).lintText(code, { filePath: 'selection-generated.js' });

        // Stable local aliases now retain their parameter identity in the shared
        // signature rule. These are manual placement findings, not permission to
        // move a source Get or invent a default in this transformer phase.
        const expectedPlacement = ['source', 'source'].map(name => ({
            ruleId: 'resilient/prefer-signature-destructuring',
            message: `Destructure "${name}" in the function signature instead of inside the function body.`
        }));
        [raw, fixed].forEach(({ messages = [] }) => {
            const comparison = messages.filter(({ ruleId = '' }) => ruleId === 'resilient/no-undefined-comparison');

            assert.equal(comparison.length, 1, 'The authored exact void comparison retains its dialect finding.');
            assert.deepEqual(messages.filter(({ ruleId = '' }) => !['padding-line-between-statements', 'resilient/no-undefined-comparison'].includes(ruleId))
                .map(({ ruleId = '', message = '' }) => ({ ruleId, message })), expectedPlacement);
        });

        const { outputText: sourceJavaScript = '' } = typescript.transpileModule(source, {
            compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
        });
        const importCode = async text => import(`data:text/javascript,${encodeURIComponent(text)}`);
        const sourceModule = await importCode(sourceJavaScript);
        const generatedModule = await importCode(code);
        const observe = (module) => {
            let gets = 0;
            const input = {
                get value() {
                    gets += 1;

                    return 7;
                },
                get right() {
                    gets += 1;

                    return 7;
                }
            };
            const skipped = module.guarded(input, false);
            const before = gets;
            const selected = module.guarded(input, true);
            const mutable = module.mutable(input);

            return { skipped, before, selected, mutable, gets };
        };

        assert.deepEqual(observe(generatedModule), observe(sourceModule));
        assert.equal(generatedModule.has, sourceModule.has);
        assert.deepEqual(generatedModule.mutable({}), sourceModule.mutable({}));
        assert.equal(generatedModule.nested({ inner: { value: 5 } }), sourceModule.nested({ inner: { value: 5 } }));
        assert.throws(() => sourceModule.nested({}), TypeError);
        assert.throws(() => generatedModule.nested({}), TypeError);
        assert.throws(() => sourceModule.mutable(null), TypeError);
        assert.throws(() => generatedModule.mutable(null), TypeError);

        const rejectedFile = path.join(directory, 'rejected.ts');
        const rejectedSource = [
            'export const optional = (source?: { value?: number }) => {',
            '    const selected = source?.value;',
            '    return selected;',
            '};',
            'export const cardinality = (values: number[]) => {',
            '    const count = values.length;',
            '    return count;',
            '};',
            'export const signatureOwned = (source: { nested: { value: number } }) => {',
            '    const chosen = source.nested.value;',
            '    return chosen;',
            '};',
            ''
        ].join('\n');

        await writeFile(rejectedFile, rejectedSource);
        const rejectedProgram = typescript.createProgram([rejectedFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext
        });

        assert.equal(collectSamePhaseSelectedBindingContracts({
            typescript, sourceFile: rejectedProgram.getSourceFile(rejectedFile),
            checker: rejectedProgram.getTypeChecker()
        }).size, 0);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

{
    const variant = 'type E = { category: "Inbound"; inbound: unknown } | { category: "Outbound"; outbound: unknown };';
    const selection = 'switch(v.category) { case "Inbound": if(accept(v.inbound)) return true; break; case "Outbound": if(accept(v.outbound)) return true; break; }';
    const cases = [
        { name: 'local', source: `export function probe(items: Set<E>, accept: (value: unknown) => boolean) { for (const v of items) { ${selection} } return false; }`, boundaries: 0 },
        { name: 'method', source: `export function probe(accept: (value: unknown) => boolean) { return { run(v: E) { ${selection} return false; } }; }`, boundaries: 2 },
        { name: 'unknown', source: `export function probe(v: E, accept: (value: unknown) => boolean) { ${selection} return false; }`, boundaries: 2 },
        { name: 'parameter', source: `export function probe(v: E, accept: (value: unknown) => boolean) { ${selection} return false; }`, boundaries: 2 },
        { name: 'shadowed', source: `export function probe(v: E, items: Set<E>, accept: (value: unknown) => boolean) { void v; for (const v of items) { ${selection} } return false; }`,
            boundaries: 0 },
        { name: 'captured', source: `export function probe(v: E, accept: (value: unknown) => boolean) { return () => { ${selection} return false; }; }`, boundaries: 0 },
        // Whole-reference applicability is deliberately conservative for parameters;
        // this ownership change must not invent a new return/reference classifier.
        { name: 'whole', source: `export function probe(v: E, accept: (value: unknown) => boolean) { ${selection} return accept(v); }`, boundaries: 2 }
    ];
    const compilerOptions = { strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext };
    const files = new Map(cases.map(({ name = '', source = '' } = {}) => {
        const fileName = `${name}-switch-ownership.ts`;

        return [fileName, typescript.createSourceFile(fileName, `${variant}\n${source}`, typescript.ScriptTarget.ESNext, true)];
    }));
    const compilerHost = typescript.createCompilerHost(compilerOptions);
    const { getSourceFile: originalGetSourceFile = () => {} } = compilerHost;
    const host = { ...compilerHost,
        getSourceFile: (name, languageVersion, onError) => files.get(name) || originalGetSourceFile(name, languageVersion, onError) };
    const program = typescript.createProgram([...files.keys()], compilerOptions, host);
    const checker = program.getTypeChecker();
    const lint = new ESLint({ overrideConfigFile: true, overrideConfig: [{
        plugins: { resilient }, rules: { 'resilient/prefer-signature-destructuring': 'error' }
    }] });
    const transpile = (source = '') => typescript.transpileModule(source, { compilerOptions }).outputText.replace(/\bexport /gu, '');

    await Promise.all(cases.map(async ({ name = '' } = {}) => {
        const sourceFile = program.getSourceFile(`${name}-switch-ownership.ts`);
        const selectedModelContracts = collectSelectedModelContracts({ typescript, sourceFile, checker });
        const evidence = collectPlacementEvidence({ typescript, sourceFile, checker });
        const { facts = new Map() } = evidence;
        const { text: sourceText = '' } = sourceFile;
        // Losing provenance cannot establish that a binding is a local.
        const placement = name === 'unknown'
            ? { ...evidence, facts: new Map([...facts].map(([node = {}, fact = {}] = []) => [node, { ...fact, symbol: false }])) }
            : evidence;
        const destructuringAgreements = compileDestructuringDecisions(collectDestructuringAgreements({ selectedModelContracts }));

        assert.deepEqual([...selectedModelContracts.values()].map(({ operationRole = '', action = '' } = {}) => [operationRole, action]), [
            ['discriminator-read', 'selected-model-read'],
            ['selected-field-read', 'retain-source-phase-read'],
            ['selected-field-read', 'retain-source-phase-read']
        ]);
        const { transformed: [placed = sourceFile] = [], dispose = () => {} } = typescript.transform(sourceFile, [context => (root) => {
            const visit = (node) => {
                const visited = typescript.visitEachChild(node, visit, context);

                return typescript.isFunctionDeclaration(visited) || typescript.isArrowFunction(visited)
                    ? lowerDiscriminatedSwitchAccess({ typescript, node: visited, placement, destructuringAgreements, context })
                    : visited;
            };

            return typescript.visitNode(root, visit);
        }]);
        const output = typescript.createPrinter().printFile(placed);
        dispose();
        assert.equal(output.split('selected payload Get remains after tag selection').length - 1, 0, name);
        assert.match(output, /accept\(v\.inbound\)/u, name);
        assert.match(output, /accept\(v\.outbound\)/u, name);
        const code = transpile(output);
        const [result = {}] = await lint.lintText(code, { filePath: `${name}-switch-ownership.js` });
        assert.deepEqual(result.messages.filter(({ ruleId = '' } = {}) => ruleId), [], name);
        assert.equal(result.suppressedMessages.length, 0, name);
        const setup = [
            'const events = [];',
            'const accept = value => { events.push(["call", value]); return false; };',
            'const make = (tag, fail) => ({ get category() { events.push("tag"); return tag; },',
            'get inbound() { events.push("inbound"); if(fail) throw new TypeError("payload"); return undefined; },',
            'get outbound() { events.push("outbound"); if(fail) throw new TypeError("payload"); return 4; } });'
        ].join('\n');
        ['Inbound', 'Outbound'].forEach((tag) => {
            [false, true].forEach((fail) => {
                let call = 'probe(input, accept)';

                if (name === 'local') call = 'probe(new Set([input]), accept)';

                if (name === 'shadowed') call = 'probe(make("Outbound", true), new Set([input]), accept)';

                if (name === 'method') call = 'probe(accept).run(input)';

                if (name === 'captured') call = 'probe(input, accept)()';

                const exercise = `const input=make(${JSON.stringify(tag)},${fail}); let result; try { result=${call}; } catch(error) { result=error.name; } JSON.stringify({result,events});`;
                assert.equal(runInNewContext(`${setup}\n${code}\n${exercise}`),
                    runInNewContext(`${setup}\n${transpile(sourceText)}\n${exercise}`), `${name}/${tag}/${fail}`);
            });
        });
    }));
}
