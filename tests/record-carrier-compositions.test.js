import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';

const { sources = [], carriers = [], consumers = [] } = JSON.parse(readFileSync(new URL('./fixtures/record-carrier-compositions.json', import.meta.url), 'utf8'));
const inputs = [[false, false], [false, true], [true, false], [true, true]];
const keys = ['"value"', '0n', '-0n'];
const kindOf = (value) => {
    const kind = typeof value;

    if (value === null || kind === 'undefined') return 'nullish';

    return Array.isArray(value) ? 'array' : typeof value;
};

// Cross the admitted mechanisms, including combinations whose individual
// examples already passed. Runtime observations supply the expected families;
// the analyzer's answers never generate their own expected results.
sources.forEach(([origin = '', asynchronous = false, setup = ''] = []) => carriers.forEach(([transport = '', carry = ''] = []) => {
    test(`native carrier compositions: ${origin}, ${transport}`, async () => {
        await Promise.all(consumers.flatMap(([consumer = '', consume = ''] = []) => keys.map(async (key) => {
            const definition = `const read=${asynchronous ? 'async ' : ''}(left=false,right=false)=>{${setup}${carry}${consume}};`
                .replaceAll('[key]', `[${key}]`).replaceAll('@pattern@', key === '-0n' ? '0n' : key);
            const actual = await Promise.all(inputs.map(args => runInNewContext(`${definition}read(${args.join(',')});`)));
            const kinds = actual.map(kindOf);
            const expected = [...new Set(kinds)].toSorted();
            const source = definition + inputs.map(args => `read(${args.join(',')});`).join('');
            const analysis = createAnalysis({ source });
            const summary = analysis.checkFunction({ index: 0 });
            const { fact: { families = [], incomplete = true } = {}, normal = false } = summary;
            const message = JSON.stringify({ origin, transport, consumer, key, source });

            deepStrictEqual(families.toSorted(), expected, message);
            strictEqual(incomplete, false, message);
            strictEqual(normal, true, message);
            const calls = analysis.calls.filter(({ callee = '', location: { range: [offset = -1] = [] } = {} } = {}) => callee === 'read' && offset >= definition.length);

            strictEqual(calls.length, inputs.length);
            calls.toReversed().forEach(({ index = -1 } = {}, reversed) => {
                analysis.checkCall({ index });

                if (asynchronous) return;

                const required = kinds.at(inputs.length - reversed - 1);
                const contrary = required === 'string' ? 'number' : 'string';
                const result = analysis.checkCallResult({ index, required });
                const { status = '' } = result;

                strictEqual(status, 'agreement', message);
                strictEqual(analysis.checkCallResult({ index, required: contrary }).status, 'contradiction', message);
                deepStrictEqual(analysis.checkCallResult({ index, required }), result, message);
            });
            deepStrictEqual(analysis.checkFunction({ index: 0 }), summary, message);
        })));
    });
}));
