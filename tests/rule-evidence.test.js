import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import { Linter } from 'eslint';

import { isStableBinding } from '../rules/contracts/binding-evidence.js';
import { createCallableEvidence } from '../rules/contracts/callable-evidence.js';
import { clearContractCaches } from '../rules/contracts/eslint-graph.js';
import callbacks from '../rules/no-unguarded-callback-invocation.js';
import members from '../rules/prefer-destructured-member-access.js';
import safeDefaults from '../rules/prefer-safe-destructuring-defaults.js';
import signature from '../rules/prefer-signature-destructuring.js';
import { hasWholeObjectReference } from '../rules/support/signature-analysis.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'resilient-rule-evidence-'));
const guarded = "export const flow = (value, stage) => () => { if (typeof stage !== 'function') return ''; return stage(value); };";
fs.writeFileSync(path.join(directory, 'operations.js'), guarded);
fs.writeFileSync(path.join(directory, 'function.js'), 'export const flow = (value, stage) => stage(value);');
fs.writeFileSync(path.join(directory, 'predicate.js'), "export const callable = value => typeof value === 'function';");
fs.writeFileSync(path.join(directory, 'with-predicate.js'), "import { callable as check } from './predicate.js'; export const flow = (value, stage) => () => check(stage) && stage(value);");
fs.writeFileSync(path.join(directory, 'barrel.js'), "export { flow as compose } from './operations.js';");
const linter = new Linter({ cwd: directory });
const capture = {
    rules: {
        consumer: {
            meta: { schema: [], messages: { admitted: 'admitted' } },
            create(context) {
                const { isGuardedConsumer = undefined } = createCallableEvidence(context);

                return {
                    CallExpression(node) {
                        const { arguments: args = [] } = node;
                        const [, stage = {}] = args;
                        const { name = '' } = stage;

                        if (name === 'cb' && isGuardedConsumer(node, 1)) context.report({ node, messageId: 'admitted' });
                    }
                };
            }
        }
    }
};
const consumerCases = [
    ['import { isFunction } from "./unresolved.js"; const other = (value, stage) => isFunction(stage) && stage(value); const use = ({ cb }) => other(1, cb);', false],
    ["import { flow as pipeline } from './with-predicate.js'; const use = ({ cb }) => pipeline(1, cb);", true],
    ["import { compose } from './barrel.js'; const use = ({ cb }) => compose(1, cb);", true],
    ['function other(value, stage) { if (typeof stage !== "function") return ""; stage(value); return arguments[1](value); } const use = ({ cb }) => other(1, cb);', false],
    ['function other(value, stage) { if (typeof stage !== "function") return ""; eval("stage = value"); return stage(value); } const use = ({ cb }) => other(1, cb);', false],
    ["import { flow } from './operations.js'; const use = ({ cb }) => flow(1, cb);", true],
    ["import { flow as renamed } from './operations.js'; const use = ({ cb }) => renamed(1, cb);", true],
    ["import { flow as renamed } from './operations.js'; const alias = renamed; const use = ({ cb }) => alias(1, cb);", true],
    ["import { flow } from './function.js'; const use = ({ cb }) => flow(1, cb);", false],
    ["import { flow } from './missing.js'; const use = ({ cb }) => flow(1, cb);", false],
    ["import { flow } from './operations.js'; const use = (flow, { cb }) => flow(1, cb);", false],
    ["import { flow } from './operations.js'; const use = ({ cb }) => { const flow = (v, f) => f(v); return flow(1, cb); };", false],
    ["const other = (value, stage) => { if (typeof stage !== 'function') return ''; return stage(value); }; const use = ({ cb }) => other(1, cb);", true],
    ["const other = (value, stage) => { const alias = stage; if (typeof alias !== 'function') return ''; return alias(value); }; const use = ({ cb }) => other(1, cb);", true],
    ["const other = (value, stage) => { stage(value); if (typeof stage !== 'function') return ''; return stage(value); }; const use = ({ cb }) => other(1, cb);", false],
    ["const other = (value, stage) => { if (typeof stage !== 'function') return ''; stage = value; return stage(value); }; const use = ({ cb }) => other(1, cb);", false],
    ["const other = (value, stage) => { if (typeof stage !== 'function') return ''; return () => stage(value); }; const use = ({ cb }) => other(1, cb);", true],
    ["const other = (value, stage) => { if (typeof stage !== 'function') return ''; return stage; }; const use = ({ cb }) => other(1, cb);", false],
    ["const isFunction = () => true; const other = (value, stage) => isFunction(stage) && stage(value); const use = ({ cb }) => other(1, cb);", false],
    ["const callable = stage => typeof stage === 'function'; const other = (value, stage) => callable(stage) && stage(value); const use = ({ cb }) => other(1, cb);", true],
    ["const other = (value, ...stages) => stages[0](value); const use = ({ cb }) => other(1, cb);", false]
];
consumerCases.forEach(([code = '', expected = false] = []) => {
    const messages = linter.verify(code, {
        plugins: { capture },
        rules: { 'capture/consumer': 'error' }
    }, { filename: path.join(directory, 'consumer.js') });

    assert.equal(messages.length, expected ? 1 : 0, JSON.stringify({ code, messages }));
    assert.equal(messages.some(({ fatal = false } = {}) => fatal), false, code);
});
const rules = { defaults: safeDefaults, callbacks, signature, members };
const verify = (code = '', enabled = ['defaults', 'callbacks']) => linter.verify(code, {
    plugins: { evidence: { rules } },
    rules: Object.fromEntries(enabled.map(name => [`evidence/${name}`, 'error']))
}, { filename: path.join(directory, 'consumer.js') });
consumerCases.forEach(([code = '', admitted = false] = []) => {
    const messages = verify(code);
    const defaults = messages.filter(({ ruleId = '' } = {}) => ruleId === 'evidence/defaults');

    assert.equal(defaults.length, admitted ? 0 : 1, code);
    assert.equal(messages.some(({ fatal = false } = {}) => fatal), false, code);
});
const importedPredicate = "import { flow as pipeline } from './with-predicate.js'; const use = ({ cb }) => pipeline(1, cb);";
fs.writeFileSync(path.join(directory, 'predicate.js'), 'export const callable = value => !!value;');
assert.equal(verify(importedPredicate).length, 1);
fs.writeFileSync(path.join(directory, 'predicate.js'), "export const callable = value => typeof value === 'function';");
assert.equal(verify(importedPredicate).length, 0);
fs.writeFileSync(path.join(directory, 'false-predicate.js'), 'export const callable = () => true;');
const resolvePredicate = ({ from = '', source = '' } = {}) => path.resolve(path.dirname(from), source === './predicate.js' ? './false-predicate.js' : source);
const redirected = linter.verify(importedPredicate, {
    plugins: { evidence: { rules } }, rules: { 'evidence/defaults': 'error' },
    settings: { resilient: { resolver: resolvePredicate } }
}, { filename: path.join(directory, 'consumer.js') });
assert.equal(redirected.length, 1);
assert.equal(verify(importedPredicate).length, 0);
const callbackCases = [
    ['const run = ({ cb }, next) => { cb = next; if (typeof cb === "function") cb(); };', []],
    ['const run = ({ cb }, next) => { if (typeof cb === "function") cb(); cb = next; if (typeof cb === "function") cb(); };', []],
    ['const run = ({ cb }, next) => { const alias = cb; cb = next; if (typeof cb === "function") alias(); };', ['defaults', 'callbacks']],
    ['const run = ({ cb }, next) => { const alias = cb; cb = next; if (typeof alias === "function") alias(); };', ['defaults']],
    ['const run = ({ cb }) => { const later = () => cb(); if (typeof cb !== "function") return; return later; };', ['defaults', 'callbacks']],
    ['const run = ({ cb }) => { if (typeof cb !== "function") return; return values.map(() => cb()); };', ['defaults']],
    ['import { isFunction } from "./unresolved.js"; const run = ({ cb }) => isFunction(cb) && cb();', []],
    ['const run = ({ cb }) => { const alias = cb; if (typeof alias === "function") alias(); };', []],
    ['const run = ({ cb }) => { const alias = cb; alias(); };', ['defaults', 'callbacks']],
    ['const run = ({ cb }) => { cb(); if (typeof cb === "function") cb(); };', ['callbacks']],
    ['const run = ({ cb, other }) => { if (typeof cb === "function") { cb(); other(); } };', ['defaults', 'callbacks']],
    ['const run = ({ cb }) => { if (typeof cb === "function") { const inner = cb => cb(); return inner; } };', ['defaults']],
    ['const run = ({ cb }) => { if (typeof cb === "function") return () => cb(); };', ['defaults']],
    ['const run = ({ cb }) => { if (typeof cb !== "function") return; cb = 1; cb(); };', ['defaults', 'callbacks']],
    ['const run = ({ cb }) => { const isFunction = () => true; if (isFunction(cb)) cb(); };', ['defaults', 'callbacks']],
    ['const run = ({ cb = noop }) => cb();', []],
    ['const run = ({ cb, ...rest }) => { if (typeof cb === "function") cb(); return rest; };', []]
];
callbackCases.forEach(([code = '', expected = []] = []) => {
    const messages = verify(code);

    assert.deepEqual(messages.map(({ ruleId = '' } = {}) => ruleId.replace('evidence/', '')), expected, code);
    messages.forEach(({ fix = false, suggestions = [], line = 0, column = 0, endColumn = 0 } = {}) => {
        assert.equal(fix, false);
        assert.deepEqual(suggestions, []);
        assert.equal(line, 1);
        assert.ok(column > 0 && endColumn > column);
    });
    assert.equal(linter.verifyAndFix(code, {
        plugins: { evidence: { rules } }, rules: { 'evidence/defaults': 'error', 'evidence/callbacks': 'error' }
    }, { filename: path.join(directory, 'consumer.js') }).output, code);
});
const whole = 'const read = input => { const { value = "" } = input; return { ...input, value }; };';
assert.deepEqual(verify(whole, ['signature']), []);
assert.equal(hasWholeObjectReference({ wholeObjectNodes: [{ type: 'Identifier', range: [1, 2] }], afterNode: { range: [3, 4] } }), false);
assert.equal(hasWholeObjectReference({ wholeObjectNodes: [{ type: 'Identifier', range: [5, 6] }], afterNode: { range: [3, 4] } }), true);
const deferredSources = [
    'input => { const { first = "" } = input; return () => { const { later = "" } = input; return [first, later]; }; }',
    'input => { const read = () => { const { later = "" } = input; return later; }; const { first = "" } = input; return [first, read]; }',
    'input => { function read() { const { later = "" } = input; return later; } const { first = "" } = input; return [first, read]; }',
    'input => { const { first = "" } = input; return consume(() => { const { later = "" } = input; return [first, later]; }); }'
];
deferredSources.forEach(code => assert.deepEqual(verify(`const read = ${code};`, ['signature']), []));
const shadowedExtraction = 'const read = input => { const { first = "" } = input; const other = (input = {}) => { const { later = "" } = input; return later; }; return [first, other]; };';
assert.equal(verify(shadowedExtraction, ['signature']).length, 2);
assert.equal(verify('const read = input => { send(input); const { first = "" } = input; return first; };', ['signature']).length, 1);
const [deferredSource = ''] = deferredSources;
const readDeferred = vm.runInNewContext(`(${deferredSource})`);
let getterReads = [];
let laterValue = 'initial';
const deferredInput = {
    get first() {
        getterReads = [...getterReads, 'first'];

        return 'first';
    },
    get later() {
        getterReads = [...getterReads, 'later'];

        return laterValue;
    }
};
const deferredRead = readDeferred(deferredInput);
assert.deepEqual(getterReads, ['first']);
laterValue = 'changed';
assert.deepEqual([...deferredRead()], ['first', 'changed']);
assert.deepEqual(getterReads, ['first', 'later']);
laterValue = 'again';
assert.deepEqual([...deferredRead()], ['first', 'again']);
assert.deepEqual(getterReads, ['first', 'later', 'later']);
const delayedFailure = readDeferred({ first: 'first', get later() { throw new Error('deferred Get'); } });
assert.throws(delayedFailure, /deferred Get/u);
const unguardedComposition = '(first, stage) => value => stage(first(value))';
const guardedComposition = '(first, stage) => value => typeof stage === "function" ? stage(first(value)) : ""';
[unguardedComposition, guardedComposition].forEach((composition, index) => {
    const code = `const compose = ${composition}; const build = ({ stage }) => compose(value => value, stage);`;

    assert.equal(verify(code).length, index ? 0 : 1);
});
const compose = vm.runInNewContext(`(${unguardedComposition})`);
const composeGuarded = vm.runInNewContext(`(${guardedComposition})`);
const composedIdentity = {};
assert.equal(compose(value => value, value => value)(composedIdentity), composedIdentity);
const missingStage = compose(value => value, undefined);
assert.throws(() => missingStage(composedIdentity), { name: 'TypeError' });
assert.equal(composeGuarded(value => value, undefined)(composedIdentity), '');
const shadow = 'const read = input => { const { value = "" } = input; const other = input => input.name; return value; };';
const [shadowFinding = {}] = verify(shadow, ['signature']);
const { suggestions: [shadowSuggestion = {}] = [] } = shadowFinding;
const { fix: { text: replacement = '' } = {} } = shadowSuggestion;
assert.ok(replacement.includes('{ value = "" } = {}'));
assert.ok(!replacement.includes('{ name,'));
assert.equal(verify('const run = values => values.reduce((acc = {}, value) => { acc.value = value; return acc; }, {});', ['members']).length, 0);
assert.equal(verify('const run = values => values.reduce((acc, value) => { { const acc = value; use(acc.value); } return acc; }, {});', ['members']).length, 1);
assert.equal(verify('const run = (input) => { { const local = {}; use(local.name); } return local.name; };', ['members']).length, 1);
// An inherited method is called with the original ESLint reference receiver;
// initialization short-circuits even an accessor that would throw on Get.
const receiver = Object.create({ isWrite() { return this !== receiver; } });
assert.equal(isStableBinding({ references: [receiver] }), true);
assert.equal(isStableBinding({ references: [{ init: true, get isWrite() { throw new Error('eager method Get'); } }] }), true);
const captureStable = vm.runInNewContext('(stage) => { if (typeof stage !== "function") return; return () => stage(); }');
const captureMutable = vm.runInNewContext('(stage) => { if (typeof stage !== "function") return; return [() => stage(), next => { stage = next; }]; }');
const resultIdentity = {};
assert.equal(captureStable(() => resultIdentity)(), resultIdentity);
assert.equal(captureStable(false), undefined);
const [invoke = undefined, replace = undefined] = captureMutable(() => resultIdentity);
assert.equal(invoke(), resultIdentity);
replace(false);
assert.throws(invoke, { name: 'TypeError' });
const fixtureRoot = new URL('./fixtures/rule-evidence/', import.meta.url);
const fixtureDirectory = path.dirname(new URL('consumers.valid.js', fixtureRoot).pathname);
const fixtureLinter = new Linter({ cwd: fixtureDirectory });
[
    { name: 'consumers.valid', enabled: ['defaults', 'callbacks'], expected: [] },
    { name: 'consumers.invalid', enabled: ['defaults', 'callbacks'], expected: [
        ['evidence/defaults', 4, 29], ['evidence/defaults', 5, 37], ['evidence/defaults', 6, 31], ['evidence/callbacks', 10, 12]
    ] },
    { name: 'signature.valid', enabled: ['signature'], expected: [] },
    { name: 'signature.invalid', enabled: ['signature'], expected: [
        ['evidence/signature', 2, 11], ['evidence/signature', 4, 15]
    ] }
].forEach(({ name = '', enabled = [], expected = [] } = {}) => {
    const file = new URL(`${name}.js`, fixtureRoot);
    const code = fs.readFileSync(file, 'utf8');
    const { pathname: filename = '' } = file;
    const messages = fixtureLinter.verify(code, {
        plugins: { evidence: { rules } }, rules: Object.fromEntries(enabled.map(rule => [`evidence/${rule}`, 'error']))
    }, { filename });

    assert.deepEqual(messages.map(({ ruleId = '', line = 0, column = 0 } = {}) => [ruleId, line, column]), expected);
});
clearContractCaches();
fs.rmSync(directory, { recursive: true, force: true });
