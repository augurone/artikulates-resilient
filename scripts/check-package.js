import { deepStrictEqual, ok } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { parse } from 'espree';

import { report, saveReport } from './io.js';

const verificationStart = performance.now();
const timings = new Map();
const root = fileURLToPath(new URL('../', import.meta.url));
const { devDependencies: { eslint: eslintVersion = '' } = {} } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

ok(eslintVersion, 'Package verification requires the declared ESLint development version');
const { argv = [] } = process;
const [, , destination = '.artifacts/package'] = argv;
const reportRoot = resolve(root, destination);

ok(reportRoot.startsWith(join(root, '.artifacts') + sep), 'Package verification output must stay under .artifacts');

mkdirSync(reportRoot, { recursive: true });

const runRoot = mkdtempSync(join(reportRoot, 'install-'));
const consumer = join(runRoot, 'consumer');
const { env = {}, execPath = '' } = process;
const { PATH = '' } = env;
const environment = { ...env, PATH: `${dirname(execPath)}${delimiter}${PATH}` };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (command, args, cwd, name) => {
    const start = performance.now();

    try {
        const output = execFileSync(command, args, { cwd, env: environment, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

        // eslint-disable-next-line resilient/prefer-safe-transformations -- This verifier owns the per-run command timings and publishes them as plain report data.
        timings.set(name, performance.now() - start);
        writeFileSync(join(runRoot, `${name}.log`), output);

        return output;
    } catch (error) {
        const { stdout = '', stderr = '' } = error;

        writeFileSync(join(runRoot, `${name}.log`), stdout);
        writeFileSync(join(runRoot, `${name}.stderr`), stderr);
        throw error;
    }
};
const pack = (cwd, name) => {
    const output = run('npm', ['pack', '--ignore-scripts', '--json', '--cache', join(root, '.artifacts/npm-cache'), '--pack-destination', runRoot], cwd, name);
    const [{ filename = '', files = [] } = {}] = JSON.parse(output);
    const hashes = Object.fromEntries(files.map(({ path = '' } = {}) => [path, hash(readFileSync(join(cwd, path)))]));

    return { filename, sha256: hash(readFileSync(join(runRoot, filename))), files: hashes };
};
const discovered = readdirSync(join(root, 'tests')).filter(file => file.endsWith('.test.js')).toSorted();
const tests = discovered.filter((file) => {
    if (['architecture.test.js', 'rule-inventory.test.js', 'eslint-configuration.test.js'].includes(file)) return false;

    // Internal compiler-decision tests stay local. Public output contracts run
    // once through the installed transformer, shared rules and runtime helpers.
    if (file.startsWith('typescript-') && !['typescript-tuple-return-scope.test.js', 'typescript-output-contracts.test.js'].includes(file)) return false;

    const source = readFileSync(join(root, 'tests', file), 'utf8');
    const { body = [] } = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });

    return body.some(({ type = '', source: { value = '' } = {} } = {}) => type === 'ImportDeclaration' && value.startsWith('eslint-plugin-resilient/')) || file === 'promise-retention.test.js';
});
const { rules = [] } = JSON.parse(readFileSync(join(root, 'config/rule-inventory.json'), 'utf8'));
const installedTests = new Set(tests);
const internalTests = discovered.filter(file => !installedTests.has(file));

ok(tests.length && internalTests.length);
deepStrictEqual([...internalTests, ...tests].toSorted(), discovered, 'Every maintained suite must run in exactly one environment');
rules.forEach(({ name = '', coverage = [] } = {}) => coverage.filter(file => file.startsWith('tests/'))
    .forEach(file => ok(tests.includes(file.slice('tests/'.length)), `${name}: missing retained suite ${file}`)));
saveReport(join(runRoot, 'test-suites.json'), { local: internalTests, installed: tests });
const localOutput = run(execPath, ['--test', '--test-concurrency=2', ...internalTests.map(file => `tests/${file}`)], root, 'internal-tests');
const artifact = pack(root, 'pack-package');

mkdirSync(consumer);
saveReport(join(consumer, 'package.json'), {
    name: 'resilient-installed-rehearsal', private: true, type: 'module',
    scripts: { lint: 'resilient-check', fix: 'resilient-check --fix', check: 'resilient-check' },
    dependencies: {
        'eslint-plugin-resilient': `file:../${artifact.filename}`,
        eslint: eslintVersion
    }
});
run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(root, '.artifacts/npm-cache'), '--prefer-offline'], consumer, 'install');
run('npm', ['ls', '--all', '--json'], consumer, 'dependency-tree');
saveReport(join(consumer, 'expected-package-files.json'), { 'eslint-plugin-resilient': artifact });
mkdirSync(join(consumer, 'tests'));
const assertions = Object.fromEntries(tests.map((file) => {
    const source = join(root, 'tests', file);
    const destination = join(consumer, 'tests', file);

    cpSync(source, destination);
    deepStrictEqual(readFileSync(destination), readFileSync(source));

    return [file, hash(readFileSync(source))];
}));

cpSync(join(root, 'tests/fixtures'), join(consumer, 'tests/fixtures'), { recursive: true });
cpSync(join(root, 'tests/installed'), join(consumer, 'tests/installed'), { recursive: true });
cpSync(join(root, 'tests/support'), join(consumer, 'tests/support'), { recursive: true });
writeFileSync(join(consumer, 'eslint.config.js'), "import production from 'eslint-plugin-resilient/production';\nexport default production({ aliases: { '@': 'src' } });\n");
// Reject accidental workspace/sibling imports without changing any import specifier.
writeFileSync(join(consumer, 'isolation-loader.js'), `
import { fileURLToPath } from 'node:url';
import { resolve as pathResolve, sep } from 'node:path';
const prefix = pathResolve('.') + sep;
export const resolve = async (specifier, context, next) => {
    const result = await next(specifier, context);
    if (result.url.startsWith('file:') && !fileURLToPath(result.url).startsWith(prefix)) throw new Error('Import outside installed rehearsal: ' + result.url);
    return result;
};
`);
const publicOutput = run(execPath, ['--experimental-loader', './isolation-loader.js', '--test', '--test-concurrency=2', ...tests.map(file => `tests/${file}`)], consumer, 'public-tests');
const hostOutput = run(execPath, ['--experimental-loader', './isolation-loader.js', '--test', '--test-concurrency=1', 'tests/installed/package-delivery.test.js',
    'tests/installed/production-configuration.test.js', 'tests/installed/production-exceptions.test.js', 'tests/installed/lowering-fluency.test.js',
    'tests/installed/inspection.test.js', 'tests/installed/measurement.test.js', 'tests/installed/project-tests.test.js'], consumer, 'host-tests');
const measurements = { phasesMilliseconds: Object.fromEntries(timings),
    orchestrationMilliseconds: performance.now() - verificationStart - [...timings.values()].reduce((total, duration) => total + duration, 0) };
const summary = { consumer, artifact, assertions, measurements, suites: { local: internalTests, installed: tests },
    localSummary: localOutput.slice(localOutput.lastIndexOf('\n1..')), publicSummary: publicOutput.slice(publicOutput.lastIndexOf('\n1..')),
    hostSummary: hostOutput.slice(hostOutput.lastIndexOf('\n1..')), lockSha256: hash(readFileSync(join(consumer, 'package-lock.json'))) };

saveReport(join(runRoot, 'verification.json'), summary);
saveReport(join(reportRoot, 'installed.json'), summary);
report({ consumer, measurements, localSummary: summary.localSummary, publicSummary: summary.publicSummary, hostSummary: summary.hostSummary }, { pretty: true });
