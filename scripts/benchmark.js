import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import resilient from 'eslint-plugin-resilient';
import { createContractGraph, createProjectTree } from 'eslint-plugin-resilient/contracts';

/* eslint-disable resilient/prefer-signature-destructuring -- Dirent receiver context must remain intact. */

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = path.join(scriptDirectory, '..', 'tests', 'fixtures', 'benchmark');
const { version: packageVersion = '' } = JSON.parse(fs.readFileSync(
    path.join(scriptDirectory, '..', 'package.json'),
    'utf8'
));

const getFixtureFiles = (directory = '') => fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry = {}) => {
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
    if ((result.errorCount || 0) > 0) return {};
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
    const changedSourceStates = {
        ...sourceStates,
        [changedProviderFile]: `${sourceStates[changedProviderFile]}:changed`
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
    const graphOnlyFirstSample = await measure(async () => createEvaluatedGraph({
        programs: coldSnapshot.activeTree.programs
    }));
    const graphOnlySecondSample = await measure(async () => createEvaluatedGraph({
        programs: coldSnapshot.activeTree.programs
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
    const directDiagnosticKeys = directDiagnostics.map(({ fileName = '', ruleId = '', loc = {} } = {}) => (
        `${fileName}:resilient/${ruleId}:${loc.start && loc.start.line}:${loc.start && loc.start.column}`
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
    return {
        benchmark: `resilient-${packageVersion}`,
        node: process.version,
        fixtureFiles: fixtureFiles.length,
        sharedActiveTree: {
            filesIndexed: coldSnapshot.activeTree.stats.indexed,
            filesActivated: coldSnapshot.activeTree.stats.activated,
            filesParsed: fixtureFiles.length,
            filesReanalyzed: invalidation.activeInvalidatedFiles.length,
            cacheHits: stats.hits,
            cacheMisses: stats.misses,
            diagnosticCount: directDiagnostics.length,
            coldMilliseconds: round(coldAnalysis.milliseconds),
            warmMilliseconds: round(warmAnalysis.milliseconds),
            graphOnlyFirstSampleMilliseconds: round(graphOnlyFirstSample.milliseconds),
            graphOnlySecondSampleMilliseconds: round(graphOnlySecondSample.milliseconds)
        },
        eslintAgreement: {
            directDiagnosticCount: directDiagnostics.length,
            eslintDiagnosticCount: eslintDiagnostics.length,
            diagnosticsMatch: JSON.stringify(directDiagnosticKeys) === JSON.stringify(eslintDiagnosticKeys),
            directDiagnosticKeys,
            eslintDiagnosticKeys
        },
        projectTree: {
            discoveryMilliseconds: round(projectTreeMeasurement.milliseconds),
            activationMilliseconds: round(activationMeasurement.milliseconds),
            snapshotMilliseconds: round(projectSnapshotMeasurement.milliseconds),
            incrementalAnalysisMilliseconds: round(changedAnalysis.milliseconds),
            incrementalInvalidationMilliseconds: round(incremental.milliseconds),
            filesIndexed: tree.getProjectSnapshot().files.length,
            filesActivated: coldSnapshot.activeTree.stats.activated,
            filesParsed: fixtureFiles.length,
            filesReanalyzed: invalidation.activeInvalidatedFiles.length,
            filesReused: (changedSnapshot.reuse && changedSnapshot.reuse.reusedFiles || []).length,
            reusedFiles: changedSnapshot.reuse && changedSnapshot.reuse.reusedFiles || [],
            invalidatedFiles: invalidation.invalidatedFiles,
            activeTree: coldAnalysis.value.activeTree.activeFiles,
            cacheHits: stats.hits,
            cacheMisses: stats.misses,
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
