import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ESLint } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { collectCollectionDecisions } from './typescript-collection-proof.js';

const directory = await mkdtemp(path.join(tmpdir(), 'resilient-materialized-collection-'));
const fileName = path.join(directory, 'collections.ts');
const source = [
    'export const mapAll = (source: ReadonlyMap<object, number>, keyOf: (key: object) => object, visit: (value: number) => number) => {',
    '    const output = new Map<object, number>();',
    '    for (const [key, value] of Array.from(source.entries())) output.set(keyOf(key), visit(value));',
    '    return output;',
    '};',
    'export const mapSelected = (source: ReadonlyMap<object, number>, admit: (value: number) => boolean, visit: (value: number) => number) => {',
    '    const output = new Map<object, number>();',
    '    for (const [key, value] of [...source]) if (admit(value)) output.set(key, visit(value));',
    '    return output;',
    '};',
    'export const setAll = (source: ReadonlySet<number>, visit: (value: number) => number) => {',
    '    const output = new Set<number>();',
    '    for (const value of [...source]) output.add(visit(value));',
    '    return output;',
    '};',
    'export const setSelected = (source: ReadonlySet<number>, admit: (value: number) => boolean, visit: (value: number) => number) => {',
    '    const output = new Set<number>();',
    '    for (const value of Array.from(source.values())) if (admit(value)) output.add(visit(value));',
    '    return output;',
    '};',
    'export const setArrays = (source: ReadonlySet<number[]>) => {',
    '    const output = new Set<number[]>();',
    '    for (const value of [...source]) output.add(value);',
    '    return output;',
    '};',
    ''
].join('\n');
const load = async text => import(`data:text/javascript,${encodeURIComponent(text)}`);

try {
    await writeFile(fileName, source);
    const program = typescript.createProgram([fileName], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
    });
    const sourceFile = program.getSourceFile(fileName);
    const facts = collectCollectionDecisions({ typescript, sourceFile, checker: program.getTypeChecker() });
    const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({ code: source, fileName });
    const { outputText: reference = '' } = typescript.transpileModule(source, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const baseline = await load(reference);
    const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
    const [raw = {}] = await new ESLint({ overrideConfigFile: true, overrideConfig: config })
        .lintText(code, { filePath: 'materialized-collection-generated.js' });
    const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true, overrideConfig: config })
        .lintText(code, { filePath: 'materialized-collection-generated.js' });
    const lowered = await load(code);
    const fixedModule = await load(fixed.output || code);
    const keys = [{}, {}, {}];
    const observe = (module, method, values, selected = true, failureAt = '') => {
        let events = [];
        const failure = new Error('callback failure');
        const input = method.startsWith('map')
            ? new Map(values.map((value, index) => [keys[index], value])) : new Set(values);
        const admit = (value) => {
            events = [...events, ['guard', value]];

            if (failureAt === 'guard') throw failure;

            return selected && value >= 0;
        };
        const visit = (value) => {
            events = [...events, ['value', value]];

            // Source callbacks can change the original input after its snapshot.
            // eslint-disable-next-line resilient/prefer-safe-transformations -- The snapshot regression observes a callback appending to the original Set after materialization.
            if (input instanceof Set) input.add(99);

            if (failureAt === 'value') throw failure;

            return value % 2;
        };
        const keyOf = (key) => {
            events = [...events, ['key', keys.indexOf(key)]];

            return keys[0];
        };
        const invoke = () => {
            if (method === 'mapAll') return module[method](input, keyOf, visit);

            if (method === 'setAll') return module[method](input, visit);

            return module[method](input, admit, visit);
        };

        try {
            const result = invoke();

            return { entries: [...result], events };
        } catch (error) {
            assert.equal(error, failure);

            return { failed: true, events };
        }
    };
    const countArrayVisits = (module, count) => {
        const values = new Set(Array.from({ length: count }, (_, index) => index));
        const { prototype: arrayPrototype = {} } = Array;
        const { [Symbol.iterator]: original = false } = arrayPrototype;
        let visits = 0;
        Object.defineProperty(Array.prototype, Symbol.iterator, {
            configurable: true, writable: true,
            value: function* () {
                // eslint-disable-next-line resilient/prefer-prototype-methods -- Count native array iterator steps to detect repeated prefix copying without a wall-clock threshold.
                for (const value of original.call(this)) {
                    visits += 1;
                    yield value;
                }
            }
        });

        try {
            const result = module.setAll(values, value => value);
            const { size = 0 } = result;
            assert.equal(size, count);

            return visits;
        } finally {
            Object.defineProperty(Array.prototype, Symbol.iterator, { configurable: true, writable: true, value: original });
        }
    };

    assert.deepEqual(program.getSemanticDiagnostics(), []);
    assert.deepEqual(diagnostics, []);
    assert.equal(facts.size, 5);
    assert.ok([...facts.values()].every(({ action = '' } = {}) => action === 'materialized-collection-reduce'));
    assert.equal((code.match(/\.flatMap\(/gu) || []).length, 5);
    assert.doesNotMatch(code, /\.reduce\(/u);
    assert.equal(raw.errorCount, 0, JSON.stringify({ messages: raw.messages, code }));
    assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));
    [lowered, fixedModule].forEach((module) => {
        ['mapAll', 'mapSelected', 'setAll', 'setSelected'].forEach((method) => {
            [[], [-1, 0, 2], [1, 2, 3], [Number.NaN, -0, 0]].forEach((values) => {
                [true, false].forEach(selected => ['', 'guard', 'value'].forEach((failureAt) => {
                    assert.deepEqual(observe(module, method, values, selected, failureAt),
                        observe(baseline, method, values, selected, failureAt));
                }));
            });
        });
        const nested = [[], [1, 2], [1, 2]];
        const { setArrays = false } = module;
        const arrays = [...setArrays(new Set(nested))];
        assert.deepEqual(arrays, nested);
        nested.forEach(value => assert.ok(arrays.includes(value), 'Flatten only the singleton wrapper, preserving array values.'));
        [100, 1000, 6000].forEach((count) => {
            assert.ok(countArrayVisits(module, count) <= count * 2, 'Array visits must stay linear in input size.');
        });
    });
} finally {
    await rm(directory, { recursive: true, force: true });
}
