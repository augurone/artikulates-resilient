import { createAnalysisListener } from './support/analysis.js';

export default {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Require explicit absence contracts for destructured values',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/prefer-safe-destructuring-defaults.md'
        },
        schema: [],
        messages: { safeDefault: 'Provide an explicit default for this destructured value.' }
    },
    create(context = {}) {
        return createAnalysisListener(context, (analysis, report) => {
            const { declarations = [] } = analysis;

            declarations.forEach(({ index = -1, location = {} } = {}) => {
                const { required = false } = analysis.checkDeclaration({ index });

                if (!required) return;

                report({ location, messageId: 'safeDefault' });
            });
        });
    }
};
