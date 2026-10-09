import assert from 'node:assert/strict';

import { loadInternalModule } from './internal-module.js';
import { getKind } from '../rules/contracts/model.js';
import { captureProgram } from '../rules/support/eslint-program.js';

const owner = await loadInternalModule({ file: 'rules/contracts/flow.js', exports: [
    'analyzer', 'createProgramFlow', 'setExpressionContext'
] });
const {
    analyzer = {}, createFunctionFlow = undefined, createProgramFlow = undefined,
    setExpressionContext = undefined
} = owner;
const node = Object.freeze({ type: 'Literal', value: 1 });
const twin = Object.freeze({ type: 'Literal', value: 1 });
const firstContext = Object.freeze({ bindings: Object.freeze({}) });
const lastContext = Object.freeze({ bindings: Object.freeze({ value: 1 }) });
const contexts = new Map();
const state = Object.freeze({ contexts, returns: [] });
setExpressionContext({ state, node, context: firstContext });
setExpressionContext({ state, node: twin, context: firstContext });
setExpressionContext({ state, node, context: lastContext });
assert.deepEqual([...contexts.keys()], [node, twin]);
assert.equal(contexts.get(node), lastContext);
assert.equal(contexts.get(twin), firstContext);
assert.equal(state.contexts, contexts);

let trace = [];
const observedNode = Object.freeze({ get [Symbol.toStringTag]() {
    trace = [...trace, 'brand'];

    return 'Object';
} });
const store = Object.freeze({ get set() {
    trace = [...trace, 'set-get'];

    return function recordContext(key, value) {
        assert.equal(this, store);
        assert.equal(key, observedNode);
        assert.equal(value, firstContext);
        trace = [...trace, 'set-call'];
    };
} });
const observedState = Object.freeze({ get contexts() {
    trace = [...trace, 'contexts-get'];

    return store;
} });
setExpressionContext({ state: observedState, node: observedNode, context: firstContext });
assert.deepEqual(trace, ['brand', 'contexts-get', 'set-get', 'set-call']);
trace = [];
[null, false, 0, '', [], () => ({}), Symbol('invalid')].forEach(value => (
    setExpressionContext({ state: observedState, node: value, context: firstContext })
));
assert.deepEqual(trace, []);
const failure = new Error('owned flow-store failure');
const failingState = Object.freeze({ get contexts() { throw failure; } });
assert.throws(() => setExpressionContext({ state: failingState, node }), error => error === failure);
assert.throws(() => setExpressionContext({ node }), { name: 'TypeError' });
const failingMethodState = Object.freeze({ contexts: Object.freeze({ get set() { throw failure; } }) });
assert.throws(() => setExpressionContext({ state: failingMethodState, node }), error => error === failure);
assert.throws(() => setExpressionContext({ state: { contexts: { set: false } }, node }), { name: 'TypeError' });

let returnBufferRead = false;
const argument = Object.freeze({ type: 'Literal', value: 1 });
const returnNode = Object.freeze({ type: 'ReturnStatement', argument });
const returnState = Object.freeze({
    contexts: new Map(),
    get returns() {
        returnBufferRead = true;

        throw failure;
    }
});
const returnResult = analyzer.statement({ state: returnState, node: returnNode, context: firstContext });
const { completions: returnCompletions = [], reachable: returnReachable = undefined } = returnResult;
const [returnCompletion = {}] = returnCompletions;
assert.equal(returnBufferRead, false);
assert.equal(returnReachable, false);
assert.equal(returnCompletion.kind, 'return');
assert.equal(returnCompletion.argument, argument);
assert.equal(returnCompletion.node, returnNode);
assert.equal(getKind(returnCompletion.value), 'number');

const sources = {
    arrow: 'const read = () => 1;',
    branches: 'const read = ({ flag = false } = {}) => { if (flag) return 1; return ""; return false; };',
    throwOnly: 'const read = () => { throw new Error("stop"); };',
    empty: 'const read = () => {};',
    nested: 'const read = () => { const inner = () => 1; return ""; };',
    finally: 'const read = () => { try { return 1; } finally { return ""; } };',
    preservedReturn: 'const read = () => { try { return []; } finally { const done = true; } };',
    overriddenThrow: 'const read = () => { try { throw new Error("stop"); } finally { return ""; } };',
    preservedThrow: 'const read = () => { try { throw new Error("stop"); } finally {} return []; };',
    explicitThrowState: 'const read = () => { let value = ""; try { value = []; throw Error("stop"); } catch (error) { return value.map(Boolean); } };',
    breakLabel: 'const read = () => { outer: for (;;) { break outer; } return ""; };',
    continueLoop: 'const read = () => { for (;;) { continue; } return ""; };',
    continueLabel: 'const read = () => { outer: for (;;) { for (;;) { continue outer; } } return ""; };',
    preservedBreak: 'const read = () => { for (;;) { try { break; } finally {} } return ""; };',
    overriddenBreak: 'const read = () => { for (;;) { try { break; } finally { continue; } } return ""; };',
    switchBreak: 'const read = value => { switch (value) { case 1: break; default: break; } return ""; };',
    unreachableLoopReturn: 'const read = () => { while (true) { return []; } return ""; };'
};
const flows = Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([name = '', source = ''] = []) => {
    const program = await captureProgram(source, { fileName: `${name}.js` });
    const { body: [{ declarations: [{ init: functionNode = {} } = {}] = [] } = {}] = [] } = program;
    const flow = createFunctionFlow({ functionNode });
    const repeat = createFunctionFlow({ functionNode });
    const { contexts: flowContexts = undefined, returns = undefined } = flow;
    const { contexts: repeatContexts = undefined, returns: repeatReturns = undefined } = repeat;
    assert.notEqual(flowContexts, repeatContexts);
    assert.notEqual(returns, repeatReturns);
    assert.equal(flowContexts instanceof Map, true);
    assert.equal(Array.isArray(returns), true);
    assert.equal(returns.length, repeatReturns.length);
    // Return contexts link back to their owning flow. Compare facts separately
    // from those cycles and verify ownership through reference identity.
    returns.forEach((record, index) => {
        const { [index]: repeatedRecord = {} } = repeatReturns;
        const { context = {}, ...facts } = record;
        const { context: repeatedContext = {}, ...repeatedFacts } = repeatedRecord;
        const { flows: ownedFlows = new Map(), ...contextFacts } = context;
        const { flows: repeatedFlows = new Map(), ...repeatedContextFacts } = repeatedContext;
        assert.notEqual(record, repeatedRecord);
        assert.deepEqual(facts, repeatedFacts);
        assert.deepEqual(contextFacts, repeatedContextFacts);
        assert.notEqual(ownedFlows, repeatedFlows);
        assert.equal(ownedFlows.get(functionNode), flow);
        assert.equal(repeatedFlows.get(functionNode), repeat);
    });

    return [name, flow];
})));
const {
    arrow = {},
    branches = {},
    throwOnly = {},
    empty = {},
    nested = {},
    finally: finalized = {},
    preservedReturn = {},
    overriddenThrow = {},
    preservedThrow = {},
    explicitThrowState = {},
    breakLabel = {},
    continueLoop = {},
    continueLabel = {},
    preservedBreak = {},
    overriddenBreak = {},
    switchBreak = {},
    unreachableLoopReturn = {}
} = flows;
const getReturnKinds = ({ returns = undefined } = {}) => returns.map(({ contract: { kind = '' } = {} } = {}) => kind);
assert.deepEqual(getReturnKinds(arrow), ['number']);
assert.deepEqual(getReturnKinds(branches), ['number', 'string']);
assert.deepEqual(getReturnKinds(throwOnly), []);
assert.deepEqual(getReturnKinds(empty), []);
assert.deepEqual(getReturnKinds(nested), ['string']);
assert.deepEqual(getReturnKinds(finalized), ['string']);
assert.deepEqual(getReturnKinds(preservedReturn), ['array']);
assert.deepEqual(getReturnKinds(overriddenThrow), ['string']);
assert.deepEqual(getReturnKinds(preservedThrow), []);
assert.deepEqual(getReturnKinds(explicitThrowState), ['array']);
assert.deepEqual(getReturnKinds(breakLabel), ['string']);
assert.deepEqual(getReturnKinds(continueLoop), []);
assert.deepEqual(getReturnKinds(continueLabel), []);
assert.deepEqual(getReturnKinds(preservedBreak), ['string']);
assert.deepEqual(getReturnKinds(overriddenBreak), []);
assert.deepEqual(getReturnKinds(switchBreak), ['string']);
assert.deepEqual(getReturnKinds(unreachableLoopReturn), ['array']);
const program = Object.freeze({ type: 'Program', body: Object.freeze([]) });
const programFlow = createProgramFlow({ program });
const repeatedProgramFlow = createProgramFlow({ program });
const { contexts: programContexts = undefined, returns: programReturns = undefined } = programFlow;
const { contexts: repeatedProgramContexts = undefined, returns: repeatedProgramReturns = undefined } = repeatedProgramFlow;
assert.notEqual(programContexts, repeatedProgramContexts);
assert.notEqual(programReturns, repeatedProgramReturns);
assert.deepEqual(programReturns, []);
assert.equal(programContexts instanceof Map, true);

const sharedReturn = Object.freeze({ type: 'ReturnStatement', argument: node });
const branch = Object.freeze({
    type: 'IfStatement', test: Object.freeze({ type: 'Identifier', name: 'flag' }),
    consequent: sharedReturn, alternate: sharedReturn
});
const branchingFunction = Object.freeze({
    type: 'FunctionExpression', params: Object.freeze([]),
    body: Object.freeze({ type: 'BlockStatement', body: Object.freeze([branch]) })
});
const sharedFlow = createFunctionFlow({ functionNode: branchingFunction });
const { returns: sharedReturns = undefined } = sharedFlow;
assert.deepEqual(sharedReturns.map(({ node: returnNode = undefined } = {}) => returnNode), [sharedReturn]);
