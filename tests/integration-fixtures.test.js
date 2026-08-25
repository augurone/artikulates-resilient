import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

// eslint-disable-next-line import/no-useless-path-segments
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

    const { expectedDiagnostics = [] } = getFixtureContract({
        file: 'tests/fixtures/integration/engine-boundaries.valid.js'
    });
    assert.deepEqual(expectedDiagnostics, []);
    assert.equal(result.errorCount, 0, result.messages.map(({ message = '' } = {}) => message).join('\n'));
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
    expectedDiagnostics.forEach(({ ruleId = '', count = 0 } = {}) => {
        assert.equal(ruleIds.filter(id => id === ruleId).length, count);
    });
    assert.ok(
        ruleIds.includes('resilient/prefer-prototype-methods'),
        'The switch-local break must not exempt the surrounding loop.'
    );
};

await Promise.all([
    assertValidEngineFixture(),
    assertInvalidEngineFixture()
]);
