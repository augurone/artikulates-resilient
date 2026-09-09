import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

import typescript from 'typescript';

import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import {
    collectExactProjectionContracts,
    collectProviderForwardContracts
} from '../transforms/typescript/understand/type-evidence.js';

// Each row crosses checker admission and the public placement path. The two
// actions share a field-forwarding grammar constructor, not a source law.
const cases = [
    { name: 'projection-array', projection: 1,
        code: 'export const use = (items: Array<{ value: number }>) => items.map(item => item.value);' },
    { name: 'projection-readonly', projection: 1,
        code: 'export const use = (items: ReadonlyArray<{ value: number }>) => items.map(item => item.value);' },
    { name: 'projection-tuple', projection: 1,
        code: 'export const use = (items: [{ value: number }]) => items.map(item => item.value);' },
    { name: 'projection-rest', projection: 1,
        code: 'export function use(...items: Array<{ value: number }>) { return items.map(item => item.value); }' },
    { name: 'projection-optional-type',
        code: 'export const use = (items: Array<{ value?: number }>) => items.map(item => item.value);' },
    { name: 'projection-optional-member',
        code: 'export const use = (items: Array<{ value: number }>) => items.map(item => item?.value);' },
    { name: 'projection-optional-receiver',
        code: 'export const use = (items: Array<{ value: number }>) => items?.map(item => item.value);' },
    { name: 'projection-optional-call',
        code: 'export const use = (items: Array<{ value: number }>) => items.map?.(item => item.value);' },
    { name: 'projection-custom-collection',
        code: 'export const use = (items: { map: (f: (item: { value: number }) => number) => number[] }) => items.map(item => item.value);' },
    { name: 'projection-unknown-collection',
        code: 'export const use = (items: any) => items.map((item: { value: number }) => item.value);' },
    { name: 'projection-other-method',
        code: 'export const use = (items: Array<{ value: number }>) => items.filter(item => item.value > 0);' },
    { name: 'projection-block-body',
        code: 'export const use = (items: Array<{ value: number }>) => items.map(item => { return item.value; });' },
    { name: 'projection-conditional-body',
        code: 'export const use = (items: Array<{ value: number }>) => items.map(item => item.value ? item.value : 0);' },
    { name: 'projection-extra-argument',
        code: 'export const use = (items: Array<{ value: number }>) => items.map(item => item.value, null);' },
    { name: 'projection-two-parameters',
        code: 'export const use = (items: Array<{ value: number }>) => items.map((item, index) => item.value);' },
    { name: 'projection-computed-field',
        code: 'export const use = (items: Array<{ value: number }>) => items.map(item => item["value"]);' },
    { name: 'projection-computed-method',
        code: 'export const use = (items: Array<{ value: number }>) => items["map"](item => item.value);' },
    { name: 'projection-function-callback',
        code: 'export const use = (items: Array<{ value: number }>) => items.map(function(item) { return item.value; });' },
    { name: 'projection-same-spelled-neighbor', projection: 1,
        code: 'export const use = (items: Array<{ value: number }>) => [items.map(item => item.value), items.map(item => { return item.value; })];' },
    { name: 'forward-direct', forwarded: 1,
        code: 'export function use(P: { call: (value: number) => number }) { return { call: P.call }; }' },
    { name: 'forward-parenthesized-record', forwarded: 1,
        code: 'export function use(P: { call: (value: number) => number }) { return ({ call: P.call }); }' },
    { name: 'forward-two-fields', forwarded: 2,
        code: 'export function use(P: { left: (value: number) => number; right: (value: number) => number }) { return { left: P.left, right: P.right }; }' },
    { name: 'forward-optional-syntax',
        code: 'export function use(P: { call: (value: number) => number }) { return { call: P?.call }; }' },
    { name: 'forward-optional-type',
        code: 'export function use(P: { call?: (value: number) => number }) { return { call: P.call }; }' },
    { name: 'forward-noncallable',
        code: 'export function use(P: { value: number }) { return { value: P.value }; }' },
    { name: 'forward-invoked',
        code: 'export function use(P: { call: (value: number) => number }) { return { call: P.call(1) }; }' },
    { name: 'forward-direct-return',
        code: 'export function use(P: { call: (value: number) => number }) { return P.call; }' },
    { name: 'forward-indirect-record',
        code: 'export function use(P: { call: (value: number) => number }) { const record = { call: P.call }; return record; }' },
    { name: 'forward-expression-arrow',
        code: 'export const use = (P: { call: (value: number) => number }) => ({ call: P.call });' },
    { name: 'forward-parenthesized-member',
        code: 'export function use(P: { call: (value: number) => number }) { return { call: (P.call) }; }' },
    { name: 'forward-computed-property',
        code: 'export function use(P: { call: (value: number) => number }) { return { ["call"]: P.call }; }' },
    { name: 'forward-computed-member',
        code: 'export function use(P: { call: (value: number) => number }) { return { call: P["call"] }; }' },
    { name: 'forward-same-spelled-neighbor', forwarded: 1,
        code: 'export function use(P: { call: (value: number) => number }) { const inner = { call: P.call }; return { call: P.call, inner }; }' }
];
const sources = new Map(cases.map(({ name = '', code = '' } = {}) => [
    `${name}.ts`, typescript.createSourceFile(`${name}.ts`, code, typescript.ScriptTarget.ESNext, true)
]));
const options = { strict: true, target: typescript.ScriptTarget.ESNext };
const host = typescript.createCompilerHost(options);
const program = typescript.createProgram([...sources.keys()], options, {
    ...host,
    getSourceFile: (name, version) => sources.get(name) || host.getSourceFile(name, version)
});
const checker = program.getTypeChecker();
const { transform = false } = createTypeScriptTransformer({ typescript, program });

cases.forEach(({ name = '', code = '', projection = 0, forwarded = 0 } = {}) => {
    const fileName = `${name}.ts`;
    const sourceFile = sources.get(fileName);
    const projectionFacts = collectExactProjectionContracts({ typescript, sourceFile, checker });
    const forwardFacts = collectProviderForwardContracts({ typescript, sourceFile, checker });
    const { diagnostics = [], agreements = [] } = transform({ code, fileName });
    const actions = agreements.map(({ action = '' } = {}) => action);

    assert.equal(projectionFacts.size, projection, `${name}: projection checker fact`);
    assert.equal(forwardFacts.size, forwarded, `${name}: forwarding checker fact`);
    assert.equal(collectExactProjectionContracts({ typescript, sourceFile }).size, 0,
        `${name}: projection requires a checker`);
    assert.equal(collectProviderForwardContracts({ typescript, sourceFile }).size, 0,
        `${name}: forwarding requires a checker`);
    assert.deepEqual(diagnostics, [], `${name}: compiler diagnostics`);
    assert.equal(actions.filter(action => action === 'exact-callback-projected').length,
        projection, `${name}: exact projection placement`);
    assert.equal(actions.filter(action => action === 'provider-forwarded').length,
        forwarded, `${name}: provider forwarding placement`);
});

const [{ code: twoFieldSource = '' } = {}] = cases.filter(({ name = '' } = {}) => name === 'forward-two-fields');
const { code: twoFieldTarget = '' } = transform({ code: twoFieldSource, fileName: 'forward-two-fields.ts' });
const execute = (code = '') => {
    const { outputText = '' } = typescript.transpileModule(code, {
        compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ESNext }
    });
    const exports = {};

    runInNewContext(outputText, { exports });

    const { use = false } = exports;

    return use;
};
const observeForwarding = (code = '') => {
    const use = execute(code);
    const left = value => value;
    const right = value => value;
    const failure = new Error('second getter');
    let events = [];
    const present = use({
        get left() {
            events = [...events, 'left'];

            return left;
        },
        get right() {
            events = [...events, 'right'];

            return right;
        }
    });
    const { left: presentLeft = false, right: presentRight = false } = present;
    const absent = use({});
    const identity = presentLeft === left && presentRight === right;
    const missing = Object.is(Reflect.get(absent, 'left'), void 0) &&
        Object.is(Reflect.get(absent, 'right'), void 0);
    let abruptIdentity = false;

    try {
        use({ get left() {
            events = [...events, 'left'];

            return left;
        }, get right() {
            events = [...events, 'throw'];

            throw failure;
        } });
    } catch (error) {
        abruptIdentity = error === failure;
    }

    return { identity, missing, abruptIdentity, events };
};

assert.deepEqual(observeForwarding(twoFieldSource), {
    identity: true,
    missing: true,
    abruptIdentity: true,
    events: ['left', 'right', 'left', 'throw']
});
assert.deepEqual(observeForwarding(twoFieldTarget), observeForwarding(twoFieldSource));
