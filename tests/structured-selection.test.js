import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter, SourceCode } from 'eslint';
import { parse } from 'espree';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/structured-selection.json', import.meta.url), 'utf8'));
const adversarial = JSON.parse(readFileSync(new URL('./fixtures/structured-selection-adversarial.json', import.meta.url), 'utf8'));
const examples = [
    { name: 'signature-contract-destructuring', source: 'const {}=[];' },
    { name: 'signature-contract-property', source: '({}).missing;' },
    { name: 'signature-contract-operation', source: '"".map(value=>value);' }
];
const names = examples.map(({ name = '' } = {}) => name);
const rulesFor = selected => Object.fromEntries(selected.map(name => [`resilient/${name}`, 'error']));
const lint = (source, selected, options = {}) => new Linter().verify(source, {
    plugins: { resilient: plugin }, rules: rulesFor(selected), ...options
});

cases.forEach(({ rule = '', source = '', expected = [] } = {}) => test(`${rule} source contract: ${source}`, () => {
    deepStrictEqual(lint(source, [rule]), expected);
}));

adversarial.forEach(({ rule = '', source = '', expected = [] } = {}) => test(`${rule} composition boundary: ${source}`, () => {
    const findings = lint(source, [rule]);

    deepStrictEqual(findings.map(({ messageId = '' } = {}) => messageId), expected);
    findings.forEach(({ fix = false, suggestions = [] } = {}) => {
        strictEqual(fix, false);
        deepStrictEqual(suggestions, []);
    });
}));

examples.forEach(({ name = '', source = '' } = {}) => {
    const rule = `resilient/${name}`;

    test(`configured severity and disable: ${name}`, () => {
        deepStrictEqual(lint(source, [name], { rules: { [rule]: 'off' } }), []);
        const warning = lint(source, [name], { rules: { [rule]: 'warn' } });
        const error = lint(source, [name]);

        strictEqual(warning.length, 1);
        strictEqual(error.length, 1);
        strictEqual(warning.at(0).severity, 1);
        strictEqual(error.at(0).severity, 2);
    });

    test(`explicit consumer suppression: ${name}`, () => {
        const engine = new Linter();
        const findings = engine.verify(`// eslint-disable-next-line ${rule} -- Deliberate negative fixture.\n${source}`,
            { plugins: { resilient: plugin }, rules: { [rule]: 'error' } });

        deepStrictEqual(findings, []);
        const suppressed = engine.getSuppressedMessages();

        strictEqual(suppressed.length, 1);
        strictEqual(suppressed.at(0).ruleId, rule);
    });

    test(`owning rule metadata: ${name}`, () => {
        const { rules = {} } = plugin;
        const { meta: { docs: { url = '' } = {}, schema = [], fixable = false, hasSuggestions = false } = {} } = Reflect.get(rules, name);

        strictEqual(url, `https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/${name}.md`);
        deepStrictEqual(schema, []);
        strictEqual(fixable, false);
        strictEqual(hasSuggestions, false);
    });
});

test('the public contracts preset executes all three rules', () => {
    const { configs: { contracts = {} } = {} } = plugin;
    const findings = new Linter().verify(examples.map(({ source = '' } = {}) => source).join('\n'), contracts);

    deepStrictEqual(findings.map(({ ruleId = '' } = {}) => ruleId), names.map(name => `resilient/${name}`));
});

test('source facts remain unknown rather than certifying an external boundary', () => {
    const analysis = createAnalysis({ source: 'const {missing}=external;external.missing;external.map(value=>value);' });
    const { destructurings = [], destructuringFields = [], memberAccesses = [] } = analysis;

    deepStrictEqual([destructurings.length, destructuringFields.length, memberAccesses.length], [1, 1, 2]);
    destructurings.forEach(({ index = -1 } = {}) => strictEqual(analysis.checkDestructuring({ index }).status, 'unknown'));
    destructuringFields.forEach(({ index = -1 } = {}) => strictEqual(analysis.checkDestructuringField({ index }).status, 'unknown'));
    memberAccesses.forEach(({ index = -1 } = {}) => {
        const { incomplete = false, missing = true, conflicts = [] } = analysis.checkMemberAccess({ index });

        strictEqual(incomplete, true);
        strictEqual(missing, false);
        deepStrictEqual(conflicts, []);
    });
});

test('null and undefined retain distinct default behavior while the rule labels their public family honestly', () => {
    ['null', 'undefined'].forEach((value) => {
        const [finding = {}] = lint(`const {}=${value};`, ['signature-contract-destructuring']);
        const { message = '' } = finding;

        strictEqual(message, 'This nullish value is destructured as object-like.');
    });
    strictEqual(lint('const [item=[]]=[undefined];item.map(value=>value);', ['signature-contract-operation']).length, 0);
    const [finding = {}] = lint('const [item=[]]=[null];item.map(value=>value);', ['signature-contract-operation']);
    const { message = '' } = finding;

    strictEqual(message, 'This nullish value cannot supply native .map(), which requires array-like.');
    strictEqual(runInNewContext('const [item=[]]=[undefined];Array.isArray(item);'), true);
    strictEqual(runInNewContext('const [item=[]]=[null];item===null;'), true);
});

test('rule order preserves shared query evidence and source anchors', () => {
    const source = 'const make=()=>({items:""});const {missing}=make();make().absent;make().items.map(value=>value);';
    const expected = lint(source, names);
    const orders = names.flatMap(first => names.filter(name => name !== first).map(second => [first, second, ...names.filter(name => ![first, second].includes(name))]));

    strictEqual(expected.length, 3);
    orders.forEach(order => deepStrictEqual(lint(source, order), expected));
});

test('public inspection uses stable locations, warm demand, query order and observer retry', () => {
    const source = 'const make=()=>({inner:{},items:""});const {inner:{missing}}=make();make().absent;make().items.map(value=>value);';
    const analysis = createAnalysis({ source });
    const { destructuringFields = [], memberAccesses = [] } = analysis;
    const work = counter();
    const observer = { onWork: event => work.onWork(event) };
    const inspect = (analysis, options = {}) => {
        const { destructuringFields = [], memberAccesses = [] } = analysis;

        return {
            fields: destructuringFields.map(({ index = -1 } = {}) => analysis.checkDestructuringField({ ...options, index })),
            members: memberAccesses.map(({ index = -1 } = {}) => analysis.checkMemberAccess({ ...options, index }))
        };
    };
    const expected = inspect(analysis, observer);
    const { counts = {} } = analysis;
    const cold = work.read();

    deepStrictEqual([destructuringFields.length, memberAccesses.length], [2, 3]);
    deepStrictEqual(inspect(analysis, observer), expected);
    const { counts: repeated = {} } = analysis;

    deepStrictEqual(repeated, counts);
    strictEqual(work.get('value-demand'), Reflect.get(cold, 'value-demand'));
    const reordered = createAnalysis({ source });

    memberAccesses.toReversed().forEach(({ index = -1 } = {}) => reordered.checkMemberAccess({ index }));
    deepStrictEqual(inspect(reordered), expected);
    const { index = -1, location: { range: [start = -1, end = -1] = [] } = {} } = destructuringFields.find(({ name = '' } = {}) => name === 'missing') ?? {};

    strictEqual(source.slice(start, end), 'missing');
    const interrupted = createAnalysis({ source });

    throws(() => interrupted.checkDestructuringField({ index, onWork: () => { throw new Error('stop inspection'); } }), /stop inspection/);
    deepStrictEqual(inspect(interrupted), expected);
});

test('writer order and native method identity have independent runtime witnesses', () => {
    strictEqual(runInNewContext('const external={items:[]};({items:"",...external}).items.length;'), 0);
    strictEqual(runInNewContext('const external={items:[]};({...external,items:"text"}).items;'), 'text');
    strictEqual(runInNewContext('({map:()=>"local"}).map().trim();'), 'local');
    strictEqual(runInNewContext('Array.prototype.trim=()=>"custom";[].trim();'), 'custom');
    throws(() => runInNewContext('({...{items:[]},items:"text"}).items.map(value=>value);'), /is not a function/);
});

test('source-backed findings refresh when the host reuses SourceCode across revisions', (context) => {
    const directory = mkdtempSync(join(tmpdir(), 'resilient-s02-'));

    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const provider = join(directory, 'provider.js');
    const source = 'import {make} from "./provider.js";const {missing}=make();make().absent;make().items.map(value=>value);';
    const sourceCode = new SourceCode(source, parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true, tokens: true, comment: true }));
    const engine = new Linter({ cwd: directory });
    const inspect = () => engine.verify(sourceCode, { plugins: { resilient: plugin }, rules: rulesFor(names) }, { filename: join(directory, 'consumer.js') });

    writeFileSync(provider, 'export const make=()=>({items:""});');
    const before = inspect();
    const retained = structuredClone(before);

    deepStrictEqual(before.map(({ ruleId = '' } = {}) => ruleId), names.map(name => `resilient/${name}`));
    const { messageId = '', message = '' } = before.at(2);

    strictEqual(messageId, 'sourceMismatch');
    ok(message.includes(`${provider} at line 1`));
    writeFileSync(provider, 'export const make=()=>({missing:0,absent:0,items:[]});');
    deepStrictEqual(inspect(), []);
    deepStrictEqual(before, retained);
});
