import { traverse } from '../../traversal.js';

// Follow values retained by the assignment, not discarded operands, keys,
// callees or deferred function bodies. Logical selection can consume absence.
const assignedChildren = ({ node = {}, selected = true } = {}) => {
    const { type = '', operator = '', consequent = {}, alternate = {}, left = {}, right = {}, expressions = [], properties = [], elements = [], value = {}, argument = {} } = node ?? {};
    const entry = node => ({ node, selected });

    if (type === 'ConditionalExpression') return [consequent, alternate].map(entry);

    if (type === 'LogicalExpression') return [{ node: left, selected: selected && operator === '&&' }, entry(right)];

    if (type === 'AssignmentExpression') return ['=', '&&=', '||=', '??='].includes(operator) ? [entry(right)] : [];

    if (type === 'SequenceExpression') return expressions.slice(-1).map(entry);

    if (type === 'ObjectExpression') return properties.map(node => ({ node, selected: true }));

    if (type === 'ArrayExpression') return elements.filter(Boolean).map(node => ({ node, selected: true }));

    if (type === 'SpreadElement') return [{ node: argument, selected: false }];

    return type === 'Property' ? [{ node: value, selected: true }] : [];
};

// One pair of visited sets bounds nested container/assignment listeners to
// two visits per source node, preserving whether selection consumes absence.
export const createAssignmentValueListeners = ({ report, isValue, messageId = '' } = {}) => {
    if (typeof report !== 'function' || typeof isValue !== 'function') throw new TypeError('Expected assignment value recognition and reporting');

    const reported = new WeakSet();
    const visited = [new WeakSet(), new WeakSet()];
    const inspect = (node) => {
        traverse({ node }, { enter: (entry = {}) => {
            const { node = {}, selected = true } = entry;

            if (!node || typeof node !== 'object') return [];

            const seen = visited.at(Number(selected));

            if (seen.has(node)) return [];

            // eslint-disable-next-line resilient/prefer-safe-transformations -- These private source-node sets deduplicate nested listeners without mutating syntax or caller state.
            seen.add(node);

            if (!selected || !isValue(node)) return assignedChildren(entry);

            if (reported.has(node)) return [];

            report({ node, messageId });
            // eslint-disable-next-line resilient/prefer-safe-transformations -- Each explicit source value has one diagnostic even when assignment and container listeners overlap.
            reported.add(node);

            return [];
        } });
    };

    return {
        VariableDeclarator({ init = {} } = {}) { inspect(init); },
        AssignmentExpression({ operator = '', right = {} } = {}) {
            if (['=', '&&=', '||=', '??='].includes(operator)) inspect(right);
        },
        AssignmentPattern({ right = {} } = {}) { inspect(right); },
        ObjectExpression: inspect,
        ArrayExpression: inspect
    };
};
