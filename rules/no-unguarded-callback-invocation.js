import { getObject, hasObjectValue } from './support/object.js';

const FUNCTION_TYPES = new Set([
    'ArrowFunctionExpression',
    'FunctionDeclaration',
    'FunctionExpression'
]);

const isFunctionNode = ({ type = '' } = {}) => FUNCTION_TYPES.has(type);

const getObjectPattern = ({ type = '', left = {}, ...node } = {}) => (
    type === 'AssignmentPattern' ? getObject(left) : { type, left, ...node }
);

const getOptionalCallbackNames = ({ params = [] } = {}) => new Set(
    params
        .map(parameter => getObjectPattern(getObject(parameter)))
        .filter((pattern) => {
            const { type = '' } = getObject(pattern);

            return type === 'ObjectPattern';
        })
        .flatMap((pattern) => {
            const { properties = [] } = getObject(pattern);

            return properties;
        })
        .filter((property) => {
            const { type = '', value = {} } = getObject(property);
            const { type: valueType = '' } = getObject(value);

            return type === 'Property' && valueType === 'Identifier';
        })
        .map((property) => {
            const { value = {} } = getObject(property);
            const { name = '' } = getObject(value);

            return name;
        })
        .filter(Boolean)
);

const getParents = ({ node = {}, parents = [] } = {}) => {
    const { parent = {} } = getObject(node);

    if (!hasObjectValue(parent)) return parents;

    return getParents({ node: parent, parents: [...parents, parent] });
};

const contains = ({ node = {}, target = {} } = {}) => {
    if (target === node) return true;

    const { parent = {} } = getObject(target);

    if (!hasObjectValue(parent)) return false;

    return contains({ node, target: parent });
};

const isIdentifier = ({ node: { type = '', name: nodeName = '' } = {}, name = '' } = {}) => (
    type === 'Identifier' && nodeName === name
);

const isFunctionTypeTest = ({ node = {}, name = '' } = {}) => {
    const { type = '', operator = '', left = {}, right = {} } = getObject(node);
    const isTypeof = ({ node: value = {} } = {}) => {
        const { type: valueType = '', operator: valueOperator = '', argument = {} } = getObject(value);

        return valueType === 'UnaryExpression' && valueOperator === 'typeof' &&
            isIdentifier({ node: argument, name });
    };
    const isFunctionLiteral = ({ node: value = {} } = {}) => {
        const { type: valueType = '', value: literalValue = '' } = getObject(value);

        return valueType === 'Literal' && literalValue === 'function';
    };

    return type === 'BinaryExpression' && ['===', '=='].includes(operator) &&
        ((isTypeof({ node: left }) && isFunctionLiteral({ node: right })) ||
            (isTypeof({ node: right }) && isFunctionLiteral({ node: left })));
};

const isFunctionGuard = ({ node = {}, name = '' } = {}) => {
    const {
        type = '',
        operator = '',
        left = {},
        right = {},
        callee = {},
        arguments: args = []
    } = getObject(node);
    const [firstArgument = {}] = args;

    if (type === 'CallExpression' && isIdentifier({ node: callee, name: 'isFunction' }) &&
        isIdentifier({ node: firstArgument, name })) return true;

    if (isFunctionTypeTest({ node, name })) return true;

    if (type !== 'LogicalExpression' || operator !== '&&') return false;

    return isFunctionGuard({ node: left, name }) || isFunctionGuard({ node: right, name });
};

const isNegatedFunctionGuard = ({ node = {}, name = '' } = {}) => {
    const { type = '', operator = '', argument = {}, left = {}, right = {} } = getObject(node);

    if (type === 'UnaryExpression' && operator === '!') return isFunctionGuard({ node: argument, name });

    if (type !== 'BinaryExpression' || !['!==', '!='].includes(operator)) return false;

    const isTypeof = ({ node: value = {} } = {}) => {
        const {
            type: valueType = '',
            operator: valueOperator = '',
            argument: valueArgument = {}
        } = getObject(value);

        return valueType === 'UnaryExpression' && valueOperator === 'typeof' &&
            isIdentifier({ node: valueArgument, name });
    };
    const isFunctionLiteral = ({ node: value = {} } = {}) => {
        const { type: valueType = '', value: literalValue = '' } = getObject(value);

        return valueType === 'Literal' && literalValue === 'function';
    };

    return (isTypeof({ node: left }) && isFunctionLiteral({ node: right })) ||
        (isTypeof({ node: right }) && isFunctionLiteral({ node: left }));
};

const isExiting = ({ node = {} } = {}) => {
    const { type = '', body = [] } = getObject(node);

    if (['ReturnStatement', 'ThrowStatement', 'BreakStatement', 'ContinueStatement'].includes(type)) return true;

    if (type !== 'BlockStatement') return false;

    const [lastStatement = {}] = body.slice(-1);

    return Boolean(body.length) && isExiting({ node: lastStatement });
};

const isGuardedByEarlyExit = ({ node = {}, name = '' } = {}) => {
    const blocks = getParents({ node }).filter((parent) => {
        const { type = '' } = getObject(parent);

        return type === 'BlockStatement';
    });

    return blocks.some((block) => {
        const { body = [] } = getObject(block);
        const statementIndex = body.findIndex(statement => contains({ node: statement, target: node }));

        if (statementIndex < 1) return false;

        return body.slice(0, statementIndex).some((statement) => {
            const { type = '', test = {}, consequent = {} } = getObject(statement);

            return type === 'IfStatement' && isNegatedFunctionGuard({ node: test, name }) &&
                isExiting({ node: consequent });
        });
    });
};

const isGuardedInvocation = ({ node = {}, name = '', rootNode = node } = {}) => {
    const { parent = {} } = getObject(node);

    if (!hasObjectValue(parent)) return isGuardedByEarlyExit({ node: rootNode, name });

    const { type = '', operator = '', right = {}, consequent = {}, test = {}, left = {} } = getObject(parent);

    if (type === 'LogicalExpression' && operator === '&&' && contains({ node: right, target: node }) &&
        isFunctionGuard({ node: left, name })) return true;

    if (type === 'IfStatement' && contains({ node: consequent, target: node }) &&
        isFunctionGuard({ node: test, name })) return true;

    if (type === 'ConditionalExpression' && contains({ node: consequent, target: node }) &&
        isFunctionGuard({ node: test, name })) return true;

    return isGuardedInvocation({ node: parent, name, rootNode });
};

const getOptionalOwner = ({ node = {}, name = '' } = {}) => getParents({ node })
    .filter(isFunctionNode)
    .find(functionNode => getOptionalCallbackNames(functionNode).has(name));

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Require guards before invoking optional destructured callbacks',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-unguarded-callback-invocation.md'
        },
        schema: [],
        messages: {
            unguarded: 'Guard optional callback {{name}} with isFunction(...) or a typeof function check before invoking it.'
        }
    },
    create({ report = () => {} } = {}) {
        return {
            CallExpression(node = {}) {
                const { callee = {} } = node;
                const { type = '', name = '' } = getObject(callee);

                if (type !== 'Identifier') return;

                if (!name || !getOptionalOwner({ node, name }) ||
                    isGuardedInvocation({ node, name })) return;

                report({ node, messageId: 'unguarded', data: { name } });
            }
        };
    }
};
