import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { isObject } from '../rules/support/object.js';

const defaultExtensions = ['.js', '.jsx', '.mjs', '.cjs'];

const getExistingFile = (fileName = '') => {
    try {
        return existsSync(fileName) && statSync(fileName).isFile() ? fileName : '';
    } catch {
        return '';
    }
};

const normalizeExtensions = (values = defaultExtensions) => {
    const extensions = Array.isArray(values) ? values : defaultExtensions;

    return extensions
        .filter(extension => typeof extension === 'string' && extension)
        .map(extension => extension.startsWith('.') ? extension : `.${extension}`);
};

const getFile = ({ base = '', extensions = defaultExtensions } = {}) => [
    base,
    ...extensions.map(extension => `${base}${extension}`),
    path.join(base, 'index.js')
].map(getExistingFile).find(Boolean) || '';

const normalizeNames = (values = []) => (
    Array.isArray(values)
        ? values
            .filter(value => typeof value === 'string' && value)
            .map(value => path.basename(value, path.extname(value)))
        : []
);

const normalizeAliases = (aliases = {}) => Object.entries(isObject(aliases) ? aliases : {})
    .filter(([, target = '']) => typeof target === 'string' && target)
    .map(([alias = '', target = '']) => [alias.replace(/\/+$/, ''), target])
    .filter(([alias = '']) => alias)
    .sort(([left = ''], [right = '']) => right.length - left.length);

const getAliasBase = ({ source = '', aliases = [], projectDirectory = '' } = {}) => {
    const [alias = '', target = ''] = aliases.find(([name = '']) => (
        source === name || source.startsWith(`${name}/`)
    )) || [];

    if (!alias) return '';

    const suffix = source.slice(alias.length).replace(/^\/+/, '');

    return path.resolve(projectDirectory, target, suffix);
};

const getRootDirectory = ({ projectDirectory = '', root = '' } = {}) => (
    path.resolve(projectDirectory, root || '.')
);

const isWithin = ({ fileName = '', directory = '' } = {}) => {
    const prefix = `${directory}${path.sep}`;

    return fileName === directory || fileName.startsWith(prefix);
};

const createProjectAdapter = ({
    cwd = process.cwd(),
    aliases = {},
    extensions = defaultExtensions,
    root = '',
    entryFiles = ['index'],
    ancestorFiles = [],
    inferredFiles = []
} = {}) => {
    const projectDirectory = path.resolve(cwd);
    const fileExtensions = normalizeExtensions(extensions);
    const aliasEntries = normalizeAliases(aliases);
    const entryNames = normalizeNames(entryFiles);
    const ancestorNames = normalizeNames(ancestorFiles);
    const inferredNames = normalizeNames(inferredFiles);
    const configuredNames = [...ancestorNames, ...inferredNames];
    const rootDirectory = getRootDirectory({ projectDirectory, root });

    const resolver = ({ from = '', source = '' } = {}) => {
        if (!from || from.startsWith('<')) return '';

        const base = source.startsWith('.')
            ? path.resolve(path.dirname(from), source)
            : getAliasBase({
                source,
                aliases: aliasEntries,
                projectDirectory
            });

        return base ? getFile({ base, extensions: fileExtensions }) : '';
    };

    const roots = ({ fileName = '' } = {}) => {
        const normalizedFileName = path.resolve(fileName);
        const currentFile = path.basename(normalizedFileName, path.extname(normalizedFileName));

        if (!entryNames.includes(currentFile) || !isWithin({
            fileName: normalizedFileName,
            directory: rootDirectory
        })) return [];

        let roots = [];
        let directory = path.dirname(normalizedFileName);

        while (isWithin({ fileName: directory, directory: rootDirectory })) {
            const ancestorRoots = configuredNames
                .map(name => getFile({
                    base: path.join(directory, name),
                    extensions: fileExtensions
                }))
                .filter(file => file && file !== normalizedFileName && !roots.includes(file));

            roots = [...ancestorRoots, ...roots];

            if (directory === rootDirectory) break;

            directory = path.dirname(directory);
        }

        return roots;
    };

    return { resolver, roots };
};

export {
    createProjectAdapter,
    defaultExtensions,
    normalizeExtensions
};

export default createProjectAdapter;
