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

const declaration = 'export function outer([value]: [number]) { if (value) { function unrelated() { return 1; } } return [value]; }';

[
    ['truthy', '[3]', 'number', 'agreement', true, false],
    ['zero', '[0]', 'number', 'agreement', true, false],
    ['false', '[false]', 'boolean', 'contradiction', true, false],
    ['short', '[]', 'nullish', 'contradiction', true, false],
    ['empty string', "['']", 'string', 'contradiction', true, false],
    ['wrong family', "['wrong']", 'string', 'contradiction', true, false],
    ['omitted', '', '', 'unknown', false, true],
    ['undefined', 'undefined', '', 'unknown', false, true],
    ['null', 'null', '', 'unknown', false, true],
    ['unknown', 'external', '', 'unknown', true, true]
].forEach(([name = '', input = '', family = '', status = '', normal = false, thrown = false] = []) => test(`compiler conditional ownership: ${name}`, () => {
    const { status: actual = '', fact: { families = [] } = {}, normal: completed = false, thrown: failed = false } = firstCall(analyze(`${declaration} outer(${input});`));

    strictEqual(actual, status);
    deepStrictEqual(families, family ? [family] : []);
    strictEqual(completed, normal);
    strictEqual(failed, thrown);
}));

test('compiler conditional ownership: block names do not replace enclosing values or callable identities', async () => {
    const script = `function outer([value]: [number]) {
        function inner(input: number) { return [input]; }
        if (value) { function inner(input: number) { return [false]; } }
        return inner(value);
    }`;
    const source = `export ${script}`;
    const { calls = [] } = tuple(analyze(`${source} outer([3]); outer([0]);`));

    deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['agreement', 'agreement']);
    const { result: { status: unsupported = '' } = {} } = tuple(analyze(script));

    strictEqual(unsupported, 'unknown');
    const { outputText: sloppy = '' } = typescript.transpileModule(script, { compilerOptions: {
        target: 99, module: typescript.ModuleKind.None, strict: false, alwaysStrict: false
    } });
    const { outputText: module = '' } = typescript.transpileModule(source, { compilerOptions: { target: 99, module: 99 } });
    const { outer = false } = await import(`data:text/javascript,${encodeURIComponent(module)}`);
    const scriptOuter = Function(`${sloppy}; return outer;`)();

    if (typeof outer !== 'function' || typeof scriptOuter !== 'function') throw new TypeError('Expected native scope witnesses');

    deepStrictEqual(outer([3]), [3]);
    deepStrictEqual(scriptOuter([3]), [false]);
    deepStrictEqual(scriptOuter([0]), [0]);
});

[
    'if (value) { const value = () => false; }',
    'if (value) { function outer(input: number) { return outer(input); } }',
    'if (value) { const alias = value; if (alias) { const value = () => false; } }'
].forEach((prefix, index) => test(`compiler conditional ownership: local shadow ${index} stays in its block`, () => {
    const { calls = [], result: { fact: { families = [] } = {}, returns = [] } = {} } = tuple(analyze(
        `export function outer([value]: [number]) { ${prefix} return [value]; } outer([3]);`
    ));

    deepStrictEqual(families, ['array']);
    strictEqual(returns.length, 1);
    deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['agreement']);
}));

[
    'if (value) { return [value]; } return [value];',
    'if (value) { value = 7; } return [value];',
    'if (value) { function unrelated() {} } else {} return [value];',
    'if (effect(value)) { function unrelated() {} } return [value];',
    'if (value) function unrelated() {} return [value];',
    'if (value) { const alias = value; } return [alias];',
    'if (value) { const alias = later; const later = value; } return [value];',
    'if (value) { function unrelated(input: number) { return [input]; } } return unrelated(value);'
].forEach((body, index) => test(`compiler conditional ownership: requirement and completion edge ${index}`, () => {
    const analysis = analyze(`export function outer([value]: [number]) { ${body} } outer([3]);`);

    strictEqual(analysis.consumers.length, 1);
    strictEqual(firstCall(analysis).status, [0, 2].includes(index) ? 'agreement' : 'unknown');
}));

test('compiler conditional ownership: reached closure creation follows the shared branch and formal completion', () => {
    const prefix = 'if (value) { const unrelated = () => { throw new Error("body"); }; }';
    const source = `export function outer([value]: [number]) { ${prefix} return [value]; }`;
    const baseline = counter();

    tuple(analyze(source), baseline);
    strictEqual(baseline.get('closure-creation'), 1);
    // Unknown calls retain separate result/use contexts; neither can lend a
    // reusable pure invocation to the other query.
    [['[3]', 1], ['[0]', 0], ['[]', 0], ['null', 0], ['external', 2]].forEach(([input = '', extra = 0] = []) => {
        const work = counter();

        tuple(analyze(`${source} outer(${input});`), work);
        strictEqual(work.get('closure-creation'), baseline.get('closure-creation') + extra);
    });
});

test('compiler conditional ownership: raw, transformed and fixed conditions retain native truth and initialization', async () => {
    const { program = {}, filename = '' } = fixture(declaration);
    const { code: output = '', diagnostics = [], agreements = [] } = createTypeScriptTransformer({ typescript, program }).transform({ code: declaration, fileName: filename });
    const { outputText: raw = '' } = typescript.transpileModule(declaration, { compilerOptions: program.getCompilerOptions() });
    const { output: fixed = '' } = new Linter().verifyAndFix(output, [plugin.configs.recommended, plugin.configs.contracts, plugin.configs.safety]);
    const { runtimeEvidence: { result: { fact: { families = [] } = {} } = {} } = {} } = agreements.find(({ action = '' } = {}) => action === 'preserve-native-tuple') ?? {};
    const versions = await Promise.all([raw, output, fixed].map(code => import(`data:text/javascript,${encodeURIComponent(code)}`)));

    deepStrictEqual(diagnostics, []);
    deepStrictEqual(families, ['array']);
    versions.forEach(({ outer = false } = {}) => {
        if (typeof outer !== 'function') throw new TypeError('Expected outer export');

        deepStrictEqual(outer([0]), [0]);
        deepStrictEqual(outer([]), [undefined]);
        throws(() => outer(), TypeError);
        throws(() => outer(null), TypeError);
        const failure = new Error('truthiness must not coerce');
        const value = { [Symbol.toPrimitive]() { throw failure; } };

        strictEqual(outer([value]).at(0), value);
        throws(() => outer({ get [Symbol.iterator]() { throw failure; } }), error => error === failure);
    });
});

test('compiler conditional ownership: revisions, query order and interrupted completion keep independent requirements', () => {
    const source = `${declaration} outer(['wrong']); outer(external);`;
    const expected = tuple(analyze(source));
    const { status = '', calls = [] } = expected;

    strictEqual(status, 'contradiction');
    deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['contradiction', 'unknown']);
    const revised = analyze(source.replace('[number]', '[string]'), { revision: '2', programRevision: '2' });
    const { calls: [{ status: judgment = '', fact = {} } = {}] = [] } = tuple(revised);
    const [{ fact: original = {} } = {}] = calls;

    strictEqual(judgment, 'agreement');
    deepStrictEqual(fact, original);
    const combined = analyze(`${declaration} ${declaration.replaceAll('outer', 'second').replace('[number]', '[string]')} outer([3]); second([3]);`);
    const reversed = combined.checkTuple({ index: 1 });
    const { status: reverse = '' } = reversed;

    strictEqual(reverse, 'contradiction');
    strictEqual(firstCall(combined).status, 'agreement');
    strictEqual(combined.checkTuple({ index: 1 }), reversed);
    const work = counter();

    tuple(analyze(source), work);
    const total = Object.values(work.read()).reduce((sum, count) => sum + count, 0);
    const failure = new Error('conditional observer failed');

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

test('compiler conditional ownership: compiler readers fail operationally and a live session releases host syntax', () => {
    const input = fixture(declaration);
    const { typescript: compiler = {} } = input;
    const { SyntaxKind: { IfStatement = -1 } = {} } = compiler;
    const failure = new Error('conditional reader failed');

    throws(() => createTypeScriptAnalysis({ ...input, typescript: { ...compiler, forEachChild(node, visit) {
        const { kind = -1 } = node;

        if (kind === IfStatement) throw failure;

        return compiler.forEachChild(node, visit);
    } } }), error => error === failure);
    assertCompilerCollection(`${declaration} outer([3]);`);
});

test('compiler conditional ownership: wide and nested joins share warm demand and fresh revisions', () => {
    [8, 16, 32].forEach((size) => {
        const wide = Array.from({ length: size }, () => 'if(value){const unused=()=>1;}').join(' ');
        const nested = `${'if(value){'.repeat(size)}const unused=()=>1;${'}'.repeat(size)}`;
        const independent = Array.from({ length: size }, (_, index) => `${declaration.replaceAll('outer', `outer${index}`)} outer${index}([3]);`).join(' ');

        [`export function outer([value]:[number]){${wide}return [value];}outer(['wrong']);outer(external);`,
            `export function outer([value]:[number]){${nested}return [value];}outer(['wrong']);outer(external);`, independent].forEach((source) => {
            const analysis = analyze(source);
            const work = counter();
            const results = analysis.consumers.map(({ index = -1 } = {}) => analysis.checkTuple({ index, ...work }));

            ok(results.length);
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
