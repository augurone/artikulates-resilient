import { createOwner, unresolved } from 'eslint-plugin-resilient/agreement';

const reasons = new Map([
    ['unresolved-analysis', 'No supported value evidence'],
    ['unresolved-binding', 'No local value binding'],
    ['captured-value', 'Captured value requires invocation evidence'],
    ['unstable-binding', 'Mutable or uninitialized binding is outside value tracking'],
    ['parameter-input', 'Generic parameter has no supplied argument evidence'],
    ['destructured-binding', 'Destructured binding requires field evidence'],
    ['opaque-execution', 'Dynamic execution or parameter initialization prevents local inference'],
    ['unresolved-call', 'No supported direct local callable identity'],
    ['imported-result', 'Imported signature is known; dependency result execution is not established'],
    ['optional-call', 'Optional invocation is outside call evaluation'],
    ['spread-call', 'Spread arguments are outside call evaluation'],
    ['recursive-call', 'Recursive invocation requires a fixed point'],
    ['unsupported-compiler-execution', 'Invocation follows or contains syntax outside the bounded compiler acquisition'],
    ['unsupported-expression', 'Expression is outside value evaluation'],
    ['unsupported-statement', 'Statement is outside completion evaluation'],
    ['unresolved-settlement', 'Promise settlement or thenable adoption is not established'],
    ['generator-function', 'Generator completion is outside value evaluation'],
    ['opaque-catch', 'Caught execution failure has unknown completion'],
    ['unsupported-signature', 'Callable signature is outside argument agreement'],
    ['omitted-argument', 'Required argument was omitted']
]);

export const uncertainty = ({ code = 'unresolved-analysis', location = {} } = {}) => Object.freeze({
    code, reason: reasons.get(code) || reasons.get('unresolved-analysis'), location
});

export const unknownOwner = (options = {}) => createOwner({ evidence: unresolved(uncertainty(options)) });
