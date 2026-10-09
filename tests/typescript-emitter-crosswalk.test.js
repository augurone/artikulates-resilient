import assert from 'node:assert/strict';
import fs from 'node:fs';

import typescript from 'typescript';

import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

// Actual compiler comment calls from the public pipeline, indexed by their
// source call site. This proves invoked templates, not unvisited admission.
const catalog = JSON.parse(fs.readFileSync(new URL('../docs/engineering/transformer-source-emitters.json', import.meta.url), 'utf8'));
const { syntheticCommentCalls = [] } = catalog;
const missing = (...args) => { throw new Error(`Missing emitter proof capability: ${args.length}`); };
let observed = [];
const add = (method = '', args = []) => {
    const stack = new Error().stack || '';
    const [site = ''] = stack.split('\n').filter(line => line.includes('/transforms/typescript/'));
    const match = /\/transforms\/typescript\/([^:]+):(\d+):(\d+)/u.exec(site) || [];
    const [, suffix = '', line = '0'] = match;
    const file = `transforms/typescript/${suffix}`;
    const candidates = syntheticCommentCalls.filter(({ file: actualFile = '', line: actualLine = 0 } = {}) => actualFile === file && actualLine === Number(line));
    assert.equal(candidates.length, 1, `${method}: ${site}`);
    const [record = {}] = candidates;
    const [node = {}, kind = 0, text = '', trailing = false] = args;
    assert.ok(text.startsWith(' eslint-'), 'Only executable directive templates enter this observation.');
    assert.ok(text.includes(' -- ') || text.trim() === 'eslint-enable' || text.trim().startsWith('eslint-enable '));
    const result = Reflect.apply(Reflect.get(typescript, method), typescript, args);
    const comments = method === 'addSyntheticLeadingComment'
        ? typescript.getSyntheticLeadingComments(node) || [] : typescript.getSyntheticTrailingComments(node) || [];
    const attachedAtEmission = comments.some(({ text: actualText = '' } = {}) => actualText === text);
    observed = [...observed, { record, method, node, kind, text, trailing, attachedAtEmission }];

    return result;
};
const compiler = { ...typescript,
    addSyntheticLeadingComment: (...args) => add('addSyntheticLeadingComment', args),
    addSyntheticTrailingComment: (...args) => add('addSyntheticTrailingComment', args) };
const transform = ({ code = '', fileName = '' } = {}) => {
    const sourceFile = typescript.createSourceFile(fileName, code, typescript.ScriptTarget.ESNext, true);
    const options = { target: typescript.ScriptTarget.ESNext, skipLibCheck: true };
    const host = typescript.createCompilerHost(options);
    const getSourceFile = (name, version) => name === fileName ? sourceFile : host.getSourceFile(name, version);
    const program = typescript.createProgram([fileName], options, { ...host, getSourceFile });
    const { transform: execute = missing } = createTypeScriptTransformer({ typescript: compiler, program });

    return execute({ code, fileName });
};
const fixtures = [
    'export const read = (value: { field: number }) => value.field;',
    'export const read = (value: { field: number }) => value.field + effect() + value.field;',
    'export const forward = <A>(provider: { value: A }) => ({ value: provider.value });',
    'export const invoke = (provider: { run: (value: number) => number }, value: number) => provider.run(value);',
    'export function read([value]: [number]) { return value; }',
    'export function read([[a], [b]]: [[number], [number]]) { return [a, b]; }',
    'export function build(values: number[]) { const out: number[] = []; for (const value of values) out.push(value); return out; }',
    'export function read(values: number[]) { return values.length; }',
    'export function invoke(f: (...values: number[]) => number, ...values: number[]) { return f(values[1], values[0]); }',
    'export function read(value: { field: number } | undefined) { return value ? value.field : 0; }',
    'export function absent(value: number): number | undefined { return value > 0 ? value : undefined; }',
    'export function log(value: number) { console.log(value); }',
    'export class Model { constructor(public value: number) {} read() { return this.value; } }',
    'export class MutableModel { value: number; constructor(value: number) { this.value = value; } }',
    'export const reverseCopy = (values: number[]) => values.slice().reverse();'
];
fixtures.forEach((code = '', index = 0) => {
    const { length: before = 0 } = observed;
    const { code: output = '', diagnostics = [] } = transform({ code, fileName: `emitter-${index}.ts` });
    assert.deepEqual(diagnostics, []);
    const calls = observed.slice(before);
    calls.forEach(({ record = {}, kind = 0, trailing = false, method = '', attachedAtEmission = false } = {}) => {
        const { method: actualMethod = '' } = record;
        assert.equal(method, actualMethod);
        assert.equal(trailing, true);
        assert.ok([typescript.SyntaxKind.SingleLineCommentTrivia, typescript.SyntaxKind.MultiLineCommentTrivia].includes(kind));
        assert.equal(attachedAtEmission, true, 'The emitted text was attached to the exact node at its owning emission.');
        // Some intermediate comments are intentionally filtered/replaced during
        // later placement. Do not claim every intermediate comment survives.
        assert.ok(output || !calls.length);
    });
});
const observedSites = [...new Set(observed.map(({ record: { id = 0 } = {} } = {}) => id))].toSorted((a, b) => a - b);
assert.deepEqual(observedSites, [1, 5, 18, 31, 38, 39, 40, 55, 65, 66, 67, 68],
    'Exact public template sites, including the scoped mutation boundary, not a synthetic coverage percentage.');
observed.forEach(({ record = {}, text = '' } = {}) => {
    const { file = '', range: [start = 0, end = 0] = [] } = record;
    const url = new URL(`../${file}`, import.meta.url);
    const source = fs.readFileSync(url, 'utf8');
    const tree = typescript.createSourceFile(file, source, typescript.ScriptTarget.ESNext, true);
    let site;
    const find = (node = {}) => {
        const { getStart = false, end: nodeEnd = 0 } = node;

        if (typescript.isCallExpression(node) && typeof getStart === 'function' &&
            getStart.call(node, tree) === start && nodeEnd === end) site = node;

        typescript.forEachChild(node, find);
    };
    find(tree);
    assert.ok(site, `${file}:${start} must still be the parsed API call.`);
    const { arguments: [, , comment = {}] = [] } = site;

    if (typescript.isStringLiteral(comment) || typescript.isNoSubstitutionTemplateLiteral(comment)) {
        assert.equal(text, Reflect.get(comment, 'text'), 'A constant template must emit its exact authored rule/reason.');
    }

    const directive = /^\s*eslint-disable(?:-next-line|-line)?\s+([^\s]+(?:,\s*[^\s]+)*)\s+--\s+(.+)/u.exec(text);
    assert.ok(directive || text.trim().startsWith('eslint-enable'), `${file}: exact rule list and reason`);
});

// No source agreement means no blanket retained-boundary comment. Preserve
// exact ordinary syntax without claiming spelling alone proves a template.
const { code: rejected = '' } = transform({ code: 'export const read = (value: unknown) => value;', fileName: 'rejected-emitter.ts' });
assert.ok(!rejected.includes('eslint-disable'));
