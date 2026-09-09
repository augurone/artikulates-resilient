import assert from 'node:assert/strict';
import fs from 'node:fs';

import typescript from 'typescript';

import { routes, completeGroups } from './support/decision-routes.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import {
    findCapabilityConsumerDecision,
    getDestructuringDecision,
    getDestructuringDecisionForNode,
    getFunctionDestructuringDecision,
    isCompletedLiveCollectionLoop
} from '../transforms/typescript/policy/destructuring-agreements.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import { collectCollectionReconstructionContracts } from '../transforms/typescript/understand/type-evidence.js';

// Every production input slot must survive aggregation and compilation,
// including the secondary callback, selector, terminal and hoisting roles.
const allFacts = collectDestructuringAgreements(completeGroups);
const { byKind = new Map() } = compileDestructuringDecisions(allFacts);
const expectedKinds = [...routes.map(([, kind = ''] = []) => kind),
    'consumer-callback', 'callable-operation', 'arity-return-selector', 'switch-terminal-bare-return',
    'declaration-lifetime-reference', 'native-function-reference', 'hoisted-function-reference'];

assert.equal(expectedKinds.length, 57);
assert.deepEqual([...byKind.keys()].toSorted(), expectedKinds.toSorted());
assert.equal([...byKind.values()].flat().length, 57);
[...byKind.values()].flat().forEach(({ entry = {}, agreement = {}, contract = {} } = {}) => {
    const { sourceRange = '', owner = '', grammar = '', theorem = '' } = agreement;
    const { sourceRange: entryRange = '', owner: entryOwner = '', grammar: entryGrammar = '',
        theorem: entryTheorem = '', contract: entryContract = {} } = entry;

    assert.deepEqual({ sourceRange, owner, grammar, theorem }, {
        sourceRange: entryRange, owner: entryOwner, grammar: entryGrammar, theorem: entryTheorem
    });
    assert.equal(contract, entryContract);
});

let reads = 0;
const failure = new Error('source evidence failure');
const capability = { receiver: 'P', member: 'run', guard: 'function', functionKey: 'function', get action() {
    reads += 1;

    return 'guard-function-undefined';
} };
const first = { key: '10:20', kind: 'direct-capability', contract: capability };
const second = { key: '10:20', kind: 'provider-forward', contract: { action: 'provider-forward' } };
const loop = { kind: 'live-array-visitation', contract: { action: 'retain-live-array-visitation', loopRange: '30:40' } };
const facts = new Map([['10:20', [first, second]], ['loop', [loop]]]);
const store = compileDestructuringDecisions(facts);
const before = reads;
assert.equal(before, 1, 'The direct-capability Policy reads its action once during compilation.');
const compiler = { getOriginalNode: ({ original = {} } = {}) => original, SyntaxKind: typescript.SyntaxKind };
const node = { pos: 50, end: 60, original: { pos: 10, end: 20 } };

Object.defineProperty(facts, 'entries', { value: () => { throw failure; } });
Object.defineProperty(facts, 'values', { value: () => { throw failure; } });
Object.defineProperty(facts, 'get', { value: () => { throw failure; } });
Array.from({ length: 3 }).forEach(() => {
    assert.equal(getDestructuringDecision({ destructuringAgreements: store, key: '10:20' }).entry, first);
    assert.equal(getDestructuringDecision({ destructuringAgreements: store, key: '10:20', kinds: ['provider-forward'] }).entry, second);
    assert.equal(getDestructuringDecisionForNode({ typescript: compiler, node, destructuringAgreements: store }).entry, first);
    assert.equal(getFunctionDestructuringDecision({ destructuringAgreements: store, functionKey: 'function', kind: 'direct-capability' }).entry, first);
    assert.equal(findCapabilityConsumerDecision({ typescript: compiler, node, destructuringAgreements: store, kinds: ['direct-capability'] }).entry, first);
    assert.equal(isCompletedLiveCollectionLoop({ typescript: compiler,
        node: { kind: typescript.SyntaxKind.ForOfStatement, original: { pos: 30, end: 40 } }, destructuringAgreements: store }), true);
});
assert.equal(reads, before, 'Queries must not re-read facts or interpret Policy.');
assert.throws(() => compileDestructuringDecisions(facts), error => error === failure);
assert.throws(() => compileDestructuringDecisions(new Map([['failed', [{ kind: 'provider-forward',
    contract: { get action() { throw failure; } } }]]])), error => error === failure);
assert.equal(compileDestructuringDecisions(new Map()).size, 0, 'A failed compilation publishes no shared or partial session.');

// Different member ranges are selected in source-store order, not query-key
// order. Ordinary direct lookups retain original-range precedence instead.
const memberFacts = new Map([
    ['earlier-call', [{ kind: 'sort-capability', contract: { action: 'guard-sort-capability', source: { memberRange: '50:60' } } }]],
    ['later-call', [{ kind: 'sort-capability', contract: { action: 'guard-sort-capability', source: { memberRange: '10:20' } } }]]
]);
const memberStore = compileDestructuringDecisions(memberFacts);
assert.equal(findCapabilityConsumerDecision({ typescript: compiler, node, destructuringAgreements: memberStore }).entry,
    memberFacts.get('earlier-call').at(0));

const inspectSource = [
    'declare function inspect(value: Set<number>): boolean;',
    'export function build(value: number) { const result = new Set<number>(); result.add(value); inspect(result); return result; }'
].join('\n');
const fileName = 'escaped-probe.ts';
const sourceFile = typescript.createSourceFile(fileName, inspectSource, typescript.ScriptTarget.ESNext, true);
const options = { target: typescript.ScriptTarget.ESNext, strict: true };
const host = typescript.createCompilerHost(options);
const program = typescript.createProgram([fileName], options, {
    ...host, getSourceFile: (name, version, ...rest) => name === fileName ? sourceFile : host.getSourceFile(name, version, ...rest)
});
const collectionFacts = collectCollectionReconstructionContracts({ typescript, sourceFile, checker: program.getTypeChecker() });
const [collectionFact = {}] = collectionFacts.values();
assert.equal(Object.hasOwn(collectionFact, 'action'), false, 'Source evidence does not choose collection reconstruction.');
assert.equal(Object.hasOwn(collectionFact, 'outcome'), false);
const escapedStore = compileDestructuringDecisions(collectDestructuringAgreements({ collectionReconstructionContracts: collectionFacts }));
const { byKind: escapedKinds = new Map() } = escapedStore;
const [{ agreement: escaped = {} } = {}] = escapedKinds.get('collection-reconstruction') || [];
assert.equal(escaped.action, 'retain-collection-boundary');
assert.equal(escaped.boundaryReason, 'external-or-escaped');

// Enforce the architectural seam, without asserting private variable names or
// a particular number of compiler visits. The interpreter belongs to compilation.
const directory = new URL('../transforms/typescript/', import.meta.url);
const files = fs.readdirSync(directory, { recursive: true }).filter(file => file.endsWith('.js'));
files.filter(file => !['policy/defaults.js', 'policy/decision-store.js'].includes(file)).forEach((file = '') => {
    const source = fs.readFileSync(new URL(file, directory), 'utf8');
    const tree = typescript.createSourceFile(file, source, typescript.ScriptTarget.ESNext, true);
    const visit = (candidate = {}) => {
        if (typescript.isCallExpression(candidate)) assert.notEqual(candidate.expression.getText(tree), 'getDestructuringAgreement', file);

        typescript.forEachChild(candidate, visit);
    };
    visit(tree);
});
