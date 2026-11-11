import { deepStrictEqual, strictEqual, ok, throws } from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter, ESLint } from 'eslint';
import { parse } from 'espree';

import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { queriesFor, queryAnalysis } from './support/analysis-queries.js';
import { counter } from './support/work.js';

// Receiver/capture lifetimes are owned by reached effects and creation frames. Preserve native mutation/escape controls, query-order, retry, revision, release and graph bounds.
const conflictsForShared = analysis => analysis.memberAccesses.filter(({ name = '' } = {}) => name === 'trim')
    .flatMap(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }).conflicts);
const observeShared = ({ status = '', fact: { families = [], incomplete = false } = {} } = {}) => ({ status, families, incomplete });

{
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
}

{
    const conflictsFor = conflictsForShared;

    [
        'record ? true : false;',
        'true && record ? true : false;',
        'record && true ? true : false;',
        'typeof record === "object" && record ? true : false;',
        'record || false ? true : false;',
        'record ?? false ? true : false;',
        'record ? record ? true : false : false;'
    ].forEach(observation => test(`truth observation does not retire a receiver: ${observation}`, () => {
        ['42', '"ok"'].forEach((input, position) => {
            const source = `const record={value:${input}};const alias=record;${observation}const {value=""}={...alias};value.trim();`;
            const analysis = createAnalysis({ source });
            const expected = position ? [] : ['number'];

            deepStrictEqual(conflictsFor(analysis), expected);
            queriesFor(analysis).toReversed().forEach(query => queryAnalysis(analysis, query));
            deepStrictEqual(conflictsFor(analysis), expected);

            if (!position) throws(() => runInNewContext(source), ({ name = '' } = {}) => name === 'TypeError');

            if (position) strictEqual(runInNewContext(source), 'ok');
        });
    }));

    [
        'record ? expose(record) : false;',
        'record && expose(record) ? true : false;',
        'expose(record) ? true : false;',
        'record ? {saved:record} : {};expose(record);',
        'record ? true : false;expose(alias);',
        'record ? true : false;alias.value="ok";'
    ].forEach(effect => test(`conditional observation does not hide a real lifetime hazard: ${effect}`, () => {
        const source = `const record={value:42};const alias=record;${effect}const {value=""}={...record};value.trim();`;
        const analysis = createAnalysis({ source });

        deepStrictEqual(conflictsFor(analysis), []);
        strictEqual(runInNewContext('const expose=value=>{value.value="ok";};' + source), 'ok');
        const { index = -1 } = analysis.memberAccesses.find(({ name = '' } = {}) => name === 'trim');

        strictEqual(analysis.checkMemberAccess({ index }).incomplete, true);
    }));

    [
        'f();return f.call(null);',
        'f.call(null);return f.apply(null,[]);',
        'f.apply(null,[]);return f.call(null);',
        'const alias=f;alias.call(null);return f.apply(null,[]);',
        'return flag?f.call(null):f.apply(null,[]);',
        'if(flag)f.call(null);return f.apply(null,[]);',
        'if(false)f.call(null);return f.apply(null,[]);'
    ].forEach(body => test(`callable reads retain their proved caller lifetime: ${body}`, () => {
        ['42', '"ok"'].forEach((input, position) => {
            const definition = `const read=(flag=false)=>{const f=()=>${input};${body}};`;
            const source = definition + 'read(false).trim();read(true).trim();';
            const analysis = createAnalysis({ source });
            const summary = analysis.checkFunction({ index: 0 });
            const { fact: { families = [], incomplete = true } = {}, normal = false, thrown = true } = summary;

            deepStrictEqual(families, [position ? 'string' : 'number']);
            strictEqual(incomplete, false);
            strictEqual(normal, true);
            strictEqual(thrown, false);
            deepStrictEqual(conflictsFor(analysis), position ? [] : ['number', 'number']);
            queriesFor(analysis).toReversed().forEach(query => queryAnalysis(analysis, query));
            deepStrictEqual(analysis.checkFunction({ index: 0 }), summary);
            [false, true].forEach(flag => strictEqual(runInNewContext(definition + `read(${flag});`), position ? 'ok' : 42));
        });
    }));

    [
        'f.call(null);expose(f);',
        'expose(f);f();',
        'f.call=()=>"ok";',
        'const alias=f;expose(alias);'
    ].forEach(effect => test(`callable lifetime recovery cannot restore an exposed protocol: ${effect}`, () => {
        const source = `const read=()=>{const f=()=>42;${effect}return f.call(null);};read().trim();`;
        const analysis = createAnalysis({ source });

        deepStrictEqual(conflictsFor(analysis), []);
        strictEqual(runInNewContext('const expose=value=>{value.call=()=>"ok";};' + source), 'ok');
    }));

    test('new callable lifetime edges share completed work and grow with source uses', () => {
        const samples = [8, 32].map((width) => {
            const source = 'const read=(enabled=false)=>{const first=()=>42;const second=()=>7;const f=enabled?first:second;const invoke=()=>{'
                + 'f.call(null);'.repeat(width) + 'return f.apply(null,[]);};return invoke();};read();';
            const analysis = createAnalysis({ source });
            const work = counter();
            const { onWork } = work;
            const expected = analysis.checkFunction({ index: 0, onWork });
            const { fact: { families = [], incomplete = true } = {} } = expected;
            const before = work.read();

            deepStrictEqual(families, ['number']);
            strictEqual(incomplete, false);
            deepStrictEqual(analysis.checkFunction({ index: 0, onWork }), expected);
            ['value-demand', 'function-context', 'flow-contribution', 'value-selection', 'establishment'].forEach(kind => (
                strictEqual(work.get(kind), Reflect.get(before, kind), kind)
            ));

            return before;
        });

        ['value-demand', 'function-context', 'flow-contribution'].forEach((kind) => {
            const [small = 0, large = 0] = samples.map(sample => Reflect.get(sample, kind));

            ok(small > 0, kind);
            ok(large <= 4 * small, kind);
        });
    });
}

{
    const conflictsFor = (analysis, observation = {}) => analysis.memberAccesses.filter(({ name = '' } = {}) => name === 'trim')
        .flatMap(({ index = -1 } = {}) => analysis.checkMemberAccess({ index, ...observation }).conflicts);
    const lint = source => new Linter().verify(source, { plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-operation': 'error' } });

    [
        ['immediate closure', 'value=>{const read=()=>({...value});return read();}'],
        ['nested closure', 'value=>(()=>(()=>({...value}))())()'],
        ['returned closure', 'value=>{const make=item=>()=>({...item});return make(value)();}'],
        ['sibling closure', 'value=>{const read=()=>({...value});const wrap=()=>read();return wrap();}'],
        ['copied local capture', 'value=>{const copy={...value};return (()=>({...copy}))();}'],
        ['closure in returned record', 'value=>{const make=item=>({read:()=>({...item})});return make(value).read();}'],
        ['closure in returned array', 'value=>{const make=item=>[()=>({...item})];const [read]=make(value);return read();}']
    ].forEach(([name = '', normalize = ''] = []) => test(`captured return retains supplied fields: ${name}`, () => {
        ['42', '"ok"'].forEach((input, position) => {
            const source = `const normalize=${normalize};const {name=""}=normalize({name:${input}});name.trim();`;
            const analysis = createAnalysis({ source });
            const expected = position ? [] : ['number'];
            const { execPath = '' } = process;
            const { status = -1 } = spawnSync(execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 5000 });

            deepStrictEqual(conflictsFor(analysis), expected);
            strictEqual(status, position ? 0 : 1);
            strictEqual(lint(source).length, position ? 0 : 1);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(conflictsFor(analysis), expected);
        });
    }));

    test('captured values belong to creation instances and generic queries remain independent', () => {
        const prefix = 'const make=value=>()=>({...value});const first=make({name:42});const second=make({name:"ok"});';
        const source = `${prefix}const {name=""}=second();name.trim();const {name:bad=""}=first();bad.trim();`;
        const analysis = createAnalysis({ source });
        const before = analysis.checkFunction({ index: 0 });

        deepStrictEqual(conflictsFor(analysis), ['number']);
        deepStrictEqual(analysis.checkFunction({ index: 0 }), before);
        const reverse = createAnalysis({ source });

        reverse.calls.toReversed().forEach(({ index = -1 } = {}) => reverse.checkCall({ index }));
        deepStrictEqual(conflictsFor(reverse), ['number']);
        deepStrictEqual(conflictsFor(createAnalysis({ source: 'const make=value=>()=>({...value});const {name=""}=make(flag?{name:42}:external)();name.trim();' })), ['number']);
    });

    test('captured values retain mutation, exposure and initialization boundaries', () => {
        [
            'const make=value=>{const read=()=>({...value});value.name="ok";return read();};const {name=""}=make({name:42});name.trim();',
            'const make=value=>{const read=()=>({...value});external(value);return read();};const {name=""}=make({name:42});name.trim();',
            'const make=value=>{const read=()=>({...value});value={name:"ok"};return read();};const {name=""}=make({name:42});name.trim();',
            'const make=()=>{const read=()=>({...value});const value={name:42};return read();};const {name=""}=make();name.trim();'
        ].forEach(source => deepStrictEqual(conflictsFor(createAnalysis({ source })), []));
    });

    test('closure work is shared by warm queries and bounded by created instances', () => {
        const observed = [8, 32].map((width) => {
            const source = 'const make=value=>()=>({...value});' + Array.from({ length: width }, (value, position) => (
                `const read${position}=make({name:42});const {name:name${position}=""}=read${position}();name${position}.trim();`
            )).join('');
            const analysis = createAnalysis({ source });
            const work = counter();

            strictEqual(conflictsFor(analysis, work).length, width);
            const before = work.read();

            strictEqual(conflictsFor(analysis, work).length, width);
            deepStrictEqual(work.read(), before);

            return work.get('function-context');
        });

        ok(observed.at(0) > 0);
        ok(observed.at(1) <= observed.at(0) * 4);
    });

    test('captured callback results distinguish invocation, discard and a downstream guard', () => {
        [
            ['(() => cb)()();', true],
            ['(() => cb)();', false],
            ['const invoke=(() => cb)();if(typeof invoke==="function")invoke();', false],
            ['(() => [...[cb].map(value=>value)])()[0]();', true]
        ].forEach(([body = '', required = false] = []) => {
            const source = `const run=({cb}={})=>{if(cb){${body}}};`;
            const analysis = createAnalysis({ source });
            const { index = -1 } = analysis.declarations.find(({ name = '' } = {}) => name === 'cb') ?? {};
            const executes = () => runInNewContext(`${source}run({cb:42});`);

            strictEqual(analysis.checkDeclaration({ index }).required, required);

            if (!required) strictEqual(executes(), undefined);
        });
    });
}

{
    const operation = 'resilient/signature-contract-operation';
    const defaults = 'resilient/prefer-safe-destructuring-defaults';
    const invocation = 'resilient/no-unguarded-callback-invocation';
    const lint = (source, rules = [operation]) => new Linter().verify(source, {
        plugins: { resilient: plugin }, rules: Object.fromEntries(rules.map(rule => [rule, 'error']))
    });
    const checkOrder = (source) => {
        const analysis = createAnalysis({ source });
        const queries = queriesFor(analysis);
        const expected = queries.map(query => queryAnalysis(analysis, query));
        const reverse = createAnalysis({ source });

        queries.toReversed().forEach(query => queryAnalysis(reverse, query));
        deepStrictEqual(queries.map(query => queryAnalysis(reverse, query)), expected);
        deepStrictEqual(queries.map(query => queryAnalysis(analysis, query)), expected);
    };

    ['box.item', 'box[0]'].forEach(path => [false, true].forEach(early => [false, true].forEach(child => test(`copy lifetime belongs to its source: ${path}, early=${early}, child=${child}`, () => {
        const declaration = path === 'box.item' ? 'const box={item:{name:17,child:{name:17}}};' : 'const box=[{name:17,child:{name:17}}];';
        const reader = `const get=()=>${path}${child ? '.child' : ''}.name;`;
        const source = declaration + (early ? reader : '') + `const copy={...${path}};touch(copy.child);`
                + (early ? '' : reader) + 'const run=()=>get().trim();run();';
        const execute = () => runInNewContext('const touch=value=>{value.name="ready";};' + source);

        if (child) strictEqual(execute(), 'ready');

        if (!child) throws(execute, ({ name = '' } = {}) => name === 'TypeError');

        deepStrictEqual(lint(source).map(({ ruleId = '' } = {}) => ruleId), child ? [] : [operation]);
        checkOrder(source);
    })
    )));

    [
        'const copy={...box.item};touch(box.item);',
        'touch(box.item);const copy={...box.item};',
        'const alias=box;touch(alias.item);const copy={...box.item};',
        'const getter={get value(){box.item.name="ready";return 0;}};const copy={...box.item,...getter};',
        'const change=()=>{box.item.name="ready";return 0;};const copy={...box.item,value:change()};'
    ].forEach(effect => test(`copy cannot waive an earlier escape or Get effect: ${effect}`, () => {
        const source = 'const box={item:{name:17,child:{name:17}}};' + effect + 'const get=()=>box.item.name;const run=()=>get().trim();run();';

        strictEqual(runInNewContext('const touch=value=>{value.name="ready";};' + source), 'ready');
        deepStrictEqual(lint(source), []);
        checkOrder(source);
    }));

    [
        'const copy={...box.item};const box={item:{name:17}};',
        'const box={item:{name:17}};const copy={...alias.item};const alias=box;'
    ].forEach(prefix => test(`copy retains initialization ordering: ${prefix}`, () => {
        const source = prefix + 'const get=()=>copy.name;const run=()=>get().trim();run();';

        throws(() => runInNewContext(source), ({ name = '' } = {}) => name === 'ReferenceError');
        deepStrictEqual(lint(source), []);
        checkOrder(source);
    }));

    ['produce.call(null)', 'produce.apply(null,[])', 'alias.call(null)', 'alias.apply(null,[])'].forEach(body => test(`captured native protocol: ${body}`, () => {
        const source = 'const read=(enabled=false)=>{const first=()=>42;const second=()=>"ok";const produce=enabled?first:second;'
            + `const alias=produce;const wrap=()=>${body};return wrap();};read(true).trim();`;
        const valid = source.replace('read(true)', 'read(false)');

        deepStrictEqual(lint(source).map(({ ruleId = '' } = {}) => ruleId), [operation]);
        throws(() => runInNewContext(source), ({ name = '' } = {}) => name === 'TypeError');
        deepStrictEqual(lint(valid), []);
        strictEqual(runInNewContext(valid), 'ok');
        checkOrder(source);
        checkOrder(valid);
    }));

    [
        'produce.call=()=>"ok";', 'alias.call=()=>"ok";',
        'external(produce);', 'external(alias);',
        'Object.setPrototypeOf(produce,{call:()=>"ok"});'
    ].forEach(effect => test(`captured protocol invalidation: ${effect}`, () => {
        const source = `const read=(enabled=false)=>{const first=()=>42;const second=()=>7;const produce=enabled?first:second;`
            + `const alias=produce;const wrap=()=>produce.call(null);${effect}return wrap();};read(true).trim();`;

        strictEqual(runInNewContext('const external=value=>{value.call=()=>"ok";};' + source), 'ok');
        deepStrictEqual(lint(source), []);
        checkOrder(source);
    }));

    [
        'const read=()=>value;return read();',
        'const read=()=>value;const alias=read;return alias();',
        'const alias=value;const read=()=>alias;return read();',
        'const read=()=>value;const first=read();return read();'
    ].forEach(body => [false, true].forEach(valid => test(`invocation-owned returned record: ${body}, valid=${valid}`, () => {
        const source = `const normalize=value=>{${body}};normalize({name:${valid ? '"ok"' : '42'}}).name.trim();`;

        deepStrictEqual(lint(source).map(({ ruleId = '' } = {}) => ruleId), valid ? [] : [operation]);

        if (valid) strictEqual(runInNewContext(source), 'ok');

        if (!valid) throws(() => runInNewContext(source), ({ name = '' } = {}) => name === 'TypeError');

        checkOrder(source);
    })));

    [
        'const result=read();value.name="ok";return result;',
        'const alias=forwarded;const result=read();alias.name="ok";return result;',
        'const result=read();external(value);return result;',
        'external(forwarded);return read();'
    ].forEach(body => test(`returned record lifetime invalidation: ${body}`, () => {
        const source = `const normalize=(value,forwarded=value)=>{const read=()=>forwarded;${body}};normalize({name:42}).name.trim();`;

        strictEqual(runInNewContext('const external=value=>{value.name="ok";};' + source), 'ok');
        deepStrictEqual(lint(source), []);
        checkOrder(source);
    }));

    [
        ['const read=()=>cb;if(typeof cb!=="function")return;read()();', false],
        ['const read=()=>cb();if(typeof cb!=="function")return;read();', false],
        ['const read=()=>cb;const alias=read;if(typeof cb!=="function")return;alias()();read()();', false],
        ['const read=()=>cb;read()();if(typeof cb!=="function")return;read()();', true],
        ['const read=()=>cb;if(typeof cb!=="function")return;external(read);read()();', true],
        ['const read=()=>cb;if(typeof cb!=="function")return;cb=42;read()();', true],
        ['if(false)cb();if(typeof cb==="function")cb();', true]
    ].forEach(([body = '', required = false] = []) => test(`captured guard ownership: ${body}`, () => {
        const source = `const run=({cb}={})=>{${body}};`;
        const analysis = createAnalysis({ source });
        const selected = analysis.declarations.find(({ name = '' } = {}) => name === 'cb');

        strictEqual(analysis.checkDeclaration(selected).required, required);
        strictEqual(lint(source, [defaults]).filter(({ ruleId = '' } = {}) => ruleId === defaults).length, Number(required));

        if (!required) {
            runInNewContext(`${source}run();run({cb:42});run({cb:()=>0});`);
            deepStrictEqual(lint(source, [invocation]), []);
        }

        checkOrder(source);
    }));

    ['cb()', 'cb'].forEach(returned => test(`an unsupported path cannot certify every captured invocation: ${returned}`, () => {
        const suffix = returned === 'cb' ? '()' : '';
        const source = `const run=({cb}={})=>{const read=()=>${returned};if(typeof cb==="function")read()${suffix};switch(external){case 1:read()${suffix};}};`;

        strictEqual(lint(source, [defaults]).length, 1);
        throws(() => runInNewContext(source + 'run();', { external: 1 }), ({ name = '' } = {}) => name === 'TypeError');
        checkOrder(source);
    }));

    ['call(null)', 'apply(null,[])'].forEach(method => test(`closed conditional callables preserve native ${method}`, () => {
        const source = `const produce=flag?(()=>42):(()=>"ok");const wrap=()=>produce.${method};wrap().trim();`;

        strictEqual(lint(source).length, 1);
        throws(() => runInNewContext(source, { flag: true }), ({ name = '' } = {}) => name === 'TypeError');
        strictEqual(runInNewContext(source, { flag: false }), 'ok');
        checkOrder(source);
    }));

    ['call', 'apply'].forEach(method => [false, true].forEach(alias => ['before', 'after', 'both'].forEach(timing => test(
        `captured protocol cannot recover another execution's escape: ${method}, alias=${alias}, ${timing}`, () => {
            const target = alias ? 'alias' : 'produce';
            const effect = `external(${target});`;
            const source = `const produce=()=>42;const alias=produce;${timing !== 'after' ? effect : ''}`
                + `const read=()=>${target}.${method}({},${method === 'apply' ? '[]' : ''});${timing !== 'before' ? effect : ''}read().trim();`;

            strictEqual(runInNewContext(`const external=value=>{value.${method}=()=>"ok";};${source}`), 'ok');
            deepStrictEqual(lint(source), []);
            checkOrder(source);
        }
    ))));

    [
        'external(value);const read=()=>value;return read();',
        'const read=()=>value;external(value);return read();',
        'external(value);const read=()=>value.name;return {name:read()};',
        'const alias=value;external(alias);const read=()=>value;return read();'
    ].forEach(body => test(`borrowed capture cannot recover another execution's escape: ${body}`, () => {
        const source = `const normalize=value=>{${body}};normalize({name:42}).name.trim();`;

        strictEqual(runInNewContext(`const external=value=>{value.name="ok";};${source}`), 'ok');
        deepStrictEqual(lint(source), []);
        checkOrder(source);
    }));

    test('a foreign escape before captured native lookup remains retired through a barrel', () => {
        const source = 'import {read} from "barrel";read().trim();';
        const modules = { barrel: 'export {read} from "worker";', worker: 'const produce=()=>42;external(produce);export const read=()=>produce.call({});' };
        const options = { source, filename: 'main', resolveModule: ({ source = '' } = {}) => ({ filename: source, source: Reflect.get(modules, source) }) };
        const analysis = createAnalysis(options);
        const selected = analysis.memberAccesses.find(({ name = '' } = {}) => name === 'trim');
        const queries = queriesFor(analysis);
        const expected = queries.map(query => queryAnalysis(analysis, query));
        const reverse = createAnalysis(options);

        deepStrictEqual(analysis.checkMemberAccess(selected).conflicts, []);
        queries.toReversed().forEach(query => queryAnalysis(reverse, query));
        deepStrictEqual(queries.map(query => queryAnalysis(reverse, query)), expected);
    });
}

{
    const rules = Object.fromEntries(['property', 'operation', 'destructuring', 'call-site', 'return-consistency']
        .map(name => [`resilient/signature-contract-${name}`, 'error']));
    const lint = source => new Linter().verify(source, [{ plugins: { resilient: plugin }, rules }]);
    const members = (analysis, reverse = false) => {
        const { memberAccesses = [] } = analysis;
        const selected = reverse ? memberAccesses.toReversed() : memberAccesses;

        return selected.map(({ index = -1, name = '', location = {} } = {}) => ({ name, location, ...analysis.checkMemberAccess({ index }) }))
            .toSorted(({ location: { column: left = 0 } = {} } = {}, { location: { column: right = 0 } = {} } = {}) => left - right);
    };

    [
        ['later return', 'return value;'],
        ['later transfer', 'external(value);'],
        ['repeated predicate', 'Array.isArray(value);'],
        ['opposite predicate', 'if(!Array.isArray(value))external();'],
        ['same predicate', 'if(Array.isArray(value))external();']
    ].forEach(([name = '', later = ''] = []) => {
        ['value=undefined', '{value=undefined}={}'].forEach((parameter) => {
            test(`lifetime observation preserves array guard with ${name} and ${parameter}`, () => {
                const source = `const run=(${parameter})=>{if(Array.isArray(value))value.forEach(item=>item);${later}};`;
                const analysis = createAnalysis({ source });

                deepStrictEqual(lint(source), []);
                const expected = members(analysis);
                const { counts: before = {} } = analysis;

                deepStrictEqual(members(analysis, true), expected);
                const { counts: after = {} } = analysis;

                deepStrictEqual(after, before);
                deepStrictEqual(members(createAnalysis({ source }), true), expected);
            });
        });
    });

    [
        ['function', 'false', 'call(null)'],
        ['string', 'undefined', 'trim()']
    ].forEach(([family = '', fallback = '', operation = ''] = []) => {
        test(`later transfer preserves an earlier ${family} guard`, () => {
            const source = `const run=(value=${fallback})=>{if(typeof value==='${family}')value.${operation};external(value);};`;

            deepStrictEqual(lint(source), []);
        });
    });

    [
        ['conditional return', 'if(flag)observe(record);', true],
        ['unconditional return', 'observe(record);', true],
        ['unreached pure call', 'if(false)observe(record);', true],
        ['unreached external call', 'if(false)external(record);', true],
        ['reached external call', 'external(record);', false],
        // The path that skips the call still owns the concrete missing field.
        ['conditional external call', 'if(flag)external(record);', true],
        ['ordered chain', 'observe(record);if(flag)observe(record);', true],
        ['external after pure', 'observe(record);external(record);', false],
        ['pure after external', 'external(record);observe(record);', false],
        ['computed key', 'external[external(record)];', false],
        ['tagged expression', 'tag`${external(record)}`;', false],
        ['template expression', '`${external(record)}`;', false],
        ['loop', 'while(flag)external(record);', false],
        ['switch', 'switch(flag){case 1:external(record);}', false],
        ['optional call', 'external?.(record);', false],
        ['caught call', 'try{external(record);}catch(error){}', false],
        ['mutation', 'const change=value=>{value.missing=1;return true;};change(record);', false],
        ['returned alias', 'const expose=value=>value;expose(record);', false]
    ].forEach(([name = '', preceding = '', expected = false] = []) => {
        test(`lifetime observation retains ${name} ownership`, () => {
            const source = `const observe=value=>true;const record={kept:1};${preceding}record.missing;`;
            const findings = lint(source).filter(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-property');

            strictEqual(findings.length, Number(expected));
            const analysis = createAnalysis({ source });
            const { index = -1 } = analysis.memberAccesses.find(({ name = '' } = {}) => name === 'missing');

            strictEqual(analysis.checkMemberAccess({ index }).missing, expected);
        });
    });

    test('conditional effects retire fields only on the path that reaches the call', () => {
        ['if(chosen)', 'if(!chosen)', ''].forEach((selection, index) => {
            const source = `const record={kept:1};const chosen=external;`
                + `if(chosen)opaque(record);${selection}record.missing;`;
            const findings = lint(source).filter(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-property');

            strictEqual(findings.length, Number(index > 0));
        });
    });

    test('a subsequent read cannot execute an unreachable call or publish its call obligation', () => {
        const source = 'const consume=(value=[])=>true;const record={kept:1};if(false)consume(record);record.missing;';
        const findings = lint(source);

        deepStrictEqual(findings.map(({ ruleId = '' } = {}) => ruleId), ['resilient/signature-contract-property']);
    });

    test('later reads preserve actual wrong-family contradictions beside unknown calls', () => {
        const source = 'const run=(value=undefined)=>{if(Array.isArray(value))value.trim();external(value);return value;};';
        const findings = lint(source).filter(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-operation');

        strictEqual(findings.length, 1);
        ok(findings.at(0).message.includes('array-like'));
    });

    test('guarded callback defaults keep their selected evidence when forwarded recursively', () => {
        const source = 'const visit=(node={})=>external(node).forEach(([,value={}])=>{if(Array.isArray(value))value.forEach(item=>visit(item));visit(value);});';

        deepStrictEqual(lint(source), []);
    });

    test('native execution confirms skipped calls, guards, mutation and throwing boundaries', () => {
        const source = 'const run=(value=undefined)=>{if(Array.isArray(value))value.forEach(item=>item);return value;};run(input);';
        const array = [1, 2];

        strictEqual(runInNewContext(source, { input: array }), array);
        strictEqual(typeof runInNewContext(source.replace('run(input)', 'run()')), 'undefined');
        strictEqual(runInNewContext('const record={kept:1};if(false)external(record);record.kept;'), 1);
        const failure = new Error('observer failure');
        const context = { external: () => { throw failure; } };

        throws(() => runInNewContext('const record={};external(record);record.missing;', context), error => error === failure);
        strictEqual(runInNewContext('const record={};const change=value=>{value.missing=1;return true;};change(record);record.missing;'), 1);
    });

    test('interrupted lifetime observation propagates and permits a correct retry', () => {
        const source = 'const observe=value=>true;const record={kept:1};if(flag)observe(record);record.missing;';
        const expected = members(createAnalysis({ source }));
        const analysis = createAnalysis({ source });
        const { index = -1 } = analysis.memberAccesses.at(-1);
        const failure = new Error('lifetime observation failure');

        throws(() => analysis.checkMemberAccess({ index, onWork: () => { throw failure; } }), error => error === failure);
        deepStrictEqual(members(analysis), expected);
    });
}

{
    const shapes = [
        ['record', 'const api={read};', 'api.read'],
        ['alias', 'const api={read};const alias=api;', 'alias.read'],
        ['copy', 'const api={read};const copy={...api};', 'copy.read'],
        ['rest', 'const api={read};const {...copy}=api;', 'copy.read'],
        ['selected callable', 'const api={read};const {read:alias}=api;', 'alias']
    ];
    const routes = [
        ['local', 'const read=value=>value;', ''],
        ['live import', 'import read from "route";', 'export {read as default} from "leaf";'],
        ['snapshot import', 'import read from "route";', 'import {read} from "leaf";export default read;'],
        ['namespace import', 'import *as entry from "route";const read=entry.default;', 'export {read as default} from "leaf";']
    ];
    const observe = observeShared;
    const acquire = (source, route = '', observation = {}) => createAnalysis({ source, filename: 'main', ...observation,
        resolveModule: ({ source = '' } = {}) => ({ filename: source,
            source: source === 'leaf' ? 'export const read=value=>value;' : route }) });

    shapes.forEach(([shape = '', declarations = '', callee = ''] = []) => routes.forEach(([routeName = '', binding = '', route = ''] = []) => (
        test(`standalone lifetime demand preserves query order: ${shape}/${routeName}`, () => {
            const prefix = binding + declarations;
            const expressions = ['42', '"text"', 'true'];
            const families = ['number', 'string', 'boolean'];
            const source = prefix + expressions.map(value => `${callee}(${value});`).join('');
            const requests = expressions.flatMap((value, index) => families.map(required => ({ index, required })));
            const expected = ({ index = -1, required = '' } = {}) => ({ status: required === families.at(index) ? 'agreement' : 'contradiction',
                families: [families.at(index)], incomplete: false });
            const native = 'const read=value=>value;' + declarations + `[${expressions.map(value => `${callee}(${value})`).join(',')}];`;

            deepStrictEqual(JSON.parse(JSON.stringify(runInNewContext(native))), [42, 'text', true]);
            [requests, requests.toReversed(), requests.toSorted(({ required: a = '', index: x = -1 } = {}, { required: b = '', index: y = -1 } = {}) => a.localeCompare(b) || y - x)]
                .forEach((order) => {
                    const analysis = acquire(source, route);

                    strictEqual(analysis.calls.length, 3);
                    order.forEach(request => deepStrictEqual(observe(analysis.checkCallResult(request)), expected(request)));
                    analysis.functions.toReversed().forEach(({ index = -1 } = {}) => analysis.checkFunction({ index }));
                    analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
                    order.toReversed().forEach(request => deepStrictEqual(observe(analysis.checkCallResult(request)), expected(request)));
                });
        })
    )));

    const conflicts = conflictsForShared;
    [
        ['receiver mutation', 'const api={value:42,read(){this.value="ok";return 0;}};api.read();api.value.trim();', [], 'ok'],
        ['escaped return', 'const item={value:42};const api={read:()=>item};const shared=api.read();touch(shared);item.value.trim();', [], 'ok'],
        ['prior failure', 'const api={value:42,read:()=>{throw 7;}};api.read();api.value.trim();', [], 7],
        ['skipped effect', 'const api={value:42,read:()=>{external();return 0;}};if(false){api.read();}api.value.trim();', ['number'], 'TypeError'],
        ['skipped pure call', 'const api={value:42,read:()=>0};if(false){api.read();}api.value.trim();', ['number'], 'TypeError']
    ].forEach(([name = '', source = '', expected = [], native = ''] = []) => test(`standalone lifetime demand preserves ${name}`, () => {
        const result = runInNewContext('const touch=value=>{value.value="ok";};try{' + source + '}catch(error){error.name||error;}');

        strictEqual(result, native);
        [false, true].forEach((callsFirst) => {
            const analysis = createAnalysis({ source });

            if (callsFirst) analysis.calls.forEach(({ index = -1 } = {}) => analysis.checkCallResult({ index, required: 'number' }));

            deepStrictEqual(conflicts(analysis), expected);
        });
        const findings = new Linter().verify(source, { plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-operation': 'error' } });

        strictEqual(findings.length, expected.length);
    }));

    test('standalone lifetime demand retries after predecessor observation interruption', () => {
        const source = 'const api={read:value=>value};api.read(1);api.read(2);api.read(3);';
        const expected = { status: 'agreement', families: ['number'], incomplete: false };

        [1, 3, 7, 12].forEach((cutoff) => {
            const analysis = createAnalysis({ source });
            const failure = new Error('interrupted predecessor demand');
            const work = counter();

            throws(() => analysis.checkCallResult({ index: 2, required: 'number', onWork: (event) => {
                work.onWork(event);

                if (Object.values(work.read()).reduce((sum, count) => sum + count, 0) === cutoff) throw failure;
            } }), error => error === failure);
            deepStrictEqual(observe(analysis.checkCallResult({ index: 2, required: 'number' })), expected);
            deepStrictEqual(observe(analysis.checkCallResult({ index: 2, required: 'number' })), expected);
        });
    });

    test('standalone lifetime predecessor width and depth retain bounded completed work', () => {
        [4, 12].forEach(width => [4, 12].forEach((depth) => {
            const declarations = Array.from({ length: width }, (unused, index) => `const api${index}={read:value=>value};`).join('');
            const calls = Array.from({ length: width }, (unused, index) => Array.from({ length: depth }, (unused, position) => `api${index}.read(${position});`).join('')).join('');
            const source = declarations + calls;
            const work = counter();
            const { onWork } = work;
            const analysis = createAnalysis({ source });

            const check = ({ index = -1 } = {}) => {
                const { status = '' } = analysis.checkCallResult({ index, required: 'number', onWork });

                strictEqual(status, 'agreement');
            };

            analysis.calls.toReversed().forEach(check);
            const { counts: before = {} } = analysis;
            const { values = 0, contexts = 0 } = before;
            const visited = work.read();
            const { judgment = 0, 'validity-check': validity = 0 } = visited;
            const scale = width * depth;

            ok(Object.values(visited).reduce((sum, count) => sum + count, 0) < 150 * scale);
            ok(values < 20 * scale);
            ok(contexts < 3 * scale);
            analysis.calls.forEach(check);
            const { counts: after = {} } = analysis;

            deepStrictEqual(after, before);
            const repeated = work.read();
            const { judgment: repeatedJudgment = 0, 'validity-check': repeatedValidity = 0 } = repeated;

            Object.entries(visited).filter(([kind = ''] = []) => !['judgment', 'validity-check'].includes(kind))
                .forEach(([kind = '', count = 0] = []) => {
                    const { [kind]: actual = 0 } = repeated;

                    strictEqual(actual, count, kind);
                });
            strictEqual(repeatedJudgment, judgment + scale);
            strictEqual(repeatedValidity, validity + scale);
        }));
    });
}

{
    const selections = [
        ['false and', 'false&&expose(api);', true],
        ['true or', 'true||expose(api);', true],
        ['present nullish', '0??expose(api);', true],
        ['true conditional', 'true?api.read(1):expose(api);', true],
        ['false conditional', 'false?expose(api):api.read(1);', true],
        ['nested selection', 'true?(false&&expose(api)):expose(api);', true],
        ['true and', 'true&&expose(api);', false],
        ['false or', 'false||expose(api);', false],
        ['absent nullish', 'null??expose(api);', false],
        ['selected consequent', 'true?expose(api):api.read(1);', false],
        ['selected alternate', 'false?api.read(1):expose(api);', false],
        ['nested exposure', 'false?api.read(1):(true&&expose(api));', false]
    ];
    const carriers = [
        ['record', 'const api={read};'],
        ['alias', 'const original={read};const api=original;'],
        ['copy', 'const original={read};const api={...original};'],
        ['rest', 'const original={read};const {...api}=original;']
    ];
    const routes = [
        ['local', 'const read=value=>value;', ''],
        ['live', 'import read from "route";', 'export {read as default} from "leaf";'],
        ['snapshot', 'import read from "route";', 'import {read} from "leaf";export default read;'],
        ['namespace', 'import *as entry from "route";const read=entry.default;', 'export {read as default} from "leaf";']
    ];
    const acquire = (source, route = '') => createAnalysis({ source, filename: 'main',
        resolveModule: ({ source = '' } = {}) => ({ filename: source,
            source: source === 'leaf' ? 'export const read=value=>value;' : route }) });
    const callIndex = (analysis, source, text) => {
        const { index = -1 } = analysis.calls.find(({ location: { range = [] } = {} } = {}) => source.slice(...range) === text) ?? {};

        return index;
    };
    const summary = observeShared;

    selections.forEach(([name = '', selection = '', preserved = false] = []) => test('expression selection preserves receiver reach: ' + name, () => {
        carriers.forEach(([, holder = ''] = []) => routes.forEach(([, prefix = '', route = ''] = []) => {
            const source = prefix + holder + 'api.read(0);' + selection + 'api.read(42);';
            const make = () => acquire(source, route);
            const index = callIndex(make(), source, 'api.read(42)');
            const expected = { status: preserved ? 'agreement' : 'unknown', families: preserved ? ['number'] : [], incomplete: !preserved };

            ok(index >= 0);
            [false, true].forEach((reverse) => {
                const analysis = make();

                deepStrictEqual(summary(analysis.checkCallResult({ index, required: 'number' })), expected, source);
                analysis.functions.toReversed().forEach(({ index = -1 } = {}) => analysis.checkFunction({ index }));
                const { calls = [] } = analysis;
                const order = reverse ? calls.toReversed() : calls;

                order.forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
                order.forEach(({ index = -1 } = {}) => analysis.checkCallResult({ index, required: 'string' }));
                analysis.memberAccesses.toReversed().forEach(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }));
                deepStrictEqual(summary(analysis.checkCallResult({ index, required: 'number' })), expected, source);
            });
        }));
        const prefix = 'const read=value=>value;const api={read};api.read(0);';
        const native = 'const expose=value=>{value.read=()=>false;};' + prefix + selection + 'api.read(42);';

        strictEqual(runInNewContext(native), preserved ? 42 : false);
        ['42', '"ok"'].forEach((input) => {
            const source = prefix + selection + 'api.read(' + input + ').trim();';
            const messages = new Linter().verify(source, { plugins: { resilient: plugin },
                rules: { 'resilient/signature-contract-operation': 'error' } });

            strictEqual(messages.length, Number(preserved && input === '42'));
            messages.forEach(({ column = 0, endColumn = 0 } = {}) => strictEqual(source.slice(column - 1, endColumn - 1), 'api.read(42).trim'));
        });
    }));

    test('expression selection keeps generic source evidence separate from actual branch inputs', () => {
        ['flag&&expose(api);', 'flag?expose(api):0;', 'flag||expose(api);'].forEach((selection) => {
            const source = 'const run=flag=>{const api={read:value=>value};' + selection + 'return api.read(42);};run(false);run(true);';
            const analysis = acquire(source);
            const generic = analysis.checkFunction({ index: 0 });

            [true, false, true].forEach((input) => {
                const index = callIndex(analysis, source, 'run(' + input + ')');
                const preserved = selection.includes('||') ? input : !input;
                const result = analysis.checkCallResult({ index, required: 'number' });

                deepStrictEqual(summary(result), { status: preserved ? 'agreement' : 'unknown', families: preserved ? ['number'] : [], incomplete: !preserved });
            });
            deepStrictEqual(analysis.checkFunction({ index: 0 }), generic);
        });
    });

    test('expression selection does not execute source calls after an abrupt prefix', () => {
        const source = 'const fail=()=>{throw 7;};const api={read:value=>value};fail();false&&expose(api);api.read(42);';
        const analysis = acquire(source);
        const index = callIndex(analysis, source, 'api.read(42)');

        strictEqual(analysis.checkCallResult({ index, required: 'number' }).status, 'unknown');
        throws(() => runInNewContext(source), error => error === 7);
        deepStrictEqual(new Linter().verify(source + 'api.read(42).trim();', { plugins: { resilient: plugin },
            rules: { 'resilient/signature-contract-operation': 'error' } }), []);
    });

    test('expression selection retries each interrupted reached-flow step', () => {
        const source = 'const api={read:value=>value};api.read(0);false&&expose(api);api.read(42);';
        const baseline = acquire(source);
        const index = callIndex(baseline, source, 'api.read(42)');
        const work = counter();
        const { onWork } = work;
        const expected = baseline.checkCallResult({ index, required: 'number', onWork });
        const steps = Object.values(work.read()).reduce((sum, count) => sum + count, 0);

        Array.from({ length: steps }, (unused, offset) => offset + 1).forEach((cutoff) => {
            const analysis = acquire(source);
            const failure = new Error('interrupted selection flow');
            const visits = counter();

            throws(() => analysis.checkCallResult({ index, required: 'number', onWork: (event) => {
                visits.onWork(event);

                if (Object.values(visits.read()).reduce((sum, count) => sum + count, 0) === cutoff) throw failure;
            } }), error => error === failure);
            analysis.checkCallResult({ index, required: 'string' });
            analysis.functions.forEach(({ index = -1 } = {}) => analysis.checkFunction({ index }));
            deepStrictEqual(analysis.checkCallResult({ index, required: 'number' }), expected);
        });
    });

    test('expression selection bounds independent receiver width and history depth with warm reuse', () => {
        [4, 16].forEach(width => [4, 16].forEach((depth) => {
            const source = Array.from({ length: width }, (unused, receiver) => 'const api' + receiver + '={read:value=>value};'
                + Array.from({ length: depth }, () => 'false&&expose(api' + receiver + ');api' + receiver + '.read(42);').join('')).join('');
            const analysis = acquire(source);
            const selected = analysis.calls.filter(({ location: { range = [] } = {} } = {}) => source.slice(...range).endsWith('.read(42)'));
            const work = counter();
            const { onWork } = work;
            const read = ({ index = -1 } = {}) => strictEqual(analysis.checkCallResult({ index, required: 'number', onWork }).status, 'agreement');

            selected.toReversed().forEach(read);
            const before = work.read();
            const { counts = {} } = analysis;
            const size = width * depth;

            strictEqual(selected.length, size);
            ok(Object.values(before).reduce((sum, count) => sum + count, 0) < 200 * size);
            ['expressions', 'values', 'contexts'].forEach(name => ok(Reflect.get(counts, name) < 80 * size));
            selected.forEach(read);
            const { counts: repeated = {} } = analysis;

            deepStrictEqual(repeated, counts);
            const after = work.read();

            Object.entries(before).filter(([name = ''] = []) => !['judgment', 'validity-check'].includes(name))
                .forEach(([name = '', count = 0] = []) => strictEqual(Reflect.get(after, name), count, name));
        }));
    });

    test('expression selection releases callers while a completed report stays held', () => {
        const code = [
            "import {createAnalysis} from 'eslint-plugin-resilient/analyzer';",
            "import {setImmediate} from 'node:timers/promises';",
            "const make=()=>createAnalysis({source:'const api={read:value=>value};false&&expose(api);api.read(42);'});",
            "const keep=()=>{const analysis=make();return {report:analysis.checkCallResult({index:1,required:'number'}),reference:new WeakRef(analysis)};};",
            'const held=keep();const live=make();',
            'for(let i=0;i<5;i++){await setImmediate();globalThis.gc();}',
            "console.log(JSON.stringify({retained:Boolean(held.reference.deref()),historical:held.report.status,current:live.checkCallResult({index:1,required:'number'}).status}));"
        ].join('\n');
        const result = JSON.parse(execFileSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 30000 }));

        deepStrictEqual(result, { retained: false, historical: 'agreement', current: 'agreement' });
    });
}

{
    const cases = [
        ['native exposure leaves unrelated record evidence', 'const record={kept:0};external(Array);record.missing;', ['missingProperty']],
        ['native observation retains records', 'const record={kept:0};Array.isArray(record);record.missing;', ['missingProperty']],
        ['local methods survive unrelated native exposure', 'const helpers={read:()=>({kept:0})};external(Array);helpers.read().missing;', ['missingProperty']],
        ['native exposure leaves an ordered alias write', 'external(Number);const item={value:[]};const alias=item;alias.value="";item.value.map(x=>x);', ['mismatch']],
        ['intervening effects retire write visibility', 'const item={value:[]};const alias=item;alias.value="";external();item.value.map(x=>x);', []],
        ['native observation preserves a sole transfer', 'const selected={items:""};const holder={selected};const isArray=Array.isArray;isArray(holder);holder.selected.items.map(x=>x);',
            ['mismatch']],
        ['alias mutation retires transferred evidence', 'const selected={items:""};const alias=selected;const holder={selected};alias.items=[];holder.selected.items.map(x=>x);', []],
        ['early closed record capture remains known', 'const h={read:()=>""};const use=()=>h.read().map(x=>x);external(Number);use();', ['mismatch']],
        ['late record initialization stays conservative', 'const use=()=>h.read().map(x=>x);const h={read:()=>""};use();', []]
    ];
    const inspect = analysis => analysis.memberAccesses.map(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }));

    cases.forEach(([name = '', source = '', expected = []] = []) => test(`member boundary composition: ${name}`, () => {
        const findings = new Linter().verify(source, { plugins: { resilient: plugin }, rules: {
            'resilient/signature-contract-property': 'error', 'resilient/signature-contract-operation': 'error'
        } });

        deepStrictEqual(findings.map(({ messageId = '' } = {}) => messageId), expected);
        const first = createAnalysis({ source });
        const judgments = inspect(first);

        ok(judgments.length);
        const second = createAnalysis({ source });

        second.functions.toReversed().forEach(({ index = -1 } = {}) => second.checkFunction({ index }));
        second.memberAccesses.toReversed().forEach(({ index = -1 } = {}) => second.checkMemberAccess({ index }));
        deepStrictEqual(inspect(second), judgments);
        deepStrictEqual(inspect(first), judgments);

        if (expected.length) return;

        const { index = -1 } = first.memberAccesses.find(({ name = '' } = {}) => ['map', 'missing'].includes(name)) ?? {};
        const { incomplete = false } = first.checkMemberAccess({ index });

        strictEqual(incomplete, true);
    }));
}

{
    const cases = JSON.parse(readFileSync(new URL('./fixtures/member-contracts.json', import.meta.url), 'utf8'));
    const lint = new ESLint({ overrideConfigFile: true, overrideConfig: {
        plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-operation': 'error', 'resilient/signature-contract-property': 'error' }
    } });
    const findings = (analysis) => {
        const { memberAccesses = [] } = analysis;
        const evidence = memberAccesses.map(({ index = -1, name = '', call = false } = {}) => ({ name, call, ...analysis.checkMemberAccess({ index }) }));

        return {
            properties: evidence.filter(({ missing = false } = {}) => missing).map(({ name = '' } = {}) => name),
            operations: evidence.filter(({ call = false, conflicts = [] } = {}) => call && Boolean(conflicts.length)).map(({ name = '' } = {}) => name)
        };
    };
    cases.forEach(({ name = '', source = '', properties = [], operations = [] } = {}) => {
        test(`shared member evidence: ${name}`, () => deepStrictEqual(findings(createAnalysis({ source })), { properties, operations }));
        test(`product member rules: ${name}`, async () => {
            const [{ messages = [] } = {}] = await lint.lintText(source);

            deepStrictEqual(messages.filter(({ ruleId = '' } = {}) => ruleId.endsWith('property')).map(({ message = '' } = {}) => message),
                properties.map(property => `Property ${property} does not exist on this known object contract.`));
            strictEqual(messages.filter(({ ruleId = '' } = {}) => ruleId.endsWith('operation')).length, operations.length);
            messages.forEach(({ fix = false, suggestions = [] } = {}) => { strictEqual(fix, false); deepStrictEqual(suggestions, []); });
        });
    });

    test('member queries cannot contaminate a generic callee with either supplied or default values', () => {
        const source = 'const f=(value=[])=>value;f("text").map(Boolean);const run=(value=[])=>value.trim();';
        const first = createAnalysis({ source });
        const second = createAnalysis({ source });
        const before = first.checkFunction({ index: 0 });

        deepStrictEqual(findings(first), findings(second));
        const { status = '' } = before;

        strictEqual(status, 'unknown');
        deepStrictEqual(first.checkFunction({ index: 0 }), before);
        second.memberAccesses.toReversed().forEach(({ index = -1 } = {}) => second.checkMemberAccess({ index }));
        deepStrictEqual(findings(second), findings(first));
        strictEqual(second.checkFunction({ index: 0 }).status, 'unknown');
    });

    test('public member queries validate positions, freeze answers, reuse demand and propagate failures', () => {
        const analysis = createAnalysis({ source: 'const get=()=>({name:1});get().nmae;' });
        const work = counter();
        const result = analysis.checkMemberAccess({ index: 0, onWork: event => work.onWork(event) });
        const demanded = work.get('value-demand');

        const { missing = false, evidence = [], conflicts = [] } = result;
        const { memberAccesses = [] } = analysis;

        ok(missing);
        [memberAccesses, memberAccesses.at(0), result, evidence, conflicts].forEach(value => ok(Object.isFrozen(value)));
        deepStrictEqual(analysis.checkMemberAccess({ index: 0, onWork: event => work.onWork(event) }), result);
        strictEqual(work.get('value-demand'), demanded);
        [-1, 1, NaN, '0'].forEach(index => throws(() => analysis.checkMemberAccess({ index }), RangeError));
        const interrupted = createAnalysis({ source: 'const f=({items=[]}={})=>items.trim();' });

        throws(() => interrupted.checkMemberAccess({ index: 0, onWork: () => { throw new Error('observer failed'); } }), /observer failed/);
        deepStrictEqual(findings(interrupted), findings(createAnalysis({ source: 'const f=({items=[]}={})=>items.trim();' })));
    });

    test('owned member snapshots and source revisions remain independent of host edits', () => {
        const program = parse('({name:1}).nmae;', { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
        const first = createProgramAnalysis({ program });

        // Deliberately mutate the host tree after acquisition.
        runInNewContext('program.body[0].expression.property.name = "name";', { program });
        strictEqual(first.checkMemberAccess({ index: 0 }).missing, true);
        const second = createAnalysis({ source: '({name:1}).name;' });

        strictEqual(second.checkMemberAccess({ index: 0 }).missing, false);
        strictEqual(first.checkMemberAccess({ index: 0 }).missing, true);
    });

    test('interrupted member proofs resume without publishing a partial contradiction', () => {
        const source = 'const run=({items=[]}={})=>items.trim();';
        const expected = findings(createAnalysis({ source }));

        const work = counter();

        createAnalysis({ source }).checkMemberAccess({ index: 0, onWork: event => work.onWork(event) });
        Object.keys(work.read()).forEach((interrupted) => {
            const analysis = createAnalysis({ source });

            throws(() => analysis.checkMemberAccess({ index: 0, onWork: ({ kind = '' } = {}) => {
                if (kind === interrupted) throw new Error(`interrupted ${kind}`);
            } }), /interrupted/);
            deepStrictEqual(findings(analysis), expected);
        });
    });

    test('native execution agrees with mixed-family guard selection and its contradictory counterpart', () => {
        const good = 'const x=flag?[]:"";const text=typeof x==="string";if(text)x.trim();"complete";';
        const bad = 'const x=flag?[]:"";if(typeof x==="string")x.map(Boolean);';

        [true, false].forEach(flag => strictEqual(runInNewContext(good, { flag }), 'complete'));
        throws(() => runInNewContext(bad, { flag: false }), /is not a function/);
        deepStrictEqual(findings(createAnalysis({ source: good })), { properties: [], operations: [] });
        deepStrictEqual(findings(createAnalysis({ source: bad })), { properties: [], operations: ['map'] });
    });

    test('reflective reads preserve native agreement beside unknown results', () => {
        const source = [
            'const { get, ownKeys } = Reflect;',
            'const names=Object.getOwnPropertyNames;',
            'const lookup=Reflect[key];',
            'const { [key]: chosen, ...methods }=Reflect;',
            'const selected=get(external,"name");',
            'selected.trim();',
            'ownKeys(external);',
            'names(external);',
            'const count=42;',
            'configure();',
            'Object.getOwnPropertyDescriptors(external);',
            'count.trim();',
            'count.toFixed();'
        ].join('\n');
        const config = { plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-operation': 'error' } };
        const messages = new Linter().verify(source, config);

        deepStrictEqual(messages.map(({ line = 0 } = {}) => line), [12]);
        const first = createAnalysis({ source });
        const work = counter();
        const forward = first.memberAccesses.map(({ index = -1 } = {}) => first.checkMemberAccess({ index, onWork: event => work.onWork(event) }));
        const demanded = work.get('value-demand');

        first.memberAccesses.toReversed().forEach(({ index = -1 } = {}) => first.checkMemberAccess({ index, onWork: event => work.onWork(event) }));
        strictEqual(work.get('value-demand'), demanded);
        const second = createAnalysis({ source });

        second.memberAccesses.toReversed().forEach(({ index = -1 } = {}) => second.checkMemberAccess({ index }));
        deepStrictEqual(second.memberAccesses.map(({ index = -1 } = {}) => second.checkMemberAccess({ index })), forward);
        const corrected = source.replace('count.trim();', 'count.toFixed();');

        deepStrictEqual(findings(createAnalysis({ source: corrected })), { properties: [], operations: [] });
        const context = () => ({ external: { name: '' }, key: 'get', configure: () => false });

        throws(() => runInNewContext(source, context()), /trim is not a function/);
        strictEqual(runInNewContext(corrected, context()), '42');

        const dynamic = 'const set=Reflect.set;const written={value:42};set(written,"value","set");'
            + 'const state={value:42};const value={__proto__:{trim:()=>"custom"}};'
            + 'const input={get field(){state.value="ok";return 1;}};Reflect.get(input,"field");'
            + 'state.value.trim()+value.trim()+written.value.trim();';

        strictEqual(runInNewContext(dynamic), 'okcustomset');
        deepStrictEqual(findings(createAnalysis({ source: dynamic })), { properties: [], operations: [] });
    });
}
