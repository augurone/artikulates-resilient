import { getObject } from '../../../analysis/host/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';

const annotateEmptyNamespaceImport = ({ typescript = {}, node = {}, imports = new Set(), authoredRules = new Set() } = {}) => {
    if (!imports.has(typescript.getOriginalNode(node)) || authoredRules.has('import/namespace')) return node;

    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Import factories require the actual module specifier and native absence for optional compiler fields.
    const { importClause = {}, modifiers, moduleSpecifier, attributes } = node;
    const { isTypeOnly = false, namedBindings = {} } = importClause;
    const { factory = {} } = typescript;
    const binding = namedBindings;

    if (isTypeOnly || !typescript.isNamespaceImport(binding)) return node;

    // The exact namespace specifier owns the finding and its scoped waiver.
    const placed = typescript.setTextRange(factory.cloneNode(binding), binding);
    const { MultiLineCommentTrivia = -1 } = getSyntaxKinds(typescript);
    const documented = typescript.addSyntheticLeadingComment(placed, MultiLineCommentTrivia,
        ' eslint-disable import/namespace -- Empty namespace retains identity and evaluation. ', false);
    const closed = typescript.addSyntheticTrailingComment(documented, MultiLineCommentTrivia, ' eslint-enable import/namespace ', false);

    return factory.updateImportDeclaration(node, modifiers,
        factory.updateImportClause(importClause, false, getObject(importClause).name, closed), moduleSpecifier, attributes);
};

const updateTypeOnlyImport = ({ typescript = {},
    node = {},
    typeOnlyImports = new Set() } = {}) => {
    const { factory = {} } = typescript;
    const {
        NamedImports = -1,
        NamespaceImport = -1
    } = getSyntaxKinds(typescript);
    const {
        importClause,
        modifiers: nodeModifiers,
        moduleSpecifier: nodeModuleSpecifier,
        attributes: nodeAttributes
    } = getObject(node);

    if (!importClause) return node;

    const {
        isTypeOnly: clauseTypeOnly = false,
        name: clauseName,
        namedBindings
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

export { annotateEmptyNamespaceImport, updateTypeOnlyImport };
