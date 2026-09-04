import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ESLint } from 'eslint';
import resilient from 'eslint-plugin-resilient';
import { createContractGraph, normalizePath } from 'eslint-plugin-resilient/contracts';

import {
    clearProjectGraphCache,
    getProjectGraphCacheStats,
    loadPrograms
} from '../rules/contracts/eslint-graph.js';

const directory = await mkdtemp(path.join(process.cwd(), '.resilient-resolver-'));
const providerFile = path.join(directory, 'provider.js');
const consumerFile = path.join(directory, 'consumer.js');
let resolverCalls = 0;

const getProgram = async (code = '', fileName = '') => {
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
    clearProjectGraphCache();
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
    await eslint.lintText(code, { filePath: fileName });

    return program;
};

try {
    await writeFile(providerFile, 'export const getPageView = ({ title = "" } = {}) => title;');
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
        context: { settings: { resilient: { resolver } } },
        program: consumerProgram,
        fileName: consumerFile
    });
    assert.deepEqual(Object.keys(programs).sort(), [consumerFile, providerFile].sort());
    const graph = createContractGraph({
        programs,
        resolve: ({ source = '' } = {}) => source === '@artikulates/page'
            ? normalizePath(providerFile)
            : ''
    });
    assert.equal(graph.getDiagnostics().length, 1);

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
} finally {
    await rm(directory, { recursive: true, force: true });
}
