import { hasArrayContent, isArray } from '../../rules/support/array.js';
import { isFunction } from '../../rules/support/function.js';
import { hasContent, isObject } from '../../rules/support/object.js';

// A value-level emptiness test. It deliberately does not replace an
// expected-family capability check: `isEmpty(1)` is false, while `1` still
// fails an `isFunction` agreement.
const isEmpty = (value) => {
    if (isObject(value)) return !hasContent(value);

    if (isArray(value)) return !hasArrayContent(value);

    if (isFunction(value)) return false;

    return !value;
};

export { isEmpty };
