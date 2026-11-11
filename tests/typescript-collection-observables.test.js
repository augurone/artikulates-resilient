import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ESLint } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

const directory = await mkdtemp(path.join(tmpdir(), 'resilient-collection-observables-'));
const fileName = path.join(directory, 'collections.ts');
const source = [
    'export const remove = (source: Map<number, string>, getKey: () => number) => {',
    '    const output = new Map(source);',
    '    output.delete(getKey());',
    '    return output;',
    '};',
    'export const removeNamed = (source: Map<number, string>, entryKey: number) => {',
    '    const output = new Map(source);',
    '    output.delete(entryKey);',
    '    return output;',
    '};',
    'export const buildSet = (values: number[], visit: (value: number) => number) => {',
    '    const output = new Set<number>();',
    '    for (const value of values) output.add(visit(value));',
    '    return output;',
    '};',
    'export const buildMap = (entries: [number, number][], visit: (value: number) => number) => {',
    '    const output = new Map<number, number>();',
    '    for (const [key, value] of entries) {',
    '        if (visit(value) > 0) output.set(key, visit(value));',
    '    }',
    '    return output;',
    '};',
    'export const materialized = (source: Set<number>, outputValues: number) => {',
    '    const output = new Set<number>();',
    '    for (const value of [...source]) output.add(value + outputValues);',
    '    return output;',
    '};',
    ''
].join('\n');

try {
    await writeFile(fileName, source);
    const program = typescript.createProgram([fileName], {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext, strict: true
    });
    const { code = '', diagnostics = [] } = createTypeScriptTransformer({ typescript, program }).transform({
        code: source, fileName
    });
    const { outputText: reference = '' } = typescript.transpileModule(source, {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext }
    });
    const load = async text => import(`data:text/javascript,${encodeURIComponent(text)}`);
    const baseline = await load(reference);
    const lowered = await load(code);
    const observeDelete = (remove, entries, key) => {
        let events = [];
        const input = Object.defineProperty(new Map(entries), Symbol.iterator, {
            value: function* () {
                events = [...events, 'copy'];
                yield* Map.prototype[Symbol.iterator].call(this);
            }
        });
        const output = remove(input, () => {
            events = [...events, 'key'];

            return key;
        });

        return { entries: [...output], input: [...Map.prototype.entries.call(input)], events };
    };
    const observeSet = (buildSet) => {
        const values = [1, 2];
        let visits = [];
        const output = buildSet(values, (value) => {
            visits = [...visits, value];

            if (value === 1) {
                // eslint-disable-next-line resilient/prefer-safe-transformations -- The regression observes the source array iterator visiting a callback append.
                values.push(3);
            }

            return value * 2;
        });

        return { entries: [...output], visits };
    };
    const observeMap = (buildMap) => {
        const entries = [[1, 1], [2, 2]];
        let visits = [];
        const output = buildMap(entries, (value) => {
            visits = [...visits, value];

            if (visits.length === 1) {
                // eslint-disable-next-line resilient/prefer-safe-transformations -- The guarded Map regression requires an append to the traversed source array.
                entries.push([3, 3]);
            }

            return value;
        });

        return { entries: [...output], visits };
    };
    const prove = ({ remove = false, removeNamed = false, buildSet = false,
        buildMap = false, materialized = false } = {}) => {
        [[], [[1, 'one']], [[1, 'one'], [2, 'two']], [[Number.NaN, 'nan'], [0, 'zero']]]
            .forEach((entries) => {
                [1, Number.NaN, -0].forEach((key) => {
                    assert.deepEqual(observeDelete(remove, entries, key),
                        observeDelete(baseline.remove, entries, key));
                    assert.deepEqual([...removeNamed(new Map(entries), key)],
                        [...baseline.removeNamed(new Map(entries), key)]);
                });
            });
        const failure = new Error('key failure');

        assert.throws(() => remove(new Map(), () => { throw failure; }), error => error === failure);
        assert.deepEqual(observeSet(buildSet), observeSet(baseline.buildSet));
        assert.deepEqual(observeMap(buildMap), observeMap(baseline.buildMap));
        assert.deepEqual([...materialized(new Set([1, 2]), 10)], [11, 12]);
        let events = [];
        const values = Object.defineProperty([1, 2], Symbol.iterator, {
            value: function* () {
                try {
                    events = [...events, 'next'];
                    yield 1;
                    events = [...events, 'unreachable'];
                    yield 2;
                } finally {
                    events = [...events, 'close'];
                }
            }
        });

        assert.throws(() => buildSet(values, () => {
            events = [...events, 'visit'];
            throw failure;
        }), error => error === failure);
        assert.deepEqual(events, ['next', 'visit', 'close']);
    };

    assert.deepEqual(diagnostics, []);
    prove(lowered);
    assert.match(code, /output\.delete\(getKey\(\)\)/);
    assert.match(code, /for \(const value of values\)/);
    assert.doesNotMatch(code, /Array\.from\(values\)|Array\.from\(entries\)/);
    const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
    const [raw = {}] = await new ESLint({ overrideConfigFile: true,
        overrideConfig: config }).lintText(code, { filePath: 'collection-observables-generated.js' });
    const [fixed = {}] = await new ESLint({ fix: true, overrideConfigFile: true,
        overrideConfig: config }).lintText(code, { filePath: 'collection-observables-generated.js' });

    assert.equal(raw.errorCount, 0, JSON.stringify(raw.messages));
    assert.equal(fixed.errorCount, 0, JSON.stringify(fixed.messages));
    prove(await load(fixed.output || code));
} finally {
    await rm(directory, { recursive: true, force: true });
}
