import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { getArtifactLintBatch } from '../scripts/artifact-lint-batch.js';
import { writeJsonReport } from '../scripts/json-report.js';

const execute = promisify(execFile);
const root = process.cwd();
const destination = await mkdtemp(path.join(tmpdir(), 'resilient-lint-batch-'));
const javascript = path.join(destination, 'js');
const configFile = path.join(destination, 'eslint.config.mjs');
const source = 'const value=1;\n';
const names = ['z.js', 'a.js', 'm.js', 'ignored.JS', 'ignored.js.map'];

try {
    await mkdir(javascript);
    await Promise.all(names.map(name => writeFile(path.join(javascript, name), source)));
    await writeFile(configFile, 'export default [{ rules: { "semi": ["error", "never"] } }];\n');

    const getOptions = (part = '0', size = '8') => Object.freeze(['node', 'script', destination, part, size, configFile]);
    const getNames = (options = []) => {
        const { files = [] } = getArtifactLintBatch(options);

        return files.map(file => path.basename(file));
    };

    assert.deepEqual(getNames(getOptions()), ['a.js', 'm.js', 'z.js']);
    assert.deepEqual(getNames(getOptions('0', '2')), ['a.js', 'm.js']);
    assert.deepEqual(getNames(getOptions('1', '2')), ['z.js']);
    assert.deepEqual(getNames(getOptions('2', '2')), []);
    assert.deepEqual(getNames(getOptions('0', '0')), []);
    assert.deepEqual(getNames(getOptions('bad', '2')), []);
    assert.deepEqual(getNames(getOptions('-1', '2')), []);
    assert.deepEqual(getNames(getOptions('0.5', '2')), ['m.js', 'z.js']);
    assert.deepEqual(getNames(['node', 'script', destination]), ['a.js', 'm.js', 'z.js']);
    assert.deepEqual(getArtifactLintBatch(getOptions('1', '2')), {
        destination, part: 1, configFile, files: [path.join(javascript, 'z.js')]
    });
    assert.throws(() => getArtifactLintBatch(['node', 'script', path.join(destination, 'missing')]), { code: 'ENOENT' });

    const reportFile = path.join(destination, 'report.json');
    const reportValue = Object.freeze({ files: Object.freeze(['a.js']), count: 1 });
    writeJsonReport(reportFile, reportValue);
    assert.equal(await readFile(reportFile, 'utf8'), `${JSON.stringify(reportValue, null, 2)}\n`);
    assert.throws(() => writeJsonReport(path.join(destination, 'missing', 'report.json'), reportValue), { code: 'ENOENT' });
    assert.throws(() => writeJsonReport(reportFile, 1n), TypeError);
    assert.throws(() => writeJsonReport(path.join(destination, 'missing', 'report.json'), 1n), TypeError);
    assert.equal(await readFile(reportFile, 'utf8'), `${JSON.stringify(reportValue, null, 2)}\n`);

    await execute(process.execPath, [path.join(root, 'scripts/verify-typescript-artifact.js'), destination, '0', '2', configFile]);
    const raw = JSON.parse(await readFile(path.join(destination, 'lint-verify-part-0.json'), 'utf8'));
    assert.deepEqual(raw.map(({ filePath = '' } = {}) => path.basename(filePath)), ['a.js', 'm.js']);
    assert.deepEqual(raw.map(({ errorCount = 0 } = {}) => errorCount), [1, 1]);
    assert.equal(await readFile(path.join(javascript, 'a.js'), 'utf8'), source);

    await execute(process.execPath, [path.join(root, 'scripts/fix-typescript-artifact.js'), destination, '0', '2', configFile]);
    const fixed = JSON.parse(await readFile(path.join(destination, 'lint-fix-part-0.json'), 'utf8'));
    assert.deepEqual(fixed, ['a.js', 'm.js'].map(name => ({ file: path.join(javascript, name), fixed: true, remaining: 0 })));
    assert.equal(await readFile(path.join(javascript, 'a.js'), 'utf8'), 'const value=1\n');
    assert.equal(await readFile(path.join(javascript, 'z.js'), 'utf8'), source);

    await execute(process.execPath, [path.join(root, 'scripts/verify-typescript-artifact.js'), destination, '0', '2', configFile]);
    const verified = JSON.parse(await readFile(path.join(destination, 'lint-verify-part-0.json'), 'utf8'));
    assert.deepEqual(verified.map(({ errorCount = 0 } = {}) => errorCount), [0, 0]);

    await assert.rejects(execute(process.execPath, [path.join(root, 'scripts/verify-typescript-artifact.js'), path.join(destination, 'missing')]), /ENOENT/u);
    await assert.rejects(execute(process.execPath, [path.join(root, 'scripts/fix-typescript-artifact.js'), destination, '0', '2', path.join(destination, 'missing.mjs')]), /ENOENT/u);
} finally {
    await rm(destination, { recursive: true, force: true });
}
