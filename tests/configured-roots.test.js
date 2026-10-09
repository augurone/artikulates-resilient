import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { ESLint } from 'eslint';

import resilient from 'eslint-plugin-resilient';
import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import plugin from 'eslint-plugin-resilient/eslint';

const rule = 'resilient/signature-contract-operation';
const source = 'export const read=value=>value.toUpperCase();';
const projectFor = (context) => {
    const directory = mkdtempSync(join(tmpdir(), 'resilient-configured-roots-'));

    context.after(() => rmSync(directory, { recursive: true, force: true }));
    writeFileSync(join(directory, 'entry.js'), source);
    writeFileSync(join(directory, 'consumer.js'), 'import {read} from "./entry.js";read([]);[].toUpperCase();');
    writeFileSync(join(directory, 'inactive.js'), 'throw new Error("SOURCE MUST NOT EXECUTE");import {read} from "./entry.js";read(42);');

    return directory;
};
const engineFor = (directory, settings = {}, imports = {}) => new ESLint({ cwd: directory, overrideConfigFile: true, overrideConfig: [
    resilient.imports({ cwd: directory, ...imports }),
    { plugins: { resilient: plugin }, rules: { [rule]: 'error' }, settings: { resilient: settings } }
] });
const findings = async (engine, filename) => {
    const [{ messages = [] } = {}] = await engine.lintFiles([filename]);

    return messages;
};

test('configured root consumers contribute evidence while findings stay in the linted file', async (context) => {
    const directory = projectFor(context);
    const entry = join(directory, 'entry.js');

    deepStrictEqual(await findings(engineFor(directory), entry), []);
    const engine = engineFor(directory, { roots: ['consumer.js', 'consumer.js'] });
    const messages = await findings(engine, entry);

    strictEqual(messages.length, 1);
    const [{ ruleId = '', message = '', column = 0, endColumn = 0 } = {}] = messages;

    strictEqual(ruleId, rule);
    strictEqual(message.includes('array-like'), true);
    strictEqual(message.includes('number-like'), false);
    strictEqual(source.slice(column - 1, endColumn - 1), 'value.toUpperCase');
    writeFileSync(join(directory, 'consumer.js'), 'import {read} from "./entry.js";read("valid");');
    deepStrictEqual(await findings(engine, entry), []);
    writeFileSync(join(directory, 'entry.js'), 'export const read=value=>value.map(item=>item);');
    strictEqual((await findings(engine, entry)).length, 1);
    deepStrictEqual(await findings(engineFor(directory, { roots: [] }), entry), []);
});

test('adapter ancestor and inferred roots select only entry files and their static closure', async (context) => {
    const directory = projectFor(context);
    const nested = join(directory, 'nested');

    mkdirSync(nested);
    writeFileSync(join(nested, 'index.js'), source);
    writeFileSync(join(directory, 'scope.js'), 'import {read} from "./nested/index.js";read([]);');
    writeFileSync(join(nested, 'inferred.js'), 'import "./consumer.js";');
    writeFileSync(join(nested, 'consumer.js'), 'import {read} from "./index.js";read("valid");');
    const engine = engineFor(directory, {}, { ancestorFiles: ['scope'], inferredFiles: ['inferred'] });
    const messages = await findings(engine, join(nested, 'index.js'));

    strictEqual(messages.length, 1);
    strictEqual(messages[0].message.includes('array-like'), true);
    deepStrictEqual(await findings(engine, join(directory, 'entry.js')), []);
    writeFileSync(join(directory, 'scope.js'), 'import {read} from "./nested/index.js";read("valid");');
    deepStrictEqual(await findings(engine, join(nested, 'index.js')), []);
});

test('root callbacks refresh selection and propagate operational failures', async (context) => {
    const directory = projectFor(context);
    const entry = join(directory, 'entry.js');
    const selection = join(directory, 'selection.json');

    writeFileSync(selection, '["consumer.js"]');
    const engine = engineFor(directory, { roots: ({ fileName = '' } = {}) => fileName === entry ? JSON.parse(readFileSync(selection, 'utf8')) : [] });

    strictEqual((await findings(engine, entry)).length, 1);
    writeFileSync(selection, '[]');
    deepStrictEqual(await findings(engine, entry), []);
    const failure = new Error('root selection failed');

    await rejects(findings(engineFor(directory, { roots: () => { throw failure; } }), entry), error => error === failure);
    await rejects(findings(engineFor(directory, { roots: () => 'consumer.js' }), entry), TypeError);
    writeFileSync(join(directory, 'consumer.js'), 'export const = ;');
    await rejects(findings(engineFor(directory, { roots: ['consumer.js'] }), entry), SyntaxError);
});

test('root inventories retain ordered filename identities through shared static cycles', (context) => {
    const directory = projectFor(context);
    const entry = join(directory, 'entry.js');
    const consumer = join(directory, 'consumer.js');
    const second = join(directory, 'second.js');
    const barrel = join(directory, 'barrel.js');

    writeFileSync(consumer, 'import {read} from "./barrel.js";read([]);');
    writeFileSync(barrel, 'export {read} from "./entry.js";import "./consumer.js";');
    writeFileSync(second, 'import {read} from "./barrel.js";read("valid");');
    const snapshot = filename => ({ filename, source: readFileSync(filename, 'utf8') });
    const analysis = createAnalysis({ source, filename: entry, roots: [snapshot(consumer), snapshot(second), snapshot(consumer)],
        resolveModule: ({ from = '', source = '' } = {}) => snapshot(resolve(dirname(from), source)) });
    const { files = [], counts: { modules = 0 } = {}, memberAccesses = [] } = analysis;

    deepStrictEqual(files, [entry, consumer, barrel, second]);
    strictEqual(Object.isFrozen(files), true);
    strictEqual(modules, 4);
    const [{ index = -1 } = {}] = memberAccesses;

    deepStrictEqual(analysis.checkMemberAccess({ index }).conflicts, ['array']);
    writeFileSync(consumer, 'import {read} from "./barrel.js";read("valid");');
    deepStrictEqual(analysis.checkMemberAccess({ index }).conflicts, ['array']);
});
