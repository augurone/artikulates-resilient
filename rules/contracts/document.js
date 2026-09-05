import { getContractDiagnostics } from './diagnostics.js';
import { createEvidenceRegistry } from './evidence.js';
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
import { getObject, hasObjectValue, isObject } from '../support/object.js';

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

    if (!isObject(parent)) return false;

    const { type = '', property = {}, key = {} } = parent;

    return (
        (type === 'MemberExpression' && property === node) ||
        (type === 'Property' && key === node)
    );
};

const isCallCalleeIdentifier = ({ node = {} } = {}) => {
    const { parent = {} } = node;

    if (!isObject(parent)) return false;

    const { type = '', callee = {} } = parent;

    return type === 'CallExpression' && callee === node;
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
    const {
        [name]: {
            signature = {},
            returnContract = {}
        } = {}
    } = definitions;

    return {
        kind: 'function',
        name,
        ...getFrameLocation(node),
        signature: signature,
        returnContract: hasObjectValue(returnContract) ? returnContract : unknown()
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
    const evidence = createEvidenceRegistry({
        fileName,
        program,
        expressions,
        functions,
        definitions,
        flows
    });
    const {
        getEvidence: readEvidence = () => [],
        getEvidenceAtOffset: readEvidenceAtOffset = () => [],
        getEvidenceForContract: readEvidenceForContract = () => [],
        getEvidenceIdsForNode = () => []
    } = evidence;
    const getEvidenceIds = (node = {}) => getEvidenceIdsForNode({
        range: getRange(node)
    });
    const withEvidence = ({ contract = unknown(), node = {} } = {}) => {
        const evidenceIds = getEvidenceIds(node);

        return evidenceIds.length ? { ...contract, evidenceIds } : contract;
    };

    const getContractAtOffset = (offset = -1) => {
        const [node = {}] = getContainingNodes({ nodes: expressions, offset });

        const { type: nodeType = '' } = getObject(node);

        if (!nodeType) return { contract: unknown() };

        return {
            contract: withEvidence({
                contract: inferExpression(node, getFlowContext({ node, definitions, flows })),
                node
            }),
            functionNode: getEnclosingFunction(node),
            node
        };
    };

    const getSignatureAtOffset = (offset = -1) => {
        const [node = {}] = getContainingNodes({ nodes: functions, offset });

        if (!isFunction(node)) return {};

        const name = getFunctionName(node);
        const {
            [name]: {
                signature = {},
                returnContract = {}
            } = {}
        } = definitions;
        const { range: signatureRange = [] } = getObject(node);

        return {
            name,
            node,
            returnContract: hasObjectValue(returnContract) ? returnContract : unknown(),
            signature,
            evidenceIds: getEvidenceIds({ range: signatureRange })
        };
    };

    const getStackAtOffset = (offset = -1) => {
        const contractResult = getContractAtOffset(offset);
        const containingFunctions = getContainingNodes({ nodes: functions, offset }).reverse();
        const { node: contractNode = {}, contract = unknown() } = getObject(contractResult);
        const { type: contractNodeType = '' } = getObject(contractNode);
        const expressionFrame = contractNodeType
            ? {
                kind: 'expression',
                ...getFrameLocation(contractNode),
                contract: withEvidence({ contract, node: contractNode }),
                evidenceIds: getEvidenceIds(contractNode)
            }
            : {};
        const { kind: expressionKind = '' } = expressionFrame;

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
                ...(expressionKind ? [expressionFrame] : [])
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
        evidenceIds: readEvidenceAtOffset(getRange(node)[0])
            .map(({ id = '' } = {}) => id),
        stack: getStackAtOffset(getRange(node)[0])
    }));

    const getDiagnosticsAtOffset = (offset = -1) => getDiagnostics()
        .filter(({ range = [] } = {}) => containsOffset({ node: { range }, offset }));

    return {
        definitions,
        getEvidence: readEvidence,
        getEvidenceAtOffset: readEvidenceAtOffset,
        getEvidenceForContract: readEvidenceForContract,
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
