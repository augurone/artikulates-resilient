import { deepStrictEqual, ok, strictEqual, throws, rejects } from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter, ESLint } from 'eslint';
import { parse } from 'espree';

import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

// Promise identity, adoption, settlement and selected-protocol lifetime compose. Preserve independent native Get/rejection observations, cleanup, unknown protocols and shared graph bounds.
const lintShared2 = source => new Linter().verify(source, {
    plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-operation': 'error' }
});
const conflictsShared = analysis => analysis.memberAccesses.filter(({ name = '' } = {}) => name === 'trim')
    .flatMap(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }).conflicts);

{
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
        ['promise escape retires fulfillment fields', 'const get=async()=>({items:[]});const inspect=async()=>{const pending=get();external(pending);return (await pending).items.toUpperCase();};', 0],
        ['nonfresh resolution payload retires fields', 'const inspect=async()=>{const data={};const pending=Promise.resolve(data);data.items=[];return (await pending).items.toUpperCase();};', 0],
        ['captured mutable payload stays unknown', 'const data={items:[]};const get=async()=>data;const inspect=async()=> (await get()).items.toUpperCase();', 0],
        ['finalizer retires returned fields', 'const get=async()=>{const data={items:[]};try{return data;}finally{data.items="";}};const inspect=async()=> (await get()).items.toUpperCase();', 0],
        ['shadowed Promise uses authored body', 'const Promise={resolve:async()=>""};const inspect=async()=> (await Promise.resolve([])).toUpperCase();', 0],
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

    [
        ['known', '[]', ['array'], true],
        ['opaque', 'external()', [], false],
        ['native identity', 'Promise.race([external()])', [], true]
    ].forEach(([name = '', payload = '', expected = [], shared = false] = []) => test(`successive async adoption shares completion and scales with owned invocation edges: ${name}`, () => {
        const samples = [100, 200, 400].map((size) => {
            const native = name === 'native identity';
            const source = [`const f0=${native ? '' : 'async '}()=>${payload};`, ...Array.from({ length: size }, (unused, index) => (
                native ? `const f${index + 1}=()=>Promise.resolve(f${index}());` : `const f${index + 1}=async()=>f${index}();`
            )),
            `const inspect=async()=>await f${size}();`].join('');
            const analysis = createAnalysis({ source });
            const work = counter();
            const result = analysis.checkFunction({ index: size + 1, onWork: event => work.onWork(event) });
            const { fact: { families = [] } = {} } = result;
            const before = work.read();

            deepStrictEqual(families, expected);
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
        ['decisions', 'decisionWork'].forEach((kind) => {
            const counts = samples.map(sample => Reflect.get(sample, kind));

            // A new async promise readopts an opaque fulfilled payload, so each
            // invocation can make a different choice. Native resolve shares identity.
            if (shared) strictEqual(new Set(counts).size, 1, `${kind}: forwarding must reuse the established settlement choice`);

            if (!shared) {
                const [first = 0, second = 0, third = 0] = counts;

                ok(first > 0);
                strictEqual(third - second, 2 * (second - first), `${kind}: fresh opaque adoption must remain linear`);
            }
        });
    }));
}

{
    const conflictsFor = (analysis, observation = {}) => analysis.memberAccesses.filter(({ name = '' } = {}) => name === 'trim')
        .flatMap(({ index = -1 } = {}) => analysis.checkMemberAccess({ index, ...observation }).conflicts);
    const runtime = (source, args = []) => {
        const { execPath = '' } = process;
        const { status = -1 } = spawnSync(execPath, ['--input-type=module', '-e', source, ...args], { encoding: 'utf8', timeout: 5000 });

        return status;
    };
    const lint = lintShared2;

    test('async returns readopt opaque fulfilled payloads while promise observers retain identity', async () => {
        const witness = 'const reads=[false,false,true,true].values();const choices=[false,true].values();'
            + 'const payload={get then(){return reads.next().value?((resolve,reject)=>(choices.next().value?reject:resolve)(0)):void 0;}};'
            + 'const input=Promise.resolve(payload);';
        const forwards = [
            ['value=>value', false], ['value=>Promise.resolve(value)', false],
            ['async value=>value', true], ['async value=>await value', true]
        ];

        await Promise.all(forwards.map(async ([forward = '', readopts = false] = []) => {
            const source = `const read=async(input)=>{const pending=Promise.race([input]);const forward=${forward};`
                + 'const [a={},b={}]=await Promise.allSettled([forward(pending),forward(pending)]);'
                + 'const value=a.status==="fulfilled"&&b.status==="rejected"?42:"ok";return value.trim();};';
            const result = await runInNewContext(source + witness + 'Promise.allSettled([read(input)]);');
            const [{ status = '', reason: { name = '' } = {} } = {}] = result;

            strictEqual(status, readopts ? 'rejected' : 'fulfilled');
            strictEqual(name, readopts ? 'TypeError' : '');
            const expected = readopts ? ['number'] : [];
            const analysis = createAnalysis({ source });

            deepStrictEqual(conflictsFor(analysis), expected, source);
            strictEqual(lint(source).length, expected.length, source);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(conflictsFor(analysis), expected, source);
            const repeated = source.replace('const [a={},b={}]', 'const shared=forward(pending);const [a={},b={}]')
                .replace('[forward(pending),forward(pending)]', '[shared,shared]');

            deepStrictEqual(conflictsFor(createAnalysis({ source: repeated })), [], repeated);
            strictEqual(await runInNewContext(repeated + witness + 'read(input);'), 'ok');
            const primitive = source.replace('Promise.race([input])', 'Promise.resolve(0)');

            deepStrictEqual(conflictsFor(createAnalysis({ source: primitive })), [], primitive);
            strictEqual(await runInNewContext(primitive + 'read();'), 'ok');
        }));
    });

    test('opaque settlements retain independent choices and both sides of status guards', async () => {
        const statuses = ['fulfilled', 'rejected'];

        await Promise.all(statuses.flatMap(left => statuses.map(async (right) => {
            const source = 'const run=async(left,right)=>{const [a={},b={}]=await Promise.allSettled([left,right]);'
                + `if(a.status==="${left}"&&b.status==="${right}")return 42;return "ok";};`;
            const analysis = createAnalysis({ source });
            const expected = { families: ['number', 'string'], normal: true, thrown: true };
            const read = () => {
                const { fact: { families = [] } = {}, normal = false, thrown = false } = analysis.checkFunction({ index: 0 });

                return { families: families.toSorted(), normal, thrown };
            };

            deepStrictEqual(read(), expected, source);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(read(), expected);
            const actual = await Promise.all(statuses.flatMap(a => statuses.map(b => runInNewContext(source
                + `run(Promise.${a === 'fulfilled' ? 'resolve' : 'reject'}(0),Promise.${b === 'fulfilled' ? 'resolve' : 'reject'}(0));`))));

            // eslint-disable-next-line resilient/signature-contract-return-consistency -- The runtime oracle returns distinct families to verify reachability of both settlement branches.
            deepStrictEqual(actual, statuses.flatMap(a => statuses.map(b => a === left && b === right ? 42 : 'ok')));
        })));
    });

    test('settlement choices survive aliases, forwarding, conditional slots and copied statuses', async () => {
        [
            ['[first,second]', true],
            ['[first,alias]', false],
            ['[forward(first),second]', true],
            ['[forward(first),alias]', false],
            ['[flag?first:second,second]', true],
            ['flag?[first,second]:[second,first]', true]
        ].forEach(([slots = '', mixed = false] = []) => {
            const source = 'const run=async(left,right,flag=false)=>{const first=Promise.race([left]);const second=Promise.race([right]);'
                + 'const alias=first;const forward=value=>(()=>value)();'
                + `const [x={},y={}]=await Promise.allSettled(${slots});const a={...x};const {...b}=y;`
                + 'if(a.status==="fulfilled"&&b.status==="rejected")return 42;return "ok";};';
            const analysis = createAnalysis({ source });
            const { fact: { families = [] } = {} } = analysis.checkFunction({ index: 0 });

            deepStrictEqual(families.toSorted(), mixed ? ['number', 'string'] : ['string'], source);
        });
        const source = 'const run=async(left,right)=>{const [a={},b={}]=await Promise.allSettled([left,right]);'
            + 'const value=a.status==="fulfilled"&&b.status==="rejected"?"ok":42;return value.trim();};';
        const analysis = createAnalysis({ source });

        deepStrictEqual(conflictsFor(analysis), ['number']);
        strictEqual(lint(source).length, 1);
        const actual = await runInNewContext(source + 'Promise.allSettled([run(Promise.resolve(0),Promise.reject(0)),run(Promise.resolve(0),Promise.resolve(0))]);');
        const [{ status: first = '', value = '' } = {}, { status: second = '', reason: { name = '' } = {} } = {}] = actual;

        deepStrictEqual([first, value, second, name], ['fulfilled', 'ok', 'rejected', 'TypeError']);
        const valid = source.replace(':42;', ':"ok";');

        deepStrictEqual(conflictsFor(createAnalysis({ source: valid })), []);
        deepStrictEqual(lint(valid), []);
    });

    test('repeated opaque adoption stays uncertain while a native promise shares its settlement', async () => {
        const source = 'const run=async(input)=>{const [a={},b={}]=await Promise.allSettled([input,input]);'
            + 'if(a.status==="fulfilled"&&b.status==="rejected")return 42;return "ok";};';
        const analysis = createAnalysis({ source });
        const { fact: { families = [] } = {} } = analysis.checkFunction({ index: 0 });

        deepStrictEqual(families.toSorted(), ['number', 'string']);
        // The runtime witness supplies an effectful thenable at the opaque boundary.
        // The analyzed source does not execute or inspect its implementation.
        const witness = '{then(resolve,reject){(calls.next().value?reject:resolve)(0);}}';
        const calls = [false, true].values();

        strictEqual(await runInNewContext(source + `run(${witness});`, { calls }), 42);
        const native = source.replace('const [a={},b={}]', 'const pending=Promise.race([input]);const [a={},b={}]').replace('[input,input]', '[pending,pending]');
        const { fact: { families: shared = [] } = {} } = createAnalysis({ source: native }).checkFunction({ index: 0 });

        deepStrictEqual(shared, ['string']);
        strictEqual(await runInNewContext(native + `run(${witness});`, { calls: [false, true].values() }), 'ok');
    });

    test('unmodeled promise factories preserve invocation identity and repeated aliases', async () => {
        const consume = 'const value=a.status==="fulfilled"&&b.status==="rejected"?42:"ok";return value.trim();};';
        const inputs = [
            'Promise.race([Promise.resolve(0)]),Promise.race([Promise.reject(0)])',
            'new Promise(resolve=>resolve(0)),new Promise((resolve,reject)=>reject(0))',
            'new Promise(first),new Promise(second)'
        ];

        await Promise.all(inputs.map(async (input) => {
            const source = `const run=async(first,second)=>{const [a={},b={}]=await Promise.allSettled([${input}]);` + consume;
            const analysis = createAnalysis({ source });

            deepStrictEqual(conflictsFor(analysis), ['number'], source);
            strictEqual(lint(source).length, 1);
            const result = await runInNewContext(source + 'Promise.allSettled([run(resolve=>resolve(0),(resolve,reject)=>reject(0))]);');
            const [{ status = '', reason: { name = '' } = {} } = {}] = result;

            deepStrictEqual([status, name], ['rejected', 'TypeError']);
        }));
        const shared = 'const run=async()=>{const first=Promise.race([Promise.resolve(0)]);const alias=first;'
            + 'const [a={},b={}]=await Promise.allSettled([alias,first]);' + consume;

        deepStrictEqual(conflictsFor(createAnalysis({ source: shared })), []);
        deepStrictEqual(lint(shared), []);
        strictEqual(await runInNewContext(shared + 'run();'), 'ok');
    });

    test('native promise settlement identity survives separate aggregate observers', async () => {
        const observers = [
            'const [first=[],second=[]]=await Promise.all([Promise.allSettled([pending]),Promise.allSettled([alias])]);'
                + 'const [a={}]=first;const [b={}]=second;const {status:left=""}=a;const {status:right=""}=b;',
            'const observe=async value=>{const [item={}]=await Promise.allSettled([value]);return item;};'
                + 'const [a={},b={}]=await Promise.all([observe(pending),observe(alias)]);const {status:left=""}=a;const {status:right=""}=b;',
            'const [a={}]=await Promise.allSettled([pending]);const {status:left=""}=a;'
                + 'const [b={}]=await Promise.allSettled([alias]);const {status:right=""}=b;'
        ];
        const factories = [
            ['Promise.race([Promise.resolve(0)])', '0'],
            ['new Promise(resolve=>resolve(0))', '0'],
            ['new Promise(input)', 'resolve=>resolve(0)'],
            ['Promise.resolve(input)', 'Promise.resolve(0)'],
            ['Promise.all(input)', '[Promise.resolve(0)]'],
            ['Promise.allSettled(input)', '[Promise.resolve(0)]'],
            ['(async()=>input)()', 'Promise.resolve(0)'],
            ['(async()=>input())()', '()=>0'],
            ['(async()=>await input())()', '()=>Promise.resolve(0)'],
            ['(async()=>{input();return 42;})()', '()=>0'],
            ['(async()=>new input())()', 'function(){}']
        ];

        await Promise.all(factories.flatMap(([factory = '', input = ''] = []) => observers.map(async (observe) => {
            const source = `const read=async(input)=>{const pending=${factory};const alias=pending;` + observe
                + 'const value=left==="fulfilled"&&right==="rejected"?42:"ok";return value.trim();};';
            const analysis = createAnalysis({ source });

            const expected = factory === 'Promise.resolve(input)' ? ['number'] : [];

            deepStrictEqual(conflictsFor(analysis), expected, source);
            strictEqual(lint(source).length, expected.length);
            strictEqual(await runInNewContext(source + `read(${input});`), 'ok');
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(conflictsFor(analysis), expected);
            const distinct = source.replace('const alias=pending;', 'const alias=Promise.race([Promise.reject(0)]);');

            deepStrictEqual(conflictsFor(createAnalysis({ source: distinct })), ['number'], distinct);
            strictEqual(lint(distinct).length, 1);
            const [{ status = '', reason: { name = '' } = {} } = {}] = await runInNewContext(distinct + `Promise.allSettled([read(${input})]);`);

            deepStrictEqual([status, name], ['rejected', 'TypeError']);
        })));
    });

    test('native promise creation separates callers of one factory', async () => {
        const factories = [
            ['value=>Promise.race([value()])', '()=>Promise.resolve(0)', '()=>Promise.reject(0)'],
            ['value=>Promise.resolve(value())', '()=>Promise.resolve(0)', '()=>Promise.reject(0)'],
            ['value=>Promise.resolve(value)', '{then:resolve=>resolve(0)}', '{then:(resolve,reject)=>reject(0)}'],
            ['async value=>value()', '()=>Promise.resolve(0)', '()=>Promise.reject(0)'],
            ['executor=>new Promise(executor)', 'resolve=>resolve(0)', '(resolve,reject)=>reject(0)']
        ];

        await Promise.all(factories.map(async ([factory = '', first = '', second = ''] = []) => {
            const source = `const read=async(first,second)=>{const create=${factory};const pending=create(first);const other=create(second);`
                + 'const [a={},b={}]=await Promise.allSettled([pending,other]);const {status:left=""}=a;const {status:right=""}=b;'
                + 'const value=left==="fulfilled"&&right==="rejected"?42:"ok";return value.trim();};';

            deepStrictEqual(conflictsFor(createAnalysis({ source })), ['number'], source);
            strictEqual(lint(source).length, 1);
            const [{ status = '', reason: { name = '' } = {} } = {}] = await runInNewContext(source + `Promise.allSettled([read(${first},${second})]);`);

            deepStrictEqual([status, name], ['rejected', 'TypeError']);
            const shared = source.replace('const other=create(second);', 'const other=pending;');

            const expected = factory.includes('Promise.resolve') ? ['number'] : [];

            deepStrictEqual(conflictsFor(createAnalysis({ source: shared })), expected, shared);
            strictEqual(lint(shared).length, expected.length);
            strictEqual(await runInNewContext(shared + `read(${first},${second});`), 'ok');
        }));
    });

    [
        ['seeded reduction', 'async value=>await [value].reduce(async(pending,item)=>({...await pending,...item}),Promise.resolve({}))'],
        ['reverse reduction', 'async value=>await [value].reduceRight(async(pending,item)=>({...await pending,...item}),Promise.resolve({}))'],
        ['native all', 'async value=>{const [result={}]=await Promise.all([Promise.resolve(value)]);return result;}'],
        ['nested all', 'async value=>{const [rows=[]]=await Promise.all([Promise.all([Promise.resolve(value)])]);const [result={}]=rows;return result;}'],
        ['native allSettled', 'async value=>{const [result={}]=await Promise.allSettled([Promise.resolve(value)]);return result.value;}']
    ].forEach(([name = '', normalize = ''] = []) => test(`async transport preserves supplied fields: ${name}`, () => {
        ['42', '"ok"'].forEach((input, position) => {
            const source = `const normalize=${normalize};const {name=""}=await normalize({name:${input}});name.trim();`;
            const analysis = createAnalysis({ source });
            const expected = position ? [] : ['number'];

            deepStrictEqual(conflictsFor(analysis), expected);
            strictEqual(runtime(source), position ? 0 : 1);
            strictEqual(lint(source).length, position ? 0 : 1);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(conflictsFor(analysis), expected);
        });
    }));

    test('async aggregates retire writes and surviving aliases', () => {
        [
            'const normalize=async value=>{const pending=[value].reduce(async(pending,item)=>({...await pending,...item}),Promise.resolve({}));'
                + 'value.name="ok";return pending;};const {name=""}=await normalize({name:42});name.trim();',
            'const normalize=async value=>{const pending=Promise.resolve(value);value.name="ok";return pending;};const {name=""}=await normalize({name:42});name.trim();',
            'const data={name:42};const pending=Promise.all([data]);data.name="ok";const [item={}]=await pending;item.name.trim();',
            'const data=[{name:42}];const pending=Promise.all(data);data[0].name="ok";const [item={}]=await pending;item.name.trim();',
            'const data={name:42};const pending=Promise.allSettled([Promise.reject(data)]);data.name="ok";const [item={}]=await pending;item.reason.name.trim();',
            'const shared={name:42};const normalize=async value=>await [value].reduce(async(pending,item)=>({...await pending,...item}),Promise.resolve({}));'
                + 'const pending=normalize(shared);shared.name="ok";const {name=""}=await pending;name.trim();'
        ].forEach(source => deepStrictEqual(conflictsFor(createAnalysis({ source })), [], source));
    });

    test('promise aggregates preserve holes, rejection, sibling facts and settlement records', () => {
        [
            ['const [item="ok"]=await Promise.all([,]);item.trim();', []],
            ['const [,item=""]=await Promise.all([external,{name:42}]);item.name.trim();', ['number']],
            ['const [item={}]=await Promise.allSettled([Promise.reject({name:42})]);item.reason.name.trim();', ['number']],
            ['const [item={}]=await Promise.allSettled([Promise.resolve({name:42})]);item.value.name.trim();', ['number']],
            ['await Promise.all([Promise.reject(0),{name:42}]);(42).trim();', []],
            ['await Promise.all(42);(42).trim();', []],
            ['await Promise.allSettled(null);(42).trim();', []],
            ['const [item={}]=await Promise.all([{then(resolve){resolve({name:"ok"});}}]);item.name.trim();', []]
        ].forEach(([source = '', expected = []] = []) => deepStrictEqual(conflictsFor(createAnalysis({ source })), expected, source));
    });

    test('aggregate work is shared across warm queries and grows with supplied positions', () => {
        const observed = [8, 32].map((width) => {
            const slots = Array.from({ length: width }, () => 'Promise.resolve({name:42})').join(',');
            const analysis = createAnalysis({ source: `const [item={}]=await Promise.all([${slots}]);item.name.trim();` });
            const work = counter();

            deepStrictEqual(conflictsFor(analysis, work), ['number']);
            const before = work.read();

            deepStrictEqual(conflictsFor(analysis, work), ['number']);
            deepStrictEqual(work.read(), before);

            return work.get('settlement-aggregate');
        });

        ok(observed.at(0) > 0);
        ok(observed.at(1) <= observed.at(0) * 4);
    });

    test('settlement status selects its own payload before property and operation checks', () => {
        const rule = 'resilient/signature-contract-property';
        const verify = source => new Linter().verify(source, { plugins: { resilient: plugin },
            rules: { [rule]: 'error', 'resilient/signature-contract-operation': 'error' } });

        [
            ['flag?Promise.resolve("ok"):Promise.reject(42)', 'fulfilled', 'value', []],
            ['flag?Promise.reject("ok"):Promise.resolve(42)', 'rejected', 'reason', []],
            ['flag?Promise.resolve({name:42}):Promise.reject({name:"ok"})', 'fulfilled', 'value.name', ['number']]
        ].forEach(([input = '', status = '', field = '', expected = []] = []) => {
            const source = 'const flag=Boolean(process.argv.at(1));'
                + `const [item={}]=await Promise.allSettled([${input}]);if(item.status==="${status}")item.${field}.trim();`;

            deepStrictEqual(conflictsFor(createAnalysis({ source })), expected);
            strictEqual(verify(source).length, expected.length);
            strictEqual(runtime(source), 0);

            const selected = source.replace('if(item.status', 'const {status=""}=item;if(status');

            deepStrictEqual(conflictsFor(createAnalysis({ source: selected })), expected);
            strictEqual(verify(selected).length, expected.length);
        });
    });

    test('owned selection and caught values preserve known fields', () => {
        [
            'const items=await Promise.all([{name:42}]);items[0].name.trim();',
            'const items=await Promise.all([{name:42}]);items.at(-1).name.trim();',
            'const item=await Promise.resolve(flag?{name:42}:{name:"ok"});item.name.trim();',
            'try{await Promise.all([Promise.reject({name:42})]);}catch(error){const {name=""}=error;name.trim();}',
            'try{throw {name:42};}catch(error){const {name=""}=error;name.trim();}'
        ].forEach(source => deepStrictEqual(conflictsFor(createAnalysis({ source })), ['number'], source));
    });

    test('promise aggregates keep reached array alternatives and discard unreachable payloads', () => {
        const flag = 'const flag=Boolean(process.argv.at(1));';

        [
            ['const [item={}]=await Promise.all(flag?[{name:42}]:[{name:"ok"}]);item.name.trim();', ['number'], [0, 1]],
            ['const [item={}]=await Promise.allSettled(flag?[Promise.resolve(42)]:[Promise.reject(42)]);'
                + 'if(item.status==="fulfilled")item.value.trim();', ['number'], [0, 1]],
            ['const [item={}]=await Promise.all(flag?[Promise.reject({name:42})]:[{name:"ok"}]);item.name.trim();', [], [0, 1]],
            ['const [item={}]=await Promise.all(flag?[{name:42}]:JSON.parse("[]"));if(flag)item.name.trim();', ['number'], [0, 1]]
        ].forEach(([body = '', expected = [], statuses = []] = []) => {
            const source = flag + body;
            const analysis = createAnalysis({ source });

            deepStrictEqual(conflictsFor(analysis), expected);
            strictEqual(lint(source).length, expected.length);
            deepStrictEqual([runtime(source), runtime(source, ['primary'])], statuses);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(conflictsFor(analysis), expected);
        });
    });

    test('settlement discrimination survives shallow copies and later fixed writes', () => {
        const verify = source => new Linter().verify(source, { plugins: { resilient: plugin },
            rules: { 'resilient/signature-contract-property': 'error', 'resilient/signature-contract-operation': 'error' } });

        [
            'const copy={...item};',
            'const copy={...item,...{other:0}};',
            'const copy={...item,other:0};',
            'const {...copy}=item;'
        ].forEach((copy) => {
            [42, 'ok'].forEach((value) => {
                const expected = typeof value === 'number' ? ['number'] : [];
                const source = 'const flag=Boolean(process.argv.at(1));'
                    + `const [item={}]=await Promise.allSettled([flag?Promise.resolve(${JSON.stringify(value)}):Promise.reject(42)]);`
                    + copy + 'if(copy.status==="fulfilled")copy.value.trim();';

                deepStrictEqual(conflictsFor(createAnalysis({ source })), expected);
                strictEqual(verify(source).length, expected.length);
                strictEqual(runtime(source), 0);
                strictEqual(runtime(source, ['primary']), expected.length);
            });
        });
    });

    test('escaping a promise retires rejection payload fields through every observer', async () => {
        const observers = [
            'try{await p;}catch(error){return error.name.trim();}',
            'const [item={}]=await Promise.allSettled([p]);return item.reason.name.trim();',
            'try{await Promise.all([p,p]);}catch(error){return error.name.trim();}'
        ];
        const touch = 'const touch=p=>{p.then(value=>{value.name="ok";},error=>{error.name="ok";});};';

        await Promise.all(observers.map(async (observe) => {
            const source = `const read=async()=>{const p=Promise.reject({name:42});touch(p);${observe}};`;
            const analysis = createAnalysis({ source });

            deepStrictEqual(conflictsFor(analysis), [], source);
            strictEqual(lint(source).length, 0, source);
            strictEqual(await runInNewContext(touch + source + 'read();'), 'ok');
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(conflictsFor(analysis), [], source);
            // Nested fields require a sole owned transfer. Repeated array aliases
            // retain the payload family but intentionally retire its member snapshot.
            const owned = source.replace('touch(p);', '').replace('[p,p]', '[p]');
            const [{ status = '', reason: { name = '' } = {} } = {}] = await runInNewContext(owned + 'Promise.allSettled([read()]);');

            deepStrictEqual([status, name], ['rejected', 'TypeError']);
            deepStrictEqual(conflictsFor(createAnalysis({ source: owned })), ['number'], owned);
            strictEqual(lint(owned).length, 1, owned);
            const primitive = source.replace('Promise.reject({name:42})', 'Promise.reject(42)').replace('error.name.trim()', 'error.trim()')
                .replace('return item.reason.name.trim()', 'if(item.status!=="rejected")return "ok";return item.reason.name.trim()')
                .replace('item.reason.name.trim()', 'item.reason.trim()');

            // An opaque consumer can replace the envelope's constructor or then
            // method even when its original payload is immutable.
            deepStrictEqual(conflictsFor(createAnalysis({ source: primitive })), [], primitive);
        }));
    });

    test('repeated rejection sources preserve payloads across guarded aggregate slots', async () => {
        const layouts = ['[p,p]', '[p,alias]', '[p,Promise.resolve(p)]', '[flag?p:q,p]', '[p,flag?p:q]', 'flag?[p,p]:[q,p]'];

        await Promise.all(layouts.flatMap(slots => ['42', '"ok"'].map(async (payload) => {
            const source = `const read=async(flag=false)=>{const p=Promise.reject(${payload});const alias=p;const q=Promise.resolve("ok");`
                + `try{await Promise.all(${slots});return "unreachable";}catch(error){return error;}};`;
            const actual = await Promise.all([false, true].map(flag => runInNewContext(source + `read(${flag});`)));
            const expected = payload === '"ok"' ? 'string' : 'number';
            const analysis = createAnalysis({ source });
            const before = analysis.checkFunction({ index: 0 });
            const { fact: { families = [], incomplete = true } = {}, normal = false, thrown = true } = before;

            deepStrictEqual(actual.map(value => typeof value), [expected, expected]);
            deepStrictEqual(families, [expected], source);
            strictEqual(incomplete, false, source);
            strictEqual(normal, true, source);
            strictEqual(thrown, false, source);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(analysis.checkFunction({ index: 0 }), before);
            const operation = source.replace('return error;', 'return error.trim();');

            strictEqual(lint(operation).length, expected === 'number' ? 1 : 0, operation);
        })));
        await Promise.all(layouts.map(async (slots) => {
            const source = 'const read=async(flag=false)=>{const p=Promise.reject({name:42});const alias=p;const q=Promise.resolve("ok");'
                + `try{await Promise.all(${slots});}catch(error){return typeof error==="string"?42:"ok";}};`;
            const { fact: { families = [], incomplete = true } = {} } = createAnalysis({ source }).checkFunction({ index: 0 });

            deepStrictEqual(families, ['string'], source);
            strictEqual(incomplete, false, source);
            deepStrictEqual(await Promise.all([false, true].map(flag => runInNewContext(source + `read(${flag});`))), ['ok', 'ok']);
        }));
    });

    test('conditional rejection alternatives keep one identity per reached native promise', async () => {
        await Promise.all(['[p,p]', '[p,Promise.resolve(p)]', '[flag?p:q,p]', '[p,flag?p:q]', 'flag?[p,p]:[q,p]'].map(async (slots) => {
            const source = 'const read=async(flag=false)=>{const p=flag?Promise.reject(42):Promise.reject("ok");const q=Promise.resolve(0);'
                + `try{await Promise.all(${slots});return false;}catch(error){return error;}};`;
            const actual = await Promise.all([false, true].map(flag => runInNewContext(source + `read(${flag});`)));
            const analysis = createAnalysis({ source });
            const before = analysis.checkFunction({ index: 0 });
            const { fact: { families = [], incomplete = true } = {}, thrown = true } = before;

            deepStrictEqual(actual, ['ok', 42]);
            deepStrictEqual(families.toSorted(), ['number', 'string'], source);
            strictEqual(incomplete, false, source);
            strictEqual(thrown, false, source);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(analysis.checkFunction({ index: 0 }), before);
        }));
    });

    test('guarded rejection aggregation grows with positions and reuses warm results', () => {
        const samples = [32, 128].map((width) => {
            const slots = Array.from({ length: width }, () => 'p').join(',');
            const source = 'const read=async(flag=false)=>{const p=flag?Promise.reject(42):Promise.reject("ok");'
                + `try{await Promise.all([${slots}]);}catch(error){return error;}};`;
            const analysis = createAnalysis({ source });
            const work = counter();
            const { onWork } = work;
            const result = analysis.checkFunction({ index: 0, onWork });
            const { fact: { families = [], incomplete = true } = {} } = result;
            const before = work.read();

            deepStrictEqual(families.toSorted(), ['number', 'string']);
            strictEqual(incomplete, false);
            deepStrictEqual(analysis.checkFunction({ index: 0, onWork }), result);
            ['rejection-contribution', 'settlement-projection', 'value-demand', 'function-context', 'flow-result']
                .forEach(kind => strictEqual(work.get(kind), Reflect.get(before, kind)));

            return work.get('rejection-contribution');
        });

        ok(samples.at(0) > 0);
        ok(samples.at(1) <= samples.at(0) * 4, JSON.stringify(samples));
    });

    test('concurrent rejection payloads cannot be selected by array position', async () => {
        const body = 'try{await Promise.all([later(),Promise.reject({name:"ok"})]);}catch(error){error.name.trim();}';
        const source = 'const later=async()=>{await 0;throw {name:42};};' + body;

        strictEqual(runtime(source), 0);
        deepStrictEqual(conflictsFor(createAnalysis({ source })), []);
        strictEqual(lint(source).length, 0);

        const unique = source.replace('Promise.reject({name:"ok"})', 'Promise.resolve({name:"ok"})');

        strictEqual(runtime(unique), 1);
        deepStrictEqual(conflictsFor(createAnalysis({ source: unique })), ['number']);
        strictEqual(lint(unique).length, 1);

        // Both reaction orders have executable witnesses. An observation from one
        // schedule cannot establish a generic payload or an array-position winner.
        const competing = 'const fail=async(value,later=false)=>{if(later)await 0;throw value;};'
            + 'const read=async(later=false)=>{try{return await Promise.all([fail(42,later),fail("ok",!later)]);}catch(error){return error;}};';
        const actual = await Promise.all([false, true].map(later => runInNewContext(competing + `read(${later});`)));
        const analysis = createAnalysis({ source: competing });
        const { status = '', normal = false, fact: { families = [], incomplete = false } = {}, diagnostics = [] } = analysis.checkFunction({ index: 1 });

        deepStrictEqual(actual, [42, 'ok']);
        strictEqual(status, 'unknown');
        strictEqual(normal, true);
        strictEqual(incomplete, true);
        deepStrictEqual(families, []);
        deepStrictEqual(diagnostics, []);
    });

    test('literal guards preserve known record branches beside opaque values', () => {
        const flag = 'const flag=Boolean(process.argv.at(1));';
        const consume = 'if(item.status==="fulfilled")item.value.trim();';

        [
            ['"rejected"', '{"status":"fulfilled","value":"ok"}', []],
            ['"fulfilled"', '{"status":"rejected","value":"ok"}', ['number']],
            [`JSON.parse('"fulfilled"')`, '{"status":"rejected","value":"ok"}', ['number']]
        ].forEach(([status = '', fallback = '', expected = []] = []) => {
            const source = flag + `const item=flag?{status:${status},value:42}:JSON.parse(${JSON.stringify(fallback)});` + consume;

            deepStrictEqual(conflictsFor(createAnalysis({ source })), expected);
            strictEqual(lint(source).length, expected.length);
            strictEqual(runtime(source), 0);
            strictEqual(runtime(source, ['primary']), expected.length);
        });
    });

    test('copied discriminators retain their payload through opaque alternatives and independent writers', () => {
        const flag = 'const flag=Boolean(process.argv.at(1));';
        const copies = [
            'const copy={...item};',
            'const {...copy}=item;',
            'const copy={...item,...(flag?{other:0}:{other:1})};',
            'const copy={...item,...(Boolean(process.argv.at(2))?{other:0}:{other:1})};',
            'const copy=(value=>({...value}))(item);',
            'const copy=(value=>()=>({...value}))(item)();'
        ];

        copies.forEach((copy) => {
            ['rejected', 'fulfilled'].forEach((status) => {
                const source = flag + `const item=flag?{status:"${status}",value:42}:JSON.parse('{"status":"fulfilled","value":"ok"}');`
                    + copy + 'const {status="",value=""}=copy;if(status==="fulfilled")value.trim();';
                const analysis = createAnalysis({ source });
                const expected = status === 'fulfilled' ? ['number'] : [];

                deepStrictEqual(conflictsFor(analysis), expected, source);
                strictEqual(lint(source).length, expected.length);
                strictEqual(runtime(source), 0);
                strictEqual(runtime(source, ['primary']), expected.length);
                strictEqual(runtime(source, ['primary', 'other']), expected.length);
                analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
                deepStrictEqual(conflictsFor(analysis), expected);
            });
        });
    });

    test('copied discriminator overwrites and rest exclusions select the final writer', () => {
        [
            ['const copy={...item,status:"fulfilled"};', ['number']],
            ['const copy={...item,...{status:"fulfilled"}};', ['number']],
            ['const copy={...item,...(flag?{status:"fulfilled"}:{other:0})};', ['number']],
            ['const copy={...item,status:"rejected"};', []],
            ['const copy={...item,value:"ok"};', []],
            ['const {value:ignored=0,...copy}=item;', []],
            ['const copy={...item,...JSON.parse("{}")};', []]
        ].forEach(([copy = '', expected = []] = []) => {
            const source = 'const flag=Boolean(process.argv.at(1));'
                + 'const item=flag?{status:"rejected",value:42}:JSON.parse(\'{"status":"fulfilled","value":"ok"}\');'
                + copy + 'const {status="",value=""}=copy;if(status==="fulfilled")value.trim();';

            deepStrictEqual(conflictsFor(createAnalysis({ source })), expected, source);
            strictEqual(lint(source).length, expected.length);
            strictEqual(runtime(source), 0);
            strictEqual(runtime(source, ['primary']), expected.length);
        });
    });

    test('aliases of destructured records share evidence and lifetime hazards', () => {
        [
            'const [item={}]=[{value:42}];',
            'const {item={}}={item:{value:42}};',
            'const [item={}]=await Promise.all([{value:42}]);',
            'const [item={}]=await Promise.allSettled([Promise.resolve(42)]);'
        ].forEach((input) => {
            ['', 'item.value="ok";', 'alias.value="ok";', 'external(item);', 'external(alias);'].forEach((effect) => {
                const external = effect.startsWith('external') ? 'const external=Reflect.get(JSON,"stringify");' : '';
                const source = external + input
                    + 'const copy=item;const alias=copy;' + effect + 'const {value=""}=alias;value.trim();';
                const expected = effect ? [] : ['number'];

                deepStrictEqual(conflictsFor(createAnalysis({ source })), expected, source);
                strictEqual(lint(source).length, expected.length);
                strictEqual(runtime(source.replace('42', '"ok"')), 0);

                if (!effect) strictEqual(runtime(source), 1);
            });
        });
    });

    test('successive independent copy writers share field selection work', () => {
        ['rejected', 'fulfilled'].forEach((tag) => {
            const observed = [2, 8].map((width) => {
                const layers = Array.from({ length: width }, (entry, index) => {
                    const previous = index ? `copy${index - 1}` : 'item';

                    return `const flag${index}=Boolean(process.argv.at(${index + 2}));`
                        + `const copy${index}={...${previous},...(flag${index}?{extra${index}:0}:{extra${index}:1})};`;
                }).join('');
                const source = 'const flag=Boolean(process.argv.at(1));'
                    + `const item=flag?{status:"${tag}",value:42}:JSON.parse('{"status":"fulfilled","value":"ok"}');`
                    + layers + `const {status="",value=""}=copy${width - 1};if(status==="fulfilled")value.trim();`;
                const analysis = createAnalysis({ source });
                const work = counter();
                const expected = tag === 'fulfilled' ? ['number'] : [];

                deepStrictEqual(conflictsFor(analysis, work), expected);
                strictEqual(runtime(source), 0);
                strictEqual(runtime(source, ['selected']), expected.length);

                const before = work.read();

                deepStrictEqual(conflictsFor(analysis, work), expected);
                deepStrictEqual(work.read(), before);

                return work.get('record-field-layer');
            });

            ok(observed.at(0) > 0);
            ok(observed.at(1) <= observed.at(0) * 4);
        });
    });

    test('copy presence is distinct from inherited property reads and default selection', () => {
        [
            ['const copy={...{}};', []],
            ['const {...copy}={};', []],
            ['const {toString:ignored=()=>0,...copy}={toString:()=>42};', []],
            ['const copy={toString:()=>42,...{}};', ['number']],
            ['const copy={...{toString:()=>42},toString:()=>"ok"};', []],
            ['const copy={...{toString:[][0]}};', ['number']]
        ].forEach(([copy = '', expected = []] = []) => {
            const source = copy + 'const {toString=()=>42}=copy;toString().trim();';

            deepStrictEqual(conflictsFor(createAnalysis({ source })), expected, source);
            strictEqual(lint(source).length, expected.length);
            strictEqual(runtime(source), expected.length);
        });
    });
}

{
    const conflicts = conflictsShared;
    const verify = lintShared2;
    const changed = 'const touch=p=>{if(p instanceof Promise)p.constructor=Object;p.then=resolve=>resolve("ok");};'
        + 'const touchBox=box=>touch(box[0]);';
    const observers = [
        'const value=await selected;',
        'const value=await Promise.resolve(selected);',
        'const [value]=await Promise.all([selected]);',
        'const [item={}]=await Promise.allSettled([selected]);if(item.status!=="fulfilled")return "rejected";const value=item.value;',
        'const forward=async value=>value;const value=await forward(selected);',
        'const forward=async value=>await value;const value=await forward(selected);'
    ];

    test('escaped adoption protocols do not retain earlier payload conflicts through aliases and carriers', async () => {
        const carriers = [
            'touch(p);const selected=p;',
            'const selected=p;touch(p);',
            'const alias=p;touch(alias);const selected=p;',
            'const box=[p];touchBox(box);const selected=p;',
            'const selected=Promise.resolve(p);touch(p);',
            'const identity=value=>value;const selected=identity(p);touch(p);',
            'const hold=value=>()=>value;const read=hold(p);touch(p);const selected=read();'
        ];

        await Promise.all(carriers.flatMap(carry => observers.map(async (observe) => {
            const source = `const run=async()=>{const p=Promise.resolve(42);${carry}${observe}return value.trim();};`;
            const analysis = createAnalysis({ source });

            strictEqual(await runInNewContext(changed + source + 'run();'), 'ok', source);
            deepStrictEqual(conflicts(analysis), [], source);
            deepStrictEqual(verify(source), [], source);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(conflicts(analysis), [], source);
        })));
    });

    test('escaped nonpromise values can acquire adoption protocols', async () => {
        await Promise.all(['{name:42}', '[]', '(()=>0)', '/x/'].flatMap(initial => observers.map(async (observe) => {
            const source = `const run=async()=>{const p=${initial};touch(p);const selected=p;${observe}return typeof value==="string"?"ok":42;};`;
            const analysis = createAnalysis({ source });
            const { fact: { families = [], incomplete = true } = {} } = analysis.checkFunction({ index: 0 });

            strictEqual(await runInNewContext(changed + source + 'run();'), 'ok', source);
            deepStrictEqual(families.toSorted(), ['number', 'string'], source);
            strictEqual(incomplete, false, source);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(analysis.checkFunction({ index: 0 }).fact.families.toSorted(), ['number', 'string'], source);
        })));
    });

    test('native resolve can return an existing promise with an overridden then method', async () => {
        const witness = 'const choices=[false,true].values();const input=Promise.resolve(0);'
            + 'input.then=(resolve,reject)=>(choices.next().value?reject:resolve)(0);';
        const factories = ['Promise.resolve(input)', '(()=>Promise.resolve(input))()', '((value)=>Promise.resolve(value))(input)',
            '((value)=>Promise.resolve(value()))(()=>input)'];

        await Promise.all(factories.map(async (factory) => {
            const source = `const run=async(input)=>{const p=${factory};const [a={},b={}]=await Promise.allSettled([p,p]);`
                + 'const value=a.status==="fulfilled"&&b.status==="rejected"?42:"ok";return value.trim();};';
            const [{ status = '', reason: { name = '' } = {} } = {}] = await runInNewContext(source + witness + 'Promise.allSettled([run(input)]);');
            const analysis = createAnalysis({ source });

            deepStrictEqual([status, name], ['rejected', 'TypeError'], source);
            deepStrictEqual(conflicts(analysis), ['number'], source);
            strictEqual(verify(source).length, 1, source);
        }));
    });

    test('completed native adoption survives a later envelope override', async () => {
        await Promise.all(['Promise.all([p])', 'Promise.allSettled([p])'].map(async (factory) => {
            const read = factory.includes('allSettled') ? 'const [item={}]=await pending;const value=item.value;' : 'const [value]=await pending;';
            const source = `const run=async()=>{const p=Promise.resolve(42);const pending=${factory};touch(p);${read}return value.trim();};`;
            const [{ status = '', reason: { name = '' } = {} } = {}] = await runInNewContext(changed + source + 'Promise.allSettled([run()]);');

            deepStrictEqual([status, name], ['rejected', 'TypeError']);
            deepStrictEqual(conflicts(createAnalysis({ source })), ['number'], source);
            strictEqual(verify(source).length, 1, source);
        }));
    });

    test('closed array carriers retain repeated native rejection identity', async () => {
        await Promise.all(['const list=[p,p];', 'const items=[p,p];const list=items;',
            'const other=[p,p];await Promise.allSettled(other);const list=[p,p];'].map(async (carry) => {
            const source = `const run=async()=>{const p=Promise.reject(42);${carry}try{await Promise.all(list);}catch(error){return error;}};`;
            const analysis = createAnalysis({ source });
            const before = analysis.checkFunction({ index: 0 });
            const { fact: { families = [], incomplete = true } = {} } = before;

            strictEqual(await runInNewContext(source + 'run();'), 42, source);
            deepStrictEqual(families, ['number'], source);
            strictEqual(incomplete, false);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(analysis.checkFunction({ index: 0 }), before);
        }));
    });

    test('aggregate protocol failures reject allSettled before a settlement record exists', async () => {
        await Promise.all(['constructor', 'then'].flatMap(property => ['all', 'allSettled'].map(async (method) => {
            const source = `const run=async(input)=>{await Promise.${method}([input]);return "ok";};`;
            const witness = `const input=Promise.resolve(0);Object.defineProperty(input,"${property}",{get(){throw 0;}});`;
            const analysis = createAnalysis({ source });
            const { fact: { families = [], incomplete = true } = {}, thrown = false } = analysis.checkFunction({ index: 0 });
            const [{ status = '' } = {}] = await runInNewContext(source + witness + 'Promise.allSettled([run(input)]);');

            strictEqual(status, 'rejected', source);
            deepStrictEqual(families, ['string'], source);
            strictEqual(incomplete, false);
            strictEqual(thrown, true);
            const plain = source.replace('([input])', '([{get then(){throw 0;}}])');
            const { thrown: ordinary = false } = createAnalysis({ source: plain }).checkFunction({ index: 0 });
            const [{ status: completed = '' } = {}] = await runInNewContext(plain + 'Promise.allSettled([run()]);');

            strictEqual(ordinary, method === 'all', plain);
            strictEqual(completed, method === 'all' ? 'rejected' : 'fulfilled');
        })));
    });

    test('adoption does not consume promises nested inside returned array payloads', async () => {
        const carriers = [
            'const box=await [p];',
            'const box=await Promise.resolve([p]);',
            'const [box]=await Promise.all([[p]]);',
            'const [item={}]=await Promise.allSettled([[p]]);const box=item.value;',
            'const list=[[p]];const [box]=await Promise.all(list);',
            'const [box]=await Promise.all([Promise.resolve([p])]);',
            'const box=await(flag?[p]:[p,p]);',
            'const [box]=await Promise.all([flag?[p]:[p,p]]);'
        ];

        await Promise.all(carriers.flatMap(carry => [false, true].map(async (flag) => {
            const source = `const run=async(flag=false)=>{const p=Promise.resolve(42);${carry}touchBox(box);const value=await p;return value.trim();};`;
            const analysis = createAnalysis({ source });

            strictEqual(await runInNewContext(changed + source + `run(${flag});`), 'ok', source);
            deepStrictEqual(conflicts(analysis), [], source);
            deepStrictEqual(verify(source), [], source);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(conflicts(analysis), [], source);
        })));
    });

    test('adopted function results can publish an input promise through a returned carrier', async () => {
        const shapes = [['{saved:value}', 'box.saved'], ['[value]', 'box[0]']];
        const reads = [
            'const box=await wrap(p);',
            'const [box]=await Promise.all([wrap(p)]);',
            'const [item={}]=await Promise.allSettled([wrap(p)]);const box=item.value;',
            'const box=await Promise.resolve(wrap(p));'
        ];

        await Promise.all(shapes.flatMap(([shape = '', selected = ''] = []) => ['', 'async '].flatMap(kind => reads.map(async (read) => {
            const source = `const run=async()=>{const p=Promise.resolve(42);const wrap=${kind}value=>(${shape});${read}touchCarrier(box);`
                + 'const value=await p;return value.trim();};';
            const prefix = changed + `const touchCarrier=box=>touch(${selected});`;
            const analysis = createAnalysis({ source });

            strictEqual(await runInNewContext(prefix + source + 'run();'), 'ok', source);
            deepStrictEqual(conflicts(analysis), [], source);
            deepStrictEqual(verify(source), [], source);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(conflicts(analysis), [], source);
        }))));
    });

    test('adoption can publish the original nonpromise receiver and its mutable fields', async () => {
        const reads = ['const box=await p;', 'const box=await Promise.resolve(p);', 'const [box]=await Promise.all([p]);',
            'const [item={}]=await Promise.allSettled([p]);const box=item.value;', 'const list=[p];const [box]=await Promise.all(list);'];

        await Promise.all(['{name:42}', '[]', '(()=>0)', '/x/'].flatMap(initial => reads.map(async (read) => {
            const source = `const run=async()=>{const p=${initial};${read}touch(box);const value=await p;return typeof value==="string"?"ok":42;};`;
            const analysis = createAnalysis({ source });
            const expected = analysis.checkFunction({ index: 0 });
            const { fact: { families = [], incomplete = true } = {} } = expected;

            strictEqual(await runInNewContext(changed + source + 'run();'), 'ok', source);
            deepStrictEqual(families.toSorted(), ['number', 'string'], source);
            strictEqual(incomplete, false, source);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(analysis.checkFunction({ index: 0 }), expected, source);
            const fields = `const run=async()=>{const p={name:42};${read}touch(box);return p.name.trim();};`;

            strictEqual(await runInNewContext('const touch=box=>{box.name="ok";};' + fields + 'run();'), 'ok', fields);
            deepStrictEqual(conflicts(createAnalysis({ source: fields })), [], fields);
        })));
    });

    test('carrier publication ends temporary permission within one declaration and on rejection', async () => {
        const sources = [
            'const wrap=value=>({saved:value});const box=await wrap(p),unused=touch(box.saved),value=await p;return value.trim();',
            'const wrap=async value=>({saved:value});const box=await wrap(p),unused=touch(box.saved),value=await p;return value.trim();',
            'const wrap=async value=>{throw {saved:value};};try{await wrap(p);}catch(box){touch(box.saved);}const value=await p;return value.trim();',
            'const wrap=value=>Promise.reject(value);try{await wrap(p);}catch(box){touch(box);}const value=await p;return value.trim();'
        ];

        await Promise.all(sources.map(async (body) => {
            const source = `const run=async()=>{const p=Promise.resolve(42);${body}};`;
            const analysis = createAnalysis({ source });

            strictEqual(await runInNewContext(changed + source + 'run();'), 'ok', source);
            deepStrictEqual(conflicts(analysis), [], source);
            deepStrictEqual(verify(source), [], source);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(conflicts(analysis), [], source);
        }));
    });

    test('completed pure native forwarding preserves subsequent numeric contradictions', async () => {
        const forwards = ['value=>value', 'value=>Promise.resolve(value)', 'async value=>value', 'async value=>await value'];
        const reads = ['const box=await forward(p);', 'const [box]=await Promise.all([forward(p)]);',
            'const [item={}]=await Promise.allSettled([forward(p)]);', 'const box=await Promise.resolve(forward(p));'];

        await Promise.all(forwards.flatMap(forward => reads.map(async (read) => {
            const source = `const run=async()=>{const p=Promise.resolve(42);const forward=${forward};${read}const value=await p;return value.trim();};`;
            const [{ status = '', reason: { name = '' } = {} } = {}] = await runInNewContext(source + 'Promise.allSettled([run()]);');
            const analysis = createAnalysis({ source });

            deepStrictEqual([status, name], ['rejected', 'TypeError'], source);
            deepStrictEqual(conflicts(analysis), ['number'], source);
            strictEqual(verify(source).length, 1, source);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(conflicts(analysis), ['number'], source);
        })));
    });

    test('native protocol alternatives retain contradictions beside exposed nonpromises', async () => {
        const inputs = ['flag?Promise.resolve(42):{}', 'flag?{}:Promise.resolve(42)', 'flag?Promise.resolve(42):input'];
        const reads = ['const box=await p;', 'const [box]=await Promise.all([p]);',
            'const [item={}]=await Promise.allSettled([p]);const box=item.value;'];

        await Promise.all(inputs.flatMap(input => reads.map(async (read) => {
            const source = `const run=async(flag,input)=>{const p=${input};${read}touch(box);const value=await p;return value.trim();};`;
            const actual = await Promise.all([false, true].map(async flag => (
                runInNewContext('const touch=box=>{if(typeof box==="object")box.then=resolve=>resolve("ok");};'
                    + source + `run(${flag},{}).then(value=>value,error=>error.name);`)
            )));
            const analysis = createAnalysis({ source });

            deepStrictEqual(actual.toSorted(), ['TypeError', 'ok'], source);
            deepStrictEqual(conflicts(analysis), ['number'], source);
            strictEqual(verify(source).length, 1, source);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(conflicts(analysis), ['number'], source);
        })));
    });

    test('native resolve keeps guarded known contradictions beside opaque adoption', async () => {
        const inputs = ['flag?42:input', 'flag?Promise.resolve(42):input', 'flag?Promise.resolve(42):{}'];

        await Promise.all(inputs.flatMap(input => observers.map(async (observe) => {
            const source = `const run=async(flag,input)=>{const selected=Promise.resolve(${input});${observe}return value.trim();};`;
            const [{ status = '', reason: { name = '' } = {} } = {}] = await runInNewContext(source + 'Promise.allSettled([run(true,"ok")]);');
            const analysis = createAnalysis({ source });

            deepStrictEqual([status, name], ['rejected', 'TypeError'], source);
            deepStrictEqual(conflicts(analysis), ['number'], source);
            strictEqual(verify(source).length, 1, source);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(conflicts(analysis), ['number'], source);
        })));
    });

    test('completed native identity forwarding retains opaque settlement correlation', async () => {
        const forwards = ['value=>value', 'value=>Promise.resolve(value)'];
        const reads = ['try{await forward(p);}catch(error){}', 'try{await Promise.all([forward(p)]);}catch(error){}'];

        await Promise.all(forwards.flatMap(forward => reads.map(async (read) => {
            const source = `const run=async(input)=>{const p=Promise.race([input]);const forward=${forward};${read}`
                + 'const [a={},b={}]=await Promise.allSettled([p,p]);const value=a.status==="fulfilled"&&b.status==="rejected"?42:"ok";return value.trim();};';
            const analysis = createAnalysis({ source });

            await Promise.all(['Promise.resolve(42)', 'Promise.reject(42)', 'Promise.resolve({})'].map(async input => (
                strictEqual(await runInNewContext(source + `run(${input});`), 'ok', source)
            )));
            deepStrictEqual(conflicts(analysis), [], source);
            deepStrictEqual(verify(source), [], source);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(conflicts(analysis), [], source);
        })));
    });

    test('protocol lifetime events stay bounded across repeated calls and publication depth', () => {
        [[8, 8], [8, 32], [32, 8], [32, 32]].forEach(([width = 0, depth = 0] = []) => {
            const source = 'const run=async()=>{const p=Promise.resolve(42);const forward=value=>Promise.resolve(value);'
                + Array.from({ length: depth }, (unused, index) => `const batch${index}=await Promise.all([${Array.from({ length: width }, () => 'forward(p)').join(',')}]);`).join('')
                + 'const value=await p;return value.trim();};';
            const analysis = createAnalysis({ source });
            const work = counter();
            const query = () => analysis.memberAccesses.filter(({ name = '' } = {}) => name === 'trim').flatMap(({ index = -1 } = {}) => (
                analysis.checkMemberAccess({ index, onWork: event => work.onWork(event) }).conflicts
            ));
            const size = width * depth;

            deepStrictEqual(query(), ['number']);
            const before = work.read();
            const { counts: { expressions = 0, values = 0, contexts = 0 } = {} } = analysis;

            ok(expressions <= 6 * size + 6 * depth + 32);
            ok(values <= 6 * size + 8 * depth + 64);
            ok(contexts <= size + 8);
            ok(work.get('value-demand') <= 15 * size + 12 * depth + 64);
            ok(work.get('settlement-projection') <= 12 * size + 8 * depth + 64);
            deepStrictEqual(query(), ['number']);
            ['value-demand', 'settlement-projection', 'value-selection', 'function-context'].forEach(kind => strictEqual(work.get(kind), Reflect.get(before, kind)));
        });
    });

    test('native resolve preserves synchronous constructor acquisition failure', async () => {
        const factories = ['Promise.resolve(input)', 'Native.resolve(input)', 'forward(input)', 'Promise.resolve(flag?input:42)',
            'Promise.resolve(flag?42:input)', 'Promise.resolve(Promise.resolve(input))'];

        await Promise.all(factories.map(async (factory) => {
            const source = `const Native=Promise;const forward=value=>Promise.resolve(value);const run=(input,flag=true)=>{${factory};return "ok";};`;
            const witness = 'const input=Promise.resolve(42);Object.defineProperty(input,"constructor",{get(){throw 9;}});';
            const actual = runInNewContext(source + witness + `(()=>{try{return run(input,${!factory.includes('flag?42')});}catch(error){return error;}})();`);
            const analysis = createAnalysis({ source });
            const index = 1;
            const result = analysis.checkFunction({ index });
            const { thrown = false, fact: { families = [] } = {} } = result;

            strictEqual(actual, 9, source);
            strictEqual(thrown, true, source);
            deepStrictEqual(families, ['string'], source);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(analysis.checkFunction({ index }), result, source);
        }));
    });

    test('discarded await retains implicit thenable effects on receiver aliases', async () => {
        const uses = ['await selected;', 'void(await selected);', 'if(await selected){}', '(await selected)?0:1;', '!(await selected);'];
        const carries = ['const selected=p;', 'const alias=p;const selected=alias;', 'const selected=flag?p:p;'];

        await Promise.all(uses.flatMap(use => carries.map(async (carry) => {
            const source = `const run=async(flag=false)=>{const p={name:42,then(resolve){this.name="ok";resolve(true);}};${carry}${use}return p.name.trim();};`;
            const analysis = createAnalysis({ source });

            strictEqual(await runInNewContext(source + 'run();'), 'ok', source);
            deepStrictEqual(conflicts(analysis), [], source);
            deepStrictEqual(verify(source), [], source);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(conflicts(analysis), [], source);
        })));
    });

    test('inert discarded await retains ordinary receiver fields', async () => {
        const shapes = [['{name:42}', 'p.name'], ['{name:42,then:0}', 'p.name'], ['[42]', 'p[0]']];
        const uses = ['await selected;', 'void(await selected);', 'if(await selected){}', '(await selected)?0:1;', '!(await selected);'];

        await Promise.all(shapes.flatMap(([shape = '', read = ''] = []) => uses.map(async (use) => {
            const source = `const run=async()=>{const p=${shape};const selected=p;${use}return ${read}.trim();};`;
            const [{ status = '', reason: { name = '' } = {} } = {}] = await runInNewContext(source + 'Promise.allSettled([run()]);');
            const analysis = createAnalysis({ source });

            deepStrictEqual([status, name], ['rejected', 'TypeError'], source);
            deepStrictEqual(conflicts(analysis), ['number'], source);
            strictEqual(verify(source).length, 1, source);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(conflicts(analysis), ['number'], source);
        })));
    });

    test('constructor acquisition and thenable rejection retain different completion boundaries', async () => {
        const factories = ['Promise.resolve({get then(){throw 9;}})', 'Promise.reject({get constructor(){throw 9;}})',
            'Promise.resolve(Promise.resolve(42))', 'Promise.resolve(flag?42:"ok")'];

        await Promise.all(factories.map(async (factory, index) => {
            const source = `const run=(flag=false)=>${factory};`;
            const actual = await runInNewContext(source + '(()=>{try{const p=run();return Promise.prototype.then.call(p,'
                + 'value=>({normal:true,rejected:false}),error=>({normal:true,rejected:true}));}catch(error){return {normal:false};}})();');
            const { normal = false, rejected = false } = actual;
            const analysis = createAnalysis({ source });
            const result = analysis.checkFunction({ index: 0 });
            const { thrown = true } = result;

            strictEqual(normal, true, source);
            strictEqual(rejected, index < 2, source);
            strictEqual(thrown, false, source);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(analysis.checkFunction({ index: 0 }), result, source);
        }));
    });

    test('conditional discarded awaits preserve untouched alternatives beside effects', async () => {
        const uses = ['if(flag)await p;', 'if(flag)void(await p);', 'if(!flag)await p;', 'await(flag?p:42);', 'await(flag?42:p);'];

        await Promise.all(uses.map(async (use) => {
            const source = `const run=async(flag)=>{const p={name:42,then(resolve){this.name="ok";resolve(true);}};${use}return p.name.trim();};`;
            const actual = await Promise.all([false, true].map(flag => runInNewContext(source + `run(${flag}).then(value=>value,error=>error.name);`)));
            const analysis = createAnalysis({ source });

            deepStrictEqual(actual.toSorted(), ['TypeError', 'ok'], source);
            deepStrictEqual(conflicts(analysis), ['number'], source);
            strictEqual(verify(source).length, 1, source);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(conflicts(analysis), ['number'], source);
        }));
    });

    test('successive native constructor acquisition retains linear completion storage and warm reuse', () => {
        [50, 100, 200].forEach((size) => {
            const source = 'const run=input=>{' + Array.from({ length: size }, (unused, index) => `const p${index}=Promise.resolve(input);`).join('') + 'return "ok";};';
            const analysis = createAnalysis({ source });
            const work = counter();
            const query = () => analysis.checkFunction({ index: 0, onWork: event => work.onWork(event) });
            const result = query();
            const { thrown = false, fact: { families = [], incomplete = true } = {} } = result;
            const { counts: { expressions = 0, values = 0, decisions = 0, decisionWork = 0 } = {} } = analysis;

            strictEqual(thrown, true);
            deepStrictEqual(families, ['string']);
            strictEqual(incomplete, false);
            ok(expressions <= 6 * size + 4);
            ok(values <= 8 * size + 4);
            ok(decisions <= 12 * size + 8);
            ok(decisionWork <= 28 * size + 8);
            ok(work.get('value-demand') <= 12 * size + 4);
            ok(work.get('settlement-projection') <= 2 * size + 4);
            const before = work.read();

            deepStrictEqual(query(), result);
            ['value-demand', 'value-selection', 'settlement-projection', 'flow-contribution'].forEach(kind => strictEqual(work.get(kind), Reflect.get(before, kind)));
        });
    });
}

{
    const cases = JSON.parse(readFileSync(new URL('./fixtures/promise-ownership.json', import.meta.url), 'utf8'));
    const lint = new ESLint({ overrideConfigFile: true, overrideConfig: {
        plugins: { resilient: plugin }, rules: { 'resilient/no-unhandled-promise-chain': 'error' }
    } });
    const findings = (analysis) => {
        const { promiseUses = [] } = analysis;

        return promiseUses.map(({ index = -1 } = {}) => analysis.checkPromiseUse({ index })).filter(({ unhandled = false } = {}) => unhandled);
    };
    cases.forEach(({ name = '', source = '', findings: expected = 0 } = {}) => {
        test(`promise ownership evidence: ${name}`, () => strictEqual(findings(createAnalysis({ source })).length, expected));
        test(`product promise ownership: ${name}`, async () => {
            const [{ messages = [] } = {}] = await lint.lintText(source);

            strictEqual(messages.length, expected);
            messages.forEach(({ ruleId = '', messageId = '', fix = false, suggestions = [] } = {}) => {
                strictEqual(ruleId, 'resilient/no-unhandled-promise-chain');
                strictEqual(messageId, 'unhandled');
                strictEqual(fix, false);
                deepStrictEqual(suggestions, []);
            });
        });
    });

    test('promise alternatives preserve known work beside unknown without borrowing caller facts', () => {
        const source = 'const load=async()=>1;const forward=value=>value;forward(load());forward(external);'
            + 'const mixed=()=>flag?load():external;mixed();'
            + 'let pending;flag?(pending=load()):load();[1].map(()=>load());false?load():0;void pending;'
            + 'const reuse=()=>{const owned=load();[owned].map(value=>value);[owned].map(async()=>1);return owned;};'
            + 'const create=()=>{const pending=load();return pending;};[1].map(create);';
        const first = createAnalysis({ source });
        const second = createAnalysis({ source });
        const before = first.checkFunction({ index: 1 });
        const found = findings(first);
        const { promiseUses = [] } = first;
        const owned = promiseUses.find(({ location: { range: [start = 0, end = 0] = [] } = {} } = {}) => source.slice(start, end) === '[owned].map(value=>value)') ?? {};
        const { known: retained = false, unhandled = true } = first.checkPromiseUse(owned);

        strictEqual(found.length, 6);
        strictEqual(retained, true);
        strictEqual(unhandled, false);
        const { alternatives = [] } = found.find(({ incomplete = false } = {}) => incomplete) ?? {};
        const { status = '' } = before;

        deepStrictEqual(alternatives.toSorted(), ['known', 'unknown']);
        strictEqual(status, 'unknown');
        deepStrictEqual(first.checkFunction({ index: 1 }), before);
        second.promiseUses.toReversed().forEach(({ index = -1 } = {}) => second.checkPromiseUse({ index }));
        deepStrictEqual(findings(second), found);
        deepStrictEqual(second.checkFunction({ index: 1 }), before);
    });

    test('public ownership queries freeze snapshots, validate indices and reuse completed demand', () => {
        const analysis = createAnalysis({ source: 'const load=async()=>1;const forward=()=>[[load()]];forward();' });
        const work = counter();
        const result = analysis.checkPromiseUse({ index: 0, onWork: event => work.onWork(event) });
        const before = work.read();
        const { promiseUses = [] } = analysis;
        const { alternatives = [] } = result;

        [promiseUses, promiseUses.at(0), result, alternatives].forEach(value => ok(Object.isFrozen(value)));
        deepStrictEqual(analysis.checkPromiseUse({ index: 0, onWork: event => work.onWork(event) }), result);
        deepStrictEqual(work.read(), before);
        [-1, 1, NaN, '0'].forEach(index => throws(() => analysis.checkPromiseUse({ index }), RangeError));
    });

    test('ownership snapshots and source revisions remain independent of host edits', () => {
        const source = 'const load=async()=>1;flag?load():0;[1].map(()=>load());'
            + 'const reuse=()=>{const pending=load();[pending].map(value=>value);return pending;};';
        const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
        const first = createProgramAnalysis({ program });

        runInNewContext('program.body[0].declarations[0].init.async=false;', { program });
        const second = createProgramAnalysis({ program });

        strictEqual(findings(first).length, 2);
        strictEqual(findings(second).length, 0);
        strictEqual(findings(first).length, 2);
    });

    test('every observed promise-proof failure propagates and permits a complete retry', () => {
        const source = 'const load=async()=>1;const forward=(flag,value)=>[flag?load():value];forward(external,external);';
        const expected = findings(createAnalysis({ source }));
        const work = counter();

        createAnalysis({ source }).checkPromiseUse({ index: 0, onWork: event => work.onWork(event) });
        Object.keys(work.read()).forEach((interrupted) => {
            const analysis = createAnalysis({ source });

            throws(() => analysis.checkPromiseUse({ index: 0, onWork: ({ kind = '' } = {}) => {
                if (kind === interrupted) throw new Error(`interrupted ${kind}`);
            } }), /interrupted/);
            deepStrictEqual(findings(analysis), expected);
        });
    });

    test('discarded retained contents share wide and successive promise selections', () => {
        const samples = [[8, 8], [16, 8], [8, 16], [16, 16]].map(([width = 0, depth = 0] = []) => {
            const parameters = [...Array.from({ length: depth }, (_, index) => `g${index}`), 'value'].join(',');
            const joins = Array.from({ length: depth }, (_, index) => `const p${index + 1}=g${index}?p${index}:${index ? 'p0' : 'value'};`).join('');
            const slots = Array.from({ length: width }, () => `p${depth}`).join(',');
            const args = Array.from({ length: depth + 1 }, () => 'external').join(',');
            const source = `const load=async()=>1;const make=(${parameters})=>{const p0=load();${joins}return [[ [${slots}] ]];};make(${args});`;
            const analysis = createAnalysis({ source });
            const { promiseUses = [] } = analysis;
            const query = promiseUses.find(({ eligible = false } = {}) => eligible) ?? {};
            const work = counter();
            const { onWork = () => {} } = work;
            const result = analysis.checkPromiseUse({ ...query, onWork });
            const { known = false, incomplete = false, unhandled = false } = result;

            strictEqual(known, true);
            strictEqual(incomplete, true);
            strictEqual(unhandled, true);
            const before = work.read();
            const { counts = {} } = analysis;
            const { values = 0 } = counts;

            deepStrictEqual(analysis.checkPromiseUse({ ...query, onWork }), result);
            deepStrictEqual(work.read(), before);
            const { counts: after = {} } = analysis;

            deepStrictEqual(after, counts);

            return { work: ['value-demand', 'flow-contribution', 'value-selection', 'value-ownership'].reduce((total, kind) => total + work.get(kind), 0),
                values };
        });
        const [{ work = 0, values = 0 } = {}] = samples;

        ok(work > 0 && values > 0);
        samples.slice(1).forEach(({ work: selected = 0, values: retained = 0 } = {}) => {
            ok(selected <= work * 3, 'Shared width and successive joins must not multiply the discarded-content histories');
            ok(retained <= values * 3, 'Retained state must follow acquired values instead of projection paths');
        });
    });

    test('async invocation and argument failure have distinct native completion obligations', async () => {
        strictEqual(runInNewContext('(async()=>1)() instanceof Promise'), true);
        await rejects(runInNewContext('(async()=>{throw new Error("body");})()'), /body/);
        await rejects(runInNewContext('const fail=()=>{throw new Error("default");};(async(value=fail())=>value)()'), /default/);
        await rejects(runInNewContext('new Promise(()=>{throw new Error("executor");})'), /executor/);
        throws(() => runInNewContext('const fail=()=>{throw new Error("argument");};(async()=>1)(fail())'), /argument/);
        throws(() => runInNewContext('new Promise(0)'), /not a function/);
        strictEqual(runInNewContext('(async function*(){yield 1;})() instanceof Promise'), false);
        strictEqual(runInNewContext('[1,2].map(async value=>value) instanceof Promise'), false);
        strictEqual(runInNewContext('const pending=Promise.resolve(1);[pending].map(value=>value)[0]===pending'), true);
        strictEqual(runInNewContext('const pending=Promise.resolve(1);[pending].map(async()=>1)[0]===pending'), false);
        deepStrictEqual(Array.from(await Promise.all(runInNewContext('[1,2].map(async value=>value)'))), [1, 2]);
        strictEqual(findings(createAnalysis({ source: 'const load=async()=>1;const fail=()=>{throw 1;};[load(),fail()];' })).length, 1);
    });

    test('the documented catch boundary does not certify subsequent rejection handling', async () => {
        const source = 'Promise.resolve().catch(()=>1).then(()=>{throw new Error("later");});';

        strictEqual(findings(createAnalysis({ source })).length, 0);
        await rejects(runInNewContext(source), /later/);
        const both = new ESLint({ overrideConfigFile: true, overrideConfig: {
            plugins: { resilient: plugin }, rules: { 'resilient/no-unhandled-promise-chain': 'error', 'resilient/prefer-async-await': 'warn' }
        } });
        const [{ messages = [] } = {}] = await both.lintText(source);

        deepStrictEqual(messages.map(({ ruleId = '' } = {}) => ruleId), ['resilient/prefer-async-await']);
    });

    test('shared chain syntax gives the ownership error priority over the style warning', async () => {
        const both = new ESLint({ overrideConfigFile: true, overrideConfig: {
            plugins: { resilient: plugin }, rules: { 'resilient/no-unhandled-promise-chain': 'error', 'resilient/prefer-async-await': 'warn' }
        } });
        const [{ messages = [] } = {}] = await both.lintText('request().then(first).then(second).finally(cleanup);');

        deepStrictEqual(messages.map(({ ruleId = '' } = {}) => ruleId), ['resilient/no-unhandled-promise-chain']);
    });

    test('source-backed async identity crosses renamed exports without executing dependency bodies', () => {
        const source = 'import { dispatch as launch } from "barrel";launch();';
        const acquire = dependency => createAnalysis({ source, filename: 'main', resolveModule: ({ source: name = '' } = {}) => ({
            filename: name, source: name === 'barrel' ? 'export { run as dispatch } from "worker";' : dependency
        }) });
        const first = acquire('throw new Error("NEVER EXECUTE");export async function run(){throw new Error("rejection");}');
        const second = acquire('export const run=()=>1;');

        strictEqual(findings(first).length, 1);
        strictEqual(findings(second).length, 0);
        strictEqual(findings(first).length, 1);
        strictEqual(findings(acquire('export async function* run(){yield 1;}')).length, 0);
        strictEqual(findings(acquire('export let run=async()=>1;run=external;')).length, 0);
        strictEqual(findings(acquire('export async function run(){}eval("run=()=>1");')).length, 0);
        strictEqual(findings(acquire('export async function run(){}const change=()=>eval("run=()=>1");change();')).length, 0);
        const failure = new Error('required source failed');

        throws(() => createAnalysis({ source, resolveModule: () => { throw failure; } }), error => error === failure);
        throws(() => createAnalysis({ source, resolveModule: () => ({ filename: 'worker' }) }), TypeError);
    });

    test('default declarations keep live binding identity while default expressions keep their source identity', () => {
        const source = 'import launch from "worker";launch();';
        const acquire = dependency => createAnalysis({ source, filename: 'main', resolveModule: () => ({ filename: 'worker', source: dependency }) });

        strictEqual(findings(acquire('export default async function run(){}')).length, 1);
        strictEqual(findings(acquire('export default async function run(){}run=()=>1;')).length, 0);
        strictEqual(findings(acquire('export default async function run(){}eval("run=()=>1");')).length, 0);
        strictEqual(findings(acquire('export default (async function run(){});')).length, 1);
    });

    test('product module snapshots observe async source revisions and live default bindings', async (context) => {
        const directory = mkdtempSync(join(tmpdir(), 'resilient-promises-'));

        context.after(() => rmSync(directory, { recursive: true, force: true }));
        const worker = join(directory, 'worker.js');
        const barrel = join(directory, 'barrel.js');
        const main = join(directory, 'main.js');
        const source = 'import { dispatch as launch } from "./barrel.js";launch();';
        const engine = new ESLint({ cwd: directory, overrideConfigFile: true, overrideConfig: {
            plugins: { resilient: plugin }, rules: { 'resilient/no-unhandled-promise-chain': 'error' }
        } });

        writeFileSync(worker, 'throw new Error("NEVER EXECUTE");export const run=async()=>1;');
        writeFileSync(barrel, 'export { run as dispatch } from "./worker.js";');
        const [{ messages: first = [] } = {}] = await engine.lintText(source, { filePath: main });

        strictEqual(first.length, 1);
        writeFileSync(worker, 'export const run=()=>1;');
        const [{ messages: second = [] } = {}] = await engine.lintText(source, { filePath: main });

        deepStrictEqual(second, []);
        writeFileSync(worker, 'export async function run(){throw new Error("rejection");}');
        const [{ messages: third = [] } = {}] = await engine.lintText(source, { filePath: main });

        strictEqual(third.length, 1);
        writeFileSync(barrel, 'export { default as dispatch } from "./worker.js";');
        writeFileSync(worker, 'export default async function run(){}run=()=>1;');
        const [{ messages: changed = [] } = {}] = await engine.lintText(source, { filePath: main });

        deepStrictEqual(changed, []);
        writeFileSync(worker, 'export default async function run(){}eval("run=()=>1");');
        const [{ messages: dynamic = [] } = {}] = await engine.lintText(source, { filePath: main });

        deepStrictEqual(dynamic, []);
    });

    test('native module execution distinguishes live default declarations from expression snapshots', () => {
        const { execPath = '' } = process;
        const source = `
        const live=await import('data:text/javascript,'+encodeURIComponent('export default async function run(){}run=()=>1;'));
        const snapshot=await import('data:text/javascript,'+encodeURIComponent('let run=async()=>1;export default run;run=()=>1;'));
        const pending=snapshot.default();
        console.log(JSON.stringify({live:live.default(),snapshot:pending instanceof Promise,value:await pending}));
    `;
        const result = JSON.parse(execFileSync(execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' }));

        deepStrictEqual(result, { live: 1, snapshot: true, value: 1 });
    });

    test('unknown and mixed Promise executors retain possible synchronous failure', () => {
        ['const run=executor=>new Promise(executor);', 'const run=flag=>new Promise(flag?()=>1:0);'].forEach((source) => {
            const analysis = createAnalysis({ source });
            const { normal = false, thrown = false } = analysis.checkFunction({ index: 0 });

            strictEqual(normal, true);
            strictEqual(thrown, true);
        });
        const { thrown = true } = createAnalysis({ source: 'const run=()=>new Promise(()=>1);' }).checkFunction({ index: 0 });

        strictEqual(thrown, false);
    });

    test('async predicates cannot validate a supplied callback through synchronous guard evidence', () => {
        const source = 'const callable=async value=>typeof value==="function";const use=({action})=>{if(callable(action))action();};';
        const analysis = createAnalysis({ source });
        const { declarations = [] } = analysis;
        const { index = -1 } = declarations.find(({ name = '' } = {}) => name === 'action') ?? {};
        const { required = false } = analysis.checkDeclaration({ index });

        strictEqual(required, true);
        throws(() => runInNewContext(`${source}use({action:42});`), ({ name = '' } = {}) => name === 'TypeError');
    });

    test('async and generator consumers carry callable requirements to the forwarding site', async () => {
        const guard = 'const isFunction=value=>typeof value==="function";';
        const pending = 'async function consume(cb){cb();}const run=({action})=>{if(action)return consume(action);};';
        const iterator = 'function* consume(cb){yield cb();}const run=({action})=>{if(action)consume(action).next();};';

        [pending, iterator].forEach((source) => {
            const requiredFor = (program) => {
                const analysis = createAnalysis({ source: guard + program });
                const { index = -1 } = analysis.declarations.find(({ name = '' } = {}) => name === 'action') ?? {};

                return analysis.checkDeclaration({ index }).required;
            };

            strictEqual(requiredFor(source), true, source);
            strictEqual(requiredFor(source.replace('if(action)', 'if(isFunction(action))')), false, source);
        });
        await rejects(runInNewContext(`${pending}run({action:42});`), ({ name = '' } = {}) => name === 'TypeError');
        throws(() => runInNewContext(`${iterator}run({action:42});`), ({ name = '' } = {}) => name === 'TypeError');
    });

    [
        ['an unknown apply spread', 'const prefix=[];async function consume(cb){cb();}'
            + 'function Relay(...args){this.pending=consume.apply(...prefix,null,args);}'],
        ['a chained receiver protocol', 'async function consume(cb){cb();}'
            + 'function Relay(...args){this.pending=consume.call.apply(consume,[null,...args]);}'],
        ['a replaced receiver protocol', 'const consume=cb=>{};consume.apply=async(receiver,cb)=>{cb();};'
            + 'function Relay(...args){this.pending=consume.apply(null,...args);}'],
        ['a tagged substitution', 'async function consume(parts,cb){cb();}'
            + 'function Relay(cb){this.pending=consume`value=${cb}`;}']
    ].forEach(([name = '', relay = ''] = []) => test(`constructor relays preserve an async consumer requirement through ${name}`, async () => {
        const prefix = 'const isFunction=value=>typeof value==="function";' + relay;
        const make = condition => `${prefix}const run=({action})=>{if(${condition})return new Relay(action).pending;};`;

        [true, false].forEach((required) => {
            const source = make(required ? 'action' : 'isFunction(action)');
            const analysis = createAnalysis({ source });
            const { index = -1 } = analysis.declarations.find(({ name = '' } = {}) => name === 'action') ?? {};

            strictEqual(analysis.checkDeclaration({ index }).required, required, source);
        });
        await rejects(runInNewContext(`${make('action')}run({action:42});`), ({ name = '' } = {}) => name === 'TypeError');
        strictEqual(runInNewContext(`${make('isFunction(action)')}run({action:42})===void 0;`), true);
    }));

    test('the native Promise executor keeps its callable requirement through construction and forwarding', () => {
        const scenarios = [
            ['', 'new Promise(action)'], ['', 'new Promise(...prefix,action)'],
            ['const Build=Promise;', 'new Build(...[],action)'],
            ['function Other(value){}', 'new (flag?Promise:Other)(action)'],
            ['function Relay(...args){new Promise(...args);}', 'new Relay(action)']
        ];
        const prelude = 'const isFunction=value=>typeof value==="function";const prefix=[];const flag=true;';
        const requiredFor = (source) => {
            const analysis = createAnalysis({ source });
            const { index = -1 } = analysis.declarations.find(({ name = '' } = {}) => name === 'action') ?? {};

            return analysis.checkDeclaration({ index }).required;
        };

        scenarios.forEach(([definitions = '', use = ''] = []) => {
            const make = condition => `${prelude}${definitions}const run=({action})=>{if(${condition})${use};};`;
            const unguarded = make('action');

            strictEqual(requiredFor(unguarded), true, unguarded);
            strictEqual(requiredFor(make('isFunction(action)')), false, use);
            throws(() => runInNewContext(`${unguarded}run({action:42});`), ({ name = '' } = {}) => name === 'TypeError');
        });
        strictEqual(requiredFor('function Promise(value){this.value=value;}const run=({action})=>{if(action)new Promise(action);};'), false);
    });

    test('standalone result queries cannot overwrite enclosing guard and member proofs', async () => {
        const source = 'const use=({action}={})=>{if(typeof action!=="function")return;action();};'
            + 'const run=value=>{if(typeof value==="string")value.trim();};';
        const read = analysis => ({
            declarations: analysis.declarations.map(({ index = -1 } = {}) => analysis.checkDeclaration({ index })),
            invocations: analysis.invocations.map(({ index = -1 } = {}) => analysis.checkInvocation({ index })),
            members: analysis.memberAccesses.map(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }))
        });
        const first = createAnalysis({ source });
        const expected = read(first);
        const second = createAnalysis({ source });

        findings(second);
        deepStrictEqual(read(second), expected);
        findings(first);
        deepStrictEqual(read(first), expected);
        const { declarations: [{ required = true } = {}] = [] } = expected;

        strictEqual(required, false);
        const names = ['no-unhandled-promise-chain', 'prefer-safe-destructuring-defaults', 'no-unguarded-callback-invocation', 'signature-contract-operation'];
        const results = await Promise.all([names, names.toReversed()].map(async (order) => {
            const engine = new ESLint({ overrideConfigFile: true, overrideConfig: {
                plugins: { resilient: plugin }, rules: Object.fromEntries(order.map(name => [`resilient/${name}`, 'error']))
            } });
            const [{ messages = [] } = {}] = await engine.lintText(source);

            return messages;
        }));

        deepStrictEqual(results, [[], []]);
    });

    const policyRules = {
        'resilient/no-unhandled-promise-chain': 'error',
        'resilient/prefer-async-await': 'warn',
        'resilient/no-silent-catch': 'error'
    };
    const policyConfig = { plugins: { resilient: plugin }, rules: policyRules };
    const policyFindings = source => new Linter().verify(source, policyConfig);

    test('style exceptions do not waive ownership or silent catches', () => {
        const source = '// eslint-disable-next-line resilient/prefer-async-await -- Required chain contract.\nrequest["then"](handle);';
        const messages = policyFindings(source).filter(({ ruleId = '' } = {}) => ruleId);

        deepStrictEqual(messages.map(({ messageId = '' } = {}) => messageId), ['unhandled']);
        deepStrictEqual(policyFindings('// eslint-disable-next-line resilient/prefer-async-await -- Required chain contract.\nrequest["then"](handle).catch(report);'), []);
        strictEqual(policyFindings('try {work();} catch {/* explanation alone */}').length, 1);
    });

    test('syntax chains do not establish promise identity or callable rejection handling', async () => {
        const unknown = createAnalysis({ source: 'external();' });

        deepStrictEqual(unknown.promiseUses.map(({ index = -1 } = {}) => unknown.checkPromiseUse({ index }).reason), ['unknown-result']);
        strictEqual(policyFindings('custom["then"](handle);').length, 1);
        const rejected = 'Promise.reject(new Error("unhandled"))["catch"](0);';

        deepStrictEqual(policyFindings(rejected), []);
        await rejects(runInNewContext(rejected), /unhandled/);
        const later = 'Promise.resolve()["catch"](report)["then"](()=>{throw new Error("later");});';

        await rejects(runInNewContext(later, { report: () => 0 }), /later/);
        deepStrictEqual(policyFindings(later).map(({ messageId = '' } = {}) => messageId), ['asyncAwait']);
        await rejects(runInNewContext('Promise.reject(new Error("tag"))["catch"]`value`;'), /tag/);
    });

    test('promise policy preserves diagnostics and source when fixing mixed chain forms', () => {
        const source = 'request.then(handle);request["then"](handle).catch(report);'
            + '(request?.then)`value`;const result=request.then(first).then(second);';
        const expected = policyFindings(source);
        const { output = '', fixed = true, messages = [] } = new Linter().verifyAndFix(source, policyConfig);

        strictEqual(output, source);
        strictEqual(fixed, false);
        deepStrictEqual(messages, expected);
    });

    test('async style reporting failures remain operational through the lint host', () => {
        const failure = new Error('async style report failed');
        const implementation = Reflect.get(plugin.rules, 'prefer-async-await');
        const broken = { ...implementation, create() {
            return implementation.create({ report() { throw failure; } });
        } };

        throws(() => new Linter().verify('const run=()=>request.then(handle);', {
            plugins: { probe: { rules: { style: broken } } }, rules: { 'probe/style': 'error' }
        }), error => error === failure);
    });
}

{
    const conflicts = conflictsShared;
    const verify = lintShared2;
    const paths = ['box.item', 'box[0]', 'box[0n]', 'box[-0n]'];
    const initializer = (path, value) => path === 'box.item' ? `const box={item:${value}};` : `const box=[${value}];`;
    const check = (source, expected) => {
        const analysis = createAnalysis({ source });

        deepStrictEqual(conflicts(analysis), expected, source);
        strictEqual(verify(source).length, expected.length, source);
        analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
        deepStrictEqual(conflicts(analysis), expected, source);
    };

    test('selected thenable members retire containing records through aliases copies and rest', async () => {
        const uses = ['await @value@;', 'void(await @value@);', 'if(await @value@){}', 'const result=await @value@;'];

        await Promise.all(paths.flatMap((path) => {
            const carries = [
                ['', path], ['const alias=box;', path.replace('box', 'alias')],
                [path === 'box.item' ? 'const {item}=box;' : 'const [item]=box;', 'item'],
                ['const copy={...box};', path.replace('box', 'copy')],
                ['const {...copy}=box;', path.replace('box', 'copy')],
                [`const copy={item:${path}};`, 'copy.item'], [`const copy=[${path}];`, 'copy[0]']
            ];

            return carries.flatMap(([carry = '', value = ''] = []) => uses.map(async (use) => {
                const source = 'const run=async()=>{' + initializer(path, '{name:42,then(resolve){this.name="ok";resolve(true);}}')
                    + carry + use.replaceAll('@value@', value) + `return ${path}.name.trim();};`;

                strictEqual(await runInNewContext(source + 'run();'), 'ok', source);
                check(source, []);
            }));
        }));
    });

    test('selected mutable member transfers retire original snapshots before opaque consumers', () => {
        paths.forEach(path => ['{item:@value@}', '[@value@]', '{item:flag?@value@:@value@}'].forEach((shape) => {
            const read = shape.startsWith('[') ? 'copy[0]' : 'copy.item';
            const source = 'const run=(flag=false)=>{' + initializer(path, '{name:42}')
                + `const copy=${shape.replaceAll('@value@', path)};touch(${read});return ${path}.name.trim();};`;
            const prefix = 'const touch=value=>{value.name="ok";};';

            strictEqual(runInNewContext(prefix + source + 'run();'), 'ok', source);
            check(source, []);
        }));
    });

    test('selected member coercions retain effects while inert observations retain evidence', () => {
        const uses = [
            ['+@value@;', true], ['`${@value@}`;', true], ['({[@value@]:0});', true], ['@value@==0;', true],
            ['void @value@;', false], ['!!@value@;', false], ['typeof @value@;', false],
            ['@value@===@value@;', false], ['@value@;', false], ['if(@value@){}', false]
        ];

        paths.forEach(path => uses.forEach(([use = '', effect = false] = []) => {
            const source = 'const run=()=>{' + initializer(path, '{name:42,valueOf(){this.name="ok";return 0;},toString(){this.name="ok";return "key";}}')
                + use.replaceAll('@value@', path) + `return ${path}.name.trim();};`;
            const actual = runInNewContext(source + '(()=>{try{return run();}catch(error){return error.name;}})();');

            strictEqual(actual, effect ? 'ok' : 'TypeError', source);
            check(source, effect ? [] : ['number']);
        }));
    });

    test('primitive member transfers preserve source evidence and mutable transfers preserve the acquired value', () => {
        paths.forEach(path => ['{item:@value@}', '[@value@]', '{item:flag?@value@:@value@}'].forEach((shape) => {
            const read = shape.startsWith('[') ? 'copy[0]' : 'copy.item';
            const source = 'const run=(flag=false)=>{' + initializer(path, '{name:42}')
                + `const copy=${shape.replaceAll('@value@', `${path}.name`)};touch(copy);return ${path}.name.trim();};`;
            const prefix = 'const touch=copy=>{copy.item="ok";copy[0]="ok";};';

            strictEqual(runInNewContext(prefix + source + '(()=>{try{return run();}catch(error){return error.name;}})();'), 'TypeError', source);
            check(source, ['number']);
            const acquired = 'const run=(flag=false)=>{' + initializer(path, '{name:42}')
                + `const copy=${shape.replaceAll('@value@', path)};return ${read}.name.trim();};`;

            strictEqual(runInNewContext(acquired + '(()=>{try{return run();}catch(error){return error.name;}})();'), 'TypeError', acquired);
            check(acquired, ['number']);
        }));
    });

    test('inert selected member awaits preserve fields through conditional observations', async () => {
        const uses = ['await @value@;', 'void(await @value@);', 'if(await @value@){}', '!(await @value@);'];

        await Promise.all(paths.flatMap(path => [path, `flag?${path}:${path}`].flatMap(value => uses.map(async (use) => {
            const source = 'const run=async(flag=false)=>{' + initializer(path, '{name:42}')
                + use.replaceAll('@value@', `(${value})`) + `return ${path}.name.trim();};`;
            const [{ status = '', reason: { name = '' } = {} } = {}] = await runInNewContext(source + 'Promise.allSettled([run()]);');

            deepStrictEqual([status, name], ['rejected', 'TypeError'], source);
            check(source, ['number']);
        }))));
    });

    test('returned selected members preserve closed capture reads and retain mutable return boundaries', () => {
        const returns = ['()=>@value@', '()=>{return @value@;}', 'function(){return @value@;}', 'flag=>flag?@value@:@value@'];

        returns.forEach((returned) => {
            ['{}', '{nmae:"ok"}'].forEach((shape) => {
                const source = `const box=${shape};const read=${returned.replaceAll('@value@', 'box.nmae')};`;
                const analysis = createAnalysis({ source });
                const missing = shape === '{}';
                const accesses = analysis.memberAccesses.filter(({ name = '' } = {}) => name === 'nmae');

                strictEqual(runInNewContext(source + 'typeof read();'), missing ? 'undefined' : 'string', source);
                accesses.forEach(({ index = -1 } = {}) => strictEqual(analysis.checkMemberAccess({ index }).missing, missing, source));
                strictEqual(new Linter().verify(source, {
                    plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-property': 'error' }
                }).length, missing ? accesses.length : 0, source);
            });
            ['box.item', 'box[0]'].forEach((path) => {
                const source = 'const run=()=>{' + initializer(path, '{name:42}')
                    + `const read=${returned.replaceAll('@value@', path)};touch(read());return ${path}.name.trim();};`;

                strictEqual(runInNewContext('const touch=value=>{value.name="ok";};' + source + 'run();'), 'ok', source);
                check(source, []);
            });
        });
    });

    test('selected spreads preserve primitive source fields and acquired values while retiring nested aliases', () => {
        paths.forEach(path => [false, true].forEach((array) => {
            const primitive = array ? '[42]' : '{name:42}';
            const nested = array ? '[{name:42}]' : '{inner:{name:42}}';
            const spread = array ? '[@prefix@...@value@]' : '{@prefix@...@value@}';
            const read = array ? '[0]' : '.name';
            const child = array ? '[0]' : '.inner';

            [path, `flag?${path}:${path}`].forEach(value => ['', array ? '0,' : 'other:0,'].forEach((prefix) => {
                const copy = spread.replace('@prefix@', prefix).replace('@value@', `(${value})`);
                const source = `const run=(flag=false)=>{${initializer(path, primitive)}const copy=${copy};touch(copy);return ${path}${read}.trim();};`;
                const mutate = 'const touch=copy=>{copy.name="ok";copy[0]="ok";};';

                strictEqual(runInNewContext(mutate + source + '(()=>{try{return run();}catch(error){return error.name;}})();'), 'TypeError', source);
                check(source, ['number']);
                const acquired = `const run=(flag=false)=>{${initializer(path, primitive)}const copy=${copy};return copy${array && prefix ? '[1]' : read}.trim();};`;

                strictEqual(runInNewContext(acquired + '(()=>{try{return run();}catch(error){return error.name;}})();'), 'TypeError', acquired);
                check(acquired, ['number']);
                const escaped = `const run=(flag=false)=>{${initializer(path, nested)}const copy=${copy};touch(copy${array && prefix ? '[1]' : child});return ${path}${child}.name.trim();};`;

                strictEqual(runInNewContext('const touch=value=>{value.name="ok";};' + escaped + 'run();'), 'ok', escaped);
                check(escaped, []);
            }));
        }));
    });

    test('selected copy proofs retain guarded contradictions and ordered fields without ignoring getter effects', () => {
        paths.forEach(path => [`{...${path}}`, `{...{},...${path},extra:0}`].forEach((copy) => {
            const conditional = `const run=(flag,input)=>{${initializer(path, 'flag?{name:42}:input')}const copy=${copy};touch(copy);return ${path}.name.trim();};`;
            const prefix = 'const touch=copy=>{copy.name="changed";};';

            [false, true].forEach(flag => strictEqual(runInNewContext(prefix + conditional
                + `(()=>{try{return run(${flag},{name:"ok"});}catch(error){return error.name;}})();`), flag ? 'TypeError' : 'ok', conditional));
            check(conditional, ['number']);
            const overwritten = `const run=()=>{${initializer(path, '{name:{},name:42}')}const copy=${copy};touch(copy);return ${path}.name.trim();};`;

            strictEqual(runInNewContext(prefix + overwritten + '(()=>{try{return run();}catch(error){return error.name;}})();'), 'TypeError', overwritten);
            check(overwritten, ['number']);
            const getter = `const run=()=>{${initializer(path, '{name:42,get extra(){this.name="ok";return 0;}}')}const copy=${copy};return ${path}.name.trim();};`;

            strictEqual(runInNewContext(getter + 'run();'), 'ok', getter);
            check(getter, []);
        }));
    });

    test('copy publication preserves primitive siblings beside mutable copied children', () => {
        paths.forEach(path => [false, true].forEach((array) => {
            const value = array ? '[42,{name:42}]' : '{name:42,child:{name:42}}';
            const copy = array ? `[...${path}]` : `{...${path}}`;
            const primitive = array ? '[0]' : '.name';
            const child = array ? '[1]' : '.child';
            const prefix = 'const touch=value=>{value.name="ok";};';

            [path + primitive, path + child + '.name'].forEach((read) => {
                const source = `const run=()=>{${initializer(path, value)}const copy=${copy};touch(copy${child});return ${read}.trim();};`;
                const modified = read.endsWith(child + '.name');

                strictEqual(runInNewContext(prefix + source + '(()=>{try{return run();}catch(error){return error.name;}})();'), modified ? 'ok' : 'TypeError', source);
                check(source, modified ? [] : ['number']);
            });
        }));
    });

    test('copied member aliases retire native promise protocols and preserve the acquired promise', async () => {
        const uses = ['const value=await @value@;', 'const [value]=await Promise.all([@value@]);',
            'const [result={}]=await Promise.allSettled([@value@]);if(result.status!=="fulfilled")return "ok";const value=result.value;'];

        await Promise.all(paths.flatMap(path => [false, true].flatMap(array => uses.map(async (use) => {
            const shape = array ? '[Promise.resolve(42)]' : '{pending:Promise.resolve(42)}';
            const field = array ? '[0]' : '.pending';
            const copy = array ? `[...${path}]` : `{...${path}}`;
            const source = `const run=async()=>{${initializer(path, shape)}const copy=${copy};touch(copy${field});`
                + use.replace('@value@', path + field) + 'return value.trim();};';
            const prefix = 'const touch=value=>{value.constructor=Object;value.then=resolve=>resolve("ok");};';

            strictEqual(await runInNewContext(prefix + source + 'run();'), 'ok', source);
            check(source, []);
            const acquired = `const run=async()=>{${initializer(path, shape)}const copy=${copy};`
                + use.replace('@value@', 'copy' + field) + 'return value.trim();};';
            const [{ status = '', reason: { name = '' } = {} } = {}] = await runInNewContext(acquired + 'Promise.allSettled([run()]);');

            deepStrictEqual([status, name], ['rejected', 'TypeError'], acquired);
            check(acquired, ['number']);
        }))));
    });

    test('conditional selected copies preserve untouched child evidence beside published aliases', () => {
        paths.forEach(path => ['flag', '!flag'].forEach((condition) => {
            const source = 'const run=(flag)=>{' + initializer(path, '{child:{name:42}}')
                + `if(${condition}){const copy={...${path}};touch(copy.child);}return ${path}.child.name.trim();};`;
            const prefix = 'const touch=value=>{value.name="ok";};';
            const actual = [false, true].map(flag => runInNewContext(prefix + source + `(()=>{try{return run(${flag});}catch(error){return error.name;}})();`));

            deepStrictEqual(actual.toSorted(), ['TypeError', 'ok'], source);
            check(source, ['number']);
        }));
    });

    test('selected copy retirement follows whole selected and destructured aliases', () => {
        paths.forEach((path) => {
            const aliases = [['const alias=box;', path.replace('box', 'alias')], [`const alias=${path};`, 'alias'],
                [path === 'box.item' ? 'const {item:alias}=box;' : 'const [alias]=box;', 'alias']];

            aliases.forEach(([binding = '', selected = ''] = []) => [false, true].forEach((child) => {
                const source = 'const run=()=>{' + initializer(path, '{name:42,child:{name:42}}') + binding
                    + `const copy={...${selected}};touch(copy.child);return ${path}${child ? '.child' : ''}.name.trim();};`;
                const prefix = 'const touch=value=>{value.name="ok";};';

                strictEqual(runInNewContext(prefix + source + '(()=>{try{return run();}catch(error){return error.name;}})();'), child ? 'ok' : 'TypeError', source);
                check(source, child ? [] : ['number']);
            }));
        });
    });

    test('copy publication retires captured child reads across closure creation order', () => {
        paths.forEach(path => [false, true].forEach(early => [false, true].forEach((child) => {
            const getter = `const get=()=>${path}${child ? '.child' : ''}.name;`;
            const key = path === 'box.item' ? 'item' : '0';
            const source = `const box={${key}:{name:42,child:{name:42}}};` + (early ? getter : '')
                + `const copy={...${path}};touch(copy.child);` + (early ? '' : getter) + 'const run=()=>get().trim();';
            const prefix = 'const touch=value=>{value.name="ok";};';

            strictEqual(runInNewContext(prefix + source + '(()=>{try{return run();}catch(error){return error.name;}})();'), child ? 'ok' : 'TypeError', source);
            check(source, child ? [] : ['number']);
        })));
    });

    test('copy lifetime paths normalize equivalent keys and keep distinct fields separate', () => {
        const keys = ['0', '0n', '-0n', '"0"'];

        keys.forEach(from => keys.forEach(to => [false, true].forEach((child) => {
            const source = 'const run=()=>{const box=[{name:42,child:{name:42}}];'
                + `const copy={...box[${from}]};touch(copy.child);return box[${to}]${child ? '.child' : ''}.name.trim();};`;
            const prefix = 'const touch=value=>{value.name="ok";};';

            strictEqual(runInNewContext(prefix + source + '(()=>{try{return run();}catch(error){return error.name;}})();'), child ? 'ok' : 'TypeError', source);
            check(source, child ? [] : ['number']);
        })));
        keys.forEach((from) => {
            const source = 'const run=()=>{const box=[{child:{name:42}},{child:{name:42}}];'
                + `const copy={...box[${from}]};touch(copy.child);return box[1].child.name.trim();};`;
            const prefix = 'const touch=value=>{value.name="ok";};';

            strictEqual(runInNewContext(prefix + source + '(()=>{try{return run();}catch(error){return error.name;}})();'), 'TypeError', source);
            check(source, ['number']);
        });
    });

    test('copied ancestors retire earlier descendant aliases without changing acquired primitives', () => {
        paths.forEach((path) => {
            const key = path === 'box.item' ? 'item' : '0';
            const origin = `const box={${key}:{child:{name:42}}};`;
            const aliases = [`const alias=${path}.child;`, `const {child:alias}=${path};`,
                path === 'box.item' ? 'const {item:{child:alias}}=box;' : 'const {0:{child:alias}}=box;'];

            aliases.forEach(binding => [false, true].forEach((primitive) => {
                const source = 'const run=()=>{' + origin + binding
                    + (primitive ? 'const value=alias.name;' : '') + `const copy={...${path}};touch(copy.child);return ${primitive ? 'value' : 'alias.name'}.trim();};`;
                const prefix = 'const touch=value=>{value.name="ok";};';

                strictEqual(runInNewContext(prefix + source + '(()=>{try{return run();}catch(error){return error.name;}})();'), primitive ? 'TypeError' : 'ok', source);
                check(source, primitive ? ['number'] : []);
            }));
            const conditional = 'const run=(flag)=>{' + origin + `const {child:alias}=${path};`
                + `if(flag){const copy={...${path}};touch(copy.child);}return alias.name.trim();};`;
            const prefix = 'const touch=value=>{value.name="ok";};';

            [false, true].forEach(flag => strictEqual(runInNewContext(prefix + conditional
                + `(()=>{try{return run(${flag});}catch(error){return error.name;}})();`), flag ? 'ok' : 'TypeError', conditional));
            check(conditional, ['number']);
        });
    });

    test('copied descendant aliases retire native protocols before later adoption', async () => {
        await Promise.all(paths.flatMap(path => [false, true].map(async (primitive) => {
            const shape = primitive ? '{child:{name:42}}' : '{child:Promise.resolve(42)}';
            const binding = primitive ? `const {child:{name:alias}}=${path};` : `const {child:alias}=${path};`;
            const source = 'const run=async()=>{' + initializer(path, shape) + binding + `const copy={...${path}};touch(copy.child);`
                + 'const value=await alias;return value.trim();};';
            const prefix = primitive ? 'const touch=value=>{value.name="ok";};'
                : 'const touch=value=>{value.constructor=Object;value.then=resolve=>resolve("ok");};';
            const result = await runInNewContext(prefix + source + 'run().then(value=>value,error=>error.name);');

            strictEqual(result, primitive ? 'TypeError' : 'ok', source);
            check(source, primitive ? ['number'] : []);
        })));
    });

    test('copy publication preserves member diagnostics at the original lookup', () => {
        const source = 'const run=()=>{const box={};const copy={...box.missing};return box.missing;};';
        const analysis = createAnalysis({ source });
        const missing = analysis.memberAccesses.filter(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }).missing);

        strictEqual(runInNewContext(source + 'typeof run();'), 'undefined');
        strictEqual(missing.length, 2);
    });

    test('selected copy acquisition leaves whole array transfer ownership with its existing owner', () => {
        [false, true].forEach((changed) => {
            const source = 'const source=[{name:42}];const copied=[...source];'
                + (changed ? 'source[0].name="ok";' : '') + 'copied.map(({name=""}={})=>name.trim());';
            const native = runInNewContext('(()=>{try{' + source + 'return "ok";}catch(error){return error.name;}})();');

            strictEqual(native, changed ? 'ok' : 'TypeError');
            check(source, changed ? [] : ['number']);
        });
    });

    test('successive selected copies retain bounded storage across carrier width and field depth', () => {
        [[8, 8], [8, 32], [32, 8], [32, 32]].forEach(([width = 0, depth = 0] = []) => {
            const object = Array.from({ length: depth }).reduce(value => `{item:${value}}`, '{name:42,child:{name:42}}');
            const path = `box${'.item'.repeat(depth)}`;
            const source = `const run=()=>{const box=${object};`
                + Array.from({ length: width }, (unused, index) => `const copy${index}={...${path}};`).join('')
                + `touch(copy${width - 1}.child);return ${path}.name.trim();};`;
            const analysis = createAnalysis({ source });
            const work = counter();
            const query = () => analysis.memberAccesses.filter(({ name = '' } = {}) => name === 'trim').flatMap(({ index = -1 } = {}) => (
                analysis.checkMemberAccess({ index, onWork: event => work.onWork(event) }).conflicts
            ));
            const size = (width + 2) * (depth + 8);

            deepStrictEqual(query(), ['number']);
            const before = work.read();
            const { counts: { expressions = 0, values = 0, contexts = 0 } = {} } = analysis;

            ok(expressions <= 2 * size + 64);
            ok(values <= 4 * size + 128);
            ok(contexts <= 3);
            ok(work.get('value-demand') <= 6 * size + 64);
            deepStrictEqual(query(), ['number']);
            ['value-demand', 'value-selection', 'flow-contribution'].forEach(kind => strictEqual(work.get(kind), Reflect.get(before, kind)));
        });
    });

    test('selected member lifetime storage stays bounded across carrier width and field depth', () => {
        [[8, 8], [8, 32], [32, 8], [32, 32]].forEach(([width = 0, depth = 0] = []) => {
            const object = Array.from({ length: depth }).reduce(value => `{item:${value}}`, '{name:42}');
            const path = `box${'.item'.repeat(depth)}.name`;
            const source = `const run=()=>{const box=${object};`
                + Array.from({ length: width }, (unused, index) => `const copy${index}={item:${path}};`).join('') + `return ${path}.trim();};`;
            const analysis = createAnalysis({ source });
            const work = counter();
            const query = () => analysis.memberAccesses.filter(({ name = '' } = {}) => name === 'trim').flatMap(({ index = -1 } = {}) => (
                analysis.checkMemberAccess({ index, onWork: event => work.onWork(event) }).conflicts
            ));

            deepStrictEqual(query(), ['number']);
            const before = work.read();
            const { counts: { expressions = 0, values = 0, contexts = 0 } = {} } = analysis;
            // Each field path occurs in the copies, initializer and final read.
            const size = (width + 2) * (depth + 6);

            ok(expressions <= size + 32);
            ok(values <= size + 2 * width + 32);
            ok(contexts <= 3);
            ok(work.get('value-demand') <= 2 * size + 32);
            ok(work.get('value-selection') <= depth + 12);
            deepStrictEqual(query(), ['number']);
            ['value-demand', 'value-selection', 'flow-contribution'].forEach(kind => strictEqual(work.get(kind), Reflect.get(before, kind)));
        });
    });
}
