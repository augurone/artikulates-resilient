# Coding Standards & Style Guide

This document is written for both people and AI assistants.

- Humans first: a new teammate or manager should be able to understand how we write code and why.
- AI optimized for results: clear rules, short checklists, and strong examples help agents produce better code faster.
- Nuance matters: some ideas repeat on purpose because they apply in slightly different situations.

---

## TL;DR

If you only remember a few things, remember these:

1. Prefer explicit data contracts through destructuring.
2. Return the expected type instead of `null` or `undefined`.
3. Use array methods to show intent: `map`, `reduce`, `filter`, `some`, `find`.
4. Prefer early returns over `else` blocks.
5. Avoid optional chaining `?.` in project code.
6. Never use `||` as a destructuring fallback (`const { x } = obj || {}`); prefer destructuring defaults over property-access `||`.
7. Use truthy/falsy checks for empty collections: `if (items.length)` and `if (!items.length)`.

---

## AI Assistant Quick Rules

When an AI assistant edits code in this project, follow these rules strictly:

1. Do not use optional chaining `?.`.
2. Do not use `||` as a destructuring fallback (`const { x } = obj || {}`); objects must have defaults upstream in the function signature.
3. Do not use `.length > 0` or `.length === 0` for emptiness checks.
4. Destructure nested properties in function parameters when practical.
5. Prefer computed property destructuring for dynamic property access.
6. Prefer `map`, `reduce`, `filter`, `some`, and `find` over `for` and `while`.
7. Prefer early returns over `else` blocks.
8. Add defensive defaults at each destructuring level where data may be missing.

Before completing a code change:

- Search the file for `?.`.
- Search for `||` used as a destructuring fallback (`} = something ||`).
- Search for `.length > 0` and `.length === 0`.
- Check whether function signatures can express the data contract more clearly.
- Check whether loops are actually transformations or accumulations better expressed with array methods.
- Check whether `else` blocks can become guard clauses.

---

## Philosophy

Our code style favors explicit contracts, predictable return types, and visible intent.

We optimize for:

- Readability under change
- Safety around missing data
- Low nesting
- Functional transformations over mutation
- Clear boundaries at function signatures

This style is opinionated by design. The goal is consistency, not novelty.

---

## Core Rules

### 1. Return expected types

Functions should return the type their callers expect. In general, avoid returning `null` or `undefined`.

```javascript
// Avoid
const getUser = (id) => users[id] || null;
const getItems = () => found ? items : undefined;

// Prefer
const getUser = (id) => users[id] || {};
const getName = () => data ? data.name : '';
const getItems = () => found ? items : [];
const getCount = () => found ? count : 0;
const isValid = () => test ? result : false;
```

Why:

- Callers get a predictable shape
- Fewer defensive branches are needed downstream
- Intent is easier to follow

### 2. Function signatures should reveal the contract

When a function depends on nested input, prefer expressing that in the parameter list.

```javascript
// Less clear
const process = (data) => {
    const { config = {} } = data;
    const { name = 'default' } = config;
};

// Clearer
const process = ({
    config: {
        name = 'default'
    } = {}
} = {}) => {
};
```

Why:

- Dependencies are visible at the boundary
- Defaults are harder to forget
- Reviewers can understand the contract without reading the whole function body

### 3. Destructure defensively

If nested data may be missing, default each level deliberately.

```javascript
// Less safe
const { data } = response;
const { user } = data;
const { name } = user;

// Safer
const {
    data: {
        user: {
            name = 'Anonymous'
        } = {}
    } = {}
} = response;
```

Why:

- Missing data fails less often at runtime
- The expected structure is visible in one place

### 4. Check for empty objects explicitly

Object-returning functions should return `{}` when empty, not `null` or `undefined`. Callers check for meaningful content by inspecting keys or using truthiness.

```javascript
const config = getConfig(name);

if (!Object.keys(config).length) {
    throw new Error('Config not found');
}

const title = getTitle();
if (!title) throw new Error('Title required');

const items = getItems();
if (!items.length) throw new Error('No items');
```

Why:

- Objects, arrays, and primitives each have a consistent validation pattern
- We avoid null-checking and mixed guard styles across the codebase

### 5. Avoid optional chaining

In this project, we prefer defensive destructuring over optional chaining.

```javascript
// Avoid
const url = image?.variants?.hero?.url;

// Prefer
const {
    variants: {
        hero: {
            url = ''
        } = {}
    } = {}
} = image;
```

Why:

- The expected structure is explicit
- The data contract is visible instead of implicit

### 6. Prefer destructuring defaults; never use `||` as a destructuring fallback

The only forbidden `||` pattern is using it as a fallback object for destructuring. Objects must have safe defaults applied upstream in the function signature, not patched at every read site.

```javascript
// Forbidden — give the object a default upstream instead
const { count = 0 } = data || {};

// Correct — default applied at the function boundary
const process = ({ data: { count = 0 } = {} } = {}) => count;

// Preferred over property-access ||
const { name = 'default' } = data;   // instead of: const name = data.name || 'default'
const { items = [] } = config;       // instead of: const items = config.items || []

// Acceptable — || for value selection, const assignment, returns
const displayName = preferredName || fallbackName || 'Anonymous';
const canEdit = isAdmin || isOwner;
const value = input || 0;
```

Why:

- `||` treats `0`, `''`, and `false` as missing — destructuring defaults only trigger on `undefined`
- Defaulting at the function boundary makes the contract visible at the signature
- The object source should be made safe upstream, not patched at each read site

### 7. Use truthy and falsy checks for emptiness

Prefer:

```javascript
if (items.length) { }
if (!items.length) { }
if (count) { }
```

Instead of:

```javascript
if (items.length > 0) { }
if (items.length === 0) { }
if (count !== 0) { }
```

Exception:

```javascript
if (items.length === 1) { }
if (count >= 10) { }
```

Why:

- It removes noise when the intent is simply empty vs non-empty

### 8. Prefer early returns

Use guard clauses so the main path remains easy to scan.

```javascript
// Avoid
if (condition) {
    return valueA;
} else {
    return valueB;
}

// Prefer
if (!condition) return valueA;
return valueB;
```

Why:

- The happy path stays visible
- Nesting stays shallow

### 9. Prefer functional transformations over loops

Choose the method that communicates the job:

- `map`: every item becomes another item
- `filter`: keep some items
- `reduce`: accumulate or change type
- `some`: check whether any item matches
- `find`: retrieve one matching item
- `forEach`: side effects only

```javascript
const transformed = items.map(item => ({ ...item, processed: true }));

const filtered = items.filter(item => item.enabled);

const flags = args.reduce((acc, arg) => {
    if (!arg.startsWith('--')) return acc;
    const [, value] = arg.split('=');
    return { ...acc, [value]: true };
}, {});
```

Why:

- The reader sees intent immediately
- Mutation and bookkeeping are reduced

### 10. Prefer destructuring for dynamic access

When property access is dynamic, computed destructuring makes the dependency explicit.

```javascript
// Less explicit
const variantConfig = variants[variantName];

// More explicit
const { [variantName]: variantConfig } = variants;
```

Why:

- Dynamic access is declared up front
- It stays consistent with the rest of the style

### 11. Prefer `Object.entries()` for object iteration

```javascript
// Less clear
Object.keys(obj).forEach(key => {
    const value = obj[key];
});

// Clearer
Object.entries(obj).forEach(([key, value]) => {
});
```

Why:

- Key-value intent is visible immediately

---

## Nuance and Tradeoffs

These rules are strong defaults, not a contest to remove judgment.

### Repetition is intentional

Some guidance appears more than once because the same principle shows up in different situations:

- function boundaries
- object validation
- nested data access
- transformations vs side effects

That repetition is there to help both humans and AI assistants apply the same pattern consistently.

### “Prefer” vs “always”

Most of this guide reflects strong preferences. In practice:

- Prefer consistency over clever exceptions
- Prefer explicitness over terseness
- Prefer readability over dogma

If a rule creates worse code in a very specific case, call that out in review and make the exception deliberate.

### Async work deserves judgment

`Promise.all(items.map(...))` is often a good fit, but not always.

Use sequential async flows when:

- order matters
- the upstream service has rate limits
- the work is stateful
- concurrency would make debugging or recovery harder

### Recursive replacements for loops

Replacing loops with recursion can improve clarity in some flows, especially paginated fetches or tree traversal. It is not automatically better in every situation. Favor whichever form is clearest and safest for the runtime characteristics involved.

---

## ESLint-Driven Conventions

The codebase also follows these style constraints:

### Imports

- Include `.js` extensions
- Keep imports ordered consistently
- Avoid unnecessary path segments

### Formatting

- Use 4-space indentation
- Keep line length within configured limits
- Avoid trailing commas
- Keep empty lines under control

### General style

- Prefer function expressions over declarations
- Avoid `console`; use approved output patterns instead
- Avoid nested ternaries
- Use `===` and `!==`

---

## Review Checklist

Before merging code, ask:

- Does the function signature clearly show what the function needs?
- Are nested reads handled safely?
- Are return types predictable?
- Is the code using transformations instead of manual accumulation where appropriate?
- Can any `else` blocks become early returns?
- Are emptiness checks written in the project style?
- Is there a simpler, more explicit version of the same logic?

---

## Examples

### Example 1: Dynamic property access

```javascript
const { [variantName]: variantConfig } = variants;
const {
    [targetField]: targetImage
} = fieldData;
const { [variantName]: generator } = VARIANT_GENERATORS;
```

### Example 2: Accumulation with `reduce`

```javascript
const { results, failed } = await pendingItems.reduce(
    async (accPromise, queueItem) => {
        const acc = await accPromise;

        try {
            const result = await processQueueItem(queueItem);
            return {
                results: [...acc.results, result],
                failed: acc.failed
            };
        } catch (error) {
            return {
                results: acc.results,
                failed: [...acc.failed, { ...queueItem, error: error.message }]
            };
        }
    },
    Promise.resolve({ results: [], failed: [] })
);
```

### Example 3: Paginated async recursion

```javascript
const fetchAllPages = async (offset = 0, accumulated = []) => {
    const page = await fetchPage(offset);
    const allItems = [...accumulated, ...page.items];

    if (!page.hasMore) return allItems;
    return fetchAllPages(offset + 100, allItems);
};

const items = await fetchAllPages();
```

### Example 4: Early return shape

```javascript
if (result.skipped) {
    process.stdout.write('Skipped\n');
    return { results: [...acc.results, result], failed: acc.failed };
}

process.stdout.write('Processed\n');
return { results: [...acc.results, result], failed: acc.failed };
```

---

## Final Summary

This style guide is meant to create consistent, explicit JavaScript that is easy to review, safe around missing data, and friendly to both human collaborators and AI-assisted workflows.

The priorities are:

1. clear contracts
2. predictable return types
3. visible intent
4. low nesting
5. consistent patterns under change
