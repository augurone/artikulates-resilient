import { isFunction } from '../../../analysis/host/function.js';
// Source lexical fallback for the standalone adapter. Unknown or generated
// identifiers have no owner; equal spelling in another scope is not identity.
const getSourceBinding = ({ typescript = {}, node = {}, checker = {} } = {}) => {
    const { getSymbolAtLocation } = checker;
    const { isParameter = () => false, isBindingElement = () => false, isVariableDeclaration = () => false } = typescript;

    if (isFunction(getSymbolAtLocation)) return getSymbolAtLocation.call(checker, node) || false;

    const { parent: nodeParent = false } = node;

    if (!nodeParent || !typescript.isIdentifier(node)) return false;

    const { text = '' } = node;
    const names = (pattern = {}) => {
        const { elements = [], name = {} } = pattern;

        if (typescript.isIdentifier(pattern)) return [pattern];

        if (typescript.isBindingElement(pattern)) return names(name);

        return elements.flatMap(names);
    };
    let current = nodeParent;
    // eslint-disable-next-line resilient/prefer-prototype-methods -- Resolve the nearest source declaration before ascending; generated nodes remain unknown.
    while (current) {
        const { name = {}, parameters = [], statements = [], parent = false } = current;
        const own = [isParameter, isBindingElement, isVariableDeclaration]
            .some(accepts => accepts(current)) ? names(name).find(candidate => candidate === node) : false;

        if (own) return own;

        const locals = statements.flatMap(({ name: declared = {}, declarationList = {}, importClause = {} } = {}) => {
            const { declarations = [] } = declarationList;
            const { name: imported = {}, namedBindings = {} } = importClause;
            const { name: namespace = {}, elements = [] } = namedBindings;

            return [...names(declared), ...declarations.flatMap(({ name: binding = {} } = {}) => names(binding)),
                ...names(imported), ...names(namespace), ...elements.flatMap(({ name: binding = {} } = {}) => names(binding))];
        });
        const local = locals.find(({ text: candidate = '' } = {}) => candidate === text);

        if (local) return local;

        const parameter = parameters.flatMap(({ name: binding = {} } = {}) => names(binding))
            .find(({ text: candidate = '' } = {}) => candidate === text);

        if (parameter) return parameter;

        current = parent;
    }

    return false;
};

export { getSourceBinding };
