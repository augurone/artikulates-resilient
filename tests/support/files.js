import { readdirSync } from 'node:fs';

// Architecture checks enumerate every implementation module, including modules
// extracted behind a public facade.
export const sourceFiles = ({ directory = new URL('../../analysis/', import.meta.url), prefix = '', exclude = [] } = {}) => {
    return readdirSync(directory, { withFileTypes: true }).map(entry => ({
        entry, directory: entry.isDirectory(), file: entry.isFile()
    })).flatMap(({ entry: { name: entryName = '' } = {}, directory: isDirectory = false, file: isFile = false } = {}) => {
        const name = `${prefix}${entryName}`;

        if (exclude.includes(name)) return [];

        if (isDirectory) return sourceFiles({ directory: new URL(`${entryName}/`, directory), prefix: `${name}/`, exclude });

        if (!isFile || !entryName.endsWith('.js')) return [];

        return [{ name, url: new URL(entryName, directory).href }];
    }).toSorted(({ name: left = '' } = {}, { name: right = '' } = {}) => left.localeCompare(right));
};
