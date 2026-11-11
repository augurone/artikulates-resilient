import { deepStrictEqual, doesNotThrow, strictEqual } from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptEmitTransformer, createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { fixture } from './support/compiler-source.js';

const observe = async (code) => {
    try {
        const { run = false } = await import(`data:text/javascript,${encodeURIComponent(code)}`);

        return { value: await run() };
    } catch ({ name = '', message = '' }) {
        return { error: name, message };
    }
};
const emit = ({ program = {}, sourceFile = {} } = {}, before = []) => {
    let outputs = [];
    const { emitSkipped = true, diagnostics = [] } = program.emit(sourceFile, (name, code) => { outputs = [...outputs, code]; },
        { isCancellationRequested: () => false, throwIfCancellationRequested: () => false }, false, { before });

    strictEqual(emitSkipped, false);
    deepStrictEqual(diagnostics, []);
    strictEqual(outputs.length, 1);

    return outputs.at(0);
};
const fixes = code => new Linter().verifyAndFix(code, [resilient.configs.recommended,
    resilient.configs.contracts, resilient.configs.safety]).output;
const cases = [
    ['shadowed constant', 'const value=1;{const value=2;}return value;', { value: 1 }],
    ['shadowed mutable binding', 'let value=1;{let value=2;value=3;}return value;', { value: 1 }],
    ['sibling scopes', 'const result=[];{const value=1;result.push(value);}{const value=2;result.push(value);}return result;', { value: [1, 2] }],
    ['outer and inner closures', 'const value=1;const read=()=>value;{const value=2;return [read(),(()=>value)()];}', { value: [1, 2] }],
    ['closure excludes later inner binding', 'const read=()=>typeof value;{const value=2;return read();}', { value: 'undefined' }],
    ['unbound closure stays unbound', 'const read=()=>value;{const value=2;return read();}', { error: 'ReferenceError', message: 'value is not defined' }],
    ['escaped sibling closures', 'const result=[];{const value=1;result.push(()=>value);}{const value=2;result.push(()=>value);}return result.map(read=>read());', { value: [1, 2] }],
    ['temporal dead zone', '{return value;const value=2;}', { error: 'ReferenceError', message: "Cannot access 'value' before initialization" }],
    ['catch and finally scopes', 'const value=1;try{{const value=2;throw value;}}catch(value){return value;}finally{{const value=3;}}', { value: 2 }],
    ['destructured aliases', 'const {value}= {value:1};{const {value}={value:2};}return value;', { value: 1 }],
    ['nested function declaration', 'function read(){return 1;}{function read(){return 2;}}return read();', { value: 1 }],
    ['inverted guard retains suffix TDZ',
        'const input=1;const check=(value:number)=>true;if(check(input)){return input?typeof value:"other";}const value=42;return "suffix";',
        { error: 'ReferenceError', message: "Cannot access 'value' before initialization" }],
    ['inverted guard retains captured suffix TDZ',
        'const input=1;const check=(value:number)=>true;const read=()=>typeof value;if(check(input)){return input?read():"other";}const value=42;return "suffix";',
        { error: 'ReferenceError', message: "Cannot access 'value' before initialization" }],
    ['inverted guard retains class TDZ',
        'const input=1;const check=(value:number)=>true;if(check(input)){return input?typeof Value:"other";}class Value{}return "suffix";',
        { error: 'ReferenceError', message: "Cannot access 'Value' before initialization" }],
    ['inverted guard retains hoisted function', 'const input=1;const check=(value:number)=>true;if(check(input)){return input?read():0;}function read(){return 42;}return 0;', { value: 42 }],
    ['inverted guard false path', 'const input=1;const check=(value:number)=>false;if(check(input)){return input?typeof value:"other";}const value=42;return value;', { value: 42 }],
    ['labelled completion control', 'const value=1;outer:{{const value=2;break outer;}}return value;', { value: 1 }]
];

cases.forEach(([name = '', body = '', expected = {}] = []) => test(`block ownership: ${name}`, async () => {
    const source = `export const run=()=>{${body}};`;
    const acquired = fixture(source);
    const { typescript = {}, program = {}, filename = '', sourceFile = {} } = acquired;
    const text = sourceFile.getFullText();
    const native = emit(acquired);

    deepStrictEqual(await observe(native), expected, 'Independent native Program.emit expectation');
    const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({ code: source, fileName: filename });

    deepStrictEqual(diagnostics, []);
    const emitter = createTypeScriptEmitTransformer({ typescript, program });

    deepStrictEqual(emitter.prepare({ fileNames: [filename] }).diagnostics, []);
    const { before = false } = emitter;
    const emitted = emit(acquired, [before]);

    await Promise.all([code, fixes(code), emitted, fixes(emitted)].map(async (output) => {
        deepStrictEqual(await observe(output), expected, output);
    }));

    strictEqual(sourceFile.getFullText(), text, 'Caller compiler source stays unchanged');
}));

[1000, 10000].forEach(width => test(`statement width: ${width} inert statements preserve native completion`, async () => {
    const source = `export const run=()=>{${'0;'.repeat(width)}return 42;};`;
    const acquired = fixture(source);
    const { typescript = {}, program = {}, filename = '' } = acquired;
    const transformer = createTypeScriptTransformer({ typescript, program });
    const expected = { value: 42 };

    deepStrictEqual(await observe(emit(acquired)), expected);
    doesNotThrow(() => transformer.transform({ code: source, fileName: filename }), 'Statement width must not consume the JavaScript recursion stack');
    const { code = '', diagnostics = [] } = transformer.transform({ code: source, fileName: filename });

    deepStrictEqual(diagnostics, []);
    deepStrictEqual(await observe(code), expected);
    const emitter = createTypeScriptEmitTransformer({ typescript, program });
    const { before = false } = emitter;
    const emitted = emit(acquired, [before]);

    deepStrictEqual(await observe(emitted), expected);
}));
