import path from 'node:path';

import { ESLint } from 'eslint';

import { getArtifactLintBatch } from './artifact-lint-batch.js';
import { writeJsonReport } from './json-report.js';

const modes = Object.freeze({ fix: true, verify: false });
const lintArtifactBatch = async ({ mode = 'verify', options = process.argv } = {}) => {
    if (!Object.hasOwn(modes, mode)) throw new Error(`Unknown artifact lint mode: ${mode}`);

    const { [mode]: fix = false } = modes;
    const { destination = '', part = 0, configFile = '', files = [] } = getArtifactLintBatch(options);
    const eslint = new ESLint({ cwd: destination, fix, overrideConfigFile: configFile, errorOnUnmatchedPattern: false });
    const results = await eslint.lintFiles(files);

    if (fix) await ESLint.outputFixes(results);

    const report = fix ? results.map(({ filePath = '', output = undefined, messages = [] } = {}) => ({
        file: filePath, fixed: typeof output === 'string', remaining: messages.length
    })) : results;
    writeJsonReport(path.join(destination, `lint-${mode}-part-${part}.json`), report);
};

export { lintArtifactBatch };
