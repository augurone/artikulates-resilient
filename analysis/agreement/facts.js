import { append, put } from './collections.js';
import { solve } from './dependencies.js';
import { visitFields } from './field-evidence.js';
import { familyFacet, factData, fresh } from './knowledge.js';
import { deliver, work } from './observation.js';

// Read producer evidence without introducing a consumer requirement or judgment.
// As with requests, observers run only after the fact has been established.
export const readFamily = ({ owner = false, onWork } = {}) => {
    const observation = typeof onWork === 'function' ? { events: [] } : {};
    const fact = solve({ owner, facet: familyFacet, observation });

    work(observation, 'family-read');
    const { events = [] } = observation;

    events.forEach(event => deliver(onWork, event));

    if (!fresh(fact)) throw new Error('Source changed during family read');

    return fact;
};

const fieldResults = new WeakMap();

// Presence and selected value identities share the same producer fact used by
// field obligations. This read supplies evidence; it imposes no requirement.
export const readField = ({ owner = false, name = false, onWork } = {}) => {
    if (typeof name !== 'string') throw new TypeError('Expected a field name');

    const observation = typeof onWork === 'function' ? { events: [] } : {};
    const fact = solve({ owner, facet: { kind: 'field', key: `field:${name}`, name }, observation });
    const retained = fieldResults.get(fact);
    const previous = retained && retained.deref();
    const cases = [];

    if (!previous) visitFields({ data: factData(fact), observation }, entry => append(cases, Object.freeze({ ...entry })));

    const result = previous || Object.freeze({ fact, cases: Object.freeze(cases) });

    if (!previous) put(fieldResults, fact, new WeakRef(result));

    work(observation, 'field-read');
    const { events = [] } = observation;

    events.forEach(event => deliver(onWork, event));

    if (!fresh(fact)) throw new Error('Source changed during field read');

    return result;
};
