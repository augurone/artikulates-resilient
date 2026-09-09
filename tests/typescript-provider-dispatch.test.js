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
    collectCallableProviderDispatchContracts
} from '../transforms/typescript/understand/type-evidence.js';

const directory = await mkdtemp(path.join(tmpdir(), 'resilient-provider-dispatch-'));
const sourceFileName = path.join(directory, 'provider.ts');
const source = [
    'type Provider = { add: (left: number, right: number) => number };',
    'export const apply = (provider: Provider, left: number, right: number) =>',
    '    [left].map(value => provider.add(value, right))[0];',
    'export const guarded = (provider: Provider, enabled: boolean) =>',
    '    enabled ? provider.add(1, 2) : 0;',
    'export const project = (provider: Provider) => ({ next: provider.add(1, 2) });',
    ''
].join('\n');

try {
    await writeFile(sourceFileName, source);
    const program = typescript.createProgram([sourceFileName], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const sourceFile = program.getSourceFile(sourceFileName);
    const contracts = collectCallableProviderDispatchContracts({
        typescript, sourceFile, checker: program.getTypeChecker()
    });
    const [fact = {}] = [...contracts.values()];

    assert.equal(contracts.size, 3);
    assert.equal(fact.operationRole, 'provider-dispatch');
    assert.equal(fact.receiverKind, 'typed-callable-field');
    assert.equal(fact.member, 'add');
    assert.match(fact.sourceRange, /^\d+:\d+$/);
    const nativeFileName = path.join(directory, 'native.ts');

    await writeFile(nativeFileName, 'export const native = (values: number[]) => values.reverse();\n');
    const nativeProgram = typescript.createProgram([nativeFileName], {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });

    assert.equal(collectCallableProviderDispatchContracts({
        typescript,
        sourceFile: nativeProgram.getSourceFile(nativeFileName),
        checker: nativeProgram.getTypeChecker()
    }).size, 0);
    const moduleFileName = path.join(directory, 'operations.ts');
    const namespaceFileName = path.join(directory, 'namespace.ts');

    await writeFile(moduleFileName, 'export const reverse = (value: number) => -value;\n');
    await writeFile(namespaceFileName, [
        "import * as operations from './operations.js';",
        'export const run = (value: number) => operations.reverse(value);',
        ''
    ].join('\n'));
    const namespaceProgram = typescript.createProgram([namespaceFileName, moduleFileName], {
        module: typescript.ModuleKind.NodeNext,
        moduleResolution: typescript.ModuleResolutionKind.NodeNext,
        target: typescript.ScriptTarget.ESNext,
        strict: true
    });
    const namespaceContracts = collectCallableProviderDispatchContracts({
        typescript,
        sourceFile: namespaceProgram.getSourceFile(namespaceFileName),
        checker: namespaceProgram.getTypeChecker()
    });
    const [namespaceFact = {}] = [...namespaceContracts.values()];

    assert.equal(namespaceContracts.size, 1);
    assert.equal(namespaceFact.receiverKind, 'module-namespace');
    const [entry = {}] = collectDestructuringAgreements({
        callableProviderDispatchContracts: contracts
    }).get(fact.sourceRange) || [];

    assert.equal(getDestructuringAgreement({ entry }).action, 'retain-provider-dispatch');

    const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
        code: source, fileName: sourceFileName
    });

    assert.deepEqual(diagnostics, []);
    assert.match(code, /provider\.add\(value, right\)/);
    assert.match(code, /eslint-disable-next-line resilient\/prefer-safe-transformations/);
    assert.doesNotMatch(code, /provider\s*=|Array\.from\(/);

    const eslint = new ESLint({
        overrideConfigFile: true,
        overrideConfig: [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety]
    });
    const [raw = {}] = await eslint.lintText(code, { filePath: 'provider-generated.js' });

    assert.equal(raw.errorCount, 0, JSON.stringify(raw.messages));

    const fixedEslint = new ESLint({
        fix: true,
        overrideConfigFile: true,
        overrideConfig: [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety]
    });
    const [fixed = {}] = await fixedEslint.lintText(code, { filePath: 'provider-generated.js' });

    assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));

    const { outputText: sourceJavaScript = '' } = typescript.transpileModule(source, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const importCode = async text => import(`data:text/javascript,${encodeURIComponent(text)}`);
    const sourceModule = await importCode(sourceJavaScript);
    const generatedModule = await importCode(code);
    const observe = (module) => {
        let events = [];
        const provider = {
            get add() {
                events = [...events, 'get'];

                return function add(left, right) {
                    events = [...events, ['call', this === provider, left, right]];

                    return left + right;
                };
            }
        };

        return {
            value: module.apply(provider, 2, 3),
            skipped: module.guarded(provider, false),
            selected: module.guarded(provider, true),
            projected: module.project(provider).next,
            events
        };
    };

    assert.deepEqual(observe(generatedModule), observe(sourceModule));
} finally {
    await rm(directory, { recursive: true, force: true });
}
