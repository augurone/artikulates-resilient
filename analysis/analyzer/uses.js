import { append, put, retain } from '../collections.js';
import { traverse } from '../traversal.js';
import { locationOf } from './locations.js';

const collectionMethods = new Set(['map', 'filter', 'some', 'find', 'forEach', 'reduce', 'sort', 'toSorted']);

// Use roles are acquired from the existing lexical index. Rules do not rescan
// bodies, and a forwarded argument links to a formal rather than redefining it.
export const acquireUses = ({ index = {}, capabilities = {}, callables = new Map() } = {}) => {
    const { references = [], identities = new WeakMap(), parents = new WeakMap(), callableResolutions = new WeakMap(), functionEntries = [], operators = new WeakMap() } = index;
    const byCall = new WeakMap();
    const bySubject = new Map();
    const parameters = new WeakMap();
    const roots = new WeakMap();
    const containers = new WeakMap();
    const observedCalls = new Set();
    const testContexts = new WeakMap();
    const resultParent = (node) => {
        const parent = parents.get(node) ?? {};
        const { type = '', test = false } = parent;

        return type === 'LogicalExpression' || (type === 'ConditionalExpression' && test !== node) ? [parent] : [];
    };
    const testedOrDiscarded = (node) => {
        traverse(node, { enter: current => testContexts.has(current) ? [] : resultParent(current), leave: (current) => {
            if (testContexts.has(current)) return;

            const parent = parents.get(current) ?? {};
            const { type = '', test = false } = parent;
            const tested = ['IfStatement', 'ConditionalExpression'].includes(type) && test === current;
            const discarded = type === 'ExpressionStatement' || (type === 'UnaryExpression' && ['!', 'typeof', 'void'].includes(operators.get(parent)));

            put(testContexts, current, tested || discarded || (Boolean(resultParent(current).length) && testContexts.get(parent)));
        } });

        return testContexts.get(node);
    };
    const boundary = ({ type = '' } = {}) => type.endsWith('Statement') || ['VariableDeclarator', 'ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(type);
    const rootFor = (node) => {
        traverse(node, { enter: current => roots.has(current) || boundary(parents.get(current)) ? [] : [parents.get(current)].filter(Boolean), leave: (current) => {
            if (!roots.has(current)) put(roots, current, roots.get(parents.get(current)) || current);
        } });

        return roots.get(node);
    };
    // Both required acquisition functions are checked before capture; defaults would manufacture evidence.
    const { subjectFor, testFor } = capabilities;

    if (typeof subjectFor !== 'function' || typeof testFor !== 'function') throw new TypeError('Expected lexical capability acquisition');

    functionEntries.forEach(({ node = {}, params = [] } = {}) => {
        put(parameters, node, params.every(({ type = '' } = {}) => type === 'Identifier') ? params.map(subjectFor) : []);
    });
    const retainUse = (capability, node, description) => {
        const use = Object.freeze({ capability, node, ...description });
        const uses = bySubject.get(capability) || put(bySubject, capability, []);

        append(uses, use);

        if (!node) return;

        const root = rootFor(node);

        if (root !== node && !observedCalls.has(node)) {
            const entries = containers.get(root) || put(containers, root, []);

            append(entries, node);
            retain(observedCalls, node);
        }

        const calls = byCall.get(node) || put(byCall, node, []);

        append(calls, use);
    };
    references.forEach(({ node = {}, parent = {}, execution = false } = {}) => {
        const capability = subjectFor(node);

        if (!capability) return;

        const binding = identities.get(node);
        const { declaration: { node: declared = {} } = {} } = binding ?? {};
        const { type = '', computed = false, property = false, argument = false,
            callee = false, arguments: args = [], init = false, id = false, test = false, left = false } = parent;

        if (node === declared) return;

        if (['ImportSpecifier', 'ImportDefaultSpecifier', 'ExportSpecifier'].includes(type)) return;

        const operator = type === 'UnaryExpression' && argument === node ? operators.get(parent) : '';

        const predicate = operator === 'typeof' ? parents.get(parent) : parent;
        const guard = testFor(predicate);
        const { capability: guarded = false, unsupported: unresolved = false } = guard;

        if (guarded === capability && !unresolved) {
            retainUse(capability, false, { kind: 'guard', execution, guard, location: locationOf(predicate) });

            return;
        }

        if (['typeof', '!', 'void'].includes(operator)) return;

        if ((type === 'IfStatement' || type === 'ConditionalExpression') && test === node) return;

        if (type === 'LogicalExpression' && left === node && testedOrDiscarded(parent)) return;

        if (type === 'VariableDeclarator' && init === node && subjectFor(id) === capability) return;

        if (type === 'CallExpression' && callee === node) {
            retainUse(capability, parent, { kind: 'invocation', execution });

            return;
        }

        const invocation = type === 'MemberExpression' && !computed ? parents.get(parent) : {};
        const { type: useType = '', callee: selected = false } = invocation ?? {};
        const { name: method = '' } = property ? property : {};

        if (useType === 'CallExpression' && selected === parent && ['call', 'apply'].includes(method)) {
            retainUse(capability, invocation, { kind: 'invocation', execution });

            return;
        }

        if (type !== 'CallExpression') {
            retainUse(capability, false, { kind: 'escape', execution });

            return;
        }

        const { type: calleeType = '', computed: dynamic = false, property: { name = '' } = {} } = callee ?? {};
        const position = args.indexOf(node);
        const { execution: declarationExecution = false } = capability;
        const collection = calleeType === 'MemberExpression' && !dynamic && collectionMethods.has(name) && position === 0 &&
            (['sort', 'toSorted'].includes(name) ? args.length === 1 : execution === declarationExecution);

        if (collection) {
            retainUse(capability, parent, { kind: 'collection', execution, method: name });

            return;
        }

        const consumer = callables.get(callableResolutions.get(callee));
        const formals = parameters.get(consumer) || [];
        const target = args.some(({ type: kind = '' } = {}) => kind === 'SpreadElement') ? false : formals.at(position) || false;

        retainUse(capability, parent, { kind: 'forward', execution, target });
    });

    return { bySubject, forCall: node => byCall.get(node) || [], forContainer: node => containers.get(node) || [] };
};
