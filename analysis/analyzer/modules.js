import { parse } from 'espree';

import { append, put, retain } from '../collections.js';
import { traverse } from '../traversal.js';
import { indexBindings } from './bindings.js';
import { patternNames } from './traversal.js';

const specifierName = ({ type = '', name = '', value = '' } = {}) => type === 'Identifier' ? name : value;

// The host supplies source snapshots, never evaluated exports or inferred facts.
// Each root session acquires a module once; a later session starts afresh.
// The optional resolver is guarded; absence preserves unresolved imports without fabricating source.
export const indexModules = ({ program = {}, filename = '', roots = [], resolveModule, operations = new Map() } = {}) => {
    const registry = { identities: new WeakMap(), callableResolutions: new WeakMap(), executionOf: new WeakMap(), parents: new WeakMap(),
        writes: new Set(), opaqueExecutions: new Set(), opaqueCapabilities: new Set(), executionParents: new Map(), initializerFacts: new WeakMap(),
        previousStatements: new WeakMap(), nextStatements: new WeakMap(), operators: new WeakMap(), dynamicExecutions: new Set(), effects: new Map(),
        argumentOwners: new Map(), controlExecutions: new Set() };
    const records = [];
    const moduleOfExecution = new Map();
    const sources = new Map();
    const seen = new Set();
    const offsets = new Map([['bindings', 0], ['functions', 0]]);
    const recordFor = (path, tree) => sources.get(path) || put(sources, path, { id: sources.size, filename: path, program: tree, links: new Map(), exports: new Map() });
    const root = recordFor(filename, program);
    const acquire = (supplied) => {
        if (!supplied) return [];

        const { available = true, filename: target = '', source = false } = supplied;

        if (!available) return [];

        if (typeof target !== 'string' || !target || typeof source !== 'string') throw new TypeError('Expected a module filename and JavaScript source snapshot');

        return [sources.get(target) || recordFor(target, parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true, ecmaFeatures: { jsx: true } }))];
    };

    if (!Array.isArray(roots)) throw new TypeError('Expected analysis root source snapshots');

    const selected = [root, ...roots.flatMap(acquire)];

    selected.forEach(root => traverse(root, { enter: (record) => {
        if (seen.has(record)) return [];

        retain(seen, record);
        const { filename: from = '', program: tree = {}, links = new Map() } = record;
        const index = indexBindings({ program: tree, operations, registry, bindingOffset: offsets.get('bindings'), functionOffset: offsets.get('functions') });
        const { bindings = [], functionEntries = [], rootExecution = false } = index;

        [rootExecution, ...functionEntries.map(({ execution = false } = {}) => execution)].forEach(execution => put(moduleOfExecution, execution, from));

        put(offsets, 'bindings', offsets.get('bindings') + bindings.length);
        put(offsets, 'functions', offsets.get('functions') + functionEntries.length);
        append(records, { ...record, index });
        const { body = [] } = tree;

        if (typeof resolveModule !== 'function') return [];

        return body.flatMap(({ type = '', source: specifier = false } = {}) => {
            const { value = '' } = specifier ? specifier : {};

            if (!['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(type) || !value) return [];

            const [dependency = false] = acquire(resolveModule({ from, source: value }));

            if (!dependency) return [];

            put(links, value, dependency);

            return [dependency];
        });
    } }));
    const importTargets = new Map();
    const imported = [];
    const namespaces = new Map();
    const namespaceFor = (module) => {
        const { filename = '', program: { body = [] } = {} } = module;

        return namespaces.get(module) || put(namespaces, module, { namespace: true, module: filename, fields: new Map(),
            open: body.some(({ type = '', exported = false } = {}) => type === 'ExportAllDeclaration' && !exported) });
    };

    records.forEach(({ program: { body = [] } = {}, links = new Map(), exports = new Map(), index: { rootBindings: locals = new Map() } = {} } = {}) => {
        body.forEach(({ type = '', declaration: declared = false, specifiers = [], source: specifier = false, exported = false } = {}) => {
            const { value: source = '' } = specifier ? specifier : {};
            const declaration = declared ?? {};
            const dependency = links.get(source);

            if (type === 'ImportDeclaration') {
                specifiers.forEach(({ type: kind = '', local: { name = '' } = {}, imported: selected = {} } = {}) => {
                    if (!dependency) return;

                    const importedName = kind === 'ImportDefaultSpecifier' ? 'default' : specifierName(selected);

                    append(imported, { binding: locals.get(name), module: dependency, name: kind === 'ImportNamespaceSpecifier' ? '*' : importedName });
                });

                return;
            }

            if (type === 'ExportDefaultDeclaration') {
                const { type: kind = '', name = '', id = false } = declaration;

                const liveName = kind === 'Identifier' ? name : kind === 'FunctionDeclaration' && id && specifierName(id);

                put(exports, 'default', { target: liveName ? locals.get(liveName) : declaration });

                return;
            }

            if (type === 'ExportAllDeclaration' && exported) {
                put(exports, specifierName(exported), { target: dependency && namespaceFor(dependency) });

                return;
            }

            if (type !== 'ExportNamedDeclaration') return;

            const { declarations = [], id: { name = '' } = {} } = declaration;

            [...declarations.flatMap(({ id = {} } = {}) => patternNames(id)), ...(name ? [name] : [])]
                .forEach(local => put(exports, local, { target: locals.get(local) }));
            specifiers.forEach(({ local = {}, exported = {} } = {}) => {
                const name = specifierName(local);

                put(exports, specifierName(exported), source ? { module: dependency, name } : { target: locals.get(name) });
            });
        });
    });
    const resolved = new Map();
    const exportKey = ({ module: { id = -1 } = {}, name = '' } = {}) => `${id}:${name}`;
    const exportFor = (requested) => {
        const visited = new Set();
        const definition = ({ module = {}, name = '' } = {}) => {
            const { exports = new Map() } = module;

            return name === '*' ? { target: namespaceFor(module) } : exports.get(name) ?? {};
        };

        traverse(requested, { enter: (entry) => {
            const key = exportKey(entry);

            if (resolved.has(key) || visited.has(key)) return [];

            retain(visited, key);
            const { module = false } = definition(entry);

            return module ? [definition(entry)] : [];
        }, leave: (entry) => {
            const key = exportKey(entry);

            if (resolved.has(key)) return;

            const target = definition(entry);
            const { target: binding = false, module = false } = target;

            put(resolved, key, binding || (module && resolved.get(exportKey(target))) || false);
        } });

        return resolved.get(exportKey(requested));
    };

    imported.forEach(({ binding = false, ...entry } = {}) => {
        const target = exportFor(entry);

        if (binding && target) put(importTargets, binding, target);
    });
    namespaces.forEach(({ fields = new Map() } = {}, module) => {
        const { exports = new Map() } = module;

        exports.forEach((value, name) => put(fields, name, exportFor({ module, name })));
    });
    const [{ index: main = {} } = {}] = records;
    const { functionEntries: ownFunctions = [] } = main;
    const counts = records.reduce((totals, { index: { counts = {} } = {} } = {}) => Object.fromEntries(Object.entries(counts).map(([name = '', count = 0] = []) => {
        const { [name]: previous = 0 } = totals;

        return [name, previous + count];
    })), {});

    return { ...main, ...registry, importTargets, moduleOfExecution, counts: { ...counts, modules: records.length }, ownFunctionCount: ownFunctions.length,
        moduleEntries: records.map(({ filename = '', program = {}, links = new Map(), index: { rootExecution = false } = {} } = {}) => ({
            filename, program, execution: rootExecution, dependencies: [...new Set([...links.values()].map(({ filename = '' } = {}) => filename))]
        })),
        initializerNames: new Map(records.flatMap(({ index: { initializerNames = new Map() } = {} } = {}) => [...initializerNames])),
        sourceMembers: records.flatMap(({ index: { memberAccesses = [] } = {} } = {}) => memberAccesses),
        sourcePatterns: records.flatMap(({ index: { destructurings = [] } = {} } = {}) => destructurings),
        sourceCalls: records.flatMap(({ index: { calls = [] } = {} } = {}) => calls),
        bindings: records.flatMap(({ index: { bindings = [] } = {} } = {}) => bindings),
        functionEntries: records.flatMap(({ index: { functionEntries = [] } = {} } = {}) => functionEntries),
        references: records.flatMap(({ index: { references = [] } = {} } = {}) => references) };
};
