import { getObject, isObject } from '../../../rules/support/object.js';
import { getContractFamily, lookupMember, normalizeContract, projectMembers, reduceContracts, relateContracts } from '../../policy/contract.js';
import { getNodeText, getSyntaxKinds } from '../../utils/ast-boundary.js';
import { hasTypeChecker } from '../../utils/compiler-shape.js';
import { getBindingReason } from '../policy/binding-reason.js';
import { createResolverPolicy } from '../policy/resolvers.js';

const requireCompilerMember = (name = '') => {
    throw new TypeError(`Missing TypeScript compiler agreement for ${name}`);
};

const isUnionType = (type) => {
    const candidate = getObject(type);
    const { isUnion = false } = candidate;

    return typeof isUnion === 'function' && isUnion.call(candidate);
};

const primitiveKinds = ({ typescript = {} } = {}) => {
    const {
        StringKeyword = -1,
        NumberKeyword = -1,
        BooleanKeyword = -1,
        BigIntKeyword = -1,
        SymbolKeyword = -1,
        ArrayType = -1,
        TupleType = -1,
        FunctionType = -1,
        ConstructorType = -1,
        IntersectionType = -1,
        TypeLiteral = -1
    } = getSyntaxKinds(typescript);

    return {
        [StringKeyword]: 'string',
        [NumberKeyword]: 'number',
        [BooleanKeyword]: 'boolean',
        [BigIntKeyword]: 'bigint',
        [SymbolKeyword]: 'symbol',
        [ArrayType]: 'array',
        [TupleType]: 'array',
        [FunctionType]: 'function',
        [ConstructorType]: 'function',
        [IntersectionType]: 'object',
        [TypeLiteral]: 'object'
    };
};

const getTypeText = getNodeText;

const getCanonical = (kind = '') => ({
    string: "''",
    number: '0',
    boolean: 'false',
    bigint: '0n',
    array: '[]',
    object: '{}'
}[kind] || '');

const getRuntimeKind = (contract = {}) => getContractFamily(contract);

const getAgreementReason = ({
    typescript = {},
    checker = {},
    node = {},
    kind = ''
} = {}) => {
    const { TypeFlags: { TypeParameter = 0, Any = 0, Unknown = 0 } = {} } = typescript;
    const { parent = false } = getObject(node);
    // Checker facts belong to original TypeScript nodes. Grammar-created nodes
    // have no source parent and must retain their completed agreement instead
    // of being reinterpreted as fresh checker input by a later placement pass.
    const type = hasTypeChecker(checker) && parent ? checker.getTypeAtLocation(node) : {};
    const { flags = 0 } = getObject(type);
    const genericFlags = TypeParameter | Any | Unknown;

    return getBindingReason({ kind, union: isUnionType(type), opaque: Boolean(type && genericFlags && (flags & genericFlags)) });
};

const getFamilyCheck = (kind = '') => ({
    string: "typeof VALUE === 'string'",
    number: "typeof VALUE === 'number'",
    boolean: "typeof VALUE === 'boolean'",
    bigint: "typeof VALUE === 'bigint'",
    symbol: "typeof VALUE === 'symbol'",
    array: 'Array.isArray(VALUE)',
    object: 'isObject(VALUE)',
    function: "typeof VALUE === 'function'"
}[kind] || '');

const getConstructorContract = ({ typescript = {}, checker = {}, node = {}, type = {} } = {}) => {
    const { getSymbol = requireCompilerMember('Type.getSymbol') } = type;
    const symbol = getSymbol.call(type);

    if (!symbol) return {};

    const { getName: getSymbolName = requireCompilerMember('Symbol.getName'), valueDeclaration = false } = symbol;
    const name = getSymbolName.call(symbol);

    if (!name || !valueDeclaration) return {};

    const { SymbolFlags: { Value = 0 } = {} } = typescript;
    const { resolveName = requireCompilerMember('TypeChecker.resolveName') } = checker;
    const visibleSymbol = resolveName.call(checker, name, node, Value, false);

    if (visibleSymbol !== symbol) return {};

    const constructor = checker.getTypeOfSymbolAtLocation(symbol, node);
    const signatures = constructor.getConstructSignatures();
    const constructsInstance = signatures.some(signature => checker.getReturnTypeOfSignature(signature).getSymbol() === symbol);

    if (!constructsInstance) return {};

    return { kind: 'object', constructorName: name, check: `VALUE instanceof ${name}` };
};

const getCheckerContract = ({
    typescript = {},
    node = {},
    checker = {},
    declarations = {},
    typeText = ''
} = {}) => {
    const { __checker: cachedChecker = {} } = declarations;
    const activeChecker = hasTypeChecker(checker)
        ? checker
        : getObject(cachedChecker);
    const {
        Identifier = -1,
        PropertyAccessExpression = -1,
        ElementAccessExpression = -1,
        TypeReference = -1,
        IndexedAccessType = -1,
        ImportType = -1,
        MappedType = -1,
        TemplateLiteralType = -1,
        TypeOperator = -1
    } = getSyntaxKinds(typescript);
    const { TypeFlags = {} } = typescript;
    const { Undefined = 0, Null = 0, Never = 0, Any = 0, Unknown = 0, Object: objectFlags = 0 } = TypeFlags;
    const { kind: nodeKind = 0 } = node;
    // eslint-disable-next-line no-use-before-define -- checker contract delegates identifier naming to the shared name helper
    const identifierName = getIdentifierName({ typescript, node });

    if (!hasTypeChecker(activeChecker) ||
        ![Identifier, PropertyAccessExpression, ElementAccessExpression, TypeReference, IndexedAccessType, ImportType, MappedType, TemplateLiteralType, TypeOperator]
            .includes(nodeKind)) return {};

    const type = activeChecker.getTypeAtLocation(node);
    const { types = [] } = type;
    const parts = isUnionType(type)
        ? types
        : [type];
    const absenceFlags = Undefined | Null | Never;
    const definedParts = parts.filter(({ flags = 0 } = {}) => !(flags & absenceFlags));
    const families = [
        ['StringLike', 'string'],
        ['NumberLike', 'number'],
        ['BooleanLike', 'boolean'],
        ['BigIntLike', 'bigint'],
        ['ESSymbolLike', 'symbol']
    ];
    const family = families.find(([flag = '']) => {
        const { [flag]: mask = 0 } = TypeFlags;

        return mask && definedParts.length && definedParts.every(({ flags = 0 } = {}) => flags & mask);
    });

    if (family) {
        const [, kind = ''] = family;

        return {
            kind,
            canonical: getCanonical(kind),
            check: getFamilyCheck(kind),
            optional: parts.length !== definedParts.length,
            typeText
        };
    }

    const requiredFlags = Any | Unknown;

    if (requiredFlags && definedParts.length && definedParts.every(({ flags = 0 } = {}) => flags & requiredFlags)) return {
        kind: 'required',
        requiresGuard: true,
        typeText
    };

    const [firstPart = {}] = definedParts;
    const { flags: firstFlags = 0 } = firstPart;
    const { getCallSignatures = false } = firstPart;
    const hasCallSignature = definedParts.length === 1 &&
        typeof getCallSignatures === 'function' &&
        !!firstPart.getCallSignatures().length;

    if (identifierName === 'Function' || hasCallSignature) return {
        kind: 'function',
        check: getFamilyCheck('function'),
        optional: parts.length !== definedParts.length,
        typeText
    };

    const {
        isArrayType: isArrayTypeFunction,
        isTupleType: isTupleTypeFunction
    } = activeChecker;
    // eslint-disable-next-line no-use-before-define -- checker contract resolves declarations through the shared declaration helper
    const { kind: declarationKind = 0 } = getDeclaration({
        declarations,
        name: identifierName
    });
    const isObjectType = definedParts.length === 1 && objectFlags && !!(firstFlags & objectFlags) && !declarationKind;
    const isArrayType = definedParts.length === 1 &&
        ((typeof isArrayTypeFunction === 'function' && isArrayTypeFunction(firstPart)) ||
            (typeof isTupleTypeFunction === 'function' && isTupleTypeFunction(firstPart)));

    if (isArrayType) return {
        kind: 'array',
        canonical: '[]',
        check: getFamilyCheck('array'),
        optional: parts.length !== definedParts.length,
        typeText
    };

    if (isObjectType) {
        const constructorContract = getConstructorContract({ typescript, checker: activeChecker, node, type: firstPart });
        const { kind = '' } = constructorContract;

        return {
            ...(kind ? constructorContract : { kind: 'object', canonical: '{}', check: getFamilyCheck('object') }),
            optional: parts.length !== definedParts.length,
            typeText
        };
    }

    return {};
};

const getCheckerTypeNode = ({
    typescript = {},
    node = {},
    checker = {},
    declarations = {}
} = {}) => {
    const { __checker: cachedChecker = {} } = declarations;
    const activeChecker = hasTypeChecker(checker)
        ? checker
        : getObject(cachedChecker);
    const {
        IndexedAccessType = -1,
        ImportType = -1
    } = getSyntaxKinds(typescript);
    const { NodeBuilderFlags: { NoTruncation = 0 } = {} } = typescript;
    const { kind = 0 } = node;
    const { typeToTypeNode = false } = activeChecker;

    if (!hasTypeChecker(activeChecker) ||
        typeof typeToTypeNode !== 'function' ||
        ![IndexedAccessType, ImportType].includes(kind)) return {};

    const type = activeChecker.getTypeAtLocation(node);
    const typeNode = activeChecker.typeToTypeNode(
        type,
        node,
        NoTruncation
    );

    if (!typeNode) return {};

    const { kind: convertedKind = 0 } = typeNode;

    return convertedKind !== kind ? typeNode : {};
};

const getLiteralPredicate = ({
    typescript = {},
    node: { kind = 0, literal: { kind: literalKind = 0, text = '' } = {} } = {}
} = {}) => {
    const { LiteralType = -1, StringLiteral = -1, NoSubstitutionTemplateLiteral = -1,
        NumericLiteral = -1, TrueKeyword = -1, FalseKeyword = -1 } = getSyntaxKinds(typescript);

    if (kind !== LiteralType) return {};

    if ([StringLiteral, NoSubstitutionTemplateLiteral].includes(literalKind)) return { kind: 'literal', value: text };

    if (literalKind === NumericLiteral) return { kind: 'literal', value: Number(text) };

    if (literalKind === TrueKeyword) return { kind: 'literal', value: true };

    if (literalKind === FalseKeyword) return { kind: 'literal', value: false };

    return {};
};

const getLiteralCheck = (options = {}) => {
    const predicate = getLiteralPredicate(options);
    const { kind = '', value = undefined } = predicate;

    return kind ? `VALUE === ${JSON.stringify(value)}` : '';
};

const getLiteralRuntimeKind = ({
    typescript = {},
    node: { kind = 0, literal: { kind: literalKind = 0 } = {} } = {}
} = {}) => {
    const {
        LiteralType = -1,
        StringLiteral = -1,
        NoSubstitutionTemplateLiteral = -1,
        NumericLiteral = -1,
        BigIntLiteral = -1,
        TrueKeyword = -1,
        FalseKeyword = -1
    } = getSyntaxKinds(typescript);

    if (kind !== LiteralType) return '';

    if ([StringLiteral, NoSubstitutionTemplateLiteral].includes(literalKind)) return 'string';

    if (literalKind === NumericLiteral) return 'number';

    if (literalKind === BigIntLiteral) return 'bigint';

    if ([TrueKeyword, FalseKeyword].includes(literalKind)) return 'boolean';

    return '';
};

const getName = ({
    typescript = {},
    node: { name: { kind = 0, text = '' } = {} } = {}
} = {}) => {
    const { Identifier = -1, StringLiteral = -1 } = getSyntaxKinds(typescript);

    return [Identifier, StringLiteral].includes(kind) ? text : '';
};

const getQualifiedName = ({
    typescript = {},
    node: {
        kind = 0,
        text = '',
        left: leftNode = {},
        right: rightNode = {},
        expression = {},
        name = {}
    } = {}
} = {}) => {
    const {
        Identifier = -1,
        QualifiedName = -1,
        PropertyAccessExpression = -1
    } = getSyntaxKinds(typescript);

    if (kind === Identifier) return text;

    if ([QualifiedName, PropertyAccessExpression].includes(kind)) {
        const left = getQualifiedName({ typescript, node: leftNode && isObject(leftNode) ? leftNode : expression });
        const right = getQualifiedName({ typescript, node: rightNode && isObject(rightNode) ? rightNode : name });

        return [left, right].filter(Boolean).join('.');
    }

    return '';
};

const getIdentifierName = ({ typescript = {}, node = {} } = {}) => {
    const { Identifier = -1, TypeReference = -1 } = getSyntaxKinds(typescript);

    const { kind: nodeKind = 0, text = '', typeName = {} } = node;

    if (nodeKind === Identifier && typeof text === 'string') return text;

    if (nodeKind === TypeReference) return getIdentifierName({
        typescript,
        node: typeName
    });

    return getQualifiedName({ typescript, node });
};

const getCallExpressionName = ({
    typescript = {},
    node: { expression: { kind = 0, text = '', name: { text: propertyName = '' } = {} } = {} } = {}
} = {}) => {
    const {
        Identifier = -1,
        PropertyAccessExpression = -1
    } = getSyntaxKinds(typescript);

    if (kind === Identifier) return text;

    if (kind === PropertyAccessExpression) return propertyName;

    return '';
};

const getCallIdentifierArgument = ({ typescript = {}, node: { arguments: args = [] } = {} } = {}) => {
    const { Identifier = -1 } = getSyntaxKinds(typescript);
    const argument = args.find(({ kind = 0 } = {}) => kind === Identifier);

    if (!argument) return '';

    const { text = '' } = argument;

    return text;
};

const getDeclarationEntries = ({ typescript = {}, node = {}, prefix = '' } = {}) => {
    const {
        TypeAliasDeclaration = -1,
        InterfaceDeclaration = -1,
        ModuleDeclaration = -1,
        ModuleBlock = -1
    } = getSyntaxKinds(typescript);
    const { kind = 0, name: { text: name = '' } = {}, body = {}, statements = [] } = node;
    const qualifiedName = [prefix, name].filter(Boolean).join('.');

    if ([TypeAliasDeclaration, InterfaceDeclaration].includes(kind)) {
        return qualifiedName ? [[qualifiedName, node]] : [];
    }

    if (kind === ModuleDeclaration) return getDeclarationEntries({
        typescript,
        node: body,
        prefix: qualifiedName
    });

    if (kind === ModuleBlock) return statements.flatMap(statement => getDeclarationEntries({
        typescript,
        node: statement,
        prefix
    }));

    return [];
};

const getDeclarationMap = ({ typescript = {}, sourceFile: { statements = [] } = {} } = {}) => {
    const declarations = statements.flatMap(statement => getDeclarationEntries({
        typescript,
        node: statement
    }));

    return Object.fromEntries(declarations.filter(([name = '']) => name));
};

const getDeclarationEntry = ({ declarations = {}, name = '' } = {}) => {
    const { [name]: direct = false } = declarations;

    if (direct) return [name, direct];

    const matches = Object.entries(declarations).filter(([declarationName = '']) => (
        declarationName.split('.').at(-1) === name
    ));

    const [match = []] = matches;

    return matches.length === 1 ? match : ['', {}];
};

const getDeclaration = ({ declarations = {}, name = '', fallback = {} } = {}) => {
    const declarationEntry = getDeclarationEntry({ declarations, name });
    const [declarationValue = false] = declarationEntry.slice(1);
    const declaration = getObject(declarationValue);

    const { kind: declarationKind = 0 } = getObject(declaration);

    return declarationKind ? declaration : fallback;
};

const getProgramDeclarationMap = ({ typescript = {}, program = {} } = {}) => {
    const {
        getSourceFiles = false,
        isSourceFileDefaultLibrary = false
    } = program;
    const sourceFiles = typeof getSourceFiles === 'function'
        ? getSourceFiles.call(program)
        : [];
    const applicationSourceFiles = sourceFiles.filter((sourceFile) => {
        const { fileName = '' } = sourceFile;
        const isDefaultLibrary = typeof isSourceFileDefaultLibrary === 'function' &&
            isSourceFileDefaultLibrary.call(program, sourceFile);
        const isAmbientTypePackage = fileName.includes('/node_modules/@types/');

        return !isDefaultLibrary && !isAmbientTypePackage;
    });
    const declarations = applicationSourceFiles.flatMap(sourceFile => Object.entries(getDeclarationMap({
        typescript,
        sourceFile
    })));

    return Object.fromEntries(declarations);
};

const getDeclarationType = ({ typescript = {}, declaration = {} } = {}) => {
    const { InterfaceDeclaration = -1 } = getSyntaxKinds(typescript);
    const { kind: declarationKind = 0, type = false } = declaration;

    if (declarationKind === InterfaceDeclaration) return declaration;

    return type || declaration;
};

const getLiteralNames = ({
    typescript = {},
    node = {},
    declarations = {},
    seen = [],
    typeBindings = {}
} = {}) => {
    const {
        LiteralType = -1,
        UnionType = -1,
        StringLiteral = -1,
        TypeReference = -1,
        Identifier = -1,
        TypeOperator = -1,
        KeyOfKeyword = -1
    } = getSyntaxKinds(typescript);

    const { kind: nodeKind = 0 } = node;

    const {
        text = '',
        literal = {},
        operator = -1,
        type = {},
        types = []
    } = node;

    if (nodeKind === StringLiteral) return [text || ''];

    const { kind: literalKind = 0, text: literalText = '' } = literal;

    if (nodeKind === LiteralType && literal && literalKind === StringLiteral) {
        return [literalText || ''];
    }

    if (nodeKind === TypeOperator && operator === KeyOfKeyword) {
        // eslint-disable-next-line no-use-before-define -- key-of expansion delegates member discovery to the shared type walker
        return getTypeMembers({
            typescript,
            node: type,
            declarations,
            seen,
            typeBindings
        }).map(member => getName({ typescript, node: member })).filter(Boolean);
    }

    if (nodeKind === UnionType) return types.flatMap(part => getLiteralNames({
        typescript,
        node: part,
        declarations,
        seen,
        typeBindings
    }));

    if (![TypeReference, Identifier].includes(nodeKind)) return [];

    const name = getIdentifierName({ typescript, node });
    const declaration = getDeclaration({ declarations, name });
    const { type: declarationType = false } = declaration;

    if (name && !seen.includes(name) && declarationType) return getLiteralNames({
        typescript,
        node: declarationType,
        declarations,
        seen: [...seen, name],
        typeBindings
    });

    return [];
};

const getTypeParameterBindings = ({
    parameters = [],
    argumentsList = []
} = {}) => Object.fromEntries(parameters.flatMap(({
    name: { text = '' } = {},
    default: defaultType = false,
    constraint = false
} = {}, index = 0) => {
    const { [index]: argument = false } = argumentsList;
    const value = argument || defaultType || constraint;

    return text && value ? [[text, value]] : [];
}));

const applyTypeBindingsToMembers = ({
    typescript = {},
    members = [],
    typeBindings = {}
} = {}) => members.map((member) => {
    const { type = {} } = member;
    const memberTypeName = getIdentifierName({
        typescript,
        node: type
    });
    const { [memberTypeName]: boundType = false } = typeBindings;

    if (!isObject(boundType)) return member;

    const { kind = 0 } = boundType;

    return kind
        ? { ...member, type: boundType }
        : member;
});

const setMemberOptionality = ({
    typescript = {},
    members = [],
    optional = false
} = {}) => {
    const { QuestionToken = requireCompilerMember('SyntaxKind.QuestionToken') } = getSyntaxKinds(typescript);

    return members.map((member) => {
        const { questionToken = false } = member;

        return {
            ...member,
            questionToken: optional ? questionToken || { kind: QuestionToken } : undefined
        };
    });
};

const getTypeMembers = ({
    typescript = {},
    node = {},
    declarations = {},
    seen = [],
    typeBindings = {}
} = {}) => {
    const {
        InterfaceDeclaration = -1,
        TypeLiteral = -1,
        IntersectionType = -1,
        TypeReference = -1,
        Identifier = -1,
        ExpressionWithTypeArguments = -1,
        MappedType = -1,
        TypeOperator = -1,
        KeyOfKeyword = -1,
        IndexedAccessType = -1,
        MinusToken = -1
    } = getSyntaxKinds(typescript);

    const { kind: nodeKind = 0, members = [], heritageClauses = [], types = [], typeArguments = [], expression = {} } = node;

    if (nodeKind === MappedType) {
        const { typeParameter: { name: { text: parameterName = '' } = {}, constraint = {} } = {}, type: mappedType = {}, questionToken = false } = node;
        const { kind: constraintKind = 0, operator = 0, type: constraintType = {} } = constraint;
        const sourceNode = constraintKind === TypeOperator && operator === KeyOfKeyword
            ? constraintType
            : constraint;
        const sourceMembers = getTypeMembers({
            typescript,
            node: sourceNode,
            declarations,
            seen,
            typeBindings
        });
        const { kind: mappedKind = 0, indexType = {}, objectType = {} } = mappedType;
        const { kind: modifierKind = 0 } = getObject(questionToken);
        const sourceName = getIdentifierName({ typescript, node: sourceNode });
        const mappedOverSource = mappedKind === IndexedAccessType &&
            getIdentifierName({ typescript, node: indexType }) === parameterName &&
            getIdentifierName({ typescript, node: objectType }) === sourceName;

        return sourceMembers.map((member) => {
            const mappedMember = { ...member, ...(mappedOverSource ? {} : { type: mappedType }) };

            if (modifierKind === MinusToken) return { ...mappedMember, questionToken: undefined };

            return questionToken ? { ...mappedMember, questionToken } : mappedMember;
        });
    }

    if (nodeKind === TypeLiteral) return applyTypeBindingsToMembers({
        typescript,
        members,
        typeBindings
    });

    if (nodeKind === InterfaceDeclaration) return [
        ...heritageClauses.flatMap(({ types = [] } = {}) => types.flatMap(type => getTypeMembers({
            typescript,
            node: type,
            declarations,
            seen,
            typeBindings
        }))),
        ...applyTypeBindingsToMembers({
            typescript,
            members,
            typeBindings
        })
    ];

    if (nodeKind === IntersectionType) return types.flatMap(type => getTypeMembers({
        typescript,
        node: type,
        declarations,
        seen,
        typeBindings
    }));

    if (![TypeReference, Identifier].includes(nodeKind)) return [];

    const name = getIdentifierName({ typescript, node });
    const declaration = getDeclaration({ declarations, name });
    const [sourceType = false, selectorType = {}] = typeArguments;
    const { typeParameters = [], type: declarationType = false } = declaration;
    const isMappedUtility = ['Pick', 'Omit', 'Partial', 'Readonly', 'Required'].includes(name) &&
        isObject(sourceType);
    const sourceMembers = isMappedUtility
        ? getTypeMembers({ typescript, node: sourceType, declarations, seen, typeBindings })
        : [];
    const selectedNames = isMappedUtility
        ? getLiteralNames({ typescript, node: selectorType, declarations, typeBindings })
        : [];

    if (name === 'Pick' && isMappedUtility) return projectMembers({
        members: sourceMembers,
        keys: selectedNames,
        mode: 'pick'
    });

    if (name === 'Omit' && isMappedUtility) return projectMembers({
        members: sourceMembers,
        keys: selectedNames,
        mode: 'omit'
    });

    if (name === 'Partial' && isMappedUtility) return setMemberOptionality({
        typescript,
        members: sourceMembers,
        optional: true
    });

    if (name === 'Required' && isMappedUtility) return setMemberOptionality({
        typescript,
        members: sourceMembers,
        optional: false
    });

    if (isMappedUtility) return sourceMembers;

    if (name && !seen.includes(name)) {
        const bindings = getTypeParameterBindings({
            parameters: typeParameters,
            argumentsList: typeArguments
        });

        return getTypeMembers({
            typescript,
            node: declarationType || declaration,
            declarations,
            seen: [...seen, name],
            typeBindings: { ...typeBindings, ...bindings }
        });
    }

    if (nodeKind === ExpressionWithTypeArguments) return getTypeMembers({
        typescript,
        node: expression,
        declarations,
        seen,
        typeBindings
    });

    return [];
};

const getMembers = ({
    typescript = {},
    declaration = {},
    declarations = {},
    node = {}
} = {}) => {
    const { kind: nodeKind = 0 } = node;
    const declarationType = nodeKind ? node : getDeclarationType({ typescript, declaration });
    const directMembers = getTypeMembers({
        typescript,
        node: declarationType,
        declarations
    });

    return directMembers;
};

const getIndexedAccessMemberTypes = ({
    typescript = {},
    node = {},
    declarations = {}
} = {}) => {
    const { TypeReference = -1, Identifier = -1 } = getSyntaxKinds(typescript);
    const {
        objectType = {},
        indexType = {}
    } = node;
    const { kind: objectKind = 0, typeArguments = [] } = objectType;
    const [, secondArgument = {}] = typeArguments;
    const keys = getLiteralNames({
        typescript,
        node: indexType,
        declarations
    });
    const objectName = [TypeReference, Identifier].includes(objectKind)
        ? getIdentifierName({ typescript, node: objectType })
        : '';
    const recordValue = objectName === 'Record' ? secondArgument : undefined;
    const members = recordValue
        ? [{ type: recordValue }]
        : keys.flatMap((key) => {
            const member = lookupMember({
                members: getTypeMembers({
                    typescript,
                    node: objectType,
                    declarations
                }),
                name: key
            });

            return member ? [member] : [];
        });

    return members.flatMap(({ type = {}, questionToken = false } = {}) => {
        if (!type) return [];

        if (!questionToken) return [type];

        return [{
            kind: getSyntaxKinds(typescript).UnionType,
            types: [type, { kind: getSyntaxKinds(typescript).UndefinedKeyword }]
        }];
    });
};

const getObjectDiscriminator = ({
    typescript = {},
    node = {},
    declarations = {}
} = {}) => {
    const identifierName = getIdentifierName({ typescript, node });
    const declaration = getDeclaration({
        declarations,
        name: identifierName,
        fallback: { type: node }
    });
    const discriminator = getMembers({ typescript, declaration, declarations, node })
        .map((member) => {
            const { type: memberType = {} } = member;

            return {
                member,
                propertyName: getName({ typescript, node: member }),
                predicate: getLiteralPredicate({ typescript, node: memberType })
            };
        })
        .find(({ propertyName = '', predicate: { kind = '' } = {} } = {}) => propertyName && kind);

    if (!discriminator) return {};

    const { predicate: { value = '' } = {}, propertyName = '' } = discriminator;

    return { kind: 'discriminant', property: propertyName, value };
};

const getObjectPropertyNames = ({
    typescript = {},
    node = {},
    declarations = {}
} = {}) => getMembers({
    typescript,
    declaration: getDeclaration({
        declarations,
        name: getIdentifierName({ typescript, node }),
        fallback: { type: node }
    }),
    declarations,
    node
})
    .map(member => getName({ typescript, node: member }))
    .filter(Boolean);

const getObjectShapeCheck = ({
    typescript = {},
    node = {},
    declarations = {},
    unionParts = []
} = {}) => {
    const propertyNames = getObjectPropertyNames({ typescript, node, declarations });
    const otherPropertyNames = unionParts
        .filter(part => part !== node)
        .flatMap(part => getObjectPropertyNames({ typescript, node: part, declarations }));
    const uniquePropertyName = propertyNames.find(name => !otherPropertyNames.includes(name));

    return uniquePropertyName
        ? { kind: 'property', property: uniquePropertyName }
        : {};
};

const isSyntheticObjectPart = ({ typescript = {}, node: { kind = 0 } = {}, info = {} } = {}) => {
    const {
        TypeLiteral = -1,
        IntersectionType = -1
    } = getSyntaxKinds(typescript);
    const { kind: infoKind = '' } = info;
    const runtimeKind = getRuntimeKind(info);

    return runtimeKind === 'object' &&
        (infoKind === 'resolved' || [TypeLiteral, IntersectionType].includes(kind));
};

const getUnionParts = ({ typescript = {}, node: { kind = 0, types = [] } = {} } = {}) => {
    const { UnionType = -1 } = getSyntaxKinds(typescript);

    return kind === UnionType && Array.isArray(types) ? types : [];
};

const isNullType = ({ typescript = {}, node: { kind = 0, literal: { kind: literalKind = 0 } = {} } = {} } = {}) => {
    const { LiteralType = -1, NullKeyword = -1 } = getSyntaxKinds(typescript);

    return kind === NullKeyword || (kind === LiteralType && literalKind === NullKeyword);
};

const isDeclaredAbsence = ({ typescript = {}, node = {}, declarations = {}, seen = [] } = {}) => {
    const { Identifier = -1, TypeReference = -1 } = getSyntaxKinds(typescript);
    const { UndefinedKeyword = -1, VoidKeyword = -1 } = getSyntaxKinds(typescript);
    const { kind: nodeKind = 0, text = '' } = node;

    if (nodeKind === UndefinedKeyword || nodeKind === VoidKeyword || isNullType({ typescript, node })) return true;

    const name = nodeKind === Identifier ? text : getIdentifierName({ typescript, node });
    const declaration = getDeclaration({ declarations, name });
    const declarationType = getDeclarationType({ typescript, declaration });

    return [Identifier, TypeReference].includes(nodeKind) && name && !seen.includes(name) && declarationType
        ? isDeclaredAbsence({ typescript, node: declarationType, declarations, seen: [...seen, name] })
        : false;
};

const isNaNType = ({ typescript = {}, node = {}, declarations = {}, seen = [] } = {}) => {
    const { Identifier = -1, TypeReference = -1 } = getSyntaxKinds(typescript);

    const { kind: nodeKind = 0, text = '' } = node;
    const name = nodeKind === Identifier ? text : getIdentifierName({ typescript, node });
    const declaration = getDeclaration({ declarations, name });
    const declarationType = getDeclarationType({ typescript, declaration });

    if (![Identifier, TypeReference].includes(nodeKind) || !name || seen.includes(name) || !declarationType) return false;

    // `NaN` is a value, not a TypeScript type. A source spelling becomes an
    // absence marker only when an actual type declaration proves that meaning.
    // Other aliases may lead to that declaration, but cannot borrow it by name.
    if (name !== 'NaN') return isNaNType({ typescript, node: declarationType, declarations, seen: [...seen, name] });

    return isDeclaredAbsence({ typescript, node: declarationType, declarations, seen: [...seen, name] });
};

const isNeverType = ({ typescript = {}, node: { kind = 0 } = {} } = {}) => {
    const { NeverKeyword = -1 } = getSyntaxKinds(typescript);

    return kind === NeverKeyword;
};

const isAbsenceType = ({ typescript = {}, node = {}, declarations = {}, seen = [] } = {}) => {
    const { UndefinedKeyword = -1, VoidKeyword = -1 } = getSyntaxKinds(typescript);

    const { kind: nodeKind = 0 } = node;

    return nodeKind === UndefinedKeyword ||
        nodeKind === VoidKeyword ||
        isNullType({ typescript, node }) ||
        isNaNType({ typescript, node, declarations, seen });
};

const expandUnionParts = ({ typescript = {}, parts = [], declarations = {}, seen = [] } = {}) => parts
    .flatMap((part) => {
        const name = getIdentifierName({ typescript, node: part });
        const declaration = getDeclaration({ declarations, name });
        const { type: declarationType = false } = declaration;
        const nestedParts = name && !seen.includes(name) && declarationType
            ? getUnionParts({ typescript, node: declarationType })
            : [];

        return nestedParts.length
            ? expandUnionParts({
                typescript,
                parts: nestedParts,
                declarations,
                seen: [...seen, name]
            })
            : [part];
    });

const getTypeParts = ({ typescript = {}, node = {}, declarations = {} } = {}) => {
    const unionParts = getUnionParts({ typescript, node });

    return expandUnionParts({
        typescript,
        parts: unionParts.length ? unionParts : [node],
        declarations
    });
};

const getResolverName = (typeText = '') => {
    const words = typeText
        .replaceAll(/[^a-zA-Z0-9]+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean)
        .map(word => word[0].toUpperCase() + word.slice(1));

    return `resolve${words.join('') || 'Value'}`;
};

const getAvailableResolverName = ({ typeText = '', reservedNames = new Set() } = {}) => {
    const baseName = getResolverName(typeText);
    const getSuffixName = (suffix = 'Union', index = 2) => {
        const name = `${baseName}${suffix}`;

        return reservedNames.has(name)
            ? getSuffixName(`Union${index}`, index + 1)
            : name;
    };

    if (!reservedNames.has(baseName)) return baseName;

    return getSuffixName();
};

const getKeyMemberFamily = ({ typescript = {}, member = {} } = {}) => {
    const {
        Identifier = -1,
        StringLiteral = -1,
        NumericLiteral = -1,
        IndexSignature = -1
    } = getSyntaxKinds(typescript);
    const { kind = 0, name = {}, parameters = [] } = member;
    const { kind: nameKind = 0 } = name;

    if (kind !== IndexSignature && [Identifier, StringLiteral].includes(nameKind)) return ['string'];

    if (kind !== IndexSignature) return nameKind === NumericLiteral ? ['number'] : [];

    const [{ type: { kind: typeKind = 0 } = {} } = {}] = parameters;
    const { [typeKind]: family = '' } = primitiveKinds({ typescript });
    const indexFamilies = {
        string: ['string', 'number'],
        number: ['number'],
        symbol: ['symbol']
    };

    const { [family]: indexFamily = [] } = indexFamilies;

    return indexFamily;
};

const getKeyofContract = ({
    typescript = {},
    node = {},
    sourceFile = {},
    declarations = {},
    seen = [],
    typeBindings = {},
    reservedNames = new Set()
} = {}) => {
    const { type = {} } = node;
    const typeText = getTypeText({ node, sourceFile });
    const members = getTypeMembers({ typescript, node: type, declarations, seen, typeBindings });
    const families = [...new Set(members.flatMap(member => getKeyMemberFamily({ typescript, member })))];
    const { StringKeyword = -1, NumberKeyword = -1, SymbolKeyword = -1 } = getSyntaxKinds(typescript);
    const keyKinds = { string: StringKeyword, number: NumberKeyword, symbol: SymbolKeyword };

    if (families.length === 1) {
        const [family = ''] = families;

        return {
            kind: family,
            canonical: getCanonical(family),
            check: getFamilyCheck(family),
            typeText
        };
    }

    if (!families.length) return { kind: 'unknown', typeText };

    return {
        kind: 'union',
        family: 'union',
        resolver: getAvailableResolverName({ typeText, reservedNames }),
        parts: families.map((family) => {
            const { [family]: kind = -1 } = keyKinds;

            return { kind };
        }),
        typeText,
        canonical: ''
    };
};

const getEnclosingTypeParameter = ({
    typescript = {},
    node: { parent: initialParent = false } = {},
    name = ''
} = {}) => {
    const { SourceFile = -1 } = getSyntaxKinds(typescript);
    let current = initialParent;

    // eslint-disable-next-line resilient/prefer-prototype-methods -- Type-parameter ownership reads parent before match; SourceFile skips parameter scanning.
    while (current) {
        const currentNode = getObject(current);
        const { kind = 0, parent: next = null, typeParameters = [] } = currentNode;

        if (kind === SourceFile) return {};

        const parameter = typeParameters.find(({ name: { text = '' } = {} } = {}) => (
            text === name
        ));

        if (parameter) return parameter;

        current = next;
    }

    return {};
};

const getRuntimeName = (typeName = '') => typeName.includes('.')
    ? getResolverName(typeName)
    : typeName;

const resolveTypeInfo = ({
    getTypeInfo = requireCompilerMember('TypeResolution.resolve'),
    typescript = {},
    node = {},
    sourceFile = {},
    declarations = {},
    resolvers = {},
    seen = [],
    typeBindings = {},
    reservedNames = new Set()
} = {}) => {
    const { SyntaxKind = {} } = typescript;
    const {
        TypeParameter: TypeParameterKind2 = -1,
        TypeOperator: TypeOperatorKind2 = -1,
        KeyOfKeyword: KeyOfKeywordKind2 = -1,
        UniqueKeyword: UniqueKeywordKind2 = -1,
        ParenthesizedType: ParenthesizedTypeKind2 = -1,
        ConditionalType: ConditionalTypeKind2 = -1,
        TypeReference: TypeReferenceKind2 = -1,
        UnionType: UnionTypeKind2 = -1,
        IndexedAccessType: IndexedAccessTypeKind2 = -1,
        MappedType: MappedTypeKind2 = -1,
        TypeQuery: TypeQueryKind2 = -1,
        AnyKeyword: AnyKeywordKind2 = -1,
        UnknownKeyword: UnknownKeywordKind2 = -1,
        NullKeyword: NullKeywordKind2 = -1,
        LiteralType: LiteralTypeKind2 = -1,
        NeverKeyword: NeverKeywordKind2 = -1,
        VoidKeyword: VoidKeywordKind2 = -1,
        UndefinedKeyword: UndefinedKeywordKind2 = -1
    } = SyntaxKind;
    const primitives = primitiveKinds({ typescript });
    const { kind: nodeKind = 0 } = node;
    const { [nodeKind]: primitiveKind = '' } = primitives;
    const identifierName = getIdentifierName({ typescript, node });
    const typeText = getTypeText({ node, sourceFile });
    const parts = expandUnionParts({
        typescript,
        parts: getUnionParts({ typescript, node }),
        declarations
    });
    const definedParts = parts.filter(part => (
        !isAbsenceType({ typescript, node: part, declarations }) &&
        !isNeverType({ typescript, node: part })
    ));
    const getRelation = (source, target) => {
        const { kind: sourceLiteral = '', value: sourceValue = undefined } = getLiteralPredicate({ typescript, node: source });
        const { kind: targetLiteral = '', value: targetValue = undefined } = getLiteralPredicate({ typescript, node: target });

        const getLiteralRelation = () => {
            if (!sourceLiteral && !targetLiteral) return { matched: false, value: false };

            if (targetLiteral) return { matched: true, value: sourceLiteral === targetLiteral && sourceValue === targetValue };

            const sourceInfo = getTypeInfo({
                typescript,
                node: source,
                sourceFile,
                declarations,
                resolvers,
                seen,
                typeBindings,
                reservedNames
            });

            const targetInfo = getTypeInfo({
                typescript,
                node: target,
                sourceFile,
                declarations,
                resolvers,
                seen,
                typeBindings,
                reservedNames
            });
            const { kind: targetInfoKind = '' } = targetInfo;

            return {
                matched: true,
                value: getRuntimeKind(sourceInfo) === getRuntimeKind(targetInfo) &&
                    !['unknown', 'required', 'invalid'].includes(targetInfoKind)
            };
        };
        const literalRelation = getLiteralRelation();
        const { matched = false, value: literalValue = false } = literalRelation;

        if (matched) return literalValue;

        const sourceInfo = getTypeInfo({
            typescript,
            node: source,
            sourceFile,
            declarations,
            resolvers,
            seen,
            typeBindings,
            reservedNames
        });

        const targetInfo = getTypeInfo({
            typescript,
            node: target,
            sourceFile,
            declarations,
            resolvers,
            seen,
            typeBindings,
            reservedNames
        });
        const sourceKind = getRuntimeKind(sourceInfo);
        const targetKind = getRuntimeKind(targetInfo);

        return relateContracts({
            source: sourceInfo,
            target: targetInfo,
            sourceKeys: sourceKind === 'object'
                ? getObjectPropertyNames({ typescript, node: source, declarations })
                : [],
            targetKeys: targetKind === 'object'
                ? getObjectPropertyNames({ typescript, node: target, declarations })
                : []
        });
    };

    const { name: typeParameterName = {}, default: nodeDefault = false, constraint: nodeConstraint = false } = node;
    const { text: typeParameterText = '' } = getObject(typeParameterName);
    const { [typeParameterText]: boundType = false } = typeBindings;
    const { kind: boundTypeKind = 0 } = getObject(boundType);
    const nodeFallback = nodeDefault || nodeConstraint;
    const isTypeParameter = nodeKind === TypeParameterKind2;

    if (isTypeParameter && seen.includes(typeParameterText)) return { kind: 'unknown', typeText };

    if (isTypeParameter && boundType && boundTypeKind && boundType !== node) return getTypeInfo({
        typescript,
        node: boundType,
        sourceFile,
        declarations,
        resolvers,
        seen: [...seen, typeParameterText],
        typeBindings,
        reservedNames
    });

    if (isTypeParameter && nodeFallback) return getTypeInfo({
        typescript,
        node: nodeFallback,
        sourceFile,
        declarations,
        resolvers,
        seen: [...seen, typeParameterText],
        typeBindings,
        reservedNames
    });

    const {
        operator = -1,
        type: innerType = false,
        checkType = {},
        extendsType = {},
        trueType = {},
        falseType = {},
        literal: nodeLiteral = {}
    } = node;

    if (nodeKind === TypeOperatorKind2 && operator === KeyOfKeywordKind2) return getKeyofContract({
        typescript,
        node,
        sourceFile,
        declarations,
        seen,
        typeBindings,
        reservedNames
    });

    if (nodeKind === TypeOperatorKind2 && operator === UniqueKeywordKind2) return {
        kind: 'required',
        requiresGuard: true,
        typeText
    };

    if ([ParenthesizedTypeKind2, TypeOperatorKind2].includes(nodeKind) && innerType) return getTypeInfo({
        typescript,
        node: innerType,
        sourceFile,
        declarations,
        resolvers,
        seen,
        typeBindings,
        reservedNames
    });

    const isConditionalType = nodeKind === ConditionalTypeKind2;

    const { kind: checkTypeKind = 0 } = checkType;
    const checkTypeName = getIdentifierName({ typescript, node: checkType });
    const { [checkTypeName]: conditionalBoundType = undefined } = typeBindings;
    const distributive = isConditionalType &&
        [TypeParameterKind2, TypeReferenceKind2].includes(checkTypeKind) &&
        conditionalBoundType;
    const candidates = distributive
        ? getTypeParts({ typescript, node: conditionalBoundType, declarations })
        : [checkType];
    const relations = isConditionalType
        ? candidates.map(candidate => getRelation(candidate, extendsType))
        : [];
    const allTrue = isConditionalType && relations.every(relation => relation === true);
    const allFalse = isConditionalType && relations.every(relation => relation === false);
    const allBoolean = isConditionalType && relations.every(relation => typeof relation === 'boolean');

    if (allTrue) return getTypeInfo({
        typescript,
        node: trueType,
        sourceFile,
        declarations,
        resolvers,
        seen,
        typeBindings,
        reservedNames
    });

    if (allFalse) return getTypeInfo({
        typescript,
        node: falseType,
        sourceFile,
        declarations,
        resolvers,
        seen,
        typeBindings,
        reservedNames
    });

    if (distributive && allBoolean) {
        const branches = relations.map(relation => relation ? trueType : falseType);

        return getTypeInfo({
            typescript,
            node: {
                kind: UnionTypeKind2,
                types: branches
            },
            sourceFile,
            declarations,
            resolvers,
            seen,
            typeBindings,
            reservedNames
        });
    }

    if (isConditionalType) return { kind: 'unknown', typeText };

    const isIndexedAccess = nodeKind === IndexedAccessTypeKind2;

    const memberTypes = isIndexedAccess
        ? getIndexedAccessMemberTypes({
            typescript,
            node,
            declarations
        })
        : [];

    if (isIndexedAccess && !memberTypes.length) return { kind: 'unknown', typeText };

    const [firstMemberType = {}] = memberTypes;

    if (isIndexedAccess && memberTypes.length === 1) return getTypeInfo({
        typescript,
        node: firstMemberType,
        sourceFile,
        declarations,
        resolvers,
        seen,
        typeBindings,
        reservedNames
    });

    if (isIndexedAccess) return getTypeInfo({
        typescript,
        node: {
            kind: UnionTypeKind2,
            types: memberTypes
        },
        sourceFile,
        declarations,
        resolvers,
        seen,
        typeBindings,
        reservedNames
    });

    if (nodeKind === MappedTypeKind2) {
        const members = getTypeMembers({
            typescript,
            node,
            declarations
        });

        return members.length
            ? {
                kind: 'object',
                canonical: '{}',
                check: 'isObject(VALUE)'
            }
            : { kind: 'unknown', typeText };
    }

    if (nodeKind === TypeQueryKind2) return {
        kind: 'function',
        check: "typeof VALUE === 'function'",
        typeText
    };

    if (primitiveKind) {
        const primitiveCheck = getFamilyCheck(primitiveKind);

        return {
            kind: primitiveKind,
            canonical: getCanonical(primitiveKind),
            check: primitiveCheck
        };
    }

    if ([AnyKeywordKind2, UnknownKeywordKind2].includes(nodeKind)) {
        const { [typeText]: directResolver = '', any: anyResolver = '' } = resolvers;
        const resolver = directResolver || anyResolver || '';

        return resolver
            ? { kind: 'resolved', resolver }
            : { kind: 'required', requiresGuard: true, typeText };
    }

    const { kind: literalKind = 0 } = nodeLiteral;

    if (nodeKind === NullKeywordKind2 ||
        (nodeKind === LiteralTypeKind2 && literalKind === NullKeywordKind2)) return {
        kind: 'invalid',
        typeText
    };

    if ([NeverKeywordKind2, VoidKeywordKind2].includes(nodeKind)) return {
        kind: 'invalid',
        typeText
    };

    if (nodeKind === LiteralTypeKind2) {
        const check = getLiteralCheck({ typescript, node });
        const kind = getLiteralRuntimeKind({ typescript, node });

        return check
            ? { kind: 'literal', check, literalValue: getLiteralPredicate({ typescript, node }).value, canonical: getCanonical(kind) }
            : { kind: 'unknown', typeText };
    }

    if (nodeKind === UndefinedKeywordKind2) return {
        kind: 'undefined',
        canonical: '{}'
    };

    const identifierValue = (() => {
        if (!identifierName || seen.includes(identifierName)) return {};

        const { [identifierName]: boundType = {} } = typeBindings;
        const { kind: boundTypeKind = 0 } = boundType;
        const enclosingTypeParameter = getEnclosingTypeParameter({
            typescript,
            node,
            name: identifierName
        });
        const { constraint: enclosingConstraint = false, default: enclosingDefault = false } = enclosingTypeParameter;
        const enclosingFallback = enclosingDefault || enclosingConstraint;
        const [declarationName = '', declaration = {}] = getDeclarationEntry({
            declarations,
            name: identifierName
        });
        const declarationType = getDeclarationType({ typescript, declaration });
        const { members: declarationMembers = false } = declarationType;
        const { type: decType = false, typeParameters: decTypeParameters = false } = declaration;

        if (boundTypeKind) return getTypeInfo({
            typescript,
            node: boundType,
            sourceFile,
            declarations,
            resolvers,
            seen,
            typeBindings,
            reservedNames
        });

        if (enclosingFallback) return getTypeInfo({
            typescript,
            node: enclosingFallback,
            sourceFile,
            declarations,
            resolvers,
            seen: [...seen, identifierName],
            typeBindings,
            reservedNames
        });

        const { typeArguments = [] } = node;
        const [firstTypeArgument = {}, secondTypeArgument = {}] = typeArguments;

        const isPartUtility = ['NonNullable', 'Exclude', 'Extract'].includes(identifierName) &&
            firstTypeArgument;
        const sourceParts = isPartUtility
            ? getTypeParts({
                typescript,
                node: firstTypeArgument,
                declarations
            })
            : [];
        const excludedParts = isPartUtility
            ? getTypeParts({
                typescript,
                node: secondTypeArgument,
                declarations
            })
            : [];

        const getPartInfo = part => getTypeInfo({
            typescript,
            node: part,
            sourceFile,
            declarations,
            resolvers,
            seen,
            typeBindings,
            reservedNames
        });
        const matches = (source, target) => {
            if (isAbsenceType({ typescript, node: source, declarations }) ||
                    isAbsenceType({ typescript, node: target, declarations })) {
                return isAbsenceType({ typescript, node: source, declarations }) &&
                        isAbsenceType({ typescript, node: target, declarations });
            }

            const { kind: sourceLiteral = '', value: sourceValue = undefined } = getLiteralPredicate({ typescript, node: source });
            const { kind: targetLiteral = '', value: targetValue = undefined } = getLiteralPredicate({ typescript, node: target });

            if (sourceLiteral || targetLiteral) return sourceLiteral === targetLiteral && sourceValue === targetValue;

            const sourceInfo = getPartInfo(source);
            const targetInfo = getPartInfo(target);
            const { kind: targetInfoKind = '' } = targetInfo;

            return getRuntimeKind(sourceInfo) === getRuntimeKind(targetInfo) &&
                    !['unknown', 'required', 'invalid'].includes(targetInfoKind);
        };
        const filteredParts = identifierName === 'NonNullable'
            ? sourceParts.filter(part => !isAbsenceType({ typescript, node: part, declarations }))
            : sourceParts.filter((source) => {
                const matched = excludedParts.some(target => matches(source, target));

                return identifierName === 'Exclude' ? !matched : matched;
            });

        if (isPartUtility && !filteredParts.length) return { kind: 'invalid', typeText };

        const [firstFilteredPart = {}] = filteredParts;

        if (isPartUtility && filteredParts.length === 1) return getPartInfo(firstFilteredPart);

        if (isPartUtility) return getTypeInfo({
            typescript,
            node: {
                kind: UnionTypeKind2,
                types: filteredParts
            },
            sourceFile,
            declarations,
            resolvers,
            seen,
            typeBindings,
            reservedNames
        });

        if (identifierName === 'Record') return {
            kind: 'object',
            canonical: '{}',
            check: 'isObject(VALUE)'
        };

        if (['Partial', 'Readonly', 'Required'].includes(identifierName) && firstTypeArgument) return getTypeInfo({
            typescript,
            node: firstTypeArgument,
            sourceFile,
            declarations,
            resolvers,
            seen,
            typeBindings,
            reservedNames
        });

        if (declarationMembers) return {
            kind: 'resolved',
            resolver: getRuntimeName(declarationName || identifierName),
            canonical: '{}'
        };

        if (decType && decTypeParameters) {
            const bindings = getTypeParameterBindings({
                parameters: decTypeParameters,
                argumentsList: typeArguments
            });

            return getTypeInfo({
                typescript,
                node: decType,
                sourceFile,
                declarations,
                resolvers,
                seen: [...seen, identifierName],
                typeBindings: { ...typeBindings, ...bindings },
                reservedNames
            });
        }

        if (decType && !decTypeParameters) {
            const info = getTypeInfo({
                typescript,
                node: decType,
                sourceFile,
                declarations,
                resolvers,
                seen: [...seen, identifierName],
                typeBindings,
                reservedNames
            });
            const { kind: infoKind = '' } = info;
            const { [identifierName]: directResolver = '' } = resolvers;

            return infoKind === 'union'
                ? {
                    ...info,
                    resolver: directResolver || getAvailableResolverName({
                        typeText: identifierName,
                        reservedNames
                    })
                }
                : info;
        }

        const { [identifierName]: directResolver = '' } = resolvers;

        return directResolver
            ? { kind: 'resolved', resolver: directResolver }
            : { kind: 'unknown', typeText };
    })();
    const { kind: identifierValueKind = '' } = getObject(identifierValue);

    if (identifierValueKind) return identifierValue;

    if (definedParts.length > 1) {
        const partInfos = definedParts.map(part => getTypeInfo({
            typescript,
            node: part,
            sourceFile,
            declarations,
            resolvers,
            typeBindings,
            reservedNames
        }));
        const resolverTypeText = definedParts
            .map(part => getTypeText({ node: part, sourceFile }) || getIdentifierName({ typescript, node: part }))
            .filter(Boolean)
            .join(' | ');
        const [firstPartInfo = {}] = partInfos;
        const syntheticObjectParts = partInfos.length > 1 &&
            partInfos.every((info = {}, index = 0) => {
                const { [index]: definedPart = {} } = definedParts;

                return isSyntheticObjectPart({
                    typescript,
                    node: definedPart,
                    info
                });
            }) &&
            getRuntimeKind(firstPartInfo) === 'object';

        return reduceContracts({
            contracts: partInfos,
            parts: definedParts,
            optional: parts.length !== definedParts.length,
            preserveObjectUnion: syntheticObjectParts || partInfos.some(({ constructorName = '' } = {}) => constructorName),
            resolver: getObject(resolvers)[typeText] || getAvailableResolverName({
                typeText: resolverTypeText || typeText,
                reservedNames
            }),
            typeText,
            checks: {
                string: getFamilyCheck('string'),
                number: getFamilyCheck('number'),
                boolean: getFamilyCheck('boolean'),
                bigint: getFamilyCheck('bigint'),
                symbol: getFamilyCheck('symbol'),
                array: getFamilyCheck('array'),
                object: getFamilyCheck('object'),
                function: getFamilyCheck('function')
            },
            canonicals: {
                string: getCanonical('string'),
                number: getCanonical('number'),
                boolean: getCanonical('boolean'),
                bigint: getCanonical('bigint'),
                symbol: getCanonical('symbol'),
                array: getCanonical('array'),
                object: getCanonical('object'),
                function: getCanonical('function')
            }
        });
    }

    if (parts.length && definedParts.length === 1) {
        const [firstDefinedPart = {}] = definedParts;

        const info = getTypeInfo({
            typescript,
            node: firstDefinedPart,
            sourceFile,
            declarations,
            resolvers,
            seen,
            typeBindings,
            reservedNames
        });
        const { canonical: infoCanonical = '', kind: infoKind = '' } = info;

        return {
            ...info,
            optional: true,
            canonical: infoCanonical || (
                ['function', 'invalid'].includes(infoKind) ? '' : '{}'
            )
        };
    }

    if (parts.length && !definedParts.length) return { kind: 'invalid', typeText };

    return { kind: 'unknown', typeText };
};

// The resolver produces the semantic shape; this boundary makes that shape an explicit Contract IR.
const createTypeResolutionContext = () => {
    const activeResolutions = new Set();
    const resolve = (options = {}) => {
        const { typescript = {}, node = {}, sourceFile = {}, checker = {}, declarations = {} } = options;
        const typeText = getTypeText({ node, sourceFile });
        const { kind: nodeKind = 0 } = node;
        const resolutionKey = nodeKind
            ? [nodeKind, getIdentifierName({ typescript, node }), typeText].join(':') : '';

        if (resolutionKey && activeResolutions.has(resolutionKey)) return normalizeContract({ kind: 'unknown', typeText });

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private active keys stop semantic reentry before checker work; completed results are never cached.
        if (resolutionKey) activeResolutions.add(resolutionKey);

        try {
            const checkerTypeNode = getCheckerTypeNode({ typescript, node, checker, declarations });
            const checkerContract = getCheckerContract({ typescript, node, checker, declarations, typeText });
            const { kind: checkerTypeKind = 0 } = checkerTypeNode;
            const syntaxOptions = checkerTypeKind
                ? { ...options, checker: undefined, declarations: { ...declarations }, node: checkerTypeNode }
                : options;

            return normalizeContract(checkerTypeKind || !Object.keys(checkerContract).length
                ? resolveTypeInfo({ ...syntaxOptions, getTypeInfo: resolve })
                : checkerContract);
        } finally {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- Release on normal and abrupt completion preserves retry after a failed recursive resolution.
            if (resolutionKey) activeResolutions.delete(resolutionKey);
        }
    };

    return { resolve };
};

// Weak ownership keeps recursion state private without adding fields to caller
// declarations. A copied declaration view shares the context only through the
// recursive capability supplied to resolveTypeInfo.
const resolutionContexts = new WeakMap();
const getTypeInfo = (options = {}) => {
    const { declarations = {} } = options;

    // eslint-disable-next-line resilient/prefer-safe-transformations -- Weak declaration identity shares active recursion with checker reentry without mutating caller declarations.
    if (!resolutionContexts.has(declarations)) resolutionContexts.set(declarations, createTypeResolutionContext());

    const { resolve = requireCompilerMember('TypeResolution.resolve') } = resolutionContexts.get(declarations);

    return resolve(options);
};

const getPropertySource = ({
    typescript = {},
    member = {},
    sourceFile = {},
    declarations = {},
    resolvers = {}
} = {}) => {
    const { type: memberType = false, questionToken = false } = member;
    const propertyName = getName({ typescript, node: member });
    const info = memberType
        ? getTypeInfo({
            typescript,
            node: memberType,
            sourceFile,
            declarations,
            resolvers
        })
        : {};
    const { optional: infoOptional = false, kind: infoKind = '', canonical: infoCanonical = '' } = info;
    const optional = !!questionToken || infoOptional;
    const family = getRuntimeKind(info);
    const canonicalFamily = ['string', 'number', 'boolean', 'bigint', 'array', 'object'].includes(family) &&
        ['literal', 'string', 'number', 'boolean', 'bigint', 'array', 'object'].includes(infoKind)
        ? getCanonical(family)
        : '';
    const canonical = infoCanonical || canonicalFamily || (
        optional && !['function', 'invalid', 'required', 'unknown'].includes(infoKind) ? '{}' : ''
    );
    const agreementEvidence = !canonical && (getAgreementReason({
        typescript,
        node: memberType || {},
        kind: infoKind
    }) || (infoKind === 'function' && !optional
        ? 'required callable payload remains opaque; caller owns agreement'
        : ''));

    return {
        propertyName,
        optional,
        agreement: {
            canonical,
            kind: infoKind,
            // A model discriminator/container is required by the producer;
            // an opaque payload is still caller-owned until its consumer
            // establishes a concrete requirement.
            required: infoKind === 'function' && !optional,
            presenceRequired: !optional && !canonical && infoKind !== 'function',
            owner: canonical || infoKind === 'function' ? 'model-producer' : 'caller',
            evidence: agreementEvidence ? [agreementEvidence] : []
        }
    };
};

const {
    getPredicate = requireCompilerMember('ResolverPolicy.getPredicate'),
    getUnionResolverSource = requireCompilerMember('ResolverPolicy.getUnionResolverSource')
} = createResolverPolicy({
    getTypeInfo,
    getRuntimeKind,
    getObjectDiscriminator,
    getObjectShapeCheck
});
export {
    requireCompilerMember,
    isUnionType,
    primitiveKinds,
    getTypeText,
    getCanonical,
    getRuntimeKind,
    getAgreementReason,
    getFamilyCheck,
    getConstructorContract,
    getCheckerContract,
    getCheckerTypeNode,
    getLiteralCheck,
    getLiteralRuntimeKind,
    getName,
    getQualifiedName,
    getIdentifierName,
    getCallExpressionName,
    getCallIdentifierArgument,
    getDeclarationEntries,
    getDeclarationMap,
    getDeclarationEntry,
    getDeclaration,
    getProgramDeclarationMap,
    getDeclarationType,
    getLiteralNames,
    getTypeParameterBindings,
    applyTypeBindingsToMembers,
    setMemberOptionality,
    getTypeMembers,
    getMembers,
    getIndexedAccessMemberTypes,
    getObjectDiscriminator,
    getObjectPropertyNames,
    getObjectShapeCheck,
    isSyntheticObjectPart,
    getUnionParts,
    isNullType,
    isNaNType,
    isNeverType,
    isAbsenceType,
    expandUnionParts,
    getTypeParts,
    getResolverName,
    getAvailableResolverName,
    getEnclosingTypeParameter,
    getRuntimeName,
    resolveTypeInfo,
    getTypeInfo,
    getPropertySource,
    getPredicate,
    getUnionResolverSource,
    createTypeResolutionContext
};
