import { put } from '../collections.js';
import { traverse } from '../traversal.js';

// Parent edges own control, receiver, and target roles for all consumers.
export const acquireUseContexts = ({ parents = new WeakMap(), operators = new WeakMap() } = {}) => {
    const contexts = new WeakMap();
    const contextFor = (node) => {
        traverse(node, { enter: current => contexts.has(current) ? [] : [parents.get(current)].filter(Boolean), leave: (current) => {
            if (contexts.has(current)) return;

            const parent = parents.get(current) ?? {};
            const { type = '', test = false, callee = false, tag = false, left = false, argument = false, object = false, value = false, optional = false, computed = false } = parent;
            const { control: priorControl = false, receiver: priorReceiver = false, mutation: priorMutation = false,
                guarded: priorGuarded = false, repeated: priorRepeated = false, ordered: priorOrdered = false,
                region: priorRegion = false, valueUse = { node: parent, value: current } } = contexts.get(parent) ?? {};
            const boundary = ['Program', 'ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(type);
            const unsupported = ['WhileStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement', 'WithStatement', 'ClassBody',
                'NewExpression', 'TemplateLiteral', 'TaggedTemplateExpression', 'AssignmentExpression', 'AssignmentPattern', 'SequenceExpression',
                'ChainExpression', 'CatchClause', 'SpreadElement', 'UpdateExpression'].includes(type) || optional || (type === 'MemberExpression' && computed);
            const expression = type.endsWith('Expression') || type === 'TemplateLiteral';
            const transparent = type === 'ChainExpression';
            const control = ['IfStatement', 'WhileStatement', 'DoWhileStatement', 'ForStatement', 'ConditionalExpression'].includes(type) && test === current;
            const receiver = (['CallExpression', 'NewExpression'].includes(type) && callee === current) || (type === 'TaggedTemplateExpression' && tag === current);
            const mutation = (['AssignmentExpression', 'ForOfStatement', 'ForInStatement'].includes(type) && left === current) || (type === 'UpdateExpression' && argument === current) ||
                (type === 'UnaryExpression' && operators.get(parent) === 'delete' && argument === current);
            const target = (type === 'Property' && value === current) || (type === 'AssignmentPattern' && left === current) ||
                (type === 'RestElement' && argument === current) || ['ArrayPattern', 'ObjectPattern'].includes(type);

            put(contexts, current, {
                region: boundary || ['WhileStatement', 'DoWhileStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement'].includes(type)
                    ? false : priorRegion || (type === 'IfStatement' ? parent : false),
                // A selected branch forwards its value to the enclosing use.
                // Selection itself neither stores nor escapes that value.
                valueUse: (type === 'ConditionalExpression' && test !== current) || type === 'LogicalExpression'
                    ? valueUse : { node: parent, value: current },
                ordered: boundary || (!unsupported && priorOrdered),
                repeated: !['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'].includes(type) &&
                    (priorRepeated || ['WhileStatement', 'DoWhileStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement'].includes(type)),
                guarded: !['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'].includes(type) &&
                    (priorGuarded || ['IfStatement', 'ConditionalExpression', 'LogicalExpression'].includes(type)),
                control: control || (expression && priorControl),
                receiver: receiver || (((type === 'MemberExpression' && object === current) || transparent) && priorReceiver),
                mutation: mutation || (((type === 'MemberExpression' && object === current) || transparent || target) && priorMutation)
            });
        } });

        return contexts.get(node) ?? {};
    };

    return contextFor;
};
