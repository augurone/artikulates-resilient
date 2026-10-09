import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const query = (source, prepare = false) => {
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
    ['object', '{x}', '{x:1}', '{x:0}'],
    ['array', '[x]', '[1]', '[0]']
].forEach(([kind = '', pattern = '', supplied = '', literal = ''] = []) => {
    [literal, 'external'].forEach((fallback) => {
        [false, true].forEach((nested) => {
            [
                ['undefined', 'void 0', 'unknown'],
                ['null', 'null', 'contradiction'],
                ['wrong family', '3', 'contradiction'],
                ['unknown', 'unknown', 'unknown'],
                ['wrong beside undefined', 'second ? 3 : void 0', 'contradiction']
            ].forEach(([name = '', alternative = '', expected = ''] = []) => {
                test(`${nested ? 'nested' : 'root'} ${kind} default ${fallback} preserves joined ${name}`, () => {
                    const parameter = nested ? `{value: ${pattern} = ${fallback}}` : `${pattern} = ${fallback}`;
                    const selected = `flag ? ${supplied} : (${alternative})`;
                    const argument = nested ? `{value: ${selected}}` : selected;
                    const source = `const f = (${parameter}) => x; f(${argument});`;
                    const result = query(source);
                    const { status = '' } = result;

                    strictEqual(status, expected);
                    deepStrictEqual(query(source, true), result);
                });
            });
        });
    });
});

test('installed-rule contract accepts both object-producing branches of an unsupported default', () => {
    const source = 'const f = ({x} = {x:0}) => x; f(flag ? {x:1} : void 0);';
    const messages = new Linter().verify(source, { plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' } });

    deepStrictEqual(messages, []);
});

test('default selection interruption remains a failure and permits a correct retry', () => {
    const analysis = createAnalysis({ source: 'const f = ({x} = external) => x; f(flag ? {x:1} : void 0);' });
    const { index = -1 } = analysis.calls.at(-1);
    const failure = new Error('default selection interrupted');

    throws(() => analysis.checkCall({ index, onWork: ({ kind = '' } = {}) => {
        if (kind === 'value-selection') throw failure;
    } }), error => error === failure);
    strictEqual(analysis.checkCall({ index }).status, 'unknown');
});

test('an imported unsupported default selects undefined without hiding a supplied null', () => {
    const acquire = argument => createAnalysis({ source: `import {f} from 'provider'; f(${argument});`, filename: 'entry.js',
        resolveModule: () => ({ filename: 'provider.js', source: 'export const f = ({x} = {x:0}) => x;' }) });
    const unknown = acquire('flag ? {x:1} : void 0');
    const { index = -1 } = unknown.calls.at(-1);

    strictEqual(unknown.checkCall({ index }).status, 'unknown');
    strictEqual(acquire('flag ? {x:1} : null').checkCall({ index }).status, 'contradiction');
    strictEqual(unknown.checkCall({ index }).status, 'unknown');
});
