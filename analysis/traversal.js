import { append, takeLast } from './collections.js';

// Syntax, scope and evidence walks use a bounded JavaScript call stack.
// The callbacks return newly discovered work, never mutate the input tree.
const childrenFrom = ({ enter } = {}, value) => {
    if (typeof enter !== 'function') throw new TypeError('Expected a traversal entry callback');

    return enter(value);
};

const finish = ({ leave } = {}, value) => {
    if (typeof leave !== 'function') return;

    leave(value);
};

export const traverse = (root, visitors) => {
    const pending = [{ value: root, exiting: false }];

    // eslint-disable-next-line resilient/prefer-prototype-methods -- Entries discover their children dynamically; an explicit frontier avoids recursive calls at arbitrary source or scope depth.
    while (pending.length) {
        const { value = false, exiting = false } = takeLast(pending);

        if (exiting) {
            finish(visitors, value);

            continue;
        }

        const children = childrenFrom(visitors, value);

        if (Object.hasOwn(visitors, 'leave')) append(pending, { value, exiting: true });

        children.toReversed().forEach(child => append(pending, { value: child, exiting: false }));
    }
};
