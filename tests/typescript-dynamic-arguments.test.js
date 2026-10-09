import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ESLint, Linter } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { getDestructuringAgreement } from '../transforms/typescript/policy/defaults.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import {
    collectAritySignatureContracts,
    collectIndexedOperationContracts,
    collectNativeFunctionContracts
} from '../transforms/typescript/understand/type-evidence.js';
import { observeModule } from './support/module.js';

const directory = await mkdtemp(path.join(tmpdir(), 'resilient-dynamic-arguments-'));
const fileName = path.join(directory, 'arguments.ts');
const source = [
    'export function fold(first: number, ...steps: Array<(value: number) => number>): number {',
    '    let result = arguments[0];',
    '    for (let i = 1; i < arguments.length; i += 1) result = arguments[i](result);',
    '    return steps.length ? result : first;',
    '}',
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
    const argumentFacts = [...contracts.values()].filter(({ operationRole = '' } = {}) => (
        operationRole === 'dynamic-arguments-read'
    ));

    assert.equal(argumentFacts.length, 2);
    assert.equal(argumentFacts.filter(({ staticPosition = false } = {}) => staticPosition).length, 1);
    const [loopFact = {}] = [...contracts.values()].filter(({ operationRole = '' } = {}) => (
        operationRole === 'dynamic-arguments-loop'
    ));
    const [loopEntry = {}] = collectDestructuringAgreements({
        indexedOperationContracts: contracts
    }).get(loopFact.sourceRange) || [];

    assert.ok(loopFact.loopRange);
    assert.equal(getDestructuringAgreement({ entry: loopEntry }).action,
        'retain-dynamic-arguments-loop');
    const [firstFact = {}] = argumentFacts;
    const [entry = {}] = collectDestructuringAgreements({
        indexedOperationContracts: contracts
    }).get(firstFact.sourceRange) || [];

    assert.equal(getDestructuringAgreement({ entry }).action, 'retain-dynamic-arguments-read');

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

    const { outputText: sourceJavaScript = '' } = typescript.transpileModule(source, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const importCode = async text => import(`data:text/javascript,${encodeURIComponent(text)}`);
    const sourceModule = await importCode(sourceJavaScript);
    const generatedModule = await importCode(code);
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

    assert.deepEqual(observe(generatedModule), observe(sourceModule));

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
    const [mutateEntry = {}] = collectDestructuringAgreements({
        typescript, aritySignatureContracts: new Map([...arityFacts].filter(([, { sourceName = '' } = {}] = []) => (
            sourceName === 'mutate'
        )))
    }).get(mutateFact.sourceRange) || [];

    assert.equal(mutateParameter.mutable, true, 'Understand records reassignment before the formal is replaced.');
    assert.ok(mutateParameter.writeRanges.length);
    assert.equal(getDestructuringAgreement({ entry: mutateEntry }).action, 'retain-source-arity');

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
            const failure = new Error('iterator acquired');
            const iterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
            const inherited = Object.getOwnPropertyDescriptor(Array.prototype, '0');
            Object.defineProperty(Array.prototype, Symbol.iterator, { configurable: true, get() { throw failure; } });
            Object.defineProperty(Array.prototype, '0', { configurable: true, get() { throw failure; } });
            try {
                const first = function first() {};
                return JSON.stringify({
                    mutateOmitted: namespace.mutate(first),
                    mutatePresent: namespace.mutate(first, function second() {}),
                    fall: namespace.fall(first, function second() {}),
                    omitted: namespace.explicit(first),
                    explicit: namespace.explicit(first, undefined),
                    lengths: namespace.lengths
                });
            } finally {
                Object.defineProperty(Array.prototype, Symbol.iterator, iterator);
                if (inherited) Object.defineProperty(Array.prototype, '0', inherited);
                else delete Array.prototype[0];
            }
        }` });
    };

    assert.equal(executeArity(arityCode), executeArity(aritySource),
        'Source and lowered arity preserve writes, arguments count, fallthrough, absence, explicit undefined and length.');

    const privateFile = path.join(directory, 'private-arity.ts');
    const privateSource = [
        'const expression = function(first: Function, second?: Function, third?: Function) {',
        '    switch (arguments.length) {',
        '        case 2: second = first;',
        '        case 3: return [second === first, third];',
        '        default: return [first, first];',
        '    }',
        '};',
        'function declaration(first: Function, second?: Function) {',
        '    switch (arguments.length) { case 2: return second; default: return first; }',
        '}',
        'function overwritten(first: Function, second?: Function) {',
        '    arguments.length = 1;',
        '    switch (arguments.length) {',
        '        case 1:',
        '        case 2: return second;',
        '        default: return first;',
        '    }',
        '}',
        'function accessor(first: Function, second?: Function) {',
        '    let reads = 0;',
        '    Object.defineProperty(arguments, "length", { get() { reads += 1; return 2; } });',
        '    switch (arguments.length) { case 2: return [second, reads]; default: return [first, reads]; }',
        '}',
        'export const results = [',
        '    expression(function first() {}),',
        '    expression(function first() {}, undefined),',
        '    expression(function first() {}, function second() {}, undefined),',
        '    declaration(function first() {}, function second() {}),',
        '    overwritten(function first() {}, function second() {}),',
        '    accessor(function first() {}, function second() {})',
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
    const privateDecisions = collectDestructuringAgreements({
        typescript,
        aritySignatureContracts: privateFacts,
        nativeFunctionContracts: collectNativeFunctionContracts({
            typescript, sourceFile: privateProgram.getSourceFile(privateFile), checker: privateProgram.getTypeChecker()
        })
    });
    const { code: privateCode = '', diagnostics: privateDiagnostics = [] } = createTypeScriptTransformer({
        typescript, program: privateProgram
    }).transform({ code: privateSource, fileName: privateFile });

    assert.deepEqual(privateDiagnostics, []);
    assert.equal([...privateFacts.values()].filter(({ privateFunction = false } = {}) => privateFunction).length, 4);
    assert.deepEqual([...privateFacts.keys()].map((key) => {
        const [entry = {}] = privateDecisions.get(key) || [];

        return getDestructuringAgreement({ entry }).action;
    }), ['lower-arity-from-source-facts', 'lower-arity-from-source-facts',
        'lower-arity-from-source-facts', 'lower-arity-from-source-facts']);
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
            const { sourceRange = '', nativeCallableParameters = true } = fact;
            const [entry = {}] = collectDestructuringAgreements({
                typescript, aritySignatureContracts: rejectedArityFacts
            }).get(sourceRange) || [];

            assert.equal(nativeCallableParameters, false);
            assert.equal(getDestructuringAgreement({ entry }).action, 'retain-source-arity');

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
        '    function combine(enabled: boolean) { if (enabled) return 1; return []; }',
        '    void combine;',
        '    return right === undefined ? next => record(left, next) : record(left, right);',
        '}',
        'export function irregular(left: number): () => number[];',
        'export function irregular(left: number, right: number): number[];',
        'export function irregular(left: number, right?: number): number[] | (() => number[]) {',
        '    if (right === undefined) return () => [left];',
        '    if (left > 0) return () => [right];',
        '    return [left, right];',
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
        { ruleId: 'resilient/signature-contract-return-consistency', message: 'This function returns array, but another return path produces function.' }
    ]));
});
