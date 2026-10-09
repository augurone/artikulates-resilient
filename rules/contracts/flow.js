import {
    getChildren,
    getEnclosingFunction,
    getFunctionAlias,
    getFunctionNodes,
    getDefinitionMetadata,
    getPropertyName,
    getSignature,
    inferExpression,
    isFunction
} from './infer.js';
import { getCallableEvidence, getPredicateEvidence } from './member-evidence.js';
import {
    contract,
    getKind,
    mergeContracts,
    unknown
} from './model.js';
import { getNodeParents } from '../support/ast-parents.js';
import { getObject, hasObjectValue, isObject } from '../support/object.js';

const COMPARISON_OPERATORS = ['===', '!==', '==', '!='];

// Callable capability is a local control-flow fact. A missing callback stays
// undefined until a branch proves it callable; invocation alone is never
// evidence of capability.
const containsNode = ({ node = {}, target = {} } = {}) => {
    if (node === target) return true;

    const { parent = {} } = getObject(target);

    return hasObjectValue(parent) && containsNode({ node, target: parent });
};

const isNamedIdentifier = ({ node = {}, name = '' } = {}) => {
    const { type = '', name: nodeName = '' } = getObject(node);

    return type === 'Identifier' && nodeName === name;
};

const isFunctionTypeGuard = ({ node = {}, matches = () => false, negated = false } = {}) => {
    const { type = '', operator = '', left = {}, right = {} } = getObject(node);
    const isTypeof = (value = {}) => {
        const { type: valueType = '', operator: valueOperator = '', argument = {} } = getObject(value);

        return valueType === 'UnaryExpression' && valueOperator === 'typeof' && matches(argument);
    };
    const isFunctionLiteral = (value = {}) => {
        const { type: valueType = '', value: literalValue = '' } = getObject(value);

        return valueType === 'Literal' && literalValue === 'function';
    };
    const operators = negated ? ['!==', '!='] : ['===', '=='];

    return type === 'BinaryExpression' && operators.includes(operator) &&
        ((isTypeof(left) && isFunctionLiteral(right)) ||
            (isTypeof(right) && isFunctionLiteral(left)));
};

const isNamedFunctionGuard = ({ callee = {} } = {}) => isNamedIdentifier({ node: callee, name: 'isFunction' });
const isCallableGuard = ({
    node = {}, name = '', matches = candidate => isNamedIdentifier({ node: candidate, name }),
    isGuardCall = isNamedFunctionGuard
} = {}) => {
    const { type = '', operator = '', left = {}, right = {}, arguments: args = [] } = getObject(node);
    const [firstArgument = {}] = args;

    if (type === 'CallExpression' && isGuardCall(node) && matches(firstArgument)) return true;

    if (isFunctionTypeGuard({ node, matches })) return true;

    return type === 'LogicalExpression' && operator === '&&' &&
        [left, right].some(part => isCallableGuard({ node: part, matches, isGuardCall }));
};

const isNegatedCallableGuard = ({
    node = {}, name = '', matches = candidate => isNamedIdentifier({ node: candidate, name }),
    isGuardCall = isNamedFunctionGuard
} = {}) => {
    const { type = '', operator = '', argument = {} } = getObject(node);

    if (type === 'UnaryExpression' && operator === '!') return isCallableGuard({ node: argument, matches, isGuardCall });

    return isFunctionTypeGuard({ node, matches, negated: true });
};

const isExitingStatement = ({ node = {}, exits = ['ReturnStatement', 'ThrowStatement', 'BreakStatement', 'ContinueStatement'] } = {}) => {
    const { type = '', body = [] } = getObject(node);

    if (exits.includes(type)) return true;

    const [lastStatement = {}] = Array.isArray(body) ? body.slice(-1) : [];

    return type === 'BlockStatement' && !!body.length && isExitingStatement({ node: lastStatement, exits });
};

const hasCallableCapability = ({
    node = {}, name = '', matches = candidate => isNamedIdentifier({ node: candidate, name }),
    isGuardCall = isNamedFunctionGuard, isStable = () => true
} = {}) => {
    const parents = getNodeParents({ node });
    const guarded = (test = {}, negated = false) => (
        (negated ? isNegatedCallableGuard : isCallableGuard)({ node: test, matches, isGuardCall }) &&
        isStable(test, node)
    );

    return parents.some((parent = {}) => {
        const { type = '', operator = '', left = {}, right = {}, consequent = {}, test = {}, body = [] } = getObject(parent);

        if (type === 'LogicalExpression' && operator === '&&' &&
            containsNode({ node: right, target: node }) && guarded(left)) return true;

        if (['IfStatement', 'ConditionalExpression'].includes(type) &&
            containsNode({ node: consequent, target: node }) && guarded(test)) return true;

        if (type !== 'BlockStatement') return false;

        const statementIndex = body.findIndex(statement => containsNode({ node: statement, target: node }));

        return body.slice(0, Math.max(0, statementIndex)).some((statement = {}) => {
            const { type: statementType = '', test: exitTest = {}, consequent: exitBody = {} } = getObject(statement);

            return statementType === 'IfStatement' && guarded(exitTest, true) && isExitingStatement({ node: exitBody });
        });
    });
};

const isCanonicalTupleReturn = ({ node = {}, accumulator = '' } = {}) => {
    const { type = '', argument = {} } = getObject(node);
    const { type: argumentType = '', name = '', value = false, elements = [], properties = [] } = getObject(argument);

    if (type !== 'ReturnStatement') return false;

    if (argumentType === 'ArrayExpression') return !elements.length;

    if (argumentType === 'ObjectExpression') return !properties.length;

    if (accumulator && argumentType === 'Identifier' && name === accumulator) return true;

    return argumentType === 'Literal' && ['', 0, false].includes(value);
};

const isTupleExit = ({ node = {}, accumulator = '' } = {}) => {
    const { type = '', body = [] } = getObject(node);
    const [returnNode = {}] = body;

    return type === 'BlockStatement' && body.length === 1 && isCanonicalTupleReturn({ node: returnNode, accumulator });
};

const isNamedCall = ({ node = {}, name = '', argument = '' } = {}) => {
    const { type = '', callee = {}, arguments: args = [] } = getObject(node);
    const { type: calleeType = '', name: calleeName = '' } = getObject(callee);
    const [value = {}] = args;

    return type === 'CallExpression' && calleeType === 'Identifier' && calleeName === name &&
        isNamedIdentifier({ node: value, name: argument });
};

const isTupleArityGuard = ({ node = {}, name = '', arity = 0 } = {}) => {
    const { type = '', operator = '', left = {}, right = {} } = getObject(node);

    if (type !== 'LogicalExpression' || operator !== '||') return false;

    const isNotArray = (value = {}) => {
        const { type = '', operator = '', argument = {} } = getObject(value);

        return type === 'UnaryExpression' && operator === '!' && isNamedCall({
            node: argument,
            name: 'isArray',
            argument: name
        });
    };
    const isShort = (candidate = {}) => {
        const { type = '', operator = '', left = {}, right = {} } = getObject(candidate);
        const { type: leftType = '', object = {}, property = {}, computed = false } = getObject(left);
        const { type: objectType = '', name: objectName = '' } = getObject(object);
        const { type: propertyType = '', name: propertyName = '' } = getObject(property);
        const { type: rightType = '', value: literalValue = 0 } = getObject(right);

        return type === 'BinaryExpression' && operator === '<' && leftType === 'MemberExpression' &&
            !computed && objectType === 'Identifier' && objectName === name &&
            propertyType === 'Identifier' && propertyName === 'length' &&
            rightType === 'Literal' && literalValue === arity;
    };

    return (isNotArray(left) && isShort(right)) || (isNotArray(right) && isShort(left));
};

const hasTupleGuardedBinding = ({ node = {} } = {}) => {
    const { type = '', parent: declarator = {} } = getObject(node);
    const { type: declaratorType = '', init = {}, parent: declaration = {} } = getObject(declarator);
    const { type: initType = '', name = '' } = getObject(init);
    const { type: declarationType = '', parent: block = {} } = getObject(declaration);
    const { type: blockType = '', body = [] } = getObject(block);
    const { elements = [] } = getObject(node);
    const hasStaticElements = elements.length && elements.every((element = {}) => {
        const { type: elementType = '', argument = {}, name: elementName = {} } = getObject(element);
        const { type: argumentType = '' } = getObject(argument);
        const { type: nameType = '' } = getObject(elementName);

        return elementType !== 'RestElement' && !argumentType && nameType !== 'ArrayPattern';
    });

    if (type !== 'ArrayPattern' || declaratorType !== 'VariableDeclarator' ||
        initType !== 'Identifier' || declarationType !== 'VariableDeclaration' ||
        blockType !== 'BlockStatement' || !name || !hasStaticElements) return false;

    const functionNode = getEnclosingFunction({ parent: declaration });
    const { params = [] } = getObject(functionNode);
    const tupleParameterIndex = params.findIndex(({ type: parameterType = '', name: parameterName = '' } = {}) => (
        parameterType === 'Identifier' && parameterName === name
    ));
    const [firstParameter = {}] = params;
    const { type: accumulatorType = '', name: accumulatorName = '' } = getObject(firstParameter);
    const accumulator = tupleParameterIndex > 0 && accumulatorType === 'Identifier' ? accumulatorName : '';

    const index = body.indexOf(declaration);
    const [guard = {}] = index > 0 ? body.slice(index - 1, index) : [];
    const { type: guardType = '', test = {}, consequent = {} } = getObject(guard);
    const { length: arity = 0 } = elements;
    const contentGuard = arity === 1 && (() => {
        const { type = '', operator = '', argument = {} } = getObject(test);

        return type === 'UnaryExpression' && operator === '!' && isNamedCall({
            node: argument,
            name: 'hasArrayContent',
            argument: name
        });
    })();

    return guardType === 'IfStatement' && isTupleExit({ node: consequent, accumulator }) &&
        (contentGuard || isTupleArityGuard({ node: test, name, arity }));
};

// This finite provider-forward grammar is identity-only. It is the target
// counterpart to a checker-proven immediate returned-record property, and is
// deliberately not a general exemption for destructured callback parameters.
const hasProviderForwardBinding = ({ node = {} } = {}) => {
    const { parent: pattern = {} } = getObject(node);
    const { type: patternType = '', properties = [], parent: callback = {} } = getObject(pattern);
    const { type: callbackType = '', body = {}, parent: call = {} } = getObject(callback);
    const { type: bodyType = '', name: bodyName = '' } = getObject(body);
    const { type: callType = '', callee = {}, arguments: args = [], parent: property = {} } = getObject(call);
    const [receiver = {}] = args;
    const { type: receiverType = '', name: receiverName = '' } = getObject(receiver);
    const { type: propertyType = '', value = {}, parent: object = {} } = getObject(property);
    const { type: objectType = '', parent: returned = {} } = getObject(object);
    const { type: returnType = '' } = getObject(returned);
    const [binding = {}] = properties;
    const { type: bindingType = '', value: bindingValue = {}, key = {} } = getObject(binding);
    const { type: bindingValueType = '', name: bindingName = '' } = getObject(bindingValue);
    const { type: keyType = '', name: keyName = '' } = getObject(key);

    return patternType === 'ObjectPattern' && properties.length === 1 &&
        callbackType === 'ArrowFunctionExpression' && bodyType === 'Identifier' &&
        callType === 'CallExpression' && callee === callback && args.length === 1 &&
        receiverType === 'Identifier' && propertyType === 'Property' && value === call &&
        objectType === 'ObjectExpression' && returnType === 'ReturnStatement' &&
        bindingType === 'Property' && bindingValueType === 'Identifier' && keyType === 'Identifier' &&
        bindingName === bodyName && keyName && receiverName;
};

// A source-time capability binding is intentionally not a signature binding:
// moving it to the parameter list advances a provider getter.  The form is
// accepted only after an adjacent callability exit and one direct call of the
// extracted identifier in the same block.
const hasDirectCapabilityBinding = ({ node = {} } = {}) => {
    const { type = '', properties = [], parent: declarator = {} } = getObject(node);
    const { type: declaratorType = '', init = {}, parent: declaration = {} } = getObject(declarator);
    const { type: initType = '', name: receiverName = '' } = getObject(init);
    const { type: declarationType = '', parent: block = {} } = getObject(declaration);
    const { type: blockType = '', body = [] } = getObject(block);
    const [property = {}] = properties;
    const { type: propertyType = '', computed = false, value = {} } = getObject(property);
    const { type: valueType = '', name = '' } = getObject(value);
    const index = body.indexOf(declaration);
    const following = index < 0 ? [] : body.slice(index + 1);
    const [guard = {}] = following;
    const { type: guardType = '', test = {}, consequent = {} } = getObject(guard);
    const hasDirectCall = (candidate = {}) => {
        const { type: candidateType = '', argument = {} } = getObject(candidate);
        const { type: argumentType = '', callee = {} } = getObject(argument);
        const { type: calleeType = '', name: calleeName = '' } = getObject(callee);

        return candidateType === 'ReturnStatement' && argumentType === 'CallExpression' &&
            calleeType === 'Identifier' && calleeName === name;
    };

    return type === 'ObjectPattern' && properties.length === 1 && propertyType === 'Property' &&
        !computed && valueType === 'Identifier' && name && declaratorType === 'VariableDeclarator' &&
        initType === 'Identifier' && receiverName && declarationType === 'VariableDeclaration' &&
        blockType === 'BlockStatement' && guardType === 'IfStatement' &&
        isNegatedCallableGuard({ node: test, name }) && isExitingStatement({ node: consequent }) &&
        following.slice(1).some(hasDirectCall);
};

const getStaticPropertyName = (node = {}) => {
    const { type = '', computed = false, object = {}, property = {} } = getObject(node);
    const { type: objectType = '', name: objectName = '' } = getObject(object);
    const { type: propertyType = '', name: propertyName = '' } = getObject(property);

    return type === 'MemberExpression' && !computed && objectType === 'Identifier' &&
        propertyType === 'Identifier' && objectName && propertyName
        ? { object: objectName, property: propertyName }
        : {};
};

const isTerminatingVariantLoopBinding = ({ node = {} } = {}) => {
    const { key = {}, parent: pattern = {} } = getObject(node);
    const { type: keyType = '', name: field = '' } = getObject(key);
    const { type: patternType = '', parent: declaration = {} } = getObject(pattern);
    const { type: declarationType = '', init = {}, parent: statement = {} } = getObject(declaration);
    const { type: statementType = '', parent: block = {} } = getObject(statement);
    const { type: initType = '', name: subject = '' } = getObject(init);
    const { type: blockType = '', body = [] } = getObject(block);

    if (keyType !== 'Identifier' || !['left', 'right'].includes(field) ||
        patternType !== 'ObjectPattern' || declarationType !== 'VariableDeclarator' || statementType !== 'VariableDeclaration' ||
        initType !== 'Identifier' || !subject || blockType !== 'BlockStatement') return false;

    const index = body.indexOf(statement);
    const [loop = {}, , returned = {}] = index < 1 ? [] : body.slice(index - 1, index + 2);
    const { type: loopType = '', test = {}, body: loopBody = {} } = getObject(loop);
    const { type: testType = '', operator = '', left = {}, right = {} } = getObject(test);
    const leftAccess = getStaticPropertyName(left);
    const { type: rightType = '', value: tag = '' } = getObject(right);
    const { object: guardedSubject = '', property: discriminant = '' } = leftAccess;
    const { type: returnedType = '', argument = {} } = getObject(returned);
    const { type: argumentType = '', name: returnedName = '' } = getObject(argument);
    const { properties = [] } = getObject(pattern);
    const [binding = {}] = properties;
    const { value = {} } = getObject(binding);
    const { name: bindingName = '' } = getObject(value);
    const { body: loopStatements = [], type: loopBodyType = '' } = getObject(loopBody);
    const hasSubjectReassignment = (candidate = {}) => {
        const { type = '', left = {}, parent = {} } = getObject(candidate);
        const { type: leftType = '', name: leftName = '' } = getObject(left);

        if (type === 'AssignmentExpression' && leftType === 'Identifier' && leftName === subject) return true;

        const values = Object.values(candidate)
            .filter(value => value && typeof value === 'object' && value !== parent);

        return values.some(value => Array.isArray(value)
            ? value.some(child => hasSubjectReassignment(child))
            : hasSubjectReassignment(value));
    };
    const getComplementaryField = (value) => {
        if (value === 'Left') return 'right';

        if (value === 'Right') return 'left';

        return '';
    };
    const selectedField = getComplementaryField(tag);

    return loopType === 'WhileStatement' && testType === 'BinaryExpression' && operator === '===' &&
        guardedSubject === subject && discriminant === '_tag' && rightType === 'Literal' &&
        selectedField === field && loopBodyType === 'BlockStatement' && loopStatements.length &&
        hasSubjectReassignment(loopBody) && returnedType === 'ReturnStatement' &&
        argumentType === 'Identifier' && bindingName === returnedName;
};

// `foldMap` makes the Monoid identity its empty branch. This recognizes that
// one finite algebraic grammar only: an `empty` extraction immediately
// returned from a selected absence branch. It never treats the identity as an
// invalid/empty provider value and does not accept arbitrary `empty` fields.
const isFoldMapMonoidIdentityBinding = ({ node = {} } = {}) => {
    const { key = {}, value = {}, parent: pattern = {} } = getObject(node);
    const { type: keyType = '', name: keyName = '' } = getObject(key);
    const { type: valueType = '', name: localName = '' } = getObject(value);
    const { type: patternType = '', parent: declaration = {} } = getObject(pattern);
    const { type: declarationType = '', init = {}, parent: statement = {} } = getObject(declaration);
    const { type: statementType = '', parent: block = {} } = getObject(statement);
    const { type: initType = '', name: sourceName = '' } = getObject(init);
    const { type: blockType = '', body: blockBody = [], parent: branch = {} } = getObject(block);
    const { type: branchType = '', test = {}, parent: enclosing = {} } = getObject(branch);
    const { type: testType = '', callee = {} } = getObject(test);
    const { type: calleeType = '', name: guardName = '' } = getObject(callee);
    const body = Array.isArray(blockBody) ? blockBody : [];
    const [, returned = {}] = body;
    const { type: returnedType = '', argument = {} } = getObject(returned);
    const { type: argumentType = '', name: returnedName = '' } = getObject(argument);

    const hasFoldMapOwner = (candidate = {}) => {
        const { type = '', id = {}, parent = {} } = getObject(candidate);
        const { type: idType = '', name = '' } = getObject(id);

        if (type === 'VariableDeclarator' && idType === 'Identifier' && name === 'foldMap') return true;

        return parent ? hasFoldMapOwner(parent) : false;
    };

    return keyType === 'Identifier' && keyName === 'empty' && valueType === 'Identifier' && localName &&
        patternType === 'ObjectPattern' && declarationType === 'VariableDeclarator' && statementType === 'VariableDeclaration' &&
        initType === 'Identifier' && sourceName && blockType === 'BlockStatement' && body.length === 2 &&
        branchType === 'IfStatement' && testType === 'CallExpression' && calleeType === 'Identifier' &&
        /^(isLeft|isNone)$/.test(guardName) && returnedType === 'ReturnStatement' &&
        argumentType === 'Identifier' && returnedName === localName && hasFoldMapOwner(enclosing);
};

const copyAliases = (aliases = {}) => Object.fromEntries(Object.entries(getObject(aliases)).map(([name = '', related = []] = []) => [
    name,
    Array.isArray(related) ? [...related] : []
]));

const copyContext = (source = {}) => {
    const {
        bindings = {},
        functions = {},
        aliases = {},
        bindingAliases = new Map(),
        bindingIndex = {},
        bindingValues = new Map(),
        functionBindings = new Map(),
        flows = new Map(),
        callStack = [],
        evaluateCalls = true,
        evaluationDepth = 0,
        effectVersion = 0
    } = getObject(source);

    return {
        bindings: { ...getObject(bindings) },
        functions: getObject(functions),
        aliases: copyAliases(getObject(aliases)),
        bindingAliases: new Map([...bindingAliases].map(([binding = {}, related = []] = []) => [
            binding,
            new Set(related)
        ])),
        bindingIndex,
        bindingValues: new Map(bindingValues),
        functionBindings: new Map(functionBindings),
        flows,
        callStack: Array.isArray(callStack) ? [...callStack] : [],
        evaluateCalls,
        evaluationDepth,
        effectVersion
    };
};

const getPredicate = ({
    type = '',
    callee = {},
    arguments: args = [],
    operator = '',
    left = {},
    right = {}
} = {}, context = {}) => {
    const safeCallee = getObject(callee);
    const { type: calleeType = '' } = safeCallee;
    const [firstArgument = {}] = Array.isArray(args) ? args : [];
    const { type: argumentType = '', name: argumentName = '' } = getObject(firstArgument);

    if (type === 'CallExpression' && ['Identifier', 'MemberExpression'].includes(calleeType) && argumentType === 'Identifier') {
        const { predicateKind = '' } = getPredicateEvidence({ node: { type, callee, arguments: args }, context });

        return predicateKind
            ? { kind: predicateKind, name: argumentName, node: firstArgument }
            : {};
    }

    const binaryType = type;
    const {
        type: leftType = '',
        operator: leftOperator = '',
        argument: leftArgument = {},
        name: leftName = '',
        value: leftValue = ''
    } = getObject(left);
    const {
        type: rightType = '',
        value: rightValue = '',
        name: rightName = '',
        argument: rightArgument = {},
        operator: rightOperator = ''
    } = getObject(right);
    const { type: leftArgumentType = '', name: leftArgumentName = '' } = getObject(leftArgument);
    const { type: rightArgumentType = '', name: rightArgumentName = '' } = getObject(rightArgument);
    const leftTypeof = (
        leftType === 'UnaryExpression' &&
        leftOperator === 'typeof' &&
        leftArgumentType === 'Identifier' &&
        rightType === 'Literal' &&
        ['string', 'number', 'boolean', 'undefined', 'object', 'function'].includes(rightValue)
    );
    const rightTypeof = (
        rightType === 'UnaryExpression' &&
        rightOperator === 'typeof' &&
        rightArgumentType === 'Identifier' &&
        leftType === 'Literal' &&
        ['string', 'number', 'boolean', 'undefined', 'object', 'function'].includes(leftValue)
    );
    const isTypeofPredicate = (
        binaryType === 'BinaryExpression' &&
        COMPARISON_OPERATORS.includes(operator) &&
        (leftTypeof || rightTypeof)
    );

    if (isTypeofPredicate) {
        const kindValue = leftTypeof ? rightValue : leftValue;

        return {
            kind: kindValue === 'undefined' ? 'undefined' : kindValue,
            name: leftTypeof ? leftArgumentName : rightArgumentName,
            node: leftTypeof ? leftArgument : rightArgument,
            negated: ['!==', '!='].includes(operator)
        };
    }

    const isLeftLiteralPredicate = (
        binaryType === 'BinaryExpression' &&
        COMPARISON_OPERATORS.includes(operator) &&
        leftType === 'Identifier' &&
        rightType === 'Literal'
    );
    const isRightLiteralPredicate = (
        binaryType === 'BinaryExpression' &&
        COMPARISON_OPERATORS.includes(operator) &&
        rightType === 'Identifier' &&
        leftType === 'Literal'
    );

    if (isLeftLiteralPredicate || isRightLiteralPredicate) {
        const literalValue = isLeftLiteralPredicate ? rightValue : leftValue;
        const kind = literalValue === null ? 'null' : typeof literalValue;
        const looseNullish = kind === 'null' && ['==', '!='].includes(operator);

        return {
            kind,
            kinds: looseNullish ? ['null', 'undefined'] : [kind],
            name: isLeftLiteralPredicate ? leftName : rightName,
            node: isLeftLiteralPredicate ? left : right,
            negated: ['!==', '!='].includes(operator)
        };
    }

    return {};
};

const getContextBinding = ({ context = {}, node = {} } = {}) => {
    const { bindingIndex = {} } = getObject(context);
    const { getBinding = false } = getObject(bindingIndex);

    return typeof getBinding === 'function'
        ? getBinding(node)
        : {};
};

const setBinding = ({ context = {}, name = '', node = {}, value = unknown() } = {}) => {
    const next = copyContext(context);
    const {
        aliases = {},
        bindingAliases = new Map(),
        bindings = {},
        bindingValues = new Map()
    } = next;
    const { [name]: related = [] } = aliases;
    const names = [name, ...(Array.isArray(related) ? related : [])];
    const binding = getContextBinding({ context: next, node });
    const relatedBindings = hasObjectValue(binding)
        ? [binding, ...(bindingAliases.get(binding) || [])]
        : [];
    const nextBindingValues = new Map([
        ...bindingValues,
        ...relatedBindings.map(current => [current, value])
    ]);

    return {
        ...next,
        bindingValues: nextBindingValues,
        bindings: {
            ...bindings,
            ...Object.fromEntries(names.map(currentName => [currentName, value]))
        }
    };
};

const narrowContext = ({
    context = {},
    truthy = true,
    type = '',
    operator = '',
    argument = {},
    left = {},
    right = {},
    ...rest
} = {}) => {
    const test = { ...rest, type, operator, argument, left, right };

    if (type === 'UnaryExpression' && operator === '!') {
        return narrowContext({ context, ...argument, truthy: !truthy });
    }

    if (type === 'LogicalExpression' && operator === '&&' && truthy) {
        const leftContext = narrowContext({ context, ...left, truthy });

        return narrowContext({ context: leftContext, ...right, truthy });
    }

    if (type === 'LogicalExpression') return copyContext(context);

    const {
        kind = '',
        kinds = [kind],
        name = '',
        node = {},
        negated = false
    } = getPredicate(test, context);

    if (!kind || !name) return copyContext(context);

    const predicateTruthy = negated ? !truthy : truthy;

    const { bindings = {}, bindingValues = new Map() } = copyContext(context);
    const binding = getContextBinding({ context, node });
    const { [name]: namedValue = unknown() } = bindings;
    const boundValue = binding ? bindingValues.get(binding) || unknown() : namedValue;
    const current = boundValue;
    const currentKind = getKind(current);
    const { sourceNode = {} } = getObject(current);
    const matchesPredicate = kinds.includes(currentKind);

    if (predicateTruthy && negated && matchesPredicate) return setBinding({
        context,
        name,
        node,
        value: unknown(sourceNode)
    });

    if (predicateTruthy) {
        return setBinding({
            context,
            name,
            node,
            value: contract({ kind, sourceNode: test })
        });
    }

    return matchesPredicate
        ? setBinding({
            context,
            name,
            node,
            value: unknown(sourceNode)
        })
        : copyContext(context);
};

const mergeFlowContracts = (values = []) => {
    if (values.some(value => getKind(value) === 'unknown')) return unknown();

    const distinct = [...new Set(values)];
    const [only = unknown()] = distinct;

    return distinct.length === 1 ? only : mergeContracts(distinct, { preserveContradictions: false });
};

const mergeContexts = (contexts = []) => {
    const sourceContexts = Array.isArray(contexts) ? contexts : [];

    if (sourceContexts.length === 1) {
        const [only = {}] = sourceContexts;

        return copyContext(only);
    }

    const names = [...new Set(sourceContexts.flatMap((value) => {
        const { bindings = {} } = getObject(value);

        return Object.keys(getObject(bindings));
    }))];
    const [first = {}] = sourceContexts;
    const {
        functions = {},
        bindingIndex = {},
        functionBindings = new Map(),
        flows = new Map(),
        aliases: firstAliases = {},
        bindingAliases: firstBindingAliases = new Map(),
        callStack = [],
        evaluateCalls = true,
        evaluationDepth = 0
    } = getObject(first);
    const mergedAliases = Object.entries(getObject(firstAliases))
        .map(([name = '', related = []] = []) => [
            name,
            (Array.isArray(related) ? related : []).filter(alias => sourceContexts.every((value) => {
                const { aliases: sourceAliases = {} } = getObject(value);
                const { [name]: sourceRelated = [] } = getObject(sourceAliases);

                return Array.isArray(sourceRelated) && sourceRelated.includes(alias);
            }))
        ]);
    const keepAliases = ([entry = {}, ...remaining] = [], kept = []) => {
        if (!entry.length) return kept;

        const [, related = []] = entry;
        const next = related.length ? [...kept, entry] : kept;

        return keepAliases(remaining, next);
    };
    const aliases = Object.fromEntries(keepAliases(mergedAliases));
    const bindings = Object.fromEntries(names.map(name => [
        name,
        mergeFlowContracts(sourceContexts.map((value) => {
            const { bindings: sourceBindings = {} } = getObject(value);
            const { [name]: sourceValue = unknown() } = getObject(sourceBindings);

            return sourceValue;
        }))
    ]));
    const bindingKeys = [...new Set(sourceContexts.flatMap((value) => {
        const { bindingValues = new Map() } = getObject(value);

        return [...bindingValues.keys()];
    }))];
    const bindingValues = new Map(bindingKeys.map(binding => [
        binding,
        mergeFlowContracts(sourceContexts.map((value) => {
            const { bindingValues: sourceValues = new Map() } = getObject(value);

            return sourceValues.get(binding) || unknown();
        }))
    ]));
    const bindingAliases = new Map([...firstBindingAliases]
        .map(([binding = {}, related = []] = []) => [
            binding,
            new Set([...related].filter(alias => sourceContexts.every((value) => {
                const { bindingAliases: sourceAliases = new Map() } = getObject(value);

                const relatedAliases = sourceAliases.get(binding) || new Set();

                return relatedAliases.has(alias);
            })))
        ])
        .filter(([, related = new Set()] = []) => related.size));

    return {
        aliases,
        bindingAliases,
        bindingIndex,
        bindingValues,
        bindings,
        functions,
        functionBindings,
        flows,
        callStack: Array.isArray(callStack) ? [...callStack] : [],
        evaluateCalls: evaluateCalls !== false,
        evaluationDepth: evaluationDepth || 0,
        effectVersion: Math.max(...sourceContexts.map(value => getObject(value).effectVersion || 0), 0)
    };
};

const bindPattern = ({ context = {}, pattern = {}, value = unknown() } = {}) => {
    const { type = '', name = '' } = getObject(pattern);

    if (type === 'Identifier') {
        const next = copyContext(context);
        const { bindings: nextBindings = {}, bindingValues = new Map() } = next;
        const binding = getContextBinding({ context: next, node: pattern });
        const nextBindingValues = hasObjectValue(binding)
            ? new Map([...bindingValues, [binding, value]])
            : bindingValues;

        return {
            ...next,
            bindingValues: nextBindingValues,
            bindings: { ...nextBindings, [name]: value }
        };
    }

    if (type === 'AssignmentPattern') {
        const { left = {} } = getObject(pattern);

        return bindPattern({ context, pattern: left, value });
    }

    if (type === 'ArrayPattern') {
        const { elements = [] } = getObject(pattern);
        const { element = unknown(pattern), elements: values = [], sourceNode = {} } = getObject(value);
        const { type: sourceType = '' } = getObject(sourceNode);
        const { state: elementState = '' } = getObject(element);
        const sourceValues = sourceType === 'ArrayPattern' ? [] : values;
        const sourceElement = sourceType === 'ArrayPattern' || elementState === 'contradictory'
            ? unknown(pattern) : element;

        return elements.reduce((current, candidate, index = 0) => {
            const { type: candidateType = '', argument = {} } = getObject(candidate);
            const { [index]: indexedValue = sourceElement } = sourceValues;

            if (!candidateType) return current;

            return bindPattern({
                context: current,
                pattern: candidateType === 'RestElement' ? argument : candidate,
                value: candidateType === 'RestElement'
                    ? contract({ kind: 'array', sourceNode: candidate, element: sourceElement })
                    : indexedValue
            });
        }, copyContext(context));
    }

    if (type !== 'ObjectPattern') return copyContext(context);

    const {
        kind: valueKind = 'unknown',
        properties: valueProperties = {},
        residual: valueResidual = {}
    } = getObject(value);
    const { properties: patternProperties = [] } = getObject(pattern);
    const safePatternProperties = Array.isArray(patternProperties) ? patternProperties : [];
    const safeValueProperties = getObject(valueProperties);
    const safeValueResidual = getObject(valueResidual);
    const excluded = safePatternProperties
        .filter(({ type: propertyType = '' } = {}) => propertyType === 'Property')
        .map(({ key = {}, computed = false } = {}) => getPropertyName({ key, computed }))
        .filter(Boolean);

    return safePatternProperties
        .filter(({ type: propertyType = '' } = {}) => ['Property', 'RestElement'].includes(propertyType))
        .reduce((current, { type: propertyType = '', key = {}, value: propertyValue = {}, argument = {} } = {}) => {
            if (propertyType === 'RestElement') {
                const { properties: residualProperties = {}, open = false, excluded: residualExcluded = [] } = safeValueResidual;
                const remainingProperties = Object.fromEntries(Object.entries(safeValueProperties)
                    .filter(([propertyName = ''] = []) => !excluded.includes(propertyName)));

                return bindPattern({
                    context: current,
                    pattern: argument,
                    value: contract({
                        kind: 'object',
                        state: 'unknown',
                        properties: {
                            ...getObject(residualProperties),
                            ...remainingProperties
                        },
                        residual: {
                            kind: 'object',
                            state: 'unknown',
                            open: open === true || valueKind === 'object',
                            excluded: [...new Set([
                                ...(Array.isArray(residualExcluded) ? residualExcluded : []),
                                ...excluded
                            ])],
                            properties: {}
                        }
                    })
                });
            }

            const { name: keyName = '', value: keyValue = '' } = getObject(key);
            const propertyName = keyName || keyValue;

            if (!propertyName) return current;

            const { [propertyName]: knownProperty = unknown(propertyValue) } = safeValueProperties;

            return bindPattern({
                context: current,
                pattern: propertyValue,
                value: knownProperty
            });
        }, copyContext(context));
};

const removeAliases = ({ context = {}, name = '', node = {} } = {}) => {
    const next = copyContext(context);
    const { aliases: nextAliases = {}, bindingAliases: nextBindingAliases = new Map() } = next;
    const { [name]: related = [] } = nextAliases;
    const names = [name, ...(Array.isArray(related) ? related : [])];
    const aliases = Object.fromEntries(Object.entries(nextAliases)
        .filter(([currentName = '']) => !names.includes(currentName))
        .map(([currentName = '', related = []] = []) => [
            currentName,
            related.filter(alias => !names.includes(alias))
        ]));

    const binding = getContextBinding({ context: next, node });
    const relatedBindings = hasObjectValue(binding) ? [binding, ...(nextBindingAliases.get(binding) || [])] : [];
    const bindingAliases = new Map([...nextBindingAliases]
        .filter(([current = {}] = []) => !relatedBindings.includes(current))
        .map(([current = {}, relatedValues = []] = []) => [
            current,
            new Set([...relatedValues].filter(alias => !relatedBindings.includes(alias)))
        ]));

    return { ...next, aliases, bindingAliases };
};

const addAliases = ({ context = {}, name = '', node = {}, target = '', targetNode = {} } = {}) => {
    const next = copyContext(context);
    const { aliases: nextAliases = {}, bindingAliases: nextBindingAliases = new Map() } = next;
    const { [name]: nameAliases = [], [target]: targetAliases = [] } = nextAliases;
    const group = [...new Set([
        name,
        target,
        ...(Array.isArray(nameAliases) ? nameAliases : []),
        ...(Array.isArray(targetAliases) ? targetAliases : [])
    ])];

    const binding = getContextBinding({ context: next, node });
    const targetBinding = getContextBinding({ context: next, node: targetNode });
    const bindingGroup = hasObjectValue(binding) && hasObjectValue(targetBinding)
        ? [...new Set([
            binding,
            targetBinding,
            ...(nextBindingAliases.get(binding) || []),
            ...(nextBindingAliases.get(targetBinding) || [])
        ])]
        : [];
    const bindingAliases = new Map([
        ...nextBindingAliases,
        ...bindingGroup.map(current => [
            current,
            new Set(bindingGroup.filter(alias => alias !== current))
        ])
    ]);

    return {
        ...next,
        bindingAliases,
        aliases: {
            ...nextAliases,
            ...Object.fromEntries(group.map(currentName => [
                currentName,
                group.filter(alias => alias !== currentName)
            ]))
        }
    };
};

const bindDeclaration = ({ context = {}, pattern = {}, value = unknown(), init = {} } = {}) => {
    const { type: patternType = '', name = '' } = pattern;
    const { type: initType = '', name: initName = '' } = getObject(init);
    const unlinked = patternType === 'Identifier'
        ? removeAliases({ context, name, node: pattern })
        : context;
    const bound = bindPattern({ context: unlinked, pattern, value });

    if (patternType !== 'Identifier' || initType !== 'Identifier') return bound;

    const aliased = addAliases({ context: bound, name, node: pattern, target: initName, targetNode: init });
    const { functions: aliasedFunctions = {}, functionBindings = new Map() } = aliased;
    const functionAlias = getFunctionAlias({ init, functions: aliasedFunctions, context: aliased });
    const { signature = {} } = getObject(functionAlias);

    if (!hasObjectValue(signature)) return aliased;

    const binding = getContextBinding({ context: aliased, node: pattern });
    const nextFunctionBindings = hasObjectValue(binding)
        ? new Map([...functionBindings, [binding, functionAlias]])
        : functionBindings;

    return {
        ...aliased,
        functionBindings: nextFunctionBindings,
        functions: {
            ...aliasedFunctions,
            [name]: functionAlias
        }
    };
};

const getMemberPath = ({ type = '', name = '', object = {}, property = {}, computed = false } = {}) => {
    if (type === 'Identifier') return [name];

    if (type !== 'MemberExpression') return [];

    const propertyName = getPropertyName({ key: property, computed });

    if (!propertyName) return [];

    const path = getMemberPath(object);

    return path.length ? [...path, propertyName] : [];
};

const getMemberRoot = (node = {}) => {
    const { type = '', object = {} } = getObject(node);

    return type === 'Identifier' ? node : getMemberRoot(object);
};

const updateContractPath = ({ value = unknown(), path = [], nextValue = unknown(), sourceNode = {} } = {}) => {
    const [name = '', ...rest] = path;

    if (getKind(value) !== 'object' || !name) return value;

    const { properties: sourceProperties = {}, branches = [], sourceNode: currentSourceNode = {} } = getObject(value);
    const properties = { ...getObject(sourceProperties) };
    const { [name]: current = unknown() } = properties;
    const updated = rest.length
        ? updateContractPath({ value: current, path: rest, nextValue, sourceNode })
        : nextValue;

    return contract({
        kind: 'object',
        properties: { ...properties, [name]: updated },
        branches,
        sourceNode: sourceNode || currentSourceNode
    });
};

const assignExpression = ({ context = {}, left = {}, value = unknown() } = {}) => {
    const { type = '' } = left;

    if (type === 'Identifier') return bindDeclaration({ context, pattern: left, value });

    if (type !== 'MemberExpression') return context;

    const path = getMemberPath(left);
    const [rootName = '', ...propertyPath] = path;

    if (!rootName || !propertyPath.length) return context;

    const { bindings: contextBindings = {} } = context;
    const { [rootName]: current = unknown() } = contextBindings;
    const updated = updateContractPath({
        value: current,
        path: propertyPath,
        nextValue: value,
        sourceNode: left
    });

    if (updated === current) return context;

    return setBinding({ context, name: rootName, node: getMemberRoot(left), value: updated });
};

const setExpressionContext = ({ state = {}, node = {}, context = {} } = {}) => {
    // eslint-disable-next-line resilient/prefer-safe-transformations -- Private flow Map; native store failure remains visible.
    if (isObject(node)) state.contexts.set(node, context);
};

const publishExpressionContext = ({ state = {}, node = {}, context = {} } = {}) => {
    const { contexts = false } = getObject(state);
    const previous = contexts && contexts.get(node);

    setExpressionContext({
        state,
        node,
        context: previous ? mergeContexts([previous, context]) : context
    });
};

const getFunctionScope = (scope = {}) => {
    const { type = '', parent = {} } = getObject(scope);

    return ['function', 'program'].includes(type) || !hasObjectValue(parent)
        ? scope
        : getFunctionScope(parent);
};

const accessibleBindingCache = new WeakMap();
const getAccessibleBindings = (bindingIndex = {}) => {
    if (accessibleBindingCache.has(bindingIndex)) return accessibleBindingCache.get(bindingIndex);

    const { getBinding = false, getScope = false, rootScope = {} } = getObject(bindingIndex);

    if (typeof getBinding !== 'function' || typeof getScope !== 'function') return false;

    const accessible = new Set();
    const visit = (node = {}) => {
        const { type = '' } = getObject(node);

        if (!type) return;

        const binding = getBinding(node);
        const { scope = {}, kind = '' } = getObject(binding);

        if (type === 'Identifier' && hasObjectValue(binding) && !['const', 'function', 'import'].includes(kind) &&
            getFunctionScope(scope) !== getFunctionScope(getScope(node))) {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private one-pass census of bindings reachable from another function.
            accessible.add(binding);
        }

        getChildren(node).forEach(visit);
    };
    const { node: program = {} } = getObject(rootScope);

    visit(program);
    // eslint-disable-next-line resilient/prefer-safe-transformations -- Reuse the completed private census for every function in this analysis session.
    accessibleBindingCache.set(bindingIndex, accessible);

    return accessible;
};

const getFallbackCapturedNames = (functionNode = {}) => {
    const names = new Set();
    const visit = (node = {}, nested = false) => {
        const { type = '', name = '' } = getObject(node);

        if (!type) return;

        // eslint-disable-next-line resilient/prefer-safe-transformations -- The parser-neutral fallback records names referenced by nested functions when no binding index exists.
        if (nested && type === 'Identifier' && name) names.add(name);

        getChildren(node).forEach(child => visit(child, nested || (child !== functionNode && isFunction(child))));
    };

    visit(functionNode);

    return names;
};

const createFlowState = (bindingIndex = {}, functionNode = {}) => ({
    contexts: new Map(),
    resultBranches: new Map(),
    opaqueOwners: new Map(),
    accessibleBindings: getAccessibleBindings(bindingIndex),
    fallbackCapturedNames: getFallbackCapturedNames(functionNode)
});

const widenHeapContract = (value = unknown()) => {
    const { kind = 'unknown', sourceNode = {} } = getObject(value);

    if (kind === 'array') return contract({ kind, sourceNode, element: unknown(sourceNode) });

    if (kind !== 'object') return value;

    const { properties = {} } = getObject(value);

    return contract({
        kind,
        sourceNode,
        properties: Object.fromEntries(Object.keys(getObject(properties)).map(name => [name, unknown(sourceNode)])),
        residual: { kind: 'object', state: 'unknown', open: true, properties: {} }
    });
};

const widenEffectContext = ({ state = {}, context = {}, directEval = false } = {}) => {
    const next = copyContext(context);
    const { accessibleBindings = false, fallbackCapturedNames = new Set() } = getObject(state);
    const { bindingValues = new Map(), bindings = {}, effectVersion = 0 } = next;
    const widen = (binding = {}, value = unknown(), name = '') => {
        const { kind = '', name: bindingName = '' } = getObject(binding);
        const { sourceNode = {} } = getObject(value);
        const captured = accessibleBindings
            ? accessibleBindings.has(binding)
            : fallbackCapturedNames.has(name || bindingName);
        const mutable = !['const', 'function', 'import'].includes(kind);

        return (directEval && mutable) || captured ? unknown(sourceNode) : widenHeapContract(value);
    };
    const widenedValues = new Map([...bindingValues].map(([binding = {}, value = unknown()] = []) => [
        binding,
        widen(binding, value)
    ]));
    const widenedBindings = Object.fromEntries(Object.entries(bindings).map(([name = '', value = unknown()] = []) => {
        const match = [...bindingValues].find(([binding = {}] = []) => getObject(binding).name === name);
        const [binding = false] = match || [];

        return [name, widen(binding, value, name)];
    }));

    return {
        ...next,
        bindingValues: widenedValues,
        bindings: widenedBindings,
        effectVersion: effectVersion + 1
    };
};

const getCapturedResultBranches = ({ state = {}, node = {}, context = {} } = {}) => {
    const { resultBranches = new Map() } = getObject(state);

    return resultBranches.get(node) || [{ node, contract: inferExpression(node, context) }];
};

const mergeResultBranches = (branches = []) => branches.reduce((merged = [], branch = {}) => {
    const { node = {}, contract: value = unknown(node) } = getObject(branch);
    const family = getKind(value);

    return merged.some(({ node: existingNode = {}, contract: existingValue = {} } = {}) => (
        existingNode === node && getKind(existingValue) === family))
        ? merged
        : [...merged, branch];
}, []);

const setCapturedResultBranches = ({ state = {}, node = {}, branches = [] } = {}) => {
    const { resultBranches = false } = getObject(state);

    if (!resultBranches) return;

    // eslint-disable-next-line resilient/prefer-safe-transformations -- Private flow Map records evaluated alternatives under original AST node identity.
    resultBranches.set(node, mergeResultBranches(branches));
};

const captureAlternatives = ({ captureResult = false, state = {}, node = {}, branches = () => [] } = {}) => {
    if (!captureResult) return;

    setCapturedResultBranches({ state, node, branches: branches() });
};

const createCompletion = ({
    kind = 'normal',
    context = {},
    argument = {},
    value = unknown(argument),
    resultBranches = [],
    node = {},
    target = '',
    phase = '',
    reference = {}
} = {}) => ({
    kind,
    context,
    ...(['normal', 'return', 'throw'].includes(kind) ? { argument, value, node, resultBranches } : {}),
    ...(kind === 'normal' && hasObjectValue(reference) ? { reference } : {}),
    ...(kind === 'throw' ? { phase } : {}),
    ...(['break', 'continue'].includes(kind) ? { node, target } : {})
});

const mergeCompletionRecords = (completions = []) => {
    const merged = [];
    const indexed = new Map();
    const normalKey = {};

    completions.forEach((completion = {}) => {
        const {
            kind = '', context = {}, node = {}, target = '', phase = '',
            value = unknown(node), resultBranches = []
        } = getObject(completion);
        const key = kind === 'normal' ? normalKey : node;
        const candidates = indexed.get(key) || [];
        const [index = -1] = candidates.filter((candidateIndex) => {
            const { [candidateIndex]: candidate = {} } = merged;
            const {
                kind: candidateKind = '', target: candidateTarget = '', phase: candidatePhase = ''
            } = getObject(candidate);

            return kind === candidateKind && target === candidateTarget && phase === candidatePhase;
        });

        if (index < 0) {
            const { length: nextIndex = 0 } = merged;

            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private indexed completion join appends one original outcome per finite owner key.
            merged.push(completion);
            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private index is published only after the matching outcome has been appended.
            indexed.set(key, [...candidates, nextIndex]);

            return;
        }

        const { [index]: existing = {} } = merged;
        const {
            context: existingContext = {}, value: existingValue = unknown(node),
            resultBranches: existingBranches = [], reference: existingReference = {}
        } = getObject(existing);
        const { reference: completionReference = {} } = getObject(completion);
        const { receiver: existingReceiver = unknown() } = getObject(existingReference);
        const { receiver: completionReceiver = unknown() } = getObject(completionReference);
        const replacement = {
            ...existing,
            context: mergeContexts([existingContext, context]),
            ...(['normal', 'return', 'throw'].includes(kind)
                ? {
                    value: mergeFlowContracts([existingValue, value]),
                    resultBranches: mergeResultBranches([...existingBranches, ...resultBranches]),
                    ...(kind === 'normal' && hasObjectValue(existingReference) && hasObjectValue(completionReference)
                        ? { reference: {
                            receiver: mergeFlowContracts([existingReceiver, completionReceiver])
                        } }
                        : {})
                }
                : {})
        };

        // eslint-disable-next-line resilient/prefer-safe-transformations, resilient/prefer-destructured-member-access -- Private indexed join replaces only the matching completion record.
        merged[index] = replacement;
    });

    return merged;
};

const getFlowResult = ({ completions = [], context = {} } = {}) => {
    const mergedCompletions = mergeCompletionRecords(completions);
    const normalContexts = mergedCompletions
        .filter(({ kind = '' } = {}) => kind === 'normal')
        .map(({ context: completionContext = {} } = {}) => completionContext);
    const completionContexts = mergedCompletions
        .map(({ context: completionContext = {} } = {}) => completionContext);
    const contexts = normalContexts.length ? normalContexts : completionContexts;
    const resultContext = contexts.length ? mergeContexts(contexts) : copyContext(context);

    return {
        completions: mergedCompletions,
        context: resultContext,
        reachable: Boolean(normalContexts.length)
    };
};

const restoreScopeBindings = ({ before = {}, after = {}, node = {} } = {}) => {
    const next = copyContext(after);
    const { bindingIndex = {} } = next;
    const { getParent = false, getScope = false, getScopeBindings = false } = getObject(bindingIndex);

    if (typeof getScope !== 'function' || typeof getScopeBindings !== 'function') return next;

    const scope = getScope(node);
    const parent = typeof getParent === 'function' ? getParent(node) : {};
    const { body: parentBody = {} } = getObject(parent);

    if (!hasObjectValue(scope) || (isFunction(parent) && parentBody === node)) return next;

    const { bindings: beforeBindings = {}, functions: beforeFunctions = {}, aliases: beforeAliases = {} } = getObject(before);
    const scopedNames = new Set(getScopeBindings(scope).map(({ name = '' } = {}) => name));
    const restore = (current = {}, previous = {}) => Object.fromEntries([
        ...Object.entries(getObject(current)).filter(([name = ''] = []) => !scopedNames.has(name)),
        ...Object.entries(getObject(previous)).filter(([name = ''] = []) => scopedNames.has(name))
    ]);
    const { aliases: nextAliases = {}, bindings: nextBindings = {}, functions: nextFunctions = {} } = next;
    const aliases = restore(nextAliases, beforeAliases);
    const bindings = restore(nextBindings, beforeBindings);
    const functions = restore(nextFunctions, beforeFunctions);

    return { ...next, aliases, bindings, functions };
};

const restoreCompletionScope = ({ completion = {}, before = {}, node = {} } = {}) => {
    const { context = {} } = getObject(completion);

    return {
        ...completion,
        context: restoreScopeBindings({ before, after: context, node })
    };
};

// An expression publishes its normal result and every failure at the phase
// where that failure can occur. Statement composition never searches its AST.
const expressionFlow = ({ state = {}, node = {}, context = {}, captureResult = false } = {}) => {
    const source = getObject(node);
    const {
        type = '', name: sourceName = '', operator: sourceOperator = '',
        argument: sourceArgument = {}, left: sourceLeft = {}, right: sourceRight = {}
    } = source;
    const normal = (nextContext = context, value = unknown(source), branches = [], reference = {}) => createCompletion({
        context: nextContext, value, node: source, resultBranches: branches, reference
    });
    const finish = (completions = []) => {
        const captured = completions.map((entry) => {
            const { kind = '', resultBranches = [], value = unknown(source) } = getObject(entry);

            return kind === 'normal' && !resultBranches.length
                ? { ...entry, resultBranches: [{ node: source, contract: value }] }
                : entry;
        });
        const result = getFlowResult({ completions: captured, context });
        const { completions: completed = [] } = result;

        captureAlternatives({ captureResult, state, node: source, branches: () => completed
            .filter(({ kind = '' } = {}) => kind === 'normal')
            .flatMap(({ resultBranches = [], value = unknown(source) } = {}) => (
                resultBranches.length ? resultBranches : [{ node: source, contract: value }]
            )) });

        return result;
    };
    const failure = (failureContext = context, phase = 'opaque', value = unknown(source)) => createCompletion({
        kind: 'throw', context: failureContext, node: source, argument: source, value, phase
    });
    const continueWith = (flow = {}, next = () => []) => {
        const { completions = [] } = getObject(flow);

        return completions.flatMap((entry = {}) => {
            const { kind = '' } = getObject(entry);

            return kind === 'normal' ? next(entry) : [entry];
        });
    };
    const evaluateChildren = (children = [], initial = [normal(context)]) => children.reduce(
        (pending, child) => pending.flatMap((entry) => {
            const { kind = '', context: entryContext = {} } = getObject(entry);

            if (kind !== 'normal') return [entry];

            const { completions = [] } = expressionFlow({ state, node: child, context: entryContext });

            return completions;
        }),
        initial
    );

    if (!type) return finish([normal(context, unknown(source))]);

    publishExpressionContext({ state, node: source, context });

    if (isFunction(source) || type === 'Literal' || type === 'Identifier' || type === 'ThisExpression') {
        const value = inferExpression(source, context);
        const { bindingIndex = {} } = getObject(context);
        const { getBinding = false, getScope = false } = getObject(bindingIndex);
        const binding = typeof getBinding === 'function' ? getBinding(source) : {};
        const { kind: bindingKind = '', scope: bindingScope = {} } = getObject(binding);
        const { bindings = {} } = getObject(context);
        const { status: nativeStatus = '' } = type === 'Identifier'
            ? getCallableEvidence({ callee: source, context })
            : {};
        const unresolved = type === 'Identifier' && typeof getBinding === 'function' &&
            !hasObjectValue(binding) && getKind(value) === 'unknown' &&
            nativeStatus !== 'justified-native';
        const uninitialized = type === 'Identifier' && hasObjectValue(binding) &&
            ['const', 'let', 'lexical', 'class'].includes(bindingKind) &&
            !Object.hasOwn(getObject(bindings), sourceName) &&
            typeof getScope === 'function' &&
            getFunctionScope(bindingScope) === getFunctionScope(getScope(source));
        const readFailure = unresolved || uninitialized ? [failure(context, 'reference-read')] : [];

        return finish([
            ...readFailure,
            ...(!uninitialized ? [normal(context, value, [{ node: source, contract: value }])] : [])
        ]);
    }

    if (type === 'AssignmentExpression' && sourceOperator === '=') {
        const { left = {}, right = {} } = source;
        const { type: leftType = '', object = {}, property = {}, computed = false } = getObject(left);
        const referenceParts = leftType === 'MemberExpression'
            ? [object, ...(computed ? [property] : [])]
            : [];
        const references = evaluateChildren(referenceParts);
        const referenced = references.flatMap((entry) => {
            const { kind = '', context: entryContext = {}, value: keyValue = unknown(property) } = getObject(entry);

            if (kind !== 'normal' || !computed || leftType !== 'MemberExpression') return [entry];

            const needsCoercion = !['string', 'number', 'boolean', 'symbol', 'null', 'undefined']
                .includes(getKind(keyValue));

            if (!needsCoercion) return [entry];

            const coercedContext = widenEffectContext({ state, context: entryContext });

            return [failure(coercedContext, 'coercion'), { ...entry, context: coercedContext }];
        });
        const assigned = referenced.flatMap((entry) => {
            const { kind = '', context: entryContext = {} } = getObject(entry);

            if (kind !== 'normal') return [entry];

            const rightFlow = expressionFlow({ state, node: right, context: entryContext, captureResult });

            return continueWith(rightFlow, ({ context: rightContext = {}, value = unknown(right), resultBranches = [] } = {}) => {
                const { bindingIndex = {} } = getObject(rightContext);
                const { getBinding = false, rootScope = {} } = getObject(bindingIndex);
                const { node: rootProgram = {} } = getObject(rootScope);
                const { sourceType = '' } = getObject(rootProgram);
                const binding = leftType === 'Identifier' ? getContextBinding({ context: rightContext, node: left }) : {};
                const { kind: bindingKind = '' } = getObject(binding);
                const unresolved = leftType === 'Identifier' && typeof getBinding === 'function' &&
                    !hasObjectValue(binding);
                const readonly = ['const', 'import'].includes(bindingKind);
                const guaranteedFailure = readonly || (unresolved && sourceType === 'module');
                const possibleFailure = leftType === 'MemberExpression' || readonly || unresolved;
                const writeContext = leftType === 'MemberExpression'
                    ? widenEffectContext({ state, context: rightContext })
                    : rightContext;

                return [
                    ...(possibleFailure ? [failure(writeContext, 'put-value')] : []),
                    ...(guaranteedFailure ? [] : [normal(
                        assignExpression({ context: writeContext, left, value }), value, resultBranches
                    )])
                ];
            });
        });

        return finish(assigned);
    }

    if (type === 'ConditionalExpression' || type === 'LogicalExpression') {
        const { test = {}, left = {}, right = {}, consequent = {}, alternate = {}, operator = '' } = source;
        const selector = type === 'ConditionalExpression' ? test : left;
        const selected = expressionFlow({ state, node: selector, context });
        const branches = continueWith(selected, ({ context: selectedContext = {}, value = unknown(selector) } = {}) => {
            const { type: selectorType = '', value: literalValue = undefined } = getObject(selector);
            const knownSelection = selectorType === 'Literal';
            const selectedTruth = Boolean(literalValue);
            const evaluatesRight = (operator === '&&' && selectedTruth) ||
                (operator === '||' && !selectedTruth) ||
                (operator === '??' && literalValue === null);
            const conditionalOptions = [[consequent, true], [alternate, false]]
                .filter(([, truthy = false] = []) => !knownSelection || truthy === selectedTruth);
            const logicalOptions = knownSelection && !evaluatesRight
                ? [] : [[right, operator === '&&']];
            const options = type === 'ConditionalExpression' ? conditionalOptions : logicalOptions;
            const skipped = type === 'LogicalExpression' && (!knownSelection || !evaluatesRight)
                ? [normal(selectedContext, value, [{ node: selector, contract: value }])]
                : [];

            return [...skipped, ...options.flatMap(([candidate = {}, truthy = false] = []) => {
                const branchContext = type === 'LogicalExpression' && operator === '??'
                    ? selectedContext
                    : narrowContext({ ...selector, context: selectedContext, truthy });
                const { completions = [] } = expressionFlow({
                    state, node: candidate, context: branchContext, captureResult
                });

                return completions;
            })];
        });

        return finish(branches);
    }

    if (type === 'SequenceExpression') {
        const { expressions = [] } = source;
        const [last = {}] = expressions.slice(-1);
        const preceding = evaluateChildren(expressions.slice(0, -1));
        const completed = preceding.flatMap((entry) => {
            const { kind = '', context: entryContext = {} } = getObject(entry);

            if (kind !== 'normal') return [entry];

            const { completions = [] } = expressionFlow({
                state, node: last, context: entryContext, captureResult
            });

            return completions;
        });

        return finish(completed);
    }

    if (type === 'MemberExpression') {
        const { object = {}, property = {}, computed = false } = source;
        const base = expressionFlow({ state, node: object, context });
        const keyed = continueWith(base, (entry) => {
            const { context: entryContext = {}, value: baseValue = unknown(object) } = getObject(entry);

            if (!computed) return [{ ...entry, reference: { receiver: baseValue } }];

            const { completions = [] } = expressionFlow({ state, node: property, context: entryContext });

            return completions.flatMap((keyEntry) => {
                const {
                    kind = '', context: keyContext = {}, value: keyValue = unknown(property)
                } = getObject(keyEntry);

                if (kind !== 'normal') return [keyEntry];

                const keyKind = getKind(keyValue);
                const needsCoercion = !['string', 'number', 'boolean', 'symbol', 'null', 'undefined']
                    .includes(keyKind);
                const coercedContext = needsCoercion
                    ? widenEffectContext({ state, context: keyContext })
                    : keyContext;

                return [
                    ...(needsCoercion ? [failure(coercedContext, 'coercion')] : []),
                    { ...keyEntry, context: coercedContext, reference: { receiver: baseValue } }
                ];
            });
        });
        const completed = keyed.flatMap((entry) => {
            const { kind = '', context: entryContext = {}, reference = {} } = getObject(entry);

            if (kind !== 'normal') return [entry];

            const effectContext = widenEffectContext({ state, context: entryContext });
            const value = inferExpression(source, effectContext);

            return [
                failure(effectContext, 'property-get'),
                normal(effectContext, value, [], reference)
            ];
        });

        return finish(completed);
    }

    if (['CallExpression', 'NewExpression'].includes(type)) {
        const { callee = {}, arguments: args = [] } = source;
        const calleeFlow = expressionFlow({ state, node: callee, context });
        const completed = continueWith(calleeFlow, ({
            context: calleeContext = {}, value: calleeValue = unknown(callee), reference = {}
        } = {}) => {
            const argumentsFlow = args.reduce((pending, argument) => pending.flatMap((entry) => {
                const { kind = '', context: entryContext = {}, argumentValues = [] } = getObject(entry);

                if (kind !== 'normal') return [entry];

                const { completions = [] } = expressionFlow({ state, node: argument, context: entryContext });

                return completions.map((argumentEntry) => {
                    const { kind: argumentKind = '', value: argumentValue = unknown(argument) } = getObject(argumentEntry);

                    return argumentKind === 'normal'
                        ? { ...argumentEntry, argumentValues: [...argumentValues, argumentValue] }
                        : argumentEntry;
                });
            }), [{ ...normal(calleeContext), argumentValues: [] }]);

            return argumentsFlow.flatMap((entry) => {
                const { kind: entryKind = '', context: entryContext = {}, argumentValues = [] } = getObject(entry);

                if (entryKind !== 'normal') return [entry];

                const phase = type === 'NewExpression' ? 'construction' : 'invocation';
                const kind = getKind(calleeValue);
                const { sourceNode: calleeSource = {} } = getObject(calleeValue);
                const { type: calleeSourceType = '' } = getObject(calleeSource);
                const { receiver = unknown(callee) } = getObject(reference);
                const { status = '' } = getCallableEvidence({ callee, receiver, context: calleeContext });
                const nonconstructor = type === 'NewExpression' && calleeSourceType === 'ArrowFunctionExpression';
                const mayCall = !nonconstructor &&
                    (kind === 'function' || kind === 'unknown' || status === 'justified-native');
                const value = mayCall ? inferExpression(source, {
                    ...calleeContext, argumentContracts: argumentValues,
                    receiverContract: receiver
                }) : unknown(source);
                const { type: calleeType = '', name: calleeName = '' } = getObject(callee);
                const effectContext = widenEffectContext({
                    state, context: entryContext,
                    directEval: calleeType === 'Identifier' && calleeName === 'eval'
                });

                return [
                    failure(effectContext, phase),
                    ...(mayCall ? [normal(effectContext, value)] : [])
                ];
            });
        });

        return finish(completed);
    }

    if (type === 'AwaitExpression') {
        const operand = expressionFlow({ state, node: sourceArgument, context });

        return finish(continueWith(operand, (entry) => {
            const { context: entryContext = {} } = getObject(entry);
            const resumedContext = widenEffectContext({ state, context: entryContext });

            return [
                failure(resumedContext, 'await-resume'),
                normal(resumedContext, inferExpression(source, entryContext))
            ];
        }));
    }

    const { elements: sourceElements = [] } = type === 'ArrayExpression' ? source : {};
    const hasSpread = type === 'ArrayExpression' && sourceElements.some((element) => {
        const { type: elementType = '' } = getObject(element);

        return elementType === 'SpreadElement';
    });

    if (hasSpread) {
        const opaqueContext = widenEffectContext({ state, context, directEval: true });
        const { opaqueOwners = new Map() } = getObject(state);

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private owner metadata records the conservative context without walking unsupported descendants.
        opaqueOwners.set(source, opaqueContext);

        return finish([
            failure(opaqueContext, 'argument-protocol'),
            normal(opaqueContext, contract({ kind: 'array', sourceNode: source }))
        ]);
    }

    if (type === 'ArrayExpression') {
        const elements = sourceElements;
        const completed = elements.reduce((pending, element) => pending.flatMap((entry) => {
            const { kind = '', context: entryContext = {}, elementValues = [] } = getObject(entry);

            if (kind !== 'normal') return [entry];

            if (!element) return [{ ...entry, elementValues: [
                ...elementValues, contract({ kind: 'undefined', sourceNode: source })
            ] }];

            const { completions = [] } = expressionFlow({ state, node: element, context: entryContext });

            return completions.map((next) => {
                const { kind: nextKind = '', value: nextValue = unknown(element) } = getObject(next);

                return nextKind === 'normal'
                    ? { ...next, elementValues: [...elementValues, nextValue] }
                    : next;
            });
        }), [{ ...normal(context), elementValues: [] }]);

        return finish(completed.map((entry) => {
            const { kind: entryKind = '', context: entryContext = {}, elementValues = [] } = getObject(entry);

            if (entryKind !== 'normal') return entry;

            const value = contract({
                kind: 'array', sourceNode: source,
                element: mergeFlowContracts(elementValues),
                elements: elementValues
            });

            return normal(entryContext, value, [{ node: source, contract: value }]);
        }));
    }

    const { properties: sourceProperties = [] } = type === 'ObjectExpression' ? source : {};
    const hasUnsupportedProperty = type === 'ObjectExpression' && sourceProperties.some((property) => {
        const { type: propertyType = '', kind: propertyKind = '' } = getObject(property);

        return propertyType !== 'Property' || propertyKind !== 'init';
    });

    if (hasUnsupportedProperty) {
        const opaqueContext = widenEffectContext({ state, context, directEval: true });
        const { opaqueOwners = new Map() } = getObject(state);

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private owner metadata records the conservative context without walking unsupported descendants.
        opaqueOwners.set(source, opaqueContext);

        return finish([failure(opaqueContext, 'opaque'), normal(opaqueContext, contract({
            kind: 'object', sourceNode: source
        }))]);
    }

    if (type === 'ObjectExpression') {
        const properties = sourceProperties;
        const completed = properties.reduce((pending, property) => pending.flatMap((entry) => {
            const { kind = '', context: entryContext = {}, propertyValues = {} } = getObject(entry);

            if (kind !== 'normal') return [entry];

            const { key = {}, value = {}, computed = false } = getObject(property);
            const { completions: computedKeys = [] } = computed
                ? expressionFlow({ state, node: key, context: entryContext })
                : {};
            const keys = computed ? computedKeys : [entry];

            return keys.flatMap((keyEntry) => {
                const {
                    kind: keyKind = '', context: keyEntryContext = {}, value: keyContract = unknown(key)
                } = getObject(keyEntry);

                if (keyKind !== 'normal') return [keyEntry];

                const { sourceNode: keySource = {} } = getObject(keyContract);
                const { value: keyValue = undefined } = getObject(keySource);
                const name = computed && ['string', 'number', 'boolean'].includes(typeof keyValue)
                    ? String(keyValue)
                    : getPropertyName({ key, computed });
                const keyContext = computed && !name
                    ? widenEffectContext({ state, context: keyEntryContext })
                    : keyEntryContext;
                const keyFailure = computed && !name ? [failure(keyContext, 'coercion')] : [];
                const { completions: evaluatedValues = [] } = expressionFlow({
                    state, node: value, context: keyContext
                });
                const values = evaluatedValues.map((next) => {
                    const { kind: nextKind = '', value: nextValue = unknown(value) } = getObject(next);

                    return nextKind === 'normal'
                        ? { ...next, propertyValues: {
                            ...propertyValues, ...(name ? { [name]: nextValue } : {})
                        } }
                        : next;
                });

                return [...keyFailure, ...values];
            });
        }), [{ ...normal(context), propertyValues: {} }]);

        return finish(completed.map((entry) => {
            const { kind: entryKind = '', context: entryContext = {}, propertyValues = {} } = getObject(entry);

            if (entryKind !== 'normal') return entry;

            const value = contract({
                kind: 'object', sourceNode: source, properties: propertyValues
            });

            return normal(entryContext, value, [{ node: source, contract: value }]);
        }));
    }

    const { type: argumentType = '' } = type === 'UnaryExpression' ? getObject(sourceArgument) : {};
    const { bindingIndex: unaryBindingIndex = {} } = type === 'UnaryExpression' ? getObject(context) : {};
    const { getBinding: getUnaryBinding = false } = getObject(unaryBindingIndex);

    if (type === 'UnaryExpression' && sourceOperator === 'typeof' && argumentType === 'Identifier' &&
        typeof getUnaryBinding === 'function' && !hasObjectValue(getUnaryBinding(sourceArgument))) {
        return finish([normal(context, contract({ kind: 'string', sourceNode: source }))]);
    }

    if (type === 'UnaryExpression' && ['!', 'typeof', 'void'].includes(sourceOperator)) {
        const argument = expressionFlow({ state, node: sourceArgument, context });

        return finish(continueWith(argument, (entry) => {
            const { context: entryContext = {} } = getObject(entry);

            return [normal(entryContext, inferExpression(source, entryContext))];
        }));
    }

    if (type === 'BinaryExpression' && ['===', '!=='].includes(sourceOperator)) {
        const completed = evaluateChildren([sourceLeft, sourceRight]);

        return finish(completed.map((entry) => {
            const { kind = '', context: entryContext = {} } = getObject(entry);

            return kind === 'normal' ? normal(entryContext, inferExpression(source, entryContext)) : entry;
        }));
    }

    // Unsupported expressions own one conservative normal and throw possibility.
    // Their descendants are intentionally not visited or given later contexts.
    const opaqueContext = widenEffectContext({ state, context, directEval: true });
    const { opaqueOwners = false } = getObject(state);

    if (opaqueOwners) {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private owner metadata records conservative state at the unsupported expression.
        opaqueOwners.set(source, opaqueContext);
    }

    return finish([failure(opaqueContext, 'opaque'), normal(opaqueContext, unknown(source))]);
};

const getLoopElement = ({ type = '', right = {}, context = {} } = {}) => {
    if (type === 'ForInStatement') return contract({ kind: 'string', sourceNode: right });

    if (type !== 'ForOfStatement') return unknown();

    const source = inferExpression(right, context);
    const { element = unknown() } = getObject(source);

    return getKind(getObject(source)) === 'array' ? element : unknown();
};

const analyzer = {
    statement: ({ state = {}, node = {}, context = {} } = {}) => {
        const source = getObject(node);
        const {
            type = '',
            argument = {},
            test = {},
            consequent = {},
            alternate = {},
            declarations = [],
            expression = {},
            body = []
        } = source;
        publishExpressionContext({ state, node: source, context });

        if (type === 'BlockStatement') {
            const result = analyzer.statements({ state, statements: body, context });
            const { completions = [] } = result;

            return getFlowResult({
                completions: completions.map(completion => restoreCompletionScope({
                    completion,
                    before: context,
                    node: source
                })),
                context
            });
        }

        if (type === 'ReturnStatement') {
            const result = expressionFlow({
                state,
                node: argument,
                context,
                captureResult: true
            });
            const { completions: evaluated = [] } = getObject(result);
            const { type: argumentType = '' } = getObject(argument);

            return getFlowResult({
                completions: evaluated.map((entry) => {
                    const {
                        kind = '', context: entryContext = {}, value: entryValue = unknown(argument),
                        resultBranches: entryBranches = []
                    } = getObject(entry);

                    if (kind !== 'normal') return entry;

                    const value = argumentType ? entryValue : contract({ kind: 'undefined', sourceNode: source });
                    const getBranches = () => {
                        if (!argumentType) return [{ node: source, contract: value }];

                        if (entryBranches.length) return entryBranches;

                        return getCapturedResultBranches({ state, node: argument, context: entryContext });
                    };
                    const resultBranches = getBranches();

                    return createCompletion({
                        kind: 'return', context: entryContext, argument, value, resultBranches, node: source
                    });
                }),
                context
            });
        }

        if (type === 'ThrowStatement') {
            const result = expressionFlow({ state, node: argument, context });
            const { completions: evaluated = [] } = getObject(result);

            return getFlowResult({
                completions: evaluated.map((entry) => {
                    const { kind = '', context: entryContext = {}, value = unknown(argument) } = getObject(entry);

                    return kind === 'normal'
                        ? createCompletion({
                            kind: 'throw', context: entryContext, argument, value,
                            node: source, phase: 'explicit-throw'
                        })
                        : entry;
                }),
                context
            });
        }

        if (['BreakStatement', 'ContinueStatement'].includes(type)) {
            const { label = {} } = source;
            const { name: target = '' } = getObject(label);

            return getFlowResult({
                completions: [createCompletion({
                    kind: type === 'BreakStatement' ? 'break' : 'continue',
                    context,
                    node: source,
                    target
                })],
                context
            });
        }

        if (type === 'IfStatement') {
            const testFlow = expressionFlow({ state, node: test, context });
            const { completions: testCompletions = [] } = getObject(testFlow);
            const completions = testCompletions.flatMap((entry) => {
                const { kind = '', context: entryContext = {} } = getObject(entry);

                if (kind !== 'normal') return [entry];

                const consequentContext = narrowContext({ ...test, context: entryContext, truthy: true });
                const alternateContext = narrowContext({ ...test, context: entryContext, truthy: false });
                const { type: testType = '', value: testValue = undefined } = getObject(test);
                const literalTest = testType === 'Literal';
                const consequentFlow = literalTest && !testValue
                    ? getFlowResult({ completions: [], context: consequentContext })
                    : analyzer.statement({ state, node: consequent, context: consequentContext });
                const getAlternateFlow = () => {
                    if (literalTest && testValue) return getFlowResult({
                        completions: [], context: alternateContext
                    });

                    if (alternate) return analyzer.statement({ state, node: alternate, context: alternateContext });

                    return getFlowResult({
                        completions: [createCompletion({ context: alternateContext })], context
                    });
                };
                const alternateFlow = getAlternateFlow();
                const { completions: consequentCompletions = [] } = getObject(consequentFlow);
                const { completions: alternateCompletions = [] } = getObject(alternateFlow);

                return [...consequentCompletions, ...alternateCompletions];
            });

            return getFlowResult({
                completions, context
            });
        }

        if (type === 'SwitchStatement') return analyzer.switch({ state, node: source, context });

        if (['ForInStatement', 'ForOfStatement', 'ForStatement', 'WhileStatement', 'DoWhileStatement'].includes(type)) {
            return analyzer.loop({ state, node: source, context });
        }

        if (type === 'LabeledStatement') {
            const { label = {}, body: labeledBody = {} } = source;
            const { name: labelName = '' } = getObject(label);
            const { type: labeledType = '' } = getObject(labeledBody);
            const flow = ['ForInStatement', 'ForOfStatement', 'ForStatement', 'WhileStatement', 'DoWhileStatement']
                .includes(labeledType)
                ? analyzer.loop({ state, node: labeledBody, context, label: labelName })
                : analyzer.statement({ state, node: labeledBody, context });
            const { completions = [] } = getObject(flow);

            return getFlowResult({
                completions: completions.map((completion = {}) => {
                    const { kind = '', context: completionContext = {}, target = '' } = getObject(completion);

                    return kind === 'break' && target === labelName
                        ? createCompletion({ context: completionContext })
                        : completion;
                }),
                context
            });
        }

        if (type === 'TryStatement') return analyzer.try({ state, node: source, context });

        if (type === 'VariableDeclaration') {
            const completions = declarations.reduce((pending, { id = {}, init = {} } = {}) => pending.flatMap(
                (entry) => {
                    const { kind = '', context: entryContext = {} } = getObject(entry);

                    if (kind !== 'normal') return [entry];

                    const { completions: valueCompletions = [] } = expressionFlow({
                        state, node: init, context: entryContext
                    });

                    return valueCompletions.flatMap((valueEntry) => {
                        const {
                            kind: valueKind = '', context: valueContext = {}, value = unknown(init)
                        } = getObject(valueEntry);

                        if (valueKind !== 'normal') return [valueEntry];

                        const { type: patternType = '' } = getObject(id);
                        const opaquePattern = patternType && patternType !== 'Identifier';
                        const patternContext = opaquePattern
                            ? widenEffectContext({ state, context: valueContext })
                            : valueContext;
                        const bound = bindDeclaration({
                            context: patternContext, init, pattern: id, value
                        });

                        return [
                            ...(opaquePattern ? [createCompletion({
                                kind: 'throw', context: patternContext, node: id,
                                argument: id, value: unknown(id), phase: 'binding-pattern'
                            })] : []),
                            createCompletion({ context: bound })
                        ];
                    });
                }
            ), [createCompletion({ context })]);

            return getFlowResult({
                completions,
                context
            });
        }

        if (type === 'ExpressionStatement') return expressionFlow({ state, node: expression, context });

        return getFlowResult({
            completions: getChildren(source)
                .filter(child => !isFunction(child))
                .reduce((pending, child) => pending.flatMap((entry) => {
                    const { kind = '', context: entryContext = {} } = getObject(entry);

                    if (kind !== 'normal') return [entry];

                    const { completions = [] } = expressionFlow({ state, node: child, context: entryContext });

                    return completions;
                }), [createCompletion({ context })]),
            context
        });
    },

    statements: ({ state = {}, statements = [], context = {} } = {}) => {
        const before = [];
        const after = [];
        let pending = createCompletion({ context });

        statements.forEach((statement = {}) => {
            if (!pending) return;

            const { context: completionContext = {} } = getObject(pending);
            const result = analyzer.statement({ state, node: statement, context: completionContext });
            const { completions: next = [] } = getObject(result);
            const normalIndex = next.findIndex(({ kind = '' } = {}) => kind === 'normal');

            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private ordered segments avoid copying every earlier abrupt completion for each later statement.
            before.push(next.slice(0, normalIndex < 0 ? next.length : normalIndex));

            if (normalIndex < 0) {
                pending = false;

                return;
            }

            const { [normalIndex]: nextNormal = false } = next;

            pending = nextNormal;
            // eslint-disable-next-line resilient/prefer-safe-transformations -- Later abrupt outcomes precede earlier post-normal outcomes when the normal slot is replaced.
            after.push(next.slice(normalIndex + 1));
        });
        const completions = [
            ...before.flat(),
            ...(pending ? [pending] : []),
            ...after.toReversed().flat()
        ];

        return getFlowResult({ completions, context });
    },

    switch: ({ state = {}, node = {}, context = {} } = {}) => {
        const { discriminant = {}, cases = [] } = getObject(node);
        const discriminantFlow = expressionFlow({ state, node: discriminant, context });
        const { completions: discriminantCompletions = [] } = getObject(discriminantFlow);
        const completions = discriminantCompletions.flatMap((discriminantEntry) => {
            const { kind: discriminantKind = '' } = getObject(discriminantEntry);

            if (discriminantKind !== 'normal') return [discriminantEntry];

            const searched = cases.reduce((current = {}, currentCase = {}, index = 0) => {
                const { search = [], completed = [], defaultIndex = -1 } = getObject(current);
                const { test = {} } = getObject(currentCase);
                const { type: testType = '' } = getObject(test);

                if (!testType) return { search, completed, defaultIndex: index };

                const tested = search.flatMap((entry) => {
                    const { context: entryContext = {} } = getObject(entry);
                    const { completions: testedCompletions = [] } = expressionFlow({
                        state, node: test, context: entryContext
                    });

                    return testedCompletions;
                });
                const normalTests = tested.filter(({ kind = '' } = {}) => kind === 'normal');
                const statements = cases.slice(index).flatMap(({ consequent = [] } = {}) => consequent);
                const failures = tested.filter(({ kind = '' } = {}) => kind !== 'normal');
                const entered = normalTests.flatMap((entry) => {
                    const { context: entryContext = {} } = getObject(entry);
                    const { completions: bodyCompletions = [] } = analyzer.statements({
                        state, statements, context: entryContext
                    });

                    return bodyCompletions;
                });

                return { search: normalTests, completed: [...completed, ...failures, ...entered], defaultIndex };
            }, { search: [discriminantEntry], completed: [], defaultIndex: -1 });
            const { search = [], completed = [], defaultIndex = -1 } = getObject(searched);
            const defaultStatements = cases.slice(defaultIndex).flatMap(({ consequent = [] } = {}) => consequent);
            const defaultCompletions = defaultIndex < 0 ? search : search.flatMap((entry) => {
                const { context: entryContext = {} } = getObject(entry);
                const { completions: bodyCompletions = [] } = analyzer.statements({
                    state, statements: defaultStatements, context: entryContext
                });

                return bodyCompletions;
            });

            return [...completed, ...defaultCompletions].map((entry) => {
                const { kind = '', target = '', context: entryContext = {} } = getObject(entry);

                return kind === 'break' && !target ? createCompletion({ context: entryContext }) : entry;
            });
        });

        return getFlowResult({ completions, context });
    },

    loop: ({ state = {}, node = {}, context = {}, label = '' } = {}) => {
        const {
            type = '',
            init = {},
            test = {},
            update = {},
            left = {},
            right = {},
            body = {}
        } = node;
        const { declarations = [] } = left;
        const [{ id: loopPattern = {} } = {}] = declarations;
        const { type: initType = '' } = getObject(init);
        const initResult = initType === 'VariableDeclaration'
            ? analyzer.statement({ state, node: init, context })
            : expressionFlow({ state, node: init, context });
        const { completions: initCompletions = [] } = getObject(initResult);
        const loopCompletions = initCompletions.flatMap((entry = {}) => {
            const { kind: entryKind = '', context: entryContext = context } = getObject(entry);

            if (entryKind !== 'normal') return [entry];

            const { type: testType = '', value: testValue = false } = getObject(test);
            const isDo = type === 'DoWhileStatement';
            const isIteration = type === 'ForOfStatement' || type === 'ForInStatement';
            const testFlow = !isDo && (testType || isIteration)
                ? expressionFlow({ state, node: isIteration ? right : test, context: entryContext })
                : getFlowResult({ completions: [createCompletion({ context: entryContext })], context });
            const { completions: testCompletions = [] } = getObject(testFlow);

            return testCompletions.flatMap((testEntry) => {
                const { kind: testKind = '', context: testEntryContext = {} } = getObject(testEntry);

                if (testKind !== 'normal') return [testEntry];

                const testContext = isIteration
                    ? widenEffectContext({ state, context: testEntryContext })
                    : testEntryContext;
                const literalFalse = testType === 'Literal' && testValue === false;
                const isPretested = !isDo;

                if (literalFalse && isPretested) return [createCompletion({ context: testContext })];

                const element = getLoopElement({ type, right, context: testContext });
                const { type: loopPatternType = '' } = getObject(loopPattern);
                const loopContext = type === 'ForOfStatement' || type === 'ForInStatement'
                    ? bindDeclaration({
                        context: testContext,
                        pattern: loopPatternType ? loopPattern : left,
                        value: element,
                        init: {}
                    })
                    : narrowContext({ ...test, context: testContext, truthy: true });
                const bodyFlow = analyzer.statement({ state, node: body, context: loopContext });
                const { completions: bodyCompletions = [] } = getObject(bodyFlow);
                const closeCompletions = bodyCompletions.flatMap((completion = {}) => {
                    const {
                        kind = '', target = '', context: completionContext = {}, value = unknown(body)
                    } = getObject(completion);
                    const closes = type === 'ForOfStatement' && (kind === 'return' || kind === 'throw' ||
                        kind === 'break' || (kind === 'continue' && target && target !== label));

                    if (!closes) return [completion];

                    const closeContext = widenEffectContext({ state, context: completionContext });
                    const pending = {
                        ...completion,
                        context: closeContext,
                        ...(['return', 'throw'].includes(kind) ? { value: widenHeapContract(value) } : {})
                    };

                    if (kind === 'throw') return [pending];

                    return [pending, createCompletion({
                        kind: 'throw', context: closeContext, node: body,
                        argument: body, value: unknown(body), phase: 'iterator-close'
                    })];
                });
                const { exits = [], iterations = [] } = closeCompletions.reduce((current = {}, completion = {}) => {
                    const { kind = '', context: completionContext = {}, target = '' } = getObject(completion);
                    const consumed = !target || target === label;
                    const { exits: currentExits = [], iterations: currentIterations = [] } = getObject(current);

                    if (kind === 'break' && consumed) {
                        return {
                            exits: [...currentExits, createCompletion({ context: completionContext })],
                            iterations: currentIterations
                        };
                    }

                    if ((kind === 'normal' || kind === 'continue') && (kind === 'normal' || consumed)) return {
                        exits: currentExits,
                        iterations: [...currentIterations, completionContext]
                    };

                    return { exits: [...currentExits, completion], iterations: currentIterations };
                }, { exits: [], iterations: [] });
                const { type: updateType = '' } = getObject(update);
                const afterIterations = iterations.flatMap((iterationContext) => {
                    if (isDo) {
                        const { completions: afterTest = [] } = expressionFlow({
                            state, node: test, context: iterationContext
                        });

                        return afterTest;
                    }

                    if (!updateType) return [createCompletion({ context: iterationContext })];

                    const { completions: afterUpdate = [] } = expressionFlow({
                        state, node: update, context: iterationContext
                    });

                    return afterUpdate;
                });
                const definitelyTrue = testType === 'Literal' && testValue === true;
                const endlessFor = type === 'ForStatement' && !testType;
                const maySkip = isPretested && !endlessFor && !definitelyTrue;
                const mayFinishIteration = !endlessFor && !definitelyTrue;
                const normalExits = [
                    ...(maySkip ? [createCompletion({ context: testContext })] : []),
                    ...afterIterations.flatMap((iteration) => {
                        const { kind = '', context: iterationContext = {} } = getObject(iteration);

                        if (kind !== 'normal') return [iteration];

                        return mayFinishIteration ? [createCompletion({ context: iterationContext })] : [];
                    })
                ];

                return [
                    ...(isIteration ? [createCompletion({
                        kind: 'throw', context: testContext, node: right,
                        argument: right, value: unknown(right), phase: 'iteration'
                    })] : []),
                    ...exits, ...normalExits
                ];
            });
        });
        const restored = loopCompletions.map(completion => restoreCompletionScope({
            completion,
            before: context,
            node
        }));

        return getFlowResult({ completions: restored, context });
    },

    try: ({ state = {}, node = {}, context = {} } = {}) => {
        const { block = {}, handler = {}, finalizer = {} } = getObject(node);
        const safeHandler = getObject(handler);
        const safeFinalizer = getObject(finalizer);
        const { param = {}, body: handlerBody = {} } = safeHandler;
        const safeParam = getObject(param);
        const tryFlow = analyzer.statement({ state, node: block, context });
        const { completions: tryCompletions = [] } = getObject(tryFlow);
        const { type: paramType = '' } = safeParam;
        const { type: handlerType = '' } = safeHandler;
        const { type: finalizerType = '' } = safeFinalizer;
        const thrown = tryCompletions.filter(({ kind = '' } = {}) => kind === 'throw');
        const pending = tryCompletions.filter(({ kind = '' } = {}) => kind !== 'throw');
        const thrownContexts = thrown
            .map(({ context: throwContext = context } = {}) => throwContext);
        const catchBaseContext = thrownContexts.length ? mergeContexts(thrownContexts) : context;
        const thrownValue = mergeFlowContracts(thrown
            .map(({ value = unknown(safeParam) } = {}) => value));
        const catchContext = paramType
            ? bindDeclaration({
                context: catchBaseContext,
                pattern: safeParam,
                value: thrownValue,
                init: {}
            })
            : catchBaseContext;
        const patternFailure = handlerType && thrown.length && paramType && paramType !== 'Identifier'
            ? [createCompletion({
                kind: 'throw',
                context: widenEffectContext({ state, context: catchBaseContext }),
                node: safeParam,
                argument: safeParam,
                value: unknown(safeParam),
                phase: 'binding-pattern'
            })]
            : [];
        const catchFlow = handlerType && thrown.length
            ? analyzer.statement({ state, node: handlerBody, context: catchContext })
            : getFlowResult({ completions: [], context: catchContext });
        const { completions: catchCompletions = [] } = getObject(catchFlow);
        const handled = handlerType
            ? [...patternFailure, ...catchCompletions.map(catchCompletion => restoreCompletionScope({
                completion: catchCompletion,
                before: catchBaseContext,
                node: safeHandler
            }))]
            : thrown;
        const completions = [...pending, ...handled];

        if (!finalizerType) return getFlowResult({ completions, context });

        const finalizerInput = mergeContexts(completions.map(({ context: pendingContext = context } = {}) => (
            pendingContext
        )));
        const finalizerFlow = analyzer.statement({ state, node: safeFinalizer, context: finalizerInput });
        const { completions: finalizerCompletions = [] } = getObject(finalizerFlow);
        const normalFinalizers = finalizerCompletions.filter(({ kind = '' } = {}) => kind === 'normal');
        const abruptFinalizers = finalizerCompletions.filter(({ kind = '' } = {}) => kind !== 'normal');
        const resumed = completions.flatMap((pendingCompletion = {}) => {
            const {
                kind: pendingKind = '', value: pendingValue = unknown(),
                context: pendingContext = context
            } = getObject(pendingCompletion);
            const { effectVersion: pendingEffectVersion = 0 } = getObject(pendingContext);

            return normalFinalizers.map((finalizerCompletion = {}) => {
                const { context: finalizerContext = pendingContext } = getObject(finalizerCompletion);
                const { effectVersion: finalizerEffectVersion = 0 } = getObject(finalizerContext);

                return {
                    ...pendingCompletion,
                    context: finalizerContext,
                    ...(finalizerEffectVersion > pendingEffectVersion &&
                        ['return', 'normal'].includes(pendingKind)
                        ? { value: widenHeapContract(pendingValue) }
                        : {})
                };
            });
        });

        return getFlowResult({ completions: [...resumed, ...abruptFinalizers], context });
    }
};

const createFunctionFlow = ({
    functionNode = {},
    definitions = {},
    initialBindings = {},
    flows = new Map()
} = {}) => {
    const { bindingIndex = {}, byBinding = new Map() } = getDefinitionMetadata(definitions);
    const signature = getSignature(functionNode, { bindingIndex });
    const matchingDefinitions = Object.entries(definitions)
        .filter(([, definition = {}] = []) => {
            const { node: definitionNode = {} } = getObject(definition);

            return definitionNode === functionNode;
        })
        .map(([name = ''] = []) => name);
    const [functionName = ''] = matchingDefinitions;
    const [functionBinding = {}] = [...byBinding]
        .find(([, { node: definitionNode = {} } = {}]) => definitionNode === functionNode) || [];
    const { id: functionBindingId = '' } = getObject(functionBinding);
    const functionIdentity = functionBindingId || functionName;
    const state = createFlowState(bindingIndex, functionNode);
    const { contexts = new Map(), opaqueOwners = new Map() } = state;
    const { bindings: signatureBindings = {} } = getObject(signature);
    let context = {
        bindings: { ...signatureBindings, ...initialBindings },
        bindingAliases: new Map(),
        bindingIndex,
        bindingValues: new Map(),
        functions: definitions,
        functionBindings: new Map(byBinding),
        flows,
        callStack: functionIdentity ? [functionIdentity] : [],
        evaluateCalls: true,
        evaluationDepth: 0
    };
    const { params = [] } = getObject(functionNode);
    const { parameters = [] } = signature;
    params.forEach((parameter = {}, index = 0) => {
        const { [index]: parameterValue = unknown(parameter) } = parameters;

        context = bindPattern({ context, pattern: parameter, value: parameterValue });
    });
    const { bindings: parameterBindings = {}, bindingValues: parameterValues = new Map() } = context;
    context = {
        ...context,
        bindings: { ...parameterBindings, ...initialBindings }
    };

    const initialValues = hasObjectValue(bindingIndex) ? [...parameterValues].map(([binding = {}, value = unknown()] = []) => {
        const { name = '' } = binding;
        const { [name]: initialValue = value } = initialBindings;

        return [binding, Object.hasOwn(initialBindings, name) ? initialValue : value];
    }) : [...parameterValues];
    context = { ...context, bindingValues: new Map(initialValues) };

    const { body = {} } = getObject(functionNode);
    const { type: bodyType = '' } = getObject(body);
    const expressionResult = bodyType === 'BlockStatement'
        ? {}
        : expressionFlow({ state, node: body, context, captureResult: true });
    const { completions: expressionCompletions = [] } = getObject(expressionResult);
    const result = bodyType === 'BlockStatement'
        ? analyzer.statement({ state, node: body, context })
        : getFlowResult({
            completions: expressionCompletions.map((entry) => {
                const {
                    kind = '', context: entryContext = {}, value = unknown(body),
                    resultBranches: entryBranches = []
                } = getObject(entry);

                if (kind !== 'normal') return entry;

                return createCompletion({
                    kind: 'return',
                    context: entryContext,
                    argument: body,
                    value,
                    resultBranches: entryBranches.length ? entryBranches : getCapturedResultBranches({
                        state, node: body, context: entryContext
                    }),
                    node: body
                });
            }),
            context
        });
    const { context: resultContext = result } = getObject(result);
    const { completions = [] } = getObject(result);
    const returns = completions
        .filter(({ kind = '' } = {}) => kind === 'return')
        .map((completion = {}) => {
            const {
                argument = {},
                context: returnContext = {},
                node: returnNode = {},
                resultBranches = [],
                value = unknown(argument)
            } = getObject(completion);

            return {
                argument,
                context: returnContext,
                contract: value,
                resultBranches,
                node: returnNode
            };
        });
    const flow = {
        contexts,
        opaqueOwners,
        finalContext: resultContext,
        completions,
        returns
    };

    // The shared map is private analysis-session state. Publishing happens only
    // after the function's completions and compatibility return view are complete.
    // eslint-disable-next-line resilient/prefer-safe-transformations -- Private completed-flow publication preserves AST identity and enables recursive consumers without mutating caller-owned nodes.
    flows.set(functionNode, flow);

    return flow;
};

const createProgramFlow = ({ program = {}, definitions = {}, flows = new Map() } = {}) => {
    const { bindingIndex = {}, byBinding = new Map() } = getDefinitionMetadata(definitions);
    const state = createFlowState(bindingIndex);
    const { contexts = new Map(), opaqueOwners = new Map() } = state;
    const context = {
        bindings: {},
        bindingAliases: new Map(),
        bindingIndex,
        bindingValues: new Map(),
        functions: definitions,
        functionBindings: new Map(byBinding),
        flows,
        callStack: [],
        evaluateCalls: true,
        evaluationDepth: 0
    };
    const { body: programStatements = [] } = getObject(program);
    const result = analyzer.statements({
        state,
        statements: programStatements,
        context
    });
    const { context: resultContext = context } = getObject(result);
    const flow = {
        contexts,
        opaqueOwners,
        finalContext: resultContext,
        returns: []
    };

    // eslint-disable-next-line resilient/prefer-safe-transformations -- Private completed-flow publication preserves AST identity and enables recursive consumers without mutating caller-owned nodes.
    flows.set(program, flow);

    return flow;
};

const createFunctionFlows = ({ program = {}, definitions = {}, functions = false } = {}) => {
    const flows = new Map();

    createProgramFlow({ program, definitions, flows });
    (Array.isArray(functions) ? functions : getFunctionNodes(program)).forEach((functionNode) => {
        createFunctionFlow({ functionNode, definitions, flows });
    });

    return flows;
};

const getEnclosingProgram = (node = {}) => {
    const source = getObject(node);
    const { type = '', parent = {} } = source;

    if (type === 'Program') return source;

    return hasObjectValue(parent) ? getEnclosingProgram(parent) : {};
};

const getFlowContext = ({ node = {}, definitions = {}, flows = new Map() } = {}) => {
    const { bindingIndex = {}, byBinding = new Map() } = getDefinitionMetadata(definitions);
    const getScopeOwner = ({ type = '', node: scopeNode = {}, parent = {} } = {}) => {
        if (!type) return {};

        return type === 'function' ? scopeNode : getScopeOwner(parent);
    };
    const { getScope = false } = getObject(bindingIndex);
    const functionNode = typeof getScope === 'function'
        ? getScopeOwner(getScope(node))
        : getEnclosingFunction(node);
    const { rootScope = {} } = getObject(bindingIndex);
    const { node: rootNode = {} } = getObject(rootScope);
    const programNode = hasObjectValue(bindingIndex) ? rootNode : getEnclosingProgram(node);
    const flow = flows.get(functionNode) || flows.get(programNode) || {};
    const { contexts = new Map(), opaqueOwners = new Map(), finalContext = {} } = getObject(flow);

    if (contexts.get(node)) return contexts.get(node);

    const { getParent = false } = getObject(bindingIndex);
    const findOpaqueContext = (parent = {}) => {
        if (!hasObjectValue(parent)) return { found: false, context: {} };

        if (opaqueOwners.has(parent)) return { found: true, context: opaqueOwners.get(parent) };

        if (parent === functionNode || parent === programNode) return { found: false, context: {} };

        return findOpaqueContext(getParent(parent));
    };
    const { found = false, context: ownerContext = {} } = typeof getParent === 'function'
        ? findOpaqueContext(getParent(node))
        : {};

    if (found) return ownerContext;

    if (hasObjectValue(finalContext)) return finalContext;

    return {
        bindingIndex,
        bindingValues: new Map(),
        functions: definitions,
        functionBindings: new Map(byBinding),
        flows
    };
};

export {
    createFunctionFlow,
    createFunctionFlows,
    getFlowContext,
    hasCallableCapability,
    isCallableGuard,
    isExitingStatement,
    hasDirectCapabilityBinding,
    hasProviderForwardBinding,
    isFoldMapMonoidIdentityBinding,
    isTerminatingVariantLoopBinding,
    hasTupleGuardedBinding,
    narrowContext
};
