import { walk } from './infer.js';
import {
    createContractGraph,
    normalizePath,
    resolveModule
} from './module-graph.js';

const getObject = value => value && typeof value === 'object' ? value : {};
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

const getUniqueSorted = (values = []) => [...new Set(values)].sort((left = '', right = '') => (
    left.localeCompare(right)
));

const resolverIdentities = new WeakMap();
let nextResolverIdentity = 0;

const getPublicIdentity = (value = '') => {
    if (typeof value !== 'function') return value;
    const existingIdentity = resolverIdentities.get(value);
    if (existingIdentity) return existingIdentity;
    nextResolverIdentity += 1;
    const identity = `function:${nextResolverIdentity}`;
    // eslint-disable-next-line resilient/prefer-safe-transformations -- WeakMap identity registry preserves resolver identity across project snapshots.
    resolverIdentities.set(value, identity);
    return identity;
};

const getResolvedTarget = ({ fileName = '', source = '', programs = {}, resolve = resolveModule } = {}) => {
    try {
        const target = resolve({ from: fileName, source, programs });
        const normalizedTarget = normalizePath(target);
        return programs[normalizedTarget] ? normalizedTarget : '';
    } catch {
        return '';
    }
};

const createProjectTree = ({
    programs: sourcePrograms = {},
    files: sourceFiles = [],
    roots: defaultRoots = [],
    resolve = resolveModule,
    parserIdentity = '',
    configIdentity = '',
    resolverIdentity = resolve,
    sourceStates = {}
} = {}) => {
    let analysisCache = new Map();
    let analysisStats = {
        hits: 0,
        misses: 0
    };
    const programs = Object.fromEntries(Object.entries(sourcePrograms)
        .map(([fileName = '', program = {}] = []) => [normalizePath(fileName), program]));
    const fileNames = getUniqueSorted([
        ...Object.keys(programs),
        ...sourceFiles.map(fileName => normalizePath(fileName))
    ]);
    const indexedFiles = Object.fromEntries(fileNames.map((fileName = '') => {
        const program = programs[fileName] || {};
        const edges = getModuleEdges({ fileName, program });
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
            sourceState: sourceStates[fileName] || '',
            edges: resolvedEdges
        }];
    }));

    const reverseDependents = Object.fromEntries(fileNames.map(fileName => [
        fileName,
        fileNames.filter((candidate = '') => indexedFiles[candidate].edges.some(({ targetFile = '' } = {}) => (
            targetFile === fileName
        )))
    ]));

    const getActiveTree = ({ roots = defaultRoots } = {}) => {
        const requestedRoots = getUniqueSorted(roots.map(fileName => normalizePath(fileName)));
        const activeRoots = requestedRoots.filter(fileName => Boolean(programs[fileName]));
        const missingRoots = requestedRoots.filter(fileName => !programs[fileName]);
        const visit = (pending = [], activeFiles = []) => {
            const [current = '', ...remaining] = pending;
            if (!current) return activeFiles;
            if (activeFiles.includes(current)) return visit(remaining, activeFiles);
            const entry = indexedFiles[current] || {};
            const resolvedTargets = (entry.edges || [])
                .filter(({ status = '' } = {}) => status === 'resolved')
                .map(({ targetFile = '' } = {}) => targetFile)
                .filter(Boolean);
            return visit([...remaining, ...resolvedTargets], [...activeFiles, current]);
        };
        const activeFiles = getUniqueSorted(visit(activeRoots));
        const activeFileSet = new Set(activeFiles);
        const edges = activeFiles.flatMap(fileName => indexedFiles[fileName].edges || []);
        const unknownEdges = edges.filter(({ status = '' } = {}) => status === 'unknown');
        return {
            roots: activeRoots,
            missingRoots,
            activeFiles,
            inactiveFiles: fileNames.filter(fileName => !activeFileSet.has(fileName)),
            edges,
            unknownEdges,
            programs: Object.fromEntries(activeFiles.map(fileName => [fileName, programs[fileName]])),
            stats: {
                indexed: fileNames.length,
                activated: activeFiles.length,
                inactive: fileNames.length - activeFiles.length
            }
        };
    };

    const getDependents = (changedFiles = []) => {
        const changed = getUniqueSorted(changedFiles);
        const direct = fileNames.filter(fileName => changed.includes(fileName));
        const expand = (current = []) => {
            const next = getUniqueSorted([
                ...current,
                ...current.flatMap(fileName => reverseDependents[fileName] || [])
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
        const candidateFiles = identityChanged
            ? activeTree.activeFiles
            : getDependents(normalizedChanged);
        const invalidatedFiles = getUniqueSorted(candidateFiles);
        return {
            changedFiles: normalizedChanged,
            invalidatedFiles,
            activeInvalidatedFiles: invalidatedFiles.filter(fileName => activeTree.activeFiles.includes(fileName)),
            inactiveChangedFiles: normalizedChanged.filter(fileName => activeTree.inactiveFiles.includes(fileName)),
            identityChanged
        };
    };

    const getProjectSnapshot = () => ({
        files: fileNames.map(fileName => ({
            fileName,
            indexed: true,
            sourceState: indexedFiles[fileName].sourceState,
            edges: indexedFiles[fileName].edges
        })),
        parserIdentity,
        configIdentity,
        resolverIdentity: getPublicIdentity(resolverIdentity)
    });

    const getChangedFiles = ({ previousSnapshot = {} } = {}) => {
        const previousProjectTree = previousSnapshot.projectTree || {};
        const previousFiles = Object.fromEntries((previousProjectTree.files || [])
            .map(({ fileName = '', sourceState = '' } = {}) => [fileName, sourceState]));
        const previousPrograms = previousSnapshot.programs || {};
        return fileNames.filter(fileName => (
            !Object.hasOwn(previousFiles, fileName) ||
            !Object.is(indexedFiles[fileName].sourceState, previousFiles[fileName]) ||
            (Object.hasOwn(previousPrograms, fileName) &&
                previousPrograms[fileName] !== programs[fileName])
        ));
    };

    const getReusableFiles = ({
        previousSnapshot = {},
        activeTree = {},
        invalidation = {}
    } = {}) => {
        const previousPrograms = previousSnapshot.programs || {};
        const previousDocuments = previousSnapshot.graph && previousSnapshot.graph.documents || {};
        return activeTree.activeFiles.filter(fileName => (
            !invalidation.identityChanged &&
            !invalidation.activeInvalidatedFiles.includes(fileName) &&
            Object.hasOwn(previousPrograms, fileName) &&
            previousPrograms[fileName] === programs[fileName] &&
            Object.hasOwn(previousDocuments, fileName)
        ));
    };

    const analyze = ({ roots = defaultRoots, previousSnapshot = {} } = {}) => {
        const analysisKey = getUniqueSorted(roots.map(fileName => normalizePath(fileName))).join('|');
        const cached = analysisCache.get(analysisKey);
        if (cached) {
            analysisStats = { ...analysisStats, hits: analysisStats.hits + 1 };
            return cached;
        }
        analysisStats = { ...analysisStats, misses: analysisStats.misses + 1 };
        const activeTree = getActiveTree({ roots });
        const previousProjectTree = previousSnapshot.projectTree || {};
        const identitiesMatch = Object.is(parserIdentity, previousProjectTree.parserIdentity) &&
            Object.is(configIdentity, previousProjectTree.configIdentity) &&
            Object.is(getPublicIdentity(resolverIdentity), previousProjectTree.resolverIdentity);
        const changedFiles = identitiesMatch ? getChangedFiles({ previousSnapshot }) : fileNames;
        const invalidation = getInvalidatedFiles({
            changedFiles,
            roots,
            nextParserIdentity: identitiesMatch ? parserIdentity : '__changed__',
            nextConfigIdentity: identitiesMatch ? configIdentity : '__changed__',
            nextResolverIdentity: identitiesMatch ? resolverIdentity : '__changed__'
        });
        const reusableFiles = getReusableFiles({ previousSnapshot, activeTree, invalidation });
        const previousActiveFiles = previousSnapshot.activeTree && previousSnapshot.activeTree.activeFiles || [];
        const sameActiveTree = JSON.stringify(previousActiveFiles) === JSON.stringify(activeTree.activeFiles);
        const canReuseGraph = Boolean(previousSnapshot.graph) && sameActiveTree &&
            reusableFiles.length === activeTree.activeFiles.length;
        const graph = canReuseGraph
            ? previousSnapshot.graph
            : createContractGraph({
                programs: activeTree.programs,
                resolve,
                previousGraph: previousSnapshot.graph,
                reusableFiles
            });
        const snapshot = {
            projectTree: getProjectSnapshot(),
            activeTree,
            programs: activeTree.programs,
            contracts: graph.moduleExports,
            agreements: graph.getAgreements(),
            diagnostics: graph.getDiagnostics(),
            getDocument: graph.getDocument,
            graph,
            reuse: {
                changedFiles,
                invalidatedFiles: invalidation.invalidatedFiles,
                reusedFiles: reusableFiles,
                graphReused: canReuseGraph
            }
        };
        analysisCache = new Map([...analysisCache, [analysisKey, snapshot]]);
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
