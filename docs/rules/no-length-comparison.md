# no-length-comparison

Disallows strict equality against zero for a collection’s `.length`. This rule
does not police other comparison operators or exact cardinality checks.

```javascript
// Incorrect
if (items.length === 0) return [];

// Correct
if (!items.length) return [];
if (!!items.length) return items;
if (items.length > 0) return items;
if (items.length === 1) return items[0];
```

The rule only targets `length === 0` (including `0 === length`). Exact
cardinality checks such as `items.length === 1` remain valid.
