import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const findings = source => new Linter().verify(source, {
    plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-operation': 'error' }
});

[
    ['native text conversion', 'String(42).map(Boolean);', 1],
    ['renamed text conversion', 'const renamed=String;renamed(42).map(Boolean);', 1],
    ['native numeric conversion', 'Number("42").trim();', 1],
    ['native boolean conversion', 'Boolean(42).trim();', 1],
    ['native entries', 'Object.entries({}).trim();', 1],
    ['native keys', 'Object.keys({}).trim();', 1],
    ['native values', 'Object.values({}).trim();', 1],
    ['constructor alias', 'const renamed=Object;renamed.entries({}).trim();', 1],
    ['factory alias', 'const renamed=Object.entries;renamed({}).trim();', 1],
    ['factory alias chain', 'const select=Object.entries;const renamed=select;renamed({}).trim();', 1],
    ['direct native receiver', '"".trim().map(Boolean);', 1],
    ['array receiver alias', 'const value=[];const alias=value;alias.map(x=>x).trim();', 1],
    ['extracted string method loses its receiver', 'const method="".trim;const result=method();result.map(Boolean);', 0],
    ['extracted array method loses its receiver', 'const method=[].map;const result=method(x=>x);result.trim();', 0],
    ['method alias chain does not restore receiver', 'const method=[].map;const alias=method;alias(x=>x).trim();', 0],
    ['conditional method loses receiver', '(flag?[].map:[].filter)(x=>x).trim();', 0],
    ['logical method loses receiver', '(true&&[].map)(x=>x).trim();', 0],
    ['returned method loses receiver', 'const get=()=>[].map;get()(x=>x).trim();', 0],
    ['receiver-bearing method is independent of outer alias', 'const get=()=>[].map(x=>x);const alias=get;alias().trim();', 1],
    ['scalar shadow', 'const String=value=>[];String(42).map(Boolean);', 0],
    ['factory shadow', 'const Object={entries:()=>""};Object.entries({}).trim();', 0],
    ['later lexical shadow', 'String(42).map(Boolean);const String=external;', 0],
    ['shadowed namespace alias', 'const Object=external;const renamed=Object;renamed.entries({}).trim();', 0],
    ['constructor exposure in an unresolved alternative', 'const select=flag?String:external;select(42).map(Boolean);', 0],
    ['unknown beside known callable result', 'const convert=value=>String(value);const select=flag?convert:external;select(42).map(Boolean);', 1],
    ['overwritten factory', 'Object.entries=external;Object.entries({}).trim();', 0],
    ['overwritten namespace alias', 'const renamed=Object;renamed.entries=external;Object.entries({}).trim();', 0],
    ['factory alias overwrite', 'let renamed=Object.entries;renamed=external;renamed({}).trim();', 0],
    ['namespace escape', 'external(Object);Object.entries({}).trim();', 0],
    ['scalar constructor escape', 'external(String);String(42).map(Boolean);', 0],
    ['prototype exposure', 'external(Object.prototype);Object.entries({}).trim();', 0],
    ['reflection retires native identity', 'Object.getOwnPropertyDescriptor(Object,"entries");Object.entries({}).trim();', 0],
    ['destructured property is not the namespace', 'const {entries}=Object;entries.entries({}).trim();', 0],
    ['method spelling is not native identity', 'external.entries({}).trim();', 0],
    ['inert aggregate default', 'const read=(page={items:[]})=>{const {items=[]}=page;return items;};read({}).trim();', 1],
    ['inert nested aggregate default', 'const read=(page={data:{items:[]}})=>{const {data:{items=[]}={}}=page;return items;};read().trim();', 1],
    ['effectful aggregate default', 'const read=(page={items:external()})=>{const {items=[]}=page;return items;};read().trim();', 0],
    ['computed coercion default', 'const read=(page={[{}]:[]})=>{const {items=[]}=page;return items;};read().trim();', 0],
    ['computed primitive key default', 'const read=(page={["items"]:[]})=>{const {items=[]}=page;return items;};read().trim();', 1],
    ['default getter is not inert', 'const read=(page={get items(){return external;}})=>{const {items=[]}=page;return items;};read().trim();', 0],
    ['default spread is not inert', 'const read=(page={...external})=>{const {items=[]}=page;return items;};read().trim();', 0]
].forEach(([name = '', source = '', expected = 0] = []) => {
    test(`native source identity: ${name}`, () => {
        strictEqual(findings(source).length, expected);
        const analysis = createAnalysis({ source });
        const { memberAccesses = [] } = analysis;
        const conflicts = memberAccesses.flatMap(({ index = -1 } = {}) => {
            const { conflicts = [] } = analysis.checkMemberAccess({ index });

            return conflicts;
        });

        strictEqual(conflicts.length, expected);
    });
});

test('native factories evaluate arguments before establishing a normal result', () => {
    const source = 'const fail=()=>{throw 42;};String(fail()).map(Boolean);';
    const analysis = createAnalysis({ source });
    const { calls = [] } = analysis;
    const { index = -1 } = calls.find(({ callee = '' } = {}) => callee === 'String') ?? {};
    const { normal = true, thrown = false } = analysis.checkCallResult({ index, required: 'string' });

    strictEqual(normal, false);
    strictEqual(thrown, true);
    deepStrictEqual(findings(source), []);
});

test('native ownership is independent of source revision and query order', () => {
    const source = 'const renamed=String;renamed(42).map(Boolean);';
    const first = createAnalysis({ source });
    const second = createAnalysis({ source });
    const revised = createAnalysis({ source: source.replace('String', 'external') });
    const before = first.checkCallResult({ index: 0, required: 'string' });

    second.memberAccesses.toReversed().forEach(({ index = -1 } = {}) => second.checkMemberAccess({ index }));
    deepStrictEqual(second.checkCallResult({ index: 0, required: 'string' }), before);
    strictEqual(revised.checkCallResult({ index: 0, required: 'string' }).status, 'unknown');
    deepStrictEqual(first.checkCallResult({ index: 0, required: 'string' }), before);
});

[
    ['[,42].map(read)', 'const read=(value="")=>value;', 'contradiction'],
    ['[,].map(read)', 'const read=(value="")=>value;', 'unknown'],
    ['[,].find(read)', 'const read=(value="")=>value;', 'unknown'],
    ['[external,42].forEach(read)', 'const read=(value="")=>value;', 'contradiction'],
    ['[1,2].reduce(read,"")', 'const read=(state="",value=0)=>state;', 'unknown'],
    ['[1,2].reduce(read,0)', 'const read=(state="",value=0)=>state;', 'contradiction'],
    ['[1,2].reduceRight(read,0)', 'const read=(state="",value=0)=>state;', 'unknown']
].forEach(([call = '', declaration = '', expected = ''] = []) => test(`native callback agreement: ${call}`, () => {
    const source = `${declaration}${call};`;
    const analysis = createAnalysis({ source });
    const selected = analysis.calls.find(({ callee = '' } = {}) => ['map', 'find', 'forEach', 'reduce', 'reduceRight'].includes(callee));

    ok(selected);
    const { index = -1 } = selected;

    strictEqual(analysis.checkCall({ index }).status, expected);
    const findings = new Linter().verify(source, {
        plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' }
    });

    strictEqual(Boolean(findings.length), expected === 'contradiction');
    const reordered = createAnalysis({ source });

    reordered.functions.toReversed().forEach(({ index: functionIndex = -1 } = {}) => reordered.checkFunction({ index: functionIndex }));
    deepStrictEqual(reordered.checkCall({ index }), analysis.checkCall({ index }));
}));

test('callback agreements remain explicit inside an unknown native call summary', () => {
    const analysis = createAnalysis({ source: 'const read=(state="",value=0)=>state;[1,2].reduce(read,"");' });
    const { status = '', obligations = [] } = analysis.checkCall({ index: 0 });

    strictEqual(status, 'unknown');
    strictEqual(obligations.length, 4);
    deepStrictEqual(obligations.map(({ status: result = '' } = {}) => result), ['agreement', 'agreement', 'agreement', 'agreement']);
});
