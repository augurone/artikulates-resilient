import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { ESLint, Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

const normalizer = 'const object=value=>Object.prototype.toString.call(value)==="[object Object]";const normalize=value=>object(value)?value:{};';
const rules = {
    'resilient/no-undefined-assignment': 'error',
    'resilient/prefer-safe-destructuring-defaults': 'error',
    'resilient/signature-contract-destructuring': 'error',
    'resilient/signature-contract-property': 'error',
    'resilient/signature-contract-operation': 'error'
};
const lint = source => new Linter().verify(source, { plugins: { resilient: plugin }, rules });

[
    ['known omitted field', 'const {child={}}={};normalize(child).kind;'],
    ['conditional omitted field', 'const {child={}}=flag?external:{};normalize(child).kind;'],
    ['returned omitted field', 'const read=value=>value?{child:external}:{};const {child={}}=read(external);normalize(child).kind;'],
    ['empty array slot', 'const [child={}]=[];normalize(child).kind;'],
    ['default alias', 'const {child={}}={};const alias=child;normalize(alias).kind;'],
    ['supplied empty parameter field default', 'const read=({child={}}={})=>normalize(child).kind;read();']
].forEach(([name = '', source = ''] = []) => test(`an empty value default owns an open shape: ${name}`, () => {
    deepStrictEqual(lint(`${normalizer}${source}`), []);
}));

[
    ['function field', 'const owner={run:()=>1};const {run}=owner;run();'],
    ['callable beside spread', 'const owner={...external,run:()=>1};const {run}=owner;run();'],
    ['returned callable', 'const make=()=>({run:()=>1});const {run}=make();run();']
].forEach(([name = '', source = ''] = []) => test(`a source-proved callable needs no invented default: ${name}`, () => {
    deepStrictEqual(lint(source), []);
}));

[
    ['known absent alternative', 'const owner=flag?{run:()=>1}:{};const {run}=owner;run();'],
    ['known noncallable alternative', 'const owner=flag?{run:()=>1}:{run:0};const {run}=owner;run();'],
    ['unknown getter', 'const owner={get run(){return external;}};const {run}=owner;run();'],
    ['direct literal remains closed', 'const child={};const {missing}=child;'],
    ['nested named pattern remains closed', 'const {child:{missing}={}}={};']
].forEach(([name = '', source = ''] = []) => test(`open defaults and callable fields retain separate requirements: ${name}`, () => {
    strictEqual(lint(source).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true);
}));

[
    ['direct extraction', 'const {typeArguments}=normalize(external);'],
    ['renamed field', 'const {typeArguments:optionalTypes}=normalize(external);forward(optionalTypes);'],
    ['stable alias', 'const source=normalize(external);const alias=source;const {typeArguments}=alias;'],
    ['generic body', 'const update=(node={})=>{const {typeArguments}=normalize(node);return factory.update(node,typeArguments);};'],
    ['nested normalization', 'const {typeArguments}=normalize(normalize(external).child);'],
    ['nested array sibling', 'const {arguments:[first={}]=[],typeArguments}=normalize(external);'],
    ['known field beside unknown', 'const {typeArguments}=normalize(flag?{typeArguments:[]}:external);'],
    ['open source record', 'const {typeArguments}={...external};']
].forEach(([name = '', source = ''] = []) => test(`natural absence at an open object boundary: ${name}`, () => {
    deepStrictEqual(lint(`${normalizer}${source}`), []);
}));

[
    ['unknown receiver', 'const {value}=external;'],
    ['closed empty receiver', 'const {value}=normalize({});'],
    ['closed empty beside unknown', 'const {value}=normalize(flag?{}:external);'],
    ['unsafe nested pattern', 'const {nested:{value}}=normalize(external);'],
    ['generic signature', 'const read=({value}={})=>String(value);'],
    ['unknown tuple', 'const [value]=external;']
].forEach(([name = '', source = ''] = []) => test(`natural absence retains the separate default obligation: ${name}`, () => {
    strictEqual(lint(`${normalizer}${source}`).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true);
}));

test('natural extraction preserves a known field family and its operation contradiction', () => {
    const source = `${normalizer}const {value}=normalize(flag?{value:42}:external);value.map(item=>item);`;

    deepStrictEqual(lint(source).map(({ ruleId = '' } = {}) => ruleId), ['resilient/signature-contract-operation']);
});

test('removing an undefined field default preserves native values, getters, failures and parameter metadata', () => {
    const execute = fallback => JSON.parse(runInNewContext(`${normalizer}
        const events=[];const failure={};
        const supplied={get typeArguments(){events.push('field');return undefined;}};
        const throwing={get typeArguments(){events.push('throw');throw failure;}};
        const tagged={get [Symbol.toStringTag](){events.push('tag');throw failure;}};
        const read=input=>{const {typeArguments${fallback}}=normalize(input);return typeArguments;};
        const parameter=({typeArguments${fallback}}={})=>typeArguments;
        const inputs=[undefined,null,false,0,'',{}, {typeArguments:null},{typeArguments:[]},supplied,throwing,tagged];
        const values=inputs.map(input=>{try{const value=read(input);return {absent:typeof value==='undefined',value};}
            catch(error){return {failure:error===failure};}});
        JSON.stringify({values,events,length:parameter.length,omitted:typeof parameter()==='undefined'});`));
    const before = execute('=undefined');
    const after = execute('');
    const { events = [], length = -1, omitted = false } = after;

    deepStrictEqual(after, before);
    deepStrictEqual(events, ['field', 'throw', 'tag']);
    strictEqual(length, 0);
    strictEqual(omitted, true);
});

test('installed named and namespace normalizers preserve natural field absence under both rules', async () => {
    const filename = fileURLToPath(new URL('natural-absence-input.js', import.meta.url));
    const normalizer = fileURLToPath(import.meta.resolve('eslint-plugin-resilient/standard/object'));
    const resolver = ({ source = '' } = {}) => source === 'eslint-plugin-resilient/standard/object' ? normalizer : '';
    const engine = new ESLint({ overrideConfigFile: true, overrideConfig: [{ plugins: { resilient: plugin }, rules,
        settings: { resilient: { resolver } } }] });
    const source = 'import {getObject as normalize} from "eslint-plugin-resilient/standard/object";'
        + 'import * as objects from "eslint-plugin-resilient/standard/object";'
        + 'const {typeArguments}=normalize(external);const {modifiers}=objects.getObject(external);'
        + 'factory.update(typeArguments,modifiers);';
    const [{ messages = [] } = {}] = await engine.lintText(source, { filePath: filename });

    deepStrictEqual(messages, []);
});

test('the shipped import rewriter preserves optional fields through its actual module graph', async () => {
    const filename = fileURLToPath(new URL('natural-absence-rewriter.js', import.meta.url));
    const sourceFile = fileURLToPath(new URL('./grammar/imports.js', import.meta.resolve('eslint-plugin-resilient/typescript')));
    const source = readFileSync(sourceFile, 'utf8');
    const resolver = ({ from = '', source = '' } = {}) => resolve(dirname(from === filename ? sourceFile : from), source);
    const engine = new ESLint({ overrideConfigFile: true, overrideConfig: [{ plugins: { resilient: plugin },
        rules: { ...rules, 'resilient/prefer-falsey-returns': 'error' },
        settings: { resilient: { resolver } } }] });
    const [{ messages = [] } = {}] = await engine.lintText(source, { filePath: filename });

    deepStrictEqual(messages, []);
});

[16, 32, 64].forEach(width => test(`natural field declarations share their producer and reuse warm evidence at ${width}`, (context) => {
    const fields = Array.from({ length: width }, (item, index) => `field${index}`).join(',');
    const analysis = createAnalysis({ source: `${normalizer}const {${fields}}=normalize(external);` });
    const { declarations = [], checkDeclaration = () => ({}) } = analysis;
    const selected = declarations.filter(({ name = '' } = {}) => name.startsWith('field'));
    const work = counter();
    const { onWork = () => {} } = work;

    selected.forEach(({ index = -1 } = {}) => strictEqual(checkDeclaration({ index, onWork }).required, false));
    const before = work.read();

    selected.toReversed().forEach(({ index = -1 } = {}) => strictEqual(checkDeclaration({ index, onWork }).required, false));
    deepStrictEqual(work.read(), before);
    context.diagnostic(JSON.stringify({ width, ...before }));
}));

test('natural field queries recover from interrupted observation and remain isolated across source revisions', () => {
    const source = `${normalizer}const {value}=normalize(external);`;
    const analysis = createAnalysis({ source });
    const { declarations = [], checkDeclaration = () => ({}) } = analysis;
    const [{ index = -1 } = {}] = declarations.filter(({ name = '' } = {}) => name === 'value');
    const failure = new Error('absence observation failed');

    throws(() => checkDeclaration({ index, onWork: () => { throw failure; } }), error => error === failure);
    const expected = createAnalysis({ source }).checkDeclaration({ index });
    const { required = true } = expected;

    strictEqual(required, false);
    deepStrictEqual(checkDeclaration({ index }), expected);
    const revised = createAnalysis({ source: source.replace('normalize(external)', 'normalize({})') });

    strictEqual(revised.checkDeclaration({ index }).required, true);
    deepStrictEqual(checkDeclaration({ index }), expected);
});

[
    ['omitted field', 'const {items={}}={};items.map(Boolean);', 1],
    ['known empty default beside unknown', 'const {items={}}=flag?{}:{items:external};items.map(Boolean);', 1],
    ['known empty default beside custom method', 'const {items={}}=flag?{}:{items:{map:()=>1}};items.map(Boolean);', 1],
    ['supplied custom method', 'const {items={}}={items:{map:()=>1}};items.map(Boolean);', 0],
    ['retired default', 'const {items={}}={};outside(items);items.map(Boolean);', 0]
].forEach(([name = '', source = '', expected = 0] = []) => test(`open field defaults retain native-operation evidence: ${name}`, () => {
    strictEqual(lint(source).filter(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-operation').length, expected);
}));
