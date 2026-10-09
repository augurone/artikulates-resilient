import { strictEqual } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('live sources release discarded output and stale facts while retained history survives', () => {
    const { execPath = '' } = process;
    const harness = fileURLToPath(new URL('./support/lifetimes.js', import.meta.url));
    const result = JSON.parse(execFileSync(execPath, ['--expose-gc', harness], { encoding: 'utf8', timeout: 30000 }));
    const { historical: { identityWhileHeld = false, historicalAfterRevision = false } = {} } = result;

    strictEqual(identityWhileHeld, true);
    strictEqual(historicalAfterRevision, true);
});
