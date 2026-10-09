import { getObject } from '../support/object.js';

// This is target grammar, not a broad `isX` naming convention. A binding is
// branch-owned only when the predicate selects one of these executable ADT
// shapes and the selected field is part of that shape.
const specs = Object.freeze([
    { tag: 'Left', fields: ['left'], names: ['isLeft', '_isLeft', '_IsLeft', 'EIsLeft'] },
    { tag: 'Right', fields: ['right'], names: ['isRight', '_isRight', '_IsRight', 'EIsRight'] },
    { tag: 'None', fields: [], names: ['isNone', '_isNone', '_IsNone', 'OIsNone'] },
    { tag: 'Some', fields: ['value'], names: ['isSome', '_isSome', '_IsSome', 'OIsSome'] },
    { tag: 'Both', fields: ['left', 'right'], names: ['isBoth', '_isBoth', '_IsBoth'] }
]);

const getStaticCalleeName = ({ node = {} } = {}) => {
    const { type = '', name = '', computed = false, property = {} } = getObject(node);

    if (type === 'Identifier') return name;

    return type === 'MemberExpression' && !computed ? getObject(property).name : '';
};

const getLiteralValue = ({ node = {} } = {}) => {
    const { type = '', value = '' } = getObject(node);

    return type === 'Literal' && typeof value === 'string' ? value : '';
};

const getTagMemberSubject = ({ node = {} } = {}) => {
    const { type = '', computed = false, object = {}, property = {} } = getObject(node);
    const { type: objectType = '', name = '' } = getObject(object);
    const { name: propertyName = '' } = getObject(property);

    return type === 'MemberExpression' && !computed && objectType === 'Identifier' &&
        ['_tag', 'tag'].includes(propertyName) ? name : '';
};

const getSpec = ({ tag = '' } = {}) => specs.find(({ tag: candidateTag = '' } = {}) => candidateTag === tag) || {};

const getDiscriminantGuard = ({ node = {} } = {}) => {
    const { type = '', callee = {}, arguments: args = [], operator = '', left = {}, right = {} } = getObject(node);

    if (type === 'CallExpression') {
        const [argument = {}] = args;
        const { type: argumentType = '', name: subject = '' } = getObject(argument);
        const name = getStaticCalleeName({ node: callee });
        const spec = specs.find(({ names = [] } = {}) => names.includes(name)) || {};

        const { tag = '' } = spec;

        return argumentType === 'Identifier' && subject && tag ? { subject, ...spec } : {};
    }

    if (type !== 'BinaryExpression' || !['===', '=='].includes(operator)) return {};

    const leftSubject = getTagMemberSubject({ node: left });
    const rightSubject = getTagMemberSubject({ node: right });
    const tag = getLiteralValue({ node: left }) || getLiteralValue({ node: right });
    const subject = leftSubject || rightSubject;
    const spec = getSpec({ tag });

    const { tag: resolvedTag = '' } = spec;

    return subject && resolvedTag ? { subject, ...spec } : {};
};

const getComplement = ({ tag = '' } = {}) => {
    const complements = { Left: 'Right', Right: 'Left', None: 'Some', Some: 'None' };

    const { [tag]: complementTag = '' } = complements;

    return getSpec({ tag: complementTag });
};

export {
    getComplement,
    getDiscriminantGuard,
    getStaticCalleeName,
    specs
};
