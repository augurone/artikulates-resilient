const getParamName = ({
    type = '',
    name = '',
    left: {
        type: leftType = '',
        name: leftName = ''
    } = {}
} = {}) => {
    if (type === 'Identifier') return name;
    if (type !== 'AssignmentPattern') return '';
    if (leftType !== 'Identifier') return '';
    return leftName;
};

const getParamNames = ({ params = [] } = {}) => params
    .map(getParamName)
    .filter(Boolean);

const getCurrentParamNames = (functionStack = []) => functionStack
    .flatMap(({ paramNames = [] } = {}) => paramNames);

const isStaticMember = ({ type = '', computed = false, property = {} } = {}) => (
    type === 'MemberExpression' &&
    !computed &&
    property.type === 'Identifier'
);

const isLengthMember = ({ property: { name = '' } = {}, object = {} } = {}) => (
    name === 'length' && object.type === 'Identifier'
);

const isPrototypeMethodCall = ({ node = {} } = {}) => {
    const { parent = {} } = node;
    return parent.type === 'CallExpression' && parent.callee === node;
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
            staticMember: 'Destructure static parameter data before accessing it.'
        }
    },
    create({ report = () => {} } = {}) {
        const functionStack = [];

        return {
            FunctionDeclaration: (node = {}) => functionStack.push({
                paramNames: getParamNames(node)
            }),
            'FunctionDeclaration:exit': () => functionStack.pop(),
            FunctionExpression: (node = {}) => functionStack.push({
                paramNames: getParamNames(node)
            }),
            'FunctionExpression:exit': () => functionStack.pop(),
            ArrowFunctionExpression: (node = {}) => functionStack.push({
                paramNames: getParamNames(node)
            }),
            'ArrowFunctionExpression:exit': () => functionStack.pop(),
            MemberExpression(node = {}) {
                const {
                    object: {
                        type: objectType = '',
                        name: objectName = ''
                    } = {}
                } = node;
                const paramNames = getCurrentParamNames(functionStack);

                if (!isStaticMember(node)) return;
                if (objectType !== 'Identifier' || !paramNames.includes(objectName)) return;
                if (isLengthMember(node) || isPrototypeMethodCall({ node })) return;

                report({
                    node,
                    messageId: 'staticMember'
                });
            }
        };
    }
};
