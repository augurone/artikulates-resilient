import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import typescript from 'typescript';

import { createTypeScriptEmitTransformer } from 'eslint-plugin-resilient/typescript';

const graphs = [
    ['live default alias', [
        ['leaf', 'let value=1;export {value as default};export const update=()=>{value=2;};'],
        ['main', 'import *as api from "./leaf.js";const first=api.default;export const run=()=>{api.update();return [first,api.default];};']
    ], { value: [1, 2] }],
    ['default snapshot', [
        ['leaf', 'let value=1;\n// snapshot marker\nexport default value; // snapshot tail\nexport const update=()=>{value=2;};export const current=()=>value;'],
        ['main', 'import value,{update,current} from "./leaf.js";export const run=()=>{update();return [value,current()];};']
    ], { value: [1, 2] }],
    ['named default reexport', [
        ['leaf', 'export default function read(){return 42;}'],
        ['barrel', 'export {default as read} from "./leaf.js";'],
        ['main', 'import {read} from "./barrel.js";export const run=()=>read();']
    ], { value: 42 }],
    ['namespace reexport', [
        ['leaf', 'export const value=42;'],
        ['barrel', 'export *as api from "./leaf.js";'],
        ['main', 'import {api} from "./barrel.js";export const run=()=>api.value;']
    ], { value: 42 }],
    ['star reexport', [
        ['leaf', 'export const value=42;'],
        ['barrel', 'export *from "./leaf.js";'],
        ['main', 'import {value} from "./barrel.js";export const run=()=>value;']
    ], { value: 42 }],
    ['cyclic default snapshot', [
        ['leaf', 'export const read=()=>42;'],
        ['worker', 'import {read} from "./leaf.js";import "./peer.js";export default read;'],
        ['peer', 'import read from "./worker.js";export default read;'],
        ['main', 'import read from "./worker.js";export const run=()=>read();']
    ], { error: 'ReferenceError' }],
    ['cyclic live alias', [
        ['leaf', 'export const read=()=>42;'],
        ['worker', 'export {read as default} from "./leaf.js";import "./peer.js";'],
        ['peer', 'import read from "./worker.js";export default read;'],
        ['main', 'import read from "./worker.js";export const run=()=>read();']
    ], { value: 42 }],
    ['explicit type erasure', [
        ['leaf', 'export const value=42;'],
        ['types', 'export type Marker=number;throw new Error("type-only dependency executed");'],
        ['barrel', 'export type {Marker} from "./types.js";export {value} from "./leaf.js";'],
        ['main', 'import {value} from "./barrel.js";export const run=()=>value;']
    ], { value: 42 }]
];
const exportNames = (code) => {
    const { statements = [] } = typescript.createSourceFile('output.js', code, typescript.ScriptTarget.ESNext, true, typescript.ScriptKind.JS);

    return statements.flatMap((node) => {
        const { exportClause = false, modifiers = [], name: { text = '' } = {}, declarationList: { declarations = [] } = {} } = node;

        if (typescript.isExportAssignment(node)) return ['default'];

        if (typescript.isExportDeclaration(node) && !exportClause) return ['*'];

        if (typescript.isExportDeclaration(node)) {
            const { name: { text: namespace = '' } = {}, elements = [] } = exportClause;

            return typescript.isNamespaceExport(exportClause) ? [namespace] : elements.map(({ name: { text = '' } = {} } = {}) => text);
        }

        if (!modifiers.some(({ kind = 0 } = {}) => kind === typescript.SyntaxKind.ExportKeyword)) return [];

        if (modifiers.some(({ kind = 0 } = {}) => kind === typescript.SyntaxKind.DefaultKeyword)) return ['default'];

        return text ? [text] : declarations.map(({ name: { text = '' } = {} } = {}) => text);
    }).toSorted();
};
const observe = directory => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    `let result;try{const {run}=await import(${JSON.stringify(pathToFileURL(join(directory, 'main.js')).href)});`
    + 'result={value:await run()};}catch(error){result={error:error.name};}process.stdout.write(JSON.stringify(result));'
], { encoding: 'utf8', timeout: 30000 }));

graphs.forEach(([name = '', entries = [], expected = {}] = []) => [typescript.ScriptTarget.ES2016, typescript.ScriptTarget.ESNext].forEach(target => (
    [false, true].forEach(verbatimModuleSyntax => [false, true].forEach(prepared => test(
        `Program emit preserves ${name}: target=${target}, verbatim=${verbatimModuleSyntax}, prepared=${prepared}`, (context) => {
            const directory = mkdtempSync(join(tmpdir(), 'resilient-program-exports-'));

            context.after(() => rmSync(directory, { recursive: true, force: true }));
            writeFileSync(join(directory, 'package.json'), '{"type":"module"}\n');
            ['source', 'native', 'emitted'].forEach(name => mkdirSync(join(directory, name)));
            entries.forEach(([file = '', code = ''] = []) => writeFileSync(join(directory, 'source', file + '.ts'), code));
            const fileNames = entries.map(([file = ''] = []) => join(directory, 'source', file + '.ts'));
            const options = { target, verbatimModuleSyntax, module: typescript.ModuleKind.ESNext, lib: ['lib.esnext.d.ts'], strict: true };
            const program = typescript.createProgram(fileNames, options);

            deepStrictEqual(program.getSyntacticDiagnostics(), []);
            const originalTexts = fileNames.map(fileName => program.getSourceFile(fileName).getFullText());
            const render = (variant, customTransformers = {}) => fileNames.forEach((fileName) => {
                const source = program.getSourceFile(fileName);
                const { emitSkipped = true, diagnostics = [] } = program.emit(source, (name, code) => (
                    writeFileSync(join(directory, variant, basename(name)), code)
                ), { isCancellationRequested: () => false, throwIfCancellationRequested: () => false }, false, customTransformers);

                strictEqual(emitSkipped, false);
                deepStrictEqual(diagnostics, []);
            });

            render('native');
            const emitter = createTypeScriptEmitTransformer({ typescript, program });

            if (prepared) {
                const { diagnostics = [] } = emitter.prepare({ fileNames: fileNames.toReversed() });

                deepStrictEqual(diagnostics, []);
            }

            const { before = false } = emitter;

            render('emitted', { before: [before] });
            entries.forEach(([file = '', source = ''] = []) => {
                const native = readFileSync(join(directory, 'native', file + '.js'), 'utf8');
                const emitted = readFileSync(join(directory, 'emitted', file + '.js'), 'utf8');

                deepStrictEqual(exportNames(emitted), exportNames(native), file);
                ['snapshot marker', 'snapshot tail'].filter(marker => source.includes(marker))
                    .forEach(marker => strictEqual(emitted.includes(marker), true, marker));
            });
            deepStrictEqual(observe(join(directory, 'native')), expected);
            deepStrictEqual(observe(join(directory, 'emitted')), expected);
            deepStrictEqual(fileNames.map(fileName => program.getSourceFile(fileName).getFullText()), originalTexts);
        }
    )))
)));
