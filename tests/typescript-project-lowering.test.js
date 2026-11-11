import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getObject } from 'eslint-plugin-resilient/standard/object';

import { getLintSummary } from '../scripts/fluency-report.js';
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
    await writeFile(path.join(project, 'package.json'), '{"type":"module"}\n');
    await writeFile(path.join(project, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            declaration: true,
            module: 'nodenext',
            moduleResolution: 'nodenext',
            rootDir: './src',
            sourceMap: true,
            strict: true,
            target: 'esnext'
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
        project: path.join(project, 'tsconfig.json'), outDir: output, fixAll: false, eslintConfig: undefined, report: undefined,
        manifest: undefined, emit: [], inspect: false
    });
    const argumentObject = { 0: '--project', 1: 'project/tsconfig.json', length: 2,
        get at() { throw new Error('CLI indexing must not acquire an array method.'); } };
    // eslint-disable-next-line resilient/signature-contract-call-site -- This deliberate array-like input verifies native indexed access without acquiring array methods.
    assert.deepEqual(getOptions(argumentObject, directory), getOptions(['--project', 'project/tsconfig.json'], directory));
    assert.throws(() => getOptions(['--project'], directory), /Usage:/u);
    assert.throws(() => getOptions([undefined], directory), /Usage:/u);

    assert.deepEqual(getOptions(['--project', 'project/tsconfig.json'], directory), {
        project: path.join(project, 'tsconfig.json'), outDir: undefined, fixAll: false, eslintConfig: undefined, report: undefined,
        manifest: undefined, emit: [], inspect: false
    });
    const defaulted = await runLowering({ project: path.join(project, 'tsconfig.json'), cwd: project, write });

    assert.equal(defaulted.ok, true, messages.join(''));
    assert.equal(defaulted.outDir, path.join(project, '.resilient'));
    await access(path.join(defaulted.outDir, 'index.js'));

    const unsafe = await runLowering({ project: path.join(project, 'tsconfig.json'), outDir: source, cwd: project, write });
    assert.equal(unsafe.ok, false);

    const safety = path.join(project, 'safety');
    const safetySource = path.join(safety, 'src');
    const safetyOutput = path.join(safety, 'generated');
    const safetyConfig = path.join(safety, 'tsconfig.json');
    const safetyBase = path.join(safety, 'base.json');
    const safetyEslint = path.join(safety, 'eslint.config.js');
    const importedDirectory = path.join(safety, 'dependency');
    const imported = path.join(importedDirectory, 'authored.js');
    await mkdir(safetySource, { recursive: true });
    await writeFile(path.join(safety, 'package.json'), '{"type":"module"}\n');
    await mkdir(safetyOutput);
    await mkdir(importedDirectory);
    await writeFile(safetyBase, JSON.stringify({ compilerOptions: {
        rootDir: './src', allowJs: true, target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext'
    } }));
    await writeFile(safetyConfig, JSON.stringify({ extends: './base.json', include: ['src/**/*.ts', 'escape.ts'] }));
    await writeFile(path.join(safetySource, 'index.ts'), 'export const value = 1;\n');
    await writeFile(path.join(safety, 'escape.ts'), 'export const escaped = 2;\n');
    await writeFile(path.join(safety, 'escape.js'), '// authored JavaScript must survive\n');
    await writeFile(imported, 'export const dependency = 3;\n');
    await writeFile(safetyEslint, 'export default [{ rules: { quotes: "error" } }];\n');
    await writeFile(path.join(safetyOutput, 'previous.js'), '// prior publication must survive\n');
    const preservedFiles = [safetyConfig, safetyBase, safetyEslint, imported, path.join(safetySource, 'index.ts'),
        path.join(safety, 'escape.ts'), path.join(safety, 'escape.js'), path.join(safetyOutput, 'previous.js')];
    const rejectUnsafe = async (options = {}, marker = /project input/u) => {
        const before = await Promise.all(preservedFiles.map(file => readFile(file, 'utf8')));
        const { length: messageStart = 0 } = messages;
        const rejected = await runLowering({ project: safetyConfig, outDir: safetyOutput, cwd: safety, write, ...options });
        const { ok = true } = rejected;
        assert.equal(ok, false);
        assert.match(messages.slice(messageStart).join(''), marker);
        assert.deepEqual(await Promise.all(preservedFiles.map(file => readFile(file, 'utf8'))), before);
        assert.deepEqual(await readdir(safetyOutput), ['previous.js']);
        assert.deepEqual((await readdir(safety)).filter(name => name.startsWith('.generated-staging-') ||
            name.startsWith('.resilient-backup-') || name.startsWith('.resilient-report-')), []);
    };

    await rejectUnsafe({}, /Generated JavaScript must remain inside/u);
    // A deeper escape can write outside the project itself, even with a dedicated output directory.
    await writeFile(safetyConfig, JSON.stringify({ extends: './base.json', include: ['src/**/*.ts', '../src/index.ts'] }));
    const authoredOutside = path.join(project, 'index.js');
    await writeFile(authoredOutside, '// authored outside the project\n');
    await rejectUnsafe({}, /Generated JavaScript must remain inside/u);
    assert.equal(await readFile(authoredOutside, 'utf8'), '// authored outside the project\n');
    // An explicit emit selection must obey containment as well as the main include list.
    await writeFile(safetyConfig, JSON.stringify({ extends: './base.json', include: ['src/**/*.ts'], resilient: { emit: ['escape.ts'] } }));
    await rejectUnsafe({}, /Selected emit source is absent from the TypeScript program/u);
    await writeFile(safetyConfig, JSON.stringify({ extends: './base.json', include: ['src/**/*.ts'] }));
    await rejectUnsafe({ report: safetyConfig });
    await rejectUnsafe({ report: safetyBase });
    await rejectUnsafe({ report: path.join(safetySource, 'index.ts') });
    await rejectUnsafe({ report: safetyEslint, eslintConfig: safetyEslint });
    await rejectUnsafe({ report: safetyEslint });
    const lintOutput = path.join(safety, 'lint-output');
    const discoveredConfig = path.join(lintOutput, 'eslint.config.js');
    const discoveredConfigBytes = 'export default [{ rules: { quotes: "error" } }];\n';
    await mkdir(lintOutput);
    await writeFile(discoveredConfig, discoveredConfigBytes);
    await rejectUnsafe({ outDir: lintOutput, cwd: lintOutput, fixAll: true });
    assert.equal(await readFile(discoveredConfig, 'utf8'), discoveredConfigBytes);
    assert.deepEqual(await readdir(lintOutput), ['eslint.config.js']);
    assert.deepEqual((await readdir(safety)).filter(name => name.startsWith('.lint-output-staging-')), []);
    await writeFile(path.join(safetySource, 'index.ts'), 'export { dependency } from "../dependency/authored.js";\n');
    await rejectUnsafe({ report: imported });
    await rejectUnsafe({ outDir: importedDirectory });
    const sourceAlias = path.join(safety, 'source-alias');
    await symlink(safetySource, sourceAlias, 'dir');
    await rejectUnsafe({ outDir: sourceAlias });
    await rejectUnsafe({ report: path.join(sourceAlias, 'index.ts') });
    const configAlias = path.join(safety, 'config-alias.json');
    await symlink(safetyConfig, configAlias);
    await rejectUnsafe({ report: configAlias });
    // Replacing the directory must also preserve source symlinks whose targets live elsewhere.
    const linkedOutput = path.join(safety, 'linked-output');
    await mkdir(linkedOutput);
    const linkedSource = path.join(linkedOutput, 'source.ts');
    await symlink(path.join(safetySource, 'index.ts'), linkedSource);
    await writeFile(safetyConfig, JSON.stringify({ include: ['linked-output/source.ts'] }));
    await rejectUnsafe({ outDir: linkedOutput });
    assert.equal(await realpath(linkedSource), path.join(safetySource, 'index.ts'));
    await writeFile(safetyConfig, JSON.stringify({ extends: './base.json', include: ['src/**/*.ts'] }));
    const cliConfigBytes = await readFile(safetyConfig, 'utf8');
    assert.throws(() => execFileSync(process.execPath, [cliEntry, '--project', safetyConfig,
        '--outDir', safetyOutput, '--report', safetyConfig], { cwd: safety, timeout: 10000, stdio: 'pipe' }), { status: 1 });
    assert.equal(await readFile(safetyConfig, 'utf8'), cliConfigBytes);

    const fluencyOutput = path.join(project, 'fluency-output');
    const report = path.join(project, 'fluency.json');
    const eslintConfig = path.join(project, 'eslint.config.js');

    await writeFile(eslintConfig, 'export default [{ files: ["**/*.js"], rules: { quotes: ["error", "single"] } }];\n');
    const fixed = await runLowering({
        project: path.join(project, 'tsconfig.json'), outDir: fluencyOutput, cwd: project, fixAll: true, eslintConfig, report,
        write
    });

    assert.equal(fixed.ok, true, messages.join(''));
    assert.equal(JSON.parse(await readFile(report, 'utf8')).fixed.errors, 0);
    assert.match(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8'), /'hello'/u);

    const rawBytes = await readFile(path.join(output, 'index.js'), 'utf8');
    const pidFile = path.join(project, 'worker.pid');
    const quoteConfig = `import { writeFileSync, appendFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));
export default [{ files: ['**/*.js'], rules: { quotes: ['error', 'single'] } }];\n`;
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
    await writeFile(eslintConfig, `export default [{ files: ['fluency-output/**/*.js'], rules: { quotes: ['error', 'single'] } }];\n`);
    assert.equal((await runLowering({ ...base, report })).ok, true);

    const failure = async ({ config = quoteConfig, options = {}, marker = /Incomplete/u, stopped = true } = {}) => {
        await writeFile(eslintConfig, config);
        const priorBytes = await readFile(path.join(fluencyOutput, 'index.js'), 'utf8');
        const priorReport = await readFile(report, 'utf8');
        const result = await runLowering({ ...base, report, ...options });
        const { ok = false, fluency = {} } = result;
        // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- The failure oracle verifies actual JSON null results, not normalized replacements.
        const { complete = true, raw, published, error = '' } = fluency;

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
    const recordPid = `import { writeFileSync, appendFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n`;
    await failure({ config: `${recordPid}export default [{ ignores: ['fluency-output/**'] }];\n`, marker: /Missing or ignored/u });
    await failure({ config: `${recordPid}export default [{ files: ['**/*.ts'], rules: { quotes: 'error' } }];\n`, marker: /No enabled/u });
    await failure({ config: `${recordPid}export default [];\n`, marker: /No enabled/u });
    await failure({ config: `${recordPid}export default [{ rules: { 'missing-rule': 'error' } }];\n`, marker: /missing-rule/u });
    await failure({ config: `${recordPid}export default [{ rules: { quotes: 'error' }, languageOptions: { sourceType: 'script' } }];\n`,
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
    await failure({ config: `${recordPid}export default [{ plugins: { fail: { rules: { boom: { create() { throw new Error('worker-rule-failure'); } } } } },
rules: { 'fail/boom': 'error' } }];\n`, marker: /worker-rule-failure/u });
    await failure({ config: `${recordPid}process.exit(17);\n`, marker: /worker (disconnected|exited)/u });
    await failure({ config: `${recordPid}process.disconnect(); setInterval(() => {}, 10000);\n`, marker: /worker disconnected/u });
    const processorConfig = (preprocess = 'return [text];') => `${recordPid}export default [
{ files: ['**/*.js'], rules: { quotes: ['error', 'single'] } },
{ files: ['**/index.js', '**/types.js'], plugins: { fixture: { processors: { parts: {
preprocess(text) { ${preprocess} }, postprocess(messages) { return messages.flat(); }, supportsAutofix: true
} } } }, processor: 'fixture/parts' },
{ files: ['**/*empty.js'], rules: { quotes: 'off' } }];\n`;
    const processorTrace = path.join(project, 'processor-trace');
    await writeFile(processorTrace, '');
    await writeFile(eslintConfig, processorConfig(`appendFileSync(${JSON.stringify(processorTrace)}, 'pre\\n'); return [text];`));
    const processed = await runLowering({ ...base, report });
    assert.equal(processed.ok, true, messages.join(''));
    assert.equal(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8'), rawBytes);
    assert.equal(await readFile(processorTrace, 'utf8'), 'pre\npre\n', 'Stats must not invoke the processor a second time');
    assert.equal(processed.fluency.raw.errors, 1);
    await writeFile(processorTrace, '');
    const processedFixed = await runLowering({ ...base, fixAll: true, report });
    assert.equal(processedFixed.ok, true, messages.join(''));
    assert.equal(processedFixed.fluency.raw.errors, 1);
    assert.equal(processedFixed.fluency.postFix.errors, 0);
    assert.equal(await readFile(processorTrace, 'utf8'), 'pre\n'.repeat(7), 'Report mode must retain raw and post-fix analysis');
    const processedFixedBytes = await readFile(path.join(fluencyOutput, 'index.js'), 'utf8');
    await writeFile(processorTrace, '');
    const processedFixedOnly = await runLowering({ ...base, fixAll: true });
    assert.equal(processedFixedOnly.ok, true, messages.join(''));
    assert.equal(processedFixedOnly.fluency, undefined);
    assert.equal(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8'), processedFixedBytes);
    assert.equal(await readFile(processorTrace, 'utf8'), 'pre\n'.repeat(3), 'Fix-only mode must skip raw analysis for changed and unchanged files');
    await assertWorkerStopped();
    await failure({ config: processorConfig('return [];'), marker: /no parser or enabled-rule execution/u });
    await failure({ config: processorConfig("return [{ text, filename: 'unsupported.txt' }];"), marker: /no parser or enabled-rule execution/u });
    await failure({ config: processorConfig("return [{ text: text + '\\n', filename: 'empty.js' }];"), marker: /no parser or enabled-rule execution/u });
    await failure({ config: `${recordPid}export default [{ files: ['**/*.js'], rules: { quotes: ['error', 'single'] } },
{ files: ['**/types.js'], languageOptions: { sourceType: 'script' } }];\n`, marker: /Incomplete JavaScript lint/u,
    options: { fixAll: true } });
    await failure({ options: { report: path.join(project, 'absent-directory', 'result.json') }, marker: /ENOENT/u });
    // Failing the final external report rename after output staging must restore the prior publication.
    const reportDirectory = path.join(project, 'report-directory');
    await mkdir(reportDirectory);
    await failure({ options: { report: reportDirectory }, marker: /EISDIR|ENOTEMPTY/u });
    await failure({ options: { report: path.join(fluencyOutput, 'index.js') }, marker: /report may not replace/u });
    const outputAlias = path.join(project, 'fluency-alias');
    await symlink(fluencyOutput, outputAlias, 'dir');
    await failure({ options: { report: path.join(outputAlias, 'index.js') }, marker: /report may not replace/u });
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
    await writeFile(emptyConfig, `export default [{ plugins: { empty: { rules: { remove: { meta: { fixable: 'code' }, create(context) {
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
        await writeFile(eslintConfig, `export default [{ plugins: { empty: { rules: { noop: { create() { return {}; } } } } }, rules: { 'empty/noop': 'error' } }];\n`);
        await request({ type: 'init', cwd: project, eslintConfig, measure: true, fixAll: false });
        const noListeners = await request({ type: 'fix', code: '', filePath: path.join(project, 'empty.js') });
        assert.equal(noListeners.error, undefined);
        await request({ type: 'close' });
        await exited;
    } finally {
        child.kill('SIGKILL');
    }

    // Reports must agree with fresh ESLint on complete sibling modules, including prior publications and fixed providers.
    const graphProject = path.join(project, 'graph');
    const graphSource = path.join(graphProject, 'src');
    const graphOutput = path.join(graphProject, 'generated');
    const graphConfig = path.join(graphProject, 'eslint.config.js');
    const graphTsconfig = path.join(graphProject, 'tsconfig.json');
    const graphReport = path.join(graphProject, 'report.json');
    await mkdir(graphSource, { recursive: true });
    await writeFile(path.join(graphProject, 'package.json'), '{"type":"module"}\n');
    await writeFile(path.join(graphSource, 'consumer.ts'), 'import { getValue } from "./provider.js";\nexport const render = () => getValue().toUpperCase();\n');
    const graphLintConfig = (replacement = '') => `import resilient from ${JSON.stringify(new URL('../index.js', import.meta.url).href)};
export default [{ ...resilient.configs.contracts, files: ['generated/**/*.js'] }, {
files: ['generated/provider.js'], plugins: { fixture: { rules: { replace: {
meta: { fixable: 'code', schema: [], messages: { replace: 'Replace provider value.' } },
create(context) { return { Literal(node) {
if (!${JSON.stringify(replacement)} || node.value === ${replacement || 'undefined'}) return;
context.report({ node, messageId: 'replace', fix: fixer => fixer.replaceText(node, ${JSON.stringify(replacement)}) });
} }; }
} } } }, rules: { 'fixture/replace': ${replacement ? "'error'" : "'off'"} }
}];\n`;
    const freshGraphLint = () => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
import { ESLint } from ${JSON.stringify(new URL('../node_modules/eslint/lib/api.js', import.meta.url).href)};
const eslint = new ESLint({ cwd: process.argv[1], overrideConfigFile: process.argv[2] });
console.log(JSON.stringify(await eslint.lintFiles(['generated/**/*.js'])));
`, graphProject, graphConfig], { cwd: graphProject, encoding: 'utf8', timeout: 10000 }));
    const checkGraphReport = async ({ fixAll = false, errors = 0 } = {}) => {
        const result = await runLowering({
            project: graphTsconfig, outDir: graphOutput, cwd: graphProject, eslintConfig: graphConfig,
            report: graphReport, fixAll, write
        });
        const { ok = false, fluency = {} } = result;
        const { complete = false, published = {}, clean = false, coverage = {}, files = [] } = getObject(fluency);
        const { errors: publishedErrors = 0 } = getObject(published);
        assert.equal(ok, true, messages.join(''));
        assert.equal(complete, true);
        assert.equal(publishedErrors, errors);
        assert.equal(clean, errors === 0);
        assert.deepEqual(coverage, { expected: 2, measured: 2 });
        const fresh = freshGraphLint();
        assert.deepEqual(published, getLintSummary(fresh));
        const consumer = fresh.find(({ filePath = '' } = {}) => filePath.endsWith('consumer.js'));
        const { errorCount = 0, messages: consumerMessages = [], filePath: consumerPath = '' } = consumer;
        assert.equal(errorCount, errors);
        const consumerRow = files.find(({ filePath = '' } = {}) => filePath.endsWith('consumer.js'));
        const { raw = {}, postFix = {}, publishedSha256 = '' } = consumerRow;
        const { messages: measuredMessages = [] } = fixAll ? postFix : raw;
        assert.deepEqual(measuredMessages, consumerMessages);
        assert.equal(publishedSha256, digest(await readFile(consumerPath, 'utf8')));
        assert.deepEqual(JSON.parse(await readFile(graphReport, 'utf8')), fluency);

        return fluency;
    };
    // eslint-disable-next-line resilient/prefer-prototype-methods -- Each file order exercises successive publications of the same tree and must finish before the next order starts.
    for (const order of [['consumer', 'provider'], ['provider', 'consumer']]) {
        await writeFile(graphTsconfig, JSON.stringify({
            compilerOptions: { rootDir: './src', target: 'esnext', module: 'nodenext', moduleResolution: 'nodenext' },
            files: order.map(name => `src/${name}.ts`)
        }));
        await writeFile(graphConfig, graphLintConfig());
        await rm(graphOutput, { recursive: true, force: true });
        await writeFile(path.join(graphSource, 'provider.ts'), 'export const getValue = (): any => 42;\n');
        await checkGraphReport({ errors: 1 });
        // A prior numeric provider must not contaminate the newly emitted string provider, or vice versa.
        await writeFile(path.join(graphSource, 'provider.ts'), 'export const getValue = (): any => "hello";\n');
        await checkGraphReport();
        await writeFile(path.join(graphSource, 'provider.ts'), 'export const getValue = (): any => 42;\n');
        await checkGraphReport({ fixAll: true, errors: 1 });

        // Autofixing a provider changes its consumers without changing the consumer's bytes.
        await writeFile(graphConfig, graphLintConfig('"hello"'));
        const repaired = await checkGraphReport({ fixAll: true });
        assert.equal(repaired.raw.byRule['resilient/signature-contract-operation'].errors, 1);
        assert.equal(repaired.changedFiles, 1);
        await writeFile(path.join(graphSource, 'provider.ts'), 'export const getValue = (): any => "hello";\n');
        await writeFile(graphConfig, graphLintConfig('42'));
        const contradicted = await checkGraphReport({ fixAll: true, errors: 1 });
        assert.equal(contradicted.raw.byRule['resilient/signature-contract-operation'], undefined);
        assert.equal(contradicted.changedFiles, 1);
    }

    // A final-pass failure must roll back all fixed files and leave the prior report intact.
    const previousGraph = await Promise.all(['consumer.js', 'provider.js'].map(name => readFile(path.join(graphOutput, name), 'utf8')));
    const previousGraphReport = await readFile(graphReport, 'utf8');
    const finalFailureConfig = graphLintConfig('42').replace('export default [', 'const configs = [') + `
import { readFileSync } from 'node:fs';
export default [...configs, { files: ['generated/consumer.js'], plugins: { fixtureFailure: { rules: { fail: {
create() { return { Program() {
if (readFileSync(${JSON.stringify(path.join(graphOutput, 'provider.js'))}, 'utf8').includes('42')) throw new Error('final-tree-failure');
} }; }
} } } }, rules: { 'fixtureFailure/fail': 'error' } }];\n`;
    await writeFile(graphConfig, finalFailureConfig);
    const finalFailure = await runLowering({
        project: graphTsconfig, outDir: graphOutput, cwd: graphProject, eslintConfig: graphConfig,
        report: graphReport, fixAll: true, write
    });
    assert.equal(finalFailure.ok, false);
    assert.equal(finalFailure.fluency.complete, false);
    assert.equal(finalFailure.fluency.published, null);
    assert.match(finalFailure.fluency.error, /final-tree-failure/u);
    assert.deepEqual(await Promise.all(['consumer.js', 'provider.js'].map(name => readFile(path.join(graphOutput, name), 'utf8'))), previousGraph);
    assert.equal(await readFile(graphReport, 'utf8'), previousGraphReport);
    assert.deepEqual((await readdir(graphProject)).filter(name => name.startsWith('.generated-staging-') ||
        name.startsWith('.resilient-backup-') || name.startsWith('.resilient-report-')), []);

    await writeFile(path.join(source, 'broken.ts'), 'const = ;\n');
    const failedOutput = path.join(project, 'failed-output');
    const failed = await runLowering({ project: path.join(project, 'tsconfig.json'), outDir: failedOutput, cwd: project, write });

    assert.equal(failed.ok, false);
    await assert.rejects(access(path.join(failedOutput, 'broken.js')));
} finally {
    await rm(directory, { recursive: true, force: true });
}
