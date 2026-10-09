import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { selectProofs, testFiles } from './proof-families.js';
import { hashFiles, readJson } from '../scripts/proof-files.js';
import { assertMatchingRuntime, assertSupportedRuntime, checkNativeRuntime, getRuntime } from '../scripts/proof-runtime.js';
import { createStageRunner, verifyStageJournal, writeStageJournal } from '../scripts/proof-stages.js';

const directory = mkdtempSync(path.join(tmpdir(), 'resilient-proof-stages-'));
const input = path.join(directory, 'input');
const output = path.join(directory, 'generated');
const file = path.join(directory, 'stages.json');
const identity = { runtime: getRuntime() };
writeFileSync(input, 'stable source');
const inputs = hashFiles([input]);
const { href: stageModule = '' } = new URL('../scripts/proof-stages.js', import.meta.url);
const worker = path.join(directory, 'interrupt.mjs');
writeFileSync(worker, [
    `import { createStageRunner } from ${JSON.stringify(stageModule)};`,
    'import { writeFileSync } from "node:fs";',
    `const { run } = createStageRunner(${JSON.stringify({ file, identity, inputs })});`,
    `run({ id: 'generation', retry: false, execute: () => { writeFileSync(${JSON.stringify(output)}, 'raw'); return { value: { count: 1 }, files: [${JSON.stringify(output)}] }; } });`,
    'run({ id: "batch", execute: () => { process.kill(process.pid, "SIGTERM"); } });'
].join('\n'));
try {
    const { signal = '' } = spawnSync(process.execPath, [worker]);
    assert.equal(signal, 'SIGTERM');
    const { stages: interrupted = [] } = readJson(file);
    assert.deepEqual(interrupted.map(({ status = '' } = {}) => status), ['completed', 'running']);
    const runner = createStageRunner({ file, identity, inputs });
    assert.deepEqual(runner.run({ id: 'generation', retry: false, execute: () => { throw new Error('must never regenerate'); } }), { count: 1 });
    // eslint-disable-next-line resilient/prefer-safe-transformations -- This proof attaches process fields to the exact Error instance thrown by the stage.
    const failure = Object.assign(new Error('failed subprocess'), { status: 7, signal: 'SIGINT' });
    assert.throws(() => runner.run({ id: 'batch', execute: () => { throw failure; } }), error => error === failure);
    const { stages: failed = [] } = readJson(file);
    const { failure: recorded = {}, attempts = 0 } = failed.at(-1);
    assert.equal(recorded.message, 'failed subprocess');
    assert.equal(recorded.status, 7);
    assert.equal(recorded.signal, 'SIGINT');
    assert.equal(attempts, 2);
    assert.equal(readFileSync(output, 'utf8'), 'raw');
    const resumed = createStageRunner({ file, identity, inputs });
    assert.deepEqual(resumed.run({ id: 'batch', execute: () => ({ value: { errors: 0, warnings: 30 }, files: [] }) }), { errors: 0, warnings: 30 });
    verifyStageJournal(readJson(file));
    assert.throws(() => createStageRunner({ file, identity: { runtime: 'other' }, inputs }), /inputs or runtime changed/u);
    writeFileSync(output, 'tampered');
    assert.throws(() => createStageRunner({ file, identity, inputs }), /changed/u);
    writeFileSync(output, 'raw');
    writeFileSync(input, 'changed');
    assert.throws(() => verifyStageJournal(readJson(file)), /changed/u);
    writeFileSync(input, 'stable source');
    const journal = readJson(file);
    writeStageJournal(file, { ...journal, stages: [{ id: 'generation', status: 'running' }] });
    const incomplete = createStageRunner({ file, identity, inputs });
    assert.throws(() => incomplete.run({ id: 'generation', retry: false, execute: () => ({}) }), /never silently replayed/u);
    assert.throws(() => incomplete.run({ id: '' }), /requires/u);

    ['v22.13.0', 'v22.14.1', 'v24.0.0', 'v25.0.0'].forEach(node => assert.doesNotThrow(() => assertSupportedRuntime({ node })));
    ['v21.7.2', 'v22.12.9', 'v23.0.0', 'unknown'].forEach(node => assert.throws(() => assertSupportedRuntime({ node }), /Unsupported Node/u));
    assert.throws(() => assertMatchingRuntime({ expected: { ...getRuntime(), arch: 'mismatched' } }), /runtime mismatch/u);
    assert.throws(() => checkNativeRuntime(directory), /Native dependency check failed/u);
    mkdirSync(path.join(directory, 'node_modules/rollup/dist'), { recursive: true });
    writeFileSync(path.join(directory, 'node_modules/rollup/dist/native.js'),
        'throw new Error("incompatible native architecture");');
    assert.throws(() => checkNativeRuntime(directory), ({ message = '', cause: { stderr = '' } = {} } = {}) => (
        message.includes('Native dependency check failed') && String(stderr).includes('incompatible native architecture')
    ));
    const { node = '', platform = '', arch = '' } = getRuntime();
    assert.doesNotThrow(() => assertMatchingRuntime({ expected: { arch, platform, node } }));
    assert.deepEqual(selectProofs([]), testFiles);
    assert.ok(selectProofs(['--family', 'operations']).includes('./proof-execution.test.js'));
    const javascriptProofs = selectProofs(['--family', 'javascript']);
    assert.ok(javascriptProofs.includes('./operator-linebreak.test.js'));
    assert.ok(javascriptProofs.includes('./project-measurement.test.js'));
    assert.ok(javascriptProofs.includes('./project-graph-resolver.test.js'));
    assert.ok(javascriptProofs.includes('./inspection-execution.test.js'));
    assert.ok(javascriptProofs.includes('./project-dogfood-boundaries.test.js'));
    assert.ok(javascriptProofs.includes('./catalog-integrity.test.js'));
    assert.ok(javascriptProofs.includes('./artifact-lint-batch.test.js'));
    assert.ok(javascriptProofs.includes('./proof-corpus-recovery.test.js'));
    assert.ok(javascriptProofs.includes('./tuple-return-contract.test.js'));
    assert.deepEqual(javascriptProofs, testFiles.filter(file => !file.startsWith('./typescript-')));
    assert.throws(() => selectProofs(['--family', 'missing']), /Usage/u);
    assert.throws(() => selectProofs(['--family', 'rules', 'extra']), /Usage/u);
    const { status = 0, stderr = '' } = spawnSync(process.execPath, [new URL('./run.js', import.meta.url).pathname, '--family', 'missing'], { encoding: 'utf8' });
    assert.equal(status, 1);
    assert.match(stderr, /Usage/u);

    // Top-level imports finish before the next fixture can observe shared state.
    const first = path.join(directory, 'first.mjs');
    const second = path.join(directory, 'second.mjs');
    writeFileSync(first, 'globalThis.fixtureOwner = "first"; await new Promise(resolve => setTimeout(resolve, 20)); delete globalThis.fixtureOwner;');
    writeFileSync(second, 'if (globalThis.fixtureOwner) throw new Error("overlapping fixtures");');
    execFileSync(process.execPath, ['--input-type=module', '-e', `for (const file of ${JSON.stringify([first, second])}) await import(file);`]);
} finally {
    rmSync(directory, { recursive: true, force: true });
}
