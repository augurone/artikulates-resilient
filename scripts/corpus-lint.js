import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { ESLint } from 'eslint';

import { getLintSummary } from './artifact-reports.js';
import { writeJsonReport } from './json-report.js';
import { digest, hashFiles, listFiles, readJson, verifyHashes } from './proof-files.js';
import { verifyStageJournal, writeStageJournal } from './proof-stages.js';
import { clearContractCaches } from '../rules/contracts/eslint-graph.js';

const compact = ({ filePath = '', messages = [], suppressedMessages = [], errorCount = 0,
    warningCount = 0, fatalErrorCount = 0 } = {}) => ({
    filePath, messages, suppressedMessages, errorCount, warningCount, fatalErrorCount
});
const verifyResult = ({ filePath = '', fatalErrorCount = 0, messages = [] } = {}, file = '') => {
    if (path.resolve(filePath) !== path.resolve(file) || fatalErrorCount) {
        throw new Error(`Incomplete corpus lint: ${file}`);
    }

    messages.forEach(({ ruleId = '', message = '', fatal = false } = {}) => {
        if (fatal || (!ruleId && !message.startsWith('Unused eslint-disable directive'))) {
            throw new Error(`Invalid corpus diagnostic: ${file}: ${message}`);
        }
    });
};
const createCorpusLint = ({ generated = '', configFile = '' } = {}) => {
    const options = { cwd: generated, overrideConfigFile: configFile };
    const lint = new ESLint({ ...options, fix: false });
    const fixer = new ESLint({ ...options, fix: true });
    const checkProfile = async (file) => {
        if (await lint.isPathIgnored(file) || !await lint.calculateConfigForFile(file)) {
            throw new Error(`Missing corpus lint profile: ${file}`);
        }
    };
    const raw = async ({ code = '', file = '' } = {}) => {
        await checkProfile(file);
        const [result = {}] = await lint.lintText(code, { filePath: file });
        verifyResult(result, file);

        return compact(result);
    };
    const fixed = async ({ code = '', file = '' } = {}) => {
        await checkProfile(file);
        const [result = {}] = await fixer.lintText(code, { filePath: file });
        verifyResult(result, file);
        const { output: fixedOutput = undefined, messages = [] } = result;
        const output = typeof fixedOutput === 'string' ? fixedOutput : code;
        const [verified = {}] = await lint.lintText(output, { filePath: file });
        verifyResult(verified, file);

        return { output, changed: output !== code, remaining: messages.length, lint: compact(verified) };
    };

    return { raw, fixed };
};
const createCorpusStages = ({ file = '', identity = {}, inputs = {} } = {}) => {
    let journal = existsSync(file) ? readJson(file) : { version: 1, identity, inputs, stages: [] };
    const { version = 0, identity: savedIdentity = {}, inputs: savedInputs = {} } = journal;

    if (version !== 1 || JSON.stringify(savedIdentity) !== JSON.stringify(identity) ||
        JSON.stringify(savedInputs) !== JSON.stringify(inputs)) {
        throw new Error('Proof inputs or runtime changed; use a new artifact instead of reusing completed stages.');
    }

    verifyStageJournal(journal);
    writeStageJournal(file, journal);
    const publish = (record) => {
        const { stages = [] } = journal;
        const { id = '' } = record;
        journal = { ...journal, stages: [...stages.filter(({ id: prior = '' } = {}) => prior !== id), record] };
        writeStageJournal(file, journal);
    };
    const run = async ({ id = '', execute = undefined, retry = true } = {}) => {
        if (!id || typeof execute !== 'function') throw new Error('A proof stage requires an id and executable operation.');

        const { stages = [] } = journal;
        const previous = stages.find(({ id: prior = '' } = {}) => prior === id) || {};
        const { status = '', value: previousValue = {}, attempts = 0, history = [] } = previous;

        if (status === 'completed') {
            verifyStageJournal({ version: 1, inputs, stages: [previous] });

            return previousValue;
        }

        if (status && !retry) {
            throw new Error(`Incomplete ${id}; preserve this partial artifact and start a new proof.`);
        }

        const record = {
            id, status: 'running', attempts: attempts + 1, started: new Date().toISOString(),
            history: status ? [...history, previous] : []
        };
        publish(record);
        process.stdout.write(`Proof stage ${id}: ${status ? 'retry' : 'start'}\n`);
        try {
            const { value = {}, files = [], directories = [] } = await execute();
            const directoryFiles = Object.fromEntries(directories.map(directory => [directory, listFiles(directory)]));
            publish({ ...record, status: 'completed', completed: new Date().toISOString(), value,
                outputs: hashFiles([...files, ...Object.values(directoryFiles).flat()]), directories: directoryFiles });

            return value;
        } catch (error) {
            const { message = '', stack = '', status: exitStatus = false, signal = '' } = error;
            publish({ ...record, status: 'failed', failure: {
                message: message || String(error), stack, status: exitStatus, signal
            } });
            throw error;
        }
    };

    return { run };
};
const verifyPublication = ({ directory = '', files = [] } = {}) => {
    const expected = Object.fromEntries(files.map(file => [path.join(directory, path.basename(file)), digest(file)]));

    if (JSON.stringify(listFiles(directory)) !== JSON.stringify(Object.keys(expected).toSorted())) {
        throw new Error('Fixed artifact file set changed.');
    }

    verifyHashes(expected);
};
const publishJavascript = ({ generated = '', batches = [] } = {}) => {
    const directory = path.join(generated, 'js');
    const staged = path.join(generated, 'pending-js');
    const files = batches.flatMap(({ files: batchFiles = [] } = {}) => batchFiles);

    if (existsSync(directory)) {
        verifyPublication({ directory, files });

        return { directories: [directory] };
    }

    mkdirSync(staged, { recursive: true });
    files.forEach(file => copyFileSync(file, path.join(staged, path.basename(file))));
    verifyPublication({ directory: staged, files });
    renameSync(staged, directory);

    return { directories: [directory] };
};
const runCorpusLint = async ({ generated = '', sources = [], run = undefined, lint = undefined } = {}) => {
    if (typeof run !== 'function' || !lint) throw new Error('Corpus lint requires a stage runner and reusable ESLint instances.');

    let fixed = [];

    // eslint-disable-next-line resilient/prefer-prototype-methods -- The corpus fixes one file at a time, preserving ordered durable stages.
    for (const [index = 0, name = ''] of sources.entries()) {
        const javascript = name.replace(/\.ts$/u, '.js');
        const rawFile = path.join(generated, 'raw-js', javascript);
        const published = path.join(generated, 'js', javascript);
        const result = await run({ id: `fix-${index}`, execute: async () => {
            const attempts = path.join(generated, 'fix-attempts');
            mkdirSync(attempts, { recursive: true });
            const attempt = mkdtempSync(path.join(attempts, `${index}-`));
            const code = readFileSync(rawFile, 'utf8');
            const rawHash = digest(rawFile);
            const comparison = await lint.fixed({ code, file: rawFile });
            const { output = '', changed = false, remaining = 0, lint: fixedLint = {} } = comparison;
            const file = path.join(attempt, javascript);
            writeFileSync(file, output);
            const report = path.join(attempt, 'result.json');
            writeJsonReport(report, { ...comparison, output: undefined, rawHash, fixedHash: digest(file) });
            verifyHashes({ [rawFile]: rawHash });

            return { value: { file, fix: { file: published, fixed: changed, remaining },
                lint: fixedLint }, files: [file, report] };
        } });
        fixed = [...fixed, result];
    }
    await run({ id: 'publish-fixed', execute: () => publishJavascript({ generated,
        batches: fixed.map(({ file = '' } = {}) => ({ files: [file] })) }) });
    clearContractCaches();

    const summary = await run({ id: 'lint-report', execute: async () => {
        const directory = path.join(generated, 'js');
        const files = sources.map(name => path.join(directory, name.replace(/\.ts$/u, '.js')));
        const hashes = hashFiles(files);
        let results = [];

        // eslint-disable-next-line resilient/prefer-prototype-methods -- Every file is measured under the completed fixed-module context.
        for (const file of files) {
            const row = await lint.raw({ code: readFileSync(file, 'utf8'), file });
            results = [...results, row];
            const { [file]: hash = '' } = hashes;
            verifyHashes({ [file]: hash });
        }
        verifyHashes(hashes);
        const formatFile = path.join(generated, 'artifact-format.json');
        const lintFile = path.join(generated, 'lint-fixed.json');
        writeJsonReport(formatFile, { policy: { version: 2, operation: 'per-file-native-eslint-fix',
            verification: 'per-file-read-only-lint' }, files: fixed.map(({ fix = {} } = {}) => fix) });
        writeJsonReport(lintFile, results);

        return { value: getLintSummary(results), files: [formatFile, lintFile] };
    } });
    clearContractCaches();

    return summary;
};

export { createCorpusLint, createCorpusStages, runCorpusLint, publishJavascript };
