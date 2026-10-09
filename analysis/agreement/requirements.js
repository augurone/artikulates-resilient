import { put } from './collections.js';
import { families } from './families.js';

// Consumer obligations. Constructors declare requirements; they never establish evidence.
const descriptions = new WeakMap();

const register = (description) => {
    const requirement = Object.freeze({ ...description });

    put(descriptions, requirement, requirement);

    return requirement;
};

export const family = ({ name = '' } = {}) => {
    if (!families.includes(name)) throw new TypeError('Unsupported family requirement');

    return register({ kind: 'family', name });
};

const familyRequirements = new Map(families.map(name => [name, family({ name })]));

export const describe = (requirement) => {
    if (typeof requirement === 'string' && familyRequirements.has(requirement)) return familyRequirements.get(requirement);

    if (!descriptions.has(requirement)) throw new TypeError('Expected a supported requirement');

    return descriptions.get(requirement);
};

export const content = ({ family: name = '' } = {}) => {
    if (!['string', 'array', 'object'].includes(name)) throw new TypeError('Content requires string, array, or object explicitly');

    return register({ kind: 'content', name });
};

export const all = ({ requirements = [] } = {}) => {
    if (!Array.isArray(requirements)) throw new TypeError('Expected a requirement list');

    // Every supplied slot is mandatory, including holes in sparse input.
    return register({ kind: 'all', requirements: Object.freeze(Array.from(requirements, describe)) });
};

export const field = ({ name = false, required = false, optional = false } = {}) => {
    if (typeof name !== 'string') throw new TypeError('Expected an own enumerable field name');

    if (typeof optional !== 'boolean') throw new TypeError('Expected a boolean field absence policy');

    return register({ kind: 'field', name, required: describe(required), optional });
};

// S-04: these are receiver-family obligations, not proofs about arguments,
// prototype integrity, return values, effects, or successful invocation.
const receiverFamilies = Object.freeze({
    trim: 'string', toLowerCase: 'string', toUpperCase: 'string', replaceAll: 'string',
    map: 'array', filter: 'array', reduce: 'array', some: 'array', find: 'array', forEach: 'array',
    test: 'regexp', call: 'function'
});

export const receiver = ({ operation = '' } = {}) => {
    if (typeof operation !== 'string' || !Object.hasOwn(receiverFamilies, operation)) throw new TypeError('Unsupported receiver operation');

    const { [operation]: name = '' } = receiverFamilies;

    return register({ kind: 'family', name, operation });
};

// These combine mandatory obligations. They do not create permissive value unions.
export const conjunction = (outcomes) => {
    if (outcomes.includes('contradiction')) return 'contradiction';

    if (outcomes.includes('unknown')) return 'unknown';

    return 'agreement';
};

export const familyOutcome = ({ families: known = [], incomplete = false } = {}, name) => {
    if (known.some(actual => actual !== name)) return 'contradiction';

    if (incomplete || !known.length) return 'unknown';

    return 'agreement';
};
