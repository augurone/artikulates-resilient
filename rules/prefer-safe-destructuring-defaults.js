import { getEnclosingFunction, walk } from './contracts/infer.js';

const isAssignmentPattern = ({ type = '' } = {}) => type === 'AssignmentPattern';

const isRestElement = ({ type = '' } = {}) => type === 'RestElement';

const isUseStateResult = ({ parent = {} } = {}) => {
    const {
        type = '',
        id = {},
        init: {
            type: initType = '',
            callee: {
                type: calleeType = '',
                name = ''
            } = {}
        } = {}
    } = parent;

    return (
        type === 'VariableDeclarator' &&
        id.type === 'ArrayPattern' &&
        initType === 'CallExpression' &&
        calleeType === 'Identifier' &&
        name === 'useState'
    );
};

const isDirectlyInvoked = ({ node = {} } = {}) => {
    const { value = {} } = node;
    if (value.type !== 'Identifier') return false;

    const functionNode = getEnclosingFunction({ parent: node.parent });
    if (!functionNode.body) return false;

    let invoked = false;
    walk(functionNode.body, ({
        type = '',
        callee: {
            type: calleeType = '',
            name = ''
        } = {}
    } = {}) => {
        if (type === 'CallExpression' && calleeType === 'Identifier' && name === value.name) {
            invoked = true;
        }
    }, { skipFunctions: true });
    return invoked;
};

const reportMissingDefault = ({ node = {}, report = () => {} } = {}) => {
    if (!node) return;
    const { value = node } = node;
    if (isAssignmentPattern(value) || isRestElement(value)) return;
    if (isDirectlyInvoked({ node })) return;

    report({
        node: value,
        messageId: 'safeDefault'
    });
};

export default {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Require explicit defaults for destructured values',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/prefer-safe-destructuring-defaults.md'
        },
        schema: [],
        messages: {
            safeDefault: 'Provide an explicit default for this destructured value.'
        }
    },
    create({ report = () => {} } = {}) {
        return {
            'ObjectPattern > Property': (node = {}) => {
                reportMissingDefault({
                    node,
                    report
                });
            },
            ArrayPattern(node = {}) {
                const { elements = [] } = node;
                if (isUseStateResult(node)) return;

                elements
                    .filter(Boolean)
                    .forEach((element = {}) => reportMissingDefault({
                        node: element,
                        report
                    }));
            }
        };
    }
};
