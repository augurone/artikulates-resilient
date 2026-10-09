import { deepStrictEqual, strictEqual, ok } from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

import plugin from 'eslint-plugin-resilient/eslint';

const rule = 'resilient/prefer-safe-destructuring-defaults';
const engine = (settings = {}, cwd = process.cwd()) => new ESLint({ cwd, overrideConfigFile: true, fix: true, overrideConfig: [{
    plugins: { resilient: plugin }, rules: { [rule]: 'error' }, settings
}] });
const lint = engine();

test('missing defaults report the original declaration and never fabricate a repair', async () => {
    const source = 'const read = ({ title, nested: { value = 0 } }) => title;';
    const [{ messages = [], ...result } = {}] = await lint.lintText(source);

    deepStrictEqual(messages.map(({ ruleId = '', messageId = '', column = 0, endColumn = 0 } = {}) => ({ ruleId, messageId, column, endColumn })), [
        { ruleId: rule, messageId: 'safeDefault', column: 17, endColumn: 22 },
        { ruleId: rule, messageId: 'safeDefault', column: 32, endColumn: 45 }
    ]);
    strictEqual(Object.hasOwn(result, 'output'), false);
    ok(messages.every(message => !Object.hasOwn(message, 'fix') && !Object.hasOwn(message, 'suggestions')));
});

test('defaults, unsafe uses, supplied arguments and inconsistent returns retain their own findings', async () => {
    const engine = new ESLint({ overrideConfigFile: true, overrideConfig: [{
        plugins: { resilient: plugin }, rules: Object.fromEntries([rule, 'resilient/no-unguarded-callback-invocation',
            'resilient/signature-contract-call-site', 'resilient/signature-contract-return-consistency'].map(name => [name, 'error']))
    }] });
    const source = [
        'const run = ({ done }) => done();',
        'const label = (title = "") => title; label(42);',
        'const read = flag => flag ? [] : "";'
    ].join('\n');
    const [{ messages = [] } = {}] = await engine.lintText(source);

    deepStrictEqual([...new Set(messages.map(({ ruleId = '' } = {}) => ruleId))].toSorted(), [rule, 'resilient/no-unguarded-callback-invocation',
        'resilient/signature-contract-call-site', 'resilient/signature-contract-return-consistency'].toSorted());
});

test('the real callable consumer fixtures use local module sources without executing them', async () => {
    const root = fileURLToPath(new URL('./fixtures/rule-evidence/', import.meta.url));
    const lint = engine({}, root);
    const valid = join(root, 'consumers.valid.js');
    const invalid = join(root, 'consumers.invalid.js');
    const [{ messages: accepted = [] } = {}] = await lint.lintText(readFileSync(valid, 'utf8'), { filePath: valid });
    const [{ messages: findings = [] } = {}] = await lint.lintText(readFileSync(invalid, 'utf8'), { filePath: invalid });

    deepStrictEqual(accepted, []);
    deepStrictEqual(findings.map(({ line = 0 } = {}) => line), [4, 5, 6]);
});

test('dependency edits, re-exports and resolver changes are reflected in the next lint', async (context) => {
    const directory = mkdtempSync(join(tmpdir(), 'resilient-defaults-'));

    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const lint = engine({}, directory);
    const consumer = join(directory, 'consumer.js');
    const predicate = join(directory, 'predicate.js');
    const barrel = join(directory, 'barrel.js');
    const main = join(directory, 'main.js');
    const unsafe = join(directory, 'unsafe.js');
    const source = 'import { dispatch as use } from "./barrel.js"; const run = ({ done }) => use(1, done);';

    writeFileSync(predicate, 'throw new Error("SOURCE MUST NOT EXECUTE"); export const callable = value => typeof value === "function";');
    writeFileSync(consumer, 'import { callable as check } from "./predicate.js"; export const consume = (value, action) => () => check(action) && action(value);');
    writeFileSync(barrel, 'export { consume as dispatch } from "./consumer.js";');
    writeFileSync(unsafe, 'export const dispatch = (value, action) => action(value);');
    const [{ messages: first = [] } = {}] = await lint.lintText(source, { filePath: main });

    deepStrictEqual(first, []);
    writeFileSync(predicate, 'export const callable = value => true;');
    const [{ messages: edited = [] } = {}] = await lint.lintText(source, { filePath: main });

    strictEqual(edited.length, 1);
    writeFileSync(predicate, 'export const callable = value => typeof value === "function";');
    const redirected = engine({ resilient: { resolver: () => unsafe } }, directory);
    const [{ messages: wrong = [] } = {}] = await redirected.lintText(source, { filePath: main });

    strictEqual(wrong.length, 1);
    const [{ messages: restored = [] } = {}] = await lint.lintText(source, { filePath: main });

    deepStrictEqual(restored, []);
});

test('non-JavaScript assets do not become parser input or callable evidence', async (context) => {
    const directory = mkdtempSync(join(tmpdir(), 'resilient-default-assets-'));

    context.after(() => rmSync(directory, { recursive: true, force: true }));
    writeFileSync(join(directory, 'styles.css'), '.item { color: red; }');
    writeFileSync(join(directory, 'data.json'), '{"run": true}');
    const source = 'import "./styles.css"; import data from "./data.json" with { type: "json" }; const run = ({ done }) => data.run(done);';
    const [{ messages = [], fatalErrorCount = 0 } = {}] = await engine({}, directory).lintText(source, { filePath: join(directory, 'main.js') });

    strictEqual(fatalErrorCount, 0);
    strictEqual(messages.length, 1);
    strictEqual(messages.at(0).ruleId, rule);
});

test('unsafe exported consumers still report through literal names and nested shadows', async (context) => {
    const directory = mkdtempSync(join(tmpdir(), 'resilient-default-identity-'));

    context.after(() => rmSync(directory, { recursive: true, force: true }));
    writeFileSync(join(directory, 'consumer.js'), [
        'const consume = action => action();',
        '{ const consume = action => { if (typeof action === "function") action(); }; }',
        'const safe = action => { if (typeof action === "function") action(); };',
        'export { consume as "unsafe", safe as "safe" };'
    ].join('\n'));
    const source = 'import { "unsafe" as consume } from "./consumer.js"; const run = ({ done }) => consume(done);';
    const [{ messages = [], ...result } = {}] = await engine({}, directory).lintText(source, { filePath: join(directory, 'main.js') });

    strictEqual(messages.length, 1);
    const [{ ruleId = '', messageId = '', column = 0, endColumn = 0 } = {}] = messages;

    strictEqual(ruleId, rule);
    strictEqual(messageId, 'safeDefault');
    strictEqual(source.slice(column - 1, endColumn - 1), 'done');
    strictEqual(Object.hasOwn(result, 'output'), false);
});
