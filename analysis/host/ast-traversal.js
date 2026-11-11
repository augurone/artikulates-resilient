import { VisitorKeys } from 'espree';

// Parser preorder is part of exception containment, including equal-range nodes.
export const getSourceNodes = (ast = {}) => {
    const pending = [ast];
    const nodes = [];

    // eslint-disable-next-line resilient/prefer-prototype-methods -- The frontier follows parser-selected children without recursive stack growth.
    while (pending.length) {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Consume only this private traversal frontier.
        const node = pending.pop();
        const { type = '', range = [] } = node;
        const { [type]: keys = [] } = VisitorKeys;

        if (type && range.length === 2) {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- Collect parser identities in the private audit inventory without changing nodes.
            nodes.push(node);
        }

        keys.flatMap((key) => {
            const { [key]: value = false } = node;

            if (Array.isArray(value)) return value.filter(Boolean);

            return value ? [value] : [];
        }).toReversed().forEach((child) => {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- Append discovered syntax to the private frontier in reverse preorder.
            pending.push(child);
        });
    }

    return nodes;
};
