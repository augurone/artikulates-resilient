import { append } from './collections.js';

// Buffer notifications until the request has published all demanded knowledge.
export const work = ({ events = false } = {}, kind) => {
    if (!events) return;

    append(events, Object.freeze({ kind }));
};

export const deliver = (onWork, event) => {
    if (typeof onWork !== 'function') return;

    onWork(event);
};
