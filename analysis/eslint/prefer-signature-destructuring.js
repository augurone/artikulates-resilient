import { createAnalysisListener } from './support/analysis.js';

// The analyzer owns placement and relocation evidence. The host only copies
// authored text, preserves comments, and supplies the parser's arrow parentheses.
const suggestion = (sourceCode, { parameter: { range: parameter = [] } = {}, pattern: { range: pattern = [] } = {}, declaration: { range: declaration = [] } = {},
    arrow = false, single = false }, name) => {
    const outsidePattern = sourceCode.getCommentsInside({ range: declaration }).some(({ range: [start = -1, end = -1] = [] } = {}) => (
        !(start >= pattern.at(0) && end <= pattern.at(1))
    ));

    if (outsidePattern) return [];

    const text = sourceCode.getText();
    const written = text.slice(...pattern);
    const { value = '' } = sourceCode.getTokenBefore({ range: parameter }) ?? {};
    const replacement = arrow && single && value !== '(' ? `(${written})` : written;

    return [{ messageId: 'moveToSignature', data: { name }, fix: fixer => [
        fixer.replaceTextRange(parameter, replacement), fixer.removeRange(declaration)
    ] }];
};

export default {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Expose owned object extraction in the function signature',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/prefer-signature-destructuring.md'
        },
        schema: [], hasSuggestions: true,
        messages: {
            preferSignature: 'Destructure "{{name}}" in the function signature instead of inside the function body.',
            moveToSignature: 'Move "{{name}}" destructuring to the function signature, preserving authored defaults.'
        }
    },
    create(context = {}) {
        const { sourceCode = {} } = context;

        return createAnalysisListener(context, (analysis, report) => {
            const { signatureExtractions = [] } = analysis;

            signatureExtractions.forEach(({ index = -1, name = '', location = {} } = {}) => {
                const { placement = '', relocation = false } = analysis.checkSignatureExtraction({ index });

                if (placement !== 'signature') return;

                report({ location,
                    messageId: 'preferSignature', data: { name }, suggest: relocation ? suggestion(sourceCode, relocation, name) : [] });
            });
        });
    }
};
