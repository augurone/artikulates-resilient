import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { ESLint } from 'eslint';
import typescript from 'typescript';

import production from 'eslint-plugin-resilient/production';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

const compilerOptions = { strict: true, target: typescript.ScriptTarget.ESNext,
    module: typescript.ModuleKind.ESNext, verbatimModuleSyntax: true };
const dependencies = (code) => {
    const { statements = [] } = typescript.createSourceFile('output.js', code, typescript.ScriptTarget.Latest, true);

    return statements.filter(node => typescript.isImportDeclaration(node) || typescript.isExportDeclaration(node))
        .flatMap(({ moduleSpecifier: { text = '' } = {} } = {}) => text ? [text] : []);
};
const emitGraph = async (context, entries, options = compilerOptions, ownsProgram = true) => {
    const directory = mkdtempSync(join(tmpdir(), 'resilient-module-emission-'));

    context.after(() => rmSync(directory, { recursive: true, force: true }));
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}\n');
    ['source', 'native', 'raw', 'fixed'].forEach(name => mkdirSync(join(directory, name)));
    entries.forEach(([name = '', code = ''] = []) => writeFileSync(join(directory, 'source', `${name}.ts`), code));
    const program = typescript.createProgram(entries.map(([name = ''] = []) => join(directory, 'source', `${name}.ts`)), options);
    const transformer = createTypeScriptTransformer({ typescript, ...(ownsProgram ? { program } : {}) });
    const emitted = entries.map(([name = '', code = ''] = []) => {
        const { outputText: native = '' } = typescript.transpileModule(code, { compilerOptions: options });
        const { code: raw = '', diagnostics = [] } = transformer.transform({ code, fileName: join(directory, 'source', `${name}.ts`) });

        deepStrictEqual(diagnostics, [], name);
        writeFileSync(join(directory, 'native', `${name}.js`), native);
        writeFileSync(join(directory, 'raw', `${name}.js`), raw);

        return { name, native, raw };
    });
    // Every dependency exists before the production host observes the graph.
    const engine = new ESLint({ cwd: directory, overrideConfigFile: true, fix: true, overrideConfig: production({ cwd: directory }) });
    const completed = await Promise.all(emitted.map(async ({ name = '', native = '', raw = '' } = {}) => {
        const filePath = join(directory, 'raw', `${name}.js`);
        const [{ output = raw, messages = [] } = {}] = await engine.lintText(raw, { filePath });

        writeFileSync(join(directory, 'fixed', `${name}.js`), output);

        return { name, native, raw, fixed: output, messages };
    }));

    return { directory, emitted: completed };
};
const observe = (directory, program) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', [
    `const base=${JSON.stringify(pathToFileURL(directory + '/').href)};`,
    'const load=name=>import(new URL(name+".js",base));', program
].join('\n')], { encoding: 'utf8', timeout: 30000 }));
const variants = ['native', 'raw', 'fixed'];
const state = 'export const events:string[]=[];export const failure={};';
const effect = (name, failed) => `import {events,failure} from "./state.js";events.push("${name}");`
    + `export const ${name}=1;${failed ? 'throw failure;' : 'void failure;'}`;

['', 'first', 'third', 'fifth'].forEach(failed => test(`module emission preserves mixed dependency effects and failure: ${failed || 'normal'}`, async (context) => {
    const source = [
        'export {first} from "./z-first.js";',
        'import {second} from "./a-second.js";',
        'export * from "./m-third.js";',
        'import {events} from "./state.js";',
        'export * as fourth from "./b-fourth.js";',
        'export {} from "./c-fifth.js";',
        'events.push("body");export {second};'
    ].join('\n');
    const names = ['first', 'second', 'third', 'fourth', 'fifth'];
    const entries = [['state', state], ['main', source], ...['z-first', 'a-second', 'm-third', 'b-fourth', 'c-fifth']
        .map((file, index) => [file, effect(names.at(index), failed === names.at(index))])];
    const { directory = '', emitted = [] } = await emitGraph(context, entries);
    const expected = failed ? names.slice(0, names.indexOf(failed) + 1) : [...names, 'body'];
    const observation = [
        'const {events,failure}=await load("state");',
        'let exactFailure=false;try{await load("main");}catch(error){exactFailure=error===failure;}',
        'process.stdout.write(JSON.stringify({events,exactFailure}));'
    ].join('\n');

    variants.forEach(variant => deepStrictEqual(observe(join(directory, variant), observation), { events: expected, exactFailure: Boolean(failed) }, variant));
    emitted.forEach(({ name = '', native = '', raw = '', fixed = '' } = {}) => {
        deepStrictEqual(dependencies(raw), dependencies(native), name);
        deepStrictEqual(dependencies(fixed), dependencies(native), name);
    });
}));

[
    ['live alias', 'export {read as default} from "./leaf.js";import "./peer.js";', { value: 42 }],
    ['snapshot', 'import {read} from "./leaf.js";import "./peer.js";export default read;', { error: 'ReferenceError' }],
    ['peer before live alias', 'import "./peer.js";export {read as default} from "./leaf.js";', { error: 'ReferenceError' }],
    ['named hoisted default', 'import "./peer.js";export default function read(){return 42;}', { value: 42 }],
    ['anonymous hoisted default', 'import "./peer.js";export default function(){return 42;}', { value: 42 }]
].forEach(([name = '', worker = '', expected = {}] = []) => test(`module emission preserves cyclic default initialization: ${name}`, async (context) => {
    const { directory = '' } = await emitGraph(context, [
        ['leaf', 'export const read=()=>42;'], ['worker', worker],
        ['peer', 'import read from "./worker.js";export default read;'],
        ['main', 'import read from "./worker.js";export const run=()=>read();']
    ]);
    const observation = [
        'let result;try{const entry=await load("main");result={ value: entry.run() };}catch(error){result={error:error.name};}',
        'process.stdout.write(JSON.stringify(result));'
    ].join('\n');

    variants.forEach(variant => deepStrictEqual(observe(join(directory, variant), observation), expected, variant));
}));

[false, true].forEach(verbatimModuleSyntax => test(`module emission retains the compiler's empty re-export policy: ${verbatimModuleSyntax}`, async (context) => {
    const { directory = '', emitted = [] } = await emitGraph(context, [
        ['state', state], ['empty', effect('first', false)], ['after', effect('second', false)],
        ['erased', 'throw "type-only dependency executed";export interface Marker{ value: string; }'],
        ['main', 'export {} from "./empty.js";export type {Marker} from "./erased.js";import "./after.js";']
    ], { ...compilerOptions, verbatimModuleSyntax });
    const observation = 'const {events}=await load("state");await load("main");process.stdout.write(JSON.stringify(events));';
    const expected = verbatimModuleSyntax ? ['first', 'second'] : ['second'];

    variants.forEach(variant => deepStrictEqual(observe(join(directory, variant), observation), expected, variant));
    emitted.forEach(({ name = '', native = '', raw = '', fixed = '' } = {}) => {
        deepStrictEqual(dependencies(raw), dependencies(native), name);
        deepStrictEqual(dependencies(fixed), dependencies(native), name);
    });
}));

const importBindings = (code) => {
    const { statements = [] } = typescript.createSourceFile('output.js', code, typescript.ScriptTarget.Latest, true);

    return statements.filter(typescript.isImportDeclaration).map(({ moduleSpecifier: { text = '' } = {},
        importClause: { name: { text: local = '' } = {}, namedBindings: { name: { text: namespace = '' } = {}, elements = [] } = {} } = {} } = {}) => ({
        source: text, local, namespace, named: elements.map(({ name: { text: local = '' } = {}, propertyName: { text: imported = local } = {} } = {}) => ({ local, imported }))
    }));
};
[
    ['default', 'import read from "./dependency.js";', true],
    ['namespace', 'import * as api from "./dependency.js";', true],
    ['named', 'import {read} from "./dependency.js";', true],
    ['inline type', 'import {type Marker} from "./dependency.js";', true],
    ['type-only default', 'import type read from "./dependency.js";', false],
    ['type-only namespace', 'import type * as api from "./dependency.js";', false],
    ['type-only named', 'import type {Marker} from "./dependency.js";', false]
].forEach(([name = '', statement = '', runtime = false] = []) => [false, true].forEach(verbatimModuleSyntax => (
    test(`module emission preserves unused ${name} import boundaries: ${verbatimModuleSyntax}`, async (context) => {
        const { directory = '', emitted = [] } = await emitGraph(context, [
            ['state', state],
            ['dependency', 'import {events,failure} from "./state.js";events.push("dependency");throw failure;'
                + 'export default function read(){return 42;}export {read};export interface Marker{ value: number; }'],
            ['main', statement + 'export const answer=42;']
        ], { ...compilerOptions, verbatimModuleSyntax });
        const observation = [
            'const {events,failure}=await load("state");',
            'let result;try{const entry=await load("main");result={answer:entry.answer};}catch(error){result={exactFailure:error===failure};}',
            'process.stdout.write(JSON.stringify({events,...result}));'
        ].join('\n');
        const expected = verbatimModuleSyntax && runtime ? { events: ['dependency'], exactFailure: true } : { events: [], answer: 42 };

        variants.forEach(variant => deepStrictEqual(observe(join(directory, variant), observation), expected, variant));
        emitted.forEach(({ name = '', native = '', raw = '', fixed = '' } = {}) => {
            deepStrictEqual(importBindings(raw), importBindings(native), name);
            deepStrictEqual(importBindings(fixed), importBindings(native), name);
        });
    })
)));

test('module dependency width and relay depth retain one ordered request per source edge', async (context) => {
    const sizes = [[4, 4], [4, 12], [12, 4], [12, 12]];
    const leaves = Array.from({ length: 12 }, (unused, index) => [`leaf${index}`,
        `import {events} from "./state.js";events.push(${index});export const value${index}=42;`]);
    const relays = sizes.flatMap(([width = 0, depth = 0] = []) => Array.from({ length: depth }, (unused, level) => {
        const next = level ? `export * from "./relay${width}_${depth}_${level - 1}.js";` : '';
        const requests = Array.from({ length: width }, (unused, index) => index % 2
            ? `import "./leaf${index}.js";` : `export * from "./leaf${index}.js";`);

        return [`relay${width}_${depth}_${level}`, next + requests.join('')];
    }));
    const { directory = '', emitted = [] } = await emitGraph(context, [['state', 'export const events:number[]=[];'], ...leaves, ...relays]);

    emitted.forEach(({ name = '', native = '', raw = '', fixed = '' } = {}) => {
        deepStrictEqual(dependencies(raw), dependencies(native), name);
        deepStrictEqual(dependencies(fixed), dependencies(native), name);
        strictEqual(dependencies(raw).length, dependencies(native).length);
    });
    sizes.forEach(([width = 0, depth = 0] = []) => variants.forEach((variant) => {
        const observation = `const {events}=await load("state");await load("relay${width}_${depth}_${depth - 1}");process.stdout.write(JSON.stringify(events));`;

        deepStrictEqual(observe(join(directory, variant), observation), Array.from({ length: width }, (unused, index) => index));
    }));
});

const namespaceCases = [
    ['dependency effects', [
        ['state', 'export const events:string[]=[];'],
        ['leaf', 'import {events} from "./state.js";events.push("leaf");export const value=1;'],
        ['later', 'import {events} from "./state.js";events.push("later");'],
        ['main', 'import *as api from "./leaf.js";import "./later.js";import {events} from "./state.js";export const snapshot=api.value;export const run=()=>events;']
    ], { value: ['leaf', 'later'] }],
    ['exported snapshot mutation', [
        ['leaf', 'export let value=1;export const advance=()=>{value=2;};'],
        ['snapshot', 'import *as api from "./leaf.js";export const snapshot=api.value;'],
        ['main', 'import {snapshot} from "./snapshot.js";import {advance} from "./leaf.js";export const run=()=>{advance();return snapshot;};']
    ], { value: 1 }],
    ['mixed declaration retention', [
        ['leaf', 'export const left=1;export const right=2;'],
        ['main', 'import *as api from "./leaf.js";const {left,right}=api,answer=42;export const run=()=>[left,right,answer];']
    ], { value: [1, 2, 42] }],
    ['live re-export control', [
        ['leaf', 'export let value=1;export const advance=()=>{value=2;};'],
        ['snapshot', 'export {value as snapshot} from "./leaf.js";'],
        ['main', 'import {snapshot} from "./snapshot.js";import {advance} from "./leaf.js";export const run=()=>{advance();return snapshot;};']
    ], { value: 2 }],
    ['shared binding diamond control', [
        ['leaf', 'export const value=42;'],
        ['left', 'export {value as snapshot} from "./leaf.js";'],
        ['right', 'export {value as snapshot} from "./leaf.js";'],
        ['barrel', 'export * from "./left.js";export * from "./right.js";'],
        ['main', 'import {snapshot} from "./barrel.js";export const run=()=>snapshot;']
    ], { value: 42 }],
    ['snapshot mutation', [
        ['leaf', 'export let value=1;export const advance=()=>{value=2;};'],
        ['main', 'import * as api from "./leaf.js";export const snapshot=api.value;export const run=()=>{api.advance();return snapshot;};']
    ], { value: 1 }],
    ['combined default binding', [
        ['leaf', 'export default function read(){return 42;}export const value=1;'],
        ['main', 'import read,*as api from "./leaf.js";export const snapshot=api.value;export const run=()=>read();']
    ], { value: 42 }],
    ['combined retained namespace', [
        ['leaf', 'export default function read(){return 42;}export const value=1;export const other=()=>0;'],
        ['main', 'import read,*as api from "./leaf.js";const snapshot=api.value;export const run=()=>[read(),snapshot,api.other()];']
    ], { value: [42, 1, 0] }],
    ['shadowed namespace', [
        ['leaf', 'export const value=1;'],
        ['main', 'import *as api from "./leaf.js";export const snapshot=api.value;'
            + 'const select=(api:{value:number})=>{const selected=api.value;return selected;};export const run=()=>select({value:42});']
    ], { value: 42 }],
    ['snapshot export identity', [
        ['leaf', 'export const value=42;'],
        ['left', 'import *as api from "./leaf.js";export const snapshot=api.value;'],
        ['right', 'import *as api from "./leaf.js";export const snapshot=api.value;'],
        ['barrel', 'export * from "./left.js";export * from "./right.js";'],
        ['main', 'import {snapshot} from "./barrel.js";export const run=()=>snapshot;']
    ], { error: 'SyntaxError' }],
    ['snapshot initialization cycle', [
        ['leaf', 'import "./peer.js";export const value=42;'],
        ['peer', 'import *as api from "./leaf.js";export const snapshot=api.value;'],
        ['main', 'import {value} from "./leaf.js";export const run=()=>value;']
    ], { error: 'ReferenceError' }]
];
namespaceCases.forEach(([name = '', entries = [], expected = {}] = []) => [
    ['programless', false, false], ['program', true, false], ['verbatim program', true, true]
].forEach(([mode = '', ownsProgram = false, verbatimModuleSyntax = false] = []) => test(
    `namespace module emission preserves ${name}: ${mode}`, async (context) => {
        const { directory = '' } = await emitGraph(context, entries, { ...compilerOptions, verbatimModuleSyntax }, ownsProgram);
        const observation = 'let result;try{const entry=await load("main");result={ value: entry.run() };}catch(error){result={error:error.name};}process.stdout.write(JSON.stringify(result));';

        variants.forEach(variant => deepStrictEqual(observe(join(directory, variant), observation), expected, variant));
    }
)));

[false, true].forEach(ownsProgram => test(`namespace snapshot absence stays fluent and locally scoped: ${ownsProgram}`, async (context) => {
    const { directory = '', emitted = [] } = await emitGraph(context, [
        ['leaf', 'export let read=<T>(value:T):T=>value;'],
        ['main', 'import *as api from "./leaf.js";export const snapshot=api.read;export const run=()=>snapshot(42);']
    ], { ...compilerOptions, verbatimModuleSyntax: false }, ownsProgram);
    const [{ raw = '', messages = [] } = {}] = emitted.filter(({ name = '' } = {}) => name === 'main');

    deepStrictEqual(messages, []);
    variants.forEach(variant => deepStrictEqual(observe(join(directory, variant),
        'const entry=await load("main");process.stdout.write(JSON.stringify(entry.run()));'), 42, variant));
    const engine = new ESLint({ cwd: directory, overrideConfigFile: true, overrideConfig: production({ cwd: directory }) });
    const [{ messages: neighboring = [] } = {}] = await engine.lintText(raw + '\nexport const {missing}={};\n', {
        filePath: join(directory, 'raw', 'main.js')
    });

    strictEqual(neighboring.filter(({ ruleId = '' } = {}) => ruleId === 'resilient/prefer-safe-destructuring-defaults').length, 1);
}));

[false, true].forEach(ownsProgram => test(`namespace snapshots preserve authored defaults-rule scope: ${ownsProgram}`, async (context) => {
    const { directory = '', emitted = [] } = await emitGraph(context, [
        ['leaf', 'export let read=<T>(value:T):T=>value;'],
        ['main', 'import *as api from "./leaf.js";\n'
            + '/* eslint-disable resilient/prefer-safe-destructuring-defaults -- Authored absence contract. */\n'
            + 'export const snapshot=api.read;\nexport const {missing}={};']
    ], { ...compilerOptions, verbatimModuleSyntax: false }, ownsProgram);
    const [{ raw = '', messages = [] } = {}] = emitted.filter(({ name = '' } = {}) => name === 'main');

    strictEqual(messages.filter(({ ruleId = '' } = {}) => ruleId === 'resilient/prefer-safe-destructuring-defaults').length, 0);
    const engine = new ESLint({ cwd: directory, overrideConfigFile: true, overrideConfig: production({ cwd: directory }) });
    const [{ messages: after = [] } = {}] = await engine.lintText(raw + '\nexport const {untouched}={};\n', {
        filePath: join(directory, 'raw', 'main.js')
    });

    strictEqual(after.filter(({ ruleId = '' } = {}) => ruleId === 'resilient/prefer-safe-destructuring-defaults').length, 0);
}));
