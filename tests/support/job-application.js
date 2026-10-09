import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const jobSources = Object.fromEntries(['input.ts', 'provider.ts', 'task.ts', 'main.ts'].map(name => [
    name, readFileSync(new URL(`../fixtures/job-application/${name}`, import.meta.url), 'utf8')
]));

export const observeJobApplication = async (directory) => {
    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Every job must execute its emitted export; a fallback operation would hide a missing module or export.
    const { captureJob, readProvider, runTask } = await import(pathToFileURL(join(directory, 'main.js')).href);
    const failure = new Error('owned job failure');
    let inputTrace = [];
    let reads = 0;
    const input = {
        get value() {
            reads += 1;
            inputTrace = [...inputTrace, `value:${reads}`];

            return reads;
        },
        get other() {
            inputTrace = [...inputTrace, 'other'];

            return 3;
        }
    };
    const captured = captureJob(input);

    assert.deepEqual(captured, [2, 1, { other: 3 }]);
    assert.notStrictEqual(captured.at(2), input);
    assert.deepEqual(inputTrace, ['value:1', 'other', 'value:2']);
    let inputFailureTrace = [];
    const brokenInput = {
        get value() {
            inputFailureTrace = [...inputFailureTrace, 'value'];

            return 1;
        },
        get other() {
            inputFailureTrace = [...inputFailureTrace, 'other'];
            throw failure;
        }
    };

    assert.throws(() => captureJob(brokenInput), error => error === failure);
    assert.deepEqual(inputFailureTrace, ['value', 'other']);
    let providerTrace = [];
    const payload = { job: 'payload' };
    const provider = {
        get read() {
            providerTrace = [...providerTrace, 'lookup'];

            return function read() {
                providerTrace = [...providerTrace, this === provider ? 'receiver' : 'detached'];

                return payload;
            };
        }
    };

    assert.strictEqual(readProvider(provider), payload);
    assert.deepEqual(providerTrace, ['lookup', 'receiver']);
    let providerFailureTrace = [];

    assert.throws(() => readProvider({ get read() {
        providerFailureTrace = [...providerFailureTrace, 'lookup'];
        throw failure;
    } }), error => error === failure);
    assert.deepEqual(providerFailureTrace, ['lookup']);
    const task = (phase = '') => {
        let trace = [];
        const callback = () => {
            trace = [...trace, 'call'];

            if (phase === 'work') throw failure;

            return 7;
        };
        const values = [callback, payload];
        const entry = {
            [Symbol.iterator]() {
                trace = [...trace, 'iterator'];
                let position = 0;

                return {
                    next() {
                        const current = position;
                        const value = values.at(current);
                        position += 1;
                        trace = [...trace, `next:${current}`];

                        return { done: false, get value() {
                            trace = [...trace, `value:${current}`];

                            return value;
                        } };
                    },
                    return() {
                        trace = [...trace, 'close'];

                        if (phase === 'cleanup') throw failure;

                        return { done: true };
                    }
                };
            }
        };
        const make = () => {
            trace = [...trace, 'make'];

            return entry;
        };

        if (phase) assert.throws(() => runTask(make), error => error === failure);

        if (!phase) {
            const result = runTask(make);

            assert.equal(result.at(0), 7);
            assert.strictEqual(result.at(1), payload);
        }

        assert.deepEqual(trace, ['make', 'iterator', 'next:0', 'value:0', 'next:1', 'value:1', 'close', ...(phase === 'cleanup' ? [] : ['call'])]);

        return trace;
    };

    return { captured, inputTrace, inputFailureTrace, providerTrace, providerFailureTrace,
        task: task(), failedWork: task('work'), failedCleanup: task('cleanup') };
};
