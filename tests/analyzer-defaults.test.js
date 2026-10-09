import { deepStrictEqual, strictEqual, ok, throws } from 'node:assert/strict';
import test from 'node:test';

import { parse } from 'espree';

import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';

import { put } from './support/collections.js';
import { counter } from './support/work.js';

const decisions = (source, options = {}) => {
    const analysis = createAnalysis({ source, ...options });
    const { declarations = [] } = analysis;

    return declarations.filter(({ kind = '' } = {}) => kind === 'Identifier').map(({ index = -1 } = {}) => analysis.checkDeclaration({ index }));
};
const required = (source, options = {}) => decisions(source, options).map(({ required: value = false } = {}) => value);

[
    ['an absent value needs an authored contract', 'const read = ({ title }) => title;', [true]],
    ['known input does not author a default', 'const { title } = { title: "ready" };', [true]],
    ['authored defaults', 'const read = ({ title = "", count = 0 } = {}) => title;', [false, false]],
    ['rest owns its collection', 'const read = ({ title = "", ...rest } = {}) => rest;', [false, false]],
    ['guarded optional callback', 'const run = ({ done }) => { if (typeof done !== "function") return; done(); };', [false]],
    ['predicate owns only the tested field, not its sibling',
        'const run = ({ done, other }) => { if (typeof done !== "function") return; other(); };', [false, true]],
    ['local destructuring creates distinct field capabilities',
        'const run = input => { const { done, other } = input; if (typeof done !== "function") return; done(); other(); };', [false, true]],
    ['a field is not an alias of its object',
        'const run = input => { const { done } = input; if (typeof input === "function") done(); };', [true]],
    ['a local collection callback keeps its declaration boundary',
        'const run = input => values => { const { done } = input; if (!isFunction(done)) return; return values.reduce(done); };', [false]],
    ['truthiness is not callability', 'const run = ({ done }) => { if (done) done(); };', [true]],
    ['returned capture retains the outer guard', 'const run = ({ done }) => { if (typeof done !== "function") return; return () => done(); };', [false]],
    ['an unguarded capture needs a contract', 'const run = ({ done }) => () => done();', [true]],
    ['guarded closure passed to an opaque call', 'const run = ({ done }) => { if (typeof done !== "function") return; register(() => done()); };', [false]],
    ['earlier unguarded closure cannot borrow a later guard', 'const run = ({ done }) => { register(() => done()); if (typeof done === "function") return []; };', [true]],
    ['argument mutation invalidates a captured guard', 'const run = ({ done }) => { if (typeof done !== "function") return; register(done = external, () => done()); };', [true]],
    ['receiver preserving call', 'const run = ({ done }) => { if (typeof done === "function") done.call(receiver); };', [false]],
    ['receiver preserving apply', 'const run = ({ done }) => { if (typeof done === "function") done.apply(receiver, args); };', [false]],
    ['an unguarded receiver call needs a contract', 'const run = ({ done }) => done.call(receiver);', [true]],
    ['a stable alias keeps capability identity', 'const run = ({ done }) => { const action = done; if (typeof action === "function") done(); };', [false]],
    ['writes invalidate callable proof', 'const run = ({ done }) => { if (typeof done === "function") { done = external; done(); } };', [true]],
    ['collection consumption has a local guard', 'const run = ({ done }) => { if (typeof done !== "function") return; return values.map(done); };', [false]],
    ['unguarded collection consumption', 'const run = ({ done }) => values.map(done);', [true]],
    ['guarded collection followed by a chain', 'const run = ({ done }) => { if (!isFunction(done)) return ""; return values.map(done).join(","); };', [false]],
    ['guarded invocation inside an object result', 'const run = ({ done }) => { if (typeof done !== "function") return {}; return { result: done() }; };', [false]],
    ['captured comparator guards at consumption', 'const sort = ({ compare }) => values => { if (typeof compare !== "function") return; return values.toSorted(compare); };', [false]],
    ['dynamic collection names provide no admission', 'const run = ({ done }) => { if (typeof done !== "function") return; return values[method](done); };', [true]],
    ['the documented state tuple', 'const [value, setValue] = useState(false);', [false, false]],
    ['guarded tuple cardinality', 'const read = tuple => { if (!isArray(tuple) || tuple.length < 2) return []; const [head, tail] = tuple; return [head, tail]; };', [false, false]],
    ['too little tuple evidence', 'const read = tuple => { if (!isArray(tuple) || tuple.length < 1) return []; const [head, tail] = tuple; return [head, tail]; };', [true, true]],
    ['an unrelated tuple is not guarded', 'const read = (tuple, other) => { if (!isArray(other) || other.length < 2) return []; const [head, tail] = tuple; return [head, tail]; };', [true, true]],
    ['arity selected rest tuple', 'function run(first, ...args) { switch (arguments.length) { case 2: { const [second] = args; return first(second); } default: return first; } }', [false]],
    ['mutated rest tuple cannot borrow entry arity',
        'function run(first, ...args) { args.pop(); switch (arguments.length) { case 2: { const [second] = args; return first(second); } } }', [true]],
    ['nested block cannot hide mutation before a rest tuple',
        'function run(...args) { switch (arguments.length) { case 1: { args.pop(); { const [first] = args; return first; } } } }', [true]],
    ['case statements cannot hide mutation before a rest tuple',
        'function run(...args) { switch (arguments.length) { case 1: args.pop(); { const [first] = args; return first; } } }', [true]],
    ['parameter initialization cannot manufacture entry arity',
        'function run(first = (arguments.length = 3), ...args) { switch (arguments.length) { case 3: { const [second, third] = args; return [second, third]; } } }', [true, true]],
    ['earlier declarators can invalidate tuple cardinality',
        'const read = tuple => { if (!isArray(tuple) || tuple.length < 2) return []; const removed = tuple.pop(), [head, tail] = tuple; return [head, tail]; };', [true, true]],
    ['earlier declarators can invalidate entry arity',
        'function run(...args) { switch (arguments.length) { case 1: { const removed = args.pop(), [first] = args; return first; } } }', [true]],
    ['arrow arguments belong to an enclosing function',
        'const run = (...args) => { switch (arguments.length) { case 1: { const [first] = args; return first; } } };', [true]],
    ['cardinality does not validate a nested pattern',
        'const read = tuple => { if (!isArray(tuple) || tuple.length < 1) return []; const [{ value }] = tuple; return value; };', [true]],
    ['an arbitrary result cannot justify a tuple',
        'const read = tuple => { if (!isArray(tuple) || tuple.length < 2) return external; const [head, tail] = tuple; return [head, tail]; };', [true, true]],
    ['same receiver lifted failure',
        'const read = M => tuple => { if (!isArray(tuple) || tuple.length < 2) return M.of([]); const [head, tail] = tuple; return M.of([head, tail]); };', [false, false]],
    ['different receiver lifted failure',
        'const read = (M, N) => tuple => { if (!isArray(tuple) || tuple.length < 2) return M.of([]); const [head, tail] = tuple; return N.of([head, tail]); };', [true, true]],
    ['field forwarding with explicit return', 'const forward = input => { return { reduce: (({ reduce: selected }) => selected)(input) }; };', [false]],
    ['equivalent concise field forwarding', 'const forward = input => ({ reduce: (({ reduce: selected }) => selected)(input) });', [false]],
    ['renamed field forwarding', 'const forward = input => ({ operation: (({ operation: selected }) => selected)(input) });', [false]],
    ['exact map projection', 'const project = values => values.map(value => (({ item: selected }) => selected)(value));', [false]],
    ['filter does not project the selected field', 'const project = values => values.filter(value => (({ item: selected }) => selected)(value));', [true]]
].forEach(([name = '', source = '', expected = []] = []) => test(`absence contract: ${name}`, () => deepStrictEqual(required(source), expected)));

const guarded = 'const consume = (value, action) => () => typeof action === "function" && action(value);';
[
    ['resolved consumer owns its guard', `${guarded} const run = ({ done }) => consume(1, done);`, [false]],
    ['immutable consumer alias', `${guarded} const alias = consume; const run = ({ done }) => alias(1, done);`, [false]],
    ['forwarded chain', `${guarded} const forward = action => consume(1, action); const run = ({ done }) => forward(done);`, [false]],
    ['unguarded consumer', 'const consume = action => action(); const run = ({ done }) => consume(done);', [true]],
    ['an effect-only consumer supplies no callable proof', 'const consume = action => { return; }; const run = ({ done }) => consume(done);', [true]],
    ['local name is no evidence', 'const flow = action => action(); const run = ({ done }) => flow(done);', [true]],
    ['unresolved syntax predicate cannot prove a consumer', 'const consume = action => isFunction(action) && action(); const run = ({ done }) => consume(done);', [true]],
    ['executable predicate helper', 'const callable = value => typeof value === "function"; const consume = action => callable(action) && action(); const run = ({ done }) => consume(done);', [false]],
    ['misleading predicate helper', 'const isFunction = value => true; const consume = action => isFunction(action) && action(); const run = ({ done }) => consume(done);', [true]],
    ['a property named arguments is ordinary data',
        'const consume = action => { const metadata = { arguments: [] }; if (typeof action === "function") action(metadata.arguments); }; const run = ({ done }) => consume(done);', [false]],
    ['numeric coercion cannot escape a consumer proof',
        'const consume = action => { +action; if (typeof action === "function") action(); }; const run = ({ done }) => consume(done);', [true]],
    ['consumer formal escapes', 'const consume = action => { external(action); if (typeof action === "function") action(); }; const run = ({ done }) => consume(done);', [true]],
    ['logical result escapes to the caller',
        'const consume = action => { if (typeof action === "function") action(); return action || false; }; const run = ({ done }) => consume(done);', [true]],
    ['logical result escapes to an unresolved consumer',
        'const consume = action => { external(action || false); if (typeof action === "function") action(); }; const run = ({ done }) => consume(done);', [true]],
    ['coalesced result escapes to an unresolved consumer',
        'const consume = action => { external(action ?? false); if (typeof action === "function") action(); }; const run = ({ done }) => consume(done);', [true]],
    ['nested logical result escapes in a record',
        'const consume = action => { external({ value: (action || false) && action }); if (typeof action === "function") action(); }; const run = ({ done }) => consume(done);', [true]],
    ['logical condition does not escape its value',
        'const consume = action => { if (action || false) log(); if (typeof action === "function") action(); }; const run = ({ done }) => consume(done);', [false]],
    ['discarded logical result does not escape its value',
        'const consume = action => { action || log(); if (typeof action === "function") action(); }; const run = ({ done }) => consume(done);', [false]],
    ['unprotected consumer use remains', 'const consume = action => { action(); if (typeof action === "function") action(); }; const run = ({ done }) => consume(done);', [true]],
    ['written consumer formal', 'const consume = action => { if (typeof action === "function") { action = external; action(); } }; const run = ({ done }) => consume(done);', [true]],
    ['shadowed consumer', `${guarded} const run = ({ done }, consume) => consume(1, done);`, [true]],
    ['cyclic forwarding cannot establish itself', 'const first = action => second(action); const second = action => first(action); const run = ({ done }) => second(done);', [true]],
    ['defaulted consumer formals are outside fixed forwarding', 'const consume = (action = false) => typeof action === "function" && action(); const run = ({ done }) => consume(done);', [true]],
    ['spread cannot select a fixed formal', `${guarded} const run = ({ done }) => consume(...values, done);`, [true]],
    ['eval cannot supply trustworthy consumption', 'const consume = action => { eval(source); if (typeof action === "function") action(); }; const run = ({ done }) => consume(done);', [true]]
].forEach(([name = '', source = '', expected = []] = []) => test(`consumer contract: ${name}`, () => deepStrictEqual(required(source), expected)));

test('imports select module bindings independently of nested same-named bindings', () => {
    const safe = 'action => { if (typeof action === "function") action(); }';
    const unsafe = 'action => action()';

    [true, false].forEach((guarded) => {
        const exported = guarded ? safe : unsafe;
        const shadow = guarded ? unsafe : safe;
        const sources = [
            `export const consume = ${exported}; { const consume = ${shadow}; }`,
            `const consume = ${exported}; { const consume = ${shadow}; } export { consume };`,
            `const consume = ${exported}; { const consume = ${shadow}; } export default consume;`
        ];

        sources.forEach((dependency, position) => {
            const selection = position === 2 ? 'consume' : '{ consume }';
            const source = `import ${selection} from "consumer"; const run = ({ done }) => consume(done);`;

            deepStrictEqual(required(source, { filename: 'main', resolveModule: () => ({ filename: 'consumer', source: dependency }) }), [!guarded]);
        });
    });
});

test('nested import shadows cannot disconnect an imported consumer', () => {
    const source = 'import { consume } from "consumer"; { const consume = action => action(); } const run = ({ done }) => consume(done);';
    const dependency = 'export const consume = action => { if (typeof action === "function") action(); };';

    deepStrictEqual(required(source, { filename: 'main', resolveModule: () => ({ filename: 'consumer', source: dependency }) }), [false]);
});

test('string-named imports and re-exports retain distinct export identities', () => {
    const sources = new Map([
        ['consumer', 'const unsafe = action => action(); const safe = action => { if (typeof action === "function") action(); }; export { unsafe as "unsafe-consumer", safe as "safe-consumer" };'],
        ['barrel', 'export { "unsafe-consumer" as "unsafe-relay", "safe-consumer" as "safe-relay" } from "consumer";']
    ]);
    const resolveModule = ({ source = '' } = {}) => ({ filename: source, source: sources.get(source) });

    ['unsafe', 'safe'].forEach((kind) => {
        [['consumer', 'consumer'], ['barrel', 'relay']].forEach(([module = '', suffix = ''] = []) => {
            const source = `import { "${kind}-${suffix}" as consume } from "${module}"; const run = ({ done }) => consume(done);`;

            deepStrictEqual(required(source, { filename: 'main', resolveModule }), [kind === 'unsafe']);
        });
    });
});

test('invalid module snapshots cannot manufacture an empty source or non-string identity', () => {
    const source = 'import { consume } from "consumer"; const run = ({ done }) => consume(done);';

    [{ filename: 'consumer' }, { filename: 42, source: '' }, { filename: {}, source: '' }].forEach((snapshot) => {
        throws(() => required(source, { resolveModule: () => snapshot }), TypeError);
    });
});

test('nested defaults are independent and field names grant no absence contract', () => {
    ['values', 'items', 'x'].forEach((name) => {
        const analysis = createAnalysis({ source: `const { ${name}: [first = ""] } = { ${name}: tuple };` });
        const findings = analysis.declarations.filter(({ index = -1 } = {}) => analysis.checkDeclaration({ index }).required);

        deepStrictEqual(findings.map(({ kind = '' } = {}) => kind), ['ArrayPattern']);
    });
});

test('consumer evidence is reused across callers without importing their actual values', () => {
    const source = `${guarded} consume(1, () => 1); consume(1, 42); ${Array.from({ length: 40 }, (_, index) => `const run${index} = ({ done }) => consume(${index}, done);`).join('\n')}`;
    const analysis = createAnalysis({ source });
    const work = counter();
    const results = analysis.declarations.map(({ index = -1 } = {}) => analysis.checkDeclaration({ index, onWork: event => work.onWork(event) }));

    ok(results.every(({ required = false } = {}) => !required));
    strictEqual(work.get('callable-consumer'), 1);
    analysis.declarations.forEach(({ index = -1 } = {}) => analysis.checkDeclaration({ index, onWork: event => work.onWork(event) }));
    strictEqual(work.get('callable-consumer'), 1);
    const unguarded = 'const consume = action => action(); consume(() => 1); const run = ({ done }) => consume(done);';

    deepStrictEqual(required(unguarded), [true]);
});

test('declaration results own their source snapshot and validate queries', () => {
    const program = parse(`${guarded} const run = ({ done }) => consume(1, done);`, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
    const analysis = createProgramAnalysis({ program });
    const [{ index = -1 } = {}] = analysis.declarations.filter(({ name = '' } = {}) => name === 'done');

    Object.defineProperty(program, 'body', { value: [] });
    const result = analysis.checkDeclaration({ index });

    const { required: missing = false, evidence = [] } = result;

    strictEqual(missing, false);
    ok(Object.isFrozen(result));
    ok(Object.isFrozen(evidence));
    strictEqual(analysis.checkDeclaration({ index }), result);
    [-1, NaN, '0', analysis.declarations.length].forEach(index => throws(() => analysis.checkDeclaration({ index }), RangeError));
    const fresh = createAnalysis({ source: `${guarded} const run = ({ done }) => consume(1, done);` });
    const failure = new Error('observer failure');

    throws(() => fresh.checkDeclaration({ index, onWork: () => { throw failure; } }), error => error === failure);
    strictEqual(fresh.checkDeclaration({ index }).required, false);
});

test('imported aliases and re-exports use source snapshots and refresh between analyses', () => {
    const sources = new Map([
        ['barrel', 'export { consume as dispatch } from "consumer";'],
        ['consumer', 'import { callable as check } from "predicate"; export const consume = (value, action) => () => check(action) && action(value);'],
        ['predicate', 'export const callable = value => typeof value === "function";']
    ]);
    const resolveModule = ({ source = '' } = {}) => sources.has(source) && { filename: source, source: sources.get(source) };
    const source = 'import { dispatch as imported } from "barrel"; const alias = imported; const run = ({ done }) => alias(1, done);';
    const options = { filename: 'main', resolveModule };
    const original = createAnalysis({ source, ...options });
    const { counts: { modules = 0 } = {} } = original;

    strictEqual(modules, 4, 'Acquisition counts include dependency snapshots');

    deepStrictEqual(required(source, options), [false]);
    put(sources, 'predicate', 'export const callable = value => true;');
    deepStrictEqual(required(source, options), [true]);
    const [{ index = -1 } = {}] = original.declarations.filter(({ name = '' } = {}) => name === 'done');

    strictEqual(original.checkDeclaration({ index }).required, false);
    deepStrictEqual(required(source), [true]);
    const failure = new Error('resolver failure');

    throws(() => required(source, { resolveModule: () => { throw failure; } }), error => error === failure);
});
