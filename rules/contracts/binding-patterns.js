import { getComplement, getDiscriminantGuard } from './discriminants.js';
import {
    isExitingStatement,
    hasProviderForwardBinding,
    hasTupleGuardedBinding,
    isFoldMapMonoidIdentityBinding,
    isTerminatingVariantLoopBinding
} from './flow.js';
import { getEnclosingFunction, walk } from './infer.js';
import { getNodeParents } from '../support/ast-parents.js';
import { getObject } from '../support/object.js';

const tupleCarrierProperty = 'values';

const isUseStateResult = ({ parent = {} } = {}) => {
    const {
        type = '',
        id = {},
        init = {}
    } = getObject(parent);
    const { type: idType = '' } = getObject(id);
    const {
        type: initType = '',
        callee = {}
    } = getObject(init);
    const {
        type: calleeType = '',
        name = ''
    } = getObject(callee);

    return (
        type === 'VariableDeclarator' &&
        idType === 'ArrayPattern' &&
        initType === 'CallExpression' &&
        calleeType === 'Identifier' &&
        name === 'useState'
    );
};

const getSwitchCaseAncestor = (node = {}) => {
    const value = getObject(node);
    const { type = '', parent = {} } = value;

    if (type === 'SwitchCase') return value;

    if (parent) return getSwitchCaseAncestor(parent);

    return {};
};

// A rest parameter is a caller-owned tuple carrier. Its positions become
// available only in the switch case whose `arguments.length` proves them.
// This is deliberately narrower than an arbitrary array binding.
const isArityCarrierBinding = ({ node = {}, elements = [] } = {}) => {
    const { parent: declaration = {} } = getObject(node);
    const { type: declarationType = '', init = {}, parent: declarationParent = {} } = getObject(declaration);
    const { type: initType = '', name: carrierName = '' } = getObject(init);

    if (declarationType !== 'VariableDeclarator' || initType !== 'Identifier' || !carrierName) return false;

    const functionNode = getEnclosingFunction({ parent: declarationParent });
    const { params = [] } = getObject(functionNode);
    const restIndex = params.findIndex(({ type = '', argument = {} } = {}) => {
        const { name = '' } = getObject(argument);

        return type === 'RestElement' && name === carrierName;
    });

    if (restIndex < 0) return false;

    const caseNode = getSwitchCaseAncestor(declarationParent);
    const { test = {}, parent: caseParent = {} } = getObject(caseNode);
    const { type: caseParentType = '', parent: switchParent = {} } = getObject(caseParent);
    const switchStatement = caseParentType === 'SwitchStatement' ? caseParent : switchParent;
    const { discriminant = {} } = getObject(switchStatement);
    const { type: testType = '', value: caseArity = -1 } = getObject(test);
    const {
        type: discriminantType = '', computed = false, object = {}, property = {}
    } = getObject(discriminant);
    const hasArityDiscriminant = discriminantType === 'MemberExpression' &&
        !computed &&
        getObject(object).name === 'arguments' &&
        getObject(property).name === 'length';
    const suppliedIndex = elements.reduce((largest, element = {}, index) => (
        element ? index : largest
    ), -1);

    return testType === 'Literal' && Number.isInteger(caseArity) &&
        hasArityDiscriminant && caseArity > restIndex + suppliedIndex;
};

// A generated tuple carrier is a direct, locally declared object whose only
// role is to preserve a tuple source's single evaluation. The carrier is the
// position agreement: its members are caller-owned, so inventing a per-position
// default here would fabricate a contract the source never made.
const isTupleCarrierBinding = ({ node = {} } = {}) => {
    const { parent: pattern = {} } = getObject(node);
    const {
        type: bindingType = '',
        key = {},
        value = {}
    } = getObject(node);
    const {
        type: keyType = '',
        name: keyName = ''
    } = getObject(key);
    const { parent: declaration = {} } = getObject(pattern);
    const { type: valueType = '' } = getObject(value);
    const { type: declarationType = '', init = {} } = getObject(declaration);
    const { type: initType = '', properties = [] } = getObject(init);
    const [property = {}] = properties;
    const {
        type: propertyType = '',
        key: carrierKey = {},
        value: carrierValue = {}
    } = getObject(property);

    return bindingType === 'Property' &&
        keyType === 'Identifier' &&
        keyName === tupleCarrierProperty &&
        valueType === 'ArrayPattern' &&
        getObject(pattern).type === 'ObjectPattern' &&
        declarationType === 'VariableDeclarator' &&
        initType === 'ObjectExpression' &&
        properties.length === 1 &&
        propertyType === 'Property' &&
        getObject(carrierKey).name === tupleCarrierProperty &&
        getObject(carrierValue).type !== 'SpreadElement';
};

// A model constructor establishes a field-presence agreement before binding
// its generic payload. Presence proves the shape, while an explicit undefined
// value remains caller-owned and therefore has no valid default.
const getPropertyName = ({ key = {} } = {}) => {
    const { type = '', name = '', value = '' } = getObject(key);

    return type === 'Identifier' ? name : String(value);
};

const isInputSourceDeclaration = ({ node = {} } = {}) => {
    const {
        type = '',
        declarations = []
    } = getObject(node);
    const [declaration = {}] = declarations;
    const {
        id = {},
        init = {}
    } = getObject(declaration);
    const {
        type: idType = '',
        name: idName = ''
    } = getObject(id);
    const {
        type: initType = '',
        test = {},
        consequent = {},
        alternate = {}
    } = getObject(init);
    const {
        type: testType = '',
        callee = {},
        arguments: args = []
    } = getObject(test);
    const {
        type: calleeType = '',
        name: calleeName = ''
    } = getObject(callee);
    const [inputArgument = {}] = args;
    const { name: inputArgumentName = '' } = getObject(inputArgument);
    const { name: consequentName = '' } = getObject(consequent);
    const { type: alternateType = '' } = getObject(alternate);

    const matches = type === 'VariableDeclaration' &&
        idType === 'Identifier' &&
        idName === 'source' &&
        initType === 'ConditionalExpression' &&
        testType === 'CallExpression' &&
        calleeType === 'Identifier' &&
        calleeName === 'isObject' &&
        inputArgumentName === 'input' &&
        consequentName === 'input' &&
        alternateType === 'ObjectExpression';

    return matches;
};

const isPresenceCheck = ({ node = {}, propertyName = '' } = {}) => {
    const {
        type = '',
        operator = '',
        left = {},
        right = {}
    } = getObject(node);
    const {
        type: rightType = '',
        value: rightValue = true
    } = getObject(right);
    const {
        type: leftType = '',
        operator: leftOperator = '',
        left: objectCheck = {},
        right: propertyCheck = {}
    } = getObject(left);
    const {
        type: objectCheckType = '',
        callee: objectCallee = {},
        arguments: objectArgs = []
    } = getObject(objectCheck);
    const {
        type: objectCalleeType = '',
        name: objectCalleeName = ''
    } = getObject(objectCallee);
    const {
        type: propertyCheckType = '',
        callee: propertyCallee = {},
        arguments: propertyArgs = []
    } = getObject(propertyCheck);
    const {
        type: propertyCalleeType = '',
        computed = false,
        object = {},
        property = {}
    } = getObject(propertyCallee);
    const [objectArgument = {}] = objectArgs;
    const [propertyInput = {}, propertyArgument = {}] = propertyArgs;
    const { name: objectArgumentName = '' } = getObject(objectArgument);
    const { name: reflectName = '' } = getObject(object);
    const { name: reflectMethod = '' } = getObject(property);
    const { name: propertyInputName = '' } = getObject(propertyInput);

    return type === 'BinaryExpression' &&
        operator === '===' &&
        rightType === 'Literal' &&
        rightValue === false &&
        leftType === 'LogicalExpression' &&
        leftOperator === '&&' &&
        objectCheckType === 'CallExpression' &&
        objectCalleeType === 'Identifier' &&
        objectCalleeName === 'isObject' &&
        objectArgumentName === 'input' &&
        propertyCheckType === 'CallExpression' &&
        propertyCalleeType === 'MemberExpression' &&
        !computed &&
        reflectName === 'Reflect' &&
        reflectMethod === 'has' &&
        propertyInputName === 'input' &&
        getPropertyName({ key: propertyArgument }) === propertyName;
};

const isModelPayloadBinding = ({ node = {} } = {}) => {
    const {
        key = {},
        parent: pattern = {}
    } = getObject(node);
    const {
        type: patternType = '',
        parent: declarator = {}
    } = getObject(pattern);
    const {
        type: declaratorType = '',
        init = {},
        parent: declaration = {}
    } = getObject(declarator);
    const {
        type: initType = '',
        name: sourceName = ''
    } = getObject(init);
    const {
        type: declarationType = '',
        parent: block = {}
    } = getObject(declaration);
    const { type: blockType = '', body = [] } = getObject(block);
    // A concise arrow body is a single node, not a statement list.
    const statements = Array.isArray(body) ? body : [];
    const declarationIndex = statements.indexOf(declaration);
    const preceding = declarationIndex < 0 ? [] : statements.slice(0, declarationIndex);
    const propertyName = getPropertyName({ key });
    const hasSource = preceding.some(statement => isInputSourceDeclaration({ node: statement }));
    const hasPresenceGuard = preceding.some(({ type = '', test = {} } = {}) => (
        type === 'IfStatement' && isPresenceCheck({ node: test, propertyName })
    ));

    return patternType === 'ObjectPattern' &&
        declaratorType === 'VariableDeclarator' &&
        initType === 'Identifier' &&
        sourceName === 'source' &&
        declarationType === 'VariableDeclaration' &&
        blockType === 'BlockStatement' &&
        !!propertyName &&
        hasSource &&
        hasPresenceGuard;
};

// A generated model resolver owns one direct object-family stage. Its field
// guard chooses between the positive model and its structural falsifier; an
// opaque payload inside that model is deliberately not given a fabricated
// binding default.
const isDirectInputModelExpression = ({ node = {} } = {}) => {
    const {
        type = '', test = {}, consequent = {}, alternate = {}
    } = getObject(node);
    const {
        type: testType = '', callee = {}, arguments: args = []
    } = getObject(test);
    const { type: calleeType = '', name: calleeName = '' } = getObject(callee);
    const [input = {}] = args;

    return type === 'ConditionalExpression' &&
        testType === 'CallExpression' &&
        calleeType === 'Identifier' &&
        calleeName === 'isObject' &&
        getObject(input).name === 'input' &&
        getObject(consequent).name === 'input' &&
        getObject(alternate).type === 'ObjectExpression';
};

const hasStructuralModelField = ({ node = {}, propertyName = '' } = {}) => {
    const { type = '', argument = {} } = getObject(node);
    const { type: argumentType = '', properties = [] } = getObject(argument);

    return type === 'ReturnStatement' && argumentType === 'ObjectExpression' &&
        properties.some(({ key = {}, value = {}, shorthand = false } = {}) => (
            getPropertyName({ key }) === propertyName ||
            (shorthand && getObject(value).name === propertyName)
        ));
};

const hasDirectModelGuard = ({ node = {}, propertyName = '' } = {}) => {
    const { type = '', operator = '', argument = {}, left = {}, right = {} } = getObject(node);

    if (type === 'LogicalExpression' && operator === '||') return (
        hasDirectModelGuard({ node: left, propertyName }) ||
        hasDirectModelGuard({ node: right, propertyName })
    );

    if (type !== 'UnaryExpression' || operator !== '!') return false;

    const { type: argumentType = '', name = '', callee = {}, arguments: args = [] } = getObject(argument);

    if (argumentType === 'Identifier') return ['_tag', 'tag', propertyName].includes(name);

    const [value = {}] = args;
    const { type: calleeType = '', name: calleeName = '' } = getObject(callee);

    return argumentType === 'CallExpression' && calleeType === 'Identifier' &&
        ['isFunction', 'hasContent', 'hasArrayContent'].includes(calleeName) &&
        getObject(value).name === propertyName;
};

const isDirectModelPayloadBinding = ({ node = {} } = {}) => {
    const { key = {}, parent: pattern = {} } = getObject(node);
    const { type: patternType = '', parent: declarator = {} } = getObject(pattern);
    const { type: declaratorType = '', init = {}, parent: declaration = {} } = getObject(declarator);
    const { type: declarationType = '', parent: block = {} } = getObject(declaration);
    const { type: blockType = '', body = [] } = getObject(block);
    const propertyName = getPropertyName({ key });

    if (patternType !== 'ObjectPattern' || declaratorType !== 'VariableDeclarator' ||
        declarationType !== 'VariableDeclaration' || blockType !== 'BlockStatement' ||
        !propertyName || !isDirectInputModelExpression({ node: init })) return false;

    const index = body.indexOf(declaration);
    const [guard = {}] = index < 0 ? [] : body.slice(index + 1, index + 2);
    const { type: guardType = '', test = {}, consequent = {} } = getObject(guard);
    const { body: consequentBody = [], type: consequentType = '' } = getObject(consequent);
    const returnStatements = consequentType === 'BlockStatement' ? consequentBody : [consequent];

    return guardType === 'IfStatement' &&
        hasDirectModelGuard({ node: test, propertyName }) &&
        returnStatements.some(statement => hasStructuralModelField({ node: statement, propertyName }));
};

// A Tree provider result keeps its generic value exactly and has one known
// structural falsifier: its forest is an empty array. This recognizes only
// the emitted, adjacent consumer grammar; it does not infer arbitrary object
// returns or relax generic bindings generally.
const isTreeProviderPayloadBinding = ({ node = {} } = {}) => {
    const { key = {}, value = {}, parent: pattern = {} } = getObject(node);
    const { type: valueType = '', name: valueName = '' } = getObject(value);
    const { type: patternType = '', properties = [], parent: declarator = {} } = getObject(pattern);
    const { type: declaratorType = '', init = {}, parent: declaration = {} } = getObject(declarator);
    const { type: initType = '' } = getObject(init);
    const { type: declarationType = '', parent: block = {} } = getObject(declaration);
    const { type: blockType = '', body = [] } = getObject(block);
    const propertyName = getPropertyName({ key });

    if (propertyName !== 'value' || valueType !== 'Identifier' || !valueName ||
        patternType !== 'ObjectPattern' || declaratorType !== 'VariableDeclarator' ||
        initType !== 'CallExpression' || declarationType !== 'VariableDeclaration' ||
        blockType !== 'BlockStatement') return false;

    const forestElement = properties.find((property = {}) => getPropertyName({ key: getObject(property).key }) === 'forest');
    const { value: forestValue = {} } = getObject(forestElement);
    const { type: forestValueType = '', right: forestDefault = {} } = getObject(forestValue);
    const { type: forestDefaultType = '', elements = [] } = getObject(forestDefault);

    if (forestValueType !== 'AssignmentPattern' || forestDefaultType !== 'ArrayExpression' || elements.length) return false;

    const index = body.indexOf(declaration);
    const [provider = {}, guard = {}, normalReturn = {}] = index < 0 ? [] : body.slice(index + 1, index + 4);
    const { type: providerType = '', declarations = [] } = getObject(provider);
    const [providerDeclaration = {}] = declarations;
    const { id: providerPattern = {}, init: providerInit = {} } = getObject(providerDeclaration);
    const { type: providerPatternType = '', properties: providerProperties = [] } = getObject(providerPattern);
    const [providerProperty = {}] = providerProperties;
    const { key: providerKey = {}, value: providerValue = {} } = getObject(providerProperty);
    const { name: providerName = '' } = getObject(providerValue);
    const { type: providerInitType = '', callee: providerCallee = {} } = getObject(providerInit);
    const { type: providerCalleeType = '', object: providerObject = {}, property: providerMember = {} } = getObject(providerCallee);
    const { name: providerObjectName = '' } = getObject(providerObject);
    const { name: providerMemberName = '' } = getObject(providerMember);
    const { type: guardType = '', test = {}, consequent = {} } = getObject(guard);
    const { type: testType = '', operator: testOperator = '', argument: testArgument = {} } = getObject(test);
    const { type: testArgumentType = '', callee: testCallee = {}, arguments: testArguments = [] } = getObject(testArgument);
    const { type: testCalleeType = '', name: testCalleeName = '' } = getObject(testCallee);
    const [testValue = {}] = testArguments;
    const { type: consequentType = '', body: consequentBody = [] } = getObject(consequent);
    const [fallback = {}] = consequentType === 'BlockStatement' ? consequentBody : [consequent];
    const { type: fallbackType = '', argument: fallbackValue = {} } = getObject(fallback);
    const { type: fallbackValueType = '', properties: fallbackProperties = [] } = getObject(fallbackValue);
    const hasForwardedValue = fallbackProperties.some((property = {}) => {
        const { key: fallbackKey = {}, value: fallbackPropertyValue = {}, shorthand = false } = getObject(property);

        return getPropertyName({ key: fallbackKey }) === 'value' &&
            (shorthand || getObject(fallbackPropertyValue).name === valueName);
    });
    const hasEmptyForest = fallbackProperties.some((property = {}) => {
        const { key: fallbackKey = {}, value: fallbackPropertyValue = {} } = getObject(property);
        const { type = '', elements: forestElements = [] } = getObject(fallbackPropertyValue);

        return getPropertyName({ key: fallbackKey }) === 'forest' && type === 'ArrayExpression' && !forestElements.length;
    });

    return providerType === 'VariableDeclaration' && providerPatternType === 'ObjectPattern' &&
        getPropertyName({ key: providerKey }) === 'concat' && providerName === 'concat' &&
        providerInitType === 'CallExpression' && providerCalleeType === 'MemberExpression' &&
        providerObjectName === 'A' && providerMemberName === 'getMonoid' && guardType === 'IfStatement' &&
        testType === 'UnaryExpression' && testOperator === '!' && testArgumentType === 'CallExpression' &&
        testCalleeType === 'Identifier' && testCalleeName === 'isFunction' && getObject(testValue).name === 'concat' &&
        fallbackType === 'ReturnStatement' &&
        fallbackValueType === 'ObjectExpression' && hasForwardedValue && hasEmptyForest &&
        getObject(normalReturn).type === 'ReturnStatement';
};

const isExitingBranch = ({ node = {} } = {}) => isExitingStatement({ node, exits: ['ReturnStatement', 'ThrowStatement'] });

const hasBindingReassignment = ({ statements = [], name = '' } = {}) => statements.some((statement = {}) => {
    let found = false;

    walk(statement, (part = {}) => {
        const { type = '', left = {}, argument = {} } = getObject(part);
        const target = type === 'UpdateExpression' ? argument : left;
        const { name: targetName = '' } = getObject(target);

        if (['AssignmentExpression', 'UpdateExpression'].includes(type) && targetName === name) found = true;
    });

    return found;
});

// The TypeScript lowerer reads a discriminant once and gives that read a local
// name before selecting the branch.  That is the same model agreement as
// `value._tag === 'Left'`, provided the alias is a static `_tag` binding in
// the same statement list and has not been reassigned.  Keep this recognizer
// deliberately lexical: an arbitrary string comparison is not a model guard.
const getTagAliasGuard = ({ node = {}, anchor = {}, block = {} } = {}) => {
    const {
        type = '', operator = '', left = {}, right = {}
    } = getObject(node);
    const { type: leftType = '', name: leftName = '' } = getObject(left);
    const { name: rightName = '' } = getObject(right);
    const literal = leftType === 'Literal' ? left : right;
    const alias = leftType === 'Identifier' ? leftName : rightName;
    const { value: tag = '' } = getObject(literal);
    const { body: candidateBody = [] } = getObject(block);
    const body = Array.isArray(candidateBody) ? candidateBody : [];
    const anchorIndex = body.indexOf(anchor);

    if (type !== 'BinaryExpression' || !['===', '=='].includes(operator) ||
        !alias || typeof tag !== 'string' || anchorIndex < 1) return {};

    // eslint-disable-next-line resilient/prefer-prototype-methods -- Reverse declaration search stops at the nearest matching binding.
    for (let index = anchorIndex - 1; index >= 0; index -= 1) {
        const [statement = {}] = body.slice(index, index + 1);
        const { type: statementType = '', declarations = [] } = getObject(statement);

        if (statementType !== 'VariableDeclaration') continue;

        const declaration = declarations.find(({ id = {} } = {}) => {
            const { type: patternType = '', properties = [], parent = {} } = getObject(id);
            const { init: declarationInit = {} } = getObject(parent);
            const { type: initType = '', name: subject = '' } = getObject(declarationInit);
            const property = properties.find(({ key = {}, value = {} } = {}) => {
                const propertyName = getPropertyName({ key });
                const { type: valueType = '', name = '', left: assignmentLeft = {} } = getObject(value);
                const { name: assignmentName = '' } = getObject(assignmentLeft);
                const bindingName = valueType === 'AssignmentPattern'
                    ? assignmentName
                    : name;

                return ['_tag', 'tag'].includes(propertyName) && bindingName === alias;
            });

            return patternType === 'ObjectPattern' && initType === 'Identifier' && subject && property;
        });

        if (!declaration) continue;

        const { init = {} } = getObject(declaration);
        const { name: subject = '' } = getObject(init);
        const reassigned = hasBindingReassignment({
            statements: body.slice(index + 1, anchorIndex), name: alias
        });

        if (reassigned) continue;

        const spec = getDiscriminantGuard({
            node: {
                type: 'BinaryExpression',
                operator: '===',
                left: {
                    type: 'MemberExpression',
                    computed: false,
                    object: { type: 'Identifier', name: subject },
                    property: { type: 'Identifier', name: '_tag' }
                },
                right: { type: 'Literal', value: tag }
            }
        });
        const { subject: resolvedSubject = '' } = spec;

        if (resolvedSubject) return spec;
    }

    return {};
};

const getEffectiveDiscriminantGuard = ({ node = {}, anchor = {}, block = {} } = {}) => {
    const direct = getDiscriminantGuard({ node });
    const { subject = '' } = direct;

    if (subject) return { ...direct, negated: false };

    const { type = '', operator = '', argument = {} } = getObject(node);

    if (type !== 'UnaryExpression' || operator !== '!') {
        const alias = getTagAliasGuard({ node, anchor, block });
        const { subject: aliasSubject = '' } = alias;

        return aliasSubject ? { ...alias, negated: false } : {};
    }

    const nested = getEffectiveDiscriminantGuard({ node: argument, anchor, block });
    const { subject: nestedSubject = '', negated = false } = nested;

    return nestedSubject ? { ...nested, negated: !negated } : {};
};

// An exiting discriminant guard owns every later statement in its block,
// including a payload binding nested in a later branch. This is the ordinary
// terminating-variant form emitted by fp-ts lowering, not an inference from
// arbitrary control flow.
const hasTerminatingPayloadGuard = ({ block = {}, anchor = {}, subject = '', propertyName = '' } = {}) => {
    const { body: candidateBody = [] } = getObject(block);
    const body = Array.isArray(candidateBody) ? candidateBody : [];
    const index = body.indexOf(anchor);

    if (index < 1 || !subject || !propertyName) return false;

    return body.slice(0, index).some((statement = {}, guardIndex) => {
        const { type = '', test = {}, consequent = {} } = getObject(statement);

        if (type !== 'IfStatement' || !isExitingBranch({ node: consequent })) return false;

        const guard = getEffectiveDiscriminantGuard({ node: test, anchor: statement, block });
        const { subject: guardSubject = '', tag = '', fields: guardFields = [], negated = false } = guard;
        const { fields: complementFields = [] } = getComplement({ tag });
        const availableFields = negated ? guardFields : complementFields;
        const unchanged = !hasBindingReassignment({
            statements: body.slice(guardIndex + 1, index),
            name: subject
        });

        return unchanged && guardSubject === subject && availableFields.includes(propertyName);
    });
};

const payloadForms = {
    selection: { branches: ['IfStatement', 'ConditionalExpression'], terminating: false },
    binding: { branches: ['IfStatement'], terminating: true }
};
const hasPayloadGuard = ({ node = {}, subject = '', propertyName = '', form = 'binding' } = {}) => {
    const { [form]: { branches = [], terminating = false } = {} } = payloadForms;
    const parents = getNodeParents({ node });
    const children = [node, ...parents];

    return parents.some((current = {}, index) => {
        const { type = '', test = {}, consequent = {}, alternate = {}, parent: block = {} } = getObject(current);
        const [child = {}] = children.slice(index, index + 1);

        if (terminating && type === 'BlockStatement' && hasTerminatingPayloadGuard({
            block: current, anchor: child, subject, propertyName
        })) return true;

        const { subject: guardSubject = '', fields = [], tag = '', negated = false } = getEffectiveDiscriminantGuard({
            node: test, anchor: current, block
        });
        const { fields: complementFields = [] } = getComplement({ tag });
        const positiveFields = negated ? complementFields : fields;
        const negativeFields = negated ? fields : complementFields;

        return branches.includes(type) && guardSubject === subject && (
            (child === consequent && positiveFields.includes(propertyName)) ||
            (child === alternate && negativeFields.includes(propertyName))
        );
    });
};

// Residual lowering keeps a selected payload read at its original expression
// position with this identity-only extraction. It is lawful only when the
// surrounding branch selected that exact payload. This is not a general IIFE
// exemption: the callback has one static field, one identity return, and one
// identifier argument.
const isSelectedPayloadForward = ({ node = {} } = {}) => {
    const { key = {}, value = {}, parent: pattern = {} } = getObject(node);
    const propertyName = getPropertyName({ key });
    const { type: valueType = '', name: payloadName = '' } = getObject(value);
    const { type: patternType = '', parent: callback = {} } = getObject(pattern);
    const {
        type: callbackType = '', params = [], body: callbackBody = {}, parent: call = {}
    } = getObject(callback);
    const [parameter = {}] = params;
    const { type: callbackBodyType = '', name: returnedName = '' } = getObject(callbackBody);
    const { type: callType = '', callee = {}, arguments: args = [] } = getObject(call);
    const [argument = {}] = args;
    const { type: argumentType = '', name: subject = '' } = getObject(argument);

    if (!propertyName || valueType !== 'Identifier' || !payloadName ||
        patternType !== 'ObjectPattern' || callbackType !== 'ArrowFunctionExpression' ||
        params.length !== 1 || parameter !== pattern || callbackBodyType !== 'Identifier' ||
        returnedName !== payloadName || callType !== 'CallExpression' || callee !== callback ||
        args.length !== 1 || argumentType !== 'Identifier' || !subject) return false;

    return hasPayloadGuard({ node: call, subject, propertyName, form: 'selection' });
};

// An exact projection is a callback-local static field read.  The enclosing
// `map` owns callback timing; this finite form permits only an identity IIFE
// over the callback parameter, never a general forwarding exemption.
const isExactCallbackProjection = ({ node = {} } = {}) => {
    const { key = {}, value = {}, parent: pattern = {} } = getObject(node);
    const propertyName = getPropertyName({ key });
    const { type: valueType = '', name: alias = '' } = getObject(value);
    const { type: patternType = '', parent: extractor = {} } = getObject(pattern);
    const { type: extractorType = '', params = [], body = {}, parent: invoke = {} } = getObject(extractor);
    const [parameter = {}] = params;
    const { type: bodyType = '', name: returned = '' } = getObject(body);
    const { type: invokeType = '', callee = {}, arguments: invokeArgs = [], parent: callback = {} } = getObject(invoke);
    const [receiver = {}] = invokeArgs;
    const { type: receiverType = '', name: receiverName = '' } = getObject(receiver);
    const { type: callbackType = '', params: callbackParams = [], body: callbackBody = {}, parent: mapCall = {} } = getObject(callback);
    const [callbackParameter = {}] = callbackParams;
    const { type: callbackParameterType = '', name: callbackParameterName = '' } = getObject(callbackParameter);
    const { type: mapCallType = '', callee: mapCallee = {}, arguments: mapArguments = [] } = getObject(mapCall);
    const [mapCallback = {}] = mapArguments;
    const { type: mapCalleeType = '', computed = true, property = {} } = getObject(mapCallee);
    const { type: mapPropertyType = '', name: mapMethod = '' } = getObject(property);

    return Boolean(propertyName) && valueType === 'Identifier' && Boolean(alias) && patternType === 'ObjectPattern' &&
        extractorType === 'ArrowFunctionExpression' && params.length === 1 && parameter === pattern &&
        bodyType === 'Identifier' && returned === alias && invokeType === 'CallExpression' && callee === extractor &&
        invokeArgs.length === 1 && receiverType === 'Identifier' && Boolean(receiverName) &&
        callbackType === 'ArrowFunctionExpression' && callbackParams.length === 1 &&
        callbackParameterType === 'Identifier' && callbackParameterName === receiverName && callbackBody === invoke &&
        mapCallType === 'CallExpression' && mapCalleeType === 'MemberExpression' && !computed &&
        mapPropertyType === 'Identifier' && mapMethod === 'map' && mapArguments.length === 1 && mapCallback === callback;
};

// An Applicative/Monad receiver can preserve an effect result when a chain
// callback rejects a malformed required tuple.  The transformer emits this
// only after the TypeScript checker proved `M.of` on the same `M` that owns
// `M.chain`; this recognizer deliberately accepts only that complete target
// grammar, not an arbitrary `.of([])` call.
const hasLiftedTupleGuardedBinding = ({ node = {} } = {}) => {
    const { type = '', elements = [], parent: declarator = {} } = getObject(node);
    const { type: declaratorType = '', init = {}, parent: declaration = {} } = getObject(declarator);
    const { type: initType = '', name: tupleName = '' } = getObject(init);
    const { type: declarationType = '', parent: block = {} } = getObject(declaration);
    const { type: blockType = '', body = [], parent: callback = {} } = getObject(block);
    const { type: callbackType = '', parent: call = {} } = getObject(callback);
    const { type: callType = '', callee = {} } = getObject(call);
    const { type: calleeType = '', computed = false, object: chainReceiver = {}, property: chainMember = {} } = getObject(callee);
    const { type: chainReceiverType = '', name: chainReceiverName = '' } = getObject(chainReceiver);
    const { name: chainMemberName = '' } = getObject(chainMember);

    if (type !== 'ArrayPattern' || !elements.length || !elements.every((element = {}) => (
        getObject(element).type === 'Identifier'
    )) || declaratorType !== 'VariableDeclarator' || initType !== 'Identifier' || !tupleName ||
        declarationType !== 'VariableDeclaration' || blockType !== 'BlockStatement' ||
        callbackType !== 'ArrowFunctionExpression' || callType !== 'CallExpression' ||
        calleeType !== 'MemberExpression' || computed || chainReceiverType !== 'Identifier' ||
        !chainReceiverName || chainMemberName !== 'chain') return false;

    const index = body.indexOf(declaration);
    const [guard = {}] = index > 0 ? body.slice(index - 1, index) : [];
    const { type: guardType = '', test = {}, consequent = {} } = getObject(guard);
    const { type: testType = '', operator = '', left = {}, right = {} } = getObject(test);
    const { type: consequentType = '', body: consequentBody = [] } = getObject(consequent);
    const [fallback = {}] = consequentBody;
    const { type: fallbackType = '', argument = {} } = getObject(fallback);
    const { type: argumentType = '', callee: fallbackCallee = {}, arguments: fallbackArguments = [] } = getObject(argument);
    const {
        type: fallbackCalleeType = '', computed: fallbackComputed = false,
        object: fallbackReceiver = {}, property: fallbackMember = {}
    } = getObject(fallbackCallee);
    const { type: fallbackReceiverType = '', name: fallbackReceiverName = '' } = getObject(fallbackReceiver);
    const { name: fallbackMemberName = '' } = getObject(fallbackMember);
    const [fallbackValue = {}] = fallbackArguments;
    const { type: fallbackValueType = '', elements: fallbackElements = [] } = getObject(fallbackValue);
    const isNotArray = (candidate = {}) => {
        const { type: candidateType = '', operator: candidateOperator = '', argument: candidateArgument = {} } = getObject(candidate);
        const { type: argumentType = '', callee: candidateCallee = {}, arguments: candidateArguments = [] } = getObject(candidateArgument);
        const { type: calleeType = '', name = '' } = getObject(candidateCallee);
        const [value = {}] = candidateArguments;

        return candidateType === 'UnaryExpression' && candidateOperator === '!' && argumentType === 'CallExpression' &&
            calleeType === 'Identifier' && name === 'isArray' && getObject(value).name === tupleName;
    };
    const isShortTuple = (candidate = {}) => {
        const { type: candidateType = '', operator: candidateOperator = '', left: candidateLeft = {}, right: candidateRight = {} } = getObject(candidate);
        const { type: leftType = '', computed: leftComputed = false, object: leftObject = {}, property: leftProperty = {} } = getObject(candidateLeft);
        const { type: objectType = '', name: objectName = '' } = getObject(leftObject);
        const { name: propertyName = '' } = getObject(leftProperty);
        const { type: rightType = '', value = 0 } = getObject(candidateRight);

        return candidateType === 'BinaryExpression' && candidateOperator === '<' && leftType === 'MemberExpression' &&
            !leftComputed && objectType === 'Identifier' && objectName === tupleName && propertyName === 'length' &&
            rightType === 'Literal' && value === elements.length;
    };

    return guardType === 'IfStatement' && testType === 'LogicalExpression' && operator === '||' &&
        ((isNotArray(left) && isShortTuple(right)) || (isNotArray(right) && isShortTuple(left))) &&
        consequentType === 'BlockStatement' && consequentBody.length === 1 && fallbackType === 'ReturnStatement' &&
        argumentType === 'CallExpression' && fallbackCalleeType === 'MemberExpression' && !fallbackComputed &&
        fallbackReceiverType === 'Identifier' && fallbackReceiverName === chainReceiverName &&
        fallbackMemberName === 'of' && fallbackArguments.length === 1 && fallbackValueType === 'ArrayExpression' &&
        !fallbackElements.length;
};

const isDiscriminantPayloadBinding = ({ node = {} } = {}) => {
    const { key = {}, parent: pattern = {} } = getObject(node);
    const { parent: declarator = {} } = getObject(pattern);
    const { type: declaratorType = '', init = {}, parent: declaration = {} } = getObject(declarator);
    const { type: initType = '', name: subject = '' } = getObject(init);
    const { type: declarationType = '' } = getObject(declaration);
    const propertyName = getPropertyName({ key });

    if (declaratorType !== 'VariableDeclarator' || initType !== 'Identifier' ||
        declarationType !== 'VariableDeclaration' || !subject || !propertyName) return false;

    return hasPayloadGuard({ node, subject, propertyName, form: 'binding' });
};

const objectBindingFacts = [
    ['tuple-carrier', isTupleCarrierBinding],
    ['model-payload', isModelPayloadBinding],
    ['direct-model-payload', isDirectModelPayloadBinding],
    ['tree-provider-payload', isTreeProviderPayloadBinding],
    ['discriminant-payload', isDiscriminantPayloadBinding],
    ['selected-payload-forward', isSelectedPayloadForward],
    ['exact-callback-projection', isExactCallbackProjection],
    ['provider-forward', hasProviderForwardBinding],
    ['fold-map-identity', isFoldMapMonoidIdentityBinding],
    ['terminating-variant-loop', isTerminatingVariantLoopBinding]
];
const getObjectBindingFact = (node = {}) => {
    const [kind = ''] = objectBindingFacts.find(([, accepts = undefined] = []) => accepts({ node })) || [];

    return kind;
};
const getArrayBindingFact = (node = {}) => {
    const { parent = {}, elements = [] } = getObject(node);

    if (isUseStateResult(node)) return 'state-tuple';

    if (isArityCarrierBinding({ node, elements })) return 'arity-carrier';

    if (isTupleCarrierBinding({ node: getObject(parent) })) return 'tuple-carrier';

    if (hasTupleGuardedBinding({ node })) return 'guarded-tuple';

    return hasLiftedTupleGuardedBinding({ node }) ? 'lifted-tuple' : '';
};

export { getArrayBindingFact, getObjectBindingFact };
