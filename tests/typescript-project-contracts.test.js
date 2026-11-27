import assert from 'node:assert/strict';
import { spawnSync, execFileSync, fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, access, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { getObject } from 'eslint-plugin-resilient/standard/object';

import { validateManifest } from '../integrations/typescript-project-artifacts.js';
import { emitProject, observeTree, prepareProject, referenceSource, planDestinations } from '../integrations/typescript-project.js';
import { getLintSummary } from '../scripts/fluency-report.js';
import { getOptions, runLowering } from '../scripts/lower-typescript-project.js';
import { jobSources, observeJobApplication } from './support/job-application.js';

// Real project preparation, output routing, manifests, unchanged inputs and failed-publication behavior are one delivery transaction; frozen byte and native/installed observations remain.

{
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
}

{
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'resilient-completion-')));
    const write = (name, text) => {
        mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
        writeFileSync(path.join(root, name), text);
    };
    const lower = async (directory, extra = {}) => {
        const project = path.join(root, directory);
        const result = await runLowering({ project, outDir: path.join(project, 'output'), cwd: project, write: () => {}, ...extra });
        const { ok = false, diagnostics = [] } = result;
        assert.equal(ok, true, diagnostics.map(({ stack = '', messageText = '' } = {}) => stack || messageText).join('\n'));

        return result;
    };
    const execute = (directory, file, expected) => {
        const child = spawnSync(process.execPath, [file], { cwd: path.join(root, directory), encoding: 'utf8' });
        const { status = 0, stderr = '', stdout = '' } = child;
        assert.equal(status, 0, stderr);
        assert.equal(stdout.trim(), expected);
    };
    const config = (module, resolution, extra = {}) => JSON.stringify({ compilerOptions: {
        target: 'ES2020', module, moduleResolution: resolution, rootDir: 'src', ...extra
    }, include: ['src/**/*'] });

    try {
        write('aliases/package.json', '{"type":"module","imports":{"#value":"./src/value.ts"}}');
        write('aliases/tsconfig.json', config('ESNext', 'Bundler', { paths: { '@/*': ['./src/*'] } }));
        write('aliases/src/value.ts', 'export const value = 41;\n');
        write('aliases/src/types.ts', 'export type Shape = number;\n');
        write('aliases/src/unrelated.ts', 'export const unrelated = true;\n');
        write('aliases/src/nested/index.ts', 'export { value } from "@/value";\n');
        write('aliases/src/main.ts', [
            'import { value } from "@/nested";',
            'import type { Shape } from "@/types";',
            'export { value } from "#value";',
            'export const text = "@/value";',
            'export const answer: Shape = value + 1;',
            'export const later = () => import("@/value");'
        ].join('\n'));
        const project = path.join(root, 'aliases');
        const original = readFileSync(path.join(project, 'tsconfig.json'));
        const inspected = await lower('aliases', { emit: ['src/main.ts'], inspect: true });
        assert.equal(existsSync(path.join(project, 'output')), false);
        assert.deepEqual(inspected.plan.selectedSources.map(file => path.basename(file)).toSorted(), ['index.ts', 'main.ts', 'value.ts']);
        assert.equal(inspected.plan.runtimeRoutes.some(({ specifier = '', runtimeSpecifier = '' } = {}) => specifier === '#value' && runtimeSpecifier === './value.js'), true);
        const manifest = path.join(project, 'manifest.json');
        await lower('aliases', { emit: ['src/main.ts'], manifest });
        write('aliases/run.js', 'import {answer, text, later} from "./output/main.js"; if ((await later()).value !== 41 || text !== "@/value") throw Error(); process.stdout.write(String(answer));');
        execute('aliases', 'run.js', '42');
        assert.deepEqual(readFileSync(path.join(project, 'tsconfig.json')), original);
        const frozen = JSON.parse(readFileSync(manifest, 'utf8'));
        assert.deepEqual(frozen.configuration.effectiveResilient.runtimeRoutes, inspected.plan.runtimeRoutes);
        validateManifest(frozen);

        write('bridge/package.json', '{"type":"module"}');
        write('bridge/tsconfig.json', config('ESNext', 'Bundler'));
        write('bridge/src/value.ts', 'export const value = 20;');
        write('bridge/src/nested/index.ts', 'export const nested = 2;');
        write('bridge/src/main.ts', [
            'import {value} from "@/value";',
            'import {value as explicit} from "@/value.js";',
            'import {nested} from "@/nested";',
            'export const answer = value + explicit + nested;'
        ].join('\n'));
        write('bridge/eslint.config.js', [
            `import resilient from ${JSON.stringify(path.join(process.cwd(), 'index.js'))};`,
            `export default [resilient.imports({cwd: ${JSON.stringify(path.join(root, 'bridge'))}, aliases: {'@':'src'}})];`
        ].join('\n'));
        write('bridge/resilient.project.json', JSON.stringify({ schemaVersion: 2, resolution: { eslintConfig: './eslint.config.js' } }));
        const bridge = await lower('bridge', { inspect: true });
        assert.deepEqual(bridge.plan.runtimeRoutes.map(({ specifier = '', runtimeSpecifier = '', owner = '' } = {}) => ({ specifier, runtimeSpecifier, owner })), [
            { specifier: '@/value', runtimeSpecifier: './value.js', owner: 'eslint' },
            { specifier: '@/value.js', runtimeSpecifier: './value.js', owner: 'eslint' },
            { specifier: '@/nested', runtimeSpecifier: './nested/index.js', owner: 'eslint' }
        ]);
        write('bridge/tsconfig.json', config('NodeNext', 'NodeNext'));
        await lower('bridge');
        write('bridge/run.js', 'import {answer} from "./output/main.js"; process.stdout.write(String(answer));');
        execute('bridge', 'run.js', '42');
        write('bridge/eslint.config.js', [
            `const targets = new Map(${JSON.stringify([
                ['@/value', path.join(root, 'bridge/src/value.js')],
                ['@/value.js', path.join(root, 'bridge/src/value.js')],
                ['@/nested', path.join(root, 'bridge/src/nested/index.js')]
            ])});`,
            'export default [{settings:{resilient:{resolver:({source}) =>',
            'targets.get(source) || ""}}}];'
        ].join('\n'));
        await lower('bridge');
        execute('bridge', 'run.js', '42');

        write('provider/package.json', '{"type":"module"}');
        write('provider/tsconfig.json', config('ESNext', 'Bundler'));
        write('provider/src/value.ts', 'export const value = 42;');
        write('provider/src/main.ts', 'import {value} from "custom:value"; export const answer = value;');
        write('provider/facts.js', 'export const target = "src/value.ts";');
        write('provider/resilient.project.js', [
            'import {target} from "./facts.js"; export default {schemaVersion:1,',
            'resolveImport: ({specifier}) => specifier === "custom:value" ? {kind:"source", source:target} : null};'
        ].join('\n'));
        write('provider/resilient.project.json', '{"schemaVersion":2,"provider":"./resilient.project.js"}');
        const providerManifest = path.join(root, 'provider/manifest.json');
        await lower('provider', { manifest: providerManifest });
        const providerRecord = JSON.parse(readFileSync(providerManifest, 'utf8'));
        assert.equal(providerRecord.configuration.files.some(({ path: file = '' } = {}) => file === path.join(root, 'provider/facts.js')), true);
        write('provider/facts.js', 'export const target = "src/main.ts";');
        assert.throws(() => validateManifest(providerRecord), /hash|changed/u);
        write('provider/facts.js', 'export const target = "src/value.ts";');
        const prior = readFileSync(path.join(root, 'provider/output/main.js'));
        write('provider/resilient.project.js', 'export default {schemaVersion:1, resolveImport: () => {throw Error("bad provider");}};');
        const failed = await runLowering({ project: path.join(root, 'provider'), outDir: path.join(root, 'provider/output'), write: () => {} });
        assert.equal(failed.ok, false);
        assert.deepEqual(readFileSync(path.join(root, 'provider/output/main.js')), prior);
        write('provider/resilient.project.js', 'export default {schemaVersion:1, resolveImport: () => ({handled:true})};');
        assert.throws(() => prepareProject({ project: path.join(root, 'provider'), cwd: path.join(root, 'provider') }), /Invalid provider route/u);

        // Alternate module formats are rejected before replacing an existing output.
        write('unsupported/package.json', '{"type":"module"}');
        write('unsupported/src/main.ts', 'export const answer = 42;');
        write('unsupported/output/main.js', 'export const preserved = true;');
        const unsupported = path.join(root, 'unsupported');
        const unchanged = readFileSync(path.join(unsupported, 'output/main.js'));
        write('unsupported/tsconfig.json', config('CommonJS', 'Node10'));
        assert.throws(() => prepareProject({ project: unsupported, outDir: path.join(unsupported, 'output') }), /Unsupported lowering compiler configuration/u);
        write('unsupported/tsconfig.json', config('NodeNext', 'NodeNext'));
        write('unsupported/package.json', '{"type":"commonjs"}');
        assert.throws(() => prepareProject({ project: unsupported, outDir: path.join(unsupported, 'output') }), /type: module/u);
        write('unsupported/package.json', '{"type":"module"}');
        ['.cts', '.mts'].forEach((extension) => {
            const name = `unsupported/src/legacy${extension}`;
            write(name, 'export const legacy = 1;');
            assert.throws(() => prepareProject({ project: unsupported, outDir: path.join(unsupported, 'output') }), /Unsupported executable TypeScript source/u);
            rmSync(path.join(root, name));
        });
        write('unsupported/destination/package.json', '{"type":"commonjs"}');
        write('unsupported/destination/output/main.js', 'preserve output in unsupported scope');
        const unsupportedOutput = path.join(unsupported, 'destination/output');
        assert.throws(() => prepareProject({ project: unsupported, outDir: unsupportedOutput }), /type: module/u);
        assert.equal(readFileSync(path.join(unsupportedOutput, 'main.js'), 'utf8'), 'preserve output in unsupported scope');
        assert.deepEqual(readFileSync(path.join(unsupported, 'output/main.js')), unchanged);
        {
            const application = path.join(root, 'module-namespaces');
            const output = path.join(application, 'output');
            const native = path.join(application, 'native');
            const report = path.join(application, 'report.json');
            const manifest = path.join(application, 'manifest.json');
            const profile = path.join(application, 'eslint.config.js');
            const sources = {
                'state.ts': 'export const token = {}; export const failure = new Error("module failure"); export const answer = 42;',
                'effect.ts': 'import { token } from "./state.js"; Object.freeze(token);',
                'empty.ts': 'import "./effect.js"; export interface Contract { value: string; } type Secret = number; export type { Secret }; export {};',
                'barrel.ts': 'export {} from "./empty.js";',
                'augmentation.ts': 'export {}; declare module "./barrel.js" { interface Extension { marker: string; } }',
                'value-barrel.ts': 'export { answer } from "./state.js";',
                'failure.ts': 'import { failure } from "./state.js"; throw failure;',
                'empty-failure.ts': 'import "./failure.js"; export interface Contract { value: string; }',
                'failure-entry.ts': 'import * as blocked from "./empty-failure.js"; export { blocked };',
                'boundary.ts': 'import * as external from "external-empty"; export { external };',
                'main.ts': [
                    '// eslint-disable-next-line import/namespace -- Authored empty namespace identity is required.',
                    'import * as authored from "./barrel.js";',
                    'import * as barrel from "./barrel.js";',
                    'import * as first from "./empty.js";',
                    'import * as second from "./empty.js";',
                    'import * as values from "./value-barrel.js";',
                    'import type * as erased from "./empty-failure.js";',
                    'export type Hidden = erased.Contract;',
                    'export { first, second, second as renamed, barrel, authored, values };',
                    'export * as forwarded from "./barrel.js";'
                ].join('\n')
            };
            write('module-namespaces/package.json', '{"type":"module","dependencies":{"external-empty":"1.0.0"}}');
            write('module-namespaces/tsconfig.json', config('ESNext', 'Bundler'));
            write('module-namespaces/eslint.config.js', `import production from ${JSON.stringify(import.meta.resolve('eslint-plugin-resilient/production'))};\n`
                + `export default production({ cwd: ${JSON.stringify(application)} });\n`);
            write('module-namespaces/node_modules/external-empty/package.json', '{"name":"external-empty","version":"1.0.0","type":"module","types":"./index.d.ts","exports":"./index.js"}');
            write('module-namespaces/node_modules/external-empty/index.d.ts', 'export interface External { value: string; }');
            write('module-namespaces/node_modules/external-empty/index.js', 'export {};');
            Object.entries(sources).forEach(([name = '', source = ''] = []) => write(`module-namespaces/src/${name}`, source));
            const prepared = prepareProject({ project: application, outDir: output, cwd: application });
            const { destinations = [] } = prepared;
            destinations.forEach(({ fileName = '', relative = '' } = {}) => {
                const { code = '', diagnostics = [] } = referenceSource({ prepared, fileName });

                assert.deepEqual(diagnostics, []);
                write(`module-namespaces/native/${relative}`, code);
            });
            const observe = (directory) => {
                const { href: base = '' } = pathToFileURL(directory + path.sep);
                const child = spawnSync(process.execPath, ['--input-type=module', '-e', [
                    'import assert from "node:assert/strict";',
                    `const base = ${JSON.stringify(base)};`,
                    'const load = name => import(new URL(name + ".js", base));',
                    'const state = await load("state");',
                    'const entry = await load("main");',
                    'const boundary = await load("boundary");',
                    'assert.equal(entry.first, entry.second);',
                    'assert.equal(entry.first, entry.renamed);',
                    'assert.equal(entry.barrel, entry.forwarded);',
                    'assert.equal(entry.barrel, entry.authored);',
                    'assert.notEqual(entry.first, entry.barrel);',
                    'assert.equal(Object.getPrototypeOf(entry.first), null);',
                    'assert.equal(Object.isExtensible(entry.first), false);',
                    'assert.deepEqual(Object.keys(entry.first), []);',
                    'assert.deepEqual(Object.keys(entry.barrel), []);',
                    'assert.deepEqual(Object.keys(boundary.external), []);',
                    'assert.equal(entry.values.answer, 42);',
                    'assert.equal(Object.isFrozen(state.token), true);',
                    'await assert.rejects(load("failure-entry"), error => error === state.failure);',
                    'process.stdout.write("passed");'
                ].join('\n')], { cwd: application, encoding: 'utf8' });
                const { status = 0, stderr = '', stdout = '' } = child;

                assert.equal(status, 0, stderr);
                assert.equal(stdout, 'passed');
                const dependency = path.join(directory, 'empty.js');
                const bytes = readFileSync(dependency);
                rmSync(dependency);

                try {
                    const missing = spawnSync(process.execPath, ['--input-type=module', '-e', [
                        'import assert from "node:assert/strict";',
                        `const base = ${JSON.stringify(base)};`,
                        'await assert.rejects(import(new URL("main.js", base)), error =>',
                        '    error.code === "ERR_MODULE_NOT_FOUND" && error.url === new URL("empty.js", base).href);'
                    ].join('\n')], { cwd: application, encoding: 'utf8' });
                    const { status = 0, stderr = '' } = missing;

                    assert.equal(status, 0, stderr);
                } finally {
                    writeFileSync(dependency, bytes);
                }
            };
            observe(native);
            await lower('module-namespaces', { eslintConfig: profile, report, manifest, fixAll: true });
            const { configuration: { artifactRoot = '' } = {} } = JSON.parse(readFileSync(manifest, 'utf8'));
            [path.join(artifactRoot, 'raw'), output].forEach(observe);
            const { complete = false, files = [] } = JSON.parse(readFileSync(report, 'utf8'));

            assert.equal(complete, true);
            files.forEach(({ source = '', raw = {}, postFix = {} } = {}) => [raw, postFix].forEach(({ messages = [], suppressedMessages = [] } = {}) => {
                assert.deepEqual(messages.map(({ ruleId = '' } = {}) => ruleId), path.basename(source) === 'boundary.ts' ? ['import/namespace'] : [], JSON.stringify({ source, messages }));
                suppressedMessages.filter(({ ruleId = '' } = {}) => ruleId === 'import/namespace').forEach(({ suppressions = [] } = {}) => {
                    assert.notEqual(path.basename(source), 'boundary.ts');
                    assert.ok(suppressions.some(({ justification = '' } = {}) => /namespace.*identity/u.test(justification)));
                });
            }));
        }
        {
            const application = path.join(root, 'job-application');
            const output = path.join(application, 'output');
            const nativeDirectory = path.join(application, 'native');
            const report = path.join(application, 'fluency.json');
            const manifest = path.join(application, 'manifest.json');
            const config = path.join(application, 'eslint.config.js');
            const hash = bytes => createHash('sha256').update(bytes).digest('hex');
            const standard = Object.fromEntries(['object', 'array', 'function'].map(name => [
                name, fileURLToPath(import.meta.resolve(`eslint-plugin-resilient/standard/${name}`))
            ]));
            const configuration = JSON.stringify({ compilerOptions: {
                target: 'ESNext', module: 'ESNext', moduleResolution: 'Bundler', rootDir: 'src', strict: true, skipLibCheck: true
            }, include: ['src/**/*.ts'], resilient: { standard } });
            const profile = `import production from ${JSON.stringify(import.meta.resolve('eslint-plugin-resilient/production'))};\n`
            + `export default production({ cwd: ${JSON.stringify(application)} });\n`;
            const packageSource = '{"private":true,"type":"module","dependencies":{"eslint-plugin-resilient":"*"}}\n';

            write('job-application/package.json', packageSource);
            write('job-application/tsconfig.json', configuration);
            write('job-application/eslint.config.js', profile);
            Object.entries(jobSources).forEach(([name = '', source = ''] = []) => write(`job-application/src/${name}`, source));
            const prepared = prepareProject({ project: application, outDir: output, report, manifest, eslintConfig: config, cwd: application });
            // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Preparation must supply the actual compiler Program; a fallback would invalidate the native reference.
            const { diagnostics = [], program, destinations = [] } = prepared;

            assert.deepEqual(diagnostics, []);
            assert.deepEqual(typescript.getPreEmitDiagnostics(program), []);
            assert.equal(destinations.length, 4);
            destinations.forEach(({ fileName = '', relative = '' } = {}) => {
                const { diagnostics: nativeDiagnostics = [], code = '' } = referenceSource({ prepared, fileName });

                assert.deepEqual(nativeDiagnostics, []);
                mkdirSync(path.dirname(path.join(nativeDirectory, relative)), { recursive: true });
                writeFileSync(path.join(nativeDirectory, relative), code);
            });
            const native = await observeJobApplication(nativeDirectory);
            const { ok = false, diagnostics: loweringDiagnostics = [] } = await runLowering({ project: application, outDir: output, report, manifest, eslintConfig: config,
                fixAll: true, cwd: application, write: () => {} });

            assert.equal(ok, true, JSON.stringify(loweringDiagnostics));
            assert.deepEqual(loweringDiagnostics, []);
            const record = JSON.parse(readFileSync(manifest, 'utf8'));

            validateManifest(record);
            const { publishedVariant = '', selectedSources = [], artifacts = [], configuration: { artifactRoot = '' } = {} } = record;
            const expectedFiles = Object.keys(jobSources).map(name => name.replace(/\.ts$/u, '.js')).toSorted();

            assert.equal(publishedVariant, 'fixed');
            assert.equal(selectedSources.length, 4);
            assert.deepEqual(artifacts.map(({ output: file = '' } = {}) => file).toSorted(), expectedFiles);

            assert.deepEqual(await observeJobApplication(path.join(artifactRoot, 'raw')), native);
            assert.deepEqual(await observeJobApplication(output), native);
            const { complete = false, clean = false, fixApplied = false, coverage = {}, raw: rawSummary = {}, published = {}, postFix = {}, files = [] }
                = JSON.parse(readFileSync(report, 'utf8'));
            const boundaries = {
                'input.ts': {
                    'resilient/prefer-signature-destructuring': { reason: /authored object binding.*(?:copy|failure)/u, boundary: /\{[\s\S]*\.\.\.rest/u },
                    'resilient/prefer-destructured-member-access': { reason: /repeated parameter Get.*(?:order|phase)/u, boundary: /\binput\b/u }
                },
                'provider.ts': { 'func-style': { reason: /native function declaration.*(?:hoisting|callable)/iu, boundary: /\bfunction\b[\s\S]*\breadProvider\b/u } },
                'task.ts': {
                    'func-style': { reason: /native function declaration.*(?:hoisting|callable)/iu, boundary: /\bfunction\b[\s\S]*\brunTask\b/u },
                    'resilient/prefer-safe-destructuring-defaults': { reason: /required tuple.*native.*failure/iu, boundary: /\bcallback\b|\bvalue\b|\[/u }
                },
                'main.ts': {}
            };

            assert.equal(complete, true);
            assert.equal(clean, true);
            assert.equal(fixApplied, true);
            assert.deepEqual(coverage, { expected: 4, measured: 4 });
            assert.deepEqual(files.map(({ filePath = '' } = {}) => filePath).toSorted(), expectedFiles.map(file => path.join(output, file)));
            assert.deepEqual(published, postFix);
            [rawSummary, published].forEach(({ errors = -1, warnings = -1 } = {}) => assert.deepEqual([errors, warnings], [0, 0]));
            files.forEach(({ source = '', filePath = '', rawSha256 = '', publishedSha256 = '',
                profile: { configFile = '', configSha256 = '', rules = {} } = {}, raw: rawResult = {}, postFix: fixedResult = {} } = {}) => {
                const row = artifacts.find(({ source: { path: input = '' } = {} } = {}) => input === source);

                assert.ok(row);
                const { output: relative = '', variants: { raw: { path: rawPath = '', sha256: rawHash = '' } = {}, fixed: { sha256: fixedHash = '' } = {} } = {} } = row;

                assert.equal(filePath, path.join(output, relative));
                assert.equal(rawSha256, rawHash);
                assert.equal(publishedSha256, fixedHash);
                assert.equal(publishedSha256, hash(readFileSync(filePath)));
                assert.equal(configFile, config);
                assert.equal(configSha256, hash(profile));
                Object.keys(resilient.rules).forEach(name => assert.ok(Object.hasOwn(rules, `resilient/${name}`)));
                const allowed = Reflect.get(boundaries, path.basename(source));

                assert.ok(allowed);
                [[rawResult, readFileSync(path.join(artifactRoot, rawPath), 'utf8')], [fixedResult, readFileSync(filePath, 'utf8')]]
                    .forEach(([observed = {}, code = ''] = []) => {
                        const { fatalErrorCount = -1, errorCount = -1, warningCount = -1 } = observed;

                        assert.deepEqual([fatalErrorCount, errorCount, warningCount], [0, 0, 0]);
                        // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- Complete lint observations require their actual message arrays; absence cannot mean zero findings.
                        const { messages, suppressedMessages } = observed;

                        assert.deepEqual(messages, []);
                        suppressedMessages.forEach(({ ruleId = '', line = 0, endLine = 0, suppressions = [] } = {}) => {
                            assert.ok(Object.hasOwn(allowed, ruleId));
                            const { reason = /$^/u, boundary = /$^/u } = Reflect.get(allowed, ruleId);

                            assert.ok(line > 0 && endLine >= line);
                            assert.ok(suppressions.some(({ kind = '', justification = '' } = {}) => kind === 'directive' && reason.test(justification)));
                            assert.match(code.split('\n').slice(line - 1, endLine).join('\n'), boundary);
                        });
                    });
            });
            Object.entries(jobSources).forEach(([name = '', source = ''] = []) => assert.equal(readFileSync(path.join(application, 'src', name), 'utf8'), source));
            [[config, profile], [path.join(application, 'tsconfig.json'), configuration], [path.join(application, 'package.json'), packageSource]]
                .forEach(([file = '', source = ''] = []) => assert.equal(readFileSync(file, 'utf8'), source));
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

{
    const root = await mkdtemp(path.join(tmpdir(), 'resilient-project-config-'));
    const config = path.join(root, 'tsconfig.resilient.json');
    const baseline = fileURLToPath(new URL('../config/typescript-lowering.json', import.meta.url));
    const source = path.join(root, 'src');
    const output = path.join(root, 'cli-output');
    const writeConfig = async (extra = {}) => writeFile(config, JSON.stringify({
        extends: baseline,
        include: ['src/**/*.ts'],
        ...extra
    }));
    const rejectConfig = async (extra, marker) => {
        await writeConfig(extra);
        assert.throws(() => prepareProject({ project: config, outDir: output, cwd: root }), marker);
    };

    try {
        await writeFile(path.join(root, 'package.json'), '{"type":"module"}\n');
        await mkdir(source);
        await writeFile(path.join(source, 'entry.ts'), 'export const value = 42;\n');
        await writeFile(path.join(source, 'provider.ts'), 'export type Provider = number;\n');
        await writeFile(path.join(source, 'ambient.d.ts'), 'declare const external: number;\n');
        await writeConfig({ resilient: { emit: ['src/entry.ts'] } });
        const selected = prepareProject({ project: config, cwd: root });

        assert.equal(selected.compilerOptions.target, selected.program.getCompilerOptions().target);
        assert.deepEqual(selected.destinations.map(({ relative = '' } = {}) => relative), ['src/entry.js']);
        assert.equal(selected.checkerInputs.some(({ fileName = '' } = {}) => fileName.endsWith('provider.ts')), true);
        assert.equal((await runLowering({ project: config, cwd: root, write: () => {} })).ok, true);
        await access(path.join(root, '.resilient', 'src', 'entry.js'));
        await assert.rejects(access(path.join(root, '.resilient', 'provider.js')));

        await writeConfig({ compilerOptions: { outDir: 'configured-output' } });
        assert.equal(prepareProject({ project: config, cwd: root }).resolvedOutDir, path.join(root, 'configured-output'));
        assert.equal(prepareProject({ project: config, cwd: root, outDir: output }).resolvedOutDir, output);
        assert.equal((await runLowering({ project: config, cwd: root, write: () => {} })).ok, true);
        await access(path.join(root, 'configured-output', 'src', 'entry.js'));

        await writeFile(path.join(root, 'base.json'), JSON.stringify({
            extends: baseline,
            compilerOptions: { outDir: 'inherited-output' },
            resilient: { emit: ['src/entry.ts'] }
        }));
        await writeFile(config, JSON.stringify({ extends: './base.json', include: ['src/**/*.ts'] }));
        assert.equal(prepareProject({ project: config, cwd: root }).resolvedOutDir, path.join(root, '.resilient'));
        assert.deepEqual(prepareProject({ project: config, cwd: root }).destinations.map(({ relative = '' } = {}) => relative),
            ['src/entry.js', 'src/provider.js']);
        await writeConfig({ compilerOptions: { skipLibCheck: false } });
        const { compilerOptions: overrideOptions = {} } = prepareProject({ project: config, cwd: root });

        assert.equal(Reflect.get(overrideOptions, 'skipLibCheck'), false);

        await writeConfig({ compilerOptions: { target: 'ES2020' } });
        const { compilerOptions: targetOptions = {} } = prepareProject({ project: config, outDir: output, cwd: root });
        const { target: selectedTarget = 0 } = targetOptions;

        assert.equal(selectedTarget, 7);
        await rejectConfig({ compilerOptions: { module: 'AMD', moduleResolution: 'Node10' } },
            /Unsupported lowering compiler configuration/u);
        // eslint-disable-next-line resilient/no-null-assignment, resilient/prefer-prototype-methods -- Cases rewrite one config sequentially; null tests malformed options.
        for (const resilient of [null, [], 'emit', { typo: true }, { emit: 'src/*.ts' },
            // eslint-disable-next-line resilient/no-null-assignment -- Malformed project configuration deliberately supplies null to verify rejection at the public option boundary.
            { emit: [''] }, { standard: null }, { standard: { object: '' } }, { standard: { other: 'x' } }]) {
            await rejectConfig({ resilient }, /resilient|helper binding/u);
        }
        await rejectConfig({ resilient: { emit: ['src/*.d.ts'] } }, /matched no/u);
        assert.match(await readFile(path.join(root, '.resilient', 'src', 'entry.js'), 'utf8'), /export const value/u);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

{
    const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'resilient-project-lowering-')));
    const project = path.join(directory, 'project');
    const source = path.join(project, 'src');
    const output = path.join(project, 'generated');
    let messages = [];
    const write = (text) => { messages = [...messages, text]; };
    const digest = text => createHash('sha256').update(text).digest('hex');
    const workerEntry = fileURLToPath(new URL('../scripts/fix-javascript-worker.js', import.meta.url));
    const cliEntry = fileURLToPath(new URL('../scripts/lower-typescript-project.js', import.meta.url));

    try {
        await mkdir(source, { recursive: true });
        await writeFile(path.join(project, 'package.json'), '{"type":"module"}\n');
        await writeFile(path.join(project, 'tsconfig.json'), JSON.stringify({
            compilerOptions: {
                declaration: true,
                module: 'nodenext',
                moduleResolution: 'nodenext',
                rootDir: './src',
                sourceMap: true,
                strict: true,
                target: 'esnext'
            },
            include: ['src/**/*.ts']
        }));
        await writeFile(path.join(source, 'types.ts'), 'export type Label = string;\n');
        await writeFile(path.join(source, 'index.ts'), [
            'import type { Label } from "./types";',
            'export const greeting = "hello";',
            'export const render = (label: Label) => label;',
            ''
        ].join('\n'));

        const result = await runLowering({ project: path.join(project, 'tsconfig.json'), outDir: output, cwd: project, write });

        assert.equal(result.ok, true, messages.join(''));
        await access(path.join(output, 'index.js'));
        assert.match(await readFile(path.join(output, 'index.js'), 'utf8'), /export const render/u);
        assert.deepEqual(getOptions(['--project', 'project/tsconfig.json', '--outDir', 'project/generated'], directory), {
            project: path.join(project, 'tsconfig.json'),
            outDir: output,
            fixAll: false,
            // eslint-disable-next-line resilient/no-undefined-assignment -- The CLI oracle preserves the absent optional eslintConfig field.
            eslintConfig: undefined,
            // eslint-disable-next-line resilient/no-undefined-assignment -- The CLI oracle preserves the absent optional report field.
            report: undefined,
            // eslint-disable-next-line resilient/no-undefined-assignment -- The CLI oracle preserves the absent optional manifest field.
            manifest: undefined,
            emit: [],
            inspect: false
        });
        // eslint-disable-next-line resilient/no-falsifiable-property-key -- This deliberate array-like CLI input verifies indexed access without acquiring array methods.
        const argumentObject = { 0: '--project', 1: 'project/tsconfig.json', length: 2,
            get at() { throw new Error('CLI indexing must not acquire an array method.'); } };
        // eslint-disable-next-line resilient/signature-contract-call-site -- This deliberate array-like input verifies native indexed access without acquiring array methods.
        assert.deepEqual(getOptions(argumentObject, directory), getOptions(['--project', 'project/tsconfig.json'], directory));
        assert.throws(() => getOptions(['--project'], directory), /Usage:/u);
        // eslint-disable-next-line resilient/no-undefined-assignment -- The CLI option oracle preserves absent optional paths and deliberately supplied undefined arguments.
        assert.throws(() => getOptions([undefined], directory), /Usage:/u);

        assert.deepEqual(getOptions(['--project', 'project/tsconfig.json'], directory), {
            project: path.join(project, 'tsconfig.json'),
            // eslint-disable-next-line resilient/no-undefined-assignment -- The CLI oracle preserves the absent optional outDir field.
            outDir: undefined,
            fixAll: false,
            // eslint-disable-next-line resilient/no-undefined-assignment -- The CLI oracle preserves the absent optional eslintConfig field.
            eslintConfig: undefined,
            // eslint-disable-next-line resilient/no-undefined-assignment -- The CLI oracle preserves the absent optional report field.
            report: undefined,
            // eslint-disable-next-line resilient/no-undefined-assignment -- The CLI oracle preserves the absent optional manifest field.
            manifest: undefined,
            emit: [],
            inspect: false
        });
        const defaulted = await runLowering({ project: path.join(project, 'tsconfig.json'), cwd: project, write });

        assert.equal(defaulted.ok, true, messages.join(''));
        assert.equal(defaulted.outDir, path.join(project, '.resilient'));
        await access(path.join(defaulted.outDir, 'index.js'));

        const unsafe = await runLowering({ project: path.join(project, 'tsconfig.json'), outDir: source, cwd: project, write });
        assert.equal(unsafe.ok, false);

        const safety = path.join(project, 'safety');
        const safetySource = path.join(safety, 'src');
        const safetyOutput = path.join(safety, 'generated');
        const safetyConfig = path.join(safety, 'tsconfig.json');
        const safetyBase = path.join(safety, 'base.json');
        const safetyEslint = path.join(safety, 'eslint.config.js');
        const importedDirectory = path.join(safety, 'dependency');
        const imported = path.join(importedDirectory, 'authored.js');
        await mkdir(safetySource, { recursive: true });
        await writeFile(path.join(safety, 'package.json'), '{"type":"module"}\n');
        await mkdir(safetyOutput);
        await mkdir(importedDirectory);
        await writeFile(safetyBase, JSON.stringify({ compilerOptions: {
            rootDir: './src', allowJs: true, target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext'
        } }));
        await writeFile(safetyConfig, JSON.stringify({ extends: './base.json', include: ['src/**/*.ts', 'escape.ts'] }));
        await writeFile(path.join(safetySource, 'index.ts'), 'export const value = 1;\n');
        await writeFile(path.join(safety, 'escape.ts'), 'export const escaped = 2;\n');
        await writeFile(path.join(safety, 'escape.js'), '// authored JavaScript must survive\n');
        await writeFile(imported, 'export const dependency = 3;\n');
        await writeFile(safetyEslint, 'export default [{ rules: { quotes: "error" } }];\n');
        await writeFile(path.join(safetyOutput, 'previous.js'), '// prior publication must survive\n');
        const preservedFiles = [safetyConfig, safetyBase, safetyEslint, imported, path.join(safetySource, 'index.ts'),
            path.join(safety, 'escape.ts'), path.join(safety, 'escape.js'), path.join(safetyOutput, 'previous.js')];
        const rejectUnsafe = async (options = {}, marker = /project input/u) => {
            const before = await Promise.all(preservedFiles.map(file => readFile(file, 'utf8')));
            const { length: messageStart = 0 } = messages;
            const rejected = await runLowering({ project: safetyConfig, outDir: safetyOutput, cwd: safety, write, ...options });
            const { ok = true } = rejected;
            assert.equal(ok, false);
            assert.match(messages.slice(messageStart).join(''), marker);
            assert.deepEqual(await Promise.all(preservedFiles.map(file => readFile(file, 'utf8'))), before);
            assert.deepEqual(await readdir(safetyOutput), ['previous.js']);
            assert.deepEqual((await readdir(safety)).filter(name => name.startsWith('.generated-staging-') ||
                name.startsWith('.resilient-backup-') || name.startsWith('.resilient-report-')), []);
        };

        await rejectUnsafe({}, /Generated JavaScript must remain inside/u);
        // A deeper escape can write outside the project itself, even with a dedicated output directory.
        await writeFile(safetyConfig, JSON.stringify({ extends: './base.json', include: ['src/**/*.ts', '../src/index.ts'] }));
        const authoredOutside = path.join(project, 'index.js');
        await writeFile(authoredOutside, '// authored outside the project\n');
        await rejectUnsafe({}, /Generated JavaScript must remain inside/u);
        assert.equal(await readFile(authoredOutside, 'utf8'), '// authored outside the project\n');
        // An explicit emit selection must obey containment as well as the main include list.
        await writeFile(safetyConfig, JSON.stringify({ extends: './base.json', include: ['src/**/*.ts'], resilient: { emit: ['escape.ts'] } }));
        await rejectUnsafe({}, /Selected emit source is absent from the TypeScript program/u);
        await writeFile(safetyConfig, JSON.stringify({ extends: './base.json', include: ['src/**/*.ts'] }));
        await rejectUnsafe({ report: safetyConfig });
        await rejectUnsafe({ report: safetyBase });
        await rejectUnsafe({ report: path.join(safetySource, 'index.ts') });
        await rejectUnsafe({ report: safetyEslint, eslintConfig: safetyEslint });
        await rejectUnsafe({ report: safetyEslint });
        const lintOutput = path.join(safety, 'lint-output');
        const discoveredConfig = path.join(lintOutput, 'eslint.config.js');
        const discoveredConfigBytes = 'export default [{ rules: { quotes: "error" } }];\n';
        await mkdir(lintOutput);
        await writeFile(discoveredConfig, discoveredConfigBytes);
        await rejectUnsafe({ outDir: lintOutput, cwd: lintOutput, fixAll: true });
        assert.equal(await readFile(discoveredConfig, 'utf8'), discoveredConfigBytes);
        assert.deepEqual(await readdir(lintOutput), ['eslint.config.js']);
        assert.deepEqual((await readdir(safety)).filter(name => name.startsWith('.lint-output-staging-')), []);
        await writeFile(path.join(safetySource, 'index.ts'), 'export { dependency } from "../dependency/authored.js";\n');
        await rejectUnsafe({ report: imported });
        await rejectUnsafe({ outDir: importedDirectory });
        const sourceAlias = path.join(safety, 'source-alias');
        await symlink(safetySource, sourceAlias, 'dir');
        await rejectUnsafe({ outDir: sourceAlias });
        await rejectUnsafe({ report: path.join(sourceAlias, 'index.ts') });
        const configAlias = path.join(safety, 'config-alias.json');
        await symlink(safetyConfig, configAlias);
        await rejectUnsafe({ report: configAlias });
        // Replacing the directory must also preserve source symlinks whose targets live elsewhere.
        const linkedOutput = path.join(safety, 'linked-output');
        await mkdir(linkedOutput);
        const linkedSource = path.join(linkedOutput, 'source.ts');
        await symlink(path.join(safetySource, 'index.ts'), linkedSource);
        await writeFile(safetyConfig, JSON.stringify({ include: ['linked-output/source.ts'] }));
        await rejectUnsafe({ outDir: linkedOutput });
        assert.equal(await realpath(linkedSource), path.join(safetySource, 'index.ts'));
        await writeFile(safetyConfig, JSON.stringify({ extends: './base.json', include: ['src/**/*.ts'] }));
        const cliConfigBytes = await readFile(safetyConfig, 'utf8');
        assert.throws(() => execFileSync(process.execPath, [cliEntry, '--project', safetyConfig,
            '--outDir', safetyOutput, '--report', safetyConfig], { cwd: safety, timeout: 10000, stdio: 'pipe' }), { status: 1 });
        assert.equal(await readFile(safetyConfig, 'utf8'), cliConfigBytes);

        const fluencyOutput = path.join(project, 'fluency-output');
        const report = path.join(project, 'fluency.json');
        const eslintConfig = path.join(project, 'eslint.config.js');

        await writeFile(eslintConfig, 'export default [{ files: ["**/*.js"], rules: { quotes: ["error", "single"] } }];\n');
        const fixed = await runLowering({
            project: path.join(project, 'tsconfig.json'), outDir: fluencyOutput, cwd: project, fixAll: true, eslintConfig, report,
            write
        });

        assert.equal(fixed.ok, true, messages.join(''));
        assert.equal(JSON.parse(await readFile(report, 'utf8')).fixed.errors, 0);
        assert.match(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8'), /'hello'/u);

        const rawBytes = await readFile(path.join(output, 'index.js'), 'utf8');
        const pidFile = path.join(project, 'worker.pid');
        const quoteConfig = `import { writeFileSync, appendFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));
export default [{ files: ['**/*.js'], rules: { quotes: ['error', 'single'] } }];\n`;
        await writeFile(eslintConfig, quoteConfig);
        const base = { project: path.join(project, 'tsconfig.json'), outDir: fluencyOutput, cwd: project, eslintConfig, write };
        const unfixed = await runLowering(base);

        assert.equal(unfixed.ok, true);
        assert.equal(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8'), rawBytes);
        await assert.rejects(access(pidFile), 'Default lowering must not load ESLint config or start its worker');
        const measured = await runLowering({ ...base, report });

        assert.equal(measured.ok, true, messages.join(''));
        assert.equal(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8'), rawBytes);
        assert.equal(measured.fluency.complete, true);
        assert.equal(measured.fluency.fixApplied, false);
        assert.equal(measured.fluency.postFix, null);
        assert.equal(measured.fluency.changedFiles, 0);
        assert.equal(measured.fluency.raw.errors, 1);
        assert.equal(measured.fluency.clean, false);
        assert.deepEqual(measured.fluency.raw, measured.fluency.published);
        assert.deepEqual(measured.fluency.coverage, { expected: 2, measured: 2 });
        const greetingRow = measured.fluency.files.find(({ filePath = '' } = {}) => filePath.endsWith('index.js'));
        assert.equal(greetingRow.rawSha256, digest(rawBytes));
        assert.equal(greetingRow.publishedSha256, digest(rawBytes));
        assert.equal(greetingRow.profile.configFile, eslintConfig);
        assert.equal(greetingRow.profile.configSha256, digest(quoteConfig));
        assert.deepEqual(greetingRow.profile.rules.quotes, [2, 'single']);
        assert.equal(greetingRow.raw.messages.length, 1);
        assert.equal(greetingRow.postFix, null);
        const assertWorkerStopped = async () => {
            const pid = Number(await readFile(pidFile, 'utf8'));

            assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
        };
        await assertWorkerStopped();

        // eslint-disable-next-line resilient/no-undefined-assignment -- The CLI option oracle preserves absent optional paths and deliberately supplied undefined arguments.
        const discovered = await runLowering({ ...base, eslintConfig: undefined, report });
        assert.equal(discovered.ok, true, messages.join(''));
        assert.equal(discovered.fluency.files[0].profile.configFile, eslintConfig);
        const fixedOnly = await runLowering({ ...base, fixAll: true });
        assert.equal(fixedOnly.ok, true);
        assert.match(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8'), /'hello'/u);
        assert.equal(fixedOnly.fluency, undefined);
        await assertWorkerStopped();
        const both = await runLowering({ ...base, fixAll: true, report });
        assert.equal(both.ok, true);
        assert.equal(both.fluency.fixApplied, true);
        assert.equal(both.fluency.changedFiles, 1);
        assert.equal(both.fluency.raw.errors, 1);
        assert.equal(both.fluency.postFix.errors, 0);
        assert.equal(both.fluency.published.errors, 0);
        const fixedRow = both.fluency.files.find(({ filePath = '' } = {}) => filePath.endsWith('index.js'));
        assert.equal(fixedRow.publishedSha256, digest(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8')));
        assert.notEqual(fixedRow.rawSha256, fixedRow.publishedSha256);
        assert.deepEqual(fixedRow.postFix.messages, []);
        await assertWorkerStopped();

        // This override matches only final output paths, exposing accidental linting of randomized staging paths.
        await writeFile(eslintConfig, `export default [{ files: ['fluency-output/**/*.js'], rules: { quotes: ['error', 'single'] } }];\n`);
        assert.equal((await runLowering({ ...base, report })).ok, true);

        const failure = async ({ config = quoteConfig, options = {}, marker = /Incomplete/u, stopped = true } = {}) => {
            await writeFile(eslintConfig, config);
            const priorBytes = await readFile(path.join(fluencyOutput, 'index.js'), 'utf8');
            const priorReport = await readFile(report, 'utf8');
            const result = await runLowering({ ...base, report, ...options });
            const { ok = false, fluency = {} } = result;
            // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- The failure oracle verifies actual JSON null results, not normalized replacements.
            const { complete = true, raw, published, error = '' } = fluency;

            assert.equal(ok, false, messages.join(''));
            assert.equal(complete, false);
            assert.equal(raw, null);
            assert.equal(published, null);
            assert.match(error, marker);
            assert.equal(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8'), priorBytes);
            assert.equal(await readFile(report, 'utf8'), priorReport);
            assert.deepEqual((await readdir(project)).filter(name => name.startsWith('.fluency-output-staging-') ||
                name.startsWith('.resilient-backup-') || name.startsWith('.resilient-report-')), []);

            if (stopped) await assertWorkerStopped();
        };
        const recordPid = `import { writeFileSync, appendFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n`;
        await failure({ config: `${recordPid}export default [{ ignores: ['fluency-output/**'] }];\n`, marker: /Missing or ignored/u });
        await failure({ config: `${recordPid}export default [{ files: ['**/*.ts'], rules: { quotes: 'error' } }];\n`, marker: /No enabled/u });
        await failure({ config: `${recordPid}export default [];\n`, marker: /No enabled/u });
        await failure({ config: `${recordPid}export default [{ rules: { 'missing-rule': 'error' } }];\n`, marker: /missing-rule/u });
        await failure({ config: `${recordPid}export default [{ rules: { quotes: 'error' }, languageOptions: { sourceType: 'script' } }];\n`,
            marker: /Incomplete JavaScript lint/u });
        await failure({ options: { eslintConfig: path.join(project, 'missing.config.js') }, marker: /ENOENT/u, stopped: false });
        await failure({ options: { eslintConfig: 42 }, marker: /overrideConfigFile/u, stopped: false });
        const spawnScript = `import { runLowering } from ${JSON.stringify(new URL('../scripts/lower-typescript-project.js', import.meta.url).href)};
const keeper = setInterval(() => {}, 1000);
try { console.log(JSON.stringify(await runLowering(${JSON.stringify({
        project: base.project, outDir: fluencyOutput, cwd: path.join(project, 'missing-cwd'), eslintConfig, report
    })}))); } finally { clearInterval(keeper); }`;
        const beforeSpawnBytes = await readFile(path.join(fluencyOutput, 'index.js'), 'utf8');
        const beforeSpawnReport = await readFile(report, 'utf8');
        const spawnFailure = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', spawnScript], {
            cwd: project, timeout: 10000, encoding: 'utf8'
        }));
        assert.equal(spawnFailure.ok, false);
        assert.equal(spawnFailure.fluency.complete, false);
        assert.match(spawnFailure.fluency.error, /ENOENT/u);
        assert.equal(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8'), beforeSpawnBytes);
        assert.equal(await readFile(report, 'utf8'), beforeSpawnReport);
        assert.deepEqual((await readdir(project)).filter(name => name.startsWith('.fluency-output-staging-')), []);
        await failure({ config: `${recordPid}export default [{ plugins: { fail: { rules: { boom: { create() { throw new Error('worker-rule-failure'); } } } } },
rules: { 'fail/boom': 'error' } }];\n`, marker: /worker-rule-failure/u });
        await failure({ config: `${recordPid}process.exit(17);\n`, marker: /worker (disconnected|exited)/u });
        await failure({ config: `${recordPid}process.disconnect(); setInterval(() => {}, 10000);\n`, marker: /worker disconnected/u });
        const processorConfig = (preprocess = 'return [text];') => `${recordPid}export default [
{ files: ['**/*.js'], rules: { quotes: ['error', 'single'] } },
{ files: ['**/index.js', '**/types.js'], plugins: { fixture: { processors: { parts: {
preprocess(text) { ${preprocess} }, postprocess(messages) { return messages.flat(); }, supportsAutofix: true
} } } }, processor: 'fixture/parts' },
{ files: ['**/*empty.js'], rules: { quotes: 'off' } }];\n`;
        const processorTrace = path.join(project, 'processor-trace');
        await writeFile(processorTrace, '');
        await writeFile(eslintConfig, processorConfig(`appendFileSync(${JSON.stringify(processorTrace)}, 'pre\\n'); return [text];`));
        const processed = await runLowering({ ...base, report });
        assert.equal(processed.ok, true, messages.join(''));
        assert.equal(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8'), rawBytes);
        assert.equal(await readFile(processorTrace, 'utf8'), 'pre\npre\n', 'Stats must not invoke the processor a second time');
        assert.equal(processed.fluency.raw.errors, 1);
        await writeFile(processorTrace, '');
        const processedFixed = await runLowering({ ...base, fixAll: true, report });
        assert.equal(processedFixed.ok, true, messages.join(''));
        assert.equal(processedFixed.fluency.raw.errors, 1);
        assert.equal(processedFixed.fluency.postFix.errors, 0);
        assert.equal(await readFile(processorTrace, 'utf8'), 'pre\n'.repeat(7), 'Report mode must retain raw and post-fix analysis');
        const processedFixedBytes = await readFile(path.join(fluencyOutput, 'index.js'), 'utf8');
        await writeFile(processorTrace, '');
        const processedFixedOnly = await runLowering({ ...base, fixAll: true });
        assert.equal(processedFixedOnly.ok, true, messages.join(''));
        assert.equal(processedFixedOnly.fluency, undefined);
        assert.equal(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8'), processedFixedBytes);
        assert.equal(await readFile(processorTrace, 'utf8'), 'pre\n'.repeat(3), 'Fix-only mode must skip raw analysis for changed and unchanged files');
        await assertWorkerStopped();
        await failure({ config: processorConfig('return [];'), marker: /no parser or enabled-rule execution/u });
        await failure({ config: processorConfig("return [{ text, filename: 'unsupported.txt' }];"), marker: /no parser or enabled-rule execution/u });
        await failure({ config: processorConfig("return [{ text: text + '\\n', filename: 'empty.js' }];"), marker: /no parser or enabled-rule execution/u });
        await failure({ config: `${recordPid}export default [{ files: ['**/*.js'], rules: { quotes: ['error', 'single'] } },
{ files: ['**/types.js'], languageOptions: { sourceType: 'script' } }];\n`, marker: /Incomplete JavaScript lint/u,
        options: { fixAll: true } });
        await failure({ options: { report: path.join(project, 'absent-directory', 'result.json') }, marker: /ENOENT/u });
        // Failing the final external report rename after output staging must restore the prior publication.
        const reportDirectory = path.join(project, 'report-directory');
        await mkdir(reportDirectory);
        await failure({ options: { report: reportDirectory }, marker: /EISDIR|ENOTEMPTY/u });
        await failure({ options: { report: path.join(fluencyOutput, 'index.js') }, marker: /report may not replace/u });
        const outputAlias = path.join(project, 'fluency-alias');
        await symlink(fluencyOutput, outputAlias, 'dir');
        await failure({ options: { report: path.join(outputAlias, 'index.js') }, marker: /report may not replace/u });
        await writeFile(eslintConfig, quoteConfig);
        const insideReport = path.join(fluencyOutput, 'report.json');
        assert.equal((await runLowering({ ...base, report: insideReport })).ok, true);
        assert.equal(JSON.parse(await readFile(insideReport, 'utf8')).complete, true);
        assert.equal(await readFile(path.join(fluencyOutput, 'index.js'), 'utf8'), rawBytes);

        await writeFile(eslintConfig, `${recordPid}throw new Error('default-must-not-load-eslint');\n`);
        assert.equal((await runLowering(base)).ok, true);
        await writeFile(eslintConfig, quoteConfig);
        const cliOutput = path.join(project, 'cli-output');
        const cliReport = path.join(project, 'cli-report.json');
        const cliArgs = ['--project', path.join(project, 'tsconfig.json'), '--outDir', cliOutput, '--eslint-config', eslintConfig];
        execFileSync(process.execPath, [cliEntry, ...cliArgs, '--report', cliReport], { cwd: project, timeout: 10000 });
        assert.equal(await readFile(path.join(cliOutput, 'index.js'), 'utf8'), rawBytes);
        assert.throws(() => execFileSync(process.execPath, [cliEntry, ...cliArgs, '--eslint-config', eslintConfig], { cwd: project, timeout: 10000 }));

        // Direct protocol controls cover unsupported file paths, fatal parse failures, empty fixer output, and shutdown.
        const emptyConfig = path.join(project, 'empty-fix.config.js');
        await writeFile(emptyConfig, `export default [{ plugins: { empty: { rules: { remove: { meta: { fixable: 'code' }, create(context) {
return { Program(node) { if (context.sourceCode.text) context.report({ node, message: 'Remove fixture', fix: fixer => fixer.removeRange([0, context.sourceCode.text.length]) }); } };
} } } } }, rules: { 'empty/remove': 'error' } }];\n`);
        const child = fork(workerEntry, [], { cwd: project, serialization: 'advanced' });
        const exited = once(child, 'exit');
        let requestId = 0;
        const request = async (message) => {
            const response = once(child, 'message');
            child.send({ ...message, id: requestId });
            requestId += 1;
            const [result = {}] = await response;

            return result;
        };

        try {
            assert.equal((await request({ type: 'init', cwd: project, eslintConfig: emptyConfig, measure: true, fixAll: true })).error, undefined);
            const removed = await request({ type: 'fix', code: 'export const value = 1;\n', filePath: path.join(project, 'empty.js') });
            assert.equal(removed.output, '');
            assert.equal(removed.raw.errorCount, 1);
            assert.equal(removed.fixed.errorCount, 0);
            assert.match((await request({ type: 'fix', code: 'const = ;', filePath: path.join(project, 'parse.js') })).error, /Incomplete JavaScript lint/u);
            assert.match((await request({ type: 'fix', code: '', filePath: path.join(project, 'unsupported.txt') })).error, /Missing or ignored/u);
            assert.match((await request({ type: 'unexpected' })).error, /Unknown ESLint worker request/u);
            await writeFile(eslintConfig, quoteConfig);
            await request({ type: 'init', cwd: project, eslintConfig, measure: true, fixAll: false });
            const suppressed = await request({ type: 'fix', code: '// eslint-disable-next-line quotes -- Preserved authored quote choice.\nexport const value = "hello";\n',
                filePath: path.join(project, 'suppressed.js') });
            assert.equal(suppressed.error, undefined);
            assert.equal(suppressed.raw.suppressedMessages.length, 1);
            const disabled = await request({ type: 'fix', code: '/* eslint quotes: off */\nexport const value = "hello";\n',
                filePath: path.join(project, 'no-rules.js') });
            assert.match(disabled.error, /no parser or enabled-rule execution/u);
            await writeFile(eslintConfig, `export default [{ plugins: { empty: { rules: { noop: { create() { return {}; } } } } }, rules: { 'empty/noop': 'error' } }];\n`);
            await request({ type: 'init', cwd: project, eslintConfig, measure: true, fixAll: false });
            const noListeners = await request({ type: 'fix', code: '', filePath: path.join(project, 'empty.js') });
            assert.equal(noListeners.error, undefined);
            await request({ type: 'close' });
            await exited;
        } finally {
            child.kill('SIGKILL');
        }

        // Reports must agree with fresh ESLint on complete sibling modules, including prior publications and fixed providers.
        const graphProject = path.join(project, 'graph');
        const graphSource = path.join(graphProject, 'src');
        const graphOutput = path.join(graphProject, 'generated');
        const graphConfig = path.join(graphProject, 'eslint.config.js');
        const graphTsconfig = path.join(graphProject, 'tsconfig.json');
        const graphReport = path.join(graphProject, 'report.json');
        await mkdir(graphSource, { recursive: true });
        await writeFile(path.join(graphProject, 'package.json'), '{"type":"module"}\n');
        await writeFile(path.join(graphSource, 'consumer.ts'), 'import { getValue } from "./provider.js";\nexport const render = () => getValue().toUpperCase();\n');
        const graphLintConfig = (replacement = '') => `import resilient from ${JSON.stringify(new URL('../index.js', import.meta.url).href)};
export default [{ ...resilient.configs.contracts, files: ['generated/**/*.js'] }, {
files: ['generated/provider.js'], plugins: { fixture: { rules: { replace: {
meta: { fixable: 'code', schema: [], messages: { replace: 'Replace provider value.' } },
create(context) { return { Literal(node) {
if (!${JSON.stringify(replacement)} || node.value === ${replacement || 'undefined'}) return;
context.report({ node, messageId: 'replace', fix: fixer => fixer.replaceText(node, ${JSON.stringify(replacement)}) });
} }; }
} } } }, rules: { 'fixture/replace': ${replacement ? "'error'" : "'off'"} }
}];\n`;
        const freshGraphLint = () => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
import { ESLint } from ${JSON.stringify(new URL('../node_modules/eslint/lib/api.js', import.meta.url).href)};
const eslint = new ESLint({ cwd: process.argv[1], overrideConfigFile: process.argv[2] });
console.log(JSON.stringify(await eslint.lintFiles(['generated/**/*.js'])));
`, graphProject, graphConfig], { cwd: graphProject, encoding: 'utf8', timeout: 10000 }));
        const checkGraphReport = async ({ fixAll = false, errors = 0 } = {}) => {
            const result = await runLowering({
                project: graphTsconfig, outDir: graphOutput, cwd: graphProject, eslintConfig: graphConfig,
                report: graphReport, fixAll, write
            });
            const { ok = false, fluency = {} } = result;
            const { complete = false, published = {}, clean = false, coverage = {}, files = [] } = getObject(fluency);
            const { errors: publishedErrors = 0 } = getObject(published);
            assert.equal(ok, true, messages.join(''));
            assert.equal(complete, true);
            assert.equal(publishedErrors, errors);
            assert.equal(clean, errors === 0);
            assert.deepEqual(coverage, { expected: 2, measured: 2 });
            const fresh = freshGraphLint();
            assert.deepEqual(published, getLintSummary(fresh));
            const consumer = fresh.find(({ filePath = '' } = {}) => filePath.endsWith('consumer.js'));
            const { errorCount = 0, messages: consumerMessages = [], filePath: consumerPath = '' } = consumer;
            assert.equal(errorCount, errors);
            const consumerRow = files.find(({ filePath = '' } = {}) => filePath.endsWith('consumer.js'));
            const { raw = {}, postFix = {}, publishedSha256 = '' } = consumerRow;
            const { messages: measuredMessages = [] } = fixAll ? postFix : raw;
            assert.deepEqual(measuredMessages, consumerMessages);
            assert.equal(publishedSha256, digest(await readFile(consumerPath, 'utf8')));
            assert.deepEqual(JSON.parse(await readFile(graphReport, 'utf8')), fluency);

            return fluency;
        };
        // eslint-disable-next-line resilient/prefer-prototype-methods -- Each file order exercises successive publications of the same tree and must finish before the next order starts.
        for (const order of [['consumer', 'provider'], ['provider', 'consumer']]) {
            await writeFile(graphTsconfig, JSON.stringify({
                compilerOptions: { rootDir: './src', target: 'esnext', module: 'nodenext', moduleResolution: 'nodenext' },
                files: order.map(name => `src/${name}.ts`)
            }));
            await writeFile(graphConfig, graphLintConfig());
            await rm(graphOutput, { recursive: true, force: true });
            await writeFile(path.join(graphSource, 'provider.ts'), 'export const getValue = (): any => 42;\n');
            await checkGraphReport({ errors: 1 });
            // A prior numeric provider must not contaminate the newly emitted string provider, or vice versa.
            await writeFile(path.join(graphSource, 'provider.ts'), 'export const getValue = (): any => "hello";\n');
            await checkGraphReport();
            await writeFile(path.join(graphSource, 'provider.ts'), 'export const getValue = (): any => 42;\n');
            await checkGraphReport({ fixAll: true, errors: 1 });

            // Autofixing a provider changes its consumers without changing the consumer's bytes.
            await writeFile(graphConfig, graphLintConfig('"hello"'));
            const repaired = await checkGraphReport({ fixAll: true });
            assert.equal(repaired.raw.byRule['resilient/signature-contract-operation'].errors, 1);
            assert.equal(repaired.changedFiles, 1);
            await writeFile(path.join(graphSource, 'provider.ts'), 'export const getValue = (): any => "hello";\n');
            await writeFile(graphConfig, graphLintConfig('42'));
            const contradicted = await checkGraphReport({ fixAll: true, errors: 1 });
            assert.equal(contradicted.raw.byRule['resilient/signature-contract-operation'], undefined);
            assert.equal(contradicted.changedFiles, 1);
        }

        // A final-pass failure must roll back all fixed files and leave the prior report intact.
        const previousGraph = await Promise.all(['consumer.js', 'provider.js'].map(name => readFile(path.join(graphOutput, name), 'utf8')));
        const previousGraphReport = await readFile(graphReport, 'utf8');
        const finalFailureConfig = graphLintConfig('42').replace('export default [', 'const configs = [') + `
import { readFileSync } from 'node:fs';
export default [...configs, { files: ['generated/consumer.js'], plugins: { fixtureFailure: { rules: { fail: {
create() { return { Program() {
if (readFileSync(${JSON.stringify(path.join(graphOutput, 'provider.js'))}, 'utf8').includes('42')) throw new Error('final-tree-failure');
} }; }
} } } }, rules: { 'fixtureFailure/fail': 'error' } }];\n`;
        await writeFile(graphConfig, finalFailureConfig);
        const finalFailure = await runLowering({
            project: graphTsconfig, outDir: graphOutput, cwd: graphProject, eslintConfig: graphConfig,
            report: graphReport, fixAll: true, write
        });
        assert.equal(finalFailure.ok, false);
        assert.equal(finalFailure.fluency.complete, false);
        assert.equal(finalFailure.fluency.published, null);
        assert.match(finalFailure.fluency.error, /final-tree-failure/u);
        assert.deepEqual(await Promise.all(['consumer.js', 'provider.js'].map(name => readFile(path.join(graphOutput, name), 'utf8'))), previousGraph);
        assert.equal(await readFile(graphReport, 'utf8'), previousGraphReport);
        assert.deepEqual((await readdir(graphProject)).filter(name => name.startsWith('.generated-staging-') ||
            name.startsWith('.resilient-backup-') || name.startsWith('.resilient-report-')), []);

        await writeFile(path.join(source, 'broken.ts'), 'const = ;\n');
        const failedOutput = path.join(project, 'failed-output');
        const failed = await runLowering({ project: path.join(project, 'tsconfig.json'), outDir: failedOutput, cwd: project, write });

        assert.equal(failed.ok, false);
        await assert.rejects(access(path.join(failedOutput, 'broken.js')));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

{
    const project = await mkdtemp(path.join(tmpdir(), 'resilient-project-preparation-'));
    const source = path.join(project, 'src');
    const config = path.join(project, 'tsconfig.json');
    const output = path.join(project, 'generated');
    let messages = [];
    const write = (text) => { messages = [...messages, text]; };

    try {
        await writeFile(path.join(project, 'package.json'), '{"type":"module"}\n');
        await mkdir(path.join(source, 'left'), { recursive: true });
        await mkdir(path.join(source, 'right'), { recursive: true });
        await writeFile(path.join(source, 'left', 'value.ts'), 'export const left = 1;\n');
        await writeFile(path.join(source, 'right', 'value.ts'), 'export const right = 2;\n');
        await writeFile(path.join(source, 'provider.ts'), 'export type Provider = number;\n');
        await writeFile(path.join(project, 'helper.js'), 'export const helper = true;\n');
        await writeFile(config, JSON.stringify({
            compilerOptions: { rootDir: './src', target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext' },
            include: ['src/**/*.ts'],
            resilient: { emit: ['src/left/value.ts', 'src/right/value.ts'], standard: { object: './helper.js' } }
        }));
        const prepared = prepareProject({ project: config, outDir: output, cwd: project });

        assert.deepEqual(prepared.destinations.map(({ relative = '' } = {}) => relative), ['left/value.js', 'right/value.js']);
        assert.equal(prepared.standard.object, path.join(project, 'helper.js'));
        assert.equal(prepared.checkerInputs.some(({ fileName = '' } = {}) => fileName.endsWith('provider.ts')), true);
        assert.equal((await runLowering({ project: config, outDir: output, cwd: project, write })).ok, true, messages.join(''));
        await access(path.join(output, 'left', 'value.js'));
        await access(path.join(output, 'right', 'value.js'));
        await assert.rejects(access(path.join(output, 'provider.js')));
        const retainedLeft = await readFile(path.join(output, 'left', 'value.js'), 'utf8');

        await writeFile(path.join(project, 'unowned.ts'), 'export const unowned = true;\n');
        await writeFile(config, JSON.stringify({
            compilerOptions: { rootDir: './src', target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext' },
            include: ['src/**/*.ts'], resilient: { emit: ['unowned.ts'] }
        }));
        assert.equal((await runLowering({ project: config, outDir: output, cwd: project, write })).ok, false);
        assert.match(messages.at(-1), /absent from the TypeScript program/u);
        assert.equal(await readFile(path.join(output, 'left', 'value.js'), 'utf8'), retainedLeft);
        assert.throws(() => planDestinations({
            files: [path.join(source, 'left', 'value.ts'), path.join(source, 'left', 'value.tsx')],
            root: source, outDir: output
        }), /destination collision/u);
        assert.throws(() => planDestinations({ files: [path.join(project, 'escape.ts')], root: source, outDir: output }),
            /Generated JavaScript must remain inside/u);
        assert.equal(await readFile(path.join(output, 'left', 'value.js'), 'utf8'), retainedLeft);

        await writeFile(config, JSON.stringify({
            compilerOptions: { rootDir: './src', target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', emitDeclarationOnly: true }, include: ['src/**/*.ts']
        }));
        const unsupportedEmit = await runLowering({ project: config, outDir: output, cwd: project, write });
        assert.equal(unsupportedEmit.ok, false);
        assert.deepEqual(unsupportedEmit.diagnostics, []);
        assert.equal(await readFile(path.join(output, 'left', 'value.js'), 'utf8'), retainedLeft);

        await writeFile(path.join(source, 'broken.d.ts'), 'declare const broken: ;\n');
        await writeFile(config, JSON.stringify({ compilerOptions: { rootDir: './src', target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext' }, include: ['src/**/*.ts'] }));
        const declarationFailure = await runLowering({ project: config, outDir: output, cwd: project, write });
        assert.equal(declarationFailure.ok, false);
        assert.equal(Boolean(declarationFailure.diagnostics.length), true);
        assert.equal(await readFile(path.join(output, 'left', 'value.js'), 'utf8'), retainedLeft);
    } finally {
        await rm(project, { recursive: true, force: true });
    }
}
