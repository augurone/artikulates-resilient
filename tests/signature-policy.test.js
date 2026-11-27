import { deepStrictEqual, strictEqual, ok, throws } from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { Linter, ESLint } from 'eslint';
import { parse } from 'espree';

import { createAnalysis, createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';
import { isFunction } from 'eslint-plugin-resilient/standard/function';

import { put, append } from './support/collections.js';
import { counter } from './support/work.js';

// Authored defaults and generic consumer obligations share guard/placement ownership; native rewrite/failure observations, source revisions and guarded versus unsafe neighbors remain.
const outputForShared = (source, { fix: { range: [start = 0, end = 0] = [], text = '' } = {} } = {}) => source.slice(0, start) + text + source.slice(end);

{
    const decisions = (source, options = {}) => {
        const analysis = createAnalysis({ source, ...options });
        const { declarations = [] } = analysis;

        return declarations.filter(({ kind = '' } = {}) => kind === 'Identifier').map(({ index = -1 } = {}) => analysis.checkDeclaration({ index }));
    };
    const required = (source, options = {}) => decisions(source, options).map(({ required: value = false } = {}) => value);

    const guarded = 'const consume = (value, action) => () => typeof action === "function" && action(value);';

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
}

{
    const examples = [
        { name: 'no-null-assignment', source: 'const value=null;' },
        { name: 'no-undefined-assignment', source: 'const value=undefined;' },
        { name: 'no-undefined-comparison', source: 'value===undefined;' },
        { name: 'no-destructuring-fallback', source: 'const {}=value||{};' },
        { name: 'prefer-destructured-member-access', source: 'const read=value=>value.field;' },
        { name: 'prefer-signature-destructuring', source: 'const read=value=>{const {field=1}=value;return field;};' },
        { name: 'prefer-safe-destructuring-defaults', source: 'const read=({field}={})=>String(field);' }
    ];
    const names = examples.map(({ name = '' } = {}) => name);
    const rulesFor = selected => Object.fromEntries(selected.map(name => [`resilient/${name}`, 'error']));
    const lint = (source, selected = names, options = {}) => new Linter().verify(source, {
        plugins: { resilient: plugin }, rules: rulesFor(selected), ...options
    });
    const outputFor = outputForShared;

    examples.forEach(({ name = '', source = '' } = {}) => {
        const rule = `resilient/${name}`;

        test(`rule configuration: ${name}`, () => {
            const { rules = {}, configs: { recommended = {} } = {} } = plugin;
            const { meta: { docs: { url = '' } = {}, fixable = false } = {} } = Reflect.get(rules, name);

            strictEqual(url, `https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/${name}.md`);
            strictEqual(fixable, false);
            deepStrictEqual(lint(source, [name], { rules: { [rule]: 'off' } }), []);
            const warning = lint(source, [name], { rules: { [rule]: 'warn' } });
            const error = lint(source, [name]);

            strictEqual(warning.length, 1);
            strictEqual(error.length, 1);
            strictEqual(warning.at(0).severity, 1);
            strictEqual(error.at(0).severity, 2);
            ok(new Linter().verify(source, recommended).some(({ ruleId = '' } = {}) => ruleId === rule));
            const { output = '', fixed = false } = new Linter().verifyAndFix(source, { plugins: { resilient: plugin }, rules: { [rule]: 'error' } });

            strictEqual(output, source);
            strictEqual(fixed, false);
        });

        test(`local exception ownership: ${name}`, () => {
            const engine = new Linter();
            const findings = engine.verify(`// eslint-disable-next-line ${rule} -- Deliberate negative fixture.\n${source}`,
                { plugins: { resilient: plugin }, rules: { [rule]: 'error' } });

            deepStrictEqual(findings, []);
            const suppressed = engine.getSuppressedMessages();

            strictEqual(suppressed.length, 1);
            strictEqual(suppressed.at(0).ruleId, rule);
        });
    });

    test('receiver syntax preserves independent call requirements', () => {
        const source = 'const read=({items=[]}={})=>items.map(value=>value);read({items:""});read(external);';
        const analysis = createAnalysis({ source });
        const { calls = [] } = analysis;
        const selected = calls.filter(({ callee = '' } = {}) => callee === 'read');

        strictEqual(selected.length, 2);
        deepStrictEqual(selected.map(({ index = -1 } = {}) => analysis.checkCall({ index }).status), ['contradiction', 'unknown']);
        deepStrictEqual(lint(source), []);
        const findings = lint(source, [...names, 'signature-contract-call-site']);

        strictEqual(findings.length, 1);
        strictEqual(findings.at(0).ruleId, 'resilient/signature-contract-call-site');
    });

    test('signature suggestions preserve failure, getters and authored defaults', () => {
        [
            'const read=input=>{const {field=1}=input;return field;};',
            'const read=(input={})=>{const {field=1}=input;return field;};',
            'const read=(input,other)=>{const {field=1}=input;return [field,other];};'
        ].forEach((source) => {
            const [{ suggestions = [] } = {}] = lint(source, ['prefer-signature-destructuring']);

            strictEqual(suggestions.length, 1);
            const moved = outputFor(source, suggestions.at(0));
            const execute = program => runInNewContext(`${program}
            const events=[], failure={};
            const supplied={get field(){events.push('get');return false;}};
            const throwing={get field(){throw failure;}};
            const results=[[],[void 0],[null],[{}],[{field:0}],[{field:null}],[supplied],[throwing]].map(args=>{
                try{return {value:read(...args)};}catch(error){return {failure:error===failure,name:error.name};}
            });
            JSON.stringify({results,events,length:read.length});`);

            strictEqual(execute(moved), execute(source));
            const { output = '', messages = [] } = new Linter().verifyAndFix(moved, { plugins: { resilient: plugin }, rules: rulesFor(names) });

            strictEqual(output, moved);
            strictEqual(execute(output), execute(source));
            deepStrictEqual(messages, []);
        });
    });
}

{
    const filename = fileURLToPath(import.meta.url);
    const resolveGuard = ({ source = '' } = {}) => source === 'eslint-plugin-resilient/standard/function'
        ? fileURLToPath(import.meta.resolve(source)) : '';
    const configuration = { settings: { resilient: { resolver: resolveGuard } }, plugins: { resilient: plugin }, rules: {
        'resilient/prefer-safe-destructuring-defaults': 'error',
        'resilient/no-unguarded-callback-invocation': 'error',
        'resilient/signature-contract-destructuring': 'error',
        'resilient/signature-contract-operation': 'error'
    } };
    const lint = source => new Linter().verify(source, configuration, { filename });
    const imported = "import { isFunction as callable } from 'eslint-plugin-resilient/standard/function';";

    [
        ['unrelated parameter initialization', 'const run=(owner={},state=createState())=>{const {onDone}=owner;if(callable(onDone))onDone.call(owner);};'],
        ['callback beside parameter initialization', 'const run=({onDone,state=createState()}={})=>{if(callable(onDone))onDone();};'],
        ['member callback capture', 'const run=({onDone}={})=>{if(!callable(onDone))return;values.map(()=>onDone());};'],
        ['constructor argument callback', 'const run=({onDone}={})=>{if(!callable(onDone))return;return new Map(values.map(()=>onDone()));};'],
        ['nested constructor argument callback', 'const run=({onDone}={})=>new Map(values.map(value=>{if(!callable(onDone))return [];return [value,new Map(others.map(()=>onDone()))];}));'],
        ['guarded loop use', 'const run=(owner={})=>{const {onDone}=owner;while(more()){if(callable(onDone))onDone();}};'],
        ['optional method', 'const run=(owner={})=>{const {onDone}=owner;if(callable(onDone))onDone.call(owner);};'],
        ['guard inside closure', 'const run=(owner={})=>{const {onDone}=owner;return ()=>callable(onDone)?onDone():false;};'],
        ['predicate-only use', 'const run=(owner={})=>{const {onDone}=owner;return callable(onDone);};'],
        ['optional callback', 'const run=({onDone}={})=>{if(callable(onDone))onDone(1);};'],
        ['required callback', 'const run=({onDone}={})=>{if(!callable(onDone))throw new TypeError("Required callback");onDone(1);};'],
        ['captured callback', 'const run=({onDone}={})=>{if(!callable(onDone))return;return ()=>onDone(1);};'],
        ['receiver call', 'const run=({onDone}={})=>{if(callable(onDone))onDone.call(receiver,1);};'],
        ['receiver apply', 'const run=({onDone}={})=>{if(callable(onDone))onDone.apply(receiver,[1]);};']
    ].forEach(([name = '', source = ''] = []) => test(`public callable guard owns natural absence: ${name}`, () => {
        deepStrictEqual(lint(`${imported}${source}`), []);
    }));

    test('a guarded call does not excuse another unguarded invocation', () => {
        const source = `${imported}const run=({onDone}={})=>{if(callable(onDone))onDone(1);onDone(2);};`;
        const findings = lint(source);

        deepStrictEqual(findings.map(({ ruleId = '' } = {}) => ruleId), ['resilient/no-unguarded-callback-invocation']);
    });

    test('a locally misleading predicate cannot borrow the standard helper contract', () => {
        const source = 'const isFunction=value=>true;const run=({onDone}={})=>{if(isFunction(onDone))onDone(1);};';

        deepStrictEqual(lint(source).map(({ ruleId = '' } = {}) => ruleId), [
            'resilient/prefer-safe-destructuring-defaults', 'resilient/no-unguarded-callback-invocation'
        ]);
    });

    test('public guards preserve a single property read, the receiver, arguments, return and thrown identity', () => {
        let events = [];
        const failure = new Error('owned call failure');
        const result = Object.freeze({ value: 3 });
        const invoke = (owner, ...args) => {
            const { onDone } = owner;

            if (!isFunction(onDone)) return false;

            return onDone.apply(owner, args);
        };
        const owner = { get onDone() {
            events = [...events, 'get'];

            // eslint-disable-next-line no-restricted-syntax -- The callback oracle verifies apply preserves the owner receiver and supplied arguments.
            return function (...args) {
                strictEqual(this, owner);
                deepStrictEqual(args, [1, 2]);
                events = [...events, 'call'];

                return result;
            };
        } };

        strictEqual(invoke(owner, 1, 2), result);
        deepStrictEqual(events, ['get', 'call']);
        // eslint-disable-next-line resilient/no-null-assignment -- The native callback guard must reject supplied null along with the other noncallable values.
        [null, false, 0, '', {}, []].forEach(onDone => strictEqual(invoke({ onDone }), false));
        strictEqual(invoke({}), false);
        throws(() => invoke({ get onDone() { throw failure; } }), error => error === failure);
        throws(() => invoke({ onDone() { throw failure; } }), error => error === failure);
    });

    test('callable absence does not relax a null receiver or an unrelated required field', () => {
        const source = `${imported}const run=()=>{const {onDone}=null;if(callable(onDone))onDone();};`;
        const unrelated = `${imported}const run=(owner={})=>{const {onDone,other}=owner;if(callable(onDone))onDone();return other;};`;

        strictEqual(lint(source).some(({ messageId = '' } = {}) => messageId === 'mismatch'), true);
        strictEqual(lint(unrelated).some(({ message = '' } = {}) => message.includes('Property other')), true);
    });

    [16, 32, 64].forEach(width => test(`callable absence shares guard evidence across ${width} fields`, (context) => {
        const names = Array.from({ length: width }, (value, index) => `field${index}`);
        const source = `const isFunction=value=>typeof value==='function';const run=(owner={})=>{const {${names.join(',')}}=owner;`
            + `return [${names.map(name => `isFunction(${name})`).join(',')}];};`;
        const analysis = createAnalysis({ source });
        const declarations = analysis.declarations.filter(({ name = '' } = {}) => names.includes(name));
        const work = counter();
        const { onWork = () => {} } = work;

        declarations.forEach(({ index = -1 } = {}) => strictEqual(analysis.checkDeclaration({ index, onWork }).required, false));
        analysis.destructuringFields.forEach(({ index = -1 } = {}) => {
            const { status = '', fact: { presence = [] } = {} } = analysis.checkDestructuringField({ index, onWork });

            strictEqual(status === 'contradiction', false);
            strictEqual(presence.includes('absent'), true);
        });
        const before = work.read();

        declarations.toReversed().forEach(({ index = -1 } = {}) => analysis.checkDeclaration({ index, onWork }));
        deepStrictEqual(work.read(), before);
        context.diagnostic(JSON.stringify({ width, ...before }));
    }));

    test('body guard evidence does not fabricate an initialized source or return contract', () => {
        const source = "const callable=value=>typeof value==='function';const run=(owner={},state=createState())=>{"
            + 'const {onDone}=owner;if(callable(onDone))onDone.call(owner);return state;};';
        const analysis = createAnalysis({ source });
        const { index = -1 } = analysis.functions.at(1);
        const { status = '', fact: { incomplete = false } = {} } = analysis.checkFunction({ index });

        strictEqual(status, 'unknown');
        strictEqual(incomplete, true);
        deepStrictEqual(lint(source), []);
    });

    test('the shipped tuple transformer retains guards beside its actual constructor defaults', async () => {
        const sourceFile = fileURLToPath(new URL('./grammar/curried-selected-tuple.js', import.meta.resolve('eslint-plugin-resilient/typescript')));
        const virtualFile = fileURLToPath(new URL('callable-tuple-input.js', import.meta.url));
        const resolver = ({ from = '', source = '' } = {}) => source.startsWith('.')
            ? resolve(dirname(from === virtualFile ? sourceFile : from), source) : resolveGuard({ source });
        const engine = new ESLint({ overrideConfigFile: true, overrideConfig: [{ ...configuration, settings: { resilient: { resolver } } }] });
        const [{ messages = [] } = {}] = await engine.lintText(readFileSync(sourceFile, 'utf8'), { filePath: virtualFile });

        deepStrictEqual(messages, []);
    });

    test('an initializer write cannot borrow a guard on the captured callback', () => {
        const source = 'const run=({onDone}={})=>{const read=({value=void(onDone=external)}={})=>value;'
            + 'if(typeof onDone!=="function")return;read();onDone();};';
        const analysis = createAnalysis({ source });
        const { index = -1 } = analysis.declarations.find(({ name = '' } = {}) => name === 'onDone');

        strictEqual(analysis.checkDeclaration({ index }).required, true);
    });

    test('member-call arguments cannot invalidate a guard and lend it to a later closure', () => {
        const source = 'const run=({onDone}={})=>{if(typeof onDone!=="function")return;'
            + 'host.register(onDone=external,()=>onDone());};';

        strictEqual(lint(source).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true);
    });

    test('constructor arguments retain native failure order without borrowing ordinary call semantics', () => {
        const setup = 'const stop=()=>{throw 1;};const later=()=>"late";';
        const bodies = ['new (function(){return "wrong";})(stop(),later())', 'new (stop())(later())', 'new (()=>"wrong")(stop(),later())'];

        bodies.forEach((body) => {
            const source = `${setup}const read=()=>${body};`;
            const analysis = createAnalysis({ source });
            const { index = -1 } = analysis.functions.at(2);
            const work = counter();
            const { normal = true, thrown = false, fact: { families = [] } = {} } = analysis.checkFunction({ index, onWork: event => work.onWork(event) });

            throws(() => runInNewContext(`${source}read();`), error => error === 1);
            deepStrictEqual({ normal, thrown, families }, { normal: false, thrown: true, families: [] });
            strictEqual(work.get('function-context'), 2);
        });
        const analysis = createAnalysis({ source: 'const read=()=>new (function(){return "wrong";})();' });
        const { status = '', fact: { families = [] } = {} } = analysis.checkFunction({ index: 0 });

        strictEqual(status, 'unknown');
        deepStrictEqual(families, []);
    });

    test('a write in a constructor argument invalidates a captured callback guard', () => {
        const source = 'const run=({onDone}={})=>{if(typeof onDone!=="function")return;'
            + 'new Factory(onDone=external,()=>onDone());};';

        strictEqual(lint(source).some(({ messageId = '' } = {}) => messageId === 'safeDefault'), true);
    });

    test('loop branch evidence stays local and cannot establish completion or survive callback mutation', () => {
        const bodies = [
            'if(typeof onDone==="function")onDone();if(external)onDone();',
            'if(typeof onDone!=="function")onDone();',
            'if(typeof other==="function")onDone();',
            'if(typeof onDone==="function"){onDone=external;onDone();}'
        ];

        bodies.forEach((body) => {
            const analysis = createAnalysis({ source: `const run=({onDone,other}={})=>{while(external){${body}}};` });
            const invocations = analysis.invocations.filter(({ name = '' } = {}) => name === 'onDone');
            const { index = -1 } = invocations.at(-1);

            strictEqual(analysis.checkInvocation({ index }).status === 'agreement', false);
            const { status = '', fact: { families = [] } = {} } = analysis.checkFunction({ index: 0 });

            strictEqual(status, 'unknown');
            deepStrictEqual(families, []);
        });
    });

    [16, 32, 64].forEach(width => test(`loop guard demand shares ${width} acquired branches without expanding loop outcomes`, (context) => {
        const body = Array.from({ length: width }, () => 'if(typeof onDone==="function")onDone();').join('');
        const analysis = createAnalysis({ source: `const run=({onDone}={})=>{while(external){${body}}};` });
        const invocations = analysis.invocations.filter(({ name = '' } = {}) => name === 'onDone');
        const work = counter();

        invocations.forEach(({ index = -1 } = {}) => strictEqual(analysis.checkInvocation({ index, onWork: event => work.onWork(event) }).status, 'agreement'));
        const before = work.read();

        invocations.toReversed().forEach(({ index = -1 } = {}) => analysis.checkInvocation({ index, onWork: event => work.onWork(event) }));
        deepStrictEqual(work.read(), before);
        context.diagnostic(JSON.stringify({ width, ...before }));
    }));
}

{
    const guardRule = 'no-unguarded-callback-invocation';
    const returnRule = 'signature-contract-return-consistency';
    const callRule = 'signature-contract-call-site';
    const lint = (source, names = [guardRule]) => new Linter().verify(source, {
        plugins: { resilient: plugin }, rules: Object.fromEntries(names.map(name => [`resilient/${name}`, 'error']))
    });
    const callbacks = analysis => analysis.invocations.filter(({ optionalCallback = false } = {}) => optionalCallback);
    const statuses = analysis => callbacks(analysis).map(({ index = -1 } = {}) => analysis.checkInvocation({ index }).status);

    [
        ['stale guard', 'if(typeof done==="function"){done=external;done();}', ['contradiction']],
        ['fresh guard', 'done=external;if(typeof done==="function")done();', ['agreement']],
        ['fresh nested guard', 'if(typeof done==="function"){done=external;if(typeof done==="function")done();}', ['agreement']],
        ['early exit guard', 'done=external;if(typeof done!=="function")return;done();', ['agreement']],
        ['earlier invocation', 'if(typeof done==="function"){done();done=external;}', ['agreement']],
        ['conditional write', 'if(typeof done==="function"){if(flag)done=external;done();}', ['contradiction']],
        ['terminated write path', 'if(typeof done==="function"){if(flag){done=external;return;}done();}', ['agreement']],
        ['thrown write path', 'if(typeof done==="function"){if(flag){done=external;throw 0;}done();}', ['agreement']],
        ['unreachable write', 'if(typeof done==="function"){if(false)done=external;done();}', ['agreement']],
        ['successive writes', 'done=first;if(typeof done!=="function")return;done=second;done();', ['contradiction']],
        ['successive guards', 'done=first;if(typeof done!=="function")return;done=second;if(typeof done==="function")done();', ['agreement']],
        ['joined guards', 'if(flag){done=first;}else{done=second;}if(typeof done==="function")done();', ['agreement']],
        ['independent return', 'if(flag)return;done=external;if(typeof done==="function")done();', ['agreement']],
        ['later finalizer', 'if(typeof done==="function"){try{done();}finally{done=external;}}', ['agreement']],
        ['earlier finalizer', 'if(typeof done==="function"){try{}finally{done=external;}done();}', ['contradiction']],
        ['captured stale guard', 'if(typeof done==="function"){const invoke=()=>done();done=external;return invoke;}', ['contradiction']],
        ['capture after early exit before a later write', 'if(typeof done!=="function")return;const invoke=()=>done();done=external;return invoke;', ['contradiction']],
        ['early exit capture after final write', 'done=external;if(typeof done!=="function")return;const invoke=()=>done();return invoke;', ['agreement']],
        ['captured local guard', 'done=external;return ()=>{if(typeof done==="function")done();};', ['agreement']],
        ['capture after final write', 'done=external;if(typeof done==="function")return ()=>done();', ['agreement']],
        ['unreachable write preserves capture', 'if(typeof done==="function"){if(false)done=external;return ()=>done();}', ['agreement']],
        ['opposite write path preserves capture', 'if(typeof done==="function"){if(flag){done=external;return;}return ()=>done();}', ['agreement']],
        ['suspended mutable capture', 'const invoke=async()=>{if(typeof done==="function"){await wait;done();}};done=external;return invoke;', ['unknown']],
        ['mutable alias has its own guard', 'const alias=done;done=external;if(typeof alias==="function")alias();', ['agreement']],
        ['alias cannot guard new value', 'const alias=done;done=external;if(typeof alias==="function")done();', ['contradiction']],
        ['new value cannot guard alias', 'const alias=done;done=external;if(typeof done==="function")alias();', ['contradiction']],
        ['unresolved stale predicate', 'if(isFunction(done)){done=external;done();}', ['contradiction']],
        ['unresolved fresh predicate', 'done=external;if(isFunction(done))done();', ['agreement']],
        ['unresolved successive predicate', 'if(isFunction(done)){done=external;if(isFunction(done))done();}', ['agreement']],
        ['capture after syntax guard and final write', 'done=external;if(isFunction(done))return ()=>done();', ['agreement']],
        ['syntax capture before later write', 'if(isFunction(done)){const invoke=()=>done();done=external;return invoke;}', ['contradiction']],
        ['receiver call', 'done=external;if(typeof done==="function")done.call(receiver);', ['agreement']],
        ['receiver apply', 'if(typeof done==="function"){done=external;done.apply(receiver,args);}', ['contradiction']],
        ['unsupported compound write', 'if(typeof done==="function"){done+=external;done();}', ['unknown']],
        ['unsupported expression write', 'if(typeof done==="function"){(done=external,done());}', ['unknown']],
        ['unsupported captured write', 'const change=()=>{done=external;};if(typeof done==="function"){change();done();}', ['unknown']],
        ['unsupported repeated write', 'do{done=external;}while(flag);if(typeof done==="function")done();', ['unknown']]
    ].forEach(([name = '', body = '', expected = []] = []) => test(`callback revision: ${name}`, () => {
        const source = `const run=({done}={})=>{${body}};`;
        const analysis = createAnalysis({ source });

        deepStrictEqual(statuses(analysis), expected);
        const direct = callbacks(analysis).filter(({ direct = false } = {}) => direct);

        strictEqual(lint(source).length, direct.filter(({ index = -1 } = {}) => analysis.checkInvocation({ index }).status === 'contradiction').length);
        const engine = new Linter();
        const { output = '', fixed = false } = engine.verifyAndFix(source, { plugins: { resilient: plugin }, rules: { [`resilient/${guardRule}`]: 'error' } });

        strictEqual(output, source);
        strictEqual(fixed, false);
    }));

    [
        ['value=>true', 'contradiction'],
        ['()=>({})', 'unknown'],
        ['()=>()=>0', 'contradiction'],
        ['async value=>typeof value==="function"', 'contradiction'],
        ['function*(value){return typeof value==="function";}', 'contradiction'],
        ['value=>typeof value==="function"', 'agreement'],
        ['value=>value&&typeof value==="function"', 'agreement'],
        ['value=>external(value)', 'unknown']
    ].forEach(([helper = '', expected = ''] = []) => test(`helper evidence: ${helper}`, () => {
        const source = `const isFunction=${helper};const run=({done}={})=>isFunction(done)&&done();`;

        deepStrictEqual(statuses(createAnalysis({ source })), [expected]);
        strictEqual(lint(source).length, Number(expected === 'contradiction'));
    }));

    ['()=>[]', 'function named(){return [];}'].forEach(fallback => test(`authored default and supplied value: ${fallback}`, () => {
        const source = `const read=(cb=${fallback})=>cb();read();read(void 0);read(()=>"");read(external);`;
        const analysis = createAnalysis({ source });
        const calls = analysis.calls.filter(({ callee = '' } = {}) => callee === 'read');

        deepStrictEqual(calls.map(({ index = -1 } = {}) => analysis.checkCallResult({ index, required: 'array' }).status), ['agreement', 'agreement', 'contradiction', 'unknown']);
        strictEqual(analysis.checkFunction({ index: 0 }).status, 'unknown');
    }));

    [
        'const read=(cb=()=>0)=>{if(flag)return [];return "";};',
        'const read=(cb=function(){return 0;})=>{if(flag)return [];return "";};',
        'const read=({cb=()=>0}={})=>{if(flag)return [];return "";};',
        'const read=(cb=async()=>0)=>{if(flag)return [];return "";};'
    ].forEach(source => test(`default creation preserves enclosing contradictions: ${source}`, () => {
        const analysis = createAnalysis({ source });

        strictEqual(analysis.checkFunction({ index: 0 }).status, 'contradiction');
        strictEqual(lint(source, [returnRule]).length, 2);
    }));

    test('acquired default body keeps its own diagnostics and forwarded call origin', () => {
        const source = 'const read=(cb=(value="")=>value)=>cb(42);read();';
        const findings = lint(source, [callRule]);

        strictEqual(findings.length, 1);
        const [{ column = 0, endColumn = 0, message = '' } = {}] = findings;

        strictEqual(source.slice(column - 1, endColumn - 1), 'read()');
        strictEqual(message, 'argument expects string-like, but this call supplies number-like.');
        const nested = 'const read=(cb=flag=>flag?[]:"")=>cb;';

        strictEqual(createAnalysis({ source: nested }).checkFunction({ index: 1 }).status, 'contradiction');
        strictEqual(lint(nested, [returnRule]).length, 2);
    });

    test('authored function contract does not validate supplied nonfunctions', () => {
        const source = 'const read=(cb=()=>[])=>cb();read(42);read(null);read(external);read(()=>[]);';
        const findings = lint(source, [callRule]);

        deepStrictEqual(findings.map(({ column = 0, endColumn = 0 } = {}) => source.slice(column - 1, endColumn - 1)), ['cb()', '42', 'null']);
    });

    test('parameter closure does not resolve names from body declarations', () => {
        const source = 'const value=[];const read=(cb=()=>value)=>{const value="";return cb();};read();';
        const analysis = createAnalysis({ source });
        const [{ index = -1 } = {}] = analysis.calls.filter(({ callee = '' } = {}) => callee === 'read');
        const { status = '', fact: { causes = [] } = {} } = analysis.checkCallResult({ index, required: 'array' });

        strictEqual(runInNewContext(`${source.slice(0, -7)}JSON.stringify(read());`), '[]');
        strictEqual(status, 'unknown');
        ok(causes.some(({ code = '' } = {}) => code === 'captured-value'));
    });

    test('product queries are independent of query order and later source revisions', () => {
        const source = 'const run=({done}={})=>{done=external;if(typeof done!=="function")return;done();done=other;done();};';
        const inspect = (analysis, reverse = false) => {
            const queries = [
                ...analysis.calls.map(({ index = -1 } = {}) => () => analysis.checkCall({ index })),
                ...analysis.calls.map(({ index = -1 } = {}) => () => analysis.checkCallResult({ index, required: 'array' })),
                ...analysis.functions.map(({ index = -1 } = {}) => () => analysis.checkFunction({ index })),
                ...analysis.invocations.map(({ index = -1 } = {}) => () => analysis.checkInvocation({ index }))
            ];

            if (reverse) queries.toReversed().forEach(query => query());

            return queries.map(query => query());
        };
        const original = createAnalysis({ source });
        const expected = inspect(original);

        deepStrictEqual(statuses(original), ['agreement', 'contradiction']);
        deepStrictEqual(inspect(createAnalysis({ source }), true), expected);
        const revised = createAnalysis({ source: source.replace('done=other;done();', 'done=other;if(typeof done==="function")done();') });

        deepStrictEqual(statuses(revised), ['agreement', 'agreement']);
        deepStrictEqual(inspect(original, true), expected);
    });

    test('cannot turn an illegal immutable write into a successful revision', () => {
        const source = 'const run=({done}={})=>{const alias=done;if(typeof alias==="function"){alias=external;alias();}};';
        const analysis = createAnalysis({ source });

        strictEqual(analysis.invocations.length, 1);
        strictEqual(analysis.checkInvocation({ index: 0 }).status, 'unknown');
        deepStrictEqual(lint(source), []);
    });

    test('inert defaults preserve unrelated function findings', () => {
        const source = 'function zip(as,bs){if(bs===undefined)return bs=>zip(bs,as);return [];}function unrelated(callback=()=>true){return [];}';
        const findings = lint(source, [returnRule]);

        deepStrictEqual(findings.map(({ messageId = '' } = {}) => messageId), ['inconsistent', 'inconsistentValue', 'inconsistent']);
        const [{ column = 0, endColumn = 0 } = {}] = findings.filter(({ messageId = '' } = {}) => messageId === 'inconsistentValue');

        strictEqual(source.slice(column - 1, endColumn - 1), 'zip(bs,as)');
        strictEqual(runInNewContext(`${source} typeof zip()([]);`), 'function');
        strictEqual(runInNewContext(`${source} Array.isArray(zip([])([]));`), true);
    });

    test('wide callback revisions retain the final guard within the decision budget', () => {
        const size = 128;
        const writes = Array.from({ length: size }, (_, index) => `if(flag${index})done=external${index};`).join('');
        const source = `const run=({done}={})=>{${writes}if(typeof done==="function")done();};`;
        const analysis = createAnalysis({ source, limits: { decisions: 60000, demand: 60000 } });

        deepStrictEqual(statuses(analysis), ['agreement']);
        const { counts = {} } = analysis;

        deepStrictEqual(statuses(analysis), ['agreement']);
        const { counts: repeated = {} } = analysis;

        deepStrictEqual(repeated, counts);
    });
}

{
    const cases = JSON.parse(readFileSync(new URL('./fixtures/signature-placement.json', import.meta.url), 'utf8'));
    const adversaries = JSON.parse(readFileSync(new URL('./fixtures/signature-boundaries.json', import.meta.url), 'utf8'));
    const lint = new ESLint({ overrideConfigFile: true, allowInlineConfig: false, overrideConfig: [{
        plugins: { resilient: plugin }, rules: { 'resilient/prefer-signature-destructuring': 'error' },
        settings: { resilient: { resolver: () => false } }
    }] });
    const query = analysis => analysis.signatureExtractions.map(({ index = -1 } = {}) => analysis.checkSignatureExtraction({ index }));
    const outputFor = outputForShared;

    cases.forEach(({ source = '', findings = 0 } = {}) => {
        test(`signature placement: ${source}`, async () => {
            const analysis = createAnalysis({ source });
            const [{ messages = [], fatalErrorCount = 0 } = {}] = await lint.lintText(source);

            strictEqual(fatalErrorCount, 0);
            strictEqual(messages.length, findings);
            strictEqual(query(analysis).filter(({ placement = '' } = {}) => placement === 'signature').length, findings);
        });
    });

    adversaries.forEach(({ name = '', source = '', placements = [], relocations = [] } = {}) => {
        test(`signature boundary: ${name}`, async () => {
            const analysis = createAnalysis({ source });
            const proofs = query(analysis);

            deepStrictEqual(proofs.map(({ placement = '' } = {}) => placement), placements);
            deepStrictEqual(proofs.map(({ relocation = false } = {}) => Boolean(relocation)), relocations);
            const expected = analysis.signatureExtractions.filter(({ index = -1 } = {}) => placements.at(index) === 'signature')
                .map(({ location: { range: [start = 0, end = 0] = [], line = 0, column = 0 } = {} } = {}) => ({ line, column, endColumn: column + end - start }));
            const [{ messages = [], fatalErrorCount = 0 } = {}] = await lint.lintText(source);

            strictEqual(fatalErrorCount, 0);
            deepStrictEqual(messages.map(({ line = 0, column = 0, endColumn = 0 } = {}) => ({ line, column, endColumn })), expected);
            messages.forEach(({ fix = false, suggestions = [] } = {}) => {
                strictEqual(fix, false, 'Signature changes are never automatic fixes');
                suggestions.forEach(suggestion => createAnalysis({ source: outputFor(source, suggestion) }));
            });
        });
    });

    [
        'const read = input => { const { x = 1, y = 2 } = input; return [x,y]; };',
        'const read = (input = {}) => { const { x = 1, ...rest } = input; return [x,rest]; };',
        'const read = (input = []) => { const { x = 1 } = input; return x; };',
        'const read = (input, other) => { const { x = 1 } = input; return [x,other]; };',
        'const read = function(input) { const { x: renamed = 1 } = input; return renamed; };',
        'function read(input) { const { x = 1 } = input; return x; }',
        'const read = input => { const { inner: { x = 1 } = {} } = input; return x; };',
        'const read = (before = undefined, input) => { const { undefined: value = 1 } = input; return [before,value]; };',
        'const read = input => { const { x = 1 } = input; return () => x; };',
        'const read = input => { const { x /* retained comment */ = 1 } = input; return x; };'
    ].forEach(source => test(`manual relocation preserves authored runtime behavior: ${source}`, async () => {
        const [{ messages: [{ suggestions = [] } = {}] = [] } = {}] = await lint.lintText(source);

        strictEqual(suggestions.length, 1);
        const rewritten = outputFor(source, suggestions.at(0));
        const execute = program => runInNewContext(`${program}
        const cases = [[], [void 0], [null], [42], ['text'], [{}], [{x:0,y:false}], [{inner:{x:4}}]];
        const results = cases.map(args => {
            try { const value=read(...args); return {value:typeof value==='function'?value():value}; }
            catch(error) { return {error:error.name}; }
        });
        const events=[];
        const target={get x(){events.push('get x');return 3;},get y(){events.push('get y');return 4;},inner:{x:5}};
        const input=new Proxy(target,{ownKeys(object){events.push('ownKeys');return Reflect.ownKeys(object);},
            getOwnPropertyDescriptor(object,key){events.push('descriptor '+key);return Reflect.getOwnPropertyDescriptor(object,key);}});
        let observed;
        try {const value=read(input,9);observed=typeof value==='function'?value():value;}catch(error){observed=error.name;}
        JSON.stringify({results,events,observed,length:read.length});`);

        strictEqual(execute(rewritten), execute(source));
        const [{ messages = [], fatalErrorCount = 0 } = {}] = await lint.lintText(rewritten);

        strictEqual(fatalErrorCount, 0);
        deepStrictEqual(messages, []);
    }));

    test('suggestions preserve required absence and do not introduce a root default', async () => {
        const source = 'const read = input => { const { value = 1 } = input; return value; };';
        const [{ messages: [{ suggestions: [suggestion = {}] = [] } = {}] = [] } = {}] = await lint.lintText(source);

        strictEqual(outputFor(source, suggestion), 'const read = ({ value = 1 }) => {  return value; };');
    });

    test('parameter scope and directive changes are executable counterexamples to blind relocation', () => {
        const source = 'const read=(before=void undefined,input)=>{const{undefined=1}=input;return [before,undefined];};';
        const moved = 'const read=(before=void undefined,{undefined=1})=>{return [before,undefined];};';

        strictEqual(runInNewContext(`${source} JSON.stringify(read(void 0, {}));`), '[null,1]');
        throws(() => runInNewContext(`${moved} read(void 0, {});`), { name: 'ReferenceError' });
        throws(() => createAnalysis({ source: 'const read=({x=1})=>{"use strict";return x;};' }), SyntaxError);
    });

    test('placement owns its snapshot and missing source order remains unknown', () => {
        const source = 'const read=input=>{const{value=1}=input;return value;};';
        const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
        const analysis = createProgramAnalysis({ program });
        const expected = query(analysis);
        const { body: [{ declarations: [{ init: { params: [parameter = {}] = [] } = {} } = {}] = [] } = {}] = [] } = program;

        Object.defineProperty(parameter, 'name', { value: 'revised' });
        Object.defineProperty(parameter, 'range', { value: [0, 0] });
        deepStrictEqual(query(analysis), expected);
        const unlocated = createProgramAnalysis({ program: parse(source, { ecmaVersion: 'latest', sourceType: 'module' }) });
        const [{ placement = '', reason = '', relocation = false } = {}] = query(unlocated);

        strictEqual(placement, 'unknown');
        strictEqual(reason, 'unavailable-location');
        strictEqual(relocation, false);
    });

    test('comments outside a moved pattern retain the diagnostic without a destructive suggestion', async () => {
        const sources = ['const read = input => { const /* keep here */ { value = 1 } = input; return value; };',
            'const read = input => { const { value = 1 } = /* keep here */ input; return value; };'];

        await Promise.all(sources.map(async (source) => {
            const [{ messages: [{ suggestions = [] } = {}] = [] } = {}] = await lint.lintText(source);

            deepStrictEqual(suggestions, []);
        }));
    });

    test('signature policy does not reinterpret caller inputs as the callee contract', () => {
        const source = 'const read=input=>{const {value=1}=input;return value;}; read({value:2}); read(external); read(null);';
        const first = createAnalysis({ source });
        const second = createAnalysis({ source });
        const expected = query(first);

        second.calls.toReversed().forEach(({ index = -1 } = {}) => second.checkCall({ index }));
        second.functions.toReversed().forEach(({ index = -1 } = {}) => second.checkFunction({ index }));
        second.declarations.toReversed().forEach(({ index = -1 } = {}) => second.checkDeclaration({ index }));
        deepStrictEqual(query(second), expected);
        deepStrictEqual(query(first), expected);
        strictEqual(first.checkCall({ index: 2 }).status, 'agreement', 'Body-only extraction is policy evidence, not a newly authored signature');
    });

    test('shared use evidence is frozen and source revisions remain independent', () => {
        const source = 'const read=input=>{const {first=1}=input;const {second=2}=input;return [first,second];};';
        const analysis = createAnalysis({ source });
        const [{ references: first = [] } = {}, { references: second = [] } = {}] = query(analysis);

        strictEqual(first, second);
        ok(Object.isFrozen(first));
        ok(first.every(Object.isFrozen));
        ok(analysis.signatureExtractions.every(Object.isFrozen));
        const changed = createAnalysis({ source: source.replace('return [first,second]', 'return input') });

        deepStrictEqual(query(changed).map(({ placement = '' } = {}) => placement), ['body', 'body']);
        deepStrictEqual(query(analysis).map(({ placement = '' } = {}) => placement), ['signature', 'signature']);
        throws(() => analysis.checkSignatureExtraction({ index: -1 }), RangeError);
        throws(() => analysis.checkSignatureExtraction({ index: 2 }), RangeError);
    });

    test('imported consumer guards and extraction placement belong to their module snapshots', () => {
        const source = 'import { consume as local } from "consumer"; const read=input=>{const {run}=input;local(run);};';
        const guarded = 'export const consume=run=>{if(typeof run==="function")run();}; const read=input=>{const{x=1}=input;return x;};';
        const unguarded = 'export const consume=run=>run(); const read=input=>{const{x=1}=input;return x;};';
        const acquire = dependency => createAnalysis({ source, filename: 'main', resolveModule: () => ({ filename: 'consumer', source: dependency }) });
        const original = acquire(guarded);

        strictEqual(original.signatureExtractions.length, 1, 'Imported extraction syntax cannot become a main-module finding');
        strictEqual(query(original).at(0).placement, 'body');
        strictEqual(query(acquire(unguarded)).at(0).placement, 'signature');
        strictEqual(query(original).at(0).placement, 'body');
        const failure = new Error('module acquisition failed');

        throws(() => createAnalysis({ source, filename: 'main', resolveModule: () => { throw failure; } }), error => error === failure);
        throws(() => createAnalysis({ source, filename: 'main', resolveModule: () => ({ filename: 'consumer' }) }), TypeError);
    });

    test('interrupted shared guard proofs cannot publish a signature placement', () => {
        const source = 'const read=input=>{const {run}=input;if(typeof run!=="function")return;run();};';
        const original = createAnalysis({ source });
        const steps = [];
        const expected = original.checkSignatureExtraction({ index: 0, onWork: event => append(steps, event) });
        const { placement = '' } = expected;

        strictEqual(placement, 'body');
        steps.forEach((event, position) => {
            const analysis = createAnalysis({ source });
            const visited = [];
            const failure = new Error('observation failed');

            throws(() => analysis.checkSignatureExtraction({ index: 0, onWork: (value) => {
                append(visited, value);

                if (visited.length !== position + 1) return;

                deepStrictEqual(value, event);
                throw failure;
            } }), error => error === failure);
            analysis.declarations.forEach(({ index = -1 } = {}) => analysis.checkDeclaration({ index }));
            deepStrictEqual(analysis.checkSignatureExtraction({ index: 0 }), expected);
        });
    });

    test('authored defaults and shared callable evidence are independent in either query order', () => {
        ['run', 'run=false'].forEach((pattern) => {
            const source = `const read=input=>{const {${pattern}}=input;if(typeof run!=="function")return;run();};`;
            const first = createAnalysis({ source });
            const second = createAnalysis({ source });
            const declarations = second.declarations.map(({ index = -1 } = {}) => second.checkDeclaration({ index }));
            const [proof = {}] = query(first);
            const { placement = '' } = proof;

            strictEqual(placement, 'body');
            deepStrictEqual(query(second), [proof]);
            deepStrictEqual(first.declarations.map(({ index = -1 } = {}) => first.checkDeclaration({ index })), declarations);
        });
    });

    test('deferred getters and method receivers retain their native execution boundary', () => {
        const sources = [
            'const read=input=>{const {value=0}=input;return ()=>input.value;};',
            'const read=input=>{const {value=0}=input;return ()=>input.method();};',
            'const read=input=>{const {value=0}=input;return ()=>{const {value=0}=input;return value;};};'
        ];

        sources.forEach((source) => {
            strictEqual(query(createAnalysis({ source })).at(0).placement, 'body');
            const observed = runInNewContext(`${source}
            let current=1, reads=0;
            const input={get value(){reads++;if(current===3)throw Error('later');return current;},method(){return this.value;}};
            const later=read(input);const initial=reads;current=2;const value=later();current=3;
            let failure='';try{later();}catch(error){failure=error.message;}
            JSON.stringify({initial,value,reads,failure});`);

            strictEqual(observed, '{"initial":1,"value":2,"reads":3,"failure":"later"}');
        });
    });
}

{
    const cases = JSON.parse(readFileSync(new URL('./fixtures/signature-fluency.json', import.meta.url), 'utf8'));
    const lint = new ESLint({ overrideConfigFile: true, allowInlineConfig: false, overrideConfig: [{
        plugins: { resilient: plugin }, rules: { 'resilient/prefer-signature-destructuring': 'error' },
        languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } }, settings: { resilient: { resolver: () => false } }
    }] });

    cases.forEach(({ name = '', source = '', placement = '', relocation = false, sourceType = 'module' } = {}) => {
        test(`signature review: ${name}`, async () => {
            const analysis = createAnalysis({ source, sourceType });
            const { signatureExtractions = [] } = analysis;

            strictEqual(signatureExtractions.length, 1);
            const proof = analysis.checkSignatureExtraction({ index: 0 });
            const { placement: actual = '', relocation: move = false } = proof;

            strictEqual(actual, placement);
            strictEqual(Boolean(move), relocation);
            const [{ messages = [], fatalErrorCount = 0 } = {}] = await lint.lintText(source);

            strictEqual(fatalErrorCount, 0);
            strictEqual(messages.length, placement === 'signature' ? 1 : 0);
            strictEqual(messages.flatMap(({ suggestions = [] } = {}) => suggestions).length, Number(relocation));
            const second = createAnalysis({ source, sourceType });

            second.functions.toReversed().forEach(({ index = -1 } = {}) => second.checkFunction({ index }));
            second.declarations.toReversed().forEach(({ index = -1 } = {}) => second.checkDeclaration({ index }));
            deepStrictEqual(second.checkSignatureExtraction({ index: 0 }), proof);
        });
    });

    test('optional-chain references preserve this, getter order and mutation at runtime', () => {
        const observed = runInNewContext(`
        const events=[];
        const child={value:4, method(){events.push(this===child);return this.value;}};
        const input={get child(){events.push('get child');return child;},method(){events.push(this===input);return 3;}};
        const first=(input?.method)();const second=(input?.child).method();
        ({slot:(input?.child).value}={slot:7});delete (input?.child).value;
        JSON.stringify({first,second,events,deleted:!Object.hasOwn(child,'value')});
    `);

        strictEqual(observed, '{"first":3,"second":4,"events":[true,"get child",true,"get child","get child"],"deleted":true}');
    });

    test('opaque tag consumption cannot authorize removing a binding needed by its host lowering', () => {
        const source = 'const read=Input=>{const{value=0}=Input;return <Input/>;};';
        const { placement = '', references = [] } = createAnalysis({ source }).checkSignatureExtraction({ index: 0 });

        strictEqual(placement, 'unknown');
        ok(references.some(({ kind = '' } = {}) => kind === 'unsupported-reference'));
        const lowered = 'const read=Input=>{const{value=0}=Input;return {type:Input};};';
        const moved = 'const read=({value=0})=>{return {type:Input};};';

        strictEqual(runInNewContext(`${lowered} const supplied={value:1}; read(supplied).type===supplied;`), true);
        throws(() => runInNewContext(`${moved} read({value:1});`), { name: 'ReferenceError' });
        const originalArguments = 'function read(input){const{value=0}=input;return arguments.callee===read;}';
        const movedArguments = 'function read({value=0}){return arguments.callee===read;}';

        strictEqual(runInNewContext(`${originalArguments} read({});`), true);
        throws(() => runInNewContext(`${movedArguments} read({});`), { name: 'TypeError' });
    });

    test('tag-use snapshots are owned and required syntax failures remain operational', () => {
        const source = 'const read=Input=>{const{value=0}=Input;return <Input/>;};';
        const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true, ecmaFeatures: { jsx: true } });
        const analysis = createProgramAnalysis({ program });
        const { body: [{ declarations: [{ init: { body: { body: [, { argument: { openingElement: { name = {} } = {} } = {} } = {}] = [] } = {} } = {} } = {}] = [] } = {}] = [] } = program;
        const expected = analysis.checkSignatureExtraction({ index: 0 });

        Object.defineProperty(name, 'name', { value: 'Other' });
        strictEqual(analysis.checkSignatureExtraction({ index: 0 }), expected);
        strictEqual(createProgramAnalysis({ program }).checkSignatureExtraction({ index: 0 }).placement, 'signature');
        const failure = new Error('tag source unavailable');

        Object.defineProperty(name, 'name', { get() { throw failure; } });
        throws(() => createProgramAnalysis({ program }), error => error === failure);
    });

    test('opaque tag escapes cannot establish generic guarded-consumer agreement', () => {
        const source = 'import {consume} from "consumer"; const read=({run})=>consume(run);';
        const acquire = body => createAnalysis({ source, filename: 'main', resolveModule: () => ({
            filename: 'consumer', source: `export const consume=Action=>{if(typeof Action==='function')Action();${body}};`
        }) });
        const escaped = acquire('return <Action/>;');
        const unrelated = acquire('return <Other Action="text"/>;');
        const { declarations = [] } = escaped;
        const { index = -1 } = declarations.find(({ name = '' } = {}) => name === 'run') ?? {};

        strictEqual(escaped.checkDeclaration({ index }).required, true);
        strictEqual(unrelated.checkDeclaration({ index }).required, false);
        strictEqual(escaped.checkDeclaration({ index }).required, true);
    });

    test('suggested relocation preserves independent runtime observations across composed signatures and patterns', async () => {
        const wrappers = [
            ['const read=input=>{', '};'], ['const read=(input)=>{', '};'], ['const read=(input={})=>{', '};'],
            ['const read=(prior=0,input)=>{', '};'], ['const read=function named(input){', '};'],
            ['function read(input){', '}'], ['const host={read(input){', '}};const read=host.read;']
        ];
        const patterns = [
            ['{value=0}', 'value'], ['{value:renamed=false}', 'renamed'], ['{value:read=1}', 'read'],
            ['{nested:{next=1}={}}', 'next'], ['{items:[first=0]=[]}', 'first'], ['{value=0,...rest}', '[value,rest]'],
            ['{value=/x/}', 'String(value)'], ['{value=null}', 'value'], ['{"odd key":value=""}', 'value'], ['{}', '42']
        ];
        const programs = wrappers.flatMap(([open = '', close = ''] = [], position) => patterns.flatMap(([pattern = '', result = ''] = []) => (
            [result, `()=>(${result})`].map(expression => ({ source: `${open}const ${pattern}=input;return ${expression};${close}`, position }))
        )));
        const outcomes = await Promise.all(programs.map(async ({ source = '', position = -1 } = {}) => {
            const [{ messages: [{ suggestions = [] } = {}] = [] } = {}] = await lint.lintText(source);

            strictEqual(suggestions.length, 1, source);
            const { fix: { range: [start = 0, end = 0] = [], text = '' } = {} } = suggestions.at(0);
            const rewritten = source.slice(0, start) + text + source.slice(end);
            const execute = program => runInNewContext(`${program}
            const run=args=>{try{const value=read(...args);return {value:typeof value==='function'?value():value};}
                catch(error){return {error:error.name};}};
            const cases=[[],[void 0],[null],[false],[4],['text'],[[]],[{}],[{value:0}],[{value:2,nested:{next:3},items:[4]}]];
            const shape=args=>${position === 3 ? '[0,...args]' : 'args'};
            const results=cases.map(args=>run(shape(args)));
            const events=[];
            const target={get value(){events.push('get value');return 3;},get nested(){events.push('get nested');return {next:5};},
                get items(){
                    events.push('get items');
                    return {[Symbol.iterator](){
                        events.push('iterator');
                        return {next(){events.push('next');return {value:6,done:false};},return(){events.push('close');return {done:true};}};
                    }};
                }
            };
            const input=new Proxy(target,{ownKeys(object){events.push('ownKeys');return Reflect.ownKeys(object);},
                getOwnPropertyDescriptor(object,key){events.push('descriptor '+key);return Reflect.getOwnPropertyDescriptor(object,key);}});
            const traced=run(shape([input]));
            const failed=run(shape([{get value(){events.push('throw');throw TypeError('source');}}]));
            JSON.stringify({results,traced,failed,events,length:read.length});`);
            const before = execute(source);

            strictEqual(execute(rewritten), before, source);

            return before;
        }));

        strictEqual(outcomes.length, 140);
    });
}

{
    const rule = 'resilient/no-unguarded-callback-invocation';
    const config = { plugins: { resilient: plugin }, rules: { [rule]: 'error' } };
    const statuses = analysis => analysis.invocations.filter(({ optionalCallback = false } = {}) => optionalCallback)
        .map(({ index = -1 } = {}) => analysis.checkInvocation({ index }).status);
    const directoryFor = (context) => {
        const directory = mkdtempSync(join(tmpdir(), 'resilient-predicates-'));

        context.after(() => rmSync(directory, { recursive: true, force: true }));

        return directory;
    };

    [
        ['function*(value){return typeof value==="function";}', 'contradiction'],
        ['async function*(value){return typeof value==="function";}', 'contradiction'],
        ['async value=>typeof value==="function"', 'contradiction'],
        ['value=>true', 'contradiction'],
        ['42', 'contradiction'],
        ['value=>external(value)', 'unknown'],
        ['value=>typeof value==="function"', 'agreement'],
        ['value=>value&&typeof value==="function"', 'agreement']
    ].forEach(([helper = '', expected = ''] = [], position) => test(`resolved guard: ${helper}`, (context) => {
        const style = ['named', 'default', 'reexport'].at(position % 3);
        const directory = directoryFor(context);
        const filename = join(directory, 'main.js');
        const dependencyFile = join(directory, 'guard.js');
        const implementationFile = join(directory, 'implementation.js');
        const dependency = style === 'default' ? `export default ${helper};` : `export const isFunction=${helper};`;
        const imported = style === 'default' ? 'isFunction' : '{isFunction}';
        const entry = style === 'reexport' ? 'export {isFunction} from "./implementation.js";' : dependency;

        writeFileSync(dependencyFile, entry);
        writeFileSync(implementationFile, dependency);
        const engine = new Linter({ cwd: directory });

        const source = `import ${imported} from "./guard.js";const run=({done}={})=>isFunction(done)&&done();`;
        const options = { source, filename, resolveModule: ({ source: specifier = '' } = {}) => ({
            filename: join(directory, specifier), source: specifier === './implementation.js' ? dependency : entry
        }) };
        const analysis = createAnalysis(options);

        deepStrictEqual(statuses(analysis), [expected]);
        const findings = engine.verify(source, config, { filename });

        strictEqual(findings.length, Number(expected === 'contradiction'));
        deepStrictEqual(findings.map(({ column = 0, endColumn = 0 } = {}) => source.slice(column - 1, endColumn - 1)), expected === 'contradiction' ? ['done()'] : []);
    }));

    ['function*', 'async function*'].forEach(kind => test(`${kind} guard has a runtime counterexample`, () => {
        const source = `const isFunction=${kind}(value){return typeof value==="function";};const run=({done}={})=>{if(isFunction(done))done();};`;

        throws(() => runInNewContext(`${source}run();`), { name: 'TypeError' });
        deepStrictEqual(statuses(createAnalysis({ source })), ['contradiction']);
    }));

    test('unresolved imported and unbound guard syntax retains its local admission', () => {
        ['import {isFunction} from "unavailable";', ''].forEach((prefix) => {
            const source = `${prefix}const run=({done}={})=>{if(isFunction(done))done();};`;

            deepStrictEqual(statuses(createAnalysis({ source, filename: 'main.js', resolveModule: () => ({ available: false }) })), ['agreement']);
            strictEqual(new Linter().verify(source, config).length, 0);
        });
    });

    test('imported predicate revisions refresh a reused host AST without rewriting source', (context) => {
        const directory = directoryFor(context);
        const filename = join(directory, 'main.js');
        const dependencyFile = join(directory, 'guard.js');
        const source = 'import {isFunction} from "./guard.js";const run=({done}={})=>isFunction(done)&&done();';
        const generator = 'export function* isFunction(value){return typeof value==="function";}';
        const predicate = 'export const isFunction=value=>typeof value==="function";';
        const engine = new Linter({ cwd: directory });

        writeFileSync(dependencyFile, generator);
        const original = engine.verify(source, config, { filename });
        const host = engine.getSourceCode();
        const retained = createAnalysis({ source, filename, resolveModule: () => ({ filename: dependencyFile, source: generator }) });

        strictEqual(original.length, 1);
        writeFileSync(dependencyFile, predicate);
        deepStrictEqual(engine.verify(host, config, { filename }), []);
        deepStrictEqual(statuses(retained), ['contradiction']);
        writeFileSync(dependencyFile, generator);
        deepStrictEqual(engine.verify(host, config, { filename }), original);
        const { output = '', fixed = true, messages = [] } = engine.verifyAndFix(source, config, { filename });

        strictEqual(output, source);
        strictEqual(fixed, false);
        deepStrictEqual(messages, original);
    });

    test('predicate module resolver failures remain operational failures', () => {
        const error = new Error('resolver failure');

        throws(() => createAnalysis({ source: 'import {isFunction} from "guards";', filename: 'main.js', resolveModule: () => { throw error; } }), caught => caught === error);
    });

    [
        ['done=first;(done=second,0);', 'unknown'],
        ['(done=first,0);done=second;', 'unknown'],
        ['done=first;done+=second;', 'unknown'],
        ['done+=first;done=second;', 'unknown'],
        ['done=first;done=second;', 'agreement']
    ].forEach(([writes = '', expected = ''] = []) => test(`mixed mutation eligibility: ${writes}`, () => {
        const source = `const run=({done}={})=>{${writes}if(typeof done==="function")done();};`;

        deepStrictEqual(statuses(createAnalysis({ source })), [expected]);
    }));
}
