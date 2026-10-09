import { append, put, retain } from '../collections.js';
import { propertyName } from '../estree-properties.js';
import { traverse } from '../traversal.js';
import { acquireInitializers } from './initializers.js';

// Selection prefixes belong to the source pattern, not a consumer's spelling or
// path. Acquisition scratch may reference syntax; compiled templates never do.
export const acquirePatterns = ({ bindings = [], destructurings = [], parents = new WeakMap(), identities = new WeakMap(), initializerFacts = new WeakMap() } = {}) => {
    const selections = new WeakMap();
    const roots = new WeakMap();
    const defaults = [];
    const unsupported = new WeakSet();
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
            const { type = '', right = false, computed = false } = parent;
            const { known = false, name = '' } = propertyName(parent);
            const positional = type === 'ArrayPattern';
            const position = positional ? positionFor(parent, current, pattern) : -1;
            const supported = positional || type === 'AssignmentPattern' || (type === 'Property' && !computed && known) || type === 'ObjectPattern';

            if (!supported) retain(unsupported, pattern);

            if (right) append(defaults, { node: right, pattern });

            const { parameter = false } = roots.get(parent) ?? {};
            const { parameter: formal = false } = roots.get(pattern) ?? {};

            put(selections, current, type === 'ObjectPattern' || (parameter && !positional) ? target : {
                patternValue: type === 'AssignmentPattern' ? 'default' : 'field', node: current, target, name, position, fallback: right, formal: Boolean(formal)
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
        if (!inert.get(node)) retain(unsupported, pattern);
    });

    const inertArray = (pattern = {}) => {
        const { type = '' } = pattern;

        if (type !== 'ArrayPattern') return false;

        // Empty patterns and elisions still acquire an iterator, even when no
        // binding demanded a position during selection acquisition.
        positionFor(pattern, pattern, pattern);

        return !unsupported.has(pattern);
    };

    return { forBinding, inertArray, forNode: (node, pattern) => unsupported.has(pattern) ? false : selections.get(node) };
};

// A flat formal's acquired root and slot use the same selection templates as
// ordinary patterns. Eligibility is established by its syntax producer; neither
// the tuple annotation nor this constructor proves an iterable or a slot value.
export const formalSlot = ({ target = {}, slot = 0, ...common } = {}) => ({
    ...common, kind: 'selection', target, name: '', slot, formal: true, fallback: false
});
