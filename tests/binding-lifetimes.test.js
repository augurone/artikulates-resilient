import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const lint = source => new Linter().verify(source, {
    plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' }
});
const definition = 'function choose(a,b){switch(arguments.length){case 1:return eval("b");case 2:return b(a);}}';

[
    ['lookup precedes opaque body execution', `${definition}choose(1);`, 1],
    ['argument object read does not prove an omitted formal unused', 'function choose(a,b){switch(arguments.length){case 1:return arguments[1].value;case 2:return b(a);}}choose(1);', 1],
    ['returned capture does not prove an omitted formal unused', 'function choose(a,b){switch(arguments.length){case 1:return ()=>arguments[1].value;case 2:return b(a);}}choose(1);', 1],
    ['renamed declaration', definition.replaceAll('choose', 'select') + 'select(1);', 1],
    ['hoisted declaration', `choose(1);${definition}`, 1],
    ['pure prefix preserves initial lookup', `${definition}const count=1;choose(count);`, 1],
    ['argument effects follow callee lookup', `${definition}choose(external());`, 1],
    ['immutable alias captures the initial declaration', `${definition}const select=choose;external();select(1);`, 1],
    ['alias chain preserves its captured callable', `${definition}const select=choose;const renamed=select;external();renamed(1);`, 1],
    ['intervening call retires mutable lookup', `${definition}external();choose(1);`, 0],
    ['unresolved read can invoke a global getter', `${definition}external;choose(1);`, 0],
    ['member read can invoke a getter', `${definition}const record={};record.value;choose(1);`, 0],
    ['coercion may precede later lookup', `${definition}const record={};+record;choose(1);`, 0],
    ['computed property coercion retires lookup', `${definition}const key={};({[key]:0});choose(1);`, 0],
    ['template coercion retires lookup', definition + 'const value={};`${value}${choose(1)}`;', 0],
    ['class evaluation retires lookup', `${definition}class Value{}choose(1);`, 0],
    ['spread iteration retires lookup', `${definition}const values=[];[...values];choose(1);`, 0],
    ['alias after effects stays unknown', `${definition}external();const select=choose;select(1);`, 0],
    ['captured mutable declaration has no initial phase', `${definition}const run=()=>choose(1);run();`, 0],
    ['later call cannot replay initial lookup', `${definition}choose(1);choose(1);`, 1],
    ['loop text order is not execution order', `${definition}while(true){choose(1);break;}`, 0],
    ['shadowed declaration owns its signature', `${definition}{function choose(a=0){return a;}choose(1);}`, 0],
    ['explicit write retires declaration identity', `${definition}choose=external;choose(1);`, 0],
    ['direct dynamic scope keeps its boundary', `${definition}eval("choose=external");choose(1);`, 0]
].forEach(([name = '', source = '', expected = 0] = []) => test(`declaration lifetime: ${name}`, () => {
    strictEqual(lint(source).length, expected);
    const analysis = createAnalysis({ source });
    const { calls = [] } = analysis;
    const findings = calls.flatMap(({ index = -1 } = {}) => {
        const { obligations = [] } = analysis.checkCall({ index });

        return obligations.filter(({ status = '' } = {}) => status === 'contradiction');
    });

    strictEqual(findings.length, expected);
}));

test('a dependency mutable export has no caller-owned initial phase', () => {
    const source = 'import {choose} from "dependency";choose(1);';
    const analysis = createAnalysis({ source, filename: 'main', resolveModule: () => ({ filename: 'dependency', source: `export ${definition}` }) });

    strictEqual(analysis.checkCall({ index: 0 }).status, 'unknown');
});

test('declaration phase follows source revisions independently of query order', () => {
    const source = `${definition}choose(1);`;
    const first = createAnalysis({ source });
    const second = createAnalysis({ source });
    const revised = createAnalysis({ source: `${definition}external();choose(1);` });
    const { calls = [], functions = [] } = second;
    const before = calls.map(({ index = -1 } = {}) => first.checkCall({ index }));

    functions.toReversed().forEach(({ index = -1 } = {}) => second.checkFunction({ index }));
    deepStrictEqual(calls.map(({ index = -1 } = {}) => second.checkCall({ index })), before);
    deepStrictEqual(calls.map(({ index = -1 } = {}) => first.checkCall({ index })), before);
    const { calls: changed = [] } = revised;
    const { index = -1 } = changed.find(({ callee = '' } = {}) => callee === 'choose') ?? {};

    strictEqual(revised.checkCall({ index }).status, 'unknown');
});

const findings = source => new Linter().verify(source, {
    plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-return-consistency': 'error' }
});

[
    ['captured primitive return precedes finally write', 'const read=flag=>{let value="";if(flag)return 1;try{return value;}finally{value=1;}};', true],
    ['renamed binding', 'const read=flag=>{let renamed="";if(flag)return 1;try{return renamed;}finally{renamed=1;}};', true],
    ['initialized local value', 'const read=flag=>{let value="";if(flag)return 1;return value;};', true],
    ['const snapshot precedes write', 'const read=flag=>{let value="";const saved=value;value=1;if(flag)return 1;return saved;};', true],
    ['shadowed write does not invalidate outer value', 'const read=flag=>{let value="";{let value=0;value=1;}if(flag)return 1;return value;};', true],
    ['intervening write stays unknown', 'const read=flag=>{let value="";value=1;if(flag)return 1;return value;};', false],
    ['conditional write stays unknown', 'const read=flag=>{let value="";if(flag)value=1;if(flag)return 1;return value;};', false],
    ['captured write stays unknown', 'const read=flag=>{let value="";const change=()=>{value=1;};change();if(flag)return 1;return value;};', false],
    ['opaque local effects stay unknown', 'const read=flag=>{let value="";eval("value=1");if(flag)return 1;return value;};', false],
    ['opaque captured effects stay unknown', 'const read=flag=>{let value="";const change=()=>eval("value=1");change();if(flag)return 1;return value;};', false],
    ['module mutable value stays unknown', 'let value="";const read=flag=>{if(flag)return 1;return value;};value=1;', false],
    ['var initializer reassigns the binding', 'const read=flag=>{var value="";var value=1;if(flag)return 1;return value;};', false],
    ['destructuring write stays unknown', 'const read=flag=>{let value="";({value}={value:1});if(flag)return 1;return value;};', false],
    ['update retires the initializer', 'const read=flag=>{let value="";value++;if(flag)return 1;return value;};', false],
    ['finalizer replacement owns the result', 'const read=flag=>{let value="";if(flag)return 1;try{return value;}finally{return 1;}};', false]
].forEach(([name = '', source = '', expected = false] = []) => {
    test(`initial binding lifetime: ${name}`, () => {
        const analysis = createAnalysis({ source });
        const { status = '' } = analysis.checkFunction({ index: 0 });

        strictEqual(status === 'contradiction', expected);
        strictEqual(Boolean(findings(source).length), expected);
    });
});

[
    'const read=()=>{let value="";while(external){value.trim();value=1;}};',
    'const read=()=>{let value="";do{value.trim();value=1;}while(external);};',
    'const read=()=>{let value="";for(;external;){value.trim();value=1;}};',
    'const read=()=>{let value="";for(const item of external){value.trim();value=1;}};'
].forEach(source => test('repeated reads cannot recover the initial binding from text order', () => {
    const analysis = createAnalysis({ source });
    const { receivers = [] } = analysis;

    receivers.forEach(({ index = -1 } = {}) => strictEqual(analysis.check({ index }).status, 'unknown'));
}));

test('mutable initializer queries remain independent of revisions and observation order', () => {
    const source = 'const read=flag=>{let value="";if(flag)return 1;try{return value;}finally{value=1;}};read(false);';
    const first = createAnalysis({ source });
    const second = createAnalysis({ source });
    const revised = createAnalysis({ source: source.replace('let value=""', 'let value=1') });
    const before = first.checkFunction({ index: 0 });

    second.checkCallResult({ index: 0, required: 'string' });
    deepStrictEqual(second.checkFunction({ index: 0 }), before);
    strictEqual(revised.checkFunction({ index: 0 }).status, 'agreement');
    deepStrictEqual(first.checkFunction({ index: 0 }), before);
});
