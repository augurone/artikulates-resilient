import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { validateManifest } from '../integrations/typescript-project-artifacts.js';
import { emitProject, observeTree, prepareProject, referenceSource } from '../integrations/typescript-project.js';
import { getOptions, runLowering } from '../scripts/lower-typescript-project.js';

const root = await mkdtemp(path.join(tmpdir(), 'resilient-artifacts-'));
const project = path.join(root, 'tsconfig.json');
const outDir = path.join(root, 'output');
const manifestPath = path.join(root, 'lowering.json');
const report = path.join(root, 'fluency.json');
const eslintConfig = path.join(root, 'eslint.config.js');
const write = () => {};

try {
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}\n');
    await mkdir(path.join(root, 'a'), { recursive: true });
    await mkdir(path.join(root, 'b'), { recursive: true });
    await writeFile(project, JSON.stringify({ compilerOptions: { target: 'esnext', module: 'nodenext', moduleResolution: 'nodenext' }, include: ['a/*.ts', 'b/*.ts'] }));
    await writeFile(path.join(root, 'a/value.ts'), 'export const one = "one";\n');
    await writeFile(path.join(root, 'b/value.ts'), 'export const two = "two";\n');
    await writeFile(eslintConfig, 'export default [{ files: ["**/*.js"], rules: { quotes: ["error", "single"] } }];\n');
    const common = { project, outDir, cwd: root, manifest: manifestPath, write };
    assert.equal(getOptions(['--project', project, '--manifest', manifestPath], root).manifest, manifestPath);
    assert.throws(() => getOptions(['--project', project, '--manifest', manifestPath, '--manifest', manifestPath], root));
    const raw = await runLowering(common);

    assert.equal(raw.ok, true, JSON.stringify(raw.diagnostics));
    const rawManifest = JSON.parse(await readFile(manifestPath, 'utf8'));

    assert.equal(validateManifest(rawManifest), true);
    assert.deepEqual(rawManifest.artifacts.map(({ output = '' } = {}) => output), ['a/value.js', 'b/value.js']);
    assert.equal(rawManifest.publishedVariant, 'raw');
    assert.equal(rawManifest.artifacts.every(({ variants: { fixed: fixedVariant = false } = {} } = {}) => !fixedVariant), true);
    await writeFile(path.join(outDir, 'extra.js'), 'extra');
    assert.throws(() => validateManifest(rawManifest), /Published output set/u);
    await rm(path.join(outDir, 'extra.js'));
    const outputBefore = await readFile(path.join(outDir, 'a/value.js'), 'utf8');

    await writeFile(path.join(outDir, 'a/value.js'), 'changed');
    assert.throws(() => validateManifest(rawManifest), /Published output hash/u);
    await writeFile(path.join(outDir, 'a/value.js'), outputBefore);
    await writeFile(path.join(rawManifest.configuration.artifactRoot, 'extra.js'), 'extra');
    assert.throws(() => validateManifest(rawManifest), /file set/u);
    await rm(path.join(rawManifest.configuration.artifactRoot, 'extra.js'));
    await writeFile(path.join(rawManifest.configuration.artifactRoot, 'raw/a/value.js'), 'changed');
    assert.throws(() => validateManifest(rawManifest), /hash differs/u);
    const fixed = await runLowering({ ...common, fixAll: true, report, eslintConfig });

    assert.equal(fixed.ok, true, JSON.stringify(fixed.diagnostics));
    const fixedManifest = JSON.parse(await readFile(manifestPath, 'utf8'));

    assert.equal(validateManifest(fixedManifest), true);
    assert.equal(fixedManifest.publishedVariant, 'fixed');
    assert.equal(fixedManifest.artifacts.every(({ variants: { fixed: fixedVariant = false, raw: rawVariant = false } = {} } = {}) => fixedVariant && rawVariant), true);
    assert.equal(fixedManifest.artifacts[0].variants.raw.sha256, rawManifest.artifacts[0].variants.raw.sha256);
    assert.notEqual(fixedManifest.artifacts[0].variants.raw.sha256, fixedManifest.artifacts[0].variants.fixed.sha256);
    const { configuration: { artifactRoot: retainedRoot = '' } = {} } = fixedManifest;
    const operations = await Promise.all(fixedManifest.operations.map(async ({ path: operationPath = '' } = {}) => {
        const bytes = await readFile(path.join(retainedRoot, operationPath), 'utf8');

        return JSON.parse(bytes);
    }));
    const rawObservation = operations.find(({ id = '' } = {}) => id === 'observe:raw');
    const fixedObservation = operations.find(({ id = '' } = {}) => id === 'observe:fixed');
    const publication = operations.find(({ id = '' } = {}) => id === 'publish:tree');

    assert.equal(rawObservation.dependencyResults.length, 2);
    assert.equal(fixedObservation.dependencyResults.length, 2);
    assert.deepEqual(publication.outputSets, [{ root: outDir, files: ['a/value.js', 'b/value.js'] }]);
    assert.equal(publication.dependencyResults.length, 2);
    const { helpers: { object: objectHelper = {} } = {} } = fixedManifest;
    const { inputs: [firstInput = {}, ...otherInputs] = [] } = objectHelper;
    const changedHelper = { ...fixedManifest, helpers: { ...fixedManifest.helpers,
        object: { ...objectHelper, inputs: [{ ...firstInput, sha256: '0'.repeat(64) }, ...otherInputs] } } };

    assert.throws(() => validateManifest(changedHelper), /Invalid lowering operation/u);
    assert.equal(operations.filter(({ operation = '' } = {}) => operation === 'fix').every(({ dependencyResults = [] } = {}) => dependencyResults.length === 2), true);
    const prepared = prepareProject({ project, outDir, cwd: root });
    const reference = referenceSource({ prepared, fileName: path.join(root, 'a/value.ts') });

    assert.match(reference.code, /export const one/u);
    const firstAttempt = await mkdtemp(path.join(root, 'attempt-one-'));
    const secondAttempt = await mkdtemp(path.join(root, 'attempt-two-'));
    let transformCalls = 0;
    let completed = false;
    const transformer = { transform: ({ code = '' } = {}) => {
        transformCalls += 1;

        return { code, diagnostics: [], agreements: [], generatedHelpers: [] };
    } };
    const operation = { prepared, transformer, contextSha256: 'same-context', cwd: root, write };

    await assert.rejects(emitProject({ ...operation, stageRoot: firstAttempt, onResult: async (record) => {
        completed = record;
        throw new Error('interrupted after first source');
    } }), /interrupted after first source/u);
    assert.equal(transformCalls, 1);
    const resumed = await emitProject({ ...operation, stageRoot: secondAttempt,
        reuse: new Map([[completed.fileName, completed]]) });

    assert.equal(transformCalls, 2, 'Completed source must not be transformed again after interruption');
    assert.equal(resumed.length, 2);
    const expectedTree = resumed.map(({ relative = '', sha256 = '' } = {}) => ({ relative, sha256 }));
    const observed = await observeTree({ prepared, root: secondAttempt, expected: expectedTree,
        worker: { lint: async ({ code = '' } = {}) => ({ output: code, result: {} }) }, cwd: root, write });

    assert.equal(observed.length, 2);
    await writeFile(path.join(secondAttempt, 'extra.js'), 'extra');
    await assert.rejects(observeTree({ prepared, root: secondAttempt, expected: expectedTree,
        worker: { lint: async () => ({}) } }), /complete recorded sibling set/u);
    await rm(path.join(secondAttempt, 'extra.js'));
    let fixCalls = 0;
    let completedFix = false;
    const fixWorker = { lint: async ({ code = '' } = {}) => {
        fixCalls += 1;

        return { output: code, result: {} };
    } };
    const fixOperation = { prepared, root: secondAttempt, expected: expectedTree, worker: fixWorker,
        fix: true, contextSha256: 'same-context', cwd: root, write };

    await assert.rejects(observeTree({ ...fixOperation, onResult: async (record) => {
        completedFix = record;
        throw new Error('interrupted after first fix');
    } }), /interrupted after first fix/u);
    assert.equal(fixCalls, 1);
    const resumedFix = await observeTree({ ...fixOperation, reuse: new Map([[completedFix.source, completedFix]]) });

    assert.equal(fixCalls, 2, 'Completed fix must not run again after interruption');
    assert.equal(resumedFix.length, 2);
    await assert.rejects(emitProject({ ...operation, stageRoot: firstAttempt,
        reuse: new Map([[completed.fileName, { ...completed, sourceSha256: 'changed' }]]) }), /differs from its input or context/u);
    const previous = {
        manifest: await readFile(manifestPath, 'utf8'), report: await readFile(report, 'utf8'),
        output: await Promise.all(['a/value.js', 'b/value.js'].map(name => readFile(path.join(outDir, name), 'utf8'))),
        artifacts: await readdir(fixedManifest.configuration.artifactRoot)
    };
    const rejected = await runLowering({ ...common, fixAll: true, report: path.join(root, 'missing', 'report.json'), eslintConfig });

    assert.equal(rejected.ok, false);
    assert.equal(await readFile(manifestPath, 'utf8'), previous.manifest);
    assert.equal(await readFile(report, 'utf8'), previous.report);
    assert.deepEqual(await Promise.all(['a/value.js', 'b/value.js'].map(name => readFile(path.join(outDir, name), 'utf8'))), previous.output);
    assert.deepEqual(await readdir(fixedManifest.configuration.artifactRoot), previous.artifacts);
} finally {
    await rm(root, { recursive: true, force: true });
}
