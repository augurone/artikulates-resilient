import assert from 'node:assert/strict';

import typescript from 'typescript';

import { collectCollectionDecisions } from './typescript-collection-proof.js';
import { lowerFinalGrammar } from '../transforms/typescript/grammar/final.js';
import { annotateCompletedReturnBoundaries } from '../transforms/typescript/lowering/arity-returns.js';
import { lowerCollectionAgreementPlacements } from '../transforms/typescript/lowering/collection-reconstruction.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { getDestructuringDecisionForNode } from '../transforms/typescript/policy/destructuring-agreements.js';
import {
    annotateCompletedLoopBoundaries,
    annotateRetainedDynamicMemberAccess,
    annotateRetainedStaticMemberAccess
} from '../transforms/typescript/policy/exceptions.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import {
    getConsumerContractKey
} from '../transforms/typescript/understand/type-evidence.js';

const parse = (source = '') => typescript.createSourceFile('consumption.ts', source, typescript.ScriptTarget.ESNext, true);
const requireConsumer = () => {
    throw new TypeError('A callable test consumer is required.');
};
const observe = (entries = []) => {
    const map = new Map(entries);
    let scans = 0;

    Object.defineProperty(map, 'entries', { value: () => {
        scans += 1;

        return Map.prototype.entries.call(map);
    } });

    return { agreements: map, readScans: () => scans };
};
const place = ({ source = '', map = new Map(), consume = requireConsumer(), annotationsOnly = false } = {}) => {
    if (typeof consume !== 'function') throw new TypeError('A placement consumer is required.');

    const sourceFile = parse(source);
    const before = [...map];
    const { transformed: [placed = sourceFile] = [], dispose = false } = typescript.transform(sourceFile, [context => root => (
        consume({ typescript, sourceFile: root, node: root, destructuringAgreements: compileDestructuringDecisions(map), context, annotationsOnly })
    )]);
    const printed = typescript.createPrinter().printFile(placed);

    if (typeof dispose === 'function') dispose();

    assert.deepEqual([...map], before);

    return printed;
};
const loopSource = 'for (const row of rows) use(row); for (const row of rows) use(row);';
const { statements: loops = [] } = parse(loopSource);
const loopEntry = ({ node = {}, reason = '' } = {}) => ({
    kind: 'live-array-visitation',
    contract: { action: 'retain-live-array-visitation', loopRange: getConsumerContractKey(node), evidence: [reason] }
});
const { agreements: fallbackAgreements = new Map(), readScans: fallbackScans = requireConsumer() } = observe([
    ['declaration-owned', loops.flatMap((node = {}) => [
        loopEntry({ node, reason: 'first source agreement' }),
        loopEntry({ node, reason: 'later collision' })
    ])]]);
const fallbackOutput = place({ source: loopSource, map: fallbackAgreements, consume: annotateCompletedLoopBoundaries });

assert.equal(fallbackScans(), 1);
assert.equal(fallbackOutput.split('first source agreement').length - 1, 2);
assert.doesNotMatch(fallbackOutput, /later collision/u);
place({ source: loopSource, map: fallbackAgreements, consume: annotateCompletedLoopBoundaries });
assert.equal(fallbackScans(), 2);

const { agreements: directAgreements = new Map(), readScans: directScans = requireConsumer() } = observe([
    ['fallback', [loopEntry({ node: loops[0], reason: 'fallback loses to direct' })]],
    ...loops.map((node = {}) => [getConsumerContractKey(node), [loopEntry({ node, reason: 'direct source agreement' })]])
]);
const directOutput = place({ source: loopSource, map: directAgreements, consume: annotateCompletedLoopBoundaries });

assert.equal(directScans(), 1);
assert.equal(directOutput.split('direct source agreement').length - 1, 2);
assert.doesNotMatch(directOutput, /fallback loses/u);

const writeSource = 'out[row[0]] = row[1];';
const { statements: [write = {}] = [] } = parse(writeSource);
const statementRange = getConsumerContractKey(write);
const builder = (bindingShape = '') => ({ kind: 'operational-object-builder',
    contract: { action: 'operational-object-builder', statementRange, bindingShape } });
const { agreements: writeAgreements = new Map(), readScans: writeScans = requireConsumer() } = observe([
    ['first', [builder('indexed-entry')]], ['last', [builder('destructured-entry')]]
]);
const writeOutput = place({ source: writeSource, map: writeAgreements, consume: annotateRetainedDynamicMemberAccess });

assert.equal(writeScans(), 1);
assert.match(writeOutput, /computed write retains live setter/u);
assert.doesNotMatch(writeOutput, /key Get order|value Get order/u);

[annotateRetainedStaticMemberAccess, annotateCompletedReturnBoundaries].forEach((consume = requireConsumer()) => {
    const { agreements: map = new Map(), readScans = requireConsumer() } = observe();
    const source = 'const value = 1;';

    assert.equal(place({ source, map, consume }), typescript.createPrinter().printFile(parse(source)));
    assert.equal(readScans(), 1);
});

const collectionSource = 'const build = step => { const result = new Map(); const value = step.value; result.set(1, value); return result; };';
const { statements: [collectionOwner = {}] = [] } = parse(collectionSource);
const { declarationList: collectionOwnerList = {} } = collectionOwner;
const { declarations: [collectionOwnerDeclaration = {}] = [] } = collectionOwnerList;
const { initializer: collectionArrow = {} } = collectionOwnerDeclaration;
const { body: collectionBlock = {} } = collectionArrow;
const { statements: [, , collectionUpdate = {}] = [] } = collectionBlock;
const collectionUpdateRange = getConsumerContractKey(collectionUpdate.expression);
const collectionEntry = ({ key = '', updateRange = collectionUpdateRange } = {}) => ({
    kind: 'collection-reconstruction', key,
    contract: { action: 'operational-collection-builder', collection: {
        name: 'result', type: 'Map', mutationSites: [{ key: updateRange, method: 'set' }]
    } }
});
const collectionCase = (entries = []) => {
    const { agreements: map = new Map(), readScans = requireConsumer() } = observe(entries);
    const printed = place({ source: collectionSource, map, consume: lowerCollectionAgreementPlacements, annotationsOnly: true });

    assert.equal(readScans(), 1);

    return printed;
};

assert.match(collectionCase([['first', [collectionEntry({ key: 'first' })]]]), /Owned Map\/Set builder/u);
assert.doesNotMatch(collectionCase([
    ['first', [collectionEntry({ key: 'first' })]], ['second', [collectionEntry({ key: 'second' })]]
]), /Owned Map\/Set builder/u);
assert.doesNotMatch(collectionCase([['wrong', [collectionEntry({ key: 'wrong', updateRange: 'wrong' })]]]), /Owned Map\/Set builder/u);

const sameNamedBuilders = [
    'function left() { const build = value => { const result = new Map(); result.set(1, value); return result; }; return build; }',
    'function right() { const build = value => { const result = new Map(); result.set(1, value); return result; }; return build; }'
].join('\n');
const { statements: [leftOwner = {}] = [] } = parse(sameNamedBuilders);
const { body: leftBody = {} } = leftOwner;
const { statements: [leftBinding = {}] = [] } = leftBody;
const { declarationList: leftList = {} } = leftBinding;
const { declarations: [leftDeclaration = {}] = [] } = leftList;
const { initializer: leftArrow = {} } = leftDeclaration;
const { body: leftScope = {} } = leftArrow;
const { statements: [leftBuilder = {}, leftUpdate = {}] = [] } = leftScope;
const { declarationList: leftBuilderList = {} } = leftBuilder;
const { declarations: [leftBuilderDeclaration = {}] = [] } = leftBuilderList;
const leftBuilderKey = getConsumerContractKey(leftBuilderDeclaration);
const leftScopeKey = getConsumerContractKey(leftScope);
const leftUpdateKey = getConsumerContractKey(leftUpdate.expression);
const scopedCollection = { kind: 'collection-reconstruction', key: leftBuilderKey,
    contract: { action: 'operational-collection-builder', collection: {
        name: 'result', type: 'Map', ownerName: 'build', scopeRange: leftScopeKey,
        mutationSites: [{ key: leftUpdateKey, method: 'set' }]
    } } };
const scopedCollectionOutput = place({
    source: sameNamedBuilders,
    map: new Map([[leftBuilderKey, [scopedCollection]]]),
    consume: lowerCollectionAgreementPlacements,
    annotationsOnly: true
});

assert.equal(scopedCollectionOutput.split('Owned Map/Set builder').length - 1, 1,
    'An exact update fact may not be lent to a same-named update in another block.');
assert.match(scopedCollectionOutput.split('function right')[0], /Owned Map\/Set builder/u);
assert.doesNotMatch(scopedCollectionOutput.split('function right')[1], /Owned Map\/Set builder/u);
const scopedFallbackOutput = place({
    source: sameNamedBuilders,
    map: new Map([['updated-declaration', [{ ...scopedCollection, key: 'updated-declaration' }]]]),
    consume: lowerCollectionAgreementPlacements,
    annotationsOnly: true
});

assert.equal(scopedFallbackOutput.split('Owned Map/Set builder').length - 1, 1,
    'An updated declaration key does not change the owned update source range.');
assert.doesNotMatch(scopedFallbackOutput.split('function right')[1], /Owned Map\/Set builder/u);

const checkerOwnedBuilders = [
    'function left() { const build = (values: number[]) => { const result = new Map<number, number>(); for (const value of values) result.set(value, value); return result; }; return build; }',
    'function right(Map: new () => Map<number, number>) { const build = (value: number) => { const result = new Map(); result.set(1, value); return result; }; return build; }'
].join('\n');
const checkerSource = parse(checkerOwnedBuilders);
const checkerOptions = { target: typescript.ScriptTarget.ES2022, skipLibCheck: true };
const checkerHost = typescript.createCompilerHost(checkerOptions);
const checkerProgram = typescript.createProgram(['consumption.ts'], checkerOptions, {
    ...checkerHost,
    getSourceFile: (fileName, version, ...rest) => fileName === 'consumption.ts'
        ? checkerSource
        : checkerHost.getSourceFile(fileName, version, ...rest)
});
const collectionFacts = collectCollectionDecisions({
    typescript,
    sourceFile: checkerSource,
    checker: checkerProgram.getTypeChecker()
});
const [admittedCollection = {}] = [...collectionFacts.values()];

assert.deepEqual(checkerProgram.getSemanticDiagnostics(), []);
assert.equal(collectionFacts.size, 1, 'The shadowed Map constructor has no standard-collection fact.');
assert.equal(admittedCollection.action, 'operational-collection-builder');
assert.ok(admittedCollection.collection.scopeRange);
const checkerOwnedOutput = place({
    source: checkerOwnedBuilders,
    map: collectDestructuringAgreements({ collectionReconstructionContracts: collectionFacts }),
    consume: lowerCollectionAgreementPlacements,
    annotationsOnly: true
});

assert.equal(checkerOwnedOutput.split('Owned Map/Set builder').length - 1, 1);
assert.doesNotMatch(checkerOwnedOutput.split('function right')[1], /Owned Map\/Set builder/u);

const { agreements: sourceMap = new Map(), readScans: sourceScans = requireConsumer() } = observe([
    ['first', [collectionEntry({ key: 'first' })]]
]);
place({ source: collectionSource, map: sourceMap, consume: lowerCollectionAgreementPlacements });
assert.equal(sourceScans(), 1);

const [original = {}] = loops;
const clone = typescript.factory.createForOfStatement(undefined, original.initializer, original.expression, original.statement);
typescript.setOriginalNode(clone, original);
const first = loopEntry({ node: original, reason: 'original first' });
const second = loopEntry({ node: original, reason: 'original second' });
const originalMap = new Map([[getConsumerContractKey(original), [first, second]]]);

assert.equal(getDestructuringDecisionForNode({ typescript, node: clone, destructuringAgreements: compileDestructuringDecisions(originalMap) }).entry, first);
assert.deepEqual(getDestructuringDecisionForNode({ typescript, node: clone, destructuringAgreements: compileDestructuringDecisions(originalMap),
    kinds: ['collection-reconstruction'] }).entry, {});

const noRange = typescript.factory.createIdentifier('shell');
const directNode = typescript.factory.createIdentifier('updated');
typescript.setTextRange(directNode, original);
typescript.setOriginalNode(directNode, noRange);
assert.equal(getDestructuringDecisionForNode({ typescript, node: directNode, destructuringAgreements: compileDestructuringDecisions(originalMap) }).entry, first);

const memberSource = parse('const first = P.value; const second = P.value;');
let memberReads = [];
const collectMemberReads = (node = {}) => {
    if (typescript.isPropertyAccessExpression(node)) memberReads = [...memberReads, node];

    typescript.forEachChild(node, collectMemberReads);
};
collectMemberReads(memberSource);
const [admittedMember = {}, rejectedMember = {}] = memberReads;
const memberKey = getConsumerContractKey(admittedMember);
const structural = { key: memberKey, kind: 'closed-structural-model', contract: { action: 'exact-structural-field' } };
const callback = { key: memberKey, kind: 'consumer-callback', contract: { outcome: 'guarded-tuple' } };
const projection = { key: memberKey, kind: 'receiver-ordered-projection',
    contract: { action: 'retain-receiver-ordered-projection' } };
const { agreements: memberAgreements = new Map(), readScans: memberScans = requireConsumer() } = observe([
    [memberKey, [structural, callback, projection]]
]);
const memberDecisions = compileDestructuringDecisions(memberAgreements);
const memberDecision = (node = {}, kinds = []) => getDestructuringDecisionForNode({
    typescript, node, destructuringAgreements: memberDecisions, kinds
});

assert.equal(memberDecision(admittedMember, ['closed-structural-model']).entry, structural);
assert.equal(memberDecision(admittedMember, ['consumer', 'consumer-callback']).entry, callback);
assert.equal(memberDecision(admittedMember, ['receiver-ordered-projection']).entry, projection);
assert.deepEqual(memberDecision(rejectedMember, ['closed-structural-model']).entry, {});
assert.deepEqual(memberDecision(rejectedMember, ['consumer', 'consumer-callback']).entry, {});
assert.deepEqual(memberDecision(rejectedMember, ['receiver-ordered-projection']).entry, {});
const memberClone = typescript.setOriginalNode(typescript.factory.createPropertyAccessExpression('other', 'value'), admittedMember);
assert.equal(memberDecision(memberClone, ['closed-structural-model']).entry, structural);
assert.equal(memberDecision(memberClone, ['consumer', 'consumer-callback']).entry, callback);
assert.equal(memberDecision(memberClone, ['receiver-ordered-projection']).entry, projection);
assert.equal(memberScans(), 1, 'Compilation reads source facts once; repeated member queries do not revisit them.');

[annotateRetainedDynamicMemberAccess, annotateRetainedStaticMemberAccess, annotateCompletedReturnBoundaries].forEach((consume = requireConsumer()) => {
    assert.throws(() => consume({ typescript, sourceFile: parse(''), destructuringAgreements: compileDestructuringDecisions(false) }), { name: 'TypeError' });
});

const scopeSource = [
    'function first(value) { const result = new Map(); result.set(1, value); return result; }',
    'function second(value) { const result = new Map(); result.set(1, value); return result; }'
].join('\n');
const { statements: [firstFunction = {}, secondFunction = {}] = [] } = parse(scopeSource);
const { body: firstBlock = {} } = firstFunction;
const { body: secondBlock = {} } = secondFunction;
const { statements: [, firstUpdate = {}] = [] } = firstBlock;
const { statements: [, secondUpdate = {}] = [] } = secondBlock;
const firstUpdateRange = getConsumerContractKey(firstUpdate.expression);
const secondUpdateRange = getConsumerContractKey(secondUpdate.expression);
const scopedEntry = ({ key = '', updateRange = '' } = {}) => ({
    kind: 'collection-reconstruction', key,
    contract: { action: 'single-collection-update', collection: {
        name: 'result', type: 'Map', mutationSites: [{ key: updateRange, method: 'set' }]
    } }
});
const scopeCase = (entries = []) => {
    const { agreements: map = new Map(), readScans = requireConsumer() } = observe(entries);
    const printed = place({ source: scopeSource, map, consume: lowerFinalGrammar });

    assert.equal(readScans(), 1);

    return printed;
};

assert.equal(scopeCase([['first', [scopedEntry({ key: 'first', updateRange: firstUpdateRange })]]])
    .split('result.set').length - 1, 1);
assert.equal(scopeCase([['second', [scopedEntry({ key: 'second', updateRange: secondUpdateRange })]]])
    .split('result.set').length - 1, 1);
assert.equal(scopeCase([
    ['first', [scopedEntry({ key: 'first', updateRange: firstUpdateRange })]],
    ['second', [scopedEntry({ key: 'second', updateRange: secondUpdateRange })]]
]).split('result.set').length - 1, 0);
assert.equal(scopeCase([['wrong', [scopedEntry({ key: 'wrong', updateRange: 'wrong' })]]])
    .split('result.set').length - 1, 2);
assert.equal(scopeCase([
    ['first', [scopedEntry({ key: 'first', updateRange: firstUpdateRange })]],
    ['collision', [scopedEntry({ key: 'collision', updateRange: firstUpdateRange })]]
]).split('result.set').length - 1, 2);
