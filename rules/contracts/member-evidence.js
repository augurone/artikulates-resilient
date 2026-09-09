import { getBinding, getBindingDefinition } from './binding-evidence.js';
import { getKind, unknown } from './model.js';
import { isFunctionType } from '../support/ast-function.js';
import { getObject, hasObjectValue } from '../support/object.js';

const getEnclosingFunction = (node = {}) => {
    const { parent = {} } = getObject(node);
    const { type = '' } = getObject(parent);

    if (!type) return {};

    return isFunctionType(type) ? parent : getEnclosingFunction(parent);
};

const nativeMethods = Object.freeze({
    array: Object.freeze(['map', 'filter', 'some', 'find', 'reduce', 'forEach']),
    regexp: Object.freeze(['test']),
    string: Object.freeze(['trim', 'toLowerCase', 'toUpperCase', 'replaceAll'])
});

const staticNativeMethods = Object.freeze({
    Array: Object.freeze(['isArray']),
    Object: Object.freeze(['entries', 'keys', 'values']),
    Promise: Object.freeze(['all', 'resolve'])
});

const nativeFunctions = Object.freeze({
    Boolean: 'boolean',
    Number: 'number',
    String: 'string'
});

const getContextBinding = ({ node = {}, context = {} } = {}) => {
    const { bindingIndex = {} } = getObject(context);
    const { getBinding: resolveBinding = false } = getObject(bindingIndex);

    return typeof resolveBinding === 'function' ? resolveBinding(node) : {};
};

const getAliasSource = ({ node = {}, context = {} } = {}) => {
    const binding = getContextBinding({ node, context });
    const { declaration = {}, kind: bindingKind = '' } = getObject(binding);
    const { bindingIndex = {} } = getObject(context);
    const { getParent = false } = getObject(bindingIndex);

    if (!declaration || typeof getParent !== 'function' || bindingKind !== 'const') return {};

    const declarator = getParent(declaration);
    const { type = '', id = {}, init = {} } = getObject(declarator);
    const declarationStatement = getParent(declarator);
    const { kind = '' } = getObject(declarationStatement);

    return type === 'VariableDeclarator' && id === declaration && kind === 'const'
        ? init
        : {};
};

const getNativeIdentity = ({ node = {}, context = {}, seen = [] } = {}) => {
    const { type = '', name = '' } = getObject(node);

    if (type !== 'Identifier' || seen.includes(node)) return '';

    const { bindingIndex = {} } = getObject(context);
    const { getScope = false } = getObject(bindingIndex);
    const binding = getContextBinding({ node, context });

    // An unresolved identifier is native evidence only in a completed lexical
    // session that actually contains this occurrence.
    if (!hasObjectValue(binding)) return typeof getScope === 'function' && hasObjectValue(getScope(node)) &&
        (Object.hasOwn(staticNativeMethods, name) || Object.hasOwn(nativeFunctions, name))
        ? name
        : '';

    const source = getAliasSource({ node, context });

    return getNativeIdentity({ node: source, context, seen: [...seen, node] });
};

const getOwnCallable = ({ receiver = {}, method = '' } = {}) => {
    const { properties = {} } = getObject(receiver);

    if (!Object.hasOwn(getObject(properties), method)) return { status: 'absent' };

    const { [method]: member = {} } = getObject(properties);
    const { kind = '', returnContract = {} } = getObject(member);

    return kind === 'function' || Object.keys(getObject(returnContract)).length
        ? { status: 'callable', member }
        : { status: 'non-callable' };
};

// One finite query owns authored/native callable admission. A spelling alone
// never turns an unknown receiver or a shadowed global into native evidence.
const getCallableEvidence = ({ callee = {}, receiver = unknown(), context = {} } = {}) => {
    const { type = '', object = {}, property = {}, computed = false } = getObject(callee);
    const { type: propertyType = '', name: method = '' } = getObject(property);

    if (type === 'Identifier') {
        const nativeIdentity = getNativeIdentity({ node: callee, context });
        const { [nativeIdentity]: returnKind = '' } = nativeFunctions;

        return returnKind
            ? Object.freeze({ status: 'justified-native', nativeIdentity, returnKind })
            : Object.freeze({ status: 'unknown' });
    }

    if (type !== 'MemberExpression' || computed || propertyType !== 'Identifier' || !method) {
        return Object.freeze({ status: 'unknown' });
    }

    const own = getOwnCallable({ receiver, method });
    const { status: ownStatus = '', member = {} } = own;

    if (ownStatus === 'callable') return Object.freeze({ status: 'known-authored', member, method });

    // A known own non-callable also blocks prototype/native-name admission.
    if (ownStatus === 'non-callable') return Object.freeze({ status: 'unknown' });

    const nativeIdentity = getNativeIdentity({ node: object, context });
    const { [nativeIdentity]: admittedStaticMethods = [] } = staticNativeMethods;

    if (admittedStaticMethods.includes(method)) return Object.freeze({
        status: 'justified-native',
        nativeIdentity,
        method
    });

    const receiverKind = getKind(receiver);
    const [matchingMethod = []] = Object.entries(nativeMethods)
        .filter(([, methods = []] = []) => methods.includes(method));
    const [expectedKind = ''] = matchingMethod;

    if (!expectedKind || receiverKind === 'unknown') return Object.freeze({ status: 'unknown' });

    return Object.freeze({
        status: 'justified-native',
        expectedKind,
        method,
        receiverKind
    });
};

const isFunctionLiteral = ({ type = '', value = '' } = {}) => type === 'Literal' && value === 'function';
const isSynchronousFunctionPredicate = ({ functionNode = {}, matches = () => false } = {}) => {
    const { async = false, generator = false, params = [], body = {} } = getObject(functionNode);
    const [parameter = {}] = params;
    const { type: bodyType = '', body: statements = [] } = getObject(body);
    const [statement = {}] = Array.isArray(statements) ? statements : [];
    const { type: statementType = '', argument = {} } = getObject(statement);
    const expression = bodyType === 'BlockStatement' && statements.length === 1 && statementType === 'ReturnStatement'
        ? argument
        : body;
    const isGuard = (node = {}) => {
        const { type = '', operator = '', left = {}, right = {} } = getObject(node);
        const isTypeofParameter = (candidate = {}) => {
            const { type: candidateType = '', operator: candidateOperator = '', argument: candidateArgument = {} } = getObject(candidate);

            return candidateType === 'UnaryExpression' && candidateOperator === 'typeof' && matches(candidateArgument, parameter);
        };

        if (type === 'BinaryExpression' && ['===', '=='].includes(operator)) {
            return (isTypeofParameter(left) && isFunctionLiteral(right)) ||
                (isTypeofParameter(right) && isFunctionLiteral(left));
        }

        return type === 'LogicalExpression' && operator === '&&' && [left, right].some(isGuard);
    };

    return !async && !generator && params.length === 1 && isGuard(expression);
};

const getPredicateEvidence = ({ node = {}, context = {}, allowUnresolvedLocal = true } = {}) => {
    const { type = '', callee = {}, arguments: args = [] } = getObject(node);
    const [argument = {}] = Array.isArray(args) ? args : [];
    const { type: argumentType = '' } = getObject(argument);

    if (type !== 'CallExpression' || argumentType !== 'Identifier' || args.length !== 1) {
        return Object.freeze({ status: 'unknown' });
    }

    const { type: calleeType = '', name = '' } = getObject(callee);

    if (calleeType === 'MemberExpression') {
        const evidence = getCallableEvidence({ callee, context });
        const { status = 'unknown', nativeIdentity = '', method = '' } = evidence;

        return status === 'justified-native' && nativeIdentity === 'Array' && method === 'isArray'
            ? Object.freeze({ ...evidence, predicateKind: 'array' })
            : Object.freeze({ status: 'unknown' });
    }

    if (calleeType !== 'Identifier') return Object.freeze({ status: 'unknown' });

    const binding = getContextBinding({ node: callee, context });
    const { kind: bindingKind = '', declaration = {} } = getObject(binding);

    if (!hasObjectValue(binding) || bindingKind === 'import') {
        return allowUnresolvedLocal && name === 'isFunction'
            ? Object.freeze({ status: 'unknown', compatibility: 'unresolved-local', predicateKind: 'function' })
            : Object.freeze({ status: 'unknown' });
    }

    const { bindingIndex = {}, functionBindings = new Map() } = getObject(context);
    const { getParent = false, getBinding: resolveBinding = false } = getObject(bindingIndex);
    const definition = functionBindings.get(binding) || {};
    const { node: definitionNode = {} } = getObject(definition);
    const parent = typeof getParent === 'function' ? getParent(declaration) : {};
    const { type: parentType = '', init = {} } = getObject(parent);
    let functionNode = parent;

    if (parentType === 'VariableDeclarator') functionNode = init;

    if (Object.keys(getObject(definitionNode)).length) functionNode = definitionNode;

    const matches = (candidate = {}, parameter = {}) => typeof resolveBinding === 'function' &&
        resolveBinding(candidate) === resolveBinding(parameter);

    return Object.freeze({
        status: 'known-authored',
        predicateKind: isSynchronousFunctionPredicate({ functionNode, matches }) ? 'function' : ''
    });
};

const isReduceCallback = ({ parent = {}, node = {} } = {}) => {
    const {
        type = '',
        callee = {},
        arguments: sourceArguments = []
    } = getObject(parent);
    const {
        type: calleeType = '',
        property = {},
        computed = false
    } = getObject(callee);
    const { type: propertyType = '', name: propertyName = '' } = getObject(property);
    const args = Array.isArray(sourceArguments) ? sourceArguments : [];
    const [firstArgument = {}] = args;

    return (
        type === 'CallExpression' &&
        calleeType === 'MemberExpression' &&
        propertyType === 'Identifier' &&
        propertyName === 'reduce' &&
        !computed &&
        firstArgument === node
    );
};

const isLengthMember = (node = {}) => {
    const { property = {}, object = {} } = getObject(node);
    const { name = '' } = getObject(property);
    const { type: objectType = '' } = getObject(object);

    return ['length', 'size'].includes(name) && objectType === 'Identifier';
};

const isPrototypeMemberAccess = ({ node = {} } = {}) => {
    const { parent = {} } = getObject(node);
    const {
        type: parentType = '',
        callee = {},
        object = {},
        property = {}
    } = getObject(parent);

    if (parentType === 'CallExpression' && callee === node) return true;

    if (parentType !== 'MemberExpression' || object !== node) return false;

    const { name = '' } = getObject(property);

    if (name === 'length' || name === 'size') return true;

    return isPrototypeMemberAccess({ node: parent });
};

const getMemberAccessFact = (node = {}) => {
    const { object = {} } = getObject(node);
    const binding = getBinding(object);
    const { type = '', node: declaration = {}, name: identifier = {} } = getBindingDefinition(binding);
    const owner = type === 'Parameter' ? declaration : getEnclosingFunction(declaration);
    const { type: ownerType = '', parent = {}, params = [] } = getObject(owner);

    if (!['Parameter', 'Variable'].includes(type) || !ownerType) return 'unbound';

    const [parameter = {}] = params;
    const { type: parameterType = '', left = {} } = getObject(parameter);
    const firstBinding = parameterType === 'AssignmentPattern' ? left : parameter;

    if (type === 'Parameter' && firstBinding === identifier && getEnclosingFunction(node) === owner &&
        isReduceCallback({ parent, node: owner })) return 'reducer';

    if (isLengthMember(node)) return 'cardinality';

    return isPrototypeMemberAccess({ node }) ? 'receiver' : 'static-data';
};

export {
    getCallableEvidence,
    getMemberAccessFact,
    getPredicateEvidence,
    isSynchronousFunctionPredicate
};
