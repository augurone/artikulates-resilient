import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import { createTypeScriptAnalysis } from 'eslint-plugin-resilient/analyzer/typescript';

import { assertCompilerCollection } from './support/compiler-retention.js';
import { analyze, firstCall, fixture, tuple } from './support/compiler-source.js';
import { counter } from './support/work.js';

const outcome = ({ status = '', fact: { families = [], incomplete = false } = {}, normal = false, thrown = false } = {}) => (
    { status, families, incomplete, normal, thrown }
);
const lastResult = (analysis, required = '') => {
    const { calls = [] } = analysis;
    const { index = -1 } = calls.at(-1) ?? {};

    return analysis.checkCallResult({ index, required });
};

// Identical executable source enters two syntax acquisitions and one evaluator.
// These witnesses cover the existing shared engine, not a new callback engine.
[
    ['arrow', 'const read=value=>value;read(3);', 'number'],
    ['function expression and alias', 'const read=function self(value){return value;};const alias=read;alias(3);', 'number'],
    ['immediate function', '(function(value){return value;})(3);', 'number'],
    ['returned callable alias', 'const make=()=>value=>value;const read=make();read(3);', 'number'],
    ['callback actual input', 'const apply=(callback,value)=>callback(value);apply(value=>value,3);', 'number'],
    ['direct record result', 'const build=value=>({value});build(3);', 'object'],
    ['owned member callable', 'const api={read:value=>value};api.read(3);', 'number'],
    ['native-looking own member', 'const api={map:value=>value};api.map(3);', 'number'],
    ['map callback', '[1,2].map(value=>value);', 'array'],
    ['sparse map', '[,2].map(value=>value);', 'array'],
    ['empty map skips failure', '[].map(()=>{throw 1;});', 'array'],
    ['callback failure', '[1].map(()=>{throw 1;});', 'array'],
    ['noncallable callback', '[1].map(0);', 'array'],
    ['seeded reduction', '[1,2].reduce((acc,value)=>acc,"seed");', 'string'],
    ['successive accumulator', '[1,"last"].reduce((acc,value)=>value,0);', 'string'],
    ['empty seeded reduction', '[].reduce((acc,value)=>value,"seed");', 'string'],
    ['unseeded reduction', '[1,2].reduce((acc,value)=>acc);', 'number'],
    ['empty unseeded failure', '[].reduce((acc,value)=>acc);', 'number'],
    ['hole-only unseeded failure', '[,,].reduce((acc,value)=>acc);', 'number'],
    ['some callback', '[1].some(value=>true);', 'boolean'],
    ['find exhaustion', '[1].find(value=>false);', 'nullish'],
    ['forEach completion', '[1].forEach(value=>value);', 'nullish']
].forEach(([name = '', source = '', required = ''] = []) => test(`compiler bridge/shared evaluator equivalence: ${name}`, () => {
    const compiler = analyze(source);
    const shared = createAnalysis({ source });

    deepStrictEqual(outcome(lastResult(compiler, required)), outcome(lastResult(shared, required)));
}));

test('compiler bridge: returned callable invocation evaluates the outer callee first', () => {
    const analysis = analyze('const make=()=>value=>value;make()(3);');
    const { calls: [{ index = -1 } = {}] = [] } = analysis;
    const { status = '', fact: { families = [] } = {}, thrown = true } = analysis.checkCallResult({ index, required: 'number' });

    strictEqual(status, 'agreement');
    deepStrictEqual(families, ['number']);
    strictEqual(thrown, false);
});

test('compiler bridge: arbitrary tuple arity, arrow aliases and function slots use actual values', () => {
    const source = 'const read=([flag,callback,value]:[boolean,()=>number,string])=>[flag,callback,value];const alias=read;alias([false,()=>3,"text"]);';
    const analysis = analyze(source);
    const { descriptor: { slots = [] } = {}, calls = [] } = tuple(analysis);

    deepStrictEqual(slots.map(({ requirement: { family = '' } = {} } = {}) => family), ['boolean', 'function', 'string']);
    deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['agreement']);
    const wrong = analyze(source.replace('[false,()=>3,"text"]', '[false,3,"text"]'));

    strictEqual(firstCall(wrong).status, 'contradiction');
});

test('compiler bridge: annotation and returned value evidence retain separate meanings', () => {
    const source = 'const read=([value]:[number]):number=>"actual";read([3]);';
    const analysis = analyze(source);
    const revised = analyze(source.replace('[number]', '[string]'), { revision: '2' });

    strictEqual(lastResult(analysis, 'number').status, 'contradiction');
    deepStrictEqual(outcome(lastResult(analysis, 'number')), outcome(lastResult(revised, 'number')));
    strictEqual(tuple(analysis).descriptor.requirement.family, 'number');
    strictEqual(tuple(revised).descriptor.requirement.family, 'string');
});

test('compiler bridge: reducer requirements and accumulator identity have different owners', () => {
    const analysis = analyze('const fold=(acc,[value]:[number])=>acc;[[3]].reduce(fold,"seed");');
    const { descriptor: { parameterIndex = -1 } = {}, result: { returnedParameter = false } = {} } = tuple(analysis);
    const { index = -1 } = returnedParameter;

    strictEqual(parameterIndex, 1);
    strictEqual(index, 0);
    strictEqual(lastResult(analysis, 'string').status, 'agreement');
    const replacement = analyze('const fold=(acc,[value]:[number])=>"replacement";[[3]].reduce(fold,"seed");');

    strictEqual(tuple(replacement).result.returnedParameter, false);
});

test('compiler bridge: a known producer conflict survives an unknown return and invocation queries', () => {
    const analysis = analyze('const select=(first,second)=>first?3:second?"text":external;select(true,false);');
    const before = analysis.checkFunction({ index: 0 });
    const { status = '', fact: { families = [], incomplete = false } = {} } = before;

    strictEqual(status, 'contradiction');
    deepStrictEqual(families, ['number', 'string']);
    strictEqual(incomplete, true);
    strictEqual(lastResult(analysis, 'number').status, 'agreement');
    deepStrictEqual(analysis.checkFunction({ index: 0 }), before);
});

test('compiler bridge: reached completion owns later calls and preserves failure ordering', () => {
    const analysis = analyze('function read([value]:[number]){return [value];}read(null);read(["unreachable"]);');
    const { calls = [] } = tuple(analysis);

    strictEqual(calls.at(0).normal, false);
    strictEqual(calls.at(0).thrown, true);
    strictEqual(calls.at(1).status, 'unknown');
    strictEqual(calls.at(1).normal, 'unknown');
    const argument = analyze('const fail=()=>{throw 7;};const read=value=>value;read(fail());');
    const { normal = true, thrown = false } = argument.checkCallResult({ index: 0, required: 'number' });

    strictEqual(normal, false);
    strictEqual(thrown, true);
});

[
    'external();',
    'function touch(){external();}touch();',
    'function touch(){Array.prototype.map=external;}touch();'
].forEach((prefix, index) => test(`compiler bridge: prior effect ${index} retires native premises`, () => {
    const analysis = analyze(`${prefix}[1].map(value=>value);`);

    strictEqual(lastResult(analysis, 'array').status, 'unknown');
    const member = analyze(`${prefix}"text".trim();`);

    strictEqual(lastResult(member, 'string').status, 'unknown');
}));

test('compiler bridge: argument and element effects cannot lend ambient native proof', () => {
    const argument = analyze('const read=([value]:[number],effect)=>[value];read([3],external());');
    const element = analyze('[external()].map(value=>3);');

    strictEqual(firstCall(argument).status, 'unknown');
    strictEqual(element.checkCallResult({ index: 0, required: 'array' }).status, 'unknown');
});

test('compiler bridge: skipped effects preserve the reached native premise', () => {
    const analysis = analyze('export {};if(false){external();}[1].map(value=>value);');

    strictEqual(lastResult(analysis, 'array').status, 'agreement');
});

test('compiler bridge: initialized module aliases and lexical shadows remain distinct', () => {
    const declaration = 'function read([value]:[number]){return [value];}';
    const alias = analyze(`${declaration}const renamed=read;renamed([3]);`);

    strictEqual(firstCall(alias).status, 'agreement');
    const shadow = analyze(`${declaration}function outer(){read([3]);const read=external;}outer();`);

    ok(tuple(shadow).calls.every(({ status = '' } = {}) => status === 'unknown'));
    const hoisted = analyze(`${declaration}function outer(){read([3]);{var read=external;}}outer();`);

    deepStrictEqual(tuple(hoisted).calls, []);
});

test('compiler bridge: acquisition and observer failures are operational, retry stays source-owned', () => {
    const input = fixture('const read=([value]:[number])=>[value];read([3]);');
    const { sourceText = '' } = input;
    const analysis = createTypeScriptAnalysis(input);
    const failure = new Error('observation failed');

    throws(() => analysis.checkFunction({ index: 0, onWork: () => { throw failure; } }), error => error === failure);
    deepStrictEqual(analysis.checkFunction({ index: 0 }), analyze(sourceText).checkFunction({ index: 0 }));
    const work = counter();

    tuple(analysis, work);
    const before = work.read();

    tuple(analysis, work);
    deepStrictEqual(work.read(), before);
    assertCompilerCollection(sourceText);
});

// Exported/module callables may run outside the acquired module execution.
// A missing local call is not evidence that their captured writes are inert.
test('compiler bridge: an externally reachable writer invalidates a captured callable', () => {
    const source = 'function read([value]:[number]){return [value];}export function replace(){read=external;}export function run(){return read([3]);}';
    const analysis = analyze(source);

    strictEqual(analysis.checkFunction({ index: 2 }).status, 'unknown');
    strictEqual(firstCall(analysis).status, 'unknown');
});

test('compiler bridge: dynamic lexical execution cannot lend stable binding evidence', () => {
    const source = 'function read([value]:[number]){eval("value=String()");return [value];}read([3]);';

    strictEqual(firstCall(analyze(source)).status, 'unknown');
});

test('compiler bridge: unavailable native dependencies do not erase ordinary helper result families', () => {
    const analysis = analyze('function read([value]:[number]){function wrap(input){return [input];}return wrap(value);}');
    const { result: { fact: { families = [] } = {} } = {} } = tuple(analysis);

    deepStrictEqual(families, ['array']);
    const native = analyze('const read=effect=>[1].map(value=>value);read(external());');

    strictEqual(native.checkCallResult({ index: 1, required: 'array' }).status, 'unknown');
});
