import { readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, resolve } from 'node:path';

import { put } from '../../collections.js';

const unavailable = Object.freeze({ available: false });
const readSource = (filename) => {
    try {
        return { available: true, filename, source: readFileSync(filename, 'utf8') };
    } catch (error) {
        const { code = '' } = error;

        if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(code)) return unavailable;

        throw error;
    }
};

// File I/O is a host responsibility. Cache only within this analysis snapshot;
// edits and resolver changes are observed by the next lint, including failures.
// The host resolver is optional and guarded at invocation; its absence selects the local relative-module resolver.
export const moduleSources = ({ filename = '', cwd = process.cwd(), settings: { resilient: { resolver, roots = [] } = {} } = {} } = {}) => {
    const snapshots = new Map();
    const load = (target) => {
        const extension = extname(target);

        if (extension && !['.js', '.jsx'].includes(extension)) return unavailable;

        if (snapshots.has(target)) return snapshots.get(target);

        const selected = [target, `${target}.js`, resolve(target, 'index.js')].reduce((found, filename) => {
            const { available = false } = found;

            return available ? found : readSource(filename);
        }, unavailable);

        return put(snapshots, target, selected);
    };
    const requested = typeof roots === 'function' ? roots({ fileName: filename }) : roots;

    if (!Array.isArray(requested)) throw new TypeError('Expected configured analysis roots to be an array');

    const selectedRoots = [...new Set(requested.map((root) => {
        if (typeof root !== 'string' || !root) throw new TypeError('Expected a configured analysis root filename');

        return resolve(cwd, root);
    }))].filter(root => root !== filename);
    const resolveModule = ({ from = '', source = '' } = {}) => {
        if (!isAbsolute(from)) return unavailable;

        if (typeof resolver !== 'function' && !source.startsWith('.') && !isAbsolute(source)) return unavailable;

        const target = typeof resolver === 'function' ? resolver({ from, source }) : resolve(dirname(from), source);

        if (!target) return unavailable;

        if (typeof target !== 'string' || !isAbsolute(target)) throw new TypeError('Expected an absolute resolved module filename');

        return load(target);
    };

    return { resolveModule, roots: selectedRoots.map(load) };
};
