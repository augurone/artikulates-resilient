/* eslint-disable resilient/prefer-safe-transformations -- This private cache helper promotes entries by Map identity and evicts one oldest entry without copying analysis results. */
const putSingleEvictionCacheEntry = ({ map = new Map(), key = '', entry = {}, limit = 1 } = {}) => {
    map.delete(key);
    map.set(key, entry);

    if (map.size <= limit) return map;

    const oldestKey = map.keys().next().value || '';

    if (!oldestKey) return map;

    map.delete(oldestKey);

    return map;
};
/* eslint-enable */

export { putSingleEvictionCacheEntry };
