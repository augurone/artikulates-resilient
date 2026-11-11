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
const before = [...destructuringAgreements];
const { transformed: [placed = sourceFile] = [], dispose = () => {} } = typescript.transform(sourceFile, [context => root => (
    annotateFinalExceptions({ typescript, sourceFile: root, destructuringAgreements: completedDecisions, context })
)]);
const printed = typescript.createPrinter().printFile(placed);
dispose();
assert.deepEqual([...destructuringAgreements], before);

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
assert.equal(callMessages.length, 2, JSON.stringify({ messages, placedJS }));
assert.match(callMessages[0].message, /ignored accepts at most 0 arguments/);
assert.match(callMessages[1].message, /ordinary requires second/);
assert.equal(raw.warningCount, 2, JSON.stringify({ messages, placedJS }));
const fixedLint = new ESLint({ overrideConfigFile: true, fix: true, overrideConfig: [{
    plugins: { resilient }, rules: { 'resilient/signature-contract-call-site': 'error' }
}] });
const [fixed = {}] = await fixedLint.lintText(placedJS, { filePath: 'final-decision.js' });
assert.deepEqual(fixed.messages.map(({ ruleId = '', message = '' } = {}) => ({ ruleId, message })),
    callMessages.map(({ ruleId = '', message = '' } = {}) => ({ ruleId, message })));
assert.equal(runInNewContext(`${fixed.output || placedJS}\n${probe}`), runInNewContext(`${originalJS}\n${probe}`));
