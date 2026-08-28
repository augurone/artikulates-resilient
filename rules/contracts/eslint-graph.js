import fs from 'node:fs';
import path from 'node:path';

import { Linter } from 'eslint';

import {
    createContractGraph,
    getModuleSources,
    normalizePath
} from './module-graph.js';
import {
    clearProgramCache,
    getFileState,
    getCachedProgram,
    getParserOptionsKey,
    getProgramCacheSize
} from './program-cache.js';

const resolverIds = new WeakMap();
let nextResolverId = 0;
const programIds = new WeakMap();
let nextProgramId = 0;

const getResolverId = (resolver = null) => {
    if (typeof resolver !== 'function') return 0;
    const existingId = resolverIds.get(resolver);
    if (existingId) return existingId;
    nextResolverId += 1;
    // WeakMap identity registry is intentionally stateful; it preserves resolver identity across calls.
    // eslint-disable-next-line resilient/prefer-safe-transformations -- WeakMap identity registry requires an in-place write.
    resolverIds.set(resolver, nextResolverId);
    return nextResolverId;
};

const getProgramId = (program = {}) => {
    if (!program || typeof program !== 'object') return 0;
    const existingId = programIds.get(program);
    if (existingId) return existingId;
    nextProgramId += 1;
    // WeakMap identity registry is intentionally stateful; it preserves AST identity across calls.
    // eslint-disable-next-line resilient/prefer-safe-transformations -- WeakMap identity registry requires an in-place write.
    programIds.set(program, nextProgramId);
    return nextProgramId;
};

const getExistingFile = (fileName = '') => {
    try {
        return fs.statSync(fileName).isFile() ? fileName : '';
    } catch {
        return '';
    }
};

const resolveLocalImport = ({ from = '', source = '' } = {}) => {
    if (!from || from.startsWith('<') || !source.startsWith('.')) return '';
    const base = path.resolve(path.dirname(from), source);
    const candidates = [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js')];
    return candidates.map(getExistingFile).find(Boolean) || '';
};

const getConfiguredResolver = ({ context = {}, resolver = null } = {}) => {
    const {
        settings = {}
    } = context;
    const {
        resilient = {}
    } = settings;
    const {
        resolver: settingsResolver = null
    } = resilient;
    if (typeof resolver === 'function') return resolver;
    if (typeof settingsResolver === 'function') return settingsResolver;
    return resolveLocalImport;
};

const getResolvedImportFile = ({
    context = {},
    fileName = '',
    source = '',
    resolver = resolveLocalImport
} = {}) => {
    try {
        const resolvedFile = resolver({
            context,
            from: fileName,
            source
        });
        if (typeof resolvedFile !== 'string' || !resolvedFile) return '';
        return getExistingFile(path.resolve(resolvedFile));
    } catch {
        return '';
    }
};

const createGraphResolver = ({
    context = {},
    fileNames = [],
    resolver = resolveLocalImport
} = {}) => ({
    from = '',
    source = '',
    programs = {}
} = {}) => {
    const originalFile = fileNames.find(fileName => normalizePath(fileName) === from) || from;
    const resolvedFile = getResolvedImportFile({
        context,
        fileName: originalFile,
        source,
        resolver
    });
    const normalizedFile = normalizePath(resolvedFile);
    return programs[normalizedFile] ? normalizedFile : '';
};

const getLanguageOptions = ({ context = {} } = {}) => {
    const {
        languageOptions = {},
        parserOptions = {}
    } = context;
    const {
        ecmaVersion = 'latest',
        sourceType = 'module',
        parser = {}
    } = languageOptions;
    const options = {
        ecmaVersion,
        sourceType,
        parserOptions: {
            ...parserOptions,
            ...(languageOptions.parserOptions || {})
        },
        ...(parser && typeof parser.parse === 'function' && { parser })
    };
    return options;
};

const parseProgram = ({ code = '', context = {} } = {}) => {
    let program = {};
    const capture = {
        rules: {
            program: {
                create: () => ({
                    Program: (node) => {
                        program = node;
                    }
                })
            }
        }
    };
    const linter = new Linter({ configType: 'flat' });
    const messages = linter.verify(code, {
        languageOptions: getLanguageOptions({ context }),
        plugins: { capture },
        rules: { 'capture/program': 'error' }
    });
    return messages.some(({ severity = 0 } = {}) => severity === 2) ? {} : program;
};

const getFileName = ({ context = {} } = {}) => {
    const fileName = typeof context.getFilename === 'function'
        ? context.getFilename()
        : '';
    if (!fileName) return '<text>';
    return fileName.startsWith('<') ? fileName : path.resolve(fileName);
};

const getImportedProgram = ({ importedFile = '', context = {} } = {}) => {
    return getCachedProgram({
        fileName: importedFile,
        context,
        load: () => {
            try {
                const code = fs.readFileSync(importedFile, 'utf8');
                return parseProgram({ code, context });
            } catch {
                return {};
            }
        }
    });
};

const getPendingPrograms = ({
    context = {},
    currentFile = '',
    currentProgram = {},
    pending = [],
    programs = {},
    resolver = resolveLocalImport
} = {}) => getModuleSources(currentProgram).reduce((queue = [], source = '') => {
    const importedFile = getResolvedImportFile({
        context,
        fileName: currentFile,
        source,
        resolver
    });
    if (!importedFile || programs[importedFile]) return queue;
    const importedProgram = getImportedProgram({ importedFile, context });
    return importedProgram.type
        ? [...queue, { fileName: importedFile, program: importedProgram }]
        : queue;
}, pending);

const loadPrograms = ({
    context = {},
    program = {},
    fileName = '',
    resolver = null
} = {}) => {
    const importResolver = getConfiguredResolver({ context, resolver });
    const process = (pending = [], programs = {}) => {
        if (!pending.length) return programs;
        const [current = {}, ...remaining] = pending;
        const {
            fileName: currentFile = '',
            program: currentProgram = {}
        } = current;
        if (!currentFile || programs[currentFile]) return process(remaining, programs);
        const nextPrograms = { ...programs, [currentFile]: currentProgram };
        return process(getPendingPrograms({
            context,
            currentFile,
            currentProgram,
            pending: remaining,
            programs: nextPrograms,
            resolver: importResolver
        }), nextPrograms);
    };

    return process([{ fileName, program }]);
};

const getSourceState = ({ context = {}, program = {} } = {}) => {
    const { sourceCode = {} } = context;
    if (typeof sourceCode.text === 'string') return sourceCode.text;
    return `program:${getProgramId(program)}`;
};

const getProgramSnapshot = ({
    context = {},
    fileName = '',
    program = {},
    programs = {}
} = {}) => {
    const normalizedRoot = normalizePath(fileName);
    const files = Object.fromEntries(Object.keys(programs)
        .sort()
        .map((currentFile = '') => [
            currentFile,
            normalizePath(currentFile) === normalizedRoot
                ? getSourceState({ context, program })
                : getFileState(currentFile)
        ]));
    return files;
};

const areSnapshotsEqual = (left = {}, right = {}) => (
    JSON.stringify(left) === JSON.stringify(right)
);

const GRAPH_CACHE_LIMIT = 16;

const createProjectGraphManager = ({ graphCacheLimit = GRAPH_CACHE_LIMIT } = {}) => {
    let graphCache = new Map();
    let stats = {
        hits: 0,
        misses: 0,
        builds: 0
    };

    const setGraphCacheEntry = ({ cacheKey = '', entry = {} } = {}) => {
        // Delete before set promotes the active entry for bounded LRU retention.
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Cache promotion is the manager's explicit mutable boundary.
        graphCache.delete(cacheKey);
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Cache insertion is the manager's explicit mutable boundary.
        graphCache.set(cacheKey, entry);
        if (graphCache.size <= graphCacheLimit) return;
        const oldestKey = graphCache.keys().next().value || '';
        if (!oldestKey) return;
        // eslint-disable-next-line resilient/prefer-safe-transformations -- LRU eviction is the manager's explicit mutable boundary.
        graphCache.delete(oldestKey);
    };

    const getGraph = ({
        context = {},
        program = {},
        fileName = '',
        resolver = null
    } = {}) => {
        const importResolver = getConfiguredResolver({ context, resolver });
        const programs = loadPrograms({
            context,
            program,
            fileName,
            resolver: importResolver
        });
        const cacheKey = [
            normalizePath(fileName),
            getParserOptionsKey({ context }),
            getResolverId(importResolver)
        ].join(':');
        const snapshot = getProgramSnapshot({
            context,
            fileName,
            program,
            programs
        });
        const cached = graphCache.get(cacheKey);
        if (cached && areSnapshotsEqual(cached.snapshot, snapshot)) {
            setGraphCacheEntry({ cacheKey, entry: cached });
            stats = { ...stats, hits: stats.hits + 1 };
            return cached.graph;
        }

        stats = { ...stats, misses: stats.misses + 1 };
        const graph = createContractGraph({
            programs,
            resolve: createGraphResolver({
                context,
                fileNames: Object.keys(programs),
                resolver: importResolver
            })
        });
        stats = { ...stats, builds: stats.builds + 1 };
        setGraphCacheEntry({
            cacheKey,
            entry: { graph, snapshot }
        });
        return graph;
    };

    const reset = () => {
        graphCache = new Map();
    };
    const getStats = () => ({
        ...stats,
        size: graphCache.size
    });

    return { reset, getGraph, getStats };
};

const defaultProjectGraphManager = createProjectGraphManager();
const clearProjectGraphCache = () => defaultProjectGraphManager.reset();
const getProjectGraphCacheStats = () => defaultProjectGraphManager.getStats();
const clearContractCaches = () => {
    clearProjectGraphCache();
    clearProgramCache();
};

const getEslintContractDiagnostics = ({
    context = {},
    program = {},
    ruleId = ''
} = {}) => {
    const fileName = getFileName({ context });
    if (!fileName) return [];
    const graph = defaultProjectGraphManager.getGraph({
        context,
        program,
        fileName
    });
    const document = graph.getDocument(fileName);
    return document.getDiagnostics()
        .filter(({ ruleId: diagnosticRuleId = '' } = {}) => diagnosticRuleId === ruleId);
};

export {
    clearContractCaches,
    clearProgramCache,
    clearProjectGraphCache,
    getProgramCacheSize,
    getProjectGraphCacheStats,
    createProjectGraphManager,
    getEslintContractDiagnostics,
    loadPrograms
};
