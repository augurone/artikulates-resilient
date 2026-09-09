export const retainDeferredInput = input => {
    const { first = '' } = input;

    return () => {
        const { later = '' } = input;

        return [first, later];
    };
};

export const notifyWhenSupplied = ({ onDone } = {}) => {
    if (typeof onDone !== 'function') return;

    onDone();
};

export const suppliedItems = ({ items = [] } = {}) => items;
