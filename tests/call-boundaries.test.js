import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const cases = [
    ['declaration owns its signature', 'function read(value=""){return value;} read(42);', 'read', 'contradiction', ['mismatch']],
    ['native count dispatch', 'function read(value,callback){switch(arguments.length){case 1:return value;case 2:return callback(value);}}read(42);', 'read', 'agreement', []],
    ['count dispatch through alias', 'const read=function(value,callback){switch(arguments.length){case 1:return value;}};const alias=read;alias(42);', 'alias', 'agreement', []],
    ['omitted formal read', 'function read(value,callback){switch(arguments.length){case 1:return callback;}}read(42);', 'read', 'contradiction', ['arity']],
    ['omitted formal captured', 'function read(value,callback){switch(arguments.length){case 1:return ()=>callback;}}read(42);', 'read', 'contradiction', ['arity']],
    ['duplicate dispatch cannot supersede first match',
        'function read(value,callback){switch(arguments.length){case 1:return callback;case 1:return value;}}read(42);', 'read', 'contradiction', ['arity']],
    ['shadowed arguments', 'function read(arguments,callback){switch(arguments.length){case 1:return arguments;}}read(42);', 'read', 'contradiction', ['arity'], 'script'],
    ['inherited arguments', 'function outer(){const read=(value,callback)=>{switch(arguments.length){case 1:return value;}};read(42);}', 'read', 'contradiction', ['arity']],
    ['current arguments captured', 'function read(value,callback){switch(arguments.length){case 1:return ()=>arguments.length;}}read(42);', 'read', 'contradiction', ['arity']],
    ['returned regular function owns arguments',
        'function read(value,callback){switch(arguments.length){case 1:return function(){return arguments[0];};}}read(42);', 'read', 'agreement', []],
    ['renamed regular function preserves owner',
        'function choose(first,later){switch(arguments.length){case 1:return function renamed(){return arguments[0];};}}choose(42);', 'choose', 'agreement', []],
    ['returned regular function still captures omitted formal',
        'function read(value,callback){switch(arguments.length){case 1:return function(){return callback(arguments[0]);};}}read(42);', 'read', 'contradiction', ['arity']],
    ['returned regular function may capture supplied formal',
        'function read(value,callback){switch(arguments.length){case 1:return function(){return value(arguments[0]);};}}read(external);', 'read', 'agreement', []],
    ['returned function dynamic lookup may capture omitted formal',
        'function read(value,callback){switch(arguments.length){case 1:return function(){return eval("callback");};}}read(42);', 'read', 'contradiction', ['arity']],
    ['returned arrow dynamic lookup may capture omitted formal',
        'function read(value,callback){switch(arguments.length){case 1:return ()=>eval("callback");}}read(42);', 'read', 'contradiction', ['arity']],
    ['dispatch return dynamic lookup may read omitted formal',
        'function read(value,callback){switch(arguments.length){case 1:return eval("callback");}}read(42);', 'read', 'contradiction', ['arity']],
    ['returned function shadows omitted formal',
        'function read(value,callback){switch(arguments.length){case 1:return function(callback){return callback(arguments[0]);};}}read(42);', 'read', 'agreement', []],
    ['unknown case effect', 'function read(value,callback){switch(arguments.length){case external():return value;case 1:return value;}}read(42);', 'read', 'contradiction', ['arity']],
    ['pre-dispatch effect', 'function read(value,callback){external();switch(arguments.length){case 1:return value;}}read(42);', 'read', 'contradiction', ['arity']],
    ['parameter initialization effect', 'const read=function(value=external(),callback){switch(arguments.length){case 1:return value;}};read(42);', 'read', 'contradiction', ['arity']],
    ['fallthrough dispatch', 'function read(value,callback){switch(arguments.length){case 1:case 2:return value;}}read(42);', 'read', 'contradiction', ['arity']],
    ['hoisted closure dependency', 'function read(value,callback){switch(arguments.length){case 1:return capture;}function capture(){return callback;}}read(42);', 'read', 'contradiction', ['arity']],
    ['nested partial evidence preserves sibling contradiction', 'const read=({config:{name="",[key]:value}={}}={})=>name;read({config:{name:42}});', 'read', 'contradiction', ['mismatch']],
    ['nested unsupported pattern preserves outer contradiction', 'const read=({config:{[key]:value}={}}={})=>value;read({config:42});', 'read', 'contradiction', ['mismatch']],
    ['nested unknown default preserves supplied contradiction', 'const read=({config:{name=""}=external()}={})=>name;read({config:{name:42}});', 'read', 'contradiction', ['mismatch']],
    ['nested unknown default remains unknown when omitted', 'const read=({config:{name=""}=external()}={})=>name;read({});', 'read', 'unknown', []],
    ['nested closed excess property', 'const read=({config:{name=""}={}}={})=>name;read({config:{name:"a",extra:42}});', 'read', 'contradiction', ['excessProperty']],
    ['unproved array pattern is not full agreement', 'const read=([value]=[])=>value;read([]);', 'read', 'unknown', []],
    ['guarded value excludes false', 'const read=(value={})=>value;const item=flag&&{};item?read(item):[];', 'read', 'agreement', []],
    ['required argument', 'const read=value=>value; read();', 'read', 'contradiction', ['arity']],
    ['extra argument', 'const read=(value="")=>value; read("a", "b");', 'read', 'contradiction', ['arity']],
    ['rest owns additional arguments', 'const read=(value="",...rest)=>value; read("a", "b");', 'read', 'agreement', []],
    ['rest preserves fixed argument contract', 'const read=(value="",...rest)=>value; read(42, "b");', 'read', 'contradiction', ['mismatch']],
    ['nested contradiction', 'const read=({config:{name=""}={}}={})=>name; read({config:{name:null}});', 'read', 'contradiction', ['mismatch']],
    ['nested authored absence', 'const read=({config:{name=""}={}}={})=>name; read({});', 'read', 'agreement', []],
    ['supplied undefined selects nested default', 'const read=({config:{name=""}={}}={})=>name; read({config:{name:undefined}});', 'read', 'agreement', []],
    ['unknown beside nested contradiction', 'const read=({config:{name="",count=0}={}}={})=>name; read({config:{name:42,count:external}});', 'read', 'contradiction', ['mismatch']],
    ['wrong outer family reports once', 'const read=({config:{name=""}={}}={})=>name; read({config:42});', 'read', 'contradiction', ['mismatch']],
    ['closed caller record', 'const read=({name=""}={})=>name; read({name:"a",extra:42});', 'read', 'contradiction', ['excessProperty']],
    ['rest opens caller record', 'const read=({name="",...rest}={})=>name; read({name:"a",extra:42});', 'read', 'agreement', []],
    ['returned callable', 'const make=()=>(value="")=>value; const read=make(); read(42);', 'read', 'contradiction', ['mismatch']],
    ['member callable', 'const api={read:(value="")=>value}; api.read(42);', 'read', 'contradiction', ['mismatch']],
    ['callback actual input', 'const apply=(callback,value)=>callback(value); const read=({name=""}={})=>name; apply(read,{name:42});', 'apply', 'contradiction', ['mismatch']],
    ['callback required argument', 'const apply=callback=>callback(); const read=value=>value; apply(read);', 'apply', 'contradiction', ['arity']],
    ['callback extra argument', 'const apply=callback=>callback("a",true); const read=value=>value; apply(read);', 'apply', 'contradiction', ['arity']],
    ['known callable beside unknown', 'const read=flag ? (value="")=>value : external; read(42);', 'read', 'contradiction', ['mismatch']],
    ['unknown callable is not agreement', 'const read=flag ? (value="")=>value : external; read("a");', 'read', 'unknown', []],
    ['incompatible callable alternatives', 'const read=flag ? (value="")=>value : (value=0)=>value; read(42);', 'read', 'contradiction', ['mismatch']],
    ['bound record before exposure', 'const read=({name=""}={})=>name; const item={name:42}; read(item);', 'read', 'contradiction', ['mismatch']],
    ['later argument invalidates earlier record', 'const read=({name=""}={},effect)=>name; const item={name:42}; read(item,external(item));', 'read', 'unknown', []],
    ['escaped record is unknown', 'const read=({name=""}={})=>name; const item={name:42}; external(item); read(item);', 'read', 'unknown', []],
    ['getter does not establish a field', 'const read=({name=""}={})=>name; read({get name(){return 42;}});', 'read', 'unknown', []],
    ['unknown supplied value remains unknown', 'const read=(value="")=>value; read(external);', 'read', 'unknown', []],
    ['unsupported default remains unknown', 'const read=(value=external())=>value; read(42);', 'read', 'unknown', []]
];

cases.forEach(([name = '', source = '', selected = '', expected = '', messages = [], sourceType = 'module'] = []) => {
    test(`call agreement: ${name}`, () => {
        const analysis = createAnalysis({ source, sourceType });
        const { calls = [] } = analysis;
        const { index = -1 } = calls.find(({ callee = '' } = {}) => callee === selected) ?? {};

        strictEqual(analysis.checkCall({ index }).status, expected);
    });
    test(`call findings: ${name}`, () => {
        const linter = new Linter();
        const findings = linter.verify(source, { languageOptions: { sourceType }, plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' } });

        deepStrictEqual(findings.map(({ messageId = '' } = {}) => messageId), messages);
    });
});

test('actual callback agreement does not enter a generic callee proof or depend on query order', () => {
    const source = 'const apply=(callback,value)=>callback(value); const read=(value="")=>value; apply(read,42); apply(read,"a");';
    const first = createAnalysis({ source });
    const second = createAnalysis({ source });
    const summarize = analysis => analysis.calls.map(({ index = -1 } = {}) => analysis.checkCall({ index }));
    const before = first.checkFunction({ index: 0 });
    const results = summarize(first);

    second.calls.toReversed().forEach(({ index = -1 } = {}) => second.checkCall({ index }));
    deepStrictEqual(summarize(second), results);
    deepStrictEqual(first.checkFunction({ index: 0 }), before);
    strictEqual(results.at(0).status, 'unknown');
    strictEqual(results.at(1).status, 'contradiction');
    strictEqual(results.at(2).status, 'agreement');
});

test('nested diagnostics own the supplied leaf location', () => {
    const source = 'const read=({config:{name=""}={}}={})=>name;read({config:{name:42}});';
    const analysis = createAnalysis({ source });
    const { obligations = [] } = analysis.checkCall({ index: 0 });
    const { location: { range = [] } = {} } = obligations.find(({ status = '' } = {}) => status === 'contradiction');

    strictEqual(source.slice(...range), '42');
});

test('dispatch evidence belongs to the retained source revision', () => {
    const original = 'function read(value,callback){switch(arguments.length){case 1:return value;}}read(42);';
    const before = createAnalysis({ source: original });
    const after = createAnalysis({ source: original.replace('return value', 'return callback') });

    strictEqual(after.checkCall({ index: 0 }).status, 'contradiction');
    strictEqual(before.checkCall({ index: 0 }).status, 'agreement');
});

test('forwarded contradictions are located at the caller use with owned origin evidence', () => {
    const source = 'const apply=(callback,value)=>callback(value);const read=(value="")=>value;apply(read,42);';
    const analysis = createAnalysis({ source });
    const { index = -1 } = analysis.calls.find(({ callee = '' } = {}) => callee === 'apply');
    const { obligations = [] } = analysis.checkCall({ index });
    const { location: { range = [] } = {}, origin: { range: origin = [] } = {} } = obligations.find(({ status = '' } = {}) => status === 'contradiction');

    strictEqual(source.slice(...range), 'apply(read,42)');
    strictEqual(source.slice(...origin), 'value');
});

test('local call predicates remain correlated across later binding reads and nested forwarding', () => {
    const source = ['const expect=(value={})=>value;const read=value=>expect(value);const get=({ready=0}={})=>ready;const forward=value=>get(value);',
        'const f=()=>{const item=forward(external)?external():false;return item?read(item):42;};'].join('');
    const first = createAnalysis({ source });
    const second = createAnalysis({ source });
    const selected = first.calls.find(({ callee = '' } = {}) => callee === 'read');
    const { index = -1 } = selected;

    strictEqual(first.checkCall({ index }).status, 'unknown');
    first.functions.forEach(({ index = -1 } = {}) => first.checkFunction({ index }));
    second.calls.toReversed().forEach(({ index = -1 } = {}) => second.checkCall({ index }));
    deepStrictEqual(first.checkCall({ index }), second.checkCall({ index }));
    deepStrictEqual(new Linter().verify(source, { plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' } }), []);
});

test('guarded destructuring and calls select the same completed use without erasing test alternatives', () => {
    const source = ['const make=()=>flag?false:{};const accept=(value={})=>value;',
        'const run=()=>{const value=make();if(!value)return;const {name}=value;accept(value);return name;};'].join('');
    const first = createAnalysis({ source });
    const second = createAnalysis({ source });
    const { index = -1 } = first.calls.find(({ callee = '' } = {}) => callee === 'accept');
    const before = first.checkFunction({ index: 0 });

    strictEqual(first.checkDestructuring({ index: 0 }).status, 'agreement');
    strictEqual(first.checkCall({ index }).status, 'agreement');
    deepStrictEqual(first.checkFunction({ index: 0 }), before);
    second.calls.toReversed().forEach(({ index = -1 } = {}) => second.checkCall({ index }));
    deepStrictEqual(first.checkDestructuring({ index: 0 }), second.checkDestructuring({ index: 0 }));
    const findings = new Linter().verify(source, { plugins: { resilient: plugin }, rules: {
        'resilient/signature-contract-call-site': 'error', 'resilient/signature-contract-destructuring': 'error'
    } });

    deepStrictEqual(findings.map(({ messageId = '' } = {}) => messageId), ['missingProperty']);
});

test('a forwarded known promise cannot poison unknown caller values or the generic callee', () => {
    const source = 'const invoke=callback=>callback();const load=async()=>1;invoke(load);invoke(external);';
    const first = createAnalysis({ source });
    const second = createAnalysis({ source });
    const before = first.checkFunction({ index: 0 });
    const check = analysis => analysis.promiseUses.map(({ index = -1 } = {}) => analysis.checkPromiseUse({ index }));
    const results = check(first);

    second.promiseUses.toReversed().forEach(({ index = -1 } = {}) => second.checkPromiseUse({ index }));
    deepStrictEqual(check(second), results);
    strictEqual(results.filter(({ unhandled = false } = {}) => unhandled).length, 1);
    deepStrictEqual(first.checkFunction({ index: 0 }), before);
    deepStrictEqual(second.checkFunction({ index: 0 }), before);
});
