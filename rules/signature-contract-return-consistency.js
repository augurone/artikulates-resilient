import { narrowContext } from './contracts/flow.js';
import {
    getDefinitions,
    getFunctionContext,
    getFunctionNodes,
    getReturnNodes,
    inferExpression
} from './contracts/infer.js';
import { getKind, isKnown } from './contracts/model.js';

const getObject = value => value && typeof value === 'object' ? value : {};

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

const getInconsistentBranches = ({ functionNode = {}, definitions = {} } = {}) => {
    const context = getFunctionContext(functionNode, definitions);
    const branches = getReturnNodes(functionNode)
        .flatMap(({ argument = {} } = {}) => getReturnBranches(argument, context))
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

        return {
            Program(node = {}) {
                definitions = getDefinitions(node);
                getFunctionNodes(node).forEach((functionNode) => {
                    getInconsistentBranches({ functionNode, definitions }).forEach(({
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
