import { append, put, retain } from '../collections.js';
import { traverse } from '../traversal.js';
import { notify } from './work.js';

const empty = Object.freeze({ target: false, ambiguous: false, unresolved: false });
const merge = ({ target: first = false, ambiguous: a = false, unresolved: u = false } = {},
    { target: second = false, ambiguous: b = false, unresolved: v = false } = {}) => ({
    target: first || second, ambiguous: a || b || Boolean(first && second && first !== second), unresolved: u || v
});

// Resolution is reachability, not execution. Each completed component shares
// one bounded summary: no binding, one binding, or ambiguity, plus uncertainty.
// The cache belongs to this acquired module closure. Both graph passes are
// iterative and O(V + E); only completed summaries survive a request.
export const createExportResolver = ({ keyFor, definition, cache = new Map(), observation = {} } = {}) => {
    if (typeof keyFor !== 'function' || typeof definition !== 'function') throw new TypeError('Expected export identity and route acquisition');

    const visit = () => notify(observation, 'export-resolution');

    return (requested) => {
        const requestedKey = keyFor(requested);

        visit();

        if (cache.has(requestedKey)) return cache.get(requestedKey);

        const nodes = new Map();
        const expanded = new WeakSet();
        const finished = [];

        traverse({ entry: requested }, { enter: (frame) => {
            const { entry = {} } = frame;
            const key = keyFor(entry);

            visit();

            if (cache.has(key) || nodes.has(key)) return [];

            retain(expanded, frame);
            const routes = definition(entry);
            const inputs = routes.flatMap(({ entry = false } = {}) => entry ? [entry] : []);

            put(nodes, key, { inputs: inputs.map(keyFor), summary: routes.reduce(merge, empty) });

            return inputs.map(entry => ({ entry }));
        }, leave: (frame) => {
            if (!expanded.has(frame)) return;

            const { entry = {} } = frame;

            append(finished, keyFor(entry));
        } });
        const parents = new Map();

        nodes.forEach(({ inputs = [] } = {}, key) => inputs.forEach((input) => {
            visit();

            if (nodes.has(input)) append(parents.get(input) || put(parents, input, []), key);
        }));
        const componentOf = new Map();
        const components = [];

        finished.toReversed().forEach((key) => {
            if (componentOf.has(key)) return;

            const members = [];

            traverse(key, { enter: (current) => {
                visit();

                if (componentOf.has(current)) return [];

                put(componentOf, current, members);
                append(members, current);

                return parents.get(current) || [];
            } });
            append(components, members);
        });
        // Reverse component order completes dependencies first. A back edge
        // contributes only through its entire component, never a partial answer.
        components.toReversed().forEach((members) => {
            const result = members.reduce((result, key) => {
                const { summary = empty, inputs = [] } = nodes.get(key);

                return inputs.reduce((result, input) => {
                    visit();

                    return componentOf.get(input) === members ? result : merge(result, cache.get(input));
                }, merge(result, summary));
            }, empty);
            const completed = Object.freeze(result);

            members.forEach((key) => {
                visit();
                put(cache, key, completed);
            });
        });

        return cache.get(requestedKey);
    };
};
