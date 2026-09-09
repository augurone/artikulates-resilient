import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createCorpusLint, createCorpusStages, publishJavascript, runCorpusLint } from '../scripts/corpus-lint.js';
import { hashFiles, readJson } from '../scripts/proof-files.js';
import { verifyStageJournal } from '../scripts/proof-stages.js';

const repository = mkdtempSync(path.join(tmpdir(), 'resilient-corpus-recovery-'));
const generated = path.join(repository, 'generated');
const raw = path.join(generated, 'raw-js');
const sources = ['0.ts', '1.ts'];
const source = path.join(repository, 'source.txt');
const journal = path.join(repository, 'stages.json');
const config = path.join(repository, 'eslint.config.js');

try {
    mkdirSync(raw, { recursive: true });
    writeFileSync(path.join(repository, 'package.json'), '{"type":"module"}');
    writeFileSync(config, 'export default [{ files: ["**/*.js"], rules: { semi: ["error", "never"] } }];\n');
    writeFileSync(source, 'original');
    const inputs = hashFiles([source, config]);
    const lint = createCorpusLint({ generated, configFile: config });
    const first = createCorpusStages({ file: journal, inputs });
    let trace = [];
    const emit = async ({ name = '', stages = first } = {}) => stages.run({ id: `emit-${name}`, execute: async () => {
        trace = [...trace, `lower-${name}`];
        const file = path.join(raw, `${name}.js`);
        const code = `const value${name} = ${name};\n`;
        writeFileSync(file, code);
        const finding = await lint.raw({ code, file });
        trace = [...trace, `lint-${name}`];
        assert.equal(readFileSync(file, 'utf8'), code, 'Raw lint leaves emitted bytes unchanged.');
        const report = path.join(repository, `lint-${name}.json`);
        writeFileSync(report, JSON.stringify(finding));

        return { value: finding, files: [file, report] };
    } });
    const firstResult = await emit({ name: '0' });
    const { messages: firstMessages = [] } = firstResult;
    assert.equal(firstMessages.some(({ ruleId = '' } = {}) => ruleId === 'semi'), true);
    let interrupted = false;

    await assert.rejects(first.run({ id: 'emit-1', execute: async () => {
        const partial = path.join(repository, 'partial-1');
        writeFileSync(partial, 'retained');
        interrupted = true;
        throw new Error('interrupted between lowering and raw lint');
    } }), /interrupted/u);
    assert.equal(interrupted, true);
    assert.equal(existsSync(path.join(repository, 'partial-1')), true);
    assert.deepEqual(readJson(journal).stages.map(({ status = '' } = {}) => status), ['completed', 'failed']);

    const resumed = createCorpusStages({ file: journal, inputs });
    await resumed.run({ id: 'emit-0', execute: () => { throw new Error('Completed file regenerated.'); } });
    await emit({ name: '1', stages: resumed });
    assert.deepEqual(trace, ['lower-0', 'lint-0', 'lower-1', 'lint-1']);
    assert.equal(readJson(journal).stages.find(({ id = '' } = {}) => id === 'emit-1').attempts, 2);
    const beforeFix = hashFiles(sources.map(name => path.join(raw, name.replace('.ts', '.js'))));
    let fixFiles = [];
    const observedLint = { ...lint, fixed: async (input) => {
        const { file = '' } = input;
        fixFiles = [...fixFiles, file];

        return lint.fixed(input);
    } };
    const summary = await runCorpusLint({ generated, sources, run: resumed.run, lint: observedLint });
    assert.deepEqual(fixFiles, sources.map(name => path.join(raw, name.replace('.ts', '.js'))));
    assert.equal(summary.files, 2);
    assert.equal(summary.errors, 0);
    assert.equal(readFileSync(path.join(generated, 'js/0.js'), 'utf8'), 'const value0 = 0\n');
    assert.deepEqual(hashFiles(Object.keys(beforeFix)), beforeFix, 'Fixing never mutates raw output.');
    const format = readJson(path.join(generated, 'artifact-format.json'));
    assert.deepEqual(format.files.map(({ fixed = false } = {}) => fixed), [true, true]);
    verifyStageJournal(readJson(journal));
    const resumedAgain = createCorpusStages({ file: journal, inputs });
    await runCorpusLint({ generated, sources, run: resumedAgain.run, lint });
    assert.deepEqual(hashFiles(Object.keys(beforeFix)), beforeFix);

    const worker = path.join(repository, 'signal-worker.mjs');
    const partial = path.join(repository, 'signal-partial');
    const { href: stageModule = '' } = new URL('../scripts/corpus-lint.js', import.meta.url);
    writeFileSync(worker, [
        `import { createCorpusStages } from ${JSON.stringify(stageModule)};`,
        'import { writeFileSync } from "node:fs";',
        `const { run } = createCorpusStages(${JSON.stringify({ file: journal, inputs })});`,
        `await run({ id: 'signal-stage', execute: async () => { writeFileSync(${JSON.stringify(partial)}, 'retained'); process.kill(process.pid, 'SIGTERM'); } });`
    ].join('\n'));
    const { signal = '' } = spawnSync(process.execPath, [worker]);
    assert.equal(signal, 'SIGTERM');
    assert.equal(existsSync(partial), true);
    const interruptedJournal = readJson(journal);
    assert.equal(interruptedJournal.stages.find(({ id = '' } = {}) => id === 'signal-stage').status, 'running');
    const signalResume = createCorpusStages({ file: journal, inputs });
    const resumedSignal = await signalResume.run({ id: 'signal-stage', execute: async () => ({ value: { resumed: true } }) });
    assert.deepEqual(resumedSignal, { resumed: true });
    assert.equal(readJson(journal).stages.find(({ id = '' } = {}) => id === 'signal-stage').attempts, 2);

    const pendingPublication = path.join(repository, 'pending-publication');
    mkdirSync(path.join(pendingPublication, 'pending-js'), { recursive: true });
    writeFileSync(path.join(pendingPublication, 'pending-js/extra.js'), 'unexpected');
    assert.throws(() => publishJavascript({ generated: pendingPublication,
        batches: [{ files: [path.join(raw, '0.js')] }] }), /file set changed/u);
    writeFileSync(path.join(generated, 'js/extra.js'), 'unexpected');
    assert.throws(() => verifyStageJournal(readJson(journal)), /file set changed/u);
} finally {
    rmSync(repository, { recursive: true, force: true });
}
