import assert from 'node:assert/strict';

import { Linter } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { lowerGuardedConditionalReturns } from '../transforms/typescript/lowering/guarded-returns.js';
import { lowerExactProviderForwarding } from '../transforms/typescript/members/exact-provider-forwarding.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import {
    findCapabilityConsumerDecision,
    getDestructuringDecisionForNode
} from '../transforms/typescript/policy/destructuring-agreements.js';
import { compilePlacementDecisions } from '../transforms/typescript/policy/placement.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import { collectPlacementEvidence } from '../transforms/typescript/understand/placement-evidence.js';
import {
    collectDeferredOpaqueFieldContracts,
    collectDirectCapabilityContracts,
    collectExactProviderForwardContracts,
    collectSortCapabilityContracts,
    getConsumerContractKey
} from '../transforms/typescript/understand/type-evidence.js';

const nodesOfKind = ({ root = {}, kind = -1 } = {}) => {
    let nodes = [];
    const visit = (node = {}) => {
        const { kind: nodeKind = -1 } = node;

        if (nodeKind === kind) nodes = [...nodes, node];

        typescript.forEachChild(node, visit);
    };
    visit(root);

    return nodes;
};
const cases = [
    { name: 'identity', code: 'function read(P: { compact: (value: number) => number }) { return P.compact; }', count: 1 },
    { name: 'consumer', code: 'function read(P: { compact: (value: number) => number }, F: { map: (f: unknown) => unknown }) { return F.map(P.compact); }', count: 1 },
    { name: 'identifier-consumer', code: 'declare function accept(value: unknown): unknown; function read(P: { compact: () => number }) { return accept(P.compact); }', count: 1 },
    { name: 'aliased-consumer', code: 'declare function accept(value: unknown): unknown; const alias = accept; function read(P: { compact: () => number }) { return alias(P.compact); }', count: 1 },
    { name: 'parameter-consumer', code: 'function read(P: { compact: () => number }, accept: (value: unknown) => unknown) { return accept(P.compact); }', count: 1 },
    { name: 'arrow-identity', code: 'function read(P: { compact: () => number }) { return () => P.compact; }', count: 1 },
    { name: 'arrow-generic-identity', code: 'function read<T>(P: { value: T }) { return () => P.value; }', count: 1 },
    { name: 'shadowed-return-absence', code: 'function read(P: { compact: () => number }, undefined: number) { return P.compact; }' },
    { name: 'shadowed-arrow-absence', code: 'function read(P: { compact: () => number }, undefined: number) { return () => P.compact; }' },
    { name: 'optional-consumer', code: 'declare function accept(value: unknown): unknown; function read(P: { compact?: () => number }) { return accept(P.compact); }' },
    { name: 'unknown-consumer-field', code: 'declare function accept(value: unknown): unknown; function read(P: { compact: unknown }) { return accept(P.compact); }' },
    { name: 'any-consumer-field', code: 'declare function accept(value: unknown): unknown; function read(P: { compact: any }) { return accept(P.compact); }' },
    { name: 'computed-consumer', code: 'declare const F: { accept: (value: unknown) => unknown }; function read(P: { compact: () => number }) { return F["accept"](P.compact); }' },
    { name: 'shadowed-consumer-absence', code: 'declare function accept(value: unknown): unknown; function read(P: { compact: () => number }, undefined: number) { return accept(P.compact); }' },
    { name: 'factory', code: 'function read(make: () => { compact: (value: number) => number }) { const { compact } = make(); return { compact }; }', count: 1 },
    { name: 'selected', code: 'function read(M: { empty: string }, selected: boolean) { return selected ? M.empty : "value"; }', count: 1 },
    { name: 'renamed', code: 'function read(provider: { empty: string }, selected: boolean) { return selected ? provider.empty : "value"; }', count: 1 },
    { name: 'shadow', code: 'function read(M: { empty: string }, selected: boolean) { const other = (M: { empty: number }) => M.empty; return selected ? M.empty : "value"; }', count: 1 },
    { name: 'optional', code: 'function read(P: { compact?: (value: number) => number }) { return P.compact; }' },
    { name: 'optional-syntax', code: 'function read(P: { compact: (value: number) => number }) { return P?.compact; }' },
    { name: 'invoked', code: 'function read(P: { compact: (value: number) => number }) { return P.compact(1); }' },
    { name: 'wrong-result', code: 'function read(M: { empty: string }, selected: boolean) { return selected ? M.empty : 1; }' },
    { name: 'computed', code: 'function read(P: { compact: (value: number) => number }) { return P["compact"]; }' },
    { name: 'generic-return', code: 'function read<T>(P: { value: T }) { return P.value; }', count: 1 },
    { name: 'generic-constructor', code: 'const wrap = <T>(value: T) => ({ value }); function read<T>(P: { value: T }) { return wrap(P.value); }', count: 1 },
    { name: 'known-value-not-generic', code: 'function read(P: { value: number }) { return P.value; }' },
    { name: 'generic-optional', code: 'function read<T>(P: { value?: T }) { return P.value; }' },
    { name: 'any-value', code: 'function read(P: { value: any }) { return P.value; }' },
    { name: 'unknown-value', code: 'function read(P: { value: unknown }) { return P.value; }' },
    { name: 'generic-computed', code: 'function read<T>(P: { value: T }) { return P["value"]; }' },
    { name: 'deferred-owned', code: 'function read<T>(P: { value: T }, wrap: (value: T) => T) { return () => wrap(P.value); }' },
    { name: 'variant-owned', code: 'function read<T>(P: { tag: "left"; value: T } | { tag: "right"; value: T }) { return P.value; }' },
    { name: 'shadowed-absence', code: 'function read<T>(P: { value: T }, undefined: number) { return P.value; }' },
    { name: 'selected-generic', code: [
        'const isSelected = (input: { tag: boolean }) => input.tag;',
        'function read<T>(P: { empty: T }, wrap: () => T, input: { tag: boolean }) { return isSelected(input) ? P.empty : wrap(); }'
    ].join('\n'), count: 1 },
    { name: 'selected-optional-syntax', code: 'function read(M: { empty: string }, selected: boolean) { return selected ? M?.empty : "value"; }' },
    { name: 'contextual-curried-generic', code: [
        'const isSelected = (input: { tag: boolean }) => input.tag;',
        'const read: <T>(P: { empty: T }) => (wrap: () => T) => (input: { tag: boolean }) => T =',
        'P => wrap => input => isSelected(input) ? P.empty : wrap();'
    ].join('\n'), count: 1 }
];
const composeSource = [
    'function compose(first: (value: number) => number, stage: (value: number) => number) {',
    '    return function (value: number) { return stage(first.call(this, value)); };',
    '}',
    'function read(P: { compact: (value: number) => number }, make: () => (value: number) => number) { return compose(make(), P.compact); }'
].join('\n');
const firstStageSource = [
    'const receiver = {};',
    'const make = () => { events = [...events, "argument"]; return function (value: number) {',
    '    events = [...events, this === receiver ? "receiver" : "wrong receiver", "first"]; return value + 1;',
    '}; };'
].join('\n');
const traces = [
    ...['normal', 'missing', 'false', 'null'].map(mode => ({
        name: `identifier-composition-${mode}`,
        declaration: composeSource,
        setup: [
            firstStageSource,
            `const mode = ${JSON.stringify(mode)};`,
            'const stage = function(value: number) { events = [...events, this === undefined ? "bare stage" : "bound stage"]; return value * 2; };',
            'const provider = mode === "null" ? null : { get compact() { events = [...events, "get"]; return mode === "normal" ? stage : mode === "false" ? false : undefined; } };'
        ].join('\n'),
        probe: '(() => { const later = read(provider, make); events = [...events, "created"]; return later.call(receiver, 2); })()'
    })),
    { name: 'identifier-getter-failure', declaration: composeSource,
        setup: `${firstStageSource}\nconst failure = {}; const provider = { get compact() { events = [...events, "get"]; throw failure; } };`,
        probe: '(() => { try { read(provider, make); } catch (error) { return error === failure; } })()' },
    { name: 'identifier-argument-failure', declaration: composeSource,
        setup: 'const failure = {}; const provider = { get compact() { events = [...events, "get"]; return value => value; } };',
        probe: '(() => { try { read(provider, () => { events = [...events, "argument"]; throw failure; }); } catch (error) { return error === failure; } })()' },
    { name: 'identifier-deferred-read', declaration: [
        'const accept = <T>(value: T) => value;',
        'function read(P: { compact: () => number }) { return () => accept(P.compact); }'
    ].join('\n'), setup: [
        'const first = () => 1; const second = () => 2; let current = first;',
        'const provider = { get compact() { events = [...events, "get"]; return current; } };'
    ].join('\n'), probe: '(() => { const later = read(provider); events = [...events, "created"]; const a = later(); current = second; return [a === first, later() === second]; })()' },
    { name: 'identifier-returned-record', declaration: [
        'const compose = (first: (value: number) => number, stage: (value: number) => number) => (value: number) => stage(first(value));',
        'function read(P: { compact: (value: number) => number }) {',
        '    return { ask: () => P.compact, asks: (first: (value: number) => number) => compose(first, P.compact), keep: P };',
        '}'
    ].join('\n'), setup: [
        'const first = (value: number) => value + 1; const second = (value: number) => value + 2; let current = first;',
        'const provider = { get compact() { events = [...events, "get"]; return current; } };'
    ].join('\n'), probe: [
        '(() => { const result = read(provider); events = [...events, "created"]; const a = result.ask(); current = second;',
        'return [a === first, result.ask() === second, result.asks(value => value)(3), result.keep === provider]; })()'
    ].join('\n') },
    { name: 'arrow-generic-deferred', declaration: 'function read<T>(P: { value: T }) { return () => P.value; }',
        setup: 'const first = {}; let current = first; const provider = { get value() { events = [...events, "get"]; return current; } };',
        probe: '(() => { const later = read(provider); events = [...events, "created"]; const a = later(); current = undefined; return [a === first, later() === undefined]; })()' },
    { name: 'identifier-guarded-skip', declaration: [
        'const accept = <T>(value: T) => value;',
        'function read(P: { compact: () => number }, selected: boolean) { return selected ? accept(P.compact) : false; }'
    ].join('\n'), setup: 'const provider = { get compact() { events = [...events, "get"]; throw new Error("unexpected Get"); } };', probe: 'read(provider, false)' },
    { name: 'optional-syntax-null', declaration: 'function read(P: { compact: (value: number) => number }) { return P?.compact; }',
        setup: 'const provider = null;', probe: 'read(provider) === undefined' },
    { name: 'optional-syntax-get', declaration: 'function read(P: { compact: (value: number) => number }) { return P?.compact; }',
        setup: 'const token = (value: number) => value; const provider = { get compact() { events = [...events, "get"]; return token; } };',
        probe: 'read(provider) === token' },
    { name: 'selected-optional-null', declaration: 'function read(M: { empty: string }, selected: boolean) { return selected ? M?.empty : "value"; }',
        setup: 'const provider = null;', probe: 'read(provider, true) === undefined' },
    { name: 'callable-identity', declaration: 'function read(P: { compact: (value: number) => number }) { return P.compact; }',
        setup: 'const token = (value: number) => value; const provider = { get compact() { events = [...events, "get"]; return token; } };',
        probe: 'read(provider) === token' },
    { name: 'missing-callable', declaration: 'function read(P: { compact: (value: number) => number }) { return P.compact; }',
        setup: 'const provider = {};', probe: 'read(provider) === undefined' },
    { name: 'receiver-failure', declaration: 'function read(P: { compact: (value: number) => number }) { return P.compact; }',
        setup: 'const provider = null;', probe: 'read(provider)' },
    { name: 'getter-failure', declaration: 'function read(P: { compact: (value: number) => number }) { return P.compact; }',
        setup: 'const failure = new Error("getter"); const provider = { get compact() { events = [...events, "get"]; throw failure; } };',
        probe: '(() => { try { read(provider); } catch (error) { return error === failure; } })()' },
    { name: 'factory-order', declaration: [
        'function read(make: () => { compact: (value: number) => number; separate: (value: number) => number }) {',
        'const { compact, separate } = make(); return { compact, separate }; }'
    ].join('\n'),
    setup: [
        'const token = (value: number) => value; const make = () => { events = [...events, "factory"]; return {',
        'get compact() { events = [...events, "compact"]; return token; },',
        'get separate() { events = [...events, "separate"]; return token; } }; };'
    ].join('\n'),
    probe: '(() => { const result = read(make); return result.compact === token && result.separate === token; })()' },
    { name: 'factory-failure', declaration: 'function read(make: () => { compact: (value: number) => number }) { const { compact } = make(); return { compact }; }',
        setup: 'const failure = new Error("factory"); const make = () => { events = [...events, "factory"]; throw failure; };',
        probe: '(() => { try { read(make); } catch (error) { return error === failure; } })()' },
    { name: 'selected-skipped', declaration: 'function read(M: { empty: string }, selected: boolean) { return selected ? M.empty : "value"; }',
        setup: 'const provider = { get empty() { events = [...events, "get"]; return "identity"; } };', probe: 'read(provider, false)' },
    { name: 'selected-missing', declaration: 'function read(M: { empty: string }, selected: boolean) { return selected ? M.empty : "value"; }',
        setup: 'const provider = {};', probe: 'read(provider, true) === undefined' },
    { name: 'selected-get', declaration: 'function read(M: { empty: string }, selected: boolean) { return selected ? M.empty : "value"; }',
        setup: 'const provider = { get empty() { events = [...events, "get"]; return "identity"; } };', probe: 'read(provider, true)' },
    { name: 'generic-value-identity', declaration: 'function read<T>(P: { value: T }) { return P.value; }',
        setup: 'const token = {}; const provider = { get value() { events = [...events, "get"]; return token; } };',
        probe: 'read(provider) === token' },
    { name: 'generic-value-missing', declaration: 'function read<T>(P: { value: T }) { return P.value; }',
        setup: 'const provider = {};', probe: 'read(provider) === undefined' },
    { name: 'generic-constructor-order', declaration: [
        'const wrap = <T>(value: T) => { events = [...events, "wrap"]; return { value }; };',
        'function read<T>(P: { value: T }) { return wrap(P.value); }'
    ].join('\n'), setup: 'const token = {}; const provider = { get value() { events = [...events, "get"]; return token; } };',
    probe: 'read(provider).value === token' },
    { name: 'generic-guarded-skip', declaration: 'function read<T>(P: { value: T }, selected: boolean) { if (selected) return P.value; return "skip"; }',
        setup: 'const provider = { get value() { events = [...events, "get"]; return {}; } };', probe: 'read(provider, false)' },
    { name: 'deferred-owner-phase', declaration: 'function read<T>(P: { value: T }, wrap: (value: T) => T) { return () => wrap(P.value); }',
        setup: 'const provider = { get value() { events = [...events, "get"]; return 0; } };',
        probe: '(() => { const later = read(provider, value => value); const before = events.length; return [before, later()]; })()' },
    { name: 'shadowed-absence-value', declaration: 'function read<T>(P: { value: T }, undefined: number) { return P.value; }',
        setup: 'const provider = {};', probe: 'read(provider, 7) === void 0' },
    ...[true, false].map(selected => ({
        name: `selected-generic-${selected}`,
        declaration: [
            'const isSelected = (input: { tag: boolean }) => input.tag;',
            'function read<T>(P: { empty: T }, wrap: () => T, input: { tag: boolean }) { return isSelected(input) ? P.empty : wrap(); }'
        ].join('\n'),
        setup: [
            'const token = {}; const provider = { get empty() { events = [...events, "empty"]; return token; } };',
            `const input = { get tag() { events = [...events, "tag"]; return ${selected}; } };`,
            'const wrap = () => { events = [...events, "wrap"]; return token; };'
        ].join('\n'), probe: 'read(provider, wrap, input) === token'
    })),
    { name: 'selected-generic-missing', declaration: [
        'const isSelected = (input: { tag: boolean }) => input.tag;',
        'function read<T>(P: { empty: T }, wrap: () => T, input: { tag: boolean }) { return isSelected(input) ? P.empty : wrap(); }'
    ].join('\n'), setup: 'const provider = {};', probe: 'read(provider, () => 7, { tag: true }) === void 0' },
    { name: 'contextual-curried-missing', declaration: [
        'const isSelected = (input: { tag: boolean }) => input.tag;',
        'const read: <T>(P: { empty: T }) => (wrap: () => T) => (input: { tag: boolean }) => T =',
        'P => wrap => input => isSelected(input) ? P.empty : wrap();'
    ].join('\n'), setup: 'const provider = {};', probe: 'read(provider)(() => 7)({ tag: true }) === void 0' }
];
const sources = new Map([
    ...cases.map(({ name = '', code = '' } = {}) => [`${name}.ts`, `export {};\n${code}`]),
    ...traces.map(({ name = '', declaration = '', setup = '' } = {}) => [
        `${name}.ts`, `export {};\nlet events: string[] = [];\n${declaration}\n${setup}`
    ])
].map(([name = '', code = ''] = []) => [name, typescript.createSourceFile(name, code, typescript.ScriptTarget.ESNext, true)]));
const compilerOptions = { strict: true, target: typescript.ScriptTarget.ESNext };
const compilerHost = typescript.createCompilerHost(compilerOptions);
const program = typescript.createProgram([...sources.keys()], compilerOptions, {
    ...compilerHost,
    getSourceFile: (name, version) => sources.get(name) || compilerHost.getSourceFile(name, version)
});
cases.forEach(({ name = '', count = 0 } = {}) => {
    const sourceFile = sources.get(`${name}.ts`);
    const checker = program.getTypeChecker();
    const deferredOpaqueFieldContracts = collectDeferredOpaqueFieldContracts({ typescript, sourceFile, checker });
    const contracts = collectExactProviderForwardContracts({ typescript, sourceFile, checker, deferredOpaqueFieldContracts });

    if (name === 'deferred-owned') assert.equal(deferredOpaqueFieldContracts.size, 2,
        'The existing deferred owner has lawful non-overlap; no second provider fact is published.');

    const agreements = collectDestructuringAgreements({ exactProviderForwards: contracts });
    assert.equal(contracts.size, count, name);
    const nodes = [
        ...nodesOfKind({ root: sourceFile, kind: typescript.SyntaxKind.BindingElement }),
        ...nodesOfKind({ root: sourceFile, kind: typescript.SyntaxKind.PropertyAccessExpression })
    ];
    nodes.forEach((node) => {
        const { agreement: { action = '' } = {} } = getDestructuringDecisionForNode({ typescript, node, destructuringAgreements: compileDestructuringDecisions(agreements),
            kinds: ['exact-provider-forward'] });
        assert.equal(action === 'exact-provider-forward', contracts.has(getConsumerContractKey(node)), name);
    });
});

const sourceFile = sources.get('selected.ts');
const [owned = {}] = nodesOfKind({ root: sourceFile, kind: typescript.SyntaxKind.PropertyAccessExpression });
const contracts = collectExactProviderForwardContracts({ typescript, sourceFile, checker: program.getTypeChecker() });
const agreements = collectDestructuringAgreements({ exactProviderForwards: contracts });
const [contract = {}] = contracts.values();
const unrelated = typescript.createSourceFile('unrelated.ts', 'const { empty } = unrelated;', typescript.ScriptTarget.ESNext, true);
const [unrelatedElement = {}] = nodesOfKind({ root: unrelated, kind: typescript.SyntaxKind.BindingElement });
const place = (node = {}, map = compileDestructuringDecisions(agreements)) => {
    const pattern = typescript.factory.createObjectBindingPattern([node]);
    const { transformed: [result = pattern] = [], dispose = () => {} } = typescript.transform(pattern, [
        context => root => lowerExactProviderForwarding({ typescript, node: root, destructuringAgreements: map, context })
    ]);
    const { elements: [element = node] = [] } = result;
    dispose();

    return element;
};
assert.equal(place(unrelatedElement), unrelatedElement, 'A member-only match cannot acquire another receiver\'s decision.');
const factoryBinding = typescript.factory.createBindingElement(undefined, undefined, 'empty', undefined);
assert.equal(place(factoryBinding), factoryBinding, 'A rangeless factory binding has no source admission.');
const ownedBinding = typescript.setOriginalNode(
    typescript.factory.createBindingElement(undefined, undefined, 'empty', undefined), owned
);
const placedBinding = place(ownedBinding);
const { initializer: { text: initializerText = '' } = {} } = placedBinding;
assert.equal(initializerText, 'undefined', 'Existing original-node provenance admits the completed source owner.');
assert.equal(typescript.getOriginalNode(placedBinding), owned);
assert.equal(getDestructuringDecisionForNode({ typescript, node: placedBinding, destructuringAgreements: compileDestructuringDecisions(agreements),
    kinds: ['exact-provider-forward'] }).contract, contract);
assert.equal(contracts.size, 1);

// Original range wins; a rangeless original can use the existing direct range.
const clone = typescript.setOriginalNode(typescript.factory.createPropertyAccessExpression('other', 'empty'), owned);
typescript.setTextRange(clone, { pos: owned.pos + 1, end: owned.end });
assert.equal(getDestructuringDecisionForNode({ typescript, node: clone, destructuringAgreements: compileDestructuringDecisions(agreements),
    kinds: ['exact-provider-forward'] }).contract, contract);
const directRange = typescript.setOriginalNode(
    typescript.setTextRange(typescript.factory.createPropertyAccessExpression('M', 'empty'), owned),
    typescript.factory.createPropertyAccessExpression('other', 'empty')
);
assert.equal(getDestructuringDecisionForNode({ typescript, node: directRange, destructuringAgreements: compileDestructuringDecisions(agreements),
    kinds: ['exact-provider-forward'] }).contract, contract);
const before = [...agreements];
const collision = collectDestructuringAgreements({ sortCapabilityContracts: new Map([[getConsumerContractKey(owned), {
    action: 'guard-sort-capability', receiver: 'M', member: 'empty'
}]]), exactProviderForwards: contracts });
assert.ok(place(ownedBinding, compileDestructuringDecisions(collision)) === ownedBinding, 'Direct callable-consumer Policy keeps precedence over forwarding.');
const projectionCollision = collectDestructuringAgreements({ exactProjections: new Map([[getConsumerContractKey(owned), {
    action: 'exact-callback-projection', receiver: 'M', member: 'empty'
}]]), exactProviderForwards: contracts });
assert.equal(place(ownedBinding, compileDestructuringDecisions(projectionCollision)), ownedBinding,
    'The completed callback projection retains its own placement and publication timing.');
assert.deepEqual([...agreements], before, 'Placement does not publish a second source decision.');
const failure = new Error('lookup');
const failedLookup = compileDestructuringDecisions(agreements);
Object.defineProperty(failedLookup.byKey, 'get', { value: () => { throw failure; } });
assert.throws(() => place(ownedBinding, failedLookup), error => error === failure,
    'The selected exact lookup keeps native failure identity.');
let unrelatedReads = 0;
const unrelatedContract = { kind: 'exact-provider-forward', contract: {} };
const isolated = compileDestructuringDecisions(new Map([...agreements, ['unrelated', [unrelatedContract]]]));
Object.defineProperty(unrelatedContract, 'contract', { get: () => {
    unrelatedReads += 1;

    throw new Error('unrelated record');
} });
place(ownedBinding, isolated);
assert.equal(unrelatedReads, 0, 'Exact lookup no longer executes an unrelated fallback classification scan.');

const branchSource = sources.get('selected-generic.ts');
const branchContracts = collectExactProviderForwardContracts({ typescript, sourceFile: branchSource, checker: program.getTypeChecker() });
const branchAgreements = collectDestructuringAgreements({ exactProviderForwards: branchContracts });
const branchPlacement = compilePlacementDecisions({ typescript, evidence: collectPlacementEvidence({
    typescript, sourceFile: branchSource, checker: program.getTypeChecker()
}) });
const { transformed: [branchResult = branchSource] = [], dispose: releaseBranch = () => {} } = typescript.transform(branchSource, [
    context => root => lowerGuardedConditionalReturns({
        typescript, sourceFile: root, placement: branchPlacement, destructuringAgreements: compileDestructuringDecisions(branchAgreements), context
    })
]);
const ownedBranchBindings = nodesOfKind({ root: branchResult, kind: typescript.SyntaxKind.BindingElement }).filter((node) => {
    const { agreement: { action = '' } = {} } = getDestructuringDecisionForNode({
        typescript, node, destructuringAgreements: compileDestructuringDecisions(branchAgreements), kinds: ['exact-provider-forward']
    });

    return action === 'exact-provider-forward';
});
assert.equal(ownedBranchBindings.length, 1, 'Branch construction preserves the original provider read identity.');
const [ownedBranchBinding = {}] = ownedBranchBindings;
const { initializer: branchInitializer = false } = ownedBranchBinding;
assert.equal(branchInitializer, false, 'Branch construction carries origin; existing provider placement owns the default and report publication.');
const { initializer: { text: branchDefault = '' } = {} } = place(ownedBranchBinding, compileDestructuringDecisions(branchAgreements));
assert.equal(branchDefault, 'undefined', 'Existing provider placement consumes the completed Policy by exact provenance, not a member-name fallback.');
assert.ok(branchContracts.has(getConsumerContractKey(typescript.getOriginalNode(ownedBranchBinding))));
releaseBranch();

const capabilitySources = new Map([
    ['direct.ts', [
        'type Provider = { of: (value: string) => string };',
        'function lift(F: Provider, value: string) { return F.of(value); }',
        'function unrelated(F: Provider) { return F.of; }'
    ].join('\n')],
    ['sort.ts', [
        'type Ord = { compare: (left: number, right: number) => number };',
        'function sort(O: Ord, values: number[]) { return values.slice().sort(O.compare); }',
        'function unrelated(O: Ord) { return O.compare; }'
    ].join('\n')]
].map(([name = '', code = ''] = []) => [name, typescript.createSourceFile(
    name, code, typescript.ScriptTarget.ESNext, true
)]));
const capabilityHost = typescript.createCompilerHost(compilerOptions);
const capabilityProgram = typescript.createProgram([...capabilitySources.keys()], compilerOptions, {
    ...capabilityHost,
    getSourceFile: (name, version) => capabilitySources.get(name) || capabilityHost.getSourceFile(name, version)
});
const capabilityChecker = capabilityProgram.getTypeChecker();
const directFile = capabilitySources.get('direct.ts');
const sortFile = capabilitySources.get('sort.ts');
const directContracts = collectDirectCapabilityContracts({ typescript, sourceFile: directFile, checker: capabilityChecker });
const sortContracts = collectSortCapabilityContracts({ typescript, sourceFile: sortFile, checker: capabilityChecker });
const capabilityAgreements = collectDestructuringAgreements({
    directCapabilityContracts: directContracts, sortCapabilityContracts: sortContracts
});
assert.equal(directContracts.size, 1, 'Only the checker-admitted direct call publishes a capability.');
assert.equal(sortContracts.size, 1, 'Only the checker-admitted static sort publishes a capability.');
const capabilityReads = [
    ...nodesOfKind({ root: directFile, kind: typescript.SyntaxKind.PropertyAccessExpression }),
    ...nodesOfKind({ root: sortFile, kind: typescript.SyntaxKind.PropertyAccessExpression })
].filter(({ name: { text = '' } = {} } = {}) => ['of', 'compare'].includes(text));
capabilityReads.forEach((node = {}) => {
    const { entry = {} } = findCapabilityConsumerDecision({
        typescript, node, destructuringAgreements: compileDestructuringDecisions(capabilityAgreements),
        kinds: ['direct-capability', 'sort-capability']
    });
    const { parent = {}, name: { text = '' } = {} } = node;
    const { kind: parentKind = 0, expression = {}, arguments: args = [] } = parent;
    const { kind: entryKind = '' } = entry;
    const admitted = parentKind === typescript.SyntaxKind.CallExpression &&
        (expression === node || args.includes(node));

    assert.equal(Boolean(entryKind), admitted, 'A same-spelled neighbor cannot borrow an admitted source decision.');

    if (!admitted) return;

    const clone = typescript.setOriginalNode(typescript.factory.createPropertyAccessExpression('other', text), node);
    assert.equal(findCapabilityConsumerDecision({ typescript, node: clone, destructuringAgreements: compileDestructuringDecisions(capabilityAgreements),
        kinds: ['direct-capability', 'sort-capability'] }).entry, entry,
    'A transformed read keeps its source decision through original-node provenance.');
});

const linter = new Linter();
const lintConfig = { plugins: { resilient }, rules: {
    'resilient/prefer-safe-destructuring-defaults': 'error',
    'resilient/prefer-destructured-member-access': 'error'
} };
const transformer = createTypeScriptTransformer({ typescript, program });
cases.forEach(({ name = '', count = 0 } = {}) => {
    const source = sources.get(`${name}.ts`).getFullText();
    const { diagnostics = [], agreements: published = [] } = transformer.transform({ code: source, fileName: `${name}.ts` });
    const reports = published.filter(({ action = '', site = '' } = {}) => action === 'exact-provider-forwarded' &&
        site === 'exact-provider-forwarding');

    assert.deepEqual(diagnostics, [], name);
    assert.equal(reports.length, count, `${name}: each admitted source fact has one public forwarding report`);
});
const observe = async ({ text = '', probe = '' } = {}) => {
    const resolved = ['object', 'array', 'function'].reduce((result = '', module = '') => result.replaceAll(
        `eslint-plugin-resilient/standard/${module}`, import.meta.resolve(`eslint-plugin-resilient/standard/${module}`)
    ), text);
    const suffix = `let value; let failureName;
        try { value = ${probe}; } catch (error) { failureName = error.name; }
        export default JSON.stringify({ events, value, failureName });`;
    const { default: observation = '' } = await import(`data:text/javascript,${encodeURIComponent(`${resolved}\n${suffix}`)}`);

    return observation;
};
await Promise.all(traces.map(async ({ name = '', probe = '' } = {}) => {
    const source = sources.get(`${name}.ts`).getFullText();
    const { code = '', diagnostics = [], agreements: published = [] } = transformer.transform({ code: source, fileName: `${name}.ts` });
    assert.deepEqual(diagnostics, [], name);

    if (name.startsWith('selected-generic') || name === 'contextual-curried-missing' || name.startsWith('identifier-')) assert.ok(
        published.some(({ action = '', site = '' } = {}) => action === 'exact-provider-forwarded' && site === 'exact-provider-forwarding'),
        `${name}: the existing placement owner still publishes its agreement`
    );

    const { outputText: original = '' } = typescript.transpileModule(source, { compilerOptions });
    const expected = await observe({ text: original, probe });
    const { output: fixed = code, messages = [] } = linter.verifyAndFix(code, lintConfig);
    const lintRules = messages.filter(({ ruleId = '' } = {}) => ruleId).map(({ ruleId = '' } = {}) => ruleId);
    const rejectedOptionalRead = name.startsWith('optional-syntax') || name === 'selected-optional-null';

    assert.deepEqual(lintRules, rejectedOptionalRead ? ['resilient/prefer-destructured-member-access'] : [], name);
    assert.equal(await observe({ text: code, probe }), expected, `${name}: public transform`);
    assert.equal(await observe({ text: fixed, probe }), expected, `${name}: targeted fixed output`);
}));
