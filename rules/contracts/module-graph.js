import { createContractDocument } from './document.js';
import {
    getDefinitions,
    getPropertyName,
    walk
} from './infer.js';

const normalizePath = (value = '') => value
    .replaceAll('\\', '/')
    .split('/')
    .reduce((parts = [], segment = '') => {
        if (!segment || segment === '.') return parts;
        if (segment === '..') return parts.slice(0, -1);
        return [...parts, segment];
    }, [])
    .join('/');

const getDirectory = (fileName = '') => {
    const normalized = normalizePath(fileName);
    const separator = normalized.lastIndexOf('/');
    return separator >= 0 ? normalized.slice(0, separator) : '';
};

const resolveModule = ({ from = '', source = '', programs = {} } = {}) => {
    if (!source.startsWith('.')) return '';
    const directory = getDirectory(from);
    const base = normalizePath(`${directory}/${source}`);
    const candidates = [base, `${base}.js`, `${base}.jsx`, `${base}/index.js`];
    return candidates.find(candidate => programs[candidate]) || '';
};

const getModuleSources = (program = {}) => {
    const sources = [];
    walk(program, ({ type = '', source = {} } = {}) => {
        if (type !== 'ImportDeclaration') return;
        const { value = '' } = source;
        if (value) sources.push(value);
    });
    return [...new Set(sources)];
};

const getImportBindings = (program = {}) => {
    const bindings = [];
    walk(program, ({ type = '', source = {}, specifiers = [] } = {}) => {
        if (type !== 'ImportDeclaration') return;
        const { value: sourceValue = '' } = source;
        specifiers.forEach(({
            type: specifierType = '',
            local = {},
            imported = {}
        } = {}) => {
            const { name: localName = '' } = local;
            const importedNames = {
                ImportSpecifier: getPropertyName({ key: imported }),
                ImportDefaultSpecifier: 'default'
            };
            const importedName = importedNames[specifierType] || '';
            if (!sourceValue || !localName || !importedName) return;
            bindings.push({ localName, importedName, source: sourceValue });
        });
    });
    return bindings;
};

const addExport = ({ exports = {}, definitions = {}, name = '', exportName = name } = {}) => {
    if (!name || !Object.hasOwn(definitions, name)) return;
    const { [name]: definition = null } = definitions;
    if (!definition || typeof definition !== 'object') return;
    exports[exportName] = definition;
};

const addExportDeclaration = ({ exports = {}, declaration = {}, definitions = {} } = {}) => {
    const sourceDeclaration = declaration && typeof declaration === 'object'
        ? declaration
        : {};
    const { type = '', id = {}, declarations = [] } = sourceDeclaration;
    if (type === 'FunctionDeclaration') {
        const { name = '' } = id;
        addExport({ exports, definitions, name });
        return;
    }
    if (type !== 'VariableDeclaration') return;
    declarations.forEach(({ id: { name = '' } = {} } = {}) => addExport({
        exports,
        definitions,
        name
    }));
};

const getModuleExports = ({ program = {}, definitions = {} } = {}) => {
    const exports = {};
    walk(program, ({ type = '', declaration = {}, specifiers = [] } = {}) => {
        if (type === 'ExportNamedDeclaration') {
            addExportDeclaration({ exports, declaration, definitions });
            specifiers.forEach(({ local = {}, exported = {} } = {}) => {
                const { name: localName = '' } = local;
                const exportName = getPropertyName({ key: exported });
                if (!localName || !exportName) return;
                addExport({ exports, definitions, name: localName, exportName });
            });
            return;
        }
        if (type !== 'ExportDefaultDeclaration') return;
        const { id = {} } = declaration;
        addExport({ exports, definitions, name: id.name, exportName: 'default' });
    });
    return exports;
};

const createContractGraph = ({ programs = {}, resolve = resolveModule } = {}) => {
    const normalizedPrograms = Object.fromEntries(Object.entries(programs)
        .map(([fileName = '', program = {}] = []) => [normalizePath(fileName), program]));
    const localDefinitions = Object.fromEntries(Object.entries(normalizedPrograms)
        .map(([fileName = '', program = {}] = []) => [fileName, getDefinitions(program)]));
    const moduleExports = Object.fromEntries(Object.entries(normalizedPrograms)
        .map(([fileName = '', program = {}] = []) => [
            fileName,
            getModuleExports({ program, definitions: localDefinitions[fileName] })
        ]));

    const documents = Object.fromEntries(Object.entries(normalizedPrograms).map(([fileName = '', program = {}] = []) => {
        const importedDefinitions = {};
        getImportBindings(program).forEach(({ localName = '', importedName = '', source = '' } = {}) => {
            const targetFile = resolve({ from: fileName, source, programs: normalizedPrograms });
            const targetExports = moduleExports[targetFile] || {};
            if (!Object.hasOwn(targetExports, importedName)) return;
            const { [importedName]: definition = null } = targetExports;
            if (definition) importedDefinitions[localName] = definition;
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

    return {
        documents,
        getDiagnostics,
        getDocument,
        moduleExports,
        programs
    };
};

export {
    createContractGraph,
    getImportBindings,
    getModuleExports,
    getModuleSources,
    normalizePath,
    resolveModule
};
