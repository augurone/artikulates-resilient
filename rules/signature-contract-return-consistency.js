import {
    createFunctionFlows,
    getFlowContext,
    narrowContext
} from './contracts/flow.js';
import {
    getDefinitions,
    getFunctionNodes,
    getReturnNodes,
    inferExpression
} from './contracts/infer.js';
import { getKind, isKnown } from './contracts/model.js';
import { getObject } from './support/object.js';

const getReturnBranches = (nodeInput = {}, context = {}) => {
    const {
        type = '',
        test = {},
        consequent = {},
        alternate = {},
        ...node
    } = getObject(nodeInput);
    const sourceNode = { type, test, consequent, alternate, ...node };

    if (type !== 'ConditionalExpression') {
        return [{ node: sourceNode, contract: inferExpression(sourceNode, context) }];
    }

    return [
        ...getReturnBranches(consequent, narrowContext({ ...test, context, truthy: true })),
        ...getReturnBranches(alternate, narrowContext({ ...test, context, truthy: false }))
    ];
};

const getComparableContract = ({ functionNode = {}, contract = {} } = {}) => {
    const { async = false } = functionNode;

    if (!async) return contract;

    const { kind = '', element = {} } = contract;

    if (kind !== 'promise') return contract;

    return element;
};

const getInconsistentBranches = ({ functionNode = {}, definitions = {}, flows = new Map() } = {}) => {
    const branches = getReturnNodes(functionNode)
        .flatMap(({ argument = {} } = {}) => {
            const safeArgument = getObject(argument);
            const { type: argumentType = '' } = safeArgument;
            const context = argumentType
                ? getFlowContext({ node: safeArgument, definitions, flows })
                : { functions: definitions };

            return getReturnBranches(safeArgument, context);
        })
        .map(({ contract: branchContract = {}, ...branch } = {}) => ({
            ...branch,
            contract: getComparableContract({
                functionNode,
                contract: branchContract
            })
        }))
        .filter(({ contract = {} } = {}) => isKnown(contract));
    const kinds = [...new Set(branches.map(({ contract = {} } = {}) => getKind(contract)))];

    if (kinds.length < 2) return [];

    return branches.map(({ node = {}, contract = {} } = {}) => ({
        node,
        actual: getKind(contract),
        expected: kinds.find(kind => kind !== getKind(contract))
    }));
};

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Report known functions that return incompatible value families',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/signature-contract-return-consistency.md'
        },
        schema: [],
        messages: {
            inconsistent: 'This function returns {{actual}}, but another return path produces {{expected}}.'
        }
    },
    create({ report = () => {} } = {}) {
        let definitions = {};
        let flows = new Map();

        return {
            Program(node = {}) {
                definitions = getDefinitions(node);
                flows = createFunctionFlows({ program: node, definitions });
                getFunctionNodes(node).forEach((functionNode) => {
                    getInconsistentBranches({ functionNode, definitions, flows }).forEach(({
                        node: branchNode = {},
                        actual = '',
                        expected = ''
                    } = {}) => report({
                        node: branchNode,
                        messageId: 'inconsistent',
                        data: { actual, expected }
                    }));
                });
            }
        };
    }
};
