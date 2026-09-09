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
    collectLiveArrayVisitationContracts
} from '../transforms/typescript/understand/type-evidence.js';

const directory = await mkdtemp(path.join(tmpdir(), 'resilient-array-visitation-'));
const fileName = path.join(directory, 'visitation.ts');
const source = [
    'export const countUntil = (values: ReadonlyArray<number>, stop: (value: number) => boolean) => {',
    '    let count = 0;',
    '    for (const value of values) {',
    '        count += 1;',
    '        if (stop(value)) break;',
    '    }',
    '    return count;',
    '};',
    ''
].join('\n');

try {
    await writeFile(fileName, source);
    const program = typescript.createProgram([fileName], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
    });
    const facts = collectLiveArrayVisitationContracts({
        typescript, sourceFile: program.getSourceFile(fileName), checker: program.getTypeChecker()
    });
    const [fact = {}] = [...facts.values()];
    const [entry = {}] = collectDestructuringAgreements({
        liveArrayVisitationContracts: facts
    }).get(fact.loopRange) || [];

    assert.equal(facts.size, 1);
    assert.equal(getDestructuringAgreement({ entry }).action, 'retain-live-array-visitation');

    const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
        code: source, fileName
    });

    assert.deepEqual(diagnostics, []);
    assert.match(code, /for \(const value of values\)/);
    assert.match(code, /eslint-disable-next-line resilient\/prefer-prototype-methods -- Array for-of/);
    assert.doesNotMatch(code, /Array\.from\(values\)|values\.(?:forEach|some|reduce)\(/);

    const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
    const [raw = {}] = await new ESLint({ overrideConfigFile: true,
        overrideConfig: config }).lintText(code, { filePath: 'array-visitation-generated.js' });
    const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
        overrideConfig: config }).lintText(code, { filePath: 'array-visitation-generated.js' });

    assert.equal(raw.errorCount, 0, JSON.stringify(raw.messages));
    assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));

    const { outputText: referenceCode = '' } = typescript.transpileModule(source, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const { countUntil: sourceCount = false } = await import(
        `data:text/javascript,${encodeURIComponent(referenceCode)}`
    );
    const { countUntil: loweredCount = false } = await import(
        `data:text/javascript,${encodeURIComponent(code)}`
    );
    const observe = (consumer) => {
        let visits = [];
        const values = Object.defineProperties(Array(3), {
            1: { value: 0 }, 2: { value: 2 }
        });
        const count = consumer(values, (value) => {
            visits = [...visits, value];

            return value === 0;
        });

        return { count, visits };
    };

    assert.deepEqual(observe(loweredCount), observe(sourceCount));
    assert.deepEqual(observe(loweredCount), { count: 2, visits: [undefined, 0] });

    const sideEffectSource = [
        'export const notify = (values: number[], visit: (value: number) => void) => {',
        '    for (const value of values) visit(value);',
        '};',
        'export const notifyEntries = (record: Record<string, number>,',
        '    visit: (key: string, value: number) => void) => {',
        '    for (const [key, value] of Object.entries(record)) visit(key, value);',
        '};',
        'export const notifyPairs = (pairs: Array<[string, number]>,',
        '    visit: (key: string, value: number) => void) => {',
        '    for (const [key, value] of pairs) visit(key, value);',
        '};',
        ''
    ].join('\n');
    const sideEffectFile = path.join(directory, 'side-effects.ts');

    await writeFile(sideEffectFile, sideEffectSource);
    const sideEffectProgram = typescript.createProgram([sideEffectFile], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
    });
    const sideEffectFacts = collectLiveArrayVisitationContracts({
        typescript,
        sourceFile: sideEffectProgram.getSourceFile(sideEffectFile),
        checker: sideEffectProgram.getTypeChecker()
    });

    assert.equal(sideEffectFacts.size, 3);
    const sideEffectAgreements = collectDestructuringAgreements({
        liveArrayVisitationContracts: sideEffectFacts
    });

    assert.ok([...sideEffectFacts.keys()].every((key) => {
        const [entry = {}] = sideEffectAgreements.get(key) || [];

        return getDestructuringAgreement({ entry }).action === 'retain-live-array-visitation';
    }));
    const sideEffectResult = createTypeScriptTransformer({
        typescript, program: sideEffectProgram
    }).transform({ code: sideEffectSource, fileName: sideEffectFile });

    assert.deepEqual(sideEffectResult.diagnostics, []);
    assert.match(sideEffectResult.code, /for \(const value of values\)/);
    assert.match(sideEffectResult.code, /for \(const \[key, value\] of Object\.entries\(record\)\)/);
    assert.doesNotMatch(sideEffectResult.code, /\.forEach\(|\[key =/);
    const [sideEffectRaw = {}] = await new ESLint({ overrideConfigFile: true,
        overrideConfig: config }).lintText(sideEffectResult.code, { filePath: 'side-effects-generated.js' });
    const [sideEffectFixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
        overrideConfig: config }).lintText(sideEffectResult.code, { filePath: 'side-effects-generated.js' });

    assert.equal(sideEffectRaw.errorCount, 0, JSON.stringify(sideEffectRaw.messages));
    assert.equal(sideEffectFixed.errorCount, 0, JSON.stringify(sideEffectFixed.messages));
    const { outputText: sideEffectReference = '' } = typescript.transpileModule(sideEffectSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const baselineSideEffects = await import(`data:text/javascript,${encodeURIComponent(sideEffectReference)}`);
    const loweredSideEffects = await import(`data:text/javascript,${encodeURIComponent(sideEffectResult.code)}`);
    const observeSideEffects = (notify) => {
        const values = Object.defineProperties([1, 2], {
            forEach: { value: () => { throw new Error('forEach is not the iterator'); } },
            [Symbol.iterator]: { value: function* () { yield 0; yield 3; } }
        });
        let visits = [];

        notify(values, (value) => { visits = [...visits, value]; });

        return visits;
    };

    assert.deepEqual(observeSideEffects(loweredSideEffects.notify),
        observeSideEffects(baselineSideEffects.notify));
    const observeEntries = (notifyEntries) => {
        let seen = [];

        notifyEntries({ zero: 0, falsey: false }, (key, value) => {
            seen = [...seen, [key, value]];
        });

        return seen;
    };

    assert.deepEqual(observeEntries(loweredSideEffects.notifyEntries),
        observeEntries(baselineSideEffects.notifyEntries));
    const visit = () => { throw new Error('callback must not run'); };

    assert.throws(() => baselineSideEffects.notifyPairs([undefined], visit), TypeError);
    assert.throws(() => loweredSideEffects.notifyPairs([undefined], visit), TypeError);

    const accumulatorSource = [
        'export const select = (values: number[], record: (event: string) => boolean) => {',
        '    const output: number[] = [];',
        '    for (const value of values) {',
        '        if (record(`guard:${value}`) || value > 0) {',
        '            output.push((record(`value:${value}`), value * 2));',
        '        }',
        '    }',
        '    return output;',
        '};',
        'export const group = (values: string[]) => {',
        '    const output: Record<string, string[]> = {};',
        '    for (const value of values) {',
        '        const key = String(value.length);',
        '        if (output[key]) {',
        '            output[key].push(value);',
        '        } else {',
        '            output[key] = [value];',
        '        }',
        '    }',
        '    return output;',
        '};',
        ''
    ].join('\n');
    const accumulatorFile = path.join(directory, 'accumulator.ts');

    await writeFile(accumulatorFile, accumulatorSource);
    const accumulatorProgram = typescript.createProgram([accumulatorFile], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
    });
    const accumulatorFacts = collectLiveArrayVisitationContracts({
        typescript,
        sourceFile: accumulatorProgram.getSourceFile(accumulatorFile),
        checker: accumulatorProgram.getTypeChecker()
    });

    assert.equal(accumulatorFacts.size, 2);
    assert.ok([...accumulatorFacts.values()].every(({ mutationBoundary = false } = {}) => mutationBoundary));
    const accumulatorResult = createTypeScriptTransformer({
        typescript, program: accumulatorProgram
    }).transform({ code: accumulatorSource, fileName: accumulatorFile });

    assert.deepEqual(accumulatorResult.diagnostics, []);
    assert.match(accumulatorResult.code, /for \(const value of values\)/);
    assert.match(accumulatorResult.code,
        /eslint-disable resilient\/prefer-safe-transformations -- Fresh accumulator identity remains source-owned\./);
    assert.match(accumulatorResult.code, /eslint-enable resilient\/prefer-safe-transformations/);
    assert.doesNotMatch(accumulatorResult.code, /Array\.from\(values\)|\.filter\(|\.map\(/);
    const [accumulatorRaw = {}] = await new ESLint({ overrideConfigFile: true,
        overrideConfig: config }).lintText(accumulatorResult.code, { filePath: 'accumulator-generated.js' });
    const [accumulatorFixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
        overrideConfig: config }).lintText(accumulatorResult.code, { filePath: 'accumulator-generated.js' });

    assert.equal(accumulatorRaw.errorCount, 0, JSON.stringify(accumulatorRaw.messages));
    assert.equal(accumulatorFixed.errorCount, 0, JSON.stringify(accumulatorFixed.messages));
    const { outputText: accumulatorReference = '' } = typescript.transpileModule(accumulatorSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const baselineAccumulator = await import(`data:text/javascript,${encodeURIComponent(accumulatorReference)}`);
    const loweredAccumulator = await import(`data:text/javascript,${encodeURIComponent(accumulatorResult.code)}`);
    const observeAccumulator = (select) => {
        let events = [];
        const values = Object.defineProperty([1, 2], Symbol.iterator, {
            value: function* () { yield 2; yield 1; }
        });
        const output = select(values, (event) => {
            events = [...events, event];

            return false;
        });

        return { events, output };
    };

    assert.deepEqual(observeAccumulator(loweredAccumulator.select),
        observeAccumulator(baselineAccumulator.select));
    assert.deepEqual(loweredAccumulator.group(['a', 'b', 'ab']),
        baselineAccumulator.group(['a', 'b', 'ab']));

    const rejectedMutationSource = [
        'export const mutateInput = (values: number[]) => {',
        '    for (const value of values) values.push(value);',
        '};',
        'export const mutateNested = (values: number[]) => {',
        '    const output: number[] = [];',
        '    for (const value of values) (() => output.push(value))();',
        '    return output;',
        '};',
        ''
    ].join('\n');
    const rejectedMutationFile = path.join(directory, 'rejected-mutation.ts');

    await writeFile(rejectedMutationFile, rejectedMutationSource);
    const rejectedMutationProgram = typescript.createProgram([rejectedMutationFile], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
    });
    const rejectedMutationFacts = collectLiveArrayVisitationContracts({
        typescript,
        sourceFile: rejectedMutationProgram.getSourceFile(rejectedMutationFile),
        checker: rejectedMutationProgram.getTypeChecker()
    });

    assert.equal(rejectedMutationFacts.size, 2);
    assert.ok([...rejectedMutationFacts.values()].every(({ mutationBoundary = true } = {}) => !mutationBoundary));
    const rejectedMutationResult = createTypeScriptTransformer({
        typescript, program: rejectedMutationProgram
    }).transform({ code: rejectedMutationSource, fileName: rejectedMutationFile });

    assert.doesNotMatch(rejectedMutationResult.code, /eslint-disable resilient\/prefer-safe-transformations/);
    const [rejectedMutationLint = {}] = await new ESLint({ overrideConfigFile: true,
        overrideConfig: config }).lintText(rejectedMutationResult.code, { filePath: 'rejected-mutation-generated.js' });
    const rejectedSafety = rejectedMutationLint.messages.filter(({ ruleId = '' } = {}) => (
        ruleId === 'resilient/prefer-safe-transformations'
    ));

    assert.equal(rejectedSafety.length, 2, JSON.stringify(rejectedMutationLint.messages));

    const reject = async (name, rejectedSource) => {
        const rejectedFile = path.join(directory, `${name}.ts`);
        await writeFile(rejectedFile, rejectedSource);
        const rejectedProgram = typescript.createProgram([rejectedFile], {
            module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
        });

        assert.equal(collectLiveArrayVisitationContracts({
            typescript, sourceFile: rejectedProgram.getSourceFile(rejectedFile),
            checker: rejectedProgram.getTypeChecker()
        }).size, 0);
    };

    await reject('custom', source.replace('ReadonlyArray<number>', 'Iterable<number>'));
    await reject('async', source.replace('for (const value of values)', 'for await (const value of values)'));
} finally {
    await rm(directory, { recursive: true, force: true });
}
