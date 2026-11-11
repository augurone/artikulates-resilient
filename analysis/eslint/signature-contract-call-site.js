import { createAnalysisListener } from './support/analysis.js';

const label = name => name === 'nullish' ? 'null' : `${name}-like`;
const actualLabel = ({ family = '', absence = '' } = {}) => {
    if (family !== 'nullish' || !absence || absence === 'null') return label(family);

    return absence === 'undefined' ? 'undefined' : 'null or undefined';
};
const dataFor = ({ kind = 'mismatch', message = '', path = '', expected = '', absence = '', facts = [] } = {}) => {
    if (kind !== 'mismatch') return { message, path };

    const { families = [] } = facts.findLast(({ facet = '' } = {}) => facet === 'family');

    return { path, expected: label(expected), actual: families.filter(family => family !== expected).map(family => actualLabel({ family, absence })).join(' or ') };
};

export default {
    meta: {
        type: 'problem',
        docs: { description: 'Report established argument contradictions at supported direct local calls',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/signature-contract-call-site.md' },
        schema: [],
        messages: { mismatch: '{{path}} expects {{expected}}, but this call supplies {{actual}}.', arity: '{{message}}', excessProperty: 'This call supplies excess property {{path}}.' }
    },
    create(context = {}) {
        return createAnalysisListener(context, (analysis, report) => {
            const { calls = [] } = analysis;

            const findings = calls.flatMap(({ index = -1 } = {}) => {
                const { obligations = [] } = analysis.checkCall({ index });

                return obligations.filter(({ status = '' } = {}) => status === 'contradiction');
            }).map((obligation) => {
                const { kind = 'mismatch', location = {}, origin = false } = obligation;
                const { range = [], filename = '' } = origin ? origin : location;
                const data = dataFor(obligation);

                return { key: JSON.stringify([filename, range, kind, data]), direct: !origin, location, finding: { location, messageId: kind, data } };
            });
            const direct = new Set(findings.filter(({ direct = false } = {}) => direct).map(({ key = '' } = {}) => key));
            const selected = new Map(findings.filter(({ direct: own = false, key = '' } = {}) => own || !direct.has(key))
                .map(({ location = {}, key = '', finding = {} } = {}) => [JSON.stringify([location, key]), finding]));

            selected.forEach(report);
        });
    }
};
