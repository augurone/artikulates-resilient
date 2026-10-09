import assert from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';
import typescript from 'typescript';

import resilient from 'eslint-plugin-resilient';
import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

const source = [
    'type Reducer = { concat: (left: number, right: number) => number };',
    'export const fold = (make: (option: number) => Reducer, option: number) => {',
    '    const provider = make(option);',
    '    return (values: number[]) => values.reduce(provider.concat);',
    '};'
].join('\n');
const createProgram = () => {
    const fileName = 'private-state.ts';
    const options = { strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext };
    const sourceFile = typescript.createSourceFile(fileName, source, typescript.ScriptTarget.ESNext, true);
    const host = typescript.createCompilerHost(options);
    const program = typescript.createProgram([fileName], options, {
        ...host,
        getSourceFile: (name, version, ...rest) => name === fileName ? sourceFile : host.getSourceFile(name, version, ...rest)
    });

    // Bind the real Program before observing transform-owned changes.
    program.getTypeChecker();
    assert.deepEqual(program.getSemanticDiagnostics(), []);

    return { fileName, sourceFile, program };
};
const nodesIn = (root) => {
    let nodes = [];
    const visit = (node) => {
        nodes = [...nodes, node];
        typescript.forEachChild(node, visit);
    };

    visit(root);

    return nodes;
};
const descriptorsOf = nodes => nodes.map(node => Reflect.ownKeys(node).map((key) => {
    const { configurable = false, enumerable = false, writable = false, get: getter = false, set: setter = false } = Object.getOwnPropertyDescriptor(node, key);

    return { key, configurable, enumerable, writable, getter, setter };
}));
const syntaxOf = nodes => nodes.map(({ kind = 0, pos = 0, end = 0, parent = false } = {}) => ({ kind, pos, end, parent }));
const transform = ({ fileName = '', program = {} } = {}) => createTypeScriptTransformer({
    typescript, program,
    standard: { object: import.meta.resolve('eslint-plugin-resilient/standard/object') }
}).transform({ code: source, fileName });

test('public compiler reuse leaves caller-owned Program syntax and placement independent', () => {
    const original = createProgram();
    const { sourceFile = {} } = original;
    const nodes = nodesIn(sourceFile);
    const syntax = syntaxOf(nodes);
    const descriptors = descriptorsOf(nodes);
    const first = transform(original);
    const second = transform(original);
    const distinct = transform(createProgram());
    const { code = '', diagnostics = [] } = first;

    assert.deepEqual(diagnostics, []);
    [second, distinct].forEach(({ code: nextCode = '', diagnostics: nextDiagnostics = [] } = {}) => {
        assert.equal(nextCode, code);
        assert.deepEqual(nextDiagnostics, diagnostics);
    });
    assert.equal(sourceFile.getFullText(), source);
    const after = nodesIn(sourceFile);
    assert.equal(after.length, nodes.length);
    after.forEach((node, index) => assert.equal(node, Reflect.get(nodes, index)));
    assert.deepEqual(syntaxOf(after), syntax);
    assert.deepEqual(descriptorsOf(after), descriptors);
    assert.deepEqual(after.flatMap(node => Reflect.ownKeys(node).filter(key => String(key).startsWith('__resilient'))), []);
    const config = [resilient.configs.recommended, resilient.configs.contracts, resilient.configs.safety];
    const linter = new Linter();
    assert.deepEqual(linter.verify(code, config), []);
    const { messages = [] } = linter.verifyAndFix(code, config);
    assert.deepEqual(messages, []);
});
