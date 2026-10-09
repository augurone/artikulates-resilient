import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ESLint } from 'eslint';

import { getOptions, measureProject } from '../scripts/measure-project.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'resilient-measurement-'));
const sourceDirectory = path.join(directory, 'src');
const { href: plugin = '' } = pathToFileURL(fileURLToPath(new URL('../index.js', import.meta.url)));
const measureEntry = fileURLToPath(new URL('../scripts/measure-project.js', import.meta.url));

try {
    fs.mkdirSync(sourceDirectory);
    fs.mkdirSync(path.join(sourceDirectory, 'ignored'));
    fs.writeFileSync(path.join(directory, 'eslint.config.mjs'), [
        `import resilient from '${plugin}';`,
        "export default [{ ignores: ['src/ignored/**'] }, resilient.configs.recommended, resilient.configs.safety, { rules: { 'no-undef': 'error' } }];"
    ].join('\n'));
    const activeFile = path.join(sourceDirectory, 'active.js');
    const activeSource = [
        '// eslint-disable-next-line no-undef -- Browser-owned global.',
        'external();',
        'unbound();',
        'const value = Promise.resolve(1);',
        '// eslint-disable-next-line resilient/prefer-async-await -- Required chain boundary.',
        'value.then(result => result).catch(() => {});'
    ].join('\n');

    fs.writeFileSync(activeFile, activeSource);
    fs.writeFileSync(path.join(sourceDirectory, 'broad.js'), '/* eslint-disable no-undef -- Legacy API. */\nlegacy();\n');
    fs.writeFileSync(path.join(sourceDirectory, 'ignored', 'bad.js'), 'ignoredName();\n');

    const options = getOptions(['--project', directory, '--config', 'eslint.config.mjs', '--report', 'result.json', 'src/**/*.js']);

    assert.deepEqual(options.patterns, ['src/**/*.js']);
    assert.equal(options.configFile, 'eslint.config.mjs');
    assert.throws(() => getOptions(['--unknown']), /Usage: resilient-measure/u);
    const report = await measureProject({ directory, patterns: ['src/**/*.js'] });
    const eslint = new ESLint({ cwd: directory, fix: false, cache: false });
    const direct = await eslint.lintFiles(['src/**/*.js']);

    assert.equal(report.complete, true);
    assert.equal(report.summary.active.violations, direct.reduce((total, { messages = [] } = {}) => total + messages.length, 0));
    assert.equal(report.summary.suppressed.violations, direct.reduce((total, { suppressedMessages = [] } = {}) => total + suppressedMessages.length, 0));
    assert.equal(report.summary.active.byRule['no-undef'].violations, 1);
    assert.equal(report.summary.suppressed.byRule['no-undef'].violations, 2);
    assert.equal(report.summary.suppressed.byRule['resilient/prefer-async-await'].violations, 1);
    assert.equal(report.summary.exceptions.sites, 3);
    assert.equal(report.summary.exceptions.byRule['no-undef'], 2);
    assert.deepEqual(report.files.map(({ file = '' } = {}) => file), ['src/active.js', 'src/broad.js']);
    assert.equal(report.exceptions.find(({ form = '' } = {}) => form === 'disable').reason, 'Legacy API.');
    assert.equal(fs.readFileSync(activeFile, 'utf8'), activeSource);

    const summary = JSON.parse(execFileSync(process.execPath, [measureEntry, '--project', directory, '--report', 'result.json', 'src/**/*.js'], {
        encoding: 'utf8'
    }));
    const saved = JSON.parse(fs.readFileSync(path.join(directory, 'result.json'), 'utf8'));

    assert.equal(summary.complete, true);
    assert.deepEqual(saved.summary, report.summary);
    assert.equal(fs.readFileSync(activeFile, 'utf8'), activeSource);

    fs.writeFileSync(path.join(directory, 'alternate.config.mjs'), "export default [{ rules: { 'no-undef': 'off' } }];\n");
    const alternate = await measureProject({ directory, patterns: ['src/active.js'], configFile: 'alternate.config.mjs' });

    assert.equal(alternate.summary.active.byRule['no-undef'], undefined);
    assert.equal(alternate.summary.suppressed.byRule['no-undef'], undefined);
    assert.equal(alternate.summary.exceptions.sites, 2);

    fs.writeFileSync(path.join(sourceDirectory, 'broken.js'), 'const broken = ;\n');
    const incomplete = await measureProject({ directory, patterns: ['src/broken.js'] });

    assert.equal(incomplete.complete, false);
    assert.equal(incomplete.summary.active.errors, 1);
    assert.equal(incomplete.files[0].complete, false);
    const failedCommand = spawnSync(process.execPath, [measureEntry, '--project', directory, 'src/broken.js'], { encoding: 'utf8' });

    assert.equal(failedCommand.status, 1);
    assert.equal(JSON.parse(failedCommand.stdout).complete, false);
} finally {
    fs.rmSync(directory, { recursive: true, force: true });
}
