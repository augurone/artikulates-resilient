// Public queries share a source snapshot but own independent requirements.
// Enumerating all groups lets composition tests interleave actual consumers.
export const queryGroups = Object.freeze([
    ['receivers', 'check'], ['destructurings', 'checkDestructuring'], ['destructuringFields', 'checkDestructuringField'],
    ['calls', 'checkCall'], ['calls', 'checkCallResult'], ['functions', 'checkFunction'], ['invocations', 'checkInvocation'],
    ['declarations', 'checkDeclaration'], ['signatureExtractions', 'checkSignatureExtraction'],
    ['memberAccesses', 'checkMemberAccess'], ['promiseUses', 'checkPromiseUse']
]);

export const queriesFor = analysis => queryGroups.flatMap(([collection = '', method = ''] = []) => {
    const entries = Reflect.get(analysis, collection);

    if (!Array.isArray(entries)) throw new TypeError('Expected public analysis descriptors');

    const requirements = method === 'checkCallResult' ? ['string', 'number', 'object', 'array', 'boolean', 'function', 'nullish'] : ['string'];

    return entries.flatMap(({ index = -1 } = {}) => requirements.map(required => ({ method, index, required })));
});

export const queryAnalysis = (analysis, { method = '', ...options } = {}) => {
    const query = Reflect.get(analysis, method);

    if (typeof query !== 'function') throw new TypeError('Expected a public analysis query');

    return query(options);
};
