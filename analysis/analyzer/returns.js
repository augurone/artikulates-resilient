// Return consistency belongs to the producer's surviving normal completions.
// Caller requirements and invocation selections never enter this comparison.
const familyOf = ({ family = '' } = {}) => family;
const position = ({ fallthrough = false, location: { range: [start = 0] = [] } = {} } = {}) => fallthrough ? Infinity : start;
const message = ({ operator = '', multiple = false } = {}) => {
    if (operator) return 'inconsistentOperand';

    return multiple ? 'inconsistentValue' : 'inconsistent';
};

export const returnDiagnostics = ({ returns = [] } = {}) => {
    // An unresolved alternative supplies no family. It cannot erase known
    // alternatives when a returned value is composed, aliased, or forwarded.
    const known = returns.toSorted((left, right) => position(left) - position(right))
        .flatMap(({ fact: { families = [] } = {}, absences = [], ...site } = {}) => families
            .flatMap(family => family === 'nullish' ? absences : [family]).map(family => ({ ...site, family })));
    const families = [...new Set(known.map(familyOf))];

    if (families.length < 2) return Object.freeze([]);

    const sites = Map.groupBy(known, ({ location: { range = [] } = {} } = {}) => range.join(':'));

    return Object.freeze([...sites.values()].map((entries) => {
        const [first = {}] = entries;
        const { family: actual = '', location = {}, operator = '' } = first;
        const localFamilies = [...new Set(entries.map(familyOf))];
        const multiple = localFamilies.length > 1;
        const expected = (multiple ? localFamilies : families).find(other => other !== actual);
        const messageId = message({ operator, multiple });

        return Object.freeze({ ruleId: 'signature-contract-return-consistency', messageId, location,
            data: Object.freeze({ actual, expected, ...(operator ? { operator } : {}) }) });
    }));
};
