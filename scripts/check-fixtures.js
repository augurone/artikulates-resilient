import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

// eslint-disable-next-line import/no-useless-path-segments -- The fixture checker intentionally imports the repository entry point.
import resilient from '../index.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(rootDirectory, 'tests', 'fixtures', 'manifest.json');
const { rules = {} } = resilient;

const read = filePath => fs.readFileSync(filePath, 'utf8');
const fail = (message) => {
    throw new Error(message);
};

const getManifest = () => JSON.parse(read(manifestPath));

const getLine = ({ source = '', offset = 0 } = {}) => source
    .slice(0, offset)
    .split('\n')
    .length;

const getSectionHeadings = (source = '') => [...source.matchAll(/^\/\/ ([a-z][a-z0-9-]*)$/gm)]
    .map(({ 1: heading = '', index: offset = 0 } = {}) => ({
        heading,
        offset,
        startLine: getLine({ source, offset })
    }));

const assertRuleHighlights = ({ manifest = {}, badFixture = '' } = {}) => {
    const ruleNames = Object.keys(rules);
    const { ruleHighlights: highlights = [] } = manifest;
    const sections = getSectionHeadings(badFixture);
    const highlightedRules = highlights.map(({ rule = '' } = {}) => rule);
    const missingRules = ruleNames.filter(ruleName => !highlightedRules.includes(ruleName));
    const extraRules = highlightedRules.filter(ruleName => !ruleNames.includes(ruleName));
    const missingHeadings = highlights
        .filter(({ heading = '' } = {}) => !sections
            .some(({ heading: sectionHeading = '' } = {}) => sectionHeading === heading))
        .map(({ heading = '' } = {}) => heading);
    const repeatedHeadings = highlights
        .filter(({ heading = '' } = {}) => sections
            .filter(({ heading: sectionHeading = '' } = {}) => sectionHeading === heading).length !== 1)
        .map(({ heading = '' } = {}) => heading);

    if (missingRules.length) fail(`Fixture manifest is missing rules: ${missingRules.join(', ')}`);

    if (extraRules.length) fail(`Fixture manifest has unknown rules: ${extraRules.join(', ')}`);

    if (highlightedRules.length !== new Set(highlightedRules).size) {
        fail('Fixture manifest contains duplicate rule highlights.');
    }

    if (missingHeadings.length) {
        fail(`Agent fixture is missing headings: ${missingHeadings.join(', ')}`);
    }

    if (repeatedHeadings.length) {
        fail(`Agent fixture must contain one section for each heading: ${repeatedHeadings.join(', ')}`);
    }
};

const getRuleRegions = ({ manifest = {}, badFixture = '' } = {}) => {
    const sections = getSectionHeadings(badFixture);

    return manifest.ruleHighlights
        .map(({ rule = '', heading = '' } = {}) => {
            const marker = `// ${heading}\n`;
            const offset = badFixture.indexOf(marker);
            const matchingSection = sections
                .find(({ heading: sectionHeading = '' } = {}) => sectionHeading === heading);
            const { offset: sectionOffset = 0, startLine = 0 } = matchingSection ?? {};

            return {
                rule,
                startLine: startLine + 1,
                offset: sectionOffset || offset
            };
        })
        .sort(({ offset: left = 0 } = {}, { offset: right = 0 } = {}) => left - right)
        .map((region = {}) => {
            const { offset: regionOffset = 0 } = region;
            const nextSection = sections
                .find(({ offset: sectionOffset = 0 } = {}) => sectionOffset > regionOffset);
            const { startLine: nextStartLine = 0 } = nextSection ?? {};

            return {
                ...region,
                endLine: nextSection ? nextStartLine - 2 : Number.MAX_SAFE_INTEGER
            };
        });
};

const assertAgentFixtureBehavior = async ({ manifest = {}, badFixture = '' } = {}) => {
    const eslint = new ESLint({
        overrideConfigFile: true,
        overrideConfig: [{
            languageOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module'
            },
            plugins: { resilient },
            rules: Object.fromEntries(Object.keys(resilient.rules)
                .map(rule => [`resilient/${rule}`, 'error']))
        }]
    });
    const [result = {}] = await eslint.lintText(badFixture, {
        filePath: 'tests/fixtures/bad.js'
    });
    const regions = getRuleRegions({ manifest, badFixture });
    const missingDiagnostics = regions
        .filter(({ rule = '', startLine = 0, endLine = 0 } = {}) => !result.messages
            .some(({ ruleId = '', line = 0 } = {}) => (
                ruleId === `resilient/${rule}` &&
                line >= startLine &&
                line <= endLine
            )))
        .map(({ rule = '' } = {}) => rule);

    if (result.messages.some(({ fatal = false } = {}) => fatal)) {
        fail('Agent fixture could not be parsed for behavioral verification.');
    }

    if (missingDiagnostics.length) {
        fail(`Agent fixture is missing behavioral diagnostics: ${missingDiagnostics.join(', ')}`);
    }
};

const assertIntegrationFixtures = ({ manifest = {} } = {}) => {
    const { integrationFixtures: fixtures = [] } = manifest;
    const ruleNames = new Set(Object.keys(rules).map(ruleName => `resilient/${ruleName}`));
    const fixtureFiles = fixtures.flatMap(({ file = '', files = [] } = {}) => [file, ...files]);
    const missingFiles = fixtureFiles.filter(file => !fs.existsSync(path.join(rootDirectory, file)));
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

const main = async () => {
    const manifest = getManifest();
    const { version = 0, agentFixture = '', integrationFixtures = [] } = manifest;

    if (version !== 1) fail('Unsupported fixture manifest version.');

    const agentFixturePath = path.join(rootDirectory, agentFixture);

    if (!agentFixture || !fs.existsSync(agentFixturePath)) {
        fail(`Agent fixture is missing: ${agentFixture}`);
    }

    assertRuleHighlights({ manifest, badFixture: read(agentFixturePath) });
    await assertAgentFixtureBehavior({ manifest, badFixture: read(agentFixturePath) });
    assertIntegrationFixtures({ manifest });
    process.stdout.write(`Fixture contract valid: ${Object.keys(rules).length} rule highlights, ${integrationFixtures.length} integration fixtures.\n`);
};

try {
    await main();
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
}
