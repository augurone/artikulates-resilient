import { deepStrictEqual, strictEqual, ok, throws } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { ESLint } from 'eslint';
import { parse } from 'espree';

import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const cases = JSON.parse(readFileSync(new URL('./fixtures/signature-fluency.json', import.meta.url), 'utf8'));
const lint = new ESLint({ overrideConfigFile: true, allowInlineConfig: false, overrideConfig: [{
    plugins: { resilient: plugin }, rules: { 'resilient/prefer-signature-destructuring': 'error' },
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } }, settings: { resilient: { resolver: () => false } }
}] });

cases.forEach(({ name = '', source = '', placement = '', relocation = false, sourceType = 'module' } = {}) => {
    test(`signature review: ${name}`, async () => {
        const analysis = createAnalysis({ source, sourceType });
        const { signatureExtractions = [] } = analysis;

        strictEqual(signatureExtractions.length, 1);
        const proof = analysis.checkSignatureExtraction({ index: 0 });
        const { placement: actual = '', relocation: move = false } = proof;

        strictEqual(actual, placement);
        strictEqual(Boolean(move), relocation);
        const [{ messages = [], fatalErrorCount = 0 } = {}] = await lint.lintText(source);

        strictEqual(fatalErrorCount, 0);
        strictEqual(messages.length, placement === 'signature' ? 1 : 0);
        strictEqual(messages.flatMap(({ suggestions = [] } = {}) => suggestions).length, Number(relocation));
        const second = createAnalysis({ source, sourceType });

        second.functions.toReversed().forEach(({ index = -1 } = {}) => second.checkFunction({ index }));
        second.declarations.toReversed().forEach(({ index = -1 } = {}) => second.checkDeclaration({ index }));
        deepStrictEqual(second.checkSignatureExtraction({ index: 0 }), proof);
    });
});

test('optional-chain references preserve this, getter order and mutation at runtime', () => {
    const observed = runInNewContext(`
        const events=[];
        const child={value:4, method(){events.push(this===child);return this.value;}};
        const input={get child(){events.push('get child');return child;},method(){events.push(this===input);return 3;}};
        const first=(input?.method)();const second=(input?.child).method();
        ({slot:(input?.child).value}={slot:7});delete (input?.child).value;
        JSON.stringify({first,second,events,deleted:!Object.hasOwn(child,'value')});
    `);

    strictEqual(observed, '{"first":3,"second":4,"events":[true,"get child",true,"get child","get child"],"deleted":true}');
});

test('opaque tag consumption cannot authorize removing a binding needed by its host lowering', () => {
    const source = 'const read=Input=>{const{value=0}=Input;return <Input/>;};';
    const { placement = '', references = [] } = createAnalysis({ source }).checkSignatureExtraction({ index: 0 });

    strictEqual(placement, 'unknown');
    ok(references.some(({ kind = '' } = {}) => kind === 'unsupported-reference'));
    const lowered = 'const read=Input=>{const{value=0}=Input;return {type:Input};};';
    const moved = 'const read=({value=0})=>{return {type:Input};};';

    strictEqual(runInNewContext(`${lowered} const supplied={value:1}; read(supplied).type===supplied;`), true);
    throws(() => runInNewContext(`${moved} read({value:1});`), { name: 'ReferenceError' });
    const originalArguments = 'function read(input){const{value=0}=input;return arguments.callee===read;}';
    const movedArguments = 'function read({value=0}){return arguments.callee===read;}';

    strictEqual(runInNewContext(`${originalArguments} read({});`), true);
    throws(() => runInNewContext(`${movedArguments} read({});`), { name: 'TypeError' });
});

test('tag-use snapshots are owned and required syntax failures remain operational', () => {
    const source = 'const read=Input=>{const{value=0}=Input;return <Input/>;};';
    const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true, ecmaFeatures: { jsx: true } });
    const analysis = createProgramAnalysis({ program });
    const { body: [{ declarations: [{ init: { body: { body: [, { argument: { openingElement: { name = {} } = {} } = {} } = {}] = [] } = {} } = {} } = {}] = [] } = {}] = [] } = program;
    const expected = analysis.checkSignatureExtraction({ index: 0 });

    Object.defineProperty(name, 'name', { value: 'Other' });
    strictEqual(analysis.checkSignatureExtraction({ index: 0 }), expected);
    strictEqual(createProgramAnalysis({ program }).checkSignatureExtraction({ index: 0 }).placement, 'signature');
    const failure = new Error('tag source unavailable');

    Object.defineProperty(name, 'name', { get() { throw failure; } });
    throws(() => createProgramAnalysis({ program }), error => error === failure);
});

test('opaque tag escapes cannot establish generic guarded-consumer agreement', () => {
    const source = 'import {consume} from "consumer"; const read=({run})=>consume(run);';
    const acquire = body => createAnalysis({ source, filename: 'main', resolveModule: () => ({
        filename: 'consumer', source: `export const consume=Action=>{if(typeof Action==='function')Action();${body}};`
    }) });
    const escaped = acquire('return <Action/>;');
    const unrelated = acquire('return <Other Action="text"/>;');
    const { declarations = [] } = escaped;
    const { index = -1 } = declarations.find(({ name = '' } = {}) => name === 'run') ?? {};

    strictEqual(escaped.checkDeclaration({ index }).required, true);
    strictEqual(unrelated.checkDeclaration({ index }).required, false);
    strictEqual(escaped.checkDeclaration({ index }).required, true);
});

test('suggested relocation preserves independent runtime observations across composed signatures and patterns', async () => {
    const wrappers = [
        ['const read=input=>{', '};'], ['const read=(input)=>{', '};'], ['const read=(input={})=>{', '};'],
        ['const read=(prior=0,input)=>{', '};'], ['const read=function named(input){', '};'],
        ['function read(input){', '}'], ['const host={read(input){', '}};const read=host.read;']
    ];
    const patterns = [
        ['{value=0}', 'value'], ['{value:renamed=false}', 'renamed'], ['{value:read=1}', 'read'],
        ['{nested:{next=1}={}}', 'next'], ['{items:[first=0]=[]}', 'first'], ['{value=0,...rest}', '[value,rest]'],
        ['{value=/x/}', 'String(value)'], ['{value=null}', 'value'], ['{"odd key":value=""}', 'value'], ['{}', '42']
    ];
    const programs = wrappers.flatMap(([open = '', close = ''] = [], position) => patterns.flatMap(([pattern = '', result = ''] = []) => (
        [result, `()=>(${result})`].map(expression => ({ source: `${open}const ${pattern}=input;return ${expression};${close}`, position }))
    )));
    const outcomes = await Promise.all(programs.map(async ({ source = '', position = -1 } = {}) => {
        const [{ messages: [{ suggestions = [] } = {}] = [] } = {}] = await lint.lintText(source);

        strictEqual(suggestions.length, 1, source);
        const { fix: { range: [start = 0, end = 0] = [], text = '' } = {} } = suggestions.at(0);
        const rewritten = source.slice(0, start) + text + source.slice(end);
        const execute = program => runInNewContext(`${program}
            const run=args=>{try{const value=read(...args);return {value:typeof value==='function'?value():value};}
                catch(error){return {error:error.name};}};
            const cases=[[],[void 0],[null],[false],[4],['text'],[[]],[{}],[{value:0}],[{value:2,nested:{next:3},items:[4]}]];
            const shape=args=>${position === 3 ? '[0,...args]' : 'args'};
            const results=cases.map(args=>run(shape(args)));
            const events=[];
            const target={get value(){events.push('get value');return 3;},get nested(){events.push('get nested');return {next:5};},
                get items(){
                    events.push('get items');
                    return {[Symbol.iterator](){
                        events.push('iterator');
                        return {next(){events.push('next');return {value:6,done:false};},return(){events.push('close');return {done:true};}};
                    }};
                }
            };
            const input=new Proxy(target,{ownKeys(object){events.push('ownKeys');return Reflect.ownKeys(object);},
                getOwnPropertyDescriptor(object,key){events.push('descriptor '+key);return Reflect.getOwnPropertyDescriptor(object,key);}});
            const traced=run(shape([input]));
            const failed=run(shape([{get value(){events.push('throw');throw TypeError('source');}}]));
            JSON.stringify({results,traced,failed,events,length:read.length});`);
        const before = execute(source);

        strictEqual(execute(rewritten), before, source);

        return before;
    }));

    strictEqual(outcomes.length, 140);
});
