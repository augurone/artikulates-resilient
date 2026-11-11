import { deepStrictEqual, strictEqual, ok, throws } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { ESLint } from 'eslint';
import { parse } from 'espree';

import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { append } from './support/collections.js';

const lint = new ESLint({ overrideConfigFile: true, allowInlineConfig: false, overrideConfig: [{
    languageOptions: { sourceType: 'script' }, plugins: { resilient: plugin },
    rules: { 'resilient/signature-contract-return-consistency': 'error', 'resilient/prefer-safe-destructuring-defaults': 'error' },
    settings: { resilient: { resolver: () => false } }
}] });
const dynamicInitializers = [
    { name: 'enclosing body', source: 'const outer=()=>{eval("var undefined=[]");return flag=>flag?undefined:[];};' },
    { name: 'parameter default', source: 'const outer=(value=eval("var undefined=[]"))=>flag=>flag?undefined:[];' },
    { name: 'nested default expression', source: 'const outer=(value=(true?eval("var undefined=[]"):0))=>flag=>flag?undefined:[];' },
    { name: 'void default operand', source: 'const outer=(value=void eval("var undefined=[]"))=>flag=>flag?undefined:[];' },
    { name: 'computed parameter key', source: 'const outer=({[eval("var undefined=[]")]:value=0}={})=>flag=>flag?undefined:[];' },
    { name: 'catch default', source: 'const outer=()=>{try{throw {}}catch({value=eval("var undefined=[]")}){return flag=>flag?undefined:[];}};' },
    { name: 'computed catch key', source: 'const outer=()=>{try{throw {}}catch({[eval("var undefined=[]")]:value=0}){return flag=>flag?undefined:[];}};' }
];

dynamicInitializers.forEach(({ name = '', source = '' } = {}) => {
    test(`dynamic binding acquisition: ${name}`, async () => {
        strictEqual(runInNewContext(`${source} [false,true].every(flag=>Array.isArray(outer()(flag)));`), true);
        const analysis = createAnalysis({ source, sourceType: 'script' });
        const { index = -1 } = analysis.functions.at(-1);
        const { status = '', fact: { families = [], incomplete = false } = {} } = analysis.checkFunction({ index });

        strictEqual(status, 'unknown');
        deepStrictEqual(families, []);
        strictEqual(incomplete, true);
        const [{ messages = [] } = {}] = await lint.lintText(source);

        deepStrictEqual(messages, [], 'Dynamic lookup cannot manufacture a nullish/array contradiction');
    });
});

test('inherited dynamic lookup blocks tuple and callable proofs at every lexical depth', async () => {
    const source = `function outer() {
        eval('var undefined=[]');
        return () => {
            const fold=(state,tuple)=>{if(!isArray(tuple)||tuple.length<2)return state;const [a,b]=tuple;return state;};
            return ({done})=>{if(typeof done==='function')done();};
        };
    }`;
    const analysis = createAnalysis({ source, sourceType: 'script' });
    const bindings = analysis.declarations.filter(({ kind = '' } = {}) => kind === 'Identifier');

    strictEqual(bindings.length, 3);
    ok(bindings.every(({ index = -1 } = {}) => analysis.checkDeclaration({ index }).required));
    const [{ messages = [] } = {}] = await lint.lintText(source);

    deepStrictEqual(messages.map(({ ruleId = '', line = 0, column = 0 } = {}) => ({ ruleId, line, column })), bindings.map(({ location: { line = 0, column = 0 } = {} } = {}) => ({
        ruleId: 'resilient/prefer-safe-destructuring-defaults', line, column
    })));
});

test('dynamic acquisition does not spread through siblings or unexecuted initializer functions', () => {
    const sources = [
        'const outer=()=>{eval("var undefined=[]");return ()=>undefined;};const outside=()=>undefined;',
        'const outer=(value=()=>eval("var undefined=[]"))=>()=>undefined;',
        'const outer=(value=external())=>()=>undefined;',
        'const outer=(value="eval(whatever)")=>()=>undefined;'
    ];

    sources.forEach((source) => {
        const analysis = createAnalysis({ source, sourceType: 'script' });
        const { index = -1 } = analysis.functions.at(-1);
        const { status = '', fact: { families = [], incomplete = true } = {} } = analysis.checkFunction({ index });

        strictEqual(status, 'agreement', source);
        deepStrictEqual(families, ['nullish']);
        strictEqual(incomplete, false);
    });
});

test('dynamic source revisions do not change retained lexical evidence', () => {
    const source = 'const outer=()=>{const fold=(state,tuple)=>{if(!isArray(tuple)||tuple.length<2)return state;const [a,b]=tuple;return state;};return fold;};';
    const revised = source.replace('const outer=()=>{', 'const outer=()=>{eval("var undefined=[]");');
    const first = createAnalysis({ source, sourceType: 'script' });
    const second = createAnalysis({ source: revised, sourceType: 'script' });
    const query = analysis => analysis.declarations.filter(({ kind = '' } = {}) => kind === 'Identifier').map(({ index = -1 } = {}) => analysis.checkDeclaration({ index }).required);

    deepStrictEqual(query(first), [false, false]);
    deepStrictEqual(query(second), [true, true]);
    deepStrictEqual(query(first), [false, false]);
    deepStrictEqual(query(createAnalysis({ source, sourceType: 'script' })), [false, false]);
});

test('callable acquires default function syntax without executing its parameter effects', () => {
    const source = 'const outer=({[(value=eval("var undefined=[]"))=>0]:item=0}={})=>()=>undefined;';

    strictEqual(runInNewContext(`${source} outer()()===void 0;`), true);
    const program = parse(source, { ecmaVersion: 'latest', sourceType: 'script', loc: true, range: true });
    const { body: [{ declarations: [{ init: { params: [{ left: { properties: [{ key = {} } = {}] = [] } = {} } = {}] = [] } = {} } = {}] = [] } = {}] = [] } = program;

    Object.defineProperty(key, 'hostMetadata', { enumerable: true, get() { throw new Error('Host metadata is not evidence'); } });
    const analysis = createProgramAnalysis({ program });
    const { index = -1 } = analysis.functions.at(-1);
    const { status = '', fact: { families = [] } = {} } = analysis.checkFunction({ index });

    strictEqual(status, 'agreement');
    deepStrictEqual(families, ['nullish']);
    strictEqual(analysis.functions.length, 3);
    const failure = new Error('Acquired parameter syntax is unavailable');

    Object.defineProperty(key, 'params', { get() { throw failure; } });
    throws(() => createProgramAnalysis({ program }), error => error === failure);
});

test('initializer acquisition failures remain operational failures', () => {
    const program = parse('const outer=(value=flag?first:second)=>()=>undefined;', { ecmaVersion: 'latest', sourceType: 'script', loc: true, range: true });
    const { body: [{ declarations: [{ init: { params: [{ right = {} } = {}] = [] } = {} } = {}] = [] } = {}] = [] } = program;
    const failure = new Error('Required initializer source read failed');

    Object.defineProperty(right, 'consequent', { get() { throw failure; } });
    throws(() => createProgramAnalysis({ program }), error => error === failure);
});

test('288 return compositions preserve identity and family claims across 5778 normal runtime samples', () => {
    const bodies = ['return state;', 'return other;', 'return [];', 'return flag ? state : other;', 'return flag ? other : state;',
        'return state || other;', 'return state && other;', 'return state ?? other;', 'if (flag) throw 1; return state;',
        'if (flag) throw 1; return other;', 'throw 1;', 'if (flag) return state; return pass(other);'];
    const finalizers = ['', 'if (flag) return state;', 'if (flag) return other;', 'if (flag) throw 1;',
        'if (second) return state;', 'if (second) return other;', 'if (second) throw 1;', 'return flag ? state : other;'];
    const catches = ['', 'catch { return state; }', 'catch { if(second) return other; throw 1; }'];

    bodies.forEach(initial => finalizers.forEach(finalizer => catches.forEach((handler) => {
        const source = `const pass=value=>value; const run=(state,other,flag,second)=>{ try { ${initial} } ${handler} finally { ${finalizer} } };`;
        const analysis = createAnalysis({ source });
        const proof = analysis.checkFunction({ index: 1 });
        const observed = runInNewContext(`${source}
            const inputs=[[{},{}],[false,{}],[{},false],[0,1],[null,{}],[void 0,{}]];
            inputs.flatMap(([state,other])=>[false,true].flatMap(flag=>[false,true].map(second=>{
                try { const result=run(state,other,flag,second); return { identity:result===state?0:result===other?1:-1,
                    family:Array.isArray(result)?'array':result===null||result===void 0?'nullish':typeof result }; }
                catch { return false; }
            }))).filter(Boolean);`);
        const { returnedParameter = false, fact: { families = [], incomplete = true } = {} } = proof;
        const { index = -1 } = returnedParameter;

        if (returnedParameter) ok(observed.every(({ identity = -1 } = {}) => identity === index), source);

        if (!incomplete) ok(observed.every(({ family = '' } = {}) => families.includes(family)), source);

        analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCallResult({ index, required: 'array' }));
        deepStrictEqual(analysis.checkFunction({ index: 1 }), proof);
    })));
});

test('every interrupted tuple proof retries without publishing partial evidence', () => {
    const source = `const choose=(state,other,flag)=>{try{return flag?other:state;}finally{if(flag)throw 1;}};
        const fold=(state,tuple,other,flag)=>{if(!isArray(tuple)||tuple.length<2)return choose(state,other,flag);const [a,b]=tuple;return state;};
        fold([],[],{},false); fold({},[],[],true);`;
    const query = (analysis, observation = {}) => {
        const { index = -1 } = analysis.declarations.find(({ name = '' } = {}) => name === 'a') ?? {};

        return analysis.checkDeclaration({ index, ...observation });
    };
    const steps = [];
    const original = createAnalysis({ source });
    const expected = query(original, { onWork: entry => append(steps, entry) });
    const completed = original.functions.map(({ index = -1 } = {}) => original.checkFunction({ index }));

    ok(steps.length);
    steps.forEach((entry, failAt) => {
        const analysis = createAnalysis({ source });
        const failure = new Error('observer failed');
        const visited = [];

        throws(() => query(analysis, { onWork: (work) => {
            append(visited, work);

            if (visited.length !== failAt + 1) return;

            deepStrictEqual(work, entry);
            throw failure;
        } }), error => error === failure);
        analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCallResult({ index, required: 'array' }));
        deepStrictEqual(query(analysis), expected);
        deepStrictEqual(analysis.functions.map(({ index = -1 } = {}) => analysis.checkFunction({ index })), completed);
    });
});
