import { deepStrictEqual, strictEqual, ok, throws } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { ESLint } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const cases = JSON.parse(readFileSync(new URL('./fixtures/absence-evidence.json', import.meta.url), 'utf8'));
const identifiers = analysis => analysis.declarations.filter(({ kind = '' } = {}) => kind === 'Identifier');
const results = analysis => identifiers(analysis).map(({ index = -1 } = {}) => analysis.checkDeclaration({ index }));
const lint = new ESLint({ overrideConfigFile: true, allowInlineConfig: false, overrideConfig: [{
    plugins: { resilient: plugin }, rules: { 'resilient/prefer-safe-destructuring-defaults': 'error' },
    settings: { resilient: { resolver: () => false } }
}] });

cases.forEach(({ name = '', source = '', required = [] } = {}) => {
    test(`source-owned absence evidence: ${name}`, async () => {
        const analysis = createAnalysis({ source });
        const expected = identifiers(analysis).filter(({ index = -1 } = {}, position) => {
            const { required: missing = false } = analysis.checkDeclaration({ index });

            strictEqual(missing, required.at(position));

            return missing;
        }).map(({ location: { line = 0, column = 0, range: [start = 0, end = 0] = [] } = {} } = {}) => ({ line, column, endLine: line, endColumn: column + end - start }));
        const [output = {}] = await lint.lintText(source, { filePath: 'absence-evidence.js' });
        const { messages = [] } = output;

        strictEqual(identifiers(analysis).length, required.length);
        deepStrictEqual(messages.map(({ line = 0, column = 0, endLine = 0, endColumn = 0 } = {}) => ({ line, column, endLine, endColumn })), expected);
    });
});

test('return identity is shared with function queries and independent of query order', () => {
    const [{ source = '' } = {}] = cases;
    const forward = createAnalysis({ source });
    const reverse = createAnalysis({ source });
    const a = results(forward);
    const b = reverse.functions.toReversed().map(({ index = -1 } = {}) => reverse.checkFunction({ index }));

    deepStrictEqual(results(reverse), a);
    deepStrictEqual(forward.functions.toReversed().map(({ index = -1 } = {}) => forward.checkFunction({ index })), b);
    const [{ returnedParameter = false, status = '' } = {}] = b;
    const { index = -1 } = returnedParameter;

    strictEqual(index, 0);
    strictEqual(status, 'unknown', 'Returning one formal proves identity, not its family');
    ok(a.every(({ code = '' } = {}) => code === 'guarded-tuple-identity'));
    strictEqual(a.at(0), a.at(1), 'Tuple leaves share one completed obligation');
});

test('completed tuple evidence preserves known conflict beside unknown alternatives', () => {
    const source = 'const run = (state, tuple) => { if (!isArray(tuple) || tuple.length < 2) return state; const [a, b] = tuple; if (a) return []; return {}; };';
    const analysis = createAnalysis({ source });
    const [{ evidence: [proof = {}] = [] } = {}] = results(analysis);
    const { status = '', families = [], incomplete = false } = proof;

    strictEqual(status, 'contradiction');
    deepStrictEqual(families.toSorted(), ['array', 'object']);
    strictEqual(incomplete, true);
    strictEqual(analysis.checkFunction({ index: 0 }).status, 'contradiction');
});

test('unknown carrier calls retain their result obligation and source locations', () => {
    const { source = '' } = cases.find(({ name = '' } = {}) => name === 'lifted member names do not prove correspondence') ?? {};
    const [{ required = false, evidence: [proof = {}] = [] } = {}] = results(createAnalysis({ source }));
    const { status = '', families = [], incomplete = false, returns = [] } = proof;

    strictEqual(required, true);
    strictEqual(status, 'unknown');
    deepStrictEqual(families, []);
    strictEqual(incomplete, true);
    strictEqual(returns.length, 2);
    ok(returns.every(({ range = [] } = {}) => source.slice(...range).startsWith('carrier.')));
});

test('source revisions and failed observations cannot publish a tuple admission', () => {
    const [{ source = '' } = {}] = cases;
    const original = createAnalysis({ source });
    const changed = createAnalysis({ source: source.replace('return state; };', 'return external; };') });
    const [{ index = -1 } = {}] = identifiers(original);
    const failure = new Error('observation failed');

    throws(() => original.checkDeclaration({ index, onWork: () => { throw failure; } }), error => error === failure);
    strictEqual(original.checkDeclaration({ index }).required, false);
    strictEqual(changed.checkDeclaration({ index }).required, true);
    strictEqual(original.checkDeclaration({ index }).required, false);
});

test('void preserves evaluation failure and supplied arguments do not inherit absence defaults', () => {
    const source = 'const fail = () => { throw 1; }; const run = () => void fail(); const consume = (value = []) => value; consume(external);';
    const analysis = createAnalysis({ source });
    const result = analysis.checkFunction({ index: 1 });
    const { normal = true, thrown = false } = result;

    strictEqual(normal, false);
    strictEqual(thrown, true);
    strictEqual(analysis.checkCall({ index: 1 }).status, 'unknown');
});

test('imported consumer guards do not infer initializer values', () => {
    const source = 'import { consume } from "consumer"; const run = ({ action }) => consume(action);';
    const safe = 'export const consume = action => { const read = ({ value = undefined }) => value; if (typeof action === "function") action(read({})); };';
    const unsafe = `const undefined = external; ${safe}`;
    const acquire = dependency => createAnalysis({ source, filename: 'main', resolveModule: () => ({ filename: 'consumer', source: dependency }) });
    const original = acquire(safe);

    strictEqual(results(original).at(0).required, false);
    strictEqual(results(acquire(unsafe)).at(0).required, false);
    strictEqual(createAnalysis({ source: unsafe }).checkFunction({ index: 0 }).status, 'unknown');
    strictEqual(results(original).at(0).required, false);
});

test('tuple result projections are shared across multiple boundaries in one function', () => {
    const source = `const fold = (state, first, second) => {
        if (!isArray(first) || first.length < 2) return state;
        const [a, b] = first;
        if (!isArray(second) || second.length < 2) return state;
        const [c, d] = second;
        return state;
    };`;
    const completed = results(createAnalysis({ source }));
    const [{ evidence: [first = {}] = [] } = {}, , { evidence: [second = {}] = [] } = {}] = completed;
    const { returns: a = [] } = first;
    const { returns: b = [] } = second;

    ok(completed.every(({ required = true } = {}) => !required));
    strictEqual(a, b);
});

test('dynamic scope cannot borrow an unbound intrinsic absence fact', () => {
    const source = 'const read = function () { eval("var undefined = []"); return undefined.map(action); };';
    const analysis = createAnalysis({ source, sourceType: 'script' });

    strictEqual(analysis.check({ index: 0 }).status, 'unknown');
});

test('75 completed return compositions agree with independently executed formal identity', () => {
    const expressions = ['state', 'other', '[]', 'flag ? state : other', 'flag ? other : state'];

    expressions.forEach(left => expressions.forEach((right) => {
        const expression = `flag ? (${left}) : (${right})`;
        [`return ${expression};`, `try { return ${expression}; } finally { if (flag) return state; }`,
            `try { return ${expression}; } finally { if (flag) throw 1; }`].forEach((body) => {
            const source = `const choose = (state, other, flag) => { ${body} };`;
            const observed = Array.from(runInNewContext(`${source}
                const state = {}, other = {};
                [false, true].map(flag => {
                    try { const result = choose(state, other, flag); return result === state ? 0 : result === other ? 1 : -1; }
                    catch { return 'thrown'; }
                });`)).filter(value => value !== 'thrown');
            const alternatives = [...new Set(observed)];
            const [only = -1] = alternatives;
            const analysis = createAnalysis({ source: `${source} choose([], 42, true); choose({}, '', false);` });
            const generic = analysis.checkFunction({ index: 0 });
            const { returnedParameter = false } = generic;
            const { index = -1 } = returnedParameter;

            strictEqual(index, alternatives.length === 1 ? only : -1, source);
            analysis.calls.forEach(({ index = -1 } = {}) => analysis.checkCallResult({ index, required: 'array' }));
            deepStrictEqual(analysis.checkFunction({ index: 0 }), generic);
        });
    }));
});

test('null and undefined conflicts remain distinct beside an unknown returned formal', () => {
    const source = 'const run = (state, tuple) => { if (!isArray(tuple) || tuple.length < 2) return state; const [a, b] = tuple; if (a) return null; return void 0; };';
    const [{ evidence: [proof = {}] = [] } = {}] = results(createAnalysis({ source }));
    const { status = '', families = [], absences = [], incomplete = false } = proof;

    strictEqual(status, 'contradiction');
    deepStrictEqual(families, ['nullish']);
    deepStrictEqual(absences.toSorted(), ['null', 'undefined']);
    strictEqual(incomplete, true);
});

test('the rejected result uses the same selected identity projection as normal completion', () => {
    const source = `const choose = (state, other, flag) => { try { return flag ? other : state; } finally { if (flag) throw 1; } };
        const fold = (state, tuple, other, flag) => {
            if (!isArray(tuple) || tuple.length < 2) return choose(state, other, flag);
            const [a, b] = tuple;
            return state;
        };`;

    ok(results(createAnalysis({ source })).every(({ required = true } = {}) => !required));
});
