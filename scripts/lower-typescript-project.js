#!/usr/bin/env node

import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import typescript from 'typescript';

import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { getLintSummary } from './fluency-report.js';
import { getObject } from '../rules/support/object.js';

const standard = {
    object: 'eslint-plugin-resilient/standard/object',
    array: 'eslint-plugin-resilient/standard/array',
    function: 'eslint-plugin-resilient/standard/function'
};
const digest = text => createHash('sha256').update(text).digest('hex');
const usage = 'Usage: resilient-lower --project <tsconfig.json> [--outDir <directory>] [--fix] [--eslint-config <file>] [--report <file>]';
const isInside = (parent = '', child = '') => {
    const relative = path.relative(parent, child);

    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};
const getOptions = (args = [], cwd = process.cwd()) => {
    let values = new Map();

    // eslint-disable-next-line resilient/prefer-prototype-methods -- The option cursor consumes either one flag or one flag-value pair and rejects duplicates before continuing.
    for (let index = 0; index < args.length; index += 1) {
        // eslint-disable-next-line resilient/prefer-signature-destructuring -- The option cursor selects this flag only after consuming the preceding option.
        const { [index]: flag = undefined } = args;

        if (flag === '--fix' && values.has(flag)) throw new Error(usage);

        if (flag === '--fix') {
            values = new Map([...values, [flag, true]]);

            continue;
        }

        // eslint-disable-next-line resilient/prefer-signature-destructuring -- This value is read only after the flag is known to consume a following argument.
        const { [index + 1]: value = undefined } = args;

        if (!['--project', '--outDir', '--eslint-config', '--report'].includes(flag) || !value || values.has(flag)) {
            throw new Error(usage);
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
        report: values.get('--report')
    };
};
const formatDiagnostic = ({ messageText = undefined, file = {}, start = undefined } = {}) => {
    const message = typescript.flattenDiagnosticMessageText(messageText, '\n');

    // eslint-disable-next-line resilient/no-undefined-comparison -- Offset zero is a valid source position; only an absent offset omits the location.
    if (!file || start === undefined) return message;

    const { line = 0, character = 0 } = file.getLineAndCharacterOfPosition(start);

    const { fileName = undefined } = file;

    return `${fileName}:${line + 1}:${character + 1}: ${message}`;
};
const reportDiagnostics = (diagnostics = [], write = process.stderr.write.bind(process.stderr)) => {
    diagnostics.forEach(diagnostic => write(`${formatDiagnostic(diagnostic)}\n`));
};
const getConfig = (project = '') => {
    const loaded = typescript.readConfigFile(project, typescript.sys.readFile);

    const { error = undefined, config = undefined } = loaded;

    if (error) return { diagnostics: [error] };

    const parsed = typescript.parseJsonConfigFileContent(config, typescript.sys, path.dirname(project), undefined, project);
    const { errors = undefined } = parsed;

    return { loaded, parsed, diagnostics: errors || [] };
};
const assertSafeOutput = ({ project = '', outDir = '', files = [] } = {}) => {
    if (isInside(outDir, project)) throw new Error('The output directory may not contain the tsconfig file.');

    if (files.some(file => isInside(outDir, file))) {
        throw new Error('The output directory may not overlap a configured TypeScript source file.');
    }
};
const createFixWorker = async ({ cwd = '', eslintConfig = undefined, measure = false, fixAll = false } = {}) => {
    const worker = fork(fileURLToPath(new URL('./fix-javascript-worker.js', import.meta.url)), [], { cwd, serialization: 'advanced' });
    const pending = new Map();
    let nextId = 0;
    let exited = false;
    const exit = new Promise(resolve => worker.once('close', () => {
        exited = true;
        resolve();
    }));
    const rejectPending = (error) => {
        pending.forEach(({ reject = undefined }) => reject(error));
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

    worker.on('message', ({ id = undefined, error = undefined, ...result } = {}) => {
        const waiting = pending.get(id);

        if (!waiting) return;

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Consume exactly the matching pending request before settling its promise.
        pending.delete(id);
        const { resolve = undefined, reject = undefined } = waiting;

        if (error) {
            reject(new Error(error));

            return;
        }

        resolve(result);
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
        fix: ({ code = '', filePath = '' } = {}) => request({ type: 'fix', code, filePath }),
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
const publishOutput = ({ stageRoot = '', outDir = '', report = '', fluency = undefined, javascript = [], write = () => {} } = {}) => {
    let reportStage = '';
    let backupRoot = '';
    let published = false;
    let movedPrevious = false;
    let complete = false;

    try {
        if (report && (javascript.includes(report) || report === outDir)) {
            throw new Error('The report may not replace generated JavaScript or its output directory.');
        }

        if (report) {
            const inside = isInside(outDir, report);
            reportStage = inside ? '' : mkdtempSync(path.join(path.dirname(report), '.resilient-report-'));
            const destination = inside ? path.join(stageRoot, path.relative(outDir, report)) : path.join(reportStage, 'report.json');

            mkdirSync(path.dirname(destination), { recursive: true });
            writeFileSync(destination, `${JSON.stringify(fluency, null, 2)}\n`);
        }

        backupRoot = mkdtempSync(path.join(path.dirname(outDir), '.resilient-backup-'));

        if (existsSync(outDir)) {
            renameSync(outDir, path.join(backupRoot, 'previous'));
            movedPrevious = true;
        }

        renameSync(stageRoot, outDir);
        published = true;

        if (reportStage) renameSync(path.join(reportStage, 'report.json'), report);

        complete = true;
    } catch (error) {
        if (published) rmSync(outDir, { recursive: true, force: true });

        if (movedPrevious) {
            // Keep the backup if restoration itself fails, so the prior artifact remains recoverable.
            renameSync(path.join(backupRoot, 'previous'), outDir);
        }

        throw error;
    } finally {
        [reportStage, backupRoot].filter(Boolean).forEach((directory) => {
            if (!complete && existsSync(path.join(directory, 'previous'))) return;

            try {
                rmSync(directory, { recursive: true, force: true });
            } catch (error) {
                write(`Resilient cleanup warning: ${directory}: ${error.message}\n`);
            }
        });
    }
};
const runLowering = async ({
    project = '',
    outDir = '',
    fixAll = false,
    eslintConfig = undefined,
    report = '',
    cwd = process.cwd(),
    write = process.stderr.write.bind(process.stderr)
} = {}) => {
    const config = getConfig(project);

    const { diagnostics = [], parsed = {}, loaded = {} } = config;

    if (diagnostics.length) {
        reportDiagnostics(diagnostics, write);

        return { ok: false, diagnostics };
    }

    const { fileNames = [], options = {} } = parsed;
    const { config: loadedConfig = undefined } = loaded;
    const {
        compilerOptions: { outDir: configuredOutDir = '' } = {},
        resilient: { emit: configuredEmit = [] } = {}
    } = getObject(loadedConfig);
    const resolvedOutDir = outDir || path.resolve(cwd, configuredOutDir || '.resilient');

    try {
        assertSafeOutput({ project, outDir: resolvedOutDir, files: fileNames });
    } catch (error) {
        write(`${error.message}\n`);

        return { ok: false, diagnostics: [error] };
    }

    const { emitDeclarationOnly = false } = options;

    if (emitDeclarationOnly) {
        write('resilient-lower requires JavaScript emit; emitDeclarationOnly is unsupported.\n');

        return { ok: false, diagnostics: [] };
    }

    write(`Creating TypeScript program for ${path.relative(cwd, project)}.\n`);

    const compilerOptions = { ...options, outDir: resolvedOutDir, noEmit: false, noEmitOnError: true };
    const program = typescript.createProgram(fileNames, compilerOptions);
    const emittedConfig = configuredEmit.length
        ? typescript.parseJsonConfigFileContent({ include: configuredEmit }, typescript.sys, path.dirname(project))
        : { fileNames };
    const { fileNames: emittedFiles = [] } = emittedConfig;
    write(`Checking syntax for ${emittedFiles.length} configured files.\n`);

    const compilerDiagnostics = emittedFiles.flatMap((fileName) => {
        const sourceFile = program.getSourceFile(fileName);

        return sourceFile ? program.getSyntacticDiagnostics(sourceFile) : [];
    });

    if (compilerDiagnostics.length) {
        reportDiagnostics(compilerDiagnostics, write);

        return { ok: false, diagnostics: compilerDiagnostics };
    }

    const transformer = createTypeScriptTransformer({ typescript, program, standard });
    const lowerable = emittedFiles.filter(file => !file.endsWith('.d.ts'));
    const { getCommonSourceDirectory = undefined } = program;
    const root = typeof getCommonSourceDirectory === 'function' ? program.getCommonSourceDirectory() : path.dirname(project);
    const stageRoot = mkdtempSync(path.join(path.dirname(resolvedOutDir), `.${path.basename(resolvedOutDir)}-staging-`));
    let rawResults = [];
    let fixedResults = [];
    const measure = Boolean(report);
    let fixer = false;
    let javascript = [];
    let loweringDiagnostics = [];
    let files = [];
    const expected = lowerable.map(fileName => path.join(resolvedOutDir, path.relative(root, fileName).replace(/\.tsx?$/u, '.js')));

    try {
        if (measure && !lowerable.length) throw new Error('Incomplete JavaScript lint: no emitted files to measure.');

        fixer = fixAll || measure ? await createFixWorker({ cwd, eslintConfig, measure, fixAll }) : undefined;

        // eslint-disable-next-line resilient/prefer-prototype-methods -- Each file awaits the same worker before the next file is lowered or staged.
        for (const [index = 0, fileName = ''] of lowerable.entries()) {
            const { text = '' } = getObject(program.getSourceFile(fileName));
            write(`Lowering ${index + 1}/${lowerable.length}: ${path.relative(cwd, fileName)}\n`);
            const result = transformer.transform({ code: text, fileName });
            const relative = path.relative(root, fileName).replace(/\.tsx?$/u, '.js');
            const destination = path.join(stageRoot, relative);
            const published = path.join(resolvedOutDir, relative);

            const { diagnostics: fileDiagnostics = [], code = '' } = result;
            loweringDiagnostics = [...loweringDiagnostics, ...(fileDiagnostics || []).map(({ text: messageText = '' } = {}) => ({
                messageText,
                file: program.getSourceFile(fileName),
                start: 0
            }))];
            const rawOutput = code || '';

            if (fixer && fixAll) write(`Fixing ${index + 1}/${lowerable.length}: ${path.relative(cwd, published)}\n`);

            const fixed = fixer ? await fixer.fix({ code: rawOutput, filePath: published }) : { output: rawOutput };
            const { raw = undefined, fixed: fixedResult = undefined, output: fixedOutput = undefined, profile = undefined } = fixed;
            const output = fixedOutput ?? rawOutput;

            if (fixer && measure) {
                // eslint-disable-next-line resilient/no-null-assignment -- The JSON row records an unperformed post-fix measurement when fixing is disabled.
                const postFix = fixAll ? fixedResult : null;

                rawResults = [...rawResults, raw];
                fixedResults = [...fixedResults, fixedResult];
                files = [...files, {
                    source: fileName, filePath: published, rawSha256: digest(rawOutput), publishedSha256: digest(output),
                    changed: output !== rawOutput, publishedMode: fixAll ? 'fixed' : 'raw', profile,
                    raw, postFix
                }];
            }

            mkdirSync(path.dirname(destination), { recursive: true });
            writeFileSync(destination, output);
            javascript = [...javascript, published];
        }

        if (fixer) {
            await fixer.close();
            fixer = false;
        }

        if (loweringDiagnostics.length) {
            reportDiagnostics(loweringDiagnostics, write);
            throw new Error('Lowering diagnostics prevent JavaScript publication.');
        }

        if (javascript.length) write(`Lowered ${javascript.length} files to ${path.relative(cwd, resolvedOutDir) || '.'}.\n`);

        const fluency = report
            ? await measureFluency({ fixAll, rawResults, fixedResults, files, write })
            : undefined;

        publishOutput({ stageRoot, outDir: resolvedOutDir, report, fluency, javascript, write });

        return { ok: true, diagnostics: [], fluency, outDir: resolvedOutDir };
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
    }
};
const main = async (args = process.argv.slice(2)) => {
    const options = getOptions(args);
    const result = await runLowering({ ...options, cwd: process.cwd() });

    const { ok = false } = result;

    // eslint-disable-next-line resilient/prefer-safe-transformations -- The CLI owns the process exit status and reports a failed lowering to its caller.
    if (!ok) process.exitCode = 1;
};

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

export { getOptions, main, runLowering };
