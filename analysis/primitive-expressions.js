// Inert spellings of the same primitive share one source representation.
// This does not evaluate identifiers, user coercions or arbitrary expressions.
export const primitiveLiteral = (node = {}, operator = '') => {
    const { type = '', argument = {}, expressions = [], quasis = [] } = node;

    if (type === 'Literal') return node;

    const { type: operand = '', value = false } = argument;

    if (type === 'UnaryExpression' && ['+', '-'].includes(operator) && operand === 'Literal' && typeof value === 'number') {
        return { type: 'Literal', value: operator === '-' ? -value : value };
    }

    if (type !== 'TemplateLiteral' || expressions.length || quasis.length !== 1) return node;

    const [{ value: { cooked = false } = {} } = {}] = quasis;

    return typeof cooked === 'string' ? { type: 'Literal', value: cooked } : node;
};
