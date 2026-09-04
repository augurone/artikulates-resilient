import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ESLint } from 'eslint';
import { createProjectGraphManager } from 'eslint-plugin-resilient/contracts';

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
    assert.equal(firstPrograms[providerFile], secondPrograms[providerFile]);

    await writeFile(providerFile, 'export const getPageView = ({ title = "" } = {}) => title.trim();');
    const thirdPrograms = loadPrograms({
        context,
        program: consumerProgram,
        fileName: consumerFile
    });
    assert.notEqual(firstPrograms[providerFile], thirdPrograms[providerFile]);

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
    assert.notEqual(
        boundedManager.getGraph({
            context,
            program: consumerProgram,
            fileName: consumerFile
        }),
        firstBoundedGraph
    );
    assert.ok(getProgramCacheSize() > 0);
    clearContractCaches();
    assert.equal(getProgramCacheSize(), 0);
} finally {
    await rm(directory, { recursive: true, force: true });
}
