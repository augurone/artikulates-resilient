// Callable creation and formal syntax are compiler acquisition. Return values,
// invocation, callback protocols and completion belong to shared demand.
export const callableCreation = ({ typescript: { SyntaxKind: { ArrowFunction = -1, FunctionExpression = -1 } = {} } = {}, node: { kind = -2 } = {} } = {}) => (
    kind === ArrowFunction || kind === FunctionExpression
);

export const callableParameters = ({ typescript = {}, node = {} } = {}) => {
    const { SyntaxKind: { FunctionDeclaration = -1, ArrowFunction = -1, FunctionExpression = -1, Identifier = -1,
        ArrayBindingPattern = -1, OmittedExpression = -1, AsyncKeyword = -1 } = {} } = typescript;
    const { kind = -2, body = false, parameters = [], asteriskToken = false, modifiers = [] } = node;
    const supported = [FunctionDeclaration, ArrowFunction, FunctionExpression].includes(kind) && body && !asteriskToken &&
        !modifiers.some(({ kind = -1 } = {}) => kind === AsyncKeyword) && parameters.every(({ name = {}, initializer = false, dotDotDotToken = false } = {}) => {
        const { kind = -2, elements = [] } = name;

        if (initializer || dotDotDotToken) return false;

        return kind === Identifier || (kind === ArrayBindingPattern && elements.every(({ kind = -2, name: { kind: target = -2 } = {},
            initializer = false, dotDotDotToken = false } = {}) => kind === OmittedExpression || (target === Identifier && !initializer && !dotDotDotToken)));
    });

    return supported ? parameters : false;
};

// Requirements do not restrict the body and never initialize its values. The
// tuple query selects the first tuple formal, including a reducer item after
// its accumulator. Every formal keeps its own invocation position.
export const tupleConsumer = ({ typescript = {}, node = {}, identities = new WeakMap() } = {}) => {
    const parameters = callableParameters({ typescript, node });

    if (!parameters) return false;

    const { SyntaxKind: { ArrayBindingPattern = -1, TupleType = -1, NumberKeyword = -1, StringKeyword = -1,
        BooleanKeyword = -1, FunctionType = -1 } = {} } = typescript;
    const position = parameters.findIndex(({ name: { kind = -2 } = {} } = {}) => kind === ArrayBindingPattern);
    const parameter = parameters.at(position) ?? {};
    const { name: pattern = {}, type = {}, questionToken = false } = parameter;
    const { kind = -2, elements = [] } = pattern;
    const { kind: annotation = -2, elements: requirements = [] } = type;
    const families = new Map([[NumberKeyword, 'number'], [StringKeyword, 'string'], [BooleanKeyword, 'boolean'], [FunctionType, 'function']]);
    const slots = elements.map(({ name = {} } = {}, slot) => {
        const requirement = requirements.at(slot) ?? {};
        const { kind = -2 } = requirement;
        const binding = identities.get(name);
        const { ambiguous = false } = binding ?? {};

        return { slot, binding, requirement, family: families.get(kind) || '', supported: Boolean(binding) && !ambiguous && families.has(kind) };
    });

    return !questionToken && kind === ArrayBindingPattern && elements.length && annotation === TupleType && requirements.length === elements.length &&
        slots.every(({ supported = false } = {}) => supported) ? { parameter, position, pattern, slots } : false;
};
