import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

import { ESLint } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';

import { annotateFinalExceptions } from '../transforms/typescript/grammar/final.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import {
    collectRequiredTupleBindingContracts,
    collectTypedIgnoredArgumentCallContracts
} from '../transforms/typescript/understand/type-evidence.js';

const source = [
    'const events: number[] = [];',
    'const mark = (value: number) => { events.push(value); if (value < 0) throw new Error("negative"); return value; };',
    'const ignored: (value: number) => number = () => 7;',
    'function read(value: number) { const result = ignored(mark(value)); return ignored(mark(result)); }',
    'function guarded(value: number) { if (value) { const result = ignored(mark(value)); return result; } return 0; }',
    'function expression(value: number) { ignored(mark(value)); }',
    'const arrow = (value: number) => ignored(mark(value));',
    'function tuple([callback]: [(value: number) => number]) { return ignored(callback(2)); }',
    'function nested(value: number) { return () => ignored(mark(value)); }',
    'const blockArrow = (value: number) => { const result = ignored(mark(value)); return result; };',
    'const parameterDefault = (value = ignored(mark(9))) => { return value; };',
    'const ordinary = (first: number, second: number) => first;',
    'function rejected(value: number) { return ordinary(value); }'
].join('\n');
const fileName = 'final-decision.ts';
const sourceFile = typescript.createSourceFile(fileName, source, typescript.ScriptTarget.ESNext, true);
const compilerHost = typescript.createCompilerHost({ noLib: true });
const host = {
    ...compilerHost,
    getSourceFile: (name, languageVersion) => name === fileName ? sourceFile : compilerHost.getSourceFile(name, languageVersion)
};
const program = typescript.createProgram([fileName], { noLib: true, strict: true }, host);
const checker = program.getTypeChecker();
const typedIgnoredArgumentCallContracts = collectTypedIgnoredArgumentCallContracts({ typescript, sourceFile, checker });
const requiredTupleBindingContracts = collectRequiredTupleBindingContracts({ typescript, sourceFile, checker });
const destructuringAgreements = collectDestructuringAgreements({
    typedIgnoredArgumentCallContracts, requiredTupleBindingContracts
});
const completedDecisions = compileDestructuringDecisions(destructuringAgreements);
const { byKey = new Map() } = completedDecisions;
let queriedRanges = [];
Object.defineProperty(byKey, 'get', { value: (key = '') => {
    queriedRanges = [...queriedRanges, key];

    return Map.prototype.get.call(byKey, key);
} });
const before = [...destructuringAgreements];
const { transformed: [placed = sourceFile] = [], dispose = () => {} } = typescript.transform(sourceFile, [context => root => (
    annotateFinalExceptions({ typescript, sourceFile: root, destructuringAgreements: completedDecisions, context })
)]);
const printed = typescript.createPrinter().printFile(placed);
dispose();
assert.deepEqual([...destructuringAgreements], before);
assert.equal(typedIgnoredArgumentCallContracts.size, 9);
assert.equal(requiredTupleBindingContracts.size, 1);
const statementCallRanges = [...typedIgnoredArgumentCallContracts.keys()].slice(0, 2);
statementCallRanges.forEach(range => assert.equal(queriedRanges.filter(key => key === range).length, 1));
const checkVariableQueries = (node = {}) => {
    if (typescript.isVariableStatement(node)) {
        const { pos = -1, end = -1 } = node;
        const range = `${pos}:${end}`;

        assert.equal(queriedRanges.filter(key => key === range).length, 1,
            'Each variable has one retained-binding owner, including direct block variables.');
    }

    typescript.forEachChild(node, checkVariableQueries);
};
checkVariableQueries(sourceFile);
assert.equal(printed.split('checker-declared parameters are ignored').length - 1, 9);
assert.match(printed, /const blockArrow = [\s\S]*?eslint-disable-next-line resilient\/signature-contract-call-site[\s\S]*?const result = ignored/);
assert.match(printed, /eslint-disable-next-line resilient\/signature-contract-call-site[^\n]*\nconst parameterDefault/);
assert.match(printed, /required tuple retains native missing-value failure/);
assert.doesNotMatch(printed.split('function rejected')[1], /eslint-disable-next-line/);

const transpile = (text = '') => typescript.transpileModule(text, {
    compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
}).outputText;
const originalJS = transpile(source);
const placedJS = transpile(printed);
const probe = [
    'const results = [read(2), guarded(0), guarded(3), arrow(4), tuple([value => value]), nested(5)(), blockArrow(8), parameterDefault()];',
    'expression(6);',
    'try { read(-1); } catch (error) { results.push(error.message); }',
    'try { tuple(undefined); } catch (error) { results.push(error.name); }',
    'JSON.stringify({ results, events });'
].join('\n');
assert.equal(runInNewContext(`${placedJS}\n${probe}`), runInNewContext(`${originalJS}\n${probe}`));
const lint = new ESLint({ overrideConfigFile: true, overrideConfig: [{
    plugins: { resilient }, rules: { 'resilient/signature-contract-call-site': 'error' }
}] });
const [raw = {}] = await lint.lintText(placedJS, { filePath: 'final-decision.js' });
const { messages = [] } = raw;
// This isolated annotation phase does not lower expression arrows. Its nested
// callback and the deliberate arity mismatch remain visible; do not broaden admission.
const callMessages = messages.filter(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-call-site');
assert.equal(callMessages.length, 2);
assert.match(callMessages[0].message, /ignored accepts at most 0 arguments/);
assert.match(callMessages[1].message, /ordinary requires second/);
assert.equal(raw.warningCount, 2);
const fixedLint = new ESLint({ overrideConfigFile: true, fix: true, overrideConfig: [{
    plugins: { resilient }, rules: { 'resilient/signature-contract-call-site': 'error' }
}] });
const [fixed = {}] = await fixedLint.lintText(placedJS, { filePath: 'final-decision.js' });
assert.deepEqual(fixed.messages.map(({ ruleId = '', message = '' } = {}) => ({ ruleId, message })),
    callMessages.map(({ ruleId = '', message = '' } = {}) => ({ ruleId, message })));
assert.equal(runInNewContext(`${fixed.output || placedJS}\n${probe}`), runInNewContext(`${originalJS}\n${probe}`));

const retainedReason = 'source-owned field retains its exact missing-value result';
const retainedCases = [
    { code: 'const { value } = input;', parentNodes: true, expectedQueries: 1, result: 'value' },
    { code: 'function read(input) { const { value } = input; return value; }', parentNodes: true,
        expectedQueries: 1, result: 'read(input)' },
    { code: 'if (ready) var { value } = input;', parentNodes: true, expectedQueries: 1, result: 'value' },
    { code: 'function read(input) { const { value } = input; return value; }', parentNodes: false,
        nativeFailure: true },
    { code: 'function read(input) { const { value } = input; return value; }', parentNodes: true,
        clone: true, expectedQueries: 2, result: 'read(input)' }
];
retainedCases.forEach(({ code = '', parentNodes = false, clone = false, nativeFailure = false,
    expectedQueries = 0, result = '' } = {}) => {
    const parsed = typescript.createSourceFile('retained-owner.ts', code, typescript.ScriptTarget.ESNext, parentNodes);
    let range = '';
    const markBinding = (node = {}) => {
        const { pos = -1, end = -1 } = node;

        if (typescript.isVariableStatement(node)) range = `${pos}:${end}`;

        if (typescript.isBindingElement(node)) Object.defineProperty(node, '__resilientAgreement', { value: retainedReason });

        typescript.forEachChild(node, markBinding);
    };
    markBinding(parsed);
    const decisions = compileDestructuringDecisions(new Map());
    const { byKey: indexedDecisions = new Map() } = decisions;
    let queries = [];
    Object.defineProperty(indexedDecisions, 'get', { value: (key = '') => {
        queries = [...queries, key];

        return Map.prototype.get.call(indexedDecisions, key);
    } });
    const place = () => typescript.transform(parsed, [context => (root) => {
        const update = (node = {}) => {
            if (clone && typescript.isVariableStatement(node)) {
                const { declarationList = {} } = node;
                const { declarations = [] } = declarationList;
                const list = typescript.factory.updateVariableDeclarationList(declarationList, [...declarations]);

                return typescript.factory.updateVariableStatement(node, [], list);
            }

            return typescript.visitEachChild(node, update, context);
        };
        const updated = clone ? typescript.visitNode(root, update) : root;

        return annotateFinalExceptions({ typescript, sourceFile: updated, destructuringAgreements: decisions, context });
    }]);

    if (nativeFailure) {
        assert.throws(place, /Could not determine parsed source file/);

        return;
    }

    const { transformed: [annotated = parsed] = [], dispose: release = () => {} } = place();
    const output = typescript.createPrinter().printFile(annotated);
    release();
    assert.equal(queries.filter(key => key === range).length, expectedQueries);
    assert.equal(output.split(retainedReason).length - 1, 1);
    assert.match(output, /eslint-disable-next-line resilient\/prefer-safe-destructuring-defaults/);
    [false, true].forEach((fail = false) => {
        const setup = `const events = []; const ready = true; const input = { get value() { events.push('Get'); ${
            fail ? 'throw new TypeError("field");' : 'return undefined;'
        } } };`;
        const evaluate = (text = '') => runInNewContext(`${setup}\ntry { ${text}\nJSON.stringify({ value: ${result}, events }); } catch (error) { JSON.stringify({ failure: error.name, events }); }`);

        assert.equal(evaluate(output), evaluate(code));
    });
});
