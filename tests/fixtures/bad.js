// Counterexamples grouped by the rule that owns the finding.
// These are mistakes an application author might make, not analyzer stress tests.
// Some examples also trigger related rules; the section names the main issue.
// Pending examples name an expected finding that the analyzer does not yet emit.
//
// The default npm run lint excludes fixtures. To inspect this file, run:
// npm run lint -- tests/fixtures/bad.js
// tests/rule-canary.test.js checks executable anchors, explanations and valid
// neighbors using rule-canary.json. Keep canary-case markers with their blocks.
// The commented field-directive example is also consumed by the compiler tests.
// void lists keep illustrative declarations visible to the unused-binding rule.

import {
    getConfig,
    getItems,
    getTitle,
    getValue as getProviderValue,
    makeItemsReader
} from './bad-import-provider.js';
import { normalizePage as normalizeImportedPage } from './integration/contract-barrel.js';

const process = () => {};
const request = () => Promise.resolve();
const cleanup = () => {};
const report = () => {};

// no-null-assignment
// Assigning null makes absence part of the binding or field contract.
{
    const createDraft = () => {
        const value = null;

        return { title: value };
    };
    const state = { cursor: null, page: { next: null } };
    const pickCursor = (enabled = false) => {
        const cursor = enabled ? 'next' : null;

        return cursor;
    };

    void [createDraft, state, pickCursor];
}

// no-undefined-assignment
// Clearing a field explicitly still assigns absence.
{
    const createDraft = () => {
        const value = undefined;

        return { title: value };
    };
    const clearDraft = (draft = {}) => {
        draft.title = undefined;

        return draft;
    };

    void [createDraft, clearDraft];
}

// no-undefined-comparison
{
    const isMissing = value => value === undefined;
    const isPresent = value => typeof value !== 'undefined';
    const definedItems = (items = []) => items.filter(item => item !== undefined);

    // Zero, false and empty text are valid payloads here. A truthiness rewrite
    // changes behavior; exact absence needs a reasoned local rule exception.
    const decodePayload = value => value === undefined ? 'missing' : value;
    const decodedPayloads = [0, false, ''].map(decodePayload);

    // typeof can inspect an undeclared global. Reading it directly can throw.
    const isOptionalBindingMissing = () => typeof optionalPayload === 'undefined';

    void [isMissing, isPresent, definedItems, decodePayload,
        decodedPayloads, isOptionalBindingMissing];
}

// no-destructuring-fallback
// Put the boundary/default in the signature instead of hiding it behind ||.
{
    const data = {};
    const { items = [] } = data || {};
    const response = {};
    const { data: { records = [] } = {} } = response || getConfig();

    void [items, records];
}

// canary-case: tuple-source-contract
{
    const first = (pair = []) => {
        const [value = ''] = pair || [];

        return value;
    };

    void first;
}

// canary-case: named-pattern-source-contract
{
    const defaults = { value: '' };
    const read = ({ value = '' } = defaults || {}) => value;

    void read;
}

// canary-case: assigned-pattern-source-contract
{
    const source = { value: '' };
    let value = '';

    ({ value = '' } = source || {});
    void value;
}

// A supplied contract stays at its owner: pair = [], a named object default,
// or an explicit guard before consumption. Ordinary || selection is permitted.
// Native nullable API results are normalized at their acquisition boundary;
// that does not validate arbitrary data or justify another consumer fallback.

// no-length-comparison
// Presence checks use length directly; exact cardinality checks remain useful.
{
    const empty = items => items.length === 0;
    const nonEmpty = items => items.length !== 0;
    const hasItems = items => items.length > 0;
    const firstTitle = ({ items = [] } = {}) => items.length > 0 ? items[0] : '';

    void [empty, nonEmpty, hasItems, firstTitle];
}

// canary-case: length-at-least-one
{
    const hasItems = (items = []) => items.length >= 1;

    void hasItems;
}

// canary-case: mirrored-length-at-most-zero
{
    const isEmpty = (items = []) => 0 >= items.length;

    void isEmpty;
}

// Native nonnegative counts: length < 1 and length <= 0 mean empty;
// length >= 1 means present. Mirrored 1 > length and 1 <= length agree.
// Preserve exact bounds: length === 1, length !== 1 and length <= 1.
// A custom length can be fractional or NaN; syntax alone permits no safe rewrite.

// no-else
// A guard gives the remaining path its own result without an else branch.
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

// no-nested-if
{
    const getContent = (isReady, hasContent, content) => {
        if (isReady) {
            if (hasContent) return content;
        }

        return '';
    };
    const firstEnabled = (items = []) => {
        if (items.length) {
            for (const item of items) {
                if (item) return item;
            }
        }

        return '';
    };

    void [getContent, firstEnabled];
}

// prefer-prototype-methods
// Use filter/map/reduce for collection work. A loop needs an exact exception
// when ordering, termination or another observable requirement requires it.
{
    const items = [];
    const enabled = [];
    for (const item of items) {
        if (item.enabled) enabled.push(item);
    }

    let total = 0;
    for (let index = 0; index < items.length; index += 1) {
        total += items[index].price;
    }

    void [enabled, total];
}

// no-silent-catch
// A comment or an outer handler does not handle the swallowed failure.
{
    try {
        process();
    } catch (error) {}

    try {
        process();
    } catch {
        // Ignore the failure.
    }

    try {
        try {
            process();
        } catch (inner) {}
    } catch (outer) {
        report(outer);
    }
}

// canary-case: silent-promise-catch
{
    Promise.resolve().catch(() => {});
}

// canary-case: silent-promise-rejection
{
    void Promise.resolve().then(value => value, () => {});
}

// The fulfillment argument of then is not a failure handler. Named or dynamic
// handlers, and positions shifted by spreads, supply no visible handler body.
// A written return stays explicit: () => { return; } is accepted here, while
// forbidden return expressions such as () => undefined belong to falsey returns.

// prefer-falsey-returns
// Normalize value-producing paths to the intended family's empty value.
// A bare return remains valid for a meaningful control/effect exit.
{
    const getValue = () => null;
    const getItems = (found, items = []) => found ? items : undefined;
    const getUser = (id, users = {}) => users[id] || null;
    const loadUser = async (id, users = {}) => {
        const found = await Promise.resolve(users[id]);

        return found || null;
    };

    void [getValue, getItems, getUser, loadUser];
}

// prefer-safe-transformations
// Return a new value instead of changing the caller's input or a working copy.
{
    const updateInput = (value) => {
        value.enabled = true;
        value.items.push(true);

        return value;
    };
    const updateReducer = ({ count = 0, ...state } = {}, { value = '' } = {}) => {
        const next = { ...state, count };
        next.count += 1;
        next.value = value;

        return next;
    };
    const indexByIdentifier = (entries = []) => entries
        .reduce((accumulated, { id = '' } = {}) => {
            accumulated[id] = true;

            return accumulated;
        }, {});
    const omitDraft = (page = {}) => {
        delete page.draft;

        return page;
    };

    // Valid neighbor: return the transformation directly.
    const update = ({ count = 0, ...state } = {}, { value = '' } = {}) => ({
        ...state, count: count + 1, value
    });

    void [updateInput, updateReducer, indexByIdentifier, omitDraft, update];
}

// no-unhandled-promise-chain
{
    request().then(process);
    request().then(process).finally(cleanup);

    // A known async call also needs completion/rejection ownership.
    const loadPage = async () => ({});
    loadPage();

    [1, 2].forEach(() => {
        request().then(process);
    });
}

// Selection does not own the selected call. A literal dead arm creates no work;
// assignment, await, catch and void retain their own branch's ownership.
// canary-case: dropped-conditional-promise
{
    const loadCount = async () => 1;
    const refresh = (enabled = false) => {
        enabled ? loadCount() : 0;
    };

    void refresh;
}

// canary-case: dropped-logical-promise
{
    const loadCount = async () => 1;
    const refresh = (enabled = false) => {
        enabled && loadCount();
    };

    void refresh;
}

// A retained map/flatMap result can carry promise work without being a promise.
// Empty inputs create none; unknown callees remain handoffs. An assigned,
// returned, awaited or explicitly detached collection retains visible ownership.
// Reusing an owned promise creates no new obligation:
// const pending = loadCount(); [pending].map(value => value); return pending;
// A named callback that calls loadCount still creates fresh work, even when its
// declaration sits outside the discarded map expression. Binding that new work
// inside the callback before returning it does not give the caller's result an owner.
// canary-case: dropped-mapped-promises
{
    const loadCount = async () => 1;
    const refresh = (enabled = false) => {
        if (!enabled) return;

        [1, 2].map(() => loadCount());
    };

    void refresh;
}

// prefer-async-await
// Handling rejection does not make a chain the preferred async spelling.
{
    request().then(process).catch(report);
    const loadAll = () => request()
        .then(() => request().then(process))
        .catch(report);

    void loadAll;
}

// no-unguarded-callback-invocation
{
    const run = ({ onDone } = {}) => onDone();
    const notify = ({ handlers: { onChange } = {} } = {}) => onChange('changed');

    // Truthiness proves presence, not callability.
    const complete = ({ onComplete } = {}) => {
        if (onComplete) return onComplete();

        return '';
    };

    // Guard the callback that is actually invoked.
    const publish = ({ onPublish, onError } = {}) => {
        if (typeof onError === 'function') return onPublish();

        return '';
    };
    const each = ({ onItem } = {}, items = []) => items.forEach(item => onItem(item));

    // Valid neighbor: every invocation is covered by a callable guard.
    const guarded = ({ onDone } = {}) => {
        if (typeof onDone !== 'function') return;

        onDone();
    };

    void [run, notify, complete, publish, each, guarded];
}

// prefer-destructured-member-access
// Generated native-call exceptions retain the same statement owner with one
// short rule explanation or a long explanation combining several rules. The
// directive suite compares those forms together across direct/nested calls and
// single/multiline initializers, retaining token identity, sibling findings,
// deduplication, unused-directive and max-len ownership checks. Independent
// rule-count/reason-width spelling cross-products do not add another contract.
// Expose the fields the function consumes in its signature.
{
    const getName = user => user.name;
    const getIdentity = user => `${user.id}:${user.name}`;
    const getCity = user => user.profile.address.city;

    void [getName, getIdentity, getCity];
}

// canary-case: member-write-targets-retain-reads
{
    const mark = (record) => {
        record.value = 1;
        record.count += 1;
        delete record.obsolete;

        return record.label;
    };

    void mark;
}

// Valid target syntax still needs a concrete mutation exception. The target
// keeps its object identity; destructuring a local does not update that object.
// In record.child.value = key.name, record.child and key.name remain reads.
// Pattern keys/defaults remain reads too; only their member targets are excluded.

// prefer-signature-destructuring
{
    const processUser = (user) => {
        const { name, age } = user;

        return `${name} (${age})`;
    };
    const getSummary = (page) => {
        const { title = '', meta: { description = '' } = {} } = page;

        return `${title} ${description}`;
    };

    // Valid boundary: forwarding the whole object still needs its identity.
    const sendUser = user => user;
    const forwarded = (user) => {
        const { name = '' } = user;

        sendUser(user);

        return name;
    };

    void [processUser, getSummary, forwarded];
}

// prefer-safe-destructuring-defaults
// emission-authored-field-unit: this source exception owns value alone.
// Compiler lowering must preserve that unit; other keeps its default finding.
/*
export const read = ({
    // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- The generic provider preserves exact caller-owned absence and payload identity.
    value,
    other
} = {}) => [value, other];
*/
// Joining both fields on the directive target line cannot exempt the sibling.
{
    const getConfig = ({ config: { name } = {} } = {}) => name;
    const getValue = ({ value } = {}) => value;
    const getFirst = ([item] = []) => item;
    const getRest = ({ title, ...rest } = {}) => [title, rest];
    const getRenamed = ({ title: heading } = {}) => heading;

    void [getConfig, getValue, getFirst, getRest, getRenamed];
}

// signature-contract-destructuring
// Native result families also reach patterns: const [first = ''] = Object.fromEntries([['value', 1]]);
// The result is object-like; its individual fields are not inferred from entries.
// Patterns must agree with the known container family and published keys.
// Diagnostic-only control (G12): generic input, captured input and unresolved
// call causes can meet at this query. Their reason and bounded cause selection
// must be stable when other public queries run first. Unknown still supplies no
// container proof, while a separately known array/record conflict still reports.
// The existing evidence-causes check exercises shared/cyclic joins and revision;
// this is metadata stability, not a new lint trigger or an invented input guard.
{
    const getFirstLabel = ({ items = [] } = {}) => {
        const { label = '' } = items;

        return label;
    };
    const getProfile = () => ({ profile: { name: '' } });
    const { profile: { nmae } } = getProfile();

    void [getFirstLabel, nmae];
}

// signature-contract-property
{
    const knownUser = { name: '' };
    knownUser.nmae;

    const getUser = () => ({ name: '' });
    const user = getUser();
    user.nmae;

    const page = { title: '', meta: { tags: [] } };
    const alias = page;
    alias.titel;
    page.meta.tasg;

    void [knownUser, user, alias];
}

// Pending: record fields are not retained through these defaults and callbacks.
{
    const readDefaulted = (defaulted = { name: '' }) => defaulted.nmae;
    readDefaulted();
    const elementNames = [{ name: '' }].map(element => element.nmae);

    void elementNames;
}

// signature-contract-call-site
// Actual values must satisfy the signature, including callback arguments.
{
    const render = ({ title = '' } = {}) => title.trim();
    render({ title: 42 });

    const getCount = (title = '', count = 0) => title ? count : 0;
    getCount('', 'count');
    getCount('', 0, true);
    render({ title: '', extra: true });
    const renderAlias = render;
    renderAlias({ title: false });
    getTitle({ title: 42 });

    const renderPage = ({ page: { title = '', items = [] } = {} } = {}) => ({ title, items });
    renderPage({ page: { title: 42, items: '' } });

    const apply = (callback, value) => callback(value);
    const readTitle = ({ title = '' } = {}) => title;
    apply(readTitle, { title: 42 });
    const readTitles = () => [42].map(readTitle);

    const publish = onPublished => onPublished('published');
    const formatPublication = (status, publishedAt) => `${status}:${publishedAt}`;
    publish(formatPublication);

    const runWhenReady = onReady => onReady();
    runWhenReady(page => page.title);
    const pageHandlers = { render: page => page.title };
    runWhenReady(pageHandlers.render);

    const makeReader = () => (title = '') => title.trim();
    const reader = makeReader();
    reader(42);
    const functionApi = { read: (title = '') => title.trim() };
    functionApi.read(42);

    void [renderPage, readTitles];
}

// A default expression must honor the signature of the function it calls.
// canary-case: entry-default-obligation
{
    const normalizeTitle = (value = '') => value;
    const read = (title = normalizeTitle(42)) => title;

    read();
}

// forEach ignores callback results, so it cannot own async completion.
// Use Promise.all with map for independent work, or await ordered work explicitly.
// canary-case: foreach-synchronous-contract
{
    const visit = async item => item;
    const callback = visit;

    [].forEach(callback);
}

// Pending: the promise callback's payload contradicts the title signature.
{
    const renderTitle = ({ title = '' } = {}) => title;

    Promise.resolve({ title: 42 }).then(renderTitle).catch(report);

    // Pending: each element supplies name, while the callback asks for nmae.
    [{ name: '' }].map(({ nmae = '' } = {}) => nmae);
}

// signature-contract-operation
// An operation must agree with the receiver/result family.
{
    const inspectItems = ({ items = [] } = {}) => items.toUpperCase();
    const inspectTitle = ({ title = '' } = {}) => title.map(Boolean);
    const inspectCount = ({ count = 0 } = {}) => count.trim();
    const inspectEntries = ({ entries = {} } = {}) => entries.map(Boolean);

    getItems({}).toUpperCase();
    getConfig().items.toUpperCase();

    // Explanations must identify the imported producer, including through
    // a barrel or a returned callable, rather than stopping at this consumer.
    getProviderValue().toUpperCase();
    normalizeImportedPage({}).items.toUpperCase();
    const readImportedItems = makeItemsReader();
    readImportedItems({}).toUpperCase();

    const inspectMapped = () => {
        const mapped = ['ready'].map(item => item.toUpperCase());

        return mapped.toUpperCase();
    };
    const loadPage = async () => ({ items: [] });
    const inspectLoaded = async () => {
        const page = await loadPage();

        return page.items.toUpperCase();
    };
    const inspectMixedItems = () => ['ready', 42].map(item => item.toUpperCase());

    // An unrelated reflective lookup cannot erase the numeric contradiction.
    const observe = ({ count = 42 } = {}) => {
        Reflect.get({ name: '' }, 'name');
        count.toFixed();

        return count.trim();
    };

    void [inspectItems, inspectTitle, inspectCount, inspectEntries,
        inspectMapped, inspectLoaded, inspectMixedItems, observe];
}

// Native length is number even when the array is empty. Number has no trim.
// Aliases, returned lengths and string lengths carry the same numeric result;
// unknown alternatives must not erase the established numeric contribution.
// canary-case: native-length-result
{
    ([].length).trim();
}

// Fixed native results use the same aliases, calls and operation requirements.
// Array.from([1]).trim(), Number.parseInt('1').trim() and Date.now().trim() have the same family mismatch.
// Array.from([1]).length also retains G4's numeric result.
// canary-case: native-static-result
{
    Math.max(1, 2).trim();
}

// slice follows its receiver: a string result has no array map; array slice stays array-like.
// canary-case: native-string-slice
{
    'abc'.slice(1).map(Boolean);
}

// This closed root has no toJSON. Custom serializers, replacers and unresolved roots remain unproved.
// JSON.stringify() retains natural absence; JSON.stringify(value) must not invent an always-string result.
// canary-case: native-json-result
{
    JSON.stringify({ value: 1 }).map(Boolean);
}

// A deferred function owns its arguments; its unknown result cannot erase
// an independent module value. Traditional syntax still has its policy finding.
// Arrows inherit this owner; an inner ordinary function owns different arguments.
// canary-case: arguments-owner-scope
{
    const readArgument = function () { return arguments[0]; };
    const independentCount = 42;

    independentCount.trim();
    void readArgument;
}

// An immediate native Array.isArray(arguments) is false. Replacing arguments
// with a rest array changes that observation; retain the native object.
// Implicit arguments do not declare a variadic signature. The transformer
// must expose rest input at its owned native boundary; the call lint remains.
// canary-case: arguments-explicit-arity
{
    const readImplicit = function () { return arguments[0]; };

    readImplicit(42);
}

// Necessary overload exceptions belong to their exact undefined-selected
// partial/value returns. Unrelated nested functions, an extra callable return
// after complete entry, and complete paths returning number versus array still
// contradict return consistency; an overload declaration cannot hide them.

// Unsupported pattern entry belongs to its catch, not every value in the
// module. These uncalled readers do not validate their caught fields/defaults.
// canary-case: catch-pattern-scope
{
    const readMessage = read => {
        try {
            return read();
        } catch ({ message = '' }) {
            return message;
        }
    };
    const readFirst = read => {
        try {
            return read();
        } catch ([first = '']) {
            return first;
        }
    };
    const outsideCount = 42;

    outsideCount.trim();
    void [readMessage, readFirst];
}

// A reached module catch also retains independent preinitialized evidence.
// canary-case: catch-pattern-module-scope
{
    const moduleCatchCount = 42;

    try {
        throw { message: 'ready' };
    } catch ({ message = '' }) {
        void message;
    }

    moduleCatchCount.trim();
}

// Catch-pattern execution remains unknown: a default does not validate an
// unknown source; getters, keys, iteration, nested patterns and abrupt entry
// cannot publish guessed leaf values. A leaf is not the whole thrown object.
// Captured writes and actual eval/arguments barriers retain their own owners.
// Absence-safe Boolean/typeof/guarded reads keep their own boundary proof, even
// inside a pattern initializer. Unsafe receiver/call/iteration uses still require
// a default; unknown pattern completion is not a blanket field requirement.

// Possible parsing failure reaches the handler; its independent numeric
// operation remains contradictory beside an unknown parse result.
// canary-case: catch-possible-operation
{
    const read = (text = '') => {
        try {
            return JSON.parse(text);
        } catch {
            const parseCount = 42;

            return parseCount.trim();
        }
    };

    read('{');
}

// Await owns rejection in this scope. The opaque fetcher supplies no Error
// payload evidence, but cannot erase an independent handler operation.
// canary-case: catch-awaited-operation
{
    const read = async fetcher => {
        try {
            return await fetcher();
        } catch {
            const failureCount = 42;

            return failureCount.trim();
        }
    };

    void read;
}

// A handler's known return also reaches downstream consumers.
// canary-case: catch-result-operation
{
    const read = (text = '') => {
        try {
            return JSON.parse(text);
        } catch {
            return 42;
        }
    };

    read('{').trim();
}

// Reading ambient configuration does not change a local value's family.
// canary-case: ambient-keeps-operation
{
    const { locale = 'en' } = globalThis;
    const count = 42;

    count.trim();
    void locale;
}

// A computed field still carries the supplied value, not its fallback's family.
// canary-case: computed-key-contract
{
    const field = 'title';
    const data = { [field]: 42 };
    const { [field]: title = '' } = data;

    title.trim();
}

// A key supplied by the caller selects the actual record field.
// canary-case: computed-parameter-contract
{
    const read = (field = '', { [field]: value = '' } = {}) => value;

    read('title', { title: 42 }).trim();
}

// split returns an array; trim belongs to strings.
// canary-case: split-result-contract
{
    'news,art'.split(',').trim();
}

// canary-case: split-receiver-contract
{
    const value = 42;

    value.split(',');
}

// Reflection has result contracts too: ownKeys returns an array, has a boolean.
// canary-case: reflection-array-result
{
    Reflect.ownKeys({}).trim();
}

// canary-case: reflection-boolean-result
{
    const hasKey = Reflect.has({ title: 'ready' }, 'title');

    hasKey.trim();
}

// A supplied fallback keeps its own family after an earlier field pattern.
// canary-case: entry-scalar-after-field
{
    const seed = () => 42;
    const read = ({ name = '' } = {}, fallback = seed()) => name || fallback;

    read({ name: '' }, 42).trim();
}

// An omitted argument runs its factory; a field default cannot replace 42.
// canary-case: entry-root-default
{
    const seed = () => ({ name: 42 });
    const read = ({ name = 0 } = seed()) => name;

    read().trim(); // Invalid: 42 has no string trim operation.
    read().toFixed(); // Valid neighbor.
}

// An omitted field runs its lazy default, preserving the produced family.
// canary-case: entry-leaf-default
{
    const seed = () => 42;
    const read = ({ name = seed() } = {}) => name;

    read().trim(); // Invalid: the executed default returns a number.
    read().toFixed(); // Valid neighbor.
}

// A required-field default is skipped when the field is supplied.
// canary-case: entry-skipped-throw
{
    const requireName = () => { throw new Error('Name is required'); };
    const read = ({ name = requireName() } = {}) => name;

    read({ name: 42 }).trim();
    read({ name: 'ready' }).trim(); // Valid neighbor: the default is still skipped.
}

// A default alias forwards the original record and its numeric field.
// canary-case: entry-formal-alias
{
    const read = (value, alias = value) => alias;

    read({ name: 42 }).name.trim();
}

// An unknown external value cannot erase an independently known wrong branch.
// canary-case: entry-known-with-unknown
{
    const formatTotal = (estimated, fetchTotal) => {
        const total = estimated ? 42 : fetchTotal();

        return total.trim();
    };

    void formatTotal;
}

// Pending: the numeric field is lost when the returned rest object is selected.
// Both consumers are ordinary uses of a split record; only selected.trim fails.
{
    const read = (data = {}) => {
        const { title: selected = '', ...rest } = data;

        return { selected, rest };
    };
    const first = read({ title: 42, saved: 'keep' });
    const second = first.rest;

    second.saved.trim();
    first.selected.trim();
}

// signature-contract-return-consistency
// Normal value-producing paths must agree on a return family.
{
    const getValue = (enabled) => {
        if (enabled) return [];

        return '';
    };
    const normalizeItems = (value) => {
        if (Array.isArray(value)) return value;

        return '';
    };
    const getAsyncValue = async (enabled = false) => {
        if (enabled) return [];

        return '';
    };
    const getCollection = (enabled = false) => {
        if (enabled) return {};

        return [];
    };

    // An implicit exit does not establish the text result on the other path.
    const readImplicit = (enabled) => {
        if (enabled) return '';
    };

    void [getValue, normalizeItems, getAsyncValue, getCollection, readImplicit];
}

// G1 controls, exercised by the existing completion/payload owner:
// g1-opaque-binding-continuation: const { x } = null throws before a later
// return 'wrong'. Admitting its catch must not admit that impossible return.
// g1-unknown-iterator: try { const [item] = flag ? [''] : input; return item; }
// catch { return []; } retains the known string and caught array, with input's
// other iterable results unknown. The existing shape-completion owner checks it.
// g1-unreachable-handler: try { return 'ok'; } catch { return 0; } has no
// failure path. Likewise skipped calls and deferred function bodies do not
// make the catch reachable. An unknown caught payload never becomes Error.

// Pending: array/text disagreements are not reported through switch or try/catch.
{
    const readByKind = (kind = '') => {
        switch (kind) {
            case 'list':
                return [];
            default:
                return '';
        }
    };
    const readParsed = (text = '') => {
        try {
            JSON.parse(text);

            return [];
        } catch {
            return '';
        }
    };

    void [readByKind, readParsed];
}

// operator-linebreak
const brokenOperator = 1 +
    2;
void brokenOperator;

// no-falsifiable-property-key
// Explicit empty/default names are rejected, including numeric zero.
{
    const unnamedField = { '': 'value' };
    const columns = { 0: 'Title', 1: 'Author' };
    const visibilityLabels = { false: 'Hidden', true: 'Visible' };

    // Valid neighbors: named fields, array indexing, and Map data keys.
    const record = { title: '' };
    const [firstColumn = ''] = ['Title'];
    const labels = new Map([[0, 'Title']]);

    void [unnamedField, columns, visibilityLabels, record, firstColumn, labels];
}

// no-restricted-syntax (core rule enabled by Resilient's recommended preset)
// Ordinary function expressions use arrows. Receiver-dependent protocol methods
// have their own boundary; do not mechanically rewrite their this/arguments.
// Native lowering control: (function () { return { [arguments[0]]() {} }; })('inner')
// needs its own arguments even though the method body is a separate scope.
// Computed getter/setter names have the same enclosing-scope ownership; nested
// ordinary parameters/bodies do not, while arrows retain lexical references.
// A member such as object.arguments or an erased `type T = typeof arguments`
// supplies no runtime arguments read and must not invent a native exception.
{
    const labelTitle = function (title = '') {
        return title;
    };

    void labelTitle;
}
