import { getEnclosingFunction } from './support/ast-function.js';
import { getBinding, getBindingDefinition } from './support/lexical-binding.js';
import { getStaticPropertyName } from './support/member-chain.js';
import { getObject } from './support/object.js';
import { createReporter } from './support/reporter.js';

const isReduceCallback = ({ parent = {}, node = {} } = {}) => {
    const { type = '', callee = {}, arguments: [firstArgument = {}] = [] } = getObject(parent);
    const { type: calleeType = '', expression = {} } = getObject(callee);

    return type === 'CallExpression' && firstArgument === node &&
        getStaticPropertyName(calleeType === 'ChainExpression' ? expression : callee) === 'reduce';
};

const isReceiverOrCardinality = (node = {}) => {
    if (['length', 'size'].includes(getStaticPropertyName(node))) return true;

    const { parent = {} } = getObject(node);
    const { type: parentType = '', callee = {}, tag = false, object = {}, expression = false } = getObject(parent);

    if ((parentType === 'CallExpression' && callee === node) || (parentType === 'TaggedTemplateExpression' && tag === node)) return true;

    if (parentType === 'ChainExpression' && expression === node) return isReceiverOrCardinality(parent);

    return parentType === 'MemberExpression' && object === node && isReceiverOrCardinality(parent);
};

// A member access needs destructuring when its object is a parameter or local
// variable owned by a function, and the access is not a reducer accumulator,
// a cardinality check, or a receiver for a call (including a tagged template).
const requiresDestructuring = ({ node = {}, sourceCode = {} } = {}) => {
    const { object = {} } = getObject(node);
    const binding = getBinding({ sourceCode, node: object });
    const { type = '', node: declaration = {}, name: identifier = {} } = getBindingDefinition(binding);

    if (!['Parameter', 'Variable'].includes(type)) return false;

    const owner = type === 'Parameter' ? declaration : getEnclosingFunction(declaration);
    const { type: ownerType = '', parent = {}, params = [] } = getObject(owner);

    if (!ownerType) return false;

    const [parameter = {}] = params;
    const { type: parameterType = '', left = {} } = getObject(parameter);
    const firstBinding = parameterType === 'AssignmentPattern' ? left : parameter;

    if (type === 'Parameter' && firstBinding === identifier && isReduceCallback({ parent, node: owner }) &&
        getEnclosingFunction(node) === owner) return false;

    return !isReceiverOrCardinality(node);
};

export default {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Require static data from function parameters to be destructured',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/prefer-destructured-member-access.md'
        },
        schema: [],
        messages: {
            staticMember: 'Destructure bound data before accessing it.'
        }
    },
    create(context = {}) {
        const { sourceCode = {} } = context;
        const report = createReporter(context);

        return {
            MemberExpression(node = {}) {
                if (!requiresDestructuring({ node, sourceCode })) return;

                report({ node, messageId: 'staticMember' });
            }
        };
    }
};
