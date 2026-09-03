import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ESLint } from 'eslint';
import resilient from 'eslint-plugin-resilient';

const directory = await mkdtemp(path.join(process.cwd(), '.resilient-contract-'));
const providerFile = path.join(directory, 'provider.js');
const barrelFile = path.join(directory, 'barrel.js');
const consumerFile = path.join(directory, 'consumer.js');
const providerCode = [
    'export const getTitle = ({ title = "" } = {}) => title;',
    'export const getItems = ({ items = [] } = {}) => items;',
    'export const getConfig = () => ({ items: [] });',
    'export const getArticle = () => ({ title: "", summary: "" });'
].join('\n');
const consumerCode = [
    'import { getTitle, getItems, getConfig, getArticle } from "./barrel.js";',
    'getTitle({ title: 42 });',
    'getItems({}).toUpperCase();',
    'getConfig().items.toUpperCase();',
    'const { title, summery } = getArticle();'
].join('\n');

try {
    await writeFile(providerFile, providerCode);
    await writeFile(barrelFile, 'export { getTitle, getItems, getConfig, getArticle } from "./provider.js";');
    await writeFile(consumerFile, consumerCode);

    const eslint = new ESLint({
        overrideConfigFile: true,
        overrideConfig: [{
            languageOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module'
            },
            plugins: { resilient },
            rules: {
                'resilient/signature-contract-call-site': 'error',
                'resilient/signature-contract-operation': 'error',
                'resilient/signature-contract-destructuring': 'error'
            }
        }]
    });
    const [result = {}] = await eslint.lintText(consumerCode, {
        filePath: consumerFile
    });
    const messages = result.messages || [];

    assert.deepEqual(messages.map(({ ruleId = '' } = {}) => ruleId), [
        'resilient/signature-contract-call-site',
        'resilient/signature-contract-operation',
        'resilient/signature-contract-operation',
        'resilient/signature-contract-destructuring'
    ]);
    assert.equal(messages[1].message, 'getItems() is array-like, but .toUpperCase() requires a string-like.');
    assert.equal(messages[2].message, 'getConfig().items is array-like, but .toUpperCase() requires a string-like.');
    assert.equal(messages[3].message, 'Property summery does not exist on this known object contract.');
    assert.equal(messages[3].messageId, 'missingProperty');
} finally {
    await rm(directory, { recursive: true, force: true });
}
