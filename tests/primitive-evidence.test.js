import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const lint = source => new Linter().verify(source, {
    plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-operation': 'error' }
});

[
    ['negative numeric default', 'const read=(value=-1)=>value;read().trim();', 1],
    ['positive numeric default', 'const read=(value=+1)=>value;read().trim();', 1],
    ['nested numeric default', 'const read=({value=-1}={})=>value;read().trim();', 1],
    ['supplied value owns its family', 'const read=(value=-1)=>value;read("").map(Boolean);', 1],
    ['default does not validate unknown input', 'const read=(value=-1)=>value;read(external).trim();', 0],
    ['coercive default remains opaque', 'const read=(value=-external)=>value;read().trim();', 0],
    ['object coercion remains opaque', 'const read=(value=-{valueOf(){throw 1;}})=>value;read().trim();', 0],
    ['BigInt unary plus is not numeric success', '(+1n).trim();', 0],
    ['BigInt unary minus stays outside the numeric proof', '(-1n).trim();', 0],
    ['numeric alias', 'const number=1;const alias=number;(-alias).trim();', 1],
    ['numeric shadow', 'const number=1;const inspect=(number=external)=>(-number).trim();', 0],
    ['falsey signed zero keeps selection', 'const read=()=>-0?[]:"";read().trim();', 0],
    ['negative value keeps truth', 'const read=()=>-1?[]:"";read().trim();', 1],
    ['nullish default is excluded by guard', 'const inspect=(value=undefined)=>{if(value!=null)return value.toUpperCase();return "";};', 0],
    ['reversed loose comparison', 'const inspect=(value=null)=>{if(undefined!=value)return value.toUpperCase();return "";};', 0],
    ['nullish guard does not remove numbers', 'const inspect=(value=0)=>{if(value!=null)return value.toUpperCase();return "";};', 1],
    ['nullish equality selects authored absence', 'const inspect=(value=null)=>{if(value==undefined)return value.toUpperCase();return "";};', 1],
    ['shadowed undefined is ordinary input', 'const inspect=(value=null,undefined=0)=>{if(value!=undefined)return value.toUpperCase();return "";};', 1],
    ['unknown alternatives retain numeric contradiction', 'const value=flag?0:external;if(value!=null)value.toUpperCase();', 1],
    ['alias retains nullish guard identity', 'const inspect=(value=null)=>{const alias=value;if(alias!=null)return value.toUpperCase();return "";};', 0],
    ['intervening write retires nullish identity', 'const inspect=(value=null)=>{if(value!=null){value=external;return value.toUpperCase();}return "";};', 0]
].forEach(([name = '', source = '', expected = 0] = []) => test(`primitive boundary: ${name}`, () => {
    strictEqual(lint(source).length, expected);
    const analysis = createAnalysis({ source });
    const { memberAccesses = [] } = analysis;
    const conflicts = memberAccesses.flatMap(({ index = -1 } = {}) => {
        const { conflicts = [] } = analysis.checkMemberAccess({ index });

        return conflicts;
    });

    strictEqual(conflicts.length, expected);
}));

[
    'const fail=()=>{throw 1;};const read=()=>-fail();',
    'const fail=()=>{throw 1;};const read=()=>fail()!=null;',
    'const fail=()=>{throw 1;};const read=()=>null!=fail();'
].forEach(source => test('primitive operations preserve operand failure before producing a value', () => {
    const analysis = createAnalysis({ source });
    const { normal = true, thrown = false } = analysis.checkFunction({ index: 1 });

    strictEqual(normal, false);
    strictEqual(thrown, true);
}));

test('primitive defaults retain independent generic evidence across revisions and query order', () => {
    const source = 'const read=(value=-1)=>value;read().trim();read("").map(Boolean);';
    const first = createAnalysis({ source });
    const second = createAnalysis({ source });
    const revised = createAnalysis({ source: source.replace('value=-1', 'value=""') });
    const before = first.checkFunction({ index: 0 });
    const { memberAccesses = [] } = second;

    memberAccesses.toReversed().forEach(({ index = -1 } = {}) => second.checkMemberAccess({ index }));
    deepStrictEqual(second.checkFunction({ index: 0 }), before);
    deepStrictEqual(first.checkFunction({ index: 0 }), before);
    deepStrictEqual(revised.checkFunction({ index: 0 }), before);
    strictEqual(lint(source).length, 2);
    strictEqual(lint(source.replace('value=-1', 'value=""')).length, 1);
});
