import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';

const updateTypeOnlyImport = ({ typescript = {},
    node = {},
    typeOnlyImports = new Set() } = {}) => {
    const { factory = {} } = typescript;
    const {
        NamedImports = -1,
        NamespaceImport = -1
    } = getSyntaxKinds(typescript);
    const {
        importClause = undefined,
        modifiers: nodeModifiers = undefined,
        moduleSpecifier: nodeModuleSpecifier = undefined,
        attributes: nodeAttributes = undefined
    } = getObject(node);

    if (!importClause) return node;

    const {
        isTypeOnly: clauseTypeOnly = false,
        name: clauseName = undefined,
        namedBindings = undefined
    } = getObject(importClause);

    // eslint-disable-next-line resilient/prefer-falsey-returns -- undefined removes a type-only import clause
    if (clauseTypeOnly) return undefined;

    const defaultImport = clauseName &&
        !typeOnlyImports.has(importClause)
        ? clauseName
        : undefined;
    const { kind: bindingsKind = 0, elements: bindingElements = [] } = getObject(namedBindings);
    let nextBindings;

    if (namedBindings && bindingsKind === NamedImports) nextBindings = factory.updateNamedImports(
        namedBindings,
        bindingElements.filter(element => !typeOnlyImports.has(element))
    );

    if (namedBindings && bindingsKind === NamespaceImport &&
        !typeOnlyImports.has(namedBindings)) {
        nextBindings = namedBindings;
    }

    // eslint-disable-next-line resilient/prefer-falsey-returns -- undefined removes an import with no runtime bindings
    if (!defaultImport && !nextBindings) return undefined;

    const nextClause = factory.updateImportClause(importClause, false, defaultImport, nextBindings);

    return factory.updateImportDeclaration(
        node,
        nodeModifiers,
        nextClause,
        nodeModuleSpecifier,
        nodeAttributes
    );
};

export { updateTypeOnlyImport };
