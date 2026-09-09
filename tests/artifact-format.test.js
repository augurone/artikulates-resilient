import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = process.cwd();
const destination = await mkdtemp(path.join(tmpdir(), 'resilient-artifact-fix-'));
const javascript = path.join(destination, 'js');

await mkdir(javascript);
await Promise.all([
    writeFile(path.join(javascript, 'a.js'), 'const value = source.value;\n'),
    writeFile(path.join(javascript, 'b.js'), 'const untouched = true;\n')
]);

await execute(process.execPath, [
    path.join(root, 'scripts/fix-typescript-artifact.js'),
    destination,
    '0',
    '8',
    path.join(root, 'eslint.config.js')
]);

const fixed = await readFile(path.join(javascript, 'a.js'), 'utf8');
const untouched = await readFile(path.join(javascript, 'b.js'), 'utf8');
const report = JSON.parse(await readFile(path.join(destination, 'lint-fix-part-0.json'), 'utf8'));

assert.equal(fixed, 'const { value } = source;\n');
assert.equal(untouched, 'const untouched = true;\n');
assert.deepEqual(report.map(({ file = '' } = {}) => path.basename(file)), ['a.js', 'b.js']);
assert.equal(report[0].fixed, true);
assert.equal(report[1].fixed, false);

await rm(destination, { recursive: true, force: true });
