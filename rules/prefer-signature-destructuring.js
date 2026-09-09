import { getBinding, getBindingDefinition, registerBindingSource } from './contracts/binding-evidence.js';
import { hasDirectCapabilityBinding } from './contracts/flow.js';
import { getEnclosingFunction } from './contracts/infer.js';
import { getParameterUsage, getSimpleParams, hasWholeObjectReference } from './support/signature-analysis.js';
import getSuggestion from './support/signature-suggestion.js';

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
        registerBindingSource(sourceCode);

        return {
            VariableDeclarator({ id = {}, init = {}, parent: declaration = {} } = {}) {
                const { type = '' } = id;

                if (type !== 'ObjectPattern' || !init) return;

                const functionNode = getEnclosingFunction(declaration);
                const { type: bindingType = '', node: owner = {} } = getBindingDefinition(getBinding(init));

                if (bindingType !== 'Parameter' || owner !== functionNode) return;

                const { name: paramName = '' } = init;
                const { node: paramNode = {} } = getSimpleParams(functionNode).find(({ name = '' } = {}) => name === paramName) ?? {};

                if (!Object.keys(paramNode).length || hasDirectCapabilityBinding({ node: id })) return;

                const usage = getParameterUsage({ functionNode, paramNode, init, name: paramName });

                if (hasWholeObjectReference({ ...usage, afterNode: id })) return;

                const violation = { node: id, declaration, init, paramName, paramNode };

                report({
                    node: id,
                    messageId: 'preferSignature',
                    data: { name: paramName },
                    suggest: getSuggestion({ violation, functionNode, sourceCode, usage })
                });
            }
        };
    }
};
