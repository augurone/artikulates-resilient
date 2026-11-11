import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const lint = (source, rule = 'signature-contract-operation') => new Linter().verify(source, {
    plugins: { resilient: plugin }, rules: { [`resilient/${rule}`]: 'error' }
});

[
    ['positive numeric type', 'const read=value=>{if(typeof value==="number")return value.trim();return "";};', 1],
    ['reversed type comparison', 'const read=value=>{if("number"===typeof value)return value.trim();return "";};', 1],
    ['negative guard leaves positive continuation', 'const read=value=>{if(typeof value!=="number")return "";return value.trim();};', 1],
    ['conditional selection', 'const read=value=>typeof value==="number"?value.trim():"";', 1],
    ['conjunctive selection', 'const read=value=>typeof value==="number"&&value.trim();', 1],
    ['alias of stable formal', 'const read=value=>{const alias=value;if(typeof alias==="number")return value.trim();return "";};', 1],
    ['renamed formal', 'const read=renamed=>{if(typeof renamed==="number")return renamed.trim();return "";};', 1],
    ['shadow has distinct identity', 'const read=value=>{if(typeof value==="number"){const value=external;return value.trim();}return "";};', 0],
    ['written formal retires proof', 'const read=value=>{if(typeof value==="number"){value=external;return value.trim();}return "";};', 0],
    ['captured write retires proof', 'const read=value=>{const change=()=>{value=external;};if(typeof value==="number"){change();return value.trim();}return "";};', 0],
    ['dynamic lookup retires proof', 'const read=value=>{if(typeof value==="number"){eval("value=external");return value.trim();}return "";};', 0],
    ['opaque call cannot rebind stable primitive', 'const read=value=>{if(typeof value==="number"){external();return value.trim();}return "";};', 1],
    ['negative test does not establish one remaining family', 'const read=value=>{if(typeof value!=="number")return value.trim();return "";};', 0],
    ['disjunction leaves an unknown alternative', 'const read=value=>{if(typeof value==="number"||external)return value.trim();return "";};', 0],
    ['incompatible type tests make branch unreachable', 'const read=value=>{if(typeof value==="number"&&typeof value==="string")return value.map(Boolean);return "";};', 0],
    ['typeof object does not distinguish arrays or null', 'const read=value=>{if(typeof value==="object")return value.trim();return "";};', 0],
    ['array is not a typeof result', 'const read=value=>typeof value==="array"?value.trim():"";', 0],
    ['unknown typeof spelling is impossible', 'const read=value=>typeof value==="madeup"?value.trim():"";', 0],
    ['plain truthiness does not establish a family', 'const read=value=>{if(value)return value.trim();return "";};', 0],
    ['known branch survives unknown alternative', 'const read=value=>{if(typeof value==="number")return (external?value:unknown).trim();return "";};', 1],
    ['native array predicate', 'const read=value=>{if(Array.isArray(value))return value.trim();return "";};', 1],
    ['destructured formal has stable selected identity', 'const read=({value=[]}={})=>{if(Array.isArray(value))return value.trim();return "";};', 1],
    ['local destructuring captures the tested value', 'const read=()=>{const {value}=external;if(Array.isArray(value))return value.trim();return "";};', 1],
    ['repeated member read has no captured value identity', 'const read=value=>{if(Array.isArray(value.items))return value.items.trim();return "";};', 0],
    ['native predicate namespace alias', 'const Native=Array;const read=value=>{if(Native.isArray(value))return value.trim();return "";};', 1],
    ['native predicate alias', 'const check=Array.isArray;const read=value=>{if(check(value))return value.trim();return "";};', 1],
    ['native predicate alias chain', 'const check=Array.isArray;const renamed=check;const read=value=>{if(renamed(value))return value.trim();return "";};', 1],
    ['negative array guard preserves authored absence', 'const read=(value={})=>{if(!Array.isArray(value))return value.map(Boolean);return "";};', 1],
    ['aliased array guard preserves authored absence', 'const check=Array.isArray;const read=(value={})=>{if(!check(value))return value.map(Boolean);return "";};', 1],
    ['shadowed native predicate uses its body', 'const Array={isArray:()=>true};const read=value=>{if(Array.isArray(value))return value.trim();return "";};', 0],
    ['overwritten predicate stays unknown', 'Array.isArray=external;const read=value=>{if(Array.isArray(value))return value.trim();return "";};', 0],
    ['escaped namespace stays unknown', 'external(Array);const read=value=>{if(Array.isArray(value))return value.trim();return "";};', 0],
    ['property spelling is not native proof', 'const read=value=>{if(external.isArray(value))return value.trim();return "";};', 0],
    ['negative array test does not imply object', 'const read=value=>{if(!Array.isArray(value))return value.map(Boolean);return "";};', 0],
    ['guard does not validate elements', 'const read=value=>{if(Array.isArray(value))return value.at(0).trim();return "";};', 0],
    ['array brand does not prove a native method', 'const read=value=>{if(Array.isArray(value))return value.map(external).trim();return "";};', 0],
    ['function type does not prove a native call property', 'const read=value=>{if(typeof value==="function")return value.call().trim();return "";};', 0],
    ['owned array alternatives retain their native premise', 'const read=flag=>(flag?[]:[]).map(external).trim();', 1]
].forEach(([name = '', source = '', expected = 0] = []) => test(`guard-owned use: ${name}`, () => {
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
    ['typeof continuation', 'const select=value=>{if(typeof value!=="function")return [].forEach(()=>{});return value;};', 2],
    ['actual local predicate', 'const check=value=>typeof value==="function";const select=value=>check(value)?value:"";', 2],
    ['name-only predicate has no family authority', 'const select=value=>isFunction(value)?value:"";', 0],
    ['shadowed constant predicate has no family authority', 'const isFunction=()=>true;const select=value=>isFunction(value)?value:"";', 0],
    ['impossible typeof branch contributes no return', 'const select=value=>typeof value==="madeup"?[]:"";', 0],
    ['native family and typeof decisions are distinct', 'const select=value=>{if(!Array.isArray(value))return "";return typeof value==="array"?[]:"";};', 0],
    ['captured guard does not enter another execution', 'const select=value=>{if(typeof value!=="number")return "";return ()=>value.trim();};', 2]
].forEach(([name = '', source = '', expected = 0] = []) => test(`guarded return family: ${name}`, () => {
    strictEqual(lint(source, 'signature-contract-return-consistency').length, expected);
    strictEqual(lint(source).length, 0);
}));

test('positive native array evidence reaches destructuring policy without claiming fields', () => {
    const source = 'const read=value=>{if(Array.isArray(value)){const {name}=value;return name;}return "";};';
    const analysis = createAnalysis({ source });

    strictEqual(analysis.checkDestructuring({ index: 0 }).status, 'contradiction');
    strictEqual(lint(source, 'signature-contract-destructuring').length, 1);
});

test('guarded callable evidence preserves known local signatures at the caller', () => {
    const source = 'const select=value=>typeof value==="function"?value:()=>"";select((value="")=>value)(42);';

    strictEqual(lint(source, 'signature-contract-call-site').length, 1);
});

test('a captured field identity never claims to be the entire returned parameter', () => {
    const analysis = createAnalysis({ source: 'const field=({value}={})=>value;const whole=value=>value;' });

    strictEqual(analysis.checkFunction({ index: 0 }).returnedParameter, false);
    strictEqual(analysis.checkFunction({ index: 1 }).returnedParameter.index, 0);
});

test('native predicate evaluates its argument before producing a result', () => {
    const source = 'const fail=()=>{throw 1;};const read=()=>Array.isArray(fail());';
    const analysis = createAnalysis({ source });
    const { normal = true, thrown = false } = analysis.checkFunction({ index: 1 });

    strictEqual(normal, false);
    strictEqual(thrown, true);
});

test('guard queries preserve generic contracts, source revisions and query order', () => {
    const source = 'const read=value=>{if(typeof value==="number")return value.trim();return "";};read(42);read(external);';
    const first = createAnalysis({ source });
    const second = createAnalysis({ source });
    const revised = createAnalysis({ source: source.replace('==="number"', '!=="number"') });
    const { memberAccesses = [], calls = [] } = second;
    const before = first.checkFunction({ index: 0 });

    calls.toReversed().forEach(({ index = -1 } = {}) => second.checkCall({ index }));
    memberAccesses.toReversed().forEach(({ index = -1 } = {}) => second.checkMemberAccess({ index }));
    deepStrictEqual(second.checkFunction({ index: 0 }), before);
    deepStrictEqual(first.checkFunction({ index: 0 }), before);
    deepStrictEqual(revised.checkMemberAccess({ index: 0 }).conflicts, []);
    strictEqual(lint(source).length, 1);
});
