import { deepStrictEqual, strictEqual, ok, throws } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { ESLint } from 'eslint';
import { parse } from 'espree';

import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/member-contracts.json', import.meta.url), 'utf8'));
const lint = new ESLint({ overrideConfigFile: true, overrideConfig: {
    plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-operation': 'error', 'resilient/signature-contract-property': 'error' }
} });
const findings = (analysis) => {
    const { memberAccesses = [] } = analysis;
    const evidence = memberAccesses.map(({ index = -1, name = '', call = false } = {}) => ({ name, call, ...analysis.checkMemberAccess({ index }) }));

    return {
        properties: evidence.filter(({ missing = false } = {}) => missing).map(({ name = '' } = {}) => name),
        operations: evidence.filter(({ call = false, conflicts = [] } = {}) => call && Boolean(conflicts.length)).map(({ name = '' } = {}) => name)
    };
};
cases.forEach(({ name = '', source = '', properties = [], operations = [] } = {}) => {
    test(`shared member evidence: ${name}`, () => deepStrictEqual(findings(createAnalysis({ source })), { properties, operations }));
    test(`product member rules: ${name}`, async () => {
        const [{ messages = [] } = {}] = await lint.lintText(source);

        deepStrictEqual(messages.filter(({ ruleId = '' } = {}) => ruleId.endsWith('property')).map(({ message = '' } = {}) => message),
            properties.map(property => `Property ${property} does not exist on this known object contract.`));
        strictEqual(messages.filter(({ ruleId = '' } = {}) => ruleId.endsWith('operation')).length, operations.length);
        messages.forEach(({ fix = false, suggestions = [] } = {}) => { strictEqual(fix, false); deepStrictEqual(suggestions, []); });
    });
});

test('member queries cannot contaminate a generic callee with either supplied or default values', () => {
    const source = 'const f=(value=[])=>value;f("text").map(Boolean);const run=(value=[])=>value.trim();';
    const first = createAnalysis({ source });
    const second = createAnalysis({ source });
    const before = first.checkFunction({ index: 0 });

    deepStrictEqual(findings(first), findings(second));
    const { status = '' } = before;

    strictEqual(status, 'unknown');
    deepStrictEqual(first.checkFunction({ index: 0 }), before);
    second.memberAccesses.toReversed().forEach(({ index = -1 } = {}) => second.checkMemberAccess({ index }));
    deepStrictEqual(findings(second), findings(first));
    strictEqual(second.checkFunction({ index: 0 }).status, 'unknown');
});

test('public member queries validate positions, freeze answers, reuse demand and propagate failures', () => {
    const analysis = createAnalysis({ source: 'const get=()=>({name:1});get().nmae;' });
    const work = counter();
    const result = analysis.checkMemberAccess({ index: 0, onWork: event => work.onWork(event) });
    const demanded = work.get('value-demand');

    const { missing = false, evidence = [], conflicts = [] } = result;
    const { memberAccesses = [] } = analysis;

    ok(missing);
    [memberAccesses, memberAccesses.at(0), result, evidence, conflicts].forEach(value => ok(Object.isFrozen(value)));
    deepStrictEqual(analysis.checkMemberAccess({ index: 0, onWork: event => work.onWork(event) }), result);
    strictEqual(work.get('value-demand'), demanded);
    [-1, 1, NaN, '0'].forEach(index => throws(() => analysis.checkMemberAccess({ index }), RangeError));
    const interrupted = createAnalysis({ source: 'const f=({items=[]}={})=>items.trim();' });

    throws(() => interrupted.checkMemberAccess({ index: 0, onWork: () => { throw new Error('observer failed'); } }), /observer failed/);
    deepStrictEqual(findings(interrupted), findings(createAnalysis({ source: 'const f=({items=[]}={})=>items.trim();' })));
});

test('owned member snapshots and source revisions remain independent of host edits', () => {
    const program = parse('({name:1}).nmae;', { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
    const first = createProgramAnalysis({ program });

    // Deliberately mutate the host tree after acquisition.
    runInNewContext('program.body[0].expression.property.name = "name";', { program });
    strictEqual(first.checkMemberAccess({ index: 0 }).missing, true);
    const second = createAnalysis({ source: '({name:1}).name;' });

    strictEqual(second.checkMemberAccess({ index: 0 }).missing, false);
    strictEqual(first.checkMemberAccess({ index: 0 }).missing, true);
});

test('interrupted member proofs resume without publishing a partial contradiction', () => {
    const source = 'const run=({items=[]}={})=>items.trim();';
    const expected = findings(createAnalysis({ source }));

    const work = counter();

    createAnalysis({ source }).checkMemberAccess({ index: 0, onWork: event => work.onWork(event) });
    Object.keys(work.read()).forEach((interrupted) => {
        const analysis = createAnalysis({ source });

        throws(() => analysis.checkMemberAccess({ index: 0, onWork: ({ kind = '' } = {}) => {
            if (kind === interrupted) throw new Error(`interrupted ${kind}`);
        } }), /interrupted/);
        deepStrictEqual(findings(analysis), expected);
    });
});

test('native execution agrees with mixed-family guard selection and its contradictory counterpart', () => {
    const good = 'const x=flag?[]:"";const text=typeof x==="string";if(text)x.trim();"complete";';
    const bad = 'const x=flag?[]:"";if(typeof x==="string")x.map(Boolean);';

    [true, false].forEach(flag => strictEqual(runInNewContext(good, { flag }), 'complete'));
    throws(() => runInNewContext(bad, { flag: false }), /is not a function/);
    deepStrictEqual(findings(createAnalysis({ source: good })), { properties: [], operations: [] });
    deepStrictEqual(findings(createAnalysis({ source: bad })), { properties: [], operations: ['map'] });
});

test('native reflection counterexamples retire the standard-intrinsic premise', () => {
    [
        'Object.getPrototypeOf([]).trim=()=>"custom";[].trim();',
        'const proto=Reflect.getPrototypeOf([]);proto.trim=()=>"custom";[].trim();',
        'const C=[]["constructor"];C.prototype.trim=()=>"custom";[].trim();',
        'const proto=[]["__proto__"];proto.trim=()=>"custom";[].trim();',
        'Number.prototype.trim=()=>"custom";(1).trim();',
        'const consume=reader=>reader.map(Boolean);const run=(enabled=false)=>(enabled&&[]).map(Boolean);consume({map(C){C.prototype.map=()=>"custom";}});run();'
    ].forEach((source) => {
        strictEqual(runInNewContext(source), 'custom');
        deepStrictEqual(findings(createAnalysis({ source })), { properties: [], operations: [] });
    });
});
