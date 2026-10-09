import { flow } from './function.js';
import { flow as renamed } from './operations.js';

export const unguarded = ({ cb }) => flow(1, cb);
export const shadowed = (renamed, { cb }) => renamed(1, cb);
export const sibling = ({ cb, other }) => {
    if (typeof cb !== 'function') return '';

    cb();
    return other();
};
