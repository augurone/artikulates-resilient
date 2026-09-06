import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ESLint } from 'eslint';

import {
    createProjectGraphManager,
    normalizePath
} from 'eslint-plugin-resilient/contracts';

import {
    clearContractCaches,
    loadPrograms
} from '../rules/contracts/eslint-graph.js';
import { getProgramCacheSize } from '../rules/contracts/program-cache.js';

const getProgram = async (code = '', file = '') => {
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

const directory = await mkdtemp(path.join(process.cwd(), '.resilient-graph-'));
const providerFile = path.join(directory, 'provider.js');
const consumerFile = path.join(directory, 'consumer.js');
const lateConsumerFile = path.join(directory, 'late-consumer.js');
const lateProviderFile = path.join(directory, 'late-provider.js');
const coveredRootFile = path.join(directory, 'covered-root.js');
const coveredSharedFile = path.join(directory, 'covered-shared.js');
const coveredAdditionalRootFile = path.join(directory, 'covered-additional-root.js');
const context = {
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
};
const consumerCode = 'import { getPageView } from "./provider.js"; getPageView({ title: 42 });';
const manager = createProjectGraphManager();

try {
    await writeFile(providerFile, 'export const getPageView = ({ title = "" } = {}) => title;');
    await writeFile(
        coveredRootFile,
        'import { shared } from "./covered-shared.js"; shared;'
    );
    await writeFile(coveredSharedFile, 'export const shared = 1;');
    await writeFile(coveredAdditionalRootFile, 'export const additional = 2;');
    const consumerProgram = await getProgram(consumerCode, consumerFile);
    const firstPrograms = loadPrograms({
        context,
        program: consumerProgram,
        fileName: consumerFile
    });
    const secondPrograms = loadPrograms({
        context,
        program: consumerProgram,
        fileName: consumerFile
    });
    assert.equal(firstPrograms[normalizePath(providerFile)], secondPrograms[normalizePath(providerFile)]);

    await writeFile(providerFile, 'export const getPageView = ({ title = "" } = {}) => title.trim();');
    const thirdPrograms = loadPrograms({
        context,
        program: consumerProgram,
        fileName: consumerFile
    });
    assert.notEqual(firstPrograms[normalizePath(providerFile)], thirdPrograms[normalizePath(providerFile)]);

    const firstGraph = manager.getGraph({
        context,
        program: consumerProgram,
        fileName: consumerFile
    });
    const secondGraph = manager.getGraph({
        context,
        program: consumerProgram,
        fileName: consumerFile
    });
    assert.equal(firstGraph, secondGraph);
    assert.equal(firstGraph.getDiagnostics().length, 1);
    assert.deepEqual(manager.getStats(), {
        hits: 1,
        misses: 1,
        builds: 1,
        size: 1
    });

    await writeFile(providerFile, 'export const getPageView = ({ title = 0 } = {}) => title;');
    const thirdGraph = manager.getGraph({
        context,
        program: consumerProgram,
        fileName: consumerFile
    });
    assert.notEqual(firstGraph, thirdGraph);
    assert.equal(thirdGraph.getDiagnostics().length, 0);
    assert.deepEqual(manager.getStats(), {
        hits: 1,
        misses: 2,
        builds: 2,
        size: 1
    });

    const boundedManager = createProjectGraphManager({ graphCacheLimit: 1 });
    const firstBoundedGraph = boundedManager.getGraph({
        context,
        program: consumerProgram,
        fileName: consumerFile
    });
    boundedManager.getGraph({
        context,
        program: consumerProgram,
        fileName: path.join(directory, 'second-consumer.js')
    });
    assert.equal(boundedManager.getStats().size, 1);
    const evictedBoundedGraph = boundedManager.getGraph({
        context,
        program: consumerProgram,
        fileName: consumerFile
    });
    assert.notEqual(evictedBoundedGraph, firstBoundedGraph);

    const coveredRootProgram = await getProgram(
        'import { shared } from "./covered-shared.js"; shared;',
        coveredRootFile
    );
    const coveredSharedProgram = await getProgram(
        'export const shared = 1;',
        coveredSharedFile
    );
    const coveredManager = createProjectGraphManager();
    coveredManager.getGraph({
        context,
        program: coveredRootProgram,
        fileName: coveredRootFile
    });
    const coveredGraph = coveredManager.getGraph({
        context: {
            ...context,
            settings: {
                resilient: {
                    roots: [coveredAdditionalRootFile]
                }
            }
        },
        program: coveredSharedProgram,
        fileName: coveredSharedFile
    });
    assert.ok(coveredGraph.programs[normalizePath(coveredAdditionalRootFile)]);

    await rm(providerFile);
    const changedConsumerProgram = await getProgram(consumerCode, consumerFile);
    const deletedGraph = manager.getGraph({
        context,
        program: changedConsumerProgram,
        fileName: consumerFile
    });
    assert.equal(deletedGraph.programs[normalizePath(providerFile)], undefined);

    const lateConsumerProgram = await getProgram(
        'import { late } from "./late-provider.js"; late;',
        lateConsumerFile
    );
    const lateManager = createProjectGraphManager();
    const lateContext = {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module'
        }
    };
    const unresolvedLateGraph = lateManager.getGraph({
        context: lateContext,
        program: lateConsumerProgram,
        fileName: lateConsumerFile
    });
    assert.equal(unresolvedLateGraph.programs[normalizePath(lateProviderFile)], undefined);

    await writeFile(lateProviderFile, 'export const late = 1;');
    const resolvedLateGraph = lateManager.getGraph({
        context: lateContext,
        program: lateConsumerProgram,
        fileName: lateConsumerFile
    });
    assert.ok(resolvedLateGraph.programs[normalizePath(lateProviderFile)]);
    assert.ok(getProgramCacheSize() > 0);
    clearContractCaches();
    assert.equal(getProgramCacheSize(), 0);
} finally {
    await rm(directory, { recursive: true, force: true });
}
