import { empty, forget, put } from './collections.js';

// Metadata has a fixed per-fact budget. It never participates in agreement.
export const causeLimit = 8;

export const sourceCause = ({ code = '', reason = '', location: { range = [], line = 0, column = 0 } = {} } = {}) => {
    if (typeof code !== 'string') throw new TypeError('Expected an evidence cause code');

    if (!code) return empty;

    if (!Array.isArray(range) || !range.every(Number.isSafeInteger) || ![0, 2].includes(range.length) ||
        !Number.isSafeInteger(line) || !Number.isSafeInteger(column)) throw new TypeError('Expected an evidence cause location');

    return Object.freeze([Object.freeze({ code, reason, location: Object.freeze({ range: Object.freeze([...range]), line, column }) })]);
};

const precedes = ({ reason: left = '' } = {}, { reason: right = '' } = {}) => left <= right;

export const mergeCauses = (data) => {
    // Keep the smallest eight source keys, not the first eight visited. Sorting
    // touches at most nine keys; joins never retain an unbounded cause history.
    const selected = new Map();
    const truncated = data.reduce((omitted, { causes = empty, causesTruncated = false } = {}) => {
        return causes.reduce((overflow, cause) => {
            const { code = '', location: { range = [], line = 0, column = 0 } = {} } = cause;
            const key = `${code}:${range.join(':')}:${line}:${column}`;

            const previous = selected.get(key);

            if (previous && precedes(previous, cause)) return overflow;

            put(selected, key, cause);

            if (selected.size > causeLimit) {
                forget(selected, [...selected.keys()].toSorted().at(-1));

                return true;
            }

            return overflow;
        }, omitted || causesTruncated);
    }, false);

    return { causes: selected.size ? Object.freeze([...selected.keys()].toSorted().map(key => selected.get(key))) : empty, causesTruncated: truncated };
};
