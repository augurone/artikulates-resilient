import { createIdentityIndex } from './identity-index.js';
import { walk } from './infer.js';
import {
    createContractGraph,
    normalizePath,
    resolveModule
} from './module-graph.js';
import { getReverseDependents } from './reverse-dependents.js';
import { getObject, hasObjectValue, isObject } from '../support/object.js';
const STATIC_MODULE_TYPES = ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'];

const getStaticSource = ({ source = {} } = {}) => {
    const { value = '' } = getObject(source);

    return typeof value === 'string' ? value : '';
};

const getModuleEdges = ({ fileName = '', program = {} } = {}) => {
    let edges = [];
    walk(program, ({ type = '', source = {} } = {}) => {
        const sourceValue = getStaticSource({ source });

        if (STATIC_MODULE_TYPES.includes(type) && sourceValue) {
            edges = [...edges, {
                from: fileName,
                source: sourceValue,
                kind: 'static'
            }];

            return;
        }

        if (STATIC_MODULE_TYPES.includes(type)) {
            return;
        }

        if (type !== 'ImportExpression') return;

        edges = [...edges, {
            from: fileName,
            source: getStaticSource({ source }),
            kind: 'dynamic'
        }];
    });

    return edges;
};

const getUniqueSorted = (values = []) => [...new Set(values)].toSorted((left = '', right = '') => (
    left.localeCompare(right)
));

const getStoredResolverIdentity = createIdentityIndex();

const getPublicIdentity = (value = '') => {
    if (typeof value !== 'function') return value;

    return `function:${getStoredResolverIdentity(value)}`;
};

const getResolvedTarget = ({ fileName = '', source = '', programs = {}, resolve = resolveModule } = {}) => {
    try {
        const target = resolve({ from: fileName, source, programs });
        const normalizedTarget = normalizePath(target);
        const { [normalizedTarget]: targetProgram = false } = programs;

        return isObject(targetProgram) ? normalizedTarget : '';
    } catch {
        return '';
    }
};

const createProjectTree = ({
    programs: sourcePrograms = {},
    edges: sourceEdges = {},
    files: sourceFiles = [],
    roots: defaultRoots = [],
    resolve = resolveModule,
    parserIdentity = '',
    configIdentity = '',
    resolverIdentity = resolve,
    sourceStates = {},
    analysisCacheLimit = 16
} = {}) => {
    let analysisCache = new Map();
    let analysisStats = {
        hits: 0,
        misses: 0
    };
    let latestAnalysis = {};
    const programs = Object.fromEntries(Object.entries(sourcePrograms)
        .map(([fileName = '', program = {}] = []) => [normalizePath(fileName), program]));
    const fileNames = getUniqueSorted([
        ...Object.keys(programs),
        ...sourceFiles.map(fileName => normalizePath(fileName))
    ]);
    const indexedFiles = Object.fromEntries(fileNames.map((fileName = '') => {
        const { [fileName]: program = {} } = programs;
        const { [fileName]: cachedEdges = false } = sourceEdges;
        const edges = Array.isArray(cachedEdges)
            ? cachedEdges
            : getModuleEdges({ fileName, program });
        const resolvedEdges = edges.map((edge = {}) => {
            const { source = '', kind = '' } = edge;
            const targetFile = kind === 'static'
                ? getResolvedTarget({ fileName, source, programs, resolve })
                : '';

            return {
                ...edge,
                status: targetFile ? 'resolved' : 'unknown',
                ...(targetFile && { targetFile }),
                ...(!targetFile && { reason: kind === 'dynamic' ? 'unsupported-dynamic-edge' : 'unresolved' })
            };
        });

        return [fileName, {
            fileName,
            program,
            sourceState: (() => {
                const { [fileName]: state = '' } = sourceStates;

                return state;
            })(),
            edges: resolvedEdges
        }];
    }));

    const reverseDependents = getReverseDependents({ fileNames, indexedFiles });

    const getActiveTree = ({ roots = defaultRoots } = {}) => {
        const requestedRoots = getUniqueSorted(roots.map(fileName => normalizePath(fileName)));
        const activeRoots = requestedRoots.filter((fileName) => {
            const { [fileName]: program = false } = programs;

            return isObject(program);
        });
        const missingRoots = requestedRoots.filter((fileName) => {
            const { [fileName]: program = false } = programs;

            return !isObject(program);
        });
        const visit = (pending = [], activeFiles = []) => {
            const [current = '', ...remaining] = pending;

            if (!current) return activeFiles;

            if (activeFiles.includes(current)) return visit(remaining, activeFiles);

            const { [current]: entry = {} } = indexedFiles;
            const { edges = [] } = getObject(entry);
            const resolvedTargets = edges
                .filter(({ status = '' } = {}) => status === 'resolved')
                .map(({ targetFile = '' } = {}) => targetFile)
                .filter(Boolean);

            return visit([...remaining, ...resolvedTargets], [...activeFiles, current]);
        };
        const activeFiles = getUniqueSorted(visit(activeRoots));
        const activeFileSet = new Set(activeFiles);
        const edges = activeFiles.flatMap((fileName) => {
            const { [fileName]: entry = {} } = indexedFiles;
            const { edges: fileEdges = [] } = getObject(entry);

            return fileEdges;
        });
        const unknownEdges = edges.filter(({ status = '' } = {}) => status === 'unknown');

        return {
            roots: activeRoots,
            missingRoots,
            activeFiles,
            inactiveFiles: fileNames.filter(fileName => !activeFileSet.has(fileName)),
            edges,
            unknownEdges,
            programs: Object.fromEntries(activeFiles.map((fileName) => {
                const { [fileName]: program = {} } = programs;

                return [fileName, program];
            })),
            stats: {
                indexed: fileNames.length,
                activated: activeFiles.length,
                inactive: fileNames.length - activeFiles.length
            }
        };
    };

    const getDependents = (changedFiles = []) => {
        const changed = getUniqueSorted(changedFiles);
        const changedSet = new Set(changed);
        const direct = fileNames.filter(fileName => changedSet.has(fileName));
        const expand = (current = []) => {
            const next = getUniqueSorted([
                ...current,
                ...current.flatMap((fileName) => {
                    const { [fileName]: dependents = [] } = reverseDependents;

                    return dependents;
                })
            ]);

            return next.length === current.length ? next : expand(next);
        };

        return expand(direct);
    };

    const getInvalidatedFiles = ({
        changedFiles = [],
        roots = defaultRoots,
        nextParserIdentity = parserIdentity,
        nextConfigIdentity = configIdentity,
        nextResolverIdentity = resolverIdentity
    } = {}) => {
        const activeTree = getActiveTree({ roots });
        const normalizedChanged = getUniqueSorted(changedFiles.map(fileName => normalizePath(fileName)));
        const identityChanged = !Object.is(parserIdentity, nextParserIdentity) ||
            !Object.is(configIdentity, nextConfigIdentity) ||
            !Object.is(resolverIdentity, nextResolverIdentity);
        const { activeFiles = [] } = getObject(activeTree);
        const { inactiveFiles = [] } = activeTree;
        const activeFileSet = new Set(activeFiles);
        const inactiveFileSet = new Set(inactiveFiles);
        const candidateFiles = identityChanged
            ? activeFiles
            : getDependents(normalizedChanged);
        const invalidatedFiles = getUniqueSorted(candidateFiles);

        return {
            changedFiles: normalizedChanged,
            invalidatedFiles,
            activeInvalidatedFiles: invalidatedFiles.filter(fileName => activeFileSet.has(fileName)),
            inactiveChangedFiles: normalizedChanged.filter(fileName => inactiveFileSet.has(fileName)),
            identityChanged
        };
    };

    const getProjectSnapshot = () => ({
        files: fileNames.map((fileName) => {
            const { [fileName]: entry = {} } = indexedFiles;
            const {
                sourceState = '',
                edges = []
            } = getObject(entry);

            return {
                fileName,
                indexed: true,
                sourceState,
                edges
            };
        }),
        parserIdentity,
        configIdentity,
        resolverIdentity: getPublicIdentity(resolverIdentity)
    });

    const getChangedFiles = ({ previousSnapshot: {
        projectTree: {
            files = []
        } = {},
        programs: previousPrograms = {}
    } = {} } = {}) => {
        const previousFiles = Object.fromEntries((files || [])
            .map(({ fileName = '', sourceState = '' } = {}) => [fileName, sourceState]));

        return fileNames.filter((fileName) => {
            const { [fileName]: indexedFile = {} } = indexedFiles;
            const { sourceState = '' } = getObject(indexedFile);
            const { [fileName]: previousSourceState = '' } = previousFiles;
            const { [fileName]: previousProgram = false } = previousPrograms;
            const { [fileName]: currentProgram = false } = programs;

            return !Object.prototype.hasOwnProperty.call(previousFiles, fileName) ||
                !Object.is(sourceState, previousSourceState) ||
                (!!previousProgram && previousProgram !== currentProgram);
        });
    };

    const getReusableFiles = ({
        previousSnapshot = {},
        activeTree = {},
        invalidation = {}
    } = {}) => {
        const { programs: previousPrograms = {} } = getObject(previousSnapshot);
        const { graph: previousGraph = {} } = getObject(previousSnapshot);
        const { documents: previousDocuments = {} } = getObject(previousGraph);
        const { activeFiles = [] } = getObject(activeTree);
        const { identityChanged = false, activeInvalidatedFiles = [] } = getObject(invalidation);
        const invalidatedFileSet = new Set(activeInvalidatedFiles);

        return activeFiles.filter((fileName) => {
            const { [fileName]: currentProgram = false } = programs;
            const { [fileName]: previousProgram = false } = previousPrograms;
            const { [fileName]: previousDocument = false } = previousDocuments;

            return (
                !identityChanged &&
                !invalidatedFileSet.has(fileName) &&
                !!previousProgram &&
                previousProgram === currentProgram &&
                !!previousDocument
            );
        });
    };

    const setAnalysisCacheEntry = ({ key = '', snapshot = {} } = {}) => {
        const entries = [...analysisCache].filter(([existingKey = ''] = []) => existingKey !== key);
        const boundedLimit = Math.max(1, analysisCacheLimit);

        analysisCache = new Map([
            ...entries,
            [key, snapshot]
        ].slice(-boundedLimit));
    };

    const analyze = ({ roots = defaultRoots, previousSnapshot = {}, documentFiles = false } = {}) => {
        const rootKey = getUniqueSorted(roots.map(fileName => normalizePath(fileName))).join('|');
        const analysisKey = Array.isArray(documentFiles)
            ? JSON.stringify([rootKey, getUniqueSorted(documentFiles.map(normalizePath))])
            : rootKey;
        const cached = analysisCache.get(analysisKey);

        if (cached) {
            const { hits = 0 } = analysisStats;
            analysisStats = { ...analysisStats, hits: hits + 1 };
            latestAnalysis = cached;

            return cached;
        }

        const { misses = 0 } = analysisStats;
        analysisStats = { ...analysisStats, misses: misses + 1 };
        const activeTree = getActiveTree({ roots });
        const { projectTree: previousProjectTree = {} } = getObject(previousSnapshot);
        const reusableSnapshot = hasObjectValue(previousSnapshot)
            ? previousSnapshot
            : latestAnalysis;
        const { graph: latestGraph = {} } = getObject(reusableSnapshot);
        const {
            projectTree: reusableProjectTree = previousProjectTree
        } = getObject(reusableSnapshot);
        const {
            parserIdentity: previousParserIdentity = '',
            configIdentity: previousConfigIdentity = '',
            resolverIdentity: previousResolverIdentity = ''
        } = getObject(reusableProjectTree);
        const identitiesMatch = Object.is(parserIdentity, previousParserIdentity) &&
            Object.is(configIdentity, previousConfigIdentity) &&
            Object.is(getPublicIdentity(resolverIdentity), previousResolverIdentity);
        const changedFiles = identitiesMatch ? getChangedFiles({ previousSnapshot: reusableSnapshot }) : fileNames;
        const invalidation = getInvalidatedFiles({
            changedFiles,
            roots,
            nextParserIdentity: identitiesMatch ? parserIdentity : '__changed__',
            nextConfigIdentity: identitiesMatch ? configIdentity : '__changed__',
            nextResolverIdentity: identitiesMatch ? resolverIdentity : '__changed__'
        });
        const reusableFiles = getReusableFiles({
            previousSnapshot: reusableSnapshot,
            activeTree,
            invalidation
        });
        const { activeTree: previousActiveTree = {}, graph: previousGraph = latestGraph } = getObject(reusableSnapshot);
        const { activeFiles: previousActiveFiles = [] } = getObject(previousActiveTree);
        const { activeFiles = [] } = activeTree;
        const { programs: activePrograms = {} } = getObject(activeTree);
        const sameActiveTree = JSON.stringify(previousActiveFiles) === JSON.stringify(activeFiles);
        const { documentFiles: previousDocumentFiles = false } = getObject(reusableSnapshot);
        const sameDocumentSelection = JSON.stringify(previousDocumentFiles) === JSON.stringify(documentFiles);
        const canReuseGraph = hasObjectValue(previousGraph) && sameActiveTree &&
            sameDocumentSelection && reusableFiles.length === activeFiles.length;
        const graph = canReuseGraph
            ? previousGraph
            : createContractGraph({
                programs: activePrograms,
                resolve,
                previousGraph,
                reusableFiles,
                documentFiles
            });
        const {
            moduleExports = {},
            getAgreements = () => [],
            getDiagnostics = () => [],
            getEvidence = () => [],
            getDocument = () => ({})
        } = getObject(graph);
        const { invalidatedFiles = [] } = getObject(invalidation);
        const snapshot = {
            ...(Array.isArray(documentFiles) && { documentFiles }),
            projectTree: getProjectSnapshot(),
            activeTree,
            programs: activePrograms,
            contracts: moduleExports,
            agreements: getAgreements(),
            diagnostics: getDiagnostics(),
            evidence: getEvidence(),
            getDocument,
            graph,
            reuse: {
                changedFiles,
                invalidatedFiles,
                reusedFiles: reusableFiles,
                graphReused: canReuseGraph
            }
        };
        setAnalysisCacheEntry({ key: analysisKey, snapshot });
        latestAnalysis = snapshot;

        return snapshot;
    };

    const getStats = () => ({
        ...analysisStats,
        analysisCacheSize: analysisCache.size,
        filesIndexed: fileNames.length
    });

    return {
        analyze,
        activate: getActiveTree,
        getInvalidatedFiles,
        getProjectSnapshot,
        getStats,
        indexedFiles,
        reverseDependents
    };
};

const createAnalysisSnapshot = ({ projectTree = {}, roots = [] } = {}) => projectTree.analyze({ roots });

export {
    createAnalysisSnapshot,
    createProjectTree,
    getModuleEdges
};
