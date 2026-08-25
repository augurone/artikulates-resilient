const CMS_MEMORY_CACHE_STORE = new Map();
const CMS_MEMORY_INFLIGHT_STORE = new Map();

const createResponse = () => ({
    headers: {
        set: () => {}
    }
});

const setMemoryCacheEntry = ({ key = '', value = '' } = {}) => {
    CMS_MEMORY_CACHE_STORE.set(key, {
        expiresAt: Date.now() + 86400000,
        value
    });
};

const clearCmsPageCache = () => {
    CMS_MEMORY_CACHE_STORE.clear();
    CMS_MEMORY_INFLIGHT_STORE.clear();
};

const buildGraphView = ({ entries = [] } = {}) => {
    const fields = {};
    const nodes = new Map();
    const queue = [];
    const queued = new Set();

    entries.forEach((entry = {}) => {
        const { id = '', value = '' } = entry;
        if (!id || queued.has(id)) return;

        queued.add(id);
        queue.push(id);
        nodes.set(id, entry);
        fields[id] = value;
    });

    return { fields, nodes, queue };
};

const createGraphMappers = () => {
    const graphMappers = {};

    graphMappers.toPage = ({ node = {} } = {}) => ({
        id: node.id || '',
        fields: node.fields || {}
    });

    return graphMappers;
};

const createPreviewQuery = ({ slug = '', secret = '' } = {}) => {
    const query = new URLSearchParams({ slug });
    if (secret) query.set('secret', secret);

    return query;
};

const updateRef = (visibleCountRef, count = 0) => {
    visibleCountRef.current = count;
    return visibleCountRef;
};

const update = (
    { count = 0, ...state } = {},
    { value = '' } = {}
) => ({
    ...state,
    count: count + 1,
    value
});

const response = createResponse();
response.headers.set('Cache-Control', 'no-store');

const visibleCountRef = { current: 0 };
setMemoryCacheEntry({ key: 'home', value: update() });
CMS_MEMORY_INFLIGHT_STORE.set('home', Promise.resolve());
updateRef(visibleCountRef, 1);
clearCmsPageCache();

void [buildGraphView, createGraphMappers, createPreviewQuery, response, visibleCountRef];
