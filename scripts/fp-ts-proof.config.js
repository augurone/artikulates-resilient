import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const run = ({ cwd = '', full = false, slice = '', execFileSync = () => {} } = {}) => {
    if (!full || slice) throw new Error('The fp-ts profile currently supports only --full.');

    // eslint-disable-next-line resilient/signature-contract-call-site -- The injected executor owns command arguments; the empty fallback intentionally ignores them.
    return execFileSync(process.execPath, [path.join(directory, 'check-fp-ts-corpus.js'), cwd], { cwd, stdio: 'inherit' });
};

export default { run };
