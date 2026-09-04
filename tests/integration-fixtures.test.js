import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { createContractGraph } from 'eslint-plugin-resilient/contracts';

// eslint-disable-next-line import/no-useless-path-segments -- Integration tests intentionally import the repository entry point.
import resilient from '../index.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(rootDirectory, file), 'utf8');
const manifest = JSON.parse(read('tests/fixtures/manifest.json'));

const lintFixture = async ({ file = '', config = resilient.configs.safety } = {}) => {
    const eslint = new ESLint({
        overrideConfigFile: true,
        overrideConfig: Array.isArray(config) ? config : [config]
    });
    const [result = {}] = await eslint.lintText(read(file), { filePath: file });

    return result;
};

const getRuleIds = ({ messages = [] } = {}) => messages.map(({ ruleId = '' } = {}) => ruleId);

const getFixtureContract = ({ file = '' } = {}) => manifest.integrationFixtures
    .find(({ file: fixtureFile = '' } = {}) => fixtureFile === file) || {};

const getProgram = async ({ code = '', file = '' } = {}) => {
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
            languageOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module'
            },
            plugins: { capture },
            rules: { 'capture/program': 'error' }
        }]
    });

    await eslint.lintText(code, { filePath: file });

    return program;
};

const getFixturePrograms = async ({ file = '', files = [] } = {}) => {
    const fixtureFiles = [file, ...files];

    return Object.fromEntries(await Promise.all(fixtureFiles.map(async fixtureFile => [
        fixtureFile,
        await getProgram({ file: fixtureFile, code: read(fixtureFile) })
    ])));
};

const assertExpectedDiagnosticCounts = ({ ruleIds = [], expectedDiagnostics = [] } = {}) => {
    expectedDiagnostics.forEach(({ ruleId = '', count = 0 } = {}) => {
        assert.equal(ruleIds.filter(id => id === ruleId).length, count);
    });
};

const assertAgreementExpectations = ({ agreements = [], agreementExpectations = [] } = {}) => {
    assert.equal(agreements.length, agreementExpectations.length);
    agreementExpectations.forEach(({ localName = '', importedName = '', kind = '' } = {}) => {
        assert.ok(agreements.some(({
            localName: candidateLocalName = '',
            importedName: candidateName = '',
            kind: candidateKind = ''
        } = {}) => (
            candidateLocalName === localName &&
            candidateName === importedName &&
            candidateKind === kind
        )));
    });
};

const assertValidEngineFixture = async () => {
    const ignoredBindings = [
        'CMS_MEMORY_CACHE_STORE',
        'CMS_MEMORY_INFLIGHT_STORE',
        'response',
        'fields',
        'nodes',
        'queue',
        'queued',
        'graphMappers',
        'query',
        'visibleCountRef'
    ];
    const result = await lintFixture({
        file: 'tests/fixtures/integration/engine-boundaries.valid.js',
        config: [
            resilient.configs.safety,
            {
                rules: {
                    'resilient/prefer-safe-transformations': ['error', {
                        ignoredBindings,
                        ignoredProperties: ['current']
                    }]
                }
            }
        ]
    });
    const { errorCount = 0, messages = [] } = result;

    const { expectedDiagnostics = [] } = getFixtureContract({
        file: 'tests/fixtures/integration/engine-boundaries.valid.js'
    });
    assert.deepEqual(expectedDiagnostics, []);
    assert.equal(errorCount, 0, messages.map(({ message = '' } = {}) => message).join('\n'));
};

const assertInvalidEngineFixture = async () => {
    const result = await lintFixture({
        file: 'tests/fixtures/integration/engine-boundaries.invalid.js',
        config: [
            resilient.configs.safety,
            {
                rules: {
                    'resilient/prefer-prototype-methods': 'error'
                }
            }
        ]
    });
    const ruleIds = getRuleIds(result);

    const { expectedDiagnostics = [] } = getFixtureContract({
        file: 'tests/fixtures/integration/engine-boundaries.invalid.js'
    });
    assertExpectedDiagnosticCounts({ ruleIds, expectedDiagnostics });
    assert.ok(
        ruleIds.includes('resilient/prefer-prototype-methods'),
        'The switch-local break must not exempt the surrounding loop.'
    );
};

const assertContractTreeFixture = async () => {
    const file = 'tests/fixtures/integration/page-renderer.js';
    const { files = [], expectedDiagnostics = [], agreementExpectations = [] } = getFixtureContract({ file });
    const programs = await getFixturePrograms({ file, files });
    const graph = createContractGraph({ programs });
    const agreements = graph.getAgreements();
    assertAgreementExpectations({ agreements, agreementExpectations });
    const graphRuleIds = getRuleIds({ messages: graph.getDiagnostics() })
        .map(ruleId => `resilient/${ruleId}`);
    assertExpectedDiagnosticCounts({ ruleIds: graphRuleIds, expectedDiagnostics });

    const result = await lintFixture({
        file,
        config: resilient.configs.contracts
    });
    const { errorCount = 0, messages = [] } = result;
    assert.equal(errorCount, 2);
    assert.ok(messages.some(({ message = '' } = {}) => message.startsWith('getPageView().assets is array-like')));
    assert.ok(messages.some(({ message = '' } = {}) => message.startsWith('pageApi.getPageView().assets is array-like')));
};

const assertContractBoundaryFixture = async () => {
    const file = 'tests/fixtures/integration/contract-boundaries.invalid.js';
    const { files = [], expectedDiagnostics = [] } = getFixtureContract({ file });
    const graph = createContractGraph({
        programs: await getFixturePrograms({ file, files })
    });
    const graphRuleIds = getRuleIds({ messages: graph.getDiagnostics() })
        .map(ruleId => `resilient/${ruleId}`);
    assertExpectedDiagnosticCounts({ ruleIds: graphRuleIds, expectedDiagnostics });

    const result = await lintFixture({
        file,
        config: resilient.configs.contracts
    });
    assertExpectedDiagnosticCounts({
        ruleIds: getRuleIds(result),
        expectedDiagnostics
    });
};

const assertGraphAgreementFixture = async () => {
    const file = 'tests/fixtures/integration/graph-agreement.invalid.js';
    const { files = [], agreementExpectations = [] } = getFixtureContract({ file });
    const graph = createContractGraph({
        programs: await getFixturePrograms({ file, files })
    });
    assertAgreementExpectations({
        agreements: graph.getAgreements(),
        agreementExpectations
    });
    assert.deepEqual(graph.getDiagnostics(), []);
};

await Promise.all([
    assertValidEngineFixture(),
    assertInvalidEngineFixture(),
    assertContractTreeFixture(),
    assertContractBoundaryFixture(),
    assertGraphAgreementFixture()
]);
