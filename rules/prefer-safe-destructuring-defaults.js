const isAssignmentPattern = ({ type = '' } = {}) => type === 'AssignmentPattern';

const isRestElement = ({ type = '' } = {}) => type === 'RestElement';

const reportMissingDefault = ({ node = {}, report = () => {} } = {}) => {
    if (!node) return;
    if (isAssignmentPattern(node) || isRestElement(node)) return;

    report({
        node,
        messageId: 'safeDefault'
    });
};

export default {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Require explicit defaults for destructured values',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/prefer-safe-destructuring-defaults.md'
        },
        schema: [],
        messages: {
            safeDefault: 'Provide an explicit default for this destructured value.'
        }
    },
    create({ report = () => {} } = {}) {
        return {
            'ObjectPattern > Property': ({ value = {} } = {}) => {
                reportMissingDefault({
                    node: value,
                    report
                });
            },
            ArrayPattern({ elements = [] } = {}) {
                elements
                    .filter(Boolean)
                    .forEach((element = {}) => reportMissingDefault({
                        node: element,
                        report
                    }));
            }
        };
    }
};
