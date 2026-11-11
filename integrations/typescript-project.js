import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

import typescript from 'typescript';

import { validateManifest } from './typescript-project-artifacts.js';
import { assertEsmModule, createResolution, outputName, owningPackage, rewriteImports } from './typescript-project-resolution.js';

const portableStandard = Object.freeze({
    object: 'eslint-plugin-resilient/standard/object',
    array: 'eslint-plugin-resilient/standard/array',
    function: 'eslint-plugin-resilient/standard/function'
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pathKey = file => process.platform === 'win32' || process.platform === 'darwin' ? file.toLowerCase() : file;
const isInside = (parent = '', child = '') => {
    const relative = path.relative(pathKey(parent), pathKey(child));

    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};
const resolvePhysicalPath = (file = '') => {
    const absolute = path.resolve(file);

    if (existsSync(absolute)) return realpathSync(absolute);

    return path.join(resolvePhysicalPath(path.dirname(absolute)), path.basename(absolute));
};
const resolveProject = (project = '') => {
    const location = path.resolve(project);

    if (!existsSync(location)) throw new Error(`TypeScript project does not exist: ${location}`);

    const stats = lstatSync(location);

    if (!stats.isDirectory() && !stats.isFile()) {
        throw new Error(`TypeScript project must be a directory or tsconfig file: ${location}`);
    }

    if (stats.isFile()) return location;

    const direct = path.join(location, 'tsconfig.json');
    const candidates = [];
    const visit = (directory) => {
        // Directory entries expose prototype methods that require their receiver.
        // eslint-disable-next-line resilient/prefer-prototype-methods -- Dirent prototype methods need their receiver during recursive discovery.
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const { name = '' } = entry;
            const child = path.join(directory, name);

            if (entry.isSymbolicLink()) continue;

            if (entry.isFile() && /^tsconfig(?:\.[^/]+)?\.json$/u.test(name)) {
                // Discovery accumulates all candidates so ambiguity can be reported.
                // eslint-disable-next-line resilient/prefer-safe-transformations -- Candidate discovery accumulates every matching config for ambiguity reporting.
                candidates.push(child);
            }

            if (entry.isDirectory() && !['node_modules', '.git', 'dist', 'build', '.resilient'].includes(name)) visit(child);
        }
    };

    visit(location);

    let directHasSources = false;

    if (existsSync(direct)) {
        const loaded = typescript.readConfigFile(direct, typescript.sys.readFile);
        const { config = {} } = loaded;
        const parsed = typescript.parseJsonConfigFileContent(config, typescript.sys, location, undefined, direct);
        const { fileNames = [] } = parsed;

        const [onlyCandidate = ''] = candidates;

        directHasSources = Boolean(fileNames.length || candidates.length === 1 && onlyCandidate === direct);
    }

    if (directHasSources) return direct;

    if (candidates.length) throw new Error(`Ambiguous TypeScript project directory ${location}; pass an explicit config path. Candidates:\n${candidates.toSorted().join('\n')}`);

    throw new Error(`No tsconfig file found in ${location}. Pass an explicit config path.`);
};
const getConfig = (project = '') => {
    let configFiles = [];
    const host = { ...typescript.sys, readFile: (file) => {
        configFiles = [...configFiles, file];

        return typescript.sys.readFile(file);
    } };
    const { readFile } = host;
    const loaded = typescript.readConfigFile(project, readFile);
    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Compiler diagnostics and config retain absence; parseJsonConfigFileContent owns malformed config failure.
    const { error, config } = loaded;

    if (error) return { diagnostics: [error] };

    const parsed = typescript.parseJsonConfigFileContent(config, host, path.dirname(project), undefined, project);
    const { errors = [] } = parsed;

    return { loaded, parsed, configFiles, diagnostics: errors };
};
const assertSafeOutput = ({ project = '', outDir = '', report = '', manifest = '', artifactRoot = '', files = [] } = {}) => {
    const physicalOutput = resolvePhysicalPath(outDir);
    const inputPaths = [project, ...files].map(file => path.resolve(file));
    const inputs = inputPaths.map(file => resolvePhysicalPath(file));

    if (inputPaths.some(file => isInside(outDir, file)) || inputs.some(file => isInside(physicalOutput, file))) {
        throw new Error('The output directory may not overlap a project input file.');
    }

    [['report', report], ['manifest', manifest]].forEach(([label = '', sidecar = '']) => {
        if (sidecar && inputs.some(file => pathKey(file) === pathKey(resolvePhysicalPath(sidecar)))) {
            throw new Error(`The ${label} may not replace a project input file.`);
        }
    });

    if (!manifest) return;

    const physicalManifest = resolvePhysicalPath(manifest);
    const physicalArtifacts = resolvePhysicalPath(artifactRoot);

    if (isInside(physicalOutput, physicalManifest) || isInside(physicalOutput, physicalArtifacts) ||
        isInside(physicalArtifacts, physicalOutput) || isInside(physicalArtifacts, physicalManifest) ||
        isInside(physicalManifest, physicalArtifacts) ||
        (report && isInside(physicalOutput, resolvePhysicalPath(report))) ||
        (report && (pathKey(physicalManifest) === pathKey(resolvePhysicalPath(report)) ||
            isInside(physicalArtifacts, resolvePhysicalPath(report))))) {
        throw new Error('The manifest, artifact root, report and output tree must be separate.');
    }

    if (inputs.some(file => isInside(physicalArtifacts, file) || isInside(file, physicalArtifacts))) {
        throw new Error('The artifact root may not overlap a project input file.');
    }
};
const getStandard = (custom, project = '') => {
    // eslint-disable-next-line resilient/no-undefined-comparison -- Omission selects portable defaults; null is a malformed supplied binding.
    if (custom === undefined) return portableStandard;

    if (!custom || typeof custom !== 'object' || Array.isArray(custom)) {
        throw new Error('resilient.standard must be an object of helper specifiers.');
    }

    const bindings = Object.entries(custom).reduce((current, [key = '', value = ''] = []) => {
        if (!Object.hasOwn(portableStandard, key) || typeof value !== 'string' || !value.trim()) {
            throw new Error(`Invalid resilient.standard helper binding: ${key}`);
        }

        if (/^[a-z][a-z\d+.-]*:/iu.test(value)) throw new Error(`Helper URLs are unsupported: ${key}`);

        let file = '';

        if (path.isAbsolute(value)) file = value;

        if (!file && /^\.\.?[/\\]/u.test(value)) file = path.resolve(path.dirname(project), value);

        if (file && !existsSync(file)) throw new Error(`Helper binding does not exist: ${file}`);

        return { ...current, [key]: file || value };
    }, portableStandard);

    return Object.freeze(bindings);
};
const getResilientConfig = (selected) => {
    // eslint-disable-next-line resilient/no-undefined-comparison -- An omitted custom node selects the default source scope and helper bindings.
    if (selected === undefined) return {};

    if (!selected || typeof selected !== 'object' || Array.isArray(selected)) {
        throw new Error('resilient must be an object with optional emit and standard fields.');
    }

    const unknown = Object.keys(selected).filter(key => !['emit', 'standard'].includes(key));

    const [firstUnknown = ''] = unknown;

    if (firstUnknown) throw new Error(`Unknown resilient configuration field: ${firstUnknown}`);

    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Presence is checked separately: an explicitly supplied undefined emit value must fail configuration validation.
    const { emit } = selected;

    if (Object.hasOwn(selected, 'emit') && (!Array.isArray(emit) ||
        emit.some(value => typeof value !== 'string' || !value.trim()))) {
        throw new Error('resilient.emit must be an array of nonempty TypeScript include patterns.');
    }

    return selected;
};
const readOptionalProjectConfig = (project = '') => {
    const file = path.join(path.dirname(project), 'resilient.project.json');

    if (!existsSync(file)) return { file: '', config: {} };

    const selected = JSON.parse(readFileSync(file, 'utf8'));

    if (!selected || typeof selected !== 'object' || Array.isArray(selected)) {
        throw new Error(`Invalid Resilient project configuration: ${file}. Expected schemaVersion 1.`);
    }

    const { schemaVersion = 0, proof = false, ...lowering } = selected;

    if (![1, 2].includes(schemaVersion) ||
        Object.keys(selected).some(key => !['schemaVersion', 'emit', 'standard', 'proof', ...(schemaVersion === 2 ? ['provider', 'resolution'] : [])].includes(key))) {
        throw new Error(`Invalid Resilient project configuration: ${file}. Expected schemaVersion 1.`);
    }

    const { provider = '', resolution = {}, ...loweringConfig } = lowering;

    if (provider && (typeof provider !== 'string' || !existsSync(path.resolve(path.dirname(project), provider)))) {
        throw new Error('Project provider must name an existing file.');
    }

    const { eslintConfig: resolutionConfigFile = '' } = resolution;

    if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution) ||
        Object.keys(resolution).some(key => key !== 'eslintConfig') ||
        resolutionConfigFile && typeof resolutionConfigFile !== 'string') throw new Error('Invalid project resolution; expected { eslintConfig }.');

    getResilientConfig(loweringConfig);

    const { standard = false } = lowering;

    if (Object.hasOwn(lowering, 'standard')) getStandard(standard, project);

    if (Object.hasOwn(selected, 'proof') && (!proof || typeof proof !== 'object' || Array.isArray(proof) ||
        Object.keys(proof).some(key => !['tests', 'vitestConfig', ...(schemaVersion === 2 ? ['runner', 'resources', 'dependencies', 'env', 'inheritEnv'] : [])].includes(key)))) {
        throw new Error('resilient.project.json proof must contain only tests and vitestConfig.');
    }

    const proofDetails = proof || {};
    const { tests = false, vitestConfig = false } = proofDetails;
    const testDetails = tests || {};
    const { include = false, exclude = false } = testDetails;

    if (proof && Object.hasOwn(proof, 'tests') && (!tests || typeof tests !== 'object' ||
        Array.isArray(tests) || !Array.isArray(include) ||
        include.some(value => typeof value !== 'string' || !value.trim()) ||
        exclude && (!Array.isArray(exclude) ||
            exclude.some(value => typeof value !== 'string' || !value.trim())))) {
        throw new Error('resilient.project.json proof.tests requires include patterns and optional exclude patterns.');
    }

    if (vitestConfig && typeof vitestConfig !== 'string') {
        throw new Error('resilient.project.json proof.vitestConfig must be a file path.');
    }

    return { file, config: selected };
};
const hasJsx = (node) => {
    if (typescript.isJsxElement(node) || typescript.isJsxSelfClosingElement(node) || typescript.isJsxFragment(node)) return true;

    return typescript.forEachChild(node, hasJsx) || false;
};
const dynamicImportSpecifier = ({ expression = {}, arguments: argumentsList = [] } = {}) => {
    const { kind = 0 } = expression;
    const [argument = {}] = argumentsList;
    const { text: specifier = '' } = argument;

    return kind === typescript.SyntaxKind.ImportKeyword && typescript.isStringLiteralLike(argument) ? specifier : '';
};
const runtimeSpecifier = (node) => {
    if (typescript.isImportDeclaration(node)) {
        const { importClause, moduleSpecifier = {} } = node;
        const clause = importClause ?? {};
        const { namedBindings = false, name = false, isTypeOnly = false } = clause;
        const namesOnlyType = namedBindings && typescript.isNamedImports(namedBindings) &&
            namedBindings.elements.every(({ isTypeOnly: typeOnly = false } = {}) => typeOnly);
        const isRuntime = !isTypeOnly && (!importClause || name || !namesOnlyType);
        const { text: specifier = '' } = moduleSpecifier;

        return isRuntime && typescript.isStringLiteralLike(moduleSpecifier) ? specifier : '';
    }

    if (typescript.isExportDeclaration(node)) {
        const { isTypeOnly = false, moduleSpecifier = {}, exportClause = {} } = node;
        const selectedClause = exportClause ? exportClause : {};
        const { elements = [] } = selectedClause;
        const namesOnlyType = elements.length && elements.every(({ isTypeOnly: typeOnly = false } = {}) => typeOnly);
        const { text: specifier = '' } = moduleSpecifier;

        return !isTypeOnly && !namesOnlyType && typescript.isStringLiteralLike(moduleSpecifier) ? specifier : '';
    }

    if (typescript.isCallExpression(node)) return dynamicImportSpecifier(node);

    return '';
};
const runtimeModuleSpecifiers = (sourceFile) => {
    let names = [];
    const visit = (node) => {
        const specifier = runtimeSpecifier(node);

        if (specifier) names = [...names, specifier];

        typescript.forEachChild(node, visit);
    };

    visit(sourceFile);

    return names;
};
const closeEmitSelection = ({ selected = [], program = {}, resolution = {}, projectRoot = '' } = {}) => {
    const files = new Set(selected);
    const pending = [...selected];

    // Runtime dependency closure uses a work queue to reach each source once.
    // eslint-disable-next-line resilient/prefer-prototype-methods -- Dependency closure consumes a work queue until no sources remain.
    while (pending.length) {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Queue consumption preserves the breadth-first closure order.
        const fileName = pending.shift();
        const sourceFile = program.getSourceFile(fileName);

        if (!sourceFile) throw new Error(`Selected emit source is absent from the TypeScript program: ${fileName}`);

        runtimeModuleSpecifiers(sourceFile).forEach((specifier) => {
            const { resolved: resolvedModule = {}, external = '' } = resolution.resolve(specifier, fileName);
            const resolved = resolvedModule ?? {};
            const { resolvedFileName = '' } = resolved;

            if (!resolvedFileName && specifier.startsWith('.')) {
                throw new Error(`Runtime import is unresolved from ${fileName}: ${specifier}`);
            }

            if (external) return;

            if (!resolvedFileName && !specifier.startsWith('.') && !specifier.startsWith('#')) return;

            if (!resolvedFileName) throw new Error(`Runtime import is unresolved from ${fileName}: ${specifier}`);

            if (resolvedFileName.includes(`${path.sep}node_modules${path.sep}`) && !specifier.startsWith('.')) return;

            if (!isInside(projectRoot, resolvedFileName) || !/\.tsx?$/u.test(resolvedFileName) || /\.d\.[cm]?ts$/u.test(resolvedFileName)) {
                throw new Error(`Runtime import cannot be emitted as JavaScript: ${specifier} from ${fileName}`);
            }

            if (!program.getSourceFile(resolvedFileName)) {
                throw new Error(`Runtime import is outside the TypeScript Program: ${specifier} from ${fileName}`);
            }

            if (!files.has(resolvedFileName)) {
                // Track visited sources separately from the traversal queue.
                // eslint-disable-next-line resilient/prefer-safe-transformations -- Visited sources are recorded once during closure traversal.
                files.add(resolvedFileName);
                // eslint-disable-next-line resilient/prefer-safe-transformations -- Newly discovered sources must join the active work queue.
                pending.push(resolvedFileName);
            }
        });
    }

    return [...files];
};
const planRuntimeRoutes = ({ files = [], program = {}, resolution = {}, destinations = [] } = {}) => files.flatMap((importer) => {
    const sourceFile = program.getSourceFile(importer);
    const importerDestination = destinations.find(({ fileName = '' } = {}) => fileName === importer);
    const { published: importerOutput = '' } = importerDestination;

    return runtimeModuleSpecifiers(sourceFile).map((specifier) => {
        // eslint-disable-next-line resilient/no-null-assignment -- Published routes use JSON null to preserve the absence of a resolution contract.
        const { resolved = false, owner = 'typescript', external = '', contract = null } = resolution.resolve(specifier, importer);
        const selectedResolution = resolved ? resolved : {};
        const { resolvedFileName: source = '' } = selectedResolution;
        const target = destinations.find(({ fileName = '' } = {}) => fileName === source);

        if (external) return { importer, specifier, owner, source, destination: '', runtimeSpecifier: external, contract };

        if (source && !target && !source.includes(`${path.sep}node_modules${path.sep}`) ||
            !source && !builtinModules.includes(specifier.replace(/^node:/u, ''))) {
            throw new Error(`Runtime route is unresolved or un-emitted: ${specifier} from ${importer}`);
        }

        const selectedTarget = target ? target : {};
        const { published: destination = '' } = selectedTarget;
        const relative = target ? path.relative(path.dirname(importerOutput), destination).split(path.sep).join('/') : '';
        let runtime = specifier;

        if (target) runtime = relative.startsWith('.') ? relative : `./${relative}`;

        return { importer, specifier, owner, source, destination, runtimeSpecifier: runtime };
    });
});
const planDestinations = ({ files = [], root = '', outDir = '', report = '' } = {}) => {
    const destinations = files.map((fileName) => {
        const relative = outputName(path.relative(root, fileName));
        const published = path.resolve(outDir, relative);

        if (!isInside(outDir, published) || published === outDir) {
            throw new Error(`Generated JavaScript must remain inside the output directory: ${fileName}`);
        }

        return { fileName, relative, published };
    });
    const keys = destinations.map(({ published = '' } = {}) => pathKey(resolvePhysicalPath(published)));

    if (new Set(keys).size !== keys.length) throw new Error('Generated JavaScript destination collision.');

    if (report && destinations.some(({ published = '' } = {}) => pathKey(resolvePhysicalPath(published)) === pathKey(resolvePhysicalPath(report)))) {
        throw new Error('The report may not replace generated JavaScript or its output directory.');
    }

    if (report && pathKey(resolvePhysicalPath(report)) === pathKey(resolvePhysicalPath(outDir))) {
        throw new Error('The report may not replace generated JavaScript or its output directory.');
    }

    return destinations;
};
// eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- An omitted ESLint path must stay absent; an empty path would enter the input overlap checks.
const prepareProject = ({ project = '', outDir = '', report = '', manifest = '', eslintConfig,
    emit = [], provider = '', resolverConfig = '', extensionTimeout = 0, cwd = process.cwd() } = {}) => {
    const selectedProject = resolveProject(project);
    const config = getConfig(selectedProject);
    const { diagnostics = [], parsed = {}, loaded = {}, configFiles = [] } = config;

    if (diagnostics.length) return { diagnostics };

    const { fileNames = [], options = {} } = parsed;
    const { config: selectedConfig = {} } = loaded;
    const { compilerOptions: rawCompilerOptions = {}, resilient: selectedResilient = {} } = selectedConfig;
    const resilientConfig = getResilientConfig(selectedResilient);
    const { file: optionalConfigFile = '', config: optionalConfig = {} } = readOptionalProjectConfig(selectedProject);
    const { emit: optionalEmit, standard: optionalStandard, provider: configuredProvider = '', resolution: resolutionConfig = {} } = optionalConfig;
    const projectRoot = path.dirname(selectedProject);
    const providerFile = provider || (configuredProvider ? path.resolve(projectRoot, configuredProvider) : '');
    const { eslintConfig: configuredResolver = '' } = resolutionConfig;
    const resolutionEslint = resolverConfig || (configuredResolver ? path.resolve(projectRoot, configuredResolver) : '');
    const { outDir: configuredOutDir = '' } = rawCompilerOptions;
    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- An omitted helper configuration selects portable bindings; null and false remain malformed supplied values.
    const { emit: configuredEmit = [], standard: configuredStandard } = resilientConfig;
    const selectedEmit = emit.length ? emit : optionalEmit ?? configuredEmit;
    const selectedStandard = optionalStandard ? { ...(configuredStandard || {}), ...optionalStandard } : configuredStandard;
    const resolvedOutDir = path.resolve(cwd, outDir || configuredOutDir || '.resilient');
    const artifactRoot = manifest ? `${resolvedOutDir}.resilient-artifacts` : '';
    const configuredInputs = [...fileNames, ...configFiles, ...(optionalConfigFile ? [optionalConfigFile] : []),
        ...(typeof eslintConfig === 'string' ? [eslintConfig] : []), ...[providerFile, resolutionEslint].filter(Boolean)];

    assertSafeOutput({ project: selectedProject, outDir: resolvedOutDir, report, manifest, artifactRoot,
        files: configuredInputs });

    const { emitDeclarationOnly = false } = options;
    const target = typescript.getEmitScriptTarget(options);
    const moduleKind = typescript.getEmitModuleKind(options);
    const moduleResolution = typescript.getEmitModuleResolutionKind(options);

    if (emitDeclarationOnly) {
        throw new Error('resilient-lower requires JavaScript emit; emitDeclarationOnly is unsupported.');
    }

    if (target < typescript.ScriptTarget.ES2016 ||
        ![typescript.ModuleKind.NodeNext, typescript.ModuleKind.ESNext, typescript.ModuleKind.ES2022].includes(moduleKind) ||
        ![typescript.ModuleResolutionKind.NodeNext, typescript.ModuleResolutionKind.Bundler].includes(moduleResolution) ||
        moduleKind === typescript.ModuleKind.NodeNext && moduleResolution !== typescript.ModuleResolutionKind.NodeNext ||
        [typescript.ModuleKind.ESNext, typescript.ModuleKind.ES2022].includes(moduleKind) && moduleResolution !== typescript.ModuleResolutionKind.Bundler) {
        throw new Error('Unsupported lowering compiler configuration: supported output requires target ES2016 or newer, '
            + 'ESM NodeNext/NodeNext or ESNext or ES2022/Bundler. '
            + 'Use an explicit Resilient tsconfig for other modes.');
    }

    const standard = getStandard(selectedStandard, selectedProject);
    const helperFiles = Object.values(standard).filter(value => path.isAbsolute(value));
    [...helperFiles, ...(typeof eslintConfig === 'string' && eslintConfig ? [eslintConfig] : [])].forEach(assertEsmModule);
    assertSafeOutput({ project: selectedProject, outDir: resolvedOutDir, report, manifest, artifactRoot,
        files: [...configuredInputs, ...helperFiles] });
    const compilerOptions = { ...options, target, module: moduleKind, moduleResolution, outDir: resolvedOutDir, noEmit: false, noEmitOnError: true };
    const emittedConfig = selectedEmit.length
        ? typescript.parseJsonConfigFileContent({ include: selectedEmit }, typescript.sys, path.dirname(selectedProject))
        : { fileNames };
    const { fileNames: selectedFiles = [], errors: selectionErrors = [] } = emittedConfig;

    if (selectionErrors.length) return { diagnostics: selectionErrors };

    if (selectedEmit.length && !selectedFiles.length) throw new Error('The explicit emit selection matched no source files.');

    const resolution = createResolution({ fileNames, selected: selectedFiles, options: compilerOptions, projectRoot, outDir: resolvedOutDir,
        provider: providerFile, eslintConfig: resolutionEslint, timeout: extensionTimeout });
    const host = { ...typescript.createCompilerHost(compilerOptions), resolveModuleNames: (names, importer) => names.map((name) => {
        const { resolved = false } = resolution.resolve(name, importer);

        // eslint-disable-next-line resilient/prefer-falsey-returns -- TypeScript requires undefined for an unresolved module; false is not a compiler resolution.
        return resolved || undefined;
    }) };
    const program = typescript.createProgram(fileNames, compilerOptions, host);
    assertSafeOutput({ project: selectedProject, outDir: resolvedOutDir, report, manifest, artifactRoot,
        files: [...configuredInputs, ...helperFiles, ...program.getSourceFiles().map(({ fileName = '' } = {}) => fileName)] });
    const emittedFiles = closeEmitSelection({ selected: selectedFiles, program, resolution, projectRoot });

    const sourceFiles = emittedFiles.map((fileName) => {
        const sourceFile = program.getSourceFile(fileName);

        if (!sourceFile) throw new Error(`Selected emit source is absent from the TypeScript program: ${fileName}`);

        return sourceFile;
    });
    const lowerable = emittedFiles.filter(file => !/\.d\.[cm]?ts$/u.test(file));

    if (selectedEmit.length && !lowerable.length) {
        throw new Error('The explicit emit selection matched no executable source files.');
    }

    const outputPackage = owningPackage(path.dirname(resolvedOutDir));
    const sourcePackages = lowerable.map(owningPackage);
    const { type: outputType = '', path: outputPackageFile = '' } = outputPackage;

    if (outputType !== 'module' || sourcePackages.some(({ type = '' } = {}) => type !== 'module')) {
        throw new Error('Project lowering requires source and output package scopes with type: module.');
    }

    const packageFiles = [...new Set([outputPackageFile, ...sourcePackages.map(({ path: packageFile = '' } = {}) => packageFile)]
        .filter(Boolean))];

    lowerable.forEach((fileName) => {
        const sourceFile = program.getSourceFile(fileName);

        if (!/\.tsx?$/u.test(fileName) || /\.d\.[cm]?ts$/u.test(fileName)) {
            throw new Error(`Unsupported executable TypeScript source: ${fileName}`);
        }

        const { statements = [] } = sourceFile;
        const unsupportedModuleSyntax = statements.some((node) => {
            const { isExportEquals = false, moduleReference = {} } = node;

            return typescript.isImportEqualsDeclaration(node) && typescript.isExternalModuleReference(moduleReference) ||
                typescript.isExportAssignment(node) && isExportEquals;
        });

        if (unsupportedModuleSyntax) throw new Error(`TypeScript import-equals/export-equals requires a dedicated adapter: ${fileName}. Use standard import/export syntax.`);

        if (fileName.endsWith('.tsx') && hasJsx(sourceFile)) throw new Error(`JSX lowering is unsupported: ${fileName}`);
    });
    const compilerDiagnostics = sourceFiles.flatMap(sourceFile => program.getSyntacticDiagnostics(sourceFile));

    if (compilerDiagnostics.length) return { diagnostics: compilerDiagnostics, emittedFiles };

    const root = program.getCommonSourceDirectory() || path.dirname(selectedProject);
    const inputs = [...configuredInputs, ...packageFiles, ...helperFiles, ...emittedFiles,
        ...program.getSourceFiles().map(({ fileName = '' } = {}) => fileName)];

    assertSafeOutput({ project: selectedProject, outDir: resolvedOutDir, report, manifest, artifactRoot, files: inputs });

    const destinations = planDestinations({ files: lowerable, root, outDir: resolvedOutDir, report });
    const { inputs: extensionInputs = [] } = resolution;
    const runtimeRoutes = planRuntimeRoutes({ files: lowerable, program, resolution, destinations });
    assertSafeOutput({ project: selectedProject, outDir: resolvedOutDir, report, manifest, artifactRoot, files: extensionInputs });

    return {
        diagnostics: [], project: selectedProject, configFiles: [...configFiles, ...(optionalConfigFile ? [optionalConfigFile] : []),
            ...packageFiles, ...extensionInputs], configuredInputs: [...configuredInputs, ...packageFiles],
        program, compilerOptions, emittedFiles, lowerable, runtimeRoutes,
        sourceFiles, root, resolvedOutDir, artifactRoot, standard, destinations, checkerInputs: program.getSourceFiles(),
        effectiveResilient: { ...resilientConfig, ...(optionalEmit ? { emit: optionalEmit } : {}),
            ...(selectedStandard ? { standard: selectedStandard } : {}), ...(emit.length ? { emit } : {}),
            ...(providerFile ? { provider: providerFile } : {}), ...(resolutionEslint ? { resolution: { eslintConfig: resolutionEslint } } : {}), runtimeRoutes },
        projectRoot: path.dirname(selectedProject), selectedEmit
    };
};

const isolatedCompilerOptions = ({ compilerOptions = {} } = {}) => {
    const layout = ['configFilePath', 'outDir', 'rootDir', 'declaration', 'declarationMap', 'sourceMap', 'inlineSourceMap', 'noEmitOnError'];

    return Object.fromEntries(Object.entries(compilerOptions).filter(([name = ''] = []) => !layout.includes(name)));
};
const emitSource = ({ prepared = {}, transformer = {}, fileName = '' } = {}) => {
    const { program = {}, runtimeRoutes = [] } = prepared;
    const sourceFile = program.getSourceFile(fileName);

    if (!sourceFile) throw new Error(`Selected emit source is absent from the TypeScript program: ${fileName}`);

    const { text = '' } = sourceFile;
    const result = transformer.transform({ code: text, fileName });
    const { code: transformedCode = '', diagnostics = [], agreements = [], generatedHelpers = [] } = result;
    const code = rewriteImports(transformedCode, fileName, runtimeRoutes);

    return Object.freeze({ fileName, code, sha256: sha256(code), diagnostics, agreements, generatedHelpers });
};
const referenceSource = ({ prepared = {}, fileName = '' } = {}) => {
    const { program = {}, runtimeRoutes = [] } = prepared;
    const compilerOptions = isolatedCompilerOptions(prepared);
    const sourceFile = program.getSourceFile(fileName);

    if (!sourceFile) throw new Error(`Reference source is absent from the TypeScript program: ${fileName}`);

    const { text = '' } = sourceFile;
    const { outputText = '', diagnostics = [] } = typescript.transpileModule(text, {
        fileName, compilerOptions: { ...compilerOptions, module: typescript.ModuleKind.ESNext,
            moduleResolution: typescript.ModuleResolutionKind.Bundler, declaration: false, declarationMap: false, sourceMap: false, inlineSourceMap: false }, reportDiagnostics: true
    });
    const code = rewriteImports(outputText, fileName, runtimeRoutes);

    return Object.freeze({ fileName, code, sha256: sha256(code), diagnostics });
};

const listTree = (root, prefix = '') => readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    // Dirent classification methods require their receiver.
    const { name = '' } = entry;
    const relative = path.join(prefix, name);

    if (entry.isSymbolicLink()) throw new Error(`Symlink in lowering artifact tree: ${relative}`);

    return entry.isDirectory() ? listTree(root, relative) : [relative.split(path.sep).join('/')];
});
const assertCompleteTree = ({ root = '', expected = [] } = {}) => {
    const names = expected.map(({ relative = '' } = {}) => relative).toSorted();

    if (JSON.stringify(listTree(root).toSorted()) !== JSON.stringify(names)) {
        throw new Error('Lowering operation requires the complete recorded sibling set.');
    }

    expected.forEach(({ relative = '', sha256: expectedHash = '' } = {}) => {
        const actual = sha256(readFileSync(path.join(root, relative)));

        if (actual !== expectedHash) throw new Error(`Lowering sibling hash differs: ${relative}`);
    });
};
const emitProject = async ({ prepared = {}, transformer = {}, stageRoot = '', rawRoot = '', reuse = new Map(),
    contextSha256 = '', onResult = async () => {}, cwd = process.cwd(), write = text => text } = {}) => {
    const { destinations = [] } = prepared;
    let results = [];

    // eslint-disable-next-line resilient/prefer-prototype-methods -- Emission is ordered and each record is durably acknowledged before the next source.
    for (const [index = 0, { fileName = '', relative = '', published = '' } = {}] of destinations.entries()) {
        const { program = {} } = prepared;
        const source = program.getSourceFile(fileName);

        if (!source) throw new Error(`Selected emit source is absent from the TypeScript program: ${fileName}`);

        const { text = '' } = source;
        const sourceSha256 = sha256(text);
        const previous = reuse.get(fileName);
        const prior = previous ? previous : {};
        const { sourceSha256: priorSource = '', sha256: priorHash = '', code: priorCode = '',
            contextSha256: priorContext = '' } = prior;

        if (previous && (priorSource !== sourceSha256 || sha256(priorCode) !== priorHash ||
            (contextSha256 && priorContext !== contextSha256))) {
            throw new Error(`Reusable lowering operation differs from its input or context: ${fileName}`);
        }

        write(`Lowering ${index + 1}/${destinations.length}: ${path.relative(cwd, fileName)}\n`);
        const emitted = previous || emitSource({ prepared, transformer, fileName });
        const { code = '', sha256: outputSha256 = '', agreements = [], generatedHelpers = [], diagnostics = [] } = emitted;
        const destination = path.resolve(stageRoot, relative);

        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(destination, code);

        if (rawRoot) {
            const rawFile = path.resolve(rawRoot, relative);

            mkdirSync(path.dirname(rawFile), { recursive: true });
            writeFileSync(rawFile, code);
        }

        const record = Object.freeze({ fileName, relative: relative.split(path.sep).join('/'), published,
            sourceSha256, sha256: outputSha256, code, agreements, generatedHelpers, diagnostics,
            contextSha256 });

        await onResult(record);
        results = [...results, record];
    }

    return Object.freeze(results);
};
const fixSource = async ({ code = '', filePath = '', worker = {} } = {}) => worker.lint({ code, filePath });
const observeTree = async ({ prepared = {}, root = '', expected = [], worker = {}, fix = false, reuse = new Map(),
    contextSha256 = '', onResult = async () => {}, cwd = process.cwd(), write = text => text } = {}) => {
    const { destinations = [] } = prepared;

    assertCompleteTree({ root, expected });
    let rows = [];

    // eslint-disable-next-line resilient/prefer-prototype-methods -- The worker observes each member of one already verified sibling tree in stable order.
    for (const [index = 0, { fileName = '', relative = '', published = '' } = {}] of destinations.entries()) {
        const code = readFileSync(path.join(root, relative), 'utf8');
        const inputSha256 = sha256(code);
        const previous = reuse.get(fileName);
        const prior = previous ? previous : {};
        const { sha256: priorInput = '', output: priorOutput = '', outputSha256: priorOutputSha256 = '',
            contextSha256: priorContext = '', filePath: priorPath = '' } = prior;

        if (previous && (!fix || priorInput !== inputSha256 || sha256(priorOutput) !== priorOutputSha256 ||
            priorPath !== published || (contextSha256 && priorContext !== contextSha256))) {
            throw new Error(`Reusable fix operation differs from its input or context: ${fileName}`);
        }

        if (fix) write(`Fixing ${index + 1}/${destinations.length}: ${path.relative(cwd, published)}\n`);

        const row = previous || await fixSource({ code, filePath: published, worker });
        const { output = '' } = row;
        const record = Object.freeze({ ...row, source: fileName, filePath: published, sha256: inputSha256,
            outputSha256: sha256(output), contextSha256 });

        await onResult(record);
        rows = [...rows, record];
    }

    return Object.freeze(rows);
};
const publishArtifacts = async ({
    stageRoot = '', outDir = '', report = '', manifest = '', artifactRoot = '',
    prepare = async () => false, buildManifest = () => ({}), javascript = [], write = () => {}
} = {}) => {
    const backupRoot = mkdtempSync(path.join(path.dirname(outDir), '.resilient-backup-'));
    const destinations = [outDir, ...(artifactRoot ? [artifactRoot] : []),
        ...(report && !isInside(outDir, report) ? [report] : []), ...(manifest ? [manifest] : [])];
    let backups = [];
    let published = [];
    let recoveryFailed = false;
    let artifactStage = '';
    let reportStage = '';
    let manifestStage = '';

    try {
        if (report && (javascript.includes(report) || report === outDir)) {
            throw new Error('The report may not replace generated JavaScript or its output directory.');
        }

        [report, manifest].filter(Boolean).forEach((sidecar) => {
            if (existsSync(sidecar) && lstatSync(sidecar).isDirectory()) {
                throw new Error(`EISDIR: sidecar destination is a directory: ${sidecar}`);
            }
        });

        destinations.forEach((destination, index) => {
            if (!existsSync(destination)) return;

            const backup = path.join(backupRoot, `previous-${index}`);

            renameSync(destination, backup);
            backups = [...backups, { destination, backup }];
        });

        renameSync(stageRoot, outDir);
        published = [...published, outDir];
        // Lint observes final paths and a complete sibling set. Prior sidecars remain recoverable.
        const fluency = await prepare();

        if (manifest) {
            artifactStage = mkdtempSync(path.join(path.dirname(artifactRoot), '.resilient-artifacts-staging-'));
            const nextManifest = buildManifest({ artifactStage, fluency });

            // Verify the retained exact set before publishing it.
            validateManifest(nextManifest, { verifyInputs: true, verifyOutput: true, artifactRoot: artifactStage });
            manifestStage = mkdtempSync(path.join(path.dirname(manifest), '.resilient-manifest-'));
            writeFileSync(path.join(manifestStage, 'manifest.json'), `${JSON.stringify(nextManifest, null, 2)}\n`);
        }

        const insideReport = report && isInside(outDir, report);

        if (insideReport) {
            mkdirSync(path.dirname(report), { recursive: true });
            writeFileSync(report, `${JSON.stringify(fluency, null, 2)}\n`);
        }

        if (report && !insideReport) {
            reportStage = mkdtempSync(path.join(path.dirname(report), '.resilient-report-'));
            writeFileSync(path.join(reportStage, 'report.json'), `${JSON.stringify(fluency, null, 2)}\n`);
        }

        if (artifactStage) {
            renameSync(artifactStage, artifactRoot);
            published = [...published, artifactRoot];
            artifactStage = '';
        }

        if (reportStage) {
            renameSync(path.join(reportStage, 'report.json'), report);
            published = [...published, report];
        }

        if (manifestStage) {
            renameSync(path.join(manifestStage, 'manifest.json'), manifest);
            published = [...published, manifest];
        }

        return fluency;
    } catch (error) {
        published.toReversed().forEach(destination => rmSync(destination, { recursive: true, force: true }));

        try {
            backups.toReversed().forEach(({ destination = '', backup = '' } = {}) => renameSync(backup, destination));
        } catch (recoveryError) {
            recoveryFailed = true;
            throw new Error(`${error.message}; recovery failed; backups retained at ${backupRoot}: ${recoveryError.message}`, { cause: recoveryError });
        }

        throw error;
    } finally {
        [artifactStage, reportStage, manifestStage].filter(Boolean).forEach(directory => rmSync(directory, { recursive: true, force: true }));

        if (!recoveryFailed) {
            try {
                rmSync(backupRoot, { recursive: true, force: true });
            } catch (error) {
                write(`Resilient cleanup warning: ${backupRoot}: ${error.message}\n`);
            }
        }
    }
};
const applyFixResults = ({ prepared = {}, root = '', rows = [] } = {}) => {
    const { destinations = [] } = prepared;

    if (rows.length !== destinations.length) throw new Error('Incomplete fixed sibling set.');

    const expectedRaw = destinations.map(({ fileName = '', relative = '', published = '' } = {}, index) => {
        const { [index]: { source = '', filePath = '', sha256: rawSha256 = '' } = {} } = rows;

        if (source !== fileName || filePath !== published) throw new Error('Fixed result differs from its planned source map.');

        return { relative: relative.split(path.sep).join('/'), sha256: rawSha256 };
    });

    assertCompleteTree({ root, expected: expectedRaw });

    return Object.freeze(destinations.map(({ relative = '' } = {}, index) => {
        const { [index]: { output = '' } = {} } = rows;

        writeFileSync(path.join(root, relative), output);

        return { relative: relative.split(path.sep).join('/'), sha256: sha256(output) };
    }));
};

export { applyFixResults, publishArtifacts, assertCompleteTree, assertSafeOutput, emitProject, emitSource, fixSource, observeTree, planDestinations,
    prepareProject, readOptionalProjectConfig, referenceSource, resolveProject };
