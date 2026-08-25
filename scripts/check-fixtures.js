import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// eslint-disable-next-line import/no-useless-path-segments
import resilient from '../index.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(rootDirectory, 'tests', 'fixtures', 'manifest.json');

const read = filePath => fs.readFileSync(filePath, 'utf8');
const fail = (message) => {
    throw new Error(message);
};

const getManifest = () => JSON.parse(read(manifestPath));

const assertRuleHighlights = ({ manifest = {}, badFixture = '' } = {}) => {
    const ruleNames = Object.keys(resilient.rules);
    const highlights = manifest.ruleHighlights || [];
    const highlightedRules = highlights.map(({ rule = '' } = {}) => rule);
    const missingRules = ruleNames.filter(ruleName => !highlightedRules.includes(ruleName));
    const extraRules = highlightedRules.filter(ruleName => !ruleNames.includes(ruleName));
    const missingHeadings = highlights
        .filter(({ heading = '' } = {}) => !badFixture.includes(`// ${heading}\n`))
        .map(({ heading = '' } = {}) => heading);

    if (missingRules.length) fail(`Fixture manifest is missing rules: ${missingRules.join(', ')}`);
    if (extraRules.length) fail(`Fixture manifest has unknown rules: ${extraRules.join(', ')}`);
    if (highlightedRules.length !== new Set(highlightedRules).size) {
        fail('Fixture manifest contains duplicate rule highlights.');
    }
    if (missingHeadings.length) {
        fail(`Agent fixture is missing headings: ${missingHeadings.join(', ')}`);
    }
};

const assertIntegrationFixtures = ({ manifest = {} } = {}) => {
    const fixtures = manifest.integrationFixtures || [];
    const ruleNames = new Set(Object.keys(resilient.rules).map(ruleName => `resilient/${ruleName}`));
    const missingFiles = fixtures
        .filter(({ file = '' } = {}) => !fs.existsSync(path.join(rootDirectory, file)))
        .map(({ file = '' } = {}) => file);
    const invalidKinds = fixtures
        .filter(({ kind = '' } = {}) => !['valid', 'invalid'].includes(kind))
        .map(({ file = '' } = {}) => file);
    const unknownExpectedRules = fixtures
        .flatMap(({ expectedDiagnostics = [] } = {}) => expectedDiagnostics)
        .map(({ ruleId = '' } = {}) => ruleId)
        .filter(ruleId => !ruleNames.has(ruleId));

    if (!fixtures.length) fail('Fixture manifest must define integration fixtures.');
    if (missingFiles.length) fail(`Integration fixture files are missing: ${missingFiles.join(', ')}`);
    if (invalidKinds.length) fail(`Integration fixture kinds are invalid: ${invalidKinds.join(', ')}`);
    if (unknownExpectedRules.length) {
        fail(`Integration fixtures name unknown rules: ${unknownExpectedRules.join(', ')}`);
    }
};

const main = () => {
    const manifest = getManifest();
    if (manifest.version !== 1) fail('Unsupported fixture manifest version.');

    const agentFixture = manifest.agentFixture || '';
    const agentFixturePath = path.join(rootDirectory, agentFixture);
    if (!agentFixture || !fs.existsSync(agentFixturePath)) {
        fail(`Agent fixture is missing: ${agentFixture}`);
    }

    assertRuleHighlights({ manifest, badFixture: read(agentFixturePath) });
    assertIntegrationFixtures({ manifest });
    process.stdout.write(`Fixture contract valid: ${Object.keys(resilient.rules).length} rule highlights, ${manifest.integrationFixtures.length} integration fixtures.\n`);
};

try {
    main();
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
}
