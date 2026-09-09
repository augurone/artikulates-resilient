import assert from 'node:assert/strict';

import typescript from 'typescript';

import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { createTypeScriptTupleSyntax } from '../transforms/typescript/understand/type-evidence.js';

const standard = Object.fromEntries(['object', 'array', 'function'].map(name => (
    [name, new URL(`../rules/support/${name}.js`, import.meta.url).href]
)));
const compile = (code = '') => {
    const fileName = 'tuple-return-scope.ts';
    const sourceFile = typescript.createSourceFile(fileName, code, typescript.ScriptTarget.ESNext, true);
    const options = { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext, strict: true };
    const host = typescript.createCompilerHost(options);
    const program = typescript.createProgram([fileName], options, {
        ...host,
        getSourceFile: (name, version, ...rest) => name === fileName ? sourceFile : host.getSourceFile(name, version, ...rest)
    });
    const result = createTypeScriptTransformer({ typescript, program, standard }).transform({ code, fileName });
    const { diagnostics = [], code: output = '' } = result;

    assert.deepEqual(program.getSemanticDiagnostics(), []);
    assert.deepEqual(diagnostics, []);

    return { sourceFile, output };
};
const missing = () => { throw new Error('Required tuple scope proof capability is missing.'); };
const load = code => import(`data:text/javascript,${encodeURIComponent(code)}`);
const variants = [
    '',
    'function unrelated() { return 1; }',
    'const unrelated = () => 1;',
    'const unrelated = function () { return 1; };',
    'function unrelated() { function deeper() { return false; } return 1; }',
    'if (value) { function unrelated() { return 1; } }',
    'const unrelated = { read() { return 1; }, get result() { return false; }, set result(value: boolean) { return; } };',
    'class Unrelated { constructor() { return; } read() { return 1; } get result() { return false; } }'
];

await variants.reduce(async (previous, nested) => {
    await previous;
    const { sourceFile = {}, output = '' } = compile(`export function outer([value]: [number]) { ${nested} return [value]; }`);
    const { statements: [outer = {}] = [] } = sourceFile;
    const { getReturnExpressions = missing } = createTypeScriptTupleSyntax({ typescript });
    const paths = getReturnExpressions(outer).map(node => node.getText(sourceFile));

    assert.deepEqual(paths, ['[value]'], nested);
    assert.match(output, /hasArrayContent\(tuple\)/u);

    const { outer: run = missing } = await load(output);

    assert.deepEqual(run([3]), [3]);
    assert.deepEqual(run([]), []);
    assert.deepEqual(run(), []);
}, Promise.resolve());

// Excluding a nested body must not exclude the result of an actual call to it.
const called = 'export function outer([value]: [number]) { function inner(input: number) { return [input]; } return inner(value); }';
const { sourceFile: calledSource = {}, output: calledOutput = '' } = compile(called);
const { statements: [calledOuter = {}] = [] } = calledSource;
const { getReturnExpressions = missing } = createTypeScriptTupleSyntax({ typescript });

assert.deepEqual(getReturnExpressions(calledOuter).map(node => node.getText(calledSource)), ['inner(value)']);
const { outer: calledRun = missing } = await load(calledOutput);

assert.deepEqual(calledRun([7]), [7]);
assert.match(calledOutput, /hasArrayContent\(tuple\)/u);
assert.deepEqual(calledRun(), []);

// A nested declaration's local bindings must not replace an outer binding
// used by the return-family resolver, even when both have the same spelling.
const { output: shadowedOutput = '' } = compile([
    'export function outer([value]: [number]) { const result = [value];',
    'function inner() { const result = 1; return result; } return result; }'
].join('\n'));
const { outer: shadowedRun = missing } = await load(shadowedOutput);
assert.match(shadowedOutput, /hasArrayContent\(tuple\)/u);
assert.deepEqual(shadowedRun([9]), [9]);
assert.deepEqual(shadowedRun(), []);
