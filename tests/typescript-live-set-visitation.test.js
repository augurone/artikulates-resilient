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
    collectLiveSetVisitationContracts
} from '../transforms/typescript/understand/type-evidence.js';

const directory = await mkdtemp(path.join(tmpdir(), 'resilient-live-set-visitation-'));
const fileName = path.join(directory, 'visitation.ts');
const source = [
    'export const values = (set: ReadonlySet<number>, compare: (a: number, b: number) => number) => {',
    '    const output: number[] = [];',
    '    set.forEach(value => output.push(value));',
    '    return output.sort(compare);',
    '};',
    'export const positive = (set: Set<number>, compare: (a: number, b: number) => number) => {',
    '    const output: number[] = [];',
    '    set.forEach(value => { if (value > 0) output.push(value); });',
    '    return output.sort(compare);',
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
    const contracts = collectLiveSetVisitationContracts({
        typescript, sourceFile: program.getSourceFile(fileName), checker: program.getTypeChecker()
    });
    const [fact = {}] = [...contracts.values()].filter(({ operationRole = '' } = {}) => (
        operationRole === 'set-visitation'
    ));

    assert.equal(contracts.size, 4);
    assert.equal(fact.operationRole, 'set-visitation');
    assert.match(fact.visitRange, /^\d+:\d+$/);
    assert.match(fact.returnRange, /^\d+:\d+$/);
    assert.equal([...contracts.values()].filter(({ operationRole = '' } = {}) => (
        operationRole === 'set-visitation-sort'
    )).length, 2);
    const [entry = {}] = collectDestructuringAgreements({
        collectionReconstructionContracts: contracts
    }).get(fact.sourceRange) || [];

    assert.equal(getDestructuringAgreement({ entry }).action, 'operational-collection-builder');

    const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
        code: source, fileName
    });

    assert.deepEqual(diagnostics, []);
    assert.match(code, /set\.forEach/);
    assert.match(code, /output\.push\(value\)/);
    assert.match(code, /output\.sort\(compare\)/);
    assert.doesNotMatch(code, /Array\.from\(set\)|\.\.\.set|set\.values\(/);

    const eslintConfig = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
    const [raw = {}] = await new ESLint({ overrideConfigFile: true,
        overrideConfig: eslintConfig }).lintText(code, { filePath: 'visitation-generated.js' });
    const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
        overrideConfig: eslintConfig }).lintText(code, { filePath: 'visitation-generated.js' });

    assert.equal(raw.messages.filter(({ ruleId = '' } = {}) => (
        ruleId !== 'padding-line-between-statements'
    )).length, 0, JSON.stringify(raw.messages));
    assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));

    const { outputText: sourceJavaScript = '' } = typescript.transpileModule(source, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const importCode = async text => import(`data:text/javascript,${encodeURIComponent(text)}`);
    const sourceModule = await importCode(sourceJavaScript);
    const generatedModule = await importCode(code);
    const observe = (module, method = 'values') => {
        let events = [];
        const set = new Set();

        Object.defineProperties(set, {
            forEach: {
                value(callback, thisArg) {
                    events = [...events, 'forEach'];

                    return Set.prototype.forEach.call(this, (value, key, receiver) => {
                        callback.call(thisArg, value, key, receiver);

                        // eslint-disable-next-line resilient/prefer-safe-transformations -- The native Set proof appends during live visitation on its own receiver.
                        if (value === 1 && !this.has(3)) this.add(3);
                    });
                }
            },
            [Symbol.iterator]: {
                value() {
                    throw new Error('iterator must not be acquired');
                }
            }
        });

        Set.prototype.add.call(set, 1);
        Set.prototype.add.call(set, 0);
        const result = module[method](set, (left, right) => {
            events = [...events, ['compare', left, right]];

            return left - right;
        });

        return { result, events };
    };

    assert.deepEqual(observe(generatedModule), observe(sourceModule));
    assert.deepEqual(observe(generatedModule, 'positive'), observe(sourceModule, 'positive'));

    const customFile = path.join(directory, 'custom.ts');
    const customSource = [
        'type Custom = { forEach: (f: (n: number) => void) => void };',
        'export const values = (set: Custom) => {',
        '    const output: number[] = [];',
        '    set.forEach(value => output.push(value));',
        '    return output.sort((a, b) => a - b);',
        '};',
        ''
    ].join('\n');

    await writeFile(customFile, customSource);
    const customProgram = typescript.createProgram([customFile], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext
    });

    assert.equal(collectLiveSetVisitationContracts({
        typescript, sourceFile: customProgram.getSourceFile(customFile),
        checker: customProgram.getTypeChecker()
    }).size, 0);
} finally {
    await rm(directory, { recursive: true, force: true });
}
