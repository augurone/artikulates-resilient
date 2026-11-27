import { deepStrictEqual, match, strictEqual, throws } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { ESLint } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const cases = JSON.parse(readFileSync(new URL('./fixtures/product-workflows.json', import.meta.url), 'utf8'));
const engine = new ESLint();
const { execPath = '' } = process;

const copies = ['value=>({...value})', 'value=>{const {...rest}=value;return rest;}', 'value=>({...{...value}})'];
const conflictsFor = (analysis) => {
    const { memberAccesses = [] } = analysis;

    return memberAccesses.filter(({ name = '' } = {}) => name === 'trim').flatMap(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }).conflicts);
};

copies.forEach(copy => test(`copied fields retain undefined defaults and supplied contradictions: ${copy}`, () => {
    [['{}', []], ['{name:void 0}', []], ['{name:"ok"}', []], ['{name:null}', ['nullish']], ['{name:42}', ['number']]]
        .forEach(([input = '', expected = []] = []) => {
            const source = `const copy=${copy};const original=${input};const {name=""}=copy(original);name.trim();`;
            const analysis = createAnalysis({ source });

            deepStrictEqual(conflictsFor(analysis), expected);

            if (expected.length) throws(() => runInNewContext(source), ({ name = '' } = {}) => name === 'TypeError');

            if (!expected.length) strictEqual(typeof runInNewContext(source), 'string');

            analysis.calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
            deepStrictEqual(conflictsFor(analysis), expected);
            const invoked = createAnalysis({ source: `const copy=${copy};const original=${input};const read=({name=""}={})=>name.trim();read(copy(original));` });

            strictEqual(invoked.calls.some(({ index = -1 } = {}) => invoked.checkCall({ index }).status === 'contradiction'), !!expected.length);
        });
}));

copies.forEach(copy => test(`copied field truth and callable identity survive retirement: ${copy}`, () => {
    ['true', 'false', '0', '1', '""', '"yes"'].forEach((flag) => {
        const source = `const copy=${copy};const original={flag:${flag}};const {flag=false}=copy(original);(flag?42:"ok").trim();`;
        const fails = Boolean(runInNewContext(flag));
        const analysis = createAnalysis({ source });

        deepStrictEqual(conflictsFor(analysis), fails ? ['number'] : []);

        if (fails) throws(() => runInNewContext(source), ({ name = '' } = {}) => name === 'TypeError');

        if (!fails) strictEqual(runInNewContext(source), 'ok');
    });
    ['42', '"ok"'].forEach((input, index) => {
        const source = `const copy=${copy};const original={read:(value="")=>value.trim()};const {read}=copy(original);read(${input});`;
        const analysis = createAnalysis({ source });

        deepStrictEqual(conflictsFor(analysis), index ? [] : ['number']);
        strictEqual(analysis.calls.some(({ index = -1 } = {}) => analysis.checkCall({ index }).status === 'contradiction'), !index);

        if (index) strictEqual(runInNewContext(source), 'ok');

        if (!index) throws(() => runInNewContext(source), ({ name = '' } = {}) => name === 'TypeError');
    });
}));

test('primitive copy sources preserve prior writers while nullish rest retains abrupt completion', () => {
    ['false', '0', 'true', '42', 'null', 'void 0', '""'].forEach((input) => {
        const source = `const copy=value=>({...{name:42},...value});const {name=""}=copy(${input});name.trim();`;

        deepStrictEqual(conflictsFor(createAnalysis({ source })), ['number']);
        throws(() => runInNewContext(source), ({ name = '' } = {}) => name === 'TypeError');
    });
    [false, true].forEach((flag) => {
        const source = `const copy=(flag=false)=>({...{name:42},...(flag&&{name:"ok"})});const {name=""}=copy(${flag});name.trim();`;

        deepStrictEqual(conflictsFor(createAnalysis({ source })), flag ? [] : ['number']);
    });
    ['false', '0', 'null', '""'].forEach((input) => {
        const source = `const copy=()=>({...{name:42},...(external?${input}:{name:"ok"})});const {name=""}=copy();name.trim();`;

        deepStrictEqual(conflictsFor(createAnalysis({ source })), ['number']);
    });
    ['null', 'void 0'].forEach((input) => {
        const source = `const copy=value=>{const {...rest}=value;return rest;};copy(${input});(42).trim();`;

        deepStrictEqual(conflictsFor(createAnalysis({ source })), []);
        throws(() => runInNewContext(source), ({ name = '' } = {}) => name === 'TypeError');
    });
});

cases.forEach(({ name = '', invalid = '', valid = '', runtime = 1, rules = [] } = {}) => test(`product workflow: ${name}`, async () => {
    const results = await Promise.all([invalid, valid].map(async (source) => {
        const { status = -1, stderr = '' } = spawnSync(execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 5000 });
        const [{ messages = [] } = {}] = await engine.lintText(source, { filePath: 'tests/fixtures/product-workflow-case.js' });

        return { status, stderr, rules: [...new Set(messages.map(({ ruleId = '' } = {}) => ruleId))].toSorted() };
    }));
    const [failure = {}, success = {}] = results;
    const { status = -1, stderr = '', rules: findings = [] } = failure;
    const { status: completed = -1, rules: clean = [] } = success;

    strictEqual(status, runtime);

    if (runtime) match(stderr, /TypeError/u);

    strictEqual(completed, 0);
    deepStrictEqual(findings, rules.map(rule => `resilient/${rule}`).toSorted());
    deepStrictEqual(clean, []);
}));

test('returned array content preserves the selected callable obligation and a downstream guard discharges it', () => {
    ['[0]', '.at(0)'].forEach((selection) => {
        const prefix = `const pick=value=>[].concat([value])${selection};`;
        const source = `${prefix}const run=({cb}={})=>{if(cb)pick(cb)();};`;
        const safe = `${prefix}const consume=value=>{if(typeof value==="function")value();};const run=({cb}={})=>{if(cb)consume(pick(cb));};`;

        [source, safe].forEach((source, index) => {
            const analysis = createAnalysis({ source });
            const { declarations = [] } = analysis;
            const { index: declaration = -1 } = declarations.find(({ name = '' } = {}) => name === 'cb');

            strictEqual(analysis.checkDeclaration({ index: declaration }).required, index === 0);
        });
    });
});

test('external data remains unknown while an authored contradiction survives alongside it', async () => {
    const sources = [
        'const input = JSON.parse(\'{"name":42}\');\nconst normalize = ({ name = "" } = {}) => ({ ...{ name } });\n'
            + 'const { name = "" } = normalize(input);\nname.trim();\nexport {};\n',
        'const input = JSON.parse(\'{"name":42}\');\nconst normalize = ({ name = "" } = {}) => ({ ...{ name: typeof name === "string" ? name : "" } });\n'
            + 'const { name = "" } = normalize(input);\nname.trim();\nexport {};\n'
    ];

    const results = await Promise.all(sources.map(source => engine.lintText(source, { filePath: 'tests/fixtures/product-workflow-case.js' })));

    results.forEach(([{ messages = [] } = {}] = []) => deepStrictEqual(messages, []));
    const analysis = createAnalysis({ source: 'const normalize=value=>({...value});const {name=""}=normalize(external?{name:42}:other);name.trim();' });
    const { memberAccesses = [] } = analysis;
    const { index = -1 } = memberAccesses.find(({ name = '' } = {}) => name === 'trim');

    deepStrictEqual(analysis.checkMemberAccess({ index }).conflicts, ['number']);
});

[
    ['sparse iteration supplies undefined to the owned default', '[...[,42]].map((value="")=>value.trim());', ['number']],
    ['sole aggregate transfer retains element evidence', 'const source=[{name:42}];const copied=[...source];copied.map(({name=""}={})=>name.trim());', ['number']],
    ['a surviving source alias retires copied nested evidence',
        'const source=[{name:42}];const copied=[...source];source[0].name="ok";copied.map(({name=""}={})=>name.trim());', []],
    ['getters can mutate later callback inputs',
        'const source=[{get name(){source[1]={name:"ok"};return "ok";}},{name:42}];source.map(({name=""}={})=>name.trim());', []],
    ['authored methods retain their identity',
        'const source=[{name:42}];source.map=()=>[];source.map(({name=""}={})=>name.trim());', []],
    ['external records supply no field proof',
        'const run=(tracks=[])=>[...tracks].map(({name=""}={})=>name.trim());run(JSON.parse("[]"));', []],
    ['abrupt producers cannot supply later callback inputs',
        'const normalize=()=>{throw 1;return [...[{name:42}]];};normalize().map(({name=""}={})=>name.trim());', []]
].forEach(([name = '', source = '', expected = []] = []) => test(`normalization ownership and completion: ${name}`, () => {
    const analysis = createAnalysis({ source });
    const { memberAccesses = [] } = analysis;
    const query = () => memberAccesses.filter(({ name = '' } = {}) => name === 'trim')
        .flatMap(({ index = -1 } = {}) => analysis.checkMemberAccess({ index }).conflicts);

    deepStrictEqual(query(), expected);
    const { calls = [] } = analysis;

    calls.toReversed().forEach(({ index = -1 } = {}) => analysis.checkCall({ index }));
    deepStrictEqual(query(), expected);
}));

test('ESM normalization composes star exports, record rest, reductions, copies, callbacks and file revisions', async (context) => {
    const directory = mkdtempSync(join(tmpdir(), 'resilient-product-workflow-'));

    context.after(() => rmSync(directory, { recursive: true, force: true }));
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
    writeFileSync(join(directory, 'normalize.js'), 'export const normalize = (tracks = []) => tracks.reduce('
        + '(items, { name = "", ...track } = {}) => [...items, { ...track, name }], []);\n');
    writeFileSync(join(directory, 'barrel.js'), 'export * from "./normalize.js";\n');
    const filename = join(directory, 'main.js');
    const configured = new ESLint({ cwd: directory, overrideConfigFile: true,
        overrideConfig: [plugin.configs.recommended, plugin.configs.contracts, plugin.configs.safety] });
    const prefix = 'import { normalize } from "./barrel.js";\n'
        + 'const read = (items = []) => [...items].map(({ name = "" } = {}) => name.trim());\n';
    const inputs = ['[{ name: "ok", id: 1 }, { name: 42, id: 2 }]', '[{ name: "ok", id: 1 }, { name: "good", id: 2 }]',
        'JSON.parse(\'[{"name":"ok"},{"name":42}]\')'];

    await inputs.reduce(async (pending, input, index) => {
        await pending;
        const source = `${prefix}read(normalize(${input}));\n`;
        writeFileSync(filename, source);
        const { status = -1, stderr = '' } = spawnSync(execPath, [filename], { encoding: 'utf8', timeout: 5000 });
        const [{ messages = [] } = {}] = await configured.lintFiles([filename]);
        const rules = [...new Set(messages.map(({ ruleId = '' } = {}) => ruleId))].toSorted();

        strictEqual(status, index === 1 ? 0 : 1);

        if (index !== 1) match(stderr, /TypeError/u);

        deepStrictEqual(rules, index === 0 ? ['resilient/signature-contract-call-site', 'resilient/signature-contract-operation'] : []);
    }, Promise.resolve());
});
