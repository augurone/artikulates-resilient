import { put } from './collections.js';

export const counter = ({ kinds = [] } = {}) => {
    const counts = new Map(kinds.map(kind => [kind, 0]));
    const increment = kind => put(counts, kind, (counts.get(kind) || 0) + 1);
    const onWork = ({ kind = '' } = {}) => increment(kind);

    return { increment, onWork, get: kind => counts.get(kind) || 0, read: () => Object.fromEntries(counts) };
};
