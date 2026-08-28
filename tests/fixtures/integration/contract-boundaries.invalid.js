import { loadItems, normalizePage } from './contract-barrel.js';

const renderTitle = ({ title = '' } = {}) => title.trim();
const page = normalizePage({ title: 42, items: '' });

// The imported return contract must survive the barrel and become a call-site
// contract when the normalized object crosses another callee.
renderTitle(page);

// The same imported return contract must govern member operations, including
// a value retained by a top-level declaration.
page.items.toUpperCase();

// Destructuring a returned object must preserve the returned property
// contract; a local string default must not hide the array-like value.
const { items = '' } = normalizePage({ title: 42, items: '' });
items.toUpperCase();

// A direct returned-member operation remains visible at the callee boundary.
normalizePage({}).items.toUpperCase();

const inspectLoaded = async () => {
    const items = await loadItems({});

    return items.toUpperCase();
};

const readTitle = ({ title = '' } = {}) => title;
const readMappedTitles = () => [{ title: 42 }].map(readTitle);

void [inspectLoaded, readMappedTitles];
