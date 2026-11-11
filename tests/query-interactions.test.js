import { deepStrictEqual, strictEqual, throws, ok } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ESLint } from 'eslint';
import { parse } from 'espree';

import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/export-ownership.json', import.meta.url), 'utf8'));
const findings = (analysis) => {
    const { promiseUses = [] } = analysis;

    return promiseUses.filter(({ index = -1 } = {}) => {
        const { unhandled = false } = analysis.checkPromiseUse({ index });

        return unhandled;
    }).length;
};
const queryGroups = [
    ['receivers', 'check'], ['destructurings', 'checkDestructuring'], ['destructuringFields', 'checkDestructuringField'],
    ['calls', 'checkCall'], ['calls', 'checkCallResult'], ['functions', 'checkFunction'], ['invocations', 'checkInvocation'],
    ['declarations', 'checkDeclaration'], ['signatureExtractions', 'checkSignatureExtraction'], ['memberAccesses', 'checkMemberAccess'], ['promiseUses', 'checkPromiseUse']
];
const query = (analysis, [collection = '', method = ''] = [], observation = {}) => {
    const entries = Reflect.get(analysis, collection);
    const check = Reflect.get(analysis, method);

    if (!Array.isArray(entries) || typeof check !== 'function') throw new TypeError('Expected public analysis query group');

    return entries.map(({ index = -1 } = {}) => check({ index, required: 'string', ...observation }));
};
const source = 'import {dispatch as launch} from "barrel";launch();';
const acquire = dependency => createAnalysis({ source, filename: 'main', resolveModule: ({ source: name = '' } = {}) => ({
    filename: name, source: name === 'barrel' ? 'export {default as dispatch} from "worker";' : dependency
}) });

cases.forEach(({ name = '', dependency = '', findings: expected = 0 } = {}) => {
    test(`export review evidence: ${name}`, () => strictEqual(findings(acquire(dependency)), expected));
    test(`export review product: ${name}`, async (context) => {
        const directory = mkdtempSync(join(tmpdir(), 'resilient-export-review-'));

        context.after(() => rmSync(directory, { recursive: true, force: true }));
        writeFileSync(join(directory, 'worker.js'), dependency);
        writeFileSync(join(directory, 'barrel.js'), 'export {default as dispatch} from "./worker.js";');
        const engine = new ESLint({ cwd: directory, overrideConfigFile: true, overrideConfig: {
            plugins: { resilient: plugin }, rules: { 'resilient/no-unhandled-promise-chain': 'error' }
        } });
        const [{ messages = [] } = {}] = await engine.lintText('import {dispatch as launch} from "./barrel.js";launch();', { filePath: join(directory, 'main.js') });

        strictEqual(messages.length, expected);
        messages.forEach(({ ruleId = '' } = {}) => strictEqual(ruleId, 'resilient/no-unhandled-promise-chain'));
    });
});

test('public result queries cannot change guarded declaration evidence or product findings', async () => {
    const source = 'const load=async()=>1;const use=({action}={})=>{if(typeof action!=="function")return;action(load());};';
    const analysis = createAnalysis({ source });
    queryGroups.toReversed().forEach(group => query(analysis, group));
    const { declarations = [] } = analysis;
    const { index = -1 } = declarations.find(({ name = '' } = {}) => name === 'action') ?? {};

    strictEqual(analysis.checkDeclaration({ index }).required, false);
    const engine = new ESLint({ overrideConfigFile: true, overrideConfig: {
        plugins: { resilient: plugin }, rules: { 'resilient/no-unguarded-callback-invocation': 'error' }
    } });
    const [{ messages = [] } = {}] = await engine.lintText(source);

    deepStrictEqual(messages, []);
});

test('standalone results preserve guarded absence and do not invent a guard for unknown alternatives', () => {
    [false, true].forEach((guarded) => {
        const source = `const use=({action}={})=>{${guarded ? 'if(typeof action!=="function")return;' : ''}action();};`;
        const analysis = createAnalysis({ source });

        query(analysis, ['calls', 'checkCallResult']);
        const { declarations = [] } = analysis;
        const { index = -1 } = declarations.find(({ name = '' } = {}) => name === 'action') ?? {};
        const { required = false } = analysis.checkDeclaration({ index });

        strictEqual(required, !guarded);
    });
});

test('anonymous export revisions and required syntax reads preserve snapshot and failure boundaries', () => {
    const program = parse('export default async function(){}', { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
    const first = acquire('export default async function(){}');
    const second = acquire('export default function(){}');

    strictEqual(findings(first), 1);
    strictEqual(findings(second), 0);
    strictEqual(findings(first), 1);
    const { body: [{ declaration = {} } = {}] = [] } = program;
    const failure = new Error('required export header failed');

    Object.defineProperty(declaration, 'id', { get() { throw failure; } });
    throws(() => createProgramAnalysis({ program }), error => error === failure);
});

test('interrupted standalone result work retries without affecting an enclosing guard proof', () => {
    const source = 'const use=({action}={})=>{if(typeof action!=="function")return;action();};';
    const expected = query(createAnalysis({ source }), ['declarations', 'checkDeclaration']);
    const work = counter();

    query(createAnalysis({ source }), ['calls', 'checkCallResult'], { onWork: event => work.onWork(event) });
    Object.keys(work.read()).forEach((interrupted) => {
        const analysis = createAnalysis({ source });

        throws(() => query(analysis, ['calls', 'checkCallResult'], { onWork: ({ kind = '' } = {}) => {
            if (kind === interrupted) throw new Error(`interrupted ${kind}`);
        } }), /interrupted/);
        query(analysis, ['calls', 'checkCallResult']);
        deepStrictEqual(query(analysis, ['declarations', 'checkDeclaration']), expected);
    });
    ok(Object.keys(work.read()).length);
});

test('every standalone proof interruption preserves retries and generic evidence', () => {
    const source = 'const isCallable=value=>typeof value==="function";const use=({action}={})=>{if(!isCallable(action))return;return action();};';
    const expected = queryGroups.map(group => query(createAnalysis({ source }), group));
    const work = counter();

    query(createAnalysis({ source }), ['calls', 'checkCallResult'], { onWork: event => work.onWork(event) });
    const steps = Object.values(work.read()).reduce((total, value) => total + value, 0);

    Array.from({ length: steps }, (unused, position) => position + 1).forEach((stop) => {
        const analysis = createAnalysis({ source });
        const visits = counter();
        const failure = new Error(`interrupted proof step ${stop}`);

        throws(() => query(analysis, ['calls', 'checkCallResult'], { onWork: () => {
            visits.increment('steps');
            const { steps = 0 } = visits.read();

            if (steps === stop) throw failure;
        } }), error => error === failure);
        deepStrictEqual(queryGroups.map(group => query(analysis, group)), expected);
    });
    ok(steps > 0);
});

test('live standalone and flow queries release all host syntax before and after interleaved demand', () => {
    const { execPath = '' } = process;
    const source = `
        import {parse,VisitorKeys} from 'espree';
        import {setImmediate} from 'node:timers/promises';
        import {createProgramAnalysis} from 'eslint-plugin-resilient/analyzer';
        const acquire=()=>{
            const program=parse('export default async function(){};'+
                'const use=({action}={})=>{if(typeof action!=="function")return;const result=action();return result;};'+
                'const load=async()=>1;load();'+
                'const settle=async()=>{const {data:{items=[]}={}}=await Promise.resolve({data:{}});'+
                'let value="";try{return items;}finally{value=1;}};'+
                'const check=Array.isArray;const guarded=({value}={})=>{if(check(value))return value.trim();return "";};'+
                'const unbound=[].map;unbound(x=>x);'+
                'const same=value=>value;const repeat=value=>{same(value);return same(value);};'+
                'const supplied=external?{}:[];repeat(supplied);repeat(supplied);'+
                '[1].map(item=>item.trim());[1,2].reduce((sum,item)=>item,0);'+
                'const checks={present:value=>!!value};const inspect=(value={})=>checks.present(value)?value.map(Boolean):[];'+
                'const write=({data={}}={})=>{data.field=1;return data.field.trim();};', {ecmaVersion:'latest',sourceType:'module',range:true,loc:true});
            const pending=[program],references=[];
            while(pending.length){const node=pending.pop();references.push(new WeakRef(node));
                node.host={program};references.push(new WeakRef(node.host));
                for(const key of VisitorKeys[node.type]||[]){const value=node[key];
                    if(Array.isArray(value))pending.push(...value.filter(Boolean));else if(value)pending.push(value);}}
            return {analysis:createProgramAnalysis({program}),references};
        };
        const {analysis,references}=acquire();
        const collect=async()=>{for(let turn=0;turn<5;turn++){await setImmediate();globalThis.gc();}};
        await collect();const before=references.filter(ref=>ref.deref()).length;
        analysis.calls.forEach(({index})=>analysis.checkCallResult({index,required:'string'}));
        const {index}=analysis.declarations.find(({name})=>name==='action');
        const result=analysis.checkDeclaration({index});
        analysis.functions.forEach(({index})=>analysis.checkFunction({index}));
        analysis.memberAccesses.forEach(({index})=>analysis.checkMemberAccess({index}));
        const promises=analysis.promiseUses.map(({index})=>analysis.checkPromiseUse({index}));
        await collect();console.log(JSON.stringify({before,after:references.filter(ref=>ref.deref()).length,
            sampled:references.length,required:result.required,unhandled:promises.filter(x=>x.unhandled).length}));
    `;
    const { before = -1, after = -1, sampled = 0, required = true, unhandled = 0 } = JSON.parse(
        execFileSync(execPath, ['--expose-gc', '--input-type=module', '-e', source], { encoding: 'utf8' })
    );

    strictEqual(before, 0);
    strictEqual(after, 0);
    ok(sampled > 50);
    strictEqual(required, false);
    strictEqual(unhandled, 1);
});
