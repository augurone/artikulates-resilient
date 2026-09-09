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

const relateContracts = ({
    source = {},
    target = {},
    sourceKeys = [],
    targetKeys = []
} = {}) => {
    const { kind: sourceKind = '', family: sourceFamily = '' } = normalizeContract(source);
    const { kind: targetKind = '', family: targetFamily = '' } = normalizeContract(target);

    // eslint-disable-next-line resilient/prefer-falsey-returns -- Unknown or required contracts have no relation result; false would turn missing evidence into a contradiction.
    if (['unknown', 'required'].includes(sourceKind)) return undefined;

    // eslint-disable-next-line resilient/prefer-falsey-returns -- Unknown or required contracts have no relation result; false would turn missing evidence into a contradiction.
    if (['unknown', 'required'].includes(targetKind)) return undefined;

    if (['invalid', 'undefined'].includes(sourceFamily) ||
        ['invalid', 'undefined'].includes(targetFamily)) return false;

    if (sourceFamily !== targetFamily) return false;

    if (targetFamily !== 'object') return true;

    return targetKeys.every(name => sourceKeys.includes(name));
};

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
    lookupMember,
    normalizeContract,
    projectMembers,
    reduceContracts,
    relateContracts
};
