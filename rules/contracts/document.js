import { createAnalysisSession } from './analysis-session.js';
import { getContractDiagnostics } from './diagnostics.js';
import { createEvidenceRegistry } from './evidence.js';
import { getFlowContext } from './flow.js';
import {
    getEnclosingFunction,
    getDefinitionForNode,
    getDefinitionNameForNode,
    getDefinitionMetadata,
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

const getExpressionNodes = (program = {}, visit = walk) => {
    const nodes = [];
    visit(program, (node = {}) => {
        const { type = '' } = node;

        if (!EXPRESSION_TYPES.includes(type)) return;

        if (
            type === 'Identifier' &&
            (isPropertyIdentifier({ node }) || isCallCalleeIdentifier({ node }))
        ) return;

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Call-local ordered buffer; no AST mutation or prefix copy.
        nodes.push(node);
    });

    return nodes;
};

const getContainingNodes = ({ nodes = [], offset = -1 } = {}) => nodes
    .filter(node => containsOffset({ node, offset }))
    .toSorted((left = {}, right = {}) => {
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
    const name = getDefinitionNameForNode({ definitions, node });
    const { signature = {}, returnContract = {} } = getDefinitionForNode({ definitions, node });

    return {
        kind: 'function',
        name,
        ...getFrameLocation(node),
        signature: signature,
        returnContract: hasObjectValue(returnContract) ? returnContract : unknown()
    };
};

const getFunctionOwner = ({ node = {}, definitions = {} } = {}) => {
    const { bindingIndex = {} } = getDefinitionMetadata(definitions);
    const { getScope = false } = getObject(bindingIndex);

    if (typeof getScope !== 'function') return getEnclosingFunction(node);

    const find = ({ type = '', node: scopeNode = {}, parent = {} } = {}) => {
        if (!type) return {};

        return type === 'function' ? scopeNode : find(parent);
    };

    return find(getScope(node));
};

const createContractDocument = (program = {}, {
    fileName = '',
    externalDefinitions = {}
} = {}) => {
    const { canReuseCensus = false, definitions = {}, getFunctions = undefined, getFlows = undefined, visit = undefined } = createAnalysisSession(program, { externalDefinitions });
    const functions = getFunctions();
    const flows = getFlows();
    const expressions = getExpressionNodes(program, visit);
    const evidence = createEvidenceRegistry({
        fileName,
        program,
        expressions,
        functions,
        definitions,
        flows,
        visit
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
            functionNode: getFunctionOwner({ node, definitions }),
            node
        };
    };

    const getSignatureAtOffset = (offset = -1) => {
        const [node = {}] = getContainingNodes({ nodes: functions, offset });

        if (!isFunction(node)) return {};

        // eslint-disable-next-line resilient/signature-contract-call-site -- node is an AST function boundary.
        const name = getDefinitionNameForNode({ definitions, node });
        const sourceNode = getObject(node);
        const { signature = {}, returnContract = {} } = getDefinitionForNode({ definitions, node: sourceNode });
        const { range: signatureRange = [] } = sourceNode;

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
        const containingFunctions = getContainingNodes({ nodes: functions, offset }).toReversed();
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

    const getDiagnosticRecords = ({ includeReturnDiagnostics = true } = {}) => getContractDiagnostics({
        program,
        definitions,
        flows,
        includeReturnDiagnostics,
        visit,
        reuse: canReuseCensus
    }).map(({ node = {}, ...diagnostic } = {}) => ({
        ...diagnostic,
        node,
        evidenceIds: readEvidenceAtOffset(getRange(node)[0])
            .map(({ id = '' } = {}) => id)
    }));
    // The four graph-backed rule consumers retain their bounded shared index.
    // Return consistency uses its portable reader directly so large suppressed
    // result sets are not retained by every cached project document.
    const getDiagnosticsForIndex = () => getDiagnosticRecords({ includeReturnDiagnostics: false });
    const getDiagnostics = () => getDiagnosticRecords().map(({ node = {}, ...diagnostic } = {}) => ({
        ...diagnostic,
        node,
        ...getFrameLocation(node),
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
        getDiagnosticsForIndex,
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
