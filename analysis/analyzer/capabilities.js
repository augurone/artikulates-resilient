import { put } from '../collections.js';
import { locationOf } from './locations.js';

const noTest = Object.freeze({ capability: false });

const functionComparison = (node = {}, operators = new WeakMap()) => {
    const { type = '', left = {}, right = {} } = node;
    const operator = operators.get(node) || '';

    if (type !== 'BinaryExpression' || !['===', '!=='].includes(operator)) return {};

    const sides = [[left, right], [right, left]];
    const match = sides.find(([tested = {}, literal = {}] = []) => {
        const { type: unary = '' } = tested;
        const operation = operators.get(tested) || '';
        const { type: valueType = '', value = '' } = literal;

        return unary === 'UnaryExpression' && operation === 'typeof' && valueType === 'Literal' && value === 'function';
    });
    const [{ argument = false } = {}] = match ?? [];

    return { subject: argument, positive: operator === '===' };
};

// Identity comes from the lexical index. A helper's name grants no body proof.
// These are expression headers already owned by acquisition, not another walk.
export const acquireCapabilities = ({ index = {}, callables = new Map() } = {}, contextFor) => {
    const { bindings = [], identities = new WeakMap(), callableResolutions = new WeakMap(), writes = new Set(), opaqueCapabilities = new Set(),
        moduleOfExecution = new Map(), importTargets = new Map(), operators = new WeakMap(), parents = new WeakMap(), references = [] } = index;
    const subjects = new WeakMap();
    const changes = new WeakMap();

    if (typeof contextFor !== 'function') throw new TypeError('Expected acquired reference contexts');

    references.forEach(({ node = {}, parent = {}, execution = false } = {}) => {
        const binding = identities.get(node);

        if (!binding || !writes.has(binding)) return;

        const { mutation = false, repeated = false } = contextFor(node);

        if (!mutation) return;

        const { execution: owner = false } = binding;
        const { type = '', left = false } = parent;
        const { type: container = '' } = parents.get(parent) ?? {};
        // A direct assignment statement is owned by completion sequencing.
        // Embedded or repeated writes need a wider revision acquisition contract.
        const supported = owner === execution && !repeated && type === 'AssignmentExpression' && left === node &&
            operators.get(parent) === '=' && container === 'ExpressionStatement';

        put(changes, binding, changes.get(binding) !== false && supported);
    });

    bindings.forEach((binding) => {
        const { index: position = -1, immutable = false, execution = false, init = {},
            declaration: { node = {}, destructured = false } = {}, parameterPattern = false, optionalCallback = false } = binding;

        const mutable = writes.has(binding);

        if (!immutable || opaqueCapabilities.has(execution) || (mutable && (!parameterPattern || !changes.get(binding)))) return;

        const alias = !destructured && subjects.get(identities.get(init));
        const { mutable: changing = false, optionalCallback: inherited = false } = alias ? alias : {};

        if (!alias && !destructured && !parameterPattern) return;

        put(subjects, binding, alias && !changing && !mutable ? alias : Object.freeze({ kind: 'capability', index: position, execution, location: locationOf(node), mutable,
            filename: moduleOfExecution.get(execution) || '', optionalCallback: optionalCallback || inherited }));
    });
    const subjectFor = node => subjects.get(identities.get(node)) || false;
    const directTest = (node) => {
        const { subject = false, positive = true } = functionComparison(node, operators);
        const capability = subject && subjectFor(subject);

        return { capability, positive };
    };
    const tests = new WeakMap();
    const acquireTest = (node = {}) => {
        const { type = '', callee = {}, arguments: args = [], optional = false } = node;
        const direct = directTest(node);
        const { capability: compared = false } = direct;

        if (compared) return direct;

        if (type !== 'CallExpression' || optional || args.length !== 1) return noTest;

        const [argument = {}] = args;
        const capability = subjectFor(argument);

        if (!capability) return noTest;

        const { name = '' } = callee;
        const binding = identities.get(callee);
        const { imported = false } = binding ?? {};

        const helper = callables.get(callableResolutions.get(callee));

        // Unresolved syntax is a local policy admission, never consumer proof.
        if (!helper && (!binding || (imported && !importTargets.has(binding))) && name === 'isFunction') return { capability, positive: true, syntaxOnly: true };

        if (!helper) return noTest;

        const { params = [], body = {} } = helper ?? {};
        const [parameter = {}] = params;
        const { type: parameterType = '', name: parameterName = '' } = parameter;
        const { type: bodyType = '', body: contents = [] } = body;
        const statements = bodyType === 'BlockStatement' ? contents : [];
        const [{ type: statementType = '', argument: returned = {} } = {}] = statements;
        const expression = (bodyType === 'BlockStatement' && statements.length === 1 && statementType === 'ReturnStatement' ? returned : body) ?? {};
        const { type: expressionType = '', left = {}, right = {} } = expression;
        const operator = operators.get(expression) || '';
        const { type: leftType = '', name: leftName = '' } = left;
        const selected = expressionType === 'LogicalExpression' && operator === '&&' && leftType === 'Identifier' && leftName === parameterName ? right : expression;
        const { subject = false, positive = false } = functionComparison(selected, operators);
        const { type: subjectType = '', name: subjectName = '' } = subject;

        if (['Literal', 'ArrowFunctionExpression', 'FunctionExpression'].includes(expressionType)) return noTest;

        if (params.length !== 1 || parameterType !== 'Identifier') return { capability, unsupported: true };

        if (subjectType === 'Identifier' && parameterName === subjectName && (selected === expression || positive)) return { capability, positive };

        if (subject || expressionType === 'UnaryExpression') return noTest;

        return { capability, unsupported: true };
    };

    const testFor = node => tests.get(node) || put(tests, node, acquireTest(node));

    return { subjectFor, testFor, subjects, count: new Set(bindings.map(binding => subjects.get(binding)).filter(Boolean)).size };
};
