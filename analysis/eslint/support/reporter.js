// The lint host owns a stable rule context. Missing reporting capability must fail
// at invocation rather than being replaced with an invented no-op callback.
export const createReporter = context => finding => context.report(finding);

// Public analyzer locations carry source ranges; only the ESLint adapter turns
// those ranges into host coordinates. All diagnostic payloads pass through.
export const createLocationReporter = (context) => {
    const { sourceCode = {} } = context;

    return ({ location: { range: [start = 0, end = 0] = [] } = {}, ...finding } = {}) => context.report({
        ...finding, loc: { start: sourceCode.getLocFromIndex(start), end: sourceCode.getLocFromIndex(end) }
    });
};
