import assert from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';
import typescript from 'typescript';

import plugin from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

const standard = Object.fromEntries(['object', 'array', 'function'].map(name => (
    [name, import.meta.resolve(`eslint-plugin-resilient/standard/${name}`)]
)));
const config = [plugin.configs.recommended, plugin.configs.contracts, plugin.configs.safety];
const compile = (code) => {
    const fileName = 'output-contracts.ts';
    const options = { strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext };
    const source = typescript.createSourceFile(fileName, code, typescript.ScriptTarget.ESNext, true);
    const host = typescript.createCompilerHost(options);
    const program = typescript.createProgram([fileName], options, {
        ...host,
        getSourceFile: (name, version, ...rest) => name === fileName ? source : host.getSourceFile(name, version, ...rest)
    });
    const { code: output = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program, standard }).transform({ code, fileName });
    const { outputText: native = '' } = typescript.transpileModule(code, { compilerOptions: options });
    const linter = new Linter();
    const messages = linter.verify(output, config);
    const { output: fixed = '', messages: fixedMessages = [] } = linter.verifyAndFix(output, config);

    assert.deepEqual(program.getSemanticDiagnostics(), []);
    assert.deepEqual(diagnostics, []);

    return { native, output, fixed, messages, fixedMessages };
};
const load = code => import(`data:text/javascript,${encodeURIComponent(code)}`);
const versions = ({ native = '', output = '', fixed = '' } = {}) => Promise.all([native, output, fixed].map(load));
const errors = (messages = []) => messages.filter(({ severity = 0 } = {}) => severity === 2);
const clean = ({ messages = [], fixedMessages = [] } = {}) => {
    assert.deepEqual(errors(messages), []);
    assert.deepEqual(fixedMessages, []);
};

test('public output: provider forwarding preserves missing fields, getters and shadowed undefined', async () => {
    const result = compile([
        'export const read = <T>(source: { value: T }) => source.value;',
        'export const remap = <T>(next: (value: T) => T) => (source: { peek: T; pos: T }) => ({ peek: source.peek, pos: next(source.pos) });',
        'export const pair = <T>(source: { left: T; right: T }) => {',
        '    const undefined = 99;',
        '    const { left, right } = source;',
        '    return [left, right, undefined];',
        '};'
    ].join('\n'));
    // The authored body pattern still has its own placement/default findings.
    // Forwarding the separate value field cannot discharge those obligations.
    const { messages = [], fixedMessages = [], output = '' } = result;
    [messages, fixedMessages].forEach(messages => assert.deepEqual(errors(messages).map(({ ruleId = '' } = {}) => ruleId), [
        'resilient/prefer-signature-destructuring', 'resilient/prefer-safe-destructuring-defaults', 'resilient/prefer-safe-destructuring-defaults'
    ]));
    assert.doesNotMatch(output, /= undefined|= void 0/u);
    const modules = await versions(result);

    modules.forEach(({ read = false, pair = false, remap = false } = {}) => {
        assert.equal(read({}), undefined);
        assert.deepEqual(pair({}), [undefined, undefined, 99]);
        assert.throws(() => read(null), TypeError);
        assert.throws(() => pair(null), TypeError);
        let events = [];
        const failure = new Error('provider Get');
        const input = {
            get left() {
                events = [...events, 'left'];

                return 0;
            },
            get right() {
                events = [...events, 'right'];
                throw failure;
            }
        };
        assert.throws(() => pair(input), error => error === failure);
        assert.deepEqual(events, ['left', 'right']);
        const provider = {
            get peek() {
                events = [...events, 'peek'];

                return 2;
            },
            get pos() {
                events = [...events, 'pos'];

                return 3;
            }
        };
        const mapped = remap((value) => {
            events = [...events, 'next'];

            return value + 1;
        })(provider);
        assert.deepEqual(mapped, { peek: 2, pos: 4 });
        assert.deepEqual(events, ['left', 'right', 'peek', 'pos', 'next']);
    });
});

test('public output: materialized Map callbacks preserve short entries and iterator completion', async () => {
    const result = compile([
        'export const collect = (source: ReadonlyMap<unknown, unknown>, keyOf: (key: unknown) => unknown, visit: (value: unknown) => unknown) => {',
        '    const output = new Map<unknown, unknown>();',
        '    for (const [key, value] of Array.from(source.entries())) output.set(keyOf(key), visit(value));',
        '    return output;',
        '};'
    ].join('\n'));
    clean(result);
    const { output = '' } = result;
    assert.match(output, /\.flatMap\(/u);
    assert.doesNotMatch(output, /\b(?:key|value)\s*=/u);
    const modules = await versions(result);
    const observe = ({ collect = false } = {}, mode = '') => {
        let events = [];
        const failure = new Error('entry iteration');
        const entry = {
            [Symbol.iterator]() {
                events = [...events, 'iterator'];
                let index = 0;

                return {
                    next() {
                        events = [...events, `next:${index}`];
                        index += 1;

                        if (mode === 'next' && index === 2) throw failure;

                        return { done: false, value: index };
                    },
                    return() {
                        events = [...events, 'close'];

                        if (mode === 'close') throw failure;

                        return { done: true };
                    }
                };
            }
        };
        // eslint-disable-next-line resilient/no-null-assignment -- Explicit null is a supplied entry value in the native-versus-emitted observation.
        const entries = mode ? [entry] : [[], ['short'], ['undefined', undefined], ['null', null], ['zero', 0]];
        const source = { entries: () => entries };
        const keyOf = (key) => {
            events = [...events, ['key', key]];

            return key;
        };
        const visit = (value) => {
            events = [...events, ['value', value]];

            return value;
        };

        try {
            return { entries: [...collect(source, keyOf, visit)], events };
        } catch (error) {
            assert.equal(error, failure);

            return { failed: true, events };
        }
    };
    ['', 'normal', 'next', 'close'].forEach(mode => modules.slice(1).forEach((module) => {
        assert.deepEqual(observe(module, mode), observe(modules.at(0), mode), mode);
    }));
});

test('public output: callback tuple obligations never authorize fabricated empty results', async () => {
    const result = compile([
        'type Mapper = { map: (value: unknown, callback: (pair: [number, string]) => unknown) => unknown };',
        'export const map = (provider: Mapper, value: unknown) => provider.map(value, ([first, second]) => [first, second]);'
    ].join('\n'));
    clean(result);
    const { output = '' } = result;
    assert.doesNotMatch(output, /isArray|hasArrayContent|return \[\]/u);
    const modules = await versions(result);
    const provider = { map: (value, callback) => callback(value) };

    modules.forEach(({ map = false } = {}) => {
        assert.deepEqual(map(provider, []), [undefined, undefined]);
        assert.deepEqual(map(provider, [0]), [0, undefined]);
        assert.deepEqual(map(provider, 'ab'), ['a', 'b']);
        assert.throws(() => map(provider), TypeError);
        assert.throws(() => map(provider, undefined), TypeError);
        assert.throws(() => map(provider, null), TypeError);
    });
});

test('public output: required tuple carriers retain producer, closing and body failure order', async () => {
    const result = compile('export function read(make: () => [() => number, unknown]) { const [callback, value] = make(); return [callback(), value]; }');
    clean(result);
    const modules = await versions(result);

    modules.forEach(({ read = false } = {}) => {
        let events = [];
        const failure = new Error('body call');
        const callback = () => {
            events = [...events, 'call'];
            throw failure;
        };
        const entry = {
            [Symbol.iterator]() {
                events = [...events, 'iterator'];

                return {
                    next: () => {
                        events = [...events, 'next'];

                        return { done: false, value: callback };
                    },
                    return: () => {
                        events = [...events, 'close'];

                        return { done: true };
                    }
                };
            }
        };
        assert.throws(() => read(() => {
            events = [...events, 'producer'];

            return entry;
        }), error => error === failure);
        assert.deepEqual(events, ['producer', 'iterator', 'next', 'next', 'close', 'call']);
        // eslint-disable-next-line resilient/prefer-falsey-returns -- This producer intentionally supplies null to observe native tuple initialization failure.
        assert.throws(() => read(() => null), TypeError);
        assert.throws(() => read(() => []), TypeError);
    });
});

test('public output: required tuple bindings keep the same iteration and absence in loop phases', async () => {
    const result = compile([
        'export function read(make: () => [unknown, unknown], visit: (left: unknown, right: unknown) => void) {',
        '    const [first, second] = make(); visit(first, second);',
        '    for (let index = 0; index < 1; index++) { const [left, right] = make(); visit(left, right); }',
        '    let active = true; while (active) { const [left, right] = make(); visit(left, right); active = false; }',
        '    do { const [left, right] = make(); visit(left, right); } while (false);',
        '    for (const [left, right] of [make()]) visit(left, right);',
        '    for (let [left, right] = make(), again = true; again; again = false) visit(left, right);',
        '    return second;',
        '}',
        'export const primitive = (make: () => [number, number]) => { const [left, right] = make(); return [left, right]; };',
        'export const nested = (make: () => [unknown, [unknown, unknown]]) => { const [first, [second, third]] = make(); return [first, second, third]; };',
        'export const fallback = ([value = 7, missing]: [number?, unknown?]) => [value, missing];'
    ].join('\n'));
    const { messages = [], fixedMessages = [] } = result;
    [messages, fixedMessages].forEach(messages => assert.deepEqual(errors(messages)
        .filter(({ ruleId = '' } = {}) => ruleId !== 'resilient/prefer-prototype-methods'), []));
    const modules = await versions(result);

    modules.forEach(({ read = false, primitive = false, nested = false, fallback = false } = {}, version) => {
        const payload = {};
        const failure = new Error('loop tuple phase');
        let failurePhase = '';
        let trace = [];
        let produced = 0;
        const make = () => {
            const batch = produced;
            produced += 1;
            trace = [...trace, `producer:${batch}`];

            return { [Symbol.iterator]() {
                trace = [...trace, `iterator:${batch}`];
                let position = 0;

                return {
                    next() {
                        const slot = position;
                        position += 1;
                        trace = [...trace, `next:${batch}:${slot}`];

                        return { done: false, get value() {
                            trace = [...trace, `value:${batch}:${slot}`];

                            if (batch === 2 && slot === 1 && failurePhase === 'value') throw failure;

                            return payload;
                        } };
                    },
                    return() {
                        trace = [...trace, `close:${batch}`];

                        if (batch === 2 && failurePhase === 'close') throw failure;

                        return { done: true };
                    }
                };
            } };
        };
        const visit = (left, right) => {
            assert.equal(left, payload);
            assert.equal(right, payload);
            trace = [...trace, 'visit'];

            if (produced === 3 && failurePhase === 'body') throw failure;
        };
        assert.equal(read(make, visit), payload);
        assert.deepEqual(trace, Array.from({ length: 6 }, (_, batch) => [
            `producer:${batch}`, `iterator:${batch}`, `next:${batch}:0`, `value:${batch}:0`,
            `next:${batch}:1`, `value:${batch}:1`, `close:${batch}`, 'visit'
        ]).flat());
        ['value', 'close', 'body'].forEach((phase) => {
            trace = [];
            produced = 0;
            failurePhase = phase;
            assert.throws(() => read(make, visit), error => error === failure);
            assert.deepEqual(trace, [
                ...Array.from({ length: 2 }, (_, batch) => [
                    `producer:${batch}`, `iterator:${batch}`, `next:${batch}:0`, `value:${batch}:0`,
                    `next:${batch}:1`, `value:${batch}:1`, `close:${batch}`, 'visit'
                ]).flat(),
                'producer:2', 'iterator:2', 'next:2:0', 'value:2:0', 'next:2:1', 'value:2:1',
                ...phase === 'value' ? [] : ['close:2'], ...phase === 'body' ? ['visit'] : []
            ]);
        });
        assert.deepEqual(primitive(() => []), version ? [0, 0] : [undefined, undefined]);
        assert.deepEqual(nested(() => [payload, [payload]]), [payload, payload, undefined]);
        assert.deepEqual(fallback([]), [7, undefined]);
        // eslint-disable-next-line resilient/prefer-falsey-returns -- A null producer observes native required tuple initialization failure.
        assert.throws(() => read(() => null, visit), TypeError);
        produced = 0;
        assert.throws(() => read(() => {
            produced += 1;

            if (produced === 3) throw failure;

            return [payload, payload];
        }, visit), error => error === failure);
        assert.equal(produced, 3);
    });
});

test('public output: a tuple boundary cannot exempt an unrelated object binding', async () => {
    const result = compile([
        'export function read(make: () => [unknown, unknown], source: { value: unknown }) {',
        '    const [left, right] = make(), { value } = source;',
        '    return [left, right, value];',
        '}'
    ].join('\n'));
    const { output = '', fixed = '', messages = [], fixedMessages = [] } = result;
    [{ code: output, findings: messages }, { code: fixed, findings: fixedMessages }].forEach(({ code = '', findings = [] } = {}) => {
        assert.ok(errors(findings).some(({ ruleId = '', line = 0, column = 0, endColumn = 0 } = {}) => (
            ruleId === 'resilient/prefer-safe-destructuring-defaults' &&
            code.split('\n').at(line - 1).slice(column - 1, endColumn - 1) === 'value'
        )));
    });
    const modules = await versions(result);
    const payload = {};

    modules.forEach(({ read = false } = {}) => assert.deepEqual(read(() => [payload], {}), [payload, undefined, undefined]));
});

test('public output: unused tuple positions still perform IteratorValue before entering the body', async () => {
    const result = compile('export const second = ([ignored, value]: [unknown, unknown]) => value;');
    clean(result);
    const { output = '' } = result;
    assert.match(output, /\[ignored, value\][\s\S]*void ignored/u);
    const modules = await versions(result);

    modules.forEach(({ second = false } = {}) => {
        assert.equal(second([]), undefined);
        [false, true].forEach((fail) => {
            let events = [];
            let index = 0;
            const failure = new Error('unused IteratorValue');
            const input = {
                [Symbol.iterator]() {
                    return {
                        next() {
                            const position = index;
                            index += 1;
                            events = [...events, `next:${position}`];

                            return {
                                done: false,
                                get value() {
                                    events = [...events, `value:${position}`];

                                    if (fail && position === 0) throw failure;

                                    return position;
                                }
                            };
                        },
                        return() {
                            events = [...events, 'close'];

                            return { done: true };
                        }
                    };
                }
            };

            if (fail) {
                assert.throws(() => second(input), error => error === failure);
                assert.deepEqual(events, ['next:0', 'value:0']);

                return;
            }

            assert.equal(second(input), 1);
            assert.deepEqual(events, ['next:0', 'value:0', 'next:1', 'value:1', 'close']);
        });
    });
});

test('public output: array rest consumes the remaining iterator without fabricating values', async () => {
    const result = compile('export const read = ([head = 7, ...tail]: number[]) => [head, tail];');
    clean(result);
    const modules = await versions(result);

    modules.forEach(({ read = false } = {}) => {
        assert.deepEqual(read([]), [7, []]);
        assert.deepEqual(read([0, 1, 2]), [0, [1, 2]]);
        assert.deepEqual(read(new Array(3)), [7, [undefined, undefined]]);
        assert.throws(() => read(null), TypeError);
        [false, true].forEach((fail) => {
            let events = [];
            let position = 0;
            const failure = new Error('rest IteratorStep');
            const input = { [Symbol.iterator]() {
                return {
                    next() {
                        const current = position;
                        position += 1;
                        events = [...events, `next:${current}`];

                        if (fail && current === 2) throw failure;

                        return { done: current === 3, value: current };
                    },
                    return() {
                        events = [...events, 'close'];

                        return { done: true };
                    }
                };
            } };

            if (fail) {
                assert.throws(() => read(input), error => error === failure);
                assert.deepEqual(events, ['next:0', 'next:1', 'next:2']);

                return;
            }

            assert.deepEqual(read(input), [0, [1, 2]]);
            assert.deepEqual(events, ['next:0', 'next:1', 'next:2', 'next:3']);
        });
    });
});

test('public output: alias placement findings remain visible without moving conditional Gets', async () => {
    const result = compile([
        'export const alias = (source: { inner: { value: number } }) => {',
        '    const holder = source; const selected = holder.inner.value; return selected;',
        '};',
        'export const guarded = (source: { right?: number }, enabled: boolean) => {',
        '    if (enabled) { const selected = source.right; return selected; } return 0;',
        '};'
    ].join('\n'));
    const { messages: rawMessages = [], fixedMessages = [] } = result;
    [rawMessages, fixedMessages].forEach((messages) => {
        assert.deepEqual(errors(messages).map(({ ruleId = '', messageId = '' } = {}) => ({ ruleId, messageId })), [
            { ruleId: 'resilient/prefer-signature-destructuring', messageId: 'preferSignature' }
        ]);
        assert.deepEqual(messages.filter(({ ruleId = '' } = {}) => !ruleId), []);
    });
    const modules = await versions(result);

    modules.forEach(({ alias = false, guarded = false } = {}) => {
        assert.equal(alias({ inner: { value: 7 } }), 7);
        assert.throws(() => alias({}), TypeError);
        assert.equal(guarded(null, false), 0);
        assert.equal(guarded({}, true), undefined);
        const failure = new Error('selected Get');
        const input = { get right() { throw failure; } };
        assert.equal(guarded(input, false), 0);
        assert.throws(() => guarded(input, true), error => error === failure);
    });
});

test('public output: declared nullish returns preserve values and known producer conflicts', async () => {
    const result = compile([
        'export const maybe = (enabled: boolean): number | undefined => { if (enabled) return 7; return undefined; };',
        'export const nullable = (): string | null => null;',
        'export const effect = (): void => { return undefined; };'
    ].join('\n'));
    const { messages = [], fixedMessages = [] } = result;
    [messages, fixedMessages].forEach(messages => assert.deepEqual(errors(messages).map(({ ruleId = '', message = '' } = {}) => ({ ruleId, message })), [
        { ruleId: 'resilient/signature-contract-return-consistency', message: 'This function returns number, but another return path produces undefined.' },
        { ruleId: 'resilient/signature-contract-return-consistency', message: 'This function returns undefined, but another return path produces number.' }
    ]));
    const modules = await versions(result);

    modules.forEach(({ maybe = false, nullable = false, effect = false } = {}) => {
        assert.equal(maybe(true), 7);
        assert.equal(maybe(false), undefined);
        assert.equal(nullable(), null);
        assert.equal(effect(), undefined);
    });
});

test('public output: authored object bindings keep parameter Gets at their source phases', async (context) => {
    const source = [
        'type Input = { value: number; other: number };',
        'export const repeat = (input: Input) => { const { value, ...rest } = input; return [input.value, value, rest]; };',
        'export const different = (input: Input) => { const { other } = input; return [input.value, other]; };',
        'export const indexed = (input: Input) => { const { other } = input; return [input["value"], other]; };',
        'export const wrapped = (input: Input) => { const { other } = input; return [(input as Input).value, other]; };',
        'export const objectValue = (input: { value: { x: number }; other: number }) => { const { other } = input; return [input.value, other]; };',
        'export const earlier = (input: Input) => { const first = input.value; const { other } = input; return [first, other]; };',
        'export const afterEffect = (input: Input, before: () => void) => { before(); const { other } = input; return [input.value, other]; };',
        'export const conditional = (input: Input, enabled: boolean, consume: (value: number) => void) => {',
        '    if (enabled) { const { other } = input; consume(other); } return input.value;',
        '};',
        'export const computed = (input: Input, key: () => "other", fallback: () => number) => {',
        '    const { [key()]: selected = fallback() } = input; return [input.value, selected];',
        '};',
        'export const copy = (input: Input) => { const { ...rest } = input; return [input.value, rest]; };',
        'export const aliased = (input: Input) => { const first = (input as Input); const receiver = first; const { other } = receiver; return [input.value, other]; };',
        'export const reassigned = (input: Input, replacement: Input) => { const receiver = input; input = replacement; const { other } = receiver; return [input.value, other]; };',
        'export const once = (input: Input) => input.value;'
    ].join('\n');
    const compiled = compile(source);
    const modules = await versions(compiled);
    const observe = (module, invoke, phase = '') => {
        let trace = [];
        const failure = new Error('binding phase failed');
        let reads = 0;
        const input = {
            get value() {
                trace = [...trace, 'value'];
                reads += 1;

                return reads;
            },
            get other() {
                trace = [...trace, 'other'];

                if (phase === 'other') throw failure;

                // eslint-disable-next-line resilient/prefer-falsey-returns, resilient/signature-contract-return-consistency -- This fixture Get exposes real undefined so the authored binding owns default execution.
                return phase === 'fallback' ? undefined : 3;
            }
        };
        const effects = {
            before: () => { trace = [...trace, 'before']; },
            consume: (value) => { trace = [...trace, ['consume', value]]; },
            key: () => {
                trace = [...trace, 'key'];

                if (phase === 'key') throw failure;

                return 'other';
            },
            fallback: () => {
                trace = [...trace, 'fallback'];
                throw failure;
            },
            replacement: {
                get value() {
                    trace = [...trace, 'replacement'];

                    return 99;
                },
                other: 8
            }
        };

        try {
            return { value: invoke(module, phase === 'null' ? null : input, effects), trace };
        } catch (error) {
            if (phase === 'null') {
                assert.equal(error.name, 'TypeError');

                return { failure: 'native null receiver', trace };
            }

            assert.equal(error, failure);

            return { failure: 'owned sentinel', trace };
        }
    };
    const jobs = [
        { name: 'rest and repeated property Gets', invoke: (module, input) => module.repeat(input) },
        { name: 'different property order', invoke: (module, input) => module.different(input) },
        { name: 'static indexed property order', invoke: (module, input) => module.indexed(input) },
        { name: 'transparent receiver property order', invoke: (module, input) => module.wrapped(input) },
        { name: 'earlier member Get', invoke: (module, input) => module.earlier(input) },
        { name: 'prior body effect and binding failure', phase: 'other',
            invoke: (module, input, effects) => module.afterEffect(input, Reflect.get(effects, 'before')) },
        { name: 'prior body effect and null receiver', phase: 'null',
            invoke: (module, input, effects) => module.afterEffect(input, Reflect.get(effects, 'before')) },
        { name: 'taken binding', invoke: (module, input, effects) => module.conditional(input, true, Reflect.get(effects, 'consume')) },
        { name: 'skipped binding', invoke: (module, input, effects) => module.conditional(input, false, Reflect.get(effects, 'consume')) },
        { name: 'computed key', invoke: (module, input, effects) => module.computed(input, Reflect.get(effects, 'key'), Reflect.get(effects, 'fallback')) },
        { name: 'computed key failure', phase: 'key',
            invoke: (module, input, effects) => module.computed(input, Reflect.get(effects, 'key'), Reflect.get(effects, 'fallback')) },
        { name: 'binding default failure', phase: 'fallback',
            invoke: (module, input, effects) => module.computed(input, Reflect.get(effects, 'key'), Reflect.get(effects, 'fallback')) },
        { name: 'rest-only copying', invoke: (module, input) => module.copy(input) },
        { name: 'initialized const aliases', invoke: (module, input) => module.aliased(input) },
        { name: 'parameter replacement does not certify current receiver identity',
            invoke: (module, input, effects) => module.reassigned(input, Reflect.get(effects, 'replacement')) },
        { name: 'normal single read', invoke: (module, input) => module.once(input) }
    ];

    await Promise.all(jobs.map((job) => {
        const { name = '', phase = '' } = job;
        const invoke = Reflect.get(job, 'invoke');

        return context.test(name, () => {
            const native = modules.at(0);
            const lowered = modules.slice(1);
            const expected = observe(native, invoke, phase);

            lowered.forEach(module => assert.deepEqual(observe(module, invoke, phase), expected));
        });
    }));
    await context.test('object-valued Gets retain provided identity and order', () => {
        const observeObject = (module) => {
            let trace = '';
            const provided = { x: 7 };
            const input = {
                get value() {
                    trace += 'value;';

                    return provided;
                },
                get other() {
                    trace += 'other;';

                    return 3;
                }
            };
            const result = module.objectValue(input);

            assert.equal(result.at(0), provided);

            return { result, trace };
        };
        const expected = observeObject(modules.at(0));

        modules.slice(1).forEach(module => assert.deepEqual(observeObject(module), expected));
    });
    const shadowed = compile([
        'type Input = { value: number; other: number };',
        'export const shadowed = (input: Input) => {',
        '    const select = (input: Input) => { const { other } = input; return other; };',
        '    return [input.value, select({ value: 9, other: 8 })];',
        '};'
    ].join('\n'));
    const shadowedModules = await versions(shadowed);

    await context.test('shadowed receivers cannot borrow another binding phase', () => {
        const observeShadowed = (module) => {
            let reads = 0;
            const input = { get value() {
                reads += 1;

                return reads;
            }, other: 3 };

            return { value: module.shadowed(input), reads };
        };
        const expected = observeShadowed(shadowedModules.at(0));
        const { messages = [], fixedMessages = [] } = shadowed;
        const knownFindings = [
            { ruleId: 'resilient/prefer-signature-destructuring', messageId: 'preferSignature', line: 2, column: 11, endLine: 2, endColumn: 36 },
            { ruleId: 'resilient/prefer-signature-destructuring', messageId: 'preferSignature', line: 4, column: 15, endLine: 4, endColumn: 28 }
        ];

        shadowedModules.slice(1).forEach(module => assert.deepEqual(observeShadowed(module), expected));
        [messages, fixedMessages].forEach(messages => assert.deepEqual(
            messages.map(({ ruleId = '', messageId = '', line = 0, column = 0, endLine = 0, endColumn = 0 } = {}) => (
                { ruleId, messageId, line, column, endLine, endColumn }
            )), knownFindings
        ));
    });
    clean(compiled);
});

test('public output: a returned generic function retains its deferred provider Get and forwarded identity', async () => {
    const result = compile([
        'type Reader<S, A> = { read: (position: S) => A; position: S };',
        'export function relocate<S>(position: S): <A>(source: Reader<S, A>) => Reader<S, A> {',
        '    return source => ({ read: source.read, position });',
        '}'
    ].join('\n'));
    const modules = await versions(result);

    modules.forEach(({ relocate = false } = {}) => {
        let trace = [];
        const position = { selected: true };
        const payload = { result: true };
        const provided = () => {
            trace = [...trace, 'call'];

            return payload;
        };
        const returned = relocate(position);
        assert.deepEqual(trace, []);
        const source = { get read() {
            assert.equal(this, source);
            trace = [...trace, 'get'];

            return provided;
        } };
        const { read: forwarded = false, position: forwardedPosition = false } = returned(source);
        assert.equal(forwarded, provided);
        assert.equal(forwardedPosition, position);
        assert.equal(forwarded(), payload);
        assert.deepEqual(trace, ['get', 'call']);
        const failure = new Error('deferred provider Get');
        assert.throws(() => returned({ get read() { throw failure; } }), error => error === failure);
    });
    clean(result);
});
