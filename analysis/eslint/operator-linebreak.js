import { builtinRules } from 'eslint/use-at-your-own-risk';

const base = builtinRules.get('operator-linebreak');

export default {
    meta: {
        type: 'layout',
        docs: {
            description: 'Enforce operator placement while preserving initializer-leading comments',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/operator-linebreak.md'
        },
        schema: base.meta.schema,
        defaultOptions: [null, {}],
        fixable: base.meta.fixable,
        messages: base.meta.messages
    },
    create(context) {
        const { sourceCode = {}, options = [] } = context;
        const [style = 'after', { overrides = {} } = {}] = options;
        const { '=': assignmentStyle = style } = overrides;
        const listeners = base.create(context);

        return {
            ...listeners,
            VariableDeclarator(node) {
                const { init = false } = node;

                if (!init || assignmentStyle !== 'before') {
                    listeners.VariableDeclarator(node);

                    return;
                }

                const operator = sourceCode.getTokenBefore(init, ({ value = '' } = {}) => value === '=');
                const { loc: { start: { line: operatorLine = 0 } = {}, end: { line: operatorEnd = 0 } = {} } = {} } = operator;
                const { loc: { end: { line: leftLine = 0 } = {} } = {} } = sourceCode.getTokenBefore(operator);
                const { loc: { start: { line: rightLine = 0 } = {} } = {} } = sourceCode.getTokenAfter(operator);
                const comments = sourceCode.getCommentsAfter(operator);

                // Preserve the authored initializer anchor, including directives.
                // Parentheses are executable tokens, so comments inside them do not qualify.
                if (leftLine === operatorLine && operatorEnd < rightLine && comments.length) return;

                listeners.VariableDeclarator(node);
            }
        };
    }
};
