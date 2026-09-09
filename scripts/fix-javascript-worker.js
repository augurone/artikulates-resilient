#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { ESLint } from 'eslint';

const digest = text => createHash('sha256').update(text).digest('hex');

let inspector;
let fixer;
let measure = false;
let fixAll = false;

const optionsFor = ({ cwd = '', eslintConfig = undefined } = {}) => ({
    cwd,
    stats: true,
    errorOnUnmatchedPattern: false,
    ...(eslintConfig ? { overrideConfigFile: eslintConfig } : {})
});
const respond = (id, result = {}) => {
    if (typeof process.send === 'function' && process.connected) {
        process.send({ id, ...result }, (error) => {
            if (error && process.connected) process.disconnect();
        });
    }
};
const initialize = (message = {}) => {
    const { measure: requestedMeasure = false, fixAll: requestedFixAll = false } = message;
    measure = Boolean(requestedMeasure);
    fixAll = Boolean(requestedFixAll);
    const options = optionsFor(message);

    inspector = new ESLint({ ...options, fix: false });

    if (fixAll) fixer = new ESLint({ ...options, fix: true });
};
const checkResult = (results = [], filePath = '') => {
    const [result = {}] = results;
    const { filePath: measured = '', fatalErrorCount = 0, messages = [], stats: { times: { passes = [] } = {} } = {} } = result;
    const inspected = passes.length && passes.every(({ parse = {}, rules = {} } = {}) => {
        const ruleNames = Object.keys(rules);

        return Object.hasOwn(parse, 'total') && Boolean(ruleNames.length);
    });

    if (!inspected || results.length !== 1 || measured !== filePath || fatalErrorCount || messages.some(
        ({ ruleId = '', message = '', fatal = false } = {}) => fatal || (!ruleId && !message.startsWith('Unused eslint-disable directive'))
    )) {
        const reason = inspected ? '' : 'no parser or enabled-rule execution; ';

        throw new Error(`Incomplete JavaScript lint: ${filePath}: ${reason}${messages.map(({ message = '' } = {}) => message).join('; ')}`);
    }

    return result;
};
const getProfile = async (filePath = '') => {
    const config = await inspector.calculateConfigForFile(filePath);

    if (!config || await inspector.isPathIgnored(filePath)) throw new Error(`Missing or ignored JavaScript lint profile: ${filePath}`);

    const { rules = {}, languageOptions = {}, plugins = {}, processor = undefined, settings = {}, linterOptions = {} } = config;

    if (!Object.values(rules).some(([severity = 0] = []) => severity > 0)) {
        throw new Error(`No enabled JavaScript lint rules: ${filePath}`);
    }

    const { parser = {}, ...language } = languageOptions;
    const { meta = {}, version = '' } = parser;
    const configFile = await inspector.findConfigFile(filePath);
    const profile = {
        configFile,
        configSha256: configFile ? digest(readFileSync(configFile)) : '',
        eslintVersion: ESLint.version,
        nodeVersion: process.version,
        rules,
        languageOptions: { ...language, parser: { ...meta, version } },
        plugins: Object.fromEntries(Object.entries(plugins).map(([name = '', { meta: pluginMeta = {} } = {}] = []) => [name, pluginMeta])),
        processor: processor || false,
        settings,
        linterOptions
    };
    // Functions in configuration are represented by their source rather than silently omitted from identity.
    const serialized = JSON.stringify(profile, (key, value) => typeof value === 'function' ? String(value) : value);

    return { ...JSON.parse(serialized), sha256: digest(serialized) };
};
const disconnect = () => {
    if (typeof process.disconnect === 'function') process.disconnect();
};

process.on('message', async ({ id = undefined, type = '', ...message } = {}) => {
    try {
        if (type === 'init') {
            initialize(message);
            respond(id);

            return;
        }

        if (type === 'fix') {
            const { code = '', filePath = '' } = message;
            const profile = await getProfile(filePath);
            const raw = checkResult(await inspector.lintText(code, { filePath }), filePath);
            const result = fixAll ? checkResult(await fixer.lintText(code, { filePath }), filePath) : raw;
            const { output: fixedOutput = undefined } = result;
            const output = fixedOutput ?? code;
            const fixed = fixAll && measure ? checkResult(await inspector.lintText(output, { filePath }), filePath) : result;

            respond(id, { output, raw, fixed, profile });

            return;
        }

        if (type === 'close') {
            respond(id);
            disconnect();

            return;
        }

        throw new Error(`Unknown ESLint worker request: ${type}`);
    } catch (error) {
        respond(id, { error: error instanceof Error ? error.stack || error.message : String(error) });
    }
});
