import { append } from '../collections.js';
import { patternChildren } from '../estree-patterns.js';
import { propertyName } from '../estree-properties.js';
import { traverse } from '../traversal.js';
import { createReporter } from './support/reporter.js';

const MUTATING_METHODS = new Set([
    'add',
    'clear',
    'copyWithin',
    'delete',
    'fill',
    'pop',
    'push',
    'reverse',
    'set',
    'shift',
    'sort',
    'splice',
    'unshift'
]);

const getRootName = (node) => {
    const names = [];

    traverse(node, { enter: ({ type = '', object = {}, expression = {}, name = '' } = {}) => {
        if (type === 'ChainExpression') return [expression];

        if (type === 'MemberExpression') return [object];

        if (type === 'Identifier') append(names, name);

        return [];
    } });

    return names.at(0) || '';
};

const memberProperty = ({ type = '', computed = false, property = {} } = {}) => {
    if (type !== 'MemberExpression') return {};

    return propertyName({ computed, key: property });
};

const getMutation = ({ type = '', argument = {}, callee = {}, tag = {}, arguments: args = [], operator = '' } = {}) => {
    const { type: argumentType = '', expression: argumentExpression = {} } = argument;
    const operand = argumentType === 'ChainExpression' ? argumentExpression : argument;
    const { type: operandType = '' } = operand;

    if ((type === 'UpdateExpression' || (type === 'UnaryExpression' && operator === 'delete')) && operandType === 'MemberExpression') {
        return { target: operand, property: memberProperty(operand) };
    }

    if (!['CallExpression', 'TaggedTemplateExpression'].includes(type)) return {};

    const invoked = type === 'TaggedTemplateExpression' ? tag : callee;
    const { type: calleeType = '', expression = {} } = invoked;
    const member = calleeType === 'ChainExpression' ? expression : invoked;
    const { object: { type: objectType = '', name = '' } = {} } = member;
    const property = memberProperty(member);
    const { name: method = '' } = property;

    if (type === 'CallExpression' && objectType === 'Identifier' && name === 'Object' && method === 'assign') {
        const [target = {}] = args;
        const { type: targetType = '' } = target;

        return ['ObjectExpression', 'ArrayExpression'].includes(targetType) ? {} : { target, property };
    }

    return MUTATING_METHODS.has(method) ? { target: member, property } : {};
};

const isIgnored = ({ name = '', property: { known = false, name: key = '' } = {}, options = {} } = {}) => {
    const {
        ignoredParameters = [],
        ignoredBindings = [],
        ignoredProperties = []
    } = options;

    return (
        (Boolean(name) && (
            ignoredParameters.includes(name) ||
            ignoredBindings.includes(name)
        )) ||
        (known && ignoredProperties.includes(key))
    );
};

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Prefer new values over in-place object and array mutation',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/prefer-safe-transformations.md'
        },
        defaultOptions: [{}],
        schema: [{
            type: 'object',
            properties: {
                ignoredParameters: {
                    description: 'Parameter names that are allowed to be mutated',
                    type: 'array',
                    items: { type: 'string' }
                },
                ignoredBindings: {
                    description: 'Binding names that are allowed to be mutated',
                    type: 'array',
                    items: { type: 'string' }
                },
                ignoredProperties: {
                    description: 'Property names that are allowed to be mutated',
                    type: 'array',
                    items: { type: 'string' }
                }
            },
            additionalProperties: false
        }],
        messages: {
            mutation: 'Prefer a safe transformation for "{{name}}"; return a new value instead of mutating it.',
            unnamedMutation: 'Prefer a safe transformation for this value; return a new value instead of mutating it.'
        }
    },
    create(context = {}) {
        const { options: [options = {}] = [] } = context;
        const report = createReporter(context);

        const reportTarget = ({ node = {}, target = {}, property = {} } = {}) => {
            const { type: targetType = '' } = target;

            if (!targetType) return;

            const name = getRootName(target);

            if (isIgnored({ name, property, options })) return;

            report({
                node,
                messageId: name ? 'mutation' : 'unnamedMutation',
                ...(name ? { data: { name } } : {})
            });
        };
        const reportMutation = node => reportTarget({ node, ...getMutation(node) });
        const reportPattern = (node = {}) => {
            const { type: ownerType = '', left = {} } = node;

            traverse(left, { enter: (target = {}) => {
                const { type = '' } = target;

                if (type === 'MemberExpression') reportTarget({ node: target === left && ownerType === 'AssignmentExpression' ? node : target, target, property: memberProperty(target) });

                return patternChildren(target);
            } });
        };

        return {
            AssignmentExpression: reportPattern,
            ForInStatement: reportPattern,
            ForOfStatement: reportPattern,
            UpdateExpression: reportMutation,
            UnaryExpression: reportMutation,
            CallExpression: reportMutation,
            TaggedTemplateExpression: reportMutation
        };
    }
};
