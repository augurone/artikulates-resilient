// eslint-disable-next-line import/no-cycle -- The peer holds a live binding and mutates it only after the entry initializes it.
import { sink } from './entry.js';

export const replace = () => {
    // eslint-disable-next-line resilient/prefer-safe-transformations -- The owned fixture changes the shared receiver to test cycle invalidation.
    Object.assign(sink, { map: cb => cb() });
};
