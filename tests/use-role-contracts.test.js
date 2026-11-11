import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

const guard = 'const isFunction=value=>typeof value==="function";';
const configuration = { plugins: { resilient: plugin }, rules: {
    'resilient/prefer-safe-destructuring-defaults': 'error', 'resilient/no-unguarded-callback-invocation': 'error',
    'resilient/signature-contract-destructuring': 'error'
} };
const lint = source => new Linter().verify(guard + source, configuration);
const analyze = source => createAnalysis({ source: guard + source });
const declarationFor = (analysis, name = 'func') => analysis.declarations.find(({ name: selected = '' } = {}) => selected === name) || {};
const requiredFor = (source, name = 'func') => {
    const analysis = analyze(source);
    const { index = -1 } = declarationFor(analysis, name);

    return analysis.checkDeclaration({ index }).required;
};
const executions = [
    ['direct', body => `const run=({func}={})=>{${body}};`, 'run(input)'],
    ['captured', body => `const run=({func}={})=>()=>{${body}};`, 'run(input)()'],
    ['nested capture', body => `const run=({func}={})=>()=>()=>{${body}};`, 'run(input)()()']
];
const methods = ['every', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flatMap', 'forEach', 'map', 'reduce', 'reduceRight',
    'some', 'sort', 'toSorted'];

executions.forEach(([execution = '', make = () => '', invoke = ''] = []) => methods.forEach((method) => {
    test(`collection role survives ${execution} execution: ${method}`, () => {
        const present = make(`if(func)[1,2].${method}(func);`);
        const callable = make(`if(isFunction(func))[1,2].${method}(func);`);

        strictEqual(requiredFor(present), true);
        strictEqual(requiredFor(callable), false);
        strictEqual(lint(present).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true);
        deepStrictEqual(lint(callable), []);
        throws(() => runInNewContext(`${present}const input={func:42};${invoke};`), ({ name = '' } = {}) => name === 'TypeError');
        runInNewContext(`${guard}${callable}const input={func:42};${invoke};`);
        strictEqual(runInNewContext(`${guard}${callable}let called=false;const input={func:()=>{called=true;return true;}};${invoke};called;`), true);
    });
}));

executions.forEach(([execution = '', make = () => ''] = []) => {
    test(`ordinary forwarding needs presence in ${execution} execution`, () => {
        const source = make('if(func)external(func);if(isFunction(func))func();');

        strictEqual(requiredFor(source), false);
        deepStrictEqual(lint(source), []);
        strictEqual(requiredFor(make('external(func);if(isFunction(func))func();')), true);
        strictEqual(requiredFor(make('if(other)external(func);if(isFunction(func))func();')), true);
        strictEqual(requiredFor(make('if(func)[1].map(func);if(isFunction(func))func();')), true);
        strictEqual(requiredFor(make('if(func)external(func);if(isFunction(func))func();return func.length;')), true);
    });
});

const loops = [
    ['while', body => `while(more()){${body}}`],
    ['for', body => `for(;more();){${body}}`],
    ['for-of', body => `for(const entry of entries){${body}}`]
];
executions.forEach(([execution = '', make = () => ''] = []) => loops.forEach(([loop = '', repeat = () => ''] = []) => {
    test(`data and invocation share their local ${loop} region in ${execution} execution`, () => {
        const source = make(repeat('if(isFunction(func)){func.length;func();}'));
        const analysis = analyze(source);
        const { index = -1 } = declarationFor(analysis);
        const work = counter();
        const { onWork = () => {} } = work;

        strictEqual(analysis.checkDeclaration({ index, onWork }).required, false);
        const before = work.read();

        deepStrictEqual(lint(source), []);
        analysis.invocations.filter(({ name = '' } = {}) => name === 'func').toReversed()
            .forEach(({ index = -1 } = {}) => strictEqual(analysis.checkInvocation({ index }).status, 'agreement'));
        strictEqual(analysis.checkDeclaration({ index, onWork }).required, false);
        deepStrictEqual(work.read(), before);
        const { index: model = -1 } = analysis.functions.at(-1);

        strictEqual(analysis.checkFunction({ index: model }).status, 'unknown');
        strictEqual(requiredFor(make(repeat('if(isFunction(func))func();func.length;'))), true);
        strictEqual(requiredFor(make(repeat('if(isFunction(other)){func.length;func();}'))), true);
        strictEqual(requiredFor(make(repeat('if(isFunction(func)){func=external;func.length;func();}'))), true);
    });
}));

test('the reported onDone loop and value forwarding use the same contracts', () => {
    const loop = 'const run=({onDone}={})=>{while(more()){if(isFunction(onDone)){onDone.length;onDone();}}};';
    const forwarding = 'const run=({value})=>{if(value)external(value);if(isFunction(value))value();};';

    strictEqual(requiredFor(loop, 'onDone'), false);
    strictEqual(requiredFor(forwarding, 'value'), false);
    deepStrictEqual(lint(loop), []);
    deepStrictEqual(lint(forwarding), []);
});

test('trailing arguments do not turn comparators into ordinary data forwarding', () => {
    ['sort', 'toSorted'].forEach((method) => {
        const make = body => `const run=({func}={})=>()=>{${body}};`;

        strictEqual(requiredFor(make(`if(func)[1].${method}(func,extra);`)), true);
        strictEqual(requiredFor(make(`if(isFunction(func))[1].${method}(func,extra);`)), false);
    });
});

test('presence forwards truthy noncallables while collection callbacks require isFunction', () => {
    const execute = runInNewContext(`${guard}(input,external)=>{
        const {func}=input;
        if(func)external(func);
        if(isFunction(func))func();
    }`);
    const observations = counter();
    const observe = value => observations.increment(typeof value);

    [null, false, 0, ''].forEach(func => execute({ func }, observe));
    execute({}, observe);
    strictEqual(observations.get('number'), 0);
    execute({ func: 42 }, observe);
    strictEqual(observations.get('number'), 1);
    execute({ func: () => observations.increment('called') }, observe);
    strictEqual(observations.get('function'), 1);
    strictEqual(observations.get('called'), 1);
    throws(() => runInNewContext('const run=({func})=>()=>{if(func)[1].map(func);};run({func:42})();'), ({ name = '' } = {}) => name === 'TypeError');
    deepStrictEqual(Array.from(runInNewContext(`${guard}const run=({func})=>()=>isFunction(func)?[1].map(func):[];run({func:42})();`)), []);
});

test('region and callback evidence is isolated across source revisions and query orders', () => {
    const source = 'const run=({func}={})=>()=>{while(more()){if(isFunction(func)){func.length;[1].map(func);func();}}};';
    const first = analyze(source);
    const second = analyze(source);
    const { index = -1 } = declarationFor(first);
    const expected = first.checkDeclaration({ index });
    const { required = true } = expected;

    second.invocations.toReversed().forEach(({ index = -1 } = {}) => second.checkInvocation({ index }));
    deepStrictEqual(second.checkDeclaration({ index }), expected);
    strictEqual(required, false);
    strictEqual(requiredFor(source.replace('isFunction(func)', 'func')), true);
    deepStrictEqual(first.checkDeclaration({ index }), expected);
});

test('the shipped isFunction guard composes with captured loop data, forwarding and callbacks', () => {
    const helper = fileURLToPath(import.meta.resolve('eslint-plugin-resilient/standard/function'));
    const filename = fileURLToPath(import.meta.url);
    const source = 'import {isFunction} from "eslint-plugin-resilient/standard/function";'
        + 'const run=({func}={})=>()=>{while(more()){if(func)external(func);'
        + 'if(isFunction(func)){func.length;[1].map(func);func();}}};';
    const resolver = () => helper;
    const analysis = createAnalysis({ source, filename, resolveModule: () => ({ filename: helper, source: readFileSync(helper, 'utf8') }) });
    const { index = -1 } = declarationFor(analysis);

    strictEqual(analysis.checkDeclaration({ index }).required, false);
    deepStrictEqual(new Linter().verify(source, { ...configuration, settings: { resilient: { resolver } } }, { filename }), []);
});

test('a helper name cannot supply the callback proof of isFunction', () => {
    const analysis = createAnalysis({ source: 'const isFunction=value=>true;const run=({func}={})=>()=>{if(isFunction(func))[1].map(func);};' });
    const { index = -1 } = declarationFor(analysis);

    strictEqual(analysis.checkDeclaration({ index }).required, true);
});

test('a guarded invocation cannot discharge another invocation in a different use context', () => {
    const sources = [
        'const run=({func}={},next=func())=>{if(isFunction(func))func();};',
        'const run=({func}={})=>{if(isFunction(func))func();func.call(null);};',
        'const run=({func}={})=>{while(more()){if(isFunction(func))func();func();}};'
    ];

    sources.forEach((source) => {
        strictEqual(requiredFor(source), true, source);
        strictEqual(lint(source).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true, source);
        throws(() => runInNewContext(`${guard}const more=()=>true;${source}run({});`), ({ name = '' } = {}) => name === 'TypeError');
    });
    const reportable = 'const run=({func}={})=>{if(isFunction(func))func();func();};';

    deepStrictEqual(lint(reportable).map(({ messageId = '' } = {}) => messageId), ['unguarded']);
    strictEqual(requiredFor('const run=({func}={})=>{if(isFunction(func)){func();func.call(null);}};'), false);
});

test('a selected argument or callee keeps its callable role when it carries the binding value', () => {
    const callback = '()=>0';
    const uses = [`[1]["map"](func)`, `[1].map(flag?func:${callback})`, `[1].map(func||(${callback}))`,
        '[1].map(...[func])', `(flag?func:${callback})()`, `(flag?func:${callback}).call(null)`, '(0,func)()'];

    uses.forEach((use) => {
        const source = `const run=({func}={})=>{if(func)${use};};`;

        strictEqual(requiredFor(source), true, source);
        throws(() => runInNewContext(`${guard}const flag=true;${source}run({func:42});`), ({ name = '' } = {}) => name === 'TypeError');
    });
    [
        'const run=({func}={})=>{if(isFunction(func))[1]["map"](func);};',
        'const run=({func}={})=>{if(isFunction(func))[1].map(...[func]);};',
        `const run=({func}={})=>{if(func)[1].map(...[${callback},func]);};`,
        `const run=({func}={})=>[1].map(isFunction(func)?func:${callback});`,
        `const run=({func}={})=>[1].map((func&&(${callback}))||(${callback}));`,
        `const run=({func}={})=>{if(func)[1].map(func&&(${callback}));};`
    ].forEach((source) => {
        strictEqual(requiredFor(source), false, source);
        deepStrictEqual(lint(source), []);
    });
});

test('resolved fixed-parameter forwarding carries callable requirements through chains', () => {
    const consumer = 'const consume=callback=>callback();const relay=callback=>consume(callback);';
    const data = 'const forward=payload=>external(payload);';
    const make = body => `const run=({func}={})=>{${body}};`;
    const unsafe = consumer + make('if(func)relay(func);if(isFunction(func))func();');

    strictEqual(requiredFor(unsafe), true);
    throws(() => runInNewContext(`${guard}${unsafe}run({func:42});`), ({ name = '' } = {}) => name === 'TypeError');
    strictEqual(requiredFor(consumer + make('if(func)relay(func);')), true);
    strictEqual(requiredFor(consumer + make('if(func)relay(flag?func:()=>0);')), true);
    strictEqual(requiredFor(consumer + make('if(isFunction(func))relay(func);')), false);
    strictEqual(requiredFor(consumer + make('relay(isFunction(func)?func:()=>0);')), false);
    strictEqual(requiredFor(data + make('if(func)forward(func);if(isFunction(func))func();')), false);
    const leafGuard = 'const consume=callback=>{if(isFunction(callback))callback();};const relay=callback=>consume(callback);';

    strictEqual(requiredFor(leafGuard + make('if(func)relay(func);')), false);
});

test('a forwarded consumer checks local data reads and calls at their own uses', () => {
    const make = body => `const consume=cb=>{${body}};const relay=cb=>consume(cb);`
        + 'const run=({func}={})=>{if(func)relay(func);if(isFunction(func))func();};';
    const safe = [
        'if(typeof cb==="function"){cb.length;cb();}',
        'if(isFunction(cb)){cb.length;cb();}',
        'if(!isFunction(cb))return;cb.length;cb();',
        'if(cb)cb.length;if(isFunction(cb))cb();',
        'if(cb)external(cb);if(isFunction(cb))cb();',
        'if(isFunction(cb))cb();return {...cb};',
        'if(isFunction(cb))cb();return cb||false;',
        'for(const entry of [0]){if(isFunction(cb)){cb.length;cb();}}'
    ];

    safe.forEach((body) => {
        const source = make(body);

        strictEqual(requiredFor(source), false, source);
        deepStrictEqual(lint(source), []);
        strictEqual(runInNewContext(`${guard}const external=value=>value;${source}let calls=0;run({});run({func:null});run({func:42});run({func:()=>calls++});calls;`), 2);
    });
    ['cb.length;if(isFunction(cb))cb();',
        'if(isFunction(cb))cb();else cb.length;', 'if(isFunction(cb)){cb.length;cb();}external(cb);',
        'if(cb)cb.bind(null);if(isFunction(cb))cb();', 'if(cb)cb.length=0;if(isFunction(cb))cb();']
        .forEach(body => strictEqual(requiredFor(make(body)), true, body));
});

test('forwarding preserves constructor and tag invocation requirements', () => {
    const make = body => `const consume=cb=>{${body}};const relay=cb=>consume(cb);const run=({func}={})=>{if(func)relay(func);};`;
    const invocations = ['new cb();', 'cb`tag`;', 'new (flag?cb:function () {})();', '(flag?cb:()=>0)`tag`;'];

    invocations.forEach((invocation) => {
        const unsafe = make(invocation);
        const safe = make(`for(const entry of [0]){if(isFunction(cb)){cb.length;${invocation}}}`);

        strictEqual(requiredFor(unsafe), true, unsafe);
        deepStrictEqual(lint(unsafe).map(({ messageId = '' } = {}) => messageId), ['safeDefault']);
        throws(() => runInNewContext(`${guard}const flag=true;${unsafe}run({func:42});`), ({ name = '' } = {}) => name === 'TypeError');
        strictEqual(requiredFor(safe), false, safe);
        deepStrictEqual(lint(safe), []);
    });
    ['new (isFunction(cb)?cb:function () {})();', '(isFunction(cb)?cb:()=>0)`tag`;']
        .forEach(body => strictEqual(requiredFor(make(body)), false, body));
    ['new func();', 'func`tag`;'].forEach((invocation) => {
        const source = `const run=({func}={})=>{if(isFunction(func))func();${invocation}};`;

        deepStrictEqual(lint(source).map(({ messageId = '' } = {}) => messageId), ['safeDefault']);
    });
});

test('collection callback roles use effective positions through spreads', () => {
    const prefix = 'const flag=true;const args=[];';
    const forms = [
        ['...[],func', true], ['...[...[],func]', true], ['...(flag?[func]:[()=>0])', true],
        ['...args,func', true], ['...(flag?[]:[()=>0]),func', true], ['...((0,[func]))', true],
        ['...[()=>0],func', false], ['...[...[()=>0],func]', false], ['...(flag?[()=>0]:[()=>1]),func', false],
        ['...(flag?[()=>0,func]:[()=>1])', false], ['...([func]&&[()=>0])', false]
    ];

    forms.forEach(([args = '', required = false] = []) => {
        const make = check => `${prefix}const run=({func}={})=>{if(${check})[1].map(${args});};`;
        const truthy = make('func');
        const callable = make('isFunction(func)');

        strictEqual(requiredFor(truthy), required, truthy);
        strictEqual(lint(truthy).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), required, truthy);
        strictEqual(requiredFor(callable), false, callable);
        deepStrictEqual(lint(callable), []);

        if (required) {
            throws(() => runInNewContext(`${truthy}run({func:42});`), ({ name = '' } = {}) => name === 'TypeError');

            return;
        }

        strictEqual(runInNewContext(`${truthy}run({func:42});true;`), true);
    });
    strictEqual(requiredFor('const run=({func}={})=>[1].map(...(isFunction(func)?[func]:[()=>0]));'), false);
    strictEqual(requiredFor('const run=({func}={})=>()=>{while(more()){if(func)[1].map(...[...[],func]);}};'), true);
    strictEqual(requiredFor('const run=({func}={})=>()=>{while(more()){if(isFunction(func))[1].map(...[...[],func]);}};'), false);
});

test('resolved constructors forward effective arguments to fixed formals', () => {
    const prefix = 'function Consume(cb){cb();}function Second(first,cb){cb();}const flag=true;const args=[];';
    const make = body => `${prefix}const run=({func}={})=>{${body}};`;
    [
        'new Consume(func)', 'new Consume(...[func])', 'new Consume(...(flag?[func]:[()=>0]))',
        'new Consume(...args,func)', 'new Second(...[...[],0],func)', 'new (function(cb){cb();})(func)'
    ].forEach((invocation) => {
        const source = make(`if(func)${invocation};`);

        strictEqual(requiredFor(source), true, source);
        deepStrictEqual(lint(source).map(({ messageId = '' } = {}) => messageId), ['safeDefault']);
        throws(() => runInNewContext(`${source}run({func:42});`), ({ name = '' } = {}) => name === 'TypeError');
    });
    ['if(isFunction(func))new Consume(func);', 'if(isFunction(func))new Second(...[0],func);',
        'new Consume(...(isFunction(func)?[func]:[()=>0]));', 'if(func)new Second(...[0,()=>0],func);']
        .forEach((body) => {
            const source = make(body);

            strictEqual(requiredFor(source), false, source);
            deepStrictEqual(lint(source), []);
        });
    const guarded = 'function Consume(cb){if(isFunction(cb))cb();}const run=({func}={})=>new Consume(...[func]);';

    strictEqual(requiredFor(guarded), false);
    deepStrictEqual(lint(guarded), []);
});

test('callable requirements survive relays, packed spreads and selected receivers', () => {
    const scenarios = [
        ['function C(cb){cb();}const relay=cb=>{if(cb)new C(...empty,cb);};', 'relay(func);'],
        ['function C(cb){cb();}const relay=cb=>{if(cb)C(...empty,cb);};', 'relay(func);'],
        ['function C(cb){cb();}function Relay(...args){new C(...args);}', 'new Relay(func);'],
        ['function C(cb=()=>0){cb();}', 'new C(func);'],
        ['function C(cb,{label=""}={}){cb();}', 'new C(func);'],
        ['function C(cb,...tail){cb();}', 'new C(func);'],
        ['function C(cb){()=>{cb=0;};cb();}', 'new C(func);'],
        ['function C(cb){cb();}function Other(cb){}', 'new (flag?C:Other)(func);'],
        ['function C(cb){cb();}function Other(cb){}const Choice=flag?C:Other;', 'new Choice(func);'],
        ['function C(cb){cb();}', 'C.call(null,...[],func);'],
        ['function C(cb){cb();}', 'const packed=[null,func];C.call(...packed);'],
        ['function C(cb){cb();}', 'C.apply(null,[...[],func]);'],
        ['function C(cb){cb();}', 'C.apply(...empty,null,[func]);'],
        ['function C(cb){cb();}', 'C.apply(...[null,[func]]);'],
        ['function C(cb){cb();}', 'const operand=[func];const packed=[null,operand];C.apply(...packed);'],
        ['function tag(parts,cb){cb();}', 'tag`value=${func}`;'],
        ['', 'const packed=[func];const relay=[...packed];[1].map(...relay);'],
        ['function C(cb){cb();}', 'const packed=[func];C.apply(null,packed);'],
        ['', '[1].map.apply([1],[...[],func]);'],
        ['const method="map";', '[1][method](func);'],
        ['function C(cb){if(isFunction(cb))cb();}C.call=(receiver,cb)=>cb();', 'C.call(null,func);'],
        ['const C=cb=>{};C.call=(receiver,cb)=>cb();', 'C.call(null,func);'],
        ['const C=cb=>{};const Alias=C;Alias.apply=(receiver,cb)=>cb();', 'C.apply(null,func);'],
        ['const C=cb=>{};const D=cb=>{};C.call=(receiver,cb)=>cb();', '(flag?C:D).call(null,func);'],
        ['const C=cb=>{};const D=cb=>{};const Choice=flag?C:D;Choice.call=(receiver,cb)=>cb();', 'C.call(null,func);'],
        ['const C={call:(receiver,cb)=>cb()};', 'C.call(null,func);'],
        ['const C={call:(receiver,cb)=>cb()};const D=()=>0;', '(flag?C:D).call(null,func);'],
        ['const C=cb=>{};Object.defineProperty(C,"call",{value:(receiver,cb)=>cb()});', 'C.call(null,func);'],
        ['const C=cb=>{};let Alias=C;Alias.call=(receiver,cb)=>cb();Alias=()=>0;', 'C.call(null,func);'],
        ['const C=cb=>{};', 'C.apply=(receiver,cb)=>cb();C.apply(null,func);'],
        ['function C(cb){cb();}', 'C.call.apply(C,[null,func]);'],
        ['function C(cb){cb();}', 'C.call.call(C,null,func);'],
        ['function C(cb){cb();}const call=C.call;', 'call.call(C,null,func);'],
        ['function C(cb){cb();}', 'C.call.call(func,null);'],
        ['function C(cb){cb();}', 'const packed=[null,func];C.call.apply(C,packed);'],
        ['function C(cb){cb();}', 'C.apply.call(C,null,[func]);'],
        ['function C(cb){cb();}', 'const packed=[C,null,[func]];C.apply.call(...packed);'],
        ['function C(cb){cb();}', 'const packed=[null,[func]];C.apply.apply(C,packed);']
    ];
    const placements = [
        [body => `const run=({func}={})=>{${body}};`, 'run(input)'],
        [body => `const run=({func}={})=>()=>{${body}};`, 'run(input)()'],
        [body => `const run=({func}={})=>{for(const entry of [0]){${body}}};`, 'run(input)']
    ];

    scenarios.forEach(([definitions = '', use = ''] = []) => placements.forEach(([make = () => '', invoke = ''] = []) => {
        const prelude = `const empty=[];const flag=true;${definitions}`;
        const truthy = prelude + make(`if(func){${use}}`);
        const callable = prelude + make(`if(isFunction(func)){${use}}`);

        strictEqual(requiredFor(truthy), true, truthy);
        strictEqual(lint(truthy).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true, truthy);
        throws(() => runInNewContext(`${truthy}const input={func:42};${invoke};`), ({ name = '' } = {}) => name === 'TypeError');
        strictEqual(requiredFor(callable), false, callable);
        deepStrictEqual(lint(callable), [], callable);
    }));
    const initializer = 'const empty=[];function C(cb){cb();}const run=({func}={},next=func&&new C(...empty,func))=>{if(isFunction(func))func();};';

    strictEqual(requiredFor(initializer), true);
    throws(() => runInNewContext(`${guard}${initializer}run({func:42});`), ({ name = '' } = {}) => name === 'TypeError');
});

test('a resolved replacement receives raw arguments without native receiver normalization', () => {
    const source = 'const run=({func})=>{if(func){const C=()=>0;C.apply=(receiver,data)=>!data;return C.apply(null,func);}};';
    const record = 'const C={apply:(receiver,data)=>!data};const run=({func})=>{if(func)return C.apply(null,func);};';

    strictEqual(requiredFor(source), false);
    strictEqual(runInNewContext(`${source}run({func:42});`), false);
    strictEqual(requiredFor(record), false);
    strictEqual(runInNewContext(`${record}run({func:42});`), false);
});

[
    ['Object.assign', 'const C=payload=>{};Object.assign(C,{call:(receiver,cb)=>cb()});', 'C.call(null,func)'],
    ['an escaped alias', 'const C=payload=>{};const alias=C;const install=target=>{target.apply=(receiver,cb)=>cb();};install(alias);', 'C.apply(null,func)'],
    ['a mutating predicate', 'const C=payload=>{};const inspect=target=>{Object.assign(target,{call:(receiver,cb)=>cb()});'
        + 'return typeof target==="function";};inspect(C);', 'C.call(null,func)'],
    ['a selected receiver', 'const C=payload=>{};const Other=payload=>{};const target=flag?C:Other;Object.assign(C,{call:(receiver,cb)=>cb()});', 'target.call(null,func)'],
    ['a stored receiver', 'const C=payload=>{};const holder={C};Object.assign(holder.C,{call:(receiver,cb)=>cb()});', 'C.call(null,func)']
].forEach(([name = '', setup = '', call = ''] = []) => test(`receiver escape through ${name} retains callable requirements`, () => {
    const make = condition => `const flag=true;${setup}const run=({func})=>{if(${condition})return ${call};};`;
    const truthy = make('func');
    const callable = make('isFunction(func)');

    strictEqual(requiredFor(truthy), true);
    strictEqual(lint(truthy).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true);
    throws(() => runInNewContext(`${truthy}run({func:42});`), ({ name = '' } = {}) => name === 'TypeError');
    deepStrictEqual(lint(callable), []);
    runInNewContext(`${guard}${callable}run({func:42});`);
    strictEqual(runInNewContext(`${guard}${callable}run({func:()=>7});`), 7);
}));

test('receiver evidence preserves data-only calls before escape and after a proved replacement', () => {
    const before = 'const run=({func})=>{const C=payload=>!payload;if(func){C.apply(null,[func]);const result=C.call(null,func);'
        + 'Object.assign(C,{call:(receiver,cb)=>cb()});return result;}};';
    const replaced = 'const run=({func})=>{const C=()=>0;if(func){C.call=(receiver,payload)=>!payload;const result=C.call(null,func);'
        + 'Object.assign(C,{call:(receiver,cb)=>cb()});return result;}};';
    const writable = 'const run=({func})=>{const C={call:0};if(func){C.call=(receiver,payload)=>!payload;return C.call(null,func);}};';
    const observed = `${guard}const run=({func})=>{const C=payload=>!payload;if(isFunction(C)&&func)return C.call(null,func);};`;

    [before, replaced, writable].forEach((source) => {
        deepStrictEqual(lint(source), [], source);
        strictEqual(runInNewContext(`${source}run({func:42});`), false);
    });
    deepStrictEqual(new Linter().verify(observed, configuration), []);
    strictEqual(runInNewContext(`${observed}run({func:42});`), false);
});

test('metadata operations and local selections preserve receiver forwarding', () => {
    const selection = 'const C=value=>!value;const D=value=>!value;const pick=flag?C:D;';
    const cases = [
        ['const C=value=>!value;C.label="ready";', 'C'],
        ['const C=value=>!value;Object.keys(C);', 'C'],
        ['const C=value=>!value;Object.assign(C,{label:"ready"});', 'C'],
        ['const C=value=>!value;(Object.assign(C,{label:"ready"}),0);', 'C'],
        ['const C=value=>!value;const publish=value=>{};publish(C);', 'C'],
        [selection, 'pick'],
        [selection + 'Object.keys(pick);Object.assign(pick,{label:"ready"});pick.label="changed";', 'pick']
    ];

    cases.forEach(([setup = '', receiver = 'C'] = []) => {
        const source = `const flag=true;${setup}const run=({func})=>{if(func)return ${receiver}.call(null,func);};`;

        deepStrictEqual(lint(source), [], source);
        strictEqual(runInNewContext(`${source}run({func:42});`), false);
    });

    const assigned = 'const run=({func})=>{const C=()=>0;if(func){Object.assign(C,{label:"ready"});'
        + 'C.call=(receiver,value)=>!value;return C.call(null,func);}};';
    const observed = 'const publish=value=>{};const run=({func})=>{if(typeof func==="function"){publish(func);return func.call(null);}};';
    const analysis = analyze(observed);
    const { invocations = [] } = analysis;
    const { index = -1 } = invocations.find(({ optionalCallback = false } = {}) => optionalCallback) ?? {};

    deepStrictEqual(lint(assigned), []);
    strictEqual(runInNewContext(`${assigned}run({func:42});`), false);
    deepStrictEqual(lint(observed), []);
    strictEqual(analysis.checkInvocation({ index }).status, 'agreement');
    strictEqual(runInNewContext(`${observed}run({func:()=>7});`), 7);
});

test('native observers and local aliases retain possible receiver mutation', () => {
    const cases = [
        'const Original=value=>!value;const C=new Proxy(Original,{ownKeys(target){Object.assign(target,{call:(receiver,cb)=>cb()});'
            + 'return Reflect.ownKeys(target);}});Object.keys(C);',
        'const C=value=>!value;const D=value=>!value;const pick=flag?C:D;const selected=flag?pick:D;Object.assign(selected,{call:(receiver,cb)=>cb()});',
        'const C=value=>!value;const alias=Object.assign(C,{label:"ready"});Object.assign(alias,{call:(receiver,cb)=>cb()});',
        'const C=value=>!value;Object.defineProperty(C,"label",{set(){Object.assign(C,{call:(receiver,cb)=>cb()});}});C.label="ready";'
    ];

    cases.forEach((setup) => {
        const source = `const flag=true;${setup}const run=({func})=>{if(func)return C.call(null,func);};`;

        strictEqual(lint(source).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true, source);
        throws(() => runInNewContext(`${source}run({func:42});`), ({ name = '' } = {}) => name === 'TypeError');
    });
});

test('owned collection-named methods use their actual parameter requirements', () => {
    ['every', 'flatMap', 'reduceRight', 'findIndex', 'findLast', 'findLastIndex'].forEach((name) => {
        const data = `const sink={${name}:payload=>!payload};const alias=sink;const run=({func})=>{if(func)return alias["${name}"](func);};`;
        const shorthand = `const sink={${name}(payload){return !payload;}};const run=({func})=>{if(func)return sink.${name}(func);};`;
        const callback = `const sink={${name}:cb=>cb()};const run=({func})=>{if(func)return sink.${name}(func);};`;
        const observed = `const sink={${name}:payload=>!payload};Object.keys(sink);const run=({func})=>{if(func)return sink.${name}.apply(sink,[func]);};`;

        [data, shorthand, observed].forEach((source) => {
            deepStrictEqual(lint(source), [], source);
            strictEqual(runInNewContext(`${source}run({func:42});`), false);
        });
        strictEqual(lint(callback).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true, callback);
        throws(() => runInNewContext(`${callback}run({func:42});`), ({ name = '' } = {}) => name === 'TypeError');
    });

    const possibleCallbacks = [
        'const sink={every:payload=>!payload};Object.assign(sink.every,{apply:(receiver,cb)=>cb()});'
            + 'const run=({func})=>{if(func)return sink.every.apply(sink,func);};',
        'const sink={get every(){return cb=>cb();}};const run=({func})=>{if(func)return sink.every(func);};',
        'const run=({func},flag)=>{const sink=flag?[1]:{every:payload=>!payload};if(func)return sink.every(func);};'
    ];

    possibleCallbacks.forEach((source) => {
        strictEqual(lint(source).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true, source);
        throws(() => runInNewContext(`${source}run({func:42},true);`), ({ name = '' } = {}) => name === 'TypeError');
    });
});

test('a repeated lookup retains writes from earlier iterations of the same record', () => {
    const record = 'const sink={map:payload=>!payload};';
    const change = 'Object.assign(sink,{map:cb=>cb()});';
    const loops = [
        body => `for(let i=0;i<2;i++){${body}}`,
        body => `let i=0;do{${body}i++;}while(i<2);`,
        body => `for(const item of [1,2]){${body}}`
    ];

    loops.forEach((repeat) => {
        const make = condition => `const run=({func})=>{${record}${repeat(`if(${condition})sink.map(func);${change}`)}};`;
        const truthy = make('func');
        const callable = make('isFunction(func)');
        const fresh = `const run=({func})=>{${repeat(`${record}if(func)sink.map(func);${change}`)}};`;

        strictEqual(requiredFor(truthy), true, truthy);
        strictEqual(lint(truthy).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true);
        throws(() => runInNewContext(`${truthy}run({func:42});`), ({ name = '' } = {}) => name === 'TypeError');
        deepStrictEqual(lint(callable), []);
        runInNewContext(`${guard}${callable}run({func:42});run({func:()=>7});`);
        deepStrictEqual(lint(fresh), []);
        runInNewContext(`${fresh}run({func:42});`);
    });

    const receiver = 'const C=payload=>!payload;';
    const body = 'if(func)C.call(null,func);Object.assign(C,{call:(owner,cb)=>cb()});i++;';
    const reused = `const run=({func})=>{let i=0;${receiver}do{${body}}while(i<2);};`;
    const fresh = `const run=({func})=>{let i=0;do{${receiver}${body}}while(i<2);};`;
    const initialized = `const run=({func})=>{let i=0;for(${record}i<2;i++){if(func)sink.map(func);${change}}};`;
    const reassigned = `const outer=payload=>!payload;const run=({func})=>{let i=0;do{let C=payload=>!payload;C=outer;${body}}while(i<2);};`;
    const extracted = `const outer=payload=>!payload;const run=({func})=>{let i=0;do{const [C]=[outer];${body}}while(i<2);};`;
    const inner = 'for(let j=0;j<2;j++){if(func)sink.map(func);}';
    const nested = `const run=({func})=>{${record}for(let i=0;i<2;i++){${inner}${change}}};`;

    [reused, initialized, reassigned, extracted, nested].forEach((source) => {
        strictEqual(lint(source).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true, source);
        throws(() => runInNewContext(`${source}run({func:42});`), ({ name = '' } = {}) => name === 'TypeError');
    });

    const afterLoop = `const run=({func})=>{${record}${inner}${change}};`;
    const once = `const run=({func})=>{${record}for(let i=func?sink.map(func):0;!i;i++){${change}}};`;
    const forOf = `const run=({func})=>{${record}for(const item of (func?sink.map(func):void 0,[1,2])){${change}}};`;
    const freshOuter = `const run=({func})=>{for(let i=0;i<2;i++){${record}${inner}${change}}};`;

    [fresh, afterLoop, once, forOf, freshOuter].forEach((source) => {
        deepStrictEqual(lint(source), [], source);
        runInNewContext(`${source}run({func:42});`);
    });
});

test('an exported record can be mutated by a peer before its module completes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'resilient-owned-method-'));
    const entry = join(directory, 'entry.js');
    const peer = 'import {sink} from "./entry.js";export function replace(){sink.map=cb=>cb();}';
    const make = condition => `${guard}import {replace} from "./peer.js";export const sink={map:payload=>!payload};`
        + `replace();const {func}=globalThis.input;if(${condition})sink.map(func);`;
    const truthy = make('func');
    const callable = make('isFunction(func)');
    const { execPath = '' } = process;
    const runtime = 'globalThis.input={func:42};await import(process.argv[1]).then(()=>console.log("ok"),error=>console.log(error.name));';
    const run = () => execFileSync(execPath, ['--input-type=module', '-e', runtime, pathToFileURL(entry).href], { encoding: 'utf8' }).trim();
    const check = source => new Linter({ cwd: directory }).verify(source, configuration, { filename: entry });

    try {
        writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
        writeFileSync(join(directory, 'peer.js'), peer);
        writeFileSync(entry, truthy);
        strictEqual(run(), 'TypeError');
        strictEqual(check(truthy).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true);
        writeFileSync(entry, callable);
        strictEqual(run(), 'ok');
        deepStrictEqual(check(callable), []);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('an abrupt loop exit bounds a receiver write to its actual iteration', () => {
    const change = 'sink.map=cb=>cb();';
    const lookup = 'if(func)sink.map(func);';
    const loop = body => `for(let i=0;i<2;i++){${body}}`;
    const sourceFor = body => `const run=({func})=>{const sink={map:payload=>!payload};${body}};`;
    const safe = [
        loop(`${lookup}${change}break;`),
        loop(`${lookup}if(i===0){${change}return;}`),
        loop(`${lookup}{${change}}break;`),
        loop(loop(`${lookup}${change}return;`))
    ];
    const repeats = [
        loop(`${lookup}${change}continue;`),
        loop(`${lookup}${change}if(i===0)continue;break;`),
        loop(`${lookup}switch(i){default:${change}break;}`),
        loop(loop(`${lookup}${change}break;`)),
        `for(let outer=0;outer<2;outer++)${loop(`${lookup}${change}break;`)}`,
        loop(`${lookup}try{${change}return;}finally{if(i===0)continue;}`)
    ];

    safe.map(sourceFor).forEach((source) => {
        deepStrictEqual(lint(source), [], source);
        runInNewContext(`${source}run({func:42});`);
    });
    repeats.map(sourceFor).forEach((source) => {
        strictEqual(lint(source).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true, source);
        throws(() => runInNewContext(`${source}run({func:42});`), ({ name = '' } = {}) => name === 'TypeError');
    });
});

test('an owned method retains a callback requirement through indirect use', () => {
    const cases = [
        ['const target={invoke:cb=>cb()};const sink={map:cb=>target.invoke(cb)};', 'sink.map(func)'],
        ['const target={invoke:cb=>cb()};const sink={map:cb=>{if(cb)target.invoke(cb);}};', 'sink.map(func)'],
        ['const target={get invoke(){return cb=>cb();}};const sink={map:cb=>target.invoke(cb)};', 'sink.map(func)'],
        ['const target={get invoke(){return cb=>cb();}};const sink={map:(first,cb)=>target.invoke(cb)};', 'sink.map(null,func)'],
        ['const target={get invoke(){return cb=>cb();}};const sink={map:(first,cb)=>target.invoke(cb)};', 'sink.map.apply(sink,[null,func])'],
        ['const sink={map:(...items)=>items[0]()};', 'sink.map(func)'],
        ['const sink={map:cb=>[cb][0]()};', 'sink.map.apply(sink,[func])']
    ];

    cases.forEach(([setup = '', use = ''] = []) => {
        const make = condition => `${setup}const run=({func})=>{if(${condition})return ${use};};`;
        const truthy = make('func');
        const callable = make('isFunction(func)');

        strictEqual(requiredFor(truthy), true, truthy);
        strictEqual(lint(truthy).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true, truthy);
        throws(() => runInNewContext(`${truthy}run({func:42});`), ({ name = '' } = {}) => name === 'TypeError');
        deepStrictEqual(lint(callable), [], callable);
        runInNewContext(`${guard}${callable}run({func:42});run({func:()=>7});`);
    });

    const data = 'const read=payload=>!payload;const sink={map:payload=>read(payload)};const run=({func})=>{if(func)return sink.map(func);};';
    const dataMethod = 'const target={read:payload=>!payload};const sink={map:payload=>target.read(payload)};'
        + 'const run=({func})=>{if(func)return sink.map(func);};';
    const internallyGuarded = 'const sink={map:cb=>{if(isFunction(cb))return cb();}};const run=({func})=>{if(func)return sink.map(func);};';
    const guardedMethod = 'const target={invoke:cb=>isFunction(cb)?cb():false};const sink={map:cb=>target.invoke(cb)};'
        + 'const run=({func})=>{if(func)return sink.map(func);};';

    [data, dataMethod, guardedMethod].forEach((source) => {
        deepStrictEqual(lint(source), [], source);
        strictEqual(runInNewContext(`${guard}${source}run({func:42});`), false);
    });
    deepStrictEqual(lint(internallyGuarded), []);
    strictEqual(runInNewContext(`${guard}${internallyGuarded}run({func:42})===void 0;`), true);
});

test('a forwarded result retains its callback role only when the caller can use it', () => {
    const cases = [
        ['const target={pick:(...items)=>items[0]};', 'target.pick(...[],func)'],
        ['const target={pick:(...items)=>items[0]};const prefix=[];', 'target.pick(...prefix,func)'],
        ['const target={pick:items=>items[0]};', 'target.pick([func])'],
        ['const target={pick:(...items)=>items[0]};const relay=cb=>target.pick(cb);', 'relay(func)']
    ];

    cases.forEach(([setup = '', call = ''] = []) => {
        const make = (condition, use) => `${setup}const run=({func})=>{if(${condition})${use};};`;
        const truthy = make('func', `${call}()`);
        const callable = make('isFunction(func)', `${call}()`);
        const discard = make('func', call);

        strictEqual(lint(truthy).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true, truthy);
        throws(() => runInNewContext(`${truthy}run({func:42});`), ({ name = '' } = {}) => name === 'TypeError');
        deepStrictEqual(lint(callable), [], callable);
        runInNewContext(`${guard}${callable}run({func:42});run({func:()=>7});`);
        deepStrictEqual(lint(discard), [], discard);
        runInNewContext(`${discard}run({func:42});`);
    });

    const store = 'const wrap=payload=>({payload});const sink={map:payload=>wrap(payload)};const run=({func})=>{if(func)sink.map(func);};';
    const packed = 'const sink={invoke:items=>items[0]()};const run=({func})=>{if(func)sink.invoke([func]);};';

    deepStrictEqual(lint(store), []);
    runInNewContext(`${store}run({func:42});`);
    strictEqual(lint(packed).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true);
    throws(() => runInNewContext(`${packed}run({func:42});`), ({ name = '' } = {}) => name === 'TypeError');

    const protocol = 'const target={pick:(...items)=>items[0]};const run=({func})=>{if(func)target.pick(func).call(null);};';

    strictEqual(lint(protocol).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true);
    throws(() => runInNewContext(`${protocol}run({func:42});`), ({ name = '' } = {}) => name === 'TypeError');

    const escapes = [
        ['cb=>cb', '()'],
        ['(...items)=>items[0]', '()'],
        ['cb=>({cb})', '.cb()']
    ];

    escapes.forEach(([method = '', invoke = ''] = []) => {
        const make = condition => `const sink={map:${method}};const run=({func})=>{if(${condition})return sink.map(func);};`;
        const truthy = make('func');
        const callable = make('isFunction(func)');

        strictEqual(lint(truthy).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true);
        throws(() => runInNewContext(`${truthy}run({func:42})${invoke};`), ({ name = '' } = {}) => name === 'TypeError');
        deepStrictEqual(lint(callable), []);
        strictEqual(runInNewContext(`${guard}${callable}run({func:()=>7})${invoke};`), 7);
    });
});

test('a setter can intercept a receiver assignment after escape', () => {
    const make = condition => `const run=({func})=>{const C=()=>0;if(${condition}){`
        + 'Object.defineProperty(C,"call",{get:()=>(receiver,cb)=>cb(),set:()=>{}});'
        + 'C.call=(receiver,data)=>!data;return C.call(null,func);}};';
    const truthy = make('func');
    const callable = make('isFunction(func)');

    strictEqual(requiredFor(truthy), true);
    strictEqual(lint(truthy).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true);
    throws(() => runInNewContext(`${truthy}run({func:42});`), ({ name = '' } = {}) => name === 'TypeError');
    deepStrictEqual(lint(callable), []);
    strictEqual(runInNewContext(`${guard}${callable}run({func:()=>7});`), 7);
});

[
    ['an escaping return', 'const pass=value=>value;', 'pass(...prefix,func)()'],
    ['an unresolved downstream call', 'const target={invoke:cb=>cb()};const pass=cb=>target.invoke(cb);', 'pass(...prefix,func)'],
    ['a member write in a default', 'const C=cb=>{};const setup=(init=(C.call=(receiver,cb)=>cb()))=>{};setup();', 'C.call(null,func)'],
    ['a packed apply operand through rest', 'function C(cb){return cb();}function Relay(...args){this.value=C.apply(...args);}', 'new Relay(null,[func]).value'],
    ['a nested literal spread in a packed operand', 'function C(cb){return cb();}function Relay(...args){this.value=C.apply(...args);}',
        'new Relay(null,[...[...[func]]]).value'],
    ['a rest array whose slots can change', 'function C(cb){return cb();}function Relay(...args){args.unshift(null);this.value=C.apply(...args);}',
        'new Relay([func]).value'],
    ['a packed operand through successive relays', 'function C(cb){return cb();}function Relay(...args){this.value=C.apply(...args);}'
        + 'function Outer(...args){this.value=new Relay(...args).value;}', 'new Outer(...prefix,null,[func]).value'],
    ['a fixed parameter carrying the apply arguments', 'function C(cb){return cb();}function Relay(args){this.value=C.apply(...args);}',
        'new Relay([null,[func]]).value'],
    ['a rest relay into a fixed apply argument vector', 'function C(cb){return cb();}function Relay(args){this.value=C.apply(...args);}'
        + 'function Outer(...args){this.value=new Relay(...args).value;}', 'new Outer(...prefix,[null,[func]]).value']
].forEach(([name = '', definitions = '', use = ''] = []) => test(`forwarding retains a callable requirement through ${name}`, () => {
    const make = condition => `${definitions}const run=({func},prefix=[])=>{if(${condition})return ${use};};`;
    const truthy = make('func');
    const callable = make('isFunction(func)');

    strictEqual(requiredFor(truthy), true);
    strictEqual(lint(truthy).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true);
    throws(() => runInNewContext(`${truthy}run({func:42});`), ({ name = '' } = {}) => name === 'TypeError');
    strictEqual(requiredFor(callable), false);
    deepStrictEqual(lint(callable), []);
    strictEqual(runInNewContext(`${guard}${callable}run({func:42})===void 0;`), true);
    strictEqual(runInNewContext(`${guard}${callable}run({func:()=>7});`), 7);
}));

test('a data operand and a packed receiver can pass through an apply relay', () => {
    const data = 'function C(value){return !value;}function Relay(...args){this.value=C.apply(...args);}'
        + 'const run=({func})=>{if(func)return new Relay(null,[func]).value;};';
    const receiver = 'function C(cb){return cb();}function Relay(...args){this.value=C.apply(...args);}'
        + 'const run=({func})=>{if(func)return new Relay([func],[()=>7]).value;};';

    deepStrictEqual(lint(data), []);
    deepStrictEqual(lint(receiver), []);
    strictEqual(runInNewContext(`${data}run({func:42});`), false);
    strictEqual(runInNewContext(`${receiver}run({func:42});`), 7);
});

test('ambiguous forwarding requires callability only when a reachable slot can demand it', () => {
    const dataOnly = [
        'const consume=payload=>!payload;const run=({func},args)=>{if(func)consume(...args,func);};',
        'const consume=payload=>payload+1;const run=({func},args)=>{if(func)consume(...args,func);};',
        'function Consume(first,second){this.value=!first||!second;}const run=({func},args)=>{if(func)new Consume(...args,func);};',
        'const consume=payload=>!payload;const run=({func},args)=>{if(func){const packed=[...args,func];consume(...packed);}};',
        'const consume=payload=>!payload;const run=({func},args)=>{if(func){const packed=[...args,func];consume.apply(null,packed);}};',
        'const consume=payload=>!payload;function Relay(...args){consume(...args);}const run=({func})=>{if(func)new Relay(func);};',
        'const consume=(first,second,callback)=>callback();const run=({func},flag)=>{if(func)consume(...(flag?[]:[0]),func,()=>0,()=>0);};'
    ];

    dataOnly.forEach((source) => {
        strictEqual(requiredFor(source), false, source);
        runInNewContext(`${source}run({func:42},[]);run({func:42},[0]);`);
    });

    const prelude = 'const consume=(data,callback)=>callback();';
    const make = condition => `${prelude}const run=({func},args)=>{if(${condition})consume(...args,func);};`;
    const truthy = make('func');

    strictEqual(requiredFor(truthy), true);
    throws(() => runInNewContext(`${truthy}run({func:42},[0]);`), ({ name = '' } = {}) => name === 'TypeError');
    strictEqual(requiredFor(make('isFunction(func)')), false);
    strictEqual(requiredFor('const run=({func},args)=>{if(func)external(...args,func);};'), true);
});

test('wide formal ranges retain a callable slot only when the argument can reach it', () => {
    const count = 32;
    const callback = 19;
    const formals = Array.from({ length: count }, (entry, index) => `arg${index}`);
    const zeros = Array.from({ length: count }, () => '0');
    const prefix = length => zeros.slice(0, length).join(',');
    const make = (minimum, maximum) => `function Consume(${formals.join(',')}){arg${callback}();}`
        + `const run=({func},flag)=>{if(func)new Consume(...(flag?[${prefix(minimum)}]:[${prefix(maximum)}]),func,${formals.map(() => '()=>0').join(',')});};`;
    const inside = make(5, callback);
    const before = make(5, callback - 1);

    strictEqual(requiredFor(inside), true);
    throws(() => runInNewContext(`${inside}run({func:42},false);`), ({ name = '' } = {}) => name === 'TypeError');
    strictEqual(requiredFor(before), false);
    runInNewContext(`${before}run({func:42},true);run({func:42},false);`);
    strictEqual(requiredFor(make(callback + 1, count)), false);
});

test('constructor data evidence cannot discharge a subsequent unguarded invocation', () => {
    const constructor = 'function Check(cb){return typeof cb==="function";}';
    const source = `${constructor}const run=({func})=>{if(new Check(func))func();};`;

    strictEqual(requiredFor(source), true);
    deepStrictEqual(lint(source).map(({ messageId = '' } = {}) => messageId), ['safeDefault', 'unguarded']);
    throws(() => runInNewContext(`${source}run({func:42});`), ({ name = '' } = {}) => name === 'TypeError');
    strictEqual(requiredFor(`${constructor}const run=({func})=>new Check(func);`), false);
});

test('a guard within a tagged substitution proves the callback at its actual position', () => {
    const source = 'function tag(parts,cb){return cb();}const run=({func})=>tag`value=${isFunction(func)?func:()=>0}`;';

    strictEqual(requiredFor(source), false);
    deepStrictEqual(lint(source), []);
    strictEqual(runInNewContext(`${guard}${source}run({func:42});`), 0);
    strictEqual(runInNewContext(`${guard}${source}run({func:()=>7});`), 7);
});

test('known native array exposure retires positional spread bounds', () => {
    const source = 'Array.prototype[Symbol.iterator]=function*(){yield this[1];};'
        + 'const run=({func}={})=>{if(func)[1].map(...[()=>0,func]);};';

    strictEqual(requiredFor(source), true);
    throws(() => runInNewContext(`${source}run({func:42});`), ({ name = '' } = {}) => name === 'TypeError');
});

test('an open object field still owns a callable obligation', () => {
    const source = 'const run=input=>{const {func}={...input};if(func)[1].map(func);};';

    strictEqual(requiredFor(source), true);
    strictEqual(requiredFor(source.replace('if(func)', 'if(isFunction(func))')), false);
    throws(() => runInNewContext(`${source}run({func:42});`), ({ name = '' } = {}) => name === 'TypeError');
});

test('namespace constructors and successive callee selections carry callable requirements', () => {
    const source = 'import * as api from "dependency";const run=({func})=>{if(func)new api.Consume(func);};';
    const resolveModule = () => ({ filename: 'dependency', source: 'export function Consume(cb){cb();}' });
    const imported = createAnalysis({ source, filename: 'main', resolveModule });

    strictEqual(imported.checkDeclaration(declarationFor(imported)).required, true);
    const definitions = 'function First(cb){if(isFunction(cb))cb();}function Second(cb){if(isFunction(cb))cb();}';
    const choices = Array.from({ length: 24 }, (unused, position) => {
        const previous = position ? `Choice${position - 1}` : 'First';

        return `const Choice${position}=flag?${previous}:Second;`;
    }).join('');
    const selected = `${definitions}${choices}const run=({func})=>{if(func)new Choice23(func);};`;

    strictEqual(requiredFor(selected), false);
    strictEqual(requiredFor(selected.replace('function Second(cb){if(isFunction(cb))cb();}', 'function Second(cb){cb();}')), true);
    strictEqual(requiredFor(`${definitions}const Choice=flag?First:unknown;const run=({func})=>{if(func)new Choice(func);};`), true);
});

test('a guard at a recursive forwarding edge gives the same answer in either query order', () => {
    const source = 'function first(callback){if(flag)return second(callback);}'
        + 'function second(callback){if(isFunction(callback)){if(flag)first(callback);callback();}}'
        + 'const callFirst=({firstCallback})=>first(firstCallback);const callSecond=({secondCallback})=>second(secondCallback);';
    const names = ['firstCallback', 'secondCallback'];

    [names, names.toReversed()].forEach((order) => {
        const analysis = analyze(source);

        order.forEach((name) => {
            const { index = -1 } = declarationFor(analysis, name);

            strictEqual(analysis.checkDeclaration({ index }).required, false, name);
        });
    });
});

test('presence-only loop and data reads use the guard that actually selects them', () => {
    [
        'while(func){func.length;break;}',
        'for(;func;external(func)){break;}',
        'while(more())isFunction(func)&&func.length;',
        'if(isFunction(func))external(func);',
        'if(!isFunction(func)){}else func.length;'
    ].forEach((body) => {
        const source = `const run=({func}={})=>{${body}};`;

        strictEqual(requiredFor(source), false, source);
        deepStrictEqual(lint(source), []);
    });
    ['do{func.length;}while(func);', 'if(!isFunction(func))func.length;', 'if(isFunction(other))func.length;']
        .forEach(body => strictEqual(requiredFor(`const run=({func}={})=>{${body}};`), true));
});
