import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';
import typescript from 'typescript';

import plugin from 'eslint-plugin-resilient';
import { createTypeScriptAnalysis } from 'eslint-plugin-resilient/analyzer/typescript';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { assertCompilerCollection } from './support/compiler-retention.js';
import { analyze, firstCall, fixture, tuple } from './support/compiler-source.js';
import { counter } from './support/work.js';

const declaration = inner => `function outer([value]: [number]) { const unrelated = ${inner}; return [value]; }`;
const retained = ['() => 1', 'function () { return 1; }'];

[
    '(input = fail()) => { value = 99; fail(); return [input]; }',
    'function named(input = fail()) { value = 99; fail(); return [input]; }'
].forEach((inner, index) => test(`compiler callable creation ${index}: raw, transformed and fixed execution leaves defaults and bodies dormant`, async () => {
    const code = `declare function fail(): never; export ${declaration(inner)}`;
    const { program = {}, filename = '' } = fixture(code);
    const { code: output = '', diagnostics = [], agreements = [] } = createTypeScriptTransformer({ typescript, program }).transform({ code, fileName: filename });
    const { outputText: raw = '' } = typescript.transpileModule(code, { compilerOptions: program.getCompilerOptions() });
    const { output: fixed = '' } = new Linter().verifyAndFix(output, [plugin.configs.recommended, plugin.configs.contracts, plugin.configs.safety]);
    const versions = await Promise.all([raw, output, fixed].map(code => import(`data:text/javascript,${encodeURIComponent(code)}`)));
    const { runtimeEvidence: { result: { fact: { families = [] } = {} } = {} } = {} } = agreements.find(({ action = '' } = {}) => action === 'preserve-native-tuple') ?? {};

    deepStrictEqual(diagnostics, []);
    deepStrictEqual(families, ['array']);
    versions.forEach(({ outer = false } = {}) => {
        if (typeof outer !== 'function') throw new TypeError('Expected outer export');

        deepStrictEqual(outer([3]), [3]);
        deepStrictEqual(outer([]), [undefined]);
        throws(() => outer(), TypeError);
        throws(() => outer(null), TypeError);
        const value = {};

        strictEqual(outer([value]).at(0), value);
    });
}));

retained.forEach((inner, index) => {
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
    ].forEach(([name = '', input = '', family = '', status = '', normal = false, thrown = false] = []) => test(`compiler callable creation ${index}: ${name}`, () => {
        const { status: actual = '', fact: { families = [] } = {}, normal: completed = false, thrown: failed = false } = firstCall(analyze(`${declaration(inner)} outer(${input});`));

        strictEqual(actual, status);
        deepStrictEqual(families, family ? [family] : []);
        strictEqual(completed, normal);
        strictEqual(failed, thrown);
    }));

    test(`compiler callable creation ${index}: a live session releases all compiler inputs`, () => {
        assertCompilerCollection(`${declaration(inner)} outer([3]);`);
    });

    test(`compiler callable creation ${index}: revisions and interrupted queries retain contradictions beside unknown`, () => {
        const source = `${declaration(inner)} outer(['wrong']); outer(external);`;
        const expected = tuple(analyze(source));
        const { status = '', calls = [] } = expected;

        strictEqual(status, 'contradiction');
        deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['contradiction', 'unknown']);
        const revised = analyze(source.replace('[number]', '[string]'), { revision: 'source-2', programRevision: 'program-2' });
        const { calls: [{ status: judgment = '', fact = {} } = {}] = [] } = tuple(revised);
        const [{ fact: original = {} } = {}] = calls;

        strictEqual(judgment, 'agreement');
        deepStrictEqual(fact, original);
        const work = counter();

        tuple(analyze(source), work);
        const total = Object.values(work.read()).reduce((sum, count) => sum + count, 0);
        const failure = new Error('creation observer failed');
        const interrupted = analyze(source);

        throws(() => tuple(interrupted, { onWork: ({ kind = '' } = {}) => {
            if (kind === 'closure-creation') throw failure;
        } }), error => error === failure);
        deepStrictEqual(tuple(interrupted), expected);

        [1, Math.floor(total / 2), total].forEach((stop) => {
            const analysis = analyze(source);
            let events = 0;

            throws(() => tuple(analysis, { onWork: () => {
                events += 1;

                if (events === stop) throw failure;
            } }), error => error === failure);
            deepStrictEqual(tuple(analysis), expected);
            strictEqual(tuple(analysis), tuple(analysis));
        });
    });
});

[
    '() => { value = 99; throw new Error("body"); }',
    '(input = fail()) => input',
    'function (input = fail()) { return input; }',
    'async () => { throw new Error("body"); }',
    'function* () { yield fail(); return false; }',
    'function value() { return value; }',
    'function outer(input: number) { return outer(input); }'
].forEach((inner, index) => test(`compiler callable creation: nested execution ${index} cannot contribute a return, effect or failure`, () => {
    const { result: { fact: { families = [] } = {}, returns = [] } = {}, calls = [] } = tuple(analyze(`${declaration(inner)} outer([3]);`));

    deepStrictEqual(families, ['array']);
    strictEqual(returns.length, 1);
    strictEqual(calls.length, 1);
    const [{ status = '', normal = false, thrown = false } = {}] = calls;

    strictEqual(status, 'agreement');
    strictEqual(normal, true);
    strictEqual(thrown, false);
}));

test('compiler callable creation: a named expression cannot supply an enclosing callable binding', () => {
    const source = 'function outer([value]: [number]) { const unrelated = function hidden() { return 1; }; return [value]; } hidden([3]); outer([3]);';
    const { calls = [] } = tuple(analyze(source));

    strictEqual(calls.length, 1);
    // The unresolved call is still an opaque module operation before outer.
    strictEqual(calls.at(0).status, 'unknown');
});

[
    'const unrelated = () => [value]; return unrelated(value);',
    'const unrelated = (() => [value])(); return [value];',
    'const unrelated = class { static { fail(); } }; return [value];',
    'const unrelated = { get value() { return fail(); } }; return [value];'
].forEach((body, index) => test(`compiler callable creation: execution or other initializer ${index} is not an inert closure proof`, () => {
    const analysis = analyze(`function outer([value]: [number]) { ${body} } outer([3]);`);

    strictEqual(analysis.consumers.length, 1);
    strictEqual(firstCall(analysis).status, 'unknown');
}));

test('compiler callable creation: callable values stay separate from their unexecuted return families', () => {
    const source = 'function outer([value]: [number]) { const unrelated = () => 3; const alias = unrelated; return [alias]; } outer([3]);';
    const { status = '', fact: { families = [] } = {} } = firstCall(analyze(source));

    strictEqual(status, 'contradiction');
    deepStrictEqual(families, ['function']);
});

test('compiler callable creation: compiler reader failures and foreign syntax remain failures', () => {
    const input = fixture(declaration(retained.at(0)));
    const { typescript: compiler = {} } = input;
    const { SyntaxKind: { ArrowFunction = -1 } = {} } = compiler;
    const failure = new Error('callable reader failed');

    throws(() => createTypeScriptAnalysis({ ...input, typescript: { ...compiler, forEachChild(node, visit) {
        const { kind = -1 } = node;

        if (kind === ArrowFunction) throw failure;

        return compiler.forEachChild(node, visit);
    } } }), error => error === failure);
    const analysis = createTypeScriptAnalysis(input);
    const { sourceFile = {} } = fixture(declaration(retained.at(0)));
    const { statements: [node = {}] = [] } = sourceFile;

    throws(() => analysis.checkTuple({ index: 0, sourceFile, node }), /source identity mismatch/u);
    tuple(analysis);
    throws(() => analysis.checkTuple({ index: 0, sourceFile, node }), /source identity mismatch/u);
});

test('compiler callable creation: wider bodies add acquisition but no body demand; warm queries and revisions share evidence', () => {
    [8, 16, 32].forEach((size) => {
        const sources = [
            `${declaration('() => 1')} ${Array.from({ length: size }, (_, index) => `outer([${index}]);`).join(' ')}`,
            `${declaration('() => 1')} ${'outer('.repeat(size)}[3]${')'.repeat(size)};`,
            Array.from({ length: size }, (_, index) => `${declaration('() => 1').replaceAll('outer', `outer${index}`)} outer${index}([3]);`).join(' ')
        ];
        sources.forEach((source) => {
            const analysis = analyze(source);
            const work = counter();
            const { consumers = [] } = analysis;
            const results = consumers.map(({ index = -1 } = {}) => analysis.checkTuple({ index, ...work }));

            results.forEach(({ calls = [] } = {}) => ok(calls.every(({ status = '' } = {}) => status === 'agreement')));
            const before = work.read();
            const { counts = {} } = analysis;

            consumers.toReversed().forEach(({ index = -1 } = {}) => analysis.checkTuple({ index, ...work }));
            deepStrictEqual(work.read(), before);
            const { counts: warm = {} } = analysis;

            deepStrictEqual(warm, counts);
            const changedBody = source.replaceAll('() => 1', `() => { ${'fail();'.repeat(size)} throw external; }`);
            const revised = analyze(changedBody, { revision: 'source-2', programRevision: 'program-2' });
            const fresh = counter();

            revised.consumers.forEach(({ index = -1 } = {}) => revised.checkTuple({ index, ...fresh }));
            deepStrictEqual(fresh.read(), before);
        });
    });
});
