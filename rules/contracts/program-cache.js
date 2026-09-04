import fs from 'node:fs';

import { getObject, isObject } from '../support/object.js';

const PROGRAM_CACHE_LIMIT = 256;
let programCache = new Map();
const objectIds = new WeakMap();
let nextObjectId = 0;

const getObjectId = (value) => {
    if (!value || !['object', 'function'].includes(typeof value)) return 0;

    const existingId = objectIds.get(value);

    if (existingId) return existingId;

    nextObjectId += 1;
    // eslint-disable-next-line resilient/prefer-safe-transformations -- WeakMap identity indexing is an internal cache boundary.
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
        parser = false,
        parserOptions: languageParserOptions = {}
    } = languageOptions;
    const sourceParserOptions = getObject(parserOptions);
    const options = {
        ...sourceParserOptions,
        ...getObject(languageParserOptions)
    };
    let serializedOptions;

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
} = {}) => leftMtimeMs !== rightMtimeMs || leftSize !== rightSize;

const setProgramCacheEntry = ({ cacheKey = '', entry = {} } = {}) => {
    // eslint-disable-next-line resilient/prefer-safe-transformations -- The bounded cache owns this delete before replacement.
    programCache.delete(cacheKey);

    // eslint-disable-next-line resilient/prefer-safe-transformations -- The bounded cache owns this insertion and does not mutate parsed programs.
    programCache.set(cacheKey, entry);

    if (programCache.size <= PROGRAM_CACHE_LIMIT) return;

    const oldestKey = programCache.keys().next().value || '';

    if (!oldestKey) return;

    // eslint-disable-next-line resilient/prefer-safe-transformations -- The bounded cache evicts its oldest entry by identity.
    programCache.delete(oldestKey);
};

const loadAndCache = ({ cacheKey = '', fileState = {}, load = () => ({}) } = {}) => {
    const program = load();
    const safeProgram = isObject(program) ? program : {};
    const { type = '' } = safeProgram;

    if (!type) return {};

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
    const { mtimeMs = 0, size = 0 } = fileState;

    if (!mtimeMs && !size) return {};

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
