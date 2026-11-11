import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { ESLint, Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';
import { isFunction } from 'eslint-plugin-resilient/standard/function';

import { counter } from './support/work.js';

const filename = fileURLToPath(import.meta.url);
const resolveGuard = ({ source = '' } = {}) => source === 'eslint-plugin-resilient/standard/function'
    ? fileURLToPath(import.meta.resolve(source)) : '';
const configuration = { settings: { resilient: { resolver: resolveGuard } }, plugins: { resilient: plugin }, rules: {
    'resilient/prefer-safe-destructuring-defaults': 'error',
    'resilient/no-unguarded-callback-invocation': 'error',
    'resilient/signature-contract-destructuring': 'error',
    'resilient/signature-contract-operation': 'error'
} };
const lint = source => new Linter().verify(source, configuration, { filename });
const imported = "import { isFunction as callable } from 'eslint-plugin-resilient/standard/function';";

[
    ['unrelated parameter initialization', 'const run=(owner={},state=createState())=>{const {onDone}=owner;if(callable(onDone))onDone.call(owner);};'],
    ['callback beside parameter initialization', 'const run=({onDone,state=createState()}={})=>{if(callable(onDone))onDone();};'],
    ['member callback capture', 'const run=({onDone}={})=>{if(!callable(onDone))return;values.map(()=>onDone());};'],
    ['constructor argument callback', 'const run=({onDone}={})=>{if(!callable(onDone))return;return new Map(values.map(()=>onDone()));};'],
    ['nested constructor argument callback', 'const run=({onDone}={})=>new Map(values.map(value=>{if(!callable(onDone))return [];return [value,new Map(others.map(()=>onDone()))];}));'],
    ['guarded loop use', 'const run=(owner={})=>{const {onDone}=owner;while(more()){if(callable(onDone))onDone();}};'],
    ['optional method', 'const run=(owner={})=>{const {onDone}=owner;if(callable(onDone))onDone.call(owner);};'],
    ['guard inside closure', 'const run=(owner={})=>{const {onDone}=owner;return ()=>callable(onDone)?onDone():false;};'],
    ['predicate-only use', 'const run=(owner={})=>{const {onDone}=owner;return callable(onDone);};'],
    ['optional callback', 'const run=({onDone}={})=>{if(callable(onDone))onDone(1);};'],
    ['required callback', 'const run=({onDone}={})=>{if(!callable(onDone))throw new TypeError("Required callback");onDone(1);};'],
    ['captured callback', 'const run=({onDone}={})=>{if(!callable(onDone))return;return ()=>onDone(1);};'],
    ['receiver call', 'const run=({onDone}={})=>{if(callable(onDone))onDone.call(receiver,1);};'],
    ['receiver apply', 'const run=({onDone}={})=>{if(callable(onDone))onDone.apply(receiver,[1]);};']
].forEach(([name = '', source = ''] = []) => test(`public callable guard owns natural absence: ${name}`, () => {
    deepStrictEqual(lint(`${imported}${source}`), []);
}));

test('a guarded call does not excuse another unguarded invocation', () => {
    const source = `${imported}const run=({onDone}={})=>{if(callable(onDone))onDone(1);onDone(2);};`;
    const findings = lint(source);

    deepStrictEqual(findings.map(({ ruleId = '' } = {}) => ruleId), ['resilient/no-unguarded-callback-invocation']);
});

test('a locally misleading predicate cannot borrow the standard helper contract', () => {
    const source = 'const isFunction=value=>true;const run=({onDone}={})=>{if(isFunction(onDone))onDone(1);};';

    deepStrictEqual(lint(source).map(({ ruleId = '' } = {}) => ruleId), [
        'resilient/prefer-safe-destructuring-defaults', 'resilient/no-unguarded-callback-invocation'
    ]);
});

test('public guards preserve a single property read, the receiver, arguments, return and thrown identity', () => {
    let events = [];
    const failure = new Error('owned call failure');
    const result = Object.freeze({ value: 3 });
    const invoke = (owner, ...args) => {
        const { onDone } = owner;

        if (!isFunction(onDone)) return false;

        return onDone.apply(owner, args);
    };
    const owner = { get onDone() {
        events = [...events, 'get'];

        return function (...args) {
            strictEqual(this, owner);
            deepStrictEqual(args, [1, 2]);
            events = [...events, 'call'];

            return result;
        };
    } };

    strictEqual(invoke(owner, 1, 2), result);
    deepStrictEqual(events, ['get', 'call']);
    [null, false, 0, '', {}, []].forEach(onDone => strictEqual(invoke({ onDone }), false));
    strictEqual(invoke({}), false);
    throws(() => invoke({ get onDone() { throw failure; } }), error => error === failure);
    throws(() => invoke({ onDone() { throw failure; } }), error => error === failure);
});

test('callable absence does not relax a null receiver or an unrelated required field', () => {
    const source = `${imported}const run=()=>{const {onDone}=null;if(callable(onDone))onDone();};`;
    const unrelated = `${imported}const run=(owner={})=>{const {onDone,other}=owner;if(callable(onDone))onDone();return other;};`;

    strictEqual(lint(source).some(({ messageId = '' } = {}) => messageId === 'mismatch'), true);
    strictEqual(lint(unrelated).some(({ message = '' } = {}) => message.includes('Property other')), true);
});

[16, 32, 64].forEach(width => test(`callable absence shares guard evidence across ${width} fields`, (context) => {
    const names = Array.from({ length: width }, (value, index) => `field${index}`);
    const source = `const isFunction=value=>typeof value==='function';const run=(owner={})=>{const {${names.join(',')}}=owner;`
        + `return [${names.map(name => `isFunction(${name})`).join(',')}];};`;
    const analysis = createAnalysis({ source });
    const declarations = analysis.declarations.filter(({ name = '' } = {}) => names.includes(name));
    const work = counter();
    const { onWork = () => {} } = work;

    declarations.forEach(({ index = -1 } = {}) => strictEqual(analysis.checkDeclaration({ index, onWork }).required, false));
    analysis.destructuringFields.forEach(({ index = -1 } = {}) => {
        const { status = '', fact: { presence = [] } = {} } = analysis.checkDestructuringField({ index, onWork });

        strictEqual(status === 'contradiction', false);
        strictEqual(presence.includes('absent'), true);
    });
    const before = work.read();

    declarations.toReversed().forEach(({ index = -1 } = {}) => analysis.checkDeclaration({ index, onWork }));
    deepStrictEqual(work.read(), before);
    context.diagnostic(JSON.stringify({ width, ...before }));
}));

test('body guard evidence does not fabricate an initialized source or return contract', () => {
    const source = "const callable=value=>typeof value==='function';const run=(owner={},state=createState())=>{"
        + 'const {onDone}=owner;if(callable(onDone))onDone.call(owner);return state;};';
    const analysis = createAnalysis({ source });
    const { index = -1 } = analysis.functions.at(1);
    const { status = '', fact: { causes = [] } = {} } = analysis.checkFunction({ index });

    strictEqual(status, 'unknown');
    strictEqual(causes.some(({ code = '' } = {}) => code === 'opaque-execution'), true);
    deepStrictEqual(lint(source), []);
});

test('the shipped tuple transformer retains guards beside its actual constructor defaults', async () => {
    const sourceFile = fileURLToPath(new URL('./grammar/curried-selected-tuple.js', import.meta.resolve('eslint-plugin-resilient/typescript')));
    const virtualFile = fileURLToPath(new URL('callable-tuple-input.js', import.meta.url));
    const resolver = ({ from = '', source = '' } = {}) => source.startsWith('.')
        ? resolve(dirname(from === virtualFile ? sourceFile : from), source) : resolveGuard({ source });
    const engine = new ESLint({ overrideConfigFile: true, overrideConfig: [{ ...configuration, settings: { resilient: { resolver } } }] });
    const [{ messages = [] } = {}] = await engine.lintText(readFileSync(sourceFile, 'utf8'), { filePath: virtualFile });

    deepStrictEqual(messages, []);
});

test('an initializer write cannot borrow a guard on the captured callback', () => {
    const source = 'const run=({onDone}={})=>{const read=({value=void(onDone=external)}={})=>value;'
        + 'if(typeof onDone!=="function")return;read();onDone();};';
    const analysis = createAnalysis({ source });
    const { index = -1 } = analysis.declarations.find(({ name = '' } = {}) => name === 'onDone');

    strictEqual(analysis.checkDeclaration({ index }).required, true);
});

test('member-call arguments cannot invalidate a guard and lend it to a later closure', () => {
    const source = 'const run=({onDone}={})=>{if(typeof onDone!=="function")return;'
        + 'host.register(onDone=external,()=>onDone());};';

    strictEqual(lint(source).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true);
});

test('constructor arguments retain native failure order without borrowing ordinary call semantics', () => {
    const setup = 'const stop=()=>{throw 1;};const later=()=>"late";';
    const bodies = ['new (function(){return "wrong";})(stop(),later())', 'new (stop())(later())', 'new (()=>"wrong")(stop(),later())'];

    bodies.forEach((body) => {
        const source = `${setup}const read=()=>${body};`;
        const analysis = createAnalysis({ source });
        const { index = -1 } = analysis.functions.at(2);
        const work = counter();
        const { normal = true, thrown = false, fact: { families = [] } = {} } = analysis.checkFunction({ index, onWork: event => work.onWork(event) });

        throws(() => runInNewContext(`${source}read();`), error => error === 1);
        deepStrictEqual({ normal, thrown, families }, { normal: false, thrown: true, families: [] });
        strictEqual(work.get('function-context'), 2);
    });
    const analysis = createAnalysis({ source: 'const read=()=>new (function(){return "wrong";})();' });
    const { status = '', fact: { families = [] } = {} } = analysis.checkFunction({ index: 0 });

    strictEqual(status, 'unknown');
    deepStrictEqual(families, []);
});

test('a write in a constructor argument invalidates a captured callback guard', () => {
    const source = 'const run=({onDone}={})=>{if(typeof onDone!=="function")return;'
        + 'new Factory(onDone=external,()=>onDone());};';

    strictEqual(lint(source).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true);
});

test('loop branch evidence stays local and cannot establish completion or survive callback mutation', () => {
    const bodies = [
        'if(typeof onDone==="function")onDone();if(external)onDone();',
        'if(typeof onDone!=="function")onDone();',
        'if(typeof other==="function")onDone();',
        'if(typeof onDone==="function"){onDone=external;onDone();}'
    ];

    bodies.forEach((body) => {
        const analysis = createAnalysis({ source: `const run=({onDone,other}={})=>{while(external){${body}}};` });
        const invocations = analysis.invocations.filter(({ name = '' } = {}) => name === 'onDone');
        const { index = -1 } = invocations.at(-1);

        strictEqual(analysis.checkInvocation({ index }).status === 'agreement', false);
        const { status = '', fact: { families = [] } = {} } = analysis.checkFunction({ index: 0 });

        strictEqual(status, 'unknown');
        deepStrictEqual(families, []);
    });
});

[16, 32, 64].forEach(width => test(`loop guard demand shares ${width} acquired branches without expanding loop outcomes`, (context) => {
    const body = Array.from({ length: width }, () => 'if(typeof onDone==="function")onDone();').join('');
    const analysis = createAnalysis({ source: `const run=({onDone}={})=>{while(external){${body}}};` });
    const invocations = analysis.invocations.filter(({ name = '' } = {}) => name === 'onDone');
    const work = counter();

    invocations.forEach(({ index = -1 } = {}) => strictEqual(analysis.checkInvocation({ index, onWork: event => work.onWork(event) }).status, 'agreement'));
    const before = work.read();

    invocations.toReversed().forEach(({ index = -1 } = {}) => analysis.checkInvocation({ index, onWork: event => work.onWork(event) }));
    deepStrictEqual(work.read(), before);
    context.diagnostic(JSON.stringify({ width, ...before }));
}));
