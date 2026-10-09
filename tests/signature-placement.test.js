import { deepStrictEqual, strictEqual, ok, throws } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { ESLint } from 'eslint';
import { parse } from 'espree';

import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { append } from './support/collections.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/signature-placement.json', import.meta.url), 'utf8'));
const adversaries = JSON.parse(readFileSync(new URL('./fixtures/signature-boundaries.json', import.meta.url), 'utf8'));
const lint = new ESLint({ overrideConfigFile: true, allowInlineConfig: false, overrideConfig: [{
    plugins: { resilient: plugin }, rules: { 'resilient/prefer-signature-destructuring': 'error' },
    settings: { resilient: { resolver: () => false } }
}] });
const query = analysis => analysis.signatureExtractions.map(({ index = -1 } = {}) => analysis.checkSignatureExtraction({ index }));
const outputFor = (source, { fix: { range: [start = 0, end = 0] = [], text = '' } = {} } = {}) => source.slice(0, start) + text + source.slice(end);

cases.forEach(({ source = '', findings = 0 } = {}) => {
    test(`signature placement: ${source}`, async () => {
        const analysis = createAnalysis({ source });
        const [{ messages = [], fatalErrorCount = 0 } = {}] = await lint.lintText(source);

        strictEqual(fatalErrorCount, 0);
        strictEqual(messages.length, findings);
        strictEqual(query(analysis).filter(({ placement = '' } = {}) => placement === 'signature').length, findings);
    });
});

adversaries.forEach(({ name = '', source = '', placements = [], relocations = [] } = {}) => {
    test(`signature boundary: ${name}`, async () => {
        const analysis = createAnalysis({ source });
        const proofs = query(analysis);

        deepStrictEqual(proofs.map(({ placement = '' } = {}) => placement), placements);
        deepStrictEqual(proofs.map(({ relocation = false } = {}) => Boolean(relocation)), relocations);
        const expected = analysis.signatureExtractions.filter(({ index = -1 } = {}) => placements.at(index) === 'signature')
            .map(({ location: { range: [start = 0, end = 0] = [], line = 0, column = 0 } = {} } = {}) => ({ line, column, endColumn: column + end - start }));
        const [{ messages = [], fatalErrorCount = 0 } = {}] = await lint.lintText(source);

        strictEqual(fatalErrorCount, 0);
        deepStrictEqual(messages.map(({ line = 0, column = 0, endColumn = 0 } = {}) => ({ line, column, endColumn })), expected);
        messages.forEach(({ fix = false, suggestions = [] } = {}) => {
            strictEqual(fix, false, 'Signature changes are never automatic fixes');
            suggestions.forEach(suggestion => createAnalysis({ source: outputFor(source, suggestion) }));
        });
    });
});

[
    'const read = input => { const { x = 1, y = 2 } = input; return [x,y]; };',
    'const read = (input = {}) => { const { x = 1, ...rest } = input; return [x,rest]; };',
    'const read = (input = []) => { const { x = 1 } = input; return x; };',
    'const read = (input, other) => { const { x = 1 } = input; return [x,other]; };',
    'const read = function(input) { const { x: renamed = 1 } = input; return renamed; };',
    'function read(input) { const { x = 1 } = input; return x; }',
    'const read = input => { const { inner: { x = 1 } = {} } = input; return x; };',
    'const read = (before = undefined, input) => { const { undefined: value = 1 } = input; return [before,value]; };',
    'const read = input => { const { x = 1 } = input; return () => x; };',
    'const read = input => { const { x /* retained comment */ = 1 } = input; return x; };'
].forEach(source => test(`manual relocation preserves authored runtime behavior: ${source}`, async () => {
    const [{ messages: [{ suggestions = [] } = {}] = [] } = {}] = await lint.lintText(source);

    strictEqual(suggestions.length, 1);
    const rewritten = outputFor(source, suggestions.at(0));
    const execute = program => runInNewContext(`${program}
        const cases = [[], [void 0], [null], [42], ['text'], [{}], [{x:0,y:false}], [{inner:{x:4}}]];
        const results = cases.map(args => {
            try { const value=read(...args); return {value:typeof value==='function'?value():value}; }
            catch(error) { return {error:error.name}; }
        });
        const events=[];
        const target={get x(){events.push('get x');return 3;},get y(){events.push('get y');return 4;},inner:{x:5}};
        const input=new Proxy(target,{ownKeys(object){events.push('ownKeys');return Reflect.ownKeys(object);},
            getOwnPropertyDescriptor(object,key){events.push('descriptor '+key);return Reflect.getOwnPropertyDescriptor(object,key);}});
        let observed;
        try {const value=read(input,9);observed=typeof value==='function'?value():value;}catch(error){observed=error.name;}
        JSON.stringify({results,events,observed,length:read.length});`);

    strictEqual(execute(rewritten), execute(source));
    const [{ messages = [], fatalErrorCount = 0 } = {}] = await lint.lintText(rewritten);

    strictEqual(fatalErrorCount, 0);
    deepStrictEqual(messages, []);
}));

test('suggestions preserve required absence and do not introduce a root default', async () => {
    const source = 'const read = input => { const { value = 1 } = input; return value; };';
    const [{ messages: [{ suggestions: [suggestion = {}] = [] } = {}] = [] } = {}] = await lint.lintText(source);

    strictEqual(outputFor(source, suggestion), 'const read = ({ value = 1 }) => {  return value; };');
});

test('parameter scope and directive changes are executable counterexamples to blind relocation', () => {
    const source = 'const read=(before=void undefined,input)=>{const{undefined=1}=input;return [before,undefined];};';
    const moved = 'const read=(before=void undefined,{undefined=1})=>{return [before,undefined];};';

    strictEqual(runInNewContext(`${source} JSON.stringify(read(void 0, {}));`), '[null,1]');
    throws(() => runInNewContext(`${moved} read(void 0, {});`), { name: 'ReferenceError' });
    throws(() => createAnalysis({ source: 'const read=({x=1})=>{"use strict";return x;};' }), SyntaxError);
});

test('placement owns its snapshot and missing source order remains unknown', () => {
    const source = 'const read=input=>{const{value=1}=input;return value;};';
    const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
    const analysis = createProgramAnalysis({ program });
    const expected = query(analysis);
    const { body: [{ declarations: [{ init: { params: [parameter = {}] = [] } = {} } = {}] = [] } = {}] = [] } = program;

    Object.defineProperty(parameter, 'name', { value: 'revised' });
    Object.defineProperty(parameter, 'range', { value: [0, 0] });
    deepStrictEqual(query(analysis), expected);
    const unlocated = createProgramAnalysis({ program: parse(source, { ecmaVersion: 'latest', sourceType: 'module' }) });
    const [{ placement = '', reason = '', relocation = false } = {}] = query(unlocated);

    strictEqual(placement, 'unknown');
    strictEqual(reason, 'unavailable-location');
    strictEqual(relocation, false);
});

test('comments outside a moved pattern retain the diagnostic without a destructive suggestion', async () => {
    const sources = ['const read = input => { const /* keep here */ { value = 1 } = input; return value; };',
        'const read = input => { const { value = 1 } = /* keep here */ input; return value; };'];

    await Promise.all(sources.map(async (source) => {
        const [{ messages: [{ suggestions = [] } = {}] = [] } = {}] = await lint.lintText(source);

        deepStrictEqual(suggestions, []);
    }));
});

test('signature policy does not reinterpret caller inputs as the callee contract', () => {
    const source = 'const read=input=>{const {value=1}=input;return value;}; read({value:2}); read(external); read(null);';
    const first = createAnalysis({ source });
    const second = createAnalysis({ source });
    const expected = query(first);

    second.calls.toReversed().forEach(({ index = -1 } = {}) => second.checkCall({ index }));
    second.functions.toReversed().forEach(({ index = -1 } = {}) => second.checkFunction({ index }));
    second.declarations.toReversed().forEach(({ index = -1 } = {}) => second.checkDeclaration({ index }));
    deepStrictEqual(query(second), expected);
    deepStrictEqual(query(first), expected);
    strictEqual(first.checkCall({ index: 2 }).status, 'agreement', 'Body-only extraction is policy evidence, not a newly authored signature');
});

test('shared use evidence is frozen and source revisions remain independent', () => {
    const source = 'const read=input=>{const {first=1}=input;const {second=2}=input;return [first,second];};';
    const analysis = createAnalysis({ source });
    const [{ references: first = [] } = {}, { references: second = [] } = {}] = query(analysis);

    strictEqual(first, second);
    ok(Object.isFrozen(first));
    ok(first.every(Object.isFrozen));
    ok(analysis.signatureExtractions.every(Object.isFrozen));
    const changed = createAnalysis({ source: source.replace('return [first,second]', 'return input') });

    deepStrictEqual(query(changed).map(({ placement = '' } = {}) => placement), ['body', 'body']);
    deepStrictEqual(query(analysis).map(({ placement = '' } = {}) => placement), ['signature', 'signature']);
    throws(() => analysis.checkSignatureExtraction({ index: -1 }), RangeError);
    throws(() => analysis.checkSignatureExtraction({ index: 2 }), RangeError);
});

test('imported consumer guards and extraction placement belong to their module snapshots', () => {
    const source = 'import { consume as local } from "consumer"; const read=input=>{const {run}=input;local(run);};';
    const guarded = 'export const consume=run=>{if(typeof run==="function")run();}; const read=input=>{const{x=1}=input;return x;};';
    const unguarded = 'export const consume=run=>run(); const read=input=>{const{x=1}=input;return x;};';
    const acquire = dependency => createAnalysis({ source, filename: 'main', resolveModule: () => ({ filename: 'consumer', source: dependency }) });
    const original = acquire(guarded);

    strictEqual(original.signatureExtractions.length, 1, 'Imported extraction syntax cannot become a main-module finding');
    strictEqual(query(original).at(0).placement, 'body');
    strictEqual(query(acquire(unguarded)).at(0).placement, 'signature');
    strictEqual(query(original).at(0).placement, 'body');
    const failure = new Error('module acquisition failed');

    throws(() => createAnalysis({ source, filename: 'main', resolveModule: () => { throw failure; } }), error => error === failure);
    throws(() => createAnalysis({ source, filename: 'main', resolveModule: () => ({ filename: 'consumer' }) }), TypeError);
});

test('interrupted shared guard proofs cannot publish a signature placement', () => {
    const source = 'const read=input=>{const {run}=input;if(typeof run!=="function")return;run();};';
    const original = createAnalysis({ source });
    const steps = [];
    const expected = original.checkSignatureExtraction({ index: 0, onWork: event => append(steps, event) });
    const { placement = '' } = expected;

    strictEqual(placement, 'body');
    steps.forEach((event, position) => {
        const analysis = createAnalysis({ source });
        const visited = [];
        const failure = new Error('observation failed');

        throws(() => analysis.checkSignatureExtraction({ index: 0, onWork: (value) => {
            append(visited, value);

            if (visited.length !== position + 1) return;

            deepStrictEqual(value, event);
            throw failure;
        } }), error => error === failure);
        analysis.declarations.forEach(({ index = -1 } = {}) => analysis.checkDeclaration({ index }));
        deepStrictEqual(analysis.checkSignatureExtraction({ index: 0 }), expected);
    });
});

test('authored defaults and shared callable evidence are independent in either query order', () => {
    ['run', 'run=false'].forEach((pattern) => {
        const source = `const read=input=>{const {${pattern}}=input;if(typeof run!=="function")return;run();};`;
        const first = createAnalysis({ source });
        const second = createAnalysis({ source });
        const declarations = second.declarations.map(({ index = -1 } = {}) => second.checkDeclaration({ index }));
        const [proof = {}] = query(first);
        const { placement = '' } = proof;

        strictEqual(placement, 'body');
        deepStrictEqual(query(second), [proof]);
        deepStrictEqual(first.declarations.map(({ index = -1 } = {}) => first.checkDeclaration({ index })), declarations);
    });
});

test('deferred getters and method receivers retain their native execution boundary', () => {
    const sources = [
        'const read=input=>{const {value=0}=input;return ()=>input.value;};',
        'const read=input=>{const {value=0}=input;return ()=>input.method();};',
        'const read=input=>{const {value=0}=input;return ()=>{const {value=0}=input;return value;};};'
    ];

    sources.forEach((source) => {
        strictEqual(query(createAnalysis({ source })).at(0).placement, 'body');
        const observed = runInNewContext(`${source}
            let current=1, reads=0;
            const input={get value(){reads++;if(current===3)throw Error('later');return current;},method(){return this.value;}};
            const later=read(input);const initial=reads;current=2;const value=later();current=3;
            let failure='';try{later();}catch(error){failure=error.message;}
            JSON.stringify({initial,value,reads,failure});`);

        strictEqual(observed, '{"initial":1,"value":2,"reads":3,"failure":"later"}');
    });
});
