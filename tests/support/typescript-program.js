import path from 'node:path';

import typescript from 'typescript';

// The large compiler suite retains programs for later assertions. Reuse only
// unchanged standard-library source files, as a compiler host may do between
// programs; each fixture keeps its own source files, checker and options.
// Storage follows distinct library/options pairs rather than fixture count.
const libraries = new Map();
const createFixtureProgram = (rootNames = [], options = {}) => {
    const host = typescript.createCompilerHost(options);
    const directory = path.dirname(typescript.getDefaultLibFilePath(options)) + path.sep;

    return typescript.createProgram(rootNames, options, {
        ...host,
        getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
            if (!fileName.startsWith(directory)) return host.getSourceFile(
                fileName, languageVersion, onError, shouldCreateNewSourceFile
            );

            const key = JSON.stringify([fileName, options, languageVersion]);

            if (!shouldCreateNewSourceFile && libraries.has(key)) return libraries.get(key);

            const source = host.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);

            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private cache shares unchanged library ASTs; fixture sources and checkers remain program-owned.
            if (source) libraries.set(key, source);

            return source;
        }
    });
};

export { createFixtureProgram };
