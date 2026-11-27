import { readFamily, readField } from 'eslint-plugin-resilient/agreement';

import { put } from '../collections.js';
import { traverse } from '../traversal.js';
import { normalValue, valueInputs } from './values.js';
import { notify } from './work.js';

// Promise adoption projects the existing guarded value graph. It never executes
// a thenable or reconstructs an expression from syntax. Envelopes already own a
// completed settlement; aliases and subsequent awaits share that result.
export const createSettlements = ({ values = {}, outcomes = {}, decisions = {} } = {}) => {
    const { and, or, not } = decisions;

    if (typeof and !== 'function' || typeof or !== 'function' || typeof not !== 'function') throw new TypeError('Expected Boolean decision operations');

    const completed = new WeakMap();
    const empty = outcomes.outcome();
    const plain = (value, observation) => {
        const { promise = 'unknown', standardPrototype = false, unowned = false } = value;

        if (promise === 'known') return false;

        const { owner = false, memberOwner = false } = values.evidenceFor(value);
        const { families = [], incomplete = false } = readFamily({ owner, ...observation });

        if (incomplete || !families.length) return false;

        if (families.every(name => ['string', 'number', 'boolean', 'nullish'].includes(name))) return true;

        if (!standardPrototype || unowned) return false;

        if (families.every(name => ['array', 'function', 'regexp'].includes(name))) return true;

        const { cases = [] } = readField({ owner: memberOwner, name: 'then', ...observation });

        return Boolean(cases.length) && cases.every(({ state = '', owner = false } = {}) => {
            if (state === 'absent') return true;

            if (state !== 'present') return false;

            const { families = [], incomplete = false } = readFamily({ owner, ...observation });

            return !incomplete && Boolean(families.length) && !families.includes('function');
        });
    };
    const project = (value, key, uncertain, observation = {}, { adopt = false } = {}) => {
        if (typeof uncertain !== 'function') throw new TypeError('Expected unresolved settlement completion');

        if (!value) return { completion: empty, protocol: 0 };

        const projectionKey = `${adopt ? 'adopt' : 'observe'}:${key}`;
        const cacheFor = entry => completed.get(entry) || put(completed, entry, new Map());
        const pair = (entry, exposed = false) => {
            const { protocolUnknown = false } = entry;

            return { entry, exposed: exposed || protocolUnknown };
        };
        const keyFor = ({ exposed = false } = {}) => `${projectionKey}:${exposed}`;
        const read = ({ entry = {}, ...state } = {}) => cacheFor(entry).get(keyFor(state));
        const children = ({ entry = {}, exposed = false } = {}) => valueInputs(entry).map(child => pair(child, exposed));
        const visit = () => notify(observation, 'settlement-projection');
        const leaf = (entry, exposed) => {
            const { promise = 'unknown', settlement = false } = entry;

            if (promise === 'known' && !exposed) {
                // Creation already publishes the settlement's effects. An
                // observer of an intact native envelope does not replay them.
                const observed = settlement ? outcomes.outcome({ ...settlement, effects: 0 }) : uncertain(entry);
                const { value: fulfilled = false } = observed;

                // Observing a native promise shares its settled result. Resolving
                // a different promise with it invokes that promise's resolver
                // on the fulfilled payload, whose then property may have changed.
                const { completion = empty } = adopt ? project(fulfilled, `${key}:fulfilled`, uncertain, observation) : {};

                return { completion: adopt ? outcomes.sequence(observed, completion, visit) : observed, protocol: 0 };
            }

            // An opaque thenable can run again at each adoption. Only a known
            // promise has one settlement independent of its aggregate position.
            const inert = plain(exposed ? normalValue({ ...entry, unowned: true }) : entry, observation);

            return { completion: inert ? outcomes.complete(entry) : uncertain(entry, key), protocol: Number(!inert && promise !== 'none') };
        };

        const root = pair(value);

        traverse(root, { enter: (state) => {
            if (read(state)) return [];

            visit();

            return children(state);
        }, leave: (state) => {
            if (read(state)) return;

            const { entry = {}, exposed = false } = state;
            const { input = false, inputs = [], guard = 1, reach = 1, unowned = false } = entry;
            const records = children(state).map(read);
            const [{ completion = empty } = {}] = records;
            const projected = input ? outcomes.restrict(completion, guard, visit)
                : records.map(({ completion = empty } = {}) => completion).reduce((left, right) => outcomes.join(left, right), empty);
            const { completion: selected = empty, protocol = 0 } = input || inputs.length ? {
                completion: projected, protocol: and(input ? guard : 1, records.reduce((gate, { protocol = 0 } = {}) => or(gate, protocol), 0))
            } : leaf(entry, exposed);
            const { value = false, error = false } = selected;
            const owned = unowned ? outcomes.outcome({ ...selected, value: values.retire(value), error: values.retire(error) }) : selected;

            put(cacheFor(entry), keyFor(state), Object.freeze({ completion: outcomes.restrict(owned, reach, visit), protocol: and(protocol, reach) }));
        } });

        return read(root);
    };
    const resolve = (...args) => {
        const { completion = empty } = project(...args);

        return completion;
    };

    const aggregate = (slots, key, uncertain, { array, record, absent = false, unknown = false, settled = false } = {}, observation = {}) => {
        if (typeof array !== 'function' || typeof record !== 'function') throw new TypeError('Expected aggregate value constructors');

        const visit = () => notify(observation, 'settlement-aggregate');
        const entries = slots.map((value, index) => {
            visit();
            const { completion: result = empty, protocol = 0 } = project(value || absent, `${key}:${index}`, uncertain, observation);
            // PromiseResolve can synchronously read a native input's constructor;
            // aggregates also invoke its then method. These failures reject the
            // aggregate itself, including allSettled, before a slot record exists.
            const setup = protocol ? outcomes.join(outcomes.restrict(uncertain(value || absent, `${key}:${index}:protocol`), protocol, visit),
                outcomes.outcome({ normal: not(protocol) })) : outcomes.outcome({ normal: 1 });

            if (!settled) return outcomes.sequence(setup, result, visit);

            const { normal = 0, thrown = 0, value: fulfilled = false, error = unknown, effects = 0 } = result;
            const success = outcomes.restrict(outcomes.complete(record('fulfilled', fulfilled || unknown)), normal, visit);
            const failure = outcomes.restrict(outcomes.complete(record('rejected', error || unknown)), thrown, visit);

            return outcomes.sequence(setup, outcomes.outcome({ ...outcomes.join(success, failure), effects }), visit);
        });
        const combined = entries.reduce((left, right) => outcomes.sequence(left, right, visit), outcomes.outcome({ normal: 1 }));
        const { normal = 0 } = combined;
        // Repeated observations of the same native promise do not create
        // competing reasons. Keep every snapshot when joining their evidence;
        // a retired observation must not revive an earlier member premise.
        const reasons = outcomes.rejectionCases(entries, () => notify(observation, 'rejection-contribution'));
        const error = values.joined(entries.map(({ error = false, thrown = 0 } = {}) => values.restrict(error || unknown, thrown, visit)));
        // Iteration order is not promise reaction order. Distinct reached
        // reasons still withhold the winning payload when reactions can race.
        const { competing = 0 } = reasons.map(({ gate = 0 } = {}) => gate).reduce(({ rejected = 0, competing = 0 } = {}, thrown) => ({
            rejected: or(rejected, thrown), competing: or(competing, and(rejected, thrown))
        }), {});
        const failure = competing ? values.joined([values.restrict(error, not(competing), visit), values.restrict(unknown, competing, visit)]) : error;
        const value = array(Object.freeze(entries.map(({ value = unknown } = {}) => value || unknown)));
        // Input adoption runs for every position, including after a rejection.
        // Its effects are retained independently of all-fulfilled completion.
        const effects = entries.reduce((left, { effects = 0 } = {}) => outcomes.join(left, outcomes.outcome({ effects })), empty);

        return outcomes.join(outcomes.outcome({ ...combined, value: values.restrict(value, normal, visit), error: failure,
            rejections: false }), effects);
    };

    return { resolve, aggregate };
};
