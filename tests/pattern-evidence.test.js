import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';
import { parse } from 'espree';

import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const fields = (source) => {
    const analysis = createAnalysis({ source });
    const { destructuringFields = [] } = analysis;

    return destructuringFields.map(({ index = -1, name = '' } = {}) => ({ name, ...analysis.checkDestructuringField({ index }) }));
};
const missing = source => fields(source).flatMap(({ name = '', fact = false } = {}) => fact ? [{ name, ...fact }] : [])
    .filter(({ presence = [] } = {}) => presence.includes('absent')).map(({ name = '' } = {}) => name);
const lint = (source, rule = 'signature-contract-destructuring') => new Linter().verify(source, {
    plugins: { resilient: plugin }, rules: { [`resilient/${rule}`]: 'error' }
});

[
    ['returned record', 'const make=()=>({});const {missing}=make();', ['missing']],
    ['nested return', 'const make=()=>({data:{}});const {data:{missing}}=make();', ['missing']],
    ['renamed leaf', 'const make=()=>({data:{}});const {data:{missing:other}}=make();', ['missing']],
    ['returned alias', 'const make=()=>({data:{}});const value=make();const {data:{missing}}=value;', ['missing']],
    ['local record aliases', 'const value={};const alias=value;const {missing}=alias;', ['missing']],
    ['nested default', 'const {data:{missing}={}}={};', ['missing']],
    ['nested leaf default', 'const {data:{missing=""}={}}={};', []],
    ['missing parent has no invented missing child', 'const {data:{missing}}={};', ['data']],
    ['wrong parent family has no invented missing child', 'const {data:{missing}}={data:42};', []],
    ['unknown beside closed record', 'const make=()=>flag?external:{};const {missing}=make();', ['missing']],
    ['unknown beside known field', 'const make=()=>flag?external:{present:1};const {present}=make();', []],
    ['unknown returned value', 'const make=()=>external;const {missing}=make();', []],
    ['intervening write', 'const value={};value.missing=1;const {missing}=value;', []],
    ['write through alias', 'const value={data:{}};const alias=value.data;alias.missing=1;const {data:{missing}}=value;', []],
    ['intervening escape', 'const value={};external(value);const {missing}=value;', []],
    ['finalizer changes returned record', 'const make=()=>{const value={};try{return value;}finally{value.missing=1;}};const {missing}=make();', []],
    ['finalizer changes returned alias', 'const make=()=>{const value={};const alias=value;try{return value;}finally{alias.missing=1;}};const {missing}=make();', []],
    ['finalizer exposes returned record', 'const make=()=>{const value={};try{return value;}finally{external(value);}};const {missing}=make();', []],
    ['harmless finalizer preserves record', 'const make=()=>{const value={};try{return value;}finally{42;}};const {missing}=make();', ['missing']],
    ['captured value', 'const value={};const make=()=>value;const {missing}=make();', []],
    ['getter can supply later property', 'const make=()=>({get first(){this.missing=1;return 0;}});const {first,missing}=make();', []],
    ['default may change later field', 'const make=()=>({data:{}});const {first=external(),data:{missing}}=make();', []],
    ['computed pattern may run effects', 'const make=()=>({});const {[external()]:first,missing}=make();', []],
    ['later lexical shadow', 'const value={};{const {missing}=value;const value={missing:1};}', []],
    ['returned function is not a closed record', 'const make=()=>()=>1;const {missing}=make();', []]
].forEach(([name = '', source = '', expected = []] = []) => {
    test(`shared pattern evidence: ${name}`, () => {
        deepStrictEqual(missing(source), expected);
        const findings = lint(source).filter(({ messageId = '' } = {}) => messageId === 'missingProperty');

        strictEqual(findings.length, expected.length);
    });
});

[
    ['local selected default', 'const read=()=>{const {items=[]}={};return items;};read();', 'array', 'agreement'],
    ['nested selected default', 'const read=()=>{const {data:{items=[]}={}}={};return items;};read();', 'array', 'agreement'],
    ['supplied value is not validated', 'const read=({data:{items=[]}={}}={})=>items;read({data:{items:42}});', 'array', 'contradiction'],
    ['null does not select a default', 'const read=()=>{const {items=[]}={items:null};return items;};read();', 'array', 'contradiction'],
    ['aliases retain selected primitive', 'const read=()=>{const {name:renamed=""}={name:42};const alias=renamed;return alias;};read();', 'number', 'agreement'],
    ['opaque default remains unknown', 'const read=()=>{const {items=external()}={};return items;};read();', 'array', 'unknown'],
    ['fixed native array position', 'const read=()=>{const [items]=[[]];return items;};read();', 'array', 'agreement'],
    ['mutable selected binding remains unknown', 'const read=()=>{let {items=[]}={};items=external;return items;};read();', 'array', 'unknown'],
    ['captured selection remains unknown', 'const {items=[]}={};const read=()=>items;read();', 'array', 'unknown'],
    ['unknown supplied field', 'const read=({data:{items=[]}={}}={})=>items;read({data:external});', 'array', 'unknown']
].forEach(([name = '', source = '', required = '', expected = ''] = []) => {
    test(`pattern result evidence: ${name}`, () => {
        const analysis = createAnalysis({ source });
        const { calls = [] } = analysis;
        const { index = -1 } = calls.find(({ callee = '' } = {}) => callee === 'read') ?? {};

        strictEqual(analysis.checkCallResult({ index, required }).status, expected);
    });
});

[
    ['local absence', 'const read=()=>{const {items=[]}={};return items.trim();};', 1],
    ['formal absence', 'const read=({items=[]})=>items.trim();', 1],
    ['nested formal absence', 'const read=({data:{items=[]}={}}={})=>items.trim();', 1],
    ['external local field is not normalized', 'const read=()=>{const {items=[]}=external;return items.trim();};', 0],
    ['supplied contradiction', 'const read=()=>{const {items=[]}={items:42};return items.map(x=>x);};', 1],
    ['unknown getter result', 'const read=()=>{const {items=[]}={get items(){return external;}};return items.trim();};', 0]
].forEach(([name = '', source = '', expected = 0] = []) => {
    test(`product operation uses shared pattern selection: ${name}`, () => strictEqual(lint(source, 'signature-contract-operation').length, expected));
});

test('pattern values and fields preserve revisions and query order', () => {
    const source = 'const make=()=>({data:{other:42}});const read=()=>{const {data:{missing}}=make();return missing;};read();';
    const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
    const first = createProgramAnalysis({ program });
    const second = createAnalysis({ source });
    const { calls = [], destructuringFields = [] } = first;
    const before = destructuringFields.map(({ index = -1 } = {}) => first.checkDestructuringField({ index }));

    calls.toReversed().forEach(({ index = -1 } = {}) => second.checkCallResult({ index, required: 'number' }));
    deepStrictEqual(destructuringFields.map(({ index = -1 } = {}) => second.checkDestructuringField({ index })), before);
    const { body: [{ declarations: [{ init: { body: { properties: [{ value: { properties: [{ key = {} } = {}] = [] } = {} } = {}] = [] } = {} } = {} } = {}] = [] } = {}] = [] } = program;

    Object.defineProperty(key, 'name', { value: 'missing' });
    const changed = createProgramAnalysis({ program });

    strictEqual(changed.checkDestructuringField({ index: 1 }).status, 'agreement');
    deepStrictEqual(destructuringFields.map(({ index = -1 } = {}) => first.checkDestructuringField({ index })), before);
});
