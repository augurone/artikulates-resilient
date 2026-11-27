import { append, empty, freezeItems, put, retain, takeLast } from './collections.js';
import { work } from './observation.js';

// Each immutable contribution owns either local cases or links to source
// contributions. Aliases share the same contribution; joins never flatten it.
const presences = new WeakMap();
const presenceBits = new Map([['absent', 1], ['present', 2], ['unknown', 4]]);

export const fieldEvidence = ({ cases = [], reason = '' } = {}) => Object.freeze({
    cases: freezeItems(cases.map(item => Object.freeze({ ...item }))), inputs: empty,
    retired: cases.every(({ state = '', projection = '' } = {}) => state !== 'present' || projection === 'family'),
    presenceMask: cases.reduce((mask, { state = '' } = {}) => mask | presenceBits.get(state), 0),
    state: cases.some(({ state = '' } = {}) => state === 'unknown') ? 'unknown' : 'known', reason
});

export const joinFields = (data) => {
    const inputs = [...new Set(data)];

    if (inputs.length === 1) return inputs.at(0);

    return Object.freeze({
        cases: empty, inputs: freezeItems(inputs),
        retired: inputs.every(({ retired = false } = {}) => retired),
        presenceMask: inputs.reduce((mask, { presenceMask = 0 } = {}) => mask | presenceMask, 0),
        state: inputs.some(({ state = '' } = {}) => state === 'unknown') ? 'unknown' : 'known', reason: ''
    });
};

// Only unpublished graph nodes allocated by these field builders may be filled.
// All edges are installed before a graph is exposed through a completed fact.
export const completeFields = (target, data) => {
    // eslint-disable-next-line resilient/prefer-safe-transformations -- Fill this builder-owned unpublished node before freezing its shared graph edges.
    Object.assign(target, data);

    return Object.freeze(target);
};

// Project each immutable contribution once, retaining its immediate links.
// Scratch nodes are published to the weak cache only after the entire graph is
// complete, including cycles. No source retains consumer-specific selections.
export const projectFields = ({ data = {}, cache = new WeakMap(), select, mask = 7, retire = false, open = false, observation = {} } = {}) => {
    if (typeof select !== 'function') throw new TypeError('Expected a field-case projection');

    const reusable = (source) => {
        const { retired = false, presenceMask = 0 } = source;

        return (retire && retired) || (open && !(presenceMask & 1)) ? source : cache.get(source);
    };

    if (reusable(data)) return reusable(data);

    const pending = [data];
    const allocated = new Map();

    // eslint-disable-next-line resilient/prefer-prototype-methods -- This private graph frontier allocates one projection node per contribution without recursion or path expansion.
    while (pending.length) {
        const source = takeLast(pending);

        if (reusable(source) || allocated.has(source)) continue;

        put(allocated, source, {});
        work(observation, 'field-projection');
        const { inputs = [] } = source;

        inputs.forEach(input => append(pending, input));
    }

    const read = source => reusable(source) || allocated.get(source);

    allocated.forEach((target, { cases = [], inputs = [], presenceMask = 0, retired = false } = {}) => {
        const selected = fieldEvidence({ cases: cases.filter(({ state = '' } = {}) => presenceBits.get(state) & mask).map(select) });
        const filtered = presenceMask & mask;
        const presence = open && (filtered & 1) ? (filtered & 6) | 4 : filtered;

        completeFields(target, { ...selected, inputs: freezeItems(inputs.map(read)), retired: retire || retired,
            presenceMask: presence, state: presence & 4 ? 'unknown' : 'known' });
    });
    allocated.forEach((target, source) => {
        put(cache, source, target);
        put(cache, target, target);
    });

    return read(data);
};

// The caller owns this visit set and the meaning of each case. No flattened
// selection is retained by a contribution or source fact.
export const visitFields = ({ data = {}, visited = new Set(), observation = {} } = {}, consume) => {
    if (typeof consume !== 'function') throw new TypeError('Expected a field-case visitor');

    const pending = [data];

    // eslint-disable-next-line resilient/prefer-prototype-methods -- Field joins share a graph; this private frontier avoids recursive stack growth and repeated ancestor flattening.
    while (pending.length) {
        const contribution = takeLast(pending);

        if (visited.has(contribution)) continue;

        retain(visited, contribution);
        work(observation, 'field-contribution');

        const { cases = [], inputs = [] } = contribution;

        cases.forEach((item) => {
            consume(item);
            work(observation, 'field-case');
        });
        inputs.toReversed().forEach(input => append(pending, input));
    }
};

// Weakly intern the array itself: aliases preserve its identity while a caller
// holds it, but live source roots do not retain released prefix projections.
export const selectPresence = (data) => {
    const reference = presences.get(data);
    const prior = reference && reference.deref();

    if (prior) return prior;

    const selected = new Map();

    visitFields({ data }, ({ state = '', owner = false } = {}) => put(selected, state === 'present' ? owner : state, state));

    const presence = freezeItems([...selected.values()]);

    put(presences, data, new WeakRef(presence));

    return presence;
};
