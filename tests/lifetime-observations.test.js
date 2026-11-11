import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const rules = Object.fromEntries(['property', 'operation', 'destructuring', 'call-site', 'return-consistency']
    .map(name => [`resilient/signature-contract-${name}`, 'error']));
const lint = source => new Linter().verify(source, [{ plugins: { resilient: plugin }, rules }]);
const members = (analysis, reverse = false) => {
    const { memberAccesses = [] } = analysis;
    const selected = reverse ? memberAccesses.toReversed() : memberAccesses;

    return selected.map(({ index = -1, name = '', location = {} } = {}) => ({ name, location, ...analysis.checkMemberAccess({ index }) }))
        .toSorted(({ location: { column: left = 0 } = {} } = {}, { location: { column: right = 0 } = {} } = {}) => left - right);
};

[
    ['later return', 'return value;'],
    ['later transfer', 'external(value);'],
    ['repeated predicate', 'Array.isArray(value);'],
    ['opposite predicate', 'if(!Array.isArray(value))external();'],
    ['same predicate', 'if(Array.isArray(value))external();']
].forEach(([name = '', later = ''] = []) => {
    ['value=undefined', '{value=undefined}={}'].forEach((parameter) => {
        test(`lifetime observation preserves array guard with ${name} and ${parameter}`, () => {
            const source = `const run=(${parameter})=>{if(Array.isArray(value))value.forEach(item=>item);${later}};`;
            const analysis = createAnalysis({ source });

            deepStrictEqual(lint(source), []);
            const expected = members(analysis);
            const { counts: before = {} } = analysis;

            deepStrictEqual(members(analysis, true), expected);
            const { counts: after = {} } = analysis;

            deepStrictEqual(after, before);
            deepStrictEqual(members(createAnalysis({ source }), true), expected);
        });
    });
});

[
    ['function', 'false', 'call(null)'],
    ['string', 'undefined', 'trim()']
].forEach(([family = '', fallback = '', operation = ''] = []) => {
    test(`later transfer preserves an earlier ${family} guard`, () => {
        const source = `const run=(value=${fallback})=>{if(typeof value==='${family}')value.${operation};external(value);};`;

        deepStrictEqual(lint(source), []);
    });
});

[
    ['conditional return', 'if(flag)observe(record);', true],
    ['unconditional return', 'observe(record);', true],
    ['unreached pure call', 'if(false)observe(record);', true],
    ['unreached external call', 'if(false)external(record);', true],
    ['reached external call', 'external(record);', false],
    // The path that skips the call still owns the concrete missing field.
    ['conditional external call', 'if(flag)external(record);', true],
    ['ordered chain', 'observe(record);if(flag)observe(record);', true],
    ['external after pure', 'observe(record);external(record);', false],
    ['pure after external', 'external(record);observe(record);', false],
    ['computed key', 'external[external(record)];', false],
    ['tagged expression', 'tag`${external(record)}`;', false],
    ['template expression', '`${external(record)}`;', false],
    ['loop', 'while(flag)external(record);', false],
    ['switch', 'switch(flag){case 1:external(record);}', false],
    ['optional call', 'external?.(record);', false],
    ['caught call', 'try{external(record);}catch(error){}', false],
    ['mutation', 'const change=value=>{value.missing=1;return true;};change(record);', false],
    ['returned alias', 'const expose=value=>value;expose(record);', false]
].forEach(([name = '', preceding = '', expected = false] = []) => {
    test(`lifetime observation retains ${name} ownership`, () => {
        const source = `const observe=value=>true;const record={kept:1};${preceding}record.missing;`;
        const findings = lint(source).filter(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-property');

        strictEqual(findings.length, Number(expected));
        const analysis = createAnalysis({ source });
        const { index = -1 } = analysis.memberAccesses.find(({ name = '' } = {}) => name === 'missing');

        strictEqual(analysis.checkMemberAccess({ index }).missing, expected);
    });
});

test('conditional effects retire fields only on the path that reaches the call', () => {
    ['if(chosen)', 'if(!chosen)', ''].forEach((selection, index) => {
        const source = `const record={kept:1};const chosen=external;`
            + `if(chosen)opaque(record);${selection}record.missing;`;
        const findings = lint(source).filter(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-property');

        strictEqual(findings.length, Number(index > 0));
    });
});

test('a subsequent read cannot execute an unreachable call or publish its call obligation', () => {
    const source = 'const consume=(value=[])=>true;const record={kept:1};if(false)consume(record);record.missing;';
    const findings = lint(source);

    deepStrictEqual(findings.map(({ ruleId = '' } = {}) => ruleId), ['resilient/signature-contract-property']);
});

test('later reads preserve actual wrong-family contradictions beside unknown calls', () => {
    const source = 'const run=(value=undefined)=>{if(Array.isArray(value))value.trim();external(value);return value;};';
    const findings = lint(source).filter(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-operation');

    strictEqual(findings.length, 1);
    ok(findings.at(0).message.includes('array-like'));
});

test('guarded callback defaults keep their selected evidence when forwarded recursively', () => {
    const source = 'const visit=(node={})=>external(node).forEach(([,value={}])=>{if(Array.isArray(value))value.forEach(item=>visit(item));visit(value);});';

    deepStrictEqual(lint(source), []);
});

test('native execution confirms skipped calls, guards, mutation and throwing boundaries', () => {
    const source = 'const run=(value=undefined)=>{if(Array.isArray(value))value.forEach(item=>item);return value;};run(input);';
    const array = [1, 2];

    strictEqual(runInNewContext(source, { input: array }), array);
    strictEqual(typeof runInNewContext(source.replace('run(input)', 'run()')), 'undefined');
    strictEqual(runInNewContext('const record={kept:1};if(false)external(record);record.kept;'), 1);
    const failure = new Error('observer failure');
    const context = { external: () => { throw failure; } };

    throws(() => runInNewContext('const record={};external(record);record.missing;', context), error => error === failure);
    strictEqual(runInNewContext('const record={};const change=value=>{value.missing=1;return true;};change(record);record.missing;'), 1);
});

test('interrupted lifetime observation propagates and permits a correct retry', () => {
    const source = 'const observe=value=>true;const record={kept:1};if(flag)observe(record);record.missing;';
    const expected = members(createAnalysis({ source }));
    const analysis = createAnalysis({ source });
    const { index = -1 } = analysis.memberAccesses.at(-1);
    const failure = new Error('lifetime observation failure');

    throws(() => analysis.checkMemberAccess({ index, onWork: () => { throw failure; } }), error => error === failure);
    deepStrictEqual(members(analysis), expected);
});
