import { append, empty, freezeItems, put, retain, takeLast } from './collections.js';
import { work } from './observation.js';

// Each immutable contribution owns either local cases or links to earlier
// contributions. Aliases share the same contribution; joins never flatten it.
const presences = new WeakMap();

export const fieldEvidence = ({ cases = [], reason = '' } = {}) => Object.freeze({
    cases: freezeItems(cases.map(item => Object.freeze({ ...item }))), inputs: empty,
    state: cases.some(({ state = '' } = {}) => state === 'unknown') ? 'unknown' : 'known', reason
});

export const joinFields = (data) => {
    const inputs = [...new Set(data)];

    if (inputs.length === 1) return inputs.at(0);

    return Object.freeze({
        cases: empty, inputs: freezeItems(inputs),
        state: inputs.some(({ state = '' } = {}) => state === 'unknown') ? 'unknown' : 'known', reason: ''
    });
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
