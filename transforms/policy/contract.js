const runtimeFamilies = {
    literal: 'string',
    resolved: 'object',
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    bigint: 'bigint',
    array: 'array',
    object: 'object',
    function: 'function',
    undefined: 'undefined',
    invalid: 'invalid',
    required: 'required',
    unknown: 'unknown',
    union: 'union'
};

const getContractFamily = ({ kind = '', family = '' } = {}) => {
    if (family) return family;

    if (runtimeFamilies[kind]) return runtimeFamilies[kind];

    return kind;
};

const getMemberName = ({ name = {} } = {}) => {
    const { text = '', escapedText = '' } = name;

    return text || escapedText || '';
};

const normalizeContract = ({ kind: sourceKind = '', family: sourceFamily = '', ...contract } = {}) => {
    const kind = typeof sourceKind === 'string'
        ? sourceKind
        : 'unknown';

    return {
        ...contract,
        kind,
        family: getContractFamily({ kind, family: sourceFamily })
    };
};

const getContractRelation = ({
    source = {},
    target = {},
    sourceKeys = [],
    targetKeys = []
} = {}) => {
    const { kind: sourceKind = '', family: sourceFamily = '' } = normalizeContract(source);
    const { kind: targetKind = '', family: targetFamily = '' } = normalizeContract(target);

    if (['unknown', 'required'].includes(sourceKind)) return 'unknown';

    if (['unknown', 'required'].includes(targetKind)) return 'unknown';

    if (['invalid', 'undefined'].includes(sourceFamily) ||
        ['invalid', 'undefined'].includes(targetFamily)) return 'contradiction';

    if (sourceFamily !== targetFamily) return 'contradiction';

    if (targetFamily !== 'object') return 'agreement';

    return targetKeys.every(name => sourceKeys.includes(name)) ? 'agreement' : 'contradiction';
};
const getRelationState = (value) => {
    if (typeof value !== 'boolean') return 'unknown';

    return value ? 'agreement' : 'contradiction';
};
/* eslint-disable resilient/signature-contract-return-consistency, resilient/prefer-falsey-returns -- Public relations preserve boolean/undefined results; internal states are explicit. */
const relateContracts = (options = {}) => {
    const relation = getContractRelation(options);

    if (relation === 'unknown') return undefined;

    return relation === 'agreement';
};
/* eslint-enable resilient/signature-contract-return-consistency, resilient/prefer-falsey-returns */

const reduceContracts = ({
    contracts = [],
    parts = [],
    optional = false,
    preserveObjectUnion = false,
    resolver = '',
    typeText = '',
    checks = {},
    canonicals = {}
} = {}) => {
    const normalized = contracts.map(normalizeContract);
    const families = [...new Set(normalized.map(({ family = '' } = {}) => family))];
    const [family = ''] = families;
    const [firstContract = {}] = normalized;
    const {
        kind: firstKind = '',
        check: firstCheck = '',
        canonical: firstCanonical = ''
    } = firstContract;
    const { [family]: familyCheck = '' } = checks;
    const { [family]: familyCanonical = '' } = canonicals;
    const reducible = families.length === 1 &&
        !['invalid', 'required', 'unknown', 'union'].includes(family) &&
        !(family === 'object' && preserveObjectUnion);

    if (reducible && firstKind) return normalizeContract({
        ...firstContract,
        kind: family,
        family,
        check: familyCheck || firstCheck || '',
        canonical: familyCanonical || firstCanonical || '',
        optional
    });

    return normalizeContract({
        kind: 'union',
        family: 'union',
        resolver,
        parts,
        typeText,
        optional,
        // A union has no falsifiable empty value. Preserve absence and let its
        // resolver or consuming boundary establish agreement.
        canonical: ''
    });
};

const projectMembers = ({ members = [], keys = [], mode = 'pick' } = {}) => members.filter((member) => {
    const name = getMemberName(member);
    const included = keys.includes(name);

    if (mode === 'omit') return !included;

    return included;
});

const lookupMember = ({ members = [], name = '' } = {}) => members.find(member => getMemberName(member) === name);

export {
    getContractFamily,
    getContractRelation,
    getRelationState,
    lookupMember,
    normalizeContract,
    projectMembers,
    reduceContracts,
    relateContracts
};
