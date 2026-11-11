import { isFunction } from '../../../analysis/host/function.js';
import { getObject } from '../../../analysis/host/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';
import { hasTypeChecker } from '../../utils/compiler-shape.js';
import { createSourceCensus } from './source-census.js';
import {
    getCheckerContract,
    getIdentifierName,
    getIndexedAccessMemberTypes,
    getTypeMembers,
    getTypeText
} from './type-evidence.js';

const getRuntimeReferences = ({ typescript = {}, sourceFile = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    let references = new Set();
    const { CallExpression = -1 } = getSyntaxKinds(typescript);
    const visit = (node) => {
        const { kind: nodeKind = 0, expression: nodeExpr = {} } = getObject(node);

        const name = getIdentifierName({ typescript, node: nodeExpr });

        if (nodeKind === CallExpression && name) references = new Set([...references, name]);
    };

    census.select(CallExpression).forEach(visit);

    return references;
};

const isTypeOnlyNamespace = ({ typescript = {}, node = {} } = {}) => {
    const {
        InterfaceDeclaration = -1,
        TypeAliasDeclaration = -1,
        ModuleDeclaration = -1,
        ModuleBlock = -1
    } = getSyntaxKinds(typescript);
    const { body = {} } = getObject(node);
    const { kind: bodyKind = 0, statements: bodyStatements = [] } = getObject(body);

    if (bodyKind === ModuleDeclaration) return isTypeOnlyNamespace({
        typescript,
        node: body
    });

    if (bodyKind !== ModuleBlock) return false;

    return bodyStatements.every((statement = {}) => {
        const { kind: statementKind = 0 } = getObject(statement);

        if ([InterfaceDeclaration, TypeAliasDeclaration].includes(statementKind)) return true;

        return statementKind === ModuleDeclaration && isTypeOnlyNamespace({ typescript, node: statement });
    });
};

const collectEmptyNamespaceImports = ({ typescript = {}, sourceFile = {}, checker = {}, program = {},
    census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const imports = new Set();
    const modules = new Map();
    const { getSymbolAtLocation } = getObject(checker);
    const { getSourceFile, isSourceFileFromExternalLibrary } = getObject(program);

    if (!isFunction(getSymbolAtLocation) || !isFunction(getSourceFile) || !isFunction(isSourceFileFromExternalLibrary)) return imports;

    const erasedStatement = (node) => {
        if (typescript.isInterfaceDeclaration(node) || typescript.isTypeAliasDeclaration(node) ||
            typescript.isImportDeclaration(node) || typescript.isEmptyStatement(node)) return true;

        if (!typescript.isExportDeclaration(node)) return false;

        const { isTypeOnly = false, exportClause = {} } = node;
        const { elements = false } = exportClause;

        return isTypeOnly || typescript.isNamedExports(exportClause) && Array.isArray(elements) &&
            elements.every(({ isTypeOnly = false } = {}) => isTypeOnly);
    };
    const ownedSource = (node) => {
        const { isDeclarationFile = false, fileName = '' } = getObject(node);

        return typescript.isSourceFile(node) && !isDeclarationFile && getSourceFile.call(program, fileName) === node &&
            !isSourceFileFromExternalLibrary.call(program, node);
    };
    const erasedModule = (symbol) => {
        const { declarations = [] } = getObject(symbol);
        const targets = declarations.filter(declaration => typescript.isSourceFile(declaration));
        const [target = {}] = targets;
        const { statements = false } = target;

        // Runtime declarations can demand exported models. Only the actual
        // source and owned, compiler-bound type-only augmentations close it.
        if (targets.length !== 1 || !ownedSource(target) || !Array.isArray(statements)) return false;

        const erasedDeclarations = declarations.every(declaration => declaration === target ||
            typescript.isModuleDeclaration(declaration) && typescript.isExternalModuleAugmentation(declaration) &&
            ownedSource(declaration.getSourceFile()) && isTypeOnlyNamespace({ typescript, node: declaration }));

        // Bare imports preserve evaluation and failure without adding exports.
        // The namespace specifier still owns its identity boundary.
        return erasedDeclarations && statements.every(erasedStatement);
    };
    const { ImportDeclaration = -1 } = getSyntaxKinds(typescript);
    census.select(ImportDeclaration).forEach((node) => {
        const { importClause = {}, moduleSpecifier = {} } = node;
        const { isTypeOnly = false, namedBindings = {} } = importClause;

        if (isTypeOnly || !typescript.isNamespaceImport(namedBindings)) return;

        const symbol = getSymbolAtLocation.call(checker, moduleSpecifier);

        if (!symbol) return;

        if (!modules.has(symbol)) {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private symbol-identity memo computes each merged module's owned source and augmentation erasure once per transform.
            modules.set(symbol, erasedModule(symbol));
        }

        if (modules.get(symbol)) {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private evidence set records only the original namespace import owners proved to target an erased module.
            imports.add(node);
        }
    });

    return imports;
};

const getBindingNames = ({ typescript = {}, node = {} } = {}) => {
    const { Identifier = -1 } = getSyntaxKinds(typescript);
    let names = [];
    const visit = (child) => {
        const { kind: childKind = 0, text: childText = '' } = getObject(child);

        if (childKind === Identifier) names = [...names, childText];

        typescript.forEachChild(child, visit);
    };

    const { kind: nodeKind = 0, text: nodeText = '' } = getObject(node);

    if (nodeKind === Identifier) return [nodeText].filter(Boolean);

    visit(node);

    return names.filter(Boolean);
};

const getImportClause = ({ typescript = {}, node = {} } = {}) => {
    const { ImportClause = -1 } = getSyntaxKinds(typescript);
    const { parent = {} } = getObject(node);
    const { parent: grandparent = {} } = getObject(parent);
    const { kind: nodeKind = 0 } = getObject(node);

    if (nodeKind === ImportClause) return node;

    const { kind: parentKind = 0 } = getObject(parent);

    if (parentKind === ImportClause) return parent;

    const { kind: grandparentKind = 0 } = getObject(grandparent);

    if (grandparentKind === ImportClause) return grandparent;

    return {};
};

const isTypePosition = ({ typescript = {}, node = {} } = {}) => {
    const {
        SyntaxKind: {
            SourceFile: SourceFileKind3 = -1
        } = {},
        isTypeNode
    } = typescript;
    const { parent: initialParent = false } = getObject(node);
    let parent = initialParent;

    // eslint-disable-next-line resilient/prefer-prototype-methods -- Type-node detection reads parent before type query; SourceFile stops before the query.
    while (parent) {
        const { kind: parentKind = 0, parent: nextParent = false } = getObject(parent);

        if (parentKind === SourceFileKind3) return false;

        if (isFunction(isTypeNode) && isTypeNode(parent)) return true;

        parent = nextParent;
    }

    return false;
};

const isTypeOnlyImportBinding = ({ typescript = {},
    sourceFile = {},
    checker = {},
    node = {},
    census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        SyntaxKind: {
            ExportSpecifier: ExportSpecifierKind2 = -1,
            Identifier: IdentifierKind4 = -1
        } = {}
    } = typescript;
    const { isTypeOnly: nodeTypeOnly = false, name: nodeNameObj = {} } = getObject(node);
    const importClause = getImportClause({ typescript, node });
    const { isTypeOnly: clauseTypeOnly = false } = getObject(importClause);

    if (nodeTypeOnly || clauseTypeOnly) return true;

    const { getSymbolAtLocation, getExportSpecifierLocalTargetSymbol } = getObject(checker);

    if (!isFunction(getSymbolAtLocation)) return false;

    const symbolTarget = (nodeNameObj && typeof nodeNameObj === 'object' && Object.keys(nodeNameObj).length) ? nodeNameObj : node;
    const symbol = getSymbolAtLocation.call(checker, symbolTarget);

    if (!symbol) return false;

    const { text: nodeTargetText = '' } = getObject(symbolTarget);
    let runtimeUse = false;
    const visit = (child) => {
        if (runtimeUse || child === node || census.ancestors(child).includes(node)) return;

        const { parent: childParent = {} } = getObject(child);
        const { parent: exportDeclaration = {} } = getObject(childParent);
        const {
            kind: childKind = 0,
            isTypeOnly: childTypeOnly = false,
            text: childText = ''
        } = getObject(child);
        const { isTypeOnly: exportTypeOnly = false } = getObject(exportDeclaration);

        if (childKind === ExportSpecifierKind2 &&
            !childTypeOnly &&
            !exportTypeOnly &&
            isFunction(getExportSpecifierLocalTargetSymbol) &&
            getExportSpecifierLocalTargetSymbol.call(checker, child) === symbol) runtimeUse = true;

        if (childKind === IdentifierKind4 &&
            childText === nodeTargetText &&
            getSymbolAtLocation.call(checker, child) === symbol &&
            !isTypePosition({ typescript, node: child })) runtimeUse = true;
    };

    census.select(IdentifierKind4, ExportSpecifierKind2).forEach(visit);

    return !runtimeUse;
};

const getRuntimeNames = ({ typescript = {}, sourceFile = {}, checker = {}, census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        VariableDeclaration = -1,
        FunctionDeclaration = -1,
        ClassDeclaration = -1,
        EnumDeclaration = -1,
        ImportClause = -1,
        ImportSpecifier = -1,
        NamespaceImport = -1
    } = getSyntaxKinds(typescript);
    let names = new Set();
    const visit = (node) => {
        const {
            kind: nodeKind = 0,
            name: nodeName = {},
            propertyName: nodePropertyName = {}
        } = getObject(node);
        const { text: nodeNameText = '' } = getObject(nodeName);

        if (nodeKind === VariableDeclaration) getBindingNames({ typescript, node: nodeName }).forEach((name) => {
            names = new Set([...names, name]);
        });

        if ([FunctionDeclaration, ClassDeclaration, EnumDeclaration].includes(nodeKind) && nodeNameText) names = new Set([...names, nodeNameText]);

        if (![ImportClause, ImportSpecifier, NamespaceImport].includes(nodeKind)) {
            return;
        }

        const nameTarget = nodeNameText ? nodeName : nodePropertyName;
        const { text: targetText = '' } = getObject(nameTarget);
        const typeOnly = isTypeOnlyImportBinding({ typescript, sourceFile, checker, census, node });

        if (!typeOnly && targetText) names = new Set([...names, targetText]);
    };

    census.select(VariableDeclaration, FunctionDeclaration, ClassDeclaration, EnumDeclaration,
        ImportClause, ImportSpecifier, NamespaceImport).forEach(visit);

    return names;
};

const isReferenceIdentifier = ({ typescript = {}, node = {}, parent = getObject(node).parent } = {}) => {
    const {
        BindingElement = -1,
        FunctionDeclaration = -1,
        FunctionExpression = -1,
        MethodDeclaration = -1,
        Parameter = -1,
        PropertyAccessExpression = -1,
        PropertyAssignment = -1,
        SetAccessor = -1,
        GetAccessor = -1,
        VariableDeclaration = -1
    } = getSyntaxKinds(typescript);
    const {
        name: parentName = {},
        kind: parentKind = 0,
        propertyName: parentPropName = {}
    } = getObject(parent);
    const declarationNameKinds = new Set([
        BindingElement,
        FunctionDeclaration,
        FunctionExpression,
        MethodDeclaration,
        Parameter,
        PropertyAssignment,
        SetAccessor,
        GetAccessor,
        VariableDeclaration
    ]);

    if (parentName === node && declarationNameKinds.has(parentKind)) return false;

    if (parentName === node && parentKind === PropertyAccessExpression) return false;

    return parentPropName !== node;
};

const hasMutationFor = ({ typescript = {}, sourceFile = {}, name = '' , census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        BinaryExpression = -1,
        PrefixUnaryExpression = -1,
        PostfixUnaryExpression = -1,
        FirstAssignment = -1,
        LastAssignment = -1,
        PlusPlusToken = -1,
        MinusMinusToken = -1
    } = getSyntaxKinds(typescript);
    let mutated = false;
    const visit = (node) => {
        if (mutated) return;

        const {
            kind: nodeKind = 0,
            left: nodeLeft = {},
            operatorToken: nodeOpToken = {},
            operator: nodeOp = 0
        } = getObject(node);
        const { text: leftText = '' } = getObject(nodeLeft);
        const { kind: opTokenKind = 0 } = getObject(nodeOpToken);

        if (nodeKind === BinaryExpression && leftText === name && opTokenKind >= FirstAssignment && opTokenKind <= LastAssignment) mutated = true;

        if ([PrefixUnaryExpression, PostfixUnaryExpression].includes(nodeKind) && [PlusPlusToken, MinusMinusToken].includes(nodeOp)) mutated = true;
    };

    census.select(BinaryExpression, PrefixUnaryExpression, PostfixUnaryExpression).forEach(visit);

    return mutated;
};

const getUnsupportedTypeDiagnostics = ({ typescript = {},
    sourceFile = {},
    declarations = {},
    checker = {},
    census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        MappedType = -1,
        IndexedAccessType = -1,
        TemplateLiteralType = -1,
        InferType = -1,
        ImportType = -1,
        TypeOperator = -1,
        UniqueKeyword = -1
    } = getSyntaxKinds(typescript);
    let diagnostics = [];
    const unsupportedKinds = new Set([TemplateLiteralType, InferType, ImportType]);
    const { fileName: sfFileName = '' } = getObject(sourceFile);
    const { __checker: cachedChecker = {} } = getObject(declarations);
    const { SyntaxKind: tsSyntaxKinds = {} } = getObject(typescript);
    const visit = (node, parent = {}) => {
        const activeChecker = checker && hasTypeChecker(checker) ? checker : cachedChecker;
        const { kind: nodeKind = 0, operator = 0 } = getObject(node);
        const { kind: parentKind = 0 } = getObject(parent);
        const checkerCandidate = unsupportedKinds.has(nodeKind) || nodeKind === IndexedAccessType || nodeKind === MappedType || (nodeKind === TypeOperator && operator === UniqueKeyword);
        const checkerType = checkerCandidate && hasTypeChecker(activeChecker) ? activeChecker.getTypeAtLocation(node) : undefined;
        const checkerEvidence = Boolean(checkerType);
        const checkerContract = getCheckerContract({
            typescript,
            node,
            checker,
            declarations,
            typeText: getTypeText({ node, sourceFile })
        });
        const { kind: checkerContractKind = '' } = checkerContract;
        const checkerResolved = ['array', 'bigint', 'boolean', 'function', 'number', 'object', 'string'].includes(checkerContractKind);
        const unsupportedOperator = nodeKind === TypeOperator && operator === UniqueKeyword && !checkerEvidence;
        const unresolvedIndexedAccess = nodeKind === IndexedAccessType && parentKind !== MappedType && !getIndexedAccessMemberTypes({ typescript, node, declarations }).length;
        const unresolvedMappedType = nodeKind === MappedType && !getTypeMembers({ typescript, node, declarations }).length;
        const unresolvedUnsupportedKind = unsupportedKinds.has(nodeKind) && !checkerResolved && !checkerEvidence;
        const { [nodeKind]: syntaxKindName = 'UnsupportedType' } = getObject(tsSyntaxKinds);

        const isUnresolvedIndexed = unresolvedIndexedAccess && !checkerResolved && !checkerEvidence;
        const isUnresolvedMapped = unresolvedMappedType && !checkerResolved && !checkerEvidence;

        if (unresolvedUnsupportedKind || unsupportedOperator || isUnresolvedIndexed || isUnresolvedMapped) diagnostics = [...diagnostics, {
            fileName: sfFileName,
            kind: syntaxKindName,
            text: getTypeText({ node, sourceFile })
        }];
    };

    const { Identifier = -1, PropertyAccessExpression = -1, ElementAccessExpression = -1,
        TypeReference = -1 } = getSyntaxKinds(typescript);
    census.select(Identifier, PropertyAccessExpression, ElementAccessExpression, TypeReference,
        MappedType, IndexedAccessType, TemplateLiteralType, InferType, ImportType, TypeOperator)
        .forEach(node => visit(node, getObject(node).parent));

    return diagnostics;
};

export {
    collectEmptyNamespaceImports,
    getBindingNames,
    getRuntimeNames,
    getRuntimeReferences,
    getUnsupportedTypeDiagnostics,
    hasMutationFor,
    isReferenceIdentifier,
    isTypeOnlyImportBinding,
    isTypeOnlyNamespace
};
