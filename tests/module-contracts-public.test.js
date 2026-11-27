import { deepStrictEqual, rejects, strictEqual, throws, ok } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { ESLint } from 'eslint';

import resilient from 'eslint-plugin-resilient';
import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { append } from './support/collections.js';
import { counter } from './support/work.js';

// Static module binding/initialization and selected roots share source identity. Native ESM observations, resolution/revision failures, ownership and graph bounds remain.

{
    const source = 'import { dispatch as read } from "barrel";read(42);';
    const acquire = dependency => createAnalysis({ source, filename: 'main', resolveModule: ({ source: name = '' } = {}) => ({
        filename: name, source: name === 'barrel' ? 'export { consume as dispatch } from "worker";' : dependency
    }) });

    const modulesFor = (source, entries) => {
        const modules = new Map(entries);

        return createAnalysis({ source, filename: 'main', resolveModule: ({ source: name = '' } = {}) => modules.has(name)
            ? { filename: name, source: modules.get(name) } : { available: false } });
    };

    test('export initialization cannot contribute return sites to an importing function', () => {
        const worker = 'import {get as external} from "opaque";export const get=external;';
        const prefix = 'import * as api from "worker";const run=()=>{';
        const cases = [
            ['if(value)return {};return {};', ['object'], 0],
            ['if(value)return {};return 1;', ['number', 'object'], 2],
            ['if(value)return {};', ['nullish', 'object'], 2],
            ['if(value)throw 1;return {};', ['object'], 0],
            ['try {if(value)return {};}finally{return {};}', ['object'], 0]
        ];

        cases.flatMap(([body = '', ...expected] = []) => [
            [prefix + 'const {value=0}=api.get();' + body + '};', ...expected],
            [prefix + body.replaceAll('value', 'api.get().value') + '};', ...expected]
        ]).forEach(([source = '', expected = [], count = 0] = []) => {
            const analysis = modulesFor(source, [['worker', worker]]);
            const { fact: { families = [] } = {}, diagnostics = [], returns = [] } = analysis.checkFunction({ index: 0 });

            deepStrictEqual(families.toSorted(), expected);
            strictEqual(diagnostics.length, count);
            returns.forEach(({ location: { range: [start = 0] = [] } = {} } = {}) => {
                strictEqual(start > source.indexOf('const run'), true, 'Return locations belong to the importing function');
            });
        });
    });

    [
        ['direct primitive', 'import {value} from "worker";value.trim();', [['worker', 'export const value=42;']], ['number']],
        ['default primitive', 'import value from "worker";value.trim();', [['worker', 'export default 42;']], ['number']],
        ['namespace primitive', 'import * as api from "worker";const {value=0}=api;value.trim();', [['worker', 'export const value=42;']], ['number']],
        ['computed primitive', 'import {value} from "worker";value.trim();', [['worker', 'export const value=1+2;']], ['number']],
        ['supplied null', 'import {value} from "worker";value.trim();', [['worker', 'export const value=null;']], ['nullish']],
        ['catch-pattern sibling', 'import {value} from "worker";value.trim();',
            [['worker', 'export const value=42;export const inspect=fn=>{try{return fn();}catch({message=""}){return message;}};']], ['number']],
        ['arguments sibling', 'import {value} from "worker";value.trim();',
            [['worker', 'export const value=42;export const inspect=function(){return arguments[0];};']], ['number']],
        ['mutable export', 'import {value} from "worker";value.trim();', [['worker', 'export let value=42;']], []],
        ['failed initialization', 'import {value} from "worker";value.trim();', [['worker', 'throw 1;export const value=42;']], []],
        ['shared object fields', 'import {value} from "worker";value.name.trim();', [['worker', 'export const value={name:42};']], []],
        ['star primitive', 'import {value} from "barrel";value.trim();', [['worker', 'export const value=42;'], ['barrel', 'export * from "worker";']], ['number']],
        ['cyclic initialization', 'import {value} from "worker";value.trim();',
            [['worker', 'import {other} from "peer";export const value=other;'], ['peer', 'import {value} from "worker";export const other=value;']], []]
    ].forEach(([name = '', source = '', modules = [], expected = []] = []) => test(`ESM value transport: ${name}`, () => {
        const analysis = modulesFor(source, modules);
        const { memberAccesses = [] } = analysis;
        const { index = -1 } = memberAccesses.find(({ name = '' } = {}) => name === 'trim');

        deepStrictEqual(analysis.checkMemberAccess({ index }).conflicts, expected);
    }));

    [
        ['star contract', [['barrel', 'export * from "worker";']], 'contradiction'],
        ['explicit export wins', [['barrel', 'export * from "worker";export {other as read} from "peer";'], ['peer', 'export const other=(value=0)=>value;']], 'agreement'],
        ['distinct bindings are ambiguous', [['barrel', 'export * from "worker";export * from "peer";'], ['peer', 'export const read=(value=0)=>value;']], 'unknown'],
        ['diamond shares one binding', [['barrel', 'export * from "worker";export * from "peer";'], ['peer', 'export {read} from "worker";']], 'contradiction'],
        ['import alias shares one binding', [['barrel', 'export * from "worker";export * from "peer";'], ['peer', 'import {read as fn} from "worker";export {fn as read};']], 'contradiction'],
        ['unresolved star remains open', [['barrel', 'export * from "worker";export * from "missing";']], 'unknown'],
        ['default does not cross a star', [['barrel', 'export * from "worker";'], ['worker', 'export default (value="")=>value;']], 'unknown'],
        ['grounded star cycle', [['barrel', 'export * from "worker";export * from "peer";'], ['peer', 'export * from "barrel";']], 'contradiction']
    ].forEach(([name = '', modules = [], expected = ''] = []) => test(`ESM export identity: ${name}`, () => {
        const source = name === 'default does not cross a star' ? 'import read from "barrel";read(42);' : 'import {read} from "barrel";read(42);';
        const analysis = modulesFor(source, [['worker', 'export const read=(value="")=>value;'], ...modules]);

        strictEqual(analysis.checkCall({ index: 0 }).status, expected);
    }));

    test('imported signatures own their contract while callers own supplied values', () => {
        const first = acquire('throw new Error("SOURCE MUST NOT EXECUTE");export const consume=(value="")=>value;');
        const second = acquire('export const consume=(value=0)=>value;');
        const before = first.checkCall({ index: 0 });
        const { status = '' } = before;

        strictEqual(status, 'contradiction');
        strictEqual(second.checkCall({ index: 0 }).status, 'agreement');
        strictEqual(first.checkCallResult({ index: 0, required: 'number' }).status, 'unknown');
        deepStrictEqual(first.checkCall({ index: 0 }), before);
        strictEqual(acquire('export let consume=(value="")=>value;consume=external;').checkCall({ index: 0 }).status, 'unknown');
        strictEqual(acquire('export function consume(value=""){return value;}eval("consume=external");').checkCall({ index: 0 }).status, 'unknown');
        strictEqual(acquire('const consume=(value="")=>value;export {consume as "other"};').checkCall({ index: 0 }).status, 'unknown');
        const failure = new Error('required module read failed');

        throws(() => createAnalysis({ source, resolveModule: () => { throw failure; } }), error => error === failure);
        throws(() => createAnalysis({ source, resolveModule: () => ({ filename: 'worker', source: false }) }), TypeError);
    });

    test('source-owned arity dispatch crosses a module boundary without caller facts entering its proof', () => {
        const dependency = 'export function consume(value,callback){switch(arguments.length){case 1:return value;case 2:return callback(value);}}';
        const first = acquire(dependency);
        const second = acquire(dependency.replace('case 1:return value', 'case 1:return callback'));

        strictEqual(first.checkCall({ index: 0 }).status, 'agreement');
        strictEqual(second.checkCall({ index: 0 }).status, 'contradiction');
        strictEqual(first.checkCall({ index: 0 }).status, 'agreement');
    });

    test('imported arity proof distinguishes nested arguments owners from dynamic captures', () => {
        const source = 'export const consume=function(value,callback){switch(arguments.length){case 1:return function(){return value(arguments[0]);};}};';
        const first = acquire(source);

        strictEqual(first.checkCall({ index: 0 }).status, 'agreement');
        strictEqual(acquire(source.replace('return value(arguments[0])', 'return callback(arguments[0])')).checkCall({ index: 0 }).status, 'contradiction');
        strictEqual(acquire(source.replace('return value(arguments[0])', 'return eval("callback")')).checkCall({ index: 0 }).status, 'contradiction');
        strictEqual(first.checkCall({ index: 0 }).status, 'agreement');
    });

    test('the product rule observes imported signature revisions and keeps diagnostics at the use', async (context) => {
        const directory = mkdtempSync(join(tmpdir(), 'resilient-call-signatures-'));

        context.after(() => rmSync(directory, { recursive: true, force: true }));
        const worker = join(directory, 'worker.js');
        const barrel = join(directory, 'barrel.js');
        const main = join(directory, 'main.js');
        const source = 'import {dispatch as read} from "./barrel.js";read(42);';
        const engine = new ESLint({ cwd: directory, overrideConfigFile: true, overrideConfig: {
            plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' }
        } });

        writeFileSync(barrel, 'export { consume as dispatch } from "./worker.js";');
        writeFileSync(worker, 'throw new Error("SOURCE MUST NOT EXECUTE");export const consume=(value="")=>value;');
        const [{ messages: first = [] } = {}] = await engine.lintText(source, { filePath: main });

        strictEqual(first.length, 1);
        const [{ messageId = '', column = 0, endColumn = 0 } = {}] = first;

        strictEqual(messageId, 'mismatch');
        strictEqual(source.slice(column - 1, endColumn - 1), '42');
        writeFileSync(worker, 'export const consume=(value=0)=>value;');
        const [{ messages: changed = [] } = {}] = await engine.lintText(source, { filePath: main });

        deepStrictEqual(changed, []);
    });

    test('quoted star exports and namespace imports have separate identities through barrels', () => {
        const worker = 'const consume=(value="")=>value;export {consume as "*"};export const number=42;';
        const modules = [['worker', worker], ['barrel', 'export * from "worker";']];
        const reads = [
            'import { "*" as read } from "barrel";import * as api from "barrel";read(42);api.number.trim();',
            'import * as api from "barrel";import { "*" as read } from "barrel";read(42);api.number.trim();'
        ];

        reads.forEach((source) => {
            const analysis = modulesFor(source, modules);
            const { memberAccesses = [] } = analysis;
            const { index = -1 } = memberAccesses.find(({ name = '' } = {}) => name === 'trim');

            strictEqual(analysis.checkCall({ index: 0 }).status, 'contradiction');
            deepStrictEqual(analysis.checkMemberAccess({ index }).conflicts, ['number']);
        });
    });

    const reexportCases = [
        ['shared diamond', [['a', 'export * from "leaf";'], ['b', 'export {read} from "leaf";'], ['top', 'export * from "a";export * from "b";']],
            [['leaf', 'contradiction'], ['a', 'contradiction'], ['b', 'contradiction'], ['top', 'contradiction']]],
        ['imported alias', [['a', 'import {read as fn} from "leaf";export {fn as read};'], ['top', 'export * from "a";export * from "leaf";']],
            [['a', 'contradiction'], ['top', 'contradiction']]],
        ['empty route', [['empty', 'export const other=1;'], ['top', 'export * from "empty";export * from "leaf";']],
            [['empty', 'unknown'], ['top', 'contradiction']]],
        ['unresolved route', [['a', 'export * from "missing";'], ['top', 'export * from "a";export * from "leaf";']],
            [['a', 'unknown'], ['leaf', 'contradiction'], ['top', 'unknown']]],
        ['ambiguous route', [['other', 'export const read=(value=0)=>value;'], ['top', 'export * from "leaf";export * from "other";']],
            [['leaf', 'contradiction'], ['other', 'agreement'], ['top', 'unknown']]],
        ['explicit override', [['other', 'export const read=(value=0)=>value;'], ['top', 'export * from "leaf";export {read} from "other";']],
            [['leaf', 'contradiction'], ['other', 'agreement'], ['top', 'agreement']]],
        ['grounded cycle', [['a', 'export * from "b";export * from "leaf";'], ['b', 'export * from "a";']],
            [['a', 'contradiction'], ['b', 'contradiction'], ['leaf', 'contradiction']]],
        ['ambiguous cycle', [['a', 'export * from "b";export * from "leaf";'], ['b', 'export * from "a";export * from "other";'],
            ['other', 'export const read=(value=0)=>value;']], [['a', 'unknown'], ['b', 'unknown'], ['leaf', 'contradiction'], ['other', 'agreement']]],
        ['unresolved cycle', [['a', 'export * from "b";export * from "leaf";'], ['b', 'export * from "a";export * from "missing";']],
            [['a', 'unknown'], ['b', 'unknown'], ['leaf', 'contradiction']]],
        ['ungrounded cycle beside a binding', [['a', 'export * from "b";'], ['b', 'export * from "a";'], ['top', 'export * from "a";export * from "leaf";']],
            [['a', 'unknown'], ['b', 'unknown'], ['top', 'contradiction']]]
    ];

    reexportCases.forEach(([name = '', entries = [], queries = []] = []) => test(`completed re-export cache preserves ${name} in either import order`, () => {
        [false, true].forEach((reverse) => {
            const selected = reverse ? queries.toReversed() : queries;
            const source = selected.map(([name = ''] = [], index) => `import {read as read${index}} from "${name}";`).join('')
                + selected.map((unused, index) => `read${index}(42);`).join('');
            const analysis = modulesFor(source, [['leaf', 'export const read=(value="")=>value;'], ...entries]);
            const expected = selected.map(([, status = ''] = []) => status);
            const results = analysis.calls.map(({ index = -1 } = {}) => analysis.checkCall({ index }).status);

            deepStrictEqual(results, expected);
            deepStrictEqual(analysis.calls.toReversed().map(({ index = -1 } = {}) => analysis.checkCall({ index }).status), expected.toReversed());
        });
    }));

    test('native ESM agrees on shared cyclic bindings ambiguity and unresolved routes', async (context) => {
        mkdirSync(new URL('../.artifacts/', import.meta.url), { recursive: true });
        const directory = mkdtempSync(new URL('../.artifacts/reexport-cache-', import.meta.url));

        context.after(() => rmSync(directory, { recursive: true, force: true }));
        const modules = [
            ['leaf', 'export const read=(value="")=>value;'], ['other', 'export const read=(value=0)=>value;'],
            ['a', 'export * from "./b.mjs";export * from "./leaf.mjs";'], ['b', 'export * from "./a.mjs";'],
            ['diamond', 'export * from "./a.mjs";export * from "./b.mjs";'],
            ['ambiguous', 'export * from "./a.mjs";export * from "./other.mjs";'],
            ['unresolved', 'export * from "./a.mjs";export * from "./missing.mjs";']
        ];

        modules.forEach(([name = '', source = ''] = []) => writeFileSync(join(directory, `${name}.mjs`), source));
        const [leaf = {}, a = {}, b = {}, diamond = {}, ambiguous = {}] = await Promise.all(
            ['leaf', 'a', 'b', 'diamond', 'ambiguous'].map(name => import(pathToFileURL(join(directory, `${name}.mjs`)).href))
        );
        const { read: expected = false } = leaf;

        [a, b, diamond].forEach(({ read = false } = {}) => strictEqual(read, expected));
        strictEqual(Object.hasOwn(ambiguous, 'read'), false);
        await rejects(import(pathToFileURL(join(directory, 'unresolved.mjs')).href), { code: 'ERR_MODULE_NOT_FOUND' });
    });

    const defaultExportCases = [
        ['separate snapshots', 'import {read} from "leaf";export default read;', 'import {read} from "leaf";export default read;', 'unknown'],
        ['snapshot beside live alias', 'import {read} from "leaf";export default read;', 'export {read as default} from "leaf";', 'unknown'],
        ['local snapshot beside named export', 'export const read=(value="")=>value;export default read;', 'export {read as default} from "a";', 'unknown'],
        ['live imported aliases', 'import {read} from "leaf";export {read as default};', 'export {read as default} from "leaf";', 'contradiction'],
        ['shared snapshot diamond', 'import {read} from "leaf";export default read;', 'export {default} from "a";', 'contradiction'],
        ['named default function alias', 'export default function read(value=""){return value;}export {read};', 'export {read as default} from "a";', 'contradiction']
    ];
    const defaultExportModules = (a, b, cyclic) => [
        ['leaf', 'export const read=(value="")=>value;'], ['a', a], ['b', b],
        ['left', 'export {default as read} from "a";'], ['right', 'export {default as read} from "b";'],
        ['top', `export * from "left";export * from "right";${cyclic ? 'export * from "peer";' : ''}`],
        ['peer', 'export * from "top";']
    ];

    defaultExportCases.forEach(([name = '', a = '', b = '', expected = ''] = []) => test(`default export binding identity: ${name}`, () => {
        [false, true].forEach(cyclic => [false, true].forEach((reverse) => {
            const queries = [['top', expected], ['left', 'contradiction'], ['right', 'contradiction'], ['peer', expected]];
            const selected = reverse ? queries.toReversed() : queries;
            const source = selected.map(([name = ''] = [], index) => `import {read as read${index}} from "${name}";`).join('')
                + selected.map((unused, index) => `read${index}(42);`).join('');
            const analysis = modulesFor(source, defaultExportModules(a, b, cyclic));
            const statuses = selected.map(([, status = ''] = []) => status);

            deepStrictEqual(analysis.calls.map(({ index = -1 } = {}) => analysis.checkCall({ index }).status), statuses);
            deepStrictEqual(analysis.calls.toReversed().map(({ index = -1 } = {}) => analysis.checkCall({ index }).status), statuses.toReversed());
        }));
    }));

    test('default export binding identity retains value callable namespace and failure boundaries', () => {
        const entries = [
            ['leaf', 'export const read=(value="")=>value;export const value=42;'],
            ['callable', 'import {read} from "leaf";export default read;'],
            ['number', 'const value=42;export default value;'],
            ['namespace', 'import * as api from "leaf";export default api;'],
            ['mutable', 'let read=(value="")=>value;export default read;read=external;'],
            ['failed', 'throw 1;const value=42;export default value;'],
            ['shared', 'const value={name:42};export default value;']
        ];

        [
            ['import read from "callable";read(42);', 'contradiction'],
            ['import * as api from "callable";api.default(42);', 'contradiction'],
            ['import api from "namespace";api.read(42);', 'contradiction'],
            ['import read from "mutable";read(42);', 'unknown']
        ].forEach(([source = '', status = ''] = []) => strictEqual(modulesFor(source, entries).checkCall({ index: 0 }).status, status));
        [
            ['import value from "number";value.trim();', ['number']],
            ['import value from "failed";value.trim();', []],
            ['import value from "shared";value.name.trim();', []]
        ].forEach(([source = '', expected = []] = []) => {
            const analysis = modulesFor(source, entries);
            const { index = -1 } = analysis.memberAccesses.find(({ name = '' } = {}) => name === 'trim');

            deepStrictEqual(analysis.checkMemberAccess({ index }).conflicts, expected);
        });
    });

    test('native ESM distinguishes default snapshot bindings from live aliases', async (context) => {
        mkdirSync(new URL('../.artifacts/', import.meta.url), { recursive: true });
        const directory = mkdtempSync(new URL('../.artifacts/default-export-', import.meta.url));

        context.after(() => rmSync(directory, { recursive: true, force: true }));
        await Promise.all(defaultExportCases.map(async ([name = '', a = '', b = '', expected = ''] = [], index) => {
            const prefix = join(directory, String(index));

            mkdirSync(prefix);
            defaultExportModules(a, b, true).forEach(([name = '', source = ''] = []) => (
                writeFileSync(join(prefix, `${name}.mjs`), source.replaceAll(/"([a-z]+)"/gu, '"./$1.mjs"'))
            ));
            writeFileSync(join(prefix, 'consumer.mjs'), 'import {read} from "./top.mjs";export const value=read(42);');
            const [left = {}, right = {}, top = {}, peer = {}] = await Promise.all(
                ['left', 'right', 'top', 'peer'].map(name => import(pathToFileURL(join(prefix, `${name}.mjs`)).href))
            );
            const { read: first = false } = left;
            const { read: second = false } = right;

            strictEqual(first, second, name);
            [top, peer].forEach(namespace => strictEqual(Object.hasOwn(namespace, 'read'), expected !== 'unknown', name));

            if (expected === 'unknown') {
                await rejects(import(pathToFileURL(join(prefix, 'consumer.mjs')).href), SyntaxError);

                return;
            }

            const { value = false } = await import(pathToFileURL(join(prefix, 'consumer.mjs')).href);

            strictEqual(value, 42);
        }));
    });

    test('default export binding revisions retain diagnostic ownership and prior session answers', async (context) => {
        const directory = mkdtempSync(join(tmpdir(), 'resilient-default-revisions-'));

        context.after(() => rmSync(directory, { recursive: true, force: true }));
        const a = 'import {read} from "leaf";export default read;';
        const snapshot = 'import {read} from "leaf";export default read;';
        const alias = 'export {default} from "a";';
        const source = 'import {read} from "./top.js";read(42);';
        const analysisSource = source.replace('./top.js', 'top');
        const before = modulesFor(analysisSource, defaultExportModules(a, snapshot, true));
        const engine = new ESLint({ cwd: directory, overrideConfigFile: true, overrideConfig: {
            plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' }
        } });

        defaultExportModules(a, snapshot, true).forEach(([name = '', source = ''] = []) => (
            writeFileSync(join(directory, `${name}.js`), source.replaceAll(/"([a-z]+)"/gu, '"./$1.js"'))
        ));
        const [{ messages: ambiguous = [] } = {}] = await engine.lintText(source, { filePath: join(directory, 'main.js') });

        deepStrictEqual(ambiguous, []);
        writeFileSync(join(directory, 'b.js'), alias.replace('"a"', '"./a.js"'));
        const [{ messages: resolved = [] } = {}] = await engine.lintText(source, { filePath: join(directory, 'main.js') });

        strictEqual(resolved.length, 1);
        const [{ messageId = '', column = 0, endColumn = 0 } = {}] = resolved;

        strictEqual(messageId, 'mismatch');
        strictEqual(source.slice(column - 1, endColumn - 1), '42');
        strictEqual(modulesFor(analysisSource, defaultExportModules(a, alias, true)).checkCall({ index: 0 }).status, 'contradiction');
        strictEqual(before.checkCall({ index: 0 }).status, 'unknown');
        writeFileSync(join(directory, 'b.js'), snapshot.replace('"leaf"', '"./leaf.js"'));
        const [{ messages: restored = [] } = {}] = await engine.lintText(source, { filePath: join(directory, 'main.js') });

        deepStrictEqual(restored, []);
    });
}

{
    const states = [
        ['snapshot', 'import {read} from "leaf";export default read;', '', true, 'value'],
        ['live alias', 'export {read as default} from "leaf";', '', true, 'value'],
        ['throw before snapshot', 'import {read} from "leaf";throw 1;export default read;', '', false, 'throw'],
        ['throw after snapshot', 'import {read} from "leaf";export default read;throw 1;', '', false, 'throw'],
        ['throw beside alias', 'export {read as default} from "leaf";throw 1;', '', false, 'throw'],
        ['throwing side dependency', 'import {read} from "leaf";import "bad";export default read;', '', false, 'throw'],
        ['default snapshot cycle', 'import {read} from "leaf";import "peer";export default read;',
            'import value from "worker";export default value;', false, 'tdz'],
        // A live alias cycle executes in this native witness. Initialization-cycle
        // demand deliberately remains unresolved; reachability alone cannot prove it.
        ['live alias cycle', 'export {read as default} from "leaf";import "peer";',
            'import value from "worker";export default value;', false, 'value']
    ];
    const modulesFor = (worker, peer = '') => [
        ['leaf', 'export const read=(value="")=>42;export const number=42;'], ['worker', worker], ['peer', peer], ['bad', 'throw 1;'],
        ['left', 'export {default as read} from "worker";'], ['right', 'export {default as read} from "worker";'],
        ['barrel', 'export * from "left";export * from "right";']
    ];
    const acquire = (source, entries) => {
        const modules = new Map(entries);

        return createAnalysis({ source, filename: 'main', resolveModule: ({ source = '' } = {}) => modules.has(source)
            ? { filename: source, source: modules.get(source) } : { available: false } });
    };
    const trims = analysis => analysis.memberAccesses.filter(({ name = '' } = {}) => name === 'trim')
        .map(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }));
    const forms = [
        ['direct', '', 'read(42)'], ['alias', 'const alias=read;', 'alias(42)'],
        ['closure', 'const invoke=()=>read(42);', 'invoke()'], ['field', 'const {read:alias}={read};', 'alias(42)']
    ];

    states.forEach(([name = '', worker = '', peer = '', known = false] = []) => test(`import initialization preserves ${name} through aliases and diamonds`, () => {
        forms.forEach(([, prefix = '', expression = ''] = []) => [false, true].forEach((reverse) => {
            const imports = ['import read from "worker";', 'import {read as other} from "barrel";'];
            const source = (reverse ? imports.toReversed() : imports).join('') + prefix + `${expression}.trim();other(42).trim();`;
            const analysis = acquire(source, modulesFor(worker, peer));

            if (reverse) analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCallResult({ index, required: 'string' }));

            const before = trims(analysis);

            deepStrictEqual(before.map(({ conflicts = [] } = {}) => conflicts), [known ? ['number'] : [], known ? ['number'] : []]);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(trims(analysis), before);
        }));
    }));

    test('import initialization separates direct signature obligations from result execution', () => {
        states.forEach(([, worker = '', peer = '', known = false] = []) => {
            const analysis = acquire('import read from "worker";const alias=read;alias(42);', modulesFor(worker, peer));
            const result = analysis.checkCallResult({ index: 0, required: 'number' });
            const { status = '', fact: { families = [] } = {} } = result;

            strictEqual(status, known ? 'agreement' : 'unknown');
            deepStrictEqual(families, known ? ['number'] : []);
            strictEqual(analysis.checkCall({ index: 0 }).status, 'contradiction');
            deepStrictEqual(analysis.checkCallResult({ index: 0, required: 'number' }), result);
        });
    });

    test('configured caller inputs survive unresolved routes without proving imported results', () => {
        ['[]', '"valid"'].forEach((input) => {
            const source = 'export const read=value=>value.toUpperCase();';
            const consumer = `import read from "worker";read(${input});`;
            const modules = new Map([['leaf', source], ['consumer', consumer], ['worker', 'export {read as default} from "leaf";import "consumer";']]);
            const analysis = createAnalysis({ source, filename: 'leaf', roots: [{ filename: 'consumer', source: consumer }],
                resolveModule: ({ source = '' } = {}) => ({ filename: source, source: modules.get(source) }) });
            const { memberAccesses: [{ index = -1 } = {}] = [] } = analysis;

            deepStrictEqual(analysis.checkMemberAccess({ index }).conflicts, input === '[]' ? ['array'] : []);
        });
    });

    test('import initialization gates namespaces primitive values and returned aliases', () => {
        [false, true].forEach((failed) => {
            const worker = `import * as api from "leaf";${failed ? 'throw 1;' : ''}export default api;`;
            const modules = modulesFor(worker);
            const namespace = acquire('import api from "worker";const alias=api;alias.read(42).trim();alias.number.trim();', modules);

            deepStrictEqual(trims(namespace).map(({ conflicts = [] } = {}) => conflicts), [failed ? [] : ['number'], failed ? [] : ['number']]);
            ['api.number', 'api.read(42)'].forEach((expression) => {
                const generic = acquire(`import api from "worker";const run=()=>${expression};`, modules);
                const { normal = false, fact: { families = [] } = {} } = generic.checkFunction({ index: 0 });

                strictEqual(normal, !failed);
                deepStrictEqual(families, failed ? [] : ['number']);
            });
            const values = acquire('import {number} from "worker";number.trim();', [
                ['leaf', 'export const number=42;'], ['worker', `export {number} from "leaf";${failed ? 'throw 1;' : ''}`]
            ]);

            deepStrictEqual(trims(values).map(({ conflicts = [] } = {}) => conflicts), [failed ? [] : ['number']]);
            const returned = acquire('import read from "worker";const relay=()=>read;const alias=relay();alias(42).trim();',
                modulesFor(`import {read} from "leaf";${failed ? 'throw 1;' : ''}export default read;`));

            deepStrictEqual(trims(returned).map(({ conflicts = [] } = {}) => conflicts), [failed ? [] : ['number']]);
        });
        const analysis = acquire('import read from "worker";const run=()=>{const value=flag?read():42;return value.trim();};',
            modulesFor(states.at(6).at(1), states.at(6).at(2)));

        deepStrictEqual(trims(analysis).map(({ conflicts = [] } = {}) => conflicts), [['number']]);
    });

    const directoryFor = (context) => {
        mkdirSync(new URL('../.artifacts/', import.meta.url), { recursive: true });
        const directory = mkdtempSync(new URL('../.artifacts/module-initialization-', import.meta.url));

        context.after(() => rmSync(directory, { recursive: true, force: true }));

        return directory;
    };
    const writeModules = (directory, entries) => entries.forEach(([name = '', source = ''] = []) => (
        writeFileSync(join(directory, `${name}.mjs`), source.replaceAll(/"([a-z]+)"/gu, '"./$1.mjs"'))
    ));

    test('native ESM distinguishes failing default snapshots from live initialized aliases', async (context) => {
        const directory = directoryFor(context);

        await Promise.all(states.map(async ([name = '', worker = '', peer = '', , outcome = ''] = [], index) => {
            const target = join(directory, String(index));

            mkdirSync(target);
            writeModules(target, [...modulesFor(worker, peer), ['main', 'import {read} from "barrel";const alias=read;export const result=alias(42);']]);
            const load = () => import(pathToFileURL(join(target, 'main.mjs')).href);

            if (outcome === 'throw') {
                await rejects(load, error => error === 1, name);

                return;
            }

            if (outcome === 'tdz') {
                await rejects(load, ReferenceError, name);

                return;
            }

            const { result = false } = await load();

            strictEqual(result, 42, name);
        }));
    });

    test('import initialization revisions preserve configured finding ownership and old sessions', async (context) => {
        const directory = directoryFor(context);
        const source = 'import read from "./worker.js";read(42).trim();';
        const worker = 'import {read} from "leaf";export default read;';
        const engine = new ESLint({ cwd: directory, overrideConfigFile: true, overrideConfig: {
            plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-operation': 'error', 'resilient/signature-contract-call-site': 'error' }
        } });
        // The JavaScript module host admits .js; native witnesses above own .mjs.
        const write = body => modulesFor(body).forEach(([name = '', source = ''] = []) => (
            writeFileSync(join(directory, `${name}.js`), source.replaceAll(/"([a-z]+)"/gu, '"./$1.js"'))
        ));
        const prior = acquire(source.replace('./worker.js', 'worker'), modulesFor(worker));
        const before = trims(prior);

        write(worker);
        const [{ messages: known = [] } = {}] = await engine.lintText(source, { filePath: join(directory, 'main.js') });

        strictEqual(known.length, 2);
        write(worker + 'throw 1;');
        const [{ messages: failed = [] } = {}] = await engine.lintText(source, { filePath: join(directory, 'main.js') });

        strictEqual(failed.length, 1);
        const [{ ruleId = '', column = 0, endColumn = 0 } = {}] = failed;

        strictEqual(ruleId, 'resilient/signature-contract-call-site');
        strictEqual(source.slice(column - 1, endColumn - 1), '42');
        deepStrictEqual(trims(prior), before);
        write(worker);
        const [{ messages: restored = [] } = {}] = await engine.lintText(source, { filePath: join(directory, 'main.js') });

        deepStrictEqual(restored, known);
    });

    test('interrupted import initialization retries without publishing a partial result', () => {
        [states.at(0), states.at(6)].forEach(([, worker = '', peer = ''] = []) => {
            const source = 'import read from "worker";const alias=read;alias(42);';
            const entries = modulesFor(worker, peer);
            const baseline = acquire(source, entries);
            const work = [];
            const expected = baseline.checkCallResult({ index: 0, required: 'number', onWork: event => append(work, event) });

            work.forEach((unused, stop) => {
                const analysis = acquire(source, entries);
                const visits = [];
                const failure = new Error(`interrupted import initialization ${stop}`);

                throws(() => analysis.checkCallResult({ index: 0, required: 'number', onWork: (event) => {
                    append(visits, event);

                    if (visits.length === stop + 1) throw failure;
                } }), error => error === failure);
                strictEqual(analysis.checkCall({ index: 0 }).status, 'contradiction');
                analysis.checkCallResult({ index: 0, required: 'string' });
                deepStrictEqual(analysis.checkCallResult({ index: 0, required: 'number' }), expected);
            });
        });
    });

    test('import initialization bounds repeated-call width and default relay depth independently', () => {
        [[8, 8], [8, 32], [32, 8], [32, 32]].forEach(([width = 0, depth = 0] = []) => [false, true].forEach((cyclic) => {
            const entries = [['leaf', 'export const read=()=>42;'], ...Array.from({ length: depth }, (unused, index) => (
                [`m${index}`, index ? `import read from "m${index - 1}";export default read;`
                    : `import {read} from "leaf";${cyclic ? 'import "cycle";' : ''}export default read;`]
            )), ['cycle', `import read from "m${depth - 1}";export default read;`]];
            const analysis = acquire(`import read from "m${depth - 1}";` + Array.from({ length: width }, () => 'read();').join(''), entries);
            const work = counter();
            const results = analysis.calls.map(({ index = -1 } = {}) => analysis.checkCallResult({ index, required: 'number', onWork: event => work.onWork(event) }));

            results.forEach(({ status = '' } = {}) => strictEqual(status, cyclic ? 'unknown' : 'agreement'));
            const { counts = {} } = analysis;

            ['expressions', 'contexts', 'values'].forEach(name => ok(Reflect.get(counts, name) <= 100 * (width + depth)));
            ok(work.get('value-demand') <= 100 * (width + depth));
            const before = work.read();

            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => (
                deepStrictEqual(analysis.checkCallResult({ index, required: 'number', onWork: event => work.onWork(event) }), results.at(index))
            ));
            const { counts: repeated = {} } = analysis;

            deepStrictEqual(repeated, counts);
            strictEqual(work.get('value-demand'), Reflect.get(before, 'value-demand'));
        }));
    });

    test('retained import results release their caller while another session stays usable', () => {
        const { execPath = '' } = process;
        const program = `
        import {createAnalysis} from 'eslint-plugin-resilient/analyzer';
        import {setImmediate} from 'node:timers/promises';
        const make=()=>createAnalysis({source:'import read from "worker";read();',filename:'main',resolveModule:({source})=>({filename:source,
            source:source==='worker'?'import {read} from "leaf";export default read;':'export const read=()=>42;'})});
        const acquire=()=>{const session=make();return {result:session.checkCallResult({index:0,required:'number'}),reference:new WeakRef(session)};};
        const held=acquire();const live=make();
        for(let i=0;i<5;i++){await setImmediate();globalThis.gc();}
        console.log(JSON.stringify({retained:Boolean(held.reference.deref()),historical:held.result.status,current:live.checkCallResult({index:0,required:'number'}).status}));
    `;
        const result = JSON.parse(execFileSync(execPath, ['--expose-gc', '--input-type=module', '-e', program], { encoding: 'utf8', timeout: 30000 }));

        deepStrictEqual(result, { retained: false, historical: 'agreement', current: 'agreement' });
    });
}

{
    const rule = 'resilient/signature-contract-operation';
    const source = 'export const read=value=>value.toUpperCase();';
    const projectFor = (context) => {
        const directory = mkdtempSync(join(tmpdir(), 'resilient-configured-roots-'));

        context.after(() => rmSync(directory, { recursive: true, force: true }));
        writeFileSync(join(directory, 'entry.js'), source);
        writeFileSync(join(directory, 'consumer.js'), 'import {read} from "./entry.js";read([]);[].toUpperCase();');
        writeFileSync(join(directory, 'inactive.js'), 'throw new Error("SOURCE MUST NOT EXECUTE");import {read} from "./entry.js";read(42);');

        return directory;
    };
    const engineFor = (directory, settings = {}, imports = {}) => new ESLint({ cwd: directory, overrideConfigFile: true, overrideConfig: [
        resilient.imports({ cwd: directory, ...imports }),
        { plugins: { resilient: plugin }, rules: { [rule]: 'error' }, settings: { resilient: settings } }
    ] });
    const findings = async (engine, filename) => {
        const [{ messages = [] } = {}] = await engine.lintFiles([filename]);

        return messages;
    };

    test('configured root consumers contribute evidence while findings stay in the linted file', async (context) => {
        const directory = projectFor(context);
        const entry = join(directory, 'entry.js');

        deepStrictEqual(await findings(engineFor(directory), entry), []);
        const engine = engineFor(directory, { roots: ['consumer.js', 'consumer.js'] });
        const messages = await findings(engine, entry);

        strictEqual(messages.length, 1);
        const [{ ruleId = '', message = '', column = 0, endColumn = 0 } = {}] = messages;

        strictEqual(ruleId, rule);
        strictEqual(message.includes('array-like'), true);
        strictEqual(message.includes('number-like'), false);
        strictEqual(source.slice(column - 1, endColumn - 1), 'value.toUpperCase');
        writeFileSync(join(directory, 'consumer.js'), 'import {read} from "./entry.js";read("valid");');
        deepStrictEqual(await findings(engine, entry), []);
        writeFileSync(join(directory, 'entry.js'), 'export const read=value=>value.map(item=>item);');
        strictEqual((await findings(engine, entry)).length, 1);
        deepStrictEqual(await findings(engineFor(directory, { roots: [] }), entry), []);
    });

    test('adapter ancestor and inferred roots select only entry files and their static closure', async (context) => {
        const directory = projectFor(context);
        const nested = join(directory, 'nested');

        mkdirSync(nested);
        writeFileSync(join(nested, 'index.js'), source);
        writeFileSync(join(directory, 'scope.js'), 'import {read} from "./nested/index.js";read([]);');
        writeFileSync(join(nested, 'inferred.js'), 'import "./consumer.js";');
        writeFileSync(join(nested, 'consumer.js'), 'import {read} from "./index.js";read("valid");');
        const engine = engineFor(directory, {}, { ancestorFiles: ['scope'], inferredFiles: ['inferred'] });
        const messages = await findings(engine, join(nested, 'index.js'));

        strictEqual(messages.length, 1);
        strictEqual(messages[0].message.includes('array-like'), true);
        deepStrictEqual(await findings(engine, join(directory, 'entry.js')), []);
        writeFileSync(join(directory, 'scope.js'), 'import {read} from "./nested/index.js";read("valid");');
        deepStrictEqual(await findings(engine, join(nested, 'index.js')), []);
    });

    test('root callbacks refresh selection and propagate operational failures', async (context) => {
        const directory = projectFor(context);
        const entry = join(directory, 'entry.js');
        const selection = join(directory, 'selection.json');

        writeFileSync(selection, '["consumer.js"]');
        const engine = engineFor(directory, { roots: ({ fileName = '' } = {}) => fileName === entry ? JSON.parse(readFileSync(selection, 'utf8')) : [] });

        strictEqual((await findings(engine, entry)).length, 1);
        writeFileSync(selection, '[]');
        deepStrictEqual(await findings(engine, entry), []);
        const failure = new Error('root selection failed');

        await rejects(findings(engineFor(directory, { roots: () => { throw failure; } }), entry), error => error === failure);
        await rejects(findings(engineFor(directory, { roots: () => 'consumer.js' }), entry), TypeError);
        writeFileSync(join(directory, 'consumer.js'), 'export const = ;');
        await rejects(findings(engineFor(directory, { roots: ['consumer.js'] }), entry), SyntaxError);
    });

    test('root inventories retain ordered filename identities through shared static cycles', (context) => {
        const directory = projectFor(context);
        const entry = join(directory, 'entry.js');
        const consumer = join(directory, 'consumer.js');
        const second = join(directory, 'second.js');
        const barrel = join(directory, 'barrel.js');

        writeFileSync(consumer, 'import {read} from "./barrel.js";read([]);');
        writeFileSync(barrel, 'export {read} from "./entry.js";import "./consumer.js";');
        writeFileSync(second, 'import {read} from "./barrel.js";read("valid");');
        const snapshot = filename => ({ filename, source: readFileSync(filename, 'utf8') });
        const analysis = createAnalysis({ source, filename: entry, roots: [snapshot(consumer), snapshot(second), snapshot(consumer)],
            resolveModule: ({ from = '', source = '' } = {}) => snapshot(resolve(dirname(from), source)) });
        const { files = [], counts: { modules = 0 } = {}, memberAccesses = [] } = analysis;

        deepStrictEqual(files, [entry, consumer, barrel, second]);
        strictEqual(Object.isFrozen(files), true);
        strictEqual(modules, 4);
        const [{ index = -1 } = {}] = memberAccesses;

        deepStrictEqual(analysis.checkMemberAccess({ index }).conflicts, ['array']);
        writeFileSync(consumer, 'import {read} from "./barrel.js";read("valid");');
        deepStrictEqual(analysis.checkMemberAccess({ index }).conflicts, ['array']);
    });
}
