import assert from 'node:assert/strict';

import typescript from 'typescript';

import { collectCollectionDecisions } from './typescript-collection-proof.js';
import { getDestructuringAgreement } from '../transforms/typescript/policy/defaults.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import {
    collectBindingReferences,
    collectExactProviderForwardContracts,
    collectProviderEdgeContracts,
    collectUnusedBindingContracts,
    getConsumerContractKey
} from '../transforms/typescript/understand/type-evidence.js';

const code = [
    'declare function make(): { run: () => number };',
    'declare function consume(value: unknown): void;',
    'export function unused(unread: number) { return 1; }',
    'export function shorthand(kept: number) { return { kept }; }',
    'export function shadow(unread: number) { return (unread: number) => unread; }',
    'export function captured(kept: number) { return () => kept; }',
    'export function predicate(unread: unknown): unread is number { return false; }',
    'export function typeQuery(kept: number) { const value: typeof kept = 1; return value; }',
    'export function catches() { try { consume(1); } catch (unread) { return 1; } }',
    'export function usedCatch() { try { consume(1); } catch (kept) { return kept; } }',
    'export function tuple(pair: [number, number]) { const [unread, kept] = pair; return kept; }',
    'export function guarded(pair: [number?]) { const [kept = 1] = pair; return kept; }',
    'export function returned() { const run = make().run; return run; }',
    'export function invoked() { const run = make().run; return run(); }',
    'export function passed() { const run = make().run; consume(run); }',
    'export function callShadow() { const run = make().run; consume((run: () => number) => run()); return run; }',
    'export function nestedCall() { const run = make().run; return () => run(); }',
    'export function memberCall() { const run = make().run; return run.call(null); }',
    'export function forward({ run }: { run: () => number }) { return { run }; }',
    'export function identity({ run }: { run: () => number }) { return run; }',
    'export function staticUse({ run }: { run: () => number }, sink: { take: (f: unknown) => unknown }) { return sink.take(run); }',
    'export function documented({ run }: { run: () => number }) {\n/** {@link run} */ const marker = 1; return { run }; }',
    'export function asyncBuilder(input: Set<number>) { const result = new Set<number>(); input.forEach(async value => { await 0; result.add(value); }); return result; }',
    'export function initializerCapture() { const result = new Set<number>((() => { result.add(1); return []; })()); return result; }',
    'export function collectionShadow(input: Set<number>) { const result = new Set<number>();',
    'input.forEach(value => { const other = (result: Set<number>) => result.add(value); consume(other); result.add(value); }); return result; }'
].join('\n');
const fileName = 'binding-references.ts';
const sourceFile = typescript.createSourceFile(fileName, code, typescript.ScriptTarget.ESNext, true);
const options = { strict: true, target: typescript.ScriptTarget.ESNext };
const host = typescript.createCompilerHost(options);
const program = typescript.createProgram([fileName], options, {
    ...host, getSourceFile: (name, version) => name === fileName ? sourceFile : host.getSourceFile(name, version)
});
const checker = program.getTypeChecker();
const source = { typescript, sourceFile, checker };
const bindingReferences = collectBindingReferences(source);
const indexed = { ...source, bindingReferences };
const unusedBindingContracts = collectUnusedBindingContracts(indexed);
const providerEdges = collectProviderEdgeContracts(indexed);
const collectionReconstructionContracts = collectCollectionDecisions(indexed);
const exactProviderForwards = collectExactProviderForwardContracts(source);
const entries = [...collectDestructuringAgreements({
    unusedBindingContracts, providerEdges, collectionReconstructionContracts, exactProviderForwards
}).values()].flat();
assert.ok(entries.length);
entries.forEach(entry => assert.ok(getDestructuringAgreement({ entry }).action));
const nodes = (node = sourceFile) => {
    let children = [];
    typescript.forEachChild(node, (child) => { children = [...children, ...nodes(child)]; });

    return [node, ...children];
};
const allNodes = nodes();
const fn = name => sourceFile.statements.find((node) => {
    const { name: { text = '' } = {} } = node;

    return typescript.isFunctionDeclaration(node) && text === name;
});
const parameter = name => fn(name).parameters[0];
const hasUnused = node => unusedBindingContracts.has(getConsumerContractKey(node));
['unused', 'shadow', 'predicate'].forEach(name => assert.equal(hasUnused(parameter(name)), true, name));
['shorthand', 'captured', 'typeQuery'].forEach(name => assert.equal(hasUnused(parameter(name)), false, name));
['catches', 'usedCatch'].forEach((name) => {
    const clause = nodes(fn(name)).find(typescript.isCatchClause);
    assert.equal(hasUnused(clause), name === 'catches', name);
});
const tupleSlots = nodes(fn('tuple')).filter(typescript.isBindingElement);
assert.deepEqual(tupleSlots.map(hasUnused), [true, false]);
assert.equal(nodes(fn('guarded')).filter(typescript.isBindingElement).some(hasUnused), false);
['returned', 'invoked', 'passed', 'callShadow', 'nestedCall', 'memberCall'].forEach((name) => {
    const declaration = nodes(fn(name)).find(typescript.isVariableDeclaration);
    assert.equal(providerEdges.has(getConsumerContractKey(declaration)),
        ['returned', 'callShadow', 'memberCall'].includes(name), name);
});
['forward', 'identity', 'staticUse', 'documented'].forEach((name) => {
    const binding = nodes(fn(name)).find(typescript.isBindingElement);
    assert.equal(exactProviderForwards.has(getConsumerContractKey(binding)), name === 'forward', name);
});
['asyncBuilder', 'collectionShadow'].forEach((name) => {
    const declaration = nodes(fn(name)).find(typescript.isVariableDeclaration);
    const fact = collectionReconstructionContracts.get(getConsumerContractKey(declaration)) || {};
    const { collection: { mutationSites = [] } = {} } = fact;
    assert.equal(mutationSites.length, 1, name);
    const [{ key = '' } = {}] = mutationSites;
    const { name: bindingName = {} } = declaration;
    const call = allNodes.find(node => typescript.isCallExpression(node) && getConsumerContractKey(node) === key);
    const { expression: { expression: receiver = {} } = {} } = call;
    assert.equal(checker.getSymbolAtLocation(receiver), checker.getSymbolAtLocation(bindingName), name);
});

const initializerDeclaration = nodes(fn('initializerCapture')).find(typescript.isVariableDeclaration);
const initializerFact = collectionReconstructionContracts.get(getConsumerContractKey(initializerDeclaration)) || {};
const { collection: { mutationSites: initializerSites = [] } = {} } = initializerFact;
assert.deepEqual(initializerSites, [], 'Initializer references do not belong to sibling statements.');

// A shared snapshot is consumed without another source traversal or reference
// resolution. The collectors may still resolve their candidate declarations.
let traversals = 0;
const counted = { ...typescript, forEachChild: (node, visit) => {
    traversals += 1;

    return typescript.forEachChild(node, visit);
} };
collectUnusedBindingContracts({ ...indexed, typescript: counted });
assert.equal(traversals, allNodes.length, 'Unused bindings require one candidate walk, with no per-binding source scans.');
assert.deepEqual(collectUnusedBindingContracts(source), unusedBindingContracts);
assert.deepEqual(collectProviderEdgeContracts(source), providerEdges);
assert.deepEqual(collectCollectionDecisions(source), collectionReconstructionContracts);
assert.equal(collectBindingReferences({ typescript, sourceFile }).size, 0);
assert.equal(collectUnusedBindingContracts({ typescript, sourceFile }).size, 0);
assert.equal(collectProviderEdgeContracts({ typescript, sourceFile }).size, 0);
assert.equal(collectUnusedBindingContracts({ ...source, checker: { getSymbolAtLocation: () => false } }).size, 0);
