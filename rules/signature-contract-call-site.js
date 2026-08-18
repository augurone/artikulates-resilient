import {
    getDefinitions,
    getPropertyName,
    inferExpression
} from './contracts/infer.js';
import {
    describe,
    isCompatible,
    unknown
} from './contracts/model.js';

const getMismatches = ({ expected = unknown(), actual = unknown(), node = {}, path = [] } = {}) => {
    if (expected.kind === 'unknown' || actual.kind === 'unknown') return [];
    if (expected.kind !== actual.kind) return [{ expected, actual, node, path }];
    if (expected.kind === 'array') return getMismatches({
        expected: expected.element,
        actual: actual.element,
        node,
        path: [...path, '[]']
    });
    if (expected.kind !== 'object') return [];

    return Object.entries(expected.properties || {}).flatMap(([name = '', property = {}] = []) => {
        // Object contracts use a name-keyed map; an empty object preserves that shape.
        const { properties: actualProperties = {} } = actual;
        const { properties: sourceProperties = [] } = node;
        const actualProperty = actualProperties[name] || unknown();
        const propertyNode = sourceProperties
            .find(candidate => getPropertyName(candidate) === name);
        return getMismatches({
            expected: property,
            actual: actualProperty,
            node: propertyNode ? propertyNode.value : node,
            path: [...path, name]
        });
    });
};

const getCallSiteMismatches = ({ node = {}, definitions = {} } = {}) => {
    const { callee = {}, arguments: args = [] } = node;
    if (callee.type !== 'Identifier') return [];
    const definition = definitions[callee.name] || {};
    const [argument = {}] = args;
    if (!definition.signature || argument.type !== 'ObjectExpression') return [];

    const { signature: { contract: expected = unknown() } = {} } = definition;
    const actual = inferExpression(argument, { functions: definitions });
    if (!isCompatible({ expected, actual })) {
        return getMismatches({ expected, actual, node: argument });
    }
    return [];
};

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Report known call-site values that contradict a function signature contract',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/signature-contract-call-site.md'
        },
        schema: [],
        messages: {
            mismatch: '{{path}} expects {{expected}}, but this call supplies {{actual}}.'
        }
    },
    create({ report = () => {} } = {}) {
        let definitions = {};

        return {
            Program(node = {}) {
                definitions = getDefinitions(node);
            },
            CallExpression(node = {}) {
                getCallSiteMismatches({ node, definitions }).forEach(({ expected = {}, actual = {}, node: reportNode = {}, path = [] } = {}) => {
                    report({
                        node: reportNode,
                        messageId: 'mismatch',
                        data: {
                            path: path.join('.') || 'argument',
                            expected: describe(expected),
                            actual: describe(actual)
                        }
                    });
                });
            }
        };
    }
};
