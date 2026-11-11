import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import plugin from 'eslint-plugin-resilient';
import * as agreement from 'eslint-plugin-resilient/agreement';
import * as analyzer from 'eslint-plugin-resilient/analyzer';
import { createTypeScriptAnalysis } from 'eslint-plugin-resilient/analyzer/typescript';
import product from 'eslint-plugin-resilient/eslint';

const installed = resolve('node_modules');
const expected = JSON.parse(readFileSync('expected-package-files.json', 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('the package exposes the one installed engine and its exact ESLint rules', () => {
    const { version: packageVersion = '' } = JSON.parse(readFileSync(join(installed, 'eslint-plugin-resilient/package.json'), 'utf8'));

    ok(packageVersion);
    strictEqual(plugin.rules, product.rules);
    strictEqual(Object.keys(plugin.rules).length, 24);
    strictEqual(typeof agreement.createOwner, 'function');
    strictEqual(typeof analyzer.createAnalysis, 'function');
    strictEqual(typeof createTypeScriptAnalysis, 'function');
    deepStrictEqual(plugin.meta, { name: 'eslint-plugin-resilient', version: packageVersion, namespace: 'resilient' });
    strictEqual(product.meta.version, packageVersion);
    Object.values(plugin.configs).filter(({ plugins = {} } = {}) => Object.hasOwn(plugins, 'resilient'))
        .forEach(({ plugins: { resilient = {} } = {} } = {}) => strictEqual(resilient, plugin));
});

test('all advertised imports and packed files resolve to exact installed bytes', () => {
    ['eslint-plugin-resilient/agreement', 'eslint-plugin-resilient/analyzer', 'eslint-plugin-resilient/analyzer/typescript', 'eslint-plugin-resilient/eslint', 'eslint-plugin-resilient',
        'eslint-plugin-resilient/production', 'eslint-plugin-resilient/check', 'eslint-plugin-resilient/audit',
        'eslint-plugin-resilient/typescript', 'eslint-plugin-resilient/typescript/config',
        ...['object', 'array', 'function'].map(name => `eslint-plugin-resilient/standard/${name}`)].forEach((specifier) => {
        const path = fileURLToPath(import.meta.resolve(specifier));

        strictEqual(realpathSync(path), path);
        ok(path.startsWith(`${installed}${sep}`));
    });
    Object.entries(expected).forEach(([name = '', { files = {} } = {}] = []) => Object.entries(files).forEach(([file = '', digest = ''] = []) => {
        strictEqual(hash(readFileSync(join(installed, name, file))), digest, `${name}/${file}`);
    }));
    const { dependencies = {}, exports: entries = {} } = JSON.parse(readFileSync(join(installed, 'eslint-plugin-resilient/package.json'), 'utf8'));

    strictEqual(Object.hasOwn(dependencies, 'resilient'), false);
    ok(Object.values(dependencies).every(value => !value.startsWith('file:')));
    deepStrictEqual(Object.keys(entries).toSorted(), ['.', './agreement', './analyzer', './analyzer/typescript', './audit', './check', './eslint', './production',
        './standard/array', './standard/function', './standard/object', './typescript', './typescript/config']);
});

test('ordinary dependencies are contained in the install with no workspace symlinks', () => {
    const paths = readdirSync(installed, { recursive: true });

    paths.forEach((file) => {
        const target = join(installed, file);

        if (!lstatSync(target).isSymbolicLink()) return;

        ok(file.split(sep).includes('.bin'), `Unexpected linked dependency ${file}`);
        ok(realpathSync(target).startsWith(`${installed}${sep}`));
    });
    throws(() => import.meta.resolve('resilient/analyzer'), { code: 'ERR_MODULE_NOT_FOUND' });
    ok(fileURLToPath(import.meta.resolve('typescript')).startsWith(`${installed}${sep}`));
    throws(() => import.meta.resolve('eslint-plugin-resilient/contracts'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
});

test('the installed package provides consumer metadata, release notes and usable README links', () => {
    const directory = join(installed, 'eslint-plugin-resilient');
    const { repository = {}, homepage = '', bugs: { url: issues = '' } = {}, keywords = [], private: unpublished = false }
        = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const official = 'https://github.com/augurone/artikulates-resilient';
    const { 'eslint-plugin-resilient': { files = {} } = {} } = expected;
    const readme = readFileSync(join(directory, 'README.md'), 'utf8');
    const changelog = readFileSync(join(directory, 'CHANGELOG.md'), 'utf8');
    const links = [readme, changelog].flatMap(text => [...text.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/gu)]).map(([, target = ''] = []) => target);

    deepStrictEqual(repository, { type: 'git', url: 'git+https://github.com/augurone/artikulates-resilient.git' });
    strictEqual(homepage, `${official}#readme`);
    strictEqual(issues, `${official}/issues`);
    strictEqual(unpublished, false);
    ok(keywords.includes('eslint-plugin') && keywords.includes('javascript'));
    ok(Object.hasOwn(files, 'CHANGELOG.md'));
    ok(readFileSync(join(directory, 'CHANGELOG.md'), 'utf8').trim());
    ok(links.includes('CHANGELOG.md'));
    links.forEach((target) => {
        if (target.startsWith(`${official}/`)) return;

        const [file = ''] = target.split('#');

        ok(Object.hasOwn(files, file), `README target is neither packed nor hosted in the official repository: ${target}`);
        ok(readFileSync(join(directory, file), 'utf8').trim());
    });
});

test('the delivered package contains runtime files and consumer documentation only', () => {
    const { 'eslint-plugin-resilient': { files = {} } = {} } = expected;
    const entries = Object.keys(files);
    const commands = ['scripts/check-eslint.js', 'scripts/measure-project.js', 'scripts/audit-eslint-exceptions.js',
        'scripts/lower-typescript-project.js', 'scripts/fix-javascript-worker.js', 'scripts/fluency-report.js',
        'scripts/inspect-javascript.js', 'scripts/prove-typescript-project.js'];

    entries.forEach((file) => {
        ok(file.startsWith('analysis/') || file.startsWith('transforms/') || file.startsWith('integrations/') || commands.includes(file) ||
            ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'index.js', 'config/production.js', 'config/typescript-lowering.json'].includes(file), `Unexpected package file: ${file}`);
    });
    commands.forEach(file => ok(entries.includes(file), `Missing enforcement command: ${file}`));
    [
        'analysis/agreement/index.js', 'analysis/analyzer/index.js', 'analysis/eslint/index.js', 'transforms/typescript/index.js'
    ].forEach(file => ok(entries.includes(file), `Missing owned implementation: ${file}`));
});
