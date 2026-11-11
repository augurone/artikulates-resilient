import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

import { Linter, ESLint } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptEmitTransformer, createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { getObject } from '../analysis/host/object.js';
import { auditSource } from '../scripts/audit-eslint-exceptions.js';
import { placeEmissionBoundaries, placeInlineEmissionBoundaries } from '../transforms/typescript/grammar/emission-layout.js';
import { annotateFinalExceptions } from '../transforms/typescript/grammar/final.js';
import { formatResilientOutput } from '../transforms/typescript/grammar/resolvers.js';
import { annotateCompletedReturnBoundaries } from '../transforms/typescript/lowering/arity-returns.js';
import { annotateRetainedMutationBoundaries } from '../transforms/typescript/lowering/mutation-boundaries.js';
import { lowerResidualMemberAccess } from '../transforms/typescript/members/residual.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { getRuntimeBindingIdentities } from '../transforms/typescript/policy/dependencies.js';
import { annotateCyclicRuntimeBindingReferences, annotateRetainedStaticMemberAccess, annotateRetainedDynamicMemberAccess, groupNextLineExceptions } from
    '../transforms/typescript/policy/exceptions.js';
import { compilePlacementDecisions, getPlacementContract, getPlacementSymbol } from '../transforms/typescript/policy/placement.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import { collectPlacementEvidence } from '../transforms/typescript/understand/placement-evidence.js';
import { collectRequiredTupleBindingContracts, collectIndexedOperationContracts, collectRuntimeBindingReferenceFacts, getConsumerContractKey } from
    '../transforms/typescript/understand/type-evidence.js';
import { loadModule } from './support/module.js';

const [, authoredFieldSection = ''] = (await readFile(new URL('./fixtures/bad.js', import.meta.url), 'utf8'))
    .split('// Compiler lowering must preserve that unit; other keeps its default finding.\n/*\n');
const [authoredFieldSource = ''] = authoredFieldSection.split('\n*/');
const authoredFieldTyped = authoredFieldSource.replace('read = (', 'read = <T>(')
    .replace('} = {})', '}: {value?: T; other?: T} = {})');

// Authored/generated exceptions must own exactly their semantic units before and after printing/fixing. Preserve active sibling findings, suppression identity, token/runtime behavior and idempotence.

{
    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-directive-ownership-'));
    const examples = {
        authoredFields: authoredFieldTyped,
        authoredSingle: authoredFieldTyped.replace('value,\n    other', 'value').replace('[value, other]', '[value]'),
        authoredWide: authoredFieldTyped.replace('value,\n    other', 'value, other'),
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
        scoped: 'export const select = (inbound: number[], outbound: number[]) => Math.min(inbound.length, outbound.length);',
        retained: 'export const before = (value: number) => later(value); export const later = (value: number) => value;',
        shadowed: "import { read as later } from './provider.js'; export const value = later(1); export function read() { return later(2); function later(value: number) { return value; } }",
        optional: 'export const optional = (values: { value: number }[] | null, index: number) => values?.[index].value;',
        nestedKey: 'export const nestedKey = (values: number[], keys: number[], index: number) => values[keys[index]];',
        afterthought: 'export const afterthought = (values: number[], index: number) => { let ready = true; for (; ready; values[index]++) { ready = false; } return values; };',
        sequenceAfterthought: ['export const sequenceAfterthought = (values: number[], index: number, effect: () => void) => { let ready = true; ',
            'for (; ready; (values[index]++, effect())) { ready = false; } return values; };'].join(''),
        parenthesizedNeighbor: "const outside: number[] = [1]; export function parenthesizedNeighbor(i: number, neighbor: { fixed: number }) { "
            + "const x = (outside[i]), y = neighbor.fixed; return x + y; }",

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
            'export const read = (inbound: number[], i: number) => Math.min(inbound[i], missing);'].join(''),
        authoredUnsupported: ['// eslint-disable-next-line no-undef -- Caller owns original line.\n',
            'export const read = (inbound: number[], outbound: number[], i: number) => Math.min(inbound[i], outbound[i], missing);'].join(''),
        authoredParameter: ['// eslint-disable-next-line no-undef -- Caller owns original line.\n',
            'export const read = (inbound: number[], i: number, other: { value: number }, extra = other.value) => Math.min(inbound[i], missing, extra);'].join(''),
        authoredBare: '// eslint-disable-next-line -- Caller owns original line.\nexport const read = (inbound: number[], i: number) => Math.min(inbound[i], 1);',
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
            'export const nestedRead = (box: { value: number[] }, outbound: number) => box.value[1] !== outbound;'
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

            if (name === 'completedLoopScope') assert.doesNotMatch(code,
                /eslint-disable-next-line resilient\/prefer-safe-transformations, resilient\/prefer-destructured-member-access/u);
        });
        const finalExamples = {
            local: "function probe() { const a = { category: \"Outbound\", outbound: 4 }; const { category: tag = \"\" } = a; if (tag "
                + "=== \"Outbound\") { const { outbound } = a; return outbound; } return 0; }",

            shadow:
            "function probe(a) { { const a = { category: \"Outbound\", outbound: 4 }; const { category: tag = \"\" } = a; if "
                + "(tag === \"Outbound\") { const { outbound } = a; return outbound; } } return 0; }",

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
        const diagnosticIdentities = (text, messages = []) => {
            const tree = typescript.createSourceFile('target.js', text, typescript.ScriptTarget.ESNext, true);
            const scanner = typescript.createScanner(typescript.ScriptTarget.ESNext, true, typescript.LanguageVariant.Standard, text);
            let spans = [];
            // eslint-disable-next-line resilient/prefer-prototype-methods -- The native scanner advances sequentially to assign independent diagnostic token anchors.
            for (let kind = scanner.scan(); kind !== typescript.SyntaxKind.EndOfFileToken; kind = scanner.scan())
                spans = [...spans, { start: scanner.getTokenPos(), end: scanner.getTextPos() }];
            const anchor = (line, column, ending = false) => {
                const offset = tree.getPositionOfLineAndCharacter(line - 1, column - 1);
                const index = spans.findIndex(({ start = 0, end = 0 } = {}) => ending
                    ? start < offset && end >= offset : start <= offset && end > offset);
                const { [index]: { start = offset } = {} } = spans;

                return [index, offset - start];
            };

            return messages.map(({ ruleId = '', messageId = '', message = '', line = 0, column = 0, endLine = 0, endColumn = 0 } = {}) => [
                ruleId, messageId, message, anchor(line, column), endLine ? anchor(endLine, endColumn, true) : false
            ]);
        };
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

            assert.doesNotMatch(code, /eslint-disable-next-line resilient\/(?:prefer-signature-destructuring|prefer-safe-destructuring-defaults)/u);
            assert.deepEqual(suppressed, [], name);
            const sourceFindings = finalLinter.verify(source, finalSettings);
            assert.deepEqual(diagnosticIdentities(code, findings), diagnosticIdentities(source, sourceFindings), name);

            if (name === 'neighbor') assert.match(code, /Authored neighbor remains outside/u);

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
            assert.equal(tupleLinter.getSuppressedMessages().length, { carrier: 3, wrongKey: 3, bare: 2 }[mode]);
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

        const callableSource = 'export function probe(a: { map: (value: number) => number }, b: { value: number }) { return a.map(b.value); }';
        const callableFile = path.join(directory, 'callable-placement.ts');
        await writeFile(callableFile, callableSource);
        const callableProgram = typescript.createProgram([callableFile], { strict: true, noLib: true, target: typescript.ScriptTarget.ESNext });
        const callableTransformer = createTypeScriptTransformer({ typescript, program: callableProgram });
        const callableOutput = callableTransformer.transform({ code: callableSource, fileName: callableFile });
        assert.deepEqual(callableOutput.diagnostics, []);
        assert.match(callableOutput.code, /eslint-disable[^\n]*resilient\/prefer-destructured-member-access[^\n]*declared callable/u);
        const callableLinter = new Linter();
        const callableSettings = { plugins: { resilient }, rules: {
            'resilient/prefer-destructured-member-access': 'error', 'resilient/signature-contract-operation': 'error',
            'func-style': ['error', 'expression']
        } };
        assert.deepEqual(callableLinter.verify(callableOutput.code, callableSettings), []);
        assert.equal(callableLinter.getSuppressedMessages().filter(({ ruleId = '' } = {}) => ruleId === 'resilient/prefer-destructured-member-access').length, 1);
        const callableRuntime = code => JSON.parse(JSON.stringify(runInNewContext(`${code.replace(/\bexport\s+/gu, '')}\n(() => {
        const trace = []; const a = { get map() { trace.push('method'); return function(value) { trace.push(this === a ? 'receiver' : 'wrong'); return value; }; } };
        const b = { get value() { trace.push('argument'); return 7; } };
        const value = probe(a, b); let failure = '';
        try { probe({ get map() { trace.push('missing-method'); return null; } }, b); } catch (error) { failure = error.name; }
        return { trace, value, failure };
    })()`)));
        const { outputText: callableNative = '' } = typescript.transpileModule(callableSource, {
            compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
        });

        assert.deepEqual(callableRuntime(callableOutput.code), callableRuntime(callableNative));
        assert.deepEqual(callableRuntime(callableOutput.code), {
            trace: ['method', 'argument', 'receiver', 'missing-method', 'argument'], value: 7, failure: 'TypeError'
        });
        const wholeExamples = {
            ancestor: 'function probe(a, b) { if (b) { const { outbound = 0 } = a; void outbound; } return a; }',
            ancestorTag: 'function probe(a, b) { if (b) { const { category: tag = "" } = a; void tag; } return a; }',
            ancestorWrong: 'function probe(a, b) { if (b) { const { outbound = 0 } = a; void outbound; } return b; }',
            ancestorShadow: 'function probe(a, b) { if (b) { const { outbound = 0 } = a; void outbound; } { const a = b; return a; } }',
            ancestorClosure: 'function probe(a, b) { if (b) { const { outbound = 0 } = a; void outbound; } return () => a; }',
            ancestorReassigned: 'function probe(a, b) { if (b) { const { outbound = 0 } = a; void outbound; } a = b; return 0; }',
            functionBoundary: 'function probe(a, b) { const run = a => { if (b) { const { outbound = 0 } = a; return outbound; } return 0; }; void run; return a; }',
            forwarded: 'function probe(a, b) { const { category: tag = "" } = a; if (tag === "Inbound") return a; const { outbound = 0 } = a; return outbound; }',
            wrongSymbol: 'function probe(a, b) { const { category: tag = "" } = a; if (tag === "Inbound") return b; const { outbound = 0 } = a; return outbound; }',
            shadowedForward: 'function probe(a, b) { const { category: tag = "" } = a; if (tag === "Inbound") { const a = b; return a; } const { outbound = 0 } = a; return outbound; }',
            reassigned: 'function probe(a, b) { const { category: tag = "" } = a; if (tag === "Inbound") { a = b; return a; } const { outbound = 0 } = a; return outbound; }'
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
            const findings = wholeLinter.verify(code, wholeSettings);
            const suppressed = wholeLinter.getSuppressedMessages();
            const expected = new Map([
                ['ancestor', 0], ['ancestorTag', 0], ['ancestorClosure', 0], ['ancestorReassigned', 0],
                ['ancestorWrong', 0], ['ancestorShadow', 0], ['functionBoundary', 0],
                ['forwarded', 1], ['reassigned', 0], ['wrongSymbol', 2], ['shadowedForward', 2]
            ]).get(name);
            const originalFindings = wholeLinter.verify(source, wholeSettings);
            assert.equal(originalFindings.length, expected, name);
            assert.equal(findings.length, expected, name);
            assert.deepEqual(suppressed, [], name);
            assert.deepEqual(diagnosticIdentities(code, findings), diagnosticIdentities(source, originalFindings), name);
            const evaluate = text => JSON.stringify(runInNewContext(`${text}\n(() => {
            const trace = []; const a = { get category() { trace.push('tag'); return 'Inbound'; } }; const b = { outbound: 4 };
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
        const unresolvedCode = place(unresolved);
        const unresolvedFindings = linter.verify(unresolvedCode, settings);
        assert.equal(unresolvedFindings.every(({ ruleId = '' }) => ruleId === 'resilient/prefer-destructured-member-access'), true,
            'Missing checker binding facts leave member findings visible, rather than inventing module or unresolved binding authority.');
        assert.deepEqual(unresolvedFindings.map(({ line = 0, column = 0, endColumn = 0 } = {}) => unresolvedCode.split('\n').at(line - 1).slice(column - 1, endColumn - 1)),
            ['local[index]', 'values[index]', 'values[index]', 'values[index]', 'rows[index]', 'rows[index]', 'box.value']);
        assert.equal(code.split('prefer-destructuring').length - 1, 3, 'Only direct initializers and assignment chains own the core rule.');
        const unannotated = place(new Map());
        assert.doesNotMatch(unannotated, /eslint-disable/u);
        assert.equal(linter.verify(unannotated, settings).some(({ ruleId = '' }) => ruleId === 'prefer-destructuring'), true);
        const load = text => import(`data:text/javascript,${encodeURIComponent(text)}`);
        const { select = () => 0 } = await load(scoped.code);
        let projectionTrace = [];
        assert.equal(select({ get length() { projectionTrace = [...projectionTrace, 'inbound'];

            return 4; } }, { get length() { projectionTrace = [...projectionTrace, 'outbound'];

            return 2; } }), 2);
        assert.deepEqual(projectionTrace, ['inbound', 'outbound']);
        assert.throws(() => select(null, []), TypeError);
        const original = await load(unannotated);
        const placed = await load(code);
        const observe = ({ nested = () => 0, direct = () => 0, guarded = () => 0, receiver = () => 0, chained = () => [], field = () => [], compare = () => [] }) => {
            let events = [];
            const failure = new Error('getter');
            // eslint-disable-next-line resilient/no-falsifiable-property-key -- This array-like test receiver observes native indexed Get order and failures.
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
        const fieldLinter = new Linter();
        const fieldSettings = { plugins: { resilient }, linterOptions: { reportUnusedDisableDirectives: 'error' },
            rules: { 'resilient/prefer-safe-destructuring-defaults': 'error' } };
        const originalFindings = fieldLinter.verify(authoredFieldSource, fieldSettings);
        const originalSuppressed = fieldLinter.getSuppressedMessages();
        assert.deepEqual(auditSource(authoredFieldSource), []);
        assert.equal(originalFindings.length, 1, 'The unwaived sibling retains its own obligation');
        assert.equal(originalSuppressed.length, 1, 'Only the authored field owns the exception');
        const fields = render('authoredFields');
        assert.deepEqual(fields.diagnostics, []);
        const { output: fixedFields = '' } = fieldLinter.verifyAndFix(fields.code, fieldSettings);
        [fields.code, fixedFields].forEach((code) => {
            assert.deepEqual(auditSource(code), []);
            const findings = fieldLinter.verify(code, fieldSettings);
            const suppressed = fieldLinter.getSuppressedMessages();
            assert.deepEqual(diagnosticIdentities(code, findings), diagnosticIdentities(authoredFieldSource, originalFindings));
            assert.deepEqual(diagnosticIdentities(code, suppressed), diagnosticIdentities(authoredFieldSource, originalSuppressed));
            assert.equal(formatResilientOutput(code, typescript), code);
            const bare = code.replace(/^[ \t]*\/\/ eslint-disable-next-line[^\n]*\n/gmu, '');
            assert.equal(fieldLinter.verify(bare, fieldSettings).length, 2, 'Both fields require their own defaults without the authored exception');
        });
        const singleField = render('authoredSingle');
        assert.deepEqual(singleField.diagnostics, []);
        assert.deepEqual(auditSource(singleField.code), []);
        const production = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
        assert.deepEqual(new Linter().verify(singleField.code, production), [], 'The field-only provider is a clean configured neighbor');
        const { read: readSingle = () => [] } = await load(singleField.code);
        const singlePayload = {};
        assert.equal(readSingle({ value: singlePayload })[0], singlePayload);

        assert.ok(auditSource(render('authoredWide').code).length, 'An already-invalid authored target cannot borrow another field proof');
        const { outputText: unownedFields = '' } = typescript.transpileModule(authoredFieldTyped, {
            compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
        });
        assert.ok(auditSource(formatResilientOutput(unownedFields, typescript)).length, 'Printed text alone cannot establish the original field owner');
        const fieldModules = await Promise.all([authoredFieldSource, fields.code, fixedFields].map(load));
        fieldModules.forEach(({ read = () => [] } = {}) => {
            [0, false, '', {}, runInNewContext('void 0')].forEach((value) => {
                let events = [];
                const result = read({ get value() { events = [...events, 'value'];

                    return value; }, get other() { events = [...events, 'other'];

                    return value; } });
                assert.equal(result.length, 2);
                result.forEach(entry => assert.equal(entry, value));
                assert.deepEqual(events, ['value', 'other']);
            });
            assert.deepEqual(read().map(value => typeof value), ['undefined', 'undefined']);
            assert.throws(() => read(null), TypeError);
            const failure = new Error('authored field Get');
            let reached = false;
            assert.throws(() => read({ get value() { throw failure; }, get other() { reached = true;

                return 1; } }), error => error === failure);
            assert.equal(reached, false);
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
            // eslint-disable-next-line resilient/no-falsifiable-property-key -- This array-like test receiver preserves Get before an unresolved operand fails.
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
        // eslint-disable-next-line resilient/no-falsifiable-property-key -- This array-like test receiver observes native indexed Get and Set ordering.
        const sequenceValues = { get 0() { sequenceEvents = [...sequenceEvents, 'get'];

            return 7; },
        // eslint-disable-next-line resilient/no-falsifiable-property-key -- The index-zero setter records the original indexed update before its following effect.
        set 0(value) { sequenceEvents = [...sequenceEvents, `set:${value}`]; } };
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
            // eslint-disable-next-line resilient/no-falsifiable-property-key -- This array-like test receiver observes optional indexed Get and nested property failures.
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
        { name: 'mixed', code: 'export const invoke = (f: () => number) => later(f()); export const f = () => 9; export const later = (n: number) => n + 1;',
            probe: 'invoke(() => 3)', necessary: true },
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

    // Rule requests follow retained emitted targets, independently of retention.
    {
        const directory = await mkdtemp(path.join(tmpdir(), 'resilient-rule-applicability-'));
        const sources = {
            partition: [
                'export function probe(value: number): boolean;',
                'export function probe(): (value: number) => boolean;',
                'export function probe(value?: number) { if (value === undefined) return (next: number) => probe(next); return true; }'
            ].join('\n'),
            unknown: [
                'export function probe(read: (value: number) => boolean, value: number): boolean;',
                'export function probe(read: (value: number) => boolean): (value: number) => boolean;',
                'export function probe(read: (value: number) => boolean, value?: number) {',
                'if (value === undefined) return (next: number) => probe(read, next); return read(value); }'
            ].join('\n'),
            mutable: [
                'export function probe(read: { equals(value: number): boolean }): { (values: Set<number>): boolean; (): (values: Set<number>) => boolean };',
                'export function probe(read: { equals(value: number): boolean }) { return (values?: Set<number>) => {',
                'if (values === undefined) return (next: Set<number>) => probe(read)(next);',
                'const cursor = values.values(); let entry; let result = false;',
                'while (!result && !(entry = cursor.next()).done) { result = read.equals(entry.value); } return result; }; }'
            ].join('\n'),
            stable: [
                'export function probe(value: number): boolean;',
                'export function probe(): (value: number) => boolean;',
                'export function probe(value?: number) { if (value === undefined) return (next: number) => probe(next);',
                'let result = false; return result; }'
            ].join('\n'),
            localIteration: [
                'export function probe(read: (value: number) => boolean, value: number): boolean;',
                'export function probe(read: (value: number) => boolean): (value: number) => boolean;',
                'export function probe(read: (value: number) => boolean, value?: number) {',
                'if (value === undefined) return (next: number) => probe(read, next);',
                'let result = false; while (!result && value > 0) { result = read(value); value--; } return result; }'
            ].join('\n'),
            fallthrough: 'export const probe = (read: () => number) => (tag: "inbound" | "outbound") => { switch (tag) { case "inbound": return read(); case "outbound": return read(); } };',
            admitted: [
                'export function probe(first: number): (next: number) => number;',
                'export function probe(first: number, second: number): number;',
                'export function probe(first: number, second?: number) { switch (arguments.length) { case 1: return (next: number) => first + next; case 2: return first + second!; } }',
                'export const invoke = () => probe(4);'
            ].join('\n'),
            missing: [
                'export function probe(first: number[]): (next: number[]) => number[];',
                'export function probe(first: number[], second: number[]): number[];',
                'export function probe(first: number[], second?: number[]) { return second === undefined ? (next: number[]) => next.concat(first) : first.concat(second); }',
                'export const invoke = () => probe([4]);'
            ].join('\n'),
            deferred: [
                'type Input = { category: "Inbound"; inbound: number } | { category: "Outbound"; outbound: [number, number] };',
                'export const probe = (f: (value: number) => (next: number) => Promise<number>, input: Input) => {',
                'if (input.category === "Inbound") return Promise.resolve(input);',
                'return f(1)(input.outbound[1]).then(() => input); };'
            ].join('\n')
        };
        const ruleNames = ['resilient/signature-contract-return-consistency', 'consistent-return',
            'resilient/signature-contract-call-site', 'resilient/prefer-signature-destructuring',
            'resilient/prefer-safe-destructuring-defaults'];
        const configuredRules = Object.fromEntries(ruleNames.map(rule => [rule, 'error']));
        const settings = { plugins: { resilient }, rules: configuredRules };
        try {
            await Promise.all(Object.entries(sources).map(([name = '', code = ''] = []) => writeFile(path.join(directory, `${name}.ts`), code)));
            const program = typescript.createProgram(Object.keys(sources).map(name => path.join(directory, `${name}.ts`)), {
                strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext
            });
            const transformer = createTypeScriptTransformer({ typescript, program });
            const lint = new Linter();
            const output = Object.fromEntries(Object.entries(sources).map(([name = '', code = ''] = []) => {
                const { code: output = '', diagnostics = [] } = transformer.transform({ code, fileName: path.join(directory, `${name}.ts`) });
                assert.deepEqual(diagnostics, [], name);

                return [name, output];
            }));
            ['unknown', 'mutable', 'admitted', 'localIteration'].forEach((name) => {
                assert.doesNotMatch(output[name], /eslint-(?:disable|enable)[^\n]*signature-contract-return-consistency/u);
                assert.doesNotMatch(output[name], /eslint-disable-next-line[^\n]*signature-contract-call-site/u);
            });
            assert.match(output.unknown, /Only undefined selects partial application/u);
            assert.match(output.fallthrough, /eslint-disable consistent-return --/u);
            assert.doesNotMatch(output.fallthrough, /signature-contract-return-consistency/u);
            assert.doesNotMatch(output.deferred, /prefer-signature-destructuring/u);
            assert.match(output.deferred, /eslint-disable-next-line resilient\/prefer-safe-destructuring-defaults/u);
            const controls = { partition: 'resilient/signature-contract-return-consistency',
                stable: 'resilient/signature-contract-return-consistency',
                fallthrough: 'consistent-return', missing: 'resilient/signature-contract-call-site',
                deferred: 'resilient/prefer-safe-destructuring-defaults' };
            Object.entries(output).forEach(([name = '', code = ''] = []) => {
                const rules = name === 'missing' || name === 'admitted'
                    ? { 'resilient/signature-contract-call-site': 'error' } : configuredRules;
                const config = { ...settings, rules };
                const measuredRules = name === 'missing' || name === 'admitted'
                    ? ['resilient/signature-contract-call-site'] : ruleNames;
                const measuredFinding = ({ ruleId = '', message = '' } = {}) => measuredRules.includes(ruleId) ||
                    !ruleId && measuredRules.some(rule => message.includes(`'${rule}'`));
                assert.deepEqual(lint.verify(code, config).filter(measuredFinding), [], `${name}: ${code}`);
                const { [name]: control = '' } = controls;

                if (control) {
                    assert.ok(lint.getSuppressedMessages().some(({ ruleId = '' } = {}) => ruleId === control), name);
                    assert.ok(lint.verify(code, { ...config, linterOptions: { noInlineConfig: true } })
                        .some(({ ruleId = '' } = {}) => ruleId === control), name);
                }

                const neighbor = `${code}\nfunction neighbor(flag) { if (flag) return true; return 1; }`;
                assert.equal(lint.verify(neighbor, { ...settings, rules: { 'resilient/signature-contract-return-consistency': 'error' } })
                    .filter(({ ruleId = '', message = '' } = {}) => ruleId === 'resilient/signature-contract-return-consistency' && message.includes('boolean')).length, 2);
            });
            const run = code => runInNewContext(`${code.replace(/\bexport\s+/gu, '')}\n[probe(2), probe()(2)]`);
            const native = typescript.transpile(sources.partition, { target: typescript.ScriptTarget.ESNext });
            assert.equal(JSON.stringify(run(output.partition)), JSON.stringify(run(native)));
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }
}

{
    let directiveProofCases = [];

    const group = (sourceFile, prepare = () => {}, inspect = () => {}) => typescript.transform(sourceFile, [context => (root) => {
        prepare(root);
        const grouped = groupNextLineExceptions({ typescript, sourceFile: root, context });

        inspect(root, grouped, context);

        return grouped;
    }]);
    const print = sourceFile => typescript.createPrinter().printFile(sourceFile);
    const nextLine = (node, rules, reason) => typescript.addSyntheticLeadingComment(
        node, typescript.SyntaxKind.SingleLineCommentTrivia, ` eslint-disable-next-line ${rules} -- ${reason}`, true
    );
    const groupingSource = typescript.createSourceFile('grouping.js', [
        'alert(console.log("before"));',
        'alert(console.log("target"));',
        'alert(console.log("after"));'
    ].join('\n'), typescript.ScriptTarget.ESNext, true, typescript.ScriptKind.JS);
    const groupedResult = group(groupingSource, ({ statements: { 1: target = {} } = {} } = {}) => {
        nextLine(target, 'no-alert', 'Native alert timing.');
        nextLine(target, 'no-console, no-alert', 'Native alert and console timing.');
        nextLine(target, 'no-alert', 'Native alert timing.');
    }, (original, grouped, context) => {
        const { statements: { 1: target = {} } = {} } = original;

        assert.equal(typescript.getSyntheticLeadingComments(target).length, 3, 'The caller-owned comment array remains intact.');
        const withoutComments = typescript.createPrinter({ removeComments: true });

        assert.equal(withoutComments.printFile(grouped), withoutComments.printFile(original), 'Executable tokens are unchanged.');
        const regrouped = groupNextLineExceptions({ typescript, sourceFile: grouped, context });

        assert.equal(print(regrouped), print(grouped), 'Grouping is idempotent.');
    });
    const { transformed: { 0: groupedSource = {} } = {} } = groupedResult;
    const groupedCode = print(groupedSource);
    assert.match(groupedCode, /\/\/ no-console, no-alert -- Native alert and console timing\.\n\/\/ eslint-disable-next-line no-alert, no-console -- Native alert timing\.\nalert/u);
    groupedResult.dispose();
    const groupingLinter = new Linter();
    const groupingSettings = { linterOptions: { reportUnusedDisableDirectives: 'error' }, rules: { 'no-alert': 'error', 'no-console': 'error' } };
    [groupedCode, formatResilientOutput(groupedCode, typescript)].forEach((code) => {
        const messages = groupingLinter.verify(code, groupingSettings);
        const suppressed = groupingLinter.getSuppressedMessages();
        assert.equal(messages.length, 4, JSON.stringify(messages));
        assert.equal(messages.every(({ line = 0 }) => /before|after/u.test(code.split('\n').at(line - 1))), true);
        assert.deepEqual(suppressed.map(({ ruleId = '' }) => ruleId).toSorted(), ['no-alert', 'no-console']);
        assert.equal(suppressed.every(({ line = 0 }) => code.split('\n').at(line - 1).includes('target')), true);
        const unannotated = code.replace(/^\s*\/\/ eslint-disable-next-line[^\n]*\n/gmu, '');
        assert.equal(groupingLinter.verify(unannotated, groupingSettings).length, 6, 'Combined necessary target findings reappear.');
    });
    // A single unused rule remains visible: grouping cannot launder unnecessary
    // exceptions, absorb authored trivia, or widen a paired block boundary.
    [' authored note', ' eslint-disable no-alert -- Scoped owner. ', ' eslint-disable-next-line -- Bare boundary.'].forEach((separator) => {
        const tree = typescript.createSourceFile('separate.js', 'alert(console.log("target"));', 99, true);
        let before = '';
        const result = group(tree, (root) => {
            const { statements: { 0: target = {} } = {} } = root;

            nextLine(target, 'no-alert', 'First owner.');
            const kind = separator.includes('Scoped') ? typescript.SyntaxKind.MultiLineCommentTrivia : typescript.SyntaxKind.SingleLineCommentTrivia;

            typescript.addSyntheticLeadingComment(target, kind, separator, true);
            nextLine(target, 'no-console', 'Second owner.');
            before = print(root);
        });

        const { transformed: { 0: output = {} } = {} } = result;

        assert.equal(print(output), before);
        result.dispose();
    });
    const authoredTree = typescript.createSourceFile('authored.js', '// eslint-disable-next-line no-alert -- Authored owner.\nalert(console.log("target"));', 99, true);
    const authoredGrouped = group(authoredTree, ({ statements: { 0: target = {} } = {} } = {}) => {
        nextLine(target, 'no-console', 'Generated owner.');
    });
    const authoredOutput = formatResilientOutput(print(authoredGrouped.transformed[0]), typescript, authoredGrouped.transformed[0]);
    assert.ok(authoredOutput.includes('// eslint-disable-next-line no-alert -- Authored owner.'));
    assert.deepEqual(groupingLinter.verify(authoredOutput, groupingSettings), [], authoredOutput);
    assert.deepEqual(groupingLinter.getSuppressedMessages().map(({ ruleId = '' }) => ruleId).toSorted(), ['no-alert', 'no-console']);
    authoredGrouped.dispose();
    const separateReasons = group(groupingSource, ({ statements: { 1: target = {} } = {} } = {}) => {
        nextLine(target, 'no-alert', 'Alert timing.');
        nextLine(target, 'no-console', 'Console timing.');
    });
    const { transformed: { 0: joinedReasons = {} } = {} } = separateReasons;
    assert.match(print(joinedReasons), /\/\/ no-alert -- Alert timing\.\n\/\/ eslint-disable-next-line no-alert, no-console -- Console timing\.\nalert/u);
    separateReasons.dispose();
    const unnecessary = groupedCode.replace('no-alert, no-console --', 'no-alert, no-console, no-debugger --');
    assert.equal(groupingLinter.verify(unnecessary, { ...groupingSettings, rules: { ...groupingSettings.rules, 'no-debugger': 'error' } })
        .filter(({ ruleId = '' }) => ruleId === null).length, 1, 'Unused members remain proof failures.');
    const { rules: { 'max-len': groupedLengthRule = [] } = {} } = await new ESLint().calculateConfigForFile('directive-length-proof.js');
    assert.deepEqual(groupedLengthRule, resilient.configs.recommended.rules['max-len'].map((value, index) => index === 0 ? 2 : value),
        'Repository and consumer profiles share the grouped-directive length exception.');
    const lengthSettings = { ...groupingSettings, rules: { ...groupingSettings.rules, 'max-len': groupedLengthRule } };
    const longReason = 'Native alert and console timing. '.repeat(10);
    assert.deepEqual(groupingLinter.verify(`// eslint-disable-next-line no-alert, no-console -- ${longReason}\nalert(console.log("target"));`, lengthSettings), []);
    [
        `// Ordinary explanation ${longReason}`,
        `const value = "${longReason}";`,
        `const value = 0; // eslint-disable-next-line no-alert, no-console -- ${longReason}\nalert(console.log("target"));`,
        `// eslint-disable-next-line no-alert -- ${longReason}\nalert("target");`,
        `// eslint-disable-next-line no-alert, no-console ${longReason}\nalert(console.log("target"));`
    ].forEach((code) => {
        assert.equal(groupingLinter.verify(code, lengthSettings).filter(({ ruleId = '' }) => ruleId === 'max-len').length, 1, code);
    });

    const directory = await mkdtemp(path.join(tmpdir(), 'resilient-directive-ownership-'));
    const examples = {
        computedProperty: 'export const record = (keys: PropertyKey[], args: number[], i: number) => ({ [keys[i]]: args[i], after: 1 });',
        restGrouped: 'export const ordered = (f: (a: number, b: number) => number) => (...args: number[]) => { if (args.length > 1) return f(args[1], args[0]); return 0; };',
        groupedTuple: [
            'type Selection = { category: "Missing" } | { category: "Available"; value: [number, string] };',
            'export const replace = (found: Selection, source: Map<number, string>, next: string) => {',
            'if (found.category === "Available") { const out = new Map(source); out.set(found.value[0], next); return out; }',
            'return source; };'
        ].join(' '),
        providerIndexed: [
            'export const project = (providers: { add: (x: any, y: any) => any }[], inbound: any[], outbound: any[]) =>',
            'providers.map((provider, i) => provider.add(inbound[i], outbound[i]));'
        ].join(' '),
        blockIndexed: 'export function read(a: number[], b: number[], i: number) { return Math.min(a[i], b[i]); }',
        mixed: 'export const merge = (a: number[], b: number[], i: number, choose: boolean) => choose ? Math.min(a[i], b[i]) : b[i];',
        indexedCallee: 'export const combine = (groups: { concat: (a: number, b: number) => number }[], a: number[], b: number[], i: number) => groups[i].concat(a[i], b[i]);',
        unrelated: [
            'export const forever = () => {',
            '// eslint-disable-next-line no-constant-condition -- Unrelated source boundary.',
            'while (true) return 1;',
            '};',
            'export const drop = (n: number) => (as: number[]) => { if (n <= 0) return as; return n >= as.length ? [] : as.slice(n, as.length); };',
            'export const equal = (xs: number[], ys: number[]) => xs.length === ys.length && xs.every((x, i) => Math.min(x, ys[i]));'
        ].join('\n'),
        slice: 'export const drop = (n: number) => (as: number[]) => { if (n <= 0) return as; return n >= as.length ? [] : as.slice(n, as.length); };',
        chained: "export const compare = (...tests: { equals: (a: number, b: number) => boolean }[]) => (first: number[], "
            + "second: number[]) => tests.every((test, i) => test.equals(first[i], second[i]));",

        following: 'export const read = (inbound: number[]) => Math.min(inbound.length, Math.random());',
        tail: 'export const read = (inbound: number[]) => Math.min(inbound.length) + Math.random();',
        authoredExtractor: '// eslint-disable-next-line no-undef -- Host source line.\nexport const read = (inbound: number[]) => Math.min(inbound.length);',
        indexed: 'export const selectIndexed = (inbound: number[], outbound: number[], i: number) => Math.min(inbound[i], outbound[i]);',
        rejected: 'export const complex = (inbound: number[], key: () => number) => Math.min(inbound[key()], 1);',
        authored: '/* eslint-disable resilient/prefer-destructured-member-access -- Caller owns this scope. */\nexport const authored = (inbound: number[], i: number) => Math.min(inbound[i], 1);',
        mutation: [
            'export const append = (outer: { map: (f: (box: { values: number[] }) => unknown) => unknown },',
            'inner: { map: (f: (item: number[]) => unknown) => unknown }) => outer.map(box => inner.map(item => { box.values.push(item.length); return box; }));'
        ].join(' '),
        parameterPropertyCollision: [
            'export class Native { constructor(public field: number) {',
            '// eslint-disable-next-line no-undef -- authored host',
            'console.log("target"); // trailing note',
            '} }'
        ].join('\n'),
        erasedCollision: [
            '/* eslint-disable-next-line no-console --',
            'Authored console call owns observable I/O at invocation.',
            '*/',
            '// eslint-disable-next-line no-undef -- authored host',
            'interface Gone {}',
            '// eslint-disable-next-line no-undef -- authored host',
            'console.log("target"); // trailing note'
        ].join('\n'),
        provider: 'export const read = (value: number) => value;',

        scoped: 'export const select = (inbound: number[], outbound: number[]) => Math.min(inbound.length, outbound.length);',
        retained: 'export const before = (value: number) => later(value); export const later = (value: number) => value;',
        shadowed: "import { read as later } from './provider.js'; export const value = later(1); export function read() { return later(2); function later(value: number) { return value; } }"
    };
    try {
        await Promise.all(Object.entries(examples).map(([name = '', code = '']) => writeFile(path.join(directory, `${name}.ts`), code)));
        const program = typescript.createProgram(Object.keys(examples).map(name => path.join(directory, `${name}.ts`)), {
            strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext
        });
        const transformer = createTypeScriptTransformer({ typescript, program });
        const render = name => transformer.transform({ code: examples[name], fileName: path.join(directory, `${name}.ts`) });
        const emit = createTypeScriptEmitTransformer({ typescript, program });
        const retainedFile = path.join(directory, 'retained.ts');
        const { diagnostics: preparedDiagnostics = [], results = [] } = emit.prepare({ fileNames: [retainedFile] });
        assert.deepEqual(preparedDiagnostics, []);
        const [{ code: preparedCode = '' } = {}] = results;
        assert.equal(emit.before()(program.getSourceFile(retainedFile)).getFullText(), preparedCode);
        ['parameterPropertyCollision', 'erasedCollision'].forEach((name) => {
            const { code = '', diagnostics: collisionDiagnostics = [] } = render(name);
            assert.deepEqual(collisionDiagnostics, []);
            const findings = groupingLinter.verify(code, { rules: { 'no-console': 'error', 'no-undef': 'error' } });
            assert.equal(findings.filter(({ ruleId = '' }) => ruleId === 'no-console').length, 0, code);
            assert.equal(groupingLinter.getSuppressedMessages().filter(({ ruleId = '' }) => ruleId === 'no-console').length, 1, code);
            assert.ok(code.includes('// trailing note'));
            assert.equal(formatResilientOutput(code, typescript), code);
        });
        const scoped = render('scoped');
        assert.match(scoped.code, /eslint-disable resilient\/prefer-safe-destructuring-defaults -- Argument Get/u);
        assert.match(scoped.code, /eslint-enable resilient\/prefer-safe-destructuring-defaults/u);
        const retained = render('retained');
        const shadowed = render('shadowed');
        assert.match(retained.code, /eslint-disable no-use-before-define/u);
        assert.match(retained.code, /eslint-enable no-use-before-define/u);
        assert.match(shadowed.code, /eslint-disable.*no-use-before-define/u, 'A same-named import cannot erase a local source-lifetime fact.');
        const linter = new Linter();
        const restGrouped = render('restGrouped');
        const restSettings = { plugins: { resilient }, linterOptions: { reportUnusedDisableDirectives: 'error' }, rules: {
            'resilient/prefer-signature-destructuring': 'error',
            'resilient/prefer-safe-destructuring-defaults': 'error',
            'resilient/signature-contract-destructuring': 'error',
            'resilient/no-undefined-assignment': 'error'
        } };
        assert.deepEqual(restGrouped.diagnostics, []);
        const restMessages = linter.verify(restGrouped.code, restSettings);
        assert.deepEqual(restMessages, []);
        assert.deepEqual(linter.getSuppressedMessages().map(({ ruleId = '' } = {}) => ruleId), ['resilient/no-undefined-assignment', 'resilient/no-undefined-assignment']);
        const bareRest = restGrouped.code.replace(/^\s*\/\/ eslint-disable-next-line[^\n]*\n/gmu, '');
        assert.deepEqual(linter.verify(bareRest, restSettings).map(({ ruleId = '' } = {}) => ruleId), ['resilient/no-undefined-assignment', 'resilient/no-undefined-assignment'],
            'Completed rest selection needs only its exact-absence exception; no shape or default obligation is waived.');
        // Fresh rest positions already own exact defaults.
        directiveProofCases = [...directiveProofCases, restGrouped.code];
        const groupedTuple = render('groupedTuple');
        assert.deepEqual(groupedTuple.diagnostics, []);
        assert.match(groupedTuple.code, /eslint-disable-next-line resilient\/prefer-safe-destructuring-defaults --/u);
        assert.match(groupedTuple.code, /static tuple position[\s\S]*?const \{ value:/u);
        assert.doesNotMatch(groupedTuple.code, /\/\/ eslint-disable-next-line[^\n]*\n\s*\/\/ eslint-disable-next-line/u);
        directiveProofCases = [...directiveProofCases, groupedTuple.code];
        assert.deepEqual(linter.verify(scoped.code, { plugins: { resilient }, rules: {
            'resilient/prefer-safe-destructuring-defaults': 'error', indent: ['error', 4, { SwitchCase: 1 }]
        } }), []);
        [retained, shadowed].forEach(({ code = '' }) => {
            const findings = linter.verify(code, { rules: { 'no-use-before-define': 'error' } });
            assert.equal(findings.filter(({ ruleId = '' }) => ruleId === 'no-use-before-define').length, 0, JSON.stringify(findings));
        });

        const sourceFile = program.getSourceFile(path.join(directory, 'scoped.ts'));
        const placement = compilePlacementDecisions({ typescript, evidence: collectPlacementEvidence({
            typescript, sourceFile, checker: program.getTypeChecker()
        }) });
        const placed = typescript.transform(sourceFile, [context => root => lowerResidualMemberAccess({
            typescript, sourceFile: root, placement, context
        })]);
        const { transformed: [direct = sourceFile] = [] } = placed;
        const { outputText: directlyPlaced = '' } = typescript.transpileModule(typescript.createPrinter().printFile(direct), {
            compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
        });
        placed.dispose();
        const rule = 'resilient/prefer-safe-destructuring-defaults';
        const settings = { plugins: { resilient }, rules: { [rule]: 'error' } };
        [directlyPlaced, scoped.code].forEach((body) => {
            const neighbors = [
                'export const beforeNeighbor = ({ before }) => before;',
                body,
                'export const afterNeighbor = ({ after }) => after;',
                ''
            ].join('\n');
            [neighbors, formatResilientOutput(neighbors, typescript)].forEach((code) => {
                const raw = linter.verify(code, settings);
                const suppressed = linter.getSuppressedMessages();
                assert.equal(raw.length, 2, JSON.stringify(raw));
                assert.equal(suppressed.length, 2, JSON.stringify(suppressed));
                assert.equal([...raw, ...suppressed].every(({ ruleId = '' }) => ruleId === rule), true);
                const lines = code.split('\n');
                assert.equal(raw.every(({ line = 0 }) => /Neighbor/u.test(lines.at(line - 1))), true, 'Combined neighboring boundaries stay visible.');
                assert.equal(suppressed.every(({ line = 0 }) => /(?:inbound|outbound)Length/u.test(lines.at(line - 1))), true, 'Each pair owns only its argument extractor.');
                const unannotated = code.replace(/\/\* eslint-(?:disable|enable) resilient\/prefer-safe-destructuring-defaults[^*]*\*\//gu, '');
                assert.equal(linter.verify(unannotated, settings).length, 4, 'Combined required targets reappear without their boundaries.');
                directiveProofCases = [...directiveProofCases, code];
            });
        });
        directiveProofCases = [...directiveProofCases, scoped.code, retained.code, shadowed.code];

        const load = text => import(`data:text/javascript,${encodeURIComponent(text)}`);
        const { select = () => 0 } = await load(scoped.code);
        let projectionTrace = [];
        assert.equal(select({ get length() { projectionTrace = [...projectionTrace, 'inbound'];

            return 4; } }, { get length() { projectionTrace = [...projectionTrace, 'outbound'];

            return 2; } }), 2);
        assert.deepEqual(projectionTrace, ['inbound', 'outbound']);
        assert.throws(() => select(null, []), TypeError);
        const { select: originalSelect = () => 0 } = await load(typescript.transpileModule(examples.scoped, {
            compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
        }).outputText);
        const { select: directSelect = () => 0 } = await load(directlyPlaced);
        const minDescriptor = Object.getOwnPropertyDescriptor(Math, 'min');
        const failure = {};
        const observe = (invoke, phase) => {
            let events = [];
            const argument = name => ({ get length() {
                events = [...events, name];

                if (phase === name) throw failure;

                return name === 'inbound' ? 4 : 2;
            } });
            Object.defineProperty(Math, 'min', { configurable: true, get() {
                events = [...events, 'callee'];

                if (phase === 'callee') throw failure;

                // eslint-disable-next-line no-restricted-syntax -- The retained Math method oracle checks the native receiver after argument evaluation.
                return function (...values) {
                    events = [...events, 'call'];
                    assert.equal(this, Math);

                    if (phase === 'call') throw failure;

                    return values;
                };
            } });
            try {
                return { result: invoke(phase === 'null' ? null : argument('inbound'), argument('outbound')), events };
            } catch (error) {
                return { exactFailure: error === failure, nativeFailure: error instanceof TypeError, events };
            } finally {
                Object.defineProperty(Math, 'min', minDescriptor);
            }
        };
        ['normal', 'callee', 'inbound', 'outbound', 'call', 'null'].forEach((phase) => {
            assert.deepEqual(observe(select, phase), observe(originalSelect, phase), phase);
            assert.deepEqual(observe(directSelect, phase), observe(originalSelect, phase), phase);
        });
        // The completed source read owns the value and native failure; placement
        // changes only parentheses/comments, never key conversion or evaluation.
        const memberRule = 'resilient/prefer-destructured-member-access';
        const mutationRule = 'resilient/prefer-safe-transformations';
        const indexedSource = program.getSourceFile(path.join(directory, 'indexed.ts'));
        const indexedDecisions = compileDestructuringDecisions(collectDestructuringAgreements({
            typescript, indexedOperationContracts: collectIndexedOperationContracts({
                typescript, sourceFile: indexedSource, checker: program.getTypeChecker()
            })
        }));
        const indexedPlaced = typescript.transform(indexedSource, [context => root => annotateRetainedDynamicMemberAccess({
            typescript, sourceFile: root, destructuringAgreements: indexedDecisions, context
        })]);
        const { outputText: directIndexed = '' } = typescript.transpileModule(typescript.createPrinter().printFile(indexedPlaced.transformed[0]), {
            compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
        });
        indexedPlaced.dispose();
        const { code: indexed = '' } = render('indexed');
        const placementSettings = { plugins: { resilient }, rules: {
            [memberRule]: 'error', [mutationRule]: 'error', [rule]: 'error',
            'max-len': ['error', { code: 200 }], indent: ['error', 4, { SwitchCase: 1 }]
        } };
        const { code: computedProperty = '', diagnostics: propertyDiagnostics = [] } = render('computedProperty');
        const computedSettings = { ...placementSettings, rules: { ...placementSettings.rules,
            'comma-style': ['error', 'last'], 'comma-dangle': ['error', 'never'] } };
        assert.deepEqual(propertyDiagnostics, []);
        assert.equal(formatResilientOutput(computedProperty, typescript), computedProperty);
        assert.deepEqual(linter.verify(computedProperty, computedSettings), [], computedProperty);
        assert.equal(linter.getSuppressedMessages().filter(({ ruleId = '' }) => ruleId === memberRule).length, 2);
        assert.equal(linter.verifyAndFix(computedProperty, computedSettings).fixed, false,
            'The completed computed property requires no indentation or comma repair.');
        const propertyNeighbor = computedProperty.replace('(keys, args, i)', '(keys, args, i, host)')
            .replace('after: 1', 'neighbor: host.value');
        assert.notEqual(propertyNeighbor, computedProperty);
        const neighborOutput = formatResilientOutput(propertyNeighbor, typescript);
        const propertyFindings = linter.verify(neighborOutput, computedSettings);
        assert.equal(propertyFindings.length, 1, JSON.stringify({ neighborOutput, propertyFindings }));
        assert.equal(propertyFindings[0].ruleId, memberRule);
        assert.match(neighborOutput.split('\n').at(propertyFindings[0].line - 1), /host\.value/u);
        const propertyDirectives = [...computedProperty.matchAll(/^\s*\/\/ eslint-disable-next-line resilient\/prefer-destructured-member-access[^\n]*\n/gmu)];
        assert.equal(propertyDirectives.length, 2);
        propertyDirectives.forEach(({ index = 0, 0: directive = '' }) => {
            const removed = computedProperty.slice(0, index) + computedProperty.slice(index + directive.length);
            const findings = linter.verify(removed, computedSettings);
            const [{ ruleId: exposedRule = '' } = {}] = findings;
            assert.equal(findings.length, 1, JSON.stringify(findings));
            assert.equal(exposedRule, memberRule);
        });
        const { record: placedRecord = () => ({}) } = await load(computedProperty);
        const { record: originalRecord = () => ({}) } = await load(typescript.transpileModule(examples.computedProperty, {
            compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
        }).outputText);
        const observeProperty = (invoke, phase) => {
            let events = [];
            const failure = {};
            // eslint-disable-next-line resilient/no-falsifiable-property-key -- This array-like key source records indexed Get before ToPropertyKey.
            const keys = { get 0() {
                events = [...events, 'key Get'];

                if (phase === 'key') throw failure;

                return { [Symbol.toPrimitive]() {
                    events = [...events, 'ToPropertyKey'];

                    if (phase === 'convert') throw failure;

                    return 'selected';
                } };
            } };
            // eslint-disable-next-line resilient/no-falsifiable-property-key -- This array-like value source records indexed Get after key conversion.
            const args = { get 0() {
                events = [...events, 'value Get'];

                if (phase === 'value') throw failure;

                return 7;
            } };
            try {
                return { value: invoke(phase === 'null' ? null : keys, args, 0), events };
            } catch (error) {
                return { exactFailure: error === failure, nativeFailure: error instanceof TypeError, events };
            }
        };
        ['normal', 'key', 'convert', 'value', 'null'].forEach((phase) => {
            assert.deepEqual(observeProperty(placedRecord, phase), observeProperty(originalRecord, phase), phase);
        });
        directiveProofCases = [...directiveProofCases, computedProperty, neighborOutput];
        [directIndexed, indexed].forEach((body) => {
            const neighbors = body.replace('(inbound, outbound, i)', '(inbound, outbound, i, before, after)').replace('Math.min(', 'Math.min(before.value, ').replace(/\);/u, ', after.value);');
            const output = formatResilientOutput(neighbors, typescript);
            [output, linter.verifyAndFix(output, placementSettings).output].forEach((code) => {
                const raw = linter.verify(code, placementSettings);
                const suppressed = linter.getSuppressedMessages();
                assert.equal(raw.length, 2, JSON.stringify({ code, raw }));
                assert.equal(suppressed.length, 2, JSON.stringify(suppressed));
                assert.ok(raw.every(({ ruleId = '' }) => ruleId === memberRule));
                assert.ok(suppressed.every(({ ruleId = '' }) => ruleId === memberRule));
                assert.ok(raw.every(({ line = 0 }) => /(?:before|after)\.value/u.test(code.split('\n').at(line - 1))));
                const unannotated = code.replace(/^\s*\/\/ eslint-disable-next-line resilient\/prefer-destructured-member-access[^\n]*\n/gmu, '');
                assert.equal(linter.verify(unannotated, { plugins: { resilient }, rules: { [memberRule]: 'error' } }).length, 4);
                directiveProofCases = [...directiveProofCases, code];
            });
            assert.equal(formatResilientOutput(output, typescript), output);
        });
        ['rejected', 'authored'].forEach((name) => {
            const { code = '', diagnostics: rejectedDiagnostics = [] } = render(name);
            assert.deepEqual(rejectedDiagnostics, []);
            assert.doesNotMatch(code, /eslint-disable-line resilient\/prefer-destructured-member-access/u);
            assert.doesNotMatch(code, /eslint-enable resilient\/prefer-destructured-member-access/u,
                'The retained computed key and authored scope must not acquire an inner enable.');
            assert.equal((code.match(/eslint-disable-next-line resilient\/prefer-destructured-member-access/gu) || []).length,
                name === 'authored' ? 0 : 1, 'An authored block already owns the necessary read.');
            directiveProofCases = [...directiveProofCases, code];
        });
        ['following', 'tail', 'authoredExtractor'].forEach((name) => {
            const input = program.getSourceFile(path.join(directory, `${name}.ts`));
            const selectedPlacement = compilePlacementDecisions({ typescript, evidence: collectPlacementEvidence({
                typescript, sourceFile: input, checker: program.getTypeChecker()
            }) });
            const result = typescript.transform(input, [context => root => lowerResidualMemberAccess({
                typescript, sourceFile: root, placement: selectedPlacement, context
            })]);
            const { transformed: [placedRoot = input] = [] } = result;
            const printed = typescript.createPrinter().printFile(placedRoot);
            result.dispose();
            assert.match(printed, /Argument Get keeps source timing and failure\. \*\//u,
                'A following operation or authored directive rejects the new multiline placement.');
        });
        const ambientSource = typescript.createSourceFile('ambient.ts', examples.indexed, typescript.ScriptTarget.ESNext, true);
        const ambient = typescript.transform(ambientSource, [context => (root) => {
            const { statements: [statement = {}] = [] } = root;
            const ambientStatement = typescript.addSyntheticLeadingComment(statement, typescript.SyntaxKind.MultiLineCommentTrivia,
                ' eslint-disable resilient/prefer-destructured-member-access -- Enclosing completed boundary. ', true);

            return annotateRetainedDynamicMemberAccess({
                typescript, sourceFile: typescript.factory.updateSourceFile(root, [ambientStatement]),
                destructuringAgreements: indexedDecisions, context
            });
        }]);
        const ambientText = typescript.createPrinter().printFile(ambient.transformed[0]);
        ambient.dispose();
        assert.doesNotMatch(ambientText, /eslint-disable-(?:next-)?line resilient\/prefer-destructured-member-access/u);
        assert.doesNotMatch(ambientText, /eslint-enable resilient\/prefer-destructured-member-access/u,
            'An inherited generated block must not be canceled by an inner enable.');
        ['mixed', 'indexedCallee', 'blockIndexed', 'providerIndexed'].forEach((name) => {
            const { code = '', diagnostics: mixedDiagnostics = [] } = render(name);
            assert.deepEqual(mixedDiagnostics, []);
            assert.match(code, /eslint-disable-next-line resilient\/prefer-destructured-member-access/u);
            assert.doesNotMatch(code, /eslint-enable resilient\/prefer-destructured-member-access/u,
                'Distinct indexed reads retain separate necessary next-line owners.');
            directiveProofCases = [...directiveProofCases, code];
        });
        const { code: providerIndexed = '' } = render('providerIndexed');
        assert.match(providerIndexed, /eslint-disable-next-line resilient\/prefer-safe-transformations/u);
        assert.deepEqual(linter.verify(providerIndexed, placementSettings).filter(({ ruleId = '' }) => ruleId === 'indent'), []);
        const { output: providerFixed = '' } = linter.verifyAndFix(providerIndexed, placementSettings);
        assert.deepEqual(linter.verify(providerFixed, placementSettings).filter(({ severity = 0 }) => severity === 2), []);
        directiveProofCases = [...directiveProofCases, providerFixed];
        const { code: unrelated = '' } = render('unrelated');
        assert.doesNotMatch(unrelated, /Argument Get keeps source timing and failure\.\n/u);
        assert.match(unrelated, /as\.slice\(n, as\.length\)/u,
            'The conditional call retains its native callee, receiver and argument operations.');
        assert.match(unrelated, /eslint-disable-next-line resilient\/prefer-destructured-member-access -- Get order/u,
            'An unrelated line directive must not block a different source unit.');
        const { output: unrelatedFixed = '' } = linter.verifyAndFix(unrelated, placementSettings);
        assert.deepEqual(linter.verify(unrelatedFixed, placementSettings).filter(({ severity = 0 }) => severity === 2), []);
        directiveProofCases = [...directiveProofCases, unrelated, unrelatedFixed];
        const { outputText: referenceUnrelated = '' } = typescript.transpileModule(examples.unrelated, {
            compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
        });
        const dropFunctions = await Promise.all([referenceUnrelated, unrelated, unrelatedFixed].map(async code => (await load(code)).drop));
        const observeDrop = (invoke, phase) => {
            let events = [];
            const values = [1, 2, 3];
            const receiver = new Proxy(values, { get(target, key, actualReceiver) {
                if (key === 'length') events = [...events, `length:${target.length}`];

                return Reflect.get(target, key, actualReceiver);
            } });
            /* eslint-disable resilient/signature-contract-return-consistency -- The authored callee getter deliberately alternates a callable and a noncallable to prove the native failure phase. */
            Object.defineProperty(values, 'slice', { get() {
                events = [...events, 'callee'];
                // eslint-disable-next-line resilient/prefer-safe-transformations -- The authored callee getter changes the real array length before the following argument Get.
                values.length = 1;

                if (phase === 'callee') throw failure;

                if (phase === 'noncallable') return 0;

                // eslint-disable-next-line no-restricted-syntax -- The callable alternative must observe the receiver selected before the guarded invocation.
                return function (...arguments_) {
                    events = [...events, 'call'];
                    assert.equal(this, receiver);

                    if (phase === 'call') throw failure;

                    return arguments_;
                };
            } });
            /* eslint-enable resilient/signature-contract-return-consistency */
            try {
                return { result: invoke(1)(phase === 'null' ? null : receiver), events };
            } catch (error) {
                return { exactFailure: error === failure, nativeFailure: error instanceof TypeError, events };
            }
        };
        const [referenceDrop = () => 0] = dropFunctions;
        assert.deepEqual(observeDrop(referenceDrop, 'normal'), {
            result: [1, 1], events: ['length:3', 'callee', 'length:1', 'call']
        });
        ['normal', 'callee', 'noncallable', 'call', 'null'].forEach((phase) => {
            dropFunctions.slice(1).forEach(invoke => assert.deepEqual(observeDrop(invoke, phase), observeDrop(referenceDrop, phase), phase));
        });
        const { code: mutation = '' } = render('mutation');
        assert.match(mutation, /eslint-disable-next-line resilient\/prefer-safe-transformations/u);
        assert.match(mutation, /eslint-disable resilient\/prefer-safe-destructuring-defaults/u);
        const mutationNeighbor = mutation.replace('return box;', 'neighbor.push(1);\n    return box;');
        assert.notEqual(mutationNeighbor, mutation);
        [mutation, mutationNeighbor].forEach((code, index) => {
            const formattedCode = formatResilientOutput(code, typescript);
            [formattedCode, linter.verifyAndFix(formattedCode, placementSettings).output].forEach((output) => {
                const raw = linter.verify(output, placementSettings);
                const suppressed = linter.getSuppressedMessages();
                assert.equal(raw.length, index, JSON.stringify({ output, raw }));
                assert.equal(suppressed.filter(({ ruleId = '' }) => ruleId === mutationRule).length, 1);
                assert.equal(suppressed.filter(({ ruleId = '' }) => ruleId === rule).length, 1);
                assert.ok(raw.every(({ line = 0 }) => output.split('\n').at(line - 1).includes('neighbor.push')));
                directiveProofCases = [...directiveProofCases, output];
            });
        });
        ['slice', 'chained'].forEach((name) => {
            const { code = '', diagnostics: shapeDiagnostics = [] } = render(name);
            assert.deepEqual(shapeDiagnostics, []);
            [code, linter.verifyAndFix(code, placementSettings).output].forEach((output) => {
                assert.deepEqual(linter.verify(output, placementSettings).filter(({ severity = 0 }) => severity === 2), [], output);
                directiveProofCases = [...directiveProofCases, output];
            });
        });
        const { outputText: referenceIndexed = '' } = typescript.transpileModule(examples.indexed, {
            compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
        });
        const indexedFunctions = await Promise.all([referenceIndexed, directIndexed, indexed,
            linter.verifyAndFix(indexed, placementSettings).output].map(async code => (await load(code)).selectIndexed));
        const observeIndexed = (invoke, phase) => {
            let events = [];
            let conversions = 0;
            const value = {};
            const key = { [Symbol.toPrimitive]() {
                conversions += 1;
                events = [...events, `key${conversions}`];

                if (phase === `key${conversions}`) throw failure;

                return 0;
            } };
            // eslint-disable-next-line resilient/no-falsifiable-property-key -- This array-like argument records indexed Get order across computed projections.
            const argument = name => ({ get 0() {
                events = [...events, name];

                if (phase === name) throw failure;

                return value;
            } });
            Object.defineProperty(Math, 'min', { configurable: true, get() {
                events = [...events, 'callee'];

                if (phase === 'callee') throw failure;

                // eslint-disable-next-line no-restricted-syntax -- The Math method oracle checks receiver identity together with repeated argument identity.
                return function (...values) {
                    events = [...events, 'call'];
                    assert.equal(this, Math);
                    assert.ok(values.every(entry => entry === value));

                    if (phase === 'call') throw failure;

                    return value;
                };
            } });
            try {
                return { identity: invoke(phase === 'null' ? null : argument('inbound'), argument('outbound'), key) === value, events };
            } catch (error) {
                return { exactFailure: error === failure, nativeFailure: error instanceof TypeError, events };
            } finally {
                Object.defineProperty(Math, 'min', minDescriptor);
            }
        };
        const [referenceIndexedFunction = () => 0] = indexedFunctions;
        ['normal', 'callee', 'key1', 'inbound', 'key2', 'outbound', 'call', 'null'].forEach((phase) => {
            indexedFunctions.slice(1).forEach(invoke => assert.deepEqual(observeIndexed(invoke, phase), observeIndexed(referenceIndexedFunction, phase), phase));
        });
        const { outputText: referenceMutation = '' } = typescript.transpileModule(examples.mutation, {
            compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
        });
        const mutationFunctions = await Promise.all([referenceMutation, mutation,
            linter.verifyAndFix(mutation, placementSettings).output].map(async code => (await load(code)).append));
        const observeMutation = (invoke, phase) => {
            let events = [];
            const values = { get push() {
                events = [...events, 'callee'];

                if (phase === 'callee') throw failure;

                // eslint-disable-next-line no-restricted-syntax -- The acquired collection method must receive the collection receiver and the original argument.
                return function (value) {
                    events = [...events, 'call'];
                    assert.equal(this, values);
                    assert.equal(value, 7);

                    if (phase === 'call') throw failure;
                };
            } };
            const box = { get values() { events = [...events, 'receiver'];

                return values; } };
            const item = { get length() {
                events = [...events, 'argument'];

                if (phase === 'argument') throw failure;

                return 7;
            } };
            try {
                const result = invoke({ map: callback => callback(box) }, { map: callback => callback(phase === 'null' ? null : item) });

                return { identity: result === box, events };
            } catch (error) {
                return { exactFailure: error === failure, nativeFailure: error instanceof TypeError, events };
            }
        };
        const [referenceMutationFunction = () => 0] = mutationFunctions;
        ['normal', 'callee', 'argument', 'call', 'null'].forEach((phase) => {
            mutationFunctions.slice(1).forEach(invoke => assert.deepEqual(observeMutation(invoke, phase), observeMutation(referenceMutationFunction, phase), phase));
        });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }

    {
        const capabilityDirectory = await mkdtemp(path.join(tmpdir(), 'resilient-capability-directives-'));
        const capabilityCases = {
            first: 'export const probe=(O:{compare:(a:number,b:number)=>number})=>(as:number[])=>as.slice().sort(O.compare);',
            priorValue: 'export const probe=(O:{compare:(a:number,b:number)=>number})=>(as:number[])=>{ if(as.length<=1)return as; return as.slice().sort(O.compare); };',
            priorBare: 'export const probe=(O:{compare:(a:number,b:number)=>number})=>(as:number[],early:boolean)=>{ if(early)return; return as.slice().sort(O.compare); };',
            nested: 'export const probe=(O:{compare:(a:number,b:number)=>number})=>(as:number[])=>{ const nested=()=>4; nested(); return as.slice().sort(O.compare); };',
            unreachable: 'export const probe=(O:{compare:(a:number,b:number)=>number})=>(as:number[])=>{ if(false)return 4; return as.slice().sort(O.compare); };',
            direct: 'export const probe=(O:{run:(a:number)=>number}, a:number)=>O.run(a);',
            directPrior: 'export const probe=(O:{run:(a:number)=>number}, a:number)=>{ if(a===1)return 4; return O.run(a); };',
            reduceFirst: 'export const probe=(O:{combine:(a:number,b:number)=>number})=>(as:number[])=>as.reduce(O.combine);',
            reducePrior: 'export const probe=(O:{combine:(a:number,b:number)=>number})=>(as:number[])=>{ if(as.length<=1)return 0; return as.reduce(O.combine); };',
            dynamic: 'export function probe(ks:string[],i:number) { const k=ks[i]; return k; }',
            rest: 'export function probe(f:(...args:any[])=>any) { return (...args:any[])=> { if(args.length>1)return f(args[1],args[0]); return (a:any)=>f(a)(args[0]); }; }'
        };
        try {
            await Promise.all(Object.entries(capabilityCases).map(([name = '', code = '']) => writeFile(path.join(capabilityDirectory, `${name}.ts`), code)));
            const program = typescript.createProgram(Object.keys(capabilityCases).map(name => path.join(capabilityDirectory, `${name}.ts`)), {
                target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext, strict: true
            });
            const transformer = createTypeScriptTransformer({ typescript, program });
            const linter = new Linter();
            const settings = { linterOptions: { reportUnusedDisableDirectives: 'error' }, plugins: { resilient }, rules: {
                'consistent-return': 'error',
                'resilient/no-undefined-assignment': 'error',
                'resilient/prefer-safe-transformations': 'error',
                'func-style': ['error', 'expression'],
                'resilient/prefer-safe-destructuring-defaults': 'error',
                'resilient/prefer-signature-destructuring': 'error',
                'resilient/signature-contract-destructuring': 'error'
            } };
            Object.entries(capabilityCases).forEach(([name = '', source = '']) => {
                const { code = '' } = transformer.transform({ code: source, fileName: path.join(capabilityDirectory, `${name}.ts`) });
                const messages = linter.verify(code, settings);
                const suppressed = linter.getSuppressedMessages().filter(({ ruleId = '' }) => ruleId === 'consistent-return');
                const findings = messages.filter(({ ruleId = '' }) => ruleId === 'consistent-return');
                const bare = linter.verify(code, {
                    ...settings,
                    linterOptions: { noInlineConfig: true }
                }).filter(({ ruleId = '' }) => ruleId === 'consistent-return');

                assert.deepEqual(messages.filter(({ ruleId = '' }) => !ruleId), [], JSON.stringify({ name, code, messages }));
                assert.equal(!!findings.length, name === 'priorBare', name);

                if (['dynamic', 'rest'].includes(name)) {
                    assert.doesNotMatch(code, /fresh rest-array numeric reads must not acquire an iterator|dynamic array index may be absent/u);

                    return;
                }

                const hasUndefinedGuard = ['direct', 'directPrior', 'reduceFirst', 'reducePrior'].includes(name);

                if (hasUndefinedGuard) {
                    assert.equal(suppressed.length, 1, name);
                    assert.equal(bare.length, 1, name);
                    const [{ messageId = '', line = 0 } = {}] = suppressed;
                    const [{ messageId: bareMessage = '' } = {}] = bare;
                    const parsed = typescript.createSourceFile('capability.js', code, typescript.ScriptTarget.ESNext, true, typescript.ScriptKind.JS);
                    const findReturn = (node) => {
                        if (typescript.isReturnStatement(node) && parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1 === line) return node;

                        return typescript.forEachChild(node, findReturn);
                    };
                    const target = findReturn(parsed);
                    const { expression: targetExpression = false } = getObject(target);

                    assert.equal(messageId, bareMessage, name);
                    assert.ok(target, name);
                    assert.equal(Boolean(targetExpression), !['directPrior', 'reducePrior'].includes(name), name);
                }

                if (!hasUndefinedGuard) {
                    assert.equal(suppressed.length, 0, name);
                    assert.equal(bare.length, findings.length, name);
                }

                const neighbor = `${code}\nexport const neighbor = flag => { if (flag) return 1; return; };`;
                const neighborMessages = linter.verify(neighbor, settings).filter(({ ruleId = '' }) => ruleId === 'consistent-return');
                const { line: neighborLine = 0 } = getObject(neighborMessages.at(-1));

                assert.equal(neighborMessages.length, findings.length + 1, name);
                assert.ok(neighborLine > code.split('\n').length, name);
            });
        } finally {
            await rm(capabilityDirectory, { recursive: true, force: true });
        }
    }

    {
        const callDirectory = await mkdtemp(path.join(tmpdir(), 'resilient-resolved-call-directives-'));
        const cases = {
            collision: 'export const outer=(x:number)=>{ const go=(v:number)=>v; return go(x); }; export const go=(x:number,y:number)=>x+y;',
            mismatch: 'export const outer=()=>{ const go=(v=0)=>v; return go("wrong"); }; export const go=(x:number,y:number)=>x+y;',
            neighbor: 'export const outer=(x:number)=>{ const go=(v:number)=>v; return go(x); }; export const go=(x:number,y:number)=>x+y; export const neighbor=()=>go(1);'
        };
        try {
            await Promise.all(Object.entries(cases).map(([name = '', code = '']) => writeFile(path.join(callDirectory, `${name}.ts`), code)));
            const program = typescript.createProgram(Object.keys(cases).map(name => path.join(callDirectory, `${name}.ts`)), {
                target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext, strict: true
            });
            const transformer = createTypeScriptTransformer({ typescript, program });
            const linter = new Linter();
            const settings = { linterOptions: { reportUnusedDisableDirectives: 'error' }, plugins: { resilient }, rules: {
                'resilient/signature-contract-call-site': 'error'
            } };
            Object.entries(cases).forEach(([name = '', source = '']) => {
                const { code = '' } = transformer.transform({ code: source, fileName: path.join(callDirectory, `${name}.ts`) });
                const messages = linter.verify(code, settings);
                assert.doesNotMatch(code, /eslint-disable-next-line resilient\/signature-contract-call-site/u);
                assert.deepEqual(linter.getSuppressedMessages(), [], name);
                assert.equal(messages.length, name === 'collision' ? 0 : 1, JSON.stringify({ name, code, messages }));

                if (name === 'collision') return;

                const [{ ruleId = '', messageId = '', line = 0 } = {}] = messages;

                assert.equal(ruleId, 'resilient/signature-contract-call-site');
                assert.equal(messageId, name === 'mismatch' ? 'mismatch' : 'arity');
                assert.match(code.split('\n').at(line - 1), name === 'mismatch' ? /wrong/u : /neighbor/u);
            });
        } finally {
            await rm(callDirectory, { recursive: true, force: true });
        }
    }

    // Completed callable placement owns the statement span. Varying rule count or
    // reason width cannot change its grammar or leave an operand outside coverage.
    const operationPlacement = (source, names, reason, nested = false, repeat = [], lineRule = '', trailingText = '') => {
        const tree = typescript.createSourceFile('operation.js', source, 99, true, typescript.ScriptKind.JS);
        const { statements: [{ statements: [, owner = {}] = [] } = {}] = [] } = tree;
        let owners = [owner];

        if (nested) {
            const find = (node) => {
                const { body = {} } = node;

                if (typescript.isArrowFunction(node)) owners = [...owners, body];

                typescript.forEachChild(node, find);
            };
            find(owner);
        }

        const byKey = new Map(owners.map((node) => {
            const key = getConsumerContractKey(node);

            return [key, [{ entry: { key, kind: 'callable-operation-placement' },
                contract: { placementRange: key, evidence: [reason] },
                agreement: { action: 'retain-callable-operation', rules: names } }]];
        }));
        const result = typescript.transform(tree, [context => (root) => {
            if (lineRule) nextLine(owner, lineRule, 'Exact code line.');

            if (trailingText) typescript.addSyntheticTrailingComment(owner, typescript.SyntaxKind.MultiLineCommentTrivia, trailingText, true);

            let placed = annotateRetainedStaticMemberAccess({
                typescript, sourceFile: root, context, destructuringAgreements: { hasCallableOperations: true, byKey }
            });
            repeat.forEach((contribution) => {
                const { rules = contribution, reason: nextReason = reason } = getObject(contribution);
                const next = new Map([...byKey].map(([key = '', records = []] = []) => [key, records.map((record) => {
                    const { contract = {} } = record;

                    return { ...record, contract: { ...contract, evidence: [nextReason] },
                        agreement: { action: 'retain-callable-operation', rules } };
                })]));
                placed = annotateRetainedStaticMemberAccess({ typescript, sourceFile: placed, context,
                    destructuringAgreements: { hasCallableOperations: true, byKey: next } });
            });

            // This fixture supplies max-len only for the known overlong generated
            // explanation. Its diagnostic is on the comment line, so its owner is
            // a next-line boundary before the scoped opener, not executable code.
            if (reason.length > 200) {
                const annotateExplanation = (node) => {
                    const comments = typescript.getSyntheticLeadingComments(node) || [];
                    const index = comments.findIndex(({ text = '' }) => text.startsWith(' eslint-disable '));

                    if (index >= 0) typescript.setSyntheticLeadingComments(node, [
                        ...comments.slice(0, index),
                        { kind: typescript.SyntaxKind.SingleLineCommentTrivia, pos: -1, end: -1, hasTrailingNewLine: true,
                            text: ' eslint-disable-next-line max-len -- Retained exception explanation.' },
                        ...comments.slice(index)
                    ]);

                    typescript.forEachChild(node, annotateExplanation);
                };
                annotateExplanation(placed);
            }

            return placed;
        }]);
        const { transformed: [output = {}] = [] } = result;
        const code = formatResilientOutput(print(output), typescript);
        result.dispose();

        return code;
    };
    const executable = (code) => {
    // TypeScript 6 adds "use strict" by default; compare both sides after the
    // same compiler emit so directive placement is the only variable.
        const { outputText = '' } = typescript.transpileModule(code, { compilerOptions: { target: 99 } });
        const tree = typescript.createSourceFile('tokens.js', outputText, 99, true, typescript.ScriptKind.JS);
        let tokens = [];
        const visit = (node) => {
            const { kind = 0 } = getObject(node);

            if (kind === typescript.SyntaxKind.EndOfFileToken) return;

            if (kind <= typescript.SyntaxKind.LastToken) {
                tokens = [...tokens, [kind, node.getText(tree)]];

                return;
            }

            node.getChildren(tree).forEach(visit);
        };
        visit(tree);

        return tokens;
    };
    [
        '{ alert("before"); alert(console.log("target")); alert("after"); }',
        '{ alert("before"); alert(\nconsole.log("target")\n); alert("after"); }',
        '{ alert("before"); alert(() => console.log("nested"), console.log("later")); alert("after"); }',
        '{ alert("before"); const result = alert(console.log("target")); alert("after"); }',
        '{ alert("before"); const result = alert(\n// Initializer note.\nconsole.log("target")\n); alert("after"); }'
    ].forEach((source, index) => {
        const base = operationPlacement(source, ['no-console'], 'Native console timing.', index === 2);
        const names = ['no-console', 'no-alert', 'no-console'];
        const reason = 'Native console timing. '.repeat(12);
        const code = operationPlacement(source, names, reason, index === 2);

        assert.deepEqual(executable(code), executable(base));
        assert.equal(formatResilientOutput(code, typescript), code);
        assert.doesNotMatch(code, /eslint-disable-next-line no-(?:alert|console)/u);
        assert.doesNotMatch(code, /no-console, no-alert, no-console/u);
        const messages = groupingLinter.verify(code, lengthSettings);
        const suppressed = groupingLinter.getSuppressedMessages();

        assert.equal(messages.length, 2, JSON.stringify({ code, messages }));
        assert.ok(messages.every(({ ruleId = '' }) => ruleId === 'no-alert'));
        assert.equal(suppressed.filter(({ ruleId = '' }) => ruleId === 'no-console').length, index === 2 ? 2 : 1);
        const withoutLength = code.replace(/^[ \t]*\/\/ eslint-disable-next-line max-len[^\n]*\n/gmu, '');

        assert.equal(groupingLinter.verify(withoutLength, lengthSettings).filter(({ ruleId = '' }) => ruleId === 'max-len').length, 1);
        const bare = code.replace(/\/\* eslint-(?:disable|enable)[\s\S]*?\*\//gu, '')
            .replace(/^[ \t]*\/\/ eslint-disable-next-line max-len[^\n]*\n/gmu, '');

        assert.equal(groupingLinter.verify(bare, groupingSettings).length, index === 2 ? 5 : 4);
    });
    // max-len is an exact member of either form when the owned code needs it;
    // deduplication never changes that form or gives it a wider endpoint.
    const longOperation = `{ alert("before"); alert("${'value'.repeat(45)}"); alert("after"); }`;
    const lengthScope = operationPlacement(longOperation, ['no-alert', 'max-len', 'max-len'], 'Retained string value.');
    assert.deepEqual(groupingLinter.verify(lengthScope, { rules: { 'no-alert': 'error', 'max-len': groupedLengthRule } })
        .map(({ ruleId = '' }) => ruleId), ['no-alert', 'no-alert']);
    assert.deepEqual(groupingLinter.getSuppressedMessages().map(({ ruleId = '' }) => ruleId).toSorted(), ['max-len', 'no-alert']);
    assert.deepEqual(executable(lengthScope), executable(operationPlacement(longOperation, ['no-alert'], 'Retained string value.')));
    const singleDuplicate = group(typescript.createSourceFile('single.js', 'alert("target");', 99, true), ({ statements: [owner = {}] = [] } = {}) => {
        nextLine(owner, 'no-alert, no-alert', 'Native alert timing.');
    });
    assert.match(print(singleDuplicate.transformed[0]), /eslint-disable-next-line no-alert --/u);
    assert.deepEqual(groupingLinter.verify(print(singleDuplicate.transformed[0]), { rules: { 'no-alert': 'error' } }), []);
    singleDuplicate.dispose();

    const accumulated = operationPlacement('{ alert("before"); alert(console.log("target")); alert("after"); }',
        ['no-console'], 'Native call timing.', false, [['no-alert'], ['no-console', 'no-alert']]);
    assert.equal((accumulated.match(/eslint-disable /gu) || []).length, 1);
    assert.equal((accumulated.match(/eslint-enable /gu) || []).length, 1);
    assert.deepEqual(groupingLinter.verify(accumulated, groupingSettings).map(({ ruleId = '' }) => ruleId), ['no-alert', 'no-alert']);
    ['no-console', ''].forEach((names) => {
        const source = `/* eslint-disable ${names} -- Authored outer scope. */
{ alert("before"); alert(console.log("target")); console.log("after"); }
/* eslint-enable ${names} */
console.log("outside");`;
        const placed = operationPlacement(source, ['no-console'], 'Native console timing.');
        const settings = { rules: { 'no-console': 'error' } };
        const original = groupingLinter.verify(source, settings);
        const originalSuppressed = groupingLinter.getSuppressedMessages();
        assert.deepEqual(groupingLinter.verify(placed, settings).map(({ ruleId = '' }) => ruleId), original.map(({ ruleId = '' }) => ruleId));
        assert.equal(groupingLinter.getSuppressedMessages().length, originalSuppressed.length);
        assert.match(placed, /Authored outer scope/u);
        assert.doesNotMatch(placed, /Native console timing/u);
    });

    const collision = operationPlacement('{ alert("before"); alert(console.log("target")); alert("after"); }',
        ['no-alert'], 'Native alert timing.', false, [], 'no-console');
    assert.deepEqual(groupingLinter.verify(collision, groupingSettings).map(({ ruleId = '' }) => ruleId), ['no-alert', 'no-alert'], collision);
    assert.deepEqual(groupingLinter.getSuppressedMessages().map(({ ruleId = '' }) => ruleId).toSorted(), ['no-alert', 'no-console']);
    ['no-console', ''].forEach((names) => {
        const source = `/* eslint-disable ${names} -- Authored outer scope. */
{ alert("before"); alert(console.log("target"), () => {
/* eslint-enable ${names} */
console.log("inside"); }); console.log("after"); }
console.log("outside");`;
        const placed = operationPlacement(source, ['no-console'], 'Native console timing.');
        const settings = { rules: { 'no-console': 'error' } };
        const original = groupingLinter.verify(source, settings);
        const originalSuppressed = groupingLinter.getSuppressedMessages();
        assert.deepEqual(groupingLinter.verify(placed, settings).map(({ ruleId = '' }) => ruleId), original.map(({ ruleId = '' }) => ruleId));
        assert.equal(groupingLinter.getSuppressedMessages().length, originalSuppressed.length);
        assert.doesNotMatch(placed, /Native console timing/u);
    });

    [' retained trailing note ', ' eslint-disable-line no-undef -- Host operation. '].forEach((trailingText) => {
        const code = operationPlacement('{ console.log("before"); alert(console.log("target")); console.log("after"); }',
            ['no-console'], 'Native call timing.', false, [['no-alert'], ['no-console', 'no-alert']], '', trailingText);
        assert.equal((code.match(/eslint-disable /gu) || []).length, 1);
        assert.equal((code.match(/eslint-enable /gu) || []).length, 1);
        assert.ok(code.includes(trailingText));
        const settings = { ...groupingSettings, rules: { ...groupingSettings.rules, 'no-undef': 'error' } };
        const messages = groupingLinter.verify(code, settings);
        assert.equal(messages.filter(({ ruleId = '' }) => ruleId === 'no-console').length, 2);
        assert.equal(messages.filter(({ ruleId = '' }) => ruleId === null).length, 0, JSON.stringify({ code, messages }));
        assert.equal(groupingLinter.getSuppressedMessages().filter(({ ruleId = '' }) => ruleId === 'no-alert').length, 1);
    });

    // Declaration accumulation retains all reasons once, stable paired endpoints,
    // initializer trivia and visible neighbors, including an unused list member.
    const repeatedDeclaration = '{ alert("before"); const result = alert(\n// Initializer note.\nconsole.log("target")\n); alert("after"); }';
    const declarationContributions = [
        { rules: ['no-alert', 'no-console'], reason: 'Native alert timing.' },
        { rules: ['no-console'], reason: 'Native console timing.' },
        { rules: ['no-alert', 'no-console'], reason: 'Native alert timing.' }
    ];
    const declarationOutput = operationPlacement(repeatedDeclaration, ['no-console'], 'Native console timing.', false, declarationContributions);
    assert.equal(declarationOutput, operationPlacement(repeatedDeclaration, ['no-console'], 'Native console timing.', false,
        [...declarationContributions, ...declarationContributions]));
    assert.equal((declarationOutput.match(/Native console timing\./gu) || []).length, 1);
    assert.equal((declarationOutput.match(/Native alert timing\./gu) || []).length, 1);
    assert.equal((declarationOutput.match(/Initializer note\./gu) || []).length, 1);
    assert.match(declarationOutput, /eslint-disable no-console, no-alert --/u);
    assert.match(declarationOutput, /eslint-enable no-console, no-alert/u);
    assert.deepEqual(groupingLinter.verify(declarationOutput, groupingSettings).map(({ ruleId = '' }) => ruleId), ['no-alert', 'no-alert']);
    const unusedDeclaration = operationPlacement(repeatedDeclaration, ['no-console', 'no-debugger'], 'Native console timing.');
    assert.equal(groupingLinter.verify(unusedDeclaration, { ...groupingSettings, rules: { ...groupingSettings.rules, 'no-debugger': 'error' } })
        .filter(({ ruleId = '' }) => ruleId === null).length, 1);

    const compoundReason = 'Getter phase; getter phase';
    const compoundDeclaration = operationPlacement(repeatedDeclaration, ['no-console'], compoundReason, false,
        [{ rules: ['no-alert'], reason: 'Call phase.' }, { rules: ['no-console'], reason: compoundReason }]);
    assert.ok(compoundDeclaration.includes(`${compoundReason}; Call phase.`));
    assert.equal(compoundDeclaration, operationPlacement(repeatedDeclaration, ['no-console'], compoundReason, false,
        [{ rules: ['no-alert'], reason: 'Call phase.' }, { rules: ['no-console'], reason: compoundReason },
            { rules: ['no-alert'], reason: 'Call phase.' }, { rules: ['no-console'], reason: compoundReason }]));
    ['no-console', ''].forEach((names) => {
        const source = `/* eslint-disable ${names} -- Authored outer scope. */\n${repeatedDeclaration}\n/* eslint-enable ${names} */\nconsole.log("outside");`;
        const code = operationPlacement(source, ['no-console'], 'Native console timing.');
        const settings = { rules: { 'no-console': 'error' } };
        const expected = groupingLinter.verify(source, settings);
        const { length: suppressed = 0 } = groupingLinter.getSuppressedMessages();
        assert.deepEqual(groupingLinter.verify(code, settings).map(({ ruleId = '' }) => ruleId), expected.map(({ ruleId = '' }) => ruleId));
        assert.equal(groupingLinter.getSuppressedMessages().length, suppressed);
        assert.doesNotMatch(code, /Native console timing/u);
    });

    // Re-entering final grouping after producers repeat their contributions must
    // neither multiply retained reason echoes nor change the rendered boundary.
    const repeatTree = typescript.createSourceFile('repeat.js', 'alert(console.log("target")); // Trailing note.\nalert("neighbor");', 99, true);
    const firstGrouping = group(repeatTree, ({ statements: [owner = {}] = [] } = {}) => {
        nextLine(owner, 'no-alert', 'Alert timing.');
        nextLine(owner, 'no-console', 'Console timing.');
    });
    const { transformed: [firstGrouped = {}] = [] } = firstGrouping;
    const firstOutput = print(firstGrouped);
    [['no-alert'], ['no-alert', 'no-console']].forEach((names) => {
        const repeated = group(firstGrouped, ({ statements: [owner = {}] = [] } = {}) => {
            names.forEach(name => nextLine(owner, name, name === 'no-alert' ? 'Alert timing.' : 'Console timing.'));
        });
        const { transformed: [repeatedSource = {}] = [] } = repeated;

        assert.equal(print(repeatedSource), firstOutput);
        assert.ok(print(repeatedSource).includes('// Trailing note.'));
        repeated.dispose();
    });
    firstGrouping.dispose();

    // Authored next-line payloads and their emitted target survive every statement
    // position. Trailing trivia is independently owned and must never be detached.
    [false, true].forEach((nonfirst) => {
        ['alert(console.log("target"));', 'const value = alert(console.log("target"));',
            'function invoke() {\n// eslint-disable-next-line no-alert -- authored\nreturn alert(console.log("target")); // trailing note\n}'].forEach((statement) => {
            const source = [nonfirst ? 'alert("before");\n' : '',
                statement.startsWith('function') ? '' : '// ordinary note\n// eslint-disable-next-line no-alert -- authored\n',
                statement, statement.startsWith('function') ? '' : ' // trailing note', '\nalert("neighbor");'].join('');
            const tree = typescript.createSourceFile('authored-position.js', source, 99, true);
            const { statements = [] } = tree;
            const owner = statements.at(Number(nonfirst));
            const { body: { statements: [returned = {}] = [] } = {} } = getObject(owner);
            const target = typescript.isFunctionDeclaration(owner) ? returned : owner;
            const result = group(tree, () => {
                nextLine(target, 'no-console, no-console', 'Generated console timing.');
                nextLine(target, 'no-console', 'Generated console timing.');
            });
            const { transformed: [placed = {}] = [] } = result;
            const output = formatResilientOutput(print(placed), typescript, placed);
            const findings = groupingLinter.verify(output, groupingSettings);
            assert.equal(findings.length, nonfirst ? 2 : 1, JSON.stringify({ output, findings }));
            assert.ok(findings.every(({ ruleId = '', line = 0 }) => ruleId === 'no-alert' && /before|neighbor/u.test(output.split('\n').at(line - 1))));
            assert.deepEqual(groupingLinter.getSuppressedMessages().map(({ ruleId = '' }) => ruleId).toSorted(), ['no-alert', 'no-console']);
            assert.ok(output.includes('// trailing note'));
            assert.deepEqual(executable(output), executable(source));
            assert.equal(formatResilientOutput(output, typescript), output);
            const regrouped = group(placed);
            const { transformed: [regroupedSource = {}] = [] } = regrouped;
            assert.equal(print(regroupedSource), print(placed));
            regrouped.dispose();
            result.dispose();
        });
    });

    // Identical authored payloads on another occurrence must not acquire the
    // generated owner's coverage. Source trivia stays byte-exact and ordered.
    const identicalAuthoredSource = [
        '// eslint-disable-next-line no-alert -- authored',
        'alert(console.log("generated-target"));',
        '/* eslint-disable-next-line no-console --',
        'Generated console timing.',
        '*/',
        '// eslint-disable-next-line no-alert -- authored',
        'alert(console.log("authored-target")); // retained trailing',
        'alert(console.log("neighbor"));'
    ].join('\n');
    const identicalAuthoredTree = typescript.createSourceFile('identical-authored.js', identicalAuthoredSource, 99, true);
    const identicalAuthoredResult = group(identicalAuthoredTree, ({ statements: [owner = {}] = [] } = {}) => {
        nextLine(owner, 'no-console', 'Generated console timing.');
    });
    const { transformed: [identicalPlaced = {}] = [] } = identicalAuthoredResult;
    const identicalOutput = formatResilientOutput(print(identicalPlaced), typescript, identicalPlaced);
    const identicalFindings = groupingLinter.verify(identicalOutput, groupingSettings);
    assert.equal(identicalFindings.filter(({ ruleId = '' }) => ruleId === null).length, 1);
    assert.equal(identicalFindings.filter(({ ruleId = '' }) => ruleId === 'no-console').length, 2);
    assert.equal(groupingLinter.getSuppressedMessages().filter(({ ruleId = '' }) => ruleId === 'no-console').length, 1);
    assert.ok(identicalOutput.includes('*/\n// eslint-disable-next-line no-alert -- authored\nalert(console.log("authored-target")); // retained trailing'));
    identicalAuthoredResult.dispose();

    // Repeated post-group contributions and long distinct reasons retain both
    // authored and generated targets while code layout stays fixed.
    const repeatedAuthoredTree = typescript.createSourceFile('repeat-authored.js',
        '// eslint-disable-next-line no-alert -- authored\nalert(console.log("target")); // trailing note\nalert("neighbor");', 99, true);
    const firstAuthored = group(repeatedAuthoredTree, ({ statements: [owner = {}] = [] } = {}) => {
        nextLine(owner, 'no-console, no-console', 'Console timing.');
    });
    const repeatAuthored = group(firstAuthored.transformed[0], ({ statements: [owner = {}] = [] } = {}) => {
        nextLine(owner, 'no-console', 'Console timing.');
        nextLine(owner, 'no-console', 'Distinct native console timing. '.repeat(15).trim());
    });
    const { transformed: [repeatedAuthoredPlaced = {}] = [] } = repeatAuthored;
    const repeatedAuthoredOutput = formatResilientOutput(print(repeatedAuthoredPlaced), typescript, repeatedAuthoredPlaced);
    assert.equal(groupingLinter.verify(repeatedAuthoredOutput, { ...groupingSettings,
        rules: { ...groupingSettings.rules, 'max-len': ['error', { code: 200 }] } }).length, 1, repeatedAuthoredOutput);
    assert.deepEqual(groupingLinter.getSuppressedMessages().map(({ ruleId = '' }) => ruleId).toSorted(), ['no-alert', 'no-console']);
    assert.deepEqual(executable(repeatedAuthoredOutput), executable(print(firstAuthored.transformed[0])));
    const repeatAgain = group(repeatedAuthoredPlaced);
    assert.equal(print(repeatAgain.transformed[0]), print(repeatedAuthoredPlaced));
    repeatAgain.dispose();
    repeatAuthored.dispose();
    firstAuthored.dispose();

    // A syntax-only annotator cannot establish a slice carrier or native receiver.
    // Both mutations stay visible without a completed source decision.
    const reverseSource = 'export function reverse(values) { values.reverse(); return values.slice().reverse(); }';
    const reverseTree = typescript.createSourceFile('reverse-line.js', reverseSource, 99, true);
    const reverseResult = group(reverseTree, root => annotateRetainedMutationBoundaries({ typescript, sourceFile: root }));
    const { transformed: [reversePlaced = {}] = [] } = reverseResult;
    const { outputText: reverseEmitted = '' } = typescript.transpileModule(print(reversePlaced), { compilerOptions: { target: 99 } });
    const reverseOutput = formatResilientOutput(placeInlineEmissionBoundaries(reverseEmitted, typescript, reversePlaced), typescript);
    const reverseLinter = new Linter();
    const reverseSettings = { plugins: { resilient }, linterOptions: { reportUnusedDisableDirectives: 'error' },
        rules: { 'resilient/prefer-safe-transformations': 'error' } };
    assert.doesNotMatch(reverseOutput, /eslint-disable-line/u);
    assert.deepEqual(executable(reverseOutput), executable(reverseSource));
    assert.equal(reverseLinter.verify(reverseOutput, reverseSettings).length, 2, reverseOutput);
    assert.equal(reverseLinter.getSuppressedMessages().length, 0);
    assert.equal(reverseLinter.verify(reverseOutput.replace(/^\s*\/\/ eslint-disable-next-line[^\n]*\n/gmu, ''), reverseSettings).length, 2);
    const reverseRuntime = await import(`data:text/javascript,${encodeURIComponent(reverseOutput)}`);
    const reverseValues = [1, 2, 3];
    const { reverse: runtimeReverse = () => {} } = reverseRuntime;
    assert.deepEqual(runtimeReverse(reverseValues), [1, 2, 3]);
    assert.deepEqual(reverseValues, [3, 2, 1]);
    reverseResult.dispose();

    // A before-compiler expression gap remains rejected: transpilation collapses
    // it. The completed emitted-line migration below uses the actual final span.
    const callbackCounterexample = 'function run() { return apply(console.log("before"), m => b => alert(console.log("target")), console.log("after")); }';
    const callbackTree = typescript.createSourceFile('callback-counterexample.js', callbackCounterexample, 99, true);
    const { statements: [{ body: { statements: [{ expression: { arguments: [, callbackOwner = {}] = [] } = {} } = {}] = [] } = {} } = {}] = [] } = callbackTree;
    const callbackResult = group(callbackTree, () => nextLine(callbackOwner, 'no-console', 'Console timing.'));
    const { transformed: [callbackPlaced = {}] = [] } = callbackResult;
    const { outputText: callbackEmitted = '' } = typescript.transpileModule(print(callbackPlaced), { compilerOptions: { target: 99 } });
    const callbackOutput = formatResilientOutput(callbackEmitted, typescript);
    assert.equal(groupingLinter.verify(callbackOutput, groupingSettings).filter(({ ruleId = '' }) => ruleId === 'no-console').length, 1);
    assert.equal(groupingLinter.getSuppressedMessages().filter(({ ruleId = '' }) => ruleId === 'no-console').length, 2);
    assert.deepEqual(executable(callbackOutput), executable(callbackCounterexample));
    callbackResult.dispose();

    // A retained lifetime reference in a class heritage clause has a header line;
    // it needs no enclosing class scope and never enables a disabled outer rule.
    const heritageSource = 'class Early extends Later {}\nfunction Later() {}';
    const heritageTree = typescript.createSourceFile('heritage-line.js', heritageSource, 99, true);
    const { statements: [{ heritageClauses: [{ types: [{ expression: heritageReference = {} } = {}] = [] } = {}] = [] } = {}] = [] } = heritageTree;
    const heritageKey = getConsumerContractKey(heritageReference);
    const heritageResult = typescript.transform(heritageTree, [context => root => groupNextLineExceptions({ typescript, context,
        sourceFile: annotateCyclicRuntimeBindingReferences({ typescript, sourceFile: root, context,
            destructuringAgreements: { byKind: new Map([['native-function-reference', [{ contract: { sourceRange: heritageKey } }]]]) } }) })]);
    const { transformed: [heritagePlaced = {}] = [] } = heritageResult;
    const heritageOutput = formatResilientOutput(print(heritagePlaced), typescript);
    assert.doesNotMatch(heritageOutput, /eslint-disable-line|eslint-enable/u);
    assert.deepEqual(executable(heritageOutput), executable(heritageSource));
    assert.deepEqual(groupingLinter.verify(heritageOutput, { rules: { 'no-use-before-define': ['error', { functions: true }] } }), []);
    assert.equal(groupingLinter.getSuppressedMessages().length, 1);
    heritageResult.dispose();

    // Header placement is guarded by ordinary trivia. A comment inside the binding
    // or heritage keeps its original expression boundary through actual transpilation.
    [false, true].forEach((withNote) => {
        const source = `function assign(entries, output) { for (const [${withNote ? '\n// key note\n' : ''}key, value] of entries) { output[key] = value; } }`;
        const tree = typescript.createSourceFile('iteration-trivia.js', source, 99, true);
        const { statements: [{ body: { statements: [loop = {}] = [] } = {} } = {}] = [] } = tree;
        const result = typescript.transform(tree, [context => root => groupNextLineExceptions({ typescript, context,
            sourceFile: annotateRetainedDynamicMemberAccess({ typescript, sourceFile: root, context,
                destructuringAgreements: { operationalLoops: new Set([getConsumerContractKey(loop)]) } }) })]);
        const { transformed: [placed = {}] = [] } = result;
        const { outputText = '' } = typescript.transpileModule(print(placed), { compilerOptions: { target: 99 } });
        const output = formatResilientOutput(outputText, typescript);
        const settings = { plugins: { resilient }, linterOptions: { reportUnusedDisableDirectives: 'error' },
            rules: { 'resilient/prefer-safe-destructuring-defaults': 'error', 'resilient/prefer-prototype-methods': 'error' } };
        assert.deepEqual(groupingLinter.verify(output, settings), [], output);
        assert.equal(groupingLinter.getSuppressedMessages().length, 3);
        assert.equal(/eslint-disable-line resilient\/prefer-safe-destructuring-defaults/u.test(output), withNote);
        assert.equal(output.includes('// key note'), withNote);
        assert.deepEqual(executable(output), executable(source));
        assert.equal(formatResilientOutput(output, typescript), output);
        result.dispose();
    });
    [false, true].forEach((withNote) => {
        const source = `class Early extends${withNote ? '\n// base note\n' : ' '}Later {}\nfunction Later() {}`;
        const tree = typescript.createSourceFile('heritage-trivia.js', source, 99, true);
        const { statements: [{ heritageClauses: [{ types: [{ expression: reference = {} } = {}] = [] } = {}] = [] } = {}] = [] } = tree;
        const result = typescript.transform(tree, [context => root => groupNextLineExceptions({ typescript, context,
            sourceFile: annotateCyclicRuntimeBindingReferences({ typescript, sourceFile: root, context,
                destructuringAgreements: { byKind: new Map([['native-function-reference', [{ contract: { sourceRange: getConsumerContractKey(reference) } }]]]) } }) })]);
        const { transformed: [placed = {}] = [] } = result;
        const { outputText = '' } = typescript.transpileModule(print(placed), { compilerOptions: { target: 99 } });
        const output = formatResilientOutput(outputText, typescript);
        assert.deepEqual(groupingLinter.verify(output, { linterOptions: { reportUnusedDisableDirectives: 'error' },
            rules: { 'no-use-before-define': ['error', { functions: true }] } }), [], output);
        assert.equal(groupingLinter.getSuppressedMessages().length, 1);
        assert.equal(/eslint-disable-line/u.test(output), withNote);
        assert.equal(output.includes('// base note'), withNote);
        assert.deepEqual(executable(output), executable(source));
        assert.equal(formatResilientOutput(output, typescript), output);
        result.dispose();
    });
    const typeHeritage = typescript.createSourceFile('type-heritage.ts', 'class Container { method() { interface Erased extends Later {} } }\ninterface Later {}', 99, true);
    const { statements: [{ members: [{ body: { statements: [erasedInterface = {}] = [] } = {} } = {}] = [] } = {}] = [] } = typeHeritage;
    const { heritageClauses: [{ types: [{ expression: erasedReference = {} } = {}] = [] } = {}] = [] } = erasedInterface;
    const erasedResult = typescript.transform(typeHeritage, [context => root => annotateCyclicRuntimeBindingReferences({ typescript, sourceFile: root, context,
        destructuringAgreements: { byKind: new Map([['native-function-reference', [{ contract: { sourceRange: getConsumerContractKey(erasedReference) } }]]]) } })]);
    const { transformed: [erasedPlaced = {}] = [] } = erasedResult;
    assert.doesNotMatch(print(erasedPlaced), /eslint-disable/u);
    erasedResult.dispose();

    [false, true].forEach((nonfirst) => {
        const authored = '/* eslint-disable-next-line no-alert -- Authored block reason. */';
        const source = `${nonfirst ? 'alert("before");\n' : ''}${authored}\nalert(console.log("target")); // block trailing note\nalert("after");`;
        const tree = typescript.createSourceFile('authored-block.js', source, 99, true);
        const { statements = [] } = tree;
        const owner = statements.at(Number(nonfirst));
        const result = group(tree, () => nextLine(owner, 'no-console', 'Console timing.'));
        const { transformed: [placed = {}] = [] } = result;
        const output = formatResilientOutput(print(placed), typescript, placed);
        assert.equal(groupingLinter.verify(output, groupingSettings).length, nonfirst ? 2 : 1, output);
        assert.deepEqual(groupingLinter.getSuppressedMessages().map(({ ruleId = '' }) => ruleId).toSorted(), ['no-alert', 'no-console']);
        assert.ok(output.includes(authored));
        assert.ok(output.includes('// block trailing note'));
        assert.deepEqual(executable(output), executable(source));
        assert.equal(formatResilientOutput(output, typescript), output);
        result.dispose();
    });

    // A multiline authored next-line block has a different endpoint. Keep the
    // original stack rather than moving its payload or silently changing scope.
    const authoredMultiline = 'function run() {\n/* eslint-disable-next-line no-alert --\n    Authored multiline reason.\n    */\nalert(console.log("target")); // trailing note\n}';
    const authoredMultilineTree = typescript.createSourceFile('authored-multiline.js', authoredMultiline, 99, true);
    const { statements: [{ body: { statements: [multilineOwner = {}] = [] } = {} } = {}] = [] } = authoredMultilineTree;
    nextLine(multilineOwner, 'no-console', 'Console timing.');
    const baselineMultiline = formatResilientOutput(print(authoredMultilineTree), typescript);
    const multilineResult = group(authoredMultilineTree, () => nextLine(multilineOwner, 'no-console', 'Console timing.'));
    const { transformed: [multilinePlaced = {}] = [] } = multilineResult;
    assert.equal(formatResilientOutput(print(multilinePlaced), typescript, multilinePlaced), baselineMultiline);
    assert.equal(groupingLinter.verify(baselineMultiline, groupingSettings).filter(({ ruleId = '' }) => ruleId === null).length, 1);
    assert.equal(groupingLinter.getSuppressedMessages().filter(({ ruleId = '' }) => ruleId === 'no-console').length, 1);
    multilineResult.dispose();

    // Typed printer syntax must retain the same occurrence before compiler erasure.
    const typedCollision = [
        'type Box<A> = { value: A }; const identity = <A>(value: A): A => value;',
        '// eslint-disable-next-line no-debugger',
        'while (true) { console.log("target"); break; }',
        'while (true) { console.log("neighbor"); break; }'
    ].join('\n');
    const typedTree = typescript.createSourceFile('typed-collision.ts', typedCollision, 99, true, typescript.ScriptKind.TS);
    const typedResult = group(typedTree, (root) => {
        const owner = root.statements.find(statement => typescript.isWhileStatement(statement));
        nextLine(owner, 'no-constant-condition', 'Native loop termination.');
    });
    const { transformed: [typedPlaced = {}] = [] } = typedResult;
    const typedInput = placeEmissionBoundaries(print(typedPlaced), typescript, typedPlaced);
    const { outputText: typedEmitted = '' } = typescript.transpileModule(typedInput, { compilerOptions: { target: 99 } });
    const typedOutput = formatResilientOutput(typedEmitted, typescript);
    const typedSettings = { linterOptions: { reportUnusedDisableDirectives: 'error' },
        rules: { 'no-console': 'error', 'no-debugger': 'error', 'no-constant-condition': ['error', { checkLoops: 'all' }] } };
    // eslint-disable-next-line resilient/no-null-assignment -- The ESLint oracle retains its native null ruleId for a configuration diagnostic.
    assert.deepEqual(groupingLinter.verify(typedOutput, typedSettings).map(({ ruleId = '' }) => ruleId).toSorted(), ['no-console', 'no-console', 'no-constant-condition', null]);
    assert.deepEqual(groupingLinter.getSuppressedMessages().map(({ ruleId = '' }) => ruleId).toSorted(), ['no-constant-condition']);
    typedResult.dispose();

    // These operations own their emitted physical line, including any neighbors
    // already covered by the original inline directive. Migration preserves that
    // exact set rather than guessing which subexpression a lint rule will report.
    const diagnosticAnchors = (code, messages) => {
        const tree = typescript.createSourceFile('anchors.js', code, 99, true, typescript.ScriptKind.JS);
        let tokens = [];
        const visit = (node) => {
            const { kind = 0 } = getObject(node);

            if (kind === typescript.SyntaxKind.EndOfFileToken) return;

            if (kind <= typescript.SyntaxKind.LastToken) {
                tokens = [...tokens, node];

                return;
            }

            node.getChildren(tree).forEach(visit);
        };
        visit(tree);

        return messages.map(({ ruleId = '', messageId = '', message = '', line = 1, column = 1 }) => {
            const position = tree.getPositionOfLineAndCharacter(line - 1, column - 1);
            const [range = {}] = [...typescript.getLeadingCommentRanges(code, position) || [],
                ...typescript.getTrailingCommentRanges(code, position) || []];
            const { pos = position, end = position } = range;
            const text = code.slice(pos, end);
            const targetLine = /eslint-disable-next-line\b/u.test(text) ? tree.getLineAndCharacterOfPosition(end).line + 1 : line - 1;
            const anchor = !ruleId && /eslint-disable-(?:next-)?line\b/u.test(text)
                ? tree.getPositionOfLineAndCharacter(targetLine, 0) : position;

            return [ruleId, messageId, message, tokens.findIndex(token => getObject(token).end > anchor)];
        }).toSorted();
    };
    const physicalShapes = [
        'const result = m => b => alert(console.log("target"));',
        'const result = ok ? alert(console.log("before")) : alert(console.log("target"));',
        'const result = [alert(console.log("before")), ...console.log("target"), alert(console.log("after"))];',
        'const result = apply(alert(console.log("before")), m => b => alert(console.log("target")), /* neighbor note */ alert(console.log("after")));',
        'const result = alert(console.log("target")) + alert(console.log("after"));',
        'function run() { return alert(console.log("target")) + alert(console.log("after")); }',
        'function run() { throw alert(console.log("target")); }',
        'const result = apply(\n// ordinary note\nalert(console.log("target")), // trailing note\nalert(console.log("after")));'
    ];
    const physicalSettings = { linterOptions: { reportUnusedDisableDirectives: 'error' }, rules: { 'no-alert': 'error', 'no-console': 'error', 'no-debugger': 'error' } };
    [false, true].forEach((nonfirst) => {
        physicalShapes.forEach((shape) => {
            ['', '/* eslint-disable no-alert */\n', '/* eslint-disable */\n'].forEach((scope) => {
                ['no-console', 'no-console, no-alert', 'no-console, no-debugger'].forEach((names) => {
                    ['Console timing.', 'Native console timing and failure order are retained. '.repeat(8).trim()].forEach((reason) => {
                        const source = `${scope}${nonfirst ? 'alert(console.log("first"));\n' : ''}${shape}\nalert(console.log("neighbor"));${scope ? '\n/* eslint-enable */' : ''}`;
                        const tree = typescript.createSourceFile('physical-line.ts', source, 99, true, typescript.ScriptKind.TS);
                        const result = group(tree, (root) => {
                            const visit = (node) => {
                                if (typescript.isCallExpression(node) && getObject(node.arguments.at(0)).text === 'target') {
                                    typescript.addSyntheticTrailingComment(node, typescript.SyntaxKind.MultiLineCommentTrivia,
                                        ` eslint-disable-line ${names} -- ${reason} `, false);
                                }

                                typescript.forEachChild(node, visit);
                            };
                            visit(root);
                        });
                        const { transformed: [placed = {}] = [] } = result;
                        const { outputText: emitted = '' } = typescript.transpileModule(print(placed), { compilerOptions: { target: 99 } });
                        const baseline = formatResilientOutput(emitted, typescript);
                        const moved = placeInlineEmissionBoundaries(emitted, typescript, placed);
                        const output = formatResilientOutput(moved, typescript);
                        const before = groupingLinter.verify(baseline, physicalSettings);
                        const suppressedBefore = groupingLinter.getSuppressedMessages();
                        const after = groupingLinter.verify(output, physicalSettings);
                        const suppressedAfter = groupingLinter.getSuppressedMessages();
                        assert.deepEqual(executable(output), executable(baseline));
                        assert.deepEqual(diagnosticAnchors(output, after), diagnosticAnchors(baseline, before), JSON.stringify({ baseline, output, before, after }));
                        assert.deepEqual(diagnosticAnchors(output, suppressedAfter), diagnosticAnchors(baseline, suppressedBefore));
                        assert.doesNotMatch(output, /eslint-disable-line\b/u);
                        assert.equal(placeInlineEmissionBoundaries(output, typescript, placed), output);
                        assert.equal(formatResilientOutput(output, typescript), output);
                        ['ordinary note', 'trailing note', 'neighbor note'].filter(note => source.includes(note)).forEach(note => assert.equal(output.split(note).length, 2));
                        const without = output.replace(/\/\*\s*eslint-disable-next-line[\s\S]*?\*\//gu, '')
                            .replace(/^\s*\/\/ eslint-disable-next-line[^\n]*\n/gmu, '');
                        const unsuppressed = groupingLinter.verify(without, physicalSettings);
                        const baselineWithout = baseline.replace(/\/\*\s*eslint-disable-line[\s\S]*?\*\//gu, '');
                        assert.deepEqual(diagnosticAnchors(without, unsuppressed),
                            diagnosticAnchors(baselineWithout, groupingLinter.verify(baselineWithout, physicalSettings)));
                        const execute = (code) => {
                            let calls = [];
                            const consoleProof = { log: (value) => { calls = [...calls, ['console', value]];

                                return [value]; } };
                            const alertProof = (value) => { calls = [...calls, ['alert', value]];

                                return value; };
                            let value;

                            try {
                                const invoke = new Function('console', 'alert', 'apply', 'ok',
                                    `${code}\nreturn typeof run === 'function' ? run() : result;`);
                                value = invoke(consoleProof, alertProof, (...values) => values, true);

                                const resolve = (pending) => {
                                    if (typeof pending === 'function') return resolve(pending({}));

                                    return Array.isArray(pending) ? pending.map(resolve) : pending;
                                };
                                value = resolve(value);
                            } catch (error) {
                                value = error;
                            }

                            return { calls, value };
                        };
                        assert.deepEqual(execute(output), execute(baseline));
                        result.dispose();
                    });
                });
            });
        });
    });

    // Guarded forms retain exact directive precedence, authored provenance and
    // unused members. Compatible distinct contributions on one line can unite.
    [
        { source: '// eslint-disable-next-line no-console -- authored precedence\nalert(console.log("target"));', names: ['no-console'], retained: true },
        { source: '// eslint-disable-next-line\nalert(console.log("target"));', names: ['no-console'], retained: true },
        { source: '/* eslint-disable-next-line no-alert --\nAuthored multiline reason.\n*/\nalert(console.log("target"));', names: ['no-console'], retained: true },
        { source: 'alert(console.log("target")); /* eslint-disable-line no-console -- Console timing. */', names: ['no-console'], retained: true },
        { source: 'alert(console.log("target"));', names: ['no-console', 'no-console'], retained: true },
        { source: 'alert(console.log("target"));', names: ['no-console', 'no-alert'], retained: false },
        { source: 'alert(console.log("target"));', names: ['no-console, no-console'], retained: false },
        { source: 'const result = `head\n${console.log("target")}\ntail`;', names: ['no-console'], retained: true },
        { source: '// eslint-disable-next-line no-alert -- authored separate rule\nalert(console.log("target"));', names: ['no-console'], retained: false },
        { source: '/* eslint-disable-line no-console -- authored earlier */ alert(console.log("target"));', names: ['no-console'], retained: true },
        { source: '/* eslint-disable-line */ alert(console.log("target"));', names: ['no-console'], retained: true },
        { source: 'alert(console.log("target")); /* eslint-disable-line no-console -- authored later */', names: ['no-console'], retained: false },
        { source: '/* eslint-disable-line no-alert -- authored disjoint */ alert(console.log("target"));', names: ['no-console'], retained: false }
    ].forEach(({ source = '', names = [], retained = false } = {}) => {
        const tree = typescript.createSourceFile('physical-guard.js', source, 99, true, typescript.ScriptKind.JS);
        const result = group(tree, (root) => {
            const visit = (node) => {
                if (typescript.isCallExpression(node) && getObject(node.arguments.at(0)).text === 'target') {
                    names.forEach(rule => typescript.addSyntheticTrailingComment(node, typescript.SyntaxKind.MultiLineCommentTrivia,
                        ` eslint-disable-line ${rule} -- Console timing. `, false));
                }

                typescript.forEachChild(node, visit);
            };
            visit(root);
        });
        const { transformed: [placed = {}] = [] } = result;
        const { outputText: emitted = '' } = typescript.transpileModule(print(placed), { compilerOptions: { target: 99 } });
        const moved = placeInlineEmissionBoundaries(emitted, typescript, placed);
        const baseline = formatResilientOutput(emitted, typescript);
        const output = formatResilientOutput(moved, typescript);
        const before = groupingLinter.verify(baseline, physicalSettings);
        const suppressedBefore = groupingLinter.getSuppressedMessages();
        assert.equal(moved === emitted, retained, JSON.stringify({ source, moved, emitted }));
        assert.deepEqual(diagnosticAnchors(output, groupingLinter.verify(output, physicalSettings)), diagnosticAnchors(baseline, before));
        assert.deepEqual(diagnosticAnchors(output, groupingLinter.getSuppressedMessages()), diagnosticAnchors(baseline, suppressedBefore));
        assert.deepEqual(executable(output), executable(baseline));
        assert.equal(formatResilientOutput(output, typescript), output);
        result.dispose();
    });

    // Restoring a bare or overlapping authored next-line predecessor would change
    // which directive is unused. Keep its original stack under the debt contract.
    ['no-console -- authored precedence', '', "'no-console' -- authored precedence", '"no-console" -- authored precedence',
        'no-console --- authored precedence', ',', '"" ,'].forEach((authoredRules) => {
        const source = `// eslint-disable-next-line ${authoredRules}\nalert(console.log("target"));\nalert(console.log("neighbor"));`;
        const tree = typescript.createSourceFile('authored-precedence.js', source, 99, true, typescript.ScriptKind.JS);
        let baselinePrinted = '';
        const result = group(tree, ({ statements: [owner = {}] = [] } = {}) => {
            nextLine(owner, 'no-console', 'Generated timing.');
            baselinePrinted = print(tree);
        });
        const { transformed: [placed = {}] = [] } = result;
        const { outputText: baselineEmitted = '' } = typescript.transpileModule(baselinePrinted, { compilerOptions: { target: 99 } });
        const { outputText: emitted = '' } = typescript.transpileModule(placeEmissionBoundaries(print(placed), typescript, placed), { compilerOptions: { target: 99 } });
        const baseline = formatResilientOutput(baselineEmitted, typescript);
        const output = formatResilientOutput(emitted, typescript);
        assert.equal(output, baseline);
        const messages = groupingLinter.verify(output, physicalSettings);
        assert.equal(messages.filter(({ ruleId = '' }) => !ruleId).length, 1);
        assert.deepEqual(groupingLinter.getSuppressedMessages().map(({ ruleId = '' }) => ruleId), ['no-console']);
        assert.equal(groupingLinter.verify(source, physicalSettings).filter(({ ruleId = '' }) => !ruleId).length, 0);
        result.dispose();
    });

    ["'no-console' -- authored earlier", '"no-console" -- authored earlier', 'no-console --- authored earlier', ',', '"" ,'].forEach((names) => {
        ['/* eslint-disable-line ', '// eslint-disable-next-line '].forEach((prefix) => {
            const source = prefix.startsWith('/*')
                ? `${prefix}${names} */ alert(console.log("target"));`
                : `${prefix}${names}\nalert(console.log("target"));`;
            const tree = typescript.createSourceFile('directive-grammar.js', source, 99, true, typescript.ScriptKind.JS);
            const result = group(tree, (root) => {
                const visit = (node) => {
                    if (typescript.isCallExpression(node) && getObject(node.arguments.at(0)).text === 'target') {
                        typescript.addSyntheticTrailingComment(node, typescript.SyntaxKind.MultiLineCommentTrivia,
                            ' eslint-disable-line no-console -- Generated timing. ', false);
                    }

                    typescript.forEachChild(node, visit);
                };
                visit(root);
            });
            const { transformed: [placed = {}] = [] } = result;
            const { outputText: emitted = '' } = typescript.transpileModule(print(placed), { compilerOptions: { target: 99 } });
            assert.equal(placeInlineEmissionBoundaries(emitted, typescript, placed), emitted, source);
            result.dispose();
        });
    });
    const crossingSource = '// eslint-disable-next-line no-alert -- authored precedence\nalert(console.log("target")); // trailing note\nalert(console.log("neighbor"));';
    const crossingTree = typescript.createSourceFile('crossing.js', crossingSource, 99, true, typescript.ScriptKind.JS);
    const crossingFirst = group(crossingTree, ({ statements: [owner = {}] = [] } = {}) => nextLine(owner, 'no-console', 'Console timing.'));
    const { transformed: [crossingPlaced = {}] = [] } = crossingFirst;
    const crossingNext = group(crossingPlaced, ({ statements: [owner = {}] = [] } = {}) => nextLine(owner, 'no-alert', 'New redundant alert contribution.'));
    const { transformed: [crossingUpdated = {}] = [] } = crossingNext;
    const { outputText: crossingEmitted = '' } = typescript.transpileModule(placeEmissionBoundaries(print(crossingUpdated), typescript, crossingUpdated), { compilerOptions: { target: 99 } });
    const crossingOutput = formatResilientOutput(crossingEmitted, typescript);
    const crossingMessages = groupingLinter.verify(crossingOutput, physicalSettings);
    assert.equal(crossingMessages.filter(({ ruleId = '' }) => !ruleId).length, 1);
    assert.ok(crossingMessages.find(({ ruleId = '' }) => !ruleId).message.includes('no-alert'));
    assert.deepEqual(groupingLinter.getSuppressedMessages().map(({ ruleId = '' }) => ruleId).toSorted(), ['no-alert', 'no-console']);
    const { line: crossingUnusedLine = 1 } = getObject(crossingMessages.find(({ ruleId = '' }) => !ruleId));
    assert.match(crossingOutput.split('\n').at(crossingUnusedLine - 1), /no-console, no-alert/u);
    assert.equal(crossingOutput.split('// eslint-disable-next-line no-alert -- authored precedence').length, 2);
    assert.equal(crossingOutput.split('// trailing note').length, 2);
    const crossingAgain = group(crossingUpdated);
    assert.equal(print(crossingAgain.transformed[0]), print(crossingUpdated));
    crossingAgain.dispose();
    crossingNext.dispose();
    crossingFirst.dispose();

    // An authored bridge on another executable line belongs to that line's owner.
    // Retain the second inline endpoint rather than scheduling coincident insertions.
    ['// eslint-disable-next-line no-alert', '/* eslint-disable-next-line no-alert */'].forEach((bridge) => {
        const source = `console.log("first"); ${bridge}\nalert(console.log("second"));\nalert(console.log("neighbor"));`;
        const tree = typescript.createSourceFile('adjacent.js', source, 99, true, typescript.ScriptKind.JS);
        const result = group(tree, (root) => {
            const visit = (node) => {
                const { arguments: args = [] } = getObject(node);
                const { text = '' } = getObject(args.at(0));

                if (typescript.isCallExpression(node) && ['first', 'second'].includes(text)) {
                    typescript.addSyntheticTrailingComment(node, typescript.SyntaxKind.MultiLineCommentTrivia,
                        ` eslint-disable-line no-console -- ${text} timing. `, false);
                }

                typescript.forEachChild(node, visit);
            };
            visit(root);
        });
        const { transformed: [placed = {}] = [] } = result;
        const { outputText: emitted = '' } = typescript.transpileModule(print(placed), { compilerOptions: { target: 99 } });
        const baseline = formatResilientOutput(emitted, typescript);
        const output = formatResilientOutput(placeInlineEmissionBoundaries(emitted, typescript, placed), typescript);
        const before = groupingLinter.verify(baseline, physicalSettings);
        const suppressedBefore = groupingLinter.getSuppressedMessages();
        assert.deepEqual(diagnosticAnchors(output, groupingLinter.verify(output, physicalSettings)), diagnosticAnchors(baseline, before));
        assert.deepEqual(diagnosticAnchors(output, groupingLinter.getSuppressedMessages()), diagnosticAnchors(baseline, suppressedBefore));
        assert.deepEqual(executable(output), executable(baseline));
        assert.match(output, /eslint-disable-line no-console -- second timing\./u);
        assert.match(output, /eslint-disable-next-line no-console -- first timing\./u);
        assert.equal(formatResilientOutput(output, typescript), output);
        result.dispose();
    });
}

{
    // Completed JavaScript owns values and native failure. Layout owns token gaps;
    // its rejection outcome is unchanged text, never a synthesized result.
    const mechanical = {
        'no-constant-condition': 'error',
        indent: ['error', 4, { SwitchCase: 1 }],
        'arrow-parens': ['error', 'as-needed', { requireForBlockBody: true }],
        'comma-dangle': ['error', 'never'],
        'operator-linebreak': ['error', 'before', { overrides: { '&&': 'after', '||': 'after' } }],
        'no-trailing-spaces': 'error',
        'lines-between-class-members': 'error',
        'padding-line-between-statements': ['error',
            { blankLine: 'always', prev: '*', next: 'if' },
            { blankLine: 'always', prev: 'if', next: '*' },
            { blankLine: 'always', prev: '*', next: 'return' },
            { blankLine: 'never', prev: 'return', next: 'return' }]
    };
    const linter = new Linter();
    const cases = [
        'export const read = (value) => {\n  const next = value +\n  1;  \n if (next) return next;\n return 0;\n};\n',
        `export const nested = outer => inner => call(${Array.from({ length: 24 }, () => 'inner').join(', ')});\n`,
        `export const parenthesized = (outer) => (inner) => call(${Array.from({ length: 24 }, () => 'inner').join(', ')});\n`,
        [
            'export const tuple = (...semigroups) => ({ concat: (first, second) => {',
            'return semigroups.map((s, i) => s.concat((first[i] // Retained indexed operation ends here.',
            '), (second[i] // Retained indexed operation ends here.',
            '))); } });'
        ].join('\n'),
        'export const emptyLoop = () => { for (;;) { break; } };\n',
        'export const active = (left, right) => left\n && right;\n',
        'export const value =\n/*#__PURE__*/ Number(1);\n',
        'export class Cell {\n value;\n /** Method text stays intact. */\n read() {return this.value;}\n write(value) {this.value = value;}\n}\n',
        `export const collect = (input) => call(${Array.from({ length: 24 }, () => 'input').join(', ')});\n`,
        'export const f = (value) => {\n const next = value;\n // eslint-disable-next-line no-constant-condition -- retained test branch\n if (true) return next;\n return 0;\n};\n'
    ];
    cases.forEach((source) => {
        const output = formatResilientOutput(source, typescript);
        assert.equal(formatResilientOutput(output, typescript), output, 'Layout must be idempotent.');
        const { fixed = false, messages = [] } = linter.verifyAndFix(output, { rules: mechanical });
        assert.equal(fixed, false, JSON.stringify({ source, output, messages }));
        assert.equal(messages.filter(({ ruleId = '' } = {}) => ruleId).length, 0, JSON.stringify(messages));
    });

    const parameters = Array.from({ length: 24 }, (_, index) => `value${index}`).join(', ');
    const annotated = `export const annotated = (${parameters}) => { return 1; }; // eslint-disable-line no-unused-vars -- Entire signature owns this boundary.\n`;
    assert.deepEqual(linter.verify(formatResilientOutput(annotated, typescript), { rules: { 'no-unused-vars': 'error' } }), []);
    const argumentsText = Array.from({ length: 24 }, () => 'value').join(', ');
    const longCall = `export const call = value => consume(${argumentsText}); // eslint-disable-line no-undef -- Consumer is supplied by the host.\n`;
    assert.deepEqual(linter.verify(formatResilientOutput(longCall, typescript), { rules: { 'no-undef': 'error' } }), []);
    const nextLineCall = `// eslint-disable-next-line no-undef -- Consumer is supplied by the host.\nexport const call = value => consume(${argumentsText});\n`;
    assert.deepEqual(linter.verify(formatResilientOutput(nextLineCall, typescript), { rules: { 'no-undef': 'error' } }), []);
    const trailingComment = '/* Tail comment\n    intentionally uneven spaces  \n * keep it. */';
    assert.equal(formatResilientOutput(`export const value=1;\n  ${trailingComment}\n`, typescript).includes(trailingComment), true);

    const commentedArguments = [
        'export const read = source => pair((',
        '    // eslint-disable-next-line no-unused-vars -- First binding stays at its source call position.',
        '    ({ first }) => 0)(source), (',
        '    // eslint-disable-next-line no-unused-vars -- Second binding stays at its source call position.',
        '    ({ second }) => 0)(source));',
        ''
    ].join('\n');
    const argumentLayout = formatResilientOutput(commentedArguments, typescript);
    assert.equal(formatResilientOutput(argumentLayout, typescript), argumentLayout);
    assert.deepEqual(linter.verify(argumentLayout, { rules: { ...mechanical, 'no-unused-vars': 'error' } }), []);

    // A compiler newline and its following indent are one layout operation. The
    // directive owns the closing line, so rejecting the newline must also reject
    // its indent instead of accumulating spaces on every subsequent pass.
    const retainedClosingLine = [
        'export const read = source => ({ stable: 1, selected: (',
        '    // eslint-disable-next-line no-unused-vars -- This fixture observes a retained parameter directive before a same-line closing object brace.',
        '    ({ unused }) => 0)(source) });'
    ].join('\n');
    const retainedClosingOutput = formatResilientOutput(retainedClosingLine, typescript);
    assert.equal(formatResilientOutput(retainedClosingOutput, typescript), retainedClosingOutput);
    assert.deepEqual(linter.verify(retainedClosingOutput, { rules: { 'no-unused-vars': 'error' } }), []);
    assert.equal(linter.getSuppressedMessages().length, 1);

    const payloadSource = [
        'export const quoted = "https://host/(x) => x /* text */";',
        'export const pattern = /https?:\\/\\/[^/]+\\/(?:x|y)/g;',
        'export const template = String.raw`  first',
        '  // not a comment ${((x) => x)("middle")} ',
        'return payload  `;',
        '/* Authored block\n    intentionally uneven spaces  \n * keep it. */',
        'export const observe = () => {',
        '    const values = [1, ,];',
        '    let calls = 0;',
        '    const receiver = { get value() { calls++; return calls; } };',
        '    const read = (enabled) => enabled && (receiver.value + receiver.value);',
        '    const skipped = read(false);',
        '    const used = read(true);',
        '    const asi = () => { return',
        '        used;',
        '    };',
        '    return [quoted, pattern.source, template, values.length, 1 in values, skipped, used, calls, asi()];',
        '};',
        ''
    ].join('\n');
    const formatted = formatResilientOutput(payloadSource, typescript);
    const literals = (source) => {
        const tree = typescript.createSourceFile('payload.js', source, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.JS);
        let values = [];
        const visit = (node) => {
            if (typescript.isLiteralExpression(node) || typescript.isTemplateLiteralToken(node)) values = [...values, node.getText(tree)];

            typescript.forEachChild(node, visit);
        };
        visit(tree);

        return values;
    };
    assert.deepEqual(literals(formatted), literals(payloadSource));
    assert.match(formatted, /\/\* Authored block\n {4}intentionally uneven spaces {2}\n \* keep it\. \*\//u);
    assert.equal(formatResilientOutput(formatted, typescript), formatted);
    const load = text => import(`data:text/javascript,${encodeURIComponent(text)}`);
    const original = await load(payloadSource);
    const lowered = await load(formatted);
    assert.deepEqual(lowered.observe(), original.observe());

    const moduleOrder = "import './z-effect.js';\nimport { value } from './a-value.js';\nexport { value };\n";
    assert.equal(formatResilientOutput(moduleOrder, typescript), moduleOrder, 'Authored module evaluation order remains fixed.');
    assert.equal(formatResilientOutput(payloadSource), payloadSource, 'Missing compiler rejects layout.');

    assert.equal(formatResilientOutput('const = ;', typescript), 'const = ;');

    // Exact text shares syntax only within one formatter invocation. Changed
    // stages must parse their own text, and a later call must use its own compiler.
    const wideFieldSource = Array.from({ length: 32 }, (_, index) => authoredFieldTyped.replace('read =', `read${index} =`)).join('\n');
    const wideFieldTree = typescript.createSourceFile('authored-fields.ts', wideFieldSource, typescript.ScriptTarget.ESNext, true);
    const { outputText: wideFieldCode = '' } = typescript.transpileModule(wideFieldSource, {
        compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
    });
    [
        { code: wideFieldCode, limit: 3, placedSource: wideFieldTree },
        { code: 'export const value = 1;\n', limit: 1 },
        { code: 'export const value=1;\n', limit: 2 },
        { code: cases[2], limit: 3 }
    ].forEach(({ code = '', limit = 0, placedSource = {} }) => {
        const parsed = new Map();
        const compiler = {
            ...typescript,
            createSourceFile: (fileName, text, ...options) => {
                // eslint-disable-next-line resilient/prefer-safe-transformations -- Private proof counter observes explicit parses without modifying compiler nodes or formatter text.
                parsed.set(text, (parsed.get(text) || 0) + 1);

                return typescript.createSourceFile(fileName, text, ...options);
            }
        };
        const output = formatResilientOutput(code, compiler, placedSource);
        assert.equal(output, formatResilientOutput(code, typescript, placedSource));
        assert.equal(parsed.size <= limit, true, 'Explicit parses stay bounded by changed text.');
        assert.equal([...parsed.values()].every(count => count === 1), true, 'Unchanged stages share their syntax snapshot.');
        const previous = parsed.get(output) || 0;
        assert.equal(formatResilientOutput(output, compiler, placedSource), output);
        assert.equal(parsed.get(output), previous + 1, 'Syntax never leaks into a later invocation.');
    });

    assert.match(formatResilientOutput('export const f = () => { for (;;) { break; } };', typescript), /for \(;;\)/u);
    assert.match(formatResilientOutput("import { read } from 'vendor';\nimport { local } from './local.js';\n", typescript), /vendor';\n\nimport/u);

    const comments = [
        '// Only a comment with uneven tail  ',
        '/* Only a block\n  keep this spacing  \n*/',
        '/* eslint-disable no-undef -- Exact directive payload.  */\nhost();\n/* eslint-enable no-undef */',
        '// eslint-disable-next-line no-undef -- EOF stays unused.  \n'
    ];
    comments.forEach((code) => {
        const output = formatResilientOutput(code, typescript);
        assert.equal(output.includes(code), true, 'Comment-only and EOF payload bytes survive.');
        assert.equal(formatResilientOutput(output, typescript), output);
    });

    const deepCases = [6, 12, 24].flatMap(depth => ['calls', 'arrows', 'parenthesized', 'arrays'].map((shape) => {
        const expression = Array.from({ length: depth }).reduce((body, _, index) => {
            if (shape === 'calls') return `call(${body}, ${'value'.repeat(15)})`;

            if (shape === 'arrays') return `[${body}, ${'value'.repeat(15)}]`;

            return shape === 'arrows' ? `value${index} => ${body}` : `(value${index}) => ${body}`;
        }, `[${Array.from({ length: 24 }, (_, index) => index).join(', ')}]`);

        return `export const deep = ${expression};\n`;
    }));
    deepCases.forEach((code) => {
        const output = formatResilientOutput(code, typescript);
        assert.deepEqual(typescript.createSourceFile('deep.js', output, typescript.ScriptTarget.Latest, true).parseDiagnostics, []);
        assert.equal(formatResilientOutput(output, typescript), output, 'Deep layout returns a fixed point.');
    });

    const directiveCases = [
        'export const value = (/* eslint-disable-next-line no-undef -- Existing target\n stays on its original line. */host());\n',
        `before();\n${longCall}after();\n`,
        `before();\n${nextLineCall}after();\n`,
        'export const value = 1; // eslint-disable-next-line no-undef -- Host condition.\nif (host) { host(); }\nneighbor();\n',
        'export const run = () => {\n const value=1; // eslint-disable-next-line no-undef -- Host result.\n return host(value);\n};\nneighbor();\n',
        'before();\n/* eslint-disable-next-line no-undef -- Block directive. */\nhost();\nafter();\n',
        'before();\n/* eslint-disable no-undef -- One wrapped call. */\n' + longCall.replace(/; \/\/[^\n]*/u, ';') + '/* eslint-enable no-undef */\nafter();\n',
        commentedArguments,
        'export const read = () => {\n const value=1;\n return host(value); // eslint-disable-line no-undef -- Host result.\n};\nneighbor();\n'
    ];
    const diagnostics = (code) => {
        const findings = linter.verify(code, { rules: { 'no-undef': 'error', 'no-unused-vars': 'error' } });
        const identify = ({ ruleId = '', message = '', suppressions = [] }) => ({ ruleId, message, suppressions });

        return { raw: findings.map(identify), suppressed: linter.getSuppressedMessages().map(identify) };
    };
    directiveCases.forEach((code) => {
        const output = formatResilientOutput(code, typescript);
        assert.deepEqual(diagnostics(output), diagnostics(code), 'The same findings stay raw/suppressed; neighbors remain visible.');
        assert.equal(formatResilientOutput(output, typescript), output);
    });

    const restrictedLines = [
        'export const run = () => { return\n ({ value: 1 }); };\n',
        'export const run = () => { let value = 1; let next = 2; value\n ++next; return [value, next]; };\n',
        'export function* run() { yield\n 7; yield 9; }\n',
        'const async = value => value; export const run = () => { async\n function inner() { return 3; } return inner(); };\n',
        'export const run = async () => await\n Promise.resolve(5);\n',
        'export const run = () => { const values = []; outer: for (let i = 0; i < 2; i++) { for (;;) { values.push(i); break\n outer; } } return values; };\n',
        'export const run = () => { let count = 0; outer: for (let i = 0; i < 2; i++) { for (let j = 0; j < 2; j++) { count++; continue\n outer; } } return count; };\n',
        'export const run = () => { const a = [1, 2,]; const b = [1,,]; const c = [,,]; return [a.length, b.length, c.length, 1 in b, 0 in c]; };\n'
    ];
    // eslint-disable-next-line resilient/prefer-prototype-methods -- Await each original/formatted module pair before comparing its completion.
    for (const code of restrictedLines) {
        const output = formatResilientOutput(code, typescript);
        assert.equal(formatResilientOutput(output, typescript), output);
        const before = await load(code);
        const after = await load(output);
        const observe = async ({ run = () => 0 } = {}) => {
            const result = await run();

            const { next = false } = Object(result);

            return typeof next === 'function' ? [...result] : [result];
        };
        assert.deepEqual(await observe(after), await observe(before));
    }
    const rejectionCases = ['const = ;', 'export const run = () => { throw\n new Error(); };', 'const run = async\n () => 1;'];
    rejectionCases.forEach(code => assert.equal(formatResilientOutput(code, typescript), code));

    const timingSource = [
        'export const run = (events, failure, token, mode) => {',
        ' const mark = value => { events.push(value); if (value === mode) throw failure; return token; };',
        ' const owner = { get invoke() { events.push("getter"); if (mode === "getter") throw failure;',
        '   return function (first, second) { events.push("call"); if (mode === "call") throw failure; return [this === owner, first === token, second === token]; }; } };',
        ' if (mode === "skip") return false && owner.invoke(mark("first"), mark("second"));',
        ' if (mode === "native-get") return null.value;',
        ' if (mode === "native-call") return ({ invoke: 0 }).invoke(mark("first"), mark("second"));',
        ' return owner.invoke(mark("first"), mark("second"));',
        '};',
        'export const iterate = (events) => {',
        ' const values = [1, 2]; let count = 0;',
        ' for (const value of values) { events.push(value); count++; if (value === 1) values.push(3); }',
        ' return [values, count];',
        '};',
        'export const close = (iterable) => { for (const value of iterable) { return value; } };',
        ''
    ].join('\n');
    const timingOutput = formatResilientOutput(timingSource, typescript);
    assert.equal(formatResilientOutput(timingOutput, typescript), timingOutput);
    const timingOriginal = await load(timingSource);
    const timingFormatted = await load(timingOutput);
    ['normal', 'skip', 'getter', 'first', 'second', 'call', 'native-get', 'native-call'].forEach((mode) => {
        const failure = {};
        const token = {};
        const observe = (module) => {
            const events = [];
            try {
                return { result: module.run(events, failure, token, mode), events };
            } catch (error) {
                return { exactFailure: error === failure, nativeFailure: error instanceof TypeError, events };
            }
        };
        assert.deepEqual(observe(timingFormatted), observe(timingOriginal), mode);
    });
    const observeIteration = (module) => {
        let events = [];
        const result = module.iterate(events);
        const iterator = {
            [Symbol.iterator]() { events = [...events, 'iterator'];

                return this; },
            next() { events = [...events, 'next'];

                return { value: 8, done: false }; },
            return() { events = [...events, 'close'];

                return { done: true }; }
        };

        return { result, first: module.close(iterator), events };
    };
    assert.deepEqual(observeIteration(timingFormatted), observeIteration(timingOriginal));

    // A compiler formatting service that corrupts syntax must fail visibly.
    assert.throws(() => formatResilientOutput('export const value = 1;\n', {
        ...typescript,
        createLanguageService: () => ({
            getFormattingEditsForDocument: () => [{ span: { start: 0, length: 0 }, newText: 'const = ;' }],
            dispose() {}
        })
    }), /produced invalid JavaScript/u);

    let slowPasses = 0;
    const settlingCompiler = {
        ...typescript,
        createLanguageService: (host) => {
            slowPasses += 1;
            const snapshot = host.getScriptSnapshot('emission.js');
            const text = snapshot.getText(0, snapshot.getLength());

            return {
                getFormattingEditsForDocument: () => text.endsWith('\n'.repeat(7)) ? [] : [
                    { span: { start: text.length, length: 0 }, newText: '\n' }
                ],
                dispose() {}
            };
        }
    };
    const settled = formatResilientOutput(deepCases[0], settlingCompiler);
    assert.equal(slowPasses > 4, true, 'A valid compiler layout sequence must settle beyond the former four-pass cap.');
    assert.equal(formatResilientOutput(settled, settlingCompiler), settled);
    assert.throws(() => formatResilientOutput('export const value = 1;\n', {
        ...typescript,
        createLanguageService: host => ({
            getFormattingEditsForDocument: () => [{ span: { start: host.getScriptSnapshot('emission.js').getLength(), length: 0 }, newText: '\n' }],
            dispose() {}
        })
    }), /did not converge/u, 'A nonconverging service cannot return a partial result.');
    assert.deepEqual(linter.verify(formatResilientOutput('export const values = [1, 2,];\nexport const sparse = [1,,];\n', typescript), {
        rules: { 'comma-dangle': ['error', 'never'] }
    }), []);

    assert.throws(() => formatResilientOutput('export const value = 1;\n', {
        ...typescript,
        createLanguageService: () => ({
            getFormattingEditsForDocument: () => [{ span: { start: 0, length: 0 }, newText: 'throw\n' }],
            dispose() {}
        })
    }), /produced invalid JavaScript/u, 'A missing throw operand is invalid even when TypeScript has no parse diagnostic.');

    // Closing a local scope must not overflow or detach an existing line-bound
    // operation. The endpoint moves across whitespace only, before the same token.
    const endpointCode = [
        '/* eslint-disable no-alert -- Retained call. */',
        `alert("${'value'.repeat(23)}"); // eslint-disable-line no-undef -- Host operation.`,
        '/* eslint-enable no-alert */',
        'alert("neighbor");'
    ].join('\n');
    const endpointInput = endpointCode.replace('; // eslint-disable-line no-undef -- Host operation.\n/* eslint-enable no-alert */',
        '; /* eslint-disable-line no-undef -- Host operation. */ /* eslint-enable no-alert */');
    const endpointOutput = formatResilientOutput(endpointInput, typescript);
    assert.match(endpointOutput, /Host operation\. \*\/\n\/\* eslint-enable no-alert/u);
    assert.equal(formatResilientOutput(endpointOutput, typescript), endpointOutput);
    assert.deepEqual(linter.verify(endpointOutput, { linterOptions: { reportUnusedDisableDirectives: 'off' },
        rules: { 'no-alert': 'error', 'no-undef': 'error', 'max-len': ['error', 200] } }).map(({ ruleId = '' }) => ruleId), ['no-alert', 'no-undef']);
    assert.equal(linter.getSuppressedMessages().filter(({ ruleId = '' }) => ruleId === 'no-undef').length, 1);
    assert.equal(linter.verifyAndFix(endpointOutput, { linterOptions: { reportUnusedDisableDirectives: 'off' }, rules: mechanical }).fixed, false);
}

{
    const code = [
        'type Order = { compare: (a: number, b: number) => number };',
        'type Selected = { tag: "yes"; value: [number, string] } | { tag: "no" };',
        'export function sort(order: Order, values: number[]) { return values.slice().sort(order.compare); }',
        'export const repeated = (value: { amount: number }, mutate: () => number) => value.amount + mutate() + value.amount;',
        'export const selected = (value: Selected) => value.tag === "yes" ? value.value[0] : 0;',
        'export function required({ callback }: { callback: (value: number) => number }) { return callback(2); }',
        'export function optional(value?: number) { return value === undefined ? 7 : value; }',
        'export const deferred = <T>(value: { field: T }, consume: (input: T) => T) => () => consume(value.field);',
        'export const exactArrow = (value?: number) => value !== undefined ? value : 9;',
        'export const indexed = (values: number[], index: number) => { const value = values[index]; return value; };'
    ].join('\n');
    const fileName = 'placement.ts';
    const file = typescript.createSourceFile(fileName, code, typescript.ScriptTarget.ESNext, true);
    const options = { strict: true, target: typescript.ScriptTarget.ESNext };
    const host = typescript.createCompilerHost(options);
    const program = typescript.createProgram([fileName], options, {
        ...host, getSourceFile: (name, version) => name === fileName ? file : host.getSourceFile(name, version)
    });
    let placing = false;
    let sourceQueries = 0;
    let transformations = 0;
    const checker = new Proxy(program.getTypeChecker(), { get(target = {}, key = '') {
        const value = Reflect.get(target, key);

        if (typeof value !== 'function') return value;

        return (...args) => {
            assert.equal(placing, false, `Placement queried TypeChecker.${String(key)}`);
            sourceQueries += 1;

            return Reflect.apply(value, target, args);
        };
    } });
    const compiler = { ...typescript, transform: (...args) => {
        placing = true;
        transformations += 1;

        return typescript.transform(...args);
    } };
    const transformer = createTypeScriptTransformer({ typescript: compiler,
        program: { ...program, getTypeChecker: () => checker } });
    const result = transformer.transform({ code, fileName });
    assert.deepEqual(result.diagnostics, []);
    assert.ok(sourceQueries > 0);
    assert.ok(transformations > 0);

    const evaluate = async (text = '', probe = '') => {
        const { outputText = '' } = typescript.transpileModule(text, {
            compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
        });

        return runInNewContext(probe, { namespace: await loadModule(outputText) });
    };
    const probes = [
        `const events = []; let current = 2;
    const value = { get amount() { events.push(current); return current; } };
    const result = namespace.repeated(value, () => { events.push('mutate'); current = 9; return 1; });
    JSON.stringify({ result, events });`,
        `const events = []; const failure = {};
    const order = { get compare() { events.push('compare'); return (a, b) => a - b; } };
    const values = { get slice() { events.push('receiver'); throw failure; } };
    try { namespace.sort(order, values); } catch (error) { events.push(error === failure); }
    JSON.stringify(events);`,
        `const events = []; let current = 2;
    const value = { get field() { events.push(current); return current; } };
    const later = namespace.deferred(value, input => input);
    events.push('created'); current = 8;
    JSON.stringify({ result: later(), events });`,
        `const events = []; const failure = {};
    const value = { tag: 'no', get value() { events.push('payload'); throw failure; } };
    const skipped = namespace.selected(value);
    value.tag = 'yes';
    try { namespace.selected(value); } catch (error) { events.push(error === failure); }
    JSON.stringify({ skipped, events });`,
        `JSON.stringify([namespace.exactArrow(), namespace.exactArrow(0), namespace.selected({ tag: 'yes', value: [0, ''] }),
    namespace.selected({ tag: 'no' }), namespace.optional(), namespace.optional(0),
    namespace.required({ callback: value => value + 1 }), namespace.indexed([1, 2], 1)]);`
    ];
    await Promise.all(probes.map(async probe => assert.equal(await evaluate(result.code, probe), await evaluate(code, probe))));
    const linter = new Linter();
    assert.deepEqual(linter.verify(result.code, { plugins: { resilient },
        rules: { 'resilient/no-undefined-comparison': 'error' },
        linterOptions: { reportUnusedDisableDirectives: false } }), [], 'Exact selectors receive their rule-specific boundary after reconstruction.');

    const evidence = collectPlacementEvidence({ typescript, sourceFile: file, checker: program.getTypeChecker() });
    const placement = compilePlacementDecisions({ typescript, evidence });
    const { facts = new Map() } = placement;
    const [read = {}] = [...facts.keys()].filter(node => typescript.isPropertyAccessExpression(node) &&
        node.getText(file) === 'value.amount');
    const original = getPlacementContract({ typescript, placement, node: read });
    assert.equal(original.kind, 'number');
    const clone = typescript.factory.updatePropertyAccessExpression(read, typescript.factory.createIdentifier('value'), 'amount');
    assert.equal(getPlacementContract({ typescript, placement, node: clone }), original);
    assert.equal(getPlacementSymbol({ typescript, placement, node: clone }), getPlacementSymbol({ typescript, placement, node: read }));
    const separate = typescript.createSourceFile(fileName, code, typescript.ScriptTarget.ESNext, true);
    let otherRead;
    const find = (node = {}) => {
        if (typescript.isPropertyAccessExpression(node) && node.getText(separate) === 'value.amount') otherRead = node;

        typescript.forEachChild(node, find);
    };
    find(separate);
    assert.deepEqual(getPlacementContract({ typescript, placement, node: otherRead }), {},
        'Matching filenames and ranges cannot borrow another source identity.');
    assert.deepEqual(getPlacementContract({ typescript, placement, node: typescript.factory.createIdentifier('amount') }), {});

    // The retired guard-binding mover must never execute. Residual reconstruction
    // retains its own compiler factory failure and observable exception identity.
    const phaseCode = 'export const run = (input: { value: { field: number } }) => { return input.value.field; };';
    const phaseFile = typescript.createSourceFile('phases.ts', phaseCode, typescript.ScriptTarget.ESNext, true);
    const phaseProgram = typescript.createProgram(['phases.ts'], options, {
        ...host, getSourceFile: (name, version) => name === 'phases.ts' ? phaseFile : host.getSourceFile(name, version)
    });
    ['', 'residual'].forEach((failedPhase = '') => {
        let phases = [];
        const failure = new Error('placement factory Get');
        const factory = new Proxy(typescript.factory, { get(target = {}, key = '') {
            const stack = Reflect.get(new Error(), 'stack');
            const selectedPhase = [['guard', 'lowering/guarded-bindings.js'], ['residual', 'members/residual.js']]
                .find(([, file = ''] = []) => stack.includes(file)) || [];
            const [phase = ''] = selectedPhase;
            const [last = ''] = phases.slice(-1);

            if (phase && phase !== last) phases = [...phases, phase];

            if (phase && phase === failedPhase) throw failure;

            return Reflect.get(target, key);
        } });
        const execute = () => createTypeScriptTransformer({ typescript: { ...typescript, factory }, program: phaseProgram })
            .transform({ code: phaseCode, fileName: 'phases.ts' });

        if (failedPhase) assert.throws(execute, error => error === failure);

        if (!failedPhase) execute();

        const expected = ['residual'];
        assert.deepEqual(phases, expected);
    });

    // Exported arity dispatch retains its observable signature and publishes no
    // generated metadata or fabricated array-binding agreement.
    const arityCode = [
        'export function chain(first: Function, second?: Function): unknown {',
        'switch (arguments.length) { case 1: return first;',
        'case 2: return function(this: unknown) { return second!(first.apply(this, arguments)); }; } }'
    ].join('\n');
    await Promise.all([true, false].map(async (strict) => {
        const arityOptions = { ...options, strict };
        const arityHost = typescript.createCompilerHost(arityOptions);
        const arityFile = typescript.createSourceFile('arity-report.ts', arityCode, typescript.ScriptTarget.ESNext, true);
        const arityProgram = typescript.createProgram(['arity-report.ts'], arityOptions, {
            ...arityHost, getSourceFile: (name, version) => name === 'arity-report.ts' ? arityFile : arityHost.getSourceFile(name, version)
        });
        const { code: arityOutput = '', diagnostics: arityDiagnostics = [], agreements: arityReports = [] }
            = createTypeScriptTransformer({ typescript, program: arityProgram }).transform({ code: arityCode, fileName: 'arity-report.ts' });
        assert.deepEqual(arityDiagnostics, []);
        assert.deepEqual(arityReports, []);
        assert.match(arityOutput, /export function chain\(first, second\)/u);
        assert.doesNotMatch(arityOutput, /_resilientArgs|Object\.defineProperty\(chain/u);
        const probe = `const first = function(value) { return this.offset + value; };
        JSON.stringify([namespace.chain(first) === first, namespace.chain(first, value => value * 2).call({ offset: 3 }, 4), namespace.chain.length]);`;
        assert.equal(await evaluate(arityOutput, probe), await evaluate(arityCode, probe));
    }));

    // Optional source declarations retain absence when the checker omits undefined
    // from their types. Nested selectors keep their exact operation scope.
    await Promise.all([true, false].map(async (strict) => {
        const selectorCode = [
            'type Protocol = { choose: (receiver: unknown, key: string) => unknown };',
            'export function receive(this: unknown, api: Protocol, key: string, value?: object) {',
            'return api.choose(value === undefined ? this : value, key); }',
            'export const resolve = (value?: number) => value === undefined ? 9 : value;',
            'export function partial<T>(combine: (value: T) => (items: T[]) => T) {',
            'return (value: T, items?: T[]) => (items === undefined ? combine(value) : combine(value)(items)); }'
        ].join('\n');
        const selectorOptions = { ...options, strict };
        const selectorFile = typescript.createSourceFile('selectors.ts', selectorCode, typescript.ScriptTarget.ESNext, true);
        const selectorHost = typescript.createCompilerHost(selectorOptions);
        const selectorProgram = typescript.createProgram(['selectors.ts'], selectorOptions, {
            ...selectorHost, getSourceFile: (name, version) => name === 'selectors.ts' ? selectorFile : selectorHost.getSourceFile(name, version)
        });
        assert.deepEqual(typescript.getPreEmitDiagnostics(selectorProgram), []);
        const selectorResult = createTypeScriptTransformer({ typescript, program: selectorProgram }).transform({ code: selectorCode, fileName: 'selectors.ts' });
        const { diagnostics: selectorDiagnostics = [], code: selectorOutput = '' } = selectorResult;
        assert.deepEqual(selectorDiagnostics, []);

        const selectors = [
            `const events = []; const failure = {}; const receiver = { owner: true };
        const api = { get choose() { events.push('get'); return function(value, key) {
            events.push([this === api, value === receiver ? 'receiver' : value, key]); return value; }; } };
        const values = [undefined, null, false, 0, '', { data: true }];
        const answers = values.map(value => namespace.receive.call(receiver, api, 'key', value));
        JSON.stringify({ answers, events, length: namespace.receive.length });`,
            `const failure = {}; const api = { get choose() { throw failure; } };
        let exact = false; try { namespace.receive.call({}, api, 'key', 0); } catch(error) { exact = error === failure; }
        JSON.stringify({ exact });`,
            `const events = []; const failure = {};
        const combine = value => { events.push(['combine', value]); return items => {
            events.push(['items', items]); if(items === null) throw failure; return items; }; };
        const selected = namespace.partial(combine); const outcomes = [];
        for (const items of [undefined, [], null, false, 0, '']) {
            try { const result = selected(3, items); outcomes.push(typeof result === 'function' ? 'partial' : result); }
            catch(error) { outcomes.push(error === failure); }
        }
        JSON.stringify({ outcomes, events, length: selected.length });`,
            `JSON.stringify([namespace.resolve(), namespace.resolve(undefined), namespace.resolve(0), namespace.resolve(false), namespace.resolve(''), namespace.resolve(null)]);`
        ];
        await Promise.all(selectors.map(async probe => assert.equal(await evaluate(selectorOutput, probe), await evaluate(selectorCode, probe))));
        const selectorConfig = { plugins: { resilient }, rules: { 'resilient/no-undefined-comparison': 'error' },
            linterOptions: { reportUnusedDisableDirectives: false } };
        assert.deepEqual(linter.verify(selectorOutput, selectorConfig), []);
        const fixed = linter.verifyAndFix(selectorOutput, { ...selectorConfig,
            rules: { ...resilient.configs.recommended.rules, ...resilient.configs.contracts.rules, ...resilient.configs.safety.rules } });
        const { messages: fixedMessages = [], output: fixedOutput = '' } = fixed;
        assert.equal(fixedMessages.filter(({ severity = 0 } = {}) => severity === 2).length, 0);
        await Promise.all(selectors.map(async probe => assert.equal(await evaluate(fixedOutput, probe), await evaluate(selectorCode, probe))));

        const rejectionCode = 'export function compare(value: unknown, undefined: unknown) { return value === undefined; }';
        const rejectionFile = typescript.createSourceFile('reject.ts', rejectionCode, typescript.ScriptTarget.ESNext, true);
        const rejectionProgram = typescript.createProgram(['reject.ts'], selectorOptions, {
            ...selectorHost, getSourceFile: (name, version) => name === 'reject.ts' ? rejectionFile : selectorHost.getSourceFile(name, version)
        });
        const rejected = collectPlacementEvidence({ typescript, sourceFile: rejectionFile, checker: rejectionProgram.getTypeChecker() });
        const { exactUndefined: rejectedFacts = new Set() } = rejected;
        assert.equal(rejectedFacts.size, 0, 'Shadowed undefined supplies no native absence evidence.');

        const mixedCode = 'export function combine(value?: object) { return [value === undefined ? {} : value, (1 as unknown) === undefined]; }';
        const mixedFile = typescript.createSourceFile('mixed.ts', mixedCode, typescript.ScriptTarget.ESNext, true);
        const mixedProgram = typescript.createProgram(['mixed.ts'], selectorOptions, {
            ...selectorHost, getSourceFile: (name, version) => name === 'mixed.ts' ? mixedFile : selectorHost.getSourceFile(name, version)
        });
        const mixedPlacement = compilePlacementDecisions({ typescript, evidence: collectPlacementEvidence({
            typescript, sourceFile: mixedFile, checker: mixedProgram.getTypeChecker()
        }) });
        // Test this placement owner directly so another grammar pass cannot erase
        // the deliberately unrelated selector before the scope falsifier observes it.
        const { transformed: [mixedTree = {}] = [] } = typescript.transform(mixedFile, [context => root => annotateCompletedReturnBoundaries({
            typescript, sourceFile: root, placement: mixedPlacement, context
        })]);
        const printed = typescript.createPrinter().printFile(mixedTree);
        const { outputText: mixedOutput = '' } = typescript.transpileModule(printed, {
            compilerOptions: { target: typescript.ScriptTarget.ESNext }
        });
        const mixedFindings = linter.verify(mixedOutput, selectorConfig);
        assert.equal(mixedFindings.length, 1, 'The nested boundary must leave an unrelated sibling comparison visible.');
        const [{ ruleId: mixedRule = '' } = {}] = mixedFindings;
        assert.equal(mixedRule, 'resilient/no-undefined-comparison');
    }));
}
