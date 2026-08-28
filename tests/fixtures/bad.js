// Intentionally invalid examples for every resilient rule.
// The aggregate package lint excludes this fixture. Lint this file directly
// when you want to see the diagnostics for each rejected pattern.

import {
    getConfig,
    getItems,
    getTitle
} from './bad-import-provider.js';

const process = () => {};
const request = () => Promise.resolve();
const cleanup = () => {};
const report = () => {};

// no-destructuring-fallback
{
    const data = {};
    const { items = [] } = data || {};

    void items;
}

// no-else
{
    const choose = (value) => {
        if (value) return value;
        else return '';
    };

    const chooseWithElseIf = (value, fallback) => {
        if (value) return value;

        else if (fallback) return fallback;

        return '';
    };

    void [choose, chooseWithElseIf];
}

// no-length-comparison
{
    const empty = items => items.length === 0;
    const emptyReversed = items => 0 === items.length;
    const nonEmpty = items => items.length !== 0;
    const nonEmptyReversed = items => 0 !== items.length;

    void [empty, emptyReversed, nonEmpty, nonEmptyReversed];
}

// no-null-assignment
{
    const explicitNull = () => {
        const value = null;
        let result = '';
        result = null;

        return value || result;
    };

    void explicitNull;
}

// no-undefined-assignment
{
    const explicitUndefined = () => {
        const value = undefined;
        let result = '';
        result = undefined;

        return value || result;
    };

    void explicitUndefined;
}

// prefer-safe-transformations
{
    // Prefer:
    // const update = (
    //     { count = 0, ...state } = {},
    //     { value = '' } = {}
    // ) => ({
    //     ...state,
    //     count: count + 1,
    //     value
    // });

    // Banned: mutate the input directly.
    const updateInput = (value) => {
        value.enabled = true;
        value.items.push(true);

        return value;
    };

    const moduleCache = {};
    moduleCache.value = true;

    updateInput(moduleCache);

    // Banned: mutate a copied temporary instead of returning the transformation.
    const updateReducer = (
        { count = 0, ...state } = {},
        { value = '' } = {}
    ) => {
        const next = { ...state, count };
        next.count += 1;
        next.value = value;

        return next;
    };

    // Banned: mutate an accumulator owned across a callback boundary.
    const collect = (items = []) => {
        const result = [];

        items.forEach(({ enabled = false } = {}) => {
            if (enabled) result.push(true);
        });

        return result;
    };

    // Prefer: items.filter(({ enabled = false } = {}) => enabled)
    const updateResponse = async (resp) => {
        const response = await resp.json();
        response.fields.red = 'blue';

        return response;
    };

    void [updateReducer, collect, updateResponse];

}

// no-silent-catch
{
    try {
        process();
    } catch (error) {}

    try {
        process();
    } catch {}

    try {
        process();
    } catch (error) {;
    }

    try {
        process();
    } catch (error) {
        // The comment does not handle or explain the failure.
    }
}

// no-unhandled-promise-chain
{
    request().then(process);
    request().then(process).finally(cleanup);
}

// prefer-async-await
{
    request().then(process).catch(report);
}

// no-undefined-comparison
{
    const isMissing = value => value === undefined;
    const isPresent = value => typeof value !== 'undefined';

    void [isMissing, isPresent];
}

// no-nested-if
{
    const getContent = (isReady, hasContent, content) => {
        if (isReady) {
            if (hasContent) return content;
        }

        return '';
    };

    void getContent;
}

// prefer-destructured-member-access
{
    const getName = user => user.name;
    const getIdentity = user => `${user.id}:${user.name}`;

    void [getName, getIdentity];
}

// prefer-falsey-returns
{
    const getValue = () => null;
    const getItems = (found, items = []) => found ? items : undefined;
    const getUser = (id, users = {}) => users[id] || null;

    void [getValue, getItems, getUser];
}

// prefer-prototype-methods
{
    const items = [];
    const values = {};

    const enabled = [];
    for (const item of items) {
        if (item.enabled) enabled.push(item);
    }

    // A switch-local break does not exempt the surrounding loop. The
    // mutation remains owned by prefer-prototype-methods, so it should not
    // produce a duplicate prefer-safe-transformations diagnostic.
    for (const item of items) {
        switch (item.kind) {
            case 'done':
                break;
            default:
                enabled.push(item);
        }
    }

    for (let index = 0; index < items.length; index += 1) {
        process(items[index]);
    }

    for (const key in values) {
        process(values[key]);
    }

    while (items.length) items.pop();

    do {
        process(items.pop());
    } while (items.length);

    void enabled;
}

// prefer-safe-destructuring-defaults
{
    const getConfig = ({ config: { name } = {} } = {}) => name;
    const getValue = ({ value } = {}) => value;
    const getFirst = ([item] = []) => item;

    void [getConfig, getValue, getFirst];
}

// signature-contract-destructuring
{
    const getValue = ({ value = [] } = {}) => {
        if (!Array.isArray(value)) return {};

        const { attr = '' } = value;

        return attr;
    };

    void getValue;
}

// prefer-signature-destructuring
{
    const processUser = (user) => {
        const { name, age } = user;

        return `${name} (${age})`;
    };

    const getItems = (response) => {
        const {
            data: {
                items = []
            } = {}
        } = response;

        return items;
    };

    const getName = (user) => {
        const { name = '' } = user;

        return `${user.id}:${name}`;
    };

    void [processUser, getItems, getName];
}

// signature-contract-call-site
{
    const render = ({ title = '' } = {}) => title.trim();
    render({ title: 42 });

    const getCount = (title = '', count = 0) => title ? count : 0;
    getCount('', 'count');

    getTitle({ title: 42 });

    const getName = ({
        config: {
            name = ''
        } = {}
    } = {}) => name;

    getName({ config: { name: null } });

    // A deeply destructured signature is an inline schema. Every nested
    // property remains falsifiable at the call boundary.
    const renderPage = ({
        page: {
            title = '',
            items = []
        } = {}
    } = {}) => ({ title, items });
    renderPage({ page: { title: 42, items: '' } });

    // The transform argument must agree with the callback contract too.
    const apply = (callback, value) => callback(value);
    const readTitle = ({ title = '' } = {}) => title;
    apply(readTitle, { title: 42 });

    void [renderPage, apply, readTitle];
}

// signature-contract-operation
{
    const inspectItems = ({ items = [] } = {}) => items.toUpperCase();
    const inspectTitle = ({ title = '' } = {}) => title.map(Boolean);

    void [inspectItems, inspectTitle];

    getItems({}).toUpperCase();
    getConfig().items.toUpperCase();

    const inspectMapped = () => {
        const mapped = ['ready'].map(item => item.toUpperCase());
        return mapped.toUpperCase();
    };

    // A known async callee still carries its return contract through await.
    const loadPage = async () => ({ items: [] });
    const inspectLoaded = async () => {
        const page = await loadPage();
        return page.items.toUpperCase();
    };

    // Array transforms derive their result from the callback return contract.
    const normalizeTitle = ({ title = '' } = {}) => title.trim();
    const inspectTitles = () => {
        const titles = [{ title: 'ready' }].map(normalizeTitle);
        return titles.toUpperCase();
    };

    void [inspectMapped, loadPage, inspectLoaded, normalizeTitle, inspectTitles];
}

// signature-contract-return-consistency
{
    const getValue = (enabled) => {
        if (enabled) return [];

        return '';
    };

    // Normalization must converge on one reliable return family. A branch
    // that leaks the pre-normalized family is a contract disagreement.
    const normalizeItems = (value) => {
        if (Array.isArray(value)) return value;

        return '';
    };

    // Mixed known return families are a contradiction, not an inferred union.
    const getNullableValue = (enabled = false) => enabled ? '' : null;

    void [getValue, normalizeItems, getNullableValue];
}

// combined-patterns
// Existing examples that combine the signature, default, and member-access
// rules. The whole-object forwarding case is intentionally allowed by
// prefer-signature-destructuring, but the other examples remain violations.
{
    const processLinkedEntry = async () => ({});
    const environment = {};
    const cdaClient = {};
    const cloneEntry = () => {};
    const depth = 0;

    const moved = (user) => {
        const { name = '' } = user;

        return name;
    };

    const sendUser = user => user;

    const forwarded = (user) => {
        const { name = '' } = user;

        sendUser(user);

        return name;
    };

    const memberRead = (user) => {
        const { name = '' } = user;

        return `${user.id}:${name}`;
    };

    const processNode = async (node) => {
        const {
            nodeType = '',
            content: nodeContent
        } = node;
        const isEmbedded = nodeType === 'embedded-entry-block' || nodeType === 'embedded-entry-inline';
        const { data: { target: { sys: { id: entryId = '' } = {} } = {} } = {} } = isEmbedded ? node : {};

        // Clone embedded entry blocks and inline entries
        if (isEmbedded && !entryId) return node;

        if (isEmbedded && entryId) {
            // Clone the embedded entry
            const clonedLink = await processLinkedEntry(entryId, environment, cdaClient, cloneEntry, depth, 'clone');

            return {
                ...node,
                data: {
                    target: clonedLink
                }
            };
        }

        // Recursively process child content if it exists
        if (nodeContent && Array.isArray(nodeContent)) {
            const { attr = '' } = nodeContent;
            
            return {
                attr,
                ...node,
                content: await Promise.all(nodeContent.map(processNode))
            };
        }

        // Everything else stays as-is
        return node;
    };

    void [moved, forwarded, memberRead, processNode];
}
