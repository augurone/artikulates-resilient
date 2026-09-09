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
    collectSamePhaseSelectedBindingContracts
} from '../transforms/typescript/understand/type-evidence.js';

const directory = await mkdtemp(path.join(tmpdir(), 'resilient-same-phase-selection-'));
const fileName = path.join(directory, 'selection.ts');
const source = [
    'export const mutable = (source: { value?: number }) => {',
    '    const undefined = 99;',
    '    const holder = source;',
    '    let current = holder.value;',
    '    current = current === void 0 ? 0 : current + 1;',
    '    return [current, undefined];',
    '};',
    'export const guarded = (source: { right?: number }, enabled: boolean) => {',
    '    if (enabled) {',
    '        const chosen = source.right;',
    '        return chosen;',
    '    }',
    '    return 0;',
    '};',
    'export const nested = (source: { inner: { value: number } }) => {',
    '    const holder = source;',
    '    const selected = holder.inner.value;',
    '    return selected;',
    '};',
    'export const has = Object.prototype.hasOwnProperty;',
    ''
].join('\n');

try {
    await writeFile(fileName, source);
    const program = typescript.createProgram([fileName], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const contracts = collectSamePhaseSelectedBindingContracts({
        typescript, sourceFile: program.getSourceFile(fileName), checker: program.getTypeChecker()
    });
    const [fact = {}] = [...contracts.values()];

    assert.equal(contracts.size, 4);
    assert.equal(fact.operationRole, 'same-phase-selected-binding');
    assert.match(fact.receiverRange, /^\d+:\d+$/);
    const [entry = {}] = collectDestructuringAgreements({
        samePhaseSelectedBindingContracts: contracts
    }).get(fact.sourceRange) || [];

    assert.equal(getDestructuringAgreement({ entry }).action, 'bind-at-source-phase');

    const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
        code: source, fileName
    });

    assert.deepEqual(diagnostics, []);
    assert.match(code, /\{ value: current = void 0 \} = holder/);
    assert.match(code, /\{ right: chosen = void 0 \} = source/);
    assert.match(code, /\{ inner: \{ value: selected = void 0 \} \} = holder/);
    assert.match(code, /\{ prototype: \{ hasOwnProperty: has = void 0 \} \} = Object/);
    assert.doesNotMatch(code, /source\.value|source\.right|Object\.prototype\.hasOwnProperty/);

    const eslintConfig = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
    const [raw = {}] = await new ESLint({ overrideConfigFile: true,
        overrideConfig: eslintConfig }).lintText(code, { filePath: 'selection-generated.js' });
    const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
        overrideConfig: eslintConfig }).lintText(code, { filePath: 'selection-generated.js' });

    assert.equal(raw.messages.filter(({ ruleId = '' } = {}) => (
        ruleId !== 'padding-line-between-statements'
    )).length, 0, JSON.stringify({ messages: raw.messages, code }));
    assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));

    const { outputText: sourceJavaScript = '' } = typescript.transpileModule(source, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const importCode = async text => import(`data:text/javascript,${encodeURIComponent(text)}`);
    const sourceModule = await importCode(sourceJavaScript);
    const generatedModule = await importCode(code);
    const observe = (module) => {
        let gets = 0;
        const input = {
            get value() {
                gets += 1;

                return 7;
            },
            get right() {
                gets += 1;

                return 7;
            }
        };
        const skipped = module.guarded(input, false);
        const before = gets;
        const selected = module.guarded(input, true);
        const mutable = module.mutable(input);

        return { skipped, before, selected, mutable, gets };
    };

    assert.deepEqual(observe(generatedModule), observe(sourceModule));
    assert.equal(generatedModule.has, sourceModule.has);
    assert.deepEqual(generatedModule.mutable({}), sourceModule.mutable({}));
    assert.equal(generatedModule.nested({ inner: { value: 5 } }), sourceModule.nested({ inner: { value: 5 } }));
    assert.throws(() => sourceModule.nested({}), TypeError);
    assert.throws(() => generatedModule.nested({}), TypeError);
    assert.throws(() => sourceModule.mutable(null), TypeError);
    assert.throws(() => generatedModule.mutable(null), TypeError);

    const rejectedFile = path.join(directory, 'rejected.ts');
    const rejectedSource = [
        'export const optional = (source?: { value?: number }) => {',
        '    const selected = source?.value;',
        '    return selected;',
        '};',
        'export const cardinality = (values: number[]) => {',
        '    const count = values.length;',
        '    return count;',
        '};',
        'export const signatureOwned = (source: { nested: { value: number } }) => {',
        '    const chosen = source.nested.value;',
        '    return chosen;',
        '};',
        ''
    ].join('\n');

    await writeFile(rejectedFile, rejectedSource);
    const rejectedProgram = typescript.createProgram([rejectedFile], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext
    });

    assert.equal(collectSamePhaseSelectedBindingContracts({
        typescript, sourceFile: rejectedProgram.getSourceFile(rejectedFile),
        checker: rejectedProgram.getTypeChecker()
    }).size, 0);
} finally {
    await rm(directory, { recursive: true, force: true });
}
