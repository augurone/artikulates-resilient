import { createAnalysisListener } from './support/analysis.js';

export default {
    meta: {
        type: 'problem',
        docs: { description: 'Report static properties absent from source-owned closed records',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/signature-contract-property.md' },
        schema: [],
        messages: { missingProperty: 'Property {{property}} does not exist on this known object contract.' }
    },
    create(context = {}) {
        return createAnalysisListener(context, (analysis, report) => {
            const { memberAccesses = [] } = analysis;

            memberAccesses.forEach(({ index = -1, name = '', location = {} } = {}) => {
                const { missing = false } = analysis.checkMemberAccess({ index });

                if (!missing) return;

                report({ location,
                    messageId: 'missingProperty', data: { property: name } });
            });
        });
    }
};
