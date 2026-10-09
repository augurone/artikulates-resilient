import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import typescript from 'typescript';

import { validateManifest } from './typescript-project-artifacts.js';
import { assertEsmModule, runExtension } from './typescript-project-resolution.js';
import { prepareProject, readOptionalProjectConfig, referenceSource, resolveProject } from './typescript-project.js';

const ownFile = name => fileURLToPath(new URL(name, import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const save = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const lines = file => readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const inside = (root = '', file = '') => file === root || file.startsWith(root + path.sep);
const fingerprint = files => [...new Set(files)].map(file => ({ file, sha256: digest(readFileSync(file)) }));
const verify = rows => rows.forEach(({ file = '', sha256 = '' } = {}) => {
    if (digest(readFileSync(file)) !== sha256) throw new Error(`Project input or artifact changed during testing: ${file}`);
});
const sorted = rows => rows.toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

const execute = async ({ args = [], cwd = '', env = {}, timeout = 120000, log = '' } = {}) => {
    const stdout = openSync(log + '.stdout', 'w');
    const stderr = openSync(log + '.stderr', 'w');
    const { execPath = '', platform = '' } = process;

    try {
        const child = spawn(execPath, args, { cwd, env, detached: platform !== 'win32', stdio: ['ignore', stdout, stderr] });
        const result = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                try {
                    const { pid = 0 } = child;

                    if (pid) process.kill(platform === 'win32' ? pid : -pid, 'SIGKILL');
                } catch (error) {
                    const { code = '' } = error;

                    if (code !== 'ESRCH') reject(error);
                }

                reject(new Error(`Project test process exceeded ${timeout}ms: ${log}`));
            }, timeout);
            child.once('error', (error) => { clearTimeout(timer); reject(error); });
            child.once('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal }); });
        });

        const { status = -1, signal = '' } = result;

        if (status !== 0) throw new Error(`Project test process failed (${status}, ${signal}): ${log}.stderr`);

        return result;
    } finally {
        closeSync(stdout);
        closeSync(stderr);
    }
};
const configurationFor = ({ project = '', timeout = 120000 } = {}) => {
    const selected = resolveProject(project);
    const projectRoot = path.dirname(selected);
    const { config = {}, file = '' } = readOptionalProjectConfig(selected);
    const { provider = '', proof: authored = {} } = config;
    const extension = provider ? runExtension({ provider: path.resolve(projectRoot, provider), projectRoot, proof: true, timeout }) : {};
    const { proof: supplied = {}, inputs = [] } = extension;

    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) throw new Error('Provider proof hook must return test configuration.');

    const proof = { ...supplied, ...authored };
    const { tests = {}, runner = { kind: 'node-test' }, resources = [], dependencies = [], env = {}, inheritEnv,
        vitestConfig = '' } = proof;
    const { include = [], exclude = [] } = tests;
    const { kind = '', options = {} } = runner;

    if (Object.keys(proof).some(key => !['tests', 'runner', 'resources', 'dependencies', 'env', 'inheritEnv', 'vitestConfig'].includes(key)) ||
        !Array.isArray(include) || !include.length || !Array.isArray(exclude) ||
        [...include, ...exclude].some(value => typeof value !== 'string' || !value.trim())) {
        throw new Error('Project tests require explicit proof.tests.include patterns and optional exclude patterns.');
    }

    if (!['node-test', 'vitest'].includes(kind) || Object.keys(runner).some(key => !['kind', 'options'].includes(key)) ||
        !options || typeof options !== 'object' || Array.isArray(options) ||
        Object.keys(options).some(key => key !== 'config') || kind === 'node-test' && Object.keys(options).length) {
        throw new Error('Supported proof.runner kinds are node-test and consumer-provided vitest; only Vitest options.config is supported.');
    }

    if (!Array.isArray(resources) || resources.length || !Array.isArray(dependencies) || dependencies.length) {
        throw new Error('Project tests use the existing project cwd, resources and dependencies; resource/dependency mounts are unsupported.');
    }

    if (!env || typeof env !== 'object' || Array.isArray(env) || Object.values(env).some(value => typeof value !== 'string') ||
        Object.hasOwn(proof, 'inheritEnv') && (!Array.isArray(inheritEnv) || inheritEnv.some(value => typeof value !== 'string'))) throw new Error('Invalid proof environment.');

    const nativeEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key = ''] = []) => key !== 'NODE_TEST_CONTEXT'));
    const inherited = inheritEnv ? Object.fromEntries(inheritEnv.filter(key => Object.hasOwn(nativeEnvironment, key)).map((key) => {
        const { [key]: value = '' } = nativeEnvironment;

        return [key, value];
    })) : nativeEnvironment;
    const testFiles = typescript.sys.readDirectory(projectRoot, ['.js', '.jsx', '.ts', '.tsx'],
        ['node_modules', '.git', '.artifacts', 'dist', 'build', ...exclude], include).map(file => realpathSync(file)).toSorted();

    if (!testFiles.length) throw new Error('Project test selection is empty.');

    if (testFiles.some(file => !inside(projectRoot, file))) throw new Error('Selected tests must remain inside the project.');

    const { config: runnerConfig = '' } = options;
    const chosenConfig = vitestConfig || runnerConfig;

    if (chosenConfig) assertEsmModule(path.resolve(projectRoot, chosenConfig));

    return { project: selected, projectRoot, testFiles, kind, env: { ...inherited, ...env },
        configFile: chosenConfig ? path.resolve(projectRoot, chosenConfig) : '',
        inputs: [...inputs, ...(file ? [file] : [])],
        environment: Object.entries({ ...inherited, ...env }).map(([key = '', value = ''] = []) => ({ key, sha256: digest(String(value)) })) };
};
const vitestCases = ({ file = '', projectRoot = '' } = {}) => {
    const { success = false, testResults = [] } = read(file);

    if (!success) throw new Error('Vitest did not report successful completion.');

    return testResults.flatMap(({ name = '', assertionResults = [] } = {}) => {
        const names = new Map();

        return assertionResults.map(({ fullName = '', status = '' } = {}) => {
            if (!fullName) throw new Error('Vitest returned an unnamed case.');

            const ordinal = names.get(fullName) || 0;
            // eslint-disable-next-line resilient/prefer-safe-transformations -- This private decoder index distinguishes duplicate native runner cases without changing their records.
            names.set(fullName, ordinal + 1);

            return { file: path.relative(projectRoot, name).split(path.sep).join('/'), name: fullName, ordinal, status };
        });
    });
};

export const runProjectTests = async ({ project = '', outDir = '', eslintConfig = '', timeout = 120000, cwd = process.cwd() } = {}) => {
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 3600000) throw new Error('Project timeout must be an integer from 1 to 3600000ms.');

    const configuration = configurationFor({ project: path.resolve(cwd, project), timeout });
    const { projectRoot = '', project: selectedProject = '', testFiles = [], kind = '', env = {}, configFile = '', inputs = [], environment = [] } = configuration;
    const base = outDir ? path.resolve(cwd, outDir) : path.join(projectRoot, '.resilient-tests');

    if (outDir && existsSync(base)) throw new Error('Project test output must be a fresh directory.');

    mkdirSync(base, { recursive: true });
    const root = realpathSync(outDir ? base : mkdtempSync(path.join(base, 'run-')));
    const reportFile = path.join(root, 'results.json');
    let record = { schemaVersion: 1, kind: 'resilient-project-tests', complete: false, project: selectedProject,
        artifact: root, runner: kind, environment, testFiles, variants: {} };

    try {
        const output = path.join(root, 'output');
        const manifest = path.join(root, 'manifest.json');
        const fluency = path.join(root, 'fluency.json');
        const prepared = prepareProject({ project: selectedProject, outDir: output, manifest, report: fluency, cwd: projectRoot, extensionTimeout: timeout });
        const { diagnostics = [], destinations = [], checkerInputs = [], configFiles = [], compilerOptions = {} } = prepared;

        if (diagnostics.length) throw new Error('TypeScript project preparation failed.');

        if (destinations.some(({ fileName = '' } = {}) => testFiles.includes(realpathSync(fileName)))) throw new Error('Emit selection includes test files; narrow resilient.emit to product sources.');

        const testDirectories = [...new Set(testFiles.map(path.dirname))].filter(directory => directory !== projectRoot);

        if (destinations.some(({ fileName = '' } = {}) => testDirectories.some(directory => inside(directory, realpathSync(fileName))))) {
            throw new Error('Test/helper directories overlap emitted application sources; configure a separate test directory.');
        }

        const sourceInputs = fingerprint([...checkerInputs.map(({ fileName = '' } = {}) => fileName), ...configFiles, ...testFiles, ...inputs,
            ...(configFile ? [configFile] : [])]);
        const sourceFiles = destinations.map(({ fileName = '' } = {}) => realpathSync(fileName));
        const ownedSources = [...new Set([...sourceFiles, ...checkerInputs.map(({ fileName = '' } = {}) => realpathSync(fileName))
            .filter(file => inside(projectRoot, file) && !file.includes(`${path.sep}node_modules${path.sep}`) &&
                !testFiles.includes(file) && !testDirectories.some(directory => inside(directory, file)))])];
        const referenceRoot = path.join(root, 'reference');
        const rawRoot = output + '.resilient-artifacts/raw';
        const fixedRoot = output + '.resilient-artifacts/fixed';
        const roots = [referenceRoot, rawRoot, fixedRoot, output];
        const referenceOutputs = destinations.map(({ fileName = '', relative = '' } = {}) => {
            const { code = '', diagnostics = [] } = referenceSource({ prepared, fileName });

            if (diagnostics.length) throw new Error(`Reference emit failed: ${fileName}`);

            const file = path.join(referenceRoot, relative);
            mkdirSync(path.dirname(file), { recursive: true });
            writeFileSync(file, code);

            return { source: realpathSync(fileName), file, sha256: digest(code) };
        });
        // Locate consumer-owned runner packages; project modules execute through ESM hooks.
        const resolver = createRequire(path.join(projectRoot, 'package.json'));
        let helperInputs = [];
        const runVariant = async (variant, outputs) => {
            verify(helperInputs);
            const trace = path.join(root, variant + '.loads.jsonl');
            const casesFile = path.join(root, variant + '.cases.jsonl');
            const routingFile = path.join(root, variant + '.routing.json');
            const routing = { projectRoot, artifactRoot: root, compilerOptions, outputs, ownedSources, testDirectories, roots, trace };
            writeFileSync(trace, '');
            writeFileSync(casesFile, '');
            save(routingFile, routing);
            let args = ['--import', ownFile('./project-tests-preload.js'), '--test', '--test-concurrency=1',
                '--test-reporter', ownFile('./project-tests-reporter.js'), ...testFiles];
            let results = '';

            if (kind === 'vitest') {
                let tools;

                try {
                    tools = { runner: resolver.resolve('vitest/vitest.mjs'), vite: resolver.resolve('vite') };
                } catch (error) {
                    throw new Error('Vitest testing requires Vitest and Vite installed in the consumer project.', { cause: error });
                }

                const { runner = '', vite = '' } = tools;
                results = path.join(root, variant + '.vitest.json');
                const wrapper = path.join(root, variant + '.config.js');
                const test = { include: testFiles.map(file => path.relative(projectRoot, file).split(path.sep).join('/')), exclude: [],
                    reporters: ['json'], outputFile: results, fileParallelism: false, minWorkers: 1, maxWorkers: 1, coverage: { enabled: false } };
                writeFileSync(wrapper, [
                    `import * as vite from ${JSON.stringify(pathToFileURL(vite).href)};`,
                    `import { projectTestRoutingPlugin } from ${JSON.stringify(new URL('./project-tests-vite.js', import.meta.url).href)};`,
                    'const {loadConfigFromFile,mergeConfig} = vite.default || vite;',
                    configFile ? `const loaded = await loadConfigFromFile({command:'serve',mode:'test'}, ${JSON.stringify(configFile)});` : 'const loaded = {config:{}};',
                    'if (!loaded) throw new Error("Vitest configuration did not load");',
                    `const merged = mergeConfig(loaded.config, {root:${JSON.stringify(projectRoot)}, cacheDir:${JSON.stringify(path.join(root, variant + '.cache'))},`,
                    `test:${JSON.stringify(test)}, plugins:[projectTestRoutingPlugin(${JSON.stringify(routing)})]});`,
                    'const {test:{poolOptions={}}={}} = loaded.config;',
                    'const guardedPools = Object.fromEntries(["threads","forks","vmThreads","vmForks"].map(name=>{',
                    'const options=poolOptions[name]||{}; const {execArgv=[]}=options;',
                    'if (!Array.isArray(execArgv)) throw new Error("Vitest pool execArgv must be an array");',
                    `return [name,{...options,execArgv:['--import',${JSON.stringify(new URL('./project-tests-preload.js?role=worker', import.meta.url).href)},...execArgv]}];}));`,
                    'export default {...merged,test:{...merged.test,poolOptions:{...poolOptions,...guardedPools}}};'
                ].join('\n'));
                args = ['--import', new URL('./project-tests-preload.js?role=host', import.meta.url).href, runner, 'run', '--config', wrapper];
            }

            await execute({ args, cwd: projectRoot, timeout, log: path.join(root, variant), env: { ...env,
                RESILIENT_PROJECT_TESTS: routingFile, RESILIENT_PROJECT_CASES: casesFile, RESILIENT_PROJECT_ROOT: projectRoot } });
            verify(sourceInputs);
            outputs.forEach(({ file = '', sha256 = '' } = {}) => verify([{ file, sha256 }]));
            const cases = sorted(kind === 'vitest' ? vitestCases({ file: results, projectRoot }) : lines(casesFile));

            if (!cases.some(({ status = '' } = {}) => status === 'passed') || cases.some(({ status = '' } = {}) => status === 'failed')) {
                throw new Error(`No passing test cases or a failing case in ${variant}.`);
            }

            const traced = lines(trace);
            const loaded = sorted([...new Map(traced.filter(({ kind = '' } = {}) => kind === 'artifact')
                .map((row) => { const { source = '' } = row;

                    return [source, row]; })).values()]);
            const helpers = sorted([...new Map(traced.filter(({ kind = '' } = {}) => kind === 'test')
                .map(({ file = '', sha256 = '' } = {}) => [file, { file, sha256 }])).values()]);
            verify(helpers);

            if (variant === 'reference') helperInputs = helpers;

            if (!loaded.length) throw new Error(`Tests loaded no owned emitted artifacts in ${variant}.`);

            const { variants = {} } = record;
            record = { ...record, variants: { ...variants, [variant]: { cases, loaded, helpers,
                coverage: { selected: outputs.length, observed: loaded.length } } } };
            save(reportFile, record);

            return { cases, sources: loaded.map(({ source = '' } = {}) => source).toSorted(), helpers };
        };
        record = { ...record, inputs: sourceInputs };
        const reference = await runVariant('reference', referenceOutputs);
        const profile = eslintConfig ? path.resolve(cwd, eslintConfig) : path.join(root, 'eslint.config.js');

        if (!eslintConfig) writeFileSync(profile, [
            `import production from ${JSON.stringify(import.meta.resolve('eslint-plugin-resilient/production'))};`,
            `export default production({cwd:${JSON.stringify(projectRoot)},files:['**/*.js']});\n`
        ].join('\n'));

        await execute({ args: [ownFile('../scripts/lower-typescript-project.js'), '--project', selectedProject, '--outDir', output,
            '--fix', '--eslint-config', profile, '--report', fluency, '--manifest', manifest], cwd: root, env, timeout, log: path.join(root, 'lower') });
        const lowered = read(manifest);
        validateManifest(lowered);
        const { configuration: { artifactRoot = '' } = {}, artifacts = [] } = lowered;
        const { complete = false, clean = false } = read(fluency);
        record = { ...record, fluency: { report: fluency, manifest, complete, clean } };

        // eslint-disable-next-line resilient/prefer-prototype-methods -- Variant execution is sequential so reference results own the comparison before each independent raw/fixed process starts.
        for (const variant of ['raw', 'fixed']) {
            const outputs = artifacts.map(({ source: { path: source = '' } = {}, variants = {} } = {}) => {
                const { [variant]: { path: relative = '', sha256 = '' } = {} } = variants;

                return { source: realpathSync(source), file: path.join(artifactRoot, relative), sha256 };
            });
            const observed = await runVariant(variant, outputs);

            if (JSON.stringify(observed) !== JSON.stringify(reference)) throw new Error(`Project test cases or loaded source identities differ in ${variant}.`);
        }

        validateManifest(lowered);
        verify(sourceInputs);
        record = { ...record, complete: true };
    } catch (error) {
        const { message = '' } = error;
        record = { ...record, error: message };
    }

    save(reportFile, record);

    return record;
};
