# prefer-prototype-methods

Prefer collection prototype methods over imperative loop syntax. Use the method
that states the operation: `map`, `filter`, `reduce`, `some`, `find`, or
`forEach`.

## What this finding means

An imperative loop can hide whether the operation is mapping, filtering,
searching, reducing, or merely performing ordered effects. A prototype method
states the collection operation directly. A retained loop needs either a
completed analyzer-backed boundary or a narrow, reasoned ESLint exception.

```javascript
// Incorrect
const enabledItems = [];

for (const item of items) {
    const { enabled: isEnabled = false } = item;
    if (isEnabled) enabledItems.push(item);
}

// Correct
const enabled = items.filter(({ enabled: isEnabled = false } = {}) => isEnabled);
```

The rule reports `for`, `for...of`, `for...in`, `while`, and `do...while`.
`await`, `break`, `continue`, `return`, and `throw` are observable constraints,
not automatic exceptions. They may reject a prototype rewrite or support a
completed analyzer-backed retained boundary, but they do not silence this rule.

Use a concrete reason when retaining a loop without a completed analyzer-backed
boundary:

```javascript
// eslint-disable-next-line resilient/prefer-prototype-methods -- Preserve synchronous API order for each item.
for (const item of items) {
    send(item);
}
```

## Boundaries and non-goals

The rule does not infer I/O from names, imports, or promise-like values. An
unproven loop remains a finding. Generated exceptions are permitted only when
the transform consumes a completed source-range analyzer agreement with one
exact retained-boundary reason.

## Repair recipes

Choose `map`, `filter`, `reduce`, `some`, `find`, or `forEach` to name the
operation. Retain the loop only when its ordering or control flow is essential.
