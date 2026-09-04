import { getObject } from './object.js';
import {
    getSourceText,
    getStaticMemberName,
    getStaticMemberProperties
} from './signature-analysis.js';
import {
    getAddedPropertyNames,
    getPatternPropertyNames,
    hasScopeCollision
} from './signature-scope.js';

const getDeclarationRemovalRange = ({
    declaration: { range: [start = 0, end = 0] = [] } = {},
    sourceCode: { text: sourceText = '' } = {}
} = {}) => {
    const lineStart = sourceText.lastIndexOf('\n', start - 1) + 1;
    const beforeDeclaration = sourceText.slice(lineStart, start);

    const previousCharacter = String.prototype.slice.call(sourceText, start - 1, start);

    if (String.prototype.trim.call(beforeDeclaration) || previousCharacter !== ' ') return [start, end];

    return [start - 1, end];
};

const getMergedPatternText = ({
    pattern = {},
    properties = [],
    sourceCode = {}
} = {}) => {
    const { properties: patternProperties = [] } = getObject(pattern);
    const existingNames = new Set(getPatternPropertyNames({ pattern }));
    const { getText = false } = sourceCode;
    const getNodeText = (node = {}) => typeof getText === 'function'
        ? getText.call(sourceCode, node)
        : '';
    const additionalProperties = properties
        .filter((name = '') => !existingNames.has(name))
        .map((name = '') => name);
    const propertyText = [
        ...additionalProperties,
        ...patternProperties.map((property = {}) => getNodeText(property))
    ];

    return `{ ${propertyText.join(', ')} }`;
};

const isSafeDeclarationPosition = ({ declaration = {}, functionNode = {} } = {}) => {
    const { parent: body = {} } = getObject(declaration);
    const { body: functionBody = {} } = getObject(functionNode);
    const { body: statements = [] } = getObject(functionBody);
    const [firstStatement = {}] = statements;

    return (
        body === functionBody &&
        statements.length > 0 &&
        firstStatement === declaration
    );
};

const getSuggestion = ({
    violation = {},
    functionNode = {},
    sourceCode = {}
} = {}) => {
    const {
        node: pattern = {},
        declaration = {},
        init = {},
        paramName = '',
        paramNode = {}
    } = violation;

    if (!isSafeDeclarationPosition({ declaration, functionNode })) return [];

    const { declarations = [] } = declaration;

    if (declarations.length !== 1) return [];

    const {
        properties = [],
        memberNodes = [],
        hasUnsafeReference = false
    } = getStaticMemberProperties({
        node: functionNode,
        name: paramName,
        excludedNodes: [paramNode, init]
    });

    if (hasUnsafeReference) return [];

    const addedPropertyNames = getAddedPropertyNames({ pattern, properties });

    if (hasScopeCollision({
        sourceCode,
        functionNode,
        names: addedPropertyNames
    })) return [];

    const patternText = getMergedPatternText({
        pattern,
        properties,
        sourceCode
    });
    const { type: paramType = '', right: paramRight = {} } = paramNode;
    const defaultText = paramType === 'AssignmentPattern'
        ? getSourceText({ sourceCode, node: paramRight })
        : '{}';
    const replacement = `${patternText} = ${defaultText}`;

    return [{
        messageId: 'moveToSignature',
        data: { name: paramName },
        fix: fixer => [
            fixer.replaceText(paramNode, replacement),
            fixer.removeRange(getDeclarationRemovalRange({ declaration, sourceCode })),
            ...memberNodes.map((memberNode = {}) => fixer.replaceText(
                memberNode,
                getStaticMemberName({ node: memberNode })
            ))
        ]
    }];
};

export default getSuggestion;
