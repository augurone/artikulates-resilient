import { flow as renamed } from './operations.js';

const alias = renamed;

export const guarded = ({ cb }) => alias(1, cb);
export const direct = ({ cb }) => typeof cb === 'function' && cb();
