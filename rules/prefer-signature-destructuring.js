import {
    containsIdentifier,
    getSimpleParamNames,
    getSimpleParams,
    getSourceEnd,
    getSourceStart,
    hasWholeObjectReference,
    isDestructuringFromParam
} from './support/signature-analysis.js';
import getSuggestion from './support/signature-suggestion.js';

const getCurrentFunction = (functionStack = []) => {
    const currentFunctions = functionStack.slice(-1);
    const [currentFunction = {}] = currentFunctions;

    return currentFunction;
};

const isPassedLater = ({
    node = {},
    paramName = '',
    calls = []
} = {}) => calls.some(({ name = '', start = 0 } = {}) => (
    name === paramName && start > getSourceEnd(node)
));

const isWholeObjectPassThrough = ({
    violation: {
        init = {},
        paramName = '',
        paramNode = {},
        node: violationNode = {}
    } = {},
    functionNode = {}
} = {}) => {
    return hasWholeObjectReference({
        node: functionNode,
        name: paramName,
        excludedNodes: [paramNode, init],
        afterNode: violationNode
    });
};

const reportViolation = ({
    violation = {},
    calls = [],
    functionNode = {},
    sourceCode = {},
    report
} = {}) => {
    const {
        node = {},
        paramName = ''
    } = violation;

    if (isPassedLater({ node, paramName, calls })) return;

    if (isWholeObjectPassThrough({ violation, functionNode })) return;

    if (typeof report !== 'function') return;

    report({
        node,
        messageId: 'preferSignature',
        data: {
            name: paramName
        },
        suggest: getSuggestion({
            violation,
            functionNode,
            sourceCode
        })
    });
};

export default {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Prefer destructuring object parameters in the function signature',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/prefer-signature-destructuring.md'
        },
        schema: [],
        hasSuggestions: true,
        messages: {
            preferSignature: 'Destructure "{{name}}" in the function signature instead of inside the function body. ({val = ""} = {}) => vals',
            // eslint-disable-next-line eslint-plugin/no-unused-message-ids -- The imported suggestion builder consumes this message ID.
            moveToSignature: 'Move "{{name}}" destructuring to the function signature.'
        }
    },
    create({ report = () => {}, sourceCode = {} } = {}) {
        let functionStack = [];
        const enterFunction = (node = {}) => {
            functionStack = [...functionStack, {
                node,
                paramNames: getSimpleParamNames(node),
                params: getSimpleParams(node),
                violations: [],
                calls: []
            }];
        };
        const exitFunction = () => {
            const {
                node: functionNode = {},
                violations = [],
                calls = []
            } = functionStack.at(-1) ?? {};
            functionStack = functionStack.slice(0, -1);

            violations.forEach((violation = {}) => reportViolation({
                violation,
                calls,
                functionNode,
                sourceCode,
                report
            }));
        };

        return {
            FunctionDeclaration: enterFunction,
            'FunctionDeclaration:exit': exitFunction,
            FunctionExpression: enterFunction,
            'FunctionExpression:exit': exitFunction,
            ArrowFunctionExpression: enterFunction,
            'ArrowFunctionExpression:exit': exitFunction,
            CallExpression: ({ arguments: nodeArguments = [], ...node } = {}) => {
                const currentFunction = getCurrentFunction(functionStack);
                const {
                    paramNames = [],
                    calls = []
                } = currentFunction;

                paramNames.forEach((name = '') => {
                    if (!nodeArguments.some((argument = {}) => containsIdentifier({ node: argument, name }))) return;

                    const currentIndex = functionStack.length - 1;
                    functionStack = [
                        ...functionStack.slice(0, currentIndex),
                        {
                            ...currentFunction,
                            calls: [...calls, {
                                name,
                                start: getSourceStart(node)
                            }]
                        },
                        ...functionStack.slice(currentIndex + 1)
                    ];
                });
            },
            VariableDeclarator: ({
                id = {},
                init = {},
                parent: declaration = {}
            } = {}) => {
                const currentFunction = getCurrentFunction(functionStack);
                const {
                    paramNames = [],
                    params = [],
                    violations = []
                } = currentFunction;
                const safeInit = init ?? {};

                if (!isDestructuringFromParam({ id, init: safeInit }, paramNames)) return;

                const { name: paramName = '' } = safeInit;
                const { node: paramNode = {} } = params.find(({ name = '' } = {}) => name === paramName) ?? {};
                const currentIndex = functionStack.length - 1;
                functionStack = [
                    ...functionStack.slice(0, currentIndex),
                    {
                        ...currentFunction,
                        violations: [...violations, {
                            node: id,
                            paramName,
                            declaration: declaration ?? {},
                            init: safeInit,
                            paramNode
                        }]
                    },
                    ...functionStack.slice(currentIndex + 1)
                ];
            }
        };
    }
};
