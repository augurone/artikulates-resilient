const isDestructuringFromParam = (
    {
        type: nodeType = '',
        id: { type: idType = '' } = {},
        init: { type: initType = '', name: initName = '' } = {}
    } = {},
    paramName = ''
) => (
    nodeType === 'VariableDeclarator' &&
    idType === 'ObjectPattern' &&
    initType === 'Identifier' &&
    initName === paramName
);

const visitNode = (node = {}, onVariableDeclaration = () => {}) => {
    const {
        type = '',
        declarations = [],
        body = null,
        consequent = null,
        alternate = null,
        expression = null,
        argument = null
    } = node;

    if (type === 'VariableDeclaration') {
        onVariableDeclaration(declarations);
    }

    if (Array.isArray(body)) {
        body.forEach(child => visitNode(child, onVariableDeclaration));
    } else if (body) {
        visitNode(body, onVariableDeclaration);
    }

    if (consequent) visitNode(consequent, onVariableDeclaration);
    if (alternate) visitNode(alternate, onVariableDeclaration);
    if (expression) visitNode(expression, onVariableDeclaration);
    if (argument) visitNode(argument, onVariableDeclaration);
};

const findViolations = (body = {}, paramNames = []) => {
    const violations = [];

    visitNode(body, (declarations) => {
        declarations.forEach((declaration) => {
            paramNames.forEach((paramName) => {
                if (!isDestructuringFromParam(declaration, paramName)) return;
                violations.push({
                    node: declaration,
                    paramName
                });
            });
        });
    });

    return violations;
};

const checkFunction = (
    { params = [], body = {} } = {},
    context = {}
) => {
    const { report = () => {} } = context;
    const simpleParams = params
        .filter(({ type = '' } = {}) => type === 'Identifier')
        .map(({ name = '' } = {}) => name)
        .filter(Boolean);

    if (!simpleParams.length) return;

    const violations = findViolations(body, simpleParams);

    violations.forEach(({ node, paramName }) => {
        report({
            node,
            messageId: 'preferSignature',
            data: {
                name: paramName
            }
        });
    });
};

export default {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Prefer destructuring object parameters in the function signature'
        },
        schema: [],
        messages: {
            preferSignature: 'Destructure "{{name}}" in the function signature instead of inside the function body.'
        }
    },
    create(context = {}) {
        return {
            FunctionDeclaration: node => checkFunction(node, context),
            FunctionExpression: node => checkFunction(node, context),
            ArrowFunctionExpression: node => checkFunction(node, context)
        };
    }
};
