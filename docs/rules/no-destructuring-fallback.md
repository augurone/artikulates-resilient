# no-destructuring-fallback

Disallows using `||` to provide a fallback object in an object destructuring
declaration.

## Smell

Destructuring through `data || {}` hides the boundary's expected shape and
mixes value selection with contract definition. The rule keeps fallback
semantics at the destructured signature or declaration, where the expected
value family is visible.

```javascript
// Incorrect
const {items = []} = data || {};

// Correct
const process = ({data: {items = []} = {}} = {}) => items;
```

The rule does not prohibit `||` for ordinary value selection.
