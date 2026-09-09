import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const readText = file => readFileSync(file, 'utf8');
const readJson = file => JSON.parse(readText(file));
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const hashFiles = (files = []) => Object.fromEntries([...new Set(files)].toSorted().map(file => [file, digest(file)]));
const verifyHashes = (hashes = {}) => Object.entries(hashes).forEach(([file = '', expected = '']) => {
    if (digest(file) !== expected) throw new Error(`Proof input/output changed: ${file}`);
});
const listFiles = (directory = '') => readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
        const { name = '', isDirectory = false, isFile = false } = entry;
        const file = path.join(directory, name);

        if (isDirectory.call(entry)) return listFiles(file);

        return isFile.call(entry) ? [file] : [];
    }).toSorted();

export { readText, readJson, digest, hashFiles, verifyHashes, listFiles };
