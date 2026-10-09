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
    collectLoopCarriedRecurrenceContracts
} from '../transforms/typescript/understand/type-evidence.js';

const directory = await mkdtemp(path.join(tmpdir(), 'resilient-recurrence-'));
const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
const prove = async (name, source, exportName, observe) => {
    const fileName = path.join(directory, `${name}.ts`);
    await writeFile(fileName, source);
    const program = typescript.createProgram([fileName], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
    });
    const facts = collectLoopCarriedRecurrenceContracts({
        typescript, sourceFile: program.getSourceFile(fileName), checker: program.getTypeChecker()
    });
    const [fact = {}] = [...facts.values()];
    const { loopRange = '', updateRange = '' } = fact;
    const [entry = {}] = collectDestructuringAgreements({
        loopCarriedRecurrenceContracts: facts
    }).get(loopRange) || [];

    assert.equal(facts.size, 1);
    assert.ok(updateRange);
    const { action = '' } = getDestructuringAgreement({ entry });

    assert.equal(action, 'retain-loop-carried-recurrence');

    const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
        code: source, fileName
    });

    assert.deepEqual(diagnostics, []);
    assert.match(code, /eslint-disable-next-line resilient\/prefer-prototype-methods -- Loop-carried state/);
    assert.doesNotMatch(code, /\.reduce\(|Array\.from\(/);
    const [raw = {}] = await new ESLint({ overrideConfigFile: true,
        overrideConfig: config }).lintText(code, { filePath: `${name}-generated.js` });
    const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
        overrideConfig: config }).lintText(code, { filePath: `${name}-generated.js` });
    const { errorCount: rawErrors = 0, messages: rawMessages = [] } = raw;
    const { errorCount: fixedErrors = 0, messages: fixedMessages = [] } = fixed;

    assert.equal(rawErrors, 0, JSON.stringify(rawMessages));
    assert.equal(fixedErrors, 0, JSON.stringify(fixedMessages));

    const { outputText: referenceCode = '' } = typescript.transpileModule(source, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const baseline = await import(`data:text/javascript,${encodeURIComponent(referenceCode)}`);
    const lowered = await import(`data:text/javascript,${encodeURIComponent(code)}`);
    const { [exportName]: baselineConsumer = false } = baseline;
    const { [exportName]: loweredConsumer = false } = lowered;

    assert.deepEqual(observe(loweredConsumer), observe(baselineConsumer));
};

try {
    await prove('open', [
        'export const chase = (start: number, step: (value: number) => number) => {',
        '    let state = start;',
        '    let calls = 0;',
        '    while (true) {',
        '        state = step(state);',
        '        calls += 1;',
        '        if (state < 0) break;',
        '    }',
        '    return [state, calls];',
        '};',
        ''
    ].join('\n'), 'chase', (chase) => {
        let calls = 0;
        const result = chase(1, (value) => {
            calls += 1;

            return value < 3 ? value + 1 : -1;
        });

        return { result, calls };
    });
    await prove('guarded', [
        'export const sum = (start: number, accept: (value: number) => boolean,',
        '    advance: (value: number) => number) => {',
        '    let next = start;',
        '    let total = 0;',
        '    while (accept(next)) {',
        '        total += next;',
        '        next = advance(next);',
        '    }',
        '    return total;',
        '};',
        ''
    ].join('\n'), 'sum', sum => sum(1, value => value < 4, value => value + 1));
    await prove('tagged', [
        'type Step = { _tag: "Left"; left: number } | { _tag: "Right"; right: number };',
        'export const tail = (start: number, f: (value: number) => Step) => {',
        '    let result = f(start);',
        '    while (result._tag === "Left") {',
        '        result = f(result.left);',
        '    }',
        '    return result.right;',
        '};',
        ''
    ].join('\n'), 'tail', tail => tail(1, value => value < 3
        ? { _tag: 'Left', left: value + 1 }
        : { _tag: 'Right', right: value }));

    const rejectedFile = path.join(directory, 'rejected.ts');
    await writeFile(rejectedFile,
        'export const spin = (stop: () => boolean) => { while (true) { if (stop()) break; } };');
    const rejectedProgram = typescript.createProgram([rejectedFile], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
    });

    assert.equal(collectLoopCarriedRecurrenceContracts({
        typescript, sourceFile: rejectedProgram.getSourceFile(rejectedFile),
        checker: rejectedProgram.getTypeChecker()
    }).size, 0);
} finally {
    await rm(directory, { recursive: true, force: true });
}
