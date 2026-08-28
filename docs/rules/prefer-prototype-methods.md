# prefer-prototype-methods

Prefer collection prototype methods over imperative loop syntax. Use the method
that states the operation: `map`, `filter`, `reduce`, `some`, `find`, or
`forEach`.

## Smell

An imperative loop can hide whether the operation is mapping, filtering,
searching, reducing, or merely performing ordered effects. A prototype method
states the collection operation directly; an exception remains appropriate
when the loop carries meaningful sequential or control-flow semantics.

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

The rule reports `for`, `for...of`, `for...in`, `while`, and `do...while` unless
one of these exceptions applies:

- the loop node contains `await` outside nested functions;
- the loop has direct `break` that exits the loop, `continue`, `return`, or
  `throw` control flow; a bare `break` that exits only a nested `switch` does
  not qualify;
- a preceding comment has the form `resilient-allow-loop: reason`.

These exceptions cover sequential API work, polling, retries, rate limiting,
early termination, and detailed control flow. The rule is intentionally
syntactic; it does not determine whether a loop is semantically a collection
transformation. An `await` confined to a nested callback does not exempt the
surrounding loop.

Use a reason when suppressing a necessary boundary case:

```javascript
// resilient-allow-loop: preserve API ordering and rate limit
for (const item of items) {
    await send(item);
}
```
