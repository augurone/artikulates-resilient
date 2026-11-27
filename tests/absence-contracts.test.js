import { deepStrictEqual, strictEqual, throws, ok, doesNotThrow } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { Linter, ESLint } from 'eslint';
import { parse } from 'espree';

import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';
import production from 'eslint-plugin-resilient/production';

import { append } from './support/collections.js';
import { analyze } from './support/compiler-source.js';
import { counter } from './support/work.js';

// Natural/explicit absence, lexical identity and independent known contributions require native and boundary observations; isolated syntax spellings are commentary.

{
    const rules = Object.fromEntries(['prefer-safe-destructuring-defaults', 'signature-contract-destructuring', 'no-unguarded-callback-invocation']
        .map(name => [`resilient/${name}`, 'error']));
    const lint = source => new Linter().verify(source, {
        languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { resilient: plugin }, rules
    });
    const declarationFor = analysis => analysis.declarations.find(({ name = '' } = {}) => name === 'value') || {};
    const decisionFor = (source) => {
        const analysis = createAnalysis({ source });
        const { index = -1 } = declarationFor(analysis);

        return analysis.checkDeclaration({ index });
    };

    [
        ['array spread', '[...(value&&[])]'],
        ['call spread', 'forward(...(value&&[]))'],
        ['constructor spread', 'new Factory(...(value&&[]))'],
        ['ordinary argument', 'forward(value&&[])'],
        ['assigned result', 'value&&[]'],
        ['array element', '[value&&[]]'],
        ['object field', '({field:value&&[]})'],
        ['JSX attribute', '<Component field={value&&[]}/>'],
        ['member receiver', '(value&&[]).length'],
        ['successive conjunctions', '[...((value&&[])&&[])]'],
        ['conditional result', '[...(flag?(value&&[]):[])]'],
        ['fallback right operand', '[...(other||(value&&[]))]'],
        ['nullish right operand', '[...(other??(value&&[]))]']
    ].forEach(([name = '', expression = ''] = []) => test(`logical result retains absence at ${name}`, () => {
        const source = `const {value}={};const out=${expression};`;

        strictEqual(decisionFor(source).required, true);
        strictEqual(lint(source).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true);
        strictEqual(lint(source).some(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-destructuring'), true);
    }));

    [
        ['object spread', 'const out={...(value&&{value})};'],
        ['JSX spread', 'const out=<Component {...(value&&{value})}/>;'],
        ['Boolean selection', 'if(value&&[])forward();'],
        ['conditional test', 'const out=(value&&[])?1:0;'],
        ['Boolean coercion', 'const out=!!(value&&[]);'],
        ['discarded result', 'value&&[];'],
        ['while test', 'while(value&&[])break;'],
        ['do-while test', 'do{}while(value&&[]);'],
        ['for test', 'for(;value&&[];)break;'],
        ['disjunction fallback', 'const out=[...((value&&[])||[])];'],
        ['nullish fallback', 'const out=[...((value&&[])??[])];'],
        ['conditional result into spread', 'const out={...(flag?(value&&{value}):{})};'],
        ['nested object spread', 'forward({...((value&&{})&&{value})});']
    ].forEach(([name = '', consumer = ''] = []) => test(`logical result consumes absence at ${name}`, () => {
        const source = `const {value}={};${consumer}`;

        strictEqual(decisionFor(source).required, false);
        deepStrictEqual(lint(source), []);
    }));

    test('the rejected array spread throws while object spreads and fallback consume the same absence', () => {
        throws(() => runInNewContext('const {items}={};const out=[...(items&&[])];'), ({ name = '' } = {}) => name === 'TypeError');
        strictEqual(runInNewContext('const {items}={};Object.keys({...(items&&[])}).length;'), 0);
        strictEqual(runInNewContext('const {items}={};[...((items&&[])||[])].length;'), 0);
        strictEqual(decisionFor('const {value}={};const out=()=>value&&[];').required, true);
        strictEqual(decisionFor('const {value}={};const out={...(value&&[])};forward(value&&[]);').required, true);
    });

    [
        ['named local', 'export {value};'],
        ['renamed local', 'export {value as other};'],
        ['string export name', 'export {value as "public-value"};'],
        ['default specifier', 'export {value as default};'],
        ['default expression', 'export default value;'],
        ['stable alias', 'const alias=value;export {alias};']
    ].forEach(([name = '', exported = ''] = []) => test(`local export retains its absence obligation: ${name}`, () => {
        const source = `const {value}={};${exported}!!value;`;

        strictEqual(decisionFor(source).required, true);
        strictEqual(lint(source).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true);
    }));

    test('export declarations are value escapes and callable predicates cannot discharge exports', () => {
        ['export const {value}={};!!value;', 'const {value}={};export const alias=value;!!value;',
            'const {value}={};export {value};typeof value==="function";',
            'const {value}={};export {value};isFunction(value);']
            .forEach(source => strictEqual(decisionFor(source).required, true));
    });

    [
        ['same-spelled re-export', 'export {value} from "dependency";'],
        ['renamed re-export', 'export {other as value} from "dependency";'],
        ['namespace re-export', 'export * as value from "dependency";'],
        ['local export-name collision', 'const other=1;export {other as value};'],
        ['unrelated export', 'const other=1;export {other};']
    ].forEach(([name = '', exported = ''] = []) => test(`export names keep separate binding identities: ${name}`, () => {
        const source = `const {value}={};${exported}!!value;`;

        strictEqual(decisionFor(source).required, false);
        deepStrictEqual(lint(source), []);
    }));

    test('only the local side of a renamed export escapes', () => {
        const analysis = createAnalysis({ source: 'const {value,other}={};export {other as value};!!value;' });
        const fields = analysis.declarations.filter(({ kind = '' } = {}) => kind === 'Identifier');

        deepStrictEqual(fields.map(({ index = -1 } = {}) => analysis.checkDeclaration({ index }).required), [false, true]);
    });

    test('logical consumers and exports preserve producer absence, query order and source revisions', () => {
        const source = 'const {value}={};const out={...(value&&[])};!!value;';
        const analysis = createAnalysis({ source });
        const { index = -1 } = declarationFor(analysis);
        const work = counter();
        const { onWork = () => {} } = work;
        const expected = analysis.checkDeclaration({ index, onWork });
        const before = work.read();
        const field = analysis.destructuringFields.find(({ name = '' } = {}) => name === 'value') || {};
        const { index: selected = -1 } = field;
        const { status = '', fact: { presence = [] } = {} } = analysis.checkDestructuringField({ index: selected });
        const { required = true } = expected;

        strictEqual(required, false);
        strictEqual(status, 'agreement');
        strictEqual(presence.includes('absent'), true);
        deepStrictEqual(analysis.checkDeclaration({ index, onWork }), expected);
        deepStrictEqual(work.read(), before);
        const revised = createAnalysis({ source: source.replace('{...(value&&[])}', '[...(value&&[])]') });

        strictEqual(revised.checkDestructuringField({ index: selected }).status, 'contradiction');
        strictEqual(revised.checkDeclaration({ index }).required, true);
        strictEqual(decisionFor(`${source}export {value};`).required, true);
        deepStrictEqual(analysis.checkDeclaration({ index }), expected);
    });
}

{
    const cases = JSON.parse(readFileSync(new URL('./fixtures/absence-evidence.json', import.meta.url), 'utf8'));
    const identifiers = analysis => analysis.declarations.filter(({ kind = '' } = {}) => kind === 'Identifier');
    const results = analysis => identifiers(analysis).map(({ index = -1 } = {}) => analysis.checkDeclaration({ index }));
    const lint = new ESLint({ overrideConfigFile: true, allowInlineConfig: false, overrideConfig: [{
        plugins: { resilient: plugin }, rules: { 'resilient/prefer-safe-destructuring-defaults': 'error' },
        settings: { resilient: { resolver: () => false } }
    }] });

    cases.forEach(({ name = '', source = '', required = [] } = {}) => {
        test(`source-owned absence evidence: ${name}`, async () => {
            const analysis = createAnalysis({ source });
            const expected = identifiers(analysis).filter(({ index = -1 } = {}, position) => {
                const { required: missing = false } = analysis.checkDeclaration({ index });

                strictEqual(missing, required.at(position));

                return missing;
            }).map(({ location: { line = 0, column = 0, range: [start = 0, end = 0] = [] } = {} } = {}) => ({ line, column, endLine: line, endColumn: column + end - start }));
            const [output = {}] = await lint.lintText(source, { filePath: 'absence-evidence.js' });
            const { messages = [] } = output;

            strictEqual(identifiers(analysis).length, required.length);
            deepStrictEqual(messages.map(({ line = 0, column = 0, endLine = 0, endColumn = 0 } = {}) => ({ line, column, endLine, endColumn })), expected);
        });
    });

    test('return identity is shared with function queries and independent of query order', () => {
        const [{ source = '' } = {}] = cases;
        const forward = createAnalysis({ source });
        const reverse = createAnalysis({ source });
        const a = results(forward);
        const b = reverse.functions.toReversed().map(({ index = -1 } = {}) => reverse.checkFunction({ index }));

        deepStrictEqual(results(reverse), a);
        deepStrictEqual(forward.functions.toReversed().map(({ index = -1 } = {}) => forward.checkFunction({ index })), b);
        const [{ returnedParameter = false, status = '' } = {}] = b;
        const { index = -1 } = returnedParameter;

        strictEqual(index, 0);
        strictEqual(status, 'unknown', 'Returning one formal proves identity, not its family');
        ok(a.every(({ code = '' } = {}) => code === 'guarded-tuple-identity'));
        strictEqual(a.at(0), a.at(1), 'Tuple leaves share one completed obligation');
    });

    test('completed tuple evidence preserves known conflict beside unknown alternatives', () => {
        const source = 'const run = (state, tuple) => { if (!isArray(tuple) || tuple.length < 2) return state; const [a, b] = tuple; if (a) return []; return {}; };';
        const analysis = createAnalysis({ source });
        const [{ evidence: [proof = {}] = [] } = {}] = results(analysis);
        const { status = '', families = [], incomplete = false } = proof;

        strictEqual(status, 'contradiction');
        deepStrictEqual(families.toSorted(), ['array', 'object']);
        strictEqual(incomplete, true);
        strictEqual(analysis.checkFunction({ index: 0 }).status, 'contradiction');
    });

    test('unknown carrier calls retain their result obligation and source locations', () => {
        const { source = '' } = cases.find(({ name = '' } = {}) => name === 'lifted member names do not prove correspondence') ?? {};
        const [{ required = false, evidence: [proof = {}] = [] } = {}] = results(createAnalysis({ source }));
        const { status = '', families = [], incomplete = false, returns = [] } = proof;

        strictEqual(required, true);
        strictEqual(status, 'unknown');
        deepStrictEqual(families, []);
        strictEqual(incomplete, true);
        strictEqual(returns.length, 2);
        ok(returns.every(({ range = [] } = {}) => source.slice(...range).startsWith('carrier.')));
    });

    test('source revisions and failed observations cannot publish a tuple admission', () => {
        const [{ source = '' } = {}] = cases;
        const original = createAnalysis({ source });
        const changed = createAnalysis({ source: source.replace('return state; };', 'return external; };') });
        const [{ index = -1 } = {}] = identifiers(original);
        const failure = new Error('observation failed');

        throws(() => original.checkDeclaration({ index, onWork: () => { throw failure; } }), error => error === failure);
        strictEqual(original.checkDeclaration({ index }).required, false);
        strictEqual(changed.checkDeclaration({ index }).required, true);
        strictEqual(original.checkDeclaration({ index }).required, false);
    });

    test('void preserves evaluation failure and supplied arguments do not inherit absence defaults', () => {
        const source = 'const fail = () => { throw 1; }; const run = () => void fail(); const consume = (value = []) => value; consume(external);';
        const analysis = createAnalysis({ source });
        const result = analysis.checkFunction({ index: 1 });
        const { normal = true, thrown = false } = result;

        strictEqual(normal, false);
        strictEqual(thrown, true);
        strictEqual(analysis.checkCall({ index: 1 }).status, 'unknown');
    });

    test('imported consumer guards do not infer initializer values', () => {
        const source = 'import { consume } from "consumer"; const run = ({ action }) => consume(action);';
        const safe = 'export const consume = action => { const read = ({ value = undefined }) => value; if (typeof action === "function") action(read({})); };';
        const unsafe = `const undefined = external; ${safe}`;
        const acquire = dependency => createAnalysis({ source, filename: 'main', resolveModule: () => ({ filename: 'consumer', source: dependency }) });
        const original = acquire(safe);

        strictEqual(results(original).at(0).required, false);
        strictEqual(results(acquire(unsafe)).at(0).required, false);
        strictEqual(createAnalysis({ source: unsafe }).checkFunction({ index: 0 }).status, 'unknown');
        strictEqual(results(original).at(0).required, false);
    });

    test('tuple result projections are shared across multiple boundaries in one function', () => {
        const source = `const fold = (state, first, second) => {
        if (!isArray(first) || first.length < 2) return state;
        const [a, b] = first;
        if (!isArray(second) || second.length < 2) return state;
        const [c, d] = second;
        return state;
    };`;
        const completed = results(createAnalysis({ source }));
        const [{ evidence: [first = {}] = [] } = {}, , { evidence: [second = {}] = [] } = {}] = completed;
        const { returns: a = [] } = first;
        const { returns: b = [] } = second;

        ok(completed.every(({ required = true } = {}) => !required));
        strictEqual(a, b);
    });

    test('dynamic scope cannot borrow an unbound intrinsic absence fact', () => {
        const source = 'const read = function () { eval("var undefined = []"); return undefined.map(action); };';
        const analysis = createAnalysis({ source, sourceType: 'script' });

        strictEqual(analysis.check({ index: 0 }).status, 'unknown');
    });

    test('75 completed return compositions agree with independently executed formal identity', () => {
        const expressions = ['state', 'other', '[]', 'flag ? state : other', 'flag ? other : state'];

        expressions.forEach(left => expressions.forEach((right) => {
            const expression = `flag ? (${left}) : (${right})`;
            [`return ${expression};`, `try { return ${expression}; } finally { if (flag) return state; }`,
                `try { return ${expression}; } finally { if (flag) throw 1; }`].forEach((body) => {
                const source = `const choose = (state, other, flag) => { ${body} };`;
                const observed = Array.from(runInNewContext(`${source}
                const state = {}, other = {};
                [false, true].map(flag => {
                    try { const result = choose(state, other, flag); return result === state ? 0 : result === other ? 1 : -1; }
                    catch { return 'thrown'; }
                });`)).filter(value => value !== 'thrown');
                const alternatives = [...new Set(observed)];
                const [only = -1] = alternatives;
                const analysis = createAnalysis({ source: `${source} choose([], 42, true); choose({}, '', false);` });
                const generic = analysis.checkFunction({ index: 0 });
                const { returnedParameter = false } = generic;
                const { index = -1 } = returnedParameter;

                strictEqual(index, alternatives.length === 1 ? only : -1, source);
                analysis.calls.forEach(({ index = -1 } = {}) => analysis.checkCallResult({ index, required: 'array' }));
                deepStrictEqual(analysis.checkFunction({ index: 0 }), generic);
            });
        }));
    });

    test('null and undefined conflicts remain distinct beside an unknown returned formal', () => {
        const source = 'const run = (state, tuple) => { if (!isArray(tuple) || tuple.length < 2) return state; const [a, b] = tuple; if (a) return null; return void 0; };';
        const [{ evidence: [proof = {}] = [] } = {}] = results(createAnalysis({ source }));
        const { status = '', families = [], absences = [], incomplete = false } = proof;

        strictEqual(status, 'contradiction');
        deepStrictEqual(families, ['nullish']);
        deepStrictEqual(absences.toSorted(), ['null', 'undefined']);
        strictEqual(incomplete, true);
    });

    test('the rejected result uses the same selected identity projection as normal completion', () => {
        const source = `const choose = (state, other, flag) => { try { return flag ? other : state; } finally { if (flag) throw 1; } };
        const fold = (state, tuple, other, flag) => {
            if (!isArray(tuple) || tuple.length < 2) return choose(state, other, flag);
            const [a, b] = tuple;
            return state;
        };`;

        ok(results(createAnalysis({ source })).every(({ required = true } = {}) => !required));
    });
}

{
    const lint = new ESLint({ overrideConfigFile: true, allowInlineConfig: false, overrideConfig: [{
        languageOptions: { sourceType: 'script' }, plugins: { resilient: plugin },
        rules: { 'resilient/signature-contract-return-consistency': 'error', 'resilient/prefer-safe-destructuring-defaults': 'error' },
        settings: { resilient: { resolver: () => false } }
    }] });
    const dynamicInitializers = [
        { name: 'enclosing body', source: 'const outer=()=>{eval("var undefined=[]");return flag=>flag?undefined:[];};' },
        { name: 'parameter default', source: 'const outer=(value=eval("var undefined=[]"))=>flag=>flag?undefined:[];' },
        { name: 'nested default expression', source: 'const outer=(value=(true?eval("var undefined=[]"):0))=>flag=>flag?undefined:[];' },
        { name: 'void default operand', source: 'const outer=(value=void eval("var undefined=[]"))=>flag=>flag?undefined:[];' },
        { name: 'computed parameter key', source: 'const outer=({[eval("var undefined=[]")]:value=0}={})=>flag=>flag?undefined:[];' },
        { name: 'catch default', source: 'const outer=()=>{try{throw {}}catch({value=eval("var undefined=[]")}){return flag=>flag?undefined:[];}};' },
        { name: 'computed catch key', source: 'const outer=()=>{try{throw {}}catch({[eval("var undefined=[]")]:value=0}){return flag=>flag?undefined:[];}};' }
    ];

    dynamicInitializers.forEach(({ name = '', source = '' } = {}) => {
        test(`dynamic binding acquisition: ${name}`, async () => {
            strictEqual(runInNewContext(`${source} [false,true].every(flag=>Array.isArray(outer()(flag)));`), true);
            const analysis = createAnalysis({ source, sourceType: 'script' });
            const { index = -1 } = analysis.functions.at(-1);
            const { status = '', fact: { families = [], incomplete = false } = {} } = analysis.checkFunction({ index });

            strictEqual(status, 'unknown');
            deepStrictEqual(families, []);
            strictEqual(incomplete, true);
            const [{ messages = [] } = {}] = await lint.lintText(source);

            deepStrictEqual(messages, [], 'Dynamic lookup cannot manufacture a nullish/array contradiction');
        });
    });

    test('inherited dynamic lookup blocks tuple and callable proofs at every lexical depth', async () => {
        const source = `function outer() {
        eval('var undefined=[]');
        return () => {
            const fold=(state,tuple)=>{if(!isArray(tuple)||tuple.length<2)return state;const [a,b]=tuple;return state;};
            return ({done})=>{if(typeof done==='function')done();};
        };
    }`;
        const analysis = createAnalysis({ source, sourceType: 'script' });
        const bindings = analysis.declarations.filter(({ kind = '' } = {}) => kind === 'Identifier');

        strictEqual(bindings.length, 3);
        ok(bindings.every(({ index = -1 } = {}) => analysis.checkDeclaration({ index }).required));
        const [{ messages = [] } = {}] = await lint.lintText(source);

        deepStrictEqual(messages.map(({ ruleId = '', line = 0, column = 0 } = {}) => ({ ruleId, line, column })), bindings.map(({ location: { line = 0, column = 0 } = {} } = {}) => ({
            ruleId: 'resilient/prefer-safe-destructuring-defaults', line, column
        })));
    });

    test('dynamic acquisition does not spread through siblings or unexecuted initializer functions', () => {
        const sources = [
            'const outer=()=>{eval("var undefined=[]");return ()=>undefined;};const outside=()=>undefined;',
            'const outer=(value=()=>eval("var undefined=[]"))=>()=>undefined;',
            'const outer=(value=external())=>()=>undefined;',
            'const outer=(value="eval(whatever)")=>()=>undefined;'
        ];

        sources.forEach((source) => {
            const analysis = createAnalysis({ source, sourceType: 'script' });
            const { index = -1 } = analysis.functions.at(-1);
            const { status = '', fact: { families = [], incomplete = true } = {} } = analysis.checkFunction({ index });

            strictEqual(status, 'agreement', source);
            deepStrictEqual(families, ['nullish']);
            strictEqual(incomplete, false);
        });
    });

    test('dynamic source revisions do not change retained lexical evidence', () => {
        const source = 'const outer=()=>{const fold=(state,tuple)=>{if(!isArray(tuple)||tuple.length<2)return state;const [a,b]=tuple;return state;};return fold;};';
        const revised = source.replace('const outer=()=>{', 'const outer=()=>{eval("var undefined=[]");');
        const first = createAnalysis({ source, sourceType: 'script' });
        const second = createAnalysis({ source: revised, sourceType: 'script' });
        const query = analysis => analysis.declarations.filter(({ kind = '' } = {}) => kind === 'Identifier').map(({ index = -1 } = {}) => analysis.checkDeclaration({ index }).required);

        deepStrictEqual(query(first), [false, false]);
        deepStrictEqual(query(second), [true, true]);
        deepStrictEqual(query(first), [false, false]);
        deepStrictEqual(query(createAnalysis({ source, sourceType: 'script' })), [false, false]);
    });

    test('callable acquires default function syntax without executing its parameter effects', () => {
        const source = 'const outer=({[(value=eval("var undefined=[]"))=>0]:item=0}={})=>()=>undefined;';

        strictEqual(runInNewContext(`${source} outer()()===void 0;`), true);
        const program = parse(source, { ecmaVersion: 'latest', sourceType: 'script', loc: true, range: true });
        const { body: [{ declarations: [{ init: { params: [{ left: { properties: [{ key = {} } = {}] = [] } = {} } = {}] = [] } = {} } = {}] = [] } = {}] = [] } = program;

        Object.defineProperty(key, 'hostMetadata', { enumerable: true, get() { throw new Error('Host metadata is not evidence'); } });
        const analysis = createProgramAnalysis({ program });
        const { index = -1 } = analysis.functions.at(-1);
        const { status = '', fact: { families = [] } = {} } = analysis.checkFunction({ index });

        strictEqual(status, 'agreement');
        deepStrictEqual(families, ['nullish']);
        strictEqual(analysis.functions.length, 3);
        const failure = new Error('Acquired parameter syntax is unavailable');

        Object.defineProperty(key, 'params', { get() { throw failure; } });
        throws(() => createProgramAnalysis({ program }), error => error === failure);
    });

    test('initializer acquisition failures remain operational failures', () => {
        const program = parse('const outer=(value=flag?first:second)=>()=>undefined;', { ecmaVersion: 'latest', sourceType: 'script', loc: true, range: true });
        const { body: [{ declarations: [{ init: { params: [{ right = {} } = {}] = [] } = {} } = {}] = [] } = {}] = [] } = program;
        const failure = new Error('Required initializer source read failed');

        Object.defineProperty(right, 'consequent', { get() { throw failure; } });
        throws(() => createProgramAnalysis({ program }), error => error === failure);
    });

    test('288 return compositions preserve identity and family claims across 5778 normal runtime samples', () => {
        const bodies = ['return state;', 'return other;', 'return [];', 'return flag ? state : other;', 'return flag ? other : state;',
            'return state || other;', 'return state && other;', 'return state ?? other;', 'if (flag) throw 1; return state;',
            'if (flag) throw 1; return other;', 'throw 1;', 'if (flag) return state; return pass(other);'];
        const finalizers = ['', 'if (flag) return state;', 'if (flag) return other;', 'if (flag) throw 1;',
            'if (second) return state;', 'if (second) return other;', 'if (second) throw 1;', 'return flag ? state : other;'];
        const catches = ['', 'catch { return state; }', 'catch { if(second) return other; throw 1; }'];

        bodies.forEach(initial => finalizers.forEach(finalizer => catches.forEach((handler) => {
            const source = `const pass=value=>value; const run=(state,other,flag,second)=>{ try { ${initial} } ${handler} finally { ${finalizer} } };`;
            const analysis = createAnalysis({ source });
            const proof = analysis.checkFunction({ index: 1 });
            const observed = runInNewContext(`${source}
            const inputs=[[{},{}],[false,{}],[{},false],[0,1],[null,{}],[void 0,{}]];
            inputs.flatMap(([state,other])=>[false,true].flatMap(flag=>[false,true].map(second=>{
                try { const result=run(state,other,flag,second); return { identity:result===state?0:result===other?1:-1,
                    family:Array.isArray(result)?'array':result===null||result===void 0?'nullish':typeof result }; }
                catch { return false; }
            }))).filter(Boolean);`);
            const { returnedParameter = false, fact: { families = [], incomplete = true } = {} } = proof;
            const { index = -1 } = returnedParameter;

            if (returnedParameter) ok(observed.every(({ identity = -1 } = {}) => identity === index), source);

            if (!incomplete) ok(observed.every(({ family = '' } = {}) => families.includes(family)), source);

            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCallResult({ index, required: 'array' }));
            deepStrictEqual(analysis.checkFunction({ index: 1 }), proof);
        })));
    });

    test('every interrupted tuple proof retries without publishing partial evidence', () => {
        const source = `const choose=(state,other,flag)=>{try{return flag?other:state;}finally{if(flag)throw 1;}};
        const fold=(state,tuple,other,flag)=>{if(!isArray(tuple)||tuple.length<2)return choose(state,other,flag);const [a,b]=tuple;return state;};
        fold([],[],{},false); fold({},[],[],true);`;
        const query = (analysis, observation = {}) => {
            const { index = -1 } = analysis.declarations.find(({ name = '' } = {}) => name === 'a') ?? {};

            return analysis.checkDeclaration({ index, ...observation });
        };
        const steps = [];
        const original = createAnalysis({ source });
        const expected = query(original, { onWork: entry => append(steps, entry) });
        const completed = original.functions.map(({ index = -1 } = {}) => original.checkFunction({ index }));

        ok(steps.length);
        steps.forEach((entry, failAt) => {
            const analysis = createAnalysis({ source });
            const failure = new Error('observer failed');
            const visited = [];

            throws(() => query(analysis, { onWork: (work) => {
                append(visited, work);

                if (visited.length !== failAt + 1) return;

                deepStrictEqual(work, entry);
                throw failure;
            } }), error => error === failure);
            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCallResult({ index, required: 'array' }));
            deepStrictEqual(query(analysis), expected);
            deepStrictEqual(analysis.functions.map(({ index = -1 } = {}) => analysis.checkFunction({ index })), completed);
        });
    });
}

{
    const configuration = { plugins: { resilient: plugin }, rules: {
        'resilient/prefer-safe-destructuring-defaults': 'error', 'resilient/signature-contract-destructuring': 'error'
    } };
    const decision = (source, name = 'value') => {
        const analysis = createAnalysis({ source });
        const { index = -1 } = analysis.declarations.find(({ name: selected = '' } = {}) => selected === name) ?? {};

        return analysis.checkDeclaration({ index });
    };
    const placements = [
        ['later parameter', expression => `const run=({value},next=${expression})=>!!value;`],
        ['sibling property', expression => `const run=({value,next=${expression}})=>!!value;`],
        ['nested property', expression => `const run=({value,options:{next=${expression}}={}})=>!!value;`],
        ['later destructured parameter', expression => `const run=({value},{next=${expression}}={})=>!!value;`],
        ['local pattern', expression => `const run=({value})=>{const {next=${expression}}={};return !!value;};`],
        ['catch-pattern initializer', expression => `const run=({value})=>{try{throw {};}catch({next=${expression}}){}return !!value;};`],
        ['nested execution', expression => `const outer=({value})=>(next=${expression})=>!!value;const run=input=>outer(input)();`]
    ];
    const inputs = [
        { name: 'member receiver', expression: 'value.length', required: true },
        { name: 'invocation', expression: 'value()', required: true },
        { name: 'iterable spread', expression: '[...value]', required: true },
        { name: 'logical iterable spread', expression: '[...(value&&[])]', required: true },
        { name: 'native receiver', expression: 'Object.keys(value)', required: true },
        { name: 'Boolean read', expression: '!!value', required: false },
        { name: 'typeof read', expression: 'typeof value', required: false },
        { name: 'conditional member read', expression: 'value?value.length:0', required: false },
        { name: 'conditional forwarding', expression: 'value?value:0', required: false },
        { name: 'object spread', expression: '({...value})', required: false },
        { name: 'guarded object spread', expression: '({...value&&{value}})', required: false },
        { name: 'disjunction fallback', expression: 'value||[]', required: false },
        { name: 'nullish fallback', expression: 'value??[]', required: false },
        { name: 'property name collision', expression: '({value:1})', required: false },
        { name: 'method name collision', expression: '({value(){return 1;}})', required: false },
        { name: 'function name collision', expression: '(function value(){return 1;})', required: false }
    ];

    placements.forEach(([placement = '', make = () => ''] = []) => inputs.forEach(({ name = '', expression = '', required = true } = {}) => {
        test(`initializer absence: ${placement}, ${name}`, () => {
            const source = make(expression);

            // This consumer's absence requirement belongs to its actual uses.
            // Unknown catch completion cannot override independently safe reads.
            strictEqual(decision(source).required, required, source);
            const findings = new Linter().verify(source, configuration);

            strictEqual(findings.some(({ messageId = '', column = 0 } = {}) => messageId === 'safeDefault' && column === source.indexOf('value') + 1), required);
            ['{}', '{value:null}'].forEach((input) => {
                const execute = () => runInNewContext(`${source}run(${input});`);

                if (required) {
                    throws(execute, ({ name = '' } = {}) => name === 'TypeError');

                    return;
                }

                doesNotThrow(execute);
            });
        });
    }));

    test('computed parameter keys, enclosing defaults and closure reads retain their own obligations', () => {
        ['const run=({value},{[value.length]:next}={})=>!!value;',
            'const run=({value},[next=value.length]=[])=>!!value;',
            'const run=({value},{next}={next:value.length})=>!!value;',
            'const run=({value},next=()=>value.length)=>!!value;',
            'const run=({value},next=(value.length,0))=>!!value;',
            'const run=({value},next=`${value.length}`)=>!!value;']
            .forEach(source => strictEqual(decision(source).required, true, source));
    });

    test('a guarded invocation cannot discharge another data read before or after it', () => {
        ['const run=({value},next=value.length)=>{if(typeof value==="function")value();};',
            'const run=({value})=>{const next=value.length;if(typeof value==="function")value();};',
            'const run=({value})=>{if(typeof value==="function")value();return value.length;};',
            'const run=({value})=>{if(typeof value==="function")value();return ()=>value.length;};',
            'const run=({value})=>{external(value);if(typeof value==="function")value();};',
            'const run=({value})=>{if(typeof value==="function")value();return external(value);};',
            'const run=({value})=>{if(typeof value==="function")value();return values.map(value);};',
            'const {value}={};export {value};if(typeof value==="function")value();']
            .forEach(source => strictEqual(decision(source).required, true, source));
        const guarded = 'const run=({value})=>{if(typeof value!=="function")return;value();return value.length;};';

        strictEqual(decision(guarded).required, false);
        strictEqual(decision('const run=({value})=>{if(typeof value!=="function")return;external(value);value();};').required, false);
    });

    test('namespace and import labels and meta-properties do not read colliding locals', () => {
        ['const {value}={};export * as value from "dependency";!!value;',
            'const {value}={};import {value as other} from "dependency";!!value;',
            'const {value}={};export {value as other} from "dependency";!!value;']
            .forEach((source) => {
                strictEqual(decision(source).required, false, source);
                deepStrictEqual(new Linter().verify(source, configuration), []);
            });
        strictEqual(decision('const run=function({target}){new.target;return !!target;};', 'target').required, false);
        strictEqual(decision('const {meta}={};import.meta;!!meta;', 'meta').required, false);
    });

    test('initializer references are isolated across source revisions and query orders', () => {
        const safe = 'const run=({value},next=!!value)=>!!value;run({});';
        const unsafe = safe.replace('next=!!value', 'next=value.length');
        const analysis = createAnalysis({ source: safe });
        const revised = createAnalysis({ source: unsafe });
        const fields = analysis.declarations.filter(({ name = '' } = {}) => name === 'value');
        const [{ index = -1 } = {}] = fields;
        const before = analysis.checkDeclaration({ index });
        const { required = true } = before;

        revised.calls.toReversed().forEach(({ index = -1 } = {}) => revised.checkCall({ index }));
        strictEqual(revised.checkDeclaration({ index }).required, true);
        deepStrictEqual(analysis.checkDeclaration({ index }), before);
        strictEqual(required, false);
    });

    test('parameter reads precede body guards and supplied later arguments cannot author a generic absence contract', () => {
        const source = 'const run=({value},next=value.length)=>!!value;';

        strictEqual(decision(`${source}run({},0);`).required, true);
        strictEqual(runInNewContext(`${source}run({},0);`), false);
        const trace = runInNewContext(`
        const events=[];
        const input={get value(){events.push('field');return undefined;}};
        const run=({value},next=(events.push('initializer'),value.length))=>{
            events.push('body');return !!value;
        };
        try{run(input);}catch(error){events.push(error.name);}
        JSON.stringify(events);
    `);

        deepStrictEqual(JSON.parse(trace), ['field', 'initializer', 'TypeError']);
    });
}

{
    const linter = new Linter();
    const rules = {
        'resilient/prefer-falsey-returns': 'error',
        'resilient/no-undefined-assignment': 'error',
        'resilient/no-undefined-comparison': 'error'
    };
    const findings = (source, sourceType = 'script') => {
        const messages = linter.verify(source, {
            languageOptions: { sourceType }, plugins: { resilient: plugin }, rules
        });

        strictEqual(messages.some(({ fatal = false } = {}) => fatal), false);

        return messages;
    };
    const read = '()=>{const value=undefined;return value===undefined?undefined:value;}';
    const dynamicSources = [
        ['body eval', `function outer(){eval("var undefined=[]");return ${read};}`],
        ['nested block eval', `function outer(){{eval("var undefined=[]");}return ${read};}`],
        ['parameter default eval', `const outer=(value=eval("var undefined=[]"))=>${read};`],
        ['computed parameter eval', `const outer=({[eval("var undefined=[]")]:value}={})=>${read};`],
        ['with closure', `function outer(){with({undefined:[]}){return ${read};}}`]
    ];

    dynamicSources.forEach(([name = '', source = ''] = []) => {
        test(`dynamic native-absence lookup preserves ordinary supplied values: ${name}`, () => {
            strictEqual(runInNewContext(`${source};Array.isArray(outer()());`), true);
            deepStrictEqual(findings(source), []);
        });
    });

    const nativeMessages = ['undefinedAssignment', 'undefinedComparison', 'falseyReturn'];
    [
        ['native undefined', `const outer=()=>${read};`],
        ['sibling execution', `function unused(){eval("var undefined=[]");}const outer=()=>${read};`],
        ['unexecuted nested function', `function outer(){const unused=()=>eval("var undefined=[]");return ${read};}`],
        ['unexecuted function default', `const outer=(value=()=>eval("var undefined=[]"))=>${read};`],
        ['eval text is not executable', `function outer(){const text='eval("var undefined=[]")';return ${read};}`],
        ['indirect eval', `function outer(){(0,eval)("var other=[]");return ${read};}`],
        ['member named eval', `function outer(){({eval(){}}).eval();return ${read};}`]
    ].forEach(([name = '', source = ''] = []) => {
        test(`unrelated syntax does not obscure native absence: ${name}`, () => {
            strictEqual(runInNewContext(`${source};outer()()===void 0;`), true);
            deepStrictEqual(findings(source).map(({ messageId = '' } = {}) => messageId), nativeMessages);
        });
    });

    test('with lookup uncertainty remains inside its lexical boundary', () => {
        const source = `function dynamic(){with({undefined:[]}){return ${read};}}const outer=()=>${read};`;

        strictEqual(runInNewContext(`${source};Array.isArray(dynamic()())&&outer()()===void 0;`), true);
        deepStrictEqual(findings(source).map(({ messageId = '' } = {}) => messageId), nativeMessages);
    });

    test('lexical undefined bindings remain ordinary values at each owned boundary', () => {
        [
            `const outer=undefined=>${read};`,
            `function outer(){const undefined=[];return ${read};}`,
            `function outer(){try{throw [];}catch(undefined){return ${read};}}`
        ].forEach((source) => {
            strictEqual(runInNewContext(`${source};Array.isArray(outer([])());`), true);
            deepStrictEqual(findings(source), []);
        });
    });

    test('dynamic undefined cannot erase explicit null, void or typeof findings', () => {
        const source = 'function outer(){eval("var undefined=[]");const nil=()=>null;const absent=()=>void 0;return typeof value==="undefined";}';

        deepStrictEqual(findings(source).map(({ messageId = '' } = {}) => messageId), [
            'falseyReturn', 'falseyReturn', 'undefinedComparison'
        ]);
    });

    test('separate lint invocations never reuse dynamic lookup classifications', () => {
        const [[, dynamic = ''] = []] = dynamicSources;
        const source = `const outer=()=>${read};`;

        deepStrictEqual(findings(dynamic), []);
        deepStrictEqual(findings(source).map(({ messageId = '' } = {}) => messageId), nativeMessages);
        deepStrictEqual(findings(dynamic), []);
        deepStrictEqual(findings(source).map(({ messageId = '' } = {}) => messageId), nativeMessages);
    });

    test('module-mode native absence and ordinary lexical bindings retain their findings', () => {
        deepStrictEqual(findings(`const outer=()=>${read};`, 'module').map(({ messageId = '' } = {}) => messageId), nativeMessages);
        deepStrictEqual(findings(`const outer=undefined=>${read};`, 'module'), []);
    });

    [
        ['optional eval', `function outer(){eval?.("var undefined=[]");return ${read};}`],
        ['parenthesized optional eval', `function outer(){(eval)?.("var undefined=[]");return ${read};}`]
    ].forEach(([name = '', source = ''] = []) => {
        test(`indirect eval preserves native-absence evidence: ${name}`, () => {
            strictEqual(runInNewContext(`${source};outer()()===void 0;`), true);
            deepStrictEqual(findings(source).map(({ messageId = '' } = {}) => messageId), nativeMessages);
        });
    });

    test('optional eval cannot hide a direct eval in its evaluated arguments', () => {
        const source = `function outer(){eval?.(eval("var undefined=[]"));return ${read};}`;

        strictEqual(runInNewContext(`${source};Array.isArray(outer()());`), true);
        deepStrictEqual(findings(source), []);
    });

    [
        ['block', '{function undefined(){return [];}}'],
        ['if block', 'if(true){function undefined(){return [];}}'],
        ['switch', 'switch(true){case true:function undefined(){return [];}}'],
        ['catch block', 'try{throw 1;}catch(error){function undefined(){return [];}}'],
        ['loop block', 'for(let i=0;i<1;i++){function undefined(){return [];}}']
    ].forEach(([name = '', declaration = ''] = []) => {
        test(`Annex B outer bindings cannot borrow native absence: ${name}`, () => {
            const source = `function outer(){${declaration}return ${read};}`;

            strictEqual(runInNewContext(`${source};typeof outer()()==="function";`), true);
            deepStrictEqual(findings(source), []);
        });
    });

    [
        ['strict ordinary block function', `function outer(){"use strict";{function undefined(){return [];}}return ${read};}`],
        ['async block function', `function outer(){{async function undefined(){return [];}}return ${read};}`],
        ['generator block function', `function outer(){{function* undefined(){yield [];}}return ${read};}`],
        ['async generator block function', `function outer(){{async function* undefined(){yield [];}}return ${read};}`],
        ['unrelated block function', `function outer(){{function other(){return [];}}return ${read};}`],
        ['sibling block function', `function sibling(){{function undefined(){return [];}}}const outer=()=>${read};`],
        ['unexecuted nested block function', `function outer(){const unused=()=>{{function undefined(){return [];}}};return ${read};}`],
        ['global block function', `{function undefined(){return [];}}const outer=()=>${read};`]
    ].forEach(([name = '', source = ''] = []) => {
        test(`non-Annex-B execution retains native absence: ${name}`, () => {
            strictEqual(runInNewContext(`${source};outer()()===void 0;`), true);
            deepStrictEqual(findings(source).map(({ messageId = '' } = {}) => messageId), nativeMessages);
        });
    });

    test('module block functions retain their lexical boundary', () => {
        const source = `function outer(){{function undefined(){return [];}}return ${read};}`;

        deepStrictEqual(findings(source, 'module').map(({ messageId = '' } = {}) => messageId), nativeMessages);
    });
}

{
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
}

{
    const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: production(), fix: true });
    const findings = async (source = '') => {
        const [{ messages = [] } = {}] = await eslint.lintText(`${source}\nexport {};\n`, { filePath: 'natural-absence-probe.js' });

        return messages.map(({ ruleId = '' } = {}) => ruleId);
    };

    [
        'let done;const run=()=>{if(typeof done!=="function")return;done();};run();',
        'let done;const input={done};const run=({done}={})=>{if(typeof done!=="function")return;done();};run(input);',
        'let value;const make=()=>value;make();',
        'let done;const record={done};if(typeof record.done==="function")record.done();',
        'let done;const values=[done];if(typeof values[0]==="function")values[0]();',
        'const make=()=>{let absent;return {_E:absent};};Object.keys(make());'
    ].forEach(source => test('production accepts natural absence with an owned guarded consumer', async () => {
        deepStrictEqual(await findings(source), []);
        runInNewContext(source);
    }));

    [
        ['let done;done();', 'resilient/no-unguarded-callback-invocation'],
        ['let done;const run=()=>done();run();', 'resilient/no-unguarded-callback-invocation'],
        ['let done;const alias=done;alias();', 'resilient/no-unguarded-callback-invocation'],
        ['let value;value.trim();', 'resilient/signature-contract-operation'],
        ['let value;const alias=value;alias.trim();', 'resilient/signature-contract-operation'],
        ['let value;const pair=[value,42];pair[0].trim();', 'resilient/signature-contract-operation'],
        ['const make=()=>{let absent;return {_E:absent};};make()._E.trim();', 'resilient/signature-contract-operation'],
        ['let done;const input={done};const run=({done}={})=>done();run(input);', 'resilient/no-unguarded-callback-invocation'],
        ['let done;const record={done};record.done();', 'resilient/signature-contract-call-site'],
        ['const make=()=>{let done;return done;};make()();', 'resilient/signature-contract-call-site'],
        ['const make=()=>{let done;return {done};};make().done();', 'resilient/signature-contract-call-site'],
        ['let done;const values=[done];values[0]();', 'resilient/signature-contract-call-site'],
        ['let done;[1].map(done);', 'resilient/signature-contract-call-site'],
        ['let done;[].map(done);', 'resilient/signature-contract-call-site']
    ].forEach(([source = '', rule = ''] = []) => test('natural absence cannot erase an unsafe invocation or operation', async () => {
        ok((await findings(source)).includes(rule));
        throws(() => runInNewContext(source), { name: 'TypeError' });
    }));

    [
        'let done;done=()=>42;done();',
        'let done;const set=()=>{done=()=>42;};set();done();',
        'for(let done of [()=>42])done();',
        'let done;eval("done=()=>42");done();'
    ].forEach(source => test('writes, dynamic lookup and iteration cannot borrow an unset lexical value', async () => {
        strictEqual((await findings(source)).includes('resilient/no-unguarded-callback-invocation'), false);
        strictEqual(runInNewContext(source), 42);
    }));

    test('natural absence retains own property and positional presence', () => {
        const source = 'let absent;const record={absent};const pair=[absent,42];'
            + 'JSON.stringify([Object.keys(record),Object.hasOwn(record,"absent"),Object.hasOwn(pair,0),pair.length,record.absent===pair[0]]);';

        strictEqual(runInNewContext(source), JSON.stringify([['absent'], true, true, 2, true]));
    });

    [
        'const read=()=>{return value;let value;};read();',
        'const read=()=>{const nested=()=>value;return nested();let value;};read();',
        'const read=flag=>{switch(flag){case 0:let value;break;case 1:return value;}};read(1);'
    ].forEach(source => test('unreached lexical declarations cannot establish normal undefined', () => {
        throws(() => runInNewContext(source), { name: 'ReferenceError' });
        const analysis = createAnalysis({ source });
        const calls = analysis.calls.filter(({ callee = '' } = {}) => callee === 'read');

        calls.forEach(({ index = -1 } = {}) => strictEqual(analysis.checkCallResult({ index, required: 'nullish' }).status, 'unknown'));
    }));

    test('separate unset declarations retain evidence across contexts and query orders', () => {
        const source = 'const make=flag=>{let first;const read=()=>first;if(flag)return read();let second;return second;};make(true);make(false);';
        const analysis = createAnalysis({ source });
        const calls = analysis.calls.filter(({ callee = '' } = {}) => callee === 'make');
        const expected = calls.map(({ index = -1 } = {}) => analysis.checkCallResult({ index, required: 'nullish' }));

        deepStrictEqual(expected.map(({ status = '' } = {}) => status), ['agreement', 'agreement']);
        const reversed = createAnalysis({ source });

        deepStrictEqual(calls.toReversed().map(({ index = -1 } = {}) => reversed.checkCallResult({ index, required: 'nullish' })).toReversed(), expected);
    });

    test('TypeScript acquisition publishes the same reached lexical absence', () => {
        const source = 'const read=()=>{let value;return value;};read();';
        const { fact = {}, normal = false } = analyze(source).checkFunction({ index: 0 });
        const { families = [] } = fact;

        strictEqual(normal, true);
        deepStrictEqual(families, ['nullish']);
        const { fact: before = {} } = analyze('const read=()=>{return value;let value;};read();').checkFunction({ index: 0 });
        const { families: premature = [] } = before;

        deepStrictEqual(premature, []);
    });

    [
        'let absent;if(false)absent();',
        'let absent;if(false)({done:absent}).done();',
        'let absent;if(false)[1].map(absent);',
        'let absent;const record={done:absent};if(typeof record.done==="function")record.done();',
        'let absent;const run=flag=>{const value=flag?()=>42:absent;value();};run(false);'
    ].forEach(source => test('promise inspection cannot lend standalone execution to call contracts', () => {
        const first = createAnalysis({ source });
        const expected = first.calls.map(({ index = -1 } = {}) => first.checkCall({ index }));
        const changed = createAnalysis({ source });

        changed.promiseUses.toReversed().forEach(({ index = -1 } = {}) => changed.checkPromiseUse({ index }));
        deepStrictEqual(changed.calls.map(({ index = -1 } = {}) => changed.checkCall({ index })), expected);
    }));

    [
        'return typeof value === "function" ? value() : "";',
        'if(typeof value !== "function")return "";return value();',
        'const alias=value;if(typeof alias !== "function")return "";return alias();',
        'if(typeof value !== "function")return "";const call=()=>value();return call();',
        'if(typeof value !== "function")return "";const outer=()=>()=>value();return outer()();',
        'const alias=value;if(typeof alias !== "function")return "";const outer=()=>()=>alias();return outer()();',
        'if(typeof value !== "function")return "";Reflect.get(globalThis,"external")(value);return "";',
        'if(typeof value !== "function")return "";[value].forEach(call=>call());return "";',
        'return typeof value !== "function" || value();',
        'if("function" !== typeof value){return "";}return value();'
    ].forEach(body => test('each guarded source use retains its proof when absence prunes execution', async () => {
        const source = `const make=()=>{let absent;return {value:absent};};const read=()=>{const {value}=make();${body}};read();`;

        deepStrictEqual(await findings(source), []);
        runInNewContext(source);
    }));

    [
        'if(false)value();return "";',
        'if(typeof value!=="string")return "";return value();',
        'value();return typeof value==="function";',
        'if(typeof value==="function")value();return value;',
        'if(typeof value!=="function"){if(external)return "";}return value();'
    ].forEach(body => test('unreachable uses still need their own callable absence contract', async () => {
        const source = `const make=()=>{let absent;return {value:absent};};const read=()=>{const {value}=make();${body}};read();`;

        ok((await findings(source)).includes('resilient/prefer-safe-destructuring-defaults'));
    }));

    test('callable admission uses either terminating branch without changing the separate no-else policy', () => {
        const source = 'const make=()=>{let absent;return {value:absent};};const read=()=>{const {value}=make();'
            + 'if(typeof value==="function"){external(value);}else{return "";}return value;};read();';
        const analysis = createAnalysis({ source });
        const { index = -1 } = analysis.declarations.find(({ name = '' } = {}) => name === 'value') ?? {};
        const { required = true } = analysis.checkDeclaration({ index });

        strictEqual(required, false);
        runInNewContext(source);
    });
}

{
    const assignment = 'resilient/no-undefined-assignment';
    const comparison = 'resilient/no-undefined-comparison';
    const lint = (source, rule = assignment) => new Linter().verify(source, {
        languageOptions: { sourceType: 'script' }, plugins: { resilient: plugin }, rules: { [rule]: 'error' }
    });

    [
        ['const cursor=undefined;', 'undefined'],
        ['const record={...{cursor:undefined}};', 'undefined'],
        ['const records=[...[undefined]];', 'undefined'],
        ['const record={cursor:undefined};', 'undefined'],
        ['const records=[{cursor:[undefined]}];', 'undefined'],
        ['const cursor=flag?undefined:"";', 'undefined'],
        ['const cursor=void 0;', 'void 0'],
        ['const record={cursor:void effect()};', 'void effect()'],
        ['const cursor=("ready",undefined);', 'undefined'],
        ['const cursor=undefined&&"ready";', 'undefined'],
        ['const read=({cursor=void 0}={})=>cursor;', 'void 0'],
        ['const record=({cursor:undefined})||{};', 'undefined'],
        ['const read=(undefined)=>void 0;const cursor=void read();', 'void read()'],
        ['let first;let second;first=second=undefined;', 'undefined']
    ].forEach(([source = '', selected = ''] = []) => test(`explicit assigned absence retains its source: ${source}`, () => {
        const messages = lint(source);
        const [{ column = 0, endColumn = 0, fix = false, suggestions = [] } = {}] = messages;

        strictEqual(messages.length, 1);
        strictEqual(source.slice(column - 1, endColumn - 1), selected);
        strictEqual(fix, false);
        deepStrictEqual(suggestions, []);
    }));

    [
        'const read=undefined=>{const record={cursor:undefined};return record;};',
        'function read(){eval("var undefined=42");const record={cursor:[undefined]};return record;}',
        'function read(){with({undefined:42}){const record={cursor:undefined};return record;}}',
        'let cursor;', 'const records=[,];', 'const read=()=>{return;};',
        'const read=()=>undefined;', 'const record=external;',
        'const record={[undefined]:"ready"};', 'const record={[void 0]:"ready"};',
        'void Promise.resolve();', 'const cursor=(undefined,"ready");',
        'const cursor=undefined||"ready";', 'const cursor=undefined??"ready";',
        'const cursor=(flag?undefined:"ready")||"fallback";',
        'const cursor={...undefined};'
    ].forEach(source => test(`assignment does not invent an explicit absence value: ${source}`, () => {
        deepStrictEqual(lint(source), []);
    }));

    ['value===void 0', 'void effect()!==value', 'value==undefined', 'typeof value==="undefined"'].forEach(expression => test(`explicit absence comparison: ${expression}`, () => {
        const messages = lint(`const read=value=>${expression};`, comparison);
        const [{ messageId = '', fix = false } = {}] = messages;

        strictEqual(messages.length, 1);
        strictEqual(messageId, 'undefinedComparison');
        strictEqual(fix, false);
    }));

    test('absence diagnostics leave side effects and exact falsey distinctions untouched', () => {
        const source = 'const seen=[];const effect=()=>seen.push(1);const record={cursor:void effect()};[record.cursor===void 0,seen.length];';

        strictEqual(lint(source).length, 1);
        strictEqual(lint(source, comparison).length, 1);
        strictEqual(JSON.stringify(runInNewContext(source)), '[true,1]');
        deepStrictEqual(lint('const read=(undefined,value)=>value===undefined;', comparison), []);
        strictEqual(lint('const read=(undefined,value)=>value===void 0;', comparison).length, 1);
    });

    [['null', 'resilient/no-null-assignment'], ['undefined', assignment], ['void 0', assignment]].forEach(([value = '', rule = ''] = []) => {
        [
            `const make=()=>({cursor:${value}});`,
            `consume({cursor:${value}});`,
            `consume([${value}]);`,
            `const make=()=>[...[${value}]];`,
            `consume({...{cursor:${value}}});`
        ].forEach(source => test(`literal container owns its assigned absence: ${source}`, () => {
            const messages = lint(source, rule);
            const [{ column = 0, endColumn = 0 } = {}] = messages;

            strictEqual(messages.length, 1);
            strictEqual(source.slice(column - 1, endColumn - 1), value);
        }));
        [
            `consume(${value});`, `const make=()=>${value};`,
            `consume({[${value}]:"ready"});`, `consume({...${value}});`,
            `const cursor=(${value},"ready");`, `const cursor=${value}||"ready";`,
            `const cursor=${value}??"ready";`, `let cursor=1;cursor+=${value};`,
            `let cursor=1;const result=(cursor+=${value});`, `let cursor=1;consume({result:cursor*=${value}});`
        ].forEach(source => test(`assignment selection does not borrow a noncontributing value: ${source}`, () => {
            deepStrictEqual(lint(source, rule), []);
        }));
    });

    test('nested assignment and container listeners report each explicit value once', () => {
        strictEqual(lint('let value;const other=value={first:undefined,second:[undefined]};').length, 2);
        strictEqual(lint('let value;const other=value={first:null,second:[null]};', 'resilient/no-null-assignment').length, 2);
        deepStrictEqual(lint('const read=undefined=>({nested:[undefined]});'), []);
    });
}
