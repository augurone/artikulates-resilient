import { getObject, isObject } from './object.js';

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

const getSimpleParams = ({ params = [] } = {}) => params
    .map((node = {}) => ({
        name: getParamName(node),
        node
    }))
    .filter(({ name = '' } = {}) => Boolean(name));

const getSourceText = ({ sourceCode = {}, node = {} } = {}) => {
    const { getText = false } = sourceCode;

    if (typeof getText !== 'function') return '';

    return getText.call(sourceCode, node);
};

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

const isNonReferenceIdentifier = ({ node = {} } = {}) => {
    const { parent = {} } = getObject(node);
    const {
        type = '',
        property = {},
        key = {},
        computed = false,
        label = {}
    } = getObject(parent);

    if (type === 'MemberExpression' && property === node && !computed) return true;

    if (type === 'Property' && key === node && !computed) return true;

    if (type === 'MethodDefinition' && key === node && !computed) return true;

    if (type === 'LabeledStatement' && label === node) return true;

    if (type === 'BreakStatement' && label === node) return true;

    if (type === 'ContinueStatement' && label === node) return true;

    return false;
};

const isDirectMemberRead = ({ node = {}, name = '' } = {}) => {
    const {
        type = '',
        object: {
            type: objectType = '',
            name: objectName = ''
        } = {}
    } = node;

    return type === 'MemberExpression' && objectType === 'Identifier' && objectName === name;
};

const isUnsafeMemberUse = ({ node = {} } = {}) => {
    const { parent = {} } = getObject(node);
    const {
        type = '',
        left = {},
        argument = {},
        operator = '',
        callee = {},
        tag = {}
    } = getObject(parent);

    return (
        (type === 'AssignmentExpression' && left === node) ||
        (type === 'UpdateExpression' && argument === node) ||
        (type === 'UnaryExpression' && operator === 'delete') ||
        (type === 'CallExpression' && callee === node) ||
        (type === 'TaggedTemplateExpression' && tag === node)
    );
};

const getStaticMemberName = ({ node = {} } = {}) => {
    const {
        computed = false,
        property: {
            type: propertyType = '',
            name: propertyName = ''
        } = {}
    } = node;

    if (computed || propertyType !== 'Identifier') return '';

    return propertyName;
};

const getStaticMemberProperties = ({
    node = {},
    name = '',
    excludedNodes = []
} = {}) => {
    const properties = new Set();
    const memberNodes = [];
    const wholeObjectNodes = [];
    let hasUnsafeReference = false;
    const visit = (currentNode = {}) => {
        if (!isObject(currentNode)) return;

        if (excludedNodes.includes(currentNode)) return;

        const directMemberRead = isDirectMemberRead({ node: currentNode, name });
        const staticMemberName = getStaticMemberName({ node: currentNode });

        if (directMemberRead && !staticMemberName) {
            hasUnsafeReference = true;
            // eslint-disable-next-line resilient/prefer-safe-transformations -- This private traversal index is intentionally append-only and never exposes mutable AST data.
            wholeObjectNodes.push(currentNode);

            return;
        }

        if (directMemberRead && isUnsafeMemberUse({ node: currentNode })) {
            hasUnsafeReference = true;

            return;
        }

        if (directMemberRead) {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- This private traversal index is intentionally append-only and never exposes mutable AST data.
            properties.add(staticMemberName);
            // eslint-disable-next-line resilient/prefer-safe-transformations -- This private traversal index is intentionally append-only and never exposes mutable AST data.
            memberNodes.push(currentNode);

            return;
        }

        const {
            type: currentType = '',
            name: currentName = ''
        } = currentNode;

        if (
            currentType === 'Identifier' &&
            currentName === name &&
            !isNonReferenceIdentifier({ node: currentNode })
        ) {
            hasUnsafeReference = true;
            // eslint-disable-next-line resilient/prefer-safe-transformations -- This private traversal index is intentionally append-only and never exposes mutable AST data.
            wholeObjectNodes.push(currentNode);

            return;
        }

        Object.entries(currentNode)
            .filter(([key = '']) => !['parent', 'loc', 'range', 'tokens', 'comments'].includes(key))
            .forEach(([, value = {}]) => {
                if (Array.isArray(value)) {
                    value.forEach((child = {}) => visit(child));

                    return;
                }

                visit(value);
            });
    };

    visit(node);

    return {
        properties: [...properties],
        memberNodes,
        hasUnsafeReference,
        wholeObjectNodes
    };
};

const hasWholeObjectReference = ({
    node = {},
    name = '',
    excludedNodes = [],
    afterNode: { range: [, afterEnd = 0] = [] } = {}
} = {}) => {
    const { wholeObjectNodes = [] } = getStaticMemberProperties({
        node,
        name,
        excludedNodes
    });

    return wholeObjectNodes.some((referenceNode = {}) => {
        const {
            parent = {},
            type = '',
            computed = false,
            range: [rangeStart = 0] = []
        } = getObject(referenceNode);
        const { type: parentType = '', init = {}, id = {} } = getObject(parent);
        const { type: idType = '' } = getObject(id);
        const isDestructuringInitializer = (
            parentType === 'VariableDeclarator' &&
            init === referenceNode &&
            idType === 'ObjectPattern'
        );
        const isDynamicMemberReference = type === 'MemberExpression' && computed;

        return !isDestructuringInitializer && (
            isDynamicMemberReference || rangeStart > afterEnd
        );
    });
};

const containsIdentifier = ({ node = {}, name = '' } = {}) => {
    if (!isObject(node)) return false;

    const source = getObject(node);
    const { type = '', parent = {}, name: nodeName = '' } = source;

    if (type !== 'Identifier') return Object.entries(source)
        .filter(([key = '']) => !['parent', 'loc', 'range', 'tokens', 'comments'].includes(key))
        .some(([, value = {}]) => (
            Array.isArray(value)
                ? value.some((child = {}) => containsIdentifier({ node: child, name }))
                : containsIdentifier({ node: value, name })
        ));

    const { type: parentType = '', object = {} } = getObject(parent);

    if (parentType === 'MemberExpression' && object === node) return false;

    return nodeName === name;
};

const getSourceStart = ({
    range: [start = undefined] = [],
    loc: { start: { line = 0, column = 0 } = {} } = {}
} = {}) => (
    start ?? (line * 100000 + column)
);

const getSourceEnd = ({
    range: [, end = undefined] = [],
    loc: { end: { line = 0, column = 0 } = {} } = {}
} = {}) => (
    end ?? (line * 100000 + column)
);

export {
    containsIdentifier,
    getParamName,
    getSimpleParamNames,
    getSimpleParams,
    getSourceEnd,
    getSourceStart,
    getSourceText,
    getStaticMemberName,
    getStaticMemberProperties,
    hasWholeObjectReference,
    isDestructuringFromParam
};
