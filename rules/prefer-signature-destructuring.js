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

const getSimpleParamNames = ({ params = [] } = {}) => params
    .map(getParamName)
    .filter(Boolean);

const isDestructuringFromParam = ({
    id: { type: idType = '' } = {},
    init: {
        type: initType = '',
        name: initName = ''
    } = {}
} = {}, paramNames = []) => (
    idType === 'ObjectPattern' &&
    initType === 'Identifier' &&
    paramNames.includes(initName)
);

const getCurrentFunction = (functionStack = []) => {
    const currentFunctions = functionStack.slice(-1);
    const [currentFunction = {}] = currentFunctions;

    return currentFunction;
};

const containsIdentifier = ({ node = {}, name = '' } = {}) => {
    if (!node || typeof node !== 'object') return false;
    if (node.type === 'Identifier') return node.name === name;

    return Object.entries(node)
        .filter(([key = '']) => !['parent', 'loc', 'range', 'tokens', 'comments'].includes(key))
        .some(([, value = {}]) => (
            Array.isArray(value)
                ? value.some((child = {}) => containsIdentifier({ node: child, name }))
                : containsIdentifier({ node: value, name })
        ));
};

const getSourceStart = ({ range = [], loc: { start: { line = 0, column = 0 } = {} } = {} } = {}) => (
    range[0] ?? (line * 100000 + column)
);

const getSourceEnd = ({ range = [], loc: { end: { line = 0, column = 0 } = {} } = {} } = {}) => (
    range[1] ?? (line * 100000 + column)
);

const isPassedLater = ({
    node = {},
    paramName = '',
    calls = []
} = {}) => calls.some(({ name = '', start = 0 } = {}) => (
    name === paramName && start > getSourceEnd(node)
));

const reportViolation = ({
    violation = {},
    calls = [],
    report = () => {}
} = {}) => {
    const {
        node = {},
        paramName = ''
    } = violation;

    if (isPassedLater({ node, paramName, calls })) return;

    report({
        node,
        messageId: 'preferSignature',
        data: {
            name: paramName
        }
    });
};

export default {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Prefer destructuring object parameters in the function signature',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/prefer-signature-destructuring.md'
        },
        schema: [],
        messages: {
            preferSignature: 'Destructure "{{name}}" in the function signature instead of inside the function body. ({val = ""} = {}) => vals'
        }
    },
    create({ report = () => {} } = {}) {
        const functionStack = [];
        const enterFunction = (node = {}) => {
            functionStack.push({
                paramNames: getSimpleParamNames(node),
                violations: [],
                calls: []
            });
        };
        const exitFunction = () => {
            const {
                violations = [],
                calls = []
            } = functionStack.pop() ?? {};

            violations.forEach((violation = {}) => reportViolation({
                violation,
                calls,
                report
            }));
        };

        return {
            FunctionDeclaration: enterFunction,
            'FunctionDeclaration:exit': exitFunction,
            FunctionExpression: enterFunction,
            'FunctionExpression:exit': exitFunction,
            ArrowFunctionExpression: enterFunction,
            'ArrowFunctionExpression:exit': exitFunction,
            CallExpression: (node = {}) => {
                const currentFunction = getCurrentFunction(functionStack);
                const {
                    paramNames = [],
                    calls = []
                } = currentFunction;

                paramNames.forEach((name = '') => {
                    if (!node.arguments.some((argument = {}) => containsIdentifier({ node: argument, name }))) return;
                    calls.push({
                        name,
                        start: getSourceStart(node)
                    });
                });
            },
            VariableDeclarator: (node = {}) => {
                const currentFunction = getCurrentFunction(functionStack);
                const {
                    paramNames = [],
                    violations = []
                } = currentFunction;
                const {
                    id = {},
                    init = {}
                } = node;
                const safeInit = init ?? {};
                const {
                    name: paramName = ''
                } = safeInit;

                if (!isDestructuringFromParam({ id, init: safeInit }, paramNames)) return;
                violations.push({
                    node: id,
                    paramName
                });
            }
        };
    }
};
