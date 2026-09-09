import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ESLint } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { getDestructuringAgreement } from '../transforms/typescript/policy/defaults.js';
import { getDestructuringDecisionForNode } from '../transforms/typescript/policy/destructuring-agreements.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import {
    collectRepeatedParameterReadContracts,
    getConsumerContractKey
} from '../transforms/typescript/understand/type-evidence.js';

const directory = await mkdtemp(path.join(tmpdir(), 'resilient-repeated-read-'));
const fileName = path.join(directory, 'repeated.ts');
const source = [
    'export const ordered = (value: { x: number }, between: () => number) =>',
    '    value.x + between() + value.x;',
    'export const branch = (value: { x: number }, test: () => boolean) => {',
    '    if (test()) return value.x;',
    '    return value.x;',
    '};',
    'export const selected = (value: { _tag: string }) =>',
    '    value._tag === "Left"',
    '        ? value._tag === "Both"',
    '        : value._tag === "Right";',
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
    const agreements = collectDestructuringAgreements({ repeatedParameterReadContracts: contracts });

    assert.equal(contracts.size, 7);
    [...contracts].forEach(([range = '', fact = {}] = []) => {
        const [entry = {}] = agreements.get(range) || [];
        const { sourceRange = '', readRanges = [] } = fact;

        assert.match(range, /^\d+:\d+$/);
        assert.equal(sourceRange, range);
        assert.ok([2, 3].includes(readRanges.length));
        assert.equal(getDestructuringAgreement({ entry }).action, 'retain-source-phase-read');
    });

    const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
        code: source, fileName
    });

    assert.deepEqual(diagnostics, []);
    assert.match(code, /value\.x \+ between\(\) \+ value\.x/);
    assert.match(code, /value\._tag === "Left"/);
    assert.match(code, /if \(test\(\)\)/);
    assert.match(code, /return value\.x/);
    assert.doesNotMatch(code, /(?:ordered|branch) = \(\{/);
    assert.match(code, /repeated parameter Get retains each getter call at its source phase/);

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
        const value = Object.defineProperty({}, '_tag', { get() {
            const { [reads]: tag = 'Other' } = tags;

            reads += 1;

            return tag;
        } });

        return { result: module.selected(value), reads };
    };

    [['Left', 'Both'], ['Left', 'Other'], ['Other', 'Right'], ['Other', 'Other']]
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

    assert.equal(nestedContracts.size, 2, 'Only the two repeated outer parameter Gets publish source facts.');
    assert.deepEqual(candidateReads.map(node => nestedContracts.has(getConsumerContractKey(node))),
        [false, false, true, true], 'A once-read or shadowed same-name receiver cannot borrow the outer decision.');
    const [, shadowedRead = {}, admittedRead = {}] = candidateReads;
    const admittedClone = typescript.setOriginalNode(typescript.factory.createPropertyAccessExpression('other', 'x'), admittedRead);
    const shadowedClone = typescript.setOriginalNode(typescript.factory.createPropertyAccessExpression('other', 'x'), shadowedRead);
    const decisionFor = node => getDestructuringDecisionForNode({
        typescript, node, destructuringAgreements: compileDestructuringDecisions(nestedAgreements), kinds: ['repeated-parameter-read']
    });

    assert.equal(decisionFor(admittedClone).agreement.action, 'retain-source-phase-read');
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
    const observeNested = ({ nested = false } = {}) => {
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

            return function operation(input) {
                trace = [...trace, this === value ? 'receiver' : 'wrong receiver'];

                return input;
            };
        } });
        Object.defineProperty(value, 'slice', { get() {
            trace = [...trace, 'slice'];

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
