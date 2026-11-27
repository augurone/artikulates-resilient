import { getBinding, getBindingDefinition } from './support/lexical-binding.js';
import { createReporter } from './support/reporter.js';

const isPattern = ({ type = '' } = {}) => ['ObjectPattern', 'ArrayPattern'].includes(type);

const isOrExpression = ({ type = '', operator = '' } = {}) => (
    type === 'LogicalExpression' && operator === '||'
);

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Keep destructuring source contracts at their owning boundary',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-destructuring-fallback.md'
        },
        schema: [],
        messages: {
            destructuringFallback: 'Establish or consume the contract for {{owner}} at its owning boundary; use its default or guard instead of a local || destructuring fallback.'
        }
    },
    create(context = {}) {
        const { sourceCode = {} } = context;
        const report = createReporter(context);
        const check = (pattern, source = {}) => {
            if (!isPattern(pattern) || !source || !isOrExpression(source)) return;

            const { left = {} } = source;
            const { type = '', name = '' } = left;
            const { getScope } = type === 'Identifier' ? sourceCode : {};
            const definition = type === 'Identifier' && typeof getScope === 'function'
                ? getBindingDefinition(getBinding({ sourceCode, node: left })) : {};
            const { type: bindingType = '' } = definition;
            const owner = bindingType === 'Parameter' ? `parameter "${name}"` : 'the source';

            report({ node: source, messageId: 'destructuringFallback', data: { owner } });
        };

        return {
            VariableDeclarator: ({ id = {}, init = false } = {}) => check(id, init),
            AssignmentPattern: ({ left = {}, right = {} } = {}) => check(left, right),
            AssignmentExpression: ({ left = {}, right = {} } = {}) => check(left, right)
        };
    }
};
