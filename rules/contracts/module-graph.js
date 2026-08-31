import { createContractDocument } from './document.js';
import {
    getDefinitions,
    getPropertyName,
    walk
} from './infer.js';
import { contract, isEqual } from './model.js';

const getObject = value => value && typeof value === 'object' ? value : {};

const normalizePath = (value = '') => {
    const prefix = value.startsWith('/') ? '/' : '';
    const parts = value
        .replaceAll('\\', '/')
        .split('/')
        .reduce((segments = [], segment = '') => {
            if (!segment || segment === '.') return segments;
            if (segment === '..') return segments.slice(0, -1);
            return [...segments, segment];
        }, []);
    return `${prefix}${parts.join('/')}`;
};

const getDirectory = (fileName = '') => {
    const normalized = normalizePath(fileName);
    const separator = normalized.lastIndexOf('/');
    return separator >= 0 ? normalized.slice(0, separator) : '';
};

const resolveModule = ({ from = '', source = '', programs = {} } = {}) => {
    if (!source.startsWith('.')) return '';
    const directory = getDirectory(from);
    const base = normalizePath(directory ? `${directory}/${source}` : source);
    const candidates = [base, `${base}.js`, `${base}.jsx`, `${base}/index.js`];
    return candidates.find(candidate => programs[candidate]) || '';
};

const getModuleSources = (program = {}) => {
    let sources = [];
    walk(program, ({ type = '', source = {} } = {}) => {
        if (!['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(type)) return;
        const { value = '' } = getObject(source);
        if (value) sources = [...sources, value];
    });
    return [...new Set(sources)];
};

const getImportBindings = (program = {}) => {
    let bindings = [];
    walk(program, ({ type = '', source = {}, specifiers = [] } = {}) => {
        if (type !== 'ImportDeclaration') return;
        const { value: sourceValue = '' } = getObject(source);
        specifiers.forEach(({
            type: specifierType = '',
            local = {},
            imported = {}
        } = {}) => {
            const { name: localName = '' } = local;
            const importedNames = {
                ImportSpecifier: getPropertyName({ key: imported }),
                ImportDefaultSpecifier: 'default',
                ImportNamespaceSpecifier: '*'
            };
            const importedName = importedNames[specifierType] || '';
            if (!sourceValue || !localName || !importedName) return;
            bindings = [...bindings, {
                kind: specifierType === 'ImportNamespaceSpecifier' ? 'namespace' : 'named',
                localName,
                importedName,
                source: sourceValue
            }];
        });
    });
    return bindings;
};

const getImportMap = (program = {}) => Object.fromEntries(getImportBindings(program)
    .map(({ kind = 'named', localName = '', importedName = '', source = '' } = {}) => [localName, {
        kind,
        importedName,
        source
    }]));

const getImportBinding = ({ imports = {}, localName = '' } = {}) => {
    const { [localName]: binding = null } = imports;
    return binding;
};

const getModuleExportEntries = ({ program = {}, definitions = {} } = {}) => {
    let entries = {};
    let exportAllSources = [];
    const imports = getImportMap(program);

    const addLocalExport = ({ exportName = '', localName = '' } = {}) => {
        if (!exportName || !localName) return;
        if (Object.hasOwn(definitions, localName)) {
            entries = { ...entries, [exportName]: {
                kind: 'definition',
                definition: definitions[localName]
            } };
            return;
        }
        const binding = getImportBinding({ imports, localName });
        if (!binding) return;
        entries = { ...entries, [exportName]: {
            kind: binding.kind === 'namespace' ? 'namespace-reexport' : 'reexport',
            importedName: binding.importedName,
            source: binding.source
        } };
    };

    const addNamedExport = ({ source = {}, declaration = {}, specifiers = [] } = {}) => {
        const { value: sourceValue = '' } = getObject(source);
        if (sourceValue) {
            specifiers.forEach(({ local = {}, exported = {} } = {}) => {
                const importedName = getPropertyName({ key: local });
                const exportName = getPropertyName({ key: exported });
                if (!importedName || !exportName) return;
                entries = { ...entries, [exportName]: {
                    kind: 'reexport',
                    importedName,
                    source: sourceValue
                } };
            });
            return;
        }

        const {
            type: declarationType = '',
            id = {},
            declarations = []
        } = getObject(declaration);
        if (declarationType === 'FunctionDeclaration') {
            const { name: idName = '' } = getObject(id);
            addLocalExport({
                exportName: idName,
                localName: idName
            });
            return;
        }
        if (declarationType === 'VariableDeclaration') {
            declarations.forEach(({ id: declarationId = {} } = {}) => {
                const { name = '' } = getObject(declarationId);
                addLocalExport({ exportName: name, localName: name });
            });
            return;
        }
        specifiers.forEach(({ local = {}, exported = {} } = {}) => addLocalExport({
            exportName: getPropertyName({ key: exported }),
            localName: getPropertyName({ key: local })
        }));
    };

    walk(program, ({ type = '', declaration = {}, source = {}, specifiers = [], exported = {} } = {}) => {
        if (type === 'ExportNamedDeclaration') {
            addNamedExport({ source, declaration, specifiers });
            return;
        }

        if (type === 'ExportDefaultDeclaration') {
            const {
                type: declarationType = '',
                id = {},
                name = ''
            } = getObject(declaration);
            const { name: idName = '' } = getObject(id);
            addLocalExport({
                exportName: 'default',
                localName: idName || name || (
                    ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']
                        .includes(declarationType)
                        ? 'default'
                        : ''
                )
            });
            return;
        }

        if (type !== 'ExportAllDeclaration') return;
        const { value = '' } = getObject(source);
        if (!value) return;
        const { name: exportedName = '' } = getObject(exported);
        if (exportedName) {
            entries = { ...entries, [exportedName]: {
                kind: 'namespace-reexport',
                source: value
            } };
            return;
        }
        exportAllSources = [...exportAllSources, value];
    });

    return { entries, exportAllSources };
};

const getModuleExports = ({ program = {}, definitions = {} } = {}) => {
    const { entries = {} } = getModuleExportEntries({ program, definitions });
    return Object.fromEntries(Object.entries(entries)
        .filter(([, entry = {}] = []) => entry.kind === 'definition')
        .map(([name = '', { definition = {} } = {}] = []) => [name, definition]));
};

const getImportedDefinitions = ({
    fileName = '',
    program = {},
    moduleExports = {},
    programs = {},
    resolve = resolveModule
} = {}) => Object.fromEntries(getImportBindings(program)
    .flatMap(({ kind = 'named', localName = '', importedName = '', source = '' } = {}) => {
        const targetFile = resolve({ from: fileName, source, programs });
        if (!targetFile) return [];
        const targetExports = moduleExports[targetFile] || {};
        if (kind === 'namespace') return [[localName, contract({
            kind: 'object',
            properties: targetExports
        })]];
        if (!Object.hasOwn(targetExports, importedName)) return [];
        return [[localName, targetExports[importedName]]];
    }));

const addExportCandidate = ({ candidates = {}, name = '', definition = {}, priority = 'star' } = {}) => {
    if (!name || !definition) return candidates;
    const { [name]: existing = [] } = candidates;
    return { ...candidates, [name]: [...existing, { definition, priority }] };
};

const getCandidateResolution = (candidates = []) => {
    if (!candidates.length) return {};
    const explicit = candidates.filter(({ priority = '' } = {}) => priority === 'explicit');
    if (explicit.length > 1) return { ambiguous: true };
    if (explicit.length === 1) return { definition: explicit[0].definition };
    if (candidates.length > 1) return { ambiguous: true };
    return { definition: candidates[0].definition };
};

const getNamespaceContract = (moduleExports = {}) => contract({
    kind: 'object',
    properties: moduleExports
});

const addResolvedEntryCandidate = ({
    moduleName = '',
    exportName = '',
    entry = {},
    candidates = {},
    resolved = {},
    ambiguities = {},
    programs = {},
    resolve = resolveModule
} = {}) => {
    const { kind = '', importedName = '', source = '' } = entry;
    if (kind === 'definition') {
        return addExportCandidate({
            candidates,
            name: exportName,
            definition: entry.definition,
            priority: 'explicit'
        });
    }
    const targetFile = resolve({ from: moduleName, source, programs });
    if (!targetFile) return candidates;
    const targetExports = resolved[targetFile] || {};
    if (kind === 'namespace-reexport') {
        return addExportCandidate({
            candidates,
            name: exportName,
            definition: getNamespaceContract(targetExports),
            priority: 'explicit'
        });
    }
    if (kind !== 'reexport') return candidates;
    const targetAmbiguities = ambiguities[targetFile] || {};
    if (Object.hasOwn(targetAmbiguities, importedName)) return candidates;
    if (!Object.hasOwn(targetExports, importedName)) return candidates;
    return addExportCandidate({
        candidates,
        name: exportName,
        definition: targetExports[importedName],
        priority: 'explicit'
    });
};

const addExportAllCandidates = ({
    fileName = '',
    source = '',
    candidates = {},
    resolved = {},
    programs = {},
    resolve = resolveModule
} = {}) => {
    const targetFile = resolve({ from: fileName, source, programs });
    if (!targetFile) return candidates;
    const targetExports = resolved[targetFile] || {};
    return Object.entries(targetExports)
        .filter(([name = ''] = []) => name !== 'default')
        .reduce((current, [name = '', definition = {}] = []) => addExportCandidate({
            candidates: current,
            name,
            definition
        }), candidates);
};

const areExportValuesEqual = (left = {}, right = {}) => {
    const leftObject = getObject(left);
    const rightObject = getObject(right);
    const leftNamespace = leftObject.kind === 'object';
    const rightNamespace = rightObject.kind === 'object';
    if (leftNamespace !== rightNamespace) return false;
    if (leftNamespace) {
        const leftProperties = leftObject.properties || {};
        const rightProperties = rightObject.properties || {};
        const leftNames = Object.keys(leftProperties);
        const rightNames = Object.keys(rightProperties);
        return leftNames.length === rightNames.length && leftNames.every(name => (
            Object.hasOwn(rightProperties, name) && areExportValuesEqual(
                leftProperties[name],
                rightProperties[name]
            )
        ));
    }
    if (!Object.hasOwn(leftObject, 'returnContract') || !Object.hasOwn(rightObject, 'returnContract')) {
        return left === right;
    }
    return isEqual(leftObject.returnContract, rightObject.returnContract);
};

const areNameSetsEqual = (left = {}, right = {}) => {
    const leftNames = Object.keys(left);
    const rightNames = Object.keys(right);
    return leftNames.length === rightNames.length && leftNames.every(name => Object.hasOwn(right, name));
};

const getModuleExportState = ({
    programs = {},
    definitions = {},
    resolve = resolveModule
} = {}) => {
    const entries = Object.fromEntries(Object.entries(programs)
        .map(([fileName = '', program = {}] = []) => [fileName, getModuleExportEntries({
            program,
            definitions: definitions[fileName]
        })]));
    let resolved = Object.fromEntries(Object.keys(programs)
        .map(fileName => [fileName, {}]));
    let ambiguities = Object.fromEntries(Object.keys(programs)
        .map(fileName => [fileName, {}]));
    const remaining = Object.keys(programs).length + 1;

    for (let iteration = 0; iteration < remaining; iteration += 1) {
        let candidatesByFile = Object.fromEntries(Object.keys(programs)
            .map(fileName => [fileName, {}]));

        Object.entries(entries).forEach(([fileName = '', {
            entries: moduleEntries = {},
            exportAllSources = []
        } = {}] = []) => {
            Object.entries(moduleEntries).forEach(([name = '', entry = {}] = []) => {
                const entryCandidates = candidatesByFile[fileName] || {};
                const nextCandidates = addResolvedEntryCandidate({
                    moduleName: fileName,
                    exportName: name,
                    entry,
                    candidates: entryCandidates,
                    resolved,
                    ambiguities,
                    programs,
                    resolve
                });
                candidatesByFile = {
                    ...candidatesByFile,
                    [fileName]: nextCandidates
                };
            });

            exportAllSources.forEach((source = '') => {
                const nextCandidates = addExportAllCandidates({
                    fileName,
                    source,
                    candidates: candidatesByFile[fileName],
                    resolved,
                    programs,
                    resolve
                });
                candidatesByFile = {
                    ...candidatesByFile,
                    [fileName]: nextCandidates
                };
            });
        });

        let nextAmbiguities = {};
        const next = Object.fromEntries(Object.entries(candidatesByFile)
            .map(([fileName = '', candidates = {}] = []) => {
                const {
                    exports = {},
                    ambiguities: fileAmbiguities = {}
                } = Object.entries(candidates)
                    .reduce(({ exports: currentExports = {}, ambiguities: currentAmbiguities = {} }, [name = '', candidateList = []] = []) => {
                        const resolution = getCandidateResolution(candidateList);
                        if (resolution.ambiguous) {
                            return {
                                exports: currentExports,
                                ambiguities: { ...currentAmbiguities, [name]: true }
                            };
                        }
                        const { definition = null } = resolution;
                        return definition
                            ? {
                                exports: { ...currentExports, [name]: definition },
                                ambiguities: currentAmbiguities
                            }
                            : { exports: currentExports, ambiguities: currentAmbiguities };
                    }, { exports: {}, ambiguities: {} });
                nextAmbiguities = {
                    ...nextAmbiguities,
                    [fileName]: fileAmbiguities
                };
                return [fileName, exports];
            }));
        const changed = Object.keys(programs).some(fileName => (
            !areExportValuesEqual(
                { kind: 'object', properties: resolved[fileName] || {} },
                { kind: 'object', properties: next[fileName] || {} }
            ) ||
            !areNameSetsEqual(ambiguities[fileName] || {}, nextAmbiguities[fileName] || {})
        ));
        resolved = next;
        ambiguities = nextAmbiguities;
        if (!changed) break;
    }

    return { exports: resolved, ambiguities };
};

const getModuleAgreements = ({
    fileName = '',
    program = {},
    moduleExports = {},
    ambiguities = {},
    programs = {},
    resolve = resolveModule
} = {}) => getImportBindings(program).map(({
    kind = 'named',
    localName = '',
    importedName = '',
    source = ''
} = {}) => {
    const targetFile = resolve({ from: fileName, source, programs });
    if (!targetFile) return {
        fileName,
        kind: 'unknown',
        localName,
        importedName,
        source
    };
    const targetExports = moduleExports[targetFile] || {};
    const targetAmbiguities = ambiguities[targetFile] || {};
    if (kind === 'namespace') return {
        fileName,
        kind: 'resolved',
        localName,
        importedName,
        source,
        targetFile
    };
    if (Object.hasOwn(targetAmbiguities, importedName)) return {
        fileName,
        kind: 'ambiguous',
        localName,
        importedName,
        source,
        targetFile
    };
    if (!Object.hasOwn(targetExports, importedName)) return {
        fileName,
        kind: 'missing',
        localName,
        importedName,
        source,
        targetFile
    };
    return {
        fileName,
        kind: 'resolved',
        localName,
        importedName,
        source,
        targetFile
    };
});

const areDefinitionSetsEqual = (left = {}, right = {}) => {
    const leftNames = Object.keys(left);
    const rightNames = Object.keys(right);
    return leftNames.length === rightNames.length && leftNames.every(name => (
        Object.hasOwn(right, name) && isEqual(
            left[name].returnContract,
            right[name].returnContract
        )
    ));
};

const createContractGraph = ({
    programs = {},
    resolve = resolveModule,
    previousGraph = {},
    reusableFiles = []
} = {}) => {
    const normalizedPrograms = Object.fromEntries(Object.entries(programs)
        .map(([fileName = '', program = {}] = []) => [normalizePath(fileName), program]));
    const previousDefinitions = previousGraph.definitions || {};
    const previousDocuments = previousGraph.documents || {};
    const reusable = new Set(reusableFiles);
    const canReuse = (fileName = '') => reusable.has(fileName) &&
        Object.hasOwn(previousDefinitions, fileName) &&
        Object.hasOwn(previousDocuments, fileName);
    let definitions = Object.fromEntries(Object.entries(normalizedPrograms)
        .map(([fileName = '', program = {}] = []) => [
            fileName,
            canReuse(fileName) ? previousDefinitions[fileName] : getDefinitions(program)
        ]));
    let moduleExports = {};
    let moduleResolution = { ambiguities: {}, exports: {} };
    const remaining = Object.keys(normalizedPrograms).length + 1;

    for (let iteration = 0; iteration < remaining; iteration += 1) {
        moduleResolution = getModuleExportState({
            programs: normalizedPrograms,
            definitions,
            resolve
        });
        const { exports: resolvedExports = {} } = moduleResolution;
        moduleExports = resolvedExports;
        const nextDefinitions = Object.fromEntries(Object.entries(normalizedPrograms)
            .map(([fileName = '', program = {}] = []) => [
                fileName,
                canReuse(fileName)
                    ? previousDefinitions[fileName]
                    : getDefinitions(program, getImportedDefinitions({
                        fileName,
                        program,
                        moduleExports,
                        programs: normalizedPrograms,
                        resolve
                    }))
            ]));
        const changed = Object.entries(nextDefinitions)
            .some(([fileName = '', moduleDefinitions = {}] = []) => !areDefinitionSetsEqual(
                definitions[fileName] || {},
                moduleDefinitions
            ));
        definitions = nextDefinitions;
        if (!changed) break;
    }

    moduleResolution = getModuleExportState({
        programs: normalizedPrograms,
        definitions,
        resolve
    });
    const { exports: resolvedExports = {} } = moduleResolution;
    moduleExports = resolvedExports;
    const documents = Object.fromEntries(Object.entries(normalizedPrograms).map(([fileName = '', program = {}] = []) => {
        if (canReuse(fileName)) return [fileName, previousDocuments[fileName]];
        const importedDefinitions = getImportedDefinitions({
            fileName,
            program,
            moduleExports,
            programs: normalizedPrograms,
            resolve
        });
        return [fileName, createContractDocument(program, {
            fileName,
            externalDefinitions: importedDefinitions
        })];
    }));

    const getDocument = (fileName = '') => documents[normalizePath(fileName)] || {};
    const getDiagnostics = () => Object.entries(documents).flatMap(([fileName = '', document = {}] = []) => (
        document.getDiagnostics().map(diagnostic => ({ fileName, ...diagnostic }))
    ));
    const previousAgreements = previousGraph.agreements || {};
    const agreements = Object.fromEntries(Object.entries(normalizedPrograms).map(([fileName = '', program = {}] = []) => [
        fileName,
        canReuse(fileName) && Object.hasOwn(previousAgreements, fileName)
            ? previousAgreements[fileName]
            : getModuleAgreements({
                fileName,
                program,
                moduleExports,
                ambiguities: moduleResolution.ambiguities,
                programs: normalizedPrograms,
                resolve
            })
    ]));
    const getAgreements = () => Object.values(agreements).flat();

    return {
        agreements,
        documents,
        getAgreements,
        getDiagnostics,
        getDocument,
        moduleExports,
        programs,
        definitions
    };
};

export {
    createContractGraph,
    getImportBindings,
    getModuleAgreements,
    getModuleExports,
    getModuleSources,
    normalizePath,
    resolveModule
};
