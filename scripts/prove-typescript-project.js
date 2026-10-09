#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const usage = 'Usage: resilient-prove --target <resilient-proof.config.js> [--slice <name> | --full]';
const getOptions = (args = [], cwd = process.cwd()) => {
    const [flag = '', target = '', mode = '', value = ''] = args;

    if (flag !== '--target' || !target || !['--full', '--slice'].includes(mode) || mode === '--slice' && !value || mode === '--full' && value) {
        throw new Error(usage);
    }

    return { target: path.resolve(cwd, target), full: mode === '--full', slice: mode === '--slice' ? value : '' };
};
const runProof = async ({ target = '', full = false, slice = '', cwd = process.cwd() } = {}) => {
    const { default: profile = {} } = await import(pathToFileURL(target).href);
    const { run = undefined } = profile;

    if (typeof run !== 'function') throw new TypeError('The proof profile must export a run function.');

    return run({ cwd, full, slice, execFileSync });
};
const main = async (args = process.argv.slice(2)) => runProof({ ...getOptions(args), cwd: process.cwd() });

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

export { getOptions, main, runProof };
