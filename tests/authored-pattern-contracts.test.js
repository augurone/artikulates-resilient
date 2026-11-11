import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { queriesFor, queryAnalysis } from './support/analysis-queries.js';

const rule = 'resilient/signature-contract-call-site';
const lint = source => new Linter().verify(source, { plugins: { resilient: plugin }, rules: { [rule]: 'error' } });

[
    ['computed string', '({["name"]:name=""}={})', '{name:VALUE}', 'name'],
    ['computed number', '({[1]:name=""}={})', '{1:VALUE}', 'name'],
    ['computed signed key', '({[-1]:name=""}={})', '{[-1]:VALUE}', 'name'],
    ['nested tuple', '([[name=""]=[]]=[])', '[[VALUE]]', 'name'],
    ['elided tuple', '([,[name=""]=[]]=[])', '[0,[VALUE]]', 'name'],
    ['object in tuple', '([{name=""}={}]=[])', '[{name:VALUE}]', 'name'],
    ['tuple in object', '({data:[name=""]=[]}={})', '{data:[VALUE]}', 'name'],
    ['computed nested tuple', '({["data"]:[[name=""]=[]]=[]}={})', '{data:[[VALUE]]}', 'name']
].forEach(([name = '', signature = '', argument = '', result = ''] = []) => {
    [false, true].forEach(valid => test(`authored pattern contract: ${name}, valid=${valid}`, () => {
        const value = valid ? '"ok"' : '42';
        const source = `const read=${signature}=>${result};const alias=read;alias(${argument.replace('VALUE', value)});`;
        const analysis = createAnalysis({ source });
        const selected = analysis.calls.at(-1);
        const checked = analysis.checkCall(selected);
        const conflicts = checked.obligations.filter(({ status = '' } = {}) => status === 'contradiction');

        strictEqual(conflicts.length, valid ? 0 : 1);
        strictEqual(runInNewContext(source), valid ? 'ok' : 42);
        deepStrictEqual(lint(source).map(({ ruleId = '' } = {}) => ruleId), valid ? [] : [rule]);
        const queries = queriesFor(analysis);
        const expected = queries.map(query => queryAnalysis(analysis, query));
        const reverse = createAnalysis({ source });

        queries.toReversed().forEach(query => queryAnalysis(reverse, query));
        deepStrictEqual(queries.map(query => queryAnalysis(reverse, query)), expected);
        deepStrictEqual(analysis.checkCall(selected), checked);
    }));
});

['[]', '[,]', '[[]]', '[[undefined]]', '[[""]]'].forEach(argument => test(`tuple absence selects authored defaults: ${argument}`, () => {
    const source = `const read=([[name=""]=[]]=[])=>name;read(${argument});`;

    strictEqual(runInNewContext(source), '');
    deepStrictEqual(lint(source), []);
}));

[
    'const read=([[name=""]=[]]=[])=>name;read([[null]]);',
    'const read=([[name=""]=[]]=[])=>name;read([null]);'
].forEach(source => test(`null does not select a tuple default: ${source}`, () => strictEqual(lint(source).length, 1)));

[
    'const read=([[name=""]=[]]=[])=>name;read(external);',
    'const read=([[name=""]=[]]=[])=>name;const data=[[42]];external(data);read(data);',
    'const read=([[name=""]=[]]=[])=>name;const data=[[42]];data[0][0]="ok";read(data);',
    'const read=([[name=""]=[]]=[])=>name;const data=[[42]];data[Symbol.iterator]=external;read(data);',
    'const read=({[external()]:name=""}={})=>name;read({name:42});'
].forEach(source => test(`unavailable selection retains uncertainty: ${source}`, () => deepStrictEqual(lint(source), [])));

test('tuple obligations retain exact literal locations', () => {
    const source = 'const read=([[name=""]=[]]=[])=>name;read([[42]]);';
    const analysis = createAnalysis({ source });
    const result = analysis.checkCall(analysis.calls.at(-1));
    const [{ location: { range = [] } = {} } = {}] = result.obligations.filter(({ status = '' } = {}) => status === 'contradiction');

    strictEqual(source.slice(...range), '42');
});

['read(flag?undefined:[42])', 'read(flag?external:[42])', 'alias(flag?undefined:[42])'].forEach(call => test(`selected tuple alternatives keep known conflicts: ${call}`, () => {
    const source = `const read=([name=""]=[])=>name;const alias=read;${call};`;

    strictEqual(lint(source).length, 1);
    deepStrictEqual(lint(source.replace('[42]', '["ok"]')), []);
}));

test('literal spreads use flattened slot locations without naming a spread as the value', () => {
    const source = 'const read=([name=""]=[])=>name;read([...[],42]);';
    const analysis = createAnalysis({ source });
    const { obligations = [] } = analysis.checkCall(analysis.calls.at(-1));
    const [{ location: { range = [] } = {} } = {}] = obligations.filter(({ status = '' } = {}) => status === 'contradiction');

    strictEqual(source.slice(...range), '42');
});
