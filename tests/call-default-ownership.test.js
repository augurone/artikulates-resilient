import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const callResult = (source, prepare = false) => {
    const analysis = createAnalysis({ source });

    if (prepare) analysis.functions.forEach(({ index = -1 } = {}) => analysis.checkFunction({ index }));

    const { index = -1 } = analysis.calls.at(-1);
    const result = analysis.checkCall({ index });
    const { counts = {} } = analysis;

    deepStrictEqual(analysis.checkCall({ index }), result);
    const { counts: repeatedCounts = {} } = analysis;

    deepStrictEqual(repeatedCounts, counts);

    return result;
};

[
    ['object', '{x}', '{x: 1}', '{x: 2}', '3', 'agreement'],
    ['array', '[x]', '[1]', '[2]', '{}', 'unknown']
].forEach(([name = '', pattern = '', first = '', second = '', wrong = '', supported = ''] = []) => {
    ['fallback', name === 'object' ? '{x: 0}' : '[0]', 'makeDefault()'].forEach((fallback) => {
        [
            ['supplied', first, supported],
            ['joined', `flag ? ${first} : ${second}`, supported],
            ['unknown', 'external', 'unknown'],
            ['contradiction beside unknown', `flag ? ${wrong} : external`, 'contradiction'],
            ['omitted', '', 'unknown'],
            ['undefined', 'void 0', 'unknown']
        ].forEach(([kind = '', argument = '', expected = ''] = []) => {
            test(`${name} with unsupported ${fallback} retains ${kind} argument ownership`, () => {
                const source = `const f = (${pattern} = ${fallback}) => x; f(${argument});`;
                const result = callResult(source);
                const { status = '' } = result;

                strictEqual(status, expected);
                deepStrictEqual(callResult(source, true), result);
            });
        });
    });
});

test('nested field requirements still report a supplied contradiction under an unsupported outer default', () => {
    const source = 'const f = ({x = ""} = {x: 0}) => x; f(flag ? {x: 1} : external);';
    const { status = '', obligations = [] } = callResult(source);

    strictEqual(status, 'contradiction');
    ok(obligations.some(({ path = '', expected = '', status = '' } = {}) => path === 'x' && expected === 'string' && status === 'contradiction'));
    const messages = new Linter().verify(source, { plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' } });

    ok(messages.some(({ messageId = '' } = {}) => messageId === 'mismatch'));
});

test('supported defaults keep the existing replacement evidence and source revisions stay isolated', () => {
    const supported = 'const f = ({x = 0} = {}) => x; f(external);';
    const unsupported = 'const f = ({x = 0} = fallback) => x; f(external);';
    const contradicted = unsupported.replace('f(external)', 'f(3)');

    strictEqual(callResult(supported).status, 'unknown');
    strictEqual(callResult(unsupported).status, 'unknown');
    strictEqual(callResult(contradicted).status, 'contradiction');
    strictEqual(callResult(unsupported).status, 'unknown');
});

test('imported unsupported defaults retain supplied owners through the public module boundary', () => {
    const source = 'import {f} from "provider"; f(external);';
    const analysis = createAnalysis({ source, filename: 'entry.js', resolveModule: () => ({
        filename: 'provider.js', source: 'export const f = ({x} = fallback) => x;'
    }) });
    const { index = -1 } = analysis.calls.at(-1);
    const result = analysis.checkCall({ index });

    const { status = '' } = result;

    strictEqual(status, 'unknown');
    deepStrictEqual(analysis.checkCall({ index }), result);
});

test('observer failures still propagate and the same owned query can be retried', () => {
    const analysis = createAnalysis({ source: 'const f = ({x} = fallback) => x; f(external);' });
    const { index = -1 } = analysis.calls.at(-1);
    const failure = new Error('call observer sentinel');

    throws(() => analysis.checkCall({ index, onWork: () => { throw failure; } }), error => error === failure);
    strictEqual(analysis.checkCall({ index }).status, 'unknown');
});
