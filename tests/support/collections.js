// Developer-owned scratch stores. Never pass product records or parser nodes as
// mutation targets; callers own only counters, oracle models, and worklists.
export const put = (store, key, value) => {
    // eslint-disable-next-line resilient/prefer-safe-transformations -- Only private developer counters, identity indexes, and independent oracle records are changed.
    store.set(key, value);

    return value;
};

export const append = (items, ...values) => {
    // eslint-disable-next-line resilient/prefer-safe-transformations -- Append only to a privately owned developer worklist, never to parser or product data.
    items.push(...values);
};

export const takeLast = (items) => {
    // eslint-disable-next-line resilient/prefer-safe-transformations -- Removing the last private traversal entry keeps deep parser walks iterative and linear.
    return items.pop();
};
