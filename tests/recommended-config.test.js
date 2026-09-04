import assert from 'node:assert/strict';

import { ESLint } from 'eslint';
import resilient from 'eslint-plugin-resilient';

const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [resilient.configs.recommended]
});

const lint = async (code = '') => {
    const [result = {}] = await eslint.lintText(code, {
        filePath: 'recommended-config-fixture.js'
    });

    return result;
};

const validResult = await lint('const getItems = ({ items = [] } = {}) => items;\nexport default getItems;\n');

assert.equal(validResult.errorCount, 0);

const styleResult = await lint([
    'function getItems() {',
    '    return [];',
    '}',
    'let label = \'items\';',
    'getItems();',
    'label;',
    ''
].join('\n'));

assert.deepEqual(
    styleResult.messages.map(({ ruleId = '' } = {}) => ruleId).sort(),
    ['func-style', 'prefer-const']
);

const redundantReturnResult = await lint([
    'const finish = () => {',
    '    return;',
    '    return;',
    '};',
    'void finish;',
    ''
].join('\n'));

assert.deepEqual(
    redundantReturnResult.messages.map(({ ruleId = '' } = {}) => ruleId),
    ['no-useless-return']
);

const invalidResult = await lint([
    'const getItems = (items) => {',
    '    if (items.length === 0) {',
    '        return [];',
    '    } else {',
    '        return items;',
    '    }',
    '};',
    'export default getItems;',
    ''
].join('\n'));

assert.deepEqual(
    invalidResult.messages.map(({ ruleId = '' } = {}) => ruleId).sort(),
    ['resilient/no-else', 'resilient/no-length-comparison']
);
