import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { getExceptionInventory } from '../scripts/audit-eslint-exceptions.js';
import { annotateFinalExceptions } from '../transforms/typescript/grammar/final.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { getDestructuringDecisionForNode } from '../transforms/typescript/policy/destructuring-agreements.js';
import { annotateRetainedStaticMemberAccess } from '../transforms/typescript/policy/exceptions.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import {
    collectDirectCapabilityContracts,
    collectCallableOperationContracts,
    collectClosedStructuralModelContracts,
    getConsumerContractKey
} from '../transforms/typescript/understand/type-evidence.js';

const operationRule = 'resilient/signature-contract-operation';
const propertyRule = 'resilient/signature-contract-property';
const operationReason = 'generic typeclass dictionary is selected by a runtime capability guard';
const propertyReason = 'generic typeclass member is supplied by the caller and remains opaque here';
const parse = (code = '') => typescript.createSourceFile('property-owner.ts', code, typescript.ScriptTarget.ESNext, true);
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
const place = (sourceFile = {}) => {
    const { transformed: [placed = sourceFile] = [], dispose = () => {} } = typescript.transform(sourceFile, [
        context => root => annotateFinalExceptions({ typescript, sourceFile: root, context })
    ]);
    const code = typescript.createPrinter().printFile(placed);
    dispose();

    return code;
};
const linter = new Linter();
const lintConfig = { plugins: { resilient }, rules: {
    [operationRule]: 'error', [propertyRule]: 'error'
}, linterOptions: { reportUnusedDisableDirectives: 'error' } };
const retainedLintConfig = { ...lintConfig, rules: {
    ...lintConfig.rules, 'resilient/prefer-destructured-member-access': 'error'
} };
const summarize = (messages = []) => messages.map(({ ruleId = '', message = '' } = {}) => ({ ruleId, message }));

// No source agreement: a spelling must not approve a dictionary or hide errors.
const placementCases = [
    { name: 'native array', code: 'function read() { const r = [1]; return r.map(value => value); }' },
    { name: 'known authored operation', code: 'function read() { const r = { map: value => value }; return r.map(1); }' },
    { name: 'unknown caller', code: 'function read(r) { return r.filter(1); }' },
    { name: 'known wrong receiver', code: 'function read() { const r = ""; return r.reduce(value => value); }',
        contradiction: 1 },
    { name: 'missing closed property', code: 'function read() { const S = { value: 1 }; return S.show; }',
        contradiction: 1 },
    { name: 'present closed property', code: 'function read() { const S = { show: 1 }; return S.show; }' },
    { name: 'native string concat', code: 'function read() { const S = ""; return S.concat("a"); }' },
    { name: 'different receiver spelling', code: 'function read(user) { return user.show; }' },
    { name: 'computed property', code: 'function read(S) { return S["show"]; }' },
    { name: 'computed operation', code: 'function read(r) { return r["map"](1); }' },
    { name: 'deferred expression arrow', code: 'function read(S) { return () => S.show; }' },
    { name: 'top-level expression arrow', code: 'const read = S => S.show;' },
    { name: 'deferred block owns placement', code: 'function read(S) { return () => { return S.show; }; }' },
    { name: 'guarded block has no spelling approval', code: 'function read(r) { if (r) { return r.map(1); } }' },
    { name: 'independent unproved families', code: 'function read(r, S) { return [S.show, r.map(1), S.concat, r.reduce(1), r.filter(1)]; }' }
];
placementCases.forEach(({ name = '', code = '', contradiction = 0 } = {}) => {
    const output = place(parse(code));
    assert.equal(output.split(operationReason).length - 1, 0, name);
    assert.equal(output.split(propertyReason).length - 1, 0, name);
    const raw = linter.verify(code, lintConfig);
    const remaining = linter.verify(output, lintConfig);
    const suppressed = linter.getSuppressedMessages();

    assert.equal(remaining.filter(({ ruleId = '' } = {}) => !ruleId).length, 0, name);

    if (contradiction) {
        assert.equal(raw.length, contradiction, name);
        assert.equal(suppressed.length, 0, `${name}: unproved suppression cannot hide a contradiction`);
    }

    const { messages = [], output: fixed = output } = linter.verifyAndFix(output, lintConfig);
    assert.deepEqual(summarize(messages), summarize(remaining.filter(({ ruleId = '' } = {}) => ruleId)), name);
    assert.equal(linter.verify(fixed, lintConfig).filter(({ ruleId = '' } = {}) => !ruleId).length, 0,
        `${name}: fixing removes unused directives, not the uncovered semantic obligation`);
});

const mixed = place(parse('function read(r, S) { return [S.show, r.map(1), S.concat, r.reduce(1)]; }'));
assert.doesNotMatch(mixed, /eslint-disable-next-line/, 'Unproved mixed families do not create an exception.');
const collisionFile = parse('function read(r, S) { return [r.map(1), S.show]; }');
const { transformed: [withPriorComment = collisionFile] = [], dispose: releaseCollision = () => {} } = typescript.transform(
    collisionFile, [context => (root) => {
        const visit = (node = {}) => {
            if (typescript.isReturnStatement(node)) return typescript.addSyntheticLeadingComment(
                node, typescript.SyntaxKind.SingleLineCommentTrivia,
                ` eslint-disable-next-line ${operationRule} -- source-owned prior reason`, true
            );

            return typescript.visitEachChild(node, visit, context);
        };

        return annotateFinalExceptions({ typescript, sourceFile: typescript.visitNode(root, visit), context });
    }]
);
const collisionOutput = typescript.createPrinter().printFile(withPriorComment);
releaseCollision();
assert.equal(collisionOutput.split(operationRule).length - 1, 1);
assert.match(collisionOutput, /source-owned prior reason/);
assert.doesNotMatch(collisionOutput, new RegExp(operationReason));
assert.equal(collisionOutput.split(propertyReason).length - 1, 0);

// Real checker admission is narrower than final placement. Rejections stay visible.
const providerType = '{ map: (value: number) => number }';
const factCases = [
    { name: 'required inert return', code: `function read(r: ${providerType}) { return r.map(1); }`, count: 1 },
    { name: 'different spelling admitted', code: `function read(provider: ${providerType}) { return provider.map(1); }`, count: 1 },
    { name: 'guarded inert return has no direct guard placement', code: `function read(r: ${providerType}) { if (r) return r.map(1); }` },
    { name: 'expression arrow', code: `const read = (r: ${providerType}) => r.map(1);`, count: 1 },
    { name: 'effectful argument rejected', code: `function read(r: ${providerType}) { return r.map(Number("1")); }` },
    { name: 'optional member rejected', code: 'function read(r: { map?: (value: number) => number }) { return r.map(1); }' },
    { name: 'explicit receiver rejected', code: 'function read(r: { map: (this: object, value: number) => number }) { return r.map(1); }' },
    { name: 'untyped receiver rejected', code: 'function read(r) { return r.map(1); }' },
    { name: 'native array rejected', code: 'function read(r: number[]) { return r.map(value => value); }' },
    { name: 'multiple candidates rejected', code: `function read(r: ${providerType}) { r.map(1); return r.map(2); }` },
    { name: 'nested captured receiver rejected', code: `function read(r: ${providerType}) { return () => r.map(1); }` },
    { name: 'general host rejected', code: `function read(r: ${providerType}) { return [r.map(1)]; }` }
];
const retentionCases = [
    { name: 'effectful typed provider', code: `function read(r: ${providerType}) { return r.map(Number("1")); }`, count: 3 },
    { name: 'optional callable keeps failure', code: 'function read(r: { map?: (value: number) => number }) { return r.map(Number("1")); }', count: 3 },
    { name: 'explicit receiver keeps binding', code: 'function read(dict: { reduce: (this: object, value: number) => number }) { return dict.reduce(Number("1")); }', count: 3 },
    { name: 'renamed guarded provider', code: `function read(dict: ${providerType}) { if (dict) { return dict.map(Number("1")); } }`, count: 3 },
    { name: 'guarded inert native call is retained', code: `function read(dict: ${providerType}) { if (dict) { return dict.map(1); } }`, count: 3 },
    { name: 'deferred expression provider', code: `function read(dict: ${providerType}) { return () => dict.map(Number("1")); }`, count: 2 },
    { name: 'deferred block provider', code: `function read(dict: ${providerType}) { return () => { return dict.map(Number("1")); }; }`, count: 3 },
    { name: 'existing inert owner', code: `function read(dict: ${providerType}) { return dict.map(1); }` },
    { name: 'guarded sibling still rejects unique guard', code: `function read(dict: ${providerType}) { if (dict) dict.map(1); return dict.map(2); }`,
        count: 6, boundaries: 2 },
    { name: 'noncallable is not admitted', code: 'function read() { const r = { map: 1 }; return r.map(1); }' },
    { name: 'missing member is not admitted', code: 'function read() { const r = { value: 1 }; return r.map(1); }' },
    { name: 'unknown receiver is not admitted', code: 'function read(r) { return r.map(Number("1")); }' },
    { name: 'computed call is not admitted', code: `function read(dict: ${providerType}) { return dict["map"](Number("1")); }` },
    { name: 'same unit contradiction stays visible', code: 'function read() { const dict = { map: value => value }; return dict.map("".map(1)); }' },
    { name: 'same line deferred contradiction stays visible', code: 'function read() { const dict = { map: value => value }; return dict.map(() => "".map(1)); }' },
    { name: 'completed model and custom call have separate owners',
        code: 'function read<T>(dict: { map: (value: T, forest: number[]) => number }, arg: { value: T; forest: number[] }) { return dict.map(arg.value, arg.forest); }', count: 1 },
    { name: 'mixed argument owners are not admitted',
        code: 'function read<T>(dict: { map: (...values: any[]) => number }, arg: { value: T; forest: number[] }, other: { value: number }) { return dict.map(arg.value, arg.forest, other.value); }' },
    { name: 'another parameter phase is not acquired',
        code: `function factory(arg: { value: number }) { return (dict: ${providerType}) => dict.map(arg.value); }` },
    { name: 'conditional header does not own its branch region',
        code: 'function read(dict: { map: (value: number) => boolean }, arg: { value: number }) { if (dict.map(arg.value)) return arg.value; return 0; }' },
    { name: 'nested scoped placements are not admitted',
        code: 'const arg = { value: 1 }; const dict = { map: (value: any) => value }; function read() { const value = dict.map(() => dict.map(arg.value)); return value; }' }
];
assert.equal(collectCallableOperationContracts({ typescript, sourceFile: parse('dict.map(1);') }).size, 0,
    'Missing checker evidence does not approve a call.');
assert.equal(collectCallableOperationContracts({ typescript, sourceFile: parse('dict.map(1);'),
    checker: { getTypeAtLocation: () => ({}) } }).size, 0,
'Missing symbol ownership does not approve a call.');
const publicCases = [
    { name: 'native-array', code: 'function read() { const r = [1]; return r.map(value => value); }' },
    { name: 'wrong-native', code: 'function read() { const r = ""; return r.map(value => value); }', visible: 1 },
    { name: 'missing-closed-member', code: 'function read() { const S = { value: 1 }; return S.show; }', propertyBoundary: 0 }
];
const sources = new Map([...factCases, ...retentionCases, ...publicCases].map(({ name = '', code = '' } = {}) => [
    `${name}.ts`, typescript.createSourceFile(`${name}.ts`, `export {};\n${code}`, typescript.ScriptTarget.ESNext, true)
]));
const compilerOptions = { strict: true, target: typescript.ScriptTarget.ESNext };
const compilerHost = typescript.createCompilerHost(compilerOptions);
const program = typescript.createProgram([...sources.keys()], compilerOptions, {
    ...compilerHost,
    getSourceFile: (name, version) => sources.get(name) || compilerHost.getSourceFile(name, version)
});
factCases.forEach(({ name = '', count = 0 } = {}) => {
    const sourceFile = sources.get(`${name}.ts`);
    const directCapabilityContracts = collectDirectCapabilityContracts({ typescript, sourceFile, checker: program.getTypeChecker() });
    assert.equal(directCapabilityContracts.size, count, name);

    if (!count) return;

    const agreements = collectDestructuringAgreements({ directCapabilityContracts });
    const before = [...agreements];
    const [member = {}] = nodesOfKind({ root: sourceFile, kind: typescript.SyntaxKind.PropertyAccessExpression });
    const [call = {}] = nodesOfKind({ root: sourceFile, kind: typescript.SyntaxKind.CallExpression });
    const { parent: callParent = {} } = call;
    const functionNode = typescript.isArrowFunction(callParent) ? callParent : sourceFile.statements.find(
        node => typescript.isFunctionDeclaration(node)
    );
    const { entry = {}, contract = {}, agreement = {} } = getDestructuringDecisionForNode({
        typescript, node: member, destructuringAgreements: compileDestructuringDecisions(agreements), kinds: ['direct-capability']
    });
    const { callKey = '', functionKey = '', action = '' } = contract;
    assert.equal(callKey, getConsumerContractKey(call));
    assert.equal(functionKey, getConsumerContractKey(functionNode));
    assert.equal(action, 'guard-function-undefined');
    const { action: policyAction = '' } = agreement;
    const { contract: entryContract = {} } = entry;
    assert.equal(policyAction, 'guard-function-undefined');
    assert.equal(entryContract, directCapabilityContracts.get(getConsumerContractKey(member)));

    const clone = typescript.factory.createPropertyAccessExpression(typescript.factory.createIdentifier('renamed'), 'map');
    typescript.setOriginalNode(clone, member);
    typescript.setTextRange(clone, { pos: 10000, end: 10020 });
    const directCollision = { kind: 'unrelated-direct-range', contract: {} };
    const originalFirst = new Map([...agreements, [getConsumerContractKey(clone), [directCollision]]]);
    assert.equal(getDestructuringDecisionForNode({ typescript, node: clone, destructuringAgreements: compileDestructuringDecisions(originalFirst) }).entry,
        entry, 'A direct-range collision must not override the completed original-source decision.');
    const originalDecision = getDestructuringDecisionForNode({ typescript, node: clone, destructuringAgreements: compileDestructuringDecisions(agreements) });
    const { entry: originalEntry = {} } = originalDecision;
    assert.equal(originalEntry, entry, 'Renaming a clone cannot change source ownership.');
    typescript.setOriginalNode(clone, typescript.factory.createIdentifier('rangeless'));
    typescript.setTextRange(clone, member);
    assert.equal(getDestructuringDecisionForNode({ typescript, node: clone, destructuringAgreements: compileDestructuringDecisions(agreements) }).entry, entry,
        'Direct range is used only when the original shell has no matching entry.');

    const collision = { kind: 'unrelated-owner', contract: { action: 'retain' } };
    const ordered = new Map([[getConsumerContractKey(member), [collision, entry]]]);
    assert.equal(getDestructuringDecisionForNode({ typescript, node: member, destructuringAgreements: compileDestructuringDecisions(ordered) }).entry, collision);
    assert.equal(getDestructuringDecisionForNode({ typescript, node: member, destructuringAgreements: compileDestructuringDecisions(ordered),
        kinds: ['direct-capability'] }).entry, entry, 'Kind filtering preserves first accepted entry identity.');
    assert.deepEqual([...agreements], before);
});

const placeCompleted = ({ sourceFile = {}, contracts = new Map(), clonePlacement = '' } = {}) => {
    const destructuringAgreements = collectDestructuringAgreements({ callableOperationContracts: contracts });
    const before = [...destructuringAgreements];
    const { transformed: [placed = sourceFile] = [], dispose = () => {} } = typescript.transform(sourceFile, [context => (root) => {
        const visit = (node) => {
            const visited = typescript.visitEachChild(node, visit, context);
            const key = getConsumerContractKey(node);
            const [contract = {}] = [contracts.get(key)];
            const { placementRange = '' } = contract;

            if (!clonePlacement || key !== placementRange) return visited;

            const clone = typescript.factory.cloneNode(visited);
            typescript.setTextRange(clone, node);
            typescript.setOriginalNode(clone, clonePlacement === 'original' ? node : typescript.factory.createIdentifier('rangeless'));

            return clone;
        };

        return annotateRetainedStaticMemberAccess({ typescript, sourceFile: typescript.visitNode(root, visit),
            destructuringAgreements: compileDestructuringDecisions(destructuringAgreements), context });
    }]);
    const code = typescript.createPrinter().printFile(placed);
    dispose();
    assert.deepEqual([...destructuringAgreements], before);

    return typescript.transpileModule(code, { compilerOptions: { target: typescript.ScriptTarget.ESNext } }).outputText;
};
retentionCases.forEach(({ name = '', count = 0, boundaries = 1 } = {}) => {
    const sourceFile = sources.get(`${name}.ts`);
    const checker = program.getTypeChecker();
    const directCapabilityContracts = collectDirectCapabilityContracts({ typescript, sourceFile, checker });
    const closedStructuralModels = collectClosedStructuralModelContracts({ typescript, sourceFile, checker });
    const contracts = collectCallableOperationContracts({ typescript, sourceFile, checker, directCapabilityContracts, closedStructuralModels });
    const records = [...new Set(contracts.values())];
    assert.equal(records.length, count ? boundaries : 0, name);
    const expectedKeys = new Set(records.flatMap(({ sourceRange = '', callKey = '', placementRange = '', protectedBindings = [] } = {}) => [
        sourceRange, callKey, placementRange, ...protectedBindings
    ]));
    assert.deepEqual([...contracts.keys()], [...expectedKeys], name);
    const output = placeCompleted({ sourceFile, contracts });
    assert.equal(output.split('declared callable retains').length - 1, count ? boundaries : 0, name);

    if (!count) return;

    const [[memberRange = '', contract = {}] = []] = [...contracts];
    const { sourceRange = '', placementRange = '', action = '' } = contract;
    assert.equal(memberRange, sourceRange);
    assert.equal(contracts.get(placementRange), contract, 'Member and placement share one original contract.');
    assert.equal(action, 'retain-callable-operation');
    assert.equal(placeCompleted({ sourceFile, contracts, clonePlacement: 'original' }), output,
        `${name}: original-range placement`);
    assert.equal(placeCompleted({ sourceFile, contracts, clonePlacement: 'direct' }), output,
        `${name}: rangeless-original direct placement fallback`);
    assert.equal(output.split(operationReason).length - 1, 0, name);
    assert.equal(output.split(propertyReason).length - 1, 0, name);
});

const throwingAgreements = compileDestructuringDecisions(new Map());
const { byKey: throwingIndex = new Map() } = throwingAgreements;
const queryFailure = new Error('agreement storage failed');
Object.defineProperty(throwingIndex, 'get', { value: () => { throw queryFailure; } });
assert.throws(() => getDestructuringDecisionForNode({ typescript, node: parse('r.map(1);'),
    destructuringAgreements: throwingAgreements }), error => error === queryFailure,
'Lookup retains storage failure identity; absence is not a reason to swallow failure.');

// Public routing is tested separately from the standalone placement owner.
const publicTransformer = createTypeScriptTransformer({ typescript, program });
publicCases.forEach(({ name = '', visible = 0, propertyBoundary = 0 } = {}) => {
    const sourceFile = sources.get(`${name}.ts`);
    const { code: output = '', agreements = [] } = publicTransformer.transform({
        code: sourceFile.getFullText(), fileName: `${name}.ts`
    });
    const messages = linter.verify(output, lintConfig);
    const suppressed = linter.getSuppressedMessages();
    assert.equal(output.split(propertyReason).length - 1, propertyBoundary, name);

    assert.equal(messages.filter(({ ruleId = '' } = {}) => ruleId === operationRule).length, visible, name);

    if (visible) {
        assert.equal(suppressed.filter(({ ruleId = '' } = {}) => ruleId === operationRule).length, 0, name);
        assert.equal(agreements.length, 0, 'A contradiction cannot acquire a completed dictionary agreement.');
    }
});

// Hostile fixtures name the observable, including work that never executes.
const traceCases = [
    { name: 'getter argument callback receiver order', code: [
        'const r = { get map() { events.push("get");',
        'return function(value) { events.push(this === r ? "receiver" : "wrong receiver"); return value(); }; } };',
        'function read() { return r.map((events.push("argument"), () => { events.push("callback"); return 7; })); }'
    ].join('\n'), probe: 'read()', expected: '{"events":["get","argument","receiver","callback"],"value":7}' },
    { name: 'getter failure precedes argument', code: 'const r = { get reduce() { events.push("get"); throw new Error("getter"); } }; function read() { return r.reduce(events.push("argument")); }',
        probe: 'read()', expected: '{"events":["get"],"failure":"Error:getter"}' },
    { name: 'argument failure precedes call', code: [
        'const r = { filter() { events.push("call"); } };',
        'function fail() { events.push("argument"); throw new Error("argument"); } function read() { return r.filter(fail()); }'
    ].join('\n'), probe: 'read()', expected: '{"events":["argument"],"failure":"Error:argument"}' },
    { name: 'false branch never reads member', code: 'const S = { get show() { events.push("get"); throw new Error("unreachable"); } }; function read() { if (false) return S.show; return 3; }',
        probe: 'read()', expected: '{"events":[],"value":3}' },
    { name: 'deferred expression phase', code: 'const S = { get concat() { events.push("get"); return 9; } }; function read() { return () => S.concat; }',
        probe: '(callback => { events.push("later"); return callback(); })(read())', expected: '{"events":["later","get"],"value":9}' },
    { name: 'property getter identity', code: 'const token = {}; const S = { get show() { events.push("get"); return token; } }; function read() { return S.show === token; }',
        probe: 'read()', expected: '{"events":["get"],"value":true}' },
    { name: 'callback failure remains callback owned', code: [
        'const r = { map(callback) { events.push("call"); return callback(); } };',
        'function read() { return r.map(() => { events.push("callback"); throw new Error("callback"); }); }'
    ].join('\n'), probe: 'read()', expected: '{"events":["call","callback"],"failure":"Error:callback"}' },
    { name: 'native noncallable failure follows argument work', code: [
        'const r = { get reduce() { events.push("get"); return 1; } };',
        'function read() { return r.reduce(events.push("argument")); }'
    ].join('\n'), probe: 'read()', expected: '{"events":["get","argument"],"failure":"TypeError:r.reduce is not a function"}' },
    { name: 'poisoned call property cannot replace native receiver call', code: [
        'function method(value) { events.push(this === dict ? "receiver" : "wrong receiver"); return value; }',
        'Object.defineProperty(method, "call", { get() { events.push("poisoned call"); throw new Error("call getter"); } });',
        'const dict = { map: method }; function read() { return dict.map(7); }'
    ].join('\n'), probe: 'read()', expected: '{"events":["receiver"],"value":7}' },
    { name: 'typed argument getter follows method getter', code: [
        'const dict = { get map() { events.push("method getter"); return value => { events.push("call"); return value; }; } };',
        'function read(arg) { return dict.map(arg.value); }'
    ].join('\n'), typedParameter: true,
    probe: 'read({ get value() { events.push("argument getter"); return 7; } })',
    expected: '{"events":["method getter","argument getter","call"],"value":7}' },
    { name: 'typed argument getter failure remains after method getter', code: [
        'const dict = { get map() { events.push("method getter"); return value => { events.push("call"); return value; }; } };',
        'function read(arg) { return dict.map(arg.value); }'
    ].join('\n'), typedParameter: true,
    probe: 'read({ get value() { events.push("argument getter"); throw new Error("argument getter"); } })',
    expected: '{"events":["method getter","argument getter"],"failure":"Error:argument getter"}' },
    { name: 'other argument field cannot trigger early object rest', code: [
        'const dict = { get map() { events.push("method getter"); return value => { events.push("call"); return value; }; } };',
        'function read(arg) { const value = dict.map(arg.value); return value + arg.extra; }'
    ].join('\n'), typedParameter: true,
    probe: 'read({ get value() { events.push("value getter"); return 7; }, get extra() { events.push("extra getter"); return 2; } })',
    expected: '{"events":["method getter","value getter","call","extra getter"],"value":9}' },
    { name: 'optional absent method fails after argument work', code: [
        'function mark() { events.push("argument"); return 1; }',
        'function read(dict) { return dict.map(mark()); }'
    ].join('\n'), typedOptionalProvider: true, probe: 'read({})',
    expected: '{"events":["argument"],"failure":"TypeError:dict.map is not a function"}' },
    { name: 'closed generic array model retains its completed defaults', code: [
        'const dict = { map(value, forest) { events.push("call"); return value + forest.length; } };',
        'function read(arg) { return dict.map(arg.value, arg.forest); }'
    ].join('\n'), typedModel: true, probe: 'read({ value: 2, forest: [3] })', expected: '{"events":["call"],"value":3}' },
    { name: 'deferred argument capture cannot trigger early object rest', code: [
        'const dict = { get map() { events.push("method getter"); return callback => { events.push("call"); return callback(); }; } };',
        'function read(arg) { const value = dict.map(() => arg.value); return value + arg.extra; }'
    ].join('\n'), typedParameter: true,
    probe: 'read({ get value() { events.push("value getter"); return 7; }, get extra() { events.push("extra getter"); return 2; } })',
    expected: '{"events":["method getter","call","value getter","extra getter"],"value":9}' },
    { name: 'multiline argument read keeps a complete local boundary', code: [
        'const dict = { get map() { events.push("method getter"); return (callback, value) => { events.push("call"); return value; }; } };',
        'function read(arg) { return dict.map(() => ({ marker: 1 }), arg.value); }'
    ].join('\n'), typedParameter: true, probe: 'read({ get value() { events.push("argument getter"); return 7; } })',
    expected: '{"events":["method getter","argument getter","call"],"value":7}' },
    { name: 'foreign parameter forwarding keeps its original binding', code: [
        'const dict = { map(value, callback) { events.push("map"); return callback(value); } };',
        'function build(token) { return { of: () => token.empty, apply: () => dict.map(1, value => token.concat(value, 2)) }; }',
        'function read() { const token = { empty: 0, concat(a, b) { events.push(this === token ? "receiver" : "wrong receiver"); return a + b; } };',
        'const built = build(token); return [built.of(), built.apply()]; }'
    ].join('\n'), typedForeignProvider: true, publicOnly: true, probe: 'read()',
    expected: '{"events":["map","receiver"],"value":[0,3]}' },
    { name: 'guarded inert native call does not read poisoned call', code: [
        'function method(value) { events.push(this === input ? "receiver" : "wrong receiver"); return value; }',
        'Object.defineProperty(method, "call", { get() { events.push("poisoned call"); throw new Error("call getter"); } });',
        'const input = { map: method }; function read(dict) { if (dict) { return dict.map(1); } return 0; }'
    ].join('\n'), typedProvider: true, probe: 'read(input)', expected: '{"events":["receiver"],"value":1}' }
];
const traceSources = new Map(traceCases.map(({
    name = '', code = '', typedParameter = false, typedProvider = false, typedOptionalProvider = false, typedModel = false,
    typedForeignProvider = false
} = {}) => {
    let typed = code;

    if (typedParameter) typed = typed.replace('read(arg)', 'read(arg: { value: number; extra: number })');

    if (typedProvider) typed = typed.replace('read(dict)', 'read(dict: { map: (value: number) => number })');

    if (typedOptionalProvider) typed = typed.replace('read(dict)', 'read(dict: { map?: (value: number) => number })');

    if (typedModel) typed = typed.replace('read(arg)', 'read(arg: { value: any; forest: number[] })');

    if (typedForeignProvider) typed = typed.replace('build(token)', 'build(token: { empty: number; concat: (a: number, b: number) => number })');

    return [`${name}.ts`, typescript.createSourceFile(`${name}.ts`, `export {};\nconst events = [];\n${typed}`,
        typescript.ScriptTarget.ESNext, true)];
}));
const traceProgram = typescript.createProgram([...traceSources.keys()], compilerOptions, {
    ...compilerHost,
    getSourceFile: (name, version) => traceSources.get(name) || compilerHost.getSourceFile(name, version)
});
traceCases.forEach(({ name = '', code = '', probe = '', expected = '' } = {}) => {
    const source = `const events = [];\n${code}`;
    const sourceFile = traceSources.get(`${name}.ts`);
    const checker = traceProgram.getTypeChecker();
    const closedStructuralModels = collectClosedStructuralModelContracts({ typescript, sourceFile, checker });
    const contracts = collectCallableOperationContracts({ typescript, sourceFile, checker, closedStructuralModels });
    const placed = placeCompleted({ sourceFile, contracts }).replace('export {};', '');
    const { problems = [], entries = [] } = getExceptionInventory({ file: `${name}.js`, source: placed });
    assert.deepEqual(problems, [], `${name}: emitted P-03 boundary\n${placed}`);
    assert.ok(entries.every(({ rules = [], reason = '' } = {}) => Boolean(rules.length) && Boolean(reason)), name);
    const { output: fixed = placed } = linter.verifyAndFix(placed, retainedLintConfig);
    const observe = (text = '') => runInNewContext(`${text}\nlet value; let failure;
        try { value = ${probe}; } catch (error) { failure = error.name + ":" + error.message; }
        JSON.stringify({ events, value, failure });`);
    assert.equal(observe(source), expected, name);
    assert.equal(observe(placed), expected, `${name}: actual final placement`);
    assert.equal(observe(fixed), expected, `${name}: targeted fixed lint`);
});

const traceTransformer = createTypeScriptTransformer({ typescript, program: traceProgram });
await Promise.all(traceCases.map(async ({ name = '', probe = '', expected = '', typedModel = false, publicOnly = false } = {}) => {
    const sourceFile = traceSources.get(`${name}.ts`);
    const checker = traceProgram.getTypeChecker();
    const closedStructuralModels = collectClosedStructuralModelContracts({ typescript, sourceFile, checker });
    const contracts = collectCallableOperationContracts({ typescript, sourceFile, checker, closedStructuralModels });

    if (!contracts.size && !publicOnly) return;

    const { code = '', diagnostics = [] } = traceTransformer.transform({ code: sourceFile.getFullText(), fileName: `${name}.ts` });
    assert.deepEqual(diagnostics, [], name);
    const { entries: publicEntries = [] } = getExceptionInventory({ file: `${name}.js`, source: code });
    const retainedReason = 'declared callable retains Get, receiver, argument order and native failure';
    assert.equal(publicEntries.filter(({ reason = '' } = {}) => reason === retainedReason).length,
        code.split(retainedReason).length - 1, `${name}: every D-3 public boundary parses completely`);
    const { output: fixed = code } = linter.verifyAndFix(code, retainedLintConfig);
    const observePublic = async (text = '', expression = probe) => {
        const resolved = ['object', 'array', 'function'].reduce((result = '', module = '') => result.replaceAll(
            `eslint-plugin-resilient/standard/${module}`, import.meta.resolve(`eslint-plugin-resilient/standard/${module}`)
        ), text);
        const suffix = `let value; let failure;
            try { value = ${expression}; } catch (error) { failure = error.name + ":" + error.message; }
            export default JSON.stringify({ events, value, failure });`;
        const { default: observation = '' } = await import(`data:text/javascript,${encodeURIComponent(`${resolved}\n${suffix}`)}`);

        return observation;
    };
    assert.equal(await observePublic(code), expected, `${name}: public transformer`);
    assert.equal(await observePublic(fixed), expected, `${name}: fixed public transformer`);

    if (!typedModel) return;

    assert.ok([...contracts.values()].every(({ protectArguments = true } = {}) => !protectArguments),
        'A completed closed-model owner is not replaced by argument retention.');
    assert.equal(await observePublic(code, 'read({ value: 2 })'), '{"events":["call"],"value":2}',
        'Existing admitted model normalization supplies the absent array field.');
    assert.equal(await observePublic(fixed, 'read({ value: 2 })'), '{"events":["call"],"value":2}',
        'Fixed output preserves the completed model default.');
}));
