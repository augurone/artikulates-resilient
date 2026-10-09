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
    collectNumericRangeBuilderContracts
} from '../transforms/typescript/understand/type-evidence.js';

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
    const checker = program.getTypeChecker();
    const facts = collectNumericRangeBuilderContracts({
        typescript, sourceFile: program.getSourceFile(fileName), checker
    });
    const [fact = {}] = [...facts.values()];
    const [entry = {}] = collectDestructuringAgreements({
        numericRangeBuilderContracts: facts
    }).get(fact.loopRange) || [];

    assert.equal(facts.size, 1);
    assert.match(fact.counterRange, /^\d+:\d+$/);
    assert.match(fact.updateRange, /^\d+:\d+$/);
    assert.equal(getDestructuringAgreement({ entry }).action, 'retain-numeric-range-builder');

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
