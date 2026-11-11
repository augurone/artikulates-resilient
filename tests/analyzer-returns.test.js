import { deepStrictEqual, strictEqual, ok, throws, rejects } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { ESLint } from 'eslint';
import { parse } from 'espree';

import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const rule = 'resilient/signature-contract-return-consistency';
const engine = selected => new ESLint({ overrideConfigFile: true, overrideConfig: [{
    plugins: { resilient: selected }, rules: { [rule]: 'error' }, languageOptions: { ecmaVersion: 'latest', sourceType: 'module' }
}] });
const product = engine(plugin);
const { cases: preservedFindings = [] } = JSON.parse(readFileSync(new URL('./fixtures/return-findings.json', import.meta.url), 'utf8'));
const findings = async (source, lint = product) => {
    const [{ messages = [], fatalErrorCount = 0 } = {}] = await lint.lintText(source);

    strictEqual(fatalErrorCount, 0);

    return messages;
};

// These are single-rule fixtures, including deliberate violations. Silence from
// this rule does not approve their signatures, guards, or other dialect policy.
[
    ['conditional', 'const read = (flag = false) => flag ? [] : "";', 2],
    ['statement returns', 'const read = (flag = false) => { if(flag) return []; return ""; };', 2],
    ['returned alias', 'const read = (flag = false) => { const value = flag ? [] : ""; return value; };', 1],
    ['forwarded call', 'const select = (flag = false) => flag ? [] : ""; const read = (flag = false) => select(flag);', 3],
    ['independent unknown', 'const read = (flag = false, other = false) => { if(flag) return []; if(other) return external; return ""; };', 2],
    ['fallthrough', 'const read = (flag = false) => { if(flag) return []; };', 2],
    ['bare return', 'const read = (flag = false) => { if(flag) return; return []; };', 2],
    ['null', 'const read = (flag = false) => flag ? null : [];', 2],
    ['null versus fallthrough', 'const read = (flag = false) => { if(flag) return null; };', 2],
    ['normal finally', 'const read = (flag = false) => { try { return flag ? [] : ""; } finally { const local = ""; } };', 2],
    ['return finally', 'const read = (flag = false) => { try { return flag ? [] : ""; } finally { return 42; } };', 0],
    ['throw finally', 'const read = (flag = false) => { try { return flag ? [] : ""; } finally { throw 42; } };', 0],
    ['conditional finally', 'const read = (flag = false, replace = false) => { try { return flag ? [] : ""; } finally { if(replace) return 42; } };', 3],
    ['explicit catch', 'const read = (flag = false) => { try { if(flag) return []; throw 42; } catch(error) { return ""; } };', 2],
    ['nested function', 'const read = (flag = false) => { const nested = (other = false) => other ? [] : ""; return flag ? 0 : 1; };', 2],
    ['stable condition', 'const read = (flag = false) => { if(flag) return "yes"; return flag ? [] : "no"; };', 0],
    ['three families', 'const read = (a = false, b = false) => a ? [] : b ? "" : 42;', 3],
    ['effect only', 'const read = (flag = false) => { if(flag) return; external(); };', 0],
    ['defaults do not validate input', 'const read = (value = "") => value; read([]); read("hello");', 0],
    ['identical branches retain both sites', 'const read = (flag = false, other = false) => { const value = flag ? [] : ""; return other ? value : value; };', 2]
].forEach(([name = '', source = '', count = 0] = []) => {
    test(`return rule preserves reviewed wording and locations: ${name}`, async () => {
        const actual = await findings(source);
        const { source: expectedSource = '', messages = [] } = preservedFindings.find(({ name: candidate = '' } = {}) => candidate === name);

        strictEqual(actual.length, count);
        strictEqual(source, expectedSource);
        deepStrictEqual(actual, messages);
    });
});

test('a selected call cannot repair a producer contract or validate another call', () => {
    const source = 'const read = (flag = false) => flag ? [] : ""; read(true); read(false); read("wrong");';
    const original = createAnalysis({ source }).checkFunction({ index: 0 });
    const { status = '', diagnostics = [] } = original;

    strictEqual(status, 'contradiction');
    strictEqual(diagnostics.length, 2);
    [[0, 1, 2], [2, 1, 0]].forEach((order) => {
        const analysis = createAnalysis({ source });

        order.forEach((index) => {
            strictEqual(analysis.checkCallResult({ index, required: index === 1 ? 'string' : 'array' }).status, 'agreement');
            strictEqual(analysis.checkCall({ index }).status, index === 2 ? 'contradiction' : 'agreement');
            deepStrictEqual(analysis.checkFunction({ index: 0 }), original);
        });
    });
});

test('return findings retain known contradictions beside an independent unknown result', () => {
    const source = 'const read = (a = false, b = false) => { if(a) return []; if(b) return external; return ""; };';
    const { status = '', fact: { incomplete = false } = {}, diagnostics = [] } = createAnalysis({ source }).checkFunction({ index: 0 });

    strictEqual(status, 'contradiction');
    strictEqual(incomplete, true);
    deepStrictEqual(diagnostics.map(({ location: { range: [start = 0, end = 0] = [] } = {} } = {}) => source.slice(start, end)), ['[]', '""']);
});

test('aliasing or forwarding an incomplete value cannot hide its known contradictory alternatives', async () => {
    const expressions = [
        'const read = (a = false, b = false) => a ? [] : b ? "" : external;',
        'const read = (a = false, b = false) => { const value = a ? [] : b ? "" : external; return value; };',
        'const select = (a = false, b = false) => a ? [] : b ? "" : external; const read = (a = false, b = false) => select(a, b);'
    ];

    await Promise.all(expressions.map(async (source) => {
        const analysis = createAnalysis({ source });
        const { functions = [] } = analysis;
        const { index = -1 } = functions.at(-1);
        const { status = '', diagnostics = [] } = analysis.checkFunction({ index });

        strictEqual(status, 'contradiction');
        ok(diagnostics.length);
        diagnostics.forEach(({ data: { actual = '', expected = '' } = {} } = {}) => deepStrictEqual([actual, expected].toSorted(), ['array', 'string']));
        ok((await findings(source)).length);
    }));
    // Known alternatives must survive the opaque alias; the old checker erased them.
    ok((await findings(expressions.at(1))).length);
});

test('unknown nullish possibility never becomes an established null return', () => {
    const source = 'const empty = () => {}; const read = (a = false, b = false) => { const value = a ? empty() : external; if(b) return value; return ""; };';
    const { diagnostics = [] } = createAnalysis({ source }).checkFunction({ index: 1 });

    deepStrictEqual(diagnostics.map(({ data = {} } = {}) => data), [
        { actual: 'undefined', expected: 'string' }, { actual: 'string', expected: 'undefined' }
    ]);
});

test('logical results report the operands that can actually survive selection', async () => {
    const source = 'const read = (flag = false) => { const value = flag ? [] : ""; return value || 42; };';
    const [{ message = '', messageId = '', column = 0, endColumn = 0 } = {}] = await findings(source);

    strictEqual(message, 'This || expression returns its array operand, but another return path produces number.');
    strictEqual(messageId, 'inconsistentOperand');
    strictEqual(column, source.indexOf('value ||') + 1);
    strictEqual(endColumn, source.indexOf('value ||') + 'value || 42'.length + 1);
    deepStrictEqual([true, false].map(flag => runInNewContext(`${source} typeof read(${flag});`)), ['object', 'number']);
});

test('absence identity survives a returned alias and a forwarding call', () => {
    const source = 'const empty = () => {}; const read = (flag = false) => { const value = flag ? null : empty(); return value; };';
    const { status = '', diagnostics = [] } = createAnalysis({ source }).checkFunction({ index: 1 });

    strictEqual(status, 'contradiction');
    strictEqual(diagnostics.length, 1);
    deepStrictEqual(diagnostics.at(0).data, { actual: 'null', expected: 'undefined' });
    strictEqual(diagnostics.at(0).messageId, 'inconsistentValue');
});

test('unsupported execution remains unknown and produces no fabricated return finding', async () => {
    const definitions = [
        'function* (flag = false) { return flag ? [] : ""; }',
        '() => { while(external) {} return []; }',
        '() => { let value = []; value = ""; return value; }',
        '() => { try { external(); return []; } catch(error) { return ""; } }'
    ];

    await Promise.all(definitions.map(async (definition) => {
        const source = `const read = ${definition};`;
        const { status = '', diagnostics = [] } = createAnalysis({ source }).checkFunction({ index: 0 });

        strictEqual(status, 'unknown');
        deepStrictEqual(diagnostics, []);
        deepStrictEqual(await findings(source), []);
    }));
});

test('return evidence is immutable and belongs to the acquired host snapshot', () => {
    const source = 'const read = (flag = false) => flag ? [] : "";';
    const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
    const analysis = createProgramAnalysis({ program });
    const { body: [{ declarations: [{ init: { body = {} } = {} } = {}] = [] } = {}] = [] } = program;
    const { consequent = {} } = body;
    const original = analysis.checkFunction({ index: 0 });

    Object.defineProperty(body, 'alternate', { value: consequent });
    deepStrictEqual(analysis.checkFunction({ index: 0 }), original);
    strictEqual(createProgramAnalysis({ program }).checkFunction({ index: 0 }).status, 'agreement');
    const { diagnostics = [] } = original;

    [original, diagnostics, ...diagnostics,
        ...diagnostics.flatMap(({ data = {}, location = {} } = {}) => [data, location]),
        ...diagnostics.map(({ location: { range = [] } = {} } = {}) => range)
    ].forEach(value => ok(Object.isFrozen(value)));
});

test('return observation failure propagates and retry preserves all findings', () => {
    const source = 'const read = (flag = false) => flag ? [] : "";';
    const analysis = createAnalysis({ source });
    const failure = new Error('return observation failed');

    throws(() => analysis.checkFunction({ index: 0, onWork: ({ kind = '' } = {}) => {
        if (kind === 'flow-result') throw failure;
    } }), error => error === failure);
    deepStrictEqual(analysis.checkFunction({ index: 0 }), createAnalysis({ source }).checkFunction({ index: 0 }));
    throws(() => createAnalysis({ source, limits: { demand: 1 } }).checkFunction({ index: 0 }), /demand limit/);
});

test('return rule failures propagate through the host', async () => {
    const failure = new Error('return source failed');
    const injector = { rules: { fail: { create() {
        return { 'Program:exit'({ body: [{ declarations: [{ init: { body = {} } = {} } = {}] = [] } = {}] = [] } = {}) {
            Object.defineProperty(body, 'consequent', { get() { throw failure; } });
        } };
    } } } };
    const lint = new ESLint({ overrideConfigFile: true, overrideConfig: [{ plugins: { injector, resilient: plugin },
        rules: { 'injector/fail': 'error', [rule]: 'error' } }] });

    await rejects(() => lint.lintText('const read = flag => flag ? [] : "";'), error => error === failure);
});
