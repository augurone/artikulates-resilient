import {
    getDefinitions,
    getEnclosingFunction,
    getFunctionContext,
    getReturnNodes,
    inferExpression
} from './contracts/infer.js';
import { getKind, isKnown } from './contracts/model.js';

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
            },
            ReturnStatement({ argument = {}, parent = {}, ...node } = {}) {
                const sourceNode = { argument, parent, ...node };
                const functionNode = getEnclosingFunction(sourceNode);
                if (!functionNode || !functionNode.body) return;
                const context = getFunctionContext(functionNode, definitions);
                const current = inferExpression(argument || {}, context);
                // An unknown path cannot establish a contradictory return family.
                if (!isKnown(current)) return;
                const returns = getReturnNodes(functionNode)
                    .map(({ argument = {} } = {}) => inferExpression(argument, context))
                    .filter(isKnown);
                const kinds = [...new Set(returns.map(getKind))];
                if (kinds.length < 2) return;
                const expected = kinds.find(kind => kind !== getKind(current));
                if (!expected) return;

                report({
                    node: sourceNode,
                    messageId: 'inconsistent',
                    data: {
                        actual: getKind(current),
                        expected
                    }
                });
            }
        };
    }
};
