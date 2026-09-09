import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ESLint, Linter } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptEmitTransformer, createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { getObject } from '../rules/support/object.js';
import { placeEmissionBoundaries, placeInlineEmissionBoundaries } from '../transforms/typescript/grammar/emission-layout.js';
import { formatResilientOutput } from '../transforms/typescript/grammar/resolvers.js';
import { annotateRetainedMutationBoundaries } from '../transforms/typescript/lowering/mutation-boundaries.js';
import { lowerResidualMemberAccess } from '../transforms/typescript/members/residual.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import {
    annotateCyclicRuntimeBindingReferences, annotateRetainedDynamicMemberAccess, annotateRetainedStaticMemberAccess, groupNextLineExceptions
} from '../transforms/typescript/policy/exceptions.js';
import { compilePlacementDecisions } from '../transforms/typescript/policy/placement.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import { collectPlacementEvidence } from '../transforms/typescript/understand/placement-evidence.js';
import { collectIndexedOperationContracts, getConsumerContractKey } from '../transforms/typescript/understand/type-evidence.js';

let directiveProofCases = [];

const group = (sourceFile, prepare = () => {}, inspect = () => {}) => typescript.transform(sourceFile, [context => (root) => {
    prepare(root);
    const grouped = groupNextLineExceptions({ typescript, sourceFile: root, context });

    inspect(root, grouped, context);

    return grouped;
}]);
const print = sourceFile => typescript.createPrinter().printFile(sourceFile);
const nextLine = (node, rules, reason) => typescript.addSyntheticLeadingComment(
    node, typescript.SyntaxKind.SingleLineCommentTrivia, ` eslint-disable-next-line ${rules} -- ${reason}`, true
);
const groupingSource = typescript.createSourceFile('grouping.js', [
    'alert(console.log("before"));',
    'alert(console.log("target"));',
    'alert(console.log("after"));'
].join('\n'), typescript.ScriptTarget.ESNext, true, typescript.ScriptKind.JS);
const groupedResult = group(groupingSource, ({ statements: { 1: target = {} } = {} } = {}) => {
    nextLine(target, 'no-alert', 'Native alert timing.');
    nextLine(target, 'no-console, no-alert', 'Native alert and console timing.');
    nextLine(target, 'no-alert', 'Native alert timing.');
}, (original, grouped, context) => {
    const { statements: { 1: target = {} } = {} } = original;

    assert.equal(typescript.getSyntheticLeadingComments(target).length, 3, 'The caller-owned comment array remains intact.');
    const withoutComments = typescript.createPrinter({ removeComments: true });

    assert.equal(withoutComments.printFile(grouped), withoutComments.printFile(original), 'Executable tokens are unchanged.');
    const regrouped = groupNextLineExceptions({ typescript, sourceFile: grouped, context });

    assert.equal(print(regrouped), print(grouped), 'Grouping is idempotent.');
});
const { transformed: { 0: groupedSource = {} } = {} } = groupedResult;
const groupedCode = print(groupedSource);
assert.match(groupedCode, /\/\/ no-console, no-alert -- Native alert and console timing\.\n\/\/ eslint-disable-next-line no-alert, no-console -- Native alert timing\.\nalert/u);
groupedResult.dispose();
const groupingLinter = new Linter();
const groupingSettings = { linterOptions: { reportUnusedDisableDirectives: 'error' }, rules: { 'no-alert': 'error', 'no-console': 'error' } };
[groupedCode, formatResilientOutput(groupedCode, typescript)].forEach((code) => {
    const messages = groupingLinter.verify(code, groupingSettings);
    const suppressed = groupingLinter.getSuppressedMessages();
    assert.equal(messages.length, 4, JSON.stringify(messages));
    assert.equal(messages.every(({ line = 0 }) => /before|after/u.test(code.split('\n').at(line - 1))), true);
    assert.deepEqual(suppressed.map(({ ruleId = '' }) => ruleId).toSorted(), ['no-alert', 'no-console']);
    assert.equal(suppressed.every(({ line = 0 }) => code.split('\n').at(line - 1).includes('target')), true);
    const unannotated = code.replace(/^\s*\/\/ eslint-disable-next-line[^\n]*\n/gmu, '');
    assert.equal(groupingLinter.verify(unannotated, groupingSettings).length, 6, 'Both necessary target findings reappear.');
});
// A single unused rule remains visible: grouping cannot launder unnecessary
// exceptions, absorb authored trivia, or widen a paired block boundary.
[' authored note', ' eslint-disable no-alert -- Scoped owner. ', ' eslint-disable-next-line -- Bare boundary.'].forEach((separator) => {
    const tree = typescript.createSourceFile('separate.js', 'alert(console.log("target"));', 99, true);
    let before = '';
    const result = group(tree, (root) => {
        const { statements: { 0: target = {} } = {} } = root;

        nextLine(target, 'no-alert', 'First owner.');
        const kind = separator.includes('Scoped') ? typescript.SyntaxKind.MultiLineCommentTrivia : typescript.SyntaxKind.SingleLineCommentTrivia;

        typescript.addSyntheticLeadingComment(target, kind, separator, true);
        nextLine(target, 'no-console', 'Second owner.');
        before = print(root);
    });

    const { transformed: { 0: output = {} } = {} } = result;

    assert.equal(print(output), before);
    result.dispose();
});
const authoredTree = typescript.createSourceFile('authored.js', '// eslint-disable-next-line no-alert -- Authored owner.\nalert(console.log("target"));', 99, true);
const authoredGrouped = group(authoredTree, ({ statements: { 0: target = {} } = {} } = {}) => {
    nextLine(target, 'no-console', 'Generated owner.');
});
const authoredOutput = formatResilientOutput(print(authoredGrouped.transformed[0]), typescript, authoredGrouped.transformed[0]);
assert.ok(authoredOutput.includes('// eslint-disable-next-line no-alert -- Authored owner.'));
assert.deepEqual(groupingLinter.verify(authoredOutput, groupingSettings), [], authoredOutput);
assert.deepEqual(groupingLinter.getSuppressedMessages().map(({ ruleId = '' }) => ruleId).toSorted(), ['no-alert', 'no-console']);
authoredGrouped.dispose();
const separateReasons = group(groupingSource, ({ statements: { 1: target = {} } = {} } = {}) => {
    nextLine(target, 'no-alert', 'Alert timing.');
    nextLine(target, 'no-console', 'Console timing.');
});
const { transformed: { 0: joinedReasons = {} } = {} } = separateReasons;
assert.match(print(joinedReasons), /\/\/ no-alert -- Alert timing\.\n\/\/ eslint-disable-next-line no-alert, no-console -- Console timing\.\nalert/u);
separateReasons.dispose();
const unnecessary = groupedCode.replace('no-alert, no-console --', 'no-alert, no-console, no-debugger --');
assert.equal(groupingLinter.verify(unnecessary, { ...groupingSettings, rules: { ...groupingSettings.rules, 'no-debugger': 'error' } })
    .filter(({ ruleId = undefined }) => ruleId === null).length, 1, 'Unused members remain proof failures.');
const { rules: { 'max-len': groupedLengthRule = [] } = {} } = await new ESLint().calculateConfigForFile('directive-length-proof.js');
assert.deepEqual(groupedLengthRule, resilient.configs.recommended.rules['max-len'].map((value, index) => index === 0 ? 2 : value),
    'Repository and consumer profiles share the grouped-directive length exception.');
const lengthSettings = { ...groupingSettings, rules: { ...groupingSettings.rules, 'max-len': groupedLengthRule } };
const longReason = 'Native alert and console timing. '.repeat(10);
assert.deepEqual(groupingLinter.verify(`// eslint-disable-next-line no-alert, no-console -- ${longReason}\nalert(console.log("target"));`, lengthSettings), []);
[
    `// Ordinary explanation ${longReason}`,
    `const value = "${longReason}";`,
    `const value = 0; // eslint-disable-next-line no-alert, no-console -- ${longReason}\nalert(console.log("target"));`,
    `// eslint-disable-next-line no-alert -- ${longReason}\nalert("target");`,
    `// eslint-disable-next-line no-alert, no-console ${longReason}\nalert(console.log("target"));`
].forEach((code) => {
    assert.equal(groupingLinter.verify(code, lengthSettings).filter(({ ruleId = '' }) => ruleId === 'max-len').length, 1, code);
});

const directory = await mkdtemp(path.join(tmpdir(), 'resilient-directive-ownership-'));
const examples = {
    computedProperty: 'export const record = (keys: PropertyKey[], args: number[], i: number) => ({ [keys[i]]: args[i], after: 1 });',
    restGrouped: 'export const ordered = (f: (a: number, b: number) => number) => (...args: number[]) => { if (args.length > 1) return f(args[1], args[0]); return 0; };',
    groupedTuple: [
        'type Selection = { _tag: "None" } | { _tag: "Some"; value: [number, string] };',
        'export const replace = (found: Selection, source: Map<number, string>, next: string) => {',
        'if (found._tag === "Some") { const out = new Map(source); out.set(found.value[0], next); return out; }',
        'return source; };'
    ].join(' '),
    providerIndexed: [
        'export const project = (providers: { add: (x: any, y: any) => any }[], left: any[], right: any[]) =>',
        'providers.map((provider, i) => provider.add(left[i], right[i]));'
    ].join(' '),
    blockIndexed: 'export function read(a: number[], b: number[], i: number) { return Math.min(a[i], b[i]); }',
    mixed: 'export const merge = (a: number[], b: number[], i: number, choose: boolean) => choose ? Math.min(a[i], b[i]) : b[i];',
    indexedCallee: 'export const combine = (groups: { concat: (a: number, b: number) => number }[], a: number[], b: number[], i: number) => groups[i].concat(a[i], b[i]);',
    unrelated: [
        'export const forever = () => {',
        '// eslint-disable-next-line no-constant-condition -- Unrelated source boundary.',
        'while (true) return 1;',
        '};',
        'export const drop = (n: number) => (as: number[]) => { if (n <= 0) return as; return n >= as.length ? [] : as.slice(n, as.length); };',
        'export const equal = (xs: number[], ys: number[]) => xs.length === ys.length && xs.every((x, i) => Math.min(x, ys[i]));'
    ].join('\n'),
    slice: 'export const drop = (n: number) => (as: number[]) => { if (n <= 0) return as; return n >= as.length ? [] : as.slice(n, as.length); };',
    chained: 'export const compare = (...tests: { equals: (a: number, b: number) => boolean }[]) => (first: number[], second: number[]) => tests.every((test, i) => test.equals(first[i], second[i]));',
    following: 'export const read = (left: number[]) => Math.min(left.length, Math.random());',
    tail: 'export const read = (left: number[]) => Math.min(left.length) + Math.random();',
    authoredExtractor: '// eslint-disable-next-line no-undef -- Host source line.\nexport const read = (left: number[]) => Math.min(left.length);',
    indexed: 'export const selectIndexed = (left: number[], right: number[], i: number) => Math.min(left[i], right[i]);',
    rejected: 'export const complex = (left: number[], key: () => number) => Math.min(left[key()], 1);',
    authored: '/* eslint-disable resilient/prefer-destructured-member-access -- Caller owns this scope. */\nexport const authored = (left: number[], i: number) => Math.min(left[i], 1);',
    mutation: [
        'export const append = (outer: { map: (f: (box: { values: number[] }) => unknown) => unknown },',
        'inner: { map: (f: (item: number[]) => unknown) => unknown }) => outer.map(box => inner.map(item => { box.values.push(item.length); return box; }));'
    ].join(' '),
    parameterPropertyCollision: [
        'export class Native { constructor(public field: number) {',
        '// eslint-disable-next-line no-undef -- authored host',
        'console.log("target"); // trailing note',
        '} }'
    ].join('\n'),
    erasedCollision: [
        '/* eslint-disable-next-line no-console --',
        'Authored console call owns observable I/O at invocation.',
        '*/',
        '// eslint-disable-next-line no-undef -- authored host',
        'interface Gone {}',
        '// eslint-disable-next-line no-undef -- authored host',
        'console.log("target"); // trailing note'
    ].join('\n'),
    provider: 'export const read = (value: number) => value;',

    scoped: 'export const select = (left: number[], right: number[]) => Math.min(left.length, right.length);',
    retained: 'export const before = (value: number) => later(value); export const later = (value: number) => value;',
    shadowed: "import { read as later } from './provider.js'; export const value = later(1); export function read() { return later(2); function later(value: number) { return value; } }"
};
try {
    await Promise.all(Object.entries(examples).map(([name = '', code = '']) => writeFile(path.join(directory, `${name}.ts`), code)));
    const program = typescript.createProgram(Object.keys(examples).map(name => path.join(directory, `${name}.ts`)), {
        strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext
    });
    const transformer = createTypeScriptTransformer({ typescript, program });
    const render = name => transformer.transform({ code: examples[name], fileName: path.join(directory, `${name}.ts`) });
    const emit = createTypeScriptEmitTransformer({ typescript, program });
    const retainedFile = path.join(directory, 'retained.ts');
    const { diagnostics: preparedDiagnostics = [], results = [] } = emit.prepare({ fileNames: [retainedFile] });
    assert.deepEqual(preparedDiagnostics, []);
    const [{ code: preparedCode = '' } = {}] = results;
    assert.equal(emit.before()(program.getSourceFile(retainedFile)).getFullText(), preparedCode);
    ['parameterPropertyCollision', 'erasedCollision'].forEach((name) => {
        const { code = '', diagnostics: collisionDiagnostics = [] } = render(name);
        assert.deepEqual(collisionDiagnostics, []);
        const findings = groupingLinter.verify(code, { rules: { 'no-console': 'error', 'no-undef': 'error' } });
        assert.equal(findings.filter(({ ruleId = '' }) => ruleId === 'no-console').length, 0, code);
        assert.equal(groupingLinter.getSuppressedMessages().filter(({ ruleId = '' }) => ruleId === 'no-console').length, 1, code);
        assert.ok(code.includes('// trailing note'));
        assert.equal(formatResilientOutput(code, typescript), code);
    });
    const scoped = render('scoped');
    assert.match(scoped.code, /eslint-disable resilient\/prefer-safe-destructuring-defaults -- Argument Get/u);
    assert.match(scoped.code, /eslint-enable resilient\/prefer-safe-destructuring-defaults/u);
    const retained = render('retained');
    const shadowed = render('shadowed');
    assert.match(retained.code, /eslint-disable no-use-before-define/u);
    assert.match(retained.code, /eslint-enable no-use-before-define/u);
    assert.match(shadowed.code, /eslint-disable.*no-use-before-define/u, 'A same-named import cannot erase a local source-lifetime fact.');
    const linter = new Linter();
    const restGrouped = render('restGrouped');
    const restSettings = { plugins: { resilient }, linterOptions: { reportUnusedDisableDirectives: 'error' }, rules: {
        'resilient/prefer-signature-destructuring': 'error',
        'resilient/prefer-safe-destructuring-defaults': 'error',
        'resilient/signature-contract-destructuring': 'error'
    } };
    assert.deepEqual(restGrouped.diagnostics, []);
    const restMessages = linter.verify(restGrouped.code, restSettings);
    assert.deepEqual(restMessages, []);
    assert.deepEqual(linter.getSuppressedMessages(), []);
    const bareRest = restGrouped.code.replace(/^\s*\/\/ eslint-disable-next-line[^\n]*\n/gmu, '');
    assert.deepEqual(linter.verify(bareRest, restSettings), [], 'Completed rest selection needs no rule exception.');
    // Fresh rest positions already own exact defaults.
    directiveProofCases = [...directiveProofCases, restGrouped.code];
    const groupedTuple = render('groupedTuple');
    assert.deepEqual(groupedTuple.diagnostics, []);
    assert.match(groupedTuple.code, /eslint-disable-next-line resilient\/prefer-safe-destructuring-defaults, resilient\/prefer-signature-destructuring --/u);
    assert.match(groupedTuple.code, /static tuple position[^\n]*\n\s*\/\/ eslint-disable-next-line[^\n]*selected branch[^\n]*\n\s*const \{ value:/u);
    assert.doesNotMatch(groupedTuple.code, /\/\/ eslint-disable-next-line[^\n]*\n\s*\/\/ eslint-disable-next-line/u);
    directiveProofCases = [...directiveProofCases, groupedTuple.code];
    assert.deepEqual(linter.verify(scoped.code, { plugins: { resilient }, rules: {
        'resilient/prefer-safe-destructuring-defaults': 'error', indent: ['error', 4, { SwitchCase: 1 }]
    } }), []);
    [retained, shadowed].forEach(({ code = '' }) => {
        const findings = linter.verify(code, { rules: { 'no-use-before-define': 'error' } });
        assert.equal(findings.filter(({ ruleId = '' }) => ruleId === 'no-use-before-define').length, 0, JSON.stringify(findings));
    });

    const sourceFile = program.getSourceFile(path.join(directory, 'scoped.ts'));
    const placement = compilePlacementDecisions({ typescript, evidence: collectPlacementEvidence({
        typescript, sourceFile, checker: program.getTypeChecker()
    }) });
    const placed = typescript.transform(sourceFile, [context => root => lowerResidualMemberAccess({
        typescript, sourceFile: root, placement, context
    })]);
    const { transformed: [direct = sourceFile] = [] } = placed;
    const { outputText: directlyPlaced = '' } = typescript.transpileModule(typescript.createPrinter().printFile(direct), {
        compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
    });
    placed.dispose();
    const rule = 'resilient/prefer-safe-destructuring-defaults';
    const settings = { plugins: { resilient }, rules: { [rule]: 'error' } };
    [directlyPlaced, scoped.code].forEach((body) => {
        const neighbors = [
            'export const beforeNeighbor = ({ before }) => before;',
            body,
            'export const afterNeighbor = ({ after }) => after;',
            ''
        ].join('\n');
        [neighbors, formatResilientOutput(neighbors, typescript)].forEach((code) => {
            const raw = linter.verify(code, settings);
            const suppressed = linter.getSuppressedMessages();
            assert.equal(raw.length, 2, JSON.stringify(raw));
            assert.equal(suppressed.length, 2, JSON.stringify(suppressed));
            assert.equal([...raw, ...suppressed].every(({ ruleId = '' }) => ruleId === rule), true);
            const lines = code.split('\n');
            assert.equal(raw.every(({ line = 0 }) => /Neighbor/u.test(lines.at(line - 1))), true, 'Both neighboring boundaries stay visible.');
            assert.equal(suppressed.every(({ line = 0 }) => /(?:left|right)Length/u.test(lines.at(line - 1))), true, 'Each pair owns only its argument extractor.');
            const unannotated = code.replace(/\/\* eslint-(?:disable|enable) resilient\/prefer-safe-destructuring-defaults[^*]*\*\//gu, '');
            assert.equal(linter.verify(unannotated, settings).length, 4, 'Both required targets reappear without their boundaries.');
            directiveProofCases = [...directiveProofCases, code];
        });
    });
    directiveProofCases = [...directiveProofCases, scoped.code, retained.code, shadowed.code];

    const load = text => import(`data:text/javascript,${encodeURIComponent(text)}`);
    const { select = () => 0 } = await load(scoped.code);
    let projectionTrace = [];
    assert.equal(select({ get length() { projectionTrace = [...projectionTrace, 'left'];

        return 4; } }, { get length() { projectionTrace = [...projectionTrace, 'right'];

        return 2; } }), 2);
    assert.deepEqual(projectionTrace, ['left', 'right']);
    assert.throws(() => select(null, []), TypeError);
    const { select: originalSelect = () => 0 } = await load(typescript.transpileModule(examples.scoped, {
        compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
    }).outputText);
    const { select: directSelect = () => 0 } = await load(directlyPlaced);
    const minDescriptor = Object.getOwnPropertyDescriptor(Math, 'min');
    const failure = {};
    const observe = (invoke, phase) => {
        let events = [];
        const argument = name => ({ get length() {
            events = [...events, name];

            if (phase === name) throw failure;

            return name === 'left' ? 4 : 2;
        } });
        Object.defineProperty(Math, 'min', { configurable: true, get() {
            events = [...events, 'callee'];

            if (phase === 'callee') throw failure;

            return function (...values) {
                events = [...events, 'call'];
                assert.equal(this, Math);

                if (phase === 'call') throw failure;

                return values;
            };
        } });
        try {
            return { result: invoke(phase === 'null' ? null : argument('left'), argument('right')), events };
        } catch (error) {
            return { exactFailure: error === failure, nativeFailure: error instanceof TypeError, events };
        } finally {
            Object.defineProperty(Math, 'min', minDescriptor);
        }
    };
    ['normal', 'callee', 'left', 'right', 'call', 'null'].forEach((phase) => {
        assert.deepEqual(observe(select, phase), observe(originalSelect, phase), phase);
        assert.deepEqual(observe(directSelect, phase), observe(originalSelect, phase), phase);
    });
    // The completed source read owns the value and native failure; placement
    // changes only parentheses/comments, never key conversion or evaluation.
    const memberRule = 'resilient/prefer-destructured-member-access';
    const mutationRule = 'resilient/prefer-safe-transformations';
    const indexedSource = program.getSourceFile(path.join(directory, 'indexed.ts'));
    const indexedDecisions = compileDestructuringDecisions(collectDestructuringAgreements({
        typescript, indexedOperationContracts: collectIndexedOperationContracts({
            typescript, sourceFile: indexedSource, checker: program.getTypeChecker()
        })
    }));
    const indexedPlaced = typescript.transform(indexedSource, [context => root => annotateRetainedDynamicMemberAccess({
        typescript, sourceFile: root, destructuringAgreements: indexedDecisions, context
    })]);
    const { outputText: directIndexed = '' } = typescript.transpileModule(typescript.createPrinter().printFile(indexedPlaced.transformed[0]), {
        compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
    });
    indexedPlaced.dispose();
    const { code: indexed = '' } = render('indexed');
    const placementSettings = { plugins: { resilient }, rules: {
        [memberRule]: 'error', [mutationRule]: 'error', [rule]: 'error',
        'max-len': ['error', { code: 200 }], indent: ['error', 4, { SwitchCase: 1 }]
    } };
    const { code: computedProperty = '', diagnostics: propertyDiagnostics = [] } = render('computedProperty');
    const computedSettings = { ...placementSettings, rules: { ...placementSettings.rules,
        'comma-style': ['error', 'last'], 'comma-dangle': ['error', 'never'] } };
    assert.deepEqual(propertyDiagnostics, []);
    assert.equal(formatResilientOutput(computedProperty, typescript), computedProperty);
    assert.deepEqual(linter.verify(computedProperty, computedSettings), [], computedProperty);
    assert.equal(linter.getSuppressedMessages().filter(({ ruleId = '' }) => ruleId === memberRule).length, 2);
    assert.equal(linter.verifyAndFix(computedProperty, computedSettings).fixed, false,
        'The completed computed property requires no indentation or comma repair.');
    const propertyNeighbor = computedProperty.replace('(keys, args, i)', '(keys, args, i, host)')
        .replace('after: 1', 'neighbor: host.value');
    assert.notEqual(propertyNeighbor, computedProperty);
    const neighborOutput = formatResilientOutput(propertyNeighbor, typescript);
    const propertyFindings = linter.verify(neighborOutput, computedSettings);
    assert.equal(propertyFindings.length, 1, JSON.stringify({ neighborOutput, propertyFindings }));
    assert.equal(propertyFindings[0].ruleId, memberRule);
    assert.match(neighborOutput.split('\n').at(propertyFindings[0].line - 1), /host\.value/u);
    const propertyDirectives = [...computedProperty.matchAll(/^\s*\/\/ eslint-disable-next-line resilient\/prefer-destructured-member-access[^\n]*\n/gmu)];
    assert.equal(propertyDirectives.length, 2);
    propertyDirectives.forEach(({ index = 0, 0: directive = '' }) => {
        const removed = computedProperty.slice(0, index) + computedProperty.slice(index + directive.length);
        const findings = linter.verify(removed, computedSettings);
        const [{ ruleId: exposedRule = '' } = {}] = findings;
        assert.equal(findings.length, 1, JSON.stringify(findings));
        assert.equal(exposedRule, memberRule);
    });
    const { record: placedRecord = () => ({}) } = await load(computedProperty);
    const { record: originalRecord = () => ({}) } = await load(typescript.transpileModule(examples.computedProperty, {
        compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
    }).outputText);
    const observeProperty = (invoke, phase) => {
        let events = [];
        const failure = {};
        const keys = { get 0() {
            events = [...events, 'key Get'];

            if (phase === 'key') throw failure;

            return { [Symbol.toPrimitive]() {
                events = [...events, 'ToPropertyKey'];

                if (phase === 'convert') throw failure;

                return 'selected';
            } };
        } };
        const args = { get 0() {
            events = [...events, 'value Get'];

            if (phase === 'value') throw failure;

            return 7;
        } };
        try {
            return { value: invoke(phase === 'null' ? null : keys, args, 0), events };
        } catch (error) {
            return { exactFailure: error === failure, nativeFailure: error instanceof TypeError, events };
        }
    };
    ['normal', 'key', 'convert', 'value', 'null'].forEach((phase) => {
        assert.deepEqual(observeProperty(placedRecord, phase), observeProperty(originalRecord, phase), phase);
    });
    directiveProofCases = [...directiveProofCases, computedProperty, neighborOutput];
    [directIndexed, indexed].forEach((body) => {
        const neighbors = body.replace('(left, right, i)', '(left, right, i, before, after)').replace('Math.min(', 'Math.min(before.value, ').replace(/\);/u, ', after.value);');
        const output = formatResilientOutput(neighbors, typescript);
        [output, linter.verifyAndFix(output, placementSettings).output].forEach((code) => {
            const raw = linter.verify(code, placementSettings);
            const suppressed = linter.getSuppressedMessages();
            assert.equal(raw.length, 2, JSON.stringify({ code, raw }));
            assert.equal(suppressed.length, 2, JSON.stringify(suppressed));
            assert.ok(raw.every(({ ruleId = '' }) => ruleId === memberRule));
            assert.ok(suppressed.every(({ ruleId = '' }) => ruleId === memberRule));
            assert.ok(raw.every(({ line = 0 }) => /(?:before|after)\.value/u.test(code.split('\n').at(line - 1))));
            const unannotated = code.replace(/^\s*\/\/ eslint-disable-next-line resilient\/prefer-destructured-member-access[^\n]*\n/gmu, '');
            assert.equal(linter.verify(unannotated, { plugins: { resilient }, rules: { [memberRule]: 'error' } }).length, 4);
            directiveProofCases = [...directiveProofCases, code];
        });
        assert.equal(formatResilientOutput(output, typescript), output);
    });
    ['rejected', 'authored'].forEach((name) => {
        const { code = '', diagnostics: rejectedDiagnostics = [] } = render(name);
        assert.deepEqual(rejectedDiagnostics, []);
        assert.doesNotMatch(code, /eslint-disable-line resilient\/prefer-destructured-member-access/u);
        assert.doesNotMatch(code, /eslint-enable resilient\/prefer-destructured-member-access/u,
            'The retained computed key and authored scope must not acquire an inner enable.');
        assert.equal((code.match(/eslint-disable-next-line resilient\/prefer-destructured-member-access/gu) || []).length,
            name === 'authored' ? 0 : 1, 'An authored block already owns the necessary read.');
        directiveProofCases = [...directiveProofCases, code];
    });
    ['following', 'tail', 'authoredExtractor'].forEach((name) => {
        const input = program.getSourceFile(path.join(directory, `${name}.ts`));
        const selectedPlacement = compilePlacementDecisions({ typescript, evidence: collectPlacementEvidence({
            typescript, sourceFile: input, checker: program.getTypeChecker()
        }) });
        const result = typescript.transform(input, [context => root => lowerResidualMemberAccess({
            typescript, sourceFile: root, placement: selectedPlacement, context
        })]);
        const { transformed: [placedRoot = input] = [] } = result;
        const printed = typescript.createPrinter().printFile(placedRoot);
        result.dispose();
        assert.match(printed, /Argument Get keeps source timing and failure\. \*\//u,
            'A following operation or authored directive rejects the new multiline placement.');
    });
    const ambientSource = typescript.createSourceFile('ambient.ts', examples.indexed, typescript.ScriptTarget.ESNext, true);
    const ambient = typescript.transform(ambientSource, [context => (root) => {
        const { statements: [statement = {}] = [] } = root;
        const ambientStatement = typescript.addSyntheticLeadingComment(statement, typescript.SyntaxKind.MultiLineCommentTrivia,
            ' eslint-disable resilient/prefer-destructured-member-access -- Enclosing completed boundary. ', true);

        return annotateRetainedDynamicMemberAccess({
            typescript, sourceFile: typescript.factory.updateSourceFile(root, [ambientStatement]),
            destructuringAgreements: indexedDecisions, context
        });
    }]);
    const ambientText = typescript.createPrinter().printFile(ambient.transformed[0]);
    ambient.dispose();
    assert.doesNotMatch(ambientText, /eslint-disable-(?:next-)?line resilient\/prefer-destructured-member-access/u);
    assert.doesNotMatch(ambientText, /eslint-enable resilient\/prefer-destructured-member-access/u,
        'An inherited generated block must not be canceled by an inner enable.');
    ['mixed', 'indexedCallee', 'blockIndexed', 'providerIndexed'].forEach((name) => {
        const { code = '', diagnostics: mixedDiagnostics = [] } = render(name);
        assert.deepEqual(mixedDiagnostics, []);
        assert.match(code, /eslint-disable-next-line resilient\/prefer-destructured-member-access/u);
        assert.doesNotMatch(code, /eslint-enable resilient\/prefer-destructured-member-access/u,
            'Distinct indexed reads retain separate necessary next-line owners.');
        directiveProofCases = [...directiveProofCases, code];
    });
    const { code: providerIndexed = '' } = render('providerIndexed');
    assert.match(providerIndexed, /eslint-disable-next-line resilient\/prefer-safe-transformations/u);
    assert.deepEqual(linter.verify(providerIndexed, placementSettings).filter(({ ruleId = '' }) => ruleId === 'indent'), []);
    const { output: providerFixed = '' } = linter.verifyAndFix(providerIndexed, placementSettings);
    assert.deepEqual(linter.verify(providerFixed, placementSettings).filter(({ severity = 0 }) => severity === 2), []);
    directiveProofCases = [...directiveProofCases, providerFixed];
    const { code: unrelated = '' } = render('unrelated');
    assert.match(unrelated, /Argument Get keeps source timing and failure\.\n/u);
    assert.match(unrelated, /eslint-disable-next-line resilient\/prefer-destructured-member-access -- Get order/u,
        'An unrelated line directive must not block a different source unit.');
    const { output: unrelatedFixed = '' } = linter.verifyAndFix(unrelated, placementSettings);
    assert.deepEqual(linter.verify(unrelatedFixed, placementSettings).filter(({ severity = 0 }) => severity === 2), []);
    directiveProofCases = [...directiveProofCases, unrelated, unrelatedFixed];
    const { code: mutation = '' } = render('mutation');
    assert.match(mutation, /eslint-disable-next-line resilient\/prefer-safe-transformations/u);
    assert.match(mutation, /eslint-disable resilient\/prefer-safe-destructuring-defaults/u);
    const mutationNeighbor = mutation.replace('return box;', 'neighbor.push(1);\n    return box;');
    assert.notEqual(mutationNeighbor, mutation);
    [mutation, mutationNeighbor].forEach((code, index) => {
        const formattedCode = formatResilientOutput(code, typescript);
        [formattedCode, linter.verifyAndFix(formattedCode, placementSettings).output].forEach((output) => {
            const raw = linter.verify(output, placementSettings);
            const suppressed = linter.getSuppressedMessages();
            assert.equal(raw.length, index, JSON.stringify({ output, raw }));
            assert.equal(suppressed.filter(({ ruleId = '' }) => ruleId === mutationRule).length, 1);
            assert.equal(suppressed.filter(({ ruleId = '' }) => ruleId === rule).length, 1);
            assert.ok(raw.every(({ line = 0 }) => output.split('\n').at(line - 1).includes('neighbor.push')));
            directiveProofCases = [...directiveProofCases, output];
        });
    });
    ['slice', 'chained'].forEach((name) => {
        const { code = '', diagnostics: shapeDiagnostics = [] } = render(name);
        assert.deepEqual(shapeDiagnostics, []);
        [code, linter.verifyAndFix(code, placementSettings).output].forEach((output) => {
            assert.deepEqual(linter.verify(output, placementSettings).filter(({ severity = 0 }) => severity === 2), [], output);
            directiveProofCases = [...directiveProofCases, output];
        });
    });
    const { outputText: referenceIndexed = '' } = typescript.transpileModule(examples.indexed, {
        compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
    });
    const indexedFunctions = await Promise.all([referenceIndexed, directIndexed, indexed,
        linter.verifyAndFix(indexed, placementSettings).output].map(async code => (await load(code)).selectIndexed));
    const observeIndexed = (invoke, phase) => {
        let events = [];
        let conversions = 0;
        const value = {};
        const key = { [Symbol.toPrimitive]() {
            conversions += 1;
            events = [...events, `key${conversions}`];

            if (phase === `key${conversions}`) throw failure;

            return 0;
        } };
        const argument = name => ({ get 0() {
            events = [...events, name];

            if (phase === name) throw failure;

            return value;
        } });
        Object.defineProperty(Math, 'min', { configurable: true, get() {
            events = [...events, 'callee'];

            if (phase === 'callee') throw failure;

            return function (...values) {
                events = [...events, 'call'];
                assert.equal(this, Math);
                assert.ok(values.every(entry => entry === value));

                if (phase === 'call') throw failure;

                return value;
            };
        } });
        try {
            return { identity: invoke(phase === 'null' ? null : argument('left'), argument('right'), key) === value, events };
        } catch (error) {
            return { exactFailure: error === failure, nativeFailure: error instanceof TypeError, events };
        } finally {
            Object.defineProperty(Math, 'min', minDescriptor);
        }
    };
    const [referenceIndexedFunction = () => 0] = indexedFunctions;
    ['normal', 'callee', 'key1', 'left', 'key2', 'right', 'call', 'null'].forEach((phase) => {
        indexedFunctions.slice(1).forEach(invoke => assert.deepEqual(observeIndexed(invoke, phase), observeIndexed(referenceIndexedFunction, phase), phase));
    });
    const { outputText: referenceMutation = '' } = typescript.transpileModule(examples.mutation, {
        compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
    });
    const mutationFunctions = await Promise.all([referenceMutation, mutation,
        linter.verifyAndFix(mutation, placementSettings).output].map(async code => (await load(code)).append));
    const observeMutation = (invoke, phase) => {
        let events = [];
        const values = { get push() {
            events = [...events, 'callee'];

            if (phase === 'callee') throw failure;

            return function (value) {
                events = [...events, 'call'];
                assert.equal(this, values);
                assert.equal(value, 7);

                if (phase === 'call') throw failure;
            };
        } };
        const box = { get values() { events = [...events, 'receiver'];

            return values; } };
        const item = { get length() {
            events = [...events, 'argument'];

            if (phase === 'argument') throw failure;

            return 7;
        } };
        try {
            const result = invoke({ map: callback => callback(box) }, { map: callback => callback(phase === 'null' ? null : item) });

            return { identity: result === box, events };
        } catch (error) {
            return { exactFailure: error === failure, nativeFailure: error instanceof TypeError, events };
        }
    };
    const [referenceMutationFunction = () => 0] = mutationFunctions;
    ['normal', 'callee', 'argument', 'call', 'null'].forEach((phase) => {
        mutationFunctions.slice(1).forEach(invoke => assert.deepEqual(observeMutation(invoke, phase), observeMutation(referenceMutationFunction, phase), phase));
    });
} finally {
    await rm(directory, { recursive: true, force: true });
}

export { directiveProofCases };

{
    const capabilityDirectory = await mkdtemp(path.join(tmpdir(), 'resilient-capability-directives-'));
    const capabilityCases = {
        first: 'export const probe=(O:{compare:(a:number,b:number)=>number})=>(as:number[])=>as.slice().sort(O.compare);',
        priorValue: 'export const probe=(O:{compare:(a:number,b:number)=>number})=>(as:number[])=>{ if(as.length<=1)return as; return as.slice().sort(O.compare); };',
        priorBare: 'export const probe=(O:{compare:(a:number,b:number)=>number})=>(as:number[],early:boolean)=>{ if(early)return; return as.slice().sort(O.compare); };',
        nested: 'export const probe=(O:{compare:(a:number,b:number)=>number})=>(as:number[])=>{ const nested=()=>4; nested(); return as.slice().sort(O.compare); };',
        unreachable: 'export const probe=(O:{compare:(a:number,b:number)=>number})=>(as:number[])=>{ if(false)return 4; return as.slice().sort(O.compare); };',
        direct: 'export const probe=(O:{run:(a:number)=>number}, a:number)=>O.run(a);',
        directPrior: 'export const probe=(O:{run:(a:number)=>number}, a:number)=>{ if(a===1)return 4; return O.run(a); };',
        dynamic: 'export function probe(ks:string[],i:number) { const k=ks[i]; return k; }',
        rest: 'export function probe(f:(...args:any[])=>any) { return (...args:any[])=> { if(args.length>1)return f(args[1],args[0]); return (a:any)=>f(a)(args[0]); }; }'
    };
    try {
        await Promise.all(Object.entries(capabilityCases).map(([name = '', code = '']) => writeFile(path.join(capabilityDirectory, `${name}.ts`), code)));
        const program = typescript.createProgram(Object.keys(capabilityCases).map(name => path.join(capabilityDirectory, `${name}.ts`)), {
            target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext, strict: true
        });
        const transformer = createTypeScriptTransformer({ typescript, program });
        const linter = new Linter();
        const settings = { linterOptions: { reportUnusedDisableDirectives: 'error' }, plugins: { resilient }, rules: {
            'consistent-return': 'error',
            'func-style': ['error', 'expression'],
            'resilient/prefer-safe-destructuring-defaults': 'error',
            'resilient/prefer-signature-destructuring': 'error',
            'resilient/signature-contract-destructuring': 'error'
        } };
        Object.entries(capabilityCases).forEach(([name = '', source = '']) => {
            const { code = '' } = transformer.transform({ code: source, fileName: path.join(capabilityDirectory, `${name}.ts`) });
            const messages = linter.verify(code, settings);
            const suppressed = linter.getSuppressedMessages().filter(({ ruleId = '' }) => ruleId === 'consistent-return');
            const withoutCapability = code.replace(/^\s*\/\/ eslint-disable-next-line consistent-return -- Checked capability disagreement[^\n]*\n/gmu, '');
            const bare = linter.verify(withoutCapability, settings).filter(({ ruleId = '' }) => ruleId === 'consistent-return');

            assert.deepEqual(messages.filter(({ ruleId = '' }) => !ruleId), [], JSON.stringify({ name, code, messages }));
            assert.equal(messages.some(({ ruleId = '' }) => ruleId === 'consistent-return'), false, name);

            if (['dynamic', 'rest'].includes(name)) {
                assert.doesNotMatch(code, /fresh rest-array numeric reads must not acquire an iterator|dynamic array index may be absent/u);

                return;
            }

            assert.equal(suppressed.length, 1, name);
            assert.equal(bare.length, 1, name);
            const [{ messageId = '', line = 0 } = {}] = suppressed;
            const [{ messageId: bareMessage = '' } = {}] = bare;

            assert.equal(messageId, bareMessage, name);
            const target = code.split('\n').at(line - 1).trim();
            assert.equal(target === 'return;', ['priorValue', 'unreachable', 'directPrior'].includes(name), name);
            const neighbor = `${code}\nexport const neighbor = flag => { if (flag) return 1; return; };`;
            const neighborMessages = linter.verify(neighbor, settings).filter(({ ruleId = '' }) => ruleId === 'consistent-return');
            assert.equal(neighborMessages.length, 1, name);
            const [{ line: neighborLine = 0 } = {}] = neighborMessages;

            assert.match(neighbor.split('\n').at(neighborLine - 1), /neighbor/u);
        });
    } finally {
        await rm(capabilityDirectory, { recursive: true, force: true });
    }
}

{
    const callDirectory = await mkdtemp(path.join(tmpdir(), 'resilient-resolved-call-directives-'));
    const cases = {
        collision: 'export const outer=(x:number)=>{ const go=(v:number)=>v; return go(x); }; export const go=(x:number,y:number)=>x+y;',
        mismatch: 'export const outer=()=>{ const go=(v=0)=>v; return go("wrong"); }; export const go=(x:number,y:number)=>x+y;',
        neighbor: 'export const outer=(x:number)=>{ const go=(v:number)=>v; return go(x); }; export const go=(x:number,y:number)=>x+y; export const neighbor=()=>go(1);'
    };
    try {
        await Promise.all(Object.entries(cases).map(([name = '', code = '']) => writeFile(path.join(callDirectory, `${name}.ts`), code)));
        const program = typescript.createProgram(Object.keys(cases).map(name => path.join(callDirectory, `${name}.ts`)), {
            target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext, strict: true
        });
        const transformer = createTypeScriptTransformer({ typescript, program });
        const linter = new Linter();
        const settings = { linterOptions: { reportUnusedDisableDirectives: 'error' }, plugins: { resilient }, rules: {
            'resilient/signature-contract-call-site': 'error'
        } };
        Object.entries(cases).forEach(([name = '', source = '']) => {
            const { code = '' } = transformer.transform({ code: source, fileName: path.join(callDirectory, `${name}.ts`) });
            const messages = linter.verify(code, settings);
            assert.doesNotMatch(code, /eslint-disable-next-line resilient\/signature-contract-call-site/u);
            assert.deepEqual(linter.getSuppressedMessages(), [], name);
            assert.equal(messages.length, name === 'collision' ? 0 : 1, JSON.stringify({ name, code, messages }));

            if (name === 'collision') return;

            const [{ ruleId = '', messageId = '', line = 0 } = {}] = messages;

            assert.equal(ruleId, 'resilient/signature-contract-call-site');
            assert.equal(messageId, name === 'mismatch' ? 'mismatchWithEvidence' : 'arityWithEvidence');
            assert.match(code.split('\n').at(line - 1), name === 'mismatch' ? /wrong/u : /neighbor/u);
        });
    } finally {
        await rm(callDirectory, { recursive: true, force: true });
    }
}

// Completed callable placement owns the statement span. Varying rule count or
// reason width cannot change its grammar or leave an operand outside coverage.
const operationPlacement = (source, names, reason, nested = false, repeat = [], lineRule = '', trailingText = '') => {
    const tree = typescript.createSourceFile('operation.js', source, 99, true, typescript.ScriptKind.JS);
    const { statements: [{ statements: [, owner = {}] = [] } = {}] = [] } = tree;
    let owners = [owner];

    if (nested) {
        const find = (node) => {
            const { body = {} } = node;

            if (typescript.isArrowFunction(node)) owners = [...owners, body];

            typescript.forEachChild(node, find);
        };
        find(owner);
    }

    const byKey = new Map(owners.map((node) => {
        const key = getConsumerContractKey(node);

        return [key, [{ entry: { key, kind: 'callable-operation-placement' },
            contract: { placementRange: key, evidence: [reason] },
            agreement: { action: 'retain-callable-operation', rules: names } }]];
    }));
    const result = typescript.transform(tree, [context => (root) => {
        if (lineRule) nextLine(owner, lineRule, 'Exact code line.');

        if (trailingText) typescript.addSyntheticTrailingComment(owner, typescript.SyntaxKind.MultiLineCommentTrivia, trailingText, true);

        let placed = annotateRetainedStaticMemberAccess({
            typescript, sourceFile: root, context, destructuringAgreements: { hasCallableOperations: true, byKey }
        });
        repeat.forEach((contribution) => {
            const { rules = contribution, reason: nextReason = reason } = getObject(contribution);
            const next = new Map([...byKey].map(([key = '', records = []] = []) => [key, records.map((record) => {
                const { contract = {} } = record;

                return { ...record, contract: { ...contract, evidence: [nextReason] },
                    agreement: { action: 'retain-callable-operation', rules } };
            })]));
            placed = annotateRetainedStaticMemberAccess({ typescript, sourceFile: placed, context,
                destructuringAgreements: { hasCallableOperations: true, byKey: next } });
        });

        // This fixture supplies max-len only for the known overlong generated
        // explanation. Its diagnostic is on the comment line, so its owner is
        // a next-line boundary before the scoped opener, not executable code.
        if (reason.length > 200) {
            const annotateExplanation = (node) => {
                const comments = typescript.getSyntheticLeadingComments(node) || [];
                const index = comments.findIndex(({ text = '' }) => text.startsWith(' eslint-disable '));

                if (index >= 0) typescript.setSyntheticLeadingComments(node, [
                    ...comments.slice(0, index),
                    { kind: typescript.SyntaxKind.SingleLineCommentTrivia, pos: -1, end: -1, hasTrailingNewLine: true,
                        text: ' eslint-disable-next-line max-len -- Retained exception explanation.' },
                    ...comments.slice(index)
                ]);

                typescript.forEachChild(node, annotateExplanation);
            };
            annotateExplanation(placed);
        }

        return placed;
    }]);
    const { transformed: [output = {}] = [] } = result;
    const code = formatResilientOutput(print(output), typescript);
    result.dispose();

    return code;
};
const executable = (code) => {
    const tree = typescript.createSourceFile('tokens.js', code, 99, true, typescript.ScriptKind.JS);
    let tokens = [];
    const visit = (node) => {
        const { kind = 0 } = getObject(node);

        if (kind === typescript.SyntaxKind.EndOfFileToken) return;

        if (kind <= typescript.SyntaxKind.LastToken) {
            tokens = [...tokens, [kind, node.getText(tree)]];

            return;
        }

        node.getChildren(tree).forEach(visit);
    };
    visit(tree);

    return tokens;
};
[
    '{ alert("before"); alert(console.log("target")); alert("after"); }',
    '{ alert("before"); alert(\nconsole.log("target")\n); alert("after"); }',
    '{ alert("before"); alert(() => console.log("nested"), console.log("later")); alert("after"); }',
    '{ alert("before"); const result = alert(console.log("target")); alert("after"); }',
    '{ alert("before"); const result = alert(\n// Initializer note.\nconsole.log("target")\n); alert("after"); }'
].forEach((source, index) => {
    const base = operationPlacement(source, ['no-console'], 'Native console timing.', index === 2);
    [['no-console'], ['no-console', 'no-alert', 'no-console']].forEach((names) => {
        ['Native console timing.', 'Native console timing. '.repeat(12)].forEach((reason) => {
            const code = operationPlacement(source, names, reason, index === 2);
            assert.deepEqual(executable(code), executable(base));
            assert.equal(formatResilientOutput(code, typescript), code);
            assert.doesNotMatch(code, /eslint-disable-next-line no-(?:alert|console)/u);
            assert.doesNotMatch(code, /no-console, no-alert, no-console/u);
            const messages = groupingLinter.verify(code, lengthSettings);
            const suppressed = groupingLinter.getSuppressedMessages();
            assert.equal(messages.length, names.includes('no-alert') ? 2 : 3, JSON.stringify({ code, messages }));
            assert.ok(messages.every(({ ruleId = '' }) => ruleId === 'no-alert'));
            assert.equal(suppressed.filter(({ ruleId = '' }) => ruleId === 'no-console').length, index === 2 ? 2 : 1);

            if (reason.length > 200) {
                const withoutLength = code.replace(/^[ \t]*\/\/ eslint-disable-next-line max-len[^\n]*\n/gmu, '');
                assert.equal(groupingLinter.verify(withoutLength, lengthSettings).filter(({ ruleId = '' }) => ruleId === 'max-len').length, 1);
            }

            const bare = code.replace(/\/\* eslint-(?:disable|enable)[\s\S]*?\*\//gu, '')
                .replace(/^[ \t]*\/\/ eslint-disable-next-line max-len[^\n]*\n/gmu, '');
            assert.equal(groupingLinter.verify(bare, groupingSettings).length, index === 2 ? 5 : 4);
        });
    });
});
// max-len is an exact member of either form when the owned code needs it;
// deduplication never changes that form or gives it a wider endpoint.
const longOperation = `{ alert("before"); alert("${'value'.repeat(45)}"); alert("after"); }`;
const lengthScope = operationPlacement(longOperation, ['no-alert', 'max-len', 'max-len'], 'Retained string value.');
assert.deepEqual(groupingLinter.verify(lengthScope, { rules: { 'no-alert': 'error', 'max-len': groupedLengthRule } })
    .map(({ ruleId = '' }) => ruleId), ['no-alert', 'no-alert']);
assert.deepEqual(groupingLinter.getSuppressedMessages().map(({ ruleId = '' }) => ruleId).toSorted(), ['max-len', 'no-alert']);
assert.deepEqual(executable(lengthScope), executable(operationPlacement(longOperation, ['no-alert'], 'Retained string value.')));
const singleDuplicate = group(typescript.createSourceFile('single.js', 'alert("target");', 99, true), ({ statements: [owner = {}] = [] } = {}) => {
    nextLine(owner, 'no-alert, no-alert', 'Native alert timing.');
});
assert.match(print(singleDuplicate.transformed[0]), /eslint-disable-next-line no-alert --/u);
assert.deepEqual(groupingLinter.verify(print(singleDuplicate.transformed[0]), { rules: { 'no-alert': 'error' } }), []);
singleDuplicate.dispose();

const accumulated = operationPlacement('{ alert("before"); alert(console.log("target")); alert("after"); }',
    ['no-console'], 'Native call timing.', false, [['no-alert'], ['no-console', 'no-alert']]);
assert.equal((accumulated.match(/eslint-disable /gu) || []).length, 1);
assert.equal((accumulated.match(/eslint-enable /gu) || []).length, 1);
assert.deepEqual(groupingLinter.verify(accumulated, groupingSettings).map(({ ruleId = '' }) => ruleId), ['no-alert', 'no-alert']);
['no-console', ''].forEach((names) => {
    const source = `/* eslint-disable ${names} -- Authored outer scope. */
{ alert("before"); alert(console.log("target")); console.log("after"); }
/* eslint-enable ${names} */
console.log("outside");`;
    const placed = operationPlacement(source, ['no-console'], 'Native console timing.');
    const settings = { rules: { 'no-console': 'error' } };
    const original = groupingLinter.verify(source, settings);
    const originalSuppressed = groupingLinter.getSuppressedMessages();
    assert.deepEqual(groupingLinter.verify(placed, settings).map(({ ruleId = '' }) => ruleId), original.map(({ ruleId = '' }) => ruleId));
    assert.equal(groupingLinter.getSuppressedMessages().length, originalSuppressed.length);
    assert.match(placed, /Authored outer scope/u);
    assert.doesNotMatch(placed, /Native console timing/u);
});

const collision = operationPlacement('{ alert("before"); alert(console.log("target")); alert("after"); }',
    ['no-alert'], 'Native alert timing.', false, [], 'no-console');
assert.deepEqual(groupingLinter.verify(collision, groupingSettings).map(({ ruleId = '' }) => ruleId), ['no-alert', 'no-alert'], collision);
assert.deepEqual(groupingLinter.getSuppressedMessages().map(({ ruleId = '' }) => ruleId).toSorted(), ['no-alert', 'no-console']);
['no-console', ''].forEach((names) => {
    const source = `/* eslint-disable ${names} -- Authored outer scope. */
{ alert("before"); alert(console.log("target"), () => {
/* eslint-enable ${names} */
console.log("inside"); }); console.log("after"); }
console.log("outside");`;
    const placed = operationPlacement(source, ['no-console'], 'Native console timing.');
    const settings = { rules: { 'no-console': 'error' } };
    const original = groupingLinter.verify(source, settings);
    const originalSuppressed = groupingLinter.getSuppressedMessages();
    assert.deepEqual(groupingLinter.verify(placed, settings).map(({ ruleId = '' }) => ruleId), original.map(({ ruleId = '' }) => ruleId));
    assert.equal(groupingLinter.getSuppressedMessages().length, originalSuppressed.length);
    assert.doesNotMatch(placed, /Native console timing/u);
});

[' retained trailing note ', ' eslint-disable-line no-undef -- Host operation. '].forEach((trailingText) => {
    const code = operationPlacement('{ console.log("before"); alert(console.log("target")); console.log("after"); }',
        ['no-console'], 'Native call timing.', false, [['no-alert'], ['no-console', 'no-alert']], '', trailingText);
    assert.equal((code.match(/eslint-disable /gu) || []).length, 1);
    assert.equal((code.match(/eslint-enable /gu) || []).length, 1);
    assert.ok(code.includes(trailingText));
    const settings = { ...groupingSettings, rules: { ...groupingSettings.rules, 'no-undef': 'error' } };
    const messages = groupingLinter.verify(code, settings);
    assert.equal(messages.filter(({ ruleId = '' }) => ruleId === 'no-console').length, 2);
    assert.equal(messages.filter(({ ruleId = '' }) => ruleId === null).length, 0, JSON.stringify({ code, messages }));
    assert.equal(groupingLinter.getSuppressedMessages().filter(({ ruleId = '' }) => ruleId === 'no-alert').length, 1);
});

// Declaration accumulation retains all reasons once, stable paired endpoints,
// initializer trivia and visible neighbors, including an unused list member.
const repeatedDeclaration = '{ alert("before"); const result = alert(\n// Initializer note.\nconsole.log("target")\n); alert("after"); }';
const declarationContributions = [
    { rules: ['no-alert', 'no-console'], reason: 'Native alert timing.' },
    { rules: ['no-console'], reason: 'Native console timing.' },
    { rules: ['no-alert', 'no-console'], reason: 'Native alert timing.' }
];
const declarationOutput = operationPlacement(repeatedDeclaration, ['no-console'], 'Native console timing.', false, declarationContributions);
assert.equal(declarationOutput, operationPlacement(repeatedDeclaration, ['no-console'], 'Native console timing.', false,
    [...declarationContributions, ...declarationContributions]));
assert.equal((declarationOutput.match(/Native console timing\./gu) || []).length, 1);
assert.equal((declarationOutput.match(/Native alert timing\./gu) || []).length, 1);
assert.equal((declarationOutput.match(/Initializer note\./gu) || []).length, 1);
assert.match(declarationOutput, /eslint-disable no-console, no-alert --/u);
assert.match(declarationOutput, /eslint-enable no-console, no-alert/u);
assert.deepEqual(groupingLinter.verify(declarationOutput, groupingSettings).map(({ ruleId = '' }) => ruleId), ['no-alert', 'no-alert']);
const unusedDeclaration = operationPlacement(repeatedDeclaration, ['no-console', 'no-debugger'], 'Native console timing.');
assert.equal(groupingLinter.verify(unusedDeclaration, { ...groupingSettings, rules: { ...groupingSettings.rules, 'no-debugger': 'error' } })
    .filter(({ ruleId = undefined }) => ruleId === null).length, 1);

const compoundReason = 'Getter phase; getter phase';
const compoundDeclaration = operationPlacement(repeatedDeclaration, ['no-console'], compoundReason, false,
    [{ rules: ['no-alert'], reason: 'Call phase.' }, { rules: ['no-console'], reason: compoundReason }]);
assert.ok(compoundDeclaration.includes(`${compoundReason}; Call phase.`));
assert.equal(compoundDeclaration, operationPlacement(repeatedDeclaration, ['no-console'], compoundReason, false,
    [{ rules: ['no-alert'], reason: 'Call phase.' }, { rules: ['no-console'], reason: compoundReason },
        { rules: ['no-alert'], reason: 'Call phase.' }, { rules: ['no-console'], reason: compoundReason }]));
['no-console', ''].forEach((names) => {
    const source = `/* eslint-disable ${names} -- Authored outer scope. */\n${repeatedDeclaration}\n/* eslint-enable ${names} */\nconsole.log("outside");`;
    const code = operationPlacement(source, ['no-console'], 'Native console timing.');
    const settings = { rules: { 'no-console': 'error' } };
    const expected = groupingLinter.verify(source, settings);
    const { length: suppressed = 0 } = groupingLinter.getSuppressedMessages();
    assert.deepEqual(groupingLinter.verify(code, settings).map(({ ruleId = '' }) => ruleId), expected.map(({ ruleId = '' }) => ruleId));
    assert.equal(groupingLinter.getSuppressedMessages().length, suppressed);
    assert.doesNotMatch(code, /Native console timing/u);
});

// Re-entering final grouping after producers repeat their contributions must
// neither multiply retained reason echoes nor change the rendered boundary.
const repeatTree = typescript.createSourceFile('repeat.js', 'alert(console.log("target")); // Trailing note.\nalert("neighbor");', 99, true);
const firstGrouping = group(repeatTree, ({ statements: [owner = {}] = [] } = {}) => {
    nextLine(owner, 'no-alert', 'Alert timing.');
    nextLine(owner, 'no-console', 'Console timing.');
});
const { transformed: [firstGrouped = {}] = [] } = firstGrouping;
const firstOutput = print(firstGrouped);
[['no-alert'], ['no-alert', 'no-console']].forEach((names) => {
    const repeated = group(firstGrouped, ({ statements: [owner = {}] = [] } = {}) => {
        names.forEach(name => nextLine(owner, name, name === 'no-alert' ? 'Alert timing.' : 'Console timing.'));
    });
    const { transformed: [repeatedSource = {}] = [] } = repeated;

    assert.equal(print(repeatedSource), firstOutput);
    assert.ok(print(repeatedSource).includes('// Trailing note.'));
    repeated.dispose();
});
firstGrouping.dispose();

// Authored next-line payloads and their emitted target survive every statement
// position. Trailing trivia is independently owned and must never be detached.
[false, true].forEach((nonfirst) => {
    ['alert(console.log("target"));', 'const value = alert(console.log("target"));',
        'function invoke() {\n// eslint-disable-next-line no-alert -- authored\nreturn alert(console.log("target")); // trailing note\n}'].forEach((statement) => {
        const source = [nonfirst ? 'alert("before");\n' : '',
            statement.startsWith('function') ? '' : '// ordinary note\n// eslint-disable-next-line no-alert -- authored\n',
            statement, statement.startsWith('function') ? '' : ' // trailing note', '\nalert("neighbor");'].join('');
        const tree = typescript.createSourceFile('authored-position.js', source, 99, true);
        const { statements = [] } = tree;
        const owner = statements.at(Number(nonfirst));
        const { body: { statements: [returned = {}] = [] } = {} } = getObject(owner);
        const target = typescript.isFunctionDeclaration(owner) ? returned : owner;
        const result = group(tree, () => {
            nextLine(target, 'no-console, no-console', 'Generated console timing.');
            nextLine(target, 'no-console', 'Generated console timing.');
        });
        const { transformed: [placed = {}] = [] } = result;
        const output = formatResilientOutput(print(placed), typescript, placed);
        const findings = groupingLinter.verify(output, groupingSettings);
        assert.equal(findings.length, nonfirst ? 2 : 1, JSON.stringify({ output, findings }));
        assert.ok(findings.every(({ ruleId = '', line = 0 }) => ruleId === 'no-alert' && /before|neighbor/u.test(output.split('\n').at(line - 1))));
        assert.deepEqual(groupingLinter.getSuppressedMessages().map(({ ruleId = '' }) => ruleId).toSorted(), ['no-alert', 'no-console']);
        assert.ok(output.includes('// trailing note'));
        assert.deepEqual(executable(output), executable(source));
        assert.equal(formatResilientOutput(output, typescript), output);
        const regrouped = group(placed);
        const { transformed: [regroupedSource = {}] = [] } = regrouped;
        assert.equal(print(regroupedSource), print(placed));
        regrouped.dispose();
        result.dispose();
    });
});

// Identical authored payloads on another occurrence must not acquire the
// generated owner's coverage. Source trivia stays byte-exact and ordered.
const identicalAuthoredSource = [
    '// eslint-disable-next-line no-alert -- authored',
    'alert(console.log("generated-target"));',
    '/* eslint-disable-next-line no-console --',
    'Generated console timing.',
    '*/',
    '// eslint-disable-next-line no-alert -- authored',
    'alert(console.log("authored-target")); // retained trailing',
    'alert(console.log("neighbor"));'
].join('\n');
const identicalAuthoredTree = typescript.createSourceFile('identical-authored.js', identicalAuthoredSource, 99, true);
const identicalAuthoredResult = group(identicalAuthoredTree, ({ statements: [owner = {}] = [] } = {}) => {
    nextLine(owner, 'no-console', 'Generated console timing.');
});
const { transformed: [identicalPlaced = {}] = [] } = identicalAuthoredResult;
const identicalOutput = formatResilientOutput(print(identicalPlaced), typescript, identicalPlaced);
const identicalFindings = groupingLinter.verify(identicalOutput, groupingSettings);
assert.equal(identicalFindings.filter(({ ruleId = '' }) => ruleId === null).length, 1);
assert.equal(identicalFindings.filter(({ ruleId = '' }) => ruleId === 'no-console').length, 2);
assert.equal(groupingLinter.getSuppressedMessages().filter(({ ruleId = '' }) => ruleId === 'no-console').length, 1);
assert.ok(identicalOutput.includes('*/\n// eslint-disable-next-line no-alert -- authored\nalert(console.log("authored-target")); // retained trailing'));
identicalAuthoredResult.dispose();

// Repeated post-group contributions and long distinct reasons retain both
// authored and generated targets while code layout stays fixed.
const repeatedAuthoredTree = typescript.createSourceFile('repeat-authored.js',
    '// eslint-disable-next-line no-alert -- authored\nalert(console.log("target")); // trailing note\nalert("neighbor");', 99, true);
const firstAuthored = group(repeatedAuthoredTree, ({ statements: [owner = {}] = [] } = {}) => {
    nextLine(owner, 'no-console, no-console', 'Console timing.');
});
const repeatAuthored = group(firstAuthored.transformed[0], ({ statements: [owner = {}] = [] } = {}) => {
    nextLine(owner, 'no-console', 'Console timing.');
    nextLine(owner, 'no-console', 'Distinct native console timing. '.repeat(15).trim());
});
const { transformed: [repeatedAuthoredPlaced = {}] = [] } = repeatAuthored;
const repeatedAuthoredOutput = formatResilientOutput(print(repeatedAuthoredPlaced), typescript, repeatedAuthoredPlaced);
assert.equal(groupingLinter.verify(repeatedAuthoredOutput, { ...groupingSettings,
    rules: { ...groupingSettings.rules, 'max-len': ['error', { code: 200 }] } }).length, 1, repeatedAuthoredOutput);
assert.deepEqual(groupingLinter.getSuppressedMessages().map(({ ruleId = '' }) => ruleId).toSorted(), ['no-alert', 'no-console']);
assert.deepEqual(executable(repeatedAuthoredOutput), executable(print(firstAuthored.transformed[0])));
const repeatAgain = group(repeatedAuthoredPlaced);
assert.equal(print(repeatAgain.transformed[0]), print(repeatedAuthoredPlaced));
repeatAgain.dispose();
repeatAuthored.dispose();
firstAuthored.dispose();

// A direct returned fresh-slice reversal has an existing single statement
// line. The neighboring mutation remains visible; no grouping is fabricated.
const reverseSource = 'export function reverse(values) { values.reverse(); return values.slice().reverse(); }';
const reverseTree = typescript.createSourceFile('reverse-line.js', reverseSource, 99, true);
const reverseResult = group(reverseTree, root => annotateRetainedMutationBoundaries({ typescript, sourceFile: root }));
const { transformed: [reversePlaced = {}] = [] } = reverseResult;
const { outputText: reverseEmitted = '' } = typescript.transpileModule(print(reversePlaced), { compilerOptions: { target: 99 } });
const reverseOutput = formatResilientOutput(placeInlineEmissionBoundaries(reverseEmitted, typescript, reversePlaced), typescript);
const reverseLinter = new Linter();
const reverseSettings = { plugins: { resilient }, linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: { 'resilient/prefer-safe-transformations': 'error' } };
assert.doesNotMatch(reverseOutput, /eslint-disable-line/u);
assert.deepEqual(executable(reverseOutput), executable(reverseSource));
assert.equal(reverseLinter.verify(reverseOutput, reverseSettings).length, 1, reverseOutput);
assert.equal(reverseLinter.getSuppressedMessages().length, 1);
assert.equal(reverseLinter.verify(reverseOutput.replace(/^\s*\/\/ eslint-disable-next-line[^\n]*\n/gmu, ''), reverseSettings).length, 2);
const reverseRuntime = await import(`data:text/javascript,${encodeURIComponent(reverseOutput)}`);
const reverseValues = [1, 2, 3];
const { reverse: runtimeReverse = () => {} } = reverseRuntime;
assert.deepEqual(runtimeReverse(reverseValues), [1, 2, 3]);
assert.deepEqual(reverseValues, [3, 2, 1]);
reverseResult.dispose();

// A before-compiler expression gap remains rejected: transpilation collapses
// it. The completed emitted-line migration below uses the actual final span.
const callbackCounterexample = 'function run() { return apply(console.log("before"), m => b => alert(console.log("target")), console.log("after")); }';
const callbackTree = typescript.createSourceFile('callback-counterexample.js', callbackCounterexample, 99, true);
const { statements: [{ body: { statements: [{ expression: { arguments: [, callbackOwner = {}] = [] } = {} } = {}] = [] } = {} } = {}] = [] } = callbackTree;
const callbackResult = group(callbackTree, () => nextLine(callbackOwner, 'no-console', 'Console timing.'));
const { transformed: [callbackPlaced = {}] = [] } = callbackResult;
const { outputText: callbackEmitted = '' } = typescript.transpileModule(print(callbackPlaced), { compilerOptions: { target: 99 } });
const callbackOutput = formatResilientOutput(callbackEmitted, typescript);
assert.equal(groupingLinter.verify(callbackOutput, groupingSettings).filter(({ ruleId = '' }) => ruleId === 'no-console').length, 1);
assert.equal(groupingLinter.getSuppressedMessages().filter(({ ruleId = '' }) => ruleId === 'no-console').length, 2);
assert.deepEqual(executable(callbackOutput), executable(callbackCounterexample));
callbackResult.dispose();

// A retained lifetime reference in a class heritage clause has a header line;
// it needs no enclosing class scope and never enables a disabled outer rule.
const heritageSource = 'class Early extends Later {}\nfunction Later() {}';
const heritageTree = typescript.createSourceFile('heritage-line.js', heritageSource, 99, true);
const { statements: [{ heritageClauses: [{ types: [{ expression: heritageReference = {} } = {}] = [] } = {}] = [] } = {}] = [] } = heritageTree;
const heritageKey = getConsumerContractKey(heritageReference);
const heritageResult = typescript.transform(heritageTree, [context => root => groupNextLineExceptions({ typescript, context,
    sourceFile: annotateCyclicRuntimeBindingReferences({ typescript, sourceFile: root, context,
        destructuringAgreements: { byKind: new Map([['native-function-reference', [{ contract: { sourceRange: heritageKey } }]]]) } }) })]);
const { transformed: [heritagePlaced = {}] = [] } = heritageResult;
const heritageOutput = formatResilientOutput(print(heritagePlaced), typescript);
assert.doesNotMatch(heritageOutput, /eslint-disable-line|eslint-enable/u);
assert.deepEqual(executable(heritageOutput), executable(heritageSource));
assert.deepEqual(groupingLinter.verify(heritageOutput, { rules: { 'no-use-before-define': ['error', { functions: true }] } }), []);
assert.equal(groupingLinter.getSuppressedMessages().length, 1);
heritageResult.dispose();

// Header placement is guarded by ordinary trivia. A comment inside the binding
// or heritage keeps its original expression boundary through actual transpilation.
[false, true].forEach((withNote) => {
    const source = `function assign(entries, output) { for (const [${withNote ? '\n// key note\n' : ''}key, value] of entries) { output[key] = value; } }`;
    const tree = typescript.createSourceFile('iteration-trivia.js', source, 99, true);
    const { statements: [{ body: { statements: [loop = {}] = [] } = {} } = {}] = [] } = tree;
    const result = typescript.transform(tree, [context => root => groupNextLineExceptions({ typescript, context,
        sourceFile: annotateRetainedDynamicMemberAccess({ typescript, sourceFile: root, context,
            destructuringAgreements: { operationalLoops: new Set([getConsumerContractKey(loop)]) } }) })]);
    const { transformed: [placed = {}] = [] } = result;
    const { outputText = '' } = typescript.transpileModule(print(placed), { compilerOptions: { target: 99 } });
    const output = formatResilientOutput(outputText, typescript);
    const settings = { plugins: { resilient }, linterOptions: { reportUnusedDisableDirectives: 'error' },
        rules: { 'resilient/prefer-safe-destructuring-defaults': 'error', 'resilient/prefer-prototype-methods': 'error' } };
    assert.deepEqual(groupingLinter.verify(output, settings), [], output);
    assert.equal(groupingLinter.getSuppressedMessages().length, 3);
    assert.equal(/eslint-disable-line resilient\/prefer-safe-destructuring-defaults/u.test(output), withNote);
    assert.equal(output.includes('// key note'), withNote);
    assert.deepEqual(executable(output), executable(source));
    assert.equal(formatResilientOutput(output, typescript), output);
    result.dispose();
});
[false, true].forEach((withNote) => {
    const source = `class Early extends${withNote ? '\n// base note\n' : ' '}Later {}\nfunction Later() {}`;
    const tree = typescript.createSourceFile('heritage-trivia.js', source, 99, true);
    const { statements: [{ heritageClauses: [{ types: [{ expression: reference = {} } = {}] = [] } = {}] = [] } = {}] = [] } = tree;
    const result = typescript.transform(tree, [context => root => groupNextLineExceptions({ typescript, context,
        sourceFile: annotateCyclicRuntimeBindingReferences({ typescript, sourceFile: root, context,
            destructuringAgreements: { byKind: new Map([['native-function-reference', [{ contract: { sourceRange: getConsumerContractKey(reference) } }]]]) } }) })]);
    const { transformed: [placed = {}] = [] } = result;
    const { outputText = '' } = typescript.transpileModule(print(placed), { compilerOptions: { target: 99 } });
    const output = formatResilientOutput(outputText, typescript);
    assert.deepEqual(groupingLinter.verify(output, { linterOptions: { reportUnusedDisableDirectives: 'error' },
        rules: { 'no-use-before-define': ['error', { functions: true }] } }), [], output);
    assert.equal(groupingLinter.getSuppressedMessages().length, 1);
    assert.equal(/eslint-disable-line/u.test(output), withNote);
    assert.equal(output.includes('// base note'), withNote);
    assert.deepEqual(executable(output), executable(source));
    assert.equal(formatResilientOutput(output, typescript), output);
    result.dispose();
});
const typeHeritage = typescript.createSourceFile('type-heritage.ts', 'class Container { method() { interface Erased extends Later {} } }\ninterface Later {}', 99, true);
const { statements: [{ members: [{ body: { statements: [erasedInterface = {}] = [] } = {} } = {}] = [] } = {}] = [] } = typeHeritage;
const { heritageClauses: [{ types: [{ expression: erasedReference = {} } = {}] = [] } = {}] = [] } = erasedInterface;
const erasedResult = typescript.transform(typeHeritage, [context => root => annotateCyclicRuntimeBindingReferences({ typescript, sourceFile: root, context,
    destructuringAgreements: { byKind: new Map([['native-function-reference', [{ contract: { sourceRange: getConsumerContractKey(erasedReference) } }]]]) } })]);
const { transformed: [erasedPlaced = {}] = [] } = erasedResult;
assert.doesNotMatch(print(erasedPlaced), /eslint-disable/u);
erasedResult.dispose();

[false, true].forEach((nonfirst) => {
    const authored = '/* eslint-disable-next-line no-alert -- Authored block reason. */';
    const source = `${nonfirst ? 'alert("before");\n' : ''}${authored}\nalert(console.log("target")); // block trailing note\nalert("after");`;
    const tree = typescript.createSourceFile('authored-block.js', source, 99, true);
    const { statements = [] } = tree;
    const owner = statements.at(Number(nonfirst));
    const result = group(tree, () => nextLine(owner, 'no-console', 'Console timing.'));
    const { transformed: [placed = {}] = [] } = result;
    const output = formatResilientOutput(print(placed), typescript, placed);
    assert.equal(groupingLinter.verify(output, groupingSettings).length, nonfirst ? 2 : 1, output);
    assert.deepEqual(groupingLinter.getSuppressedMessages().map(({ ruleId = '' }) => ruleId).toSorted(), ['no-alert', 'no-console']);
    assert.ok(output.includes(authored));
    assert.ok(output.includes('// block trailing note'));
    assert.deepEqual(executable(output), executable(source));
    assert.equal(formatResilientOutput(output, typescript), output);
    result.dispose();
});

// A multiline authored next-line block has a different endpoint. Keep the
// original stack rather than moving its payload or silently changing scope.
const authoredMultiline = 'function run() {\n/* eslint-disable-next-line no-alert --\n    Authored multiline reason.\n    */\nalert(console.log("target")); // trailing note\n}';
const authoredMultilineTree = typescript.createSourceFile('authored-multiline.js', authoredMultiline, 99, true);
const { statements: [{ body: { statements: [multilineOwner = {}] = [] } = {} } = {}] = [] } = authoredMultilineTree;
nextLine(multilineOwner, 'no-console', 'Console timing.');
const baselineMultiline = formatResilientOutput(print(authoredMultilineTree), typescript);
const multilineResult = group(authoredMultilineTree, () => nextLine(multilineOwner, 'no-console', 'Console timing.'));
const { transformed: [multilinePlaced = {}] = [] } = multilineResult;
assert.equal(formatResilientOutput(print(multilinePlaced), typescript, multilinePlaced), baselineMultiline);
assert.equal(groupingLinter.verify(baselineMultiline, groupingSettings).filter(({ ruleId = '' }) => ruleId === null).length, 1);
assert.equal(groupingLinter.getSuppressedMessages().filter(({ ruleId = '' }) => ruleId === 'no-console').length, 1);
multilineResult.dispose();

// Typed printer syntax must retain the same occurrence before compiler erasure.
const typedCollision = [
    'type Box<A> = { value: A }; const identity = <A>(value: A): A => value;',
    '// eslint-disable-next-line no-debugger',
    'while (true) { console.log("target"); break; }',
    'while (true) { console.log("neighbor"); break; }'
].join('\n');
const typedTree = typescript.createSourceFile('typed-collision.ts', typedCollision, 99, true, typescript.ScriptKind.TS);
const typedResult = group(typedTree, (root) => {
    const owner = root.statements.find(statement => typescript.isWhileStatement(statement));
    nextLine(owner, 'no-constant-condition', 'Native loop termination.');
});
const { transformed: [typedPlaced = {}] = [] } = typedResult;
const typedInput = placeEmissionBoundaries(print(typedPlaced), typescript, typedPlaced);
const { outputText: typedEmitted = '' } = typescript.transpileModule(typedInput, { compilerOptions: { target: 99 } });
const typedOutput = formatResilientOutput(typedEmitted, typescript);
const typedSettings = { linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: { 'no-console': 'error', 'no-debugger': 'error', 'no-constant-condition': ['error', { checkLoops: 'all' }] } };
assert.deepEqual(groupingLinter.verify(typedOutput, typedSettings).map(({ ruleId = '' }) => ruleId).toSorted(), ['no-console', 'no-console', 'no-constant-condition', null]);
assert.deepEqual(groupingLinter.getSuppressedMessages().map(({ ruleId = '' }) => ruleId).toSorted(), ['no-constant-condition']);
typedResult.dispose();

// These operations own their emitted physical line, including any neighbors
// already covered by the original inline directive. Migration preserves that
// exact set rather than guessing which subexpression a lint rule will report.
const diagnosticAnchors = (code, messages) => {
    const tree = typescript.createSourceFile('anchors.js', code, 99, true, typescript.ScriptKind.JS);
    let tokens = [];
    const visit = (node) => {
        const { kind = 0 } = getObject(node);

        if (kind === typescript.SyntaxKind.EndOfFileToken) return;

        if (kind <= typescript.SyntaxKind.LastToken) {
            tokens = [...tokens, node];

            return;
        }

        node.getChildren(tree).forEach(visit);
    };
    visit(tree);

    return messages.map(({ ruleId = '', messageId = '', message = '', line = 1, column = 1 }) => {
        const position = tree.getPositionOfLineAndCharacter(line - 1, column - 1);
        const [range = {}] = [...typescript.getLeadingCommentRanges(code, position) || [],
            ...typescript.getTrailingCommentRanges(code, position) || []];
        const { pos = position, end = position } = range;
        const text = code.slice(pos, end);
        const targetLine = /eslint-disable-next-line\b/u.test(text) ? tree.getLineAndCharacterOfPosition(end).line + 1 : line - 1;
        const anchor = !ruleId && /eslint-disable-(?:next-)?line\b/u.test(text)
            ? tree.getPositionOfLineAndCharacter(targetLine, 0) : position;

        return [ruleId, messageId, message, tokens.findIndex(token => getObject(token).end > anchor)];
    }).toSorted();
};
const physicalShapes = [
    'const result = m => b => alert(console.log("target"));',
    'const result = ok ? alert(console.log("before")) : alert(console.log("target"));',
    'const result = [alert(console.log("before")), ...console.log("target"), alert(console.log("after"))];',
    'const result = apply(alert(console.log("before")), m => b => alert(console.log("target")), /* neighbor note */ alert(console.log("after")));',
    'const result = alert(console.log("target")) + alert(console.log("after"));',
    'function run() { return alert(console.log("target")) + alert(console.log("after")); }',
    'function run() { throw alert(console.log("target")); }',
    'const result = apply(\n// ordinary note\nalert(console.log("target")), // trailing note\nalert(console.log("after")));'
];
const physicalSettings = { linterOptions: { reportUnusedDisableDirectives: 'error' }, rules: { 'no-alert': 'error', 'no-console': 'error', 'no-debugger': 'error' } };
[false, true].forEach((nonfirst) => {
    physicalShapes.forEach((shape) => {
        ['', '/* eslint-disable no-alert */\n', '/* eslint-disable */\n'].forEach((scope) => {
            ['no-console', 'no-console, no-alert', 'no-console, no-debugger'].forEach((names) => {
                ['Console timing.', 'Native console timing and failure order are retained. '.repeat(8).trim()].forEach((reason) => {
                    const source = `${scope}${nonfirst ? 'alert(console.log("first"));\n' : ''}${shape}\nalert(console.log("neighbor"));${scope ? '\n/* eslint-enable */' : ''}`;
                    const tree = typescript.createSourceFile('physical-line.ts', source, 99, true, typescript.ScriptKind.TS);
                    const result = group(tree, (root) => {
                        const visit = (node) => {
                            if (typescript.isCallExpression(node) && getObject(node.arguments.at(0)).text === 'target') {
                                typescript.addSyntheticTrailingComment(node, typescript.SyntaxKind.MultiLineCommentTrivia,
                                    ` eslint-disable-line ${names} -- ${reason} `, false);
                            }

                            typescript.forEachChild(node, visit);
                        };
                        visit(root);
                    });
                    const { transformed: [placed = {}] = [] } = result;
                    const { outputText: emitted = '' } = typescript.transpileModule(print(placed), { compilerOptions: { target: 99 } });
                    const baseline = formatResilientOutput(emitted, typescript);
                    const moved = placeInlineEmissionBoundaries(emitted, typescript, placed);
                    const output = formatResilientOutput(moved, typescript);
                    const before = groupingLinter.verify(baseline, physicalSettings);
                    const suppressedBefore = groupingLinter.getSuppressedMessages();
                    const after = groupingLinter.verify(output, physicalSettings);
                    const suppressedAfter = groupingLinter.getSuppressedMessages();
                    assert.deepEqual(executable(output), executable(baseline));
                    assert.deepEqual(diagnosticAnchors(output, after), diagnosticAnchors(baseline, before), JSON.stringify({ baseline, output, before, after }));
                    assert.deepEqual(diagnosticAnchors(output, suppressedAfter), diagnosticAnchors(baseline, suppressedBefore));
                    assert.doesNotMatch(output, /eslint-disable-line\b/u);
                    assert.equal(placeInlineEmissionBoundaries(output, typescript, placed), output);
                    assert.equal(formatResilientOutput(output, typescript), output);
                    ['ordinary note', 'trailing note', 'neighbor note'].filter(note => source.includes(note)).forEach(note => assert.equal(output.split(note).length, 2));
                    const without = output.replace(/\/\*\s*eslint-disable-next-line[\s\S]*?\*\//gu, '')
                        .replace(/^\s*\/\/ eslint-disable-next-line[^\n]*\n/gmu, '');
                    const unsuppressed = groupingLinter.verify(without, physicalSettings);
                    const baselineWithout = baseline.replace(/\/\*\s*eslint-disable-line[\s\S]*?\*\//gu, '');
                    assert.deepEqual(diagnosticAnchors(without, unsuppressed),
                        diagnosticAnchors(baselineWithout, groupingLinter.verify(baselineWithout, physicalSettings)));
                    const execute = (code) => {
                        let calls = [];
                        const consoleProof = { log: (value) => { calls = [...calls, ['console', value]];

                            return [value]; } };
                        const alertProof = (value) => { calls = [...calls, ['alert', value]];

                            return value; };
                        let value;

                        try {
                            const invoke = new Function('console', 'alert', 'apply', 'ok',
                                `${code}\nreturn typeof run === 'function' ? run() : result;`);
                            value = invoke(consoleProof, alertProof, (...values) => values, true);

                            const resolve = (pending) => {
                                if (typeof pending === 'function') return resolve(pending({}));

                                return Array.isArray(pending) ? pending.map(resolve) : pending;
                            };
                            value = resolve(value);
                        } catch (error) {
                            value = error;
                        }

                        return { calls, value };
                    };
                    assert.deepEqual(execute(output), execute(baseline));
                    result.dispose();
                });
            });
        });
    });
});

// Guarded forms retain exact directive precedence, authored provenance and
// unused members. Compatible distinct contributions on one line can unite.
[
    { source: '// eslint-disable-next-line no-console -- authored precedence\nalert(console.log("target"));', names: ['no-console'], retained: true },
    { source: '// eslint-disable-next-line\nalert(console.log("target"));', names: ['no-console'], retained: true },
    { source: '/* eslint-disable-next-line no-alert --\nAuthored multiline reason.\n*/\nalert(console.log("target"));', names: ['no-console'], retained: true },
    { source: 'alert(console.log("target")); /* eslint-disable-line no-console -- Console timing. */', names: ['no-console'], retained: true },
    { source: 'alert(console.log("target"));', names: ['no-console', 'no-console'], retained: true },
    { source: 'alert(console.log("target"));', names: ['no-console', 'no-alert'], retained: false },
    { source: 'alert(console.log("target"));', names: ['no-console, no-console'], retained: false },
    { source: 'const result = `head\n${console.log("target")}\ntail`;', names: ['no-console'], retained: true },
    { source: '// eslint-disable-next-line no-alert -- authored separate rule\nalert(console.log("target"));', names: ['no-console'], retained: false },
    { source: '/* eslint-disable-line no-console -- authored earlier */ alert(console.log("target"));', names: ['no-console'], retained: true },
    { source: '/* eslint-disable-line */ alert(console.log("target"));', names: ['no-console'], retained: true },
    { source: 'alert(console.log("target")); /* eslint-disable-line no-console -- authored later */', names: ['no-console'], retained: false },
    { source: '/* eslint-disable-line no-alert -- authored disjoint */ alert(console.log("target"));', names: ['no-console'], retained: false }
].forEach(({ source = '', names = [], retained = false } = {}) => {
    const tree = typescript.createSourceFile('physical-guard.js', source, 99, true, typescript.ScriptKind.JS);
    const result = group(tree, (root) => {
        const visit = (node) => {
            if (typescript.isCallExpression(node) && getObject(node.arguments.at(0)).text === 'target') {
                names.forEach(rule => typescript.addSyntheticTrailingComment(node, typescript.SyntaxKind.MultiLineCommentTrivia,
                    ` eslint-disable-line ${rule} -- Console timing. `, false));
            }

            typescript.forEachChild(node, visit);
        };
        visit(root);
    });
    const { transformed: [placed = {}] = [] } = result;
    const { outputText: emitted = '' } = typescript.transpileModule(print(placed), { compilerOptions: { target: 99 } });
    const moved = placeInlineEmissionBoundaries(emitted, typescript, placed);
    const baseline = formatResilientOutput(emitted, typescript);
    const output = formatResilientOutput(moved, typescript);
    const before = groupingLinter.verify(baseline, physicalSettings);
    const suppressedBefore = groupingLinter.getSuppressedMessages();
    assert.equal(moved === emitted, retained, JSON.stringify({ source, moved, emitted }));
    assert.deepEqual(diagnosticAnchors(output, groupingLinter.verify(output, physicalSettings)), diagnosticAnchors(baseline, before));
    assert.deepEqual(diagnosticAnchors(output, groupingLinter.getSuppressedMessages()), diagnosticAnchors(baseline, suppressedBefore));
    assert.deepEqual(executable(output), executable(baseline));
    assert.equal(formatResilientOutput(output, typescript), output);
    result.dispose();
});

// Restoring a bare or overlapping authored next-line predecessor would change
// which directive is unused. Keep its original stack under the debt contract.
['no-console -- authored precedence', '', "'no-console' -- authored precedence", '"no-console" -- authored precedence',
    'no-console --- authored precedence', ',', '"" ,'].forEach((authoredRules) => {
    const source = `// eslint-disable-next-line ${authoredRules}\nalert(console.log("target"));\nalert(console.log("neighbor"));`;
    const tree = typescript.createSourceFile('authored-precedence.js', source, 99, true, typescript.ScriptKind.JS);
    let baselinePrinted = '';
    const result = group(tree, ({ statements: [owner = {}] = [] } = {}) => {
        nextLine(owner, 'no-console', 'Generated timing.');
        baselinePrinted = print(tree);
    });
    const { transformed: [placed = {}] = [] } = result;
    const { outputText: baselineEmitted = '' } = typescript.transpileModule(baselinePrinted, { compilerOptions: { target: 99 } });
    const { outputText: emitted = '' } = typescript.transpileModule(placeEmissionBoundaries(print(placed), typescript, placed), { compilerOptions: { target: 99 } });
    const baseline = formatResilientOutput(baselineEmitted, typescript);
    const output = formatResilientOutput(emitted, typescript);
    assert.equal(output, baseline);
    const messages = groupingLinter.verify(output, physicalSettings);
    assert.equal(messages.filter(({ ruleId = '' }) => !ruleId).length, 1);
    assert.deepEqual(groupingLinter.getSuppressedMessages().map(({ ruleId = '' }) => ruleId), ['no-console']);
    assert.equal(groupingLinter.verify(source, physicalSettings).filter(({ ruleId = '' }) => !ruleId).length, 0);
    result.dispose();
});

["'no-console' -- authored earlier", '"no-console" -- authored earlier', 'no-console --- authored earlier', ',', '"" ,'].forEach((names) => {
    ['/* eslint-disable-line ', '// eslint-disable-next-line '].forEach((prefix) => {
        const source = prefix.startsWith('/*')
            ? `${prefix}${names} */ alert(console.log("target"));`
            : `${prefix}${names}\nalert(console.log("target"));`;
        const tree = typescript.createSourceFile('directive-grammar.js', source, 99, true, typescript.ScriptKind.JS);
        const result = group(tree, (root) => {
            const visit = (node) => {
                if (typescript.isCallExpression(node) && getObject(node.arguments.at(0)).text === 'target') {
                    typescript.addSyntheticTrailingComment(node, typescript.SyntaxKind.MultiLineCommentTrivia,
                        ' eslint-disable-line no-console -- Generated timing. ', false);
                }

                typescript.forEachChild(node, visit);
            };
            visit(root);
        });
        const { transformed: [placed = {}] = [] } = result;
        const { outputText: emitted = '' } = typescript.transpileModule(print(placed), { compilerOptions: { target: 99 } });
        assert.equal(placeInlineEmissionBoundaries(emitted, typescript, placed), emitted, source);
        result.dispose();
    });
});
const crossingSource = '// eslint-disable-next-line no-alert -- authored precedence\nalert(console.log("target")); // trailing note\nalert(console.log("neighbor"));';
const crossingTree = typescript.createSourceFile('crossing.js', crossingSource, 99, true, typescript.ScriptKind.JS);
const crossingFirst = group(crossingTree, ({ statements: [owner = {}] = [] } = {}) => nextLine(owner, 'no-console', 'Console timing.'));
const { transformed: [crossingPlaced = {}] = [] } = crossingFirst;
const crossingNext = group(crossingPlaced, ({ statements: [owner = {}] = [] } = {}) => nextLine(owner, 'no-alert', 'New redundant alert contribution.'));
const { transformed: [crossingUpdated = {}] = [] } = crossingNext;
const { outputText: crossingEmitted = '' } = typescript.transpileModule(placeEmissionBoundaries(print(crossingUpdated), typescript, crossingUpdated), { compilerOptions: { target: 99 } });
const crossingOutput = formatResilientOutput(crossingEmitted, typescript);
const crossingMessages = groupingLinter.verify(crossingOutput, physicalSettings);
assert.equal(crossingMessages.filter(({ ruleId = '' }) => !ruleId).length, 1);
assert.ok(crossingMessages.find(({ ruleId = '' }) => !ruleId).message.includes('no-alert'));
assert.deepEqual(groupingLinter.getSuppressedMessages().map(({ ruleId = '' }) => ruleId).toSorted(), ['no-alert', 'no-console']);
const { line: crossingUnusedLine = 1 } = getObject(crossingMessages.find(({ ruleId = '' }) => !ruleId));
assert.match(crossingOutput.split('\n').at(crossingUnusedLine - 1), /no-console, no-alert/u);
assert.equal(crossingOutput.split('// eslint-disable-next-line no-alert -- authored precedence').length, 2);
assert.equal(crossingOutput.split('// trailing note').length, 2);
const crossingAgain = group(crossingUpdated);
assert.equal(print(crossingAgain.transformed[0]), print(crossingUpdated));
crossingAgain.dispose();
crossingNext.dispose();
crossingFirst.dispose();

// An authored bridge on another executable line belongs to that line's owner.
// Retain the second inline endpoint rather than scheduling coincident insertions.
['// eslint-disable-next-line no-alert', '/* eslint-disable-next-line no-alert */'].forEach((bridge) => {
    const source = `console.log("first"); ${bridge}\nalert(console.log("second"));\nalert(console.log("neighbor"));`;
    const tree = typescript.createSourceFile('adjacent.js', source, 99, true, typescript.ScriptKind.JS);
    const result = group(tree, (root) => {
        const visit = (node) => {
            const { arguments: args = [] } = getObject(node);
            const { text = '' } = getObject(args.at(0));

            if (typescript.isCallExpression(node) && ['first', 'second'].includes(text)) {
                typescript.addSyntheticTrailingComment(node, typescript.SyntaxKind.MultiLineCommentTrivia,
                    ` eslint-disable-line no-console -- ${text} timing. `, false);
            }

            typescript.forEachChild(node, visit);
        };
        visit(root);
    });
    const { transformed: [placed = {}] = [] } = result;
    const { outputText: emitted = '' } = typescript.transpileModule(print(placed), { compilerOptions: { target: 99 } });
    const baseline = formatResilientOutput(emitted, typescript);
    const output = formatResilientOutput(placeInlineEmissionBoundaries(emitted, typescript, placed), typescript);
    const before = groupingLinter.verify(baseline, physicalSettings);
    const suppressedBefore = groupingLinter.getSuppressedMessages();
    assert.deepEqual(diagnosticAnchors(output, groupingLinter.verify(output, physicalSettings)), diagnosticAnchors(baseline, before));
    assert.deepEqual(diagnosticAnchors(output, groupingLinter.getSuppressedMessages()), diagnosticAnchors(baseline, suppressedBefore));
    assert.deepEqual(executable(output), executable(baseline));
    assert.match(output, /eslint-disable-line no-console -- second timing\./u);
    assert.match(output, /eslint-disable-next-line no-console -- first timing\./u);
    assert.equal(formatResilientOutput(output, typescript), output);
    result.dispose();
});
