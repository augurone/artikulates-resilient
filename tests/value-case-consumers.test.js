import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

import { queriesFor, queryAnalysis } from './support/analysis-queries.js';
import { identityPrograms, callablePrograms } from './support/value-case-programs.js';

const lint = (source, rule) => new Linter().verify(source, { plugins: { resilient: plugin }, rules: { [`resilient/${rule}`]: 'error' } });
const assignments = [[false, false], [false, true], [true, false], [true, true]];

// Preserve the pre-change consumer answers as well as runtime behavior. Storage
// and return transfers can retain obligations or unknown native premises even
// when a later runtime guard succeeds; this repair does not expand inference.
identityPrograms.forEach(({ name = '', source = '', runtime = '', guarded = false, required: expected = false } = {}) => test(`case consumers preserve ${name}`, () => {
    const analysis = createAnalysis({ source });
    const declarations = analysis.declarations.filter(({ name = '' } = {}) => ['a', 'b', 'c'].includes(name));
    const required = () => declarations.map(({ index = -1 } = {}) => analysis.checkDeclaration({ index }).required);
    const findings = lint(source, 'prefer-safe-destructuring-defaults');

    deepStrictEqual(required(), [expected, expected, expected]);
    strictEqual(!!findings.length, expected);
    queriesFor(analysis).toReversed().forEach(query => queryAnalysis(analysis, query));
    deepStrictEqual(required(), [expected, expected, expected]);
    assignments.forEach(([p = false, q = false] = []) => {
        const run = () => runInNewContext(source + runtime, { p, q });

        if (guarded) strictEqual(run(), undefined);

        if (!guarded) throws(run, ({ name = '' } = {}) => name === 'TypeError');
    });
}));

callablePrograms.forEach(({ name = '', source = '', runtime = '', conflict = false, inferred = false } = {}) => test(`case consumers preserve ${name}`, () => {
    const program = source + runtime;
    const analysis = createAnalysis({ source: program });
    const conflicts = () => analysis.memberAccesses.filter(({ name = '' } = {}) => name === 'trim')
        .flatMap(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }).conflicts);

    deepStrictEqual(conflicts(), conflict && inferred ? ['number'] : []);
    strictEqual(lint(program, 'signature-contract-operation').length, Number(conflict && inferred));
    queriesFor(analysis).toReversed().forEach(query => queryAnalysis(analysis, query));
    deepStrictEqual(conflicts(), conflict && inferred ? ['number'] : []);
    assignments.forEach(([p = false, q = false] = []) => {
        const run = () => runInNewContext(program, { p, q });

        if (conflict && p && q) throws(run, ({ name = '' } = {}) => name === 'TypeError');

        if (!conflict || !p || !q) strictEqual(run(), 'ok');
    });
}));
