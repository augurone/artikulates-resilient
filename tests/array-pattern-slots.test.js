import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';
import { parse } from 'espree';

import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

const resultFor = ({ calls = [], checkCallResult } = {}, required = 'array', options = {}) => {
    if (typeof checkCallResult !== 'function') throw new TypeError('Expected an analysis result query');

    const { index = -1 } = calls.find(({ callee = '' } = {}) => callee === 'read') ?? {};

    return checkCallResult({ index, required, ...options });
};
const lint = source => new Linter().verify(source, {
    plugins: { resilient: plugin }, rules: {
        'resilient/signature-contract-call-site': 'error', 'resilient/signature-contract-operation': 'error', 'resilient/signature-contract-property': 'error'
    }
});

[
    ['first position', 'const [items]=[""];', 'items', 'contradiction'],
    ['second position', 'const [other,items]=[[],""];', 'items', 'contradiction'],
    ['elision preserves position', 'const [,items]=[[],""];', 'items', 'contradiction'],
    ['hole selects default', 'const [items=[]]=[,];', 'items', 'agreement'],
    ['exhaustion selects default', 'const [items=[]]=[];', 'items', 'agreement'],
    ['undefined selects default', 'const [items=[]]=[undefined];', 'items', 'agreement'],
    ['null is present', 'const [items=[]]=[null];', 'items', 'contradiction'],
    ['empty text is present', 'const [items=[]]=[""];', 'items', 'contradiction'],
    ['zero is present', 'const [items=[]]=[0];', 'items', 'contradiction'],
    ['false is present', 'const [items=[]]=[false];', 'items', 'contradiction'],
    ['supplied unknown is not defaulted', 'const [items=[]]=[external];', 'items', 'unknown'],
    ['unknown iterator is not defaulted', 'const [items=[]]=external;', 'items', 'unknown'],
    ['known alternatives', 'const [items]=flag?[[]]:[""];', 'items', 'contradiction'],
    ['unknown beside contradiction', 'const [items]=flag?[""]:external;', 'items', 'contradiction'],
    ['unknown slot beside contradiction', 'const [items]=[flag?external:""];', 'items', 'contradiction'],
    ['fresh selected record', 'const [item]=[{items:""}];', 'item.items', 'contradiction'],
    ['fresh selected array', 'const [items]=[[]];', 'items', 'agreement'],
    ['rest remains unsupported', 'const [items,...rest]=[""];', 'items', 'unknown'],
    ['nested object may fail first', 'const [{x},items]=[null,""];', 'items', 'unknown'],
    ['nested array may fail first', 'const [[x],items]=[null,""];', 'items', 'unknown'],
    ['array inside object remains unsupported', 'const {tuple:[items]}={tuple:[""]};', 'items', 'unknown'],
    ['effectful default remains unsupported', 'const [other=external(),items]=[,""];', 'items', 'unknown'],
    ['spread remains unsupported', 'const [items]=[...external];', 'items', 'unknown'],
    ['custom iterator remains unsupported', 'const tuple=[""];tuple[Symbol.iterator]=custom;const [items]=tuple;', 'items', 'unknown'],
    ['mutated carrier loses slots', 'const tuple=[""];tuple[0]=[];const [items]=tuple;', 'items', 'unknown'],
    ['carrier alias retains conservative lifetime', 'const tuple=[""];const [items]=tuple;', 'items', 'unknown'],
    ['shared selected record loses fields', 'const item={items:""};const [value]=[item];item.items=[];', 'value.items', 'unknown'],
    ['escaped selected record loses fields', 'const [item]=[{items:""}];external(item);', 'item.items', 'unknown'],
    ['mutable selected binding remains unknown', 'let [items]=[""];items=external;', 'items', 'unknown']
].forEach(([name = '', body = '', returned = '', expected = ''] = []) => test(`positional evidence: ${name}`, () => {
    const source = `const read=()=>{${body}return ${returned};};read();`;

    strictEqual(resultFor(createAnalysis({ source })).status, expected);
}));

[
    ['parameter', 'const read=([items=[]])=>items;read([""]);', 'contradiction'],
    ['root default', 'const read=([items=[]]=[])=>items;read();', 'agreement'],
    ['unknown parameter', 'const read=([items=[]])=>items;read(external);', 'unknown'],
    ['returned tuple', 'const make=()=>[""];const read=()=>{const [items]=make();return items;};read();', 'contradiction'],
    ['forwarded selection', 'const select=([items])=>items;const read=()=>select([""]);read();', 'contradiction'],
    ['guarded alternative', 'const read=flag=>{const [items]=flag?[""]:[[]];if(flag)return [];return items;};read(external);', 'agreement'],
    ['iterator replacement', 'Array.prototype[Symbol.iterator]=custom;const read=()=>{const [items]=[""];return items;};read();', 'unknown'],
    ['prototype slot getter', 'Object.defineProperty(Object.prototype,"0",{get:()=>[]});const read=()=>{const [items=[]]=[,];return items;};read();', 'unknown'],
    ['captured carrier', 'const tuple=[""];const read=()=>{const [items]=tuple;return items;};read();', 'unknown'],
    ['later argument effect', 'const read=([items],other)=>items;const tuple=[""];read(tuple,external(tuple));', 'unknown']
].forEach(([name = '', source = '', expected = ''] = []) => test(`positional composition: ${name}`, () => {
    strictEqual(resultFor(createAnalysis({ source })).status, expected);
}));

[
    ['call requirement', 'const need=(items=[])=>items;const [items]=[""];need(items);', 'signature-contract-call-site'],
    ['operation requirement', 'const [items]=[""];items.map(value=>value);', 'signature-contract-operation'],
    ['native callback', 'const need=(items=[])=>items;[[""]].forEach(([items])=>need(items));', 'signature-contract-call-site'],
    ['property requirement', 'const [item]=[{}];item.missing;', 'signature-contract-property'],
    ['authored absence', 'const read=([items=[]])=>items.trim();', 'signature-contract-operation']
].forEach(([name = '', source = '', rule = ''] = []) => test(`positional product consumer: ${name}`, () => {
    const findings = lint(source);

    deepStrictEqual(findings.map(({ ruleId = '' } = {}) => ruleId), [`resilient/${rule}`]);
}));

test('unknown alternatives retain both the known family and incompleteness', () => {
    const source = 'const read=()=>{const [items]=flag?[""]:external;return items;};read();';
    const { status = '', fact: { families = [], incomplete = false } = {} } = resultFor(createAnalysis({ source }));

    strictEqual(status, 'contradiction');
    deepStrictEqual(families, ['string']);
    strictEqual(incomplete, true);
});

test('an unresolved slot preserves both truth branches', () => {
    const source = 'const read=()=>{const [value]=external;return value?[]:{};};read();';
    const { status = '', fact: { families = [] } = {} } = resultFor(createAnalysis({ source }));

    strictEqual(status, 'contradiction');
    deepStrictEqual(families.toSorted(), ['array', 'object']);
});

test('an unresolved slot preserves a possible nullish fallback', () => {
    const source = 'const read=()=>{const [value]=external;return value??[];};read();';
    const { fact: { families = [], incomplete = false } = {} } = resultFor(createAnalysis({ source }));

    deepStrictEqual(families, ['array']);
    strictEqual(incomplete, true);
});

test('slot selection survives observer interruption, query reordering and warm reuse', () => {
    const source = 'const need=(items=[])=>items;const read=()=>{const [items]=flag?[""]:external;need(items);return items;};read();';
    const analysis = createAnalysis({ source });
    const work = counter();
    const expected = resultFor(analysis, 'array', { onWork: event => work.onWork(event) });

    Object.keys(work.read()).forEach((stage) => {
        const interrupted = createAnalysis({ source });

        throws(() => resultFor(interrupted, 'array', { onWork: ({ kind = '' } = {}) => {
            if (kind === stage) throw new Error(`interrupt ${stage}`);
        } }), new RegExp(`interrupt ${stage}`, 'u'));
        deepStrictEqual(resultFor(interrupted), expected);
    });
    const reordered = createAnalysis({ source });

    reordered.functions.toReversed().forEach(({ index = -1 } = {}) => reordered.checkFunction({ index }));
    reordered.calls.toReversed().forEach(({ index = -1 } = {}) => reordered.checkCall({ index }));
    deepStrictEqual(resultFor(reordered), expected);
    const { counts = {} } = analysis;
    const before = work.read();

    deepStrictEqual(resultFor(analysis, 'array', { onWork: event => work.onWork(event) }), expected);
    const { counts: repeated = {} } = analysis;

    deepStrictEqual(repeated, counts);
    strictEqual(work.get('value-selection'), Reflect.get(before, 'value-selection'));
});

test('retained sessions own slot evidence across host AST revisions', () => {
    const program = parse('const read=()=>{const [items]=[""];return items;};read();', { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
    const original = createProgramAnalysis({ program });
    const expected = resultFor(original);
    const { body: [{ declarations: [{ init: { body: { body: [{ declarations: [{ init: { elements: [slot = {}] = [] } = {} } = {}] = [] } = {}] = [] } = {} } = {} } = {}] = [] } = {}] = [] } = program;

    Object.defineProperty(slot, 'value', { value: 42 });
    const revised = createProgramAnalysis({ program });

    strictEqual(resultFor(revised, 'number').status, 'agreement');
    deepStrictEqual(resultFor(original), expected);
    deepStrictEqual(resultFor(original).fact.families, ['string']);
});

test('runtime counterexamples justify iterator and nested-pattern exclusions', () => {
    const custom = 'const tuple=[""];tuple[Symbol.iterator]=function*(){yield [];};const [items]=tuple;items;';
    const nested = 'const [{x},items]=[null,""];items;';
    const getter = 'const state={items:""};const [{x},items]=[{get x(){state.items=[];}},state];items.items;';

    ok(Array.isArray(runInNewContext(custom)));
    throws(() => runInNewContext(nested), { name: 'TypeError' });
    ok(Array.isArray(runInNewContext(getter)));
    deepStrictEqual(lint(`${custom}items.map(value=>value);`), []);
});

[128, 256].forEach(width => test(`pattern position acquisition is linear at width ${width}`, (context) => {
    const names = Array.from({ length: width }, (_, index) => `v${index}`).join(',');
    const program = parse(`const [${names}]=[];`, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
    const { body: [{ declarations: [{ id: { elements = [] } = {} } = {}] = [] } = {}] = [] } = program;
    const type = context.mock.fn(() => 'Identifier');

    elements.forEach(element => Object.defineProperty(element, 'type', { get: type }));
    createProgramAnalysis({ program });
    ok(type.mock.callCount() < width * 100, `${type.mock.callCount()} node header reads for ${width} positions`);
    context.diagnostic(`${type.mock.callCount()} node header reads`);
}));

test('live positional queries release host nodes before and after demand', () => {
    const { execPath = '' } = process;
    const source = `
        import {parse,VisitorKeys} from 'espree';
        import {setImmediate} from 'node:timers/promises';
        import {createProgramAnalysis} from 'eslint-plugin-resilient/analyzer';
        const acquire=()=>{
            const program=parse('const read=([items=[]]=[])=>{const [other]=[items];return other;};read([42]);',
                {ecmaVersion:'latest',sourceType:'module',range:true,loc:true});
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
        const result=analysis.checkCallResult({index:0,required:'array'});
        await collect();console.log(JSON.stringify({before,after:references.filter(ref=>ref.deref()).length,
            sampled:references.length,status:result.status}));
    `;
    const result = JSON.parse(execFileSync(execPath, ['--expose-gc', '--input-type=module', '-e', source], { encoding: 'utf8', timeout: 30000 }));
    const { before = -1, after = -1, sampled = 0, status = '' } = result;

    strictEqual(before, 0);
    strictEqual(after, 0);
    ok(sampled > 40);
    strictEqual(status, 'contradiction');
});
