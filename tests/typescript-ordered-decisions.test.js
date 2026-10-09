import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ESLint } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { getDestructuringAgreement } from '../transforms/typescript/policy/defaults.js';
import {
    getRuntimeBindingDependencies,
    getRuntimeBindingIdentities,
    getRuntimeBindingNames,
    getCyclicRuntimeBindingNames,
    orderRuntimeBindingStatements,
    placeGeneratedRuntimeStatements
} from '../transforms/typescript/policy/dependencies.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import {
    collectOrderedDecisionContracts
} from '../transforms/typescript/understand/type-evidence.js';

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
    const contracts = collectOrderedDecisionContracts({
        typescript, sourceFile: program.getSourceFile(fileName), checker: program.getTypeChecker()
    });
    const [fact = {}] = [...contracts.values()];
    const [entry = {}] = collectDestructuringAgreements({
        orderedDecisionContracts: contracts
    }).get(fact.sourceRange) || [];

    assert.equal(contracts.size, 1);
    assert.equal(fact.operationRole, 'ordered-decision');
    assert.match(fact.guardRange, /^\d+:\d+$/);
    assert.equal(getDestructuringAgreement({ entry }).action, 'flatten-terminal-guards');

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
        'export const selected = (value: { _tag: string, left: number, right: number }) =>',
        '    value._tag === "Left"',
        '        ? value._tag === "Both" ? value.left : value.right',
        '        : value._tag === "Right" ? value.right : value.left;',
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
    assert.match(nestedCode, /no-nested-if, resilient\/prefer-destructured-member-access -- Nested decision and repeated Get retain branch and getter timing/);

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
    const observeNested = (module, tag, operation) => {
        let trace = '';
        const input = new Proxy({ _tag: tag, left: 0, right: 2 }, {
            get(target, key) {
                if (key !== '_tag') trace += String(key);

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
    });
    ['Left', 'Right', 'Both', 'Other'].forEach((tag) => {
        assert.deepEqual(observeNested(nestedGeneratedModule, tag, 'selected'),
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
