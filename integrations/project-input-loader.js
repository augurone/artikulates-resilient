import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEsmModule } from './typescript-project-resolution.js';

// Node's loader observes executable inputs, including dynamic local imports.
const load = async (url, context, nextLoad) => {
    const result = await nextLoad(url, context);
    const { env = {} } = process;
    const { RESILIENT_INPUT_TRACE = '', RESILIENT_INPUT_ROOT = '' } = env;

    const file = url.startsWith('file:') ? fileURLToPath(url) : '';
    const local = RESILIENT_INPUT_ROOT && file.startsWith(RESILIENT_INPUT_ROOT + path.sep) && !file.includes(`${path.sep}node_modules${path.sep}`);

    if (local && /\.[cm]?[jt]sx?$/u.test(file)) assertEsmModule(file);

    if (RESILIENT_INPUT_TRACE && file) {
        appendFileSync(RESILIENT_INPUT_TRACE, `${JSON.stringify(file)}\n`);
    }

    return result;
};

export { load };
