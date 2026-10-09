import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { append, put, retain } from '../analysis/collections.js';
import { traverse } from '../analysis/traversal.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const locks = ['npm-shrinkwrap.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];
const readAvailable = (file) => {
    try {
        return readFileSync(file);
    } catch (error) {
        const { code = '' } = error;

        if (['ENOENT', 'ENOTDIR'].includes(code)) return false;

        throw error;
    }
};
const locationChain = (directory) => {
    const directories = [];

    traverse(resolve(directory), { enter: (current) => {
        append(directories, current);
        const parent = dirname(current);

        return parent === current ? [] : [parent];
    } });

    return directories;
};
const describe = ({ file = '', sha256 = '', data: { name = '', version = '' } = {} } = {}) => ({ file, name, version, sha256 });

// Metadata belongs to one report. Resolve each package from its actual parent,
// including nested versions; completed reports retain plain records, not loaders.
export const createPackageIdentity = () => {
    const snapshots = new Map();
    const manifests = new Map();
    const resolutions = new Map();
    /* eslint-disable resilient/signature-contract-return-consistency -- A missing physical input remains false; a truthy record must represent bytes actually read. */
    const snapshot = (file) => {
        if (snapshots.has(file)) return snapshots.get(file);

        const bytes = readAvailable(file);

        if (!bytes) return false;

        return put(snapshots, file, { file: realpathSync(file), sha256: hash(bytes), bytes });
    };
    /* eslint-enable */
    /* eslint-disable resilient/signature-contract-return-consistency -- An unavailable manifest remains false; parsing must not fabricate package metadata. */
    const manifest = (file) => {
        if (manifests.has(file)) return manifests.get(file);

        const input = snapshot(file);

        if (!input) return false;

        const { bytes = '' } = input;

        return put(manifests, file, { ...input, data: JSON.parse(String(bytes)) });
    };
    /* eslint-enable */
    /* eslint-disable resilient/signature-contract-return-consistency -- An unresolved installed package remains false; an empty record would falsely claim resolution. */
    const installed = (name, from) => {
        const key = JSON.stringify([from, name]);

        if (resolutions.has(key)) return resolutions.get(key);

        // Node's package search paths also locate manifests hidden by exports.
        // Package aliases retain their actual manifest name and physical identity.
        const candidates = createRequire(from).resolve.paths(name) ?? [];
        const selected = candidates.map(directory => resolve(directory, name, 'package.json')).find(file => Boolean(manifest(file)));

        return put(resolutions, key, selected ? manifest(selected) : false);
    };
    /* eslint-enable */
    const dependencies = (root, includeDevelopment = false) => {
        const seen = new Set();
        const packages = [];
        const edges = [];
        const missing = [];
        const { file: rootFile = '' } = root;

        traverse(root, { enter: (current) => {
            const { file = '', data: { dependencies = {}, peerDependencies = {}, peerDependenciesMeta = {}, optionalDependencies = {}, devDependencies = {} } = {} } = current;

            if (seen.has(file)) return [];

            retain(seen, file);
            append(packages, describe(current));
            const selected = { ...dependencies, ...peerDependencies, ...(includeDevelopment && file === rootFile ? devDependencies : {}), ...optionalDependencies };

            return Object.entries(selected).flatMap(([name = '', range = ''] = []) => {
                const { [name]: { optional: optionalPeer = false } = {} } = peerDependenciesMeta;
                const optional = Object.hasOwn(optionalDependencies, name) || optionalPeer;
                const resolved = installed(name, file);

                if (!resolved) {
                    append(missing, { from: file, name, range, optional });

                    return [];
                }

                const { file: target = '' } = resolved;

                append(edges, { from: file, name, to: target });

                return [resolved];
            });
        } });
        const ordered = {
            packages: packages.toSorted(({ file: left = '' } = {}, { file: right = '' } = {}) => left.localeCompare(right)),
            edges: edges.toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
            missing: missing.toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
        };

        return { ...ordered, sha256: hash(JSON.stringify(ordered)) };
    };
    const project = (directory) => {
        const locations = locationChain(directory);
        const manifestDirectory = locations.find(directory => Boolean(manifest(resolve(directory, 'package.json'))));
        const selected = manifestDirectory ? manifest(resolve(manifestDirectory, 'package.json')) : false;
        const lockDirectory = locations.find(directory => locks.some(name => Boolean(snapshot(resolve(directory, name)))));
        const lockfiles = lockDirectory ? locks.flatMap((name) => {
            const input = snapshot(resolve(lockDirectory, name));

            return input ? [input] : [];
        }) : [];
        const identity = {
            manifest: selected ? describe(selected) : false,
            lockfiles: lockfiles.map(({ file = '', sha256 = '' } = {}) => ({ file, sha256 })),
            dependencies: selected ? dependencies(selected, true) : { packages: [], edges: [], missing: [], sha256: hash('[]') }
        };

        return { ...identity, sha256: hash(JSON.stringify(identity)),
            scope: 'Nearest ancestor package manifest and lockfile directory; installed declared dependency closure, including root development dependencies. Missing packages are listed.' };
    };
    const problems = () => [...snapshots.values()].flatMap(({ file = '', sha256 = '' } = {}) => {
        const current = readAvailable(file);

        return !current || hash(current) !== sha256 ? [`Identity input changed during measurement: ${file}`] : [];
    });

    return { manifest, installed, dependencies, project, problems };
};
