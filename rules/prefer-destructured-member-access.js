import { getObject, hasObjectValue } from './support/object.js';

const getBindingNames = (pattern = {}) => {
    const source = getObject(pattern);

    if (!hasObjectValue(source)) return [];

    const {
        type = '',
        name = '',
        left = {},
        argument = {},
        properties = [],
        elements = [],
        value = {}
    } = source;

    if (type === 'Identifier') return name ? [name] : [];

    if (type === 'AssignmentPattern') return getBindingNames(left);

    if (type === 'RestElement') return getBindingNames(argument);

    if (type === 'Property') return getBindingNames(value);

    if (type === 'ObjectPattern') return properties.flatMap(getBindingNames);

    if (type === 'ArrayPattern') return elements.flatMap(getBindingNames);

    return [];
};

const getParamNames = ({ params = [] } = {}) => params.flatMap(getBindingNames);

const getCurrentBindingNames = (functionStack = []) => functionStack
    .flatMap(({ paramNames = [], localNames = [] } = {}) => [...paramNames, ...localNames]);

const isReduceCallback = ({ parent = {}, node = {} } = {}) => {
    const {
        type = '',
        callee = {},
        arguments: sourceArguments = []
    } = getObject(parent);
    const {
        type: calleeType = '',
        property = {},
        computed = false
    } = getObject(callee);
    const { type: propertyType = '', name: propertyName = '' } = getObject(property);
    const args = Array.isArray(sourceArguments) ? sourceArguments : [];
    const [firstArgument = {}] = args;

    return (
        type === 'CallExpression' &&
        calleeType === 'MemberExpression' &&
        propertyType === 'Identifier' &&
        propertyName === 'reduce' &&
        !computed &&
        firstArgument === node
    );
};

const isMemberAccess = ({ type = '' } = {}) => type === 'MemberExpression';

const isLengthMember = (node = {}) => {
    const { property = {}, object = {} } = getObject(node);
    const { name = '' } = getObject(property);
    const { type: objectType = '' } = getObject(object);

    return ['length', 'size'].includes(name) && objectType === 'Identifier';
};

const isPrototypeMemberAccess = ({ node = {} } = {}) => {
    const { parent = {} } = getObject(node);
    const {
        type: parentType = '',
        callee = {},
        object = {},
        property = {}
    } = getObject(parent);

    if (parentType === 'CallExpression' && callee === node) return true;

    if (parentType !== 'MemberExpression' || object !== node) return false;

    const { name = '' } = getObject(property);

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
            staticMember: 'Destructure bound data before accessing it.'
        }
    },
    create({ report = () => {} } = {}) {
        let functionStack = [];
        const enterFunction = (node = {}) => {
            const { parent = {} } = getObject(node);
            const paramNames = getParamNames(getObject(node));
            const [firstParamName = ''] = paramNames;

            functionStack = [...functionStack, {
                paramNames,
                localNames: [],
                reducerParamNames: isReduceCallback({ parent, node })
                    ? [firstParamName]
                    : []
            }];
        };

        const exitFunction = () => {
            functionStack = functionStack.slice(0, -1);
        };

        const addLocalBindings = (node = {}) => {
            const [currentFunction = {}] = functionStack.slice(-1);

            if (!hasObjectValue(currentFunction)) return;

            const { id = {} } = getObject(node);
            const { localNames: currentLocalNames = [] } = currentFunction;
            const localNames = [...new Set([
                ...(Array.isArray(currentLocalNames) ? currentLocalNames : []),
                ...getBindingNames(id)
            ])];
            functionStack = [
                ...functionStack.slice(0, -1),
                { ...currentFunction, localNames }
            ];
        };

        return {
            FunctionDeclaration: enterFunction,
            'FunctionDeclaration:exit': exitFunction,
            FunctionExpression: enterFunction,
            'FunctionExpression:exit': exitFunction,
            ArrowFunctionExpression: enterFunction,
            'ArrowFunctionExpression:exit': exitFunction,
            VariableDeclarator: addLocalBindings,
            MemberExpression(node = {}) {
                const {
                    object = {}
                } = getObject(node);
                const { type: objectType = '', name: objectName = '' } = getObject(object);
                const bindingNames = getCurrentBindingNames(functionStack);
                const [currentFunction = {}] = functionStack.slice(-1);
                const { reducerParamNames: currentReducerParamNames = [] } = currentFunction;
                const reducerParamNames = Array.isArray(currentReducerParamNames)
                    ? currentReducerParamNames
                    : [];

                if (!isMemberAccess(node)) return;

                if (objectType !== 'Identifier' || !bindingNames.includes(objectName)) return;

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
