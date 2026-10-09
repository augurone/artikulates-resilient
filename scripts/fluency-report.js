const getDiagnosticRule = ({ ruleId = '', message = '' } = {}) => ruleId || (
    message.startsWith('Unused eslint-disable directive') ? 'unused-disable-directive' : 'parse-error'
);
const getMessageCounts = (messages = []) => ({
    violations: messages.length,
    errors: messages.filter(({ severity = 0 } = {}) => severity === 2).length,
    warnings: messages.filter(({ severity = 0 } = {}) => severity === 1).length
});
const getLintSummary = (results = []) => {
    const messages = results.flatMap(({ messages: fileMessages = [] } = {}) => fileMessages);
    const byRule = Object.groupBy(messages, getDiagnosticRule);

    return {
        files: results.length,
        ...getMessageCounts(messages),
        byRule: Object.fromEntries(Object.entries(byRule)
            .toSorted(([left = ''], [right = '']) => left.localeCompare(right))
            .map(([rule = '', findings = []] = []) => [rule, getMessageCounts(findings)]))
    };
};

export { getDiagnosticRule, getMessageCounts, getLintSummary };
