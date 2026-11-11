import { createProgramAnalysis } from 'eslint-plugin-resilient/analyzer';

import { put } from '../../collections.js';
import { moduleSources } from './modules.js';
import { createLocationReporter } from './reporter.js';

// Contract rules consume the same immutable snapshot after host traversal.
// Program entry clears a previous invocation even when a host reuses SourceCode.
const sessions = new WeakMap();

const analysisFor = ({ sourceCode = {}, program = {}, context = {} } = {}) => {
    const current = sessions.get(sourceCode);

    if (current) return current;

    const { filename = '' } = context;

    return put(sessions, sourceCode, createProgramAnalysis({ program, filename, ...moduleSources(context) }));
};

export const createAnalysisListener = (context, consume) => {
    const { sourceCode = {} } = context;
    const report = createLocationReporter(context);

    return {
        Program() {
            put(sessions, sourceCode, false);
        },
        'Program:exit'(program) {
            consume(analysisFor({ sourceCode, program, context }), report);
        }
    };
};
