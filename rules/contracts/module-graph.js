import { createContractDocument } from './document.js';
import {
    getDefinitions,
    getPropertyName,
    walk
} from './infer.js';
import { contract, isEqual } from './model.js';
import { getObject, hasObjectValue, isObject } from '../support/object.js';

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

    return candidates.find((candidate) => {
        const { [candidate]: program = false } = programs;

        return isObject(program);
    }) || '';
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
            const { name: localName = '' } = getObject(local);
            const importedNames = {
                ImportSpecifier: getPropertyName({ key: imported }),
                ImportDefaultSpecifier: 'default',
                ImportNamespaceSpecifier: '*'
            };
            const { [specifierType]: importedName = '' } = importedNames;

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
    const { [localName]: binding = {} } = imports;

    return binding;
};

const getModuleExportEntries = ({ program = {}, definitions = {} } = {}) => {
    let entries = {};
    let exportAllSources = [];
    const imports = getImportMap(program);

    const getLocalExportEntry = ({ exportName = '', localName = '' } = {}) => {
        if (!exportName || !localName) return {};

        const { [localName]: definition = false } = definitions;

        if (definition) {
            return {
                kind: 'definition',
                definition
            };
        }

        const binding = getImportBinding({ imports, localName });

        if (!hasObjectValue(binding)) return {};

        const {
            kind: bindingKind = '',
            importedName = '',
            source = ''
        } = getObject(binding);

        return {
            kind: bindingKind === 'namespace' ? 'namespace-reexport' : 'reexport',
            importedName,
            source
        };
    };

    const getLocalExportEntries = ({ exports = [] } = {}) => Object.fromEntries(
        (Array.isArray(exports) ? exports : []).flatMap(({ exportName = '', localName = '' } = {}) => {
            const entry = getLocalExportEntry({ exportName, localName });

            return hasObjectValue(entry) ? [[exportName, entry]] : [];
        })
    );

    const getNamedReexportEntries = ({ sourceValue = '', specifiers = [] } = {}) => Object.fromEntries(
        (Array.isArray(specifiers) ? specifiers : []).flatMap(({ local = {}, exported = {} } = {}) => {
            const importedName = getPropertyName({ key: local });
            const exportName = getPropertyName({ key: exported });

            if (!importedName || !exportName) return [];

            return [[exportName, {
                kind: 'reexport',
                importedName,
                source: sourceValue
            }]];
        })
    );

    const getNamedExportEntries = ({
        sourceValue = '',
        declarationType = '',
        declarationId = {},
        declarations = [],
        specifiers = []
    } = {}) => {
        if (sourceValue) return getNamedReexportEntries({ sourceValue, specifiers });

        if (declarationType === 'FunctionDeclaration') {
            const { name: idName = '' } = getObject(declarationId);

            return getLocalExportEntries({
                exports: [{
                    exportName: idName,
                    localName: idName
                }]
            });
        }

        if (declarationType === 'VariableDeclaration') {
            return getLocalExportEntries({
                exports: (Array.isArray(declarations) ? declarations : []).map(({ id: declarationId = {} } = {}) => {
                    const { name = '' } = getObject(declarationId);

                    return { exportName: name, localName: name };
                })
            });
        }

        return getLocalExportEntries({
            exports: (Array.isArray(specifiers) ? specifiers : []).map(({ local = {}, exported = {} } = {}) => ({
                exportName: getPropertyName({ key: exported }),
                localName: getPropertyName({ key: local })
            }))
        });
    };

    walk(program, ({
        type = '',
        declaration = {},
        source = {},
        specifiers = [],
        exported = {}
    } = {}) => {
        const {
            type: declarationType = '',
            id: declarationId = {},
            declarations = [],
            name: declarationName = ''
        } = getObject(declaration);
        const { value: sourceValue = '' } = getObject(source);

        if (type === 'ExportNamedDeclaration') {
            entries = {
                ...entries,
                ...getNamedExportEntries({
                    sourceValue,
                    declarationType,
                    declarationId,
                    declarations,
                    specifiers
                })
            };

            return;
        }

        if (type === 'ExportDefaultDeclaration') {
            const { name: idName = '' } = getObject(declarationId);
            const localName = idName || declarationName || (
                ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']
                    .includes(declarationType)
                    ? 'default'
                    : ''
            );
            const defaultEntries = getLocalExportEntries({
                exports: [{ exportName: 'default', localName }]
            });
            entries = { ...entries, ...defaultEntries };

            return;
        }

        if (type !== 'ExportAllDeclaration') return;

        if (!sourceValue) return;

        const { name: exportedName = '' } = getObject(exported);

        if (exportedName) {
            entries = { ...entries, [exportedName]: {
                kind: 'namespace-reexport',
                source: sourceValue
            } };

            return;
        }

        exportAllSources = [...exportAllSources, sourceValue];
    });

    return { entries, exportAllSources };
};

const getModuleExports = ({ program = {}, definitions = {} } = {}) => {
    const { entries = {} } = getModuleExportEntries({ program, definitions });

    return Object.fromEntries(Object.entries(entries)
        .filter(([, entry = {}] = []) => {
            const { kind = '' } = getObject(entry);

            return kind === 'definition';
        })
        .map(([name = '', entry = {}] = []) => {
            const { definition = {} } = getObject(entry);

            return [name, definition];
        }));
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

        const { [targetFile]: targetExports = {} } = moduleExports;

        if (kind === 'namespace') return [[localName, contract({
            kind: 'object',
            properties: targetExports
        })]];

        const { [importedName]: importedDefinition = false } = targetExports;

        if (!importedDefinition) return [];

        return [[localName, importedDefinition]];
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

    if (explicit.length === 1) {
        const [{ definition = {} } = {}] = explicit;

        return { definition };
    }

    if (candidates.length > 1) return { ambiguous: true };

    const [{ definition = {} } = {}] = candidates;

    return { definition };
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
        const { definition = {} } = getObject(entry);

        return addExportCandidate({
            candidates,
            name: exportName,
            definition,
            priority: 'explicit'
        });
    }

    const targetFile = resolve({ from: moduleName, source, programs });

    if (!targetFile) return candidates;

    const { [targetFile]: targetExports = {} } = resolved;

    if (kind === 'namespace-reexport') {
        return addExportCandidate({
            candidates,
            name: exportName,
            definition: getNamespaceContract(targetExports),
            priority: 'explicit'
        });
    }

    if (kind !== 'reexport') return candidates;

    const { [targetFile]: targetAmbiguities = {} } = ambiguities;
    const { [importedName]: ambiguity = false } = targetAmbiguities;
    const { [importedName]: importedDefinition = false } = targetExports;

    if (ambiguity || !importedDefinition) return candidates;

    return addExportCandidate({
        candidates,
        name: exportName,
        definition: importedDefinition,
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

    const { [targetFile]: targetExports = {} } = resolved;

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
    const { kind: leftKind = '' } = leftObject;
    const { kind: rightKind = '' } = rightObject;
    const leftNamespace = leftKind === 'object';
    const rightNamespace = rightKind === 'object';

    if (leftNamespace !== rightNamespace) return false;

    if (leftNamespace) {
        const { properties: leftProperties = {} } = leftObject;
        const { properties: rightProperties = {} } = rightObject;
        const safeLeftProperties = getObject(leftProperties);
        const safeRightProperties = getObject(rightProperties);
        const leftNames = Object.keys(safeLeftProperties);
        const rightNames = Object.keys(safeRightProperties);

        return leftNames.length === rightNames.length && leftNames.every((name) => {
            const { [name]: leftValue = {} } = safeLeftProperties;
            const { [name]: rightValue = false } = safeRightProperties;

            return !!rightValue && areExportValuesEqual(leftValue, rightValue);
        });
    }

    const { returnContract: leftReturnContract = {} } = leftObject;
    const { returnContract: rightReturnContract = {} } = rightObject;

    if (!hasObjectValue(leftReturnContract) || !hasObjectValue(rightReturnContract)) return left === right;

    return isEqual(leftReturnContract, rightReturnContract);
};

const areNameSetsEqual = (left = {}, right = {}) => {
    const leftNames = Object.keys(left);
    const rightNames = Object.keys(right);

    return leftNames.length === rightNames.length && leftNames.every((name) => {
        const { [name]: foundName = false } = right;

        return !!foundName;
    });
};

const getModuleExportState = ({
    programs = {},
    definitions = {},
    resolve = resolveModule
} = {}) => {
    const entries = Object.fromEntries(Object.entries(programs)
        .map(([fileName = '', program = {}] = []) => {
            const { [fileName]: fileDefinitions = {} } = definitions;

            return [fileName, getModuleExportEntries({
                program,
                definitions: fileDefinitions
            })];
        }));
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
                const { [fileName]: entryCandidates = {} } = candidatesByFile;
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
                const { [fileName]: entryCandidates = {} } = candidatesByFile;
                const nextCandidates = addExportAllCandidates({
                    fileName,
                    source,
                    candidates: entryCandidates,
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
                        const { ambiguous = false } = getObject(resolution);

                        if (ambiguous) {
                            return {
                                exports: currentExports,
                                ambiguities: { ...currentAmbiguities, [name]: true }
                            };
                        }

                        const { definition = {} } = resolution;

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
        const changed = Object.keys(programs).some((fileName) => {
            const { [fileName]: previousExports = {} } = resolved;
            const { [fileName]: nextExports = {} } = next;
            const { [fileName]: previousAmbiguities = {} } = ambiguities;
            const { [fileName]: nextFileAmbiguities = {} } = nextAmbiguities;

            return (
                !areExportValuesEqual(
                    { kind: 'object', properties: previousExports },
                    { kind: 'object', properties: nextExports }
                ) ||
            !areNameSetsEqual(previousAmbiguities, nextFileAmbiguities)
            );
        });
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

    const { [targetFile]: targetExports = {} } = moduleExports;
    const { [targetFile]: targetAmbiguities = {} } = ambiguities;

    if (kind === 'namespace') return {
        fileName,
        kind: 'resolved',
        localName,
        importedName,
        source,
        targetFile
    };

    const { [importedName]: ambiguity = false } = targetAmbiguities;
    const { [importedName]: targetExport = false } = targetExports;

    if (ambiguity) return {
        fileName,
        kind: 'ambiguous',
        localName,
        importedName,
        source,
        targetFile
    };

    if (!targetExport) return {
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

    return leftNames.length === rightNames.length && leftNames.every((name) => {
        const { [name]: leftDefinition = {} } = left;
        const { [name]: rightDefinition = false } = right;

        if (!rightDefinition) return false;

        const { returnContract: leftReturnContract = {} } = getObject(leftDefinition);
        const { returnContract: rightReturnContract = {} } = getObject(rightDefinition);

        return isEqual(leftReturnContract, rightReturnContract);
    });
};

const createContractGraph = ({
    programs = {},
    resolve = resolveModule,
    previousGraph = {},
    reusableFiles = []
} = {}) => {
    const normalizedPrograms = Object.fromEntries(Object.entries(programs)
        .map(([fileName = '', program = {}] = []) => [normalizePath(fileName), program]));
    const {
        definitions: previousDefinitions = {},
        documents: previousDocuments = {}
    } = getObject(previousGraph);
    const reusable = new Set(reusableFiles);
    const canReuse = (fileName = '') => {
        const { [fileName]: previousDefinition = false } = previousDefinitions;
        const { [fileName]: previousDocument = false } = previousDocuments;

        return reusable.has(fileName) && !!previousDefinition && !!previousDocument;
    };
    let definitions = Object.fromEntries(Object.entries(normalizedPrograms)
        .map(([fileName = '', program = {}] = []) => {
            const { [fileName]: priorDefinitions = {} } = previousDefinitions;

            return [
                fileName,
                canReuse(fileName) ? priorDefinitions : getDefinitions(program)
            ];
        }));
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
            .map(([fileName = '', program = {}] = []) => {
                const { [fileName]: priorDefinitions = {} } = previousDefinitions;

                return [
                    fileName,
                    canReuse(fileName)
                        ? priorDefinitions
                        : getDefinitions(program, getImportedDefinitions({
                            fileName,
                            program,
                            moduleExports,
                            programs: normalizedPrograms,
                            resolve
                        }))
                ];
            }));
        const changed = Object.entries(nextDefinitions)
            .some(([fileName = '', moduleDefinitions = {}] = []) => {
                const { [fileName]: currentDefinitions = {} } = definitions;

                return !areDefinitionSetsEqual(currentDefinitions, moduleDefinitions);
            });
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
        const { [fileName]: priorDocument = {} } = previousDocuments;

        if (canReuse(fileName)) return [fileName, priorDocument];

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

    const getDocument = (fileName = '') => {
        const { [normalizePath(fileName)]: document = {} } = documents;

        return document;
    };
    const getDiagnostics = () => Object.entries(documents).flatMap(([fileName = '', document = {}] = []) => (
        (() => {
            const { getDiagnostics: readDiagnostics = () => [] } = getObject(document);

            return readDiagnostics().map(diagnostic => ({ fileName, ...diagnostic }));
        })()
    ));
    const { agreements: previousAgreements = {} } = getObject(previousGraph);
    const { ambiguities: moduleAmbiguities = {} } = getObject(moduleResolution);
    const agreements = Object.fromEntries(Object.entries(normalizedPrograms).map(([fileName = '', program = {}] = []) => [
        fileName,
        (() => {
            const { [fileName]: priorAgreements = false } = previousAgreements;

            return canReuse(fileName) && priorAgreements
                ? priorAgreements
                : getModuleAgreements({
                    fileName,
                    program,
                    moduleExports,
                    ambiguities: moduleAmbiguities,
                    programs: normalizedPrograms,
                    resolve
                });
        })()
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
