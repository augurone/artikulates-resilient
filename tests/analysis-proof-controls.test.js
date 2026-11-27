import { match, ok, strictEqual } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse } from 'espree';

import { getSourceNodes } from '../analysis/host/ast-traversal.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const faults = JSON.parse(readFileSync(new URL('./fixtures/analysis-proof-faults.json', import.meta.url), 'utf8'));
const { execPath = '', env = {} } = process;
const environment = Object.fromEntries(Object.entries(env).filter(([name = ''] = []) => name !== 'NODE_TEST_CONTEXT'));

const mutateSyntax = (source, { kind = '', target = '', replacement = '' } = {}) => {
    if (!['initializer', 'marked-call'].includes(kind)) throw new TypeError(`Unsupported mutation kind: ${kind}`);

    const nodes = getSourceNodes(parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true }));
    const marked = ({ type = '', arguments: args = [] } = {}) => type === 'CallExpression' && args.some(({ type = '', properties = [] } = {}) => (
        type === 'ObjectExpression' && properties.some(({ key: { name = '' } = {}, value: { value = '' } = {} } = {}) => name === 'point' && value === target)
    ));
    const matches = nodes.filter((node = {}) => {
        const { type = '', id = false } = node;

        if (kind !== 'initializer') return marked(node);

        if (type !== 'VariableDeclarator' || !id) return false;

        const { name = '' } = id;

        return name === target;
    });

    strictEqual(matches.length, 1, `Expected one ${kind} fault site for ${target}`);
    const [{ init = {}, ...call } = {}] = matches;
    const { range: [start = -1, end = -1] = [] } = kind === 'initializer' ? init : call;

    ok(start >= 0 && end > start && replacement);

    return source.slice(0, start) + replacement + source.slice(end);
};

// A valid isolated baseline must pass before an intentional semantic fault can
// count as detected. Syntax/import crashes do not establish test sensitivity.
faults.forEach(({ name = '', file = '', edits = [], mutation = false, test: suite = '', pattern = '' } = {}) => test(`analysis proof rejects ${name}`, (context) => {
    const directory = mkdtempSync(join(tmpdir(), 'resilient-proof-control-'));

    context.after(() => rmSync(directory, { recursive: true, force: true }));
    cpSync(join(root, 'package.json'), join(directory, 'package.json'));
    cpSync(join(root, 'analysis'), join(directory, 'analysis'), { recursive: true });
    cpSync(join(root, 'index.js'), join(directory, 'index.js'));
    cpSync(join(root, 'integrations'), join(directory, 'integrations'), { recursive: true });
    symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
    mkdirSync(join(directory, 'tests/fixtures'), { recursive: true });
    cpSync(join(root, 'tests/support'), join(directory, 'tests/support'), { recursive: true });
    // Composed owners can register several fixture-backed checks. Supply their
    // data without copying corpora; the name pattern still selects one property.
    readdirSync(join(root, 'tests/fixtures')).filter(file => file.endsWith('.json'))
        .forEach(file => cpSync(join(root, 'tests/fixtures', file), join(directory, 'tests/fixtures', file)));
    cpSync(join(root, 'tests', suite), join(directory, 'tests', suite));
    const run = () => spawnSync(execPath, ['--test', '--test-reporter=tap', '--test-name-pattern', pattern, join('tests', suite)], {
        cwd: directory, env: environment, encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024
    });
    const { status = -1, stdout = '', stderr = '' } = run();

    strictEqual(status, 0, stdout + stderr);
    match(stdout, /# pass [1-9]\d*/u);
    const path = join(directory, file);
    const original = readFileSync(path, 'utf8');
    const changed = mutation ? mutateSyntax(original, mutation) : edits.reduce((source, [before = '', after = ''] = []) => {
        strictEqual(source.split(before).length, 2, `Expected one fault site: ${file}`);

        return source.replace(before, after);
    }, original);

    ok(changed !== original);
    writeFileSync(path, changed);
    const { status: failed = -1, signal = '', stdout: output = '', stderr: errors = '' } = run();

    strictEqual(failed, 1, output + errors);
    ok(!signal, `Fault check was interrupted: ${signal}`);
    match(output + errors, /ERR_ASSERTION/u);
}));
