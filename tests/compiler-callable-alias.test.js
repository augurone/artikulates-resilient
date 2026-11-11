import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { createTypeScriptAnalysis } from 'eslint-plugin-resilient/analyzer/typescript';

import { assertCompilerCollection } from './support/compiler-retention.js';
import { analyze, firstCall, fixture, tuple } from './support/compiler-source.js';
import { counter } from './support/work.js';

const declaration = 'export function outer([value]: [number]) { function inner(input: number) { return [input]; } const alias = inner; return alias(value); }';

[
    ['full', '[3]', 'number', 'agreement', true, false],
    ['zero', '[0]', 'number', 'agreement', true, false],
    ['short', '[]', 'nullish', 'contradiction', true, false],
    ['wrong family', "['wrong']", 'string', 'contradiction', true, false],
    ['null slot', '[null]', 'nullish', 'contradiction', true, false],
    ['omitted', '', '', 'unknown', false, true],
    ['undefined', 'undefined', '', 'unknown', false, true],
    ['null', 'null', '', 'unknown', false, true],
    ['unknown', 'external', '', 'unknown', true, true]
].forEach(([name = '', input = '', family = '', status = '', normal = false, thrown = false] = []) => test(`compiler callable alias: ${name}`, () => {
    const { status: actual = '', fact: { families = [] } = {}, normal: completed = false, thrown: failed = false } = firstCall(analyze(`${declaration} outer(${input});`));

    strictEqual(actual, status);
    deepStrictEqual(families, family ? [family] : []);
    strictEqual(completed, normal);
    strictEqual(failed, thrown);
}));

[
    'const alias = inner; function inner(input: number) { return [input]; } return alias(value);',
    'function inner(input: number) { return [input]; } const first = inner; const second = first; const alias = second; return alias(value);',
    'function inner(input: number) { return [input]; } const alias = inner; { const alias = value; } return alias(value);',
    'function inner(input: number) { return [input]; } const alias = inner; if (value) { function inner(input: number) { return [false]; } } return alias(value);',
    'function inner(input: number) { function wrap(item: string) { return [item]; } const alias = wrap; return alias(input); } const alias = inner; return alias(value);'
].forEach((body, index) => test(`compiler callable alias: declaration identity and source order ${index}`, () => {
    const { calls = [] } = tuple(analyze(`export function outer([value]: [number]) { ${body} } outer([3]); outer(['wrong']); outer(external);`));

    deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['agreement', 'contradiction', 'unknown']);
}));

[
    'function inner(input: number) { return [input]; } let alias = inner; return alias(value);',
    'function inner(input: number) { return [input]; } const alias = later; const later = inner; return alias(value);',
    'const alias = alias; return alias(value);',
    'function inner(input: number) { return [input]; } const alias = inner; const alias = value; return alias(value);',
    'function inner(input: number) { return [input]; } const alias = inner; inner = external; return alias(value);',
    'function inner(input: number) { return [input]; } if (value) { const alias = inner; } return alias(value);',
    'function inner(input: number) { return [input]; } const alias = inner; external(); return alias(value);',
    'const inner = (input: number) => [input]; const alias = inner; return alias(value);',
    'function inner(input: number) { return [input]; } const alias = inner; return alias(...value);'
].forEach((body, index) => test(`compiler callable alias: requirements and actual invocation ${index} stay separate`, () => {
    const analysis = analyze(`export function outer([value]: [number]) { ${body} } outer([3]);`);

    strictEqual(analysis.consumers.length, 1);
    strictEqual(firstCall(analysis).status, index === 7 ? 'agreement' : 'unknown');
}));

[
    'function inner(input: number) { return [value]; }',
    'function inner(input: number) { const again = inner; return again(input); }',
    'async function inner(input: number) { return [input]; }',
    'function inner(input: number = 3) { return [input]; }'
].forEach((helper, index) => test(`compiler callable alias: identity does not establish callee execution ${index}`, () => {
    strictEqual(firstCall(analyze(`export function outer([value]: [number]) { ${helper} const alias = inner; return alias(value); } outer([3]);`)).status, 'unknown');
}));

test('compiler callable alias: captured values stay unknown while stable module declarations keep their identity', () => {
    const captured = `export function outer([value]: [number]) {
        function wrap(input: number) { return [input]; }
        const alias = wrap;
        function inner(input: number) { return alias(input); }
        return inner(value);
    } outer([3]);`;
    const moduleOwned = 'function inner(input: number) { return [input]; } export function outer([value]: [number]) { const alias = inner; return alias(value); } outer([3]);';

    strictEqual(firstCall(analyze(captured)).status, 'unknown');
    strictEqual(firstCall(analyze(moduleOwned)).status, 'agreement');
});

test('compiler callable alias: a returned callable remains a function, independently of its body result', () => {
    const { status = '', fact: { families = [] } = {} } = firstCall(analyze(`${declaration.replace('return alias(value)', 'return [alias]')} outer([3]);`));

    strictEqual(status, 'contradiction');
    deepStrictEqual(families, ['function']);
});

test('compiler callable alias: requirements, revisions, reverse queries and interrupted observers retain their owners', () => {
    const source = `${declaration} outer(['wrong']); outer(external);`;
    const expected = tuple(analyze(source));
    const { status = '', calls = [] } = expected;

    strictEqual(status, 'contradiction');
    deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['contradiction', 'unknown']);
    const revised = tuple(analyze(source.replace('[number]', '[string]'), { revision: '2', programRevision: '2' }));

    strictEqual(revised.calls.at(0).status, 'agreement');
    deepStrictEqual(revised.calls.at(0).fact, expected.calls.at(0).fact);
    const combined = analyze(`${declaration} ${declaration.replaceAll('outer', 'second').replace('[number]', '[string]')} outer([3]); second([3]);`);
    const reverse = combined.checkTuple({ index: 1 });
    const { status: reversed = '' } = reverse;

    strictEqual(reversed, 'contradiction');
    strictEqual(tuple(combined).calls.at(0).status, 'agreement');
    strictEqual(combined.checkTuple({ index: 1 }), reverse);
    const work = counter();

    tuple(analyze(source), work);
    const total = Object.values(work.read()).reduce((sum, count) => sum + count, 0);
    const failure = new Error('alias observer failed');

    [1, Math.floor(total / 2), total].forEach((stop) => {
        const analysis = analyze(source);
        let events = 0;

        throws(() => tuple(analysis, { onWork: () => {
            events += 1;

            if (events === stop) throw failure;
        } }), error => error === failure);
        deepStrictEqual(tuple(analysis), expected);
    });
});

test('compiler callable alias: required reader failures propagate and live sessions release every compiler input', () => {
    const input = fixture(`${declaration} outer([3]);`);
    const { sourceFile: { statements: [{ body: { statements = [] } = {} } = {}] = [] } = {} } = input;
    const [, { declarationList: { declarations: [alias = {}] = [] } = {} } = {}] = statements;
    const failure = new Error('alias initializer read failed');

    Object.defineProperty(alias, 'initializer', { get() { throw failure; } });
    throws(() => createTypeScriptAnalysis(input), error => error === failure);
    assertCompilerCollection(`${declaration} outer([3]);`);
});

test('compiler callable alias: composed aliases, invocations and independent requirements reuse warm evidence', () => {
    [8, 16, 32].forEach((size) => {
        const chain = Array.from({ length: size }, (_, index) => `const alias${index} = ${index ? `alias${index - 1}` : 'inner'};`).join(' ');
        const deep = declaration.replace('const alias = inner;', chain).replace('return alias(value)', `return alias${size - 1}(value)`);
        const names = Array.from({ length: size }, (_, index) => `outer${index}`);
        const sources = [
            `${deep} outer(['wrong']); outer(external);`,
            `${declaration} ${Array.from({ length: size }, () => "outer(['wrong']); outer(external);").join(' ')}`,
            `${declaration} ${'outer('.repeat(size)}['wrong']${')'.repeat(size)}; outer(external);`,
            [...names.map(name => declaration.replaceAll('outer', name)), ...names.map(name => `${name}(['wrong']);`), ...names.map(name => `${name}(external);`)].join(' ')
        ];

        sources.forEach((source) => {
            const analysis = analyze(source);
            const work = counter();
            const results = analysis.consumers.map(({ index = -1 } = {}) => analysis.checkTuple({ index, ...work }));

            ok(results.length);
            results.forEach(({ status = '', calls = [] } = {}) => {
                strictEqual(status, 'contradiction');
                ok(calls.some(({ status = '' } = {}) => status === 'unknown'));
            });
            const before = work.read();
            const { counts = {} } = analysis;

            analysis.consumers.toReversed().forEach(({ index = -1 } = {}) => analysis.checkTuple({ index, ...work }));
            deepStrictEqual(work.read(), before);
            const { counts: warm = {} } = analysis;

            deepStrictEqual(warm, counts);
            const revised = analyze(source, { revision: '2', programRevision: '2' });
            const fresh = counter();

            revised.consumers.forEach(({ index = -1 } = {}) => revised.checkTuple({ index, ...fresh }));
            deepStrictEqual(fresh.read(), before);
            const { counts: cold = {} } = revised;

            deepStrictEqual(cold, counts);
        });
    });
});
