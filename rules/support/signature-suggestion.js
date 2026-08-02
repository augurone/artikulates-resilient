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

const getDeclarationRemovalRange = ({ declaration = {}, sourceCode = {} } = {}) => {
    const [start = 0, end = 0] = declaration.range ?? [];
    const sourceText = sourceCode.text ?? '';
    const lineStart = sourceText.lastIndexOf('\n', start - 1) + 1;
    const beforeDeclaration = sourceText.slice(lineStart, start);

    if (beforeDeclaration.trim() || sourceText[start - 1] !== ' ') return [start, end];
    return [start - 1, end];
};

const getMergedPatternText = ({
    pattern = {},
    properties = [],
    sourceCode = {}
} = {}) => {
    const patternProperties = pattern.properties ?? [];
    const existingNames = new Set(getPatternPropertyNames({ pattern }));
    const getText = (node = {}) => (
        typeof sourceCode.getText === 'function' ? sourceCode.getText(node) : ''
    );
    const additionalProperties = properties
        .filter((name = '') => !existingNames.has(name))
        .map((name = '') => name);
    const propertyText = [
        ...additionalProperties,
        ...patternProperties.map((property = {}) => getText(property))
    ];

    return `{ ${propertyText.join(', ')} }`;
};

const isSafeDeclarationPosition = ({ declaration = {}, functionNode = {} } = {}) => {
    const { parent: body = {} } = declaration;
    const { body: statements = [] } = functionNode.body ?? {};

    return (
        body === functionNode.body &&
        statements.length > 0 &&
        statements[0] === declaration
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
    if ((declaration.declarations ?? []).length !== 1) return [];
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
    const defaultText = paramNode.type === 'AssignmentPattern'
        ? getSourceText({ sourceCode, node: paramNode.right })
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
