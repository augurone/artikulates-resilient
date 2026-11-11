import { empty, put } from './collections.js';

// Metadata has a fixed per-fact budget. It never participates in agreement.
export const causeLimit = 8;

export const sourceCause = ({ code = '', reason = '', location: { range = [], line = 0, column = 0 } = {} } = {}) => {
    if (typeof code !== 'string') throw new TypeError('Expected an evidence cause code');

    if (!code) return empty;

    if (!Array.isArray(range) || !range.every(Number.isSafeInteger) || ![0, 2].includes(range.length) ||
        !Number.isSafeInteger(line) || !Number.isSafeInteger(column)) throw new TypeError('Expected an evidence cause location');

    return Object.freeze([Object.freeze({ code, reason, location: Object.freeze({ range: Object.freeze([...range]), line, column }) })]);
};

export const mergeCauses = (data) => {
    const selected = new Map();
    const truncated = data.reduce((omitted, { causes = empty, causesTruncated = false } = {}) => {
        return causes.reduce((overflow, cause) => {
            const { code = '', location: { range = [], line = 0, column = 0 } = {} } = cause;
            const key = `${code}:${range.join(':')}:${line}:${column}`;

            if (selected.has(key)) return overflow;

            if (selected.size >= causeLimit) return true;

            put(selected, key, cause);

            return overflow;
        }, omitted || causesTruncated);
    }, false);

    return { causes: selected.size ? Object.freeze([...selected.values()]) : empty, causesTruncated: truncated };
};
