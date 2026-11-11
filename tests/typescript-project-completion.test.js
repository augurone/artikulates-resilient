import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';

import { validateManifest } from '../integrations/typescript-project-artifacts.js';
import { prepareProject, referenceSource } from '../integrations/typescript-project.js';
import { runLowering } from '../scripts/lower-typescript-project.js';
import { jobSources, observeJobApplication } from './support/job-application.js';

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
