import assert from 'node:assert/strict';

import { ESLint } from 'eslint';

import resilient from 'eslint-plugin-resilient';
import {
    createContractDocument,
    createContractGraph
} from 'eslint-plugin-resilient/contracts';

const getProgram = async (code, fileName = 'evidence.js') => {
    let program = {};
    const capture = {
        rules: {
            program: {
                create: () => ({
                    Program: (node) => {
                        program = node;
                    }
                })
            }
        }
    };
    const eslint = new ESLint({
        overrideConfigFile: true,
        overrideConfig: [{
            plugins: { capture },
            rules: { 'capture/program': 'error' }
        }]
    });

    await eslint.lintText(code, { filePath: fileName });

    return program;
};

const reaches = ({ records = [], from = '', target = '', visited = new Set() } = {}) => {
    if (!from || visited.has(from)) return false;

    const nextVisited = new Set([...visited, from]);
    const record = records.find(({ id = '' } = {}) => id === from) || {};
    const { derivesFrom = [] } = record;

    return derivesFrom.includes(target) || derivesFrom.some(parent => reaches({
        records,
        from: parent,
        target,
        visited: nextVisited
    }));
};

const getRecordRange = ({ source = {} } = {}) => {
    const { range = [] } = source;

    return range;
};

const code = 'const getItems = ({ items = [] } = {}) => items.map(item => item); getItems({});';
const program = await getProgram(code);
const document = createContractDocument(program, { fileName: 'evidence.js' });
const records = document.getEvidence();
const operation = records.find((record = {}) => {
    const { kind = '' } = record;

    return kind === 'propagation' &&
        JSON.stringify(getRecordRange(record)) === JSON.stringify([
            code.indexOf('items.map'),
            code.indexOf('items.map') + 'items.map(item => item)'.length
        ]);
});
const defaultEvidence = records.find((record = {}) => {
    const { fact = {} } = record;
    const { contract = {} } = fact;
    const { kind = '' } = contract;

    return kind === 'array' &&
        JSON.stringify(getRecordRange(record)) === JSON.stringify([
            code.indexOf('items ='),
            code.indexOf('items =') + 'items = []'.length
        ]);
});
const returnEvidence = records.find(({ fact = {} } = {}) => (
    fact.subject.startsWith('return:getItems@')
));

assert.ok(operation);
assert.ok(defaultEvidence);
assert.ok(returnEvidence);
assert.equal(reaches({ records, from: operation.id, target: defaultEvidence.id }), true);
assert.equal(reaches({ records, from: returnEvidence.id, target: operation.id }), true);
assert.equal(records.every(record => !Object.prototype.hasOwnProperty.call(record, 'sourceNode')), true);
assert.equal(records.every(record => !Object.prototype.hasOwnProperty.call(record, 'anchorKey')), true);

const repeatedDocument = createContractDocument(program, { fileName: 'evidence.js' });
assert.deepEqual(repeatedDocument.getEvidence(), records);

const boundaryCode = 'const result = client.fetch(); result.toUpperCase();';
const boundaryProgram = await getProgram(boundaryCode, 'sdk-boundary.js');
const boundaryDocument = createContractDocument(boundaryProgram, { fileName: 'sdk-boundary.js' });
const boundary = boundaryDocument.getEvidence().find(({ kind = '', origin = '' } = {}) => (
    kind === 'boundary' && origin === 'external-data'
));

assert.ok(boundary);
assert.equal(boundary.status, 'unknown');
assert.equal(boundary.boundaryOwner, 'external-data');
assert.deepEqual(boundary.fact.contract, {
    kind: 'unknown',
    state: 'unknown',
    optional: false
});

const guardCode = 'const read = value => { if (Array.isArray(value)) return value; return []; };';
const guardProgram = await getProgram(guardCode, 'guard.js');
const guardDocument = createContractDocument(guardProgram, { fileName: 'guard.js' });
const guard = guardDocument.getEvidence().find(({ kind = '' } = {}) => kind === 'guard');

assert.ok(guard);
assert.equal(guard.fact.contract.kind, 'array');
assert.equal(guard.fact.contract.state, 'known');

const diagnosticCode = 'const inspect = ({ items = [] } = {}) => items.toUpperCase();';
const diagnosticProgram = await getProgram(diagnosticCode, 'diagnostic.js');
const diagnosticDocument = createContractDocument(diagnosticProgram, { fileName: 'diagnostic.js' });
const [diagnostic = {}] = diagnosticDocument.getDiagnostics();

assert.ok(diagnostic);
assert.ok(diagnostic.evidenceIds.length);

const providerProgram = await getProgram('export const getItems = ({ items = [] } = {}) => items;', 'provider.js');
const consumerProgram = await getProgram('import { getItems } from "./provider.js"; getItems({}).toUpperCase();', 'consumer.js');
const graph = createContractGraph({
    programs: {
        'provider.js': providerProgram,
        'consumer.js': consumerProgram
    }
});
const graphEvidence = graph.getEvidence();

assert.equal(graphEvidence.some(({ id = '' } = {}) => id.startsWith('consumer.js:')), true);
assert.equal(graphEvidence.every(({ id = '' } = {}) => !id.startsWith('evidence-')), true);

const automaticEslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [resilient.configs.contracts]
});
const [automaticResult = {}] = await automaticEslint.lintText(
    'const inspect = ({ items = [] } = {}) => items.toUpperCase();',
    { filePath: 'automatic-message.js' }
);
const { messages: automaticMessages = [] } = automaticResult;
const [automaticMessage = {}] = automaticMessages;

const { message: automaticText = '' } = automaticMessage;

assert.match(automaticText, /static evidence: default at line 1/);

const standaloneDefaultEslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{
        plugins: { resilient },
        rules: {
            'resilient/signature-contract-operation': 'error'
        }
    }]
});
const [standaloneDefaultResult = {}] = await standaloneDefaultEslint.lintText(
    diagnosticCode,
    { filePath: 'standalone-default-message.js' }
);
const { messages: standaloneDefaultMessages = [] } = standaloneDefaultResult;
const [standaloneDefaultMessage = {}] = standaloneDefaultMessages;

assert.match(standaloneDefaultMessage.message || '', /static evidence: default at line 1/);

const optOutEslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
        resilient.configs.contracts,
        {
            settings: {
                resilient: {
                    evidenceMessages: false
                }
            }
        }
    ]
});
const [optOutResult = {}] = await optOutEslint.lintText(
    'const inspect = ({ items = [] } = {}) => items.toUpperCase();',
    { filePath: 'opt-out-message.js' }
);
const { messages: optOutMessages = [] } = optOutResult;
const [optOutMessage = {}] = optOutMessages;

const { message: optOutText = '' } = optOutMessage;

assert.equal(optOutText, 'items is array-like, but .toUpperCase() requires a string-like.');
