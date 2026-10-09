import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { ESLint, Linter } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { lowerFinalGrammar } from '../transforms/typescript/grammar/final.js';
import { lowerDirectCapabilityConsumers, lowerSortCapabilityConsumer } from '../transforms/typescript/members/capability-consumers.js';
import { lowerExactCallbackProjections } from '../transforms/typescript/members/exact-projections.js';
import { lowerExactProviderForwarding } from '../transforms/typescript/members/exact-provider-forwarding.js';
import { lowerProviderForwarding } from '../transforms/typescript/members/provider-forwarding.js';
import { lowerResidualMemberAccess } from '../transforms/typescript/members/residual.js';
import { lowerTupleConsumerBindings } from '../transforms/typescript/members/tuple-consumers.js';
import { compileDestructuringDecisions } from '../transforms/typescript/policy/decision-store.js';
import { emitBindingAgreement, getBindingDecision, getDestructuringAgreement } from '../transforms/typescript/policy/defaults.js';
import {
    collectClosedProviderModelContracts,
    collectConsumerBindingContracts,
    collectDirectCapabilityContracts,
    collectProviderEdgeContracts,
    collectReceiverOrderedProjectionContracts,
    collectSortCapabilityContracts,
    getConsumerContractKey,
    getProviderForwardKey
} from '../transforms/typescript/understand/type-evidence.js';

const parse = (code = '') => typescript.createSourceFile('publication.ts', code, typescript.ScriptTarget.ESNext, true);
const missingFixture = (...args) => {
    throw new Error(`Missing proof capability for ${args.length} arguments.`);
};
const nodesMatching = ({ root = {}, accepts = () => false } = {}) => {
    let nodes = [];
    const visit = (node = {}) => {
        if (accepts(node)) nodes = [...nodes, node];

        typescript.forEachChild(node, visit);
    };
    visit(root);

    return nodes;
};
const files = [
    'grammar/final.js', 'members/capability-consumers.js', 'members/exact-projections.js',
    'members/exact-provider-forwarding.js', 'members/provider-forwarding.js',
    'members/residual.js', 'members/tuple-consumers.js', 'policy/defaults.js'
];
// Parse actual source operations, not a catalog approval registry or copied
// implementation. This finite proof ends at the insertion's local control unit;
// whole-lowerer admission and factory phases have separate tests below.
const units = files.flatMap((file = '') => {
    const source = readFileSync(new URL(`../transforms/typescript/${file}`, import.meta.url), 'utf8');
    const root = parse(source);
    const calls = nodesMatching({ root, accepts: node => typescript.isCallExpression(node) &&
        node.expression.getText(root) === 'agreements.add' });

    return calls.map(({ arguments: argumentsList = [], parent: statement = {} } = {}) => {
        const [argument = {}] = argumentsList;
        const { parent = {} } = statement;
        const { statements = [] } = parent;
        const control = typescript.isIfStatement(parent) ? parent : statement;
        const scoped = file === 'members/exact-provider-forwarding.js';
        const text = scoped ? statements.map(unit => unit.getText(root)).join('\n') : control.getText(root);
        const fresh = typescript.isObjectLiteralExpression(argument);
        const { properties = [] } = argument;
        const spread = fresh && properties.some(property => typescript.isSpreadAssignment(property));
        const guarded = text.includes('agreements instanceof Set');
        const comments = typescript.getLeadingCommentRanges(source, control.getFullStart()) || [];
        const [directive = {}] = comments.filter(({ pos = 0, end = 0 } = {}) => source.slice(pos, end)
            .startsWith('// eslint-disable-next-line resilient/prefer-safe-transformations -- '));
        const { pos: directiveStart = false } = directive;
        assert.ok(Number.isInteger(directiveStart), `${file}: the exact publication has an adjacent reason.`);
        const { line = 0 } = root.getLineAndCharacterOfPosition(statement.getStart(root));

        return { file, source, text, fresh, spread, guarded, directive, line: line + 1 };
    });
});
assert.equal(units.length, 11);
assert.equal(units.filter(({ fresh = false } = {}) => fresh).length, 10);
assert.equal(units.filter(({ spread = false } = {}) => spread).length, 5);
assert.equal(units.filter(({ guarded = false } = {}) => guarded).length, 8);

// Actual source, with only these eleven comments blanked in memory. The rule
// reports every insertion: no loop allowance or configured ignored name applies.
const linter = new Linter();
files.forEach((file = '') => {
    const selected = units.filter(({ file: owner = '' } = {}) => owner === file);
    const [{ source = '' } = {}] = selected;
    const raw = selected.toReversed().reduce((code = '', { directive: { pos = 0, end = 0 } = {} } = {}) => (
        `${code.slice(0, pos)}${code.slice(pos, end).replace(/[^\r\n]/gu, ' ')}${code.slice(end)}`
    ), source);
    const messages = linter.verify(raw, { plugins: { resilient }, rules: { 'resilient/prefer-safe-transformations': 'error' } }, { filename: file });
    const findings = messages.filter(({ ruleId = '' } = {}) => ruleId === 'resilient/prefer-safe-transformations');
    assert.deepEqual(findings.map(({ line = 0 } = {}) => line), selected.map(({ line = 0 } = {}) => line), file);
    assert.ok(findings.every(({ messageId = '' } = {}) => messageId === 'mutation'));
});

const publicationProbe = ({ text = '', mode = 'normal', fresh = true, target = 'set', action = 'preserve' } = {}) => {
    let events = [];
    let values = [];
    const seed = {};
    const failure = new Error(mode);
    const record = {};
    const native = new Set([seed]);
    const other = target === 'proxy' ? new Proxy(native, {}) : {};
    const sink = target === 'set' ? native : other;
    const reentrantToken = {};
    const input = { get payload() {
        events = [...events, 'record'];

        if (mode === 'construction-failure') throw failure;

        return seed;
    } };
    const constructRange = () => {
        events = [...events, 'record'];

        if (mode === 'construction-failure') throw failure;

        return '1:2';
    };
    const method = mode === 'noncallable' ? 0 : function(value) {
        assert.equal(this, sink);
        events = [...events, 'Call.add'];
        values = [...values, value];

        // Native oracle: preserve the invocation receiver, including a
        // Proxy's native brand failure. Do not simulate Set membership.
        if (mode === 'reentrant') Reflect.apply(Set.prototype.add, this, [reentrantToken]);

        if (target !== 'duck') Reflect.apply(Set.prototype.add, this, [value]);

        if (mode === 'method-failure') throw failure;

        return false;
    };
    Object.defineProperty(sink, 'add', { get() {
        events = [...events, 'Get.add'];

        if (mode === 'getter-failure') throw failure;

        return method;
    } });
    const environment = {
        Set, agreements: sink, contract: input, agreement: input, capability: input,
        record, action, receiverName: 'receiver', alias: 'alias', evidence: [seed],
        getSourceRange: constructRange, declaration: {}, visited: {}, payloadProperty: 'payload',
        collectionProperty: 'collection', providerMember: 'member', recordedFactory: 'factory',
        providerType: 'type', providerReason: 'reason', reason: 'reason', canonical: 'undefined',
        argument: {}, arity: 2, typescript: {}, node: {}
    };
    const invoke = runInNewContext(`(() => { const publish = (owner, value) => owner.add(value); ${text}\n });`, environment);
    const execute = () => invoke();

    if (['getter-failure', 'construction-failure', 'method-failure'].includes(mode)) {
        assert.throws(execute, error => error === failure);
    }

    if (mode === 'noncallable' || target === 'proxy') assert.throws(execute, { name: 'TypeError' });

    if (!['getter-failure', 'construction-failure', 'method-failure', 'noncallable'].includes(mode) && target !== 'proxy') {
        execute();
        execute();
    }

    return { events, values, sink, native, record, seed, fresh, reentrantToken };
};
units.forEach(({ text = '', fresh = false, guarded = false } = {}) => {
    const normal = publicationProbe({ text, fresh });
    const { values = [], native = new Set(), seed = {}, record = {}, events: normalEvents = [] } = normal;
    const [first = {}, second = {}] = values;
    assert.deepEqual([...native], fresh ? [seed, first, second] : [seed, record]);
    assert.equal(first === second, !fresh, 'Fresh reports with equal metadata are distinct Set entries.');
    assert.deepEqual(normalEvents, fresh
        ? ['Get.add', 'record', 'Call.add', 'Get.add', 'record', 'Call.add']
        : ['Get.add', 'Call.add', 'Get.add', 'Call.add']);
    const copied = text.replace('agreements.add(', 'agreements = new Set([...agreements, ').replace(/\);$/u, ']);');
    const { native: copiedOwner = new Set(), seed: copiedSeed = {}, values: copiedValues = [] } = publicationProbe({ text: copied, fresh });
    assert.deepEqual([...copiedOwner], [copiedSeed], 'Copying at this actual insertion cannot publish to its supplied owner.');
    assert.deepEqual(copiedValues, [], 'Rebinding erases the supplied add protocol, not just its spelling.');
    const { events: getterEvents = [], native: getterNative = new Set() } = publicationProbe({ text, fresh, mode: 'getter-failure' });
    assert.deepEqual(getterEvents, ['Get.add']);
    assert.equal(getterNative.size, 1);
    const { native: methodNative = new Set() } = publicationProbe({ text, fresh, mode: 'method-failure' });
    assert.equal(methodNative.size, 2, 'Insertion followed by throw remains visible to the supplied Set owner.');
    const { events: noncallableEvents = [] } = publicationProbe({ text, fresh, mode: 'noncallable' });
    assert.deepEqual(noncallableEvents, fresh ? ['Get.add', 'record'] : ['Get.add']);
    const { native: proxyNative = new Set() } = publicationProbe({ text, fresh, target: 'proxy' });
    assert.equal(proxyNative.size, 1, 'instanceof does not erase native Set receiver-brand failure.');
    const { values: duckValues = [], events: duckEvents = [] } = publicationProbe({ text, fresh, target: 'duck' });
    assert.equal(duckValues.length, guarded ? 0 : 2);
    assert.deepEqual(duckEvents, guarded ? [] : ['Get.add', 'record', 'Call.add', 'Get.add', 'record', 'Call.add']);
    const { native: reentrantNative = new Set(), seed: reentrantSeed = {}, values: reentrantValues = [],
        record: reentrantRecord = {}, reentrantToken = {} } = publicationProbe({ text, fresh, mode: 'reentrant' });
    assert.deepEqual([...reentrantNative], fresh ? [reentrantSeed, reentrantToken, ...reentrantValues] : [reentrantSeed, reentrantToken, reentrantRecord]);
    [null, undefined, {}].forEach((agreements) => {
        const invoke = () => runInNewContext(`(() => { ${text}\n })();`, {
            Set, agreements, action: 'preserve', capability: '', payloadProperty: '', collectionProperty: '',
            evidence: [], reason: '', canonical: '', argument: {}, declaration: {}, visited: {},
            getSourceRange: () => '', providerMember: '', recordedFactory: '', providerType: '', providerReason: '',
            typescript: {}, node: {}
        });

        if (guarded) assert.doesNotThrow(invoke);

        if (!guarded) assert.throws(invoke, { name: 'TypeError' });
    });

    if (fresh) {
        const { events: constructionEvents = [], native: constructionNative = new Set() } = publicationProbe({ text, mode: 'construction-failure' });
        assert.deepEqual(constructionEvents, ['Get.add', 'record']);
        assert.equal(constructionNative.size, 1);
        const completedRecordHelper = text.replace('agreements.add(', 'publish(agreements, ');
        const { events: reorderedEvents = [] } = publicationProbe({ text: completedRecordHelper, mode: 'getter-failure' });
        assert.deepEqual(reorderedEvents, ['record', 'Get.add'], 'A completed-record helper violates native method-Get timing.');
    }
});
const [preserveUnit = {}] = units.filter(({ fresh = true } = {}) => !fresh);
['default', 'required', 'retain', ''].forEach((action = '') => {
    const { text = '' } = preserveUnit;
    const { events = [], native = new Set() } = publicationProbe({ text, fresh: false, action });
    assert.deepEqual(events, []);
    assert.equal(native.size, 1);
});

// The whole exported owner builds a fresh record BEFORE looking up add. Its
// final insertion unit alone accepts an already-built record: do not merge laws.
let bindingEvents = [];
const bindingReports = new Set();
Object.defineProperty(bindingReports, 'add', { get() {
    bindingEvents = [...bindingEvents, 'Get.add'];

    return function(value) {
        assert.equal(this, bindingReports);

        return Reflect.apply(Set.prototype.add, this, [value]);
    };
} });
const bindingInput = { state: 'required', get evidence() {
    bindingEvents = [...bindingEvents, 'record'];

    return ['required'];
} };
const firstBinding = emitBindingAgreement({ decision: getBindingDecision({ agreement: bindingInput }), agreements: bindingReports });
const secondBinding = emitBindingAgreement({ decision: getBindingDecision({ agreement: bindingInput }), agreements: bindingReports });
assert.deepEqual(bindingEvents, ['record', 'Get.add', 'record', 'Get.add']);
assert.notEqual(firstBinding.record, secondBinding.record);
assert.deepEqual([...bindingReports], [firstBinding.record, secondBinding.record]);
const bindingFailure = new Error('binding construction');
assert.throws(() => emitBindingAgreement({ agreements: bindingReports, decision: getBindingDecision({ agreement: { get evidence() { throw bindingFailure; } } }) }),
    error => error === bindingFailure);
assert.equal(bindingReports.size, 2);
assert.equal(bindingEvents.length, 4, 'Construction failure precedes the method Get in this owner.');
['known', 'required', 'unknown', 'contradictory'].forEach((state = '') => {
    const reports = new Set();
    const { record: result = {} } = emitBindingAgreement({ decision: getBindingDecision({ agreement: { state } }), agreements: reports });
    assert.deepEqual([...reports], state === 'known' ? [] : [result]);
});
[null, undefined, {}].forEach(agreements => assert.doesNotThrow(() => emitBindingAgreement({ agreements })));
const runBindingPublication = ({ reenter = false, failMethod = false, failGetter = false } = {}) => {
    let entered = false;
    let published = [];
    let events = [];
    const reports = new Set();
    const failure = new Error('binding publication');
    const agreement = { state: 'required', get evidence() {
        events = [...events, 'record'];

        return ['required'];
    } };
    const execute = () => emitBindingAgreement({ decision: getBindingDecision({ agreement }), agreements: reports });
    Object.defineProperty(reports, 'add', { get() {
        events = [...events, 'Get.add'];

        if (failGetter) throw failure;

        return function(value) {
            assert.equal(this, reports);

            if (reenter && !entered) {
                entered = true;
                execute();
            }

            Reflect.apply(Set.prototype.add, this, [value]);
            published = [...published, value];

            if (failMethod) throw failure;

            return false;
        };
    } });

    if (failMethod || failGetter) assert.throws(execute, error => error === failure);

    if (!failMethod && !failGetter) execute();

    return { reports, published, events };
};
const { reports: nestedBindingReports = new Set(), published: nestedBinding = [] } = runBindingPublication({ reenter: true });
assert.equal(nestedBindingReports.size, 2);
assert.deepEqual([...nestedBindingReports], nestedBinding);
const { reports: partialBindingReports = new Set() } = runBindingPublication({ failMethod: true });
assert.equal(partialBindingReports.size, 1);
const { reports: failedBindingReports = new Set(), events: failedBindingEvents = [] } = runBindingPublication({ failGetter: true });
assert.equal(failedBindingReports.size, 0);
assert.deepEqual(failedBindingEvents, ['record', 'Get.add']);

// Actual whole placement owners: completed facts are supplied, not re-inferred
// by spelling. Observe compiler work on both sides of the publication boundary.
const placementCases = [
    { lower: lowerExactCallbackProjections, kind: 'exact-callback-projection', action: 'exact-callback-projection',
        reported: 'exact-callback-projected', before: true },
    { lower: lowerProviderForwarding, kind: 'provider-forward', action: 'provider-forward', reported: 'provider-forwarded', before: true },
    { lower: lowerExactProviderForwarding, kind: 'exact-provider-forward', action: 'exact-provider-forward',
        reported: 'exact-provider-forwarded', before: false },
    { lower: lowerExactProviderForwarding, kind: 'exact-provider-forward', action: 'exact-provider-forward',
        reported: 'exact-provider-forwarded', before: false, code: 'const { value } = P;',
        targetKind: typescript.SyntaxKind.BindingElement }
];
placementCases.forEach(({ lower = missingFixture, kind = '', action = '', reported = '', before = false,
    code = 'const value = P.value;', targetKind = typescript.SyntaxKind.PropertyAccessExpression } = {}) => {
    assert.equal(typeof lower, 'function');
    const root = parse(code);
    const [member = {}] = nodesMatching({ root, accepts: ({ kind: nodeKind = 0 } = {}) => nodeKind === targetKind });
    const key = kind === 'provider-forward' ? getProviderForwardKey({ node: member }) : getConsumerContractKey(member);
    const contract = { action, receiver: 'P', member: 'value', canonical: 'undefined', evidence: ['supplied fact'] };
    const decisions = new Map([[key, [{ kind, contract }]]]);
    const runPlacementProbe = ({ failFactory = false, failAt = '', failPublication = false, failMethod = false, repeat = 1,
        reenter = false, map = decisions, inputRoot = root, missingFactory = false } = {}) => {
        let events = [];
        let entered = false;
        let published = [];
        const reports = new Set();
        const failure = new Error('placement phase');
        const factory = Object.fromEntries(Object.entries(typescript.factory).map(([name = '', operation = false] = []) => [
            name, typeof operation === 'function' ? (...args) => {
                events = [...events, 'factory', name];

                if (failFactory || failAt === name) throw failure;

                return Reflect.apply(operation, typescript.factory, args);
            } : operation
        ]));
        const execute = () => typescript.transform(inputRoot, [context => node => lower({
            typescript: { ...typescript, factory: missingFactory ? { ...factory, updateBindingElement: false } : factory },
            node, context, agreements: reports, destructuringAgreements: map instanceof Map ? compileDestructuringDecisions(map) : map
        })]);
        Object.defineProperty(reports, 'add', { get() {
            events = [...events, 'Get.add'];

            if (failPublication) throw failure;

            return function(value) {
                assert.equal(this, reports);

                if (reenter && !entered) {
                    entered = true;
                    const { dispose = () => {} } = execute();
                    dispose();
                }

                Reflect.apply(Set.prototype.add, this, [value]);
                published = [...published, value];

                if (failMethod) throw failure;

                return false;
            };
        } });

        if (failFactory || failAt || failPublication || failMethod) assert.throws(execute, error => error === failure);

        if (!failFactory && !failAt && !failPublication && !failMethod) Array.from({ length: repeat }).forEach(() => {
            const { dispose = () => {} } = execute();
            dispose();
        });

        return { events, reports, published };
    };
    const { events: normalEvents = [], reports: normalReports = new Set() } = runPlacementProbe();
    const [{ action: reportAction = '' } = {}] = normalReports;
    assert.equal(reportAction, reported);
    assert.equal(normalReports.size, 1);
    assert.equal(normalEvents.indexOf('factory') < normalEvents.indexOf('Get.add'), before);
    const factoryNames = [...new Set(normalEvents.filter((event = '') => !['factory', 'Get.add'].includes(event)))];
    factoryNames.forEach((name = '') => {
        const { reports: failedAtOperation = new Set() } = runPlacementProbe({ failAt: name });
        assert.equal(failedAtOperation.size, normalEvents.indexOf(name) < normalEvents.indexOf('Get.add') ? 0 : 1,
            `${code}: ${name} retains this publication phase.`);
    });
    const { reports: failedReports = new Set() } = runPlacementProbe({ failFactory: true });
    assert.equal(failedReports.size, before ? 0 : 1);
    const { events: failedEvents = [] } = runPlacementProbe({ failPublication: true });
    assert.equal(failedEvents.includes('factory'), before);
    const { events: rejectedEvents = [], reports: rejectedReports = new Set() } = runPlacementProbe({ map: new Map() });
    assert.deepEqual(rejectedEvents, []);
    assert.equal(rejectedReports.size, 0);
    const { events: wrongEvents = [] } = runPlacementProbe({ map: new Map([[key, [{ kind, contract: { ...contract, receiver: 'other' } }]]]) });
    const [firstWrongEvent = ''] = wrongEvents;

    if (targetKind === typescript.SyntaxKind.PropertyAccessExpression) assert.deepEqual(wrongEvents, []);

    if (targetKind === typescript.SyntaxKind.BindingElement) assert.equal(firstWrongEvent, 'Get.add',
        'Binding publication consumes the exact source fact, not a second receiver-name classifier.');

    const { reports: repeatedReports = new Set(), published: repeated = [] } = runPlacementProbe({ repeat: 2 });
    assert.equal(repeatedReports.size, 2);
    const [first = {}, second = {}] = repeated;
    assert.notEqual(first, second);
    assert.deepEqual([...repeatedReports], repeated);
    const { reports: nestedReports = new Set(), published: nested = [] } = runPlacementProbe({ reenter: true });
    assert.equal(nestedReports.size, 2);
    assert.deepEqual([...nestedReports], nested, 'Reentrant publication precedes the outer record without replacing its Set.');
    const { reports: partialReports = new Set() } = runPlacementProbe({ failMethod: true });
    assert.equal(partialReports.size, 1);

    if (kind !== 'exact-provider-forward') return;

    const { events: absentFactoryEvents = [] } = runPlacementProbe({ missingFactory: true });
    assert.deepEqual(absentFactoryEvents, [], 'Missing compiler update capability rejects before publication.');
    [null, new Map()].forEach((map) => {
        const { events = [] } = runPlacementProbe({ map });
        assert.deepEqual(events, []);
    });
    const directContracts = {
        'sort-capability': { action: 'guard-sort-capability' },
        'direct-capability': { action: 'guard-function-undefined', guard: 'function', receiver: 'P', member: 'value' },
        consumer: { action: 'guard', binding: { kind: 'function', required: true }, result: { canonical: '[]' } }
    };
    ['direct-capability', 'sort-capability', 'consumer'].forEach((directKind = '') => {
        const { [directKind]: directContract = {} } = directContracts;
        const map = new Map([[key, [{ kind, contract }, { kind: directKind, contract: directContract }]]]);
        const { events = [] } = runPlacementProbe({ map });
        assert.deepEqual(events, [], `${directKind}: prior callable Policy wins.`);
    });
    [{ action: 'retain' }, { canonical: '[]' }].forEach((change = {}) => {
        const map = new Map([[key, [{ kind, contract: { ...contract, ...change } }]]]);
        const { events = [] } = runPlacementProbe({ map });
        assert.deepEqual(events, [], 'An incompatible completed outcome cannot publish a forwarding report.');
    });
    const rejectedCode = targetKind === typescript.SyntaxKind.BindingElement
        ? 'const { value = 1 } = P;' : 'const value = P.other;';
    const rejectedRoot = parse(rejectedCode);
    const [rejectedNode = {}] = nodesMatching({ root: rejectedRoot, accepts: ({ kind: nodeKind = 0 } = {}) => nodeKind === targetKind });
    const rejectedMap = new Map([[getConsumerContractKey(rejectedNode), [{ kind, contract }]]]);
    const { events: rejectedShapeEvents = [] } = runPlacementProbe({ inputRoot: rejectedRoot, map: rejectedMap });
    assert.deepEqual(rejectedShapeEvents, [],
        'An existing binding initializer or mismatched property member rejects its otherwise exact fact.');
});

const originalOwner = new Set(['seed']);
const immutableReplacement = new Set([...originalOwner, {}]);
assert.deepEqual([...originalOwner], ['seed'], 'A new Set cannot publish to its supplied owner.');
assert.equal(immutableReplacement.size, 2);

const keyedDecision = ({ node = {}, kind = '', contract = {} } = {}) => new Map([
    [getConsumerContractKey(node), [{ kind, contract }]]
]);
const ownerCases = [
    ...[true, false].map(exact => ({
        code: 'function read([value]) { return [value]; }', reported: exact ? 'exact-tuple-position' : 'guarded-tuple',
        lower: lowerTupleConsumerBindings, input: 'node', before: 'updateArrayBindingPattern',
        after: exact ? 'updateFunctionDeclaration' : 'createParameterDeclaration',
        options: ({ owner = {} } = {}) => ({ destructuringAgreements: compileDestructuringDecisions(keyedDecision({ node: owner, kind: 'consumer', contract: {
            consumer: 'tuple-function', outcome: exact ? 'exact-position' : '',
            tuple: { required: true, arity: 1, containers: [{ arity: 1 }] },
            positions: [{ path: [0], invoked: false }], resolver: { state: 'resolved', action: 'direct', canonical: '[]' }
        } })) })
    })),
    { code: 'const read = (P, values) => values.toSorted(P.compare);', reported: 'guarded-sort-capability',
        lower: lowerSortCapabilityConsumer, input: 'node', before: 'createBlock', after: 'updateArrowFunction',
        options: ({ owner = {}, root = {} } = {}) => {
            const [call = {}] = nodesMatching({ root, accepts: node => typescript.isCallExpression(node) });

            return { destructuringAgreements: compileDestructuringDecisions(keyedDecision({ node: owner, kind: 'sort-capability', contract: {
                functionKey: getConsumerContractKey(owner), callKey: getConsumerContractKey(call), action: 'guard-sort-capability',
                grammarPlacement: 'expression', source: { provider: 'P', member: 'compare' }, evidence: ['completed sort fact']
            } })) };
        } },
    { code: 'function read(P) { return P.run(1); }', reported: 'guarded-direct-capability',
        lower: lowerDirectCapabilityConsumers, input: 'node', before: 'updateBlock', after: 'updateFunctionDeclaration',
        options: ({ owner = {}, root = {} } = {}) => {
            const [call = {}] = nodesMatching({ root, accepts: node => typescript.isCallExpression(node) });

            return { destructuringAgreements: compileDestructuringDecisions(keyedDecision({ node: owner, kind: 'direct-capability', contract: {
                functionKey: getConsumerContractKey(owner), callKey: getConsumerContractKey(call), action: 'guard-function-undefined',
                guard: 'function', receiver: 'P', member: 'run', evidence: ['completed direct fact']
            } })) };
        } },
    { code: 'function read() { const apply = make().run; return apply; }', reported: 'slang-required-function-provider-edge',
        lower: lowerFinalGrammar, input: 'sourceFile', before: 'updateVariableDeclaration', after: 'addSyntheticLeadingComment',
        options: ({ root = {} } = {}) => {
            const [declaration = {}] = nodesMatching({ root, accepts: node => typescript.isVariableDeclaration(node) });

            return { destructuringAgreements: compileDestructuringDecisions(keyedDecision({ node: declaration, kind: 'provider-edge', contract: {
                factory: 'make', member: 'run', typeText: '() => number',
                action: 'slang-required-function-provider-edge', evidence: ['required provider field']
            } })) };
        } },
    { code: 'function read() { const apply = P.run; return apply; }', reported: 'guarded-closed-provider-model',
        lower: lowerFinalGrammar, input: 'sourceFile', before: 'createObjectLiteralExpression', after: 'createIfStatement',
        options: ({ root = {} } = {}) => {
            const [declaration = {}] = nodesMatching({ root, accepts: node => typescript.isVariableDeclaration(node) });

            return { destructuringAgreements: compileDestructuringDecisions(keyedDecision({ node: declaration, kind: 'closed-provider-model', contract: {
                capability: 'apply', payload: { property: 'value', alias: 'input' }, collection: { property: 'items' },
                action: 'guarded-closed-provider-model', evidence: ['closed result consumer']
            } })) };
        } },
    { code: 'function read(P, consume) { return consume(P.run); }', reported: 'guarded-function',
        lower: lowerResidualMemberAccess, input: 'sourceFile', before: 'createStringLiteral', after: 'createIfStatement',
        options: ({ root = {} } = {}) => {
            const [member = {}] = nodesMatching({ root, accepts: node => typescript.isPropertyAccessExpression(node) });

            return { destructuringAgreements: compileDestructuringDecisions(keyedDecision({ node: member, kind: 'consumer', contract: {
                action: 'guard', binding: { kind: 'function', required: true }, result: { canonical: '[]' },
                evidence: ['callback consumer']
            } })) };
        } }
];
ownerCases.forEach(({ code = '', reported = '', lower = missingFixture, input = '', before = '', after = '', options = missingFixture } = {}) => {
    assert.equal(typeof lower, 'function');
    assert.equal(typeof options, 'function');
    const root = parse(code);
    const [owner = {}] = nodesMatching({ root, accepts: node => typescript.isFunctionDeclaration(node) || typescript.isArrowFunction(node) });
    const settings = options({ root, owner });
    const runOwnerProbe = ({ failAt = '', reject = false, repeat = 1, reenter = false, failMethod = false } = {}) => {
        let events = [];
        let entered = false;
        let published = [];
        const reports = new Set();
        const failure = new Error('owner phase');
        const observe = (name = '', operation = () => {}, receiver = {}) => (...args) => {
            events = [...events, name];

            if (failAt === name) throw failure;

            return Reflect.apply(operation, receiver, args);
        };
        const factory = Object.fromEntries(Object.entries(typescript.factory).map(([name = '', operation = false] = []) => [
            name, typeof operation === 'function' ? observe(name, operation, typescript.factory) : operation
        ]));
        const compiler = { ...typescript, factory,
            addSyntheticLeadingComment: observe('addSyntheticLeadingComment', typescript.addSyntheticLeadingComment, typescript) };
        const execute = () => typescript.transform(input === 'node' ? owner : root, [context => node => lower({
            ...settings, ...(reject ? { destructuringAgreements: compileDestructuringDecisions(new Map()) } : {}),
            typescript: compiler, context, agreements: reports, [input]: node
        })]);
        Object.defineProperty(reports, 'add', { get() {
            events = [...events, 'Get.add'];

            if (failAt === 'Get.add') throw failure;

            return function(value) {
                assert.equal(this, reports);

                if (reenter && !entered) {
                    entered = true;
                    const { dispose = () => {} } = execute();
                    dispose();
                }

                Reflect.apply(Set.prototype.add, this, [value]);
                published = [...published, value];

                if (failMethod) throw failure;

                return false;
            };
        } });

        if (failAt || failMethod) assert.throws(execute, error => error === failure, `${reported}: ${failAt}`);

        if (!failAt && !failMethod) Array.from({ length: repeat }).forEach(() => {
            const { dispose = () => {} } = execute();
            dispose();
        });

        return { events, reports, published };
    };
    const { reports = new Set(), events = [] } = runOwnerProbe();
    const [{ action: reportAction = '' } = {}] = reports;
    assert.equal(reportAction, reported);
    assert.equal(reports.size, 1, reported);
    assert.ok(events.indexOf(before) >= 0 && events.indexOf(before) < events.indexOf('Get.add'), `${reported}: before`);
    assert.ok(events.lastIndexOf(after) > events.indexOf('Get.add'), `${reported}: after`);
    const { reports: beforeReports = new Set() } = runOwnerProbe({ failAt: before });
    assert.equal(beforeReports.size, 0, `${reported}: compiler failure before publication`);
    const { reports: afterReports = new Set() } = runOwnerProbe({ failAt: after });
    assert.equal(afterReports.size, 1, `${reported}: compiler failure after publication`);
    const { events: failedEvents = [] } = runOwnerProbe({ failAt: 'Get.add' });
    assert.equal(failedEvents.includes(after), false, `${reported}: publication failure blocks later compiler work`);
    const { reports: rejectedReports = new Set() } = runOwnerProbe({ reject: true });
    assert.equal(rejectedReports.size, 0, `${reported}: no admitted fact means no report`);
    const { reports: repeatedReports = new Set(), published: repeated = [] } = runOwnerProbe({ repeat: 2 });
    const [first = {}, second = {}] = repeated;
    assert.equal(repeatedReports.size, 2, reported);
    assert.notEqual(first, second);
    assert.deepEqual([...repeatedReports], repeated);
    const { reports: nestedReports = new Set(), published: nested = [] } = runOwnerProbe({ reenter: true });
    assert.equal(nestedReports.size, 2, reported);
    assert.deepEqual([...nestedReports], nested);
    const { reports: partialReports = new Set() } = runOwnerProbe({ failMethod: true });
    assert.equal(partialReports.size, 1, reported);
});

// The local insertion proof above starts with completed facts. These paired
// public inputs instead pass through the real checker, collector, Policy and
// placement pipeline; a rejected neighbor must not publish the same report.
const sourceAdmissionCases = [
    { action: 'guarded-closed-provider-model', positive: [
        'type Tree<A> = { value: A; forest: ReadonlyArray<Tree<A>> };',
        'type Concat<B> = (a: ReadonlyArray<Tree<B>>, b: ReadonlyArray<Tree<B>>) => ReadonlyArray<Tree<B>>;',
        'const A = { getMonoid: <B>() => ({ concat: ((a: ReadonlyArray<Tree<B>>, b: ReadonlyArray<Tree<B>>) => [...a, ...b]) as Concat<B> }) };',
        'export const join = <I, O>(ma: Tree<I>, f: (value: I) => Tree<O>): Tree<O> => {',
        '  const { value, forest } = f(ma.value);',
        '  const concat = A.getMonoid<Tree<O>>().concat;',
        '  return { value, forest: concat(forest, ma.forest) };',
        '};'
    ], negative: [
        'const A = { getMonoid: () => ({ concat: (a: number, b: number) => a + b }) };',
        'export const read = () => A.getMonoid().concat(1, 2);'
    ] },
    { action: 'slang-required-function-provider-edge', positive: [
        'const getFunctorComposition = <A, B>(F: A, G: B) => ({ map: (value: string) => value });',
        'const map = getFunctorComposition({}, {}).map;',
        'export const make = () => ({ map });'
    ], negative: [
        'const getFunctorComposition = <A, B>(F: A, G: B) => ({ map: (value: string) => value });',
        'const map = getFunctorComposition({}, {}).map;',
        'export const use = () => map("value");'
    ] },
    { action: 'guarded-sort-capability', positive: [
        'type Ord = { compare: (left: number, right: number) => number };',
        'export const sort = (O: Ord) => (values: number[]) => values.slice().sort(O.compare);'
    ], negative: [
        'type Ord = { compare: (left: number, right: number) => number };',
        'export const use = (O: Ord, values: number[]) => values.map(O.compare);'
    ] },
    { action: 'guarded-direct-capability', positive: [
        'type Provider = { of: (value: string) => string };',
        'export const lift = (F: Provider, value: string) => F.of(value);'
    ], negative: [
        'type Provider = { of: (value: string) => string };',
        'export const lift = (F: Provider, value: string) => F["of"](value);'
    ] },
    { action: 'exact-callback-projected', positive: [
        'type Monoid<A> = { readonly empty: A };',
        'export const tuple = <A>(...monoids: ReadonlyArray<Monoid<A>>): ReadonlyArray<A> => monoids.map(m => m.empty);'
    ], negative: [
        'type Monoid<A> = { readonly empty: A };',
        'export const tuple = <A>(...monoids: ReadonlyArray<Monoid<A>>) => monoids.map(m => m.empty === m.empty);'
    ] },
    { action: 'exact-provider-forwarded', positive: [
        'interface Capability { compact: (value: unknown) => unknown; separate: (value: unknown) => unknown }',
        'type Functor = { map: (value: unknown, callback: unknown) => unknown };',
        'type Monoid<A> = { empty: A };',
        'export const compact = (F: Functor, G: Capability) => value => F.map(value, G.compact);',
        'export const getFilterable = (M: Monoid<string>, getCompactable: (value: Monoid<string>) => Capability) => {',
        '  const { compact, separate } = getCompactable(M);',
        '  return { compact, separate };',
        '};'
    ], negative: [
        'type Provider = { compact: (value: number) => number };',
        'export const invoke = (G: Provider, value: number) => G.compact(value);'
    ] },
    { action: 'provider-forwarded', positive: [
        'type Provider = { reduce: (value: string) => string; foldMap: (value: string) => string };',
        'export const forward = (FWI: Provider) => { return { reduce: FWI.reduce, foldMap: FWI.foldMap }; };'
    ], negative: [
        'type Provider = { reduce: (value: string) => string };',
        'export const invoke = (FWI: Provider) => FWI.reduce("value");'
    ] },
    { action: 'guarded-function', positive: [
        'export const getShow = (S: { show: (value: string) => string }) => ({',
        '  show: (values: readonly [string, ...string[]]) => `[${values.map(S.show).join(", ")}]`',
        '});'
    ], negative: [
        'export const show = (S: { show: (value: string) => string }, value: string) => S.show(value);'
    ] },
    { action: 'exact-tuple-position', positive: [
        'export const first = ([head]: [number | undefined]) => head;'
    ], negative: [
        'export const first = (pair: [number | undefined]) => pair[0];'
    ] },
    { action: 'guarded-tuple', positive: [
        'type Pair = [number, string];',
        'type Mapper = { map: <B>(value: unknown, callback: (pair: Pair) => B) => B };',
        'export const mapPair = (F: Mapper, value: unknown) => F.map(value, ([a, state]) => [a, state]);'
    ], negative: [
        'type Pair = [number, string];',
        'type Mapper = { map: <B>(value: unknown, callback: (pair: Pair) => B) => B };',
        'export const mapPair = (F: Mapper, value: unknown) => F.map(value, pair => pair);'
    ] },
    { action: 'preserve', positive: [
        'export const getShow = (S: { show: (value: string) => string }) => ({',
        '  show: (values: readonly [string, ...string[]]) => `[${values.map(S.show).join(", ")}]`',
        '});'
    ], negative: [
        'export const identity = (value: number) => value;'
    ] }
];
const emitterCatalog = JSON.parse(readFileSync(new URL('../docs/engineering/transformer-source-emitters.json', import.meta.url), 'utf8'));
const { syntheticCommentCalls: emitterSites = [] } = emitterCatalog;
let observedEmitterSites = new Set();
let admissionReportCounts = {};
let admissionEmitterSites = {};
const transformSourceAdmission = ({ code = [], name = '', collectDirect = false, collectSort = false,
    collectModel = false, collectEdge = false, collectConsumer = false, collectProjection = false } = {}) => {
    const fileName = `${name}.ts`;
    const source = code.join('\n');
    const parsed = typescript.createSourceFile(fileName, source, typescript.ScriptTarget.ESNext, true);
    const options = { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true };
    const host = typescript.createCompilerHost(options);
    const getSourceFile = (path = '', version = 0) => path === fileName ? parsed : host.getSourceFile(path, version);
    const program = typescript.createProgram([fileName], options, { ...host, getSourceFile });
    const checker = program.getTypeChecker();
    const directFacts = collectDirect ? collectDirectCapabilityContracts({ typescript, sourceFile: parsed, checker }) : new Map();
    const sortFacts = collectSort ? collectSortCapabilityContracts({ typescript, sourceFile: parsed, checker }) : new Map();
    const modelFacts = collectModel ? collectClosedProviderModelContracts({ typescript, sourceFile: parsed, checker }) : new Map();
    const edgeFacts = collectEdge ? collectProviderEdgeContracts({ typescript, sourceFile: parsed, checker }) : new Map();
    const consumerFacts = collectConsumer ? collectConsumerBindingContracts({ typescript, sourceFile: parsed, checker }) : new Map();
    const projectionFacts = collectProjection ? collectReceiverOrderedProjectionContracts({ typescript, sourceFile: parsed, checker }) : new Map();
    let emitted = new Set();
    const attach = (method = '', args = []) => {
        const stack = new Error().stack || '';
        const [site = ''] = stack.split('\n').filter(line => line.includes('/transforms/typescript/'));
        const match = /\/transforms\/typescript\/([^:]+):(\d+):\d+/u.exec(site) || [];
        const [, suffix = '', rawLine = '0'] = match;
        const file = `transforms/typescript/${suffix}`;
        const [record = {}] = emitterSites.filter(({ file: owner = '', line = 0 } = {}) => owner === file && line === Number(rawLine));
        const { id = 0, method: recordedMethod = '' } = record;
        const [node = {}, , comment = ''] = args;
        const operation = Reflect.get(typescript, method);
        const attached = Reflect.apply(operation, typescript, args);
        const comments = method === 'addSyntheticLeadingComment'
            ? typescript.getSyntheticLeadingComments(node) || [] : typescript.getSyntheticTrailingComments(node) || [];

        assert.ok(id, `${method}: source emitter must be in the parsed project catalog: ${site}`);
        assert.ok(recordedMethod.endsWith(method));
        assert.ok(/^ eslint-disable(?:-next-line|-line)? [\w/-]+(?:, [\w/-]+)* -- \S/u.test(comment) || /^eslint-enable(?: [\w/-]+(?:, [\w/-]+)*)?$/u.test(comment.trim()),
            `${method}: every observed disable names its rules and concrete reason.`);
        assert.ok(comments.some(({ text = '' } = {}) => text === comment), `${method}: exact rule/reason attaches to the passed node.`);

        if (comment.trim().startsWith('eslint-enable ')) {
            const names = comment.trim().slice('eslint-enable '.length);

            assert.ok((typescript.getSyntheticLeadingComments(node) || []).some(({ text = '' }) => (
                text.startsWith(` eslint-disable ${names} -- `)
            )), 'Named endpoints close exactly the rules opened on this owner.');
        }

        observedEmitterSites = new Set([...observedEmitterSites, id]);
        emitted = new Set([...emitted, id]);

        return attached;
    };
    const compiler = { ...typescript,
        addSyntheticLeadingComment: (...args) => attach('addSyntheticLeadingComment', args),
        addSyntheticTrailingComment: (...args) => attach('addSyntheticTrailingComment', args) };

    const result = createTypeScriptTransformer({ typescript: compiler, program, standard: {
        function: '../rules/support/function.js', array: '../rules/support/array.js'
    } }).transform({ code: source, fileName });

    return { ...result, directFacts, sortFacts, modelFacts, edgeFacts, consumerFacts, projectionFacts,
        emitterSites: [...emitted].toSorted((a, b) => a - b) };
};
sourceAdmissionCases.forEach(({ action = '', positive = [], negative = [] } = {}, index = 0) => {
    const admitted = transformSourceAdmission({ code: positive, name: `publication-admitted-${index}` });
    const rejected = transformSourceAdmission({ code: negative, name: `publication-rejected-${index}` });
    const { diagnostics: admittedDiagnostics = [] } = admitted;
    const { diagnostics: rejectedDiagnostics = [] } = rejected;
    const hasAction = ({ agreements = [] } = {}) => agreements.some(({ action: reported = '' } = {}) => reported === action);

    assert.deepEqual(admittedDiagnostics, [], `${action}: admitted source diagnostics`);
    assert.deepEqual(rejectedDiagnostics, [], `${action}: rejected source diagnostics`);
    assert.equal(hasAction(admitted), true, `${action}: checker-backed admission reaches the public report Set.`);
    assert.equal(hasAction(rejected), false, `${action}: rejected source shape cannot publish this report.`);
    const { agreements = [] } = admitted;
    const { emitterSites: admittedSites = [] } = admitted;
    admissionReportCounts = { ...admissionReportCounts,
        [action]: agreements.filter(({ action: reported = '' } = {}) => reported === action).length };
    admissionEmitterSites = { ...admissionEmitterSites, [action]: admittedSites };
});
const callbackConsumerCases = [
    { name: 'direct', read: 'values.map(S.show)', expected: 1 },
    { name: 'optional-receiver', read: 'values?.map(S.show)' },
    { name: 'optional-call', read: 'values.map?.(S.show)' },
    { name: 'optional-callback', read: 'values.map(S?.show)' },
    { name: 'computed-consumer', read: 'values["map"](S.show)', projection: 1 },
    { name: 'computed-callback', read: 'values.map(S["show"])', projection: 1 }
];
callbackConsumerCases.forEach(({ name = '', read = '', expected = 0, projection = 0 } = {}) => {
    const code = [
        'type Show = { show: (value: string) => string };',
        `export const getShow = (S: Show) => (values: readonly [string, ...string[]]) => \`[\${${read}.join(', ')}]\`;`
    ];
    const { consumerFacts = new Map(), projectionFacts = new Map(), agreements = [], diagnostics = [], code: lowered = '' }
        = transformSourceAdmission({
            code, name: `callback-consumer-${name}`, collectConsumer: true, collectProjection: true
        });
    const callbackFacts = [...consumerFacts.values()].filter(({ consumer = '' } = {}) => consumer === 'callback');
    const reports = agreements.filter(({ action = '' } = {}) => action === 'guarded-function');

    assert.deepEqual(diagnostics, [], name);
    assert.equal(callbackFacts.length, expected, `${name}: checker callback fact cardinality`);
    assert.equal(projectionFacts.size, projection, `${name}: source-ordered projection fact cardinality`);
    assert.equal(reports.length, expected, `${name}: public residual report cardinality`);

    if (expected) return;

    const observeOptionalCallback = (text = '') => {
        const { outputText = '' } = typescript.transpileModule(text, {
            compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ESNext }
        });

        return runInNewContext(`${outputText}\n(() => {
            const events = []; const failure = new Error('getter');
            const show = { get show() { events.push('show'); return value => value.toUpperCase(); } };
            const broken = { get show() { events.push('broken'); throw failure; } };
            const custom = { get map() { events.push('map'); return callback => { events.push('call'); return [callback('x')]; }; } };
            const invoke = (provider, values) => {
                try { return exports.getShow(provider)(values); }
                catch (error) { return error === failure ? 'getter identity' : error.name; }
            };
            return JSON.stringify({ results: [invoke(show, null), invoke(show, ['x']),
                invoke(broken, ['x']), invoke(null, ['x']), invoke(show, custom)], events });
        })()`, { exports: {} });
    };

    assert.equal(observeOptionalCallback(lowered), observeOptionalCallback(code.join('\n')),
        `${name}: optional short-circuit, Get/call timing and native failure remain source-owned`);
});
const callbackMethodCases = [
    { method: 'map', call: 'values.map(S.show)' },
    { method: 'filter', call: 'values.filter(S.show)' },
    { method: 'some', call: 'values.some(S.show)' },
    { method: 'find', call: 'values.find(S.show)' },
    { method: 'forEach', call: 'values.forEach(S.show)' },
    { method: 'reduce', call: 'values.reduce(S.show, "")' }
];
callbackMethodCases.forEach(({ method = '', call = '' } = {}) => {
    const { consumerFacts = new Map(), agreements = [], diagnostics = [] } = transformSourceAdmission({
        code: ['type Show = { show: (value: string) => string };',
            `export const read = (S: Show) => (values: string[]) => \`[\${${call}}]\`;`],
        name: `callback-method-${method}`, collectConsumer: true
    });
    const callbackFacts = [...consumerFacts.values()].filter(({ consumer = '' } = {}) => consumer === 'callback');
    const reports = agreements.filter(({ action = '' } = {}) => action === 'guarded-function');

    assert.deepEqual(diagnostics, [], method);
    assert.equal(callbackFacts.length, 1, `${method}: exact static collection callback fact`);
    assert.equal(reports.length, 1, `${method}: public residual callback report`);
});
const callbackRejectionCases = [
    { name: 'computed-method', valueType: 'string[]', call: 'values["map"](S.show)' },
    { name: 'optional-method', valueType: 'string[]', call: 'values.map?.(S.show)' },
    { name: 'callback-alias', valueType: 'string[]', call: 'values.map(show)',
        declaration: 'const show = S.show;' },
    { name: 'custom-collection', valueType: '{ map: (callback: (value: string) => string) => string[] }',
        call: 'values.map(S.show)' },
    { name: 'parenthesized-callback', valueType: 'string[]', call: 'values.map((S.show))' }
];
callbackRejectionCases.forEach(({ name = '', valueType = '', call = '', declaration = '' } = {}) => {
    const { consumerFacts = new Map(), agreements = [], diagnostics = [] } = transformSourceAdmission({
        code: ['type Show = { show: (value: string) => string };',
            `export const read = (S: Show) => (values: ${valueType}) => { ${declaration} return \`[\${${call}}]\`; };`],
        name: `callback-rejection-${name}`, collectConsumer: true
    });

    assert.deepEqual(diagnostics, [], name);
    assert.equal([...consumerFacts.values()].filter(({ consumer = '' } = {}) => consumer === 'callback').length, 0,
        `${name}: rejected source cannot borrow a callback fact`);
    assert.equal(agreements.filter(({ action = '' } = {}) => action === 'guarded-function').length, 0,
        `${name}: rejected source cannot publish a residual callback report`);
});
assert.equal(collectConsumerBindingContracts({ typescript, sourceFile: parse(
    'export const read = (values: string[], S: { show: (value: string) => string }) => values.map(S.show);'
), checker: {} }).size, 0, 'No checker publishes neither callback nor tuple source facts.');
const authoredTupleDefault = 'export const first = ([head = 7]: [number | undefined]) => head;';
const { consumerFacts: tupleDefaultFacts = new Map(), agreements: tupleDefaultReports = [],
    code: loweredTupleDefault = '' } = transformSourceAdmission({
    code: [authoredTupleDefault], name: 'tuple-authored-default', collectConsumer: true
});
const [tupleDefaultFact = {}] = [...tupleDefaultFacts.values()];
const { action: tupleDefaultOutcome = '' } = getDestructuringAgreement({ entry: { kind: 'consumer', contract: tupleDefaultFact } });
const observeTupleDefault = (source = '') => {
    const { outputText = '' } = typescript.transpileModule(source, {
        compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ESNext }
    });

    return runInNewContext(`${outputText}\n(() => {
        const call = value => { try { return exports.first(value); } catch (error) { return error.name; } };
        return JSON.stringify([call([]), call([undefined]), call([0]), call(null)]);
    })()`, { exports: {} });
};
assert.notEqual(tupleDefaultOutcome, 'exact-tuple-position', 'An authored element default owns absence.');
assert.equal(tupleDefaultReports.filter(({ action = '' } = {}) => action === 'exact-tuple-position').length, 0);
assert.equal(observeTupleDefault(loweredTupleDefault), observeTupleDefault(authoredTupleDefault),
    'An authored tuple default and native container failure survive lowering.');
const exactTupleAdmissionCases = [
    { name: 'flat-one', source: 'export const read = ([first]: [number | undefined]) => first;', expected: 1 },
    { name: 'flat-two', source: 'export const read = ([first, second]: [number | undefined, string | undefined]) => first;', expected: 1 },
    { name: 'readonly', source: 'export const read = ([first]: readonly [number | undefined]) => first;', expected: 1 },
    { name: 'authored-default', source: authoredTupleDefault },
    { name: 'rest-position', source: 'export const read = ([first, ...rest]: [number, ...number[]]) => first;' },
    { name: 'nested-position', source: 'export const read = ([[first]]: [[number]]) => first;' },
    { name: 'array-not-tuple', source: 'export const read = ([first]: number[]) => first;' },
    { name: 'invoked-position', source: 'export const read = ([first]: [(value: number) => number]) => first(1);' }
];
exactTupleAdmissionCases.forEach(({ name = '', source = '', expected = 0 } = {}) => {
    const { consumerFacts = new Map(), agreements = [], diagnostics = [] } = transformSourceAdmission({
        code: [source], name: `exact-tuple-domain-${name}`, collectConsumer: true
    });
    const exactDecisions = [...consumerFacts.values()]
        .map(contract => getDestructuringAgreement({ entry: { kind: 'consumer', contract } }))
        .filter(({ action = '' } = {}) => action === 'exact-tuple-position');
    const exactReports = agreements.filter(({ action = '' } = {}) => action === 'exact-tuple-position');

    assert.deepEqual(diagnostics, [], name);
    assert.equal(exactDecisions.length, expected, `${name}: Policy chooses exact positions from checker-owned tuple facts`);
    assert.equal(exactReports.length, expected, `${name}: exact tuple public report`);
});
const authoredTupleNode = parse('const read = ([head = 7]) => head;');
const [authoredTupleOwner = {}] = nodesMatching({ root: authoredTupleNode, accepts: node => typescript.isArrowFunction(node) });
const authoredTupleDecisions = keyedDecision({ node: authoredTupleOwner, kind: 'consumer', contract: {
    consumer: 'tuple-function', outcome: 'exact-position',
    tuple: { required: true, arity: 1, containers: [{ arity: 1 }] },
    positions: [{ path: [0], invoked: false }], resolver: { state: 'resolved', action: 'direct', canonical: '[]' }
} });
const authoredTupleReports = new Set();
const { transformed: [authoredTupleResult = {}] = [], dispose: releaseAuthoredTuple = () => {} } = typescript.transform(
    authoredTupleOwner, [() => node => lowerTupleConsumerBindings({
        typescript, node, destructuringAgreements: compileDestructuringDecisions(authoredTupleDecisions), agreements: authoredTupleReports
    })]
);
assert.equal(authoredTupleResult, authoredTupleOwner, 'Placement refuses even a stale exact fact over an authored initializer.');
assert.equal(authoredTupleReports.size, 0);
releaseAuthoredTuple();
const tupleCallbackPrefix = [
    'type Pair = [number | undefined, string];',
    'type Mapper = { map: <B>(value: unknown, callback: (pair: Pair) => B) => B };'
];
const guardedTupleAdmissionCases = [
    { name: 'direct', source: 'export const read = (F: Mapper, value: unknown) => F.map(value, ([a, state]) => [a, state]);', expected: 1 },
    { name: 'authored-default', source: 'export const read = (F: Mapper, value: unknown) => F.map(value, ([a = 7, state]) => [a, state]);', expected: 1 },
    { name: 'non-tuple-parameter', source: 'export const read = (F: Mapper, value: unknown) => F.map(value, pair => pair);' },
    { name: 'unrelated-array-map', source: 'export const read = (value: number[]) => value.map(([a, state]) => [a, state]);' }
];
guardedTupleAdmissionCases.forEach(({ name = '', source = '', expected = 0 } = {}) => {
    const { consumerFacts = new Map(), agreements = [], diagnostics = [], code: lowered = '' } = transformSourceAdmission({
        code: [...tupleCallbackPrefix, source], name: `guarded-tuple-domain-${name}`, collectConsumer: true
    });
    const tupleFacts = [...consumerFacts.values()].filter(({ consumer = '' } = {}) => consumer === 'tuple-callback');
    const reports = agreements.filter(({ action = '' } = {}) => action === 'guarded-tuple');

    assert.deepEqual(diagnostics, [], name);
    assert.equal(tupleFacts.length, expected, `${name}: checker tuple callback fact`);
    assert.equal(reports.length, expected, `${name}: public guarded tuple report`);

    if (name !== 'authored-default') return;

    assert.match(lowered, /a\s*=\s*7/u, 'A guarded tuple callback retains its authored element default.');
    const observeGuardedTuple = (text = '') => {
        const inlineArrayCheck = text.replace(
            "import { isArray } from '../rules/support/array.js';", 'const isArray = Array.isArray;'
        );
        const { outputText = '' } = typescript.transpileModule(inlineArrayCheck, {
            compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ESNext }
        });

        return runInNewContext(`${outputText}\n(() => {
            const F = { map: (value, callback) => callback(value) };
            return JSON.stringify([exports.read(F, [undefined, 'x']), exports.read(F, [0, 'x'])]);
        })()`, { exports: {} });
    };

    assert.equal(observeGuardedTuple(lowered), observeGuardedTuple([...tupleCallbackPrefix, source].join('\n')),
        'Guarded tuple valid-input behavior retains the authored default and present value.');
});
const finalBindingAdmissionCases = [
    { name: 'required-static-function', source: 'export const read = (P: { run: () => number }) => { const run = P.run; return run; };' },
    { name: 'required-static-value', source: 'export const read = (P: { value: number }) => { const value = P.value; return value; };' },
    { name: 'optional-static-value', source: 'export const read = (P: { value?: number }) => { const value = P.value; return value; };',
        expected: 1, site: 'final-object-binding', state: 'caller-owned' },
    { name: 'array-source-rewritten-object', source: 'export const read = (input: unknown[]) => { const [value] = input; return value; };',
        expected: 1, site: 'final-object-binding', state: 'caller-owned' },
    { name: 'generic-iterator-payload', source: [
        'type Eq<K> = { equals: (left: K, right: K) => boolean };',
        'type Next<A> = IteratorResult<A, undefined>;',
        'export const read = <K, A>(E: Eq<K>, k: K, m: Map<K, A>) => {',
        '  const entries = m.entries();',
        '  let e: Next<[K, A]>;',
        '  while (!(e = entries.next()).done) {',
        '    const [ka, a] = e.value;',
        '    if (E.equals(ka, k)) return [ka, a];',
        '  }',
        '  return [];',
        '};'
    ].join('\n'), expected: 1, site: 'final-object-binding', state: 'caller-owned' },
    { name: 'union-tuple-payload', source: [
        'type Payload<A> = { value: [string, A] } | { value: [string, A, number] };',
        'export const read = <A>(e: Payload<A>) => {',
        '  const [key, value] = e.value;',
        '  return [key, value];',
        '};'
    ].join('\n'), expected: 1, site: 'final-object-binding', state: 'guarded' },
    { name: 'array-parameter-carrier', source: [
        'export function read(first: Function, second?: Function) {',
        '  switch (arguments.length) {',
        '    case 2: return second(first);',
        '    default: return first;',
        '  }',
        '}'
    ].join('\n') },
    { name: 'opaque-static-value', source: 'export const read = (P: any) => { const value = P.value; return value; };' },
    { name: 'authored-default', source: 'export const read = (P: { value?: number }) => { const { value = 7 } = P; return value; };' }
];
finalBindingAdmissionCases.forEach(({ name = '', source = '', expected = 0, site = '', state = '' } = {}) => {
    const { agreements = [], diagnostics = [], code: lowered = '' } = transformSourceAdmission({
        code: [source], name: `final-binding-domain-${name}`
    });
    const reports = agreements.filter(({ action = '' } = {}) => action === 'preserve');

    assert.deepEqual(diagnostics, [], name);
    assert.equal(reports.length, expected, `${name}: only source-owned preservation publishes`);
    reports.forEach(({ site: reportSite = '', state: reportState = '' } = {}) => {
        assert.equal(reportSite, site, `${name}: exact placement owner`);
        assert.equal(reportState, state, `${name}: source agreement state`);
    });

    if (name === 'union-tuple-payload') {
        const observeUnionPayload = (text = '') => {
            const { outputText = '' } = typescript.transpileModule(text, {
                compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ESNext }
            });

            return runInNewContext(`${outputText}\n(() => {
                const events = []; const failure = new Error('value getter');
                const getter = { get value() { events.push('Get.value'); return ['x', 3]; } };
                const broken = { get value() { events.push('Throw.value'); throw failure; } };
                const call = input => { try { return exports.read(input); }
                    catch (error) { return error === failure ? 'getter identity' : error.name; } };
                return JSON.stringify({ values: [call({ value: ['x', 1] }),
                    call({ value: ['x', 2, 3] }), call({ value: [undefined, undefined] }),
                    call(getter), call(broken), call(null), call({ value: undefined })], events });
            })()`, { exports: {} });
        };

        assert.equal(observeUnionPayload(lowered), observeUnionPayload(source),
            'Guarded-object preservation retains tuple values, one getter Get, and native failure identity.');

        return;
    }

    if (name !== 'array-parameter-carrier') return;

    assert.match(lowered, /export function read\(first, second\)/u,
        'The exported source signature retains observable arity.');
    assert.doesNotMatch(lowered, /_resilientArgs|Object\.defineProperty\(read/u);
    const observeCarrier = (text = '') => {
        const { outputText = '' } = typescript.transpileModule(text, {
            compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ESNext }
        });

        return runInNewContext(`${outputText}\n(() => {
            const first = () => 3;
            const call = (...args) => { try { return exports.read(...args); } catch (error) { return error.name; } };
            return JSON.stringify([call(first), call(first, value => value()), call(first, undefined)]);
        })()`, { exports: {} });
    };

    assert.equal(observeCarrier(lowered), observeCarrier(source),
        'Arity-carrier publication preserves the selected result and native missing-callback failure.');
});
const providerEdgeSource = [
    'const make = () => ({ map: (value: string) => value });',
    'export const forward = () => { const map = make().map; return { map }; };'
];
const [{ positive: closedModelSource = [] } = {}] = sourceAdmissionCases;
const optionalProviderAdmissions = [
    { name: 'edge-member', action: 'slang-required-function-provider-edge',
        code: providerEdgeSource.map(line => line.replace('make().map', 'make()?.map')) },
    { name: 'edge-call', action: 'slang-required-function-provider-edge',
        code: providerEdgeSource.map(line => line.replace('make().map', 'make?.().map')) },
    { name: 'model-member', action: 'guarded-closed-provider-model',
        code: closedModelSource.map(line => line.replace('getMonoid<Tree<O>>().concat', 'getMonoid<Tree<O>>()?.concat')) },
    { name: 'model-call', action: 'guarded-closed-provider-model',
        code: closedModelSource.map(line => line.replace('getMonoid<Tree<O>>().concat', 'getMonoid?.<Tree<O>>().concat')) }
];
optionalProviderAdmissions.forEach(({ name = '', action = '', code = [] } = {}) => {
    const { diagnostics = [], agreements = [], code: lowered = '' } = transformSourceAdmission({
        code, name: `provider-optional-${name}`
    });

    assert.deepEqual(diagnostics, [], name);
    assert.equal(agreements.filter(({ action: reported = '' } = {}) => reported === action).length, 0,
        `${name}: optional receiver/member evaluation cannot acquire an ordinary provider report`);
    assert.match(lowered, /\?\./u, `${name}: optional short-circuit syntax remains owned by its source expression`);
});
const closedModelReturnCases = [
    { name: 'source-capability-call', returnText: 'return { value, forest: concat(forest, ma.forest) };', expected: 1 },
    { name: 'unused-capability', returnText: 'return { value, forest: [] };' },
    { name: 'other-callee', returnText: 'return { value, forest: other(forest) };' },
    { name: 'unrelated-array', returnText: 'return { value, forest: concat(ma.forest, ma.forest) };' },
    { name: 'extra-return-field', returnText: 'return { value, forest: concat(forest, ma.forest), extra: 1 };' },
    { name: 'duplicate-array-field', returnText: 'return { value, forest: concat(forest, ma.forest), forest: [] };' }
];
closedModelReturnCases.forEach(({ name = '', returnText = '', expected = 0 } = {}) => {
    const code = closedModelSource.map(line => line.replace(
        'return { value, forest: concat(forest, ma.forest) };', returnText
    ));
    const { modelFacts = new Map(), agreements = [], diagnostics = [] } = transformSourceAdmission({
        code, name: `closed-model-return-${name}`, collectModel: true
    });

    assert.deepEqual(diagnostics, [], name);
    assert.equal(modelFacts.size, expected, `${name}: source return must own the guarded capability and array`);
    assert.equal(agreements.filter(({ action = '' } = {}) => action === 'guarded-closed-provider-model').length,
        expected, `${name}: public report follows the exact source fact`);
});
const aliasedModelSource = closedModelSource.map(line => line
    .replace('const { value, forest } =', 'const { value, forest: trees } =')
    .replace('concat(forest, ma.forest)', 'concat(trees, ma.forest)'));
const { modelFacts: aliasedModelFacts = new Map(), agreements: aliasedModelReports = [] } = transformSourceAdmission({
    code: aliasedModelSource, name: 'closed-model-aliased-array', collectModel: true
});
assert.equal(aliasedModelFacts.size, 1, 'The recorded array alias, not its spelling, owns the admitted result call.');
assert.equal(aliasedModelReports.filter(({ action = '' } = {}) => action === 'guarded-closed-provider-model').length, 1);
const { modelFacts: modelNeighborFacts = new Map(), agreements: modelNeighborAgreements = [] } = transformSourceAdmission({
    code: [...closedModelSource,
        'export const unrelated = <A>(ma: { value: A; forest: A[] }) => {',
        '  const { value, forest } = ma;',
        '  const concat = (() => ({ concat: (a: A[], b: A[]) => [...a, ...b] }))().concat;',
        '  return { value, forest: [] };',
        '};'],
    name: 'closed-model-same-spelled-neighbor', collectModel: true
});
assert.equal(modelNeighborFacts.size, 1, 'An unrelated same-spelled return cannot acquire the closed-model fact.');
assert.equal(modelNeighborAgreements.filter(({ action = '' } = {}) => action === 'guarded-closed-provider-model').length, 1);
assert.equal(collectClosedProviderModelContracts({ typescript, sourceFile: parse(closedModelSource.join('\n')),
    checker: {} }).size, 0, 'No checker means no closed-model source fact.');
const providerEdgeCases = [
    { name: 'returned-field', declaration: 'const map = make().map;', use: 'return { map };', expected: 1 },
    { name: 'unused-field', declaration: 'const map = make().map;', use: 'return 1;', expected: 1 },
    { name: 'called-field', declaration: 'const map = make().map;', use: 'return map("value");' },
    { name: 'computed-field', declaration: 'const map = make()["map"];', use: 'return { map };' },
    { name: 'mutable-binding', declaration: 'let map = make().map;', use: 'return { map };' },
    { name: 'optional-field', declaration: 'const map = make()?.map;', use: 'return { map };' },
    { name: 'optional-call', declaration: 'const map = make?.().map;', use: 'return { map };' },
    { name: 'direct-object', declaration: 'const map = { map: (value: string) => value }.map;', use: 'return { map };' }
];
providerEdgeCases.forEach(({ name = '', declaration = '', use = '', expected = 0 } = {}) => {
    const code = ['const make = () => ({ map: (value: string) => value });',
        `export const forward = () => { ${declaration} ${use} };`];
    const { edgeFacts = new Map(), agreements = [], diagnostics = [] } = transformSourceAdmission({
        code, name: `provider-edge-domain-${name}`, collectEdge: true
    });

    assert.deepEqual(diagnostics, [], name);
    assert.equal(edgeFacts.size, expected, `${name}: checker-owned provider-edge source fact`);
    assert.equal(agreements.filter(({ action = '' } = {}) => action === 'slang-required-function-provider-edge').length,
        expected, `${name}: public report follows the exact source fact`);
});
assert.equal(collectProviderEdgeContracts({ typescript, sourceFile: parse(providerEdgeSource.join('\n')),
    checker: {} }).size, 0, 'No checker means no provider-edge source fact.');
const rejectedModelSource = [
    'type Tree<A> = { value: A; forest: ReadonlyArray<Tree<A>> };',
    'const A = { getMonoid: <B>() => ({ concat: false as unknown as (a: ReadonlyArray<Tree<B>>, b: ReadonlyArray<Tree<B>>) => ReadonlyArray<Tree<B>> }) };',
    'export const join = <I, O>(ma: Tree<I>, f: (value: I) => Tree<O>) => {',
    '  const { value, forest } = f(ma.value);',
    '  const concat = A.getMonoid<Tree<O>>().concat;',
    '  return { value, forest: other(forest) };',
    '};'
];
const { modelFacts: rejectedModelFacts = new Map(), agreements: rejectedModelReports = [],
    code: rejectedModelOutput = '' } = transformSourceAdmission({
    code: rejectedModelSource, name: 'closed-model-native-other-failure', collectModel: true
});
const observeRejectedModel = (source = '') => {
    const { outputText = '' } = typescript.transpileModule(source, {
        compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ESNext }
    });

    return runInNewContext(`${outputText}\n(() => {
        try { exports.join({ value: 1, forest: [] }, value => ({ value, forest: [] })); return 'returned'; }
        catch (error) { return error.name; }
    })()`, { exports: {} });
};
assert.equal(rejectedModelFacts.size, 0);
assert.equal(rejectedModelReports.filter(({ action = '' } = {}) => action === 'guarded-closed-provider-model').length, 0);
assert.equal(observeRejectedModel(rejectedModelOutput), observeRejectedModel(rejectedModelSource.join('\n')),
    'An unrelated result call keeps its source ReferenceError rather than acquiring the closed-model fallback.');
['make()?.map', 'make?.().map'].forEach((read, index) => {
    const source = `export const forward = (make: (() => { map: unknown }) | undefined) => { const map = ${read}; return { map }; };`;
    const { code: lowered = '', agreements = [] } = transformSourceAdmission({
        code: [source], name: `provider-optional-runtime-${index}`
    });
    const observeOptionalEdge = (code = '') => {
        const { outputText = '' } = typescript.transpileModule(code, {
            compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ESNext }
        });
        const probe = `${outputText}\n(() => {
            const events = []; const token = {}; const failure = new Error('getter');
            const get = () => { events.push('call'); return { get map() { events.push('get'); return token; } }; };
            const absent = () => { events.push('absent'); return null; };
            const broken = () => { events.push('broken'); return { get map() { events.push('get'); throw failure; } }; };
            const invoke = make => { try { return exports.forward(make).map === token ? 'token' : 'undefined'; }
                catch (error) { return error === failure ? 'getter identity' : error.name; } };
            return JSON.stringify({ values: [invoke(get), invoke(absent), invoke(undefined), invoke(broken)], events });
        })()`;

        return runInNewContext(probe, { exports: {} });
    };

    assert.equal(agreements.filter(({ action = '' } = {}) => action === 'slang-required-function-provider-edge').length, 0);
    assert.equal(observeOptionalEdge(lowered), observeOptionalEdge(source),
        `${read}: null, getter, skipped call and failure phase`);
});
const directAdmissionCases = [
    { name: 'block-return', code: [
        'type Provider = { of: (value: string) => string };',
        'export function lift(F: Provider, value: string) { return F.of(value); }'
    ], expected: 1 },
    { name: 'expression-statement', code: [
        'type Provider = { of: (value: string) => string };',
        'export function lift(F: Provider, value: string) { F.of(value); }'
    ], expected: 1 },
    { name: 'computed', code: [
        'type Provider = { of: (value: string) => string };',
        'export const lift = (F: Provider, value: string) => F["of"](value);'
    ], expected: 0 },
    { name: 'optional-field', code: [
        'type Provider = { of?: (value: string) => string };',
        'export const lift = (F: Provider, value: string) => F.of(value);'
    ], expected: 0 },
    { name: 'receiver-parameter', code: [
        'type Provider = { of: (this: Provider, value: string) => string };',
        'export const lift = (F: Provider, value: string) => F.of(value);'
    ], expected: 0 },
    { name: 'effectful-argument', code: [
        'type Provider = { of: (value: string) => string };',
        'export const lift = (F: Provider, make: () => string) => F.of(make());'
    ], expected: 0 },
    { name: 'spread-argument', code: [
        'type Provider = { of: (value: string) => string };',
        'export const lift = (F: Provider, values: [string]) => F.of(...values);'
    ], expected: 0 },
    { name: 'nested-call', code: [
        'type Provider = { of: (value: string) => string };',
        'export const lift = (F: Provider, value: string) => String(F.of(value));'
    ], expected: 0 },
    { name: 'method-signature', code: [
        'type Provider = { of(value: string): string };',
        'export const lift = (F: Provider, value: string) => F.of(value);'
    ], expected: 0 },
    { name: 'untyped-provider', code: [
        'export const lift = (F, value: string) => F.of(value);'
    ], expected: 0 },
    { name: 'array-provider', code: [
        'type Provider = string[] & { of: (value: string) => string };',
        'export const lift = (F: Provider, value: string) => F.of(value);'
    ], expected: 0 },
    { name: 'tuple-provider', code: [
        'type Provider = [string] & { of: (value: string) => string };',
        'export const lift = (F: Provider, value: string) => F.of(value);'
    ], expected: 0 },
    { name: 'conditional-statement', code: [
        'type Provider = { of: (value: string) => string };',
        'export function lift(F: Provider, value: string, enabled: boolean) { if (enabled) F.of(value); }'
    ], expected: 0 },
    { name: 'parenthesized-call', code: [
        'type Provider = { of: (value: string) => string };',
        'export const lift = (F: Provider, value: string) => (F.of(value));'
    ], expected: 0 },
    { name: 'nested-function', code: [
        'type Provider = { of: (value: string) => string };',
        'export const lift = (F: Provider, value: string) => () => F.of(value);'
    ], expected: 0 },
    { name: 'two-consumers', code: [
        'type Provider = { of: (value: string) => string };',
        'export function lift(F: Provider, value: string) { F.of(value); return F.of(value); }'
    ], expected: 0 },
    { name: 'optional-chain', code: [
        'type Provider = { of: (value: string) => string };',
        'export const lift = (F: Provider, value: string) => F?.of(value);'
    ], expected: 0 },
    { name: 'optional-call', code: [
        'type Provider = { of: (value: string) => string };',
        'export const lift = (F: Provider, value: string) => F.of?.(value);'
    ], expected: 0 }
];
directAdmissionCases.forEach(({ name = '', code = [], expected = 0 } = {}) => {
    const result = transformSourceAdmission({ code, name: `direct-domain-${name}`, collectDirect: true });
    const { agreements = [], diagnostics = [], directFacts = new Map() } = result;
    const reported = agreements.filter(({ action = '' } = {}) => action === 'guarded-direct-capability');

    assert.deepEqual(diagnostics, [], `${name}: transformer diagnostics`);
    assert.equal(directFacts.size, expected, `${name}: checker source fact cardinality`);
    assert.equal(reported.length, expected, `${name}: complete direct-capability admission`);
});
assert.equal(collectDirectCapabilityContracts({ typescript, sourceFile: parse(
    'function lift(F: { of: (value: string) => string }, value: string) { return F.of(value); }'
), checker: {} }).size, 0, 'An absent checker cannot publish a direct capability fact.');
await Promise.all(directAdmissionCases.filter(({ name = '' } = {}) => ['optional-chain', 'optional-call'].includes(name))
    .map(async ({ name = '', code = [] } = {}) => {
        const source = code.join('\n');
        const { code: lowered = '' } = transformSourceAdmission({ code, name: `direct-runtime-${name}` });
        const observeOptionalCapability = (text = '') => {
            const { outputText = '' } = typescript.transpileModule(text, {
                compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ESNext }
            });
            const lift = runInNewContext(`${outputText}\nexports.lift`, { exports: {} });
            let reads = 0;
            const failure = new Error('getter failure');
            const provider = { get of() {
                reads += 1;

                return value => `${value}!`;
            } };
            const broken = { get of() { throw failure; } };
            const invokeOptionalCapability = (target) => {
                try {
                    return { value: lift(target, 'ok') };
                } catch (error) {
                    return { failure: error === failure ? 'getter identity' : error.name };
                }
            };
            const result = [invokeOptionalCapability(null), invokeOptionalCapability(undefined),
                invokeOptionalCapability({}), invokeOptionalCapability(provider), invokeOptionalCapability(broken)];

            return { result, reads };
        };

        const lintConfig = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
        const [raw = {}] = await new ESLint({ overrideConfigFile: true, overrideConfig: lintConfig }).lintText(lowered, {
            filePath: `${name}-generated.js`
        });
        const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true, overrideConfig: lintConfig }).lintText(lowered, {
            filePath: `${name}-generated.js`
        });
        const { output: fixedCode = lowered } = fixed;
        const { messages: rawMessages = [], errorCount: rawErrors = 0 } = raw;
        const { messages: fixedMessages = [], errorCount: fixedErrors = 0 } = fixed;
        const expected = observeOptionalCapability(source);

        assert.deepEqual(observeOptionalCapability(lowered), expected, `${name}: optional access, receiver and getter failure remain native.`);
        assert.deepEqual(rawMessages.map(({ ruleId = '' } = {}) => ruleId), ['no-restricted-syntax'],
            `${name}: the rejected source keeps its explicit dialect diagnostic.`);
        assert.equal(fixedErrors, rawErrors, JSON.stringify(fixedMessages));
        assert.equal(fixedCode, lowered, `${name}: no autofix may erase optional receiver/call timing.`);
        assert.deepEqual(observeOptionalCapability(fixedCode), expected, `${name}: fixed output preserves optional behavior.`);
    }));
const ordType = 'type Ord = { compare: (left: number, right: number) => number };';
const sortAdmissionCases = [
    { name: 'block-return', code: [ordType,
        'export function sort(O: Ord, values: number[]) { return values.slice().sort(O.compare); }'], expected: 1 },
    { name: 'conditional-true', code: [ordType,
        'export const sort = (O: Ord, values: number[]) => values.length ? values.slice().sort(O.compare) : [];'], expected: 1 },
    { name: 'conditional-false', code: [ordType,
        'export const sort = (O: Ord, values: number[]) => values.length ? [] : values.slice().sort(O.compare);'], expected: 1 },
    { name: 'to-sorted', code: [ordType,
        'export const sort = (O: Ord, values: number[]) => values.toSorted(O.compare);'], expected: 1 },
    { name: 'reduce-nonempty', code: [
        'type Semigroup = { concat: (left: number, right: number) => number };',
        'type NonEmpty = [number, ...number[]];',
        'export const fold = (S: Semigroup, values: NonEmpty) => values.reduce(S.concat);'
    ], expected: 1 },
    { name: 'bound-alias', code: [ordType,
        'export const sort = ({ compare }: Ord, values: number[]) => values.slice().sort(compare);'], expected: 1 },
    { name: 'map-consumer', code: [ordType,
        'export const use = (O: Ord, values: number[]) => values.map(O.compare);'], expected: 0 },
    { name: 'computed-consumer', code: [ordType,
        'export const sort = (O: Ord, values: number[]) => values["sort"](O.compare);'], expected: 0 },
    { name: 'computed-capability', code: [ordType,
        'export const sort = (O: Ord, values: number[]) => values.sort(O["compare"]);'], expected: 0 },
    { name: 'optional-capability', code: [
        'type Ord = { compare?: (left: number, right: number) => number };',
        'export const sort = (O: Ord, values: number[]) => values.sort(O.compare);'
    ], expected: 0 },
    { name: 'custom-receiver', code: [ordType,
        'type Custom = { sort: (compare: Ord["compare"]) => number[] };',
        'export const sort = (O: Ord, values: Custom) => values.sort(O.compare);'
    ], expected: 0 },
    { name: 'escaped-capability', code: [ordType,
        'export const sort = (O: Ord, values: number[]) => { const saved = O.compare; return values.sort(O.compare); };'
    ], expected: 0 },
    { name: 'optional-receiver', code: [ordType,
        'export const sort = (O: Ord, values: number[]) => values?.sort(O.compare);'], expected: 0 },
    { name: 'optional-call', code: [ordType,
        'export const sort = (O: Ord, values: number[]) => values.sort?.(O.compare);'], expected: 0 },
    { name: 'optional-provider', code: [ordType,
        'export const sort = (O: Ord, values: number[]) => values.sort(O?.compare);'], expected: 0 },
    { name: 'nested-return', code: [ordType,
        'export function sort(O: Ord, values: number[], flag: boolean) { if (flag) return values.sort(O.compare); return []; }'
    ], expected: 0 },
    { name: 'two-consumers', code: [ordType,
        'export const sort = (O: Ord, values: number[], flag: boolean) => flag ? values.sort(O.compare) : values.sort(O.compare);'
    ], expected: 0 }
];
sortAdmissionCases.forEach(({ name = '', code = [], expected = 0 } = {}) => {
    const { sortFacts = new Map(), agreements = [], diagnostics = [], emitterSites: reached = [] } = transformSourceAdmission({
        code, name: `sort-domain-${name}`, collectSort: true
    });
    const reported = agreements.filter(({ action = '' } = {}) => action === 'guarded-sort-capability');

    assert.deepEqual(diagnostics, [], `${name}: transformer diagnostics`);
    assert.equal(sortFacts.size, expected, `${name}: checker source fact cardinality`);
    assert.equal(reported.length, expected, `${name}: completed sort placement publication`);

    if (name === 'optional-capability') assert.deepEqual(reached, [5],
        'The optional field is rejected by sort admission but retains its separate final native-call boundary.');

    if (name === 'block-return') assert.deepEqual(reached, [1, 29, 58],
        'Same-function sort placement emits only its guard, return and staged-getter boundaries.');
});
assert.deepEqual(admissionEmitterSites, {
    'guarded-closed-provider-model': [],
    'slang-required-function-provider-edge': [34],
    'guarded-sort-capability': [1, 29],
    'guarded-direct-capability': [1, 31],
    'exact-callback-projected': [],
    'exact-provider-forwarded': [],
    'provider-forwarded': [],
    'guarded-function': [],
    'exact-tuple-position': [],
    'guarded-tuple': [52, 53],
    preserve: []
});
assert.deepEqual(admissionReportCounts, {
    'guarded-closed-provider-model': 1,
    'slang-required-function-provider-edge': 1,
    'guarded-sort-capability': 1,
    'guarded-direct-capability': 1,
    'exact-callback-projected': 1,
    'exact-provider-forwarded': 3,
    'provider-forwarded': 2,
    'guarded-function': 1,
    'exact-tuple-position': 1,
    'guarded-tuple': 1,
    preserve: 1
});
assert.deepEqual([...observedEmitterSites].toSorted((a, b) => a - b), [1, 5, 8, 29, 30, 31, 34, 39, 52, 53, 55, 58],
    'Exact emitter sites reached by the paired public source admissions.');

const edgeCollisionSource = [
    'const getFunctorComposition = () => ({ map: (value: string) => value });',
    'export const forward = () => { const map = getFunctorComposition().map; return { map }; };',
    'export const invoke = () => { const map = getFunctorComposition().map; return map("value"); };'
];
const edgeCollision = transformSourceAdmission({ name: 'provider-edge-collision', code: edgeCollisionSource });
const { agreements: collisionReports = [], code: collisionCode = '' } = edgeCollision;
assert.equal(collisionReports.filter(({ action = '' } = {}) => action === 'slang-required-function-provider-edge').length, 1,
    'One checker-admitted forward must not lend its fact to a same-named invoked declaration.');
assert.match(collisionCode, /const map = getFunctorComposition\(\)\.map;/u,
    'The same-named invoked source declaration keeps its original member Get.');
const executeEdge = (code) => {
    const { outputText = '' } = typescript.transpileModule(code, {
        compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ESNext }
    });

    return Array.from(runInNewContext(`${outputText}\n[exports.forward().map('value'), exports.invoke()]`, { exports: {} }));
};
assert.deepEqual(executeEdge(collisionCode), executeEdge(edgeCollisionSource.join('\n')),
    'Source and lowered collision paths retain the same observable values.');
const twinEdges = transformSourceAdmission({ name: 'provider-edge-twins', code: [
    'const getFunctorComposition = () => ({ map: (value: string) => value });',
    'export const first = () => { const map = getFunctorComposition().map; return { map }; };',
    'export const second = () => { const map = getFunctorComposition().map; return { map }; };'
] });
const { agreements: twinReports = [] } = twinEdges;
const distinctEdges = twinReports.filter(({ action = '' } = {}) => action === 'slang-required-function-provider-edge');
assert.equal(distinctEdges.length, 2, 'Two admitted declarations retain independent source facts.');
assert.notEqual(distinctEdges[0], distinctEdges[1]);
assert.notEqual(distinctEdges[0].sourceRange, distinctEdges[1].sourceRange);
