import { getObject } from '../../../rules/support/object.js';
import {
    getSyntaxKinds,
    updateBindingInitializer
} from '../../utils/ast-boundary.js';
import {
    annotateAgreementException,
    getBindingAgreement,
    getBindingDecision,
    getAgreementDefaultInitializer
} from '../policy/defaults.js';
import { getDestructuringDecisionForNode } from '../policy/destructuring-agreements.js';
import { hasGuardFor } from '../policy/guards.js';
import { getBindingElementCanonical, getBindingAgreementReason, getBindingRuntimeGuardKind,
    getPlacementTypeInfo, getPlacementReason } from '../policy/placement.js';
import {
    getDeclaration,
    getIdentifierName,
    getMembers,
    getName
} from '../understand/type-evidence.js';

const getSyntheticSourceFile = ({
    typescript = {},
    source = '',
    fileName = 'generated.ts',
    targetScript = 99
} = {}) => {
    const {
        ScriptKind = {},
        createSourceFile = () => ({}),
        transform: applyTransform = () => ({})
    } = typescript;
    const { SyntaxKind = {} } = typescript;
    const { StringLiteral = -1, NoSubstitutionTemplateLiteral = -1 } = SyntaxKind;
    const { TS = -1 } = ScriptKind;
    const sourceFile = createSourceFile(fileName, source, targetScript, true, TS);
    const { transformed: transformedFiles = [] } = applyTransform(sourceFile, [context => (root) => {
        const visit = (node) => {
            const visited = typescript.visitEachChild(node, visit, context);
            const { kind: visitedKind = 0, text: visitedText = '' } = visited;
            const normalized = [StringLiteral, NoSubstitutionTemplateLiteral].includes(visitedKind)
                ? typescript.factory.createStringLiteral(visitedText || '', true)
                : visited;

            return typescript.setTextRange(normalized, { pos: -1, end: -1 });
        };

        return visit(root);
    }]);
    const [transformed = {}] = transformedFiles;

    return transformed;
};

const getGeneratedPropertyName = ({ typescript = {}, name = '' } = {}) => {
    const { factory = {} } = typescript;

    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
        ? factory.createIdentifier(name)
        : factory.createStringLiteral(name, true);
};

// Model fields establish positive agreement only when their declared runtime
// family has a real capability predicate. Generic payloads deliberately do not
// appear here: they cross the model boundary unchanged for their consumer.
const getObjectResolverGuardKinds = ({ properties = [] } = {}) => new Set(properties
    .filter(({ optional = false, propertyName = '', agreement = {} } = {}) => {
        const { kind = '' } = getObject(agreement);

        return !optional && !['_tag', 'tag'].includes(propertyName) &&
            ['function', 'array', 'object'].includes(kind);
    })
    .map(({ agreement = {} } = {}) => getObject(agreement).kind));

const getObjectResolverDeclaration = ({
    typescript = {},
    properties = [],
    name = ''
} = {}) => {
    const { factory = {}, NodeFlags = {}, SyntaxKind = {} } = typescript;
    const { Const = 0 } = NodeFlags;
    const {
        QuestionToken: QuestionTokenKind2 = -1,
        ColonToken: ColonTokenKind2 = -1,
        EqualsGreaterThanToken: EqualsGreaterThanTokenKind2 = -1,
        ExclamationToken: ExclamationTokenKind2 = -1,
        BarBarToken: BarBarTokenKind2 = -1,
        ExportKeyword: ExportKeywordKind2 = -1
    } = SyntaxKind;

    if (!properties.length) return false;

    const getBindingElements = (propertyList = []) => propertyList.map(({
        propertyName = '',
        agreement = {}
    } = {}) => factory.createBindingElement(
        undefined,
        undefined,
        getGeneratedPropertyName({ typescript, name: propertyName }),
        getAgreementDefaultInitializer({
            typescript,
            factory,
            decision: getBindingDecision({ agreement: getBindingAgreement(agreement) }),
            name: propertyName,
            singleQuote: true
        })
    ));
    const inputParameter = factory.createParameterDeclaration(
        undefined,
        undefined,
        'input',
        undefined,
        undefined,
        undefined
    );
    const inputCheck = factory.createCallExpression(
        factory.createIdentifier('isObject'),
        undefined,
        [factory.createIdentifier('input')]
    );
    const inputValue = factory.createConditionalExpression(
        inputCheck,
        factory.createToken(QuestionTokenKind2),
        factory.createIdentifier('input'),
        factory.createToken(ColonTokenKind2),
        factory.createObjectLiteralExpression([], false)
    );
    const bindingStatement = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
            factory.createVariableDeclaration(
                factory.createObjectBindingPattern(getBindingElements(properties)),
                undefined,
                undefined,
                inputValue
            )
        ], Const)
    );
    const returned = factory.createObjectLiteralExpression([
        factory.createSpreadAssignment(factory.createIdentifier('input')),
        ...properties.map(({ propertyName = '' } = {}) => factory.createShorthandPropertyAssignment(
            getGeneratedPropertyName({ typescript, name: propertyName })
        ))
    ], true);
    const model = factory.createObjectLiteralExpression(
        properties.map(({ propertyName = '' } = {}) => factory.createPropertyAssignment(
            getGeneratedPropertyName({ typescript, name: propertyName }),
            factory.createIdentifier(propertyName)
        )),
        true
    );
    const getPositiveCheck = ({ propertyName = '', optional = false, agreement = {} } = {}) => {
        const { kind = '' } = getObject(agreement);
        const value = factory.createIdentifier(propertyName);

        if (optional) return false;

        if (['_tag', 'tag'].includes(propertyName)) return value;

        if (kind === 'function') return factory.createCallExpression(
            factory.createIdentifier('isFunction'),
            undefined,
            [value]
        );

        if (kind === 'array') return factory.createCallExpression(
            factory.createIdentifier('hasArrayContent'),
            undefined,
            [value]
        );

        if (kind === 'object') return factory.createCallExpression(
            factory.createIdentifier('hasContent'),
            undefined,
            [value]
        );

        if (['string', 'number', 'boolean', 'bigint'].includes(kind)) return value;

        return false;
    };
    const negativeChecks = properties
        .map((property = {}) => getPositiveCheck(property))
        .filter(Boolean)
        .map(check => factory.createPrefixUnaryExpression(ExclamationTokenKind2, check));
    const negativeCheck = negativeChecks.reduce((current = false, check = {}) => (
        current
            ? factory.createBinaryExpression(current, factory.createToken(BarBarTokenKind2), check)
            : check
    ), false);
    const emptyResponse = negativeCheck
        ? factory.createIfStatement(
            negativeCheck,
            factory.createBlock([factory.createReturnStatement(model)], true),
            undefined
        )
        : false;
    const body = factory.createBlock([
        bindingStatement,
        ...(emptyResponse ? [emptyResponse] : []),
        factory.createReturnStatement(returned)
    ], true);
    const arrow = factory.createArrowFunction(
        undefined,
        undefined,
        [inputParameter],
        undefined,
        factory.createToken(EqualsGreaterThanTokenKind2),
        body
    );

    return factory.createVariableStatement(
        [factory.createModifier(ExportKeywordKind2)],
        factory.createVariableDeclarationList([
            factory.createVariableDeclaration(name, undefined, undefined, arrow)
        ], Const)
    );
};

const getGeneratedExpression = ({
    typescript = {},
    text = '',
    fileName = 'generated-expression.ts',
    targetScript = 99
} = {}) => {
    const { factory = {} } = typescript;

    if (text === 'input') return factory.createIdentifier('input');

    if (text === '{}') return factory.createObjectLiteralExpression([], false);

    if (/^[A-Za-z_$][A-Za-z0-9_$]*\(input\)$/.test(text)) return factory.createCallExpression(
        factory.createIdentifier(text.slice(0, -7)),
        undefined,
        [factory.createIdentifier('input')]
    );

    const sourceFile = getSyntheticSourceFile({
        typescript,
        source: `${text};`,
        fileName,
        targetScript
    });
    const { statements = [] } = sourceFile;
    const [statement = {}] = statements;
    const { expression: statementExpression = false } = statement;

    return statementExpression || factory.createObjectLiteralExpression([], false);
};

const getUnionResolverDeclaration = ({
    typescript = {},
    name = '',
    branches = [],
    fallback = {},
    inputMembers = [],
    useObjectStandard = false,
    fileName = 'generated-union.ts',
    targetScript = 99
} = {}) => {
    const { factory = {}, NodeFlags = {}, SyntaxKind = {} } = typescript;
    const { Const = 0 } = NodeFlags;
    const {
        EqualsGreaterThanToken: EqualsGreaterThanTokenKind3 = -1,
        ExportKeyword: ExportKeywordKind3 = -1,
        SingleLineCommentTrivia = -1
    } = SyntaxKind;
    const inputStatements = inputMembers.length && useObjectStandard
        ? [
            factory.createVariableStatement(
                undefined,
                factory.createVariableDeclarationList([
                    factory.createVariableDeclaration(
                        'source',
                        undefined,
                        undefined,
                        getGeneratedExpression({
                            typescript,
                            text: 'isObject(input) ? input : {}',
                            fileName,
                            targetScript
                        })
                    )
                ], Const)
            ),
            factory.createVariableStatement(
                undefined,
                factory.createVariableDeclarationList([
                    factory.createVariableDeclaration(
                        factory.createObjectBindingPattern(inputMembers.map(property => (
                            factory.createBindingElement(
                                undefined,
                                factory.createStringLiteral(property, true),
                                factory.createIdentifier(`input_${property.replace(/[^A-Za-z0-9_$]/g, '_')}`),
                                factory.createStringLiteral('')
                            )
                        ))),
                        undefined,
                        undefined,
                        factory.createIdentifier('source')
                    )
                ], Const)
            )
        ]
        : [];
    const result = ({ kind = 'any', value = 'input' } = {}) => factory.createObjectLiteralExpression([
        factory.createPropertyAssignment(
            'kind',
            factory.createStringLiteral(kind, true)
        ),
        factory.createPropertyAssignment(
            'value',
            getGeneratedExpression({ typescript, text: value, fileName, targetScript })
        )
    ], true);
    const createBranchStatement = ({ check = '', kind = '', value = '', presence = '' } = {}) => {
        const branch = factory.createIfStatement(
            getGeneratedExpression({ typescript, text: check, fileName, targetScript }),
            factory.createReturnStatement(result({ kind, value }))
        );

        return presence === 'discriminated' && !useObjectStandard
            ? typescript.addSyntheticLeadingComment(branch, SingleLineCommentTrivia,
                ' eslint-disable-next-line resilient/prefer-destructured-member-access -- guarded discriminator Get retains branch-test timing.', true)
            : branch;
    };
    const statements = [
        ...inputStatements,
        ...branches.map(createBranchStatement),
        factory.createReturnStatement(result(fallback))
    ];

    const parameter = factory.createParameterDeclaration(
        undefined,
        undefined,
        'input',
        undefined,
        undefined,
        undefined
    );
    const arrow = factory.createArrowFunction(
        undefined,
        undefined,
        [parameter],
        undefined,
        factory.createToken(EqualsGreaterThanTokenKind3),
        factory.createBlock(statements, true)
    );

    return factory.createVariableStatement(
        [factory.createModifier(ExportKeywordKind3)],
        factory.createVariableDeclarationList([
            factory.createVariableDeclaration(name, undefined, undefined, arrow)
        ], Const)
    );
};

const getStandardImportDeclaration = ({
    typescript = {},
    moduleName = '',
    names = []
} = {}) => {
    const { factory = {} } = typescript;
    const imports = names.map(name => factory.createImportSpecifier(
        false,
        undefined,
        factory.createIdentifier(name)
    ));

    return factory.createImportDeclaration(
        undefined,
        factory.createImportClause(false, undefined, factory.createNamedImports(imports)),
        factory.createStringLiteral(moduleName, true)
    );
};

const getBindingPropertyName = ({ typescript = {}, node = {} } = {}) => {
    const { name = {}, propertyName = {} } = getObject(node);
    const { kind: propKind = 0, text: propText = '' } = propertyName;
    const { text: nameText = '' } = name;
    const property = propKind ? propertyName : name;

    return getIdentifierName({ typescript, node: property }) || propText || nameText || '';
};

const updateObjectBinding = ({
    typescript = {},
    parameter = {},
    body = {},
    sourceFile = {},
    declarations = {},
    placement = {},
    destructuringAgreements = {}
} = {}) => {
    const {
        SyntaxKind: {
            Identifier: IdentifierKind3 = -1
        } = {}
    } = typescript;

    const { ObjectBindingPattern = -1 } = getSyntaxKinds(typescript);
    const { name: paramName = {}, type: paramType = false } = parameter;
    const { kind: paramNameKind = 0, elements: paramElements = [] } = paramName;

    if (paramNameKind !== ObjectBindingPattern) return paramName;

    const typeNode = paramType || {};
    const typeName = getIdentifierName({ typescript, node: typeNode });
    const declaration = getDeclaration({
        declarations,
        name: typeName,
        fallback: { type: typeNode }
    });
    const members = getMembers({
        typescript,
        declaration,
        declarations,
        node: typeNode
    });
    const memberMap = new Map(members.map(member => [
        getName({ typescript, node: member }),
        member
    ]));
    const elements = paramElements.map((element) => {
        const {
            dotDotDotToken = false,
            initializer: elemInitializer = false,
            name: elemName = {}
        } = element;

        if (dotDotDotToken) return element;

        const propertyName = getBindingPropertyName({ typescript, node: element });
        const member = memberMap.get(propertyName) || {};
        const { type: memberType = false, questionToken: memberQuestionToken = false } = member;
        const info = memberType
            ? getPlacementTypeInfo({ typescript, node: memberType, placement })
            : {};
        const { canonical: infoCanonical = '', kind: infoKind = '', optional: infoOptional = false } = info;
        const { agreement: structuralAgreement = {} } = getDestructuringDecisionForNode({
            typescript,
            node: element,
            destructuringAgreements,
            kinds: ['closed-structural-model']
        });
        const { action: structuralAction = '', canonical: structuralCanonical = '' } = structuralAgreement;
        const canonical = structuralAction === 'exact-structural-field'
            ? structuralCanonical
            : infoCanonical || (!memberType
                ? getBindingElementCanonical({ typescript, element, placement })
                : '');
        const agreementReason = !canonical
            ? getPlacementReason({ typescript, placement, node: elemName, kind: infoKind })
            : '';
        let initializer;
        const { kind: elemNameKind = 0, text: elemNameText = '' } = elemName;
        const bindingName = elemNameKind === IdentifierKind3
            ? elemNameText
            : propertyName;
        const guardedInBody = !elemInitializer && hasGuardFor({
            typescript,
            node: body,
            sourceFile,
            name: bindingName
        });

        const guardedOptionalFunction = !elemInitializer &&
            infoKind === 'function' &&
            (memberQuestionToken || infoOptional);
        const agreement = getBindingAgreement({
            canonical,
            kind: infoKind,
            guarded: guardedInBody || guardedOptionalFunction,
            required: infoKind === 'function' && !infoOptional && !memberQuestionToken,
            owner: canonical || infoKind === 'function' ? 'typed-producer' : 'caller',
            evidence: agreementReason ? [agreementReason] : []
        });

        if (!elemInitializer && !guardedOptionalFunction && !guardedInBody) initializer = getAgreementDefaultInitializer({
            typescript,
            factory: getObject(typescript).factory,
            decision: getBindingDecision({ agreement: agreement }),
            name: propertyName
        });

        const nextElement = initializer
            ? updateBindingInitializer({ factory: getObject(typescript).factory, element, initializer })
            : element;

        if (guardedInBody && !initializer) return annotateAgreementException({
            typescript,
            node: nextElement,
            reason: 'capability is probed before invocation'
        });

        if (guardedOptionalFunction && !initializer) return annotateAgreementException({
            typescript,
            node: nextElement,
            reason: 'optional callback property remains unguarded at boundary'
        });

        return nextElement;
    });

    return getObject(typescript).factory.updateObjectBindingPattern(paramName, elements);
};

export {
    getBindingAgreementReason,
    getBindingElementCanonical,
    getBindingPropertyName,
    getBindingRuntimeGuardKind,
    getGeneratedExpression,
    getGeneratedPropertyName,
    getObjectResolverDeclaration,
    getObjectResolverGuardKinds,
    getStandardImportDeclaration,
    getSyntheticSourceFile,
    getUnionResolverDeclaration,
    updateObjectBinding
};

export { formatResilientOutput } from './emission-layout.js';
