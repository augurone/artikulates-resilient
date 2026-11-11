import { deepStrictEqual, match, ok, strictEqual } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const hash = value => createHash('sha256').update(value).digest('hex');

test('installed project tests execute unchanged cases through reference, raw and fixed module routes', async (context) => {
    const root = mkdtempSync(resolve('project-tests-'));
    const project = join(root, 'application');
    const source = join(project, 'src');
    const tests = join(project, 'test');
    const testFile = join(tests, 'application.test.js');
    const config = join(project, 'resilient.project.json');
    const binary = existsSync(resolve('node_modules/.bin/resilient-prove'))
        ? resolve('node_modules/.bin/resilient-prove') : resolve('scripts/prove-typescript-project.js');
    const writeTest = value => writeFileSync(testFile, value);
    const run = (name, timeout = 30000) => {
        const output = join(root, name);
        const result = spawnSync(process.execPath, [binary, '--project', project, '--outDir', output, '--timeout', String(timeout)], {
            cwd: resolve('.'), encoding: 'utf8', timeout: 60000
        });
        const recordFile = join(output, 'results.json');
        const record = existsSync(recordFile) ? JSON.parse(readFileSync(recordFile, 'utf8')) : {};
        const { stderr = '' } = result;
        const diagnostic = ['reference', 'lower', 'raw', 'fixed'].map(variant => join(output, variant + '.stderr'))
            .filter(file => existsSync(file)).map(file => readFileSync(file, 'utf8')).join('\n');

        return { ...result, record, stderr: stderr + diagnostic };
    };

    mkdirSync(source, { recursive: true });
    mkdirSync(tests);
    writeFileSync(join(project, 'package.json'), '{"type":"module"}\n');
    writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
        target: 'ESNext', module: 'ESNext', moduleResolution: 'Bundler', rootDir: 'src', strict: true
    }, include: ['src/**/*.ts'], resilient: { emit: ['src/value.ts', 'src/unused.ts'] } }));
    writeFileSync(join(source, 'value.ts'), 'export const answer: number = 42;\nexport const keep = <T>(value: T): T => value;\nexport const token = {};\n');
    writeFileSync(join(source, 'unused.ts'), 'export const unexercised = true;\n');
    writeFileSync(join(source, 'unselected.ts'), 'export const unselected = true;\n');
    writeFileSync(join(tests, 'native-helper.ts'), 'export const expected: number = 42;\n');
    writeFileSync(join(project, 'provider.js'), 'export default {schemaVersion:1, proof:()=>({runner:{kind:"node-test"},tests:{include:["test/*.test.js"]}})};\n');
    writeFileSync(config, '{"schemaVersion":2,"provider":"./provider.js"}\n');
    const originalTest = [
        'import {test} from "node:test";',
        'import assert from "node:assert/strict";',
        'import {answer, keep} from "../src/value.ts";',
        'import * as plain from "../src/value.ts";',
        'import * as emptyQuery from "../src/value.ts?";',
        'import * as emptyFragment from "../src/value.ts#";',
        'import * as first from "../src/value.ts?first#one";',
        'import * as repeated from "../src/value.ts?first#one";',
        'import * as second from "../src/value.ts?second#two";',
        'import * as fragment from "../src/value.ts#fragment";',
        'import {expected} from "./native-helper.ts";',
        'test("value",()=>assert.equal(answer,expected));',
        'test("provided identity",()=>{const token={};assert.equal(keep(token),token);});',
        'test("module URL identity",async()=>{',
        '    assert.equal(plain,emptyQuery);',
        '    assert.equal(plain,emptyFragment);',
        '    assert.equal(first,repeated);',
        '    assert.notEqual(first,second);',
        '    assert.notEqual(first.token,second.token);',
        '    assert.notEqual(first,fragment);',
        '    assert.notEqual(first.token,fragment.token);',
        '    assert.equal(await import(new URL("../src/value.ts?first#one",import.meta.url)),first);',
        '});'
    ].join('\n');
    writeTest(originalTest);
    const originals = [testFile, config, join(project, 'tsconfig.json'), join(source, 'value.ts')];
    const before = originals.map(file => hash(readFileSync(file)));

    try {
        await context.test('real provider configuration, case results, physical loads and unexercised coverage', () => {
            const { status = -1, stdout = '', stderr = '', record: { complete = false,
                variants: { reference: { cases: nativeCases = [], ...reference } = {}, raw: { cases: rawCases = [], ...raw } = {},
                    fixed: { cases: fixedCases = [], ...fixed } = {} } = {} } = {} } = run('accepted');

            strictEqual(status, 0, stdout + stderr);
            strictEqual(complete, true);
            deepStrictEqual(rawCases, nativeCases);
            deepStrictEqual(fixedCases, nativeCases);
            strictEqual(nativeCases.length, 3);
            [reference, raw, fixed].forEach(({ loaded = [], helpers = [], coverage: { selected = 0, observed = 0 } = {} } = {}) => {
                strictEqual(loaded.length, 1);
                strictEqual(selected, 2);
                strictEqual(observed, 1);
                const [{ file = '' } = {}] = loaded;
                match(file, /\/(?:reference|raw|fixed)\/value\.js$/u);
                ok(loaded.every(({ file = '' } = {}) => file.endsWith('.js')));
                ok(helpers.some(({ file = '', sha256 = '' } = {}) => file.endsWith('native-helper.ts') && sha256 === hash(readFileSync(file))));
            });
            deepStrictEqual(originals.map(file => hash(readFileSync(file))), before);
        });
        await context.test('a zero-test success exit does not establish a behavioral result', () => {
            writeTest('import "../src/value.ts";\n');
            const { status = 0, record: { error = '' } = {} } = run('zero');
            strictEqual(status, 1);
            match(error, /No passing test cases/u);
        });
        await context.test('passing tests that load no owned artifacts are rejected', () => {
            writeTest('import {test} from "node:test"; test("unrelated",()=>{});\n');
            const { status = 0, record: { error = '' } = {} } = run('unrelated');
            strictEqual(status, 1);
            match(error, /loaded no owned/u);
        });
        await context.test('un-emitted owned TypeScript cannot fall back through native test preparation', () => {
            writeTest(originalTest + '\nimport "../src/unselected.ts";\n');
            const { status = 0, stderr = '', record: { error = '' } = {} } = run('fallback');
            strictEqual(status, 1);
            match(error, /process failed/u);
            match(stderr, /Original or un-emitted owned source/u);
        });
        await context.test('alternate helper extensions and non-ESM package scopes fail explicitly', () => {
            ['.cjs', '.mjs', '.cts', '.mts'].forEach((extension) => {
                const helper = `unsupported${extension}`;
                writeFileSync(join(tests, helper), 'throw new Error("unsupported helper executed");\n');
                writeTest(originalTest + `\nimport "./${helper}";\n`);
                const { status = 0, stderr = '' } = run('extension-' + extension.slice(1));
                strictEqual(status, 1);
                match(stderr, /Project proofs require ESM/u);
                rmSync(join(tests, helper));
            });
            writeFileSync(join(tests, 'package.json'), '{"type":"commonjs"}\n');
            writeTest(originalTest);
            const { status = 0, stderr = '' } = run('package-mode');
            strictEqual(status, 1);
            match(stderr, /type: module package scopes/u);
            rmSync(join(tests, 'package.json'));
        });
        await context.test('test failures and bounded process timeouts are explicit failed runs', () => {
            writeTest(originalTest.replace('assert.equal(answer,expected)', 'assert.equal(answer,0)'));
            const { status: failedStatus = 0, record: { error: failedError = '' } = {} } = run('failure');
            strictEqual(failedStatus, 1);
            match(failedError, /process failed/u);
            writeTest(originalTest + '\nsetInterval(()=>{},1000);\n');
            const { status: timedStatus = 0, record: { error: timedError = '' } = {} } = run('timeout', 1000);
            strictEqual(timedStatus, 1);
            match(timedError, /exceeded 1000ms/u);
        });
        await context.test('successful processes with different actual cases do not establish parity', () => {
            writeTest([
                'import {test} from "node:test";',
                'import assert from "node:assert/strict";',
                'import {answer} from "../src/value.ts";',
                'const name = process.env.RESILIENT_PROJECT_TESTS.includes("reference") ? "original case" : "changed case";',
                'test(name,()=>assert.equal(answer,42));'
            ].join('\n'));
            const { status = 0, record: { error = '' } = {} } = run('case-mismatch');
            strictEqual(status, 1);
            match(error, /cases or loaded source identities differ/u);
        });
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
