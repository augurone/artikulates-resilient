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
    collectObservableSetUnionContracts
} from '../transforms/typescript/understand/type-evidence.js';

const directory = await mkdtemp(path.join(tmpdir(), 'resilient-observable-set-union-'));
const fileName = path.join(directory, 'union.ts');
const source = [
    'export const union = (left: ReadonlySet<number>, right: ReadonlySet<number>,',
    '    member: (value: number, result: Set<number>) => boolean) => {',
    '    const result = new Set(left);',
    '    right.forEach(value => {',
    '        if (!member(value, result)) result.add(value);',
    '    });',
    '    return result;',
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
    const contracts = collectObservableSetUnionContracts({
        typescript, sourceFile: program.getSourceFile(fileName), checker: program.getTypeChecker()
    });
    const [fact = {}] = [...contracts.values()];

    assert.equal(contracts.size, 1);
    assert.equal(fact.operationRole, 'observable-set-union');
    assert.match(fact.copyRange, /^\d+:\d+$/);
    assert.match(fact.membershipRange, /^\d+:\d+$/);
    const [entry = {}] = collectDestructuringAgreements({
        collectionReconstructionContracts: contracts
    }).get(fact.sourceRange) || [];

    assert.equal(getDestructuringAgreement({ entry }).action, 'operational-collection-builder');

    const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
        code: source, fileName
    });

    assert.deepEqual(diagnostics, []);
    assert.match(code, /new Set\(left\)/);
    assert.match(code, /right\.forEach/);
    assert.match(code, /member\(value, result\)/);
    assert.match(code, /result\.add\(value\)/);
    assert.doesNotMatch(code, /\n\s*result\s*=|Array\.from\(right\)|\.\.\.right/);

    const eslintConfig = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
    const [raw = {}] = await new ESLint({ overrideConfigFile: true,
        overrideConfig: eslintConfig }).lintText(code, { filePath: 'union-generated.js' });
    const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
        overrideConfig: eslintConfig }).lintText(code, { filePath: 'union-generated.js' });

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
    const observe = (module) => {
        let events = [];
        let observed = true;
        let firstWorking = false;
        const left = new Set([0, 1]);
        const right = new Set([0, 2]);

        Object.defineProperty(left, Symbol.iterator, {
            value() {
                events = [...events, 'copy-iterator'];

                return Set.prototype.values.call(this);
            }
        });
        Object.defineProperty(right, 'forEach', {
            value(callback, thisArg) {
                events = [...events, 'forEach'];

                return Set.prototype.forEach.call(this, (value, key, receiver) => {
                    callback.call(thisArg, value, key, receiver);

                    // eslint-disable-next-line resilient/prefer-safe-transformations -- The native Set proof appends during live visitation on its own receiver.
                    if (value === 0 && !this.has(3)) this.add(3);
                });
            }
        });
        const result = module.union(left, right, (value, working) => {
            firstWorking = firstWorking || working;
            observed = observed && working instanceof Set && working === firstWorking;
            events = [...events, ['member', value, [...working]]];

            return working.has(value);
        });

        return { values: [...result], events, observed };
    };

    assert.deepEqual(observe(generatedModule), observe(sourceModule));

    const malformed = new Set();

    Object.defineProperty(malformed, Symbol.iterator, {
        value() {
            throw new Error('copy failed');
        }
    });
    const attempt = module => module.union(malformed, new Set([1]), () => false);

    assert.throws(() => attempt(sourceModule), /copy failed/);
    assert.throws(() => attempt(generatedModule), /copy failed/);

    const rejectedFile = path.join(directory, 'rejected.ts');
    const rejectedSource = [
        'export const aliased = (left: Set<number>, right: Set<number>) => {',
        '    const result = new Set(left);',
        '    const alias = result;',
        '    right.forEach(value => { if (!alias.has(value)) result.add(value); });',
        '    return result;',
        '};',
        ''
    ].join('\n');

    await writeFile(rejectedFile, rejectedSource);
    const rejectedProgram = typescript.createProgram([rejectedFile], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext
    });

    assert.equal(collectObservableSetUnionContracts({
        typescript, sourceFile: rejectedProgram.getSourceFile(rejectedFile),
        checker: rejectedProgram.getTypeChecker()
    }).size, 0);
} finally {
    await rm(directory, { recursive: true, force: true });
}
