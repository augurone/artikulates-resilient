import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ESLint } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { getDestructuringAgreement } from '../transforms/typescript/policy/defaults.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import {
    collectDeclarationLifetimeContracts,
    collectHoistedFunctionContracts,
    collectNativeFunctionContracts
} from '../transforms/typescript/understand/type-evidence.js';

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

    assert.equal(cycles.length, 2);
    assert.equal(cycles[0].forwardReturnRanges.length, 1);
    assert.equal(cycles[1].forwardReturnRanges.length, 0);
    assert.equal([...contracts.values()].filter(({ action = '' } = {}) => action === 'retain-hoisted-reference').length >= 2, true);
    cycles.forEach(({ sourceRange = '' } = {}) => {
        const [entry = {}] = collectDestructuringAgreements({ hoistedFunctionContracts: contracts }).get(sourceRange) || [];

        assert.equal(getDestructuringAgreement({ entry }).action, 'retain-hoisted-function');
    });

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
        const [entry = {}] = collectDestructuringAgreements({ nativeFunctionContracts: nativeContracts }).get(sourceRange) || [];
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
    assert.match(capabilityCode, /const escapes = function escapes/);
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
