import assert from 'node:assert/strict';

import { ESLint } from 'eslint';
import resilient from 'eslint-plugin-resilient';

const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
        {
            plugins: { resilient },
            rules: {
                'no-empty': 'error',
                'resilient/prefer-prototype-methods': 'error'
            }
        },
        resilient.configs.safety
    ]
});

const [result = {}] = await eslint.lintText(`
    const update = ({ items }) => {
        items.push(true);
    };

    try {
        request().then(handle);
    } catch {
    }
`, { filePath: 'safety-fixture.js' });

assert.deepEqual(
    result.messages.map(({ ruleId = '' } = {}) => ruleId).sort(),
    [
        'resilient/no-silent-catch',
        'resilient/no-unhandled-promise-chain',
        'resilient/prefer-safe-transformations'
    ]
);

const [loopResult = {}] = await eslint.lintText(
    'for (const item of items) result.push(item);',
    { filePath: 'loop-fixture.js' }
);

assert.deepEqual(
    loopResult.messages.map(({ ruleId = '' } = {}) => ruleId),
    ['resilient/prefer-prototype-methods']
);

const [switchLoopResult = {}] = await eslint.lintText(
    'for (const item of items) { switch (item.kind) { case "done": break; default: result.push(item); } }',
    { filePath: 'switch-loop-fixture.js' }
);

assert.deepEqual(
    switchLoopResult.messages.map(({ ruleId = '' } = {}) => ruleId),
    ['resilient/prefer-prototype-methods']
);

const [handledChainResult = {}] = await eslint.lintText(
    'request().then(handle).catch(report);',
    { filePath: 'handled-chain-fixture.js' }
);

assert.deepEqual(
    handledChainResult.messages.map(({ ruleId = '' } = {}) => ruleId),
    ['resilient/prefer-async-await']
);
