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
    collectLiveOwnKeyEnumerationContracts
} from '../transforms/typescript/understand/type-evidence.js';

const directory = await mkdtemp(path.join(tmpdir(), 'resilient-own-key-'));
const fileName = path.join(directory, 'own-key.ts');
const source = [
    'export const copyOwn = (source: Record<string, number>) => {',
    '    const output: Record<string, number> = {};',
    '    for (const key in source) {',
    '        if (Object.prototype.hasOwnProperty.call(source, key)) {',
    '            output[key] = source[key];',
    '        }',
    '    }',
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
    const contracts = collectLiveOwnKeyEnumerationContracts({
        typescript, sourceFile: program.getSourceFile(fileName), checker: program.getTypeChecker()
    });
    const [fact = {}] = [...contracts.values()];

    assert.equal(contracts.size, 1);
    assert.equal(fact.operationRole, 'live-own-key-enumeration');
    assert.match(fact.guardRange, /^\d+:\d+$/);
    const [entry = {}] = collectDestructuringAgreements({
        liveOwnKeyEnumerationContracts: contracts
    }).get(fact.sourceRange) || [];

    assert.equal(getDestructuringAgreement({ entry }).action, 'retain-live-own-key-enumeration');

    const rejectedSource = 'export const keys = (value: any) => { for (const key in value) { void key; } };';
    const rejectedFile = path.join(directory, 'rejected.ts');

    await writeFile(rejectedFile, rejectedSource);
    const rejectedProgram = typescript.createProgram([rejectedFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });

    assert.equal(collectLiveOwnKeyEnumerationContracts({
        typescript,
        sourceFile: rejectedProgram.getSourceFile(rejectedFile),
        checker: rejectedProgram.getTypeChecker()
    }).size, 0);

    const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
        code: source, fileName
    });

    assert.deepEqual(diagnostics, []);
    assert.match(code, /for \(const key in source\)/);
    assert.match(code, /eslint-disable-next-line resilient\/prefer-prototype-methods -- Live own-key enumeration/);
    assert.equal((code.match(/eslint-disable-next-line resilient\/prefer-prototype-methods/g) || []).length, 1);
    assert.doesNotMatch(code, /Source loop has unproven callback safety or sequential effects/);
    assert.doesNotMatch(code, /Object\.keys\(source\)|Object\.entries\(source\)/);

    const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
    const options = { overrideConfigFile: true, overrideConfig: config };
    const [raw = {}] = await new ESLint(options).lintText(code, { filePath: 'own-key-generated.js' });
    const [fixed = {}] = await new ESLint({ ...options, fix: true }).lintText(code, {
        filePath: 'own-key-generated.js'
    });

    assert.equal(raw.errorCount, 0, JSON.stringify({ messages: raw.messages, code }));
    assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));

    const { outputText: sourceJavaScript = '' } = typescript.transpileModule(source, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const load = async text => import(`data:text/javascript,${encodeURIComponent(text)}`);
    const baseline = await load(sourceJavaScript);
    const lowered = await load(code);
    const observe = (module) => {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- This proof builds an object with inherited data and own keys on the same identity.
        const input = Object.assign(Object.create({ inherited: 9 }), { a: 0, b: 2 });
        const result = module.copyOwn(input);

        return { entries: Object.entries(result), inherited: Object.hasOwn(result, 'inherited') };
    };

    assert.deepEqual(observe(lowered), observe(baseline));

    const inheritedSource = [
        'export const firstKey = (source: Record<string, number>) => {',
        '    for (const key in source) { return key; }',
        '    return "";',
        '};',
        ''
    ].join('\n');
    const inheritedFile = path.join(directory, 'inherited.ts');
    await writeFile(inheritedFile, inheritedSource);
    const inheritedProgram = typescript.createProgram([inheritedFile], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const inheritedFacts = collectLiveOwnKeyEnumerationContracts({
        typescript,
        sourceFile: inheritedProgram.getSourceFile(inheritedFile),
        checker: inheritedProgram.getTypeChecker()
    });
    const [inheritedFact = {}] = [...inheritedFacts.values()];
    const [inheritedEntry = {}] = collectDestructuringAgreements({
        liveOwnKeyEnumerationContracts: inheritedFacts
    }).get(inheritedFact.sourceRange) || [];

    assert.equal(inheritedFacts.size, 1);
    assert.equal(getDestructuringAgreement({ entry: inheritedEntry }).action,
        'retain-live-object-enumeration');
    const inheritedResult = createTypeScriptTransformer({
        typescript, program: inheritedProgram
    }).transform({ code: inheritedSource, fileName: inheritedFile });

    assert.deepEqual(inheritedResult.diagnostics, []);
    assert.match(inheritedResult.code, /eslint-disable-next-line resilient\/prefer-prototype-methods -- Native for-in/);
    const [inheritedRaw = {}] = await new ESLint(options).lintText(inheritedResult.code, {
        filePath: 'inherited-generated.js'
    });
    const [inheritedFixed = {}] = await new ESLint({ ...options, fix: true }).lintText(
        inheritedResult.code, { filePath: 'inherited-generated.js' }
    );

    assert.equal(inheritedRaw.errorCount, 0, JSON.stringify(inheritedRaw.messages));
    assert.equal(inheritedFixed.errorCount, 0, JSON.stringify(inheritedFixed.messages));
    const { outputText: inheritedReference = '' } = typescript.transpileModule(inheritedSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const inheritedInput = Object.create({ inherited: 9 });

    assert.equal((await load(inheritedResult.code)).firstKey(inheritedInput),
        (await load(inheritedReference)).firstKey(inheritedInput));

    const genericSource = [
        'export const ownKeys = <A>(source: A) => {',
        '    for (const key in source) {',
        '        if (Object.prototype.hasOwnProperty.call(source, key)) return key;',
        '    }',
        '    return "";',
        '};',
        ''
    ].join('\n');
    const genericFile = path.join(directory, 'generic.ts');

    await writeFile(genericFile, genericSource);
    const genericProgram = typescript.createProgram([genericFile], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
    });
    const genericFacts = collectLiveOwnKeyEnumerationContracts({
        typescript,
        sourceFile: genericProgram.getSourceFile(genericFile),
        checker: genericProgram.getTypeChecker()
    });
    const [genericFact = {}] = [...genericFacts.values()];

    assert.equal(genericFacts.size, 1);
    assert.match(genericFact.evidence[0], /Generic for-in/);
    const genericResult = createTypeScriptTransformer({ typescript, program: genericProgram }).transform({
        code: genericSource, fileName: genericFile
    });

    assert.deepEqual(genericResult.diagnostics, []);
    assert.match(genericResult.code, /eslint-disable-next-line resilient\/prefer-prototype-methods --/);
    const [genericRaw = {}] = await new ESLint(options).lintText(genericResult.code, {
        filePath: 'generic-own-keys.js'
    });
    const [genericFixed = {}] = await new ESLint({ ...options, fix: true }).lintText(
        genericResult.code, { filePath: 'generic-own-keys.js' }
    );

    assert.equal(genericRaw.errorCount, 0, JSON.stringify(genericRaw.messages));
    assert.equal(genericFixed.errorCount, 0, JSON.stringify(genericFixed.messages));
    const { outputText: genericReference = '' } = typescript.transpileModule(genericSource, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    // eslint-disable-next-line resilient/prefer-safe-transformations -- This proof builds an object with inherited data and own keys on the same identity.
    const ownInput = Object.assign(Object.create({ inherited: 1 }), { first: 0, second: false });

    assert.deepEqual((await load(genericResult.code)).ownKeys(ownInput),
        (await load(genericReference)).ownKeys(ownInput));
} finally {
    await rm(directory, { recursive: true, force: true });
}
