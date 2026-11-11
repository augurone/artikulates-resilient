import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { ESLint, Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { queriesFor, queryAnalysis } from './support/analysis-queries.js';
import { counter } from './support/work.js';

const operation = 'resilient/signature-contract-operation';
const callRule = 'resilient/signature-contract-call-site';
const returnRule = 'resilient/signature-contract-return-consistency';
const lint = (source, rules = [operation]) => new Linter().verify(source, {
    plugins: { resilient: plugin }, rules: Object.fromEntries(rules.map(rule => [rule, 'error']))
});

// Each oracle supplies its own expected behavior. This shared schedule checks
// that generic, actual and contrary public questions cannot change that answer.
const ordered = (source, inspect, options = {}) => {
    const first = createAnalysis({ source, ...options });

    inspect(first);
    const queries = queriesFor(first);
    const expected = queries.map(query => queryAnalysis(first, query));
    const reverse = createAnalysis({ source, ...options });

    queries.toReversed().forEach(query => queryAnalysis(reverse, query));
    deepStrictEqual(queries.map(query => queryAnalysis(reverse, query)), expected);
    deepStrictEqual(queries.map(query => queryAnalysis(first, query)), expected);
    inspect(reverse);
};

test('entry admission preserves supplied contradictions beside omission and unknown through patterns and imports', () => {
    // Root versus selected-field defaults and record versus iterator admission
    // are distinct owners. Alternate literal/factory spellings are examples in
    // bad.js; they do not need another Cartesian suite.
    [
        ['{x} = makeDefault()', '{x:1}', '{x:2}', '3', false],
        ['[x] = fallback', '[1]', '[2]', '{}', false],
        ['{value: {x} = {x:0}}', '{x:1}', '{x:2}', '3', true],
        ['{value: [x] = [0]}', '[1]', '[2]', '{}', true]
    ].forEach(([parameter = '', supplied = '', other = '', wrong = '', nested = false] = []) => {
        const alternatives = [supplied, `flag?${supplied}:${other}`, 'external',
            `flag?${wrong}:external`, `flag?${supplied}:void 0`, `flag?${supplied}:null`, ''];
        const calls = alternatives.map((value) => {
            const selected = value ? `{value:${value}}` : '{}';

            return `accept(${nested ? selected : value});`;
        }).join('');
        const expected = ['agreement', 'agreement', 'unknown', 'contradiction', 'unknown', 'contradiction', 'unknown'];
        const inspect = (analysis) => {
            const { calls = [] } = analysis;

            deepStrictEqual(calls.filter(({ callee = '' } = {}) => callee === 'accept')
                .map(call => analysis.checkCall(call).status), expected);
        };
        const declaration = `const accept=(${parameter})=>x;`;

        ordered(declaration + calls, inspect);
        ordered(`import {accept} from 'provider';${calls}`, inspect, {
            filename: 'entry.js', resolveModule: () => ({ filename: 'provider.js', source: `export ${declaration}` })
        });
    });
    const source = 'const accept=({x=""}={x:0})=>x;accept(flag?{x:1}:external);';

    ordered(source, (analysis) => {
        const { obligations = [] } = analysis.checkCall(analysis.calls.at(-1));

        ok(obligations.some(({ path = '', expected = '', status = '' } = {}) => (
            path === 'x' && expected === 'string' && status === 'contradiction'
        )));
    });
    ok(lint(source, [callRule]).some(({ messageId = '' } = {}) => messageId === 'mismatch'));
});

const nativeEntry = 'const seed=()=>42;const fail=()=>{throw 7;};const take=value=>value;'
    + 'const read=(first=seed(),{name=take(first),next=take(name)}={})=>next;const relay=value=>{const result=read(value);return result;};'
    + 'const skip=({name=fail()}={})=>name;const selectName=(value={name:42},alias=value)=>alias.name;';

test('native entry observations agree with independent caller requirements and abrupt continuation', () => {
    const invocations = ['read()', 'read("ok")', 'relay(42)', 'relay("ok")',
        'selectName()', 'selectName({name:"ok"})', 'selectName({name:42},{name:"ok"})',
        'skip({name:42})', 'skip({name:"ok"})', 'skip()'];
    const actual = invocations.map((invocation) => {
        try {
            return { family: typeof runInNewContext(nativeEntry + invocation), normal: true };
        } catch (error) {
            strictEqual(error, 7);

            return { normal: false };
        }
    });
    const source = nativeEntry + invocations.map(call => `${call};`).join('')
        + 'const create=()=>({name:42,handler:(value=fail())=>value});const {name=""}=create();name.trim();';

    ordered(source, (analysis) => {
        const { calls = [], functions = [] } = analysis;
        const generic = functions.map(fn => analysis.checkFunction(fn));
        const supplied = calls.filter(({ callee = '', location: { range: [start = -1] = [] } = {} } = {}) => (
            start >= nativeEntry.length && ['read', 'relay', 'skip', 'selectName'].includes(callee)
        ));

        strictEqual(supplied.length, actual.length, 'Every independently observed invocation needs its own public judgment');

        supplied.forEach((call, index) => {
            const { family = '', normal = false } = actual.at(index);

            ['number', 'string'].forEach((required) => {
                const { status = '', normal: completed = true, thrown = false, fact: { families = [] } = {} }
                    = analysis.checkCallResult({ ...call, required });
                const expected = family === required ? 'agreement' : 'contradiction';

                strictEqual(completed, normal);
                strictEqual(status, normal ? expected : 'unknown');

                if (normal) deepStrictEqual(families, [family]);

                if (!normal) strictEqual(thrown, true);
            });
        });
        deepStrictEqual(functions.map(fn => analysis.checkFunction(fn)), generic);
    });
    deepStrictEqual(lint(source), [], 'The last throwing default excludes the later operation');
    const uncertain = 'const forward=(value,alias=value)=>alias;forward(enabled?{name:42}:external).name.trim();';

    ordered(uncertain, (analysis) => {
        const { memberAccesses = [] } = analysis;
        const selected = memberAccesses.find(({ name = '' } = {}) => name === 'trim');

        deepStrictEqual(analysis.checkMemberAccess(selected).conflicts, ['number']);
    });
    throws(() => runInNewContext(uncertain, { enabled: true, external: { name: 'ok' } }), ({ name = '' } = {}) => name === 'TypeError');
    strictEqual(runInNewContext(uncertain, { enabled: false, external: { name: 'ok' } }), 'ok');
});

test('entry cannot borrow later formals, self initialization or body declarations', () => {
    [
        'const read=(factory=()=>later(),{name=0}=factory(),later=()=>({name:42}))=>name;read(void 0,void 0,()=>({name:42}));',
        'const read=(first=first)=>first;read();',
        'const read=({first=second(),second=0}={})=>first;read({second:()=>42});',
        'const read=(value=local())=>{function local(){return 42;}return value;};read();'
    ].forEach((source) => {
        throws(() => runInNewContext(source), ({ name = '' } = {}) => name === 'ReferenceError');
        const inspect = analysis => strictEqual(analysis.checkCallResult({ ...analysis.calls.at(-1), required: 'number' }).status, 'unknown');

        ordered(source, inspect);
    });
    const setup = 'const attempt=callback=>{try{return callback();}catch{return "";}};const wrap=name=>({name});';
    const completed = 'factory=()=>later(),{name=""}=wrap(attempt(factory)),later=()=>42';

    strictEqual(runInNewContext(`${setup}const read=(${completed})=>attempt(factory);read();`), 42);
    [['first=second,second=42', 'first', [], ''], [completed, 'attempt(factory)', ['number'], setup]]
        .forEach(([parameters = '', result = '', expected = [], declarations = ''] = []) => {
            ordered('import {read} from "provider";read().trim();', (analysis) => {
                deepStrictEqual(analysis.checkMemberAccess(analysis.memberAccesses.at(-1)).conflicts, expected);
            }, { filename: 'main', resolveModule: () => ({ filename: 'provider', source: `${declarations}export const read=(${parameters})=>${result};` }) });
        });
});

test('deferred entry preserves independent record, array and imported evidence through production lint', async () => {
    // Keep each selection premise admitted: array-inside-object statement
    // patterns have an explicit unknown boundary in array-pattern-slots.
    const source = 'const seed = () => { throw 7; };\n'
        + 'const create = () => ({ name: 42, handler: async (value = seed()) => value });\n'
        + 'const createItems = () => [42, (value = seed()) => value];\n'
        + 'const { name = "" } = create();\nconst [first = ""] = createItems();\nname.trim();\nfirst.trim();\n';
    const prefix = source.slice(0, source.indexOf('name.trim()'));

    strictEqual(JSON.stringify(runInNewContext(`${prefix}[name,first];`)), '[42,42]');
    ordered(source, (analysis) => {
        const { memberAccesses = [] } = analysis;

        deepStrictEqual(memberAccesses.map(member => analysis.checkMemberAccess(member).conflicts), [['number'], ['number']]);
    });
    const engine = new ESLint();
    const valid = source.replaceAll('.trim()', '.toFixed()');
    const [{ messages = [] } = {}] = await engine.lintText(source, { filePath: 'tests/fixtures/entry-contract.js' });
    const [{ messages: accepted = [] } = {}] = await engine.lintText(valid, { filePath: 'tests/fixtures/entry-contract.js' });

    deepStrictEqual(messages.map(({ ruleId = '', line = 0 } = {}) => [ruleId, line]), [[operation, 6], [operation, 7]]);
    deepStrictEqual(accepted, []);
    runInNewContext(valid);
    ordered('import {value} from "worker";value.trim();', (analysis) => {
        deepStrictEqual(analysis.checkMemberAccess(analysis.memberAccesses.at(-1)).conflicts, ['number']);
    }, { filename: 'main', resolveModule: () => ({ filename: 'worker',
        source: 'const seed=()=>42;export const handler=(value=seed())=>value;export const value=42;' }) });
});

test('entry completion retains independent return conflicts and cannot turn unresolved execution into agreement', () => {
    const source = 'const seed=()=>{throw 7;};const choose=(flag=0)=>{const handler=(value=seed())=>value;'
        + 'const read=(value=seed())=>value;if(flag===1)return {handler,name:42};if(flag===2)return "bad";read();};';

    strictEqual(runInNewContext(`${source}typeof choose(1);`), 'object');
    strictEqual(runInNewContext(`${source}typeof choose(2);`), 'string');
    throws(() => runInNewContext(`${source}choose();`), error => error === 7);
    ordered(source, (analysis) => {
        const { status = '', normal = false, fact: { families = [] } = {} } = analysis.checkFunction({ index: 1 });

        strictEqual(status, 'contradiction');
        strictEqual(normal, true);
        deepStrictEqual(families.toSorted(), ['object', 'string']);
    });
    deepStrictEqual(lint(source, [returnRule]).map(({ ruleId = '' } = {}) => ruleId), [returnRule, returnRule]);
    const unresolved = 'const undefined=external;const consume=action=>{const read=({value=undefined})=>value;'
        + 'const alias=read;if(typeof action==="function")action((()=>alias({}))());};';

    ordered(unresolved, (analysis) => {
        const { status = '', normal = true, fact: { families = [] } = {} } = analysis.checkFunction({ index: 0 });

        strictEqual(status, 'unknown');
        strictEqual(normal, 'unknown');
        deepStrictEqual(families, ['nullish']);
    });
    ordered(unresolved.replace('action((()=>alias({}))())', 'action(42)'), analysis => strictEqual(analysis.checkFunction({ index: 0 }).status, 'agreement'));
    // eslint-disable-next-line resilient/no-null-assignment -- The native unresolved-entry oracle includes null to distinguish unknown completion from a fabricated known return agreement.
    [42, null].forEach(external => strictEqual(runInNewContext(`{${unresolved}const seen=[];consume(value=>seen.push(value));seen[0];}`, { external }), external));
});

test('entry writes and dynamic lookup retain their own lifetime barriers', () => {
    const source = 'const run=({cb}={})=>{const change=(value=(cb=42))=>value;if(typeof cb!=="function")return;change();cb();};';

    throws(() => runInNewContext(`${source}run({cb:()=>0});`), ({ name = '' } = {}) => name === 'TypeError');
    ordered(source, (analysis) => {
        const selected = analysis.declarations.find(({ name = '' } = {}) => name === 'cb');

        strictEqual(analysis.checkDeclaration(selected).required, true);
        ok(analysis.invocations.every(invocation => analysis.checkInvocation(invocation).status !== 'agreement'));
    });
    const written = 'const item={name:42};const change=()=>{item.name="ok";return 0;};const read=(unused=change())=>item;read().name.trim();';

    strictEqual(runInNewContext(written), 'ok');
    deepStrictEqual(lint(written), []);
    const dynamic = createAnalysis({ source: 'const read=(flag=false)=>{const hidden=(value=eval("flag=true"))=>value;return flag?42:"ok";};' });

    strictEqual(dynamic.checkFunction({ index: 0 }).fact.incomplete, true);
});

const storedBinding = (index, pattern = '') => {
    if (!pattern || pattern === 'object') {
        const value = pattern ? `wrap(input${index})` : `inspect(input${index},{})`;

        return `const result${index}=input${index}?${value}:'';`;
    }

    return `const [result${index}='']=input${index}?wrap(input${index}):[];`;
};
const independentReads = (width, pattern = '') => {
    const wrappers = new Map([
        ['object', `const wrap=(value,{item:result=inspect(value,{})}={})=>result;`],
        ['array', 'const wrap=value=>[inspect(value,{})];']
    ]);

    return `const inspect=(value,seen=new Set())=>{
    if(!value)return '';
    const name=readName(value);
    if(name==='Map'&&isNative(value))return name;
    const bases=readBases(value);
    return bases.length===1?readName(bases[0]):'';
};
${wrappers.get(pattern) || ''}
const run=(${Array.from({ length: width }, (unused, index) => `input${index}`).join(',')})=>{
    ${Array.from({ length: width }, (unused, index) => storedBinding(index, pattern)).join('\n')}
    return ${Array.from({ length: width }, (unused, index) => `result${index}`).join('||')};
};`;
};

test('stored initializer reuse stays bounded across independent width and selected patterns', () => {
    ['', 'object', 'array'].forEach((pattern) => {
        const samples = [4, 8, 16, 32].map((width) => {
            const source = independentReads(width, pattern);
            const native = runInNewContext(`${source}
                let observations=0;const readName=value=>{observations+=1;return value.name;};
                const isNative=()=>true;const readBases=()=>[];
                const value=run(${Array.from({ length: width }, () => '{name:"Map"}').join(',')});
                JSON.stringify({value,observations});`);
            const analysis = createAnalysis({ source, limits: { decisions: 500000 } });
            const index = pattern ? 2 : 1;
            const result = analysis.checkFunction({ index });
            const { status = '' } = result;
            const { counts = {} } = analysis;
            const { contexts = 0, decisionWork = 0 } = counts;

            strictEqual(native, JSON.stringify({ value: 'Map', observations: width }));
            strictEqual(status, 'unknown');
            ok(contexts <= width * (pattern ? 2 : 1) + 4, 'One execution per owned source call plus fixed query contexts');
            deepStrictEqual(analysis.checkFunction({ index }), result);
            const { counts: after = {} } = analysis;

            deepStrictEqual(after, counts, 'Warm reads reuse completed initializer values');

            return decisionWork;
        });

        samples.slice(1).forEach((work, index) => ok(work < 4 * samples.at(index), 'Independent results cannot multiply path histories'));
    });
    const aliases = [8, 32].map((depth) => {
        const formals = ['value', ...Array.from({ length: depth }, (unused, index) => `alias${index}=${index ? 'alias' + (index - 1) : 'value'}`)];
        const source = `const read=(${formals.join(',')})=>alias${depth - 1};read({name:42}).name.trim();`;
        const analysis = createAnalysis({ source });
        const work = counter();
        const { onWork } = work;
        const { memberAccesses = [] } = analysis;
        const selected = memberAccesses.find(({ name = '' } = {}) => name === 'trim');
        const result = analysis.checkMemberAccess({ ...selected, onWork });
        const { conflicts = [] } = result;
        const before = work.read();
        const { counts = {} } = analysis;

        strictEqual(runInNewContext(source.replace('.name.trim();', '.name;')), 42);
        deepStrictEqual(conflicts, ['number']);
        deepStrictEqual(analysis.checkMemberAccess({ ...selected, onWork }), result);
        deepStrictEqual(work.read(), before, 'Warm formal aliases reuse completed work');

        return { counts, demand: work.get('value-demand') };
    });
    const [
        { counts: { contexts: smallContexts = 0, expressions: smallExpressions = 0 } = {}, demand: smallDemand = 0 } = {},
        { counts: { contexts: largeContexts = 0, expressions: largeExpressions = 0 } = {}, demand: largeDemand = 0 } = {}
    ] = aliases;

    ok([smallContexts, smallExpressions, smallDemand, largeContexts, largeExpressions, largeDemand]
        .every(value => Number.isSafeInteger(value) && value > 0), 'Both alias samples require positive resource counters');
    strictEqual(largeContexts, smallContexts, 'More default aliases do not add invocations');
    ok(largeExpressions <= 4 * smallExpressions, 'Alias depth retains source-sized relationships');
    ok(largeDemand <= 4 * smallDemand, 'Alias depth cannot multiply completed demand');
});

test('entry publication propagates interruption and retries without unfinished evidence', () => {
    [
        { source: nativeEntry + 'read();', method: 'checkCallResult', stored: false },
        { source: 'const accept=({x}=fallback)=>x;accept(flag?{x:1}:void 0);', method: 'checkCall', stored: false },
        { source: independentReads(2, 'object'), method: 'checkFunction', stored: true }
    ].forEach(({ source = '', method = '', stored = false } = {}) => {
        const baseline = createAnalysis({ source });
        const { index = -1 } = stored ? baseline.functions.at(-1) : baseline.calls.at(-1);
        const query = { method, index, required: 'number' };
        const work = counter();
        const expected = queryAnalysis(baseline, { ...query, onWork: event => work.onWork(event) });
        const { counts = {} } = baseline;
        const stages = Object.keys(work.read());

        ok(stages.length, 'The interruption schedule must execute the owned demand');
        stages.forEach((interrupted) => {
            const analysis = createAnalysis({ source });
            const failure = new Error(interrupted);

            throws(() => queryAnalysis(analysis, { ...query, onWork: ({ kind = '' } = {}) => {
                if (kind === interrupted) throw failure;
            } }), error => error === failure);
            deepStrictEqual(queryAnalysis(analysis, query), expected);

            if (stored) {
                const { counts: after = {} } = analysis;

                deepStrictEqual(after, counts);
            }
        });
    });
});

test('stored copy selections preserve guarded fields against a finite native oracle', () => {
    const source = 'const run=(flag,other)=>{const item=flag?{status:"ready",value:"ok"}:{status:"rejected",reason:42};'
        + 'const copy=(other&&{...item,...{extra:0}})||{...item,...{extra:1}};return copy.status==="ready"?copy.value.trim():"no";};';

    [false, true].forEach(flag => [false, true].forEach(other => strictEqual(runInNewContext(`${source}run(${flag},${other});`), flag ? 'ok' : 'no')));
    deepStrictEqual(lint(source, ['resilient/signature-contract-property', operation]), []);
    ordered(source, (analysis) => {
        ok(analysis.memberAccesses.every(member => !analysis.checkMemberAccess(member).conflicts.length));
    });
});
