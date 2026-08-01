# no-undefined-assignment

Disallows explicitly assigning `undefined`. Flexible data may naturally
produce `undefined` while being read, but value-returning functions should
normalize it to the expected falsey type.

```javascript
// Incorrect
const value = undefined;
value = undefined;

// Correct
const getValue = ({ value = '' } = {}) => value;
const hasValue = value === undefined;
```

Returned `undefined` is handled by `prefer-falsey-returns`. Bare `return;` is
allowed for side effects and logical exits.
