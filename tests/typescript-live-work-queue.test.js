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
    collectLiveWorkQueueContracts
} from '../transforms/typescript/understand/type-evidence.js';

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
    const [fact = {}] = [...contracts.values()];
    const [entry = {}] = collectDestructuringAgreements({
        collectionReconstructionContracts: contracts
    }).get(fact.sourceRange) || [];

    assert.equal(fact.operationRole, 'live-work-queue');
    assert.match(fact.loopRange, /^\d+:\d+$/);
    assert.equal(getDestructuringAgreement({ entry }).action, 'operational-work-queue');

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
