import {
    createFunctionFlows,
    getFlowContext
} from './contracts/flow.js';
import {
    getDefinitions,
    getOperationExpectation,
    getPropertyName,
    inferExpression
} from './contracts/infer.js';
import { describe, getKind, isKnown } from './contracts/model.js';

const getMethodName = ({ property = {}, computed = false } = {}) => (
    !computed && property.type === 'Identifier' ? property.name : ''
);

const getReceiverName = ({ object = {} } = {}) => {
    const { type = '', name = '', object: sourceObject = {}, property = {}, computed = false } = object;
    if (type === 'Identifier') return name;
    if (type !== 'MemberExpression') return 'value';
    const objectName = getReceiverName({ object: sourceObject });
    const propertyName = getPropertyName({ key: property, computed });
    return objectName && propertyName ? `${objectName}.${propertyName}` : 'value';
};

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Report native operations that contradict an inferred value contract',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/signature-contract-operation.md'
        },
        schema: [],
        messages: {
            mismatch: '{{receiver}} is {{actual}}, but .{{method}}() requires a {{expected}}.'
        }
    },
    create({ report = () => {} } = {}) {
        let definitions = {};
        let flows = new Map();

        return {
            Program(node = {}) {
                definitions = getDefinitions(node);
                flows = createFunctionFlows({ program: node, definitions });
            },
            MemberExpression(node = {}) {
                const { object = {} } = node;
                const method = getMethodName(node);
                if (!method) return;
                const context = getFlowContext({ node, definitions, flows });
                const receiver = inferExpression(object, context);
                if (!isKnown(receiver)) return;

                const expected = getOperationExpectation({
                    kind: getKind(receiver),
                    method
                });
                if (!expected || expected === getKind(receiver)) return;

                report({
                    node,
                    messageId: 'mismatch',
                    data: {
                        receiver: getReceiverName({ object }),
                        actual: describe(receiver),
                        method,
                        expected: describe({ kind: expected })
                    }
                });
            }
        };
    }
};
