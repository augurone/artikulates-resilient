import assert from 'node:assert/strict';

import { Linter } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import { collectExactProviderForwardContracts } from '../transforms/typescript/understand/type-evidence.js';

const cases = [
    ['named', 'function combineAll(M:{baseValue:number},isMissing:()=>boolean){return isMissing()?M.baseValue:2;}', 1],
    ['neutral', 'function resolve(provider:{identity:number},choose:()=>boolean){return choose()?provider.identity:2;}', 1],
    ['local', 'function read(flag:boolean){const p={unit:1};return flag?p.unit:2;}', 1],
    ['arrow', 'const read=(p:{unit:number},flag:boolean)=>flag?p.unit:2;', 1],
    ['parenthesized', 'function read(p:{unit:number},flag:boolean){return (flag?p.unit:2);}', 1],
    ['generic', 'function read<T>(p:{unit:T},next:()=>T,flag:boolean){return flag?p.unit:next();}', 1],
    ['getter', 'function read(p:{readonly unit:number},flag:boolean){return flag?p.unit:2;}', 1],
    ['union', 'function read(p:{kind:"a";unit:number}|{kind:"b";unit:number},flag:boolean){return flag?p.unit:2;}', 1],
    ['optional', 'function read(p:{unit?:number},flag:boolean){return flag?p.unit:2;}', 0],
    ['missing', 'function read(p:{},flag:boolean){return flag?p.unit:2;}', 0],
    ['any', 'function read(p:any,flag:boolean){return flag?p.unit:2;}', 0],
    ['unknown-field', 'function read(p:{unit:unknown},flag:boolean){return flag?p.unit:2;}', 0],
    ['any-field', 'function read(p:{unit:any},flag:boolean){return flag?p.unit:2;}', 0],
    ['any-sibling', 'function read(p:{unit:number},next:any,flag:boolean){return flag?p.unit:next;}', 0],
    ['unknown-sibling', 'function read(p:{unit:number},next:unknown,flag:boolean){return flag?p.unit:next;}', 0],
    ['never-sibling', 'function read(p:{unit:number},next:()=>never,flag:boolean){return flag?p.unit:next();}', 0],
    ['incompatible', 'function read(p:{unit:number},flag:boolean){return flag?p.unit:"bad";}', 0],
    ['mixed-sibling', 'function read(p:{unit:number},next:number|string,flag:boolean){return flag?p.unit:next;}', 0],
    ['open', 'function read(p:{unit:number}|{kind:"other"},flag:boolean){return flag?p.unit:2;}', 0],
    ['index-only', 'function read(p:{[key:string]:number},flag:boolean){return flag?p.unit:2;}', 0],
    ['operand', 'function read(p:{unit:number},flag:boolean){return 1+(flag?p.unit:2);}', 0],
    ['argument', 'function read(p:{unit:number},f:(n:number)=>number,flag:boolean){return f(flag?p.unit:2);}', 0],
    ['declaration', 'function read(p:{unit:number},flag:boolean){const result=flag?p.unit:2;return result;}', 0],
    ['shadow-absence', 'function read(p:{unit:number},flag:boolean,undefined:number){return flag?p.unit:2;}', 0],
    ['optional-chain', 'function read(p:{unit:number},flag:boolean){return flag?p?.unit:2;}', 0],
    ['misleading', 'function combineAll(M:{baseValue?:number},isInbound:()=>boolean){return isInbound()?M.baseValue:2;}', 0]
];
const sources = new Map(cases.map(([name = '', code = ''] = []) => [name + '.ts', typescript.createSourceFile(name + '.ts', 'export {};\n' + code, typescript.ScriptTarget.ESNext, true)]));
const options = { strict: true, target: typescript.ScriptTarget.ESNext };
const host = typescript.createCompilerHost(options);
const program = typescript.createProgram([...sources.keys()], options, {
    ...host, getSourceFile: (name, version) => sources.get(name) || host.getSourceFile(name, version)
});
const checker = program.getTypeChecker();
const facts = cases.map(([name = '', , count = 0] = []) => {
    const sourceFile = sources.get(name + '.ts');
    const contracts = collectExactProviderForwardContracts({ typescript, sourceFile, checker });
    const terminal = [...contracts.values()].filter(({ placement = '' } = {}) => placement === 'terminal-field');
    assert.equal(terminal.length, count, name);
    const decisions = compileDestructuringDecisions(collectDestructuringAgreements({ exactProviderForwards: contracts }));
    terminal.forEach(({ key = '', member = '', readPhase = '', siblingRange = '', terminalRange = '' } = {}) => {
        assert.ok(member && siblingRange && terminalRange, name);
        assert.equal(readPhase, 'source-member');
        const [decision = {}] = decisions.byKey.get(key) || [];
        const { agreement: { action = '', canonical = '' } = {} } = decision;
        assert.equal(action, 'exact-provider-forward');
        assert.equal(canonical, 'undefined');
    });

    return { terminal, completed: terminal.flatMap(({ key = '' } = {}) => (decisions.byKey.get(key) || []).map(({ agreement = {} } = {}) => agreement)) };
});
const normalize = values => values.map(({ action = '', placement = '', consumer = [], canonical = '', readPhase = '', evidence = [] } = {}) => (
    { action, placement, consumer, canonical, readPhase, evidence }
));
const [{ terminal: named = [], completed: namedDecisions = [] } = {}, { terminal: neutral = [], completed: neutralDecisions = [] } = {}] = facts;
assert.deepEqual(normalize(named), normalize(neutral), 'Coordinated names preserve source facts.');
const normalizeDecisions = values => values.map(({ sourceRange = '', relatedRanges = [], ...decision } = {}) => ({
    ...decision, sourceRange: sourceRange ? 'source-member' : '', relatedRanges: relatedRanges.map(() => 'source-member')
}));
assert.deepEqual(normalizeDecisions(namedDecisions), normalizeDecisions(neutralDecisions), 'Coordinated names preserve completed decisions.');

const linter = new Linter();
const config = [{ plugins: { resilient }, rules: {
    'resilient/prefer-destructured-member-access': 'error', 'resilient/prefer-safe-destructuring-defaults': 'error'
} }];
const observe = async (text = '') => {
    const resolved = ['object', 'array', 'function'].reduce((result, module) => result.replaceAll(
        `eslint-plugin-resilient/standard/${module}`, import.meta.resolve(`eslint-plugin-resilient/standard/${module}`)
    ), text);
    const { default: observation = '' } = await import(`data:text/javascript,${encodeURIComponent(resolved)}`);

    return observation;
};
const modes = ['present', 'missing', 'undefined', 'null', 'getter-throw', 'predicate-throw', 'argument-throw', 'sibling-throw', 'skipped', 'deferred'];
await Promise.all(['baseValue', 'identity'].flatMap(member => modes.map(async (mode) => {
    const source = [
        'const events:string[]=[];const marker={};const token={};',
        `function read<T>(provider:{${member}:T},gate:{choose:(a:number,b:number)=>boolean},first:()=>number,second:()=>number,next:()=>T){`,
        `return gate.choose(first(),second())?provider.${member}:next();}`,
        `const mode=${JSON.stringify(mode)};let count=0;`,
        `const provider=mode==='null'?null:mode==='missing'?{}:{get ${member}(){events.push('get');count++;if(mode==='getter-throw')throw marker;`,
        "return mode==='undefined'||mode==='deferred'&&count>1?undefined:token;}};",
        "const first=()=>{events.push('argument1');return 1;};const second=()=>{events.push('argument2');if(mode==='argument-throw')throw marker;return 2;};",
        "const gate={choose(a,b){events.push(this===gate&&a===1&&b===2?'predicate':'bad receiver/args');if(mode==='predicate-throw')throw marker;",
        "return !['skipped','sibling-throw'].includes(mode);}};",
        "const next=()=>{events.push('sibling');if(mode==='sibling-throw')throw marker;return token;};",
        'let result;let error;try{',
        "if(mode==='deferred'){const later=()=>read(provider,gate,first,second,next);events.push('created');result=later();later();}else result=read(provider,gate,first,second,next);",
        '}catch(failure){error=failure;}',
        "export default JSON.stringify({events,count,identity:result===token,missing:result===undefined,marker:error===marker,errorName:error?.name});"
    ].join('\n');
    const { outputText: native = '' } = typescript.transpileModule(source, { compilerOptions: options });
    const fileName = member + '-' + mode + '.ts';
    const sourceFile = typescript.createSourceFile(fileName, source, typescript.ScriptTarget.ESNext, true);
    const runtimeProgram = typescript.createProgram([fileName], options, {
        ...host, getSourceFile: (name, version) => name === fileName ? sourceFile : host.getSourceFile(name, version)
    });
    const transformer = createTypeScriptTransformer({ typescript, program: runtimeProgram });
    const { code = '', diagnostics = [], agreements = [] } = transformer.transform({ code: source, fileName: member + '-' + mode + '.ts' });
    assert.deepEqual(diagnostics, [], mode);
    assert.ok(agreements.some(({ action = '' } = {}) => action === 'exact-provider-forwarded'), mode);
    const { output: fixed = code, messages = [] } = linter.verifyAndFix(code, config);
    assert.deepEqual(messages, [], mode);
    const expected = await observe(native);
    const { events = [], count = 0, marker = false, errorName = '', identity = false, missing = false } = JSON.parse(expected);
    const prefix = ['argument1', 'argument2'];
    const called = mode === 'argument-throw' ? prefix : [...prefix, 'predicate'];
    const expectedEvents = ['argument-throw', 'predicate-throw', 'null', 'missing'].includes(mode) ? called
        : [...called, ['skipped', 'sibling-throw'].includes(mode) ? 'sibling' : 'get'];
    assert.deepEqual(events, mode === 'deferred' ? ['created', ...expectedEvents, ...expectedEvents] : expectedEvents);
    assert.equal(count, events.filter(event => event === 'get').length);
    assert.equal(marker, mode.endsWith('throw'));
    assert.equal(errorName, mode === 'null' ? 'TypeError' : '');
    assert.equal(identity, ['present', 'skipped', 'deferred'].includes(mode));
    assert.equal(missing, !identity);
    assert.equal(await observe(code), expected, member + ':' + mode + ':raw');
    assert.equal(await observe(fixed), expected, member + ':' + mode + ':fixed');
})));
