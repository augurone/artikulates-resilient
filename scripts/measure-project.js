#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

import { getLintSummary } from './fluency-report.js';

const usage = 'Usage: resilient-measure [--project <directory>] [--config <eslint config>] [--report <json file>] [patterns ...]';
const packageFile = new URL('../package.json', import.meta.url);
const { version: resilientVersion = '' } = JSON.parse(readFileSync(packageFile, 'utf8'));
const digest = text => createHash('sha256').update(text).digest('hex');
const readDigest = file => digest(readFileSync(file));
const relativeFile = (directory = '', file = '') => {
    const relative = path.relative(directory, file);

    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Measured file is outside the project: ${file}`);
    }

    return relative.split(path.sep).join('/');
};
const getDirective = ({ value = '', loc = {}, range = [] } = {}) => {
    const text = value.trim();
    const match = /^eslint-(disable-next-line|disable-line|disable|enable)(?:\s+|$)/u.exec(text);

    if (!match) return {};

    const [, command = ''] = match;
    const [ruleText = '', ...reasonParts] = text.slice(match[0].length).trim().split(/\s*--\s*/u);
    const rules = ruleText.trim() ? ruleText.split(/\s*,\s*/u).filter(Boolean) : [];
    const { start: { line = 0, column = 0 } = {} } = loc;

    return {
        form: command,
        rules,
        reason: reasonParts.join(' -- ').trim(),
        location: { line, column: column + 1 },
        range
    };
};
const getDirectiveSites = (comments = []) => comments.map(getDirective).filter(({ form = '' } = {}) => Boolean(form))
    .filter(({ form = '' } = {}) => form !== 'enable');
const getMessages = ({ messages = [], suppressedMessages = [] } = {}, file = '') => ({
    file,
    active: messages.map(({ ruleId = null, severity = 0, message = '', line = 0, column = 0,
        endLine = 0, endColumn = 0, fatal = false } = {}) => ({
        ruleId, severity, message, line, column, endLine, endColumn, fatal
    })),
    suppressed: suppressedMessages.map(({ ruleId = null, severity = 0, message = '', line = 0, column = 0,
        suppressions = [] } = {}) => ({
        ruleId, severity, message, line, column,
        suppressions: suppressions.map(({ kind = '', justification = '' } = {}) => ({ kind, justification }))
    }))
});
const countRules = (sites = []) => Object.fromEntries(Object.entries(Object.groupBy(
    sites.flatMap(({ rules = [] } = {}) => rules.length ? rules : ['*']), rule => rule
)).map(([rule = '', members = []] = []) => [rule, members.length]).toSorted(([left = ''], [right = '']) => left.localeCompare(right)));

const measureProject = async ({ directory = process.cwd(), patterns = ['.'], configFile = '' } = {}) => {
    const project = path.resolve(directory);
    const captured = new Map();
    const capturePlugin = {
        rules: {
            capture: {
                create({ filename = '', sourceCode = {} } = {}) {
                    const { getAllComments = () => [] } = sourceCode;

                    // eslint-disable-next-line resilient/prefer-safe-transformations -- A private per-run index joins ESLint's parsed comments to its own lint result for the same file.
                    captured.set(filename, getDirectiveSites(getAllComments.call(sourceCode)));

                    return {};
                }
            }
        }
    };
    const eslint = new ESLint({
        cwd: project,
        fix: false,
        cache: false,
        concurrency: 'off',
        ...(configFile && { overrideConfigFile: path.resolve(project, configFile) }),
        overrideConfig: {
            plugins: { 'resilient-measure': capturePlugin },
            rules: { 'resilient-measure/capture': 'error' }
        }
    });
    const results = (await eslint.lintFiles(patterns)).toSorted(({ filePath: left = '' } = {}, { filePath: right = '' } = {}) => left.localeCompare(right));
    const configPath = configFile ? path.resolve(project, configFile) : await eslint.findConfigFile();
    const files = results.map((result = {}) => {
        const { filePath = '', fatalErrorCount = 0 } = result;
        const file = relativeFile(project, filePath);
        const sites = captured.get(filePath) || [];
        const sha256 = readDigest(filePath);
        const messages = getMessages(result, file);

        return { file, sha256, complete: captured.has(filePath) && fatalErrorCount === 0, ...messages, sites };
    });
    const activeResults = files.map(({ file = '', active = [] } = {}) => ({ filePath: file, messages: active }));
    const suppressedResults = files.map(({ file = '', suppressed = [] } = {}) => ({ filePath: file, messages: suppressed }));
    const sites = files.flatMap(({ file = '', sites: fileSites = [] } = {}) => fileSites.map(site => ({ file, ...site })));

    return {
        schemaVersion: 1,
        complete: files.every(({ complete = false } = {}) => complete),
        identity: {
            project,
            patterns,
            config: configPath ? path.relative(project, configPath).split(path.sep).join('/') : '',
            configSha256: configPath ? readDigest(configPath) : '',
            resilientVersion,
            eslintVersion: ESLint.version,
            nodeVersion: process.version
        },
        summary: {
            active: getLintSummary(activeResults),
            suppressed: getLintSummary(suppressedResults),
            exceptions: { sites: sites.length, ruleSites: sites.reduce((total, { rules = [] } = {}) => total + (rules.length || 1), 0), byRule: countRules(sites) }
        },
        files: files.map(({ file = '', sha256 = '', complete = false } = {}) => ({ file, sha256, complete })),
        active: files.flatMap(({ file = '', active = [] } = {}) => active.map(message => ({ file, ...message }))),
        suppressed: files.flatMap(({ file = '', suppressed = [] } = {}) => suppressed.map(message => ({ file, ...message }))),
        exceptions: sites
    };
};

const getOptions = (args = []) => {
    let values = { directory: process.cwd(), configFile: '', reportFile: '', patterns: [] };
    const options = { '--project': 'directory', '--config': 'configFile', '--report': 'reportFile' };
    let index = 0;

    // eslint-disable-next-line resilient/prefer-prototype-methods -- The option cursor consumes each flag with its value before visiting the next argument.
    while (index < args.length) {
        const argument = args.at(index) || '';
        const { [argument]: key = '' } = options;

        if (!key && argument.startsWith('--')) throw new Error(usage);

        if (!key) {
            const { patterns = [] } = values;

            values = { ...values, patterns: [...patterns, argument] };
            index += 1;

            continue;
        }

        const value = args.at(index + 1) || '';

        if (!value || value.startsWith('--')) throw new Error(usage);

        values = { ...values, [key]: value };
        index += 2;
    }

    const { patterns = [], ...rest } = values;

    return { ...rest, patterns: patterns.length ? patterns : ['.'] };
};
const saveReport = ({ directory = '', file = '', report = {} } = {}) => {
    const destination = path.resolve(directory, file);
    const { files = [] } = report;

    if (path.extname(destination) !== '.json' || files.some(({ file: measured = '' } = {}) => path.resolve(directory, measured) === destination)) {
        throw new Error('The report must be a JSON file distinct from measured source.');
    }

    const pending = `${destination}.pending`;

    writeFileSync(pending, `${JSON.stringify(report, null, 2)}\n`);
    renameSync(pending, destination);
};
const main = async () => {
    const { argv = [], stdout = {} } = process;
    const { directory = '', configFile = '', reportFile = '', patterns = [] } = getOptions(argv.slice(2));
    const report = await measureProject({ directory, configFile, patterns });
    const { complete = false, summary = {} } = report;
    const output = `${JSON.stringify(report, null, 2)}\n`;

    if (!complete) {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- A partial measurement is a failed CLI result after the report is assembled.
        process.exitCode = 1;
    }

    if (reportFile) {
        saveReport({ directory, file: reportFile, report });
        stdout.write(`${JSON.stringify({ complete, summary })}\n`);

        return;
    }

    stdout.write(output);
};

const { argv = [] } = process;

if (argv[1] && realpathSync(argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        await main();
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Invalid configuration or I/O must produce a failing command status after the error is emitted.
        process.exitCode = 1;
    }
}

export { getDirective, getDirectiveSites, getOptions, measureProject };
