import assert from 'node:assert/strict';

import { ESLint } from 'eslint';
import { createContractDocument } from 'eslint-plugin-resilient/contracts';

const getProgram = async (code) => {
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
            plugins: { capture },
            rules: { 'capture/program': 'error' }
        }]
    });

    await eslint.lintText(code, { filePath: 'contract-document.js' });
    return program;
};

const code = 'const getTitle = ({ title = "" } = {}) => title; getTitle({ title: 42 });';
const program = await getProgram(code);
const document = createContractDocument(program);

const titleOffset = code.indexOf('title =');
const titleResult = document.getContractAtOffset(titleOffset);
assert.equal(titleResult.contract.kind, 'string');

const signatureOffset = code.indexOf('title =');
const signatureResult = document.getSignatureAtOffset(signatureOffset);
assert.equal(signatureResult.name, 'getTitle');
assert.equal(signatureResult.signature.contract.kind, 'object');
assert.equal(signatureResult.signature.contract.properties.title.kind, 'string');

const valueOffset = code.indexOf('42');
const valueResult = document.getContractAtOffset(valueOffset);
assert.equal(valueResult.contract.kind, 'number');
