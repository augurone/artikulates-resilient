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

const isReduceCallback = ({ parent = {}, node = {} } = {}) => {
    const {
        type = '',
        callee: {
            type: calleeType = '',
            property: {
                type: propertyType = '',
                name: propertyName = ''
            } = {},
            computed = false
        } = {},
        arguments: args = []
    } = parent;

    return (
        type === 'CallExpression' &&
        calleeType === 'MemberExpression' &&
        propertyType === 'Identifier' &&
        propertyName === 'reduce' &&
        !computed &&
        args[0] === node
    );
};

const isStaticMember = ({ type = '', computed = false, property = {} } = {}) => (
    type === 'MemberExpression' &&
    !computed &&
    property.type === 'Identifier'
);

const isLengthMember = ({ property: { name = '' } = {}, object = {} } = {}) => (
    name === 'length' && object.type === 'Identifier'
);

const isPrototypeMemberAccess = ({ node = {} } = {}) => {
    const { parent = {} } = node;
    if (parent.type === 'CallExpression' && parent.callee === node) return true;
    if (parent.type !== 'MemberExpression' || parent.object !== node) return false;
    const { property: { name = '' } = {} } = parent;
    if (name === 'length' || name === 'size') return true;
    return isPrototypeMemberAccess({ node: parent });
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
        const enterFunction = (node = {}) => {
            const { parent = {} } = node;
            const paramNames = getParamNames(node);

            functionStack.push({
                paramNames,
                reducerParamNames: isReduceCallback({ parent, node })
                    ? [paramNames[0]]
                    : []
            });
        };

        return {
            FunctionDeclaration: enterFunction,
            'FunctionDeclaration:exit': () => functionStack.pop(),
            FunctionExpression: enterFunction,
            'FunctionExpression:exit': () => functionStack.pop(),
            ArrowFunctionExpression: enterFunction,
            'ArrowFunctionExpression:exit': () => functionStack.pop(),
            MemberExpression(node = {}) {
                const {
                    object: {
                        type: objectType = '',
                        name: objectName = ''
                    } = {}
                } = node;
                const paramNames = getCurrentParamNames(functionStack);
                const currentFunction = functionStack.slice(-1)[0] || {};
                const reducerParamNames = currentFunction.reducerParamNames || [];

                if (!isStaticMember(node)) return;
                if (objectType !== 'Identifier' || !paramNames.includes(objectName)) return;
                if (reducerParamNames.includes(objectName)) return;
                if (isLengthMember(node) || isPrototypeMemberAccess({ node })) return;

                report({
                    node,
                    messageId: 'staticMember'
                });
            }
        };
    }
};
