import { getContractDiagnostics } from './diagnostics.js';
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
    'AwaitExpression',
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

const getRange = ({ range = [], ...source } = {}) => {
    if (Array.isArray(range) && range.length === 2) return range;
    const { start = -1, end = -1 } = source;
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

const isCallCalleeIdentifier = ({ node = {} } = {}) => {
    const { parent = {} } = node;
    if (!parent || typeof parent !== 'object') return false;
    return parent.type === 'CallExpression' && parent.callee === node;
};

const getExpressionNodes = (program = {}) => {
    let nodes = [];
    walk(program, (node = {}) => {
        const { type = '' } = node;
        if (!EXPRESSION_TYPES.includes(type)) return;
        if (
            type === 'Identifier' &&
            (isPropertyIdentifier({ node }) || isCallCalleeIdentifier({ node }))
        ) return;
        nodes = [...nodes, node];
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

const getFrameLocation = (node = {}) => {
    const { loc = {} } = node;
    return {
        range: getRange(node),
        loc
    };
};

const createFunctionFrame = ({ node = {}, definitions = {} } = {}) => {
    const name = getFunctionName(node);
    const definition = definitions[name] || {};
    return {
        kind: 'function',
        name,
        ...getFrameLocation(node),
        signature: definition.signature || {},
        returnContract: definition.returnContract || unknown()
    };
};

const createContractDocument = (program = {}, {
    fileName = '',
    externalDefinitions = {}
} = {}) => {
    const localDefinitions = getDefinitions(program, externalDefinitions);
    const definitions = {
        ...localDefinitions,
        ...externalDefinitions
    };
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

    const getStackAtOffset = (offset = -1) => {
        const contractResult = getContractAtOffset(offset);
        const containingFunctions = getContainingNodes({ nodes: functions, offset }).reverse();
        const expressionFrame = contractResult.node && contractResult.node.type
            ? {
                kind: 'expression',
                ...getFrameLocation(contractResult.node),
                contract: contractResult.contract
            }
            : {};

        return {
            fileName,
            offset,
            frames: [
                {
                    kind: 'file',
                    fileName,
                    ...getFrameLocation(program)
                },
                ...containingFunctions.map(node => createFunctionFrame({ node, definitions })),
                ...(expressionFrame.kind ? [expressionFrame] : [])
            ]
        };
    };

    const getDiagnostics = () => getContractDiagnostics({
        program,
        definitions,
        flows
    }).map(({ node = {}, ...diagnostic } = {}) => ({
        ...diagnostic,
        node,
        ...getFrameLocation(node),
        stack: getStackAtOffset(getRange(node)[0])
    }));

    const getDiagnosticsAtOffset = (offset = -1) => getDiagnostics()
        .filter(({ range = [] } = {}) => containsOffset({ node: { range }, offset }));

    return {
        definitions,
        getContractAtOffset,
        getDiagnostics,
        getDiagnosticsAtOffset,
        getSignatureAtOffset,
        getStackAtOffset,
        functions
    };
};

export {
    createContractDocument,
    getRange
};
