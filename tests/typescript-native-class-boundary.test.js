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
    collectNativeClassBoundaryContracts
} from '../transforms/typescript/understand/type-evidence.js';

const directory = await mkdtemp(path.join(tmpdir(), 'resilient-native-class-'));
const fileName = path.join(directory, 'cell.ts');
const source = [
    'export class Cell {',
    '    private value: number;',
    '    constructor(value: number) {',
    '        // eslint-disable-next-line resilient/prefer-safe-transformations -- The instance owns its class state.',
    '        this.value = value;',
    '        // eslint-disable-next-line resilient/prefer-safe-transformations -- Bound method identity is part of the instance protocol.',
    '        this.read = this.read.bind(this);',
    '    }',
    '    read(): number { return this.value; }',
    '    write(value: number): void {',
    '        // eslint-disable-next-line resilient/prefer-safe-transformations -- The instance owns its class state.',
    '        this.value = value;',
    '    }',
    '}',
    'export const create = (value: number) => new Cell(value);',
    ''
].join('\n');

try {
    await writeFile(fileName, source);
    const program = typescript.createProgram([fileName], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
    });
    const contracts = collectNativeClassBoundaryContracts({
        typescript, sourceFile: program.getSourceFile(fileName), checker: program.getTypeChecker()
    });
    const [fact = {}] = [...contracts.values()];

    assert.equal(contracts.size, 1);
    assert.equal(fact.operationRole, 'class-protocol');
    assert.equal(fact.boundMethods.length, 1);
    assert.match(fact.constructionRange, /^\d+:\d+$/);
    const [entry = {}] = collectDestructuringAgreements({
        nativeClassBoundaryContracts: contracts
    }).get(fact.sourceRange) || [];

    assert.equal(getDestructuringAgreement({ entry }).action, 'retain-native-class-boundary');

    const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
        code: source, fileName
    });

    assert.deepEqual(diagnostics, []);
    assert.match(code, /export class Cell/);
    assert.match(code, /no-restricted-syntax -- Native new, prototype, and bound-method identity/);
    assert.match(code, /this\.read = this\.read\.bind\(this\)/);
    assert.doesNotMatch(code, /Object\.create|\.prototype\s*=/);

    const eslintConfig = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
    const [raw = {}] = await new ESLint({ overrideConfigFile: true,
        overrideConfig: eslintConfig }).lintText(code, { filePath: 'cell-generated.js' });
    const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
        overrideConfig: eslintConfig }).lintText(code, { filePath: 'cell-generated.js' });

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
        const Cell = Reflect.get(module, 'Cell');
        const create = Reflect.get(module, 'create');
        const instance = Reflect.apply(create, null, [3]);
        const read = Reflect.get(instance, 'read');
        const write = Reflect.get(instance, 'write');
        const prototypeRead = Reflect.get(Reflect.get(Cell, 'prototype'), 'read');
        const before = Reflect.apply(read, null, []);

        Reflect.apply(write, instance, [8]);
        let callableWithoutNew = true;

        try {
            Reflect.apply(Cell, null, [0]);
        } catch (error) {
            callableWithoutNew = !(error instanceof TypeError);
        }

        return {
            before,
            after: Reflect.apply(read, null, []),
            instance: instance instanceof Cell,
            ownBoundMethod: Object.hasOwn(instance, 'read'),
            prototypeMethod: prototypeRead !== read,
            constructor: Reflect.get(instance, 'constructor') === Cell,
            callableWithoutNew
        };
    };

    assert.deepEqual(observe(generatedModule), observe(sourceModule));

    const importFile = path.join(directory, 'with-import.ts');
    const supportFile = path.join(directory, 'marker.ts');
    const importSource = `import { marker } from './marker';\n${source}\nexport const seen = marker;`;

    await writeFile(supportFile, 'export const marker = 1;');
    await writeFile(importFile, importSource);
    const importProgram = typescript.createProgram([importFile, supportFile], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
    });
    const { code: importedCode = '' } = createTypeScriptTransformer({
        typescript, program: importProgram
    }).transform({ code: importSource, fileName: importFile });

    assert.match(importedCode, /no-restricted-syntax -- Native new, prototype, and bound-method identity/);

    const rejectedFile = path.join(directory, 'simple.ts');
    const rejectedSource = 'export class Simple { constructor(readonly value: number) {} }';

    await writeFile(rejectedFile, rejectedSource);
    const rejectedProgram = typescript.createProgram([rejectedFile], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext
    });

    assert.equal(collectNativeClassBoundaryContracts({
        typescript, sourceFile: rejectedProgram.getSourceFile(rejectedFile),
        checker: rejectedProgram.getTypeChecker()
    }).size, 0);
} finally {
    await rm(directory, { recursive: true, force: true });
}
