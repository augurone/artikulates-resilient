import {
    createFunctionFlows,
    getFlowContext
} from './flow.js';
import {
    getDefinitions,
    getEnclosingFunction,
    getFunctionName,
    getFunctionNodes,
    inferExpression,
    isFunction,
    walk
} from './infer.js';
import { unknown } from './model.js';

const EXPRESSION_TYPES = [
    'ArrayExpression',
    'AssignmentPattern',
    'BinaryExpression',
    'CallExpression',
    'ConditionalExpression',
    'Identifier',
    'Literal',
    'LogicalExpression',
    'MemberExpression',
    'ObjectExpression',
    'TemplateLiteral',
    'UnaryExpression'
];

const getRange = ({ range = [], start = -1, end = -1 } = {}) => {
    if (Array.isArray(range) && range.length === 2) return range;
    if (start >= 0 && end >= start) return [start, end];
    return [];
};

const containsOffset = ({ node = {}, offset = -1 } = {}) => {
    const [start = -1, end = -1] = getRange(node);
    return start >= 0 && end >= start && offset >= start && offset <= end;
};

const isPropertyIdentifier = ({ node = {} } = {}) => {
    const { parent = {} } = node;
    if (!parent || typeof parent !== 'object') return false;
    const { type = '', property = {}, key = {} } = parent;
    return (
        (type === 'MemberExpression' && property === node) ||
        (type === 'Property' && key === node)
    );
};

const getExpressionNodes = (program = {}) => {
    const nodes = [];
    walk(program, (node = {}) => {
        const { type = '' } = node;
        if (!EXPRESSION_TYPES.includes(type)) return;
        if (type === 'Identifier' && isPropertyIdentifier({ node })) return;
        nodes.push(node);
    });
    return nodes;
};

const getContainingNodes = ({ nodes = [], offset = -1 } = {}) => nodes
    .filter(node => containsOffset({ node, offset }))
    .sort((left = {}, right = {}) => {
        const [leftStart = 0, leftEnd = 0] = getRange(left);
        const [rightStart = 0, rightEnd = 0] = getRange(right);
        return (leftEnd - leftStart) - (rightEnd - rightStart);
    });

const createContractDocument = (program = {}) => {
    const definitions = getDefinitions(program);
    const functions = getFunctionNodes(program);
    const flows = createFunctionFlows({ program, definitions });
    const expressions = getExpressionNodes(program);

    const getContractAtOffset = (offset = -1) => {
        const [node = {}] = getContainingNodes({ nodes: expressions, offset });
        if (!node.type) return { contract: unknown() };
        return {
            contract: inferExpression(node, getFlowContext({ node, definitions, flows })),
            functionNode: getEnclosingFunction(node),
            node
        };
    };

    const getSignatureAtOffset = (offset = -1) => {
        const [node = {}] = getContainingNodes({ nodes: functions, offset });
        if (!isFunction(node)) return {};
        const name = getFunctionName(node);
        const definition = definitions[name] || {};
        return {
            name,
            node,
            returnContract: definition.returnContract || unknown(),
            signature: definition.signature || {}
        };
    };

    return {
        definitions,
        getContractAtOffset,
        getSignatureAtOffset,
        functions
    };
};

export {
    createContractDocument,
    getRange
};
