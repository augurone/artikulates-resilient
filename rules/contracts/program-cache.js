import fs from 'node:fs';

const PROGRAM_CACHE_LIMIT = 256;
let programCache = new Map();
const objectIds = new WeakMap();
let nextObjectId = 0;

const getObjectId = (value = {}) => {
    if (!value || !['object', 'function'].includes(typeof value)) return 0;
    const existingId = objectIds.get(value);
    if (existingId) return existingId;
    nextObjectId += 1;
    // WeakMap identity registry preserves parser object identity across cache calls.
    // eslint-disable-next-line resilient/prefer-safe-transformations -- Identity lookup requires a WeakMap write.
    objectIds.set(value, nextObjectId);
    return nextObjectId;
};

const getParserOptionsKey = ({ context = {} } = {}) => {
    const {
        languageOptions = {},
        parserOptions = {}
    } = context;
    const {
        ecmaVersion = 'latest',
        sourceType = 'module',
        parser = null
    } = languageOptions;
    const options = {
        ...parserOptions,
        ...(languageOptions.parserOptions || {})
    };
    let serializedOptions = '';
    try {
        serializedOptions = JSON.stringify(options);
    } catch {
        serializedOptions = 'unserializable';
    }
    return JSON.stringify({
        ecmaVersion,
        sourceType,
        parser: getObjectId(parser),
        options: serializedOptions
    });
};

const getFileState = (fileName = '') => {
    try {
        const { mtimeMs = 0, size = 0 } = fs.statSync(fileName);
        return { mtimeMs, size };
    } catch {
        return {};
    }
};

const hasFileStateChanged = ({ mtimeMs: leftMtimeMs = 0, size: leftSize = 0 } = {}, {
    mtimeMs: rightMtimeMs = 0,
    size: rightSize = 0
} = {}) => (
    leftMtimeMs !== rightMtimeMs || leftSize !== rightSize
);

const setProgramCacheEntry = ({ cacheKey = '', entry = {} } = {}) => {
    // Delete before set promotes the active entry for bounded LRU retention.
    // eslint-disable-next-line resilient/prefer-safe-transformations -- Cache promotion is the cache's explicit mutable boundary.
    programCache.delete(cacheKey);
    // eslint-disable-next-line resilient/prefer-safe-transformations -- Cache insertion must retain the parsed program by key.
    programCache.set(cacheKey, entry);
    if (programCache.size <= PROGRAM_CACHE_LIMIT) return;
    const oldestKey = programCache.keys().next().value || '';
    if (!oldestKey) return;
    // eslint-disable-next-line resilient/prefer-safe-transformations -- LRU eviction must remove the oldest retained program.
    programCache.delete(oldestKey);
};

const loadAndCache = ({ cacheKey = '', fileState = {}, load = () => ({}) } = {}) => {
    const program = load();
    if (!program || !program.type) return {};
    setProgramCacheEntry({
        cacheKey,
        entry: { fileState, program }
    });
    return program;
};

const getCachedProgram = ({
    fileName = '',
    context = {},
    load = () => ({})
} = {}) => {
    const fileState = getFileState(fileName);
    if (!fileState.mtimeMs && !fileState.size) return {};
    const cacheKey = `${fileName}:${getParserOptionsKey({ context })}`;
    const cached = programCache.get(cacheKey);
    if (!cached) return loadAndCache({ cacheKey, fileState, load });
    const { fileState: cachedFileState = {}, program: cachedProgram = {} } = cached;
    if (!hasFileStateChanged(cachedFileState, fileState)) {
        setProgramCacheEntry({ cacheKey, entry: cached });
        return cachedProgram;
    }
    return loadAndCache({ cacheKey, fileState, load });
};

const clearProgramCache = () => {
    programCache = new Map();
};

const getProgramCacheSize = () => programCache.size;

export {
    clearProgramCache,
    getFileState,
    getCachedProgram,
    getParserOptionsKey,
    getProgramCacheSize,
    PROGRAM_CACHE_LIMIT
};
