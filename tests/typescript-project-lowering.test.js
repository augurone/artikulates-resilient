import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getOptions, runLowering } from '../scripts/lower-typescript-project.js';

const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'resilient-project-lowering-')));
const project = path.join(directory, 'project');
const source = path.join(project, 'src');
const output = path.join(project, 'generated');
let messages = [];
const write = (text) => { messages = [...messages, text]; };
const digest = text => createHash('sha256').update(text).digest('hex');
const workerEntry = fileURLToPath(new URL('../scripts/fix-javascript-worker.js', import.meta.url));
const cliEntry = fileURLToPath(new URL('../scripts/lower-typescript-project.js', import.meta.url));

try {
    await mkdir(source, { recursive: true });
    await writeFile(path.join(project, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            declaration: true,
            module: 'commonjs',
            rootDir: './src',
            sourceMap: true,
            strict: true,
            target: 'es2020'
        },
        include: ['src/**/*.ts']
    }));
    await writeFile(path.join(source, 'types.ts'), 'export type Label = string;\n');
    await writeFile(path.join(source, 'index.ts'), [
        'import type { Label } from "./types";',
        'export const greeting = "hello";',
        'export const render = (label: Label) => label;',
        ''
    ].join('\n'));

    const result = await runLowering({ project: path.join(project, 'tsconfig.json'), outDir: output, cwd: project, write });

    assert.equal(result.ok, true, messages.join(''));
    await access(path.join(output, 'index.js'));
    assert.match(await readFile(path.join(output, 'index.js'), 'utf8'), /export const render/u);
    assert.deepEqual(getOptions(['--project', 'project/tsconfig.json', '--outDir', 'project/generated'], directory), {
        project: path.join(project, 'tsconfig.json'), outDir: output, fixAll: false, eslintConfig: undefined, report: undefined
    });
    assert.deepEqual(getOptions(['--project', 'project/tsconfig.json'], directory), {
        project: path.join(project, 'tsconfig.json'), outDir: undefined, fixAll: false, eslintConfig: undefined, report: undefined
    });
    const defaulted = await runLowering({ project: path.join(project, 'tsconfig.json'), cwd: project, write });

    assert.equal(defaulted.ok, true, messages.join(''));
    assert.equal(defaulted.outDir, path.join(project, '.resilient'));
    await access(path.join(defaulted.outDir, 'index.js'));

    const unsafe = await runLowering({ project: path.join(project, 'tsconfig.json'), outDir: source, cwd: project, write });
    assert.equal(unsafe.ok, false);

    const fluencyOutput = path.join(project, 'fluency-output');
    const report = path.join(project, 'fluency.json');
    const eslintConfig = path.join(project, 'eslint.config.js');

    await writeFile(eslintConfig, 'module.exports = [{ files: ["**/*.js"], rules: { quotes: ["error", "single"] } }];\n');
    const fixed = await runLowering({
        project: path.join(project, 'tsconfig.json'), outDir: fluencyOutput, cwd: project, fixAll: true, eslintConfig, report,
        write
    });

    assert.equal(fixed.ok, true, messages.join(''));
    assert.equal(JSON.parse(await readFile(report, 'utf8')).fixed.errors, 0);
    assert.match(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8'), /'hello'/u);

    const rawBytes = await readFile(path.join(output, 'index.js'), 'utf8');
    const pidFile = path.join(project, 'worker.pid');
    const quoteConfig = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
module.exports = [{ files: ['**/*.js'], rules: { quotes: ['error', 'single'] } }];\n`;
    await writeFile(eslintConfig, quoteConfig);
    const base = { project: path.join(project, 'tsconfig.json'), outDir: fluencyOutput, cwd: project, eslintConfig, write };
    const unfixed = await runLowering(base);

    assert.equal(unfixed.ok, true);
    assert.equal(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8'), rawBytes);
    await assert.rejects(access(pidFile), 'Default lowering must not load ESLint config or start its worker');
    const measured = await runLowering({ ...base, report });

    assert.equal(measured.ok, true, messages.join(''));
    assert.equal(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8'), rawBytes);
    assert.equal(measured.fluency.complete, true);
    assert.equal(measured.fluency.fixApplied, false);
    assert.equal(measured.fluency.postFix, null);
    assert.equal(measured.fluency.changedFiles, 0);
    assert.equal(measured.fluency.raw.errors, 1);
    assert.equal(measured.fluency.clean, false);
    assert.deepEqual(measured.fluency.raw, measured.fluency.published);
    assert.deepEqual(measured.fluency.coverage, { expected: 2, measured: 2 });
    const greetingRow = measured.fluency.files.find(({ filePath = '' } = {}) => filePath.endsWith('index.js'));
    assert.equal(greetingRow.rawSha256, digest(rawBytes));
    assert.equal(greetingRow.publishedSha256, digest(rawBytes));
    assert.equal(greetingRow.profile.configFile, eslintConfig);
    assert.equal(greetingRow.profile.configSha256, digest(quoteConfig));
    assert.deepEqual(greetingRow.profile.rules.quotes, [2, 'single']);
    assert.equal(greetingRow.raw.messages.length, 1);
    assert.equal(greetingRow.postFix, null);
    const assertWorkerStopped = async () => {
        const pid = Number(await readFile(pidFile, 'utf8'));

        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    };
    await assertWorkerStopped();

    const discovered = await runLowering({ ...base, eslintConfig: undefined, report });
    assert.equal(discovered.ok, true, messages.join(''));
    assert.equal(discovered.fluency.files[0].profile.configFile, eslintConfig);
    const fixedOnly = await runLowering({ ...base, fixAll: true });
    assert.equal(fixedOnly.ok, true);
    assert.match(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8'), /'hello'/u);
    assert.equal(fixedOnly.fluency, undefined);
    await assertWorkerStopped();
    const both = await runLowering({ ...base, fixAll: true, report });
    assert.equal(both.ok, true);
    assert.equal(both.fluency.fixApplied, true);
    assert.equal(both.fluency.changedFiles, 1);
    assert.equal(both.fluency.raw.errors, 1);
    assert.equal(both.fluency.postFix.errors, 0);
    assert.equal(both.fluency.published.errors, 0);
    const fixedRow = both.fluency.files.find(({ filePath = '' } = {}) => filePath.endsWith('index.js'));
    assert.equal(fixedRow.publishedSha256, digest(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8')));
    assert.notEqual(fixedRow.rawSha256, fixedRow.publishedSha256);
    assert.deepEqual(fixedRow.postFix.messages, []);
    await assertWorkerStopped();

    // This override matches only final output paths, exposing accidental linting of randomized staging paths.
    await writeFile(eslintConfig, `module.exports = [{ files: ['fluency-output/**/*.js'], rules: { quotes: ['error', 'single'] } }];\n`);
    assert.equal((await runLowering({ ...base, report })).ok, true);

    const failure = async ({ config = quoteConfig, options = {}, marker = /Incomplete/u, stopped = true } = {}) => {
        await writeFile(eslintConfig, config);
        const priorBytes = await readFile(path.join(fluencyOutput, 'index.js'), 'utf8');
        const priorReport = await readFile(report, 'utf8');
        const result = await runLowering({ ...base, report, ...options });
        const { ok = false, fluency = {} } = result;
        const { complete = true, raw = undefined, published = undefined, error = '' } = fluency;

        assert.equal(ok, false, messages.join(''));
        assert.equal(complete, false);
        assert.equal(raw, null);
        assert.equal(published, null);
        assert.match(error, marker);
        assert.equal(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8'), priorBytes);
        assert.equal(await readFile(report, 'utf8'), priorReport);
        assert.deepEqual((await readdir(project)).filter(name => name.startsWith('.fluency-output-staging-') ||
            name.startsWith('.resilient-backup-') || name.startsWith('.resilient-report-')), []);

        if (stopped) await assertWorkerStopped();
    };
    const recordPid = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n`;
    await failure({ config: `${recordPid}module.exports = [{ ignores: ['fluency-output/**'] }];\n`, marker: /Missing or ignored/u });
    await failure({ config: `${recordPid}module.exports = [{ files: ['**/*.ts'], rules: { quotes: 'error' } }];\n`, marker: /No enabled/u });
    await failure({ config: `${recordPid}module.exports = [];\n`, marker: /No enabled/u });
    await failure({ config: `${recordPid}module.exports = [{ rules: { 'missing-rule': 'error' } }];\n`, marker: /missing-rule/u });
    await failure({ config: `${recordPid}module.exports = [{ rules: { quotes: 'error' }, languageOptions: { sourceType: 'script' } }];\n`,
        marker: /Incomplete JavaScript lint/u });
    await failure({ options: { eslintConfig: path.join(project, 'missing.config.js') }, marker: /ENOENT/u, stopped: false });
    await failure({ options: { eslintConfig: 42 }, marker: /overrideConfigFile/u, stopped: false });
    const spawnScript = `import { runLowering } from ${JSON.stringify(new URL('../scripts/lower-typescript-project.js', import.meta.url).href)};
const keeper = setInterval(() => {}, 1000);
try { console.log(JSON.stringify(await runLowering(${JSON.stringify({
        project: base.project, outDir: fluencyOutput, cwd: path.join(project, 'missing-cwd'), eslintConfig, report
    })}))); } finally { clearInterval(keeper); }`;
    const beforeSpawnBytes = await readFile(path.join(fluencyOutput, 'index.js'), 'utf8');
    const beforeSpawnReport = await readFile(report, 'utf8');
    const spawnFailure = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', spawnScript], {
        cwd: project, timeout: 10000, encoding: 'utf8'
    }));
    assert.equal(spawnFailure.ok, false);
    assert.equal(spawnFailure.fluency.complete, false);
    assert.match(spawnFailure.fluency.error, /ENOENT/u);
    assert.equal(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8'), beforeSpawnBytes);
    assert.equal(await readFile(report, 'utf8'), beforeSpawnReport);
    assert.deepEqual((await readdir(project)).filter(name => name.startsWith('.fluency-output-staging-')), []);
    await failure({ config: `${recordPid}module.exports = [{ plugins: { fail: { rules: { boom: { create() { throw new Error('worker-rule-failure'); } } } } },
rules: { 'fail/boom': 'error' } }];\n`, marker: /worker-rule-failure/u });
    await failure({ config: `${recordPid}process.exit(17);\n`, marker: /worker (disconnected|exited)/u });
    await failure({ config: `${recordPid}process.disconnect(); setInterval(() => {}, 10000);\n`, marker: /worker disconnected/u });
    const processorConfig = (preprocess = 'return [text];') => `${recordPid}module.exports = [
{ files: ['**/*.js'], rules: { quotes: ['error', 'single'] } },
{ files: ['**/index.js', '**/types.js'], plugins: { fixture: { processors: { parts: {
preprocess(text) { ${preprocess} }, postprocess(messages) { return messages.flat(); }, supportsAutofix: true
} } } }, processor: 'fixture/parts' },
{ files: ['**/*empty.js'], rules: { quotes: 'off' } }];\n`;
    const processorTrace = path.join(project, 'processor-trace');
    await writeFile(processorTrace, '');
    await writeFile(eslintConfig, processorConfig(`require('node:fs').appendFileSync(${JSON.stringify(processorTrace)}, 'pre\\n'); return [text];`));
    const processed = await runLowering({ ...base, report });
    assert.equal(processed.ok, true, messages.join(''));
    assert.equal(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8'), rawBytes);
    assert.equal(await readFile(processorTrace, 'utf8'), 'pre\npre\n', 'Stats must not invoke the processor a second time');
    assert.equal(processed.fluency.raw.errors, 1);
    const processedFixed = await runLowering({ ...base, fixAll: true, report });
    assert.equal(processedFixed.ok, true, messages.join(''));
    assert.equal(processedFixed.fluency.postFix.errors, 0);
    await assertWorkerStopped();
    await failure({ config: processorConfig('return [];'), marker: /no parser or enabled-rule execution/u });
    await failure({ config: processorConfig("return [{ text, filename: 'unsupported.txt' }];"), marker: /no parser or enabled-rule execution/u });
    await failure({ config: processorConfig("return [{ text: text + '\\n', filename: 'empty.js' }];"), marker: /no parser or enabled-rule execution/u });
    await failure({ config: `${recordPid}module.exports = [{ files: ['**/*.js'], rules: { quotes: ['error', 'single'] } },
{ files: ['**/types.js'], languageOptions: { sourceType: 'script' } }];\n`, marker: /Incomplete JavaScript lint/u,
    options: { fixAll: true } });
    await failure({ options: { report: path.join(project, 'absent-directory', 'result.json') }, marker: /ENOENT/u });
    // Failing the final external report rename after output staging must restore the prior publication.
    const reportDirectory = path.join(project, 'report-directory');
    await mkdir(reportDirectory);
    await failure({ options: { report: reportDirectory }, marker: /EISDIR|ENOTEMPTY/u });
    await failure({ options: { report: path.join(fluencyOutput, 'index.js') }, marker: /report may not replace/u });
    await writeFile(eslintConfig, quoteConfig);
    const insideReport = path.join(fluencyOutput, 'report.json');
    assert.equal((await runLowering({ ...base, report: insideReport })).ok, true);
    assert.equal(JSON.parse(await readFile(insideReport, 'utf8')).complete, true);
    assert.equal(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8'), rawBytes);

    await writeFile(eslintConfig, `${recordPid}throw new Error('default-must-not-load-eslint');\n`);
    assert.equal((await runLowering(base)).ok, true);
    await writeFile(eslintConfig, quoteConfig);
    const cliOutput = path.join(project, 'cli-output');
    const cliReport = path.join(project, 'cli-report.json');
    const cliArgs = ['--project', path.join(project, 'tsconfig.json'), '--outDir', cliOutput, '--eslint-config', eslintConfig];
    execFileSync(process.execPath, [cliEntry, ...cliArgs, '--report', cliReport], { cwd: project, timeout: 10000 });
    assert.equal(await readFile(path.join(cliOutput, 'index.js'), 'utf8'), rawBytes);
    assert.throws(() => execFileSync(process.execPath, [cliEntry, ...cliArgs, '--eslint-config', eslintConfig], { cwd: project, timeout: 10000 }));

    // Direct protocol controls cover unsupported file paths, fatal parse failures, empty fixer output, and shutdown.
    const emptyConfig = path.join(project, 'empty-fix.config.js');
    await writeFile(emptyConfig, `module.exports = [{ plugins: { empty: { rules: { remove: { meta: { fixable: 'code' }, create(context) {
return { Program(node) { if (context.sourceCode.text) context.report({ node, message: 'Remove fixture', fix: fixer => fixer.removeRange([0, context.sourceCode.text.length]) }); } };
} } } } }, rules: { 'empty/remove': 'error' } }];\n`);
    const child = fork(workerEntry, [], { cwd: project, serialization: 'advanced' });
    const exited = once(child, 'exit');
    let requestId = 0;
    const request = async (message) => {
        const response = once(child, 'message');
        child.send({ ...message, id: requestId });
        requestId += 1;
        const [result = {}] = await response;

        return result;
    };

    try {
        assert.equal((await request({ type: 'init', cwd: project, eslintConfig: emptyConfig, measure: true, fixAll: true })).error, undefined);
        const removed = await request({ type: 'fix', code: 'export const value = 1;\n', filePath: path.join(project, 'empty.js') });
        assert.equal(removed.output, '');
        assert.equal(removed.raw.errorCount, 1);
        assert.equal(removed.fixed.errorCount, 0);
        assert.match((await request({ type: 'fix', code: 'const = ;', filePath: path.join(project, 'parse.js') })).error, /Incomplete JavaScript lint/u);
        assert.match((await request({ type: 'fix', code: '', filePath: path.join(project, 'unsupported.txt') })).error, /Missing or ignored/u);
        assert.match((await request({ type: 'unexpected' })).error, /Unknown ESLint worker request/u);
        await writeFile(eslintConfig, quoteConfig);
        await request({ type: 'init', cwd: project, eslintConfig, measure: true, fixAll: false });
        const suppressed = await request({ type: 'fix', code: '// eslint-disable-next-line quotes -- Preserved authored quote choice.\nexport const value = "hello";\n',
            filePath: path.join(project, 'suppressed.js') });
        assert.equal(suppressed.error, undefined);
        assert.equal(suppressed.raw.suppressedMessages.length, 1);
        const disabled = await request({ type: 'fix', code: '/* eslint quotes: off */\nexport const value = "hello";\n',
            filePath: path.join(project, 'no-rules.js') });
        assert.match(disabled.error, /no parser or enabled-rule execution/u);
        await writeFile(eslintConfig, `module.exports = [{ plugins: { empty: { rules: { noop: { create() { return {}; } } } } }, rules: { 'empty/noop': 'error' } }];\n`);
        await request({ type: 'init', cwd: project, eslintConfig, measure: true, fixAll: false });
        const noListeners = await request({ type: 'fix', code: '', filePath: path.join(project, 'empty.js') });
        assert.equal(noListeners.error, undefined);
        await request({ type: 'close' });
        await exited;
    } finally {
        child.kill('SIGKILL');
    }

    await writeFile(path.join(source, 'broken.ts'), 'const = ;\n');
    const failedOutput = path.join(project, 'failed-output');
    const failed = await runLowering({ project: path.join(project, 'tsconfig.json'), outDir: failedOutput, cwd: project, write });

    assert.equal(failed.ok, false);
    await assert.rejects(access(path.join(failedOutput, 'broken.js')));
} finally {
    await rm(directory, { recursive: true, force: true });
}
