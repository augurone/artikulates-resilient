import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { ESLint, Linter } from 'eslint';

import plugin from 'eslint-plugin-resilient/eslint';

const rule = 'resilient/no-falsifiable-property-key';
const sources = [
    ["const value = { '': 7 };", 17],
    ["const value = { ['']: 7 };", 18],
    ['const value = { 0: 7 };', 17],
    ['const value = { [0]: 7 };', 18],
    ['const value = { [-0]: 7 };', 18],
    ['const value = { [+0]: 7 };', 18],
    ['const value = { 0n: 7 };', 17],
    ['const value = { [0n]: 7 };', 18],
    ['const value = { [-0n]: 7 };', 18],
    ['const value = { [0x0n]: 7 };', 18],
    ["const value = { '0': 7 };", 17],
    ['const value = { [`0`]: 7 };', 18],
    ['const value = { [`false`]: 7 };', 18],
    ['const value = { [`null`]: 7 };', 18],
    ['const value = { [`undefined`]: 7 };', 18],
    ['const value = { [`\\x30`]: 7 };', 18],
    ["const value = { 'false': 7 };", 17],
    ['const value = { undefined: 7 };', 17],
    ['const value = { false: 7 };', 17],
    ['const value = { [null]: 7 };', 18],
    ['const value = { [[]]: 7 };', 18],
    ['const value = { [{}]: 7 };', 18],
    ["const { '': value } = input;", 9],
    ["input[''];", 7],
    ['input[false];', 7],
    ['input[null];', 7],
    ['input[undefined];', 7],
    ['input[void 0];', 7],
    ['input[``];', 7],
    ['input[`false`];', 7],
    ['input.false;', 7],
    ['input.null;', 7],
    ['input.undefined;', 7],
    ["import { '' as value } from './source.js';", 10],
    ["export { '' as value } from './source.js';", 10],
    ["export * as '' from './source.js';", 13],
    ["const value = 7; export { value as '' };", 36]
];

sources.forEach(([source = '', column = 0] = []) => test(`falsifiable property key is rejected: ${source}`, () => {
    const messages = new Linter().verify(source, { plugins: { resilient: plugin }, rules: { [rule]: 'error' } });

    deepStrictEqual(messages.map(({ ruleId = '', messageId = '', column = 0 } = {}) => ({ ruleId, messageId, column })),
        [{ ruleId: rule, messageId: 'falsifiableKey', column }]);
}));

test('native positions, collection keys and ordinary empty values remain valid', async () => {
    const source = [
        'const values = [7];',
        "const lookup = new Map([[0, 'value']]);",
        'const selected = new Set([0]);',
        'const { [0]: first = 0 } = values;',
        'const { [0n]: bigFirst = 0, [-0n]: signedFirst = 0 } = values;',
        'const bigLookup = new Map([[0n, 7]]);',
        'const bigSelected = new Set([0n]);',
        'const positions = [values[0], values[0n], values[-0n], values[`0`]];',
        "export const result = { first, bigFirst, signedFirst, positions, mapped: lookup.get(0), selected: selected.has(0), empty: '', count: 0, enabled: false,",
        '    bigMapped: bigLookup.get(0n), bigSelected: bigSelected.has(0n) };',
        ''
    ].join('\n');
    const { execPath = '' } = process;
    const { status = -1 } = spawnSync(execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 5000 });
    const [{ messages = [] } = {}] = await new ESLint().lintText(source, { filePath: 'tests/fixtures/falsifiable-key-case.js' });

    strictEqual(status, 0);
    deepStrictEqual(messages, []);
});

test('dynamic keys stay unknown and a shadowed undefined is not native absence', () => {
    const source = 'const { 0: positional = 0, 0n: bigPosition = 0 } = input; const read = (key, undefined) => [input[key], input[undefined], input[0], input[-0], input["0"]];';
    const messages = new Linter().verify(source, { plugins: { resilient: plugin }, rules: { [rule]: 'error' } });

    deepStrictEqual(messages, []);
});

test('zero property spelling agrees with native keys while nonzero neighbors remain valid', async () => {
    const keys = ['0', '[+0]', '[-0]', '0n', '[0n]', '[-0n]', '[0x0n]', "'0'", '[`0`]'];
    const source = `console.log(JSON.stringify([${keys.map(key => `Object.keys({ ${key}: 7 })`).join(',')} ]));`;
    const { execPath = '' } = process;
    const { status = -1, stdout = '' } = spawnSync(execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 5000 });

    strictEqual(status, 0);
    deepStrictEqual(JSON.parse(stdout), keys.map(() => ['0']));
    const neighbor = 'const value = { 1: 7, [2n]: 7, [-1n]: 7, [`named`]: 7 };\n\nexport { value };\n';
    const [{ messages = [] } = {}] = await new ESLint().lintText(neighbor, { filePath: 'tests/fixtures/falsifiable-key-case.js' });

    deepStrictEqual(messages, []);
    const { status: neighborStatus = -1, stdout: neighborKeys = '' } = spawnSync(execPath,
        ['--input-type=module', '-e', `${neighbor}console.log(JSON.stringify(Object.keys(value)));`], { encoding: 'utf8', timeout: 5000 });

    strictEqual(neighborStatus, 0);
    deepStrictEqual(JSON.parse(neighborKeys), ['1', '2', '-1', 'named']);
    deepStrictEqual(new Linter().verify('const value = { [`${key}`]: 7 };', { plugins: { resilient: plugin }, rules: { [rule]: 'error' } }), []);
});

test('unary plus on BigInt fails before a property name exists', () => {
    const source = 'const value = { [+0n]: 7 };';
    const { execPath = '' } = process;
    const { status = -1, stderr = '' } = spawnSync(execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 5000 });

    strictEqual(status, 1);
    strictEqual(stderr.includes('TypeError'), true);
    deepStrictEqual(new Linter().verify(source, { plugins: { resilient: plugin }, rules: { [rule]: 'error' } }), []);
});

test('local export bindings are distinct from exported and re-exported names', () => {
    const cases = [
        ['const undefined = 7; export { undefined as result };', []],
        ["const undefined = 7; export { undefined as 'result' };", []],
        ["import { value as undefined } from './source.js'; export { undefined as result };", []],
        ["import { undefined as value } from './source.js';", [10]],
        ['const value = 7; export { value as undefined };', [36]],
        ['const undefined = 7; export { undefined };', [31]],
        ["export { undefined as result } from './source.js';", [10]],
        ["export { value as undefined } from './source.js';", [19]],
        ["export * as undefined from './source.js';", [13]],
        ["export * from './source.js';", []]
    ];

    cases.forEach(([source = '', columns = []] = []) => {
        const messages = new Linter().verify(source, { plugins: { resilient: plugin }, rules: { [rule]: 'error' } });

        deepStrictEqual(messages.map(({ ruleId = '', column = 0 } = {}) => ({ ruleId, column })), columns.map(column => ({ ruleId: rule, column })), source);
    });
});

test('a renamed local undefined export retains its runtime value and configured policy', async () => {
    const source = [
        '// eslint-disable-next-line no-shadow-restricted-names -- This regression distinguishes a local binding named undefined from a module property name.',
        'const undefined = 7;',
        '',
        'export { undefined as result };',
        ''
    ].join('\n');
    const url = `data:text/javascript,${encodeURIComponent(source)}`;
    const { execPath = '' } = process;
    const { status = -1, stdout = '' } = spawnSync(execPath, ['--input-type=module', '-e', `const { result } = await import(${JSON.stringify(url)}); console.log(result);`],
        { encoding: 'utf8', timeout: 5000 });
    const [{ messages = [] } = {}] = await new ESLint().lintText(source, { filePath: 'tests/fixtures/falsifiable-key-case.js' });

    strictEqual(status, 0);
    strictEqual(stdout.trim(), '7');
    deepStrictEqual(messages, []);
});
