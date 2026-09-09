import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { getAgreementLedger, getDynamicBoundaryLedger, getLintSummary, getLintTriage } from './artifact-reports.js';
import { createCorpusLint, createCorpusStages, runCorpusLint } from './corpus-lint.js';
import { writeJsonReport } from './json-report.js';
import { digest, hashFiles, listFiles, readJson, verifyHashes } from './proof-files.js';
import { assertMatchingRuntime, assertSupportedRuntime, checkNativeRuntime, getRuntime } from './proof-runtime.js';
import { verifyStageJournal } from './proof-stages.js';
import { createSourceGenerator, prepareMirror, runTests, transpileRuntimeProof } from './typescript-corpus.js';
import { clearContractCaches } from '../rules/contracts/eslint-graph.js';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const listTypescript = directory => readdirSync(directory).filter(name => name.endsWith('.ts')).toSorted();
const git = (directory, args = []) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
const getImplementationFiles = () => [
    ...['rules', 'transforms', 'scripts', 'integrations'].flatMap(name => listFiles(path.join(repository, name))),
    ...listFiles(path.join(repository, 'tests/fixtures/fp-ts')),
    ...['index.js', 'eslint.config.js', 'package.json', 'package-lock.json'].map(name => path.join(repository, name))
];
const getOptions = (args = []) => {
    const [first = '', second = '', ...remaining] = args;

    if (['--resume', '--verify'].includes(first) && second && !remaining.length) {
        return { mode: first, artifact: realpathSync(second) };
    }

    if (!first || first.startsWith('--')) throw new Error('Expected an fp-ts checkout.');

    let options = { mode: 'new', checkout: realpathSync(first), stop: false,
        transformerModule: path.join(repository, 'transforms/typescript/index.js'), helperRoot: repository };
    const flags = [second, ...remaining].filter(Boolean);

    // eslint-disable-next-line resilient/prefer-prototype-methods -- The argument cursor consumes a flag and its value together.
    for (let index = 0; index < flags.length; index += 1) {
        const { [index]: flag = '' } = flags;

        if (flag === '--stop-after-generation') { options = { ...options, stop: true }; continue; }

        const { [index + 1]: value = '' } = flags;

        if (!['--transformer-module', '--helper-root'].includes(flag) || !value) {
            throw new Error('Usage: check-fp-ts-corpus <checkout> [--stop-after-generation] [--transformer-module <file>] [--helper-root <directory>] | --resume <artifact> | --verify <artifact>');
        }

        if (flag === '--transformer-module') options = { ...options, transformerModule: realpathSync(value) };

        if (flag === '--helper-root') options = { ...options, helperRoot: realpathSync(value) };

        index += 1;
    }

    return options;
};
const getHelperBindings = (helperRoot = '') => Object.fromEntries(['object', 'array', 'function'].map((name) => {
    const file = realpathSync(path.join(helperRoot, `rules/support/${name}.js`));

    return [name, { file, sha256: digest(file) }];
}));
const assertFileSet = (directory = '', expected = []) => {
    if (JSON.stringify(readdirSync(directory).toSorted()) !== JSON.stringify([...expected].toSorted())) {
        throw new Error(`Corpus file set changed: ${directory}`);
    }
};
const runRuntime = (destination) => {
    try { return { value: runTests(destination), files: [path.join(destination, 'tests.json')], directories: [path.join(destination, 'coverage')] }; } catch (error) {
        const failed = mkdtempSync(path.join(destination, 'failed-runtime-'));
        ['tests.json', 'coverage'].filter(name => existsSync(path.join(destination, name)))
            .forEach(name => cpSync(path.join(destination, name), path.join(failed, name), { recursive: true }));
        throw error;
    }
};
const expectedStages = (count = 0) => [
    'setup', ...Array.from({ length: count }, (_, index) => `emit-${index}`), 'publish-raw', 'raw-lint-report',
    ...Array.from({ length: count }, (_, index) => `fix-${index}`), 'publish-fixed', 'lint-report',
    'inspection-reports', 'source-runtime', 'lowered-runtime', 'raw-runtime', 'summary'
];
const verifyArtifact = (artifact) => {
    const journal = readJson(path.join(artifact, 'stages.json'));
    verifyStageJournal(journal);
    const { stages = [], identity: { sources = [] } = {} } = journal;
    const expected = expectedStages(sources.length);
    const complete = stages.length === expected.length && expected.every(id => stages
        .some(({ id: actual = '', status = '' } = {}) => actual === id && status === 'completed'));
    process.stdout.write(`${JSON.stringify({ artifact, complete, stages: stages.map(({ id = '', status = '' } = {}) => ({ id, status })) }, null, 2)}\n`);

    if (!complete) throw new Error('Saved proof is valid but incomplete; resume the recorded artifact.');
};
const main = async () => {
    assertSupportedRuntime();
    const { mode = '', artifact: requestedArtifact = '', checkout: requestedCheckout = '', stop = false,
        transformerModule: requestedTransformer = '', helperRoot: requestedHelperRoot = '' } = getOptions(process.argv.slice(2));

    if (mode === '--verify') { verifyArtifact(requestedArtifact);

        return; }

    const { identity: previous = {} } = requestedArtifact ? readJson(path.join(requestedArtifact, 'stages.json')) : {};
    const { checkout: previousCheckout = '', transformerModule: previousTransformer = '',
        helperRoot: previousHelperRoot = '', runtime: previousRuntime = {} } = previous;
    const checkout = previousCheckout || requestedCheckout;
    const transformerModule = previousTransformer || requestedTransformer;
    const helperRoot = previousHelperRoot || requestedHelperRoot;

    if (requestedArtifact) assertMatchingRuntime({ expected: previousRuntime });

    const { name = '', version = '' } = readJson(path.join(checkout, 'package.json'));

    if (name !== 'fp-ts') throw new Error('This behavioral corpus requires an fp-ts checkout with installed test dependencies.');

    if (git(checkout, ['status', '--porcelain', '--', 'src', 'test'])) throw new Error('Use an unchanged upstream src/test tree.');

    const native = checkNativeRuntime(checkout);
    const upstream = { name, version, commit: git(checkout, ['rev-parse', 'HEAD']) };
    const sources = listTypescript(path.join(checkout, 'src'));
    const tests = listTypescript(path.join(checkout, 'test'));
    const javascriptNames = sources.map(name => name.replace(/\.ts$/u, '.js'));
    const helpers = getHelperBindings(helperRoot);
    const transformerRoot = path.resolve(path.dirname(transformerModule), '../..');
    const transformerFiles = transformerRoot === repository ? [] : [
        ...listFiles(path.join(transformerRoot, 'transforms')),
        ...listFiles(path.join(transformerRoot, 'rules/support')),
        path.join(transformerRoot, 'package.json')
    ];
    const inputs = hashFiles([
        ...getImplementationFiles(), ...transformerFiles, ...Object.values(helpers).map(({ file = '' } = {}) => file),
        ...['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'].map(name => path.join(checkout, name)).filter(existsSync),
        ...sources.map(name => path.join(checkout, 'src', name)), ...tests.map(name => path.join(checkout, 'test', name))
    ]);
    const artifact = requestedArtifact || realpathSync(mkdtempSync(path.join(tmpdir(), 'resilient-fp-ts-proof-')));
    const generated = path.join(artifact, 'generated');
    const baseline = path.join(artifact, 'baseline');
    const { run = undefined } = createCorpusStages({ file: path.join(artifact, 'stages.json'), inputs,
        identity: { checkout, runtime: getRuntime(), upstream, native, sources, tests, transformerModule, helperRoot, helpers } });
    process.stdout.write(`Runtime proof artifacts: ${artifact}\n`);
    await run({ id: 'setup', retry: false, execute: () => {
        [baseline, generated].forEach(destination => prepareMirror({ checkout, destination, sources, tests }));
        const helperFile = path.join(artifact, 'helper-bindings.json');
        writeJsonReport(helperFile, helpers);

        return { files: [helperFile, path.join(generated, 'proof/coverage.js'), ...[baseline, generated].flatMap(destination => [
            path.join(destination, 'package.json'), path.join(destination, 'vitest.config.mjs')
        ])], directories: [
            path.join(baseline, 'src'), path.join(baseline, 'test'), path.join(baseline, 'proof'),
            path.join(generated, 'test')
        ] };
    } });
    const { href: transformerUrl = '' } = pathToFileURL(transformerModule);
    const { createTypeScriptTransformer = undefined } = await import(transformerUrl);

    if (typeof createTypeScriptTransformer !== 'function') throw new Error('Transformer module does not export createTypeScriptTransformer.');

    const generate = createSourceGenerator({ checkout, sources, tests, standardRoot: helperRoot,
        createTransformer: createTypeScriptTransformer });
    const lint = createCorpusLint({ generated, configFile: path.join(repository, 'eslint.config.js') });
    let emitted = [];

    // eslint-disable-next-line resilient/prefer-prototype-methods -- Each durable stage lowers and immediately lints one unchanged file before the next begins.
    for (const [index = 0, name = ''] of sources.entries()) {
        const value = await run({ id: `emit-${index}`, execute: async () => {
            const attempts = path.join(generated, 'emission-attempts');
            mkdirSync(attempts, { recursive: true });
            const attempt = mkdtempSync(path.join(attempts, `${index}-`));
            const emittedRoot = path.join(attempt, 'generated');
            const baselineRoot = path.join(attempt, 'baseline');
            const record = generate(name, { destination: emittedRoot, baselineDestination: baselineRoot });
            const raw = path.join(emittedRoot, 'js', name.replace(/\.ts$/u, '.js'));
            const rawHash = digest(raw);
            const rawLint = await lint.raw({ code: readFileSync(raw, 'utf8'),
                file: path.join(generated, 'raw-js', path.basename(raw)) });
            verifyHashes({ [raw]: rawHash });
            const report = path.join(attempt, 'raw-lint.json');
            writeJsonReport(report, rawLint);

            return { value: { name, record, raw, emitted: path.join(emittedRoot, 'src', name),
                baseline: path.join(baselineRoot, 'js', path.basename(raw)), lint: rawLint },
            files: [raw, path.join(emittedRoot, 'src', name), path.join(baselineRoot, 'js', path.basename(raw)), report] };
        } });
        emitted = [...emitted, value];
    }
    const evidence = await run({ id: 'publish-raw', execute: () => {
        const manifest = emitted.map(({ record = {} } = {}) => record);
        mkdirSync(path.join(generated, 'raw-js'), { recursive: true });
        mkdirSync(path.join(baseline, 'js'), { recursive: true });
        emitted.forEach(({ name = '', raw = '', emitted: source = '', baseline: baselineFile = '' } = {}) => {
            copyFileSync(source, path.join(generated, 'src', name));
            copyFileSync(raw, path.join(generated, 'raw-js', path.basename(raw)));
            copyFileSync(baselineFile, path.join(baseline, 'js', path.basename(baselineFile)));
        });
        assertFileSet(path.join(generated, 'src'), sources);
        assertFileSet(path.join(generated, 'raw-js'), javascriptNames);
        assertFileSet(path.join(baseline, 'js'), javascriptNames);
        const manifestFile = path.join(artifact, 'manifest.json');
        const helpersFile = path.join(generated, 'helpers.json');
        const ledgerFile = path.join(generated, 'agreement-ledger.json');
        const contracts = path.join(generated, 'proof/contracts.js');
        const value = { upstream, sourceFiles: sources.length, unchangedTestFiles: tests.length,
            runtime: process.version, manifest, testHashes: tests.map(file => ({ file, sha256: digest(path.join(checkout, 'test', file)) })) };
        writeJsonReport(manifestFile, value);
        writeJsonReport(helpersFile, manifest.filter(({ helpers: fileHelpers = [] } = {}) => fileHelpers.length));
        writeJsonReport(ledgerFile, getAgreementLedger({ manifest }));
        transpileRuntimeProof({ file: path.join(repository, 'tests/fixtures/fp-ts/contracts.ts'), destination: contracts });

        return { value, files: [manifestFile, helpersFile, ledgerFile, contracts], directories: [
            path.join(generated, 'src'), path.join(generated, 'raw-js'), path.join(baseline, 'js')
        ] };
    } });
    const rawLint = await run({ id: 'raw-lint-report', execute: async () => {
        const immediate = emitted.map(({ lint: row = {} } = {}) => row);
        let results = [];
        const rawDirectory = path.join(generated, 'raw-js');
        assertFileSet(rawDirectory, javascriptNames);
        const hashes = hashFiles(listFiles(rawDirectory));

        // eslint-disable-next-line resilient/prefer-prototype-methods -- Completed-module context can differ from the immediate per-file observation.
        for (const name of javascriptNames) {
            const file = path.join(rawDirectory, name);
            const row = await lint.raw({ code: readFileSync(file, 'utf8'), file });
            results = [...results, row];
            const { [file]: hash = '' } = hashes;
            verifyHashes({ [file]: hash });
        }
        verifyHashes(hashes);
        const file = path.join(artifact, 'raw-emission-lint.json');
        const immediateFile = path.join(artifact, 'raw-immediate-lint.json');
        const inspection = path.join(artifact, 'raw-emission-inspection.json');
        writeJsonReport(immediateFile, immediate);
        writeJsonReport(file, results);
        writeJsonReport(inspection, { hashes, checkedFiles: results.length });

        return { value: getLintSummary(results), files: [file, immediateFile, inspection] };
    } });
    clearContractCaches();

    if (stop) return;

    const lintFixed = await runCorpusLint({ generated, sources, run, lint });
    const lintFixedTriage = await run({ id: 'inspection-reports', execute: () => {
        const triage = getLintTriage(readJson(path.join(generated, 'lint-fixed.json')));
        const triageFile = path.join(generated, 'lint-fixed-triage.json');
        const boundaryFile = path.join(generated, 'dynamic-boundaries.json');
        writeJsonReport(triageFile, triage);
        writeJsonReport(boundaryFile, getDynamicBoundaryLedger({ directory: path.join(generated, 'js') }));

        return { value: triage, files: [triageFile, boundaryFile] };
    } });
    const baselineResult = await run({ id: 'source-runtime', execute: () => runRuntime(baseline) });
    const generatedResult = await run({ id: 'lowered-runtime', execute: () => runRuntime(generated) });
    const rawResult = await run({ id: 'raw-runtime', execute: () => {
        const destination = path.join(artifact, 'raw-runtime');
        prepareMirror({ checkout, destination, sources, tests });
        cpSync(path.join(generated, 'raw-js'), path.join(destination, 'js'), { recursive: true });
        assertFileSet(path.join(destination, 'js'), javascriptNames);
        copyFileSync(path.join(generated, 'helpers.json'), path.join(destination, 'helpers.json'));
        transpileRuntimeProof({ file: path.join(repository, 'tests/fixtures/fp-ts/contracts.ts'),
            destination: path.join(destination, 'proof/contracts.js') });
        const { hashes = {} } = readJson(path.join(artifact, 'raw-emission-inspection.json'));
        Object.entries(hashes).forEach(([file = '', hash = ''] = []) => verifyHashes({ [path.join(destination, 'js', path.basename(file))]: hash }));
        const result = runRuntime(destination);
        verifyHashes(hashes);
        assertFileSet(path.join(destination, 'js'), javascriptNames);
        Object.entries(hashes).forEach(([file = '', hash = ''] = []) => verifyHashes({ [path.join(destination, 'js', path.basename(file))]: hash }));

        return result;
    } });
    await run({ id: 'summary', execute: () => {
        const file = path.join(artifact, 'summary.json');
        writeJsonReport(file, { ...evidence, baseline: baselineResult,
            generated: { ...generatedResult, lintFixed, lintFixedTriage }, raw: { ...rawResult, lint: rawLint } });

        return { files: [file] };
    } });
    process.stdout.write(`Runtime proof complete: ${artifact}/summary.json\n`);
};

await main();
