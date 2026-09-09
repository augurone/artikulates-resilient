import fs from 'node:fs';

import { putSingleEvictionCacheEntry } from './bounded-cache.js';
import { createIdentityIndex } from './identity-index.js';
import { getObject, isObject } from '../support/object.js';

const PROGRAM_CACHE_LIMIT = 256;
let programCache = new Map();
const getStoredObjectId = createIdentityIndex();

const getObjectId = (value) => {
    if (!value || !['object', 'function'].includes(typeof value)) return 0;

    return getStoredObjectId(value);
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

const setProgramCacheEntry = ({ cacheKey = '', entry = {} } = {}) => putSingleEvictionCacheEntry({
    map: programCache, key: cacheKey, entry, limit: PROGRAM_CACHE_LIMIT
});

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
