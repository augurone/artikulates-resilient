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
    collectDetachedPromiseForwardContracts
} from '../transforms/typescript/understand/type-evidence.js';

const directory = await mkdtemp(path.join(tmpdir(), 'resilient-detached-promise-'));

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

    assert.equal(facts.size, 1);
    const [fact = {}] = facts.values();
    const { sourceRange = '', chainRange = '', ownerRange = '' } = fact;

    assert.ok(sourceRange);
    assert.ok(chainRange);
    assert.ok(ownerRange);
    const agreements = collectDestructuringAgreements({
        typescript,
        detachedPromiseForwardContracts: facts
    });
    const [entry = {}] = agreements.get(sourceRange) || [];
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
    const referenceFile = path.join(directory, 'reference.mjs');
    const generatedFile = path.join(directory, 'generated.mjs');

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
