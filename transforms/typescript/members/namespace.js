import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';

const getIdentifierText = (node = {}) => {
    const { text = '' } = getObject(node);

    return text;
};

const getModuleBinding = ({ typescript = {}, statement = {} } = {}) => {
    const { ImportDeclaration = -1, NamespaceImport = -1 } = getSyntaxKinds(typescript);
    const { kind = 0, importClause = {}, moduleSpecifier = {} } = getObject(statement);
    const { namedBindings = {}, name: defaultImport = undefined, isTypeOnly = false } = getObject(importClause);
    const { kind: bindingKind = 0, name = {} } = getObject(namedBindings);
    const { text: moduleSpecifierText = '' } = getObject(moduleSpecifier);
    const namespace = getIdentifierText(name);

    if (kind !== ImportDeclaration || isTypeOnly || bindingKind !== NamespaceImport) return {};

    if (!namespace || !moduleSpecifierText) return {};

    return { statement, namespace, moduleSpecifier, defaultImport };
};

const isExported = ({ typescript = {}, statement = {} } = {}) => {
    const { ExportKeyword = -1 } = getSyntaxKinds(typescript);
    const { modifiers = [] } = getObject(statement);

    return modifiers.some((modifier = {}) => getObject(modifier).kind === ExportKeyword);
};

const getTransparentExpression = ({ typescript = {}, node = {} } = {}) => {
    const {
        AsExpression = -1,
        ParenthesizedExpression = -1,
        SatisfiesExpression = -1,
        TypeAssertionExpression = -1
    } = getSyntaxKinds(typescript);
    const transparentKinds = new Set([
        AsExpression,
        ParenthesizedExpression,
        SatisfiesExpression,
        TypeAssertionExpression
    ]);
    const { kind = 0, expression = {} } = getObject(node);

    return transparentKinds.has(kind)
        ? getTransparentExpression({ typescript, node: expression })
        : node;
};

const getPropertyBinding = ({ typescript = {}, declaration = {}, namespace = '' } = {}) => {
    const { Identifier = -1, PropertyAccessExpression = -1 } = getSyntaxKinds(typescript);
    const { name = {}, initializer = {} } = getObject(declaration);
    const memberInitializer = getTransparentExpression({ typescript, node: initializer });
    const { kind: nameKind = 0, text: local = '' } = getObject(name);
    const { kind: initializerKind = 0, expression = {}, name: property = {} } = getObject(memberInitializer);
    const imported = getIdentifierText(property);

    if (nameKind !== Identifier || initializerKind !== PropertyAccessExpression) return {};

    if (getIdentifierText(expression) !== namespace || !local || !imported) return {};

    return { imported, local, reference: expression, localNode: name };
};

const getPatternBindings = ({ typescript = {}, declaration = {}, namespace = '' } = {}) => {
    const { BindingElement = -1, ObjectBindingPattern = -1 } = getSyntaxKinds(typescript);
    const { name = {}, initializer = {} } = getObject(declaration);
    const { kind: nameKind = 0, elements = [] } = getObject(name);

    if (nameKind !== ObjectBindingPattern || getIdentifierText(initializer) !== namespace) return [];

    const bindings = elements.map((element = {}) => {
        const {
            kind = 0,
            dotDotDotToken = false,
            initializer: fallback = undefined,
            propertyName = {},
            name: localName = {}
        } = getObject(element);
        const local = getIdentifierText(localName);
        const imported = getIdentifierText(propertyName) || local;

        if (kind !== BindingElement || dotDotDotToken || fallback || !local || !imported) return {};

        return { imported, local, localNode: localName };
    });

    return bindings.every(({ imported = '', local = '' } = {}) => imported && local)
        ? bindings.map(binding => ({ ...binding, reference: initializer }))
        : [];
};

const getStatementRecord = ({ typescript = {}, statement = {}, namespace = '' } = {}) => {
    const { NodeFlags: { Const = 0 } = {} } = typescript;
    const { VariableStatement = -1 } = getSyntaxKinds(typescript);
    const { kind = 0, declarationList = {} } = getObject(statement);
    const { flags = 0, declarations = [] } = getObject(declarationList);

    if (kind !== VariableStatement || !(flags & Const) || !declarations.length) return {};

    const bindings = declarations.flatMap((declaration = {}) => {
        const property = getPropertyBinding({ typescript, declaration, namespace });
        const { imported = '' } = property;

        if (imported) return [property];

        return getPatternBindings({ typescript, declaration, namespace });
    });

    if (!bindings.length || bindings.length !== declarations.length && declarations.length !== 1) return {};

    return {
        statement,
        bindings,
        references: new Set(bindings.map(({ reference = {} } = {}) => reference)),
        localNodes: new Set(bindings.map(({ localNode = {} } = {}) => localNode)),
        usage: isExported({ typescript, statement }) ? 'direct-reexport' : 'local-alias'
    };
};

const getRecordUsage = ({ typescript = {}, sourceFile = {}, record = {} } = {}) => {
    const { Identifier = -1 } = getSyntaxKinds(typescript);
    const { bindings = [], localNodes = new Set(), usage = '' } = record;

    if (usage !== 'direct-reexport') return record;

    const localNames = new Set(bindings.map(({ local = '' } = {}) => local));
    let hasLocalReference = false;
    const visit = (node = {}) => {
        if (hasLocalReference) return;

        const { kind = 0, parent = {} } = getObject(node);
        const name = getIdentifierText(node);

        const {
            kind: parentKind = 0,
            name: parentName = {}
        } = getObject(parent);
        const { PropertyAccessExpression = -1 } = getSyntaxKinds(typescript);

        // `Namespace.member` contains an Identifier whose text is the member
        // name. It is not a reference to the local alias being re-exported.
        if (parentKind === PropertyAccessExpression && parentName === node) return;

        if (kind === Identifier && localNames.has(name) && !localNodes.has(node)) {
            hasLocalReference = true;

            return;
        }

        typescript.forEachChild(node, visit);
    };

    typescript.forEachChild(sourceFile, visit);

    return hasLocalReference
        ? { ...record, usage: 'exported-local-alias' }
        : record;
};

const getImportPair = (binding = {}) => {
    const { statement = {} } = binding;

    return [statement, binding];
};

const getReplacementPairs = ({ records = [] } = {}) => records.map((record = {}) => {
    const { statement = {}, moduleSpecifier = {} } = record;

    return [statement, { record, moduleSpecifier }];
});

const getReplacementStatements = ({ factory = {}, replacement = {} } = {}) => {
    const { record = {}, moduleSpecifier = {} } = replacement;
    const { bindings = [], usage = '' } = record;

    if (usage === 'local-alias') return [];

    const specifiers = bindings.map(({ imported = '', local = '' } = {}) => {
        // A direct re-export names the original module binding. An exported
        // local alias names the local binding supplied by the split import.
        // Reusing `imported` in the latter form would export a name that is
        // not in this module's lexical scope.
        const propertyName = usage === 'direct-reexport' && imported !== local
            ? factory.createIdentifier(imported)
            : undefined;

        return factory.createExportSpecifier(false, propertyName, factory.createIdentifier(local));
    });
    const source = usage === 'direct-reexport'
        ? factory.createStringLiteral(getIdentifierText(moduleSpecifier), true)
        : undefined;

    return [factory.createExportDeclaration(
        undefined,
        false,
        factory.createNamedExports(specifiers),
        source
    )];
};

const getUpdatedImportStatements = ({ factory = {}, statement = {}, binding = {} } = {}) => {
    const { defaultImport = undefined, moduleSpecifier = {}, records = [], unsupported = false } = binding;
    const localBindings = records
        .filter(({ usage = '' } = {}) => ['local-alias', 'exported-local-alias'].includes(usage))
        .flatMap(({ bindings = [] } = {}) => bindings);

    if (!localBindings.length) return unsupported ? [statement] : [];

    const specifiers = localBindings.map(({ imported = '', local = '' } = {}) => factory.createImportSpecifier(
        false,
        imported === local ? undefined : factory.createIdentifier(imported),
        factory.createIdentifier(local)
    ));
    const { modifiers = undefined, attributes = undefined } = getObject(statement);
    const clause = factory.createImportClause(false, defaultImport, factory.createNamedImports(specifiers));

    const namedImport = factory.updateImportDeclaration(statement, modifiers, clause, moduleSpecifier, attributes);

    return unsupported ? [statement, namedImport] : [namedImport];
};

const lowerImportedNamespaceMemberAccess = ({ typescript = {}, sourceFile = {}, context = {} } = {}) => {
    const { factory = {}, visitEachChild = () => ({}) } = typescript;
    const { Identifier = -1, Block = -1 } = getSyntaxKinds(typescript);
    const { statements = [] } = getObject(sourceFile);
    const candidates = statements
        .map(statement => getModuleBinding({ typescript, statement }))
        .filter(({ namespace = '' } = {}) => namespace)
        .map((binding = {}) => {
            const { namespace = '' } = binding;
            let records = [];
            const collect = (node = {}) => {
                const record = getStatementRecord({ typescript, statement: node, namespace });

                const { bindings = [] } = getObject(record);

                if (bindings.length) records = [...records, record];

                typescript.forEachChild(node, collect);
            };

            typescript.forEachChild(sourceFile, collect);
            const resolvedRecords = records.map(record => getRecordUsage({ typescript, sourceFile, record }));
            const references = new Set(resolvedRecords.flatMap(({ references = new Set() } = {}) => [...references]));

            return { ...binding, records: resolvedRecords, references };
        });
    const boundedCandidates = candidates.map((binding = {}) => {
        const {
            namespace = '',
            references = new Set(),
            statement = {}
        } = binding;
        let unsupported = false;
        const visit = (node = {}) => {
            if (unsupported || node === statement) return;

            const { kind = 0 } = getObject(node);

            if (kind === Identifier && getIdentifierText(node) === namespace && !references.has(node)) {
                unsupported = true;

                return;
            }

            typescript.forEachChild(node, visit);
        };

        typescript.forEachChild(sourceFile, visit);

        return { ...binding, unsupported };
    });

    const usable = boundedCandidates.filter(({ records = [] } = {}) => records.length);
    const replaceable = boundedCandidates.flatMap(({ records = [], moduleSpecifier = {} } = {}) => {
        return records
            .map(record => ({ ...record, moduleSpecifier }));
    });

    if (!usable.length && !replaceable.length) return sourceFile;

    const usableByImport = new Map(usable.map(getImportPair));
    const replacementByStatement = new Map(getReplacementPairs({ records: replaceable }));
    const replaceStatements = (items = []) => items.flatMap((statement = {}) => {
        const importBinding = usableByImport.get(statement);
        const replacement = replacementByStatement.get(statement);

        if (importBinding) return getUpdatedImportStatements({ factory, statement, binding: importBinding });

        return replacement
            ? getReplacementStatements({ factory, replacement })
            : [statement];
    });
    const nextStatements = replaceStatements(statements);
    const updatedSource = factory.updateSourceFile(sourceFile, nextStatements);

    if (!context || typeof context !== 'object') return updatedSource;

    const visit = (node = {}) => {
        const { kind = 0, statements: childStatements = [] } = getObject(node);

        if (kind === Block) return factory.updateBlock(node, replaceStatements(childStatements).map(statement => (
            visitEachChild(statement, visit, context)
        )));

        return visitEachChild(node, visit, context);
    };

    return visitEachChild(updatedSource, visit, context);
};

export { getModuleBinding, lowerImportedNamespaceMemberAccess };
