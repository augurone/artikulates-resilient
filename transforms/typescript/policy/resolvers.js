const getResolverRequirements = ({ kind = '', family = '' } = {}) => {
    if (['discriminant', 'property'].includes(kind)) return ['model'];

    if (kind !== 'family') return [];

    if (family === 'array') return ['array-content'];

    if (family === 'object') return ['object-content'];

    if (family === 'function') return ['function'];

    return [];
};

const requireResolverCapability = (name = '') => {
    throw new TypeError(`Missing resolver capability: ${name}`);
};

const createResolverPolicy = ({
    getTypeInfo = requireResolverCapability('getTypeInfo'),
    getRuntimeKind = requireResolverCapability('getRuntimeKind'),
    getObjectDiscriminator = requireResolverCapability('getObjectDiscriminator'),
    getObjectShapeCheck = requireResolverCapability('getObjectShapeCheck')
} = {}) => {
    const getPredicate = (info = {}) => {
        const { kind = '', constructorName = '', literalValue = '' } = info;

        if (constructorName) return { kind: 'instance', name: constructorName };

        if (kind === 'literal') return { kind: 'literal', value: literalValue };

        if (kind === 'resolved') return { kind: 'family', family: 'object' };

        if (['string', 'number', 'boolean', 'bigint', 'symbol', 'array', 'object', 'function'].includes(kind)) {
            return { kind: 'family', family: getRuntimeKind(info) };
        }

        return {};
    };
    const getPredicateKind = ({ kind = '' } = {}) => kind;
    const getUnionResolverSource = ({ typescript = {}, parts = [], sourceFile = {}, declarations = {}, resolvers = {}, name = '' } = {}) => {
        const branches = parts.map((part) => {
            const info = getTypeInfo({ typescript, node: part, sourceFile, declarations, resolvers });
            const { kind: infoKind = '', resolver: infoResolver = '' } = info;
            const kind = getRuntimeKind(info);
            const discriminator = getObjectDiscriminator({ typescript, node: part, sourceFile, declarations, resolvers });
            const { kind: discriminatorKind = '' } = discriminator;
            const shape = !discriminatorKind && kind === 'object'
                ? getObjectShapeCheck({ typescript, node: part, sourceFile, declarations, unionParts: parts })
                : {};
            const { kind: shapeKind = '' } = shape;
            const specificPredicate = discriminatorKind ? discriminator : shape;
            const predicate = discriminatorKind || shapeKind ? specificPredicate : getPredicate(info);
            const value = infoKind === 'resolved' && infoResolver ? `${infoResolver}(input)` : 'input';
            const { kind: predicateKind = '' } = predicate;
            const familyPresence = predicateKind ? 'positive-family' : 'unmatched';
            const presence = discriminatorKind ? 'discriminated' : familyPresence;
            const familyContent = predicateKind === 'family' ? 'nonempty' : 'required';
            const content = ['object', 'array'].includes(kind) ? familyContent : 'not-applicable';

            return { predicate, kind, value, action: predicateKind ? 'resolve' : 'preserve',
                presence, content, specific: Boolean(discriminatorKind || shapeKind) };
        });
        const predicateKey = ({ kind = '', family = '', property = '', value = '', name = '' } = {}) => (
            JSON.stringify([kind, family, property, value, name])
        );
        const repeated = new Set(branches
            .filter(({ specific = false, predicate = {} } = {}) => !specific && Boolean(getPredicateKind(predicate)))
            .map(({ predicate = {} } = {}) => predicateKey(predicate))
            .filter((key = '', index = 0, keys = []) => keys.indexOf(key) !== index));
        const branchKey = ({ predicate = {}, kind = '', value = '', action = '' } = {}) => (
            JSON.stringify([predicate, kind, value, action])
        );
        const checkedBranches = branches
            .filter(({ predicate = {}, specific = false } = {}) => (
                getPredicateKind(predicate) && (!repeated.has(predicateKey(predicate)) || specific)
            ))
            .filter((branch = {}, index = 0, values = []) => (
                values.findIndex(candidate => branchKey(candidate) === branchKey(branch)) === index
            ))
            .map(({ predicate = {}, kind = '', value = '', action = '', presence = 'unmatched', content = 'not-applicable' } = {}) => (
                { predicate, requirements: getResolverRequirements(predicate), kind, value, action, presence, content }
            ));
        const fallback = { kind: 'any', value: 'input', action: 'preserve', presence: 'unmatched', content: 'not-applicable' };

        return { name, branches: checkedBranches, fallback };
    };

    return { getPredicate, getUnionResolverSource };
};

export { createResolverPolicy, requireResolverCapability, getResolverRequirements };
