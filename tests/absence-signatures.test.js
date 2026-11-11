import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const { cases = [] } = JSON.parse(readFileSync(new URL('./fixtures/absence-signatures.json', import.meta.url), 'utf8'));
const examples = [
    { name: 'no-null-assignment', source: 'const value=null;' },
    { name: 'no-undefined-assignment', source: 'const value=undefined;' },
    { name: 'no-undefined-comparison', source: 'value===undefined;' },
    { name: 'no-destructuring-fallback', source: 'const {}=value||{};' },
    { name: 'prefer-destructured-member-access', source: 'const read=value=>value.field;' },
    { name: 'prefer-signature-destructuring', source: 'const read=value=>{const {field=1}=value;return field;};' },
    { name: 'prefer-safe-destructuring-defaults', source: 'const read=({field}={})=>String(field);' }
];
const names = examples.map(({ name = '' } = {}) => name);
const rulesFor = selected => Object.fromEntries(selected.map(name => [`resilient/${name}`, 'error']));
const lint = (source, selected = names, options = {}) => new Linter().verify(source, {
    plugins: { resilient: plugin }, rules: rulesFor(selected), ...options
});
const outputFor = (source, { fix: { range: [start = 0, end = 0] = [], text = '' } = {} } = {}) => source.slice(0, start) + text + source.slice(end);

cases.forEach(({ rule = '', source = '', expected = [] } = {}) => test(`${rule}: ${source}`, () => {
    deepStrictEqual(lint(source, [rule]), expected);
}));

examples.forEach(({ name = '', source = '' } = {}) => {
    const rule = `resilient/${name}`;

    test(`rule configuration: ${name}`, () => {
        const { rules = {}, configs: { recommended = {} } = {} } = plugin;
        const { meta: { docs: { url = '' } = {}, fixable = false } = {} } = Reflect.get(rules, name);

        strictEqual(url, `https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/${name}.md`);
        strictEqual(fixable, false);
        deepStrictEqual(lint(source, [name], { rules: { [rule]: 'off' } }), []);
        const warning = lint(source, [name], { rules: { [rule]: 'warn' } });
        const error = lint(source, [name]);

        strictEqual(warning.length, 1);
        strictEqual(error.length, 1);
        strictEqual(warning.at(0).severity, 1);
        strictEqual(error.at(0).severity, 2);
        ok(new Linter().verify(source, recommended).some(({ ruleId = '' } = {}) => ruleId === rule));
        const { output = '', fixed = false } = new Linter().verifyAndFix(source, { plugins: { resilient: plugin }, rules: { [rule]: 'error' } });

        strictEqual(output, source);
        strictEqual(fixed, false);
    });

    test(`local exception ownership: ${name}`, () => {
        const engine = new Linter();
        const findings = engine.verify(`// eslint-disable-next-line ${rule} -- Deliberate negative fixture.\n${source}`,
            { plugins: { resilient: plugin }, rules: { [rule]: 'error' } });

        deepStrictEqual(findings, []);
        const suppressed = engine.getSuppressedMessages();

        strictEqual(suppressed.length, 1);
        strictEqual(suppressed.at(0).ruleId, rule);
    });
});

const memberRule = ['prefer-destructured-member-access'];
[
    'const read=value=>(value?.method)();',
    'const read=value=>(value?.method)?.();',
    'const read=value=>(value?.items).map(item=>item);',
    'const read=value=>(value?.items)?.map(item=>item);',
    'const read=value=>(value?.items).length;',
    'const read=value=>(value?.items).size;',
    'const read=value=>(value?.items)?.length;',
    'const read=value=>((value?.items)?.nested).map(item=>item);',
    'const read=value=>value.tag`text`;',
    'const read=value=>(value?.tag)`text`;',
    'const read=value=>(value?.nested).tag`text`;',
    'const read=(value,key)=>(value?.[key])();'
].forEach(source => test(`receiver and cardinality boundaries preserve reference chains: ${source}`, () => {
    deepStrictEqual(lint(source, memberRule), []);
}));

[
    ['const read=value=>value?.field;', 'value?.field'],
    ['const read=value=>(value?.nested).field;', 'value?.nested'],
    ['const read=value=>(0,value?.method)();', 'value?.method'],
    ['const read=(value,other)=>(value?.method||other)();', 'value?.method'],
    ['const read=(value,flag,other)=>(flag?value?.method:other)();', 'value?.method'],
    ['const read=value=>(0,value?.tag)`text`;', 'value?.tag'],
    ['const read=(value,key)=>(value?.items)[key];', 'value?.items'],
    ['const read=value=>(value?.items)["length"];', 'value?.items'],
    ['const read=value=>new (value?.Ctor)();', 'value?.Ctor']
].forEach(([source = '', selected = ''] = []) => test(`value selection requires a data boundary: ${source}`, () => {
    const findings = lint(source, memberRule);

    strictEqual(findings.length, 1);
    const [{ column = 0, endColumn = 0, messageId = '', suggestions = [], fix = false } = {}] = findings;

    strictEqual(messageId, 'staticMember');
    strictEqual(source.slice(column - 1, endColumn - 1), selected);
    deepStrictEqual(suggestions, []);
    strictEqual(fix, false);
}));

test('receiver syntax preserves independent call requirements', () => {
    const source = 'const read=({items=[]}={})=>items.map(value=>value);read({items:""});read(external);';
    const analysis = createAnalysis({ source });
    const { calls = [] } = analysis;
    const selected = calls.filter(({ callee = '' } = {}) => callee === 'read');

    strictEqual(selected.length, 2);
    deepStrictEqual(selected.map(({ index = -1 } = {}) => analysis.checkCall({ index }).status), ['contradiction', 'unknown']);
    deepStrictEqual(lint(source), []);
    const findings = lint(source, [...names, 'signature-contract-call-site']);

    strictEqual(findings.length, 1);
    strictEqual(findings.at(0).ruleId, 'resilient/signature-contract-call-site');
});

test('signature suggestions preserve failure, getters and authored defaults', () => {
    [
        'const read=input=>{const {field=1}=input;return field;};',
        'const read=(input={})=>{const {field=1}=input;return field;};',
        'const read=(input,other)=>{const {field=1}=input;return [field,other];};'
    ].forEach((source) => {
        const [{ suggestions = [] } = {}] = lint(source, ['prefer-signature-destructuring']);

        strictEqual(suggestions.length, 1);
        const moved = outputFor(source, suggestions.at(0));
        const execute = program => runInNewContext(`${program}
            const events=[], failure={};
            const supplied={get field(){events.push('get');return false;}};
            const throwing={get field(){throw failure;}};
            const results=[[],[void 0],[null],[{}],[{field:0}],[{field:null}],[supplied],[throwing]].map(args=>{
                try{return {value:read(...args)};}catch(error){return {failure:error===failure,name:error.name};}
            });
            JSON.stringify({results,events,length:read.length});`);

        strictEqual(execute(moved), execute(source));
        const { output = '', messages = [] } = new Linter().verifyAndFix(moved, { plugins: { resilient: plugin }, rules: rulesFor(names) });

        strictEqual(output, moved);
        strictEqual(execute(output), execute(source));
        deepStrictEqual(messages, []);
    });
});

[
    'values.reduce((acc,item)=>acc.field,{});',
    'values?.reduce((acc,item)=>acc.field,{});',
    '(values?.reduce)((acc,item)=>acc.field,{});',
    '(values?.reduce)?.((acc,item)=>acc.field,{});',
    '((values?.nested)?.reduce)((acc,item)=>acc.field,{});',
    '(values?.reduce)((acc={},item)=>acc.field,{});',
    '(values?.reduce)(function(acc,item){return acc.field;},{});',
    '(values?.reduce)(async(acc,item)=>acc.field,{});',
    '(values?.reduce)(function*(acc,item){yield acc.field;},{});',
    '(values?.reduce)((state,item)=>{if(item){return state.field;}return state;},{});',
    '(values?.reduce)((state,item)=>{state.field=item;return state;},{});',
    '(values?.reduce)((acc,item)=>{const nested=acc=>acc.method();return acc.field;},{});'
].forEach(source => test(`reducer accumulator ownership: ${source}`, () => {
    deepStrictEqual(lint(source, memberRule), []);
}));

[
    ['(0,values.reduce)((acc,item)=>acc.field,{});', 'acc.field'],
    ['(values?.reduce||fallback)((acc,item)=>acc.field,{});', 'acc.field'],
    ['(flag?values.reduce:fallback)((acc,item)=>acc.field,{});', 'acc.field'],
    ['(values?.["reduce"])((acc,item)=>acc.field,{});', 'acc.field'],
    ['(values?.reduce.bind(values))((acc,item)=>acc.field,{});', 'acc.field'],
    ['const reduce=values.reduce;reduce((acc,item)=>acc.field,{});', 'acc.field'],
    ['(values?.reduce)(callback,acc=>acc.field);', 'acc.field'],
    ['(values?.reduce)((acc,item)=>item.field,{});', 'item.field'],
    ['(values?.reduce)(({acc},item)=>acc.field,{});', 'acc.field'],
    ['(values?.reduce)((acc,item)=>()=>acc.field,{});', 'acc.field'],
    ['(values?.reduce)((acc,item)=>{const nested=acc=>acc.field;return acc;},{});', 'acc.field'],
    ['(values?.reduce)((acc,item)=>{const alias=acc;return alias.field;},{});', 'alias.field'],
    ['(values?.reduce)((acc,item)=>{{const acc=external;return acc.field;}},{});', 'acc.field'],
    ['const read=value=>value.field;', 'value.field'],
    ['const read=()=>{const value=external;return value.field;};', 'value.field'],
    ['const read=value=>value["length"];', 'value["length"]'],
    ['const read=value=>(0,value.method)();', 'value.method'],
    ['const read=value=>new value.Ctor();', 'value.Ctor']
].forEach(([source = '', selected = ''] = []) => test(`member ownership counterexample: ${source}`, () => {
    const findings = lint(source, memberRule);

    strictEqual(findings.length, 1);
    const [{ messageId = '', column = 0, endColumn = 0, suggestions = [], fix = false } = {}] = findings;

    strictEqual(messageId, 'staticMember');
    strictEqual(source.slice(column - 1, endColumn - 1), selected);
    deepStrictEqual(suggestions, []);
    strictEqual(fix, false);
}));

[
    'const value=external;const read=()=>value.field;',
    'const read=()=>external.field;',
    'const read=value=>value.length;',
    'const read=value=>value.items.length.extra;'
].forEach(source => test(`member policy preserves the receiver boundary: ${source}`, () => {
    deepStrictEqual(lint(source, memberRule), []);
}));
