import { createAnalysisListener } from './support/analysis.js';

const label = name => name === 'nullish' ? name : `${name}-like`;

export default {
    meta: {
        type: 'problem',
        docs: { description: 'Report established destructuring family and required-field contradictions',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/signature-contract-destructuring.md' },
        schema: [],
        messages: {
            mismatch: 'This {{actual}} value is destructured as {{expected}}.',
            missingProperty: 'Property {{property}} does not exist on this known object contract.'
        }
    },
    create(context = {}) {
        return createAnalysisListener(context, (analysis, report) => {
            const { destructurings = [], destructuringFields = [] } = analysis;

            destructurings.forEach(({ index = -1, expected = '', location = {} } = {}) => {
                const { status = '', fact: { families = [] } = {} } = analysis.checkDestructuring({ index });

                if (status !== 'contradiction') return;

                report({ location, messageId: 'mismatch', data: { actual: families.map(label).join(' or '), expected: label(expected) } });
            });
            destructuringFields.forEach(({ index = -1, name = '', location = {} } = {}) => {
                const { status = '', fact = false } = analysis.checkDestructuringField({ index });
                const { presence = [] } = fact;

                if (status !== 'contradiction' || !presence.includes('absent')) return;

                report({ location, messageId: 'missingProperty', data: { property: name } });
            });
        });
    }
};
