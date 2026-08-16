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

const validResult = await lint('const getItems = ({ items = [] } = {}) => items;\nexport default getItems;');

assert.equal(validResult.errorCount, 0);

const invalidResult = await lint('const getItems = (items) => {\n    if (items.length === 0) return [];\n    else return items;\n};\nexport default getItems;');

assert.deepEqual(
    invalidResult.messages.map(({ ruleId = '' } = {}) => ruleId).sort(),
    ['resilient/no-else', 'resilient/no-length-comparison']
);
