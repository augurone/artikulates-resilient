import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ESLint } from 'eslint';

import resilient from 'eslint-plugin-resilient';
import { createContractGraph, normalizePath } from 'eslint-plugin-resilient/contracts';

import {
    clearProjectGraphCache,
    createProjectGraphManager,
    getImportedRuleDefinition,
    getProjectGraphCacheStats,
    getProgramCacheSize,
    loadPrograms
} from '../rules/contracts/eslint-graph.js';
import { captureProgram } from '../rules/support/eslint-program.js';

const directory = await mkdtemp(path.join(process.cwd(), '.resilient-resolver-'));
const providerFile = path.join(directory, 'provider.js');
const consumerFile = path.join(directory, 'consumer.js');
const frameworkFile = path.join(directory, 'layout.js');
let resolverCalls = 0;

const getProgram = async (code = '', fileName = '') => {
    clearProjectGraphCache();

    return captureProgram(code, { fileName, languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } });
};
try {
    await writeFile(
        providerFile,
        'export const getPageView = ({ title = "" } = {}) => title;'
    );
    await writeFile(frameworkFile, 'export const Layout = ({ children = [] } = {}) => children;');
    await writeFile(
        consumerFile,
        'import { getPageView } from "@artikulates/page"; getPageView({ title: 42 });'
    );

    const consumerProgram = await getProgram(
        'import { getPageView } from "@artikulates/page"; getPageView({ title: 42 });',
        consumerFile
    );
    const resolver = ({ source = '' } = {}) => source === '@artikulates/page'
        ? providerFile
        : '';
    const programs = loadPrograms({
        context: {
            settings: {
                resilient: {
                    resolver,
                    roots: ({ fileName = '' } = {}) => fileName === consumerFile ? [frameworkFile] : []
                }
            }
        },
        program: consumerProgram,
        fileName: consumerFile
    });
    assert.deepEqual(Object.keys(programs).toSorted(), [consumerFile, frameworkFile, providerFile].toSorted());
    const graph = createContractGraph({
        programs,
        resolve: ({ source = '' } = {}) => source === '@artikulates/page'
            ? normalizePath(providerFile)
            : ''
    });
    assert.equal(graph.getDiagnostics().length, 1);

    const rootedGraph = createProjectGraphManager().getGraph({
        context: {
            filename: consumerFile,
            settings: {
                resilient: {
                    resolver,
                    roots: [frameworkFile]
                }
            }
        },
        program: consumerProgram,
        fileName: consumerFile
    });
    assert.ok(rootedGraph.programs[normalizePath(frameworkFile)]);

    const failedPrograms = loadPrograms({
        context: {
            settings: {
                resilient: {
                    resolver: () => {
                        throw new Error('resolver unavailable');
                    }
                }
            }
        },
        program: consumerProgram,
        fileName: consumerFile
    });
    assert.deepEqual(Object.keys(failedPrograms), [consumerFile]);

    const eslint = new ESLint({
        overrideConfigFile: true,
        overrideConfig: [{
            languageOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module'
            },
            settings: {
                resilient: {
                    resolver: ({ source = '' } = {}) => {
                        resolverCalls += 1;

                        return source === '@artikulates/page' ? providerFile : '';
                    }
                }
            }
        }, resilient.configs.contracts]
    });
    const [result = {}] = await eslint.lintFiles([consumerFile]);

    assert.ok(resolverCalls > 0);
    const graphStats = getProjectGraphCacheStats();
    assert.ok(graphStats.builds >= 1);
    assert.ok(graphStats.hits >= 1);
    assert.deepEqual(
        result.messages.map(({ ruleId = '' } = {}) => ruleId),
        ['resilient/signature-contract-call-site']
    );

    // A completed file must not lend its imported ASTs and project variants to
    // every subsequent lint input. Rules on the next AST still share one build.
    assert.ok(getProgramCacheSize() > 0);
    const providerProgram = await captureProgram('export const getPageView = ({ title = "" } = {}) => title;', { fileName: providerFile });
    const nestedDefinition = getImportedRuleDefinition({
        context: { sourceCode: { ast: providerProgram }, filename: providerFile },
        name: 'getPageView'
    });
    assert.equal(nestedDefinition.node.type, 'ArrowFunctionExpression');
    assert.ok(getProjectGraphCacheStats().size > 1);
    const beforeNextFile = getProjectGraphCacheStats();
    const [nextResult = {}] = await eslint.lintText(
        'const getTitle = ({ title = "" } = {}) => title; getTitle({ title: 42 });',
        { filePath: path.join(directory, 'next.js') }
    );
    assert.deepEqual(nextResult.messages.map(({ ruleId = '' } = {}) => ruleId), ['resilient/signature-contract-call-site']);
    assert.equal(getProgramCacheSize(), 0);
    const afterNextFile = getProjectGraphCacheStats();
    assert.equal(afterNextFile.builds - beforeNextFile.builds, 1);
    assert.ok(afterNextFile.hits > beforeNextFile.hits);
    assert.equal(afterNextFile.size, 1);

    const [revisitedResult = {}] = await eslint.lintFiles([consumerFile]);
    assert.deepEqual(revisitedResult.messages, result.messages);
    assert.ok(getProgramCacheSize() > 0);
} finally {
    await rm(directory, { recursive: true, force: true });
}
