import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createProjectAdapter } from '../integrations/project.js';
import { captureProgram, createProgramCapture } from '../rules/support/eslint-program.js';

// Async entry points own even signature/getter failures as rejections.
const malformed = Reflect.apply(captureProgram, false, ['const value = 1;', null]);
assert.ok(malformed instanceof Promise);
await assert.rejects(malformed, TypeError);
const boundaryFailure = new Error('source option Get failure');
const rejected = Reflect.apply(captureProgram, false, ['const value = 1;', { get fileName() { throw boundaryFailure; } }]);
assert.ok(rejected instanceof Promise);
await assert.rejects(rejected, error => error === boundaryFailure);

const capture = createProgramCapture();
const first = await capture('const first = 1;', { fileName: 'same.js' });
const second = await capture('const second = 2;', { fileName: 'same.js' });
assert.notEqual(first, second);
assert.equal(first.body[0].declarations[0].id.name, 'first');
assert.equal(second.body[0].declarations[0].id.name, 'second');
assert.deepEqual(await capture('const = ;', { fileName: 'bad.js' }), {});
const third = await capture('const third = 3;', { fileName: 'same.js' });
assert.equal(third.body[0].declarations[0].id.name, 'third');
const pending = capture('const pending = 1;', { fileName: 'same.js' });
await assert.rejects(capture('const overlapping = 1;', { fileName: 'same.js' }), /sequential/u);
await pending;
const concurrent = await Promise.all(['left', 'right'].map(name => captureProgram(`const ${name} = 1;`, { fileName: 'same.js' })));
assert.deepEqual(concurrent.map(({ body: [{ declarations: [{ id: { name = '' } = {} } = {}] = [] } = {}] = [] } = {}) => name), ['left', 'right']);

const directory = mkdtempSync(path.join(tmpdir(), 'resilient-inspection-'));
const { pathname: inspector = '' } = new URL('../scripts/inspect-stack.js', import.meta.url);
try {
    ['left', 'right', 'root/nested'].forEach(name => mkdirSync(path.join(directory, name), { recursive: true }));
    writeFileSync(path.join(directory, 'left/value.js'), 'export const use = ({ value = [] } = {}) => value;');
    writeFileSync(path.join(directory, 'right/value.js'), 'export const use = ({ value = "" } = {}) => value;');
    const code = [
        'import { use as left } from "./left/value.js";',
        'import { use as right } from "./right/value.js";',
        'left({ value: "wrong" });',
        'right({ value: "valid" });'
    ].join('\n');
    writeFileSync(path.join(directory, 'index.js'), code);
    const inspect = needle => JSON.parse(execFileSync(process.execPath, [inspector, 'index.js', '--find', needle, '--diagnostics', '--evidence'],
        { cwd: directory, encoding: 'utf8' }));
    const invalid = inspect('wrong');
    const valid = inspect('valid');
    assert.equal(invalid.offset, code.indexOf('wrong'));
    assert.equal(invalid.diagnostics.length, 1);
    const { diagnostics: [diagnostic = {}] = [] } = invalid;
    assert.equal(diagnostic.ruleId, 'signature-contract-call-site');
    assert.equal(diagnostic.message, 'value expects array-like, but this call supplies string-like.');
    assert.deepEqual(diagnostic.range, [code.indexOf('"wrong"'), code.indexOf('"wrong"') + 7]);
    assert.deepEqual(diagnostic.loc, { start: { line: 3, column: 14 }, end: { line: 3, column: 21 } });
    assert.deepEqual(valid.diagnostics, []);
    assert.equal(typeof invalid.evidence, 'object');
    assert.ok(invalid.stack.length);
    assert.throws(() => execFileSync(process.execPath, [inspector, 'missing.js', '--offset', '0'],
        { cwd: directory, stdio: 'pipe' }), /ENOENT/u);
    writeFileSync(path.join(directory, 'index.js'), 'const value = unknown; value;');
    assert.deepEqual(inspect('unknown').diagnostics, []);

    ['layout.js', 'root/layout.js', 'root/nested/layout.js', 'root/nested/index.js'].forEach(name => writeFileSync(path.join(directory, name), 'export {};'));
    const adapter = createProjectAdapter({ cwd: directory, root: 'root', ancestorFiles: ['layout'] });
    assert.deepEqual(adapter.roots({ fileName: path.join(directory, 'root/nested/index.js') }), [
        path.join(directory, 'root/layout.js'), path.join(directory, 'root/nested/layout.js')
    ]);
    assert.equal(adapter.resolver({ from: path.join(directory, 'index.js'), source: './left/value' }), path.join(directory, 'left/value.js'));
    assert.equal(adapter.resolver({ from: path.join(directory, 'index.js'), source: './right/value' }), path.join(directory, 'right/value.js'));
} finally {
    rmSync(directory, { recursive: true, force: true });
}
