# prefer-prototype-methods

Prefer collection prototype methods over imperative loop syntax. Use the
method that states the operation: `map`, `filter`, `reduce`, `some`, `find`,
or `forEach`.

```javascript
// Incorrect
const enabled = [];

for (const item of items) {
    if (item.enabled) enabled.push(item);
}

// Correct
const enabled = items.filter(item => item.enabled);
```

The rule reports `for`, `for...of`, `for...in`, `while`, and `do...while`.
This makes collection intent visible and avoids loop state and nested-loop
complexity.
