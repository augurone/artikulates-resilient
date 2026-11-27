import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, cpSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ownFile = fileURLToPath(import.meta.url);
const repository = resolve(dirname(ownFile), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const inside = (root, file) => file === root || file.startsWith(root + sep);

export const assertFpTsFluency = ({ complete = false, postFix: { errors = -1, byRule = {} } = {} } = {}) => {
    assert.equal(complete, true, 'Every emitted module must be measured');
    assert.equal(errors, 0, 'Emitted fp-ts errors are regressions');
    assert.deepEqual(byRule, {
        'resilient/prefer-async-await': { violations: 30, errors: 0, warnings: 30 }
    }, 'Only the 30 accepted async warnings may remain');
};

// This connection is deliberately specific to fp-ts's relative source imports.
export const fpTsRouting = ({ input = '', outputs = [], trace = '', trees = [] } = {}) => {
    const source = join(input, 'src');
    const routes = new Map(outputs);
    const selected = new Set(routes.values());
    const clean = id => id.split('?').at(0);
    const guard = (id) => {
        const file = clean(id);

        if (inside(source, file) && /\.tsx?$/u.test(file)) throw new Error(`Original TypeScript loaded: ${file}`);

        if (trees.some(tree => inside(tree, file)) && /\.js$/u.test(file) && !selected.has(file)) {
            throw new Error(`Wrong JavaScript variant loaded: ${file}`);
        }

        return file;
    };

    return {
        name: 'fp-ts-emitted-javascript', enforce: 'pre',
        resolveId(request, importer) {
            // eslint-disable-next-line resilient/prefer-falsey-returns -- Vite requires null to delegate resolution to its remaining plugins.
            if (!importer || !request.startsWith('.') && !request.startsWith('/')) return null;

            const candidate = resolve(dirname(clean(importer)), clean(request));
            const emitted = [candidate, candidate + '.js', join(candidate, 'index.js')].find(file => selected.has(file));

            if (emitted) return emitted;

            const original = [candidate, candidate + '.ts', join(candidate, 'index.ts'), candidate.replace(/\.js$/u, '.ts')]
                .find(file => routes.has(file));

            if (original) return routes.get(original);

            if (inside(source, candidate)) throw new Error(`Unemitted fp-ts source import: ${request}`);

            guard(candidate);

            // eslint-disable-next-line resilient/prefer-falsey-returns -- Vite requires null to retain its normal loading and transformation behavior.
            return null;
        },
        load(id) {
            const file = guard(id);

            if (selected.has(file)) appendFileSync(trace, JSON.stringify({ loaded: file }) + '\n');

            // eslint-disable-next-line resilient/prefer-falsey-returns -- Vite requires null to retain its normal loading and transformation behavior.
            return null;
        },
        transform(code, id) {
            guard(id);

            // eslint-disable-next-line resilient/prefer-falsey-returns -- Vite requires null to retain its normal loading and transformation behavior.
            return null;
        }
    };
};

const main = async () => {
    const { argv = [], execPath = '', env = {}, version = '' } = process;
    assert.equal(version, 'v22.13.0', 'Use the package Node version');
    const offline = argv.includes('--offline');
    const args = argv.slice(2).filter(argument => argument !== '--offline');
    assert.equal(args.length % 2, 0, 'Expected a value after --input or --out');
    const options = new Map(Array.from({ length: args.length / 2 }, (_, index) => [args.at(index * 2), args.at(index * 2 + 1)]));
    const input = resolve(options.get('--input') || join(repository, 'tests/fixtures/fp-ts'));
    const destination = resolve(options.get('--out') || join(repository, '.artifacts/fp-ts-poc/runs'));
    assert.ok(destination.startsWith(join(repository, '.artifacts') + sep), 'Verification output must stay under .artifacts');
    const pin = read(join(input, 'input-manifest.json'));
    const { files: pinned = [], sourceCount = 0, testCount = 0, corpusLimitations = [] } = pin;
    const sources = pinned.filter(({ path = '' } = {}) => path.startsWith('src/') && path.endsWith('.ts'));
    const tests = pinned.filter(({ path = '' } = {}) => path.startsWith('test/') && path.endsWith('.ts'));

    assert.equal(sources.length, sourceCount);
    assert.equal(tests.length, testCount);
    assert.equal(sourceCount, 123);
    assert.equal(testCount, 81);
    mkdirSync(destination, { recursive: true });
    assert.ok([...options.keys()].every(option => ['--input', '--out'].includes(option)), 'Expected --input, --out, or --offline');
    const runRoot = mkdtempSync(join(destination, 'run-'));
    const consumer = join(runRoot, 'consumer');
    const data = join(consumer, 'input');
    const native = join(consumer, 'native');
    const output = join(consumer, 'output');
    const report = join(consumer, 'fluency.json');
    const manifest = join(consumer, 'manifest.json');
    const { PATH = '' } = env;
    const environment = { ...env, PATH: dirname(execPath) + delimiter + PATH };
    let receipt = { input: pin, artifact: runRoot, runtime: version, corpusLimitations, phases: {}, result: 'incomplete' };
    const adaptedPackage = JSON.stringify({ ...read(join(input, 'package.json')), type: 'module' }, null, 2) + '\n';
    const verifyInputs = root => pinned.forEach(({ path = '', sha256 = '' } = {}) => {
        const expected = root === data && path === 'package.json' ? hash(adaptedPackage) : sha256;
        assert.equal(hash(readFileSync(join(root, path))), expected, path);
    });
    receipt = { ...receipt, inputAdaptations: [{ path: 'package.json', change: 'type: module in the isolated runtime copy',
        reason: 'Current lowerer requires ESM package scopes; fp-ts source and test bytes remain pinned.',
        originalSha256: hash(readFileSync(join(input, 'package.json'))), runtimeSha256: hash(adaptedPackage) }] };
    const run = (name, executable, argumentsList, cwd = consumer) => {
        process.stdout.write(`${name}: ${runRoot}\n`);
        const stdout = openSync(join(runRoot, name + '.stdout'), 'w');
        const stderr = openSync(join(runRoot, name + '.stderr'), 'w');
        let result;

        try {
            result = spawnSync(executable, argumentsList, { cwd, env: environment, stdio: ['ignore', stdout, stderr] });
        } finally {
            closeSync(stdout);
            closeSync(stderr);
        }
        const { status = -1, signal = '', error = false } = result;
        const { phases = {} } = receipt;
        receipt = { ...receipt, phases: { ...phases, [name]: { status, signal, stdout: name + '.stdout', stderr: name + '.stderr' } } };
        save(join(runRoot, 'acceptance.json'), receipt);

        if (error || status !== 0) throw new Error(`${name} failed (${status}, ${signal}); inspect ${runRoot}/${name}.stderr`);
    };

    try {
        verifyInputs(input);
        mkdirSync(consumer);
        cpSync(input, data, { recursive: true });
        writeFileSync(join(data, 'package.json'), adaptedPackage);
        cpSync(ownFile, join(consumer, 'acceptance-driver.js'));
        run('pack', 'npm', ['pack', '--ignore-scripts', '--json', '--cache', join(repository, '.artifacts/fp-ts-poc/npm-cache'), '--pack-destination', runRoot], repository);
        const [{ filename = '' } = {}] = read(join(runRoot, 'pack.stdout'));
        const tarball = join(runRoot, filename);
        receipt = { ...receipt, tarball: { file: tarball, sha256: hash(readFileSync(tarball)) } };
        save(join(consumer, 'package.json'), { private: true, type: 'module', dependencies: {
            'eslint-plugin-resilient': 'file:' + tarball, eslint: '10.12.0', typescript: '6.0.3',
            vitest: '1.6.0', vite: '5.3.3', 'fast-check': '3.1.3', glob: '7.1.6',
            rollup: '4.18.0'
        } });
        run('install', 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', offline ? '--offline' : '--prefer-offline', '--cache', join(repository, '.artifacts/fp-ts-poc/npm-cache')]);
        cpSync(ownFile, join(consumer, 'acceptance-driver.js'));
        const require = createRequire(join(consumer, 'package.json'));
        const [{ files: packedFiles = [] } = {}] = read(join(runRoot, 'pack.stdout'));
        const installedDelivery = packedFiles.map(({ path: file = '' } = {}) => {
            const workspace = hash(readFileSync(join(repository, file)));
            const installed = hash(readFileSync(join(consumer, 'node_modules/eslint-plugin-resilient', file)));
            assert.equal(installed, workspace, 'Installed delivery differs: ' + file);

            return { file, workspace, installed };
        });
        receipt = { ...receipt, installedDelivery };
        save(join(runRoot, 'installed-delivery-hashes.json'), installedDelivery);
        const typescript = require('typescript');
        const target = join(data, 'tsconfig.acceptance.json');
        const configuration = {
            extends: 'eslint-plugin-resilient/typescript/config',
            compilerOptions: { target: 'ESNext', module: 'ESNext', moduleResolution: 'Bundler', skipLibCheck: true },
            include: ['src/**/*.ts', 'test/**/*.ts'], resilient: { emit: ['src/**/*.ts'] }
        };
        save(target, configuration);
        receipt = { ...receipt, configuration, dependencyLock: hash(readFileSync(join(consumer, 'package-lock.json'))) };
        const { sys = {} } = typescript;
        const parsed = typescript.parseJsonConfigFileContent(configuration, sys, data, {}, target);
        const { errors = [], options: compilerOptions = {} } = parsed;

        assert.deepEqual(errors, []);
        mkdirSync(join(native, 'src'), { recursive: true });
        sources.forEach(({ path = '' } = {}) => {
            const file = join(data, path);
            const { outputText = '', diagnostics = [] } = typescript.transpileModule(readFileSync(file, 'utf8'), {
                fileName: file, compilerOptions, reportDiagnostics: true
            });

            assert.deepEqual(diagnostics, [], path);
            writeFileSync(join(native, path.replace(/\.ts$/u, '.js')), outputText);
        });
        const seed = join(consumer, 'seed.js');
        writeFileSync(seed, "import * as fc from 'fast-check';\nfc.configureGlobal({ seed: 20261109 });\n");
        const execute = (variant, outputs, trees = [native]) => {
            const trace = join(runRoot, variant + '.loads.jsonl');
            const results = join(runRoot, variant + '.tests.json');
            const config = join(consumer, variant + '.config.mjs');
            const identities = outputs.map(([original = '', emitted = ''] = []) => ({ source: original, path: emitted, sha256: hash(readFileSync(emitted)) }));
            writeFileSync(trace, '');
            const routing = { input: data, outputs, trace, trees };
            writeFileSync(config, [
                "import { loadConfigFromFile, mergeConfig } from 'vite';",
                "import { fpTsRouting } from './acceptance-driver.js';",
                `const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, ${JSON.stringify(join(data, 'vite.config.ts'))});`,
                'if (!loaded) throw new Error("Upstream Vitest configuration did not load");',
                `export default mergeConfig(loaded.config, ${JSON.stringify({ root: data, cacheDir: join(runRoot, 'cache-' + variant), test: {
                    include: ['test/**/*.ts'], exclude: ['test/util.ts'], globals: true, setupFiles: [seed],
                    pool: 'forks', poolOptions: { forks: { singleFork: true } }, fileParallelism: false,
                    sequence: { shuffle: false, concurrent: false }, coverage: { enabled: false }
                } }) .replace(/}$/, '')}, plugins: [fpTsRouting(${JSON.stringify(routing)})] });`
            ].join('\n'));
            run(variant, execPath, [require.resolve('vitest/vitest.mjs'), 'run', '--config', config, '--reporter=json', '--outputFile=' + results], data);
            verifyInputs(data);
            const { testResults = [], success = false } = read(results);
            const cases = testResults.flatMap(({ name = '', assertionResults = [] } = {}) => {
                const counts = new Map();

                return assertionResults.map(({ fullName = '', status = '' } = {}) => {
                    const ordinal = counts.get(fullName) || 0;
                    // eslint-disable-next-line resilient/prefer-safe-transformations -- The decoder owns duplicate test-name ordinals within one test file.
                    counts.set(fullName, ordinal + 1);
                    assert.ok(fullName);
                    assert.equal(status, 'passed', fullName);

                    return { file: relative(data, name).split(sep).join('/'), fullName, ordinal, status };
                });
            }).toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
            assert.equal(success, true);
            assert.ok(cases.length);
            assert.deepEqual(testResults.map(({ name = '' } = {}) => relative(data, name).split(sep).join('/')).toSorted(),
                tests.map(({ path = '' } = {}) => path).filter(path => path !== 'test/util.ts').toSorted());
            // Load receipts name physical JS files; emitted bytes must remain unchanged.
            const loadedPaths = new Set(readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(row => JSON.parse(row).loaded));
            identities.forEach(({ path = '', sha256 = '' } = {}) => {
                assert.ok(loadedPaths.has(path), 'Unloaded emitted module: ' + path);
                assert.equal(hash(readFileSync(path)), sha256);
            });
            save(join(runRoot, variant + '.observations.json'), { cases, loaded: identities, loadedCount: loadedPaths.size });

            return cases;
        };
        const nativeCases = execute('native', sources.map(({ path = '' } = {}) => [join(data, path), join(native, path.replace(/\.ts$/u, '.js'))]));
        const eslintConfig = join(consumer, 'eslint.config.js');
        writeFileSync(eslintConfig, "import production from 'eslint-plugin-resilient/production';\nexport default production();\n");
        run('lower', execPath, [join(consumer, 'node_modules/.bin/resilient-lower'), '--project', target, '--outDir', output,
            '--eslint-config', eslintConfig, '--fix', '--report', report, '--manifest', manifest]);
        const record = read(manifest);
        const { validateManifest = false } = await import(pathToFileURL(join(consumer, 'node_modules/eslint-plugin-resilient/integrations/typescript-project-artifacts.js')).href);

        if (typeof validateManifest !== 'function') throw new TypeError('Installed package must provide its manifest validator');

        validateManifest(record);
        const { configuration: { artifactRoot = '' } = {}, artifacts = [], selectedSources = [] } = record;
        assert.deepEqual(selectedSources.map(({ path = '' } = {}) => path).toSorted(), sources.map(({ path = '' } = {}) => join(data, path)).toSorted());
        const fluency = read(report);
        const { complete = false, clean = false, raw = {}, postFix = {} } = fluency;
        assert.equal(complete, true);
        receipt = { ...receipt, fluency: { report, manifest, complete, clean, raw, postFix } };
        ['raw', 'fixed'].forEach((variant) => {
            const outputs = artifacts.map(({ source: { path = '' } = {}, variants = {} } = {}) => {
                const { [variant]: { path: emitted = '', sha256 = '' } = {} } = variants;
                const file = join(artifactRoot, emitted);
                assert.equal(hash(readFileSync(file)), sha256);

                return [path, file];
            });
            const observed = execute(variant, outputs, [native, join(artifactRoot, 'raw'), join(artifactRoot, 'fixed'), output]);
            assert.deepEqual(observed, nativeCases, variant + ' upstream case outcomes');
        });
        verifyInputs(input);
        assert.equal(nativeCases.length, 1818, 'Pinned fp-ts case count');
        assertFpTsFluency(fluency);
        receipt = { ...receipt, result: 'passed', cases: nativeCases.length };
    } catch (error) {
        const { message = '', stack = '' } = error;
        receipt = { ...receipt, result: 'failed', failure: { message, stack } };
        // eslint-disable-next-line resilient/prefer-safe-transformations -- The verifier owns its exit status and retains the failed receipt before termination.
        process.exitCode = 1;
    }
    save(join(runRoot, 'acceptance.json'), receipt);
    const { result = '', failure = false } = receipt;
    process.stdout.write(JSON.stringify({ artifact: runRoot, result, failure }) + '\n');
};

if (process.argv.at(1) && resolve(process.argv.at(1)) === ownFile) await main();
