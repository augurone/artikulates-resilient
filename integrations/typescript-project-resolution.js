import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import typescript from 'typescript';

const owningPackage = (location = '') => {
    let directory = location;

    if (existsSync(directory) && !lstatSync(directory).isDirectory()) directory = path.dirname(directory);

    // Walk package scopes upward until the filesystem root.
    // eslint-disable-next-line resilient/prefer-prototype-methods -- The lookup stops at the first owning package or filesystem root.
    while (true) {
        const candidate = path.join(directory, 'package.json');

        if (existsSync(candidate)) return { path: candidate, type: JSON.parse(readFileSync(candidate, 'utf8')).type || '' };

        const parent = path.dirname(directory);

        if (parent === directory) return { path: '', type: '' };

        directory = parent;
    }
};
const outputName = name => name.replace(/\.tsx?$/u, '.js');
const assertEsmModule = (file = '') => {
    const { type = '' } = owningPackage(file);

    if (!file.endsWith('.js') || type !== 'module') throw new Error(`Project executable inputs require .js and type: module package scopes: ${file}`);
};
const requestKey = (importer, specifier) => JSON.stringify([importer, specifier]);
const runExtension = ({ provider = '', eslintConfig = '', projectRoot = '', requests = [], proof = false, timeout = 0 } = {}) => {
    if (!provider && !eslintConfig) return { results: [], inputs: [], proof: {} };

    [provider, eslintConfig].filter(Boolean).forEach(assertEsmModule);
    const temporary = mkdtempSync(path.join(tmpdir(), 'resilient-project-extension-'));
    const input = path.join(temporary, 'input.json');
    const output = path.join(temporary, 'output.json');
    const trace = path.join(temporary, 'trace.jsonl');

    try {
        writeFileSync(input, JSON.stringify({ provider, eslintConfig, projectRoot, requests, proof }));
        writeFileSync(trace, '');
        const { execPath = '', env = {} } = process;
        const { status = 0, stderr = '' } = spawnSync(execPath, ['--experimental-loader', fileURLToPath(new URL('./project-input-loader.js', import.meta.url)),
            fileURLToPath(new URL('./project-extension-worker.js', import.meta.url)), input, output], {
            cwd: projectRoot, env: { ...env, RESILIENT_INPUT_TRACE: trace, RESILIENT_INPUT_ROOT: projectRoot }, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
            ...(timeout ? { timeout, killSignal: 'SIGKILL' } : {})
        });

        if (status !== 0 || !existsSync(output)) throw new Error(`Project extension failed: ${stderr}`);

        const result = JSON.parse(readFileSync(output, 'utf8'));
        const { error = '', inputs = [] } = result;

        if (error) throw new Error(`Project extension failed: ${error}`);

        const traced = readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);

        const loadedInputs = [provider, eslintConfig, ...traced, ...inputs].filter(Boolean);
        const packageInputs = loadedInputs.map(owningPackage).map(({ path: file = '' } = {}) => file).filter(Boolean);

        return { ...result, inputs: [...new Set([...loadedInputs, ...packageInputs])].toSorted() };
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
};
const importNode = (node = {}, fileName = '') => {
    const { moduleSpecifier = false, moduleReference = {}, expression = {}, arguments: argumentsList = [], pos = 0 } = node;
    const { expression: reference = false } = moduleReference;
    const { kind = 0 } = expression;
    const [argument = {}] = argumentsList;

    if ((typescript.isImportDeclaration(node) || typescript.isExportDeclaration(node)) && moduleSpecifier &&
        typescript.isStringLiteralLike(moduleSpecifier)) return moduleSpecifier;

    if (typescript.isImportEqualsDeclaration(node) && typescript.isExternalModuleReference(moduleReference) && reference) return reference;

    if (!typescript.isCallExpression(node) || kind !== typescript.SyntaxKind.ImportKeyword) return false;

    if (!typescript.isStringLiteralLike(argument)) throw new Error(`Nonliteral dynamic import cannot be routed: ${fileName}:${pos}`);

    return argument;
};
const importNodes = (sourceFile = {}) => {
    const { fileName = '' } = sourceFile;
    let result = [];
    const visit = (node) => {
        const selected = importNode(node, fileName);

        if (selected) result = [...result, selected];

        typescript.forEachChild(node, visit);
    };

    visit(sourceFile);

    return result;
};
const normalizeRoute = ({ context = {}, custom = {}, options = {}, projectRoot = '' } = {}) => {
    const { importer = '', specifier = '', typescriptResolution: fallback = false } = context;

    if (!custom) return { owner: 'typescript', resolved: fallback };

    const { kind = '', source = '', specifier: external = '', runtime = {} } = custom;
    const { owner: contractOwner = '', reason = '' } = runtime;
    const owner = kind === 'eslint' ? 'eslint' : 'provider';

    if (typeof custom !== 'object' || !['source', 'eslint', 'external', 'virtual'].includes(kind)) {
        throw new Error(`Invalid provider route for ${specifier}; expected source identity or explicit runtime contract.`);
    }

    if (['external', 'virtual'].includes(kind) && (typeof external !== 'string' || !external || /^(?:\.|\/|[a-z]+:)/iu.test(external) ||
        typeof contractOwner !== 'string' || !contractOwner || typeof reason !== 'string' || !reason)) {
        throw new Error(`External/virtual route requires a bare specifier and runtime { owner, reason }: ${specifier}`);
    }

    if (['external', 'virtual'].includes(kind)) return { owner, external, contract: runtime, resolved: fallback };

    if (typeof source !== 'string' || !source) throw new Error(`Provider source identity is missing: ${specifier}`);

    const target = path.resolve(projectRoot, source);
    const relative = path.relative(path.dirname(importer), target).split(path.sep).join('/');
    const request = relative.startsWith('.') ? relative : `./${relative}`;
    const { resolvedModule = {} } = typescript.resolveModuleName(request, importer, options, typescript.sys);
    const { resolvedFileName = '' } = resolvedModule;
    const defaultResolution = fallback ? fallback : {};
    const { resolvedFileName: defaultSource = '' } = defaultResolution;

    if (!resolvedFileName || /\.d\.[cm]?ts$/u.test(resolvedFileName)) throw new Error(`Project resolver did not identify executable TypeScript source: ${target}`);

    const candidates = [target.replace(/\.js$/u, '.ts'), target.replace(/\.js$/u, '.tsx')];

    if (new Set(candidates.filter(existsSync)).size > 1) throw new Error(`Ambiguous project resolver source: ${target}`);

    if (defaultSource && path.resolve(defaultSource) !== path.resolve(resolvedFileName)) throw new Error(`Project resolver disagrees with TypeScript for ${specifier}`);

    return { owner, resolved: { ...resolvedModule, resolvedUsingTsExtension: /\.tsx?$/u.test(specifier) } };
};
const runtimeImportNode = ({ parent = {} } = {}) => {
    const { isTypeOnly = false, importClause = {} } = parent;
    const selectedClause = importClause ? importClause : {};
    const { isTypeOnly: clauseTypeOnly = false, namedBindings = {}, name = '' } = selectedClause;
    const selectedBindings = namedBindings ? namedBindings : {};
    const { elements = [] } = selectedBindings;
    const namesOnlyType = elements.length && elements.every(({ isTypeOnly: typeOnly = false } = {}) => typeOnly);

    return !isTypeOnly && !clauseTypeOnly && (name || !namesOnlyType);
};
const createResolution = ({ fileNames = [], selected = fileNames, options = {}, projectRoot = '', outDir = '', provider = '', eslintConfig = '', timeout = 0 } = {}) => {
    const { rootDir = projectRoot, target = typescript.ScriptTarget.Latest } = options;
    const sourceOutputMap = Object.fromEntries(fileNames.filter(name => /\.tsx?$/u.test(name) && !/\.d\.ts$/u.test(name))
        .map(name => [name, path.join(outDir, outputName(path.relative(rootDir, name)))]));
    let requests = [];
    let entries = [];
    let inputs = [];
    let pending = selected;
    const visited = new Set();

    // eslint-disable-next-line resilient/prefer-prototype-methods -- Source identities discovered by a provider extend this bounded work queue until closure.
    while (pending.length) {
        const batch = pending.filter(name => !visited.has(name) && !/\.d\.[cm]?ts$/u.test(name));
        // eslint-disable-next-line resilient/prefer-safe-transformations -- The visited set prevents import cycles from rerunning executable project hooks.
        batch.forEach(name => visited.add(name));
        const nextRequests = batch.flatMap((name) => {
            const source = typescript.createSourceFile(name, readFileSync(name, 'utf8'), target, true);
            // eslint-disable-next-line resilient/prefer-safe-transformations -- The compiler usage-mode API reads this package-derived format from the parsed SourceFile identity.
            Object.assign(source, { impliedNodeFormat: typescript.getImpliedNodeFormatForFile(name, undefined, typescript.sys, options) });

            return importNodes(source).map((node) => {
                const { text = '' } = node;
                const mode = typescript.getModeForUsageLocation(source, node, options);
                const { resolvedModule = false, affectingLocations = [] } = typescript.resolveModuleName(text, name, options, typescript.sys, undefined, undefined, mode);

                return { importer: name, specifier: text, typescriptResolution: resolvedModule, runtime: !!runtimeImportNode(node),
                    sourceOutputMap, projectRoot, packageScope: owningPackage(name), resolutionInputs: affectingLocations.filter(existsSync) };
            });
        });
        const { results = [], inputs: extensionInputs = [] } = runExtension({ provider, eslintConfig, projectRoot, requests: nextRequests, timeout });
        const nextEntries = nextRequests.map((context, index) => {
            const { importer = '', specifier = '' } = context;
            const { [index]: custom = false } = results;

            return [requestKey(importer, specifier), normalizeRoute({ context, custom, options, projectRoot })];
        });
        pending = nextEntries.flatMap(([, { resolved = {}, external = '' } = {}] = [], index) => {
            const selectedResolution = resolved ? resolved : {};
            const { resolvedFileName = '' } = selectedResolution;
            const { [index]: { runtime = false } = {} } = nextRequests;

            return runtime && !external && resolvedFileName && !resolvedFileName.includes(`${path.sep}node_modules${path.sep}`) &&
                /\.tsx?$/u.test(resolvedFileName) && !visited.has(resolvedFileName) ? [resolvedFileName] : [];
        });
        requests = [...requests, ...nextRequests];
        entries = [...entries, ...nextEntries];
        inputs = [...new Set([...inputs, ...extensionInputs, ...nextRequests.flatMap(({ resolutionInputs = [] } = {}) => resolutionInputs)])];
    }

    const routes = new Map(entries);
    const resolve = (specifier, importer) => {
        const route = routes.get(requestKey(importer, specifier));

        if (route) return route;

        const { resolvedModule = false } = typescript.resolveModuleName(specifier, importer, options, typescript.sys);

        return { owner: 'typescript', resolved: resolvedModule };
    };

    return { resolve, inputs, requests };
};
const rewriteImports = (code, fileName, routes) => {
    const source = typescript.createSourceFile(fileName, code, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.JS);
    const edits = importNodes(source).flatMap((node) => {
        // The original compiler node remains the receiver for getStart below.
        const { text = '', end = 0 } = node;
        const route = routes.find(({ importer = '', specifier = '' } = {}) => importer === fileName && specifier === text) || {};
        const { runtimeSpecifier = text } = route;

        if (runtimeSpecifier === text) return [];

        const start = node.getStart(source);
        const { [start]: quote = '' } = code;

        return [{ start: start + 1, end: end - 1, text: runtimeSpecifier.replaceAll('\\', '\\\\').replaceAll(quote, `\\${quote}`) }];
    });

    return edits.toSorted(({ start: left = 0 } = {}, { start: right = 0 } = {}) => right - left)
        .reduce((text, { start = 0, end = 0, text: replacement = '' } = {}) => text.slice(0, start) + replacement + text.slice(end), code);
};

export { assertEsmModule, createResolution, importNodes, outputName, rewriteImports, runExtension, owningPackage };
