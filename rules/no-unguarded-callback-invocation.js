/* eslint-disable prefer-destructuring, resilient/prefer-destructured-member-access,
    resilient/prefer-prototype-methods, resilient/prefer-signature-destructuring --
    This rule inspects raw ESTree nodes to enforce a source-level callback contract. */

const FUNCTION_TYPES = new Set([
    'ArrowFunctionExpression',
    'FunctionDeclaration',
    'FunctionExpression'
]);

const isFunctionNode = ({ type = '' } = {}) => FUNCTION_TYPES.has(type);

const getObjectPattern = (parameter = {}) => (
    parameter.type === 'AssignmentPattern' ? parameter.left : parameter
);

const getOptionalCallbackNames = ({ params = [] } = {}) => new Set(
    params
        .map(getObjectPattern)
        .filter(({ type = '' } = {}) => type === 'ObjectPattern')
        .flatMap(({ properties = [] } = {}) => properties)
        .filter(({ type = '', value = {} } = {}) => (
            type === 'Property' && value.type === 'Identifier'
        ))
        .map(({ value: { name = '' } = {} } = {}) => name)
        .filter(Boolean)
);

const getParents = (node = {}) => {
    const parents = [];
    let current = node.parent;
    while (current) {
        parents.push(current);
        current = current.parent;
    }
    return parents;
};

const contains = (node = {}, target = {}) => {
    let current = target;
    while (current) {
        if (current === node) return true;
        current = current.parent;
    }
    return false;
};

const isIdentifier = (node = {}, name = '') => (
    node.type === 'Identifier' && node.name === name
);

const isFunctionTypeTest = (node = {}, name = '') => {
    const {
        type = '',
        operator = '',
        left = {},
        right = {}
    } = node;
    const isTypeof = (value = {}) => (
        value.type === 'UnaryExpression' &&
        value.operator === 'typeof' &&
        isIdentifier(value.argument, name)
    );
    const isFunctionLiteral = (value = {}) => (
        value.type === 'Literal' && value.value === 'function'
    );
    return type === 'BinaryExpression' &&
        ['===', '=='].includes(operator) &&
        ((isTypeof(left) && isFunctionLiteral(right)) ||
            (isTypeof(right) && isFunctionLiteral(left)));
};

const isFunctionGuard = (node = {}, name = '') => {
    const { arguments: args = [] } = node;
    const [firstArgument = {}] = args;
    if (node.type === 'CallExpression' &&
        isIdentifier(node.callee, 'isFunction') &&
        isIdentifier(firstArgument, name)) return true;
    if (isFunctionTypeTest(node, name)) return true;
    if (node.type !== 'LogicalExpression' || node.operator !== '&&') return false;
    return isFunctionGuard(node.left, name) || isFunctionGuard(node.right, name);
};

const isNegatedFunctionGuard = (node = {}, name = '') => {
    if (node.type === 'UnaryExpression' && node.operator === '!') {
        return isFunctionGuard(node.argument, name);
    }
    if (node.type !== 'BinaryExpression' || !['!==', '!='].includes(node.operator)) return false;
    const left = node.left || {};
    const right = node.right || {};
    const isTypeof = (value = {}) => (
        value.type === 'UnaryExpression' &&
        value.operator === 'typeof' &&
        isIdentifier(value.argument, name)
    );
    const isFunctionLiteral = (value = {}) => (
        value.type === 'Literal' && value.value === 'function'
    );
    return (isTypeof(left) && isFunctionLiteral(right)) ||
        (isTypeof(right) && isFunctionLiteral(left));
};

const isExiting = (node = {}) => {
    if (['ReturnStatement', 'ThrowStatement', 'BreakStatement', 'ContinueStatement'].includes(node.type)) {
        return true;
    }
    if (node.type !== 'BlockStatement') return false;
    const statements = node.body || [];
    return Boolean(statements.length) && isExiting(statements.at(-1));
};

const isGuardedByEarlyExit = (node = {}, name = '') => {
    const parents = getParents(node);
    const blocks = parents.filter(({ type = '' } = {}) => type === 'BlockStatement');
    return blocks.some((block = {}) => {
        const statements = block.body || [];
        const statementIndex = statements.findIndex(statement => contains(statement, node));
        if (statementIndex < 1) return false;
        return statements.slice(0, statementIndex).some(statement => (
            statement.type === 'IfStatement' &&
            isNegatedFunctionGuard(statement.test, name) &&
            isExiting(statement.consequent)
        ));
    });
};

const isGuardedInvocation = (node = {}, name = '') => {
    let current = node;
    while (current.parent) {
        const parent = current.parent;
        if (parent.type === 'LogicalExpression' &&
            parent.operator === '&&' &&
            contains(parent.right, node) &&
            isFunctionGuard(parent.left, name)) return true;
        if (parent.type === 'IfStatement' &&
            contains(parent.consequent, node) &&
            isFunctionGuard(parent.test, name)) return true;
        if (parent.type === 'ConditionalExpression' &&
            contains(parent.consequent, node) &&
            isFunctionGuard(parent.test, name)) return true;
        current = parent;
    }
    return isGuardedByEarlyExit(node, name);
};

const getOptionalOwner = (node = {}, name = '') => {
    const functions = getParents(node).filter(isFunctionNode);
    return functions.find((functionNode = {}) => (
        getOptionalCallbackNames(functionNode).has(name)
    ));
};

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
                if (callee.type !== 'Identifier') return;
                const { name = '' } = callee;
                if (!name || !getOptionalOwner(node, name) || isGuardedInvocation(node, name)) return;

                report({
                    node,
                    messageId: 'unguarded',
                    data: { name }
                });
            }
        };
    }
};
