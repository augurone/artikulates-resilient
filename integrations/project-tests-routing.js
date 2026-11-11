import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import typescript from 'typescript';

import { owningPackage } from './typescript-project-resolution.js';

const inside = (root = '', file = '') => file === root || file.startsWith(root + path.sep);
const physical = (name = '') => name.startsWith('file:') ? fileURLToPath(name) : name.split('?').at(0);
const esmPackage = (file) => {
    const { type = '' } = owningPackage(file);

    return type === 'module';
};
const candidates = (name = '') => [name, ...['.ts', '.tsx', '.js', '.jsx'].map(extension => name + extension),
    ...['.ts', '.js'].map(extension => path.join(name, 'index' + extension)), name.replace(/\.js$/u, '.ts')];

// Tests keep their executable behavior; project output layout does not constrain
// their native type erasure outside the application's rootDir.
export const testCompilerOptions = ({ options = {} } = {}) => {
    const layout = ['configFilePath', 'rootDir', 'rootDirs', 'outDir', 'outFile', 'noEmit', 'noEmitOnError',
        'declaration', 'declarationMap', 'sourceMap', 'inlineSourceMap', 'incremental', 'composite', 'tsBuildInfoFile'];

    return { ...Object.fromEntries(Object.entries(options).filter(([name = ''] = []) => !layout.includes(name))),
        module: typescript.ModuleKind.ESNext,
        moduleResolution: typescript.ModuleResolutionKind.Bundler };
};

// Routing changes module selection, never test bytes or emitted bytes. Both hosts
// use this owner so their guards apply to the same original/variant identities.
export const createProjectTestRouting = ({ projectRoot = '', artifactRoot = '', observeHelpers = true, compilerOptions = {}, outputs = [], ownedSources = [],
    testDirectories = [], roots = [], trace = '' } = {}) => {
    const bySource = new Map(outputs.map((row) => { const { source = '' } = row;

        return [source, row]; }));
    const byOutput = new Map(outputs.map((row) => { const { file = '' } = row;

        return [file, row]; }));
    const owned = new Set(ownedSources);
    const resolutions = new Map();
    const original = (file) => {
        const row = byOutput.get(physical(file));

        if (!row) return physical(file);

        const { source = '' } = row;

        return source;
    };
    const guard = (name = '') => {
        const file = physical(name);
        const row = byOutput.get(file);

        if (row) return file;

        if (roots.some(root => inside(root, file))) throw new Error(`Wrong or unmapped JavaScript variant loaded: ${file}`);

        const local = inside(projectRoot, file) && !inside(artifactRoot, file) && !file.includes(`${path.sep}node_modules${path.sep}`);

        if (local && /\.[cm][jt]sx?$/u.test(file)) throw new Error(`Project proofs require ESM .js/.jsx or .ts/.tsx modules: ${file}`);

        if (local && /\.[jt]sx?$/u.test(file) && !esmPackage(file)) throw new Error(`Project proofs require type: module package scopes: ${file}`);

        if (owned.has(file) || inside(projectRoot, file) && /\.tsx?$/u.test(file) &&
            !file.includes(`${path.sep}node_modules${path.sep}`) && !testDirectories.some(root => inside(root, file))) {
            throw new Error(`Original or un-emitted owned source loaded: ${file}`);
        }

        return file;
    };
    const route = (specifier = '', importer = '') => {
        const parent = original(importer);
        const key = JSON.stringify([parent, specifier]);

        if (resolutions.has(key)) return resolutions.get(key);

        const relative = specifier.startsWith('.') || path.isAbsolute(specifier) || specifier.startsWith('file:');
        let candidate = relative ? path.resolve(path.dirname(physical(importer)), specifier) : '';

        if (specifier.startsWith('file:')) candidate = physical(specifier);

        const output = candidate ? candidates(candidate).find(file => byOutput.has(file)) : '';

        if (output) return output;

        const { resolvedModule = {} } = typescript.resolveModuleName(specifier, parent, compilerOptions, typescript.sys);
        const { resolvedFileName = '' } = resolvedModule ?? {};
        const sourceCandidate = relative ? path.resolve(path.dirname(parent), physical(specifier)) : '';
        let source = bySource.has(resolvedFileName) ? resolvedFileName : '';

        if (!source && sourceCandidate) source = candidates(sourceCandidate).find(file => bySource.has(file)) || '';

        const { file: result = '' } = bySource.get(source) ?? {};

        if (!result && resolvedFileName && owned.has(resolvedFileName)) guard(resolvedFileName);

        if (!result && candidate) guard(candidate);

        // eslint-disable-next-line resilient/prefer-safe-transformations -- A private per-host resolution index shares completed path decisions without changing source or module records.
        resolutions.set(key, result);

        return result;
    };
    const loaded = (name = '') => {
        const file = guard(name);
        const row = byOutput.get(file);

        if (row) {
            const { source = '' } = row;
            appendFileSync(trace, `${JSON.stringify({ kind: 'artifact', source, file })}\n`);
        }

        if (observeHelpers && !row && inside(projectRoot, file) && !inside(artifactRoot, file) &&
            !file.includes(`${path.sep}node_modules${path.sep}`) && /\.[jt]sx?$/u.test(file)) {
            const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
            appendFileSync(trace, `${JSON.stringify({ kind: 'test', file, sha256 })}\n`);
        }

        return file;
    };

    return { route, guard, loaded, original };
};
