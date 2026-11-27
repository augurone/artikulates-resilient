import { append } from '../../../analysis/collections.js';
import { traverse } from '../../../analysis/traversal.js';
import { getChildren } from '../../utils/ast-traversal.js';

// Callable creation and formal syntax are compiler acquisition. Return values,
// invocation, callback protocols and completion belong to shared demand.
export const callableCreation = ({ typescript: { SyntaxKind: { ArrowFunction = -1, FunctionExpression = -1 } = {} } = {}, node: { kind = -2 } = {} } = {}) => (
    kind === ArrowFunction || kind === FunctionExpression
);

const isScopeReference = (node, { kind = -2, name = false, propertyName = false, label = false } = {}, shorthand = -1) => (
    kind === shorthand || (name !== node && propertyName !== node && label !== node)
);

// Computed names execute outside the nested callable; its parameters/body do
// not. Arrows retain the enclosing lexical scope, and type nodes are erased.
const scopeValues = ({ typescript = {}, node = {}, crossFunctions = false } = {}, read) => {
    const { SyntaxKind: { ArrowFunction = -1 } = {} } = typescript;
    const { parameters = [], body = false } = node;
    const found = [];

    [...parameters, ...(body ? [body] : [])].forEach(current => traverse({ current, parent: node }, { enter: ({ current = {}, parent = {} } = {}) => {
        const { kind = -2, name = false } = current;

        if (typescript.isTypeNode(current)) return [];

        if (!crossFunctions && kind !== ArrowFunction && typescript.isFunctionLike(current))
            return name && typescript.isComputedPropertyName(name) ? [{ current: name, parent: current }] : [];

        read(current, parent).forEach(value => append(found, value));

        return getChildren({ typescript, node: current }).map(child => ({ current: child, parent: current }));
    } }));

    return found;
};

export const getScopeReferences = ({ typescript = {}, node = {}, text = '', crossFunctions = false } = {}) => {
    const { SyntaxKind: { Identifier = -1, ShorthandPropertyAssignment = -1 } = {} } = typescript;

    return scopeValues({ typescript, node, crossFunctions }, (current = {}, parent = {}) => {
        const { kind = -2, text: name = '' } = current;

        return kind === Identifier && name === text && isScopeReference(current, parent, ShorthandPropertyAssignment) ? [current] : [];
    });
};

// Parameters include runtime initializers and the TypeScript this formal.
export const lexicalCapabilities = ({ typescript = {}, node = {} } = {}) => {
    const { SyntaxKind: { Identifier = -1, MetaProperty = -1, NewKeyword = -1, Parameter = -1,
        ShorthandPropertyAssignment = -1, ThisKeyword = -1 } = {} } = typescript;

    return new Set(scopeValues({ typescript, node }, (current = {}, parent = {}) => {
        const { kind = -2, keywordToken = -1, text = '', name: { kind: nameKind = -2, text: name = '' } = {} } = current;

        return [
            [kind === ThisKeyword || (kind === Parameter && nameKind === Identifier && name === 'this'), 'dynamic-this'],
            [kind === Identifier && text === 'arguments' && isScopeReference(current, parent, ShorthandPropertyAssignment), 'arguments'],
            [kind === MetaProperty && keywordToken === NewKeyword, 'new-target']
        ].filter(([present = false] = []) => present).map(([, capability = ''] = []) => capability);
    }));
};

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
