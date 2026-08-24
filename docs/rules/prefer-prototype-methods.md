# prefer-prototype-methods

Prefer collection prototype methods over imperative loop syntax. Use the method
that states the operation: `map`, `filter`, `reduce`, `some`, `find`, or
`forEach`.

```javascript
// Incorrect
const enabled = [];

for (const item of items) {
    if (item.enabled) enabled.push(item);
}

// Correct
const enabled = items.filter(item => item.enabled);
```

The rule reports `for`, `for...of`, `for...in`, `while`, and `do...while` unless
the loop node contains `await` outside nested functions. It is intentionally
syntactic; it does not determine whether a loop is semantically a collection
transformation. An `await` confined to a nested callback does not exempt the
surrounding loop. Necessary imperative loops should use a local rule override.
