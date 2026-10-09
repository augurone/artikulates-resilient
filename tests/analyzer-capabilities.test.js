import { deepStrictEqual, strictEqual, ok } from 'node:assert/strict';
import test from 'node:test';

import { ESLint } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { counter } from './support/work.js';

const observed = (source) => {
    const analysis = createAnalysis({ source });
    const { invocations = [] } = analysis;

    return invocations.filter(({ optionalCallback = false } = {}) => optionalCallback)
        .map(({ index = -1 } = {}) => analysis.checkInvocation({ index }).status);
};

[
    ['selected branch', 'if (typeof onDone === "function") onDone();', ['agreement']],
    ['early exit', 'if (typeof onDone !== "function") return; onDone();', ['agreement']],
    ['logical guard', 'typeof onDone === "function" && onDone();', ['agreement']],
    ['negative disjunction', 'typeof onDone !== "function" || onDone();', ['agreement']],
    ['truthiness is insufficient', 'onDone && onDone();', ['contradiction']],
    ['guard comes too late', 'onDone(); if (typeof onDone !== "function") return;', ['contradiction']],
    ['sibling cannot borrow', 'if (typeof other === "function") onDone();', ['contradiction']],
    ['immutable alias', 'const callback = onDone; if (typeof callback === "function") onDone();', ['agreement']],
    ['alias use', 'const callback = onDone; if (typeof onDone === "function") callback();', ['agreement']],
    ['closure local guard', 'return () => { if (typeof onDone === "function") onDone(); };', ['agreement']],
    ['guarded closure creation', 'if (typeof onDone !== "function") return; return () => onDone();', ['agreement']],
    ['closure created before guard', 'const later = () => onDone(); if (typeof onDone !== "function") return; return later;', ['contradiction']],
    ['multiple capture levels', 'if (typeof onDone !== "function") return; return () => () => onDone();', ['agreement']],
    ['receiver preserved', 'if (typeof onDone === "function") onDone.call(receiver);', ['agreement']],
    ['receiver spelling proves nothing', 'onDone.call(receiver);', ['contradiction']],
    ['resolved predicate', 'const available = candidate => typeof candidate === "function"; if (available(onDone)) onDone();', ['agreement']],
    ['canonical predicate', 'const available = candidate => candidate && typeof candidate === "function"; if (available(onDone)) onDone();', ['agreement']],
    ['negative predicate', 'const absent = candidate => typeof candidate !== "function"; if (!absent(onDone)) onDone();', ['agreement']],
    ['statement predicate proof', 'const available = candidate => { if (typeof candidate !== "function") return false; return true; }; if (available(onDone)) onDone();', ['agreement']],
    ['shadowed false predicate', 'const isFunction = candidate => true; if (isFunction(onDone)) onDone();', ['contradiction']],
    ['documented external predicate', 'if (isFunction(onDone)) onDone();', ['agreement']],
    ['finally can replace the guard exit', 'try { if (typeof onDone !== "function") return; } finally { onDone(); }', ['contradiction']],
    ['throwing guard', 'if (typeof onDone !== "function") throw new TypeError(); onDone();', ['agreement']]
].forEach(([name = '', body = '', expected = []] = []) => test(`callability evidence: ${name}`, () => {
    deepStrictEqual(observed(`const run = ({ onDone, other } = {}) => { ${body} };`), expected);
}));

test('caller order and selected successful invocations do not repair an unguarded callee', () => {
    const source = 'const run = ({ onDone } = {}) => onDone(); run({ onDone: () => {} }); run({});';
    const analysis = createAnalysis({ source });
    const { invocations: [invocation = {}] = [], calls = [], functions = [] } = analysis;
    const first = analysis.checkInvocation(invocation);
    const { status = '' } = first;

    calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
    functions.forEach(({ index = -1 } = {}) => analysis.checkFunction({ index }));
    strictEqual(status, 'contradiction');
    deepStrictEqual(analysis.checkInvocation(invocation), first);
});

test('declaration evidence preserves independent absence decisions and does not invent defaults', () => {
    const source = 'const run = ({ onDone, count = 0, nested: { label = "" } = {}, ...rest } = {}) => { if (typeof onDone === "function") onDone(); };';
    const analysis = createAnalysis({ source });
    const { declarations = [] } = analysis;

    deepStrictEqual(declarations.map(({ name = '', kind = '', absence = '' } = {}) => [name || kind, absence]), [
        ['ObjectPattern', 'default'], ['onDone', 'undeclared'], ['count', 'default'],
        ['ObjectPattern', 'default'], ['label', 'default'], ['rest', 'rest']
    ]);
    ok(Object.isFrozen(declarations));
    declarations.forEach(declaration => ok(Object.isFrozen(declaration)));
    deepStrictEqual(observed(source), ['agreement']);
    strictEqual(declarations.at(1).absence, 'undeclared', 'A guard proves use, never an authored default');
});

test('shadowing and writes cannot borrow a different binding guard', () => {
    deepStrictEqual(observed('const run = ({ onDone } = {}) => { if (typeof onDone !== "function") return; const nested = ({ onDone } = {}) => onDone(); };'), ['contradiction']);
    const analysis = createAnalysis({ source: 'const run = ({ onDone } = {}) => { if (typeof onDone !== "function") return; onDone = external; onDone(); };' });
    const { invocations: [invocation = {}] = [] } = analysis;
    const { optionalCallback = false } = invocation;

    strictEqual(optionalCallback, true, 'Loss of proof must not erase declaration ownership');
    strictEqual(analysis.checkInvocation(invocation).status, 'contradiction', 'callable gives the reached write a new callable decision');
});

test('syntax-only predicate admission does not collapse independent producer return paths', () => {
    const source = 'const read = ({ onDone } = {}) => { if (isFunction(onDone)) return []; if (!isFunction(onDone)) return ""; return 42; };';
    const analysis = createAnalysis({ source });
    const { fact: { families = [] } = {} } = analysis.checkFunction({ index: 0 });

    deepStrictEqual(families.toSorted(), ['array', 'number', 'string']);
    deepStrictEqual(observed('import { isFunction } from "external"; const run = ({ onDone } = {}) => { if (isFunction(onDone)) onDone(); };'), ['agreement']);
});

test('actual invocation contexts cannot supply a generic closure-creation proof', () => {
    const source = 'const make = ({ onDone } = {}) => () => onDone(); make({ onDone: () => {} });';
    const analysis = createAnalysis({ source });
    const { calls = [], invocations = [] } = analysis;

    calls.forEach(({ index = -1 } = {}) => analysis.checkCallResult({ index, required: 'function' }));
    const invocation = invocations.find(({ optionalCallback = false } = {}) => optionalCallback);

    strictEqual(analysis.checkInvocation(invocation).status, 'contradiction');
});

test('four evidence rules share acquisition, preserve exact invocation locations, and refresh on the next lint', async () => {
    const reads = counter();
    const injector = { rules: { observe: { create() {
        return { 'Program:exit'({ body: [{ declarations: [{ init = {} } = {}] = [] } = {}] = [] } = {}) {
            const { params = [] } = init;

            Object.defineProperty(init, 'params', { get() {
                reads.increment('parameters');

                return params;
            } });
        } };
    } } } };
    const engine = new ESLint({ overrideConfigFile: true, fix: true, overrideConfig: [{
        plugins: { injector, resilient: plugin }, rules: {
            'injector/observe': 'error',
            ...Object.fromEntries(['signature-contract-destructuring', 'signature-contract-call-site',
                'signature-contract-return-consistency', 'no-unguarded-callback-invocation'].map(name => [`resilient/${name}`, 'error']))
        }
    }] });
    const guarded = 'const run = ({ onDone } = {}) => { if (typeof onDone === "function") onDone(); }; run({});';
    const unsafe = 'const run = ({ onDone } = {}) => { onDone(); }; run({});';
    const [first = {}] = await engine.lintText(guarded);
    const { messages: firstMessages = [] } = first;

    deepStrictEqual(firstMessages, []);
    strictEqual(reads.get('parameters'), 2);
    const [second = {}] = await engine.lintText(unsafe);
    const { messages = [] } = second;
    const [finding = {}] = messages;
    const { ruleId = '', messageId = '', column = 0, endColumn = 0 } = finding;

    strictEqual(messages.length, 1);
    strictEqual(ruleId, 'resilient/no-unguarded-callback-invocation');
    strictEqual(messageId, 'unguarded');
    strictEqual(unsafe.slice(column - 1, endColumn - 1), 'onDone()');
    strictEqual(Object.hasOwn(second, 'output'), false, 'The guard rule must not synthesize behavior');
    strictEqual(reads.get('parameters'), 4);
});

test('shared capture proofs have bounded work and repeated queries add no acquisition', () => {
    const uses = 200;
    const source = `const make = ({ onDone } = {}) => { if (typeof onDone !== 'function') return; return () => { ${'onDone();'.repeat(uses)} }; };`;
    const analysis = createAnalysis({ source });
    const { invocations = [] } = analysis;
    const work = counter();
    const inspect = () => invocations.forEach(({ index = -1 } = {}) => strictEqual(analysis.checkInvocation({ index, onWork: event => work.onWork(event) }).status, 'agreement'));

    inspect();
    const counts = work.read();

    ok(work.get('capture-proof') <= 2);
    ok(work.get('capability-use') <= uses);
    inspect();
    deepStrictEqual(work.read(), counts);
});
