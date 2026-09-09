import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ESLint } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { getDestructuringAgreement } from '../transforms/typescript/policy/defaults.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import {
    collectDeclaredNullishResultContracts
} from '../transforms/typescript/understand/type-evidence.js';

const directory = await mkdtemp(path.join(tmpdir(), 'resilient-nullish-result-'));

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

    assert.equal(facts.size, 4);
    assert.deepEqual([...facts.values()].map(({ result = '' } = {}) => result).toSorted(),
        ['undefined', 'undefined', 'undefined', 'null'].toSorted());
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
        assert.equal(errorCount, 0, `${JSON.stringify(messages)}\n${generated.code}`);
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
    const referenceFile = path.join(directory, 'reference.mjs');
    const generatedFile = path.join(directory, 'generated.mjs');

    await writeFile(referenceFile, referenceCode);
    await writeFile(generatedFile, generated.code);
    const reference = await import(pathToFileURL(referenceFile).href);
    const output = await import(pathToFileURL(generatedFile).href);

    assert.equal(output.unit.apply(), reference.unit.apply());
    assert.equal(output.unit.apply.length, reference.unit.apply.length);
    assert.equal(output.explicit(), reference.explicit());
    assert.equal(output.maybe(true), reference.maybe(true));
    assert.equal(output.maybe(false), reference.maybe(false));
    assert.equal(output.nullable(), reference.nullable());
} finally {
    await rm(directory, { recursive: true, force: true });
}
