import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { append } from './support/collections.js';

const lint = (source, rule, { filename = '' } = {}) => new Linter({ cwd: filename ? dirname(filename) : process.cwd() }).verify(source, {
    plugins: { resilient: plugin }, rules: { [`resilient/${rule}`]: 'error' }
}, { ...(filename ? { filename } : {}) });
const operations = analysis => analysis.memberAccesses.map(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }));
const warm = (analysis) => {
    analysis.functions.toReversed().forEach(({ index = -1 } = {}) => analysis.checkFunction({ index }));
    analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
    analysis.memberAccesses.toReversed().forEach(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }));
};

// Invalid programs below challenge evidence; they are not approved dialect examples.
[
    ['uninvoked private exposure', 'const pass=()=>external(Boolean);void pass;false.map(Boolean);', 1],
    ['discarded private exposure aggregate', 'const pass=()=>external(Boolean);void [pass];false.map(Boolean);', 1],
    ['actual exposure', 'external(Boolean);false.map(Boolean);', 0],
    ['called private exposure', 'const pass=()=>external(Boolean);pass();false.map(Boolean);', 0],
    ['alias calls private exposure', 'const pass=()=>external(Boolean);const alias=pass;alias();false.map(Boolean);', 0],
    ['escaping closure exposure', 'const pass=()=>external(Boolean);external(pass);false.map(Boolean);', 0],
    ['exported closure exposure', 'export const pass=()=>external(Boolean);false.map(Boolean);', 0],
    ['exported alias exposure', 'const pass=()=>external(Boolean);export {pass};false.map(Boolean);', 0],
    ['export reaches private helper', 'const pass=()=>external(Boolean);export const run=()=>pass();false.map(Boolean);', 0],
    ['returned exposure', 'const make=()=>()=>external(Boolean);false.map(Boolean);', 0],
    ['exported constructor alias', 'export const Native=Boolean;false.map(Boolean);', 0],
    ['external repetition cannot borrow its first lookup premise', 'export const read=(value=false)=>value.map(Boolean);', 0],
    ['another invocation can expose the same constructor use', 'const read=(value=false)=>value.map(Boolean);read(external);read(false);', 0],
    ['immutable constructor alias exposure', 'const Native=Boolean;external(Native);false.map(Boolean);', 0],
    ['shadowed constructor does not expose global', 'const pass=Boolean=>external(Boolean);pass(external);false.map(Boolean);', 1],
    ['definite noncallable does not receive constructor', '"".map(Boolean);false.map(Boolean);', 2],
    ['unknown member may receive constructor', 'unknown.map(Boolean);false.map(Boolean);', 0],
    ['native callback does not receive its function object', '[1].map(Boolean);false.map(Boolean);', 1],
    ['native this argument may escape to callback', '[1].map(external,Boolean);false.map(Boolean);', 0],
    ['prototype mutation invalidates premise', 'Boolean.prototype.map=external;false.map(Boolean);', 0],
    ['reflection invalidates premise', 'Object.getPrototypeOf(false).map=external;false.map(Boolean);', 0],
    ['guarded nonexecution', 'if(false)external(Boolean);false.map(Boolean);', 1],
    ['unknown guarded execution', 'if(flag)external(Boolean);false.map(Boolean);', 0],
    ['unsupported loop exposure', 'while(flag)external(Boolean);false.map(Boolean);', 0],
    ['unsupported sequence exposure', '(external(Boolean),0);false.map(Boolean);', 0],
    ['opaque catch may expose constructor', 'try{external();}catch(error){external(Boolean);}false.map(Boolean);', 0],
    ['parameter initialization may expose constructor', 'const run=(value=external(Boolean))=>value;run();false.map(Boolean);', 0],
    ['stored object transfer', 'const make=({items=[]}={})=>({items});make({}).items.toUpperCase();', 1],
    ['renamed object transfer', 'const make=({rows=[]}={})=>({value:rows});make({}).value.toUpperCase();', 1],
    ['alias before transfer', 'const make=()=>{const items=[];const alias=items;return {alias};};make().alias.toUpperCase();', 1],
    ['supplied value is not validated', 'const make=({items=[]}={})=>({items});make({items:""}).items.toUpperCase();', 0],
    ['nested object transfer', 'const make=({items=[]}={})=>({data:{items}});make({}).data.items.toUpperCase();', 1],
    ['transfer then original alias mutation', 'const make=()=>{const items=[];const result={items};items.toUpperCase=()=>"";return result;};make().items.toUpperCase();', 0],
    ['two outgoing aggregate aliases', 'const make=()=>{const items=[];const other={items};const result={items};external(other);return result;};make().items.toUpperCase();', 0],
    ['aggregate mutation', 'const make=()=>{const items=[];const result={items};result.items="";return result;};make().items.toUpperCase();', 0],
    ['aggregate escape', 'const make=()=>{const items=[];const result={items};external(result);return result;};make().items.toUpperCase();', 0],
    ['captured transfer source', 'const make=()=>{const items=[];const change=()=>external(items);return {items};};make().items.toUpperCase();', 0],
    ['callback stored by caller can mutate supplied value', 'const items=[];const make=value=>({value});const result=make(items);external(items);result.value.toUpperCase();', 0],
    ['selected borrowed field cannot escape with stale structure',
        'const items=[];const input={items};const make=({items}={})=>({items});const result=make(input);external(input);result.items.toUpperCase();', 0],
    ['direct borrowed return cannot retain caller structure', 'const items=[];const identity=value=>value;const result=identity(items);external(items);result.toUpperCase();', 0],
    ['fresh returned argument retains sole ownership', 'const identity=value=>value;const result=identity({value:42});result.value.trim();', 1],
    ['unknown alternative retains known conflict', 'const make=flag=>flag?{items:[]}:external;make(flag).items.toUpperCase();', 1]
].forEach(([name = '', source = '', expected = 0] = []) => test(`boundary completion: ${name}`, () => {
    strictEqual(lint(source, 'signature-contract-operation').length, expected);
    const first = createAnalysis({ source });
    const second = createAnalysis({ source });
    const before = operations(first);

    strictEqual(before.filter(({ conflicts = [] } = {}) => conflicts.length).length, expected);
    warm(second);
    deepStrictEqual(operations(second), before);
    deepStrictEqual(operations(first), before);
}));

[
    ['authored array absence', 'const f=({items=[]}={})=>{const {length}=items;return length;};', 1],
    ['renamed array absence', 'const f=({rows:list=[]}={})=>{const {length}=list;return length;};', 1],
    ['empty value-field default leaves undeclared fields open', 'const f=({items={}}={})=>{const {length}=items;return length;};', 0],
    ['supplied closed record still has a missing required field', 'const f=({items={}}={})=>{const {length}=items;return length;};f({items:{}});', 1],
    ['authored record field absence is owned', 'const f=({items={}}={})=>{const {length=0}=items;return length;};', 0],
    ['supplied array', 'const f=items=>{const {length}=items;return length;};f([]);', 1],
    ['supplied record', 'const f=items=>{const {length}=items;return length;};f({length:1});', 0],
    ['unknown supplied value', 'const f=items=>{const {length}=items;return length;};f(external);', 0],
    ['member result is not its cached receiver', 'const rows=[];const {value}=rows.unknown;rows.trim();', 0],
    ['guarded unreachable pattern', 'const f=({items=[]}={})=>{if(false){const {length}=items;return length;}};', 0]
].forEach(([name = '', source = '', expected = 0] = []) => test(`source-use pattern: ${name}`, () => {
    strictEqual(lint(source, 'signature-contract-destructuring').length, expected);
}));

[
    ['unguarded captured callback', 'const f=({onItem}={})=>[1].forEach(item=>onItem(item));', 1],
    ['guard before creation', 'const f=({onItem}={})=>{if(typeof onItem!=="function")return;return [1].forEach(item=>onItem(item));};', 0],
    ['guard after creation', 'const f=({onItem}={})=>{const later=()=>onItem();if(typeof onItem!=="function")return;return later;};', 1],
    ['shadowed callback', 'const f=({onItem}={})=>{if(typeof onItem!=="function")return;return ({onItem}={})=>onItem();};', 1],
    ['callee guard independent of supplied callback', 'const f=({onItem}={})=>()=>onItem();f({onItem:()=>1});', 1],
    ['guarded nested creation', 'const f=({onItem}={})=>{if(typeof onItem!=="function")return;return ()=>()=>onItem();};', 0]
].forEach(([name = '', source = '', expected = 0] = []) => test(`closure obligation: ${name}`, () => {
    strictEqual(lint(source, 'no-unguarded-callback-invocation').length, expected);
}));

[
    ['first body is guaranteed', 'do{take(1);}while(false);', 1],
    ['first body before unknown test', 'do{take(1);}while(flag);', 1],
    ['break skips later body', 'do{break;take(1);}while(false);', 0],
    ['continue skips later body', 'do{continue;take(1);}while(false);', 0],
    ['test follows continue', 'do{continue;}while(take(1));', 1],
    ['break skips test', 'do{break;}while(take(1));', 0],
    ['finally executes before break', 'do{try{break;}finally{take(1);}}while(false);', 1],
    ['finally break replaces continue', 'do{try{continue;}finally{break;}}while(take(1));', 0],
    ['nested do owns break', 'do{do{break;}while(false);take(1);}while(false);', 1],
    ['body throw skips test', 'do{throw 1;}while(take(1));', 0]
].forEach(([name = '', body = '', expected = 0] = []) => test(`do completion: ${name}`, () => {
    const source = `const take=()=>0;const run=()=>{${body}};`;

    strictEqual(lint(source, 'signature-contract-call-site').length, expected);
}));

const imported = (provider, source = 'import {read} from "provider";read({}).toUpperCase();', additions = {}) => createAnalysis({
    source, filename: 'consumer', resolveModule: ({ source: name = '' } = {}) => ({ filename: name, source: name === 'provider' ? provider : Reflect.get(additions, name) || '' })
});
[
    ['default array producer', 'export const read=({items=[]}={})=>items;', 1],
    ['number producer', 'export const read=()=>0;', 1],
    ['string producer', 'export const read=()=>"";', 0],
    ['mixed known and unknown', 'export const read=()=>flag?[]:external;', 1],
    ['incompatible known returns', 'export const read=()=>flag?[]:0;', 1],
    ['mutable export identity', 'export let read=()=>[];read=external;', 0],
    ['initialization throws', 'throw 1;export const read=()=>[];', 0],
    ['initialization is unsupported', 'while(flag)external();export const read=()=>[];', 0],
    ['source prototype effect', 'Array.prototype.toUpperCase=()=>"";export const read=()=>[];', 0],
    ['receiver-sensitive method', 'export const read=function(){return this.items;};', 0],
    ['opaque provider execution', 'export const read=()=>{eval("anything");return [];};', 0]
].forEach(([name = '', provider = '', expected = 0] = []) => test(`imported completion: ${name}`, () => {
    const first = imported(provider);
    const second = imported(provider);
    const before = operations(first);

    strictEqual(before.filter(({ conflicts = [] } = {}) => conflicts.length).length, expected);
    warm(second);
    deepStrictEqual(operations(second), before);
}));

test('namespace aliases and named namespace barrels share immutable callable identity', () => {
    const provider = 'export const read=()=>[];';
    const sources = [
        'import * as api from "provider";api.read().toUpperCase();',
        'import * as api from "provider";const alias=api;alias.read().toUpperCase();',
        'import {api} from "barrel";api.read().toUpperCase();',
        'import {api} from "barrel";const f=()=>api.read().toUpperCase();'
    ];

    sources.forEach(source => strictEqual(operations(imported(provider, source, { barrel: 'export * as api from "provider";' }))
        .filter(({ conflicts = [] } = {}) => conflicts.length).length, 1));
    strictEqual(operations(imported('export let read=()=>[];read=external;', sources.at(0))).filter(({ conflicts = [] } = {}) => conflicts.length).length, 0);
});

test('namespace stars remain open when their export set is unresolved', () => {
    const analysis = imported('export * from "external";', 'import * as api from "provider";api.read();');

    strictEqual(operations(analysis).some(({ missing = false } = {}) => missing), false);
});

test('module cycles cannot manufacture a completed initialization', () => {
    const analysis = imported('import "cycle";export const read=()=>[];', 'import {read} from "provider";read().toUpperCase();', { cycle: 'import "provider";' });

    strictEqual(operations(analysis).some(({ conflicts = [] } = {}) => conflicts.length), false);
});

test('foreign producer provenance survives aliases, field transfer and returned callables', () => {
    const source = 'import {make as factory} from "barrel";const read=factory();read({}).items.toUpperCase();';
    const provider = 'export const make=()=>\n({items=[]}={})=>({items});';
    const analysis = imported(provider, source, { barrel: 'export {make} from "provider";' });
    const [{ producers = [] } = {}] = operations(analysis).filter(({ conflicts = [] } = {}) => conflicts.length);

    deepStrictEqual(producers.map(({ module = '', location: { line = 0 } = {} } = {}) => [module, line]), [['provider', 2]]);
    const revised = imported(provider.replace('items=[]', 'items=""'), source, { barrel: 'export {make} from "provider";' });

    strictEqual(operations(revised).some(({ conflicts = [] } = {}) => conflicts.length), false);
    deepStrictEqual(operations(analysis).filter(({ conflicts = [] } = {}) => conflicts.length).at(0).producers, producers);
});

test('module snapshots and operational failures remain distinct', () => {
    const source = 'import {read} from "provider";read().toUpperCase();';
    const failure = new Error('source acquisition failed');

    strictEqual(operations(createAnalysis({ source, resolveModule: () => false })).some(({ conflicts = [] } = {}) => conflicts.length), false);
    throws(() => createAnalysis({ source, resolveModule: () => { throw failure; } }), error => error === failure);
    throws(() => createAnalysis({ source, resolveModule: () => ({ filename: 'provider', source: false }) }), TypeError);
});

test('every observed boundary proof interruption preserves the published result', () => {
    const source = 'import {read} from "provider";const idle=()=>external(Boolean);void idle;read({}).items.toUpperCase();false.map(Boolean);';
    const provider = 'export const read=({items=[]}={})=>({items});';
    const baseline = imported(provider, source);
    const work = [];
    const expected = baseline.memberAccesses.map(({ index = -1 } = {}) => baseline.checkMemberAccess({ index, onWork: event => append(work, event) }));

    work.forEach((_, stop) => {
        const analysis = imported(provider, source);
        const failure = new Error(`interrupted boundary proof ${stop}`);
        const visits = [];

        throws(() => analysis.memberAccesses.forEach(({ index = -1 } = {}) => analysis.checkMemberAccess({ index, onWork(event) {
            append(visits, event);

            if (visits.length === stop + 1) throw failure;
        } })), error => error === failure);
        deepStrictEqual(operations(analysis), expected);
    });
});

test('product operations follow module revision and deletion without borrowing prior evidence', (context) => {
    const directory = mkdtempSync(join(tmpdir(), 'resilient-boundary-'));

    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const provider = join(directory, 'provider.js');
    const filename = join(directory, 'consumer.js');
    const source = 'import {read as get} from "./provider.js";get({}).items.toUpperCase();';

    writeFileSync(provider, 'export const read=({items=[]}={})=>({items});');
    const first = lint(source, 'signature-contract-operation', { filename });

    strictEqual(first.length, 1);
    strictEqual(first.at(0).message.includes(`${provider} at line 1`), true);
    writeFileSync(provider, 'export const read=({items=""}={})=>({items});');
    deepStrictEqual(lint(source, 'signature-contract-operation', { filename }), []);
    rmSync(provider);
    deepStrictEqual(lint(source, 'signature-contract-operation', { filename }), []);
});
