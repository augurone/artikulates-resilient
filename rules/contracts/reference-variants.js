import { getObject, isObject } from '../support/object.js';

// Accessor-backed source/environment records retain their native reads. Checking
// descriptors does not invoke getters or turn changing evidence into a snapshot.
const hasAnalysisAccessors = (value) => {
    const ownAccessor = Object.values(Object.getOwnPropertyDescriptors(value))
        .some(({ get = false, set = false } = {}) => Boolean(get || set));

    if (ownAccessor) return true;

    const prototype = Object.getPrototypeOf(value);

    return prototype !== null && prototype !== Object.prototype && hasAnalysisAccessors(prototype);
};
const areReferenceMapsEqual = (left = {}, right = {}) => {
    const leftNames = Object.keys(left);
    const rightNames = Object.keys(right);

    return leftNames.length === rightNames.length && leftNames.every((name = '') => {
        const { [name]: leftValue = false } = left;
        const { [name]: rightValue = false } = right;

        return Object.is(leftValue, rightValue);
    });
};

// Live reference maps are intentional: selection reads both environments on
// every lookup. This is not the export cache's definitions-identity law.
const createReferenceVariantCache = (build, { fileScoped = false } = {}) => {
    let variants = new WeakMap();
    const get = ({ program = {}, fileName = '', externalDefinitions = {} } = {}) => {
        const input = { program, fileName, externalDefinitions };

        if (!isObject(program)) return build(input);

        const entries = variants.get(program) || [];
        const cached = entries.find(({ fileName: cachedFileName = '', external = {} } = {}) => (
            (!fileScoped || cachedFileName === fileName) && areReferenceMapsEqual(external, externalDefinitions)
        ));
        const { result: existing = false } = getObject(cached);

        if (existing) return existing;

        const result = build(input);
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Publish against captured entries: failed builds retry, outer reentry wins, and in-build reset retains prior variants.
        variants.set(program, [...entries, { fileName, external: externalDefinitions, result }]);

        return result;
    };
    const clear = () => {
        variants = new WeakMap();
    };

    return { get, clear };
};

export { areReferenceMapsEqual, createReferenceVariantCache, hasAnalysisAccessors };
