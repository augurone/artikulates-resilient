import { append, takeLast } from '../collections.js';
import { createReporter } from './support/reporter.js';

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow nested if statements',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-nested-if.md'
        },
        schema: [],
        messages: {
            nestedIf: 'Flatten nested if statements with guard clauses and early returns.'
        }
    },
    create(context = {}) {
        const report = createReporter(context);
        const boundaries = [];
        const leave = () => takeLast(boundaries);

        return {
            ':function': () => append(boundaries, false),
            ':function:exit': leave,
            IfStatement(node = {}) {
                if (boundaries.at(-1)) report({ node, messageId: 'nestedIf' });

                append(boundaries, true);
            },
            'IfStatement:exit': leave
        };
    }
};
