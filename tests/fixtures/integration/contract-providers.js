export const normalizePage = ({ title = '', items = [] } = {}) => ({
    title,
    items
});

export const loadItems = async ({ items = [] } = {}) => items;
