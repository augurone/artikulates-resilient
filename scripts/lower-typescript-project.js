#!/usr/bin/env node

import { fork } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { isFunction } from '../analysis/host/function.js';
import { getLintSummary } from './fluency-report.js';

let typescript;

try {
    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- A missing compiler export is a broken TypeScript installation, not a value to default.
    const { default: loadedTypeScript } = await import('typescript');

    typescript = loadedTypeScript;
} catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error('resilient-lower requires TypeScript ^6.0.3. Install typescript in the consuming project.', { cause: error });
    }

    throw error;
}

const artifacts = await import('../integrations/typescript-project-artifacts.js');
const projectService = await import('../integrations/typescript-project.js');

// eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- These required exports come from a known local module; defaults would hide a broken installation.
const { createManifest, createOperation, file, relativeFile } = artifacts;
// eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- These required exports come from a known local module; defaults would hide a broken installation.
const { applyFixResults, assertSafeOutput, emitProject, observeTree, prepareProject, publishArtifacts } = projectService;

const usage = 'Usage: resilient-lower --project <directory|tsconfig.json> [--outDir <directory>] [--emit <pattern>] [--inspect] [--fix] [--eslint-config <file>] [--report <file>] [--manifest <file>]';
// eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- An absent diagnostic offset omits location text; messageText retains the compiler diagnostic union.
const formatDiagnostic = ({ messageText, file = {}, start } = {}) => {
    const message = typescript.flattenDiagnosticMessageText(messageText, '\n');

    // eslint-disable-next-line resilient/no-undefined-comparison -- Offset zero is a valid source position; only an absent offset omits the location.
    if (!file || start === undefined) return message;

    const { line = 0, character = 0 } = file.getLineAndCharacterOfPosition(start);
    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- The compiler diagnostic filename is forwarded to its display string with native absence.
    const { fileName } = file;

    return `${fileName}:${line + 1}:${character + 1}: ${message}`;
};
const reportDiagnostics = (diagnostics = [], write = process.stderr.write.bind(process.stderr)) => {
    diagnostics.forEach(diagnostic => write(`${formatDiagnostic(diagnostic)}\n`));
};
const getOptions = (args = [], cwd = process.cwd()) => {
    let values = new Map();
    let emit = [];

    // eslint-disable-next-line resilient/prefer-prototype-methods -- The cursor consumes one flag or one flag-value pair and rejects duplicates before continuing.
    for (let index = 0; index < args.length; index += 1) {
        // The option cursor selects this flag only after consuming the preceding option.
        const { [index]: flag = '' } = args;

        if (['--fix', '--inspect'].includes(flag) && values.has(flag)) throw new Error(usage);

        if (['--fix', '--inspect'].includes(flag)) {
            values = new Map([...values, [flag, true]]);

            continue;
        }

        // This value is read only after the flag is known to consume a following argument.
        const { [index + 1]: value = '' } = args;

        if (!['--project', '--outDir', '--eslint-config', '--report', '--manifest', '--emit', '--provider', '--resolver-config'].includes(flag) ||
            !value || value.startsWith('--') || flag !== '--emit' && values.has(flag)) {
            throw new Error(usage);
        }

        if (flag === '--emit') {
            emit = [...emit, value];
            index += 1;

            continue;
        }

        values = new Map([...values, [flag, path.resolve(cwd, value)]]);
        index += 1;
    }

    if (!values.has('--project')) throw new Error(usage);

    return {
        project: values.get('--project'),
        outDir: values.get('--outDir'),
        fixAll: values.get('--fix') === true,
        eslintConfig: values.get('--eslint-config'),
        ...(values.has('--provider') ? { provider: values.get('--provider') } : {}),
        ...(values.has('--resolver-config') ? { resolverConfig: values.get('--resolver-config') } : {}),
        report: values.get('--report'),
        manifest: values.get('--manifest'),
        emit,
        inspect: values.get('--inspect') === true
    };
};
const settleRequest = ({ resolve, reject } = {}, error = false, result = {}) => {
    if (!isFunction(resolve) || !isFunction(reject)) throw new TypeError('Invalid pending worker request.');

    if (error) {
        reject(error);

        return;
    }

    resolve(result);
};
// eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Omitted ESLint configuration stays absent in IPC; an empty path is not a configured file.
const createFixWorker = async ({ cwd = '', eslintConfig, measure = false, fixAll = false } = {}) => {
    const worker = fork(fileURLToPath(new URL('./fix-javascript-worker.js', import.meta.url)), [], { cwd, serialization: 'advanced' });
    const pending = new Map();
    let nextId = 0;
    let exited = false;
    const exit = new Promise(resolve => worker.once('close', () => {
        exited = true;
        resolve();
    }));
    const rejectPending = (error) => {
        pending.forEach(request => settleRequest(request, error));
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Failed IPC invalidates all pending request callbacks.
        pending.clear();
    };
    const request = message => new Promise((resolve, reject) => {
        const { connected = false } = worker;

        if (exited || !connected) {
            reject(new Error('Resilient ESLint worker is disconnected.'));

            return;
        }

        const id = nextId;

        nextId += 1;
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private IPC request state retains each promise callback until the matching response arrives.
        pending.set(id, { resolve, reject });
        worker.send({ ...message, id }, (error) => {
            if (error) rejectPending(error);
        });
    });

    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- The worker response must preserve its exact request id; error absence denotes success.
    worker.on('message', ({ id, error, ...result } = {}) => {
        const waiting = pending.get(id);

        if (!waiting) return;

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Consume exactly the matching pending request before settling its promise.
        pending.delete(id);
        settleRequest(waiting, error && new Error(error), result);
    });
    worker.on('error', rejectPending);
    worker.on('disconnect', () => rejectPending(new Error('Resilient ESLint worker disconnected before responding.')));
    worker.on('exit', (code, signal) => {
        rejectPending(new Error(`Resilient ESLint worker exited (${code ?? signal ?? 'unknown'}).`));
    });
    try {
        await request({ type: 'init', cwd, eslintConfig, measure, fixAll });
    } catch (error) {
        worker.kill('SIGKILL');
        await exit;

        throw error;
    }

    return {
        profile: (filePath = '') => request({ type: 'profile', filePath }),
        lint: ({ code = '', filePath = '' } = {}) => request({ type: 'lint', code, filePath }),
        close: async () => {
            if (exited) return;

            const timer = setTimeout(() => worker.kill('SIGKILL'), 1000);

            try {
                await request({ type: 'close' });
            } finally {
                await exit;
                clearTimeout(timer);
            }
        }
    };
};
const measureFluency = async ({
    fixAll = false, rawResults = [], fixedResults = [], files = [], write = process.stderr.write.bind(process.stderr)
} = {}) => {
    const raw = getLintSummary(rawResults);
    const fixed = getLintSummary(fixedResults);
    const { [fixAll ? 'fixed' : 'raw']: published = {} } = { raw, fixed };
    const changedFiles = files.reduce((total, { changed = false } = {}) => total + (changed ? 1 : 0), 0);
    const { errors = 0, warnings = 0 } = published;
    // eslint-disable-next-line resilient/no-null-assignment -- JSON null distinguishes an unperformed post-fix measurement from a zero-finding result.
    const postFix = fixAll ? fixed : null;
    const fluency = {
        schemaVersion: 1, complete: true, fixEnabled: fixAll, fixApplied: fixAll,
        raw, fixed, postFix, published,
        clean: errors === 0 && warnings === 0,
        coverage: { expected: files.length, measured: files.length }, changedFiles, files
    };

    write(`Resilient fluency: ${errors} errors, ${warnings} warnings after ${fixAll ? 'fix-all' : 'analysis'}.\n`);

    return fluency;
};
const runLowering = async ({
    project = '',
    outDir = '',
    fixAll = false,
    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Omitted ESLint configuration must stay absent during input-path safety checks and worker setup.
    eslintConfig,
    report = '',
    manifest = '',
    emit = [],
    inspect = false,
    provider = '',
    resolverConfig = '',
    cwd = process.cwd(),
    write = process.stderr.write.bind(process.stderr)
} = {}) => {
    let prepared;

    try {
        prepared = prepareProject({ project, outDir, report, manifest, eslintConfig, emit, provider, resolverConfig, cwd });
    } catch (error) {
        write(`${error.message}\n`);

        if (error.message === 'resilient-lower requires JavaScript emit; emitDeclarationOnly is unsupported.') {
            return { ok: false, diagnostics: [] };
        }

        return {
            ok: false, diagnostics: [error],
            fluency: report ? {
                complete: false, fixEnabled: fixAll, fixApplied: fixAll ? null : false,
                raw: null, fixed: null, postFix: null, published: null,
                coverage: { expected: 0, measured: 0, expectedFiles: [] }, files: [], error: error.message
            } : undefined
        };
    }

    const { diagnostics = [] } = prepared;

    if (diagnostics.length) {
        reportDiagnostics(diagnostics, write);

        return { ok: false, diagnostics };
    }

    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Successful preparation owns the compiler program; a missing program must not become a fabricated compiler.
    const { program, emittedFiles = [], lowerable = [], standard = {}, resolvedOutDir = '', artifactRoot = '',
        project: selectedProject = '', projectRoot = '', compilerOptions = {}, selectedEmit = [], compatibilityWarning = '',
        root: sourceRoot = '', checkerInputs = [],
        runtimeRoutes = [], configFiles: configurationInputs = [], destinations: plannedDestinations = [] } = prepared;

    const plan = { projectRoot, tsconfig: selectedProject, sourceRoot, outputRoot: resolvedOutDir,
        checkerSources: checkerInputs.map(({ fileName = '' } = {}) => fileName),
        selectedSources: lowerable, destinations: plannedDestinations.map(({ published = '' } = {}) => published),
        compilerOptions, emit: selectedEmit, runtimeRoutes, configurationInputs, unsupportedFeatures: [],
        ...(compatibilityWarning ? { compatibilityWarning } : {}) };

    if (inspect) return { ok: true, diagnostics: [], plan };

    write(`Project root: ${projectRoot}\nTypeScript config: ${selectedProject}\n`);
    write(`Selected ${lowerable.length} executable sources; output root: ${resolvedOutDir}.\n`);

    if (compatibilityWarning) write(`${compatibilityWarning}\n`);

    write(`Creating TypeScript program for ${path.relative(cwd, selectedProject)}.\n`);
    write(`Checking syntax for ${emittedFiles.length} configured files.\n`);

    const transformer = createTypeScriptTransformer({ typescript, program, standard });
    mkdirSync(path.dirname(resolvedOutDir), { recursive: true });
    const stageRoot = mkdtempSync(path.join(path.dirname(resolvedOutDir), `.${path.basename(resolvedOutDir)}-staging-`));
    const rawRoot = manifest ? mkdtempSync(path.join(path.dirname(resolvedOutDir), '.resilient-raw-')) : '';
    let rawResults = [];
    let fixedResults = [];
    const measure = Boolean(report);
    let fixer = false;
    let loweringDiagnostics = [];
    let files = [];
    let emittedRows = [];
    const expected = plannedDestinations.map(({ published = '' } = {}) => published);

    try {
        if (measure && !lowerable.length) throw new Error('Incomplete JavaScript lint: no emitted files to measure.');

        const emitted = await emitProject({ prepared, transformer, stageRoot, rawRoot, cwd, write });

        loweringDiagnostics = emitted.flatMap(({ fileName = '', diagnostics = [] } = {}) => diagnostics.map(({ text: messageText = '' } = {}) => ({
            messageText, file: program.getSourceFile(fileName), start: 0
        })));
        const javascript = emitted.map(({ published = '' } = {}) => published);
        emittedRows = emitted.map(({ fileName = '', relative = '', agreements = [], generatedHelpers = [], diagnostics = [] } = {}) => ({
            fileName, output: relative, agreements, generatedHelpers, diagnostics
        }));

        if (loweringDiagnostics.length) {
            reportDiagnostics(loweringDiagnostics, write);
            throw new Error('Lowering diagnostics prevent JavaScript publication.');
        }

        if (javascript.length) write(`Lowered ${javascript.length} files to ${path.relative(cwd, resolvedOutDir) || '.'}.\n`);

        if (fixAll || measure) {
            fixer = await createFixWorker({ cwd, eslintConfig });

            // eslint-disable-next-line resilient/prefer-prototype-methods -- Protect discovered lint configurations before replacing the output tree.
            for (const filePath of javascript) {
                const { profile: { configFile = '' } = {} } = await fixer.profile(filePath);

                assertSafeOutput({ project, outDir: resolvedOutDir, report, files: configFile ? [configFile] : [] });
            }

            await fixer.close();
            fixer = false;
        }

        let expectedTree = emitted.map(({ relative = '', sha256 = '' } = {}) => ({ relative, sha256 }));
        const lintTree = async (fix = false) => {
            // Each pass gets fresh module-graph and configuration caches for the tree currently on disk.
            fixer = await createFixWorker({ cwd, eslintConfig, fixAll: fix });
            const rows = await observeTree({ prepared, root: resolvedOutDir, expected: expectedTree, worker: fixer, fix, cwd, write });

            await fixer.close();
            fixer = false;

            return rows;
        };
        const prepare = async () => {
            if (measure) {
                const rows = await lintTree();
                rawResults = rows.map(({ result = {} } = {}) => result);
                fixedResults = rawResults;
                files = rows.map(({ source = '', filePath = '', sha256 = '', profile = {}, result = {} } = {}) => ({
                    source, filePath, rawSha256: sha256, publishedSha256: sha256,
                    changed: false, publishedMode: fixAll ? 'fixed' : 'raw', profile,
                    raw: result,
                    postFix: null
                }));
            }

            if (!fixAll) return measure ? measureFluency({ fixAll, rawResults, fixedResults, files, write }) : false;

            const rows = await lintTree(true);
            // The fix worker has exited; no cached graph can observe a partly updated tree.
            expectedTree = applyFixResults({ prepared, root: resolvedOutDir, rows });

            if (!measure) return false;

            const measured = await lintTree();
            fixedResults = measured.map(({ result = {} } = {}) => result);
            files = files.map((file = {}, index = 0) => {
                const { [index]: { sha256 = '', result = {} } = {} } = measured;
                const { rawSha256 = '' } = file;

                return { ...file, publishedSha256: sha256, changed: sha256 !== rawSha256, postFix: result };
            });

            return measureFluency({ fixAll, rawResults, fixedResults, files, write });
        };
        const buildManifest = ({ artifactStage = '', fluency = false } = {}) => {
            const rows = emittedRows.map((row = {}) => {
                const { output = '' } = row;
                const rawRelative = `raw/${output}`;
                const rawPath = path.join(artifactStage, rawRelative);

                mkdirSync(path.dirname(rawPath), { recursive: true });
                copyFileSync(path.join(rawRoot, output), rawPath);
                const raw = relativeFile(artifactStage, rawRelative);
                let fixed = false;

                if (fixAll) {
                    const fixedRelative = `fixed/${output}`;
                    const fixedPath = path.join(artifactStage, fixedRelative);

                    mkdirSync(path.dirname(fixedPath), { recursive: true });
                    copyFileSync(path.join(resolvedOutDir, output), fixedPath);
                    fixed = relativeFile(artifactStage, fixedRelative);
                }

                const variants = fixed ? { raw, fixed } : { raw };

                return { ...row, variants };
            });
            const createLint = () => {
                if (!fluency) return {};

                const { raw = {}, fixed = {}, files: fluencyFiles = [] } = fluency;
                const lintPath = path.join(artifactStage, 'lint/raw.json');

                mkdirSync(path.dirname(lintPath), { recursive: true });
                writeFileSync(lintPath, `${JSON.stringify(raw, null, 2)}\n`);
                const profiles = [...new Set(fluencyFiles.map(({ profile: { configFile = '' } = {} } = {}) => configFile).filter(Boolean))].map(file);
                const rawFile = relativeFile(artifactStage, 'lint/raw.json');
                let fixedFile = false;

                if (fixAll) {
                    writeFileSync(path.join(artifactStage, 'lint/fixed.json'), `${JSON.stringify(fixed, null, 2)}\n`);
                    fixedFile = relativeFile(artifactStage, 'lint/fixed.json');
                }

                return fixedFile ? { protocol: 'cli-final-tree-v1', profiles, raw: rawFile, fixed: fixedFile }
                    : { protocol: 'cli-final-tree-v1', profiles, raw: rawFile };
            };
            const lint = createLint();

            const baseManifest = createManifest({ prepared: { ...prepared, cwd }, artifactRoot, rows,
                publishedVariant: fixAll ? 'fixed' : 'raw', lint });
            const { compiler = {}, configuration = {}, implementation = [], helpers = {}, selectedSources = [] } = baseManifest;
            const context = {
                compiler, configuration, implementation, helpers, selectedSources
            };
            const rawDependencies = rows.map(({ variants: { raw = {} } = {} } = {}) => raw);
            const fileOperations = rows.flatMap(({ fileName = '', output = '', variants = {} } = {}) => {
                const input = file(fileName);
                const { raw = {}, fixed = false } = variants;
                const { path: rawPath = '' } = raw;
                const emit = createOperation({ operation: 'emit', id: `emit:${output}`, context, inputFiles: [input],
                    phase: 'isolated-emission', outputFiles: [raw],
                    outputSets: [{ root: artifactRoot, files: [rawPath] }] });

                if (!fixed) return [emit];

                const { path: fixedPath = '' } = fixed;
                const fix = createOperation({ operation: 'fix', id: `fix:${output}`, context,
                    inputFiles: [input], dependencyResults: rawDependencies, phase: 'complete-raw',
                    outputFiles: [fixed], outputSets: [{ root: artifactRoot, files: [fixedPath] }] });

                return [emit, fix];
            });
            const { raw: lintRaw = false, fixed: lintFixed = false } = lint;
            const { path: lintRawPath = '' } = lintRaw;
            const { path: lintFixedPath = '' } = lintFixed;
            const rawObservations = lintRaw ? [createOperation({ operation: 'observe', id: 'observe:raw', context,
                inputFiles: selectedSources, dependencyResults: rawDependencies, phase: 'complete-raw',
                outputFiles: [lintRaw], outputSets: [{ root: artifactRoot, files: [lintRawPath] }] })] : [];
            const fixedDependencies = rows.map(({ variants: { fixed = {} } = {} } = {}) => fixed);
            const fixedObservations = lintFixed ? [createOperation({ operation: 'observe', id: 'observe:fixed', context,
                inputFiles: selectedSources, dependencyResults: fixedDependencies, phase: 'complete-fixed',
                outputFiles: [lintFixed], outputSets: [{ root: artifactRoot, files: [lintFixedPath] }] })] : [];

            const publishedFiles = rows.map(({ variants: { raw = {}, fixed = {} } = {} } = {}) => fixAll ? fixed : raw);
            const publication = createOperation({ operation: 'publish', id: 'publish:tree', context,
                inputFiles: selectedSources, dependencyResults: publishedFiles, phase: 'publication',
                outputFiles: publishedFiles, outputSets: [{ root: resolvedOutDir,
                    files: rows.map(({ output = '' } = {}) => output).toSorted() }] });
            const operations = [...fileOperations, ...rawObservations, ...fixedObservations, publication];
            const operationFiles = operations.map((operation, index) => {
                const relative = `operations/${String(index).padStart(4, '0')}.json`;
                const location = path.join(artifactStage, relative);

                mkdirSync(path.dirname(location), { recursive: true });
                writeFileSync(location, `${JSON.stringify(operation, null, 2)}\n`);

                return relativeFile(artifactStage, relative);
            });

            return { ...baseManifest, operations: operationFiles };
        };
        const published = await publishArtifacts({ stageRoot, outDir: resolvedOutDir, report, manifest, artifactRoot,
            prepare, buildManifest, javascript, write });
        const fluency = measure ? published : undefined;

        return { ok: true, diagnostics: [], fluency, outDir: resolvedOutDir, manifest: manifest || undefined };
    } catch (error) {
        write(`${error.message}\n`);

        return {
            ok: false, diagnostics: [...loweringDiagnostics, error],
            fluency: measure ? {
                complete: false, fixEnabled: fixAll, fixApplied: fixAll ? null : false, raw: null, fixed: null, postFix: null, published: null,
                coverage: { expected: expected.length, measured: files.length, expectedFiles: expected },
                files, error: error.message
            } : undefined
        };
    } finally {
        if (fixer) {
            try {
                await fixer.close();
            } catch (error) {
                write(`Resilient worker shutdown: ${error.message}\n`);
            }
        }

        rmSync(stageRoot, { recursive: true, force: true });

        if (rawRoot) rmSync(rawRoot, { recursive: true, force: true });
    }
};
const main = async (args = process.argv.slice(2)) => {
    const options = getOptions(args);
    const result = await runLowering({ ...options, cwd: process.cwd() });

    const { ok = false, plan = false } = result;

    if (plan) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);

    // eslint-disable-next-line resilient/prefer-safe-transformations -- The CLI owns the process exit status and reports a failed lowering to its caller.
    if (!ok) process.exitCode = 1;
};

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

export { getOptions, main, runLowering };
