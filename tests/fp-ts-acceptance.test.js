import { doesNotThrow, strictEqual, throws } from 'node:assert/strict';
import test from 'node:test';

import { assertFpTsFluency, fpTsRouting } from '../scripts/check-fp-ts.js';

test('fp-ts acceptance rejects emitted errors even when runtime cases pass', () => {
    const byRule = { 'resilient/prefer-async-await': { violations: 30, errors: 0, warnings: 30 } };

    doesNotThrow(() => assertFpTsFluency({ complete: true, postFix: { errors: 0, byRule } }));
    throws(() => assertFpTsFluency({ complete: true, postFix: { errors: 5, byRule } }), /errors are regressions/u);
    throws(() => assertFpTsFluency({ complete: false, postFix: { errors: 0, byRule } }), /must be measured/u);
    throws(() => assertFpTsFluency({ complete: true, postFix: { errors: 0, byRule: {} } }), /30 accepted/u);
});

test('fp-ts routing rejects original source and a different emitted variant', () => {
    const routing = fpTsRouting({ input: '/input', outputs: [['/input/src/Option.ts', '/raw/src/Option.js']],
        trace: '/unused', trees: ['/native', '/raw', '/fixed', '/output'] });
    const { resolveId = false, transform = false } = routing;

    if (typeof resolveId !== 'function' || typeof transform !== 'function') throw new TypeError('Expected Vite routing hooks');

    strictEqual(resolveId('../src/Option', '/input/test/Option.ts'), '/raw/src/Option.js');
    strictEqual(resolveId('./Option.js', '/raw/src/Either.js'), '/raw/src/Option.js');
    throws(() => transform('', '/input/src/Option.ts'), /Original TypeScript loaded/u);
    throws(() => transform('', '/fixed/src/Option.js'), /Wrong JavaScript variant/u);
    throws(() => resolveId('../src/Missing', '/input/test/Option.ts'), /Unemitted fp-ts source/u);
    doesNotThrow(() => transform('', '/raw/src/Option.js'));
});
