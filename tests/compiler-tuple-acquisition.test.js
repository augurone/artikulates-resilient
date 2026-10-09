import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { Linter } from 'eslint';
import typescript from 'typescript';

import plugin from 'eslint-plugin-resilient';
import { createTypeScriptAnalysis } from 'eslint-plugin-resilient/analyzer/typescript';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { assertCompilerCollection } from './support/compiler-retention.js';
import { analyze, firstCall, fixture, tuple } from './support/compiler-source.js';
import { counter } from './support/work.js';

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
    'Array.prototype[Symbol.iterator] = external; outer([3]);',
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

[declaration, forwardedDeclaration, aliasedDeclaration].forEach((declaration, index) => test(`compiler tuple ${index}: completed shared evidence reaches native output and its report`, async () => {
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
        deepStrictEqual(outer([3]), [3, undefined]);
        deepStrictEqual(outer([]), [undefined, undefined]);
        deepStrictEqual(Object.keys(outer([])), ['0', '1']);
        deepStrictEqual(outer(Array(1).concat(4)), [undefined, 4]);
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

                return function close() {
                    strictEqual(this, iterator);
                    event('close');

                    return { done: true };
                };
            }
        };
        const input = { get [Symbol.iterator]() {
            event('iterator-get');

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
