import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const rule = 'resilient/signature-contract-call-site';
const config = { plugins: { resilient: plugin }, rules: { [rule]: 'error' } };
const lint = source => new Linter().verify(source, config);
const spans = (source, findings) => findings.map(({ column = 0, endColumn = 0 } = {}) => source.slice(column - 1, endColumn - 1));
const conflictsFor = (analysis, name) => {
    const calls = analysis.calls.filter(({ callee = '' } = {}) => callee === name);

    strictEqual(calls.length, 1);

    return analysis.checkCall({ index: calls.at(0).index }).obligations.filter(({ status = '' } = {}) => status === 'contradiction');
};
const directoryFor = (context) => {
    const directory = mkdtempSync(join(tmpdir(), 'resilient-call-diagnostics-'));

    context.after(() => rmSync(directory, { recursive: true, force: true }));

    return directory;
};

[
    ['map', 'flag?42:""'], ['map', 'flag?42:external'], ['map', 'flag?42:void 0'], ['map', 'flag?42:other?"":external'],
    ['filter', 'flag?42:external'], ['find', 'flag?42:external'], ['some', 'flag?42:external'], ['forEach', 'flag?42:external']
].forEach(([method = '', value = ''] = []) => test(`callback reporting preserves known conflict beside other evidence: ${method} ${value}`, () => {
    const call = `[${value},42].${method}(read)`;
    const source = `const read=(value="")=>value;${call};`;
    const findings = lint(source);

    strictEqual(findings.length, 1);
    strictEqual(findings.at(0).message, `${method}.callback expects string-like, but this call supplies number-like.`);
    deepStrictEqual(spans(source, findings), [call]);
    const conflicts = conflictsFor(createAnalysis({ source }), method);

    ok(conflicts.length >= 2, 'Reporting must not delete analyzer contributions');
}));

[
    ['const read=(value="")=>value;const apply=value=>read(value);const relay=flag=>{apply(flag?42:"");apply(42);};relay(flag);',
        ['apply(flag?42:"")', 'apply(42)', 'relay(flag)']],
    ['const read=(value="")=>value;const apply=value=>read(value);const relay=value=>{apply(value);apply(42);};relay(flag?42:"");',
        ['apply(42)', 'relay(flag?42:"")']],
    ['const read=(value="")=>value;const relay=value=>[value,42].map(read);relay(flag?42:"");', ['[value,42].map(read)']],
    ['const read=(value="")=>value;const relay=value=>[value,42].map(read);relay(flag?42:external);', ['[value,42].map(read)']],
    ['const read=(value="")=>value;const relay=value=>{read(value);read(value);};relay(42);', ['relay(42)', 'relay(42)']],
    ['const read=(value="")=>value;const relay=value=>read(value);relay(42);relay(42);', ['relay(42)', 'relay(42)']],
    ['const read=()=>0;const relay=value=>{read(value);read(value);};relay(42);', ['read(value)', 'read(value)']]
].forEach(([source = '', expected = []] = []) => test(`report identity preserves origin and caller boundaries: ${source}`, () => {
    deepStrictEqual(spans(source, lint(source)), expected);
}));

[
    ['const read=(value="")=>value;[42,false].map(read);', ['number-like', 'boolean-like']],
    ['const read=flag?((value="")=>value):((value=false)=>value);[42,42].map(read);', ['number-like', 'number-like']]
].forEach(([source = '', actual = []] = []) => test(`different messages or requirements cannot merge: ${source}`, () => {
    const findings = lint(source);

    strictEqual(findings.length, 2);
    deepStrictEqual(findings.map(({ message = '' } = {}) => message.split('supplies ').at(-1)), actual.map(value => `${value}.`));
    strictEqual(new Set(findings.map(({ message = '' } = {}) => message)).size, 2);
}));

test('distinct parameter paths survive repeated native callback contributions', () => {
    const source = 'const read=(state="",value="")=>state;[42,42].reduce(read,42);';
    const findings = lint(source);

    strictEqual(findings.length, 2);
    deepStrictEqual(findings.map(({ message = '' } = {}) => message), [
        'reduce.callback expects string-like, but this call supplies number-like.',
        'reduce.callback.argument[1] expects string-like, but this call supplies number-like.'
    ]);
});

test('multiline callback duplicates have one exact report and no source rewrite', () => {
    const source = 'const read=(value="")=>value;\n[\n flag?42:"",\n 42\n].map(read);';
    const findings = lint(source);

    strictEqual(findings.length, 1);
    const [{ line = 0, column = 0, endLine = 0, endColumn = 0 } = {}] = findings;

    deepStrictEqual([line, column, endLine, endColumn], [2, 1, 5, 12]);
    const { output = '', fixed = true } = new Linter().verifyAndFix(source, config);

    strictEqual(output, source);
    strictEqual(fixed, false);
});

test('unrelated module origins with equal ranges cannot suppress one another', (context) => {
    const directory = directoryFor(context);
    const filename = join(directory, 'main.js');
    const dependencyFile = join(directory, 'dep.js');
    const source = 'import{relay}from"./dep.js";const read=(x="")=>x;read(42);relay(42);';
    const dependency = '     const read=(x="")=>x;export const relay=xx=>read(xx);';

    strictEqual(source.indexOf('42'), dependency.lastIndexOf('xx'));
    writeFileSync(dependencyFile, dependency);
    const engine = new Linter({ cwd: directory });
    const findings = engine.verify(source, config, { filename });

    deepStrictEqual(spans(source, findings), ['42', 'relay(42)']);
    const analysis = createAnalysis({ source, filename, resolveModule: () => ({ filename: dependencyFile, source: dependency }) });
    const [{ origin = {} } = {}] = conflictsFor(analysis, 'relay');
    const { range = [], filename: from = '' } = origin;

    strictEqual(from, dependencyFile);
    strictEqual(dependency.slice(...range), 'xx');
    ok(Object.isFrozen(origin));
    ok(Object.isFrozen(range));

    // Reuse the host AST while the imported source changes, then restore it.
    const host = engine.getSourceCode();

    writeFileSync(dependencyFile, dependency.replace('(x="")', '(x=0)'));
    deepStrictEqual(spans(source, engine.verify(host, config, { filename })), ['42']);
    writeFileSync(dependencyFile, dependency);
    deepStrictEqual(engine.verify(host, config, { filename }), findings);
    strictEqual(conflictsFor(analysis, 'relay').at(0).origin.filename, dependencyFile);
});

test('direct versus forwarded calls use acquired identity rather than equal start offsets', (context) => {
    const directory = directoryFor(context);
    const filename = join(directory, 'main.js');
    const dependencyFile = join(directory, 'dep.js');
    const dependency = 'const read=(x="")=>x;export const relay=xx=>read(xx);';
    const body = 'import{relay}from"./dep.js";relay(42);';
    const source = ' '.repeat(dependency.lastIndexOf('read(') - body.lastIndexOf('relay(')) + body;

    strictEqual(source.lastIndexOf('relay('), dependency.lastIndexOf('read('));
    writeFileSync(dependencyFile, dependency);
    const analysis = createAnalysis({ source, filename, resolveModule: () => ({ filename: dependencyFile, source: dependency }) });
    const [{ location: { range = [] } = {}, origin: { range: from = [], filename: origin = '' } = {} } = {}] = conflictsFor(analysis, 'relay');

    strictEqual(source.slice(...range), 'relay(42)');
    strictEqual(dependency.slice(...from), 'xx');
    strictEqual(origin, dependencyFile);
    deepStrictEqual(spans(source, new Linter({ cwd: directory }).verify(source, config, { filename })), ['relay(42)']);
});

test('distinct imported sources retain separate same-range obligations at one caller', (context) => {
    const directory = directoryFor(context);
    const filename = join(directory, 'main.js');
    const source = 'import{emit as a}from"./a.js";import{emit as b}from"./b.js";const relay=value=>{a(value);b(value);};relay(42);';
    const dependency = 'const read=(x="")=>x;export const emit=value=>read(value);';

    ['a.js', 'b.js'].forEach(name => writeFileSync(join(directory, name), dependency));
    const analysis = createAnalysis({ source, filename, resolveModule: ({ source = '' } = {}) => ({ filename: join(directory, source), source: dependency }) });
    const conflicts = conflictsFor(analysis, 'relay');

    strictEqual(conflicts.length, 2);
    strictEqual(new Set(conflicts.map(({ origin: { filename = '' } = {} } = {}) => filename)).size, 2);
    deepStrictEqual(spans(source, new Linter({ cwd: directory }).verify(source, config, { filename })), ['relay(42)', 'relay(42)']);
});

test('equal imported arity origins retain both source owners', (context) => {
    const directory = directoryFor(context);
    const filename = join(directory, 'main.js');
    const source = 'import{emit as a}from"./a.js";import{emit as b}from"./b.js";const relay=()=>{a();b();};relay();';
    const dependency = 'const read=value=>value;export const emit=()=>read();';

    ['a.js', 'b.js'].forEach(name => writeFileSync(join(directory, name), dependency));
    const findings = new Linter({ cwd: directory }).verify(source, config, { filename });

    deepStrictEqual(findings.map(({ messageId = '' } = {}) => messageId), ['arity', 'arity', 'arity', 'arity']);
    deepStrictEqual(spans(source, findings), ['a()', 'b()', 'relay()', 'relay()']);
});
