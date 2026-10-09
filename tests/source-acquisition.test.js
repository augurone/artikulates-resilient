import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';
import { parse } from 'espree';

import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const linter = new Linter();
const findings = source => linter.verify(source, {
    plugins: { resilient: plugin },
    rules: { 'resilient/signature-contract-property': 'error', 'resilient/signature-contract-operation': 'error' }
});
const fallback = 'const external=()=>({missing:1});';

[
    ['ordinary selection', '{value=external()}', 'value'],
    ['renamed selection', '{value:chosen=external()}', 'chosen'],
    ['static computed selection', '{["value"]:chosen=external()}', 'chosen'],
    ['nested selection', '{nested:{chosen=external()}={}}', 'chosen']
].forEach(([name = '', pattern = '', binding = ''] = []) => test(`a captured ${name} cannot borrow its carrier's closed shape`, () => {
    const source = `${fallback}const ${pattern}={};const read=()=>${binding}.missing;read();`;

    strictEqual(runInNewContext(source), 1);
    deepStrictEqual(findings(source), []);
    const first = createAnalysis({ source });
    const second = createAnalysis({ source });
    const inspect = analysis => analysis.memberAccesses.map(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }));

    second.functions.toReversed().forEach(({ index = -1 } = {}) => second.checkFunction({ index }));
    second.calls.toReversed().forEach(({ index = -1 } = {}) => second.checkCall({ index }));
    const before = inspect(first);
    const [{ missing = false, incomplete = false, evidence = [] } = {}] = before;

    strictEqual(missing, false);
    strictEqual(incomplete, true);
    deepStrictEqual(evidence.map(({ state = '' } = {}) => state), ['unknown']);
    deepStrictEqual(inspect(second), before);
    deepStrictEqual(inspect(first), before);
}));

test('supported destructured primitive capture preserves its own selected family', () => {
    const source = 'const {value}={value:42};const read=()=>typeof value==="number"?[]:"";';
    const analysis = createAnalysis({ source });
    const { functions = [] } = analysis;
    const [{ index = -1 } = {}] = functions;
    const { status = '', fact: { families = [] } = {} } = analysis.checkFunction({ index });

    strictEqual(status, 'agreement');
    deepStrictEqual(families, ['array']);
});

[
    ['direct record', 'const checks={present:value=>!!value};', 'checks', 1],
    ['whole-record alias', 'const checks={present:value=>!!value};const alias=checks;', 'alias', 1],
    ['whole-record alias chain', 'const checks={present:value=>!!value};const alias=checks;const alias2=alias;', 'alias2', 1],
    ['member-selected primitive', 'const checks={present:value=>!!value,selected:0};const alias=checks.selected;', 'alias', 0],
    ['member-selected arrow', 'const checks={present:value=>!!value};const alias=checks.present;', 'alias', 0],
    ['destructured arrow', 'const checks={present:value=>!!value};const {present:alias}=checks;', 'alias', 0],
    ['selected alias chain', 'const checks={present:value=>!!value};const selected=checks.present;const alias=selected;', 'alias', 0],
    ['escaped record', 'const checks={present:value=>!!value};external(checks);', 'checks', 0],
    ['exported record', 'export const checks={present:value=>!!value};', 'checks', 0],
    ['written record', 'const checks={present:value=>!!value};checks.present=external;', 'checks', 0],
    ['receiver-dependent method', 'const checks={present(value){return !!value;}};', 'checks', 0],
    ['late record initialization', '', 'checks', 0]
].forEach(([name = '', declaration = '', receiver = '', expected = 0] = []) => test(`closed record capture retains ${name} ownership`, () => {
    const inspect = `const inspect=(value={})=>${receiver}.present(value)?value.map(Boolean):[];`;
    const source = declaration ? declaration + inspect : inspect + 'const checks={present:value=>!!value};';

    strictEqual(findings(source).length, expected);
}));

test('a supplied unknown value never acquires its declaration fallback', () => {
    const source = `${fallback}const {value=external()}={value:input};const read=()=>value.missing;`;

    deepStrictEqual(findings(source), []);
});

test('record eligibility retains duplicate-writer, accessor and prototype distinctions', () => {
    const cases = [
        ['const checks={present:0,present:value=>!!value};', 1],
        ['const checks={present:value=>!!value,present:0};', 0],
        ['const checks={present:value=>!!value,present:external};', 0],
        ['const checks={get present(){return value=>!!value;}};', 0],
        ['const checks={__proto__:external,present:value=>!!value};', 0]
    ];

    cases.forEach(([declaration = '', expected = 0] = []) => {
        const source = `${declaration}const inspect=(value={})=>checks.present(value)?value.map(Boolean):[];`;

        strictEqual(findings(source).length, expected, declaration);
    });
});

const countHeaders = (context, source, declarationIndex) => {
    const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
    const { body = [] } = program;
    const { declarations: [{ init: { properties = [] } = {} } = {}] = [] } = body.at(declarationIndex);
    const readKind = context.mock.fn(() => 'init');

    properties.forEach(property => Object.defineProperty(property, 'kind', { get: readKind }));
    const analysis = createProgramAnalysis({ program });
    const { destructuringFields = [] } = analysis;

    destructuringFields.forEach(({ index = -1 } = {}) => strictEqual(analysis.checkDestructuringField({ index }).status, 'agreement'));

    return readKind.mock.callCount();
};

[100, 200].forEach(bindings => test(`shared carrier headers are not rescanned for ${bindings} selected bindings`, (context) => {
    const properties = 128;
    const fields = Array.from({ length: properties }, (_, index) => `f${index}:${index}`).join(',');
    const pattern = Array.from({ length: bindings }, (_, index) => `f0:value${index}`).join(',');
    const reads = countHeaders(context, `const {${pattern}}={${fields}};`, 0);

    context.diagnostic(`${reads} property-kind reads`);
    ok(reads <= 32 * (properties + bindings), `${reads} property-kind reads exceeded a broad linear header/binding allowance`);
}));

[100, 200].forEach(properties => test(`aggregate headers are not rescanned for ${properties} stored references`, (context) => {
    const fields = Array.from({ length: properties }, (_, index) => `f${index}:shared`).join(',');
    const reads = countHeaders(context, `const shared={};const aggregate={${fields}};`, 1);

    context.diagnostic(`${reads} property-kind reads`);
    ok(reads <= 32 * properties, `${reads} property-kind reads exceeded a broad linear aggregate allowance`);
}));
