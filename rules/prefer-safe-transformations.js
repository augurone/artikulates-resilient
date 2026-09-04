import { isCoveredByLoopRule } from './support/loop-analysis.js';
import { getObject } from './support/object.js';

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

const getRootIdentifier = ({ type = '', object = {}, expression = {}, ...node } = {}) => {
    if (type === 'ChainExpression') return getRootIdentifier(expression);

    if (type === 'MemberExpression') return getRootIdentifier(object);

    return type === 'Identifier' ? { type, ...node } : {};
};

const getStaticPropertyName = ({
    type = '',
    computed = false,
    property: {
        type: propertyType = '',
        name = ''
    } = {}
} = {}) => {
    if (type !== 'MemberExpression' || computed || propertyType !== 'Identifier') return '';

    return name;
};

const getMutationTarget = ({ node = {} } = {}) => {
    const {
        type = '',
        left = {},
        argument = {},
        callee = {},
        arguments: args = [],
        operator = ''
    } = getObject(node);
    const { type: leftType = '' } = getObject(left);
    const { type: argumentType = '' } = getObject(argument);
    const safeCallee = getObject(callee);
    const {
        type: calleeType = '',
        object: calleeObject = {}
    } = safeCallee;
    const {
        type: calleeObjectType = '',
        name: calleeObjectName = ''
    } = getObject(calleeObject);
    const [firstArgument = {}] = args;

    if (type === 'AssignmentExpression') return leftType === 'MemberExpression' ? left : {};

    if (type === 'UpdateExpression') return argumentType === 'MemberExpression' ? argument : {};

    if (type === 'UnaryExpression' && operator === 'delete') {
        return argumentType === 'MemberExpression' ? argument : {};
    }

    if (type !== 'CallExpression') return {};

    if (
        calleeType === 'MemberExpression' &&
        calleeObjectType === 'Identifier' &&
        calleeObjectName === 'Object' &&
        getStaticPropertyName(safeCallee) === 'assign'
    ) return firstArgument;

    const method = getStaticPropertyName(safeCallee);

    if (!MUTATING_METHODS.has(method)) return {};

    return safeCallee;
};

const getMutationProperty = ({
    type = '',
    left = {},
    argument = {},
    callee = {}
} = {}) => {
    if (type === 'AssignmentExpression') return getStaticPropertyName(left);

    if (type === 'UpdateExpression') return getStaticPropertyName(argument);

    if (type === 'UnaryExpression') return getStaticPropertyName(argument);

    return getStaticPropertyName(callee);
};

const isIgnored = ({ name = '', property = '', options = {} } = {}) => {
    const {
        ignoredParameters = [],
        ignoredBindings = [],
        ignoredProperties = []
    } = options;

    return (
        ignoredParameters.includes(name) ||
        ignoredBindings.includes(name) ||
        Boolean(property && ignoredProperties.includes(property))
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
            mutation: 'Prefer a safe transformation for "{{name}}"; return a new value instead of mutating it.'
        }
    },
    create({
        report = () => {},
        sourceCode = {},
        options: [options = {}] = []
    } = {}) {
        const reportMutation = (node = {}) => {
            const target = getMutationTarget({ node });
            const root = getRootIdentifier(target);
            const { name = '' } = root;

            if (!name) return;

            if (isCoveredByLoopRule({ sourceCode, node })) return;

            const property = getMutationProperty(node);

            if (isIgnored({ name, property, options })) return;

            report({
                node,
                messageId: 'mutation',
                data: { name }
            });
        };

        return {
            AssignmentExpression(node = {}) {
                reportMutation(node);
            },
            UpdateExpression: reportMutation,
            UnaryExpression: reportMutation,
            CallExpression: reportMutation
        };
    }
};
