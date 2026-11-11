import { put } from '../collections.js';
import { traverse } from '../traversal.js';

const returned = ({ type = '', body = [], argument = false } = {}) => {
    if (type === 'ReturnStatement') return argument ? [argument] : [];

    if (type !== 'BlockStatement') return [];

    const [{ type: first = '', argument: value = false } = {}] = body;

    return body.length === 1 && first === 'ReturnStatement' && value ? [value] : [];
};
const emptyValue = ({ type = '', value = false, elements = [] } = {}) => (type === 'Literal' && value === '') || (type === 'ArrayExpression' && !elements.length);

// These are the rule's finite forwarding/tuple grammar admissions. They do not
// refine value families or certify opaque predicates and native method identity.
export const absenceBoundaries = ({ parents = new WeakMap(), identities = new WeakMap(), writes = new Set(),
    previousStatements = new WeakMap(), nextStatements = new WeakMap(), functionEntries = [] } = {}) => {
    const contexts = new WeakMap();
    const decisions = new WeakMap();
    const functions = new WeakMap(functionEntries.map((entry) => {
        const { node = {} } = entry;

        return [node, entry];
    }));
    const contextFor = (node) => {
        traverse(node, { enter: current => contexts.has(current) ? [] : [parents.get(current)].filter(Boolean), leave: (current) => {
            if (contexts.has(current)) return;

            const parent = parents.get(current);
            const inherited = contexts.get(parent) ?? {};
            const { type = '' } = current;
            put(contexts, current, { ...inherited,
                ...(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(type) ? { callable: current, branch: false } : {}),
                ...(type === 'SwitchCase' ? { branch: current } : {}) });
        } });

        return contexts.get(node) ?? {};
    };
    const same = (left, right) => left === right || Boolean(identities.get(left) && identities.get(left) === identities.get(right));
    const stable = node => Boolean(identities.get(node) && !writes.has(identities.get(node)));
    const canonicalCall = ({ type = '', callee = {}, arguments: args = [] } = {}, name, source) => {
        const { type: kind = '', name: called = '' } = callee;
        const binding = identities.get(callee);
        const { imported = false } = binding ?? {};

        return type === 'CallExpression' && kind === 'Identifier' && called === name && (!binding || imported) && args.length === 1 && same(args.at(0), source);
    };
    const lacksArray = ({ type = '', operator = '', argument = {} } = {}, source) => type === 'UnaryExpression' && operator === '!' && canonicalCall(argument, 'isArray', source);
    const lacksLength = ({ type = '', operator = '', left = {}, right = {} } = {}, source, width) => {
        const { type: member = '', computed = false, object = {}, property: { name = '' } = {} } = left;
        const { type: literal = '', value = 0 } = right;

        return type === 'BinaryExpression' && operator === '<' && member === 'MemberExpression' && !computed && name === 'length' &&
            same(object, source) && literal === 'Literal' && Number.isInteger(value) && value >= width;
    };
    const guardRejectsTuple = ({ type = '', operator = '', argument = {}, left = {}, right = {} } = {}, source, width) => {
        if (width === 1 && type === 'UnaryExpression' && operator === '!' && canonicalCall(argument, 'hasArrayContent', source)) return true;

        if (type !== 'LogicalExpression' || operator !== '||') return false;

        const clauses = [left, right];

        return clauses.some(clause => lacksArray(clause, source)) && clauses.some(clause => lacksLength(clause, source, width));
    };
    const liftedFailure = ({ type = '', callee = {}, arguments: args = [] } = {}, following, { elements: bindings = [] } = {}) => {
        const [result = {}] = returned(following);
        const { type: resultType = '', callee: resultCallee = {}, arguments: resultArgs = [] } = result;
        const { type: calleeType = '', object = {}, computed = false, property: { name = '' } = {} } = callee;
        const { type: otherType = '', object: other = {}, computed: otherComputed = false, property: { name: otherName = '' } = {} } = resultCallee;
        const [{ type: valuesType = '', elements = [] } = {}] = resultArgs;

        return type === 'CallExpression' && resultType === type && args.length === 1 && emptyValue(args.at(0)) && resultArgs.length === 1 &&
            calleeType === 'MemberExpression' && otherType === calleeType && !computed && !otherComputed && name === otherName && same(object, other) &&
            valuesType === 'ArrayExpression' && elements.length === bindings.length && elements.every((value, position) => same(value, bindings.at(position)));
    };
    const arityTuple = (pattern, init, statement) => {
        const { elements = [] } = pattern;

        const { callable = {}, branch = false } = contextFor(pattern);
        const { params = [], body: { body: statements = [] } = {} } = functions.get(callable) ?? {};
        const { type: callableType = '' } = callable;
        const binding = identities.get(init);
        const { declaration: { rest = false } = {} } = binding ?? {};

        if (!branch) return false;

        const { test: { type: literal = '', value = 0 } = {}, consequent: caseStatements = [] } = branch;
        const selection = parents.get(branch) ?? {};
        const { cases = [], discriminant: { type: member = '', computed = false, object = {}, property: { name: field = '' } = {} } = {} } = selection;
        const { name = '' } = object;
        const offset = params.findIndex(({ type: kind = '', argument = false } = {}) => kind === 'RestElement' && same(argument, init));
        const container = parents.get(statement) ?? {};
        const { type: containerType = '', body: contents = [] } = container;
        const beginsCase = containerType === 'BlockStatement' ? caseStatements.at(0) === container && contents.at(0) === statement : caseStatements.at(0) === statement;
        const fixedPrefix = params.slice(0, offset).every(({ type = '' } = {}) => type === 'Identifier');

        if (rest && branch && callableType !== 'ArrowFunctionExpression' && !identities.has(object) && cases.at(0) === branch && statements.at(0) === selection &&
            beginsCase && fixedPrefix && literal === 'Literal' && Number.isInteger(value) && member === 'MemberExpression' && !computed &&
            name === 'arguments' && field === 'length' && offset >= 0 && value >= offset + elements.length) return true;

        return false;
    };
    const tupleBoundary = ({ pattern = {}, init = false } = {}) => {
        const { type = '', elements = [] } = pattern;

        if (type !== 'ArrayPattern' || !init || !stable(init)) return {};

        if (!elements.filter(Boolean).every(({ type = '' } = {}) => type === 'Identifier')) return {};

        const declarator = parents.get(pattern) ?? {};
        const statement = parents.get(declarator) ?? {};
        const { type: declarationType = '', declarations = [] } = statement;

        // Earlier initializers can invalidate the guard before this read.
        if (declarationType !== 'VariableDeclaration' || declarations.at(0) !== declarator) return {};

        if (arityTuple(pattern, init, statement)) return { code: 'arity-selected-tuple' };

        const preceding = previousStatements.get(statement) ?? {};
        const { type: guard = '', test = {}, consequent = {}, alternate = false } = preceding;
        const [failure = {}] = returned(consequent);

        if (guard !== 'IfStatement' || alternate || !guardRejectsTuple(test, init, elements.length)) return {};

        if (emptyValue(failure) || liftedFailure(failure, nextStatements.get(statement) || {}, pattern)) return { code: 'guarded-tuple' };

        const { callable = {} } = contextFor(pattern);
        const { index = -1 } = functions.get(callable) ?? {};

        // A nonliteral rejection needs the function's completed result evidence.
        // Acquisition records the obligation; demand owns the proof.
        return { code: '', functionIndex: index, failure };
    };
    const forwardingBoundary = ({ pattern = {} } = {}) => {
        const { type = '', properties = [] } = pattern;
        const [{ type: propertyType = '', computed = false, value = {} } = {}] = properties;
        const { type: valueType = '' } = value;
        const { callable = {} } = contextFor(pattern);
        const { params = [], body = {} } = functions.get(callable) ?? {};
        const [result = body] = returned(body);
        const invocation = parents.get(callable) ?? {};
        const { type: invoked = '', callee = false, arguments: args = [] } = invocation;

        if (type !== 'ObjectPattern' || properties.length !== 1 || propertyType !== 'Property' || computed || valueType !== 'Identifier' ||
            params.length !== 1 || params.at(0) !== pattern || !same(value, result) || invoked !== 'CallExpression' || callee !== callable || args.length !== 1) return '';

        const container = parents.get(invocation) ?? {};
        const { type: containerType = '', value: entry = false, computed: dynamic = false } = container;
        const object = parents.get(container) ?? {};
        const { type: objectType = '' } = object;
        const output = parents.get(object) ?? {};
        const { type: outputType = '', argument = false, body: expression = false } = output;

        if (containerType === 'Property' && !dynamic && entry === invocation && objectType === 'ObjectExpression' &&
            ((outputType === 'ReturnStatement' && argument === object) || (outputType === 'ArrowFunctionExpression' && expression === object))) return 'field-forwarding';

        const { type: callbackType = '', params: callbackParams = [], body: callbackBody = false } = container;
        const mapCall = parents.get(container) ?? {};
        const { type: mapType = '', callee: { type: member = '', computed: selected = false, property: { name = '' } = {} } = {}, arguments: callbacks = [] } = mapCall;

        return callbackType === 'ArrowFunctionExpression' && callbackBody === invocation && callbackParams.length === 1 && same(callbackParams.at(0), args.at(0)) &&
            mapType === 'CallExpression' && member === 'MemberExpression' && !selected && name === 'map' && callbacks.at(0) === container ? 'map-projection' : '';
    };

    return (declaration) => {
        const { pattern = {} } = declaration;

        if (!decisions.has(pattern)) {
            const { code = '', ...obligation } = tupleBoundary(declaration);

            put(decisions, pattern, { ...obligation, code: code || forwardingBoundary(declaration) });
        }

        return decisions.get(pattern);
    };
};
