import assert from 'node:assert/strict';

import { ESLint } from 'eslint';
import resilient from 'eslint-plugin-resilient';
import {
    clearContractCaches,
    getProjectGraphCacheStats,
    inferPattern
} from 'eslint-plugin-resilient/contracts';

const inferred = inferPattern({
    type: 'ObjectPattern',
    properties: [{
        type: 'Property',
        computed: false,
        key: { type: 'Identifier', name: 'title' },
        value: {
            type: 'AssignmentPattern',
            left: { type: 'Identifier', name: 'title' },
            right: { type: 'Literal', value: '' }
        }
    }]
});

assert.equal(inferred.kind, 'object');
assert.equal(inferred.properties.title.kind, 'string');

const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [resilient.configs.contracts]
});

const [validResult = {}] = await eslint.lintText(
    'const getTitle = ({ title = "" } = {}) => title; getTitle({ title: value });',
    { filePath: 'contracts-valid.js' }
);

assert.equal(validResult.errorCount, 0);

const [invalidResult = {}] = await eslint.lintText(
    'const getTitle = ({ title = "" } = {}) => title; getTitle({ title: 42 });',
    { filePath: 'contracts-invalid.js' }
);

assert.deepEqual(
    invalidResult.messages.map(({ ruleId = '' } = {}) => ruleId),
    ['resilient/signature-contract-call-site']
);

const [inconsistentResult = {}] = await eslint.lintText(
    "const getValue = (enabled = false) => enabled ? '' : null;",
    { filePath: 'contracts-inconsistent.js' }
);

assert.deepEqual(
    inconsistentResult.messages.map(({ ruleId = '' } = {}) => ruleId),
    [
        'resilient/signature-contract-return-consistency',
        'resilient/signature-contract-return-consistency'
    ]
);

clearContractCaches();
const beforeSharedAnalysis = getProjectGraphCacheStats();
const [sharedAnalysisResult = {}] = await eslint.lintText(
    'const getItems = ({ items = [] } = {}) => items; getItems({ items: "" }).toUpperCase();',
    { filePath: 'contracts-shared-analysis.js' }
);
assert.ok(sharedAnalysisResult.messages.length > 0);
const afterSharedAnalysis = getProjectGraphCacheStats();
assert.equal(afterSharedAnalysis.builds - beforeSharedAnalysis.builds, 1);
assert.ok(afterSharedAnalysis.hits > beforeSharedAnalysis.hits);
