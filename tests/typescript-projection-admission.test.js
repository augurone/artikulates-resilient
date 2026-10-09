import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

import typescript from 'typescript';

import { createTypeScriptTransformer } from 'eslint-plugin-resilient/typescript';

import {
    collectExactProjectionContracts,
    collectProviderForwardContracts
} from '../transforms/typescript/understand/type-evidence.js';

const cases = [
    {
        name: 'provider-direct',
        code: 'export function forward(P: { call: (value: number) => number }) { return { call: P.call }; }',
        provider: 1
    },
    {
        name: 'provider-optional-read',
        code: 'export function forward(P: { call: (value: number) => number }) { return { call: P?.call }; }'
    },
    {
        name: 'projection-direct',
        code: 'export const project = (items: Array<{ value: number }>) => items.map(item => item.value);',
        projection: 1
    },
    {
        name: 'projection-missing-field-type',
        code: 'export const project = (items: Array<{ value?: number }>) => items.map(item => item.value);'
    },
    {
        name: 'projection-optional-field',
        code: 'export const project = (items: Array<{ value: number }>) => items.map(item => item?.value);'
    },
    {
        name: 'projection-optional-nested',
        code: 'export const project = (items: Array<{ value: { next: number } }>) => items.map(item => item?.value.next);'
    },
    {
        name: 'projection-optional-receiver',
        code: 'export const project = (items: Array<{ value: number }>) => items?.map(item => item.value);'
    },
    {
        name: 'projection-optional-call',
        code: 'export const project = (items: Array<{ value: number }>) => items.map?.(item => item.value);'
    }
];
const sources = new Map(cases.map(({ name = '', code = '' } = {}) => [
    `${name}.ts`,
    typescript.createSourceFile(`${name}.ts`, code, typescript.ScriptTarget.ESNext, true)
]));
const options = { strict: true, target: typescript.ScriptTarget.ESNext };
const host = typescript.createCompilerHost(options);
const program = typescript.createProgram([...sources.keys()], options, {
    ...host,
    getSourceFile: (name, version) => sources.get(name) || host.getSourceFile(name, version)
});
const checker = program.getTypeChecker();
const execute = (code = '') => {
    const { outputText = '' } = typescript.transpileModule(code, {
        compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ESNext }
    });
    const exports = {};

    runInNewContext(outputText, { exports });

    return exports;
};

cases.forEach(({ name = '', code = '', provider = 0, projection = 0 } = {}) => {
    const fileName = `${name}.ts`;
    const sourceFile = sources.get(fileName);
    const providerFacts = collectProviderForwardContracts({ typescript, sourceFile, checker });
    const projectionFacts = collectExactProjectionContracts({ typescript, sourceFile, checker });
    const { transform = false } = createTypeScriptTransformer({ typescript, program });
    const { diagnostics = [], agreements = [], code: output = '' } = transform({ code, fileName });

    assert.equal(providerFacts.size, provider, `${name}: provider source admission`);
    assert.equal(projectionFacts.size, projection, `${name}: projection source admission`);
    assert.deepEqual(diagnostics, [], name);
    assert.equal(agreements.filter(({ action = '' } = {}) => action === 'provider-forwarded').length,
        provider, `${name}: provider report placement`);
    assert.equal(agreements.filter(({ action = '' } = {}) => action === 'exact-callback-projected').length,
        projection, `${name}: projection report placement`);

    if (name.includes('optional') && !name.includes('optional-call') && !name.includes('optional-receiver')) {
        assert.match(output, /\?\./u, `${name}: optional evaluation stays at source`);
    }

    const sourceRuntime = execute(code);
    const targetRuntime = execute(output);
    const observe = ({ forward = false, project = false } = {}) => {
        let events = [];
        const failure = new Error('field failure');
        const callable = value => value;

        if (name.startsWith('provider')) {
            const providerInput = { get call() {
                events = [...events, 'call'];

                return callable;
            } };
            const { call: presentCall = false } = forward(providerInput);
            const present = presentCall === callable;
            const { call: absent = undefined } = name.includes('optional') ? forward(null) : {};

            return { present, absent, events };
        }

        const observedValue = name === 'projection-optional-nested' ? { next: 7 } : 7;
        const value = { get value() {
            events = [...events, 'value'];

            return observedValue;
        } };
        const ordinary = Array.from(project([value]));
        const getOptional = () => {
            if (['projection-optional-field', 'projection-optional-nested'].includes(name)) {
                return Array.from(project([null, value]));
            }

            if (name === 'projection-optional-receiver') return project(null);

            if (name === 'projection-optional-call') return project({ map: undefined });

            return false;
        };
        const optional = name === 'projection-missing-field-type'
            ? Array.from(project([{}, { value: undefined }, value]))
            : getOptional();
        let abrupt = false;

        if (['projection-optional-field', 'projection-missing-field-type'].includes(name)) {
            try {
                project([{ get value() {
                    events = [...events, 'throw'];

                    throw failure;
                } }]);
            } catch (error) {
                abrupt = error === failure;
            }
        }

        let missingReceiverFailure = false;

        if (name === 'projection-missing-field-type') {
            try {
                project([undefined]);
            } catch (error) {
                missingReceiverFailure = error.name === 'TypeError';
            }
        }

        return { ordinary, optional, abrupt, missingReceiverFailure, events };
    };

    assert.deepEqual(observe(targetRuntime), observe(sourceRuntime), `${name}: source/target result and Get trace`);
});
