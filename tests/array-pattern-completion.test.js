import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';
import { parse } from 'espree';

import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

const resultFor = ({ calls = [], checkCallResult } = {}, options = {}) => {
    if (typeof checkCallResult !== 'function') throw new TypeError('Expected an analysis result query');

    const { index = -1 } = calls.find(({ callee = '' } = {}) => callee === 'read') ?? {};

    return checkCallResult({ index, required: 'array', ...options });
};
const lint = source => new Linter().verify(source, { plugins: { resilient: plugin }, rules: {
    'resilient/signature-contract-call-site': 'error', 'resilient/signature-contract-operation': 'error', 'resilient/signature-contract-property': 'error',
    'resilient/signature-contract-return-consistency': 'error'
} });

[
    ['selected string', 'const [items]=[""];', 'items', 'string'],
    ['unused binding', 'const [unused]=[0];', '""', 'string'],
    ['empty pattern', 'const []=[];', '""', 'string'],
    ['elisions', 'const [,,]=[,];', '""', 'string'],
    ['absent default', 'const [items=[]]=[];', 'items', 'array'],
    ['hole default', 'const [items=[]]=[,];', 'items', 'array'],
    ['explicit undefined default', 'const [items=[]]=[undefined];', 'items', 'array'],
    ['null does not default', 'const [items=[]]=[null];', 'items', 'nullish'],
    ['false does not default', 'const [items=[]]=[false];', 'items', 'boolean'],
    ['zero does not default', 'const [items=[]]=[0];', 'items', 'number'],
    ['declarator sequence', 'const [first]=[0],[items]=[""];', 'items', 'string'],
    ['returned array', 'const make=()=>[""];const [items]=make();', 'items', 'string'],
    ['local forwarding', 'const echo=value=>value;const [items]=echo([""]);', 'items', 'string']
].forEach(([name = '', body = '', returned = '', family = ''] = []) => test(`flat pattern completion: ${name}`, () => {
    const source = `const read=()=>{try{${body}return ${returned};}catch{return {};}};read();`;
    const { fact: { families = [], incomplete = false } = {}, normal = false, thrown = true } = resultFor(createAnalysis({ source }));
    const runtime = runInNewContext(source);
    const present = Array.isArray(runtime) ? 'array' : typeof runtime;
    const actual = runtime === null ? 'nullish' : present;

    strictEqual(actual, family);
    deepStrictEqual(families, [family]);
    strictEqual(incomplete, false);
    strictEqual(normal, true);
    strictEqual(thrown, false);
}));

[
    ['nested object', 'const [{x},items]=[{x:0},""];'],
    ['nested empty object', 'const [{},items]=[null,""];'],
    ['nested array', 'const [[x],items]=[[0],""];'],
    ['rest', 'const [items,...rest]=[""];'],
    ['unused effectful default', 'const [unused=external()]=[];const items="";'],
    ['supplied effectful default', 'const [items=external()]=[""];'],
    ['unknown iterator', 'const [items]=external;'],
    ['null iterator', 'const [items]=null;'],
    ['string iterator', 'const [items]="x";'],
    ['spread array', 'const [items]=[...external];'],
    ['named carrier lifetime', 'const tuple=[""];const [items]=tuple;'],
    ['mutated iterator', 'const tuple=[""];tuple[Symbol.iterator]=custom;const [items]=tuple;'],
    ['mutated prototype', 'Array.prototype[Symbol.iterator]=custom;const [items]=[""];'],
    ['prototype slot getter', 'Object.defineProperty(Object.prototype,"0",{get:()=>[]});const [items]=[,];'],
    ['captured carrier', 'const make=()=>{const tuple=[""];return ()=>tuple;};const [items]=make()();']
].forEach(([name = '', body = ''] = []) => test(`unproved pattern completion stays unknown: ${name}`, () => {
    const source = `const read=()=>{try{${body}return "";}catch{return [];}};read();`;

    strictEqual(resultFor(createAnalysis({ source })).status, 'unknown');
}));

test('known guarded completion survives an unknown iterator alternative', () => {
    const source = 'const read=(flag,input)=>{try{const [items]=flag?[""]:input;return items;}catch{return [];}};read(external,external);';
    const { status = '', fact: { families = [], incomplete = false } = {} } = resultFor(createAnalysis({ source }));

    strictEqual(status, 'contradiction');
    deepStrictEqual(families, ['string']);
    strictEqual(incomplete, true);
});

test('distinct native arrays share completion without requiring identical slots', () => {
    const source = 'const read=(flag=false)=>{try{const [items]=flag?[""]:[[]];return items;}catch{return {};}};read(true);';
    const analysis = createAnalysis({ source });
    const { fact: { families = [] } = {}, thrown = true } = resultFor(analysis);

    deepStrictEqual(families, ['string']);
    strictEqual(thrown, false);
    const { fact: { families: generic = [] } = {} } = analysis.checkFunction({ index: 0 });

    deepStrictEqual(generic.toSorted(), ['array', 'string']);
});

test('a selected unknown value still has known iteration completion', () => {
    const source = 'const read=input=>{try{const [items]=[input];return items?[]:"";}catch{return {};}};read(false);';

    deepStrictEqual(resultFor(createAnalysis({ source })).fact.families, ['string']);
});

test('initializer failure reaches catch and preserves prior call obligations', () => {
    const source = 'const need=(items=[])=>items;const fail=()=>{need("");throw 0;};const read=()=>{try{const [items]=fail();return "";}catch{return [];}};read();';
    const analysis = createAnalysis({ source });

    strictEqual(resultFor(analysis).status, 'agreement');
    const { index = -1 } = analysis.calls.find(({ callee = '' } = {}) => callee === 'read') ?? {};
    const { obligations = [] } = analysis.checkCall({ index });

    ok(obligations.some(({ status = '' } = {}) => status === 'contradiction'));
});

test('initializer uncertainty is not erased by the resulting native array', () => {
    const source = 'const read=()=>{try{const [items]=[external()];return "";}catch{return [];}};read();';

    strictEqual(resultFor(createAnalysis({ source })).status, 'unknown');
});

test('finalizers replace completion but retain reached obligations', () => {
    const source = 'const need=(items=[])=>items;const read=()=>{try{const [items]=[""];need(items);return items;}finally{return [];}};read();';
    const analysis = createAnalysis({ source });

    strictEqual(resultFor(analysis).status, 'agreement');
    strictEqual(lint(source).filter(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-call-site').length, 1);
});

[
    ['call', 'const need=(items=[])=>items;need(read());', 'signature-contract-call-site', 'items'],
    ['operation', 'read().map(value=>value);', 'signature-contract-operation', 'items'],
    ['property', 'read().missing;', 'signature-contract-property', '{}']
].forEach(([name = '', consumer = '', rule = '', returned = ''] = []) => test(`pattern completion reaches product ${name} consumer`, () => {
    const source = `const read=()=>{try{const [items]=[""];return ${returned};}catch{return [];}};${consumer}`;

    deepStrictEqual(lint(source).map(({ ruleId = '' } = {}) => ruleId), [`resilient/${rule}`]);
}));

test('a native callback retains a completed pattern return', () => {
    const source = 'const need=(items=[])=>items;[0].forEach(()=>{const read=()=>{try{const [items]=[""];return items;}catch{return [];}};need(read());});';

    deepStrictEqual(lint(source).map(({ ruleId = '' } = {}) => ruleId), ['resilient/signature-contract-call-site']);
});

test('pattern completion preserves query order, warm reuse and interrupted retry', () => {
    const source = 'const read=(flag,input)=>{try{const [items]=flag?[""]:input;return items;}catch{return [];}};read(true,[]);';
    const analysis = createAnalysis({ source });
    const work = counter();
    const expected = resultFor(analysis, { onWork: event => work.onWork(event) });

    Object.keys(work.read()).forEach((stage) => {
        const interrupted = createAnalysis({ source });

        throws(() => resultFor(interrupted, { onWork: ({ kind = '' } = {}) => {
            if (kind === stage) throw new Error(`interrupt ${stage}`);
        } }), new RegExp(`interrupt ${stage}`, 'u'));
        deepStrictEqual(resultFor(interrupted), expected);
    });
    const reordered = createAnalysis({ source });

    reordered.functions.toReversed().forEach(({ index = -1 } = {}) => reordered.checkFunction({ index }));
    reordered.calls.toReversed().forEach(({ index = -1 } = {}) => reordered.checkCall({ index }));
    deepStrictEqual(resultFor(reordered), expected);
    const { counts = {} } = analysis;
    const cold = work.read();

    deepStrictEqual(resultFor(analysis, { onWork: event => work.onWork(event) }), expected);
    const { counts: repeated = {} } = analysis;

    deepStrictEqual(repeated, counts);
    strictEqual(work.get('value-selection'), Reflect.get(cold, 'value-selection'));
});

test('retained pattern completion survives an independent source revision', () => {
    const program = parse('const read=()=>{try{const [items]=[""];return items;}catch{return [];}};read();',
        { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
    const original = createProgramAnalysis({ program });
    const expected = resultFor(original);
    const { body: [{ declarations: [{ init: { body: { body: [statement = {}] = [] } = {} } = {} } = {}] = [] } = {}] = [] } = program;
    const { block: { body: [{ declarations: [{ init: { elements: [slot = {}] = [] } = {} } = {}] = [] } = {}] = [] } = {} } = statement;

    Object.defineProperty(slot, 'value', { value: 42 });
    const revised = createProgramAnalysis({ program });

    deepStrictEqual(resultFor(revised).fact.families, ['number']);
    deepStrictEqual(resultFor(original), expected);
});

test('live completion sessions release pattern syntax before and after demand', () => {
    const { execPath = '' } = process;
    const source = `
        import {parse,VisitorKeys} from 'espree';
        import {setImmediate} from 'node:timers/promises';
        import {createProgramAnalysis} from 'eslint-plugin-resilient/analyzer';
        const acquire=()=>{
            const program=parse('const read=()=>{try{const [items]=[42];return items;}catch{return [];}};read();',
                {ecmaVersion:'latest',sourceType:'module',range:true,loc:true});
            const pending=[program],references=[];
            while(pending.length){const node=pending.pop();references.push(new WeakRef(node));node.host={program};references.push(new WeakRef(node.host));
                for(const key of VisitorKeys[node.type]||[]){const value=node[key];
                    if(Array.isArray(value))pending.push(...value.filter(Boolean));else if(value)pending.push(value);}}
            return {analysis:createProgramAnalysis({program}),references};
        };
        const {analysis,references}=acquire();
        const collect=async()=>{for(let turn=0;turn<5;turn++){await setImmediate();globalThis.gc();}};
        await collect();const before=references.filter(ref=>ref.deref()).length;
        const result=analysis.checkCallResult({index:0,required:'array'});
        await collect();console.log(JSON.stringify({before,after:references.filter(ref=>ref.deref()).length,status:result.status}));
    `;
    const result = JSON.parse(execFileSync(execPath, ['--expose-gc', '--input-type=module', '-e', source], { encoding: 'utf8', timeout: 30000 }));

    deepStrictEqual(result, { before: 0, after: 0, status: 'contradiction' });
});
