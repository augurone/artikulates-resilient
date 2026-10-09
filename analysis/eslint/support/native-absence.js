import { traverse } from '../../traversal.js';

const isNullLiteral = ({ type = '', value = {}, regex = false } = {}) => (
    type === 'Literal' && !regex && value === null
);

const hasDynamicLookup = ({ references = [] } = {}) => references.some(({ identifier = {} } = {}) => {
    const { name = '', parent: { type = '', callee = {}, optional = false } = {} } = identifier;

    return name === 'eval' && type === 'CallExpression' && callee === identifier && !optional;
});

const hasAnnexBUndefined = ({
    type = '', isStrict = false, set = new Map(), variableScope: { type: ownerType = '' } = {}
} = {}) => {
    if (isStrict || ownerType !== 'function' || !['block', 'switch'].includes(type) || !set.has('undefined')) return false;

    const { defs = [] } = set.get('undefined');

    return defs.some(({ type: definitionType = '', node: { type: nodeType = '', async = false, generator = false } = {} } = {}) => (
        definitionType === 'FunctionName' && nodeType === 'FunctionDeclaration' && !async && !generator
    ));
};

const createNativeUndefinedReader = ({ sourceCode = {} } = {}) => {
    const { scopeManager: { scopes = [] } = {} } = sourceCode;
    // Reuse host-owned references instead of replaying syntax or interpreting eval.
    // Sloppy ordinary block functions can also create an outer var binding that
    // the host's lexical scope graph omits. Keep that execution uncertain.
    const uncertain = new Set(scopes.filter(scope => hasDynamicLookup(scope) || hasAnnexBUndefined(scope))
        .map(({ variableScope = false } = {}) => variableScope));
    // The host owns this optional method; the guard below preserves absence and call preserves its required sourceCode receiver.
    const { getScope } = sourceCode;

    return (node = {}) => {
        const { type = '', name = '' } = node ?? {};

        if (type !== 'Identifier' || name !== 'undefined' || typeof getScope !== 'function') return false;

        let native = false;

        traverse(getScope.call(sourceCode, node), { enter: ({ type: scopeType = '', set = new Map(), upper = false, variableScope = false } = {}) => {
            if (scopeType === 'with' || uncertain.has(variableScope)) return [];

            if (set.has(name)) {
                const { defs = [] } = set.get(name);

                native = !defs.length;

                return [];
            }

            if (upper) return [upper];

            native = true;

            return [];
        } });

        return native;
    };
};

export { createNativeUndefinedReader, isNullLiteral };
