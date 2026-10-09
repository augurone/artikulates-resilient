import { append } from '../collections.js';
import { traverse } from '../traversal.js';
import { createReporter } from './support/reporter.js';

const hasMeaningfulStatement = (block) => {
    const statements = [];

    traverse(block, { enter: (node = {}) => {
        if (statements.length) return [];

        const { type = '' } = node;
        const { body = [] } = ['BlockStatement', 'LabeledStatement'].includes(type) ? node : {};

        if (type === 'BlockStatement') return body;

        if (type === 'LabeledStatement') return [body];

        if (type !== 'EmptyStatement') append(statements, true);

        return [];
    } });

    return Boolean(statements.length);
};

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow catch blocks that silently discard failures',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-silent-catch.md'
        },
        schema: [],
        messages: {
            silentCatch: 'Handle, translate, rethrow, or explicitly return from this catch block; do not silently discard the failure.'
        }
    },
    create(context = {}) {
        const report = createReporter(context);

        return {
            CatchClause({ body = {} } = {}) {
                const { type: bodyType = '' } = body;

                if (bodyType !== 'BlockStatement' || hasMeaningfulStatement(body)) return;

                report({
                    node: body,
                    messageId: 'silentCatch'
                });
            }
        };
    }
};
