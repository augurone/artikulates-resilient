import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
    PROGRAM_CACHE_LIMIT,
    clearProgramCache,
    getCachedProgram,
    getProgramCacheSize
} from '../rules/contracts/program-cache.js';

const directory = await mkdtemp(path.join(process.cwd(), '.resilient-program-cache-'));
const fileNames = Array.from(
    { length: PROGRAM_CACHE_LIMIT + 1 },
    (_, index) => path.join(directory, `module-${index}.js`)
);

try {
    await Promise.all(fileNames.map(fileName => writeFile(fileName, 'export const value = 1;')));
    clearProgramCache();

    const getProgram = (fileName = '') => getCachedProgram({
        fileName,
        load: () => ({ type: 'Program', fileName })
    });
    const firstProgram = getProgram(fileNames[0]);
    const secondProgram = getProgram(fileNames[1]);
    fileNames.slice(2, PROGRAM_CACHE_LIMIT).forEach(getProgram);
    assert.equal(getProgramCacheSize(), PROGRAM_CACHE_LIMIT);

    assert.equal(getProgram(fileNames[0]), firstProgram);
    getProgram(fileNames[PROGRAM_CACHE_LIMIT]);
    assert.notEqual(getProgram(fileNames[1]), secondProgram);
    assert.equal(getProgramCacheSize(), PROGRAM_CACHE_LIMIT);
} finally {
    clearProgramCache();
    await rm(directory, { recursive: true, force: true });
}
