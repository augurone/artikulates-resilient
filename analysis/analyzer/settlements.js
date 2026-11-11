import { readFamily, readField } from 'eslint-plugin-resilient/agreement';

import { put } from '../collections.js';
import { traverse } from '../traversal.js';
import { normalValue, valueInputs } from './values.js';
import { notify } from './work.js';

// Promise adoption projects the existing guarded value graph. It never executes
// a thenable or reconstructs an expression from syntax. Envelopes already own a
// completed settlement; aliases and subsequent awaits share that result.
export const createSettlements = ({ values = {}, outcomes = {} } = {}) => {
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
    const resolve = (value, key, uncertain, observation = {}) => {
        if (typeof uncertain !== 'function') throw new TypeError('Expected unresolved settlement completion');

        if (!value) return empty;

        const cacheFor = entry => completed.get(entry) || put(completed, entry, new Map());
        const read = entry => cacheFor(entry).get(key);
        const visit = () => notify(observation, 'settlement-projection');
        const leaf = (entry) => {
            const { promise = 'unknown', settlement = false } = entry;

            if (promise === 'known') return settlement || uncertain();

            return plain(entry, observation) ? outcomes.complete(entry) : uncertain();
        };

        traverse(value, { enter: (entry) => {
            if (read(entry)) return [];

            visit();

            return valueInputs(entry);
        }, leave: (entry) => {
            if (read(entry)) return;

            const { input = false, inputs = [], guard = 1, reach = 1, unowned = false } = entry;
            const projected = input ? outcomes.restrict(read(input), guard, visit) : inputs.map(read).reduce((left, right) => outcomes.join(left, right), empty);
            const selected = input || inputs.length ? projected : leaf(entry);
            const { value = false } = selected;
            const owned = unowned && value ? outcomes.outcome({ ...selected, value: normalValue({ ...value, unowned: true }) }) : selected;

            put(cacheFor(entry), key, outcomes.restrict(owned, reach, visit));
        } });

        return read(value);
    };

    return { resolve };
};
