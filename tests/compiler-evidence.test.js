import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';
import typescript from 'typescript';

import plugin from 'eslint-plugin-resilient';
import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import { createTypeScriptAnalysis } from 'eslint-plugin-resilient/analyzer/typescript';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { assertCompilerCollection } from './support/compiler-retention.js';
import { analyze, firstCall, fixture, tuple } from './support/compiler-source.js';
import { counter } from './support/work.js';

// The compiler adapter supplies the shared evaluator with source/requirement identities. Keep native adapter equivalence, actual versus generic input, foreign/stale
// roots, reader failure, retry, release and resource laws.

{
    const outcome = ({ status = '', fact: { families = [], incomplete = false } = {}, normal = false, thrown = false } = {}) => (
        { status, families, incomplete, normal, thrown }
    );
    const lastResult = (analysis, required = '') => {
        const { calls = [] } = analysis;
        const { index = -1 } = calls.at(-1) ?? {};

        return analysis.checkCallResult({ index, required });
    };

    // Identical executable source enters two syntax acquisitions and one evaluator.
    // These witnesses cover the existing shared engine, not a new callback engine.
    [
        ['arrow', 'const read=value=>value;read(3);', 'number'],
        ['function expression and alias', 'const read=function self(value){return value;};const alias=read;alias(3);', 'number'],
        ['immediate function', '(function(value){return value;})(3);', 'number'],
        ['returned callable alias', 'const make=()=>value=>value;const read=make();read(3);', 'number'],
        ['callback actual input', 'const apply=(callback,value)=>callback(value);apply(value=>value,3);', 'number'],
        ['direct record result', 'const build=value=>({value});build(3);', 'object'],
        ['owned member callable', 'const api={read:value=>value};api.read(3);', 'number'],
        ['native-looking own member', 'const api={map:value=>value};api.map(3);', 'number'],
        ['map callback', '[1,2].map(value=>value);', 'array'],
        ['sparse map', '[,2].map(value=>value);', 'array'],
        ['empty map skips failure', '[].map(()=>{throw 1;});', 'array'],
        ['callback failure', '[1].map(()=>{throw 1;});', 'array'],
        ['noncallable callback', '[1].map(0);', 'array'],
        ['seeded reduction', '[1,2].reduce((acc,value)=>acc,"seed");', 'string'],
        ['successive accumulator', '[1,"last"].reduce((acc,value)=>value,0);', 'string'],
        ['empty seeded reduction', '[].reduce((acc,value)=>value,"seed");', 'string'],
        ['unseeded reduction', '[1,2].reduce((acc,value)=>acc);', 'number'],
        ['empty unseeded failure', '[].reduce((acc,value)=>acc);', 'number'],
        ['hole-only unseeded failure', '[,,].reduce((acc,value)=>acc);', 'number'],
        ['some callback', '[1].some(value=>true);', 'boolean'],
        ['find exhaustion', '[1].find(value=>false);', 'nullish'],
        ['forEach completion', '[1].forEach(value=>value);', 'nullish']
    ].forEach(([name = '', source = '', required = ''] = []) => test(`compiler bridge/shared evaluator equivalence: ${name}`, () => {
        const compiler = analyze(source);
        const shared = createAnalysis({ source });

        deepStrictEqual(outcome(lastResult(compiler, required)), outcome(lastResult(shared, required)));
    }));

    test('compiler bridge: returned callable invocation evaluates the outer callee first', () => {
        const analysis = analyze('const make=()=>value=>value;make()(3);');
        const { calls: [{ index = -1 } = {}] = [] } = analysis;
        const { status = '', fact: { families = [] } = {}, thrown = true } = analysis.checkCallResult({ index, required: 'number' });

        strictEqual(status, 'agreement');
        deepStrictEqual(families, ['number']);
        strictEqual(thrown, false);
    });

    test('compiler bridge: arbitrary tuple arity, arrow aliases and function slots use actual values', () => {
        const source = 'const read=([flag,callback,value]:[boolean,()=>number,string])=>[flag,callback,value];const alias=read;alias([false,()=>3,"text"]);';
        const analysis = analyze(source);
        const { descriptor: { slots = [] } = {}, calls = [] } = tuple(analysis);

        deepStrictEqual(slots.map(({ requirement: { family = '' } = {} } = {}) => family), ['boolean', 'function', 'string']);
        deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['agreement']);
        const wrong = analyze(source.replace('[false,()=>3,"text"]', '[false,3,"text"]'));

        strictEqual(firstCall(wrong).status, 'contradiction');
    });

    test('compiler bridge: annotation and returned value evidence retain separate meanings', () => {
        const source = 'const read=([value]:[number]):number=>"actual";read([3]);';
        const analysis = analyze(source);
        const revised = analyze(source.replace('[number]', '[string]'), { revision: '2' });

        strictEqual(lastResult(analysis, 'number').status, 'contradiction');
        deepStrictEqual(outcome(lastResult(analysis, 'number')), outcome(lastResult(revised, 'number')));
        strictEqual(tuple(analysis).descriptor.requirement.family, 'number');
        strictEqual(tuple(revised).descriptor.requirement.family, 'string');
    });

    test('compiler bridge: reducer requirements and accumulator identity have different owners', () => {
        const analysis = analyze('const fold=(acc,[value]:[number])=>acc;[[3]].reduce(fold,"seed");');
        const { descriptor: { parameterIndex = -1 } = {}, result: { returnedParameter = false } = {} } = tuple(analysis);
        const { index = -1 } = returnedParameter;

        strictEqual(parameterIndex, 1);
        strictEqual(index, 0);
        strictEqual(lastResult(analysis, 'string').status, 'agreement');
        const replacement = analyze('const fold=(acc,[value]:[number])=>"replacement";[[3]].reduce(fold,"seed");');

        strictEqual(tuple(replacement).result.returnedParameter, false);
    });

    test('compiler bridge: a known producer conflict survives an unknown return and invocation queries', () => {
        const analysis = analyze('const select=(first,second)=>first?3:second?"text":external;select(true,false);');
        const before = analysis.checkFunction({ index: 0 });
        const { status = '', fact: { families = [], incomplete = false } = {} } = before;

        strictEqual(status, 'contradiction');
        deepStrictEqual(families, ['number', 'string']);
        strictEqual(incomplete, true);
        strictEqual(lastResult(analysis, 'number').status, 'agreement');
        deepStrictEqual(analysis.checkFunction({ index: 0 }), before);
    });

    test('compiler bridge: reached completion owns later calls and preserves failure ordering', () => {
        const analysis = analyze('function read([value]:[number]){return [value];}read(null);read(["unreachable"]);');
        const { calls = [] } = tuple(analysis);

        strictEqual(calls.at(0).normal, false);
        strictEqual(calls.at(0).thrown, true);
        strictEqual(calls.at(1).status, 'unknown');
        strictEqual(calls.at(1).normal, 'unknown');
        const argument = analyze('const fail=()=>{throw 7;};const read=value=>value;read(fail());');
        const { normal = true, thrown = false } = argument.checkCallResult({ index: 0, required: 'number' });

        strictEqual(normal, false);
        strictEqual(thrown, true);
    });

    test('compiler bridge: unrelated effects preserve fresh input while shared inputs remain unproved', () => {
        const argument = analyze('const read=([value]:[number],effect)=>[value];read([3],external());');
        const mismatch = analyze('const read=([value]:[number],effect)=>[value];read(["wrong"],external());');
        const shared = analyze('const read=([value]:[number],effect)=>[value];const values=[3];read(values,0);read(values,external(values));');
        const nested = analyze('const read=([value]:[{qty:number}],effect)=>value.qty;const value={qty:3};read([value],external(value));');
        const element = analyze('[external()].map(value=>3);');

        deepStrictEqual([firstCall(argument), firstCall(mismatch)].map(({ status = '', normal = false, thrown = false } = {}) => ({ status, normal, thrown })), [
            { status: 'agreement', normal: true, thrown: true },
            { status: 'contradiction', normal: true, thrown: true }
        ]);
        shared.calls.toReversed().forEach(({ index = -1 } = {}) => shared.checkCallResult({ index, required: 'array' }));
        deepStrictEqual(tuple(shared).calls.map(({ status = '' } = {}) => status), ['agreement', 'unknown']);
        strictEqual(nested.checkCallResult({ index: 0, required: 'number' }).status, 'unknown');
        strictEqual(element.checkCallResult({ index: 0, required: 'array' }).status, 'unknown');
        strictEqual(runInNewContext('const external=items=>{items[0]="wrong";};const values=[3];const read=([value])=>value;read(values,external(values));'), 'wrong');
    });

    test('compiler bridge: skipped effects preserve the reached native premise', () => {
        const analysis = analyze('export {};if(false){external();}[1].map(value=>value);');

        strictEqual(lastResult(analysis, 'array').status, 'agreement');
    });

    test('compiler bridge: initialized module aliases and lexical shadows remain distinct', () => {
        const declaration = 'function read([value]:[number]){return [value];}';
        const alias = analyze(`${declaration}const renamed=read;renamed([3]);`);

        strictEqual(firstCall(alias).status, 'agreement');
        const shadow = analyze(`${declaration}function outer(){read([3]);const read=external;}outer();`);

        ok(tuple(shadow).calls.every(({ status = '' } = {}) => status === 'unknown'));
        const hoisted = analyze(`${declaration}function outer(){read([3]);{var read=external;}}outer();`);

        deepStrictEqual(tuple(hoisted).calls, []);
    });

    test('compiler bridge: acquisition and observer failures are operational, retry stays source-owned', () => {
        const input = fixture('const read=([value]:[number])=>[value];read([3]);');
        const { sourceText = '' } = input;
        const analysis = createTypeScriptAnalysis(input);
        const failure = new Error('observation failed');

        throws(() => analysis.checkFunction({ index: 0, onWork: () => { throw failure; } }), error => error === failure);
        deepStrictEqual(analysis.checkFunction({ index: 0 }), analyze(sourceText).checkFunction({ index: 0 }));
        const work = counter();

        tuple(analysis, work);
        const before = work.read();

        tuple(analysis, work);
        deepStrictEqual(work.read(), before);
        assertCompilerCollection(sourceText);
    });

    // Exported/module callables may run outside the acquired module execution.
    // A missing local call is not evidence that their captured writes are inert.
    test('compiler bridge: an externally reachable writer invalidates a captured callable', () => {
        const source = 'function read([value]:[number]){return [value];}export function replace(){read=external;}export function run(){return read([3]);}';
        const analysis = analyze(source);

        strictEqual(analysis.checkFunction({ index: 2 }).status, 'unknown');
        strictEqual(firstCall(analysis).status, 'unknown');
    });

    test('compiler bridge: dynamic lexical execution cannot lend stable binding evidence', () => {
        const source = 'function read([value]:[number]){eval("value=String()");return [value];}read([3]);';

        strictEqual(firstCall(analyze(source)).status, 'unknown');
    });

    test('compiler bridge: unrelated effects do not erase native or ordinary helper result families', () => {
        const analysis = analyze('function read([value]:[number]){function wrap(input){return [input];}return wrap(value);}');
        const { result: { fact: { families = [] } = {} } = {} } = tuple(analysis);

        deepStrictEqual(families, ['array']);
        const native = analyze('const read=effect=>[1].map(value=>value);read(external());');

        const { status = '', normal = false, thrown = false } = native.checkCallResult({ index: 1, required: 'array' });

        deepStrictEqual({ status, normal, thrown }, { status: 'agreement', normal: true, thrown: true });
    });
}

{
    const declaration = 'export function outer([value]: [number]) { function inner(input: number) { return [input]; } const alias = inner; return alias(value); }';

    test('compiler callable alias: captured values stay unknown while stable module declarations keep their identity', () => {
        const captured = `export function outer([value]: [number]) {
        function wrap(input: number) { return [input]; }
        const alias = wrap;
        function inner(input: number) { return alias(input); }
        return inner(value);
    } outer([3]);`;
        const moduleOwned = 'function inner(input: number) { return [input]; } export function outer([value]: [number]) { const alias = inner; return alias(value); } outer([3]);';

        strictEqual(firstCall(analyze(captured)).status, 'unknown');
        strictEqual(firstCall(analyze(moduleOwned)).status, 'agreement');
    });

    test('compiler callable alias: a returned callable remains a function, independently of its body result', () => {
        const { status = '', fact: { families = [] } = {} } = firstCall(analyze(`${declaration.replace('return alias(value)', 'return [alias]')} outer([3]);`));

        strictEqual(status, 'contradiction');
        deepStrictEqual(families, ['function']);
    });

    test('compiler callable alias: requirements, revisions, reverse queries and interrupted observers retain their owners', () => {
        const source = `${declaration} outer(['wrong']); outer(external);`;
        const expected = tuple(analyze(source));
        const { status = '', calls = [] } = expected;

        strictEqual(status, 'contradiction');
        deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['contradiction', 'unknown']);
        const revised = tuple(analyze(source.replace('[number]', '[string]'), { revision: '2', programRevision: '2' }));

        strictEqual(revised.calls.at(0).status, 'agreement');
        deepStrictEqual(revised.calls.at(0).fact, expected.calls.at(0).fact);
        const combined = analyze(`${declaration} ${declaration.replaceAll('outer', 'second').replace('[number]', '[string]')} outer([3]); second([3]);`);
        const reverse = combined.checkTuple({ index: 1 });
        const { status: reversed = '' } = reverse;

        strictEqual(reversed, 'contradiction');
        strictEqual(tuple(combined).calls.at(0).status, 'agreement');
        strictEqual(combined.checkTuple({ index: 1 }), reverse);
        const work = counter();

        tuple(analyze(source), work);
        const total = Object.values(work.read()).reduce((sum, count) => sum + count, 0);
        const failure = new Error('alias observer failed');

        [1, Math.floor(total / 2), total].forEach((stop) => {
            const analysis = analyze(source);
            let events = 0;

            throws(() => tuple(analysis, { onWork: () => {
                events += 1;

                if (events === stop) throw failure;
            } }), error => error === failure);
            deepStrictEqual(tuple(analysis), expected);
        });
    });

    test('compiler callable alias: required reader failures propagate and live sessions release every compiler input', () => {
        const input = fixture(`${declaration} outer([3]);`);
        const { sourceFile: { statements: [{ body: { statements = [] } = {} } = {}] = [] } = {} } = input;
        const [, { declarationList: { declarations: [alias = {}] = [] } = {} } = {}] = statements;
        const failure = new Error('alias initializer read failed');

        Object.defineProperty(alias, 'initializer', { get() { throw failure; } });
        throws(() => createTypeScriptAnalysis(input), error => error === failure);
        assertCompilerCollection(`${declaration} outer([3]);`);
    });

    test('compiler callable alias: composed aliases, invocations and independent requirements reuse warm evidence', () => {
        [8, 16, 32].forEach((size) => {
            const chain = Array.from({ length: size }, (_, index) => `const alias${index} = ${index ? `alias${index - 1}` : 'inner'};`).join(' ');
            const deep = declaration.replace('const alias = inner;', chain).replace('return alias(value)', `return alias${size - 1}(value)`);
            const names = Array.from({ length: size }, (_, index) => `outer${index}`);
            const sources = [
                `${deep} outer(['wrong']); outer(external);`,
                `${declaration} ${Array.from({ length: size }, () => "outer(['wrong']); outer(external);").join(' ')}`,
                `${declaration} ${'outer('.repeat(size)}['wrong']${')'.repeat(size)}; outer(external);`,
                [...names.map(name => declaration.replaceAll('outer', name)), ...names.map(name => `${name}(['wrong']);`), ...names.map(name => `${name}(external);`)].join(' ')
            ];

            sources.forEach((source) => {
                const analysis = analyze(source);
                const work = counter();
                const results = analysis.consumers.map(({ index = -1 } = {}) => analysis.checkTuple({ index, ...work }));

                ok(results.length);
                results.forEach(({ status = '', calls = [] } = {}) => {
                    strictEqual(status, 'contradiction');
                    ok(calls.some(({ status = '' } = {}) => status === 'unknown'));
                });
                const before = work.read();
                const { counts = {} } = analysis;

                analysis.consumers.toReversed().forEach(({ index = -1 } = {}) => analysis.checkTuple({ index, ...work }));
                deepStrictEqual(work.read(), before);
                const { counts: warm = {} } = analysis;

                deepStrictEqual(warm, counts);
                const revised = analyze(source, { revision: '2', programRevision: '2' });
                const fresh = counter();

                revised.consumers.forEach(({ index = -1 } = {}) => revised.checkTuple({ index, ...fresh }));
                deepStrictEqual(fresh.read(), before);
                const { counts: cold = {} } = revised;

                deepStrictEqual(cold, counts);
            });
        });
    });
}

{
    const declaration = inner => `function outer([value]: [number]) { const unrelated = ${inner}; return [value]; }`;
    const retained = ['() => 1', 'function () { return 1; }'];

    [
        '(input = fail()) => { value = 99; fail(); return [input]; }',
        'function named(input = fail()) { value = 99; fail(); return [input]; }'
    ].forEach((inner, index) => test(`compiler callable creation ${index}: raw, transformed and fixed execution leaves defaults and bodies dormant`, async () => {
        const code = `declare function fail(): never; export ${declaration(inner)}`;
        const { program = {}, filename = '' } = fixture(code);
        const { code: output = '', diagnostics = [], agreements = [] } = createTypeScriptTransformer({ typescript, program }).transform({ code, fileName: filename });
        const { outputText: raw = '' } = typescript.transpileModule(code, { compilerOptions: program.getCompilerOptions() });
        const { output: fixed = '' } = new Linter().verifyAndFix(output, [plugin.configs.recommended, plugin.configs.contracts, plugin.configs.safety]);
        const versions = await Promise.all([raw, output, fixed].map(code => import(`data:text/javascript,${encodeURIComponent(code)}`)));
        const { runtimeEvidence: { result: { fact: { families = [] } = {} } = {} } = {} } = agreements.find(({ action = '' } = {}) => action === 'preserve-native-tuple') ?? {};

        deepStrictEqual(diagnostics, []);
        deepStrictEqual(families, ['array']);
        versions.forEach(({ outer = false } = {}) => {
            if (typeof outer !== 'function') throw new TypeError('Expected outer export');

            deepStrictEqual(outer([3]), [3]);
            // eslint-disable-next-line resilient/no-undefined-assignment -- The callable ownership oracle retains the undefined element produced by an empty source tuple.
            deepStrictEqual(outer([]), [undefined]);
            throws(() => outer(), TypeError);
            throws(() => outer(null), TypeError);
            const value = {};

            strictEqual(outer([value]).at(0), value);
        });
    }));

    retained.forEach((inner, index) => {
        [
            ['full', '[3]', 'number', 'agreement', true, false],
            ['zero', '[0]', 'number', 'agreement', true, false],
            ['short', '[]', 'nullish', 'contradiction', true, false],
            ['wrong family', "['wrong']", 'string', 'contradiction', true, false],
            ['null slot', '[null]', 'nullish', 'contradiction', true, false],
            ['omitted', '', '', 'unknown', false, true],
            ['undefined', 'undefined', '', 'unknown', false, true],
            ['null', 'null', '', 'unknown', false, true],
            ['unknown', 'external', '', 'unknown', true, true]
        ].forEach(([name = '', input = '', family = '', status = '', normal = false, thrown = false] = []) => test(`compiler callable creation ${index}: ${name}`, () => {
            const { status: actual = '', fact: { families = [] } = {}, normal: completed = false, thrown: failed = false } = firstCall(analyze(`${declaration(inner)} outer(${input});`));

            strictEqual(actual, status);
            deepStrictEqual(families, family ? [family] : []);
            strictEqual(completed, normal);
            strictEqual(failed, thrown);
        }));

        test(`compiler callable creation ${index}: a live session releases all compiler inputs`, () => {
            assertCompilerCollection(`${declaration(inner)} outer([3]);`);
        });

        test(`compiler callable creation ${index}: revisions and interrupted queries retain contradictions beside unknown`, () => {
            const source = `${declaration(inner)} outer(['wrong']); outer(external);`;
            const expected = tuple(analyze(source));
            const { status = '', calls = [] } = expected;

            strictEqual(status, 'contradiction');
            deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['contradiction', 'unknown']);
            const revised = analyze(source.replace('[number]', '[string]'), { revision: 'source-2', programRevision: 'program-2' });
            const { calls: [{ status: judgment = '', fact = {} } = {}] = [] } = tuple(revised);
            const [{ fact: original = {} } = {}] = calls;

            strictEqual(judgment, 'agreement');
            deepStrictEqual(fact, original);
            const work = counter();

            tuple(analyze(source), work);
            const total = Object.values(work.read()).reduce((sum, count) => sum + count, 0);
            const failure = new Error('creation observer failed');
            const interrupted = analyze(source);

            throws(() => tuple(interrupted, { onWork: ({ kind = '' } = {}) => {
                if (kind === 'closure-creation') throw failure;
            } }), error => error === failure);
            deepStrictEqual(tuple(interrupted), expected);

            [1, Math.floor(total / 2), total].forEach((stop) => {
                const analysis = analyze(source);
                let events = 0;

                throws(() => tuple(analysis, { onWork: () => {
                    events += 1;

                    if (events === stop) throw failure;
                } }), error => error === failure);
                deepStrictEqual(tuple(analysis), expected);
                strictEqual(tuple(analysis), tuple(analysis));
            });
        });
    });

    test('compiler callable creation: a named expression cannot supply an enclosing callable binding', () => {
        const source = 'function outer([value]: [number]) { const unrelated = function hidden() { return 1; }; return [value]; } hidden([3]); outer([3]);';
        const { calls = [] } = tuple(analyze(source));

        strictEqual(calls.length, 1);
        // The unresolved call is still an opaque module operation before outer.
        strictEqual(calls.at(0).status, 'unknown');
    });

    test('compiler callable creation: callable values stay separate from their unexecuted return families', () => {
        const source = 'function outer([value]: [number]) { const unrelated = () => 3; const alias = unrelated; return [alias]; } outer([3]);';
        const { status = '', fact: { families = [] } = {} } = firstCall(analyze(source));

        strictEqual(status, 'contradiction');
        deepStrictEqual(families, ['function']);
    });

    test('compiler callable creation: compiler reader failures and foreign syntax remain failures', () => {
        const input = fixture(declaration(retained.at(0)));
        const { typescript: compiler = {} } = input;
        const { SyntaxKind: { ArrowFunction = -1 } = {} } = compiler;
        const failure = new Error('callable reader failed');

        throws(() => createTypeScriptAnalysis({ ...input, typescript: { ...compiler, forEachChild(node, visit) {
            const { kind = -1 } = node;

            if (kind === ArrowFunction) throw failure;

            return compiler.forEachChild(node, visit);
        } } }), error => error === failure);
        const analysis = createTypeScriptAnalysis(input);
        const { sourceFile = {} } = fixture(declaration(retained.at(0)));
        const { statements: [node = {}] = [] } = sourceFile;

        throws(() => analysis.checkTuple({ index: 0, sourceFile, node }), /source identity mismatch/u);
        tuple(analysis);
        throws(() => analysis.checkTuple({ index: 0, sourceFile, node }), /source identity mismatch/u);
    });

    test('compiler callable creation: wider bodies add acquisition but no body demand; warm queries and revisions share evidence', () => {
        [8, 16, 32].forEach((size) => {
            const sources = [
                `${declaration('() => 1')} ${Array.from({ length: size }, (_, index) => `outer([${index}]);`).join(' ')}`,
                `${declaration('() => 1')} ${'outer('.repeat(size)}[3]${')'.repeat(size)};`,
                Array.from({ length: size }, (_, index) => `${declaration('() => 1').replaceAll('outer', `outer${index}`)} outer${index}([3]);`).join(' ')
            ];
            sources.forEach((source) => {
                const analysis = analyze(source);
                const work = counter();
                const { consumers = [] } = analysis;
                const results = consumers.map(({ index = -1 } = {}) => analysis.checkTuple({ index, ...work }));

                results.forEach(({ calls = [] } = {}) => ok(calls.every(({ status = '' } = {}) => status === 'agreement')));
                const before = work.read();
                const { counts = {} } = analysis;

                consumers.toReversed().forEach(({ index = -1 } = {}) => analysis.checkTuple({ index, ...work }));
                deepStrictEqual(work.read(), before);
                const { counts: warm = {} } = analysis;

                deepStrictEqual(warm, counts);
                const changedBody = source.replaceAll('() => 1', `() => { ${'fail();'.repeat(size)} throw external; }`);
                const revised = analyze(changedBody, { revision: 'source-2', programRevision: 'program-2' });
                const fresh = counter();

                revised.consumers.forEach(({ index = -1 } = {}) => revised.checkTuple({ index, ...fresh }));
                deepStrictEqual(fresh.read(), before);
            });
        });
    });
}

{
    const declaration = 'export function outer([value]: [number]) { if (value) { function unrelated() { return 1; } } return [value]; }';

    test('compiler conditional ownership: block names do not replace enclosing values or callable identities', async () => {
        const script = `function outer([value]: [number]) {
        function inner(input: number) { return [input]; }
        if (value) { function inner(input: number) { return [false]; } }
        return inner(value);
    }`;
        const source = `export ${script}`;
        const { calls = [] } = tuple(analyze(`${source} outer([3]); outer([0]);`));

        deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['agreement', 'agreement']);
        const { result: { status: unsupported = '' } = {} } = tuple(analyze(script));

        strictEqual(unsupported, 'unknown');
        const { outputText: sloppy = '' } = typescript.transpileModule(script, { compilerOptions: {
            target: 99, module: typescript.ModuleKind.None, strict: false, alwaysStrict: false
        } });
        const { outputText: module = '' } = typescript.transpileModule(source, { compilerOptions: { target: 99, module: 99 } });
        const { outer = false } = await import(`data:text/javascript,${encodeURIComponent(module)}`);
        const scriptOuter = Function(`${sloppy}; return outer;`)();

        if (typeof outer !== 'function' || typeof scriptOuter !== 'function') throw new TypeError('Expected native scope witnesses');

        deepStrictEqual(outer([3]), [3]);
        deepStrictEqual(scriptOuter([3]), [false]);
        deepStrictEqual(scriptOuter([0]), [0]);
    });

    test('compiler conditional ownership: reached closure creation follows the shared branch and formal completion', () => {
        const prefix = 'if (value) { const unrelated = () => { throw new Error("body"); }; }';
        const source = `export function outer([value]: [number]) { ${prefix} return [value]; }`;
        const baseline = counter();

        tuple(analyze(source), baseline);
        strictEqual(baseline.get('closure-creation'), 1);
        // Unknown calls retain separate result/use contexts; neither can lend a
        // reusable pure invocation to the other query.
        [['[3]', 1], ['[0]', 0], ['[]', 0], ['null', 0], ['external', 2]].forEach(([input = '', extra = 0] = []) => {
            const work = counter();

            tuple(analyze(`${source} outer(${input});`), work);
            strictEqual(work.get('closure-creation'), baseline.get('closure-creation') + extra);
        });
    });

    test('compiler conditional ownership: raw, transformed and fixed conditions retain native truth and initialization', async () => {
        const { program = {}, filename = '' } = fixture(declaration);
        const { code: output = '', diagnostics = [], agreements = [] } = createTypeScriptTransformer({ typescript, program }).transform({ code: declaration, fileName: filename });
        const { outputText: raw = '' } = typescript.transpileModule(declaration, { compilerOptions: program.getCompilerOptions() });
        const { output: fixed = '' } = new Linter().verifyAndFix(output, [plugin.configs.recommended, plugin.configs.contracts, plugin.configs.safety]);
        const { runtimeEvidence: { result: { fact: { families = [] } = {} } = {} } = {} } = agreements.find(({ action = '' } = {}) => action === 'preserve-native-tuple') ?? {};
        const versions = await Promise.all([raw, output, fixed].map(code => import(`data:text/javascript,${encodeURIComponent(code)}`)));

        deepStrictEqual(diagnostics, []);
        deepStrictEqual(families, ['array']);
        versions.forEach(({ outer = false } = {}) => {
            if (typeof outer !== 'function') throw new TypeError('Expected outer export');

            deepStrictEqual(outer([0]), [0]);
            // eslint-disable-next-line resilient/no-undefined-assignment -- The conditional ownership oracle must preserve native iterator exhaustion as an undefined element.
            deepStrictEqual(outer([]), [undefined]);
            throws(() => outer(), TypeError);
            throws(() => outer(null), TypeError);
            const failure = new Error('truthiness must not coerce');
            const value = { [Symbol.toPrimitive]() { throw failure; } };

            strictEqual(outer([value]).at(0), value);
            throws(() => outer({ get [Symbol.iterator]() { throw failure; } }), error => error === failure);
        });
    });

    test('compiler conditional ownership: revisions, query order and interrupted completion keep independent requirements', () => {
        const source = `${declaration} outer(['wrong']); outer(external);`;
        const expected = tuple(analyze(source));
        const { status = '', calls = [] } = expected;

        strictEqual(status, 'contradiction');
        deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['contradiction', 'unknown']);
        const revised = analyze(source.replace('[number]', '[string]'), { revision: '2', programRevision: '2' });
        const { calls: [{ status: judgment = '', fact = {} } = {}] = [] } = tuple(revised);
        const [{ fact: original = {} } = {}] = calls;

        strictEqual(judgment, 'agreement');
        deepStrictEqual(fact, original);
        const combined = analyze(`${declaration} ${declaration.replaceAll('outer', 'second').replace('[number]', '[string]')} outer([3]); second([3]);`);
        const reversed = combined.checkTuple({ index: 1 });
        const { status: reverse = '' } = reversed;

        strictEqual(reverse, 'contradiction');
        strictEqual(firstCall(combined).status, 'agreement');
        strictEqual(combined.checkTuple({ index: 1 }), reversed);
        const work = counter();

        tuple(analyze(source), work);
        const total = Object.values(work.read()).reduce((sum, count) => sum + count, 0);
        const failure = new Error('conditional observer failed');

        [1, Math.floor(total / 2), total].forEach((stop) => {
            const analysis = analyze(source);
            let events = 0;

            throws(() => tuple(analysis, { onWork: () => {
                events += 1;

                if (events === stop) throw failure;
            } }), error => error === failure);
            deepStrictEqual(tuple(analysis), expected);
        });
    });

    test('compiler conditional ownership: compiler readers fail operationally and a live session releases host syntax', () => {
        const input = fixture(declaration);
        const { typescript: compiler = {} } = input;
        const { SyntaxKind: { IfStatement = -1 } = {} } = compiler;
        const failure = new Error('conditional reader failed');

        throws(() => createTypeScriptAnalysis({ ...input, typescript: { ...compiler, forEachChild(node, visit) {
            const { kind = -1 } = node;

            if (kind === IfStatement) throw failure;

            return compiler.forEachChild(node, visit);
        } } }), error => error === failure);
        assertCompilerCollection(`${declaration} outer([3]);`);
    });

    test('compiler conditional ownership: wide and nested joins share warm demand and fresh revisions', () => {
        [8, 16, 32].forEach((size) => {
            const wide = Array.from({ length: size }, () => 'if(value){const unused=()=>1;}').join(' ');
            const nested = `${'if(value){'.repeat(size)}const unused=()=>1;${'}'.repeat(size)}`;
            const independent = Array.from({ length: size }, (_, index) => `${declaration.replaceAll('outer', `outer${index}`)} outer${index}([3]);`).join(' ');

            [`export function outer([value]:[number]){${wide}return [value];}outer(['wrong']);outer(external);`,
                `export function outer([value]:[number]){${nested}return [value];}outer(['wrong']);outer(external);`, independent].forEach((source) => {
                const analysis = analyze(source);
                const work = counter();
                const results = analysis.consumers.map(({ index = -1 } = {}) => analysis.checkTuple({ index, ...work }));

                ok(results.length);
                const before = work.read();
                const { counts = {} } = analysis;

                analysis.consumers.toReversed().forEach(({ index = -1 } = {}) => analysis.checkTuple({ index, ...work }));
                deepStrictEqual(work.read(), before);
                const { counts: warm = {} } = analysis;

                deepStrictEqual(warm, counts);
                const revised = analyze(source, { revision: '2', programRevision: '2' });
                const fresh = counter();

                revised.consumers.forEach(({ index = -1 } = {}) => revised.checkTuple({ index, ...fresh }));
                deepStrictEqual(fresh.read(), before);
                const { counts: cold = {} } = revised;

                deepStrictEqual(cold, counts);
            });
        });
    });
}

{
    const forwardedDeclaration = 'function outer([value]: [number]) { function inner(input: number) { return [input]; } return inner(value); }';
    const aliasedDeclaration = 'function outer([value]: [number]) { const result = [value]; function inner() { const result = 1; return result; } return result; }';

    test('compiler forwarding: nested compiler reader failures remain operational and foreign nodes cannot borrow evidence', () => {
        const input = fixture(forwardedDeclaration);
        const { typescript: compiler = {} } = input;
        const failure = new Error('nested compiler reader failed');

        throws(() => createTypeScriptAnalysis({ ...input, typescript: { ...compiler, forEachChild(node, visit) {
            const { name: { text = '' } = {} } = node;

            if (text === 'inner') throw failure;

            return compiler.forEachChild(node, visit);
        } } }), error => error === failure);
        const analysis = createTypeScriptAnalysis(input);
        const { sourceFile = {} } = fixture(forwardedDeclaration);
        const { statements: [node = {}] = [] } = sourceFile;

        throws(() => analysis.checkTuple({ index: 0, sourceFile, node }), /source identity mismatch/u);
        tuple(analysis);
        throws(() => analysis.checkTuple({ index: 0, sourceFile, node }), /source identity mismatch/u);
    });

    [forwardedDeclaration, aliasedDeclaration].forEach((declaration, index) => {
        [
            ['full', '[3]', 'number', 'agreement', true, false],
            ['zero', '[0]', 'number', 'agreement', true, false],
            ['short', '[]', 'nullish', 'contradiction', true, false],
            ['wrong family', "['wrong']", 'string', 'contradiction', true, false],
            ['null slot', '[null]', 'nullish', 'contradiction', true, false],
            ['omitted', '', '', 'unknown', false, true],
            ['undefined', 'undefined', '', 'unknown', false, true],
            ['null', 'null', '', 'unknown', false, true],
            ['unknown', 'external', '', 'unknown', true, true]
        ].forEach(([name = '', input = '', family = '', status = '', normal = false, thrown = false] = []) => test(`compiler forwarding ${index}: ${name}`, () => {
            const analysis = analyze(`${declaration} outer(${input});`);
            const { status: actual = '', fact: { families = [] } = {}, normal: completed = false, thrown: failed = false } = firstCall(analysis);

            strictEqual(actual, status);
            deepStrictEqual(families, family ? [family] : []);
            strictEqual(completed, normal);
            strictEqual(failed, thrown);
        }));

        test(`compiler forwarding ${index}: requirements, revisions, query order and interrupted reports retain their owners`, () => {
            const source = `${declaration} outer(['wrong']); outer(external);`;
            const expected = tuple(analyze(source));
            const { status = '', calls = [] } = expected;

            strictEqual(status, 'contradiction');
            deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['contradiction', 'unknown']);
            const changed = analyze(source.replace('[number]', '[string]'), { revision: 'source-2', programRevision: 'program-2' });
            const { calls: [{ status: revised = '', fact = {} } = {}] = [] } = tuple(changed);
            const { calls: [{ fact: original = {} } = {}] = [] } = expected;

            strictEqual(revised, 'agreement');
            deepStrictEqual(fact, original);
            strictEqual(tuple(analyze(source)).status, 'contradiction');
            const work = counter();

            tuple(analyze(source), work);
            const total = Object.values(work.read()).reduce((sum, count) => sum + count, 0);
            const failure = new Error('forwarding observer failed');

            [1, Math.floor(total / 2), total].forEach((stop) => {
                const analysis = analyze(source);
                let events = 0;

                throws(() => tuple(analysis, { onWork: () => {
                    events += 1;

                    if (events === stop) throw failure;
                } }), error => error === failure);
                deepStrictEqual(tuple(analysis), expected);
            });
            const combined = analyze(`${declaration} ${declaration.replaceAll('outer', 'second').replace('[number]', '[string]')} outer([3]); second([3]);`);
            const reverse = combined.checkTuple({ index: 1 });
            const { status: reversed = '' } = reverse;

            strictEqual(reversed, 'contradiction');
            strictEqual(tuple(combined).calls.at(0).status, 'agreement');
            strictEqual(combined.checkTuple({ index: 1 }), reverse);
        });
    });

    test('compiler forwarding: finite helper and alias chains use actual arguments, not helper annotations', () => {
        const source = `function outer([value]: [number]) {
        function first(input: string) { const alias = input; return second(alias); }
        function second(input: string) { const result = [input]; return result; }
        const alias = value;
        return first(alias);
    } outer([3]); outer(['wrong']); outer(external);`;
        const { calls = [] } = tuple(analyze(source));

        deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['agreement', 'contradiction', 'unknown']);
    });

    test('compiler forwarding: a captured module declaration cannot lend proof across an opaque owner', () => {
        const source = `function inner(input: number) { return [input]; }
        function outer([value]: [number]) { return inner(value); }
        inner = external; outer([3]);`;
        const { result: { fact: { families = [] } = {} } = {}, calls = [] } = tuple(analyze(source));

        deepStrictEqual(families, []);
        deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['unknown']);
    });

    test('compiler forwarding: wide, successive and independent consumers share warm evidence and survive revisions', () => {
        [8, 16, 32].forEach((size) => {
            const wide = `${forwardedDeclaration} ${Array.from({ length: size }, (_, index) => `outer([${index}]);`).join(' ')}`;
            const successive = `${forwardedDeclaration} ${'outer('.repeat(size)}[3]${')'.repeat(size)};`;
            const aliases = `function outer([value]: [number]) { const first = [value]; ${Array.from({ length: size }, (_, index) => (
                `const alias${index} = ${index ? `alias${index - 1}` : 'first'};`
            )).join(' ')} return alias${size - 1}; } outer([3]);`;
            const independent = Array.from({ length: size }, (_, index) => `${aliasedDeclaration.replaceAll('outer', `outer${index}`)} outer${index}([3]);`).join(' ');

            [wide, successive, aliases, independent].forEach((source) => {
                const analysis = analyze(source);
                const work = counter();
                const results = analysis.consumers.map(({ index = -1 } = {}) => analysis.checkTuple({ index, ...work }));

                results.forEach(({ calls = [] } = {}) => ok(calls.every(({ status = '' } = {}) => status === 'agreement')));
                const before = work.read();
                const { counts = {} } = analysis;

                analysis.consumers.toReversed().forEach(({ index = -1 } = {}) => analysis.checkTuple({ index, ...work }));
                deepStrictEqual(work.read(), before);
                const { counts: warm = {} } = analysis;

                deepStrictEqual(warm, counts);
                const revised = analyze(source, { revision: 'source-2', programRevision: 'program-2' });
                const fresh = counter();

                revised.consumers.forEach(({ index = -1 } = {}) => revised.checkTuple({ index, ...fresh }));
                deepStrictEqual(fresh.read(), before);
                const { counts: cold = {} } = revised;

                deepStrictEqual(cold, counts);
            });
        });
    });
}

{
    const declaration = 'function outer([value]: [number]) { return [value]; }';
    const pairDeclaration = 'function outer([left, right]: [number, number]) { return [left, right]; }';
    const mixedDeclaration = 'function outer([count, label]: [number, string]) { return [count, label]; }';
    const forwardedDeclaration = 'function outer([value]: [number]) { function inner(input: number) { return [input]; } return inner(value); }';
    const aliasedDeclaration = 'function outer([value]: [number]) { const result = [value]; function inner() { const result = 1; return result; } return result; }';

    [
        ['full', '[3]', 'number', 'agreement', true, false],
        ['short', '[]', 'nullish', 'contradiction', true, false],
        ['explicit slot absence', '[undefined]', 'nullish', 'contradiction', true, false],
        ['supplied null slot', '[null]', 'nullish', 'contradiction', true, false],
        ['wrong family', '["value"]', 'string', 'contradiction', true, false],
        ['falsey supplied value', '[false]', 'boolean', 'contradiction', true, false],
        ['zero', '[0]', 'number', 'agreement', true, false],
        ['omitted', '', '', 'unknown', false, true],
        ['undefined argument', 'undefined', '', 'unknown', false, true],
        ['null argument', 'null', '', 'unknown', false, true],
        ['unknown iterable', 'external', '', 'unknown', true, true],
        ['unknown element', '[external]', '', 'unknown', true, true]
    ].forEach(([name = '', input = '', family = '', status = '', normal = false, thrown = false] = []) => test(`compiler tuple: ${name}`, () => {
        const analysis = analyze(`${declaration} outer(${input});`);
        const { status: actual = '', fact: { families = [] } = {}, normal: completed = false, thrown: failed = false } = firstCall(analysis);

        strictEqual(actual, status);
        deepStrictEqual(families, family ? [family] : []);
        strictEqual(completed, normal);
        strictEqual(failed, thrown);
    }));

    test('compiler tuple: annotation is a requirement, never generic slot evidence', () => {
        const analysis = analyze();
        const { descriptor: { requirement = {}, binding = {}, parameter = {} } = {}, result = {}, status = '', source = {} } = tuple(analysis);
        const { family = '', provenance = '' } = requirement;
        const { normal = false, thrown = false, fact: { families = [] } = {} } = result;

        strictEqual(status, 'unknown');
        strictEqual(family, 'number');
        strictEqual(provenance, 'tuple-annotation');
        deepStrictEqual(families, ['array']);
        strictEqual(normal, true);
        strictEqual(thrown, true);
        const { source: bindingSource = {} } = binding;
        const { source: parameterSource = {} } = parameter;

        strictEqual(bindingSource, source);
        strictEqual(parameterSource, source);
        ok(Object.isFrozen(tuple(analysis)));
        ok(Object.isFrozen(requirement));
    });

    test('compiler tuple: known contradiction survives an unknown invocation', () => {
        const analysis = analyze(`${declaration} outer(['wrong']); outer(external);`);
        const { status = '', calls = [] } = tuple(analysis);

        strictEqual(status, 'contradiction');
        deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['contradiction', 'unknown']);
    });

    test('compiler tuple: an unacquired static dependency invalidates earlier textual invocation premises', () => {
        const analysis = analyze(`${declaration} outer([3]); import './dependency.js';`);

        strictEqual(firstCall(analysis).status, 'unknown');
    });

    [
        'function outer([value]: [number]) { return [other]; }',
        'function outer([value]: [number]) { let other=value; return [other]; }',
        'function outer([value = 0]: [number]) { return [value]; }',
        'function outer([value]: [number] = [0]) { return [value]; }',
        'function outer([[value]]: [[number]]) { return [value]; }',
        'function outer([value, ...rest]: [number]) { return [value]; }',
        'const outer = ([value]: [number]) => [value];',
        'async function outer([value]: [number]) { return [value]; }',
        'function* outer([value]: [number]) { return [value]; }',
        'function outer([value]: [boolean]) { return [value]; }'
    ].forEach((source, index) => test(`compiler tuple: formal requirement eligibility ${index} is independent of the body`, () => {
        strictEqual(analyze(source).consumers.length, [0, 1, 6, 9].includes(index) ? 1 : 0);
    }));

    [
        'function scope(outer: any) { outer([3]); }',
        'function scope() { outer([3]); const outer = external; }',
        'function scope() { const outer = external; outer([3]); }',
        'outer = external; outer([3]);',
        'external(); outer([3]);'
    ].forEach((source, index) => test(`compiler tuple: lexical or lifetime barrier ${index}`, () => {
        const analysis = analyze(`${declaration} ${source}`);
        const { calls = [] } = tuple(analysis);

        ok(calls.every(({ status = '' } = {}) => status === 'unknown'));
    }));

    test('compiler tuple: nested declaration and same-spelled parameter keep separate identities', () => {
        const source = `${declaration} function scope() { function outer([value]: [number]) { return [value]; } outer([9]); } outer([3]);`;
        const analysis = analyze(source);
        const { consumers = [] } = analysis;
        const [outer = {}, inner = {}] = consumers;

        strictEqual(consumers.length, 2);
        const { binding: outerBinding = {} } = outer;
        const { binding: innerBinding = {} } = inner;

        ok(outerBinding !== innerBinding);
        const { calls: outerCalls = [] } = tuple(analysis);
        const { calls: innerCalls = [] } = analysis.checkTuple({ index: 1 });

        deepStrictEqual(outerCalls.map(({ status = '' } = {}) => status), ['agreement']);
        deepStrictEqual(innerCalls.map(({ status = '' } = {}) => status), ['agreement']);
        const sameName = analyze('function outer([outer]: [number]) { return [outer]; } outer([3]);');

        strictEqual(firstCall(sameName).status, 'agreement');
    });

    [
        `namespace Other { ${declaration} }`,
        `switch (external) { case 0: ${declaration} }`
    ].forEach((scope, index) => test(`compiler tuple: unsupported scope ${index} cannot lend or shadow an outer callable`, () => {
        const unbound = analyze(`outer([3]); ${scope}`);
        const bound = analyze(`${declaration} outer(['wrong']); ${scope}`);

        deepStrictEqual(tuple(unbound).calls, []);
        strictEqual(tuple(bound).status, 'contradiction');
        deepStrictEqual(bound.checkTuple({ index: 1 }).calls, []);
    }));

    test('compiler tuple: source, file, Program and option revisions are separate owned identities', () => {
        const initial = analyze(`${declaration} outer([0]);`);
        const changed = analyze(`${declaration} outer([x]);`, { revision: 'source-2' });
        const dependent = analyze(`${declaration} outer([0]);`, { programRevision: 'program-2' });
        const otherFile = analyze(`${declaration} outer([0]);`, { filename: resolve('other-compiler-tuple.ts') });
        const optionsInput = fixture(`${declaration} outer([0]);`);
        const { program = {} } = optionsInput;
        const options = { ...program.getCompilerOptions(), strict: true };
        const revisedOptions = createTypeScriptAnalysis({ ...optionsInput, program: false, compilerOptionsIdentity: JSON.stringify(options) });

        strictEqual(firstCall(initial).status, 'agreement');
        strictEqual(firstCall(changed).status, 'unknown');
        strictEqual(firstCall(initial).status, 'agreement');
        const { source: { digest: originalDigest = '', programRevision: originalProgram = '', filename: originalFile = '', compilerOptionsIdentity: originalOptions = '' } = {} } = initial;
        const { source: { digest: revisedDigest = '' } = {} } = changed;
        const { source: { programRevision: revisedProgram = '' } = {} } = dependent;
        const { source: { filename: revisedFile = '' } = {} } = otherFile;
        const { source: { compilerOptionsIdentity: revisedConfiguration = '' } = {} } = revisedOptions;

        ok(originalDigest !== revisedDigest);
        ok(originalProgram !== revisedProgram);
        ok(originalFile !== revisedFile);
        ok(originalOptions !== revisedConfiguration);
        strictEqual(firstCall(dependent).status, 'agreement');
    });

    test('compiler tuple: parser, source, Program and accessor failures are operational errors', () => {
        const input = fixture();
        const { sourceFile = {} } = input;
        const failure = new Error('host failed');

        throws(() => createTypeScriptAnalysis({ ...input, sourceText: declaration + ' ' }), /identity mismatch/u);
        throws(() => createTypeScriptAnalysis({ ...input, filename: resolve('wrong-file.ts') }), /identity mismatch/u);
        throws(() => createTypeScriptAnalysis({ ...input, compilerOptionsIdentity: '{}' }), /Program mismatch/u);
        throws(() => createTypeScriptAnalysis({ ...input, program: fixture().program }), /Program mismatch/u);
        throws(() => createTypeScriptAnalysis({ ...input, program: { getSourceFile() { throw failure; }, getCompilerOptions: () => ({}) } }), error => error === failure);
        throws(() => createTypeScriptAnalysis({ ...input, sourceFile: new Proxy(sourceFile, { get(target, name, receiver) {
            if (name === 'text') throw failure;

            return Reflect.get(target, name, receiver);
        } }) }), error => error === failure);
        throws(() => analyze('function outer([value]: [number]) { return [value];'), SyntaxError);
        throws(() => createTypeScriptAnalysis({ ...input, revision: {} }), TypeError);
    });

    test('compiler tuple: observer failure aborts completion and retry uses the same shared evidence', () => {
        const failure = new Error('observer failed');

        [1, 8, 25, 50].forEach((stop) => {
            const analysis = analyze(`${declaration} outer(['wrong']); outer(external);`);
            let events = 0;

            throws(() => tuple(analysis, { onWork: () => {
                events += 1;

                if (events === stop) throw failure;
            } }), error => error === failure);
            deepStrictEqual(tuple(analysis), tuple(analyze(`${declaration} outer(['wrong']); outer(external);`)));
            strictEqual(tuple(analysis), tuple(analysis));
        });
    });

    test('compiler tuple: wide and successive demand stays shared on warm queries', () => {
        [8, 16, 32].forEach((size) => {
            const wide = `${declaration} ${Array.from({ length: size }, (_, index) => `outer([${index}]);`).join(' ')}`;
            const successive = `${declaration} ${'outer('.repeat(size)}[3]${')'.repeat(size)};`;

            [wide, successive].forEach((source) => {
                const analysis = analyze(source);
                const work = counter();
                const { calls = [] } = tuple(analysis, work);

                strictEqual(calls.length, size);
                ok(calls.every(({ status = '' } = {}) => status === 'agreement'));
                const before = work.read();
                const { counts: retained = {} } = analysis;

                tuple(analysis, work);
                deepStrictEqual(work.read(), before);
                const { counts: after = {} } = analysis;

                deepStrictEqual(after, retained);
            });
        });
    });

    [declaration, pairDeclaration, mixedDeclaration, forwardedDeclaration, aliasedDeclaration].forEach((declaration, index) => test(`compiler tuple: session ${index} releases host inputs`, () => {
        assertCompilerCollection(declaration + (index === 2 ? " outer([3,'label']);" : ' outer([3,4]);'));
    }));

    [declaration, forwardedDeclaration, aliasedDeclaration].forEach((declaration, index) => test(`compiler tuple ${index}: completed shared evidence reaches native output and its report`,
        async () => {
            const code = `export ${declaration}`;
            const { program = {}, filename = '' } = fixture(code);
            const { code: output = '', diagnostics = [], agreements = [] } = createTypeScriptTransformer({ typescript, program }).transform({ code, fileName: filename });
            const { runtimeEvidence = {} } = agreements.find(({ action = '' } = {}) => action === 'preserve-native-tuple') ?? {};
            const { descriptor: { requirement: { provenance = '' } = {} } = {}, result: { fact: { families = [] } = {} } = {} } = runtimeEvidence;
            const { outputText: raw = '' } = typescript.transpileModule(code, { compilerOptions: program.getCompilerOptions() });
            const { output: fixed = '' } = new Linter().verifyAndFix(output, [plugin.configs.recommended, plugin.configs.contracts, plugin.configs.safety]);
            const versions = await Promise.all([raw, output, fixed].map(code => import(`data:text/javascript,${encodeURIComponent(code)}`)));

            deepStrictEqual(diagnostics, []);
            strictEqual(provenance, 'tuple-annotation');
            deepStrictEqual(families, ['array']);
            ok(Object.isFrozen(runtimeEvidence));
            versions.forEach(({ outer = false } = {}) => {
                if (typeof outer !== 'function') throw new TypeError('Expected outer export');

                deepStrictEqual(outer([3]), [3]);
                // eslint-disable-next-line resilient/no-undefined-assignment -- Tuple acquisition fixtures preserve supplied null and native undefined slots, including holes and iterator exhaustion.
                deepStrictEqual(outer([]), [undefined]);
                strictEqual(Object.hasOwn(outer([]), 0), true);
                throws(() => outer(), TypeError);
                throws(() => outer(undefined), TypeError);
                throws(() => outer(null), TypeError);
                const value = {};

                strictEqual(outer([value]).at(0), value);
                let events = [];
                const iterator = {
                    next() { strictEqual(this, iterator); events = [...events, 'next'];

                        return { value, done: false }; },
                    return() { strictEqual(this, iterator); events = [...events, 'close'];

                        return { done: true }; }
                };
                const input = { [Symbol.iterator]() { strictEqual(this, input); events = [...events, 'iterator'];

                    return iterator; } };

                strictEqual(outer(input).at(0), value);
                deepStrictEqual(events, ['iterator', 'next', 'close']);
                const failure = new Error('iterator getter failed');

                throws(() => outer({ get [Symbol.iterator]() { throw failure; } }), error => error === failure);
                throws(() => outer({ [Symbol.iterator]() { return { next() { return { get value() { throw failure; }, done: false }; } }; } }), error => error === failure);
                throws(() => outer({ [Symbol.iterator]() { return { next() { return { value, done: false }; }, return() { throw failure; } }; } }), error => error === failure);
            });
        }));

    test('compiler tuple: standalone compiler source uses the same completed evidence without a checker', () => {
        const { code = '', agreements = [] } = createTypeScriptTransformer({ typescript }).transform({ code: declaration });
        const [{ runtimeEvidence: { descriptor: { requirement: { provenance = '' } = {} } = {} } = {} } = {}] = agreements;

        strictEqual(provenance, 'tuple-annotation');
        ok(code.includes('return [value]'));
    });

    test('compiler tuple: completed product report retains a contradiction beside unknown evidence', () => {
        const { diagnostics = [], agreements = [] } = createTypeScriptTransformer({ typescript }).transform({
            code: `${declaration} outer(['wrong']); outer(external);`
        });
        const [{ runtimeEvidence: { status = '', calls = [] } = {} } = {}] = agreements;

        deepStrictEqual(diagnostics, []);
        strictEqual(status, 'contradiction');
        deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['contradiction', 'unknown']);
    });

    test('compiler tuple: omitted transform text uses the Program; explicit mismatching text fails', () => {
        const { program = {}, filename = '' } = fixture();
        const transformer = createTypeScriptTransformer({ typescript, program });
        const { agreements = [] } = transformer.transform({ fileName: filename });

        strictEqual(agreements.length, 1);
        throws(() => transformer.transform({ fileName: filename, code: '' }), /identity mismatch/u);
        throws(() => transformer.transform({ fileName: filename, code: declaration + ' ' }), /identity mismatch/u);
    });

    test('compiler tuple: compiler option identity excludes cyclic config syntax metadata', () => {
        const input = fixture();
        const { program = {}, sourceFile = {} } = input;
        const options = program.getCompilerOptions();
        const withMetadata = { ...program, getCompilerOptions: () => ({ ...options, configFile: sourceFile }) };
        const analysis = createTypeScriptAnalysis({ ...input, program: withMetadata });

        strictEqual(tuple(analysis).status, 'unknown');
        throws(() => createTypeScriptAnalysis({ ...input, program: { ...withMetadata, getCompilerOptions: () => ({ ...options, strict: true }) } }), /Program mismatch/u);
    });

    [
        ['full', '[3,4]', ['number', 'number'], ['agreement', 'agreement'], true, false],
        ['short', '[3]', ['number', 'nullish'], ['agreement', 'contradiction'], true, false],
        ['empty', '[]', ['nullish', 'nullish'], ['contradiction', 'contradiction'], true, false],
        ['first contradiction', '["wrong",4]', ['string', 'number'], ['contradiction', 'agreement'], true, false],
        ['second contradiction', '[3,"wrong"]', ['number', 'string'], ['agreement', 'contradiction'], true, false],
        ['both contradictions', '[false,""]', ['boolean', 'string'], ['contradiction', 'contradiction'], true, false],
        ['null slot', '[3,null]', ['number', 'nullish'], ['agreement', 'contradiction'], true, false],
        ['undefined slot', '[3,undefined]', ['number', 'nullish'], ['agreement', 'contradiction'], true, false],
        ['zero slots', '[0,0]', ['number', 'number'], ['agreement', 'agreement'], true, false],
        ['extra slot', '[3,4,"unused"]', ['number', 'number'], ['agreement', 'agreement'], true, false],
        ['omitted', '', ['', ''], ['unknown', 'unknown'], false, true],
        ['undefined input', 'undefined', ['', ''], ['unknown', 'unknown'], false, true],
        ['null input', 'null', ['', ''], ['unknown', 'unknown'], false, true],
        ['unknown input', 'external', ['', ''], ['unknown', 'unknown'], true, true]
    ].forEach(([name = '', input = '', families = [], statuses = [], normal = false, thrown = false] = []) => test(`compiler pair: ${name}`, () => {
        const { slots = [], normal: completed = false, thrown: failed = false, status = '' } = firstCall(analyze(`${pairDeclaration} outer(${input});`));

        deepStrictEqual(slots.map(({ slot = -1 } = {}) => slot), [0, 1]);
        deepStrictEqual(slots.map(({ result: { status = '' } = {} } = {}) => status), statuses);
        deepStrictEqual(slots.map(({ result: { fact: { families = [] } = {} } = {} } = {}) => families), families.map(family => family ? [family] : []));
        strictEqual(status, statuses.includes('contradiction') ? 'contradiction' : statuses.at(0));
        strictEqual(completed, normal);
        strictEqual(failed, thrown);
        slots.forEach(({ result: { normal: slotNormal = false, thrown: slotThrown = false } = {} } = {}) => {
            strictEqual(slotNormal, normal);
            strictEqual(slotThrown, thrown);
        });
    }));

    test('compiler pair: both requirements retain lexical provenance without supplying generic values', () => {
        const analysis = analyze(pairDeclaration);
        const { descriptor: { slots = [] } = {}, result: { normal = false, thrown = false } = {}, status = '', source = {} } = tuple(analysis);

        strictEqual(status, 'unknown');
        strictEqual(normal, true);
        strictEqual(thrown, true);
        deepStrictEqual(slots.map(({ binding: { range: [start = 0, end = 0] = [] } = {} } = {}) => pairDeclaration.slice(start, end).trim()), ['left', 'right']);
        slots.forEach(({ binding: { source: bindingSource = {} } = {}, requirement = {} } = {}) => {
            const { family = '', provenance = '', location: { source: requirementSource = {} } = {} } = requirement;

            strictEqual(bindingSource, source);
            strictEqual(requirementSource, source);
            strictEqual(family, 'number');
            strictEqual(provenance, 'tuple-annotation');
            ok(Object.isFrozen(requirement));
        });
        ok(Object.isFrozen(slots));
    });

    [
        'function outer([left, right]: [number, number]) { return [right, left]; }',
        'function outer([left, right]: [number, number]) { return [left, left]; }',
        'function outer([left, right]: [number, boolean]) { return [left, right]; }',
        'function outer([left, right]: [number]) { return [left, right]; }',
        'function outer([left, right = 0]: [number, number]) { return [left, right]; }',
        'function outer([left, ...right]: [number, number]) { return [left, right]; }',
        'function outer([left, [right]]: [number, number]) { return [left, right]; }',
        'function outer([left, right]: [number, number?]) { return [left, right]; }',
        'function outer([left, right, last]: [number, number, number]) { return [left, right, last]; }'
    ].forEach((source, index) => test(`compiler pair: formal requirements ${index} do not prescribe returned positions`, () => {
        strictEqual(analyze(source).consumers.length, [0, 1, 2, 8].includes(index) ? 1 : 0);
    }));

    test('compiler pair: completed product report keeps a second-slot contradiction beside an unknown call', () => {
        const { diagnostics = [], agreements = [] } = createTypeScriptTransformer({ typescript }).transform({
            code: `${pairDeclaration} outer([3,'wrong']); outer(external);`
        });
        const [{ runtimeEvidence: { status = '', calls = [] } = {} } = {}] = agreements;

        deepStrictEqual(diagnostics, []);
        strictEqual(status, 'contradiction');
        deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['contradiction', 'unknown']);
        deepStrictEqual(calls.map(({ slots = [] } = {}) => slots.map(({ result: { status = '' } = {} } = {}) => status)),
            [['agreement', 'contradiction'], ['unknown', 'unknown']]);
        ok(calls.every(({ slots = [] } = {}) => Object.isFrozen(slots)));
    });

    test('compiler pair: renamed bindings, nested shadows and source revisions retain their own slots', () => {
        const renamed = 'function outer([outer, second]: [number, number]) { return [outer, second]; }';
        const initial = analyze(`${renamed} outer([3,'wrong']);`);
        const revised = analyze(`${renamed} outer(['wrong',3]);`, { revision: 'source-2', programRevision: 'program-2' });
        const statuses = analysis => firstCall(analysis).slots.map(({ result: { status = '' } = {} } = {}) => status);

        deepStrictEqual(statuses(initial), ['agreement', 'contradiction']);
        deepStrictEqual(statuses(revised), ['contradiction', 'agreement']);
        deepStrictEqual(statuses(initial), ['agreement', 'contradiction']);
        const nested = analyze(`${pairDeclaration} function scope() { ${pairDeclaration} outer([3,4]); } outer([3,'wrong']);`);

        strictEqual(tuple(nested).status, 'contradiction');
        strictEqual(nested.checkTuple({ index: 1 }).status, 'unknown');
        const { sourceFile = {} } = fixture(renamed);

        throws(() => initial.checkTuple({ index: 0, sourceFile, node: sourceFile.statements.at(0) }), /source identity mismatch/u);
    });

    [pairDeclaration, mixedDeclaration].forEach((declaration, index) => test(`compiler pair ${index}: interrupted queries never publish a partial tuple answer`, () => {
        const source = `${declaration} outer(${index ? '[3,4]' : "[3,'wrong']"}); outer(external);`;
        const expected = tuple(analyze(source));
        const work = counter();

        tuple(analyze(source), work);
        const total = Object.values(work.read()).reduce((sum, count) => sum + count, 0);
        const failure = new Error('pair observer failed');

        [1, Math.floor(total / 2), total].forEach((stop) => {
            const analysis = analyze(source);
            let events = 0;

            throws(() => tuple(analysis, { onWork: () => {
                events += 1;

                if (events === stop) throw failure;
            } }), error => error === failure);
            deepStrictEqual(tuple(analysis), expected);
            strictEqual(tuple(analysis), tuple(analysis));
        });
    }));

    test('compiler pair: wide and successive calls share execution across both slot queries', () => {
        [8, 16, 32].forEach((size) => {
            const wide = `${pairDeclaration} ${Array.from({ length: size }, (_, index) => `outer([${index},'wrong']);`).join(' ')}`;
            const successive = `${pairDeclaration} ${'outer('.repeat(size)}[3,'wrong']${')'.repeat(size)};`;

            [wide, successive].forEach((source) => {
                const analysis = analyze(source);
                const work = counter();
                const { calls = [] } = tuple(analysis, work);

                strictEqual(calls.length, size);
                calls.forEach(({ slots = [] } = {}) => {
                    deepStrictEqual(slots.map(({ result: { status = '' } = {} } = {}) => status), ['agreement', 'contradiction']);
                });
                const before = work.read();
                const { counts = {} } = analysis;

                tuple(analysis, work);
                deepStrictEqual(work.read(), before);
                const { counts: after = {} } = analysis;

                deepStrictEqual(after, counts);
            });
        });
    });

    [pairDeclaration, mixedDeclaration].forEach((declaration, index) => test(`compiler pair ${index}: raw, transformed and fixed output preserve ordered native iteration and failures`, async () => {
        const code = `export ${declaration}`;
        const { program = {}, filename = '' } = fixture(code);
        const { code: output = '', diagnostics = [], agreements = [] } = createTypeScriptTransformer({ typescript, program }).transform({ code, fileName: filename });
        const { outputText: raw = '' } = typescript.transpileModule(code, { compilerOptions: program.getCompilerOptions() });
        const { output: fixed = '' } = new Linter().verifyAndFix(output, [plugin.configs.recommended, plugin.configs.contracts, plugin.configs.safety]);
        const versions = await Promise.all([raw, output, fixed].map(code => import(`data:text/javascript,${encodeURIComponent(code)}`)));
        const [{ runtimeEvidence: { descriptor: { slots = [] } = {} } = {} } = {}] = agreements;

        deepStrictEqual(diagnostics, []);
        strictEqual(slots.length, 2);
        versions.forEach(({ outer = false } = {}) => {
            if (typeof outer !== 'function') throw new TypeError('Expected pair export');

            deepStrictEqual(outer([3, 4, 5]), [3, 4]);
            // eslint-disable-next-line resilient/no-undefined-assignment -- Tuple acquisition fixtures preserve supplied null and native undefined slots, including holes and iterator exhaustion.
            deepStrictEqual(outer([3]), [3, undefined]);
            // eslint-disable-next-line resilient/no-undefined-assignment -- Tuple acquisition fixtures preserve supplied null and native undefined slots, including holes and iterator exhaustion.
            deepStrictEqual(outer([]), [undefined, undefined]);
            deepStrictEqual(Object.keys(outer([])), ['0', '1']);
            // eslint-disable-next-line resilient/no-undefined-assignment -- Tuple acquisition fixtures preserve supplied null and native undefined slots, including holes and iterator exhaustion.
            deepStrictEqual(outer(Array(1).concat(4)), [undefined, 4]);
            // eslint-disable-next-line resilient/no-null-assignment -- Tuple acquisition fixtures preserve supplied null and native undefined slots, including holes and iterator exhaustion.
            deepStrictEqual(outer([null, false]), [null, false]);
            throws(() => outer(), TypeError);
            throws(() => outer(undefined), TypeError);
            throws(() => outer(null), TypeError);
            const left = {};
            const right = {};
            const [first = {}, second = {}] = outer([left, right]);

            strictEqual(first, left);
            strictEqual(second, right);
        });
        const stages = ['iterator-get', 'iterator', 'next:0', 'done:0', 'value:0', 'next:1', 'done:1', 'value:1', 'close-get', 'close'];
        const observe = ({ outer = false } = {}, fail = '') => {
            if (typeof outer !== 'function') throw new TypeError('Expected pair export');

            const failure = new Error(fail);
            let events = [];
            let position = 0;
            const event = (name) => {
                events = [...events, name];

                if (name === fail) throw failure;
            };
            const iterator = {
                next() {
                    strictEqual(this, iterator);
                    const slot = position;

                    position += 1;
                    event(`next:${slot}`);

                    return {
                        get done() { event(`done:${slot}`);

                            return fail === 'early-done'; },
                        get value() { event(`value:${slot}`);

                            return slot + 3; }
                    };
                },
                get return() {
                    event('close-get');

                    // eslint-disable-next-line no-restricted-syntax -- IteratorClose must call the retained return method with the iterator receiver.
                    return function close() {
                        strictEqual(this, iterator);
                        event('close');

                        return { done: true };
                    };
                }
            };
            const input = { get [Symbol.iterator]() {
                event('iterator-get');

                // eslint-disable-next-line no-restricted-syntax -- Iterator acquisition must call the retained method with the iterable receiver.
                return function open() {
                    strictEqual(this, input);
                    event('iterator');

                    return iterator;
                };
            } };

            try {
                return { state: 'return', value: outer(input), events };
            } catch (error) {
                strictEqual(error, failure);

                return { state: 'throw', events };
            }
        };
        ['', 'early-done', ...stages].forEach((failure) => {
            const [expected = {}, ...actual] = versions.map(version => observe(version, failure));

            actual.forEach(result => deepStrictEqual(result, expected));

            if (!failure) deepStrictEqual(expected, { state: 'return', value: [3, 4], events: stages });

            // eslint-disable-next-line resilient/no-undefined-assignment -- Tuple acquisition fixtures preserve supplied null and native undefined slots, including holes and iterator exhaustion.
            if (failure === 'early-done') deepStrictEqual(expected, { state: 'return', value: [undefined, undefined], events: stages.slice(0, 4) });
        });
    }));

    [
        ['full', '[3,"label"]', ['number', 'string'], ['agreement', 'agreement'], true, false],
        ['falsey values', '[0,""]', ['number', 'string'], ['agreement', 'agreement'], true, false],
        ['first mismatch', '["wrong","label"]', ['string', 'string'], ['contradiction', 'agreement'], true, false],
        ['second mismatch', '[3,4]', ['number', 'number'], ['agreement', 'contradiction'], true, false],
        ['swapped values', '["label",3]', ['string', 'number'], ['contradiction', 'contradiction'], true, false],
        ['short', '[3]', ['number', 'nullish'], ['agreement', 'contradiction'], true, false],
        ['empty', '[]', ['nullish', 'nullish'], ['contradiction', 'contradiction'], true, false],
        ['null slot', '[3,null]', ['number', 'nullish'], ['agreement', 'contradiction'], true, false],
        ['undefined slot', '[3,undefined]', ['number', 'nullish'], ['agreement', 'contradiction'], true, false],
        ['omitted', '', ['', ''], ['unknown', 'unknown'], false, true],
        ['null input', 'null', ['', ''], ['unknown', 'unknown'], false, true],
        ['undefined input', 'undefined', ['', ''], ['unknown', 'unknown'], false, true],
        ['unknown input', 'external', ['', ''], ['unknown', 'unknown'], true, true]
    ].forEach(([name = '', input = '', families = [], statuses = [], normal = false, thrown = false] = []) => test(`compiler mixed tuple: ${name}`, () => {
        const analysis = analyze(`${mixedDeclaration} outer(${input});`);
        const { slots = [], normal: completed = false, thrown: failed = false } = firstCall(analysis);

        deepStrictEqual(slots.map(({ requirement: { family = '' } = {} } = {}) => family), ['number', 'string']);
        deepStrictEqual(slots.map(({ result: { status = '' } = {} } = {}) => status), statuses);
        deepStrictEqual(slots.map(({ result: { fact: { families = [] } = {} } = {} } = {}) => families), families.map(family => family ? [family] : []));
        strictEqual(completed, normal);
        strictEqual(failed, thrown);
    }));

    [
        ['function outer([text]: [string]) { return [text]; }', '[""]', ['string']],
        ['function outer([label, count]: [string, number]) { return [label, count]; }', '["",0]', ['string', 'number']],
        ['function outer([left, right]: [string, string]) { return [left, right]; }', '["left",""]', ['string', 'string']]
    ].forEach(([declaration = '', input = '', required = []] = [], index) => test(`compiler string requirements: positional combination ${index}`, () => {
        const analysis = analyze(`${declaration} outer(${input});`);
        const { descriptor: { slots = [] } = {}, status = '' } = tuple(analysis);

        strictEqual(status, 'unknown');
        deepStrictEqual(slots.map(({ requirement: { family = '' } = {} } = {}) => family), required);
        strictEqual(firstCall(analysis).status, 'agreement');
        const { status: rejected = '' } = firstCall(analyze(`${declaration} outer([false,false]);`));

        strictEqual(rejected, 'contradiction');
    }));

    [
        'type Label = string; function outer([count, label]: [number, Label]) { return [count, label]; }',
        'function outer([count, label]: [number, string | number]) { return [count, label]; }',
        'function outer([count, label]: [number, "label"]) { return [count, label]; }',
        'function outer([count, label]: [number, String]) { return [count, label]; }'
    ].forEach((source, index) => test(`compiler string requirements: unadmitted type syntax ${index} supplies no proof`, () => {
        deepStrictEqual(analyze(source).consumers, []);
    }));

    test('compiler mixed tuple: changed requirements never change the acquired runtime values', () => {
        const code = `${mixedDeclaration} outer([3,'label']);`;
        const revisedCode = code.replace('[number, string]', '[string, number]');
        const initialInput = fixture(code);
        const revisedInput = fixture(revisedCode, { revision: 'source-2', programRevision: 'program-2' });
        const initial = createTypeScriptAnalysis(initialInput);
        const revised = createTypeScriptAnalysis(revisedInput);
        const { descriptor: { slots = [] } = {} } = tuple(initial);
        const { result: { fact: generic = {} } = {} } = tuple(analyze(mixedDeclaration));
        const { result: { fact: revisedGeneric = {} } = {} } = tuple(analyze(mixedDeclaration.replace('[number, string]', '[string, number]')));

        slots.forEach(({ requirement: { family = '', location: { range: [start = 0, end = 0] = [] } = {} } = {} } = {}) => {
            strictEqual(code.slice(start, end).trim(), family);
        });
        deepStrictEqual(generic, revisedGeneric);
        const { slots: original = [] } = firstCall(initial);
        const { slots: changed = [] } = firstCall(revised);

        deepStrictEqual(original.map(({ result: { fact = {} } = {} } = {}) => fact), changed.map(({ result: { fact = {} } = {} } = {}) => fact));
        deepStrictEqual(original.map(({ result: { status = '' } = {} } = {}) => status), ['agreement', 'agreement']);
        deepStrictEqual(changed.map(({ result: { status = '' } = {} } = {}) => status), ['contradiction', 'contradiction']);
        strictEqual(firstCall(initial).status, 'agreement');
        const { sourceFile = {} } = revisedInput;

        throws(() => initial.checkTuple({ index: 0, sourceFile, node: sourceFile.statements.at(0) }), /source identity mismatch/u);
    });

    test('compiler mixed tuple: separate consumers retain opposite requirements across query order', () => {
        const second = 'function other([label, count]: [string, number]) { return [label, count]; }';
        const analysis = analyze(`${mixedDeclaration} ${second} outer([3,4]); other([3,4]); outer(external); other(external);`);
        const reverse = [1, 0].map(index => analysis.checkTuple({ index }));

        reverse.forEach(({ status = '', calls = [] } = {}) => {
            strictEqual(status, 'contradiction');
            deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['contradiction', 'unknown']);
        });
        const [{ calls: [{ slots: secondSlots = [] } = {}] = [] } = {}, { calls: [{ slots: firstSlots = [] } = {}] = [] } = {}] = reverse;

        deepStrictEqual(firstSlots.map(({ result: { status = '' } = {} } = {}) => status), ['agreement', 'contradiction']);
        deepStrictEqual(secondSlots.map(({ result: { status = '' } = {} } = {}) => status), ['contradiction', 'agreement']);
        strictEqual(tuple(analysis), reverse.at(1));
        strictEqual(analysis.checkTuple({ index: 1 }), reverse.at(0));
    });

    test('compiler mixed tuple: completed product report retains requirements, contradictions and unknown calls', () => {
        const { diagnostics = [], agreements = [] } = createTypeScriptTransformer({ typescript }).transform({
            code: `${mixedDeclaration} outer([3,4]); outer(external);`
        });
        const [{ runtimeEvidence: { status = '', descriptor: { slots = [] } = {}, calls = [] } = {} } = {}] = agreements;

        deepStrictEqual(diagnostics, []);
        strictEqual(status, 'contradiction');
        deepStrictEqual(slots.map(({ requirement: { family = '' } = {} } = {}) => family), ['number', 'string']);
        deepStrictEqual(calls.map(({ status = '' } = {}) => status), ['contradiction', 'unknown']);
    });
}
