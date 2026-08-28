import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ESLint } from 'eslint';
import resilient from 'eslint-plugin-resilient';

const directory = await mkdtemp(path.join(process.cwd(), '.resilient-imports-'));
const providerFile = path.join(directory, 'provider.js');
const consumerFile = path.join(directory, 'consumer.js');
const barrelFile = path.join(directory, 'barrel.js');
const unresolvedFile = path.join(directory, 'unresolved.js');
const duplicateFile = path.join(directory, 'duplicate.js');
const leftFile = path.join(directory, 'left.js');
const rightFile = path.join(directory, 'right.js');

try {
    await writeFile(providerFile, 'export const getPageView = () => ({ title: "" });');
    await writeFile(
        consumerFile,
        [
            'import { getPageView, getMissingPage } from "./provider.js";',
            'import * as pageApi from "./provider.js";',
            'void getPageView;',
            'void getMissingPage;',
            'void pageApi.getMissingPage;'
        ].join('\n')
    );
    await writeFile(barrelFile, 'export { getMissingPage } from "./provider.js";');
    await writeFile(unresolvedFile, 'import { getPageView } from "./missing-provider.js"; void getPageView;');
    await writeFile(leftFile, 'export const sharedPage = () => ({ title: "" });');
    await writeFile(rightFile, 'export const sharedPage = () => ({ title: "" });');
    await writeFile(duplicateFile, 'export * from "./left.js"; export * from "./right.js";');

    const eslint = new ESLint({
        overrideConfigFile: true,
        overrideConfig: [resilient.configs.imports]
    });
    const results = await eslint.lintFiles([
        consumerFile,
        barrelFile,
        unresolvedFile,
        duplicateFile,
        leftFile,
        rightFile
    ]);
    const result = results.flatMap(({ messages = [] } = {}) => messages);
    const ruleIds = result.map(({ ruleId = '' } = {}) => ruleId).sort();

    assert.deepEqual(ruleIds, [
        'import/export',
        'import/export',
        'import/named',
        'import/named',
        'import/namespace',
        'import/no-unresolved'
    ]);
} finally {
    await rm(directory, { recursive: true, force: true });
}
