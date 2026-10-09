import assert from 'node:assert/strict';

import { Linter } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { getObject } from '../rules/support/object.js';
import { annotateFinalExceptions } from '../transforms/typescript/grammar/final.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { getDestructuringDecisionForNode } from '../transforms/typescript/policy/destructuring-agreements.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import {
    collectTypedIgnoredArgumentCallContracts,
    getConsumerContractKey
} from '../transforms/typescript/understand/type-evidence.js';

const extraReason = 'checker-resolved authored callable accepts arguments beyond the source implementation formals';
const binary = 'const apply: (first: number, second: number) => number = first => first;';
const cases = [
    { name: 'nonzero', code: `${binary} const result = apply(1, 2);`, count: 1 },
    { name: 'zero', code: 'const apply: (value: number) => number = () => 7; const result = apply(1);', count: 1, zero: true },
    { name: 'renamed', code: 'const other: (first: number, second: number) => number = first => first; const result = other(1, 2);', count: 1 },
    { name: 'function-expression', code: 'const apply: (first: number, second: number) => number = function (first) { return first; }; const result = apply(1, 2);', count: 1 },
    { name: 'generic-curried', code: [
        'const convert: <A, B, C>(first: (value: A) => B, ignored: (value: C) => C) => (value: A) => B = first => value => first(value);',
        'const result = convert((value: number) => value + 1, (value: string) => value);'
    ].join('\n'), count: 1 },
    { name: 'local-forward', code: `${binary} const forwarded: (first: number, second: number) => number = apply; const result = forwarded(1, 2);`, count: 1 },
    { name: 'imported-forward', code: 'import { apply as renamed } from "./provider"; const result = renamed(1, 2);', count: 1 },
    { name: 'namespace-forward', code: [
        'import * as Provider from "./provider";',
        'const forwarded: (first: number, second: number) => number = Provider.apply; const result = forwarded(1, 2);'
    ].join('\n'), count: 1 },
    { name: 'ordinary-recursive', code: 'const go = (first: number, second: number): number => first ? go(first - 1, second) : second; const result = go(2, 3);' },
    { name: 'plain-wrong-arity', code: 'const bimap = (value: number) => value; const result = bimap(1, 2);' },
    { name: 'plain-missing-arity', code: 'const go = (first: number, second: number, third: number) => third; const result = go(1, 2);' },
    { name: 'wrong-value', code: `${binary} const result = apply("wrong", 2);` },
    { name: 'same-spelled-wrong-value', code: 'const bimap: (first: number, second: number) => number = first => first; const result = bimap("wrong", 2);' },
    { name: 'typed-too-many', code: `${binary} const result = apply(1, 2, 3);` },
    { name: 'typed-too-few', code: `${binary} const result = apply();` },
    { name: 'equal-implementation', code: 'const bimap: (first: number, second: number) => number = (first, second) => first + second; const result = bimap(1, 2);' },
    { name: 'spread', code: `${binary} const values: [number, number] = [1, 2]; const result = apply(...values);` },
    { name: 'optional-call', code: `${binary} const result = apply?.(1, 2);` },
    { name: 'member-call', code: 'const api = { bimap: (value: number) => value }; const result = api.bimap(1, 2);' },
    { name: 'unknown-implementation', code: 'declare const bimap: (first: number, second: number) => number; const result = bimap(1, 2);' },
    { name: 'unresolved', code: 'const result = go(1, 2);' },
    { name: 'rest-implementation', code: 'const apply: (first: number, second: number) => number = (...values) => values[0]; const result = apply(1, 2);' },
    { name: 'cyclic-forwarding', code: 'const first: (left: number, right: number) => number = second; const second: (left: number, right: number) => number = first; const result = first(1, 2);' },
    { name: 'shadowed-owner', code: `${binary} function read() { const apply = (first: number, second: number) => first + second; return apply(1, 2); }` }
];
const traces = [
    { name: 'normal', declaration: binary, probe: 'apply(mark(1), mark(2))' },
    { name: 'argument-failure', declaration: binary, probe: 'apply(mark(1), mark(-1))' },
    { name: 'implementation-failure', declaration: 'const apply: (first: number, second: number) => number = first => { events = [...events, "call"]; throw failure; };',
        probe: 'apply(mark(1), mark(2))' },
    { name: 'identity', declaration: 'const apply: (first: object, second: number) => object = first => first; const token = {};',
        probe: 'apply(token, mark(2)) === token' },
    { name: 'arity', declaration: binary, probe: '[apply.length, apply(mark(1), mark(2)), apply.length]' },
    { name: 'returned-callable', declaration: 'const apply: (first: number, second: number) => (value: number) => number = first => value => first + value;',
        probe: '(() => { const later = apply(mark(1), mark(2)); return [later.length, later(mark(3))]; })()' },
    { name: 'guarded-skip', declaration: `${binary} const read = (ready: boolean) => ready ? apply(mark(1), mark(2)) : 0;`, probe: 'read(false)' },
    { name: 'guarded-selected', declaration: `${binary} const read = (ready: boolean) => ready ? apply(mark(1), mark(2)) : 0;`, probe: 'read(true)' },
    { name: 'deferred', declaration: `${binary} const read = () => () => apply(mark(1), mark(2));`,
        probe: '(() => { const later = read(); const before = events.length; return [before, later()]; })()' },
    { name: 'callee-before-arguments', declaration: [
        'let apply: (first: number, second: number) => number = first => first;',
        'const replace = () => { events = [...events, "replace"]; apply = (first, second) => second; return 1; };'
    ].join('\n'), probe: 'apply(replace(), mark(2))' },
    { name: 'native-call-failure', declaration: 'let apply: (first: number, second: number) => number = first => first; const clear = () => { apply = null as any; }; clear();',
        probe: 'apply(mark(1), mark(2))' },
    { name: 'ordinary-recursive', declaration: 'const go = (first: number, second: number): number => first ? go(first - 1, second) : second;',
        probe: 'go(mark(2), mark(3))' }
];
const prefix = '/virtual/final-call/';
const sources = new Map([
    ['provider', `export ${binary}`],
    ...cases.map(({ name = '', code = '' } = {}) => [name, `export {};\n${code}`]),
    ...traces.map(({ name = '', declaration = '', probe = '' } = {}) => [`trace-${name}`, [
        'export {}; let events: (number | string)[] = []; const failure = new Error("failure");',
        'const mark = (value: number) => { events = [...events, value]; if (value < 0) throw failure; return value; };',
        declaration,
        `export const exercise = () => (${probe});`
    ].join('\n')])
].map(([name = '', code = ''] = []) => [`${prefix}${name}.ts`, typescript.createSourceFile(`${prefix}${name}.ts`, code, typescript.ScriptTarget.ESNext, true)]));
const compilerOptions = { strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext };
const compilerHost = typescript.createCompilerHost(compilerOptions);
const program = typescript.createProgram([...sources.keys()], compilerOptions, {
    ...compilerHost,
    directoryExists: directory => directory === prefix.slice(0, -1) || compilerHost.directoryExists(directory),
    fileExists: name => sources.has(name) || compilerHost.fileExists(name),
    getSourceFile: (name, version) => sources.get(name) || compilerHost.getSourceFile(name, version)
});
const checker = program.getTypeChecker();
const factsFor = (sourceFile = {}) => collectTypedIgnoredArgumentCallContracts({ typescript, sourceFile, checker });
cases.forEach(({ name = '', count = 0, zero = false } = {}) => {
    const sourceFile = sources.get(`${prefix}${name}.ts`);
    const contracts = factsFor(sourceFile);
    assert.equal(contracts.size, count, name);
    const agreements = collectDestructuringAgreements({ typedIgnoredArgumentCallContracts: contracts });
    const before = [...agreements];
    const visit = (node = {}) => {
        typescript.forEachChild(node, visit);

        if (!typescript.isCallExpression(node)) return;

        const { agreement: { action = '' } = {} } = getDestructuringDecisionForNode({
            typescript, node, destructuringAgreements: compileDestructuringDecisions(agreements), kinds: ['typed-ignored-argument-call']
        });
        const admitted = ['retain-typed-ignored-argument-call', 'retain-typed-extra-argument-call'].includes(action);
        assert.equal(admitted, contracts.has(getConsumerContractKey(node)), name);

        if (admitted) assert.equal(action, zero ? 'retain-typed-ignored-argument-call' : 'retain-typed-extra-argument-call');
    };
    visit(sourceFile);
    assert.deepEqual([...agreements], before);
});
assert.equal(collectTypedIgnoredArgumentCallContracts({ typescript, sourceFile: sources.get(`${prefix}nonzero.ts`) }).size, 0);

const sourceFile = sources.get(`${prefix}nonzero.ts`);
const facts = factsFor(sourceFile);
const agreements = collectDestructuringAgreements({ typedIgnoredArgumentCallContracts: facts });
let owned = false;
const findCall = (node = {}) => {
    if (typescript.isCallExpression(node) && facts.has(getConsumerContractKey(node))) owned = node;

    typescript.forEachChild(node, findCall);
};
findCall(sourceFile);
const place = (root = sourceFile, decisions = compileDestructuringDecisions(agreements)) => {
    const { transformed: [placed = root] = [], dispose = () => {} } = typescript.transform(root, [context => node => (
        annotateFinalExceptions({ typescript, sourceFile: node, destructuringAgreements: decisions, context })
    )]);
    const text = typescript.createPrinter().printFile(placed);
    dispose();

    return text;
};
assert.equal(place().split(extraReason).length - 1, 1);
const { arguments: ownedArguments = [] } = getObject(owned);
const cloned = typescript.transform(sourceFile, [context => (root) => {
    const visit = (node = {}) => {
        if (node !== owned) return typescript.visitEachChild(node, visit, context);

        return typescript.setOriginalNode(
            typescript.factory.createCallExpression(typescript.factory.createIdentifier('apply'), undefined, ownedArguments), owned
        );
    };

    return typescript.visitNode(root, visit);
}]);
const { transformed: [rebuilt = sourceFile] = [] } = cloned;
assert.equal(place(rebuilt).split(extraReason).length - 1, 1, 'Original-node provenance survives a rangeless rebuilt call.');
cloned.dispose();
assert.doesNotMatch(place(sourceFile, compileDestructuringDecisions(new Map())), /signature-contract-call-site/, 'Absent facts are not repaired by spelling.');
const failure = new Error('lookup');
const hostile = compileDestructuringDecisions(agreements);
Object.defineProperty(hostile.byKey, 'get', { value: () => { throw failure; } });
assert.throws(() => place(sourceFile, hostile), error => error === failure);

const linter = new Linter();
const lintConfig = { plugins: { resilient }, rules: { 'resilient/signature-contract-call-site': 'error' } };
const transformer = createTypeScriptTransformer({ typescript, program });
const observe = async ({ text = '', probe = '' } = {}) => {
    const resolved = ['object', 'array', 'function'].reduce((result = '', module = '') => result.replaceAll(
        `eslint-plugin-resilient/standard/${module}`, import.meta.resolve(`eslint-plugin-resilient/standard/${module}`)
    ), text);
    const suffix = `let value; let failureName; let sameFailure = false;
        try { value = ${probe}; } catch (error) { failureName = error.name; sameFailure = error === failure; }
        export default JSON.stringify({ events, value, failureName, sameFailure });`;
    const { default: result = '' } = await import(`data:text/javascript,${encodeURIComponent(`${resolved}\n${suffix}`)}`);

    return result;
};
await Promise.all(traces.map(async ({ name = '' } = {}) => {
    const probe = 'exercise()';
    const fileName = `${prefix}trace-${name}.ts`;
    const source = sources.get(fileName).getFullText();
    const { code = '', diagnostics = [] } = transformer.transform({ code: source, fileName });
    assert.deepEqual(diagnostics, [], name);
    const { outputText: original = '' } = typescript.transpileModule(source, { compilerOptions });
    const expected = await observe({ text: original, probe });
    const { output: fixed = code, messages = [] } = linter.verifyAndFix(code, lintConfig);
    assert.deepEqual(messages.filter(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-call-site'), [], name);
    assert.equal(await observe({ text: code, probe }), expected, `${name}: transformed`);
    assert.equal(await observe({ text: fixed, probe }), expected, `${name}: targeted fixed`);
}));

['plain-wrong-arity', 'plain-missing-arity', 'same-spelled-wrong-value', 'member-call'].forEach((name = '') => {
    const parsed = sources.get(`${prefix}${name}.ts`);
    const { outputText: output = '' } = typescript.transpileModule(place(parsed, new Map()), { compilerOptions });
    const messages = linter.verify(output, lintConfig);
    assert.ok(messages.some(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-call-site'),
        `${name}: same spelling must not suppress the known contradiction`);
    const { code = '', diagnostics = [] } = transformer.transform({ code: parsed.getFullText(), fileName: `${prefix}${name}.ts` });
    assert.deepEqual(diagnostics, [], name);
    assert.ok(linter.verify(code, lintConfig).some(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-call-site'),
        `${name}: the public pipeline also retains the contradiction`);
});
const { outputText: printed = '' } = typescript.transpileModule(place(), { compilerOptions });
const unexplained = printed.replaceAll(`// eslint-disable-next-line resilient/signature-contract-call-site -- ${extraReason}`, '');
assert.ok(linter.verify(unexplained, lintConfig).some(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-call-site'),
    'The owning rule reports the implementation arity without this exact source-fact boundary.');
