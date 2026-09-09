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
    collectDeferredSignatureSelectionContracts
} from '../transforms/typescript/understand/type-evidence.js';

const directory = await mkdtemp(path.join(tmpdir(), 'resilient-deferred-signature-'));
const fileName = path.join(directory, 'comparison.ts');
const source = [
    "type Variant = { _tag: 'Present'; value: number } | { _tag: 'Missing' };",
    "export const isObject = (input: unknown): input is object => typeof input === 'object' && input !== null;",
    "export const isPresent = (value: Variant): value is Extract<Variant, { _tag: 'Present' }> => value._tag === 'Present';",
    'export const compare = (x: Variant, y: Variant) =>',
    '    x === y ? 0 : isPresent(x) ? (isPresent(y) ? x.value - y.value : 1) : isPresent(y) ? -1 : 0;',
    ''
].join('\n');

try {
    await writeFile(fileName, source);
    const program = typescript.createProgram([fileName], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
    });
    const contracts = collectDeferredSignatureSelectionContracts({
        typescript, sourceFile: program.getSourceFile(fileName), checker: program.getTypeChecker()
    });
    const [fact = {}] = [...contracts.values()];

    assert.equal(contracts.size, 1);
    assert.equal(fact.parameter, 'y');
    assert.equal(fact.readRanges.length, 2);
    const [entry = {}] = collectDestructuringAgreements({
        deferredSignatureSelectionContracts: contracts
    }).get(fact.sourceRange) || [];

    assert.equal(getDestructuringAgreement({ entry }).action, 'retain-deferred-signature-selection');

    const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
        code: source, fileName
    });

    assert.deepEqual(diagnostics, []);
    assert.match(code, /const \{ _tag: yTag/);
    assert.doesNotMatch(code, /\(\{[^)]*_tag[^)]*\},\s*\{/);

    const eslintConfig = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
    const [raw = {}] = await new ESLint({ overrideConfigFile: true,
        overrideConfig: eslintConfig }).lintText(code, { filePath: 'comparison-generated.js' });
    const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
        overrideConfig: eslintConfig }).lintText(code, { filePath: 'comparison-generated.js' });

    assert.equal(raw.messages.filter(({ ruleId = '' } = {}) => (
        ruleId !== 'padding-line-between-statements'
    )).filter(({ severity = 0 } = {}) => severity === 2).length,
    0, JSON.stringify({ messages: raw.messages, code }));
    assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));

    const { outputText: sourceJavaScript = '' } = typescript.transpileModule(source, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const importCode = async text => import(`data:text/javascript,${encodeURIComponent(text)}`);
    const sourceModule = await importCode(sourceJavaScript);
    const generatedModule = await importCode(code);
    const observe = (module) => {
        let traces = [];
        const input = (name, tag, value) => ({
            get _tag() {
                traces = [...traces, name];

                return tag;
            },
            value
        });
        const present = input('x', 'Present', 3);
        const other = input('y', 'Present', 5);
        const missing = input('m', 'Missing', 0);
        const same = module.compare(present, present);
        const before = [...traces];
        const different = module.compare(present, other);
        const left = module.compare(missing, present);

        return { same, before, different, left, traces };
    };

    assert.deepEqual(observe(generatedModule), observe(sourceModule));

    const rejectedFile = path.join(directory, 'boolean-predicate.ts');
    const rejectedSource = source.replace(
        "value is Extract<Variant, { _tag: 'Present' }>", 'boolean'
    );

    await writeFile(rejectedFile, rejectedSource);
    const rejectedProgram = typescript.createProgram([rejectedFile], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
    });

    assert.equal(collectDeferredSignatureSelectionContracts({
        typescript, sourceFile: rejectedProgram.getSourceFile(rejectedFile),
        checker: rejectedProgram.getTypeChecker()
    }).size, 0);
} finally {
    await rm(directory, { recursive: true, force: true });
}
