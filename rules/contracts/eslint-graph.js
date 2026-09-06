import fs from 'node:fs';
import path from 'node:path';

import { Linter } from 'eslint';

import {
    clearContractGraphCaches,
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
import { createProjectTree, getModuleEdges } from './project-tree.js';
import { getObject, hasObjectValue, isObject } from '../support/object.js';

const resolverIds = new WeakMap();
const programIds = new WeakMap();
const evidenceIndexes = new WeakMap();
const diagnosticIndexes = new WeakMap();
let programDocuments = new WeakMap();
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

const getConfiguredRoots = ({ context = {}, fileName = '' } = {}) => {
    const {
        settings = {}
    } = context;
    const {
        resilient = {}
    } = settings;
    const {
        roots: configuredRoots = []
    } = resilient;
    const resolvedRoots = typeof configuredRoots === 'function'
        ? configuredRoots({ context, fileName })
        : configuredRoots;
    const roots = Array.isArray(resolvedRoots) ? resolvedRoots : [];

    return [...new Set(roots
        .filter(root => typeof root === 'string' && root && !root.startsWith('<'))
        .map(root => path.resolve(root)))]
        .filter(getExistingFile);
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

const hasNewlyResolvedEdge = ({
    context = {},
    edges = [],
    resolver = resolveLocalImport
} = {}) => edges.some(({
    from = '',
    kind = '',
    source = '',
    status = ''
} = {}) => {
    if (kind !== 'static' || status !== 'unknown') return false;

    return !!getResolvedImportFile({
        context,
        fileName: from,
        source,
        resolver
    });
});

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
    linter.verify(code, {
        languageOptions: getLanguageOptions({ context }),
        plugins: { capture },
        rules: { 'capture/program': 'error' }
    });
    const { type: programType = '' } = getObject(program);

    return programType === 'Program' ? program : {};
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
    resolver = resolveLocalImport,
    additionalRoots = []
} = {}) => {
    const importResolver = getConfiguredResolver({ context, resolver });
    const configuredRoots = getConfiguredRoots({ context, fileName });
    const rootFiles = [...new Set([...additionalRoots, ...configuredRoots])]
        .filter(root => typeof root === 'string' && root && root !== fileName)
        .filter(getExistingFile);
    const rootPrograms = rootFiles.flatMap((root) => {
        const rootProgram = getImportedProgram({ importedFile: root, context });
        const { type: rootProgramType = '' } = getObject(rootProgram);

        return rootProgramType ? [{ fileName: root, program: rootProgram }] : [];
    });
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

    return process([{ fileName, program }, ...rootPrograms]);
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

const areSnapshotValuesEqual = (left = {}, right = {}) => {
    if (left === right) return true;

    if (Array.isArray(left) && Array.isArray(right)) {
        return JSON.stringify(left) === JSON.stringify(right);
    }

    if (!isObject(left) || !isObject(right)) return false;

    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);

    return leftKeys.length === rightKeys.length && leftKeys.every((key = '') => {
        const { [key]: leftValue = false } = left;
        const { [key]: rightValue = false } = right;

        if (leftValue === rightValue) return true;

        if (Array.isArray(leftValue) && Array.isArray(rightValue)) {
            return JSON.stringify(leftValue) === JSON.stringify(rightValue);
        }

        if (!isObject(leftValue) || !isObject(rightValue)) return false;

        const {
            mtimeMs: leftMtimeMs = 0,
            size: leftSize = 0
        } = leftValue;
        const {
            mtimeMs: rightMtimeMs = 0,
            size: rightSize = 0
        } = rightValue;

        return leftMtimeMs === rightMtimeMs && leftSize === rightSize;
    });
};

const areSnapshotsEqual = (left = {}, right = {}) => areSnapshotValuesEqual(left, right);

const isCurrentFileState = ({
    context = {},
    fileName = '',
    program = {},
    state = false
} = {}) => {
    if (typeof state === 'string') {
        return state === getSourceState({ context, program });
    }

    return areSnapshotsEqual(
        { state },
        { state: getFileState(fileName) }
    );
};

const areFileStatesCurrent = ({ fileNames = [], states = {}, currentStates = new Map() } = {}) => fileNames.every((fileName = '') => {
    const { [fileName]: expectedState = {} } = states;
    const currentState = currentStates.has(fileName)
        ? currentStates.get(fileName)
        : getFileState(fileName);

    if (!currentStates.has(fileName)) {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- This per-request map memoizes filesystem state lookups.
        currentStates.set(fileName, currentState);
    }

    return areSnapshotsEqual(
        { state: expectedState },
        { state: currentState }
    );
});

const GRAPH_CACHE_LIMIT = 16;
const PASSIVE_GRAPH_LIMIT = 8;
const DISCOVERY_LIMIT = 256;

const createProjectGraphManager = ({ graphCacheLimit = GRAPH_CACHE_LIMIT } = {}) => {
    let graphCache = new Map();
    let passiveGraphs = new Map();
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

    const setPassiveGraph = ({ cacheKey = '', entry = {} } = {}) => {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- The bounded cache owns this delete before replacement.
        passiveGraphs.delete(cacheKey);

        // eslint-disable-next-line resilient/prefer-safe-transformations -- The bounded cache owns this insertion and does not mutate analysis results.
        passiveGraphs.set(cacheKey, entry);

        if (passiveGraphs.size <= PASSIVE_GRAPH_LIMIT) return;

        const oldestKey = passiveGraphs.keys().next().value || '';

        if (!oldestKey) return;

        // eslint-disable-next-line resilient/prefer-safe-transformations -- The bounded cache evicts its oldest project index.
        passiveGraphs.delete(oldestKey);
    };

    const setBoundedMapEntry = ({
        map = new Map(),
        key = '',
        entry = {},
        limit = 1
    } = {}) => {
        const boundedLimit = Math.max(1, limit);

        // eslint-disable-next-line resilient/prefer-safe-transformations -- The bounded cache owns this mutation before replacement.
        map.delete(key);
        // eslint-disable-next-line resilient/prefer-safe-transformations -- The bounded cache owns this insertion and does not mutate analysis results.
        map.set(key, entry);

        while (map.size > boundedLimit) {
            const oldestKey = map.keys().next().value || '';

            if (!oldestKey) break;

            // eslint-disable-next-line resilient/prefer-safe-transformations -- The bounded cache evicts its oldest entry by identity.
            map.delete(oldestKey);
        }

        return map;
    };

    const getPassiveGraphKey = ({ context = {}, resolver = resolveLocalImport } = {}) => [
        getParserOptionsKey({ context }),
        getResolverId(resolver)
    ].join(':');

    const getPassiveProgramStates = ({
        context = {},
        fileName = '',
        program = {},
        programs = {}
    } = {}) => getProgramSnapshot({
        context,
        fileName,
        program,
        programs
    });

    const getDiscoveryKey = ({ fileName = '', roots = [] } = {}) => [
        normalizePath(fileName),
        roots.map(root => normalizePath(root)).sort().join('|')
    ].join(':');

    const getActiveGraphKey = ({ passiveKey = '', version = 0, roots = [] } = {}) => [
        passiveKey,
        version,
        roots.join('|')
    ].join(':');

    const getPassiveTree = ({
        entry = {},
        context = {},
        resolver = resolveLocalImport
    } = {}) => {
        const {
            tree = false,
            programs = {},
            edges = {}
        } = entry;

        if (tree) return { entry, tree };

        const nextTree = createProjectTree({
            programs,
            edges,
            resolve: createGraphResolver({
                context,
                fileNames: Object.keys(programs),
                resolver
            }),
            parserIdentity: getParserOptionsKey({ context }),
            resolverIdentity: resolver
        });

        return {
            entry: { ...entry, tree: nextTree },
            tree: nextTree
        };
    };

    const getCoveredGraph = ({
        activeGraphs = new Map(),
        roots = [],
        normalizedFileName = '',
        context = {},
        fileName = '',
        program = {},
        currentFileStates = new Map(),
        candidateGraph = {}
    } = {}) => {
        const isCoveredGraph = ({
            activeFiles = [],
            roots: activeRoots = [],
            states: activeStates = {},
            fileStates: activeFileStates = {}
        } = {}) => {
            const { [normalizedFileName]: activeState = false } = activeStates;

            const rootsMatch = areSnapshotsEqual(
                { roots: activeRoots },
                { roots }
            );

            if (!rootsMatch || !activeFiles.includes(normalizedFileName)) return false;

            if (!areFileStatesCurrent({
                fileNames: activeFiles,
                states: activeFileStates,
                currentStates: currentFileStates
            })) return false;

            if (!isCurrentFileState({
                context,
                fileName,
                program,
                state: activeState
            })) return false;

            return true;
        };

        if (hasObjectValue(candidateGraph)) {
            return isCoveredGraph(candidateGraph) ? candidateGraph : {};
        }

        for (const activeGraphEntry of activeGraphs.values()) {
            if (!isCoveredGraph(activeGraphEntry)) continue;

            return activeGraphEntry;
        }

        return {};
    };

    const getGraph = ({
        context = {},
        program = {},
        fileName = '',
        resolver = {}
    } = {}) => {
        const importResolver = getConfiguredResolver({ context, resolver });
        const configuredRoots = getConfiguredRoots({ context, fileName });
        const roots = [...new Set([fileName, ...configuredRoots].map(normalizePath))].sort();
        const passiveKey = getPassiveGraphKey({ context, resolver: importResolver });
        let passive = passiveGraphs.get(passiveKey);

        if (!passive) {
            passive = {
                programs: {},
                states: {},
                edges: {},
                discovery: new Map(),
                activeGraphs: new Map(),
                tree: false,
                version: 0
            };
            setPassiveGraph({ cacheKey: passiveKey, entry: passive });
        }

        const discoveryKey = getDiscoveryKey({
            fileName,
            roots: configuredRoots
        });
        const {
            activeGraphs: passiveActiveGraphs = new Map(),
            discovery: passiveDiscovery = new Map(),
            programs: passivePrograms = {},
            edges: passiveEdges = {},
            states: passiveStates = {},
            version: passiveVersion = 0
        } = passive;
        const normalizedFileName = normalizePath(fileName);
        const currentFileStates = new Map();
        const activeCacheKey = getActiveGraphKey({
            passiveKey,
            version: passiveVersion,
            roots
        });
        const candidateGraph = passiveActiveGraphs.get(activeCacheKey) || {};
        const coveredGraph = getCoveredGraph({
            activeGraphs: passiveActiveGraphs,
            roots,
            normalizedFileName,
            context,
            fileName,
            program,
            currentFileStates,
            candidateGraph
        });
        const hasCoveredGraph = hasObjectValue(coveredGraph);
        const { edges: coveredEdges = [] } = getObject(coveredGraph);
        const requiresDiscovery = hasCoveredGraph && hasNewlyResolvedEdge({
            context,
            edges: coveredEdges,
            resolver: importResolver
        });

        if (hasCoveredGraph && !requiresDiscovery) {
            const { graph: activeGraph = {} } = coveredGraph;
            const { hits = 0 } = stats;
            stats = { ...stats, hits: hits + 1 };

            return activeGraph;
        }

        const cachedDiscovery = passiveDiscovery.get(discoveryKey);
        const {
            programs: cachedPrograms = {},
            states: cachedStates = {}
        } = getObject(cachedDiscovery);
        const currentCachedStates = cachedDiscovery
            ? getPassiveProgramStates({
                context,
                fileName,
                program,
                programs: cachedPrograms
            })
            : {};
        const hasValidDiscovery = cachedDiscovery && !requiresDiscovery && areSnapshotsEqual(cachedStates, currentCachedStates);
        const programs = hasValidDiscovery
            ? cachedPrograms
            : loadPrograms({
                context,
                program,
                fileName,
                resolver: importResolver,
                additionalRoots: configuredRoots
            });
        const states = hasValidDiscovery
            ? cachedStates
            : getPassiveProgramStates({
                context,
                fileName,
                program,
                programs
            });

        const nextDiscovery = hasValidDiscovery
            ? passiveDiscovery
            : setBoundedMapEntry({
                map: passiveDiscovery,
                key: discoveryKey,
                entry: { programs, states },
                limit: DISCOVERY_LIMIT
            });
        const discoveryChanged = !cachedDiscovery || !areSnapshotsEqual(cachedStates, states) ||
            JSON.stringify(Object.keys(cachedPrograms).sort())
            !== JSON.stringify(Object.keys(programs).sort());
        const discoveredUnion = discoveryChanged
            ? [...nextDiscovery.values()].reduce((union, {
                programs: discoveredPrograms = {},
                states: discoveredStates = {}
            } = {}) => ({
                programs: {
                    ...union.programs,
                    ...Object.fromEntries(Object.entries(discoveredPrograms)
                        .map(([currentFile = '', currentProgram = {}] = []) => [
                            normalizePath(currentFile),
                            currentProgram
                        ]))
                },
                states: {
                    ...union.states,
                    ...Object.fromEntries(Object.entries(discoveredStates)
                        .map(([currentFile = '', state = {}] = []) => [normalizePath(currentFile), state]))
                }
            }), {
                programs: {},
                states: {}
            })
            : {
                programs: passivePrograms,
                states: passiveStates
            };

        const normalizedPrograms = Object.fromEntries(Object.entries(programs)
            .map(([currentFile = '', currentProgram = {}] = []) => [normalizePath(currentFile), currentProgram]));
        const normalizedStates = Object.fromEntries(Object.entries(states)
            .map(([currentFile = '', state = {}] = []) => [normalizePath(currentFile), state]));
        const previousPrograms = passivePrograms;
        const previousStates = passiveStates;
        const changedPassiveFiles = Object.entries(normalizedPrograms)
            .filter(([currentFile = '', currentProgram = {}] = []) => {
                const { [currentFile]: existingProgram = false } = previousPrograms;
                const { [currentFile]: existingState = false } = previousStates;
                const { [currentFile]: nextState = false } = normalizedStates;

                return !existingProgram || !areSnapshotsEqual(
                    { [currentFile]: existingState },
                    { [currentFile]: nextState }
                ) || (currentFile === normalizedFileName && existingProgram !== currentProgram);
            })
            .map(([currentFile = ''] = []) => currentFile);
        const {
            programs: discoveredPrograms = {},
            states: discoveredStates = {}
        } = discoveredUnion;
        const nextPassivePrograms = discoveryChanged
            ? discoveredPrograms
            : { ...passivePrograms, ...normalizedPrograms };
        const nextPassiveStates = discoveryChanged
            ? discoveredStates
            : { ...passiveStates, ...normalizedStates };
        const removedPassiveFiles = Object.keys(passivePrograms)
            .filter((currentFile = '') => !Object.prototype.hasOwnProperty.call(nextPassivePrograms, currentFile));
        const normalizedEdges = Object.fromEntries(changedPassiveFiles.map((currentFile = '') => {
            const { [currentFile]: currentProgram = {} } = normalizedPrograms;

            return [currentFile, getModuleEdges({ fileName: currentFile, program: currentProgram })];
        }));
        const nextPassiveEdges = Object.fromEntries(Object.entries({
            ...passiveEdges,
            ...normalizedEdges
        }).filter(([currentFile = ''] = []) => Object.prototype.hasOwnProperty.call(nextPassivePrograms, currentFile)));
        const changedExistingFiles = changedPassiveFiles.filter((currentFile = '') => (
            Object.prototype.hasOwnProperty.call(passivePrograms, currentFile)
        ));
        const passiveChanged = discoveryChanged || !!changedPassiveFiles.length || !!removedPassiveFiles.length;
        const invalidatedPassiveFiles = [...new Set([...changedExistingFiles, ...removedPassiveFiles])];
        const invalidatedPassiveFileSet = new Set(invalidatedPassiveFiles);
        const retainedActiveGraphs = invalidatedPassiveFiles.length
            ? new Map([...passiveActiveGraphs].filter(([, {
                activeFiles = []
            } = {}]) => !activeFiles.some(fileName => invalidatedPassiveFileSet.has(fileName))))
            : passiveActiveGraphs;

        passive = {
            ...passive,
            ...(passiveChanged && {
                programs: nextPassivePrograms,
                edges: nextPassiveEdges,
                states: nextPassiveStates,
                activeGraphs: retainedActiveGraphs,
                tree: false,
                version: passiveVersion + 1
            }),
            discovery: nextDiscovery
        };

        if (invalidatedPassiveFiles.length) {
            graphCache = new Map();
            setPassiveGraph({ cacheKey: passiveKey, entry: passive });
        }

        const { version: currentPassiveVersion = 0 } = getObject(passive);
        const cacheKey = getActiveGraphKey({
            passiveKey,
            version: currentPassiveVersion,
            roots
        });
        const cached = graphCache.get(cacheKey);
        const { graph: cachedGraph = {} } = getObject(cached);

        if (cached) {
            setGraphCacheEntry({ cacheKey, entry: cached });

            const { hits = 0 } = stats;

            stats = { ...stats, hits: hits + 1 };

            return cachedGraph;
        }

        const { misses = 0 } = stats;

        stats = { ...stats, misses: misses + 1 };

        const passiveTree = getPassiveTree({
            entry: passive,
            context,
            resolver: importResolver
        });
        const {
            entry: treePassive = {},
            tree: projectTree = {}
        } = passiveTree;
        passive = treePassive;
        setPassiveGraph({ cacheKey: passiveKey, entry: passive });
        const { analyze = () => ({}) } = getObject(projectTree);
        const analysis = analyze({ roots });
        const {
            activeTree = {},
            graph = {}
        } = analysis;
        const {
            activeFiles = [],
            edges: activeEdges = []
        } = getObject(activeTree);
        const { builds = 0 } = stats;

        stats = { ...stats, builds: builds + 1 };

        const {
            activeGraphs: existingActiveGraphs = new Map(),
            states: currentPassiveStates = {}
        } = getObject(passive);
        const fileStates = Object.fromEntries(activeFiles.map((activeFile = '') => [
            activeFile,
            getFileState(activeFile)
        ]));
        const nextActiveGraphs = setBoundedMapEntry({
            map: existingActiveGraphs,
            key: cacheKey,
            entry: {
                activeFiles,
                edges: activeEdges,
                fileStates,
                graph,
                roots,
                states: currentPassiveStates
            },
            limit: graphCacheLimit
        });
        const nextPassive = { ...passive, activeGraphs: nextActiveGraphs };

        setGraphCacheEntry({
            cacheKey,
            entry: { graph }
        });
        setPassiveGraph({ cacheKey: passiveKey, entry: nextPassive });

        return graph;
    };

    const reset = () => {
        graphCache = new Map();
        passiveGraphs = new Map();
    };
    const getStats = () => ({
        ...stats,
        size: graphCache.size
    });
    const recordHit = () => {
        const { hits = 0 } = stats;
        stats = { ...stats, hits: hits + 1 };
    };

    return { reset, getGraph, getStats, recordHit };
};

const defaultProjectGraphManager = createProjectGraphManager();
const clearProjectGraphCache = () => {
    defaultProjectGraphManager.reset();
    programDocuments = new WeakMap();
};
const getProjectGraphCacheStats = () => defaultProjectGraphManager.getStats();
const clearContractCaches = () => {
    clearProjectGraphCache();
    clearProgramCache();
    clearContractGraphCaches();
};

const getGraphDocument = ({
    context = {},
    program = {},
    fileName = ''
} = {}) => {
    const cached = isObject(program) ? programDocuments.get(program) : false;
    const {
        fileName: cachedFileName = '',
        document: cachedDocument = false
    } = getObject(cached);

    if (cachedDocument && cachedFileName === fileName) {
        defaultProjectGraphManager.recordHit();

        return cachedDocument;
    }

    const graph = defaultProjectGraphManager.getGraph({
        context,
        program,
        fileName
    });
    const document = graph.getDocument(fileName);

    if (isObject(program)) {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- This WeakMap caches one immutable graph document per ESLint AST.
        programDocuments.set(program, { fileName, document });
    }

    return document;
};

const getEvidenceIndex = (document = {}) => {
    const existing = evidenceIndexes.get(document);

    if (existing) return existing;

    const { getEvidence: readEvidence = () => [] } = getObject(document);
    const records = readEvidence();
    const index = {
        records,
        byId: new Map(records.map((record = {}) => {
            const { id = '' } = record;

            return [id, record];
        }))
    };

    // eslint-disable-next-line resilient/prefer-safe-transformations -- This WeakMap caches immutable document evidence for repeated diagnostics.
    evidenceIndexes.set(document, index);

    return index;
};

const getDiagnosticIndex = (document = {}) => {
    const existing = diagnosticIndexes.get(document);

    if (existing) return existing;

    const { getDiagnostics: readDiagnostics = () => [] } = getObject(document);
    const diagnostics = readDiagnostics();
    const byRule = diagnostics.reduce((index = {}, diagnostic = {}) => {
        const { ruleId = '' } = diagnostic;
        const { [ruleId]: current = [] } = index;

        return {
            ...index,
            [ruleId]: [...current, diagnostic]
        };
    }, {});
    const index = { diagnostics, byRule };

    // eslint-disable-next-line resilient/prefer-safe-transformations -- This WeakMap caches immutable diagnostics by document.
    diagnosticIndexes.set(document, index);

    return index;
};

const getEvidenceTrail = ({ id = '', recordsById = new Map(), visited = new Set() } = {}) => {
    if (!id || visited.has(id)) return [];

    const nextVisited = new Set([...visited, id]);
    const record = recordsById.get(id);
    const { derivesFrom = [] } = getObject(record);

    return [
        ...(record ? [record] : []),
        ...derivesFrom.flatMap(parent => getEvidenceTrail({
            id: parent,
            recordsById,
            visited: nextVisited
        }))
    ];
};

const getEvidenceHint = ({ diagnostic = {}, document = {} } = {}) => {
    const { evidenceIds = [] } = getObject(diagnostic);

    if (!Array.isArray(evidenceIds) || !evidenceIds.length) return '';

    const {
        byId: recordsById = new Map()
    } = getEvidenceIndex(document);
    const trail = evidenceIds.flatMap(id => getEvidenceTrail({ id, recordsById }));
    const sourceRecord = trail.find(({ fact = {} } = {}) => {
        const { subject = '' } = fact;

        return subject.startsWith('AssignmentPattern@');
    }) || trail.find(({ kind = '' } = {}) => kind === 'guard') || trail.find(({
        kind = ''
    } = {}) => kind === 'syntax') || {};
    const {
        kind = '',
        fact = {},
        source: {
            loc: {
                start: {
                    line = 0
                } = {}
            } = {}
        } = {}
    } = sourceRecord;
    const { subject = '' } = fact;
    const getLabel = () => {
        if (subject.startsWith('AssignmentPattern@')) return 'default';

        if (kind === 'guard') return 'guard';

        return 'source';
    };
    const label = getLabel();
    const location = line ? ` at line ${line}` : '';

    return ` (static evidence: ${label}${location})`;
};

const getEslintContractDiagnostics = ({
    context = {},
    program = {},
    ruleId = ''
} = {}) => {
    const fileName = getFileName({ context });

    if (!fileName) return [];

    const document = getGraphDocument({ context, program, fileName });
    const { settings = {} } = context;
    const { resilient = {} } = settings;
    const { evidenceMessages = true } = resilient;
    const { byRule = {} } = getDiagnosticIndex(document);
    const { [ruleId]: diagnostics = [] } = byRule;

    return diagnostics
        .map((diagnostic = {}) => {
            const { data = {}, messageId = '' } = getObject(diagnostic);
            const evidenceHint = evidenceMessages === true
                ? getEvidenceHint({ diagnostic, document })
                : '';

            return {
                ...diagnostic,
                ...(evidenceHint && messageId && {
                    messageId: `${messageId}WithEvidence`
                }),
                data: {
                    ...data,
                    evidenceHint
                }
            };
        });
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
