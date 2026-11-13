import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ESLint } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { getObject } from '../analysis/host/object.js';
import { formatResilientOutput } from '../transforms/typescript/grammar/resolvers.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { getDestructuringAgreement } from '../transforms/typescript/policy/defaults.js';
import { getDestructuringDecisionForNode } from '../transforms/typescript/policy/destructuring-agreements.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import {
    collectConsoleEffectContracts,
    collectArityReturnContracts,
    collectSwitchReturnContracts,
    collectNullishEqualityContracts,
    collectOperationalObjectBuilderContracts,
    collectArrayCardinalityContracts,
    collectSelectedModelContracts,
    collectDeferredSelectedPayloadContracts,
    collectDeferredOpaqueFieldContracts,
    collectCurriedSelectedTupleContracts,
    collectReceiverOrderedProjectionContracts,
    collectShortCircuitTupleArgumentContracts,
    collectOrderedNestedTupleReadContracts,
    collectIndexedOperationContracts,
    collectLiveArrayVisitationContracts,
    collectUnusedBindingContracts,
    collectTypedIgnoredArgumentCallContracts,
    collectResolvedSourceCallContracts,
    collectLiveIteratorPayloadContracts,
    collectMutableSelectedLoopContracts,
    collectIndexedLocalSelectionContracts,
    collectRestArraySelectionContracts,
    getConsumerContractKey
} from '../transforms/typescript/understand/type-evidence.js';
import { createFixtureProgram } from './support/typescript-program.js';
import { collectCollectionDecisions } from './typescript-collection-proof.js';

// eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Factory result preserves native container failure; absent methods must fail at their original invocation.
const { analyze, transform } = createTypeScriptTransformer({ typescript });

assert.throws(
    () => createTypeScriptTransformer({
        typescript,
        target: typescript.ScriptTarget.ES2015
    }),
    /ECMAScript 2016 or newer/
);
const source = `
    type User = { name: string; id?: string };
    type UserOrId = User | string;
    const required = (options: User) => User(options);
    const optional = (options?: User) => User(options);
    const render = (value: UserOrId, payload: any) => {
        if (typeof payload === 'string') return resolveUserOrId(value);
        return value;
    };
`;
const result = transform({ code: source, fileName: 'sample.ts' });

const analysis = analyze({ code: source, fileName: 'sample.ts' });
assert.deepEqual(analysis.diagnostics, []);
assert.deepEqual(analysis.contracts.map(({ parameter = '', kind = '', family = '' } = {}) => ({
    parameter,
    kind,
    family
})), [
    { parameter: 'options', kind: 'resolved', family: 'object' },
    { parameter: 'options', kind: 'resolved', family: 'object' },
    { parameter: 'value', kind: 'union', family: 'union' },
    { parameter: 'payload', kind: 'required', family: 'required' }
]);

assert.deepEqual(result.diagnostics, []);
assert.match(result.code, /export const User =/);
assert.match(result.code, /export const resolveUserOrId =/);
assert.match(result.code, /kind: 'object'/);
assert.match(result.code, /kind: 'string'/);
assert.match(result.code, /const required = options =>/);
assert.match(result.code, /const optional = \(options = \{\}\) =>/);
assert.match(result.code, /const \{ name = ['"]['"], id = ['"]['"] \} = isObject\(input\) \? input : \{\};/);
assert.match(result.code, /if \(!name\)/);
assert.match(result.code, /\.\.\.input,/);
assert.doesNotMatch(result.code, /hasOwnProperty/);
assert.doesNotMatch(result.code, /typeof name/);

const loopResult = transform({
    code: [
        'export const collect = (values: number[]) => {',
        '    const output: number[] = [];',
        '    for (const value of values) output.push(value);',
        '    return output;',
        '};',
        ''
    ].join('\n'),
    fileName: 'stateful-loop.ts'
});

assert.deepEqual(loopResult.diagnostics, []);
assert.doesNotMatch(loopResult.code, /eslint-disable-next-line resilient\/prefer-prototype-methods -- Source loop has unproven callback safety or sequential effects\./);

const nestedFunctionResult = transform({
    code: [
        'export const collect = (values: number[]) => {',
        '    const output: number[] = [];',
        '    function append(value: number) { output.push(value); }',
        '    values.forEach(append);',
        '    return output;',
        '};',
        ''
    ].join('\n'),
    fileName: 'nested-function.ts'
});

assert.deepEqual(nestedFunctionResult.diagnostics, []);
assert.match(nestedFunctionResult.code, /function append\(value\)/);

const dynamicFunctionResult = transform({
    code: [
        'export function read(value: string) {',
        '    return this ? arguments[0] : value;',
        '}',
        ''
    ].join('\n'),
    fileName: 'dynamic-function.ts'
});

assert.deepEqual(dynamicFunctionResult.diagnostics, []);
assert.match(dynamicFunctionResult.code, /export function read/);

const standardResult = createTypeScriptTransformer({
    typescript,
    standard: { object: '../analysis/host/object.js' }
}).transform({
    code: 'type User = { name?: string }; export const render = (options?: User) => User(options);',
    fileName: 'standard.ts'
});

assert.match(standardResult.code, /import \{ isObject \} from '..\/analysis\/host\/object\.js';/);
assert.match(standardResult.code, /export const User = \(input\) =>/);
assert.doesNotMatch(standardResult.code, /input = \{\}/);
assert.match(standardResult.code, /const \{ name = '' \} = isObject\(input\) \? input : \{\};/);
assert.match(standardResult.code, /\.\.\.input,/);
assert.doesNotMatch(standardResult.code, /Missing required agreement/);

const outputEslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety]
});
const formattedImport = formatResilientOutput(
    `import { ${Array.from({ length: 20 }, (_, index) => `member${index} as alias${index}`).join(', ')} } from './module';`,
    typescript
);
const formattedExport = formatResilientOutput('export {\n    first,\n    second };', typescript);
const formattedArrow = formatResilientOutput(
    `export const make = (input) => call(${Array.from({ length: 20 }, (_, index) => `input${index}`).join(', ')});`,
    typescript
);

assert.match(formattedImport, /^import \{\n/);
assert.match(formattedImport, /\n\} from '\.\/module';$/);
assert.match(formattedExport, /\n {4}second\n\};$/);
assert.match(formattedArrow, /=> \(\n {4}call\(/);
const { diagnostics: formattedArrowDiagnostics = [] } = typescript.transpileModule(formattedArrow, {
    compilerOptions: { module: typescript.ModuleKind.ESNext }
});

assert.equal(formattedArrowDiagnostics.length, 0);

// Emission layout may move syntax tokens but must never read or rewrite a
// literal, template, regex, or comment payload as if it were program syntax.
const longEmissionValue = 'a'.repeat(185);
const emissionPayloadSource = [
    "export const literalArrow = '(x) => x';",
    "export const literalBlock = 'x => { body }';",
    `export const literalSuffix = '${longEmissionValue} || suffix';`,
    'export const templateValue = `first',
    'return payload',
    'last`;',
    'export const tagged = String.raw`tag ${(value => value)("value")} return payload`;',
    'export const pattern = /\\(x\\) => x/;',
    '// comment with (x) => x and x => { body }',
    ''
].join('\n');
const formattedPayloads = formatResilientOutput(emissionPayloadSource, typescript);

assert.match(formattedPayloads, /literalArrow = '\(x\) => x'/);
assert.match(formattedPayloads, /literalBlock = 'x => \{ body \}'/);
assert.match(formattedPayloads, new RegExp(`literalSuffix\\s*\\n?\\s*=\\s*'${longEmissionValue} \\|\\| suffix'`));
assert.match(formattedPayloads, /templateValue = `first\nreturn payload\nlast`/);
assert.match(formattedPayloads, /String\.raw`tag \$\{\(value => value\)\("value"\)\} return payload`/);
assert.match(formattedPayloads, /pattern = \/\\\(x\\\) => x\//);
assert.match(formattedPayloads, /\/\/ comment with \(x\) => x and x => \{ body \}/);

const emissionResult = transform({ code: emissionPayloadSource, fileName: 'emission-payloads.ts' });

assert.deepEqual(emissionResult.diagnostics, []);
assert.match(emissionResult.code, /literalArrow = '\(x\) => x'/);
assert.match(emissionResult.code, /literalBlock = 'x => \{ body \}'/);
assert.match(emissionResult.code, new RegExp(`literalSuffix\\s*\\n?\\s*=\\s*'${longEmissionValue} \\|\\| suffix'`));
assert.match(emissionResult.code, /templateValue = `first\nreturn payload\nlast`/);
assert.match(emissionResult.code, /pattern = \/\\\(x\\\) => x\//);
const [rawEmissionLint = {}] = await outputEslint.lintText(emissionResult.code, {
    filePath: 'emission-payloads-generated.js'
});
const fixedEmissionEslint = new ESLint({
    fix: true,
    overrideConfigFile: true,
    overrideConfig: [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety]
});
const [{ output: fixedEmissionCode = emissionResult.code } = {}] = await fixedEmissionEslint.lintText(
    emissionResult.code,
    { filePath: 'emission-payloads-generated.js' }
);
const [fixedEmissionLint = {}] = await outputEslint.lintText(fixedEmissionCode, {
    filePath: 'emission-payloads-fixed.js'
});

assert.equal(rawEmissionLint.errorCount, 0, JSON.stringify(rawEmissionLint.messages));
assert.equal(fixedEmissionLint.errorCount, 0, JSON.stringify(fixedEmissionLint.messages));
const { outputText: baselineEmissionCode = '' } = typescript.transpileModule(emissionPayloadSource, {
    compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
});
const importEmission = code => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const [baselineEmission = {}, rawEmission = {}, fixedEmission = {}] = await Promise.all([
    importEmission(baselineEmissionCode),
    importEmission(emissionResult.code),
    importEmission(fixedEmissionCode)
]);
const {
    literalArrow: baselineLiteralArrow = '',
    literalBlock: baselineLiteralBlock = '',
    literalSuffix: baselineLiteralSuffix = '',
    templateValue: baselineTemplateValue = '',
    tagged: baselineTagged = '',
    pattern: baselinePattern = /(?:)/u
} = baselineEmission;
const baselinePatternText = String(baselinePattern);

[rawEmission, fixedEmission].forEach(({
    literalArrow = '', literalBlock = '', literalSuffix = '', templateValue = '', tagged = '', pattern = /(?:)/u
} = {}) => {
    const patternText = String(pattern);

    assert.deepEqual({ literalArrow, literalBlock, literalSuffix, templateValue, tagged, pattern: patternText }, {
        literalArrow: baselineLiteralArrow,
        literalBlock: baselineLiteralBlock,
        literalSuffix: baselineLiteralSuffix,
        templateValue: baselineTemplateValue,
        tagged: baselineTagged,
        pattern: baselinePatternText
    });
});
const [outputLintResult = {}] = await outputEslint.lintText(standardResult.code, { filePath: 'generated.js' });

assert.equal(outputLintResult.errorCount, 0);
assert.equal(outputLintResult.warningCount, 0);

const stagedExactFieldResult = createTypeScriptTransformer({
    typescript,
    standard: { object: '../analysis/host/object.js' }
}).transform({
    code: 'type Box<A> = { baseValue: A }; export const read = <A>(input: Box<A>) => Box(input).baseValue;',
    fileName: 'staged-exact-field.ts'
});

assert.deepEqual(stagedExactFieldResult.diagnostics, []);
assert.match(stagedExactFieldResult.code, /const \{ baseValue = void 0 \} = isObject\(input\) \? input : \{\};/);
assert.doesNotMatch(stagedExactFieldResult.code, /baseValue = \{\}/);
const [stagedExactFieldLint = {}] = await outputEslint.lintText(stagedExactFieldResult.code, {
    filePath: 'staged-exact-field-generated.js'
});

assert.equal(stagedExactFieldLint.errorCount, 0, JSON.stringify(stagedExactFieldLint.messages));

const programDirectory = await mkdtemp(path.join(tmpdir(), 'resilient-typescript-program-'));
const programTypesFile = path.join(programDirectory, 'types.ts');
const programEntryFile = path.join(programDirectory, 'entry.ts');
const programObjectStandard = path.resolve('analysis/host/object.js');
const fixedOptionGuardEslint = new ESLint({
    fix: true,
    overrideConfigFile: true,
    overrideConfig: [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety]
});

const fixedCollectionEslint = new ESLint({
    fix: true,
    overrideConfigFile: true,
    overrideConfig: [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety]
});

try {
    // Runtime fixtures are emitted as ESM and live outside the repository so
    // they cannot become lint targets.  The temporary package boundary keeps
    // their local `.js` imports in the same module mode under every supported
    // Node runtime.
    await writeFile(path.join(programDirectory, 'package.json'), '{"type":"module"}\n');
    await writeFile(programTypesFile, 'export type UserRecord = { id: string; name?: string };\n');
    await writeFile(programEntryFile, [
        "import type { UserRecord } from './types.js';",
        'export const render = (user: UserRecord) => UserRecord(user);',
        ''
    ].join('\n'));
    const program = createFixtureProgram([programTypesFile, programEntryFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext
    });
    const programEntry = await readFile(programEntryFile, 'utf8');
    const programResult = createTypeScriptTransformer({ typescript, program }).transform({
        code: programEntry,
        fileName: programEntryFile
    });

    assert.deepEqual(programResult.diagnostics, []);
    assert.match(programResult.code, /export const UserRecord =/);
    assert.match(programResult.code, /name = ''/);

    const selectedModelFile = path.join(programDirectory, 'selected-model.ts');
    const selectedModelSource = [
        'type Result = { category: "Inbound"; inbound: string } | { category: "Outbound"; outbound: string };',
        'export const read = (result: Result) => {',
        '    if (result.category === "Outbound") return result.outbound;',
        '    return "";',
        '};',
        ''
    ].join('\n');
    await writeFile(selectedModelFile, selectedModelSource);
    const selectedModelResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([selectedModelFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        }),
        standard: { object: programObjectStandard }
    }).transform({
        code: selectedModelSource,
        fileName: selectedModelFile
    });

    assert.deepEqual(selectedModelResult.diagnostics, []);
    assert.match(selectedModelResult.code, /const \{ category: resultCategory = void 0 \} = result;/);
    assert.match(selectedModelResult.code, /if \(resultCategory === ["']Outbound["']\)/);
    assert.match(selectedModelResult.code, /const \{ outbound: resultOutbound = void 0 \} = result;/);
    assert.doesNotMatch(selectedModelResult.code, /result\.category/);
    const [selectedModelLint = {}] = await outputEslint.lintText(selectedModelResult.code, {
        filePath: 'selected-model-generated.js'
    });

    assert.equal(selectedModelLint.errorCount, 0, JSON.stringify(selectedModelLint.messages));
    const selectedModelRuntimeFile = path.join(programDirectory, 'selected-model.js');
    await writeFile(selectedModelRuntimeFile, selectedModelResult.code);
    const { href: selectedModelHref = '' } = pathToFileURL(selectedModelRuntimeFile);
    const { read = false } = await import(selectedModelHref);
    let selectedModelEvents = '';
    const outbound = {
        get category() {
            selectedModelEvents += 'tag:';

            return 'Outbound';
        },
        get outbound() {
            selectedModelEvents += 'outbound';

            return 'value';
        }
    };

    assert.equal(read(outbound), 'value');
    assert.equal(selectedModelEvents, 'tag:outbound');
    assert.equal(read({ category: undefined }), '');
    assert.throws(() => read(null), TypeError);

    const exactProviderFile = path.join(programDirectory, 'exact-provider-forward.ts');
    const exactProviderSource = [
        'interface Capability { collapse: (value: unknown) => unknown; partition: (value: unknown) => unknown; fromReader: (value: unknown) => unknown }',
        'type Mapper = { map: (value: unknown, callback: unknown) => unknown };',
        'type IdentityProvider<A> = { identity: A };',
        'export const collapse = (F: Mapper, G: Capability) => value => F.map(value, G.collapse);',
        'export const getSelectionCapability = (M: IdentityProvider<string>, getCollapseCapability: (value: IdentityProvider<string>) => Capability) => {',
        '    const { collapse, partition } = getCollapseCapability(M);',
        '    return { collapse, partition };',
        '};',
        'export const combineAll = (M: IdentityProvider<string>, identity: boolean) => identity ? M.identity : "value";',
        ''
    ].join('\n');
    await writeFile(exactProviderFile, exactProviderSource);
    const exactProviderResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([exactProviderFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        })
    }).transform({
        code: exactProviderSource,
        fileName: exactProviderFile
    });

    assert.deepEqual(exactProviderResult.diagnostics, []);
    assert.ok(exactProviderResult.agreements.some(({ action = '' } = {}) => action === 'exact-provider-forwarded'),
        JSON.stringify(exactProviderResult.agreements));
    assert.match(exactProviderResult.code, /collapse: GCollapse \}/);
    assert.match(exactProviderResult.code, /collapse, partition/);
    assert.match(exactProviderResult.code, /identity: MIdentity \}/);
    assert.doesNotMatch(exactProviderResult.code, /if \(!isFunction\(collapse\)\) return/);
    assert.doesNotMatch(exactProviderResult.code, /if \(!isFunction\(partition\)\) return/);
    const [exactProviderLint = {}] = await outputEslint.lintText(exactProviderResult.code, {
        filePath: 'exact-provider-forward-generated.js'
    });

    assert.equal(exactProviderLint.errorCount, 0, JSON.stringify(exactProviderLint.messages));

    const selectedCallFile = path.join(programDirectory, 'selected-call.ts');
    const selectedCallSource = [
        'type Result = { category: "Inbound"; inbound: string } | { category: "Outbound"; outbound: string };',
        'const consume = (value: string) => value;',
        'export const readCall = (result: Result) => {',
        '    if (result.category === "Inbound") return "";',
        '    const output = consume(result.outbound);',
        '    return output;',
        '};',
        ''
    ].join('\n');
    await writeFile(selectedCallFile, selectedCallSource);
    const selectedCallResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([selectedCallFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        }),
        standard: { object: programObjectStandard }
    }).transform({
        code: selectedCallSource,
        fileName: selectedCallFile
    });

    assert.deepEqual(selectedCallResult.diagnostics, []);
    assert.match(selectedCallResult.code, /const output = consume\(result\.outbound\);/);
    assert.doesNotMatch(selectedCallResult.code, /const \{ outbound: resultOutbound/);
    const [selectedCallLint = {}] = await outputEslint.lintText(selectedCallResult.code, {
        filePath: 'selected-call-generated.js'
    });

    const selectedCallTargetErrors = selectedCallLint.messages.filter(({ ruleId = '' } = {}) => [
        'resilient/prefer-safe-destructuring-defaults',
        'resilient/prefer-destructured-member-access'
    ].includes(ruleId));

    assert.equal(selectedCallTargetErrors.length, 0, JSON.stringify(selectedCallLint.messages));
    const selectedCallRuntimeFile = path.join(programDirectory, 'selected-call.js');
    await writeFile(selectedCallRuntimeFile, selectedCallResult.code);
    const { href: selectedCallHref = '' } = pathToFileURL(selectedCallRuntimeFile);
    const { readCall = false } = await import(selectedCallHref);
    let selectedCallEvents = '';
    const selectedCallOutbound = {
        get category() {
            selectedCallEvents += 'tag:';

            return 'Outbound';
        },
        get outbound() {
            selectedCallEvents += 'outbound';

            return 'value';
        }
    };

    assert.equal(readCall(selectedCallOutbound), 'value');
    assert.equal(selectedCallEvents, 'tag:outbound');

    const predicateHelperFile = path.join(programDirectory, 'predicate-internal.ts');
    const predicateModelFile = path.join(programDirectory, 'predicate-model.ts');
    const predicateModelSource = [
        "import * as I from './predicate-internal.js';",
        'type Result = { phase: "Stopped"; halted: string } | { phase: "Running"; active: string };',
        'export const collect = (value: Result) => {',
        '    if (I.isStopped(value)) return value;',
        '    const out = [value.active];',
        '    return out;',
        '};',
        ''
    ].join('\n');
    await writeFile(predicateHelperFile, [
        'export const isStopped = (value: unknown): value is { phase: "Stopped"; halted: string } =>',
        "    !!value && typeof value === 'object' && (value as { phase?: string }).phase === 'Stopped';",
        ''
    ].join('\n'));
    await writeFile(predicateModelFile, predicateModelSource);
    const predicateModelResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([predicateHelperFile, predicateModelFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        }),
        standard: { object: programObjectStandard }
    }).transform({
        code: predicateModelSource,
        fileName: predicateModelFile
    });

    assert.deepEqual(predicateModelResult.diagnostics, []);
    assert.match(predicateModelResult.code, /I\.isStopped\(value\)/);
    assert.match(predicateModelResult.code, /const out = \[value\.active\];/);
    assert.doesNotMatch(predicateModelResult.code, /const \{ active: valueActive/);
    const [predicateModelLint = {}] = await outputEslint.lintText(predicateModelResult.code, {
        filePath: 'predicate-model-generated.js'
    });

    assert.equal(
        predicateModelLint.messages.filter(({ ruleId = '' } = {}) => [
            'resilient/prefer-destructured-member-access',
            'resilient/prefer-safe-destructuring-defaults'
        ].includes(ruleId)).length,
        0,
        JSON.stringify(predicateModelLint.messages)
    );
    const predicateModelRuntimeFile = path.join(programDirectory, 'predicate-model.js');
    await writeFile(path.join(programDirectory, 'predicate-internal.js'), typescript.transpileModule(
        await readFile(predicateHelperFile, 'utf8'), { compilerOptions: { module: typescript.ModuleKind.ESNext } }
    ).outputText);
    await writeFile(predicateModelRuntimeFile, predicateModelResult.code);
    const { href: predicateModelHref = '' } = pathToFileURL(predicateModelRuntimeFile);
    const { collect = false } = await import(predicateModelHref);
    let predicateModelEvents = '';
    const selectedOutbound = {
        get phase() {
            predicateModelEvents += 'tag:';

            return 'Running';
        },
        get active() {
            predicateModelEvents += 'outbound';

            return 'value';
        }
    };

    assert.deepEqual(collect(selectedOutbound), ['value']);
    assert.equal(predicateModelEvents, 'tag:outbound');
    assert.throws(() => collect(null), TypeError);

    const loopModelFile = path.join(programDirectory, 'loop-model.ts');
    const loopModelSource = [
        'type Step<A> = { phase: "Continue"; next: A } | { phase: "Done"; result: A };',
        'export const run = <A>(start: A, next: (value: A) => Step<A>): A => {',
        '    let step = next(start);',
        '    while (step.phase === "Continue") {',
        '        step = next(step.next);',
        '    }',
        '    return step.result;',
        '};',
        ''
    ].join('\n');
    await writeFile(loopModelFile, loopModelSource);
    const loopModelResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([loopModelFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        }),
        standard: { object: programObjectStandard }
    }).transform({
        code: loopModelSource,
        fileName: loopModelFile
    });

    assert.deepEqual(loopModelResult.diagnostics, []);
    assert.match(loopModelResult.code, /for \(;;\) \{/);
    assert.match(loopModelResult.code, /const \{ phase: stepPhase = void 0 \} = step;/);
    assert.match(loopModelResult.code, /const \{ next: stepNext = void 0 \} = step;/);
    assert.match(loopModelResult.code, /const \{ result: stepResult = void 0 \} = step;/);
    assert.doesNotMatch(loopModelResult.code, /step\.phase|step\.next/);
    const [loopModelLint = {}] = await outputEslint.lintText(loopModelResult.code, {
        filePath: 'loop-model-generated.js'
    });

    assert.equal(
        loopModelLint.messages.filter(({ ruleId = '' } = {}) => [
            'resilient/prefer-destructured-member-access',
            'resilient/prefer-safe-destructuring-defaults'
        ].includes(ruleId)).length,
        0,
        JSON.stringify(loopModelLint.messages)
    );
    const loopModelRuntimeFile = path.join(programDirectory, 'loop-model.js');
    await writeFile(loopModelRuntimeFile, loopModelResult.code);
    const { href: loopModelHref = '' } = pathToFileURL(loopModelRuntimeFile);
    const { run = false } = await import(loopModelHref);
    let loopEvents = '';
    const continuingStep = {
        get phase() {
            loopEvents += 'tag:';

            return 'Continue';
        },
        get next() {
            loopEvents += 'inbound:';

            return 1;
        }
    };
    const doneStep = {
        get phase() {
            loopEvents += 'tag:';

            return 'Done';
        },
        get result() {
            loopEvents += 'outbound';

            return 2;
        }
    };
    assert.equal(run(0, (value) => {
        loopEvents += `next${value}:`;

        return value ? doneStep : continuingStep;
    }), 2);
    assert.equal(loopEvents, 'next0:tag:inbound:next1:tag:outbound');

    const conditionalModelFile = path.join(programDirectory, 'conditional-model.ts');
    const conditionalModelSource = [
        'type Inner<A> = { phase: "Stopped"; halted: A } | { phase: "Running"; active: A };',
        'export const isStopped = <A>(value: Inner<A>): value is { phase: "Stopped"; halted: A } => value.phase === "Stopped";',
        'export const resolve = <A, B>(value: Inner<A>, f: (input: A) => B): A | B =>',
        '    isStopped(value) ? f(value.halted) : value.active;',
        ''
    ].join('\n');
    await writeFile(conditionalModelFile, conditionalModelSource);
    const conditionalModelResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([conditionalModelFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        }),
        standard: { object: programObjectStandard }
    }).transform({
        code: conditionalModelSource,
        fileName: conditionalModelFile
    });

    assert.deepEqual(conditionalModelResult.diagnostics, []);
    assert.match(conditionalModelResult.code, /return f\(value\.halted\);/);
    assert.match(conditionalModelResult.code, /const \{ active: valueActive = void 0 \} = value;/);
    assert.doesNotMatch(conditionalModelResult.code, /const \{ halted: valueHalted|value\.active/);
    const [conditionalModelLint = {}] = await outputEslint.lintText(conditionalModelResult.code, {
        filePath: 'conditional-model-generated.js'
    });

    assert.equal(
        conditionalModelLint.messages.filter(({ ruleId = '' } = {}) => [
            'resilient/prefer-destructured-member-access',
            'resilient/prefer-safe-destructuring-defaults'
        ].includes(ruleId)).length,
        0,
        JSON.stringify(conditionalModelLint.messages)
    );
    const conditionalModelRuntimeFile = path.join(programDirectory, 'conditional-model.js');
    await writeFile(conditionalModelRuntimeFile, conditionalModelResult.code);
    const { href: conditionalModelHref = '' } = pathToFileURL(conditionalModelRuntimeFile);
    const { resolve = false } = await import(conditionalModelHref);
    let conditionalEvents = '';
    const conditionalStopped = {
        get phase() {
            conditionalEvents += 'tag:';

            return 'Stopped';
        },
        get halted() {
            conditionalEvents += 'inbound';

            return 2;
        }
    };
    const conditionalRunning = {
        get phase() {
            conditionalEvents += 'tag:';

            return 'Running';
        },
        get active() {
            conditionalEvents += 'outbound';

            return 3;
        }
    };

    assert.equal(resolve(conditionalStopped, value => value + 1), 3);
    assert.equal(conditionalEvents, 'tag:inbound');
    conditionalEvents = '';
    assert.equal(resolve(conditionalRunning, value => value + 1), 3);
    assert.equal(conditionalEvents, 'tag:outbound');

    const nestedModelFile = path.join(programDirectory, 'nested-model.ts');
    const nestedModelSource = [
        'type Inner<A> = { status: "BaseValue" } | { status: "Present"; datum: A };',
        'type Outer<A> = { phase: "Halted" } | { phase: "Active"; branch: Inner<A> };',
        'export const read = <A>(input: Outer<A>): A | "" => {',
        '    if (input.phase === "Halted") return "";',
        '    return input.branch.status === "BaseValue" ? "" : input.branch.datum;',
        '};',
        ''
    ].join('\n');
    await writeFile(nestedModelFile, nestedModelSource);
    const nestedProgram = createFixtureProgram([nestedModelFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const nestedModelResult = createTypeScriptTransformer({
        typescript,
        program: nestedProgram,
        standard: { object: programObjectStandard }
    }).transform({
        code: nestedModelSource,
        fileName: nestedModelFile
    });

    assert.deepEqual(nestedModelResult.diagnostics, []);
    assert.match(nestedModelResult.code, /input\.branch\.status === "BaseValue" \? "" : input\.branch\.datum/);
    assert.equal((nestedModelResult.code.match(/input\.branch/gu) || []).length, 2);
    assert.doesNotMatch(nestedModelResult.code, /inputBranch/);
    const [nestedModelLint = {}] = await outputEslint.lintText(nestedModelResult.code, {
        filePath: 'nested-model-generated.js'
    });

    assert.equal(
        nestedModelLint.messages.filter(({ ruleId = '' } = {}) => [
            'resilient/prefer-destructured-member-access',
            'resilient/prefer-safe-destructuring-defaults'
        ].includes(ruleId)).length,
        0,
        JSON.stringify(nestedModelLint.messages)
    );
    const nestedModelRuntimeFile = path.join(programDirectory, 'nested-model.js');
    await writeFile(nestedModelRuntimeFile, nestedModelResult.code);
    const { href: nestedModelHref = '' } = pathToFileURL(nestedModelRuntimeFile);
    const { read: readNested = false } = await import(nestedModelHref);
    let nestedEvents = '';
    const nestedPresent = {
        get phase() {
            nestedEvents += 'outer-tag:';

            return 'Active';
        },
        get branch() {
            nestedEvents += 'outbound:';

            return {
                get status() {
                    nestedEvents += 'inner-tag:';

                    return 'Present';
                },
                get datum() {
                    nestedEvents += 'value';

                    return 2;
                }
            };
        }
    };

    assert.equal(readNested(nestedPresent), 2);
    assert.equal(nestedEvents, 'outer-tag:outbound:inner-tag:outbound:value');

    const terminalVariantFile = path.join(programDirectory, 'terminal-variant.ts');
    const terminalVariantSource = [
        'type Value = { category: "Inbound"; inbound: number } | { category: "Outbound"; outbound: number } | { category: "Combined"; inbound: number; outbound: number };',
        'export const read = (value: Value) => {',
        '    if (value.category === "Inbound") return 0;',
        '    if (value.category === "Outbound") return value.outbound;',
        '    return value.inbound;',
        '};',
        ''
    ].join('\n');
    await writeFile(terminalVariantFile, terminalVariantSource);
    const terminalVariantResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([terminalVariantFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        }),
        standard: { object: programObjectStandard }
    }).transform({
        code: terminalVariantSource,
        fileName: terminalVariantFile
    });

    assert.deepEqual(terminalVariantResult.diagnostics, []);
    assert.match(terminalVariantResult.code, /const \{ inbound: valueInbound = void 0 \} = value;/);
    assert.doesNotMatch(terminalVariantResult.code, /const \{ value: valueInbound \} = value;/);

    const flatTagFile = path.join(programDirectory, 'flat-tag.ts');
    const flatTagSource = [
        'type FlatTag = { category: string; outbound: string };',
        'export const read = (value: FlatTag) => {',
        '    if (value.category === "Outbound") return value.outbound;',
        '    return "";',
        '};',
        ''
    ].join('\n');
    await writeFile(flatTagFile, flatTagSource);
    const flatTagResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([flatTagFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        })
    }).transform({
        code: flatTagSource,
        fileName: flatTagFile
    });

    assert.deepEqual(flatTagResult.diagnostics, []);
    assert.match(flatTagResult.code, /if \(\([\s\S]*?value\.category === ["']Outbound["']\)[\s\S]*?\)\s+[\s\S]*return value\.outbound;/);
    assert.doesNotMatch(flatTagResult.code, /const \{ category: valueCategory/);

    const internalFile = path.join(programDirectory, 'internal.ts');
    const optionGuardFile = path.join(programDirectory, 'option-guard.ts');
    const internalSource = [
        'export type Availability<A> = { category: "Missing" } | { category: "Available"; value: A };',
        'export const isMissing = <A>(value: Availability<A>): value is { category: "Missing" } => value.category === "Missing";',
        'export const isAvailable = <A>(value: Availability<A>): value is { category: "Available"; value: A } => value.category === "Available";',
        ''
    ].join('\n');
    const optionGuardSource = [
        "import * as _ from './internal.js';",
        'export const read = (result: _.Availability<string>) => {',
        '    if (_.isMissing(result)) return "";',
        '    return result.value;',
        '};',
        'export const readPair = (result: _.Availability<[unknown, unknown]>) => {',
        '    if (_.isMissing(result)) return [];',
        '    return [result.value[0], result.value[1]];',
        '};',
        ''
    ].join('\n');
    await writeFile(internalFile, internalSource);
    await writeFile(optionGuardFile, optionGuardSource);
    const optionGuardResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([internalFile, optionGuardFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        }),
        standard: { object: programObjectStandard }
    }).transform({
        code: optionGuardSource,
        fileName: optionGuardFile
    });

    assert.deepEqual(optionGuardResult.diagnostics, []);
    assert.match(optionGuardResult.code, /_\.isMissing\(result\)/);
    assert.doesNotMatch(optionGuardResult.code, /category: resultCategory/);
    assert.match(
        optionGuardResult.code,
        /if \(_\.isMissing\(result\)\)[\s\S]*return ["']{2};[\s\S]*const \{ value: resultValue = void 0 \} = result;/
    );
    assert.ok(
        optionGuardResult.code.indexOf('const { value: resultValue = void 0 } = result;')
            > optionGuardResult.code.indexOf('if (_.isMissing(result))')
    );
    assert.match(
        optionGuardResult.code,
        /return \[result\.value\[0\], result\.value\[1\]\];/
    );
    const [{ errorCount: fixedOptionGuardErrors = 0, output: fixedOptionGuardCode = optionGuardResult.code } = {}]
        = await fixedOptionGuardEslint.lintText(optionGuardResult.code, { filePath: 'option-guard-generated.js' });

    assert.equal(fixedOptionGuardErrors, 0);
    const optionRuntimeInternal = path.join(programDirectory, 'internal.js');
    const optionRuntimeFile = path.join(programDirectory, 'option-guard.js');
    await writeFile(
        optionRuntimeInternal,
        'export const isMissing = value => value.category === "Missing";\nexport const isAvailable = value => value.category === '
        + '"Available";\nexport const wrapValue = value => ({ category: "Available", value });\n'
    );
    await writeFile(optionRuntimeFile, fixedOptionGuardCode);
    const { href: optionGuardHref = '' } = pathToFileURL(optionRuntimeFile);
    const { read: readOption = false, readPair: readOptionPair = false } = await import(optionGuardHref);
    let optionEvents = '';
    const availableValue = {
        get category() {
            optionEvents += 'tag:';

            return 'Available';
        },
        get value() {
            optionEvents += 'value';

            return 'present';
        }
    };

    assert.equal(readOption(availableValue), 'present');
    assert.equal(optionEvents, 'tag:value');
    assert.equal(readOption({ category: 'Missing' }), '');
    let pairReads = 0;
    const pair = {
        category: 'Available',
        get value() {
            pairReads += 1;

            return ['inbound', 'outbound'];
        }
    };

    assert.deepEqual(readOptionPair(pair), ['inbound', 'outbound']);
    assert.equal(pairReads, 2);
    assert.deepEqual(readOptionPair({ category: 'Missing' }), []);

    const mapReconstructionFile = path.join(programDirectory, 'map-reconstruction.ts');
    const mapReconstructionSource = [
        "import * as _ from './internal.js';",
        'export const modify = (result: _.Availability<[number, string]>, source: ReadonlyMap<number, string>, next: string) => {',
        '    if (_.isMissing(result)) return _.missingValue;',
        '    const key = result.value[0];',
        '    const value = result.value[1];',
        '    const replacement = next + value.length;',
        '    const copy = new Map(source);',
        '    copy.set(key, replacement);',
        '    return _.wrapValue(copy);',
        '};',
        ''
    ].join('\n');
    await writeFile(mapReconstructionFile, mapReconstructionSource);
    const mapReconstructionProgram = createFixtureProgram([internalFile, mapReconstructionFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const mapReconstructionResult = createTypeScriptTransformer({
        typescript,
        program: mapReconstructionProgram,
        standard: { object: programObjectStandard }
    }).transform({
        code: mapReconstructionSource,
        fileName: mapReconstructionFile
    });

    assert.deepEqual(mapReconstructionResult.diagnostics, []);
    assert.match(
        mapReconstructionResult.code,
        new RegExp([
            'const \\{ value: \\[key\\] \\} = result',
            '[\\s\\S]*const \\{ value: \\[\\, value\\] \\} = result',
            '[\\s\\S]*const copyResult = new Map\\(\\[\\.\\.\\.source, \\[key, replacement\\]\\]\\)',
            '[\\s\\S]*return _\\.wrapValue\\(copyResult\\)'
        ].join(''))
    );
    const [{ errorCount: mapReconstructionErrors = 0, output: fixedMapReconstructionCode = mapReconstructionResult.code } = {}]
        = await fixedOptionGuardEslint.lintText(mapReconstructionResult.code, { filePath: 'map-reconstruction-generated.js' });

    assert.equal(mapReconstructionErrors, 0);
    const mapReconstructionRuntimeFile = path.join(programDirectory, 'map-reconstruction.js');
    const baselineMapRuntimeFile = path.join(programDirectory, 'map-reconstruction-baseline.js');
    const baselineMapRuntime = [
        'export const modify = (result, source, next) => {',
        '    if (result.category === "Missing") return undefined;',
        '    const key = result.value[0];',
        '    const value = result.value[1];',
        '    const replacement = next + value.length;',
        '    const copy = new Map(source);',
        '    copy.set(key, replacement);',
        '    return { category: "Available", value: copy };',
        '};',
        ''
    ].join('\n');
    await writeFile(baselineMapRuntimeFile, baselineMapRuntime);
    await writeFile(mapReconstructionRuntimeFile, fixedMapReconstructionCode);
    const { href: baselineMapHref = '' } = pathToFileURL(baselineMapRuntimeFile);
    const { href: mapReconstructionHref = '' } = pathToFileURL(mapReconstructionRuntimeFile);
    const { modify: modifyBaselineMap = false } = await import(baselineMapHref);
    const { modify: modifyMap = false } = await import(mapReconstructionHref);
    const sourceMap = new Map([[Number.NaN, 'old'], [2, 'second']]);
    const getMapResult = () => {
        let reads = 0;
        const result = {
            category: 'Available',
            get value() {
                reads += 1;

                return [Number.NaN, 'old'];
            }
        };

        return { result, getReads: () => reads };
    };
    const baselineMapResult = getMapResult();
    const generatedMapResult = getMapResult();
    const { value: expectedMap = new Map() } = modifyBaselineMap(
        baselineMapResult.result,
        sourceMap,
        'new'
    );
    const { value: updatedMap = new Map() } = modifyMap(generatedMapResult.result, sourceMap, 'new');

    assert.deepEqual([...updatedMap], [...expectedMap]);
    assert.deepEqual([...updatedMap], [[Number.NaN, 'new3'], [2, 'second']]);
    assert.equal(generatedMapResult.getReads(), baselineMapResult.getReads());
    assert.deepEqual(modifyMap({ category: 'Missing' }, sourceMap, 'new'), undefined);

    const wrappedMapReconstructionFile = path.join(programDirectory, 'wrapped-map-reconstruction.ts');
    const wrappedMapReconstructionSource = [
        'type Pair = { value: [number, string] };',
        'type Wrapper = { finish: (value: Map<number, string>) => Map<number, string> };',
        'export const build = (pair: Pair, source: Map<number, string>, wrapper: Wrapper) => {',
        '    const copy = new Map(source);',
        "    copy.set(pair.value[0], 'fresh');",
        '    return wrapper.finish(copy);',
        '};',
        ''
    ].join('\n');
    await writeFile(wrappedMapReconstructionFile, wrappedMapReconstructionSource);
    const wrappedMapReconstructionProgram = createFixtureProgram([wrappedMapReconstructionFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const wrappedMapReconstructionResult = createTypeScriptTransformer({
        typescript,
        program: wrappedMapReconstructionProgram,
        standard: { object: programObjectStandard }
    }).transform({
        code: wrappedMapReconstructionSource,
        fileName: wrappedMapReconstructionFile
    });

    assert.deepEqual(wrappedMapReconstructionResult.diagnostics, []);
    assert.match(
        wrappedMapReconstructionResult.code,
        /const sourceEntries = \[\.\.\.source\];[\s\S]*const \{ value: \[pairValue0\] \} = pair;/
    );
    assert.match(wrappedMapReconstructionResult.code, /const copyResult = new Map\(\[\.\.\.sourceEntries, \[pairValue0, ['"]fresh['"]\]\]\);/);
    assert.match(wrappedMapReconstructionResult.code, /const \{ finish: wrapperFinish \} = wrapper;[\s\S]*return wrapperFinish\.call\(wrapper, copyResult\)/);
    const [wrappedMapReconstructionLint = {}] = await fixedOptionGuardEslint.lintText(
        wrappedMapReconstructionResult.code,
        {
            filePath: 'wrapped-map-reconstruction-generated.js'
        }
    );
    const {
        errorCount: wrappedMapReconstructionErrors = 0,
        output: fixedWrappedMapReconstructionCode = wrappedMapReconstructionResult.code,
        messages: wrappedMapReconstructionMessages = []
    } = wrappedMapReconstructionLint;

    assert.equal(wrappedMapReconstructionErrors, 0, JSON.stringify(wrappedMapReconstructionMessages));
    const wrappedMapRuntimeFile = path.join(programDirectory, 'wrapped-map-reconstruction.js');
    const baselineWrappedMapRuntimeFile = path.join(programDirectory, 'wrapped-map-reconstruction-baseline.js');
    const baselineWrappedMapRuntime = [
        'export const build = (pair, source, wrapper) => {',
        '    const copy = new Map(source);',
        '    copy.set(pair.value[0], "fresh");',
        '    return wrapper.finish(copy);',
        '};',
        ''
    ].join('\n');
    await writeFile(wrappedMapRuntimeFile, fixedWrappedMapReconstructionCode);
    await writeFile(baselineWrappedMapRuntimeFile, baselineWrappedMapRuntime);
    const { href: baselineWrappedMapHref = '' } = pathToFileURL(baselineWrappedMapRuntimeFile);
    const { href: wrappedMapHref = '' } = pathToFileURL(wrappedMapRuntimeFile);
    const { build: buildBaselineWrappedMap = false } = await import(baselineWrappedMapHref);
    const { build: buildWrappedMap = false } = await import(wrappedMapHref);
    const getWrappedMapInputs = () => {
        let events = '';
        const source = Object.defineProperty(new Map([[1, 'old']]), Symbol.iterator, {
            value: function* iterateWrappedMap() {
                events += 'copy:';
                yield* Map.prototype[Symbol.iterator].call(this);
            }
        });
        const pair = {
            get value() {
                events += 'pair:';

                return [1, 'old'];
            }
        };
        const wrapper = {
            get finish() {
                events += 'finish';

                return value => value;
            }
        };

        return { events: () => events, pair, source, wrapper };
    };
    const baselineWrappedInputs = getWrappedMapInputs();
    const generatedWrappedInputs = getWrappedMapInputs();

    assert.deepEqual(
        [...buildBaselineWrappedMap(
            baselineWrappedInputs.pair,
            baselineWrappedInputs.source,
            baselineWrappedInputs.wrapper
        )],
        [...buildWrappedMap(generatedWrappedInputs.pair, generatedWrappedInputs.source, generatedWrappedInputs.wrapper)]
    );
    assert.equal(baselineWrappedInputs.events(), 'copy:pair:finish');
    assert.equal(generatedWrappedInputs.events(), baselineWrappedInputs.events());

    const directMapReconstructionFile = path.join(programDirectory, 'direct-map-reconstruction.ts');
    const directMapReconstructionSource = [
        "import * as _ from './internal.js';",
        'export const replace = (found: _.Availability<[number, string]>, source: Map<number, string>, next: string) => {',
        '    if (_.isAvailable(found)) {',
        '        const out = new Map(source);',
        '        out.set(found.value[0], next);',
        '        return out;',
        '    }',
        '    return source;',
        '};',
        'export const remove = (found: _.Availability<[number, string]>, source: Map<number, string>) => {',
        '    if (_.isAvailable(found)) {',
        '        const out = new Map(source);',
        '        out.delete(found.value[0]);',
        '        return out;',
        '    }',
        '    return source;',
        '};',
        ''
    ].join('\n');
    await writeFile(directMapReconstructionFile, directMapReconstructionSource);
    const directMapReconstructionProgram = createFixtureProgram([internalFile, directMapReconstructionFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const directMapReconstructionResult = createTypeScriptTransformer({
        typescript,
        program: directMapReconstructionProgram,
        standard: { object: programObjectStandard }
    }).transform({
        code: directMapReconstructionSource,
        fileName: directMapReconstructionFile
    });

    assert.deepEqual(directMapReconstructionResult.diagnostics, []);
    assert.match(
        directMapReconstructionResult.code,
        /const sourceEntries = \[\.\.\.source\];[\s\S]*const \{ value: \[foundValue0\] \} = found;[\s\S]*return new Map\(\[\.\.\.sourceEntries, \[foundValue0, next\]\]\)/
    );
    const [{ messages: directMapMessages = [], errorCount: directMapReconstructionErrors = 0, output: fixedDirectMapReconstructionCode = directMapReconstructionResult.code } = {}]
        = await fixedOptionGuardEslint.lintText(directMapReconstructionResult.code, { filePath: 'direct-map-reconstruction-generated.js' });

    assert.equal(directMapReconstructionErrors, 0, JSON.stringify(directMapMessages));
    const directMapRuntimeFile = path.join(programDirectory, 'direct-map-reconstruction.js');
    await writeFile(directMapRuntimeFile, fixedDirectMapReconstructionCode);
    const { href: directMapHref = '' } = pathToFileURL(directMapRuntimeFile);
    const { replace: replaceMap = false, remove: removeMap = false } = await import(directMapHref);
    let directMapEvents = '';
    const directMapSource = Object.defineProperty(
        new Map([[Number.NaN, 'old'], [2, 'second']]),
        Symbol.iterator,
        {
            value: function* iterateDirectMap() {
                directMapEvents += 'copy:';
                yield* Map.prototype[Symbol.iterator].call(this);
            }
        }
    );
    const directFound = {
        category: 'Available',
        get value() {
            directMapEvents += 'value';

            return [Number.NaN, 'old'];
        }
    };

    assert.deepEqual([...replaceMap(directFound, directMapSource, 'new')], [[Number.NaN, 'new'], [2, 'second']]);
    assert.equal(directMapEvents, 'copy:value');
    assert.equal(replaceMap({ category: 'Missing' }, directMapSource, 'new'), directMapSource);
    assert.deepEqual([...removeMap({ category: 'Available', value: [Number.NaN, 'old'] }, directMapSource)], [[2, 'second']]);

    const nestedTupleSelectionFile = path.join(programDirectory, 'nested-tuple-selection.ts');
    const nestedTupleSelectionSource = [
        "export const select = (input: { category: 'Available' | 'Missing'; value: [number, string] }) => {",
        "    if (input.category === 'Missing') return '';",
        '    const result = input;',
        '    return result.value[1];',
        '};',
        ''
    ].join('\n');
    await writeFile(nestedTupleSelectionFile, nestedTupleSelectionSource);
    const nestedTupleSelectionProgram = createFixtureProgram([nestedTupleSelectionFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const nestedTupleSelectionResult = createTypeScriptTransformer({
        typescript,
        program: nestedTupleSelectionProgram,
        standard: { object: programObjectStandard }
    }).transform({
        code: nestedTupleSelectionSource,
        fileName: nestedTupleSelectionFile
    });

    assert.deepEqual(nestedTupleSelectionResult.diagnostics, []);
    assert.match(
        nestedTupleSelectionResult.code,
        /const \{ value: \[, resultValue1\] \} = result;/
    );
    assert.doesNotMatch(nestedTupleSelectionResult.code, /result\.value\[1\]/);
    const [{ errorCount: nestedTupleSelectionErrors = 0, output: fixedNestedTupleSelectionCode = nestedTupleSelectionResult.code } = {}]
        = await fixedOptionGuardEslint.lintText(nestedTupleSelectionResult.code, { filePath: 'nested-tuple-selection-generated.js' });

    assert.equal(nestedTupleSelectionErrors, 0);
    const nestedTupleSelectionRuntimeFile = path.join(programDirectory, 'nested-tuple-selection.js');
    await writeFile(nestedTupleSelectionRuntimeFile, fixedNestedTupleSelectionCode);
    const { href: nestedTupleSelectionHref = '' } = pathToFileURL(nestedTupleSelectionRuntimeFile);
    const { select: selectNestedTuple = false } = await import(nestedTupleSelectionHref);

    assert.equal(selectNestedTuple({ category: 'Available', value: [3, 'ok'] }), 'ok');
    assert.equal(selectNestedTuple({ category: 'Missing', value: [3, 'ok'] }), '');
    assert.equal(selectNestedTuple({
        category: 'Missing',
        get value() {
            throw new Error('unreached payload');
        }
    }), '');

    const effectfulMapFile = path.join(programDirectory, 'map-effectful.ts');
    const effectfulMapSource = [
        'export const modify = (source: ReadonlyMap<number, string>, key: number, value: string, update: (value: string) => string) => {',
        '    const copy = new Map(source);',
        '    copy.set(key, update(value));',
        '    return copy;',
        '};',
        ''
    ].join('\n');
    await writeFile(effectfulMapFile, effectfulMapSource);
    const effectfulMapResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([effectfulMapFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        })
    }).transform({
        code: effectfulMapSource,
        fileName: effectfulMapFile
    });

    assert.deepEqual(effectfulMapResult.diagnostics, []);
    assert.doesNotMatch(effectfulMapResult.code, /Array\.from\(source/);

    const directSetReconstructionFile = path.join(programDirectory, 'direct-set-reconstruction.ts');
    const directSetReconstructionSource = [
        'export const insert = (source: Set<number>, value: number) => {',
        '    const out = new Set(source);',
        '    out.add(value);',
        '    return out;',
        '};',
        'export const retain = (source: Set<number>, observe: (value: Set<number>) => void) => {',
        '    const out = new Set(source);',
        '    observe(out);',
        '    return out;',
        '};',
        ''
    ].join('\n');
    await writeFile(directSetReconstructionFile, directSetReconstructionSource);
    const directSetProgram = createFixtureProgram([directSetReconstructionFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const directSetResult = createTypeScriptTransformer({ typescript, program: directSetProgram }).transform({
        code: directSetReconstructionSource,
        fileName: directSetReconstructionFile
    });

    assert.deepEqual(directSetResult.diagnostics, []);
    assert.match(directSetResult.code, /return new Set\(\[\.\.\.source, value\]\);/);
    const [{ errorCount: directSetErrors = 0 } = {}] = await outputEslint.lintText(directSetResult.code, {
        filePath: 'direct-set-reconstruction-generated.js'
    });

    assert.equal(directSetErrors, 0);
    const directSetRuntimeFile = path.join(programDirectory, 'direct-set-reconstruction.js');
    await writeFile(directSetRuntimeFile, directSetResult.code);
    const { href: directSetHref = '' } = pathToFileURL(directSetRuntimeFile);
    const { insert: insertSet = false } = await import(directSetHref);
    let directSetEvents = '';
    const directSetSource = Object.defineProperty(new Set([1]), Symbol.iterator, {
        value: function* iterateDirectSet() {
            directSetEvents += 'copy:';
            yield* Set.prototype[Symbol.iterator].call(this);
        }
    });

    assert.deepEqual([...insertSet(directSetSource, 2)], [1, 2]);
    assert.equal(directSetEvents, 'copy:');

    const rebindMapFile = path.join(programDirectory, 'rebind-map.ts');
    const rebindMapSource = [
        'export const updateTwice = (source: Map<number, string>, first: number, second: number) => {',
        '    const out = new Map(source);',
        "    out.set(first, 'first');",
        "    out.set(second, 'second');",
        '    return out;',
        '};',
        ''
    ].join('\n');
    await writeFile(rebindMapFile, rebindMapSource);
    const rebindMapProgram = createFixtureProgram([rebindMapFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const rebindMapResult = createTypeScriptTransformer({ typescript, program: rebindMapProgram }).transform({
        code: rebindMapSource,
        fileName: rebindMapFile
    });

    assert.deepEqual(rebindMapResult.diagnostics, []);
    assert.match(rebindMapResult.code, /let out = new Map\(source\);/);
    const [{ errorCount: rebindMapErrors = 0 } = {}] = await outputEslint.lintText(rebindMapResult.code, {
        filePath: 'rebind-map-generated.js'
    });

    assert.equal(rebindMapErrors, 0);
    const rebindMapRuntimeFile = path.join(programDirectory, 'rebind-map.js');
    await writeFile(rebindMapRuntimeFile, rebindMapResult.code);
    const { href: rebindMapHref = '' } = pathToFileURL(rebindMapRuntimeFile);
    const { updateTwice = false } = await import(rebindMapHref);
    const objectKey = {};
    const rebindMapSourceValue = new Map([[objectKey, 'old'], [2, 'second']]);

    assert.deepEqual([...updateTwice(rebindMapSourceValue, objectKey, Number.NaN)], [
        [objectKey, 'first'],
        [2, 'second'],
        [Number.NaN, 'second']
    ]);

    const iteratorProtocolFile = path.join(programDirectory, 'iterator-protocol.ts');
    const iteratorProtocolSource = [
        'export const filter = (predicate: (value: number) => boolean) => (set: Set<number>) => {',
        '    const values = set.values();',
        '    let step: IteratorResult<number>;',
        '    const result = new Set<number>();',
        '    while (!(step = values.next()).done) {',
        '        const value = step.value;',
        '        if (predicate(value)) result.add(value);',
        '    }',
        '    return result;',
        '};',
        'export const partition = (predicate: (value: number) => boolean) => (set: Set<number>) => {',
        '    const values = set.values();',
        '    let step: IteratorResult<number>;',
        '    const inbound = new Set<number>();',
        '    const outbound = new Set<number>();',
        '    while (!(step = values.next()).done) {',
        '        const value = step.value;',
        '        if (predicate(value)) {',
        '            outbound.add(value);',
        '        } else {',
        '            inbound.add(value);',
        '        }',
        '    }',
        '    return [inbound, outbound];',
        '};',
        'const packageMaps = (inbound: Map<number, number>, outbound: Map<number, number>) => [inbound, outbound] as const;',
        'export const partitionMapTransferred = (predicate: (value: number) => boolean) => (map: Map<number, number>) => {',
        '    const entries = map.entries();',
        '    let step: IteratorResult<[number, number]>;',
        '    const inbound = new Map<number, number>();',
        '    const outbound = new Map<number, number>();',
        '    while (!(step = entries.next()).done) {',
        '        const [key, value] = step.value;',
        '        if (predicate(value)) {',
        '            outbound.set(key, value);',
        '        } else {',
        '            inbound.set(key, value);',
        '        }',
        '    }',
        '    return packageMaps(inbound, outbound);',
        '};',
        'export const partitionMap = (predicate: (value: number) => boolean) => (map: Map<number, number>) => {',
        '    const entries = map.entries();',
        '    let step: IteratorResult<[number, number]>;',
        '    const inbound = new Map<number, number>();',
        '    const outbound = new Map<number, number>();',
        '    while (!(step = entries.next()).done) {',
        '        const [key, value] = step.value;',
        '        if (predicate(value)) {',
        '            outbound.set(key, value);',
        '        } else {',
        '            inbound.set(key, value);',
        '        }',
        '    }',
        '    return [inbound, outbound];',
        '};',
        'export const mapValues = (map: Map<number, number>) => {',
        '    const values = map.values();',
        '    let step: IteratorResult<number>;',
        '    const result = new Set<number>();',
        '    while (!(step = values.next()).done) {',
        '        const value = step.value;',
        '        result.add(value);',
        '    }',
        '    return result;',
        '};',
        'type IteratorStep = { done: false; readonly value?: number } | { done: true };',
        'type Steps = { next: () => IteratorStep };',
        'export const collectSteps = (steps: Steps) => {',
        '    let step: IteratorStep;',
        '    const result = new Set<number | undefined>();',
        '    while (!(step = steps.next()).done) {',
        '        const value = step.value;',
        '        result.add(value);',
        '    }',
        '    return result;',
        '};',
        'type EntryStep = { done: false; value: readonly [number, number] } | { done: true };',
        'type EntrySteps = { next: () => EntryStep };',
        'export const collectPositiveEntries = (steps: EntrySteps) => {',
        '    let step: EntryStep;',
        '    const result = new Map<number, number>();',
        '    while (!(step = steps.next()).done) {',
        '        const [key, value] = step.value;',
        '        if (value > 0) result.set(key, value);',
        '    }',
        '    return result;',
        '};',
        'export const copyLiveMap = (source: Map<number, number>, steps: EntrySteps) => {',
        '    const copied = new Map(source);',
        '    let step: EntryStep;',
        '    while (!(step = steps.next()).done) {',
        '        const [key, value] = step.value;',
        '        if (value >= 0) copied.set(key, value);',
        '    }',
        '    return copied;',
        '};',
        'export const retainComputedUpdate = () => {',
        '    const computedOutput = new Map<number, number>();',
        "    computedOutput['set'](1, 1);",
        '    return computedOutput;',
        '};',
        'export const retainCapturedAccumulator = () => {',
        '    const capturedOutput = new Set<number>();',
        '    const expose = () => capturedOutput;',
        '    expose();',
        '    capturedOutput.add(1);',
        '    return capturedOutput;',
        '};',
        'export const retainSideEffect = (values: number[], observe: (value: number) => void) => {',
        '    const sideEffectResult = new Set<number>();',
        '    for (const value of values) {',
        '        sideEffectResult.add(value);',
        '        observe(value);',
        '    }',
        '    return sideEffectResult;',
        '};',
        ''
    ].join('\n');
    await writeFile(iteratorProtocolFile, iteratorProtocolSource);
    const iteratorProtocolProgram = createFixtureProgram([iteratorProtocolFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const iteratorCollectionContracts = collectCollectionDecisions({
        typescript,
        sourceFile: iteratorProtocolProgram.getSourceFile(iteratorProtocolFile),
        checker: iteratorProtocolProgram.getTypeChecker()
    });
    const iteratorAccumulatorContracts = Array.from(iteratorCollectionContracts.values()).filter(({
        collection: { name = '' } = {}, outcome = ''
    } = {}) => {
        return ['inbound', 'outbound'].includes(name) && outcome === 'operational-collection-builder';
    });

    assert.equal(iteratorAccumulatorContracts.length, 6);
    const collectionBoundaries = Array.from(iteratorCollectionContracts.values()).reduce((found, {
        collection: { name = '' } = {}, boundaryReason = ''
    } = {}) => {
        return new Map([...found, [name, boundaryReason]]);
    }, new Map());

    assert.equal(collectionBoundaries.get('computedOutput'), 'computed-update');
    assert.equal(collectionBoundaries.get('capturedOutput'), 'external-or-escaped');
    const sideEffectAgreement = Array.from(iteratorCollectionContracts.values()).find(({
        collection: { name = '' } = {}
    } = {}) => name === 'sideEffectResult') || {};

    assert.equal(sideEffectAgreement.outcome, 'operational-collection-builder');
    const copiedLoopAgreement = [...iteratorCollectionContracts.values()].find(({
        collection: { name = '' } = {}
    } = {}) => name === 'copied') || {};

    assert.equal(copiedLoopAgreement.outcome, 'operational-collection-builder');
    assert.equal(copiedLoopAgreement.collection.freshness, 'copy');
    assert.match(copiedLoopAgreement.collection.mutationSites[0].key, /^\d+:\d+$/);
    const rejectedCopySource = [
        'export const outside = (source: Map<number, number>, values: number[]) => {',
        '    const copied = new Map(source);',
        '    for (const value of values) void value;',
        '    copied.set(1, 2);',
        '    return copied;',
        '};',
        'export const asyncCopy = async (source: Map<number, number>, values: AsyncIterable<number>) => {',
        '    const copied = new Map(source);',
        '    for await (const value of values) copied.set(value, value);',
        '    return copied;',
        '};',
        'export const computedCopy = (source: Map<number, number>, values: number[]) => {',
        '    const copied = new Map(source);',
        "    for (const value of values) copied['set'](value, value);",
        '    return copied;',
        '};',
        ''
    ].join('\n');
    const rejectedCopyFile = path.join(programDirectory, 'rejected-copy-loop.ts');
    await writeFile(rejectedCopyFile, rejectedCopySource);
    const rejectedCopyProgram = createFixtureProgram([rejectedCopyFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const rejectedCopyFacts = collectCollectionDecisions({
        typescript,
        sourceFile: rejectedCopyProgram.getSourceFile(rejectedCopyFile),
        checker: rejectedCopyProgram.getTypeChecker()
    });
    const rejectedCopyOutcomes = [...rejectedCopyFacts.values()].map(({
        collection: { name = '' } = {}, outcome = '', boundaryReason = ''
    } = {}) => [name, outcome, boundaryReason]);

    assert.deepEqual(rejectedCopyOutcomes, [
        ['copied', 'fresh-copy-reconstruction', ''],
        ['copied', 'retain-collection-boundary', 'observable-loop'],
        ['copied', 'retain-collection-boundary', 'computed-update']
    ]);
    const iteratorValueAgreement = Array.from(iteratorCollectionContracts.values()).find(({
        collection: { name = '' } = {}
    } = {}) => name === 'result') || {};
    const {
        collection: { iteratorResultBindings = [] } = {}
    } = iteratorValueAgreement;

    assert.deepEqual(iteratorResultBindings.map(({
        stateName = '', aliasName = ''
    } = {}) => [stateName, aliasName]), [['step', 'value']]);
    const iteratorAgreements = collectDestructuringAgreements({
        collectionReconstructionContracts: iteratorCollectionContracts
    });
    const hasOperationalIteratorAgreement = (candidate = {}) => {
        const { name: candidateName = {} } = candidate;
        const { text: name = '' } = candidateName;
        const { agreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node: candidate,
            destructuringAgreements: compileDestructuringDecisions(iteratorAgreements),
            kinds: ['collection-reconstruction']
        });
        const { action = '' } = agreement;

        if (['inbound', 'outbound', 'result'].includes(name) && action === 'operational-collection-builder') return true;

        return typescript.forEachChild(candidate, hasOperationalIteratorAgreement) === true;
    };

    assert.equal(hasOperationalIteratorAgreement(iteratorProtocolProgram.getSourceFile(iteratorProtocolFile)), true);
    const iteratorProtocolResult = createTypeScriptTransformer({
        typescript,
        program: iteratorProtocolProgram
    }).transform({
        code: iteratorProtocolSource,
        fileName: iteratorProtocolFile
    });

    assert.deepEqual(iteratorProtocolResult.diagnostics, []);
    assert.match(iteratorProtocolResult.code, /const values = set\.values\(\);/);
    assert.match(iteratorProtocolResult.code, /while \(!\(step = values\.next\(\)\)\.done\)/);
    assert.match(iteratorProtocolResult.code, /const \{ value \} = step;/);
    assert.doesNotMatch(iteratorProtocolResult.code, /const \{ value: stepValue = 0 \} = step/);
    assert.match(iteratorProtocolResult.code, /while \(!\(step = steps\.next\(\)\)\.done\)[\s\S]*if \(value > 0\)[\s\S]*result\.set\(key, value\);/);
    assert.match(iteratorProtocolResult.code, /const copied = new Map\(source\);[\s\S]*while \(!\(step = steps\.next\(\)\)\.done\)[\s\S]*copied\.set\(key, value\);[\s\S]*return copied;/);
    assert.equal((iteratorProtocolResult.code.match(/copied = new Map\(/g) || []).length, 1);
    assert.match(iteratorProtocolResult.code, /const inbound = new Set\(\);[\s\S]*const outbound = new Set\(\);/);
    assert.match(iteratorProtocolResult.code, /outbound\.add\(value\);/);
    assert.match(iteratorProtocolResult.code, /inbound\.add\(value\);/);
    assert.match(iteratorProtocolResult.code, /const inbound = new Map\(\);[\s\S]*const outbound = new Map\(\);/);
    assert.match(iteratorProtocolResult.code, /outbound\.set\(key, value\);/);
    assert.match(iteratorProtocolResult.code, /inbound\.set\(key, value\);/);
    assert.match(iteratorProtocolResult.code, /Owned Map\/Set builder preserves source iterator staging and transfers only at return\./);
    assert.doesNotMatch(iteratorProtocolResult.code, /resilient\/prefer-prototype-methods -- Source loop has unproven callback safety or sequential effects\./);
    assert.match(iteratorProtocolResult.code, /return packageMaps\(inbound, outbound\);/);
    assert.match(iteratorProtocolResult.code, /sideEffectResult\.add\(value\);\s+observe\(value\);/);
    assert.match(iteratorProtocolResult.code, /map\.values\(\)[\s\S]*values\.next\(\)/);
    assert.doesNotMatch(iteratorProtocolResult.code, /for \(const value of map\)/);
    const [positiveEntryOutput = ''] = iteratorProtocolResult.code.match(
        /export const collectPositiveEntries[\s\S]*?(?=export const copyLiveMap)/
    ) || [];

    assert.equal((positiveEntryOutput.match(/Owned Map\/Set builder preserves source iterator staging and transfers only at return\./g) || []).length, 1);
    const [iteratorProtocolLint = {}] = await outputEslint.lintText(iteratorProtocolResult.code, {
        filePath: 'iterator-protocol-generated.js'
    });

    assert.ok(
        iteratorProtocolLint.messages.some(({ ruleId = '' } = {}) => ruleId === 'resilient/prefer-prototype-methods'),
        JSON.stringify(iteratorProtocolLint.messages)
    );
    const fixedIteratorEslint = new ESLint({
        fix: true,
        overrideConfigFile: true,
        overrideConfig: [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety]
    });
    const [fixedIteratorProtocolLint = {}] = await fixedIteratorEslint.lintText(iteratorProtocolResult.code, {
        filePath: 'iterator-protocol-fixed.js'
    });

    assert.ok(
        fixedIteratorProtocolLint.messages.some(({ ruleId = '' } = {}) => ruleId === 'resilient/prefer-prototype-methods'),
        JSON.stringify(fixedIteratorProtocolLint.messages)
    );
    const iteratorProtocolRuntimeFile = path.join(programDirectory, 'iterator-protocol.js');
    await writeFile(iteratorProtocolRuntimeFile, iteratorProtocolResult.code);
    const { href: iteratorProtocolHref = '' } = pathToFileURL(iteratorProtocolRuntimeFile);
    const {
        filter: iteratorProtocolFilter = false,
        partitionMapTransferred: iteratorProtocolPartitionMapTransferred = false,
        collectSteps = false,
        collectPositiveEntries = false,
        copyLiveMap = false
    } = await import(iteratorProtocolHref);
    const liveIteratorMutationSet = new Set([1, 2]);
    const iteratorResult = iteratorProtocolFilter((value) => {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Hostile Set iterator proof mutates the iterated Set to establish live traversal semantics.
        if (value === 1) liveIteratorMutationSet.add(3);

        return value % 2 === 1;
    })(liveIteratorMutationSet);

    assert.deepEqual([...iteratorResult], [1, 3]);
    const transferredKey = {};
    const [transferredInbound = new Map(), transferredOutbound = new Map()] = iteratorProtocolPartitionMapTransferred(value => value > 1)(new Map([
        [transferredKey, 1],
        [2, 2]
    ]));

    assert.deepEqual([...transferredInbound], [[transferredKey, 1]]);
    assert.deepEqual([...transferredOutbound], [[2, 2]]);
    let stepValueReads = 0;
    let stepIndex = 0;
    const undefinedValueIteratorSteps = [{
        done: false,
        get value() {
            stepValueReads += 1;

            // eslint-disable-next-line resilient/prefer-falsey-returns -- The iterator-result fixture proves a present undefined value is not defaulted.
            return undefined;
        }
    }, { done: true }];
    const collectedSteps = collectSteps({
        next: () => {
            const nextStep = undefinedValueIteratorSteps[stepIndex] || { done: true };

            stepIndex += 1;

            return nextStep;
        }
    });

    assert.deepEqual([...collectedSteps], [undefined]);
    assert.equal(stepValueReads, 1);
    const malformedStepIterator = {
        next: () => {
            // eslint-disable-next-line resilient/prefer-falsey-returns -- The iterator protocol fixture proves a malformed external step still throws.
            return null;
        }
    };
    assert.throws(() => collectSteps(malformedStepIterator));
    let entryAdvances = 0;
    const entrySteps = [{ done: false, value: [1, -1] }, { done: false, value: [2, 3] }, { done: true }];
    const positiveEntries = collectPositiveEntries({
        next: () => {
            const nextStep = entrySteps[entryAdvances] || { done: true };

            entryAdvances += 1;

            return nextStep;
        }
    });

    assert.deepEqual([...positiveEntries], [[2, 3]]);
    assert.equal(entryAdvances, 3);
    const copiedSourceMap = new Map([[1, 0], [2, -1]]);
    const copyEntries = [[1, 2], [3, 0], [1, 5], [4, -2]];
    let copyAdvances = 0;
    const copiedMap = copyLiveMap(copiedSourceMap, {
        next: () => {
            const [entry = {}] = copyEntries.slice(copyAdvances, copyAdvances + 1);

            copyAdvances += 1;

            return entry.length ? { done: false, value: entry } : { done: true };
        }
    });

    assert.deepEqual([...copiedMap], [[1, 5], [2, -1], [3, 0]]);
    assert.deepEqual([...copiedSourceMap], [[1, 0], [2, -1]]);
    assert.equal(copyAdvances, 5);
    const { outputText: copiedReferenceCode = '' } = typescript.transpileModule(iteratorProtocolSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const copiedReferenceFile = path.join(programDirectory, 'copied-live-reference.js');
    await writeFile(copiedReferenceFile, copiedReferenceCode);
    const { copyLiveMap: sourceCopyLiveMap = false } = await import(pathToFileURL(copiedReferenceFile).href);
    const runCopy = (copy) => {
        let advances = 0;
        const source = new Map([[1, 0], [2, -1]]);
        const entries = [[1, 2], [3, 0], [1, 5], [4, -2]];
        const output = copy(source, {
            next() {
                const [entry = {}] = entries.slice(advances, advances + 1);

                advances += 1;

                return entry.length ? { done: false, value: entry } : { done: true };
            }
        });

        return { advances, output: [...output], source: [...source] };
    };

    assert.deepEqual(runCopy(copyLiveMap), runCopy(sourceCopyLiveMap));
    [copyLiveMap, sourceCopyLiveMap].forEach((copy) => {
        assert.throws(() => copy(new Map(), {
            next: () => ({ done: false, value: null })
        }), TypeError);
    });

    const tupleFile = path.join(programDirectory, 'tuple.ts');
    const tupleSource = [
        'type Pair = [string, number];',
        'export const readHead = (pair: Pair) => {',
        '    const head = pair[0];',
        '    return head;',
        '};',
        ''
    ].join('\n');

    await writeFile(tupleFile, tupleSource);
    const tupleProgram = createFixtureProgram([tupleFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const tupleResult = createTypeScriptTransformer({ typescript, program: tupleProgram }).transform({
        code: tupleSource,
        fileName: tupleFile
    });

    assert.deepEqual(tupleResult.diagnostics, []);
    assert.match(tupleResult.code, /const \[head = ["']["']\] = pair;/);

    const tupleConsumerFile = path.join(programDirectory, 'tuple-consumer.ts');
    const tupleConsumerSource = [
        'type Pair = [number, string];',
        'type Mapper = { map: <B>(value: unknown, callback: (pair: Pair) => B) => B };',
        'export const mapPair = (F: Mapper, value: unknown) => F.map(value, ([a, state]) => [a, state]);',
        ''
    ].join('\n');
    await writeFile(tupleConsumerFile, tupleConsumerSource);
    const tupleConsumerProgram = createFixtureProgram([tupleConsumerFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const tupleConsumerResult = createTypeScriptTransformer({
        typescript,
        program: tupleConsumerProgram,
        standard: { array: '../analysis/host/array.js' }
    }).transform({
        code: tupleConsumerSource,
        fileName: tupleConsumerFile
    });

    assert.deepEqual(tupleConsumerResult.diagnostics, []);
    // Declared tuple shapes do not validate callback inputs (S-11). Preserve
    // native iteration, including short inputs and strings, without a fallback.
    assert.match(tupleConsumerResult.code, /\(\[a, state\]\) => \[a, state\]/);
    assert.doesNotMatch(tupleConsumerResult.code, /isArray|hasArrayContent|return \[\]/);
    assert.deepEqual(tupleConsumerResult.agreements.map(({ action = '' } = {}) => action), ['preserve-native-tuple']);
    const tupleConsumerRuntimeFile = path.join(programDirectory, 'tuple-consumer.js');
    await writeFile(tupleConsumerRuntimeFile, tupleConsumerResult.code.replace(
        "import { isArray } from '../analysis/host/array.js';",
        'const isArray = Array.isArray;'
    ));
    const { href: tupleConsumerHref = '' } = pathToFileURL(tupleConsumerRuntimeFile);
    const { mapPair = false } = await import(tupleConsumerHref);
    let calls = [];
    const mapper = {
        map(value, callback) {
            calls = [...calls, { value, callback }];

            return callback(value);
        }
    };

    assert.deepEqual(mapPair(mapper, [1, 'ready']), [1, 'ready']);
    assert.deepEqual(mapPair(mapper, []), [undefined, undefined]);
    assert.deepEqual(mapPair(mapper, [undefined, 'ready']), [undefined, 'ready']);
    assert.deepEqual(mapPair(mapper, 'not-a-tuple'), ['n', 'o']);
    assert.equal(calls.length, 4);
    assert.ok(calls.every(({ callback = false } = {}) => typeof callback === 'function'));
    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- The callback oracle records the exact forwarded payload, including sparse and absent positions.
    assert.deepEqual(calls.map(({ value } = {}) => value), [[1, 'ready'], [], [undefined, 'ready'], 'not-a-tuple']);

    const tupleReducerFile = path.join(programDirectory, 'tuple-reducer.ts');
    const tupleReducerSource = [
        'type Pair = [string, number];',
        'type Reducer = { reduce: <B>(value: unknown, seed: B, callback: (accumulator: B, pair: Pair) => B) => B };',
        'export const retainSeed = <B>(F: Reducer, value: unknown, seed: B) => F.reduce(value, seed, (accumulator, [key, amount]) => {',
        '    key;',
        '    amount;',
        '    return accumulator;',
        '});',
        ''
    ].join('\n');
    await writeFile(tupleReducerFile, tupleReducerSource);
    const tupleReducerResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([tupleReducerFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        }),
        standard: { array: '../analysis/host/array.js' }
    }).transform({
        code: tupleReducerSource,
        fileName: tupleReducerFile
    });

    assert.deepEqual(tupleReducerResult.diagnostics, []);
    assert.match(tupleReducerResult.code, /\(accumulator, \[key, amount\]\) =>/);
    assert.doesNotMatch(tupleReducerResult.code, /isArray|hasArrayContent|return \[\]/);
    const [tupleReducerLint = {}] = await outputEslint.lintText(tupleReducerResult.code, {
        filePath: 'tuple-reducer-generated.js'
    });

    assert.equal(tupleReducerLint.errorCount, 0, JSON.stringify(tupleReducerLint.messages));
    const tupleReducerRuntimeFile = path.join(programDirectory, 'tuple-reducer.js');
    await writeFile(tupleReducerRuntimeFile, tupleReducerResult.code.replace(
        "import { isArray } from '../analysis/host/array.js';",
        'const isArray = Array.isArray;'
    ));
    const { href: tupleReducerHref = '' } = pathToFileURL(tupleReducerRuntimeFile);
    const { retainSeed = false } = await import(tupleReducerHref);
    const seed = new Map([['seed', 1]]);
    const reducer = {
        reduce(value, initial, callback) {
            assert.equal(initial, seed);

            return callback(...[initial, value]);
        }
    };

    assert.equal(retainSeed(reducer, [], seed), seed);
    assert.equal(retainSeed(reducer, ['key', 1], seed), seed);

    const liftedTupleFile = path.join(programDirectory, 'lifted-tuple.ts');
    const liftedTupleSource = [
        'type Effect<A> = { value: A };',
        'type Monad = {',
        '    chain: (value: Effect<[number, string]>, callback: (value: [number, string]) => Effect<[number, string]>) => Effect<[number, string]>;',
        '    of: (value: [number, string]) => Effect<[number, string]>;',
        '};',
        'export const mapPair = (M: Monad, value: Effect<[number, string]>) => M.chain(value, ([a, state]) => M.of([a, state]));',
        ''
    ].join('\n');
    await writeFile(liftedTupleFile, liftedTupleSource);
    const liftedTupleResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([liftedTupleFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        }),
        standard: { array: '../analysis/host/array.js' }
    }).transform({
        code: liftedTupleSource,
        fileName: liftedTupleFile
    });

    assert.deepEqual(liftedTupleResult.diagnostics, []);
    assert.match(liftedTupleResult.code, /\(\[a, state\]\) => M\.of\(\[a, state\]\)/);
    assert.doesNotMatch(liftedTupleResult.code, /isArray|hasArrayContent|M\.of\(\[\]\)/);
    const [liftedTupleLint = {}] = await outputEslint.lintText(liftedTupleResult.code, {
        filePath: 'lifted-tuple-generated.js'
    });

    assert.equal(liftedTupleLint.errorCount, 0, JSON.stringify(liftedTupleLint.messages));
    const liftedTupleRuntimeFile = path.join(programDirectory, 'lifted-tuple.js');
    await writeFile(liftedTupleRuntimeFile, liftedTupleResult.code.replace(
        "import { isArray } from '../analysis/host/array.js';",
        'const isArray = Array.isArray;'
    ));
    const { href: liftedTupleHref = '' } = pathToFileURL(liftedTupleRuntimeFile);
    const { mapPair: liftedMapPair = false } = await import(liftedTupleHref);
    const monad = {
        // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- The monad fixture forwards actual undefined payloads to test native tuple behavior.
        chain({ value }, callback) {
            return callback(value);
        },
        of(value) {
            return { value };
        }
    };

    assert.deepEqual(liftedMapPair(monad, { value: [1, 'ready'] }), { value: [1, 'ready'] });
    assert.deepEqual(liftedMapPair(monad, { value: [] }), { value: [undefined, undefined] });
    assert.deepEqual(liftedMapPair(monad, { value: [undefined, 'ready'] }), { value: [undefined, 'ready'] });

    const exactTuplePositionFile = path.join(programDirectory, 'exact-tuple-position.ts');
    const exactTuplePositionSource = [
        'export const first = ([head]: [number | undefined]) => head;',
        'export function declaredFirst([head]: [number | undefined]) { return head; }',
        'export const tupleFirst = (pair: readonly [number | undefined, string]) => pair[0];',
        ''
    ].join('\n');
    await writeFile(exactTuplePositionFile, exactTuplePositionSource);
    const exactTuplePositionResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([exactTuplePositionFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        })
    }).transform({
        code: exactTuplePositionSource,
        fileName: exactTuplePositionFile
    });

    assert.deepEqual(exactTuplePositionResult.diagnostics, []);
    assert.match(exactTuplePositionResult.code, /\[head\]/);
    assert.match(exactTuplePositionResult.code, /function declaredFirst\(\[head\]\)/);
    assert.match(exactTuplePositionResult.code, /\[pair0\]/);
    assert.doesNotMatch(exactTuplePositionResult.code, /= \[\]/);
    const [exactTuplePositionLint = {}] = await outputEslint.lintText(exactTuplePositionResult.code, {
        filePath: 'exact-tuple-position-generated.js'
    });

    assert.equal(exactTuplePositionLint.errorCount, 0, JSON.stringify(exactTuplePositionLint.messages));
    const exactTuplePositionRuntimeFile = path.join(programDirectory, 'exact-tuple-position.js');
    await writeFile(exactTuplePositionRuntimeFile, exactTuplePositionResult.code);
    const { href: exactTuplePositionHref = '' } = pathToFileURL(exactTuplePositionRuntimeFile);
    const {
        first = false,
        declaredFirst = false,
        tupleFirst = false
    } = await import(exactTuplePositionHref);

    assert.equal(first([]), undefined);
    assert.equal(first([undefined]), undefined);
    assert.equal(first([0]), 0);
    assert.throws(() => first(null), TypeError);
    assert.equal(declaredFirst([]), undefined);
    assert.equal(declaredFirst([0]), 0);
    assert.throws(() => declaredFirst(null), TypeError);
    assert.equal(tupleFirst([]), undefined);
    assert.equal(tupleFirst([undefined, 'value']), undefined);
    assert.equal(tupleFirst([0, 'value']), 0);
    assert.throws(() => tupleFirst(null), TypeError);

    const closedModelFile = path.join(programDirectory, 'closed-structural-model.ts');
    const closedModelSource = [
        'type CursorModel<S, A> = { readonly peek: (position: S) => A; readonly pos: S };',
        'type Hierarchy<A> = { readonly value: A; readonly forest: ReadonlyArray<Hierarchy<A>> };',
        'type Acc<M> = { readonly init: boolean; readonly acc: M };',
        'export const seek = <S>(position: S) => <A>(store: CursorModel<S, A>): CursorModel<S, A> => ({ peek: store.peek, pos: position });',
        'export const seeks = <S>(next: (position: S) => S) => <A>(store: CursorModel<S, A>): CursorModel<S, A> => ({ peek: store.peek, pos: next(store.pos) });',
        'export const extend = <S, A, B>(next: (store: CursorModel<S, A>) => B) => (store: CursorModel<S, A>): CursorModel<S, B> '
        + '=> ({ peek: position => next({ peek: store.peek, pos: position }), pos: store.pos });',
        'export const inspectTree = <A>({ value, forest }: Hierarchy<A>) => [value, forest.length];',
        'export const step = <M>({ init, acc }: Acc<M>, value: M): Acc<M> => init ? { init: false, acc: value } : { init: false, acc };',
        ''
    ].join('\n');
    await writeFile(closedModelFile, closedModelSource);
    const closedModelResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([closedModelFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        })
    }).transform({
        code: closedModelSource,
        fileName: closedModelFile
    });

    assert.deepEqual(closedModelResult.diagnostics, []);
    assert.match(closedModelResult.code, /\{ peek: storePeek \}/);
    assert.match(closedModelResult.code, /\{ peek: storePeek, pos: storePos \}/);
    assert.match(closedModelResult.code, /\{ value, forest = \[\] \}/);
    assert.match(closedModelResult.code, /\{ init = false, acc \}/);
    assert.doesNotMatch(closedModelResult.code, /= \{\}/);
    const [closedModelLint = {}] = await outputEslint.lintText(closedModelResult.code, {
        filePath: 'closed-structural-model-generated.js'
    });

    assert.equal(closedModelLint.errorCount, 0, JSON.stringify(closedModelLint.messages));
    const closedModelRuntimeFile = path.join(programDirectory, 'closed-structural-model.js');
    await writeFile(closedModelRuntimeFile, closedModelResult.code);
    const { href: closedModelHref = '' } = pathToFileURL(closedModelRuntimeFile);
    const {
        seek: seekClosedModel = false,
        seeks: seeksClosedModel = false,
        extend: extendClosedModel = false,
        inspectTree: inspectClosedModelTree = false,
        step: stepClosedModel = false
    } = await import(closedModelHref);
    const peek = position => `at:${position}`;
    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Store positions reach the guarded method unchanged; an omitted position is not a fabricated string.
    const readStorePeek = ({ peek: storePeek, pos: storePos }) => {
        if (typeof storePeek !== 'function') return false;

        return storePeek(storePos);
    };

    assert.deepEqual(seekClosedModel('next')({ peek, pos: 'previous' }), { peek, pos: 'next' });
    assert.deepEqual(seeksClosedModel(position => `${position}!`)({ peek, pos: 'previous' }), { peek, pos: 'previous!' });
    assert.equal(extendClosedModel(readStorePeek)({ peek, pos: 'previous' }).peek('next'), 'at:next');
    assert.deepEqual(inspectClosedModelTree({ value: 0, forest: [] }), [0, 0]);
    assert.deepEqual(inspectClosedModelTree({ value: undefined, forest: [] }), [undefined, 0]);
    assert.deepEqual(stepClosedModel({ init: true, acc: 'old' }, 'new'), { init: false, acc: 'new' });
    assert.deepEqual(stepClosedModel({ init: false, acc: undefined }, 'new'), { init: false, acc: undefined });
    assert.throws(() => inspectClosedModelTree(null), TypeError);

    const opaqueEffectTupleFile = path.join(programDirectory, 'opaque-effect-tuple.ts');
    const opaqueEffectTupleSource = [
        'type Effect<A> = { value: A };',
        'type Monad = { chain: <A, B>(value: Effect<A>, callback: (pair: [number, string]) => Effect<B>) => Effect<B>; of: <A>(value: A) => Effect<A> };',
        'export const project = (M: Monad, value: Effect<[number, string]>) => M.chain(value, ([a]) => ({ value: a }));',
        ''
    ].join('\n');
    await writeFile(opaqueEffectTupleFile, opaqueEffectTupleSource);
    const opaqueEffectTupleResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([opaqueEffectTupleFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        }),
        standard: { array: '../analysis/host/array.js' }
    }).transform({
        code: opaqueEffectTupleSource,
        fileName: opaqueEffectTupleFile
    });

    assert.deepEqual(opaqueEffectTupleResult.diagnostics, []);
    assert.doesNotMatch(opaqueEffectTupleResult.code, /return M\.of\(\[\]\);/);
    assert.doesNotMatch(opaqueEffectTupleResult.code, /M\.chain\(value, \(tuple\) =>/);

    const exactTupleCallbackFile = path.join(programDirectory, 'exact-tuple-callback.ts');
    const exactTupleCallbackSource = [
        'type Pair = [number | undefined, string | undefined];',
        'type Mapper = { map: <B>(value: unknown, callback: (pair: Pair) => B) => B };',
        'export const project = (F: Mapper, value: unknown) => F.map(value, ([a, state]) => state === undefined ? a : a);',
        ''
    ].join('\n');
    await writeFile(exactTupleCallbackFile, exactTupleCallbackSource);
    const exactTupleCallbackResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([exactTupleCallbackFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        })
    }).transform({
        code: exactTupleCallbackSource,
        fileName: exactTupleCallbackFile
    });

    assert.deepEqual(exactTupleCallbackResult.diagnostics, []);
    assert.match(exactTupleCallbackResult.code, /\(\[a, state\]\) =>/);
    assert.doesNotMatch(exactTupleCallbackResult.code, /isArray|hasArrayContent|return \[\]/);
    const [exactTupleCallbackLint = {}] = await outputEslint.lintText(exactTupleCallbackResult.code, {
        filePath: 'exact-tuple-callback-generated.js'
    });

    assert.equal(exactTupleCallbackLint.errorCount, 0, JSON.stringify(exactTupleCallbackLint.messages));
    const exactTupleCallbackRuntimeFile = path.join(programDirectory, 'exact-tuple-callback.js');
    await writeFile(exactTupleCallbackRuntimeFile, exactTupleCallbackResult.code);
    const { href: exactTupleCallbackHref = '' } = pathToFileURL(exactTupleCallbackRuntimeFile);
    const { project: projectExactTuple = false } = await import(exactTupleCallbackHref);
    const exactTupleMapper = { map: (value, callback) => callback(value) };

    assert.equal(projectExactTuple(exactTupleMapper, []), undefined);
    assert.equal(projectExactTuple(exactTupleMapper, [0, 'state']), 0);
    assert.throws(() => projectExactTuple(exactTupleMapper, null), TypeError);

    const tupleFunctionFile = path.join(programDirectory, 'tuple-function.ts');
    const tupleFunctionSource = [
        'type CallablePair = [(value: string) => string, string];',
        'type Mapper = { map: <B>(value: unknown, callback: (pair: CallablePair) => B) => B };',
        'export const invokePair = (F: Mapper, value: unknown) => F.map(value, ([apply, input]) => [apply(input), input]);',
        ''
    ].join('\n');
    await writeFile(tupleFunctionFile, tupleFunctionSource);
    const tupleFunctionProgram = createFixtureProgram([tupleFunctionFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const tupleFunctionResult = createTypeScriptTransformer({
        typescript,
        program: tupleFunctionProgram,
        standard: {
            array: '../analysis/host/array.js',
            function: '../analysis/host/function.js'
        }
    }).transform({
        code: tupleFunctionSource,
        fileName: tupleFunctionFile
    });

    assert.deepEqual(tupleFunctionResult.diagnostics, []);
    assert.match(tupleFunctionResult.code, /\(\[apply, input\]\) => \[apply\(input\), input\]/);
    assert.doesNotMatch(tupleFunctionResult.code, /isArray|isFunction|return \[\]/);

    const nestedTupleFile = path.join(programDirectory, 'nested-tuple.ts');
    const nestedTupleSource = [
        'type Pair = [[string, (value: string) => string], string];',
        'type Mapper = { map: <B>(value: unknown, callback: (pair: Pair) => B) => B };',
        'export const passPair = (F: Mapper, value: unknown) => F.map(value, ([[label, apply], state]) => [label, apply(state)]);',
        ''
    ].join('\n');
    await writeFile(nestedTupleFile, nestedTupleSource);
    const nestedTupleProgram = createFixtureProgram([nestedTupleFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const nestedTupleResult = createTypeScriptTransformer({
        typescript,
        program: nestedTupleProgram,
        standard: {
            array: '../analysis/host/array.js',
            function: '../analysis/host/function.js'
        }
    }).transform({
        code: nestedTupleSource,
        fileName: nestedTupleFile
    });

    assert.deepEqual(nestedTupleResult.diagnostics, []);
    assert.match(nestedTupleResult.code, /\(\[\[label, apply\], state\]\) => \[label, apply\(state\)\]/);
    assert.doesNotMatch(nestedTupleResult.code, /isArray|isFunction|= \[\]|return \[\]/);
    const nestedTupleRuntimeFile = path.join(programDirectory, 'nested-tuple.js');
    await writeFile(nestedTupleRuntimeFile, nestedTupleResult.code
        .replace("import { isArray } from '../analysis/host/array.js';", 'const isArray = Array.isArray;')
        .replace("import { isFunction } from '../analysis/host/function.js';", "const isFunction = value => typeof value === 'function';"));
    const { href: nestedTupleHref = '' } = pathToFileURL(nestedTupleRuntimeFile);
    const { passPair = false } = await import(nestedTupleHref);
    let nestedCalls = [];
    const nestedMapper = {
        map(value, callback) {
            nestedCalls = [...nestedCalls, { value, callback }];

            return callback(value);
        }
    };

    assert.deepEqual(passPair(nestedMapper, [['label', value => value.toUpperCase()], 'ready']), ['label', 'READY']);
    assert.throws(() => passPair(nestedMapper, []), TypeError);
    assert.throws(() => passPair(nestedMapper, ['not-a-pair', 'ready']), TypeError);
    assert.throws(() => passPair(nestedMapper, [['label', false], 'ready']), TypeError);
    assert.equal(nestedCalls.length, 4);
    assert.ok(nestedCalls.every(({ callback = false } = {}) => typeof callback === 'function'));

    const sideEffectFile = path.join(programDirectory, 'side-effect-loop.ts');
    const sideEffectSource = [
        'export const notify = (values: number[]) => {',
        '    for (const value of values) process(value);',
        '};',
        'export const notifyEntries = (record: Record<string, number>) => {',
        '    for (const [key, value] of Object.entries(record)) process(key, value);',
        '};',
        ''
    ].join('\n');

    await writeFile(sideEffectFile, sideEffectSource);
    const sideEffectProgram = createFixtureProgram([sideEffectFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const sideEffectFacts = collectLiveArrayVisitationContracts({
        typescript,
        sourceFile: sideEffectProgram.getSourceFile(sideEffectFile),
        checker: sideEffectProgram.getTypeChecker()
    });

    assert.equal(sideEffectFacts.size, 2);
    const sideEffectResult = createTypeScriptTransformer({
        typescript,
        program: sideEffectProgram
    }).transform({
        code: sideEffectSource,
        fileName: sideEffectFile
    });

    assert.deepEqual(sideEffectResult.diagnostics, []);
    assert.match(sideEffectResult.code, /for \(const value of values\)/);
    assert.match(sideEffectResult.code, /for \(const \[key, value\] of Object\.entries\(record\)\)/);
    assert.doesNotMatch(sideEffectResult.code, /\[key = "", value = 0\]/);
    assert.doesNotMatch(sideEffectResult.code, /\.forEach\(/);

    const collectionFile = path.join(programDirectory, 'collection-accumulators.ts');
    const collectionSource = [
        'export const unique = (values: number[]) => {',
        '    const output = new Set<number>();',
        '    for (const value of values) output.add(value);',
        '    return output;',
        '};',
        'export const doubledSet = (values: number[]) => {',
        '    const output = new Set<number>();',
        '    for (const value of values) output.add(value * 2);',
        '    return output;',
        '};',
        'export const positiveDoubledSet = (values: number[]) => {',
        '    const output = new Set<number>();',
        '    for (const value of values) {',
        '        if (value > 0) output.add(value * 2);',
        '    }',
        '    return output;',
        '};',
        'export const copy = (values: number[]) => {',
        '    const output: number[] = [];',
        '    for (const value of values) output.push(value);',
        '    return output;',
        '};',
        'export const uniqueByState = (values: number[]) => {',
        '    const output: number[] = [];',
        '    for (const value of values) {',
        '        if (!output.includes(value)) output.push(value);',
        '    }',
        '    return output;',
        '};',
        'export const sum = (values: number[]) => {',
        '    let total = 0;',
        '    for (const value of values) total += value;',
        '    return total;',
        '};',
        'export const maximum = (values: number[]) => {',
        '    let total = 0;',
        '    for (const value of values) total = Math.max(total, value);',
        '    return total;',
        '};',
        'export const doubled = (values: number[]) => {',
        '    const output: number[] = [];',
        '    for (const value of values) output.push(value * 2);',
        '    return output;',
        '};',
        'export const positive = (values: number[]) => {',
        '    const output: number[] = [];',
        '    for (const value of values) if (value > 0) output.push(value);',
        '    return output;',
        '};',
        'export const positiveDoubled = (values: number[]) => {',
        '    const output: number[] = [];',
        '    for (const value of values) {',
        '        if (value > 0) output.push(value * 2);',
        '    }',
        '    return output;',
        '};',
        'export const indexed = (entries: [string, number][]) => {',
        '    const output = new Map<string, number>();',
        '    for (const [key, value] of entries) output.set(key, value);',
        '    return output;',
        '};',
        'export const remapped = (entries: [string, number][]) => {',
        '    const output = new Map<string, number>();',
        '    for (const [key, value] of entries) output.set(key.toUpperCase(), value * 2);',
        '    return output;',
        '};',
        'export const positiveIndexed = (entries: [string, number][]) => {',
        '    const output = new Map<string, number>();',
        '    for (const [key, value] of entries) {',
        '        if (value > 0) output.set(key, value);',
        '    }',
        '    return output;',
        '};',
        'export const positiveRemapped = (entries: [string, number][]) => {',
        '    const output = new Map<string, number>();',
        '    for (const [key, value] of entries) {',
        '        if (value > 0) output.set(key.toUpperCase(), value * 2);',
        '    }',
        '    return output;',
        '};',
        'export const materializedMapFrom = (source: ReadonlyMap<string, number>) => {',
        '    const output = new Map<string, number>();',
        '    for (const [key, value] of Array.from(source.entries())) {',
        '        if (value > 0) output.set(key, value * 2);',
        '    }',
        '    return output;',
        '};',
        'export const materializedMapSpread = (source: ReadonlyMap<string, number>) => {',
        '    const output = new Map<string, number>();',
        '    for (const [key, value] of [...source]) output.set(key, value * 2);',
        '    return output;',
        '};',
        'export const materializedSetFrom = (source: ReadonlySet<number>) => {',
        '    const output = new Set<number>();',
        '    for (const value of Array.from(source.values())) {',
        '        if (value > 0) output.add(value * 2);',
        '    }',
        '    return output;',
        '};',
        'export const materializedSetSpread = (source: ReadonlySet<number>) => {',
        '    const output = new Set<number>();',
        '    for (const value of [...source]) output.add(value * 2);',
        '    return output;',
        '};',
        'export const retainLiveMap = (source: ReadonlyMap<string, number>) => {',
        '    const output = new Map<string, number>();',
        '    for (const [key, value] of source) {',
        '        if (value > 0) output.set(key, value * 2);',
        '    }',
        '    return output;',
        '};',
        'export const retainLiveSet = (source: ReadonlySet<number>) => {',
        '    const output = new Set<number>();',
        '    for (const value of source) output.add(value * 2);',
        '    return output;',
        '};',
        'export const objectIndex = (entries: [string, number][]) => {',
        '    const output: Record<string, number> = {};',
        '    for (const [key, value] of entries) output[key] = value;',
        '    return output;',
        '};',
        'export const objectIndexAdjacent = (entries: [string, number][]) => {',
        '    const offset = 0;',
        '    const output: Record<string, number> = {};',
        '    for (const [key, value] of entries.slice(offset)) output[key] = value;',
        '    return output;',
        '};',
        'export const updateRecord = (record: Record<string, number>, key: string, value: number) => {',
        '    const output: Record<string, number> = Object.assign({}, record);',
        '    output[key] = value;',
        '    return output;',
        '};',
        ''
    ].join('\n');

    await writeFile(collectionFile, collectionSource);
    const collectionProgram = createFixtureProgram([collectionFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const collectionResult = createTypeScriptTransformer({
        typescript,
        program: collectionProgram
    }).transform({
        code: collectionSource,
        fileName: collectionFile
    });

    assert.deepEqual(collectionResult.diagnostics, []);
    assert.match(collectionResult.code, /new Map\(Array\.from\(source\.entries\(\)\)\.flatMap\(/);
    assert.match(collectionResult.code, /export const retainLiveMap = \(source\) => \{[\s\S]*for \(const \[key, value\] of source\)[\s\S]*if \(value > 0\)[\s\S]*output\.set\(key, value \* 2\);/);
    assert.match(collectionResult.code, /export const retainLiveSet = \(source\) => \{[\s\S]*for \(const value of source\)[\s\S]*output\.add\(value \* 2\);/);
    assert.doesNotMatch(collectionResult.code, /new Map\(Array\.from\(source\)\.reduce\(/);
    assert.doesNotMatch(collectionResult.code, /new Set\(Array\.from\(source\)\.reduce\(/);
    assert.match(collectionResult.code, /new Map\(\[\.\.\.source\]\.flatMap\(/);
    assert.match(collectionResult.code, /new Set\(Array\.from\(source\.values\(\)\)\.flatMap\(/);
    assert.match(collectionResult.code, /new Set\(\[\.\.\.source\]\.flatMap\(/);
    assert.doesNotMatch(collectionResult.code, /Array\.from\(Array\.from\(source/);
    assert.doesNotMatch(collectionResult.code, /Array\.from\(\[\.\.\.source\]\)/);
    const [collectionOutputLint = {}] = await outputEslint.lintText(collectionResult.code, {
        filePath: 'collection-generated.js'
    });
    assert.equal(collectionOutputLint.errorCount, 0, JSON.stringify(collectionOutputLint.messages));
    assert.equal(collectionOutputLint.warningCount, 0, JSON.stringify(collectionOutputLint.messages));

    const [{ errorCount: fixedCollectionErrors = 0, output: fixedCollectionCode = collectionResult.code } = {}]
        = await fixedCollectionEslint.lintText(collectionResult.code, { filePath: 'collection-generated.js' });

    assert.equal(fixedCollectionErrors, 0);

    const rawCollectionFile = path.join(programDirectory, 'collection-raw.js');
    const fixedCollectionFile = path.join(programDirectory, 'collection-fixed.js');

    await writeFile(rawCollectionFile, collectionResult.code);
    await writeFile(fixedCollectionFile, fixedCollectionCode);

    const rawCollections = await import(pathToFileURL(rawCollectionFile).href);
    const fixedCollections = await import(pathToFileURL(fixedCollectionFile).href);
    const { outputText: baselineCollectionCode = '' } = typescript.transpileModule(collectionSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const baselineCollectionFile = path.join(programDirectory, 'collection-baseline.js');

    await writeFile(baselineCollectionFile, baselineCollectionCode);
    const baselineCollections = await import(pathToFileURL(baselineCollectionFile).href);
    const recordEntries = [['__proto__', 0], ['value', 2]];

    [baselineCollections, rawCollections, fixedCollections].forEach(({
        objectIndex = false, objectIndexAdjacent = false
    } = {}) => {
        [objectIndex, objectIndexAdjacent].forEach((rebuild) => {
            const record = rebuild(recordEntries);
            const { value: recordValue = 0 } = record;

            assert.deepEqual(Reflect.ownKeys(record), ['value']);
            assert.equal(Object.getPrototypeOf(record), Object.prototype);
            assert.equal(recordValue, 2);
            const poisoned = ['key', 1];

            Object.defineProperty(poisoned, Symbol.iterator, {
                get() { throw new Error('entry iterator'); }
            });
            assert.throws(() => rebuild([poisoned]), /entry iterator/);
        });
    });
    [baselineCollections, rawCollections, fixedCollections].forEach(({ updateRecord = false } = {}) => {
        const record = updateRecord({ value: 2 }, '__proto__', 0);

        assert.deepEqual(Reflect.ownKeys(record), ['value']);
        assert.equal(Object.getPrototypeOf(record), Object.prototype);
    });
    const runMaterialized = ({ materializedMapFrom = false, materializedSetSpread = false } = {}) => {
        let advances = 0;
        const map = new Map();
        const set = new Set();

        Object.defineProperty(map, 'entries', {
            value: function* entries() {
                advances += 1;
                yield ['key', 1];
                advances += 1;
                yield ['key', 3];
                advances += 1;
                yield ['zero', 0];
            }
        });
        Object.defineProperty(set, Symbol.iterator, {
            value: function* values() {
                advances += 1;
                yield -1;
                advances += 1;
                yield 0;
                advances += 1;
                yield 2;
            }
        });
        const mapEntries = [...materializedMapFrom(map)];
        const setValues = [...materializedSetSpread(set)];

        return { advances, mapEntries, setValues };
    };

    assert.deepEqual(runMaterialized(baselineCollections), {
        advances: 6,
        mapEntries: [['key', 6]],
        setValues: [-2, 0, 4]
    });
    assert.deepEqual(runMaterialized(rawCollections), runMaterialized(baselineCollections));
    assert.deepEqual(runMaterialized(fixedCollections), runMaterialized(baselineCollections));
    [baselineCollections, rawCollections, fixedCollections].forEach(({ materializedMapFrom = false } = {}) => {
        const malformed = new Map();

        Object.defineProperty(malformed, 'entries', {
            value: function* entries() { yield null; }
        });
        assert.throws(() => materializedMapFrom(malformed), TypeError);
    });

    [rawCollections, fixedCollections].forEach(({
        indexed = false, remapped = false, positiveIndexed = false, positiveRemapped = false,
        materializedMapFrom = false, materializedMapSpread = false,
        materializedSetFrom = false, materializedSetSpread = false,
        retainLiveMap = false, retainLiveSet = false,
        objectIndex = false, updateRecord = false
    } = {}) => {
        if (typeof indexed !== 'function' || typeof remapped !== 'function' ||
            typeof positiveIndexed !== 'function' || typeof positiveRemapped !== 'function' || typeof objectIndex !== 'function' ||
            typeof updateRecord !== 'function' || typeof materializedMapFrom !== 'function' ||
            typeof materializedMapSpread !== 'function' || typeof materializedSetFrom !== 'function' ||
            typeof materializedSetSpread !== 'function' || typeof retainLiveMap !== 'function' ||
            typeof retainLiveSet !== 'function') {
            assert.fail('Collection exports must remain callable');
        }

        const entries = [['a', -1], ['b', 2], ['a', 3]];

        assert.deepEqual([...indexed(entries)], [['a', 3], ['b', 2]]);
        assert.deepEqual([...remapped(entries)], [['A', 6], ['B', 4]]);
        assert.deepEqual([...positiveIndexed(entries)], [['b', 2], ['a', 3]]);
        assert.deepEqual([...positiveRemapped(entries)], [['B', 4], ['A', 6]]);
        assert.deepEqual(objectIndex(entries), { a: 3, b: 2 });
        assert.deepEqual(updateRecord({ a: 1 }, 'b', 2), { a: 1, b: 2 });
        assert.deepEqual([...remapped([])], []);
        assert.deepEqual(entries, [['a', -1], ['b', 2], ['a', 3]]);
        assert.deepEqual([...materializedMapFrom(new Map([['a', -1], ['b', 2], ['c', 0]]))], [['b', 4]]);
        assert.deepEqual([...materializedMapSpread(new Map([['a', 1], ['b', 2]]))], [['a', 2], ['b', 4]]);
        assert.deepEqual([...materializedSetFrom(new Set([-1, 0, 2, 2]))], [4]);
        assert.deepEqual([...materializedSetSpread(new Set([-1, 0, 2, 2]))], [-2, 0, 4]);
        assert.deepEqual([...retainLiveMap(new Map([['a', -1], ['b', 2], ['a', 3]]))], [['a', 6], ['b', 4]]);
        assert.deepEqual([...retainLiveSet(new Set([-1, 0, 2, 2]))], [-2, 0, 4]);
    });
    [rawCollections, fixedCollections].forEach(({
        uniqueByState = false, doubled = false, positiveDoubled = false, doubledSet = false,
        positiveDoubledSet = false, sum = false, maximum = false
    } = {}) => {
        if (typeof uniqueByState !== 'function' || typeof doubled !== 'function' || typeof positiveDoubled !== 'function') {
            assert.fail('Array collection exports must remain callable');
        }

        if (typeof doubledSet !== 'function' || typeof positiveDoubledSet !== 'function') {
            assert.fail('Set collection exports must remain callable');
        }

        if (typeof sum !== 'function' || typeof maximum !== 'function') assert.fail('Scalar exports must remain callable');

        const values = [-1, 2, 2, 0, 3];

        assert.equal(sum(values), 6);
        assert.equal(maximum(values), 3);
        assert.equal(sum([]), 0);
        assert.deepEqual(uniqueByState(values), [-1, 2, 0, 3]);
        assert.deepEqual(doubled(values), [-2, 4, 4, 0, 6]);
        assert.deepEqual(positiveDoubled(values), [4, 4, 6]);
        assert.deepEqual([...doubledSet(values)], [-2, 4, 0, 6]);
        assert.deepEqual([...positiveDoubledSet(values)], [4, 6]);
        assert.deepEqual(uniqueByState([]), []);
        assert.deepEqual(values, [-1, 2, 2, 0, 3]);
    });

    const genericFile = path.join(programDirectory, 'generic.ts');
    const genericSource = [
        'interface Box<T> { value: T; }',
        'export const readBox = <T>(box: Box<T>) => {',
        '    return box.value;',
        '};',
        'export const compareBoxes = <T>(inbound: Box<T>, outbound: Box<T>) => inbound.value === outbound.value;',
        ''
    ].join('\n');

    await writeFile(genericFile, genericSource);
    const genericProgram = createFixtureProgram([genericFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const genericResult = createTypeScriptTransformer({
        typescript,
        program: genericProgram,
        standard: { object: path.resolve('analysis/host/object.js') }
    }).transform({
        code: genericSource,
        fileName: genericFile
    });

    assert.deepEqual(genericResult.diagnostics, []);
    assert.match(genericResult.code, /readBox = \(box\) => [\s\S]*return \([\s\S]*?\(\{ value: boxValue \}\) => \{[\s\S]*?return boxValue;[\s\S]*?\}\)\(box\)/);
    assert.match(genericResult.code, /compareBoxes =[\s\S]*?\(\{ value: inboundValue \}, \{ value: outboundValue \}\)/);
    assert.doesNotMatch(genericResult.code, /(?:box|inbound|outbound)\.value/);

    const indexedFile = path.join(programDirectory, 'indexed.ts');
    const indexedSource = 'export const first = (arr: string[]) => arr[0];\n';
    await writeFile(indexedFile, indexedSource);
    const indexedProgram = createFixtureProgram([indexedFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const indexedResult = createTypeScriptTransformer({
        typescript,
        program: indexedProgram
    }).transform({
        code: indexedSource,
        fileName: indexedFile
    });

    assert.deepEqual(indexedResult.diagnostics, []);
    assert.match(indexedResult.code, /first = \(\[arr0 = ["']?["']?\]\) => arr0/);
    assert.doesNotMatch(indexedResult.code, /arr\[0\]/);

    const dynamicIndexedFile = path.join(programDirectory, 'dynamic-indexed.ts');
    const dynamicIndexedSource = [
        'export const previous = (arr: string[], n: number) => {',
        '    const value = arr[n - 1];',
        '    return value;',
        '};',
        ''
    ].join('\n');
    await writeFile(dynamicIndexedFile, dynamicIndexedSource);
    const dynamicIndexedProgram = createFixtureProgram([dynamicIndexedFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const dynamicIndexedResult = createTypeScriptTransformer({
        typescript,
        program: dynamicIndexedProgram
    }).transform({
        code: dynamicIndexedSource,
        fileName: dynamicIndexedFile
    });

    assert.deepEqual(dynamicIndexedResult.diagnostics, []);
    assert.match(dynamicIndexedResult.code, /const \{ \[n - 1\]: value = ["']?["']? \} = arr/);
    assert.doesNotMatch(dynamicIndexedResult.code, /arr\[n - 1\]/);

    const memberInitializerFile = path.join(programDirectory, 'member-initializer.ts');
    const memberInitializerSource = [
        'type Pair<A> = { value: [A, A] };',
        'export const readPair = <A>(pair: Pair<A>) => {',
        '    const [inbound, outbound] = pair.value;',
        '    return [inbound, outbound];',
        '};',
        'type Entry = { value: [string, unknown] };',
        'export const readEntry = (entry: Entry) => {',
        '    const current = entry;',
        '    const [key, value] = current.value;',
        '    return [key, value];',
        '};',
        'export const lookup = (record: Record<string, string>, key: string) => record[key];',
        ''
    ].join('\n');
    await writeFile(memberInitializerFile, memberInitializerSource);
    const memberInitializerProgram = createFixtureProgram([memberInitializerFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const memberInitializerResult = createTypeScriptTransformer({
        typescript,
        program: memberInitializerProgram
    }).transform({
        code: memberInitializerSource,
        fileName: memberInitializerFile
    });

    assert.deepEqual(memberInitializerResult.diagnostics, []);
    assert.match(memberInitializerResult.code, /const readPair = \(pair\) =>/);
    assert.match(memberInitializerResult.code, /const \{ value: \[inbound, outbound\] \} = pair;/);
    assert.match(memberInitializerResult.code, /const \{ value: \[key, value\] \} = current;/);
    assert.match(memberInitializerResult.code, /required tuple retains native missing-value failure/);
    assert.doesNotMatch(memberInitializerResult.code, /\{ values: current\.value \}/);
    assert.doesNotMatch(memberInitializerResult.code, /\{ values: \[inbound, outbound\] \} = \{ values: pairValue \}/);
    assert.match(memberInitializerResult.code, /record\[key\]/);
    const indexedBoundaryFacts = collectIndexedOperationContracts({
        typescript,
        sourceFile: memberInitializerProgram.getSourceFile(memberInitializerFile),
        checker: memberInitializerProgram.getTypeChecker()
    });
    const [indexedReadFact = {}] = [...indexedBoundaryFacts.values()];
    const indexedReadAgreements = collectDestructuringAgreements({
        typescript,
        indexedOperationContracts: indexedBoundaryFacts
    });
    const [indexedReadEntry = {}] = indexedReadAgreements.get(indexedReadFact.sourceRange) || [];
    const indexedReadDecision = getDestructuringAgreement({ entry: indexedReadEntry });

    assert.equal(indexedReadFact.action, 'retain-indexed-read');
    assert.equal(indexedReadDecision.action, 'retain-indexed-read');
    assert.equal(indexedReadDecision.grammar, 'retain-source-indexed-operation');
    assert.match(indexedReadFact.sourceRange, /^\d+:\d+$/);
    assert.match(memberInitializerResult.code, /Get order/);
    assert.doesNotMatch(memberInitializerResult.code, /Missing required agreement for indexed value/);
    assert.doesNotMatch(memberInitializerResult.code, /_resilientIndex_/);
    const memberInitializerRuntimeFile = path.join(programDirectory, 'member-initializer.js');
    await writeFile(memberInitializerRuntimeFile, memberInitializerResult.code);
    const memberInitializerUrl = pathToFileURL(memberInitializerRuntimeFile);
    const { href: memberInitializerHref = '' } = memberInitializerUrl;
    const { lookup = () => '', readEntry = () => [], readPair = () => [] } = await import(memberInitializerHref);
    assert.equal(lookup({ value: 'kept' }, 'value'), 'kept');
    assert.equal(lookup({ value: '' }, 'value'), '');
    // eslint-disable-next-line resilient/no-falsifiable-property-key -- This adversarial runtime fixture preserves an incoming empty key through dynamic TypeScript lowering.
    assert.equal(lookup({ '': 'baseValue key' }, ''), 'baseValue key');
    assert.equal(lookup({}, 'missing'), undefined);
    assert.equal(lookup(Array(1), 0), undefined);
    assert.equal(lookup([], 1), undefined);
    let lookupReads = 0;
    const lookupSource = {
        get value() {
            lookupReads += 1;

            // eslint-disable-next-line resilient/prefer-falsey-returns -- The getter proves indexed reads preserve an explicit undefined result.
            return undefined;
        }
    };

    assert.equal(lookup(lookupSource, 'value'), undefined);
    assert.equal(lookupReads, 1);
    assert.throws(() => lookup(null, 'value'), TypeError);

    const dynamicBoundarySource = `
            export const read = (record: Record<string, string>, key: string) => {
                const value = record[key];
                return value;
            };
            export const write = (out: Record<string, string>, source: Record<string, string>, key: string) => {
                out[key] = source[key];
                return out[key];
            };
            // eslint-disable-next-line resilient/prefer-safe-transformations -- This indexed-delete proof must preserve the source-owned target, getter timing, and native failure phase.
            export const remove = (getOut: () => Record<string, string>, key: string) => delete getOut()[key];
            export const increment = (out: Record<string, number>, key: string) => out[key]++;
            export const staticRead = (record: { value: string }) => record.value;
        `;
    const dynamicBoundaryResult = transform({
        code: dynamicBoundarySource,
        fileName: 'dynamic-boundary.ts'
    });

    assert.deepEqual(dynamicBoundaryResult.diagnostics, []);
    assert.match(dynamicBoundaryResult.code, /Get order/);
    assert.match(dynamicBoundaryResult.code, /Indexed update preserves key, mutation and result phase/);
    assert.match(dynamicBoundaryResult.code, /Indexed update preserves key, mutation and result phase/);
    assert.doesNotMatch(dynamicBoundaryResult.code, /indexed access retained to preserve explicit key semantics/);
    assert.match(dynamicBoundaryResult.code, /out\[key\][\s\S]*?=\s*(?:\([\s\S]*?)?source\[key\]/);
    assert.match(dynamicBoundaryResult.code, /delete\s+[\s\S]*getOut\(\)\[key\]/);
    assert.match(dynamicBoundaryResult.code, /out\[key\][^;]*\+\+/);
    assert.doesNotMatch(dynamicBoundaryResult.code, /record\.value[^\n]*Get order/);
    assert.doesNotMatch(dynamicBoundaryResult.code, /Missing required agreement for indexed value/);
    assert.doesNotMatch(dynamicBoundaryResult.code, /_resilientIndex_/);
    const dynamicBoundaryOutput = typescript.createSourceFile(
        'dynamic-boundary-generated.js',
        dynamicBoundaryResult.code,
        typescript.ScriptTarget.ESNext,
        true,
        typescript.ScriptKind.JS
    );

    assert.deepEqual(dynamicBoundaryOutput.parseDiagnostics, []);
    const indexedOperationFile = path.join(programDirectory, 'indexed-operation.ts');
    await writeFile(indexedOperationFile, dynamicBoundarySource);
    const indexedOperationProgram = createFixtureProgram([indexedOperationFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const indexedOperationResult = createTypeScriptTransformer({
        typescript,
        program: indexedOperationProgram
    }).transform({ code: dynamicBoundarySource, fileName: indexedOperationFile });

    assert.deepEqual(indexedOperationResult.diagnostics, []);
    assert.match(indexedOperationResult.code, /Get order/);
    assert.match(indexedOperationResult.code, /Indexed update preserves key, mutation and result phase/);
    assert.match(indexedOperationResult.code, /Indexed update preserves key, mutation and result phase/);
    assert.doesNotMatch(indexedOperationResult.code, /Dynamic indexed write\/delete retains source key/);
    const [indexedOperationRawLint = {}] = await outputEslint.lintText(indexedOperationResult.code, {
        filePath: 'indexed-operation-generated.js'
    });
    const indexedFixedEslint = new ESLint({
        fix: true,
        overrideConfigFile: true,
        overrideConfig: [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety]
    });
    const [indexedOperationFixedLint = {}] = await indexedFixedEslint.lintText(indexedOperationResult.code, {
        filePath: 'indexed-operation-generated.js'
    });

    assert.equal(indexedOperationRawLint.errorCount, 0, JSON.stringify(indexedOperationRawLint.messages));
    assert.equal(indexedOperationFixedLint.errorCount, 0, JSON.stringify(indexedOperationFixedLint.messages));
    const { outputText: dynamicIndexedReferenceCode = '' } = typescript.transpileModule(dynamicBoundarySource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const dynamicIndexedReferenceFile = path.join(programDirectory, 'indexed-operation-reference.js');
    const dynamicIndexedGeneratedFile = path.join(programDirectory, 'indexed-operation-generated.js');

    await writeFile(dynamicIndexedReferenceFile, dynamicIndexedReferenceCode);
    await writeFile(dynamicIndexedGeneratedFile, indexedOperationResult.code);
    const dynamicIndexedReference = await import(pathToFileURL(dynamicIndexedReferenceFile).href);
    const dynamicIndexedGenerated = await import(pathToFileURL(dynamicIndexedGeneratedFile).href);
    const exerciseIndexedOperation = ({ read = false, write = false, remove = false, increment = false } = {}) => {
        let events = '';
        const target = { key: '' };
        const record = new Proxy(target, {
            get(value, key) {
                events += `get:${String(key)};`;

                return Reflect.get(value, key);
            },
            set(value, key, next) {
                events += `set:${String(key)}:${String(next)};`;

                // eslint-disable-next-line resilient/prefer-safe-transformations -- The proxy trap deliberately records the source write on its original target.
                return Reflect.set(value, key, next);
            },
            deleteProperty(value, key) {
                events += `delete:${String(key)};`;

                return Reflect.deleteProperty(value, key);
            }
        });
        const sourceValues = { key: 'next' };
        const readResult = read(record, 'key');
        const writeResult = write(record, sourceValues, 'key');
        const sameIdentity = writeResult === record;
        const removed = remove(() => record, 'key');
        const counter = { key: 0 };
        const prior = increment(counter, 'key');
        const { key: next = 0 } = counter;

        return { readResult, sameIdentity, removed, prior, next,
            hasKey: Object.hasOwn(target, 'key'), events };
    };

    assert.deepEqual(exerciseIndexedOperation(dynamicIndexedGenerated), exerciseIndexedOperation(dynamicIndexedReference));
    assert.throws(() => dynamicIndexedGenerated.read(null, 'key'), TypeError);
    assert.throws(() => dynamicIndexedReference.read(null, 'key'), TypeError);
    const unusedBindingSource = [
        'export const ignoredParameter = (ignored: number, value: number) => value;',
        'export const caught = () => { try { throw 4; } catch (ignored) { return 7; } };',
        'export const next = ([ignored, value]: readonly [number, number]) => value;',
        'export const used = (value: number) => value;',
        'export const contextual: (value: number) => number = () => 9;',
        'export const applied = () => contextual(3);',
        'export const predicate = (value: unknown): value is string => true;',
        'export function impossible(value: never): never { throw new Error("impossible"); }',
        ''
    ].join('\n');
    const unusedBindingFile = path.join(programDirectory, 'unused-binding.ts');
    await writeFile(unusedBindingFile, unusedBindingSource);
    const unusedBindingProgram = createFixtureProgram([unusedBindingFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const effectfulBindingFile = path.join(programDirectory, 'effectful-unused-binding.ts');
    await writeFile(effectfulBindingFile, [
        'export const retained = ([ignored = effect(), value]: [number | undefined, number], effect: () => number) => value;',
        'export const shorthand = ([first, rest]: readonly [number, number]) => ({ first, rest });'
    ].join('\n'));
    const effectfulBindingProgram = createFixtureProgram([effectfulBindingFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });

    assert.equal(collectUnusedBindingContracts({
        typescript,
        sourceFile: effectfulBindingProgram.getSourceFile(effectfulBindingFile),
        checker: effectfulBindingProgram.getTypeChecker()
    }).size, 0);
    const typedProviderFile = path.join(programDirectory, 'typed-ignored-provider.ts');
    const typedConsumerFile = path.join(programDirectory, 'typed-ignored-consumer.ts');
    const typedConsumerSource = [
        "import { contextual as imported } from './typed-ignored-provider';",
        'export const applyImported = () => imported(3);'
    ].join('\n');
    await writeFile(typedProviderFile,
        'export const contextual: (value: number) => number = () => 9;');
    await writeFile(typedConsumerFile, typedConsumerSource);
    const typedAliasProgram = createFixtureProgram([typedProviderFile, typedConsumerFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const typedAliasFacts = collectTypedIgnoredArgumentCallContracts({
        typescript,
        sourceFile: typedAliasProgram.getSourceFile(typedConsumerFile),
        checker: typedAliasProgram.getTypeChecker()
    });

    assert.equal(typedAliasFacts.size, 1);
    const typedAliasResult = createTypeScriptTransformer({
        typescript,
        program: typedAliasProgram
    }).transform({ code: typedConsumerSource, fileName: typedConsumerFile });

    assert.deepEqual(typedAliasResult.diagnostics, []);
    assert.match(typedAliasResult.code, /checker-declared parameters are ignored/);
    const [typedAliasLint = {}] = await outputEslint.lintText(typedAliasResult.code, {
        filePath: 'typed-ignored-consumer-generated.js'
    });

    assert.equal(typedAliasLint.messages.filter(({ ruleId = '' } = {}) => (
        ruleId === 'resilient/signature-contract-call-site'
    )).length, 0, JSON.stringify(typedAliasLint.messages));
    const resolvedCallFile = path.join(programDirectory, 'resolved-source-calls.ts');
    const resolvedCallSource = [
        'export function stitch(last: number[]): (first: number[]) => number[];',
        'export function stitch(first: number[], last: number[]): number[];',
        'export function stitch(first: number[], last?: number[]): number[] | ((start: number[]) => number[]) {',
        '    return last === undefined ? start => start.concat(first) : first.concat(last);',
        '}',
        'export const partial = (tail: number[]) => stitch(tail);',
        'export const nestedPartial = (tail: number[]) => (head: number[]) => stitch(tail)(head);',
        'export const direct = (head: number[], tail: number[]) => stitch(head, tail);',
        'export const nested = (value: number) => {',
        '    function visit(inbound: number, outbound: number): number { return inbound + outbound; }',
        '    const outer = visit(1, value);',
        '    return (() => {',
        '        function visit(next: number): number { return next * 2; }',
        '        return visit(outer);',
        '    })();',
        '};',
        'export const mixed = (value: number) => {',
        '    const apply = (inbound: number, outbound: number): number => inbound + outbound;',
        '    const outer = apply(1, value);',
        '    return (() => {',
        '        function apply(next: number): number { return next * 2; }',
        '        return apply(outer);',
        '    })();',
        '};',
        ''
    ].join('\n');
    await writeFile(resolvedCallFile, resolvedCallSource);
    const resolvedCallProgram = createFixtureProgram([resolvedCallFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const resolvedCallResult = createTypeScriptTransformer({
        typescript,
        program: resolvedCallProgram
    }).transform({ code: resolvedCallSource, fileName: resolvedCallFile });

    assert.deepEqual(resolvedCallResult.diagnostics, []);
    assert.match(resolvedCallResult.code, /checker-selected overload returns a callable/);
    assert.doesNotMatch(resolvedCallResult.code, /checker resolves the lexical declaration/);
    assert.match(resolvedCallResult.code, /stitch\(tail\)/);
    assert.match(resolvedCallResult.code, /visit\(outer\)/);
    const [resolvedCallRawLint = {}] = await outputEslint.lintText(resolvedCallResult.code, {
        filePath: 'resolved-source-calls-generated.js'
    });
    const [resolvedCallFixedLint = {}] = await indexedFixedEslint.lintText(resolvedCallResult.code, {
        filePath: 'resolved-source-calls-generated.js'
    });

    [resolvedCallRawLint, resolvedCallFixedLint].forEach(({ messages = [] } = {}) => {
        assert.equal(messages.filter(({ ruleId = '' } = {}) => (
            ruleId === 'resilient/signature-contract-call-site'
        )).length, 0, JSON.stringify(messages));
    });
    const { outputText: resolvedCallReferenceCode = '' } = typescript.transpileModule(resolvedCallSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const resolvedCallReferenceFile = path.join(programDirectory, 'resolved-source-calls-reference.js');
    const resolvedCallGeneratedFile = path.join(programDirectory, 'resolved-source-calls-generated.js');

    await writeFile(resolvedCallReferenceFile, resolvedCallReferenceCode);
    await writeFile(resolvedCallGeneratedFile, resolvedCallResult.code);
    const resolvedCallReference = await import(pathToFileURL(resolvedCallReferenceFile).href);
    const resolvedCallGenerated = await import(pathToFileURL(resolvedCallGeneratedFile).href);

    assert.deepEqual(resolvedCallGenerated.partial([3])([1, 2]), resolvedCallReference.partial([3])([1, 2]));
    assert.deepEqual(resolvedCallGenerated.nestedPartial([3])([1, 2]),
        resolvedCallReference.nestedPartial([3])([1, 2]));
    assert.deepEqual(resolvedCallGenerated.direct([1, 2], [3]), resolvedCallReference.direct([1, 2], [3]));
    assert.equal(resolvedCallGenerated.nested(3), resolvedCallReference.nested(3));
    assert.equal(resolvedCallGenerated.mixed(3), resolvedCallReference.mixed(3));
    const rejectedCallFile = path.join(programDirectory, 'rejected-source-calls.ts');
    const rejectedCallSource = [
        'function plain(first: number, second: number): number { return first + second; }',
        'export const missing = () => plain(1);',
        'export const computed = (value: { call: (n: number) => number }) => value.call(1);',
        ''
    ].join('\n');
    await writeFile(rejectedCallFile, rejectedCallSource);
    const rejectedCallProgram = createFixtureProgram([rejectedCallFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });

    assert.equal(collectResolvedSourceCallContracts({
        typescript,
        sourceFile: rejectedCallProgram.getSourceFile(rejectedCallFile),
        checker: rejectedCallProgram.getTypeChecker()
    }).size, 0);
    const typedForwardFile = path.join(programDirectory, 'typed-ignored-forward.ts');
    const typedChainedFile = path.join(programDirectory, 'typed-ignored-chained.ts');
    await writeFile(typedForwardFile, [
        "import * as Provider from './typed-ignored-provider';",
        'export const forwarded: (value: number) => number = Provider.contextual;'
    ].join('\n'));
    await writeFile(typedChainedFile, [
        "import { forwarded } from './typed-ignored-forward';",
        'export const applyForwarded = () => forwarded(3);'
    ].join('\n'));
    const typedChainedProgram = createFixtureProgram([
        typedProviderFile, typedForwardFile, typedChainedFile
    ], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });

    assert.equal(collectTypedIgnoredArgumentCallContracts({
        typescript,
        sourceFile: typedChainedProgram.getSourceFile(typedChainedFile),
        checker: typedChainedProgram.getTypeChecker()
    }).size, 1);
    const unusedBindingResult = createTypeScriptTransformer({
        typescript,
        program: unusedBindingProgram
    }).transform({ code: unusedBindingSource, fileName: unusedBindingFile });

    assert.deepEqual(unusedBindingResult.diagnostics, []);
    assert.match(unusedBindingResult.code, /void ignored/);
    assert.match(unusedBindingResult.code, /catch\s*\{/);
    assert.match(unusedBindingResult.code, /\[ignored, value\][\s\S]*void ignored/);
    assert.match(unusedBindingResult.code, /contextual\s*=\s*\(\)\s*=>\s*9/);
    assert.match(unusedBindingResult.code, /checker-declared parameters are ignored/);
    assert.match(unusedBindingResult.code, /predicate[^\n]*=>\s*\{\s*void value/);
    assert.match(unusedBindingResult.code, /function impossible\(value\)\s*\{\s*void value/);
    const [unusedBindingRawLint = {}] = await outputEslint.lintText(unusedBindingResult.code, {
        filePath: 'unused-binding-generated.js'
    });
    const [unusedBindingFixedLint = {}] = await indexedFixedEslint.lintText(unusedBindingResult.code, {
        filePath: 'unused-binding-generated.js'
    });

    [unusedBindingRawLint, unusedBindingFixedLint].forEach(({ messages = [] } = {}) => {
        assert.equal(messages.filter(({ ruleId = '' } = {}) => ruleId === 'no-unused-vars').length,
            0, JSON.stringify(messages));
        assert.equal(messages.filter(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-call-site').length,
            0, JSON.stringify(messages));
    });
    const { outputText: unusedBindingReferenceCode = '' } = typescript.transpileModule(unusedBindingSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const unusedBindingReferenceFile = path.join(programDirectory, 'unused-binding-reference.js');
    const unusedBindingGeneratedFile = path.join(programDirectory, 'unused-binding-generated.js');

    await writeFile(unusedBindingReferenceFile, unusedBindingReferenceCode);
    await writeFile(unusedBindingGeneratedFile, unusedBindingResult.code);
    const unusedBindingReference = await import(pathToFileURL(unusedBindingReferenceFile).href);
    const unusedBindingGenerated = await import(pathToFileURL(unusedBindingGeneratedFile).href);
    const exerciseUnusedBindings = ({ ignoredParameter = false, caught = false, next = false,
        used = false, contextual = false, applied = false,
        predicate = false, impossible = false } = {}) => {
        let advances = 0;
        const tuple = {
            *[Symbol.iterator]() {
                advances += 1;
                yield 1;
                advances += 1;
                yield 2;
            }
        };

        return {
            arity: ignoredParameter.length,
            parameterResult: ignoredParameter(1, 2),
            caughtResult: caught(),
            tupleResult: next(tuple),
            advances,
            usedResult: used(5),
            contextualArity: contextual.length,
            contextualResult: contextual(2),
            appliedResult: applied(),
            predicateResult: predicate(2),
            impossibleArity: impossible.length
        };
    };

    assert.deepEqual(exerciseUnusedBindings(unusedBindingGenerated),
        exerciseUnusedBindings(unusedBindingReference));
    assert.throws(() => unusedBindingGenerated.impossible(3), /impossible/);
    assert.throws(() => unusedBindingReference.impossible(3), /impossible/);
    assert.deepEqual(readPair({ value: [0, false] }), [0, false]);
    let entryReads = 0;
    const entry = {
        get value() {
            entryReads += 1;

            return ['key', undefined];
        }
    };

    assert.deepEqual(readEntry(entry), ['key', undefined]);
    assert.equal(entryReads, 1);
    assert.throws(() => readEntry({}), TypeError);
    assert.deepEqual(readEntry({ value: [] }), [undefined, undefined]);

    const defaultContractFile = path.join(programDirectory, 'default-contract.ts');
    const defaultContractSource = [
        'interface Shape { title?: string; required: string; }',
        'export const read = (shape: Shape) => {',
        '    const base = shape;',
        '    const title = base.title;',
        '    const required = base.required;',
        '    return [title, required];',
        '};',
        ''
    ].join('\n');
    await writeFile(defaultContractFile, defaultContractSource);
    const defaultContractProgram = createFixtureProgram([defaultContractFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const defaultContractResult = createTypeScriptTransformer({
        typescript,
        program: defaultContractProgram
    }).transform({
        code: defaultContractSource,
        fileName: defaultContractFile
    });

    assert.deepEqual(defaultContractResult.diagnostics, []);
    assert.match(defaultContractResult.code, /const \{ title: baseTitle = "", required: baseRequired \} = base/);
    assert.match(defaultContractResult.code, /required typed field keeps its native Get and failure/);
    assert.doesNotMatch(defaultContractResult.code, /Missing required agreement/);
    const [{ errorCount: defaultContractFixErrors = 0, messages: defaultContractMessages = [], output: fixedDefaultContractCode = defaultContractResult.code } = {}]
        = await fixedCollectionEslint.lintText(defaultContractResult.code, {
            filePath: 'default-contract-generated.js'
        });
    const [defaultContractLint = {}] = await outputEslint.lintText(fixedDefaultContractCode, {
        filePath: 'default-contract-generated.js'
    });

    // The shared rule follows the stable base alias back to shape. Keep its
    // manual signature-placement finding visible without relocating source Gets.
    assert.equal(defaultContractFixErrors, 1, JSON.stringify(defaultContractMessages));
    [defaultContractMessages, defaultContractLint.messages].forEach(messages => assert.deepEqual(
        messages.map(({ ruleId = '', messageId = '' } = {}) => ({ ruleId, messageId })),
        [{ ruleId: 'resilient/prefer-signature-destructuring', messageId: 'preferSignature' }]
    ));
    const defaultContractRuntimeFile = path.join(programDirectory, 'default-contract.js');
    await writeFile(defaultContractRuntimeFile, defaultContractResult.code);
    const { href: defaultContractHref = '' } = pathToFileURL(defaultContractRuntimeFile);
    const { read: readDefaultContract = () => [] } = await import(defaultContractHref);
    let titleReads = 0;
    let requiredReads = 0;
    const model = {
        get title() {
            titleReads += 1;

            // eslint-disable-next-line resilient/prefer-falsey-returns -- Explicit undefined proves the optional-property default path.
            return undefined;
        },
        get required() {
            requiredReads += 1;

            return '';
        }
    };

    assert.deepEqual(readDefaultContract(model), ['', '']);
    assert.equal(titleReads, 1);
    assert.equal(requiredReads, 1);
    assert.deepEqual(defaultContractResult.agreements.map(({ state = '', action = '', site = '' } = {}) => ({ state, action, site })), [
        { state: 'caller-owned', action: 'preserve', site: 'final-object-binding' }
    ]);

    const indexedReducerResult = transform({
        code: [
            'export const reduce = (b, f) => fa => {',
            '    const { value: faValue } = fa;',
            '    const { forest: faForest = [] } = fa;',
            '    let result = f(b, faValue);',
            '    const length = faForest.length;',
            '    for (let i = 0; i < length; i++) {',
            '        result = pipe(faForest[i], reduce(result, f));',
            '    }',
            '    return result;',
            '};',
            'export const reduceOutbound = (b, f) => fa => {',
            '    const { value: faValue } = fa;',
            '    const { forest: faForest = [] } = fa;',
            '    let result = b;',
            '    const length = faForest.length;',
            '    for (let i = length - 1; i >= 0; i--) {',
            '        result = pipe(faForest[i], reduceOutbound(result, f));',
            '    }',
            '    return f(faValue, result);',
            '};',
            ''
        ].join('\n'),
        fileName: 'indexed-reducer.ts'
    });

    assert.deepEqual(indexedReducerResult.diagnostics, []);
    assert.match(indexedReducerResult.code, /for \(let i = 0; i < length; i\+\+\)/);
    assert.match(indexedReducerResult.code, /for \(let i = length - 1; i >= 0; i--\)/);
    assert.match(indexedReducerResult.code, /return f\(faValue, result\);/);
    assert.doesNotMatch(indexedReducerResult.code, /faForest\.reduce(?:Outbound)?\(/);

    const [{ output: fixedTreeCode = indexedReducerResult.code } = {}] = await fixedCollectionEslint.lintText(
        indexedReducerResult.code, { filePath: 'tree-generated.js' }
    );
    const tree = { value: 'a', forest: [{ value: 'b', forest: [{ value: 'd', forest: [] }] }, { value: 'c', forest: [] }] };
    const initialTree = JSON.stringify(tree);

    await Promise.all([indexedReducerResult.code, fixedTreeCode].map(async (code = '', index = 0) => {
        const treeFile = path.join(programDirectory, `tree-${index}.js`);

        await writeFile(treeFile, `const pipe = (value, operation) => operation(value);\n${code}`);

        const { href = '' } = pathToFileURL(treeFile);
        const { reduce = false, reduceOutbound = false } = await import(href);

        if (typeof reduce !== 'function' || typeof reduceOutbound !== 'function') assert.fail('Hierarchy reducers must remain callable');

        assert.equal(reduce('', (accumulator = '', value = '') => accumulator + value)(tree), 'abdc');
        assert.equal(reduceOutbound('', (value = '', accumulator = '') => accumulator + value)(tree), 'cdba');
        assert.equal(JSON.stringify(tree), initialTree);
    }));

    const closureMemberResult = transform({
        code: [
            'export const getShow = (S: { show: (value: string) => string }) => ({',
            '    show: (values: string[]) => `[${values.map(S.show).join(", ")}]`',
            '});',
            ''
        ].join('\n'),
        fileName: 'closure-member.ts'
    });

    assert.deepEqual(closureMemberResult.diagnostics, []);
    assert.match(closureMemberResult.code,
        /\(\{\s*show: SShow\s*\}\) => \(?\s*SShow\s*\)?\s*\/\* eslint-enable resilient\/prefer-safe-destructuring-defaults \*\/\)\(S\)/u);
    assert.match(closureMemberResult.code, /values\.map\(/);
    assert.doesNotMatch(closureMemberResult.code, /S\.show/);
    assert.doesNotMatch(closureMemberResult.code, /show: SShow =/);
    const [{ errorCount: closureMemberFixErrors = 0, output: fixedClosureMemberCode = closureMemberResult.code } = {}]
        = await fixedCollectionEslint.lintText(closureMemberResult.code, {
            filePath: 'closure-member-generated.js'
        });
    const [closureMemberLint = {}] = await outputEslint.lintText(fixedClosureMemberCode, {
        filePath: 'closure-member-generated.js'
    });

    assert.equal(closureMemberFixErrors, 0);
    assert.equal(closureMemberLint.errorCount, 0);
    assert.equal(closureMemberLint.warningCount, 0);
    const closureMemberRuntimeFile = path.join(programDirectory, 'closure-member.js');
    await writeFile(closureMemberRuntimeFile, closureMemberResult.code);
    const { href: closureMemberHref = '' } = pathToFileURL(closureMemberRuntimeFile);
    const { getShow = false } = await import(closureMemberHref);
    const callback = value => `${value}!`;
    let reads = 0;
    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- The generated factory has a required show property; the test must preserve its absence if lowering regresses.
    const { show } = getShow({
        get show() {
            reads += 1;

            return callback;
        }
    });

    assert.equal(reads, 0);
    const values = ['a', 'b'];
    let received = false;
    Object.defineProperty(values, 'map', {
        value: (mapper) => {
            received = mapper;

            return Array.prototype.map.call(values, mapper);
        }
    });

    assert.equal(show(values), '[a!, b!]');
    assert.equal(reads, 1);
    assert.equal(received, callback);

    const consumerShowFile = path.join(programDirectory, 'consumer-show.ts');
    const consumerShowSource = [
        'export const getShow = (S: { show: (value: string) => string }) => ({',
        '    show: (values: readonly [string, ...string[]]) => `[${values.map(S.show).join(", ")}]`',
        '});',
        ''
    ].join('\n');
    await writeFile(consumerShowFile, consumerShowSource);
    const consumerShowProgram = createFixtureProgram([consumerShowFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const consumerShowResult = createTypeScriptTransformer({
        typescript,
        program: consumerShowProgram,
        standard: { function: '../analysis/host/function.js' }
    }).transform({
        code: consumerShowSource,
        fileName: consumerShowFile
    });

    assert.deepEqual(consumerShowResult.diagnostics, []);
    assert.match(consumerShowResult.code, /import \{ isFunction \} from '..\/analysis\/host\/function\.js';/);
    assert.match(consumerShowResult.code, /const \{ show: SShow \} = S;/);
    assert.match(consumerShowResult.code, /if \(!isFunction\(SShow\)\) \{\s+return '';/);
    assert.doesNotMatch(consumerShowResult.code, /S\.show/);
    assert.doesNotMatch(consumerShowResult.code, /show: SShow =/);
    assert.deepEqual(consumerShowResult.agreements.map(({ action = '' } = {}) => action), [
        'guarded-function', 'preserve'
    ]);
    const [{ errorCount: consumerShowFixErrors = 0, output: fixedConsumerShowCode = consumerShowResult.code } = {}]
        = await fixedCollectionEslint.lintText(consumerShowResult.code, {
            filePath: 'consumer-show-generated.js'
        });
    const [consumerShowLint = {}] = await outputEslint.lintText(fixedConsumerShowCode, {
        filePath: 'consumer-show-generated.js'
    });

    assert.equal(consumerShowFixErrors, 0, JSON.stringify(consumerShowLint.messages));
    assert.equal(consumerShowLint.errorCount, 0);
    const consumerShowRuntimeFile = path.join(programDirectory, 'consumer-show.js');
    await writeFile(consumerShowRuntimeFile, consumerShowResult.code.replace(
        "import { isFunction } from '../analysis/host/function.js';",
        "const isFunction = value => typeof value === 'function';"
    ));
    const { href: consumerShowHref = '' } = pathToFileURL(consumerShowRuntimeFile);
    const { getShow: getConsumerShow = false } = await import(consumerShowHref);
    let consumerReads = 0;
    const consumerCallback = value => `${value}!`;
    const consumer = {
        get show() {
            consumerReads += 1;

            return consumerCallback;
        }
    };
    const consumerResult = getConsumerShow(consumer);

    assert.equal(consumerReads, 0);
    assert.equal(consumerResult.show(['a', 'b']), '[a!, b!]');
    assert.equal(consumerReads, 1);
    assert.ok(consumerResult.show);
    const missingShow = getConsumerShow({});

    assert.equal(missingShow.show(['a']), '');

    const directCapabilityFile = path.join(programDirectory, 'direct-capability.ts');
    const directCapabilitySource = [
        'type Provider = { of: (value: string) => string };',
        'export const lift = (F: Provider, value: string) => F.of(value);',
        ''
    ].join('\n');
    await writeFile(directCapabilityFile, directCapabilitySource);
    const directCapabilityResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([directCapabilityFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        }),
        standard: { function: '../analysis/host/function.js' }
    }).transform({
        code: directCapabilitySource,
        fileName: directCapabilityFile
    });

    assert.deepEqual(directCapabilityResult.diagnostics, []);
    assert.match(directCapabilityResult.code, /import \{ isFunction \} from '..\/analysis\/host\/function\.js';/);
    assert.match(directCapabilityResult.code, /const \{ of: FOf \} = F;/);
    assert.match(directCapabilityResult.code, /if \(!isFunction\(FOf\)\) \{\s+return;\s+\}/);
    assert.match(directCapabilityResult.code, /return FOf\.call\(F, value\);/);
    assert.doesNotMatch(directCapabilityResult.code, /F\.of/);
    assert.ok(directCapabilityResult.agreements.some(({ action = '' } = {}) => (
        action === 'guarded-direct-capability'
    )));
    const [{ errorCount: directCapabilityFixErrors = 0, output: fixedDirectCapabilityCode = directCapabilityResult.code } = {}]
        = await fixedCollectionEslint.lintText(directCapabilityResult.code, {
            filePath: 'direct-capability-generated.js'
        });
    const [directCapabilityLint = {}] = await outputEslint.lintText(fixedDirectCapabilityCode, {
        filePath: 'direct-capability-generated.js'
    });

    assert.equal(directCapabilityFixErrors, 0, JSON.stringify(directCapabilityLint.messages));
    assert.equal(directCapabilityLint.errorCount, 0);
    const directCapabilityRuntimeFile = path.join(programDirectory, 'direct-capability.js');
    await writeFile(directCapabilityRuntimeFile, directCapabilityResult.code.replace(
        "import { isFunction } from '../analysis/host/function.js';",
        "const isFunction = value => typeof value === 'function';"
    ));
    const { href: directCapabilityHref = '' } = pathToFileURL(directCapabilityRuntimeFile);
    const { lift = false } = await import(directCapabilityHref);
    let capabilityReads = 0;
    const capability = value => `${value}!`;
    const directProvider = {
        get of() {
            capabilityReads += 1;

            return capability;
        }
    };

    assert.equal(lift(directProvider, 'ok'), 'ok!');
    assert.equal(capabilityReads, 1);
    assert.equal(lift({}, 'missing'), undefined);

    const sortCapabilityFile = path.join(programDirectory, 'sort-capability.ts');
    const sortCapabilitySource = [
        'type Ordering = { compare: (inbound: number, outbound: number) => number };',
        'type Combiner<A> = { concat: (inbound: A, outbound: A) => A };',
        'type RequiredSequence<A> = [A, ...A[]];',
        'export const sort = (O: Ordering) => (values: number[]) => values.length <= 1 ? values.slice() : values.slice().sort(O.compare);',
        'export function sortBlock(O: Ordering, values: number[]) { return values.slice().sort(O.compare); }',
        'export const keys = (O: Ordering) => (values: number[]) => Array.from(values).sort(O.compare);',
        'export const sortNonBaseValue = (O: Ordering) => (values: RequiredSequence<number>): RequiredSequence<number> => values.slice().sort(O.compare) as RequiredSequence<number>;',
        'export const concatAll = <A>(S: Combiner<A>) => (values: RequiredSequence<A>): A => values.reduce(S.concat);',
        ''
    ].join('\n');
    await writeFile(sortCapabilityFile, sortCapabilitySource);
    const sortCapabilityResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([sortCapabilityFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        }),
        standard: { function: '../analysis/host/function.js' }
    }).transform({
        code: sortCapabilitySource,
        fileName: sortCapabilityFile
    });

    assert.deepEqual(sortCapabilityResult.diagnostics, []);
    assert.match(sortCapabilityResult.code, /export const sort = O =>/);
    assert.match(sortCapabilityResult.code, /export function sortBlock\(O, values\) \{/);
    assert.match(sortCapabilityResult.code, /const \{ compare: OCompare(?:Capability)? \} = O;/);
    assert.match(sortCapabilityResult.code, /const _resilientSorted = values\.slice\(\);/);
    assert.match(sortCapabilityResult.code, /const _resilientSorted = Array\.from\(values\);/);
    assert.match(sortCapabilityResult.code, /export const sortNonBaseValue = O => \(values\) => \{\s+const _resilientSorted = values\.slice\(\);/);
    assert.match(sortCapabilityResult.code, /export const concatAll = S => \(values\) => \{\s+const \{ concat: SConcat(?:Capability)? \} = S;/);
    assert.match(sortCapabilityResult.code, /if \(!isFunction\(OCompare(?:Capability)?\)\) \{\s+return;\s+\}/);
    assert.ok(sortCapabilityResult.agreements.some(({ action = '' } = {}) => action === 'guarded-sort-capability'));
    const [{ errorCount: sortCapabilityFixErrors = 0, output: fixedSortCapabilityCode = sortCapabilityResult.code } = {}]
        = await fixedCollectionEslint.lintText(sortCapabilityResult.code, {
            filePath: 'sort-capability-generated.js'
        });
    const [sortCapabilityLint = {}] = await outputEslint.lintText(fixedSortCapabilityCode, {
        filePath: 'sort-capability-generated.js'
    });

    assert.equal(sortCapabilityFixErrors, 0, JSON.stringify(sortCapabilityLint.messages));
    assert.equal(sortCapabilityLint.errorCount, 0);
    const sortCapabilityRuntimeFile = path.join(programDirectory, 'sort-capability.js');
    await writeFile(sortCapabilityRuntimeFile, sortCapabilityResult.code.replace(
        "import { isFunction } from '../analysis/host/function.js';",
        "const isFunction = value => typeof value === 'function';"
    ));
    const { href: sortCapabilityHref = '' } = pathToFileURL(sortCapabilityRuntimeFile);
    const {
        sort: guardedSort = false,
        sortBlock = false,
        keys: guardedKeys = false,
        sortNonBaseValue = false,
        concatAll = false
    } = await import(sortCapabilityHref);
    let comparatorCalls = 0;
    let comparatorReads = 0;
    const compare = (inbound, outbound) => {
        comparatorCalls += 1;

        return inbound - outbound;
    };
    const ord = {
        get compare() {
            comparatorReads += 1;

            return compare;
        }
    };

    assert.deepEqual(guardedSort(ord)([2, 1]), [1, 2]);
    assert.ok(comparatorCalls > 0);
    assert.equal(comparatorReads, 1);
    assert.deepEqual(sortBlock(ord, [2, 1]), [1, 2]);
    assert.equal(comparatorReads, 2);
    assert.equal(sortBlock({}, [2, 1]), undefined);
    const sortFailure = new Error('sort provider getter');
    const observeSortFailure = (invoke) => {
        let phaseTrace = [];
        const values = { slice: () => {
            phaseTrace = [...phaseTrace, 'receiver'];

            return [2, 1];
        } };
        const provider = { get compare() {
            phaseTrace = [...phaseTrace, 'provider getter'];

            throw sortFailure;
        } };

        try {
            invoke(provider, values);
        } catch (error) {
            return { events: phaseTrace, sameFailure: error === sortFailure };
        }

        return { events: phaseTrace, sameFailure: false };
    };

    assert.deepEqual(observeSortFailure(sortBlock), {
        events: ['receiver', 'provider getter'], sameFailure: true
    }, 'Block-return lowering preserves source receiver-before-provider failure identity.');
    comparatorCalls = 0;
    assert.deepEqual(guardedSort(ord)([1]), [1]);
    assert.equal(comparatorCalls, 0);
    assert.equal(guardedSort({})([2, 1]), undefined);
    let sliceCalls = 0;
    const stagedValues = new Proxy([2, 1], {
        get: (target, key, receiver) => key === 'slice'
            ? () => {
                sliceCalls += 1;

                return target.slice();
            }
            : Reflect.get(target, key, receiver)
    });
    assert.equal(guardedSort({})(stagedValues), undefined);
    assert.equal(sliceCalls, 1);
    assert.deepEqual(guardedKeys(ord)([3, 1]), [1, 3]);
    assert.deepEqual(sortNonBaseValue(ord)([2, 1]), [1, 2]);
    assert.equal(sortNonBaseValue({})([2, 1]), undefined);
    assert.equal(concatAll({ concat: (inbound, outbound) => inbound + outbound })([1, 2, 3]), 6);
    assert.equal(concatAll({})([1, 2]), undefined);

    const flowCompositionFile = path.join(programDirectory, 'flow-composition.ts');
    const flowCompositionSource = [
        'export function composeStages(ab: Function, ...args: Function[]): Function {',
        '  switch (arguments.length) {',
        '    case 2: {',
        '      const [bc] = args;',
        '      return function (this: unknown) { return bc!(ab.apply(this, arguments)); };',
        '    }',
        '    case 3: {',
        '      const [bc, cd] = args;',
        '      return function (this: unknown) { return cd!(bc!(ab.apply(this, arguments))); };',
        '    }',
        '    default: return ab;',
        '  }',
        '}',
        ''
    ].join('\n');
    await writeFile(flowCompositionFile, flowCompositionSource);
    const flowCompositionResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([flowCompositionFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        }),
        standard: { function: '../analysis/host/function.js' }
    }).transform({
        code: flowCompositionSource,
        fileName: flowCompositionFile
    });

    assert.deepEqual(flowCompositionResult.diagnostics, []);
    assert.doesNotMatch(flowCompositionResult.code, /isFunction|_resilientFlowValue/);
    assert.match(flowCompositionResult.code, /return bc\(ab\.apply\(this, arguments\)\);/);
    assert.match(flowCompositionResult.code, /return cd\(bc\(ab\.apply\(this, arguments\)\)\);/);
    const [flowRawLint = {}] = await outputEslint.lintText(flowCompositionResult.code, {
        filePath: 'flow-composition-generated.js'
    });
    const [{ output: flowFixedCode = flowCompositionResult.code } = {}] = await fixedCollectionEslint.lintText(
        flowCompositionResult.code,
        { filePath: 'flow-composition-generated.js' }
    );
    const [flowFixedLint = {}] = await outputEslint.lintText(flowFixedCode, {
        filePath: 'flow-composition-fixed.js'
    });
    const returnMessages = ({ messages = [] } = {}) => messages.filter(({ ruleId = '' } = {}) => [
        'consistent-return',
        'resilient/signature-contract-return-consistency'
    ].includes(ruleId));

    assert.deepEqual(returnMessages(flowRawLint), []);
    assert.deepEqual(returnMessages(flowFixedLint), []);
    const flowCompositionRuntimeFile = path.join(programDirectory, 'flow-composition.js');
    await writeFile(flowCompositionRuntimeFile, flowCompositionResult.code);
    const { href: flowCompositionHref = '' } = pathToFileURL(flowCompositionRuntimeFile);
    const { composeStages = false } = await import(flowCompositionHref);
    let flowEvents = [];
    const flowReceiver = { label: 'receiver' };
    const firstStage = function (value) {
        flowEvents = [...flowEvents, [this, value]];

        return `${value}!`;
    };
    const missingSecond = composeStages(firstStage, undefined);

    assert.throws(() => missingSecond.call(flowReceiver, 'first'), TypeError);
    assert.deepEqual(flowEvents, [[flowReceiver, 'first']]);
    const missingFirst = composeStages(undefined, value => `${value}?`);

    assert.throws(() => missingFirst.call(flowReceiver, 'second'), TypeError);
    assert.deepEqual(flowEvents, [[flowReceiver, 'first']]);
    const completedFlow = composeStages(firstStage, value => `${value}?`, value => `${value}.`);

    assert.equal(completedFlow.call(flowReceiver, 'third'), 'third!?.');
    assert.deepEqual(flowEvents, [[flowReceiver, 'first'], [flowReceiver, 'third']]);

    const nonCompositionSource = flowCompositionSource.replace(
        'bc!(ab.apply(this, arguments))',
        'bc!.call(undefined, ab.apply(this, arguments))'
    ).replace(
        'cd!(bc!(ab.apply(this, arguments)))',
        'cd!.call(undefined, bc!(ab.apply(this, arguments)))'
    );
    const nonCompositionFile = path.join(programDirectory, 'non-composition.ts');

    await writeFile(nonCompositionFile, nonCompositionSource);
    const nonCompositionResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([nonCompositionFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        })
    }).transform({ code: nonCompositionSource, fileName: nonCompositionFile });

    assert.doesNotMatch(nonCompositionResult.code, /isFunction|_resilientFlowValue/);
    assert.match(nonCompositionResult.code, /bc\.call\(undefined, ab\.apply\(this, arguments\)\)/);

    const arityReturnFile = path.join(programDirectory, 'arity-return.ts');
    const arityReturnSource = [
        'export function select(scale: number): {',
        '  (needle: number): (values: number[]) => boolean;',
        '  (needle: number, values: number[]): boolean;',
        '};',
        'export function select(scale: number): (needle: number, values?: number[]) => boolean | ((values: number[]) => boolean) {',
        '  return (needle, values?) => {',
        '    if (values === undefined) {',
        '      const selected = select(scale);',
        '      return (input: number[]) => selected(needle, input);',
        '    }',
        '    return values.includes(needle * scale);',
        '  };',
        '}',
        ''
    ].join('\n');
    await writeFile(arityReturnFile, arityReturnSource);
    const arityProgram = createFixtureProgram([arityReturnFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const nonStrictArityProgram = createFixtureProgram([arityReturnFile], {
        module: typescript.ModuleKind.NodeNext,
        moduleResolution: typescript.ModuleResolutionKind.NodeNext,
        target: typescript.ScriptTarget.ESNext
    });

    assert.equal(collectArityReturnContracts({
        typescript,
        sourceFile: nonStrictArityProgram.getSourceFile(arityReturnFile),
        checker: nonStrictArityProgram.getTypeChecker()
    }).size, 1);
    const arityResult = createTypeScriptTransformer({ typescript, program: arityProgram }).transform({
        code: arityReturnSource,
        fileName: arityReturnFile
    });

    assert.deepEqual(arityResult.diagnostics, []);
    assert.doesNotMatch(arityResult.code, /eslint-disable resilient\/signature-contract-return-consistency/);
    assert.doesNotMatch(arityResult.code, /eslint-enable resilient\/signature-contract-return-consistency/);
    assert.match(arityResult.code, /eslint-disable-next-line resilient\/no-undefined-comparison/);
    const [arityRawLint = {}] = await outputEslint.lintText(arityResult.code, { filePath: 'arity-return-generated.js' });
    const [{ output: arityFixedCode = arityResult.code } = {}] = await fixedCollectionEslint.lintText(
        arityResult.code,
        { filePath: 'arity-return-generated.js' }
    );
    const [arityFixedLint = {}] = await outputEslint.lintText(arityFixedCode, { filePath: 'arity-return-fixed.js' });

    assert.deepEqual(returnMessages(arityRawLint), []);
    assert.deepEqual(returnMessages(arityFixedLint), []);
    assert.ok(!arityRawLint.messages.some(({ ruleId = '' } = {}) => ruleId === 'resilient/no-undefined-comparison'));
    assert.ok(!arityFixedLint.messages.some(({ ruleId = '' } = {}) => ruleId === 'resilient/no-undefined-comparison'));
    const arityRuntimeFile = path.join(programDirectory, 'arity-return.js');

    await writeFile(arityRuntimeFile, arityResult.code);
    const { select: generatedSelect = false } = await import(pathToFileURL(arityRuntimeFile).href);

    assert.equal(generatedSelect(2)(3)([1, 6]), true);
    assert.equal(generatedSelect(2)(3, [1, 6]), true);
    assert.equal(generatedSelect(2)(3, [1, 5]), false);
    assert.throws(() => generatedSelect(2)(3, null), TypeError);
    const switchReturnFile = path.join(programDirectory, 'switch-return.ts');
    const switchReturnSource = [
        "export const choose = (tag: 'inbound' | 'outbound') => {",
        '  switch (tag) {',
        "    case 'inbound': return 'L';",
        "    case 'outbound': return 'R';",
        '  }',
        '};',
        'export function dispatch(arity: number): number | undefined {',
        '  switch (arity) {',
        '    case 1: return 10;',
        '    case 2: return 20;',
        '  }',
        '  return;',
        '}',
        ''
    ].join('\n');
    await writeFile(switchReturnFile, switchReturnSource);
    const switchReturnProgram = createFixtureProgram([switchReturnFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const switchReturnResult = createTypeScriptTransformer({ typescript, program: switchReturnProgram }).transform({
        code: switchReturnSource,
        fileName: switchReturnFile
    });

    assert.deepEqual(switchReturnResult.diagnostics, []);
    assert.match(switchReturnResult.code, /eslint-disable consistent-return, resilient\/signature-contract-return-consistency -- Unrecognized tag retains native fallthrough/);
    assert.match(switchReturnResult.code, /eslint-disable consistent-return, resilient\/signature-contract-return-consistency -- Unsupported selector retains the source no-value exit/);
    const [switchRawLint = {}] = await outputEslint.lintText(switchReturnResult.code, {
        filePath: 'switch-return-generated.js'
    });
    const [{ output: switchFixedCode = switchReturnResult.code } = {}] = await fixedCollectionEslint.lintText(
        switchReturnResult.code,
        { filePath: 'switch-return-generated.js' }
    );
    const [switchFixedLint = {}] = await outputEslint.lintText(switchFixedCode, {
        filePath: 'switch-return-fixed.js'
    });

    assert.deepEqual(returnMessages(switchRawLint), []);
    assert.deepEqual(returnMessages(switchFixedLint), []);
    assert.equal(switchRawLint.errorCount, 0, JSON.stringify(switchRawLint.messages));
    assert.equal(switchFixedLint.errorCount, 0, JSON.stringify(switchFixedLint.messages));
    const switchRuntimeFile = path.join(programDirectory, 'switch-return.js');
    const switchSourceRuntimeFile = path.join(programDirectory, 'switch-return-source.js');

    await writeFile(switchRuntimeFile, switchReturnResult.code);
    await writeFile(switchSourceRuntimeFile, typescript.transpileModule(switchReturnSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    }).outputText);
    const switchGenerated = await import(pathToFileURL(switchRuntimeFile).href);
    const switchSourceRuntime = await import(pathToFileURL(switchSourceRuntimeFile).href);

    ['inbound', 'outbound', 'other'].forEach((tag) => {
        assert.equal(switchGenerated.choose(tag), switchSourceRuntime.choose(tag));
    });

    [0, 1, 2, 3].forEach((arity) => {
        assert.equal(switchGenerated.dispatch(arity), switchSourceRuntime.dispatch(arity));
    });

    const rejectedReturnSwitchSource = [
        "export const choose = (tag: string) => { switch (tag) { case 'inbound': return 1; case 'outbound': return 2; } };",
        "export const defaulted = (tag: 'inbound' | 'outbound') => { switch (tag) {",
        "case 'inbound': return 1; case 'outbound': return 2; default: return 3; } };",
        ''
    ].join('\n');
    const rejectedReturnSwitchFile = path.join(programDirectory, 'rejected-switch-return.ts');

    await writeFile(rejectedReturnSwitchFile, rejectedReturnSwitchSource);
    const rejectedReturnSwitchProgram = createFixtureProgram([rejectedReturnSwitchFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });

    assert.equal(collectSwitchReturnContracts({
        typescript,
        sourceFile: rejectedReturnSwitchProgram.getSourceFile(rejectedReturnSwitchFile),
        checker: rejectedReturnSwitchProgram.getTypeChecker()
    }).size, 0);
    const nullishEqualityFile = path.join(programDirectory, 'nullish-equality.ts');
    const nullishEqualitySource = [
        'export const absent = (value: unknown) => value == null;',
        'export const present = (value: unknown) => {',
        '  const result = value != null;',
        '  return result;',
        '};',
        'export const chooseNullish = (value: unknown) => {',
        "  return value == null ? 'missing' : 'present';",
        '};',
        'export const guardedNullish = (value: unknown) => {',
        '  if (value == null) return false;',
        '  return true;',
        '};',
        ''
    ].join('\n');

    await writeFile(nullishEqualityFile, nullishEqualitySource);
    const nullishEqualityProgram = createFixtureProgram([nullishEqualityFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const nullishResult = createTypeScriptTransformer({ typescript, program: nullishEqualityProgram }).transform({
        code: nullishEqualitySource,
        fileName: nullishEqualityFile
    });

    assert.deepEqual(nullishResult.diagnostics, []);
    assert.equal((nullishResult.code.match(/eslint-disable-next-line eqeqeq/g) || []).length, 4);
    const [nullishRawLint = {}] = await outputEslint.lintText(nullishResult.code, {
        filePath: 'nullish-equality-generated.js'
    });
    const [{ output: nullishFixedCode = nullishResult.code } = {}] = await fixedCollectionEslint.lintText(
        nullishResult.code,
        { filePath: 'nullish-equality-generated.js' }
    );
    const [nullishFixedLint = {}] = await outputEslint.lintText(nullishFixedCode, {
        filePath: 'nullish-equality-fixed.js'
    });

    assert.equal(nullishRawLint.errorCount, 0, JSON.stringify(nullishRawLint.messages));
    assert.equal(nullishFixedLint.errorCount, 0, JSON.stringify(nullishFixedLint.messages));
    const nullishRuntimeFile = path.join(programDirectory, 'nullish-equality.js');
    const nullishSourceRuntimeFile = path.join(programDirectory, 'nullish-equality-source.js');

    await writeFile(nullishRuntimeFile, nullishResult.code);
    await writeFile(nullishSourceRuntimeFile, typescript.transpileModule(nullishEqualitySource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    }).outputText);
    const nullishGenerated = await import(pathToFileURL(nullishRuntimeFile).href);
    const nullishSourceRuntime = await import(pathToFileURL(nullishSourceRuntimeFile).href);

    [undefined, null, false, 0, '', {}, []].forEach((value) => {
        ['absent', 'present', 'chooseNullish', 'guardedNullish'].forEach((name) => {
            assert.equal(nullishGenerated[name](value), nullishSourceRuntime[name](value));
        });
    });
    const rejectedNullishFile = path.join(programDirectory, 'rejected-nullish-equality.ts');
    const rejectedNullishSource = 'export const compare = (value: unknown) => value === null || value == 0;';

    await writeFile(rejectedNullishFile, rejectedNullishSource);
    const rejectedNullishProgram = createFixtureProgram([rejectedNullishFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });

    assert.equal(collectNullishEqualityContracts({
        typescript,
        sourceFile: rejectedNullishProgram.getSourceFile(rejectedNullishFile),
        checker: rejectedNullishProgram.getTypeChecker()
    }).size, 0);
    const noOverloadSource = arityReturnSource.split('\n').slice(4).join('\n');
    const noOverloadFile = path.join(programDirectory, 'no-arity-overload.ts');

    await writeFile(noOverloadFile, noOverloadSource);
    const noOverloadProgram = createFixtureProgram([noOverloadFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });

    assert.equal(collectArityReturnContracts({
        typescript,
        sourceFile: noOverloadProgram.getSourceFile(noOverloadFile),
        checker: noOverloadProgram.getTypeChecker()
    }).size, 0);

    const conditionalArityFile = path.join(programDirectory, 'conditional-arity.ts');
    const conditionalAritySource = [
        'export function selectConditional(needle: number): (values: number[]) => boolean;',
        'export function selectConditional(needle: number, values: number[]): boolean;',
        'export function selectConditional(needle: number, values?: number[]): boolean | ((values: number[]) => boolean) {',
        '  return values === undefined',
        '    ? (input: number[]) => selectConditional(needle, input)',
        '    : values.includes(needle * 2);',
        '}',
        ''
    ].join('\n');

    await writeFile(conditionalArityFile, conditionalAritySource);
    const conditionalArityProgram = createFixtureProgram([conditionalArityFile], {
        module: typescript.ModuleKind.NodeNext,
        moduleResolution: typescript.ModuleResolutionKind.NodeNext,
        target: typescript.ScriptTarget.ESNext
    });
    const conditionalArityFacts = collectArityReturnContracts({
        typescript,
        sourceFile: conditionalArityProgram.getSourceFile(conditionalArityFile),
        checker: conditionalArityProgram.getTypeChecker()
    });

    assert.equal(conditionalArityFacts.size, 1);
    const conditionalArityResult = createTypeScriptTransformer({
        typescript,
        program: conditionalArityProgram
    }).transform({ code: conditionalAritySource, fileName: conditionalArityFile });

    assert.doesNotMatch(conditionalArityResult.code, /eslint-(?:disable|enable) resilient\/signature-contract-return-consistency/);
    assert.match(conditionalArityResult.code, /values === undefined/);
    const [conditionalArityRawLint = {}] = await outputEslint.lintText(conditionalArityResult.code, {
        filePath: 'conditional-arity-generated.js'
    });
    const [{ output: conditionalArityFixedCode = conditionalArityResult.code } = {}] = await fixedCollectionEslint.lintText(
        conditionalArityResult.code,
        { filePath: 'conditional-arity-generated.js' }
    );
    const [conditionalArityFixedLint = {}] = await outputEslint.lintText(conditionalArityFixedCode, {
        filePath: 'conditional-arity-fixed.js'
    });

    assert.deepEqual(returnMessages(conditionalArityRawLint), []);
    assert.deepEqual(returnMessages(conditionalArityFixedLint), []);
    const conditionalArityRuntimeFile = path.join(programDirectory, 'conditional-arity.js');

    await writeFile(conditionalArityRuntimeFile, conditionalArityResult.code);
    const { selectConditional = false } = await import(pathToFileURL(conditionalArityRuntimeFile).href);

    assert.equal(selectConditional(3)([1, 6]), true);
    assert.equal(selectConditional(3, [1, 5]), false);
    assert.throws(() => selectConditional(3, null), TypeError);

    const literalArityFile = path.join(programDirectory, 'literal-arity.ts');
    const literalAritySource = [
        'export function prepend(value: number): (tail: number[]) => number[];',
        'export function prepend(value: number, tail: number[]): number[];',
        'export function prepend(value: number, tail?: number[]): number[] | ((tail: number[]) => number[]) {',
        '  return tail === undefined ? input => [value, ...input] : [value, ...tail];',
        '}',
        ''
    ].join('\n');

    await writeFile(literalArityFile, literalAritySource);
    const literalArityProgram = createFixtureProgram([literalArityFile], {
        module: typescript.ModuleKind.NodeNext,
        moduleResolution: typescript.ModuleResolutionKind.NodeNext,
        target: typescript.ScriptTarget.ESNext
    });
    const literalArityResult = createTypeScriptTransformer({ typescript, program: literalArityProgram }).transform({
        code: literalAritySource,
        fileName: literalArityFile
    });
    const [literalArityLint = {}] = await outputEslint.lintText(literalArityResult.code, {
        filePath: 'literal-arity-generated.js'
    });
    const [{ output: literalArityFixedCode = literalArityResult.code } = {}] = await fixedCollectionEslint.lintText(
        literalArityResult.code,
        { filePath: 'literal-arity-generated.js' }
    );
    const [literalArityFixedLint = {}] = await outputEslint.lintText(literalArityFixedCode, {
        filePath: 'literal-arity-fixed.js'
    });

    assert.match(literalArityResult.code, /eslint-disable-next-line resilient\/no-undefined-comparison/);
    assert.ok(!literalArityLint.messages.some(({ ruleId = '' } = {}) => ruleId === 'resilient/no-undefined-comparison'));
    assert.ok(!literalArityFixedLint.messages.some(({ ruleId = '' } = {}) => ruleId === 'resilient/no-undefined-comparison'));
    const literalArityRuntimeFile = path.join(programDirectory, 'literal-arity.js');

    await writeFile(literalArityRuntimeFile, literalArityResult.code);
    const { prepend: generatedPrepend = false } = await import(pathToFileURL(literalArityRuntimeFile).href);

    assert.deepEqual(generatedPrepend(2)([3]), [2, 3]);
    assert.deepEqual(generatedPrepend(2, [3]), [2, 3]);
    assert.throws(() => generatedPrepend(2, null), TypeError);

    const receiverCapabilityFile = path.join(programDirectory, 'receiver-capability.ts');
    const receiverCapabilitySource = [
        'type Provider = { of: (this: Provider, value: string) => string };',
        'export const lift = (F: Provider, value: string) => F.of(value);',
        ''
    ].join('\n');
    await writeFile(receiverCapabilityFile, receiverCapabilitySource);
    const receiverCapabilityResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([receiverCapabilityFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        }),
        standard: { function: '../analysis/host/function.js' }
    }).transform({
        code: receiverCapabilitySource,
        fileName: receiverCapabilityFile
    });

    assert.doesNotMatch(receiverCapabilityResult.code, /isFunction\(FOf\)/);
    assert.match(receiverCapabilityResult.code, /F\.of\(value\)/);

    const providerForwardFile = path.join(programDirectory, 'provider-forward.ts');
    const providerForwardSource = [
        'type Provider = { reduce: (value: string) => string; combineAll: (value: string) => string };',
        'export const forward = (FWI: Provider) => { return { reduce: FWI.reduce, combineAll: FWI.combineAll }; };',
        ''
    ].join('\n');
    await writeFile(providerForwardFile, providerForwardSource);
    const providerForwardResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([providerForwardFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        })
    }).transform({
        code: providerForwardSource,
        fileName: providerForwardFile
    });

    assert.deepEqual(providerForwardResult.diagnostics, []);
    assert.match(providerForwardResult.code, /reduce: \(\(\{ reduce: FWIReduce \}\) => FWIReduce\)\(FWI\)/);
    assert.match(providerForwardResult.code, /combineAll: \(\(\{ combineAll: FWICombineAll \}\) => FWICombineAll\)\(FWI\)/);
    assert.doesNotMatch(providerForwardResult.code, /const \{ reduce: FWIReduce/);
    assert.ok(providerForwardResult.agreements.every(({ action = '' } = {}) => action === 'provider-forwarded'));
    const [{ errorCount: providerForwardFixErrors = 0, output: fixedProviderForwardCode = providerForwardResult.code } = {}]
        = await fixedCollectionEslint.lintText(providerForwardResult.code, {
            filePath: 'provider-forward-generated.js'
        });
    const [providerForwardLint = {}] = await outputEslint.lintText(fixedProviderForwardCode, {
        filePath: 'provider-forward-generated.js'
    });

    assert.equal(providerForwardFixErrors, 0, JSON.stringify(providerForwardLint.messages));
    assert.equal(providerForwardLint.errorCount, 0);
    const providerForwardRuntimeFile = path.join(programDirectory, 'provider-forward.js');
    await writeFile(providerForwardRuntimeFile, providerForwardResult.code);
    const { href: providerForwardHref = '' } = pathToFileURL(providerForwardRuntimeFile);
    const { forward = false } = await import(providerForwardHref);
    let events = [];
    const reduce = value => value;
    const combineAll = value => value.toUpperCase();
    const provider = {
        get reduce() {
            events = [...events, 'reduce'];

            return reduce;
        },
        get combineAll() {
            events = [...events, 'combineAll'];

            return combineAll;
        }
    };
    const forwarded = forward(provider);

    assert.deepEqual(events, ['reduce', 'combineAll']);
    assert.equal(forwarded.reduce, reduce);
    assert.equal(forwarded.combineAll, combineAll);
    assert.throws(() => forward(null), TypeError);

    const guardedConjunctionResult = transform({
        code: [
            'const isCombined = value => value.category === "Combined";',
            'export const equals = (x, y) => isCombined(y) && x.inbound === y.inbound && x.outbound === y.outbound;',
            ''
        ].join('\n'),
        fileName: 'guarded-conjunction.ts'
    });

    assert.match(guardedConjunctionResult.code, /isCombined\(y\) && x\.inbound === y\.inbound && x\.outbound === y\.outbound/);
    assert.doesNotMatch(guardedConjunctionResult.code, /return isCombined\(y\)/);
    const [guardedConjunctionLint = {}] = await outputEslint.lintText(guardedConjunctionResult.code, {
        filePath: 'guarded-conjunction-generated.js'
    });

    assert.equal(guardedConjunctionLint.messages.filter(({ ruleId = '' } = {}) => (
        ruleId === 'resilient/prefer-safe-destructuring-defaults'
    )).length, 0, JSON.stringify(guardedConjunctionLint.messages));
    const guardedConjunctionRuntimeFile = path.join(programDirectory, 'guarded-conjunction.js');
    await writeFile(guardedConjunctionRuntimeFile, guardedConjunctionResult.code);
    const { href: guardedConjunctionHref = '' } = pathToFileURL(guardedConjunctionRuntimeFile);
    const { equals: guardedEquals = false } = await import(guardedConjunctionHref);

    assert.equal(guardedEquals({ inbound: 1, outbound: 2 }, { category: 'Inbound' }), false);
    assert.equal(guardedEquals({ inbound: 1, outbound: 2 }, { category: 'Combined', inbound: 1, outbound: 2 }), true);

    const exactProjectionFile = path.join(programDirectory, 'exact-projection.ts');
    const exactProjectionSource = [
        'type IdentityProvider<A> = { readonly baseValue: A };',
        'export const tuple = <A>(...identityProviders: ReadonlyArray<IdentityProvider<A>>): ReadonlyArray<A> => identityProviders.map(m => m.baseValue);',
        ''
    ].join('\n');
    await writeFile(exactProjectionFile, exactProjectionSource);
    const exactProjectionResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([exactProjectionFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        })
    }).transform({
        code: exactProjectionSource,
        fileName: exactProjectionFile
    });

    assert.deepEqual(exactProjectionResult.diagnostics, []);
    assert.match(exactProjectionResult.code, /identityProviders\.map\(m => \(\(\{ baseValue: mBaseValue \}\) => mBaseValue\)\(m\)\)/);
    assert.deepEqual(exactProjectionResult.agreements.map(({ action = '' } = {}) => action), ['exact-callback-projected']);
    const [exactProjectionLint = {}] = await outputEslint.lintText(exactProjectionResult.code, {
        filePath: 'exact-projection-generated.js'
    });

    assert.equal(exactProjectionLint.errorCount, 0, JSON.stringify(exactProjectionLint.messages));
    const exactProjectionRuntimeFile = path.join(programDirectory, 'exact-projection.js');
    await writeFile(exactProjectionRuntimeFile, exactProjectionResult.code);
    const { href: exactProjectionHref = '' } = pathToFileURL(exactProjectionRuntimeFile);
    const { tuple: projectIdentities = false } = await import(exactProjectionHref);
    let projectionEvents = [];
    const firstBaseValue = {};
    const secondBaseValue = false;
    const projected = projectIdentities(...[
        {
            get baseValue() {
                projectionEvents = [...projectionEvents, 'first'];

                return firstBaseValue;
            }
        },
        {
            get baseValue() {
                projectionEvents = [...projectionEvents, 'second'];

                return secondBaseValue;
            }
        }
    ]);

    assert.deepEqual(projectionEvents, ['first', 'second']);
    assert.deepEqual(projected, [firstBaseValue, secondBaseValue]);

    const providerEdgeFile = path.join(programDirectory, 'provider-edge.ts');
    const providerEdgeSource = [
        'const getMapperComposition = <A, B>(F: A, G: B) => ({ map: (value: string) => [F, G].length ? value.toUpperCase() : value });',
        'const map = getMapperComposition({}, {}).map;',
        'export const make = () => ({ map });',
        ''
    ].join('\n');
    await writeFile(providerEdgeFile, providerEdgeSource);
    const providerEdgeProgram = createFixtureProgram([providerEdgeFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const providerEdgeResult = createTypeScriptTransformer({
        typescript,
        program: providerEdgeProgram
    }).transform({
        code: providerEdgeSource,
        fileName: providerEdgeFile
    });

    assert.deepEqual(providerEdgeResult.diagnostics, []);
    assert.match(providerEdgeResult.code, /eslint-disable-next-line resilient\/prefer-safe-destructuring-defaults -- checker-proven required factory function field/);
    assert.match(providerEdgeResult.code, /\{ map \} = getMapperComposition\(\{}, \{\}\);/);
    assert.doesNotMatch(providerEdgeResult.code, /getMapperComposition\(\{}, \{\}\)\.map/);
    assert.deepEqual(providerEdgeResult.agreements.map(({ action = '' } = {}) => action), [
        'slang-required-function-provider-edge'
    ]);
    const [{ errorCount: providerEdgeFixErrors = 0, output: fixedProviderEdgeCode = providerEdgeResult.code } = {}]
        = await fixedCollectionEslint.lintText(providerEdgeResult.code, {
            filePath: 'provider-edge-generated.js'
        });
    const [providerEdgeLint = {}] = await outputEslint.lintText(fixedProviderEdgeCode, {
        filePath: 'provider-edge-generated.js'
    });

    assert.equal(providerEdgeFixErrors, 0, JSON.stringify(providerEdgeLint.messages));
    assert.equal(providerEdgeLint.errorCount, 0);
    const providerEdgeRuntimeFile = path.join(programDirectory, 'provider-edge.js');
    await writeFile(providerEdgeRuntimeFile, providerEdgeResult.code.replace(
        /map: value =>[^\n]*\}\);/,
        'map: undefined });'
    ));
    const { href: providerEdgeHref = '' } = pathToFileURL(providerEdgeRuntimeFile);
    const { make: makeProviderEdge = false } = await import(providerEdgeHref);

    assert.equal(makeProviderEdge().map, undefined);

    const treeProviderFile = path.join(programDirectory, 'tree-provider.ts');
    const treeProviderSource = [
        'type Hierarchy<A> = { value: A; forest: ReadonlyArray<Hierarchy<A>> };',
        'type Concat<B> = (first: ReadonlyArray<Hierarchy<B>>, second: ReadonlyArray<Hierarchy<B>>) => ReadonlyArray<Hierarchy<B>>;',
        'let identityProviderIsAvailable = true;',
        'export const disableConcat = () => { identityProviderIsAvailable = false; };',
        'export const A = {',
        '    getIdentityProvider: <B>() => ({ concat: (identityProviderIsAvailable ? (first: ReadonlyArray<Hierarchy<B>>, second: '
        + 'ReadonlyArray<Hierarchy<B>>) => [...first, ...second] : false) as Concat<B> })',
        '};',
        'export const join = <Input, Output>(ma: Hierarchy<Input>, f: (value: Input) => Hierarchy<Output>): Hierarchy<Output> => {',
        '    const { value, forest } = f(ma.value);',
        '    const concat = A.getIdentityProvider<Hierarchy<Output>>().concat;',
        '    return { value, forest: concat(forest, ma.forest) };',
        '};',
        ''
    ].join('\n');
    await writeFile(treeProviderFile, treeProviderSource);
    const treeProviderResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([treeProviderFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        }),
        standard: { function: '../analysis/host/function.js' }
    }).transform({
        code: treeProviderSource,
        fileName: treeProviderFile
    });

    assert.deepEqual(treeProviderResult.diagnostics, []);
    assert.match(treeProviderResult.code, /import \{ isFunction \} from '..\/analysis\/host\/function\.js';/);
    assert.match(treeProviderResult.code, /const \{ concat \} = A\.getIdentityProvider\(\);/);
    assert.match(treeProviderResult.code, /if \(!isFunction\(concat\)\)[\s\S]*?return \{[\s\S]*?value,[\s\S]*?forest: \[\]/);
    assert.doesNotMatch(treeProviderResult.code, /getIdentityProvider\(\)\.concat/);
    assert.ok(treeProviderResult.agreements.some(({ action = '' } = {}) => action === 'guarded-closed-provider-model'));
    const [{ errorCount: treeProviderFixErrors = 0, output: fixedTreeProviderCode = treeProviderResult.code } = {}]
        = await fixedCollectionEslint.lintText(treeProviderResult.code, {
            filePath: 'tree-provider-generated.js'
        });
    const [treeProviderLint = {}] = await outputEslint.lintText(fixedTreeProviderCode, {
        filePath: 'tree-provider-generated.js'
    });

    assert.equal(treeProviderFixErrors, 0, JSON.stringify(treeProviderLint.messages));
    assert.equal(treeProviderLint.errorCount, 0);
    const treeProviderRuntimeFile = path.join(programDirectory, 'tree-provider.js');
    await writeFile(treeProviderRuntimeFile, treeProviderResult.code.replace(
        "import { isFunction } from '../analysis/host/function.js';",
        "const isFunction = value => typeof value === 'function';"
    ));
    const { href: treeProviderHref = '' } = pathToFileURL(treeProviderRuntimeFile);
    const { disableConcat = false, join: joinTree = false } = await import(treeProviderHref);
    const modelTree = { value: 1, forest: [{ value: 2, forest: [] }] };
    const toTree = value => ({ value: `value:${value}`, forest: [{ value: 'child', forest: [] }] });

    assert.deepEqual(joinTree(modelTree, toTree), {
        value: 'value:1',
        forest: [{ value: 'child', forest: [] }, { value: 2, forest: [] }]
    });
    disableConcat();
    assert.deepEqual(joinTree(modelTree, toTree), { value: 'value:1', forest: [] });

    const invokedProviderSource = [
        'const getMapperComposition = <A, B>(F: A, G: B) => ({ map: (value: string) => [F, G].length ? value.toUpperCase() : value });',
        'const map = getMapperComposition({}, {}).map;',
        'export const use = () => map("value");',
        ''
    ].join('\n');
    await writeFile(providerEdgeFile, invokedProviderSource);
    const invokedProviderResult = createTypeScriptTransformer({
        typescript,
        program: createFixtureProgram([providerEdgeFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        })
    }).transform({
        code: invokedProviderSource,
        fileName: providerEdgeFile
    });

    assert.doesNotMatch(invokedProviderResult.code, /slang-required-function-provider-edge/);
    assert.match(invokedProviderResult.code, /getMapperComposition\(\{}, \{\}\)\.map/);

    const aliasThemeFile = path.join(programDirectory, 'alias-theme.ts');
    const aliasPropsFile = path.join(programDirectory, 'alias-props.ts');
    const aliasEntryFile = path.join(programDirectory, 'alias-entry.ts');

    await writeFile(aliasThemeFile, "export type ExternalMode = 'compact' | 'expanded';\n");
    await writeFile(aliasPropsFile, [
        "import type { ExternalMode as ExternalMode_2 } from './alias-theme.js';",
        'export interface ExternalProps { mode?: ExternalMode_2; }',
        ''
    ].join('\n'));
    await writeFile(aliasEntryFile, [
        "import type { ExternalProps } from './alias-props.js';",
        'export const readProps = (props: ExternalProps) => ExternalProps(props);',
        ''
    ].join('\n'));

    const aliasProgram = createFixtureProgram([
        aliasThemeFile,
        aliasPropsFile,
        aliasEntryFile
    ], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext
    });
    const aliasEntry = await readFile(aliasEntryFile, 'utf8');
    const aliasResult = createTypeScriptTransformer({ typescript, program: aliasProgram }).transform({
        code: aliasEntry,
        fileName: aliasEntryFile
    });

    assert.deepEqual(aliasResult.diagnostics, []);
    assert.match(aliasResult.code, /export const ExternalProps =/);
    assert.match(aliasResult.code, /mode = ['"]['"]/);

    const presenceFile = path.join(programDirectory, 'presence.ts');
    const presenceSource = [
        'export const combine = (first: number[], second?: number[]) =>',
        '    second ? first.concat(second) : (values: number[]) => values.concat(first);',
        'export const suffix = (search: string, position?: number) =>',
        '    (text: string) => text.endsWith(search, position);',
        'export const callback = (fn?: Function) => fn;',
        'export const reverseGuard = (value?: { label: string }) =>',
        '    undefined === value ? "missing" : value.label;',
        'export const preserve = <T>(M: { baseValue: T }) => [M.baseValue, M];',
        'export const readShape = (args: { name: string; count: number }) => [args.name, args.count];',
        'export const readExplicit = (args: { name: string } = { name: "authored" }) => args.name;',
        ''
    ].join('\n');

    await writeFile(presenceFile, presenceSource);
    const presenceProgram = createFixtureProgram([presenceFile], {
        target: typescript.ScriptTarget.ESNext,
        module: typescript.ModuleKind.ESNext,
        strict: true
    });
    const presenceResult = createTypeScriptTransformer({ typescript, program: presenceProgram }).transform({
        code: presenceSource,
        fileName: presenceFile
    });
    const presenceModule = await import(`data:text/javascript;base64,${Buffer.from(presenceResult.code).toString('base64')}`);

    assert.deepEqual(presenceResult.diagnostics, []);
    assert.deepEqual(presenceModule.combine([2])([1]), [1, 2]);
    assert.deepEqual(presenceModule.combine([1], []), [1]);
    assert.equal(presenceModule.suffix('c')('abc'), true);
    assert.equal(presenceModule.suffix('c', 0)('abc'), false);
    assert.equal(presenceModule.callback(), undefined);
    assert.equal(presenceModule.reverseGuard(), 'missing');
    assert.equal(presenceModule.reverseGuard({ label: 'present' }), 'present');
    assert.deepEqual(presenceModule.readShape(), ['', 0]);
    assert.deepEqual(presenceModule.readShape({ name: 'item', count: 3 }), ['item', 3]);
    assert.deepEqual(presenceModule.readShape({ count: 0 }), ['', 0]);
    assert.throws(() => presenceModule.readShape(null), TypeError);
    assert.equal(presenceModule.readExplicit(), 'authored');
    const opaqueSource = { baseValue: undefined };
    const inheritedSource = Object.create(opaqueSource);
    let getterReads = 0;
    const getterSource = {
        get baseValue() {
            getterReads += 1;

            return Reflect.get(opaqueSource, 'baseValue');
        }
    };

    assert.deepEqual(presenceModule.preserve(opaqueSource), [undefined, opaqueSource]);
    assert.deepEqual(presenceModule.preserve(inheritedSource), [undefined, inheritedSource]);
    assert.deepEqual(presenceModule.preserve(getterSource), [undefined, getterSource]);
    assert.equal(getterReads, 1);
    assert.deepEqual(presenceModule.preserve({}), [undefined, {}]);
    assert.throws(() => presenceModule.preserve(), TypeError);
    const orderingEslint = new ESLint({
        overrideConfigFile: true,
        overrideConfig: [{
            plugins: { resilient },
            rules: { 'no-use-before-define': 'error' }
        }]
    });
    const [presenceOrderingLint = {}] = await orderingEslint.lintText(presenceResult.code);

    assert.equal(presenceOrderingLint.errorCount, 0);

    const reexportFile = path.join(programDirectory, 'reexport.ts');
    const reexportSource = [
        "import './effects.js';",
        "import * as theme from './alias-theme.js';",
        'export { theme };',
        ''
    ].join('\n');

    await writeFile(reexportFile, reexportSource);
    const reexportProgram = createFixtureProgram([reexportFile, aliasThemeFile], {
        target: typescript.ScriptTarget.ESNext,
        module: typescript.ModuleKind.ESNext
    });
    const reexportResult = createTypeScriptTransformer({ typescript, program: reexportProgram }).transform({
        code: reexportSource,
        fileName: reexportFile
    });

    assert.match(reexportResult.code, /import ['"]\.\/effects\.js['"]/);
    const { statements: reexportStatements = [] } = typescript.createSourceFile('reexport.js', reexportResult.code, typescript.ScriptTarget.ESNext, true);
    const namespaceBindings = reexportStatements.filter(typescript.isImportDeclaration)
        .flatMap(({ importClause: { namedBindings = {} } = {}, moduleSpecifier: { text: specifier = '' } = {} } = {}) => {
            if (!typescript.isNamespaceImport(namedBindings)) return [];

            const { name: { text: binding = '' } = {} } = namedBindings;

            return [{ binding, specifier }];
        });
    assert.deepEqual(namespaceBindings, [{ binding: 'theme', specifier: './alias-theme.js' }]);
    assert.match(reexportResult.code, /export \{ theme \}/);

    const namespaceBindingResult = transform({
        code: [
            "import * as FC from './factory.js';",
            'export const composeMap = FC.map as any;',
            'export const extract = FC.extract;',
            'const composeAp = FC.ap;',
            'export const useBindings = value => [composeAp, extract(value)];',
            ''
        ].join('\n'),
        fileName: 'namespace-binding.ts'
    });

    assert.deepEqual(namespaceBindingResult.diagnostics, []);
    assert.match(namespaceBindingResult.code, /import \{ extract, ap as composeAp \} from ['"]\.\/factory\.js['"]/);
    assert.match(namespaceBindingResult.code, /export \{ map as composeMap \} from ['"]\.\/factory\.js['"]/);
    assert.match(namespaceBindingResult.code, /export \{ extract \};/);
    assert.doesNotMatch(namespaceBindingResult.code, /import \* as FC/);
    assert.doesNotMatch(namespaceBindingResult.code, /\{ map: composeMap \} = FC/);
    assert.doesNotMatch(namespaceBindingResult.code, /\{ ap: composeAp \} = FC/);

    const namespaceBoundaryResult = transform({
        code: [
            "import * as FC from './factory.js';",
            'export const composeMap = FC.map;',
            'export const invokeMap = (...items: unknown[]) => FC.map(...items);',
            ''
        ].join('\n'),
        fileName: 'namespace-boundary.ts'
    });

    assert.deepEqual(namespaceBoundaryResult.diagnostics, []);
    assert.match(namespaceBoundaryResult.code, /import \* as FC from ['"]\.\/factory\.js['"]/);
    assert.match(namespaceBoundaryResult.code, /FC\.map\(\.\.\.items\)/);
    assert.match(namespaceBoundaryResult.code, /export \{ map as composeMap \} from ['"]\.\/factory\.js['"]/);

    const namespaceSharedBindingResult = transform({
        code: [
            "import * as FC from './factory.js';",
            'export const composeMap = FC.map;',
            'export const useBinding = value => composeMap(value);',
            'export const invokeMap = (...items: unknown[]) => FC.map(...items);',
            ''
        ].join('\n'),
        fileName: 'namespace-shared-binding.ts'
    });

    assert.deepEqual(namespaceSharedBindingResult.diagnostics, []);
    assert.match(namespaceSharedBindingResult.code, /import \* as FC from ['"]\.\/factory\.js['"]/);
    assert.match(namespaceSharedBindingResult.code, /import \{ map as composeMap \} from ['"]\.\/factory\.js['"]/);
    assert.match(namespaceSharedBindingResult.code, /export \{ composeMap \};/);
    assert.doesNotMatch(namespaceSharedBindingResult.code, /const composeMap = FC\.map/);

    const nestedNamespaceBindingResult = transform({
        code: [
            "import * as FC from './factory.js';",
            'export const selectMap = value => {',
            '    const selected = FC.map;',
            '    if (!value) return selected;',
            '    return FC.other(value);',
            '};',
            ''
        ].join('\n'),
        fileName: 'namespace-nested-binding.ts'
    });

    assert.deepEqual(nestedNamespaceBindingResult.diagnostics, []);
    assert.match(nestedNamespaceBindingResult.code, /import \* as FC from ['"]\.\/factory\.js['"]/);
    assert.match(nestedNamespaceBindingResult.code, /import \{ map as selected \} from ['"]\.\/factory\.js['"]/);
    assert.match(nestedNamespaceBindingResult.code, /return FC\.other\(value\)/);
    assert.doesNotMatch(nestedNamespaceBindingResult.code, /const selected = FC\.map/);

    const legacyProgram = createFixtureProgram([programEntryFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ES2015
    });

    assert.throws(
        () => createTypeScriptTransformer({ typescript, program: legacyProgram }),
        /ECMAScript 2016 or newer/
    );
    const boundaryModelResult = transform({
        code: `
        type User = { id: string; name?: string; tags?: string[] };
        export const render = (user: User) => user.name;
    `,
        fileName: 'boundary-model.ts'
    });

    assert.deepEqual(boundaryModelResult.diagnostics, []);
    assert.match(boundaryModelResult.code, /const render = \(\{ name: userName = ['"]['"] \} = \{\}\) =>/);
    assert.match(boundaryModelResult.code, /return userName/);
    assert.doesNotMatch(boundaryModelResult.code, /return user\.name/);

    const componentResult = transform({
        code: `
        type CardProps = {
            title?: string;
            items?: string[];
            onSelect?: (item: string) => void;
        };

        const Card = ({ title, items, onSelect, ...attrs }: CardProps = {}) => (
            <article {...attrs}>
                <h2>{title}</h2>
                {items.map(item => <button onClick={() => onSelect && onSelect(item)}>{item}</button>)}
            </article>
        );
    `,
        fileName: 'Card.tsx'
    });

    assert.deepEqual(componentResult.diagnostics, []);
    assert.match(componentResult.code, /title = ""/);
    assert.match(componentResult.code, /items = \[\]/);
    assert.match(componentResult.code, /onSelect, \.\.\.attrs/);
    assert.match(componentResult.code, /items\.map/);
    assert.doesNotMatch(componentResult.code, /CardProps/);
    assert.doesNotMatch(componentResult.code, /onSelect = \{\}/);

    const inlineComponentResult = transform({
        code: `
        const Card = ({ title, items, ...attrs }: {
            title?: string;
            items?: string[];
        } = {}) => <article {...attrs}>{items.map(item => <span>{title}{item}</span>)}</article>;
    `,
        fileName: 'InlineCard.tsx'
    });

    assert.deepEqual(inlineComponentResult.diagnostics, []);
    assert.match(inlineComponentResult.code, /title = ""/);
    assert.match(inlineComponentResult.code, /items = \[\]/);
    assert.doesNotMatch(inlineComponentResult.code, /CardProps/);

    const moduleSource = [
        `const isObject = value => Object.prototype.toString.call(value) === '[object Object]';\n`,
        `const hasContent = value => isObject(value) && Object.keys(value).length > 0;\n`,
        result.code.replace('const render', 'export const render')
    ].join('');
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`;
    const translated = await import(moduleUrl);

    assert.deepEqual(translated.User({ name: 'Ada' }), { name: 'Ada', id: '' });
    assert.deepEqual(translated.User(), { name: '', id: '' });
    assert.deepEqual(translated.User(null), { name: '', id: '' });
    assert.deepEqual(translated.User({}), { name: '', id: '' });
    assert.deepEqual(translated.resolveUserOrId('user-1'), {
        kind: 'string',
        value: 'user-1'
    });
    assert.deepEqual(translated.resolveUserOrId({ name: 'Ada' }), {
        kind: 'object',
        value: { name: 'Ada', id: '' }
    });

    const runtimeProof = transform({
        code: `
        type Target = 'web' | 'native';

        export const resolveTargetValue = (value: Target) => value;
        export const pass = (value: any) => {
            if (!hasContent(value)) return {};

            return value;
        };
    `,
        fileName: 'runtime-proof.ts'
    });
    const runtimeProofSource = [
        `const isObject = value => Object.prototype.toString.call(value) === '[object Object]';\n`,
        `const hasContent = (value = {}) => isObject(value) && !!Object.keys(value).length;\n`,
        runtimeProof.code
    ].join('');
    const runtimeProofUrl = `data:text/javascript;base64,${Buffer.from(runtimeProofSource).toString('base64')}`;
    const runtimeProofModule = await import(runtimeProofUrl);

    assert.equal(runtimeProofModule.resolveTargetValue('web'), 'web');
    assert.equal(runtimeProofModule.resolveTargetValue('desktop'), 'desktop');
    assert.deepEqual(runtimeProofModule.pass(), {});
    assert.deepEqual(runtimeProofModule.pass({ ready: true }), { ready: true });

    const componentRuntime = transform({
        code: `
        const Button = props => ({ component: 'Button', ...props });
        const Link = props => ({ component: 'Link', ...props });
        type ButtonProps = { kind: 'button'; label: string };
        type LinkProps = { kind: 'link'; href: string };
        type Action = ButtonProps | LinkProps;
        export const render = (value: Action) => value.kind === 'button' ? Button(value) : Link(value);
    `,
        fileName: 'component-runtime.ts'
    });
    assert.match(componentRuntime.code, /export const resolveAction =/);
    const componentRuntimeUrl = `data:text/javascript;base64,${Buffer.from(componentRuntime.code).toString('base64')}`;
    const componentRuntimeModule = await import(componentRuntimeUrl);

    assert.deepEqual(componentRuntimeModule.render({ kind: 'button', label: 'Save' }), {
        component: 'Button',
        kind: 'button',
        label: 'Save'
    });
    assert.deepEqual(componentRuntimeModule.render({ kind: 'link', href: '/docs' }), {
        component: 'Link',
        kind: 'link',
        href: '/docs'
    });

    const unresolvedUnion = transform({
        code: `
        type ExternalValue = any;
        type Value = string | ExternalValue;
        const resolveValue = (value: Value) => resolveValue(value);
    `,
        fileName: 'unresolved-union.ts'
    });

    assert.deepEqual(unresolvedUnion.diagnostics, []);
    assert.doesNotMatch(unresolvedUnion.code, /if \(true\)/);
    assert.match(unresolvedUnion.code, /kind: 'string'/);
    assert.match(unresolvedUnion.code, /kind: 'any'/);
    assert.match(unresolvedUnion.code, /export const resolveValueUnion =/);

    const namespacedTypes = transform({
        code: `
        namespace Config {
            export interface Options {
                name?: string;
                tags?: string[];
            }

            export type Target = 'web' | 'native';
        }

        const render = (value: Config.Options) => resolveConfigOptions(value);
        const resolve = (value: Config.Target) => value;
    `,
        fileName: 'namespaced-types.ts'
    });

    assert.deepEqual(namespacedTypes.diagnostics, []);
    assert.match(namespacedTypes.code, /export const resolveConfigOptions =/);
    assert.match(namespacedTypes.code, /name = ''/);
    assert.match(namespacedTypes.code, /tags = \[\]/);
    assert.doesNotMatch(namespacedTypes.code, /resolveConfigTarget/);
    assert.doesNotMatch(namespacedTypes.code, /namespace Config/);

    const componentAssignment = transform({
        code: `
        const Button = props => props;
        const Link = props => props;
        type ButtonProps = { kind: 'button'; label: string };
        type LinkProps = { kind: 'link'; href: string };
        type Action = ButtonProps | LinkProps;
        export const render = (value: Action) => value.kind === 'button' ? Button(value) : Link(value);
    `,
        fileName: 'component-assignment.ts'
    });

    assert.deepEqual(componentAssignment.diagnostics, []);
    assert.match(componentAssignment.code, /export const resolveAction =/);
    assert.match(componentAssignment.code, /Button\(value\)/);
    assert.match(componentAssignment.code, /Link\(value\)/);

    const functionUnion = transform({
        code: `
        const Button = props => props;
        const Link = props => props;
        type Component = typeof Button | typeof Link;
        export const resolveComponentValue = (component: Component) => component;
    `,
        fileName: 'function-union.ts'
    });

    assert.deepEqual(functionUnion.diagnostics, []);
    assert.match(functionUnion.code, /const resolveComponentValue = component => component/);
    assert.doesNotMatch(functionUnion.code, /export const resolveComponent =/);
    assert.doesNotMatch(functionUnion.code, /Button\(input\)/);
    assert.doesNotMatch(functionUnion.code, /Link\(input\)/);
    const functionUnionUrl = `data:text/javascript;base64,${Buffer.from(functionUnion.code).toString('base64')}`;
    const functionUnionModule = await import(functionUnionUrl);
    const component = () => 'component';

    assert.equal(functionUnionModule.resolveComponentValue(component), component);

    const standardRuntimeResult = createTypeScriptTransformer({
        typescript,
        standard: {
            array: '../analysis/host/array.js',
            function: '../analysis/host/function.js'
        }
    }).transform({
        code: `
        type RuntimeValue = string[] | (() => string);
        export const resolveRuntimeValue = (value: RuntimeValue) => value;
    `,
        fileName: 'standard-runtime.ts'
    });

    assert.match(standardRuntimeResult.code, /import \{ hasArrayContent \} from '..\/analysis\/host\/array\.js';/);
    assert.match(standardRuntimeResult.code, /import \{ isFunction \} from '..\/analysis\/host\/function\.js';/);
    assert.match(standardRuntimeResult.code, /hasArrayContent\(input\)/);
    assert.doesNotMatch(standardRuntimeResult.code, /isArray\(input\)/);
    assert.match(standardRuntimeResult.code, /isFunction\(input\)/);

    const guardedPayloadSource = [
        'type Result<T> = { outbound: T };',
        'export const invoke = (result: Result<() => string>) => {',
        '    const { outbound: value } = result;',
        '    return value();',
        '};',
        ''
    ].join('\n');
    const guardedPayloadFile = path.join(programDirectory, 'guarded-payload.ts');
    await writeFile(guardedPayloadFile, guardedPayloadSource);
    const guardedPayloadProgram = createFixtureProgram([guardedPayloadFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const guardedPayloadResult = createTypeScriptTransformer({
        typescript,
        program: guardedPayloadProgram,
        standard: {
            object: '../analysis/host/object.js',
            function: '../analysis/host/function.js'
        }
    }).transform({
        code: guardedPayloadSource,
        fileName: guardedPayloadFile
    });

    assert.deepEqual(guardedPayloadResult.diagnostics, []);
    assert.match(guardedPayloadResult.code, /import \{ isFunction \} from ['"]\.?\.?\/analysis\/host\/function\.js['"];/);
    assert.match(guardedPayloadResult.code, /const \{ outbound: value \} = result;/);
    assert.match(guardedPayloadResult.code, /if \(![\s\S]*?isFunction\(value\)\)[\s\S]*?return;/);
    assert.doesNotMatch(guardedPayloadResult.code, /outbound: value = \(\(\) =>/);

    const guardedPayloadRuntimeResult = createTypeScriptTransformer({
        typescript,
        program: guardedPayloadProgram
    }).transform({
        code: guardedPayloadSource,
        fileName: guardedPayloadFile
    });
    const guardedPayloadRuntimeFile = path.join(programDirectory, 'guarded-payload-runtime.js');
    await writeFile(guardedPayloadRuntimeFile, guardedPayloadRuntimeResult.code);
    const guardedPayloadUrl = pathToFileURL(guardedPayloadRuntimeFile);
    const { href: guardedPayloadHref = '' } = guardedPayloadUrl;
    const guardedPayloadModule = await import(guardedPayloadHref);
    const guardedFunction = () => 'ok';

    assert.equal(guardedPayloadModule.invoke({ outbound: guardedFunction }), 'ok');
    assert.equal(guardedPayloadModule.invoke({ outbound: 'not-a-function' }), undefined);

    const standardModelResult = createTypeScriptTransformer({
        typescript,
        standard: { object: '../analysis/host/object.js' }
    }).transform({
        code: `
        type Button = { kind: 'button'; label: string };
        type Link = { kind: 'link'; href: string };
        type Action = Button | Link;
        export const resolveActionValue = (value: Action) => value;
    `,
        fileName: 'standard-model.ts'
    });

    assert.match(standardModelResult.code, /import \{ isObject, modelCheck \} from '..\/analysis\/host\/object\.js';/);
    assert.match(standardModelResult.code, /modelCheck\(['"]kind['"], input\)/);
    assert.match(standardModelResult.code, /const \{ ['"]kind['"]: input_kind = ["']?["'][^;]*\} = source;/);
    assert.doesNotMatch(standardModelResult.code, /input\[['"]kind['"]\]/);
    assert.doesNotMatch(standardModelResult.code, /"kind" in input/);

    const primitiveUnion = transform({
        code: `
        type Primitive = string | number | boolean | bigint | string[] | (() => string);
        type StringValue = string | 'draft';
        export const resolvePrimitiveValue = (value: Primitive) => value;
        export const passStringValue = (value: StringValue) => value;
    `,
        fileName: 'primitive-union.ts'
    });

    assert.deepEqual(primitiveUnion.diagnostics, []);
    assert.match(primitiveUnion.code, /typeof input === ['"]string['"]/);
    assert.match(primitiveUnion.code, /typeof input === ['"]number['"]/);
    assert.match(primitiveUnion.code, /typeof input === ['"]boolean['"]/);
    assert.match(primitiveUnion.code, /typeof input === ['"]bigint['"]/);
    assert.match(primitiveUnion.code, /Array\.isArray\(input\) && input\.length/);
    assert.match(primitiveUnion.code, /typeof input === ['"]function['"]/);
    assert.doesNotMatch(primitiveUnion.code, /export const resolveStringValue/);
    const primitiveUnionSource = [
        `const isObject = value => Object.prototype.toString.call(value) === '[object Object]';\n`,
        primitiveUnion.code
    ].join('');
    const primitiveUnionUrl = `data:text/javascript;base64,${Buffer.from(primitiveUnionSource).toString('base64')}`;
    const primitiveUnionModule = await import(primitiveUnionUrl);

    assert.equal(primitiveUnionModule.resolvePrimitive('value').kind, 'string');
    assert.equal(primitiveUnionModule.resolvePrimitive(1).kind, 'number');
    assert.equal(primitiveUnionModule.resolvePrimitive(false).kind, 'boolean');
    assert.equal(primitiveUnionModule.resolvePrimitive(1n).kind, 'bigint');
    assert.equal(primitiveUnionModule.resolvePrimitive([0]).kind, 'array');
    assert.equal(primitiveUnionModule.resolvePrimitive([]).kind, 'any');
    assert.equal(primitiveUnionModule.resolvePrimitive(NaN).kind, 'number');
    const primitiveFunction = () => 'value';
    assert.equal(primitiveUnionModule.resolvePrimitive(primitiveFunction).value, primitiveFunction);
    assert.equal(primitiveUnionModule.passStringValue('other'), 'other');

    const genericUnionConstraint = transform({
        code: 'export const read = <T extends string | number | undefined | null>(value: T) => value;',
        fileName: 'generic-union-constraint.ts'
    });

    assert.deepEqual(genericUnionConstraint.diagnostics, []);
    assert.match(genericUnionConstraint.code, /export const resolveStringNumber =/);
    assert.doesNotMatch(genericUnionConstraint.code, /resolveStringNumberUndefinedNull/);
    assert.match(genericUnionConstraint.code, /const read = value => value/);

    const unsupportedType = transform({
        code: `
        type Resolve<T> = T extends string ? string : number;
        export const readText = (value: Resolve<string>) => value;
        export const readCount = (value: Resolve<number>) => value;
    `,
        fileName: 'unsupported-type.ts'
    });

    assert.deepEqual(unsupportedType.diagnostics, []);
    assert.match(unsupportedType.code, /const readText = value => value/);
    assert.match(unsupportedType.code, /const readCount = value => value/);

    const distributiveConditional = transform({
        code: `
        type Resolve<T> = T extends string ? string : number;
        type Value = Resolve<string | number>;
        export const read = (value: Value) => value;
    `,
        fileName: 'distributive-conditional.ts'
    });

    assert.deepEqual(distributiveConditional.diagnostics, []);
    assert.match(distributiveConditional.code, /export const resolveValue =/);
    assert.match(distributiveConditional.code, /kind: 'string'/);
    assert.match(distributiveConditional.code, /kind: 'number'/);

    const genericContracts = transform({
        code: `
        type Box<T extends string = string> = {
            value: T;
            fallback?: T;
        };
        type Maybe<T extends string | number = string> = T | undefined;
        const readText = <T extends string>(value: T) => value;
        const readBox = ({ value, fallback }: Box = {}) => ({ value, fallback });
        const readNumber = (value: Maybe<number>) => value;
        export const readDefault = (value: Maybe) => value;
    `,
        fileName: 'generic-contracts.ts'
    });

    assert.deepEqual(genericContracts.diagnostics, []);
    assert.match(genericContracts.code, /const readText = value => value/);
    assert.match(genericContracts.code, /const readBox = \(\{ value = "", fallback = "" \} = \{\}\)/);
    assert.match(genericContracts.code, /const readNumber = \(value = 0\) => value/);
    assert.match(genericContracts.code, /export const readDefault = \(value = ""\) => value/);

    const genericProjection = transform({
        code: `
        type Envelope<T extends string = string> = {
            value: T;
            label?: T;
        };
        type Projected = { [P in keyof Envelope<number>]: Envelope<number>[P] };
        export const read = ({ value, label }: Projected = {}) => ({ value, label });
    `,
        fileName: 'generic-projection.ts'
    });

    assert.deepEqual(genericProjection.diagnostics, []);
    assert.match(genericProjection.code, /const read = \(\{ value = 0, label = 0 \} = \{\}\)/);

    const impossibleType = transform({
        code: `
        type Text = string | never | void;
        type Impossible = never;
        export const read = (value: Text) => value;
        export const unreachable = (value: Impossible) => value;
    `,
        fileName: 'impossible-type.ts'
    });

    assert.deepEqual(impossibleType.diagnostics, []);
    assert.match(impossibleType.code, /const read = \(value = ""\) => value/);
    assert.match(impossibleType.code, /const unreachable = value => value/);
    assert.doesNotMatch(impossibleType.code, /kind: 'unknown'/);

    const structuralUtility = transform({
        code: `
        type Source = { id: string; name?: string; ignored: boolean };
        type Picked = Pick<Source, 'id' | 'name'>;
        type Omitted = Omit<Source, 'ignored'>;
        const readPicked = ({ id, name }: Picked = {}) => ({ id, name });
        const readOmitted = (value: Omitted) => value;
    `,
        fileName: 'structural-utility.ts'
    });

    assert.deepEqual(structuralUtility.diagnostics, []);
    assert.match(structuralUtility.code, /const readPicked = \(\{ id = "", name = "" \} = \{\}\)/);
    assert.match(structuralUtility.code, /const readOmitted = value => value/);
    assert.doesNotMatch(structuralUtility.code, /Pick<Source/);
    assert.doesNotMatch(structuralUtility.code, /Omit<Source/);

    const modifierUtility = transform({
        code: `
        type Source = {
            title: string;
            callback?: () => void;
        };
        type OptionalSource = Partial<Source>;
        type CompleteSource = Required<Pick<Source, 'title' | 'callback'>>;
        const readOptional = ({ title, callback }: OptionalSource = {}) => ({ title, callback });
        export const readComplete = ({ title, callback }: CompleteSource = {}) => ({ title, callback });
    `,
        fileName: 'modifier-utility.ts'
    });

    assert.deepEqual(modifierUtility.diagnostics, []);
    assert.match(modifierUtility.code, /const readOptional = \(\{ title = "", callback \} = \{\}\)/);
    assert.match(modifierUtility.code, /const readComplete = \(\{ title = "", callback \} = \{\}\)/);
    assert.doesNotMatch(modifierUtility.code, /callback = \(\(\) =>/);
    assert.doesNotMatch(modifierUtility.code, /Partial<Source>/);
    assert.doesNotMatch(modifierUtility.code, /Required<Pick/);

    const mappedType = transform({
        code: `
        type Source = { title: string; count?: number };
        type Clone = { [P in keyof Source]: Source[P] };
        type OptionalClone = { [P in keyof Source]?: Source[P] };
        const readClone = ({ title, count }: Clone = {}) => ({ title, count });
        export const readOptionalClone = ({ title, count }: OptionalClone = {}) => ({ title, count });
    `,
        fileName: 'mapped-type.ts'
    });

    assert.deepEqual(mappedType.diagnostics, []);
    assert.match(mappedType.code, /const readClone = \(\{ title = "", count = 0 \} = \{\}\)/);
    assert.match(mappedType.code, /const readOptionalClone = \(\{ title = "", count = 0 \} = \{\}\)/);
    assert.doesNotMatch(mappedType.code, /MappedType/);
    assert.doesNotMatch(mappedType.code, /\[P in keyof Source\]/);

    const typeAlgebraUtility = transform({
        code: `
        type MaybeText = string | null | undefined;
        type CleanText = NonNullable<MaybeText>;
        type DefinedText = Exclude<MaybeText, null | undefined>;
        type TextOnly = Extract<string | number, string>;
        type Nothing = Exclude<string, string>;
        export const readClean = (value: CleanText) => value;
        export const readDefined = (value: DefinedText) => value;
        export const readText = (value: TextOnly) => value;
        export const readNothing = (value: Nothing) => value;
    `,
        fileName: 'type-algebra-utility.ts'
    });

    assert.deepEqual(typeAlgebraUtility.diagnostics, []);
    assert.match(typeAlgebraUtility.code, /const readClean = value => value/);
    assert.match(typeAlgebraUtility.code, /const readDefined = value => value/);
    assert.match(typeAlgebraUtility.code, /const readText = value => value/);
    assert.match(typeAlgebraUtility.code, /const readNothing = value => value/);
    assert.doesNotMatch(typeAlgebraUtility.code, /value = ''/);
    assert.doesNotMatch(typeAlgebraUtility.code, /kind: 'unknown'/);

    const indexedAccessUtility = transform({
        code: `
        type Source = {
            id: string;
            metadata?: { title: string };
            ignored: boolean;
        };
        type Other = { ignored: number };
        type Clean = Omit<Source, keyof Other>;
        type Metadata = Source['metadata'];
        type Count = Record<string, number>['anything'];
        const readClean = ({ id, metadata }: Clean = {}) => ({ id, metadata });
        export const readMetadata = (value: Metadata) => value;
        export const readCount = (value: Count) => value;
    `,
        fileName: 'indexed-access-utility.ts'
    });

    assert.deepEqual(indexedAccessUtility.diagnostics, []);
    assert.match(indexedAccessUtility.code, /const readClean = \(\{ id = "", metadata = \{\} \} = \{\}\)/);
    assert.match(indexedAccessUtility.code, /const readMetadata = \(value = \{\}\) => value/);
    assert.match(indexedAccessUtility.code, /const readCount = value => value/);
    assert.doesNotMatch(indexedAccessUtility.code, /ignored/);
    assert.doesNotMatch(indexedAccessUtility.code, /IndexedAccessType/);

    const unresolvedIndexedAccess = transform({
        code: 'type Source = { value: string }; type Key = string; export const read = (value: Source[Key]) => value;',
        fileName: 'unresolved-indexed-access.ts'
    });

    assert.equal(unresolvedIndexedAccess.diagnostics.length, 1);
    assert.equal(unresolvedIndexedAccess.diagnostics[0].kind, 'IndexedAccessType');
    assert.equal(unresolvedIndexedAccess.code, '');

    const primitiveAbsence = transform({
        code: `
        type Text = string | null | undefined;
        type NaN = undefined;
        type Count = number | NaN | null | undefined;
        type Enabled = boolean | null | undefined;
        type Items = string[] | null | undefined;
        type Settings = { name: string } | null | undefined;
        type Callback = (() => string) | null | undefined;
        export const read = (
            text: Text,
            count: Count,
            enabled: Enabled,
            items: Items,
            settings: Settings,
            callback: Callback
        ) => ({ text, count, enabled, items, settings, callback });
    `,
        fileName: 'primitive-absence.ts'
    });

    assert.deepEqual(primitiveAbsence.diagnostics, []);
    assert.match(primitiveAbsence.code, /text = ""/);
    assert.match(primitiveAbsence.code, /count = 0/);
    assert.match(primitiveAbsence.code, /enabled = false/);
    assert.match(primitiveAbsence.code, /items = \[\]/);
    assert.match(primitiveAbsence.code, /settings = \{\}/);
    assert.match(primitiveAbsence.code, /callback[,)]/);
    assert.doesNotMatch(primitiveAbsence.code, /callback = \{\}/);

    const documentedTypeShortcuts = transform({
        code: `
        type NaN = undefined;
        type Missing = NaN;
        type Count = number | Missing;
        type StringKeys = { title: string };
        type NumericKeys = { 0: string };
        type SymbolKeys = { [key: symbol]: string };
        type MixedKeys = { [key: string]: string; [key: symbol]: string };
        export const read = (
            count: Count,
            stringKey: keyof StringKeys,
            numericKey: keyof NumericKeys,
            symbolKey: keyof SymbolKeys,
            mixedKey: keyof MixedKeys
        ) => [count, stringKey, numericKey, symbolKey, mixedKey];
    `,
        fileName: 'documented-type-shortcuts.ts'
    });

    assert.deepEqual(documentedTypeShortcuts.diagnostics, []);
    assert.match(documentedTypeShortcuts.code, /count = 0/);
    assert.match(documentedTypeShortcuts.code, /typeof input === 'string'/);
    assert.match(documentedTypeShortcuts.code, /typeof input === 'number'/);
    assert.match(documentedTypeShortcuts.code, /typeof input === 'symbol'/);
    const shortcutContracts = analyze({
        code: `
        type StringKeys = { title: string };
        type NumericKeys = { 0: string };
        type SymbolKeys = { [key: symbol]: string };
        export const read = (stringKey: keyof StringKeys, numericKey: keyof NumericKeys, symbolKey: keyof SymbolKeys) =>
            [stringKey, numericKey, symbolKey];
    `,
        fileName: 'documented-type-shortcuts-analysis.ts'
    }).contracts.filter(({ parameter = '' } = {}) => ['stringKey', 'numericKey', 'symbolKey'].includes(parameter));

    assert.deepEqual(shortcutContracts.map(({ parameter = '', family = '', canonical = '' } = {}) => [parameter, family, canonical]), [
        ['stringKey', 'string', "''"],
        ['numericKey', 'number', '0'],
        ['symbolKey', 'symbol', '']
    ]);

    const optionalFunction = transform({
        code: 'export const call = (callback?: () => string) => callback && callback();',
        fileName: 'optional-function.ts'
    });

    assert.deepEqual(optionalFunction.diagnostics, []);
    assert.match(optionalFunction.code, /const call = callback =>/);
    assert.doesNotMatch(optionalFunction.code, /callback = \{\}/);

    const nullUnion = transform({
        code: `
        type Value = string | null;
        export const resolveValue = (value: Value) => value;
    `,
        fileName: 'null-union.ts'
    });

    assert.deepEqual(nullUnion.diagnostics, []);
    assert.match(nullUnion.code, /const resolveValue = \(value = ""\) => value/);
    assert.doesNotMatch(nullUnion.code, /kind: 'unknown'/);
    const nullUnionUrl = `data:text/javascript;base64,${Buffer.from(nullUnion.code).toString('base64')}`;
    const nullUnionModule = await import(nullUnionUrl);

    assert.equal(nullUnionModule.resolveValue(), '');
    assert.equal(nullUnionModule.resolveValue('value'), 'value');

    const syntheticUnion = transform({
        code: `
        type User = { name: string };
        type Settings = { theme: string };
        type Value = User | Settings;
        export const normalizeValue = (value: Value) => value;
    `,
        fileName: 'synthetic-union.ts'
    });

    assert.deepEqual(syntheticUnion.diagnostics, []);
    assert.match(syntheticUnion.code, /export const User =/);
    assert.match(syntheticUnion.code, /export const Settings =/);
    assert.match(syntheticUnion.code, /['"]name['"] in input/);
    assert.match(syntheticUnion.code, /['"]theme['"] in input/);
    const syntheticUnionSource = [
        `const isObject = value => Object.prototype.toString.call(value) === '[object Object]';\n`,
        `const hasContent = value => isObject(value) && Object.keys(value).length > 0;\n`,
        syntheticUnion.code
    ].join('');
    const syntheticUnionUrl = `data:text/javascript;base64,${Buffer.from(syntheticUnionSource).toString('base64')}`;
    const syntheticUnionModule = await import(syntheticUnionUrl);

    assert.deepEqual(syntheticUnionModule.resolveValue({ name: 'Ada' }), {
        kind: 'object',
        value: { name: 'Ada' }
    });
    assert.deepEqual(syntheticUnionModule.resolveValue({ theme: 'dark' }), {
        kind: 'object',
        value: { theme: 'dark' }
    });

    assert.deepEqual(syntheticUnionModule.resolveValue(null), {
        kind: 'any',
        value: null
    });
    assert.deepEqual(syntheticUnionModule.resolveValue(), {
        kind: 'any',
        value: undefined
    });
    assert.deepEqual(syntheticUnionModule.resolveValue({}), {
        kind: 'any',
        value: {}
    });
    assert.deepEqual(syntheticUnionModule.resolveValue([]), {
        kind: 'any',
        value: []
    });
    assert.equal(syntheticUnionModule.resolveValue('').kind, 'any');
    assert.doesNotMatch(syntheticUnion.code, /resolveValue = \(input = \{\}\)/);

    const indistinguishableSyntheticUnion = transform({
        code: `
        type First = {};
        type Second = {};
        type Value = First | Second;
        export const normalizeValue = (value: Value) => value;
    `,
        fileName: 'indistinguishable-synthetic-union.ts'
    });

    assert.deepEqual(indistinguishableSyntheticUnion.diagnostics, []);
    assert.match(indistinguishableSyntheticUnion.code, /export const resolveValue =/);
    assert.doesNotMatch(indistinguishableSyntheticUnion.code, /First\(input\)/);
    assert.doesNotMatch(indistinguishableSyntheticUnion.code, /Second\(input\)/);
    assert.match(indistinguishableSyntheticUnion.code, /kind: 'any',[\s\S]*value: input/);

    const unguardedAny = transform({
        code: 'const read = (value: any) => value;',
        fileName: 'unguarded.ts'
    });

    assert.deepEqual(unguardedAny.diagnostics, []);
    assert.match(unguardedAny.code, /const read = value => value/);

    const undefinedUnion = transform({
        code: `
        type Options = string | undefined;
        type Config = { options: Options };
        const render = (options: Options) => options.trim();
        const renderConfig = ({ options }: Config = {}) => options.trim();
    `,
        fileName: 'undefined-union.ts'
    });

    assert.deepEqual(undefinedUnion.diagnostics, []);
    assert.match(undefinedUnion.code, /const render = \(options = ""\) => options\.trim\(\)/);
    assert.match(undefinedUnion.code, /options = ""/);
    assert.doesNotMatch(undefinedUnion.code, /type Options/);

    const guardedAny = transform({
        code: 'const read = (value: any) => typeof value === "string" ? value : "";',
        fileName: 'guarded.ts'
    });

    assert.deepEqual(guardedAny.diagnostics, []);
    assert.match(guardedAny.code, /const read =/);

    const optionalGuardedAny = transform({
        code: 'const read = (value?: any) => typeof value === "string" ? value : "";',
        fileName: 'optional-guarded.ts'
    });

    assert.deepEqual(optionalGuardedAny.diagnostics, []);
    assert.match(optionalGuardedAny.code, /const read = value =>/);

    const objectOptionalByFallback = transform({
        code: `
        type Options = { name?: string };
        const render = (object: Options) => {
            if (!hasContent(object)) return {};
            return Options(object);
        };
    `,
        fileName: 'object-fallback.ts'
    });

    assert.deepEqual(objectOptionalByFallback.diagnostics, []);
    assert.match(objectOptionalByFallback.code, /const render = \(object\) =>/);

    const anyOptionalByFallback = transform({
        code: `
        const render = (object: any) => {
            if (!hasContent(object)) return {};
            return object;
        };
    `,
        fileName: 'any-fallback.ts'
    });

    assert.deepEqual(anyOptionalByFallback.diagnostics, []);
    assert.match(anyOptionalByFallback.code, /const render = \(object\) =>/);

    const resolvedAny = createTypeScriptTransformer({
        typescript,
        resolvers: { any: 'resolveExternalValue' }
    }).transform({
        code: 'const read = (value: any) => resolveExternalValue(value);',
        fileName: 'resolved.ts'
    });

    assert.deepEqual(resolvedAny.diagnostics, []);
    assert.match(resolvedAny.code, /resolveExternalValue\(value\)/);

    const negatedBranchBinding = transform({
        code: [
            'const isReady = (value: { category: string }) => value.category === "Ready";',
            'export const read = (value: { category: string; value: string }) => {',
            '    if (!isReady(value)) return "";',
            '    const { value: readyValue } = value;',
            '    return readyValue;',
            '};',
            ''
        ].join('\n'),
        fileName: 'negated-branch-binding.ts'
    });

    assert.deepEqual(negatedBranchBinding.diagnostics, []);
    assert.match(negatedBranchBinding.code, /const \{ value: readyValue \} = value;/);
    assert.doesNotMatch(negatedBranchBinding.code, /branch guard establishes variant before extraction/);
    const [negatedBranchBindingLint = {}] = await outputEslint.lintText(negatedBranchBinding.code, {
        filePath: 'negated-branch-binding-generated.js'
    });

    // The shared signature policy retains a parameter used by the guard; its field default remains independently required.
    assert.deepEqual(negatedBranchBindingLint.messages.filter(({ ruleId = '' } = {}) => (
        ['resilient/prefer-signature-destructuring', 'resilient/prefer-safe-destructuring-defaults'].includes(ruleId)
    )).map(({ ruleId = '' } = {}) => ruleId).toSorted(), [
        'resilient/prefer-safe-destructuring-defaults'
    ], JSON.stringify(negatedBranchBindingLint.messages));

    const selectedModelBinding = transform({
        code: [
            'export const read = (value: { category: string; value: string }) => {',
            '    const { category: tag = "" } = value;',
            '    if (tag !== "Ready") return "";',
            '    const { value: readyValue } = value;',
            '    return readyValue;',
            '};',
            ''
        ].join('\n'),
        fileName: 'selected-model-binding.ts'
    });

    assert.deepEqual(selectedModelBinding.diagnostics, []);
    assert.match(selectedModelBinding.code, /const \{ category: tag = "" \} = value;/);
    assert.doesNotMatch(selectedModelBinding.code, /tag Get precedes branch-local payload extraction/);
    const [selectedModelBindingLint = {}] = await outputEslint.lintText(selectedModelBinding.code, {
        filePath: 'selected-model-binding-generated.js'
    });

    assert.equal(selectedModelBindingLint.messages.filter(({ ruleId = '' } = {}) => (
        ruleId === 'resilient/prefer-signature-destructuring'
    )).length, 2, JSON.stringify(selectedModelBindingLint.messages));

    const retainedPayloadReadSource = [
        'type Result = { category: "Missing" } | { category: "Available"; value: [number, number] };',
        'type Operations = { readonly combine: (inbound: number, outbound: number) => number };',
        'export const read = (result: Result, operations: Operations) => {',
        '    if (result.category === "Missing") return 0;',
        '    return operations.combine(result.value[0], result.value[1]);',
        '};',
        ''
    ].join('\n');
    const retainedPayloadReadSourceFile = path.join(programDirectory, 'retained-payload-read.ts');
    await writeFile(retainedPayloadReadSourceFile, retainedPayloadReadSource);
    const retainedPayloadProgram = createFixtureProgram([retainedPayloadReadSourceFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const retainedPayloadFacts = collectOrderedNestedTupleReadContracts({
        typescript,
        sourceFile: retainedPayloadProgram.getSourceFile(retainedPayloadReadSourceFile),
        checker: retainedPayloadProgram.getTypeChecker()
    });
    const [retainedPayloadFact = {}] = [...retainedPayloadFacts.values()];

    assert.equal(retainedPayloadFacts.size, 1);
    assert.equal(retainedPayloadFact.action, 'retain-ordered-nested-tuple-read');
    assert.match(retainedPayloadFact.statementRange, /^\d+:\d+$/);
    assert.equal(retainedPayloadFact.readRanges.length, 2);
    const retainedPayloadAgreements = collectDestructuringAgreements({
        typescript,
        orderedNestedTupleReadContracts: retainedPayloadFacts
    });
    const [retainedPayloadAgreement = {}] = retainedPayloadAgreements.get(retainedPayloadFact.sourceRange) || [];

    assert.equal(getDestructuringAgreement({ entry: retainedPayloadAgreement }).action,
        'retain-ordered-nested-tuple-read');
    const rejectedNestedTupleSources = [
        retainedPayloadReadSource.replace('result.value[0]', 'result.value[0 + 0]'),
        retainedPayloadReadSource.replace('[number, number]', 'ReadonlyArray<number>'),
        retainedPayloadReadSource.replace('result.value[1]', '1'),
        retainedPayloadReadSource.replace('result.value[1]', 'result.other[1]')
            .replace('value: [number, number]', 'value: [number, number]; other: [number, number]'),
        retainedPayloadReadSource.replace('result.value[1]', '...[result.value[1]]'),
        retainedPayloadReadSource.replace('result.value[1]', '(() => result.value[1])()'),
        retainedPayloadReadSource.replace('return operations.combine(result.value[0], result.value[1]);',
            'const alias = result.value; return operations.combine(alias[0], alias[1]);')
    ];

    // eslint-disable-next-line resilient/prefer-prototype-methods -- Sequential fixture creation preserves program setup order.
    for (const [index = 0, rejectedSource = ''] of rejectedNestedTupleSources.entries()) {
        const rejectedFile = path.join(programDirectory, `rejected-ordered-tuple-${index}.ts`);
        await writeFile(rejectedFile, rejectedSource);
        const rejectedProgram = createFixtureProgram([rejectedFile], {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext,
            strict: true
        });

        assert.equal(collectOrderedNestedTupleReadContracts({
            typescript,
            sourceFile: rejectedProgram.getSourceFile(rejectedFile),
            checker: rejectedProgram.getTypeChecker()
        }).size, 0);
    }
    const retainedPayloadRead = createTypeScriptTransformer({
        typescript,
        program: retainedPayloadProgram,
        standard: { object: programObjectStandard }
    }).transform({
        code: retainedPayloadReadSource,
        fileName: retainedPayloadReadSourceFile
    });

    assert.deepEqual(retainedPayloadRead.diagnostics, []);
    assert.match(
        retainedPayloadRead.code,
        new RegExp([
            'eslint-disable resilient/prefer-destructured-member-access',
            '-- separate tuple property Gets retain call argument timing \\*/',
            'return operations\\.combine\\(result\\.value\\[0\\], result\\.value\\[1\\]\\); /\\* eslint-enable resilient/prefer-destructured-member-access'
        ].join('\\s+'))
    );
    const [retainedPayloadReadLint = {}] = await outputEslint.lintText(retainedPayloadRead.code, {
        filePath: 'retained-payload-read-generated.js'
    });

    assert.equal(
        retainedPayloadReadLint.messages.filter(({ ruleId = '' } = {}) => (
            ruleId === 'resilient/prefer-destructured-member-access'
        )).length,
        0,
        JSON.stringify(retainedPayloadReadLint.messages)
    );
    const retainedPayloadReadFile = path.join(programDirectory, 'retained-payload-read.js');
    await writeFile(retainedPayloadReadFile, retainedPayloadRead.code);
    const { href: retainedPayloadReadHref = '' } = pathToFileURL(retainedPayloadReadFile);
    const { read: readRetainedPayload = false } = await import(retainedPayloadReadHref);
    let retainedPayloadEvents = '';
    const retainedPayload = {
        get category() {
            retainedPayloadEvents += 'tag:';

            return 'Available';
        },
        get value() {
            retainedPayloadEvents += 'value:';

            return [2, 3];
        }
    };

    assert.equal(readRetainedPayload(retainedPayload, {
        get combine() {
            retainedPayloadEvents += 'combine:';

            return (inbound, outbound) => inbound + outbound;
        }
    }), 5);
    assert.equal(retainedPayloadEvents, 'tag:combine:value:value:');

    const orderedUpdateSource = [
        'type Selection = { category: "Missing" } | { category: "Available"; value: readonly [number, number] };',
        'type Receiver = { set: (key: number, value: number) => void };',
        'export const update = (selected: Selection, receiver: Receiver, f: (value: number) => number) => {',
        '    if (selected.category === "Available") {',
        '        receiver.set(selected.value[0], f(selected.value[1]));',
        '    }',
        '    return receiver;',
        '};',
        ''
    ].join('\n');
    const orderedUpdateFile = path.join(programDirectory, 'ordered-nested-update.ts');
    await writeFile(orderedUpdateFile, orderedUpdateSource);
    const orderedUpdateProgram = createFixtureProgram([orderedUpdateFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const orderedUpdateResult = createTypeScriptTransformer({
        typescript,
        program: orderedUpdateProgram
    }).transform({ code: orderedUpdateSource, fileName: orderedUpdateFile });

    assert.deepEqual(orderedUpdateResult.diagnostics, []);
    assert.match(orderedUpdateResult.code, /separate tuple property Gets retain call argument timing/);
    assert.match(orderedUpdateResult.code,
        /receiver\.set\(selected\.value\[0\], f\(selected\.value\[1\]\)\)/);
    assert.doesNotMatch(orderedUpdateResult.code, /selectedValue|_resilientIndex_|= \[\]|= \{\}/);
    const [orderedUpdateRawLint = {}] = await outputEslint.lintText(orderedUpdateResult.code, {
        filePath: 'ordered-nested-update-generated.js'
    });
    const [{ output: orderedUpdateFixedCode = orderedUpdateResult.code } = {}]
        = await fixedOptionGuardEslint.lintText(orderedUpdateResult.code, {
            filePath: 'ordered-nested-update-generated.js'
        });
    const [orderedUpdateFixedLint = {}] = await outputEslint.lintText(orderedUpdateFixedCode, {
        filePath: 'ordered-nested-update-fixed.js'
    });

    [orderedUpdateRawLint, orderedUpdateFixedLint].forEach(({ messages = [] } = {}) => {
        assert.equal(messages.filter(({ ruleId = '' } = {}) => {
            return ruleId === 'resilient/prefer-destructured-member-access';
        }).length, 0, JSON.stringify({ messages, code: orderedUpdateResult.code }));
    });
    const { outputText: orderedUpdateReferenceCode = '' } = typescript.transpileModule(orderedUpdateSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const orderedUpdateReferenceFile = path.join(programDirectory, 'ordered-nested-update-reference.js');
    const orderedUpdateGeneratedFile = path.join(programDirectory, 'ordered-nested-update-generated.js');
    await writeFile(orderedUpdateReferenceFile, orderedUpdateReferenceCode);
    await writeFile(orderedUpdateGeneratedFile, orderedUpdateResult.code);
    const { update: sourceOrderedUpdate = false } = await import(pathToFileURL(orderedUpdateReferenceFile).href);
    const { update: generatedOrderedUpdate = false } = await import(pathToFileURL(orderedUpdateGeneratedFile).href);
    const runOrderedUpdate = (update, { failure = '', tupleValues = [2, 3] } = {}) => {
        let events = '';
        let thrown = '';
        const tuple = new Proxy(tupleValues, {
            get(target, property) {
                if (property === Symbol.iterator) throw new Error('tuple iterator acquired');

                if (property === '0' || property === '1') events += property;

                if (property === '1' && failure === 'index') throw new Error('index failure');

                return Reflect.get(target, property);
            }
        });
        const selected = {
            get category() {
                events += 't';

                return 'Available';
            },
            get value() {
                events += 'v';

                return tuple;
            }
        };
        const receiver = {
            get set() {
                events += 'm';

                if (failure === 'method') throw new Error('method failure');

                return () => { events += 's'; };
            }
        };

        try {
            update(selected, receiver, (value) => {
                events += `f:${String(value)}:`;

                return value * 2;
            });
        } catch (error) {
            const { message = '' } = error;

            thrown = message;
        }

        return { events, thrown };
    };

    ['', 'method', 'index'].forEach((failure) => {
        assert.deepEqual(runOrderedUpdate(generatedOrderedUpdate, { failure }),
            runOrderedUpdate(sourceOrderedUpdate, { failure }));
    });
    assert.deepEqual(runOrderedUpdate(generatedOrderedUpdate), { events: 'tmv0v1f:3:s', thrown: '' });
    assert.deepEqual(runOrderedUpdate(generatedOrderedUpdate, { tupleValues: [2] }),
        runOrderedUpdate(sourceOrderedUpdate, { tupleValues: [2] }));

    const restSelectionSource = [
        'export const ordered = (f: (inbound?: number, outbound?: number) => number) => (...args: number[]) => {',
        '    if (args.length > 1) return f(args[1], args[0]);',
        '    return 0;',
        '};',
        'export const deferred = (f: (a: number) => (value?: number) => number) =>',
        '    (...args: number[]) => (a: number) => f(a)(args[0]);',
        ''
    ].join('\n');
    const restSelectionFile = path.join(programDirectory, 'rest-selection.ts');
    await writeFile(restSelectionFile, restSelectionSource);
    const restSelectionProgram = createFixtureProgram([restSelectionFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const restSelectionResult = createTypeScriptTransformer({
        typescript,
        program: restSelectionProgram,
        standard: { object: programObjectStandard }
    }).transform({ code: restSelectionSource, fileName: restSelectionFile });

    assert.deepEqual(restSelectionResult.diagnostics, []);
    assert.doesNotMatch(
        restSelectionResult.code,
        /eslint-disable-next-line [^\n]*resilient\/signature-contract-destructuring -- [^\n]*fresh rest-array numeric reads must not acquire an iterator/
    );
    assert.doesNotMatch(restSelectionResult.code,
        /eslint-disable-next-line [^\n]*resilient\/signature-contract-destructuring -- [^\n]*fresh rest-array numeric reads must not acquire an iterator/);
    assert.doesNotMatch(restSelectionResult.code, /captured rest index follows a call/);
    const [restRawLint = {}] = await outputEslint.lintText(restSelectionResult.code, {
        filePath: 'rest-selection-generated.js'
    });
    const [{ output: restFixedCode = restSelectionResult.code } = {}] = await fixedOptionGuardEslint.lintText(
        restSelectionResult.code,
        { filePath: 'rest-selection-generated.js' }
    );
    const [restFixedLint = {}] = await outputEslint.lintText(restFixedCode, {
        filePath: 'rest-selection-generated.js'
    });

    assert.equal(restRawLint.messages.filter(({ ruleId = '' } = {}) => {
        return ruleId === 'resilient/prefer-destructured-member-access';
    }).length, 0);
    assert.equal(restFixedLint.messages.filter(({ ruleId = '' } = {}) => {
        return ruleId === 'resilient/prefer-destructured-member-access';
    }).length, 0);
    assert.equal(restRawLint.messages.filter(({ ruleId = '' } = {}) => {
        return ruleId === 'resilient/signature-contract-destructuring';
    }).length, 0);
    assert.equal(restFixedLint.messages.filter(({ ruleId = '' } = {}) => {
        return ruleId === 'resilient/signature-contract-destructuring';
    }).length, 0);
    assert.equal(restRawLint.messages.filter(({ fatal = false } = {}) => fatal).length, 0,
        JSON.stringify(restRawLint.messages));
    assert.deepEqual(
        restRawLint.messages.map(({ ruleId = '' } = {}) => ruleId).filter(Boolean),
        []
    );
    assert.deepEqual(
        restFixedLint.messages.map(({ ruleId = '' } = {}) => ruleId).filter(Boolean),
        []
    );
    const restRuntimeFile = path.join(programDirectory, 'rest-selection.js');
    await writeFile(restRuntimeFile, restSelectionResult.code);
    const { href: restRuntimeHref = '' } = pathToFileURL(restRuntimeFile);
    const { ordered: loweredOrdered = false, deferred: loweredDeferred = false } = await import(restRuntimeHref);
    const restSourceRuntimeFile = path.join(programDirectory, 'rest-selection-source.js');
    const { outputText: restSourceRuntimeCode = '' } = typescript.transpileModule(restSelectionSource, {
        compilerOptions: {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext
        }
    });
    await writeFile(restSourceRuntimeFile, restSourceRuntimeCode);
    const { href: restSourceRuntimeHref = '' } = pathToFileURL(restSourceRuntimeFile);
    const { ordered: sourceOrdered = false, deferred: sourceDeferred = false } = await import(restSourceRuntimeHref);
    const capturePair = (inbound, outbound) => [inbound, outbound];

    assert.deepEqual(loweredOrdered(capturePair)(0, 2), sourceOrdered(capturePair)(0, 2));
    assert.deepEqual(loweredOrdered(capturePair)(), sourceOrdered(capturePair)());
    assert.deepEqual(loweredOrdered(capturePair)(0), sourceOrdered(capturePair)(0));
    assert.equal(loweredDeferred(a => value => a + value)(7)(3), 10);
    assert.equal(loweredDeferred(a => value => [a, value])()(3)[1], undefined);
    assert.deepEqual(loweredDeferred(a => value => [a, value])(0)(3), sourceDeferred(a => value => [a, value])(0)(3));
    const restoreArrayPrototype = (key, descriptor) => {
        if (descriptor) {
            Object.defineProperty(Array.prototype, key, descriptor);

            return;
        }

        Reflect.deleteProperty(Array.prototype, key);
    };
    const runCapturedOrder = (deferred) => {
        let events = '';
        let inherited = 5;
        const originalIterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
        const originalIndex = Object.getOwnPropertyDescriptor(Array.prototype, '0');

        Object.defineProperty(Array.prototype, '0', {
            configurable: true,
            get() {
                events += 'index';

                return inherited;
            }
        });

        try {
            const invoke = deferred((a) => {
                events += 'outer';
                inherited = 9;
                Object.defineProperty(Array.prototype, Symbol.iterator, {
                    configurable: true,
                    writable: true,
                    value() {
                        throw new Error('iterator acquired');
                    }
                });

                return (value) => {
                    events += 'inner';

                    return a + value;
                };
            })();
            const result = invoke(3);

            return { result, events };
        } finally {
            restoreArrayPrototype(Symbol.iterator, originalIterator);
            restoreArrayPrototype('0', originalIndex);
        }
    };

    assert.deepEqual(runCapturedOrder(loweredDeferred), runCapturedOrder(sourceDeferred));
    assert.deepEqual(runCapturedOrder(loweredDeferred), { result: 12, events: 'outerindexinner' });
    const runNonCallable = (deferred) => {
        let events = '';
        const original = Object.getOwnPropertyDescriptor(Array.prototype, '0');

        Object.defineProperty(Array.prototype, '0', {
            configurable: true,
            get() {
                events += 'index';

                return 2;
            }
        });

        try {
            const invoke = deferred(() => {
                events += 'outer';

                return 0;
            })();

            assert.throws(() => invoke(3), TypeError);

            return events;
        } finally {
            restoreArrayPrototype('0', original);
        }
    };

    assert.equal(runNonCallable(loweredDeferred), runNonCallable(sourceDeferred));
    assert.equal(runNonCallable(loweredDeferred), 'outerindex');

    const restTimingSource = [
        'let trace = "";',
        'export const readTrace = () => trace;',
        'export const observed = (f: (inbound: number, outbound: number) => number) => (...args: number[]) => {',
        '    if (args.length < 2) return 0;',
        '    Object.defineProperty(args, Symbol.iterator, { value() { throw new Error("iterator acquired"); } });',
        '    Object.defineProperty(args, "1", { get() { trace += "1"; return 7; } });',
        '    Object.defineProperty(args, "0", { get() { trace += "0"; return 4; } });',
        '    return f(args[1], args[0]);',
        '};',
        ''
    ].join('\n');
    const restTimingFile = path.join(programDirectory, 'rest-timing.ts');
    await writeFile(restTimingFile, restTimingSource);
    const restTimingProgram = createFixtureProgram([restTimingFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const restTimingResult = createTypeScriptTransformer({
        typescript,
        program: restTimingProgram,
        standard: { object: programObjectStandard }
    }).transform({ code: restTimingSource, fileName: restTimingFile });
    const { outputText: restTimingReferenceCode = '' } = typescript.transpileModule(restTimingSource, {
        compilerOptions: {
            module: typescript.ModuleKind.ESNext,
            target: typescript.ScriptTarget.ESNext
        }
    });
    const restTimingReferenceFile = path.join(programDirectory, 'rest-timing-reference.js');
    const restTimingGeneratedFile = path.join(programDirectory, 'rest-timing-generated.js');
    await writeFile(restTimingReferenceFile, restTimingReferenceCode);
    await writeFile(restTimingGeneratedFile, restTimingResult.code);
    const { href: timingReferenceHref = '' } = pathToFileURL(restTimingReferenceFile);
    const { href: timingGeneratedHref = '' } = pathToFileURL(restTimingGeneratedFile);
    const timingReference = await import(timingReferenceHref);
    const timingGenerated = await import(timingGeneratedHref);

    assert.deepEqual(restTimingResult.diagnostics, []);
    assert.equal(timingReference.observed((inbound, outbound) => inbound + outbound)(1, 2), 11);
    assert.equal(timingGenerated.observed((inbound, outbound) => inbound + outbound)(1, 2), 11);
    assert.equal(timingReference.readTrace(), '10');
    assert.equal(timingGenerated.readTrace(), '10');

    const rejectedRestSource = [
        'export const alias = (f: any, ...args: number[]) => { const other = args; return f(other[1], other[0]); };',
        'export const dynamic = (f: any, index: number, ...args: number[]) => f(args[index], args[0]);',
        'export const receiver = (service: { call: (a: number, b: number) => number }, ...args: number[]) =>',
        '    service.call(args[1], args[0]);',
        ''
    ].join('\n');
    const rejectedRestFile = path.join(programDirectory, 'rejected-rest.ts');
    await writeFile(rejectedRestFile, rejectedRestSource);
    const rejectedRestProgram = createFixtureProgram([rejectedRestFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const rejectedRestFacts = collectRestArraySelectionContracts({
        typescript,
        sourceFile: rejectedRestProgram.getSourceFile(rejectedRestFile),
        checker: rejectedRestProgram.getTypeChecker()
    });

    assert.equal(rejectedRestFacts.size, 0);
    const rejectedStagedSource = [
        'export const dynamic = (f: (a: number) => (b: number) => number, index: number) =>',
        '    (...args: number[]) => (a: number) => f(a)(args[index]);',
        'export const receiver = (service: { make: (a: number) => (b: number) => number }) =>',
        '    (...args: number[]) => (a: number) => service.make(a)(args[0]);',
        'export const block = (f: (a: number) => (b: number) => number) =>',
        '    (...args: number[]) => (a: number) => { return f(a)(args[0]); };',
        ''
    ].join('\n');
    const rejectedStagedFile = path.join(programDirectory, 'rejected-staged-rest.ts');
    await writeFile(rejectedStagedFile, rejectedStagedSource);
    const rejectedStagedProgram = createFixtureProgram([rejectedStagedFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const rejectedStagedFacts = collectRestArraySelectionContracts({
        typescript,
        sourceFile: rejectedStagedProgram.getSourceFile(rejectedStagedFile),
        checker: rejectedStagedProgram.getTypeChecker()
    });

    assert.ok([...rejectedStagedFacts.values()].every(({ action = '' } = {}) => {
        return action !== 'rest-array-staged-selection';
    }));

    const iteratorPayloadSource = [
        'export const anyMatch = (predicate: (value: number) => boolean) => (source: ReadonlySet<number>) => {',
        '    const values = source.values();',
        '    let entry: IteratorResult<number, undefined>;',
        '    let found = false;',
        '    while (!found && !(entry = values.next()).done) {',
        '        found = predicate(entry.value);',
        '    }',
        '    return found;',
        '};',
        ''
    ].join('\n');
    const iteratorPayloadFile = path.join(programDirectory, 'iterator-payload.ts');
    await writeFile(iteratorPayloadFile, iteratorPayloadSource);
    const iteratorPayloadProgram = createFixtureProgram([iteratorPayloadFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const iteratorPayloadResult = createTypeScriptTransformer({
        typescript,
        program: iteratorPayloadProgram,
        standard: { object: programObjectStandard }
    }).transform({ code: iteratorPayloadSource, fileName: iteratorPayloadFile });

    assert.deepEqual(iteratorPayloadResult.diagnostics, []);
    const [iteratorRawLint = {}] = await outputEslint.lintText(iteratorPayloadResult.code, {
        filePath: 'iterator-payload-generated.js'
    });
    const [{ output: iteratorFixedCode = iteratorPayloadResult.code } = {}] = await fixedOptionGuardEslint.lintText(
        iteratorPayloadResult.code,
        { filePath: 'iterator-payload-generated.js' }
    );
    const [iteratorFixedLint = {}] = await outputEslint.lintText(iteratorFixedCode, {
        filePath: 'iterator-payload-generated.js'
    });

    assert.equal(iteratorRawLint.errorCount, 0, JSON.stringify(iteratorRawLint.messages));
    assert.equal(iteratorFixedLint.errorCount, 0, JSON.stringify(iteratorFixedLint.messages));
    const { outputText: iteratorReferenceCode = '' } = typescript.transpileModule(iteratorPayloadSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const iteratorReferenceFile = path.join(programDirectory, 'iterator-payload-reference.js');
    const iteratorGeneratedFile = path.join(programDirectory, 'iterator-payload-generated.js');
    await writeFile(iteratorReferenceFile, iteratorReferenceCode);
    await writeFile(iteratorGeneratedFile, iteratorPayloadResult.code);
    const { href: iteratorReferenceHref = '' } = pathToFileURL(iteratorReferenceFile);
    const { href: iteratorGeneratedHref = '' } = pathToFileURL(iteratorGeneratedFile);
    const { anyMatch: sourceAvailable = false } = await import(iteratorReferenceHref);
    const { anyMatch: loweredAvailable = false } = await import(iteratorGeneratedHref);
    const runIteratorCase = (consumer) => {
        let events = '';
        let advances = 0;
        const values = [0, 2];
        const source = {
            values() {
                return {
                    next() {
                        const value = values.at(advances);
                        advances += 1;

                        return {
                            get done() {
                                events += 'd';

                                return advances > values.length;
                            },
                            get value() {
                                events += 'v';

                                return value;
                            }
                        };
                    }
                };
            }
        };
        const result = consumer(value => value === 2)(source);

        return { result, events, advances };
    };

    assert.deepEqual(runIteratorCase(loweredAvailable), runIteratorCase(sourceAvailable));
    assert.deepEqual(runIteratorCase(loweredAvailable), { result: true, events: 'dvdv', advances: 2 });

    const rejectedIteratorSource = [
        'export const direct = (f: (value: number) => boolean, source: ReadonlySet<number>) => {',
        '    const values = source.values(); let entry: IteratorResult<number, undefined>;',
        '    while (!(entry = values.next()).done) { const alias = entry; return f(alias.value); }',
        '    return false;',
        '};',
        ''
    ].join('\n');
    const rejectedIteratorFile = path.join(programDirectory, 'rejected-iterator.ts');
    await writeFile(rejectedIteratorFile, rejectedIteratorSource);
    const rejectedIteratorProgram = createFixtureProgram([rejectedIteratorFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const rejectedIteratorFacts = collectLiveIteratorPayloadContracts({
        typescript,
        sourceFile: rejectedIteratorProgram.getSourceFile(rejectedIteratorFile),
        checker: rejectedIteratorProgram.getTypeChecker()
    });

    assert.equal(rejectedIteratorFacts.size, 1);
    assert.equal([...rejectedIteratorFacts.values()][0].action, 'retain-live-iterator-traversal');

    const traversalSource = [
        'export const first = (source: ReadonlyMap<string, number>) => {',
        '    const entries = source.entries();',
        '    let entry: IteratorResult<[string, number], undefined>;',
        '    let found = "";',
        '    while (!(entry = entries.next()).done) {',
        '        const [key, value] = entry.value;',
        '        if (value > 0) { found = key; break; }',
        '    }',
        '    return found;',
        '};',
        ''
    ].join('\n');
    const traversalFile = path.join(programDirectory, 'iterator-traversal.ts');
    await writeFile(traversalFile, traversalSource);
    const traversalProgram = createFixtureProgram([traversalFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const traversalFacts = collectLiveIteratorPayloadContracts({
        typescript,
        sourceFile: traversalProgram.getSourceFile(traversalFile),
        checker: traversalProgram.getTypeChecker()
    });
    const [traversalFact = {}] = [...traversalFacts.values()];
    const [traversalEntry = {}] = collectDestructuringAgreements({
        liveIteratorPayloadContracts: traversalFacts
    }).get(traversalFact.loopRange) || [];

    assert.equal(traversalFacts.size, 1);
    assert.equal(getDestructuringAgreement({ entry: traversalEntry }).action,
        'retain-live-iterator-traversal');
    const traversalResult = createTypeScriptTransformer({
        typescript, program: traversalProgram, standard: { object: programObjectStandard }
    }).transform({ code: traversalSource, fileName: traversalFile });

    assert.deepEqual(traversalResult.diagnostics, []);
    assert.match(traversalResult.code, /eslint-disable-next-line resilient\/prefer-prototype-methods -- Direct next\/done traversal/);
    assert.doesNotMatch(traversalResult.code, /Array\.from\(entries\)|\.reduce\(/);
    const [traversalRaw = {}] = await outputEslint.lintText(traversalResult.code, {
        filePath: 'iterator-traversal-generated.js'
    });
    const [{ output: traversalFixedCode = traversalResult.code } = {}] = await fixedOptionGuardEslint.lintText(
        traversalResult.code, { filePath: 'iterator-traversal-generated.js' }
    );
    const [traversalFixed = {}] = await outputEslint.lintText(traversalFixedCode, {
        filePath: 'iterator-traversal-generated.js'
    });

    assert.equal(traversalRaw.errorCount, 0, JSON.stringify(traversalRaw.messages));
    assert.equal(traversalFixed.errorCount, 0, JSON.stringify(traversalFixed.messages));
    const { outputText: traversalReferenceCode = '' } = typescript.transpileModule(traversalSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const { first: sourceFirst = false } = await import(
        `data:text/javascript,${encodeURIComponent(traversalReferenceCode)}`
    );
    const { first: loweredFirst = false } = await import(
        `data:text/javascript,${encodeURIComponent(traversalResult.code)}`
    );
    const runTraversal = (consumer, values) => {
        let advances = 0;
        const result = consumer({ entries: () => ({ next: () => {
            const done = advances >= values.length;
            const value = values.at(advances);
            advances += 1;

            return done ? { done: true } : { done: false, value };
        } }) });

        return { result, advances };
    };

    assert.deepEqual(runTraversal(loweredFirst, [['zero', 0], ['two', 2], ['three', 3]]),
        runTraversal(sourceFirst, [['zero', 0], ['two', 2], ['three', 3]]));
    assert.deepEqual(runTraversal(loweredFirst, []), runTraversal(sourceFirst, []));
    assert.throws(() => runTraversal(loweredFirst, [null]), TypeError);
    assert.throws(() => runTraversal(sourceFirst, [null]), TypeError);
    const customTraversalSource = [
        'export const custom = (source: { next(): IteratorResult<number, undefined> }) => {',
        '    let entry: IteratorResult<number, undefined>;',
        '    while (!(entry = source.next()).done) { if (entry.value) return true; }',
        '    return false;',
        '};',
        ''
    ].join('\n');
    const customTraversalFile = path.join(programDirectory, 'custom-iterator-traversal.ts');
    await writeFile(customTraversalFile, customTraversalSource);
    const customTraversalProgram = createFixtureProgram([customTraversalFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });

    assert.equal(collectLiveIteratorPayloadContracts({
        typescript,
        sourceFile: customTraversalProgram.getSourceFile(customTraversalFile),
        checker: customTraversalProgram.getTypeChecker()
    }).size, 0);

    const iteratorLocalSource = [
        'export function has<A>(source: ReadonlySet<A>, predicate: (value: A) => boolean): boolean {',
        '    const values = source.values();',
        '    let entry: IteratorResult<A, undefined>;',
        '    while (!(entry = values.next()).done) {',
        '        const v = entry.value;',
        '        if (predicate(v)) return true;',
        '    }',
        '    return false;',
        '}',
        ''
    ].join('\n');
    const iteratorLocalFile = path.join(programDirectory, 'iterator-local.ts');
    await writeFile(iteratorLocalFile, iteratorLocalSource);
    const iteratorLocalProgram = createFixtureProgram([iteratorLocalFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const iteratorLocalResult = createTypeScriptTransformer({
        typescript,
        program: iteratorLocalProgram,
        standard: { object: programObjectStandard }
    }).transform({ code: iteratorLocalSource, fileName: iteratorLocalFile });

    assert.deepEqual(iteratorLocalResult.diagnostics, []);
    const [iteratorLocalRawLint = {}] = await outputEslint.lintText(iteratorLocalResult.code, {
        filePath: 'iterator-local-generated.js'
    });
    const iteratorLocalFixer = new ESLint({
        fix: true,
        overrideConfigFile: true,
        overrideConfig: [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety]
    });
    const [iteratorLocalFixedLint = {}] = await iteratorLocalFixer.lintText(iteratorLocalResult.code, {
        filePath: 'iterator-local-fixed.js'
    });

    assert.equal(iteratorLocalRawLint.errorCount, 0,
        `${JSON.stringify(iteratorLocalRawLint.messages)}\n${iteratorLocalResult.code}`);
    assert.equal(iteratorLocalFixedLint.errorCount, 0,
        `${JSON.stringify(iteratorLocalFixedLint.messages)}\n${iteratorLocalResult.code}`);
    const { outputText: iteratorLocalReferenceCode = '' } = typescript.transpileModule(iteratorLocalSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const iteratorLocalReferenceFile = path.join(programDirectory, 'iterator-local-reference.js');
    const iteratorLocalGeneratedFile = path.join(programDirectory, 'iterator-local-generated.js');
    await writeFile(iteratorLocalReferenceFile, iteratorLocalReferenceCode);
    await writeFile(iteratorLocalGeneratedFile, iteratorLocalResult.code);
    const { has: sourceHas = false } = await import(pathToFileURL(iteratorLocalReferenceFile).href);
    const { has: loweredHas = false } = await import(pathToFileURL(iteratorLocalGeneratedFile).href);
    const runLocalIteratorCase = (has, values) => {
        let events = '';
        let advances = 0;
        const source = {
            values() {
                return {
                    next() {
                        const value = values.at(advances);
                        advances += 1;

                        return {
                            get done() {
                                events += 'd';

                                return advances > values.length;
                            },
                            get value() {
                                events += 'v';

                                return value;
                            }
                        };
                    }
                };
            }
        };
        const result = has(source, (value) => {
            events += 'p';

            return value === 0;
        });

        return { result, events, advances };
    };

    assert.deepEqual(runLocalIteratorCase(loweredHas, [2, 0]), runLocalIteratorCase(sourceHas, [2, 0]));
    assert.deepEqual(runLocalIteratorCase(loweredHas, [2, 0]), {
        result: true, events: 'dvpdvp', advances: 2
    });
    assert.deepEqual(runLocalIteratorCase(loweredHas, []), runLocalIteratorCase(sourceHas, []));
    const aliasedLocalSource = iteratorLocalSource.replace('const v = entry.value;',
        'const alias = entry; const v = alias.value;');
    const aliasedLocalFile = path.join(programDirectory, 'aliased-iterator-local.ts');
    await writeFile(aliasedLocalFile, aliasedLocalSource);
    const aliasedLocalProgram = createFixtureProgram([aliasedLocalFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });

    const aliasedLocalFacts = collectLiveIteratorPayloadContracts({
        typescript,
        sourceFile: aliasedLocalProgram.getSourceFile(aliasedLocalFile),
        checker: aliasedLocalProgram.getTypeChecker()
    });

    assert.equal(aliasedLocalFacts.size, 1);
    assert.equal([...aliasedLocalFacts.values()][0].action, 'retain-live-iterator-traversal');

    const deferredPayloadSource = [
        'type Variant = { category: "Missing" } | { category: "Value"; inbound: number };',
        'function combine(inbound: number, outbound: number) { return inbound + outbound; }',
        'export const selected = (ta: Variant, run: (n: number, f: (n: number) => number) => () => number) => {',
        '    if (ta.category === "Missing") return () => 0;',
        '    return run(4, n => combine(ta.inbound, n));',
        '};',
        ''
    ].join('\n');
    const deferredPayloadFile = path.join(programDirectory, 'deferred-selected-payload.ts');
    await writeFile(deferredPayloadFile, deferredPayloadSource);
    const deferredPayloadProgram = createFixtureProgram([deferredPayloadFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const deferredPayloadFacts = collectDeferredSelectedPayloadContracts({
        typescript,
        sourceFile: deferredPayloadProgram.getSourceFile(deferredPayloadFile),
        checker: deferredPayloadProgram.getTypeChecker()
    });

    assert.ok([...deferredPayloadFacts.values()].some(({ action = '' } = {}) => {
        return action === 'deferred-selected-payload-binding';
    }));
    const deferredPayloadResult = createTypeScriptTransformer({
        typescript,
        program: deferredPayloadProgram,
        standard: { object: programObjectStandard }
    }).transform({ code: deferredPayloadSource, fileName: deferredPayloadFile });

    assert.deepEqual(deferredPayloadResult.diagnostics, []);
    assert.match(deferredPayloadResult.code, /\{ inbound: \w+ = void 0 \} = ta/);
    assert.doesNotMatch(deferredPayloadResult.code, /combine\(ta\.inbound, n\)/);
    const [deferredPayloadLint = {}] = await outputEslint.lintText(deferredPayloadResult.code, {
        filePath: 'deferred-selected-payload-generated.js'
    });

    assert.equal(deferredPayloadLint.errorCount, 0,
        `${JSON.stringify(deferredPayloadLint.messages)}\n${deferredPayloadResult.code}`);
    const deferredFixedEslint = new ESLint({
        fix: true,
        overrideConfigFile: true,
        overrideConfig: [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety]
    });
    const [deferredFixedLint = {}] = await deferredFixedEslint.lintText(deferredPayloadResult.code, {
        filePath: 'deferred-selected-payload-fixed.js'
    });

    assert.equal(deferredFixedLint.errorCount, 0, JSON.stringify(deferredFixedLint.messages));
    const { outputText: deferredReferenceCode = '' } = typescript.transpileModule(deferredPayloadSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const deferredReferenceFile = path.join(programDirectory, 'deferred-selected-reference.js');
    const deferredGeneratedFile = path.join(programDirectory, 'deferred-selected-generated.js');
    await writeFile(deferredReferenceFile, deferredReferenceCode);
    await writeFile(deferredGeneratedFile, deferredPayloadResult.code);
    const { selected: sourceSelected = false } = await import(pathToFileURL(deferredReferenceFile).href);
    const { selected: loweredSelected = false } = await import(pathToFileURL(deferredGeneratedFile).href);
    const runDeferredCase = (selected) => {
        let events = '';
        let current = 1;
        const ta = {
            category: 'Value',
            get inbound() {
                events += 'inbound';

                return current;
            }
        };
        const deferred = selected(ta, (n, callback) => () => callback(n));
        current = 7;

        return { value: deferred(), events };
    };

    assert.deepEqual(runDeferredCase(loweredSelected), runDeferredCase(sourceSelected));
    assert.deepEqual(runDeferredCase(loweredSelected), { value: 11, events: 'inbound' });

    const rejectedDeferredSource = deferredPayloadSource.replace(
        'combine(ta.inbound, n)',
        'combine(n, ta.inbound)'
    );
    const rejectedDeferredFile = path.join(programDirectory, 'rejected-deferred-selected.ts');
    await writeFile(rejectedDeferredFile, rejectedDeferredSource);
    const rejectedDeferredProgram = createFixtureProgram([rejectedDeferredFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const rejectedDeferredFacts = collectDeferredSelectedPayloadContracts({
        typescript,
        sourceFile: rejectedDeferredProgram.getSourceFile(rejectedDeferredFile),
        checker: rejectedDeferredProgram.getTypeChecker()
    });

    assert.equal(rejectedDeferredFacts.size, 0);

    const deferredOpaqueSource = [
        'export function deferred<P>(M: { baseValue: P }, f: (p: P) => P): () => P {',
        '    return () => f(M.baseValue);',
        '}',
        ''
    ].join('\n');
    const deferredOpaqueFile = path.join(programDirectory, 'deferred-opaque-field.ts');
    await writeFile(deferredOpaqueFile, deferredOpaqueSource);
    const deferredOpaqueProgram = createFixtureProgram([deferredOpaqueFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const deferredOpaqueFacts = collectDeferredOpaqueFieldContracts({
        typescript,
        sourceFile: deferredOpaqueProgram.getSourceFile(deferredOpaqueFile),
        checker: deferredOpaqueProgram.getTypeChecker()
    });

    assert.equal(deferredOpaqueFacts.size, 2);
    const opaqueActions = [...deferredOpaqueFacts.values()].map(({ action = '' } = {}) => action);

    assert.deepEqual(opaqueActions, ['deferred-opaque-field-binding', 'deferred-opaque-field-binding']);
    const deferredOpaqueResult = createTypeScriptTransformer({
        typescript,
        program: deferredOpaqueProgram,
        standard: { object: programObjectStandard }
    }).transform({ code: deferredOpaqueSource, fileName: deferredOpaqueFile });

    assert.deepEqual(deferredOpaqueResult.diagnostics, []);
    assert.match(deferredOpaqueResult.code, /\(\) => \{/);
    assert.match(deferredOpaqueResult.code, /\{ baseValue: \w+ = void 0 \} = M/);
    assert.doesNotMatch(deferredOpaqueResult.code, /\(\{ baseValue:/);
    const [deferredOpaqueRawLint = {}] = await outputEslint.lintText(deferredOpaqueResult.code, {
        filePath: 'deferred-opaque-field-generated.js'
    });

    assert.equal(deferredOpaqueRawLint.errorCount, 0,
        `${JSON.stringify(deferredOpaqueRawLint.messages)}\n${deferredOpaqueResult.code}`);
    const [deferredOpaqueFixedLint = {}] = await deferredFixedEslint.lintText(deferredOpaqueResult.code, {
        filePath: 'deferred-opaque-field-fixed.js'
    });

    assert.equal(deferredOpaqueFixedLint.errorCount, 0,
        `${JSON.stringify(deferredOpaqueFixedLint.messages)}\n${deferredOpaqueResult.code}`);
    const { outputText: deferredOpaqueReferenceCode = '' } = typescript.transpileModule(deferredOpaqueSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const deferredOpaqueReferenceFile = path.join(programDirectory, 'deferred-opaque-reference.js');
    const deferredOpaqueGeneratedFile = path.join(programDirectory, 'deferred-opaque-generated.js');
    await writeFile(deferredOpaqueReferenceFile, deferredOpaqueReferenceCode);
    await writeFile(deferredOpaqueGeneratedFile, deferredOpaqueResult.code);
    const { deferred: sourceOpaqueDeferred = false } = await import(pathToFileURL(deferredOpaqueReferenceFile).href);
    const { deferred: loweredOpaqueDeferred = false } = await import(pathToFileURL(deferredOpaqueGeneratedFile).href);
    const runOpaqueCase = (deferred, value) => {
        let events = '';
        const M = {
            get baseValue() {
                events += 'g';

                return value;
            }
        };
        const callback = deferred(M, result => result);
        const before = events;

        return { before, result: Reflect.apply(callback, null, []), events };
    };

    assert.deepEqual(runOpaqueCase(loweredOpaqueDeferred, 0), runOpaqueCase(sourceOpaqueDeferred, 0));
    assert.deepEqual(runOpaqueCase(loweredOpaqueDeferred, 0), { before: '', result: 0, events: 'g' });
    assert.deepEqual(runOpaqueCase(loweredOpaqueDeferred, void 0),
        runOpaqueCase(sourceOpaqueDeferred, void 0));

    const rejectedOpaqueSource = deferredOpaqueSource.replace('M.baseValue', 'M["baseValue"]');
    const rejectedOpaqueFile = path.join(programDirectory, 'rejected-deferred-opaque.ts');
    await writeFile(rejectedOpaqueFile, rejectedOpaqueSource);
    const rejectedOpaqueProgram = createFixtureProgram([rejectedOpaqueFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });

    assert.equal(collectDeferredOpaqueFieldContracts({
        typescript,
        sourceFile: rejectedOpaqueProgram.getSourceFile(rejectedOpaqueFile),
        checker: rejectedOpaqueProgram.getTypeChecker()
    }).size, 0);

    const nestedOpaqueSource = [
        'export function nested<P, A>(M: { baseValue: P }, f: (a: A) => P) {',
        '    return (wa: (p: P) => A) => wa(f(wa(M.baseValue)));',
        '}',
        ''
    ].join('\n');
    const nestedOpaqueFile = path.join(programDirectory, 'nested-deferred-opaque.ts');
    await writeFile(nestedOpaqueFile, nestedOpaqueSource);
    const nestedOpaqueProgram = createFixtureProgram([nestedOpaqueFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const nestedOpaqueFacts = collectDeferredOpaqueFieldContracts({
        typescript,
        sourceFile: nestedOpaqueProgram.getSourceFile(nestedOpaqueFile),
        checker: nestedOpaqueProgram.getTypeChecker()
    });

    assert.equal(nestedOpaqueFacts.size, 2);
    const nestedActions = [...nestedOpaqueFacts.values()].map(({ action = '' } = {}) => action);

    assert.deepEqual(nestedActions,
        ['retain-deferred-opaque-field-read', 'retain-deferred-opaque-field-read']);
    const nestedOpaqueResult = createTypeScriptTransformer({
        typescript,
        program: nestedOpaqueProgram,
        standard: { object: programObjectStandard }
    }).transform({ code: nestedOpaqueSource, fileName: nestedOpaqueFile });

    assert.deepEqual(nestedOpaqueResult.diagnostics, []);
    assert.match(nestedOpaqueResult.code, /wa\(f\(wa\(M\.baseValue\)\)\)/);
    assert.doesNotMatch(nestedOpaqueResult.code, /\{ baseValue: \w+ \} = M/);
    const [nestedOpaqueRawLint = {}] = await outputEslint.lintText(nestedOpaqueResult.code, {
        filePath: 'nested-deferred-opaque-generated.js'
    });
    const [nestedOpaqueFixedLint = {}] = await deferredFixedEslint.lintText(nestedOpaqueResult.code, {
        filePath: 'nested-deferred-opaque-fixed.js'
    });

    assert.equal(nestedOpaqueRawLint.errorCount, 0,
        `${JSON.stringify(nestedOpaqueRawLint.messages)}\n${nestedOpaqueResult.code}`);
    assert.equal(nestedOpaqueFixedLint.errorCount, 0,
        `${JSON.stringify(nestedOpaqueFixedLint.messages)}\n${nestedOpaqueResult.code}`);
    const { outputText: nestedOpaqueReferenceCode = '' } = typescript.transpileModule(nestedOpaqueSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const nestedOpaqueReferenceFile = path.join(programDirectory, 'nested-opaque-reference.js');
    const nestedOpaqueGeneratedFile = path.join(programDirectory, 'nested-opaque-generated.js');
    await writeFile(nestedOpaqueReferenceFile, nestedOpaqueReferenceCode);
    await writeFile(nestedOpaqueGeneratedFile, nestedOpaqueResult.code);
    const { nested: sourceNested = false } = await import(pathToFileURL(nestedOpaqueReferenceFile).href);
    const { nested: loweredNested = false } = await import(pathToFileURL(nestedOpaqueGeneratedFile).href);
    const runNestedCase = (nested) => {
        let events = '';
        let current = 2;
        const M = {
            get baseValue() {
                events += 'g';

                return current;
            }
        };
        const callback = nested(M, (value) => {
            events += 'f';

            return value + 1;
        });
        const before = events;
        current = 4;
        const result = Reflect.apply(callback, null, [(value) => {
            events += 'w';

            return value + 1;
        }]);

        return { before, result, events };
    };

    assert.deepEqual(runNestedCase(loweredNested), runNestedCase(sourceNested));
    assert.deepEqual(runNestedCase(loweredNested), { before: '', result: 7, events: 'gwfw' });
    const runThrowingNested = (nested) => {
        let events = '';
        const M = {
            get baseValue() {
                events += 'g';

                throw new Error('field failure');
            }
        };
        const callback = nested(M, value => value);
        const before = events;
        let failure = '';

        try {
            Reflect.apply(callback, null, [(value) => {
                events += 'w';

                return value;
            }]);
        } catch (error) {
            const { message = '' } = error;

            failure = message;
        }

        return { before, events, failure };
    };

    assert.deepEqual(runThrowingNested(loweredNested), runThrowingNested(sourceNested));
    assert.deepEqual(runThrowingNested(loweredNested), {
        before: '', events: 'g', failure: 'field failure'
    });

    const mutableLoopSource = [
        'type Step = { category: "Inbound"; inbound: number } | { category: "Outbound"; outbound: number };',
        'export const recur = (step: (n: number) => Step, start: number,',
        '    combine: (acc: number, n: number) => number) => {',
        '    let result = step(start);',
        '    let acc = 0;',
        '    let s: Step = result;',
        '    while (s.category === "Inbound") {',
        '        acc = combine(acc, start);',
        '        result = step(s.inbound);',
        '        s = result;',
        '    }',
        '    return [s.outbound, acc];',
        '};',
        ''
    ].join('\n');
    const mutableLoopFile = path.join(programDirectory, 'mutable-selected-loop.ts');
    await writeFile(mutableLoopFile, mutableLoopSource);
    const mutableLoopProgram = createFixtureProgram([mutableLoopFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const mutableLoopResult = createTypeScriptTransformer({
        typescript,
        program: mutableLoopProgram,
        standard: { object: programObjectStandard }
    }).transform({ code: mutableLoopSource, fileName: mutableLoopFile });

    assert.deepEqual(mutableLoopResult.diagnostics, []);
    const [mutableLoopLint = {}] = await outputEslint.lintText(mutableLoopResult.code, {
        filePath: 'mutable-selected-loop-generated.js'
    });
    const mutableMemberErrors = mutableLoopLint.messages.filter(({ ruleId = '' } = {}) => {
        return ruleId === 'resilient/prefer-destructured-member-access';
    });

    assert.equal(mutableMemberErrors.length, 0, JSON.stringify(mutableLoopLint.messages));
    const mutableFixedEslint = new ESLint({
        fix: true,
        overrideConfigFile: true,
        overrideConfig: [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety]
    });
    const [mutableFixedLint = {}] = await mutableFixedEslint.lintText(mutableLoopResult.code, {
        filePath: 'mutable-selected-loop-fixed.js'
    });
    const mutableFixedMemberErrors = mutableFixedLint.messages.filter(({ ruleId = '' } = {}) => {
        return ruleId === 'resilient/prefer-destructured-member-access';
    });

    assert.equal(mutableFixedMemberErrors.length, 0, JSON.stringify(mutableFixedLint.messages));
    const { outputText: mutableReferenceCode = '' } = typescript.transpileModule(mutableLoopSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const mutableReferenceFile = path.join(programDirectory, 'mutable-selected-reference.js');
    const mutableGeneratedFile = path.join(programDirectory, 'mutable-selected-generated.js');
    await writeFile(mutableReferenceFile, mutableReferenceCode);
    await writeFile(mutableGeneratedFile, mutableLoopResult.code);
    const { recur: sourceRecur = false } = await import(pathToFileURL(mutableReferenceFile).href);
    const { recur: loweredRecur = false } = await import(pathToFileURL(mutableGeneratedFile).href);
    const runMutableCase = (recur) => {
        let events = '';
        const step = n => n < 2 ? {
            get category() {
                events += 't';

                return 'Inbound';
            },
            get inbound() {
                events += 'l';

                return n + 1;
            }
        } : {
            get category() {
                events += 't';

                return 'Outbound';
            },
            get outbound() {
                events += 'r';

                return 0;
            }
        };
        const result = recur(step, 0, (acc, n) => {
            events += 'c';

            return acc + n;
        });

        return { result, events };
    };

    assert.deepEqual(runMutableCase(loweredRecur), runMutableCase(sourceRecur));
    assert.deepEqual(runMutableCase(loweredRecur), { result: [0, 0], events: 'tcltcltr' });
    const malformedStep = () => JSON.parse('null');
    const sourceMalformed = () => sourceRecur(malformedStep, 0, (acc, n) => acc + n);
    const loweredMalformed = () => loweredRecur(malformedStep, 0, (acc, n) => acc + n);

    assert.throws(sourceMalformed, TypeError);
    assert.throws(loweredMalformed, TypeError);
    const rejectedMutableSource = mutableLoopSource.replace('s.category === "Inbound"', 's["category"] === "Inbound"');
    const rejectedMutableFile = path.join(programDirectory, 'rejected-mutable-selected.ts');
    await writeFile(rejectedMutableFile, rejectedMutableSource);
    const rejectedMutableProgram = createFixtureProgram([rejectedMutableFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const rejectedMutableFacts = collectMutableSelectedLoopContracts({
        typescript,
        sourceFile: rejectedMutableProgram.getSourceFile(rejectedMutableFile),
        checker: rejectedMutableProgram.getTypeChecker()
    });

    assert.equal(rejectedMutableFacts.size, 0);

    const collectorAdmissionSource = [
        'export function choose(first: number, second?: Function) {',
        '    arguments.length = 2;',
        '    switch (arguments.length) {',
        '        case 2: return typeof second;',
        '        default: return first;',
        '    }',
        '}',
        'export const value = choose(3);',
        ''
    ].join('\n');
    const collectorAdmissionFile = path.join(programDirectory, 'collector-admission.ts');
    await writeFile(collectorAdmissionFile, collectorAdmissionSource);
    const collectorAdmissionProgram = createFixtureProgram([collectorAdmissionFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });

    assert.doesNotThrow(() => collectMutableSelectedLoopContracts({
        typescript,
        sourceFile: collectorAdmissionProgram.getSourceFile(collectorAdmissionFile),
        checker: collectorAdmissionProgram.getTypeChecker()
    }));
    assert.doesNotThrow(() => createTypeScriptTransformer({
        typescript,
        program: collectorAdmissionProgram,
        standard: { object: programObjectStandard }
    }).transform({ code: collectorAdmissionSource, fileName: collectorAdmissionFile }));

    const mutableLoopChecker = mutableLoopProgram.getTypeChecker();
    const missingDeclarationChecker = {
        getSymbolAtLocation(node) {
            const symbol = mutableLoopChecker.getSymbolAtLocation(node);

            return getObject(node).text === 's' ? { ...symbol, valueDeclaration: {} } : symbol;
        },
        getTypeAtLocation() {
            throw new Error('type query requires a real declaration name');
        },
        getPropertyOfType: mutableLoopChecker.getPropertyOfType.bind(mutableLoopChecker)
    };

    const missingDeclarationFacts = collectMutableSelectedLoopContracts({
        typescript,
        sourceFile: mutableLoopProgram.getSourceFile(mutableLoopFile),
        checker: missingDeclarationChecker
    });

    assert.equal(missingDeclarationFacts.size, 0);
    const irrelevantDeclarationChecker = {
        getSymbolAtLocation(node) {
            const symbol = mutableLoopChecker.getSymbolAtLocation(node);

            return getObject(node).text === 's' ? {
                ...symbol,
                valueDeclaration: { kind: typescript.SyntaxKind.Parameter, name: node }
            } : symbol;
        },
        getTypeAtLocation() {
            throw new Error('type query requires a variable declaration name');
        },
        getPropertyOfType: mutableLoopChecker.getPropertyOfType.bind(mutableLoopChecker)
    };
    const irrelevantDeclarationFacts = collectMutableSelectedLoopContracts({
        typescript,
        sourceFile: mutableLoopProgram.getSourceFile(mutableLoopFile),
        checker: irrelevantDeclarationChecker
    });

    assert.equal(irrelevantDeclarationFacts.size, 0);
    const checkerFailure = new Error('intentional checker failure');
    const throwingChecker = {
        getSymbolAtLocation: mutableLoopChecker.getSymbolAtLocation.bind(mutableLoopChecker),
        getTypeAtLocation() {
            throw checkerFailure;
        },
        getPropertyOfType: mutableLoopChecker.getPropertyOfType.bind(mutableLoopChecker)
    };

    assert.throws(() => collectMutableSelectedLoopContracts({
        typescript,
        sourceFile: mutableLoopProgram.getSourceFile(mutableLoopFile),
        checker: throwingChecker
    }), checkerFailure);

    const indexedLocalSource = [
        'type Branch = { value: string; forest: Branch[] };',
        'export const render = (indentation: string, forest: Branch[]): string => {',
        '    let result = "";',
        '    const len = forest.length;',
        '    let item: Branch;',
        '    // eslint-disable-next-line resilient/prefer-prototype-methods -- Recursive formatting depends on source-order prefix updates.',
        '    for (let i = 0; i < len; i++) {',
        '        item = forest[i];',
        '        const last = i === len - 1;',
        '        result += indentation + (last ? "L" : "N") + item.value;',
        '        result += render(indentation + (last ? "" : " "), item.forest);',
        '    }',
        '    return result;',
        '};',
        ''
    ].join('\n');
    const indexedLocalFile = path.join(programDirectory, 'indexed-local-selection.ts');
    await writeFile(indexedLocalFile, indexedLocalSource);
    const indexedLocalProgram = createFixtureProgram([indexedLocalFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const indexedLocalResult = createTypeScriptTransformer({
        typescript,
        program: indexedLocalProgram,
        standard: { object: programObjectStandard }
    }).transform({ code: indexedLocalSource, fileName: indexedLocalFile });

    assert.deepEqual(indexedLocalResult.diagnostics, []);
    const [indexedRawLint = {}] = await outputEslint.lintText(indexedLocalResult.code, {
        filePath: 'indexed-local-generated.js'
    });
    const [{ output: indexedFixedCode = indexedLocalResult.code } = {}] = await fixedOptionGuardEslint.lintText(
        indexedLocalResult.code,
        { filePath: 'indexed-local-generated.js' }
    );
    const [indexedFixedLint = {}] = await outputEslint.lintText(indexedFixedCode, {
        filePath: 'indexed-local-generated.js'
    });

    [indexedRawLint, indexedFixedLint].forEach(({ messages = [] } = {}) => {
        assert.deepEqual(messages.map(({ ruleId = '' } = {}) => ruleId).filter(Boolean), [], indexedLocalResult.code);
    });
    const { outputText: indexedReferenceCode = '' } = typescript.transpileModule(indexedLocalSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const indexedReferenceFile = path.join(programDirectory, 'indexed-reference.js');
    const indexedGeneratedFile = path.join(programDirectory, 'indexed-generated.js');
    await writeFile(indexedReferenceFile, indexedReferenceCode);
    await writeFile(indexedGeneratedFile, indexedLocalResult.code);
    const { render: renderReference = false } = await import(pathToFileURL(indexedReferenceFile).href);
    const { render: renderGenerated = false } = await import(pathToFileURL(indexedGeneratedFile).href);
    const runIndexed = (render) => {
        let events = '';
        const indentation = {
            [Symbol.toPrimitive]() {
                events += 'p';

                return '';
            }
        };
        const item = {
            get value() {
                events += 'v';

                return '';
            },
            get forest() {
                events += 'f';

                return [];
            }
        };
        const result = render(indentation, [item]);

        return { result, events };
    };

    assert.deepEqual(runIndexed(renderGenerated), runIndexed(renderReference));
    assert.deepEqual(runIndexed(renderGenerated), { result: 'L', events: 'pvpf' });
    assert.equal(renderGenerated('', []), renderReference('', []));
    assert.throws(() => renderReference('', [null]), TypeError);
    assert.throws(() => renderGenerated('', [null]), TypeError);
    const rejectedIndexedSource = indexedLocalSource.replace('item.value', 'item["value"]');
    const rejectedIndexedFile = path.join(programDirectory, 'rejected-indexed-local.ts');
    await writeFile(rejectedIndexedFile, rejectedIndexedSource);
    const rejectedIndexedProgram = createFixtureProgram([rejectedIndexedFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const rejectedIndexedFacts = collectIndexedLocalSelectionContracts({
        typescript,
        sourceFile: rejectedIndexedProgram.getSourceFile(rejectedIndexedFile),
        checker: rejectedIndexedProgram.getTypeChecker()
    });

    assert.equal(rejectedIndexedFacts.size, 0);

    const curriedSelectionSource = [
        'type Result = { category: "Inbound"; inbound: number } | { category: "Outbound"; outbound: [number, number] };',
        'export const invoke = (f: (n: number) => (m: number) => number, input: Result) =>',
        '    input.category === "Inbound" ? 0 : f(1)(input.outbound[1]);',
        ''
    ].join('\n');
    const curriedSelectionFile = path.join(programDirectory, 'curried-selected-tuple.ts');
    await writeFile(curriedSelectionFile, curriedSelectionSource);
    const curriedSelectionProgram = createFixtureProgram([curriedSelectionFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const curriedResult = createTypeScriptTransformer({
        typescript,
        program: curriedSelectionProgram,
        standard: { object: programObjectStandard }
    }).transform({ code: curriedSelectionSource, fileName: curriedSelectionFile });

    assert.deepEqual(curriedResult.diagnostics, []);
    const [curriedRawLint = {}] = await outputEslint.lintText(curriedResult.code, {
        filePath: 'curried-selected-generated.js'
    });
    const [{ output: curriedFixedCode = curriedResult.code } = {}] = await fixedOptionGuardEslint.lintText(
        curriedResult.code,
        { filePath: 'curried-selected-generated.js' }
    );
    const [curriedFixedLint = {}] = await outputEslint.lintText(curriedFixedCode, {
        filePath: 'curried-selected-generated.js'
    });

    [curriedRawLint, curriedFixedLint].forEach(({ messages = [] } = {}) => {
        assert.deepEqual(messages.map(({ ruleId = '' } = {}) => ruleId).filter(Boolean), [], JSON.stringify(messages) + curriedResult.code);
    });
    const { outputText: curriedReferenceCode = '' } = typescript.transpileModule(curriedSelectionSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const curriedReferenceFile = path.join(programDirectory, 'curried-reference.js');
    const curriedGeneratedFile = path.join(programDirectory, 'curried-generated.js');
    await writeFile(curriedReferenceFile, curriedReferenceCode);
    await writeFile(curriedGeneratedFile, curriedResult.code);
    const { invoke: invokeReference = false } = await import(pathToFileURL(curriedReferenceFile).href);
    const { invoke: invokeGenerated = false } = await import(pathToFileURL(curriedGeneratedFile).href);
    const runCurried = (invoke) => {
        let events = '';
        const input = {
            category: 'Outbound',
            get outbound() {
                events += 'r';

                return [0, {
                    valueOf() {
                        events += 'i';

                        return 3;
                    }
                }];
            }
        };
        const result = invoke((n) => {
            events += 'f';

            return (m) => {
                events += 'c';

                return n + Number(m);
            };
        }, input);

        return { result, events };
    };

    assert.deepEqual(runCurried(invokeGenerated), runCurried(invokeReference));
    assert.equal(invokeGenerated(() => { throw Error('called'); }, { category: 'Inbound', inbound: 1 }), 0);
    assert.throws(() => invokeReference(() => () => 1, { category: 'Outbound', outbound: undefined }), TypeError);
    assert.throws(() => invokeGenerated(() => () => 1, { category: 'Outbound', outbound: undefined }), TypeError);
    const rejectedCurriedSource = curriedSelectionSource.replace('input.outbound[1]', 'input.outbound[1 + 0]');
    const rejectedCurriedFile = path.join(programDirectory, 'rejected-curried-tuple.ts');
    await writeFile(rejectedCurriedFile, rejectedCurriedSource);
    const rejectedCurriedProgram = createFixtureProgram([rejectedCurriedFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });

    assert.equal(collectCurriedSelectedTupleContracts({
        typescript,
        sourceFile: rejectedCurriedProgram.getSourceFile(rejectedCurriedFile),
        checker: rejectedCurriedProgram.getTypeChecker()
    }).size, 0);

    const orderedProjectionSource = [
        'type Reducer = { concat: (inbound: number, outbound: number) => number };',
        'export const fold = (make: (o: number) => Reducer, option: number) => {',
        '    const S = make(option);',
        '    return (as: number[]) => as.reduce(S.concat);',
        '};',
        ''
    ].join('\n');
    const orderedProjectionFile = path.join(programDirectory, 'ordered-projection.ts');
    await writeFile(orderedProjectionFile, orderedProjectionSource);
    const orderedProjectionProgram = createFixtureProgram([orderedProjectionFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const orderedProjectionResult = createTypeScriptTransformer({
        typescript,
        program: orderedProjectionProgram,
        standard: { object: programObjectStandard }
    }).transform({ code: orderedProjectionSource, fileName: orderedProjectionFile });

    assert.deepEqual(orderedProjectionResult.diagnostics, []);
    assert.match(orderedProjectionResult.code, /eslint-disable resilient\/prefer-destructured-member-access -- projected method getter follows receiver method lookup \*\//);
    assert.match(orderedProjectionResult.code, /return as\.reduce\(S\.concat\); \/\* eslint-enable resilient\/prefer-destructured-member-access/);
    assert.match(orderedProjectionResult.code, /as\.reduce\(S\.concat\)/);
    assert.doesNotMatch(orderedProjectionResult.code, /const \{ concat/);
    const [projectionRawLint = {}] = await outputEslint.lintText(orderedProjectionResult.code, {
        filePath: 'ordered-projection-generated.js'
    });
    const [{ output: projectionFixedCode = orderedProjectionResult.code } = {}] = await fixedOptionGuardEslint.lintText(
        orderedProjectionResult.code,
        { filePath: 'ordered-projection-generated.js' }
    );
    const [projectionFixedLint = {}] = await outputEslint.lintText(projectionFixedCode, {
        filePath: 'ordered-projection-generated.js'
    });

    [projectionRawLint, projectionFixedLint].forEach(({ messages = [] } = {}) => {
        assert.deepEqual(messages.map(({ ruleId = '' } = {}) => ruleId).filter(Boolean), []);
    });
    const { outputText: projectionReferenceCode = '' } = typescript.transpileModule(orderedProjectionSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const projectionReferenceFile = path.join(programDirectory, 'projection-reference.js');
    const projectionGeneratedFile = path.join(programDirectory, 'projection-generated.js');
    await writeFile(projectionReferenceFile, projectionReferenceCode);
    await writeFile(projectionGeneratedFile, orderedProjectionResult.code);
    const { fold: foldReference = false } = await import(pathToFileURL(projectionReferenceFile).href);
    const { fold: foldGenerated = false } = await import(pathToFileURL(projectionGeneratedFile).href);
    const runProjection = (fold) => {
        let events = '';
        const reducer = {
            get concat() {
                events += 'c';

                return (a, b) => a + b;
            }
        };
        const values = new Proxy([1, 2], {
            get(target, key, receiver) {
                if (key === 'reduce') events += 'r';

                return Reflect.get(target, key, receiver);
            }
        });

        return { result: fold(() => reducer, 0)(values), events };
    };

    assert.deepEqual(runProjection(foldGenerated), runProjection(foldReference));
    assert.deepEqual(runProjection(foldGenerated), { result: 3, events: 'rc' });
    const computedProjectionSource = orderedProjectionSource.replace('S.concat', 'S["concat"]');
    const computedProjectionFile = path.join(programDirectory, 'computed-projection.ts');
    await writeFile(computedProjectionFile, computedProjectionSource);
    const computedProjectionProgram = createFixtureProgram([computedProjectionFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });

    assert.equal(collectReceiverOrderedProjectionContracts({
        typescript,
        sourceFile: computedProjectionProgram.getSourceFile(computedProjectionFile),
        checker: computedProjectionProgram.getTypeChecker()
    }).size, 1, 'An exact static computed provider member shares the receiver-first source-order law.');

    const shortCircuitTupleSource = [
        'type Found = { category: "Missing" } | { category: "Available"; value: [string, number] };',
        'type Equal<A> = { equals: (inbound: A, outbound: A) => boolean };',
        'export const same = (SK: Equal<string>, SA: Equal<number>, found: Found, k: string, a: number) => {',
        '    if (found.category === "Missing" || !SK.equals(k, found.value[0]) || !SA.equals(a, found.value[1])) {',
        '        return false;',
        '    }',
        '    return true;',
        '};',
        ''
    ].join('\n');
    const shortCircuitTupleFile = path.join(programDirectory, 'short-circuit-tuple.ts');
    await writeFile(shortCircuitTupleFile, shortCircuitTupleSource);
    const shortCircuitTupleProgram = createFixtureProgram([shortCircuitTupleFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const shortCircuitResult = createTypeScriptTransformer({
        typescript,
        program: shortCircuitTupleProgram,
        standard: { object: programObjectStandard }
    }).transform({ code: shortCircuitTupleSource, fileName: shortCircuitTupleFile });

    assert.deepEqual(shortCircuitResult.diagnostics, []);
    assert.match(shortCircuitResult.code, /eslint-disable resilient\/prefer-destructured-member-access -- short-circuit and receiver method lookup precede this tuple read\s+\*\//);
    assert.match(shortCircuitResult.code, /\/\* eslint-enable resilient\/prefer-destructured-member-access \*\//);
    const [shortCircuitRawLint = {}] = await outputEslint.lintText(shortCircuitResult.code, {
        filePath: 'short-circuit-generated.js'
    });
    const [{ output: shortCircuitFixedCode = shortCircuitResult.code } = {}] = await fixedOptionGuardEslint.lintText(
        shortCircuitResult.code,
        { filePath: 'short-circuit-generated.js' }
    );
    const [shortCircuitFixedLint = {}] = await outputEslint.lintText(shortCircuitFixedCode, {
        filePath: 'short-circuit-generated.js'
    });

    [shortCircuitRawLint, shortCircuitFixedLint].forEach(({ messages = [] } = {}) => {
        assert.deepEqual(messages.map(({ ruleId = '' } = {}) => ruleId).filter(Boolean), []);
    });
    const { outputText: shortCircuitReferenceCode = '' } = typescript.transpileModule(shortCircuitTupleSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const shortCircuitReferenceFile = path.join(programDirectory, 'short-circuit-reference.js');
    const shortCircuitGeneratedFile = path.join(programDirectory, 'short-circuit-generated.js');
    await writeFile(shortCircuitReferenceFile, shortCircuitReferenceCode);
    await writeFile(shortCircuitGeneratedFile, shortCircuitResult.code);
    const { same: sameReference = false } = await import(pathToFileURL(shortCircuitReferenceFile).href);
    const { same: sameGenerated = false } = await import(pathToFileURL(shortCircuitGeneratedFile).href);
    const runShortCircuit = (same, firstMatch = true) => {
        let events = '';
        const found = {
            category: 'Available',
            get value() {
                events += 'v';

                return ['', 0];
            }
        };
        const SK = {
            get equals() {
                events += 'k';

                return function compare(inbound, outbound) {
                    events += 'x';

                    return this === SK && firstMatch && inbound === outbound;
                };
            }
        };
        const SA = {
            get equals() {
                events += 'a';

                return function compare(inbound, outbound) {
                    events += 'y';

                    return this === SA && inbound === outbound;
                };
            }
        };

        return { result: same(SK, SA, found, '', 0), events };
    };

    assert.deepEqual(runShortCircuit(sameGenerated), runShortCircuit(sameReference));
    assert.deepEqual(runShortCircuit(sameGenerated), { result: true, events: 'kvxavy' });
    assert.deepEqual(runShortCircuit(sameGenerated, false), runShortCircuit(sameReference, false));
    assert.deepEqual(runShortCircuit(sameGenerated, false), { result: false, events: 'kvx' });
    assert.equal(sameGenerated({}, {}, { category: 'Missing' }, '', 0), false);
    const badFound = { category: 'Available', value: undefined };

    assert.throws(() => sameReference({ equals: () => true }, {}, badFound, '', 0), TypeError);
    assert.throws(() => sameGenerated({ equals: () => true }, {}, badFound, '', 0), TypeError);
    const rejectedShortCircuitSource = shortCircuitTupleSource
        .replace('found.value[0]', 'found.value[0 + 0]')
        .replace('found.value[1]', 'found.value[1 + 0]');
    const rejectedShortCircuitFile = path.join(programDirectory, 'rejected-short-circuit.ts');
    await writeFile(rejectedShortCircuitFile, rejectedShortCircuitSource);
    const rejectedShortCircuitProgram = createFixtureProgram([rejectedShortCircuitFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });

    assert.equal(collectShortCircuitTupleArgumentContracts({
        typescript,
        sourceFile: rejectedShortCircuitProgram.getSourceFile(rejectedShortCircuitFile),
        checker: rejectedShortCircuitProgram.getTypeChecker()
    }).size, 0);

    const cardinalityFile = path.join(programDirectory, 'array-cardinality.ts');
    const cardinalitySource = [
        'export const arraySize = (items: readonly number[]) => {',
        '    const len = items.length;',
        '    return len;',
        '};',
        'export const tupleSize = (items: readonly [number, string]) => {',
        '    const len = items.length;',
        '    return len;',
        '};',
        ''
    ].join('\n');
    await writeFile(cardinalityFile, cardinalitySource);
    const cardinalityProgram = createFixtureProgram([cardinalityFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const cardinalityResult = createTypeScriptTransformer({
        typescript,
        program: cardinalityProgram
    }).transform({ code: cardinalitySource, fileName: cardinalityFile });

    assert.deepEqual(cardinalityResult.diagnostics, []);
    assert.match(cardinalityResult.code,
        /eslint-disable-next-line prefer-destructuring -- standard array cardinality retains its native length Get/);
    const [cardinalityRawLint = {}] = await outputEslint.lintText(cardinalityResult.code, {
        filePath: 'array-cardinality-generated.js'
    });
    const [{ output: cardinalityFixedCode = cardinalityResult.code } = {}]
        = await fixedOptionGuardEslint.lintText(cardinalityResult.code, {
            filePath: 'array-cardinality-generated.js'
        });
    const [cardinalityFixedLint = {}] = await outputEslint.lintText(cardinalityFixedCode, {
        filePath: 'array-cardinality-fixed.js'
    });

    [cardinalityRawLint, cardinalityFixedLint].forEach(({ messages = [] } = {}) => {
        assert.deepEqual(messages.map(({ ruleId = '' } = {}) => ruleId).filter(Boolean), []);
    });
    const { outputText: cardinalityReferenceCode = '' } = typescript.transpileModule(
        cardinalitySource,
        { compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext } }
    );
    const cardinalityReferenceFile = path.join(programDirectory, 'array-cardinality-reference.js');
    const cardinalityGeneratedFile = path.join(programDirectory, 'array-cardinality-generated.js');
    const cardinalityFixedFile = path.join(programDirectory, 'array-cardinality-fixed.js');
    await writeFile(cardinalityReferenceFile, cardinalityReferenceCode);
    await writeFile(cardinalityGeneratedFile, cardinalityResult.code);
    await writeFile(cardinalityFixedFile, cardinalityFixedCode);
    const cardinalityVersions = await Promise.all([
        cardinalityReferenceFile,
        cardinalityGeneratedFile,
        cardinalityFixedFile
    ].map(file => import(pathToFileURL(file).href)));
    cardinalityVersions.forEach(({ arraySize = false, tupleSize = false } = {}) => {
        let reads = 0;
        const items = new Proxy([1, 2], {
            get(target, property, receiver) {
                if (property === 'length') reads += 1;

                return Reflect.get(target, property, receiver);
            }
        });

        assert.equal(arraySize(items), 2);
        assert.equal(tupleSize(items), 2);
        assert.equal(reads, 2);
        const poison = new Proxy([], {
            get(target, property, receiver) {
                if (property === 'length') throw new Error('length Get');

                return Reflect.get(target, property, receiver);
            }
        });

        assert.throws(() => arraySize(poison), /length Get/);
        assert.throws(() => tupleSize(poison), /length Get/);
    });
    const rejectedCardinalitySource = cardinalitySource.replace('readonly number[]', '{ length: number }');
    const rejectedCardinalityFile = path.join(programDirectory, 'rejected-array-cardinality.ts');
    await writeFile(rejectedCardinalityFile, rejectedCardinalitySource);
    const rejectedCardinalityProgram = createFixtureProgram([rejectedCardinalityFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });

    assert.equal(collectArrayCardinalityContracts({
        typescript,
        sourceFile: rejectedCardinalityProgram.getSourceFile(rejectedCardinalityFile),
        checker: rejectedCardinalityProgram.getTypeChecker()
    }).size, 1);

    const selectedSwitchFile = path.join(programDirectory, 'selected-switch.ts');
    const selectedSwitchSource = [
        'export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;',
        'type Variant<E, A> = { category: "Inbound"; inbound: E } | { category: "Outbound"; outbound: A } | { category: "Combined"; inbound: E; outbound: A };',
        'export const selected = <E, A, B>(onInbound: (n: E) => B, onOutbound: (n: A) => B, onCombined: (a: E, b: A) => B) => (value: Variant<E, A>): B => {',
        '    switch (value.category) {',
        '        case "Inbound": return onInbound(value.inbound);',
        '        case "Outbound": return onOutbound(value.outbound);',
        '        case "Combined": return onCombined(value.inbound, value.outbound);',
        '    }',
        '    throw new Error("invalid tag");',
        '};',
        ''
    ].join('\n');
    await writeFile(selectedSwitchFile, selectedSwitchSource);
    const selectedSwitchProgram = createFixtureProgram([selectedSwitchFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const selectedSwitchFacts = collectSelectedModelContracts({
        typescript,
        sourceFile: selectedSwitchProgram.getSourceFile(selectedSwitchFile),
        checker: selectedSwitchProgram.getTypeChecker()
    });

    assert.equal(selectedSwitchFacts.size, 5);
    assert.ok([...selectedSwitchFacts.values()].every(({ action = '', signatureBoundary = false, key = '' } = {}) => (
        ['selected-model-read', 'retain-source-phase-read'].includes(action) && signatureBoundary && /^\d+:\d+$/.test(key)
    )));
    const selectedSwitchResult = createTypeScriptTransformer({
        typescript,
        program: selectedSwitchProgram
    }).transform({ code: selectedSwitchSource, fileName: selectedSwitchFile });

    assert.deepEqual(selectedSwitchResult.diagnostics, []);
    assert.match(selectedSwitchResult.code,
        new RegExp([
            String.raw`/\* eslint-disable resilient/prefer-destructured-member-access -- selected field Get retains operand, getter and call order at its source phase \*/`,
            String.raw`\s*return onInbound\(value\.inbound\); /\* eslint-enable resilient/prefer-destructured-member-access \*/`
        ].join(''), 'u'));
    const [selectedSwitchRawLint = {}] = await outputEslint.lintText(selectedSwitchResult.code, {
        filePath: 'selected-switch-generated.js'
    });
    const [{ output: selectedSwitchFixedCode = selectedSwitchResult.code } = {}]
        = await fixedOptionGuardEslint.lintText(selectedSwitchResult.code, {
            filePath: 'selected-switch-generated.js'
        });
    const [selectedSwitchFixedLint = {}] = await outputEslint.lintText(selectedSwitchFixedCode, {
        filePath: 'selected-switch-fixed.js'
    });

    [selectedSwitchRawLint, selectedSwitchFixedLint].forEach(({ messages = [] } = {}) => {
        assert.deepEqual(messages.map(({ ruleId = '' } = {}) => ruleId).filter(Boolean), [],
            selectedSwitchResult.code);
    });
    const { outputText: selectedSwitchReferenceCode = '' } = typescript.transpileModule(
        selectedSwitchSource,
        { compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext } }
    );
    const selectedSwitchReferenceFile = path.join(programDirectory, 'selected-switch-reference.js');
    const selectedSwitchGeneratedFile = path.join(programDirectory, 'selected-switch-generated.js');
    const selectedSwitchFixedFile = path.join(programDirectory, 'selected-switch-fixed.js');
    await writeFile(selectedSwitchReferenceFile, selectedSwitchReferenceCode);
    await writeFile(selectedSwitchGeneratedFile, selectedSwitchResult.code);
    await writeFile(selectedSwitchFixedFile, selectedSwitchFixedCode);
    const { selected: selectedReference = false } = await import(pathToFileURL(selectedSwitchReferenceFile).href);
    const { selected: selectedGenerated = false } = await import(pathToFileURL(selectedSwitchGeneratedFile).href);
    const { selected: selectedFixed = false } = await import(pathToFileURL(selectedSwitchFixedFile).href);
    const runSelected = (selected, tag) => {
        let events = '';
        const variant = {
            get category() {
                events += 't';

                return tag;
            },
            get inbound() {
                events += 'l';

                return 0;
            },
            get outbound() {
                events += 'r';

                return 2;
            }
        };
        const result = selected(
            (n) => {
                events += 'L';

                return n;
            },
            (n) => {
                events += 'R';

                return n;
            },
            (a, b) => {
                events += 'B';

                return a + b;
            }
        )(variant);

        return { events, result };
    };

    ['Inbound', 'Outbound', 'Combined'].forEach((tag) => {
        assert.deepEqual(runSelected(selectedGenerated, tag), runSelected(selectedReference, tag));
        assert.deepEqual(runSelected(selectedFixed, tag), runSelected(selectedReference, tag));
    });
    assert.deepEqual(runSelected(selectedGenerated, 'Inbound'), { events: 'tlL', result: 0 });
    assert.deepEqual(runSelected(selectedGenerated, 'Outbound'), { events: 'trR', result: 2 });
    assert.deepEqual(runSelected(selectedGenerated, 'Combined'), { events: 'tlrB', result: 2 });
    const rejectedSwitchSource = selectedSwitchSource.replace('value.inbound);', 'value["inbound"]);');
    const rejectedSwitchFile = path.join(programDirectory, 'rejected-selected-switch.ts');
    await writeFile(rejectedSwitchFile, rejectedSwitchSource);
    const rejectedSwitchProgram = createFixtureProgram([rejectedSwitchFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });

    const computedSwitchContracts = collectSelectedModelContracts({
        typescript,
        sourceFile: rejectedSwitchProgram.getSourceFile(rejectedSwitchFile),
        checker: rejectedSwitchProgram.getTypeChecker()
    });
    assert.equal(computedSwitchContracts.size, 5);
    let computedSwitchRead = {};
    const findComputedSwitchRead = (node) => {
        if (typescript.isElementAccessExpression(node)) computedSwitchRead = node;

        typescript.forEachChild(node, findComputedSwitchRead);
    };
    findComputedSwitchRead(rejectedSwitchProgram.getSourceFile(rejectedSwitchFile));
    const { action: computedAction = '', operationRole: computedRole = '', selection: { fieldAgreement: computedAgreement = '' } = {} }
        = getObject(computedSwitchContracts.get(getConsumerContractKey(computedSwitchRead)));
    assert.equal(computedAction, 'retain-source-phase-read');
    assert.equal(computedRole, 'selected-field-read');
    assert.equal(computedAgreement, 'exact-source-read');
    const receiverSwitchSource = selectedSwitchSource.replace('onInbound(value.inbound)',
        'onInbound.call(null, value.inbound)');
    const receiverSwitchFile = path.join(programDirectory, 'receiver-selected-switch.ts');
    await writeFile(receiverSwitchFile, receiverSwitchSource);
    const receiverSwitchProgram = createFixtureProgram([receiverSwitchFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });

    const receiverSwitchContracts = collectSelectedModelContracts({
        typescript,
        sourceFile: receiverSwitchProgram.getSourceFile(receiverSwitchFile),
        checker: receiverSwitchProgram.getTypeChecker()
    });
    assert.equal(receiverSwitchContracts.size, 6);
    const receiverCallContracts = [...receiverSwitchContracts.values()]
        .filter(({ source: { provider = '', member = '' } = {} } = {}) => provider === 'onInbound' && member === 'call');
    assert.equal(receiverCallContracts.length, 1);
    const [{ action: receiverAction = '', operationRole: receiverRole = '', selection: { state: receiverState = '' } = {} } = {}] = receiverCallContracts;
    assert.equal(receiverAction, 'retain-source-phase-read');
    assert.equal(receiverRole, 'conditional-source-read');
    assert.equal(receiverState, 'unknown');

    const operationalRecordFile = path.join(programDirectory, 'operational-record.ts');
    const operationalRecordSource = [
        'export const rebuild = <A>(entries: ReadonlyArray<readonly [string, A]>): Record<string, A> => {',
        '    const output: Record<string, A> = {};',
        '    for (const entry of entries) {',
        '        output[entry[0]] = entry[1];',
        '    }',
        '    return output;',
        '};',
        ''
    ].join('\n');
    await writeFile(operationalRecordFile, operationalRecordSource);
    const operationalRecordProgram = createFixtureProgram([operationalRecordFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const operationalRecordResult = createTypeScriptTransformer({
        typescript,
        program: operationalRecordProgram
    }).transform({ code: operationalRecordSource, fileName: operationalRecordFile });

    assert.deepEqual(operationalRecordResult.diagnostics, []);
    assert.match(operationalRecordResult.code,
        /resilient\/prefer-safe-transformations -- live setter timing/);
    assert.match(operationalRecordResult.code,
        /resilient\/prefer-destructured-member-access -- key Get order/);
    assert.match(operationalRecordResult.code,
        /eslint-disable-next-line [^\n]*prefer-destructuring -- value Get order/);
    assert.match(operationalRecordResult.code,
        /eslint-disable-next-line resilient\/prefer-safe-transformations, resilient\/prefer-destructured-member-access, prefer-destructuring/);
    const [operationalRecordRawLint = {}] = await outputEslint.lintText(operationalRecordResult.code, {
        filePath: 'operational-record-generated.js'
    });
    const [{ output: operationalRecordFixedCode = operationalRecordResult.code } = {}]
        = await fixedOptionGuardEslint.lintText(operationalRecordResult.code, {
            filePath: 'operational-record-generated.js'
        });
    const [operationalRecordFixedLint = {}] = await outputEslint.lintText(operationalRecordFixedCode, {
        filePath: 'operational-record-fixed.js'
    });

    [operationalRecordRawLint, operationalRecordFixedLint].forEach(({ messages = [] } = {}) => {
        assert.deepEqual(messages.map(({ ruleId = '' } = {}) => ruleId).filter(Boolean), []);
    });
    const { outputText: operationalRecordReferenceCode = '' } = typescript.transpileModule(
        operationalRecordSource,
        { compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext } }
    );
    const operationalRecordReferenceFile = path.join(programDirectory, 'operational-record-reference.js');
    const operationalRecordGeneratedFile = path.join(programDirectory, 'operational-record-generated.js');
    await writeFile(operationalRecordReferenceFile, operationalRecordReferenceCode);
    await writeFile(operationalRecordGeneratedFile, operationalRecordResult.code);
    const { rebuild: rebuildReference = false } = await import(pathToFileURL(operationalRecordReferenceFile).href);
    const { rebuild: rebuildGenerated = false } = await import(pathToFileURL(operationalRecordGeneratedFile).href);
    const sampleEntries = [['same', 0], ['same', false], ['', 'baseValue']];

    assert.deepEqual(rebuildGenerated(sampleEntries), rebuildReference(sampleEntries));
    assert.deepEqual(rebuildGenerated([]), rebuildReference([]));
    assert.deepEqual(rebuildGenerated([[undefined, 'absent']]), rebuildReference([[undefined, 'absent']]));
    const runOperationalRecord = (rebuild) => {
        let events = '';
        const key = {
            [Symbol.toPrimitive]() {
                events += 'c';

                return 'key';
            }
        };
        const entry = new Proxy([key, 9], {
            get(target, property) {
                if (property === '0' || property === '1') events += property;

                return Reflect.get(target, property);
            }
        });
        const output = rebuild([entry]);

        return { events, output };
    };

    assert.deepEqual(runOperationalRecord(rebuildGenerated), runOperationalRecord(rebuildReference));
    assert.deepEqual(runOperationalRecord(rebuildGenerated), { events: '01c', output: { key: 9 } });
    const prototypePayload = { marker: true };
    const sourcePrototype = rebuildReference([['__proto__', prototypePayload]]);
    const generatedPrototype = rebuildGenerated([['__proto__', prototypePayload]]);

    assert.equal(Object.getPrototypeOf(generatedPrototype), Object.getPrototypeOf(sourcePrototype));
    assert.equal(Object.hasOwn(generatedPrototype, '__proto__'), Object.hasOwn(sourcePrototype, '__proto__'));
    const rejectedRecordSource = operationalRecordSource.replace('output[entry[0]] = entry[1];',
        'const alias = output; alias[entry[0]] = entry[1];');
    const rejectedRecordFile = path.join(programDirectory, 'rejected-operational-record.ts');
    await writeFile(rejectedRecordFile, rejectedRecordSource);
    const rejectedRecordProgram = createFixtureProgram([rejectedRecordFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });

    assert.equal(collectOperationalObjectBuilderContracts({
        typescript,
        sourceFile: rejectedRecordProgram.getSourceFile(rejectedRecordFile),
        checker: rejectedRecordProgram.getTypeChecker()
    }).size, 0);
    const computedRecordSource = operationalRecordSource.replace('entry[0]', 'entry[0 + 0]');
    const computedRecordFile = path.join(programDirectory, 'computed-operational-record.ts');
    await writeFile(computedRecordFile, computedRecordSource);
    const computedRecordProgram = createFixtureProgram([computedRecordFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });

    assert.equal(collectOperationalObjectBuilderContracts({
        typescript,
        sourceFile: computedRecordProgram.getSourceFile(computedRecordFile),
        checker: computedRecordProgram.getTypeChecker()
    }).size, 0);

    const orderedMapFile = path.join(programDirectory, 'ordered-map-update.ts');
    const orderedMapSource = [
        'export const update = (source: ReadonlyMap<string, number>, found: { value: readonly [string, number] }, f: (value: number) => number) => {',
        '    const output = new Map(source);',
        '    output.set(found.value[0], f(found.value[1]));',
        '    return output;',
        '};',
        ''
    ].join('\n');
    await writeFile(orderedMapFile, orderedMapSource);
    const orderedMapProgram = createFixtureProgram([orderedMapFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const orderedMapResult = createTypeScriptTransformer({
        typescript,
        program: orderedMapProgram
    }).transform({ code: orderedMapSource, fileName: orderedMapFile });

    assert.deepEqual(orderedMapResult.diagnostics, []);
    assert.match(orderedMapResult.code, /const output = new Map\(source\)/);
    assert.match(orderedMapResult.code, /output\.set\(found\.value\[0\], f\(found\.value\[1\]\)\)/);
    assert.doesNotMatch(orderedMapResult.code, /foundValue|_resilientIndex_|\.\.\.source|output = new Map\(\[/);
    const [orderedMapRawLint = {}] = await outputEslint.lintText(orderedMapResult.code, {
        filePath: 'ordered-map-generated.js'
    });
    const [{ output: orderedMapFixedCode = orderedMapResult.code } = {}]
        = await fixedOptionGuardEslint.lintText(orderedMapResult.code, {
            filePath: 'ordered-map-generated.js'
        });
    const [orderedMapFixedLint = {}] = await outputEslint.lintText(orderedMapFixedCode, {
        filePath: 'ordered-map-fixed.js'
    });

    [orderedMapRawLint, orderedMapFixedLint].forEach(({ messages = [] } = {}) => {
        assert.deepEqual(messages.map(({ ruleId = '' } = {}) => ruleId).filter(Boolean), [],
            `${orderedMapResult.code}\n${JSON.stringify(messages)}`);
    });
    const { outputText: orderedMapReferenceCode = '' } = typescript.transpileModule(orderedMapSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const orderedMapReferenceFile = path.join(programDirectory, 'ordered-map-reference.js');
    const orderedMapGeneratedFile = path.join(programDirectory, 'ordered-map-generated.js');
    await writeFile(orderedMapReferenceFile, orderedMapReferenceCode);
    await writeFile(orderedMapGeneratedFile, orderedMapResult.code);
    const { update: updateMapReference = false } = await import(pathToFileURL(orderedMapReferenceFile).href);
    const { update: updateMapGenerated = false } = await import(pathToFileURL(orderedMapGeneratedFile).href);
    const runOrderedMap = (update) => {
        let events = '';
        const pair = new Proxy(['key', 0], {
            get(target, property) {
                if (property === Symbol.iterator) throw new Error('tuple iterator must not run');

                if (property === '0') events += 'k';

                if (property === '1') events += 'n';

                return Reflect.get(target, property);
            }
        });
        const found = {
            get value() {
                events += 'v';

                return pair;
            }
        };
        const result = update(new Map([['key', -1], ['other', 2]]), found, (value) => {
            events += 'f';

            return value;
        });

        return { events, entries: [...result] };
    };

    assert.deepEqual(runOrderedMap(updateMapGenerated), runOrderedMap(updateMapReference));
    assert.deepEqual(runOrderedMap(updateMapGenerated), {
        events: 'vkvnf', entries: [['key', 0], ['other', 2]]
    });

    const requiredTupleFile = path.join(programDirectory, 'required-tuple.ts');
    const requiredTupleSource = [
        'export const apply = <A, B>(pairs: ReadonlyArray<[(value: A) => B, A]>) => pairs.map(([f, value]) => f(value));',
        'export const read = <A, S>(produce: () => { outbound: [A, S] }) => {',
        '    const [value, state] = produce().outbound;',
        '    return [value, state];',
        '};',
        'export const run = <A, B, W>(produce: () => [[A, (value: A) => B], W]) => {',
        '    const [[value, f], log] = produce();',
        '    return [f(value), log];',
        '};',
        ''
    ].join('\n');
    await writeFile(requiredTupleFile, requiredTupleSource);
    const requiredTupleProgram = createFixtureProgram([requiredTupleFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const requiredTupleResult = createTypeScriptTransformer({
        typescript,
        program: requiredTupleProgram
    }).transform({ code: requiredTupleSource, fileName: requiredTupleFile });

    assert.deepEqual(requiredTupleResult.diagnostics, []);
    const [requiredTupleRawLint = {}] = await outputEslint.lintText(requiredTupleResult.code, {
        filePath: 'required-tuple-generated.js'
    });
    const [{ output: requiredTupleFixedCode = requiredTupleResult.code } = {}]
        = await fixedOptionGuardEslint.lintText(requiredTupleResult.code, {
            filePath: 'required-tuple-generated.js'
        });
    const [requiredTupleFixedLint = {}] = await outputEslint.lintText(requiredTupleFixedCode, {
        filePath: 'required-tuple-fixed.js'
    });

    [requiredTupleRawLint, requiredTupleFixedLint].forEach(({ messages = [] } = {}) => {
        assert.deepEqual(messages.map(({ ruleId = '' } = {}) => ruleId).filter(Boolean), [],
            `${requiredTupleResult.code}\n${JSON.stringify(messages)}`);
    });
    const { outputText: requiredTupleReferenceCode = '' } = typescript.transpileModule(requiredTupleSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const requiredTupleReferenceFile = path.join(programDirectory, 'required-tuple-reference.js');
    const requiredTupleGeneratedFile = path.join(programDirectory, 'required-tuple-generated.js');
    await writeFile(requiredTupleReferenceFile, requiredTupleReferenceCode);
    await writeFile(requiredTupleGeneratedFile, requiredTupleResult.code);
    const referenceTuple = await import(pathToFileURL(requiredTupleReferenceFile).href);
    const generatedTuple = await import(pathToFileURL(requiredTupleGeneratedFile).href);
    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Native container failure precedes the required-export callable guard; defaults alter its error context.
    const runRequiredTuple = ({ apply: applyTuple, read: readTuple, run: runTuple }) => {
        if (typeof applyTuple !== 'function' || typeof readTuple !== 'function' ||
            typeof runTuple !== 'function') throw new TypeError('required tuple fixture export missing');

        let calls = 0;
        let gets = 0;
        const apply = Reflect.apply(applyTuple, undefined, [[[value => String(value)]]]);
        const read = Reflect.apply(readTuple, undefined, [() => {
            calls += 1;

            return {
                get outbound() {
                    gets += 1;

                    return [false];
                }
            };
        }]);
        const run = Reflect.apply(runTuple, undefined, [() => {
            calls += 1;

            return [[0, value => value]];
        }]);
        let malformed = '';

        try {
            Reflect.apply(applyTuple, undefined, [[[undefined, 1]]]);
        } catch ({ name = '' }) {
            malformed = name;
        }

        return { apply, read, run, calls, gets, malformed };
    };

    assert.deepEqual(runRequiredTuple(generatedTuple), runRequiredTuple(referenceTuple));
    assert.deepEqual(runRequiredTuple(generatedTuple), {
        apply: ['undefined'], read: [false, undefined], run: [0, undefined],
        calls: 2, gets: 1, malformed: 'TypeError'
    });
    const callbackOwnedFile = path.join(programDirectory, 'callback-owned.ts');
    const callbackOwnedSource = [
        'type ArrayFold = { reduce: (values: number[], seed: number[], step: (acc: number[], value: number) => number[]) => number[] };',
        'type MapFold = { reduce: (values: number[], seed: Map<number, number>, step: (acc: Map<number, number>, value: number) => Map<number, number>) => Map<number, number> };',
        'export const intoArray = (F: ArrayFold, values: number[]) => F.reduce(values, [], (acc, value) => {',
        '    acc.push(value);',
        '    return acc;',
        '});',
        'export const intoMap = (F: MapFold, values: number[]) => F.reduce(values, new Map(), (acc, value) => {',
        '    const payload = { value: [value, value] };',
        '    if (value >= 0) acc.set(payload.value[0] % 2, payload.value[1]);',
        '    return acc;',
        '});',
        ''
    ].join('\n');
    await writeFile(callbackOwnedFile, callbackOwnedSource);
    const callbackOwnedProgram = createFixtureProgram([callbackOwnedFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const callbackOwnedResult = createTypeScriptTransformer({
        typescript,
        program: callbackOwnedProgram
    }).transform({ code: callbackOwnedSource, fileName: callbackOwnedFile });

    assert.deepEqual(callbackOwnedResult.diagnostics, []);
    assert.equal((callbackOwnedResult.code.match(/Provider can observe accumulator identity across callback calls\./g) || []).length, 2);
    const [callbackOwnedRawLint = {}] = await outputEslint.lintText(callbackOwnedResult.code, {
        filePath: 'callback-owned-generated.js'
    });
    const [{ output: callbackOwnedFixedCode = callbackOwnedResult.code } = {}]
        = await fixedOptionGuardEslint.lintText(callbackOwnedResult.code, {
            filePath: 'callback-owned-generated.js'
        });
    const [callbackOwnedFixedLint = {}] = await outputEslint.lintText(callbackOwnedFixedCode, {
        filePath: 'callback-owned-fixed.js'
    });

    [callbackOwnedRawLint, callbackOwnedFixedLint].forEach(({ messages = [] } = {}) => {
        assert.deepEqual(messages.map(({ ruleId = '' } = {}) => ruleId).filter(Boolean), [],
            `${callbackOwnedResult.code}\n${JSON.stringify(messages)}`);
    });
    const { outputText: callbackOwnedReferenceCode = '' } = typescript.transpileModule(callbackOwnedSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const callbackOwnedReferenceFile = path.join(programDirectory, 'callback-owned-reference.js');
    const callbackOwnedGeneratedFile = path.join(programDirectory, 'callback-owned-generated.js');
    await writeFile(callbackOwnedReferenceFile, callbackOwnedReferenceCode);
    await writeFile(callbackOwnedGeneratedFile, callbackOwnedResult.code);
    const referenceOwned = await import(pathToFileURL(callbackOwnedReferenceFile).href);
    const generatedOwned = await import(pathToFileURL(callbackOwnedGeneratedFile).href);
    const observeProvider = ({ intoArray = false, intoMap = false } = {}) => {
        if (typeof intoArray !== 'function' || typeof intoMap !== 'function') {
            throw new TypeError('callback-owned fixture export missing');
        }

        let trace = [];
        const makeProvider = () => ({
            reduce(values, seed, step) {
                const first = seed;
                let current = seed;

                // eslint-disable-next-line resilient/prefer-prototype-methods -- The test provider must expose accumulator identity after each sequential callback.
                for (const value of values) {
                    current = Reflect.apply(step, undefined, [current, value]);
                    trace = [...trace, current === first];
                }

                return { same: current === first, entries: [...current] };
            }
        });
        const array = intoArray(makeProvider(), [0, 2]);
        const map = intoMap(makeProvider(), [0, 2, -1]);

        return { array, map, trace };
    };

    assert.deepEqual(observeProvider(generatedOwned), observeProvider(referenceOwned));
    assert.deepEqual(observeProvider(generatedOwned), {
        array: { same: true, entries: [0, 2] },
        map: { same: true, entries: [[0, 2]] },
        trace: [true, true, true, true, true]
    });
    const rejectedProviderFile = path.join(programDirectory, 'callback-owned-rejected.ts');
    const rejectedProviderSource = [
        'type Fold = { reduce: (values: number[], seed: number[], step: (acc: number[], value: number) => number[]) => number[] };',
        'export const native = (values: number[]) => values.reduce((acc: number[], value) => { acc.push(value); return acc; }, []);',
        'export const alias = (F: Fold, values: number[]) => F.reduce(values, [], (acc, value) => { const other = acc; other.push(value); return acc; });',
        "export const computed = (F: Fold, values: number[]) => F.reduce(values, [], (acc, value) => { acc['push'](value); return acc; });",
        'export const passed = (F: Fold, values: number[], seed: number[]) => F.reduce(values, seed, (acc, value) => { acc.push(value); return acc; });',
        'export const captured = (F: Fold, values: number[]) => F.reduce(values, [], (acc, value) => { const get = () => acc; get().push(value); return acc; });',
        ''
    ].join('\n');
    await writeFile(rejectedProviderFile, rejectedProviderSource);
    const rejectedProviderProgram = createFixtureProgram([rejectedProviderFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const rejectedProviderFacts = collectCollectionDecisions({
        typescript,
        sourceFile: rejectedProviderProgram.getSourceFile(rejectedProviderFile),
        checker: rejectedProviderProgram.getTypeChecker()
    });

    assert.equal([...new Set(rejectedProviderFacts.values())].filter(({
        collection: { callbackOwned = false } = {}
    } = {}) => callbackOwned).length, 0);
    const callbackParameterFile = path.join(programDirectory, 'callback-parameter-owned.ts');
    const callbackParameterSource = [
        'interface Dense<A> extends Array<A> { 0: A }',
        'type MapProvider = { map: (maps: Map<string, number>[], callback: (map: Map<string, number>) => (value: number) => Map<string, number>) => Array<(value: number) => Map<string, number>> };',
        'export const promiseOwned = (previous: Promise<number[]>) => previous.then(values => {',
        '    values.push(0);',
        '    return values;',
        '});',
        'export const mapOwned = (F: MapProvider, maps: Map<string, number>[]) => F.map(maps, map => value => map.set("k", value));',
        'export const aliasOwned = (previous: Promise<{ values: number[] }>) => previous.then(box => {',
        '    const chosen = box.values;',
        '    chosen.push(0);',
        '    return box;',
        '});',
        'export const inheritedOwned = (previous: Promise<Dense<number>>) => previous.then(values => Promise.resolve(2).then(value => {',
        '    values.push(value);',
        '    return values;',
        '}));',
        'export const indexedOwned = (previous: Promise<{ pair: [Dense<number>, number] }>) => previous.then(box => Promise.resolve(3).then(value => {',
        '    box.pair[0].push(value);',
        '    return box;',
        '}));',
        ''
    ].join('\n');
    await writeFile(callbackParameterFile, callbackParameterSource);
    const callbackParameterProgram = createFixtureProgram([callbackParameterFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const callbackParameterResult = createTypeScriptTransformer({
        typescript,
        program: callbackParameterProgram
    }).transform({ code: callbackParameterSource, fileName: callbackParameterFile });

    assert.deepEqual(callbackParameterResult.diagnostics, []);
    const [callbackParameterRawLint = {}] = await outputEslint.lintText(callbackParameterResult.code, {
        filePath: 'callback-parameter-generated.js'
    });
    const [{ output: callbackParameterFixedCode = callbackParameterResult.code } = {}]
        = await fixedOptionGuardEslint.lintText(callbackParameterResult.code, {
            filePath: 'callback-parameter-generated.js'
        });
    const [callbackParameterFixedLint = {}] = await outputEslint.lintText(callbackParameterFixedCode, {
        filePath: 'callback-parameter-fixed.js'
    });

    [callbackParameterRawLint, callbackParameterFixedLint].forEach(({ messages = [] } = {}) => {
        assert.deepEqual(messages.filter(({ severity = 0 } = {}) => severity === 2)
            .map(({ ruleId = '' } = {}) => ruleId).filter(Boolean), [],
        `${callbackParameterResult.code}\n${JSON.stringify(messages)}`);
    });
    const { outputText: callbackParameterReferenceCode = '' } = typescript.transpileModule(callbackParameterSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const callbackParameterReferenceFile = path.join(programDirectory, 'callback-parameter-reference.js');
    const callbackParameterGeneratedFile = path.join(programDirectory, 'callback-parameter-generated.js');
    await writeFile(callbackParameterReferenceFile, callbackParameterReferenceCode);
    await writeFile(callbackParameterGeneratedFile, callbackParameterResult.code);
    const referenceCallbackParameter = await import(pathToFileURL(callbackParameterReferenceFile).href);
    const generatedCallbackParameter = await import(pathToFileURL(callbackParameterGeneratedFile).href);
    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- These fixture exports are required; a fallback would hide a missing generated export.
    const observeCallbackParameter = async ({ promiseOwned, mapOwned, aliasOwned, inheritedOwned, indexedOwned }) => {
        const array = [1];
        const previous = Promise.resolve(array);
        const next = await Reflect.apply(promiseOwned, undefined, [previous]);
        const map = new Map([['k', 0]]);
        const functions = Reflect.apply(mapOwned, undefined, [{ map: (maps, callback) => maps.map(callback) }, [map]]);
        const [apply = false] = functions;
        const first = Reflect.apply(apply, undefined, [1]);
        const second = Reflect.apply(apply, undefined, [2]);
        const boxValues = [1];
        let gets = 0;
        const box = {
            get values() {
                gets += 1;

                return boxValues;
            }
        };
        const alias = await Reflect.apply(aliasOwned, undefined, [Promise.resolve(box)]);
        const inheritedValues = [1];
        const inherited = await Reflect.apply(inheritedOwned, undefined, [Promise.resolve(inheritedValues)]);
        const indexedValues = [1];
        const indexedBox = { pair: [indexedValues, 0] };
        const indexed = await Reflect.apply(indexedOwned, undefined, [Promise.resolve(indexedBox)]);
        let missing = '';

        try {
            await Reflect.apply(aliasOwned, undefined, [Promise.resolve({})]);
        } catch ({ name = '' }) {
            missing = name;
        }

        return {
            promiseSame: next === array, array: [...array],
            mapSame: first === map && second === map, map: [...map],
            aliasSame: alias === box, aliasValues: [...boxValues], gets, missing,
            inheritedSame: inherited === inheritedValues, inheritedValues: [...inheritedValues],
            indexedSame: indexed === indexedBox, indexedValues: [...indexedValues]
        };
    };

    assert.deepEqual(await observeCallbackParameter(generatedCallbackParameter),
        await observeCallbackParameter(referenceCallbackParameter));
    assert.deepEqual(await observeCallbackParameter(generatedCallbackParameter), {
        promiseSame: true, array: [1, 0], mapSame: true, map: [['k', 2]],
        aliasSame: true, aliasValues: [1, 0], gets: 1, missing: 'TypeError',
        inheritedSame: true, inheritedValues: [1, 2], indexedSame: true, indexedValues: [1, 3]
    });
    const callbackParameterRejectedFile = path.join(programDirectory, 'callback-parameter-rejected.ts');
    const callbackParameterRejectedSource = [
        'export const local = (previous: Promise<number>) => previous.then(value => {',
        '    const output: number[] = [];',
        '    output.push(value);',
        '    return output;',
        '});',
        "export const computed = (previous: Promise<number[]>) => previous.then(values => { values['push'](0); return values; });",
        'export const custom = (previous: Promise<{ push: (value: number) => void }>) => previous.then(value => { value.push(0); return value; });',
        'interface Dense<A> extends Array<A> { 0: A }',
        'export const computedIndex = (previous: Promise<{ pair: Dense<number>[] }>, index: number) => previous.then(box => { box.pair[index].push(0); return box; });',
        ''
    ].join('\n');
    await writeFile(callbackParameterRejectedFile, callbackParameterRejectedSource);
    const callbackParameterRejectedProgram = createFixtureProgram([callbackParameterRejectedFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const callbackParameterRejectedFacts = collectCollectionDecisions({
        typescript,
        sourceFile: callbackParameterRejectedProgram.getSourceFile(callbackParameterRejectedFile),
        checker: callbackParameterRejectedProgram.getTypeChecker()
    });

    assert.equal([...new Set(callbackParameterRejectedFacts.values())].filter(({
        collection: { callbackParameterOwned = false } = {}
    } = {}) => callbackParameterOwned).length, 0);
    const consoleEffectFile = path.join(programDirectory, 'console-effects.ts');
    const consoleEffectSource = [
        'export const logEffect = (value: number) => () => console.log(value);',
        'export const warnEffect = (value: number) => () => console.warn(value);',
        'export const errorEffect = (value: number) => () => console.error(value);',
        'export const infoEffect = (value: number) => () => console.info(value);',
        'export const guardedEffect = (value: number, enabled: boolean) => () => {',
        '    if (enabled) return console.warn(value);',
        '    return value;',
        '};',
        ''
    ].join('\n');
    await writeFile(consoleEffectFile, consoleEffectSource);
    const consoleEffectProgram = createFixtureProgram([consoleEffectFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const consoleEffectResult = createTypeScriptTransformer({
        typescript,
        program: consoleEffectProgram
    }).transform({ code: consoleEffectSource, fileName: consoleEffectFile });

    assert.deepEqual(consoleEffectResult.diagnostics, []);
    assert.equal((consoleEffectResult.code.match(/eslint-disable-next-line no-console/g) || []).length, 5);
    const consoleLintConfig = [resilient.configs.recommended, resilient.configs.contracts,
        resilient.configs.safety, { languageOptions: { globals: { console: 'readonly' } } }];
    const consoleOutputEslint = new ESLint({ overrideConfigFile: true, overrideConfig: consoleLintConfig });
    const consoleFixedEslint = new ESLint({
        fix: true,
        overrideConfigFile: true,
        overrideConfig: consoleLintConfig
    });
    const [consoleEffectRawLint = {}] = await consoleOutputEslint.lintText(consoleEffectResult.code, {
        filePath: 'console-effects-generated.js'
    });
    const [{ output: consoleEffectFixedCode = consoleEffectResult.code } = {}]
        = await consoleFixedEslint.lintText(consoleEffectResult.code, {
            filePath: 'console-effects-generated.js'
        });
    const [consoleEffectFixedLint = {}] = await consoleOutputEslint.lintText(consoleEffectFixedCode, {
        filePath: 'console-effects-fixed.js'
    });

    [consoleEffectRawLint, consoleEffectFixedLint].forEach(({ messages = [] } = {}) => {
        assert.deepEqual(messages.filter(({ severity = 0 } = {}) => severity === 2)
            .map(({ ruleId = '' } = {}) => ruleId).filter(Boolean), [],
        `${consoleEffectResult.code}\n${JSON.stringify(messages)}`);
    });
    const { outputText: consoleReferenceCode = '' } = typescript.transpileModule(consoleEffectSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const consoleReferenceFile = path.join(programDirectory, 'console-effects-reference.js');
    const consoleGeneratedFile = path.join(programDirectory, 'console-effects-generated.js');
    await writeFile(consoleReferenceFile, consoleReferenceCode);
    await writeFile(consoleGeneratedFile, consoleEffectResult.code);
    const referenceConsole = await import(pathToFileURL(consoleReferenceFile).href);
    const generatedConsole = await import(pathToFileURL(consoleGeneratedFile).href);
    const observeConsole = (module = {}) => {
        let trace = [];
        const fakeConsole = Object.fromEntries(['log', 'warn', 'error', 'info'].map((name, index) => [
            name,
            function record(value) {
                trace = [...trace, [name, this === fakeConsole, value]];

                return index;
            }
        ]));
        const originalConsoleDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'console');
        const callConsoleEffect = (name = '', args = []) => Reflect.apply(
            Reflect.apply(Reflect.get(module, name), undefined, args), undefined, []
        );

        Object.defineProperty(globalThis, 'console', { configurable: true, value: fakeConsole });

        try {
            return {
                results: [callConsoleEffect('logEffect', [0]), callConsoleEffect('warnEffect', [1]),
                    callConsoleEffect('errorEffect', [2]), callConsoleEffect('infoEffect', [3]),
                    callConsoleEffect('guardedEffect', [4, true]), callConsoleEffect('guardedEffect', [5, false])],
                trace
            };
        } finally {
            Object.defineProperty(globalThis, 'console', originalConsoleDescriptor);
        }
    };

    assert.deepEqual(observeConsole(generatedConsole), observeConsole(referenceConsole));
    assert.deepEqual(observeConsole(generatedConsole), {
        results: [0, 1, 2, 3, 1, 5],
        trace: [['log', true, 0], ['warn', true, 1], ['error', true, 2],
            ['info', true, 3], ['warn', true, 4]]
    });
    const rejectedConsoleFile = path.join(programDirectory, 'console-effects-rejected.ts');
    const rejectedConsoleSource = [
        'export const shadowed = (console: { log: (value: number) => number }, value: number) => console.log(value);',
        "export const computed = (value: number) => console['log'](value);",
        ''
    ].join('\n');
    await writeFile(rejectedConsoleFile, rejectedConsoleSource);
    const rejectedConsoleProgram = createFixtureProgram([rejectedConsoleFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });

    assert.equal(collectConsoleEffectContracts({
        typescript,
        sourceFile: rejectedConsoleProgram.getSourceFile(rejectedConsoleFile),
        checker: rejectedConsoleProgram.getTypeChecker()
    }).size, 0);
} finally {
    await rm(programDirectory, { recursive: true, force: true });
}
