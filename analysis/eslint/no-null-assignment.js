import { createAssignmentValueListeners } from './support/assignment-values.js';
import { isNullLiteral } from './support/native-absence.js';
import { createReporter } from './support/reporter.js';

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow explicitly assigning null, including null defaults',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-null-assignment.md'
        },
        schema: [],
        messages: {
            nullAssignment: `Do not assign null; respect contracts, set defaults '', {}, [], 0, false, or do not set`
        }
    },
    create(context = {}) {
        const report = createReporter(context);

        return createAssignmentValueListeners({ report, isValue: isNullLiteral, messageId: 'nullAssignment' });
    }
};
