import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

import plugin from 'eslint-plugin-resilient/eslint';

const fixture = new URL('./fixtures/bad.js', import.meta.url);
const source = readFileSync(fixture, 'utf8');
const { negative = [], explanations = [] } = JSON.parse(readFileSync(new URL('./fixtures/rule-canary.json', import.meta.url), 'utf8'));
const config = [{ languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } },
    plugin.configs.recommended, plugin.configs.contracts, plugin.configs.safety];

test('the public rule canary rejects executable negatives and preserves source explanations', async () => {
    deepStrictEqual(negative.map(({ rule = '' } = {}) => rule).toSorted(), Object.keys(plugin.rules).toSorted(), 'Every public rule needs an executable negative anchor');
    strictEqual(new Set(negative.map(({ id = '' } = {}) => id)).size, negative.length);
    const engine = new ESLint({ overrideConfigFile: true, overrideConfig: config, cache: false });
    const lint = async (text) => {
        const [result = {}] = await engine.lintText(text, { filePath: fileURLToPath(fixture) });
        const { fatalErrorCount = 0, messages = [], suppressedMessages = [] } = result;

        strictEqual(fatalErrorCount, 0);
        deepStrictEqual(suppressedMessages, []);

        return messages;
    };
    const reportsAt = (text, messages) => {
        const offsets = [0, ...Array.from(text.matchAll(/\n/gu), ({ index = 0 } = {}) => index + 1)];

        return ({ id = '', rule = '', anchor = '' } = {}) => {
            const start = text.indexOf(anchor);

            ok(anchor && start >= 0 && text.indexOf(anchor, start + 1) < 0, `${id}: source anchor must occur exactly once`);

            return messages.filter(({ ruleId = '', line = 0, column = 0 } = {}) => {
                const offset = offsets.at(line - 1) + column - 1;

                return ruleId === `resilient/${rule}` && offset >= start && offset < start + anchor.length;
            });
        };
    };
    const assertNegatives = (text, messages) => {
        const reports = reportsAt(text, messages);

        negative.forEach(({ id = '', ...entry } = {}) => ok(reports({ id, ...entry }).length, `${id}: missing diagnostic at the executable source anchor`));
    };
    const messages = await lint(source);
    assertNegatives(source, messages);
    const reports = reportsAt(source, messages);

    explanations.forEach(({ id = '', includes = [], ...entry } = {}) => {
        ok(includes.length);
        ok(reports({ id, ...entry }).some(({ message = '' } = {}) => includes.every(part => message.includes(part))), `${id}: missing source explanation`);
    });
    const valid = [
        'import { getItems, getTitle } from "./bad-import-provider.js";',
        'getTitle({ title: "ready" }).trim();',
        'getItems({ items: [] }).map(item => item);',
        'const inspect = value => value.trim();',
        'const run = ({ onDone } = {}) => { if (typeof onDone !== "function") return; onDone(); };'
    ].join('\n');

    deepStrictEqual(await lint(valid), []);
    const comments = negative.map(({ rule = '', anchor = '' } = {}) => `// ${rule}\n/* ${anchor} */`).join('\n');
    const commentMessages = await lint(comments);

    deepStrictEqual(commentMessages, []);
    throws(() => assertNegatives(comments, commentMessages), /missing diagnostic at the executable source anchor/u);
});
