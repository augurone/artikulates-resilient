// Helpers for internally owned stores and worklists. Callers retain ownership;
// these helpers must not receive source trees, public records, or caller arrays.
export { put, append, takeLast, retain, forget } from '../collections.js';

export const empty = Object.freeze([]);
export const freezeItems = items => items.length ? Object.freeze(items) : empty;

export const frameAt = (frames, index, frame) => {
    // eslint-disable-next-line resilient/prefer-safe-transformations, resilient/prefer-destructured-member-access -- This indexed write updates a private traversal stack; destructuring cannot replace an assignment target.
    frames[index] = frame;
};

export const takeFrom = (items, position) => {
    // eslint-disable-next-line resilient/prefer-safe-transformations -- Remove a completed component from a private traversal stack without copying its remaining frontier.
    return items.splice(position);
};
