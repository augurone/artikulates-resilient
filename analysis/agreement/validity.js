import { append, forget, put, retain, takeLast } from './collections.js';
import { work } from './observation.js';

// Reverse links target private validity tokens, never facts or owners. WeakRef
// keeps dereferenced targets alive until the end of a job; empty tokens prevent
// that rule from pinning entire historical fact graphs during a change storm.
const records = new WeakMap();
const active = new WeakMap();
const subscriptions = new WeakMap();
const retirements = new WeakMap();
const detach = ({ parents = [], reference = false } = {}) => parents.forEach(parent => forget(parent, reference));
const collected = new FinalizationRegistry(detach);
const subscribers = key => subscriptions.get(key) || put(subscriptions, key, new Set());

export const current = fact => active.has(records.get(fact));

// Cache ownership stays with the publisher. Retirement is synchronous and
// separate from finalizer holdings, which must never retain a fact or its graph.
export const retireOnInvalidation = (fact, release) => {
    const token = records.get(fact);

    if (token && typeof release === 'function') put(retirements, token, release);
};

export const track = ({ fact = false, owner = false, premises = [] } = {}) => {
    if (!premises.length) return;

    const parents = [...new Set([subscribers(owner), ...premises.map((premise) => {
        const { owner: premiseOwner = false } = premise;

        return subscribers(records.get(premise) || premiseOwner);
    })])];
    const token = Object.freeze({});
    const reference = new WeakRef(token);
    const links = { parents, reference };

    parents.forEach(parent => retain(parent, reference));
    put(records, fact, token);
    put(active, token, links);
    collected.register(token, links, reference);
};

export const invalidate = ({ owners = [], observation = {} } = {}) => {
    const pending = [];
    const enqueue = (key) => {
        const children = subscriptions.get(key);

        if (!children) return;

        children.forEach(reference => append(pending, reference));
        // Keep the set identity for existing parent links while emptying it.
        children.forEach(reference => forget(children, reference));
    };

    owners.forEach(enqueue);

    // eslint-disable-next-line resilient/prefer-prototype-methods -- Invalidated facts discover their dependents dynamically; a worklist visits the affected graph without recursive stack growth.
    while (pending.length) {
        const reference = takeLast(pending);
        const token = reference.deref();

        work(observation, 'invalidation-edge');

        if (!token || !active.has(token)) continue;

        const links = active.get(token);
        const release = retirements.get(token);

        forget(active, token);
        forget(retirements, token);
        collected.unregister(reference);
        detach(links);

        if (typeof release === 'function') release();

        work(observation, 'invalidation');
        enqueue(token);
        forget(subscriptions, token);
    }
};
