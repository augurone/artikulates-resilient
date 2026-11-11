import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ESLint } from 'eslint';

import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const source = 'import { dispatch as read } from "barrel";read(42);';
const acquire = dependency => createAnalysis({ source, filename: 'main', resolveModule: ({ source: name = '' } = {}) => ({
    filename: name, source: name === 'barrel' ? 'export { consume as dispatch } from "worker";' : dependency
}) });

test('imported signatures own their contract while callers own supplied values', () => {
    const first = acquire('throw new Error("SOURCE MUST NOT EXECUTE");export const consume=(value="")=>value;');
    const second = acquire('export const consume=(value=0)=>value;');
    const before = first.checkCall({ index: 0 });
    const { status = '' } = before;

    strictEqual(status, 'contradiction');
    strictEqual(second.checkCall({ index: 0 }).status, 'agreement');
    strictEqual(first.checkCallResult({ index: 0, required: 'number' }).status, 'unknown');
    deepStrictEqual(first.checkCall({ index: 0 }), before);
    strictEqual(acquire('export let consume=(value="")=>value;consume=external;').checkCall({ index: 0 }).status, 'unknown');
    strictEqual(acquire('export function consume(value=""){return value;}eval("consume=external");').checkCall({ index: 0 }).status, 'unknown');
    strictEqual(acquire('const consume=(value="")=>value;export {consume as "other"};').checkCall({ index: 0 }).status, 'unknown');
    const failure = new Error('required module read failed');

    throws(() => createAnalysis({ source, resolveModule: () => { throw failure; } }), error => error === failure);
    throws(() => createAnalysis({ source, resolveModule: () => ({ filename: 'worker', source: false }) }), TypeError);
});

test('source-owned arity dispatch crosses a module boundary without caller facts entering its proof', () => {
    const dependency = 'export function consume(value,callback){switch(arguments.length){case 1:return value;case 2:return callback(value);}}';
    const first = acquire(dependency);
    const second = acquire(dependency.replace('case 1:return value', 'case 1:return callback'));

    strictEqual(first.checkCall({ index: 0 }).status, 'agreement');
    strictEqual(second.checkCall({ index: 0 }).status, 'contradiction');
    strictEqual(first.checkCall({ index: 0 }).status, 'agreement');
});

test('imported arity proof distinguishes nested arguments owners from dynamic captures', () => {
    const source = 'export const consume=function(value,callback){switch(arguments.length){case 1:return function(){return value(arguments[0]);};}};';
    const first = acquire(source);

    strictEqual(first.checkCall({ index: 0 }).status, 'agreement');
    strictEqual(acquire(source.replace('return value(arguments[0])', 'return callback(arguments[0])')).checkCall({ index: 0 }).status, 'contradiction');
    strictEqual(acquire(source.replace('return value(arguments[0])', 'return eval("callback")')).checkCall({ index: 0 }).status, 'contradiction');
    strictEqual(first.checkCall({ index: 0 }).status, 'agreement');
});

test('the product rule observes imported signature revisions and keeps diagnostics at the use', async (context) => {
    const directory = mkdtempSync(join(tmpdir(), 'resilient-call-signatures-'));

    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const worker = join(directory, 'worker.js');
    const barrel = join(directory, 'barrel.js');
    const main = join(directory, 'main.js');
    const source = 'import {dispatch as read} from "./barrel.js";read(42);';
    const engine = new ESLint({ cwd: directory, overrideConfigFile: true, overrideConfig: {
        plugins: { resilient: plugin }, rules: { 'resilient/signature-contract-call-site': 'error' }
    } });

    writeFileSync(barrel, 'export { consume as dispatch } from "./worker.js";');
    writeFileSync(worker, 'throw new Error("SOURCE MUST NOT EXECUTE");export const consume=(value="")=>value;');
    const [{ messages: first = [] } = {}] = await engine.lintText(source, { filePath: main });

    strictEqual(first.length, 1);
    const [{ messageId = '', column = 0, endColumn = 0 } = {}] = first;

    strictEqual(messageId, 'mismatch');
    strictEqual(source.slice(column - 1, endColumn - 1), '42');
    writeFileSync(worker, 'export const consume=(value=0)=>value;');
    const [{ messages: changed = [] } = {}] = await engine.lintText(source, { filePath: main });

    deepStrictEqual(changed, []);
});
