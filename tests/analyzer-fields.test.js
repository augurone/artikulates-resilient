import { deepStrictEqual, strictEqual, ok, throws } from 'node:assert/strict';
import test from 'node:test';

import { ESLint } from 'eslint';
import { parse } from 'espree';

import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

const lint = new ESLint({ overrideConfigFile: true, overrideConfig: [{
    plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-destructuring': 'error' }
}] });
const findings = async (source) => {
    const [{ messages = [], fatalErrorCount = 0 } = {}] = await lint.lintText(source);

    strictEqual(fatalErrorCount, 0);

    return messages;
};

[
    ['nested default owns its own required fields', 'const { a = 0, b: { child } = {} } = {};', 'child'],
    ['alias remains owned before effects', 'const source = {}; const alias = source; const { missing } = alias;', 'missing'],
    ['empty literal', 'const { missing } = {};', 'missing'],
    ['alias keeps the property name', 'const { missing: renamed } = { present: 1 };', 'missing'],
    ['assignment', 'let item; ({ missing: item } = {});', 'missing'],
    ['member target', 'const target = {}; ({ missing: target.item } = {});', 'missing'],
    ['rest does not supply a named field', 'const { missing, ...rest } = {};', 'missing'],
    ['nested required boundary', 'const { missing: { child } } = {};', 'missing'],
    ['string key', 'const { "missing-key": item } = {};', '"missing-key"'],
    ['numeric key', 'const { 12: item } = {};', '12'],
    ['empty string key', 'const { "": item } = {};', '""'],
    ['default on a sibling', 'const { present = 0, missing } = {};', 'missing'],
    ['method is present but another field is absent', 'const { missing } = { present() {} };', 'missing'],
    ['prototype-spelled shorthand is ordinary data', 'const __proto__ = 1; const { missing } = { __proto__ };', 'missing'],
    ['local function body', 'const read = () => { const { missing } = {}; };', 'missing']
].forEach(([name = '', source = '', key = ''] = []) => {
    test(`fresh record lint reports ${name} at the required key`, async () => {
        const property = key.startsWith('"') ? JSON.parse(key) : key;
        const start = source.indexOf(key);

        deepStrictEqual(await findings(source), [{
            ruleId: 'resilient/signature-contract-destructuring', severity: 2,
            message: `Property ${property} does not exist on this known object contract.`,
            line: 1, column: start + 1, endLine: 1, endColumn: start + key.length + 1,
            messageId: 'missingProperty'
        }]);
    });
});

[
    ['present fields including falsey values', 'const { a, b, c, d } = { a: false, b: 0, c: "", d: null };'],
    ['present unknown values', 'const { a } = { a: external };'],
    ['numeric and empty keys are present', 'const { 12: a, "": b } = { "12": 0, "": false };'],
    ['duplicates preserve presence', 'const { a } = { a: 1, a: external };'],
    ['computed literal keys are known writers', 'const { a } = { ["a"]: 1 };'],
    ['computed prototype key is an own property', 'const { __proto__: value } = { ["__proto__"]: external };'],
    ['prototype spelling on a method is an own property', 'const { __proto__: value } = { __proto__() {} };'],
    ['prototype spelling on shorthand is an own property', 'const __proto__ = 1; const { __proto__: value } = { __proto__ };'],
    ['nested values are not inferred', 'const { a: { b } } = { a: [] };'],
    ['rest has no named obligation', 'const { ...rest } = {};'],
    ['computed pattern boundary', 'const { [key]: a, missing } = {};'],
    ['unknown source', 'const { missing } = external;'],
    ['const object may change', 'const source = {}; Object.assign(source, { missing: 1 }); const { missing } = source;'],
    ['spread may supply the field', 'const { missing } = { ...external };'],
    ['computed writer may supply the field', 'const { missing } = { [key]: 1 };'],
    ['getter may change later fields', 'const { first, missing } = { get first() { this.missing = 1; return 0; } };'],
    ['prototype may supply a getter', 'const { first, missing } = { __proto__: external };'],
    ['quoted prototype definition', 'const { missing } = { "__proto__": external };'],
    ['parameter initializer is excluded', 'const read = ({ missing } = {}) => missing;'],
    ['class body is excluded', 'class Model { read() { const { missing } = {}; } }']
].forEach(([name = '', source = ''] = []) => {
    test(`fresh record lint stays quiet: ${name}`, async () => deepStrictEqual(await findings(source), []));
});

test('presence judgments preserve unknown writers and known fields independently', () => {
    const source = 'const { a, b, c } = { a: 1, ...external, b: 2, [key]: 3, c: 4 };';
    const analysis = createAnalysis({ source });
    const { destructuringFields = [] } = analysis;
    const results = destructuringFields.map(({ index = -1 } = {}) => analysis.checkDestructuringField({ index }));

    deepStrictEqual(results.map(({ status = '' } = {}) => status), ['agreement', 'agreement', 'agreement']);
    deepStrictEqual(results.map(({ fact: { presence = [] } = {} } = {}) => presence), [['present'], ['present'], ['present']]);
});

test('field demand reuses root and named facts without inferring values', () => {
    const analysis = createAnalysis({ source: 'const { a: first, a: second, missing } = { a: 42, unused: { nested: external } };' });
    const work = counter();
    const root = analysis.checkDestructuring({ index: 0, onWork: event => work.onWork(event) });
    const first = analysis.checkDestructuringField({ index: 0, onWork: event => work.onWork(event) });
    const second = analysis.checkDestructuringField({ index: 1, onWork: event => work.onWork(event) });
    const missing = analysis.checkDestructuringField({ index: 2, onWork: event => work.onWork(event) });
    const { status = '', fact = {}, family = {} } = first;
    const { presence = [] } = fact;
    const { fact: secondFact = {} } = second;
    const { status: missingStatus = '' } = missing;
    const { fact: rootFact = {} } = root;
    const { destructuringFields = [] } = analysis;

    strictEqual(status, 'agreement');
    strictEqual(missingStatus, 'contradiction');
    strictEqual(fact, secondFact);
    strictEqual(family, rootFact);
    strictEqual(work.get('establishment'), 3);
    strictEqual(work.get('field-lookup'), 2);
    strictEqual(work.get('field-index-entry'), 2);
    strictEqual(work.get('literal-classification'), 0);
    strictEqual(analysis.checkDestructuringField({ index: 0, onWork: event => work.onWork(event) }).fact, fact);
    strictEqual(work.get('establishment'), 3);
    strictEqual(work.get('field-index-entry'), 2);
    deepStrictEqual(Object.keys(fact), ['facet', 'state', 'reason', 'presence', 'causes', 'causesTruncated']);
    [first, fact, presence, family, destructuringFields, ...destructuringFields].forEach(value => ok(Object.isFrozen(value)));
    [-1, 3, NaN, '0'].forEach(index => throws(() => analysis.checkDestructuringField({ index }), RangeError));
    throws(() => analysis.checkDestructuringField({ index: 0, onWork: () => { throw new Error('observer failed'); } }), /observer failed/);
});

test('field snapshots detach key evidence and locations from the host AST', () => {
    const source = 'const {\n missing: item\n} = { present: 1 };';
    const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
    const pristine = structuredClone(program);
    const analysis = createProgramAnalysis({ program });
    const { destructuringFields: [{ location = {} } = {}] = [] } = analysis;
    const { body: [{ declarations: [{ init: { properties: [{ key = {} } = {}] = [] } = {} } = {}] = [] } = {}] = [] } = program;

    deepStrictEqual(structuredClone(program), pristine);
    deepStrictEqual(location, { range: [9, 16], line: 2, column: 2 });
    Object.defineProperty(key, 'name', { value: 'missing' });
    strictEqual(analysis.checkDestructuringField({ index: 0 }).status, 'contradiction');
    strictEqual(createProgramAnalysis({ program }).checkDestructuringField({ index: 0 }).status, 'agreement');
});

test('unsupported property ownership retains unknown presence queries', () => {
    [
        'const source = {}; external(source); const { missing } = source;',
        'const { [key]: item, missing } = {};',
        'const { first, missing } = { get first() { return 0; } };',
        'const { missing } = { __proto__: external };'
    ].forEach((source) => {
        const analysis = createAnalysis({ source });
        const { destructuringFields = [] } = analysis;

        destructuringFields.forEach(({ index = -1, name = '' } = {}) => strictEqual(analysis.checkDestructuringField({ index }).status, name === 'first' ? 'agreement' : 'unknown'));
    });
});

test('root-only demand leaves the record layout and all property values uninferred', () => {
    const analysis = createAnalysis({ source: 'const { a } = { a: 42, unused: external };' });
    const work = counter();

    strictEqual(analysis.checkDestructuring({ index: 0, onWork: event => work.onWork(event) }).status, 'agreement');
    strictEqual(work.get('establishment'), 1);
    strictEqual(work.get('field-index-entry'), 0);
    strictEqual(work.get('field-lookup'), 0);
    strictEqual(work.get('literal-classification'), 0);
});

test('field lint consumes host AST evidence and propagates source failures', async () => {
    const engine = new ESLint({ overrideConfigFile: true, overrideConfig: [{
        plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-destructuring': 'error' },
        languageOptions: { parser: { parseForESLint(source, options) {
            return { ast: parse(source.replace('known: 0', 'other: 0'), options) };
        } } }
    }] });
    const [{ messages = [] } = {}] = await engine.lintText('const { known } = { known: 0 };');

    strictEqual(messages.length, 1);
    strictEqual(messages.at(0).messageId, 'missingProperty');

    const program = parse('const { a } = { a: 0 };', { ecmaVersion: 'latest', sourceType: 'module' });
    const { body: [{ declarations: [{ init: { properties: [{ key = {} } = {}] = [] } = {} } = {}] = [] } = {}] = [] } = program;
    const failure = new Error('owned key read failed');

    Object.defineProperty(key, 'name', { get() { throw failure; } });
    throws(() => createProgramAnalysis({ program }), error => error === failure);
});
