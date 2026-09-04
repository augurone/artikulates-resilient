import { getEnclosingFunction, walk } from './contracts/infer.js';
import { getObject } from './support/object.js';

const isAssignmentPattern = ({ type = '' } = {}) => type === 'AssignmentPattern';

const isRestElement = ({ type = '' } = {}) => type === 'RestElement';

const isUseStateResult = ({ parent = {} } = {}) => {
    const {
        type = '',
        id = {},
        init = {}
    } = getObject(parent);
    const { type: idType = '' } = getObject(id);
    const {
        type: initType = '',
        callee = {}
    } = getObject(init);
    const {
        type: calleeType = '',
        name = ''
    } = getObject(callee);

    return (
        type === 'VariableDeclarator' &&
        idType === 'ArrayPattern' &&
        initType === 'CallExpression' &&
        calleeType === 'Identifier' &&
        name === 'useState'
    );
};

const isDirectlyInvoked = ({
    node: {
        value: {
            type: valueType = '',
            name: valueName = ''
        } = {},
        parent = {}
    } = {}
} = {}) => {
    if (valueType !== 'Identifier') return false;

    const functionNode = getEnclosingFunction({ parent });
    const { body: functionBody = {} } = functionNode;

    if (!functionBody) return false;

    let invoked = false;
    walk(functionBody, ({
        type = '',
        callee: {
            type: calleeType = '',
            name = ''
        } = {}
    } = {}) => {
        if (type === 'CallExpression' && calleeType === 'Identifier' && name === valueName) {
            invoked = true;
        }
    }, { skipFunctions: true });

    return invoked;
};

const reportMissingDefault = ({ node = {}, report } = {}) => {
    const { value: sourceValue = node, parent = {} } = getObject(node);
    const value = getObject(sourceValue);

    if (isAssignmentPattern(value) || isRestElement(value)) return;

    if (isDirectlyInvoked({ node: { value, parent } })) return;

    if (typeof report !== 'function') return;

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
            ArrayPattern({ elements = [], ...node } = {}) {
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
