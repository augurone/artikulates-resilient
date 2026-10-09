import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const cases = [
    ['native exposure leaves unrelated record evidence', 'const record={kept:0};external(Array);record.missing;', ['missingProperty']],
    ['native observation retains records', 'const record={kept:0};Array.isArray(record);record.missing;', ['missingProperty']],
    ['overwritten observer retires supplied records', 'Array.isArray=external;const record={kept:0};Array.isArray(record);record.missing;', []],
    ['local methods survive unrelated native exposure', 'const helpers={read:()=>({kept:0})};external(Array);helpers.read().missing;', ['missingProperty']],
    ['native exposure leaves an ordered alias write', 'external(Number);const item={value:[]};const alias=item;alias.value="";item.value.map(x=>x);', ['mismatch']],
    ['intervening effects retire write visibility', 'const item={value:[]};const alias=item;alias.value="";external();item.value.map(x=>x);', []],
    ['native observation preserves a sole transfer', 'const selected={items:""};const holder={selected};const isArray=Array.isArray;isArray(holder);holder.selected.items.map(x=>x);', ['mismatch']],
    ['alias mutation retires transferred evidence', 'const selected={items:""};const alias=selected;const holder={selected};alias.items=[];holder.selected.items.map(x=>x);', []],
    ['early closed record capture remains known', 'const h={read:()=>""};const use=()=>h.read().map(x=>x);external(Number);use();', ['mismatch']],
    ['late record initialization stays conservative', 'const use=()=>h.read().map(x=>x);const h={read:()=>""};use();', []]
];
const inspect = analysis => analysis.memberAccesses.map(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }));

cases.forEach(([name = '', source = '', expected = []] = []) => test(`member boundary composition: ${name}`, () => {
    const findings = new Linter().verify(source, { plugins: { resilient: plugin }, rules: {
        'resilient/signature-contract-property': 'error', 'resilient/signature-contract-operation': 'error'
    } });

    deepStrictEqual(findings.map(({ messageId = '' } = {}) => messageId), expected);
    const first = createAnalysis({ source });
    const judgments = inspect(first);

    ok(judgments.length);
    const second = createAnalysis({ source });

    second.functions.toReversed().forEach(({ index = -1 } = {}) => second.checkFunction({ index }));
    second.memberAccesses.toReversed().forEach(({ index = -1 } = {}) => second.checkMemberAccess({ index }));
    deepStrictEqual(inspect(second), judgments);
    deepStrictEqual(inspect(first), judgments);

    if (expected.length) return;

    const { index = -1 } = first.memberAccesses.find(({ name = '' } = {}) => ['map', 'missing'].includes(name)) ?? {};
    const { incomplete = false } = first.checkMemberAccess({ index });

    strictEqual(incomplete, true);
}));
