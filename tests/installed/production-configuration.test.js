import { deepStrictEqual, ok, rejects, strictEqual, throws } from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import js from '@eslint/js';
import { ESLint } from 'eslint';

import plugin, { createProjectAdapter } from 'eslint-plugin-resilient';
import production from 'eslint-plugin-resilient/production';

const { presets = {}, files = [] } = JSON.parse(readFileSync(new URL('./production-policy.json', import.meta.url), 'utf8'));
const directory = mkdtempSync(resolve('configuration-'));
const write = (file, source = '') => {
    const path = join(directory, file);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);

    return path;
};

write('package.json', JSON.stringify({ name: 'resilient-embedded-consumer', private: true, type: 'module', dependencies: { espree: '11.2.0' } }));

const eslint = new ESLint({ cwd: directory, overrideConfigFile: true, overrideConfig: production({ cwd: directory, aliases: { '@': 'src' } }) });

test('installed production policy rejects CommonJS wrapper globals in ESM', async () => {
    const [{ messages = [] } = {}] = await eslint.lintText('require("node:fs"); module.exports = exports; __dirname; __filename;',
        { filePath: join(directory, 'src/esm-globals.js') });

    strictEqual(messages.filter(({ ruleId = '' } = {}) => ruleId === 'no-undef').length, 5);
});

test('four JavaScript presets preserve every frozen rule and core entry', () => {
    ['recommended', 'contracts', 'safety', 'imports'].forEach((name) => {
        const { [name]: { rules = {} } = {} } = presets;
        const { configs = {} } = plugin;
        const { [name]: { rules: actual = {} } = {} } = configs;

        deepStrictEqual(actual, rules);
    });
    const cores = Object.entries(plugin.configs.recommended.rules).filter(([name = '', value = ''] = []) => !name.includes('/') && value !== 'off');

    strictEqual(cores.length, 33);
    strictEqual(plugin.configs.recommended.rules['operator-linebreak'], 'off');
    deepStrictEqual(plugin.configs.contracts.settings, presets.contracts.settings);
});

test('actual production JS paths retain resolved policy and explicit host-only boundaries', async () => {
    await Promise.all(files.filter(({ production: configured = {} } = {}) => configured && Object.hasOwn(configured, 'rules')).map(async ({ file = '', production: expected = {} } = {}) => {
        const configured = await eslint.calculateConfigForFile(file);
        const { rules: oldRules = {}, languageOptions = {} } = expected;
        const retained = Object.fromEntries(Object.entries(oldRules).filter(([name = ''] = []) => !name.startsWith('n/') && !name.startsWith('eslint-plugin/'))
            .map(([name = '', configured = []] = []) => {
                if (name !== 'import/no-extraneous-dependencies') return [name, configured];

                const [severity = 0, options = {}] = configured;

                return [name, [severity, { ...options, packageDir: directory }]];
            }));
        const { rules = {}, languageOptions: actualLanguage = {}, settings: { resilient = {} } = {}, linterOptions = {} } = configured;

        Object.entries(retained).forEach(([name = '', value = []] = []) => {
            const { [name]: actual = [] } = rules;

            deepStrictEqual(actual, value, `${file}: ${name}`);
        });
        Object.keys(js.configs.recommended.rules).forEach(name => ok(Object.hasOwn(rules, name), name));
        deepStrictEqual(rules, { ...retained, ...Object.fromEntries(Object.keys(plugin.configs.imports.rules).map(name => [name, [2]])) });
        const { globals = {}, parserOptions = {}, ecmaVersion = 0, sourceType = '', parser: expectedParser = '' } = languageOptions;

        const { globals: actualGlobals = {}, parserOptions: actualParserOptions = {}, ecmaVersion: actualVersion = 0, sourceType: actualType = '',
            parser: { name: parserName = '', version: parserVersion = '' } = {} } = actualLanguage;
        const { evidenceMessages = false, resolver = false } = resilient;
        const { reportUnusedDisableDirectives = 0, reportUnusedInlineConfigs = 0 } = linterOptions;

        deepStrictEqual(actualGlobals, globals);
        deepStrictEqual(actualParserOptions, parserOptions);
        deepStrictEqual([actualVersion, actualType, `${parserName}@${parserVersion}`], [ecmaVersion, sourceType, expectedParser]);
        strictEqual(evidenceMessages, true);
        strictEqual(typeof resolver, 'function');
        strictEqual(reportUnusedDisableDirectives, 2);
        strictEqual(reportUnusedInlineConfigs, 2);
        ok(!Object.keys(rules).some(name => name.startsWith('n/') || name.startsWith('eslint-plugin/')));
    }));
    deepStrictEqual(await Promise.all(['docs/ignored.js', 'node_modules/dependency/index.js']
        .map(file => eslint.isPathIgnored(file))), [true, true]);
    strictEqual(await eslint.isPathIgnored('tests/fixtures/bad.js'), false);
});

test('embedded project dependency declarations are independent of the launcher directory', async () => {
    const declared = write('src/declared.js', "import { parse } from 'espree';\n\nexport { parse };\n");
    const undeclared = write('src/undeclared.js', "import globals from 'globals';\n\nexport { globals };\n");
    const [{ messages: accepted = [] } = {}, { messages: rejected = [] } = {}] = await eslint.lintFiles([declared, undeclared]);
    const dependencyErrors = messages => messages.filter(({ ruleId = '' } = {}) => ruleId === 'import/no-extraneous-dependencies');

    strictEqual(dependencyErrors(accepted).length, 0);
    strictEqual(dependencyErrors(rejected).length, 1);
    ok(rejected.some(({ message = '' } = {}) => message.includes("'globals' should be listed")));
});

test('aliases and relative imports feed import validation and product evidence together', async () => {
    const provider = write('src/provider.js', "export const read = ({ value = '' } = {}) => value.trim();\n");
    const consumer = write('src/consumer.js', "import { read } from '@/provider';\n\nread({ value: 1 });\n");
    const [{ messages = [] } = {}] = await eslint.lintFiles([consumer]);

    ok(messages.some(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-call-site'));
    ok(!messages.some(({ ruleId = '' } = {}) => ruleId === 'import/no-unresolved'));
    write('src/provider.js', 'export const read = ({ value = 0 } = {}) => value;\n');

    const [{ messages: revised = [] } = {}] = await eslint.lintFiles([consumer]);

    ok(!revised.some(({ ruleId = '' } = {}) => ruleId === 'resilient/signature-contract-call-site'));
    const missing = write('src/missing.js', "import { absent } from '@/absent';\n\nexport { absent };\n");
    const [{ messages: unresolved = [] } = {}] = await eslint.lintFiles([missing]);

    ok(unresolved.some(({ ruleId = '' } = {}) => ruleId === 'import/no-unresolved'));
    const project = createProjectAdapter({ cwd: directory, aliases: { '@': 'src' } });

    strictEqual(project.resolver({ from: consumer, source: '@/provider' }), provider);
    strictEqual(project.resolver({ from: consumer, source: './provider' }), provider);
    strictEqual(project.resolver({ from: consumer, source: './absent' }), '');
});

test('root ordering, alias precedence and directory selection retain their supported utility meanings', () => {
    const outer = write('app/layout.js');
    const inner = write('app/route/layout.js');
    const inferred = write('app/route/error.js');
    const page = write('app/route/page.js');
    const component = write('components/Widget.jsx');
    const index = write('utils/index.js');
    const project = createProjectAdapter({ cwd: directory, root: 'app', entryFiles: ['page'], ancestorFiles: ['layout'], inferredFiles: ['error'],
        aliases: { '@': 'src', '@/ui': 'components', '@/utils': 'utils' }, extensions: ['js', '.jsx'] });

    deepStrictEqual(project.roots({ fileName: page }), [outer, inner, inferred]);
    const filesystem = createProjectAdapter({ cwd: directory, root: resolve('/'), entryFiles: ['page'], ancestorFiles: ['layout'], inferredFiles: ['error'] });

    deepStrictEqual(filesystem.roots({ fileName: page }).filter(file => file.startsWith(directory)), [outer, inner, inferred]);
    deepStrictEqual(project.roots({ fileName: component }), []);
    strictEqual(project.resolver({ from: page, source: '@/ui/Widget' }), component);
    strictEqual(project.resolver({ from: page, source: '@/utils' }), index);
    strictEqual(project.resolver({ from: page, source: '@@/Widget' }), '');
});

test('filesystem and resolver operational failures remain failures', async () => {
    const loop = join(directory, 'src/loop.js');

    symlinkSync('loop.js', loop);

    const project = createProjectAdapter({ cwd: directory, aliases: { '@': 'src' } });
    const consumer = write('src/broken.js', "import { read } from '@/loop';\n\nread(1);\n");

    throws(() => project.resolver({ from: consumer, source: '@/loop' }), { code: 'ELOOP' });
    const { settings: { 'import-x/resolver-next': [resolver = {}] = [] } = {} } = plugin.imports({ cwd: directory, aliases: { '@': 'src' } });

    throws(() => resolver.resolve('@/loop', consumer), { code: 'ELOOP' });
    await rejects(() => eslint.lintFiles([consumer]), { code: 'ELOOP' });
    write('src/syntax.js', 'export const = ;');

    const [{ fatalErrorCount = 0 } = {}] = await eslint.lintFiles(['src/syntax.js']);

    strictEqual(fatalErrorCount, 1);
});
