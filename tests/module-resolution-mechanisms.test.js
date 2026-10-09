import assert from 'node:assert/strict';

import { createContractGraph } from 'eslint-plugin-resilient/contracts';

import { clearContractGraphCaches, resolveModule } from '../rules/contracts/module-graph.js';
import { captureProgram } from '../rules/support/eslint-program.js';

const sourceCases = {
    direct: {
        'base.js': 'export const getItems = ({ items = [] } = {}) => items;',
        'consumer.js': 'import { getItems } from "./base.js"; getItems({}).toUpperCase();'
    },
    barrel: {
        'base.js': 'export const getItems = ({ items = [] } = {}) => items;',
        'barrel.js': 'export { getItems } from "./base.js";',
        'consumer.js': 'import { getItems } from "./barrel.js"; getItems({}).toUpperCase();'
    },
    cycle: {
        'a.js': 'export const getItems = ({ items = [] } = {}) => items; export { other } from "./b.js";',
        'b.js': 'export { getItems as other } from "./a.js";',
        'consumer.js': 'import { other } from "./b.js"; other({}).toUpperCase();'
    },
    ambiguity: {
        'first.js': 'export const getItems = ({ items = [] } = {}) => items;',
        'second.js': 'export const getItems = ({ title = "" } = {}) => title;',
        'barrel.js': 'export * from "./first.js"; export * from "./second.js";',
        'consumer.js': 'import { getItems } from "./barrel.js"; getItems({}).toUpperCase();'
    },
    explicit: {
        'first.js': 'export const getItems = ({ items = [] } = {}) => items;',
        'second.js': 'export const getItems = ({ title = "" } = {}) => title;',
        'barrel.js': 'export * from "./first.js"; export * from "./second.js"; export { getItems } from "./first.js";',
        'consumer.js': 'import { getItems } from "./barrel.js"; getItems({}).toUpperCase();'
    },
    namespace: {
        'base.js': 'export const getItems = ({ items = [] } = {}) => items; export default ({ title = "" } = {}) => title;',
        'barrel.js': 'export * as api from "./base.js"; export * from "./base.js";',
        'consumer.js': 'import { api } from "./barrel.js"; api.getItems({}).toUpperCase();'
    },
    unknown: {
        'a.js': 'export { value } from "./b.js";',
        'b.js': 'export { value } from "./a.js";',
        'consumer.js': 'import { value } from "./a.js"; import external from "absent"; value.toUpperCase();'
    },
    wrapper: {
        'base.js': 'export const getItems = ({ items = [] } = {}) => items;',
        'wrapper.js': 'import { getItems } from "./base.js"; export const load = () => getItems({});',
        'consumer.js': 'import { load } from "./wrapper.js"; load().toUpperCase();'
    },
    empty: {}
};

const getPrograms = async (sources = {}) => Object.freeze(Object.fromEntries(
    await Promise.all(Object.entries(sources).map(async ([fileName = '', source = ''] = []) => [
        fileName, Object.freeze(await captureProgram(source, { fileName }))
    ]))
));

const observeGraph = ({ create = createContractGraph, programs = {} } = {}) => {
    let calls = [];
    const graph = create({ programs, resolve: (options = {}) => {
        const { from = '', source = '', programs: currentPrograms = {} } = options;
        calls = [...calls, { from, source, files: Object.keys(currentPrograms) }];

        return resolveModule(options);
    } });

    return { graph, calls };
};

clearContractGraphCaches();
const programsByCase = Object.fromEntries(await Promise.all(Object.entries(sourceCases)
    .map(async ([name = '', sources = {}] = []) => [name, await getPrograms(sources)])));
const results = Object.fromEntries(Object.entries(programsByCase)
    .map(([name = '', programs = {}] = []) => [name, observeGraph({ programs })]));

assert.equal(results.direct.graph.getDiagnostics().length, 1);
assert.equal(results.barrel.graph.getDiagnostics().length, 1);
assert.equal(results.cycle.graph.moduleExports['b.js'].other.returnContract.kind, 'array');
assert.equal(results.cycle.graph.getDiagnostics().length, 1);
assert.equal(results.ambiguity.graph.moduleExports['barrel.js'].getItems, undefined);
assert.equal(results.ambiguity.graph.getAgreements()[0].kind, 'ambiguous');
assert.equal(results.ambiguity.graph.getDiagnostics().length, 0);
assert.equal(results.explicit.graph.moduleExports['barrel.js'].getItems.returnContract.kind, 'array');
assert.equal(results.explicit.graph.getDiagnostics().length, 1);
assert.equal(results.namespace.graph.moduleExports['barrel.js'].api.kind, 'object');
assert.equal(results.namespace.graph.moduleExports['barrel.js'].default, undefined);
assert.equal(results.namespace.graph.getDiagnostics().length, 1);
assert.equal(results.unknown.graph.getDiagnostics().length, 0);
assert.deepEqual(results.unknown.graph.getAgreements().map(({ kind = '' } = {}) => kind), ['missing', 'unknown']);
assert.equal(results.wrapper.graph.moduleExports['wrapper.js'].load.returnContract.kind, 'array');
assert.equal(results.wrapper.graph.getDiagnostics().length, 1);
assert.deepEqual(results.empty.graph.moduleExports, {});
assert.deepEqual(results.empty.calls, []);

const barrelCall = { from: 'barrel.js', source: './base.js', files: ['base.js', 'barrel.js', 'consumer.js'] };
const consumerCall = { from: 'consumer.js', source: './barrel.js', files: ['base.js', 'barrel.js', 'consumer.js'] };
assert.deepEqual(results.barrel.calls, [
    barrelCall, barrelCall, barrelCall, consumerCall,
    barrelCall, barrelCall, barrelCall, consumerCall, consumerCall
]);
assert.equal(results.barrel.graph.moduleExports['base.js'].getItems, results.barrel.graph.moduleExports['barrel.js'].getItems);
assert.equal(results.barrel.graph.moduleExports['base.js'].getItems.node, programsByCase.barrel['base.js'].body[0].declaration.declarations[0].init);

const reused = createContractGraph({
    programs: programsByCase.barrel, previousGraph: results.barrel.graph,
    reusableFiles: ['base.js', 'barrel.js', 'consumer.js']
});
Object.keys(programsByCase.barrel).forEach((name = '') => {
    assert.equal(reused.definitions[name], results.barrel.graph.definitions[name]);
    assert.equal(reused.documents[name], results.barrel.graph.documents[name]);
    assert.equal(reused.agreements[name], results.barrel.graph.agreements[name]);
});

const failure = new Error('final-resolution failure');
let definitionImportObserved = false;
assert.throws(() => createContractGraph({ programs: programsByCase.barrel, resolve: (options = {}) => {
    const { from = '' } = options;

    if (from === 'consumer.js') definitionImportObserved = true;

    if (from === 'barrel.js' && definitionImportObserved) throw failure;

    return resolveModule(options);
} }), error => error === failure);

const lateProgram = await captureProgram('', { fileName: 'late.js' });
let extended = false;
const extendedGraph = createContractGraph({ programs: programsByCase.barrel, resolve: (options = {}) => {
    const { programs = {} } = options;

    if (!extended) {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Deliberate resolver domain extension proves later passes use current keys, not a cached initial domain.
        Object.assign(programs, { 'late.js': lateProgram });
        extended = true;
    }

    return resolveModule(options);
} });
assert.deepEqual(extendedGraph.moduleExports['late.js'], {});
assert.equal(Object.hasOwn(extendedGraph.documents, 'late.js'), true);
assert.deepEqual(extendedGraph.getDocument('late.js').getStackAtOffset(0).frames[0].range, [0, 0]);
assert.equal(Object.hasOwn(programsByCase.barrel, 'late.js'), false);

export { getPrograms, observeGraph, sourceCases };
