import { deepStrictEqual, doesNotThrow, ok, strictEqual, throws } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { ESLint } from 'eslint';
import { parse } from 'espree';

import plugin from 'eslint-plugin-resilient/eslint';

const fixture = new URL('./fixtures/bad.js', import.meta.url);
const source = readFileSync(fixture, 'utf8');
const { negative = [], explanations = [], isolated = [] } = JSON.parse(readFileSync(new URL('./fixtures/rule-canary.json', import.meta.url), 'utf8'));
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
        let nodes = false;

        return ({ id = '', rule = '', anchor = '', binding = '' } = {}) => {
            let start = text.indexOf(anchor);
            let end = start + anchor.length;

            if (binding && !nodes) {
                const { body = [] } = parse(text, { ecmaVersion: 'latest', sourceType: 'module', range: true });

                nodes = body.flatMap(({ type = '', declarations = [] } = {}) => type === 'VariableDeclaration' ? declarations : []);
            }

            if (binding) {
                const declarations = nodes.filter(({ type = '', id = false } = {}) => {
                    if (type !== 'VariableDeclarator' || !id) return false;

                    const { name = '' } = id;

                    return name === binding;
                });

                strictEqual(declarations.length, 1, `${id}: source binding must occur exactly once`);
                const [{ range = [] } = {}] = declarations;

                [start = -1, end = -1] = range;
            }

            if (!binding) ok(anchor && start >= 0 && text.indexOf(anchor, start + 1) < 0, `${id}: source anchor must occur exactly once`);

            return messages.filter(({ ruleId = '', line = 0, column = 0 } = {}) => {
                const offset = offsets.at(line - 1) + column - 1;

                return ruleId === `resilient/${rule}` && offset >= start && offset < end;
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
        'const run = ({ onDone } = {}) => { if (typeof onDone !== "function") return; onDone(); };',
        'const inline = 1 + 2;',
        'const before = 1',
        '    + 2;',
        'void [inline, before];'
    ].join('\n');

    deepStrictEqual(await lint(valid), []);
    const comments = negative.map(({ rule = '', anchor = '' } = {}) => `// ${rule}\n/* ${anchor} */`).join('\n');
    const commentMessages = await lint(comments);

    deepStrictEqual(commentMessages, []);
    throws(() => assertNegatives(comments, commentMessages), /missing diagnostic at the executable source anchor/u);

    const { body = [], comments: parsedComments = [] } = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true, comment: true });
    const blocks = new Map([...body, ...parsedComments].map((node) => {
        const { range: [start = -1] = [] } = node;

        return [start, node];
    }));

    await isolated.reduce(async (previous, { id = '', rule = '', anchor = '', neighbor = [], nativeError = '', comment = false, complete = false } = {}) => {
        await previous;
        const marker = `// canary-case: ${id}\n`;
        const start = source.indexOf(marker);

        ok(start >= 0 && source.indexOf(marker, start + marker.length) < 0, `${id}: unique canonical marker`);
        const block = blocks.get(start + marker.length);

        ok(block, `${id}: canonical block follows its marker`);
        const { type = '', range = [], value = '' } = block;

        strictEqual(type, comment ? 'Block' : 'BlockStatement');
        const text = comment ? value : source.slice(...range);
        const messages = await lint(text);
        const selected = messages.filter(({ ruleId = '' } = {}) => ruleId === `resilient/${rule}`);

        strictEqual(selected.length, 1, id);

        if (complete) deepStrictEqual(messages, selected, id);

        strictEqual(reportsAt(text, selected)({ id, rule, anchor }).length, 1, id);
        const [before = '', after = ''] = neighbor;

        ok(before && text.includes(before) && !text.includes(after), `${id}: distinct neighbor edit`);
        strictEqual(text.indexOf(before), text.lastIndexOf(before), `${id}: unique neighbor edit`);
        const valid = text.replace(before, after);

        const validMessages = await lint(valid);

        deepStrictEqual(complete ? validMessages : validMessages.filter(({ ruleId = '' } = {}) => ruleId === `resilient/${rule}`), [], id);

        if (nativeError) {
            throws(() => runInNewContext(text), ({ name = '' } = {}) => name === nativeError, id);
            doesNotThrow(() => runInNewContext(valid), id);
        }
    }, Promise.resolve());
});
