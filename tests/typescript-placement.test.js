import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { compilePlacementDecisions, getPlacementContract, getPlacementSymbol } from '../transforms/typescript/policy/placement.js';
import { collectPlacementEvidence } from '../transforms/typescript/understand/placement-evidence.js';

const code = [
    'type Order = { compare: (a: number, b: number) => number };',
    'type Selected = { tag: "yes"; value: [number, string] } | { tag: "no" };',
    'export function sort(order: Order, values: number[]) { return values.slice().sort(order.compare); }',
    'export const repeated = (value: { amount: number }, mutate: () => number) => value.amount + mutate() + value.amount;',
    'export const selected = (value: Selected) => value.tag === "yes" ? value.value[0] : 0;',
    'export function required({ callback }: { callback: (value: number) => number }) { return callback(2); }',
    'export function optional(value?: number) { return value === undefined ? 7 : value; }',
    'export const deferred = <T>(value: { field: T }, consume: (input: T) => T) => () => consume(value.field);',
    'export const exactArrow = (value?: number) => value !== undefined ? value : 9;',
    'export const indexed = (values: number[], index: number) => { const value = values[index]; return value; };'
].join('\n');
const fileName = 'placement.ts';
const file = typescript.createSourceFile(fileName, code, typescript.ScriptTarget.ESNext, true);
const options = { strict: true, target: typescript.ScriptTarget.ESNext };
const host = typescript.createCompilerHost(options);
const program = typescript.createProgram([fileName], options, {
    ...host, getSourceFile: (name, version) => name === fileName ? file : host.getSourceFile(name, version)
});
let placing = false;
let sourceQueries = 0;
let transformations = 0;
const checker = new Proxy(program.getTypeChecker(), { get(target = {}, key = '') {
    const value = Reflect.get(target, key);

    if (typeof value !== 'function') return value;

    return (...args) => {
        assert.equal(placing, false, `Placement queried TypeChecker.${String(key)}`);
        sourceQueries += 1;

        return Reflect.apply(value, target, args);
    };
} });
const compiler = { ...typescript, transform: (...args) => {
    placing = true;
    transformations += 1;

    return typescript.transform(...args);
} };
const transformer = createTypeScriptTransformer({ typescript: compiler,
    program: { ...program, getTypeChecker: () => checker } });
const result = transformer.transform({ code, fileName });
assert.deepEqual(result.diagnostics, []);
assert.ok(sourceQueries > 0);
assert.ok(transformations > 0);

const evaluate = (text = '', probe = '') => {
    const { outputText = '' } = typescript.transpileModule(text, {
        compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.CommonJS }
    });

    return runInNewContext(`${outputText}\n${probe}`, { exports: {} });
};
const probes = [
    `const events = []; let current = 2;
    const value = { get amount() { events.push(current); return current; } };
    const result = exports.repeated(value, () => { events.push('mutate'); current = 9; return 1; });
    JSON.stringify({ result, events });`,
    `const events = []; const failure = {};
    const order = { get compare() { events.push('compare'); return (a, b) => a - b; } };
    const values = { get slice() { events.push('receiver'); throw failure; } };
    try { exports.sort(order, values); } catch (error) { events.push(error === failure); }
    JSON.stringify(events);`,
    `const events = []; let current = 2;
    const value = { get field() { events.push(current); return current; } };
    const later = exports.deferred(value, input => input);
    events.push('created'); current = 8;
    JSON.stringify({ result: later(), events });`,
    `const events = []; const failure = {};
    const value = { tag: 'no', get value() { events.push('payload'); throw failure; } };
    const skipped = exports.selected(value);
    value.tag = 'yes';
    try { exports.selected(value); } catch (error) { events.push(error === failure); }
    JSON.stringify({ skipped, events });`,
    `JSON.stringify([exports.exactArrow(), exports.exactArrow(0), exports.selected({ tag: 'yes', value: [0, ''] }),
    exports.selected({ tag: 'no' }), exports.optional(), exports.optional(0),
    exports.required({ callback: value => value + 1 }), exports.indexed([1, 2], 1)]);`
];
probes.forEach(probe => assert.equal(evaluate(result.code, probe), evaluate(code, probe)));
const linter = new Linter();
assert.deepEqual(linter.verify(result.code, { plugins: { resilient },
    rules: { 'resilient/no-undefined-comparison': 'error' },
    linterOptions: { reportUnusedDisableDirectives: false } }), [], 'Exact selectors receive their rule-specific boundary after reconstruction.');

const evidence = collectPlacementEvidence({ typescript, sourceFile: file, checker: program.getTypeChecker() });
const placement = compilePlacementDecisions({ typescript, evidence });
const { facts = new Map() } = placement;
const [read = {}] = [...facts.keys()].filter(node => typescript.isPropertyAccessExpression(node) &&
    node.getText(file) === 'value.amount');
const original = getPlacementContract({ typescript, placement, node: read });
assert.equal(original.kind, 'number');
const clone = typescript.factory.updatePropertyAccessExpression(read, typescript.factory.createIdentifier('value'), 'amount');
assert.equal(getPlacementContract({ typescript, placement, node: clone }), original);
assert.equal(getPlacementSymbol({ typescript, placement, node: clone }), getPlacementSymbol({ typescript, placement, node: read }));
const separate = typescript.createSourceFile(fileName, code, typescript.ScriptTarget.ESNext, true);
let otherRead;
const find = (node = {}) => {
    if (typescript.isPropertyAccessExpression(node) && node.getText(separate) === 'value.amount') otherRead = node;

    typescript.forEachChild(node, find);
};
find(separate);
assert.deepEqual(getPlacementContract({ typescript, placement, node: otherRead }), {},
    'Matching filenames and ranges cannot borrow another source identity.');
assert.deepEqual(getPlacementContract({ typescript, placement, node: typescript.factory.createIdentifier('amount') }), {});

// Guard and residual placement share compiler utilities but own distinct
// failure phases. Removing the first guard visit moves a native factory Get
// behind residual construction, even when the printed JavaScript is equal.
const phaseCode = 'export const run = (input: { value: { field: number } }) => { return input.value.field; };';
const phaseFile = typescript.createSourceFile('phases.ts', phaseCode, typescript.ScriptTarget.ESNext, true);
const phaseProgram = typescript.createProgram(['phases.ts'], options, {
    ...host, getSourceFile: (name, version) => name === 'phases.ts' ? phaseFile : host.getSourceFile(name, version)
});
['', 'guard', 'residual'].forEach((failedPhase = '') => {
    let phases = [];
    const failure = new Error('placement factory Get');
    const factory = new Proxy(typescript.factory, { get(target = {}, key = '') {
        const stack = Reflect.get(new Error(), 'stack');
        const [phase = ''] = [['guard', 'lowering/guarded-bindings.js'], ['residual', 'members/residual.js']]
            .find(([, file = ''] = []) => stack.includes(file)) || [];
        const [last = ''] = phases.slice(-1);

        if (phase && phase !== last) phases = [...phases, phase];

        if (phase && phase === failedPhase) throw failure;

        return Reflect.get(target, key);
    } });
    const execute = () => createTypeScriptTransformer({ typescript: { ...typescript, factory }, program: phaseProgram })
        .transform({ code: phaseCode, fileName: 'phases.ts' });

    if (failedPhase) assert.throws(execute, error => error === failure);

    if (!failedPhase) execute();

    const { [failedPhase]: expected = [] } = { guard: ['guard'], residual: ['guard', 'residual'], '': ['guard', 'residual', 'guard'] };
    assert.deepEqual(phases, expected);
});

// Exported arity dispatch retains its observable signature and publishes no
// generated metadata or fabricated array-binding agreement.
const arityCode = [
    'export function chain(first: Function, second?: Function): unknown {',
    'switch (arguments.length) { case 1: return first;',
    'case 2: return function(this: unknown) { return second!(first.apply(this, arguments)); }; } }'
].join('\n');
[true, false].forEach((strict) => {
    const arityOptions = { ...options, strict };
    const arityHost = typescript.createCompilerHost(arityOptions);
    const arityFile = typescript.createSourceFile('arity-report.ts', arityCode, typescript.ScriptTarget.ESNext, true);
    const arityProgram = typescript.createProgram(['arity-report.ts'], arityOptions, {
        ...arityHost, getSourceFile: (name, version) => name === 'arity-report.ts' ? arityFile : arityHost.getSourceFile(name, version)
    });
    const { code: arityOutput = '', diagnostics: arityDiagnostics = [], agreements: arityReports = [] }
        = createTypeScriptTransformer({ typescript, program: arityProgram }).transform({ code: arityCode, fileName: 'arity-report.ts' });
    assert.deepEqual(arityDiagnostics, []);
    assert.deepEqual(arityReports, []);
    assert.match(arityOutput, /export function chain\(first, second\)/u);
    assert.doesNotMatch(arityOutput, /_resilientArgs|Object\.defineProperty\(chain/u);
    const probe = `const first = function(value) { return this.offset + value; };
        JSON.stringify([exports.chain(first) === first, exports.chain(first, value => value * 2).call({ offset: 3 }, 4), exports.chain.length]);`;
    assert.equal(evaluate(arityOutput, probe), evaluate(arityCode, probe));
});
