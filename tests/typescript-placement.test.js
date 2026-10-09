import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { annotateCompletedReturnBoundaries } from '../transforms/typescript/lowering/arity-returns.js';
import { compilePlacementDecisions, getPlacementContract, getPlacementSymbol } from '../transforms/typescript/policy/placement.js';
import { collectPlacementEvidence } from '../transforms/typescript/understand/placement-evidence.js';
import { loadModule } from './support/module.js';

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

const evaluate = async (text = '', probe = '') => {
    const { outputText = '' } = typescript.transpileModule(text, {
        compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
    });

    return runInNewContext(probe, { namespace: await loadModule(outputText) });
};
const probes = [
    `const events = []; let current = 2;
    const value = { get amount() { events.push(current); return current; } };
    const result = namespace.repeated(value, () => { events.push('mutate'); current = 9; return 1; });
    JSON.stringify({ result, events });`,
    `const events = []; const failure = {};
    const order = { get compare() { events.push('compare'); return (a, b) => a - b; } };
    const values = { get slice() { events.push('receiver'); throw failure; } };
    try { namespace.sort(order, values); } catch (error) { events.push(error === failure); }
    JSON.stringify(events);`,
    `const events = []; let current = 2;
    const value = { get field() { events.push(current); return current; } };
    const later = namespace.deferred(value, input => input);
    events.push('created'); current = 8;
    JSON.stringify({ result: later(), events });`,
    `const events = []; const failure = {};
    const value = { tag: 'no', get value() { events.push('payload'); throw failure; } };
    const skipped = namespace.selected(value);
    value.tag = 'yes';
    try { namespace.selected(value); } catch (error) { events.push(error === failure); }
    JSON.stringify({ skipped, events });`,
    `JSON.stringify([namespace.exactArrow(), namespace.exactArrow(0), namespace.selected({ tag: 'yes', value: [0, ''] }),
    namespace.selected({ tag: 'no' }), namespace.optional(), namespace.optional(0),
    namespace.required({ callback: value => value + 1 }), namespace.indexed([1, 2], 1)]);`
];
await Promise.all(probes.map(async probe => assert.equal(await evaluate(result.code, probe), await evaluate(code, probe))));
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

// The retired guard-binding mover must never execute. Residual reconstruction
// retains its own compiler factory failure and observable exception identity.
const phaseCode = 'export const run = (input: { value: { field: number } }) => { return input.value.field; };';
const phaseFile = typescript.createSourceFile('phases.ts', phaseCode, typescript.ScriptTarget.ESNext, true);
const phaseProgram = typescript.createProgram(['phases.ts'], options, {
    ...host, getSourceFile: (name, version) => name === 'phases.ts' ? phaseFile : host.getSourceFile(name, version)
});
['', 'residual'].forEach((failedPhase = '') => {
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

    const expected = ['residual'];
    assert.deepEqual(phases, expected);
});

// Exported arity dispatch retains its observable signature and publishes no
// generated metadata or fabricated array-binding agreement.
const arityCode = [
    'export function chain(first: Function, second?: Function): unknown {',
    'switch (arguments.length) { case 1: return first;',
    'case 2: return function(this: unknown) { return second!(first.apply(this, arguments)); }; } }'
].join('\n');
await Promise.all([true, false].map(async (strict) => {
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
        JSON.stringify([namespace.chain(first) === first, namespace.chain(first, value => value * 2).call({ offset: 3 }, 4), namespace.chain.length]);`;
    assert.equal(await evaluate(arityOutput, probe), await evaluate(arityCode, probe));
}));

// Optional source declarations retain absence when the checker omits undefined
// from their types. Nested selectors keep their exact operation scope.
await Promise.all([true, false].map(async (strict) => {
    const selectorCode = [
        'type Protocol = { choose: (receiver: unknown, key: string) => unknown };',
        'export function receive(this: unknown, api: Protocol, key: string, value?: object) {',
        'return api.choose(value === undefined ? this : value, key); }',
        'export const resolve = (value?: number) => value === undefined ? 9 : value;',
        'export function partial<T>(combine: (value: T) => (items: T[]) => T) {',
        'return (value: T, items?: T[]) => (items === undefined ? combine(value) : combine(value)(items)); }'
    ].join('\n');
    const selectorOptions = { ...options, strict };
    const selectorFile = typescript.createSourceFile('selectors.ts', selectorCode, typescript.ScriptTarget.ESNext, true);
    const selectorHost = typescript.createCompilerHost(selectorOptions);
    const selectorProgram = typescript.createProgram(['selectors.ts'], selectorOptions, {
        ...selectorHost, getSourceFile: (name, version) => name === 'selectors.ts' ? selectorFile : selectorHost.getSourceFile(name, version)
    });
    assert.deepEqual(typescript.getPreEmitDiagnostics(selectorProgram), []);
    const selectorResult = createTypeScriptTransformer({ typescript, program: selectorProgram }).transform({ code: selectorCode, fileName: 'selectors.ts' });
    const { diagnostics: selectorDiagnostics = [], code: selectorOutput = '' } = selectorResult;
    assert.deepEqual(selectorDiagnostics, []);
    const selectorEvidence = collectPlacementEvidence({ typescript, sourceFile: selectorFile, checker: selectorProgram.getTypeChecker() });
    const { exactUndefined: selectorFacts = new Set() } = selectorEvidence;
    assert.equal(selectorFacts.size, 3);
    const selectors = [
        `const events = []; const failure = {}; const receiver = { owner: true };
        const api = { get choose() { events.push('get'); return function(value, key) {
            events.push([this === api, value === receiver ? 'receiver' : value, key]); return value; }; } };
        const values = [undefined, null, false, 0, '', { data: true }];
        const answers = values.map(value => namespace.receive.call(receiver, api, 'key', value));
        JSON.stringify({ answers, events, length: namespace.receive.length });`,
        `const failure = {}; const api = { get choose() { throw failure; } };
        let exact = false; try { namespace.receive.call({}, api, 'key', 0); } catch(error) { exact = error === failure; }
        JSON.stringify({ exact });`,
        `const events = []; const failure = {};
        const combine = value => { events.push(['combine', value]); return items => {
            events.push(['items', items]); if(items === null) throw failure; return items; }; };
        const selected = namespace.partial(combine); const outcomes = [];
        for (const items of [undefined, [], null, false, 0, '']) {
            try { const result = selected(3, items); outcomes.push(typeof result === 'function' ? 'partial' : result); }
            catch(error) { outcomes.push(error === failure); }
        }
        JSON.stringify({ outcomes, events, length: selected.length });`,
        `JSON.stringify([namespace.resolve(), namespace.resolve(undefined), namespace.resolve(0), namespace.resolve(false), namespace.resolve(''), namespace.resolve(null)]);`
    ];
    await Promise.all(selectors.map(async probe => assert.equal(await evaluate(selectorOutput, probe), await evaluate(selectorCode, probe))));
    const selectorConfig = { plugins: { resilient }, rules: { 'resilient/no-undefined-comparison': 'error' },
        linterOptions: { reportUnusedDisableDirectives: false } };
    assert.deepEqual(linter.verify(selectorOutput, selectorConfig), []);
    const fixed = linter.verifyAndFix(selectorOutput, { ...selectorConfig,
        rules: { ...resilient.configs.recommended.rules, ...resilient.configs.contracts.rules, ...resilient.configs.safety.rules } });
    const { messages: fixedMessages = [], output: fixedOutput = '' } = fixed;
    assert.equal(fixedMessages.filter(({ severity = 0 } = {}) => severity === 2).length, 0);
    await Promise.all(selectors.map(async probe => assert.equal(await evaluate(fixedOutput, probe), await evaluate(selectorCode, probe))));

    const rejectionCode = 'export function compare(value: unknown, undefined: unknown) { return value === undefined; }';
    const rejectionFile = typescript.createSourceFile('reject.ts', rejectionCode, typescript.ScriptTarget.ESNext, true);
    const rejectionProgram = typescript.createProgram(['reject.ts'], selectorOptions, {
        ...selectorHost, getSourceFile: (name, version) => name === 'reject.ts' ? rejectionFile : selectorHost.getSourceFile(name, version)
    });
    const rejected = collectPlacementEvidence({ typescript, sourceFile: rejectionFile, checker: rejectionProgram.getTypeChecker() });
    const { exactUndefined: rejectedFacts = new Set() } = rejected;
    assert.equal(rejectedFacts.size, 0, 'Shadowed undefined supplies no native absence evidence.');

    const mixedCode = 'export function combine(value?: object) { return [value === undefined ? {} : value, (1 as unknown) === undefined]; }';
    const mixedFile = typescript.createSourceFile('mixed.ts', mixedCode, typescript.ScriptTarget.ESNext, true);
    const mixedProgram = typescript.createProgram(['mixed.ts'], selectorOptions, {
        ...selectorHost, getSourceFile: (name, version) => name === 'mixed.ts' ? mixedFile : selectorHost.getSourceFile(name, version)
    });
    const mixedPlacement = compilePlacementDecisions({ typescript, evidence: collectPlacementEvidence({
        typescript, sourceFile: mixedFile, checker: mixedProgram.getTypeChecker()
    }) });
    // Test this placement owner directly so another grammar pass cannot erase
    // the deliberately unrelated selector before the scope falsifier observes it.
    const { transformed: [mixedTree = {}] = [] } = typescript.transform(mixedFile, [context => root => annotateCompletedReturnBoundaries({
        typescript, sourceFile: root, placement: mixedPlacement, context
    })]);
    const printed = typescript.createPrinter().printFile(mixedTree);
    const { outputText: mixedOutput = '' } = typescript.transpileModule(printed, {
        compilerOptions: { target: typescript.ScriptTarget.ESNext }
    });
    const mixedFindings = linter.verify(mixedOutput, selectorConfig);
    assert.equal(mixedFindings.length, 1, 'The nested boundary must leave an unrelated sibling comparison visible.');
    const [{ ruleId: mixedRule = '' } = {}] = mixedFindings;
    assert.equal(mixedRule, 'resilient/no-undefined-comparison');
}));
