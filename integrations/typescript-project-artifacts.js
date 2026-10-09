import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import typescript from 'typescript';

const ownDirectory = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const file = filePath => ({ path: filePath, sha256: hash(readFileSync(filePath)) });
const ordered = rows => rows.toSorted(({ path: left = '' } = {}, { path: right = '' } = {}) => left.localeCompare(right, 'en'));
const relativeFile = (root, relative) => ({ path: relative.split(path.sep).join('/'), sha256: hash(readFileSync(path.join(root, relative))) });
const canonical = value => JSON.stringify(value, (key, item) => item && !Array.isArray(item) && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).toSorted(([left = ''], [right = '']) => left.localeCompare(right, 'en'))) : item);
const assertRelative = (name = '') => {
    if (typeof name !== 'string' || !name || name.startsWith('/') || name.includes('\\') ||
        name.split('/').some(part => !part || part === '.' || part === '..')) {
        throw new Error(`Invalid artifact path: ${name}`);
    }
};
const assertShape = (value = {}, required = [], optional = []) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid lowering manifest object.');

    const keys = Object.keys(value);

    if (required.some(key => !keys.includes(key)) || keys.some(key => ![...required, ...optional].includes(key))) {
        throw new Error('Lowering manifest has missing or unknown fields.');
    }
};
const assertFile = (entry = {}, relative = false) => {
    assertShape(entry, ['path', 'sha256']);
    // eslint-disable-next-line resilient/prefer-signature-destructuring -- The complete File shape is validated before fields are consumed.
    const { path: name = '', sha256 = '' } = entry;

    if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new Error(`Invalid file hash: ${name}`);

    if (relative) assertRelative(name);

    if (!relative && !path.isAbsolute(name)) throw new Error(`Input path must be absolute: ${name}`);
};
const walk = (root, prefix = '') => readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    // Dirent classification methods require their bound receiver.
    const { name = '' } = entry;
    const relative = path.join(prefix, name);

    if (entry.isSymbolicLink()) throw new Error(`Symlink in artifact root: ${relative}`);

    return entry.isDirectory() ? walk(root, relative) : [relative];
});
const exactFileSet = (root, expected = []) => {
    const expectedPaths = expected.map(({ path: name = '' } = {}) => name).toSorted();
    const actualPaths = walk(root).map(name => name.split(path.sep).join('/')).toSorted();

    if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
        throw new Error('Artifact file set differs from the manifest.');
    }

    expected.forEach(({ path: name = '', sha256 = '' } = {}) => {
        assertRelative(name);

        if (hash(readFileSync(path.join(root, name))) !== sha256) throw new Error(`Artifact hash differs: ${name}`);
    });
};
const implementationFiles = () => {
    const roots = [
        path.join(ownDirectory, 'typescript-project.js'),
        path.join(ownDirectory, 'typescript-project-artifacts.js'),
        ...['typescript-project-resolution.js', 'project-extension-worker.js', 'project-input-loader.js', 'project.js'].map(name => path.join(ownDirectory, name)),
        path.join(ownDirectory, '../scripts/lower-typescript-project.js'),
        path.join(ownDirectory, '../scripts/fix-javascript-worker.js'),
        path.join(ownDirectory, '../scripts/fluency-report.js')
    ];
    const sourceRoots = ['../analysis', '../transforms'].map(name => path.join(ownDirectory, name));
    const sources = sourceRoots.flatMap(root => walk(root).filter(name => name.endsWith('.js')).map(name => path.join(root, name)));

    return ordered([...roots, ...sources].map(file));
};
const helperBinding = (specifier = '') => {
    const resolved = path.isAbsolute(specifier) ? specifier : fileURLToPath(import.meta.resolve(specifier));
    const seen = new Set();
    const visit = (location) => {
        if (seen.has(location)) return;

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Recursive helper discovery uses this set to break import cycles.
        seen.add(location);
        const source = readFileSync(location, 'utf8');
        const parsed = typescript.preProcessFile(source, true, true);
        const { importedFiles = [], referencedFiles = [] } = parsed;

        [...importedFiles, ...referencedFiles].forEach(({ fileName = '' } = {}) => {
            if (!fileName.startsWith('.')) return;

            const next = path.resolve(path.dirname(location), fileName);

            visit(next);
        });
    };

    visit(resolved);

    return { specifier, resolved, inputs: ordered([...seen].map(file)) };
};
const createManifest = ({ prepared = {}, artifactRoot = '', rows = [], publishedVariant = 'raw', operations = [], lint = false } = {}) => {
    const {
        project = '', configFiles = [], compilerOptions = {}, effectiveResilient = {}, root = '', resolvedOutDir = '',
        checkerInputs = [], lowerable = [], standard = {}, cwd = process.cwd()
    } = prepared;
    const compilerPackage = fileURLToPath(import.meta.resolve('typescript/package.json'));
    const compilerEntry = fileURLToPath(import.meta.resolve('typescript'));
    const artifacts = rows.map(({ fileName = '', output = '', variants = {}, agreements = [], generatedHelpers = [], diagnostics = [] } = {}) => ({
        source: file(fileName), output, variants, agreements, generatedHelpers, diagnostics
    })).toSorted(({ source: { path: left = '' } = {} } = {}, { source: { path: right = '' } = {} } = {}) => left.localeCompare(right, 'en'));
    const { object = '', array = '', function: functionHelper = '' } = standard;
    const { version = '' } = typescript;
    const manifest = {
        schemaVersion: 1, kind: 'resilient-lowering',
        implementation: implementationFiles(),
        compiler: { version, inputs: ordered([compilerPackage, compilerEntry].map(file)) },
        configuration: {
            project, cwd, files: ordered([...new Set(configFiles)].map(file)),
            effectiveCompilerOptions: compilerOptions, effectiveResilient,
            sourceRoot: root, outputRoot: resolvedOutDir, artifactRoot
        },
        checkerInputs: ordered([...new Set(checkerInputs.map(({ fileName = '' } = {}) => fileName))].map(file)),
        selectedSources: ordered([...new Set(lowerable)].map(file)),
        helpers: {
            object: helperBinding(object), array: helperBinding(array),
            function: helperBinding(functionHelper)
        },
        artifacts, publishedVariant, operations: ordered(operations)
    };

    return lint && Object.keys(lint).length ? { ...manifest, lint } : manifest;
};
const manifestFiles = ({ artifacts = [], operations = [], lint = {} } = {}) => [
    ...artifacts.flatMap(({ variants = {} } = {}) => Object.values(variants)),
    ...operations,
    ...Object.values(lint).filter(value => value && typeof value === 'object' && 'path' in value)
];
const createOperation = ({ operation = 'emit', id = '', context = {}, inputFiles = [], dependencyResults = [], phase = 'isolated-emission',
    outputFiles = [], outputSets = [], metadata = false } = {}) => {
    const result = {
        schemaVersion: 1, kind: 'resilient-lowering-operation', id, operation,
        contextSha256: hash(canonical(context)), inputFiles: ordered(inputFiles), dependencyResults: ordered(dependencyResults),
        phase, outputFiles: ordered(outputFiles), outputSets
    };

    return metadata ? { ...result, metadata } : result;
};
const validateManifest = (manifest = {}, { verifyInputs = true, verifyOutput = true, artifactRoot: overrideRoot = '' } = {}) => {
    assertShape(manifest, ['schemaVersion', 'kind', 'implementation', 'compiler', 'configuration', 'checkerInputs',
        'selectedSources', 'helpers', 'artifacts', 'publishedVariant', 'operations'], ['lint']);
    const {
        schemaVersion = 0, kind = '', configuration = {}, artifacts = [], selectedSources = [], publishedVariant = '',
        implementation = [], compiler: { inputs: compilerInputs = [] } = {}, checkerInputs = [], helpers = {}
    } = manifest;

    if (schemaVersion !== 1 || kind !== 'resilient-lowering') throw new Error('Unsupported lowering manifest.');

    assertShape(configuration, ['project', 'cwd', 'files', 'effectiveCompilerOptions', 'effectiveResilient',
        'sourceRoot', 'outputRoot', 'artifactRoot']);
    const { compiler = {}, lint = false, operations = [] } = manifest;

    assertShape(compiler, ['version', 'inputs']);
    assertShape(helpers, ['object', 'array', 'function']);
    const { files: configurationFiles = [] } = configuration;

    [...implementation, ...compilerInputs, ...configurationFiles, ...checkerInputs, ...selectedSources].forEach(entry => assertFile(entry));
    Object.values(helpers).forEach((binding) => {
        assertShape(binding, ['specifier', 'resolved', 'inputs']);
        // eslint-disable-next-line resilient/prefer-signature-destructuring -- Validate the complete Binding before reading its fields.
        const { inputs = [], resolved = '' } = binding;

        if (!path.isAbsolute(resolved)) throw new Error('Helper binding must resolve to an absolute file.');

        inputs.forEach(entry => assertFile(entry));
    });
    artifacts.forEach((artifact) => {
        assertShape(artifact, ['source', 'output', 'variants', 'agreements', 'generatedHelpers', 'diagnostics']);
        // eslint-disable-next-line resilient/prefer-signature-destructuring -- Validate the complete artifact before reading its fields.
        const { source = {}, output = '', variants = {}, agreements = [], generatedHelpers = [], diagnostics = [] } = artifact;

        assertFile(source);
        assertRelative(output);
        assertShape(variants, ['raw'], ['fixed', 'reference']);
        Object.entries(variants).forEach(([variant = '', artifactFile = {}] = []) => {
            assertFile(artifactFile, true);
            const { path: variantPath = '' } = artifactFile;

            if (variantPath !== `${variant}/${output}`) throw new Error('Artifact variant path differs from its source map.');
        });

        if (![agreements, generatedHelpers, diagnostics].every(Array.isArray)) throw new Error('Invalid transform metadata arrays.');
    });
    operations.forEach(entry => assertFile(entry, true));

    const lintRecord = lint ? lint : {};
    const { protocol = '', profiles = [] } = lintRecord;

    if (lint) {
        assertShape(lint, ['protocol', 'profiles'], ['immediate', 'raw', 'fixed']);

        profiles.forEach(entry => assertFile(entry));
    }

    if (lint && !['cli-final-tree-v1', 'corpus-v1'].includes(protocol)) throw new Error('Unsupported lint protocol.');

    const { artifactRoot = '', outputRoot = '' } = configuration;
    const listed = manifestFiles(manifest);

    if (!artifactRoot || !outputRoot || !['raw', 'fixed'].includes(publishedVariant)) throw new Error('Incomplete lowering manifest.');

    listed.forEach(entry => assertFile(entry, true));

    if (new Set(listed.map(({ path: name = '' } = {}) => name)).size !== listed.length) {
        throw new Error('Duplicate artifact path in lowering manifest.');
    }

    if (artifacts.length !== selectedSources.length || artifacts.some(({ source = {}, output = '', variants = {} } = {}, index) => {
        assertRelative(output);

        const { path: sourcePath = '' } = source;
        const { [index]: { path: selectedPath = '' } = {} } = selectedSources;
        const { raw = false, [publishedVariant]: selectedVariant = false } = variants;

        return sourcePath !== selectedPath || !raw || !selectedVariant;
    })) throw new Error('Selected sources and lowering artifacts differ.');

    exactFileSet(overrideRoot || artifactRoot, listed);
    const context = { compiler, configuration, implementation, helpers, selectedSources };
    const contextSha256 = hash(canonical(context));
    const variantFiles = artifacts.flatMap(({ variants = {} } = {}) => Object.values(variants));
    const lintFiles = Object.values(lintRecord).filter(value => value && typeof value === 'object' && 'path' in value);
    const outputPaths = new Set([...variantFiles, ...lintFiles].map(({ path: name = '' } = {}) => name));
    const rawPaths = artifacts.map(({ variants: { raw: { path: name = '' } = {} } = {} } = {}) => name).toSorted();
    const fixedPaths = artifacts.map(({ variants: { fixed: { path: name = '' } = {} } = {} } = {}) => name).filter(Boolean).toSorted();
    const operationIds = operations.map(({ path: operationPath = '' } = {}) => {
        const record = JSON.parse(readFileSync(path.join(overrideRoot || artifactRoot, operationPath), 'utf8'));

        assertShape(record, ['schemaVersion', 'kind', 'id', 'operation', 'contextSha256', 'inputFiles',
            'dependencyResults', 'phase', 'outputFiles', 'outputSets'], ['metadata']);
        const { schemaVersion: operationVersion = 0, kind: operationKind = '', id = '', operation = '',
            contextSha256: operationContext = '', inputFiles = [], dependencyResults = [], outputFiles = [],
            outputSets = [], phase = '', metadata = false } = record;

        if (operationVersion !== 1 || operationKind !== 'resilient-lowering-operation' || !id ||
            !['emit', 'reference', 'observe', 'fix', 'publish'].includes(operation) || operationContext !== contextSha256 ||
            !['isolated-emission', 'complete-raw', 'complete-fixed', 'publication'].includes(phase)) {
            throw new Error(`Invalid lowering operation: ${operationPath}`);
        }

        [...inputFiles, ...dependencyResults, ...outputFiles].forEach(entry => assertFile(entry, !inputFiles.includes(entry)));

        if (metadata) assertFile(metadata, true);

        if (outputFiles.some(({ path: name = '' } = {}) => !outputPaths.has(name)) || !Array.isArray(outputSets)) {
            throw new Error(`Lowering operation output differs from artifacts: ${operationPath}`);
        }

        outputSets.forEach((set) => {
            assertShape(set, ['root', 'files']);
            // eslint-disable-next-line resilient/prefer-signature-destructuring -- Validate the complete output-set shape before reading fields.
            const { root = '', files = [] } = set;

            if (root !== (operation === 'publish' ? outputRoot : artifactRoot) || !Array.isArray(files)) {
                throw new Error(`Invalid operation output set: ${operationPath}`);
            }

            files.forEach(assertRelative);

            if (operation === 'publish' && JSON.stringify(files) !== JSON.stringify(artifacts.map(({ output = '' } = {}) => output).toSorted())) {
                throw new Error(`Publication output set differs from the manifest: ${operationPath}`);
            }
        });

        const dependencies = dependencyResults.map(({ path: name = '' } = {}) => name).toSorted();
        const expectedDependencies = phase === 'complete-fixed' ? fixedPaths : rawPaths;

        if (['fix', 'observe'].includes(operation) && JSON.stringify(dependencies) !== JSON.stringify(expectedDependencies)) {
            throw new Error(`Operation lacks completed sibling dependencies: ${operationPath}`);
        }

        if (operation === 'publish' && (phase !== 'publication' ||
            JSON.stringify(dependencies) !== JSON.stringify(artifacts.map(({ variants: { [publishedVariant]: { path: name = '' } = {} } = {} } = {}) => name).toSorted()))) {
            throw new Error(`Publication lacks completed artifact dependencies: ${operationPath}`);
        }

        return id;
    });

    if (new Set(operationIds).size !== operationIds.length) throw new Error('Duplicate lowering operation identity.');

    const outputs = artifacts.map(({ output = '' } = {}) => output);
    const actual = verifyOutput ? walk(outputRoot).map(name => name.split(path.sep).join('/')).toSorted() : [];

    if (verifyOutput && JSON.stringify(actual) !== JSON.stringify(outputs.toSorted())) {
        throw new Error('Published output set differs from the manifest.');
    }

    if (verifyOutput) artifacts.forEach(({ output = '', variants = {} } = {}) => {
        const { [publishedVariant]: { sha256 = '' } = {} } = variants;

        if (hash(readFileSync(path.join(outputRoot, output))) !== sha256) {
            throw new Error(`Published output hash differs: ${output}`);
        }
    });

    if (verifyInputs) {
        const inputs = [
            ...implementation, ...compilerInputs, ...configurationFiles,
            ...checkerInputs, ...selectedSources,
            ...Object.values(helpers).flatMap(({ inputs = [] } = {}) => inputs)
        ];

        inputs.forEach(({ path: name = '', sha256 = '' } = {}) => {
            if (hash(readFileSync(name)) !== sha256) throw new Error(`Lowering input hash differs: ${name}`);
        });
    }

    return true;
};

export { createManifest, createOperation, file, hash, relativeFile, validateManifest };
