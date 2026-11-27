import { deepStrictEqual, doesNotThrow, strictEqual } from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Linter } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptEmitTransformer, createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

const observe = async (code) => {
    const { run = false } = await import(`data:text/javascript,${encodeURIComponent(code)}`);

    return run();
};
const render = (program, before = []) => {
    let outputs = [];
    const { emitSkipped = true, diagnostics = [] } = program.emit(undefined, (name, code) => { outputs = [...outputs, code]; },
        { isCancellationRequested: () => false, throwIfCancellationRequested: () => false }, false, { before });

    strictEqual(emitSkipped, false);
    deepStrictEqual(diagnostics, []);
    strictEqual(outputs.length, 1);

    return outputs.at(0);
};

// eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Each test supplies its native expected value; a fallback would hide a missing oracle or impose a different family.
const verify = async (context, { expression = '', expected, target = typescript.ScriptTarget.ESNext,
    module = typescript.ModuleKind.ESNext, moduleResolution = typescript.ModuleResolutionKind.Bundler,
    noLib = true, prepared = false, verbatimModuleSyntax = false } = {}) => {
    const directory = mkdtempSync(join(tmpdir(), 'resilient-emitted-syntax-'));

    context.after(() => rmSync(directory, { recursive: true, force: true }));
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
    const fileName = join(directory, 'main.ts');
    const source = `/* artifact comment */export const run=()=>${expression};`;

    writeFileSync(fileName, source);
    const program = typescript.createProgram([fileName], { target, module, moduleResolution, noLib, verbatimModuleSyntax });
    const sourceFile = program.getSourceFile(fileName);
    const { flags = 0 } = sourceFile;
    const originalText = sourceFile.getFullText();

    deepStrictEqual(program.getSyntacticDiagnostics(), []);
    deepStrictEqual(await observe(render(program)), expected);
    const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({ code: source, fileName });

    deepStrictEqual(diagnostics, []);
    deepStrictEqual(await observe(code), expected);
    const emitter = createTypeScriptEmitTransformer({ typescript, program });

    if (prepared) {
        const report = emitter.prepare({ fileNames: [fileName] });
        const { diagnostics: preparedDiagnostics = [], results: [result = {}] = [] } = report;

        deepStrictEqual(preparedDiagnostics, []);

        // eslint-disable-next-line resilient/prefer-safe-transformations -- This caller-owned report is deliberately edited to prove it cannot replace the private emission artifact.
        Object.assign(result, { code: 'throw "caller report";', diagnostics: [{ text: 'caller note' }] });
    }

    const { before = false } = emitter;
    let output = '';

    doesNotThrow(() => { output = render(program, [before]); }, 'Generated syntax must not become original Program checker evidence');
    deepStrictEqual(await observe(output), expected);
    strictEqual(output.includes('artifact comment'), true);
    const fixed = new Linter().verifyAndFix(output, [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety]);
    const { output: fixedCode = '' } = fixed;

    deepStrictEqual(await observe(fixedCode), expected);
    strictEqual(render(program, [before]), output, 'Repeated callbacks own fresh artifact syntax');
    strictEqual(sourceFile.getFullText(), originalText);
    const { flags: currentFlags = 0 } = sourceFile;

    strictEqual(currentFlags, flags, 'Caller Program node flags remain unchanged');
};

[
    ['[1].map(value=>value).slice()', [1]],
    ['[1].map(value=>value)[0]', 1],
    ['[1].reduce((memo,value)=>({value}),{value:0}).value', 1],
    ['(()=>({value:42}))().value', 42],
    ['Array.from([1],value=>value).slice()', [1]],
    ['Promise.resolve([1]).then(value=>value).then(value=>value[0])', 1]

// eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Every literal fixture row supplies its heterogeneous native oracle; a fallback would change that expected contract.
].forEach(([expression = '', expected] = []) => [false, true].forEach(prepared => test(
    `emitted syntax owns callback composition: ${expression}/${prepared}`,
    context => verify(context, { expression, expected, prepared })
)));

[
    [typescript.ModuleKind.ESNext, typescript.ModuleResolutionKind.Bundler],
    [typescript.ModuleKind.ES2022, typescript.ModuleResolutionKind.Bundler],
    [typescript.ModuleKind.NodeNext, typescript.ModuleResolutionKind.NodeNext]
].forEach(([module = 0, moduleResolution = 0] = []) => [typescript.ScriptTarget.ES2016, typescript.ScriptTarget.ESNext].forEach(target => (
    [false, true].forEach(noLib => [false, true].forEach(verbatimModuleSyntax => test(
        `emitted syntax preserves compiler options: ${module}/${target}/${noLib}/${verbatimModuleSyntax}`, context => verify(context, {
            expression: '[1].map(value=>value).slice()', expected: [1], prepared: true, target, module, moduleResolution, noLib, verbatimModuleSyntax
        })
    )))
)));
