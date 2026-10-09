import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { Linter } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const rule = 'resilient/no-unguarded-callback-invocation';
const config = { plugins: { resilient: plugin }, rules: { [rule]: 'error' } };
const statuses = analysis => analysis.invocations.filter(({ optionalCallback = false } = {}) => optionalCallback)
    .map(({ index = -1 } = {}) => analysis.checkInvocation({ index }).status);
const directoryFor = (context) => {
    const directory = mkdtempSync(join(tmpdir(), 'resilient-predicates-'));

    context.after(() => rmSync(directory, { recursive: true, force: true }));

    return directory;
};

[
    ['function*(value){return typeof value==="function";}', 'contradiction'],
    ['async function*(value){return typeof value==="function";}', 'contradiction'],
    ['async value=>typeof value==="function"', 'contradiction'],
    ['value=>true', 'contradiction'],
    ['42', 'contradiction'],
    ['value=>external(value)', 'unknown'],
    ['value=>typeof value==="function"', 'agreement'],
    ['value=>value&&typeof value==="function"', 'agreement']
].forEach(([helper = '', expected = ''] = [], position) => test(`resolved guard: ${helper}`, (context) => {
    const style = ['named', 'default', 'reexport'].at(position % 3);
    const directory = directoryFor(context);
    const filename = join(directory, 'main.js');
    const dependencyFile = join(directory, 'guard.js');
    const implementationFile = join(directory, 'implementation.js');
    const dependency = style === 'default' ? `export default ${helper};` : `export const isFunction=${helper};`;
    const imported = style === 'default' ? 'isFunction' : '{isFunction}';
    const entry = style === 'reexport' ? 'export {isFunction} from "./implementation.js";' : dependency;

    writeFileSync(dependencyFile, entry);
    writeFileSync(implementationFile, dependency);
    const engine = new Linter({ cwd: directory });

    const source = `import ${imported} from "./guard.js";const run=({done}={})=>isFunction(done)&&done();`;
    const options = { source, filename, resolveModule: ({ source: specifier = '' } = {}) => ({
        filename: join(directory, specifier), source: specifier === './implementation.js' ? dependency : entry
    }) };
    const analysis = createAnalysis(options);

    deepStrictEqual(statuses(analysis), [expected]);
    const findings = engine.verify(source, config, { filename });

    strictEqual(findings.length, Number(expected === 'contradiction'));
    deepStrictEqual(findings.map(({ column = 0, endColumn = 0 } = {}) => source.slice(column - 1, endColumn - 1)), expected === 'contradiction' ? ['done()'] : []);
}));

['function*', 'async function*'].forEach(kind => test(`${kind} guard has a runtime counterexample`, () => {
    const source = `const isFunction=${kind}(value){return typeof value==="function";};const run=({done}={})=>{if(isFunction(done))done();};`;

    throws(() => runInNewContext(`${source}run();`), { name: 'TypeError' });
    deepStrictEqual(statuses(createAnalysis({ source })), ['contradiction']);
}));

test('unresolved imported and unbound guard syntax retains its local admission', () => {
    ['import {isFunction} from "unavailable";', ''].forEach((prefix) => {
        const source = `${prefix}const run=({done}={})=>{if(isFunction(done))done();};`;

        deepStrictEqual(statuses(createAnalysis({ source, filename: 'main.js', resolveModule: () => ({ available: false }) })), ['agreement']);
        strictEqual(new Linter().verify(source, config).length, 0);
    });
});

test('imported predicate revisions refresh a reused host AST without rewriting source', (context) => {
    const directory = directoryFor(context);
    const filename = join(directory, 'main.js');
    const dependencyFile = join(directory, 'guard.js');
    const source = 'import {isFunction} from "./guard.js";const run=({done}={})=>isFunction(done)&&done();';
    const generator = 'export function* isFunction(value){return typeof value==="function";}';
    const predicate = 'export const isFunction=value=>typeof value==="function";';
    const engine = new Linter({ cwd: directory });

    writeFileSync(dependencyFile, generator);
    const original = engine.verify(source, config, { filename });
    const host = engine.getSourceCode();
    const retained = createAnalysis({ source, filename, resolveModule: () => ({ filename: dependencyFile, source: generator }) });

    strictEqual(original.length, 1);
    writeFileSync(dependencyFile, predicate);
    deepStrictEqual(engine.verify(host, config, { filename }), []);
    deepStrictEqual(statuses(retained), ['contradiction']);
    writeFileSync(dependencyFile, generator);
    deepStrictEqual(engine.verify(host, config, { filename }), original);
    const { output = '', fixed = true, messages = [] } = engine.verifyAndFix(source, config, { filename });

    strictEqual(output, source);
    strictEqual(fixed, false);
    deepStrictEqual(messages, original);
});

test('predicate module resolver failures remain operational failures', () => {
    const error = new Error('resolver failure');

    throws(() => createAnalysis({ source: 'import {isFunction} from "guards";', filename: 'main.js', resolveModule: () => { throw error; } }), caught => caught === error);
});

[
    ['done=first;(done=second,0);', 'unknown'],
    ['(done=first,0);done=second;', 'unknown'],
    ['done=first;done+=second;', 'unknown'],
    ['done+=first;done=second;', 'unknown'],
    ['done=first;done=second;', 'agreement']
].forEach(([writes = '', expected = ''] = []) => test(`mixed mutation eligibility: ${writes}`, () => {
    const source = `const run=({done}={})=>{${writes}if(typeof done==="function")done();};`;

    deepStrictEqual(statuses(createAnalysis({ source })), [expected]);
}));
