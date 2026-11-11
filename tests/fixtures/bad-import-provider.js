export const getTitle = ({ title = '' } = {}) => title;
export const getItems = ({ items = [] } = {}) => items;
export const getConfig = () => ({ items: [] });
export const getValue = () => 0;
export const makeItemsReader = () => {
    const readItems = ({ items = [] } = {}) => items;

    return readItems;
};
