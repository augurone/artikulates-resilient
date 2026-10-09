import assert from 'node:assert/strict';

import { ESLint } from 'eslint';

import resilient from 'eslint-plugin-resilient';

import { getPropertyDiagnostics, getReturnDiagnostics } from '../rules/contracts/diagnostics.js';
import { createFunctionFlows, getFlowContext } from '../rules/contracts/flow.js';
import { getChildren, getDefinitions } from '../rules/contracts/infer.js';
import { getKind } from '../rules/contracts/model.js';
import { captureProgram } from '../rules/support/eslint-program.js';

const getReadFlow = async (code) => {
    const program = await captureProgram(code, { fileName: 'r7-flow.js' });
    const definitions = getDefinitions(program);
    const flows = createFunctionFlows({ program, definitions });
    const { read: { node = {} } = {} } = definitions;

    return { program, definitions, flows, flow: flows.get(node) };
};
const returnKinds = ({ flow: { returns = [] } = {} } = {}) => returns
    .map(({ contract: value = {} } = {}) => getKind(value));
const getCatchValueKind = ({ code = '', result = {} } = {}) => {
    const { program = {}, definitions = {}, flows = new Map() } = result;
    let receiver = {};
    const visit = (node = {}) => {
        const { type = '', name = '', range: [start = -1] = [] } = node;

        if (type === 'Identifier' && name === 'value' && start > code.indexOf('catch')) receiver = node;

        getChildren(node).forEach(visit);
    };

    visit(program);
    const { type: receiverType = '' } = receiver;

    assert.equal(receiverType, 'Identifier');
    const { bindings = {} } = getFlowContext({
        node: receiver, definitions, flows
    });
    const { value = {} } = bindings;

    return getKind(value);
};

// These two inputs are semantic falsifiers; their embedded calls are not
// offered as authored Resilient examples.
const consumed = 'const read = action => { try { try { action(); } catch {} return []; } catch { return ""; } };';
const overridden = 'const read = action => { try { try { action(); } finally { return []; } } catch { return ""; } };';
const escaping = 'const read = action => { try { action(); return []; } catch { return ""; } };';

const handled = await Promise.all([consumed, overridden].map(getReadFlow));
handled.forEach((result) => {
    const { program = {} } = result;
    assert.deepEqual(returnKinds(result), ['array']);
    assert.deepEqual(getReturnDiagnostics({ program }), []);
});

const escaped = await getReadFlow(escaping);
assert.deepEqual(returnKinds(escaped), ['array', 'string']);
assert.deepEqual(getReturnDiagnostics({ program: escaped.program })
    .map(({ data: { actual = '' } = {} } = {}) => actual), ['array', 'string']);
const catchPattern = await getReadFlow(
    'const read = action => { try { try { action(); } catch ({ value }) { return []; } } catch { return ""; } };'
);
assert.deepEqual(returnKinds(catchPattern), ['array', 'string']);
const thrownCall = await getReadFlow(
    'const read = action => { try { throw action(); } catch { return []; } };'
);
assert.deepEqual(returnKinds(thrownCall), ['array']);
const mixedThrow = await getReadFlow(
    'const read = (action, flag) => { try { if (flag) throw ""; action(); } catch (error) { return error; } };'
);
assert.deepEqual(returnKinds(mixedThrow), ['unknown']);
const doBeforeTest = await getReadFlow(
    'const read = () => { do { return []; } while (missing()); };'
);
assert.deepEqual(returnKinds(doBeforeTest), ['array']);
const endless = await getReadFlow('const read = () => { for (;;) {} return ""; };');
assert.deepEqual(returnKinds(endless), []);

const skippedBranch = await getReadFlow(
    'const read = action => { try { return false && action(); } catch { return ""; } };'
);
assert.deepEqual(returnKinds(skippedBranch), ['boolean']);
const skippedIf = await getReadFlow(
    'const read = () => { try { if (false) missing(); return []; } catch { return ""; } };'
);
assert.deepEqual(returnKinds(skippedIf), ['array']);
const computedKey = await getReadFlow('const read = (base, key) => base[key];');
assert.deepEqual(computedKey.flow.completions.filter(({ kind = '' } = {}) => kind === 'throw')
    .map(({ phase: name = '' } = {}) => name), ['coercion', 'property-get']);
const computedWrite = await getReadFlow(
    'const read = (target, key) => { let value = ""; try { target[key] = (value = []); } catch { return value; } return []; };'
);
assert.deepEqual(returnKinds(computedWrite), ['array', 'unknown']);
// These are semantic phase probes with embedded assignment, not authored-valid examples.
const memberOnly = await getReadFlow('const read = target => target.action();');
assert.deepEqual(memberOnly.flow.completions.filter(({ kind = '' } = {}) => kind === 'throw')
    .map(({ phase: name = '' } = {}) => name), ['property-get', 'invocation']);
const memberCode = 'const read = target => { let value = ""; try { target.action(value = []); } catch { return value; } return []; };';
const member = await getReadFlow(memberCode);
assert.deepEqual(returnKinds(member), ['array', 'unknown']);
assert.equal(getCatchValueKind({ code: memberCode, result: member }), 'unknown',
    'Getter failure precedes assignment; invocation failure follows it.');
const earlierArgumentCode = 'const read = action => { let value = ""; const unavailable = 1; try { action(unavailable(), value = []); } catch { return value; } return []; };';
const earlierArgument = await getReadFlow(earlierArgumentCode);
assert.deepEqual(returnKinds(earlierArgument), ['string']);
assert.equal(getCatchValueKind({ code: earlierArgumentCode, result: earlierArgument }), 'string',
    'A failed earlier argument cannot execute a later assignment.');
const awaitResume = await getReadFlow('const read = async action => { await action(); return []; };');
assert.deepEqual(awaitResume.flow.completions.filter(({ kind = '' } = {}) => kind === 'throw')
    .map(({ phase: name = '' } = {}) => name), ['invocation', 'await-resume']);
const argumentFamily = await getReadFlow(
    'const text = value => ""; const read = flag => text(flag ? [] : "");'
);
assert.deepEqual(returnKinds(argumentFamily), ['string']);
const discardedOperand = await getReadFlow('const read = flag => (flag ? [] : "", "");');
assert.deepEqual(returnKinds(discardedOperand), ['string']);
const nestedThrow = await getReadFlow(
    'const read = () => { const later = () => { throw "stop"; }; return []; };'
);
assert.deepEqual(returnKinds(nestedThrow), ['array']);
assert.deepEqual(nestedThrow.flow.completions.filter(({ kind = '' } = {}) => kind === 'throw'), []);
const throwingFinalizer = await getReadFlow(
    'const read = () => { try { return []; } finally { throw "stop"; } };'
);
assert.deepEqual(returnKinds(throwingFinalizer), []);
assert.deepEqual(throwingFinalizer.flow.completions.filter(({ kind = '' } = {}) => kind === 'throw')
    .map(({ phase: name = '' } = {}) => name), ['explicit-throw']);
const rethrow = await getReadFlow(
    'const read = action => { try { action(); } catch (error) { throw error; } return []; };'
);
assert.deepEqual(returnKinds(rethrow), ['array']);
const capturedWrite = await getReadFlow(
    'const read = action => { let value = ""; const callback = () => { value = []; }; try { action(callback); } catch { return value; } return []; };'
);
assert.deepEqual(returnKinds(capturedWrite), ['array', 'unknown']);
const spreadFallback = await getReadFlow(
    'const read = (action, args) => { let value = ""; try { action(...args); } catch { return value; } return []; };'
);
assert.deepEqual(returnKinds(spreadFallback), ['array', 'unknown']);

const unresolvedWrite = await getReadFlow(
    'const read = () => { try { missing = []; } catch { return ""; } };'
);
assert.deepEqual(returnKinds(unresolvedWrite), ['string']);
const readonlyWrite = await getReadFlow(
    'const read = () => { const value = ""; try { value = []; } catch { return value; } };'
);
assert.deepEqual(returnKinds(readonlyWrite), ['string']);
const nonconstructor = await getReadFlow(
    'const read = () => { let value = ""; try { const make = () => ({}); new make(value = []); } catch { return value; } };'
);
assert.deepEqual(returnKinds(nonconstructor), ['array']);

const arrayBinding = await getReadFlow(
    'const read = (text = "") => { const match = text.match(/x/u); if (match) { const [, name = ""] = match; return { name }; } return false; };'
);
assert.deepEqual(returnKinds(arrayBinding), ['object', 'boolean']);
const mixedTuple = await getReadFlow(
    'const pair = () => ["", {}]; const read = () => { const [, declaration = {}] = pair(); return declaration; };'
);
assert.deepEqual(returnKinds(mixedTuple), ['unknown']);

const closingReturn = await getReadFlow(
    'const read = items => { for (const item of items) { return []; } };'
);
assert.equal(closingReturn.flow.completions.some(({ phase: name = '' } = {}) => name === 'iterator-close'), true);
const closingThrow = await getReadFlow(
    'const read = items => { for (const item of items) { throw "x"; } };'
);
assert.equal(closingThrow.flow.completions.some(({ phase: name = '' } = {}) => name === 'iterator-close'), false);
const returnedHeap = await getReadFlow(
    'const read = action => { const result = { name: "" }; try { return result; } finally { action(result); } };'
);
assert.deepEqual(returnKinds(returnedHeap), ['object']);
const { flow: { returns: returnedValues = [] } = {} } = returnedHeap;
const [{ contract: returnedValue = {} } = {}] = returnedValues;
assert.equal(returnedValue.properties.name.kind, 'unknown');

const bindingFailure = await getReadFlow(
    'const read = () => { try { const [value] = []; return []; } catch { return ""; } };'
);
assert.deepEqual(returnKinds(bindingFailure), ['array', 'string']);

// The assignment inside a call is a rejected-source phase probe.
const phaseCode = 'const read = action => { let value = ""; try { action(value = []); } catch { return value.map(Boolean); } return []; };';
const phase = await getReadFlow(phaseCode);
assert.deepEqual(returnKinds(phase), ['array', 'array']);
assert.equal(getCatchValueKind({ code: phaseCode, result: phase }), 'array');

const noncallable = await getReadFlow(
    'const read = () => { let value = ""; try { const action = 1; action(value = []); } catch { return value; } return ""; };'
);
assert.deepEqual(returnKinds(noncallable), ['array']);

const firstArgument = await getReadFlow(
    'const fn = (first, second) => first; const read = () => { let value = ""; return fn(value, value = []); };'
);
assert.deepEqual(returnKinds(firstArgument), ['string']);
const calleeSnapshot = await getReadFlow(
    'const read = () => { let action = () => ""; return action(action = () => []); };'
);
assert.deepEqual(returnKinds(calleeSnapshot), ['string']);

const opaqueCode = 'const read = () => { let value = ""; try { value++; } catch { return value; } };';
const opaque = await getReadFlow(opaqueCode);
let descendant = {};
const findDescendant = (node = {}) => {
    const { type = '', name = '', range: [start = -1] = [] } = node;

    if (type === 'Identifier' && name === 'value' && start === opaqueCode.indexOf('value++')) descendant = node;

    getChildren(node).forEach(findDescendant);
};
findDescendant(opaque.program);
const { bindings: opaqueBindings = {} } = getFlowContext({
    node: descendant, definitions: opaque.definitions, flows: opaque.flows
});
const { value: opaqueValue = {} } = opaqueBindings;
assert.equal(getKind(opaqueValue), 'unknown');

const openParameter = await getReadFlow(
    'const read = (factory = {}) => { observe(); return factory.createIdentifier("x"); };'
);
assert.deepEqual(getPropertyDiagnostics({
    program: openParameter.program,
    definitions: openParameter.definitions,
    flows: openParameter.flows
}), []);

const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{
        plugins: { resilient },
        rules: { 'resilient/signature-contract-return-consistency': 'error' }
    }]
});
const [handledResult = {}] = await eslint.lintText(consumed, { filePath: 'r7-handled.js' });
const [escapingResult = {}] = await eslint.lintText(escaping, { filePath: 'r7-escaping.js' });
assert.deepEqual(handledResult.messages, []);
assert.equal(escapingResult.messages.filter(({ ruleId = '' } = {}) => (
    ruleId === 'resilient/signature-contract-return-consistency'
)).length, 2);
