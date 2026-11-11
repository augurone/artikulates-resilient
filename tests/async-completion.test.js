import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

const lint = (source, rule = 'signature-contract-operation') => new Linter().verify(source, {
    plugins: { resilient: plugin }, rules: { [`resilient/${rule}`]: 'error' }
});
const inspect = ({ functions = [], checkFunction } = {}, source) => {
    if (typeof checkFunction !== 'function') throw new TypeError('Expected function evidence query');

    const start = source.indexOf('async', source.indexOf('const inspect='));
    const { index = -1 } = functions.find(({ location: { range: [from = -1] = [] } = {} } = {}) => from === start) ?? {};

    return checkFunction({ index });
};

[
    ['local fulfillment', 'const get=async({items=[]}={})=>items;const inspect=async()=>{const value=await get({});return value.toUpperCase();};', 1],
    ['renamed callable alias', 'const load=async()=>[];const fetch=load;const inspect=async()=>{const value=await fetch();return value.toUpperCase();};', 1],
    ['promise value alias', 'const get=async()=>({items:[]});const inspect=async()=>{const pending=get();const alias=pending;const value=await alias;return value.items.toUpperCase();};', 1],
    ['nested promise adoption', 'const get=async()=>{const load=async()=>({items:[]});return load();};const inspect=async()=>{const value=await get();return value.items.toUpperCase();};', 1],
    ['native resolve', 'const inspect=async()=> (await Promise.resolve([])).toUpperCase();', 1],
    ['native alias resolve', 'const Native=Promise;const inspect=async()=> (await Native.resolve([])).toUpperCase();', 1],
    ['native all result', 'const inspect=async()=> (await Promise.all([external()])).toUpperCase();', 1],
    ['native allSettled result', 'const inspect=async()=> (await Promise.allSettled([external()])).toUpperCase();', 1],
    ['scalar await', 'const inspect=async()=> (await 42).trim();', 1],
    ['unknown alongside known fulfillment', 'const get=async()=>flag?[]:external;const inspect=async()=> (await get()).toUpperCase();', 1],
    ['supplied contradiction survives await', 'const get=async({items=[]}={})=>items;const inspect=async()=> (await get({items:42})).map(Boolean);', 1],
    ['unknown supplied data is not validated', 'const get=async({items=[]}={})=>items;const inspect=async()=> (await get(external)).toUpperCase();', 0],
    ['own thenable is not executed', 'const get=async()=>({then(resolve){resolve([]);}});const inspect=async()=> (await get()).toUpperCase();', 0],
    ['then getter is not executed', 'const get=async()=>({get then(){throw 1;}});const inspect=async()=> (await get()).toUpperCase();', 0],
    ['custom prototype is not ordinary fulfillment', 'const get=async()=>({__proto__:external,items:[]});const inspect=async()=> (await get()).items.toUpperCase();', 0],
    ['noncallable then is ordinary data', 'const get=async()=>({then:0,items:[]});const inspect=async()=> (await get()).items.toUpperCase();', 1],
    ['prototype write retires adoption', 'Object.prototype.then=external;const get=async()=>({items:[]});const inspect=async()=> (await get()).items.toUpperCase();', 0],
    ['array prototype write retires adoption', 'Array.prototype.then=external;const inspect=async()=> (await Promise.resolve([])).toUpperCase();', 0],
    ['array prototype write retires aggregation adoption', 'Array.prototype.then=external;const inspect=async()=> (await Promise.all([])).toUpperCase();', 0],
    ['promise escape retires fulfillment fields', 'const get=async()=>({items:[]});const inspect=async()=>{const pending=get();external(pending);return (await pending).items.toUpperCase();};', 0],
    ['nonfresh resolution payload retires fields', 'const inspect=async()=>{const data={};const pending=Promise.resolve(data);data.items=[];return (await pending).items.toUpperCase();};', 0],
    ['captured mutable payload stays unknown', 'const data={items:[]};const get=async()=>data;const inspect=async()=> (await get()).items.toUpperCase();', 0],
    ['finalizer retires returned fields', 'const get=async()=>{const data={items:[]};try{return data;}finally{data.items="";}};const inspect=async()=> (await get()).items.toUpperCase();', 0],
    ['shadowed Promise uses authored body', 'const Promise={resolve:async()=>""};const inspect=async()=> (await Promise.resolve([])).toUpperCase();', 0],
    ['overwritten Promise factory', 'Promise.resolve=external;const inspect=async()=> (await Promise.resolve([])).toUpperCase();', 0],
    ['unbound Promise factory is not admitted', 'const resolve=Promise.resolve;const inspect=async()=> (await resolve([])).toUpperCase();', 0],
    ['generator is not an async function result', 'const get=async function*(){yield [];};const inspect=async()=> (await get()).toUpperCase();', 0]
].forEach(([name = '', source = '', expected = 0] = []) => test(`async ownership: ${name}`, () => {
    strictEqual(lint(source).length, expected);
    const analysis = createAnalysis({ source });
    const { memberAccesses = [] } = analysis;
    const conflicts = memberAccesses.flatMap(({ index = -1 } = {}) => {
        const { conflicts = [] } = analysis.checkMemberAccess({ index });

        return conflicts;
    });

    strictEqual(conflicts.length, expected);
}));

[
    ['fulfilled primitive', 'const inspect=async()=>await 42;', ['number'], true],
    ['fulfilled array', 'const inspect=async()=>await Promise.resolve([]);', ['array'], true],
    ['rejected body', 'const inspect=async()=>{throw 42;};', [], false],
    ['caught awaited rejection', 'const inspect=async()=>{try{return await Promise.reject(42);}catch{return [];}};', ['array'], true],
    ['returned rejection bypasses catch', 'const inspect=async()=>{try{return Promise.reject(42);}catch{return [];}};', [], false],
    ['finalizer replaces fulfillment', 'const inspect=async()=>{try{return Promise.resolve([]);}finally{return "";}};', ['string'], true],
    ['finalizer replaces rejection', 'const inspect=async()=>{try{return Promise.reject(42);}finally{return "";}};', ['string'], true, true],
    ['finalizer replaces caught rejection', 'const inspect=async()=>{try{return await Promise.reject(42);}catch{return [];}finally{return "";}};', ['string'], true],
    ['finally throw rejects', 'const inspect=async()=>{try{return [];}finally{throw 42;}};', [], false],
    ['primitive captured before finalizer', 'const inspect=async()=>{let value="";try{return value;}finally{value=42;}};', ['string'], true],
    ['plain absent fulfillment', 'const inspect=async()=>{};', ['nullish'], true]
].forEach(([name = '', source = '', expected = [], normal = false, orphaned = false] = []) => test(`async completion and native execution: ${name}`, () => {
    const analysis = createAnalysis({ source });
    const { fact: { families = [] } = {}, normal: completed = false, completion = '' } = inspect(analysis, source);

    deepStrictEqual(families.toSorted(), expected);
    strictEqual(completed, normal);
    strictEqual(completion, 'fulfillment');
    const { execPath = '' } = process;
    const { stdout = '', stderr = '', status = -1 } = spawnSync(execPath, ['--input-type=module', '--unhandled-rejections=warn', '-e',
        `${source}inspect().then(value=>({fulfilled:true,family:Array.isArray(value)?'array':typeof value})).catch(()=>({fulfilled:false})).then(result=>console.log(JSON.stringify(result)));`
    ], { encoding: 'utf8' });
    const runtime = JSON.parse(stdout);
    const { fulfilled = false, family = '' } = runtime;

    strictEqual(status, 0);
    strictEqual(stderr.includes('UnhandledPromiseRejectionWarning'), orphaned);
    strictEqual(fulfilled, normal);

    if (normal) deepStrictEqual([family === 'undefined' ? 'nullish' : family], expected);
}));

test('async calls expose promise identity while body and initializer failures reject', () => {
    ['async()=>{throw 42;}', 'async(value=external())=>value'].forEach((definition) => {
        const analysis = createAnalysis({ source: `const read=${definition};read();` });
        const { calls = [] } = analysis;
        const { index = -1 } = calls.find(({ callee = '' } = {}) => callee === 'read') ?? {};
        const { status = '', normal = false, thrown = true } = analysis.checkCallResult({ index, required: 'array' });

        strictEqual(status, 'unknown');
        strictEqual(normal, true);
        strictEqual(thrown, false);
    });
    const source = 'const fail=()=>{throw 42;};const read=async value=>value;read(fail());';
    const analysis = createAnalysis({ source });
    const { calls = [] } = analysis;
    const { index = -1 } = calls.find(({ callee = '' } = {}) => callee === 'read') ?? {};
    const { normal = true, thrown = false } = analysis.checkCallResult({ index, required: 'array' });

    strictEqual(normal, false);
    strictEqual(thrown, true);
});

test('generic async bodies remain separate from caller fulfillment and query order', () => {
    const source = 'const read=async value=>value;const inspect=async()=>{await read([]);return await read(42);};';
    const first = createAnalysis({ source });
    const second = createAnalysis({ source });
    const before = first.checkFunction({ index: 0 });
    const { status = '' } = before;

    strictEqual(status, 'unknown');
    deepStrictEqual(inspect(first, source).fact.families, ['number']);
    second.calls.toReversed().forEach(({ index = -1 } = {}) => second.checkCall({ index }));
    deepStrictEqual(inspect(second, source), inspect(first, source));
    deepStrictEqual(first.checkFunction({ index: 0 }), before);
    deepStrictEqual(second.checkFunction({ index: 0 }), before);
});

test('async result evidence follows source revisions and required observer failures propagate', () => {
    const source = 'const read=async()=>[];const inspect=async()=>await read();';
    const first = createAnalysis({ source });
    const revised = createAnalysis({ source: source.replace('async()=>[]', 'async()=>42') });
    const before = inspect(first, source);

    deepStrictEqual(inspect(revised, source).fact.families, ['number']);
    deepStrictEqual(inspect(first, source), before);
    const interrupted = createAnalysis({ source });
    const failure = new Error('settlement observation failed');

    throws(() => interrupted.checkFunction({ index: 1, onWork: ({ kind = '' } = {}) => {
        if (kind === 'settlement-projection') throw failure;
    } }), error => error === failure);
    deepStrictEqual(inspect(interrupted, source), before);
});

test('an imported async identity does not execute or claim dependency fulfillment', () => {
    const source = 'import {read} from "worker";const inspect=async()=>await read();';
    const analysis = createAnalysis({ source, filename: 'main', resolveModule: () => ({ filename: 'worker', source: 'throw 42;export const read=async()=>[];' }) });

    strictEqual(inspect(analysis, source).status, 'unknown');
    const { normal = false, thrown = true } = analysis.checkCallResult({ index: 0, required: 'array' });

    strictEqual(normal, true);
    strictEqual(thrown, false);
});

test('async fulfillment family conflicts reach the product return rule', () => {
    strictEqual(lint('const read=async flag=>{if(flag)return [];return "";};', 'signature-contract-return-consistency').length, 2);
});

[
    'const read=async flag=>flag?Promise.resolve([]):Promise.resolve("");',
    'const read=async flag=>{if(flag)return Promise.resolve([]);return "";};',
    'const read=async flag=>{try{if(flag)return Promise.resolve([]);return Promise.resolve("");}finally{42;}};'
].forEach(source => test('async return provenance follows fulfillment through owned promise alternatives', () => {
    const analysis = createAnalysis({ source });
    const { status = '', diagnostics = [] } = analysis.checkFunction({ index: 0 });

    strictEqual(status, 'contradiction');
    strictEqual(diagnostics.length, 2);
    strictEqual(lint(source, 'signature-contract-return-consistency').length, 2);
}));

[
    'const get=async()=>((value="")=>value);const inspect=async()=>{const read=await get();return read(42);};',
    'const get=async()=>((value="")=>value);const inspect=async()=> (await get())(42);'
].forEach(source => test('an owned fulfilled callable retains its source signature at the actual caller', () => {
    strictEqual(lint(source, 'signature-contract-call-site').length, 1);
}));

test('successive async adoption shares completion and scales with owned invocation edges', () => {
    const samples = [100, 200, 400].map((size) => {
        const source = ['const f0=async()=>[];', ...Array.from({ length: size }, (unused, index) => `const f${index + 1}=async()=>f${index}();`),
            `const inspect=async()=>await f${size}();`].join('');
        const analysis = createAnalysis({ source });
        const work = counter();
        const result = analysis.checkFunction({ index: size + 1, onWork: event => work.onWork(event) });
        const { fact: { families = [] } = {} } = result;
        const before = work.read();

        deepStrictEqual(families, ['array']);
        deepStrictEqual(analysis.checkFunction({ index: size + 1, onWork: event => work.onWork(event) }), result);
        const after = work.read();

        ['value-demand', 'settlement-projection', 'flow-contribution', 'function-context'].forEach(kind => strictEqual(Reflect.get(after, kind), Reflect.get(before, kind)));
        const { counts = {} } = analysis;

        return { ...before, ...counts };
    });

    ['value-demand', 'settlement-projection', 'contexts', 'values'].forEach((kind) => {
        const [first = 0, second = 0, third = 0] = samples.map(sample => Reflect.get(sample, kind));

        strictEqual(third - second, 2 * (second - first));
    });
});
