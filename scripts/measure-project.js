#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { measureProject, saveMeasurement } from '../integrations/measurement.js';

const usage = 'Usage: resilient-measure [--project <directory>] [--config <eslint config>] [--report <json file>] [patterns ...]\n'
    + 'resilient-audit [same options] [--inventory [--unused]]\n';
const main = async (args = []) => {
    const { values = {}, positionals = [] } = parseArgs({ args, allowPositionals: true, options: {
        project: { type: 'string' }, config: { type: 'string' }, report: { type: 'string' },
        inventory: { type: 'boolean' }, unused: { type: 'boolean' }, audit: { type: 'boolean' }, help: { type: 'boolean' }
    } });
    const { project = process.cwd(), config = '', report: reportFile = '', inventory = false, unused = false, audit = false, help = false } = values;

    if (help) {
        process.stdout.write(usage);

        return;
    }

    if (['project', 'config', 'report'].some((key) => {
        const { [key]: value = '' } = values;

        return Object.hasOwn(values, key) && !value;
    })) throw new Error(usage);

    if (unused && !inventory) throw new Error('--unused requires --inventory');

    const report = await measureProject({ directory: project, configFile: config, patterns: positionals.length ? positionals : ['.'], unused });
    const { complete = false, exceptions = [], auditProblems = [], active = [] } = report;
    const unusedProblems = active.filter(({ ruleId = '', message = '' } = {}) => !ruleId && message.startsWith('Unused eslint-disable directive'));
    const result = inventory ? { ...report, exceptions: unused ? exceptions.filter(({ unusedRules = [] } = {}) => !!unusedRules.length) : exceptions }
        : report;

    if (reportFile) saveMeasurement({ directory: project, file: reportFile, report: result });

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    // eslint-disable-next-line resilient/prefer-safe-transformations -- Incomplete capture or rejected audit exceptions fail this CLI; ordinary findings remain measurement data.
    process.exitCode = !complete || audit && !inventory && (!!auditProblems.length || !!unusedProblems.length) ? 1 : 0;
};
const { argv: [, entry = '', ...args] = [] } = process;

if (entry && pathToFileURL(realpathSync(resolve(entry))).href === import.meta.url) {
    try {
        await main(args);
    } catch (error) {
        const { message = '' } = error;
        process.stderr.write(`${message}\n`);
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Configuration, scope, input and report failures must produce a failing CLI status.
        process.exitCode = 1;
    }
}
