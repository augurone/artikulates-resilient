import { deepStrictEqual, strictEqual, ok, throws, rejects } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { ESLint, Linter } from 'eslint';
import { parse } from 'espree';

import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/promise-ownership.json', import.meta.url), 'utf8'));
const lint = new ESLint({ overrideConfigFile: true, overrideConfig: {
    plugins: { resilient: plugin }, rules: { 'resilient/no-unhandled-promise-chain': 'error' }
} });
const findings = (analysis) => {
    const { promiseUses = [] } = analysis;

    return promiseUses.map(({ index = -1 } = {}) => analysis.checkPromiseUse({ index })).filter(({ unhandled = false } = {}) => unhandled);
};
cases.forEach(({ name = '', source = '', findings: expected = 0 } = {}) => {
    test(`promise ownership evidence: ${name}`, () => strictEqual(findings(createAnalysis({ source })).length, expected));
    test(`product promise ownership: ${name}`, async () => {
        const [{ messages = [] } = {}] = await lint.lintText(source);

        strictEqual(messages.length, expected);
        messages.forEach(({ ruleId = '', messageId = '', fix = false, suggestions = [] } = {}) => {
            strictEqual(ruleId, 'resilient/no-unhandled-promise-chain');
            strictEqual(messageId, 'unhandled');
            strictEqual(fix, false);
            deepStrictEqual(suggestions, []);
        });
    });
});

test('promise alternatives preserve known work beside unknown without borrowing caller facts', () => {
    const source = 'const load=async()=>1;const forward=value=>value;forward(load());forward(external);'
        + 'const mixed=()=>flag?load():external;mixed();';
    const first = createAnalysis({ source });
    const second = createAnalysis({ source });
    const before = first.checkFunction({ index: 1 });
    const found = findings(first);

    strictEqual(found.length, 2);
    const { alternatives = [] } = found.at(1);
    const { status = '' } = before;

    deepStrictEqual(alternatives.toSorted(), ['known', 'unknown']);
    strictEqual(status, 'unknown');
    deepStrictEqual(first.checkFunction({ index: 1 }), before);
    second.promiseUses.toReversed().forEach(({ index = -1 } = {}) => second.checkPromiseUse({ index }));
    deepStrictEqual(findings(second), found);
    deepStrictEqual(second.checkFunction({ index: 1 }), before);
});

test('public ownership queries freeze snapshots, validate indices and reuse completed demand', () => {
    const analysis = createAnalysis({ source: 'const load=async()=>1;const forward=()=>load();forward();' });
    const work = counter();
    const result = analysis.checkPromiseUse({ index: 0, onWork: event => work.onWork(event) });
    const before = work.read();
    const { promiseUses = [] } = analysis;
    const { alternatives = [] } = result;

    [promiseUses, promiseUses.at(0), result, alternatives].forEach(value => ok(Object.isFrozen(value)));
    deepStrictEqual(analysis.checkPromiseUse({ index: 0, onWork: event => work.onWork(event) }), result);
    deepStrictEqual(work.read(), before);
    [-1, 1, NaN, '0'].forEach(index => throws(() => analysis.checkPromiseUse({ index }), RangeError));
});

test('ownership snapshots and source revisions remain independent of host edits', () => {
    const source = 'const load=async()=>1;load();';
    const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
    const first = createProgramAnalysis({ program });

    runInNewContext('program.body[0].declarations[0].init.async=false;', { program });
    const second = createProgramAnalysis({ program });

    strictEqual(findings(first).length, 1);
    strictEqual(findings(second).length, 0);
    strictEqual(findings(first).length, 1);
});

test('every observed promise-proof failure propagates and permits a complete retry', () => {
    const source = 'const load=async()=>1;const forward=()=>flag?load():external;forward();';
    const expected = findings(createAnalysis({ source }));
    const work = counter();

    createAnalysis({ source }).checkPromiseUse({ index: 0, onWork: event => work.onWork(event) });
    Object.keys(work.read()).forEach((interrupted) => {
        const analysis = createAnalysis({ source });

        throws(() => analysis.checkPromiseUse({ index: 0, onWork: ({ kind = '' } = {}) => {
            if (kind === interrupted) throw new Error(`interrupted ${kind}`);
        } }), /interrupted/);
        deepStrictEqual(findings(analysis), expected);
    });
});

test('async invocation and argument failure have distinct native completion obligations', async () => {
    strictEqual(runInNewContext('(async()=>1)() instanceof Promise'), true);
    await rejects(runInNewContext('(async()=>{throw new Error("body");})()'), /body/);
    await rejects(runInNewContext('const fail=()=>{throw new Error("default");};(async(value=fail())=>value)()'), /default/);
    await rejects(runInNewContext('new Promise(()=>{throw new Error("executor");})'), /executor/);
    throws(() => runInNewContext('const fail=()=>{throw new Error("argument");};(async()=>1)(fail())'), /argument/);
    throws(() => runInNewContext('new Promise(0)'), /not a function/);
    strictEqual(runInNewContext('(async function*(){yield 1;})() instanceof Promise'), false);
});

test('the documented catch boundary does not certify subsequent rejection handling', async () => {
    const source = 'Promise.resolve().catch(()=>1).then(()=>{throw new Error("later");});';

    strictEqual(findings(createAnalysis({ source })).length, 0);
    await rejects(runInNewContext(source), /later/);
    const both = new ESLint({ overrideConfigFile: true, overrideConfig: {
        plugins: { resilient: plugin }, rules: { 'resilient/no-unhandled-promise-chain': 'error', 'resilient/prefer-async-await': 'warn' }
    } });
    const [{ messages = [] } = {}] = await both.lintText(source);

    deepStrictEqual(messages.map(({ ruleId = '' } = {}) => ruleId), ['resilient/prefer-async-await']);
});

test('shared chain syntax gives the ownership error priority over the style warning', async () => {
    const both = new ESLint({ overrideConfigFile: true, overrideConfig: {
        plugins: { resilient: plugin }, rules: { 'resilient/no-unhandled-promise-chain': 'error', 'resilient/prefer-async-await': 'warn' }
    } });
    const [{ messages = [] } = {}] = await both.lintText('request().then(first).then(second).finally(cleanup);');

    deepStrictEqual(messages.map(({ ruleId = '' } = {}) => ruleId), ['resilient/no-unhandled-promise-chain']);
});

test('source-backed async identity crosses renamed exports without executing dependency bodies', () => {
    const source = 'import { dispatch as launch } from "barrel";launch();';
    const acquire = dependency => createAnalysis({ source, filename: 'main', resolveModule: ({ source: name = '' } = {}) => ({
        filename: name, source: name === 'barrel' ? 'export { run as dispatch } from "worker";' : dependency
    }) });
    const first = acquire('throw new Error("NEVER EXECUTE");export async function run(){throw new Error("rejection");}');
    const second = acquire('export const run=()=>1;');

    strictEqual(findings(first).length, 1);
    strictEqual(findings(second).length, 0);
    strictEqual(findings(first).length, 1);
    strictEqual(findings(acquire('export async function* run(){yield 1;}')).length, 0);
    strictEqual(findings(acquire('export let run=async()=>1;run=external;')).length, 0);
    strictEqual(findings(acquire('export async function run(){}eval("run=()=>1");')).length, 0);
    strictEqual(findings(acquire('export async function run(){}const change=()=>eval("run=()=>1");change();')).length, 0);
    const failure = new Error('required source failed');

    throws(() => createAnalysis({ source, resolveModule: () => { throw failure; } }), error => error === failure);
    throws(() => createAnalysis({ source, resolveModule: () => ({ filename: 'worker' }) }), TypeError);
});

test('default declarations keep live binding identity while default expressions keep their source identity', () => {
    const source = 'import launch from "worker";launch();';
    const acquire = dependency => createAnalysis({ source, filename: 'main', resolveModule: () => ({ filename: 'worker', source: dependency }) });

    strictEqual(findings(acquire('export default async function run(){}')).length, 1);
    strictEqual(findings(acquire('export default async function run(){}run=()=>1;')).length, 0);
    strictEqual(findings(acquire('export default async function run(){}eval("run=()=>1");')).length, 0);
    strictEqual(findings(acquire('export default (async function run(){});')).length, 1);
});

test('product module snapshots observe async source revisions and live default bindings', async (context) => {
    const directory = mkdtempSync(join(tmpdir(), 'resilient-promises-'));

    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const worker = join(directory, 'worker.js');
    const barrel = join(directory, 'barrel.js');
    const main = join(directory, 'main.js');
    const source = 'import { dispatch as launch } from "./barrel.js";launch();';
    const engine = new ESLint({ cwd: directory, overrideConfigFile: true, overrideConfig: {
        plugins: { resilient: plugin }, rules: { 'resilient/no-unhandled-promise-chain': 'error' }
    } });

    writeFileSync(worker, 'throw new Error("NEVER EXECUTE");export const run=async()=>1;');
    writeFileSync(barrel, 'export { run as dispatch } from "./worker.js";');
    const [{ messages: first = [] } = {}] = await engine.lintText(source, { filePath: main });

    strictEqual(first.length, 1);
    writeFileSync(worker, 'export const run=()=>1;');
    const [{ messages: second = [] } = {}] = await engine.lintText(source, { filePath: main });

    deepStrictEqual(second, []);
    writeFileSync(worker, 'export async function run(){throw new Error("rejection");}');
    const [{ messages: third = [] } = {}] = await engine.lintText(source, { filePath: main });

    strictEqual(third.length, 1);
    writeFileSync(barrel, 'export { default as dispatch } from "./worker.js";');
    writeFileSync(worker, 'export default async function run(){}run=()=>1;');
    const [{ messages: changed = [] } = {}] = await engine.lintText(source, { filePath: main });

    deepStrictEqual(changed, []);
    writeFileSync(worker, 'export default async function run(){}eval("run=()=>1");');
    const [{ messages: dynamic = [] } = {}] = await engine.lintText(source, { filePath: main });

    deepStrictEqual(dynamic, []);
});

test('native module execution distinguishes live default declarations from expression snapshots', () => {
    const { execPath = '' } = process;
    const source = `
        const live=await import('data:text/javascript,'+encodeURIComponent('export default async function run(){}run=()=>1;'));
        const snapshot=await import('data:text/javascript,'+encodeURIComponent('let run=async()=>1;export default run;run=()=>1;'));
        const pending=snapshot.default();
        console.log(JSON.stringify({live:live.default(),snapshot:pending instanceof Promise,value:await pending}));
    `;
    const result = JSON.parse(execFileSync(execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' }));

    deepStrictEqual(result, { live: 1, snapshot: true, value: 1 });
});

test('unknown and mixed Promise executors retain possible synchronous failure', () => {
    ['const run=executor=>new Promise(executor);', 'const run=flag=>new Promise(flag?()=>1:0);'].forEach((source) => {
        const analysis = createAnalysis({ source });
        const { normal = false, thrown = false } = analysis.checkFunction({ index: 0 });

        strictEqual(normal, true);
        strictEqual(thrown, true);
    });
    const { thrown = true } = createAnalysis({ source: 'const run=()=>new Promise(()=>1);' }).checkFunction({ index: 0 });

    strictEqual(thrown, false);
});

test('async predicates cannot validate a supplied callback through synchronous guard evidence', () => {
    const source = 'const callable=async value=>typeof value==="function";const use=({action})=>{if(callable(action))action();};';
    const analysis = createAnalysis({ source });
    const { declarations = [] } = analysis;
    const { index = -1 } = declarations.find(({ name = '' } = {}) => name === 'action') ?? {};
    const { required = false } = analysis.checkDeclaration({ index });

    strictEqual(required, true);
    throws(() => runInNewContext(`${source}use({action:42});`), ({ name = '' } = {}) => name === 'TypeError');
});

test('async and generator consumers carry callable requirements to the forwarding site', async () => {
    const guard = 'const isFunction=value=>typeof value==="function";';
    const pending = 'async function consume(cb){cb();}const run=({action})=>{if(action)return consume(action);};';
    const iterator = 'function* consume(cb){yield cb();}const run=({action})=>{if(action)consume(action).next();};';

    [pending, iterator].forEach((source) => {
        const requiredFor = (program) => {
            const analysis = createAnalysis({ source: guard + program });
            const { index = -1 } = analysis.declarations.find(({ name = '' } = {}) => name === 'action') ?? {};

            return analysis.checkDeclaration({ index }).required;
        };

        strictEqual(requiredFor(source), true, source);
        strictEqual(requiredFor(source.replace('if(action)', 'if(isFunction(action))')), false, source);
    });
    await rejects(runInNewContext(`${pending}run({action:42});`), ({ name = '' } = {}) => name === 'TypeError');
    throws(() => runInNewContext(`${iterator}run({action:42});`), ({ name = '' } = {}) => name === 'TypeError');
});

[
    ['an unknown apply spread', 'const prefix=[];async function consume(cb){cb();}'
        + 'function Relay(...args){this.pending=consume.apply(...prefix,null,args);}'],
    ['a chained receiver protocol', 'async function consume(cb){cb();}'
        + 'function Relay(...args){this.pending=consume.call.apply(consume,[null,...args]);}'],
    ['a replaced receiver protocol', 'const consume=cb=>{};consume.apply=async(receiver,cb)=>{cb();};'
        + 'function Relay(...args){this.pending=consume.apply(null,...args);}'],
    ['a tagged substitution', 'async function consume(parts,cb){cb();}'
        + 'function Relay(cb){this.pending=consume`value=${cb}`;}']
].forEach(([name = '', relay = ''] = []) => test(`constructor relays preserve an async consumer requirement through ${name}`, async () => {
    const prefix = 'const isFunction=value=>typeof value==="function";' + relay;
    const make = condition => `${prefix}const run=({action})=>{if(${condition})return new Relay(action).pending;};`;

    [true, false].forEach((required) => {
        const source = make(required ? 'action' : 'isFunction(action)');
        const analysis = createAnalysis({ source });
        const { index = -1 } = analysis.declarations.find(({ name = '' } = {}) => name === 'action') ?? {};

        strictEqual(analysis.checkDeclaration({ index }).required, required, source);
    });
    await rejects(runInNewContext(`${make('action')}run({action:42});`), ({ name = '' } = {}) => name === 'TypeError');
    strictEqual(runInNewContext(`${make('isFunction(action)')}run({action:42})===void 0;`), true);
}));

test('the native Promise executor keeps its callable requirement through construction and forwarding', () => {
    const scenarios = [
        ['', 'new Promise(action)'], ['', 'new Promise(...prefix,action)'],
        ['const Build=Promise;', 'new Build(...[],action)'],
        ['function Other(value){}', 'new (flag?Promise:Other)(action)'],
        ['function Relay(...args){new Promise(...args);}', 'new Relay(action)']
    ];
    const prelude = 'const isFunction=value=>typeof value==="function";const prefix=[];const flag=true;';
    const requiredFor = (source) => {
        const analysis = createAnalysis({ source });
        const { index = -1 } = analysis.declarations.find(({ name = '' } = {}) => name === 'action') ?? {};

        return analysis.checkDeclaration({ index }).required;
    };

    scenarios.forEach(([definitions = '', use = ''] = []) => {
        const make = condition => `${prelude}${definitions}const run=({action})=>{if(${condition})${use};};`;
        const unguarded = make('action');

        strictEqual(requiredFor(unguarded), true, unguarded);
        strictEqual(requiredFor(make('isFunction(action)')), false, use);
        throws(() => runInNewContext(`${unguarded}run({action:42});`), ({ name = '' } = {}) => name === 'TypeError');
    });
    strictEqual(requiredFor('function Promise(value){this.value=value;}const run=({action})=>{if(action)new Promise(action);};'), false);
    const replacement = 'Promise=function(value){this.value=value;};';
    const direct = replacement + 'const run=({action})=>{if(action)return new Promise(action);};';
    const alias = 'const Build=Promise;';
    const run = 'const run=({action})=>{if(action)return new Build(action);};';

    strictEqual(requiredFor(direct), false);
    strictEqual(runInNewContext(`${direct}run({action:42}).value;`), 42);
    strictEqual(requiredFor(replacement + alias + run), false);
    strictEqual(runInNewContext(`${replacement}${alias}${run}run({action:42}).value;`), 42);
    strictEqual(requiredFor(alias + replacement + run), true);
    throws(() => runInNewContext(`${alias}${replacement}${run}run({action:42});`), ({ name = '' } = {}) => name === 'TypeError');
});

test('only a proved Promise replacement retires the native executor requirement', async () => {
    const helper = 'const isFunction=value=>typeof value==="function";';
    const rules = { plugins: { resilient: plugin }, rules: { 'resilient/prefer-safe-destructuring-defaults': 'error' } };
    const cases = [
        ['const available=typeof Promise==="function";', 'run({action:resolve=>resolve(7)})'],
        ['if(false)Promise=function(payload){this.value=payload;};const available=true;', 'run({action:resolve=>resolve(7)})'],
        ['Promise.resolve=value=>value;const available=true;', 'run({action:resolve=>resolve(7)})'],
        ['Promise=function(executor){this.value=executor();};const available=true;', 'run({action:()=>7}).value']
    ];

    await Promise.all(cases.map(async ([prefix = '', invoke = ''] = []) => {
        const make = condition => `${helper}${prefix}const run=({action})=>{if(available&&${condition})return new Promise(action);};`;
        const truthy = make('action');
        const guarded = make('isFunction(action)');

        strictEqual(new Linter().verify(truthy, rules).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true, prefix);
        throws(() => runInNewContext(`${truthy}run({action:42});`), ({ name = '' } = {}) => name === 'TypeError');
        deepStrictEqual(new Linter().verify(guarded, rules), [], prefix);
        strictEqual(runInNewContext(`${guarded}run({action:42})===void 0;`), true);
        strictEqual(await runInNewContext(`${guarded}${invoke};`), 7);
    }));

    const data = 'Promise=function(payload){this.value=payload;};const run=({action})=>{if(action)return new Promise(action);};';

    deepStrictEqual(new Linter().verify(data, rules), []);
    strictEqual(runInNewContext(`${data}run({action:42}).value;`), 42);
});

test('standalone result queries cannot overwrite enclosing guard and member proofs', async () => {
    const source = 'const use=({action}={})=>{if(typeof action!=="function")return;action();};'
        + 'const run=value=>{if(typeof value==="string")value.trim();};';
    const read = analysis => ({
        declarations: analysis.declarations.map(({ index = -1 } = {}) => analysis.checkDeclaration({ index })),
        invocations: analysis.invocations.map(({ index = -1 } = {}) => analysis.checkInvocation({ index })),
        members: analysis.memberAccesses.map(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }))
    });
    const first = createAnalysis({ source });
    const expected = read(first);
    const second = createAnalysis({ source });

    findings(second);
    deepStrictEqual(read(second), expected);
    findings(first);
    deepStrictEqual(read(first), expected);
    const { declarations: [{ required = true } = {}] = [] } = expected;

    strictEqual(required, false);
    const names = ['no-unhandled-promise-chain', 'prefer-safe-destructuring-defaults', 'no-unguarded-callback-invocation', 'signature-contract-operation'];
    const results = await Promise.all([names, names.toReversed()].map(async (order) => {
        const engine = new ESLint({ overrideConfigFile: true, overrideConfig: {
            plugins: { resilient: plugin }, rules: Object.fromEntries(order.map(name => [`resilient/${name}`, 'error']))
        } });
        const [{ messages = [] } = {}] = await engine.lintText(source);

        return messages;
    }));

    deepStrictEqual(results, [[], []]);
});

const policyRules = {
    'resilient/no-unhandled-promise-chain': 'error',
    'resilient/prefer-async-await': 'warn',
    'resilient/no-silent-catch': 'error'
};
const policyConfig = { plugins: { resilient: plugin }, rules: policyRules };
const policyFindings = source => new Linter().verify(source, policyConfig);
const policyCases = JSON.parse(readFileSync(new URL('./fixtures/promise-policy.json', import.meta.url), 'utf8'));
const chainCases = JSON.parse(readFileSync(new URL('./fixtures/promise-chains.json', import.meta.url), 'utf8'));

policyCases.forEach(({ rule = '', source = '', options = [], findings: expected = [] } = {}) => test(`promise policy ${rule}: ${source}`, () => {
    deepStrictEqual(new Linter().verify(source, { plugins: { resilient: plugin }, rules: { [`resilient/${rule}`]: ['error', ...options] } }), expected);

    if (rule === 'no-unhandled-promise-chain') strictEqual(findings(createAnalysis({ source })).length, expected.length);
}));

chainCases.forEach(({ name = '', source = '', expected = [] } = {}) => test(`promise chain ownership: ${name}`, () => {
    deepStrictEqual(policyFindings(source), expected);
}));

[
    ['request[method](handle);', []], ['request[`then`](handle);', []], ['const then=request.then;then(handle);', []],
    ['request.then;', []], ['new request.then(handle);', []], ['request.then(handle)["catch"](report);', ['asyncAwait']],
    ['request["then"](handle).catch(report);', ['asyncAwait']], ['request.then(handle)[method](report);', ['unhandled']],
    ['request["then"](handle).catch;', ['asyncAwait']], ['(0,request.then)(handle);', []],
    ['request.then(()=>other["then"](handle).catch(report));', ['unhandled', 'asyncAwait']],
    ['request.then(()=>{other["then"](handle);}).catch(report);', ['asyncAwait', 'unhandled']],
    ['request.then`${other["then"](handle)}`;', ['unhandled', 'asyncAwait']],
    ['try {work();} catch {request["then"](handle);}', ['unhandled']],
    ['try {work();} catch {} finally {cleanup();}', ['silentCatch']],
    ['const run=async()=>1;run`value`;', []]
].forEach(([source = '', expected = []] = []) => test(`boundary and composition: ${source}`, () => {
    deepStrictEqual(policyFindings(source).map(({ messageId = '' } = {}) => messageId), expected);
}));

test('style exceptions do not waive ownership or silent catches', () => {
    const source = '// eslint-disable-next-line resilient/prefer-async-await -- Required chain contract.\nrequest["then"](handle);';
    const messages = policyFindings(source).filter(({ ruleId = '' } = {}) => ruleId);

    deepStrictEqual(messages.map(({ messageId = '' } = {}) => messageId), ['unhandled']);
    deepStrictEqual(policyFindings('// eslint-disable-next-line resilient/prefer-async-await -- Required chain contract.\nrequest["then"](handle).catch(report);'), []);
    strictEqual(policyFindings('try {work();} catch {/* explanation alone */}').length, 1);
});

test('syntax chains do not establish promise identity or callable rejection handling', async () => {
    const unknown = createAnalysis({ source: 'external();' });

    deepStrictEqual(unknown.promiseUses.map(({ index = -1 } = {}) => unknown.checkPromiseUse({ index }).reason), ['unknown-result']);
    strictEqual(policyFindings('custom["then"](handle);').length, 1);
    const rejected = 'Promise.reject(new Error("unhandled"))["catch"](0);';

    deepStrictEqual(policyFindings(rejected), []);
    await rejects(runInNewContext(rejected), /unhandled/);
    const later = 'Promise.resolve()["catch"](report)["then"](()=>{throw new Error("later");});';

    await rejects(runInNewContext(later, { report: () => 0 }), /later/);
    deepStrictEqual(policyFindings(later).map(({ messageId = '' } = {}) => messageId), ['asyncAwait']);
    await rejects(runInNewContext('Promise.reject(new Error("tag"))["catch"]`value`;'), /tag/);
});

test('promise policy preserves diagnostics and source when fixing mixed chain forms', () => {
    const source = 'request.then(handle);request["then"](handle).catch(report);'
        + '(request?.then)`value`;const result=request.then(first).then(second);';
    const expected = policyFindings(source);
    const { output = '', fixed = true, messages = [] } = new Linter().verifyAndFix(source, policyConfig);

    strictEqual(output, source);
    strictEqual(fixed, false);
    deepStrictEqual(messages, expected);
});

test('async style reporting failures remain operational through the lint host', () => {
    const failure = new Error('async style report failed');
    const implementation = Reflect.get(plugin.rules, 'prefer-async-await');
    const broken = { ...implementation, create() {
        return implementation.create({ report() { throw failure; } });
    } };

    throws(() => new Linter().verify('const run=()=>request.then(handle);', {
        plugins: { probe: { rules: { style: broken } } }, rules: { 'probe/style': 'error' }
    }), error => error === failure);
});
