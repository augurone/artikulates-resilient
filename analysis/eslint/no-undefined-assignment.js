import { createAssignmentValueListeners } from './support/assignment-values.js';
import { createExplicitUndefinedReader } from './support/native-absence.js';
import { createReporter } from './support/reporter.js';

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow explicitly assigning undefined',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-undefined-assignment.md'
        },
        schema: [],
        messages: {
            undefinedAssignment: `Do not assign undefined, it is a state not a value. Respect contracts, set defaults '', {}, [], 0, false, or do not set`
        }
    },
    create(context = {}) {
        const { sourceCode = {} } = context;
        const report = createReporter(context);
        const isExplicitUndefined = createExplicitUndefinedReader({ sourceCode });

        return createAssignmentValueListeners({ report, isValue: isExplicitUndefined, messageId: 'undefinedAssignment' });
    }
};
