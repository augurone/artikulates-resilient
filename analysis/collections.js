// Shared operations on privately owned indexes and traversal frontiers only.
// Never pass parser nodes, caller collections, or published records here.
export const put = (store, key, value) => {
    // eslint-disable-next-line resilient/prefer-safe-transformations -- Only private identity, premise, and traversal stores are changed; source trees and returned knowledge remain immutable.
    store.set(key, value);

    return value;
};

export const append = (items, value) => {
    // eslint-disable-next-line resilient/prefer-safe-transformations -- Private worklist construction is linear; no caller array or published evidence is mutated.
    items.push(value);
};

export const takeLast = (items) => {
    // eslint-disable-next-line resilient/prefer-safe-transformations -- Removing a completed private traversal entry releases it without copying the remaining frontier.
    return items.pop();
};

export const retain = (items, value) => {
    // eslint-disable-next-line resilient/prefer-safe-transformations -- Private sets record graph membership and deduplicate demanded premises; no caller collection is mutated.
    items.add(value);
};

export const forget = (store, key) => {
    // eslint-disable-next-line resilient/prefer-safe-transformations -- Detach an obsolete entry from an internal dependency or traversal store; published facts and caller data remain immutable.
    store.delete(key);
};
