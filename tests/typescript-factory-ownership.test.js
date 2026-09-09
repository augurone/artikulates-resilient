import assert from 'node:assert/strict';

import typescript from 'typescript';

import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import { getDestructuringAgreement } from '../transforms/typescript/policy/defaults.js';
import { collectDestructuringAgreements } from '../transforms/typescript/policy/source-agreements.js';
import {
    collectFactoryBindingContracts
} from '../transforms/typescript/understand/type-evidence.js';

const compile = (code = '') => {
    const fileName = 'factory-ownership.ts';
    const sourceFile = typescript.createSourceFile(fileName, code, typescript.ScriptTarget.ESNext, true);
    const options = { strict: true, target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext };
    const host = typescript.createCompilerHost(options);
    const program = typescript.createProgram([fileName], options, {
        ...host, getSourceFile: (name, version) => name === fileName ? sourceFile : host.getSourceFile(name, version)
    });
    const contracts = collectFactoryBindingContracts({ typescript, sourceFile, checker: program.getTypeChecker() });
    const result = createTypeScriptTransformer({ typescript, program }).transform({ code, fileName });
    const { diagnostics = [] } = result;
    assert.deepEqual(diagnostics, []);

    return { ...result, contracts };
};
const source = (name = '', type = '{ operation: () => number }') => [
    `export function read(${name}: () => ${type}) {`,
    `    const { operation } = ${name}();`,
    '    return () => operation;',
    '}'
].join('\n');
const names = ['ordinaryFactory', 'getAltValidation', 'getApplicativeValidation', 'getFunctorComposition'];
const records = names.map((name) => {
    const { agreements = [], contracts = new Map(), code = '' } = compile(source(name));
    const [record = {}] = agreements.filter(({ name: property = '' } = {}) => property === 'operation');
    const decisions = [...collectDestructuringAgreements({ factoryBindingContracts: contracts }).values()].flat()
        .map(entry => getDestructuringAgreement({ entry }));
    assert.ok(decisions.some(({ action = '', requiredProperties = [] } = {}) => action === 'preserve-required-factory-binding' && requiredProperties.includes('operation')));
    const { owner = '', state = '', action = '' } = record;
    assert.equal(owner, 'typeclass-factory');
    assert.equal(state, 'required');
    assert.equal(action, 'preserve');
    assert.doesNotMatch(code, /Missing required agreement|operation\s*=(?!=)/u);
    const { sourceRange = '', ...stable } = record;
    assert.ok(sourceRange);

    return stable;
});
assert.ok(records.every(record => JSON.stringify(record) === JSON.stringify(records[0])), 'Renaming preserves the published agreement.');

['{ operation: unknown }', '{ operation: any }', '{ operation?: () => number }', 'any', 'unknown'].forEach((type) => {
    const results = names.map((name) => {
        const { agreements = [], contracts = new Map() } = compile(source(name, type));
        assert.equal(contracts.size, 0, `${name}: ${type}`);
        const [record = {}] = agreements.filter(({ name: property = '' } = {}) => property === 'operation');
        const { owner = '' } = record;
        assert.notEqual(owner, 'typeclass-factory');
        const { sourceRange = '', ...stable } = record;
        assert.ok(sourceRange);

        return stable;
    });
    assert.ok(results.every(record => JSON.stringify(record) === JSON.stringify(results.at(0))));
});

const runtimeSource = source('ordinaryFactory').replace('return () => operation;', 'return () => operation();');
const { code: generated = '' } = compile(runtimeSource);
const load = async code => import(`data:text/javascript,${encodeURIComponent(code)}`);
const original = await load(typescript.transpileModule(runtimeSource, {
    compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext }
}).outputText);
const transformed = await load(generated);
const observe = (module, mode = '') => {
    let events = [];
    const failure = new Error('factory or getter');
    const operation = () => 7;
    const make = () => {
        events = [...events, 'call'];

        if (mode === 'factory-throw') throw failure;

        if (['null', 'missing'].includes(mode)) return Reflect.get({ null: null, missing: {} }, mode);

        return { get operation() {
            events = [...events, 'get'];

            if (mode === 'getter-throw') throw failure;

            return operation;
        } };
    };
    try {
        const later = module.read(make);
        const before = [...events];
        const value = later();

        return { before, events, value };
    } catch (error) {
        const { message = '' } = error;

        return { events, sameFailure: error === failure, nativeTypeError: error instanceof TypeError, message };
    }
};
['normal', 'missing', 'null', 'factory-throw', 'getter-throw'].forEach((mode) => {
    assert.deepEqual(observe(transformed, mode), observe(original, mode), mode);
});

const mixed = compile([
    'export function read(make: () => { operation: () => number; payload: unknown; optional?: () => number }) {',
    '    const { operation, payload, optional } = make();',
    '    return () => [operation, payload, optional];',
    '}'
].join('\n'));
const { agreements: mixedAgreements = [] } = mixed;
const { owner: mixedOwner = '' } = mixedAgreements.find(({ name = '' } = {}) => name === 'operation');
assert.equal(mixedOwner, 'typeclass-factory');
['payload', 'optional'].forEach((property) => {
    const { owner = '' } = mixedAgreements.find(({ name = '' } = {}) => name === property);
    assert.notEqual(owner, 'typeclass-factory',
        'A proved field cannot lend ownership to a sibling.');
});
const explicit = compile(source('getAltValidation').replace('const { operation }', 'const { operation = () => 9 }'));
const { code: explicitCode = '', agreements: explicitAgreements = [] } = explicit;
assert.match(explicitCode, /operation = \(\) => 9/u);
assert.ok(!explicitAgreements.some(({ name = '' } = {}) => name === 'operation'));
assert.equal(collectFactoryBindingContracts({ typescript }).size, 0, 'No checker means no factory fact.');
const selected = compile([
    'declare const renamed: () => { operation: () => number };',
    'const selected = renamed().operation;',
    'export const later = () => selected;'
].join('\n'));
const { agreements: selectedAgreements = [], contracts: selectedContracts = new Map() } = selected;
assert.equal(selectedContracts.size, 0, 'A direct projection keeps its existing provider-edge owner.');
assert.ok(selectedAgreements.some(({ name = '', owner = '' } = {}) => name === 'operation' && owner === 'provider-caller'));
