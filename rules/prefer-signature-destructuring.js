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

const isWholeObjectPassThrough = ({ violation = {}, functionNode = {} } = {}) => {
    const {
        init = {},
        paramName = '',
        paramNode = {}
    } = violation;

    return hasWholeObjectReference({
        node: functionNode,
        name: paramName,
        excludedNodes: [paramNode, init],
        afterNode: violation.node
    });
};

const reportViolation = ({
    violation = {},
    calls = [],
    functionNode = {},
    sourceCode = {},
    report = () => {}
} = {}) => {
    const {
        node = {},
        paramName = ''
    } = violation;

    if (isPassedLater({ node, paramName, calls })) return;
    if (isWholeObjectPassThrough({ violation, functionNode })) return;

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
            moveToSignature: 'Move "{{name}}" destructuring to the function signature.'
        }
    },
    create({ report = () => {}, sourceCode = {} } = {}) {
        const functionStack = [];
        const enterFunction = (node = {}) => {
            functionStack.push({
                node,
                paramNames: getSimpleParamNames(node),
                params: getSimpleParams(node),
                violations: [],
                calls: []
            });
        };
        const exitFunction = () => {
            const {
                node: functionNode = {},
                violations = [],
                calls = []
            } = functionStack.pop() ?? {};

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
                    calls.push({
                        name,
                        start: getSourceStart(node)
                    });
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
                violations.push({
                    node: id,
                    paramName,
                    declaration: declaration ?? {},
                    init: safeInit,
                    paramNode
                });
            }
        };
    }
};
