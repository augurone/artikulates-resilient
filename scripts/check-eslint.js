#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ESLint } from 'eslint';

import { auditSource } from './audit-eslint-exceptions.js';

// Audit the selected source before allowing any autofix to change it.
export const checkFiles = async ({ cwd = process.cwd(), files = ['.'], fix = false, ...options } = {}) => {
    const settings = {
        ...options, cwd, cache: false, fix: false,
        overrideConfig: {
            linterOptions: { noInlineConfig: false, reportUnusedDisableDirectives: 'error', reportUnusedInlineConfigs: 'error' }
        }
    };
    const initial = await new ESLint(settings).lintFiles(files);
    const exceptions = initial.flatMap(({ filePath = '' } = {}) => auditSource(readFileSync(filePath, 'utf8'))
        .map(message => ({ filePath, message })));
    const results = fix && !exceptions.length ? await new ESLint({ ...settings, fix: true }).lintFiles(files) : initial;

    if (fix && !exceptions.length) await ESLint.outputFixes(results);

    const failed = !!exceptions.length || results.some(({ errorCount = 0, fatalErrorCount = 0 } = {}) => errorCount || fatalErrorCount);

    return { results, exceptions, exitCode: failed ? 1 : 0 };
};

const main = async (args = []) => {
    if (args.includes('--help')) {
        process.stdout.write('Usage: resilient-check [--fix] [--json] [file or glob ...]\n'
            + 'Runs configured ESLint with standard output and audits exceptions. --json opts into the detailed development report.\n');

        return;
    }

    const options = new Set(['--fix', '--json']);
    const unknown = args.find(arg => arg.startsWith('-') && !options.has(arg));

    if (unknown) throw new Error(`Unknown option: ${unknown}`);

    const patterns = args.filter(arg => !options.has(arg));
    const result = await checkFiles({ files: patterns.length ? patterns : ['.'], fix: args.includes('--fix') });
    const { exitCode = 0, results = [], exceptions = [] } = result;
    const formatter = await new ESLint().loadFormatter('stylish');
    const output = args.includes('--json') ? `${JSON.stringify(result, null, 2)}\n`
        : formatter.format(results) + exceptions.map(({ filePath = '', message = '' } = {}) => `${filePath}: ${message}\n`).join('');

    process.stdout.write(output);
    // eslint-disable-next-line resilient/prefer-safe-transformations -- The CLI owns its process exit status after writing the complete check report.
    process.exitCode = exitCode;
};
const { argv = [] } = process;
const [, entry = '', ...args] = argv;

const { href: entryURL = '' } = pathToFileURL(realpathSync(resolve(entry || '.')));

if (entry && entryURL === import.meta.url) await main(args);
