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
    collectIndexedOperationContracts
} from '../transforms/typescript/understand/type-evidence.js';

const directory = await mkdtemp(path.join(tmpdir(), 'resilient-indexed-array-loop-'));
const fileName = path.join(directory, 'indexed-array.ts');
const source = [
    'export const firstIndex = (values: ReadonlyArray<number>, predicate: (value: number) => boolean) => {',
    '    for (let i = 0; i < values.length; i += 1) {',
    '        if (predicate(values[i])) return i;',
    '    }',
    '    return -1;',
    '};',
    ''
].join('\n');

try {
    await writeFile(fileName, source);
    const program = typescript.createProgram([fileName], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
    });
    const facts = collectIndexedOperationContracts({
        typescript, sourceFile: program.getSourceFile(fileName), checker: program.getTypeChecker()
    });
    const [loopFact = {}] = [...facts.values()].filter(({ operationRole = '' } = {}) => (
        operationRole === 'indexed-array-traversal'
    ));
    const [entry = {}] = collectDestructuringAgreements({
        indexedOperationContracts: facts
    }).get(loopFact.loopRange) || [];

    assert.ok(loopFact.loopRange);
    assert.equal(getDestructuringAgreement({ entry }).action, 'retain-indexed-array-traversal');

    const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
        code: source, fileName
    });

    assert.deepEqual(diagnostics, []);
    assert.match(code, /for \(let i = 0; i < values\.length; i \+= 1\)/);
    assert.match(code, /eslint-disable-next-line resilient\/prefer-prototype-methods -- Indexed array Gets/);
    assert.doesNotMatch(code, /Array\.from\(values\)|values\.(?:some|find|reduce|forEach)\(/);

    const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
    const [raw = {}] = await new ESLint({ overrideConfigFile: true,
        overrideConfig: config }).lintText(code, { filePath: 'indexed-array-generated.js' });
    const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
        overrideConfig: config }).lintText(code, { filePath: 'indexed-array-generated.js' });

    assert.equal(raw.errorCount, 0, JSON.stringify(raw.messages));
    assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));

    const { outputText: referenceCode = '' } = typescript.transpileModule(source, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const { firstIndex: sourceFirst = false } = await import(
        `data:text/javascript,${encodeURIComponent(referenceCode)}`
    );
    const { firstIndex: loweredFirst = false } = await import(
        `data:text/javascript,${encodeURIComponent(code)}`
    );
    const observe = (consumer) => {
        let visits = [];
        const values = Object.defineProperties(Array(3), {
            1: { value: 0 }, 2: { value: 4 }
        });
        const result = consumer(values, (value) => {
            visits = [...visits, value];

            return value === 4;
        });

        return { result, visits };
    };

    assert.deepEqual(observe(loweredFirst), observe(sourceFirst));
    assert.deepEqual(observe(loweredFirst), { result: 2, visits: [undefined, 0, 4] });

    const tupleSource = source.replace('ReadonlyArray<number>', 'readonly [number, ...number[]]');
    const tupleFile = path.join(directory, 'tuple.ts');
    await writeFile(tupleFile, tupleSource);
    const tupleProgram = typescript.createProgram([tupleFile], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
    });
    const tupleFacts = collectIndexedOperationContracts({
        typescript, sourceFile: tupleProgram.getSourceFile(tupleFile),
        checker: tupleProgram.getTypeChecker()
    });

    assert.equal([...tupleFacts.values()].filter(({ operationRole = '' } = {}) => (
        operationRole === 'indexed-array-traversal'
    )).length, 1);
    const refinedSource = source.replace('ReadonlyArray<number>',
        'ReadonlyArray<number> & { readonly 0: number }');
    const refinedFile = path.join(directory, 'refined.ts');
    await writeFile(refinedFile, refinedSource);
    const refinedProgram = typescript.createProgram([refinedFile], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
    });
    const refinedFacts = collectIndexedOperationContracts({
        typescript, sourceFile: refinedProgram.getSourceFile(refinedFile),
        checker: refinedProgram.getTypeChecker()
    });

    assert.equal([...refinedFacts.values()].filter(({ operationRole = '' } = {}) => (
        operationRole === 'indexed-array-traversal'
    )).length, 1);
    const inheritedSource = `interface NumberList<A> extends Array<A> { readonly 0: A; }\n${source.replace(
        'ReadonlyArray<number>', 'NumberList<number>'
    )}`;
    const inheritedFile = path.join(directory, 'inherited.ts');
    await writeFile(inheritedFile, inheritedSource);
    const inheritedProgram = typescript.createProgram([inheritedFile], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
    });
    const inheritedFacts = collectIndexedOperationContracts({
        typescript, sourceFile: inheritedProgram.getSourceFile(inheritedFile),
        checker: inheritedProgram.getTypeChecker()
    });

    assert.equal([...inheritedFacts.values()].filter(({ operationRole = '' } = {}) => (
        operationRole === 'indexed-array-traversal'
    )).length, 1);
    const mappedSource = source.replace('export const firstIndex =',
        'export const firstIndex = <A extends ReadonlyArray<number>>').replace(
        'ReadonlyArray<number>, predicate', '{ [K in keyof A]: number }, predicate'
    );
    const mappedFile = path.join(directory, 'mapped.ts');
    await writeFile(mappedFile, mappedSource);
    const mappedProgram = typescript.createProgram([mappedFile], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
    });
    const mappedFacts = collectIndexedOperationContracts({
        typescript, sourceFile: mappedProgram.getSourceFile(mappedFile),
        checker: mappedProgram.getTypeChecker()
    });

    assert.equal([...mappedFacts.values()].filter(({ operationRole = '' } = {}) => (
        operationRole === 'indexed-array-traversal'
    )).length, 1);

    const reject = async (name, rejectedSource) => {
        const rejectedFile = path.join(directory, `${name}.ts`);
        await writeFile(rejectedFile, rejectedSource);
        const rejectedProgram = typescript.createProgram([rejectedFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });
        const rejectedFacts = collectIndexedOperationContracts({
            typescript, sourceFile: rejectedProgram.getSourceFile(rejectedFile),
            checker: rejectedProgram.getTypeChecker()
        });

        assert.equal([...rejectedFacts.values()].filter(({ operationRole = '' } = {}) => (
            operationRole === 'indexed-array-traversal'
        )).length, 0);
    };

    await reject('custom', source.replace('ReadonlyArray<number>',
        '{ length: number; [index: number]: number }'));
    await reject('computed', source.replace('values[i]', 'values[i + 0]'));
} finally {
    await rm(directory, { recursive: true, force: true });
}
