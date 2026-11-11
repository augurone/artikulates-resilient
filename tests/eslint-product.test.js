import { deepStrictEqual, strictEqual, ok, rejects } from 'node:assert/strict';
import test from 'node:test';

import { ESLint } from 'eslint';
import { parse } from 'espree';

import plugin from 'eslint-plugin-resilient/eslint';

const createLint = (options = {}) => new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{
        plugins: { resilient: plugin },
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        rules: { 'resilient/no-else': 'error', 'resilient/signature-contract-destructuring': 'error' }
    }], ...options
});
const lint = createLint();
const findings = async (code, engine = lint) => {
    const [result = {}] = await engine.lintText(code, { filePath: 'probe.js' });
    const { messages = [], fatalErrorCount = 0 } = result;

    strictEqual(fatalErrorCount, 0);

    return messages;
};

[
    ['direct array as object', 'const { attr = "" } = [];', 'array-like', 'object-like', '[]'],
    ['direct object as array', 'const [first] = {};', 'object-like', 'array-like', '{}'],
    ['const alias', 'const source = []; const alias = source; const { attr } = alias;', 'array-like', 'object-like', 'alias'],
    ['local function body', 'const read = () => { const source = {}; const [first] = source; };', 'object-like', 'array-like', 'source'],
    ['shadowed source', 'const source = {}; { const source = []; const { attr } = source; }', 'array-like', 'object-like', 'source'],
    ['string follows dialect array distinction', 'const [first] = "value";', 'string-like', 'array-like', '"value"'],
    ['null does not acquire a field default', 'const { attr = "" } = null;', 'nullish', 'object-like', 'null'],
    ['empty pattern', 'const {} = [];', 'array-like', 'object-like', '[]'],
    ['rest preserves root shape requirement', 'const {...rest} = [];', 'array-like', 'object-like', '[]'],
    ['mutable destination with known initializer', 'let [first] = {};', 'object-like', 'array-like', '{}'],
    ['object assignment from array', 'let item; ({ item } = []);', 'array-like', 'object-like', '[]'],
    ['array assignment from object', 'let first; [first] = {};', 'object-like', 'array-like', '{}'],
    ['assignment from a const alias', 'const source = []; const alias = source; let item; ({ item } = alias);', 'array-like', 'object-like', 'alias'],
    ['assignment to a member target', 'const target = {}; [target.value] = {};', 'object-like', 'array-like', '{}'],
    ['assignment default cannot repair root absence', 'let item; ({ item = "" } = null);', 'nullish', 'object-like', 'null'],
    ['assignment rest retains its root obligation', 'let rest; [...rest] = {};', 'object-like', 'array-like', '{}'],
    ['nested assignment has its own source boundary', 'let item; const [first] = ([item] = {});', 'object-like', 'array-like', '{}'],
    ['authored parameter absence', 'const read = (value = []) => { const { name } = value; };', 'array-like', 'object-like', 'value'],
    ['assignment observes authored absence', 'const assign = (source = []) => { let item; ({ item } = source); };', 'array-like', 'object-like', 'source']
].forEach(([name = '', code = '', actual = '', expected = '', source = ''] = []) => {
    test(`product lint reports ${name} with exact rule, wording and source span`, async () => {
        const messages = await findings(code);
        const start = code.lastIndexOf(source);

        deepStrictEqual(messages, [{
            ruleId: 'resilient/signature-contract-destructuring', severity: 2,
            message: `This ${actual} value is destructured as ${expected}.`,
            line: 1, column: start + 1, endLine: 1, endColumn: start + source.length + 1,
            messageId: 'mismatch'
        }]);
    });
});

[
    ['matching family', 'const source = []; const [first] = source; const { name } = { name: "" };'],
    ['unknown initializer', 'const { name } = external;'],
    ['mutable source', 'let source = []; const { name } = source;'],
    ['later lexical shadow', 'const source = []; { const { name } = source; const source = {}; }'],
    ['capture needs invocation evidence', 'const source = []; const read = () => { const { name } = source; };'],
    ['destructured source remains unknown', 'const { source = [] } = external; const { name } = source;'],
    ['computed keys may consume arrays', 'const { [0]: value = {} } = []; const { name, [1]: item } = [];'],
    ['nested defaults own their boundary', 'const [{ attr = "" } = {}] = [];'],
    ['escaped object fields need mutation evidence', 'const source = {}; external(source); const { missing } = source;'],
    ['authored method spelling is not native identity', 'const api = { trim: () => "" }; api.trim();'],
    ['conditional receiver judgments are not lint findings', 'const values = []; values.trim();'],
    ['for-of element evidence is not the iterable', 'for (const { name } of []) { name; }'],
    ['matching assignment families', 'let item; ({ item } = { item: 0 }); [item] = [];'],
    ['unknown assignment source', 'let item; ({ item } = external);'],
    ['assignment does not establish mutable source values', 'let source = []; let item; ({ item } = source); source = {}; ({ item } = source);'],
    ['assignment before a lexical shadow initializes', 'const source = []; { let item; ({ item } = source); const source = {}; }'],
    ['assignment capture still needs invocation evidence', 'const source = []; const assign = () => { let item; ({ item } = source); };'],
    ['computed assignment keys may consume arrays', 'let item; ({ [0]: item } = []); ({ name: item, [1]: item } = []);'],
    ['nested assignment defaults have separate evidence', 'let item; [{ name: item = "" } = {}] = [];'],
    ['for-of assignment consumes an element', 'let item; for ({ item } of []) { item; }']
].forEach(([name = '', code = ''] = []) => {
    test(`product lint stays quiet: ${name}`, async () => deepStrictEqual(await findings(code), []));
});

test('no-else preserves the established policy for both alternate branches', async () => {
    const code = 'if (a) run(); else if (b) stop(); else finish();';
    const messages = await findings(code);

    deepStrictEqual(messages.map(({ ruleId = '', messageId = '', column = 0 } = {}) => ({ ruleId, messageId, column })), [
        { ruleId: 'resilient/no-else', messageId: 'noElse', column: code.indexOf('if (b)') + 1 },
        { ruleId: 'resilient/no-else', messageId: 'noElse', column: code.indexOf('finish') + 1 }
    ]);
    deepStrictEqual(await findings('if (a) run(); finish();'), []);
});

test('destructuring fallback policy accepts native loop bindings without initializers and still reports a real fallback', async () => {
    const engine = createLint({ overrideConfig: [{ plugins: { resilient: plugin }, rules: { 'resilient/no-destructuring-fallback': 'error' } }] });
    const code = [
        'for (const { value } of values) { value; }',
        'for (const { length } in values) { length; }',
        'for await (const { value } of values) { value; }',
        'const { item } = source || {};'
    ].join('\n');
    const messages = await findings(code, engine);

    deepStrictEqual(messages.map(({ ruleId = '', messageId = '', line = 0, column = 0, endColumn = 0 } = {}) => ({
        ruleId, messageId, source: code.split('\n').at(line - 1).slice(column - 1, endColumn - 1)
    })), [{ ruleId: 'resilient/no-destructuring-fallback', messageId: 'destructuringFallback', source: 'source || {}' }]);
});

test('ESLint owns parser output and the new analyzer consumes that exact tree', async () => {
    const engine = createLint({ overrideConfig: [{
        plugins: { resilient: plugin },
        languageOptions: { parser: { parseForESLint(source, options) {
            // The host's source transform preserves offsets but changes the
            // evidence. Reparsing the original text would leave this unknown.
            return { ast: parse(source.replace('xx', '42'), options) };
        } } },
        rules: { 'resilient/signature-contract-destructuring': 'error' }
    }] });
    const messages = await findings('const [first] = xx;', engine);

    strictEqual(messages.length, 1);
    strictEqual(messages.at(0).message, 'This number-like value is destructured as array-like.');
});

test('separate ESLint invocations cannot reuse stale source evidence', async () => {
    const first = await findings('const value = [];\nconst { item } = value;');
    const edited = await findings('const value = {};\nconst { item } = value;');
    const repeated = await findings('const value = [];\nconst { item } = value;');

    strictEqual(first.length, 1);
    strictEqual(first.at(0).line, 2);
    strictEqual(edited.length, 1);
    strictEqual(edited.at(0).messageId, 'missingProperty');
    deepStrictEqual(repeated, first);
});

test('ordinary ESLint severity, disabling, and exact local suppression work', async () => {
    const code = 'const { item } = [];';
    const disabled = createLint({ overrideConfig: [{ plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-destructuring': 'off' } }] });
    const warning = createLint({ overrideConfig: [{ plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-destructuring': 'warn' } }] });

    deepStrictEqual(await findings(code, disabled), []);
    strictEqual((await findings(code, warning)).at(0).severity, 1);
    const [result = {}] = await lint.lintText(`// eslint-disable-next-line resilient/signature-contract-destructuring -- Deliberate negative fixture.\n${code}`);
    const { messages = [], suppressedMessages = [] } = result;

    deepStrictEqual(messages, []);
    strictEqual(suppressedMessages.length, 1);
});

test('analysis failures propagate through ESLint rather than becoming no findings', async () => {
    const failure = new Error('source evidence failed');
    const injector = { rules: { fail: {
        create() {
            return { 'Program:exit'({ body: [{ declarations: [{ init = {} } = {}] = [] } = {}] = [] } = {}) {
                // Inject only after ESLint has parsed and traversed the file.
                // The subsequent product rule must propagate its own failure.
                Object.defineProperty(init, 'properties', { get() { throw failure; } });
            } };
        }
    } } };
    const engine = createLint({ overrideConfig: [{
        plugins: { injector, resilient: plugin },
        rules: { 'injector/fail': 'error', 'resilient/signature-contract-destructuring': 'error' }
    }] });

    await rejects(() => engine.lintText('const [first] = {};'), error => error === failure);
});

test('the isolated lint configuration uses only the shipped product rules', async () => {
    const { plugins = {}, rules = {} } = await lint.calculateConfigForFile('probe.js');
    const { resilient = false } = plugins;

    strictEqual(resilient, plugin);
    strictEqual(Object.keys(plugin.rules).length, 24);
    ok(Object.keys(rules).every(rule => rule.startsWith('resilient/')));
});

test('published presets compose with explicit plugin registration and cover every shipped rule', async () => {
    const presets = Object.values(plugin.configs);

    presets.forEach(({ plugins: { resilient = false } = {} } = {}) => strictEqual(resilient, plugin));

    const engine = createLint({ overrideConfig: [...presets, { plugins: { resilient: plugin } }] });
    const { rules = {} } = await engine.calculateConfigForFile('probe.js');
    const { 'resilient/prefer-async-await': preference = [] } = rules;

    deepStrictEqual(Object.keys(rules).filter(name => name.startsWith('resilient/')).toSorted(), Object.keys(plugin.rules).map(name => `resilient/${name}`).toSorted());
    deepStrictEqual(preference, [1]);
});
