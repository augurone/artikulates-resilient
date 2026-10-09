import { append, put } from './collections.js';
import { propertyName } from './estree-properties.js';
import { traverse } from './traversal.js';

const noChain = Object.freeze({ then: false, finally: false, catch: false });
const chainEdges = new Map([
    ['CallExpression', 'callee'], ['TaggedTemplateExpression', 'tag'],
    ['MemberExpression', 'object'], ['ChainExpression', 'expression']
]);
const childFor = (node = {}) => {
    const { type = '' } = node;
    const field = chainEdges.get(type);

    return field ? Reflect.get(node, field) || {} : {};
};
const memberName = (node = {}) => {
    const { type = '' } = node;

    const { computed = false, property = {} } = type === 'MemberExpression' ? node : {};
    const { name = '' } = propertyName({ computed, key: property });

    return name;
};
const invokedBy = (node = {}) => {
    const { type = '' } = node;

    return ['CallExpression', 'TaggedTemplateExpression'].includes(type) ? childFor(node) : {};
};
const memberFor = (node) => {
    const invoked = invokedBy(node);
    const { type = '' } = invoked;

    return type === 'ChainExpression' ? childFor(invoked) : invoked;
};
export const unhandledChain = ({ then = false, finally: final = false, catch: caught = false } = {}) => (then || final) && !caught;

// One syntax owner serves parser acquisition and the ESLint host. Each caller
// supplies its parent edges; no receiver family or rejection behavior is inferred.
export const createPromiseChains = (parentFor) => {
    if (typeof parentFor !== 'function') throw new TypeError('Expected parent-edge lookup');

    const summaries = new WeakMap();
    const outer = new WeakMap();
    const innerEdges = (node = {}) => {
        const { type = '' } = node;

        if (type === 'ChainExpression') return [childFor(node)];

        const member = memberFor(node);
        const { type: memberType = '' } = member;

        return memberType === 'MemberExpression' ? [childFor(member)] : [];
    };
    const chainFor = (node) => {
        traverse(node, { enter: current => summaries.has(current) ? [] : innerEdges(current), leave: (current = {}) => {
            if (summaries.has(current)) return;

            const { then: priorThen = false, finally: priorFinally = false, catch: priorCatch = false } = summaries.get(innerEdges(current).at(0)) ?? noChain;
            const name = memberName(memberFor(current));

            put(summaries, current, Object.freeze({ then: priorThen || name === 'then', finally: priorFinally || name === 'finally', catch: priorCatch || name === 'catch' }));
        } });

        return summaries.get(node);
    };
    const parentEdges = (node) => {
        const parent = parentFor(node) || {};

        return childFor(parent) === node ? [parent] : [];
    };
    const outerFor = (node) => {
        if (outer.has(node)) return outer.get(node);

        const path = [];

        traverse(node, { enter: (current) => {
            append(path, current);

            return outer.has(current) ? [] : parentEdges(current);
        } });
        const last = path.at(-1);
        const root = outer.get(last) || last;

        path.forEach(current => put(outer, current, root));

        return root;
    };
    const unhandled = (node) => {
        const root = outerFor(node);
        const { type = '' } = parentFor(root) ?? {};

        return type === 'ExpressionStatement' && unhandledChain(chainFor(root));
    };
    const calledThen = (node) => {
        const parent = parentFor(node) ?? {};
        const { type = '' } = parent;
        const wrapped = type === 'ChainExpression' && childFor(parent) === node;

        return memberName(node) === 'then' && invokedBy(wrapped ? parentFor(parent) : parent) === (wrapped ? parent : node);
    };

    return { chainFor, unhandled, calledThen };
};
