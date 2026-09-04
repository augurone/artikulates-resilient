import fs from 'node:fs';
import path from 'node:path';

import { Linter } from 'eslint';

import {
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
import { createProjectTree } from './project-tree.js';
import { getObject, isObject } from '../support/object.js';

const resolverIds = new WeakMap();
const programIds = new WeakMap();
let nextResolverId = 0;
let nextProgramId = 0;

const getResolverId = (resolver) => {
    if (typeof resolver !== 'function') return 0;

    const existingId = resolverIds.get(resolver);

    if (existingId) return existingId;

    nextResolverId += 1;

    // eslint-disable-next-line resilient/prefer-safe-transformations -- WeakMap identity indexing is an internal resolver boundary.
    resolverIds.set(resolver, nextResolverId);

    return nextResolverId;
};

const getProgramId = (program = {}) => {
    if (!isObject(program)) return 0;

    const existingId = programIds.get(program);

    if (existingId) return existingId;

    nextProgramId += 1;

    // eslint-disable-next-line resilient/prefer-safe-transformations -- WeakMap identity indexing is an internal AST boundary.
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

const getConfiguredResolver = ({ context = {}, resolver = resolveLocalImport } = {}) => {
    const {
        settings = {}
    } = context;
    const {
        resilient = {}
    } = settings;
    const {
        resolver: settingsResolver = {}
    } = resilient;

    if (typeof resolver === 'function' && resolver !== resolveLocalImport) return resolver;

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

    const { [normalizedFile]: importedProgram = false } = programs;

    return importedProgram ? normalizedFile : '';
};

const getLanguageOptions = ({ context = {} } = {}) => {
    const {
        languageOptions = {},
        parserOptions = {}
    } = context;
    const {
        ecmaVersion = 'latest',
        sourceType = 'module',
        parser = {},
        parserOptions: languageParserOptions = {}
    } = languageOptions;
    const { parse = false } = getObject(parser);
    const options = {
        ecmaVersion,
        sourceType,
        parserOptions: {
            ...parserOptions,
            ...getObject(languageParserOptions)
        },
        ...(parser && typeof parse === 'function' && { parser })
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

const getFileName = ({ context: sourceContext = {} } = {}) => {
    const context = getObject(sourceContext);
    const { filename = '', getFilename: internalMethod = false } = context;
    // context.filename replaces the removed context.getFilename() as of ESLint 10.
    const fileName = filename || (typeof internalMethod === 'function' ? internalMethod.call(context) : '');

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
} = {}) => {
    const sources = getModuleSources(currentProgram);

    return sources.reduce((queue = [], source = '') => {
        const importedFile = getResolvedImportFile({
            context,
            fileName: currentFile,
            source,
            resolver
        });
        const { [importedFile]: existingProgram = false } = programs;

        if (!importedFile || existingProgram) return queue;

        const importedProgram = getImportedProgram({ importedFile, context });
        const { type: importedProgramType = '' } = getObject(importedProgram);

        return importedProgramType
            ? [...queue, { fileName: importedFile, program: importedProgram }]
            : queue;
    }, pending);
};

const loadPrograms = ({
    context = {},
    program = {},
    fileName = '',
    resolver = resolveLocalImport
} = {}) => {
    const importResolver = getConfiguredResolver({ context, resolver });
    const process = (pending = [], programs = {}) => {
        if (!pending.length) return programs;

        const [current = {}, ...remaining] = pending;
        const {
            fileName: currentFile = '',
            program: currentProgram = {}
        } = current;
        const { [currentFile]: existingProgram = false } = programs;

        if (!currentFile || existingProgram) return process(remaining, programs);

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
    const { text = '' } = getObject(sourceCode);

    if (typeof text === 'string') return text;

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

    const setGraphCacheEntry = ({
        cacheKey = '',
        entry: {
            graph = {},
            snapshot = {}
        } = {}
    } = {}) => {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- The bounded cache owns this delete before replacement.
        graphCache.delete(cacheKey);

        // eslint-disable-next-line resilient/prefer-safe-transformations -- The bounded cache owns this insertion and does not mutate analysis results.
        graphCache.set(cacheKey, { graph, snapshot });

        if (graphCache.size <= graphCacheLimit) return;

        const oldestKey = graphCache.keys().next().value || '';

        if (!oldestKey) return;

        // eslint-disable-next-line resilient/prefer-safe-transformations -- The bounded cache evicts its oldest entry by identity.
        graphCache.delete(oldestKey);
    };

    const getGraph = ({
        context = {},
        program = {},
        fileName = '',
        resolver = {}
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

        const { snapshot: cachedSnapshot = {}, graph: cachedGraph = {} } = getObject(cached);

        if (cached && areSnapshotsEqual(cachedSnapshot, snapshot)) {
            setGraphCacheEntry({ cacheKey, entry: cached });

            const { hits = 0 } = stats;

            stats = { ...stats, hits: hits + 1 };

            return cachedGraph;
        }

        const { misses = 0 } = stats;

        stats = { ...stats, misses: misses + 1 };

        const projectTree = createProjectTree({
            programs,
            roots: [fileName],
            resolve: createGraphResolver({
                context,
                fileNames: Object.keys(programs),
                resolver: importResolver
            }),
            parserIdentity: getParserOptionsKey({ context }),
            resolverIdentity: importResolver
        });
        const { analyze = () => ({}) } = getObject(projectTree);
        const { graph = {} } = analyze({ roots: [fileName] });
        const { builds = 0 } = stats;

        stats = { ...stats, builds: builds + 1 };

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
    const { getDiagnostics = () => [] } = getObject(document);

    return getDiagnostics()
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
