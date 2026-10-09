const TRAVERSAL_METADATA_KEYS = new Set(['parent', 'loc', 'range', 'tokens', 'comments']);

const isTraversalMetadataKey = (key = '') => TRAVERSAL_METADATA_KEYS.has(key);

const getTraversalEntries = (node = {}) => Object.entries(node)
    .filter(([key = ''] = []) => !isTraversalMetadataKey(key));

const extendTraversalPath = (seen = new Set(), value) => new Set([...seen, value]);

const someTraversalChild = (properties = {}, predicate) => getTraversalEntries(properties)
    .some(([, value = {}]) => Array.isArray(value)
        ? value.some(child => predicate(child))
        : predicate(value));

export { extendTraversalPath, getTraversalEntries, isTraversalMetadataKey, someTraversalChild };
