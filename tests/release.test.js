import { deepStrictEqual, match, ok, strictEqual } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
const { version: currentVersion = '', files = [] } = metadata;
const [major = '', minor = '', patch = ''] = currentVersion.split('-').at(0).split('.');
const nextVersion = `${major}.${minor}.${Number(patch) + 1}`;
const owners = ['package.json', 'package-lock.json', 'index.js', 'analysis/eslint/index.js', 'CHANGELOG.md'];
const read = (directory, name) => readFileSync(join(directory, name), 'utf8');
const { execPath = '', env = {} } = process;
const { PATH = '' } = env;
const environment = { ...env, PATH: dirname(execPath) + delimiter + PATH };
const git = (directory, args) => spawnSync('git', args, { cwd: directory, env: environment, encoding: 'utf8' });
const run = (directory, args) => spawnSync(execPath, ['scripts/release.js', ...args], {
    cwd: directory, env: environment, encoding: 'utf8', timeout: 60000
});
const snapshot = directory => owners.map(file => ({ file, bytes: readFileSync(join(directory, file)) }));

// This temporary project's check executes the real public runtime, actual ESLint
// analysis and a real packed manifest, without recursively running this suite.
const oracle = [
    'import assert from "node:assert/strict";',
    'import {execFileSync} from "node:child_process";',
    'import {appendFileSync,mkdirSync,readFileSync} from "node:fs";',
    'import {join} from "node:path";',
    'import {ESLint} from "eslint";',
    'import plugin from "eslint-plugin-resilient";',
    'import rules from "eslint-plugin-resilient/eslint";',
    'const read=name=>JSON.parse(readFileSync(name,"utf8"));',
    'const {version}=read("package.json"); const lock=read("package-lock.json");',
    'assert.equal(plugin.meta.version,version); assert.equal(rules.meta.version,version);',
    'assert.equal(lock.version,version); assert.equal(lock.packages[""].version,version);',
    'const engine=new ESLint({overrideConfigFile:true,cache:false,overrideConfig:[{',
    'plugins:{resilient:rules},rules:{"resilient/signature-contract-operation":"error"}}]});',
    'const results=await engine.lintFiles(["release-input.js"]);',
    'const messages=results.flatMap(({messages=[]})=>messages);',
    'const heading=readFileSync("CHANGELOG.md","utf8").split("\\n").find(line=>line.startsWith("## ")&&line!=="## Unreleased");',
    'const observation={version,heading,messages};',
    'if(results.some(({errorCount=0})=>errorCount)){',
    'appendFileSync(".checks.jsonl",JSON.stringify(observation)+"\\n");',
    'assert.fail("Release fixture lint rejected a genuine native-operation contradiction");}',
    'mkdirSync(".artifacts",{recursive:true});',
    'const [{filename}]=JSON.parse(execFileSync("npm",["pack","--json","--ignore-scripts",',
    '"--cache",join(process.cwd(),".artifacts/npm-cache"),"--pack-destination",".artifacts"],{encoding:"utf8"}));',
    'const packed=JSON.parse(execFileSync("tar",["-xOf",join(".artifacts",filename),"package/package.json"],{encoding:"utf8"}));',
    'assert.equal(packed.version,version);',
    'appendFileSync(".checks.jsonl",JSON.stringify({...observation,packedVersion:packed.version})+"\\n");'
].join('\n');

const withFixture = ({ generic = false, invalid = false } = {}, verify) => {
    const directory = mkdtempSync(join(tmpdir(), 'resilient-release-'));

    try {
        files.forEach((file) => {
            const target = join(directory, file);
            mkdirSync(dirname(target), { recursive: true });
            cpSync(join(source, file), target, { recursive: true });
        });
        ['package-lock.json', 'scripts/release.js'].forEach(file => cpSync(join(source, file), join(directory, file)));
        const { scripts = {} } = metadata;
        writeFileSync(join(directory, 'package.json'), JSON.stringify({ ...metadata, scripts: { ...scripts, check: 'node release-check.js' } }, null, 2) + '\n');
        writeFileSync(join(directory, 'CHANGELOG.md'), generic
            ? `# Changelog\n\n## Unreleased\n\n- Prepare the next version.\n\n## ${currentVersion} — 2026-01-01\n\n- Preserve prior history.\n`
            : `# Changelog\n\n## ${currentVersion} — Unreleased\n\n- Finalize the authored release.\n\n## Historical notes\n\n- Preserve prior history.\n`);
        writeFileSync(join(directory, 'release-check.js'), oracle);
        writeFileSync(join(directory, 'release-input.js'), invalid ? 'const collection = []; collection.trim();\n' : 'const collection = []; collection.map(value => value);\n');
        writeFileSync(join(directory, '.gitignore'), 'node_modules/\n.artifacts/\n.checks.jsonl\n');
        symlinkSync(join(source, 'node_modules'), join(directory, 'node_modules'), 'dir');
        const { status: initialized = -1, stderr: initializationError = '' } = git(directory, ['init', '--quiet']);
        strictEqual(initialized, 0, initializationError);
        const { status: indexed = -1, stderr: indexError = '' } = git(directory, ['add', '.']);
        strictEqual(indexed, 0, indexError);

        verify(directory);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
};

test('release preview and invalid preflight leave every authored owner unchanged', () => {
    withFixture({}, (directory) => {
        const before = snapshot(directory);
        const { stdout: statusBefore = '' } = git(directory, ['status', '--porcelain']);
        const { status = -1, stdout = '', stderr = '' } = run(directory, [currentVersion, '--dry-run']);
        strictEqual(status, 0, stderr);
        const { dryRun = false, currentVersion: from = '', targetVersion = '', date = '', changelog = {}, files: plan = [], verification = [] } = JSON.parse(stdout);
        const { from: heading = '', to = '' } = changelog;
        strictEqual(dryRun, true);
        strictEqual(from, currentVersion);
        strictEqual(targetVersion, currentVersion);
        strictEqual(heading, `## ${currentVersion} — Unreleased`);
        strictEqual(to, `## ${currentVersion} — ${date}`);
        match(date, /^\d{4}-\d{2}-\d{2}$/u);
        deepStrictEqual(plan.map(({ file = '' } = {}) => file).toSorted(), owners.toSorted());
        deepStrictEqual(verification, ['npm run check', 'git diff --check']);
        strictEqual(existsSync(join(directory, '.checks.jsonl')), false);
        [nextVersion, '01.2.3'].forEach((version) => {
            const { status = 0 } = run(directory, [version]);
            strictEqual(status, 1);
        });
        deepStrictEqual(snapshot(directory), before);
        const { stdout: statusAfter = '' } = git(directory, ['status', '--porcelain']);
        strictEqual(statusAfter, statusBefore);
        strictEqual(existsSync(join(directory, '.checks.jsonl')), false);
    });
});

test('release preparation updates real product metadata and the actual npm tarball coherently', () => {
    withFixture({ generic: true }, (directory) => {
        const { status = -1, stdout = '', stderr = '' } = run(directory, ['patch']);
        strictEqual(status, 0, stdout + stderr);
        const manifest = JSON.parse(read(directory, 'package.json'));
        const { version = '' } = manifest;
        strictEqual(version, nextVersion);
        const observations = read(directory, '.checks.jsonl').trim().split('\n').map(JSON.parse);
        const [{ packedVersion = '', heading: preparedHeading = '', messages = [] } = {}] = observations;
        strictEqual(packedVersion, nextVersion);
        deepStrictEqual(messages, []);
        const changelog = read(directory, 'CHANGELOG.md');
        ok(changelog.startsWith(`# Changelog\n\n## Unreleased\n\n## ${nextVersion} — `));
        ok(changelog.includes(`## ${currentVersion} — 2026-01-01\n\n- Preserve prior history.\n`));
        const { stdout: changed = '' } = git(directory, ['diff', '--name-only']);
        deepStrictEqual(changed.trim().split('\n').toSorted(), owners.toSorted());
        writeFileSync(join(directory, 'CHANGELOG.md'), changelog.replace('## Unreleased\n\n', '')
            .replace(preparedHeading, `## ${nextVersion} — Unreleased`));
        const namedBefore = snapshot(directory);
        const { status: finalized = -1, stdout: finalizedOutput = '', stderr: finalizedError = '' } = run(directory, [nextVersion]);
        strictEqual(finalized, 0, finalizedOutput + finalizedError);
        snapshot(directory).forEach(({ file = '', bytes = Buffer.alloc(0) } = {}, index) => {
            const { bytes: before = Buffer.alloc(0) } = namedBefore.at(index);

            if (file === 'CHANGELOG.md') {
                ok(!bytes.equals(before));

                return;
            }

            deepStrictEqual(bytes, before);
        });
        const completed = read(directory, '.checks.jsonl').trim().split('\n').map(JSON.parse).at(-1);
        const { version: finalizedVersion = '', packedVersion: finalizedPackage = '', heading: finalizedHeading = '' } = completed;
        strictEqual(finalizedVersion, nextVersion);
        strictEqual(finalizedPackage, nextVersion);
        ok(finalizedHeading.startsWith(`## ${nextVersion} — `) && !finalizedHeading.endsWith('Unreleased'));
        const beforeCheck = snapshot(directory);
        const { status: checked = -1, stdout: checkOutput = '', stderr: checkError = '' } = run(directory, ['--check']);
        strictEqual(checked, 0, checkOutput + checkError);
        deepStrictEqual(snapshot(directory), beforeCheck);
        ok(git(directory, ['rev-parse', '--verify', 'HEAD']).status !== 0);
        strictEqual(git(directory, ['tag', '--list']).stdout, '');
    });
});

test('a genuine product lint failure restores every version owner to its exact authored bytes', () => {
    withFixture({ generic: true, invalid: true }, (directory) => {
        const before = snapshot(directory);
        const { stdout: statusBefore = '' } = git(directory, ['status', '--porcelain']);
        const { status = 0, stdout = '', stderr = '' } = run(directory, ['patch']);
        strictEqual(status, 1, stdout + stderr);
        const [{ version = '', heading = '', messages = [] } = {}] = read(directory, '.checks.jsonl').trim().split('\n').map(JSON.parse);
        strictEqual(version, nextVersion);
        ok(heading.startsWith(`## ${nextVersion} — `) && !heading.endsWith('Unreleased'));
        ok(messages.some(({ ruleId = '', severity = 0 } = {}) => ruleId === 'resilient/signature-contract-operation' && severity === 2));
        deepStrictEqual(snapshot(directory), before);
        const { stdout: statusAfter = '' } = git(directory, ['status', '--porcelain']);
        strictEqual(statusAfter, statusBefore);
        const { version: workspaceVersion = '' } = JSON.parse(read(source, 'package.json'));
        strictEqual(workspaceVersion, currentVersion);
    });
});
