import { existsSync, renameSync, writeFileSync } from 'node:fs';

import { hashFiles, listFiles, readJson, verifyHashes } from './proof-files.js';
import { isFunction } from '../rules/support/function.js';

const missingStage = () => { throw new Error('A proof stage requires an executable operation.'); };

const writeStageJournal = (file = '', value = {}) => {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    const pending = `${file}.pending`;
    writeFileSync(pending, text);
    renameSync(pending, file);
};
const verifyStageOutputs = ({ outputs = {}, directories = {} } = {}) => {
    verifyHashes(outputs);
    Object.entries(directories).forEach(([directory = '', files = []]) => {
        if (JSON.stringify(listFiles(directory)) !== JSON.stringify(files)) throw new Error(`Proof file set changed: ${directory}`);
    });
};
const verifyStageJournal = ({ version = 0, inputs = {}, stages = [] } = {}) => {
    if (version !== 1) throw new Error('Unsupported proof journal version.');

    verifyHashes(inputs);
    stages.filter(({ status = '' } = {}) => status === 'completed').forEach(verifyStageOutputs);
};
const getFailure = (error) => {
    const { message = '', stack = '', status = false, signal = '' } = error instanceof Error ? error : {};

    return { message: message || String(error), stack, status, signal };
};
const createStageRunner = ({ file = '', identity = {}, inputs = {} } = {}) => {
    let journal = existsSync(file) ? readJson(file) : { version: 1, identity, inputs, stages: [] };
    const { version = 0, identity: savedIdentity = {}, inputs: savedInputs = {} } = journal;

    if (version !== 1 || JSON.stringify(savedIdentity) !== JSON.stringify(identity) || JSON.stringify(savedInputs) !== JSON.stringify(inputs)) {
        throw new Error('Proof inputs or runtime changed; use a new artifact instead of reusing completed stages.');
    }

    verifyStageJournal(journal);
    writeStageJournal(file, journal);
    const publish = (record = {}) => {
        const { id = '' } = record;
        const { stages = [] } = journal;
        journal = { ...journal, stages: [...stages.filter(({ id: prior = '' } = {}) => prior !== id), record] };
        writeStageJournal(file, journal);
    };
    const run = ({ id = '', execute = missingStage, retry = true } = {}) => {
        if (!id || !isFunction(execute)) throw new Error('A proof stage requires an id and executable operation.');

        const { stages = [] } = journal;
        const previous = stages.find(({ id: prior = '' } = {}) => prior === id) || {};
        const { status = '', value = {}, attempts = 0, history = [], ...previousRecord } = previous;

        if (status === 'completed') {
            verifyStageOutputs(previous);

            return value;
        }

        if (status && !retry) throw new Error(`Incomplete ${id}; preserve this partial artifact and start a new proof. Generation is never silently replayed.`);

        const started = new Date().toISOString();
        const record = { id, status: 'running', attempts: attempts + 1, started,
            history: status ? [...history, { ...previousRecord, status, attempts }] : history };
        publish(record);
        process.stdout.write(`Proof stage ${id}: ${status ? 'retry' : 'start'}\n`);
        try {
            const { value: result = {}, files = [], directories = [] } = execute();
            const directoryFiles = Object.fromEntries(directories.map(directory => [directory, listFiles(directory)]));
            publish({ ...record, status: 'completed', completed: new Date().toISOString(), value: result,
                outputs: hashFiles([...files, ...Object.values(directoryFiles).flat()]), directories: directoryFiles });

            return result;
        } catch (error) {
            publish({ ...record, status: 'failed', failure: getFailure(error) });
            throw error;
        }
    };

    return { run };
};

export { createStageRunner, verifyStageJournal, writeStageJournal, missingStage };
