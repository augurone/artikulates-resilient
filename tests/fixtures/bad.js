// Intentionally invalid examples for every resilient rule.
// The aggregate package lint excludes this fixture. Lint this file directly
// when you want to see the diagnostics for each rejected pattern.
//
// The sections are graded. The atomic tier rejects single tokens, the
// control-flow tier rejects shapes, the effect tier rejects ownership, and
// the agreement tiers reject programs whose parts each read reasonably but
// cannot hold one contract together.

import {
    getConfig,
    getItems,
    getTitle
} from './bad-import-provider.js';

const process = () => {};
const request = () => Promise.resolve();
const cleanup = () => {};
const report = () => {};

// tier-one-atomic-grammar
// A single token decides whether a value can still be operated on.

// no-null-assignment
{
    const explicitNull = () => {
        const value = null;
        let result = '';
        result = null;

        return value || result;
    };

    // The sentinel is still assigned when a shape carries it.
    const state = { cursor: null, page: { next: null } };

    // A branch, a chain, and a sequence are all assignment positions.
    const pickCursor = (enabled = false) => {
        const chosen = enabled ? '' : null;
        const cached = chosen || null;
        let current = '';

        current = (report(), null);

        return [chosen, cached, current];
    };

    // A collection slot owns the same contract as a named binding.
    const slots = ['', null];

    void [explicitNull, state, pickCursor, slots];
}

// no-undefined-assignment
{
    const explicitUndefined = () => {
        const value = undefined;
        let result = '';
        result = undefined;

        return value || result;
    };

    // Clearing a field is the same assignment as declaring one.
    const clearDraft = (draft = {}) => {
        draft.title = undefined;

        return draft;
    };

    // An accumulator reset inside a callback assigns absence on every pass.
    const resetSlots = (slots = []) => {
        let current = '';

        slots.forEach(() => {
            current = undefined;
        });

        return current;
    };

    void [explicitUndefined, clearDraft, resetSlots];
}

// no-undefined-comparison
{
    const isMissing = value => value === undefined;
    const isPresent = value => typeof value !== 'undefined';

    // Reversed operands and a comparison buried in a collection callback are
    // the same sentinel test.
    const isAbsent = value => undefined === value;
    const definedItems = (items = []) => items.filter(item => item !== undefined);

    void [isMissing, isPresent, isAbsent, definedItems];
}

// no-destructuring-fallback
{
    const data = {};
    const { items = [] } = data || {};

    // The fallback also hides behind a nested pattern and a call expression.
    const response = {};
    const { data: { records = [] } = {} } = response || getConfig();

    void [items, records];
}

// no-length-comparison
{
    const empty = items => items.length === 0;
    const emptyReversed = items => 0 === items.length;
    const nonEmpty = items => items.length !== 0;
    const nonEmptyReversed = items => 0 !== items.length;

    // Relational presence checks are the same cardinality mistake.
    const hasItems = items => items.length > 0;
    const hasItemsReversed = items => 0 < items.length;

    // The comparison stays wrong when it guards a branch or a loop.
    const firstTitle = ({ items = [] } = {}) => items.length > 0 ? items[0] : '';
    const describe = ({ items = [] } = {}) => (items.length !== 0 ? 'full' : 'empty');

    void [empty, emptyReversed, nonEmpty, nonEmptyReversed, hasItems,
        hasItemsReversed, firstTitle, describe];
}

// tier-two-control-flow
// A second owner of the same result is a shape problem, not a style problem.

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

    // An else block that reassigns a mutable result splits ownership of it.
    const label = (status = '') => {
        let text = '';

        if (status) {
            text = status;
        } else {
            text = 'unknown';
        }

        return text;
    };

    // A ternary alternate that is itself a ternary is an inline else chain.
    const rank = (score = 0) => (score > 2 ? 'high' : score > 1 ? 'mid' : 'low');

    void [choose, chooseWithElseIf, label, rank];
}

// no-nested-if
{
    const getContent = (isReady, hasContent, content) => {
        if (isReady) {
            if (hasContent) return content;
        }

        return '';
    };

    // Three levels of depth hide three separate unproven assumptions.
    const resolveContent = (isReady, hasContent, isVisible, content) => {
        if (isReady) {
            if (hasContent) {
                if (isVisible) return content;
            }
        }

        return '';
    };

    // Depth is still depth when the inner test sits inside a loop.
    const firstEnabled = (items = []) => {
        if (items.length) {
            for (const item of items) {
                if (item) return item;
            }
        }

        return '';
    };

    void [getContent, resolveContent, firstEnabled];
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

    // A manual reduction and a labeled traversal are the same hand-rolled
    // collection method.
    let total = 0;
    for (const item of items) total += item.count;

    outer:
    for (const item of items) {
        for (const key in values) {
            if (!item) continue outer;

            process(values[key]);
        }
    }

    void [enabled, total];
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

    // A handled outer catch does not give the inner failure an owner.
    try {
        try {
            process();
        } catch (inner) {}
    } catch (outer) {
        report(outer);
    }
}

// tier-three-effects-and-results
// Transformation, absence, and asynchrony each need a visible owner.

// prefer-falsey-returns
{
    const getValue = () => null;
    const getItems = (found, items = []) => found ? items : undefined;
    const getUser = (id, users = {}) => users[id] || null;

    // Absence returned through await, through a sequence, and through void
    // is still absence handed to the caller.
    const loadUser = async (id, users = {}) => {
        const found = await Promise.resolve(users[id]);

        return found || null;
    };

    const trackAndReturn = () => {
        return (report(), undefined);
    };

    const discard = () => void process();

    void [getValue, getItems, getUser, loadUser, trackAndReturn, discard];
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

    // Banned: an accumulator rewritten inside reduce. The seed is new, but
    // every step still edits the value the next step receives.
    const indexByIdentifier = (entries = []) => entries
        .reduce((accumulated, { id = '' } = {}) => {
            accumulated[id] = true;

            return accumulated;
        }, {});

    // Banned: remove a key from an object the caller still holds.
    const omitDraft = (page = {}) => {
        delete page.draft;

        return page;
    };

    void [updateReducer, collect, updateResponse, indexByIdentifier, omitDraft];

}

// no-unhandled-promise-chain
{
    request().then(process);
    request().then(process).finally(cleanup);

    // A known async callee dropped as a statement has no owner at all.
    const loadPage = async () => ({});
    loadPage();

    // Ownership does not travel into a callback body.
    [1, 2].forEach(() => {
        request().then(process);
    });
}

// prefer-async-await
{
    request().then(process).catch(report);

    // A handled outer chain that nests another chain compounds the ordering
    // it hides.
    const loadAll = () => request()
        .then(() => request().then(process))
        .catch(report);

    void loadAll;
}

// no-unguarded-callback-invocation
{
    const run = ({ onDone } = {}) => onDone();

    // Nesting the option does not establish the capability.
    const notify = ({ handlers: { onChange } = {} } = {}) => onChange('changed');

    // Truthiness proves presence, not callability.
    const complete = ({ onComplete } = {}) => {
        if (onComplete) return onComplete();

        return '';
    };

    // The guard must cover the callback that is actually invoked.
    const publish = ({ onPublish, onError } = {}) => {
        if (typeof onError === 'function') return onPublish();

        return '';
    };

    // A callback boundary does not inherit the guard either.
    const each = ({ onItem } = {}, items = []) => items.forEach(item => onItem(item));

    void [run, notify, complete, publish, each];
}

// tier-four-boundaries
// Where a contract is declared decides whether a caller can honour it.

// prefer-destructured-member-access
{
    const getName = user => user.name;
    const getIdentity = user => `${user.id}:${user.name}`;

    // Depth multiplies the number of reads the signature never promised.
    const getCity = user => user.profile.address.city;
    const getFirstTag = page => page.meta.tags[0].label;

    void [getName, getIdentity, getCity, getFirstTag];
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

    // A nested contract declared in the body is still a contract the caller
    // cannot read.
    const getSummary = (page) => {
        const { title = '', meta: { description = '' } = {} } = page;

        return `${title} ${description}`;
    };

    void [processUser, getItems, getName, getSummary];
}

// prefer-safe-destructuring-defaults
{
    const getConfig = ({ config: { name } = {} } = {}) => name;
    const getValue = ({ value } = {}) => value;
    const getFirst = ([item] = []) => item;

    // A rest sibling, an array hole, and a rename all keep the same omission.
    const getRest = ({ title, ...rest } = {}) => [title, rest];
    const getSecond = ([, second] = []) => second;
    const getRenamed = ({ title: heading } = {}) => heading;

    void [getConfig, getValue, getFirst, getRest, getSecond, getRenamed];
}

// signature-contract-destructuring
{
    const getValue = ({ value = [] } = {}) => {
        if (!Array.isArray(value)) return {};

        const { attr = '' } = value;

        return attr;
    };

    const getProfile = () => ({ profile: { name: '' } });
    const { profile: { nmae } } = getProfile();

    // A known list contract cannot be destructured as a record.
    const getFirstLabel = ({ items = [] } = {}) => {
        const { label = '' } = items;

        return label;
    };

    // A nested key the known shape never publishes stays unprovable.
    const getRecord = () => ({ record: { id: '' } });
    const { record: { ids } } = getRecord();

    void [getValue, nmae, getFirstLabel, ids];
}

// tier-five-agreement
// Every part below is locally plausible; together they contradict.

// signature-contract-property
{
    const knownUser = { name: '' };
    knownUser.nmae;

    const getUser = () => ({ name: '' });
    const user = getUser();
    user.nmae;
    getUser().nmae;

    // An alias and a nested read carry the same published shape.
    const page = { title: '', meta: { tags: [] } };
    const alias = page;
    alias.titel;
    page.meta.tasg;

    void [knownUser, user, alias];
}

// signature-contract-call-site
{
    const render = ({ title = '' } = {}) => title.trim();
    render({ title: 42 });

    const getCount = (title = '', count = 0) => title ? count : 0;
    getCount('', 'count');
    getCount('');
    getCount('', 0, true);

    render({ title: '', extra: true });
    const renderAlias = render;
    renderAlias({ title: false });

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

    // A collection method is a call site: the element family must satisfy
    // the callback signature.
    const readTitles = () => [42].map(readTitle);

    // A local callback boundary must invoke each known callback with the
    // payload its signature requires, including callbacks supplied inline or
    // as a member function.
    const publish = onPublished => onPublished('published');
    const formatPublication = (status, publishedAt) => `${status}:${publishedAt}`;
    publish(formatPublication);

    const publishWithTimestamp = onPublished => onPublished('published', 0);
    const storePublicationStatus = status => status;
    publishWithTimestamp(storePublicationStatus);

    const runWhenReady = onReady => onReady();
    runWhenReady(page => page.title);

    const pageHandlers = { render: page => page.title };
    runWhenReady(pageHandlers.render);

    const makeReader = () => (title = '') => title.trim();
    const reader = makeReader();
    reader(42);

    const functionApi = { read: (title = '') => title.trim() };
    functionApi.read(42);

    void [renderPage, apply, readTitle, readTitles, publish, formatPublication,
        publishWithTimestamp, storePublicationStatus, runWhenReady,
        pageHandlers, makeReader, reader, functionApi];
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

    // The non-null guard is valid; the fallback branch still carries null.
    const inspectNullable = (value = null) => {
        if (value !== null) return '';

        return value.toUpperCase();
    };

    const inspectConditional = (enabled = false) => (enabled ? [] : '').toUpperCase();
    const inspectLogical = (enabled = false) => (enabled && []).map(Boolean);
    const inspectMixedItems = () => ['ready', 42].map(item => item.toUpperCase());
    const getLocalItems = (page = { items: [] }) => {
        const { items = [] } = page;

        return items;
    };
    getLocalItems({}).toUpperCase();

    const getItemsAlias = getItems;
    getItemsAlias({}).toUpperCase();

    const getPage = () => ({ title: '' });
    getPage().title.map(Boolean);

    // Array transforms derive their result from the callback return contract.
    const normalizeTitle = ({ title = '' } = {}) => title.trim();
    const inspectTitles = () => {
        const titles = [{ title: 'ready' }].map(normalizeTitle);
        return titles.toUpperCase();
    };

    // A numeric and an object default publish families of their own.
    const inspectCount = ({ count = 0 } = {}) => count.trim();
    const inspectEntries = ({ entries = {} } = {}) => entries.map(Boolean);

    void [
        inspectMapped,
        loadPage,
        inspectLoaded,
        inspectNullable,
        inspectConditional,
        inspectLogical,
        normalizeTitle,
        inspectTitles,
        inspectMixedItems,
        inspectCount,
        inspectEntries,
        getItemsAlias,
        getPage
    ];
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

    const getAsyncValue = async (enabled = false) => {
        if (enabled) return [];

        return '';
    };

    // A throw is a failure path, so it does not reconcile the two normal
    // families that remain.
    const parseTitle = (value = '') => {
        if (!value) throw new Error('missing title');

        if (value === 'none') return 0;

        return value;
    };

    // Object and array are both containers and still not one contract.
    const getCollection = (enabled = false) => {
        if (enabled) return {};

        return [];
    };

    // A callable guard cannot waive a value-producing function's absence.
    const readGuarded = callback => {
        if (typeof callback !== 'function') return [].forEach(() => {});

        return '';
    };

    const readImplicit = enabled => {
        if (enabled) return '';
    };

    void [getValue, normalizeItems, getNullableValue, getAsyncValue,
        parseTitle, getCollection, readGuarded, readImplicit];
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

// A single boundary that defaults with a sentinel, swallows its failure,
// compares against absence, mutates the caller's collection, and then
// returns a family its own guard disproved.
{
    const loadPage = async (incoming) => {
        const { params } = incoming;
        const { id = '' } = params || {};
        let page = null;

        try {
            page = await incoming.fetchPage(id);
        } catch (error) {}

        if (page !== undefined) {
            if (page.items.length > 0) {
                page.items.sort();
            } else {
                page.items = null;
            }
        }

        return page ? page : undefined;
    };

    void loadPage;
}

// operator-linebreak
const brokenOperator = 1
    +
    2;
void brokenOperator;
