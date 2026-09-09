import assert from 'node:assert/strict';
import path from 'node:path';

import resilient from 'eslint-plugin-resilient';
import { isFunction } from 'eslint-plugin-resilient/standard/function';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { createIdentityIndex } from '../rules/contracts/identity-index.js';
import { clearProgramCache, getParserOptionsKey } from '../rules/contracts/program-cache.js';
import { captureProgram } from '../rules/support/eslint-program.js';
import { getFileCandidates } from '../rules/support/file-candidates.js';

const allocate = createIdentityIndex();
const otherDomain = createIdentityIndex();
const first = Object.freeze({ name: 'first' });
const second = Object.freeze({ name: 'second' });
const callback = () => first;

assert.equal(allocate(first), 1);
assert.equal(allocate(second), 2);
assert.equal(allocate(first), 1);
assert.equal(allocate(callback), 3);
assert.equal(allocate(callback), 3);
assert.equal(otherDomain(callback), 1);
assert.equal(otherDomain(first), 2);
const failureDomain = createIdentityIndex();
assert.throws(() => failureDomain('not a weak key'), { name: 'TypeError' });
assert.equal(failureDomain(first), 2);

const parserKey = getParserOptionsKey({ context: { languageOptions: { parser: callback } } });
clearProgramCache();
assert.equal(getParserOptionsKey({ context: { languageOptions: { parser: callback } } }), parserKey);
assert.notEqual(getParserOptionsKey({ context: { languageOptions: { parser: () => second } } }), parserKey);

const base = path.join('workspace', 'module');
assert.deepEqual(getFileCandidates({ base }), [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js')]);
assert.deepEqual(getFileCandidates({ base, extensions: ['.mjs', '.js', '.mjs'] }),
    [base, `${base}.mjs`, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js')]);
assert.deepEqual(getFileCandidates({ base, extensions: [] }), [base, path.join(base, 'index.js')]);
assert.deepEqual(getFileCandidates({ base: '' }), ['', '.js', '.jsx', 'index.js']);

const [left = {}, right = {}] = await Promise.all([
    captureProgram('export const left = 1;', { fileName: 'left.js' }),
    captureProgram('export const right = 2;', { fileName: 'right.js', languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } })
]);
assert.equal(left.type, 'Program');
assert.equal(right.type, 'Program');
assert.notEqual(left, right);
assert.equal(left.body[0].declaration.declarations[0].id.name, 'left');
assert.equal(right.body[0].declaration.declarations[0].id.name, 'right');
assert.deepEqual(left.body[0].declaration.declarations[0].id.range, [13, 17]);
const repeated = await captureProgram('export const left = 1;', { fileName: 'left.js' });
assert.notEqual(repeated, left);
assert.deepEqual(repeated, left);
assert.deepEqual(await captureProgram('const =', { fileName: 'invalid.js' }), {});
// eslint-disable-next-line resilient/signature-contract-call-site -- Deliberately omit the required source argument to prove native ESLint rejection rather than a fabricated empty document.
await assert.rejects(captureProgram(), /code.*string/u);
assert.deepEqual(await captureProgram('export const ignored = 1;', { fileName: 'ignored.ts' }), {});
const { sourceType: scriptSourceType = '', body: [{ kind: scriptKind = '' } = {}] = [] } = await captureProgram(
    'var value = 1;', { fileName: 'legacy.js', languageOptions: { ecmaVersion: 5, sourceType: 'script' } }
);
assert.equal(scriptSourceType, 'script');
assert.equal(scriptKind, 'var');
assert.deepEqual(await captureProgram('export const rejected = 1;', { fileName: 'legacy.js', languageOptions: { ecmaVersion: 5, sourceType: 'script' } }), {});

const { href: rootUrl = '' } = new URL('../index.js', import.meta.url);
const { href: transformerUrl = '' } = new URL('../transforms/typescript/index.js', import.meta.url);
const { href: functionUrl = '' } = new URL('../rules/support/function.js', import.meta.url);
assert.equal(import.meta.resolve('eslint-plugin-resilient'), rootUrl);
assert.equal(import.meta.resolve('eslint-plugin-resilient/typescript'), transformerUrl);
assert.equal(import.meta.resolve('eslint-plugin-resilient/standard/function'), functionUrl);
const { default: directResilient = {} } = await import(rootUrl);
const { createTypeScriptTransformer: directTransformer = false } = await import(transformerUrl);
const { isFunction: directIsFunction = false } = await import(functionUrl);
assert.equal(resilient, directResilient);
assert.equal(createTypeScriptTransformer, directTransformer);
assert.equal(isFunction, directIsFunction);
