#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { inspectJavaScript } from '../integrations/inspection.js';

const main = async (args = []) => {
    const { values = {}, positionals = [] } = parseArgs({ args, allowPositionals: true, strict: true, options: {
        config: { type: 'string' }, standalone: { type: 'boolean' }, find: { type: 'string' }, offset: { type: 'string' }, help: { type: 'boolean' }
    } });
    const { help = false, config = '', standalone = false, find = '', offset: requestedOffset = '' } = values;

    if (help) {
        process.stdout.write('Usage: resilient-inspect <file> [--config <eslint.config.js> | --standalone] (--find <unique text> | --offset <UTF-16 offset>)\n'
            + 'Prints findings and current analysis evidence as JSON. --standalone uses built-in contracts without loading project configuration.\n');

        return;
    }

    if (positionals.length !== 1) throw new Error('Expected exactly one source file');

    if (Object.hasOwn(values, 'config') && !config) throw new Error('Expected a configuration path after --config');

    if (Object.hasOwn(values, 'find') && !find) throw new Error('Expected nonempty text after --find');

    if (Object.hasOwn(values, 'offset') && !/^(?:0|[1-9]\d*)$/u.test(requestedOffset)) throw new Error('Expected a nonnegative integer after --offset');

    const [fileName = ''] = positionals;
    const result = await inspectJavaScript({ fileName, config, standalone, find, offset: requestedOffset ? Number(requestedOffset) : -1 });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};
const { argv: [, entry = '', ...args] = [] } = process;

if (entry && pathToFileURL(realpathSync(resolve(entry))).href === import.meta.url) {
    try {
        await main(args);
    } catch (error) {
        const { message = '' } = error;
        process.stderr.write(`${message}\n`);
        // eslint-disable-next-line resilient/prefer-safe-transformations -- The inspector CLI owns its failure exit status after reporting the operational error.
        process.exitCode = 1;
    }
}
