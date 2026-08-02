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
    if (typeof sourceCode.getText !== 'function') return '';
    return sourceCode.getText(node);
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
    const { parent = {} } = node;
    if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return true;
    if (parent.type === 'Property' && parent.key === node && !parent.computed) return true;
    if (parent.type === 'MethodDefinition' && parent.key === node && !parent.computed) return true;
    if (parent.type === 'LabeledStatement' && parent.label === node) return true;
    if (parent.type === 'BreakStatement' && parent.label === node) return true;
    if (parent.type === 'ContinueStatement' && parent.label === node) return true;
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
    const { parent = {} } = node;

    return (
        (parent.type === 'AssignmentExpression' && parent.left === node) ||
        (parent.type === 'UpdateExpression' && parent.argument === node) ||
        (parent.type === 'UnaryExpression' && parent.operator === 'delete') ||
        (parent.type === 'CallExpression' && parent.callee === node) ||
        (parent.type === 'TaggedTemplateExpression' && parent.tag === node)
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
        if (!currentNode || typeof currentNode !== 'object') return;
        if (excludedNodes.includes(currentNode)) return;
        const directMemberRead = isDirectMemberRead({ node: currentNode, name });
        const staticMemberName = getStaticMemberName({ node: currentNode });

        if (
            directMemberRead &&
            (!staticMemberName || isUnsafeMemberUse({ node: currentNode }))
        ) {
            hasUnsafeReference = true;
            wholeObjectNodes.push(...(!staticMemberName ? [currentNode] : []));
            return;
        }

        if (directMemberRead) {
            properties.add(staticMemberName);
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
    afterNode = {}
} = {}) => {
    const { range: afterRange = [] } = afterNode;
    const afterEnd = afterRange[1] ?? 0;
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
            range = []
        } = referenceNode;
        const { id = {} } = parent;
        const isDestructuringInitializer = (
            parent.type === 'VariableDeclarator' &&
            parent.init === referenceNode &&
            id.type === 'ObjectPattern'
        );
        const isDynamicMemberReference = type === 'MemberExpression' && computed;

        return !isDestructuringInitializer && (
            isDynamicMemberReference || range[0] > afterEnd
        );
    });
};

const containsIdentifier = ({ node = {}, name = '' } = {}) => {
    if (!node || typeof node !== 'object') return false;
    if (node.type !== 'Identifier') return Object.entries(node)
        .filter(([key = '']) => !['parent', 'loc', 'range', 'tokens', 'comments'].includes(key))
        .some(([, value = {}]) => (
            Array.isArray(value)
                ? value.some((child = {}) => containsIdentifier({ node: child, name }))
                : containsIdentifier({ node: value, name })
        ));

    const { parent = {} } = node;
    if (parent.type === 'MemberExpression' && parent.object === node) return false;
    return node.name === name;
};

const getSourceStart = ({ range = [], loc: { start: { line = 0, column = 0 } = {} } = {} } = {}) => (
    range[0] ?? (line * 100000 + column)
);

const getSourceEnd = ({ range = [], loc: { end: { line = 0, column = 0 } = {} } = {} } = {}) => (
    range[1] ?? (line * 100000 + column)
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
