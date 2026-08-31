import assert from 'node:assert/strict';

import { ESLint } from 'eslint';
import {
    createContractDocument,
    createProjectTree,
    getModuleEdges,
    getMismatches,
    isCompatible,
    contract
} from 'eslint-plugin-resilient/contracts';

const getProgram = async (code = '', fileName = 'fixture.js') => {
    let program = {};
    const capture = {
        rules: {
            program: {
                create: () => ({
                    Program: (node) => {
                        program = node;
                    }
                })
            }
        }
    };
    const eslint = new ESLint({
        overrideConfigFile: true,
        overrideConfig: [{
            languageOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module'
            },
            plugins: { capture },
            rules: { 'capture/program': 'error' }
        }]
    });
    await eslint.lintText(code, { filePath: fileName });
    return program;
};

const residualDefinitionMissing = ({
    definitions: {
        render: {
            signature: {
                contract: { residual = {} } = {}
            } = {}
        } = {}
    } = {}
} = {}) => {
    return !Object.hasOwn(residual.properties, 'unknownKey');
};

const residualCode = [
    'const render = ({ bgAttrs = "", bgStyleStr = "", inlineStyle = {}, ...style } = {}) => style;',
    'const inspect = () => render({ color: 42 }).color.toUpperCase();'
].join('\n');
const residualProgram = await getProgram(residualCode);
const residualDocument = createContractDocument(residualProgram, { fileName: 'residual.js' });
const { definitions: residualDefinitions = {} } = residualDocument;
const { render: renderDefinition = {} } = residualDefinitions;
assert.equal(renderDefinition.signature.contract.residual.open, true);
assert.deepEqual(renderDefinition.signature.contract.residual.excluded, [
    'bgAttrs',
    'bgStyleStr',
    'inlineStyle'
]);
assert.equal(residualDefinitionMissing(residualDocument), true);
assert.equal(residualDocument.getDiagnostics().length, 1);
assert.equal(residualDocument.getDiagnostics()[0].data.actual, 'number-like');
assert.equal(renderDefinition.signature.bindings.style.residual.open, true);

const flowResidualCode = [
    'const inspect = () => {',
    '    const source = { color: 42, known: true };',
    '    const { known, ...style } = source;',
    '    return style.color.toUpperCase();',
    '};'
].join('\n');
const flowResidualDocument = createContractDocument(
    await getProgram(flowResidualCode),
    { fileName: 'flow-residual.js' }
);
assert.equal(flowResidualDocument.getDiagnostics().length, 1);
assert.equal(flowResidualDocument.getDiagnostics()[0].data.actual, 'number-like');

const expectedResidual = contract({
    kind: 'object',
    properties: { title: contract({ kind: 'string' }) }
});
const actualResidual = contract({
    kind: 'object',
    residual: {
        kind: 'object',
        state: 'unknown',
        open: true,
        excluded: [],
        properties: { title: contract({ kind: 'number' }) }
    }
});
assert.equal(isCompatible({ expected: expectedResidual, actual: actualResidual }), false);
assert.equal(getMismatches({ expected: expectedResidual, actual: actualResidual }).length, 1);

const spreadCode = 'const build = () => ({ ...{ value: "" }, value: 42 }); build().value.toUpperCase();';
const spreadProgram = await getProgram(spreadCode);
const spreadDocument = createContractDocument(spreadProgram, { fileName: 'spread.js' });
assert.equal(spreadDocument.getDiagnostics().length, 1);
assert.equal(spreadDocument.getDiagnostics()[0].data.actual, 'number-like');

const lexicalCode = [
    'const make = (renderProps = {}) => {',
    '    const lexicalName = "renderProps";',
    '    return { args: [], [lexicalName]: renderProps };',
    '};',
    'make().renderProps.toUpperCase();'
].join('\n');
const lexicalProgram = await getProgram(lexicalCode);
const lexicalDocument = createContractDocument(lexicalProgram, { fileName: 'lexical.js' });
assert.equal(lexicalDocument.getDiagnostics().length, 1);
assert.equal(lexicalDocument.getDiagnostics()[0].data.actual, 'object-like');

const computedAccessCode = 'const key = "title"; const value = { [key]: 42 }; value[key].toUpperCase();';
const computedAccessDocument = createContractDocument(
    await getProgram(computedAccessCode),
    { fileName: 'computed-access.js' }
);
assert.equal(computedAccessDocument.getDiagnostics().length, 1);
assert.equal(computedAccessDocument.getDiagnostics()[0].data.actual, 'number-like');

const numericComputedAccessCode = 'const value = { [0]: 42 }; value[0].toUpperCase();';
const numericComputedAccessDocument = createContractDocument(
    await getProgram(numericComputedAccessCode),
    { fileName: 'numeric-computed-access.js' }
);
assert.equal(numericComputedAccessDocument.getDiagnostics().length, 1);
assert.equal(numericComputedAccessDocument.getDiagnostics()[0].data.actual, 'number-like');

const boundNumericComputedAccessCode = 'const key = 0; const value = { [key]: 42 }; value[key].toUpperCase();';
const boundNumericComputedAccessDocument = createContractDocument(
    await getProgram(boundNumericComputedAccessCode),
    { fileName: 'bound-numeric-computed-access.js' }
);
assert.equal(boundNumericComputedAccessDocument.getDiagnostics().length, 1);
assert.equal(boundNumericComputedAccessDocument.getDiagnostics()[0].data.actual, 'number-like');

const programs = {
    'root.js': await getProgram([
        'import { value } from "./barrel.js";',
        'import external from "external-package";',
        'const load = () => import("./dynamic.js");',
        'value; external; load;'
    ].join('\n'), 'root.js'),
    'barrel.js': await getProgram('export { value } from "./provider.js";', 'barrel.js'),
    'provider.js': await getProgram('export { value } from "./leaf.js";', 'provider.js'),
    'leaf.js': await getProgram('export const value = "value";', 'leaf.js'),
    'unused.js': await getProgram('const invalid = 42; invalid.toUpperCase();', 'unused.js'),
    'unreachable.js': await getProgram('export const hidden = [];', 'unreachable.js'),
    'dynamic.js': await getProgram('export const dynamic = true;', 'dynamic.js')
};
const tree = createProjectTree({ programs, roots: ['root.js'] });
const activeTree = tree.activate();
assert.deepEqual(activeTree.activeFiles, ['barrel.js', 'leaf.js', 'provider.js', 'root.js']);
assert.deepEqual(activeTree.inactiveFiles, ['dynamic.js', 'unreachable.js', 'unused.js']);
assert.equal(activeTree.unknownEdges.length, 2);
assert.ok(activeTree.unknownEdges.some(({ source = '' } = {}) => source === 'external-package'));
assert.ok(activeTree.unknownEdges.some(({ kind = '' } = {}) => kind === 'dynamic'));
assert.equal(activeTree.stats.indexed, 7);
assert.equal(activeTree.stats.activated, 4);
assert.ok(getModuleEdges({ fileName: 'root.js', program: programs['root.js'] })
    .some(({ kind = '' } = {}) => kind === 'dynamic'));

const leafInvalidation = tree.getInvalidatedFiles({ changedFiles: ['leaf.js'] });
assert.deepEqual(leafInvalidation.activeInvalidatedFiles, [
    'barrel.js',
    'leaf.js',
    'provider.js',
    'root.js'
]);
const inactiveInvalidation = tree.getInvalidatedFiles({ changedFiles: ['unused.js'] });
assert.deepEqual(inactiveInvalidation.activeInvalidatedFiles, []);
const identityInvalidation = tree.getInvalidatedFiles({ nextConfigIdentity: 'changed' });
assert.deepEqual(identityInvalidation.activeInvalidatedFiles, activeTree.activeFiles);

const snapshot = tree.analyze();
assert.deepEqual(snapshot.activeTree.activeFiles, activeTree.activeFiles);
assert.deepEqual(snapshot.diagnostics, snapshot.graph.getDiagnostics());

const resolverPrograms = {
    'root.js': await getProgram(
        'import { getValue } from "./provider.js"; getValue().toUpperCase();',
        'root.js'
    ),
    'first.js': await getProgram('export const getValue = () => "value";', 'first.js'),
    'second.js': await getProgram('export const getValue = () => 42;', 'second.js')
};
const firstResolver = ({ source = '' } = {}) => source === './provider.js' ? 'first.js' : '';
const secondResolver = ({ source = '' } = {}) => source === './provider.js' ? 'second.js' : '';
const firstResolverSnapshot = createProjectTree({
    programs: resolverPrograms,
    roots: ['root.js', 'first.js', 'second.js'],
    resolve: firstResolver
}).analyze();
const secondResolverSnapshot = createProjectTree({
    programs: resolverPrograms,
    roots: ['root.js', 'first.js', 'second.js'],
    resolve: secondResolver
}).analyze({ previousSnapshot: firstResolverSnapshot });
assert.equal(secondResolverSnapshot.reuse.graphReused, false);
assert.equal(secondResolverSnapshot.diagnostics.length, 1);
