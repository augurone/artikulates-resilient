import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptEmitTransformer, createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { auditSource } from '../scripts/audit-eslint-exceptions.js';
import { annotateFinalExceptions } from '../transforms/typescript/grammar/final.js';
import { formatResilientOutput } from '../transforms/typescript/grammar/resolvers.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { getRuntimeBindingIdentities } from '../transforms/typescript/policy/dependencies.js';
import {
    annotateCyclicRuntimeBindingReferences, annotateRetainedStaticMemberAccess,
    annotateRetainedDynamicMemberAccess, groupNextLineExceptions
} from '../transforms/typescript/policy/exceptions.js';
import { compilePlacementDecisions } from '../transforms/typescript/policy/placement.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import { collectPlacementEvidence } from '../transforms/typescript/understand/placement-evidence.js';
import {
    collectCallableOperationContracts, collectRequiredTupleBindingContracts, collectIndexedOperationContracts,
    collectRuntimeBindingReferenceFacts, getConsumerContractKey
} from '../transforms/typescript/understand/type-evidence.js';

const directory = await mkdtemp(path.join(tmpdir(), 'resilient-directive-ownership-'));
const examples = {
    completedLoopScope: [
        'export const group = (f: (value: number) => string) => (values: number[]) => {',
        'const out: Record<string, number[]> = {}; for (const value of values) { const key = f(value);',
        'if (Object.prototype.hasOwnProperty.call(out, key)) { out[key].push(value); } else { out[key] = [value]; }',
        '} return out; };'
    ].join('\n'),
    unscopedUpdate: 'export const update = (values: number[], index: number) => { values[index] = 2; return values; };',
    nativeCycle: [
        'export function first(n: number): number { return n ? second(n - 1) : 0; }',
        'export function second(n: number): number { return n ? first(n - 1) : 0; }'
    ].join('\n'),
    provider: 'export const read = (value: number) => value;',
    imported: "import * as provider from './provider.js'; export const before = (value: number) => later(value); export const later = provider.read;",
    scoped: 'export const select = (left: number[], right: number[]) => Math.min(left.length, right.length);',
    retained: 'export const before = (value: number) => later(value); export const later = (value: number) => value;',
    shadowed: "import { read as later } from './provider.js'; export const value = later(1); export function read() { return later(2); function later(value: number) { return value; } }",
    optional: 'export const optional = (values: { value: number }[] | null, index: number) => values?.[index].value;',
    nestedKey: 'export const nestedKey = (values: number[], keys: number[], index: number) => values[keys[index]];',
    afterthought: 'export const afterthought = (values: number[], index: number) => { let ready = true; for (; ready; values[index]++) { ready = false; } return values; };',
    sequenceAfterthought: ['export const sequenceAfterthought = (values: number[], index: number, effect: () => void) => { let ready = true; ',
        'for (; ready; (values[index]++, effect())) { ready = false; } return values; };'].join(''),
    parenthesizedNeighbor: 'const outside: number[] = [1]; export function parenthesizedNeighbor(i: number, neighbor: { fixed: number }) { const x = (outside[i]), y = neighbor.fixed; return x + y; }',
    updates: 'export const increment = (values: number[], index: number) => values[index]++; export const remove = (values: number[], index: number) => delete values[index];',
    reducer: 'export const reducer = (values: number[][], index: number) => values.reduce(((acc, row) => acc[index] + row[index]), []);',
    nestedReducer: 'export const nestedReducer = (values: number[][], index: number) => values.reduce((acc, row) => { const read = () => acc[index]; return read(); }, []);',
    enabled: [
        '/* eslint-disable resilient/prefer-destructured-member-access -- Authored first scope. */',
        'export const inside = (values: number[], index: number) => Math.min(values[index], 1);',
        '/* eslint-enable resilient/prefer-destructured-member-access */',
        'export const outside = (values: number[], index: number) => Math.min(values[index], 1);'
    ].join('\n'),
    authoredNext: [
        '// eslint-disable-next-line resilient/prefer-destructured-member-access -- Authored exact line.',
        'export const authoredNext = (values: number[], index: number) => Math.min(values[index], 1);'
    ].join('\n'),
    authoredOther: ['// eslint-disable-next-line no-undef -- Caller owns original line.\n',
        'export const read = (left: number[], i: number) => Math.min(left[i], missing);'].join(''),
    authoredUnsupported: ['// eslint-disable-next-line no-undef -- Caller owns original line.\n',
        'export const read = (left: number[], right: number[], i: number) => Math.min(left[i], right[i], missing);'].join(''),
    authoredParameter: ['// eslint-disable-next-line no-undef -- Caller owns original line.\n',
        'export const read = (left: number[], i: number, other: { value: number }, extra = other.value) => Math.min(left[i], missing, extra);'].join(''),
    authoredBare: '// eslint-disable-next-line -- Caller owns original line.\nexport const read = (left: number[], i: number) => Math.min(left[i], 1);',
    atomic: 'const outer = [7]; export const select = (values: number[], index: number) => Math.min(values[index], outer[index]);',
    indexed: [
        'const outerRows: number[] = [0];',
        'export const compare = (local: number[], index: number) => { outerRows[0] === local[index]; return local; };',
        'export const nested = (values: number[], index: number, consume: (value: number) => number) => { return consume(values[index]); };',
        'export const direct = (values: number[], index: number) => { const picked = values[index]; return picked; };',
        'export const guarded = (values: number[], index: number, ready: boolean) => { if (!ready) return 0; return values[index]; };',
        'export const receiver = (values: { run(): number }[], index: number) => { return values[index].run(); };',
        'export const chained = (rows: number[][], index: number, out: number[]) => { out[index] = rows[index][0]; return out; };',
        'export const field = (rows: { value: number }[], index: number, out: number[]) => { out[index] = rows[index].value; return out; };',
        'export const nestedRead = (box: { value: number[] }, right: number) => box.value[1] !== right;'
    ].join('\n')
};
try {
    await Promise.all(Object.entries(examples).map(([name = '', code = '']) => writeFile(path.join(directory, `${name}.ts`), code)));
    const program = typescript.createProgram(Object.keys(examples).map(name => path.join(directory, `${name}.ts`)), {
        strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext
    });
    const transformer = createTypeScriptTransformer({ typescript, program });
    const render = name => transformer.transform({ code: examples[name], fileName: path.join(directory, `${name}.ts`) });
    const completedScopeRules = { plugins: { resilient }, rules: {
        'resilient/prefer-safe-transformations': 'error',
        'resilient/prefer-destructured-member-access': 'error',
        'resilient/prefer-prototype-methods': 'error',
        'resilient/no-else': 'error',
        'no-use-before-define': 'error',
        'func-style': ['error', 'expression']
    } };
    const completedScopeLinter = new Linter();
    ['completedLoopScope', 'unscopedUpdate', 'nativeCycle'].forEach((name) => {
        const { code = '', diagnostics = [] } = render(name);

        assert.deepEqual(diagnostics, []);
        assert.deepEqual(completedScopeLinter.verify(code, completedScopeRules), [], name);
        assert.ok(completedScopeLinter.getSuppressedMessages().length, `${name}: necessary boundaries remain`);
        const bare = code.replace(/\/\* eslint-(?:disable|enable)[\s\S]*?\*\//gu, '')
            .replace(/^\s*\/\/ eslint-disable[^\n]*\n/gmu, '');

        assert.ok(completedScopeLinter.verify(bare, completedScopeRules).length, `${name}: bare diagnostics return`);
        const { [name]: probe = '' } = { completedLoopScope: 'group(value => String(value % 2))([1, 2, 3])',
            nativeCycle: 'first(4)', unscopedUpdate: 'update([1], 0)' };
        const { outputText: source = '' } = typescript.transpileModule(examples[name], {
            compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
        });
        const execute = code => JSON.stringify(runInNewContext(`${code.replace(/\bexport /gu, '')}\n${probe}`));

        assert.equal(execute(code), execute(source), `${name}: source runtime preserved`);

        if (name === 'nativeCycle') assert.doesNotMatch(code, /Native mutual recursion keeps forward calls hoisted/u);

        if (name === 'unscopedUpdate') assert.match(code, /prefer-safe-transformations, resilient\/prefer-destructured-member-access/u);

        if (name === 'completedLoopScope') assert.doesNotMatch(code,
            /eslint-disable-next-line resilient\/prefer-safe-transformations, resilient\/prefer-destructured-member-access/u);
    });
    const finalExamples = {
        local: 'function probe() { const a = { _tag: "Right", right: 4 }; const { _tag: tag = "" } = a; if (tag === "Right") { const { right } = a; return right; } return 0; }',
        shadow: 'function probe(a) { { const a = { _tag: "Right", right: 4 }; const { _tag: tag = "" } = a; if (tag === "Right") { const { right } = a; return right; } } return 0; }',
        required: 'function probe(a, ready) { if (ready) { const { value } = a; return value; } return 0; }',
        defaulted: 'function probe(a, ready) { if (ready) { const { value = 0 } = a; return value; } return 0; }',
        nestedDefault: 'function probe(a, ready) { if (ready) { const { nested: { value = 0 } = {} } = a; return value; } return 0; }',
        nestedRequired: 'function probe(a, ready) { if (ready) { const { nested: { value } = { value: 0 } } = a; return value; } return 0; }',
        rest: 'function probe(a, ready) { if (ready) { const { ...value } = a; return value; } return 0; }',
        neighbor: ['function probe(a, ready) { if (ready) { const { value = 0 } = a; return value; } return 0; }',
            '// Authored neighbor remains outside the generated boundary.',
            'function neighbor(b) { const { other } = b; return other; }'].join('\n')
    };
    await Promise.all(Object.entries(finalExamples).map(([name = '', code = '']) => writeFile(path.join(directory, `final-${name}.js`), code)));
    const finalProgram = typescript.createProgram(Object.keys(finalExamples).map(name => path.join(directory, `final-${name}.js`)), {
        allowJs: true, noLib: true, checkJs: true, target: typescript.ScriptTarget.ESNext
    });
    const finalLinter = new Linter();
    const finalSettings = { plugins: { resilient }, rules: {
        'resilient/prefer-signature-destructuring': 'error',
        'resilient/prefer-safe-destructuring-defaults': 'error'
    } };
    const finalOutputs = new Map();
    Object.entries(finalExamples).forEach(([name = '', source = '']) => {
        const sourceFile = finalProgram.getSourceFile(path.join(directory, `final-${name}.js`));
        const placement = compilePlacementDecisions({ typescript, evidence: collectPlacementEvidence({
            typescript, sourceFile, checker: finalProgram.getTypeChecker()
        }) });
        const placeFinal = root => typescript.transform(root, [context => tree => annotateFinalExceptions({
            typescript, sourceFile: tree, placement, context
        })]);
        const placed = placeFinal(sourceFile);
        const { transformed: [result = sourceFile] = [] } = placed;
        const code = typescript.createPrinter().printFile(result);
        const repeated = placeFinal(result);
        const { transformed: [twice = result] = [] } = repeated;
        assert.equal(typescript.createPrinter().printFile(twice), code, name);
        repeated.dispose();
        placed.dispose();
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Test-owned result table keeps named emitted cases for runtime comparisons.
        finalOutputs.set(name, code);
        const findings = finalLinter.verify(code, finalSettings);
        const suppressed = finalLinter.getSuppressedMessages();

        if (['local', 'shadow'].includes(name)) {
            assert.doesNotMatch(code, /eslint-disable-next-line resilient\/prefer-signature-destructuring/u);
        }

        if (['defaulted', 'nestedDefault', 'rest'].includes(name)) {
            assert.doesNotMatch(code, /resilient\/prefer-safe-destructuring-defaults/u);
            assert.deepEqual(findings, []);
            assert.equal(suppressed.filter(({ ruleId = '' } = {}) => ruleId === 'resilient/prefer-signature-destructuring').length, 1);
        }

        if (['required', 'nestedRequired'].includes(name)) {
            assert.deepEqual(findings, []);
            assert.equal(suppressed.filter(({ ruleId = '' } = {}) => ruleId === 'resilient/prefer-safe-destructuring-defaults').length, 1);
        }

        if (name === 'neighbor') {
            assert.match(code, /Authored neighbor remains outside/u);
            assert.equal(findings.filter(({ ruleId = '' } = {}) => ruleId === 'resilient/prefer-signature-destructuring').length, 1);
            assert.equal(findings.filter(({ ruleId = '' } = {}) => ruleId === 'resilient/prefer-safe-destructuring-defaults').length, 1);
        }

        const tokens = (text) => {
            const scanner = typescript.createScanner(typescript.ScriptTarget.ESNext, true, typescript.LanguageVariant.Standard, text);
            const result = [];
            // eslint-disable-next-line resilient/prefer-prototype-methods, resilient/prefer-safe-transformations -- Stateful scanner advances once per token into a private comparison buffer.
            for (let kind = scanner.scan(); kind !== typescript.SyntaxKind.EndOfFileToken; kind = scanner.scan()) result.push([kind, scanner.getTokenText()]);

            return result;
        };
        assert.deepEqual(tokens(code), tokens(source), name);
    });
    const finalRuntime = code => JSON.parse(JSON.stringify(runInNewContext(`${code}\n(() => {
        const trace = []; const input = { get value() { trace.push('value'); return undefined; } };
        const taken = probe(input, true); const skipped = probe(input, false);
        let failure = ''; try { probe(null, true); } catch (error) { failure = error.name; }
        return { taken, skipped, trace, failure };
    })()`)));
    assert.deepEqual(finalRuntime(finalOutputs.get('defaulted')), finalRuntime(finalExamples.defaulted));
    assert.deepEqual(finalRuntime(finalOutputs.get('required')), finalRuntime(finalExamples.required));
    assert.deepEqual(finalRuntime(finalOutputs.get('defaulted')), { taken: 0, skipped: 0, trace: ['value'], failure: 'TypeError' });
    assert.equal(runInNewContext(`${finalOutputs.get('shadow')}\nprobe(null)`), 4);
    // Additional imports: collectRequiredTupleBindingContracts, annotateFinalExceptions.
    const tupleSource = 'export function probe(f: () => [() => number, unknown]) { const [a, b] = f(); return [a(), b]; }';
    const tupleFile = path.join(directory, 'required-carrier.ts');
    await writeFile(tupleFile, tupleSource);
    const tupleProgram = typescript.createProgram([tupleFile], { strict: true, noLib: true, target: typescript.ScriptTarget.ESNext });
    const tupleTree = tupleProgram.getSourceFile(tupleFile);
    const tupleFacts = collectRequiredTupleBindingContracts({ typescript, sourceFile: tupleTree, checker: tupleProgram.getTypeChecker() });
    assert.equal(tupleFacts.size, 1);
    const tupleDecisions = compileDestructuringDecisions(collectDestructuringAgreements({ requiredTupleBindingContracts: tupleFacts }));
    const tupleLinter = new Linter();
    const tupleSettings = { plugins: { resilient }, rules: { 'resilient/prefer-safe-destructuring-defaults': 'error' } };
    const tupleOutputs = new Map();
    ['carrier', 'wrongKey', 'bare'].forEach((mode) => {
        const result = typescript.transform(tupleTree, [context => (root) => {
            const visit = (node) => {
                const { name = {}, initializer = {} } = node;

                if (typescript.isVariableDeclaration(node) && typescript.isArrayBindingPattern(name) && mode !== 'bare') {
                    return typescript.factory.updateVariableDeclaration(node,
                        typescript.factory.createObjectBindingPattern([typescript.factory.createBindingElement(undefined,
                            typescript.factory.createIdentifier('values'), name, undefined)]), undefined, undefined,
                        typescript.factory.createObjectLiteralExpression([typescript.factory.createPropertyAssignment(
                            mode === 'wrongKey' ? 'other' : 'values', initializer)]));
                }

                return typescript.visitEachChild(node, visit, context);
            };

            return annotateFinalExceptions({ typescript, sourceFile: typescript.visitNode(root, visit), destructuringAgreements: tupleDecisions, context });
        }]);
        const { transformed: [placed = tupleTree] = [] } = result;
        const { outputText: code = '' } = typescript.transpileModule(typescript.createPrinter().printFile(placed), {
            compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
        });
        result.dispose();
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Test-owned result table keeps named carrier variants for runtime comparisons.
        tupleOutputs.set(mode, code);
        assert.deepEqual(tupleLinter.verify(code, tupleSettings), []);
        assert.equal(tupleLinter.getSuppressedMessages().length, { carrier: 0, wrongKey: 3, bare: 2 }[mode]);
    });
    const tupleRuntime = code => JSON.parse(JSON.stringify(runInNewContext(`${code.replace(/\bexport\s+/gu, '')}\n(() => {
        const trace = []; const tuple = { [Symbol.iterator]() { trace.push('iterator'); let i = 0; return {
            next() { trace.push('next'); return { done: false, value: i++ ? 7 : () => { trace.push('call'); return 4; } }; },
            return() { trace.push('close'); return { done: true }; }
        }; } };
        const value = probe(() => { trace.push('producer'); return tuple; });
        let failure = ''; try { probe(() => null); } catch (error) { failure = error.name; }
        return { trace, value, failure };
    })()`)));
    assert.deepEqual(tupleRuntime(tupleOutputs.get('carrier')), tupleRuntime(tupleOutputs.get('bare')));
    assert.deepEqual(tupleRuntime(tupleOutputs.get('carrier')), {
        trace: ['producer', 'iterator', 'next', 'next', 'close', 'call'], value: [4, 7], failure: 'TypeError'
    });

    // Additional imports: collectCallableOperationContracts, annotateRetainedStaticMemberAccess.
    const callableSource = 'export function probe(a: { map: (value: number) => number }, b: { value: number }) { return a.map(b.value); }';
    const callableFile = path.join(directory, 'callable-placement.ts');
    await writeFile(callableFile, callableSource);
    const callableProgram = typescript.createProgram([callableFile], { strict: true, noLib: true, target: typescript.ScriptTarget.ESNext });
    const callableTree = callableProgram.getSourceFile(callableFile);
    const callableFacts = collectCallableOperationContracts({ typescript, sourceFile: callableTree, checker: callableProgram.getTypeChecker() });
    const callableRecords = [...new Set(callableFacts.values())];
    assert.equal(callableRecords.length, 1);
    const callableTransformer = createTypeScriptTransformer({ typescript, program: callableProgram });
    const callableOutput = callableTransformer.transform({ code: callableSource, fileName: callableFile });
    assert.deepEqual(callableOutput.diagnostics, []);
    assert.match(callableOutput.code, /eslint-disable[^\n]*resilient\/prefer-destructured-member-access[^\n]*declared callable/u);
    const callablePlaced = typescript.transform(callableTree, [context => root => annotateRetainedStaticMemberAccess({
        typescript, sourceFile: root, context,
        destructuringAgreements: compileDestructuringDecisions(collectDestructuringAgreements({ callableOperationContracts: callableFacts }))
    })]);
    const { transformed: [callableResult = callableTree] = [] } = callablePlaced;
    const { outputText: callableCode = '' } = typescript.transpileModule(typescript.createPrinter().printFile(callableResult), {
        compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
    });
    callablePlaced.dispose();
    assert.match(callableCode, /eslint-disable[^\n]*resilient\/prefer-destructured-member-access/u);
    const callableLinter = new Linter();
    const callableSettings = { plugins: { resilient }, rules: {
        'resilient/prefer-destructured-member-access': 'error', 'resilient/signature-contract-operation': 'error'
    } };
    callableLinter.verify(callableCode, callableSettings);
    assert.equal(callableLinter.getSuppressedMessages().filter(({ ruleId = '' } = {}) => ruleId === 'resilient/prefer-destructured-member-access').length, 1);
    const callableRuntime = code => JSON.parse(JSON.stringify(runInNewContext(`${code.replace(/\bexport\s+/gu, '')}\n(() => {
        const trace = []; const a = { get map() { trace.push('method'); return function(value) { trace.push(this === a ? 'receiver' : 'wrong'); return value; }; } };
        const b = { get value() { trace.push('argument'); return 7; } };
        const value = probe(a, b); let failure = '';
        try { probe({ get map() { trace.push('missing-method'); return null; } }, b); } catch (error) { failure = error.name; }
        return { trace, value, failure };
    })()`)));
    assert.deepEqual(callableRuntime(callableOutput.code), callableRuntime(callableCode));
    assert.deepEqual(callableRuntime(callableOutput.code), {
        trace: ['method', 'argument', 'receiver', 'missing-method', 'argument'], value: 7, failure: 'TypeError'
    });
    const wholeExamples = {
        ancestor: 'function probe(a, b) { if (b) { const { right = 0 } = a; void right; } return a; }',
        ancestorTag: 'function probe(a, b) { if (b) { const { _tag: tag = "" } = a; void tag; } return a; }',
        ancestorWrong: 'function probe(a, b) { if (b) { const { right = 0 } = a; void right; } return b; }',
        ancestorShadow: 'function probe(a, b) { if (b) { const { right = 0 } = a; void right; } { const a = b; return a; } }',
        ancestorClosure: 'function probe(a, b) { if (b) { const { right = 0 } = a; void right; } return () => a; }',
        ancestorReassigned: 'function probe(a, b) { if (b) { const { right = 0 } = a; void right; } a = b; return 0; }',
        functionBoundary: 'function probe(a, b) { const run = a => { if (b) { const { right = 0 } = a; return right; } return 0; }; void run; return a; }',
        forwarded: 'function probe(a, b) { const { _tag: tag = "" } = a; if (tag === "Left") return a; const { right = 0 } = a; return right; }',
        wrongSymbol: 'function probe(a, b) { const { _tag: tag = "" } = a; if (tag === "Left") return b; const { right = 0 } = a; return right; }',
        shadowedForward: 'function probe(a, b) { const { _tag: tag = "" } = a; if (tag === "Left") { const a = b; return a; } const { right = 0 } = a; return right; }',
        reassigned: 'function probe(a, b) { const { _tag: tag = "" } = a; if (tag === "Left") { a = b; return a; } const { right = 0 } = a; return right; }'
    };
    await Promise.all(Object.entries(wholeExamples).map(([name = '', code = '']) => writeFile(path.join(directory, `whole-${name}.js`), code)));
    const wholeProgram = typescript.createProgram(Object.keys(wholeExamples).map(name => path.join(directory, `whole-${name}.js`)), {
        allowJs: true, checkJs: true, noLib: true, target: typescript.ScriptTarget.ESNext
    });
    const wholeLinter = new Linter();
    const wholeSettings = { plugins: { resilient }, rules: { 'resilient/prefer-signature-destructuring': 'error' } };
    Object.entries(wholeExamples).forEach(([name = '', source = '']) => {
        const sourceFile = wholeProgram.getSourceFile(path.join(directory, `whole-${name}.js`));
        const placement = compilePlacementDecisions({ typescript, evidence: collectPlacementEvidence({
            typescript, sourceFile, checker: wholeProgram.getTypeChecker()
        }) });
        const result = typescript.transform(sourceFile, [context => root => annotateFinalExceptions({ typescript, sourceFile: root, placement, context })]);
        const { transformed: [placed = sourceFile] = [] } = result;
        const code = typescript.createPrinter().printFile(placed);
        result.dispose();
        assert.deepEqual(wholeLinter.verify(code, wholeSettings), []);
        const expected = new Map([
            ['ancestor', 0], ['ancestorTag', 0], ['ancestorClosure', 0], ['ancestorReassigned', 0],
            ['ancestorWrong', 1], ['ancestorShadow', 1], ['functionBoundary', 1],
            ['forwarded', 1], ['reassigned', 1], ['wrongSymbol', 2], ['shadowedForward', 2]
        ]).get(name);
        assert.equal(wholeLinter.getSuppressedMessages().length, expected, name);
        assert.equal(wholeLinter.verify(source, wholeSettings).length, expected, name);
        const evaluate = text => JSON.stringify(runInNewContext(`${text}\n(() => {
            const trace = []; const a = { get _tag() { trace.push('tag'); return 'Left'; } }; const b = { right: 4 };
            const value = probe(a, b); return { own: value === a, other: value === b, trace };
        })()`));
        assert.equal(evaluate(code), evaluate(source), name);
    });
    const completed = "import { read as later } from './provider.js';\nexport const before = value => later(value);\n";
    const importedTree = typescript.createSourceFile('completed.js', completed, typescript.ScriptTarget.ESNext, true);
    const { statements: [, earlier = {}] = [] } = importedTree;
    typescript.addSyntheticLeadingComment(earlier, typescript.SyntaxKind.MultiLineCommentTrivia,
        ' eslint-disable no-use-before-define -- authored order ', true);
    typescript.addSyntheticTrailingComment(earlier, typescript.SyntaxKind.MultiLineCommentTrivia,
        ' eslint-enable no-use-before-define -- authored order ', true);
    const importedResult = typescript.transform(importedTree, [context => sourceFile => annotateCyclicRuntimeBindingReferences({ typescript, sourceFile, context })]);
    const { transformed: [importedNode = importedTree] = [] } = importedResult;
    const imported = { code: typescript.createPrinter().printFile(importedNode), diagnostics: [] };
    importedResult.dispose();

    // Cleanup removes obsolete imported boundaries; a live later binding must
    // rebuild both endpoints when an earlier pass retained only its close.
    const orphanSource = typescript.createSourceFile('orphan.js',
        'export const before = value => later(value);\nexport const later = value => value;\n',
        typescript.ScriptTarget.ESNext, true);
    const { statements: [orphanOwner = {}] = [] } = orphanSource;
    typescript.addSyntheticTrailingComment(orphanOwner, typescript.SyntaxKind.MultiLineCommentTrivia,
        ' eslint-enable no-use-before-define -- source lifetime ', true);
    const orphanResult = typescript.transform(orphanSource, [context => root => annotateCyclicRuntimeBindingReferences({
        typescript, sourceFile: root, context
    })]);
    const { transformed: [orphanNode = orphanSource] = [] } = orphanResult;
    const orphanCode = typescript.createPrinter().printFile(orphanNode);
    orphanResult.dispose();
    assert.match(orphanCode, /eslint-disable no-use-before-define/u);
    assert.match(orphanCode, /eslint-enable no-use-before-define/u);
    const orphanLinter = new Linter();
    const orphanSettings = { rules: { 'no-use-before-define': 'error' } };
    assert.deepEqual(orphanLinter.verify(orphanCode, orphanSettings), []);
    const orphanWithoutOpen = orphanCode.replace(/\/\* eslint-disable no-use-before-define[^*]*\*\//gu, '');
    assert.equal(orphanLinter.verify(orphanWithoutOpen, orphanSettings)
        .some(({ ruleId = '' }) => ruleId === 'no-use-before-define'), true,
    'The rebuilt opener suppresses the required forward-reference finding.');

    const emit = createTypeScriptEmitTransformer({ typescript, program });
    const retainedFile = path.join(directory, 'retained.ts');
    const { diagnostics: preparedDiagnostics = [], results = [] } = emit.prepare({ fileNames: [retainedFile] });
    assert.deepEqual(preparedDiagnostics, []);
    const [{ code: preparedCode = '' } = {}] = results;
    assert.equal(emit.before()(program.getSourceFile(retainedFile)).getFullText(), preparedCode);
    const scoped = render('scoped');
    assert.match(scoped.code, /eslint-disable resilient\/prefer-safe-destructuring-defaults -- Argument Get/u);
    assert.match(scoped.code, /eslint-enable resilient\/prefer-safe-destructuring-defaults/u);
    const retained = render('retained');
    const shadowed = render('shadowed');
    assert.deepEqual(imported.diagnostics, []);
    assert.doesNotMatch(imported.code, /eslint-(?:disable|enable).*no-use-before-define/u);
    assert.match(retained.code, /eslint-disable no-use-before-define/u);
    assert.match(retained.code, /eslint-enable no-use-before-define/u);
    assert.match(shadowed.code, /eslint-disable.*no-use-before-define/u, 'A same-named import cannot erase a local source-lifetime fact.');
    const linter = new Linter();
    assert.deepEqual(linter.verify(scoped.code, { plugins: { resilient }, rules: {
        'resilient/prefer-safe-destructuring-defaults': 'error', indent: ['error', 4, { SwitchCase: 1 }]
    } }), []);
    [imported, retained, shadowed].forEach(({ code = '' }) => {
        const findings = linter.verify(code, { rules: { 'no-use-before-define': 'error' } });
        assert.equal(findings.filter(({ ruleId = '' }) => ruleId === 'no-use-before-define').length, 0, JSON.stringify(findings));
    });

    const atomicSource = program.getSourceFile(path.join(directory, 'atomic.ts'));
    const atomicFacts = collectIndexedOperationContracts({ typescript, sourceFile: atomicSource, checker: program.getTypeChecker() });
    const atomicDecisions = compileDestructuringDecisions(collectDestructuringAgreements({ indexedOperationContracts: atomicFacts }));
    const atomicPlaced = typescript.transform(atomicSource, [context => root => annotateRetainedDynamicMemberAccess({
        typescript, sourceFile: root, destructuringAgreements: atomicDecisions, context
    })]);
    const { transformed: [atomicNode = atomicSource] = [] } = atomicPlaced;
    const atomicCode = typescript.createPrinter().printFile(atomicNode);
    atomicPlaced.dispose();
    assert.match(atomicCode, /eslint-disable-next-line resilient\/prefer-destructured-member-access -- Get order/u);
    assert.doesNotMatch(atomicCode, /eslint-enable resilient\/prefer-destructured-member-access/u);
    assert.doesNotMatch(atomicCode, /eslint-disable-line prefer-destructuring/u);
    const atomicRules = { plugins: { resilient }, rules: { 'resilient/prefer-destructured-member-access': 'error' } };
    const { outputText: atomicJavascript = '' } = typescript.transpileModule(atomicCode, {
        compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
    });
    assert.deepEqual(linter.verify(atomicJavascript, atomicRules), []);
    assert.equal(linter.getSuppressedMessages().length, 1, 'Only the parameter-owned read needs the member boundary.');
    const atomicBare = atomicJavascript.replace(/^\s*\/\/ eslint-disable-next-line resilient\/prefer-destructured-member-access[^\n]*\n/gmu, '');
    assert.equal(linter.verify(atomicBare, atomicRules).length, 1, 'The single necessary parameter-read finding returns.');

    const sourceFile = program.getSourceFile(path.join(directory, 'indexed.ts'));
    const facts = collectIndexedOperationContracts({ typescript, sourceFile, checker: program.getTypeChecker() });
    const place = (contracts = facts) => {
        const decisions = compileDestructuringDecisions(collectDestructuringAgreements({ indexedOperationContracts: contracts }));
        const result = typescript.transform(sourceFile, [context => node => annotateRetainedDynamicMemberAccess({
            typescript, sourceFile: node, destructuringAgreements: decisions, context
        })]);
        const { transformed: [placed = sourceFile] = [] } = result;
        const { outputText = '' } = typescript.transpileModule(typescript.createPrinter().printFile(placed), {
            compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
        });
        result.dispose();

        return outputText;
    };
    const code = place();
    const loweredIndexed = render('indexed');
    const settings = { plugins: { resilient }, rules: {
        'resilient/prefer-destructured-member-access': 'error',
        'resilient/prefer-safe-transformations': 'error',
        'prefer-destructuring': ['error', { VariableDeclarator: { array: true, object: true }, AssignmentExpression: { array: true, object: true } },
            { enforceForRenamedProperties: true }]
    } };
    assert.deepEqual(linter.verify(code, settings), [], code);
    assert.equal(linter.verify(loweredIndexed.code, settings).filter(({ severity = 0 }) => severity === 2).length, 0, loweredIndexed.code);
    const unresolved = collectIndexedOperationContracts({ typescript, sourceFile });
    const unresolvedFindings = linter.verify(place(unresolved), settings);
    assert.equal(unresolvedFindings.every(({ ruleId = '' }) => ruleId === 'resilient/prefer-destructured-member-access'), true,
        'Missing checker binding facts leave member findings visible, rather than inventing module or unresolved binding authority.');
    assert.equal(unresolvedFindings.length, 9, JSON.stringify(unresolvedFindings));
    assert.equal(code.split('prefer-destructuring').length - 1, 3, 'Only direct initializers and assignment chains own the core rule.');
    const unannotated = place(new Map());
    assert.doesNotMatch(unannotated, /eslint-disable/u);
    assert.equal(linter.verify(unannotated, settings).some(({ ruleId = '' }) => ruleId === 'prefer-destructuring'), true);
    const load = text => import(`data:text/javascript,${encodeURIComponent(text)}`);
    const { select = () => 0 } = await load(scoped.code);
    let projectionTrace = [];
    assert.equal(select({ get length() { projectionTrace = [...projectionTrace, 'left'];

        return 4; } }, { get length() { projectionTrace = [...projectionTrace, 'right'];

        return 2; } }), 2);
    assert.deepEqual(projectionTrace, ['left', 'right']);
    assert.throws(() => select(null, []), TypeError);
    const original = await load(unannotated);
    const placed = await load(code);
    const observe = ({ nested = () => 0, direct = () => 0, guarded = () => 0, receiver = () => 0, chained = () => [], field = () => [], compare = () => [] }) => {
        let events = [];
        const failure = new Error('getter');
        const values = { get 0() { events = [...events, 'get'];

            return 7; }, get 1() { throw failure; } };
        const consume = (value) => { events = [...events, 'call'];

            return value; };
        assert.equal(guarded(values, 1, false), 0);
        assert.throws(() => direct(values, 1), error => error === failure);
        const result = [nested(values, 0, consume), direct(values, 0), guarded(values, 0, true)];
        const owner = { run() { return this === owner; } };
        assert.equal(receiver([owner], 0), true);
        const out = [];
        assert.equal(chained([[7]], 0, out), out);
        assert.deepEqual(out, [7]);
        assert.equal(field([{ value: 9 }], 0, out), out);
        assert.deepEqual(out, [9]);
        assert.equal(compare(values, 0), values);

        return { result, events };
    };
    assert.deepEqual(observe(placed), observe(original));
    const indexedRules = { ...settings, linterOptions: { reportUnusedDisableDirectives: 'error' }, rules: {
        ...settings.rules, 'no-plusplus': ['error', { allowForLoopAfterthoughts: true }]
    } };
    const directPlacement = (name) => {
        const input = program.getSourceFile(path.join(directory, `${name}.ts`));
        const decisions = compileDestructuringDecisions(collectDestructuringAgreements({
            indexedOperationContracts: collectIndexedOperationContracts({ typescript, sourceFile: input, checker: program.getTypeChecker() })
        }));
        const result = typescript.transform(input, [context => root => annotateRetainedDynamicMemberAccess({
            typescript, sourceFile: root, destructuringAgreements: decisions, context
        })]);
        const { transformed: [placed = input] = [] } = result;
        const { outputText = '' } = typescript.transpileModule(typescript.createPrinter().printFile(placed), {
            compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
        });
        result.dispose();

        return formatResilientOutput(outputText, typescript);
    };
    const necessity = (code) => {
        const baseline = linter.verify(code, indexedRules);
        assert.deepEqual(baseline, [], code);
        assert.deepEqual(auditSource(code), [], code);
        assert.doesNotMatch(code, /eslint-disable-line/u);
        assert.equal(formatResilientOutput(code, typescript), code);
        const pattern = /^([ \t]*)\/\/ eslint-disable-next-line ([^\n]*?) -- ([^\n]*)$/gmu;
        const directives = [...code.matchAll(pattern)];

        directives.forEach(({ 0: comment = '', 1: indent = '', 2: names = '', 3: reason = '', index: position = 0 } = {}) => {
            names.split(',').map(rule => rule.trim()).forEach((removed) => {
                const remaining = names.split(',').map(rule => rule.trim()).filter(rule => rule !== removed);
                const replacement = remaining.length ? `${indent}// eslint-disable-next-line ${remaining.join(', ')} -- ${reason}` : '';
                const disposable = code.slice(0, position) + replacement + code.slice(position + comment.length);
                const findings = linter.verify(disposable, indexedRules);
                assert.equal(findings.filter(({ ruleId = '' }) => ruleId === removed).length, 1,
                    JSON.stringify({ removed, reason, findings, disposable }));
                assert.equal(findings.length, 1, 'Removing one necessary member exposes exactly its own target.');
            });
        });
        const [[first = ''] = []] = directives;

        if (first) {
            const unnecessary = code.replace(first, first.replace(' -- ', ', no-debugger -- '));
            assert.equal(linter.verify(unnecessary, { ...indexedRules, rules: { ...indexedRules.rules, 'no-debugger': 'error' } })
                .filter(({ message = '' }) => /Unused eslint-disable directive.*no-debugger/u.test(message)).length, 1);
        }
    };
    necessity(formatResilientOutput(code, typescript));
    ['optional', 'nestedKey', 'updates', 'reducer', 'nestedReducer', 'enabled', 'authoredNext'].forEach((name) => {
        [directPlacement(name), render(name).code].forEach((body) => {
            necessity(body);

            if (name === 'enabled') {
                assert.equal((body.match(/eslint-disable-next-line resilient\/prefer-destructured-member-access/gu) || []).length, 1);
                assert.ok(body.indexOf('Authored first scope.') < body.indexOf('export const inside'));
                assert.ok(body.indexOf('eslint-enable') < body.indexOf('export const outside'));
                const bare = body.replace(/\/\* eslint-(?:disable|enable)[^*]*\*\//gu, '');
                assert.equal(linter.verify(bare, indexedRules).filter(({ ruleId = '' }) => ruleId === 'resilient/prefer-destructured-member-access').length, 1,
                    'Only removing the authored mask exposes the inside target; the outside still owns its generated directive.');
            }

            if (name === 'authoredNext') assert.equal((body.match(/eslint-disable-next-line/gu) || []).length, 1,
                'The authored payload and exact next-line attachment remain without a redundant generated member.');

            if (name === 'nestedKey') assert.equal(linter.getSuppressedMessages().filter(({ ruleId = '' }) => ruleId === 'resilient/prefer-destructured-member-access').length, 2);
        });
    });
    ['authoredOther', 'authoredUnsupported', 'authoredParameter'].forEach((name) => {
        const { rules: necessaryRules = {} } = indexedRules;
        const collisionRules = { ...indexedRules, languageOptions: { globals: { Math: 'readonly' } },
            rules: { ...necessaryRules, 'no-undef': 'error' } };

        [directPlacement(name), render(name).code].forEach((body) => {
            const findings = linter.verify(body, collisionRules);
            const suppressed = linter.getSuppressedMessages();
            assert.equal(suppressed.filter(({ ruleId = '' }) => ruleId === 'no-undef').length, 1, body);
            assert.match(body, /\/\/ eslint-disable-next-line no-undef -- Caller owns original line\.\nexport const read =/u);
            assert.deepEqual(auditSource(body), []);
            assert.equal(formatResilientOutput(body, typescript), body);

            if (name === 'authoredOther') {
                assert.deepEqual(findings, [], body);
                assert.equal(suppressed.filter(({ ruleId = '' }) => ruleId === 'resilient/prefer-destructured-member-access').length, 1);
                const bare = body.replace(/\/\* eslint-(?:disable|enable) resilient\/prefer-destructured-member-access[^*]*\*\//gu, '');
                assert.equal(linter.verify(bare, collisionRules).length, 1);
                assert.equal(linter.getSuppressedMessages().filter(({ ruleId = '' }) => ruleId === 'no-undef').length, 1);
                const unnecessary = body.replace(' -- Get order ', ', no-debugger -- Get order ')
                    .replace('eslint-enable resilient/prefer-destructured-member-access ',
                        'eslint-enable resilient/prefer-destructured-member-access, no-debugger ');
                assert.equal(linter.verify(unnecessary, { ...collisionRules,
                    rules: { ...necessaryRules, 'no-undef': 'error', 'no-debugger': 'error' } })
                    .filter(({ message = '' }) => /Unused eslint-disable directive.*no-debugger/u.test(message)).length, 1);

                return;
            }

            assert.equal(findings.length, 2, JSON.stringify(findings));
            assert.equal(findings.every(({ ruleId = '' }) => ruleId === 'resilient/prefer-destructured-member-access'), true);
            assert.doesNotMatch(body, /eslint-(?:disable|enable) resilient\/prefer-destructured-member-access/u,
                'An unsupported authored line exposes retained findings without widening scope.');
        });
    });
    [directPlacement('authoredBare'), render('authoredBare').code].forEach((body) => {
        assert.deepEqual(linter.verify(body, indexedRules), [], body);
        assert.equal(linter.getSuppressedMessages().length, 1);
        assert.match(body, /\/\/ eslint-disable-next-line -- Caller owns original line\.\nexport const read =/u);
        assert.doesNotMatch(body, /eslint-(?:disable|enable) resilient\/prefer-destructured-member-access/u,
            'A bare authored directive already owns the necessary member rule.');
        const bare = body.replace(/\/\/ eslint-disable-next-line -- Caller owns original line\.\n/u, '');
        assert.equal(linter.verify(bare, indexedRules).length, 1);
    });
    const { outputText: collisionReference = '' } = typescript.transpileModule(examples.authoredOther, {
        compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
    });
    const collisionFunctions = await Promise.all([collisionReference, directPlacement('authoredOther'), render('authoredOther').code].map(load));
    collisionFunctions.forEach(({ read = () => 0 } = {}) => {
        let events = [];
        const failure = new Error('authored collision Get');
        const values = { get 0() { events = [...events, 'get'];

            return 7; }, get 1() { throw failure; } };
        assert.throws(() => read(values, 0), ReferenceError);
        assert.deepEqual(events, ['get'], 'The later unresolved operand still fails after the original Get.');
        assert.throws(() => read(values, 1), error => error === failure);
        assert.throws(() => read(null, 0), TypeError);
    });
    const afterthought = directPlacement('afterthought');
    necessity(afterthought);
    assert.doesNotMatch(afterthought, /eslint-disable-next-line[^\n]*no-plusplus/u,
        'The existing loop-afterthought rule exception needs no generated entry.');
    const sequenceAfterthought = directPlacement('sequenceAfterthought');
    necessity(sequenceAfterthought);
    assert.doesNotMatch(sequenceAfterthought, /eslint-disable-next-line[^\n]*no-plusplus/u,
        'An update nested in a sequence and parentheses is still the loop afterthought.');
    const { sequenceAfterthought: runSequence = () => [] } = await load(sequenceAfterthought);
    let sequenceEvents = [];
    const sequenceValues = { get 0() { sequenceEvents = [...sequenceEvents, 'get'];

        return 7; }, set 0(value) { sequenceEvents = [...sequenceEvents, `set:${value}`]; } };
    assert.equal(runSequence(sequenceValues, 0, () => { sequenceEvents = [...sequenceEvents, 'effect']; }), sequenceValues);
    assert.deepEqual(sequenceEvents, ['get', 'set:8', 'effect']);
    const parenthesizedNeighbor = directPlacement('parenthesizedNeighbor');
    const neighborFindings = linter.verify(parenthesizedNeighbor, indexedRules);
    assert.equal(neighborFindings.length, 2, JSON.stringify(neighborFindings));
    assert.deepEqual(neighborFindings.map(({ ruleId = '' }) => ruleId).toSorted(),
        ['prefer-destructuring', 'resilient/prefer-destructured-member-access']);
    assert.equal(linter.getSuppressedMessages().filter(({ ruleId = '' }) => ruleId === 'prefer-destructuring').length, 1,
        'Only x is controlled; the parenthesized initializer cannot hide the y binding.');
    const { afterthought: runAfterthought = () => [] } = await load(afterthought);
    const afterthoughtValues = [7];
    assert.equal(runAfterthought(afterthoughtValues, 0), afterthoughtValues);
    assert.deepEqual(afterthoughtValues, [8]);
    const { outputText: nestedKeyReference = '' } = typescript.transpileModule(examples.nestedKey, {
        compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
    });
    const nestedKeyFunctions = await Promise.all([nestedKeyReference, directPlacement('nestedKey'), render('nestedKey').code].map(load));
    const nestedObserve = ({ nestedKey = () => 0 } = {}) => {
        let events = [];
        const index = { [Symbol.toPrimitive]() { events = [...events, 'index'];

            return 'i'; } };
        const key = { [Symbol.toPrimitive]() { events = [...events, 'key'];

            return 'value'; } };
        const keys = { get i() { events = [...events, 'key Get'];

            return key; } };
        const values = { get value() { events = [...events, 'value Get'];

            return 7; } };
        const value = nestedKey(values, keys, index);
        assert.throws(() => nestedKey(null, keys, index), TypeError);

        return { value, events };
    };
    const [nestedReference = {}] = nestedKeyFunctions;
    nestedKeyFunctions.forEach(invoke => assert.deepEqual(nestedObserve(invoke), nestedObserve(nestedReference)));
    const optionalFunctions = await Promise.all([directPlacement('optional'), render('optional').code].map(load));
    optionalFunctions.forEach(({ optional = () => 0 } = {}) => {
        assert.equal(optional(null, 0), undefined, 'The whole optional receiver chain retains nullish short-circuiting.');
        let events = [];
        const failure = new Error('optional Get');
        const values = { get 0() { events = [...events, 'get'];

            return { get value() { events = [...events, 'value'];

                return 7; } }; }, get 1() { throw failure; } };
        assert.equal(optional(values, 0), 7);
        assert.deepEqual(events, ['get', 'value']);
        assert.throws(() => optional(values, 1), error => error === failure);
        assert.throws(() => optional(values, 2), TypeError);
    });
    const updateFunctions = await Promise.all([directPlacement('updates'), render('updates').code].map(load));
    updateFunctions.forEach(({ increment = () => 0, remove = () => 0 } = {}) => {
        let events = [];
        const target = { get x() { events = [...events, 'get'];

            return 7; }, set x(value) { events = [...events, `set:${value}`]; } };
        const key = { [Symbol.toPrimitive]() { events = [...events, 'key'];

            return 'x'; } };
        assert.equal(increment(target, key), 7);
        assert.deepEqual(events, ['key', 'get', 'key', 'set:8']);
        assert.equal(remove(target, key), true);
        assert.equal(Object.hasOwn(target, 'x'), false);
        assert.throws(() => increment(null, key), TypeError);
    });
    await Promise.all(['optional', 'nestedKey', 'updates', 'reducer', 'nestedReducer', 'enabled', 'authoredNext',
        'authoredOther', 'authoredUnsupported', 'authoredParameter', 'authoredBare', 'sequenceAfterthought', 'parenthesizedNeighbor'].map(async (name) => {
        assert.equal(await readFile(path.join(directory, `${name}.ts`), 'utf8'), examples[name]);
    }));
    assert.equal(await readFile(path.join(directory, 'indexed.ts'), 'utf8'), examples.indexed);
} finally {
    await rm(directory, { recursive: true, force: true });
}

// Packet 3B: spelling collisions cannot lend a module-order boundary to a
// checker-resolved local binding. Actual early reads retain their own scope.
const runtimeReferenceCases = [
    { name: 'baseline-f', code: 'export const invoke = (f: () => number) => f();\nexport const f = () => 9;\n', probe: 'invoke(() => 4)' },
    { name: 'authored', code: ['/* eslint-disable no-use-before-define -- Caller scope. */',
        'export const invoke = (f: () => number) => f();', '/* eslint-enable no-use-before-define */',
        'export const f = () => 9;'].join('\n'), probe: 'invoke(() => 4)', inherited: true },
    { name: 'parameter', code: 'export const invoke = (later: () => number) => later(); export const later = () => 9;', probe: 'invoke(() => 4)' },
    { name: 'nested-local', code: 'export const invoke = (n: number) => { const later = () => n; return later(); }; export const later = () => 9;', probe: 'invoke(4)' },
    { name: 'default', code: 'export const invoke = (later = () => 4) => later(); export const later = () => 9;', probe: 'invoke()' },
    { name: 'capture', code: 'export const invoke = (later: () => number) => () => later(); export const later = () => 9;', probe: 'invoke(() => 4)()' },
    { name: 'shorthand', code: 'export const invoke = (later: number) => ({ later }); export const later = () => 9;', probe: 'invoke(4)' },
    { name: 'property', code: 'export const invoke = () => ({ later: 4 }); export const later = () => 9;', probe: 'invoke()' },
    { name: 'class', code: 'export const invoke = () => { class later { value() { return 4; } } return new later().value(); }; export const later = () => 9;', probe: 'invoke()' },
    { name: 'catch', code: 'export const invoke = (n: number) => { try { throw n; } catch (later) { return later; } }; export const later = () => 9;', probe: 'invoke(4)' },
    { name: 'forward', code: 'export const invoke = () => later(); export const later = () => 4;', probe: 'invoke()', necessary: true },
    { name: 'mixed', code: 'export const invoke = (f: () => number) => later(f()); export const f = () => 9; export const later = (n: number) => n + 1;', probe: 'invoke(() => 3)', necessary: true },
    { name: 'hoisted', code: 'export const result = later(); export function later() { return 4; }', probe: 'result', necessary: true },
    { name: 'recursive', code: ['export const invoke = (n: number): number => n ? later(n - 1) : 4;',
        'export const later = (n: number): number => n ? invoke(n - 1) : 4;'].join('\n'), probe: 'invoke(3)', necessary: true },
    { name: 'tdz', code: 'export const result = later(); export const later = () => 4;', probe: 'result', necessary: true, failure: true },
    { name: 'computed-receiver', code: [
        'export const invoke = (later: { [Symbol.toPrimitive](): string }, host: { [key: string]: () => number }) => host[later as unknown as string]();',
        'export const later = () => 9;'
    ].join('\n'), probe: [
        '(() => { const trace = []; const key = { [Symbol.toPrimitive]() { trace.push("key"); return "run"; } };',
        'const host = { get run() { trace.push("get"); return function () { trace.push(this === host); return 4; }; } };',
        'return [invoke(key, host), trace]; })()'
    ].join('\n') }
];
const referenceDirectory = await mkdtemp(path.join(tmpdir(), 'resilient-reference-ownership-'));
const referenceConfig = { linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: { 'no-use-before-define': ['error', { functions: true }], 'no-console': 'error' } };
const referenceLinter = new Linter();
const referencePrinter = typescript.createPrinter();
const referenceJS = code => typescript.transpileModule(code, { compilerOptions: {
    target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext
} }).outputText;
const referenceEvaluate = (code, probe) => JSON.stringify(runInNewContext(`${code.replace(/\bexport\s+/gu, '')}\n${probe}`));
const referenceStrip = code => code.replace(/\/\* eslint-(?:disable|enable) no-use-before-define -- (?:authored order|recursive binding|source lifetime) \*\//gu, '');
try {
    await Promise.all(runtimeReferenceCases.map(({ name = '', code = '' } = {}) => writeFile(path.join(referenceDirectory, `${name}.ts`), code)));
    const referenceProgram = typescript.createProgram(runtimeReferenceCases.map(({ name = '' } = {}) => path.join(referenceDirectory, `${name}.ts`)), {
        strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext
    });
    const referenceTransformer = createTypeScriptTransformer({ typescript, program: referenceProgram });
    runtimeReferenceCases.forEach(({ name = '', code = '', probe = '', necessary = false, failure = false, inherited = false } = {}) => {
        const fileName = path.join(referenceDirectory, `${name}.ts`);
        const sourceFile = referenceProgram.getSourceFile(fileName);
        const checker = referenceProgram.getTypeChecker();
        const runtimeBindingTargets = new Map(sourceFile.statements.flatMap(node => [...getRuntimeBindingIdentities({
            typescript, statements: [node], checker
        })].map(([symbol = false] = []) => [symbol, getConsumerContractKey(node)])));
        const runtimeBindingReferences = collectRuntimeBindingReferenceFacts({ typescript, sourceFile, checker, runtimeBindingTargets });
        const factsBefore = [...runtimeBindingReferences];
        const place = root => typescript.transform(root, [context => (source) => {
            const placed = annotateCyclicRuntimeBindingReferences({ typescript, sourceFile: source, runtimeBindingReferences, context });
            const placedText = referencePrinter.printFile(placed);
            const grouped = groupNextLineExceptions({ typescript, sourceFile: placed, context });
            assert.equal(referencePrinter.printFile(grouped), placedText, 'Grouping retains paired owners.');
            const regrouped = groupNextLineExceptions({ typescript, sourceFile: grouped, context });
            assert.equal(referencePrinter.printFile(regrouped), placedText, 'Grouping is idempotent in its compiler transform.');

            return regrouped;
        }]);
        const direct = place(typescript.createSourceFile(fileName, code, typescript.ScriptTarget.ESNext, true));
        const { transformed: [directTree = sourceFile] = [] } = direct;
        const directText = referencePrinter.printFile(directTree);
        const again = place(directTree);
        const { transformed: [againTree = directTree] = [] } = again;
        const againText = referencePrinter.printFile(againTree);
        assert.equal(againText, directText, name);
        assert.deepEqual([...runtimeBindingReferences], factsBefore, 'Placement preserves the checker fact snapshot.');
        const { code: publicCode = '', diagnostics = [] } = referenceTransformer.transform({ code, fileName });
        assert.deepEqual(diagnostics, [], name);
        const directCode = referenceJS(directText);
        [directCode, publicCode].forEach((output) => {
            const findings = referenceLinter.verify(output, referenceConfig);

            if (inherited) {
                assert.ok(output.includes('/* eslint-disable no-use-before-define -- Caller scope. */'));
                assert.ok(output.includes('/* eslint-enable no-use-before-define */'));
                assert.equal(findings.length, 1, 'Inherited authored unused debt remains visible.');
            }

            const family = findings.filter(({ ruleId = '', message = '' } = {}) => ruleId === 'no-use-before-define' ||
                !inherited && !ruleId && message.includes("'no-use-before-define'"));
            assert.deepEqual(family, [], `${name}: ${JSON.stringify(findings)}`);
            const suppressed = referenceLinter.getSuppressedMessages().filter(({ ruleId = '' } = {}) => ruleId === 'no-use-before-define');
            assert.equal(Boolean(suppressed.length), necessary, `${name}: ${output}`);
            assert.equal(referenceLinter.verify(referenceStrip(output), referenceConfig)
                .some(({ ruleId = '' } = {}) => ruleId === 'no-use-before-define'), necessary, name);
            const neighbor = `${output}\nconsole.log('neighbor');`;
            assert.equal(referenceLinter.verify(neighbor, referenceConfig).filter(({ ruleId = '' } = {}) => ruleId === 'no-console').length, 1);

            if (failure) {
                [referenceJS(code), output].forEach(value => assert.throws(() => referenceEvaluate(value, probe), ({ name: errorName = '' } = {}) => errorName === 'ReferenceError'));
            }

            if (!failure) assert.equal(referenceEvaluate(output, probe), referenceEvaluate(referenceJS(code), probe), name);

            assert.equal(formatResilientOutput(formatResilientOutput(output, typescript), typescript), formatResilientOutput(output, typescript));
        });
        again.dispose();
        direct.dispose();
    });
    const forwardFile = referenceProgram.getSourceFile(path.join(referenceDirectory, 'forward.ts'));
    const conservative = typescript.transform(forwardFile, [context => sourceFile => annotateCyclicRuntimeBindingReferences({ typescript, sourceFile, context })]);
    const { transformed: [conservativeTree = forwardFile] = [] } = conservative;
    assert.match(referencePrinter.printFile(conservativeTree), /eslint-disable no-use-before-define -- authored order/u);
    conservative.dispose();
    const { code: forwardSource = '' } = runtimeReferenceCases.find(({ name = '' } = {}) => name === 'forward') ?? {};
    const { code: forward = '' } = referenceTransformer.transform({ code: forwardSource,
        fileName: path.join(referenceDirectory, 'forward.ts') });
    const negativeControl = forward.replace('eslint-disable no-use-before-define', 'eslint-disable no-use-before-define, no-console');
    assert.ok(referenceLinter.verify(negativeControl, referenceConfig).some(({ ruleId = '', message = '' } = {}) => !ruleId && message.includes("'no-console'")));
    const outer = `/* eslint-disable no-use-before-define -- Authored outer scope. */\n${forward}\n/* eslint-enable no-use-before-define */`;
    assert.ok(outer.includes('Authored outer scope.'));
    const unmasked = referenceStrip(outer).replace(/\/\* eslint-(?:disable no-use-before-define -- Authored outer scope\.|enable no-use-before-define) \*\//gu, '');
    assert.ok(referenceLinter.verify(unmasked, referenceConfig).some(({ ruleId = '' } = {}) => ruleId === 'no-use-before-define'));
} finally {
    await rm(referenceDirectory, { recursive: true, force: true });
}

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-runtime-type-boundaries-'));
    const examples = {
        erased: 'export const before: typeof later = () => 4; export const later = () => 4;',
        mixed: 'export const before: typeof later = () => later(); export const later = () => 4;',
        cast: 'export const before = (() => 4) as typeof later; export const later = () => 4;',
        satisfies: 'export const before = (() => later()) satisfies typeof later; export const later = () => 4;',
        eager: 'export const before: typeof later = later; export const later = () => 4;',
        authored: ['/* eslint-disable no-use-before-define -- Authored boundary. */', 'export const before: typeof later = () => 4;',
            '/* eslint-enable no-use-before-define */', 'export const later = () => 4;'].join('\n')
    };
    const linter = new Linter();
    const settings = { languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        rules: { 'no-use-before-define': ['error', { functions: true }], 'no-console': 'error' } };
    const strip = code => code.replace(/\/\* eslint-(?:disable|enable) no-use-before-define -- (?:authored order|recursive binding|source lifetime) \*\//gu, '');
    try {
        await Promise.all(Object.entries(examples).map(([name = '', code = ''] = []) => writeFile(path.join(directory, `${name}.ts`), code)));
        const program = typescript.createProgram(Object.keys(examples).map(name => path.join(directory, `${name}.ts`)), {
            strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext
        });
        const transformer = createTypeScriptTransformer({ typescript, program });
        Object.entries(examples).forEach(([name = '', source = ''] = []) => {
            const { code = '', diagnostics = [] } = transformer.transform({ code: source, fileName: path.join(directory, `${name}.ts`) });
            assert.deepEqual(diagnostics, [], name);

            if (name === 'authored') {
                assert.match(code, /eslint-disable no-use-before-define -- Authored boundary\./u);
                assert.doesNotMatch(code, /no-use-before-define -- authored order/u);

                return;
            }

            assert.deepEqual(linter.verify(code, settings), [], name);
            const necessary = ['mixed', 'satisfies', 'eager'].includes(name);
            assert.equal(linter.getSuppressedMessages().some(({ ruleId = '' } = {}) => ruleId === 'no-use-before-define'), necessary, name);
            assert.equal(linter.verify(strip(code), settings).some(({ ruleId = '' } = {}) => ruleId === 'no-use-before-define'), necessary, name);
        });

        // Completed factory children lack source parent pointers. Property keys and
        // binding names are not reads; computed keys and initializers remain reads.
        [
            ['const { later: local } = {}; const later = 1;', false],
            ['const value = { later: 1 }; const later = 1;', false],
            ['const { [later]: local } = {}; const later = "key";', true],
            ['const value = { key: later }; const later = 1;', true],
            ['const value = { later }; const later = 1;', true],
            ['const probe = later => { for (let first = later, later = 1; first;) break; }; const later = 3;', true],
            ['const probe = later => { try { throw {}; } catch ({first = later, later}) { return first; } }; const later = 3;', true],
            ['const probe = later => { switch (1) { case 1: return later; case 2: let later = 1; } }; const later = 3;', true],
            ["const probe = () => { const { later = 0 } = {}; return { later }; }; const later = 2;", false],
            ["const probe = (later) => later(); const later = () => 2;", false],
            ["const probe = ({field: later}) => later; const later = 2;", false],
            ["const probe = ({later: field}) => later; const later = 2;", true],
            ["const probe = () => { const later = 2; return () => { const value = later; const later = 1; return value; }; }; const later = 3;", true],
            ["const probe = () => { const value = later; const later = 1; return value; }; const later = 3;", true],
            ["const probe = () => { const {field = later} = {}; return field; }; const later = 3;", true],
            ["const probe = () => { const {[later]: field} = {}; return field; }; const later = \"key\";", true],
            ["const probe = () => { { const later = 1; } return later; }; const later = 3;", true]
        ].forEach(([source = '', needed = false] = []) => {
            const parsed = typescript.createSourceFile('completed.js', source, typescript.ScriptTarget.ESNext, true);
            const cloned = typescript.transform(parsed, [context => (root) => {
                const visit = (node = {}) => {
                    const { text = '' } = node;

                    return typescript.isIdentifier(node) ? typescript.factory.createIdentifier(text)
                        : typescript.visitEachChild(node, visit, context);
                };

                return visit(root);
            }]);
            const { transformed: [root = {}] = [] } = cloned;
            const annotate = tree => typescript.transform(tree, [context => sourceFile => groupNextLineExceptions({
                typescript, context, sourceFile: annotateCyclicRuntimeBindingReferences({ typescript, sourceFile, context })
            })]).transformed[0];
            const first = annotate(root), printer = typescript.createPrinter();
            const output = printer.printFile(first);
            assert.equal(printer.printFile(annotate(first)), output, source);
            assert.deepEqual(linter.verify(output, settings), [], source);
            assert.equal(linter.getSuppressedMessages().some(({ ruleId = '' } = {}) => ruleId === 'no-use-before-define'), needed, source);
            assert.equal(linter.verify(strip(output), settings).some(({ ruleId = '' } = {}) => ruleId === 'no-use-before-define'), needed, source);
            assert.equal(linter.verify(`${output}\nconsole.log('neighbor');`, settings).filter(({ ruleId = '' } = {}) => ruleId === 'no-console').length, 1);
            cloned.dispose();
        });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

// Authored endpoints take effect inside a later generated enclosing scope.
['resilient/prefer-destructured-member-access', ''].forEach((rules) => {
    const text = `function probe(a, k) {\nconst value = a.one;\n/* eslint-enable ${rules} -- Authored endpoint. */\nreturn a[k];\n}`;
    const parsed = typescript.createSourceFile('authored-endpoint.js', text, typescript.ScriptTarget.ESNext, true);
    const placed = typescript.transform(parsed, [context => (sourceFile) => {
        const { statements: [fn = {}] = [] } = sourceFile;
        const { body: { statements: [, returned = {}] = [] } = {} } = fn;

        typescript.addSyntheticLeadingComment(fn, typescript.SyntaxKind.MultiLineCommentTrivia,
            ' eslint-disable resilient/prefer-destructured-member-access -- Enclosing generated scope. ', true);
        typescript.addSyntheticLeadingComment(returned, typescript.SyntaxKind.SingleLineCommentTrivia,
            ' eslint-disable-next-line resilient/prefer-destructured-member-access -- Get order.', true);

        return annotateRetainedDynamicMemberAccess({ typescript, sourceFile, context, annotationsOnly: true });
    }]);
    const { transformed: [output = parsed] = [] } = placed;
    const code = typescript.createPrinter().printFile(output);
    const lint = new Linter();
    const settings = { plugins: { resilient }, rules: { 'resilient/prefer-destructured-member-access': 'error' } };

    assert.deepEqual(lint.verify(code, settings), []);
    assert.equal(lint.getSuppressedMessages().length, 2);
    assert.match(code, /Authored endpoint/u);
    assert.match(code, /eslint-disable-next-line resilient\/prefer-destructured-member-access -- Get order/u);
    const neighbor = `${code}\nfunction neighbor(a, k) { return a[k]; }`;

    assert.equal(lint.verify(neighbor, settings).filter(({ ruleId = '' } = {}) => ruleId === 'resilient/prefer-destructured-member-access').length, 1);
    placed.dispose();
});
{
    const scopeDirectory = await mkdtemp(path.join(tmpdir(), 'resilient-terminal-scope-'));
    const scopeSource = [
        'export function member(): { (k: number): (m: number) => number; (k: number, m: number): number };',
        'export function member() {',
        '    const lookupValue = lookup();',
        '    return (k: number, m?: number) => {',
        '        if (m === undefined) return (next: number) => lookupValue(k, next);',
        '        return lookupValue(k, m);',
        '    };',
        '}',
        'type Erased = number;',
        'export function lookup(): (k: number, m: number) => number;',
        'export function lookup() { return (k: number, m: number) => k + m; }',
        '/** Authored neighbor note. */',
        'export const neighbor = () => after();',
        'export const after = () => 4;'
    ].join('\n');
    try {
        const scopeFile = path.join(scopeDirectory, 'scope.ts');
        await writeFile(scopeFile, scopeSource);
        const scopeProgram = typescript.createProgram([scopeFile], {
            strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext
        });
        const scopeTransformer = createTypeScriptTransformer({ typescript, program: scopeProgram });
        const scopeResult = scopeTransformer.transform({ code: scopeSource, fileName: scopeFile });
        const { code: scopedCode = '', diagnostics: scopeDiagnostics = [] } = scopeResult;
        assert.deepEqual(scopeDiagnostics, []);
        assert.match(scopedCode, /\} \/\* eslint-enable no-use-before-define -- source lifetime \*\//u);
        assert.match(scopedCode, /Authored neighbor note\./u);
        assert.equal(scopeTransformer.transform({ code: scopeSource, fileName: scopeFile }).code, scopedCode);
        const scopeLinter = new Linter();
        const scopeSettings = { plugins: { resilient }, rules: {
            'no-use-before-define': ['error', { functions: true }],
            'func-style': ['error', 'expression'],
            'resilient/signature-contract-return-consistency': 'error',
            'resilient/no-undefined-comparison': 'error'
        } };
        const referenceFinding = ({ ruleId = '', message = '' } = {}) => ruleId === 'no-use-before-define' ||
            !ruleId && message.includes("'no-use-before-define'");
        assert.deepEqual(scopeLinter.verify(scopedCode, scopeSettings).filter(referenceFinding), []);
        assert.ok(scopeLinter.getSuppressedMessages().some(({ ruleId = '', message = '' } = {}) => (
            ruleId === 'no-use-before-define' && message.includes('lookup')
        )));
        const withoutNeighbor = scopedCode.replace(/\/\* eslint-(?:disable|enable) no-use-before-define -- authored order \*\//gu, '');
        const neighborFindings = scopeLinter.verify(withoutNeighbor, scopeSettings).filter(referenceFinding);
        assert.equal(neighborFindings.length, 1);
        assert.ok(neighborFindings.some(({ message = '' } = {}) => message.includes('after')));
        const withoutMain = scopedCode.replace(/\/\* eslint-(?:disable|enable) no-use-before-define -- source lifetime \*\//gu, '');
        assert.ok(scopeLinter.verify(withoutMain, scopeSettings).some(({ ruleId = '', message = '' } = {}) => (
            ruleId === 'no-use-before-define' && message.includes('lookup')
        )));
        const tokenValues = (code = '') => {
            scopeLinter.verify(code, { linterOptions: { noInlineConfig: true } });
            const { ast: { tokens = [] } = {} } = scopeLinter.getSourceCode();

            return tokens.map(({ type = '', value = '' } = {}) => [type, value]);
        };
        assert.deepEqual(tokenValues(withoutMain), tokenValues(scopedCode));
        assert.deepEqual(tokenValues(withoutNeighbor), tokenValues(scopedCode));
        const nativeCode = typescript.transpile(scopeSource, { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext });
        [nativeCode, scopedCode].forEach((executable = '') => {
            const actual = runInNewContext(`${executable.replace(/export /gu, '')}\n[member()(2, 3), member()(2)(3), neighbor()]`);
            assert.equal(JSON.stringify(actual), '[5,5,4]');
        });
    } finally {
        await rm(scopeDirectory, { recursive: true, force: true });
    }
}

// Type-only comments cannot prove coverage of a retained runtime read.
[
    'function probe(a, k) { /* eslint-disable resilient/prefer-destructured-member-access -- Erased type. */\ntype T = number; return a[k]; }',
    '/* eslint-disable resilient/prefer-destructured-member-access -- Erased type. */\ntype T = number; function probe(a, k) { return a[k]; }'
].forEach((text) => {
    const parsed = typescript.createSourceFile('erased-endpoint.ts', text, typescript.ScriptTarget.ESNext, true);
    const placed = typescript.transform(parsed, [context => (sourceFile) => {
        const visit = (node) => {
            if (typescript.isReturnStatement(node)) typescript.addSyntheticLeadingComment(node, typescript.SyntaxKind.SingleLineCommentTrivia,
                ' eslint-disable-next-line resilient/prefer-destructured-member-access -- Get order.', true);

            typescript.forEachChild(node, visit);
        };

        visit(sourceFile);

        return annotateRetainedDynamicMemberAccess({ typescript, sourceFile, context, annotationsOnly: true });
    }]);
    const { transformed: [output = parsed] = [] } = placed;
    const { outputText: code = '' } = typescript.transpileModule(typescript.createPrinter().printFile(output), {
        compilerOptions: { target: typescript.ScriptTarget.ESNext }
    });
    const linter = new Linter();

    assert.deepEqual(linter.verify(code, { plugins: { resilient }, rules: { 'resilient/prefer-destructured-member-access': 'error' } }), []);
    assert.equal(linter.getSuppressedMessages().length, 1);
    placed.dispose();
});
