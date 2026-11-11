import { append, put, retain } from '../collections.js';
import { sourcePropertyName as propertyName } from '../estree-properties.js';
import { traverse } from '../traversal.js';
import { acquireInitializers } from './initializers.js';
import { objectPrototypeMembers } from './native-members.js';

// Flat object entry uses the shared ordered binder. Only own static fields
// and scalar or call-valued defaults are admitted; nested protocols stay opaque.
export const orderedObjectParameter = (parameter = {}, inert = new WeakMap()) => {
    const { type = '', left = parameter, right = false } = parameter;
    const { type: kind = '', properties = [] } = left;
    const { type: root = '', optional = false } = right ? right : {};
    const supportedRoot = !right || (root === 'CallExpression' && !optional) || (root === 'ObjectExpression' && inert.get(right));

    return ['ObjectPattern', 'AssignmentPattern'].includes(type) && kind === 'ObjectPattern' && supportedRoot && !!properties.length &&
        properties.every((property = {}) => {
            const { type = '', computed = false, value = {} } = property;
            const { known = false, name = '' } = propertyName(property);
            const { type: binding = '', left: { type: target = '' } = {}, right = {} } = value;
            const { type: initial = '', optional = false } = right;
            const scalar = inert.get(right) && !['ArrayExpression', 'ObjectExpression', 'FunctionExpression', 'ArrowFunctionExpression'].includes(initial);
            const lazy = initial === 'CallExpression' && !optional;

            return type === 'Property' && (computed || known) && (!known || !objectPrototypeMembers.has(name)) &&
                (binding === 'Identifier' || (binding === 'AssignmentPattern' && target === 'Identifier' && (scalar || lazy)));
        });
};

// Selection prefixes belong to the source pattern, not a consumer's spelling or
// path. Acquisition scratch may reference syntax; compiled templates never do.
export const acquirePatterns = ({ bindings = [], destructurings = [], parents = new WeakMap(), identities = new WeakMap(), initializerFacts = new WeakMap(), functionEntries = [] } = {}) => {
    const ordered = new WeakSet(functionEntries.flatMap(({ entryParameters = [] } = {}) => entryParameters));
    const selections = new WeakMap();
    const roots = new WeakMap();
    const defaults = [];
    const unsupported = new WeakSet();
    const computedPatterns = new WeakSet();
    const positions = new WeakMap();
    const positionFor = (array, node, pattern) => {
        if (positions.has(array)) return positions.get(array).get(node);

        const { elements = [] } = array;
        const { type = '' } = pattern;
        const root = array === pattern || (type === 'AssignmentPattern' && parents.get(array) === pattern);
        const flat = elements.filter(Boolean).every(({ type = '', left: { type: target = '' } = {} } = {}) => (
            type === 'Identifier' || (type === 'AssignmentPattern' && target === 'Identifier')
        ));

        if (!root || !flat) retain(unsupported, pattern);

        return put(positions, array, new Map(elements.flatMap((element, index) => element ? [[element, index]] : []))).get(node);
    };

    bindings.forEach(({ pattern = {}, init = false, parameterSource = {}, parameterPattern = false, declaration: { destructured = false } = {} } = {}) => {
        if (!destructured || roots.has(pattern)) return;

        put(roots, pattern, { patternValue: 'root', node: pattern, init, parameter: parameterPattern ? parameterSource : false });
    });
    destructurings.forEach(({ node = {}, pattern = {} } = {}) => {
        if (!roots.has(pattern)) put(roots, pattern, { patternValue: 'root', node: pattern, init: node, parameter: false });
    });
    const selectionFor = (node, pattern) => {
        traverse(node, { enter: current => selections.has(current) || roots.has(current) ? [] : [parents.get(current)].filter(Boolean), leave: (current = {}) => {
            if (selections.has(current)) return;

            if (roots.has(current)) {
                put(selections, current, roots.get(current));

                return;
            }

            const parent = parents.get(current) ?? {};
            const target = selections.get(parent);
            const { type = '', right = false, computed = false, key = {} } = parent;

            if (type === 'Property' && computed) retain(computedPatterns, pattern);

            const { known = false, name = '' } = propertyName(parent);
            const positional = type === 'ArrayPattern';
            const position = positional ? positionFor(parent, current, pattern) : -1;
            const { type: container = '', properties = [] } = parents.get(parent) ?? {};
            const rest = type === 'RestElement' && container === 'ObjectPattern';
            const excluded = rest ? properties.filter(({ type = '' } = {}) => type === 'Property').map(property => propertyName(property)) : [];
            const supported = positional || rest ||
                type === 'AssignmentPattern' || (type === 'Property' && (computed || known)) || type === 'ObjectPattern';

            if (!supported) retain(unsupported, pattern);

            if (right) append(defaults, { node: right, pattern });

            const { parameter = false } = roots.get(parent) ?? {};
            const { parameter: formal = false } = roots.get(pattern) ?? {};
            const selection = type === 'AssignmentPattern' ? 'default' : 'field';

            put(selections, current, type === 'ObjectPattern' || (parameter && !positional) ? target : {
                patternValue: rest ? 'rest' : selection,
                node: current, excluded: Object.freeze(excluded.map(({ name = '' } = {}) => name)),
                excludedKeys: rest ? properties.filter(({ type = '' } = {}) => type === 'Property').map((property) => {
                    const { computed = false, key = {} } = property;
                    const { known = false } = propertyName(property);

                    return computed && !known ? key : false;
                }) : [],
                propertyKey: type === 'Property' && computed && !known ? key : false,
                target, name, position, fallback: right, formal: Boolean(formal)
            });
        } });

        return selections.get(node);
    };

    const forBinding = ({ pattern = {}, declaration: { node = {}, destructured = false } = {} } = {}) => (
        destructured && !unsupported.has(pattern) ? selectionFor(node, pattern) : false
    );

    bindings.forEach(forBinding);
    destructurings.forEach(({ pattern = {}, entries = [] } = {}) => entries.forEach(({ node = {} } = {}) => selectionFor(node, pattern)));
    const inert = acquireInitializers({ initializers: defaults, identities, inert: initializerFacts });

    defaults.forEach(({ node = {}, pattern = {} } = {}) => {
        if (!inert.get(node) && !ordered.has(pattern)) retain(unsupported, pattern);
    });

    const inertArray = (pattern = {}) => {
        const { type = '' } = pattern;

        if (type !== 'ArrayPattern') return false;

        // Empty patterns and elisions still acquire an iterator, even when no
        // binding demanded a position during selection acquisition.
        positionFor(pattern, pattern, pattern);

        return !unsupported.has(pattern);
    };
    const initializationFor = (node = {}) => {
        const { type = '', left = node, right = false } = node;
        const pattern = type === 'AssignmentPattern' ? left : node;
        const { type: kind = '', properties = [], elements = [] } = pattern;
        const simple = ({ type = '', left = {}, right = false, argument = {} } = {}) => {
            const { type: binding = '' } = type === 'RestElement' ? argument : left;

            return type === 'Identifier' || (type === 'RestElement' && binding === 'Identifier') ||
                (type === 'AssignmentPattern' && binding === 'Identifier' && inert.get(right));
        };
        const object = kind === 'ObjectPattern' && properties.every((entry = {}) => {
            const { type = '', computed = false, value = {} } = entry;

            return type === 'RestElement' ? simple(entry) : !computed && simple(value);
        });
        const array = kind === 'ArrayPattern' && elements.every(entry => !entry || simple(entry));
        const { type: fallback = '' } = right ? right : {};

        return Object.freeze({ ordered: ordered.has(node), inert: (!right || Boolean(inert.get(right))) && (object || array || simple(pattern)), kind,
            fallback: right && inert.get(right) ? fallback : '' });
    };

    return { forBinding, inertArray, initializationFor, ordered: node => ordered.has(node), rootFor: node => roots.get(node),
        effectsFor: (pattern) => {
            if (!computedPatterns.has(pattern) || unsupported.has(pattern)) return [];

            const entries = [];

            traverse(pattern, { enter: (node = {}) => {
                const { type = '', left = node, properties = [], elements = [], value = {}, argument = {} } = node;

                if (type === 'Property' || type === 'RestElement') {
                    const selected = type === 'Property' ? value : argument;
                    const { type: form = '', left = selected } = selected;
                    const { type: binding = '' } = left;

                    append(entries, { value: selectionFor(form === 'AssignmentPattern' ? left : selected, pattern), object: binding === 'ObjectPattern' });
                }

                if (type === 'ObjectPattern') return properties;

                if (type === 'ArrayPattern') return elements.filter(Boolean);

                if (type === 'AssignmentPattern') return [left];

                return type === 'Property' ? [value] : [];
            } });

            return entries;
        },
        entriesFor: (node) => {
            const { left = node } = node;
            const { properties = [] } = left;

            return properties.map(({ value = {} } = {}) => {
                const { type = '', left = value } = value;

                return selectionFor(type === 'AssignmentPattern' ? left : value, node);
            });
        }, forNode: (node, pattern) => unsupported.has(pattern) ? false : selections.get(node) };
};

// A flat formal's acquired root and slot use the same selection templates as
// ordinary patterns. Eligibility is established by its syntax producer; neither
// the tuple annotation nor this constructor proves an iterable or a slot value.
export const formalSlot = ({ target = {}, slot = 0, ...common } = {}) => ({
    ...common, kind: 'selection', target, name: '', slot, formal: true, fallback: false
});
