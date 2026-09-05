import assert from 'node:assert/strict';
import fs from 'node:fs';

import resilient from 'eslint-plugin-resilient';

const { name: packageName = '', version: packageVersion = '' } = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);
const {
    meta: pluginMeta = {},
    rules: publicRules = {},
    configs = {}
} = resilient;
const publicRuleNames = new Set(Object.keys(publicRules));

assert.deepEqual(pluginMeta, {
    name: packageName,
    version: packageVersion,
    namespace: 'resilient'
});

Object.entries(publicRules).forEach(([name = '', rule = {}]) => {
    const { meta = {} } = rule;
    const {
        type = '',
        docs = {},
        schema = [],
        messages = {}
    } = meta;
    const { create = () => {} } = rule;

    assert.ok(type);
    const { description = '', url = '' } = docs;
    assert.ok(description);
    assert.ok(url);
    assert.ok(Array.isArray(schema));
    assert.ok(Object.keys(messages).length);
    assert.equal(typeof create, 'function', name);
});

['recommended', 'contracts', 'safety'].forEach((configName = '') => {
    const { [configName]: config = {} } = configs;
    const {
        plugins: { resilient: resilientPlugin = {} } = {},
        rules: configRules = {}
    } = config;

    assert.equal(resilientPlugin, resilient, configName);

    Object.keys(configRules)
        .filter(ruleId => ruleId.startsWith('resilient/'))
        .forEach((ruleId = '') => {
            assert.ok(publicRuleNames.has(ruleId.slice('resilient/'.length)), ruleId);
        });
});
