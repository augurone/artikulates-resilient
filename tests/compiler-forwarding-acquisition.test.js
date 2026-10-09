import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { createTypeScriptAnalysis } from 'eslint-plugin-resilient/analyzer/typescript';

import { analyze, firstCall, fixture, tuple } from './support/compiler-source.js';
import { counter } from './support/work.js';

const forwardedDeclaration = 'function outer([value]: [number]) { function inner(input: number) { return [input]; } return inner(value); }';
const aliasedDeclaration = 'function outer([value]: [number]) { const result = [value]; function inner() { const result = 1; return result; } return result; }';

test('compiler forwarding: nested compiler reader failures remain operational and foreign nodes cannot borrow evidence', () => {
    const input = fixture(forwardedDeclaration);
    const { typescript: compiler = {} } = input;
    const failure = new Error('nested compiler reader failed');

    throws(() => createTypeScriptAnalysis({ ...input, typescript: { ...compiler, forEachChild(node, visit) {
        const { name: { text = '' } = {} } = node;

        if (text === 'inner') throw failure;

        return compiler.forEachChild(node, visit);
    } } }), error => error === failure);
    const analysis = createTypeScriptAnalysis(input);
    const { sourceFile = {} } = fixture(forwardedDeclaration);
    const { statements: [node = {}] = [] } = sourceFile;

    throws(() => analysis.checkTuple({ index: 0, sourceFile, node }), /source identity mismatch/u);
    tuple(analysis);
    throws(() => analysis.checkTuple({ index: 0, sourceFile, node }), /source identity mismatch/u);
});

[forwardedDeclaration, aliasedDeclaration].forEach((declaration, index) => {
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
    ].forEach(([name = '', input = '', family = '', status = '', normal = false, thrown = false] = []) => test(`compiler forwarding ${index}: ${name}`, () => {
        const analysis = analyze(`${declaration} outer(${input});`);
        const { status: actual = '', fact: { families = [] } = {}, normal: completed = false, thrown: failed = false } = firstCall(analysis);

        strictEqual(actual, status);
        deepStrictEqual(families, family ? [family] : []);
        strictEqual(completed, normal);
        strictEqual(failed, thrown);
    }));

    test(`compiler forwarding ${index}: requirements, revisions, query order and interrupted reports retain their owners`, () => {
        const source = `${declaration} outer(['wrong']); outer(external);`;
        const expected = tuple(analyze(source));
        const { status = '', calls = [] } = expected;

        strictEqual(status, 'contradiction');
        deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['contradiction', 'unknown']);
        const changed = analyze(source.replace('[number]', '[string]'), { revision: 'source-2', programRevision: 'program-2' });
        const { calls: [{ status: revised = '', fact = {} } = {}] = [] } = tuple(changed);
        const { calls: [{ fact: original = {} } = {}] = [] } = expected;

        strictEqual(revised, 'agreement');
        deepStrictEqual(fact, original);
        strictEqual(tuple(analyze(source)).status, 'contradiction');
        const work = counter();

        tuple(analyze(source), work);
        const total = Object.values(work.read()).reduce((sum, count) => sum + count, 0);
        const failure = new Error('forwarding observer failed');

        [1, Math.floor(total / 2), total].forEach((stop) => {
            const analysis = analyze(source);
            let events = 0;

            throws(() => tuple(analysis, { onWork: () => {
                events += 1;

                if (events === stop) throw failure;
            } }), error => error === failure);
            deepStrictEqual(tuple(analysis), expected);
        });
        const combined = analyze(`${declaration} ${declaration.replaceAll('outer', 'second').replace('[number]', '[string]')} outer([3]); second([3]);`);
        const reverse = combined.checkTuple({ index: 1 });
        const { status: reversed = '' } = reverse;

        strictEqual(reversed, 'contradiction');
        strictEqual(tuple(combined).calls.at(0).status, 'agreement');
        strictEqual(combined.checkTuple({ index: 1 }), reverse);
    });
});

test('compiler forwarding: finite helper and alias chains use actual arguments, not helper annotations', () => {
    const source = `function outer([value]: [number]) {
        function first(input: string) { const alias = input; return second(alias); }
        function second(input: string) { const result = [input]; return result; }
        const alias = value;
        return first(alias);
    } outer([3]); outer(['wrong']); outer(external);`;
    const { calls = [] } = tuple(analyze(source));

    deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['agreement', 'contradiction', 'unknown']);
});

test('compiler forwarding: a captured module declaration cannot lend proof across an opaque owner', () => {
    const source = `function inner(input: number) { return [input]; }
        function outer([value]: [number]) { return inner(value); }
        inner = external; outer([3]);`;
    const { result: { fact: { families = [] } = {} } = {}, calls = [] } = tuple(analyze(source));

    deepStrictEqual(families, []);
    deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['unknown']);
});

[
    'const result = later; const later = [value]; return result;',
    'let result = [value]; return result;',
    'const result = [value]; result[0] = 3; return result;',
    'const result = external; return result;',
    'function inner(input: number) { return [input]; } const inner = value; return inner(value);'
].forEach((body, index) => test(`compiler forwarding: requirements survive unsupported alias or write ${index}`, () => {
    const analysis = analyze(`function outer([value]: [number]) { ${body} } outer([3]);`);

    strictEqual(analysis.consumers.length, 1);
    strictEqual(firstCall(analysis).status, 'unknown');
}));

[
    'function inner(input: number) { return [value]; }',
    'function inner(input: number) { input = 7; return [input]; }',
    'function inner(input: number) { return inner(input); }',
    'async function inner(input: number) { return [input]; }',
    'function inner(input: number = 7) { return [input]; }'
].forEach((helper, index) => test(`compiler forwarding: unsupported captured, mutable or recursive callee ${index} stays unknown`, () => {
    const analysis = analyze(`function outer([value]: [number]) { ${helper} return inner(value); } outer([3]);`);

    strictEqual(firstCall(analysis).status, 'unknown');
}));

test('compiler forwarding: wide, successive and independent consumers share warm evidence and survive revisions', () => {
    [8, 16, 32].forEach((size) => {
        const wide = `${forwardedDeclaration} ${Array.from({ length: size }, (_, index) => `outer([${index}]);`).join(' ')}`;
        const successive = `${forwardedDeclaration} ${'outer('.repeat(size)}[3]${')'.repeat(size)};`;
        const aliases = `function outer([value]: [number]) { const first = [value]; ${Array.from({ length: size }, (_, index) => (
            `const alias${index} = ${index ? `alias${index - 1}` : 'first'};`
        )).join(' ')} return alias${size - 1}; } outer([3]);`;
        const independent = Array.from({ length: size }, (_, index) => `${aliasedDeclaration.replaceAll('outer', `outer${index}`)} outer${index}([3]);`).join(' ');

        [wide, successive, aliases, independent].forEach((source) => {
            const analysis = analyze(source);
            const work = counter();
            const results = analysis.consumers.map(({ index = -1 } = {}) => analysis.checkTuple({ index, ...work }));

            results.forEach(({ calls = [] } = {}) => ok(calls.every(({ status = '' } = {}) => status === 'agreement')));
            const before = work.read();
            const { counts = {} } = analysis;

            analysis.consumers.toReversed().forEach(({ index = -1 } = {}) => analysis.checkTuple({ index, ...work }));
            deepStrictEqual(work.read(), before);
            const { counts: warm = {} } = analysis;

            deepStrictEqual(warm, counts);
            const revised = analyze(source, { revision: 'source-2', programRevision: 'program-2' });
            const fresh = counter();

            revised.consumers.forEach(({ index = -1 } = {}) => revised.checkTuple({ index, ...fresh }));
            deepStrictEqual(fresh.read(), before);
            const { counts: cold = {} } = revised;

            deepStrictEqual(cold, counts);
        });
    });
});
