import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const cases = JSON.parse(readFileSync(new URL('./fixtures/calls-completions.json', import.meta.url), 'utf8'));
const callRule = 'signature-contract-call-site';
const returnRule = 'signature-contract-return-consistency';
const guardRule = 'no-unguarded-callback-invocation';
const names = [callRule, returnRule, guardRule];
const rulesFor = selected => Object.fromEntries(selected.map(name => [`resilient/${name}`, 'error']));
const lint = (source, selected = names, options = {}) => new Linter().verify(source, {
    plugins: { resilient: plugin }, rules: rulesFor(selected), ...options
});
const spans = (source, findings) => findings.map(({ column = 0, endColumn = 0 } = {}) => source.slice(column - 1, endColumn - 1));

cases.forEach(({ rule = '', source = '', languageOptions = {}, expected = [] } = {}) => test(`${rule} source contract: ${source}`, () => {
    deepStrictEqual(lint(source, [rule], { languageOptions }), expected);
}));

[
    [callRule, 'const read=(value="")=>value;read(42);', 1],
    [returnRule, 'const read=flag=>flag?[]:"";', 2],
    [guardRule, 'const run=({done}={})=>done();', 1]
].forEach(([name = '', source = '', count = 0] = []) => {
    test(`public configuration, documentation and unchanged source: ${name}`, () => {
        const rule = `resilient/${name}`;
        const { rules = {}, configs: { contracts = {}, safety = {} } = {} } = plugin;
        const { meta: { docs: { url = '' } = {}, fixable = false, hasSuggestions = false } = {} } = Reflect.get(rules, name);

        strictEqual(url, `https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/${name}.md`);
        strictEqual(fixable, false);
        strictEqual(hasSuggestions, false);
        deepStrictEqual(lint(source, [name], { rules: { [rule]: 'off' } }), []);
        const warnings = lint(source, [name], { rules: { [rule]: 'warn' } });

        strictEqual(warnings.length, count);
        ok(warnings.every(({ severity = 0 } = {}) => severity === 1));
        strictEqual(lint(source, [name]).length, count);
        strictEqual(new Linter().verify(source, name === guardRule ? safety : contracts).filter(({ ruleId = '' } = {}) => ruleId === rule).length, count);
        const { output = '', fixed = false } = new Linter().verifyAndFix(source, { plugins: { resilient: plugin }, rules: rulesFor([name]) });

        strictEqual(output, source);
        strictEqual(fixed, false);
    });

    test(`exact local exception remains rule-owned: ${name}`, () => {
        const engine = new Linter();
        const findings = engine.verify(`// eslint-disable-next-line resilient/${name} -- Deliberate negative fixture.\n${source}`,
            { plugins: { resilient: plugin }, rules: rulesFor([name]) });

        deepStrictEqual(findings, []);
        strictEqual(engine.getSuppressedMessages().length, count);
    });
});

[
    ['flag?42:"ok"', 'number-like'],
    ['flag?null:void 0', 'null or undefined'],
    ['flag?null:"ok"', 'null or undefined'],
    ['flag?42:void 0', 'number-like'],
    ['flag?null:other?42:void 0', 'null or undefined or number-like'],
    ['flag?42:external', 'number-like'],
    ['flag?"ok":other?42:external', 'number-like'],
    ['flag?[]:"ok"', 'array-like']
].forEach(([value = '', actual = ''] = []) => {
    [false, true].forEach(nested => test(`contradiction wording excludes compatible alternatives: ${nested ? 'field' : 'formal'} ${value}`, () => {
        const source = nested ? `const read=({name=""}={})=>name;read({name:${value}});` : `const read=(name="")=>name;read(${value});`;
        const findings = lint(source, [callRule]);

        strictEqual(findings.length, 1);
        strictEqual(findings.at(0).message, `${nested ? 'name' : 'argument'} expects string-like, but this call supplies ${actual}.`);
        deepStrictEqual(spans(source, findings), [value]);
        const analysis = createAnalysis({ source });
        const calls = analysis.calls.filter(({ callee = '' } = {}) => callee === 'read');

        strictEqual(calls.length, 1);
        strictEqual(analysis.checkCall({ index: calls.at(0).index }).status, 'contradiction');
    }));
});

test('wording preserves complete normalized public evidence and native default behavior', () => {
    const source = 'const read=(value="")=>value;read(flag?null:void 0);';
    const analysis = createAnalysis({ source });
    const { obligations = [] } = analysis.checkCall({ index: 0 });
    const { facts = [], absence = '' } = obligations.at(0);
    const families = facts.filter(({ facet = '' } = {}) => facet === 'family').flatMap(({ families = [] } = {}) => families);

    deepStrictEqual(families.toSorted(), ['nullish', 'string']);
    strictEqual(absence, 'unknown');
    strictEqual(runInNewContext('const read=(value="")=>value;JSON.stringify([read(null),read(void 0)]);'), '[null,""]');
    deepStrictEqual(lint('const read=(value="")=>value;read();read(void 0);read("ok");', [callRule]), []);
});

[
    ['const read=(value="")=>value;const apply=value=>read(value);apply(42);apply(42);', ['apply(42)', 'apply(42)']],
    ['const read=(value="")=>value;const apply=()=>read(42);apply();apply();', ['42']],
    ['const read=(value="")=>value;const apply=(cb,value)=>cb(value);const relay=(cb,value)=>apply(cb,value);relay(read,42);', ['relay(read,42)']],
    ['const read=(value="")=>value;const apply=value=>{try{return read(value);}finally{return [];}};apply(42);', ['apply(42)']],
    ['const read=(value="")=>value;const apply=value=>{try{throw 0;}finally{return read(value);}};apply(42);', ['apply(42)']],
    ['const read=(value="")=>value;const apply=value=>{throw 0;read(value);};apply(42);', []],
    ['const read=(value="")=>value;const apply=value=>read(value);apply(flag?42:"ok");', ['apply(flag?42:"ok")']]
].forEach(([source = '', expected = []] = []) => test(`completed obligations retain forwarding location and avoid duplicate direct findings: ${source}`, () => {
    const findings = lint(source, [callRule]);

    deepStrictEqual(spans(source, findings), expected);
    findings.forEach(({ message = '' } = {}) => strictEqual(message, 'argument expects string-like, but this call supplies number-like.'));
}));

[
    ['const read=cb=>{if(cb())return "a";return cb()?1:"b";};', 3],
    ['const shape=x=>Array.isArray(x)?[]:{};const copy=read=>shape(read());', 3],
    ['const isFunction=value=>typeof value==="function";const read=value=>isFunction(value)?value:"";', 2],
    ['const read=value=>isFunction(value)?value:"";', 0],
    ['const read=({name=""}={})=>name&&name!=="a";', 0],
    ['const read=({name=""}={})=>{if(typeof name==="string")return name&&name!=="a";return false;};', 2],
    ['const run=({done}={})=>{if(typeof done!=="function")return;return done;};', 2],
    ['const run=({done}={})=>{if(typeof done!=="function")return;done();};', 0],
    ['const read=flag=>{try{return flag?[]:"";}finally{return 42;}};', 0],
    ['const read=flag=>{try{return flag?[]:"";}finally{if(other)throw 42;}};', 2],
    ['const read=async flag=>{if(flag)return [];throw "failure";};', 0],
    ['const read=async flag=>{if(flag)return [];return "";};', 2]
].forEach(([source = '', count = 0] = []) => test(`producer evidence owns returns independently of invocation guards: ${source}`, () => {
    strictEqual(lint(source, [returnRule]).length, count);
}));

[
    ['const read=(callback=external())=>{if(flag)return [];return "";};', 0]
].forEach(([source = '', index = -1] = []) => test(`unsupported parameter initialization remains explicit unknown: ${source}`, () => {
    const analysis = createAnalysis({ source });
    const { status = '', diagnostics = [], fact: { causes = [] } = {} } = analysis.checkFunction({ index });

    strictEqual(status, 'unknown');
    deepStrictEqual(diagnostics, []);
    ok(causes.some(({ code = '' } = {}) => code === 'opaque-execution'));
}));

[
    ['const run=({done}={})=>done();', 1],
    ['const run=({done}={})=>{if(typeof done==="function")done();};', 0],
    ['const run=({done}={})=>isFunction(done)&&done();', 0],
    ['const isFunction=value=>true;const run=({done}={})=>isFunction(done)&&done();', 1],
    ['const check=value=>typeof value==="function";const run=({done}={})=>check(done)&&done();', 0],
    ['const run=({done}={})=>{const alias=done;if(typeof alias==="function")done();};', 0],
    ['const run=({done}={})=>{if(typeof done==="function")return ()=>done();};', 0],
    ['const run=({done}={})=>{const invoke=()=>done();if(typeof done==="function")return invoke;};', 1],
    ['const run=({done}={})=>{if(typeof done!=="function")return;external();done();};', 0],
    ['const run=({done}={})=>send(done);', 0],
    ['const run=({done=actualContract}={})=>done();', 0]
].forEach(([source = '', count = 0] = []) => test(`callback capability follows binding, guard and closure lifetime: ${source}`, () => {
    strictEqual(lint(source, [guardRule]).length, count);
}));

[
    'const run=({done}={})=>{if(typeof done==="function"){done=external;done();}};',
    'const run=({done}={})=>{if(typeof done==="function"){const invoke=()=>done();done=external;return invoke;}};',
    'const isFunction=()=>true;const run=({done}={})=>isFunction(done)&&done();'
].forEach(source => test(`mutable bindings and constant helpers retain their findings: ${source}`, () => {
    const analysis = createAnalysis({ source });
    const invocations = analysis.invocations.filter(({ optionalCallback = false } = {}) => optionalCallback);

    strictEqual(invocations.length, 1);
    strictEqual(analysis.checkInvocation({ index: invocations.at(0).index }).status, 'contradiction');
    strictEqual(lint(source, [guardRule]).length, 1);
}));

test('producer, call and guard queries are isolated across order and revisions', () => {
    const source = 'const read=flag=>flag?[]:"";read(true);read(false);const run=({done}={})=>done();';
    const inspect = (analysis, reverse = false) => {
        const queries = [
            ...analysis.calls.map(({ index = -1 } = {}) => () => analysis.checkCall({ index })),
            ...analysis.calls.map(({ index = -1 } = {}) => () => analysis.checkCallResult({ index, required: 'array' })),
            ...analysis.functions.map(({ index = -1 } = {}) => () => analysis.checkFunction({ index })),
            ...analysis.invocations.map(({ index = -1 } = {}) => () => analysis.checkInvocation({ index }))
        ];

        ok(analysis.calls.length && analysis.functions.length && analysis.invocations.length);

        if (reverse) queries.toReversed().forEach(query => query());

        return queries.map(query => query());
    };
    const first = createAnalysis({ source });
    const expected = inspect(first);

    deepStrictEqual(inspect(createAnalysis({ source }), true), expected);
    const revised = source.replace('=>done()', '=>{if(typeof done==="function")done();}');

    deepStrictEqual(lint(revised, [guardRule]), []);
    strictEqual(lint(source, [guardRule]).length, 1);
    deepStrictEqual(inspect(first, true), expected);
    const findings = lint(source);

    strictEqual(findings.length, 3);
    names.forEach((name, index) => {
        const order = [...names.slice(index), ...names.slice(0, index)];

        strictEqual(order.at(0), name);
        deepStrictEqual(lint(source, order), findings);
        deepStrictEqual(lint(source, order.toReversed()), findings);
    });
});
