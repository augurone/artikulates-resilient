import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ESLint } from 'eslint';

import { isFunction } from '../analysis/host/function.js';

const { argv = [] } = process;
const [inputFile = '', outputFile = ''] = argv.slice(2);
const { provider = '', eslintConfig = '', projectRoot = '', requests = [], proof = false } = JSON.parse(readFileSync(inputFile, 'utf8'));

try {
    const loaded = provider ? await import(pathToFileURL(provider).href) : { default: { schemaVersion: 1 } };
    const { default: extension = {} } = loaded;
    const { schemaVersion = 0, resolveImport = false, proof: proofHook = false } = extension;

    if (!extension || typeof extension !== 'object' || schemaVersion !== 1 ||
        Object.keys(extension).some(key => !['schemaVersion', 'resolveImport', 'proof'].includes(key)) ||
        resolveImport && !isFunction(resolveImport) || proofHook && !isFunction(proofHook)) {
        throw new Error('Invalid project provider export; expected default { schemaVersion: 1, resolveImport?, proof? }.');
    }

    const lint = eslintConfig ? new ESLint({ cwd: projectRoot, overrideConfigFile: eslintConfig }) : false;
    let results = [];

    // eslint-disable-next-line resilient/prefer-prototype-methods -- Await hooks sequentially so their dependency loads finish before the input census.
    for (const context of requests) {
        const { importer = '', specifier = '' } = context;
        let route = resolveImport ? await resolveImport(Object.freeze(context)) : false;
        const importerConfig = !route && lint ? await lint.calculateConfigForFile(importer) : {};
        const config = importerConfig || (lint ? await lint.calculateConfigForFile(importer.replace(/\.tsx?$/u, '.js')) : {});
        const selectedConfig = config ? config : {};
        const { settings = {} } = selectedConfig;
        const { resilient = {} } = settings;
        const { resolver = false } = resilient;
        const selectedResolver = resolver ? resolver : {};
        const { typescript: bridge = false } = selectedResolver;

        if (resolver && !isFunction(resolver)) throw new Error('settings.resilient.resolver must be a function.');

        const resolved = resolver ? await resolver({ from: importer, source: specifier }) : '';
        const candidate = resolved || (bridge ? await bridge({ from: importer, source: specifier }) : '');

        if (!route && candidate) route = { kind: 'eslint', source: path.resolve(projectRoot, candidate) };

        results = [...results, route || false];
    }

    const proofOptions = proof && proofHook ? await proofHook(Object.freeze({ projectRoot })) : {};
    writeFileSync(outputFile, JSON.stringify({ results, proof: proofOptions }));
} catch (error) {
    const { message = '' } = error;
    writeFileSync(outputFile, JSON.stringify({ error: message }));
}
