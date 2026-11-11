#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runProjectTests } from '../integrations/project-tests.js';

const usage = 'Usage: resilient-prove --project <directory|tsconfig.json> [--outDir <fresh artifact directory>] [--timeout <milliseconds>] [--eslint-config <file>]';

export const main = async (args = []) => {
    if (args.length === 1 && args.at(0) === '--help') {
        process.stdout.write(usage + '\n');

        return;
    }

    const values = new Map();

    // eslint-disable-next-line resilient/prefer-prototype-methods -- The bounded option cursor consumes each flag/value pair exactly once and rejects duplicates before execution.
    for (let index = 0; index < args.length; index += 2) {
        const flag = args.at(index);
        const value = args.at(index + 1);

        if (!['--project', '--outDir', '--timeout', '--eslint-config'].includes(flag) || values.has(flag) || !value || value.startsWith('--')) throw new Error(usage);

        // eslint-disable-next-line resilient/prefer-safe-transformations -- The private option index rejects duplicate flags without copying the growing argument prefix.
        values.set(flag, value);
    }

    if (!values.has('--project')) throw new Error(usage);

    const record = await runProjectTests({ project: values.get('--project'), outDir: values.get('--outDir') || '',
        eslintConfig: values.get('--eslint-config') || '', timeout: Number(values.get('--timeout') || 120000) });
    const { complete = false, artifact = '', error = '' } = record;
    process.stdout.write(`${JSON.stringify({ complete, artifact, error })}\n`);
    // eslint-disable-next-line resilient/prefer-safe-transformations -- The CLI communicates the completed project result through its native process exit status.
    process.exitCode = complete ? 0 : 1;
};

if (process.argv.at(1) && realpathSync(path.resolve(process.argv.at(1))) === fileURLToPath(import.meta.url)) {
    try {
        await main(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Invalid CLI configuration and operational failures must produce a failing command status.
        process.exitCode = 1;
    }
}
