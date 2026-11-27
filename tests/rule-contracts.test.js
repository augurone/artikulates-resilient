import { deepStrictEqual, strictEqual, throws, ok, rejects } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter, ESLint } from 'eslint';
import { parse } from 'espree';

import plugin from 'eslint-plugin-resilient/eslint';

// Actual configured diagnostics, safe fixes/no-rewrites, host options, exact exception scopes and native failure/identity witnesses replace basic negative/positive rule
// grids already owned by the canary.

{
    const linter = new Linter();
    const lint = (source, name) => linter.verify(source, {
        plugins: { resilient: plugin },
        rules: { [`resilient/${name}`]: 'error' }
    });

    test('length spelling does not establish a collection or a safe truthiness replacement', () => {
        const cases = [
            ['({ length: -1 }).length > 0', '!!({ length: -1 }).length'],
            ['({ length: null }).length === 0', '!({ length: null }).length'],
            ['({ length: 0n }).length === 0', '!({ length: 0n }).length'],
            ['({ length: NaN }).length !== 0', '!!({ length: NaN }).length'],
            ['({ length: 0.5 }).length >= 1', '!!({ length: 0.5 }).length'],
            ['({ length: NaN }).length <= 0', '!({ length: NaN }).length']
        ];

        cases.forEach(([original = '', replacement = ''] = []) => {
            const [finding = {}] = lint(`const check = () => ${original};`, 'no-length-comparison');
            const { messageId = '', suggestions = [] } = finding;

            strictEqual(messageId, 'lengthComparison');
            deepStrictEqual(suggestions, []);
            strictEqual(runInNewContext(original), !runInNewContext(replacement));
        });
    });

    test('length policy leaves authored source unchanged when fixing', () => {
        const source = 'const check = items => [items.length >= 1, items.length < 1, 0 >= items.length];';
        const { output = '', fixed = false, messages = [] } = linter.verifyAndFix(source, {
            plugins: { resilient: plugin }, rules: { 'resilient/no-length-comparison': 'error' }
        });

        strictEqual(output, source);
        strictEqual(fixed, false);
        strictEqual(messages.length, 3);
    });

    test('an unavailable regex payload is not an authored null literal', () => {
        const source = 'const pattern=/(?i:a)/; const read=()=>/(?i:a)/; const absent=null; const missing=()=>null;';
        const { body: [{ declarations: [{ init: { value = {}, regex: { pattern = '' } = {} } = {} } = {}] = [] } = {}] = [] } = parse(source, {
            ecmaVersion: 'latest', sourceType: 'module'
        });

        strictEqual(value, null, 'The private Node parser cannot construct this newer regex payload');
        strictEqual(pattern, '(?i:a)');
        ['no-null-assignment', 'prefer-falsey-returns'].forEach((name) => {
            const [finding = {}, ...others] = lint(source, name);
            const { column = 0, endColumn = 0 } = finding;

            deepStrictEqual(others, []);
            strictEqual(source.slice(column - 1, endColumn - 1), 'null');
        });
    });

    test('exact cardinality and other length relations keep their own meaning', () => {
        ['items.length === 1', 'items.length !== 1', 'items.length > 1', 'items.length <= 1', '1 === items.length',
            'items.length < 0', '0 > items.length',
            'items.length == 0', 'items.length >= 0', 'items.length', '!items.length', '!!items.length']
            .forEach(value => deepStrictEqual(lint(`const check = items => ${value};`, 'no-length-comparison'), []));
    });

    test('null assignment lookup keeps a bounded stack at 2000 logical operands', () => {
        const depth = 2000;
        const source = `const result = ${Array.from({ length: depth }, () => 'external').join(' || ')};`;
        const control = linter.verify(source, {
            plugins: { resilient: plugin }, rules: { 'resilient/no-null-assignment': 'off' }
        });

        deepStrictEqual(control, [], 'The public host can parse and traverse this source without the rule');
        deepStrictEqual(lint(source, 'no-null-assignment'), []);
    });

    test('null assignment lookup stays bounded beyond the host scope walker depth', (context) => {
        const init = Array.from({ length: 10000 }).reduce(left => ({
            type: 'LogicalExpression', operator: '||', left, right: { type: 'Identifier', name: 'external' }
        }), { type: 'Identifier', name: 'external' });
        const report = context.mock.fn();
        const listeners = plugin.rules['no-null-assignment'].create({ report });

        listeners.VariableDeclarator({ init });
        strictEqual(report.mock.callCount(), 0);
    });

    test('null assignment lookup retains the selected literal after a long logical prefix', () => {
        const source = `const result = ${[...Array.from({ length: 2000 }, () => 'external'), 'null', 'null'].join(' || ')};`;
        const [finding = {}, ...others] = lint(source, 'no-null-assignment');
        const { ruleId = '', messageId = '', column = 0, endColumn = 0 } = finding;

        deepStrictEqual(others, []);
        strictEqual(ruleId, 'resilient/no-null-assignment');
        strictEqual(messageId, 'nullAssignment');
        // The preceding null is consumed by ||; only the final null can be assigned.
        strictEqual(column, source.lastIndexOf('null') + 1);
        strictEqual(endColumn, column + 4);
        strictEqual(runInNewContext(`${source}result;`, { external: false }), null);
        strictEqual(runInNewContext(`${source}result;`, { external: 'ready' }), 'ready');
    });

    test('no-else reports every alternate and offers no control-flow rewrite', () => {
        const source = 'if (a) run(); else if (b) stop(); else finish();';
        const messages = lint(source, 'no-else');

        deepStrictEqual(messages.map(({ messageId = '', column = 0, suggestions = [], fix = false } = {}) => {
            strictEqual(messageId, 'noElse');
            deepStrictEqual(suggestions, []);
            strictEqual(fix, false);

            return column;
        }), [source.indexOf('if (b)') + 1, source.indexOf('finish') + 1]);
    });

    test('return findings preserve selected spans and native versus shadowed absence in source order', () => {
        const lines = [
            'const native = (flag, other) => (null, flag ? (value = null) : other ? void 0 : undefined);',
            'const shadowed = undefined => (void 9, flag ? (value = null) : other ? void 1 : undefined);'
        ];
        const messages = lint(lines.join('\n'), 'prefer-falsey-returns');

        deepStrictEqual(messages.map(({ ruleId = '', messageId = '', line = 0, column = 0, endColumn = 0 } = {}) => {
            strictEqual(ruleId, 'resilient/prefer-falsey-returns');
            strictEqual(messageId, 'falseyReturn');

            return { line, column, endColumn, text: lines.at(line - 1).slice(column - 1, endColumn - 1) };
        }), [[1, 'null'], [1, 'void 0'], [1, 'undefined'], [2, 'null'], [2, 'void 1']].map(([line = 0, text = ''] = []) => {
            const column = lines.at(line - 1).lastIndexOf(text) + 1;

            return { line, column, endColumn: column + text.length, text };
        }));
    });

    test('the recommended public preset enables all five control and layout policies', () => {
        const sources = [
            ['no-else', 'if (a) run(); else stop();'],
            ['no-nested-if', 'if (a) { if (b) stop(); }'],
            ['no-length-comparison', 'const check = items => items.length > 0;'],
            ['prefer-falsey-returns', 'const check = () => null;'],
            ['operator-linebreak', 'const total =\n    left + right;']
        ];

        sources.forEach(([name = '', source = ''] = []) => {
            const findings = linter.verify(source, plugin.configs.recommended);
            const matching = findings.filter(({ ruleId = '' } = {}) => ruleId === `resilient/${name}`);
            const [{ severity = 0 } = {}] = matching;

            strictEqual(matching.length, 1, name);
            strictEqual(severity, 2, name);
        });
    });
}

{
    const cases = JSON.parse(readFileSync(new URL('./fixtures/syntax-policy.json', import.meta.url), 'utf8'));

    cases.forEach((record) => {
        const { rule = '', pluginName = 'resilient', source = '', options = [], languageOptions = {}, expected = [], output: expectedOutput = '' } = record;

        test(`${rule} ${expected.length ? 'reports' : 'accepts'}: ${source}`, () => {
            const configuration = { languageOptions, plugins: { [pluginName]: plugin }, rules: { [`${pluginName}/${rule}`]: ['error', ...options] } };
            const linter = new Linter();
            const messages = linter.verify(source, configuration);

            deepStrictEqual(messages.map(({ messageId = '' } = {}) => messageId), expected.map(({ messageId = '' } = {}) => messageId));

            if (Object.hasOwn(record, 'output')) {
                const { output = '' } = linter.verifyAndFix(source, configuration);

                strictEqual(output, expectedOutput);
            }
        });
    });

    test('operator placement preserves host options outside initializer comments', () => {
        const source = 'const value =\n    initialize();';
        const linter = new Linter();
        const check = (rule, options) => {
            const { messages = [], ...result } = linter.verifyAndFix(source, {
                plugins: { resilient: plugin }, rules: { [rule]: ['error', ...options] }
            });

            return { ...result, messages: messages.map(({ ruleId = '', ...message } = {}) => ({ ...message, ruleId: ruleId.replace('resilient/', '') })) };
        };

        [[], ['after'], ['none'], ['before', { overrides: { '=': 'after' } }],
            ['before', { overrides: { '=': 'none' } }], ['before', { overrides: { '=': 'ignore' } }]]
            .forEach(options => deepStrictEqual(check('resilient/operator-linebreak', options), check('operator-linebreak', options)));
    });

    test('initializer comments retain authored diagnostic suppression boundaries when fixing', () => {
        const sources = [
            'const value =\n    // eslint-disable-next-line no-undef -- Host initializer.\n    host();\nneighbor();',
            '/* eslint-disable no-undef -- Host initializer. */\nconst value =\n    // authored comment\n    host();\n/* eslint-enable no-undef */\nneighbor();',
            '/* eslint-disable no-undef -- Exact endpoint. */\nconst value =\n    /* eslint-enable no-undef */\n    // authored comment\n    host();\nneighbor();',
            'const value =\n    /* eslint-disable no-undef -- Host initializer. */\n    host();\n/* eslint-enable no-undef */\nneighbor();'
        ];
        const linter = new Linter();
        const configuration = { plugins: { resilient: plugin }, linterOptions: { reportUnusedDisableDirectives: false }, rules: {
            'resilient/operator-linebreak': ['error', 'before', { overrides: { '&&': 'after', '||': 'after' } }], 'no-undef': 'error'
        } };

        sources.forEach((source) => {
            const visible = linter.verify(source, configuration);
            const suppressed = linter.getSuppressedMessages();
            const { output = '', fixed = true, messages = [] } = linter.verifyAndFix(source, configuration);

            strictEqual(output, source);
            strictEqual(fixed, false);
            deepStrictEqual(messages, visible);
            linter.verify(output, configuration);
            deepStrictEqual(linter.getSuppressedMessages(), suppressed);
        });
    });
}

{
    const rule = 'resilient/no-silent-catch';
    const config = { plugins: { resilient: plugin }, rules: { [rule]: 'error' } };

    test('catch handling is an explicit source obligation without an automatic rewrite', () => {
        const source = 'try { work(); } catch { label: {{;}} }\np["catch"]?.(function () {});\np.then(value => value, () => {});';
        const expected = new Linter().verify(source, config);
        const { output = '', fixed = true, messages = [] } = new Linter().verifyAndFix(source, config);

        strictEqual(output, source);
        strictEqual(fixed, false);
        deepStrictEqual(expected.map(({ messageId = '', line = 0, column = 0, endColumn = 0 } = {}) => [messageId, source.split('\n').at(line - 1).slice(column - 1, endColumn - 1)]),
            [['silentCatch', '{ label: {{;}} }'], ['silentCatch', '{}'], ['silentCatch', '{}']]);
        deepStrictEqual(messages, expected);
    });

    test('failure handler roles preserve explicit returns and unproved argument positions', async () => {
        const source = `const run = (p, key, handler, items = []) => {
            p.then(() => {}, handler);
            p.catch(handler);
            p[key](() => {});
            p.then(...items, () => {});
            p.catch(...items, () => {});
            p.catch(() => undefined);
            p.catch(() => { return; });
        };`;

        deepStrictEqual(new Linter().verify(source, config), []);
        strictEqual(await runInNewContext('Promise.reject("failure").catch(() => {})'),
            await runInNewContext('Promise.reject("failure").catch(() => { return; })'));
        strictEqual(await runInNewContext('Promise.resolve(7).then(value => value, () => {})'), 7);
        await rejects(runInNewContext('Promise.reject(new Error("retained")).then(...[], () => {})'), { message: 'retained' });
    });

    test('catch reporting failures remain operational through the lint host', () => {
        const failure = new Error('catch report failed');
        const implementation = Reflect.get(plugin.rules, 'no-silent-catch');
        const broken = { ...implementation, create() {
            return implementation.create({ report() { throw failure; } });
        } };

        throws(() => new Linter().verify('request.catch(() => {});', {
            plugins: { probe: { rules: { handling: broken } } }, rules: { 'probe/handling': 'error' }
        }), error => error === failure);
    });
}

{
    const mutation = 'resilient/prefer-safe-transformations';
    const members = 'resilient/prefer-destructured-member-access';
    const loops = 'resilient/prefer-prototype-methods';
    const lint = (source, options = {}, rules = {}) => new Linter().verify(source, {
        plugins: { resilient: plugin }, rules: { [mutation]: ['error', options], ...rules }
    });

    test('member targets preserve mutation policy and surrounding data reads without a rewrite', () => {
        const source = 'const update=(record,key,input)=>{record.value=1;record.count+=1;record.count++;delete record.old;'
            + '({value:record.value=key.fallback}=input);[record.first,...record.rest]=input;record.child.value=key.name;};';
        const messages = lint(source, {}, { [members]: 'error' });
        const slices = rule => messages.filter(({ ruleId = '' } = {}) => ruleId === rule)
            .map(({ column = 0, endColumn = 0 } = {}) => source.slice(column - 1, endColumn - 1));

        deepStrictEqual(slices(members), ['key.fallback', 'record.child', 'key.name']);
        deepStrictEqual(slices(mutation), ['record.value=1', 'record.count+=1', 'record.count++', 'delete record.old',
            'record.value', 'record.first', 'record.rest', 'record.child.value=key.name']);
        const { output = '', fixed = true, messages: retained = [] } = new Linter().verifyAndFix(source, {
            plugins: { resilient: plugin }, rules: { [mutation]: 'error', [members]: 'error' }
        });

        strictEqual(output, source);
        strictEqual(fixed, false);
        deepStrictEqual(retained, messages);
    });

    test('an exact mutation exception preserves data-read policy and writable reference behavior', () => {
        const source = `const update=record=>{\n// eslint-disable-next-line ${mutation} -- Update the object whose identity is held by the caller.\nrecord.count+=1;return record.label;};`;
        const [finding = {}, ...others] = lint(source, {}, { [members]: 'error' });
        const { ruleId = '' } = finding;

        deepStrictEqual(others, []);
        strictEqual(ruleId, members);
        const native = runInNewContext(`(() => {
            const events = [];
            const record = { get count() { events.push('read'); return 1; }, set count(value) { events.push(value); },
                get old() { throw new Error('unexpected property read'); } };
            const alias = record;
            alias.count += 1;
            delete alias.old;
            return { same: alias === record, events, removed: !Object.hasOwn(record, 'old') };
        })()`);

        const { events = [] } = native;

        deepStrictEqual({ ...native, events: Array.from(events) }, { same: true, events: ['read', 2], removed: true });
        throws(() => runInNewContext('const record={get old(){throw new Error("unexpected property read");}};const {old}=record;'), /unexpected property read/u);
    });

    [
        'for(;;)break;', 'for(const key in record)consume(key);', 'for(const item of items)consume(item);',
        'while(flag)consume();', 'do{consume();}while(flag);', 'const run=async()=>{for await(const item of items)await consume(item);};',
        'const run=()=>{for(const item of items){if(item)return item;throw item;}};'
    ].forEach(source => test(`loop constraints remain findings: ${source}`, () => {
        const messages = lint(source, {}, { [loops]: 'error' });

        strictEqual(messages.length, 1);
        strictEqual(messages.at(0).ruleId, loops);
        const { output = '', fixed = true } = new Linter().verifyAndFix(source, { plugins: { resilient: plugin }, rules: { [loops]: 'error' } });

        strictEqual(output, source);
        strictEqual(fixed, false);
    }));

    test('a retained loop does not exempt nested mutations, and mutation options do not exempt the loop', () => {
        const body = 'for(target.value of items)output["push"](target.value);';
        const source = `// eslint-disable-next-line ${loops} -- Preserve live iterator order.\n${body}`;

        deepStrictEqual(lint(source, {}, { [loops]: 'error' }).map(({ ruleId = '' } = {}) => ruleId), [mutation, mutation]);
        deepStrictEqual(lint(body, { ignoredBindings: ['target', 'output'] }, { [loops]: 'error' }).map(({ ruleId = '' } = {}) => ruleId), [loops]);
    });

    test('neither awaited nor synchronous I/O waives a concrete loop exception', () => {
        const asynchronous = 'for(const path of paths)await writeFile(path);';
        const synchronous = 'for(const path of paths)readFileSync(path);';
        const source = `const run=async()=>{\n${asynchronous}\n${synchronous}\n};`;
        const explained = source.replace(asynchronous, `// eslint-disable-next-line ${loops} -- Await each write in source order.\n${asynchronous}`);

        deepStrictEqual(lint(source, {}, { [loops]: 'error' }).map(({ ruleId = '' } = {}) => ruleId), [loops, loops]);
        deepStrictEqual(lint(explained, {}, { [loops]: 'error' }).map(({ ruleId = '' } = {}) => ruleId), [loops]);
        deepStrictEqual(lint(explained.replace(synchronous,
            `// eslint-disable-next-line ${loops} -- Read the live directory entries synchronously in order.\n${synchronous}`), {}, { [loops]: 'error' }), []);
    });

    test('presets, severity, options and reused host syntax keep their contracts', () => {
        strictEqual(plugin.configs.recommended.rules[loops], 'error');
        strictEqual(plugin.configs.safety.rules[mutation], 'error');
        const engine = new Linter();
        const source = 'items["push"](value);';
        const config = { plugins: { resilient: plugin }, rules: { [mutation]: 'warn' } };
        const original = engine.verify(source, config);
        const host = engine.getSourceCode();

        strictEqual(original.at(0).severity, 1);
        deepStrictEqual(engine.verify(host, { ...config, rules: { [mutation]: ['error', { ignoredBindings: ['items'] }] } }), []);
        deepStrictEqual(engine.verify(host, config), original);
        throws(() => engine.verify(source, { ...config, rules: { [mutation]: ['error', { ignoredBindings: true }] } }));
    });

    test('tagged mutation has a runtime witness with preserved receiver and argument order', () => {
        const source = 'const items=[];const seen=[];items.push`value${seen.push("effect")}`;JSON.stringify([items.length,items[0][0],items[1],seen]);';

        strictEqual(runInNewContext(source), '[2,"value",1,["effect"]]');
        strictEqual(lint(source).length, 2);
    });

    test('tagged receiver calls do not borrow their callee names for exceptions', () => {
        const source = 'getItems().push`value`;';

        strictEqual(lint(source, { ignoredBindings: ['getItems', ''], ignoredParameters: ['getItems', ''] }).length, 1);
    });

    test('tagged findings retain multiline spans and independent loop exceptions', () => {
        const source = '// eslint-disable-next-line resilient/prefer-prototype-methods -- Preserve live iteration.\nfor(const item of items) bucket.push`\n${item}\n`;';
        const messages = new Linter().verify(source, { plugins: { resilient: plugin }, rules: { [mutation]: 'error', 'resilient/prefer-prototype-methods': 'error' } });

        strictEqual(messages.length, 1);
        const [{ ruleId = '', line = 0, column = 0, endLine = 0, endColumn = 0 } = {}] = messages;

        strictEqual(ruleId, mutation);
        deepStrictEqual([line, column, endLine, endColumn], [2, 26, 4, 2]);
    });

    test('native effects and syntactic mutation are independent consumers', () => {
        const source = 'const state={items:[]};state.items="";state.items.map(value=>value);';
        const findings = lint(source, {}, { 'resilient/signature-contract-operation': 'error' });

        deepStrictEqual(findings.map(({ ruleId = '' } = {}) => ruleId), [mutation, 'resilient/signature-contract-operation']);
    });

    test('mutation policy reports every target without an automatic rewrite', () => {
        const source = 'state.value=1;items.push(value);items.push`value`;delete state.value;';
        const expected = lint(source);
        const { output = '', fixed = true, messages = [] } = new Linter().verifyAndFix(source, {
            plugins: { resilient: plugin }, rules: { [mutation]: 'error' }
        });

        strictEqual(output, source);
        strictEqual(fixed, false);
        deepStrictEqual(messages, expected);
        messages.forEach(({ fix = false, suggestions = [] } = {}) => {
            strictEqual(fix, false);
            deepStrictEqual(suggestions, []);
        });
    });

    test('mutation reporting failures remain operational through the lint host', () => {
        const failure = new Error('mutation report failed');
        const implementation = Reflect.get(plugin.rules, 'prefer-safe-transformations');
        const broken = { ...implementation, create() {
            return implementation.create({ report() { throw failure; } });
        } };

        throws(() => new Linter().verify('items.push`value`;', {
            plugins: { probe: { rules: { mutation: broken } } }, rules: { 'probe/mutation': 'error' }
        }), error => error === failure);
    });
}

{
    const rule = 'resilient/no-falsifiable-property-key';

    test('native positions, collection keys and ordinary empty values remain valid', async () => {
        const source = [
            'const values = [7];',
            "const lookup = new Map([[0, 'value']]);",
            'const selected = new Set([0]);',
            'const { [0]: first = 0 } = values;',
            'const { [0n]: bigFirst = 0, [-0n]: signedFirst = 0 } = values;',
            'const bigLookup = new Map([[0n, 7]]);',
            'const bigSelected = new Set([0n]);',
            'const positions = [values[0], values[0n], values[-0n], values[`0`]];',
            "export const result = { first, bigFirst, signedFirst, positions, mapped: lookup.get(0), selected: selected.has(0), empty: '', count: 0, enabled: false,",
            '    bigMapped: bigLookup.get(0n), bigSelected: bigSelected.has(0n) };',
            ''
        ].join('\n');
        const { execPath = '' } = process;
        const { status = -1 } = spawnSync(execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 5000 });
        const [{ messages = [] } = {}] = await new ESLint().lintText(source, { filePath: 'tests/fixtures/falsifiable-key-case.js' });

        strictEqual(status, 0);
        deepStrictEqual(messages, []);
    });

    test('dynamic keys stay unknown and a shadowed undefined is not native absence', () => {
        const source = 'const { 0: positional = 0, 0n: bigPosition = 0 } = input; const read = (key, undefined) => [input[key], input[undefined], input[0], input[-0], input["0"]];';
        const messages = new Linter().verify(source, { plugins: { resilient: plugin }, rules: { [rule]: 'error' } });

        deepStrictEqual(messages, []);
    });

    test('zero property spelling agrees with native keys while nonzero neighbors remain valid', async () => {
        const keys = ['0', '[+0]', '[-0]', '0n', '[0n]', '[-0n]', '[0x0n]', "'0'", '[`0`]'];
        const source = `console.log(JSON.stringify([${keys.map(key => `Object.keys({ ${key}: 7 })`).join(',')} ]));`;
        const { execPath = '' } = process;
        const { status = -1, stdout = '' } = spawnSync(execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 5000 });

        strictEqual(status, 0);
        deepStrictEqual(JSON.parse(stdout), keys.map(() => ['0']));
        const neighbor = 'const value = { 1: 7, [2n]: 7, [-1n]: 7, [`named`]: 7 };\n\nexport { value };\n';
        const [{ messages = [] } = {}] = await new ESLint().lintText(neighbor, { filePath: 'tests/fixtures/falsifiable-key-case.js' });

        deepStrictEqual(messages, []);
        const { status: neighborStatus = -1, stdout: neighborKeys = '' } = spawnSync(execPath,
            ['--input-type=module', '-e', `${neighbor}console.log(JSON.stringify(Object.keys(value)));`], { encoding: 'utf8', timeout: 5000 });

        strictEqual(neighborStatus, 0);
        deepStrictEqual(JSON.parse(neighborKeys), ['1', '2', '-1', 'named']);
        deepStrictEqual(new Linter().verify('const value = { [`${key}`]: 7 };', { plugins: { resilient: plugin }, rules: { [rule]: 'error' } }), []);
    });

    test('unary plus on BigInt fails before a property name exists', () => {
        const source = 'const value = { [+0n]: 7 };';
        const { execPath = '' } = process;
        const { status = -1, stderr = '' } = spawnSync(execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 5000 });

        strictEqual(status, 1);
        strictEqual(stderr.includes('TypeError'), true);
        deepStrictEqual(new Linter().verify(source, { plugins: { resilient: plugin }, rules: { [rule]: 'error' } }), []);
    });

    test('local export bindings are distinct from exported and re-exported names', () => {
        const cases = [
            ['const undefined = 7; export { undefined as result };', []],
            ["const undefined = 7; export { undefined as 'result' };", []],
            ["import { value as undefined } from './source.js'; export { undefined as result };", []],
            ["import { undefined as value } from './source.js';", [10]],
            ['const value = 7; export { value as undefined };', [36]],
            ['const undefined = 7; export { undefined };', [31]],
            ["export { undefined as result } from './source.js';", [10]],
            ["export { value as undefined } from './source.js';", [19]],
            ["export { undefined } from './source.js';", [10]],
            ["export { false } from './source.js';", [10]],
            ["export { null } from './source.js';", [10]],
            ["export { undefined as undefined } from './source.js';", [10, 23]],
            ["export { null as false } from './source.js';", [10, 18]],
            ["export { '' as '' } from './source.js';", [10, 16]],
            ["export { value } from './source.js';", []],
            ["export * as undefined from './source.js';", [13]],
            ["export * from './source.js';", []]
        ];

        cases.forEach(([source = '', columns = []] = []) => {
            const messages = new Linter().verify(source, { plugins: { resilient: plugin }, rules: { [rule]: 'error' } });

            deepStrictEqual(messages.map(({ ruleId = '', column = 0 } = {}) => ({ ruleId, column })), columns.map(column => ({ ruleId: rule, column })), source);
        });
    });

    test('a renamed local undefined export retains its runtime value and configured policy', async () => {
        const source = [
            '// eslint-disable-next-line no-shadow-restricted-names -- This regression distinguishes a local binding named undefined from a module property name.',
            'const undefined = 7;',
            '',
            'export { undefined as result };',
            ''
        ].join('\n');
        const url = `data:text/javascript,${encodeURIComponent(source)}`;
        const { execPath = '' } = process;
        const { status = -1, stdout = '' } = spawnSync(execPath, ['--input-type=module', '-e', `const { result } = await import(${JSON.stringify(url)}); console.log(result);`],
            { encoding: 'utf8', timeout: 5000 });
        const [{ messages = [] } = {}] = await new ESLint().lintText(source, { filePath: 'tests/fixtures/falsifiable-key-case.js' });

        strictEqual(status, 0);
        strictEqual(stdout.trim(), '7');
        deepStrictEqual(messages, []);
    });
}

{
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

    test('fallback ownership follows the direct lexical source without relocating defaults or effects', () => {
        const rule = 'resilient/no-destructuring-fallback';
        const config = { plugins: { resilient: plugin }, rules: { [rule]: 'error' } };
        const source = 'const read=(pair=[])=>{const use=()=>{const pair=[];const [local=""]=pair||[];return local;};'
            + 'const [first=""]=pair||[];return [first,use()];};';
        const messages = new Linter().verify(source, config);

        deepStrictEqual(messages.map(({ message = '' } = {}) => message.includes('parameter "pair"')), [false, true]);
        const authored = 'const events=[];const defaults=()=>{events.push("default");return {value:7};};'
            + 'const read=({value=0}=defaults()||{})=>{events.push("read");return value;};[read({value:9}),read(),events];';
        const { output = '', fixed = true, messages: findings = [] } = new Linter().verifyAndFix(authored, config);

        strictEqual(output, authored);
        strictEqual(fixed, false);
        strictEqual(findings.length, 1);
        deepStrictEqual(JSON.parse(JSON.stringify(runInNewContext(output))), [9, 7, ['read', 'default', 'read']]);

        const failure = new Error('source ownership lookup failed');
        const implementation = Reflect.get(plugin.rules, 'no-destructuring-fallback');
        const broken = { ...implementation, create(context = {}) {
            const { sourceCode = {} } = context;

            return implementation.create({ report: finding => context.report(finding), sourceCode: new Proxy(sourceCode, { get(target, key, receiver) {
                if (key === 'getScope') throw failure;

                return Reflect.get(target, key, receiver);
            } }) });
        } };
        const isolated = { plugins: { probe: { rules: { contract: broken } } }, rules: { 'probe/contract': 'error' } };

        deepStrictEqual(new Linter().verify('const [value=""]=ready;', isolated), []);
        throws(() => new Linter().verify(source, isolated), error => error === failure);
    });

    test('source contracts preserve known contradictions beside unknown and accept owned defaults and guards', () => {
        const fallback = 'resilient/no-destructuring-fallback';
        const shape = 'resilient/signature-contract-destructuring';
        const source = 'const supply=flag=>flag?42:external();const read=flag=>{const [first=""]=supply(flag)||[];return first;};';
        const messages = new Linter().verify(source, { plugins: { resilient: plugin }, rules: { [fallback]: 'error', [shape]: 'error' } });

        deepStrictEqual(messages.map(({ ruleId = '' } = {}) => ruleId).toSorted(), [fallback, shape].toSorted());
        ok(messages.some(({ ruleId = '', message = '' } = {}) => ruleId === shape && message.includes('number-like')));
        throws(() => runInNewContext(`${source}read(true);`), ({ name = '' } = {}) => name === 'TypeError');
        const valid = 'const defaults={value:""};export const read=({value=""}=defaults)=>value;'
            + 'export const first=(pair=[])=>{if(!pair.length)return "";const [value=""]=pair;return value;};'
            + 'export const select=(text="",fallback="")=>text||fallback;';

        deepStrictEqual(new Linter().verify(valid, [plugin.configs.recommended, plugin.configs.contracts, plugin.configs.safety]), []);
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
}
