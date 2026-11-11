import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

const lint = (source, rule) => new Linter().verify(source, { plugins: { resilient: plugin }, rules: { [`resilient/${rule}`]: 'error' } });
const operations = analysis => analysis.memberAccesses.map(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }));

// These programs are counterexamples and semantic probes, not coding patterns.
[
    ['later native callback element', 'const inspect=()=>["a",1].map(item=>item.toUpperCase());', 1],
    ['seed reaches reduction result', 'const inspect=()=>{const items=[1];const total=items.reduce((sum,item)=>sum,0);return total.toUpperCase();};', 1],
    ['reduction element reaches operation', 'const inspect=()=>[1].reduce((sum,item)=>item.toUpperCase(),"");', 1],
    ['renamed callback and receiver aliases', 'const visit=entry=>entry.trim();const apply=visit;const inspect=()=>{const rows=[1];const renamed=rows;return renamed.map(apply);};', 1],
    ['shadowed callback identity', 'const visit=entry=>entry.trim();const inspect=()=>{const visit=entry=>entry;return [1].map(visit);};', 0],
    ['callback order', '["a",1].map(item=>item.toUpperCase());', 1],
    ['chained owned slots', '[1].map(item=>item).map(item=>item.trim());', 1],
    ['unseeded reduction uses first element', '[1].reduce((sum,item)=>sum).trim();', 1],
    ['ordered accumulator replacement', '["",1].reduce((sum,item)=>item,[]).trim();', 1],
    ['empty seeded reduction', '[].reduce((sum,item)=>item,42).trim();', 1],
    ['empty unseeded reduction fails', '[].reduce((sum,item)=>item).trim();', 0],
    ['sparse unseeded reduction uses first present element', '[,,1].reduce((sum,item)=>item).trim();', 1],
    ['all holes unseeded fails', '[,,].reduce((sum,item)=>item).trim();', 0],
    ['map skips holes', '[,,].map(item=>item.trim());', 0],
    ['find visits holes', '[,].find(item=>item.trim());', 1],
    ['undefined slot is visited', '[undefined].map(item=>item.trim());', 1],
    ['foreach invokes callback', '[1].forEach(item=>item.trim());', 1],
    ['filter invokes callback', '[1].filter(item=>item.trim());', 1],
    ['some stops on true', '[true,1].some(item=>item===true?true:item.trim());', 0],
    ['some continues on false', '[false,1].some(item=>item===false?false:item.trim());', 1],
    ['find result is selected element', '[1].find(item=>true).trim();', 1],
    ['find retires selected record after callback mutation', '[{title:42}].find(item=>{item.title="";return true;}).title.trim();', 0],
    ['find preserves selected record after pure callback', '[{title:42}].find(item=>true).title.trim();', 1],
    ['find exits before effect-invalidated tail', '[1,2].find(item=>{external();return true;}).trim();', 1],
    ['some retains early success after an effect', 'const result=[1,2].some(item=>{external();return true;});if(result)42..trim();', 1],
    ['filter preserves selected element', '[1].filter(item=>true).map(item=>item.trim());', 1],
    ['callback throws before later element', '["a",1].map(item=>{throw item;return item.trim();});', 0],
    ['element throws before invocation', 'const fail=()=>{throw 1;};[fail(),1].map(item=>item.trim());', 0],
    ['callee lookup has receiver', 'const visit=[1].map;visit(item=>item.trim());', 0],
    ['native spelling alone supplies no protocol', 'external.map(item=>item.trim());', 0],
    ['own method overrides protocol', 'const rows=[1];rows.map=external;rows.map(item=>item.trim());', 0],
    ['array escape retires slots', 'const rows=[1];external(rows);rows.map(item=>item.trim());', 0],
    ['array alias escape retires slots', 'const rows=[1];const alias=rows;external(alias);rows.map(item=>item.trim());', 0],
    ['callback mutates later element', '[0,1].map((item,index,rows)=>{if(index===0){rows[1]="";return "";}return item.trim();});', 0],
    ['callback effect retires later slot', '[0,1].map(item=>{if(item===0){external();return "";}return item.trim();});', 0],
    ['known contradiction before opaque element survives', '[1,external].map(item=>item.trim());', 1],
    ['unknown callback alternative preserves later known contradiction', 'const good=item=>item.trim();const cb=flag?good:external;["a",1].map(cb);', 1],
    ['unknown reduce result stays unknown', '[1].reduce((sum,item)=>external,0).trim();', 0],
    ['known result beside unknown survives', '[1].reduce((sum,item)=>flag?42:external,0).trim();', 1],
    ['prototype exposure retires protocol', 'external(Array.prototype);[1].map(item=>item.trim());', 0],
    ['spread has no fixed slots', '[...external,1].map(item=>item.trim());', 0],
    ['callback argument effect retires receiver', 'const rows=[1];const callback=()=>{rows[0]="";return item=>item.trim();};rows.map(callback());', 0],
    ['owned default property write', 'const inspect=({config={}}={})=>{config.items="";return config.items.map(Boolean);};', 1],
    ['renamed property and binding', 'const inspect=({settings:local={}}={})=>{local.renamed="";return local.renamed.map(Boolean);};', 1],
    ['owned local write', 'const config={};config.items="";config.items.map(Boolean);', 1],
    ['inert statement between write and read', 'const config={};config.items="";const count=1;config.items.map(Boolean);', 1],
    ['alias write', 'const config={};const alias=config;alias.items="";config.items.map(Boolean);', 1],
    ['supplied object is not validated', 'const inspect=config=>{config.items="";return config.items.map(Boolean);};', 0],
    ['intervening effect invalidates write', 'const config={};config.items="";external();config.items.map(Boolean);', 0],
    ['escape before write', 'const config={};external(config);config.items="";config.items.map(Boolean);', 0],
    ['setter does not establish property', 'const config={set items(value){},get items(){return [];}};config.items="";config.items.map(Boolean);', 0],
    ['custom prototype does not establish property', 'const config={__proto__:external};config.items="";config.items.map(Boolean);', 0],
    ['conditional write does not dominate', 'const config={};if(flag)config.items="";config.items.map(Boolean);', 0],
    ['other branch does not dominate', 'const config={};if(flag){config.items="";}else{config.items.map(Boolean);}', 0],
    ['repeated write read stays unknown', 'const config={};while(flag){config.items="";config.items.map(Boolean);}', 0],
    ['shadowed record has separate state', 'const config={};config.items="";{const config=external;config.items.map(Boolean);}', 0],
    ['effectful assignment value retires write', 'const config={};const get=()=>{external(config);return "";};config.items=get();config.items.map(Boolean);', 0],
    ['unknown supplied property write result remains unknown', 'const config={};config.items=external;config.items.map(Boolean);', 0],
    ['captured local predicate is executable', 'const Array={isArray:value=>!!value};const inspect=(value={})=>Array.isArray(value)?value.map(Boolean):[];', 1],
    ['callee renaming preserves proof', 'const checks={present:value=>!!value};const inspect=(value={})=>checks.present(value)?value.map(Boolean):[];', 1],
    ['callee alias preserves identity', 'const checks={present:value=>!!value};const alias=checks;const inspect=(value={})=>alias.present(value)?value.map(Boolean):[];', 1],
    ['later callee mutation invalidates capture', 'const checks={present:value=>!!value};const inspect=(value={})=>checks.present(value)?value.map(Boolean):[];checks.present=external;', 0],
    ['captured mutation invalidates callee',
        'const checks={present:value=>!!value};const change=()=>{checks.present=external;};const inspect=(value={})=>checks.present(value)?value.map(Boolean):[];', 0],
    ['callee object escape invalidates capture', 'const checks={present:value=>!!value};external(checks);const inspect=(value={})=>checks.present(value)?value.map(Boolean):[];', 0],
    ['exported callee object is exposed', 'export const checks={present:value=>!!value};const inspect=(value={})=>checks.present(value)?value.map(Boolean):[];', 0],
    ['returned callee object is exposed', 'const checks={present:value=>!!value};const expose=()=>checks;const inspect=(value={})=>checks.present(value)?value.map(Boolean):[];', 0],
    ['later lexical shadow owns predicate', 'const checks={present:value=>!!value};const inspect=(value={})=>{const checks=external;return checks.present(value)?value.map(Boolean):[];};', 0],
    ['callee effect retires input',
        'const checks={present:value=>{external(value);return true;}};const inspect=(value={})=>checks.present(value)?value.map(Boolean):[];', 0],
    ['callee return can expose input', 'const checks={present:value=>value};const inspect=(value={})=>checks.present(value)?value.map(Boolean):[];', 0],
    ['receiver-dependent method is not a lexical arrow', 'const checks={present(value){return !!value;}};const inspect=(value={})=>checks.present(value)?value.map(Boolean):[];', 0],
    ['callee creation precedes captured initialization', 'const inspect=(value={})=>checks.present(value)?value.map(Boolean):[];const checks={present:value=>!!value};', 0],
    ['uninitialized captured binding has no record snapshot', 'let checks;const inspect=(value={})=>checks.present(value)?value.map(Boolean):[];', 0],
    ['callee alias must be initialized before capture',
        'const checks={present:value=>!!value};const inspect=(value={})=>alias.present(value)?value.map(Boolean):[];inspect();const alias=checks;', 0],
    ['repeated pure observers preserve input', 'const read=value=>!!value;const inspect=(value={})=>{read(value);read(value);return value.map(Boolean);};', 1]
].forEach(([name = '', source = '', expected = 0] = []) => test(`shared evidence: ${name}`, () => {
    strictEqual(lint(source, 'signature-contract-operation').length, expected);
    const first = createAnalysis({ source });
    const second = createAnalysis({ source });
    const before = operations(first);

    strictEqual(before.filter(({ conflicts = [] } = {}) => conflicts.length).length, expected);
    second.functions.toReversed().forEach(({ index = -1 } = {}) => second.checkFunction({ index }));
    second.calls.toReversed().forEach(({ index = -1 } = {}) => second.checkCall({ index }));
    const reversed = second.memberAccesses.toReversed().map(({ index = -1 } = {}) => second.checkMemberAccess({ index })).toReversed();

    deepStrictEqual(reversed, before);
    deepStrictEqual(operations(first), before);
}));

[
    ['authored callback field', 'const inspect=()=>{const items=[{title:42}];return items.map(({title=""}={})=>title.trim());};', 1],
    ['named callback contract', 'const cb=({label=""}={})=>label;const inspect=()=>[{label:42}].map(cb);', 1],
    ['supplied unknown field stays unknown', '[{title:external}].map(({title=""}={})=>title);', 0],
    ['unknown sibling does not erase contradiction', '[{title:42,other:external}].map(({title="",other}={})=>title);', 1],
    ['protocol supplies callback index', '[""].map((item,index="")=>index);', 1],
    ['protocol supplies collection argument', '[""].map((item,index,rows="")=>rows);', 1],
    ['ignored protocol arguments are valid', '[1].map(item=>item);', 0],
    ['required argument beyond protocol', '[1].map((item,index,rows,required)=>required);', 1],
    ['reducer receives four arguments', '[1].reduce((sum,item,index,rows,required)=>required,0);', 1],
    ['callback rest consumes protocol tail', '[1].map((item,...rest)=>item);', 0],
    ['empty receiver has no callback use', '[].map((item,index,rows,required)=>required);', 0],
    ['conditional callback keeps known contradiction', 'const cb=flag?((value="")=>value):external;[1].map(cb);', 1]
].forEach(([name = '', source = '', expected = 0] = []) => test(`collection caller agreement: ${name}`, () => {
    strictEqual(lint(source, 'signature-contract-call-site').length, expected);
    const analysis = createAnalysis({ source });
    const { calls = [] } = analysis;

    strictEqual(calls.some(({ index = -1 } = {}) => analysis.checkCall({ index }).status === 'contradiction'), Boolean(expected));
}));

test('actual callback evidence never changes its generic result', () => {
    const source = 'const callback=value=>value;const inspect=()=>[1].reduce(callback,0);';
    const analysis = createAnalysis({ source });
    const before = analysis.checkFunction({ index: 0 });
    const { status = '' } = before;

    strictEqual(status, 'unknown');
    analysis.calls.forEach(({ index = -1 } = {}) => analysis.checkCallResult({ index, required: 'number' }));
    operations(analysis);
    deepStrictEqual(analysis.checkFunction({ index: 0 }), before);
});

test('source revisions do not revise retained evidence', () => {
    const source = '[1].map(item=>item.trim());';
    const original = createAnalysis({ source });
    const before = operations(original);
    const revised = createAnalysis({ source: source.replace('[1]', '[""]') });

    strictEqual(operations(revised).some(({ conflicts = [] } = {}) => conflicts.length), false);
    deepStrictEqual(operations(original), before);
});

test('imported callback signatures do not authorize dependency body execution', () => {
    const analysis = createAnalysis({ source: 'import cb from "dep";[1].map(cb);', filename: 'main',
        resolveModule: () => ({ filename: 'dep', source: 'export default (value="")=>value.trim();' }) });
    const { calls = [] } = analysis;
    const { index = -1 } = calls.find(({ callee = '' } = {}) => callee === 'map') ?? {};

    strictEqual(analysis.checkCall({ index }).status, 'contradiction');
    strictEqual(analysis.checkCallResult({ index, required: 'array' }).status, 'agreement');
});

[
    '[1,2].map(item=>item.trim());',
    '[1,2].reduce((sum,item)=>item,0).trim();',
    '[{title:42},{}].find(item=>{item.title="";return true;}).title.trim();',
    'const inspect=({config={}}={})=>{config.items="";return config.items.map(Boolean);};',
    'const checks={present:value=>!!value};const inspect=(value={})=>checks.present(value)?value.map(Boolean):[];'
].forEach(source => test('each interrupted new evidence step recovers without changing the result', () => {
    const query = (analysis, observation = {}) => analysis.memberAccesses.map(({ index = -1 } = {}) => analysis.checkMemberAccess({ index, ...observation }));
    const work = counter();
    const expected = query(createAnalysis({ source }), { onWork: event => work.onWork(event) });
    const steps = Object.values(work.read()).reduce((sum, count) => sum + count, 0);

    Array.from({ length: steps }, (unused, index) => index + 1).forEach((stop) => {
        const analysis = createAnalysis({ source });
        const visits = counter();
        const failure = new Error(`interrupted evidence step ${stop}`);

        throws(() => query(analysis, { onWork: () => {
            visits.increment('steps');
            const { steps = 0 } = visits.read();

            if (steps === stop) throw failure;
        } }), error => error === failure);
        deepStrictEqual(query(analysis), expected);
    });
}));

test('one selected reducer retains its identity through every accumulator step', () => {
    const analysis = createAnalysis({ source: 'const cb=flag?((sum)=>typeof sum==="boolean"?"":1):((sum)=>true);[0,0].reduce(cb,0);' });
    const { calls = [] } = analysis;
    const { index = -1 } = calls.find(({ callee = '' } = {}) => callee === 'reduce') ?? {};
    const { fact: { families = [] } = {} } = analysis.checkCallResult({ index, required: 'string' });

    deepStrictEqual(families.toSorted(), ['boolean', 'number']);
});

[
    'const inspect=()=>[1,2].map(item=>({value:external()}));',
    'const inspect=()=>[1,2].map(item=>{if(flag)external();return {value:item};});',
    'const inspect=()=>[1,2].filter(item=>({value:external()}));'
].forEach(source => test('callback values cannot become collection return alternatives after effects', () => {
    const analysis = createAnalysis({ source });
    const { fact: { families = [] } = {} } = analysis.checkFunction({ index: 0, required: 'array' });

    deepStrictEqual(families, ['array']);
    strictEqual(lint(source, 'signature-contract-return-consistency').length, 0);
}));

test('a later callback effect retires earlier produced member snapshots', () => {
    const source = 'const result=[1,2].map(item=>item===1?{title:42}:external());result.map(item=>item.title.trim());';

    strictEqual(lint(source, 'signature-contract-operation').length, 0);
    strictEqual(operations(createAnalysis({ source })).some(({ conflicts = [] } = {}) => conflicts.length), false);
});
