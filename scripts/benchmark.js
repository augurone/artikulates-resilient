import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

import resilient from 'eslint-plugin-resilient';
import { createContractGraph, createProjectTree } from 'eslint-plugin-resilient/contracts';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = path.join(scriptDirectory, '..', 'tests', 'fixtures', 'benchmark');
const { version: packageVersion = '' } = JSON.parse(fs.readFileSync(
    path.join(scriptDirectory, '..', 'package.json'),
    'utf8'
));

const getFixtureFiles = (directory = '') => fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry = {}) => {
        // eslint-disable-next-line resilient/prefer-signature-destructuring -- Node's Dirent must remain intact so its predicate keeps the native receiver.
        const { name = '' } = entry;
        const entryPath = path.join(directory, name);

        // Dirent predicates require their receiver, so this is a narrow API boundary.
        return entry.isDirectory() ? getFixtureFiles(entryPath) : [entryPath];
    })
    .filter(fileName => fileName.endsWith('.js'))
    .sort();

const getProgram = async ({ fileName = '', code = '' } = {}) => {
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
    const [result = {}] = await new ESLint({
        overrideConfigFile: true,
        overrideConfig: [{
            languageOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module'
            },
            plugins: { capture },
            rules: { 'capture/program': 'error' }
        }]
    }).lintText(code || fs.readFileSync(fileName, 'utf8'), { filePath: fileName });
    const { errorCount = 0 } = result;

    if (errorCount > 0) return {};

    return program;
};

const round = (value = 0) => Number(value.toFixed(3));

const measure = async (operation = async () => {}) => {
    const start = performance.now();
    const value = await operation();

    return { value, milliseconds: performance.now() - start };
};

const createEvaluatedGraph = ({ programs = {} } = {}) => {
    const graph = createContractGraph({ programs });
    graph.getAgreements();
    graph.getDiagnostics();

    return graph;
};

const run = async () => {
    const fixtureFiles = getFixtureFiles(fixtureDirectory);
    const parsed = await Promise.all(fixtureFiles.map(async fileName => [
        fileName,
        await getProgram({ fileName })
    ]));
    const programs = Object.fromEntries(parsed);
    const sourceStates = Object.fromEntries(fixtureFiles.map((fileName = '') => {
        const { mtimeMs = 0, size = 0 } = fs.statSync(fileName);

        return [fileName, `${mtimeMs}:${size}`];
    }));
    const roots = [
        path.join(fixtureDirectory, 'active-root.js'),
        path.join(fixtureDirectory, 'consumer-b.js'),
        path.join(fixtureDirectory, 'consumer-valid.js'),
        path.join(fixtureDirectory, 'stable.js')
    ];
    const projectTreeMeasurement = await measure(async () => createProjectTree({
        programs,
        roots,
        sourceStates
    }));
    const { value: tree = {} } = projectTreeMeasurement;
    const activationMeasurement = await measure(async () => tree.activate({ roots }));
    const projectSnapshotMeasurement = await measure(async () => tree.getProjectSnapshot());
    const coldAnalysis = await measure(async () => tree.analyze());
    const warmAnalysis = await measure(async () => tree.analyze());
    const { value: coldSnapshot = {} } = coldAnalysis;
    const changedProviderFile = path.join(fixtureDirectory, 'providers', 'items.js');
    const changedPrograms = {
        ...programs,
        [changedProviderFile]: await getProgram({
            fileName: changedProviderFile,
            code: 'export const getItems = ({ items = [], label = 0 } = {}) => ({ items, label });'
        })
    };
    const { [changedProviderFile]: changedProviderState = '' } = sourceStates;
    const changedSourceStates = {
        ...sourceStates,
        [changedProviderFile]: `${changedProviderState}:changed`
    };
    const changedTree = createProjectTree({
        programs: changedPrograms,
        roots,
        sourceStates: changedSourceStates
    });
    const changedAnalysis = await measure(async () => changedTree.analyze({
        previousSnapshot: coldSnapshot
    }));
    const { value: changedSnapshot = {} } = changedAnalysis;
    const { activeTree = {} } = coldSnapshot;
    const {
        activeFiles = [],
        programs: activePrograms = {},
        stats: {
            indexed: activeFilesIndexed = 0,
            activated: activeFilesActivated = 0
        } = {}
    } = activeTree;
    const graphOnlyFirstSample = await measure(async () => createEvaluatedGraph({
        programs: activePrograms
    }));
    const graphOnlySecondSample = await measure(async () => createEvaluatedGraph({
        programs: activePrograms
    }));
    const invalidation = tree.getInvalidatedFiles({
        changedFiles: [path.join(fixtureDirectory, 'providers', 'items.js')],
        roots
    });
    const stats = tree.getStats();
    const lintRunner = new ESLint({
        overrideConfigFile: true,
        overrideConfig: [resilient.configs.contracts]
    });
    const lintResults = await lintRunner.lintFiles(roots);
    const eslintDiagnostics = lintResults.flatMap(({ messages = [] } = {}) => messages);
    const { diagnostics: directDiagnostics = [] } = coldSnapshot;
    const directDiagnosticKeys = directDiagnostics.map(({
        fileName = '',
        ruleId = '',
        loc: { start: { line = 0, column = 0 } = {} } = {}
    } = {}) => (
        `${fileName}:resilient/${ruleId}:${line}:${column}`
    ));
    const eslintDiagnosticKeys = lintResults.flatMap(({ filePath = '', messages = [] } = {}) => messages.map(({
        ruleId = '',
        line = 0,
        column = 0
    } = {}) => `${filePath}:${ruleId}:${line}:${column - 1}`));
    const incremental = await measure(async () => tree.getInvalidatedFiles({
        changedFiles: [path.join(fixtureDirectory, 'providers', 'items.js')],
        roots
    }));
    const {
        reuse: {
            reusedFiles = []
        } = {}
    } = changedSnapshot;
    const {
        activeInvalidatedFiles = [],
        invalidatedFiles = []
    } = invalidation;
    const { hits: cacheHits = 0, misses: cacheMisses = 0 } = stats;
    const { milliseconds: projectTreeMilliseconds = 0 } = projectTreeMeasurement;
    const { milliseconds: activationMilliseconds = 0 } = activationMeasurement;
    const { milliseconds: snapshotMilliseconds = 0 } = projectSnapshotMeasurement;
    const { milliseconds: coldMilliseconds = 0 } = coldAnalysis;
    const { milliseconds: warmMilliseconds = 0 } = warmAnalysis;
    const { milliseconds: graphFirstMilliseconds = 0 } = graphOnlyFirstSample;
    const { milliseconds: graphSecondMilliseconds = 0 } = graphOnlySecondSample;
    const { milliseconds: changedMilliseconds = 0 } = changedAnalysis;
    const { milliseconds: incrementalMilliseconds = 0 } = incremental;
    const { getProjectSnapshot = false } = tree;
    const { files: projectFiles = [] } = getProjectSnapshot.call(tree);

    return {
        benchmark: `resilient-${packageVersion}`,
        node: process.version,
        fixtureFiles: fixtureFiles.length,
        sharedActiveTree: {
            filesIndexed: activeFilesIndexed,
            filesActivated: activeFilesActivated,
            filesParsed: fixtureFiles.length,
            filesReanalyzed: activeInvalidatedFiles.length,
            cacheHits,
            cacheMisses,
            diagnosticCount: directDiagnostics.length,
            coldMilliseconds: round(coldMilliseconds),
            warmMilliseconds: round(warmMilliseconds),
            graphOnlyFirstSampleMilliseconds: round(graphFirstMilliseconds),
            graphOnlySecondSampleMilliseconds: round(graphSecondMilliseconds)
        },
        eslintAgreement: {
            directDiagnosticCount: directDiagnostics.length,
            eslintDiagnosticCount: eslintDiagnostics.length,
            diagnosticsMatch: JSON.stringify(directDiagnosticKeys) === JSON.stringify(eslintDiagnosticKeys),
            directDiagnosticKeys,
            eslintDiagnosticKeys
        },
        projectTree: {
            discoveryMilliseconds: round(projectTreeMilliseconds),
            activationMilliseconds: round(activationMilliseconds),
            snapshotMilliseconds: round(snapshotMilliseconds),
            incrementalAnalysisMilliseconds: round(changedMilliseconds),
            incrementalInvalidationMilliseconds: round(incrementalMilliseconds),
            filesIndexed: projectFiles.length,
            filesActivated: activeFilesActivated,
            filesParsed: fixtureFiles.length,
            filesReanalyzed: activeInvalidatedFiles.length,
            filesReused: reusedFiles.length,
            reusedFiles,
            invalidatedFiles,
            activeTree: activeFiles,
            cacheHits,
            cacheMisses,
            diagnosticCount: directDiagnostics.length
        }
    };
};

try {
    const result = await run();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
    const errorObject = error instanceof Error ? error : {};
    const { message = '', stack = '' } = errorObject;
    process.stderr.write(`${stack || message || error}\n`);
    process.exit(1);
}
