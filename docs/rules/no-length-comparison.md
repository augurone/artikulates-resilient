# no-length-comparison

Disallows zero/non-zero presence comparisons for `.length`. Use the length
value directly for truthiness. This rule does not police other comparison
operators or exact cardinality checks.

## Smell

Comparing a collection's length to zero or greater-than-zero treats a presence
decision as a numeric special case and splits the project's emptiness
vocabulary. The rule uses JavaScript's truthiness semantics for zero/non-zero
checks while leaving real cardinality questions explicit.

```javascript
// Incorrect
if (items.length === 0) return [];

// Correct
if (!items.length) return [];
if (!!items.length) return items;
if (items.length === 1) return items[0];
```

The rule targets `length === 0`, `0 === length`, `length !== 0`, `0 !== length`,
`length > 0`, and `0 < length`. It provides suggestions for the canonical
`!length` and `length` forms. Exact cardinality checks such as
`items.length === 1` and `items.length > 1` remain valid.
