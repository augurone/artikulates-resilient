import { isObject } from '../support/object.js';

const createProgramMetadataCache = (read) => {
    let entries = new WeakMap();
    const get = (program = {}) => {
        const cached = isObject(program) ? entries.get(program) : [];

        if (isObject(program) && Array.isArray(cached)) return cached;

        const result = read(program);

        if (isObject(program)) {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private resettable WeakMap retains AST identity; failed reads are not cached and inputs stay untouched.
            entries.set(program, result);
        }

        return result;
    };
    const clear = () => {
        entries = new WeakMap();
    };

    return { get, clear };
};

export { createProgramMetadataCache };
