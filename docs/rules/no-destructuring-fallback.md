# no-destructuring-fallback

Disallows using `||` to provide a fallback object for destructuring.

```javascript
// Incorrect
const {items = []} = data || {};

// Correct
const process = ({data: {items = []} = {}} = {}) => items;
```

The rule does not prohibit `||` for ordinary value selection.
