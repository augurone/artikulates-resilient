import { deepStrictEqual, strictEqual, ok } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';

// Closed programs deliberately include dialect violations. Native execution is
// the oracle for possible results; a family default never supplies test evidence.
const atoms = ['[]', '{}', '""', '"ready"', '0', 'false', 'null', 'empty()', '(() => "ready")'];
const conditions = ['a', 'b', '!a', '!b', 'a && b', 'a || b', 'a ? b : !b'];
const expression = ({ seed = 0, depth = 0 } = {}) => {
    if (!depth) return atoms.at(seed % atoms.length);

    const left = expression({ seed: seed * 5 + 1, depth: depth - 1 });
    const right = expression({ seed: seed * 7 + 3, depth: depth - 1 });

    if (seed % 2) return `((${conditions.at(seed % conditions.length)}) ? ${left} : ${right})`;

    return `(${left} ${['&&', '||', '??'].at(seed % 3)} ${right})`;
};
const variants = result => [
    `return ${result};`,
    `const value = ${result}; return value;`,
    'return select(a, b);',
    `try { return ${result}; } finally { const effect = 42; }`,
    `try { return ${result}; } finally { if(a) return "cleanup"; }`,
    `try { return ${result}; } finally { if(b) throw 1; }`
];
const kindSource = "value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value";
const family = kind => ['null', 'undefined'].includes(kind) ? 'nullish' : kind;

test('384 closed compositions preserve actual results and producer findings across caller query order', () => {
    Array.from({ length: 64 }, (_, seed) => expression({ seed, depth: 3 })).forEach((result) => {
        variants(result).forEach((body) => {
            const definitions = `const empty = () => {}; const select = (a = false, b = false) => ${result};
                const read = (a = false, b = false) => { ${body} };`;
            const source = `${definitions}\nread(false, false); read(false, true); read(true, false); read(true, true);`;
            const actual = Array.from(runInNewContext(`${definitions}
                const kind = ${kindSource};
                [false, true].flatMap(a => [false, true].map(b => {
                    try { return kind(read(a, b)); } catch { return 'thrown'; }
                }));`));
            const expected = [...new Set(actual.filter(kind => kind !== 'thrown'))].toSorted();
            const analysis = createAnalysis({ source });
            const { functions = [], calls = [] } = analysis;
            const start = source.indexOf('const read = ') + 'const read = '.length;
            const { index = -1 } = functions.find(({ location: { range: [offset = -1] = [] } = {} } = {}) => offset === start);
            const summary = analysis.checkFunction({ index });
            const { diagnostics = [], fact: { families = [], incomplete = false } = {}, normal = false, status = '' } = summary;

            strictEqual(normal, Boolean(expected.length), source);
            deepStrictEqual([...families].toSorted(), [...new Set(expected.map(family))].toSorted(), source);
            strictEqual(incomplete, !expected.length, source);
            strictEqual(status, expected.length > 1 ? 'contradiction' : 'agreement', source);
            strictEqual(Boolean(diagnostics.length), expected.length > 1, source);
            diagnostics.forEach(({ data: { actual: observed = '', expected: other = '' } = {} } = {}) => {
                ok(expected.includes(observed) && expected.includes(other) && observed !== other, source);
            });

            calls.filter(({ callee = '' } = {}) => callee === 'read').toReversed().forEach(({ index: callIndex = -1 } = {}, position) => {
                const selected = actual.at(3 - position);
                const { normal: completed = false, status: callStatus = '' } = analysis.checkCallResult({
                    index: callIndex, required: selected === 'thrown' ? 'array' : family(selected)
                });

                strictEqual(completed, selected !== 'thrown', source);
                strictEqual(callStatus, selected === 'thrown' ? 'unknown' : 'agreement', source);
                deepStrictEqual(analysis.checkFunction({ index }), summary, source);
            });
        });
    });
});
