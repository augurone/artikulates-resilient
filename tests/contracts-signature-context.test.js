import assert from 'node:assert/strict';

import { ESLint } from 'eslint';

import resilient from 'eslint-plugin-resilient';

import { createContractDocument } from '../rules/contracts/document.js';
import { getDefinitions, getSignature } from '../rules/contracts/infer.js';
import { getKind } from '../rules/contracts/model.js';
import { createContractGraph } from '../rules/contracts/module-graph.js';
import { captureProgram } from '../rules/support/eslint-program.js';

const cases = [
    {
        code: 'const read = (value = Object.entries({})) => value.trim(); read();',
        expected: ['signature-contract-operation'],
        parameterKinds: ['array']
    },
    {
        code: 'const read = (Object, value = Object.entries({})) => value.trim(); read({ entries: () => "ok" });',
        expected: [],
        parameterKinds: ['unknown', 'unknown']
    },
    {
        code: 'const Object = { entries: () => "ok" }; const read = (value = Object.entries({})) => value.trim(); read();',
        expected: [],
        parameterKinds: ['unknown']
    },
    {
        code: 'const NativeObject = Object; const read = (value = NativeObject.entries({})) => value.trim(); read();',
        expected: ['signature-contract-operation'],
        parameterKinds: ['array']
    },
    {
        code: 'let NativeObject = Object; NativeObject = custom; const read = (value = NativeObject.entries({})) => value.trim(); read();',
        expected: [],
        parameterKinds: ['unknown']
    },
    {
        code: 'const read = (value = Object.entries({})) => { var Object; return value.trim(); }; read();',
        expected: ['signature-contract-operation'],
        parameterKinds: ['array']
    },
    {
        code: 'const read = (first = "", second = first) => second.map(Boolean); read();',
        expected: ['signature-contract-operation'],
        parameterKinds: ['string', 'string']
    },
    {
        code: 'const read = (first = second, second = "") => first.map(Boolean); read();',
        expected: [],
        parameterKinds: ['unknown', 'string']
    },
    {
        code: 'const read = (value = Object.entries({})) => value; read("ok");',
        expected: ['signature-contract-call-site'],
        parameterKinds: ['array']
    },
    {
        code: 'const read = (Object, value = Object.entries({})) => value; read({}, "ok");',
        expected: [],
        parameterKinds: ['unknown', 'unknown']
    }
];
const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{
        plugins: { resilient },
        rules: {
            'resilient/signature-contract-operation': 'error',
            'resilient/signature-contract-call-site': 'error'
        }
    }]
});

// eslint-disable-next-line resilient/prefer-prototype-methods -- These parser and ESLint sessions are deliberately sequential.
for (const testCase of cases) {
    const { code = '', expected = [], parameterKinds = [] } = testCase;
    const program = await captureProgram(code, { fileName: 'signature-context.js' });
    const { read: definition = {} } = getDefinitions(program);
    const { signature = {} } = definition;
    const { parameters = [] } = signature;
    const document = createContractDocument(program);
    const documentRules = document.getDiagnostics()
        .map(({ ruleId = '' } = {}) => ruleId)
        .filter(ruleId => ['signature-contract-operation', 'signature-contract-call-site'].includes(ruleId));
    const [lintResult = {}] = await eslint.lintText(code, { filePath: 'signature-context.js' });
    const lintRules = (lintResult.messages || [])
        .map(({ ruleId = '' } = {}) => ruleId.replace('resilient/', ''))
        .filter(ruleId => ['signature-contract-operation', 'signature-contract-call-site'].includes(ruleId));

    assert.deepEqual(parameters.map(getKind), parameterKinds, code);
    assert.deepEqual(documentRules, expected, code);
    assert.deepEqual(lintRules, expected, code);
}

const nativeCall = {
    type: 'CallExpression',
    callee: {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'Object' },
        property: { type: 'Identifier', name: 'entries' },
        computed: false
    },
    arguments: [{ type: 'ObjectExpression', properties: [] }]
};
const standalone = getSignature({
    type: 'ArrowFunctionExpression',
    params: [{
        type: 'AssignmentPattern',
        left: { type: 'Identifier', name: 'value' },
        right: nativeCall
    }]
});

assert.equal(getKind(standalone.contract), 'unknown');
assert.equal(getKind(getSignature({
    params: [{
        type: 'AssignmentPattern',
        left: { type: 'Identifier', name: 'value' },
        right: { type: 'Literal', value: 'ok' }
    }]
}).contract), 'string');

const source = 'const read = (Object, value = Object.entries({})) => value.trim();';
const parented = await captureProgram(source, { fileName: 'parentless-signature.js' });
// eslint-disable-next-line resilient/prefer-falsey-returns -- The clone removes parser parent links to prove index-owned lexical resolution.
const parentless = JSON.parse(JSON.stringify(parented, (key, value) => key === 'parent' ? undefined : value));
assert.deepEqual(createContractDocument(parentless).getDiagnostics(), []);
assert.deepEqual(getDefinitions(parentless).read.signature.parameters.map(getKind), ['unknown', 'unknown']);

const provider = await captureProgram(
    'export const read = (Object, value = Object.entries({})) => value;',
    { fileName: 'provider.js' }
);
const consumer = await captureProgram(
    'import { read } from "./provider.js"; read({}, "ok");',
    { fileName: 'consumer.js' }
);
const graph = createContractGraph({ programs: { 'provider.js': provider, 'consumer.js': consumer } });
assert.deepEqual(graph.getDiagnostics()
    .filter(({ ruleId = '' } = {}) => ruleId === 'signature-contract-call-site'), []);
