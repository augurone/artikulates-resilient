const getRule = ({ ruleId = '', message = '' } = {}) => ruleId || (
    message.startsWith('Unused eslint-disable directive') ? 'unused-disable-directive' : 'parse-error'
);
const getLintSummary = (results = []) => {
    const messages = results.flatMap(({ messages: fileMessages = [] } = {}) => fileMessages);
    const byRule = messages.reduce((summary, { ruleId = '', message = '', severity = 0 } = {}) => {
        const rule = getRule({ ruleId, message });
        const { [rule]: current = { violations: 0, errors: 0, warnings: 0 } } = summary;
        const { violations = 0, errors = 0, warnings = 0 } = current;

        return {
            ...summary,
            [rule]: {
                violations: violations + 1,
                errors: errors + (severity === 2 ? 1 : 0),
                warnings: warnings + (severity === 1 ? 1 : 0)
            }
        };
    }, {});

    return {
        files: results.length,
        violations: messages.length,
        errors: messages.filter(({ severity = 0 } = {}) => severity === 2).length,
        warnings: messages.filter(({ severity = 0 } = {}) => severity === 1).length,
        byRule: Object.fromEntries(Object.entries(byRule).toSorted(([left = ''], [right = '']) => left.localeCompare(right)))
    };
};

export { getLintSummary };
