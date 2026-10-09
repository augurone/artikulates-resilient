import { createAnalysisListener } from './support/analysis.js';

const label = name => name === 'nullish' ? name : `${name}-like`;

export default {
    meta: {
        type: 'problem',
        docs: { description: 'Report native operations that contradict source-owned receiver evidence',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/signature-contract-operation.md' },
        schema: [],
        messages: {
            mismatch: 'This {{actual}} value cannot supply native .{{method}}(), which requires {{expected}}.',
            sourceMismatch: 'This {{actual}} value cannot supply native .{{method}}(), which requires {{expected}}. Source producer: {{producer}}.'
        }
    },
    create(context = {}) {
        const { filename = '' } = context;

        return createAnalysisListener(context, (analysis, report) => {
            const { memberAccesses = [] } = analysis;

            memberAccesses.forEach(({ index = -1, name = '', call = false, location = {} } = {}) => {
                if (!call) return;

                const { conflicts = [], expected = '', producers = [] } = analysis.checkMemberAccess({ index });

                if (!conflicts.length) return;

                const locations = producers.filter(({ module = '', location: { line = 0 } = {} } = {}) => Boolean(module && module !== filename && line))
                    .map(({ module = '', location: { line = 0 } = {} } = {}) => `${module} at line ${line}`);
                const producer = [...new Set(locations)].join('; ');

                report({ location, messageId: producer ? 'sourceMismatch' : 'mismatch',
                    data: { actual: conflicts.map(label).join(' or '), method: name, expected: label(expected), producer } });
            });
        });
    }
};
