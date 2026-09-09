import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';

import { getObject } from '../rules/support/object.js';
import { getExceptionInventory } from '../scripts/audit-eslint-exceptions.js';
import { hasArrayLengthDecision } from '../transforms/typescript/grammar/guards.js';
import { getConsumerContractKey } from '../transforms/typescript/understand/type-evidence.js';
import { getSyntaxKinds } from '../transforms/utils/ast-boundary.js';
import { getChildren } from '../transforms/utils/ast-traversal.js';

const read = (file = '') => fs.readFileSync(new URL(`../transforms/typescript/${file}`, import.meta.url), 'utf8');
const parse = (source = '') => typescript.createSourceFile('owner.js', source, typescript.ScriptTarget.ESNext, true);
const nodes = (node = {}) => {
    let found = [node];
    typescript.forEachChild(node, (child) => { found = [...found, ...nodes(child)]; });

    return found;
};
// Execute the actual complete private arrow. Only lexical dependencies become
// explicit proof inputs; no copied walker, replacement body or production API.
const owner = ({ file = '', name = '', occurrence = 0, context = {} } = {}) => {
    const source = read(file);
    const root = parse(source);
    const declarations = nodes(root).filter(node => typescript.isVariableDeclaration(node) && node.name.getText(root) === name);
    const [{ initializer = {} } = {}] = declarations.slice(occurrence, occurrence + 1);
    assert.ok(typescript.isArrowFunction(initializer), name);

    return runInNewContext(`(${initializer.getText(root)})`, {
        ...typescript.SyntaxKind, typescript, getObject, getSyntaxKinds, getConsumerContractKey, ...context
    });
};
const failure = new Error('walk boundary');
const poisonParent = { get parent() { throw failure; } };
const { SyntaxKind: { ArrowFunction = -1, Block = -1, SourceFile = -1, Identifier = -1, VariableDeclaration = -1, ReturnStatement = -1,
    CallExpression = -1, PropertyAccessExpression = -1, ConditionalExpression = -1, ForOfStatement = -1 } = {} } = typescript;
const typeFile = 'understand/type-evidence.js';

// Bounded ancestor-only owner: terminal function kind prevents parent Get.
// The neighboring reduce owner is deliberately different: it keeps reading
// parents after finding a function. Beyond-64 and cycles are finite here only.
const bounded = owner({ file: typeFile, name: 'getEnclosingFunction', context: { functionKinds: [ArrowFunction] } });
const terminalFunction = { kind: ArrowFunction, get parent() { throw failure; } };
assert.equal(bounded({ parent: terminalFunction }), terminalFunction);
assert.equal(Object.keys(bounded({ kind: ArrowFunction } )).length, 0, 'Input function is not an ancestor.');
const chain = Array.from({ length: 65 }).reduce(parent => ({ kind: Block, parent }), terminalFunction);
assert.equal(Object.keys(bounded({ parent: chain })).length, 0);
const cycle = { kind: Block };
Object.defineProperty(cycle, 'parent', { value: cycle });
let visits = 0;
const observedCycle = { get kind() { visits += 1;

    return Block; }, get parent() { return observedCycle; } };
assert.equal(Object.keys(bounded({ parent: observedCycle })).length, 0);
assert.equal(visits, 64);
assert.throws(() => bounded({ parent: poisonParent }), error => error === failure);
const continued = owner({ file: typeFile, name: 'getEnclosingFunction', occurrence: 1,
    context: { functionKinds: [ArrowFunction] } });
assert.throws(() => continued({ parent: terminalFunction }), error => error === failure);
const unbounded = owner({ file: typeFile, name: 'getEnclosingFunction', occurrence: 2 });
assert.equal(unbounded({ typescript, node: { parent: chain } }), terminalFunction);
assert.equal(unbounded({ typescript, node: { parent: false } }).kind, undefined);
assert.throws(() => unbounded({ typescript, node: { parent: poisonParent } }), error => error === failure);
// This owner intentionally has no absent-root termination or cycle guard.
// A throwing observation bounds this proof without hiding that limitation.
let repeated = 0;
const rootless = { get parent() { repeated += 1;

    if (repeated === 70) throw failure;

    return rootless; } };
assert.throws(() => unbounded({ typescript, node: { parent: rootless } }), error => error === failure);
assert.equal(repeated, 70);

// Loop owner reads the terminal loop's parent before returning; unlike bounded
// function lookup, early kind discovery does not skip that observable Get.
const liveLoop = owner({ file: typeFile, name: 'hasLiveLoopOwner' });
assert.equal(liveLoop({ parent: { kind: ForOfStatement, parent: false } }), true);
assert.equal(liveLoop({ kind: ForOfStatement }), false);
assert.throws(() => liveLoop({ parent: { kind: ForOfStatement,
    get parent() { throw failure; } } }), error => error === failure);
assert.equal(liveLoop({ parent: { kind: Block, parent: false } }), false);

const typePosition = owner({ file: 'understand/imports.js', name: 'isTypePosition' });
let typeQueries = [];
const typeCompiler = { ...typescript, isTypeNode: (node) => { typeQueries = [...typeQueries, node];

    return node === terminalFunction; } };
// Give this type candidate a benign parent; the poison above belongs to a
// different law and is tested separately, rather than normalized away.
assert.throws(() => typePosition({ typescript: typeCompiler, node: { parent: terminalFunction } }), error => error === failure);
const typeCandidate = { kind: Block, parent: false };
assert.equal(typePosition({ typescript: { ...typescript, isTypeNode: node => node === typeCandidate }, node: { parent: typeCandidate } }), true);
assert.equal(typePosition({ typescript: typeCompiler, node: { parent: { kind: SourceFile, parent: false } } }), false);
assert.equal(typeQueries.length, 0, 'SourceFile terminates before the compiler type query.');
assert.equal(typePosition({ node: {} }), false);

const ownerName = owner({ file: typeFile, name: 'getFunctionOwnerName' });
const initializer = { parent: false };
const declaration = { kind: VariableDeclaration, initializer, name: { kind: Identifier, text: 'owner' },
    get parent() { throw failure; } };
Object.defineProperty(initializer, 'parent', { value: declaration });
assert.equal(ownerName(initializer), 'owner');
assert.equal(ownerName(cycle), '');
assert.equal(ownerName({ parent: { kind: VariableDeclaration, name: { kind: Identifier, text: 'wrong' } } }), '');
assert.throws(() => ownerName(poisonParent), error => error === failure);

const spine = owner({ file: typeFile, name: 'ownsEvaluationSpine' });
const call = {};
const property = { kind: PropertyAccessExpression, expression: call };
const outerCall = { kind: CallExpression, expression: property };
const returned = { kind: ReturnStatement, expression: outerCall, get parent() { throw failure; } };
Object.defineProperties(call, { parent: { value: property } });
Object.defineProperties(property, { parent: { value: outerCall } });
Object.defineProperties(outerCall, { parent: { value: returned } });
assert.equal(spine(call), true);
const selected = {};
Object.defineProperty(selected, 'parent', { value: { kind: ConditionalExpression, whenFalse: selected } });
assert.equal(spine(selected), true);
const otherArm = {};
Object.defineProperty(otherArm, 'parent', { value: { kind: ConditionalExpression, whenTrue: otherArm } });
assert.equal(spine(otherArm), false);
assert.equal(spine({ parent: { kind: CallExpression, arguments: [call] } }), false);
assert.throws(() => spine(poisonParent), error => error === failure);

let checkerEvents = [];
const symbol = {};
const resolver = {};
const parameter = { name: {} };
const executor = { parameters: [parameter] };
const promise = { pos: 10, end: 20, get parent() { throw failure; } };
const checker = { token: symbol };
const resolverOwner = owner({ file: typeFile, name: 'ownsResolver', context: {
    checker, nativePromise: (node) => { checkerEvents = [...checkerEvents, 'native'];

        return node === promise ? executor : false; },
    getSymbolAtLocation: function (node) {
        assert.equal(this, checker);
        checkerEvents = [...checkerEvents, node === resolver ? 'resolver' : 'parameter'];

        return symbol;
    }
} });
assert.equal(resolverOwner({ parent: promise }, resolver), '10:20');
assert.deepEqual(checkerEvents, ['resolver', 'native', 'parameter']);
assert.throws(() => resolverOwner({ parent: poisonParent }, resolver), error => error === failure);
assert.equal(resolverOwner({ parent: false }, resolver), '');

const typeParameter = owner({ file: 'understand/type-resolution.js', name: 'getEnclosingTypeParameter' });
const parameterA = { name: { text: 'A' } };
assert.equal(typeParameter({ typescript, node: { parent: { typeParameters: [parameterA], parent: false } }, name: 'A' }), parameterA);
assert.equal(Object.keys(typeParameter({ typescript, node: { parent: { kind: SourceFile, typeParameters: [parameterA] } }, name: 'A' })).length, 0);
assert.throws(() => typeParameter({ typescript, node: { parent: { typeParameters: [parameterA], get parent() { throw failure; } } }, name: 'A' }), error => error === failure);
assert.equal(Object.keys(typeParameter({ typescript, name: 'missing' })).length, 0);

// Guard walk owns every outward block, not just the first block or SourceFile.
const guardRoot = parse('function read(values) { if (values.length > 0) return values[0]; { use(values); } }');
const blocks = nodes(guardRoot).filter(typescript.isBlock);
const [outerBlock = {}, innerBlock = {}] = blocks;
assert.equal(hasArrayLengthDecision({ typescript, node: innerBlock, sourceName: 'values' }), true);
assert.equal(hasArrayLengthDecision({ typescript, node: innerBlock, sourceName: 'other' }), false);
assert.equal(hasArrayLengthDecision({ typescript, node: { get kind() { throw failure; } } }), false);
assert.throws(() => hasArrayLengthDecision({ typescript, node: { kind: Block, statements: Reflect.get(outerBlock, 'statements'),
    get parent() { throw failure; } }, sourceName: 'values' }), error => error === failure);

const guardedRead = owner({ file: 'members/generic.js', name: 'isGuardedRead', context: {
    SourceFileKind2: SourceFile, getReadGuardRoot: value => getObject(value).root || ''
} });
assert.equal(guardedRead({ expression: { text: 'value' }, parent: { kind: ConditionalExpression, condition: { root: 'value' } } }), true);
assert.equal(guardedRead({ expression: { text: 'value' }, parent: { kind: SourceFile, get parent() { throw failure; } } }), false);
assert.throws(() => guardedRead({ expression: { text: 'value' }, parent: { kind: ConditionalExpression,
    condition: { root: 'value' }, get parent() { throw failure; } } }), error => error === failure);
assert.equal(guardedRead({ expression: { text: 'value' }, parent: { kind: ConditionalExpression, condition: { root: 'other' }, parent: false } }), false);

let updatesSeen = [];
const firstUpdate = { args: [{}] };
const stop = {};
const contiguous = owner({ file: 'lowering/collection-reconstruction.js', name: 'getContiguousUpdates', context: {
    getStaticUpdate: ({ statement = {} } = {}) => { updatesSeen = [...updatesSeen, statement];

        return statement === firstUpdate ? statement : {}; }
} });
const statements = [{}, firstUpdate, stop];
Object.defineProperty(statements, '3', { get() { throw failure; } });
const result = contiguous({ statements });
const { updates = [], returnStatement = {}, end = 0 } = result;
assert.equal(updates.length, 1);
assert.equal(updates[0], firstUpdate);
assert.equal(returnStatement, stop);
assert.equal(end, 2);
assert.deepEqual(updatesSeen, [firstUpdate, stop]);
assert.equal(contiguous({ statements: [{}] }).end, 1);

// Static path loop is one local unit inside a larger visit. Execute its actual
// parser-owned text; do not claim that this proves the later source admission.
const source = read(typeFile);
const { entries = [] } = getExceptionInventory({ source, file: `transforms/typescript/${typeFile}` });
const [pathUnit = {}] = entries.filter(({ operation = '' } = {}) => operation.startsWith('while (getObject(root).kind === PropertyAccessExpression'));
const pathWalk = (root = {}, checker = {}) => runInNewContext(`${pathUnit.operation}\n({ root, path });`, {
    root, path: [], checker, getObject, PropertyAccessExpression
});
const pathRoot = { kind: Identifier };
const inner = { kind: PropertyAccessExpression, expression: pathRoot, name: { text: 'a' } };
const outer = { kind: PropertyAccessExpression, expression: inner, name: { text: 'b' } };
let pathEvents = [];
const pathChecker = { getSymbolAtLocation: (node) => {
    pathEvents = [...pathEvents, node];

    return { declarations: [{}] };
} };
const pathResult = pathWalk(outer, pathChecker);
assert.equal(pathResult.root, pathRoot);
assert.deepEqual([...pathResult.path], ['a', 'b']);
assert.deepEqual(pathEvents, [outer.name, inner.name]);
assert.equal(pathWalk({ ...outer, questionDotToken: {} }, pathChecker).path.length, 0);
assert.equal(pathWalk(outer, { getSymbolAtLocation: () => ({}) }).path.length, 0);
assert.throws(() => pathWalk(outer, { getSymbolAtLocation: () => { throw failure; } }), error => error === failure);

// Owning rule has no early-exit/bounded-loop built-in exemption. Exactly these
// twelve retained units are still findings when their adjacent comments vanish.
const selectedUnits = [
    ['grammar/guards.js', 'Guard discovery'], ['lowering/collection-reconstruction.js', 'Consecutive update'],
    ['members/generic.js', 'Guard discovery'], ['understand/imports.js', 'Type-node detection'],
    ...['Bounded ancestor', 'Owner discovery', 'Function-owner', 'Declaration-owner', 'Return-spine',
        'Promise-owner', 'Static member-path'].map(reason => [typeFile, reason]),
    ['understand/type-resolution.js', 'Type-parameter ownership']
];
const linter = new Linter();
selectedUnits.forEach(([file = '', reason = ''] = []) => {
    const text = read(file);
    const inventory = getExceptionInventory({ source: text, file: `transforms/typescript/${file}` });
    const [entry = {}] = inventory.entries.filter(({ rules = [], reason: concrete = '' } = {}) => rules.includes('resilient/prefer-prototype-methods') && concrete.startsWith(reason));
    const { range = [], location: { line: commentLine = 0 } = {} } = entry;
    assert.ok(range.length, `${file}: ${reason}`);
    const [start = 0, end = 0] = range;
    const raw = text.slice(0, start) + text.slice(start, end).replace(/[^\r\n]/gu, ' ') + text.slice(end);
    const messages = linter.verify(raw, { plugins: { resilient }, rules: { 'resilient/prefer-prototype-methods': 'error' } });
    assert.ok(messages.some(({ line = 0, ruleId = '' } = {}) => ruleId === 'resilient/prefer-prototype-methods' && line === commentLine + 1));
});

const child = Object.freeze({ kind: Identifier });
let childVisits = 0;
const childCollector = {
    forEachChild({ kind = 0 } = {}, visit) {
        assert.equal(kind, SourceFile);
        visit(child);
        visit(child);
        childVisits += 2;
    }
};

assert.deepEqual(getChildren({ typescript: childCollector, node: { kind: SourceFile } }), [child, child]);
assert.equal(childVisits, 2);
assert.throws(() => getChildren({ typescript: { forEachChild() { throw failure; } } }), error => error === failure);
[4000, 8000, 12000].forEach((count) => {
    const visited = [];
    const children = getChildren({ typescript: { forEachChild(node, visit) {
        Array.from({ length: count }, (_, index) => index).forEach((index) => {
            const value = { index };

            // eslint-disable-next-line resilient/prefer-safe-transformations -- Test-local visit log verifies exact child identities and count.
            visited.push(value);
            visit(value);
        });
    } } });

    assert.equal(children.length, count);
    assert.equal(visited.length, count);
    const { 0: firstChild = {}, [count - 1]: lastChild = {} } = children;
    const { 0: firstVisit = {}, [count - 1]: lastVisit = {} } = visited;

    assert.equal(firstChild, firstVisit);
    assert.equal(lastChild, lastVisit);
});
